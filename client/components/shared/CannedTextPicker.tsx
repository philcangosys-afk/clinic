import { useQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * زر إدراج نص جاهز (لقطة 13).
 *
 * جدول `canned_texts` موجود منذ 0009 وله شاشة إدارة في المراسلات، لكن لم يكن
 * هناك أي مكان **يستهلك** هذه النصوص — فكان المستخدم يعرّف نصوصًا لا تظهر له
 * أبدًا حيث يحتاجها. هذا المكوّن هو المستهلك المشترك: يُوضع بجانب أي حقل نصّي
 * في الشاشة التي يخصّها `locationKey`.
 *
 * الإدراج **يُلحِق** بالنص الحالي ولا يستبدله: الاستبدال كان سيمحو ما كتبه
 * الطبيب بضغطة واحدة بلا تراجع.
 */
export type CannedTextLocation =
  | "dental_board"
  | "medical_reports"
  | "referral_report"
  | "derma_clinic"
  | "appointment_note"
  | "invoice_dosage_field"
  | "invoice_usage_field";

function useCannedTextsFor(organizationId: string | undefined, locationKey: CannedTextLocation) {
  return useQuery({
    queryKey: ["canned-texts-for", organizationId, locationKey],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canned_texts")
        .select("id, text_ar, text_en, sort_order")
        .eq("organization_id", organizationId)
        .eq("location_key", locationKey)
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as { id: string; text_ar: string; text_en: string | null }[];
    },
  });
}

/** يُلحِق النص الجديد بالقائم مع سطر فاصل، ويتجنّب سطرًا فارغًا في البداية. */
export function appendCannedText(current: string, addition: string) {
  const trimmed = current.trimEnd();
  return trimmed ? `${trimmed}\n${addition}` : addition;
}

export default function CannedTextPicker({
  locationKey,
  onInsert,
  label = "نص جاهز",
  size = "sm",
}: {
  locationKey: CannedTextLocation;
  onInsert: (text: string) => void;
  label?: string;
  size?: "sm" | "default";
}) {
  const { organization } = useOrganizationAccess();
  const texts = useCannedTextsFor(organization?.id, locationKey);
  const rows = texts.data ?? [];

  // لا يُعرض الزر إطلاقًا إن لم تكن هناك نصوص لهذا الموضع — زر يفتح قائمة
  // فارغة يوحي بعطل، بينما غيابه يعني ببساطة أنه لم تُعرَّف نصوص بعد.
  if (rows.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size={size} variant="outline">
          <MessageSquareText className="h-3.5 w-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
        {rows.map((row) => (
          <DropdownMenuItem
            key={row.id}
            className="whitespace-normal text-start"
            onSelect={() => onInsert(row.text_ar)}
          >
            {row.text_ar}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
