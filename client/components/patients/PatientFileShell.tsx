import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * هيكل الملفّ الطبيّ — شريط هوية المريض، وقائمة أقسام على اليمين، ومنطقة محتوى.
 *
 * **لماذا قائمة جانبية بدل التبويبات:** الملفّ فيه عشرون قسمًا. التبويبات
 * الأفقية تلفّ على ثلاثة صفوف فيضيع القسم بين صفٍّ وصف، وتُخفي عن الطبيب أنّ
 * القسم موجود أصلًا. القائمة الرأسية تعرضها كلّها في نظرة واحدة وتُبقي موضع
 * كلٍّ منها ثابتًا، فتُحفظ في يد المستخدم بالتكرار لا بالبحث.
 *
 * **شريط الهوية ثابت فوق كل قسم:** الطبيب الذي يكتب وصفة يحتاج أن يرى الأمراض
 * المزمنة والحساسية والعمر وهو يكتبها — لا أن يعود إلى تبويب المعلومات ثمّ
 * يرجع. وما لا قيمة له يُحذف من الشريط: حقلٌ فارغ في شريطٍ دائم ضجيجٌ دائم.
 */

export type FileSectionItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** `action` تفتح نافذة ولا تغيّر القسم المعروض */
  kind?: "view" | "action";
  onAction?: () => void;
  hidden?: boolean;
  /** وسمٌ صغير بجانب الاسم — عدد أو حالة */
  badge?: string | number | null;
  /** لونٌ يميّز القسم في القائمة (0223: «التقارير الطبية» بنفسجيّ) */
  tone?: "violet";
};

export type FileSectionGroup = {
  key: string;
  label: string;
  items: FileSectionItem[];
};

export type IdentityField = {
  label: string;
  value: React.ReactNode;
  /** يُبرز بالأحمر — الأمراض المزمنة والحساسية والمتبقّي */
  alert?: boolean;
};

export function PatientIdentityStrip({
  fields,
  className,
}: {
  fields: IdentityField[];
  className?: string;
}) {
  // الحقل الفارغ يُحذف: شريطٌ دائم لا يحتمل حقلًا لا يقول شيئًا
  const shown = fields.filter(
    (field) => field.value !== null && field.value !== undefined && field.value !== "",
  );
  return (
    <div
      className={cn(
        "flex items-center gap-0 overflow-x-auto rounded-md border bg-muted/50 px-3 py-1.5 text-xs",
        className,
      )}
      dir="rtl"
    >
      {shown.map((field, index) => (
        <span key={field.label} className="flex shrink-0 items-center whitespace-nowrap">
          {index > 0 && <span className="mx-2 text-border">|</span>}
          <span className="text-muted-foreground">{field.label} :</span>
          <span className={cn("ms-1 font-semibold", field.alert && "text-rose-600")}>
            {field.value}
          </span>
        </span>
      ))}
    </div>
  );
}

export function PatientFileShell({
  identity,
  groups,
  active,
  onActiveChange,
  header,
  children,
}: {
  identity: IdentityField[];
  groups: FileSectionGroup[];
  active: string;
  onActiveChange: (key: string) => void;
  /** صفّ العنوان وأزراره فوق الشريط */
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="flex flex-col gap-2 p-3 sm:p-4">
      {header}
      <PatientIdentityStrip fields={identity} />

      <div className="flex flex-col gap-2 lg:flex-row-reverse lg:items-start">
        {/* القائمة على اليمين في RTL — flex-row-reverse يضعها أوّلًا بصريًّا */}
        <nav
          className="flex w-full shrink-0 flex-col gap-2 lg:sticky lg:top-2 lg:max-h-[calc(100vh-6rem)] lg:w-56 lg:overflow-y-auto"
          aria-label="أقسام الملفّ الطبي"
        >
          {groups.map((group) => {
            const items = group.items.filter((item) => !item.hidden);
            if (items.length === 0) return null;
            const isCollapsed = collapsed[group.key];
            return (
              <div key={group.key} className="rounded-md border bg-card">
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-semibold hover:bg-accent/50"
                  aria-expanded={!isCollapsed}
                >
                  <span>{group.label}</span>
                  {isCollapsed ? (
                    <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronsDownUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  )}
                </button>
                {!isCollapsed && (
                  <ul className="flex flex-col pb-1">
                    {items.map((item) => {
                      const isActive = item.kind !== "action" && item.key === active;
                      return (
                        <li key={item.key}>
                          <button
                            type="button"
                            onClick={() =>
                              item.kind === "action" ? item.onAction?.() : onActiveChange(item.key)
                            }
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "flex w-full items-center gap-2 border-e-2 px-3 py-1.5 text-start text-sm transition-colors",
                              isActive
                                ? "border-e-primary bg-accent font-semibold text-accent-foreground"
                                : "border-e-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                              item.tone === "violet" &&
                                (isActive
                                  ? "border-e-violet-600 bg-violet-100 text-violet-900"
                                  : "bg-violet-50 font-semibold text-violet-700 hover:bg-violet-100 hover:text-violet-900"),
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.badge !== null && item.badge !== undefined && item.badge !== "" && (
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                                {item.badge}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
