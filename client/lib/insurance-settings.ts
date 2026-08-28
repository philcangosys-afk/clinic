import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * إعدادات التأمين — مصدر واحد للقراءة في كل الشاشات.
 *
 * سبب وجود هذا الملف: التدقيق الشامل للقطات الـ133 أثبت أمرين في جدول
 * `insurance_settings`:
 *
 *  1) **تسعة من إعداداته الأحد عشر تُحفَظ ولا تُنفَّذ.** كانت مراجع كل إعداد
 *     محصورة في شاشتَي الإعدادات نفسيهما — يفعّل المستخدم "منع تكرار الخدمة في
 *     المطالبة" فلا يُمنع شيء. وإعداد صامت أسوأ من إعداد غير موجود، لأن
 *     المستخدم يبني قراره على أنه ساري.
 *     (الاستثناءان `auto_create_forms_on_consultation_invoice` و
 *     `exclude_offer_discount_invoices_from_auto_create` مفروضان فعلًا — لكن
 *     في مُحفِّز `app_auto_create_insurance_claim_form` داخل القاعدة (0005)،
 *     لا في العميل.)
 *
 *  2) **كانت محرَّرة من شاشتين** بقيم افتراضية معرَّفة مرتين، فتعديل في إحداهما
 *     يُظهِر قيمة قديمة في الأخرى، وأول حفظ من شاشة قد يدهس ما ضُبط في الأخرى.
 *     التبويب الآن واحد مشترك، وهذا الملف هو قارئه الوحيد.
 */
export type InsuranceSettings = {
  vat_responsibility: "patient" | "company";
  default_ucaf_template: string;
  default_dcaf_template: string;
  prevent_duplicate_policy_name: boolean;
  prevent_duplicate_services_in_claim_line: boolean;
  notify_treating_doctor_on_changes: boolean;
  notify_form_owner_on_changes: boolean;
  disable_patient_max_copay_field: boolean;
  auto_create_forms_on_consultation_invoice: boolean;
  exclude_offer_discount_invoices_from_auto_create: boolean;
  allow_doctor_edit_radiology_data: boolean;
};

/**
 * القيم الافتراضية مطابقة لـ `column_default` في 0005 حرفًا بحرف.
 *
 * أهميتها: المنشأة التي لم تفتح شاشة الإعدادات قط ليس لها صف في الجدول
 * إطلاقًا. لو افترضنا `false` هنا لتعطّلت كل الحمايات للمنشآت الجديدة —
 * وهي أحوج ما تكون إليها.
 */
export const DEFAULT_INSURANCE_SETTINGS: InsuranceSettings = {
  vat_responsibility: "patient",
  default_ucaf_template: "UCAF-2",
  default_dcaf_template: "DCAF-2",
  prevent_duplicate_policy_name: true,
  prevent_duplicate_services_in_claim_line: true,
  notify_treating_doctor_on_changes: true,
  notify_form_owner_on_changes: true,
  disable_patient_max_copay_field: false,
  auto_create_forms_on_consultation_invoice: true,
  exclude_offer_discount_invoices_from_auto_create: true,
  allow_doctor_edit_radiology_data: false,
};

/**
 * مفتاح الذاكرة المؤقتة **مطابق تمامًا** لما يستعمله `useOrgSettingsRow` في
 * شاشة إعدادات التشغيل: `[table, organizationId]`.
 *
 * لماذا هذا حرج: محرِّر الإعدادات يبطّل `["insurance_settings", orgId]` بعد
 * الحفظ. لو استعمل هذا القارئ مفتاحًا مختلفًا لبقي على القيم القديمة بعد
 * الحفظ — فيُفعّل المستخدم "منع تكرار البوليصة" ويجرّبه فورًا فلا يُمنع، ويظن
 * أن الإصلاح لم يعمل.
 *
 * ولنفس السبب `queryFn` هنا نسخة طبق الأصل من `useOrgSettingsRow` (نفس
 * `select("*")` ونفس `maybeSingle`): مفتاحان متطابقان بدالتَي جلب مختلفتين
 * يعني أن أول مَن يُسجَّل يحدّد شكل ما في الذاكرة، فيقرأ الآخر شكلًا لا
 * يتوقعه. دمج الافتراضيات يتم في `select` — وهو يحوّل القيمة المُعادة بلا
 * تغيير ما في الذاكرة.
 */
export function useInsuranceSettings(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["insurance_settings", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_settings")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data as Partial<InsuranceSettings> | null) ?? null;
    },
    select: (row): InsuranceSettings => ({ ...DEFAULT_INSURANCE_SETTINGS, ...(row ?? {}) }),
  });
}
