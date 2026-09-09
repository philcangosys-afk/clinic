import { Filter, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  PATIENT_SEARCH_SCOPES,
  patientScopeLabel,
  patientSearchPlaceholder,
  type PatientSearchScope,
} from "@/lib/patient-search";

/**
 * حقل بحث المريض الموحَّد: مربّع نصّ وثلاثة أزرار صغيرة تحصر البحث.
 *
 * **لماذا أزرار لا قائمة منسدلة:** الموظّف في الاستقبال يبدّل بين الاسم والجوال
 * عشرات المرّات في الساعة. القائمة تكلّف ضغطتين ونظرة، والأزرار ضغطة واحدة
 * وحالتها ظاهرة بلا فتح.
 *
 * **الحالة الافتراضية: لا شيء مضغوط = البحث في الثلاثة معًا.** الضغط يحصر،
 * والضغط ثانيةً يعود للكلّ. ويمكن ضغط اثنين معًا. فالموظّف الذي لا يعرف هذه
 * الأزرار يبحث كما كان يبحث دائمًا، ومن يعرفها يستبعد الضجيج: رقمٌ من عشر
 * خانات يطابق هويةً وجوالًا معًا، وحصره بـ«الجوال» يحسم أيّهما يريد.
 */
export function PatientSearchInput({
  value,
  onChange,
  scopes,
  onScopesChange,
  placeholder,
  className,
  inputClassName,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  scopes: PatientSearchScope[];
  onScopesChange: (scopes: PatientSearchScope[]) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const toggle = (scope: PatientSearchScope) => {
    onScopesChange(scopes.includes(scope) ? scopes.filter((item) => item !== scope) : [...scopes, scope]);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className={cn("relative min-w-48 flex-1", inputClassName)}>
        <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? patientSearchPlaceholder(scopes)}
          className="pr-9"
          autoFocus={autoFocus}
          disabled={disabled}
          inputMode="search"
        />
      </div>
      <PatientSearchScopeChips scopes={scopes} onScopesChange={onScopesChange} disabled={disabled} onToggle={toggle} />
    </div>
  );
}

/**
 * الأزرار وحدها — لشاشةٍ رتّبت مربّع بحثها بنفسها ولا تريد تغيير تخطيطه.
 */
export function PatientSearchScopeChips({
  scopes,
  onScopesChange,
  disabled,
  onToggle,
  className,
}: {
  scopes: PatientSearchScope[];
  onScopesChange: (scopes: PatientSearchScope[]) => void;
  disabled?: boolean;
  onToggle?: (scope: PatientSearchScope) => void;
  className?: string;
}) {
  const toggle =
    onToggle ??
    ((scope: PatientSearchScope) =>
      onScopesChange(scopes.includes(scope) ? scopes.filter((item) => item !== scope) : [...scopes, scope]));

  const all = scopes.length === 0;

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      role="group"
      aria-label="نطاق البحث"
      title={all ? "البحث في الاسم والجوال والهوية — اضغط زرًّا لحصره" : undefined}
    >
      <Filter className={cn("h-3.5 w-3.5 shrink-0", all ? "text-muted-foreground/60" : "text-primary")} aria-hidden />
      {PATIENT_SEARCH_SCOPES.map((scope) => {
        const active = scopes.includes(scope);
        return (
          <button
            key={scope}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => toggle(scope)}
            title={active ? `البحث محصور بـ${patientScopeLabel[scope]} — اضغط للإلغاء` : `احصر البحث بـ${patientScopeLabel[scope]}`}
            className={cn(
              "h-7 rounded-md border px-2 text-xs font-medium transition-colors disabled:opacity-50",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {patientScopeLabel[scope]}
          </button>
        );
      })}
    </div>
  );
}
