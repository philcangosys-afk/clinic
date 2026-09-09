import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * شريط أدوات الشاشة — أزرار صغيرة بأيقونات، مفصولة بخطوط رأسية.
 *
 * النمط مأخوذ من نظام العيادات الذي يعمل عليه المالك: كل شاشة تبدأ بصفٍّ واحد
 * فيه كل ما يُفعل بها (إضافة، تعديل، حذف، تحديث، طباعة، وما يخصّها)، فيجد
 * الموظّف الأمر في المكان نفسه من كل شاشة بلا بحث.
 *
 * **الأزرار المعطَّلة تُخفى لا تُعرَض رماديّة.** زرٌّ لا يعمل لأنّ الصلاحية
 * ناقصة يعلّم الموظّف أن يجرّبه كل مرّة؛ وغيابه يقول الحقيقة من أوّل نظرة.
 */

export type ToolbarItem =
  | {
      key: string;
      label: string;
      icon?: LucideIcon;
      onClick: () => void;
      /** اللون: افتراضيّ، أو أحمر للحذف */
      tone?: "default" | "danger";
      disabled?: boolean;
      hidden?: boolean;
      title?: string;
    }
  | { key: string; separator: true };

export function ScreenToolbar({
  items,
  className,
  children,
}: {
  items: ToolbarItem[];
  className?: string;
  /** يُلحَق في الطرف المقابل — قائمة حالة أو مربّع بحث */
  children?: React.ReactNode;
}) {
  const visible = items.filter((item) => ("separator" in item ? true : !item.hidden));
  // فاصلٌ في الطرف أو فاصلان متتاليان بعد إخفاء زرّ: يُنظَّفان
  const cleaned = visible.filter((item, index) => {
    if (!("separator" in item)) return true;
    const prev = visible[index - 1];
    const next = visible[index + 1];
    if (!prev || !next) return false;
    return !("separator" in prev);
  });

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 px-2 py-1.5",
        className,
      )}
    >
      {cleaned.map((item) =>
        "separator" in item ? (
          <span key={item.key} className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
        ) : (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            disabled={item.disabled}
            title={item.title ?? item.label}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
              "hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40",
              item.tone === "danger" ? "text-destructive hover:bg-destructive/10" : "text-foreground",
            )}
          >
            {item.icon && <item.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {item.label}
          </button>
        ),
      )}
      {children && <div className="ms-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * عدّاد الصفوف أسفل الشبكة — مربّع صغير كما في الشاشات المرجعية.
 * وجوده يجيب عن سؤالٍ يُطرح في كل شاشة: هل هذه كل النتائج أم بقي ما لم يُحمَّل؟
 */
export function GridFooterCount({
  count,
  capped,
  className,
}: {
  count: number;
  /** صحيحٌ حين بلغت النتائج سقف التحميل، فالرقم ليس الإجمالي */
  capped?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 border-t bg-muted/30 px-3 py-1.5", className)}>
      <span className="rounded border bg-background px-3 py-0.5 font-mono text-xs">{count}</span>
      <span className="text-xs text-muted-foreground">
        {capped ? "صفًّا — بلغت الحدّ الأقصى للعرض، ضيّق البحث" : "صفًّا"}
      </span>
    </div>
  );
}
