import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Settings2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ORG_ROLE_KEYS,
  type DiscountLimitRow,
  type ConsultationFeeSettingsRow,
  type InsuranceSettingsRow,
  type InternalMessagingSettingsRow,
  type OrganizationDiscountSettingsRow,
  type OrganizationVatSettingsRow,
  type PrintSettingsRow,
  type SmsCreditBalanceRow,
} from "@/lib/database.types";

const ROLE_LABELS_AR: Record<string, string> = {
  owner: "المالك",
  organization_admin: "مدير المؤسسة",
  branch_manager: "مدير فرع",
  doctor: "طبيب",
  nurse: "ممرض/ة",
  receptionist: "موظف استقبال",
  pharmacist: "صيدلي",
  lab_technician: "فني مختبر",
  radiology_technician: "فني أشعة",
  accountant: "محاسب",
  hr_manager: "مدير موارد بشرية",
  employee: "موظف",
};

// جميع جداول إعدادات المؤسسة (باستثناء discount_limits) singleton بمفتاح organization_id
// وتُقرأ/تُحدَّث بنفس نمط upsert — هذا الـ hook العام يغطي الجميع بدلًا من تكرار المنطق 7 مرات
function useOrgSettingsRow<T>(
  table: string,
  organizationId: string | undefined,
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: [table, organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data as T | null) ?? null;
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<T>) => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase
        .from(table)
        .upsert({ organization_id: organizationId, ...patch } as Record<string, unknown>);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [table, organizationId] });
      toast({ title: "تم حفظ الإعدادات" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return { query, save };
}

export default function OperationsSettings() {
  const { organization, membership } = useOrganizationAccess();
  const isAdmin = membership?.role_key === "owner" || membership?.role_key === "organization_admin";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">إعدادات التشغيل</h1>
          <p className="text-sm text-muted-foreground">
            إعدادات مستوى المؤسسة — الطباعة، الضريبة، الخصومات، الكشفية، التأمين، والمراسلة الداخلية
          </p>
        </div>
      </div>

      {!isAdmin && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-800">
            يمكنك استعراض هذه الإعدادات، لكن التعديل مقيّد بصفة "المالك" أو "مدير المؤسسة" فقط (مطبَّق فعليًا في قاعدة البيانات عبر RLS، وليس فقط في الواجهة).
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="print" className="flex flex-col gap-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="print">الطباعة</TabsTrigger>
          <TabsTrigger value="vat">الضريبة</TabsTrigger>
          <TabsTrigger value="discounts">الخصومات</TabsTrigger>
          <TabsTrigger value="consultation">الكشفية</TabsTrigger>
          <TabsTrigger value="insurance">التأمين</TabsTrigger>
          <TabsTrigger value="messaging">المراسلة الداخلية</TabsTrigger>
          <TabsTrigger value="sms">رصيد SMS</TabsTrigger>
        </TabsList>

        <TabsContent value="print">
          <PrintSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="vat">
          <VatSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="discounts">
          <DiscountSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="consultation">
          <ConsultationSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="insurance">
          <InsuranceSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="messaging">
          <MessagingSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="sms">
          <SmsSettingsTab organizationId={organization?.id} readOnly={!isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الطباعة
// ---------------------------------------------------------------------------
function PrintSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<PrintSettingsRow>("print_settings", organizationId);
  const [form, setForm] = useState<Partial<PrintSettingsRow>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  const value = { ...defaultPrintSettings, ...form };

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات الطباعة</CardTitle>
        <CardDescription>مقاس الورق لكل نوع مستند، وإظهار الشعار، وملاحظة أسفل المستند</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PaperSizeRow
          label="مقاس طباعة الفاتورة"
          value={value.invoice_paper_size}
          disabled={readOnly}
          onChange={(v) => setForm((f) => ({ ...f, invoice_paper_size: v }))}
        />
        <PaperSizeRow
          label="مقاس طباعة الإيصال"
          value={value.receipt_paper_size}
          disabled={readOnly}
          onChange={(v) => setForm((f) => ({ ...f, receipt_paper_size: v }))}
        />
        <PaperSizeRow
          label="مقاس طباعة التقارير"
          value={value.report_paper_size}
          disabled={readOnly}
          onChange={(v) => setForm((f) => ({ ...f, report_paper_size: v }))}
        />
        <ToggleRow
          label="إظهار الشعار في المستندات المطبوعة"
          checked={value.show_logo}
          disabled={readOnly}
          onChange={(checked) => setForm((f) => ({ ...f, show_logo: checked }))}
        />
        <div className="flex flex-col gap-1.5">
          <Label>ملاحظة أسفل المستند (اختياري)</Label>
          <Input
            value={value.footer_note ?? ""}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, footer_note: e.target.value }))}
            placeholder="مثال: شكرًا لزيارتكم عيادتنا"
          />
        </div>
        {!readOnly && (
          <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
const defaultPrintSettings: PrintSettingsRow = {
  organization_id: "",
  invoice_paper_size: "a4",
  receipt_paper_size: "thermal_80mm",
  report_paper_size: "a4",
  show_logo: true,
  footer_note: null,
  updated_at: "",
};

function PaperSizeRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: "a4" | "thermal_80mm";
  disabled: boolean;
  onChange: (value: "a4" | "thermal_80mm") => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as "a4" | "thermal_80mm")}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a4">A4</SelectItem>
          <SelectItem value="thermal_80mm">رول حراري 80mm</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Button
        type="button"
        size="sm"
        variant={checked ? "default" : "outline"}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        {checked ? "مفعّل" : "معطّل"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الضريبة
// ---------------------------------------------------------------------------
function VatSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<OrganizationVatSettingsRow>("organization_vat_settings", organizationId);
  const [form, setForm] = useState<Partial<OrganizationVatSettingsRow>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  const value = { ...defaultVatSettings, ...form };
  const toggle = (key: keyof OrganizationVatSettingsRow, label: string) => (
    <ToggleRow
      key={key}
      label={label}
      checked={Boolean(value[key])}
      disabled={readOnly}
      onChange={(checked) => setForm((f) => ({ ...f, [key]: checked }))}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات الضريبة (VAT)</CardTitle>
        <CardDescription>تحكّم مركزي في تطبيق الضريبة على المبيعات والمشتريات ومعامل الأسنان والمصاريف المتنوعة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {toggle("sales_vat_enabled", "تفعيل ضريبة المبيعات")}
        {toggle("purchase_vat_enabled", "تفعيل ضريبة المشتريات")}
        {toggle("purchase_vat_editable", "السماح بتعديل نسبة ضريبة المشتريات يدويًا")}
        <Separator />
        {toggle("dental_lab_vat_enabled", "تفعيل ضريبة طلبيات معامل الأسنان")}
        {toggle("dental_lab_vat_editable", "السماح بتعديل نسبة ضريبة معامل الأسنان يدويًا")}
        <Separator />
        {toggle("misc_expenses_vat_enabled", "تفعيل ضريبة المصاريف المتنوعة")}
        {toggle("misc_expenses_require_supplier_tax_number", "إلزامية الرقم الضريبي للمورّد في المصاريف المتنوعة")}
        {toggle("misc_expenses_require_purchase_invoice_number", "إلزامية رقم فاتورة الشراء في المصاريف المتنوعة")}
        <Separator />
        {toggle("print_price_with_vat", "طباعة الأسعار شاملة الضريبة")}
        {toggle("block_invoice_without_nationality_or_id", "منع إصدار الفاتورة بلا جنسية/هوية للمريض")}
        {toggle("vat_exemption_disabled_for_customer_types", "تعطيل إعفاء الضريبة حسب نوع العميل")}
        {toggle("vat_exemption_disabled_for_items", "تعطيل إعفاء الضريبة حسب الصنف")}
        {!readOnly && (
          <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
const defaultVatSettings: OrganizationVatSettingsRow = {
  organization_id: "",
  sales_vat_enabled: true,
  purchase_vat_enabled: true,
  purchase_vat_editable: false,
  dental_lab_vat_enabled: true,
  dental_lab_vat_editable: false,
  misc_expenses_vat_enabled: false,
  misc_expenses_require_supplier_tax_number: false,
  misc_expenses_require_purchase_invoice_number: false,
  print_price_with_vat: true,
  block_invoice_without_nationality_or_id: false,
  vat_exemption_disabled_for_customer_types: false,
  vat_exemption_disabled_for_items: false,
  updated_at: "",
};

// ---------------------------------------------------------------------------
// الخصومات — إعدادات عامة + قائمة حدود الخصم (متعددة الصفوف)
// ---------------------------------------------------------------------------
function DiscountSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<OrganizationDiscountSettingsRow>(
    "organization_discount_settings",
    organizationId,
  );
  const [percent, setPercent] = useState("0");

  useEffect(() => {
    if (query.data) setPercent(String(query.data.general_discount_percent));
  }, [query.data]);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>الخصم العام للمؤسسة</CardTitle>
          <CardDescription>
            يُطبَّق عند عدم وجود خصم مريض افتراضي أو عرض ساري — حسب ترتيب الأولوية الموثّق في النظام
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>نسبة الخصم العام %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              className="w-40"
              value={percent}
              disabled={readOnly}
              onChange={(e) => setPercent(e.target.value)}
            />
          </div>
          {!readOnly && (
            <Button
              disabled={save.isPending}
              onClick={() => save.mutate({ general_discount_percent: Number(percent) || 0 })}
            >
              {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          )}
        </CardContent>
      </Card>

      <DiscountLimitsList organizationId={organizationId} readOnly={readOnly} />
    </div>
  );
}

function useDiscountLimits(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["discount_limits", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discount_limits")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DiscountLimitRow[];
    },
  });
}

function DiscountLimitsList({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const limits = useDiscountLimits(organizationId);
  const [role, setRole] = useState<string>("receptionist");
  const [minPercent, setMinPercent] = useState("0");
  const [maxPercent, setMaxPercent] = useState("10");

  const addLimit = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("discount_limits").insert({
        organization_id: organizationId,
        applies_to_role: role,
        min_percent: Number(minPercent) || 0,
        max_percent: Number(maxPercent) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discount_limits", organizationId] });
      toast({ title: "تمت إضافة حد الخصم" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإضافة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const removeLimit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("discount_limits").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["discount_limits", organizationId] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>حدود الخصم بحسب الصفة الوظيفية</CardTitle>
        <CardDescription>الحد الأقصى/الأدنى لنسبة الخصم الذي يمكن أن يمنحه مستخدم بصفة معينة عند إصدار فاتورة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>الصفة الوظيفية</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORG_ROLE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {ROLE_LABELS_AR[key] ?? key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحد الأدنى %</Label>
              <Input type="number" className="w-28" value={minPercent} onChange={(e) => setMinPercent(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحد الأقصى %</Label>
              <Input type="number" className="w-28" value={maxPercent} onChange={(e) => setMaxPercent(e.target.value)} />
            </div>
            <Button disabled={addLimit.isPending} onClick={() => addLimit.mutate()}>
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        )}

        {limits.isLoading && <Skeleton className="h-24 w-full" />}
        {!limits.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الصفة</TableHead>
                <TableHead>الحد الأدنى %</TableHead>
                <TableHead>الحد الأقصى %</TableHead>
                {!readOnly && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(limits.data ?? []).map((limit) => (
                <TableRow key={limit.id}>
                  <TableCell>{ROLE_LABELS_AR[limit.applies_to_role ?? ""] ?? limit.applies_to_role ?? "—"}</TableCell>
                  <TableCell>{limit.min_percent}%</TableCell>
                  <TableCell>{limit.max_percent}%</TableCell>
                  {!readOnly && (
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => removeLimit.mutate(limit.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {(limits.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد حدود خصم مخصّصة — الخصم غير مقيّد حاليًا لأي صفة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الكشفية
// ---------------------------------------------------------------------------
function ConsultationSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<ConsultationFeeSettingsRow>("consultation_fee_settings", organizationId);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (query.data) setEnabled(query.data.renewal_alert_enabled);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات الكشفية</CardTitle>
        <CardDescription>
          تنبيه "حان وقت تجديد الكشفية" يُحسَب تلقائيًا من تاريخ آخر فاتورة كشفية فعلية لكل مريض — قواعد التخصص والمدة والمراجعات
          المجانية تُدار من شاشة "الأطباء" لكل تخصص
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleRow label="تفعيل تنبيه تجديد الكشفية" checked={enabled} disabled={readOnly} onChange={setEnabled} />
        {!readOnly && (
          <Button
            className="self-start"
            disabled={save.isPending}
            onClick={() => save.mutate({ renewal_alert_enabled: enabled })}
          >
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// التأمين
// ---------------------------------------------------------------------------
function InsuranceSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<InsuranceSettingsRow>("insurance_settings", organizationId);
  const [form, setForm] = useState<Partial<InsuranceSettingsRow>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  const value = { ...defaultInsuranceSettings, ...form };
  const toggle = (key: keyof InsuranceSettingsRow, label: string) => (
    <ToggleRow
      key={key}
      label={label}
      checked={Boolean(value[key])}
      disabled={readOnly}
      onChange={(checked) => setForm((f) => ({ ...f, [key]: checked }))}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات التأمين الطبي</CardTitle>
        <CardDescription>من يتحمل الضريبة، القوالب الافتراضية لنماذج المطالبات، والإشعارات عند تعديل بيانات الطبيب</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <Label>الجهة التي تتحمّل الضريبة</Label>
          <Select
            value={value.vat_responsibility}
            disabled={readOnly}
            onValueChange={(v) => setForm((f) => ({ ...f, vat_responsibility: v as InsuranceSettingsRow["vat_responsibility"] }))}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="patient">المريض</SelectItem>
              <SelectItem value="insurance_company">شركة التأمين</SelectItem>
              <SelectItem value="by_item_category">حسب فئة الصنف</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>قالب UCAF الافتراضي</Label>
            <Input
              value={value.default_ucaf_template}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, default_ucaf_template: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>قالب DCAF الافتراضي</Label>
            <Input
              value={value.default_dcaf_template}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, default_dcaf_template: e.target.value }))}
            />
          </div>
        </div>
        <Separator />
        {toggle("prevent_duplicate_policy_name", "منع تكرار اسم البوليصة لنفس الشركة")}
        {toggle("prevent_duplicate_services_in_claim_line", "منع تكرار نفس الخدمة داخل نموذج المطالبة")}
        {toggle("auto_create_forms_on_consultation_invoice", "إنشاء نموذج مطالبة تلقائيًا عند فوترة كشفية تأمين")}
        {toggle("exclude_offer_discount_invoices_from_auto_create", "استثناء فواتير العروض من الإنشاء التلقائي")}
        {toggle("disable_patient_max_copay_field", "تعطيل حقل الحد الأقصى لمشاركة المريض")}
        {toggle("allow_doctor_edit_radiology_data", "السماح للطبيب بتعديل بيانات الأشعة في النموذج")}
        <Separator />
        {toggle("notify_treating_doctor_on_changes", "إشعار الطبيب المعالج عند أي تعديل على النموذج")}
        {toggle("notify_form_owner_on_changes", "إشعار منشئ النموذج عند أي تعديل")}
        {!readOnly && (
          <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
const defaultInsuranceSettings: InsuranceSettingsRow = {
  organization_id: "",
  vat_responsibility: "patient",
  default_ucaf_template: "UCAF-2",
  default_dcaf_template: "DCAF-2",
  prevent_duplicate_policy_name: true,
  prevent_duplicate_services_in_claim_line: true,
  notify_treating_doctor_on_changes: true,
  notify_form_owner_on_changes: true,
  disable_patient_max_copay_field: false,
  auto_create_forms_on_consultation_invoice: true,
  exclude_offer_discount_invoices_from_auto_create: true,
  allow_doctor_edit_radiology_data: false,
  updated_at: "",
};

// ---------------------------------------------------------------------------
// المراسلة الداخلية
// ---------------------------------------------------------------------------
function MessagingSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<InternalMessagingSettingsRow>("internal_messaging_settings", organizationId);
  const [form, setForm] = useState<Partial<InternalMessagingSettingsRow>>({});

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  const value = { ...defaultMessagingSettings, ...form };

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات المراسلة الداخلية</CardTitle>
        <CardDescription>الشات الداخلي بين فريق العمل، ونطاق الاطلاع والحذف، والإشعارات</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleRow
          label="تفعيل الشات الداخلي"
          checked={value.internal_chat_enabled}
          disabled={readOnly}
          onChange={(checked) => setForm((f) => ({ ...f, internal_chat_enabled: checked }))}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>فترة التحديث (ثانية)</Label>
            <Input
              type="number"
              min={5}
              disabled={readOnly}
              value={value.poll_interval_seconds}
              onChange={(e) => setForm((f) => ({ ...f, poll_interval_seconds: Number(e.target.value) || 15 }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مهلة اعتبار المستخدم "متصلًا" (ثانية)</Label>
            <Input
              type="number"
              min={10}
              disabled={readOnly}
              value={value.online_timeout_seconds}
              onChange={(e) => setForm((f) => ({ ...f, online_timeout_seconds: Number(e.target.value) || 60 }))}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label>من يمكنه الاطلاع على الرسائل</Label>
          <Select
            value={value.view_permission_scope}
            disabled={readOnly}
            onValueChange={(v) => setForm((f) => ({ ...f, view_permission_scope: v as "all" | "own" }))}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="own">رسائله فقط</SelectItem>
              <SelectItem value="all">جميع الرسائل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label>من يمكنه حذف الرسائل</Label>
          <Select
            value={value.delete_permission_scope}
            disabled={readOnly}
            onValueChange={(v) => setForm((f) => ({ ...f, delete_permission_scope: v as "all" | "own" }))}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="own">رسائله فقط</SelectItem>
              <SelectItem value="all">جميع الرسائل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <ToggleRow
          label="تفعيل الإشعارات"
          checked={value.notifications_enabled}
          disabled={readOnly}
          onChange={(checked) => setForm((f) => ({ ...f, notifications_enabled: checked }))}
        />
        <ToggleRow
          label="إشعار حسب الصفة الوظيفية"
          checked={value.notify_by_role}
          disabled={readOnly}
          onChange={(checked) => setForm((f) => ({ ...f, notify_by_role: checked }))}
        />
        {!readOnly && (
          <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate(form)}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
const defaultMessagingSettings: InternalMessagingSettingsRow = {
  organization_id: "",
  internal_chat_enabled: true,
  poll_interval_seconds: 15,
  online_timeout_seconds: 60,
  view_permission_scope: "own",
  delete_permission_scope: "own",
  notifications_enabled: true,
  notify_by_role: true,
  updated_at: "",
};

// ---------------------------------------------------------------------------
// رصيد SMS
// ---------------------------------------------------------------------------
function SmsSettingsTab({ organizationId, readOnly }: { organizationId: string | undefined; readOnly: boolean }) {
  const { query, save } = useOrgSettingsRow<SmsCreditBalanceRow>("sms_credit_balance", organizationId);
  const [threshold, setThreshold] = useState("50");

  useEffect(() => {
    if (query.data) setThreshold(String(query.data.low_balance_alert_threshold));
  }, [query.data]);

  if (query.isLoading) return <SettingsSkeleton />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>رصيد الرسائل النصية (SMS)</CardTitle>
        <CardDescription>الرصيد الحالي للمؤسسة، وحد التنبيه عند انخفاضه — الاستهلاك والتعبئة يتمّان من سجل الحركات فقط</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">الرصيد الحالي:</span>
          <Badge variant={((query.data?.balance ?? 0) <= Number(threshold)) ? "warning" : "secondary"} className="text-base">
            {(query.data?.balance ?? 0).toLocaleString("ar-SA")} رسالة
          </Badge>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>حد التنبيه عند انخفاض الرصيد</Label>
          <Input
            type="number"
            min={0}
            className="w-40"
            disabled={readOnly}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        {!readOnly && (
          <Button
            className="self-start"
            disabled={save.isPending}
            onClick={() => save.mutate({ low_balance_alert_threshold: Number(threshold) || 0 })}
          >
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-6">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
