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

export default function ItemPicker({ onSelect }: { onSelect: (item: ItemSearchResult) => void }) {
  const { dataLanguage } = useLocaleSettings();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const { organization } = useOrganizationAccess();

  useEffect(() => {
    if (term.trim().length < 1 || !organization?.id) {
      setResults([]);
      setSearchError(null);
      return;
    }
    const handle = setTimeout(async () => {
      // التقييد بالمؤسسة النشطة: RLS يسمح بكل مؤسسة ينتمي إليها المستخدم،
      // فبدونه كان صنف مؤسسة أخرى يُضاف كبند في فاتورة هذه المؤسسة.
      const pattern = quoteOrPattern(term.trim());
      const { data, error } = await supabase
        .from("items")
        .select("id, code, name_ar, name_en, price, is_vat_exempt")
        .eq("organization_id", organization.id)
        .eq("is_disabled", false)
        .eq("is_archived", false)
        // البحث يشمل الاسم الإنجليزي: من يعمل بالإنجليزية يبحث بها
        .or(`name_ar.ilike.${pattern},name_en.ilike.${pattern},code.ilike.${pattern},barcode.ilike.${pattern}`)
        .limit(8);
      /**
       * فشل الاستعلام كان مكتومًا تمامًا: `error` مُهمَل والقائمة تظهر فارغة،
       * فيستنتج الموظّف أن الصنف غير موجود — فيُنشئ صنفًا مكرَّرًا أو يترك العرض
       * بلا أصناف (وعرضٌ بلا أصناف مع `applies_to_all_items = false` لا يُطبَّق
       * على شيء). الخطأ يُعرض الآن برسالة القاعدة بدل نفي الوجود.
       */
      if (error) {
        setSearchError(error.message);
        setResults([]);
        return;
      }
      setSearchError(null);
      setResults((data as ItemSearchResult[]) ?? []);
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
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="البحث عن صنف أو خدمة بالاسم أو الكود..."
          className="h-7 border-0 p-0 shadow-none focus-visible:ring-0"
        />
      </div>
      {open && term.trim().length >= 1 && (searchError || results.length > 0) && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
          {searchError && (
            <p className="px-3 py-2 text-xs text-destructive">
              تعذّر البحث — أعد المحاولة: {searchError}
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
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
            >
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{localName(item, dataLanguage)}</span>
              <span className="text-xs text-muted-foreground">{Number(item.price).toLocaleString("ar-SA")} ر.س</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
