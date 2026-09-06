import { useCallback, useEffect } from "react";

/**
 * حماية العمل غير المحفوظ.
 *
 * كان ملف المريض يفقد كل ما كُتب فيه بأتفه سبب: نقرة خارج النافذة، أو زرّ
 * Escape، أو الانتقال إلى تبويب آخر في الملف ثم العودة — لأن الحالة تُبنى
 * مرّة عند التركيب فقط، وRadix يفكّ تركيب التبويب غير النشط. فمن يُدخل ثلاثين
 * حقلًا يخسرها بضغطة واحدة ولا يعرف لماذا.
 *
 * هذا الملف يعالج طرفَين من المشكلة:
 *
 *  - `useUnsavedGuard`: يمنع إغلاق التبويب أو إعادة تحميل الصفحة بلا سؤال.
 *  - `useDirtyDialogClose`: يلفّ `onOpenChange` للنوافذ فتسأل قبل أن تُغلق
 *    على بيانات غير محفوظة (النقر خارجها، وEscape، وزرّ الإغلاق سواءً).
 *
 * أما فكّ تركيب التبويب فيُعالج في الشاشة نفسها بـ`forceMount`.
 *
 * **لا يُستعمل هذا بدل الحفظ**: التنبيه يحمي من الفقد العَرَضيّ، ولا يجعل
 * البيانات محفوظة. الحفظ يبقى بالزرّ.
 */

/** رسالة المتصفّح تُستبدَل بنصّه الخاص في كل المتصفّحات الحديثة — النصّ هنا للتوثيق. */
const LEAVE_MESSAGE = "لديك تعديلات غير محفوظة في هذه الشاشة.";

export function useUnsavedGuard(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // بعض المتصفّحات ما زالت تشترط ضبط returnValue لإظهار التنبيه
      event.returnValue = LEAVE_MESSAGE;
      return LEAVE_MESSAGE;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}

/**
 * `onOpenChange` محميّ: الإغلاق وحده يُسأل عنه، والفتح يمرّ بلا سؤال.
 *
 * `confirm` لا نافذة مخصّصة: النافذة المخصّصة تحتاج نافذةً فوق نافذة (Radix
 * يغلق الأولى قبل أن تُرسَم الثانية)، وسؤال المتصفّح يعمل في كل الحالات
 * ولا يُفقد شيئًا.
 */
export function useDirtyDialogClose(
  isDirty: boolean,
  onOpenChange: (open: boolean) => void,
  message = "ستفقد ما كتبته في هذه النافذة. هل تريد الإغلاق؟",
): (open: boolean) => void {
  return useCallback(
    (open: boolean) => {
      if (!open && isDirty && !window.confirm(message)) return;
      onOpenChange(open);
    },
    [isDirty, message, onOpenChange],
  );
}
