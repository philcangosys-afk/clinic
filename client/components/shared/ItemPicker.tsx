import { useEffect, useState } from "react";
import { Package, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { localName, useLocaleSettings } from "@/lib/locale";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import type { ItemRow } from "@/lib/database.types";
import { Input } from "@/components/ui/input";

type ItemSearchResult = Pick<ItemRow, "id" | "code" | "name_ar" | "price" | "is_vat_exempt"> & {
  name_en?: string | null;
};

/**
 * حقل بحث عن صنف/خدمة من كتالوج items لإضافته كبند في الفاتورة — بدل تكرار
 * منطق البحث في كل شاشة فوترة على حدة.
 */
/**
 * تهريب مصطلح البحث قبل تركيبه في مُرشِّح `or`.
 *
 * الفاصلة والقوس والنقطة أحرف بنيوية في نحو PostgREST: مصطلح مثل «حقن (وريدي)»
 * كان يفسد المُرشِّح فيفشل الاستعلام كلّه. القيمة بين علامتي تنصيص مزدوج تُقرأ
 * حرفيًّا، والتنصيص والشرطة المائلة داخلها تُهرَّبان بشرطة مائلة.
 */
function quoteOrPattern(term: string) {
  return `"%${term.replace(/[\\"]/g, (ch) => `\\${ch}`)}%"`;
}

/**
 * صنفٌ نشط اسمه أو كوده يطابق أحد النصوص حرفيًّا — وإلّا `null` (0223).
 *
 * يُستعمل حين يكتب المستخدم اسم الخدمة في حقل البحث دون أن يضغط عليها من
 * القائمة: إن طابق صنفًا واحدًا بعينه رُبط به، ولا يُخمَّن عند التعدّد.
 */
export async function findItemByExactName(
  organizationId: string,
  names: string[],
): Promise<{ id: string; name_ar: string } | null> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  for (const name of wanted) {
    for (const column of ["name_ar", "code"] as const) {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .eq(column, name)
        .limit(2);
      if (error) throw error;
      if (data && data.length === 1) return data[0] as { id: string; name_ar: string };
    }
  }
  return null;
}

export default function ItemPicker({
  onSelect,
  inline = false,
  onTermChange,
}: {
  onSelect: (item: ItemSearchResult) => void;
  /**
   * النتائج داخل تدفّق الصفحة لا طافيةً فوقها — داخل نافذةٍ لها تمرير
   * (`max-h-[90vh] overflow-y-auto`) كانت القائمة الطافية تُقصّ تحت أسفل
   * النافذة فلا تُرى، فيبقى الاسم مكتوبًا في الخانة ولا يُختار شيء (0223).
   */
  inline?: boolean;
  /** النصّ المكتوب ولم يُختر بعد — لتنبيه النافذة أو ربطه بالمطابقة الحرفية */
  onTermChange?: (term: string) => void;
}) {
  const { dataLanguage } = useLocaleSettings();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // اكتمل بحثُ النصّ الحالي — لعرض «لا توجد نتيجة» بدل قائمةٍ صامتة
  const [searched, setSearched] = useState(false);

  const { organization } = useOrganizationAccess();

  useEffect(() => {
    if (term.trim().length < 1 || !organization?.id) {
      setResults([]);
      setSearchError(null);
      setSearched(false);
      return;
    }
    const handle = setTimeout(async () => {
      // التقييد بالمؤسسة النشطة: RLS يسمح بكل مؤسسة ينتمي إليها المستخدم،
      // فبدونه كان صنف مؤسسة أخرى يُضاف كبند في فاتورة هذه المؤسسة.
      const raw = term.trim();
      const pattern = quoteOrPattern(raw);
      /**
       * الكود أوّلًا، ثم البحث العامّ.
       *
       * البحث العامّ يُرجع ثمانية صفوف بلا ترتيب، فكتابة كود قصير مثل «12»
       * كانت تُرجع كل صنف يحوي «12» في اسمه أو باركوده — وقد لا يكون الصنف
       * صاحب الكود بينها أصلًا. والاستقبال يبحث بالكود عند الفوترة، فمطابقته
       * الحرفية تُقدَّم على كل شيء بدل أن تضيع في القائمة.
       */
      const [exact, { data, error }] = await Promise.all([
        supabase
          .from("items")
          .select("id, code, name_ar, name_en, price, is_vat_exempt")
          .eq("organization_id", organization.id)
          .eq("is_disabled", false)
          .eq("is_archived", false)
          .eq("code", raw)
          .limit(3),
        supabase
          .from("items")
          .select("id, code, name_ar, name_en, price, is_vat_exempt")
          .eq("organization_id", organization.id)
          .eq("is_disabled", false)
          .eq("is_archived", false)
          // البحث يشمل الاسم الإنجليزي: من يعمل بالإنجليزية يبحث بها
          .or(`name_ar.ilike.${pattern},name_en.ilike.${pattern},code.ilike.${pattern},barcode.ilike.${pattern}`)
          .order("code")
          .limit(12),
      ]);
      /**
       * فشل الاستعلام كان مكتومًا تمامًا: `error` مُهمَل والقائمة تظهر فارغة،
       * فيستنتج الموظّف أن الصنف غير موجود — فيُنشئ صنفًا مكرَّرًا أو يترك العرض
       * بلا أصناف (وعرضٌ بلا أصناف مع `applies_to_all_items = false` لا يُطبَّق
       * على شيء). الخطأ يُعرض الآن برسالة القاعدة بدل نفي الوجود.
       */
      if (error) {
        setSearchError(error.message);
        setResults([]);
        setSearched(true);
        return;
      }
      setSearchError(null);
      const exactRows = (exact.data as ItemSearchResult[]) ?? [];
      const rest = ((data as ItemSearchResult[]) ?? []).filter(
        (row) => !exactRows.some((hit) => hit.id === row.id),
      );
      setResults([...exactRows, ...rest].slice(0, 12));
      setSearched(true);
    }, 250);
    return () => clearTimeout(handle);
  }, [term, organization?.id]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setSearched(false);
            setOpen(true);
            onTermChange?.(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          placeholder="البحث عن صنف أو خدمة بالاسم أو الكود..."
          className="h-7 border-0 p-0 shadow-none focus-visible:ring-0"
        />
      </div>
      {open && term.trim().length >= 1 && (searchError || results.length > 0 || searched) && (
        <div
          className={
            inline
              ? "mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover"
              : "absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg"
          }
        >
          {searchError && (
            <p className="px-3 py-2 text-xs text-destructive">
              تعذّر البحث — أعد المحاولة: {searchError}
            </p>
          )}
          {!searchError && searched && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              لا توجد خدمة نشطة بهذا الاسم أو الكود — أضفها من شاشة الخدمات أولًا.
            </p>
          )}
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item);
                setTerm("");
                setResults([]);
                setSearched(false);
                setOpen(false);
                onTermChange?.("");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
            >
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{localName(item, dataLanguage)}</span>
              <span className="text-xs text-muted-foreground">{Number(item.price).toLocaleString("ar-SA-u-nu-latn")} ر.س</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
