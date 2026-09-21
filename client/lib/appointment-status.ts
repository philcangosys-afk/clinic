import type { AppointmentStatus } from "@/lib/database.types";

/**
 * حالات الموعد — مصدرٌ واحد للاسم واللون في كلّ شاشة (0176).
 *
 * كانت ثلاث خرائط ألوان لا تتّفق: «مؤكَّد» أخضر في القائمة وأزرق في التقويم،
 * و«في الزيارة» أخضر في التقويم وأزرق في الاستقبال. فاللون لا يُقرأ — يُحفظ
 * لكلّ شاشة على حدة. الآن **تسع مجموعات** بلونٍ واحد تقرؤه المواعيد (الشريط
 * والتقويم والقائمة) والاستقبال وملفّ المريض:
 *
 *   تم الحجز · مؤكَّد · غير مؤكَّد · حضر (ينتظر) · نودي · عند الطبيب · خرج
 *   · لم يحضر · ملغى
 *
 * والمجموعة تجمع ما يعني الشيء نفسه للموظّف: «حضر» يشمل الحاضر بموعد
 * والحاضر بلا موعد ومن بقي من «استقبال ٢» القديم.
 */

export type StatusGroupKey =
  | "booked"
  | "confirmed"
  | "unconfirmed"
  | "arrived"
  | "called"
  | "inside"
  | "left"
  | "no_show"
  | "cancelled";

export type StatusGroup = {
  key: StatusGroupKey;
  label: string;
  statuses: AppointmentStatus[];
  /** الشارة والشريط */
  badge: string;
  /** كتلة الموعد في التقويم */
  block: string;
  /** لون الصفّ في طابور الاستقبال — فارغ حيث لا يتغيّر */
  row: string;
  /** نقطة اللون في مفتاح الألوان */
  dot: string;
};

export const STATUS_GROUPS: StatusGroup[] = [
  {
    key: "booked",
    label: "تم الحجز",
    statuses: ["new", "scheduled"],
    badge: "bg-slate-100 text-slate-800",
    block: "bg-slate-100 border-slate-400 text-slate-900",
    row: "",
    dot: "bg-slate-400",
  },
  {
    key: "confirmed",
    label: "مؤكَّد",
    statuses: ["confirmed"],
    badge: "bg-sky-100 text-sky-800",
    block: "bg-sky-100 border-sky-500 text-sky-900",
    row: "",
    dot: "bg-sky-500",
  },
  {
    key: "unconfirmed",
    label: "غير مؤكَّد",
    statuses: ["unconfirmed"],
    badge: "bg-orange-100 text-orange-800",
    block: "bg-orange-100 border-orange-500 text-orange-900",
    row: "",
    dot: "bg-orange-500",
  },
  {
    key: "arrived",
    label: "حضر — ينتظر",
    statuses: ["arrived", "checked_in", "waiting", "walk_in"],
    badge: "bg-amber-100 text-amber-900",
    block: "bg-amber-100 border-amber-500 text-amber-900",
    row: "",
    dot: "bg-amber-500",
  },
  {
    key: "called",
    label: "نودي",
    statuses: ["called"],
    badge: "bg-violet-100 text-violet-800",
    block: "bg-violet-100 border-violet-500 text-violet-900",
    row: "bg-violet-50",
    dot: "bg-violet-500",
  },
  {
    key: "inside",
    label: "عند الطبيب",
    statuses: ["in_progress"],
    badge: "bg-blue-100 text-blue-800",
    block: "bg-blue-100 border-blue-500 text-blue-900",
    row: "bg-blue-50",
    dot: "bg-blue-500",
  },
  {
    key: "left",
    label: "خرج",
    statuses: ["completed"],
    badge: "bg-emerald-100 text-emerald-800",
    block: "bg-emerald-100 border-emerald-500 text-emerald-900",
    row: "bg-emerald-50",
    dot: "bg-emerald-500",
  },
  {
    key: "no_show",
    label: "لم يحضر",
    statuses: ["no_show"],
    badge: "bg-rose-100 text-rose-800",
    block: "bg-rose-100 border-rose-500 text-rose-900",
    row: "bg-rose-50",
    dot: "bg-rose-500",
  },
  {
    key: "cancelled",
    label: "ملغى",
    statuses: ["cancelled_by_patient", "cancelled_by_staff"],
    badge: "bg-zinc-200 text-zinc-700",
    block: "bg-zinc-100 border-zinc-400 text-zinc-600 line-through",
    row: "",
    dot: "bg-zinc-400",
  },
];

const GROUP_BY_STATUS = new Map<string, StatusGroup>(
  STATUS_GROUPS.flatMap((group) => group.statuses.map((status) => [status, group] as const)),
);

/** مجموعة الحالة — «تم الحجز» لما لا يُعرف، فلا تُعرض حالةٌ بلا لون. */
export function statusGroup(status: string): StatusGroup {
  return GROUP_BY_STATUS.get(status) ?? STATUS_GROUPS[0];
}

/** الاسم الدقيق لكلّ حالة — يُفصّل ما تجمعه المجموعة حيث يهمّ الفرق. */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  new: "تم الحجز",
  scheduled: "تم الحجز",
  confirmed: "مؤكَّد",
  unconfirmed: "غير مؤكَّد",
  arrived: "حضر — ينتظر",
  checked_in: "حضر — ينتظر",
  called: "نودي",
  in_progress: "عند الطبيب",
  completed: "خرج",
  no_show: "لم يحضر",
  cancelled_by_patient: "ملغى — من المريض",
  cancelled_by_staff: "ملغى — من المنشأة",
  walk_in: "حضوري — ينتظر",
  waiting: "حضر — ينتظر",
};

export const APPOINTMENT_STATUS_BADGE = Object.fromEntries(
  (Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map((status) => [
    status,
    statusGroup(status).badge,
  ]),
) as Record<AppointmentStatus, string>;

export function statusBadgeClass(status: AppointmentStatus) {
  return statusGroup(status).badge;
}

export function statusLabel(status: AppointmentStatus) {
  return APPOINTMENT_STATUS_LABELS[status] ?? status;
}
