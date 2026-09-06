import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Plus, Printer, Sparkles, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  AccountBalanceView,
  AccountType,
  CashRegisterRow,
  ChartOfAccountRow,
  JournalEntryRow,
  TreatmentAgreementWithRelations,
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
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";

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
            {VOUCHER_TYPE_LABELS[type as VoucherType]}: {Number(amount).toLocaleString("ar-SA")} ر.س
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
                    <TableCell>{new Date(v.voucher_date).toLocaleDateString("ar-SA")}</TableCell>
                    <TableCell>{v.payee_name ?? v.description ?? "—"}</TableCell>
                    <TableCell>{v.patient?.name_ar ?? v.distributor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-semibold">{Number(v.amount).toLocaleString("ar-SA")}</TableCell>
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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

function CashRegistersDialog({
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
  const [name, setName] = useState("");
  const [isDoctorCustody, setIsDoctorCustody] = useState(false);
  const [assignedDoctorId, setAssignedDoctorId] = useState("");

  const registers = useQuery({
    queryKey: ["cash-registers", organizationId],
    enabled: Boolean(organizationId) && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("*, doctor:doctors(name_ar)")
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const doctors = useQuery({
    queryKey: ["doctors-select-registers", organizationId],
    enabled: Boolean(organizationId) && open && isDoctorCustody,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const addRegister = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("cash_registers").insert({
        organization_id: organizationId,
        name: name.trim(),
        is_doctor_custody: isDoctorCustody,
        assigned_doctor_id: isDoctorCustody ? assignedDoctorId || null : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-registers", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["cash-registers-select", organizationId] });
      toast({ title: "تمت الإضافة" });
      setName("");
      setIsDoctorCustody(false);
      setAssignedDoctorId("");
    },
  });

  const toggleDisabled = useMutation({
    mutationFn: async (register: CashRegisterRow) => {
      const { data: affectedRows, error } = await supabase
        .from("cash_registers")
        .update({ is_disabled: !register.is_disabled })
        .eq("id", register.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cash-registers", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["cash-registers-select", organizationId] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>صناديق البيع والعهدة</DialogTitle>
          <DialogDescription>مثل "صندوق المجمع" أو "عهدة الدكتور" — تُختار عند تسجيل أي سند</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1.5">
            <Label>اسم الصندوق</Label>
            <Input className="w-40" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDoctorCustody} onChange={(e) => setIsDoctorCustody(e.target.checked)} />
            عهدة طبيب
          </label>
          {isDoctorCustody && (
            <Select value={assignedDoctorId} onValueChange={setAssignedDoctorId}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="الطبيب" />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    د. {d.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" disabled={!name.trim() || addRegister.isPending} onClick={() => addRegister.mutate()}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(registers.data ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.is_doctor_custody ? `عهدة د. ${r.doctor?.name_ar ?? "—"}` : "صندوق عام"}</TableCell>
                <TableCell>
                  <Badge variant={r.is_disabled ? "secondary" : "success"}>{r.is_disabled ? "معطّل" : "نشط"}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => toggleDisabled.mutate(r)}>
                    {r.is_disabled ? "تفعيل" : "تعطيل"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(registers.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  لا توجد صناديق بعد.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// اتفاقيات العلاج (Treatment Agreements) — عقد علاج بعدة بنود وسداد تراكمي عبر
// فواتير مرتبطة بالاتفاقية؛ invoiced_amount/remaining_amount محسوبة من القاعدة
// ---------------------------------------------------------------------------
function useAgreements(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["treatment-agreements", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_agreements")
        .select(
          "id, agreement_number, agreement_date, created_at, vat_amount, total_amount, invoiced_amount, remaining_amount, is_disabled, note, patient:patients(id, name_ar, file_number), doctor:doctors(id, name_ar), clinic:clinics(id, name)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as TreatmentAgreementWithRelations[];
    },
  });
}

function AgreementsTab() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const agreements = useAgreements(organization?.id);

  const toggleAgreement = useMutation({
    mutationFn: async (row: TreatmentAgreementWithRelations) => {
      const { data: affectedRows, error } = await supabase
        .from("treatment_agreements")
        .update({ is_disabled: !row.is_disabled })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["treatment-agreements"] });
      toast({ title: "تم تحديث حالة الاتفاقية" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  /** طباعة الاتفاقية — نافذة مستقلة بتنسيق RTL جاهز للطباعة. */
  const printAgreement = (row: TreatmentAgreementWithRelations) => {
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) {
      toast({
        variant: "destructive",
        title: "تعذر فتح نافذة الطباعة",
        description: "قد يكون المتصفح يمنع النوافذ المنبثقة لهذا الموقع",
      });
      return;
    }
    const money = (value: unknown) => Number(value ?? 0).toLocaleString("ar-SA");
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
      <title>اتفاقية علاج #${row.agreement_number}</title>
      <style>
        body{font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;padding:32px;color:#152f33}
        h1{font-size:20px;margin:0 0 4px}
        .muted{color:#5a6b70;font-size:13px}
        table{width:100%;border-collapse:collapse;margin-top:20px}
        th,td{border:1px solid #d8e3e1;padding:8px;text-align:right;font-size:14px}
        th{background:#f0f6f5}
        .total{font-weight:700}
      </style></head><body>
      <h1>اتفاقية علاج رقم ${row.agreement_number}</h1>
      <p class="muted">${new Date(row.agreement_date).toLocaleDateString("ar-SA")}</p>
      <table>
        <tr><th>المريض</th><td>${row.patient?.name_ar ?? "—"}</td></tr>
        <tr><th>رقم الملف</th><td>${row.patient?.file_number ?? "—"}</td></tr>
        <tr><th>الطبيب</th><td>${row.doctor?.name_ar ?? "—"}</td></tr>
        <tr><th>العيادة</th><td>${row.clinic?.name ?? "—"}</td></tr>
        <tr><th>الضريبة</th><td>${money(row.vat_amount)}</td></tr>
        <tr><th>الإجمالي</th><td class="total">${money(row.total_amount)}</td></tr>
        <tr><th>المفوتر</th><td>${money(row.invoiced_amount)}</td></tr>
        <tr><th>المتبقي</th><td class="total">${money(row.remaining_amount)}</td></tr>
        <tr><th>ملاحظة</th><td>${row.note ?? "—"}</td></tr>
      </table>
      <p class="muted" style="margin-top:40px">توقيع المريض: ..................................</p>
      </body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">عقود علاج متعددة البنود بسداد تراكمي عبر فواتير مرتبطة</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          اتفاقية جديدة
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {agreements.isLoading && <Skeleton className="h-40 w-full" />}
          {!agreements.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#الاتفاقية</TableHead>
                  <TableHead>المريض</TableHead>
                  <TableHead>#الملف</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>العيادة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الضريبة</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>المفوتر</TableHead>
                  <TableHead>المتبقي</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-24">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(agreements.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">#{a.agreement_number}</TableCell>
                    <TableCell>{a.patient?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{a.patient?.file_number ?? "—"}</TableCell>
                    <TableCell>{a.doctor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.clinic?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(a.agreement_date).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {Number(a.vat_amount ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="tabular-nums">{Number(a.total_amount).toLocaleString("ar-SA")}</TableCell>
                    <TableCell>{Number(a.invoiced_amount).toLocaleString("ar-SA")}</TableCell>
                    <TableCell className={Number(a.remaining_amount) > 0 ? "text-rose-600" : ""}>
                      {Number(a.remaining_amount).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate text-sm text-muted-foreground">
                      {a.note ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.is_disabled ? "secondary" : "success"}>{a.is_disabled ? "معطّلة" : "نشطة"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" title="طباعة" onClick={() => printAgreement(a)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={a.is_disabled ? "تفعيل" : "تعطيل"}
                          onClick={() => toggleAgreement.mutate(a)}
                        >
                          {a.is_disabled ? "تفعيل" : "تعطيل"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(agreements.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد اتفاقيات علاج بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewAgreementDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </div>
  );
}

type AgreementLine = {
  key: string;
  item_id: string | null;
  description: string;
  unit_price: number;
  qty: number;
  discount_percent: number;
  /** يُنسَخ من الصنف عند إضافته — الإعفاء خاصية صنف لا خاصية اتفاقية. */
  is_vat_exempt: boolean;
};

function NewAgreementDialog({
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
  const { session, organization } = useOrganizationAccess();
  // نسبة المنشأة لا 15 ثابتة — نفس ما تقرؤه شاشة الفوترة
  const orgVatRate = Number(organization?.default_vat_rate ?? 15);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<AgreementLine[]>([]);
  // الطبيب والعيادة والضريبة تُعرض في قائمة الاتفاقيات وفي نموذج الطباعة،
  // فيجب إدخالها هنا وإلا ظهرت كل اتفاقية جديدة بـ"—" وضريبة صفر.
  const [doctorId, setDoctorId] = useState(NO_COST_CENTER);
  const [clinicId, setClinicId] = useState(NO_COST_CENTER);
  /**
   * الافتراضي **مفعَّل**: شاشة الفوترة تحتسب الضريبة على كل بند غير معفى
   * دائمًا وبلا خانة اختيار. تركُه معطَّلًا افتراضيًا كان يجعل كل اتفاقية
   * جديدة تُنشأ بإجمالي بلا ضريبة ثم تُفوتَر بضريبة، فيتجاوز `invoiced_amount`
   * الإجمالي ويصير المتبقي سالبًا.
   */
  const [applyVat, setApplyVat] = useState(true);

  const agreementDoctors = useQuery({
    queryKey: ["doctors-for-agreement", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const agreementClinics = useQuery({
    queryKey: ["clinics-for-agreement", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const addLine = (item: { id: string; name_ar: string; price: number; is_vat_exempt: boolean }) => {
    setLines((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        item_id: item.id,
        description: item.name_ar,
        unit_price: Number(item.price),
        qty: 1,
        discount_percent: 0,
        is_vat_exempt: Boolean(item.is_vat_exempt),
      },
    ]);
  };
  const updateLine = (key: string, patch: Partial<AgreementLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  /**
   * **إصلاح خلل مالي حقيقي**: الضريبة كانت تُحتسب نسبةً واحدة على رأس
   * الاتفاقية (`subtotal * 0.15`) بينما `treatment_agreement_items.net_amount`
   * يُخزَّن **بلا ضريبة**. ومُحفِّز `app_recalc_agreement_invoiced` (0003)
   * يجمع في `invoiced_amount` نِسَب **فواتير المبيعات** وهي **شاملة الضريبة**.
   *
   * النتيجة على المسار الافتراضي (خانة الضريبة غير مفعّلة): اتفاقية بـ1000
   * تُفوتَر بالكامل فيصير `invoiced_amount = 1150` و`total_amount = 1000`،
   * و`remaining_amount` (عمود محسوب) = **‎-150‎** — يظهر في قائمة الاتفاقيات
   * وفي نموذج الطباعة وفي إجمالي التقارير.
   *
   * الإصلاح: الضريبة تُحتسب **لكل بند** مع احترام إعفاء الصنف، وبنسبة
   * المنشأة لا 15 ثابتة، ويُخزَّن صافي البند **شاملًا الضريبة** ليكون على
   * نفس أساس نِسَب الفواتير التي يجمعها المُحفِّز.
   */
  const computed = lines.map((l) => {
    const subtotal = l.unit_price * l.qty;
    const taxable = subtotal - (subtotal * l.discount_percent) / 100;
    const vat = applyVat && !l.is_vat_exempt ? Math.round(taxable * (orgVatRate / 100) * 100) / 100 : 0;
    return { ...l, taxable, vat, net: taxable + vat };
  });
  const subtotalAmount = computed.reduce((sum, l) => sum + l.taxable, 0);
  const vatAmount = computed.reduce((sum, l) => sum + l.vat, 0);
  const total = computed.reduce((sum, l) => sum + l.net, 0);

  const createAgreement = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!patient) throw new Error("اختر مريضًا");
      if (lines.length === 0) throw new Error("أضف بندًا واحدًا على الأقل");

      const { data: agreement, error: agreementError } = await supabase
        .from("treatment_agreements")
        .insert({
          organization_id: organizationId,
          patient_id: patient.id,
          doctor_id: doctorId === NO_COST_CENTER ? null : doctorId,
          clinic_id: clinicId === NO_COST_CENTER ? null : clinicId,
          total_amount: total,
          vat_amount: vatAmount,
          note: note.trim() || null,
          created_by: session?.user.id ?? null,
        })
        .select("id")
        .single();
      if (agreementError) throw agreementError;

      const itemsPayload = computed.map((l) => ({
        agreement_id: agreement.id,
        item_id: l.item_id,
        description: l.description,
        qty: l.qty,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
        net_amount: l.net,
      }));
      const { error: itemsError } = await supabase.from("treatment_agreement_items").insert(itemsPayload);
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["treatment-agreements"] });
      toast({ title: "تم إنشاء اتفاقية العلاج" });
      setPatient(null);
      setNote("");
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء الاتفاقية",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>اتفاقية علاج جديدة</DialogTitle>
          <DialogDescription>يمكن فوترة بنود الاتفاقية تدريجيًا على أكثر من فاتورة لاحقًا</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(p) => setPatient({ id: p.id, name_ar: p.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>إضافة بند</Label>
            <ItemPicker onSelect={addLine} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-2">
            {computed.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">لم تُضف بنود بعد.</p>}
            {computed.map((line) => (
              <div key={line.key} className="grid grid-cols-12 items-center gap-2 text-sm">
                <span className="col-span-4 truncate">{line.description}</span>
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  value={line.unit_price}
                  onChange={(e) => updateLine(line.key, { unit_price: Number(e.target.value) })}
                />
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })}
                />
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  min={0}
                  max={100}
                  value={line.discount_percent}
                  onChange={(e) => updateLine(line.key, { discount_percent: Number(e.target.value) })}
                  title="نسبة الخصم %"
                />
                <span className="col-span-1 text-end text-xs font-semibold">{line.net.toFixed(2)}</span>
                <Button variant="ghost" size="sm" className="col-span-1" onClick={() => removeLine(line.key)}>
                  حذف
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COST_CENTER}>بدون</SelectItem>
                  {(agreementDoctors.data ?? []).map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>العيادة</Label>
              <Select value={clinicId} onValueChange={setClinicId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COST_CENTER}>بدون</SelectItem>
                  {(agreementClinics.data ?? []).map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyVat}
              onChange={(e) => setApplyVat(e.target.checked)}
              className="h-4 w-4"
            />
            احتساب ضريبة القيمة المضافة ({orgVatRate}%)
          </label>
          {!applyVat && (
            <p className="text-xs text-amber-700">
              الفواتير تُحتسب عليها الضريبة دائمًا — اتفاقية بلا ضريبة سيتجاوز المُفوتَر منها
              إجماليَّها ويظهر المتبقي سالبًا. لا تُعطّلها إلا لمنشأة غير خاضعة للضريبة.
            </p>
          )}

          <div className="flex flex-col items-end gap-1 text-sm">
            <span>الإجمالي الفرعي: {subtotalAmount.toFixed(2)}</span>
            {applyVat && <span>الضريبة: {vatAmount.toFixed(2)}</span>}
            <span className="text-base font-bold">الإجمالي: {total.toFixed(2)} ر.س</span>
          </div>
        </div>

        <DialogFooter>
          <Button disabled={createAgreement.isPending || lines.length === 0} onClick={() => createAgreement.mutate()}>
            <Plus className="h-4 w-4" />
            {createAgreement.isPending ? "جارٍ الحفظ..." : "حفظ الاتفاقية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع (تأكد من عدم تكرار الكود)",
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
            <span>إجمالي المدين: {totalDebit.toLocaleString("ar-SA")}</span>
            <span>إجمالي الدائن: {totalCredit.toLocaleString("ar-SA")}</span>
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
            <span className="text-sm text-muted-foreground">إجمالي المدين: {Number(trialBalance.data.grand_total_debit).toLocaleString("ar-SA")}</span>
            <span className="text-sm text-muted-foreground">إجمالي الدائن: {Number(trialBalance.data.grand_total_credit).toLocaleString("ar-SA")}</span>
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
                      {Number(account.balance).toLocaleString("ar-SA")} ر.س
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
