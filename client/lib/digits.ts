import { toLatinDigits } from "@/lib/patient-search";

export { toLatinDigits };

/**
 * نصّ حقلٍ رقميّ بأرقامٍ إنجليزية فقط (طلب المالك 10/10/2026).
 *
 * لوحة المفاتيح العربية في ويندوز تكتب ٠-٩ العربية-الهندية، وحقل
 * `type="number"` في المتصفّح يرفضها فيبدو الحقل «لا يستجيب»، أو يعرضها
 * بالعربية. هنا تُحوَّل إلى 0-9، وفاصلة الكسر العربية «٫» والفاصلة إلى نقطة،
 * ويُحذف كلّ ما ليس رقمًا. والسالب لا يُقبل إلّا حيث لا حدّ أدنى غير سالب.
 */
export function sanitizeNumberText(raw: string, allowNegative: boolean): string {
  let text = toLatinDigits(raw).replace(/[٫,،]/g, ".").replace(/[^0-9.-]/g, "");
  const negative = allowNegative && text.startsWith("-");
  text = text.replace(/-/g, "");
  const dot = text.indexOf(".");
  if (dot >= 0) text = text.slice(0, dot + 1) + text.slice(dot + 1).replace(/\./g, "");
  return (negative ? "-" : "") + text;
}
