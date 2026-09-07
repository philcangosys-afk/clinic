import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Save, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import {
  normalizeExamFields,
  type ExamTemplateSchema,
  type NormalizedExamField,
} from "@/lib/exam-template-fields";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import CannedTextPicker, { appendCannedText } from "@/components/shared/CannedTextPicker";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import PatientPicker from "@/components/shared/PatientPicker";
import IcdPicker from "@/components/shared/IcdPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import LookupSelect from "@/components/shared/LookupSelect";
import type { OccupationalExamPurpose, OccupationalFitnessStatus } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import DentalChart from "@/components/medical/DentalChart";
import BodyDiagram, { type BodyDiagramData } from "@/components/medical/BodyDiagram";
import VisitCanvasDetail from "@/components/medical/VisitCanvasDetail";
import VisitOrders, {
  EMPTY_VISIT_ORDERS,
  hasAnyOrder,
  type VisitOrdersValue,
} from "@/components/medical/VisitOrders";
import { errorMessage } from "@/lib/error-message";

const EXAM_PURPOSE_LABELS: Record<OccupationalExamPurpose, string> = {
  pre_employment: "ما قبل التوظيف",
  periodic: "دوري",
  return_to_work: "العودة للعمل",
  exit: "مغادرة العمل",
};
/** نفس تسميات حالات الزيارة المعروضة في سجلّ الزيارات — لا تُعرض القيمة الخام. */
const VISIT_STATUS_LABELS: Record<string, string> = {
  planned: "مخطَّطة",
  waiting: "منتظرة",
  in_progress: "جارية",
  completed: "مكتملة",
  signed: "موقَّعة",
  closed: "مغلقة",
  cancelled: "ملغاة",
};

const FITNESS_STATUS_LABELS: Record<OccupationalFitnessStatus, string> = {
  fit: "لائق",
  fit_with_restrictions: "لائق بقيود",
  unfit: "غير لائق",
  pending: "قيد المراجعة",
};

function useRecentVisits(organizationId: string | undefined, patientId?: string | null) {
  return useQuery({
    // المريض جزءٌ من المفتاح لأنه جزءٌ من الاستعلام — وإلا خدمت الذاكرة
    // المؤقتة قائمةَ منشأةٍ كاملة لمريضٍ بعينه.
    queryKey: ["medical-visits", organizationId, patientId ?? null],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("patient_visits")
        .select(
          "id, visit_date, main_complaint, patient:patients!patient_visits_patient_tenant_fk(id, name_ar, file_number), doctor:doctors!patient_visits_doctor_tenant_fk(id, name_ar)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("visit_date", { ascending: false })
        .limit(40);
      if (patientId) query = query.eq("patient_id", patientId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

type FocusedVisit = {
  id: string;
  visit_date: string;
  status: string | null;
  main_complaint: string | null;
  notes: string | null;
  next_visit_plan: string | null;
  patient: { id: string; name_ar: string; file_number: string | null } | { id: string; name_ar: string; file_number: string | null }[] | null;
  doctor: { id: string; name_ar: string } | { id: string; name_ar: string }[] | null;
};

const one = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? value[0] ?? null : value;

/**
 * الزيارة المطلوبة بالرابط `?visitId=…`.
 *
 * زرّ «السجل الطبي» في شاشة سجل الزيارات كان يمرّر `visitId` وهذه الشاشة لا
 * تقرأ إلا `appointmentId` — فتُفتح على «آخر ٤٠ زيارة» في المنشأة بلا أي
 * إشارة إلى المريض ولا الزيارة، فيبحث الموظّف من جديد عن الزيارة التي جاء
 * منها.
 */
function useFocusedVisit(visitId: string | null, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["medical-visit-focus", organizationId, visitId],
    enabled: Boolean(organizationId && visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visits")
        .select(
          "id, visit_date, status, main_complaint, notes, next_visit_plan, patient:patients!patient_visits_patient_tenant_fk(id, name_ar, file_number), doctor:doctors!patient_visits_doctor_tenant_fk(id, name_ar)",
        )
        .eq("id", visitId!)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as FocusedVisit | null) ?? null;
    },
  });
}

export default function MedicalRecords() {
  const { organization } = useOrganizationAccess();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get("appointmentId");
  const visitId = searchParams.get("visitId");
  const [createOpen, setCreateOpen] = useState(false);
  const focused = useFocusedVisit(visitId, organization?.id);
  const focusedPatient = one(focused.data?.patient ?? null);
  // حين يُطلب سجلّ زيارةٍ بعينها تُحصر القائمة على مريضها: القائمة العامّة
  // بجانب زيارة محدَّدة تُعيد الموظّف إلى البحث الذي جاء ليتجنّبه.
  const visits = useRecentVisits(organization?.id, focusedPatient?.id ?? null);
  const appointment = useQuery({
    queryKey: ["medical-visit-appointment", organization?.id, appointmentId],
    enabled: Boolean(organization?.id && appointmentId),
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments")
        .select("id, patient_id, doctor_id, clinic_id, patient:patients!appointments_patient_tenant_fk(id, name_ar)")
        .eq("id", appointmentId).eq("organization_id", organization?.id).maybeSingle();
      if (error) throw error;
      return data as AppointmentVisitContext | null;
    },
  });

  useEffect(() => {
    if (appointment.data) setCreateOpen(true);
  }, [appointment.data]);

  /**
   * عرض سجلّ زيارةٍ بعينها اطّلاعٌ على ملفّ طبي، فيُسجَّل كما يُسجَّل فتح
   * نموذج الزيارة وفتح ملفّ المريض — وإلا صار للاطّلاع بابٌ لا أثر له.
   */
  const loggedVisitId = useRef<string | null>(null);
  useEffect(() => {
    const openedVisit = focused.data;
    const openedPatient = one(openedVisit?.patient ?? null);
    if (!openedVisit || !openedPatient || loggedVisitId.current === openedVisit.id) return;
    loggedVisitId.current = openedVisit.id;
    void supabase
      .rpc("app_log_record_access", {
        p_patient_id: openedPatient.id,
        p_access_type: "view",
        p_context: "فتح سجلّ زيارة من سجل الزيارات",
        p_reason: "تقديم الرعاية الطبية",
        p_visit_id: openedVisit.id,
        p_device_name: navigator.userAgent,
      })
      .then(({ error }) => {
        if (error) {
          loggedVisitId.current = null;
          toast({
            variant: "destructive",
            title: "تعذر تسجيل الاطلاع على الملف",
            description: error.message,
          });
        }
      });
  }, [focused.data, toast]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">السجل الطبي</h1>
          <p className="text-sm text-muted-foreground">زيارات الفحص الطبي — نموذج ديناميكي حسب تخصص الطبيب</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          زيارة فحص جديدة
        </Button>
      </div>

      {visitId && (
        <Card>
          <CardHeader>
            <CardTitle>
              سجلّ الزيارة{focusedPatient ? ` — ${focusedPatient.name_ar}` : ""}
            </CardTitle>
            <CardDescription>
              {focused.isLoading && "جارٍ تحميل الزيارة..."}
              {!focused.isLoading && focused.data && (
                <>
                  {new Date(focused.data.visit_date).toLocaleString("ar-SA")}
                  {one(focused.data.doctor) ? ` · د. ${one(focused.data.doctor)!.name_ar}` : ""}
                  {focusedPatient?.file_number ? ` · ملف ${focusedPatient.file_number}` : ""}
                </>
              )}
              {!focused.isLoading && !focused.isError && !focused.data &&
                "الزيارة المطلوبة غير موجودة في هذه المنشأة."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {focused.isError && (
              <p className="text-sm text-destructive">
                تعذّر تحميل الزيارة: {(focused.error as Error)?.message ?? "خطأ غير متوقع"}
              </p>
            )}
            {focused.data && (
              <>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">الشكوى: </span>
                    <span>{focused.data.main_complaint ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">الحالة: </span>
                    <span>
                      {focused.data.status
                        ? VISIT_STATUS_LABELS[focused.data.status] ?? focused.data.status
                        : "—"}
                    </span>
                  </div>
                  {focused.data.notes && (
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">ملاحظات: </span>
                      <span>{focused.data.notes}</span>
                    </div>
                  )}
                  {focused.data.next_visit_plan && (
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">خطة المتابعة: </span>
                      <span>{focused.data.next_visit_plan}</span>
                    </div>
                  )}
                </div>
                <VisitCanvasDetail visitId={focused.data.id} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{focusedPatient ? "زيارات هذا المريض" : "آخر الزيارات"}</CardTitle>
          <CardDescription>
            {focusedPatient ? `آخر 40 زيارة فحص لـ${focusedPatient.name_ar}` : "آخر 40 زيارة فحص في المنشأة"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {visits.isLoading &&
            Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          {!visits.isLoading && (visits.data ?? []).length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد زيارات فحص مسجّلة بعد.</p>
          )}
          {(visits.data ?? []).map((visit: any) => (
            <div key={visit.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold">{visit.patient?.name_ar ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    د. {visit.doctor?.name_ar ?? "—"} · {visit.main_complaint ?? "بلا شكوى مسجّلة"}
                  </p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(visit.visit_date).toLocaleString("ar-SA")}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <NewVisitDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} appointment={appointment.data ?? null} />
    </div>
  );
}

function useDoctorsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-enabled", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar, specialty_value_id")
        // مفتاح الاستعلام يذكر المؤسسة والاستعلام كان لا يقيّد بها — فقائمة
        // عضوٍ في منشأتين تعرض أطباء الاثنتين والذاكرة المؤقتة مفهرسة بمؤسسة
        // لا يحترمها الاستعلام.
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

type ExamTemplateRow = {
  id: string;
  specialty_code: string | null;
  canvas_type: string;
  schema_definition: ExamTemplateSchema;
};

/**
 * قالب الفحص المطابق لتخصص الطبيب.
 *
 * كان البحث على `specialty_code` وحده، بينما حوار «نموذج جديد» في شاشة النماذج
 * يعرض التخصص كقائمة تكتب `specialty_value_id` ويعرض الرمز كحقل «للتوافق مع
 * القوالب القديمة» — فيُترك فارغًا كما يوحي عنوانه. النتيجة: النموذج يظهر في
 * الجدول «مفعَّلًا» ولا يطابقه أيّ استعلام، والطبيب يرى «لا يوجد قالب فحص
 * مطابق». فالمطابقة الآن على معرّف التخصص أولًا (وهو المفتاح الذي تكتبه
 * الشاشة)، ثم ترتدّ إلى الرمز للقوالب المزروعة القديمة التي لا تحمل معرّفًا.
 *
 * والترتيب على `organization_id` تنازليًّا بلا قيم فارغة أخيرًا يُقدّم نسخة
 * المنشآة المخصَّصة على القالب النظاميّ المشترك.
 */
function useTemplateForSpecialty(specialtyValueId: string | null | undefined, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["exam-template", specialtyValueId, organizationId],
    // المنشأة شرطٌ لأن مرشّح الملكية يُبنى من معرّفها نصًّا.
    enabled: Boolean(specialtyValueId && organizationId),
    queryFn: async () => {
      const ownership = `organization_id.eq.${organizationId},organization_id.is.null`;

      const { data: byValueId, error: byValueIdError } = await supabase
        .from("clinic_exam_templates")
        .select("id, specialty_code, canvas_type, schema_definition")
        // القالب المعطَّل يجب ألّا يُستعمل: زر "تعطيل القالب" كان يكتب العلم
        // ويعرض رسالة نجاح، ولا شيء يقرؤه — فيبقى الطبيب يرى القالب نفسه.
        .eq("is_disabled", false)
        .eq("specialty_value_id", specialtyValueId)
        .or(ownership)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (byValueIdError) throw byValueIdError;
      if (byValueId) return byValueId as ExamTemplateRow;

      const { data: specialty, error: specialtyError } = await supabase
        .from("lookup_values")
        .select("extra")
        .eq("id", specialtyValueId)
        .single();
      if (specialtyError) throw specialtyError;
      const specialtyCode = (specialty?.extra as { specialty_code?: string } | null)?.specialty_code;
      if (!specialtyCode) return null;

      const { data: byCode, error: byCodeError } = await supabase
        .from("clinic_exam_templates")
        .select("id, specialty_code, canvas_type, schema_definition")
        .eq("is_disabled", false)
        .eq("specialty_code", specialtyCode)
        .or(ownership)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (byCodeError) throw byCodeError;
      return (byCode ?? null) as ExamTemplateRow | null;
    },
  });
}


/**
 * يستخرج المؤشرات الحيوية الرقمية من قيم حقول القالب.
 *
 * أسماء الحقول تتبع بذرة القالب الافتراضي في 0006 (مجموعة `biomarkers`).
 * ضغط الدم يُكتب عادةً "120/80" فيُفصَل إلى عموديه.
 *
 * يعيد `null` إن لم توجد أي قيمة رقمية — فلا يُنشأ صف فارغ لكل زيارة.
 */
function extractVitals(values: Record<string, string>) {
  const num = (raw: string | undefined, max?: number) => {
    if (!raw) return null;
    const parsed = Number(String(raw).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    /**
     * الحدّ الأعلى ليس تجميلًا: `bmi` عمود محسوب من نوع `numeric(5,2)`، وطولٌ
     * كُتب بالمتر (1.7 بدل 170) يجعل الحساب يتجاوز السعة ويُفشل **إدراج صف
     * المؤشرات كله** — والفشل مبتلَع بـ`console.warn` فتختفي القياسات بصمت.
     * القيمة خارج المدى المعقول تُترك فارغة لا تُقصّ: تصحيحها تخمين على
     * بيانات سريرية.
     */
    if (max !== undefined && parsed > max) return null;
    return parsed;
  };

  let systolic: number | null = null;
  let diastolic: number | null = null;
  const bp = values.blood_pressure;
  if (bp && bp.includes("/")) {
    const [high, low] = bp.split("/");
    systolic = num(high);
    diastolic = num(low);
  }

  const row = {
    heart_rate: num(values.heart_rate),
    blood_pressure_systolic: systolic,
    blood_pressure_diastolic: diastolic,
    temperature_celsius: num(values.temperature),
    glucose_level: num(values.glucose_level),
    // حدود فسيولوجية معقولة تمنع تجاوز سعة عمود bmi المحسوب
    height_cm: num(values.height, 300),
    weight_kg: num(values.weight, 700),
    respiratory_rate: num(values.respiratory_rate),
    // bmi عمود محسوب في القاعدة — لا يُكتب من هنا
  };
  return Object.values(row).some((value) => value !== null) ? row : null;
}

/**
 * إدخال حقل واحد من قالب الفحص **حسب نوعه**.
 *
 * كانت الحلقة تعرض `<Input>` نصيًّا لكل حقل، فما يبنيه المصمّم من أنواع
 * (قائمة اختيار، رقم، تاريخ، نعم/لا…) ووحدات وخيارات وإلزام كان بلا أثر في
 * الشاشة التي يعبّئها الطبيب: خيارات محدَّدة تُكتب باليد فتتنوّع صياغتها ولا
 * تصلح لتقرير، والرقم يُكتب نصًّا. القيمة تبقى نصًّا في `p_exam_data` (وهو ما
 * تقرؤه `extractVitals` والزيارات القديمة) — النوع يضبط طريقة الإدخال لا شكل
 * التخزين، فلا تنكسر قراءة ما حُفظ سابقًا.
 */
function ExamFieldInput({
  field,
  value,
  onChange,
}: {
  field: NormalizedExamField;
  value: string;
  onChange: (next: string) => void;
}) {
  const options = field.options ?? [];

  // القائمة والاختيار الواحد: كلاهما قيمة واحدة من مجموعة، فيُعرضان قائمة
  // اختيار. حقل قائمة بلا خيارات معرَّفة لا يُعطَّل — تعطيله يمنع تسجيل الفحص
  // كلّه بسبب نقص في القالب — بل يرتدّ إلى إدخال حرّ مع بيان السبب.
  if (field.type === "select" || field.type === "radio") {
    if (options.length === 0) {
      return (
        <Input
          value={value}
          placeholder="لا خيارات معرَّفة في القالب"
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="اختر" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label_ar}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "yes_no") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="اختر" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="نعم">نعم</SelectItem>
          <SelectItem value="لا">لا</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "multi_select") {
    // القيمة تبقى نصًّا واحدًا مفصولًا بفاصلة — `p_exam_data` جسون من نصوص،
    // وتغيير شكل القيمة لنوع واحد يكسر قراءة الزيارات المحفوظة.
    const chosen = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const toggle = (optionValue: string) => {
      const next = chosen.includes(optionValue)
        ? chosen.filter((entry) => entry !== optionValue)
        : [...chosen, optionValue];
      onChange(next.join(", "));
    };
    if (options.length === 0) {
      return (
        <Input
          value={value}
          placeholder="لا خيارات معرَّفة في القالب"
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={chosen.includes(option.value)}
              onChange={() => toggle(option.value)}
            />
            {option.label_ar}
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex h-9 cursor-pointer items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={value === "نعم"}
          onChange={(event) => onChange(event.target.checked ? "نعم" : "")}
        />
        {value === "نعم" ? "نعم" : "لا"}
      </label>
    );
  }

  if (field.type === "textarea") {
    return <Textarea rows={2} value={value} onChange={(event) => onChange(event.target.value)} />;
  }

  if (field.type === "number" || field.type === "measurement") {
    return (
      <Input
        type="number"
        inputMode="decimal"
        step="any"
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (field.type === "date" || field.type === "time") {
    return (
      <Input type={field.type} dir="ltr" value={value} onChange={(event) => onChange(event.target.value)} />
    );
  }

  // text وclinical_code وbody_map وfile — إدخال نصّي (لا مرفقات في نموذج
  // الزيارة بعد، والحقل يبقى قابلًا للتوثيق بدل أن يختفي).
  return <Input value={value} onChange={(event) => onChange(event.target.value)} />;
}

type AppointmentVisitContext = {
  id: string;
  patient_id: string;
  doctor_id: string;
  clinic_id: string | null;
  patient: { id: string; name_ar: string } | { id: string; name_ar: string }[] | null;
};

function NewVisitDialog({
  open,
  onOpenChange,
  organizationId,
  appointment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  appointment: AppointmentVisitContext | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { branch } = useOrganizationAccess();
  const doctors = useDoctorsList(organizationId);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const lastLoggedPatientId = useRef<string | null>(null);
  const [mainComplaint, setMainComplaint] = useState("");
  const [notes, setNotes] = useState("");
  const [nextVisitPlan, setNextVisitPlan] = useState("");
  /**
   * تاريخ المتابعة المهيكل (0056) بجانب النص الحر.
   *
   * «يراجع بعد أسبوعين» نصٌّ لا يُبنى عليه تذكير ولا قائمة متابعة متأخّرة ولا
   * حجز مقترح. التاريخ هو ما يجعل الخطة قابلة للتنفيذ؛ والنص يبقى للسبب.
   */
  const [nextVisitDate, setNextVisitDate] = useState("");
  const [orders, setOrders] = useState<VisitOrdersValue>(EMPTY_VISIT_ORDERS);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [diagnoses, setDiagnoses] = useState<{ id: string; code: string; name_ar: string | null; name_en: string }[]>([]);
  /**
   * الخدمات المنفَّذة في هذه الزيارة (0053).
   *
   * كان النظام يسجّل التشخيص والفحص ولا يسجّل **ما نُفِّذ**، فيفتح المحاسب
   * الفاتورة ويعيد اختيار الخدمات بالذاكرة أو بسؤال الطبيب — وكل خدمة تُنسى
   * لا تُفوتَر. هذا هو مصدر بنود الفاتورة المقترحة لاحقًا.
   *
   * `unit_price` يُلتقط من الكتالوج لحظة الإضافة ويُخزَّن: سعر الكتالوج قد
   * يتغيّر قبل الفوترة، والمريض يُحاسَب على سعر يوم التنفيذ.
   */
  const [services, setServices] = useState<
    { key: string; itemId: string; name: string; qty: number; price: number; note: string }[]
  >([]);
  const [examPurpose, setExamPurpose] = useState<OccupationalExamPurpose>("periodic");
  const [fitnessStatus, setFitnessStatus] = useState<OccupationalFitnessStatus>("pending");
  const [employerValueId, setEmployerValueId] = useState("");
  const [restrictionsNote, setRestrictionsNote] = useState("");
  const [certificateNumber, setCertificateNumber] = useState("");
  const [nextExamDueDate, setNextExamDueDate] = useState("");

  // لوحة الأسنان ومخطط الجسم — القالب هو من يحدد أيهما يظهر عبر canvas_type
  // (نفس الحقل الذي يُخزَّن على الزيارة كلقطة وقت الفحص).
  const [toothType, setToothType] = useState<"permanent" | "primary">("permanent");
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>([]);
  const [dentalComplications, setDentalComplications] = useState("");
  const [dentalAnesthesia, setDentalAnesthesia] = useState("");
  const [dentalAntibiotics, setDentalAntibiotics] = useState("");
  const [dentalEducation, setDentalEducation] = useState("");
  const [dentalProcedure, setDentalProcedure] = useState("");
  const [isXray, setIsXray] = useState(false);
  const [orthoUpper, setOrthoUpper] = useState(false);
  const [orthoLower, setOrthoLower] = useState(false);
  const [fullArch, setFullArch] = useState(false);
  const [bodyDiagram, setBodyDiagram] = useState<BodyDiagramData>({ view: "front", strokes: [] });

  const selectedDoctor = (doctors.data ?? []).find((doctor) => doctor.id === doctorId);
  const template = useTemplateForSpecialty(selectedDoctor?.specialty_value_id, organizationId);
  const isOccupational = template.data?.specialty_code === "occupational_health";
  const canvasType = template.data?.canvas_type ?? "none";
  const isDental = canvasType === "dental_chart";
  const isBodyDiagram = canvasType === "body_diagram";

  useEffect(() => {
    setFieldValues({});
  }, [template.data?.id]);

  useEffect(() => {
    if (!open || !appointment) return;
    const appointmentPatient = Array.isArray(appointment.patient) ? appointment.patient[0] : appointment.patient;
    if (appointmentPatient) setPatient({ id: appointmentPatient.id, name_ar: appointmentPatient.name_ar });
    setDoctorId(appointment.doctor_id);
  }, [appointment, open]);

  useEffect(() => {
    if (!open || !patient || lastLoggedPatientId.current === patient.id) return;
    lastLoggedPatientId.current = patient.id;
    void supabase.rpc("app_log_record_access", {
      p_patient_id: patient.id,
      p_access_type: "view",
      p_context: appointment ? "فتح السجل من الموعد" : "فتح نموذج زيارة طبية",
      p_reason: "تقديم الرعاية الطبية",
      p_visit_id: null,
      p_device_name: navigator.userAgent,
    }).then(({ error }) => {
      if (error) {
        lastLoggedPatientId.current = null;
        toast({
          variant: "destructive",
          title: "تعذر تسجيل الاطلاع على الملف",
          description: error.message,
        });
      }
    });
  }, [appointment, open, patient, toast]);

  useEffect(() => {
    if (!open) lastLoggedPatientId.current = null;
  }, [open]);

  // تعبئة جهة العمل تلقائيًا من ملف المريض عند اختيار قالب الفحص المهني — نفس
  // حقل patients.work_entity_value_id المستخدم أصلًا في ملف المريض (0028)
  useEffect(() => {
    if (!isOccupational || !patient) return;
    supabase
      .from("patients")
      .select("work_entity_value_id")
      .eq("id", patient.id)
      .maybeSingle()
      .then(({ data }) => setEmployerValueId((data as { work_entity_value_id: string | null } | null)?.work_entity_value_id ?? ""));
  }, [isOccupational, patient?.id]);

  /**
   * أقسام المجموعة بحقولها **مطبَّعة**.
   *
   * `app_rebuild_exam_schema` يُخرج حقول المجموعة كائنات
   * `{key, label_ar, type, unit, required, options, visible_when}`، والقوالب
   * النظامية المزروعة تُخرجها نصوصًا. الحلقة القديمة كانت تعامل كل عنصر نصًّا
   * فتمرّر الكائن إلى `<Label>` (وReact ترفض الكائن كابن فتنكسر النافذة كلها)
   * وتستعمله مفتاحًا للقيمة (فتُخزَّن كل الإجابات تحت `"[object Object]"`).
   * التطبيع يوحّد الشكلين، فيُقرأ القالبان معًا وتُحترم أنواع الحقول.
   */
  const groupSections = useMemo(
    () =>
      (template.data?.schema_definition?.sections ?? [])
        .filter((section) => section.type === "group")
        .map((section) => ({
          key: section.key,
          label_ar: section.label_ar,
          fields: normalizeExamFields(section.fields),
        })),
    [template.data],
  );

  /**
   * الحقول الظاهرة فعلًا — `visible_when` شرطٌ يبنيه المصمّم، فحقلٌ شرطه غير
   * متحقّق لا يُعرض ولا تُطلب قيمته (وإلّا صار «إلزاميًّا» لا سبيل لتعبئته).
   */
  const isFieldVisible = (field: NormalizedExamField) =>
    !field.visible_when || (fieldValues[field.visible_when.field] ?? "") === (field.visible_when.value ?? "");

  /** الحقول الإلزامية الناقصة — تُمنع بها الزيارة قبل النداء لا بعده. */
  const missingRequired = useMemo(() => {
    const missing: string[] = [];
    for (const section of groupSections) {
      for (const field of section.fields) {
        if (!field.required || !isFieldVisible(field)) continue;
        if (!String(fieldValues[field.key] ?? "").trim()) missing.push(field.label_ar);
      }
    }
    return missing;
  }, [groupSections, fieldValues]);

  /**
   * هل في كتلة الأسنان ما يُحفظ؟
   *
   * كان الشرط `selectedTeeth.length > 0` وحده، فمع `p_dental = null` تتخطّى
   * `app_save_visit` كتلة `dental_chart_entries` بالكامل: طبيب الأسنان يكتب
   * الإجراء والتخدير والمضاد الوقائي والمضاعفات والتثقيف ويؤشّر الأشعة
   * والتقويم، ثم يرى «تم الحفظ» ولا شيء من ذلك في القاعدة. والدالّة نفسها لا
   * تشترط أسنانًا — `tooth_numbers` تُبنى بـ`coalesce(…, '{}')` — فالكشف
   * العامّ بلا سنٍّ محدَّد حالة مشروعة لا سببًا لإسقاط البيانات بصمت.
   */
  const hasDentalData =
    selectedTeeth.length > 0 ||
    Boolean(
      dentalProcedure.trim() ||
        dentalAnesthesia.trim() ||
        dentalAntibiotics.trim() ||
        dentalComplications.trim() ||
        dentalEducation.trim(),
    ) ||
    isXray ||
    orthoUpper ||
    orthoLower ||
    fullArch;

  /**
   * حفظ الزيارة — نداء واحد لدالة `app_save_visit` (0061).
   *
   * كان هذا الحفظ **خمسة عشر طلبًا منفصلًا**: الزيارة، ثم الخدمات،
   * التشخيصات، لوحة الأسنان، المؤشرات، مخطط الجسم، الفحص المهني، ثم طلبات
   * المختبر والأشعة والوصفة. كلٌّ منها معاملة قائمة بذاتها.
   *
   * فإن نجح حفظ الزيارة وفشل ما بعده — انقطاع شبكة، إغلاق الحاسوب، سياسة
   * مانعة — بقيت زيارة محفوظة نصفها. والأسوأ أن الطبيب يرى رسالة فشل فيُعيد
   * الحفظ، فتُستبدل الخدمات مرة أخرى بينما التشخيص الذي فشل أولًا ما زال
   * ناقصًا.
   *
   * ولا يُصلح ذلك بترتيب الطلبات ولا بحذف تعويضي: الشبكة قد تنقطع بين أي
   * طلبين، وقد يفشل الحذف التعويضي هو الآخر. الذرّية لا تُبنى في العميل.
   *
   * فحص حظر المريض يبقى هنا عمدًا: الحظر قرار تشغيلي قابل للتجاوز بقرار
   * إداري لا قيد سلامة بيانات، وفرضه في القاعدة كان يمنع حتى الحالات
   * المشروعة (طوارئ، تسوية) بلا مخرج.
   */
  const createVisit = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient || !doctorId) throw new Error("أكمل بيانات المريض والطبيب");
      // الإلزام الذي يضبطه القالب (`is_required`) كان معروضًا في المصمّم فقط
      // ولا أثر له في نموذج الزيارة — فيُحفظ الفحص ناقصًا للحقل الذي وُصف
      // بأنه إلزاميّ.
      if (missingRequired.length > 0) {
        throw new Error(`حقول إلزامية في القالب لم تُعبَّأ: ${missingRequired.join("، ")}`);
      }
      await assertPatientNotBlocked(patient.id, "file");

      const { data, error } = await supabase.rpc("app_save_visit", {
        p_organization_id: organizationId,
        p_patient_id: patient.id,
        p_doctor_id: doctorId,
        p_clinic_id: appointment?.clinic_id ?? null,
        p_appointment_id: appointment?.id ?? null,
        p_template_id: template.data?.id ?? null,
        p_canvas_type: template.data?.canvas_type ?? "none",
        p_main_complaint: mainComplaint.trim() || null,
        p_exam_data: fieldValues,
        p_notes: notes.trim() || null,
        p_next_visit_plan: nextVisitPlan.trim() || null,
        p_next_visit_date: nextVisitDate || null,
        p_services: services.map((service) => ({
          item_id: service.itemId,
          qty: service.qty,
          unit_price: service.price,
          note: service.note.trim() || null,
        })),
        p_diagnoses: diagnoses.length > 0 ? diagnoses.map((code) => code.id) : null,
        // المؤشرات صارت جزءًا من المعاملة لا كتابةً جانبية: قيمة مرفوضة
        // تُبطل الحفظ كله بدل أن تُبتلع بتحذير في الطرفية ويظن الطبيب أنها
        // حُفظت. `extractVitals` يُسقط غير الرقمي أصلًا قبل الوصول إلى هنا.
        p_vitals: extractVitals(fieldValues),
        p_dental:
          isDental && hasDentalData
            ? {
                tooth_numbers: selectedTeeth,
                tooth_type: toothType,
                procedure_done: dentalProcedure.trim() || null,
                diagnosis_icd10_id: diagnoses[0]?.id ?? null,
                complications: dentalComplications.trim() || null,
                anesthesia: dentalAnesthesia.trim() || null,
                prophylactic_antibiotics: dentalAntibiotics.trim() || null,
                patient_family_education: dentalEducation.trim() || null,
                is_xray: isXray,
                ortho_upper: orthoUpper,
                ortho_lower: orthoLower,
                full_arch: fullArch,
              }
            : null,
        p_body_diagram: isBodyDiagram
          ? { view: bodyDiagram.view, strokes: bodyDiagram.strokes }
          : null,
        p_occupational: isOccupational
          ? {
              exam_purpose: examPurpose,
              fitness_status: fitnessStatus,
              employer_value_id: employerValueId || null,
              restrictions_note: restrictionsNote.trim() || null,
              certificate_number: certificateNumber.trim() || null,
              next_exam_due_date: nextExamDueDate || null,
            }
          : null,
        p_lab_test_ids: orders.labTestIds.length > 0 ? orders.labTestIds : null,
        p_radiology_exam_ids:
          orders.radiologyExamIds.length > 0 ? orders.radiologyExamIds : null,
        p_prescription_items: orders.prescriptionItems.map((entry) => ({
          drug_item_id: entry.drugItemId,
          dosage: entry.dosage.trim() || null,
          frequency: entry.frequency.trim() || null,
          duration_days: entry.durationDays ? Number(entry.durationDays) : null,
          quantity: entry.quantity,
          substitutable: entry.substitutable,
        })),
        p_order_priority: orders.priority,
        p_lab_notes: orders.labNotes.trim() || null,
        p_clinical_indication: orders.clinicalIndication.trim() || null,
        p_prescription_notes: orders.prescriptionNotes.trim() || null,
      });
      if (error) throw error;

      const saved = data as { visit_id: string; warnings: string[] } | null;
      if (!saved?.visit_id) throw new Error("لم تُحفظ الزيارة — أعد المحاولة");
      return { orderWarnings: saved.warnings ?? [] };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["medical-visits"] });
      queryClient.invalidateQueries({ queryKey: ["occupational-exam-report"] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
      queryClient.invalidateQueries({ queryKey: ["radiology-orders"] });
      queryClient.invalidateQueries({ queryKey: ["prescriptions-list"] });
      queryClient.invalidateQueries({ queryKey: ["pending-prescriptions"] });
      const warnings = result?.orderWarnings ?? [];
      toast(
        warnings.length > 0
          ? { title: "حُفظت الزيارة مع تنبيه", description: warnings.join(" — ") }
          : { title: "تم حفظ زيارة الفحص" },
      );
      setPatient(null);
      setDoctorId("");
      setMainComplaint("");
      setNotes("");
      setNextVisitPlan("");
      setNextVisitDate("");
      setOrders(EMPTY_VISIT_ORDERS);
      setFieldValues({});
      setDiagnoses([]);
      setExamPurpose("periodic");
      setFitnessStatus("pending");
      setEmployerValueId("");
      setRestrictionsNote("");
      setCertificateNumber("");
      setNextExamDueDate("");
      setSelectedTeeth([]);
      setToothType("permanent");
      setDentalComplications("");
      setDentalAnesthesia("");
      setDentalAntibiotics("");
      setDentalEducation("");
      setDentalProcedure("");
      setIsXray(false);
      setOrthoUpper(false);
      setOrthoLower(false);
      setFullArch(false);
      setBodyDiagram({ view: "front", strokes: [] });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الزيارة",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>زيارة فحص جديدة</DialogTitle>
          <DialogDescription>يتغيّر نموذج الفحص تلقائيًا حسب تخصص الطبيب المختار</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>الطبيب الفاحص</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الطبيب" />
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
            <Label>الشكوى الرئيسية</Label>
            <Input value={mainComplaint} onChange={(e) => setMainComplaint(e.target.value)} />
          </div>

          {doctorId && !template.data && !template.isLoading && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              لا يوجد قالب فحص مطابق لتخصص هذا الطبيب — حدَّد تخصص الطبيب من شاشة الأطباء أولًا.
            </p>
          )}

          {groupSections.map((section) => (
            <div key={section.key} className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">{section.label_ar}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {section.fields.filter((field) => isFieldVisible(field)).map((field) => (
                  <div
                    key={field.key}
                    className={
                      field.type === "textarea"
                        ? "col-span-2 flex flex-col gap-1 sm:col-span-3"
                        : "flex flex-col gap-1"
                    }
                  >
                    <Label className="text-xs font-normal text-muted-foreground">
                      {field.label_ar}
                      {field.unit ? ` (${field.unit})` : ""}
                      {field.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <ExamFieldInput
                      field={field}
                      value={fieldValues[field.key] ?? ""}
                      onChange={(next) => setFieldValues((prev) => ({ ...prev, [field.key]: next }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {isDental && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-semibold">لوحة الأسنان</p>
              <DentalChart
                toothType={toothType}
                onToothTypeChange={setToothType}
                selectedTeeth={selectedTeeth}
                onSelectedTeethChange={setSelectedTeeth}
              />

              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={isXray} onChange={(e) => setIsXray(e.target.checked)} />
                  أشعة
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={orthoUpper}
                    onChange={(e) => setOrthoUpper(e.target.checked)}
                  />
                  تقويم علوي
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={orthoLower}
                    onChange={(e) => setOrthoLower(e.target.checked)}
                  />
                  تقويم سفلي
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={fullArch} onChange={(e) => setFullArch(e.target.checked)} />
                  قوس كامل
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>الإجراء المنفَّذ</Label>
                  <Input value={dentalProcedure} onChange={(e) => setDentalProcedure(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>التخدير</Label>
                  <Input value={dentalAnesthesia} onChange={(e) => setDentalAnesthesia(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>المضادات الحيوية الوقائية</Label>
                  <Input value={dentalAntibiotics} onChange={(e) => setDentalAntibiotics(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>المضاعفات</Label>
                  <Input
                    value={dentalComplications}
                    onChange={(e) => setDentalComplications(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label>تثقيف المريض وعائلته</Label>
                  <Textarea
                    value={dentalEducation}
                    onChange={(e) => setDentalEducation(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            </div>
          )}

          {isBodyDiagram && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-semibold">مخطط الجسم</p>
              <BodyDiagram value={bodyDiagram} onChange={setBodyDiagram} />
            </div>
          )}

          {isOccupational && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <p className="mb-2 text-sm font-semibold">نتيجة الفحص المهني</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-normal text-muted-foreground">الغرض من الفحص</Label>
                  <Select value={examPurpose} onValueChange={(v) => setExamPurpose(v as OccupationalExamPurpose)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(EXAM_PURPOSE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-normal text-muted-foreground">حالة اللياقة</Label>
                  <Select value={fitnessStatus} onValueChange={(v) => setFitnessStatus(v as OccupationalFitnessStatus)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FITNESS_STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-normal text-muted-foreground">جهة العمل</Label>
                  <LookupSelect categoryKey="work_entities" value={employerValueId} onChange={setEmployerValueId} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-normal text-muted-foreground">رقم الشهادة</Label>
                  <Input value={certificateNumber} onChange={(e) => setCertificateNumber(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-normal text-muted-foreground">تاريخ الفحص القادم</Label>
                  <Input type="date" value={nextExamDueDate} onChange={(e) => setNextExamDueDate(e.target.value)} />
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <Label className="text-xs font-normal text-muted-foreground">قيود/ملاحظات اللياقة (إن وُجدت)</Label>
                <Textarea value={restrictionsNote} onChange={(e) => setRestrictionsNote(e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>التشخيص (ICD10)</Label>
            <IcdPicker selected={diagnoses} onChange={setDiagnoses} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <Label>الخدمات المنفَّذة في هذه الزيارة</Label>
            <p className="text-xs text-muted-foreground">
              ما تسجّله هنا يُقترح تلقائيًا كبنود فاتورة في شاشة الفوترة — ولا يُفوتَر مرتين.
            </p>
            <ItemPicker
              onSelect={async (item) => {
                // نفس الخدمة مرتين في زيارة واحدة تعني زيادة الكمية لا سطرًا
                // ثانيًا — والسطر الثاني كان سيُفوتَر منفصلًا ويشوّش الفاتورة.
                if (services.some((s) => s.itemId === item.id)) {
                  setServices((prev) =>
                    prev.map((s) => (s.itemId === item.id ? { ...s, qty: s.qty + 1 } : s)),
                  );
                  return;
                }

                // الملاءمة والسعر يُحسمان في القاعدة لا هنا: العمر والجنس
                // والمورد والموافقة المسبقة تمنع، والسعر يأتي من قائمة
                // الأسعار المطابقة لا من `items.price` — الذي قد يكون
                // مختلفًا تمامًا لمريض تأمين.
                let price = Number(item.price) || 0;
                if (patient) {
                  const [eligibility, resolved] = await Promise.all([
                    supabase.rpc("app_check_service_eligibility", {
                      p_item_id: item.id,
                      p_patient_id: patient.id,
                      p_branch_id: branch?.id ?? null,
                    }),
                    supabase.rpc("app_resolve_item_price", {
                      p_organization_id: organizationId,
                      p_item_id: item.id,
                      p_branch_id: branch?.id ?? null,
                    }),
                  ]);

                  const check = eligibility.data as
                    | { ok: boolean; blocks: string[]; warnings: string[] }
                    | null;
                  if (eligibility.error) {
                    toast({
                      variant: "destructive",
                      title: "تعذّر فحص ملاءمة الخدمة",
                      description: eligibility.error.message,
                    });
                    return;
                  }
                  if (check && !check.ok) {
                    toast({
                      variant: "destructive",
                      title: `لا يمكن إضافة «${item.name_ar}»`,
                      description: (check.blocks ?? []).join(" — "),
                    });
                    return;
                  }
                  if (check && (check.warnings ?? []).length > 0) {
                    toast({
                      title: `تنبيهات ${item.name_ar}`,
                      description: check.warnings.join(" — "),
                    });
                  }

                  const row = Array.isArray(resolved.data) ? resolved.data[0] : resolved.data;
                  if (!resolved.error && row && row.price !== null && row.price !== undefined) {
                    price = Number(row.price);
                  }
                }

                setServices((prev) => [
                  ...prev,
                  {
                    key: `${item.id}-${Date.now()}`,
                    itemId: item.id,
                    name: item.name_ar,
                    qty: 1,
                    price,
                    note: "",
                  },
                ]);
              }}
            />
            {services.length > 0 && (
              <div className="flex flex-col gap-1 rounded-md border bg-background p-2">
                {services.map((service) => (
                  <div key={service.key} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{service.name}</span>
                    <Input
                      className="h-8 w-20"
                      type="number"
                      min={1}
                      value={service.qty}
                      onChange={(e) =>
                        setServices((prev) =>
                          prev.map((s) =>
                            s.key === service.key
                              ? { ...s, qty: Math.max(Number(e.target.value) || 1, 1) }
                              : s,
                          ),
                        )
                      }
                    />
                    <Input
                      className="h-8 w-24"
                      type="number"
                      min={0}
                      value={service.price}
                      onChange={(e) =>
                        setServices((prev) =>
                          prev.map((s) =>
                            s.key === service.key
                              ? { ...s, price: Math.max(Number(e.target.value) || 0, 0) }
                              : s,
                          ),
                        )
                      }
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setServices((prev) => prev.filter((s) => s.key !== service.key))
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
                <span className="pt-1 text-xs text-muted-foreground">
                  الإجمالي التقديري:{" "}
                  {services
                    .reduce((sum, s) => sum + s.qty * s.price, 0)
                    .toLocaleString("ar-SA")}{" "}
                  (قبل الضريبة والخصم — تُحسب في الفاتورة)
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>ملاحظات عامة</Label>
              {/* النصوص الجاهزة تُلحَق ولا تستبدل ما كتبه الطبيب */}
              <CannedTextPicker
                locationKey="medical_reports"
                onInsert={(text) => setNotes((prev) => appendCannedText(prev, text))}
              />
            </div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>خطة المتابعة القادمة</Label>
              <CannedTextPicker
                locationKey="referral_report"
                label="نص جاهز للخطة"
                onInsert={(text) => setNextVisitPlan((prev) => appendCannedText(prev, text))}
              />
            </div>
            <Textarea value={nextVisitPlan} onChange={(e) => setNextVisitPlan(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs font-normal text-muted-foreground">تاريخ المتابعة</Label>
              <Input
                type="date"
                className="h-8 w-44"
                value={nextVisitDate}
                onChange={(e) => setNextVisitDate(e.target.value)}
              />
              {nextVisitDate && (
                <Button size="sm" variant="ghost" onClick={() => setNextVisitDate("")}>
                  مسح التاريخ
                </Button>
              )}
            </div>
          </div>

          <VisitOrders organizationId={organizationId} value={orders} onChange={setOrders} />
          {hasAnyOrder(orders) && (
            <p className="-mt-1 text-xs text-muted-foreground">
              تُصدر الطلبات عند حفظ الزيارة، ومربوطةً بها.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {missingRequired.length > 0 && (
            <p className="text-xs text-amber-800 sm:me-auto">
              حقول إلزامية في القالب: {missingRequired.join("، ")}
            </p>
          )}
          <Button disabled={!patient || !doctorId || createVisit.isPending} onClick={() => createVisit.mutate()}>
            <Save className="h-4 w-4" />
            {createVisit.isPending ? "جارٍ الحفظ..." : "حفظ الزيارة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
