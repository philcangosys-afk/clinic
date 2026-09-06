/**
 * نصّ الخطأ كما تقوله القاعدة، لا «حدث خطأ غير متوقع».
 *
 * **العيب الذي يعالجه:** أخطاء Supabase ليست من نوع `Error` — هي كائنات
 * `{ message, details, hint, code }`. وكل شاشة في النظام تكتب:
 *
 *     error instanceof Error ? error.message : "حدث خطأ غير متوقع"
 *
 * فالشرط يفشل دائمًا على أخطاء القاعدة، وتُبتلع الرسالة الحقيقية ويُعرض نصّ
 * عامّ لا يقول شيئًا. والنتيجة: عمليةٌ تُرفض لسببٍ مكتوب بالعربية في القاعدة
 * («لا مناوبة مفتوحة»، «المبلغ يتجاوز المتبقّي»، «صلاحيتك لا تسمح…») ويرى
 * المستخدم «خطأ غير متوقع» فلا يعرف ما يصحّح، ولا يستطيع أن يخبر أحدًا.
 *
 * ورمز الخطأ يُلحَق حين لا تكون الرسالة عربية: `42883` (دالّة غير موجودة)
 * و`PGRST202` (توقيع لا يطابق) و`PGRST201` (تضمين غامض) تعني نقصًا في
 * ترقيات القاعدة لا خطأً من المستخدم — ووجود الرمز يختصر التشخيص من ساعة
 * إلى دقيقة.
 */
export function errorMessage(error: unknown, fallback = "حدث خطأ غير متوقع"): string {
  if (!error) return fallback;

  if (typeof error === "string") return error.trim() || fallback;

  if (error instanceof Error && error.message.trim()) return error.message;

  const row = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  };

  const message = typeof row.message === "string" ? row.message.trim() : "";
  const details = typeof row.details === "string" ? row.details.trim() : "";
  const hint = typeof row.hint === "string" ? row.hint.trim() : "";
  const code = typeof row.code === "string" ? row.code.trim() : "";

  const head = message || details || fallback;
  const parts = [head];
  // التفاصيل تُضاف حين تحمل معلومة زائدة على الرسالة لا تكرارًا لها
  if (details && details !== head) parts.push(details);
  if (hint && hint !== head) parts.push(hint);
  if (code) parts.push(`[${code}]`);
  return parts.join(" · ");
}
