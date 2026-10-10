import { useEffect, useRef, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  Ban,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  Contact2,
  Eye,
  FileBadge,
  FileSpreadsheet,
  LineChart,
  FileSignature,
  FileStack,
  Gift,
  HeartPulse,
  Image as ImageIcon,
  Pencil,
  Pill,
  Plus,
  RefreshCw,
  Receipt,
  Save,
  ShieldCheck,
  Smile,
  Sparkles,
  Stethoscope,
  StickyNote,
  Syringe,
  UserRound,
  Wallet,
  MoreHorizontal,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";
import PatientContactsTab from "@/components/patients/PatientContactsTab";
import MergePatientsDialog from "@/components/patients/MergePatientsDialog";
import PatientCommandsDialog, { usePatientOpenAgreements } from "@/components/patients/PatientCommandsDialog";
import { usePermissions } from "@/lib/permissions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LookupSelect from "@/components/shared/LookupSelect";
import SessionsTab from "@/components/patients/SessionsTab";
import SessionsPanel from "@/components/medical/SessionsPanel";
import VitalsTab from "@/components/patients/VitalsTab";
import CbahiTab from "@/components/patients/CbahiTab";
import { PatientVisitsTab, PatientPrescriptionsTab } from "@/components/patients/PatientContextTabs";
import AgreementsPanel from "@/components/agreements/AgreementsPanel";
import LegacyArchiveTab from "@/components/patients/LegacyArchiveTab";
import WalletTab from "@/components/patients/WalletTab";
import DocumentsTab from "@/components/patients/DocumentsTab";
import RadiologyImagesTab from "@/components/patients/RadiologyImagesTab";
import MedicalReportsTab, { MedicalReportsButton } from "@/components/patients/MedicalReportsTab";
import TransferPatientButton from "@/components/patients/TransferPatientDialog";
import OccupationalExamTab from "@/components/patients/OccupationalExamTab";
import ClaimFormsTab from "@/components/patients/ClaimFormsTab";
import GrowthChartTab from "@/components/patients/GrowthChartTab";
import AllergiesTab from "@/components/patients/AllergiesTab";
import Odontogram from "@/components/medical/Odontogram";
import PatientReportsMenu from "@/components/patients/PatientReportsMenu";
import SendToDoctorDialog from "@/components/patients/SendToDoctorDialog";
import PatientNotesButton, {
  PATIENT_NOTES_KEY,
  useMemberNames,
  usePatientNotes,
} from "@/components/patients/PatientNotesButton";
import {
  PatientFileShell,
  type FileSectionGroup,
  type IdentityField,
} from "@/components/patients/PatientFileShell";
import NewInvoiceDialog from "@/components/billing/InvoiceDock";
import PatientBenefitsTab from "@/components/patients/PatientBenefitsTab";
import InvoiceActions from "@/components/billing/InvoiceActions";
import InvoiceDetailsDialog from "@/components/billing/InvoiceDetailsDialog";
import { RecordPaymentDialog } from "@/components/billing/RecordPaymentDialog";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_LABELS, invoiceAcceptsPayment } from "@/lib/invoice-status";
import { formatAmount, formatDateTime, useLocaleSettings } from "@/lib/locale";
import type { SalesInvoiceStatus, SalesInvoiceWithPatient } from "@/lib/database.types";
import RequiredLabel, {
  DigitCounter,
  digitsOnly,
  hasDigits,
  requiredInputClass,
} from "@/components/shared/RequiredLabel";
import {
  ageFromBirthDate,
  ageMonthsFromBirthDate,
  birthDateFromAge,
  nameWordCount,
  transliterateArabicName,
} from "@/lib/arabic-name";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useToast } from "@/hooks/use-toast";
import { useSessionDoctor } from "@/lib/session-doctor";

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

  /**
   * القسم المعروض. الافتراضيّ «الحالة الصحية» لا «المعلومات الشخصية»: من يفتح
   * ملفًّا طبيًّا يفتحه ليقرأ حالة المريض، والبيانات الشخصية يعرفها من الشريط.
   */
  /**
   * القسم يأتي من العنوان حين يُذكر فيه.
   *
   * روابط `?section=invoices` كانت مكتوبةً في لوحة الاستقبال وفي غيرها منذ
   * أشهر، والشاشة لا تقرأ المعامل أصلًا — فكان الرابط يفتح الملفّ على «الحالة
   * الصحية» أيًّا كان القسم المطلوب. الزرّ يعمل ظاهرًا ولا يصل، وهو أسوأ من
   * زرٍّ لا يعمل لأنّه لا يشتكي منه أحد.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const [section, setSectionState] = useState(sectionParam || "conditions");
  useEffect(() => {
    if (sectionParam && sectionParam !== section) setSectionState(sectionParam);
    // القسم وحده يُتابَع: إضافة `section` تُعيد الضبط كلّما غيّره المستخدم
    // يدويًّا فيصير التنقّل مستحيلًا.
  }, [sectionParam]);
  const setSection = (next: string) => {
    setSectionState(next);
    const params = new URLSearchParams(searchParams);
    params.set("section", next);
    // `replace` لا `push`: تصفّح الأقسام ليس تاريخًا يُرجَع فيه بزرّ الرجوع،
    // وإلّا احتاج الخروج من الملفّ ضغطاتٍ بعدد ما فُتح من أقسام.
    setSearchParams(params, { replace: true });
  };
  /* الاتفاقية ذات المتبقّي لا تُرى إلّا بفتح قسمها، فيخرج المريض وعليه رصيد
     لم يره أحد. التنبيه يظهر فور فتح الملفّ ويقود إلى القسم بضغطة. */
  const [agreementsAlertDismissed, setAgreementsAlertDismissed] = useState(false);
  /** عدد الملاحظات النشطة — على قسم «الملاحظات» في القائمة كما على زرّ الرأس */
  const patientNotes = usePatientNotes(id);
  const activeNotesCount = (patientNotes.data ?? []).filter((note) => !note.is_disabled).length;

  /** عدد الحالات الصحية المؤشَّرة — يظهر في شريط الهوية */
  /**
   * الحساسية النشطة في شريط الهوية.
   *
   * تعليق `PatientFileShell` يَعِد بأن يرى الطبيب «الأمراض المزمنة والحساسية»
   * وهو يكتب الوصفة. الأولى كانت معروضة والثانية لم تكن موجودة في القاعدة
   * أصلًا (0155). الأسماء تُعرض لا العدد: «٣ حساسيات» لا تمنع وصف البنسلين.
   */
  const allergies = useQuery({
    queryKey: ["patient-allergy-count", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_allergies")
        .select("allergen_label, severity_name")
        .eq("patient_id", id)
        .eq("status", "active")
        .limit(20);
      if (error) throw error;
      return (data ?? []) as { allergen_label: string | null; severity_name: string | null }[];
    },
  });

  const chronicCount = useQuery({
    queryKey: ["patient-chronic-count", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { count, error } = await supabase
        .from("patient_health_conditions")
        .select("condition_id", { count: "exact", head: true })
        .eq("patient_id", id)
        .eq("is_checked", true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  /**
   * متبقّي حساب المريض — مجموع المتبقّي على فواتيره غير الملغاة.
   * يُقرأ في الشريط لأنّ من يُنهي زيارة يحتاج أن يعرف قبل خروج المريض لا بعده.
   */
  const accountBalance = useQuery({
    queryKey: ["patient-balance", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("remaining_amount")
        .eq("patient_id", id)
        .neq("status", "void");
      if (error) throw error;
      return (data ?? []).reduce((sum, row: any) => sum + Number(row.remaining_amount ?? 0), 0);
    },
  });

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

  const age = ageFromBirthDate(patient.data.birth_date);
  const genderLabel =
    patient.data.gender === "male" ? "ذكر" : patient.data.gender === "female" ? "أنثى" : null;
  const chronicLabel =
    chronicCount.data === undefined
      ? null
      : chronicCount.data > 0
        ? `${formatAmount(chronicCount.data)} حالة مسجَّلة`
        : "لا يملك أمراضًا مزمنة";
  const balance = accountBalance.data ?? 0;

  /**
   * شريط الهوية: ما يحتاجه من يعمل على الملفّ وهو داخل أيّ قسم.
   * الأمراض المزمنة والمتبقّي بالأحمر لأنّهما يغيّران القرار: الأول يغيّر ما
   * يُوصف، والثاني يغيّر ما يُقبض قبل الخروج.
   */
  const identity: IdentityField[] = [
    { label: "رقم الملف", value: patient.data.file_number },
    { label: "اسم المريض", value: patient.data.name_ar },
    { label: "الاسم الإنجليزي", value: patient.data.name_en },
    { label: "رقم الهوية", value: patient.data.id_number },
    { label: "الجوال", value: patient.data.mobile_number },
    { label: "العمر", value: age !== null ? `${formatAmount(age)} سنة` : null },
    { label: "الجنس", value: genderLabel },
    { label: "الأمراض المزمنة", value: chronicLabel, alert: (chronicCount.data ?? 0) > 0 },
    {
      label: "الحساسية",
      value:
        allergies.data === undefined
          ? null
          : allergies.data.length > 0
            ? allergies.data.map((row) => row.allergen_label ?? "—").join(" • ")
            : "لا حساسية مسجَّلة",
      alert: (allergies.data ?? []).length > 0,
    },
    { label: "التأمين", value: patient.data.insurance_company_name || "لا يوجد" },
    { label: "متبقّي الحساب", value: `${formatAmount(balance)} ر.س`, alert: balance > 0 },
  ];

  const groups: FileSectionGroup[] = [
    {
      key: "medical",
      label: "الملفّ الطبي",
      items: [
        { key: "conditions", label: "الحالة الصحية", icon: HeartPulse },
        {
          key: "allergies",
          label: "الحساسية",
          icon: AlertTriangle,
          badge: (allergies.data ?? []).length || null,
        },
        { key: "odontogram", label: "عيادة الأسنان", icon: Smile },
        { key: "aesthetic", label: "عيادة الجلدية", icon: Sparkles },
        { key: "visits", label: "الزيارات والفحوصات", icon: ClipboardList },
        { key: "vitals", label: "المؤشرات الحيوية", icon: Activity },
        { key: "prescriptions", label: "الوصفات الطبية", icon: Pill },
        { key: "radiology", label: "صور الأشعة", icon: ImageIcon },
        { key: "medical-reports", label: "التقارير الطبية", icon: FileBadge, tone: "violet" },
        { key: "claim-forms", label: "نماذج المطالبات", icon: FileSpreadsheet },
        { key: "occupational", label: "الفحص المهنيّ", icon: Syringe },
        { key: "growth", label: "مخططات النمو", icon: LineChart },
        { key: "cbahi", label: "الجودة والسلامة (CBAHI)", icon: ShieldCheck },
        { key: "documents", label: "المستندات", icon: FileStack },
        { key: "images", label: "صور الملفّ", icon: ImageIcon },
        { key: "signatures", label: "توقيع الملفّ الإلكتروني", icon: Pencil },
      ],
    },
    {
      key: "financial",
      label: "المالي",
      items: [
        { key: "invoices", label: "فواتير المريض", icon: Receipt },
        /* المجانيّ والخصم قرارٌ ماليّ يُسأل عنه، فموضعه المجموعة المالية */
        { key: "benefits", label: "المجانيّات والخصومات", icon: Gift },
        { key: "agreements", label: "الاتفاقيات", icon: FileSignature },
        { key: "sessions", label: "الجلسات", icon: CalendarClock },
        { key: "wallet", label: "المحفظة", icon: Wallet },
      ],
    },
    {
      key: "file",
      label: "الملفّ الشخصي",
      items: [
        { key: "overview", label: "المعلومات الشخصية", icon: UserRound, badge: overviewDirty ? "•" : null },
        { key: "appointments", label: "عرض المواعيد", icon: CalendarDays },
        /* فواتير Kizen ومواعيده واتفاقياته وزياراته — للاطلاع فقط (0194) */
        { key: "legacy", label: "أرشيف النظام السابق", icon: Archive },
        { key: "contacts", label: "المرافقون", icon: Contact2 },
        { key: "notes", label: "الملاحظات", icon: StickyNote, badge: activeNotesCount || null },
        { key: "blocking", label: "الحجب", icon: Ban },
      ],
    },
  ];

  return (
    <PatientFileShell
      identity={identity}
      groups={groups}
      active={section}
      onActiveChange={setSection}
      header={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/patients">
                <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
            <h1 className="text-lg font-bold">{patient.data.name_ar}</h1>
            {/* الملف المدموج يجب أن يُعرف من أول نظرة: من يفتحه يظن أنه ينظر
                إلى سجل كامل، وهو سجل نُقل عنه كل شيء. */}
            {(patient.data as any).merged_into_id && (
              <Badge variant="destructive">ملف مدموج — استخدم الملف الأصلي</Badge>
            )}
            {patient.data.block_file && <Badge variant="destructive">الملف محجوب بالكامل</Badge>}
            {patient.data.block_appointments && <Badge variant="destructive">محجوب عن المواعيد</Badge>}
            {patient.data.block_invoices && <Badge variant="destructive">محجوب عن الفوترة</Badge>}
            {patient.data.block_sms && <Badge variant="secondary">محجوب عن SMS</Badge>}
            <OpenAgreementsBadge patientId={patient.data.id} onOpen={() => setSection("agreements")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* الملاحظات أوّل الأزرار ولكلّ الأدوار: الطبيب يكتب، والاستقبال يرى */}
            <PatientNotesButton
              patientId={patient.data.id}
              patientName={patient.data.name_ar}
              onOpenAll={() => setSection("notes")}
            />
            {/* التقارير الطبية بجانب الملاحظات وبلونٍ مختلف — ومعها تقارير Kizen (0223) */}
            <MedicalReportsButton patientId={patient.data.id} onOpen={() => setSection("medical-reports")} />
            {/* تحويل المريض إلى طبيب آخر: يصير الملفّ مفتوحًا عند الطبيبين (0223) */}
            <TransferPatientButton patient={patient.data} />
            {/* تقارير المريض بنموذج Kizen والملف الموحّد (0212) */}
            <PatientReportsMenu patientId={patient.data.id} />
            <PatientQuickActions patient={patient.data} />
            <MergeButton patientId={patient.data.id} patientName={patient.data.name_ar} />
          </div>
        </div>
      }
    >
      {section === "overview" && (
        <OverviewTab patient={patient.data} draft={overviewDraft} setDraft={setOverviewDraft} />
      )}
      {section === "conditions" && (
        <div className="flex flex-col gap-4">
          <HealthConditionsTab patientId={patient.data.id} />
          <MedicalHistoryTab patientId={patient.data.id} />
        </div>
      )}
      {section === "allergies" && <AllergiesTab patientId={patient.data.id} />}
      {section === "contacts" && <PatientContactsTab patientId={id!} />}
      {section === "notes" && <NotesTab patientId={patient.data.id} />}
      {section === "medical-reports" && <MedicalReportsTab patientId={patient.data.id} />}
      {section === "claim-forms" && <ClaimFormsTab patientId={patient.data.id} />}
      {section === "occupational" && <OccupationalExamTab patientId={patient.data.id} />}
      {section === "growth" && <GrowthChartTab patientId={patient.data.id} />}
      {section === "blocking" && <BlockingTab patient={patient.data} />}
      {section === "visits" && <PatientVisitsTab patientId={patient.data.id} />}
      {section === "vitals" && <VitalsTab patientId={patient.data.id} />}
      {section === "prescriptions" && <PatientPrescriptionsTab patientId={patient.data.id} />}
      {/* لوحان لا واحد: `SessionsPanel` هو الجانب السريري (الجهاز والمنطقة
          والإعدادات والأعراض وصور قبل/بعد)، و`SessionsTab` هو الجانب التعاقدي
          (جلسات اتفاقية العلاج وكمّها المتفَق عليه). دمجُهما يخلط قرار الطبيب
          بحساب المال. */}
      {section === "aesthetic" && <SessionsPanel patientId={patient.data.id} />}
      {section === "sessions" && <SessionsTab patientId={patient.data.id} />}
      {section === "cbahi" && <CbahiTab patientId={patient.data.id} />}
      {section === "invoices" && <InvoicesTab patientId={patient.data.id} />}
      {section === "benefits" && <PatientBenefitsTab patientId={patient.data.id} />}
      {/* اتفاقيات المريض وعروض أسعارها (0193) — نفس اللوح الذي في المحاسبة
          مقيّدًا بهذا المريض، فتُنشأ الاتفاقية من ملفّه بلا بحثٍ عنه. */}
      {section === "agreements" && (
        <AgreementsPanel organizationId={patient.data.organization_id} patientId={patient.data.id} />
      )}
      {section === "wallet" && <WalletTab patientId={patient.data.id} />}
      {section === "appointments" && <AppointmentsTab patientId={patient.data.id} />}
      {section === "legacy" && <LegacyArchiveTab patientId={patient.data.id} />}
      {section === "documents" && <DocumentsTab patientId={patient.data.id} kind="document" />}
      {/* صور الملفّ وتواقيعه هما **نفس** الجدول برشّاحٍ مختلف، لا شاشتان:
          `patient_documents.category = 'image'` و`signed_at is not null`
          عمودان قائمان منذ 0037. شاشةٌ ثالثة كانت ستُكرّر الرفع والأرشفة
          والتوقيع ثلاث مرّات ثم تفترق إحداها عن الأخريين. */}
      {section === "images" && <DocumentsTab patientId={patient.data.id} kind="image" />}
      {section === "signatures" && <DocumentsTab patientId={patient.data.id} kind="signed" />}
      {section === "radiology" && <RadiologyImagesTab patientId={patient.data.id} />}
      {section === "odontogram" && <Odontogram patientId={patient.data.id} />}
    </PatientFileShell>
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
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const [sendOpen, setSendOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);

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
  /**
   * والطبيب لا يُصدر فاتورة (0173) — ولو كان الداخلُ مالكًا يعاين بصفته:
   * المعاينة التي تُظهر ما لا يراه الطبيب الحقيقيّ تكذب على من يجرّبها.
   */
  const { isDoctorRole } = useSessionDoctor();
  const canBill =
    !isDoctorRole &&
    (legacyMode ||
      ["owner", "organization_admin", "accountant", "receptionist"].includes(
        membership?.role_key ?? "",
      ));

  /**
   * `?action=send-to-doctor` — يصل من قائمة أوامر الملفّ حين تُفتح من شاشةٍ
   * أخرى (الطابور، جدول المواعيد). بلا هذا يصل الموظّف إلى الملفّ ثم يبحث
   * عن الزرّ الذي كان قد ضغطه لتوّه.
   *
   * والمعامل يُستهلَك مرّةً: إبقاؤه يُعيد فتح النافذة كلّما أُغلقت.
   */
  const [actionParams, setActionParams] = useSearchParams();
  useEffect(() => {
    if (actionParams.get("action") !== "send-to-doctor") return;
    const next = new URLSearchParams(actionParams);
    next.delete("action");
    setActionParams(next, { replace: true });
    if (!canQueue || patient.block_appointments || patient.block_file) return;
    setSendOpen(true);
  }, [actionParams.get("action"), canQueue]);

  return (
    <>
      {/* أوامر الملفّ — مدخلٌ واحد إلى كل ما يُفعل بالمريض. يبقى «إصدار
          فاتورة» و«إرسال إلى الطبيب» زرَّين ظاهرين لأنّهما الأكثر استعمالًا،
          والبقيّة خلف هذا الزرّ بدل أن تُفرَّق على الشاشات. */}
      <Button size="sm" variant="outline" onClick={() => setCommandsOpen(true)}>
        <MoreHorizontal className="h-3.5 w-3.5" />
        أوامر على الملفّ
      </Button>
      {canBill && !patient.block_invoices && !patient.block_file && (
        <Button size="sm" variant="outline" onClick={() => setInvoiceOpen(true)}>
          <Receipt className="h-3.5 w-3.5" />
          إصدار فاتورة
        </Button>
      )}
      {/* حجز موعد: يفتح جدول اليوم (عمودٌ لكلّ طبيب، والمتاح ملوَّن) والمريض
          محمولٌ فيه — تختار الطبيب والوقت بعينك ثمّ تؤكّد، بدل نافذةٍ تُكتب
          فيها الساعة ثمّ يُكتشف أنّ الطبيب مشغول. نفس صفات «موعد جديد» في
          شاشة المواعيد، ويحترم حظر المواعيد في الملفّ. */}
      {canQueue && !patient.block_appointments && !patient.block_file && (
        <Button size="sm" variant="outline" className="border-primary/50 text-primary" asChild>
          <Link to={`/appointments?bookFor=${patient.id}`}>
            <CalendarPlus className="h-3.5 w-3.5" />
            حجز موعد جديد
          </Link>
        </Button>
      )}
      {canQueue && !patient.block_appointments && !patient.block_file && (
        <Button size="sm" onClick={() => setSendOpen(true)}>
          <Stethoscope className="h-3.5 w-3.5" />
          إرسال إلى الطبيب
        </Button>
      )}
      {/**
        * الفاتورة تُفتح **فوق ملفّ المريض** لا بالانتقال إلى شاشة الفواتير.
        *
        * الانتقال كان يُخرج الموظف من الملفّ ثم يطلب منه البحث عن المريض الذي
        * هو واقف في ملفّه — والأسوأ أنه يفقد سياق ما كان يفعله. والنافذة هنا
        * هي **نفسها** نافذة شاشة الفواتير بكل قواعدها، والمريض مُدرَج فيها
        * سلفًا ببياناته التأمينية.
        *
        * `invoiceOpen &&` شرطٌ للتركيب لا للعرض: النافذة تجلب الأطباء والعيادات
        * والمخازن والمجموعات السريعة وبنود الاتفاقيات، وتحميل ذلك كلّه مع كل
        * فتح لملفّ مريض هدرٌ لا يستفيد منه من لا يُفوتر.
        */}
      {invoiceOpen && organization?.id && (
        <NewInvoiceDialog
          open={invoiceOpen}
          onOpenChange={setInvoiceOpen}
          organizationId={organization.id}
          vatRate={organization.default_vat_rate ?? 15}
          appointment={{
            id: null,
            patient_id: patient.id,
            doctor_id: patient.treating_doctor_id,
            clinic_id: null,
            patient: {
              id: patient.id,
              name_ar: patient.name_ar,
              insurance_company_name: patient.insurance_company_name,
              insurance_policy_number: patient.insurance_policy_number,
              insurance_policy_category: patient.insurance_policy_category,
              insurance_membership_number: patient.insurance_membership_number,
            },
          }}
        />
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
      {/* عرض السعر هو **نفس** نافذة الفاتورة بعلم `isQuote`: الحقول والقواعد
          والضريبة واحدة، والفارق أنّه يُحفظ `is_temporary` فلا يُحتسب ذمّةً
          على المريض حتى يُحوَّل. نافذةٌ ثانية كانت ستفترق عن الأولى بعد أوّل
          تعديل. */}
      {quoteOpen && organization?.id && (
        <NewInvoiceDialog
          open={quoteOpen}
          onOpenChange={setQuoteOpen}
          organizationId={organization.id}
          vatRate={organization.default_vat_rate ?? 15}
          isQuote
          appointment={{
            id: null,
            patient_id: patient.id,
            doctor_id: patient.treating_doctor_id,
            clinic_id: null,
            patient: {
              id: patient.id,
              name_ar: patient.name_ar,
              insurance_company_name: patient.insurance_company_name,
              insurance_policy_number: patient.insurance_policy_number,
              insurance_policy_category: patient.insurance_policy_category,
              insurance_membership_number: patient.insurance_membership_number,
            },
          }}
        />
      )}
      <PatientCommandsDialog
        patient={{
          id: patient.id,
          name_ar: patient.name_ar,
          file_number: patient.file_number,
          block_file: patient.block_file,
          block_invoices: patient.block_invoices,
          block_appointments: patient.block_appointments,
        }}
        open={commandsOpen}
        onOpenChange={setCommandsOpen}
        onNewInvoice={canBill ? () => setInvoiceOpen(true) : undefined}
        onNewQuote={canBill ? () => setQuoteOpen(true) : undefined}
        onSendToDoctor={canQueue ? () => setSendOpen(true) : undefined}
      />
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
    // الطول شرطٌ لا الوجود — والقاعدة ترفض الناقص كذلك (0147)
    id_number: !patient.is_newborn && !hasDigits(form.id_number),
    mobile_number: !hasDigits(form.mobile_number),
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
        description: errorMessage(error),
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>هاتف إضافي</Label>
          <Input value={form.phone_1} onChange={(e) => set("phone_1", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <RequiredLabel missing={missing.id_number}>رقم الهوية/الإقامة</RequiredLabel>
          <div className="flex items-center gap-2">
            <Input
              value={form.id_number}
              dir="ltr"
              inputMode="numeric"
              placeholder="١٠ أرقام"
              onChange={(e) => set("id_number", digitsOnly(e.target.value))}
              className={requiredInputClass(missing.id_number)}
            />
            <DigitCounter value={form.id_number} />
          </div>
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
            centered
            title="الجنسية"
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
        description: errorMessage(error),
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

/**
 * ملاحظات المريض — شبكةٌ فوق ولوحُ تحريرٍ تحت، بنمط بقيّة الشاشات.
 *
 * كانت الملاحظات بطاقاتٍ متتالية بحقل إضافةٍ دائم فوقها: مريضٌ له عشرون
 * ملاحظة يصير عمودًا لا يُمسح بالعين، ولا يُعرف من كتب ملاحظةً ولا متى بلا
 * قراءة كل بطاقة. الشبكة تُظهر التاريخ والعنوان والكاتب في صفٍّ واحد،
 * واللوح تحتها يعرض نصّ المختارة كاملًا.
 *
 * **لا حذف نهائيّ:** الملاحظة بيانٌ طبيّ، وقاعدة المشروع تمنع محوه — كان
 * زرّ سلّة يمحو الصفّ من `patient_notes` بلا رجعة ولا سجلّ. صار «تعطيل»:
 * الملاحظة تخرج من العرض الافتراضيّ ويبقى نصّها وكاتبها وتاريخها.
 */
function NotesTab({ patientId }: { patientId: string }) {
  const { calendarDisplay } = useLocaleSettings();
  const { session } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const memberNames = useMemberNames();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "new" | "edit">("idle");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);

  // المفتاح نفسه الذي يقرؤه زرّ «الملاحظات» في رأس الملفّ
  const notes = usePatientNotes(patientId);

  const all = notes.data ?? [];
  const rows = showDisabled ? all : all.filter((note) => !note.is_disabled);
  const selected = all.find((note) => note.id === selectedId) ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: PATIENT_NOTES_KEY(patientId) });
    queryClient.invalidateQueries({ queryKey: ["patient-note-counts"] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({ variant: "destructive", title, description: errorMessage(error) });

  const closeEditor = () => {
    setMode("idle");
    setDraftTitle("");
    setDraftBody("");
  };

  const saveNote = useMutation({
    mutationFn: async () => {
      const title = draftTitle.trim() || null;
      const body = draftBody.trim();
      if (!body) throw new Error("نصّ الملاحظة مطلوب");
      if (mode === "edit") {
        if (!selected) throw new Error("لم تُختَر ملاحظة");
        const { data: affectedRows, error } = await supabase
          .from("patient_notes")
          .update({ title, body })
          .eq("id", selected.id)
          .select("id");
        if (error) throw error;
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
        return selected.id;
      }
      const { data, error } = await supabase
        .from("patient_notes")
        // الكاتب يُسجَّل هنا: العمود موجود منذ 0002 وكان يُترك فارغًا، فلا
        // يُعرف من كتب ملاحظةً في ملفٍّ يشترك فيه الاستقبال والطبيب.
        .insert({ patient_id: patientId, title, body, created_by: session?.user.id ?? null })
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      closeEditor();
      setSelectedId(id);
      invalidate();
    },
    onError: fail("تعذّر حفظ الملاحظة"),
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
    onError: fail("تعذّر تغيير حالة الملاحظة"),
  });

  const editing = mode !== "idle";

  return (
    <div className="flex flex-col gap-3">
      <ScreenToolbar
        items={[
          {
            key: "new",
            label: "ملاحظة جديدة",
            icon: Plus,
            disabled: editing,
            onClick: () => {
              setDraftTitle("");
              setDraftBody("");
              setMode("new");
            },
          },
          {
            key: "edit",
            label: "تعديل",
            icon: Pencil,
            disabled: !selected || editing,
            title: selected ? "تعديل الملاحظة المختارة" : "اختر ملاحظة من الجدول أوّلًا",
            onClick: () => {
              if (!selected) return;
              setDraftTitle(selected.title ?? "");
              setDraftBody(selected.body);
              setMode("edit");
            },
          },
          {
            key: "toggle",
            label: selected?.is_disabled ? "تفعيل" : "تعطيل",
            icon: Ban,
            disabled: !selected || editing || toggleDisabled.isPending,
            title: "الملاحظة بيانٌ طبيّ لا يُمحى — التعطيل يُخفيها ويُبقي نصّها",
            onClick: () => selected && toggleDisabled.mutate(selected),
          },
          { key: "sep1", separator: true },
          {
            key: "refresh",
            label: "تحديث",
            icon: RefreshCw,
            onClick: () => void notes.refetch(),
          },
          {
            key: "showDisabled",
            label: showDisabled ? "إخفاء المعطّلة" : "إظهار المعطّلة",
            icon: Eye,
            onClick: () => setShowDisabled((prev) => !prev),
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>الملاحظات</CardTitle>
          <CardDescription>
            سجلّ زمنيّ لملاحظات المتابعة — اختر صفًّا ليظهر نصّه كاملًا تحت الجدول
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notes.isLoading && <Skeleton className="h-32 w-full" />}
          {notes.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر تحميل الملاحظات: {errorMessage(notes.error)}
            </p>
          )}
          {!notes.isLoading && !notes.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>العنوان</TableHead>
                  <TableHead>الملاحظة</TableHead>
                  <TableHead>بواسطة</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((note) => (
                  <TableRow
                    key={note.id}
                    onClick={() => {
                      if (editing) return;
                      setSelectedId(note.id);
                    }}
                    aria-selected={note.id === selectedId}
                    className={
                      note.id === selectedId
                        ? "cursor-pointer bg-accent"
                        : "cursor-pointer hover:bg-accent/50"
                    }
                  >
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(note.created_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="font-medium">{note.title ?? "—"}</TableCell>
                    <TableCell className="max-w-[24rem] truncate">{note.body}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {note.created_by ? memberNames.data?.[note.created_by] ?? "—" : "—"}
                    </TableCell>
                    <TableCell>
                      {note.is_disabled ? (
                        <Badge variant="secondary">معطّلة</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">نشطة</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      {all.length > 0 ? "كل الملاحظات معطّلة — اضغط «إظهار المعطّلة»." : "لا توجد ملاحظات بعد."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!notes.isLoading && !notes.isError && <GridFooterCount count={rows.length} />}
      </Card>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {mode === "new" ? "ملاحظة جديدة" : "تعديل الملاحظة"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="عنوان الملاحظة (اختياري)"
            />
            <Textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={5}
              placeholder="نصّ الملاحظة..."
            />
            <div className="flex items-center gap-2">
              <Button
                disabled={!draftBody.trim() || saveNote.isPending}
                onClick={() => saveNote.mutate()}
              >
                <Save className="h-4 w-4" />
                {saveNote.isPending ? "جارٍ الحفظ..." : "حفظ"}
              </Button>
              <Button variant="outline" onClick={closeEditor} disabled={saveNote.isPending}>
                إلغاء
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!editing && selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{selected.title ?? "ملاحظة"}</CardTitle>
            <CardDescription>
              {formatDateTime(selected.created_at, calendarDisplay)}
              {selected.created_by && memberNames.data?.[selected.created_by]
                ? ` · ${memberNames.data[selected.created_by]}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{selected.body}</p>
          </CardContent>
        </Card>
      )}
    </div>
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
        description: errorMessage(error),
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
        description: errorMessage(error),
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
        description: errorMessage(error),
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
  const { calendarDisplay } = useLocaleSettings();
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
                {formatDateTime(appointment.scheduled_start, calendarDisplay)}
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

/**
 * سجلّ فواتير المريض — قابل للفتح والسداد.
 *
 * كان صفوفًا جامدة: يرى الموظّف «متبقّي 28.75» ولا يعرف ممّ تتكوّن الفاتورة
 * ولا يستطيع قبض المتبقّي، فيغادر الملفّ إلى شاشة الفواتير ويبحث من جديد.
 * والمبالغ كانت تُنسَّق بـ`toLocaleString("ar-SA-u-nu-latn")` فتخرج بأرقام عربية-هندية
 * وتاريخٍ هجريّ مخالفًا لبقيّة النظام — و`lib/locale` موجودة لهذا بالضبط.
 */
function InvoicesTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const { calendarDisplay } = useLocaleSettings();
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<SalesInvoiceWithPatient | null>(null);
  /**
   * اسم من يطبع يظهر في تذييل الورقة — «من أصدرها؟» جوابه على الورقة نفسها.
   */
  const { session: printSession } = useOrganizationAccess();
  const memberNames = useMemberNames();
  const printedByName = printSession?.user.id
    ? memberNames.data?.[printSession.user.id] ?? null
    : null;
  /** الكل / الآجل / المدفوع — المرشّحات الثلاثة نفسها في النظام المرجعيّ. */
  const [scope, setScope] = useState<"all" | "credit" | "settled">("all");

  const canReceive = can("cashier.receive");

  const invoices = useQuery({
    queryKey: ["patient-invoices", organization?.id, patientId, scope],
    enabled: Boolean(organization?.id && patientId),
    queryFn: async () => {
      let query = supabase
        .from("v_patient_invoices")
        .select(
          "id, invoice_number, created_at, status, is_temporary, invoice_type, works, lines_count, " +
            "subtotal_amount, discount_amount, vat_amount, net_amount, paid_amount, remaining_amount, " +
            "doctor_name, is_credit, is_settled",
        )
        // RLS يسمح بكل مؤسّسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organization?.id)
        .eq("patient_id", patientId);
      if (scope === "credit") query = query.eq("is_credit", true);
      if (scope === "settled") query = query.eq("is_settled", true);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * المجاميع تُحسب في القاعدة على **كلّ** فواتير المريض لا على المعروض.
   *
   * جمعُها في المتصفّح كان سيجمع المائتين المعروضة، فيخرج «المتبقّي» أصغر من
   * الحقيقة لمريضٍ له أكثر — ورقمٌ ماليّ ناقصٌ يبدو صحيحًا أسوأ من لا رقم.
   */
  const totals = useQuery({
    queryKey: ["patient-invoice-totals", organization?.id, patientId, scope],
    enabled: Boolean(organization?.id && patientId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_patient_invoice_totals", {
        p_organization_id: organization?.id,
        p_patient_id: patientId,
        p_scope: scope,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as {
        invoice_count: number;
        before_discount: number;
        discount_total: number;
        discount_percent: number;
        after_discount: number;
        vat_total: number;
        paid_total: number;
        collection_percent: number;
        remaining_total: number;
      } | null;
    },
  });

  const rows = invoices.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>فواتير المريض</CardTitle>
          <CardDescription>اضغط الفاتورة لعرض بنودها ودفعاتها</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-md border p-1 text-xs">
          {([
            { key: "all", label: "الكل" },
            { key: "credit", label: "الآجل" },
            { key: "settled", label: "المدفوع" },
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setScope(option.key)}
              className={`rounded px-2.5 py-1 ${
                scope === option.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {invoices.isLoading && <Skeleton className="h-40 w-full" />}
        {invoices.isError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            تعذّر تحميل الفواتير: {errorMessage(invoices.error)} — إن لم تُنفَّذ الترقية{" "}
            <span className="font-mono">0162</span> على القاعدة بعد، نفِّذها.
          </p>
        )}

        {!invoices.isLoading && !invoices.isError && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 whitespace-nowrap">العدد</TableHead>
                  <TableHead className="whitespace-nowrap">رقم الفاتورة</TableHead>
                  <TableHead className="whitespace-nowrap">التاريخ</TableHead>
                  <TableHead className="min-w-[14rem]">الأعمال</TableHead>
                  <TableHead className="whitespace-nowrap">الإجمالي</TableHead>
                  <TableHead className="whitespace-nowrap">الخصومات</TableHead>
                  <TableHead className="whitespace-nowrap">الصافي</TableHead>
                  <TableHead className="whitespace-nowrap">المدفوع</TableHead>
                  <TableHead className="whitespace-nowrap">المتبقّي</TableHead>
                  <TableHead className="whitespace-nowrap">الطبيب</TableHead>
                  <TableHead className="w-24 whitespace-nowrap">إجراء</TableHead>
                  <TableHead className="w-28 whitespace-nowrap">الورقة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((invoice: any, index: number) => {
                  const remaining = Number(invoice.remaining_amount ?? 0);
                  const status = invoice.status as SalesInvoiceStatus;
                  const payable = invoiceAcceptsPayment(status, remaining);
                  return (
                    <TableRow
                      key={invoice.id}
                      className="cursor-pointer"
                      onClick={() => setDetailsId(invoice.id)}
                    >
                      <TableCell className="text-center tabular-nums text-muted-foreground">
                        {formatAmount(index + 1)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium tabular-nums">
                        <span className="flex flex-wrap items-center gap-1">
                          {invoice.invoice_number}
                          {invoice.is_temporary && (
                            <Badge variant="outline" className="text-[10px]">
                              عرض سعر
                            </Badge>
                          )}
                          <Badge className={INVOICE_STATUS_BADGE[status]}>
                            {INVOICE_STATUS_LABELS[status]}
                          </Badge>
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {formatDateTime(invoice.created_at, calendarDisplay)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="line-clamp-2">{invoice.works ?? "—"}</span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatAmount(invoice.subtotal_amount)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatAmount(invoice.discount_amount)}
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {formatAmount(invoice.net_amount)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatAmount(invoice.paid_amount)}
                      </TableCell>
                      <TableCell
                        className={`tabular-nums ${remaining > 0 ? "text-rose-600" : "text-emerald-700"}`}
                      >
                        {formatAmount(remaining)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {invoice.doctor_name ?? "—"}
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        {payable && canReceive && (
                          <Button
                            size="sm"
                            onClick={() => setPayTarget(invoice as SalesInvoiceWithPatient)}
                          >
                            سداد
                          </Button>
                        )}
                      </TableCell>
                      {/* الضغط على الصفّ يفتح التفاصيل، فالأزرار توقف الانتشار
                          وإلّا فُتحت النافذة مع كل طباعة. */}
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <InvoiceActions
                          invoiceId={invoice.id}
                          printedByName={printedByName}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                      لا فواتير في هذا النطاق.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* شريط المجاميع — الأرقام التسعة نفسها في ذيل الشاشة المرجعيّة */}
        {totals.isError && (
          <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            تعذّر حساب المجاميع: {errorMessage(totals.error)} — الترقية{" "}
            <span className="font-mono">0162</span> تضيف
            <span className="font-mono"> app_patient_invoice_totals</span>. الجدول أعلاه يعمل بدونها.
          </p>
        )}
        {totals.data && (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-4 lg:grid-cols-7">
            <TotalCell label="العدد" value={formatAmount(totals.data.invoice_count)} />
            <TotalCell label="قبل الخصم" value={`${formatAmount(totals.data.before_discount)} ر.س`} />
            <TotalCell label="الخصومات" value={`${formatAmount(totals.data.discount_total)} ر.س`} />
            <TotalCell label="نسبة الخصم" value={`${formatAmount(totals.data.discount_percent)}%`} />
            <TotalCell label="بعد الخصم" value={`${formatAmount(totals.data.after_discount)} ر.س`} />
            <TotalCell label="المدفوعات" value={`${formatAmount(totals.data.paid_total)} ر.س`} />
            <TotalCell
              label="نسبة التحصيل"
              value={`${formatAmount(totals.data.collection_percent)}%`}
            />
            <TotalCell
              label="المتبقّي"
              value={`${formatAmount(totals.data.remaining_total)} ر.س`}
              alert={Number(totals.data.remaining_total) > 0}
            />
          </div>
        )}
      </CardContent>

      <InvoiceDetailsDialog
        invoiceId={detailsId}
        onOpenChange={() => setDetailsId(null)}
        canPay={canReceive}
        onPay={(invoice) => {
          setDetailsId(null);
          setPayTarget(invoice);
        }}
      />
      <RecordPaymentDialog
        invoice={payTarget}
        onOpenChange={() => setPayTarget(null)}
        organizationId={organization?.id}
      />
    </Card>
  );
}

function TotalCell({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${alert ? "text-rose-600" : ""}`}>
        {value}
      </span>
    </div>
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

/**
 * تنبيه الاتفاقيات في رأس الملفّ — كسطر Kizen الأصفر «العميل عليه اتفاقيات
 * عليها متبقي». يظهر وحده إن كان عليه متبقٍّ (لا المعطّلة ولا ما أُلغيت
 * مديونيته)، والضغط يفتح قسم الاتفاقيات.
 */
function OpenAgreementsBadge({ patientId, onOpen }: { patientId: string; onOpen: () => void }) {
  const open = usePatientOpenAgreements(patientId);
  const row = open.data;
  if (!row || Number(row.open_count) <= 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-md border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-200"
      title="عرض الاتفاقيات"
    >
      اتفاقيات عليها متبقٍّ: {formatAmount(row.open_count)} — {formatAmount(row.remaining_total)} ر.س
    </button>
  );
}
