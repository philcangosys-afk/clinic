import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Download,
  MessageSquareShare,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { useSessionDoctor } from "@/lib/session-doctor";
import type { PatientRow } from "@/lib/database.types";
import { PatientSearchScopeChips } from "@/components/shared/PatientSearchInput";
import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";
import { Checkbox } from "@/components/ui/checkbox";
import DeleteRowsDialog, { useRowSelection } from "@/components/shared/DeleteRowsDialog";
import {
  buildPatientSearchOr,
  patientSearchPlaceholder,
  PATIENTS_SEARCH_COLUMNS,
  type PatientSearchScope,
} from "@/lib/patient-search";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LookupSelect from "@/components/shared/LookupSelect";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import NewPatientDialog from "@/components/patients/NewPatientDialog";
import CsvImportDialog, { type CsvColumn } from "@/components/shared/CsvImportDialog";
import { errorMessage } from "@/lib/error-message";
import { formatDate, useLocaleSettings } from "@/lib/locale";

/**
 * شاشة المرضى مع البحث المتقدم (لقطة 29 — "مستعرض العيادة السريع").
 *
 * كانت الشاشة تحتوي حقل بحث واحدًا فقط (اسم/جوال/رقم ملف) مقابل ~15 معيار
 * بحث في النظام القديم، بلا تصدير. هذه النسخة تضيف الفلاتر المتقدمة والتصدير
 * مع إبقاء البحث السريع كما هو للاستخدام اليومي.
 */
const RESULT_CAP = 200;
const NO_DOCTOR_FILTER = "__all__";

type PatientListRow = Pick<
  PatientRow,
  | "id"
  | "file_number"
  | "name_ar"
  | "name_en"
  | "mobile_number"
  | "gender"
  | "birth_date"
  | "id_number"
  | "file_date"
  | "block_appointments"
  | "block_invoices"
  | "block_file"
  | "block_sms"
  | "insurance_company_name"
>;

type Filters = {
  gender: string;
  sourceValueId: string;
  nationalityValueId: string;
  workEntityValueId: string;
  professionValueId: string;
  cityValueId: string;
  customerTypeValueId: string;
  educationValueId: string;
  maritalStatus: string;
  doctorId: string;
  fileNumberFrom: string;
  fileNumberTo: string;
  ageFrom: string;
  ageTo: string;
  fileDateFrom: string;
  fileDateTo: string;
  birthFrom: string;
  birthTo: string;
  blockedOnly: boolean;
};

const EMPTY_FILTERS: Filters = {
  gender: "all",
  sourceValueId: "",
  nationalityValueId: "",
  workEntityValueId: "",
  professionValueId: "",
  cityValueId: "",
  customerTypeValueId: "",
  educationValueId: "",
  maritalStatus: "all",
  doctorId: "",
  fileNumberFrom: "",
  fileNumberTo: "",
  ageFrom: "",
  ageTo: "",
  fileDateFrom: "",
  fileDateTo: "",
  birthFrom: "",
  birthTo: "",
  blockedOnly: false,
};

/** أعمدة قائمة المرضى — مشتركة بين مصدرَي القراءة فلا يفترق أحدهما. */
const PATIENT_LIST_COLUMNS =
  "id, file_number, name_ar, name_en, mobile_number, gender, birth_date, id_number, " +
  "file_date, block_appointments, block_invoices, block_file, block_sms, insurance_company_name";

function usePatientsList(
  organizationId: string | undefined,
  search: string,
  searchScopes: PatientSearchScope[],
  filters: Filters,
  /**
   * حصرُ القائمة على مرضى طبيبٍ بعينه.
   *
   * حين يُمرَّر، تُقرأ القائمة من `v_doctor_patients` (0164) بدل جدول
   * `patients`: المنظور يُعرّف «مريض الطبيب» بالعلاقات الأربع التي حدّدها
   * المالك — المعالج، والمشارك، وصاحب الموعد، وصاحب الزيارة — ويعطي صفًّا
   * لكل زوج (طبيب، مريض). والأعمدة نفسها لأنّ المنظور يمرّر `patients.*`،
   * فلا يتغيّر شيءٌ في بقيّة الشاشة.
   *
   * ولا يُطبَّق الحصر في المتصفّح: القائمة محدودة بسقفٍ من الصفوف، فترشيحُ
   * الظاهر منها يترك الطبيب يرى «لا نتائج» ومريضه في الصفحة التالية.
   */
  scopedDoctorId?: string | null,
) {
  return useQuery({
    queryKey: [
      "patients-list",
      organizationId,
      search,
      searchScopes.join("+"),
      filters,
      scopedDoctorId ?? "",
    ],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // الفرعان مكتوبان صراحةً لا باسمٍ محسوب: مدقّق الاكتمال يمسح
      // `from("NAME")` حرفيًّا، واسمٌ داخل شرطٍ ثلاثيّ يجعله يُعلن المنظور
      // ميتًا وهو مستعمَل.
      let query = scopedDoctorId
        ? supabase
            .from("v_doctor_patients")
            .select(PATIENT_LIST_COLUMNS)
            .eq("organization_id", organizationId)
            .eq("doctor_id", scopedDoctorId)
        : supabase
            .from("patients")
            .select(PATIENT_LIST_COLUMNS)
            .eq("organization_id", organizationId);
      query = query
        /**
         * الملفات المدموجة تُستثنى. دالّة الدمج `app_merge_patients` تُعلّم
         * المكرَّر بـ`merged_into_id` وتضع عليه `block_appointments` فقط — لا
         * `block_sms` ولا `block_file` — فمرشّحا الرسائل الجماعية لا يمسّانه:
         * كان الشخص يستقبل رسالتين ويُخصم رصيد رسالتين، ويفتح الموظف الملف
         * الميّت فيجده فارغًا.
         */
        .is("merged_into_id", null)
        .order("created_at", { ascending: false })
        .limit(RESULT_CAP);

      // البحث الموحَّد: الاسم والجوال والهوية — أو ما تحصره أزرار النطاق
      const searchFilter = buildPatientSearchOr(search, searchScopes, PATIENTS_SEARCH_COLUMNS);
      if (searchFilter) query = query.or(searchFilter);

      if (filters.gender !== "all") query = query.eq("gender", filters.gender);
      if (filters.sourceValueId) query = query.eq("source_value_id", filters.sourceValueId);
      if (filters.nationalityValueId) query = query.eq("nationality_value_id", filters.nationalityValueId);
      if (filters.workEntityValueId) query = query.eq("work_entity_value_id", filters.workEntityValueId);
      if (filters.professionValueId) query = query.eq("profession_value_id", filters.professionValueId);
      if (filters.cityValueId) query = query.eq("city_value_id", filters.cityValueId);
      if (filters.customerTypeValueId) query = query.eq("customer_type_value_id", filters.customerTypeValueId);
      if (filters.educationValueId)
        query = query.eq("educational_qualification_value_id", filters.educationValueId);
      if (filters.maritalStatus !== "all") query = query.eq("marital_status", filters.maritalStatus);
      if (filters.doctorId) query = query.eq("treating_doctor_id", filters.doctorId);
      if (filters.fileNumberFrom) query = query.gte("file_number", Number(filters.fileNumberFrom));
      if (filters.fileNumberTo) query = query.lte("file_number", Number(filters.fileNumberTo));
      // نطاق العمر يُترجم إلى نطاق تاريخ ميلاد: الأكبر سنًّا = تاريخ أقدم.
      if (filters.ageTo) {
        const from = new Date();
        from.setFullYear(from.getFullYear() - Number(filters.ageTo) - 1);
        query = query.gte("birth_date", from.toISOString().slice(0, 10));
      }
      if (filters.ageFrom) {
        const to = new Date();
        to.setFullYear(to.getFullYear() - Number(filters.ageFrom));
        query = query.lte("birth_date", to.toISOString().slice(0, 10));
      }
      if (filters.fileDateFrom) query = query.gte("file_date", filters.fileDateFrom);
      if (filters.fileDateTo) query = query.lte("file_date", filters.fileDateTo);
      if (filters.birthFrom) query = query.gte("birth_date", filters.birthFrom);
      if (filters.birthTo) query = query.lte("birth_date", filters.birthTo);
      // "المحجوبة فقط" تعني أي نوع حجب — الملف أو المواعيد أو الفوترة
      if (filters.blockedOnly)
        query = query.or("block_file.eq.true,block_appointments.eq.true,block_invoices.eq.true");

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatientListRow[];
    },
  });
}

function exportCsv(rows: PatientListRow[]) {
  const headers = ["رقم الملف", "الاسم", "الجوال", "الهوية", "الجنس", "تاريخ الميلاد", "تاريخ التسجيل", "التأمين"];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.file_number,
        row.name_ar,
        row.mobile_number,
        row.id_number,
        row.gender === "male" ? "ذكر" : row.gender === "female" ? "أنثى" : "",
        row.birth_date,
        formatDate(row.file_date) === "—" ? "" : formatDate(row.file_date),
        row.insurance_company_name ?? "نقدي",
      ]
        .map(escape)
        .join(","),
    ),
  ];
  // BOM ليفتح إكسل الملف بترميز عربي صحيح
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `patients-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * أعمدة استيراد المرضى. `file_number` غير مشمول عمدًا: قيمته تأتي من متتالية
 * (`nextval`) في القاعدة، واستيراد أرقام يدوية كان سيصطدم بالمتتالية ويولّد
 * أرقامًا مكرَّرة لاحقًا.
 */
const PATIENT_IMPORT_COLUMNS: CsvColumn[] = [
  { key: "name_ar", header: "الاسم", required: true },
  { key: "mobile_number", header: "الجوال" },
  { key: "id_number", header: "رقم الهوية" },
  {
    key: "gender",
    header: "الجنس",
    parse: (raw) => {
      const value = raw.trim();
      if (["ذكر", "male", "m", "M"].includes(value)) return "male";
      if (["أنثى", "انثى", "female", "f", "F"].includes(value)) return "female";
      throw new Error("القيمة يجب أن تكون: ذكر أو أنثى");
    },
  },
  {
    key: "birth_date",
    header: "تاريخ الميلاد",
    parse: (raw) => {
      // YYYY-MM-DD فقط: صيغ مثل 03/04/2020 غامضة (يوم/شهر أم شهر/يوم؟)
      // وتخمينها يولّد تواريخ ميلاد خاطئة بصمت.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()))
        throw new Error("الصيغة المقبولة YYYY-MM-DD فقط");
      const date = new Date(raw.trim());
      if (Number.isNaN(date.getTime())) throw new Error("تاريخ غير صالح");
      return raw.trim();
    },
  },
  { key: "email_1", header: "البريد الإلكتروني" },
  { key: "address", header: "العنوان" },
  { key: "general_note", header: "ملاحظة" },
];

export default function Patients() {
  const { calendarDisplay } = useLocaleSettings();
  const { organization, session, membership, legacyMode } = useOrganizationAccess();
  /**
   * الحذف النهائيّ لصاحب المنشأة ومسؤولها وحدهما — والقاعدة تفرضه (0171)،
   * فإخفاء الزرّ راحةٌ للعين لا حراسة.
   */
  const canPurge =
    legacyMode || ["owner", "organization_admin"].includes(membership?.role_key ?? "");
  const selection = useRowSelection();
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [searchScopes, setSearchScopes] = useState<PatientSearchScope[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [smsText, setSmsText] = useState("");
  const { doctorId: scopeDoctorId, isDoctorScope, unresolvedDoctor } = useSessionDoctor();
  const patients = usePatientsList(
    organization?.id,
    search,
    searchScopes,
    filters,
    isDoctorScope ? scopeDoctorId : null,
  );
  const doctors = useQuery({
    queryKey: ["doctors-for-patient-filter", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organization?.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const list = patients.data ?? [];
  const atCap = list.length >= RESULT_CAP;
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => {
    if (key === "gender") return value !== "all";
    if (key === "blockedOnly") return value === true;
    return Boolean(value);
  }).length;

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  /**
   * الرسالة الجماعية تُرسل لنتيجة البحث الحالية (لقطة 29) — المحجوبون عن
   * الرسائل ومن بلا جوال مستبعدون، وهو نفس المنطق المطبَّق في شاشة الرسائل.
   */
  const smsRecipients = list.filter((row) => row.mobile_number && !row.block_sms && !row.block_file);

  const sendBulkSms = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!smsText.trim()) throw new Error("اكتب نص الرسالة");
      if (smsRecipients.length === 0) throw new Error("لا يوجد مستلمون في نتيجة البحث");
      /**
       * الحالة تُقرأ من الصفوف المُدرَجة لا من طول القائمة: المُحفِّز
       * `app_enforce_messaging_block` يقلب صفّ كل محظور في «الجهات المحجوبة»
       * إلى `cancelled` ولا يرفع خطأً، فالإدراج ينجح والرسالة لا تُرسَل —
       * وعدّاد الشاشة كان يعلن رقمًا أعلى من الواقع.
       */
      const { data, error } = await supabase
        .from("message_log")
        .insert(
          smsRecipients.map((row) => ({
            organization_id: organization.id,
            patient_id: row.id,
            external_recipient: row.mobile_number,
            channel: "sms" as const,
            message_text: smsText.trim(),
            status: "queued" as const,
            created_by: session?.user.id ?? null,
          })),
        )
        .select("id, status");
      if (error) throw error;
      const inserted = data ?? [];
      const cancelled = inserted.filter((row) => row.status === "cancelled").length;
      return { queued: inserted.length - cancelled, cancelled };
    },
    onSuccess: ({ queued, cancelled }) => {
      toast({
        title: `تم وضع ${queued} رسالة في طابور الإرسال`,
        description:
          cancelled > 0
            ? `أُلغيت ${cancelled} رسالة لمستلمين محجوبين عن الرسائل في «الجهات المحجوبة»`
            : undefined,
      });
      setSmsText("");
      setSmsOpen(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإرسال",
        description: errorMessage(error),
      }),
  });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      {canPurge && selection.selected.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
          <span>
            المحدَّد: <span className="font-semibold tabular-nums">{selection.selected.length}</span>
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={selection.clear}>
              إلغاء التحديد
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteIds(selection.selected)}>
              <Trash2 className="h-3.5 w-3.5" />
              حذف المحدَّد
            </Button>
          </div>
        </div>
      )}
      <DeleteRowsDialog
        entity="patients"
        ids={deleteIds}
        names={(list ?? []).filter((row: any) => deleteIds.includes(row.id)).map((row: any) => row.name_ar)}
        open={deleteIds.length > 0}
        onOpenChange={(next) => !next && setDeleteIds([])}
        onDeleted={selection.clear}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المرضى</h1>
          <p className="text-sm text-muted-foreground">
            {isDoctorScope ? "مرضاك: من تعالجهم أو تشارك فيهم أو لك معهم موعد" : "بحث وفتح ملفات المرضى"}
          </p>
        </div>
      </div>

      {patients.isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          تعذّر تحميل المرضى: {errorMessage(patients.error)}
          {isDoctorScope ? (
            <>
              {" "}— القائمة محصورة على مرضى الطبيب، وهي تقرأ المنظور{" "}
              <span className="font-mono">v_doctor_patients</span>. إن لم تُنفَّذ الترقية{" "}
              <span className="font-mono">0164</span> على القاعدة بعد، نفِّذها.
            </>
          ) : null}
        </p>
      )}

      {unresolvedDoctor && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          الصفة «طبيب» ولم يُعرف أيّ طبيبٍ أنت — لا حسابٌ مربوط بسجلّ طبيب
          (<span className="font-mono">doctors.user_id</span>) ولا طبيبٌ مختار في
          شاشة الصفة. <strong>المعروض هنا كلّ المنشأة لا ما يخصّك.</strong>
        </p>
      )}

      <ScreenToolbar
        items={[
          { key: "new", label: "مريض جديد", icon: Plus, onClick: () => setCreateOpen(true) },
          { key: "sep1", separator: true },
          {
            key: "advanced",
            label: activeFilterCount > 0 ? `بحث متقدم (${activeFilterCount})` : "بحث متقدم",
            icon: SlidersHorizontal,
            onClick: () => setShowAdvanced((prev) => !prev),
          },
          { key: "refresh", label: "تحديث", icon: RefreshCw, onClick: () => void patients.refetch() },
          { key: "sep2", separator: true },
          {
            key: "export",
            label: "تصدير",
            icon: Download,
            disabled: list.length === 0,
            onClick: () => exportCsv(list),
          },
          { key: "import", label: "استيراد", icon: Upload, onClick: () => setImportOpen(true) },
          {
            key: "sms",
            label: `رسالة جماعية (${smsRecipients.length})`,
            icon: MessageSquareShare,
            disabled: smsRecipients.length === 0,
            onClick: () => setSmsOpen(true),
          },
        ]}
      />

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[16rem] flex-1 items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={patientSearchPlaceholder(searchScopes)}
                className="h-7 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
              <PatientSearchScopeChips scopes={searchScopes} onScopesChange={setSearchScopes} />
            </div>
          </div>

          {showAdvanced && (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label>الجنس</Label>
                  <Select value={filters.gender} onValueChange={(value) => setFilter("gender", value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      <SelectItem value="male">ذكر</SelectItem>
                      <SelectItem value="female">أنثى</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>المصدر</Label>
                  <LookupSelect
                    categoryKey="patient_sources"
                    value={filters.sourceValueId}
                    onChange={(value) => setFilter("sourceValueId", value)}
                    placeholder="الكل"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>الجنسية</Label>
                  <LookupSelect
                    categoryKey="nationalities"
                    value={filters.nationalityValueId}
                    onChange={(value) => setFilter("nationalityValueId", value)}
                    placeholder="الكل"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>جهة العمل</Label>
                  <LookupSelect
                    categoryKey="work_entities"
                    value={filters.workEntityValueId}
                    onChange={(value) => setFilter("workEntityValueId", value)}
                    placeholder="الكل"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>مسجَّل من</Label>
                  <Input
                    type="date"
                    value={filters.fileDateFrom}
                    onChange={(e) => setFilter("fileDateFrom", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>مسجَّل إلى</Label>
                  <Input
                    type="date"
                    value={filters.fileDateTo}
                    onChange={(e) => setFilter("fileDateTo", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>المهنة</Label>
                  <LookupSelect
                    categoryKey="professions"
                    value={filters.professionValueId}
                    onChange={(value) => setFilter("professionValueId", value)}
                    placeholder="الكل"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>المدينة</Label>
                  <LookupSelect
                    categoryKey="cities"
                    value={filters.cityValueId}
                    onChange={(value) => setFilter("cityValueId", value)}
                    placeholder="الكل"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>نوع العميل</Label>
                  <LookupSelect
                    categoryKey="customer_types"
                    value={filters.customerTypeValueId}
                    onChange={(value) => setFilter("customerTypeValueId", value)}
                    placeholder="الكل"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>المؤهل التعليمي</Label>
                  <LookupSelect
                    categoryKey="educational_qualifications"
                    value={filters.educationValueId}
                    onChange={(value) => setFilter("educationValueId", value)}
                    placeholder="الكل"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>الحالة الاجتماعية</Label>
                  <Select
                    value={filters.maritalStatus}
                    onValueChange={(value) => setFilter("maritalStatus", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      <SelectItem value="single">أعزب</SelectItem>
                      <SelectItem value="married">متزوج</SelectItem>
                      <SelectItem value="divorced">مطلّق</SelectItem>
                      <SelectItem value="widowed">أرمل</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>الطبيب المعالج</Label>
                  <Select
                    value={filters.doctorId || NO_DOCTOR_FILTER}
                    onValueChange={(value) =>
                      setFilter("doctorId", value === NO_DOCTOR_FILTER ? "" : value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="الكل" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_DOCTOR_FILTER}>الكل</SelectItem>
                      {(doctors.data ?? []).map((doctor) => (
                        <SelectItem key={doctor.id} value={doctor.id}>
                          {doctor.name_ar}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم ملف من</Label>
                  <Input
                    type="number"
                    value={filters.fileNumberFrom}
                    onChange={(e) => setFilter("fileNumberFrom", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>رقم ملف إلى</Label>
                  <Input
                    type="number"
                    value={filters.fileNumberTo}
                    onChange={(e) => setFilter("fileNumberTo", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>العمر من</Label>
                  <Input
                    type="number"
                    min={0}
                    value={filters.ageFrom}
                    onChange={(e) => setFilter("ageFrom", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>العمر إلى</Label>
                  <Input
                    type="number"
                    min={0}
                    value={filters.ageTo}
                    onChange={(e) => setFilter("ageTo", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>مواليد من</Label>
                  <Input
                    type="date"
                    value={filters.birthFrom}
                    onChange={(e) => setFilter("birthFrom", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>مواليد إلى</Label>
                  <Input
                    type="date"
                    value={filters.birthTo}
                    onChange={(e) => setFilter("birthTo", e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.blockedOnly}
                    onChange={(e) => setFilter("blockedOnly", e.target.checked)}
                    className="h-4 w-4"
                  />
                  الملفات المحجوبة فقط
                </label>
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                    <X className="h-3.5 w-3.5" />
                    مسح الفلاتر
                  </Button>
                )}
              </div>
            </div>
          )}

          <CardDescription>
            {atCap
              ? `يُعرض أول ${RESULT_CAP} ملف مطابق — ضيّق البحث لرؤية بقية النتائج`
              : `${list.length} ملف مطابق`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {patients.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}

          {!patients.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  {canPurge && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={list.length > 0 && list.every((row: any) => selection.isSelected(row.id))}
                        onCheckedChange={() => selection.toggleAll(list.map((row: any) => row.id))}
                        aria-label="تحديد الكل"
                      />
                    </TableHead>
                  )}
                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>الجنس</TableHead>
                  <TableHead>تاريخ التسجيل</TableHead>
                  <TableHead>التأمين</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((patient) => (
                  <TableRow key={patient.id}>
                    {canPurge && (
                      <TableCell>
                        <Checkbox
                          checked={selection.isSelected(patient.id)}
                          onCheckedChange={() => selection.toggle(patient.id)}
                          aria-label={`تحديد ${patient.name_ar}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">#{patient.file_number}</TableCell>
                    <TableCell className="font-medium">{patient.name_ar}</TableCell>
                    <TableCell>{patient.mobile_number ?? "—"}</TableCell>
                    <TableCell>
                      {patient.gender === "male" ? "ذكر" : patient.gender === "female" ? "أنثى" : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(patient.file_date, calendarDisplay)}
                    </TableCell>
                    <TableCell>{patient.insurance_company_name ?? "نقدي"}</TableCell>
                    <TableCell>
                      {patient.block_file ? (
                        <Badge variant="destructive">محجوب بالكامل</Badge>
                      ) : patient.block_appointments || patient.block_invoices ? (
                        <Badge variant="warning">محجوب جزئيًا</Badge>
                      ) : (
                        <Badge variant="success">نشط</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/patients/${patient.id}`}>
                            <UserRound className="h-3.5 w-3.5" />
                            فتح الملف
                          </Link>
                        </Button>
                        {canPurge && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            title="حذف نهائيّ"
                            onClick={() => setDeleteIds([patient.id])}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canPurge ? 9 : 8} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد نتائج مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!patients.isLoading && !patients.isError && <GridFooterCount count={list.length} />}
      </Card>

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        table="patients"
        title="استيراد مرضى من ملف CSV"
        invalidateKey="patients-list"
        fixedValues={{ organization_id: organization?.id }}
        columns={PATIENT_IMPORT_COLUMNS}
      />

      {/**
        * النافذة تُركَّب عند الفتح فقط: بقاؤها مركَّبة كان يُبقي حالتها بين
        * الفتحات — فمريض أُغلقت نافذته بعد تحذير الحجب يترك
        * `warningAcknowledged = true` وبياناته في النموذج، فيُحفظ المريض
        * التالي **بلا أي فحص حجب** وبحقول الشخص السابق.
        */}
      {createOpen && <NewPatientDialog open={createOpen} onOpenChange={setCreateOpen} />}

      <Dialog open={smsOpen} onOpenChange={setSmsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>رسالة جماعية لنتيجة البحث</DialogTitle>
            <DialogDescription>
              {smsRecipients.length} مستلم — المحجوبون عن الرسائل ومن بلا جوال مستبعدون تلقائيًا
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>نص الرسالة *</Label>
            <Textarea value={smsText} onChange={(e) => setSmsText(e.target.value)} rows={4} />
            <p className="text-xs text-muted-foreground">{smsText.length} حرفًا</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSmsOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={() => sendBulkSms.mutate()}
              disabled={sendBulkSms.isPending || !smsText.trim() || smsRecipients.length === 0}
            >
              {sendBulkSms.isPending ? "جارٍ الإرسال..." : `إرسال إلى ${smsRecipients.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
