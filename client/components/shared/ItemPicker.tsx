import { useEffect, useState } from "react";
import { Package, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import type { ItemRow } from "@/lib/database.types";
import { Input } from "@/components/ui/input";

type ItemSearchResult = Pick<ItemRow, "id" | "code" | "name_ar" | "price" | "is_vat_exempt">;

/**
 * حقل بحث عن صنف/خدمة من كتالوج items لإضافته كبند في الفاتورة — بدل تكرار
 * منطق البحث في كل شاشة فوترة على حدة.
 */
export default function ItemPicker({ onSelect }: { onSelect: (item: ItemSearchResult) => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [open, setOpen] = useState(false);

  const { organization } = useOrganizationAccess();

  useEffect(() => {
    if (term.trim().length < 1 || !organization?.id) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      // التقييد بالمؤسسة النشطة: RLS يسمح بكل مؤسسة ينتمي إليها المستخدم،
      // فبدونه كان صنف مؤسسة أخرى يُضاف كبند في فاتورة هذه المؤسسة.
      const { data } = await supabase
        .from("items")
        .select("id, code, name_ar, price, is_vat_exempt")
        .eq("organization_id", organization.id)
        .eq("is_disabled", false)
        .or(`name_ar.ilike.%${term.trim()}%,code.ilike.%${term.trim()}%,barcode.ilike.%${term.trim()}%`)
        .limit(8);
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
      {open && term.trim().length >= 1 && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
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
              className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm hover:bg-muted"
            >
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{item.name_ar}</span>
              <span className="text-xs text-muted-foreground">{Number(item.price).toLocaleString("ar-SA")} ر.س</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
