import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useFormRequirements } from "@/components/insurance/FormRequirementsTab";
import { useInsuranceSettings } from "@/lib/insurance-settings";
import type { InsuranceClaimFormType } from "@/lib/database.types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PatientPicker from "@/components/shared/PatientPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import { useToast } from "@/hooks/use-toast";

const FORM_TYPE_LABELS: Record<InsuranceClaimFormType, string> = {
  ucaf: "UCAF — نموذج عام",
  dcaf: "DCAF — نموذج أسنان",
  ocaf: "OCAF — نموذج عيون",
};

function useDoctorsList() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  return useQuery({
    queryKey: ["doctors-enabled", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** قيمة «بلا فاتورة» في قائمة الفواتير — Radix لا يقبل `value=""` كعنصر. */
const NO_INVOICE = "none";

/**
 * فواتير التأمين القابلة للربط بمطالبة يدوية.
 *
 * المُرشِّحات ليست تجميلًا: `is_insurance_invoice` لأن الفاتورة النقدية لا حصّة
 * تأمين فيها، و`is_temporary = false` لأن عرض السعر ليس مستحقًّا على أحد، و
 * `status <> 'void'` لأن الملغاة لا يُطالَب بها. وتُستثنى الفواتير التي لها
 * نموذج مطالبة أصلًا (يُنشئه المحفِّز `app_auto_create_insurance_claim_form`
 * تلقائيًّا لكشفيات التأمين) حتى لا تُطالَب الشركة بنفس الفاتورة مرتين.
 */
function usePatientInsuranceInvoices(
  organizationId: string | undefined,
  patientId: string | undefined,
) {
  return useQuery({
    queryKey: ["claim-linkable-invoices", organizationId, patientId],
    enabled: Boolean(organizationId && patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("id, invoice_number, net_amount, insurance_share_amount, issued_at")
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId)
        .eq("is_insurance_invoice", true)
        .eq("is_temporary", false)
        .neq("status", "void")
        .order("issued_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const invoices = (data ?? []) as {
        id: string;
        invoice_number: number;
        net_amount: number;
        insurance_share_amount: number | null;
        issued_at: string | null;
      }[];
      if (invoices.length === 0) return invoices;

      const { data: claimed, error: claimedError } = await supabase
        .from("insurance_claim_forms")
        .select("sales_invoice_id")
        .eq("organization_id", organizationId)
        .in(
          "sales_invoice_id",
          invoices.map((invoice) => invoice.id),
        );
      if (claimedError) throw claimedError;
      const taken = new Set(
        (claimed ?? [])
          .map((row) => (row as { sales_invoice_id: string | null }).sales_invoice_id)
          .filter((id): id is string => Boolean(id)),
      );
      return invoices.filter((invoice) => !taken.has(invoice.id));
    },
  });
}

function usePatientMemberships(patientId: string | undefined) {
  return useQuery({
    queryKey: ["patient-memberships", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_insurance_memberships")
        .select("id, membership_number, policy:insurance_policies(policy_name, company:insurance_companies(name_ar))")
        .eq("patient_id", patientId)
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });
}

type FormField = { key: string; label: string; value: string };
type ClaimLine = {
  key: string;
  itemId: string | null;
  serviceCode: string;
  description: string;
  qty: string;
  amount: string;
};

/**
 * إنشاء نموذج مطالبة تأمين يدويًا (UCAF/DCAF/OCAF). معظم النماذج تُنشأ تلقائيًا
 * من الـ Trigger الموجود في 0005 عند فوترة كشفية تأمين — هذا النموذج للحالات
 * التي تحتاج نموذج مطالبة مستقل بلا فاتورة كشفية مرتبطة (مثال: إجراء تأميني
 * مباشر). حقول form_data حرة (مفتاح/قيمة) لأن كل نوع نموذج يختلف جوهريًا حسب
 * معايير CCHI، وهذا يطابق نفس فلسفة الفحص الطبي الديناميكي من 0006.
 */
export default function NewClaimFormDialog({
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
  const doctors = useDoctorsList();
  const [formType, setFormType] = useState<InsuranceClaimFormType>("ucaf");
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [membershipId, setMembershipId] = useState("");
  // المفتاح يبدأ بـ`free-` لأن منطق الاحتفاظ بالخانات الحرة يميّزها بذلك —
  // مفتاح "1" كان سيُسقِط خانة كتبها المستخدم بنفسه عند أول تحميل للتعريفات.
  const [fields, setFields] = useState<FormField[]>([{ key: "free-init", label: "", value: "" }]);
  /**
   * الخانات المعرَّفة لهذا النوع من النماذج (0005) — تُنشأ مسبقًا ولا تُحذف.
   * كانت الخانات حرة بالكامل، فكان الموظف يخمّن ما تطلبه شركة التأمين، ويكتشف
   * النقص مع خطاب الرفض بعد أسابيع.
   */
  const requirements = useFormRequirements(organizationId, formType);
  const insuranceSettings = useInsuranceSettings(organizationId);
  const [lines, setLines] = useState<ClaimLine[]>([]);
  const memberships = usePatientMemberships(patient?.id);
  /**
   * الفاتورة المرتبطة والمبلغ المُطالَب.
   *
   * **الخلل الذي يعالجه هذا الحقل**: الإدراج كان يكتب `form_data` و`status`
   * فقط ولا يكتب `insurance_claim_forms.claimed_amount` (والعمود `NULL`able
   * بلا قيمة افتراضية ولا محفِّز يملؤه). فتظهر المطالبة في «سجل المطالبات» وفي
   * «معالجة المطالبات والتحصيل» بمبلغ مُطالَب صفر، ولا تدخل مُرشِّح «معتمَدة ولم
   * تُحصَّل»، ولا تقبلها نافذة «تسجيل تسوية» (تشترط `unsettled_amount > 0`)،
   * واعتمادها يكتب معتمَدًا فارغًا (`app_set_claim_form_status` يضع
   * `approved_amount = coalesce(p_amount, claimed_amount)`). أي أن المال
   * المطلوب من شركة التأمين لا يطالب به أحد ولا يظهر في «لم يُحصَّل بعد».
   */
  const [invoiceId, setInvoiceId] = useState(NO_INVOICE);
  const [manualClaimedAmount, setManualClaimedAmount] = useState("");
  const linkableInvoices = usePatientInsuranceInvoices(organizationId, patient?.id);
  const linkedInvoice = (linkableInvoices.data ?? []).find((invoice) => invoice.id === invoiceId);
  /**
   * المبلغ المُطالَب حين تُختار فاتورة = `sales_invoices.insurance_share_amount`
   * **كما حسبته القاعدة** (0052: الصافي ناقص حصّة المريض، مع سقف الوثيقة) —
   * لا يُعاد حسابه هنا ولا يُجمع من البنود. سبب ذلك أن الشركة لا تستحقّ كامل
   * صافي الفاتورة: نسبة التحمّل على المريض. والمطالبة بالكامل تُرفض أو تُخصَم.
   */
  const invoiceClaimedAmount = linkedInvoice ? Number(linkedInvoice.insurance_share_amount ?? 0) : 0;
  /** مجموع بنود المطالبة — يُستعمل لتعبئة المبلغ اليدوي لا لحسابه ضمنًا. */
  const linesTotal = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  useEffect(() => {
    setMembershipId("");
    // الفاتورة تخصّ مريضًا بعينه: إبقاء الاختيار بعد تغيير المريض كان سيربط
    // مطالبة مريض بفاتورة مريض آخر.
    setInvoiceId(NO_INVOICE);
  }, [patient?.id]);

  /**
   * عند تغيير نوع النموذج تُعاد تعبئة الخانات المعرَّفة له.
   *
   * القيم المُدخَلة في خانة تحمل نفس الاسم تُحفَظ — الموظف الذي كتب "رقم
   * الموافقة" ثم بدّل النوع لا يجب أن يفقد ما كتبه. والخانات الحرة التي
   * أضافها بنفسه تبقى كما هي.
   */
  /**
   * إعادة بناء الخانات من التعريفات — تُستدعى من التأثير أدناه وبعد الحفظ.
   *
   * لماذا دالة لا سطر مكرَّر: بعد الحفظ لا يتغيّر `requirements.data` مرجعيًا
   * (react-query يعيد استعمال نفس الكائن حين لا تتغيّر البيانات)، فالتأثير
   * لا يُعاد تشغيله. تصفير الخانات بلا إعادة بناء كان يترك النموذج الثاني
   * بخانة فارغة واحدة بلا أي خانة معرَّفة — ويستحيل حفظه إن كانت هناك خانة
   * إلزامية، لأن التحقّق يطلب خانة لا وجود لها في النموذج.
   */
  const resetFields = () => {
    const defined = requirements.data ?? [];
    setFields([
      ...defined.map((requirement) => ({
        key: `req-${requirement.id}`,
        label: requirement.field_key,
        value: "",
      })),
      { key: `free-${Date.now()}`, label: "", value: "" },
    ]);
  };

  useEffect(() => {
    // لا يُنتظَر تحميل التعريفات ولا يُتخطّى النوع بلا تعريفات: الخروج المبكر
    // كان يُبقي حقول النوع السابق ظاهرةً وتُحفَظ في `form_data` الخاص بالنوع
    // الجديد — فيصل إلى شركة التأمين نموذج DCAF يحمل خانات UCAF.
    if (requirements.isLoading) return;
    const defined = requirements.data ?? [];
    setFields((prev) => {
      const byLabel = new Map(prev.map((field) => [field.label.trim(), field.value]));
      const fromRequirements: FormField[] = defined.map((requirement) => ({
        key: `req-${requirement.id}`,
        label: requirement.field_key,
        value: byLabel.get(requirement.field_key) ?? "",
      }));
      const definedLabels = new Set(defined.map((requirement) => requirement.field_key));
      /**
       * الخانات الحرة تُحتفَظ بها فقط إن كانت من صنع المستخدم (مفتاحها يبدأ
       * بـ`free-`). الخانة التي جاءت من تعريف النوع السابق (`req-`) تُسقَط:
       * إبقاؤها كـ"خانة حرة" كان يمرّر خانات النوع السابق إلى النموذج الجديد.
       */
      const custom = prev.filter(
        (field) =>
          field.key.startsWith("free-") &&
          field.label.trim() &&
          !definedLabels.has(field.label.trim()),
      );
      return [...fromRequirements, ...custom, { key: `free-${Date.now()}`, label: "", value: "" }];
    });
  }, [requirements.data, formType]);

  /** يُستعمل لمنع حذف خانة إلزامية ولتمييزها في العرض. */
  const requirementByLabel = new Map(
    (requirements.data ?? []).map((requirement) => [requirement.field_key, requirement]),
  );

  // بادئة `free-` إلزامية: منطق الاحتفاظ بالخانات الحرة يميّزها بها، وبدونها
  // كانت الخانة التي يضيفها المستخدم تُحذف عند أول إعادة بناء للحقول.
  const addField = () =>
    setFields((prev) => [...prev, { key: `free-${Date.now()}`, label: "", value: "" }]);
  const updateField = (key: string, patch: Partial<FormField>) =>
    setFields((prev) => prev.map((field) => (field.key === key ? { ...field, ...patch } : field)));
  const removeField = (key: string) => setFields((prev) => prev.filter((field) => field.key !== key));

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { key: `${Date.now()}`, itemId: null, serviceCode: "", description: "", qty: "1", amount: "0" },
    ]);
  const updateLine = (key: string, patch: Partial<ClaimLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));

  const selectItemForLine = (
    key: string,
    item: { id: string; code: string | null; name_ar: string; price: number },
  ) => {
    // `prevent_duplicate_services_in_claim_line` كان يُحفَظ ولا يُنفَّذ. المنع
    // كان مطبَّقًا هنا **بلا شرط**، فالمنشأة التي تعطّله (لخدمات تتكرر بحق،
    // كجلسات متعددة في مطالبة واحدة) لم تكن تستطيع ذلك.
    const duplicate =
      insuranceSettings.data?.prevent_duplicate_services_in_claim_line !== false &&
      lines.some((line) => line.key !== key && line.itemId === item.id);
    if (duplicate) {
      toast({ variant: "destructive", title: "هذه الخدمة مضافة مسبقًا في هذا النموذج" });
      return;
    }
    updateLine(key, {
      itemId: item.id,
      serviceCode: item.code ?? "",
      description: item.name_ar,
      amount: String(item.price ?? 0),
    });
  };

  const createForm = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر مريضًا أولًا");

      /**
       * التحقق من الخانات الإلزامية قبل أي كتابة: نموذج ناقص تَرفضه شركة
       * التأمين، والرفض يكلّف أسابيع. الفحص هنا لا في القاعدة لأن الخانات
       * تُخزَّن في `form_data` jsonb ولا يمكن لقيدٍ أن يعرف ما بداخلها.
       */
      // التحقق يُرفض إن لم تُحمَّل التعريفات بعد أو فشل تحميلها: تخطّيه بصمت
      // يعني حفظ نموذج ناقص برسالة نجاح — وهو الضرر نفسه الذي بُنيت الميزة
      // لمنعه.
      if (requirements.isLoading)
        throw new Error("جارٍ تحميل خانات النموذج — أعد المحاولة بعد لحظة");
      if (requirements.isError)
        throw new Error("تعذّر تحميل خانات النموذج الإلزامية — لا يمكن الحفظ قبل التحقق منها");

      for (const requirement of requirements.data ?? []) {
        if (!requirement.is_required) continue;
        const match = fields.find((field) => field.label.trim() === requirement.field_key);
        const value = (match?.value ?? "").trim();
        if (!value) throw new Error(`الخانة "${requirement.field_key}" إلزامية لهذا النموذج`);
        if (requirement.field_type === "numeric" && !Number.isFinite(Number(value)))
          throw new Error(`الخانة "${requirement.field_key}" يجب أن تكون رقمًا`);
      }

      const formData: Record<string, string> = Object.fromEntries(
        fields.filter((field) => field.label.trim()).map((field) => [field.label.trim(), field.value]),
      );
      /**
       * إصدار قالب CCHI المستخدم يُحفظ داخل `form_data`.
       *
       * `default_ucaf_template` و`default_dcaf_template` كانا يُحفَظان في
       * الإعدادات ولا يُقرآن في أي مسار. وشركة التأمين تردّ النموذج المُقدَّم
       * على إصدار قالب قديم، فحفظ الإصدار مع النموذج يجعل سبب الرفض معلومًا
       * — ولا عمود مخصص له في `insurance_claim_forms`، و`form_data` من نوع
       * jsonb فيتّسع له بلا هجرة.
       */
      const templateVersion =
        formType === "dcaf"
          ? insuranceSettings.data?.default_dcaf_template
          : insuranceSettings.data?.default_ucaf_template;
      if (templateVersion) formData["__template"] = templateVersion;

      /**
       * المبلغ المُطالَب يُحسم **قبل** أي كتابة، ولا يُحفَظ فارغًا في أي حالة:
       * من حصّة التأمين في الفاتورة المرتبطة إن اختيرت فاتورة، ومن إدخال
       * المستخدم إن لم تُختَر. مطالبة بصفر مطالبةٌ لا تُحصَّل أبدًا.
       */
      let claimedAmount: number;
      if (invoiceId !== NO_INVOICE) {
        if (!linkedInvoice)
          throw new Error("الفاتورة المختارة لم تُحمَّل — أعد اختيارها أو حدِّث الصفحة");
        claimedAmount = Number(linkedInvoice.insurance_share_amount ?? 0);
        if (!Number.isFinite(claimedAmount) || claimedAmount <= 0)
          throw new Error(
            "الفاتورة المختارة بلا حصّة تأمين — اختر فاتورة عليها حصّة شركة، أو أزل الربط وأدخل المبلغ يدويًّا",
          );
      } else {
        claimedAmount = Number(manualClaimedAmount);
        if (!Number.isFinite(claimedAmount) || claimedAmount <= 0)
          throw new Error("أدخل المبلغ المُطالَب من شركة التأمين — لا تُحفَظ مطالبة بمبلغ صفر");
      }

      const { data: form, error: formError } = await supabase
        .from("insurance_claim_forms")
        .insert({
          organization_id: organizationId,
          form_type: formType,
          patient_id: patient.id,
          doctor_id: doctorId || null,
          membership_id: membershipId || null,
          sales_invoice_id: invoiceId === NO_INVOICE ? null : invoiceId,
          claimed_amount: claimedAmount,
          form_data: formData,
          status: "draft",
        })
        .select("id")
        .single();
      if (formError) throw formError;

      const validLines = lines.filter((line) => line.description.trim());
      if (validLines.length > 0) {
        // `claimed_amount` على البند إلى جانب `amount`: شاشة بنود المطالبة
        // ومنظورا التسوية يقرآن `ci.claimed_amount` لا `ci.amount`، فكان البند
        // يظهر بمبلغ فارغ حتى وإن كان الرأس صحيحًا — كما يفعل مسار الزيارة
        // `app_create_claim_from_visit` (يكتب العمودين معًا).
        const { error: linesError } = await supabase.from("insurance_claim_form_items").insert(
          validLines.map((line) => ({
            organization_id: organizationId,
            form_id: form.id,
            item_id: line.itemId || null,
            service_code: line.serviceCode.trim() || null,
            description: line.description.trim(),
            qty: Number(line.qty) || 1,
            amount: Number(line.amount) || 0,
            claimed_amount: Number(line.amount) || 0,
          })),
        );
        if (linesError) throw linesError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-claim-forms"] });
      toast({ title: "تم إنشاء نموذج المطالبة" });
      setPatient(null);
      setDoctorId("");
      setMembershipId("");
      setInvoiceId(NO_INVOICE);
      setManualClaimedAmount("");
      // المفتاح يجب أن يبدأ بـ`free-`: منطق إعادة البناء (سطر 130) يميّز
      // الخانات الحرة بهذه البادئة، ومفتاح "1" كان يجعل السطر يبدو خانة
      // معرَّفة قديمة فيُسقَط. والأسوأ أن مصفوفة التعريفات لا تتغيّر مرجعيًا
      // بعد الحفظ (react-query structural sharing)، فلا يُعاد بناء الخانات
      // إطلاقًا — فيبقى النموذج الثاني بخانة فارغة واحدة، ويستحيل حفظه إن
      // كانت هناك خانة إلزامية. `resetFields()` يعيد البناء من التعريفات.
      resetFields();
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء المطالبة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>نموذج مطالبة تأمين جديد</DialogTitle>
          <DialogDescription>
            أغلب النماذج تُنشأ تلقائيًا عند فوترة كشفية تأمين — استخدم هذا للحالات المستقلة فقط.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>نوع النموذج</Label>
            <Select value={formType} onValueChange={(value) => setFormType(value as InsuranceClaimFormType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FORM_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {insuranceSettings.data && (
              <span className="text-xs text-muted-foreground">
                إصدار القالب:{" "}
                {formType === "dcaf"
                  ? insuranceSettings.data.default_dcaf_template
                  : insuranceSettings.data.default_ucaf_template}{" "}
                — يُضبط من إعدادات التأمين ويُحفظ مع النموذج
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر" />
                </SelectTrigger>
                <SelectContent>
                  {(doctors.data ?? []).map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      د. {doctor.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>عضوية التأمين</Label>
              <Select value={membershipId} onValueChange={setMembershipId} disabled={!patient}>
                <SelectTrigger>
                  <SelectValue placeholder={patient ? "اختر الوثيقة" : "اختر مريضًا أولًا"} />
                </SelectTrigger>
                <SelectContent>
                  {(memberships.data ?? []).map((membership: any) => (
                    <SelectItem key={membership.id} value={membership.id}>
                      {membership.policy?.company?.name_ar} — {membership.policy?.policy_name} (#{membership.membership_number})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg border p-3">
            <Label>الفاتورة المرتبطة</Label>
            <Select value={invoiceId} onValueChange={setInvoiceId} disabled={!patient}>
              <SelectTrigger>
                <SelectValue placeholder={patient ? "بلا فاتورة" : "اختر مريضًا أولًا"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_INVOICE}>بلا فاتورة — مطالبة مستقلة</SelectItem>
                {(linkableInvoices.data ?? []).map((invoice) => (
                  <SelectItem key={invoice.id} value={invoice.id}>
                    #{invoice.invoice_number} — حصّة الشركة{" "}
                    {Number(invoice.insurance_share_amount ?? 0).toLocaleString("ar-SA")} ر.س (صافي{" "}
                    {Number(invoice.net_amount ?? 0).toLocaleString("ar-SA")})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {linkableInvoices.isError && (
              <p className="text-xs text-destructive">
                تعذّر تحميل فواتير التأمين:{" "}
                {linkableInvoices.error instanceof Error
                  ? linkableInvoices.error.message
                  : "حدث خطأ غير متوقع"}
              </p>
            )}

            <Label className="mt-2">المبلغ المُطالَب من الشركة *</Label>
            {invoiceId !== NO_INVOICE ? (
              <>
                <Input value={invoiceClaimedAmount.toFixed(2)} readOnly dir="ltr" />
                <p className="text-xs text-muted-foreground">
                  من حصّة التأمين في الفاتورة كما حسبتها القاعدة (الصافي ناقص تحمّل المريض، مع سقف
                  الوثيقة) — لا يُعاد حسابه هنا. قد يخالف مجموع البنود لأن البنود بمبالغها الكاملة
                  وهذا ما تستحقّه الشركة وحدها.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    value={manualClaimedAmount}
                    onChange={(e) => setManualClaimedAmount(e.target.value)}
                    placeholder="0.00"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={linesTotal <= 0}
                    onClick={() => setManualClaimedAmount(String(linesTotal))}
                  >
                    = مجموع البنود
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  إلزاميّ. المطالبة التي تُحفَظ بصفر لا تظهر في «معتمَدة ولم تُحصَّل» ولا تقبل تسوية،
                  فلا يُطالَب بمالها أحد. مجموع البنود الآن {linesTotal.toFixed(2)} ر.س.
                </p>
              </>
            )}
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">حقول النموذج</p>
              <Button size="sm" variant="outline" onClick={addField}>
                <Plus className="h-3.5 w-3.5" />
                إضافة حقل
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {fields.map((field) => {
                const requirement = requirementByLabel.get(field.label.trim());
                const isDefined = Boolean(requirement);
                const missing = requirement?.is_required && !field.value.trim();
                return (
                  <div key={field.key} className="flex items-center gap-2">
                    <Input
                      placeholder="اسم الحقل"
                      value={field.label}
                      onChange={(e) => updateField(field.key, { label: e.target.value })}
                      className="flex-1"
                      // اسم خانة معرَّفة لا يُعدَّل من هنا: تغييره يفكّ ارتباطها
                      // بتعريفها فيسقط التحقق من إلزاميتها بلا أن يلاحظ أحد.
                      readOnly={isDefined}
                    />
                    <Input
                      placeholder={requirement?.is_required ? "إلزامي" : "القيمة"}
                      value={field.value}
                      onChange={(e) => updateField(field.key, { value: e.target.value })}
                      className={`flex-1 ${missing ? "border-destructive" : ""}`}
                      type={requirement?.field_type === "numeric" ? "number" : "text"}
                    />
                    {requirement?.is_required && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        إلزامي
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      // الخانة المعرَّفة لا تُحذف — حذفها يلغي التحقق منها
                      disabled={isDefined}
                      title={isDefined ? "خانة معرَّفة في إعدادات النماذج" : "حذف"}
                      onClick={() => removeField(field.key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">بنود المطالبة (الخدمات)</p>
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" />
                إضافة بند
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              {lines.map((line) => (
                <div key={line.key} className="flex flex-col gap-1.5 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <ItemPicker onSelect={(item) => selectItemForLine(line.key, item)} />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removeLine(line.key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-12 gap-2">
                    <Input
                      placeholder="وصف الخدمة"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      className="col-span-5"
                    />
                    <Input
                      placeholder="كود الخدمة"
                      value={line.serviceCode}
                      onChange={(e) => updateLine(line.key, { serviceCode: e.target.value })}
                      className="col-span-2"
                    />
                    <Input
                      type="number"
                      placeholder="الكمية"
                      value={line.qty}
                      onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                      className="col-span-2"
                    />
                    <Input
                      type="number"
                      placeholder="مبلغ البند"
                      value={line.amount}
                      onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                      className="col-span-3"
                    />
                  </div>
                  {line.itemId && <p className="text-xs text-emerald-700">مرتبط بصنف من الكتالوج</p>}
                </div>
              ))}
              {lines.length === 0 && <p className="text-xs text-muted-foreground">لم تُضف بنود بعد.</p>}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!patient || createForm.isPending} onClick={() => createForm.mutate()}>
            <Save className="h-4 w-4" />
            {createForm.isPending ? "جارٍ الحفظ..." : "حفظ النموذج"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
