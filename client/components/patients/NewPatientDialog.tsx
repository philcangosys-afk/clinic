import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Minimize2, TriangleAlert } from "lucide-react";
import { birthDateFromAge, nameWordCount, transliterateArabicName } from "@/lib/arabic-name";
import { useDirtyDialogClose } from "@/hooks/use-unsaved-guard";
import RequiredLabel, {
  DigitCounter,
  digitsOnly,
  hasDigits,
  requiredInputClass,
} from "@/components/shared/RequiredLabel";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";

const emptyForm = {
  name_ar: "",
  name_en: "",
  mobile_number: "",
  gender: "" as "" | "male" | "female",
  /**
   * العمر بالسنوات والأشهر بدل تاريخ الميلاد.
   *
   * الاستقبال يسأل «كم عمرك؟» ويُجاب برقم، ولا يُطلب من المريض تاريخ ميلاده
   * إلا في الوثائق. وتاريخ الميلاد يبقى هو المخزَّن في القاعدة (كل حساب طبي
   * وتقرير مبنيّ عليه) مشتقًّا من العمر ومَوسومًا أنه تقديريّ.
   */
  age_years: "",
  age_months: "",
  id_number: "",
  passport_number: "",
  nationality_value_id: "",
  profession_value_id: "",
  marital_status: "" as "" | "single" | "married" | "divorced" | "widowed",
  customer_type_value_id: "",
  source_value_id: "",
  educational_qualification_value_id: "",
  work_entity_value_id: "",
  city_value_id: "",
  /** الطبيب المعالج — إلزاميّ عند فتح الملف (قرار المالك 01/10/2026). */
  treating_doctor_id: "",
  address: "",
  emergency_number: "",
  email_1: "",
  blood_type: "",
  guarantor_name: "",
  guarantor_number: "",
  nearest_person_name: "",
  nearest_person_number: "",
  insurance_company_name: "",
  insurance_policy_number: "",
  insurance_membership_number: "",
  default_discount_percent: "0",
  general_note: "",
  is_newborn: false,
};

const MARITAL_STATUS_LABELS_AR: Record<string, string> = {
  single: "أعزب",
  married: "متزوج",
  divorced: "مطلّق",
  widowed: "أرمل",
};

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/**
 * نموذج "مريض جديد" — يغطي الحقول الأساسية والهوية والتأمين والضامن/أقرب شخص
 * عند الإنشاء (استجابةً لمراجعة لقطة 1 المرجعية، التي كشفت عرض ١٢ حقلًا فقط
 * من نحو ٦٠ حقلًا موجودًا في جدول patients). باقي الحقول النادرة الاستخدام
 * (مثل GLN، هوية الأب/الأم، إلخ) تبقى قابلة للاستكمال من ملف المريض بعد فتحه.
 */
export default function NewPatientDialog({
  open,
  onOpenChange,
  minimized,
  onMinimize,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * الملف «مُنزَل» إلى شريط أسفل الشاشة (0241): النافذة تختفي وتبقى بياناتها،
   * فيذهب الموظّف إلى شاشةٍ أخرى ويعود فيكمل. تديره `PatientDockProvider`.
   */
  minimized?: boolean;
  onMinimize?: () => void;
}) {
  const { organization } = useOrganizationAccess();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  /** تحذير الجهة المحجوبة المعروض قبل الحفظ (null = لا تطابق). */
  const [blockWarning, setBlockWarning] = useState<string | null>(null);
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);
  /**
   * ملفات قد تكون لنفس الشخص (0066).
   *
   * تُعرَض ولا تمنع: توأمان بنفس الاسم وتاريخ الميلاد واقع، وأمٌّ تُسجّل
   * رضيعها برقم جوالها واقع أشيع. المنع التلقائي كان سيمنع حالات صحيحة
   * ويُعلّم الموظف تجاوز التحذير بأي حيلة.
   */
  const [duplicates, setDuplicates] = useState<
    { patient_id: string; name_ar: string; file_number: string | null; mobile_number: string | null; match_reason: string; match_score: number }[]
  >([]);

  /**
   * الملف القائم بنفس رقم الهوية — يمنع الحفظ ولا يُنبِّه فقط.
   *
   * التكرار في رقم الهوية ليس «قد يكون نفس الشخص»: هو **هو** نفس الشخص،
   * وملفّان له يشطران تاريخه الطبي والمالي فلا يرى الطبيب إلا نصفه. القاعدة
   * ترفضه بمُحفِّز، وهذا الفحص يُظهر الملف القائم أثناء الكتابة ليُفتح بدل
   * أن يُكتب الملف كله ثم يُرفض عند الحفظ.
   */
  const [existingIdFile, setExistingIdFile] = useState<
    { patient_id: string; name_ar: string; file_number: number } | null
  >(null);

  /**
   * هل كُتب الاسم الإنجليزي بيد الموظف؟ إن كُتب فلا يُلمَس.
   *
   * الترجمة اقتراح لا قرار: الكتابة فوق ما صحّحه الموظف بيده أسوأ من عدم
   * الاقتراح أصلًا، لأنها تُبطل تصحيحه بلا أن يلاحظ.
   */
  const nameEnTouched = useRef(false);

  /** الأطباء المفعّلون فقط — كقائمة الطبيب المعالج في ملف المريض. */
  const doctors = useQuery({
    queryKey: ["doctors-for-patient", organization?.id],
    enabled: open && Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const set = <K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** الاسم العربي يُقترح مقابله الإنجليزي ما لم يكتبه الموظف بنفسه. */
  const setNameAr = (value: string) =>
    setForm((prev) => ({
      ...prev,
      name_ar: value,
      name_en: nameEnTouched.current ? prev.name_en : transliterateArabicName(value),
    }));

  const missing = {
    name_ar: !form.name_ar.trim(),
    /**
     * الطول شرطٌ لا الوجود: رقم هوية بتسع خانات أسوأ من غيابه — يمرّ في
     * الملفّ ويُرفض في المطالبة التأمينية بعد شهر. والقاعدة ترفضه كذلك
     * (0147)، فالمنع هنا يُظهر السبب قبل الحفظ لا بعده.
     *
     * المولود الجديد مستثنى من الهوية: طلبها منه يمنع تسجيله أصلًا.
     */
    id_number: !form.is_newborn && !hasDigits(form.id_number),
    mobile_number: !hasDigits(form.mobile_number),
    age: !form.age_years.trim() && !form.age_months.trim(),
    nationality_value_id: !form.nationality_value_id,
    treating_doctor_id: !form.treating_doctor_id,
  };
  const missingCount = Object.values(missing).filter(Boolean).length;
  const nameIsShort = !missing.name_ar && nameWordCount(form.name_ar) < 4;

  /**
   * أيّ حقل مكتوب يعني «عمل غير محفوظ» — فالإغلاق يُسأل عنه.
   *
   * `is_newborn` مستثنى: قيمته `false` في النموذج الفارغ، ومقارنته المباشرة
   * تجعل النموذج «متغيَّرًا» بمجرّد فتحه لو تغيّر افتراضه لاحقًا.
   */
  const isDirty = (Object.keys(emptyForm) as (keyof typeof emptyForm)[]).some((key) =>
    key === "is_newborn" || key === "default_discount_percent"
      ? form[key] !== emptyForm[key]
      : String(form[key] ?? "").trim() !== "",
  );
  const guardedOpenChange = useDirtyDialogClose(isDirty, onOpenChange);

  /**
   * فحص رقم الهوية بعد توقّف الكتابة لا مع كل حرف: استعلام لكل ضغطة مفتاح
   * هدرٌ، ورسالة تظهر وتختفي أثناء الكتابة لا تُقرأ.
   */
  useEffect(() => {
    const idNumber = form.id_number.trim();
    if (!organization?.id || idNumber.length < 5) {
      setExistingIdFile(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const { data, error } = await supabase.rpc("app_patient_by_id_number", {
          p_organization_id: organization.id,
          p_id_number: idNumber,
          p_exclude_patient_id: null,
        });
        if (cancelled) return;
        // فشل الفحص لا يعطّل الاستقبال — المُحفِّز في القاعدة يبقى المانع الأخير
        if (error) {
          setExistingIdFile(null);
          return;
        }
        const row = (data ?? []).find((item: { is_merged: boolean }) => !item.is_merged);
        setExistingIdFile(row ?? null);
      })();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.id_number, organization?.id]);

  /**
   * فحص قائمة الجهات المحجوبة (لقطة 42، المستوى الأول) بمطابقة الجوال أو
   * الهوية. التحقق يتم عند الحفظ لا أثناء الكتابة، لتفادي استعلام مع كل حرف.
   *
   * التنبيه لا يمنع الإنشاء: القرار للموظف حسب سياسة المنشأة، لكن يجب أن
   * يراه قبل أن يفتح الملف لا بعده.
   */
  const checkBlockedContact = async () => {
    if (!organization?.id) return null;
    const mobile = form.mobile_number.trim();
    const idNumber = form.id_number.trim();
    const name = form.name_ar.trim();
    if (!mobile && !idNumber && !name) return null;

    const conditions: string[] = [];
    if (mobile) conditions.push(`mobile_number.eq.${mobile}`);
    if (idNumber) conditions.push(`id_number.eq.${idNumber}`);
    /**
     * المطابقة بالاسم كانت غائبة رغم أن شاشة الحجب تسمح بسجل بالاسم وحده
     * وتَعِد بالتنبيه عليه — فكان سجل الاسم-فقط ميتًا لا يُطابق شيئًا أبدًا.
     *
     * تُستعمل `ilike` لا `eq`: الأسماء العربية تُكتب بفروق طفيفة (مسافة
     * زائدة، "عبدالله" مقابل "عبد الله")، والمطابقة الحرفية كانت ستفوّت
     * معظم الحالات. الفواصل والفواصل المنقوطة تُزال لأنها تكسر صياغة `.or`.
     */
    const safeName = name.replace(/[,()]/g, " ").trim();
    if (safeName) conditions.push(`full_name.ilike.%${safeName}%`);

    /**
     * القراءة من العرض `v_blocked_contacts` بشرط `is_in_effect` لا من الجدول
     * مباشرةً: الاستعلام القديم كان يطابق **أي** سجل حظر بلا `is_active` ولا
     * `starts_at` ولا `ends_at`، فحظرٌ رُفع قبل سنة أو انقضت مدّته كان يُطلق
     * لافتة حمراء توقف الحفظ — تحذير عن حالة لم تعد قائمة، وتكراره يُعلّم
     * الموظف تخطّي كل تحذيرات الحجب. و`block_type` يُقيَّد بما يمنع فتح
     * الملف والحجز: حظر الرسائل وحده لا يمنع علاج المريض.
     */
    const { data, error } = await supabase
      .from("v_blocked_contacts")
      .select("full_name, reason")
      .eq("organization_id", organization.id)
      .eq("is_in_effect", true)
      .in("block_type", ["booking", "all"])
      .or(conditions.join(","))
      .limit(1);
    // فشل الفحص لا يعطّل تسجيل المريض — الاستقبال لا يتوقف بسبب استعلام تحذيري
    if (error) return null;
    const match = data?.[0];
    if (match)
      return match.reason?.trim()
        ? `${match.full_name ?? "هذه الجهة"} محجوبة: ${match.reason}`
        : `${match.full_name ?? "هذه الجهة"} مدرجة ضمن الجهات المحجوبة`;

    /**
     * المطابقة أعلاه حرفية بـ`eq`، بينما القاعدة تطابق الجوال بعد تطبيعه
     * (`app_normalize_mobile`) — فحظر «0501234567» لا يُطابق «+966501234567»
     * ويمرّ بلا تحذير ثم يُوقفه المُحفِّز عند أول حجز. `app_check_contact_block`
     * هي نفس الدالّة التي يفرضها مُحفِّز الحجز، فسؤالها يُطابق ما سيحدث فعلًا.
     */
    if (mobile) {
      const { data: isBlocked, error: rpcError } = await supabase.rpc("app_check_contact_block", {
        p_organization_id: organization.id,
        p_patient_id: null,
        p_mobile_number: mobile,
        p_action: "booking",
      });
      if (!rpcError && isBlocked === true)
        return "رقم الجوال مدرج ضمن الجهات المحجوبة السارية";
    }
    return null;
  };

  const createPatient = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");

      /**
       * الحقول الأساسية تُفرض قبل أي استعلام: ملفٌ بلا هوية ولا جنسية يُرفَض
       * لاحقًا في الفاتورة والمطالبة التأمينية، وتصحيحه بعد أسابيع أصعب من
       * إكماله الآن.
       */
      if (missingCount > 0) {
        throw new Error(
          "أكمل الحقول الأساسية المعلَّمة بالأحمر: الاسم الرباعي، والهوية والجوال (١٠ أرقام لكلٍّ منهما)، والعمر، والجنسية، والطبيب المعالج",
        );
      }

      // الهوية المكرَّرة تمنع الحفظ — لا تُنبِّه فقط
      const idNumber = form.id_number.trim();
      if (idNumber) {
        const { data: existing, error: idError } = await supabase.rpc("app_patient_by_id_number", {
          p_organization_id: organization.id,
          p_id_number: idNumber,
          p_exclude_patient_id: null,
        });
        if (idError) throw idError;
        const live = (existing ?? []).find((row: { is_merged: boolean }) => !row.is_merged) as
          | { name_ar: string; file_number: number }
          | undefined;
        if (live) {
          throw new Error(
            `رقم الهوية ${idNumber} مسجَّل في الملف رقم ${live.file_number} (${live.name_ar}). افتح الملف القائم بدل فتح ملف ثانٍ.`,
          );
        }
      }

      // أول محاولة حفظ لمطابقة محجوبة تُظهر التحذير وتتوقف؛ الضغط ثانيةً
      // يُكمل الحفظ بعد أن يكون الموظف قد رأى السبب.
      if (!warningAcknowledged) {
        const warning = await checkBlockedContact();
        // كشف التكرار يجري في نفس محاولة الحفظ الأولى، لا مع كل حرف يُكتب:
        // استعلام لكل ضغطة مفتاح هدر، والموظف لا يقرأ تحذيرًا يومض أثناء
        // الكتابة.
        const { data: dupes } = await supabase.rpc("app_find_duplicate_patients", {
          p_organization_id: organization.id,
          p_id_number: form.id_number.trim() || null,
          p_passport_number: null,
          p_mobile_number: form.mobile_number.trim() || null,
          p_name_ar: form.name_ar.trim() || null,
          p_birth_date: birthDateFromAge(form.age_years, form.age_months),
        });
        const found = (dupes ?? []) as typeof duplicates;
        setDuplicates(found);
        if (warning || found.length > 0) {
          if (warning) setBlockWarning(warning);
          setWarningAcknowledged(true);
          throw new Error(
            warning ?? "يوجد ملف قد يكون لنفس الشخص — راجع القائمة ثم اضغط الحفظ ثانيةً للمتابعة",
          );
        }
      }

      const { data, error } = await supabase
        .from("patients")
        .insert({
          organization_id: organization.id,
          name_ar: form.name_ar.trim(),
          name_en: form.name_en.trim() || null,
          mobile_number: form.mobile_number.trim() || null,
          gender: form.gender || null,
          birth_date: birthDateFromAge(form.age_years, form.age_months),
          // التاريخ مشتقّ من عمرٍ مُدخَل: يُوسَم تقديريًا فلا يُقرأ يومه وشهره
          // كأنهما مأخوذان من هوية
          birth_date_is_estimated: Boolean(birthDateFromAge(form.age_years, form.age_months)),
          id_number: form.id_number.trim() || null,
          passport_number: form.passport_number.trim() || null,
          nationality_value_id: form.nationality_value_id || null,
          profession_value_id: form.profession_value_id || null,
          marital_status: form.marital_status || null,
          customer_type_value_id: form.customer_type_value_id || null,
          source_value_id: form.source_value_id || null,
          educational_qualification_value_id: form.educational_qualification_value_id || null,
          work_entity_value_id: form.work_entity_value_id || null,
          city_value_id: form.city_value_id || null,
          treating_doctor_id: form.treating_doctor_id || null,
          address: form.address.trim() || null,
          emergency_number: form.emergency_number.trim() || null,
          email_1: form.email_1.trim() || null,
          blood_type: form.blood_type || null,
          guarantor_name: form.guarantor_name.trim() || null,
          guarantor_number: form.guarantor_number.trim() || null,
          nearest_person_name: form.nearest_person_name.trim() || null,
          nearest_person_number: form.nearest_person_number.trim() || null,
          insurance_company_name: form.insurance_company_name.trim() || null,
          insurance_policy_number: form.insurance_policy_number.trim() || null,
          insurance_membership_number: form.insurance_membership_number.trim() || null,
          default_discount_percent: Number(form.default_discount_percent) || 0,
          general_note: form.general_note.trim() || null,
          is_newborn: form.is_newborn,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["patients-list"] });
      toast({ title: "تم فتح ملف المريض" });
      setForm(emptyForm);
      setBlockWarning(null);
      setWarningAcknowledged(false);
      setExistingIdFile(null);
      nameEnTouched.current = false;
      // الإغلاق بعد الحفظ لا يمرّ بحارس «غير محفوظ»: النموذج أُفرغ فعلًا
      onOpenChange(false);
      navigate(`/patients/${id}`);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ المريض",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open && !minimized} onOpenChange={guardedOpenChange}>
      <DialogContent
        className="max-w-2xl"
        /**
         * النقرة خارج النافذة وزرّ Escape كانا يمحوان كل ما كُتب بلا سؤال —
         * وهي أشيع طريقة يفقد بها الاستقبال ملفًا كاملًا. الاعتراض هنا يسأل
         * قبل الإغلاق، ولا يسأل إن كانت النافذة فارغة.
         */
        onPointerDownOutside={(event) => {
          if (isDirty) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isDirty && !window.confirm("ستفقد ما كتبته في هذه النافذة. هل تريد الإغلاق؟"))
            event.preventDefault();
        }}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pe-8">
            <DialogTitle>فتح ملف مريض جديد</DialogTitle>
            {onMinimize && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                title="يُنزَل الملف إلى أسفل الشاشة بما كُتب فيه — اذهب إلى أيّ شاشة ثمّ ارفعه وأكمل"
                onClick={onMinimize}
              >
                <Minimize2 className="h-4 w-4" />
                إنزال الملف
              </Button>
            )}
          </div>
          <DialogDescription>
            الحقول المعلَّمة بالأحمر أساسية ولا يُحفظ الملف بدونها. يمكن استكمال الباقي من ملف المريض لاحقًا.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field labelNode={<RequiredLabel missing={missing.name_ar}>الاسم الرباعي بالعربية</RequiredLabel>}>
            <Input
              value={form.name_ar}
              onChange={(e) => setNameAr(e.target.value)}
              className={requiredInputClass(missing.name_ar)}
              autoFocus
            />
            {nameIsShort && (
              <span className="text-xs text-amber-700">
                الاسم أقلّ من أربعة مقاطع — يُفضَّل الاسم الرباعي كما في الهوية.
              </span>
            )}
          </Field>
          <Field label="الاسم بالإنجليزية (يُقترح من العربي)">
            <Input
              value={form.name_en}
              dir="ltr"
              onChange={(e) => {
                nameEnTouched.current = true;
                set("name_en", e.target.value);
              }}
            />
          </Field>
          <Field labelNode={<RequiredLabel missing={missing.mobile_number}>رقم الجوال</RequiredLabel>}>
            <div className="flex items-center gap-2">
              <Input
                value={form.mobile_number}
                onChange={(e) => set("mobile_number", digitsOnly(e.target.value))}
                className={requiredInputClass(missing.mobile_number)}
                inputMode="numeric"
                dir="ltr"
                placeholder="05XXXXXXXX"
              />
              <DigitCounter value={form.mobile_number} />
            </div>
            {form.mobile_number.length === 10 && !form.mobile_number.startsWith("05") && (
              <span className="text-xs text-amber-700">
                جوّال السعودية يبدأ بـ05 — تأكّد من الرقم.
              </span>
            )}
          </Field>
          <Field label="الجنس">
            <Select value={form.gender} onValueChange={(value) => set("gender", value as "male" | "female")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">ذكر</SelectItem>
                <SelectItem value="female">أنثى</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field labelNode={<RequiredLabel missing={missing.age}>العمر</RequiredLabel>}>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={130}
                inputMode="numeric"
                placeholder="سنة"
                value={form.age_years}
                onChange={(e) => set("age_years", e.target.value)}
                className={requiredInputClass(missing.age)}
              />
              <span className="text-xs text-muted-foreground">سنة</span>
              <Input
                type="number"
                min={0}
                max={11}
                inputMode="numeric"
                placeholder="شهر"
                value={form.age_months}
                onChange={(e) => set("age_months", e.target.value)}
              />
              <span className="text-xs text-muted-foreground">شهر</span>
            </div>
            {/* الأشهر للرضّع: عمر «٠ سنة» بلا أشهر لا يميّز مولود أسبوع من طفل
                أحد عشر شهرًا، والجرعات الدوائية تفرّق بينهما. */}
            <span className="text-xs text-muted-foreground">
              يُحسب تاريخ الميلاد من العمر ويُوسَم تقديريًا؛ عدّله من الملف إن توفّرت الهوية.
            </span>
          </Field>
          <Field
            labelNode={<RequiredLabel missing={missing.id_number}>رقم الهوية/الإقامة</RequiredLabel>}
          >
            <div className="flex items-center gap-2">
              <Input
                value={form.id_number}
                onChange={(e) => set("id_number", digitsOnly(e.target.value))}
                className={requiredInputClass(missing.id_number)}
                inputMode="numeric"
                dir="ltr"
                placeholder="١٠ أرقام"
              />
              <DigitCounter value={form.id_number} />
            </div>
            {existingIdFile && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/patients/${existingIdFile.patient_id}`);
                }}
                className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-start text-xs text-rose-800 hover:bg-rose-100"
              >
                هذا الرقم مسجَّل في الملف رقم {existingIdFile.file_number} ({existingIdFile.name_ar}) — افتح الملف
                القائم ←
              </button>
            )}
          </Field>
          <Field label="رقم الجواز">
            <Input value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} />
          </Field>
          <Field
            labelNode={<RequiredLabel missing={missing.nationality_value_id}>الجنسية</RequiredLabel>}
          >
            <LookupSelect
              categoryKey="nationalities"
              centered
              title="الجنسية"
              value={form.nationality_value_id}
              onChange={(v) => set("nationality_value_id", v)}
              triggerClassName={requiredInputClass(missing.nationality_value_id)}
            />
          </Field>
          <Field
            labelNode={<RequiredLabel missing={missing.treating_doctor_id}>الطبيب المعالج</RequiredLabel>}
          >
            <Select value={form.treating_doctor_id} onValueChange={(v) => set("treating_doctor_id", v)}>
              <SelectTrigger className={requiredInputClass(missing.treating_doctor_id)}>
                <SelectValue placeholder={doctors.isLoading ? "جارٍ التحميل…" : "اختر الطبيب"} />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="المهنة">
            <LookupSelect
              categoryKey="professions"
              value={form.profession_value_id}
              onChange={(v) => set("profession_value_id", v)}
            />
          </Field>
          <Field label="الحالة العائلية">
            <Select
              value={form.marital_status}
              onValueChange={(v) => set("marital_status", v as typeof form.marital_status)}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MARITAL_STATUS_LABELS_AR).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="فصيلة الدم">
            <Select value={form.blood_type} onValueChange={(v) => set("blood_type", v)}>
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                {BLOOD_TYPES.map((bt) => (
                  <SelectItem key={bt} value={bt}>
                    {bt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="نوع العميل">
            <LookupSelect
              categoryKey="customer_types"
              value={form.customer_type_value_id}
              onChange={(v) => set("customer_type_value_id", v)}
            />
          </Field>
          <Field label="مصدر المريض">
            <LookupSelect
              categoryKey="patient_sources"
              value={form.source_value_id}
              onChange={(v) => set("source_value_id", v)}
            />
          </Field>
          <Field label="المؤهل التعليمي">
            <LookupSelect
              categoryKey="educational_qualifications"
              value={form.educational_qualification_value_id}
              onChange={(v) => set("educational_qualification_value_id", v)}
            />
          </Field>
          <Field label="جهة العمل">
            <LookupSelect
              categoryKey="work_entities"
              value={form.work_entity_value_id}
              onChange={(v) => set("work_entity_value_id", v)}
            />
          </Field>
          {/**
            * المدينة قائمة لا نصّ: الحقل النصّي القديم كان يُدمَج في `address`
            * ولا يكتب `city_value_id`، فمرشّح المدينة في شاشة المرضى — الذي
            * يقارن `city_value_id` وحده — لا يجد أيًّا من هؤلاء المرضى أبدًا.
            */}
          <Field label="المدينة">
            <LookupSelect
              categoryKey="cities"
              value={form.city_value_id}
              onChange={(v) => set("city_value_id", v)}
            />
          </Field>
          <Field label="العنوان التفصيلي">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="جوال للطوارئ">
            <Input value={form.emergency_number} onChange={(e) => set("emergency_number", e.target.value)} inputMode="tel" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input type="email" value={form.email_1} onChange={(e) => set("email_1", e.target.value)} />
          </Field>
          <Field label="اسم الضامن / الكفيل">
            <Input value={form.guarantor_name} onChange={(e) => set("guarantor_name", e.target.value)} />
          </Field>
          <Field label="رقم جوال الضامن / الكفيل">
            <Input value={form.guarantor_number} onChange={(e) => set("guarantor_number", e.target.value)} inputMode="tel" />
          </Field>
          <Field label="اسم أقرب شخص">
            <Input value={form.nearest_person_name} onChange={(e) => set("nearest_person_name", e.target.value)} />
          </Field>
          <Field label="رقم جوال أقرب شخص">
            <Input
              value={form.nearest_person_number}
              onChange={(e) => set("nearest_person_number", e.target.value)}
              inputMode="tel"
            />
          </Field>
          <Field label="شركة التأمين (اتركها فارغة للدفع النقدي)">
            <Input
              value={form.insurance_company_name}
              onChange={(e) => set("insurance_company_name", e.target.value)}
            />
          </Field>
          <Field label="رقم وثيقة التأمين">
            <Input
              value={form.insurance_policy_number}
              onChange={(e) => set("insurance_policy_number", e.target.value)}
            />
          </Field>
          <Field label="رقم العضوية التأمينية">
            <Input
              value={form.insurance_membership_number}
              onChange={(e) => set("insurance_membership_number", e.target.value)}
            />
          </Field>
          <Field label="نسبة خصم افتراضية %">
            <Input
              type="number"
              min={0}
              max={100}
              value={form.default_discount_percent}
              onChange={(e) => set("default_discount_percent", e.target.value)}
            />
          </Field>
          <Field label="مولود جديد (لا يتطلب هوية مستقلة)">
            <Button
              type="button"
              variant={form.is_newborn ? "default" : "outline"}
              onClick={() => set("is_newborn", !form.is_newborn)}
            >
              {form.is_newborn ? "نعم" : "لا"}
            </Button>
          </Field>
          <Field label="ملاحظة عامة" full>
            <Textarea value={form.general_note} onChange={(e) => set("general_note", e.target.value)} />
          </Field>
        </div>
        {duplicates.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-amber-400 bg-amber-50/60 px-3 py-2 text-sm">
            <div className="flex items-center gap-2 font-medium text-amber-900">
              <TriangleAlert className="h-4 w-4" />
              ملفات قد تكون لنفس الشخص
            </div>
            {duplicates.map((row) => (
              <button
                key={row.patient_id}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/patients/${row.patient_id}`);
                }}
                className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1 text-start text-xs hover:bg-muted"
              >
                <span className="font-medium">{row.name_ar}</span>
                {row.file_number && <span className="text-muted-foreground">ملف {row.file_number}</span>}
                {row.mobile_number && <span className="text-muted-foreground">{row.mobile_number}</span>}
                <span className="rounded bg-amber-200 px-1.5">{row.match_reason}</span>
                <span className="text-muted-foreground">فتح الملف ←</span>
              </button>
            ))}
            <span className="text-xs text-muted-foreground">
              إن كان شخصًا مختلفًا فعلًا، اضغط الحفظ ثانيةً للمتابعة.
            </span>
          </div>
        )}

        {blockWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>
              <strong>تنبيه حجب:</strong> {blockWarning}
              <span className="block text-xs text-muted-foreground">
                اضغط "حفظ وفتح الملف" مرة أخرى للمتابعة رغم التحذير.
              </span>
            </span>
          </div>
        )}


        <DialogFooter className="items-center gap-2">
          <Button
            disabled={missingCount > 0 || Boolean(existingIdFile) || createPatient.isPending}
            onClick={() => createPatient.mutate()}
          >
            {createPatient.isPending ? "جارٍ الحفظ..." : "حفظ وفتح الملف"}
          </Button>
          {missingCount > 0 && (
            <span className="text-xs text-rose-700">
              بقي {missingCount} من الحقول الأساسية
            </span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  labelNode,
  children,
  full,
}: {
  label?: string;
  /** تسمية جاهزة (مثل تسمية الحقل الأساسيّ بالأحمر) بدل نصّ عاديّ. */
  labelNode?: ReactNode;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${full ? "sm:col-span-2" : ""}`}>
      {labelNode ?? <Label>{label}</Label>}
      {children}
    </div>
  );
}

export type NewPatientDialogProps = ComponentProps<typeof NewPatientDialog>;
