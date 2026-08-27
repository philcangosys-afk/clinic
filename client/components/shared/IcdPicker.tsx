import { useEffect, useState } from "react";
import { Search, Stethoscope, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Icd10Result = { id: string; code: string; name_ar: string | null; name_en: string };

/**
 * بحث وإضافة تشخيصات ICD10 متعددة لزيارة طبية — مرجع عالمي عام (من 0006)،
 * يُستخدم في شاشة السجل الطبي عند حفظ تشخيص الزيارة.
 */
export default function IcdPicker({
  selected,
  onChange,
}: {
  selected: Icd10Result[];
  onChange: (next: Icd10Result[]) => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Icd10Result[]>([]);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("icd10_codes")
        .select("id, code, name_ar, name_en")
        .or(`name_ar.ilike.%${term.trim()}%,name_en.ilike.%${term.trim()}%,code.ilike.%${term.trim()}%`)
        .eq("is_disabled", false)
        .limit(8);
      setResults((data as Icd10Result[]) ?? []);
    }, 250);
    return () => clearTimeout(handle);
  }, [term]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="بحث بكود ICD10 أو اسم التشخيص..."
            className="h-7 border-0 p-0 shadow-none focus-visible:ring-0"
          />
        </div>
        {results.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
            {results.map((code) => (
              <button
                key={code.id}
                type="button"
                onClick={() => {
                  if (!selected.some((item) => item.id === code.id)) onChange([...selected, code]);
                  setTerm("");
                  setResults([]);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm hover:bg-muted"
              >
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{code.name_ar ?? code.name_en}</span>
                <span className="font-mono text-xs text-muted-foreground">{code.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((code) => (
            <Badge key={code.id} variant="secondary" className="gap-1">
              {code.name_ar ?? code.name_en} ({code.code})
              <button type="button" onClick={() => onChange(selected.filter((item) => item.id !== code.id))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
