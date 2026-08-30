import { supabase } from "@/lib/supabase";

/**
 * التحقق من دوام الطبيب عند الحجز.
 *
 * سبب وجوده: جدول `doctor_working_hours` موجود منذ 0002، وشاشة الأطباء تُدخل
 * فيه فترات الدوام وفترات الحجب (إجازة، اجتماع، عملية) — لكن التدقيق الشامل
 * للقطات الـ133 أثبت أن **شاشة المواعيد لا تقرأ هذا الجدول إطلاقًا**. فيمكن
 * حجز موعد للطبيب في يوم إجازته بلا تحذير، رغم أن الإجازة مسجّلة في النظام،
 * ثم يُكتشف التعارض حين يحضر المريض.
 *
 * الفترات مخزَّنة كمدى زمني مطلق (`timestamptz`) لا كنمط أسبوعي متكرر، فالمقارنة
 * تقاطع مدىً بمدى مباشرةً.
 */
export type AvailabilityStatus = "ok" | "blocked" | "outside" | "unknown";

export type AvailabilityResult = {
  status: AvailabilityStatus;
  message: string | null;
};

/**
 * `unknown` حين لا يكون للطبيب أي فترة مسجَّلة إطلاقًا.
 *
 * لماذا لا يُعامَل كـ`outside`: أغلب المنشآت تبدأ بلا جداول دوام مُدخَلة.
 * منع الحجز لأن الجدول فارغ كان سيعطّل شاشة المواعيد كليًا يوم التشغيل الأول
 * — والتحقق يجب أن يكافئ من أدخل بياناته لا أن يعاقب من لم يُدخلها بعد.
 */
export async function checkDoctorAvailability(
  doctorId: string,
  start: Date,
  end: Date,
): Promise<AvailabilityResult> {
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // التقاطع الزمني: فترة تتقاطع مع الموعد إذا بدأت قبل نهايته وانتهت بعد بدايته.
  const { data, error } = await supabase
    .from("doctor_working_hours")
    .select("starts_at, ends_at, is_blocked, note")
    .eq("doctor_id", doctorId)
    .lt("starts_at", endIso)
    .gt("ends_at", startIso);

  if (error) throw new Error(`تعذر التحقق من دوام الطبيب: ${error.message}`);

  const overlapping = (data ?? []) as {
    starts_at: string;
    ends_at: string;
    is_blocked: boolean;
    note: string | null;
  }[];

  const blocked = overlapping.find((slot) => slot.is_blocked);
  if (blocked) {
    const reason = blocked.note?.trim() ? ` (${blocked.note.trim()})` : "";
    return {
      status: "blocked",
      message: `الطبيب محجوب في هذا الوقت${reason} — اختر وقتًا آخر`,
    };
  }

  /**
   * التغطية الكاملة لا مجرد التقاطع.
   *
   * `some(...)` كان يكفيه أن يلامس الموعد فترة دوام واحدة: موعد 11:00–13:00
   * على دوام 09:00–12:00 كان يمرّ بلا أي تحذير رغم أن ساعة كاملة منه خارج
   * الدوام — وهي بالضبط الساعة التي لا يجد المريض فيها الطبيب.
   *
   * الفترات تُدمَج أولًا (قد تكون متلاصقة أو متداخلة) ثم يُتحقق أن مدى الموعد
   * مغطّى بلا فجوة.
   */
  const working = overlapping
    .filter((slot) => !slot.is_blocked)
    .map((slot) => ({ from: new Date(slot.starts_at).getTime(), to: new Date(slot.ends_at).getTime() }))
    .sort((a, b) => a.from - b.from);

  if (working.length > 0) {
    let covered = start.getTime();
    for (const slot of working) {
      if (slot.from > covered) break; // فجوة قبل هذه الفترة
      covered = Math.max(covered, slot.to);
    }
    if (covered >= end.getTime()) return { status: "ok", message: null };
    return {
      status: "outside",
      message: "جزء من الموعد يقع خارج فترات دوام الطبيب المسجَّلة",
    };
  }

  // لا فترة متقاطعة: إما خارج الدوام، أو لا دوام مُسجَّل لهذا الطبيب أصلًا.
  const { count, error: countError } = await supabase
    .from("doctor_working_hours")
    .select("id", { count: "exact", head: true })
    .eq("doctor_id", doctorId);

  if (countError) throw new Error(`تعذر التحقق من جدول الطبيب: ${countError.message}`);
  if (!count) return { status: "unknown", message: null };

  return {
    status: "outside",
    message: "الوقت المختار خارج فترات دوام الطبيب المسجَّلة",
  };
}
