import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  PURCHASE_PURPOSES,
  PurposeBadge,
  PurposeFilterBar,
  matchesPurpose,
  purposeLabel,
  type PurposeFilterValue,
} from "@/components/purchasing/purchase-purpose";

/**
 * تقارير المشتريات — كم أُنفق، ولمن، وعلى أيّ جهة (0177).
 *
 * تجمع مصدرين لا يلتقيان في شاشةٍ أخرى: فواتير الموردين (غير الملغاة) وسندات
 * المصروف النقدي (غير الملغاة). فيُرى إنفاق الصيدلية كلّه، أو الإدارة كلّها،
 * سواءٌ اشتُري بفاتورة مورد أو دُفع نقدًا من الصندوق.
 *
 * ما سبق تصنيفَ الجهات يظهر «غير مصنّف» كما هو — لا يُنسب إلى جهةٍ لم تُختر.
 */

type SpendRow = {
  source_kind: "invoice" | "expense";
  source_id: string;
  doc_date: string;
  doc_number: string | null;
  purchase_purpose: string | null;
  party_name: string | null;
  category_name: string | null;
  warehouse_name: string | null;
  vat_amount: number;
  total_amount: number;
  paid_amount: number;
  status: string;
};

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("en-CA");
}
function today() {
  return new Date().toLocaleDateString("en-CA");
}

const fmt = (n: number) => n.toLocaleString("ar-SA", { maximumFractionDigits: 2 });

export default function PurchaseReports() {
  const { organization } = useOrganizationAccess();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [purposeFilter, setPurposeFilter] = useState<PurposeFilterValue>("all");

  const spend = useQuery({
    queryKey: ["procurement-spend", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_procurement_spend")
        .select("source_kind, source_id, doc_date, doc_number, purchase_purpose, party_name, category_name, warehouse_name, vat_amount, total_amount, paid_amount, status")
        .eq("organization_id", organization!.id)
        .gte("doc_date", from)
        .lte("doc_date", to)
        .order("doc_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as SpendRow[];
    },
  });

  const rows = useMemo(
    () => (spend.data ?? []).filter((row) => matchesPurpose(purposeFilter, row.purchase_purpose)),
    [spend.data, purposeFilter],
  );

  const summary = useMemo(() => {
    let invoices = 0;
    let expenses = 0;
    let vat = 0;
    let unpaid = 0;
    const byPurpose = new Map<string, { invoices: number; expenses: number }>();
    const byParty = new Map<string, { total: number; count: number }>();
    const byMonth = new Map<string, { invoices: number; expenses: number }>();

    for (const row of rows) {
      const amount = Number(row.total_amount ?? 0);
      const isInvoice = row.source_kind === "invoice";
      if (isInvoice) {
        invoices += amount;
        unpaid += Math.max(0, amount - Number(row.paid_amount ?? 0));
      } else {
        expenses += amount;
      }
      vat += Number(row.vat_amount ?? 0);

      const purposeKey = row.purchase_purpose ?? "unclassified";
      const p = byPurpose.get(purposeKey) ?? { invoices: 0, expenses: 0 };
      if (isInvoice) p.invoices += amount;
      else p.expenses += amount;
      byPurpose.set(purposeKey, p);

      const partyKey = row.party_name?.trim() || (isInvoice ? "مورد غير محدَّد" : "مصروف بلا مستفيد");
      const party = byParty.get(partyKey) ?? { total: 0, count: 0 };
      party.total += amount;
      party.count += 1;
      byParty.set(partyKey, party);

      const monthKey = row.doc_date.slice(0, 7);
      const m = byMonth.get(monthKey) ?? { invoices: 0, expenses: 0 };
      if (isInvoice) m.invoices += amount;
      else m.expenses += amount;
      byMonth.set(monthKey, m);
    }

    const total = invoices + expenses;
    const purposeOrder = [...PURCHASE_PURPOSES.map((p) => p.key as string), "unclassified"];
    return {
      invoices,
      expenses,
      vat,
      unpaid,
      total,
      byPurpose: purposeOrder
        .filter((key) => byPurpose.has(key))
        .map((key) => ({ key, ...byPurpose.get(key)! })),
      byParty: [...byParty.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 15),
      byMonth: [...byMonth.entries()]
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }, [rows]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">المشتريات</p>
          <h1 className="text-2xl font-bold">تقارير المشتريات</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            كلّ ما أُنفق في الفترة: فواتير الموردين والمصروفات النقدية معًا، موزّعًا على الجهات
            والموردين والأشهر. الملغى لا يدخل.
          </p>
        </div>
        <Button variant="outline" onClick={() => spend.refetch()}>
          <RefreshCcw className="h-4 w-4" />
          تحديث
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">من</Label>
              <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">إلى</Label>
              <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <PurposeFilterBar value={purposeFilter} onChange={setPurposeFilter} />
        </CardContent>
      </Card>

      {spend.isLoading && <Skeleton className="h-64 w-full" />}
      {spend.isError && (
        <p className="py-6 text-center text-sm text-destructive">تعذّر التحميل: {errorMessage(spend.error)}</p>
      )}

      {!spend.isLoading && !spend.isError && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="إجمالي الإنفاق" value={summary.total} strong />
            <Tile label="فواتير الموردين" value={summary.invoices} />
            <Tile label="المصروفات النقدية" value={summary.expenses} />
            <Tile label="ضريبة المدخلات" value={summary.vat} />
            <Tile label="غير مسدَّد للموردين" value={summary.unpaid} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">حسب الجهة</CardTitle>
                <CardDescription>نصيب كلّ جهة من إنفاق الفترة.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الجهة</TableHead>
                      <TableHead>فواتير</TableHead>
                      <TableHead>نقدي</TableHead>
                      <TableHead>الإجمالي</TableHead>
                      <TableHead>النسبة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byPurpose.map((p) => {
                      const total = p.invoices + p.expenses;
                      const share = summary.total > 0 ? (total / summary.total) * 100 : 0;
                      return (
                        <TableRow key={p.key}>
                          <TableCell>
                            <PurposeBadge purpose={p.key === "unclassified" ? null : p.key} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{fmt(p.invoices)}</TableCell>
                          <TableCell className="font-mono text-xs">{fmt(p.expenses)}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold">{fmt(total)}</TableCell>
                          <TableCell className="w-32">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                                <div className="h-full rounded bg-primary" style={{ width: `${share}%` }} />
                              </div>
                              <span className="w-10 text-end font-mono text-[11px]">{share.toFixed(0)}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {summary.byPurpose.length === 0 && <EmptyRow cols={5} />}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">حسب الشهر</CardTitle>
                <CardDescription>فواتير الموردين والمصروفات النقدية في كلّ شهر من الفترة.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الشهر</TableHead>
                      <TableHead>فواتير</TableHead>
                      <TableHead>نقدي</TableHead>
                      <TableHead>الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byMonth.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-mono text-xs">{m.month}</TableCell>
                        <TableCell className="font-mono text-xs">{fmt(m.invoices)}</TableCell>
                        <TableCell className="font-mono text-xs">{fmt(m.expenses)}</TableCell>
                        <TableCell className="font-mono text-xs font-semibold">{fmt(m.invoices + m.expenses)}</TableCell>
                      </TableRow>
                    ))}
                    {summary.byMonth.length === 0 && <EmptyRow cols={4} />}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">أكبر الموردين والمستفيدين</CardTitle>
              <CardDescription>أعلى خمسة عشر بقيمة ما دُفع أو استُحقّ لهم في الفترة.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المورد / المستفيد</TableHead>
                    <TableHead>عدد المستندات</TableHead>
                    <TableHead>الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byParty.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="text-sm">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.count}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{fmt(p.total)}</TableCell>
                    </TableRow>
                  ))}
                  {summary.byParty.length === 0 && <EmptyRow cols={3} />}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">التفاصيل</CardTitle>
              <CardDescription>كلّ مستندٍ دخل الأرقام أعلاه ({rows.length}).</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المستند</TableHead>
                    <TableHead>الجهة</TableHead>
                    <TableHead>المورد / المستفيد</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead>المبلغ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 300).map((row) => (
                    <TableRow key={`${row.source_kind}-${row.source_id}`}>
                      <TableCell className="whitespace-nowrap text-xs">{row.doc_date}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={row.source_kind === "invoice" ? "secondary" : "outline"}>
                          {row.source_kind === "invoice" ? "فاتورة مورد" : "مصروف نقدي"}
                        </Badge>
                        <span className="ms-1 font-mono">{row.doc_number ?? ""}</span>
                      </TableCell>
                      <TableCell title={purposeLabel(row.purchase_purpose)}>
                        <PurposeBadge purpose={row.purchase_purpose} />
                      </TableCell>
                      <TableCell className="text-sm">{row.party_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.source_kind === "invoice" ? row.warehouse_name ?? "—" : row.category_name ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{fmt(Number(row.total_amount))}</TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && <EmptyRow cols={6} />}
                </TableBody>
              </Table>
              {rows.length > 300 && (
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  يُعرض أحدث 300 مستند — الإجماليات أعلاه تشمل الكلّ. ضيّق الفترة لرؤية الباقي.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <Card className={strong ? "border-primary/40" : undefined}>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-bold tabular-nums">
          {fmt(value)} <span className="text-xs font-normal">ر.س</span>
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-6 text-center text-sm text-muted-foreground">
        لا إنفاق في هذه الفترة.
      </TableCell>
    </TableRow>
  );
}
