import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Save, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import { examFieldLabel, type ExamTemplateSchema } from "@/lib/exam-template-fields";
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
import VisitOrders, {
  EMPTY_VISIT_ORDERS,
  hasAnyOrder,
  type VisitOrdersValue,
} from "@/components/medical/VisitOrders";

const EXAM_PURPOSE_LABELS: Record<OccupationalExamPurpose, string> = {
  pre_employment: "ما قبل التوظيف",
  periodic: "دوري",
  return_to_work: "العودة للعمل",
  exit: "مغادرة العمل",
};
const FITNESS_STATUS_LABELS: Record<OccupationalFitnessStatus, string> = {
  fit: "لائق",
  fit_with_restrictions: "لائق بقيود",
  unfit: "غير لائق",
  pending: "قيد المراجعة",
};

function useRecentVisits(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["medical-visits", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visits")
        .select(
          "id, visit_date, main_complaint, patient:patients!patient_visits_patient_tenant_fk(id, name_ar, file_number), doctor:doctors!patient_visits_doctor_tenant_fk(id, name_ar)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .order("visit_date", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function MedicalRecords() {
  const { organization } = useOrganizationAccess();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get("appointmentId");
  const [createOpen, setCreateOpen] = useState(false);
  const visits = useRecentVisits(organization?.id);
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

      <Card>
        <CardHeader>
          <CardTitle>آخر الزيارات</CardTitle>
          <CardDescription>آخر 40 زيارة فحص في المنشأة</CardDescription>
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

function useTemplateForSpecialty(specialtyValueId: string | null | undefined, organizationId: string | undefined) {
  return useQuery({
    queryKey: ["exam-template", specialtyValueId, organizationId],
    enabled: Boolean(specialtyValueId),
    queryFn: async () => {
      const { data: specialty, error: specialtyError } = await supabase
        .from("lookup_values")
        .select("extra")
        .eq("id", specialtyValueId)
        .single();
      if (specialtyError) throw specialtyError;
      const specialtyCode = (specialty?.extra as { specialty_code?: string } | null)?.specialty_code;
      if (!specialtyCode) return null;

      const { data: templates, error: templatesError } = await supabase
        .from("clinic_exam_templates")
        .select("id, specialty_code, canvas_type, schema_definition")
        // القالب المعطَّل يجب ألّا يُستعمل: زر "تعطيل القالب" كان يكتب العلم
        // ويعرض رسالة نجاح، ولا شيء يقرؤه — فيبقى الطبيب يرى القالب نفسه.
        .eq("is_disabled", false)
        .eq("specialty_code", specialtyCode)
        .or(`organization_id.eq.${organizationId},organization_id.is.null`)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (templatesError) throw templatesError;
      return templates as { id: string; specialty_code: string; canvas_type: string; schema_definition: ExamTemplateSchema } | null;
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
  const doctors = useDoctorsList(organizationId);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
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

  const groupSections = useMemo(
    () => (template.data?.schema_definition.sections ?? []).filter((section) => section.type === "group"),
    [template.data],
  );

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
          isDental && selectedTeeth.length > 0
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
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
                {section.fields.map((fieldKey) => (
                  <div key={fieldKey} className="flex flex-col gap-1">
                    <Label className="text-xs font-normal text-muted-foreground">{examFieldLabel(fieldKey)}</Label>
                    <Input
                      value={fieldValues[fieldKey] ?? ""}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
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
              onSelect={(item) =>
                setServices((prev) =>
                  // نفس الخدمة مرتين في زيارة واحدة تعني زيادة الكمية لا سطرًا
                  // ثانيًا — والسطر الثاني كان سيُفوتَر منفصلًا ويشوّش الفاتورة.
                  prev.some((s) => s.itemId === item.id)
                    ? prev.map((s) => (s.itemId === item.id ? { ...s, qty: s.qty + 1 } : s))
                    : [
                        ...prev,
                        {
                          key: `${item.id}-${Date.now()}`,
                          itemId: item.id,
                          name: item.name_ar,
                          qty: 1,
                          price: Number(item.price) || 0,
                          note: "",
                        },
                      ],
                )
              }
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

        <DialogFooter>
          <Button disabled={!patient || !doctorId || createVisit.isPending} onClick={() => createVisit.mutate()}>
            <Save className="h-4 w-4" />
            {createVisit.isPending ? "جارٍ الحفظ..." : "حفظ الزيارة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
