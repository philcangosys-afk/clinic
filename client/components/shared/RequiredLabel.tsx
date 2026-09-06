import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * تسمية حقل أساسيّ — بالأحمر ونجمة.
 *
 * الحقول الخمسة التي يقوم عليها الملف (الاسم الرباعي، الهوية، الجوال، العمر،
 * الجنسية) كانت تبدو كبقيّة الأربعين حقلًا، فتُفتَح ملفات بلا هوية ولا جنسية
 * ثم تُرفَض فاتورتها أو مطالبتها التأمينية بعد أسابيع. تمييزها بصريًا يُوجّه
 * الاستقبال إلى ما يجب إكماله **قبل** أن يُحفظ الملف ناقصًا.
 *
 * والأحمر هنا للأهمية لا للخطأ، فيُصاحبه `aria-hidden` على النجمة ونصّ
 * «مطلوب» في `title` — لأن اللون وحده لا يصل إلى قارئ الشاشة ولا إلى من لا
 * يميّز الأحمر.
 */
export default function RequiredLabel({
  children,
  missing = false,
}: {
  children: ReactNode;
  missing?: boolean;
}) {
  return (
    <Label className={missing ? "font-semibold text-rose-600" : "font-semibold text-rose-700"}>
      {children}
      <span aria-hidden="true" title="مطلوب" className="ms-1 text-rose-600">
        *
      </span>
      <span className="sr-only"> (مطلوب)</span>
    </Label>
  );
}

/** إطار أحمر للحقل الأساسيّ الفارغ — يُضاف إلى `className` للمُدخَل. */
export const requiredInputClass = (missing: boolean) =>
  missing ? "border-rose-400 focus-visible:ring-rose-400" : "border-rose-200";
