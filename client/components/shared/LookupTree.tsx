import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, FolderTree, Layers, Search } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { errorMessage } from "@/lib/error-message";
import { formatAmount } from "@/lib/locale";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * شجرة فئات من لائحة مرجعية — رئيسية وفرعية، ببحثها الخاصّ.
 *
 * تقرأ `lookup_values` بمفتاح فئتها وتبني المستويين من `parent_value_id`.
 * تُستعمل في كتالوج الأصناف والخدمات وشجرة الأدوية وأصناف المعمل — فئةٌ واحدة
 * تُدار في مكان واحد، لا شجرة تُكتب من جديد في كل شاشة.
 *
 * **الفئة المعطَّلة تظهر ومشطوبة، لا تُخفى:** أصنافٌ قديمة ما زالت مرتبطة بها،
 * وإخفاؤها من الشجرة يجعل تلك الأصناف غير قابلة للوصول — يراها الموظّف في
 * «كل الأصناف» ولا يجد الفئة التي تصفّيها.
 */

export type LookupTreeNode = {
  id: string;
  name_ar: string;
  name_en: string | null;
  code: string | null;
  parent_value_id: string | null;
  is_disabled: boolean;
  sort_order: number | null;
};

export function useLookupTree(categoryKey: string) {
  const { organization } = useOrganizationAccess();
  return useQuery({
    queryKey: ["lookup-tree", categoryKey, organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data: cats, error: catError } = await supabase
        .from("lookup_categories")
        .select("id")
        .eq("key", categoryKey)
        .or(`organization_id.is.null,organization_id.eq.${organization?.id}`);
      if (catError) throw catError;
      const ids = (cats ?? []).map((row: { id: string }) => row.id);
      if (ids.length === 0) return [] as LookupTreeNode[];
      const { data, error } = await supabase
        .from("lookup_values")
        .select("id, name_ar, name_en, code, parent_value_id, is_disabled, sort_order")
        .in("category_id", ids)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as LookupTreeNode[];
    },
  });
}

/**
 * فئةٌ وكلّ ما تحتها.
 *
 * الضغط على فئة رئيسية يجب أن يعرض أصناف فروعها أيضًا: الأصناف تُسجَّل على
 * الفرع غالبًا لا على الأمّ، فترشيحٌ بمساواةٍ حرفية يُظهر شبكةً فارغة تحت فئة
 * مليئة، فيظنّ الموظّف أنّها بلا أصناف.
 *
 * تُعيد دالّة: تُعطى معرّف فئة فتُعيد معرّفها ومعرّفات فروعها كلّها، ولائحةً
 * فارغة إن أُعطيت "" — أي «الكل»، فلا ترشيح.
 */
export function useCategorySubtree(categoryKey: string) {
  const nodes = useLookupTree(categoryKey);
  return useMemo(() => {
    const rows = nodes.data ?? [];
    const childrenOf = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.parent_value_id) continue;
      const list = childrenOf.get(row.parent_value_id) ?? [];
      list.push(row.id);
      childrenOf.set(row.parent_value_id, list);
    }
    return (rootId: string): string[] => {
      if (!rootId) return [];
      const out: string[] = [];
      const seen = new Set<string>();
      const stack = [rootId];
      while (stack.length > 0) {
        const id = stack.pop() as string;
        // حارسٌ ضدّ حلقة في بيانات الفئات: بياناتٌ خاطئة لا تُجمّد المتصفّح
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        for (const child of childrenOf.get(id) ?? []) stack.push(child);
      }
      return out;
    };
  }, [nodes.data]);
}

export function LookupTree({
  categoryKey,
  value,
  onChange,
  allLabel = "كل الفئات",
  /** عدد العناصر تحت كل فئة — يُعرض بجانب اسمها */
  counts,
  totalCount,
  className,
}: {
  categoryKey: string;
  /** معرّف الفئة المختارة، أو "" للكل */
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
  counts?: Record<string, number>;
  totalCount?: number;
  className?: string;
}) {
  const nodes = useLookupTree(categoryKey);
  const [term, setTerm] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { roots, childrenOf, matches } = useMemo(() => {
    const rows = nodes.data ?? [];
    const childrenOf = new Map<string, LookupTreeNode[]>();
    const roots: LookupTreeNode[] = [];
    for (const row of rows) {
      if (row.parent_value_id) {
        const list = childrenOf.get(row.parent_value_id) ?? [];
        list.push(row);
        childrenOf.set(row.parent_value_id, list);
      } else {
        roots.push(row);
      }
    }
    const needle = term.trim().toLowerCase();
    const matches = new Set<string>();
    if (needle) {
      const hit = (row: LookupTreeNode) =>
        [row.name_ar, row.name_en, row.code].some((v) => (v ?? "").toLowerCase().includes(needle));
      for (const row of rows) {
        if (!hit(row)) continue;
        matches.add(row.id);
        // الأب يظهر ليظهر ابنه — وإلّا رأى الموظّف نتيجة بلا سياقها
        let parent = row.parent_value_id;
        while (parent) {
          matches.add(parent);
          parent = rows.find((r) => r.id === parent)?.parent_value_id ?? null;
        }
      }
    }
    return { roots, childrenOf, matches };
  }, [nodes.data, term]);

  const searching = term.trim().length > 0;
  const visible = (row: LookupTreeNode) => !searching || matches.has(row.id);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="shrink-0 border-b p-2">
        <div className="relative">
          <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="بحث في الفئات..."
            className="h-8 pr-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {nodes.isLoading && <Skeleton className="m-2 h-32" />}
        {nodes.isError && (
          <p className="p-3 text-xs text-destructive">تعذّر تحميل الفئات: {errorMessage(nodes.error)}</p>
        )}

        <TreeRow
          label={allLabel}
          icon={Layers}
          active={value === ""}
          onClick={() => onChange("")}
          count={totalCount}
          depth={0}
        />

        {roots.filter(visible).map((root) => {
          const kids = (childrenOf.get(root.id) ?? []).filter(visible);
          const isCollapsed = !searching && collapsed[root.id];
          return (
            <div key={root.id}>
              <TreeRow
                label={root.name_ar}
                icon={FolderTree}
                active={value === root.id}
                disabled={root.is_disabled}
                onClick={() => onChange(root.id)}
                count={counts?.[root.id]}
                depth={0}
                expandable={kids.length > 0}
                collapsed={isCollapsed}
                onToggle={() => setCollapsed((prev) => ({ ...prev, [root.id]: !prev[root.id] }))}
              />
              {!isCollapsed &&
                kids.map((child) => (
                  <TreeRow
                    key={child.id}
                    label={child.name_ar}
                    active={value === child.id}
                    disabled={child.is_disabled}
                    onClick={() => onChange(child.id)}
                    count={counts?.[child.id]}
                    depth={1}
                  />
                ))}
            </div>
          );
        })}

        {!nodes.isLoading && roots.filter(visible).length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {searching ? "لا فئة مطابقة." : "لا فئات معرَّفة بعد."}
          </p>
        )}
      </div>
    </div>
  );
}

function TreeRow({
  label,
  icon: Icon,
  active,
  disabled,
  onClick,
  count,
  depth,
  expandable,
  collapsed,
  onToggle,
}: {
  label: string;
  icon?: typeof FolderTree;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  count?: number;
  depth: number;
  expandable?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
      style={{ paddingInlineStart: depth * 14 }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? "توسيع" : "طيّ"}
        >
          {collapsed ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="w-[22px] shrink-0" aria-hidden />
      )}
      <button
        type="button"
        onClick={onClick}
        title={disabled ? `${label} — فئة معطَّلة` : label}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pe-2 text-start text-xs",
          active ? "font-semibold" : "text-muted-foreground hover:text-foreground",
          disabled && "line-through opacity-60",
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {formatAmount(count)}
          </span>
        )}
      </button>
    </div>
  );
}
