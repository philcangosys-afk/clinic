import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * قيم لائحة مرجعية بمفتاحها — العامة وقيم المؤسسة معًا.
 *
 * الفئات المزروعة عامة (`organization_id is null`)، والمؤسسة تُخصّص بإنشاء
 * فئة بنفس `key` ومعرّفها (نمط 0003) — فبدون هذا الجمع كانت القيم التي
 * تضيفها المؤسسة لا تظهر في أي قائمة منسدلة في النظام إطلاقًا.
 *
 * التقييد بمعرّف المؤسسة صراحةً (مع RLS) يمنع خلط قوائم منشأة أخرى إن كان
 * المستخدم عضوًا في أكثر من منشأة.
 */
export function useLookupValues(categoryKey: string) {
  const { organization } = useOrganizationAccess();
  return useQuery({
    queryKey: ["lookup-values", categoryKey, organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data: cats, error: catError } = await supabase
        .from("lookup_categories")
        .select("id")
        .eq("key", categoryKey)
        .or(`organization_id.is.null,organization_id.eq.${organization?.id}`);
      if (catError) throw catError;
      const ids = (cats ?? []).map((row: { id: string }) => row.id);
      if (ids.length === 0) return [] as { id: string; name_ar: string }[];
      const { data, error } = await supabase
        .from("lookup_values")
        .select("id, name_ar")
        .in("category_id", ids)
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });
}

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
  const options = useLookupValues(categoryKey);

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
