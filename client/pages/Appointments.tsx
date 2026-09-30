import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AppointmentCalendar, {
  type BlockAction,
  type CalendarView,
} from "@/components/appointments/AppointmentCalendar";
import AppointmentMessages from "@/components/appointments/AppointmentMessages";
import AppointmentAuditInfo from "@/components/appointments/AppointmentAuditInfo";
import AppointmentSearchDialog from "@/components/appointments/AppointmentSearchDialog";
import DayNotesDialog, { useDayNotesCount } from "@/components/appointments/DayNotesDialog";
import EarlierCandidatesDialog, { type FreedSlot } from "@/components/appointments/EarlierCandidatesDialog";
import {
  AssignWaitingSlotDialog,
  SendToWaitingDialog,
  SendToWaitingSubmenu,
  useSendToWaiting,
} from "@/components/appointments/WaitingControls";
import {
  APPOINTMENT_EXTRA_COLUMNS,
  APPOINTMENT_QUERY_KEYS,
  doctorDayStart,
  extrasOf,
  isNotArrived,
  localDateKey,
} from "@/lib/appointment-extras";
import {
  ArrowUpCircle,
  CalendarClock,
  CalendarX,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  Clock,
  ListChecks,
  MoreHorizontal,
  StickyNote,
  Plus,
  Printer,
  RefreshCw,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import { checkDoctorAvailability } from "@/lib/doctor-availability";
import { PatientSearchInput } from "@/components/shared/PatientSearchInput";
import { matchesPatientSearch, type PatientSearchScope } from "@/lib/patient-search";
import type { AppointmentStatus, AppointmentWithRelations } from "@/lib/database.types";
import { STATUS_GROUPS, statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import { localDayRange } from "@/lib/date-range";
import { formatAmount, formatDate, formatDateTime, formatTime, useLocaleSettings, type CalendarDisplay } from "@/lib/locale";
import { useMemberNames } from "@/lib/member-names";
import { useSessionDoctor } from "@/lib/session-doctor";
import { useLookupTree } from "@/components/shared/LookupTree";
import PatientCommandsDialog from "@/components/patients/PatientCommandsDialog";
import { printHtml } from "@/lib/document-merge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import PatientPicker from "@/components/shared/PatientPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import LookupSelect from "@/components/shared/LookupSelect";
import CannedTextPicker, { appendCannedText } from "@/components/shared/CannedTextPicker";
import QuickAddPatientDialog from "@/components/shared/QuickAddPatientDialog";
import {
  OverlapConfirmDialog,
  OverlapNotice,
  parseOverlapError,
  useAppointmentOverlap,
  type OverlapInfo,
} from "@/components/appointments/OverlapGuard";

/** Radix Select يرفض قيمة فارغة، فيُستخدم رمز صريح لـ"بدون". */
const NONE_VALUE = "__none__";
/** أعمدة 0197 تُلحَق بقوائم الاختيار — موعد الانتظار، التقريب، التكرار، الوسم، التأكيد. */
const APPOINTMENT_EXTRA_SELECT = `${APPOINTMENT_EXTRA_COLUMNS}, `;
/** أعمدة الموعد الكاملة بعلاقاته — للجلب بالمعرّف. */
const APPOINTMENT_FULL_SELECT =
  "id, organization_id, clinic_id, scheduled_start, scheduled_end, status, priority, queue_number, cancellation_reason, no_show_reason, checked_in_1_at, checked_in_2_at, called_at, entered_at, left_at, visit_type_value_id, source_value_id, note, sms_reminder_sent, created_by, created_at, updated_at, doctor_id, patient_id, expected_duration_minutes, " +
  APPOINTMENT_EXTRA_SELECT +
  "patient:patients!appointments_patient_tenant_fk(id, name_ar, mobile_number, file_number, id_number), doctor:doctors!appointments_doctor_tenant_fk(id, name_ar), clinic:clinics!appointments_clinic_tenant_fk(id, name)";

/** جلب موعدٍ بمعرّفه — لما يقع خارج قائمة اليوم (العرض الأسبوعي والشهري). */
async function fetchAppointmentById(organizationId: string, appointmentId: string) {
  const { data, error } = await supabase
    .from("appointments")
    .select(APPOINTMENT_FULL_SELECT)
    .eq("id", appointmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("الموعد غير موجود أو لا تملك الوصول إليه");
  return data as unknown as AppointmentWithRelations;
}

/**
 * الخانة التي يُخليها موعدٌ يُلغى أو يُنقل أو يُرسل إلى الانتظار — تُعرض بعدها
 * قائمة مرضى الطبيب الذين يقبلون موعدًا أبكر (أولوية التقريب P). موعد
 * انتظارٍ لا يُخلي خانة، ولا موعدٌ مضى وقته أو حضر صاحبه.
 */
function freedSlotOf(appointment: AppointmentWithRelations): FreedSlot | null {
  if (extrasOf(appointment).is_waiting) return null;
  if (!isNotArrived(appointment.status)) return null;
  if (new Date(appointment.scheduled_end).getTime() <= Date.now()) return null;
  return {
    doctorId: appointment.doctor_id,
    doctorName: appointment.doctor?.name_ar ?? null,
    start: appointment.scheduled_start,
    end: appointment.scheduled_end,
  };
}

/** المدّة الأصلية للموعد — موعد الانتظار يحفظها في `expected_duration_minutes`. */
function appointmentMinutes(appointment: AppointmentWithRelations) {
  const kept = (appointment as { expected_duration_minutes?: number | null }).expected_duration_minutes;
  if (extrasOf(appointment).is_waiting && kept) return kept;
  return Math.max(
    5,
    Math.round((new Date(appointment.scheduled_end).getTime() - new Date(appointment.scheduled_start).getTime()) / 60_000),
  );
}
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * تنسيق تاريخ لحقل `<input type="date">` **بالتقويم المحلي** لا بـ UTC.
 *
 * `toISOString()` يحوّل إلى UTC أولًا. في الرياض (UTC+3) كان
 * `new Date("2026-08-28T00:00:00")` = `2026-08-27T21:00Z`، وبعد `+1 يوم`
 * يصير `2026-08-28T21:00Z`، فيُعيد `slice(0,10)` نفس اليوم — **سهم "التالي"
 * لا يتحرك إطلاقًا**، وسهم "السابق" يقفز يومين. وبين منتصف الليل والثالثة
 * فجرًا كانت الشاشة تفتح على يوم أمس.
 */
function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

function useDoctorsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-enabled", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .eq("disabled_from_booking", false)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useUpcomingWebsiteAppointments(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["appointments-website-upcoming", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, organization_id, clinic_id, scheduled_start, scheduled_end, status, priority, queue_number, cancellation_reason, no_show_reason, checked_in_1_at, checked_in_2_at, called_at, entered_at, left_at, visit_type_value_id, source_value_id, note, sms_reminder_sent, created_by, created_at, updated_at, doctor_id, patient_id, expected_duration_minutes, " + APPOINTMENT_EXTRA_SELECT + "patient:patients!appointments_patient_tenant_fk(id, name_ar, mobile_number, file_number, id_number), doctor:doctors!appointments_doctor_tenant_fk(id, name_ar), clinic:clinics!appointments_clinic_tenant_fk(id, name)",
        )
        .eq("organization_id", organizationId)
        .ilike("note", "حجز من الموقع الإلكتروني%")
        .gte("scheduled_start", new Date().toISOString())
        .not("status", "in", "(completed,no_show,cancelled_by_patient,cancelled_by_staff)")
        .order("scheduled_start", { ascending: true })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as unknown as AppointmentWithRelations[];
    },
  });
}

/** سقف صفوف قائمة المواعيد — يُعلن في الشاشة عند بلوغه لا يُخفى في الكود. */
const APPOINTMENT_ROW_LIMIT = 1000;

/**
 * مواعيد **مدى** لا يومٍ واحد.
 *
 * صار المدى مطلوبًا لأن بطاقات تقارير الاستقبال تنقل إلى هنا بفترة التقرير
 * (`?from=&to=`): بلا ذلك كانت الشاشة تعرض مواعيد اليوم فقط، فيقرأ الموظف
 * رقم شهرٍ في البطاقة ويجد أمامه سجلات يوم واحد.
 *
 * الحدود من `localDayRange`: العمود `timestamptz`، و«حتى يوم» تعني نهايته
 * بتوقيت المستخدم لا بتوقيت الخادم. و`count: "exact"` يكشف بلوغ السقف —
 * قائمة مقصوصة بصمت تُقرأ كأنها كل المواعيد.
 */
function useRangeAppointments(
  organizationId: string | undefined,
  from: string,
  to: string,
  /**
   * حصرُ الجدول على طبيبٍ بعينه حين يدخل الموظّف بصفة «الطبيب».
   *
   * الحصر في **الاستعلام** لا في المتصفّح: الجدول محدود بسقفٍ من الصفوف
   * (`APPOINTMENT_ROW_LIMIT`)، فترشيحُ الظاهر منه يجعل الطبيب يرى يومًا
   * ناقصًا في عيادةٍ مزدحمة — ويظنّه يومه كاملًا.
   */
  doctorId?: string | null,
) {
  return useQuery({
    queryKey: ["appointments-day", organizationId, from, to, doctorId ?? ""],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const bounds = localDayRange(from, to);
      let query = supabase
        .from("appointments")
        .select(
          "id, organization_id, clinic_id, scheduled_start, scheduled_end, status, priority, queue_number, cancellation_reason, no_show_reason, checked_in_1_at, checked_in_2_at, called_at, entered_at, left_at, visit_type_value_id, source_value_id, note, sms_reminder_sent, created_by, created_at, updated_at, doctor_id, patient_id, expected_duration_minutes, " + APPOINTMENT_EXTRA_SELECT + "patient:patients!appointments_patient_tenant_fk(id, name_ar, mobile_number, file_number, id_number), doctor:doctors!appointments_doctor_tenant_fk(id, name_ar), clinic:clinics!appointments_clinic_tenant_fk(id, name)",
          { count: "exact" },
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId);
      // صفة الطبيب: يومه هو، لا يوم العيادة كلّها
      if (doctorId) query = query.eq("doctor_id", doctorId);
      const { data, error, count } = await query
        .gte("scheduled_start", bounds.from ?? `${from}T00:00:00`)
        .lte("scheduled_start", bounds.to ?? `${to}T23:59:59`)
        .order("scheduled_start", { ascending: true })
        .limit(APPOINTMENT_ROW_LIMIT);
      if (error) throw error;
      const rows = (data ?? []) as unknown as AppointmentWithRelations[];
      return { rows, matchedCount: count ?? rows.length };
    },
  });
}

/** تاريخ صالح لمعامل عنوان: أي نصّ آخر يُهمَل بدل أن يُبنى عليه استعلام. */
const isDateParam = (value: string | null): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

/**
 * أعمدة الجدول كما في شاشة المواعيد المرجعيّة، بما تملكه قاعدتنا فعلًا.
 *
 * عمود «SMS1» في اللقطة **غير موجود هنا عن قصد**: قرار المالك ألّا يُنفَّذ
 * شيءٌ يخصّ الرسائل النصّية ولا يُضاف لها تكامل حتى إشعارٍ آخر. والعمود
 * `appointments.sms_reminder_sent` موجود في القاعدة، فإظهاره سطرٌ واحد متى
 * رُفع القرار.
 */

/**
 * خانات شريط الملخّص — كلٌّ تقول أيّ حالات تجمع.
 *
 * لا خانة «خارجيّون» بالمعنى الحرفيّ في نظام العيادات المرجعيّ: لا حقل في
 * بياناتنا يميّز «مريضًا خارجيًّا». الأقرب صدقًا **الحضور المباشر**
 * (`walk_in`) — من جاء بلا موعدٍ سابق — وهو ما تعرضه الخانة باسمها.
 */
/**
 * شريط الحالات — مفتاح الألوان والمرشّح معًا (0176).
 *
 * المجموعات التسع نفسها بألوانها في التقويم والقائمة والاستقبال، فالنقطة
 * هنا هي لون الكتلة هناك. والضغط على مجموعةٍ يحصر **كلّ** أنماط العرض —
 * كان يحصر القائمة ويترك التقويم، وكانت إلى جانبه قائمة منسدلة ثانية
 * للحالة تعمل على التقويم وحده: مرشِّحان لسؤالٍ واحد.
 */
const SUMMARY_BUCKETS: { key: string; label: string; statuses: AppointmentStatus[]; dot?: string }[] = [
  { key: "all", label: "كل المواعيد", statuses: [] },
  ...STATUS_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    statuses: group.statuses,
    dot: group.dot,
  })),
];

export default function Appointments() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [day, setDay] = useState(() => toDateInputValue(new Date()));
  /** نمط عرض التقويم — تتبعه أسهم التاريخ في الترويسة. */
  const [calendarView, setCalendarView] = useState<CalendarView>("day");
  const [createOpen, setCreateOpen] = useState(false);
  const [managedAppointment, setManagedAppointment] = useState<AppointmentWithRelations | null>(null);
  const [search, setSearch] = useState("");
  const [searchScopes, setSearchScopes] = useState<PatientSearchScope[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  /** خانة شريط الملخّص المختارة — "all" يعني بلا حصر. */
  const [summaryKey, setSummaryKey] = useState("all");
  /**
   * نمط العرض. التقويم هو الافتراضي لأنه ما يُطلب في الاستقبال، والقائمة
   * القديمة تبقى كما هي — لا تُستبدل: من اعتاد عليها لا يُجبَر على تعلّم
   * شاشة جديدة في يوم عمل.
   */
  const [mode, setMode] = useState<"calendar" | "classic" | "table">("calendar");
  const [prefill, setPrefill] = useState<{
    day: string;
    time: string;
    doctorId: string | null;
    clinicId: string | null;
    patient?: { id: string; name_ar: string } | null;
  } | null>(null);
  /**
   * ═══ «حجز موعد جديد» من ملفّ المريض (`?bookFor=<patientId>`) ═══════════════
   *
   * كان الزرّ (في «أوامر على الملفّ») يفتح نافذة الحجز فورًا على التاسعة صباحًا
   * بلا طبيب: يكتب الموظّف الوقت ويختار الطبيب ثمّ يكتشف أنّه مشغول. الآن
   * يُفتح **جدول اليوم أوّلًا** — عمودٌ لكلّ طبيب وربعُ ساعة لكلّ صفّ، والمتاح
   * ملوَّن — والمريض محمولٌ في شريطٍ أعلاه. الضغط على خانةٍ فارغة يفتح النافذة
   * بالمريض والطبيب والوقت معًا، فلا يبقى للموظّف إلّا الخدمة والتأكيد.
   */
  const bookForId = searchParams.get("bookFor");
  const bookForPatient = useQuery({
    queryKey: ["appointments-book-for", organization?.id, bookForId],
    enabled: Boolean(organization?.id && bookForId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id, name_ar, file_number, mobile_number")
        .eq("id", bookForId)
        .eq("organization_id", organization?.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as {
        id: string;
        name_ar: string;
        file_number: number | string | null;
        mobile_number: string | null;
      } | null;
    },
  });
  const bookingPatient = bookForId ? bookForPatient.data ?? null : null;
  /** الموعد المحجوز للتوّ من شريط الحجز — يُبرَز في الجدول وتُعرض خطوته التالية. */
  const [booked, setBooked] = useState<{
    id: string;
    scheduled_start: string;
    doctor_id: string;
    patient: { id: string; name_ar: string; file_number: number | string | null };
  } | null>(null);
  const endBooking = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("bookFor");
    setSearchParams(next, { replace: true });
  };

  /** الموعد الذي فُتحت عليه قائمة الزرّ الأيمن ويُطلب له سببٌ (لم يحضر/إلغاء). */
  const [reasonTarget, setReasonTarget] = useState<{
    appointment: AppointmentWithRelations;
    action: "no_show" | "cancel";
  } | null>(null);
  /** المريض المفتوحة عليه لوحة أوامر الملفّ من قائمة الزرّ الأيمن. */
  const [commandsTarget, setCommandsTarget] = useState<{
    id: string;
    name_ar: string;
    file_number: number | string | null;
  } | null>(null);
  /* ── 0197: موعد الانتظار، التقريب، ملاحظات اليوم، البحث والطباعة ── */
  const [createAsWaiting, setCreateAsWaiting] = useState(false);
  const [waitingTarget, setWaitingTarget] = useState<{ id: string; patientName: string } | null>(null);
  /** الخانة التي سيُخليها الموعد المفتوحة عليه نافذة «تاريخ آخر…». */
  const [pendingFreed, setPendingFreed] = useState<FreedSlot | null>(null);
  const [assignTarget, setAssignTarget] = useState<{
    id: string;
    patientName: string;
    doctorId: string;
    day: string;
    durationMinutes: number;
  } | null>(null);
  const [freedSlot, setFreedSlot] = useState<FreedSlot | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const doctors = useDoctorsList(organization?.id);
  const clinicList = useQuery({
    queryKey: ["appointments-clinic-list", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organization?.id)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  /**
   * معاملات العنوان القادمة من بطاقات تقارير الاستقبال.
   *
   * كانت الشاشة **لا تقرأ `useSearchParams` للحالة ولا للفترة إطلاقًا**: بطاقة
   * «ملغاة» تنقل إلى `/appointments?status=…` فتُفتح الشاشة على كل مواعيد
   * اليوم بلا ترشيح — رابطٌ يَعِد بما لا يفعله. الآن يُقرأان ويُطبَّقان فعلًا،
   * والحالة قائمةٌ مفصولة بفاصلة لأن بطاقة واحدة تعدّ أكثر من حالة.
   */
  const reportStatuses = useMemo(
    () => (searchParams.get("status") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    [searchParams],
  );
  const reportFromParam = searchParams.get("from");
  const reportToParam = searchParams.get("to");
  const reportFrom = isDateParam(reportFromParam) ? reportFromParam : "";
  const reportTo = isDateParam(reportToParam) ? reportToParam : "";
  const rangeActive = Boolean(reportFrom && reportTo);
  const urlFilterActive = rangeActive || reportStatuses.length > 0;
  const rangeFrom = rangeActive ? reportFrom : day;
  const rangeTo = rangeActive ? reportTo : day;

  // التقويم المحلّي يُحترَم في الجدول كما في بقيّة الشاشات: `ar-SA` وحدها
  // تُخرج أرقامًا عربية-هندية وتاريخًا هجريًّا في كروم.
  const { calendarDisplay } = useLocaleSettings();
  const memberNames = useMemberNames(organization?.id);
  const visitTypeNodes = useLookupTree("visit_types");
  const visitTypeNames = useMemo(() => {
    const map = new Map<string, string>();
    // **كلّها** للعرض: موعدٌ قديم على نوعٍ عُطِّل لاحقًا يجب أن يبقى مقروءًا
    // في عموده، وإخفاؤه يجعله يظهر «—» فيُظنّ أنّه بلا نوع.
    (visitTypeNodes.data ?? []).forEach((node) => map.set(node.id, node.name_ar));
    return map;
  }, [visitTypeNodes.data]);
  /** المعروض للاختيار: النشط وحده — لا يُسنَد موعدٌ جديد إلى نوعٍ معطَّل. */
  const activeVisitTypes = useMemo(
    () =>
      (visitTypeNodes.data ?? [])
        .filter((node) => !node.is_disabled)
        .map((node) => ({ id: node.id, name: node.name_ar })),
    [visitTypeNodes.data],
  );

  const {
    doctorId: scopeDoctorId,
    isDoctorScope,
    unresolvedDoctor,
  } = useSessionDoctor();
  const appointments = useRangeAppointments(
    organization?.id,
    rangeFrom,
    rangeTo,
    isDoctorScope ? scopeDoctorId : null,
  );
  const appointmentRows = appointments.data?.rows ?? [];
  const appointmentsCapped = (appointments.data?.matchedCount ?? 0) > appointmentRows.length;
  const websiteAppointments = useUpcomingWebsiteAppointments(organization?.id);

  const clearReportFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("status");
    next.delete("from");
    next.delete("to");
    setSearchParams(next, { replace: true });
  };
  const canSchedule = legacyMode || ["owner", "organization_admin", "branch_manager", "receptionist"].includes(membership?.role_key ?? "");

  /**
   * طلب متابعة قادم من شاشة الاستقبال (`?requestId=`).
   *
   * زرّ «احجز الموعد» في طلبات الأطباء كان ينقل إلى هذه الشاشة بلا أي ربط
   * بالطلب، فيحجز الموظف الموعد ويبقى الطلب معلّقًا في قائمة الاستقبال —
   * فيتراكم أو يُحجز للمريض موعد ثانٍ. الطلب يُمرَّر هنا ليُنشأ الموعد
   * ويُغلَق الطلب في عملية واحدة عبر `app_approve_appointment_request`.
   */
  const requestId = searchParams.get("requestId");
  const followUpRequest = useQuery({
    queryKey: ["appointment-request", organization?.id, requestId],
    enabled: Boolean(organization?.id && requestId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointment_requests")
        .select("id, patient_id, doctor_id, clinic_id, preferred_date, reason, status, patient:patients!appointment_requests_patient_id_fkey(id, name_ar)")
        .eq("id", requestId)
        .eq("organization_id", organization?.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as {
        id: string;
        patient_id: string;
        doctor_id: string | null;
        clinic_id: string | null;
        preferred_date: string | null;
        reason: string | null;
        status: string;
        patient: { id: string; name_ar: string } | null;
      } | null;
    },
  });

  // الطلب المعلّق وحده يُفتح على نافذة الحجز: طلبٌ أُنجز أو رُفض لا يُحجز
  // مرّتين، والرسالة أدناه تشرح للموظف لماذا لم تُفتح النافذة.
  const pendingRequest = followUpRequest.data?.status === "pending" ? followUpRequest.data : null;
  useEffect(() => {
    if (pendingRequest && canSchedule) {
      setDay(pendingRequest.preferred_date ?? day);
      setCreateOpen(true);
    }
  }, [pendingRequest?.id, canSchedule]);
  /**
   * `?patientId=…&new=1` — «موعد جديد» من قائمة أوامر ملفّ المريض.
   *
   * الرابط كان مكتوبًا في لوحة الاستقبال منذ مدّة والشاشة **لا تقرؤه**: يصل
   * الموظّف إلى جدول اليوم بلا أثرٍ للمريض الذي كان يعمل عليه، فيبحث عنه من
   * جديد في نافذة الحجز. الآن يُجلب المريض ويُعبَّأ في النافذة.
   */
  const patientIdParam = searchParams.get("patientId");
  const wantsNewAppointment = searchParams.get("new") === "1";
  const prefillPatient = useQuery({
    queryKey: ["appointments-prefill-patient", organization?.id, patientIdParam],
    enabled: Boolean(organization?.id && patientIdParam),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id, name_ar")
        .eq("id", patientIdParam)
        // RLS يسمح بكل مؤسّسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organization?.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { id: string; name_ar: string } | null;
    },
  });
  useEffect(() => {
    if (!wantsNewAppointment || !prefillPatient.data || !canSchedule) return;
    // الرابط القديم يدخل مسار الحجز نفسه: الجدول أوّلًا ثمّ النافذة — لا
    // نافذةٌ على التاسعة صباحًا بلا طبيب.
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    next.delete("patientId");
    next.set("bookFor", prefillPatient.data.id);
    setSearchParams(next, { replace: true });
  }, [wantsNewAppointment, prefillPatient.data?.id, canSchedule]);

  // الحجز يجري على جدول اليوم: يُفتح التقويم أيًّا كان العرض المختار قبله
  useEffect(() => {
    if (bookForId) {
      setMode("calendar");
      setBooked(null);
    }
  }, [bookForId]);

  const clearRequestParam = () => {
    if (!requestId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("requestId");
    setSearchParams(next, { replace: true });
  };

  /**
   * فتح موعد نُقر في التقويم.
   *
   * في العرض الأسبوعي أو الشهري يكون الموعد خارج قائمة اليوم، فكان المسار
   * البديل ينقل إلى شاشة الاستقبال بلا الموعد المقصود. الموعد يُجلب بمعرّفه
   * وتُفتح نافذة إدارته — النقر على موعد يجب أن يفتح ذلك الموعد لا شاشة أخرى.
   */
  const openAppointmentById = useMutation({
    mutationFn: async (appointmentId: string) => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      return fetchAppointmentById(organization.id, appointmentId);
    },
    onSuccess: (found) => {
      setDay(toDateInputValue(new Date(found.scheduled_start)));
      setManagedAppointment(found);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر فتح الموعد", description: errorMessage(error, "حدث خطأ") }),
  });

  /**
   * الحالات المطبَّقة فعلًا: ما جاء في العنوان يسبق قائمة الشاشة، لأن الموظف
   * وصل من رقمٍ محسوب على تلك الحالات بالضبط.
   */
  const activeStatuses = reportStatuses.length > 0
    ? reportStatuses
    : summaryKey !== "all"
      ? (SUMMARY_BUCKETS.find((bucket) => bucket.key === summaryKey)?.statuses ?? [])
      : [];

  /**
   * البحث أوّلًا، ثمّ الحالة — **وشريط الملخّص يُحسب من الأولى.**
   *
   * لو حُسبت العدّادات من القائمة بعد ترشيح الحالة لَصار اختيار خانةٍ يُصفّر
   * بقيّة الخانات، فيبدو أن لا مواعيد أخرى اليوم. الشريط يقيس اليوم كلّه
   * ويحصر القائمة، ولا يقيس نفسه.
   */
  const searchedAppointments = useMemo(
    () => appointmentRows.filter((appointment) => matchesPatientSearch(appointment.patient, search, searchScopes)),
    [appointmentRows, search, searchScopes],
  );

  const filteredAppointments = useMemo(
    () =>
      searchedAppointments.filter(
        (appointment) => activeStatuses.length === 0 || activeStatuses.includes(appointment.status),
      ),
    [searchedAppointments, activeStatuses.join(",")],
  );

  /**
   * انتقالات الحالة تمرّ بـ`app_reception_transition` (0065/0158) لا بـ
   * `update` مباشر من المتصفّح.
   *
   * الدالّة تفحص الصلاحية والفرع، وتمنع الانتقال من حالةٍ لا يصحّ منه، وتُلزم
   * بسببٍ حيث يلزم، وتكتب الطوابع الزمنية الصحيحة (`called_at`، `entered_at`،
   * …). و`update` من الشاشة كان سيكتب حالةً بلا طابعها، فيبقى الموعد «داخل
   * الكشف» بلا `entered_at` — فلا يحسب له تقريرٌ مدّة، ولا يعرف الطابور متى
   * دخل.
   */
  const transition = useMutation({
    mutationFn: async (input: {
      appointment: AppointmentWithRelations;
      action: string;
      reason?: string | null;
    }) => {
      const { error } = await supabase.rpc("app_reception_transition", {
        p_appointment_id: input.appointment.id,
        p_action: input.action,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      toast({ title: "تم تنفيذ الإجراء" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر تنفيذ الإجراء", description: errorMessage(error, "حدث خطأ") }),
  });

  /**
   * نوع الزيارة — عمودٌ في `appointments` منذ 0002 يُكتب عند الإنشاء ولا
   * يُعدَّل بعده من أيّ شاشة. وهو أساس تقارير أنواع الزيارات وترتيب الطابور،
   * فخطأٌ فيه يبقى إلى الأبد.
   *
   * التعديل محصورٌ بالمواعيد التي لم تُغلق: تغيير نوع زيارةٍ مكتملة يُعيد
   * كتابة تاريخٍ حُوسب عليه سلفًا.
   */
  const setVisitType = useMutation({
    mutationFn: async (input: { appointment: AppointmentWithRelations; valueId: string | null }) => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase
        .from("appointments")
        .update({ visit_type_value_id: input.valueId })
        .eq("id", input.appointment.id)
        .eq("organization_id", organization.id)
        .not("status", "in", "(completed,no_show,cancelled_by_patient,cancelled_by_staff)")
        .select("id");
      if (error) throw error;
      // PostgREST لا يعدّ «لم يتغيّر أيّ صفّ» خطأً — الفحص هنا
      if (!data?.length) throw new Error("لم يعد الموعد قابلًا للتعديل");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      toast({ title: "تم تغيير نوع الزيارة" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر تغيير نوع الزيارة", description: errorMessage(error, "حدث خطأ") }),
  });

  const confirmAppointment = useMutation({
    mutationFn: async (appointment: AppointmentWithRelations) => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase.from("appointments")
        .update({ status: "confirmed" })
        .eq("id", appointment.id)
        .eq("organization_id", organization.id)
        .in("status", ["new", "scheduled", "unconfirmed"])
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("تغيّرت حالة الموعد؛ حدّث الصفحة وأعد المحاولة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      queryClient.invalidateQueries({ queryKey: ["appointments-website-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      toast({ title: "تم تأكيد الموعد" });
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر التأكيد", description: errorMessage(error, "حدث خطأ") }),
  });

  const dayNotesCount = useDayNotesCount(organization?.id, day);
  const labelNodes = useLookupTree("appointment_labels");
  /** أسماء وسوم المواعيد — كلّها للعرض، والنشط وحده للاختيار (LookupSelect). */
  const labelNames = useMemo(() => {
    const map = new Map<string, string>();
    (labelNodes.data ?? []).forEach((node) => map.set(node.id, node.name_ar));
    return map;
  }, [labelNodes.data]);

  const sendWaiting = useSendToWaiting();
  /** إرسال إلى الانتظار ليومٍ من القائمة — ثمّ من يقبل التقريب إلى الخانة التي فرغت. */
  const sendToWaiting = (appointment: AppointmentWithRelations, dayKey: string) => {
    const freed = freedSlotOf(appointment);
    sendWaiting.mutate(
      { appointmentId: appointment.id, dayKey },
      { onSuccess: () => { if (freed) setFreedSlot(freed); } },
    );
  };
  const openWaitingDialog = (appointment: AppointmentWithRelations) => {
    setPendingFreed(freedSlotOf(appointment));
    setWaitingTarget({ id: appointment.id, patientName: appointment.patient?.name_ar ?? "المريض" });
  };
  const openAssignSlot = (appointment: AppointmentWithRelations) =>
    setAssignTarget({
      id: appointment.id,
      patientName: appointment.patient?.name_ar ?? "المريض",
      doctorId: appointment.doctor_id,
      day: localDateKey(new Date(appointment.scheduled_start)),
      durationMinutes: appointmentMinutes(appointment),
    });

  /** فتح موعدٍ من التقويم أو البحث — من قائمة اليوم إن كان فيها، وإلّا بمعرّفه. */
  const openFromCalendar = (appointmentId: string) => {
    const found = appointmentRows.find((row) => row.id === appointmentId);
    if (found) setManagedAppointment(found);
    else openAppointmentById.mutate(appointmentId);
  };

  /** قائمة الزرّ الأيمن على كتلة الموعد في التقويم — التقويم يبلّغ والشاشة تنفّذ. */
  const handleBlockAction = async (appointmentId: string, action: BlockAction) => {
    if (action.kind === "open") {
      openFromCalendar(appointmentId);
      return;
    }
    let appointment: AppointmentWithRelations;
    try {
      appointment =
        appointmentRows.find((row) => row.id === appointmentId) ??
        (await fetchAppointmentById(organization?.id ?? "", appointmentId));
    } catch (error) {
      toast({ variant: "destructive", title: "تعذّر قراءة الموعد", description: errorMessage(error) });
      return;
    }
    switch (action.kind) {
      case "confirm":
        transition.mutate({ appointment, action: "confirm" });
        break;
      case "waiting":
        sendToWaiting(appointment, action.day);
        break;
      case "waiting_other":
        openWaitingDialog(appointment);
        break;
      case "assign_slot":
        openAssignSlot(appointment);
        break;
      case "patient_file":
        navigate(`/patients/${appointment.patient_id}`);
        break;
      case "patient_commands":
        setCommandsTarget({
          id: appointment.patient_id,
          name_ar: appointment.patient?.name_ar ?? "—",
          file_number: appointment.patient?.file_number ?? null,
        });
        break;
      case "print":
        printAppointmentCard(appointment, calendarDisplay);
        break;
    }
  };

  /**
   * ملخّص اليوم — شريطٌ يقرأ منه الاستقبال حال المواعيد نظرةً واحدة، كما في
   * شريط نظام العيادات المرجعيّ.
   *
   * **العدّادات مبنيّة على حالات النظام نفسها لا على تسمياتٍ مقاربة.** كل
   * خانة تقول أيّ الحالات تجمع، والضغط عليها يحصر القائمة بها — فلا رقمٌ
   * يُعرض ولا يُعرف من أين جاء ولا كيف يُفتَح.
   *
   * ولم أُضف خانة «الخارجيّون» بالمعنى الحرفيّ في اللقطة: لا حقل في بياناتنا
   * يميّز «مريضًا خارجيًّا» عن غيره. الأقرب صدقًا هو **الحضور المباشر**
   * (`walk_in`) — من جاء بلا موعدٍ سابق — وهو ما تعرضه الخانة باسمها.
   */
  const summary = useMemo(
    () =>
      SUMMARY_BUCKETS.map((bucket) => ({
        ...bucket,
        value:
          bucket.statuses.length === 0
            ? searchedAppointments.length
            : searchedAppointments.filter((row) => bucket.statuses.includes(row.status)).length,
      })),
    [searchedAppointments],
  );

  /**
   * الأطباء المعروضون. حين تُحصر الشاشة على طبيب، تُحصر معها **قائمة
   * الأطباء** لا المواعيد وحدها: وإلّا بقيت أعمدة التقويم ومرشّح الطبيب
   * وبطاقات الزملاء معروضةً فارغة، فيظنّ الطبيب أنّ زملاءه بلا مواعيد اليوم.
   */
  const visibleDoctors = useMemo(
    () =>
      isDoctorScope && scopeDoctorId
        ? (doctors.data ?? []).filter((doctor) => doctor.id === scopeDoctorId)
        : (doctors.data ?? []),
    [doctors.data, isDoctorScope, scopeDoctorId],
  );

  const byDoctor = useMemo(() => {
    const map = new Map<string, AppointmentWithRelations[]>();
    visibleDoctors.forEach((doctor) => map.set(doctor.id, []));
    filteredAppointments.forEach((appointment) => {
      const list = map.get(appointment.doctor_id) ?? [];
      list.push(appointment);
      map.set(appointment.doctor_id, list);
    });
    return map;
  }, [visibleDoctors, filteredAppointments]);

  /**
   * التنقّل بوحدة العرض المعروض لا باليوم دائمًا.
   *
   * السهم كان يتقدّم يومًا واحدًا مهما كان العرض، والتقويم يعيد ضبط مرساته
   * على اليوم الجديد — فالعرض الشهري يبقى على شهره مهما ضُغط السهم، ولا
   * يُبلَغ الشهر التالي إلّا بثلاثين ضغطة. والآن: يوم في العرض اليومي،
   * وأسبوع في الأسبوعي، وشهر في الشهري.
   *
   * واليوم داخل الشهر يُقصَر على طول الشهر الهدف: ٣١ أغسطس + شهر يفيض إلى
   * أكتوبر ويقفز سبتمبر كلّه.
   */
  const shiftDay = (delta: number) => {
    const current = new Date(`${day}T00:00:00`);
    let next: Date;
    if (calendarView === "month") {
      const anchor = new Date(current.getFullYear(), current.getMonth() + delta, 1);
      const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
      next = new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        Math.min(current.getDate(), daysInMonth),
      );
    } else if (calendarView === "week" || calendarView === "workweek") {
      next = new Date(current);
      next.setDate(next.getDate() + 7 * delta);
    } else {
      next = new Date(current);
      next.setDate(next.getDate() + delta);
    }
    setDay(toDateInputValue(next));
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      {unresolvedDoctor && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          الصفة «طبيب» ولم يُعرف أيّ طبيبٍ أنت — لا حسابٌ مربوط بسجلّ طبيب
          (<span className="font-mono">doctors.user_id</span>) ولا طبيبٌ مختار في
          شاشة الصفة. <strong>المعروض هنا كلّ المنشأة لا ما يخصّك.</strong>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المواعيد</h1>
          <p className="text-sm text-muted-foreground">
            {isDoctorScope ? "جدولك أنت" : "جدول الأطباء اليومي"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* أسهم اليوم وحقل التاريخ معطَّلة أثناء مرشّح فترة قادم من التقارير:
              الاستعلام يتبع تلك الفترة، فمقبضٌ يتحرّك ولا يغيّر النتيجة كذب. */}
          <Button variant="outline" size="icon" disabled={rangeActive} onClick={() => shiftDay(-1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={day}
            disabled={rangeActive}
            onChange={(e) => setDay(e.target.value)}
            className="w-40"
          />
          <Button variant="outline" size="icon" disabled={rangeActive} onClick={() => shiftDay(1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {canSchedule && (
            <Button
              variant="outline"
              title="موعد انتظار (W.P): يومٌ وطبيب بلا خانة وقت، يُحجز له وقتٌ حين يتاح"
              onClick={() => {
                setCreateAsWaiting(true);
                setCreateOpen(true);
              }}
            >
              <Clock className="h-4 w-4" />
              موعد انتظار
            </Button>
          )}
          {canSchedule && <Button onClick={() => { setCreateAsWaiting(false); setCreateOpen(true); }}>
            <Plus className="h-4 w-4" />
            موعد جديد
          </Button>}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <PatientSearchInput
            value={search}
            onChange={setSearch}
            scopes={searchScopes}
            onScopesChange={setSearchScopes}
            className="min-w-56 flex-1"
          />
          {!urlFilterActive && (
            <div className="flex rounded-md border p-0.5">
              <button
                type="button"
                onClick={() => setMode("calendar")}
                className={`rounded px-2.5 py-1 text-xs ${mode === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                التقويم
              </button>
              <button
                type="button"
                onClick={() => setMode("classic")}
                className={`rounded px-2.5 py-1 text-xs ${mode === "classic" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                بطاقات الأطباء
              </button>
              <button
                type="button"
                onClick={() => setMode("table")}
                className={`rounded px-2.5 py-1 text-xs ${mode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                جدول
              </button>
            </div>
          )}
          <Button variant="outline" onClick={() => setNotesOpen(true)} title="ملاحظات اليوم والاجتماعات">
            <StickyNote className="h-4 w-4" />
            ملاحظات اليوم
            {(dayNotesCount.data ?? 0) > 0 && (
              <Badge variant="secondary" className="ms-1 h-5 px-1.5 font-mono tabular-nums">
                {dayNotesCount.data}
              </Badge>
            )}
          </Button>
          <Button variant="outline" onClick={() => setSearchOpen(true)} title="بحث في المواعيد بفترة ومرشّحات وطباعتها">
            <ListChecks className="h-4 w-4" />
            البحث والطباعة
          </Button>
          <Button variant="outline" onClick={() => navigate("/reception")}>
            <Users className="h-4 w-4" />
            نظام الدور
          </Button>
          <Button variant="outline" onClick={() => navigate("/waitlist")}>قائمة انتظار المواعيد</Button>
        </CardContent>
      </Card>

      {bookForId && (
        <Card className="sticky top-0 z-40 border-primary/50 bg-primary/5 shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <UserRound className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  حجز موعد جديد لـ{" "}
                  {bookForPatient.isLoading ? "…" : bookingPatient?.name_ar ?? "مريض غير موجود"}
                  {bookingPatient?.file_number != null && (
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      ملف {bookingPatient.file_number}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  اختر اليوم بالأسهم، ثمّ اضغط وقتًا في عمود الطبيب — الأخضر دوامه، والمخطَّط خارج دوامه أو ممنوع.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {bookingPatient && (
                <Button variant="outline" size="sm" onClick={() => navigate(`/patients/${bookingPatient.id}`)}>
                  ملف المريض
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={endBooking}>
                <X className="h-4 w-4" />
                إلغاء الحجز
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {booked && !bookForId && (
        <Card className="border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="text-sm">
              <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                حُجز موعد {booked.patient.name_ar}
                {booked.patient.file_number != null ? ` (ملف ${booked.patient.file_number})` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                مع {visibleDoctors.find((doctor) => doctor.id === booked.doctor_id)?.name_ar ?? "الطبيب"} ·{" "}
                {formatDateTime(booked.scheduled_start, calendarDisplay)} — مُبرَزٌ في الجدول أدناه.{" "}
                {toDateInputValue(new Date(booked.scheduled_start)) === toDateInputValue(new Date())
                  ? "وهو في «نظام الدور» ضمن مواعيد اليوم بانتظار التأكيد أو الحضور."
                  : "ويظهر في «نظام الدور» يوم الموعد."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {toDateInputValue(new Date(booked.scheduled_start)) === toDateInputValue(new Date()) && (
                <Button size="sm" onClick={() => navigate(`/reception?appointmentId=${booked.id}`)}>
                  نظام الدور
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${booked.patient.id}`)}>
                العودة لملف المريض
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set("bookFor", booked.patient.id);
                  setSearchParams(next, { replace: true });
                }}
              >
                موعد آخر لنفس المريض
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setBooked(null)} title="إخفاء">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* طلب متابعة أُغلق قبل الوصول إلى هنا: بلا هذه الرسالة تُفتح الشاشة
          عادية فيظن الموظف أن الرابط لا يعمل ويحجز موعدًا ثانيًا. */}
      {requestId && followUpRequest.data && followUpRequest.data.status !== "pending" && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-3 text-sm text-amber-900">
            طلب المتابعة هذا حالته «{followUpRequest.data.status}» — لم يبقَ معلّقًا، فلا يُحجز من الرابط مرّة أخرى.
          </CardContent>
        </Card>
      )}
      {/* لافتة المرشّح القادم من التقارير: تقول ما هو المطبَّق بالضبط وتتيح
          إزالته. بلا هذه الرسالة يبدو أن الشاشة تعرض مواعيد اليوم كلها. */}
      {urlFilterActive && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span>
              مرشّح قادم من تقارير الاستقبال:{" "}
              <b>
                {reportStatuses.length > 0
                  ? reportStatuses.map((status) => statusLabel(status as AppointmentStatus)).join(" أو ")
                  : "كل الحالات"}
              </b>
              {rangeActive ? ` · من ${reportFrom} إلى ${reportTo}` : ""} — العرض «بطاقات الأطباء» لأن
              التقويم يعرض يومًا واحدًا وحالةً واحدة.
            </span>
            <Button size="sm" variant="outline" onClick={clearReportFilter}>
              إزالة المرشّح والعودة إلى اليوم
            </Button>
          </CardContent>
        </Card>
      )}
      {appointmentsCapped && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-3 text-sm text-amber-900">
            معروض {appointmentRows.length} من {appointments.data?.matchedCount} موعد في هذه الفترة — ضيّق
            الفترة لقراءة القائمة كاملة.
          </CardContent>
        </Card>
      )}
      {requestId && followUpRequest.isError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 text-sm text-destructive">
            تعذر قراءة طلب المتابعة: {errorMessage(followUpRequest.error, "خطأ غير متوقع")}
          </CardContent>
        </Card>
      )}

      {!websiteAppointments.isLoading && (websiteAppointments.data ?? []).length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">حجوزات الموقع القادمة</CardTitle>
              <Badge variant="success">{websiteAppointments.data?.length ?? 0} حجز</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(websiteAppointments.data ?? []).map((appointment) => (
              <div key={appointment.id} className="rounded-lg border border-emerald-200 bg-white p-3 text-start">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => navigate(`/patients/${appointment.patient_id}`)} className="text-sm font-bold hover:text-primary hover:underline">
                    {appointment.patient?.name_ar ?? "مريض"}
                  </button>
                  <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
                </div>
                <p className="mt-2 text-xs font-medium">
                  {new Date(appointment.scheduled_start).toLocaleString("ar-SA", {
                    weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
                  })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  د. {appointment.doctor?.name_ar ?? "—"} · {appointment.clinic?.name ?? "—"}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-emerald-100 pt-3">
                  {canSchedule && ["new", "scheduled", "unconfirmed"].includes(appointment.status) && (
                    <Button size="sm" onClick={() => confirmAppointment.mutate(appointment)} disabled={confirmAppointment.isPending}>
                      <Check className="h-3.5 w-3.5" /> تأكيد
                    </Button>
                  )}
                  {canSchedule && !["completed", "no_show", "cancelled_by_patient", "cancelled_by_staff"].includes(appointment.status) && (
                    <Button size="sm" variant="outline" onClick={() => setManagedAppointment(appointment)}>
                      <Edit3 className="h-3.5 w-3.5" /> تعديل
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => navigate(`/reception?appointmentId=${appointment.id}`)}>
                    <ExternalLink className="h-3.5 w-3.5" /> الاستقبال
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDay(toDateInputValue(new Date(appointment.scheduled_start)))}>
                    عرض في التقويم
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* شريط الحالات — يقيس الفترة كلّها، ولونه مفتاح ألوان التقويم، ويحصر كلّ العروض بالضغط (0176) */}
      {!appointments.isLoading && searchedAppointments.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap gap-2 p-3">
            {summary.map((bucket) => {
              const active = summaryKey === bucket.key;
              return (
                <button
                  key={bucket.key}
                  type="button"
                  disabled={urlFilterActive}
                  onClick={() => setSummaryKey(active ? "all" : bucket.key)}
                  className={`rounded-md border px-3 py-1.5 text-start transition disabled:opacity-50 ${
                    active ? "border-primary bg-primary/5" : "hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {bucket.dot && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${bucket.dot}`} />}
                    {bucket.label}
                  </div>
                  <div className="font-mono text-lg font-bold leading-tight tabular-nums">
                    {bucket.value}
                  </div>
                </button>
              );
            })}
            {urlFilterActive && (
              <span className="self-center text-[11px] text-muted-foreground">
                المرشّح يأتي من التقرير — امسحه لتفعيل الشريط.
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* مرشّح متعدّد الحالات أو فترة أطول من يوم لا يعبّر عنهما التقويم
          (يعرض يومًا واحدًا وحالةً واحدة)، فتُعرض بطاقات الأطباء التي تطبّقهما
          فعلًا — بدل تقويمٍ يتجاهل المرشّح ويبدو كأنه يطبّقه. */}
      {!urlFilterActive && mode === "calendar" && (
        <AppointmentCalendar
          organizationId={organization?.id}
          selectedDay={day}
          onViewChange={setCalendarView}
          doctors={visibleDoctors}
          clinics={clinicList.data ?? []}
          search={search}
          statusFilter={activeStatuses}
          onCreateAt={(start, doctorId, clinicId) => {
            if (!canSchedule) return;
            const day = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
            const time = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
            setPrefill({
              day,
              time,
              doctorId,
              clinicId,
              patient: bookingPatient ? { id: bookingPatient.id, name_ar: bookingPatient.name_ar } : null,
            });
            setCreateAsWaiting(false);
            setCreateOpen(true);
          }}
          highlightId={booked?.id ?? null}
          // الموعد خارج يوم القائمة في العرض الأسبوعي والشهري: يُجلب
          // بمعرّفه بدل الانتقال إلى شاشة أخرى لا تعرفه.
          onOpenAppointment={openFromCalendar}
          onDayChange={setDay}
          onBlockAction={handleBlockAction}
          labels={labelNames}
        />
      )}

      {mode === "table" && !urlFilterActive && (
        <AppointmentsTable
          rows={filteredAppointments}
          loading={appointments.isLoading}
          calendarDisplay={calendarDisplay}
          memberNames={memberNames.data}
          visitTypes={visitTypeNames}
          activeVisitTypes={activeVisitTypes}
          canSchedule={canSchedule}
          onEdit={(appointment) => setManagedAppointment(appointment)}
          onTransition={(appointment, action) => transition.mutate({ appointment, action })}
          onAskReason={(appointment, action) => setReasonTarget({ appointment, action })}
          onSetVisitType={(appointment, valueId) =>
            setVisitType.mutate({ appointment, valueId })
          }
          onPrint={(appointment) => printAppointmentCard(appointment, calendarDisplay)}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
            queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
          }}
          onPatientCommands={(appointment) =>
            setCommandsTarget({
              id: appointment.patient_id,
              name_ar: appointment.patient?.name_ar ?? "—",
              file_number: appointment.patient?.file_number ?? null,
            })
          }
          labels={labelNames}
          onSendToWaiting={sendToWaiting}
          onWaitingOther={openWaitingDialog}
          onAssignSlot={openAssignSlot}
        />
      )}

      {(urlFilterActive || mode === "classic") && appointments.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      )}


      {(urlFilterActive || mode === "classic") && !appointments.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...byDoctor.entries()].map(([doctorId, list]) => {
            const doctor = visibleDoctors.find((item) => item.id === doctorId);
            return (
              <Card key={doctorId}>
                <CardHeader>
                  <CardTitle className="text-base">د. {doctor?.name_ar ?? "—"}</CardTitle>
                  <p className="text-xs text-muted-foreground">{list.length} موعد</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {list.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">لا مواعيد</p>}
                  {list.map((appointment) => (
                    <div key={appointment.id} className="rounded-lg border px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <button type="button" className="text-start" onClick={() => navigate(`/patients/${appointment.patient_id}`)}>
                          <p className="text-sm font-medium hover:text-primary">{appointment.patient?.name_ar}</p>
                          <p className="text-xs text-muted-foreground">
                            {extrasOf(appointment).is_waiting
                              ? "موعد انتظار"
                              : new Date(appointment.scheduled_start).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                            {appointment.clinic?.name ? ` · ${appointment.clinic.name}` : ""}
                          </p>
                        </button>
                        <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {canSchedule && ["new", "scheduled", "unconfirmed"].includes(appointment.status) && (
                          <Button size="sm" variant="outline" onClick={() => confirmAppointment.mutate(appointment)}>
                            <Check className="h-3.5 w-3.5" /> تأكيد
                          </Button>
                        )}
                        {canSchedule && !['completed','no_show','cancelled_by_patient','cancelled_by_staff'].includes(appointment.status) && (
                          <Button size="sm" variant="outline" onClick={() => setManagedAppointment(appointment)}>
                            <Edit3 className="h-3.5 w-3.5" /> تعديل
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/reception?appointmentId=${appointment.id}`)}>
                          <ExternalLink className="h-3.5 w-3.5" /> الاستقبال
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AppointmentReasonDialog
        target={reasonTarget}
        onOpenChange={() => setReasonTarget(null)}
        onSubmit={(reason) => {
          if (!reasonTarget) return;
          const freed = reasonTarget.action === "cancel" ? freedSlotOf(reasonTarget.appointment) : null;
          transition.mutate(
            {
              appointment: reasonTarget.appointment,
              action: reasonTarget.action,
              reason,
            },
            { onSuccess: () => { if (freed) setFreedSlot(freed); } },
          );
          setReasonTarget(null);
        }}
        pending={transition.isPending}
      />
      <PatientCommandsDialog
        patient={commandsTarget}
        open={Boolean(commandsTarget)}
        onOpenChange={(next) => {
          if (!next) setCommandsTarget(null);
        }}
      />
      <ManageAppointmentDialog
        appointment={managedAppointment}
        onOpenChange={(open) => { if (!open) setManagedAppointment(null); }}
        organizationId={organization?.id}
        doctors={visibleDoctors}
        onFreed={setFreedSlot}
        onSendToWaiting={(appointment) => {
          setManagedAppointment(null);
          openWaitingDialog(appointment);
        }}
        onAssignSlot={(appointment) => {
          setManagedAppointment(null);
          openAssignSlot(appointment);
        }}
      />
      <SendToWaitingDialog
        target={waitingTarget}
        onOpenChange={(open) => {
          if (!open) setWaitingTarget(null);
        }}
        onSent={() => {
          if (pendingFreed) setFreedSlot(pendingFreed);
          setPendingFreed(null);
        }}
      />
      <AssignWaitingSlotDialog
        target={assignTarget}
        organizationId={organization?.id}
        onOpenChange={(open) => {
          if (!open) setAssignTarget(null);
        }}
      />
      <EarlierCandidatesDialog
        organizationId={organization?.id}
        slot={freedSlot}
        onOpenChange={(open) => {
          if (!open) setFreedSlot(null);
        }}
      />
      <DayNotesDialog organizationId={organization?.id} dayKey={day} open={notesOpen} onOpenChange={setNotesOpen} />
      <AppointmentSearchDialog
        organizationId={organization?.id}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        doctors={visibleDoctors}
        clinics={clinicList.data ?? []}
        defaultDay={day}
        scopedDoctorId={isDoctorScope ? scopeDoctorId : null}
        onOpenAppointment={(appointmentId) => {
          setSearchOpen(false);
          openFromCalendar(appointmentId);
        }}
      />
      <CreateAppointmentDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            clearRequestParam();
            setCreateAsWaiting(false);
          }
        }}
        organizationId={organization?.id}
        doctors={visibleDoctors}
        initialWaiting={createAsWaiting}
        defaultDay={prefill?.day ?? day}
        prefill={prefill}
        onConsumePrefill={() => setPrefill(null)}
        followUpRequest={pendingRequest}
        onRequestBooked={clearRequestParam}
        onCreated={(row) => {
          if (!bookingPatient) return;
          // يُعرض الحجز في جدول يومه، ويُغلق شريط الحجز فلا يُحجز للمريض
          // موعدٌ ثانٍ بضغطةٍ عابرة على خانةٍ أخرى.
          setBooked({
            ...row,
            patient: {
              id: bookingPatient.id,
              name_ar: bookingPatient.name_ar,
              file_number: bookingPatient.file_number,
            },
          });
          setDay(toDateInputValue(new Date(row.scheduled_start)));
          endBooking();
        }}
      />
    </div>
  );
}

function ManageAppointmentDialog({
  appointment,
  onOpenChange,
  organizationId,
  doctors,
  onFreed,
  onSendToWaiting,
  onAssignSlot,
}: {
  appointment: AppointmentWithRelations | null;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  doctors: { id: string; name_ar: string }[];
  /** خانةٌ فرغت بإلغاءٍ أو نقل — تُعرض بعدها قائمة من يقبل التقريب. */
  onFreed: (slot: FreedSlot) => void;
  onSendToWaiting: (appointment: AppointmentWithRelations) => void;
  onAssignSlot: (appointment: AppointmentWithRelations) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { calendarDisplay } = useLocaleSettings();
  const extras = extrasOf(appointment);
  const isWaiting = Boolean(extras.is_waiting);
  const [acceptsEarlier, setAcceptsEarlier] = useState(false);
  const [labelValueId, setLabelValueId] = useState("");
  /** «اعتذر عن الموعد» (Kizen): إلغاءٌ بطلب المريض قبل حضوره — يُحسب في تقاريره لا على المنشأة. */
  const [cancelByPatient, setCancelByPatient] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [clinicId, setClinicId] = useState(NONE_VALUE);
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");

  const clinics = useQuery({
    queryKey: ["appointment-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name")
        .eq("organization_id", organizationId).eq("is_disabled", false).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  useEffect(() => {
    if (!appointment) return;
    const start = new Date(appointment.scheduled_start);
    const minutes = Math.max(5, Math.round((new Date(appointment.scheduled_end).getTime() - start.getTime()) / 60_000));
    setDoctorId(appointment.doctor_id);
    setDate(toDateInputValue(start));
    setTime(`${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`);
    setDuration(String(minutes));
    setClinicId(appointment.clinic_id ?? NONE_VALUE);
    setPriority(appointment.priority ?? "normal");
    setNote(appointment.note ?? "");
    setCancellationReason(appointment.cancellation_reason ?? "");
    setRescheduleReason("");
    setAcceptsEarlier(Boolean(extrasOf(appointment).accepts_earlier));
    setLabelValueId(extrasOf(appointment).label_value_id ?? "");
    setCancelByPatient(false);
  }, [appointment]);

  /**
   * هل تغيّرت حقول الجدولة؟
   *
   * تغيير الوقت أو الطبيب أو العيادة **إعادة جدولة** لا «تحديث موعد»: كان
   * يُكتب هنا بـ`update` مباشر، فيمرّ بلا سبب ولا سطر تدقيق «إعادة جدولة»،
   * ويمرّ لمن سُحبت منه صلاحية `appointments.reschedule` وبقيت له
   * `appointments.update`، ويتجاوز فحص دوام الطبيب في القاعدة (المُحفِّز
   * مقصور على `INSERT`). لذا تمرّ هذه الحقول عبر `app_reschedule_appointment`
   * وتبقى الأولوية والملاحظة وحدهما على المسار المباشر.
   */
  const start = date && time ? new Date(`${date}T${time}:00`) : null;
  const end = start ? new Date(start.getTime() + Number(duration) * 60_000) : null;
  const targetClinicId = clinicId === NONE_VALUE ? null : clinicId;
  // موعد الانتظار لا يُعاد جدولته من هنا: يخرج من الانتظار بـ«حجز خانة وقت»
  // فيُفحص الدوام والتداخل كأيّ حجز، ولا يُنقل وهو باقٍ في الانتظار.
  const scheduleChanged = !isWaiting && Boolean(
    appointment && start && end &&
      (doctorId !== appointment.doctor_id ||
        start.getTime() !== new Date(appointment.scheduled_start).getTime() ||
        end.getTime() !== new Date(appointment.scheduled_end).getTime() ||
        targetClinicId !== (appointment.clinic_id ?? null)),
  );
  /**
   * النقل إلى وقتٍ محجوز يُرى هنا قبل الحفظ (0174). والتجاوز لا يُعرض: النقل
   * يمرّ بدالّة إعادة الجدولة وهي لا تحمله — ومن أصرّ ألغى وحجز من جديد.
   * والموعد نفسه مستثنًى: لا يتعارض الموعد مع مكانه القديم.
   */
  const manageOverlap = useAppointmentOverlap({
    organizationId,
    doctorId: doctorId || null,
    start,
    end,
    excludeId: appointment?.id ?? null,
    enabled: scheduleChanged,
  });

  const detailsChanged = Boolean(
    appointment &&
      ((appointment.priority ?? "normal") !== priority ||
        (appointment.note ?? "") !== note ||
        Boolean(extras.accepts_earlier) !== acceptsEarlier ||
        (extras.label_value_id ?? "") !== labelValueId),
  );

  const invalidate = () => {
    // لوحة الاستقبال استعلام مستقلّ عن طابور البطاقات: نقل موعد اليوم أو
    // تغيير طبيبه يجب أن يظهر فيها أيضًا بلا انتظار الجلب الدوري.
    APPOINTMENT_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [...key] }));
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!appointment || !organizationId || !doctorId || !date || !time || !start || !end) throw new Error("أكمل بيانات الموعد");
      if (!scheduleChanged && !detailsChanged) throw new Error("لا تغيير للحفظ");
      await assertPatientNotBlocked(appointment.patient_id, "appointments");

      if (scheduleChanged) {
        if (!rescheduleReason.trim()) throw new Error("سبب إعادة الجدولة مطلوب");
        // الدالّة تُبقي العيادة الحالية عند تمرير `null` (coalesce)، فإزالة
        // العيادة لا يمكن التعبير عنها هنا: تُعلَن للمستخدم بدل أن تُهمَل بصمت.
        if (appointment.clinic_id && targetClinicId === null)
          throw new Error("إزالة العيادة من موعد قائم غير متاحة من هذه النافذة — اختر عيادة أو انقل الموعد من الاستقبال");
        const { error } = await supabase.rpc("app_reschedule_appointment", {
          p_appointment_id: appointment.id,
          p_scheduled_start: start.toISOString(),
          p_scheduled_end: end.toISOString(),
          p_doctor_id: doctorId,
          p_clinic_id: targetClinicId,
          p_reason: rescheduleReason.trim(),
        });
        if (error) throw error;
      }

      if (detailsChanged) {
        const { data, error } = await supabase.from("appointments").update({
          priority,
          note: note.trim() || null,
          accepts_earlier: acceptsEarlier,
          label_value_id: labelValueId || null,
        } as never).eq("id", appointment.id).eq("organization_id", organizationId)
          .not("status", "in", "(completed,no_show,cancelled_by_patient,cancelled_by_staff)").select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("لم يعد الموعد قابلًا للتعديل");
      }
      return { rescheduled: scheduleChanged };
    },
    onSuccess: (result) => {
      invalidate();
      toast({ title: result?.rescheduled ? "تمت إعادة جدولة الموعد وتسجيل السبب" : "تم تحديث الموعد" });
      const freed = result?.rescheduled && appointment ? freedSlotOf(appointment) : null;
      onOpenChange(false);
      if (freed) onFreed(freed);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر التحديث", description: errorMessage(error, "حدث خطأ") }),
  });

  /**
   * تأكيد الموعد من نافذة الإدارة.
   *
   * كان زرّ التأكيد في «بطاقات الأطباء» وبطاقة حجوزات الموقع وحدهما، والعرض
   * الافتراضي هو التقويم — فمن ينقر موعدًا في التقويم لا يجد سبيلًا لتأكيده،
   * والموعد غير المؤكَّد لا يدخل لوحة الاستقبال أصلًا. والتأكيد يمرّ بـ
   * `app_reception_transition` لأنها تفحص الصلاحية والفرع وتمنع التأكيد
   * المتكرر لحالة تجاوزته.
   */
  const confirm = useMutation({
    mutationFn: async () => {
      if (!appointment) throw new Error("لا موعد محدَّد");
      const { error } = await supabase.rpc("app_reception_transition", {
        p_appointment_id: appointment.id,
        p_action: "confirm",
        p_reason: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم تأكيد الموعد" });
      onOpenChange(false);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر التأكيد", description: errorMessage(error, "حدث خطأ") }),
  });

  /**
   * الإلغاء بـ`app_cancel_appointment` (0197) لا بـ`update` مباشر: تفحص
   * صلاحية `appointments.cancel`، وتُلزم بالسبب، وتمنع إلغاء موعدٍ عليه فاتورة
   * محصَّلة، وتفرّق بين اعتذار المريض وإلغاء المنشأة، وتكتب سطر التدقيق.
   */
  const cancel = useMutation({
    mutationFn: async () => {
      if (!appointment || !cancellationReason.trim()) throw new Error("اكتب سبب الإلغاء");
      const { error } = await supabase.rpc("app_cancel_appointment", {
        p_appointment_id: appointment.id,
        p_reason: cancellationReason.trim(),
        p_by_patient: cancelByPatient,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: cancelByPatient ? "سُجّل اعتذار المريض عن الموعد" : "تم إلغاء الموعد وتسجيل السبب" });
      const freed = appointment ? freedSlotOf(appointment) : null;
      onOpenChange(false);
      if (freed) onFreed(freed);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر الإلغاء", description: errorMessage(error, "حدث خطأ") }),
  });

  return <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>إدارة موعد {appointment?.patient?.name_ar}</DialogTitle>
        <DialogDescription>إعادة الجدولة أو تغيير الطبيب والعيادة والأولوية، مع تسجيل سبب الإلغاء.</DialogDescription>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto px-0.5">
        {appointment && isWaiting && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-300 bg-sky-50/70 p-2.5 text-sm dark:bg-sky-950/20">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-sky-700" />
              موعد انتظار (W.P) يوم {formatDate(appointment.scheduled_start, calendarDisplay)}
              {extras.waiting_all_day ? " — طوال اليوم" : ` — من ${formatTime(appointment.scheduled_start)}`}
            </span>
            <Button size="sm" onClick={() => onAssignSlot(appointment)}>
              حجز خانة وقت
            </Button>
          </div>
        )}
        {appointment && !isWaiting && isNotArrived(appointment.status) && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => onSendToWaiting(appointment)}>
              <Clock className="h-3.5 w-3.5" />
              إرسال إلى الانتظار
            </Button>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <div><Label>الطبيب</Label><Select value={doctorId} onValueChange={setDoctorId} disabled={isWaiting}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{doctors.map((doctor) => <SelectItem key={doctor.id} value={doctor.id}>{doctor.name_ar}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>العيادة</Label><Select value={clinicId} onValueChange={setClinicId} disabled={isWaiting}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE_VALUE}>بدون</SelectItem>{(clinics.data ?? []).map((clinic) => <SelectItem key={clinic.id} value={clinic.id}>{clinic.name}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label>التاريخ</Label><Input type="date" value={date} disabled={isWaiting} onChange={(event) => setDate(event.target.value)} /></div>
          <div><Label>الوقت</Label><Input type="time" value={time} disabled={isWaiting} onChange={(event) => setTime(event.target.value)} /></div>
          <div><Label>المدة</Label><Input type="number" min={5} step={5} value={duration} disabled={isWaiting} onChange={(event) => setDuration(event.target.value)} /></div>
        </div>
        {scheduleChanged && (
          <OverlapNotice
            info={manageOverlap.data}
            requestedStart={start}
            onMove={(next) => {
              setDate(toDateInputValue(next));
              setTime(`${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`);
            }}
          />
        )}
        <div><Label>الأولوية</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">عادي</SelectItem><SelectItem value="urgent">عاجل</SelectItem><SelectItem value="emergency">طارئ</SelectItem><SelectItem value="elderly">كبار السن</SelectItem><SelectItem value="accessibility">ذوو الإعاقة</SelectItem></SelectContent></Select></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label>وسم الموعد</Label>
            <LookupSelect
              categoryKey="appointment_labels"
              value={labelValueId}
              onChange={setLabelValueId}
              allowClear
              placeholder="بدون"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 self-end rounded-md border p-2 text-sm">
            <input type="checkbox" checked={acceptsEarlier} onChange={(event) => setAcceptsEarlier(event.target.checked)} />
            <ArrowUpCircle className="h-4 w-4 text-primary" />
            يقبل موعدًا أبكر إن فرغت خانة
          </label>
        </div>
        <div><Label>ملاحظة</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></div>
        {scheduleChanged && (
          <div className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50/60 p-2.5">
            <Label>سبب إعادة الجدولة *</Label>
            <Textarea value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} rows={2} placeholder="سبب نقل الموعد أو تغيير الطبيب/العيادة" />
            <p className="text-xs text-amber-900">
              تغيير الوقت أو الطبيب أو العيادة يمرّ بإعادة الجدولة في القاعدة: تفحص الصلاحية ودوام الطبيب
              والفرع وتسجّل السبب في التدقيق. الرفض يترك الموعد كما هو ويشرح السبب.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label>سبب الإلغاء</Label>
          <Textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="مطلوب عند إلغاء الموعد" rows={2} />
          {appointment && isNotArrived(appointment.status) && (
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={cancelByPatient} onChange={(event) => setCancelByPatient(event.target.checked)} />
              المريض اعتذر عن الموعد (إلغاء بطلبه لا من المنشأة)
            </label>
          )}
        </div>
        {appointment && <AppointmentMessages appointmentId={appointment.id} />}
        {appointment && <AppointmentAuditInfo organizationId={organizationId} appointmentId={appointment.id} />}
      </div>
      <DialogFooter className="gap-2">
        {appointment && ["new", "scheduled", "unconfirmed"].includes(appointment.status) && (
          <Button variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            <Check className="h-4 w-4" />
            {confirm.isPending ? "جارٍ التأكيد..." : "تأكيد الموعد"}
          </Button>
        )}
        <Button variant="destructive" disabled={cancel.isPending || !cancellationReason.trim()} onClick={() => cancel.mutate()}><CalendarX className="h-4 w-4" />{cancelByPatient ? "تسجيل اعتذار المريض" : "إلغاء الموعد"}</Button>
        <Button
          disabled={save.isPending || (!scheduleChanged && !detailsChanged) || (scheduleChanged && !rescheduleReason.trim())}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "جارٍ الحفظ..." : scheduleChanged ? "حفظ وإعادة الجدولة" : "حفظ التعديلات"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CreateAppointmentDialog({
  open,
  onOpenChange,
  organizationId,
  doctors,
  defaultDay,
  prefill,
  onConsumePrefill,
  followUpRequest,
  onRequestBooked,
  onCreated,
  initialWaiting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  doctors: { id: string; name_ar: string }[];
  defaultDay: string;
  /** قيم من الضغط على خانة فارغة في التقويم — يوم ووقت وطبيب وعيادة. */
  prefill?: {
    day: string;
    time: string;
    doctorId: string | null;
    clinicId: string | null;
    patient?: { id: string; name_ar: string } | null;
  } | null;
  onConsumePrefill?: () => void;
  /**
   * طلب متابعة معلّق أرسله طبيب (`appointment_requests`).
   *
   * حين يكون موجودًا يُنشأ الموعد بـ`app_approve_appointment_request`: إنشاء
   * الموعد وإغلاق الطلب عمليةٌ واحدة في القاعدة، وتقسيمها إلى كتابتين من
   * المتصفح يُخلّف طلبًا معلّقًا لموعد محجوز إن انقطع الاتصال بينهما.
   */
  followUpRequest?: {
    id: string;
    patient_id: string;
    doctor_id: string | null;
    clinic_id: string | null;
    preferred_date: string | null;
    reason: string | null;
    patient: { id: string; name_ar: string } | null;
  } | null;
  onRequestBooked?: () => void;
  /** يُنادى بالموعد المُنشأ — لمسار «حجز موعد جديد» من ملفّ المريض. */
  onCreated?: (row: { id: string; scheduled_start: string; doctor_id: string }) => void;
  /** تُفتح النافذة على «موعد انتظار» (زرّ «موعد انتظار» في الترويسة). */
  initialWaiting?: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  // تقويم المنشأة يُحترَم في رسالة «أقرب موعد» كما في بقيّة الشاشات
  const { calendarDisplay } = useLocaleSettings();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(defaultDay);
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("30");
  /**
   * الخدمة المطلوبة.
   *
   * `items.duration_minutes` كان مخزَّنًا منذ 0071 ولا يقرؤه أحد، فكان كل
   * موعد ٣٠ دقيقة سواء كان كشفًا أو تنظيرًا. اختيار الخدمة هنا يضبط المدة
   * ويشتقّ العيادة، والقاعدة تفحص ملاءمتها للمريض قبل الحفظ.
   */
  const [service, setService] = useState<{ id: string; name: string } | null>(null);
  /**
   * سلسلة الحجز: فرع ← عيادة ← طبيب ← خدمة (0081).
   *
   * كل خطوة تسأل القاعدة عمّا هو متاح في التي تليها، فلا تعرض الشاشة طبيبًا
   * لا يعمل في العيادة ولا خدمةً لا يقدّمها — والقاعدة ترفضهما على كل حال.
   */
  const [branchId, setBranchId] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  /**
   * تعارض الوقت مع موعدٍ آخر للطبيب (0174).
   *
   * يُفحص **قبل** الضغط على «حجز» فيظهر الوقت محجوبًا ومتى يُحجز بعده. وإن
   * أصرّ الموظّف فالتجاهل بخطوتين، ويُرسل مع الإدراج فتسجّله القاعدة باسمه.
   * وأيّ تغييرٍ في الطبيب أو الوقت أو المدّة يُسقط تجاهلًا سابقًا: التأكيد
   * كان على تعارضٍ بعينه لا على كلّ تعارض.
   */
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [conflict, setConflict] = useState<OverlapInfo | null>(null);
  /**
   * موعد الانتظار (W.P، 0197): يومٌ وطبيب بلا خانة وقت. «طوال اليوم» يبدأ من
   * بداية دوام الطبيب ذلك اليوم (`app_doctor_day_start`)، أو «من الساعة»
   * يكتبها الموظّف. لا يدخل فحص التداخل، ويُحفظ طوله الأصليّ لحين حجز خانته.
   */
  const [waiting, setWaiting] = useState(false);
  const [waitingAllDay, setWaitingAllDay] = useState(true);
  /** أولوية التقريب (P): يقبل موعدًا أبكر إن فرغت خانةٌ عند طبيبه. */
  const [acceptsEarlier, setAcceptsEarlier] = useState(false);
  const [labelValueId, setLabelValueId] = useState("");
  /** تكرار الموعد — كلّ موعدٍ يُفحص للتداخل والدوام، والكلّ يُحجز أو لا شيء. */
  const [repeat, setRepeat] = useState(false);
  const [repeatCount, setRepeatCount] = useState("4");
  const [repeatEvery, setRepeatEvery] = useState("7");
  const plannedStart = date && time ? new Date(`${date}T${time}:00`) : null;
  const plannedEnd =
    plannedStart && Number(duration) > 0
      ? new Date(plannedStart.getTime() + Number(duration) * 60_000)
      : null;
  const overlap = useAppointmentOverlap({
    organizationId,
    doctorId: doctorId || null,
    start: plannedStart,
    end: plannedEnd,
    enabled: open && !waiting,
  });
  useEffect(() => {
    setOverrideConfirmed(false);
  }, [doctorId, date, time, duration]);
  const moveToFreeTime = (next: Date) => {
    setDate(next.toLocaleDateString("en-CA"));
    setTime(next.toTimeString().slice(0, 5));
    setOverrideConfirmed(false);
  };
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  /**
   * العيادة ونوع الزيارة والملاحظة أعمدة في `appointments` منذ 0002 لم تكن
   * النافذة تُدخل أيًا منها — فكان كل موعد يُحجَز بلا عيادة ولا نوع، وهما
   * أساس فرز شاشة الاستقبال وتقارير أنواع الزيارات.
   */
  const [clinicId, setClinicId] = useState(NONE_VALUE);
  const [visitTypeValueId, setVisitTypeValueId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  /**
   * تجاوز الحجز خارج فترات الدوام.
   *
   * الحجب (إجازة/عملية) لا يُتجاوَز — لأنه غياب فعلي لا تفضيل. أما "خارج
   * الدوام" فيُتجاوَز بإقرار صريح: الحالات المستعجلة والمواعيد المتفق عليها
   * هاتفيًا واقع يومي، ومنعها كليًا يدفع الموظف لتعطيل التحقق لا لاحترامه.
   */
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);

  /**
   * التعبئة عند الفتح — مرّةً واحدة لكلّ فتح.
   *
   * كان الأثر يعتمد على `defaultDay` أيضًا، و`defaultDay` هو يوم التعبئة ما
   * دامت قائمة: فلمّا تُستهلك التعبئة يعود `defaultDay` إلى يوم الشاشة، فيعمل
   * الأثر ثانيةً ويكتب **يوم الشاشة فوق يوم الخانة المضغوطة**. من تنقّل في
   * التقويم بأسهمه ثمّ ضغط خانة يوم الخميس كان يجد النافذة على يوم الشاشة.
   */
  useEffect(() => {
    if (!open) return;
    setWaiting(Boolean(initialWaiting) && !followUpRequest);
    setWaitingAllDay(true);
    setRepeat(false);
    setDate(prefill?.day ?? defaultDay);
    if (prefill) {
      setTime(prefill.time);
      if (prefill.doctorId) setDoctorId(prefill.doctorId);
      if (prefill.clinicId) setClinicId(prefill.clinicId);
      if (prefill.patient) setPatient(prefill.patient);
      onConsumePrefill?.();
    }
  }, [open]);

  // بيانات طلب المتابعة تُعبَّأ عند فتح النافذة: المريض يأتي من الطلب ولا
  // يُختار هنا، لأن القاعدة تحجز لمريض الطلب لا لمن يُختار في الشاشة.
  useEffect(() => {
    if (!open || !followUpRequest) return;
    setPatient(followUpRequest.patient ? { id: followUpRequest.patient.id, name_ar: followUpRequest.patient.name_ar } : { id: followUpRequest.patient_id, name_ar: "مريض الطلب" });
    if (followUpRequest.doctor_id) setDoctorId(followUpRequest.doctor_id);
    if (followUpRequest.clinic_id) setClinicId(followUpRequest.clinic_id);
    if (followUpRequest.preferred_date) setDate(followUpRequest.preferred_date);
    setNote(followUpRequest.reason ?? "");
  }, [open, followUpRequest?.id]);

  const clinics = useQuery({
    queryKey: ["appointment-clinics", organizationId],
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

  const branches = useQuery({
    queryKey: ["appt-branches", organizationId],
    enabled: open && Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const clinicOptions = useQuery({
    queryKey: ["appt-clinics-chain", organizationId, branchId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_clinics_for_branch", {
        p_organization_id: organizationId,
        p_branch_id: branchId || null,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const doctorOptions = useQuery({
    queryKey: ["appt-doctors-chain", organizationId, clinicId],
    enabled: open && Boolean(organizationId) && clinicId !== NONE_VALUE && Boolean(clinicId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_doctors_for_clinic", {
        p_organization_id: organizationId,
        p_clinic_id: clinicId,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const serviceOptions = useQuery({
    queryKey: ["appt-services-chain", organizationId, doctorId, clinicId, branchId],
    enabled: open && Boolean(organizationId) && Boolean(doctorId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_services_for_doctor", {
        p_organization_id: organizationId,
        p_doctor_id: doctorId,
        p_clinic_id: clinicId === NONE_VALUE ? null : clinicId || null,
        p_branch_id: branchId || null,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const slots = useQuery({
    queryKey: ["appt-slots", doctorId, date, clinicId, duration],
    enabled: open && Boolean(doctorId) && Boolean(date),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_doctor_available_slots", {
        p_doctor_id: doctorId,
        p_date: date,
        p_clinic_id: clinicId === NONE_VALUE ? null : clinicId || null,
        p_duration: Number(duration) || null,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * أقرب موعد متاح — ولو بعد أيّام.
   *
   * «الأوقات المتاحة» أعلاه تعرض خانات **اليوم المختار** وحده، فمن لا يجد
   * فراغًا اليوم يتنقّل يومًا يومًا بعينه — فيحجز في أوّل فراغٍ يراه لا في
   * أقرب فراغ فعليّ، ويترك فجوات في جدول الطبيب. والبحث في القاعدة
   * (`app_next_available_slot`، 0154) لا في المتصفّح: شبكةٌ حُمِّلت قبل
   * دقيقتين تقترح خانةً حُجزت.
   *
   * تقترح ولا تحجز: الحجز يبقى بمساره المعتاد بكل تحقّقاته.
   */
  const findNextSlot = useMutation({
    mutationFn: async () => {
      if (!organizationId || !doctorId) throw new Error("اختر الطبيب أوّلًا");
      const { data, error } = await supabase.rpc("app_next_available_slot", {
        p_organization_id: organizationId,
        p_doctor_id: doctorId,
        p_duration_minutes: Number(duration) || 30,
        p_from: new Date().toISOString(),
        p_days_ahead: 30,
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: (slot) => {
      if (!slot) {
        toast({
          variant: "destructive",
          title: "لا خانة متاحة خلال ثلاثين يومًا",
          description: "راجع دوام الطبيب — قد لا يكون له دوام مسجَّل أصلًا.",
        });
        return;
      }
      const at = new Date(slot);
      setDate(at.toLocaleDateString("en-CA"));
      setTime(at.toTimeString().slice(0, 5));
      toast({ title: `أقرب موعد: ${formatDateTime(at, calendarDisplay)}` });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر البحث", description: errorMessage(error) }),
  });

  const createAppointment = useMutation({
    mutationFn: async (vars?: { override?: boolean; printWindow?: Window | null }) => {
      if (!organizationId || !patient || !doctorId) throw new Error("أكمل بيانات المريض والطبيب والوقت");
      // حظر المواعيد في ملف المريض كان معروضًا بلا فرض — يُفرض هنا قبل أي كتابة
      await assertPatientNotBlocked(patient.id, "appointments");
      let start = new Date(`${date}T${time}:00`);
      if (waiting && waitingAllDay) {
        const dayStart = await doctorDayStart(doctorId, date);
        if (!dayStart) throw new Error("الطبيب لا يعمل في هذا اليوم حسب جدول دوامه — اختر يومًا آخر");
        start = new Date(dayStart);
      }
      // موعد الانتظار يُسجَّل ربع ساعة في أوّل وقته، وطوله الأصليّ محفوظ لحين حجز خانته
      const end = new Date(start.getTime() + (waiting ? 15 : Number(duration)) * 60_000);

      // دوام الطبيب كان مسجَّلًا في `doctor_working_hours` ولا تقرؤه هذه الشاشة
      const availability = await checkDoctorAvailability(doctorId, start, end);
      if (availability.status === "blocked") throw new Error(availability.message ?? "الطبيب غير متاح");
      if (availability.status === "outside" && !allowOutsideHours)
        throw new Error(
          `${availability.message} — فعّل "حجز خارج الدوام" إن كنت متأكدًا`,
        );

      if (followUpRequest) {
        // إنشاء الموعد وإغلاق الطلب في استدعاء واحد ذرّي.
        const { error } = await supabase.rpc("app_approve_appointment_request", {
          p_request_id: followUpRequest.id,
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_doctor_id: doctorId,
          p_clinic_id: clinicId === NONE_VALUE ? null : clinicId,
          p_note: note.trim() || null,
        });
        if (error) throw error;
        return null;
      }

      if (repeat && !waiting) {
        const { data: ids, error } = await supabase.rpc("app_create_appointment_series", {
          p_appointment: {
            organization_id: organizationId,
            doctor_id: doctorId,
            patient_id: patient.id,
            scheduled_start: start.toISOString(),
            scheduled_end: end.toISOString(),
            branch_id: branchId || null,
            clinic_id: clinicId === NONE_VALUE ? null : clinicId,
            item_id: service?.id ?? null,
            visit_type_value_id: visitTypeValueId || null,
            label_value_id: labelValueId || null,
            priority,
            note: note.trim() || null,
            accepts_earlier: acceptsEarlier,
          },
          p_count: Number(repeatCount),
          p_every_days: Number(repeatEvery),
          p_override: Boolean(vars?.override),
        });
        if (error) throw error;
        const list = (ids ?? []) as string[];
        const every = Number(repeatEvery);
        const series = list.map((_, index) => new Date(start.getTime() + index * every * 86_400_000).toISOString());
        if (vars?.printWindow && list[0]) {
          const row = await fetchAppointmentById(organizationId, list[0]);
          printAppointmentCard(row, calendarDisplay, { series, target: vars.printWindow });
        }
        return { id: list[0], scheduled_start: start.toISOString(), doctor_id: doctorId, count: list.length };
      }

      const { data: created, error } = await supabase.from("appointments").insert({
        organization_id: organizationId,
        doctor_id: doctorId,
        patient_id: patient.id,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        status: "scheduled",
        branch_id: branchId || null,
        clinic_id: clinicId === NONE_VALUE ? null : clinicId,
        item_id: service?.id ?? null,
        visit_type_value_id: visitTypeValueId || null,
        priority,
        note: note.trim() || null,
        created_by: session?.user.id ?? null,
        // يُستهلك في القاعدة ويعود false؛ ويبقى من تجاوز ومتى (0174)
        overlap_override: Boolean(vars?.override),
        accepts_earlier: acceptsEarlier,
        label_value_id: labelValueId || null,
        is_waiting: waiting,
        waiting_all_day: waiting && waitingAllDay,
        expected_duration_minutes: waiting ? Number(duration) || 30 : null,
      } as never)
        .select("id, scheduled_start, doctor_id")
        .single();
      if (error) throw error;
      const row = created as unknown as { id: string; scheduled_start: string; doctor_id: string };
      if (vars?.printWindow) {
        const full = await fetchAppointmentById(organizationId, row.id);
        printAppointmentCard(full, calendarDisplay, { target: vars.printWindow });
      }
      return { ...row, count: 1 };
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      // الموعد الجديد يدخل مواعيد اليوم في الاستقبال («نظام الدور»)
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      if (followUpRequest) {
        // قائمة طلبات الاستقبال تُحدَّث فورًا: طلبٌ أُنجز يبقى معلّقًا على
        // شاشة زميل آخر حتى يحدّث الصفحة، فيُحجز الموعد مرّتين.
        queryClient.invalidateQueries({ queryKey: ["reception-requests"] });
        onRequestBooked?.();
      }
      toast({
        title: followUpRequest
          ? "تم حجز موعد المتابعة وإغلاق الطلب"
          : created && created.count > 1
            ? `حُجزت ${created.count} مواعيد متكرّرة`
            : waiting
              ? "حُجز موعد انتظار"
              : "تم حجز الموعد",
      });
      if (created) onCreated?.({ id: created.id, scheduled_start: created.scheduled_start, doctor_id: created.doctor_id });
      setPatient(null);
      setDoctorId("");
      setService(null);
      setClinicId(NONE_VALUE);
      setVisitTypeValueId("");
      setPriority("normal");
      setAllowOutsideHours(false);
      setOverrideConfirmed(false);
      setNote("");
      setAcceptsEarlier(false);
      setLabelValueId("");
      setRepeat(false);
      setWaiting(false);
      onOpenChange(false);
    },
    onError: (error: unknown, vars) => {
      // نافذة الطباعة فُتحت مع الضغط (حاجب النوافذ لا يسمح بفتحها بعد الانتظار) — تُغلق مع الفشل
      vars?.printWindow?.close();
      // التعارض نافذةُ قرارٍ لا رسالةُ خطأ: انقل أو تجاهل — وقد يقع هنا وإن لم
      // يظهر في الفحص المسبق، إن حجز زميلٌ الوقت نفسه في اللحظة ذاتها.
      const info = parseOverlapError(error);
      if (info) {
        setOverrideConfirmed(false);
        setConflict(info);
        return;
      }
      toast({
        variant: "destructive",
        title: "تعذر حجز الموعد",
        description: errorMessage(error),
      });
    },
  });

  /**
   * «حجز»: إن كان الوقت محجوزًا ولم يُؤكَّد تجاهله تُفتح نافذة القرار بدل
   * الإرسال. وحجز طلب المتابعة يمرّ بدالّةٍ لا تحمل التجاوز، فنافذته بلا
   * زرّ «تجاهل».
   */
  const submitBooking = (withPrint = false) => {
    if (!waiting && overlap.data && !overrideConfirmed) {
      setConflict(overlap.data);
      return;
    }
    // تُفتح نافذة الطباعة مع الضغط نفسه: بعد انتظار الحفظ يحجبها المتصفّح
    const printWindow = withPrint ? window.open("", "_blank") : null;
    createAppointment.mutate({ override: overrideConfirmed && !followUpRequest && !waiting, printWindow });
  };
  const repeatInvalid =
    repeat &&
    (!Number.isInteger(Number(repeatCount)) ||
      Number(repeatCount) < 2 ||
      Number(repeatCount) > 52 ||
      !Number.isInteger(Number(repeatEvery)) ||
      Number(repeatEvery) < 1 ||
      Number(repeatEvery) > 90);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{followUpRequest ? "حجز موعد متابعة (طلب طبيب)" : waiting ? "حجز موعد انتظار (W.P)" : "حجز موعد جديد"}</DialogTitle>
            <DialogDescription>
              {followUpRequest
                ? "الحجز يُغلق طلب المتابعة تلقائيًا. الأولوية والخدمة ونوع الزيارة تُضاف بعد الإنشاء من «تعديل» — القاعدة تسجّل الطبيب والعيادة والوقت والملاحظة."
                : "حجز مسبق لمريض موجود أو فتح ملف سريع أولًا"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>المريض</Label>
              {/* مريض طلب المتابعة يحدّده الطلب في القاعدة، فاختيار مريض آخر
                  هنا لن يُغيّر شيئًا — ولا يُعرض حتى لا يُفهم أنه يُغيّره. */}
              {followUpRequest ? (
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
                  {patient?.name_ar ?? "مريض الطلب"}
                </p>
              ) : (
                <>
                  <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
                  {patient && <p className="text-xs text-emerald-700">المريض المحدد: {patient.name_ar}</p>}
                  <button
                    type="button"
                    className="self-start text-xs font-medium text-primary hover:underline"
                    onClick={() => setQuickAddOpen(true)}
                  >
                    مريض جديد بلا ملف؟ فتح ملف سريع
                  </button>
                </>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>الفرع</Label>
                <Select
                  value={branchId || NONE_VALUE}
                  onValueChange={(value) => {
                    setBranchId(value === NONE_VALUE ? "" : value);
                    // تغيير الفرع يُبطل ما بعده في السلسلة: عيادةٌ من فرع
                    // آخر تبقى محدَّدة تُنتج موعدًا ترفضه القاعدة.
                    setClinicId(NONE_VALUE);
                    setDoctorId("");
                    setService(null);
                    setWarnings([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="كل الفروع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>كل الفروع</SelectItem>
                    {(branches.data ?? []).map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>العيادة</Label>
                <Select
                  value={clinicId}
                  onValueChange={(value) => {
                    setClinicId(value);
                    setDoctorId("");
                    setService(null);
                    setWarnings([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر العيادة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>بدون عيادة</SelectItem>
                    {(clinicOptions.data ?? []).map((clinic: any) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinic.name}
                        {clinic.department_name ? ` — ${clinic.department_name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>الطبيب</Label>
              <Select
                value={doctorId}
                onValueChange={async (value) => {
                  setDoctorId(value);
                  setService(null);
                  const { data } = await supabase.rpc("app_doctor_booking_warnings", {
                    p_doctor_id: value,
                  });
                  setWarnings((data as string[]) ?? []);
                  const picked = (doctorOptions.data ?? []).find((d: any) => d.id === value);
                  if (picked?.default_duration) setDuration(String(picked.default_duration));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الطبيب" />
                </SelectTrigger>
                <SelectContent>
                  {(doctorOptions.data ?? []).map((doctor: any) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      د. {doctor.name_ar}
                      {doctor.specialty ? ` — ${doctor.specialty}` : ""}
                    </SelectItem>
                  ))}
                  {/* العيادة غير محدَّدة: تُعرض قائمة المنشأة كاملة كي لا
                      يتعطّل الحجز السريع، والقاعدة تفحص الارتباط عند الحفظ. */}
                  {(clinicId === NONE_VALUE || !clinicId) &&
                    doctors.map((doctor) => (
                      <SelectItem key={doctor.id} value={doctor.id}>
                        د. {doctor.name_ar}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {warnings.length > 0 && (
                <p className="text-xs text-amber-700">{warnings.join(" — ")}</p>
              )}
            </div>
            {/* حقول لا تكتبها دالّة الموافقة على طلب المتابعة: تُخفى في هذا
                المسار بدل عرضها ثم إهمال ما يُدخله الموظف فيها. */}
            <div className="flex flex-col gap-1.5" hidden={Boolean(followUpRequest)}>
              <Label>الخدمة المطلوبة (اختياري)</Label>
              {doctorId ? (
                <Select
                  value={service?.id ?? NONE_VALUE}
                  onValueChange={(value) => {
                    if (value === NONE_VALUE) {
                      setService(null);
                      return;
                    }
                    const picked = (serviceOptions.data ?? []).find((x: any) => x.id === value);
                    setService({ id: value, name: picked?.name_ar ?? "" });
                    if (picked?.duration_minutes) setDuration(String(picked.duration_minutes));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الخدمة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>بدون خدمة محدَّدة</SelectItem>
                    {(serviceOptions.data ?? []).map((item: any) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name_ar}
                        {item.duration_minutes ? ` — ${item.duration_minutes} د` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  اختر الطبيب أولًا لتظهر خدماته.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                تحديد الخدمة يضبط المدة والعيادة، ويمنع حجزًا لا يصلح للمريض.
              </p>
            </div>
            {!followUpRequest && (
              <div className="flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50/50 p-2.5 text-sm dark:bg-sky-950/20">
                <label className="flex cursor-pointer items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={waiting}
                    onChange={(e) => {
                      setWaiting(e.target.checked);
                      if (e.target.checked) setRepeat(false);
                    }}
                  />
                  <Clock className="h-4 w-4 text-sky-700" />
                  موعد انتظار (W.P) — يومٌ بلا خانة وقت، يُحجز له وقتٌ حين يتاح
                </label>
                {waiting && (
                  <div className="flex flex-wrap items-center gap-4 ps-6 text-xs">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input type="radio" checked={waitingAllDay} onChange={() => setWaitingAllDay(true)} />
                      طوال اليوم (من بداية دوام الطبيب)
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input type="radio" checked={!waitingAllDay} onChange={() => setWaitingAllDay(false)} />
                      ينتظر من الساعة المكتوبة أدناه
                    </label>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label>التاريخ</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{waiting ? "من الساعة" : "الوقت"}</Label>
                <Input
                  type="time"
                  value={time}
                  disabled={waiting && waitingAllDay}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>المدة (دقيقة)</Label>
                <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
              </div>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="self-start"
              disabled={!doctorId || findNextSlot.isPending}
              title={doctorId ? "أوّل خانة تتّسع للمدّة في دوام الطبيب" : "اختر الطبيب أوّلًا"}
              onClick={() => findNextSlot.mutate()}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              {findNextSlot.isPending ? "جارٍ البحث..." : "أقرب موعد"}
            </Button>

            {!waiting && (
              <OverlapNotice
                info={overlap.data}
                requestedStart={plannedStart}
                onMove={moveToFreeTime}
                overrideConfirmed={overrideConfirmed}
                onUndoOverride={() => setOverrideConfirmed(false)}
              />
            )}

            {/* الأوقات المتاحة تُحسب في القاعدة من جدول الطبيب ومواعيده
                واستثناءاته — لا في المتصفّح، حيث قد تكون البيانات تغيّرت
                بين التحميل والضغط. */}
            {doctorId && !waiting && (slots.data ?? []).length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>الأوقات المتاحة</Label>
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
                  {(slots.data ?? []).map((slot: any) => {
                    const label = new Date(slot.slot_start).toLocaleTimeString("ar-SA", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <Button
                        key={slot.slot_start}
                        size="sm"
                        type="button"
                        variant={
                          time === new Date(slot.slot_start).toTimeString().slice(0, 5)
                            ? "default"
                            : "outline"
                        }
                        disabled={!slot.is_free}
                        title={slot.block_reason ?? (slot.is_free ? "" : "محجوز")}
                        className="h-7 px-2 text-xs"
                        onClick={() => setTime(new Date(slot.slot_start).toTimeString().slice(0, 5))}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
            {doctorId && slots.isSuccess && (slots.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">
                لا جدول دوام مسجَّل لهذا الطبيب في هذا اليوم — الوقت يُدخَل يدويًا.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2" hidden={Boolean(followUpRequest)}>
              <div className="flex flex-col gap-1.5">
                <Label>نوع الزيارة</Label>
                <LookupSelect
                  categoryKey="visit_types"
                  value={visitTypeValueId}
                  onChange={setVisitTypeValueId}
                  placeholder="بدون"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>وسم الموعد</Label>
                <LookupSelect
                  categoryKey="appointment_labels"
                  value={labelValueId}
                  onChange={setLabelValueId}
                  allowClear
                  placeholder="بدون"
                />
              </div>
            </div>
            {!followUpRequest && (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm">
                <input type="checkbox" checked={acceptsEarlier} onChange={(e) => setAcceptsEarlier(e.target.checked)} />
                <ArrowUpCircle className="h-4 w-4 text-primary" />
                يقبل موعدًا أبكر إن فرغت خانة عند الطبيب (أولوية التقريب)
              </label>
            )}
            {!followUpRequest && !waiting && (
              <div className="flex flex-col gap-2 rounded-md border p-2.5 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
                  تكرار الموعد
                </label>
                {repeat && (
                  <div className="flex flex-wrap items-center gap-2 ps-6 text-xs">
                    <span>عدد المواعيد</span>
                    <Input
                      type="number"
                      min={2}
                      max={52}
                      value={repeatCount}
                      onChange={(e) => setRepeatCount(e.target.value)}
                      className="h-8 w-20"
                    />
                    <span>كلّ</span>
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      value={repeatEvery}
                      onChange={(e) => setRepeatEvery(e.target.value)}
                      className="h-8 w-20"
                    />
                    <span>يوم</span>
                    <span className="w-full text-muted-foreground">
                      كلّ موعدٍ يُفحص لدوام الطبيب والتداخل؛ إن تعذّر واحدٌ لم يُحجز أيٌّ منها، والرسالة تقول أيّها.
                    </span>
                    {repeatInvalid && <span className="w-full text-destructive">العدد بين 2 و52، والفاصل بين يوم و90 يومًا.</span>}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5" hidden={Boolean(followUpRequest)}>
              <Label>أولوية الاستقبال</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">عادي</SelectItem>
                  <SelectItem value="urgent">عاجل</SelectItem>
                  <SelectItem value="emergency">طارئ</SelectItem>
                  <SelectItem value="elderly">كبار السن</SelectItem>
                  <SelectItem value="accessibility">ذوو الإعاقة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>ملاحظة الموعد</Label>
                {/* مستهلك `canned_texts` لموضع appointment_note (0009) */}
                <CannedTextPicker
                  locationKey="appointment_note"
                  onInsert={(text) => setNote((prev) => appendCannedText(prev, text))}
                />
              </div>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={allowOutsideHours}
                onChange={(e) => setAllowOutsideHours(e.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span>حجز خارج فترات دوام الطبيب</span>
                <span className="text-xs text-muted-foreground">
                  فترات الحجب (إجازة أو عملية) تبقى ممنوعة ولا يتجاوزها هذا الخيار.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter className="gap-2">
            {!followUpRequest && (
              <Button
                variant="outline"
                disabled={!patient || !doctorId || createAppointment.isPending || repeatInvalid}
                onClick={() => submitBooking(true)}
              >
                <Printer className="h-4 w-4" />
                حفظ مع طباعة
              </Button>
            )}
            <Button
              disabled={!patient || !doctorId || createAppointment.isPending || repeatInvalid}
              onClick={() => submitBooking()}
            >
              {createAppointment.isPending ? "جارٍ الحجز..." : waiting ? "حجز موعد الانتظار" : "حجز الموعد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickAddPatientDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onCreated={(created) => setPatient({ id: created.id, name_ar: created.name_ar })}
      />

      <OverlapConfirmDialog
        info={conflict}
        requestedStart={plannedStart}
        onClose={() => setConflict(null)}
        onMove={moveToFreeTime}
        allowOverride={!followUpRequest}
        onOverrideConfirmed={() => {
          setOverrideConfirmed(true);
          setConflict(null);
          createAppointment.mutate({ override: true });
        }}
      />
    </>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
 * العرض الجدوليّ وقائمة الزرّ الأيمن
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * إجراءات الحالة المعروضة في القائمة.
 *
 * **هذه أفعالٌ لا حالات.** القائمة لا تكتب `status` مباشرةً: كل بند يستدعي
 * `app_reception_transition` بفعله، فتفرض القاعدة ما يصحّ من أين، وتكتب
 * الطابع الزمنيّ المرافق، وتفحص الصلاحية. وقائمةٌ تعرض أربع عشرة حالةً
 * يُختار منها أيّ واحدة كانت ستسمح بـ«مكتمل» لموعدٍ لم يحضر صاحبه.
 */
const TRANSITION_ACTIONS: {
  action: string;
  label: string;
  from: AppointmentStatus[];
  needsReason?: boolean;
}[] = [
  { action: "confirm", label: "تأكيد الموعد", from: ["new", "scheduled", "unconfirmed"] },
  // الخطوات الأربع بأسمائها في كلّ شاشة (0175): وصل ← نداء ← دخل ← خرج.
  // «تسجيل الدخول» (استقبال ٢) دُمج في «وصل» — كان يُقرأ «دخل الغرفة».
  { action: "arrive", label: "وصل", from: ["confirmed", "scheduled", "new", "unconfirmed"] },
  { action: "call", label: "نداء", from: ["arrived", "checked_in", "waiting", "walk_in"] },
  { action: "recall", label: "إعادة النداء", from: ["called"] },
  { action: "uncall", label: "إلغاء النداء", from: ["called"] },
  { action: "start", label: "دخل", from: ["called", "checked_in", "arrived", "waiting", "walk_in"] },
  { action: "finish", label: "خرج", from: ["in_progress"] },
  {
    action: "no_show",
    label: "لم يحضر",
    from: ["new", "scheduled", "confirmed", "unconfirmed", "arrived"],
    needsReason: true,
  },
  {
    action: "cancel",
    label: "إلغاء الموعد",
    from: [
      "new",
      "scheduled",
      "confirmed",
      "unconfirmed",
      "arrived",
      "checked_in",
      "called",
      "in_progress",
      "waiting",
      "walk_in",
    ],
    needsReason: true,
  },
];

/** بطاقة الموعد المطبوعة — ما يُسلَّم للمريض أو يُعلَّق على ملفّه. */
function printAppointmentCard(
  appointment: AppointmentWithRelations,
  calendarDisplay: CalendarDisplay,
  options?: {
    /** بدايات المواعيد المتكرّرة حين تُحجز معًا. */
    series?: string[];
    /** نافذةٌ فُتحت مع الضغط — «حفظ مع طباعة» يطبع بعد الحفظ فيها. */
    target?: Window | null;
  },
) {
  const waitingRow = extrasOf(appointment).is_waiting
    ? `<tr><td style="color:#555">موعد انتظار</td><td style="text-align:end">${
        extrasOf(appointment).waiting_all_day ? "طوال اليوم — يُبلَّغ بوقته" : "من الساعة المذكورة — يُبلَّغ بوقته"
      }</td></tr>`
    : "";
  const seriesRow =
    options?.series && options.series.length > 1
      ? `<tr><td style="color:#555">المواعيد</td><td style="text-align:end">${options.series
          .map((at) => `${formatDate(at, calendarDisplay)} ${formatTime(at)}`)
          .join("<br/>")}</td></tr>`
      : "";
  const esc = (value: unknown) =>
    String(value ?? "—")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const row = (label: string, value: unknown) =>
    `<tr><td style="color:#555">${esc(label)}</td><td style="text-align:end">${esc(value)}</td></tr>`;
  printHtml(
    `موعد ${appointment.patient?.name_ar ?? ""}`,
    `<div style="text-align:center"><h2 style="margin:0 0 6px">بطاقة موعد</h2></div>
     <table><tbody>
       ${row("المريض", appointment.patient?.name_ar)}
       ${row("رقم الملف", appointment.patient?.file_number)}
       ${row("الجوال", appointment.patient?.mobile_number)}
       ${row("الطبيب", appointment.doctor?.name_ar)}
       ${row("العيادة", appointment.clinic?.name)}
       ${row("التاريخ", formatDate(appointment.scheduled_start, calendarDisplay))}
       ${row("الوقت", formatTime(appointment.scheduled_start))}
       ${row("النهاية", formatTime(appointment.scheduled_end))}
       ${row("الحالة", statusLabel(appointment.status))}
       ${row("ملاحظة", appointment.note)}
       ${waitingRow}
       ${seriesRow}
     </tbody></table>
     <p style="margin-top:8px;font-size:10px;color:#666;text-align:center">
       يُرجى الحضور قبل الموعد بعشر دقائق.
     </p>`,
    "thermal_80mm",
    options?.target ?? undefined,
  );
}

function AppointmentsTable({
  rows,
  loading,
  calendarDisplay,
  memberNames,
  visitTypes,
  activeVisitTypes,
  canSchedule,
  onEdit,
  onTransition,
  onAskReason,
  onSetVisitType,
  onPrint,
  onRefresh,
  onPatientCommands,
  labels,
  onSendToWaiting,
  onWaitingOther,
  onAssignSlot,
}: {
  rows: AppointmentWithRelations[];
  loading: boolean;
  calendarDisplay: CalendarDisplay;
  memberNames: Map<string, string> | undefined;
  visitTypes: Map<string, string>;
  activeVisitTypes: { id: string; name: string }[];
  canSchedule: boolean;
  onEdit: (appointment: AppointmentWithRelations) => void;
  onTransition: (appointment: AppointmentWithRelations, action: string) => void;
  onAskReason: (appointment: AppointmentWithRelations, action: "no_show" | "cancel") => void;
  onSetVisitType: (appointment: AppointmentWithRelations, valueId: string | null) => void;
  onPrint: (appointment: AppointmentWithRelations) => void;
  onRefresh: () => void;
  onPatientCommands: (appointment: AppointmentWithRelations) => void;
  labels: Map<string, string>;
  onSendToWaiting: (appointment: AppointmentWithRelations, dayKey: string) => void;
  onWaitingOther: (appointment: AppointmentWithRelations) => void;
  onAssignSlot: (appointment: AppointmentWithRelations) => void;
}) {
  const navigate = useNavigate();
  if (loading) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">التاريخ</TableHead>
            <TableHead className="whitespace-nowrap">الوقت</TableHead>
            <TableHead className="whitespace-nowrap">النهاية</TableHead>
            <TableHead className="whitespace-nowrap">رقم الملف</TableHead>
            <TableHead className="min-w-[10rem]">المريض</TableHead>
            <TableHead className="whitespace-nowrap">الجوال</TableHead>
            <TableHead className="min-w-[10rem]">ملاحظات</TableHead>
            <TableHead className="whitespace-nowrap">أضافه</TableHead>
            <TableHead className="whitespace-nowrap">تاريخ التسجيل</TableHead>
            <TableHead className="whitespace-nowrap">آخر تعديل</TableHead>
            <TableHead className="whitespace-nowrap">مؤكَّد</TableHead>
            <TableHead className="whitespace-nowrap">الزيارة</TableHead>
            <TableHead className="whitespace-nowrap">الحالة</TableHead>
            <TableHead className="w-10"> </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((appointment) => {
            const confirmed = ![
              "new",
              "scheduled",
              "unconfirmed",
              "cancelled_by_patient",
              "cancelled_by_staff",
            ].includes(appointment.status);
            const menu = (
              <ContextMenuContent className="w-60">
                <ContextMenuLabel>{appointment.patient?.name_ar ?? "الموعد"}</ContextMenuLabel>
                <ContextMenuItem disabled={!canSchedule} onSelect={() => onEdit(appointment)}>
                  <Edit3 className="h-4 w-4" />
                  تعديل
                </ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={!canSchedule}>حالة الموعد</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-56">
                    {TRANSITION_ACTIONS.map((entry) => (
                      <ContextMenuItem
                        key={entry.action}
                        disabled={!entry.from.includes(appointment.status)}
                        onSelect={() =>
                          entry.needsReason
                            ? onAskReason(appointment, entry.action as "no_show" | "cancel")
                            : onTransition(appointment, entry.action)
                        }
                      >
                        {entry.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={!canSchedule}>نوع الزيارة</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                    <ContextMenuItem onSelect={() => onSetVisitType(appointment, null)}>
                      بدون
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {activeVisitTypes.map((entry) => (
                      <ContextMenuItem
                        key={entry.id}
                        onSelect={() => onSetVisitType(appointment, entry.id)}
                      >
                        {entry.name}
                      </ContextMenuItem>
                    ))}
                    {activeVisitTypes.length === 0 && (
                      <ContextMenuItem disabled>
                        لا أنواع زيارات — تُضاف من الإعدادات ← اللوائح
                      </ContextMenuItem>
                    )}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                {extrasOf(appointment).is_waiting ? (
                  <ContextMenuItem disabled={!canSchedule} onSelect={() => onAssignSlot(appointment)}>
                    <Clock className="h-4 w-4" />
                    حجز خانة وقت لموعد الانتظار
                  </ContextMenuItem>
                ) : (
                  <SendToWaitingSubmenu
                    disabled={!canSchedule || !isNotArrived(appointment.status)}
                    onPick={(dayKey) => onSendToWaiting(appointment, dayKey)}
                    onOther={() => onWaitingOther(appointment)}
                  />
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onPrint(appointment)}>
                  <Printer className="h-4 w-4" />
                  طباعة
                </ContextMenuItem>
                <ContextMenuItem onSelect={onRefresh}>
                  <RefreshCw className="h-4 w-4" />
                  تحديث
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onPatientCommands(appointment)}>
                  <MoreHorizontal className="h-4 w-4" />
                  إجراءات أخرى على ملفّ المريض
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => navigate(`/reception?appointmentId=${appointment.id}`)}>
                  <ExternalLink className="h-4 w-4" />
                  فتح في الاستقبال
                </ContextMenuItem>
              </ContextMenuContent>
            );

            return (
              <ContextMenu key={appointment.id}>
                <ContextMenuTrigger asChild>
                  <TableRow className="cursor-context-menu">
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {formatDate(appointment.scheduled_start, calendarDisplay)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {formatTime(appointment.scheduled_start)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {formatTime(appointment.scheduled_end)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {appointment.patient?.file_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-start font-medium hover:text-primary"
                        onClick={() => navigate(`/patients/${appointment.patient_id}`)}
                      >
                        {appointment.patient?.name_ar ?? "—"}
                      </button>
                      <div className="text-[11px] text-muted-foreground">
                        {appointment.doctor?.name_ar ?? "—"}
                        {appointment.clinic?.name ? ` · ${appointment.clinic.name}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {appointment.patient?.mobile_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="line-clamp-2">{appointment.note ?? "—"}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {appointment.created_by
                        ? memberNames?.get(appointment.created_by) ?? "—"
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {formatDateTime(appointment.created_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {formatDateTime(appointment.updated_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {confirmed ? (
                        <Badge className="bg-emerald-100 text-emerald-700">مؤكَّد</Badge>
                      ) : (
                        <Badge variant="outline">لا</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {appointment.visit_type_value_id
                        ? visitTypes.get(appointment.visit_type_value_id) ?? "—"
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Badge className={statusBadgeClass(appointment.status)}>
                          {statusLabel(appointment.status)}
                        </Badge>
                        {extrasOf(appointment).is_waiting && (
                          <Badge variant="outline" className="border-sky-300 text-sky-700" title="موعد انتظار بلا خانة وقت">
                            انتظار
                          </Badge>
                        )}
                        {extrasOf(appointment).accepts_earlier && (
                          <span title="يقبل موعدًا أبكر"><ArrowUpCircle className="h-3.5 w-3.5 text-primary" /></span>
                        )}
                        {extrasOf(appointment).label_value_id && (
                          <Badge variant="secondary" className="text-[10px]">
                            {labels.get(extrasOf(appointment).label_value_id ?? "") ?? "وسم"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </TableCell>
                  </TableRow>
                </ContextMenuTrigger>
                {menu}
              </ContextMenu>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={14} className="py-10 text-center text-sm text-muted-foreground">
                لا مواعيد في هذا اليوم بهذا الترشيح.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-4 border-t bg-muted/30 px-3 py-2 text-xs">
        <span>
          إجمالي العدد:{" "}
          <span className="font-mono font-semibold tabular-nums">{formatAmount(rows.length)}</span>
        </span>
        <span>
          المدخلون:{" "}
          <span className="font-mono font-semibold tabular-nums">
            {formatAmount(rows.filter((row) => row.checked_in_1_at).length)}
          </span>
        </span>
        <span>
          غير المدخلين:{" "}
          <span className="font-mono font-semibold tabular-nums">
            {formatAmount(rows.filter((row) => !row.checked_in_1_at).length)}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * سبب «لم يحضر» و«الإلغاء».
 *
 * القاعدة تطلبهما وترفض بدونهما (0065/0158). وطلبهما هنا **قبل** الاستدعاء
 * يجعل الرفض مستحيلًا بدل أن يكون رسالة خطأ يراها الموظّف بعد الضغط.
 */
function AppointmentReasonDialog({
  target,
  onOpenChange,
  onSubmit,
  pending,
}: {
  target: { appointment: AppointmentWithRelations; action: "no_show" | "cancel" } | null;
  onOpenChange: () => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [target?.appointment.id, target?.action]);

  const title = target?.action === "no_show" ? "تسجيل عدم الحضور" : "إلغاء الموعد";
  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {target?.appointment.patient?.name_ar ?? ""} — السبب يُحفظ على الموعد ويظهر في التقارير.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>السبب *</Label>
          <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange}>
            تراجع
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || pending}
            onClick={() => onSubmit(reason.trim())}
          >
            {pending ? "جارٍ التنفيذ..." : "تأكيد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
