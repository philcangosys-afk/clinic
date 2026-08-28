import { supabase } from "@/lib/supabase";

/**
 * فرض مفاتيح حظر المريض.
 *
 * أعمدة الحظر الأربعة موجودة في `patients` منذ 0003، وشاشة ملف المريض تعرضها
 * وتحفظها — لكن التدقيق الشامل أثبت أن **`block_sms` وحده كان مفروضًا فعليًا**
 * (في اختيار مستقبلي الرسائل الجماعية). أما الثلاثة الأخرى فكانت حبرًا على
 * ورق: يحظر المحاسب مريضًا متعثّر السداد عن الفواتير، فيفتح له زميله فاتورة
 * جديدة بعد دقيقتين بلا أي مانع — والنظام يوهم الاثنين بأن الحظر ساري.
 *
 * لماذا الفحص هنا لا في القاعدة: الحظر قرار تشغيلي قابل للتجاوز بقرار إداري،
 * لا قيد سلامة بيانات. مُحفِّز في القاعدة يرفض الإدخال يمنع حتى الحالات
 * المشروعة (طوارئ، تسوية) ولا يترك مخرجًا. الفحص في مسار الإنشاء يوقف الخطأ
 * الشائع ويُظهر السبب المكتوب في الملف، ويبقى التجاوز ممكنًا برفع الحظر.
 *
 * لماذا استعلام منفصل لا حقل في نتيجة البحث: نتائج البحث تُخزَّن في الذاكرة
 * المؤقتة لـ react-query، فقد تكون قديمة بدقائق. الحظر يُقرأ لحظة الإنشاء
 * ليعكس آخر حالة — والاستعلام صف واحد بمفتاح أساسي.
 */
export type PatientBlockKind = "appointments" | "invoices" | "file";

const BLOCK_CONFIG: Record<
  PatientBlockKind,
  { flag: string; reason: string; message: string }
> = {
  appointments: {
    flag: "block_appointments",
    reason: "block_appointments_reason",
    message: "هذا المريض محظور من حجز المواعيد",
  },
  invoices: {
    flag: "block_invoices",
    reason: "block_invoices_reason",
    message: "هذا المريض محظور من إصدار الفواتير",
  },
  file: {
    flag: "block_file",
    reason: "block_file_reason",
    message: "ملف هذا المريض محظور",
  },
};

/**
 * يرمي خطأً مفهومًا إذا كان المريض محظورًا عن العملية المطلوبة.
 * يُستدعى داخل `mutationFn` قبل أي كتابة.
 *
 * لا يرمي إذا تعذّرت القراءة: منع عملية مشروعة بسبب انقطاع شبكة أسوأ من
 * السماح بعملية لمريض محظور — والحظر تشغيلي لا أمني.
 */
export async function assertPatientNotBlocked(
  patientId: string | null | undefined,
  kind: PatientBlockKind,
): Promise<void> {
  if (!patientId) return;
  const config = BLOCK_CONFIG[kind];

  const { data, error } = await supabase
    .from("patients")
    .select(`${config.flag}, ${config.reason}`)
    .eq("id", patientId)
    .maybeSingle();

  if (error || !data) return;

  const row = data as Record<string, unknown>;
  if (row[config.flag] !== true) return;

  const reason = row[config.reason];
  const reasonText = typeof reason === "string" && reason.trim() ? ` — السبب: ${reason.trim()}` : "";
  throw new Error(`${config.message}${reasonText}. ارفع الحظر من ملف المريض للمتابعة.`);
}
