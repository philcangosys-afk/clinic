import type { PermissionKey } from "@/lib/permissions";

/**
 * خطوات الطابور — لغةٌ واحدة بين الطبيب والاستقبال (0175).
 *
 * كانت الخطوة الواحدة باسمٍ في كلّ شاشة: «حضر» و«وصول» و«تسجيل الوصول»،
 * و«دخول» و«بدء الزيارة» و«الدخول إلى العيادة»، و«إنهاء» و«خروج» و«إنهاء
 * الزيارة» — وخطوتان للاستقبال («استقبال ١» و«استقبال ٢») لا يُعرف الفرق
 * بينهما. فصار الموظّف يسأل: أيّ زرٍّ هو الصحيح الآن؟
 *
 * الآن أربع خطوات، بفعلٍ واحد، في كلّ شاشة:
 *
 *   ١) **وصل**  — الاستقبال: حضر المريض، فدخل قائمة انتظار طبيبه.
 *   ٢) **نداء** — الاستقبال: يُنادى المريض إلى غرفة الطبيب.
 *   ٣) **دخل**  — الطبيب أو الاستقبال: المريض في الغرفة، وتُفتح الزيارة.
 *   ٤) **خرج**  — الطبيب أو الاستقبال: انتهى، ويبقى ظاهرًا للاستقبال ليحصّل.
 *
 * النداء اختياريّ: الطبيب يأخذ منتظرًا مباشرةً بـ«دخل». وما عدا ذلك بالترتيب،
 * والقاعدة (`app_reception_transition`) هي التي تفرضه — هذا الملفّ يختار ما
 * يُعرض، لا ما يصحّ.
 */

export type QueueAction = "arrive" | "call" | "recall" | "uncall" | "start" | "finish";

export const QUEUE_ACTION_LABEL: Record<QueueAction, string> = {
  arrive: "وصل",
  call: "نداء",
  recall: "إعادة النداء",
  uncall: "إلغاء النداء",
  start: "دخل",
  finish: "خرج",
};

/** ما يحدث بعد الضغط — يظهر تلميحًا على الزرّ. */
export const QUEUE_ACTION_HINT: Record<QueueAction, string> = {
  arrive: "حضر المريض — يدخل قائمة انتظار طبيبه",
  call: "يُنادى المريض إلى غرفة الطبيب",
  recall: "النداء مرّةً أخرى — المريض لم يأتِ بعد",
  uncall: "إلغاء النداء — يعود المريض إلى الانتظار",
  start: "المريض في غرفة الطبيب — تُفتح الزيارة",
  finish: "خرج المريض من عند الطبيب — انتهت الزيارة",
};

/** الصلاحية التي تفحصها القاعدة لكلّ فعل. */
export const QUEUE_ACTION_PERMISSION: Record<QueueAction, PermissionKey> = {
  arrive: "reception.check_in",
  call: "reception.call",
  recall: "reception.call",
  uncall: "reception.call",
  start: "reception.start_visit",
  finish: "reception.finish",
};

const BOOKED = ["new", "scheduled", "confirmed", "unconfirmed"];
/** «ينتظر»: وصل ولم يُنادَ. `checked_in` بقيّةُ «استقبال ٢» القديم — يُعامل معاملة الوصول. */
const WAITING = ["arrived", "checked_in", "waiting", "walk_in"];

export type QueueStage = "booked" | "waiting" | "called" | "inside" | "left" | "closed";

export function queueStage(status: string): QueueStage {
  if (BOOKED.includes(status)) return "booked";
  if (WAITING.includes(status)) return "waiting";
  if (status === "called") return "called";
  if (status === "in_progress") return "inside";
  if (status === "completed") return "left";
  return "closed";
}

// اسم الحالة ولونها ليسا هنا: من `appointment-status` (0176)، المصدر الذي
// تقرؤه المواعيد والتقويم والاستقبال وقائمة الطبيب معًا — لا مفردات ثانية.

/** الأفعال المشروعة من الحالة — بالترتيب الذي تُعرض به. */
export function queueActionsFor(status: string): QueueAction[] {
  switch (queueStage(status)) {
    case "booked":
      return ["arrive"];
    case "waiting":
      return ["call", "start"];
    case "called":
      return ["start", "recall", "uncall"];
    case "inside":
      return ["finish"];
    default:
      return [];
  }
}

/**
 * الزرّ الظاهر في الصفّ — الخطوة التالية وحدها.
 *
 * الاستقبال يمشي الخطوات الأربع. والطبيب لا يملك الوصول ولا النداء (قرار
 * المالك): يرى «دخل» لمن وصل أو نودي، و«خرج» لمن عنده.
 */
export function primaryQueueAction(status: string, side: "reception" | "doctor"): QueueAction | null {
  const stage = queueStage(status);
  if (side === "doctor") {
    if (stage === "waiting" || stage === "called") return "start";
    if (stage === "inside") return "finish";
    return null;
  }
  if (stage === "booked") return "arrive";
  if (stage === "waiting") return "call";
  if (stage === "called") return "start";
  if (stage === "inside") return "finish";
  return null;
}

/** أعمدة الأوقات الأربعة — العناوين نفسها في لوحة الاستقبال وقائمة الطبيب. */
export const QUEUE_TIME_COLUMNS = [
  { key: "arrived", label: "وصل" },
  { key: "called", label: "نودي" },
  { key: "entered", label: "دخل" },
  { key: "left", label: "خرج" },
] as const;
