import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  AccountBalanceView,
  AccountType,
  CashRegisterRow,
  ChartOfAccountRow,
  JournalEntryRow,
  TrialBalanceView,
  VoucherType,
} from "@/lib/database.types";
import LookupSelect from "@/components/shared/LookupSelect";
import PatientPicker from "@/components/shared/PatientPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LedgerWorkspace from "@/components/accounting/LedgerWorkspace";
import AgreementsPanel from "@/components/agreements/AgreementsPanel";
import CashRegistersDialog from "@/components/billing/CashRegistersDialog";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "أصول",
  liability: "خصوم",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

export default function Accounting() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">المحاسبة ودليل الحسابات</h1>
        <p className="text-sm text-muted-foreground">دفتر أستاذ عام بقيود مزدوجة مصاحب — لا يُعدِّل الفوترة أو السندات الموجودة</p>
      </div>

      <Tabs defaultValue="vouchers">
        <TabsList>
          <TabsTrigger value="vouchers">سندات القبض والصرف</TabsTrigger>
          <TabsTrigger value="agreements">اتفاقيات العلاج</TabsTrigger>
          <TabsTrigger value="chart">دليل الحسابات</TabsTrigger>
          <TabsTrigger value="entries">القيود اليومية</TabsTrigger>
          <TabsTrigger value="trial-balance">ميزان المراجعة</TabsTrigger>
          <TabsTrigger value="ledger">دفتر الأستاذ والقوائم</TabsTrigger>
        </TabsList>
        <TabsContent value="vouchers" className="mt-4">
          <VouchersTab />
        </TabsContent>
        <TabsContent value="agreements" className="mt-4">
          <AgreementsTab />
        </TabsContent>
        <TabsContent value="chart" className="mt-4">
          <ChartOfAccountsTab />
        </TabsContent>
        <TabsContent value="entries" className="mt-4">
          <JournalEntriesTab />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <LedgerWorkspace />
        </TabsContent>
        <TabsContent value="trial-balance" className="mt-4">
          <TrialBalanceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// سندات القبض والصرف — شاشة مستقلة (كانت السندات تُنشأ فقط كأثر جانبي داخل
// نافذة "تسجيل دفعة" في شاشة الفوترة، بلا أي شاشة بحث/عرض/إنشاء مباشر لها)
// ---------------------------------------------------------------------------
const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  receipt: "سند قبض",
  expense: "سند صرف",
  salary: "صرف راتب",
  bank_deposit: "إيداع بنكي",
  bank_withdrawal: "سحب بنكي",
  bank_transfer: "تحويل بين حسابات",
};

function useVouchers(organizationId: string | undefined, typeFilter: VoucherType | "all") {
  return useQuery({
    queryKey: ["financial-vouchers", organizationId, typeFilter],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("financial_vouchers")
        .select(
          "id, voucher_number, voucher_type, voucher_date, amount, payee_name, description, patient:patients(name_ar), distributor:distributors(name_ar)",
        )
        .eq("organization_id", organizationId)
        .order("voucher_date", { ascending: false })
        .limit(100);
      if (typeFilter !== "all") query = query.eq("voucher_type", typeFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

function VouchersTab() {
  const { organization } = useOrganizationAccess();
  const [typeFilter, setTypeFilter] = useState<VoucherType | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [registersOpen, setRegistersOpen] = useState(false);
  const vouchers = useVouchers(organization?.id, typeFilter);

  const totals: Record<string, number> = (vouchers.data ?? []).reduce(
    (acc: Record<string, number>, v: any) => {
      acc[v.voucher_type] = (acc[v.voucher_type] ?? 0) + Number(v.amount);
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "receipt", "expense", "salary"] as const).map((t) => (
          <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} onClick={() => setTypeFilter(t)}>
            {t === "all" ? "الكل" : VOUCHER_TYPE_LABELS[t]}
          </Button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setRegistersOpen(true)}>
          صناديق البيع والعهدة
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          سند جديد
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {Object.entries(totals).map(([type, amount]) => (
          <Badge key={type} variant="secondary">
            {VOUCHER_TYPE_LABELS[type as VoucherType]}: {Number(amount).toLocaleString("ar-SA-u-nu-latn")} ر.س
          </Badge>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4">
          {vouchers.isLoading && <Skeleton className="h-40 w-full" />}
          {!vouchers.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#السند</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>البيان / يصرف لـ</TableHead>
                  <TableHead>المريض/المورّد</TableHead>
                  <TableHead>المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(vouchers.data ?? []).map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-xs">#{v.voucher_number}</TableCell>
                    <TableCell>
                      <Badge variant={v.voucher_type === "receipt" ? "success" : "secondary"}>
                        {VOUCHER_TYPE_LABELS[v.voucher_type as VoucherType]}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(v.voucher_date).toLocaleDateString("ar-SA-u-nu-latn")}</TableCell>
                    <TableCell>{v.payee_name ?? v.description ?? "—"}</TableCell>
                    <TableCell>{v.patient?.name_ar ?? v.distributor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-semibold">{Number(v.amount).toLocaleString("ar-SA-u-nu-latn")}</TableCell>
                  </TableRow>
                ))}
                {(vouchers.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد سندات مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewVoucherDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
      <CashRegistersDialog open={registersOpen} onOpenChange={setRegistersOpen} organizationId={organization?.id} />
    </div>
  );
}

/** قيمة "بدون" في قوائم Select (لا تقبل قيمة فارغة). */
const NO_COST_CENTER = "__none__";

function NewVoucherDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization } = useOrganizationAccess();
  // نسبة الضريبة من إعداد المنشأة — نفس ما تقرؤه شاشة الفوترة
  const orgVatRate = Number(organization?.default_vat_rate ?? 15);
  const [voucherType, setVoucherType] = useState<VoucherType>("receipt");
  const [employeeRefId, setEmployeeRefId] = useState("");
  const [amount, setAmount] = useState("");
  const [voucherDate, setVoucherDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cashRegisterId, setCashRegisterId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [description, setDescription] = useState("");
  const [expenseCategoryId, setExpenseCategoryId] = useState("");
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [bankTransferRef, setBankTransferRef] = useState("");
  const [transferToAccountId, setTransferToAccountId] = useState("");
  // حقول سند الصرف التي كانت في الجدول منذ 0003 بلا إدخال في الواجهة
  const [expenseSourceDocument, setExpenseSourceDocument] = useState("");
  const [expenseSourceNumber, setExpenseSourceNumber] = useState("");
  const [requiresVat, setRequiresVat] = useState(false);
  const [supplierTaxNumber, setSupplierTaxNumber] = useState("");
  const [costClinicId, setCostClinicId] = useState("");

  // مطابق تمامًا لشرط ظهور حقول المصروف في النموذج أدناه — سند الراتب لا
  // يحمل مصدر مصروف ولا ضريبة مورد.
  const isExpense = voucherType === "expense";
  const isBankVoucher = voucherType === "bank_deposit" || voucherType === "bank_withdrawal" || voucherType === "bank_transfer";

  const registers = useQuery({
    queryKey: ["cash-registers-select", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("id, name")
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها —
        // بدون هذا الفلتر تختلط بيانات منشأتين لعضوٍ في كلتيهما.
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Pick<CashRegisterRow, "id" | "name">[];
    },
  });

  const resetForm = () => {
    setVoucherType("receipt");
    setEmployeeRefId("");
    setAmount("");
    setVoucherDate(new Date().toISOString().slice(0, 10));
    setCashRegisterId("");
    setPayeeName("");
    setDescription("");
    setExpenseCategoryId("");
    setPatient(null);
    setBankTransferRef("");
    setTransferToAccountId("");
    setExpenseSourceDocument("");
    setExpenseSourceNumber("");
    setRequiresVat(false);
    setSupplierTaxNumber("");
    setCostClinicId("");
  };

  const clinicsList = useQuery({
    queryKey: ["clinics-cost-center", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  /**
   * الموظف إلزامي لسند الراتب: القاعدة تفرض
   * `chk_salary_requires_employee (voucher_type <> 'salary' or employee_ref_id is not null)`
   * — وبلا هذا الحقل كان اختيار "صرف راتب" يفشل دائمًا برسالة قيد خام،
   * أي أن نوع السند كله غير قابل للاستعمال من هذه الشاشة.
   */
  const employees = useQuery({
    queryKey: ["voucher-employees", organizationId],
    enabled: Boolean(organizationId) && voucherType === "salary",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const createVoucher = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (voucherType === "salary" && !employeeRefId)
        throw new Error("اختر الموظف — سند الراتب لا يُحفظ بدونه");
      const { error } = await supabase.from("financial_vouchers").insert({
        organization_id: organizationId,
        voucher_type: voucherType,
        employee_ref_id: voucherType === "salary" ? employeeRefId : null,
        voucher_date: voucherDate,
        amount: Number(amount) || 0,
        cash_register_id: cashRegisterId || null,
        payee_name: payeeName.trim() || null,
        description: description.trim() || null,
        expense_category_value_id: voucherType === "expense" ? expenseCategoryId || null : null,
        patient_id: voucherType === "receipt" ? patient?.id || null : null,
        bank_transfer_ref: isBankVoucher ? bankTransferRef.trim() || null : null,
        transfer_to_account_value_id: isBankVoucher ? transferToAccountId || null : null,
        expense_source_document: isExpense ? expenseSourceDocument.trim() || null : null,
        expense_source_number: isExpense ? expenseSourceNumber.trim() || null : null,
        clinic_id: isExpense ? costClinicId || null : null,
        requires_vat: isExpense ? requiresVat : false,
        // النسبة من إعداد المنشأة لا ثابتة 15: منشأة معفاة تضع 0، ولو تغيّرت
        // النسبة نظاميًا لبقيت المصاريف تُحتسب بالقديمة بينما المبيعات
        // تُحتسب بالجديدة (شاشة الفوترة تقرأ الإعداد فعلًا).
        vat_rate: isExpense && requiresVat ? orgVatRate : null,
        vat_amount: isExpense && requiresVat
          ? Math.round((Number(amount) || 0) * (orgVatRate / 100) * 100) / 100
          : null,
        supplier_tax_number: isExpense && requiresVat ? supplierTaxNumber.trim() || null : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial-vouchers", organizationId] });
      toast({ title: "تم إنشاء السند" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء السند",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>سند جديد</DialogTitle>
          <DialogDescription>سند القبض يُسجَّل غالبًا من شاشة الفوترة عند استلام دفعة — هذه الشاشة لأي سند مستقل</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>نوع السند</Label>
            <Select value={voucherType} onValueChange={(v) => setVoucherType(v as VoucherType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VOUCHER_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التاريخ</Label>
            <Input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المبلغ *</Label>
            <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{isBankVoucher ? "الصندوق/الحساب المصدر" : "الصندوق"}</Label>
            <Select value={cashRegisterId} onValueChange={setCashRegisterId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر صندوقًا" />
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
          {voucherType === "salary" && (
            <div className="flex flex-col gap-1.5">
              <Label>الموظف *</Label>
              <Select value={employeeRefId} onValueChange={setEmployeeRefId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الموظف" />
                </SelectTrigger>
                <SelectContent>
                  {(employees.data ?? []).map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                إلزامي — القاعدة ترفض سند راتب بلا موظف.
              </p>
            </div>
          )}

          {voucherType === "expense" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>يصرف لـ</Label>
                <Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>فئة المصروف</Label>
                <LookupSelect categoryKey="expense_categories" value={expenseCategoryId} onChange={setExpenseCategoryId} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>مصدر المصروف</Label>
                <Input
                  value={expenseSourceDocument}
                  onChange={(e) => setExpenseSourceDocument(e.target.value)}
                  placeholder="فاتورة مورد، عقد، إيصال..."
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>رقم المصدر</Label>
                <Input value={expenseSourceNumber} onChange={(e) => setExpenseSourceNumber(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>مركز التكلفة (العيادة)</Label>
                <Select value={costClinicId || NO_COST_CENTER} onValueChange={(v) => setCostClinicId(v === NO_COST_CENTER ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="بدون" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_COST_CENTER}>بدون</SelectItem>
                    {(clinicsList.data ?? []).map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiresVat}
                    onChange={(e) => setRequiresVat(e.target.checked)}
                    className="h-4 w-4"
                  />
                  {/* النسبة من إعداد المنشأة: كان النصّ «(15%)» والمعاينة
                      `* 0.15` بينما المحفوظ `orgVatRate` — فيقرأ المحاسب على
                      الشاشة رقمًا ويُدخل في إقرار المدخلات رقمًا آخر. */}
                  مصروف خاضع لضريبة القيمة المضافة ({orgVatRate}%)
                </label>
                {requiresVat && (
                  <div className="flex flex-col gap-1.5">
                    <Label>الرقم الضريبي للمورد</Label>
                    <Input
                      value={supplierTaxNumber}
                      onChange={(e) => setSupplierTaxNumber(e.target.value)}
                      dir="ltr"
                    />
                    <p className="text-xs text-muted-foreground">
                      الضريبة المحتسبة:{" "}
                      {(Math.round((Number(amount) || 0) * (orgVatRate / 100) * 100) / 100).toFixed(2)} — الرقم الضريبي شرط
                      لخصم ضريبة المدخلات في الإقرار.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
          {voucherType === "receipt" && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>المريض (اختياري)</Label>
              <PatientPicker onSelect={(p) => setPatient({ id: p.id, name_ar: p.name_ar })} />
              {patient && <p className="text-xs text-muted-foreground">المحدَّد: {patient.name_ar}</p>}
            </div>
          )}
          {isBankVoucher && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>رقم مرجع التحويل</Label>
                <Input value={bankTransferRef} onChange={(e) => setBankTransferRef(e.target.value)} />
              </div>
              {voucherType === "bank_transfer" && (
                <div className="flex flex-col gap-1.5">
                  <Label>الحساب المحوَّل إليه</Label>
                  <LookupSelect categoryKey="bank_accounts" value={transferToAccountId} onChange={setTransferToAccountId} />
                </div>
              )}
            </>
          )}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>البيان</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!amount || createVoucher.isPending} onClick={() => createVoucher.mutate()}>
            {createVoucher.isPending ? "جارٍ الحفظ..." : "حفظ السند"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// اتفاقيات العلاج — لوح الاتفاقيات وعروض أسعارها (0193)
// ---------------------------------------------------------------------------
/*
 * كانت هنا نافذةٌ تُنشئ الاتفاقية ثم بنودها بإدراجين منفصلين من المتصفّح:
 * انقطاعٌ بينهما يترك اتفاقيةً بلا بنود، ولا عرض سعرٍ تتبعه البنود. الآن
 * اللوح نفسه الذي في ملفّ المريض، بكلّ اتفاقيات المنشأة ورشّاحٍ للمريض،
 * والحفظ كلّه في دوالّ القاعدة الذرّية.
 */
function AgreementsTab() {
  const { organization } = useOrganizationAccess();
  return <AgreementsPanel organizationId={organization?.id} />;
}

// ---------------------------------------------------------------------------
// دليل الحسابات
// ---------------------------------------------------------------------------
function useChartOfAccounts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["chart-of-accounts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name_ar, account_type, is_active")
        .eq("organization_id", organizationId)
        .order("code");
      if (error) throw error;
      return (data ?? []) as ChartOfAccountRow[];
    },
  });
}

function ChartOfAccountsTab() {
  const { organization } = useOrganizationAccess();
  const accounts = useChartOfAccounts(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const seedDefaults = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.rpc("app_seed_default_chart_of_accounts", {
        target_organization_id: organization.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts", organization?.id] });
      toast({ title: "تم زرع دليل الحسابات الافتراضي" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الزرع",
        description: errorMessage(error),
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>دليل الحسابات</CardTitle>
          <CardDescription>شجرة الحسابات المستخدمة في القيود اليومية — أصول، خصوم، حقوق ملكية، إيرادات، مصروفات</CardDescription>
        </div>
        <div className="flex gap-2">
          {(accounts.data ?? []).length === 0 && !accounts.isLoading && (
            <Button size="sm" variant="outline" disabled={seedDefaults.isPending} onClick={() => seedDefaults.mutate()}>
              <Sparkles className="h-4 w-4" />
              زرع دليل حسابات افتراضي
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            حساب جديد
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {accounts.isLoading && <Skeleton className="h-40 w-full" />}
        {!accounts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(accounts.data ?? []).map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-mono text-xs">{account.code}</TableCell>
                  <TableCell className="flex items-center gap-2 font-medium">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    {account.name_ar}
                  </TableCell>
                  <TableCell>{ACCOUNT_TYPE_LABELS[account.account_type]}</TableCell>
                  <TableCell>
                    <Badge variant={account.is_active ? "success" : "secondary"}>{account.is_active ? "نشط" : "معطّل"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(accounts.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد حسابات بعد — استخدم "زرع دليل حسابات افتراضي" للبدء بسرعة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewAccountDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewAccountDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("asset");

  const createAccount = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("chart_of_accounts").insert({
        organization_id: organizationId,
        code: code.trim(),
        name_ar: nameAr.trim(),
        account_type: accountType,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts", organizationId] });
      toast({ title: "تم حفظ الحساب" });
      setCode("");
      setNameAr("");
      setAccountType("asset");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error, "حدث خطأ غير متوقع (تأكد من عدم تكرار الكود)"),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>حساب جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الكود *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="1400" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النوع</Label>
            <Select value={accountType} onValueChange={(v) => setAccountType(v as AccountType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!code.trim() || !nameAr.trim() || createAccount.isPending} onClick={() => createAccount.mutate()}>
            {createAccount.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// القيود اليومية
// ---------------------------------------------------------------------------
/**
 * مفتاح هذا الاستعلام يخصّه وحده.
 *
 * كان يتشارك المفتاح `["journal-entries", orgId]` مع استعلام تبويب «دفتر
 * الأستاذ والقوائم» بدالّتَي جلب مختلفتين: هذه تختار ستّة أعمدة بلا بنود،
 * وتلك `"*, journal_entry_lines(...)"`. فالبيانات المخزَّنة من إحداهما تُعرض
 * لحظيًّا في الأخرى — قيمة **0.00** لكل قيد وشارة مصدر خاطئة قبل أن تصحّح
 * نفسها بعد إعادة الجلب.
 */
function useJournalEntries(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["journal-entries-basic", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, entry_number, entry_date, description, status, reference_type")
        .eq("organization_id", organizationId)
        .order("entry_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as JournalEntryRow[];
    },
  });
}

function JournalEntriesTab() {
  const { organization } = useOrganizationAccess();
  const entries = useJournalEntries(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [createOpen, setCreateOpen] = useState(false);

  // بعد الترحيل أو الإنشاء يُبطَّل مفتاحا القيود معًا: الشاشتان تقرآن نفس
  // الجدول بمفتاحين مختلفين، فتبطيل واحدٍ يترك الأخرى تعرض قيمة قديمة.
  const invalidateEntries = () => {
    queryClient.invalidateQueries({ queryKey: ["journal-entries-basic", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["journal-entries-with-lines", organization?.id] });
  };

  const postEntry = useMutation({
    mutationFn: async (entryId: string) => {
      /**
       * الترحيل يمرّ بـ`app_post_journal_entry` لا بتحديث `status` مباشرة.
       *
       * التحديث المباشر يُرحّل القيد **بلا أثرٍ لمن رحّله**: `posted_by` و
       * `posted_at` يبقيان فارغين ولا سجل في `audit_log`، ويتجاوز فحص صلاحية
       * `gl.post` (سياسة RLS تكتفي بدور المحاسب) — فمن مُنع من الترحيل كان
       * يرحّل من هذه الشاشة، وتبويب دفتر الأستاذ يمنعه. الدالّة تفعل الثلاثة.
       */
      const { error } = await supabase.rpc("app_post_journal_entry", { p_entry_id: entryId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateEntries();
      queryClient.invalidateQueries({ queryKey: ["account-balances", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["trial-balance", organization?.id] });
      toast({ title: "تم ترحيل القيد" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الترحيل",
        description: errorMessage(error),
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>القيود اليومية</CardTitle>
          <CardDescription>
            الترحيل (Post) مقصور على صلاحية `gl.post` ويرفضه النظام إن لم يتساوَ إجمالي المدين
            والدائن أو كانت الفترة مقفلة
          </CardDescription>
        </div>
        {/* القيد اليدويّ استثناء له صلاحيته: `app_create_manual_journal_entry`
            ترفضه بلا `gl.manual_entry`، فلا يُعرض الزرّ لمن لا يملكها. */}
        {can("gl.manual_entry") && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            قيد يدويّ
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {entries.isLoading && <Skeleton className="h-40 w-full" />}
        {!entries.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead>المصدر</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entries.data ?? []).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-xs">#{entry.entry_number}</TableCell>
                  <TableCell>{entry.entry_date}</TableCell>
                  <TableCell>{entry.description ?? "—"}</TableCell>
                  <TableCell>
                    {entry.reference_type === "manual" ? (
                      <span className="text-xs text-muted-foreground">يدوي</span>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        تلقائي —{" "}
                        {entry.reference_type === "sales_invoice"
                          ? "فاتورة مبيعات"
                          : entry.reference_type === "purchase_invoice"
                            ? "فاتورة شراء"
                            : entry.reference_type === "financial_voucher"
                              ? "سند"
                              : entry.reference_type}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.status === "posted" ? "success" : entry.status === "void" ? "destructive" : "secondary"}>
                      {entry.status === "posted" ? "مُرحَّل" : entry.status === "void" ? "ملغي" : "مسودة"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {entry.status === "draft" && can("gl.post") && (
                      <Button size="sm" variant="outline" disabled={postEntry.isPending} onClick={() => postEntry.mutate(entry.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        ترحيل
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(entries.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد قيود يومية بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewJournalEntryDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewJournalEntryDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const accounts = useChartOfAccounts(organizationId);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<{ accountId: string; debit: string; credit: string }[]>([
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ]);

  const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const isBalanced = totalDebit > 0 && totalDebit === totalCredit;

  const createEntry = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const validLines = lines.filter((line) => line.accountId && (Number(line.debit) > 0 || Number(line.credit) > 0));
      if (validLines.length < 2) throw new Error("القيد يحتاج سطرين على الأقل");

      /**
       * القيد اليدويّ يمرّ بـ`app_create_manual_journal_entry` لا بإدراجين.
       *
       * الإدراجان (رأس ثم بنود) غير ذرّيَّين: فشل الثاني يترك رأس قيد بلا بنود
       * يستهلك رقمًا من التسلسل ولا يقبل الترحيل أبدًا. والأسوأ أن الرأس كان
       * يُدرَج بلا `is_manual` ولا `manual_reason` ولا فحص `gl.manual_entry`،
       * فيظهر القيد في تبويب دفتر الأستاذ موسومًا **«من عملية»** — قيدًا
       * مولَّدًا من النظام في عين المراجع — وسببه فارغ. الدالّة تفرض السبب
       * والتوازن وحدًّا أدنى بندين والصلاحية في معاملة واحدة.
       */
      const { error } = await supabase.rpc("app_create_manual_journal_entry", {
        p_organization_id: organizationId,
        p_entry_date: entryDate,
        p_description: description.trim() || null,
        p_reason: reason.trim(),
        p_lines: validLines.map((line) => ({
          account_id: line.accountId,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
        })),
        p_branch_id: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entries-basic", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["journal-entries-with-lines", organizationId] });
      toast({ title: "تم حفظ القيد كمسودة — رحّله بعد التأكد من توازنه" });
      setEntryDate(new Date().toISOString().slice(0, 10));
      setDescription("");
      setReason("");
      setLines([
        { accountId: "", debit: "", credit: "" },
        { accountId: "", debit: "", credit: "" },
      ]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>قيد يومية يدويّ</DialogTitle>
          <DialogDescription>
            القاعدة أن تُولَّد القيود من العمليات؛ اليدويّ استثناء يحتاج سببًا مكتوبًا ويُدقَّق.
            يُحفَظ كمسودة، ولن يُقبَل ترحيله إلا إذا تساوى إجمالي المدين والدائن.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>التاريخ *</Label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الوصف</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سبب القيد اليدويّ *</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="لماذا لم يُولَّد هذا القيد من عملية؟"
            />
          </div>

          {lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={line.accountId}
                onValueChange={(v) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, accountId: v } : l)))}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="اختر حسابًا" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.code} — {account.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={0}
                className="w-28"
                placeholder="مدين"
                value={line.debit}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, debit: e.target.value, credit: "" } : l)))}
              />
              <Input
                type="number"
                min={0}
                className="w-28"
                placeholder="دائن"
                value={line.credit}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, credit: e.target.value, debit: "" } : l)))}
              />
              <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="self-start" onClick={() => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "" }])}>
            <Plus className="h-4 w-4" />
            إضافة سطر
          </Button>

          <div className={`flex items-center justify-between rounded-md border p-2 text-sm ${isBalanced ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
            <span>إجمالي المدين: {totalDebit.toLocaleString("ar-SA-u-nu-latn")}</span>
            <span>إجمالي الدائن: {totalCredit.toLocaleString("ar-SA-u-nu-latn")}</span>
            <Badge variant={isBalanced ? "success" : "warning"}>{isBalanced ? "متوازن" : "غير متوازن"}</Badge>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!entryDate || !reason.trim() || !isBalanced || createEntry.isPending}
            onClick={() => createEntry.mutate()}
          >
            {createEntry.isPending ? "جارٍ الحفظ..." : "حفظ كمسودة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ميزان المراجعة
// ---------------------------------------------------------------------------
function useAccountBalances(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["account-balances", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("v_account_balances").select("*").eq("organization_id", organizationId).order("code");
      if (error) throw error;
      return (data ?? []) as AccountBalanceView[];
    },
  });
}

function useTrialBalance(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["trial-balance", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("v_trial_balance").select("*").eq("organization_id", organizationId).maybeSingle();
      if (error) throw error;
      return data as TrialBalanceView | null;
    },
  });
}

function TrialBalanceTab() {
  const { organization } = useOrganizationAccess();
  const balances = useAccountBalances(organization?.id);
  const trialBalance = useTrialBalance(organization?.id);
  const isBalanced =
    trialBalance.data && Number(trialBalance.data.grand_total_debit) === Number(trialBalance.data.grand_total_credit);

  return (
    <div className="flex flex-col gap-4">
      {trialBalance.data && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <span className="text-sm text-muted-foreground">إجمالي المدين: {Number(trialBalance.data.grand_total_debit).toLocaleString("ar-SA-u-nu-latn")}</span>
            <span className="text-sm text-muted-foreground">إجمالي الدائن: {Number(trialBalance.data.grand_total_credit).toLocaleString("ar-SA-u-nu-latn")}</span>
            <Badge variant={isBalanced ? "success" : "destructive"}>{isBalanced ? "الميزان متوازن" : "الميزان غير متوازن!"}</Badge>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>أرصدة الحسابات</CardTitle>
          <CardDescription>من القيود المُرحَّلة (posted) فقط — القيود بحالة مسودة لا تُحسَب</CardDescription>
        </CardHeader>
        <CardContent>
          {balances.isLoading && <Skeleton className="h-40 w-full" />}
          {!balances.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الحساب</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الرصيد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(balances.data ?? []).map((account) => (
                  <TableRow key={account.account_id}>
                    <TableCell className="font-mono text-xs">{account.code}</TableCell>
                    <TableCell>{account.name_ar}</TableCell>
                    <TableCell>{ACCOUNT_TYPE_LABELS[account.account_type]}</TableCell>
                    <TableCell className={Number(account.balance) < 0 ? "text-destructive" : ""}>
                      {Number(account.balance).toLocaleString("ar-SA-u-nu-latn")} ر.س
                    </TableCell>
                  </TableRow>
                ))}
                {(balances.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد حسابات بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
