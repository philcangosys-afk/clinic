import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Receipt, Save, Stethoscope, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import type { HealthConditionRow, PatientHealthConditionRow, PatientNoteRow, PatientRow } from "@/lib/database.types";
import { statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PatientContactsTab from "@/components/patients/PatientContactsTab";
import MergePatientsDialog from "@/components/patients/MergePatientsDialog";
import { usePermissions } from "@/lib/permissions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LookupSelect from "@/components/shared/LookupSelect";
import SessionsTab from "@/components/patients/SessionsTab";
import SessionsPanel from "@/components/medical/SessionsPanel";
import VitalsTab from "@/components/patients/VitalsTab";
import CbahiTab from "@/components/patients/CbahiTab";
import {
  PatientVisitsTab,
  PatientPrescriptionsTab,
  PatientAgreementsTab,
} from "@/components/patients/PatientContextTabs";
import WalletTab from "@/components/patients/WalletTab";
import DocumentsTab from "@/components/patients/DocumentsTab";
import RadiologyImagesTab from "@/components/patients/RadiologyImagesTab";
import Odontogram from "@/components/medical/Odontogram";
import SendToDoctorDialog from "@/components/patients/SendToDoctorDialog";
import RequiredLabel, { requiredInputClass } from "@/components/shared/RequiredLabel";
import {
  ageFromBirthDate,
  ageMonthsFromBirthDate,
  birthDateFromAge,
  nameWordCount,
  transliterateArabicName,
} from "@/lib/arabic-name";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useToast } from "@/hooks/use-toast";

function usePatient(id: string | undefined) {
  return useQuery({
    queryKey: ["patient", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from("patients").select("*").eq("id", id).single();
      if (error) throw error;
      return data as PatientRow;
    },
  });
}

export default function PatientProfile() {
  const { id } = useParams();
  const patient = usePatient(id);

  /**
   * مسوّدة تبويب «نظرة عامة» تُحفظ **خارج** التبويب.
   *
   * كان ما يُكتب في الملف يضيع كلّه بمجرّد الانتقال إلى تبويب آخر والعودة:
   * Radix يفكّ تركيب التبويب غير النشط، وحالة النموذج كانت تُبنى من `patient`
   * مرّة واحدة عند التركيب — فتُبنى من جديد فارغةً من كل تعديل. والموظف يظن
   * أن النظام مسح بياناته، وهو ما حدث فعلًا.
   *
   * `null` يعني «لا تعديل بعد، اقرأ من السجل»، فلا تُجمَّد قيمة قديمة في
   * الذاكرة بعد أن يُحدَّث السجل من مكان آخر.
   */
  const [overviewDraft, setOverviewDraft] = useState<PatientFormState | null>(null);
  const overviewDirty = Boolean(
    overviewDraft && patient.data && isFormDirty(overviewDraft, patient.data),
  );
  // تنبيه المتصفّح قبل إغلاق التبويب أو إعادة التحميل على تعديلات غير محفوظة
  useUnsavedGuard(overviewDirty);

  /**
   * تسجيل الاطّلاع على الملف الطبي (المرحلة 15).
   *
   * القراءة لا تُطلق مُحفِّزًا في القاعدة، فسجل التدقيق أعمى عنها؛ ولو
   * سُجّلت من داخل استعلام القراءة لتكرّرت مع كل إعادة جلب. لذلك تُسجَّل
   * مرّةً واحدة عند فتح الملف فعلًا: `id` في قائمة الاعتماديات وحده.
   */
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const { error } = await supabase.rpc("app_log_record_access", {
        p_patient_id: id,
        p_access_type: "view",
        p_context: "ملف المريض",
        p_reason: null,
        p_visit_id: null,
      });
      // فشل التسجيل لا يمنع الطبيب من رؤية الملف — يُسجَّل في الطرفية فقط
      if (error && !cancelled) console.warn("access-log", error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (patient.isLoading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!patient.data) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">تعذر العثور على ملف المريض.</div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/patients">
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold">{patient.data.name_ar}</h1>
            <p className="text-sm text-muted-foreground">
              ملف رقم #{patient.data.file_number} · {patient.data.mobile_number ?? "بلا جوال"}
              {ageFromBirthDate(patient.data.birth_date) !== null && (
                <> · {ageFromBirthDate(patient.data.birth_date)} سنة</>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* الملف المدموج يجب أن يُعرف من أول نظرة: من يفتحه يظن أنه ينظر
              إلى سجل كامل، وهو سجل نُقل عنه كل شيء. */}
          {(patient.data as any).merged_into_id && (
            <Badge variant="destructive">
              ملف مدموج — استخدم الملف الأصلي
            </Badge>
          )}
          <PatientQuickActions patient={patient.data} />
          <MergeButton patientId={patient.data.id} patientName={patient.data.name_ar} />
          {patient.data.block_file && <Badge variant="destructive">الملف محجوب بالكامل</Badge>}
          {patient.data.block_appointments && <Badge variant="destructive">محجوب عن المواعيد</Badge>}
          {patient.data.block_invoices && <Badge variant="destructive">محجوب عن الفوترة</Badge>}
          {patient.data.block_sms && <Badge variant="secondary">محجوب عن SMS</Badge>}
        </div>
      </div>

      {/**
        * تبويبات على مستويين بدل 12 تبويبًا مسطَّحًا.
        *
        * المواصفة تطلب أن يرى الموظف الفحص والوصفات والاتفاقيات **في سياق
        * المريض**، وإضافتها مسطَّحةً كانت ستجعلها 15 تبويبًا في صف واحد يلتفّ
        * على ثلاثة أسطر — فيصعب العثور على أي منها. التجميع في أربع مجموعات
        * يجعل كل تبويب على بُعد نقرتين بدل مسح بصري لصفٍّ طويل.
        */}
      <Tabs defaultValue="file">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          {/* علامة «غير محفوظ» على التبويب نفسه: المسوّدة تبقى محفوظة عند
              الانتقال، لكن من انتقل يجب أن يعرف أن عليه العودة والحفظ. */}
          <TabsTrigger value="file">
            الملف
            {overviewDirty && <span className="ms-1 text-amber-600" title="تعديلات غير محفوظة">•</span>}
          </TabsTrigger>
          <TabsTrigger value="medical">الطبي</TabsTrigger>
          <TabsTrigger value="financial">المالي</TabsTrigger>
          <TabsTrigger value="admin">المواعيد والمستندات</TabsTrigger>
        </TabsList>

        <TabsContent value="file" className="mt-4">
          <Tabs defaultValue="overview">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
              <TabsTrigger value="conditions">الحالة الصحية</TabsTrigger>
              <TabsTrigger value="history">السوابق الصحية</TabsTrigger>
              <TabsTrigger value="contacts">المرافقون</TabsTrigger>
              <TabsTrigger value="notes">الملاحظات</TabsTrigger>
              <TabsTrigger value="blocking">الحجب</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <OverviewTab
                patient={patient.data}
                draft={overviewDraft}
                setDraft={setOverviewDraft}
              />
            </TabsContent>
            <TabsContent value="conditions" className="mt-4">
              <HealthConditionsTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <MedicalHistoryTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="contacts" className="mt-4">
              <PatientContactsTab patientId={id!} />
            </TabsContent>
            <TabsContent value="notes" className="mt-4">
              <NotesTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="blocking" className="mt-4">
              <BlockingTab patient={patient.data} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="medical" className="mt-4">
          <Tabs defaultValue="visits">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="visits">الزيارات والفحوصات</TabsTrigger>
              <TabsTrigger value="vitals">المؤشرات الحيوية</TabsTrigger>
              <TabsTrigger value="prescriptions">الوصفات</TabsTrigger>
              <TabsTrigger value="sessions">الجلسات</TabsTrigger>
              <TabsTrigger value="cbahi">الجودة والسلامة</TabsTrigger>
            </TabsList>
            <TabsContent value="visits" className="mt-4">
              <PatientVisitsTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="vitals" className="mt-4">
              <VitalsTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="prescriptions" className="mt-4">
              <PatientPrescriptionsTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="sessions" className="mt-4 flex flex-col gap-4">
              {/* لوحان لا واحد: `SessionsPanel` هو الجانب السريري (الجهاز
                  والمنطقة والإعدادات والأعراض وصور قبل/بعد)، و`SessionsTab`
                  هو الجانب التعاقدي (جلسات اتفاقية العلاج وكمّها المتفَق
                  عليه). دمجُهما في لوح واحد يخلط قرار الطبيب بحساب المال. */}
              <SessionsPanel patientId={patient.data.id} />
              <SessionsTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="cbahi" className="mt-4">
              <CbahiTab patientId={patient.data.id} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="financial" className="mt-4">
          <Tabs defaultValue="invoices">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="invoices">الفواتير</TabsTrigger>
              <TabsTrigger value="agreements">الاتفاقيات</TabsTrigger>
              <TabsTrigger value="wallet">المحفظة</TabsTrigger>
            </TabsList>
            <TabsContent value="invoices" className="mt-4">
              <InvoicesTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="agreements" className="mt-4">
              <PatientAgreementsTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="wallet" className="mt-4">
              <WalletTab patientId={patient.data.id} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="admin" className="mt-4">
          <Tabs defaultValue="appointments">
            <TabsList className="flex h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="appointments">المواعيد</TabsTrigger>
              <TabsTrigger value="documents">المستندات</TabsTrigger>
              <TabsTrigger value="radiology-images">صور الأشعة</TabsTrigger>
              <TabsTrigger value="odontogram">مخطّط الأسنان</TabsTrigger>
            </TabsList>
            <TabsContent value="appointments" className="mt-4">
              <AppointmentsTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="documents" className="mt-4">
              <DocumentsTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="radiology-images" className="mt-4">
              <RadiologyImagesTab patientId={patient.data.id} />
            </TabsContent>
            <TabsContent value="odontogram" className="mt-4">
              <Odontogram patientId={patient.data.id} />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** قيمة "بدون" في قائمة الطبيب المعالج (Select لا يقبل قيمة فارغة). */
const NO_DOCTOR = "__none__";

/**
 * حالة نموذج البيانات الأساسية مبنيّةً من السجل.
 *
 * دالّة على مستوى الوحدة لا داخل المكوّن: تُستدعى من التبويب لبناء المسوّدة،
 * ومن الصفحة لمعرفة هل تغيّر شيء فعلًا — ولو تكرّرت في موضعَين لاختلفت
 * القائمتان وصار «غير محفوظ» يظهر بلا سبب أو لا يظهر حين يجب.
 */
function buildPatientForm(patient: PatientRow) {
  return {
    name_ar: patient.name_ar ?? "",
    name_en: patient.name_en ?? "",
    mobile_number: patient.mobile_number ?? "",
    phone_1: patient.phone_1 ?? "",
    emergency_number: patient.emergency_number ?? "",
    email_1: patient.email_1 ?? "",
    id_number: patient.id_number ?? "",
    passport_number: patient.passport_number ?? "",
    nationality_value_id: patient.nationality_value_id ?? "",
    profession_value_id: patient.profession_value_id ?? "",
    // `city_value_id` كان عمودًا ميّتًا بمرشّح حيّ: شاشة المرضى تصفّي به
    // (Patients.tsx:129) بلا أي حقل إدخال هنا — فالمرشّح لا يُرجع نتيجة أبدًا.
    city_value_id: patient.city_value_id ?? "",
    /**
     * العمر مُدخَلًا بدل تاريخ الميلاد — ويُعرض محسوبًا من التاريخ المخزَّن.
     *
     * فلو كان في الملف تاريخ ميلاد مأخوذ من الهوية ظهر عمره صحيحًا، وتعديل
     * العمر يُعيد حساب التاريخ ويوسمه تقديريًا. وترك الحقلَين فارغَين لا
     * يمسّ تاريخ ميلاد قائمًا: الفراغ يعني «لم أُعدّله» لا «امحُه».
     */
    age_years: (() => {
      const age = ageFromBirthDate(patient.birth_date);
      return age === null ? "" : String(age);
    })(),
    age_months: (() => {
      const age = ageFromBirthDate(patient.birth_date);
      const months = ageMonthsFromBirthDate(patient.birth_date);
      // الأشهر تُعرض للرضّع والأطفال دون السنتين فقط — «٣٤ سنة و٧ أشهر» ضجيج
      return age !== null && age < 2 && months !== null ? String(months) : "";
    })(),
    blood_type: patient.blood_type ?? "",
    guarantor_name: patient.guarantor_name ?? "",
    guarantor_number: patient.guarantor_number ?? "",
    nearest_person_name: patient.nearest_person_name ?? "",
    nearest_person_number: patient.nearest_person_number ?? "",
    gln_number: patient.gln_number ?? "",
    insurance_company_name: patient.insurance_company_name ?? "",
    insurance_policy_number: patient.insurance_policy_number ?? "",
    insurance_membership_number: patient.insurance_membership_number ?? "",
    default_discount_percent: String(patient.default_discount_percent ?? 0),
    general_note: patient.general_note ?? "",
    // حقول كانت في جدول patients منذ 0002 بلا أي إدخال في الواجهة (لقطة 1)
    treating_doctor_id: patient.treating_doctor_id ?? "",
    tax_number: patient.tax_number ?? "",
    is_tax_registered: Boolean(patient.is_tax_registered),
    children_count: String(patient.children_count ?? 0),
    email_2: patient.email_2 ?? "",
    father_whatsapp: patient.father_whatsapp ?? "",
    website: patient.website ?? "",
    district: patient.district ?? "",
    street: patient.street ?? "",
    building_number: patient.building_number ?? "",
    postal_code: patient.postal_code ?? "",
    father_id_number: patient.father_id_number ?? "",
    mother_id_number: patient.mother_id_number ?? "",
    guarantor_details: patient.guarantor_details ?? "",
    insurance_policy_category: patient.insurance_policy_category ?? "",
    insurance_relation: patient.insurance_relation ?? "",
    insurance_membership_expiry: patient.insurance_membership_expiry ?? "",
    local_order_weight_kg:
      patient.local_order_weight_kg != null ? String(patient.local_order_weight_kg) : "",
  };
}

export type PatientFormState = ReturnType<typeof buildPatientForm>;

/** هل تختلف المسوّدة عن السجل المحفوظ؟ */
function isFormDirty(draft: PatientFormState, patient: PatientRow): boolean {
  const saved = buildPatientForm(patient);
  return (Object.keys(saved) as (keyof PatientFormState)[]).some(
    (key) => String(draft[key] ?? "") !== String(saved[key] ?? ""),
  );
}

/**
 * أزرار الملف السريعة: إصدار فاتورة، وإرسال إلى الطبيب.
 *
 * الفوترة تنتقل إلى شاشة الفواتير بالمريض محدَّدًا سلفًا، ولا تُبنى نافذة
 * فاتورة ثانية هنا: نافذة الفواتير تحمل التسعير والخصومات والتأمين وبنود
 * الزيارة غير المفوتَرة، ونسخةٌ مصغَّرة منها كانت ستُصدر فواتير بقواعد أقلّ.
 */
function PatientQuickActions({ patient }: { patient: PatientRow }) {
  const navigate = useNavigate();
  const { membership, legacyMode } = useOrganizationAccess();
  const [sendOpen, setSendOpen] = useState(false);

  /**
   * الصفات هنا **نفس** الصفات التي تفرضها القاعدة، لا مفاتيح صلاحية جديدة.
   *
   * `app_add_walk_in` تشترط الصفات الأربع أدناه، وشاشة الفواتير تشترط قائمتها
   * الخاصّة. واختراع مفتاح صلاحية لزرّ جديد كان سيُنتج زرًّا يظهر ثم تُرفض
   * عمليته في القاعدة — أو مفتاحًا لا يعرفه جدول الصلاحيات فيرفضه أصلًا.
   */
  const canQueue =
    legacyMode ||
    ["owner", "organization_admin", "branch_manager", "receptionist"].includes(
      membership?.role_key ?? "",
    );
  const canBill =
    legacyMode ||
    ["owner", "organization_admin", "accountant", "receptionist"].includes(
      membership?.role_key ?? "",
    );

  return (
    <>
      {canBill && !patient.block_invoices && !patient.block_file && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`/billing?patientId=${patient.id}`)}
        >
          <Receipt className="h-3.5 w-3.5" />
          إصدار فاتورة
        </Button>
      )}
      {canQueue && !patient.block_appointments && !patient.block_file && (
        <Button size="sm" onClick={() => setSendOpen(true)}>
          <Stethoscope className="h-3.5 w-3.5" />
          إرسال إلى الطبيب
        </Button>
      )}
      {sendOpen && (
        <SendToDoctorDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          patientId={patient.id}
          patientName={patient.name_ar}
          organizationId={patient.organization_id}
          defaultDoctorId={patient.treating_doctor_id}
        />
      )}
    </>
  );
}

function OverviewTab({
  patient,
  draft,
  setDraft,
}: {
  patient: PatientRow;
  draft: PatientFormState | null;
  setDraft: (draft: PatientFormState | null) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const doctors = useQuery({
    queryKey: ["doctors-for-patient", patient.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", patient.organization_id)
        // عمود التفعيل في `doctors` اسمه `is_enabled` لا `is_disabled` (0002).
        // الاستعلام القديم كان يفشل كليًا فتبقى قائمة الأطباء فارغة دائمًا.
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });
  const form = draft ?? buildPatientForm(patient);

  /** هل كُتب الاسم الإنجليزي بيد الموظف في هذه الجلسة؟ فلا يُكتب فوقه. */
  const nameEnTouched = useRef(false);

  const missing = {
    name_ar: !form.name_ar.trim(),
    id_number: !patient.is_newborn && !form.id_number.trim(),
    mobile_number: !form.mobile_number.trim(),
    age: !form.age_years.trim() && !form.age_months.trim(),
    nationality_value_id: !form.nationality_value_id,
  };
  const missingCount = Object.values(missing).filter(Boolean).length;
  const nameIsShort = !missing.name_ar && nameWordCount(form.name_ar) < 4;
  const dirty = draft !== null && isFormDirty(form, patient);

  const save = useMutation({
    mutationFn: async () => {
      /**
       * تاريخ الميلاد يُعاد حسابه من العمر **فقط إن غُيِّر العمر**.
       *
       * إرسال التاريخ في كل حفظ كان سيُزحزح تاريخ ميلاد مأخوذ من الهوية بيوم
       * أو يومَين مع كل تعديل عنوان أو رقم جوال — ويوسمه تقديريًا بلا سبب.
       */
      const saved = buildPatientForm(patient);
      const ageChanged =
        form.age_years !== saved.age_years || form.age_months !== saved.age_months;
      const derivedBirthDate = birthDateFromAge(form.age_years, form.age_months);

      // الهوية المكرَّرة تُمنع قبل الحفظ برسالة تقول أين الملف الآخر
      const idNumber = form.id_number.trim();
      if (idNumber && idNumber !== (patient.id_number ?? "").trim()) {
        const { data: existing, error: idError } = await supabase.rpc("app_patient_by_id_number", {
          p_organization_id: patient.organization_id,
          p_id_number: idNumber,
          p_exclude_patient_id: patient.id,
        });
        if (idError) throw idError;
        const live = (existing ?? []).find((row: { is_merged: boolean }) => !row.is_merged) as
          | { name_ar: string; file_number: number }
          | undefined;
        if (live)
          throw new Error(
            `رقم الهوية ${idNumber} مسجَّل في الملف رقم ${live.file_number} (${live.name_ar}) — لا يمكن تكراره.`,
          );
      }

      const { data: affectedRows, error } = await supabase
        .from("patients")
        .update({
          ...(ageChanged && derivedBirthDate
            ? { birth_date: derivedBirthDate, birth_date_is_estimated: true }
            : {}),
          name_ar: form.name_ar.trim(),
          name_en: form.name_en.trim() || null,
          mobile_number: form.mobile_number.trim() || null,
          phone_1: form.phone_1.trim() || null,
          emergency_number: form.emergency_number.trim() || null,
          email_1: form.email_1.trim() || null,
          id_number: form.id_number.trim() || null,
          passport_number: form.passport_number.trim() || null,
          nationality_value_id: form.nationality_value_id || null,
          profession_value_id: form.profession_value_id || null,
          city_value_id: form.city_value_id || null,
          blood_type: form.blood_type || null,
          guarantor_name: form.guarantor_name.trim() || null,
          guarantor_number: form.guarantor_number.trim() || null,
          nearest_person_name: form.nearest_person_name.trim() || null,
          nearest_person_number: form.nearest_person_number.trim() || null,
          gln_number: form.gln_number.trim() || null,
          insurance_company_name: form.insurance_company_name.trim() || null,
          insurance_policy_number: form.insurance_policy_number.trim() || null,
          insurance_membership_number: form.insurance_membership_number.trim() || null,
          default_discount_percent: Number(form.default_discount_percent) || 0,
          general_note: form.general_note.trim() || null,
          treating_doctor_id: form.treating_doctor_id || null,
          tax_number: form.tax_number.trim() || null,
          is_tax_registered: form.is_tax_registered,
          children_count: Number(form.children_count) || 0,
          email_2: form.email_2.trim() || null,
          father_whatsapp: form.father_whatsapp.trim() || null,
          website: form.website.trim() || null,
          district: form.district.trim() || null,
          street: form.street.trim() || null,
          building_number: form.building_number.trim() || null,
          postal_code: form.postal_code.trim() || null,
          father_id_number: form.father_id_number.trim() || null,
          mother_id_number: form.mother_id_number.trim() || null,
          guarantor_details: form.guarantor_details.trim() || null,
          insurance_policy_category: form.insurance_policy_category.trim() || null,
          insurance_relation: form.insurance_relation.trim() || null,
          insurance_membership_expiry: form.insurance_membership_expiry || null,
          local_order_weight_kg: form.local_order_weight_kg.trim()
            ? Number(form.local_order_weight_kg)
            : null,
        })
        .eq("id", patient.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient", patient.id] });
      queryClient.invalidateQueries({ queryKey: ["patients-list"] });
      // المسوّدة تُفرَغ بعد الحفظ فتُقرأ القيم من السجل المحدَّث لا من الذاكرة
      setDraft(null);
      nameEnTouched.current = false;
      toast({ title: "تم حفظ بيانات المريض" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const set = (key: keyof PatientFormState, value: string | boolean) =>
    setDraft({ ...form, [key]: value });

  /** الاسم العربي يُقترح مقابله الإنجليزي ما لم يكتبه الموظف بنفسه. */
  const setNameAr = (value: string) =>
    setDraft({
      ...form,
      name_ar: value,
      name_en: nameEnTouched.current ? form.name_en : transliterateArabicName(value),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>البيانات الأساسية</CardTitle>
        <CardDescription>
          الهوية والاتصال والتأمين — الحقول بالأحمر أساسية لفوترة المريض ومطالبته التأمينية.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/**
          * شريط «غير محفوظ» ملتصق بأعلى النموذج.
          *
          * التعديلات لم تكن تُفقَد بالانتقال بين التبويبات فحسب — كان الموظف
          * لا يعرف أصلًا أن عليه الضغط على «حفظ التعديلات» في آخر الصفحة.
          */}
        {dirty && (
          <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm sm:col-span-2">
            <span className="font-medium text-amber-900">تعديلات غير محفوظة</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                تجاهل
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                <Save className="h-3.5 w-3.5" />
                {save.isPending ? "جارٍ الحفظ..." : "حفظ الآن"}
              </Button>
            </div>
          </div>
        )}
        {missingCount > 0 && (
          <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:col-span-2">
            ناقص في هذا الملف {missingCount} من الحقول الأساسية — أكملها لتفادي رفض الفواتير والمطالبات.
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <RequiredLabel missing={missing.name_ar}>الاسم الرباعي بالعربية</RequiredLabel>
          <Input
            value={form.name_ar}
            onChange={(e) => setNameAr(e.target.value)}
            className={requiredInputClass(missing.name_ar)}
          />
          {nameIsShort && (
            <span className="text-xs text-amber-700">
              الاسم أقلّ من أربعة مقاطع — يُفضَّل الاسم الرباعي كما في الهوية.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الاسم بالإنجليزية (يُقترح من العربي)</Label>
          <Input
            value={form.name_en}
            dir="ltr"
            onChange={(e) => {
              nameEnTouched.current = true;
              set("name_en", e.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <RequiredLabel missing={missing.mobile_number}>رقم الجوال</RequiredLabel>
          <Input
            value={form.mobile_number}
            onChange={(e) => set("mobile_number", e.target.value)}
            className={requiredInputClass(missing.mobile_number)}
            inputMode="tel"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>هاتف إضافي</Label>
          <Input value={form.phone_1} onChange={(e) => set("phone_1", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <RequiredLabel missing={missing.id_number}>رقم الهوية/الإقامة</RequiredLabel>
          <Input
            value={form.id_number}
            dir="ltr"
            onChange={(e) => set("id_number", e.target.value)}
            className={requiredInputClass(missing.id_number)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <RequiredLabel missing={missing.age}>العمر</RequiredLabel>
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
          <span className="text-xs text-muted-foreground">
            {patient.birth_date
              ? `تاريخ الميلاد المخزَّن: ${patient.birth_date}${
                  (patient as any).birth_date_is_estimated ? " (تقديريّ من عمر مُدخَل)" : ""
                }`
              : "لا تاريخ ميلاد مخزَّن — يُحسب من العمر عند الحفظ."}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم الجواز</Label>
          <Input value={form.passport_number} onChange={(e) => set("passport_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>جوال للطوارئ</Label>
          <Input value={form.emergency_number} onChange={(e) => set("emergency_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>البريد الإلكتروني</Label>
          <Input type="email" value={form.email_1} onChange={(e) => set("email_1", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <RequiredLabel missing={missing.nationality_value_id}>الجنسية</RequiredLabel>
          <LookupSelect
            categoryKey="nationalities"
            value={form.nationality_value_id}
            onChange={(v) => set("nationality_value_id", v)}
            triggerClassName={requiredInputClass(missing.nationality_value_id)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>المهنة</Label>
          <LookupSelect
            categoryKey="professions"
            value={form.profession_value_id}
            onChange={(v) => set("profession_value_id", v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>المدينة</Label>
          <LookupSelect
            categoryKey="cities"
            value={form.city_value_id}
            onChange={(v) => set("city_value_id", v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>فصيلة الدم</Label>
          <Input value={form.blood_type} onChange={(e) => set("blood_type", e.target.value)} placeholder="مثال: O+" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>GLN</Label>
          <Input value={form.gln_number} onChange={(e) => set("gln_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>اسم الضامن / الكفيل</Label>
          <Input value={form.guarantor_name} onChange={(e) => set("guarantor_name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم جوال الضامن / الكفيل</Label>
          <Input value={form.guarantor_number} onChange={(e) => set("guarantor_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>اسم أقرب شخص</Label>
          <Input value={form.nearest_person_name} onChange={(e) => set("nearest_person_name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم جوال أقرب شخص</Label>
          <Input value={form.nearest_person_number} onChange={(e) => set("nearest_person_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>نسبة خصم افتراضية %</Label>
          <Input
            type="number"
            value={form.default_discount_percent}
            onChange={(e) => set("default_discount_percent", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>شركة التأمين</Label>
          <Input value={form.insurance_company_name} onChange={(e) => set("insurance_company_name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم وثيقة التأمين</Label>
          <Input value={form.insurance_policy_number} onChange={(e) => set("insurance_policy_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم العضوية التأمينية</Label>
          <Input
            value={form.insurance_membership_number}
            onChange={(e) => set("insurance_membership_number", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>فئة الوثيقة</Label>
          <Input
            value={form.insurance_policy_category}
            onChange={(e) => set("insurance_policy_category", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>صلة القرابة بحامل الوثيقة</Label>
          <Input value={form.insurance_relation} onChange={(e) => set("insurance_relation", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>انتهاء العضوية التأمينية</Label>
          <Input
            type="date"
            value={form.insurance_membership_expiry}
            onChange={(e) => set("insurance_membership_expiry", e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <p className="border-t pt-3 text-sm font-semibold">الطبيب المعالج والعنوان التفصيلي</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الطبيب المعالج</Label>
          <Select
            value={form.treating_doctor_id || NO_DOCTOR}
            onValueChange={(value) => set("treating_doctor_id", value === NO_DOCTOR ? "" : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="بدون" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DOCTOR}>بدون</SelectItem>
              {(doctors.data ?? []).map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  {doctor.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الحي</Label>
          <Input value={form.district} onChange={(e) => set("district", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الشارع</Label>
          <Input value={form.street} onChange={(e) => set("street", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم المبنى</Label>
          <Input value={form.building_number} onChange={(e) => set("building_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الرمز البريدي</Label>
          <Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} />
        </div>

        <div className="sm:col-span-2">
          <p className="border-t pt-3 text-sm font-semibold">بيانات إضافية</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الرقم الضريبي</Label>
          <Input value={form.tax_number} onChange={(e) => set("tax_number", e.target.value)} dir="ltr" />
        </div>
        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_tax_registered}
              onChange={(e) => set("is_tax_registered", e.target.checked)}
              className="h-4 w-4"
            />
            مسجَّل ضريبيًا
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>عدد الأولاد</Label>
          <Input
            type="number"
            min={0}
            value={form.children_count}
            onChange={(e) => set("children_count", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الوزن (كجم)</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.local_order_weight_kg}
            onChange={(e) => set("local_order_weight_kg", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>بريد إلكتروني 2</Label>
          <Input value={form.email_2} onChange={(e) => set("email_2", e.target.value)} dir="ltr" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>واتساب الأب</Label>
          <Input value={form.father_whatsapp} onChange={(e) => set("father_whatsapp", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>الموقع الإلكتروني</Label>
          <Input value={form.website} onChange={(e) => set("website", e.target.value)} dir="ltr" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>هوية الأب</Label>
          <Input value={form.father_id_number} onChange={(e) => set("father_id_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>هوية الأم</Label>
          <Input value={form.mother_id_number} onChange={(e) => set("mother_id_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>بيانات الكفيل التفصيلية</Label>
          <Textarea
            value={form.guarantor_details}
            onChange={(e) => set("guarantor_details", e.target.value)}
            rows={2}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>ملاحظة عامة</Label>
          <Textarea value={form.general_note} onChange={(e) => set("general_note", e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
            <Save className="h-4 w-4" />
            {save.isPending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
          </Button>
          {!dirty && <span className="text-xs text-muted-foreground">لا تعديلات لحفظها</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function MedicalHistoryTab({ patientId }: { patientId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ["patient-history", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_medical_history")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState({
    personal_history: "",
    treatment_history: "",
    family_history: "",
    drug_allergy: "",
    special_habits: "",
  });

  useEffect(() => {
    if (history.data) {
      setForm({
        personal_history: history.data.personal_history ?? "",
        treatment_history: history.data.treatment_history ?? "",
        family_history: history.data.family_history ?? "",
        drug_allergy: history.data.drug_allergy ?? "",
        special_habits: history.data.special_habits ?? "",
      });
    }
  }, [history.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: affectedRows, error } = await supabase
        .from("patient_medical_history")
        .upsert({ patient_id: patientId, ...form, updated_at: new Date().toISOString() })
        .select("patient_id");
      if (error) throw error;
      // بلا فحص الصفوف المتأثّرة: رفض RLS لا يرفع خطأً دائمًا، فتبقى حساسية
      // الدواء معروضة على الشاشة من حالة المكوّن كأنها محفوظة، ولا يتبيّن
      // ضياعها إلا عند إعادة فتح الملف.
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُحفظ السوابق الصحية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-history", patientId] });
      toast({ title: "تم حفظ السوابق الصحية" });
    },
    // كانت بلا `onError` وبلا معالج أخطاء عام في `QueryClient`: فشل الحفظ كان
    // يمضي بصمت — لا نجاح ولا خطأ — وهو أسوأ من رسالة خطأ صريحة.
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ السوابق الصحية",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>السوابق الصحية</CardTitle>
        <CardDescription>سوابق شخصية وعلاجية وعائلية وحساسية الأدوية والعادات الخاصة</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>سوابق شخصية</Label>
          <Textarea value={form.personal_history} onChange={(e) => set("personal_history", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>سوابق علاجية</Label>
          <Textarea value={form.treatment_history} onChange={(e) => set("treatment_history", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>سوابق عائلية</Label>
          <Textarea value={form.family_history} onChange={(e) => set("family_history", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>حساسية الأدوية (أو NKA)</Label>
          <Textarea value={form.drug_allergy} onChange={(e) => set("drug_allergy", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>عادات خاصة</Label>
          <Textarea value={form.special_habits} onChange={(e) => set("special_habits", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4" />
            حفظ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NotesTab({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newTitle, setNewTitle] = useState("");
  const [newNote, setNewNote] = useState("");
  const notes = useQuery({
    queryKey: ["patient-notes", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_notes")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PatientNoteRow[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["patient-notes", patientId] });

  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("patient_notes")
        .insert({ patient_id: patientId, title: newTitle.trim() || null, body: newNote.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewTitle("");
      setNewNote("");
      invalidate();
    },
  });

  const toggleDisabled = useMutation({
    mutationFn: async (note: PatientNoteRow) => {
      const { data: affectedRows, error } = await supabase
        .from("patient_notes")
        .update({ is_disabled: !note.is_disabled })
        .eq("id", note.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: invalidate,
  });

  const removeNote = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("patient_notes").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>الملاحظات</CardTitle>
        <CardDescription>سجل زمني للملاحظات والمتابعة، بعنوان ونص وإمكانية تعطيل أو حذف كل ملاحظة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="عنوان الملاحظة (اختياري)" />
          <div className="flex gap-2">
            <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="أضف ملاحظة جديدة..." />
            <Button disabled={!newNote.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {(notes.data ?? []).map((note) => (
            <div key={note.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {note.title && <p className="text-sm font-semibold">{note.title}</p>}
                  <p className="text-sm">{note.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(note.created_at).toLocaleString("ar-SA")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {note.is_disabled && <Badge variant="secondary">معطّلة</Badge>}
                  <Button size="sm" variant="outline" onClick={() => toggleDisabled.mutate(note)}>
                    {note.is_disabled ? "تفعيل" : "تعطيل"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeNote.mutate(note.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {(notes.data ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">لا توجد ملاحظات بعد.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الحالة الصحية — قائمة تحقق بالأمراض المزمنة (checkbox + ملاحظة لكل حالة)
// تستخدم جدولي health_conditions / patient_health_conditions الموجودين مسبقًا
// في قاعدة البيانات دون أي واجهة — الفجوة كانت في الواجهة فقط، وليست في المخطط.
// ---------------------------------------------------------------------------
function HealthConditionsTab({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;

  const conditions = useQuery({
    queryKey: ["health-conditions", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // الأمراض المزمنة: صفوف نظامية (organization_id فارغ) + ما تضيفه
      // المنشأة. بلا التقييد كان عضو منشأتين يرى أمراض المنشأة الأخرى أيضًا.
      const { data, error } = await supabase
        .from("health_conditions")
        .select("*")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as HealthConditionRow[];
    },
  });

  const patientConditions = useQuery({
    queryKey: ["patient-conditions", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_health_conditions")
        .select("*")
        .eq("patient_id", patientId);
      if (error) throw error;
      return (data ?? []) as PatientHealthConditionRow[];
    },
  });

  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (patientConditions.data) {
      const map: Record<string, string> = {};
      for (const row of patientConditions.data) map[row.condition_id] = row.note ?? "";
      setNotes(map);
    }
  }, [patientConditions.data]);

  const checkedIds = new Set((patientConditions.data ?? []).filter((r) => r.is_checked).map((r) => r.condition_id));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["patient-conditions", patientId] });

  const toggle = useMutation({
    mutationFn: async ({ conditionId, checked }: { conditionId: string; checked: boolean }) => {
      const { error } = await supabase.from("patient_health_conditions").upsert({
        patient_id: patientId,
        condition_id: conditionId,
        is_checked: checked,
        note: notes[conditionId] ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const saveNote = useMutation({
    mutationFn: async (conditionId: string) => {
      const { data: affectedRows, error } = await supabase
        .from("patient_health_conditions")
        .upsert({
          patient_id: patientId,
          condition_id: conditionId,
          is_checked: checkedIds.has(conditionId),
          note: notes[conditionId]?.trim() || null,
        })
        .select("condition_id");
      if (error) throw error;
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُحفظ الملاحظة — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: invalidate,
    // الحفظ يجري عند مغادرة الحقل (`onBlur`) بلا أي مؤشّر: بلا `onError` كانت
    // الملاحظة تبقى ظاهرة من حالة الشاشة وحدها بعد فشل الكتابة.
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الملاحظة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>الحالة الصحية</CardTitle>
        <CardDescription>حدِّد الحالات المزمنة المنطبقة على المريض، مع ملاحظة اختيارية لكل حالة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {conditions.isLoading && <Skeleton className="h-40 w-full" />}
        {!conditions.isLoading && (conditions.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            لائحة الحالات الصحية غير مُهيَّأة بعد — نفّذ ملف هجرة 0028 على قاعدة بياناتك.
          </p>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(conditions.data ?? []).map((condition) => {
            const isChecked = checkedIds.has(condition.id);
            return (
              <div key={condition.id} className="flex flex-col gap-1.5 rounded-lg border p-2.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={isChecked}
                    onChange={(e) => toggle.mutate({ conditionId: condition.id, checked: e.target.checked })}
                  />
                  {condition.name_ar}
                </label>
                {isChecked && (
                  <Input
                    className="h-8 text-xs"
                    placeholder="ملاحظة (اختياري)"
                    value={notes[condition.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [condition.id]: e.target.value }))}
                    onBlur={() => saveNote.mutate(condition.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// مركز حجوبات المريض — تفعيل/سبب لكل نوع حجب (الحقول موجودة في قاعدة البيانات
// منذ 0002 لكنها كانت تُعرض فقط كشارات للقراءة، بلا أي شاشة للتفعيل)
// ---------------------------------------------------------------------------
const BLOCK_FIELDS: { key: "block_appointments" | "block_invoices" | "block_sms" | "block_file"; reasonKey: "block_appointments_reason" | "block_invoices_reason" | "block_sms_reason" | "block_file_reason"; label: string }[] = [
  { key: "block_appointments", reasonKey: "block_appointments_reason", label: "حجب عن حجز المواعيد" },
  { key: "block_invoices", reasonKey: "block_invoices_reason", label: "حجب عن عمل الفواتير" },
  { key: "block_sms", reasonKey: "block_sms_reason", label: "حجب عن الرسائل النصية" },
  { key: "block_file", reasonKey: "block_file_reason", label: "حجب الملف بالكامل" },
];

function BlockingTab({ patient }: { patient: PatientRow }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(() => {
    const initial: Record<string, string | boolean> = {};
    for (const f of BLOCK_FIELDS) {
      initial[f.key] = patient[f.key];
      initial[f.reasonKey] = patient[f.reasonKey] ?? "";
    }
    return initial;
  });

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      for (const f of BLOCK_FIELDS) {
        patch[f.key] = form[f.key];
        patch[f.reasonKey] = form[f.key] ? (String(form[f.reasonKey] ?? "").trim() || null) : null;
      }
      const { data: affectedRows, error } = await supabase.from("patients").update(patch).eq("id", patient.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient", patient.id] });
      queryClient.invalidateQueries({ queryKey: ["patients-list"] });
      toast({ title: "تم حفظ إعدادات الحجب" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>مركز حجوبات المريض</CardTitle>
        <CardDescription>فعّل الحجب المطلوب واكتب السبب — يؤثر فورًا على الاستقبال والفوترة والمراسلة</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {BLOCK_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-4">
              <Label>{f.label}</Label>
              <Button
                type="button"
                size="sm"
                variant={form[f.key] ? "destructive" : "outline"}
                onClick={() => setForm((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
              >
                {form[f.key] ? "مفعّل" : "غير مفعّل"}
              </Button>
            </div>
            {Boolean(form[f.key]) && (
              <Input
                placeholder="سبب الحجب"
                value={String(form[f.reasonKey] ?? "")}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.reasonKey]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <Button className="self-start" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="h-4 w-4" />
          {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AppointmentsTab({ patientId }: { patientId: string }) {
  const appointments = useQuery({
    queryKey: ["patient-appointments", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, scheduled_start, status, doctor:doctors!appointments_doctor_tenant_fk(name_ar)")
        .eq("patient_id", patientId)
        .order("scheduled_start", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل المواعيد</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(appointments.data ?? []).map((appointment: any) => (
          <div key={appointment.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">د. {appointment.doctor?.name_ar ?? "—"}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.scheduled_start).toLocaleString("ar-SA")}
              </p>
            </div>
            <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
          </div>
        ))}
        {(appointments.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">لا توجد مواعيد سابقة.</p>
        )}
      </CardContent>
    </Card>
  );
}

function InvoicesTab({ patientId }: { patientId: string }) {
  const invoices = useQuery({
    queryKey: ["patient-invoices", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("id, invoice_number, created_at, status, net_amount, remaining_amount")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل الفواتير</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(invoices.data ?? []).map((invoice: any) => (
          <div key={invoice.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">فاتورة #{invoice.invoice_number}</p>
              <p className="text-xs text-muted-foreground">{new Date(invoice.created_at).toLocaleString("ar-SA")}</p>
            </div>
            <div className="text-end">
              <p className="text-sm font-semibold">{Number(invoice.net_amount).toLocaleString("ar-SA")} ر.س</p>
              {Number(invoice.remaining_amount) > 0 && (
                <p className="text-xs text-rose-600">متبقي {Number(invoice.remaining_amount).toLocaleString("ar-SA")}</p>
              )}
            </div>
          </div>
        ))}
        {(invoices.data ?? []).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">لا توجد فواتير سابقة.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * زر الدمج — مكوّن منفصل لأن `usePermissions` خطّاف، ولا يُستدعى داخل JSX
 * ولا داخل شرط. وفصله يُبقي رأس الملف نظيفًا.
 */
function MergeButton({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  if (!can("patients.merge")) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        دمج ملف مكرَّر
      </Button>
      <MergePatientsDialog
        open={open}
        onOpenChange={setOpen}
        primaryPatientId={patientId}
        primaryPatientName={patientName}
      />
    </>
  );
}
