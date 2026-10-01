/**
 * حزم الشيفرة القديمة بعد نشرٍ جديد.
 *
 * كل نشرٍ على Netlify يغيّر أسماء الحزم (بصمة في الاسم) ويحذف القديمة. فمن
 * فتح النظام قبل النشر وبقيت صفحته مفتوحة، ثمّ ضغط زرًّا يحمّل حزمةً عند
 * الطلب (PDF، Excel، شاشة لم يفتحها بعد)، طلب ملفًّا لم يعد موجودًا فيظهر:
 * «Failed to fetch dynamically imported module».
 *
 * العلاج الوحيد الصحيح إعادة تحميل الصفحة لتأخذ النسخة الجديدة. يُعاد التحميل
 * مرّةً واحدة في كل دقيقة على الأكثر فلا تدخل الصفحة في حلقة إن كان السبب
 * انقطاع الشبكة لا النشر.
 */

const RELOAD_KEY = "zaincare:stale-chunk-reload-at";

const STALE_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading chunk [\w-]+ failed/i,
  /'text\/html' is not a valid JavaScript MIME type/i,
];

export function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String((error as any)?.message ?? "");
  return STALE_PATTERNS.some((pattern) => pattern.test(message));
}

/** يعيد تحميل الصفحة إن لم يُعَد تحميلها لهذا السبب خلال الدقيقة الأخيرة. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // التخزين غير متاح: يُعاد التحميل مرّةً بلا حارس
  }
  window.location.reload();
  return true;
}

/**
 * استيرادٌ عند الطلب يتعامل مع الحزمة القديمة: يعيد تحميل الصفحة، ويرمي
 * رسالةً مفهومة بدل رابط الحزمة.
 */
export async function importFresh<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isStaleChunkError(error)) {
      reloadForNewVersion();
      throw new Error("صدر تحديثٌ جديد للنظام — تُعاد الصفحة الآن، ثمّ أعد المحاولة.");
    }
    throw error;
  }
}

/** يُستدعى مرّةً عند بدء التطبيق: يلتقط فشل التحميل المسبق الذي يطلقه Vite. */
export function installStaleChunkReload() {
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (payload === undefined || isStaleChunkError(payload)) {
      if (reloadForNewVersion()) event.preventDefault();
    }
  });
}
