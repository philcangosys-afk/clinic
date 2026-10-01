import type { ExternalClientRow } from "@/lib/database.types";

/**
 * العميل الخارجيّ مشتريًا لفاتورة الأعمال (B2B) — 0202.
 *
 * فاتورة الأعمال فاتورة ضريبية تعتمدها ZATCA مسبقًا، ولا تُقبل بلا الرقم
 * الضريبيّ للمشتري أو سجلّه التجاريّ وعنوانه الوطنيّ كاملًا. القاعدة تفرض ذلك
 * عند الإصدار (`app_create_sales_invoice`)؛ وهذه تُظهر الناقص قبل المحاولة —
 * في قائمة العملاء وفي نافذة الفاتورة. القائمة الفارغة = جاهز.
 */
export function externalClientB2bGaps(client: Partial<ExternalClientRow>): string[] {
  const gaps: string[] = [];
  if (!client.vat_number && !client.cr_number) gaps.push("الرقم الضريبيّ أو السجلّ التجاريّ");
  if (!client.building_number) gaps.push("رقم المبنى");
  if (!String(client.street_name ?? "").trim()) gaps.push("الشارع");
  if (!String(client.district ?? "").trim()) gaps.push("الحيّ");
  if (!String(client.city ?? "").trim()) gaps.push("المدينة");
  if (!client.postal_code) gaps.push("الرمز البريديّ");
  return gaps;
}
