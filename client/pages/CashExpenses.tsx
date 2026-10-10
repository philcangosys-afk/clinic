import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, RefreshCcw, Wallet } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { errorMessage } from "@/lib/error-message";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import LookupSelect from "@/components/shared/LookupSelect";
import {
  PURCHASE_PURPOSES,
  PurposeBadge,
  PurposeFilterBar,
  PurposePicker,
  matchesPurpose,
  type PurchasePurpose,
  type PurposeFilterValue,
} from "@/components/purchasing/purchase-purpose";

/**
 * المصروفات النقدية — ما يُدفع ولا يدخل المخزون (0177).
 *
 * الإيجار والكهرباء والنظافة والصيانة وقرطاسيةٌ تُستهلك فورًا: لا طلب شراء
 * لها ولا أمر ولا استلام، فإدخالها في دورة الشراء يُلزم الموظّف بخطواتٍ لا
 * معنى لها. تُسجَّل هنا سندَ صرفٍ من الصندوق، بجهتها (الصيدلية، المستلزمات
 * الطبية، الإدارة) ونوع مصروفها والعيادة التي تتحمّله.
 *
 * هو السند نفسه الذي في «الحسابات ← سندات القبض والصرف» بنوع «سند صرف» —
 * يُرحَّل إلى القيود بالقاعدة نفسها ويظهر هناك أيضًا — وهذه الشاشة تعرض
 * المصروفات وحدها بجهتها، وتجمعها في «تقارير المشتريات» مع فواتير الموردين.
 */

type ExpenseRow = {
  id: string;
  voucher_number: number;
  voucher_date: string;
  amount: number;
  vat_amount: number | null;
  payee_name: string | null;
  description: string | null;
  purchase_purpose: string | null;
  expense_source_document: string | null;
  expense_source_number: string | null;
  is_void: boolean;
  void_reason: string | null;
  category: { name_ar: string } | { name_ar: string }[] | null;
  clinic: { name: string } | { name: string }[] | null;
  cash_register: { name: string } | { name: string }[] | null;
};

const one = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("en-CA");
}
function today() {
  return new Date().toLocaleDateString("en-CA");
}

export default function CashExpenses() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [purposeFilter, setPurposeFilter] = useState<PurposeFilterValue>("all");
  const [showVoid, setShowVoid] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseRow | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const expenses = useQuery({
    queryKey: ["cash-expenses", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_vouchers")
        .select(
          "id, voucher_number, voucher_date, amount, vat_amount, payee_name, description, purchase_purpose, expense_source_document, expense_source_number, is_void, void_reason, category:lookup_values!expense_category_value_id(name_ar), clinic:clinics(name), cash_register:cash_registers(name)",
        )
        .eq("organization_id", organization!.id)
        .eq("voucher_type", "expense")
        .gte("voucher_date", from)
        .lte("voucher_date", to)
        .order("voucher_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ExpenseRow[];
    },
  });

  const rows = (expenses.data ?? []).filter(
    (row) => (showVoid || !row.is_void) && matchesPurpose(purposeFilter, row.purchase_purpose),
  );

  const totals = useMemo(() => {
    const active = (expenses.data ?? []).filter((row) => !row.is_void);
    const byPurpose: Record<string, number> = {};
    let all = 0;
    for (const row of active) {
      const key = row.purchase_purpose ?? "unclassified";
      byPurpose[key] = (byPurpose[key] ?? 0) + Number(row.amount ?? 0);
      all += Number(row.amount ?? 0);
    }
    return { byPurpose, all };
  }, [expenses.data]);

  const voidExpense = useMutation({
    mutationFn: async () => {
      if (!voiding) return;
      const { error } = await supabase.rpc("app_void_financial_voucher", {
        p_voucher_id: voiding.id,
        p_reason: voidReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["financial-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["procurement-spend"] });
      toast({ title: "أُلغي المصروف", description: "يبقى ظاهرًا بسبب إلغائه ولا يدخل الإجماليات" });
      setVoiding(null);
      setVoidReason("");
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الإلغاء", description: errorMessage(error) }),
  });

  const fmt = (n: number) => n.toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 2 });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">المشتريات</p>
          <h1 className="text-2xl font-bold">المصروفات النقدية</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            ما يُدفع من الصندوق ولا يدخل المخزون: إيجار، كهرباء، نظافة، صيانة، قرطاسية تُستهلك فورًا.
            ما يُخزَّن ويُصرف لاحقًا يمرّ بطلب الشراء والاستلام لا هنا.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => expenses.refetch()}>
            <RefreshCcw className="h-4 w-4" />
            تحديث
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            مصروف جديد
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label="إجمالي الفترة" value={fmt(totals.all)} />
        {PURCHASE_PURPOSES.map((p) => (
          <SummaryTile key={p.key} label={p.label} value={fmt(totals.byPurpose[p.key] ?? 0)} />
        ))}
      </div>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">من</Label>
              <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">إلى</Label>
              <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Checkbox checked={showVoid} onCheckedChange={(v) => setShowVoid(Boolean(v))} />
              إظهار الملغاة
            </label>
          </div>
          <PurposeFilterBar value={purposeFilter} onChange={setPurposeFilter} />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {expenses.isLoading && <Skeleton className="h-40 w-full" />}
          {expenses.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر التحميل: {errorMessage(expenses.error)}
            </p>
          )}
          {!expenses.isLoading && !expenses.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>السند</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>نوع المصروف</TableHead>
                  <TableHead>يُصرف لـ / البيان</TableHead>
                  <TableHead>العيادة</TableHead>
                  <TableHead>الصندوق</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={row.is_void ? "opacity-60" : undefined}>
                    <TableCell className="font-mono text-xs">
                      #{row.voucher_number}
                      {row.expense_source_number && (
                        <span className="block text-[10px] text-muted-foreground">
                          {row.expense_source_document ?? "مستند"} {row.expense_source_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{row.voucher_date}</TableCell>
                    <TableCell><PurposeBadge purpose={row.purchase_purpose} /></TableCell>
                    <TableCell className="text-sm">{one(row.category)?.name_ar ?? "—"}</TableCell>
                    <TableCell className="max-w-56 text-sm">
                      <span className="block truncate">{row.payee_name ?? "—"}</span>
                      {row.description && (
                        <span className="block truncate text-xs text-muted-foreground">{row.description}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{one(row.clinic)?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{one(row.cash_register)?.name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap font-semibold">
                      {fmt(Number(row.amount))}
                      {Number(row.vat_amount ?? 0) > 0 && (
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          منها ضريبة {fmt(Number(row.vat_amount))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {row.is_void ? (
                        <Badge variant="destructive" title={row.void_reason ?? undefined}>ملغى</Badge>
                      ) : (
                        can("billing.void") && (
                          <Button size="sm" variant="ghost" onClick={() => setVoiding(row)}>
                            <Ban className="h-3.5 w-3.5" />
                            إلغاء
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا مصروفات في هذه الفترة لهذه الجهة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewExpenseDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog open={Boolean(voiding)} onOpenChange={(open) => !open && setVoiding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء المصروف #{voiding?.voucher_number}</DialogTitle>
            <DialogDescription>
              لا يُحذف السند: يبقى ظاهرًا بسبب إلغائه، ويخرج من الإجماليات والتقارير.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>سبب الإلغاء *</Label>
            <Textarea rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!voidReason.trim() || voidExpense.isPending}
              onClick={() => voidExpense.mutate()}
            >
              تأكيد الإلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-bold tabular-nums">{value} <span className="text-xs font-normal">ر.س</span></p>
      </CardContent>
    </Card>
  );
}

const NONE = "__none__";

function NewExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const vatRate = Number(organization?.default_vat_rate ?? 15);

  const [purpose, setPurpose] = useState<PurchasePurpose | "">("");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [payee, setPayee] = useState("");
  const [description, setDescription] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [clinicId, setClinicId] = useState(NONE);
  const [sourceDocument, setSourceDocument] = useState("");
  const [sourceNumber, setSourceNumber] = useState("");
  const [requiresVat, setRequiresVat] = useState(false);
  const [supplierTaxNumber, setSupplierTaxNumber] = useState("");

  const registers = useQuery({
    queryKey: ["cash-registers-select", organization?.id],
    enabled: open && Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("id, name")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const clinics = useQuery({
    queryKey: ["clinics-cost-center", organization?.id],
    enabled: open && Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organization!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const reset = () => {
    setPurpose("");
    setDate(today());
    setAmount("");
    setCategoryId("");
    setPayee("");
    setDescription("");
    setRegisterId("");
    setClinicId(NONE);
    setSourceDocument("");
    setSourceNumber("");
    setRequiresVat(false);
    setSupplierTaxNumber("");
  };

  const value = Number(amount) || 0;
  // المبلغ المدخل هو المدفوع فعلًا شاملًا الضريبة؛ الضريبة تُستخرج منه
  const vatAmount = requiresVat ? Math.round((value * vatRate) / (100 + vatRate) * 100) / 100 : 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      if (!purpose) throw new Error("اختر الجهة التي صُرف لها المبلغ");
      if (value <= 0) throw new Error("أدخل المبلغ");
      if (!categoryId) throw new Error("اختر نوع المصروف");
      if (!registerId) throw new Error("اختر الصندوق الذي صُرف منه");
      const { error } = await supabase.from("financial_vouchers").insert({
        organization_id: organization.id,
        voucher_type: "expense",
        voucher_date: date,
        amount: value,
        purchase_purpose: purpose,
        expense_category_value_id: categoryId,
        payee_name: payee.trim() || null,
        description: description.trim() || null,
        cash_register_id: registerId,
        clinic_id: clinicId === NONE ? null : clinicId,
        expense_source_document: sourceDocument.trim() || null,
        expense_source_number: sourceNumber.trim() || null,
        requires_vat: requiresVat,
        vat_rate: requiresVat ? vatRate : null,
        vat_amount: requiresVat ? vatAmount : null,
        supplier_tax_number: requiresVat ? supplierTaxNumber.trim() || null : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["financial-vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["procurement-spend"] });
      toast({ title: "سُجّل المصروف", description: "ويظهر أيضًا في سندات الصرف بالحسابات" });
      reset();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            مصروف نقدي جديد
          </DialogTitle>
          <DialogDescription>
            سند صرف من الصندوق لما لا يدخل المخزون. يُرحَّل إلى القيود كما يُرحَّل أيّ سند صرف.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <Label>الجهة *</Label>
            <PurposePicker value={purpose} onChange={setPurpose} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>المبلغ المدفوع *</Label>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>التاريخ</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>نوع المصروف *</Label>
              <LookupSelect categoryKey="expense_categories" value={categoryId} onChange={setCategoryId} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الصندوق *</Label>
              <Select value={registerId} onValueChange={setRegisterId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الصندوق" />
                </SelectTrigger>
                <SelectContent>
                  {(registers.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>يُصرف لـ</Label>
              <Input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="الجهة أو الشخص المستلم" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>العيادة التي تتحمّله (اختياري)</Label>
              <Select value={clinicId} onValueChange={setClinicId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>المركز عمومًا</SelectItem>
                  {(clinics.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المستند المصدر</Label>
              <Input value={sourceDocument} onChange={(e) => setSourceDocument(e.target.value)} placeholder="فاتورة كهرباء، إيصال…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم المستند</Label>
              <Input value={sourceNumber} onChange={(e) => setSourceNumber(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البيان</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={requiresVat} onCheckedChange={(v) => setRequiresVat(Boolean(v))} />
            المبلغ يشمل ضريبة قيمة مضافة ({vatRate}%)
          </label>
          {requiresVat && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>الرقم الضريبي للمورد</Label>
                <Input value={supplierTaxNumber} onChange={(e) => setSupplierTaxNumber(e.target.value)} />
              </div>
              <div className="flex flex-col justify-end text-sm text-muted-foreground">
                الضريبة المستخرجة: {vatAmount.toLocaleString("ar-SA-u-nu-latn")} ر.س
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || !purpose || value <= 0 || !categoryId || !registerId} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ…" : "حفظ المصروف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
