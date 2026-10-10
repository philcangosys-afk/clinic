import { forwardRef, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpCircle,
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Printer,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Users,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { SendToWaitingSubmenu } from "@/components/appointments/WaitingControls";
import { isNotArrived, isUnconfirmed } from "@/lib/appointment-extras";
import { supabase } from "@/lib/supabase";
import { useSessionDoctor } from "@/lib/session-doctor";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { APPOINTMENT_STATUS_LABELS, statusGroup } from "@/lib/appointment-status";
import { printHtml } from "@/lib/document-merge";

/**
 * تقويم المواعيد.
 *
 * الشاشة كانت قائمة ليوم واحد: لا يرى الموظف جدول الطبيب، ولا الفجوات، ولا
 * أوقات عدم توفّره — فيسأل الطبيب هاتفيًا قبل كل حجز.
 *
 * ثلاثة قرارات تصميم تستحق الشرح:
 *
 * 1. **السحب لا يُثبِّت شيئًا.** الإفلات يفتح نافذة تأكيد تعرض القديم
 *    والجديد وتطلب السبب، ولا يُكتب شيء قبل الموافقة. الإفلات حركة يد سهلة
 *    الخطأ — بكسل واحد ينتقل الموعد نصف ساعة — ونقل موعد مريض ليس مما يُترك
 *    لخطأ يد.
 *
 * 2. **لا تحديث متفائل.** بعد نجاح النداء يُعاد الجلب من القاعدة. القاعدة
 *    قد ترفض لأسباب لا يعرفها المتصفح (تداخل، إجازة اعتُمدت للتوّ، فرع)،
 *    فرسم الموعد في مكانه الجديد ثم إعادته يُربك أكثر مما يُسرّع.
 *
 * 3. **أوقات عدم التوفّر تُرسَم لا تُخفى.** المساحة المظلَّلة تقول «هنا لا
 *    يُحجز» — أوضح من نافذة خطأ بعد المحاولة.
 */

type CalendarAppointment = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  priority: string;
  queue_number: number | null;
  doctor_id: string;
  clinic_id: string | null;
  note: string | null;
  patient: {
    id: string;
    name_ar: string;
    file_number: number | string | null;
    mobile_number: string | null;
    insurance_company_name: string | null;
  } | null;
  doctor: { id: string; name_ar: string } | null;
  clinic: { id: string; name: string } | null;
  visit_type: { name_ar: string } | null;
  /** 0197 — موعد انتظار (W.P) بلا خانة وقت، وأولوية التقريب، والوسم */
  is_waiting?: boolean | null;
  waiting_all_day?: boolean | null;
  accepts_earlier?: boolean | null;
  label_value_id?: string | null;
};

/**
 * ما تطلبه قائمة الزرّ الأيمن على كتلة الموعد من الشاشة — الشاشة تملك نوافذ
 * الإدارة والأوامر، والتقويم يرسم ويبلِّغ.
 */
export type BlockAction =
  | { kind: "open" }
  | { kind: "confirm" }
  | { kind: "waiting"; day: string }
  | { kind: "waiting_other" }
  | { kind: "assign_slot" }
  | { kind: "patient_file" }
  | { kind: "patient_commands" }
  | { kind: "print" };

/**
 * تخصيص العرض والضبط (Kizen «تخصيص العرض» و«الضبط»): مقياس الخانة، والتكبير،
 * وتفاصيل الموعد، ومرضى الانتظار، والتحديث التلقائيّ. يُحفظ في متصفّح المستخدم
 * نفسه — تفضيلٌ شخصيّ لا بيانات منشأة — ويعود إلى الافتراض إن تعذّر.
 */
type ScheduleSettings = {
  slotMinutes: 15 | 30 | 60;
  zoom: number;
  showDetails: boolean;
  showWaiting: boolean;
  autoRefresh: boolean;
  refreshSeconds: number;
};

const DEFAULT_SETTINGS: ScheduleSettings = {
  slotMinutes: 15,
  zoom: 1,
  showDetails: true,
  showWaiting: true,
  autoRefresh: true,
  refreshSeconds: 60,
};
const SETTINGS_KEY = "zc.schedule.settings.v1";

function loadSettings(): ScheduleSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ScheduleSettings>;
    return {
      slotMinutes: [15, 30, 60].includes(Number(parsed.slotMinutes)) ? (Number(parsed.slotMinutes) as 15 | 30 | 60) : 15,
      zoom: Math.min(2, Math.max(0.6, Number(parsed.zoom) || 1)),
      showDetails: parsed.showDetails ?? true,
      showWaiting: parsed.showWaiting ?? true,
      autoRefresh: parsed.autoRefresh ?? true,
      refreshSeconds: Math.min(600, Math.max(15, Number(parsed.refreshSeconds) || 60)),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(value: ScheduleSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch {
    // المتصفّح يمنع التخزين (نافذة خاصّة): يبقى الضبط لهذه الجلسة وحدها
  }
}

/**
 * مسارات الأوقات المتزامنة: مواعيدُ تتقاطع في العمود نفسه تُرسم جنبًا إلى جنب
 * لا فوق بعضها. لكلّ موعدٍ مساره وعدد مسارات مجموعته المتقاطعة.
 */
function laneLayout(rows: CalendarAppointment[]) {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime(),
  );
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number; end: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 1);
    cluster.forEach((item) => result.set(item.id, { lane: item.lane, lanes }));
    cluster = [];
  };
  for (const row of sorted) {
    const start = new Date(row.scheduled_start).getTime();
    const end = Math.max(new Date(row.scheduled_end).getTime(), start + 15 * 60000);
    if (start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    const used = new Set(cluster.filter((item) => item.end > start).map((item) => item.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    cluster.push({ id: row.id, lane, end });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return result;
}

type WorkingWindow = {
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  is_blocked: boolean;
  note: string | null;
};

/** توفّر الطبيب في اليوم من `app_doctors_day_availability` (0192). */
type DayAvailability = {
  doctor_id: string;
  kind: "work" | "off" | "blocked";
  starts_at: string;
  ends_at: string;
  label: string | null;
};

/**
 * إطار شبكة اليوم: ساعة البداية والنهاية وحجم الخانة.
 *
 * كانت الشبكة ثابتةً من الثامنة إلى الثامنة مساءً بخانة نصف ساعة، فموعد
 * العاشرة ليلًا لا يُرسم أصلًا، وموعد ربع ساعة يُحجز في خانةٍ ضعفه. الآن يمتدّ
 * الإطار ليشمل أبكر دوامٍ وآخر موعدٍ في اليوم، والخانة ربع ساعة.
 */
type DayFrame = { startHour: number; endHour: number; slotMinutes: number; px: number };

const DEFAULT_FRAME: DayFrame = { startHour: 8, endHour: 20, slotMinutes: 30, px: 1.1 };

export type CalendarView = "day" | "workweek" | "week" | "month" | "list";
type GroupBy = "doctor" | "clinic";

const VIEW_LABELS: Record<CalendarView, string> = {
  day: "يوم",
  workweek: "أسبوع العمل",
  week: "أسبوع كامل",
  month: "شهر",
  list: "قائمة",
};

/**
 * اسم الحالة ولونها من المصدر الواحد (0176) — كانت هنا خريطةٌ ثالثة بألوانٍ
 * تخالف القائمة والاستقبال: «مؤكَّد» أزرق هنا وأخضر هناك.
 */
const STATUS_STYLES: Record<string, { label: string; className: string }> = Object.fromEntries(
  Object.entries(APPOINTMENT_STATUS_LABELS).map(([status, label]) => [
    status,
    { label, className: statusGroup(status).block },
  ]),
);

const PRIORITY_MARKS: Record<string, { label: string; className: string }> = {
  emergency:     { label: "طارئ", className: "bg-red-600 text-white" },
  urgent:        { label: "عاجل", className: "bg-orange-500 text-white" },
  elderly:       { label: "كبير سن", className: "bg-amber-500 text-white" },
  accessibility: { label: "احتياج", className: "bg-amber-500 text-white" },
};

// شبكة اليوم: من الثامنة صباحًا إلى الثامنة مساءً، صفٌّ لكل نصف ساعة.
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;
const SLOT_MINUTES = 30;
const PX_PER_MINUTE = 1.1;
const TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** بداية الأسبوع = السبت (الأسبوع الإداري في السعودية). */
function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const shift = (next.getDay() + 1) % 7;
  next.setDate(next.getDate() - shift);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function minutesFromDayStart(iso: string, startHour: number = DAY_START_HOUR, day?: Date) {
  const date = new Date(iso);
  // موعدٌ يعبر إلى اليوم التالي (بعد منتصف الليل) يُقاس من بداية يوم الشبكة
  const dayOffset = day ? Math.round((startOfDay(date).getTime() - startOfDay(day).getTime()) / 86_400_000) : 0;
  return (dayOffset * 24 + date.getHours() - startHour) * 60 + date.getMinutes();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * تاريخ محلي بصيغة YYYY-MM-DD.
 *
 * ليس `toISOString().slice(0,10)`: ذاك يحوّل إلى UTC، فيعطي «أمس» لكل من
 * يستعمل النظام مساءً شرق غرينتش — أي كل مستخدمي المنشأة.
 */
function toDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function AppointmentCalendar({
  organizationId,
  selectedDay,
  doctors,
  clinics,
  search,
  statusFilter,
  onCreateAt,
  onOpenAppointment,
  onViewChange,
  highlightId,
  onDayChange,
  onBlockAction,
  labels,
}: {
  organizationId: string | undefined;
  selectedDay: string;
  /** موعدٌ يُبرَز في الشبكة — الموعد المحجوز للتوّ من «حجز موعد جديد». */
  highlightId?: string | null;
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
  /**
   * البحث ومرشّح الحالة من شاشة المواعيد.
   *
   * كانا يُستهلكان في قائمة «بطاقات الأطباء» وحدها، والتقويم هو العرض
   * الافتراضي — فكان الموظف يكتب اسم المريض في حقل البحث ولا يتغيّر شيء على
   * الشاشة، فيستنتج أن التصفية معطّلة في النظام. مرشِّحٌ معروضٌ بلا أثر أسوأ
   * من غياب المرشِّح.
   */
  search?: string;
  /** حالةٌ واحدة، أو قائمة حالات (مجموعةٌ من شريط الحالات)، أو فارغ للكلّ. */
  statusFilter?: string | string[];
  onCreateAt: (start: Date, doctorId: string | null, clinicId: string | null) => void;
  onOpenAppointment: (appointmentId: string) => void;
  /**
   * يُبلِّغ الشاشة بنمط العرض الحالي.
   *
   * الشاشة تملك أسهم التاريخ في ترويستها، وكانت تتحرّك **يومًا واحدًا دائمًا**
   * مهما كان العرض. ففي العرض الشهري يقفز التاريخ يومًا واحدًا، ويعيد التقويم
   * ضبط مرساته عليه — فيبقى الشهر نفسه معروضًا مهما ضُغط السهم، ولا يُبلَغ
   * الشهر التالي إلّا بثلاثين ضغطة. فتتبع الشاشة نمط العرض وتتحرّك بوحدته:
   * يومًا، أو أسبوعًا، أو شهرًا.
   */
  onViewChange?: (view: CalendarView) => void;
  /**
   * التنقّل داخل التقويم (أسهمه، «اليوم»، التقويم المصغّر، «أقرب يوم فيه
   * مواعيد») يُبلِّغ الشاشة باليوم الجديد — كانت أسهم التقويم تحرّكه وحده
   * وتبقى الشاشة على يومها، فيفتح «موعد جديد» على يومٍ غير المعروض.
   */
  onDayChange?: (dayKey: string) => void;
  onBlockAction?: (appointmentId: string, action: BlockAction) => void;
  /** أسماء وسوم المواعيد (لائحة appointment_labels). */
  labels?: Map<string, string>;
}) {
  const { can } = usePermissions();
  const [view, setView] = useState<CalendarView>("day");

  useEffect(() => {
    onViewChange?.(view);
    // `onViewChange` خارج الاعتماديات عمدًا: الشاشة تُمرّره دالّةً جديدة مع كل
    // رسم، فإدراجه يجعل الأثر يعمل بلا انقطاع.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const [groupBy, setGroupBy] = useState<GroupBy>("doctor");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  /** الأطباء المختارون — فارغة = كل الأطباء، وواحد = طبيب محدد، وأكثر = عدّة أطباء. */
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([]);
  const doctorFilter = selectedDoctors.length === 1 ? selectedDoctors[0] : "all";
  const [settings, setSettingsState] = useState<ScheduleSettings>(() => loadSettings());
  const setSettings = (patch: Partial<ScheduleSettings>) =>
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [clinicFilter, setClinicFilter] = useState<string>("all");
  const [dragged, setDragged] = useState<CalendarAppointment | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    appointment: CalendarAppointment;
    start: Date;
    doctorId: string;
    clinicId: string | null;
  } | null>(null);

  useEffect(() => {
    setAnchor(startOfDay(new Date(`${selectedDay}T00:00:00`)));
  }, [selectedDay]);

  /** كلّ تنقّلٍ داخل التقويم يمرّ من هنا فيبلغ الشاشة. */
  const goTo = (date: Date) => {
    const next = startOfDay(date);
    setAnchor(next);
    onDayChange?.(toDateKey(next));
  };

  const range = useMemo(() => {
    if (view === "week" || view === "workweek") return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 7) };
    if (view === "month") {
      const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
      return { from, to };
    }
    return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) };
  }, [anchor, view]);

  /**
   * التقويم يجلب مواعيده باستعلامٍ خاصّ به، فلا يكفي حصرُ استعلام الشاشة:
   * كان الطبيب يرى يوم العيادة كاملًا في التقويم ويومَه هو في القائمة —
   * رقمان متناقضان على شاشةٍ واحدة.
   */
  const { doctorId: scopeDoctorId, isDoctorScope } = useSessionDoctor();
  const scopedDoctorId = isDoctorScope ? scopeDoctorId : null;

  const appointments = useQuery({
    queryKey: [
      "calendar-appointments",
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
      scopedDoctorId ?? "",
    ],
    enabled: Boolean(organizationId),
    // «معالج التحديث التلقائي» في Kizen: ما يحجزه زميلٌ على جهازٍ آخر يظهر هنا بلا ضغط
    refetchInterval: settings.autoRefresh ? settings.refreshSeconds * 1000 : false,
    queryFn: async () => {
      let query = supabase
        .from("appointments")
        .select(
          "id, scheduled_start, scheduled_end, status, priority, queue_number, doctor_id, clinic_id, note, " +
            "is_waiting, waiting_all_day, accepts_earlier, label_value_id, " +
            "patient:patients!appointments_patient_tenant_fk(id, name_ar, file_number, mobile_number, insurance_company_name), " +
            "doctor:doctors!appointments_doctor_tenant_fk(id, name_ar), " +
            "clinic:clinics!appointments_clinic_tenant_fk(id, name), " +
            "visit_type:lookup_values!appointments_visit_type_value_id_fkey(name_ar)",
        )
        .eq("organization_id", organizationId);
      if (scopedDoctorId) query = query.eq("doctor_id", scopedDoctorId);
      const { data, error } = await query
        .gte("scheduled_start", range.from.toISOString())
        .lt("scheduled_start", range.to.toISOString())
        .order("scheduled_start");
      if (error) throw error;
      return (data ?? []) as unknown as CalendarAppointment[];
    },
  });

  /**
   * فترات الدوام والمنع — تُرسَم خلف الشبكة.
   *
   * الفترات التي تُقاطع المدى لا التي تبدأ داخله: دوام يبدأ أمس وينتهي اليوم
   * ظهرًا كان سيسقط من الاستعلام فتظهر الفترة قابلة للحجز وهي ليست كذلك.
   */
  const windows = useQuery({
    queryKey: ["calendar-hours", organizationId, range.from.toISOString(), range.to.toISOString()],
    enabled: Boolean(organizationId) && view !== "month" && view !== "list",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctor_working_hours")
        .select("doctor_id, starts_at, ends_at, is_blocked, note")
        .lt("starts_at", range.to.toISOString())
        .gt("ends_at", range.from.toISOString());
      if (error) throw error;
      return (data ?? []) as WorkingWindow[];
    },
  });

  /**
   * توفّر كلّ الأطباء في اليوم المعروض — نداءٌ واحد بقاعدة الحجز نفسها (0192):
   * الدوام الأسبوعيّ والاستثنائيّ، ومن لا يعمل اليوم، والإجازات والمنع.
   * إن لم تُنفَّذ الترقية بعد يُعاد الرسم القديم من `doctor_working_hours` وحده.
   */
  /**
   * حدود الشبكة من جداول العمل الأسبوعية النشطة لكلّ الأطباء — لا من اليوم
   * المعروض وحده. كانت الشبكة 8–20 وتتّسع فقط بدوام اليوم المعروض في عرض اليوم،
   * فطبيبٌ دوامه حتى العاشرة مساءً لا تظهر له خانات بعد التاسعة في عرض الأسبوع
   * أو في يومٍ لا يعمل فيه غيره (شكوى المالك 05/10/2026).
   */
  const scheduleBounds = useQuery({
    queryKey: ["calendar-schedule-bounds", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const today = toDateKey(new Date());
      const { data, error } = await supabase
        .from("doctor_schedules")
        .select("start_time, end_time, effective_to")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;
      let start: number | null = null;
      let end: number | null = null;
      for (const row of (data ?? []) as { start_time: string; end_time: string; effective_to: string | null }[]) {
        if (row.effective_to && row.effective_to < today) continue;
        const [sh, sm] = row.start_time.split(":").map(Number);
        const [eh, em] = row.end_time.split(":").map(Number);
        const s = sh + (sm || 0) / 60;
        const e = eh + (em || 0) / 60;
        start = start === null ? s : Math.min(start, s);
        end = end === null ? e : Math.max(end, e);
      }
      return start === null || end === null ? null : { start, end };
    },
  });

  const dayKey = toDateKey(anchor);
  const availability = useQuery({
    queryKey: ["calendar-availability", organizationId, dayKey],
    enabled: Boolean(organizationId) && view === "day",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_doctors_day_availability", {
        p_organization_id: organizationId,
        p_date: dayKey,
      });
      if (error) throw error;
      return (data ?? []) as DayAvailability[];
    },
  });

  const visible = useMemo(() => {
    const needle = (search ?? "").trim();
    return (appointments.data ?? []).filter(
      (row) =>
        (selectedDoctors.length === 0 || selectedDoctors.includes(row.doctor_id)) &&
        (clinicFilter === "all" || row.clinic_id === clinicFilter) &&
        (!statusFilter ||
          statusFilter === "all" ||
          (Array.isArray(statusFilter)
            ? statusFilter.length === 0 || statusFilter.includes(row.status)
            : row.status === statusFilter)) &&
        (!needle ||
          Boolean(row.patient?.name_ar?.includes(needle)) ||
          String(row.patient?.file_number ?? "").includes(needle) ||
          Boolean(row.patient?.mobile_number?.includes(needle))),
    );
  }, [appointments.data, selectedDoctors.join(","), clinicFilter, search, Array.isArray(statusFilter) ? statusFilter.join(",") : statusFilter]);

  /**
   * «طباعة الجدول الحديث» (Kizen): المعروض بمرشّحاته — مجمَّعًا بالطبيب،
   * مرتّبًا بالوقت، ومواعيد الانتظار معلَّمة.
   */
  const printSchedule = () => {
    const esc = (value: unknown) =>
      String(value ?? "—").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const date = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
    const groups = new Map<string, CalendarAppointment[]>();
    [...visible]
      .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())
      .forEach((row) => {
        const list = groups.get(row.doctor_id) ?? [];
        list.push(row);
        groups.set(row.doctor_id, list);
      });
    const body = [...groups.entries()]
      .map(([doctorId, rows]) => {
        const name = doctors.find((doctor) => doctor.id === doctorId)?.name_ar ?? rows[0]?.doctor?.name_ar ?? "—";
        return `<h3 style="margin:10px 0 4px">د. ${esc(name)} — ${rows.length}</h3>
          <table><thead><tr><th>التاريخ</th><th>الوقت</th><th>النهاية</th><th>الملف</th><th>المريض</th><th>الجوال</th>
          <th>العيادة</th><th>الزيارة</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>
          ${rows
            .map(
              (row) => `<tr><td>${esc(date(row.scheduled_start))}</td>
                <td>${row.is_waiting ? (row.waiting_all_day ? "انتظار — طوال اليوم" : `انتظار من ${esc(time(row.scheduled_start))}`) : esc(time(row.scheduled_start))}</td>
                <td>${row.is_waiting ? "—" : esc(time(row.scheduled_end))}</td>
                <td>${esc(row.patient?.file_number)}</td><td>${esc(row.patient?.name_ar)}</td><td>${esc(row.patient?.mobile_number)}</td>
                <td>${esc(row.clinic?.name)}</td><td>${esc(row.visit_type?.name_ar)}</td>
                <td>${esc(APPOINTMENT_STATUS_LABELS[row.status as keyof typeof APPOINTMENT_STATUS_LABELS] ?? row.status)}</td>
                <td>${esc(row.note)}</td></tr>`,
            )
            .join("")}
          </tbody></table>`;
      })
      .join("");
    printHtml(
      "جدول المواعيد",
      `<h2 style="margin:0 0 4px">جدول المواعيد — ${esc(headerLabel)}</h2>
       <p style="margin:0 0 6px;font-size:11px;color:#555">العدد ${visible.length}</p>${body}`,
      "a4",
    );
  };

  /** موعد الانتظار خارج الشبكة — يُعرض في شريط الانتظار أعلى كلّ عمود. */
  const gridRows = useMemo(() => visible.filter((row) => !row.is_waiting), [visible]);
  const waitingRows = useMemo(() => visible.filter((row) => row.is_waiting), [visible]);

  const frame = useMemo<DayFrame>(() => {
    let startHour = 8;
    let endHour = 20;
    const dayStart = startOfDay(anchor).getTime();
    const hourOf = (iso: string) => (new Date(iso).getTime() - dayStart) / 3_600_000;
    if (scheduleBounds.data) {
      startHour = Math.min(startHour, Math.floor(scheduleBounds.data.start));
      endHour = Math.max(endHour, Math.ceil(scheduleBounds.data.end));
    }
    for (const row of availability.data ?? []) {
      if (row.kind !== "work") continue;
      startHour = Math.min(startHour, Math.floor(hourOf(row.starts_at)));
      endHour = Math.max(endHour, Math.ceil(hourOf(row.ends_at)));
    }
    // ساعة اليوم لكلّ موعد (لا بُعده عن يوم المرساة): في عرض الأسبوع مواعيد
    // الأيّام التالية كانت ستُحسب 24+ ساعة فتمتدّ الشبكة إلى آخر حدّها.
    for (const row of gridRows) {
      const s = new Date(row.scheduled_start);
      const startOfRow = s.getHours() + s.getMinutes() / 60;
      const durationHours = (new Date(row.scheduled_end).getTime() - s.getTime()) / 3_600_000;
      startHour = Math.min(startHour, Math.floor(startOfRow));
      endHour = Math.max(endHour, Math.ceil(startOfRow + Math.max(durationHours, 0.25)));
    }
    // المقياس: خانة 15 أو 30 أو 60 دقيقة، والتكبير يضاعف ارتفاع الدقيقة
    const basePx = settings.slotMinutes === 60 ? 0.9 : settings.slotMinutes === 30 ? 1.1 : 1.4;
    return {
      startHour: Math.max(0, startHour),
      endHour: Math.min(26, Math.max(endHour, startHour + 1)),
      slotMinutes: settings.slotMinutes,
      px: basePx * settings.zoom,
    };
  }, [anchor, availability.data, scheduleBounds.data, gridRows, settings.slotMinutes, settings.zoom]);

  const columns = useMemo(() => {
    if (view !== "day") return [];
    if (groupBy === "clinic") {
      const list = clinicFilter === "all" ? clinics : clinics.filter((c) => c.id === clinicFilter);
      return [...list.map((c) => ({ id: c.id, name: c.name })), { id: "__none__", name: "بلا عيادة" }];
    }
    const list = selectedDoctors.length === 0 ? doctors : doctors.filter((d) => selectedDoctors.includes(d.id));
    return list.map((d) => ({ id: d.id, name: d.name_ar }));
  }, [view, groupBy, doctors, clinics, selectedDoctors.join(","), clinicFilter]);

  /**
   * «أقرب موعد» في Kizen: يقفز إلى أقرب يومٍ قادم فيه مواعيد (بعد اليوم
   * المعروض)، لا إلى أقرب خانةٍ فارغة. بمرشّح الأطباء المختار.
   */
  const nearestDay = useMutation({
    mutationFn: async () => {
      if (!organizationId) return null;
      let query = supabase
        .from("appointments")
        .select("scheduled_start")
        .eq("organization_id", organizationId)
        .gte("scheduled_start", addDays(startOfDay(anchor), 1).toISOString())
        .not("status", "in", "(cancelled_by_patient,cancelled_by_staff,no_show)")
        .order("scheduled_start")
        .limit(1);
      if (scopedDoctorId) query = query.eq("doctor_id", scopedDoctorId);
      else if (selectedDoctors.length > 0) query = query.in("doctor_id", selectedDoctors);
      const { data, error } = await query;
      if (error) throw error;
      return (data?.[0]?.scheduled_start as string | undefined) ?? null;
    },
    onSuccess: (found) => {
      if (!found) {
        toast({ title: "لا مواعيد قادمة بعد هذا اليوم" });
        return;
      }
      goTo(new Date(found));
      if (view === "month" || view === "list") setView("day");
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر البحث", description: errorMessage(error) }),
  });

  const shift = (direction: -1 | 1) => {
    if (view === "month") {
      goTo(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    } else if (view === "week" || view === "workweek") {
      goTo(addDays(anchor, 7 * direction));
    } else {
      goTo(addDays(anchor, direction));
    }
  };

  const headerLabel = useMemo(() => {
    if (view === "month") return anchor.toLocaleDateString("ar-SA-u-nu-latn", { month: "long", year: "numeric" });
    if (view === "week" || view === "workweek") {
      const from = startOfWeek(anchor);
      return `${from.toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric", month: "short" })} — ${addDays(from, view === "workweek" ? 5 : 6).toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric", month: "short" })}`;
    }
    return anchor.toLocaleDateString("ar-SA-u-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }, [anchor, view]);

  const filterActive =
    Boolean((search ?? "").trim()) ||
    (Array.isArray(statusFilter) ? statusFilter.length > 0 : Boolean(statusFilter) && statusFilter !== "all");

  return (
    <div className="flex flex-col gap-3">
      {/* شريط التقويم: التنقّل والتاريخ يمينًا، ونمط العرض يسارًا، والمرشّحات والأدوات في سطرٍ ثانٍ */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border bg-background">
              <button
                type="button"
                onClick={() => shift(-1)}
                title="السابق"
                className="flex h-9 w-9 items-center justify-center hover:bg-muted"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => goTo(new Date())}
                className="h-9 border-x px-3 text-sm font-medium hover:bg-muted"
              >
                اليوم
              </button>
              <button
                type="button"
                onClick={() => shift(1)}
                title="التالي"
                className="flex h-9 w-9 items-center justify-center hover:bg-muted"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-base font-bold hover:bg-muted"
                  title="اختر أيّ يوم من التقويم"
                >
                  <CalendarDays className="h-5 w-5 text-primary" />
                  {headerLabel}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="start">
                <MiniMonth
                  selected={anchor}
                  onSelect={(date) => {
                    goTo(date);
                    if (view === "month" || view === "list") setView("day");
                  }}
                />
              </PopoverContent>
            </Popover>
            <Badge variant="secondary" className="font-mono tabular-nums">
              {visible.length} موعد
            </Badge>
            {/* تقويم فارغ بسبب التصفية يبدو كتقويم بلا مواعيد: الشارة تفرّق بين الحالتين */}
            {filterActive && <Badge variant="outline">تصفية نشطة</Badge>}
          </div>

          <div className="flex rounded-lg bg-muted p-1" role="tablist" aria-label="نمط العرض">
            {(Object.keys(VIEW_LABELS) as CalendarView[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  view === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {VIEW_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 w-48 justify-between">
                <span className="flex items-center gap-1.5 truncate">
                  <Users className="h-3.5 w-3.5" />
                  {selectedDoctors.length === 0
                    ? "كل الأطباء"
                    : selectedDoctors.length === 1
                      ? doctors.find((d) => d.id === selectedDoctors[0])?.name_ar ?? "طبيب"
                      : `${selectedDoctors.length} أطباء`}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              <div className="flex items-center justify-between gap-2 border-b pb-1.5">
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelectedDoctors([])}
                >
                  كل الأطباء
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["doctors-enabled"] })}
                  title="إعادة قراءة قائمة الأطباء"
                >
                  <RefreshCw className="h-3 w-3" />
                  تحديث الأطباء
                </button>
              </div>
              <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto pt-1.5">
                {doctors.map((doctor) => {
                  const checked = selectedDoctors.includes(doctor.id);
                  return (
                    <div key={doctor.id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted">
                      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedDoctors((prev) =>
                              checked ? prev.filter((id) => id !== doctor.id) : [...prev, doctor.id],
                            )
                          }
                        />
                        {doctor.name_ar}
                      </label>
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-primary"
                        onClick={() => setSelectedDoctors([doctor.id])}
                        title="هذا الطبيب وحده"
                      >
                        وحده
                      </button>
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <Select value={clinicFilter} onValueChange={setClinicFilter}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue placeholder="كل العيادات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل العيادات</SelectItem>
              {clinics.map((clinic) => (
                <SelectItem key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {view === "day" && (
            <Select value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="doctor">أعمدة حسب الطبيب</SelectItem>
                <SelectItem value="clinic">أعمدة حسب العيادة</SelectItem>
              </SelectContent>
            </Select>
          )}

          <div className="ms-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              disabled={nearestDay.isPending}
              onClick={() => nearestDay.mutate()}
              title="أقرب يوم قادم فيه مواعيد"
            >
              <CalendarClock className="h-4 w-4" />
              أقرب يوم فيه مواعيد
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="تحديث"
              onClick={() => {
                void appointments.refetch();
                void availability.refetch();
              }}
            >
              <RefreshCw className={`h-4 w-4 ${appointments.isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="طباعة الجدول المعروض (بمرشّحاته)"
              disabled={visible.length === 0}
              onClick={printSchedule}
            >
              <Printer className="h-4 w-4" />
            </Button>
            <ScheduleSettingsPopover settings={settings} onChange={setSettings} />
          </div>
        </div>

        {(view === "day" || view === "week" || view === "workweek") && <CalendarLegend />}
      </div>

      {appointments.isLoading && <Skeleton className="h-96 w-full" />}

      {!appointments.isLoading && view === "day" && (
        <DayGrid
          date={anchor}
          columns={columns}
          groupBy={groupBy}
          appointments={gridRows}
          waiting={settings.showWaiting ? waitingRows : []}
          showDetails={settings.showDetails}
          onBlockAction={onBlockAction}
          labels={labels}
          windows={windows.data ?? []}
          availability={availability.isSuccess ? availability.data : null}
          frame={frame}
          highlightId={highlightId ?? null}
          canReschedule={can("appointments.reschedule")}
          canCreate={can("appointments.create")}
          dragged={dragged}
          setDragged={setDragged}
          onCreateAt={onCreateAt}
          onOpenAppointment={onOpenAppointment}
          onDropAt={(appointment, start, columnId) =>
            setPendingMove({
              appointment,
              start,
              doctorId: groupBy === "doctor" ? columnId : appointment.doctor_id,
              clinicId: groupBy === "clinic" ? (columnId === "__none__" ? null : columnId) : appointment.clinic_id,
            })
          }
        />
      )}

      {!appointments.isLoading && (view === "week" || view === "workweek") && (
        <WeekGrid
          anchor={anchor}
          dayCount={view === "workweek" ? 6 : 7}
          appointments={gridRows}
          waiting={settings.showWaiting ? waitingRows : []}
          frame={frame}
          onSelectDay={(date) => {
            goTo(date);
            setView("day");
          }}
          onBlockAction={onBlockAction}
          canReschedule={can("appointments.reschedule")}
          dragged={dragged}
          setDragged={setDragged}
          onOpenAppointment={onOpenAppointment}
          onDropAt={(appointment, start) =>
            setPendingMove({
              appointment,
              start,
              doctorId: appointment.doctor_id,
              clinicId: appointment.clinic_id,
            })
          }
        />
      )}

      {!appointments.isLoading && view === "month" && (
        <MonthGrid anchor={anchor} appointments={visible} onSelectDay={(date) => { goTo(date); setView("day"); }} />
      )}

      {!appointments.isLoading && view === "list" && (
        <ListView appointments={visible} onOpenAppointment={onOpenAppointment} />
      )}

      <RescheduleDialog
        pending={pendingMove}
        onClose={() => setPendingMove(null)}
        onDone={() => setPendingMove(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------- مفتاح الألوان */

/** ما تعنيه خلفيات الشبكة وعلاماتها — يقرأه الموظف مرّة فيفهم التقويم كلّه. */
function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm border border-emerald-200 bg-emerald-50" />
        دوام الطبيب — متاح للحجز
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm border bg-slate-100 bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,rgba(100,116,139,0.35)_3px,rgba(100,116,139,0.35)_4px)]" />
        خارج الدوام / لا يعمل
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-sm border border-rose-200 bg-rose-50 bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,rgba(225,29,72,0.35)_3px,rgba(225,29,72,0.35)_4px)]" />
        إجازة أو منع
      </span>
      <span className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        غير مؤكَّد
      </span>
      <span className="flex items-center gap-1.5">
        <ArrowUpCircle className="h-3.5 w-3.5 text-primary" />
        يقبل موعدًا أبكر
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-5 bg-red-500" />
        الوقت الآن
      </span>
      <span className="hidden items-center gap-1.5 sm:flex">اضغط خانةً فارغة للحجز · اسحب الموعد لنقله · الزرّ الأيمن للأوامر</span>
    </div>
  );
}

/** ساعات دوام العمود من توفّر اليوم: «10:00–22:00» أو null. */
function workRangeLabel(rows: DayAvailability[] | null) {
  const work = (rows ?? []).filter((row) => row.kind === "work");
  if (work.length === 0) return null;
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const start = work.reduce((min, row) => (row.starts_at < min ? row.starts_at : min), work[0].starts_at);
  const end = work.reduce((max, row) => (row.ends_at > max ? row.ends_at : max), work[0].ends_at);
  return `${fmt(start)}–${fmt(end)}`;
}

/* ------------------------------------------------------------------ اليوم */

function DayGrid({
  date,
  columns,
  groupBy,
  appointments,
  waiting,
  showDetails,
  onBlockAction,
  labels,
  windows,
  availability,
  frame,
  highlightId,
  canReschedule,
  canCreate,
  dragged,
  setDragged,
  onCreateAt,
  onOpenAppointment,
  onDropAt,
}: {
  date: Date;
  columns: { id: string; name: string }[];
  groupBy: GroupBy;
  appointments: CalendarAppointment[];
  /** مواعيد الانتظار (W.P) لليوم — فارغة إن أُخفي «عرض مرضى الانتظار». */
  waiting: CalendarAppointment[];
  showDetails: boolean;
  onBlockAction?: (appointmentId: string, action: BlockAction) => void;
  labels?: Map<string, string>;
  windows: WorkingWindow[];
  /** `null` = لم يُقرأ التوفّر (الترقية لم تُنفَّذ) ⇒ الرسم القديم من `windows`. */
  availability: DayAvailability[] | null;
  frame: DayFrame;
  highlightId: string | null;
  canReschedule: boolean;
  canCreate: boolean;
  dragged: CalendarAppointment | null;
  setDragged: (value: CalendarAppointment | null) => void;
  onCreateAt: (start: Date, doctorId: string | null, clinicId: string | null) => void;
  onOpenAppointment: (id: string) => void;
  onDropAt: (appointment: CalendarAppointment, start: Date, columnId: string) => void;
}) {
  const totalMinutes = (frame.endHour - frame.startHour) * 60;
  const slotHeight = frame.slotMinutes * frame.px;

  const slots = useMemo(() => {
    const list: Date[] = [];
    for (let minute = 0; minute < totalMinutes; minute += frame.slotMinutes) {
      const slot = new Date(date);
      slot.setHours(frame.startHour, minute, 0, 0);
      list.push(slot);
    }
    return list;
  }, [date, frame.startHour, frame.slotMinutes, totalMinutes]);

  const nowOffset = useNowOffset(date, frame.startHour, totalMinutes);

  const columnKey = (row: CalendarAppointment) =>
    groupBy === "doctor" ? row.doctor_id : (row.clinic_id ?? "__none__");
  const waitingByColumn = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>();
    waiting.forEach((row) => {
      const key = columnKey(row);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, groupBy]);
  const maxWaiting = Math.max(0, ...columns.map((c) => waitingByColumn.get(c.id)?.length ?? 0));
  /** شريط الانتظار بارتفاعٍ واحد في كلّ الأعمدة فتبقى الساعات محاذية. */
  const waitingStripHeight = maxWaiting === 0 ? 0 : Math.min(132, 26 + maxWaiting * 22);

  if (columns.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">لا توجد أعمدة للعرض.</p>;
  }

  return (
    <div className="max-h-[72vh] overflow-auto rounded-xl border bg-card shadow-sm">
      <div className="flex min-w-[36rem]">
        {/* عمود الساعات — الساعة كاملةً بخطٍّ واضح، والأرباع باهتة */}
        <div className="sticky right-0 z-30 w-[4.5rem] shrink-0 border-s bg-card">
          <div className="sticky top-0 z-30 flex h-14 items-end justify-center border-b bg-card pb-1 text-[10px] text-muted-foreground">
            الوقت
          </div>
          {waitingStripHeight > 0 && (
            <div
              className="flex items-center justify-center border-b bg-amber-50 text-[10px] font-medium text-amber-800 dark:bg-amber-950/30"
              style={{ height: waitingStripHeight }}
            >
              انتظار
            </div>
          )}
          <div className="relative" style={{ height: totalMinutes * frame.px }}>
            {slots.map((slot, index) => {
              const isHour = slot.getMinutes() === 0;
              return (
                <div
                  key={index}
                  className={`absolute right-0 left-0 ${isHour ? "border-t border-border" : ""}`}
                  style={{ top: index * slotHeight, height: slotHeight }}
                >
                  <span
                    className={`block -translate-y-px px-2 text-end ${
                      isHour ? "text-xs font-bold text-foreground" : "text-[9px] text-muted-foreground/70"
                    }`}
                  >
                    {isHour
                      ? slot.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "numeric", minute: "2-digit" })
                      : `:${String(slot.getMinutes()).padStart(2, "0")}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {columns.map((column) => {
          const columnAppointments = appointments.filter((row) => columnKey(row) === column.id);
          const lanes = laneLayout(columnAppointments);
          const columnWaiting = waitingByColumn.get(column.id) ?? [];
          const columnWindows =
            groupBy === "doctor" ? windows.filter((w) => w.doctor_id === column.id) : [];
          const columnAvailability =
            groupBy === "doctor" && availability
              ? availability.filter((row) => row.doctor_id === column.id)
              : null;
          const isOff = Boolean(columnAvailability?.some((row) => row.kind === "off"));
          const hoursLabel = isOff ? null : workRangeLabel(columnAvailability);
          const initial = column.name.replace(/^(د\.?|دكتور|دكتورة|الدكتور|الدكتورة|الأخصائية|الاخصائية)\s*/, "").trim().charAt(0) || "؟";

          return (
            <div key={column.id} className="min-w-[12rem] flex-1 border-s last:border-s-0">
              <div
                className={`sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-2.5 ${
                  isOff ? "bg-muted/80 text-muted-foreground" : "bg-card"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    isOff ? "bg-muted-foreground/15" : "bg-primary/15 text-primary"
                  }`}
                >
                  {initial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight">{column.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {isOff
                      ? "لا يعمل اليوم"
                      : `${columnAppointments.length} موعد${hoursLabel ? ` · الدوام ${hoursLabel}` : ""}`}
                  </p>
                </div>
              </div>
              {waitingStripHeight > 0 && (
                <div
                  className="flex flex-col gap-0.5 overflow-y-auto border-b bg-amber-50/60 p-1 dark:bg-amber-950/20"
                  style={{ height: waitingStripHeight }}
                >
                  {columnWaiting.map((row) => (
                    <BlockMenu key={row.id} appointment={row} onBlockAction={onBlockAction}>
                      <button
                        type="button"
                        onClick={() => onOpenAppointment(row.id)}
                        className="flex w-full items-center gap-1 truncate rounded border border-amber-300 bg-white px-1 py-0.5 text-start text-[10px] text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100"
                        title={row.waiting_all_day ? "ينتظر طوال اليوم" : `ينتظر من ${fmtTime(row.scheduled_start)}`}
                      >
                        <Clock className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {row.patient?.file_number != null ? `F#${row.patient.file_number} - ` : ""}
                          {row.patient?.name_ar ?? "بلا اسم"}
                        </span>
                        {!row.waiting_all_day && <span className="ms-auto shrink-0 opacity-70">{fmtTime(row.scheduled_start)}</span>}
                      </button>
                    </BlockMenu>
                  ))}
                </div>
              )}
              <div className="relative" style={{ height: totalMinutes * frame.px }}>
                {/* خلفية التوفّر: المتاح مُلوَّن، وغير المتاح مخطَّط */}
                {columnAvailability ? (
                  <AvailabilityLayer date={date} frame={frame} rows={columnAvailability} />
                ) : (
                  <UnavailableLayer date={date} windows={columnWindows} frame={frame} />
                )}

                {/* خلايا الإفلات والإنشاء */}
                {slots.map((slot, index) => (
                  <div
                    key={index}
                    className={`group absolute right-0 left-0 ${
                      slot.getMinutes() === 0 ? "border-t border-border" : "border-t border-dashed border-border/40"
                    } ${canCreate ? "cursor-pointer hover:bg-primary/10" : ""}`}
                    style={{ top: index * slotHeight, height: slotHeight }}
                    onDragOver={(event) => {
                      if (dragged && canReschedule) event.preventDefault();
                    }}
                    onDrop={() => {
                      if (dragged && canReschedule) {
                        onDropAt(dragged, slot, column.id);
                        setDragged(null);
                      }
                    }}
                    onClick={() => {
                      if (!canCreate) return;
                      onCreateAt(
                        slot,
                        groupBy === "doctor" ? column.id : null,
                        groupBy === "clinic" ? (column.id === "__none__" ? null : column.id) : null,
                      );
                    }}
                  >
                    {canCreate && (
                      <span className="pointer-events-none hidden px-1.5 text-[10px] font-semibold text-primary group-hover:inline">
                        + حجز {slot.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "numeric", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                ))}

                {/* المواعيد */}
                {columnAppointments.map((row) => (
                  <BlockMenu key={row.id} appointment={row} onBlockAction={onBlockAction}>
                    <EventBlock
                      appointment={row}
                      canDrag={canReschedule}
                      onDragStart={() => setDragged(row)}
                      onDragEnd={() => setDragged(null)}
                      onClick={() => onOpenAppointment(row.id)}
                      frame={frame}
                      day={date}
                      highlighted={row.id === highlightId}
                      lane={lanes.get(row.id)}
                      showDetails={showDetails}
                      labelName={row.label_value_id ? labels?.get(row.label_value_id) : undefined}
                    />
                  </BlockMenu>
                ))}

                {nowOffset !== null && (
                  <div
                    className="pointer-events-none absolute right-0 left-0 z-20 border-t-2 border-red-500"
                    style={{ top: nowOffset * frame.px }}
                  >
                    <span className="absolute -top-[5px] -right-[5px] h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * خلفية التوفّر من قاعدة الحجز نفسها (0192).
 *
 * المتاح (`work`) أخضر فاتح — «هنا يُحجز»، كخانات «Work» في النظام المرجعيّ.
 * وما خارجه، ويوم الراحة (`off`)، والمنع (`blocked`) مخطَّطٌ بعلامته. وطبيبٌ
 * بلا جدولٍ أصلًا لا يُرسم له شيء: اليوم كلّه متاح، كما تحكم القاعدة تمامًا.
 */
function AvailabilityLayer({ date, frame, rows }: { date: Date; frame: DayFrame; rows: DayAvailability[] }) {
  const totalMinutes = (frame.endHour - frame.startHour) * 60;
  const frameStart = new Date(date);
  frameStart.setHours(frame.startHour, 0, 0, 0);
  const clamp = (value: number) => Math.max(0, Math.min(totalMinutes, value));
  const toOffset = (iso: string) => clamp((new Date(iso).getTime() - frameStart.getTime()) / 60000);

  const work = rows
    .filter((row) => row.kind === "work")
    .map((row) => ({ from: toOffset(row.starts_at), to: toOffset(row.ends_at) }))
    .filter((band) => band.to > band.from)
    .sort((a, b) => a.from - b.from);
  const off = rows.find((row) => row.kind === "off");
  const blocked = rows.filter((row) => row.kind === "blocked");

  const hatched: { top: number; height: number; label?: string; tone: "muted" | "rose" }[] = [];
  if (off) {
    hatched.push({ top: 0, height: totalMinutes, label: off.label ?? "لا يعمل", tone: "muted" });
  } else if (work.length > 0) {
    let cursor = 0;
    for (const band of work) {
      if (band.from > cursor) hatched.push({ top: cursor, height: band.from - cursor, tone: "muted" });
      cursor = Math.max(cursor, band.to);
    }
    if (cursor < totalMinutes) hatched.push({ top: cursor, height: totalMinutes - cursor, tone: "muted" });
  }
  for (const row of blocked) {
    const from = toOffset(row.starts_at);
    const to = toOffset(row.ends_at);
    if (to > from) hatched.push({ top: from, height: to - from, label: row.label ?? "غير متاح", tone: "rose" });
  }

  return (
    <>
      {!off &&
        work.map((band, index) => (
          <div
            key={`w${index}`}
            className="pointer-events-none absolute right-0 left-0 bg-emerald-50/70 dark:bg-emerald-950/20"
            style={{ top: band.from * frame.px, height: (band.to - band.from) * frame.px }}
          />
        ))}
      {hatched.map((band, index) => (
        <div
          key={`h${index}`}
          className={`pointer-events-none absolute right-0 left-0 ${
            band.tone === "rose"
              ? "bg-rose-50/70 bg-[repeating-linear-gradient(135deg,transparent,transparent_7px,rgba(225,29,72,0.16)_7px,rgba(225,29,72,0.16)_8px)] dark:bg-rose-950/20"
              : "bg-slate-50 bg-[repeating-linear-gradient(135deg,transparent,transparent_7px,rgba(100,116,139,0.10)_7px,rgba(100,116,139,0.10)_8px)] dark:bg-slate-900/40"
          }`}
          style={{ top: band.top * frame.px, height: band.height * frame.px }}
        >
          {band.label && band.height > 30 && (
            <span
              className={`sticky top-16 m-1 inline-block rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium ${
                band.tone === "rose" ? "text-rose-700" : "text-muted-foreground"
              }`}
            >
              {band.label}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

/** مؤشر الوقت الحالي — يُعاد حسابه كل دقيقة، و`null` إن كان اليوم غير المعروض. */
function useNowOffset(date: Date, startHour: number = DAY_START_HOUR, totalMinutes: number = TOTAL_MINUTES) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!sameDay(now, date)) return null;
  const minutes = (now.getHours() - startHour) * 60 + now.getMinutes();
  if (minutes < 0 || minutes > totalMinutes) return null;
  return minutes;
}

/**
 * المساحة غير القابلة للحجز.
 *
 * القاعدة نفسها المفروضة في `app_check_doctor_availability` (0064): إن سُجّلت
 * فترات عمل فما خارجها ممنوع، وإن لم تُسجَّل فاليوم كله متاح. لو اختلفت
 * الشاشة عن القاعدة هنا لظهر الوقت أبيض ثم رُفض الحجز — وهو أسوأ من تظليله.
 */
function UnavailableLayer({
  date,
  windows,
  frame = DEFAULT_FRAME,
}: {
  date: Date;
  windows: WorkingWindow[];
  frame?: DayFrame;
}) {
  const TOTAL_MINUTES = (frame.endHour - frame.startHour) * 60;
  const PX_PER_MINUTE = frame.px;
  const dayStart = new Date(date);
  dayStart.setHours(frame.startHour, 0, 0, 0);

  const work = windows.filter((w) => !w.is_blocked);
  const blocked = windows.filter((w) => w.is_blocked);

  const clamp = (value: number) => Math.max(0, Math.min(TOTAL_MINUTES, value));
  const toOffset = (iso: string) => clamp((new Date(iso).getTime() - dayStart.getTime()) / 60000);

  const bands: { top: number; height: number; label?: string }[] = [];

  if (work.length > 0) {
    const sorted = work
      .map((w) => ({ from: toOffset(w.starts_at), to: toOffset(w.ends_at) }))
      .filter((w) => w.to > w.from)
      .sort((a, b) => a.from - b.from);
    let cursor = 0;
    for (const window of sorted) {
      if (window.from > cursor) bands.push({ top: cursor, height: window.from - cursor });
      cursor = Math.max(cursor, window.to);
    }
    if (cursor < TOTAL_MINUTES) bands.push({ top: cursor, height: TOTAL_MINUTES - cursor });
  }

  for (const window of blocked) {
    const from = toOffset(window.starts_at);
    const to = toOffset(window.ends_at);
    if (to > from) bands.push({ top: from, height: to - from, label: window.note ?? "غير متاح" });
  }

  return (
    <>
      {bands.map((band, index) => (
        <div
          key={index}
          className="pointer-events-none absolute right-0 left-0 bg-slate-50 bg-[repeating-linear-gradient(135deg,transparent,transparent_7px,rgba(100,116,139,0.10)_7px,rgba(100,116,139,0.10)_8px)] dark:bg-slate-900/40"
          style={{ top: band.top * PX_PER_MINUTE, height: band.height * PX_PER_MINUTE }}
        >
          {band.label && band.height > 40 && (
            <span className="px-1 text-[9px] text-muted-foreground">{band.label}</span>
          )}
        </div>
      ))}
    </>
  );
}

type EventBlockProps = {
  appointment: CalendarAppointment;
  canDrag: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  frame?: DayFrame;
  day?: Date;
  highlighted?: boolean;
  /** مسار الموعد بين المتزامنين معه في العمود (laneLayout). */
  lane?: { lane: number; lanes: number };
  showDetails?: boolean;
  labelName?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "onClick" | "onDragStart" | "onDragEnd">;

/** يقبل مرجعًا لأنّ قائمة الزرّ الأيمن تلفّه (Radix `asChild`). */
const EventBlock = forwardRef<HTMLDivElement, EventBlockProps>(function EventBlock({
  appointment,
  canDrag,
  onDragStart,
  onDragEnd,
  onClick,
  frame = DEFAULT_FRAME,
  day,
  highlighted = false,
  lane,
  showDetails = true,
  labelName,
  ...rest
}, ref) {
  const TOTAL_MINUTES = (frame.endHour - frame.startHour) * 60;
  const PX_PER_MINUTE = frame.px;
  const top = minutesFromDayStart(appointment.scheduled_start, frame.startHour, day);
  const duration = Math.max(
    15,
    (new Date(appointment.scheduled_end).getTime() - new Date(appointment.scheduled_start).getTime()) / 60000,
  );
  const style = STATUS_STYLES[appointment.status] ?? STATUS_STYLES.scheduled;
  const priority = PRIORITY_MARKS[appointment.priority];

  if (top + duration < 0 || top > TOTAL_MINUTES) return null;

  // مواعيدٌ متزامنة تنقسم عرض العمود بالتساوي بدل أن يغطّي بعضها بعضًا
  const lanes = lane?.lanes ?? 1;
  const width = 100 / lanes;
  const unconfirmed = isUnconfirmed(appointment.status);
  const fileTag = appointment.patient?.file_number != null ? `F#${appointment.patient.file_number} - ` : "";

  return (
    <div
      {...rest}
      ref={ref}
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`absolute z-10 cursor-pointer overflow-hidden rounded-md border border-s-4 px-1.5 py-0.5 text-[11px] leading-tight shadow-sm transition hover:z-20 hover:shadow-md ${style.className} ${
        highlighted ? "animate-pulse ring-2 ring-primary ring-offset-1" : ""
      }`}
      style={{
        top: Math.max(0, top) * PX_PER_MINUTE,
        height: duration * PX_PER_MINUTE - 2,
        right: `calc(${(lane?.lane ?? 0) * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      title={`${appointment.patient?.name_ar ?? ""}${fileTag ? ` — ملف ${appointment.patient?.file_number}` : ""} — ${fmtTime(appointment.scheduled_start)}–${fmtTime(appointment.scheduled_end)} — ${style.label}${unconfirmed ? " — غير مؤكَّد" : ""}`}
    >
      {/* السطر الأوّل: الوقت والعلامات — والموعد القصير يحمل الاسم في السطر نفسه */}
      <div className="flex items-center gap-1">
        {unconfirmed && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" aria-label="غير مؤكَّد" />}
        {appointment.accepts_earlier && (
          <ArrowUpCircle className="h-3 w-3 shrink-0 text-primary" aria-label="يقبل موعدًا أبكر" />
        )}
        {priority && (
          <span className={`rounded px-1 text-[9px] ${priority.className}`}>{priority.label}</span>
        )}
        <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums opacity-80">
          {fmtTime(appointment.scheduled_start)}
        </span>
        {duration < 30 && (
          <span className="truncate font-semibold">{appointment.patient?.name_ar ?? "بلا اسم"}</span>
        )}
        {duration >= 30 && (
          <span className="ms-auto shrink-0 rounded bg-white/60 px-1 text-[9px] font-medium dark:bg-black/20">
            {style.label}
          </span>
        )}
      </div>
      {duration >= 30 && (
        <div className="truncate text-[12px] font-bold">{appointment.patient?.name_ar ?? "بلا اسم"}</div>
      )}
      {labelName && <div className="truncate text-[9px] font-semibold opacity-90">{labelName}</div>}
      {showDetails && duration >= 30 && (
        <div className="truncate text-[10px] opacity-80">
          {appointment.patient?.file_number != null ? `ملف ${appointment.patient.file_number} · ` : ""}
          {Math.round(duration)} د
          {appointment.visit_type?.name_ar ? ` · ${appointment.visit_type.name_ar}` : ""}
        </div>
      )}
      {showDetails && duration >= 45 && (
        <div className="flex items-center gap-1 truncate text-[10px] opacity-80">
          <span dir="ltr">{appointment.patient?.mobile_number ?? ""}</span>
          {appointment.patient?.insurance_company_name && (
            <span className="rounded bg-white/60 px-1">تأمين</span>
          )}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ الأسبوع */

function WeekGrid({
  anchor,
  dayCount = 7,
  appointments,
  waiting = [],
  onSelectDay,
  onBlockAction,
  canReschedule,
  dragged,
  setDragged,
  onOpenAppointment,
  onDropAt,
  frame,
}: {
  /** حدود الساعات نفسها التي في عرض اليوم (جداول العمل والمواعيد). */
  frame: DayFrame;
  anchor: Date;
  /** 7 = الأسبوع كاملًا، 6 = أسبوع العمل (السبت إلى الخميس). */
  dayCount?: number;
  appointments: CalendarAppointment[];
  waiting?: CalendarAppointment[];
  onSelectDay?: (date: Date) => void;
  onBlockAction?: (appointmentId: string, action: BlockAction) => void;
  canReschedule: boolean;
  dragged: CalendarAppointment | null;
  setDragged: (value: CalendarAppointment | null) => void;
  onOpenAppointment: (id: string) => void;
  onDropAt: (appointment: CalendarAppointment, start: Date) => void;
}) {
  const from = startOfWeek(anchor);
  const days = Array.from({ length: dayCount }, (_, index) => addDays(from, index));
  const startHour = frame.startHour;
  const TOTAL_MINUTES = (frame.endHour - frame.startHour) * 60;
  const weekFrame: DayFrame = { startHour, endHour: frame.endHour, slotMinutes: SLOT_MINUTES, px: PX_PER_MINUTE };
  const slots = Array.from({ length: TOTAL_MINUTES / SLOT_MINUTES }, (_, index) => index * SLOT_MINUTES);

  return (
    <div className="max-h-[72vh] overflow-auto rounded-xl border bg-card shadow-sm">
      <div className="flex min-w-[48rem]">
        <div className="sticky right-0 z-20 w-16 shrink-0 border-s bg-card">
          <div className="sticky top-0 z-20 h-14 border-b bg-card" />
          <div className="relative" style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}>
            {slots.map((minute) => (
              <div
                key={minute}
                className={`absolute right-0 left-0 px-1.5 text-end ${minute % 60 === 0 ? "border-t border-border text-xs font-bold" : "text-[9px] text-muted-foreground/70"}`}
                style={{ top: minute * PX_PER_MINUTE, height: SLOT_MINUTES * PX_PER_MINUTE }}
              >
                {minute % 60 === 0
                  ? `${String((startHour + Math.floor(minute / 60)) % 24).padStart(2, "0")}:00`
                  : `:${String(minute % 60).padStart(2, "0")}`}
              </div>
            ))}
          </div>
        </div>
        {days.map((day) => {
          const dayAppointments = appointments.filter((row) => sameDay(new Date(row.scheduled_start), day));
          const dayWaiting = waiting.filter((row) => sameDay(new Date(row.scheduled_start), day)).length;
          const lanes = laneLayout(dayAppointments);
          const isToday = sameDay(day, new Date());
          return (
            <div key={day.toISOString()} className="min-w-[8rem] flex-1 border-s last:border-s-0">
              <button
                type="button"
                onClick={() => onSelectDay?.(startOfDay(day))}
                title="افتح هذا اليوم"
                className={`sticky top-0 z-10 flex h-14 w-full flex-col items-center justify-center gap-0.5 border-b bg-card text-xs hover:bg-primary/10 ${isToday ? "text-primary" : ""}`}
              >
                <span className="text-[11px] text-muted-foreground">{day.toLocaleDateString("ar-SA-u-nu-latn", { weekday: "long" })}</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-1 text-sm font-bold ${
                      isToday ? "bg-primary text-primary-foreground" : ""
                    }`}
                  >
                    {day.toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric" })}
                  </span>
                  {dayAppointments.length > 0 && (
                    <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{dayAppointments.length}</span>
                  )}
                  {dayWaiting > 0 && (
                    <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1 text-amber-800">
                      <Clock className="h-2.5 w-2.5" />
                      {dayWaiting}
                    </span>
                  )}
                </span>
              </button>
              <div className="relative" style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}>
                {slots.map((minute) => {
                  const slotDate = new Date(day);
                  slotDate.setHours(startHour, minute, 0, 0);
                  return (
                    <div
                      key={minute}
                      className={`absolute right-0 left-0 ${minute % 60 === 0 ? "border-t border-border" : "border-t border-dashed border-border/40"}`}
                      style={{ top: minute * PX_PER_MINUTE, height: SLOT_MINUTES * PX_PER_MINUTE }}
                      onDragOver={(event) => {
                        if (dragged && canReschedule) event.preventDefault();
                      }}
                      onDrop={() => {
                        if (dragged && canReschedule) {
                          onDropAt(dragged, slotDate);
                          setDragged(null);
                        }
                      }}
                    />
                  );
                })}
                {dayAppointments.map((row) => (
                  <BlockMenu key={row.id} appointment={row} onBlockAction={onBlockAction}>
                    <EventBlock
                      appointment={row}
                      canDrag={canReschedule}
                      onDragStart={() => setDragged(row)}
                      onDragEnd={() => setDragged(null)}
                      onClick={() => onOpenAppointment(row.id)}
                      lane={lanes.get(row.id)}
                      frame={weekFrame}
                      day={day}
                    />
                  </BlockMenu>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ الشهر */

function MonthGrid({
  anchor,
  appointments,
  onSelectDay,
}: {
  anchor: Date;
  appointments: CalendarAppointment[];
  onSelectDay: (date: Date) => void;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>();
    for (const row of appointments) {
      const key = toDateKey(new Date(row.scheduled_start));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return map;
  }, [appointments]);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="grid min-w-[40rem] grid-cols-7">
        {["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"].map((name) => (
          <div key={name} className="border-b border-s p-2 text-center text-xs font-medium last:border-s-0 bg-muted/30">
            {name}
          </div>
        ))}
        {cells.map((day) => {
          const rows = byDay.get(toDateKey(day)) ?? [];
          const outside = day.getMonth() !== anchor.getMonth();
          const isToday = sameDay(day, new Date());
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDay(startOfDay(day))}
              className={`min-h-[5.5rem] border-b border-s p-1 text-start align-top last:border-s-0 hover:bg-primary/5 ${outside ? "bg-muted/20 text-muted-foreground" : ""}`}
            >
              <div className={`mb-1 text-xs ${isToday ? "font-bold text-primary" : ""}`}>
                {day.toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric" })}
              </div>
              <div className="flex flex-col gap-0.5">
                {rows.slice(0, 3).map((row) => {
                  const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.scheduled;
                  return (
                    <span key={row.id} className={`truncate rounded border-e-2 px-1 text-[10px] ${style.className}`}>
                      {row.is_waiting ? "انتظار" : fmtTime(row.scheduled_start)} {row.patient?.name_ar ?? ""}
                    </span>
                  );
                })}
                {rows.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{rows.length - 3} أخرى</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ القائمة */

function ListView({
  appointments,
  onOpenAppointment,
}: {
  appointments: CalendarAppointment[];
  onOpenAppointment: (id: string) => void;
}) {
  if (appointments.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">لا مواعيد في هذه الفترة.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {appointments.map((row) => {
        const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.scheduled;
        const priority = PRIORITY_MARKS[row.priority];
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onOpenAppointment(row.id)}
            className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm hover:bg-muted/40"
          >
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {row.is_waiting ? <Clock className="h-3.5 w-3.5 text-amber-600" /> : <Clock className="h-3.5 w-3.5" />}
              {row.is_waiting && <span className="text-amber-700">انتظار ·</span>}
              {new Date(row.scheduled_start).toLocaleString("ar-SA-u-nu-latn", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{row.patient?.name_ar ?? "بلا اسم"}</span>
            {row.patient?.file_number && (
              <span className="text-xs text-muted-foreground">ملف {row.patient.file_number}</span>
            )}
            {row.patient?.mobile_number && (
              <span className="text-xs text-muted-foreground">{row.patient.mobile_number}</span>
            )}
            <span className="text-xs text-muted-foreground">{row.doctor?.name_ar ?? "—"}</span>
            {row.patient?.insurance_company_name && <Badge variant="secondary">تأمين</Badge>}
            {priority && <span className={`rounded px-1.5 text-[10px] ${priority.className}`}>{priority.label}</span>}
            <Badge variant="outline" className={style.className}>
              {style.label}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------ قائمة الزرّ الأيمن على الموعد */

/**
 * قائمة الزرّ الأيمن على كتلة الموعد (Kizen): فتح وتعديل، تأكيد، إرسال إلى
 * الانتظار ▸، حجز خانة لموعد الانتظار، ملف المريض، أوامر الملفّ (الفاتورة
 * والفواتير والمواعيد والإرسال إلى الطبيب…)، طباعة. كلّها تنفّذها الشاشة
 * بمساراتها القائمة — القائمة لا تكتب شيئًا بنفسها.
 */
function BlockMenu({
  appointment,
  onBlockAction,
  children,
}: {
  appointment: CalendarAppointment;
  onBlockAction?: (appointmentId: string, action: BlockAction) => void;
  children: ReactNode;
}) {
  if (!onBlockAction) return <>{children}</>;
  const act = (action: BlockAction) => onBlockAction(appointment.id, action);
  const notArrived = isNotArrived(appointment.status);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuLabel className="truncate text-xs">
          {appointment.patient?.file_number != null ? `F#${appointment.patient.file_number} - ` : ""}
          {appointment.patient?.name_ar ?? "—"}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => act({ kind: "open" })}>فتح وتعديل</ContextMenuItem>
        {isUnconfirmed(appointment.status) && (
          <ContextMenuItem onSelect={() => act({ kind: "confirm" })}>تأكيد الموعد</ContextMenuItem>
        )}
        {appointment.is_waiting ? (
          <ContextMenuItem onSelect={() => act({ kind: "assign_slot" })}>حجز خانة وقت لموعد الانتظار</ContextMenuItem>
        ) : (
          <SendToWaitingSubmenu
            disabled={!notArrived}
            onPick={(day) => act({ kind: "waiting", day })}
            onOther={() => act({ kind: "waiting_other" })}
          />
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => act({ kind: "patient_file" })}>فتح الملف الشخصي</ContextMenuItem>
        <ContextMenuItem onSelect={() => act({ kind: "patient_commands" })}>
          أوامر ملفّ المريض (فاتورة، فواتير، مواعيد، إرسال للطبيب…)
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => act({ kind: "print" })}>طباعة الموعد</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ------------------------------------------------------ تخصيص العرض والضبط */

function ScheduleSettingsPopover({
  settings,
  onChange,
}: {
  settings: ScheduleSettings;
  onChange: (patch: Partial<ScheduleSettings>) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8" title="تخصيص العرض والضبط">
          <Settings2 className="h-3.5 w-3.5" />
          العرض
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">نطاق الخانة</Label>
            <div className="flex rounded-md border p-0.5">
              {([15, 30, 60] as const).map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => onChange({ slotMinutes: minutes })}
                  className={`flex-1 rounded px-2 py-1 text-xs ${settings.slotMinutes === minutes ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {minutes} دقيقة
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">التكبير</Label>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                title="تصغير"
                disabled={settings.zoom <= 0.6}
                onClick={() => onChange({ zoom: Math.max(0.6, Math.round((settings.zoom - 0.2) * 10) / 10) })}
              >
                <span className="text-sm font-bold leading-none">−</span>
              </Button>
              <span className="w-10 text-center font-mono text-xs tabular-nums">{Math.round(settings.zoom * 100)}%</span>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                title="تكبير"
                disabled={settings.zoom >= 2}
                onClick={() => onChange({ zoom: Math.min(2, Math.round((settings.zoom + 0.2) * 10) / 10) })}
              >
                <span className="text-sm font-bold leading-none">+</span>
              </Button>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={settings.showDetails} onChange={(e) => onChange({ showDetails: e.target.checked })} />
            عرض تفاصيل الموعد (الوقت والجوال ونوع الزيارة)
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={settings.showWaiting} onChange={(e) => onChange({ showWaiting: e.target.checked })} />
            عرض مرضى الانتظار
          </label>
          <div className="flex flex-col gap-1.5 border-t pt-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={settings.autoRefresh} onChange={(e) => onChange({ autoRefresh: e.target.checked })} />
              التحديث التلقائي
            </label>
            <div className="flex items-center gap-2 text-xs">
              كل
              <Input
                type="number"
                min={15}
                max={600}
                step={15}
                value={settings.refreshSeconds}
                disabled={!settings.autoRefresh}
                onChange={(e) => onChange({ refreshSeconds: Math.min(600, Math.max(15, Number(e.target.value) || 60)) })}
                className="h-7 w-20"
              />
              ثانية
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">يُحفظ هذا الضبط في هذا المتصفّح لك وحدك.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------ التقويم المصغّر */

function MiniMonth({ selected, onSelect }: { selected: Date; onSelect: (date: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  useEffect(() => {
    setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [selected.getFullYear(), selected.getMonth()]);
  const gridStart = startOfWeek(month);
  const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const today = new Date();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} title="الشهر السابق">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">{month.toLocaleDateString("ar-SA-u-nu-latn", { month: "long", year: "numeric" })}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} title="الشهر التالي">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
        {["س", "ح", "ن", "ث", "ر", "خ", "ج"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day) => {
          const outside = day.getMonth() !== month.getMonth();
          const isSelected = sameDay(day, selected);
          const isToday = sameDay(day, today);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(day)}
              className={`h-8 rounded text-xs tabular-nums ${
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "border border-primary text-primary"
                    : outside
                      ? "text-muted-foreground/60 hover:bg-muted"
                      : "hover:bg-muted"
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
      <Button size="sm" variant="outline" onClick={() => onSelect(new Date())}>
        اليوم
      </Button>
    </div>
  );
}

/* ------------------------------------------------- نافذة تأكيد إعادة الجدولة */

function RescheduleDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: {
    appointment: CalendarAppointment;
    start: Date;
    doctorId: string;
    clinicId: string | null;
  } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const previousId = useRef<string | null>(null);

  useEffect(() => {
    if (pending && pending.appointment.id !== previousId.current) {
      previousId.current = pending.appointment.id;
      setReason("");
    }
  }, [pending]);

  const durationMinutes = pending
    ? Math.max(
        15,
        (new Date(pending.appointment.scheduled_end).getTime() -
          new Date(pending.appointment.scheduled_start).getTime()) /
          60000,
      )
    : 30;
  const newEnd = pending ? new Date(pending.start.getTime() + durationMinutes * 60000) : null;

  const move = useMutation({
    mutationFn: async () => {
      if (!pending || !newEnd) return;
      if (!reason.trim()) throw new Error("سبب إعادة الجدولة مطلوب");
      const { error } = await supabase.rpc("app_reschedule_appointment", {
        p_appointment_id: pending.appointment.id,
        p_scheduled_start: pending.start.toISOString(),
        p_scheduled_end: newEnd.toISOString(),
        p_doctor_id: pending.doctorId,
        p_clinic_id: pending.clinicId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // إعادة الجلب لا تحديث متفائل: القاعدة قد ترفض لأسباب لا يعرفها
      // المتصفح، فرسم الموعد في مكانه الجديد ثم إعادته يُربك أكثر مما يُسرّع.
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      toast({ title: "تمت إعادة الجدولة" });
      onDone();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّرت إعادة الجدولة",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={Boolean(pending)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تأكيد إعادة الجدولة</DialogTitle>
          <DialogDescription>
            لا يُنقل الموعد قبل التأكيد — الإفلات حركة يد سهلة الخطأ.
          </DialogDescription>
        </DialogHeader>

        {pending && newEnd && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border p-3 text-sm">
              <div className="mb-1 font-medium">{pending.appointment.patient?.name_ar ?? "بلا اسم"}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="mb-1 text-[10px] text-muted-foreground">الموعد الحالي</div>
                  <div>{new Date(pending.appointment.scheduled_start).toLocaleString("ar-SA-u-nu-latn")}</div>
                  <div className="text-xs text-muted-foreground">
                    {pending.appointment.doctor?.name_ar ?? "—"}
                    {pending.appointment.clinic?.name ? ` · ${pending.appointment.clinic.name}` : ""}
                  </div>
                </div>
                <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
                  <div className="mb-1 text-[10px] text-muted-foreground">الموعد الجديد</div>
                  <div>{pending.start.toLocaleString("ar-SA-u-nu-latn")}</div>
                  <div className="text-xs text-muted-foreground">
                    حتى {newEnd.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {Math.round(durationMinutes)} دقيقة
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/60 p-2 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                تتحقّق القاعدة من دوام الطبيب وإجازته والتعارض مع موعد آخر. الرفض يترك الموعد
                في مكانه ويشرح السبب.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>سبب إعادة الجدولة *</Label>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={move.isPending || !reason.trim()} onClick={() => move.mutate()}>
            {move.isPending ? "جارٍ النقل..." : "تأكيد النقل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
