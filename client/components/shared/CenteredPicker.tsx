import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type PickerOption = {
  value: string;
  label: string;
  /** سطرٌ ثانٍ صغير تحت الاسم. */
  hint?: string;
  disabled?: boolean;
};

/** قيمة العنصر المحيَّد («بدون») — لا يُعاد للمستدعي إلّا `""`. */
const CLEAR = "__clear__";

/** تطبيعٌ عربيّ بسيط للبحث: الهمزات والتاء المربوطة والياء. */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();

/**
 * قائمة اختيارٍ تُفتح **نافذةً في منتصف الشاشة** لا قائمةً منسدلة.
 *
 * القائمة المنسدلة الطويلة (طرق الدفع، الجنسيات) كانت تُغطّي الحقول التي
 * حولها وتتمرّر وحدها حين يمرّ المؤشّر على سهميها — فيفوت المستخدمَ العنصر
 * الذي يريده. هنا:
 *   * النافذة في منتصف الشاشة فوق كلّ شيء، بعنوانها.
 *   * سهما ▲ ▼ **يدويّان**: كلّ ضغطة تنقل صفحة، ولا تمرير تلقائيّ عند المرور.
 *   * عجلة الفأرة واللمس يعملان كالعادة، ومربّع بحثٍ للقوائم الطويلة.
 */
export default function CenteredPicker({
  value,
  onChange,
  options,
  placeholder = "اختر...",
  title,
  description,
  allowClear = false,
  clearLabel = "بدون",
  disabled = false,
  triggerClassName,
  searchable,
  loading = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  placeholder?: string;
  /** عنوان النافذة — اسم الحقل. */
  title: string;
  description?: string;
  allowClear?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  /** مربّع البحث — يظهر تلقائيًّا حين تزيد الخيارات على عشرة. */
  searchable?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ top: true, bottom: true });
  const selected = options.find((option) => option.value === value) ?? null;
  const showSearch = searchable ?? options.length > 10;

  const visible = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return options;
    return options.filter((option) => normalize(`${option.label} ${option.hint ?? ""}`).includes(needle));
  }, [options, query]);

  const updateEdges = () => {
    const list = listRef.current;
    if (!list) return;
    setEdges({
      top: list.scrollTop <= 2,
      bottom: list.scrollTop + list.clientHeight >= list.scrollHeight - 2,
    });
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    // عند الفتح: يُعرض العنصر المختار في مكانه من القائمة
    const timer = window.setTimeout(() => {
      const list = listRef.current;
      const current = list?.querySelector<HTMLElement>("[data-selected='true']");
      if (list && current) list.scrollTop = Math.max(0, current.offsetTop - list.clientHeight / 2);
      updateEdges();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    updateEdges();
  }, [visible.length]);

  /** ضغطةٌ واحدة = صفحةٌ تقريبًا، ولا شيء يتحرّك وحده. */
  const page = (direction: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({ top: direction * Math.max(80, list.clientHeight * 0.8), behavior: "smooth" });
  };

  const pick = (next: string) => {
    onChange(next === CLEAR ? "" : next);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-start text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          triggerClassName,
        )}
      >
        <span className={cn("line-clamp-1", !selected && "text-muted-foreground")}>
          {selected ? selected.label : loading ? "جارٍ التحميل..." : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          {showSearch && (
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث بالاسم..."
                className="ps-8"
              />
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={edges.top}
            onClick={() => page(-1)}
            aria-label="للأعلى"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>

          <div
            ref={listRef}
            onScroll={updateEdges}
            className="min-h-[8rem] flex-1 overflow-y-auto rounded-md border p-1"
            style={{ maxHeight: "50vh" }}
            role="listbox"
          >
            {allowClear && !query && (
              <button
                type="button"
                data-selected={!value}
                onClick={() => pick(CLEAR)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-3 py-2.5 text-start text-sm text-muted-foreground hover:bg-accent",
                  !value && "bg-primary/10 font-medium text-foreground",
                )}
              >
                <span className="w-4">{!value && <Check className="h-4 w-4" />}</span>
                {clearLabel}
              </button>
            )}
            {visible.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected}
                  disabled={option.disabled}
                  onClick={() => pick(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-3 py-2.5 text-start text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
                    isSelected && "bg-primary/10 font-medium",
                  )}
                >
                  <span className="w-4 shrink-0">{isSelected && <Check className="h-4 w-4 text-primary" />}</span>
                  <span className="flex min-w-0 flex-col">
                    <span>{option.label}</span>
                    {option.hint && <span className="text-xs text-muted-foreground">{option.hint}</span>}
                  </span>
                </button>
              );
            })}
            {visible.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {loading ? "جارٍ التحميل..." : query ? "لا نتيجة بهذا البحث" : "لا خيارات"}
              </p>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={edges.bottom}
            onClick={() => page(1)}
            aria-label="للأسفل"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
