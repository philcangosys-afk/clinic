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

  if (error instanceof Error && error.message.trim()) {
    return friendlyTechnicalMessage(error.message, "") ?? error.message;
  }

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

  /**
   * رسائل تقنية لا تُعرض كما هي (10/10/2026): «GRANT SELECT … TO anon» لا يفهمها
   * الموظّف ولا يستطيع فعل شيء بها. تُترجم إلى ما يفعله، ويبقى الرمز للتشخيص.
   */
  const friendly = friendlyTechnicalMessage(message, code, hint);
  if (friendly) return code ? `${friendly} [${code}]` : friendly;

  const head = message || details || fallback;
  const parts = [head];
  // التفاصيل تُضاف حين تحمل معلومة زائدة على الرسالة لا تكرارًا لها
  if (details && details !== head) parts.push(details);
  // تلميح PostgREST بأوامر SQL («GRANT …») لمن يدير القاعدة لا لمن يستعمل الشاشة
  if (hint && hint !== head && !/\bGRANT\b|\bTO anon\b/i.test(hint)) parts.push(hint);
  if (code) parts.push(`[${code}]`);
  return parts.join(" · ");
}

/** ترجمة الأخطاء التقنية الشائعة إلى ما يفهمه المستخدم ويفعله. */
function friendlyTechnicalMessage(message: string, code: string, hint = ""): string | null {
  // طلبٌ خرج بلا رمز المستخدم (جلسة لم تُجدَّد)
  // PostgREST يذكر الدور في التلميح: «GRANT SELECT ON public.patients TO anon»
  if ((code === "42501" && /\banon\b/i.test(`${message} ${hint}`)) || code === "ZC_SESSION") {
    return code === "ZC_SESSION" && message
      ? message
      : "انقطعت جلسة الدخول لحظيًّا فلم تُقرأ البيانات. أعد المحاولة، وإن تكرّر فسجّل الخروج ثمّ الدخول.";
  }
  if (code === "PGRST301" || code === "PGRST303" || /jwt expired/i.test(message)) {
    return "انتهت جلسة الدخول — حدّث الصفحة، وإن تكرّر فسجّل الدخول من جديد.";
  }
  if (code === "57014" || /statement timeout|canceling statement/i.test(message)) {
    return "الخادم مشغول ولم يكمل الطلب في وقته — أعد المحاولة بعد لحظات.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "تعذّر الاتصال بالخادم — تحقّق من الإنترنت ثمّ أعد المحاولة.";
  }
  return null;
}
