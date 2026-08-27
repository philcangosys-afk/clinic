import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * قائمة منسدلة عامة لأي لائحة مرجعية من lookup_values عبر مفتاح فئتها
 * (lookup_categories.key) — بدل تكرار استعلام نفس النمط في كل شاشة تحتاج
 * قائمة مرجعية (تخصصات، فئات أصناف، مصادر مرضى...).
 */
export default function LookupSelect({
  categoryKey,
  value,
  onChange,
  placeholder = "اختر...",
}: {
  categoryKey: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const options = useQuery({
    queryKey: ["lookup-values", categoryKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lookup_values")
        .select("id, name_ar, lookup_categories!inner(key)")
        .eq("lookup_categories.key", categoryKey)
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {(options.data ?? []).map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name_ar}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
