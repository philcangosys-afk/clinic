import { useQuery } from "@tanstack/react-query";
import { Stethoscope, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BodyDiagramReadOnly, VIEW_LABELS, type BodyDiagramData } from "@/components/medical/BodyDiagram";

/**
 * عرض ما رُسم وسُجّل على لوحة الأسنان ومخطط الجسم في زيارة بعينها.
 *
 * سبب وجود هذا المكوّن: التدقيق الشامل للقطات الـ133 أثبت أن الجدولين
 * `dental_chart_entries` و`body_diagram_annotations` **للكتابة فقط** — لكلٍّ
 * منهما `.insert()` واحد في `MedicalRecords.tsx` ولا `.select()` في المشروع
 * كله. الطبيب يحدّد الأسنان ويكتب الإجراء والتخدير والمضاد الحيوي، أو يرسم
 * مواضع الآفات على مخطط الجسم، فيُحفظ كله في القاعدة ثم **لا يُعرض أبدًا**:
 * لا في الزيارة التالية، ولا في ملف المريض، ولا في أي تقرير.
 *
 * وهذا أسوأ من عدم الحفظ أصلًا: الطبيب يظن أن لديه مرجعًا للمقارنة في زيارة
 * المتابعة، فلا يجده — بينما البيانات موجودة في القاعدة طوال الوقت.
 *
 * لا يُعرض شيء إذا لم تُستخدم اللوحة في هذه الزيارة، فلا يتضخّم سجل الزيارات
 * ببطاقات فارغة.
 */

type DentalEntry = {
  id: string;
  tooth_numbers: string[] | null;
  tooth_type: string | null;
  procedure_done: string | null;
  complications: string | null;
  anesthesia: string | null;
  prophylactic_antibiotics: string | null;
  patient_family_education: string | null;
  is_xray: boolean;
  ortho_upper: boolean;
  ortho_lower: boolean;
  full_arch: boolean;
  note: string | null;
  diagnosis: { code: string; name_ar: string | null; name_en: string } | null;
};

type DiagramEntry = {
  id: string;
  diagram_view: string;
  annotation_data: { strokes?: BodyDiagramData["strokes"] } | null;
  note: string | null;
};

const TOOTH_TYPE_LABELS: Record<string, string> = {
  permanent: "دائمة",
  primary: "لبنية",
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || !value.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export default function VisitCanvasDetail({ visitId }: { visitId: string }) {
  const dental = useQuery({
    queryKey: ["visit-dental-chart", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_chart_entries")
        .select(
          "id, tooth_numbers, tooth_type, procedure_done, complications, anesthesia, prophylactic_antibiotics, patient_family_education, is_xray, ortho_upper, ortho_lower, full_arch, note, diagnosis:icd10_codes(code, name_ar, name_en)",
        )
        // الزيارة تنتمي لمنشأة واحدة، والوصول إليها محكوم بسياسة الزيارة نفسها
        .eq("visit_id", visitId);
      if (error) throw error;
      return (data ?? []) as unknown as DentalEntry[];
    },
  });

  const diagram = useQuery({
    queryKey: ["visit-body-diagram", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("body_diagram_annotations")
        .select("id, diagram_view, annotation_data, note")
        .eq("visit_id", visitId);
      if (error) throw error;
      return (data ?? []) as unknown as DiagramEntry[];
    },
  });

  if (dental.isLoading || diagram.isLoading) return <Skeleton className="h-16 w-full" />;

  const dentalRows = dental.data ?? [];
  const diagramRows = diagram.data ?? [];
  if (dentalRows.length === 0 && diagramRows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {dentalRows.map((entry) => (
        <div key={entry.id} className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">لوحة الأسنان</span>
            {entry.tooth_type && (
              <Badge variant="outline" className="text-[10px]">
                {TOOTH_TYPE_LABELS[entry.tooth_type] ?? entry.tooth_type}
              </Badge>
            )}
            {entry.is_xray && <Badge variant="secondary" className="text-[10px]">أشعة</Badge>}
            {entry.full_arch && <Badge variant="secondary" className="text-[10px]">القوس كامل</Badge>}
            {entry.ortho_upper && <Badge variant="secondary" className="text-[10px]">تقويم علوي</Badge>}
            {entry.ortho_lower && <Badge variant="secondary" className="text-[10px]">تقويم سفلي</Badge>}
          </div>

          {(entry.tooth_numbers ?? []).length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {(entry.tooth_numbers ?? []).map((tooth) => (
                <Badge key={tooth} className="font-mono text-[10px]">
                  {tooth}
                </Badge>
              ))}
            </div>
          )}

          {entry.diagnosis && (
            <div className="mb-2 text-xs">
              <span className="text-muted-foreground">التشخيص: </span>
              <span className="font-mono">{entry.diagnosis.code}</span>
              <span> — {entry.diagnosis.name_ar ?? entry.diagnosis.name_en}</span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="الإجراء المنفَّذ" value={entry.procedure_done} />
            <Field label="التخدير" value={entry.anesthesia} />
            <Field label="المضاد الحيوي الوقائي" value={entry.prophylactic_antibiotics} />
            <Field label="المضاعفات" value={entry.complications} />
            <Field label="توعية المريض والأسرة" value={entry.patient_family_education} />
            <Field label="ملاحظة" value={entry.note} />
          </div>
        </div>
      ))}

      {diagramRows.map((entry) => {
        const strokes = entry.annotation_data?.strokes ?? [];
        return (
          <div key={entry.id} className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">مخطط الجسم</span>
              <Badge variant="outline" className="text-[10px]">
                {VIEW_LABELS[entry.diagram_view as keyof typeof VIEW_LABELS] ?? entry.diagram_view}
              </Badge>
              <span className="text-[10px] text-muted-foreground">{strokes.length} علامة</span>
            </div>
            <BodyDiagramReadOnly
              value={{
                view: (entry.diagram_view as BodyDiagramData["view"]) ?? "front",
                strokes,
              }}
            />
            <Field label="ملاحظة" value={entry.note} />
          </div>
        );
      })}
    </div>
  );
}
