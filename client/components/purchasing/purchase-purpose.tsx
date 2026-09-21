import { createContext, useContext, type ReactNode } from "react";
import { Pill, Stethoscope, Building2, CircleHelp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * جهة الشراء (0177) — لمن يُشترى هذا؟
 *
 * ثلاث جهات يعرفها كلّ مركز: أدوية الصيدلية، ومستلزمات العيادات والأطباء،
 * ومشتريات الإدارة. تُختار مرّةً في طلب الشراء، ثمّ ترثها المستندات بعده
 * (الأمر، والاستلام، والفاتورة، والمرتجع) — والقاعدة تمنع أن يدخل شراءٌ
 * مستودعًا مخصّصًا لجهةٍ أخرى.
 */

export type PurchasePurpose = "pharmacy" | "medical" | "administrative";
export type WarehousePurpose = PurchasePurpose | "general";

export const PURCHASE_PURPOSES: {
  key: PurchasePurpose;
  label: string;
  hint: string;
  icon: LucideIcon;
  badge: string;
}[] = [
  {
    key: "pharmacy",
    label: "الصيدلية",
    hint: "أدوية ومستحضرات تُصرف أو تُباع من الصيدلية",
    icon: Pill,
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  {
    key: "medical",
    label: "المستلزمات الطبية",
    hint: "ما تستهلكه العيادات والأطباء: قفّازات، إبر، مواد أسنان، محاليل",
    icon: Stethoscope,
    badge: "bg-sky-100 text-sky-800 border-sky-200",
  },
  {
    key: "administrative",
    label: "المشتريات الإدارية",
    hint: "قرطاسية، نظافة، ضيافة، أجهزة مكتبية",
    icon: Building2,
    badge: "bg-violet-100 text-violet-800 border-violet-200",
  },
];

export const WAREHOUSE_PURPOSE_LABELS: Record<WarehousePurpose, string> = {
  general: "عام — يقبل كلّ الجهات",
  pharmacy: "مستودع الصيدلية",
  medical: "مستودع المستلزمات الطبية",
  administrative: "مستودع إداري",
};

const BY_KEY = new Map(PURCHASE_PURPOSES.map((p) => [p.key, p]));

export function purposeLabel(purpose: string | null | undefined): string {
  return (purpose && BY_KEY.get(purpose as PurchasePurpose)?.label) || "غير مصنّف";
}

/** هل يقبل هذا المستودع شراءً لهذه الجهة؟ — الشرط نفسه الذي تفرضه القاعدة. */
export function warehouseAccepts(
  warehousePurpose: string | null | undefined,
  purpose: string | null | undefined,
): boolean {
  if (!purpose) return true;
  return !warehousePurpose || warehousePurpose === "general" || warehousePurpose === purpose;
}

export function PurposeBadge({ purpose, className }: { purpose: string | null | undefined; className?: string }) {
  const meta = purpose ? BY_KEY.get(purpose as PurchasePurpose) : undefined;
  const Icon = meta?.icon ?? CircleHelp;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        meta?.badge ?? "border-dashed bg-muted text-muted-foreground",
        className,
      )}
      title={meta?.hint ?? "مستندٌ سبق تصنيف الجهات — لا جهة له"}
    >
      <Icon className="h-3 w-3" />
      {meta?.label ?? "غير مصنّف"}
    </span>
  );
}

/** اختيار الجهة بأزرارٍ ظاهرة لا بقائمةٍ منسدلة — ثلاثة خيارات تُرى معًا. */
export function PurposePicker({
  value,
  onChange,
  disabled,
}: {
  value: PurchasePurpose | "";
  onChange: (next: PurchasePurpose) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="جهة الشراء">
      {PURCHASE_PURPOSES.map((p) => {
        const active = value === p.key;
        const Icon = p.icon;
        return (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(p.key)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-md border p-2 text-start transition-colors",
              active ? cn(p.badge, "ring-2 ring-primary/40") : "hover:bg-muted",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon className="h-4 w-4" />
              {p.label}
            </span>
            <span className="text-[11px] leading-4 text-muted-foreground">{p.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── تصفية الشاشة بالجهة ─────────────────────────────────────────────────── */

export type PurposeFilterValue = "all" | PurchasePurpose | "unclassified";

const PurposeFilterContext = createContext<PurposeFilterValue>("all");

export function PurposeFilterProvider({ value, children }: { value: PurposeFilterValue; children: ReactNode }) {
  return <PurposeFilterContext.Provider value={value}>{children}</PurposeFilterContext.Provider>;
}

export function usePurposeFilter() {
  return useContext(PurposeFilterContext);
}

/** يطابق صفًّا بمرشّح الجهة المختار أعلى الشاشة. */
export function matchesPurpose(filter: PurposeFilterValue, purpose: string | null | undefined): boolean {
  if (filter === "all") return true;
  if (filter === "unclassified") return !purpose;
  return purpose === filter;
}

export function PurposeFilterBar({
  value,
  onChange,
}: {
  value: PurposeFilterValue;
  onChange: (next: PurposeFilterValue) => void;
}) {
  const options: { key: PurposeFilterValue; label: string }[] = [
    { key: "all", label: "كلّ الجهات" },
    ...PURCHASE_PURPOSES.map((p) => ({ key: p.key as PurposeFilterValue, label: p.label })),
    { key: "unclassified", label: "غير مصنّف" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="تصفية بجهة الشراء">
      <span className="text-xs text-muted-foreground">الجهة:</span>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            value === o.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
