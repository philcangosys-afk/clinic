/**
 * حالات مطالبة التأمين — **مصدر واحد** لكل الشاشات.
 *
 * كانت الخريطة معرَّفة مرتين: ثمانيَ حالات في `pages/Insurance.tsx` وثلاثَ
 * عشرة في `ClaimsWorkspace.tsx`، والقيد `insurance_claim_forms_status_check`
 * في القاعدة يسمح بالثلاث عشرة. فكانت المطالبة المحفوظة بحالة
 * `validation_failed` (تُنشئها `app_create_claim_from_visit` عند نقص البيانات)
 * تظهر في تبويب «المطالبات» بشارة **فارغة بلا نصّ ولا لون** ولا يمكن ترشيح
 * القائمة عليها لأن المُرشِّح مبنيّ من الخريطة الناقصة نفسها — صفٌّ ميت لا
 * يعرف الموظف ما به. الترجمة الناقصة خطؤها أنها نسخة ثانية، فوُحّدت هنا.
 *
 * ترتيب المفاتيح هو ترتيب دورة حياة المطالبة، لأن مُرشِّح الحالات يُبنى منه.
 */
export const CLAIM_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  validation_failed: "ناقصة البيانات",
  ready: "جاهزة للإرسال",
  submitted: "مُقدَّمة",
  acknowledged: "مستلَمة",
  in_review: "قيد المراجعة",
  approved: "معتمَدة",
  partially_approved: "معتمَدة جزئيًا",
  rejected: "مرفوضة",
  resubmitted: "أُعيد تقديمها",
  settled: "مسوّاة",
  paid: "مدفوعة",
  cancelled: "ملغاة",
};

/** صنف الشارة الملوَّنة (تستعمله شاشة «المطالبات»). */
export const CLAIM_STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  validation_failed: "bg-rose-100 text-rose-800",
  ready: "bg-sky-100 text-sky-800",
  submitted: "bg-sky-100 text-sky-700",
  acknowledged: "bg-indigo-100 text-indigo-700",
  in_review: "bg-violet-100 text-violet-700",
  approved: "bg-emerald-100 text-emerald-700",
  partially_approved: "bg-amber-100 text-amber-800",
  rejected: "bg-rose-100 text-rose-700",
  resubmitted: "bg-violet-100 text-violet-700",
  settled: "bg-emerald-100 text-emerald-800",
  paid: "bg-emerald-200 text-emerald-900",
  cancelled: "bg-slate-200 text-slate-600",
};

/** نبرة مكوّن `Badge` (تستعملها مساحة عمل المطالبات). */
export const CLAIM_STATUS_TONE: Record<
  string,
  "default" | "secondary" | "success" | "destructive" | "warning"
> = {
  draft: "secondary",
  validation_failed: "destructive",
  ready: "default",
  submitted: "default",
  acknowledged: "default",
  in_review: "default",
  approved: "success",
  partially_approved: "warning",
  rejected: "destructive",
  resubmitted: "secondary",
  settled: "success",
  paid: "success",
  cancelled: "secondary",
};

/** نصّ عربيّ لأخطاء التحقّق المحفوظة في `insurance_claim_forms.validation_errors`. */
export function claimValidationErrorsText(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors))
    return errors
      .map((item) =>
        typeof item === "string"
          ? item
          : typeof item === "object" && item !== null
            ? String((item as any).message ?? (item as any).error ?? JSON.stringify(item))
            : String(item),
      )
      .filter(Boolean)
      .join(" · ");
  if (typeof errors === "object")
    return Object.values(errors as Record<string, unknown>)
      .map((value) => String(value))
      .filter(Boolean)
      .join(" · ");
  return String(errors);
}
