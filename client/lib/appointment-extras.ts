/**
 * أعمدة 0197 على المواعيد وما يلزمها في أكثر من شاشة.
 *
 * `client/lib/database.types.ts` قديم لا يعرف هذه الأعمدة (راجع AGENTS.md)،
 * فتُعرَّف هنا مرّةً ويُقرأ بها الموعد حيث يلزم بدل تكرار الأسماء في كلّ شاشة.
 */
import { supabase } from "@/lib/supabase";

/** الأعمدة تُلحَق بقوائم الاختيار القائمة في الاستعلامات. */
export const APPOINTMENT_EXTRA_COLUMNS =
  "is_waiting, waiting_all_day, accepts_earlier, series_id, label_value_id, updated_by, confirmed_at, confirmed_by";

export type AppointmentExtras = {
  is_waiting?: boolean | null;
  waiting_all_day?: boolean | null;
  accepts_earlier?: boolean | null;
  series_id?: string | null;
  label_value_id?: string | null;
  updated_by?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
};

/** قراءة أعمدة 0197 من صفٍّ نوعه القديم لا يعرفها. */
export function extrasOf(row: unknown): AppointmentExtras {
  return (row ?? {}) as AppointmentExtras;
}

/** الحالات التي لم يحضر صاحبها بعد — وحدها تُرسل إلى الانتظار أو تُقرَّب. */
export const NOT_ARRIVED_STATUSES = ["new", "scheduled", "confirmed", "unconfirmed"] as const;

export function isNotArrived(status: string) {
  return (NOT_ARRIVED_STATUSES as readonly string[]).includes(status);
}

/** «غير مؤكَّد» في Kizen = ما لم يُؤكَّد بعد عندنا: حُجز ولم يُؤكَّد. */
export function isUnconfirmed(status: string) {
  return status === "new" || status === "scheduled" || status === "unconfirmed";
}

/** تاريخ محليّ YYYY-MM-DD (لا `toISOString`، فهو UTC). */
export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * خيارات «إرسال إلى الانتظار»: اليوم والأيام السبعة التالية بأسمائها
 * وتواريخها. في Kizen «Day 1 … Day 7» بلا تاريخ، فيُكتب هنا التاريخ صراحةً
 * ولا يبقى سؤال: هل «اليوم الأوّل» اليوم أم الغد؟
 */
export function waitingDayOptions(from = new Date()) {
  const list: { key: string; label: string }[] = [];
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(from);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    const name = day.toLocaleDateString("ar-SA-u-nu-latn", { weekday: "long" });
    const date = day.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "2-digit", month: "2-digit" });
    const lead = offset === 0 ? "اليوم" : offset === 1 ? "غدًا" : name;
    list.push({ key: localDateKey(day), label: `${lead} · ${offset <= 1 ? `${name} ` : ""}${date}` });
  }
  return list;
}

export async function sendAppointmentToWaiting(appointmentId: string, dayKey: string, fromTime?: string | null) {
  const { data, error } = await supabase.rpc("app_send_appointment_to_waiting", {
    p_appointment_id: appointmentId,
    p_date: dayKey,
    p_from_time: fromTime || null,
  });
  if (error) throw error;
  return data as string | null;
}

/** بداية دوام الطبيب في يوم — وقت موعد الانتظار (0197). */
export async function doctorDayStart(doctorId: string, dayKey: string) {
  const { data, error } = await supabase.rpc("app_doctor_day_start", {
    p_doctor_id: doctorId,
    p_date: dayKey,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** مفاتيح الاستعلامات التي تتأثّر بتغيير موعد — تُبطَل معًا. */
export const APPOINTMENT_QUERY_KEYS = [
  ["appointments-day"],
  ["calendar-appointments"],
  ["appointments-website-upcoming"],
  ["reception-queue"],
  ["reception-board"],
  ["appointment-search"],
  ["earlier-candidates"],
] as const;
