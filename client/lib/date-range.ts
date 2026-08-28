/**
 * حدود تصفية زمنية من تاريخ محلي (YYYY-MM-DD) إلى وسمين زمنيين مطلقين.
 *
 * **سبب وجودها**: الأعمدة من نوع `timestamptz`، وتمرير `"2026-08-27T00:00:00"`
 * بلا إزاحة يجعل Postgres يفسّره بتوقيت الخادم (UTC على Supabase) بينما
 * الجدول يعرض كل صف بتوقيت المتصفح. في الرياض (UTC+3) كانت زيارة الساعة
 * 01:30 من يوم 27 (المخزَّنة 22:30Z من يوم 26) **تُستبعَد** من تصفية "من 27
 * إلى 27" رغم أن الجدول يعرض تاريخها 27 — والعكس: زيارات فجر يوم 28 تدخل في
 * نطاق ينتهي يوم 27.
 *
 * `new Date(y, m, d)` يبني اللحظة بتوقيت المتصفح، و`toISOString()` يحوّلها
 * إلى اللحظة المطلقة المقابلة — فتتطابق الحدود مع ما يراه المستخدم.
 */
export function localDayRange(dateFrom: string, dateTo: string) {
  const startOfDay = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
  };
  const endOfDay = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    // 23:59:59.999 محليًا — النهاية شاملة لليوم المحدَّد نفسه
    return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
  };
  return {
    from: dateFrom ? startOfDay(dateFrom) : null,
    to: dateTo ? endOfDay(dateTo) : null,
  };
}
