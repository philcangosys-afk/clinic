import type { AppointmentStatus } from "@/lib/database.types";

/**
 * تسميات وألوان موحّدة لحالات الموعد، تُستخدم في شاشة الاستقبال والمواعيد معًا
 * كي لا تتكرر هذه الخريطة في كل شاشة بشكل منفصل.
 */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  new: "جديد",
  scheduled: "محجوز",
  confirmed: "مؤكَّد",
  unconfirmed: "غير مؤكَّد",
  arrived: "حضر",
  checked_in: "مسجَّل دخول",
  called: "تم النداء",
  in_progress: "داخل الكشف",
  completed: "مكتمل",
  no_show: "لم يحضر",
  cancelled_by_patient: "ألغاه المريض",
  cancelled_by_staff: "ألغته المنشأة",
  walk_in: "حضور مباشر",
  waiting: "في الانتظار",
};

export const APPOINTMENT_STATUS_BADGE: Record<AppointmentStatus, string> = {
  new: "bg-slate-100 text-slate-700",
  scheduled: "bg-sky-100 text-sky-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  unconfirmed: "bg-amber-100 text-amber-700",
  arrived: "bg-indigo-100 text-indigo-700",
  checked_in: "bg-indigo-100 text-indigo-700",
  called: "bg-violet-100 text-violet-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  no_show: "bg-rose-100 text-rose-700",
  cancelled_by_patient: "bg-rose-100 text-rose-700",
  cancelled_by_staff: "bg-rose-100 text-rose-700",
  walk_in: "bg-teal-100 text-teal-700",
  waiting: "bg-amber-100 text-amber-700",
};

export function statusBadgeClass(status: AppointmentStatus) {
  return APPOINTMENT_STATUS_BADGE[status] ?? "bg-slate-100 text-slate-700";
}

export function statusLabel(status: AppointmentStatus) {
  return APPOINTMENT_STATUS_LABELS[status] ?? status;
}
