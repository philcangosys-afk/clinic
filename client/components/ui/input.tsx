import * as React from "react";
import { cn } from "@/lib/utils";
import { sanitizeNumberText, toLatinDigits } from "@/lib/digits";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const INPUT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * حقل الأرقام: نصٌّ بأرقامٍ إنجليزية لا `type="number"`.
 *
 * `type="number"` يرفض الأرقام العربية-الهندية التي تكتبها لوحة المفاتيح
 * العربية، فيبدو الحقل معطّلًا أو تظهر فيه الأرقام بالعربية. والحقل النصّيّ
 * بلوحة أرقام (`inputMode="decimal"`) يقبل الكتابة بأيّ لغة، ويحوّلها هنا
 * إلى 0-9 قبل أن تصل إلى `onChange` — فما يُحفظ إنجليزيٌّ دائمًا.
 *
 * ويحتفظ بما يُكتب نصًّا («12.» و«0.0») حتى يكتمل الرقم: الحقل النصّيّ
 * المتحكَّم به كان سيمحو النقطة فور كتابتها لأنّ القيمة الرقمية لم تتغيّر.
 */
const NumberTextInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, value, onChange, min, inputMode, ...props }, ref) => {
    const controlled = value !== undefined;
    const external = value === undefined || value === null ? "" : toLatinDigits(String(value));
    const [draft, setDraft] = React.useState(external);
    const allowNegative = !(min !== undefined && min !== null && min !== "" && Number(min) >= 0);

    React.useEffect(() => {
      if (!controlled) return;
      setDraft((current) => {
        if (current === external) return current;
        // «12.» و«12» الرقمُ نفسه: يبقى ما يكتبه المستخدم
        const same =
          current.trim() !== "" &&
          external.trim() !== "" &&
          current !== "-" &&
          Number(current) === Number(external);
        return same ? current : external;
      });
    }, [controlled, external]);

    return (
      <input
        type="text"
        inputMode={inputMode ?? "decimal"}
        autoComplete="off"
        className={cn(INPUT_CLASS, className)}
        ref={ref}
        min={min}
        value={controlled ? draft : undefined}
        onChange={(event) => {
          const clean = sanitizeNumberText(event.target.value, allowNegative);
          event.target.value = clean;
          if (controlled) setDraft(clean);
          onChange?.(event);
        }}
        {...props}
      />
    );
  },
);
NumberTextInput.displayName = "NumberTextInput";

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, onChange, ...props }, ref) => {
  if (type === "number") {
    return <NumberTextInput ref={ref} className={className} onChange={onChange} {...props} />;
  }
  // الهاتف وما يُعلَن رقميًّا: الأرقام العربية تُحوَّل إلى إنجليزية ويبقى غيرها
  const latinDigits = type === "tel" || props.inputMode === "numeric" || props.inputMode === "decimal";
  return (
    <input
      type={type}
      className={cn(INPUT_CLASS, className)}
      ref={ref}
      onChange={
        latinDigits && onChange
          ? (event) => {
              const latin = toLatinDigits(event.target.value);
              if (latin !== event.target.value) event.target.value = latin;
              onChange(event);
            }
          : onChange
      }
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
