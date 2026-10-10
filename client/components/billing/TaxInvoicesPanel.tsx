import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Receipt } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatDateTime, useLocaleSettings } from "@/lib/locale";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import InvoiceDetailsDialog from "@/components/billing/InvoiceDetailsDialog";

/**
 * الفواتير الضريبية — طلب المالك (05/10/2026): «أظهر الفواتير الضريبية
 * وبياناتها ومجموعها في صفحة الضريبة والفوترة الإلكترونية لمعرفة الفواتير
 * التي عليها ضريبة».
 *
 * كلّ مستندٍ صادر (لا مسوّدة ولا ملغى ولا مؤقّت) في الفترة بتاريخ إصداره:
 * الوعاء (قبل الضريبة) والضريبة والإجمالي وحالة ZATCA، والافتراض «عليها
 * ضريبة». الإشعار الدائن يُطرح (بالسالب) من المجاميع كما في الإقرار.
 * الضغط على الصفّ يفتح الفاتورة.
 */

type TaxInvoiceRow = {
  id: string;
  document_prefix: string | null;
  document_number: number | null;
  invoice_number: number | null;
  document_type: string | null;
  issued_at: string;
  status: string | null;
  subtotal_amount: number | null;
  discount_amount: number | null;
  vat_amount: number | null;
  exemption_amount: number | null;
  net_amount: number | null;
  zatca_status: string | null;
  zatca_mode: string | null;
  external_customer_name: string | null;
  patient: { name_ar: string; file_number: number | null } | { name_ar: string; file_number: number | null }[] | null;
  nationality: { name_ar: string } | { name_ar: string }[] | null;
};

type VatFilter = "taxed" | "untaxed" | "all";

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] : value) ?? null;

const DOC_LABEL: Record<string, string> = {
  simplified: "مبسّطة",
  standard: "ضريبية (أعمال)",
  credit_note: "إشعار دائن",
  debit_note: "إشعار مدين",
};

const ZATCA_LABEL: Record<string, { label: string; className: string }> = {
  reported: { label: "مُبلَّغة", className: "bg-emerald-100 text-emerald-800" },
  cleared: { label: "مُعتمدة", className: "bg-emerald-100 text-emerald-800" },
  pending: { label: "لم تُرسل", className: "bg-slate-100 text-slate-700" },
  submitted: { label: "قيد الإرسال", className: "bg-sky-100 text-sky-800" },
  failed: { label: "تعذّر الإرسال", className: "bg-amber-100 text-amber-900" },
  rejected: { label: "مرفوضة", className: "bg-rose-100 text-rose-800" },
  ambiguous: { label: "غير محسومة", className: "bg-rose-200 text-rose-900" },
};

const money = (value: number) =>
  value.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TaxInvoicesPanel() {
  const { organization } = useOrganizationAccess();
  const { calendarDisplay } = useLocaleSettings();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [vatFilter, setVatFilter] = useState<VatFilter>("taxed");
  const [term, setTerm] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const invoices = useQuery({
    queryKey: ["tax-invoices", organization?.id, from, to, vatFilter],
    enabled: Boolean(organization?.id && from && to),
    queryFn: async () => {
      // بتوقيت الجهاز: من بداية «من» إلى نهاية «إلى»
      const start = new Date(`${from}T00:00:00`).toISOString();
      const end = new Date(`${to}T23:59:59.999`).toISOString();
      const all: TaxInvoiceRow[] = [];
      for (let page = 0; page < 20; page += 1) {
        let query = supabase
          .from("sales_invoices")
          .select(
            "id, document_prefix, document_number, invoice_number, document_type, issued_at, status, " +
              "subtotal_amount, discount_amount, vat_amount, exemption_amount, net_amount, zatca_status, zatca_mode, " +
              "external_customer_name, patient:patients!sales_invoices_patient_tenant_fk(name_ar, file_number), " +
              "nationality:lookup_values!sales_invoices_nationality_value_id_fkey(name_ar)",
          )
          .eq("organization_id", organization!.id)
          .not("issued_at", "is", null)
          .gte("issued_at", start)
          .lte("issued_at", end)
          .not("status", "in", "(draft,void)")
          .or("is_temporary.is.null,is_temporary.eq.false")
          .order("issued_at", { ascending: false })
          .range(page * 1000, page * 1000 + 999);
        if (vatFilter === "taxed") query = query.neq("vat_amount", 0);
        if (vatFilter === "untaxed") query = query.eq("vat_amount", 0);
        const { data, error } = await query;
        if (error) throw error;
        const rows = (data ?? []) as unknown as TaxInvoiceRow[];
        all.push(...rows);
        if (rows.length < 1000) break;
      }
      return all;
    },
  });

  const rows = useMemo(() => {
    const list = invoices.data ?? [];
    const q = term.trim();
    if (!q) return list;
    return list.filter((r) => {
      const patient = one(r.patient);
      return [labelOf(r), patient?.name_ar, patient?.file_number, r.external_customer_name]
        .filter((v) => v !== null && v !== undefined)
        .some((v) => String(v).includes(q));
    });
  }, [invoices.data, term]);

  const totals = useMemo(() => {
    let taxable = 0;
    let vat = 0;
    let net = 0;
    let taxedCount = 0;
    for (const r of rows) {
      const sign = signOf(r);
      const v = amount(r, r.vat_amount);
      const n = amount(r, r.net_amount);
      vat += sign * v;
      net += sign * n;
      taxable += sign * (n - v);
      if (v !== 0) taxedCount += 1;
    }
    return { taxable, vat, net, taxedCount };
  }, [rows]);

  const exportCsv = () => {
    const header = ["الفاتورة", "التاريخ", "النوع", "العميل", "رقم الملف", "الجنسية", "الوعاء قبل الضريبة", "الضريبة", "الإجمالي", "حالة ZATCA"];
    const lines = rows.map((r) => {
      const sign = signOf(r);
      const patient = one(r.patient);
      const v = amount(r, r.vat_amount);
      const n = amount(r, r.net_amount);
      return [
        labelOf(r),
        formatDateTime(r.issued_at, calendarDisplay),
        DOC_LABEL[r.document_type ?? ""] ?? r.document_type ?? "",
        patient?.name_ar ?? r.external_customer_name ?? "",
        patient?.file_number ?? "",
        one(r.nationality)?.name_ar ?? "",
        (sign * (n - v)).toFixed(2),
        (sign * v).toFixed(2),
        (sign * n).toFixed(2),
        zatcaOf(r).label,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",");
    });
    lines.push(
      ["الإجمالي", "", "", "", "", "", totals.taxable.toFixed(2), totals.vat.toFixed(2), totals.net.toFixed(2), ""]
        .map((cell) => `"${cell}"`)
        .join(","),
    );
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tax-invoices-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" />
          الفواتير الضريبية
        </CardTitle>
        <CardDescription>
          الفواتير الصادرة في الفترة بوعائها وضريبتها وإجماليها — الإشعار الدائن يُطرح من المجاميع.
        </CardDescription>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">الضريبة</Label>
            <Select value={vatFilter} onValueChange={(v) => setVatFilter(v as VatFilter)}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="taxed">عليها ضريبة</SelectItem>
                <SelectItem value="untaxed">بلا ضريبة (صفر/معفاة)</SelectItem>
                <SelectItem value="all">كلّ الفواتير</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="بحث برقم الفاتورة أو المريض أو رقم الملف"
            className="h-9 w-64"
          />
          <Button size="sm" variant="outline" className="h-9" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4" />
            تصدير CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="عدد الفواتير" value={rows.length.toLocaleString("ar-SA-u-nu-latn")} hint={`منها ${totals.taxedCount.toLocaleString("ar-SA-u-nu-latn")} عليها ضريبة`} />
          <Stat label="الوعاء قبل الضريبة" value={`${money(totals.taxable)} ر.س`} />
          <Stat label="مجموع الضريبة" value={`${money(totals.vat)} ر.س`} strong />
          <Stat label="الإجمالي شاملًا الضريبة" value={`${money(totals.net)} ر.س`} />
        </div>

        {invoices.isLoading && <Skeleton className="h-40 w-full" />}
        {invoices.isError && (
          <p className="text-sm text-destructive">تعذّر التحميل: {errorMessage(invoices.error)}</p>
        )}
        {!invoices.isLoading && !invoices.isError && (
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفاتورة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الجنسية</TableHead>
                  <TableHead className="text-end">الوعاء</TableHead>
                  <TableHead className="text-end">الضريبة</TableHead>
                  <TableHead className="text-end">الإجمالي</TableHead>
                  <TableHead>ZATCA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const sign = signOf(r);
                  const patient = one(r.patient);
                  const v = amount(r, r.vat_amount);
                  const n = amount(r, r.net_amount);
                  const z = zatcaOf(r);
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setOpenId(r.id)}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{labelOf(r)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.issued_at, calendarDisplay)}</TableCell>
                      <TableCell className="text-xs">{DOC_LABEL[r.document_type ?? ""] ?? r.document_type ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {patient?.name_ar ?? r.external_customer_name ?? "—"}
                        {patient?.file_number ? <span className="ms-1 text-xs text-muted-foreground">({patient.file_number})</span> : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{one(r.nationality)?.name_ar ?? "—"}</TableCell>
                      <TableCell className="text-end font-mono text-xs tabular-nums">{money(sign * (n - v))}</TableCell>
                      <TableCell className={`text-end font-mono text-xs font-semibold tabular-nums ${v !== 0 ? "text-primary" : "text-muted-foreground"}`}>
                        {money(sign * v)}
                      </TableCell>
                      <TableCell className="text-end font-mono text-xs tabular-nums">{money(sign * n)}</TableCell>
                      <TableCell>
                        <Badge className={z.className}>{z.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا فواتير في هذه الفترة بهذا الشرط.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {rows.length > 0 && (
                <TableFooter>
                  <TableRow className="font-semibold">
                    <TableCell colSpan={5}>الإجمالي ({rows.length.toLocaleString("ar-SA-u-nu-latn")} فاتورة)</TableCell>
                    <TableCell className="text-end font-mono text-xs tabular-nums">{money(totals.taxable)}</TableCell>
                    <TableCell className="text-end font-mono text-xs tabular-nums text-primary">{money(totals.vat)}</TableCell>
                    <TableCell className="text-end font-mono text-xs tabular-nums">{money(totals.net)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        )}
      </CardContent>
      <InvoiceDetailsDialog invoiceId={openId} onOpenChange={() => setOpenId(null)} canPay={false} />
    </Card>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${strong ? "border-primary/40 bg-primary/5" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono tabular-nums ${strong ? "text-lg font-bold text-primary" : "text-base font-semibold"}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function labelOf(r: TaxInvoiceRow) {
  return r.document_number
    ? `${r.document_prefix ? `${r.document_prefix}-` : ""}${r.document_number}`
    : String(r.invoice_number ?? "—");
}

/** الإشعار الدائن يُطرح — مبالغه تُحفظ موجبة، ويُؤخذ مطلقها احتياطًا */
function signOf(r: TaxInvoiceRow) {
  return r.document_type === "credit_note" ? -1 : 1;
}
const amount = (r: TaxInvoiceRow, value: number | null | undefined) =>
  r.document_type === "credit_note" ? Math.abs(Number(value ?? 0)) : Number(value ?? 0);

function zatcaOf(r: TaxInvoiceRow) {
  const key = r.zatca_mode === "production" ? r.zatca_status ?? "pending" : "pending";
  return ZATCA_LABEL[key] ?? { label: key, className: "bg-slate-100 text-slate-700" };
}
