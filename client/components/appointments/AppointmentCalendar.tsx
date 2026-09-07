import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
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
};

type WorkingWindow = {
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  is_blocked: boolean;
  note: string | null;
};

export type CalendarView = "day" | "week" | "month" | "list";
type GroupBy = "doctor" | "clinic";

const VIEW_LABELS: Record<CalendarView, string> = {
  day: "يومي",
  week: "أسبوعي",
  month: "شهري",
  list: "قائمة",
};

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  new:                  { label: "جديد",          className: "bg-slate-100 border-slate-400 text-slate-900" },
  scheduled:            { label: "مجدول",         className: "bg-slate-100 border-slate-400 text-slate-900" },
  unconfirmed:          { label: "غير مؤكد",      className: "bg-amber-100 border-amber-500 text-amber-900" },
  confirmed:            { label: "مؤكد",          className: "bg-sky-100 border-sky-500 text-sky-900" },
  arrived:              { label: "وصل",           className: "bg-indigo-100 border-indigo-500 text-indigo-900" },
  checked_in:           { label: "مسجَّل",         className: "bg-indigo-100 border-indigo-500 text-indigo-900" },
  called:               { label: "نودي",          className: "bg-violet-100 border-violet-500 text-violet-900" },
  in_progress:          { label: "في الزيارة",    className: "bg-emerald-100 border-emerald-500 text-emerald-900" },
  completed:            { label: "مكتمل",         className: "bg-emerald-50 border-emerald-300 text-emerald-800" },
  no_show:              { label: "لم يحضر",       className: "bg-rose-100 border-rose-500 text-rose-900" },
  cancelled_by_patient: { label: "ألغاه المريض",  className: "bg-rose-50 border-rose-300 text-rose-800 line-through" },
  cancelled_by_staff:   { label: "ألغته المنشأة", className: "bg-rose-50 border-rose-300 text-rose-800 line-through" },
  walk_in:              { label: "حضوري",         className: "bg-teal-100 border-teal-500 text-teal-900" },
  waiting:              { label: "بالانتظار",     className: "bg-teal-100 border-teal-500 text-teal-900" },
};

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

function minutesFromDayStart(iso: string) {
  const date = new Date(iso);
  return (date.getHours() - DAY_START_HOUR) * 60 + date.getMinutes();
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
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
}: {
  organizationId: string | undefined;
  selectedDay: string;
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
  statusFilter?: string;
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
  const [doctorFilter, setDoctorFilter] = useState<string>("all");
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

  const range = useMemo(() => {
    if (view === "week") return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 7) };
    if (view === "month") {
      const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
      return { from, to };
    }
    return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) };
  }, [anchor, view]);

  const appointments = useQuery({
    queryKey: ["calendar-appointments", organizationId, range.from.toISOString(), range.to.toISOString()],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, scheduled_start, scheduled_end, status, priority, queue_number, doctor_id, clinic_id, note, " +
            "patient:patients!appointments_patient_tenant_fk(id, name_ar, file_number, mobile_number, insurance_company_name), " +
            "doctor:doctors!appointments_doctor_tenant_fk(id, name_ar), " +
            "clinic:clinics!appointments_clinic_tenant_fk(id, name), " +
            "visit_type:lookup_values!appointments_visit_type_value_id_fkey(name_ar)",
        )
        .eq("organization_id", organizationId)
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

  const visible = useMemo(() => {
    const needle = (search ?? "").trim();
    return (appointments.data ?? []).filter(
      (row) =>
        (doctorFilter === "all" || row.doctor_id === doctorFilter) &&
        (clinicFilter === "all" || row.clinic_id === clinicFilter) &&
        (!statusFilter || statusFilter === "all" || row.status === statusFilter) &&
        (!needle ||
          Boolean(row.patient?.name_ar?.includes(needle)) ||
          String(row.patient?.file_number ?? "").includes(needle) ||
          Boolean(row.patient?.mobile_number?.includes(needle))),
    );
  }, [appointments.data, doctorFilter, clinicFilter, search, statusFilter]);

  const columns = useMemo(() => {
    if (view !== "day") return [];
    if (groupBy === "clinic") {
      const list = clinicFilter === "all" ? clinics : clinics.filter((c) => c.id === clinicFilter);
      return [...list.map((c) => ({ id: c.id, name: c.name })), { id: "__none__", name: "بلا عيادة" }];
    }
    const list = doctorFilter === "all" ? doctors : doctors.filter((d) => d.id === doctorFilter);
    return list.map((d) => ({ id: d.id, name: d.name_ar }));
  }, [view, groupBy, doctors, clinics, doctorFilter, clinicFilter]);

  const shift = (direction: -1 | 1) => {
    if (view === "month") {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    } else if (view === "week") {
      setAnchor(addDays(anchor, 7 * direction));
    } else {
      setAnchor(addDays(anchor, direction));
    }
  };

  const headerLabel = useMemo(() => {
    if (view === "month") return anchor.toLocaleDateString("ar-SA", { month: "long", year: "numeric" });
    if (view === "week") {
      const from = startOfWeek(anchor);
      return `${from.toLocaleDateString("ar-SA", { day: "numeric", month: "short" })} — ${addDays(from, 6).toLocaleDateString("ar-SA", { day: "numeric", month: "short" })}`;
    }
    return anchor.toLocaleDateString("ar-SA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }, [anchor, view]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => shift(1)} title="التالي">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(startOfDay(new Date()))}>
            اليوم
          </Button>
          <Button size="sm" variant="outline" onClick={() => shift(-1)} title="السابق">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="mr-2 flex items-center gap-1.5 text-sm font-medium">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            {headerLabel}
          </span>
          {/* تقويم فارغ بسبب التصفية يبدو كتقويم بلا مواعيد: الشارة تفرّق
              بين الحالتين حتى لا يظنّ الموظف أن مواعيد اليوم اختفت. */}
          {(Boolean((search ?? "").trim()) || (Boolean(statusFilter) && statusFilter !== "all")) && (
            <Badge variant="outline">تصفية نشطة · {visible.length}</Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            {(Object.keys(VIEW_LABELS) as CalendarView[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`rounded px-2.5 py-1 text-xs ${view === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {VIEW_LABELS[key]}
              </button>
            ))}
          </div>
          {view === "day" && (
            <Select value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="doctor">حسب الطبيب</SelectItem>
                <SelectItem value="clinic">حسب العيادة</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={doctorFilter} onValueChange={setDoctorFilter}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="كل الأطباء" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأطباء</SelectItem>
              {doctors.map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  {doctor.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={clinicFilter} onValueChange={setClinicFilter}>
            <SelectTrigger className="h-8 w-40">
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
        </div>
      </div>

      {appointments.isLoading && <Skeleton className="h-96 w-full" />}

      {!appointments.isLoading && view === "day" && (
        <DayGrid
          date={anchor}
          columns={columns}
          groupBy={groupBy}
          appointments={visible}
          windows={windows.data ?? []}
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

      {!appointments.isLoading && view === "week" && (
        <WeekGrid
          anchor={anchor}
          appointments={visible}
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
        <MonthGrid anchor={anchor} appointments={visible} onSelectDay={(date) => { setAnchor(date); setView("day"); }} />
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

/* ------------------------------------------------------------------ اليوم */

function DayGrid({
  date,
  columns,
  groupBy,
  appointments,
  windows,
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
  windows: WorkingWindow[];
  canReschedule: boolean;
  canCreate: boolean;
  dragged: CalendarAppointment | null;
  setDragged: (value: CalendarAppointment | null) => void;
  onCreateAt: (start: Date, doctorId: string | null, clinicId: string | null) => void;
  onOpenAppointment: (id: string) => void;
  onDropAt: (appointment: CalendarAppointment, start: Date, columnId: string) => void;
}) {
  const slots = useMemo(() => {
    const list: Date[] = [];
    for (let minute = 0; minute < TOTAL_MINUTES; minute += SLOT_MINUTES) {
      const slot = new Date(date);
      slot.setHours(DAY_START_HOUR, minute, 0, 0);
      list.push(slot);
    }
    return list;
  }, [date]);

  const nowOffset = useNowOffset(date);

  if (columns.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">لا توجد أعمدة للعرض.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="flex min-w-[36rem]">
        {/* عمود الساعات */}
        <div className="w-16 shrink-0 border-s bg-muted/30">
          <div className="h-10 border-b" />
          <div className="relative" style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}>
            {slots.map((slot, index) => (
              <div
                key={index}
                className="absolute right-0 left-0 border-b border-dashed text-[10px] text-muted-foreground"
                style={{ top: index * SLOT_MINUTES * PX_PER_MINUTE, height: SLOT_MINUTES * PX_PER_MINUTE }}
              >
                <span className="px-1">
                  {slot.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {columns.map((column) => {
          const columnAppointments = appointments.filter((row) =>
            groupBy === "doctor"
              ? row.doctor_id === column.id
              : (row.clinic_id ?? "__none__") === column.id,
          );
          const columnWindows =
            groupBy === "doctor" ? windows.filter((w) => w.doctor_id === column.id) : [];

          return (
            <div key={column.id} className="min-w-[12rem] flex-1 border-s last:border-s-0">
              <div className="flex h-10 items-center justify-center border-b bg-muted/30 px-2 text-xs font-medium">
                {column.name}
              </div>
              <div className="relative" style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}>
                {/* خلفية عدم التوفّر */}
                <UnavailableLayer date={date} windows={columnWindows} />

                {/* خلايا الإفلات والإنشاء */}
                {slots.map((slot, index) => (
                  <div
                    key={index}
                    className="absolute right-0 left-0 border-b border-dashed hover:bg-primary/5"
                    style={{ top: index * SLOT_MINUTES * PX_PER_MINUTE, height: SLOT_MINUTES * PX_PER_MINUTE }}
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
                  />
                ))}

                {/* المواعيد */}
                {columnAppointments.map((row) => (
                  <EventBlock
                    key={row.id}
                    appointment={row}
                    canDrag={canReschedule}
                    onDragStart={() => setDragged(row)}
                    onDragEnd={() => setDragged(null)}
                    onClick={() => onOpenAppointment(row.id)}
                  />
                ))}

                {nowOffset !== null && (
                  <div
                    className="pointer-events-none absolute right-0 left-0 z-20 border-t-2 border-red-500"
                    style={{ top: nowOffset * PX_PER_MINUTE }}
                  >
                    <span className="absolute -top-2 right-0 rounded bg-red-500 px-1 text-[9px] text-white">الآن</span>
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

/** مؤشر الوقت الحالي — يُعاد حسابه كل دقيقة، و`null` إن كان اليوم غير المعروض. */
function useNowOffset(date: Date) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!sameDay(now, date)) return null;
  const minutes = (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes();
  if (minutes < 0 || minutes > TOTAL_MINUTES) return null;
  return minutes;
}

/**
 * المساحة غير القابلة للحجز.
 *
 * القاعدة نفسها المفروضة في `app_check_doctor_availability` (0064): إن سُجّلت
 * فترات عمل فما خارجها ممنوع، وإن لم تُسجَّل فاليوم كله متاح. لو اختلفت
 * الشاشة عن القاعدة هنا لظهر الوقت أبيض ثم رُفض الحجز — وهو أسوأ من تظليله.
 */
function UnavailableLayer({ date, windows }: { date: Date; windows: WorkingWindow[] }) {
  const dayStart = new Date(date);
  dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(DAY_END_HOUR, 0, 0, 0);

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
          className="pointer-events-none absolute right-0 left-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(100,116,139,0.12)_6px,rgba(100,116,139,0.12)_12px)]"
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

function EventBlock({
  appointment,
  canDrag,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  appointment: CalendarAppointment;
  canDrag: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const top = minutesFromDayStart(appointment.scheduled_start);
  const duration = Math.max(
    15,
    (new Date(appointment.scheduled_end).getTime() - new Date(appointment.scheduled_start).getTime()) / 60000,
  );
  const style = STATUS_STYLES[appointment.status] ?? STATUS_STYLES.scheduled;
  const priority = PRIORITY_MARKS[appointment.priority];

  if (top + duration < 0 || top > TOTAL_MINUTES) return null;

  return (
    <div
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`absolute right-1 left-1 z-10 cursor-pointer overflow-hidden rounded border-e-4 px-1.5 py-0.5 text-[11px] shadow-sm ${style.className}`}
      style={{ top: Math.max(0, top) * PX_PER_MINUTE, height: duration * PX_PER_MINUTE - 2 }}
      title={`${appointment.patient?.name_ar ?? ""} — ${fmtTime(appointment.scheduled_start)}`}
    >
      <div className="flex items-center gap-1">
        {priority && (
          <span className={`rounded px-1 text-[9px] ${priority.className}`}>{priority.label}</span>
        )}
        <span className="truncate font-medium">{appointment.patient?.name_ar ?? "بلا اسم"}</span>
      </div>
      {duration >= 30 && (
        <div className="truncate text-[10px] opacity-80">
          {fmtTime(appointment.scheduled_start)} · {Math.round(duration)}د
          {appointment.patient?.file_number ? ` · ملف ${appointment.patient.file_number}` : ""}
        </div>
      )}
      {duration >= 45 && (
        <div className="flex items-center gap-1 truncate text-[10px] opacity-80">
          {appointment.patient?.mobile_number ?? ""}
          {appointment.visit_type?.name_ar ? ` · ${appointment.visit_type.name_ar}` : ""}
          {appointment.patient?.insurance_company_name && (
            <span className="rounded bg-white/60 px-1">تأمين</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ الأسبوع */

function WeekGrid({
  anchor,
  appointments,
  canReschedule,
  dragged,
  setDragged,
  onOpenAppointment,
  onDropAt,
}: {
  anchor: Date;
  appointments: CalendarAppointment[];
  canReschedule: boolean;
  dragged: CalendarAppointment | null;
  setDragged: (value: CalendarAppointment | null) => void;
  onOpenAppointment: (id: string) => void;
  onDropAt: (appointment: CalendarAppointment, start: Date) => void;
}) {
  const from = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
  const slots = Array.from({ length: TOTAL_MINUTES / SLOT_MINUTES }, (_, index) => index * SLOT_MINUTES);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="flex min-w-[48rem]">
        <div className="w-14 shrink-0 border-s bg-muted/30">
          <div className="h-10 border-b" />
          <div className="relative" style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}>
            {slots.map((minute) => (
              <div
                key={minute}
                className="absolute right-0 left-0 border-b border-dashed px-1 text-[10px] text-muted-foreground"
                style={{ top: minute * PX_PER_MINUTE, height: SLOT_MINUTES * PX_PER_MINUTE }}
              >
                {String(DAY_START_HOUR + Math.floor(minute / 60)).padStart(2, "0")}:
                {String(minute % 60).padStart(2, "0")}
              </div>
            ))}
          </div>
        </div>
        {days.map((day) => {
          const dayAppointments = appointments.filter((row) => sameDay(new Date(row.scheduled_start), day));
          const isToday = sameDay(day, new Date());
          return (
            <div key={day.toISOString()} className="min-w-[8rem] flex-1 border-s last:border-s-0">
              <div className={`flex h-10 flex-col items-center justify-center border-b text-xs ${isToday ? "bg-primary/10 font-bold" : "bg-muted/30"}`}>
                <span>{day.toLocaleDateString("ar-SA", { weekday: "short" })}</span>
                <span className="text-[10px] text-muted-foreground">
                  {day.toLocaleDateString("ar-SA", { day: "numeric", month: "short" })}
                </span>
              </div>
              <div className="relative" style={{ height: TOTAL_MINUTES * PX_PER_MINUTE }}>
                {slots.map((minute) => {
                  const slotDate = new Date(day);
                  slotDate.setHours(DAY_START_HOUR, minute, 0, 0);
                  return (
                    <div
                      key={minute}
                      className="absolute right-0 left-0 border-b border-dashed"
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
                  <EventBlock
                    key={row.id}
                    appointment={row}
                    canDrag={canReschedule}
                    onDragStart={() => setDragged(row)}
                    onDragEnd={() => setDragged(null)}
                    onClick={() => onOpenAppointment(row.id)}
                  />
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
                {day.toLocaleDateString("ar-SA", { day: "numeric" })}
              </div>
              <div className="flex flex-col gap-0.5">
                {rows.slice(0, 3).map((row) => {
                  const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.scheduled;
                  return (
                    <span key={row.id} className={`truncate rounded border-e-2 px-1 text-[10px] ${style.className}`}>
                      {fmtTime(row.scheduled_start)} {row.patient?.name_ar ?? ""}
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
              <Clock className="h-3.5 w-3.5" />
              {new Date(row.scheduled_start).toLocaleString("ar-SA", {
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
                  <div>{new Date(pending.appointment.scheduled_start).toLocaleString("ar-SA")}</div>
                  <div className="text-xs text-muted-foreground">
                    {pending.appointment.doctor?.name_ar ?? "—"}
                    {pending.appointment.clinic?.name ? ` · ${pending.appointment.clinic.name}` : ""}
                  </div>
                </div>
                <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
                  <div className="mb-1 text-[10px] text-muted-foreground">الموعد الجديد</div>
                  <div>{pending.start.toLocaleString("ar-SA")}</div>
                  <div className="text-xs text-muted-foreground">
                    حتى {newEnd.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })} ·{" "}
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
