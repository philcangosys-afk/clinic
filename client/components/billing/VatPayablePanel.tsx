import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Download, Scale } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount } from "@/lib/locale";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * صافي ضريبة القيمة المضافة المستحقّ دفعها — طلب المالك (10/10/2026).
 *
 * «الفرق بين المشتريات والمبيعات، مفصّلًا، لتظهر الضريبة المستحقّ دفعها».
 * يُحسب في القاعدة (`app_vat_payable`، 0239) ويتجدّد وحده مع كلّ تغيير في
 * الفترة وعند العودة إلى الشاشة:
 *
 *   ضريبة المخرجات = المبيعات − الإشعارات الدائنة + الإشعارات المدينة
 *   ضريبة المدخلات = المشتريات برقمٍ ضريبيّ − مرتجعاتها + المصروفات برقمٍ ضريبيّ
 *   الصافي = المخرجات − المدخلات (موجبٌ يُدفع للهيئة، سالبٌ رصيدٌ دائن)
 *
 * وما عليه ضريبةٌ بلا رقمٍ ضريبيّ للمورد يُعرض منفصلًا: لا يُخصم في الإقرار.
 */

type VatPayable = {
  sales_count: number;
  sales_taxable: number;
  sales_vat: number;
  credit_count: number;
  credit_taxable: number;
  credit_vat: number;
  debit_count: number;
  debit_taxable: number;
  debit_vat: number;
  /** فواتير Kizen (الأرشيف) من تاريخ التسجيل الضريبيّ — 0240 */
  legacy_count?: number;
  legacy_taxable?: number;
  legacy_vat?: number;
  legacy_return_count?: number;
  legacy_return_taxable?: number;
  legacy_return_vat?: number;
  purchase_count: number;
  purchase_taxable: number;
  purchase_vat: number;
  purchase_return_count: number;
  purchase_return_taxable: number;
  purchase_return_vat: number;
  expense_count: number;
  expense_taxable: number;
  expense_vat: number;
  nondeductible_count: number;
  nondeductible_vat: number;
  output_vat: number;
  input_vat: number;
  net_vat: number;
};

const VAT_ROLES = ["owner", "organization_admin", "accountant", "branch_manager"];

type Preset = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "custom";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === "this_month") return { from: iso(new Date(y, m, 1)), to: iso(now) };
  if (preset === "last_month") return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  const q = Math.floor(m / 3) * 3;
  if (preset === "this_quarter") return { from: iso(new Date(y, q, 1)), to: iso(now) };
  return { from: iso(new Date(y, q - 3, 1)), to: iso(new Date(y, q, 0)) };
}

const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "this_month", label: "هذا الشهر" },
  { key: "last_month", label: "الشهر السابق" },
  { key: "this_quarter", label: "هذا الربع" },
  { key: "last_quarter", label: "الربع السابق" },
];

export default function VatPayablePanel() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const allowed = legacyMode || VAT_ROLES.includes(membership?.role_key ?? "");
  const [preset, setPreset] = useState<Preset>("this_month");
  const [range, setRange] = useState(() => presetRange("this_month"));
  const invalid = !range.from || !range.to || range.to < range.from;

  const data = useQuery({
    queryKey: ["vat-payable", organization?.id, range.from, range.to],
    enabled: allowed && Boolean(organization?.id) && !invalid,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc("app_vat_payable", {
        p_organization_id: organization!.id,
        p_from: range.from,
        p_to: range.to,
      });
      if (error) throw error;
      const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | null;
      if (!row) return null;
      return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v ?? 0)])) as VatPayable;
    },
  });

  const lines = useMemo(() => {
    const d = data.data;
    if (!d) return null;
    return {
      output: [
        { label: "المبيعات (الفواتير الصادرة)", count: d.sales_count, taxable: d.sales_taxable, vat: d.sales_vat, sign: 1 },
        { label: "الإشعارات الدائنة والمرتجعات", count: d.credit_count, taxable: d.credit_taxable, vat: d.credit_vat, sign: -1 },
        { label: "الإشعارات المدينة", count: d.debit_count, taxable: d.debit_taxable, vat: d.debit_vat, sign: 1 },
        // فواتير Kizen المرحّلة: من تاريخ التسجيل الضريبيّ (0240) — تظهر متى وُجدت في الفترة
        ...((d.legacy_count ?? 0) > 0 || (d.legacy_return_count ?? 0) > 0
          ? [
              {
                label: "مبيعات النظام السابق (Kizen)",
                count: d.legacy_count ?? 0,
                taxable: d.legacy_taxable ?? 0,
                vat: d.legacy_vat ?? 0,
                sign: 1,
              },
              {
                label: "مرتجعات النظام السابق (Kizen)",
                count: d.legacy_return_count ?? 0,
                taxable: d.legacy_return_taxable ?? 0,
                vat: d.legacy_return_vat ?? 0,
                sign: -1,
              },
            ]
          : []),
      ],
      input: [
        { label: "المشتريات بفاتورة ضريبية", count: d.purchase_count, taxable: d.purchase_taxable, vat: d.purchase_vat, sign: 1 },
        { label: "مرتجعات المشتريات", count: d.purchase_return_count, taxable: d.purchase_return_taxable, vat: d.purchase_return_vat, sign: -1 },
        { label: "المصروفات بفاتورة ضريبية", count: d.expense_count, taxable: d.expense_taxable, vat: d.expense_vat, sign: 1 },
      ],
    };
  }, [data.data]);

  if (!allowed) return null;

  const d = data.data;
  const payable = (d?.net_vat ?? 0) >= 0;

  const exportCsv = () => {
    if (!d || !lines) return;
    const rows: (string | number)[][] = [
      ["البند", "العدد", "الوعاء", "الضريبة"],
      ...lines.output.map((l) => [l.label, l.count, (l.sign * l.taxable).toFixed(2), (l.sign * l.vat).toFixed(2)]),
      ["إجمالي ضريبة المخرجات", "", "", d.output_vat.toFixed(2)],
      ...lines.input.map((l) => [l.label, l.count, (l.sign * l.taxable).toFixed(2), (l.sign * l.vat).toFixed(2)]),
      ["إجمالي ضريبة المدخلات", "", "", d.input_vat.toFixed(2)],
      [payable ? "صافي الضريبة المستحقّ دفعها" : "رصيد دائن لدى الهيئة", "", "", Math.abs(d.net_vat).toFixed(2)],
      ["ضريبة بلا رقم ضريبي للمورد (غير قابلة للخصم)", d.nondeductible_count, "", d.nondeductible_vat.toFixed(2)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vat-payable-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Section = ({
    title,
    rows,
    total,
    totalLabel,
  }: {
    title: string;
    rows: { label: string; count: number; taxable: number; vat: number; sign: number }[];
    total: number;
    totalLabel: string;
  }) => (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{title}</TableHead>
            <TableHead className="w-20 text-end">العدد</TableHead>
            <TableHead className="w-32 text-end">الوعاء</TableHead>
            <TableHead className="w-32 text-end">الضريبة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label} className={row.count === 0 ? "text-muted-foreground" : undefined}>
              <TableCell className="text-sm">
                {row.sign < 0 ? "− " : ""}
                {row.label}
              </TableCell>
              <TableCell className="text-end tabular-nums">{row.count}</TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {formatAmount(row.sign * row.taxable)}
              </TableCell>
              <TableCell className="text-end font-medium tabular-nums" dir="ltr">
                {formatAmount(row.sign * row.vat)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="font-semibold">
              {totalLabel}
            </TableCell>
            <TableCell className="text-end font-bold tabular-nums" dir="ltr">
              {formatAmount(total)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          صافي الضريبة المستحقّة
        </CardTitle>
        <CardDescription>
          ضريبة المبيعات ناقص ضريبة المشتريات القابلة للخصم — يُحسب تلقائيًّا من الفواتير الصادرة وفواتير Kizen المرحّلة
          (من تاريخ التسجيل الضريبيّ) وفواتير المشتريات والمصروفات في الفترة. المشتريات تُحتسب بتاريخ فاتورة المورد.
        </CardDescription>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={preset === p.key ? "default" : "outline"}
                className="h-9"
                onClick={() => {
                  setPreset(p.key);
                  setRange(presetRange(p.key));
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={range.from}
              onChange={(e) => {
                setPreset("custom");
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={range.to}
              onChange={(e) => {
                setPreset("custom");
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
            />
          </div>
          <Button size="sm" variant="outline" className="h-9" onClick={exportCsv} disabled={!d}>
            <Download className="h-4 w-4" />
            تصدير CSV
          </Button>
        </div>
        {invalid && <p className="text-xs text-destructive">تاريخ «إلى» قبل تاريخ «من».</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data.isLoading && <Skeleton className="h-40 w-full" />}
        {data.isError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errorMessage(data.error)}
          </p>
        )}
        {d && lines && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border p-4">
                <p className="text-xs text-muted-foreground">ضريبة المبيعات (المخرجات)</p>
                <p className="mt-1 text-xl font-bold tabular-nums" dir="ltr">
                  {formatAmount(d.output_vat)} <span className="text-sm font-normal">ر.س</span>
                </p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs text-muted-foreground">ضريبة المشتريات (المدخلات)</p>
                <p className="mt-1 text-xl font-bold tabular-nums" dir="ltr">
                  {formatAmount(d.input_vat)} <span className="text-sm font-normal">ر.س</span>
                </p>
              </div>
              <div
                className={`rounded-xl border-2 p-4 ${
                  payable ? "border-rose-300 bg-rose-50 dark:bg-rose-950/30" : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                }`}
              >
                <p className="flex items-center gap-1 text-xs font-semibold">
                  <Calculator className="h-3.5 w-3.5" />
                  {payable ? "المستحقّ دفعه للهيئة" : "رصيد دائن لدى الهيئة"}
                </p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${payable ? "text-rose-700" : "text-emerald-700"}`} dir="ltr">
                  {formatAmount(Math.abs(d.net_vat))} <span className="text-sm font-normal">ر.س</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
                  {formatAmount(d.output_vat)} − {formatAmount(d.input_vat)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="ضريبة المخرجات" rows={lines.output} total={d.output_vat} totalLabel="إجمالي ضريبة المخرجات" />
              <Section title="ضريبة المدخلات" rows={lines.input} total={d.input_vat} totalLabel="إجمالي ضريبة المدخلات" />
            </div>

            {d.nondeductible_count > 0 && (
              <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {d.nondeductible_count} مستند مشتريات أو مصروفات عليه ضريبة{" "}
                <span className="font-semibold tabular-nums">{formatAmount(d.nondeductible_vat)}</span> بلا رقم ضريبيّ
                للمورد — لا تُخصم في الإقرار. أضف الرقم الضريبيّ في الفاتورة إن كان المورد مسجّلًا.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
