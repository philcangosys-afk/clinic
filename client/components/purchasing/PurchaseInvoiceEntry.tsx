import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Building2, Eye, PackagePlus, Plus, Search, Trash2, UserPlus, Wallet } from "lucide-react";

import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { errorMessage } from "@/lib/error-message";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PaySupplierDialog } from "@/components/purchasing/PurchaseCycle";
import {
  PurposeBadge, PurposePicker, matchesPurpose, purposeLabel, usePurposeFilter,
  type PurchasePurpose,
} from "@/components/purchasing/purchase-purpose";

/**
 * فاتورة الشراء المباشرة (0228).
 *
 * طلب المالك: «فتح فاتورة شراء، ثمّ إدخال المشتريات ونسبها إلى مستودعٍ تدخل
 * فيه، ثمّ حفظ وتقارير — لا طلب ولا أمر ولا استلام؛ كلّه في نافذةٍ واحدة:
 * تفاصيل الفاتورة مع المورد والأصناف، وتذهب إلى المخزون والمورد».
 *
 * النافذة تجمع كلّ شيء، والحفظ استدعاءٌ واحد لـ`app_save_purchase_invoice`
 * يكتب في معاملةٍ واحدة: الرأس والبنود وتشغيلات المخزون وحركات الوارد، وتصير
 * الفاتورة مستحقّةً للمورد في كشفه، وإن دُفع شيءٌ الآن فسند سدادٍ له. فلا تبقى
 * فاتورةٌ نصفيّة ولا مخزونٌ بلا فاتورة.
 *
 * الإلغاء بسبب لا حذف، وبشرط ألّا يكون عليها سداد ولا صُرف من أصنافها — فتخرج
 * كمّياتها من المخزون.
 */

type Supplier = { id: string; name_ar: string; tax_number: string | null; payment_terms_days: number | null };
type Warehouse = { id: string; name: string; branch_id: string | null; purpose: string | null };
type StockItem = {
  id: string; name_ar: string; code: string | null; barcode: string | null;
  unit: string | null; cost_price: number | null; track_expiry: boolean;
};
type Line = {
  key: string;
  item: StockItem;
  qty: string;
  free_qty: string;
  unit_price: string;
  discount: string;
  vat_rate: string;
  lot_number: string;
  expiry_date: string;
};

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "destructive" | "outline" }> = {
  unpaid: { label: "غير مسدَّدة", variant: "warning" },
  partial: { label: "مسدَّدة جزئيًا", variant: "outline" },
  paid: { label: "مسدَّدة", variant: "success" },
  cancelled: { label: "ملغاة", variant: "destructive" },
};

const todayIso = () => new Date().toLocaleDateString("en-CA");
const monthStartIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("en-CA");
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};
const money = (n: number) =>
  n.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** حساب البند — الصيغة نفسها التي في الدالّة: الأساس = الكمية × السعر − الخصم. */
function lineTotals(line: Line) {
  const gross = round2(num(line.qty) * num(line.unit_price));
  const discount = num(line.discount);
  const base = round2(gross - discount);
  const vat = round2((base * num(line.vat_rate)) / 100);
  return { gross, discount, base, vat, net: round2(base + vat) };
}

/* ── الاستعلامات ─────────────────────────────────────────────────────────── */
function useSuppliers(orgId: string | undefined) {
  return useQuery({
    queryKey: ["pi-suppliers", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name_ar, tax_number, payment_terms_days")
        .eq("organization_id", orgId)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });
}

function useWarehouses(orgId: string | undefined) {
  return useQuery({
    queryKey: ["pi-warehouses", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, branch_id, purpose")
        .eq("organization_id", orgId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Warehouse[];
    },
  });
}

function useStockItems(orgId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["pi-stock-items", orgId],
    enabled: Boolean(orgId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar, code, barcode, unit, cost_price, track_expiry")
        .eq("organization_id", orgId)
        .eq("track_inventory", true)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as StockItem[];
    },
  });
}

function usePaymentOptions(orgId: string | undefined, enabled: boolean) {
  const methods = useQuery({
    queryKey: ["pc-payment-methods", orgId],
    enabled: Boolean(orgId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reference_data")
        .select("value_id, code, name_ar, category_key, is_disabled, organization_id, sort_order")
        .eq("category_key", "payment_methods")
        .eq("is_disabled", false)
        .or(`organization_id.is.null,organization_id.eq.${orgId}`)
        .order("sort_order")
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { value_id: string; code: string | null; name_ar: string }[];
    },
  });
  const registers = useQuery({
    queryKey: ["pc-cash-registers", orgId],
    enabled: Boolean(orgId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("id, name, is_disabled")
        .eq("organization_id", orgId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  return { methods, registers };
}

/* ══════════════════════════════════════════════════════════════════════════
 * قائمة فواتير الشراء
 * ════════════════════════════════════════════════════════════════════════ */
export function PurchaseInvoicesPanel() {
  const { organization } = useOrganizationAccess();
  const orgId = organization?.id;
  const { can } = usePermissions();
  const purposeFilter = usePurposeFilter();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [paying, setPaying] = useState<any | null>(null);

  const invoices = useQuery({
    queryKey: ["purchase-invoices", orgId, from, to],
    enabled: Boolean(orgId),
    queryFn: async () => {
      let query = supabase
        .from("purchase_invoices")
        .select(
          "id, invoice_number, invoice_date, due_date, payment_term, subtotal_amount, vat_amount, net_amount, paid_amount, status, goods_receipt_id, source_document, purchase_purpose, supplier_tax_number, note, cancel_reason, distributor_id, warehouse_id, distributor:distributors(name_ar, tax_number), warehouse:warehouses(name)",
        )
        .eq("organization_id", orgId)
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (from) query = query.gte("invoice_date", from);
      if (to) query = query.lte("invoice_date", to);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...row,
        distributor: Array.isArray(row.distributor) ? row.distributor[0] : row.distributor,
        warehouse: Array.isArray(row.warehouse) ? row.warehouse[0] : row.warehouse,
      })) as any[];
    },
  });

  const term = search.trim().toLowerCase();
  const rows = (invoices.data ?? []).filter((inv) => {
    if (!matchesPurpose(purposeFilter, inv.purchase_purpose)) return false;
    if (!showCancelled && inv.status === "cancelled") return false;
    if (!term) return true;
    return (
      String(inv.invoice_number ?? "").toLowerCase().includes(term) ||
      String(inv.distributor?.name_ar ?? "").toLowerCase().includes(term) ||
      String(inv.warehouse?.name ?? "").toLowerCase().includes(term) ||
      String(inv.supplier_tax_number ?? inv.distributor?.tax_number ?? "").includes(term)
    );
  });
  const active = rows.filter((inv) => inv.status !== "cancelled");
  const totals = active.reduce(
    (acc, inv) => {
      acc.sub += Number(inv.subtotal_amount ?? 0);
      acc.vat += Number(inv.vat_amount ?? 0);
      acc.net += Number(inv.net_amount ?? 0);
      acc.paid += Number(inv.paid_amount ?? 0);
      return acc;
    },
    { sub: 0, vat: 0, net: 0, paid: 0 },
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>فواتير الشراء</CardTitle>
          <CardDescription>
            افتح فاتورة، اختر المورد والمستودع، أدخل الأصناف واحفظ — تدخل الأصناف المستودع وتُسجَّل
            الفاتورة على حساب المورد.
          </CardDescription>
        </div>
        {can("purchasing.invoice") && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            فاتورة شراء جديدة
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم الفاتورة أو المورد أو رقمه الضريبي أو المستودع"
              className="ps-8"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            إظهار الملغاة
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="عدد الفواتير" value={String(active.length)} />
          <Stat label="قبل الضريبة" value={money(totals.sub)} />
          <Stat label="الضريبة" value={money(totals.vat)} />
          <Stat label="الصافي" value={money(totals.net)} strong />
          <Stat label="المتبقّي للموردين" value={money(totals.net - totals.paid)} />
        </div>

        {invoices.isLoading && <Skeleton className="h-40 w-full" />}
        {invoices.isError && (
          <p className="text-sm text-destructive">تعذّر تحميل الفواتير: {errorMessage(invoices.error)}</p>
        )}
        {!invoices.isLoading && !invoices.isError && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الفاتورة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>المستودع</TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>الرقم الضريبي للمورد</TableHead>
                  <TableHead>الضريبة</TableHead>
                  <TableHead>الصافي</TableHead>
                  <TableHead>المسدَّد</TableHead>
                  <TableHead>المتبقّي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((inv) => {
                  const remaining = Number(inv.net_amount ?? 0) - Number(inv.paid_amount ?? 0);
                  const status = STATUS[inv.status ?? "unpaid"] ?? STATUS.unpaid;
                  const canCancel =
                    can("purchasing.invoice") &&
                    inv.status !== "cancelled" &&
                    Number(inv.paid_amount ?? 0) <= 0 &&
                    !inv.goods_receipt_id;
                  const canPay =
                    can("suppliers.pay") && inv.status !== "cancelled" && remaining > 0.009;
                  return (
                    <TableRow key={inv.id} className={inv.status === "cancelled" ? "opacity-60" : undefined}>
                      <TableCell className="font-mono text-xs">{inv.invoice_number ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{inv.invoice_date}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {inv.distributor?.name_ar ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{inv.warehouse?.name ?? "—"}</TableCell>
                      <TableCell><PurposeBadge purpose={inv.purchase_purpose} /></TableCell>
                      <TableCell className="font-mono text-xs">
                        {inv.supplier_tax_number || inv.distributor?.tax_number || (
                          <span className="font-sans text-muted-foreground">بدون رقم ضريبي</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{money(Number(inv.vat_amount ?? 0))}</TableCell>
                      <TableCell className="font-mono text-xs">{money(Number(inv.net_amount ?? 0))}</TableCell>
                      <TableCell className="font-mono text-xs">{money(Number(inv.paid_amount ?? 0))}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {inv.status === "cancelled" ? "—" : money(remaining)}
                      </TableCell>
                      <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setViewing(inv)} title="عرض">
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canPay && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="سداد"
                              onClick={() =>
                                setPaying({
                                  invoiceId: inv.id,
                                  invoiceNumber: inv.invoice_number,
                                  supplierName: inv.distributor?.name_ar,
                                  distributorId: inv.distributor_id,
                                })
                              }
                            >
                              <Wallet className="h-4 w-4" />
                            </Button>
                          )}
                          {canCancel && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              title="إلغاء الفاتورة"
                              onClick={() => setCancelling(inv)}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                      لا فواتير شراء في هذه الفترة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <NewPurchaseInvoiceDialog open={creating} onOpenChange={setCreating} />
      <PurchaseInvoiceDetailsDialog
        invoice={viewing}
        onClose={() => setViewing(null)}
        onCancel={
          viewing &&
          can("purchasing.invoice") &&
          viewing.status !== "cancelled" &&
          Number(viewing.paid_amount ?? 0) <= 0 &&
          !viewing.goods_receipt_id
            ? () => {
                setCancelling(viewing);
                setViewing(null);
              }
            : undefined
        }
      />
      <CancelPurchaseInvoiceDialog invoice={cancelling} onClose={() => setCancelling(null)} />
      <PaySupplierDialog invoice={paying} onClose={() => setPaying(null)} />
    </Card>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={strong ? "font-mono text-base font-bold" : "font-mono text-sm font-semibold"}>{value}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * نافذة فاتورة الشراء — كلّ شيء في نافذةٍ واحدة
 * ════════════════════════════════════════════════════════════════════════ */
function NewPurchaseInvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organization } = useOrganizationAccess();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const suppliers = useSuppliers(open ? orgId : undefined);
  const warehouses = useWarehouses(open ? orgId : undefined);
  const items = useStockItems(orgId, open);
  const { methods, registers } = usePaymentOptions(orgId, open);

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [warehouseId, setWarehouseId] = useState("");
  const [purpose, setPurpose] = useState<PurchasePurpose | "">("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [payNow, setPayNow] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [reference, setReference] = useState("");
  // فاتورة ضريبية (برقم المورد الضريبي) أو بدون ضريبة — يتبع المورد ويُبدَّل يدويًّا
  const [taxed, setTaxed] = useState(false);
  const [taxNo, setTaxNo] = useState("");
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);

  const supplier = (suppliers.data ?? []).find((s) => s.id === supplierId);
  const warehouse = (warehouses.data ?? []).find((w) => w.id === warehouseId);
  const warehousePurpose = warehouse?.purpose && warehouse.purpose !== "general" ? (warehouse.purpose as PurchasePurpose) : null;
  const effectivePurpose = warehousePurpose ?? (purpose || null);
  const defaultVat = taxed ? "15" : "0";
  const needsTaxNo = taxed && Boolean(supplierId) && !supplier?.tax_number;
  const method = (methods.data ?? []).find((m) => m.value_id === methodId);
  const isCash = method?.code === "cash";

  const reset = () => {
    setSupplierId(""); setInvoiceNumber(""); setInvoiceDate(todayIso()); setWarehouseId("");
    setPurpose(""); setNote(""); setLines([]); setItemSearch(""); setPayNow(false);
    setPayAmount(""); setMethodId(""); setRegisterId(""); setReference("");
    setTaxed(false); setTaxNo(""); setSupplierFormOpen(false); setItemFormOpen(false);
  };

  const applyTaxMode = (next: boolean) => {
    setTaxed(next);
    setLines((current) => current.map((l) => ({ ...l, vat_rate: next ? "15" : "0" })));
  };

  const chooseSupplier = (id: string, taxNumber?: string | null) => {
    setSupplierId(id);
    setTaxNo("");
    const next = (suppliers.data ?? []).find((s) => s.id === id);
    // نوع الفاتورة يتبع المورد: مسجَّلٌ ضريبيًّا ← ضريبية 15٪، وإلّا بدون ضريبة. ويُبدَّل يدويًّا.
    applyTaxMode(Boolean(taxNumber ?? next?.tax_number));
  };

  const term = itemSearch.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!term) return [];
    return (items.data ?? [])
      .filter(
        (i) =>
          i.name_ar.toLowerCase().includes(term) ||
          (i.code ?? "").toLowerCase() === term ||
          (i.barcode ?? "").toLowerCase() === term ||
          (i.code ?? "").toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [items.data, term]);

  const addItem = (item: StockItem) => {
    setLines((current) => [
      ...current,
      {
        key: `${item.id}-${Date.now()}-${current.length}`,
        item,
        qty: "1",
        free_qty: "",
        unit_price: item.cost_price ? String(item.cost_price) : "",
        discount: "",
        vat_rate: defaultVat,
        lot_number: "",
        expiry_date: "",
      },
    ]);
    setItemSearch("");
  };

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totals = lines.reduce(
    (acc, line) => {
      const t = lineTotals(line);
      acc.gross += t.gross;
      acc.discount += t.discount;
      acc.vat += t.vat;
      acc.net += t.net;
      return acc;
    },
    { gross: 0, discount: 0, vat: 0, net: 0 },
  );
  const net = round2(totals.net);
  const effectivePay = payNow ? (payAmount.trim() === "" ? net : num(payAmount)) : 0;
  const today = todayIso();

  const problems: string[] = [];
  if (!supplierId) problems.push("اختر المورد");
  if (needsTaxNo && !/^[0-9]{15}$/.test(taxNo.trim()))
    problems.push("اكتب الرقم الضريبي للمورد (15 رقمًا) أو اختر «بدون ضريبة»");
  if (!invoiceNumber.trim()) problems.push("اكتب رقم فاتورة المورد");
  if (!invoiceDate) problems.push("اختر تاريخ الفاتورة");
  else if (invoiceDate > today) problems.push("تاريخ الفاتورة في المستقبل");
  if (!warehouseId) problems.push("اختر المستودع الذي تدخل إليه الأصناف");
  if (lines.length === 0) problems.push("أضف صنفًا واحدًا على الأقل");
  for (const line of lines) {
    const t = lineTotals(line);
    if (num(line.qty) <= 0) problems.push(`كمية «${line.item.name_ar}» يجب أن تكون أكبر من صفر`);
    if (num(line.unit_price) < 0 || num(line.free_qty) < 0 || num(line.discount) < 0)
      problems.push(`قيمٌ سالبة في «${line.item.name_ar}»`);
    if (t.discount > t.gross) problems.push(`خصم «${line.item.name_ar}» أكبر من قيمته`);
    if (line.item.track_expiry && !line.expiry_date) problems.push(`اكتب تاريخ صلاحية «${line.item.name_ar}»`);
    if (line.expiry_date && line.expiry_date <= today) problems.push(`«${line.item.name_ar}» منتهي الصلاحية`);
  }
  if (payNow) {
    if (!can("suppliers.pay")) problems.push("صلاحيتك لا تسمح بالسداد للموردين — احفظها آجلة");
    if (effectivePay <= 0) problems.push("المبلغ المدفوع يجب أن يكون أكبر من صفر");
    if (effectivePay > net + 0.001) problems.push("المبلغ المدفوع أكبر من صافي الفاتورة");
    if (!methodId) problems.push("اختر طريقة الدفع");
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("لا توجد منشأة نشطة");
      if (problems.length > 0) throw new Error(problems[0]);
      const payload = {
        organization_id: orgId,
        warehouse_id: warehouseId,
        distributor_id: supplierId,
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
        purchase_purpose: effectivePurpose,
        supplier_tax_number: needsTaxNo ? taxNo.trim() : null,
        note: note.trim() || null,
        lines: lines.map((l) => ({
          item_id: l.item.id,
          qty: num(l.qty),
          free_qty: num(l.free_qty),
          unit_price: num(l.unit_price),
          discount_amount: num(l.discount),
          vat_rate: num(l.vat_rate),
          lot_number: l.lot_number.trim() || null,
          expiry_date: l.expiry_date || null,
        })),
        payment: payNow
          ? {
              amount: effectivePay,
              payment_method_value_id: methodId,
              // الصندوق للنقدي وحده: تمريره لتحويلٍ بنكيّ يقيّد حركةً على صندوقٍ لم يخرج منه شيء.
              cash_register_id: isCash ? registerId || null : null,
              reference: reference.trim() || null,
            }
          : null,
      };
      const { data, error } = await supabase.rpc("app_save_purchase_invoice", { p_payload: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-balances"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["procurement-spend"] });
      queryClient.invalidateQueries({ queryKey: ["pi-suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["distributors"] });
      // شاشات المخزون بمفاتيحها المختلفة: كلّ مفتاحٍ يذكر المخزون أو التشغيلات
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey.some((k) => typeof k === "string" && /inventory|stock|lots|warehouse-balance/i.test(k)),
      });
      toast({
        title: `حُفظت فاتورة الشراء ${invoiceNumber.trim()}`,
        description: `دخلت ${lines.length} أصناف «${warehouse?.name ?? ""}» — الصافي ${money(net)}${
          effectivePay > 0 ? ` — مدفوع ${money(effectivePay)}` : " — على حساب المورد"
        }`,
      });
      reset();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حفظ الفاتورة", description: errorMessage(error) }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && save.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>فاتورة شراء جديدة</DialogTitle>
          <DialogDescription>
            بيانات الفاتورة والمورد، ثمّ الأصناف، ثمّ الحفظ — تدخل الأصناف المستودع المختار وتُسجَّل على
            حساب المورد.
          </DialogDescription>
        </DialogHeader>

        {/* ── ١) بيانات الفاتورة ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>المورد *</Label>
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                onClick={() => setSupplierFormOpen((o) => !o)}
              >
                <UserPlus className="h-3.5 w-3.5" />
                مورد جديد
              </button>
            </div>
            <Select value={supplierId} onValueChange={(v) => chooseSupplier(v)}>
              <SelectTrigger>
                <SelectValue placeholder={suppliers.isLoading ? "جارٍ التحميل..." : "اختر المورد"} />
              </SelectTrigger>
              <SelectContent>
                {(suppliers.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {supplier && (
              <p className="text-[11px] text-muted-foreground">
                {supplier.tax_number ? `الرقم الضريبي ${supplier.tax_number}` : "بلا رقم ضريبي في بطاقته"}
                {supplier.payment_terms_days ? ` · مهلة السداد ${supplier.payment_terms_days} يومًا` : ""}
              </p>
            )}
            {!suppliers.isLoading && (suppliers.data ?? []).length === 0 && !supplierFormOpen && (
              <p className="text-[11px] text-muted-foreground">لا موردين بعد — اضغط «مورد جديد».</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم فاتورة المورد *</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="كما في فاتورته" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الفاتورة *</Label>
            <Input type="date" value={invoiceDate} max={today} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المستودع الذي تدخل إليه *</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder={warehouses.isLoading ? "جارٍ التحميل..." : "اختر المستودع"} />
              </SelectTrigger>
              <SelectContent>
                {(warehouses.data ?? []).map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                    {w.purpose && w.purpose !== "general" ? ` — ${purposeLabel(w.purpose)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {supplierFormOpen && (
          <QuickSupplierForm
            onCancel={() => setSupplierFormOpen(false)}
            onCreated={(id, taxNumber) => {
              setSupplierFormOpen(false);
              chooseSupplier(id, taxNumber);
            }}
          />
        )}

        {supplierId && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">نوع الفاتورة</Label>
              <div className="flex gap-1 rounded-md border p-1 text-sm" role="radiogroup" aria-label="نوع الفاتورة">
                <button
                  type="button"
                  role="radio"
                  aria-checked={taxed}
                  onClick={() => applyTaxMode(true)}
                  className={`rounded px-3 py-1 ${taxed ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  فاتورة ضريبية (15٪)
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!taxed}
                  onClick={() => applyTaxMode(false)}
                  className={`rounded px-3 py-1 ${!taxed ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  بدون ضريبة — لا رقم ضريبي
                </button>
              </div>
            </div>
            {taxed && supplier?.tax_number && (
              <p className="pb-1.5 text-sm">
                الرقم الضريبي للمورد: <span className="font-mono font-semibold">{supplier.tax_number}</span>
              </p>
            )}
            {needsTaxNo && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">الرقم الضريبي للمورد * (يُحفظ في بطاقته)</Label>
                <Input
                  value={taxNo}
                  onChange={(e) => setTaxNo(e.target.value.replace(/\D/g, "").slice(0, 15))}
                  inputMode="numeric"
                  placeholder="15 رقمًا"
                  className="w-48 font-mono"
                />
              </div>
            )}
          </div>
        )}

        {warehouseId && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">
              جهة الشراء {warehousePurpose ? "(من نوع المستودع)" : "(اختياري — للتقارير)"}
            </Label>
            {warehousePurpose ? (
              <div><PurposeBadge purpose={warehousePurpose} /></div>
            ) : (
              <PurposePicker value={purpose} onChange={(p) => setPurpose(p === purpose ? "" : p)} />
            )}
          </div>
        )}

        {/* ── ٢) الأصناف ── */}
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">الأصناف</p>
            <Button size="sm" variant="outline" onClick={() => setItemFormOpen((o) => !o)}>
              <PackagePlus className="h-4 w-4" />
              صنف جديد
            </Button>
          </div>
          {itemFormOpen && (
            <QuickItemForm
              initialName={itemSearch}
              onCancel={() => setItemFormOpen(false)}
              onCreated={(item) => {
                setItemFormOpen(false);
                addItem(item);
              }}
            />
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches.length > 0) {
                  e.preventDefault();
                  addItem(matches[0]);
                }
              }}
              placeholder={items.isLoading ? "جارٍ تحميل الأصناف..." : "ابحث باسم الصنف أو رمزه أو امسح الباركود ثمّ Enter"}
              className="ps-8"
            />
          </div>
          {term && (
            <div className="flex flex-col divide-y rounded-md border">
              {matches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addItem(item)}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
                >
                  <span className="font-medium">{item.name_ar}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {[item.code, item.unit, item.track_expiry ? "بصلاحية" : null].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
              {matches.length === 0 && !items.isLoading && (
                <p className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  لا صنف يطابق «{itemSearch}».
                  {!itemFormOpen && (
                    <button type="button" className="font-medium text-primary hover:underline"
                            onClick={() => setItemFormOpen(true)}>
                      أنشئه صنفًا جديدًا
                    </button>
                  )}
                </p>
              )}
            </div>
          )}

          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[10rem]">الصنف</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>المجاني</TableHead>
                    <TableHead>سعر الوحدة</TableHead>
                    <TableHead>الخصم</TableHead>
                    <TableHead>الضريبة٪</TableHead>
                    <TableHead>التشغيلة</TableHead>
                    <TableHead>الصلاحية</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const t = lineTotals(line);
                    return (
                      <TableRow key={line.key}>
                        <TableCell className="text-sm font-medium">
                          {line.item.name_ar}
                          {line.item.unit && <span className="block text-[11px] text-muted-foreground">{line.item.unit}</span>}
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} step="any" className="w-20" value={line.qty}
                                 onChange={(e) => updateLine(line.key, { qty: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} step="any" className="w-16" value={line.free_qty} placeholder="0"
                                 onChange={(e) => updateLine(line.key, { free_qty: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} step="0.01" className="w-24" value={line.unit_price} placeholder="0.00"
                                 onChange={(e) => updateLine(line.key, { unit_price: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} step="0.01" className="w-20" value={line.discount} placeholder="0"
                                 onChange={(e) => updateLine(line.key, { discount: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} max={100} step="any" className="w-16" value={line.vat_rate}
                                 disabled={!taxed}
                                 title={taxed ? undefined : "فاتورة بدون ضريبة"}
                                 onChange={(e) => updateLine(line.key, { vat_rate: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input className="w-24" value={line.lot_number} placeholder="اختياري"
                                 onChange={(e) => updateLine(line.key, { lot_number: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input type="date" className="w-36" value={line.expiry_date} min={today}
                                 onChange={(e) => updateLine(line.key, { expiry_date: e.target.value })}
                                 aria-invalid={line.item.track_expiry && !line.expiry_date} />
                          {line.item.track_expiry && !line.expiry_date && (
                            <span className="text-[10px] text-destructive">مطلوبة</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{money(t.net)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="text-destructive" title="حذف السطر"
                                  onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* ── ٣) المجاميع والسداد ── */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
              دُفعت الآن (كلّها أو جزء منها)
            </label>
            {!payNow && (
              <p className="text-xs text-muted-foreground">
                تُحفظ آجلةً على حساب المورد، وتُسدَّد لاحقًا من زرّ السداد في القائمة أو من «الموردون ← الأرصدة والسداد».
              </p>
            )}
            {payNow && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">المبلغ المدفوع</Label>
                  <Input type="number" min={0} step="0.01" value={payAmount} placeholder={money(net)}
                         onChange={(e) => setPayAmount(e.target.value)} />
                  <span className="text-[10px] text-muted-foreground">فارغ = كامل الصافي</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">طريقة الدفع *</Label>
                  <Select value={methodId} onValueChange={setMethodId}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر طريقة الدفع" />
                    </SelectTrigger>
                    <SelectContent>
                      {(methods.data ?? []).map((m) => (
                        <SelectItem key={m.value_id} value={m.value_id}>{m.name_ar}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {isCash && (
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">الصندوق</Label>
                    <Select value={registerId} onValueChange={setRegisterId}>
                      <SelectTrigger>
                        <SelectValue placeholder="الصندوق الذي خرج منه المبلغ" />
                      </SelectTrigger>
                      <SelectContent>
                        {(registers.data ?? []).map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">المرجع</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="رقم الحوالة أو الشيك" />
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">ملاحظة</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
            <Row label="الإجمالي" value={money(round2(totals.gross))} />
            <Row label="الخصم" value={money(round2(totals.discount))} />
            <Row label="قبل الضريبة" value={money(round2(totals.gross - totals.discount))} />
            <Row label="الضريبة" value={money(round2(totals.vat))} />
            <div className="my-1 border-t" />
            <Row label="الصافي" value={money(net)} strong />
            {payNow && (
              <>
                <Row label="المدفوع الآن" value={money(effectivePay)} />
                <Row label="يبقى على حساب المورد" value={money(round2(net - effectivePay))} />
              </>
            )}
          </div>
        </div>

        {problems.length > 0 && lines.length > 0 && (
          <p className="text-xs text-destructive">{problems[0]}</p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          <Button disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ الفاتورة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── مورد جديد من داخل الفاتورة ─────────────────────────────────────────── */
function QuickSupplierForm({
  onCreated, onCancel,
}: { onCreated: (id: string, taxNumber: string | null) => void; onCancel: () => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [mobile, setMobile] = useState("");
  const taxOk = taxNumber === "" || /^[0-9]{15}$/.test(taxNumber);

  const create = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase.rpc("app_quick_create_supplier", {
        p_organization_id: organization.id,
        p_name: name.trim(),
        p_tax_number: taxNumber || null,
        p_mobile: mobile.trim() || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["pi-suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["distributors"] });
      toast({ title: `أُضيف المورد «${name.trim()}»` });
      onCreated(id, taxNumber || null);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر إضافة المورد", description: errorMessage(error) }),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-semibold">مورد جديد</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">اسم المورد *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">الرقم الضريبي (إن وُجد)</Label>
          <Input value={taxNumber} inputMode="numeric" placeholder="15 رقمًا" className="font-mono"
                 onChange={(e) => setTaxNumber(e.target.value.replace(/\D/g, "").slice(0, 15))} />
          {!taxOk && <span className="text-[10px] text-destructive">الرقم الضريبي 15 رقمًا</span>}
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">الجوال</Label>
          <Input value={mobile} inputMode="tel" onChange={(e) => setMobile(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!name.trim() || !taxOk || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "جارٍ الإضافة..." : "إضافة واختيار"}
        </Button>
        <Button size="sm" variant="ghost" disabled={create.isPending} onClick={onCancel}>إلغاء</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">بقيّة بياناته (البنك، مهلة السداد…) تُكمَل لاحقًا من «الموردون».</p>
    </div>
  );
}

/* ── صنف جديد من داخل الفاتورة ─────────────────────────────────────────── */
function QuickItemForm({
  initialName, onCreated, onCancel,
}: { initialName: string; onCreated: (item: StockItem) => void; onCancel: () => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(initialName.trim());
  const [itemType, setItemType] = useState<"product" | "drug">("product");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  const [sale, setSale] = useState("");
  const [trackExpiry, setTrackExpiry] = useState(false);
  const [barcode, setBarcode] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase.rpc("app_quick_create_stock_item", {
        p_organization_id: organization.id,
        p_name: name.trim(),
        p_item_type: itemType,
        p_unit: unit.trim() || null,
        p_cost_price: cost === "" ? null : num(cost),
        p_sale_price: sale === "" ? null : num(sale),
        p_track_expiry: trackExpiry,
        p_barcode: barcode.trim() || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["pi-stock-items"] });
      toast({ title: `أُضيف الصنف «${name.trim()}» وأُدرج في الفاتورة` });
      onCreated({
        id,
        name_ar: name.trim(),
        code: null,
        barcode: barcode.trim() || null,
        unit: unit.trim() || null,
        cost_price: cost === "" ? null : num(cost),
        track_expiry: trackExpiry,
      });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر إضافة الصنف", description: errorMessage(error) }),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-semibold">صنف جديد — يُتابَع مخزونه</p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-1">
          <Label className="text-xs">اسم الصنف *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">النوع</Label>
          <div className="flex gap-1 rounded-md border p-1 text-xs">
            {([["product", "منتج / مستلزم"], ["drug", "دواء"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setItemType(key)}
                      className={`flex-1 rounded px-2 py-1 ${itemType === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">الوحدة</Label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="علبة، حبة، شريط…" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">سعر الشراء</Label>
          <Input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">سعر البيع</Label>
          <Input type="number" min={0} step="0.01" value={sale} onChange={(e) => setSale(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">الباركود</Label>
          <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-xs">
          <input type="checkbox" checked={trackExpiry} onChange={(e) => setTrackExpiry(e.target.checked)} />
          له تاريخ صلاحية
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "جارٍ الإضافة..." : "إضافة وإدراج في الفاتورة"}
        </Button>
        <Button size="sm" variant="ghost" disabled={create.isPending} onClick={onCancel}>إلغاء</Button>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-mono text-base font-bold" : "font-mono"}>{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * تفاصيل الفاتورة
 * ════════════════════════════════════════════════════════════════════════ */
function PurchaseInvoiceDetailsDialog({
  invoice, onClose, onCancel,
}: { invoice: any | null; onClose: () => void; onCancel?: () => void }) {
  const lines = useQuery({
    queryKey: ["purchase-invoice-lines", invoice?.id],
    enabled: Boolean(invoice?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoice_items")
        .select("id, qty, free_qty, purchase_price, line_discount_amount, vat_rate, vat_amount, net_amount, lot_number, expiry_date, item:items(name_ar, unit)")
        .eq("purchase_invoice_id", invoice!.id)
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((row: any) => ({ ...row, item: Array.isArray(row.item) ? row.item[0] : row.item })) as any[];
    },
  });
  const status = invoice ? STATUS[invoice.status ?? "unpaid"] ?? STATUS.unpaid : null;

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            فاتورة شراء {invoice?.invoice_number ?? ""}
            {status && <Badge variant={status.variant}>{status.label}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {invoice?.distributor?.name_ar ?? "—"} · {invoice?.invoice_date} · إلى «{invoice?.warehouse?.name ?? "—"}»
            {invoice?.due_date ? ` · الاستحقاق ${invoice.due_date}` : ""}
            {" · "}
            {invoice?.supplier_tax_number || invoice?.distributor?.tax_number
              ? `الرقم الضريبي للمورد ${invoice.supplier_tax_number || invoice.distributor.tax_number}`
              : "بدون رقم ضريبي"}
          </DialogDescription>
        </DialogHeader>

        {invoice?.status === "cancelled" && invoice.cancel_reason && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            ملغاة — {invoice.cancel_reason}
          </p>
        )}
        {invoice?.note && <p className="text-sm text-muted-foreground">ملاحظة: {invoice.note}</p>}

        {lines.isLoading && <Skeleton className="h-24 w-full" />}
        {!lines.isLoading && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>المجاني</TableHead>
                  <TableHead>السعر</TableHead>
                  <TableHead>الخصم</TableHead>
                  <TableHead>الضريبة</TableHead>
                  <TableHead>التشغيلة</TableHead>
                  <TableHead>الصلاحية</TableHead>
                  <TableHead>الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lines.data ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.item?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{Number(l.qty)}</TableCell>
                    <TableCell className="font-mono text-xs">{Number(l.free_qty ?? 0) || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{money(Number(l.purchase_price ?? 0))}</TableCell>
                    <TableCell className="font-mono text-xs">{money(Number(l.line_discount_amount ?? 0))}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {money(Number(l.vat_amount ?? 0))} <span className="text-muted-foreground">({Number(l.vat_rate ?? 0)}٪)</span>
                    </TableCell>
                    <TableCell className="text-xs">{l.lot_number ?? "—"}</TableCell>
                    <TableCell className="text-xs">{l.expiry_date ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{money(Number(l.net_amount ?? 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {invoice && (
          <div className="ms-auto flex w-full max-w-xs flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
            <Row label="قبل الضريبة" value={money(Number(invoice.subtotal_amount ?? 0))} />
            <Row label="الضريبة" value={money(Number(invoice.vat_amount ?? 0))} />
            <Row label="الصافي" value={money(Number(invoice.net_amount ?? 0))} strong />
            <Row label="المسدَّد" value={money(Number(invoice.paid_amount ?? 0))} />
          </div>
        )}

        <DialogFooter>
          {onCancel && (
            <Button variant="outline" className="text-destructive" onClick={onCancel}>
              <Ban className="h-4 w-4" />
              إلغاء الفاتورة
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * إلغاء الفاتورة — بسبب، ولا حذف
 * ════════════════════════════════════════════════════════════════════════ */
function CancelPurchaseInvoiceDialog({ invoice, onClose }: { invoice: any | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const cancel = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("لا فاتورة محدَّدة");
      if (!reason.trim()) throw new Error("سبب الإلغاء مطلوب");
      const { error } = await supabase.rpc("app_cancel_purchase_invoice", {
        p_invoice_id: invoice.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-balances"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey.some((k) => typeof k === "string" && /inventory|stock|lots|warehouse-balance/i.test(k)),
      });
      toast({ title: `أُلغيت فاتورة الشراء ${invoice?.invoice_number ?? ""}`, description: "خرجت كمّياتها من المخزون." });
      setReason("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الإلغاء", description: errorMessage(error) }),
  });

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(o) => !o && !cancel.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إلغاء فاتورة الشراء {invoice?.invoice_number ?? ""}</DialogTitle>
          <DialogDescription>
            تخرج كمّياتها من المستودع ويُرفع مبلغها عن حساب المورد. لا تُلغى إن كان عليها سداد أو صُرف شيءٌ من
            أصنافها — حينها يُستعمل «مرتجع المشتريات».
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>سبب الإلغاء *</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: أُدخلت بالخطأ" />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={cancel.isPending} onClick={onClose}>رجوع</Button>
          <Button variant="destructive" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending ? "جارٍ الإلغاء..." : "إلغاء الفاتورة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
