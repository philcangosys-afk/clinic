import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BellOff,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  FileSignature,
  Flag,
  MoreHorizontal,
  Pencil,
  Printer,
  Receipt,
  RefreshCw,
  StickyNote,
  Undo2,
  UserCheck,
  UserRound,
  UserX,
  Wallet,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDateTime, formatTime } from "@/lib/locale";
import { usePermissions, type PermissionKey } from "@/lib/permissions";
import {
  QUEUE_ACTION_HINT,
  QUEUE_ACTION_LABEL,
  QUEUE_ACTION_PERMISSION,
  primaryQueueAction,
  queueActionsFor,
  type QueueAction,
} from "@/lib/queue-steps";
import { useAppointmentsLive } from "@/hooks/use-appointments-live";
import { usePatientNoteCounts } from "@/components/patients/PatientNotesButton";
import { statusBadgeClass, statusGroup, statusLabel } from "@/lib/appointment-status";
import { printHtml } from "@/lib/document-merge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/**
 * لوحة الاستقبال.
 *
 * تقرأ `v_reception_queue_ordered` (0065) لا الجدول مباشرةً — **الترتيب في
 * القاعدة لا في المتصفح**. الترتيب في العميل كان يجعل كل موظف يرى ترتيبًا قد
 * يختلف عن زميله، ولا يمكن لتقرير أن يُعيد إنتاج «من كان التالي».
 *
 * ومدّة الانتظار تُحسب من **وقت الوصول** وتتوقّف عند النداء: ما بعد النداء
 * انتظار الطبيب لا انتظار الاستقبال، وخلطهما يجعل كل الأرقام بلا معنى.
 */

type QueueRow = {
  appointment_id: string;
  queue_number: number | null;
  status: string;
  priority: string;
  scheduled_start: string;
  arrived_at: string | null;
  checked_in_at: string | null;
  called_at: string | null;
  patient_id: string;
  patient_name: string;
  file_number: number | string | null;
  mobile_number: string | null;
  blood_type: string | null;
  insurance_company_name: string | null;
  insurance_valid: boolean | null;
  doctor_id: string;
  doctor_name: string;
  clinic_id: string | null;
  clinic_name: string | null;
  medical_alert: string | null;
  waiting_minutes: number | null;
  waiting_state: "none" | "ok" | "warning" | "critical";
  invoice_id: string | null;
  invoice_status: string | null;
  remaining_amount: number | null;
  /* ── أعمدة 0161 ─────────────────────────────────────────────────────── */
  entered_at: string | null;
  left_at: string | null;
  note: string | null;
  patient_name_en: string | null;
  visit_type_name: string | null;
  sent_by_name: string | null;
  agreement_remaining: number | null;
  deferred_amount: number | null;
  treated: boolean | null;
  service_name: string | null;
};

/**
 * عدد أعمدة الطابور — مكتوبٌ مرّةً لا في كل `colSpan`.
 *
 * كان العدد `11` مكتوبًا يدويًّا في موضعين، وإضافة عمودٍ واحد تترك صفّ عنوان
 * الطبيب وصفّ «لا مرضى» أقصر من الجدول فينكسر المحاذاة في RTL. أيّ تغييرٍ
 * في الأعمدة يُغيَّر هنا وحده.
 */
const QUEUE_COLUMN_COUNT = 24;

/**
 * تصنيف الصفّ: حضوريّ (زيارة جديدة) أم موعدٌ محجوز.
 *
 * `status = walk_in` هو الحضوريّ في القاعدة. وما عداه موعدٌ سُجِّل قبل الحضور،
 * ونوعُ الزيارة المكتوب (`visit_type_name`) يُقدَّم عليه إن قال «جديد» صراحةً:
 * منشأةٌ تُسجّل الزيارة الجديدة موعدًا في اللحظة نفسها لا يصحّ أن تظهر موعدًا
 * مؤجَّلًا.
 */
function rowKind(row: QueueRow): "walk_in" | "new_visit" | "appointment" {
  if (row.status === "walk_in") return "walk_in";
  if ((row.visit_type_name ?? "").includes("جديد")) return "new_visit";
  return "appointment";
}

const ROW_KIND_STYLE: Record<string, string> = {
  walk_in: "border-e-4 border-e-amber-500 bg-amber-50/40",
  new_visit: "border-e-4 border-e-sky-500 bg-sky-50/40",
  appointment: "border-e-4 border-e-slate-300",
};

const ROW_KIND_BADGE: Record<string, { label: string; className: string }> = {
  walk_in: { label: "حضوري", className: "bg-amber-500 hover:bg-amber-500" },
  new_visit: { label: "زيارة جديدة", className: "bg-sky-600 hover:bg-sky-600" },
  appointment: { label: "موعد", className: "bg-slate-500 hover:bg-slate-500" },
};

/**
 * الخطوة التالية في الصفّ — من `queue-steps` (0175)، المصدر نفسه الذي تقرؤه
 * قائمة الطبيب، فلا يُسمّى الفعل الواحد باسمين.
 *
 * «دخل» و«خرج» بارزان: هما ما ينتظره الطبيب والمحاسبة. و«وصل» و«نداء»
 * عاديّان: عملُ الاستقبال اليوميّ.
 */
function nextQueueStep(
  row: QueueRow,
  can: (key: PermissionKey) => boolean,
): { action: QueueAction; label: string; primary: boolean } | null {
  const action = primaryQueueAction(row.status, "reception");
  if (!action || !can(QUEUE_ACTION_PERMISSION[action])) return null;
  return { action, label: QUEUE_ACTION_LABEL[action], primary: action === "start" || action === "finish" };
}


const PRIORITY_LABELS: Record<string, string> = {
  normal: "عادي",
  urgent: "عاجل",
  emergency: "طارئ",
  elderly: "كبير سن",
  accessibility: "ذوو احتياج",
};

const WAITING_STYLES: Record<QueueRow["waiting_state"], string> = {
  none: "text-muted-foreground",
  ok: "text-emerald-700",
  warning: "text-amber-700 font-medium",
  critical: "text-rose-700 font-bold",
};

export default function ReceptionBoard({
  organizationId,
  organizationName,
  doctors,
  clinics,
  doctorFilter,
  onDoctorFilterChange,
  highlightAppointmentId,
  day,
  readOnly = false,
  lockDoctor = false,
}: {
  organizationId: string | undefined;
  organizationName: string;
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
  /**
   * مرشّح الطبيب يأتي من الشاشة ولا يُملَك هنا.
   *
   * كان للوحة مرشِّحها المستقلّ، فتظهر في الشاشة قائمتان بنفس العنوان «كل
   * الأطباء»: العليا (مرشّح الصفحة) بلا أثر على اللوحة، والسفلى هي العاملة —
   * فيختار الموظف طبيبًا من العليا ويبقى الطابور كما هو فيحسب التصفية معطّلة.
   */
  doctorFilter: string;
  /**
   * تغيير المرشِّح من شريط الأطباء أعلى اللوحة.
   *
   * المرشِّح تملكه الشاشة لا اللوحة (انظر التعليق أعلاه)، فالضغط على بطاقة
   * طبيبٍ هنا يُبلّغها لتغيّره — وإلا ظهر شريطٌ يبدو قابلًا للضغط ولا يفعل
   * شيئًا، وهو أسوأ من شريطٍ للعرض فقط.
   */
  onDoctorFilterChange?: (doctorId: string) => void;
  /** حساب الطبيب: الطابور على بطاقته وحده، بلا شريط الأطباء الآخرين. */
  lockDoctor?: boolean;
  /** صفّ الموعد القادم من `?appointmentId=` يُبرَز حتى يُعثَر عليه بلا بحث. */
  highlightAppointmentId?: string | null;
  /** اليوم المعروض (YYYY-MM-DD) — اليوم افتراضًا (0176). */
  day?: string;
  /** يومٌ سابق: للاطّلاع، كلّ الأفعال معطّلة. */
  readOnly?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can: canBase } = usePermissions();
  /**
   * طابور يومٍ سابق للاطّلاع: كلّ ما تحرسه صلاحيةٌ يُعطَّل بسطرٍ واحد هنا
   * بدل شرطٍ في كلّ زرّ — فلا يُنسى زرٌّ يبقى فعّالًا على طابور أمس.
   */
  const can = (key: PermissionKey) => !readOnly && canBase(key);
  const shownDay = day ?? new Date().toLocaleDateString("en-CA");
  const [transferTarget, setTransferTarget] = useState<QueueRow | null>(null);
  const [priorityTarget, setPriorityTarget] = useState<QueueRow | null>(null);
  const [undoTarget, setUndoTarget] = useState<QueueRow | null>(null);
  /**
   * عدم الحضور كان غائبًا عن اللوحة كليًا مع أن `app_reception_transition`
   * تدعمه: مريضٌ مؤكَّد لم يحضر لا يمكن إغلاق موعده إلا بالتبديل إلى عرض
   * «بطاقات» — فيبقى في الطابور بقية اليوم ويشوّه عدّاد الانتظار.
   */
  const [noShowTarget, setNoShowTarget] = useState<QueueRow | null>(null);
  /**
   * الإلغاء كان غائبًا كليًّا: مريضٌ اعتذر أو حُجز له مرّتين بالخطأ يبقى في
   * الطابور بقيّة اليوم ويُحسب في عدّاد الانتظار. و«لم يحضر» ليست الحقيقة.
   * والقدرة كانت في القاعدة بلا باب — أُضيف الإجراء في 0158.
   */
  const [cancelTarget, setCancelTarget] = useState<QueueRow | null>(null);
  /**
   * تعديل الملاحظة المسجَّلة — «تعديل الملاحظة» في قائمة الزرّ الأيمن.
   *
   * الملاحظة تُكتب عند الحجز ولا تُعدَّل بعده من أيّ شاشة، مع أنّ أكثر ما
   * يُكتب فيها يظهر عند الاستقبال لا عند الحجز: «يريد الطبيب نفسه»، «معه
   * مرافق»، «تأخّر ويقبل الانتظار». فتُكتب على ورقةٍ جانبية وتضيع.
   */
  const [noteTarget, setNoteTarget] = useState<QueueRow | null>(null);

  const queue = useQuery({
    queryKey: ["reception-board", organizationId, shownDay],
    enabled: Boolean(organizationId),
    // التحديث الدوري لا التحديث اليدوي: الطابور يتغيّر بفعل زملاء آخرين،
    // وشاشة لا تتحدّث تجعل الموظف ينادي مريضًا نُودي قبل دقيقة.
    refetchInterval: 20_000,
    queryFn: async () => {
      // يومٌ واحد بتوقيت العيادة (0176): المنظور يحمل كلّ الأيام
      const start = new Date(`${shownDay}T00:00:00`);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      const { data, error } = await supabase
        .from("v_reception_queue_ordered")
        .select("*")
        .eq("organization_id", organizationId)
        .gte("scheduled_start", start.toISOString())
        .lt("scheduled_start", end.toISOString());
      if (error) throw error;
      return (data ?? []) as QueueRow[];
    },
  });

  // ما يضغطه الطبيب («دخل»، «خرج») يظهر هنا خلال ثانية (0175)
  useAppointmentsLive(
    organizationId,
    [["reception-board"], ["reception-doctor-pressure"], ["reception-queue"]],
    "reception-board",
  );

  const rows = useMemo(
    () => (queue.data ?? []).filter((row) => doctorFilter === "all" || row.doctor_id === doctorFilter),
    [queue.data, doctorFilter],
  );

  /**
   * ملاحظات الملفّ على اسم المريض: ما يكتبه الطبيب في «الملاحظات» يراه
   * الاستقبال هنا دون أن يفتح كلّ ملفّ — والضغط على الإشارة يفتحها.
   */
  const noteCounts = usePatientNoteCounts((queue.data ?? []).map((row) => row.patient_id));

  const transition = useMutation({
    mutationFn: async ({ id, action, reason }: { id: string; action: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("app_reception_transition", {
        p_appointment_id: id,
        p_action: action,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return { id, action, result: Array.isArray(data) ? data[0] : data };
    },
    onSuccess: ({ id, action }) => {
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      // «دخل» من الاستقبال تسجيلٌ لا انتقال: كان يفتح السجلّ الطبّي لموظّف
      // الاستقبال — شاشةٌ لا يكتب فيها. الطبيب يُفتح له السجلّ من قائمته.
      toast({ title: `تمّ: ${QUEUE_ACTION_LABEL[action as QueueAction] ?? action}` });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر تنفيذ الإجراء",
        description: errorMessage(error),
      }),
  });

  /**
   * حفظ الملاحظة عبر `app_set_appointment_note` (0161) لا بـ`update` مباشر:
   * الدالّة تفحص العضوية والصلاحية وتتحقّق من أنّ صفًّا تغيّر فعلًا — و
   * PostgREST لا يعدّ «لم يتغيّر شيء» خطأً، فكان التعديل الفاشل يبدو ناجحًا.
   */
  const saveNote = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase.rpc("app_set_appointment_note", {
        p_appointment_id: id,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      setNoteTarget(null);
      toast({ title: "تم حفظ الملاحظة" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حفظ الملاحظة", description: errorMessage(error) }),
  });

  /**
   * ضغط الطابور على كل طبيب (0158).
   *
   * الاستقبال كان يرى قائمةً واحدة مسطَّحة لا تقول مَن ينتظر أيّ طبيب إلا
   * بترشيح طبيبٍ واحد في كل مرّة. البطاقات تقول ذلك نظرةً واحدة، والضغط على
   * بطاقةٍ يحصر اللوحة على طبيبها.
   */
  const pressure = useQuery({
    queryKey: ["reception-doctor-pressure", organizationId],
    enabled: Boolean(organizationId),
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reception_queue_by_doctor")
        .select("*")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as {
        doctor_id: string;
        doctor_name: string;
        total: number;
        waiting_count: number;
        arrived_count: number;
        checked_in_count: number;
        called_count: number;
        in_progress_count: number;
        longest_wait_minutes: number | null;
      }[];
    },
  });

  /**
   * الصفوف مُجمَّعة بالطبيب مع عنوانٍ فوق كل مجموعة — كما في نظام العيادات
   * المرجعيّ. الترتيب داخل المجموعة يبقى كما جاء من القاعدة (الدور).
   */
  const groups = useMemo(() => {
    const map = new Map<string, { doctorId: string; doctorName: string; items: QueueRow[] }>();
    for (const row of rows) {
      const key = row.doctor_id ?? "—";
      const entry = map.get(key);
      if (entry) entry.items.push(row);
      else map.set(key, { doctorId: key, doctorName: row.doctor_name ?? "بلا طبيب", items: [row] });
    }
    return [...map.values()].sort((a, b) => a.doctorName.localeCompare(b.doctorName, "ar"));
  }, [rows]);

  const printTicket = (row: QueueRow) => {
    // اسم مختصر: الاسم الأول والأخير. التذكرة تُترك على طاولة أو تُعلَّق،
    // وطباعة الاسم الرباعي عليها إفشاء لا داعي له.
    const parts = row.patient_name.trim().split(/\s+/);
    const shortName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : row.patient_name;
    printHtml(
      `تذكرة دور ${row.queue_number ?? ""}`,
      `<div style="text-align:center;font-family:sans-serif">
         <h2 style="margin:0">${organizationName}</h2>
         <p style="margin:4px 0;font-size:12px">تذكرة الدور</p>
         <div style="font-size:64px;font-weight:bold;margin:12px 0">${row.queue_number ?? "—"}</div>
         <p style="margin:2px 0">${shortName}</p>
         <p style="margin:2px 0;font-size:12px">${row.doctor_name}${row.clinic_name ? ` · ${row.clinic_name}` : ""}</p>
         <p style="margin:2px 0;font-size:12px">
           وقت التسجيل: ${formatDateTime(row.arrived_at ?? Date.now())}
         </p>
       </div>`,
      "thermal_80mm",
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {readOnly ? (
            <span>{rows.length} في سجلّ هذا اليوم</span>
          ) : (
            <span>{rows.filter((row) => row.status !== "completed").length} في الطابور</span>
          )}
          {rows.some((row) => row.status === "completed") && (
            <span className="text-emerald-700">
              · {rows.filter((row) => row.status === "completed").length} خرج
            </span>
          )}
          {rows.some((row) => row.waiting_state === "critical") && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              انتظار طويل
            </Badge>
          )}
        </div>
        {doctorFilter !== "all" && !lockDoctor && (
          <span className="text-xs text-muted-foreground">
            مصفّى على: {doctors.find((doctor) => doctor.id === doctorFilter)?.name_ar ?? "طبيب"}
          </span>
        )}
      </div>

      {/**
        * فشل قراءة ضغط الأطباء يُعلَن ولا يُبتلع.
        *
        * الشريط يعتمد على `v_reception_queue_by_doctor` (0158). لو لم تُنفَّذ
        * الترقية كان الشريط يختفي بصمت، فيظنّ من يقرأ الشاشة أنّ الميزة لم
        * تُبنَ — وهو أسوأ من خطأٍ ظاهر: يُرسل الشكوى إلى الجهة الخطأ.
        */}
      {!readOnly && !lockDoctor && pressure.isError && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          تعذّر قراءة ضغط الأطباء: {errorMessage(pressure.error)} — إن لم تُنفَّذ
          الترقية <span className="font-mono">0158</span> على القاعدة بعد، نفِّذها
          ليظهر الشريط. الطابور أدناه يعمل بدونها.
        </p>
      )}

      {/* ضغط الطابور على كل طبيب — بطاقةٌ لكل طبيبٍ له منتظرون، والضغط يحصر */}
      {!readOnly && !lockDoctor && pressure.isSuccess && (pressure.data ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onDoctorFilterChange?.("all")}
            className={`rounded-lg border px-3 py-2 text-start transition ${
              doctorFilter === "all" ? "border-primary bg-primary/5" : "hover:border-primary/40"
            }`}
          >
            <div className="text-sm font-semibold">كل الأطباء</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {(pressure.data ?? []).reduce((sum, d) => sum + Number(d.total ?? 0), 0)} في الطابور
            </div>
          </button>
          {(pressure.data ?? [])
            .slice()
            .sort((a, b) => a.doctor_name.localeCompare(b.doctor_name, "ar"))
            .map((doctor) => (
              <button
                key={doctor.doctor_id}
                type="button"
                onClick={() => onDoctorFilterChange?.(doctor.doctor_id)}
                className={`rounded-lg border px-3 py-2 text-start transition ${
                  doctorFilter === doctor.doctor_id
                    ? "border-primary bg-primary/5"
                    : "hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-semibold">{doctor.doctor_name}</div>
                <div className="flex flex-wrap items-center gap-1 text-[11px] tabular-nums">
                  <span className="text-muted-foreground">{doctor.total} مريض</span>
                  {Number(doctor.in_progress_count) > 0 && (
                    <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                      {doctor.in_progress_count} بالداخل
                    </Badge>
                  )}
                  {Number(doctor.called_count) > 0 && (
                    <Badge variant="outline" className="px-1 py-0 text-[10px]">
                      {doctor.called_count} نُودي
                    </Badge>
                  )}
                  {Number(doctor.longest_wait_minutes ?? 0) >= 30 && (
                    <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                      أطول انتظار {doctor.longest_wait_minutes} د
                    </Badge>
                  )}
                </div>
              </button>
            ))}
        </div>
      )}

      {queue.isLoading && <Skeleton className="h-72 w-full" />}

      {!queue.isLoading && (
        <div
          className={
            "overflow-x-auto rounded-lg border text-xs " +
            // الصفّ الواحد: سطرٌ واحد لا يلتفّ، وحشوٌ ضيّق، وخطٌّ أصغر.
            "[&_td]:px-1.5 [&_td]:py-1 [&_td]:align-middle [&_th]:px-1.5 [&_th]:py-1.5 " +
            "[&_td]:text-xs [&_th]:text-[11px] [&_td]:leading-tight [&_th]:leading-tight " +
            // الشارات داخل الجدول تتقلّص معه، وإلّا فرضت هي ارتفاع الصفّ.
            "[&_td_.badge]:text-[10px]"
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 whitespace-nowrap">#</TableHead>
                <TableHead className="w-[9rem] whitespace-nowrap">إجراءات</TableHead>
                {/* أحد عشر عمودًا وخلية إجراءات فيها ستّة أزرار: بلا منع الالتفاف
                    تنكسر العناوين في منتصف الكلمة («الدو/ر»، «الفاتو/رة»)
                    ويصير الجدول غير مقروء. والأعمدة الثانوية تُخفى على الشاشات
                    الضيّقة بدل أن تسحق المريض والحالة. */}
                <TableHead className="w-12 whitespace-nowrap">الدور</TableHead>
                <TableHead className="min-w-[10rem]">المريض</TableHead>
                <TableHead className="whitespace-nowrap">الاسم الإنجليزي</TableHead>
                <TableHead className="whitespace-nowrap">الملف</TableHead>
                <TableHead className="min-w-[9rem]">الطبيب / العيادة</TableHead>
                <TableHead className="whitespace-nowrap">الزيارة</TableHead>
                <TableHead className="whitespace-nowrap">الخدمة</TableHead>
                <TableHead className="whitespace-nowrap">الموعد</TableHead>
                <TableHead className="whitespace-nowrap">وصل</TableHead>
                <TableHead className="whitespace-nowrap">نودي</TableHead>
                <TableHead className="whitespace-nowrap">دخل</TableHead>
                <TableHead className="whitespace-nowrap">خرج</TableHead>
                <TableHead className="whitespace-nowrap">الانتظار</TableHead>
                <TableHead className="whitespace-nowrap">المرسل</TableHead>
                <TableHead className="whitespace-nowrap">اتفاقية</TableHead>
                <TableHead className="whitespace-nowrap">أجل</TableHead>
                <TableHead className="whitespace-nowrap">عولج</TableHead>
                <TableHead className="min-w-[10rem]">ملاحظة</TableHead>
                <TableHead className="whitespace-nowrap">الأولوية</TableHead>
                <TableHead className="whitespace-nowrap">الحالة</TableHead>
                <TableHead className="whitespace-nowrap">التأمين</TableHead>
                <TableHead className="whitespace-nowrap">الفاتورة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <Fragment key={group.doctorId}>
                  {/* عنوان المجموعة: الطبيب وعدد منتظريه — نظير «اسم الطبيب: د.
                      فلان» في نظام العيادات المرجعيّ. */}
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableCell colSpan={QUEUE_COLUMN_COUNT} className="!py-0.5 text-[11px] font-bold">
                      اسم الطبيب: {group.doctorName}
                      <span className="ms-2 font-normal text-muted-foreground tabular-nums">
                        ({group.items.length})
                      </span>
                    </TableCell>
                  </TableRow>
                  {group.items.map((row, indexInGroup) => {
                  /**
                   * الترقيم على القائمة المعروضة كلّها لا على المجموعة: الاستقبال
                   * يقول «الثاني عشر» لا «الثاني في مجموعة د. فلان».
                   */
                  const rowIndex =
                    groups
                      .slice(0, groups.findIndex((g) => g.doctorId === group.doctorId))
                      .reduce((sum, g) => sum + g.items.length, 0) + indexInGroup + 1;
                  const nextStep = nextQueueStep(row, can);
                  return (
                <TableRow
                  key={row.appointment_id}
                  className={[
                    // لون الحالة يغلب خلفيّة نوع الصفّ ويبقى شريط النوع (0176):
                    // من خرج يبقى في مكانه أخضر، ومن عند الطبيب أزرق.
                    statusGroup(row.status).row
                      ? `${ROW_KIND_STYLE[rowKind(row)].replace(/\s?bg-\S+/g, "")} ${statusGroup(row.status).row}`
                      : ROW_KIND_STYLE[rowKind(row)],
                    row.appointment_id === highlightAppointmentId
                      ? "ring-2 ring-inset ring-primary"
                      : "",
                  ]
                    .filter(Boolean)
                    .concat("cursor-pointer")
                    .join(" ")}
                  // الضغط على الصفّ يفتح ملفّ المريض مباشرةً (0220) — إلّا الأزرار
                  // والقوائم داخله، وتحديد نصٍّ للنسخ.
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest("button, a, input, select, textarea, [role='menuitem'], [role='menu'], [role='link'], [role='dialog']")) return;
                    if (window.getSelection()?.toString()) return;
                    navigate(`/patients/${row.patient_id}`);
                  }}
                >
                  <TableCell className="text-center text-[11px] text-muted-foreground tabular-nums">
                    {rowIndex}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5 [&_button]:h-6 [&_button]:px-1.5 [&_button]:text-[11px] [&_svg]:h-3 [&_svg]:w-3">
                      {/**
                        * **الخطوة التالية المشروعة وحدها.**
                        *
                        * القاعدة (`app_reception_transition`) تفرض ما يصحّ من
                        * أيّ حالة، وعرضُ سبعة أزرارٍ يصحّ واحدٌ منها ليس
                        * خيارًا بل بحثًا عن الصحيح. وكلّ ما عداها في القائمة
                        * معطَّلًا لا محذوفًا — فيبقى مرئيًّا أنّه موجود وأنّه
                        * لا يصحّ الآن.
                        */}
                      {nextStep && (
                        <Button
                          size="sm"
                          variant={nextStep.primary ? "default" : "outline"}
                          title={QUEUE_ACTION_HINT[nextStep.action]}
                          onClick={() =>
                            transition.mutate({ id: row.appointment_id, action: nextStep.action })
                          }
                        >
                          {nextStep.label}
                        </Button>
                      )}
                      {row.queue_number !== null && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="طباعة تذكرة الدور"
                          onClick={() => printTicket(row)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="top" align="end" className="max-h-[70vh] w-60 overflow-y-auto">
                          <DropdownMenuLabel>الطابور</DropdownMenuLabel>
                          {/* الخطوات بترتيبها في كلّ شاشة (0175): وصل ← نداء ← دخل ← خرج.
                              ما لا يصحّ الآن معطَّلٌ لا محذوف، والقاعدة تفرض الترتيب. */}
                          {(["arrive", "call", "start", "finish", "recall", "uncall"] as QueueAction[]).map(
                            (action) => (
                              <DropdownMenuItem
                                key={action}
                                title={QUEUE_ACTION_HINT[action]}
                                disabled={
                                  !can(QUEUE_ACTION_PERMISSION[action]) ||
                                  !queueActionsFor(row.status).includes(action)
                                }
                                onClick={() => transition.mutate({ id: row.appointment_id, action })}
                              >
                                {action === "uncall" ? (
                                  <BellOff className="h-4 w-4" />
                                ) : action === "call" || action === "recall" ? (
                                  <Bell className="h-4 w-4" />
                                ) : action === "arrive" ? (
                                  <UserCheck className="h-4 w-4" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                                {QUEUE_ACTION_LABEL[action]}
                              </DropdownMenuItem>
                            ),
                          )}
                          <DropdownMenuItem
                            disabled={!can("appointments.update")}
                            onClick={() => setNoteTarget(row)}
                          >
                            <Pencil className="h-4 w-4" />
                            تعديل الملاحظة المسجَّلة
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={
                              !can("reception.check_in") ||
                              !["confirmed", "arrived"].includes(row.status)
                            }
                            className="text-destructive"
                            onClick={() => setNoShowTarget(row)}
                          >
                            <UserX className="h-4 w-4" />
                            لم يحضر
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!can("reception.transfer")}
                            onClick={() => setTransferTarget(row)}
                          >
                            <ArrowLeftRight className="h-4 w-4" />
                            نقل إلى طبيبٍ آخر
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!can("appointments.update")}
                            onClick={() => setPriorityTarget(row)}
                          >
                            <Flag className="h-4 w-4" />
                            تغيير الأولوية
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!can("reception.override")}
                            onClick={() => setUndoTarget(row)}
                          >
                            <Undo2 className="h-4 w-4" />
                            تراجع عن آخر انتقال
                          </DropdownMenuItem>
                          {/* «حذف من قائمة الانتظار» في النظام المرجعيّ =
                              إخراجٌ من الطابور. وهو هنا إلغاءٌ بسببٍ يبقى في
                              السجلّ لا حذف: المالك يمنع الحذف النهائي
                              للبيانات الطبية والمالية، والموعد المحذوف يمحو
                              معه أثر مَن حجزه ومتى. */}
                          <DropdownMenuItem
                            disabled={!can("reception.transfer") || row.status === "completed"}
                            className="text-destructive"
                            onClick={() => setCancelTarget(row)}
                          >
                            <XCircle className="h-4 w-4" />
                            إخراج من الطابور
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              queue.refetch();
                              pressure.refetch();
                            }}
                          >
                            <RefreshCw className="h-4 w-4" />
                            تحديث
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>أوامر على المريض</DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => navigate(`/billing?appointmentId=${row.appointment_id}`)}
                          >
                            <Receipt className="h-4 w-4" />
                            فاتورة جديدة
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => navigate(`/appointments?bookFor=${row.patient_id}`)}
                          >
                            <CalendarPlus className="h-4 w-4" />
                            حجز موعد
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => navigate(`/patients/${row.patient_id}?section=invoices`)}
                          >
                            <Wallet className="h-4 w-4" />
                            عرض فواتير المريض
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => navigate(`/patients/${row.patient_id}?section=agreements`)}
                          >
                            <FileSignature className="h-4 w-4" />
                            عرض اتفاقيات المريض
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/patients/${row.patient_id}`)}>
                            <UserRound className="h-4 w-4" />
                            فتح المعلومات الشخصية
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>نوافذ النظام</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => navigate("/appointments")}>
                            <CalendarDays className="h-4 w-4" />
                            جدول المواعيد
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                  <TableCell className="text-center font-bold tabular-nums">
                    {row.queue_number ?? "—"}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-start"
                      onClick={() => navigate(`/patients/${row.patient_id}`)}
                    >
                      <span
                        className="flex items-center gap-1 whitespace-nowrap"
                        title={row.mobile_number ?? undefined}
                      >
                        <span className="max-w-[11rem] truncate font-medium text-primary underline-offset-2 hover:underline">
                          {row.patient_name}
                        </span>
                        {(noteCounts.data?.[row.patient_id] ?? 0) > 0 && (
                          <span
                            role="link"
                            title="ملاحظات على ملفّ المريض — اضغط لقراءتها"
                            className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900 hover:bg-amber-200"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/patients/${row.patient_id}?section=notes`);
                            }}
                          >
                            <StickyNote className="h-3 w-3" />
                            {noteCounts.data?.[row.patient_id]}
                          </span>
                        )}
                        {row.blood_type && (
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">
                            {row.blood_type}
                          </Badge>
                        )}
                        {/* التنبيه الطبّي يُقتطع ولا يُلفّ: سطرٌ ثانٍ في خليةٍ
                            واحدة يرفع ارتفاع الصفّ كلّه، والنصّ كامل في
                            التلميح عند الوقوف عليه. */}
                        {row.medical_alert && (
                          <Badge
                            variant="destructive"
                            title={row.medical_alert}
                            className="max-w-[9rem] truncate px-1 py-0 text-[10px]"
                          >
                            {row.medical_alert}
                          </Badge>
                        )}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {row.patient_name_en ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {row.file_number ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{row.doctor_name}</div>
                    <div className="text-xs text-muted-foreground">{row.clinic_name ?? "—"}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {/* اللون على حدّ الصفّ، والنصّ هنا: اللون وحده لا يقرؤه
                        مَن لا يميّز الألوان، والنصّ وحده لا يُرى في لمحة. */}
                    <Badge
                      className={`px-1 py-0 text-[10px] ${ROW_KIND_BADGE[rowKind(row)].className}`}
                      title={row.visit_type_name ?? undefined}
                    >
                      {row.visit_type_name ?? ROW_KIND_BADGE[rowKind(row)].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {row.service_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {formatTime(row.scheduled_start)}
                  </TableCell>
                  {/* «وصل» خطوةٌ واحدة منذ 0175 — كان «استقبال ١» و«استقبال ٢»
                      عمودين لا يُعرف الفرق بينهما. */}
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {formatTime(row.arrived_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {formatTime(row.called_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {formatTime(row.entered_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {formatTime(row.left_at)}
                  </TableCell>
                  <TableCell className={`whitespace-nowrap tabular-nums ${WAITING_STYLES[row.waiting_state]}`}>
                    {row.waiting_minutes === null ? "—" : `${row.waiting_minutes} د`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {row.sent_by_name ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {Number(row.agreement_remaining ?? 0) > 0 ? (
                      <span className="text-amber-700">
                        {formatAmount(row.agreement_remaining ?? 0)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums">
                    {Number(row.deferred_amount ?? 0) > 0 ? (
                      <span className="text-rose-600">{formatAmount(row.deferred_amount ?? 0)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {/**
                      * ثلاث حالات لا اثنتان.
                      *
                      * «عولج» = زيارةٌ أُغلقت أو وُقّعت — دخلٌ محقَّق للطبيب.
                      * «دخل» = دخل الغرفة ولم تُغلق زيارته — دخلٌ منتظَر.
                      * والفرق هو الفرق بين ما يُحاسَب عليه الطبيب وما يُتابَع.
                      */}
                    {row.treated ? (
                      <Badge variant="success" title="زيارة مُغلقة أو موقَّعة">
                        عولج
                      </Badge>
                    ) : row.entered_at ? (
                      <Badge variant="outline" title="دخل الطبيب ولم تُغلق زيارته بعد">
                        دخل
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="line-clamp-2">{row.note ?? "—"}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={row.priority === "normal" ? "outline" : "destructive"}>
                      {PRIORITY_LABELS[row.priority] ?? row.priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant="secondary" className={statusBadgeClass(row.status as any)}>
                      {statusLabel(row.status as any)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {row.insurance_company_name ? (
                      <Badge variant={row.insurance_valid ? "success" : "destructive"}>
                        {row.insurance_valid ? row.insurance_company_name : "بطاقة منتهية"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">نقدي</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {row.invoice_id ? (
                      <span className={Number(row.remaining_amount) > 0 ? "text-rose-600" : "text-emerald-700"}>
                        متبقٍ {formatAmount(row.remaining_amount ?? 0)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">لا فاتورة</span>
                    )}
                  </TableCell>
                </TableRow>
                  );
                  })}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={QUEUE_COLUMN_COUNT} className="py-10 text-center text-sm text-muted-foreground">
                    لا مرضى في الطابور الآن.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {/* مجاميع الذيل — الأرقام الثلاثة نفسها في الشاشة المرجعيّة.
              «المدخلون» من سُجِّل وصوله («وصل»)، لا من فُتحت له زيارة:
              الاستقبال يقيس مَن دخل من الباب. */}
          <div className="flex flex-wrap items-center gap-4 border-t bg-muted/30 px-3 py-2 text-xs">
            <span>
              إجمالي العدد:{" "}
              <span className="font-mono font-semibold tabular-nums">{formatAmount(rows.length)}</span>
            </span>
            <span>
              عدد المدخلين:{" "}
              <span className="font-mono font-semibold tabular-nums">
                {formatAmount(rows.filter((row) => row.arrived_at).length)}
              </span>
            </span>
            <span>
              غير المدخلين:{" "}
              <span className="font-mono font-semibold tabular-nums">
                {formatAmount(rows.filter((row) => !row.arrived_at).length)}
              </span>
            </span>
            <span className="text-muted-foreground">
              عولجوا:{" "}
              <span className="font-mono font-semibold tabular-nums">
                {formatAmount(rows.filter((row) => row.treated).length)}
              </span>
            </span>
          </div>
        </div>
      )}

      <NoteDialog
        row={noteTarget}
        pending={saveNote.isPending}
        onClose={() => setNoteTarget(null)}
        onConfirm={(note) => {
          if (!noteTarget) return;
          saveNote.mutate({ id: noteTarget.appointment_id, note });
        }}
      />
      <TransferDialog
        row={transferTarget}
        doctors={doctors}
        clinics={clinics}
        onClose={() => setTransferTarget(null)}
      />
      <PriorityDialog row={priorityTarget} onClose={() => setPriorityTarget(null)} />
      <NoShowDialog
        row={noShowTarget}
        onClose={() => setNoShowTarget(null)}
        onConfirm={(reason) => {
          if (!noShowTarget) return;
          transition.mutate({ id: noShowTarget.appointment_id, action: "no_show", reason });
          setNoShowTarget(null);
        }}
      />
      <CancelDialog
        row={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason) => {
          if (!cancelTarget) return;
          transition.mutate({ id: cancelTarget.appointment_id, action: "cancel", reason });
          setCancelTarget(null);
        }}
      />
      <UndoDialog
        row={undoTarget}
        onClose={() => setUndoTarget(null)}
        onConfirm={(reason) => {
          if (!undoTarget) return;
          transition.mutate({ id: undoTarget.appointment_id, action: "undo", reason });
          setUndoTarget(null);
        }}
      />
    </div>
  );
}

/**
 * تعديل الملاحظة المسجَّلة على الموعد.
 *
 * الحقل يُملأ بالملاحظة الحالية لا فارغًا: حقلٌ فارغ فوق ملاحظةٍ قائمة يُغري
 * بالكتابة فوقها، فتُمحى ملاحظة زميلٍ بلا قصد.
 */
function NoteDialog({
  row,
  pending,
  onClose,
  onConfirm,
}: {
  row: QueueRow | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  useEffect(() => setNote(row?.note ?? ""), [row?.appointment_id]);

  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل الملاحظة</DialogTitle>
          <DialogDescription>
            {row?.patient_name ?? ""} — الملاحظة تظهر للطبيب في شاشته أيضًا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>الملاحظة</Label>
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          <p className="text-[11px] text-muted-foreground">
            تركُ الحقل فارغًا يمحو الملاحظة.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button disabled={pending} onClick={() => onConfirm(note)}>
            {pending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  row,
  doctors,
  clinics,
  onClose,
}: {
  row: QueueRow | null;
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [doctorId, setDoctorId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [reason, setReason] = useState("");

  const transfer = useMutation({
    mutationFn: async () => {
      if (!row) return;
      if (!reason.trim()) throw new Error("سبب النقل مطلوب");
      const { error } = await supabase.rpc("app_transfer_reception_appointment", {
        p_appointment_id: row.appointment_id,
        p_doctor_id: doctorId || null,
        p_clinic_id: clinicId || null,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      toast({ title: "تم النقل" });
      setDoctorId("");
      setClinicId("");
      setReason("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر النقل",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>نقل المريض</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — حاليًا مع {row?.doctor_name}
            {row?.clinic_name ? ` في ${row.clinic_name}` : ""}.
            <br />
            رقم الدور لا يتغيّر بالنقل: من وقف في الطابور لا يفقد دوره لأن الطبيب تغيّر.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب الجديد</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="بلا تغيير" />
              </SelectTrigger>
              <SelectContent>
                {doctors
                  .filter((doctor) => doctor.id !== row?.doctor_id)
                  .map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.name_ar}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العيادة الجديدة</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger>
                <SelectValue placeholder="بلا تغيير" />
              </SelectTrigger>
              <SelectContent>
                {clinics.map((clinic) => (
                  <SelectItem key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سبب النقل *</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={transfer.isPending || !reason.trim() || (!doctorId && !clinicId)}
            onClick={() => transfer.mutate()}
          >
            {transfer.isPending ? "جارٍ النقل..." : "تأكيد النقل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriorityDialog({ row, onClose }: { row: QueueRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [priority, setPriority] = useState("urgent");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const { error } = await supabase.rpc("app_set_appointment_priority", {
        p_appointment_id: row.appointment_id,
        p_priority: priority,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      toast({ title: "تم تحديث الأولوية" });
      setReason("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر التحديث",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تغيير الأولوية</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — الأولوية الحالية: {PRIORITY_LABELS[row?.priority ?? "normal"]}.
            <br />
            تقديم مريض على آخر قرار يُسأل عنه، فالسبب إلزامي ويُسجَّل في التدقيق.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الأولوية الجديدة</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>السبب *</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || !reason.trim()} onClick={() => save.mutate()}>
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * إلغاء الموعد من الطابور — سببٌ إلزاميّ تفرضه القاعدة أيضًا.
 *
 * **إلغاء لا حذف:** الموعد يخرج من الطابور بتغيّر حالته ويبقى في السجلّ
 * بسببه ومن ألغاه، فيُعرف بعد شهر كم موعدًا أُلغي ولماذا.
 */
function CancelDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: QueueRow | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إلغاء الموعد</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — {row?.doctor_name}
            <br />
            الموعد يخرج من الطابور ولا يُحذف: يبقى في السجلّ بسببه ووقته ومن
            ألغاه. وإن كانت عليه فاتورة محصَّلة سترفض القاعدة الإلغاء حتى
            تُعالَج الفاتورة.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>سبب الإلغاء *</Label>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder="اعتذر المريض هاتفيًّا، أو حُجز مرّتين بالخطأ"
          />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            تأكيد الإلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoShowDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: QueueRow | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل عدم الحضور</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — موعد {row ? formatDateTime(row.scheduled_start) : ""}.
            <br />
            السبب إلزامي وتفرضه القاعدة: «لم يحضر» بلا سبب يمنع أي متابعة لاحقة للمريض،
            ولا يفرّق بين من لم يُتصل به ومن اعتذر.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>سبب عدم الحضور *</Label>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            تأكيد عدم الحضور
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UndoDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: QueueRow | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>التراجع عن الانتقال الأخير</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — الحالة الآن: {statusLabel((row?.status ?? "") as any)}.
            <br />
            خطوة واحدة إلى الوراء فقط. الحالات المكتملة والجارية تُصحَّح بإجراء صريح لا بالتراجع،
            لأن الزيارة قد تكون صدرت بها فاتورة.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>سبب التراجع *</Label>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            تأكيد التراجع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
