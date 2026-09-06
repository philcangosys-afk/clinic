import { useEffect, useState } from "react";
import { Search, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import type { PatientRow } from "@/lib/database.types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PatientSearchResult = Pick<PatientRow, "id" | "name_ar" | "name_en" | "mobile_number" | "file_number">;

/**
 * حقل بحث عن مريض موجود بالاسم أو رقم الجوال أو رقم الملف — يُستخدم في الاستقبال
 * والمواعيد والفوترة بدل تكرار منطق البحث في كل شاشة على حدة.
 */
export default function PatientPicker({
  onSelect,
  placeholder = "البحث بالاسم أو رقم الجوال أو رقم الملف...",
}: {
  onSelect: (patient: PatientSearchResult) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const { organization } = useOrganizationAccess();

  useEffect(() => {
    if (term.trim().length < 2 || !organization?.id) {
      setResults([]);
      setSearchError(null);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      const isNumeric = /^\d+$/.test(term.trim());
      /**
       * التقييد بالمؤسسة النشطة إلزامي: سياسة RLS تسمح بكل مؤسسة **ينتمي
       * إليها** المستخدم لا بالنشطة وحدها. بدونه كان طبيب عضو في عيادتين
       * يستطيع اختيار مريض العيادة B وهو يعمل في A، فيُكتب صف يربط مؤسسةً
       * بمريض ليس لها — ولا قيد في القاعدة يمنع ذلك.
       */
      const query = supabase
        .from("patients")
        .select("id, name_ar, name_en, mobile_number, file_number")
        .eq("organization_id", organization?.id)
        .limit(8);
      const { data, error } = isNumeric
        ? await query.or(`mobile_number.ilike.%${term.trim()}%,file_number.eq.${term.trim()}`)
        : await query.ilike("name_ar", `%${term.trim()}%`);
      /**
       * `error` كان مُهمَلًا فتُعرض «لا توجد نتائج مطابقة.» على فشلٍ لم يُبلَّغ عنه
       * (رفض RLS أو انقطاع) — نفيُ وجود المريض أخطر من رسالة خطأ: يدفع الموظّف
       * إلى إنشاء ملفّ ثانٍ لمريض موجود.
       */
      setSearchError(error ? error.message : null);
      setResults(error ? [] : ((data as PatientSearchResult[]) ?? []));
      setLoading(false);
    }, 300);
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
          placeholder={placeholder}
          className="h-7 border-0 p-0 shadow-none focus-visible:ring-0"
        />
      </div>
      {open && term.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
          {loading && <p className="px-3 py-2 text-xs text-muted-foreground">جارٍ البحث...</p>}
          {!loading && searchError && (
            <p className="px-3 py-2 text-xs text-destructive">
              تعذّر البحث — أعد المحاولة: {searchError}
            </p>
          )}
          {!loading && !searchError && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">لا توجد نتائج مطابقة.</p>
          )}
          {results.map((patient) => (
            <button
              key={patient.id}
              type="button"
              onClick={() => {
                onSelect(patient);
                setTerm(patient.name_ar);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-muted",
              )}
            >
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{patient.name_ar}</span>
              <span className="text-xs text-muted-foreground">
                #{patient.file_number} · {patient.mobile_number ?? "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
