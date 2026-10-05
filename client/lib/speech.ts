/**
 * قراءة التنبيهات بالصوت (نطق عربي من المتصفّح نفسه — بلا خدمة خارجية).
 *
 * طلب المالك: بدل النغمة وحدها يقول النظام للطبيب «لديك مريض جديد» فقط — بلا
 * اسم المريض ولا اسم الطبيب (05/10/2026) — ويقول للاستقبال «دخل المريض عند
 * دكتور …» و«خرج المريض من عند دكتور …»، بلا اسم المريض كذلك.
 *
 * — الصوت من `speechSynthesis` في المتصفّح: مجّاني ويعمل بلا إنترنت إن كان في
 *   الجهاز صوتٌ عربيّ (ويندوز: «Microsoft Hoda/Naayf»، كروم: «Google العربية»
 *   ويحتاج إنترنت). بلا صوتٍ عربيّ لا يُنطق شيء وتبقى النغمة.
 * — المتصفّح لا يسمح بالنطق قبل أوّل نقرة في الصفحة: ما يصل قبلها يُحفظ
 *   ويُنطق مع أوّل نقرة (`flushPendingSpeech`)، كما تفعل النغمة.
 * — يُكتم على هذا الجهاز من شاشة التنبيهات، مستقلًّا عن النغمة.
 */

const NO_VOICE_KEY = "zaincare:notify-voice-off";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // التخزين غير متاح — يبقى الإعداد الافتراضي
  }
}

export const isSpeechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;
export const isNotificationVoiceOn = () => read(NO_VOICE_KEY) !== "1";
export function setNotificationVoice(enabled: boolean) {
  write(NO_VOICE_KEY, enabled ? "0" : "1");
  if (!enabled && isSpeechSupported()) window.speechSynthesis.cancel();
}

let arabicVoice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  if (!isSpeechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  const arabic = voices.filter((v) => v.lang?.toLowerCase().startsWith("ar"));
  arabicVoice =
    arabic.find((v) => v.lang.toLowerCase() === "ar-sa") ??
    arabic.find((v) => /google/i.test(v.name)) ??
    arabic[0] ??
    null;
  return arabicVoice;
}
if (isSpeechSupported()) {
  pickVoice();
  // الأصوات تُحمَّل بعد فتح الصفحة في كروم
  window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

/** هل في الجهاز صوتٌ عربيّ؟ (لشاشة التنبيهات) */
export const hasArabicVoice = () => Boolean(arabicVoice ?? pickVoice());

let pending: string[] = [];

function utter(text: string) {
  const voice = arabicVoice ?? pickVoice();
  if (!voice) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95;
  u.volume = 1;
  window.speechSynthesis.speak(u);
  return true;
}

/**
 * ينطق الجملة. `canPlayNow` = هل أذن المتصفّح بالصوت بعد (نقرة في الصفحة)؛
 * وإلّا تُحفظ لتُنطق مع أوّل نقرة.
 */
export function speakNotification(text: string, canPlayNow: boolean) {
  if (!text || !isSpeechSupported() || !isNotificationVoiceOn()) return;
  if (!canPlayNow) {
    pending = [...pending, text].slice(-3);
    return;
  }
  utter(text);
}

export function flushPendingSpeech() {
  if (!pending.length || !isSpeechSupported() || !isNotificationVoiceOn()) {
    pending = [];
    return;
  }
  const texts = pending;
  pending = [];
  texts.forEach(utter);
}

/** «د. أمجد» / «د.امجد» ⇐ «دكتور أمجد» */
export function spokenDoctor(name: string | null | undefined) {
  const clean = (name ?? "").trim();
  if (!clean) return "دكتور";
  if (/^(دكتور|الدكتور|دكتورة|الدكتورة)\s/.test(clean)) return clean;
  return "دكتور " + clean.replace(/^د(\.\s*|\s+)/, "").trim();
}

/** اسم المريض من نصّ التنبيه: «الاسم — ملف 123 · رقم الدور 4 · …» ⇐ «الاسم» */
export function patientFromBody(body: string | null | undefined) {
  const first = (body ?? "").split(" · ")[0] ?? "";
  return first.replace(/\s+—\s+ملف\s+\S+.*$/, "").trim();
}

/** الجملة المنطوقة لتنبيهٍ — `null` = لا يُنطق (تبقى النغمة) */
export function speechForNotification(
  row: { event_key: string | null; title: string; body: string | null },
  myDoctorName: string | null,
): string | null {
  // اسم المريض لا يُنطق (طلب المالك) — يُقرأ من الشاشة لا من مكبّر الصوت
  void myDoctorName;
  switch (row.event_key) {
    case "patient_waiting_for_doctor":
      return "لديك مريض جديد";
    case "doctor_queue_start": {
      const doctor = row.title.replace(/^دخل المريض عند\s*/, "");
      return `دخل المريض عند ${spokenDoctor(doctor)}`;
    }
    case "doctor_queue_finish": {
      const doctor = row.title.replace(/^خرج المريض من عند\s*/, "");
      return `خرج المريض من عند ${spokenDoctor(doctor)}`;
    }
    default:
      return null;
  }
}
