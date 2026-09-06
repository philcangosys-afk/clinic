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

/**
 * عدّاد خانات الرقم — يُعرض بجانب حقل الجوال أو الهوية.
 *
 * الرقم الناقص خانةً لا يُرى بالنظر: عشرة أرقام وتسعة أرقام يبدوان سواءً في
 * حقل ضيّق. والعدّاد يجعل النقص مرئيًّا **أثناء** الكتابة لا بعد الحفظ، ويتحوّل
 * إلى الأخضر عند اكتمال الطول المطلوب.
 */
export function DigitCounter({ value, expected = 10 }: { value: string; expected?: number }) {
  const digits = (value ?? "").replace(/\D/g, "").length;
  const done = digits === expected;
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-xs tabular-nums ${
        digits === 0
          ? "bg-muted text-muted-foreground"
          : done
            ? "bg-emerald-100 text-emerald-800"
            : "bg-rose-100 text-rose-800"
      }`}
      title={done ? "الطول مكتمل" : `المطلوب ${expected} أرقام`}
    >
      {digits}/{expected}
    </span>
  );
}

/** هل الرقم مكتمل الطول؟ (الأرقام وحدها تُحسب) */
export function hasDigits(value: string, expected = 10): boolean {
  return (value ?? "").replace(/\D/g, "").length === expected;
}

/** لا يُقبل في حقل رقميّ إلّا الأرقام — واللصق من الجوّال يأتي بمسافات وشرطات. */
export function digitsOnly(value: string, max = 10): string {
  return (value ?? "").replace(/\D/g, "").slice(0, max);
}
