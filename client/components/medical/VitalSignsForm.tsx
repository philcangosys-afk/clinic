import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, Loader2, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * المفردات المغلقة للقياسات — نسخة الواجهة من `app_vital_measure_keys()`.
 * أيّ مفتاح هنا له حقلٌ في `patient_vital_signs`، وأيّ مفتاح خارجها ترفضه
 * القاعدة صراحةً. القائمتان تتطابقان عمدًا، والقاعدة هي الحكم.
 */
export const VITAL_MEASURES = [
  { key: "blood_pressure", label: "ضغط الدم", unit: "ملم زئبق", fields: ["blood_pressure_systolic", "blood_pressure_diastolic"] },
  { key: "heart_rate", label: "النبض", unit: "نبضة/دقيقة", fields: ["heart_rate"] },
  { key: "temperature", label: "الحرارة", unit: "°م", fields: ["temperature_celsius"] },
  { key: "respiratory_rate", label: "التنفس", unit: "نفس/دقيقة", fields: ["respiratory_rate"] },
  { key: "weight", label: "الوزن", unit: "كغ", fields: ["weight_kg"] },
  { key: "height", label: "الطول", unit: "سم", fields: ["height_cm"] },
  { key: "glucose", label: "السكر", unit: "ملغ/دل", fields: ["glucose_level"] },
] as const;

export const GENERAL_MEASURES = VITAL_MEASURES.filter((m) => m.key !== "glucose").map((m) => m.key);

type Values = Record<string, string>;

/**
 * نموذج تسجيل القياس.
 *
 * يعرض الحقول المطلوبة في الطلب فقط — طلبُ ستة قياسات وعرضُ سبعة يعني قياسًا
 * زائدًا أو حقلًا يبقى فارغًا بلا سبب. وبلا طلب يعرض الستة المعتادة، ويفتح
 * السكر بضغطة.
 *
 * **كتلة الجسم لا حقل لها**: عمودٌ مُولَّد في القاعدة يُحسب من الطول والوزن.
 * وضعُ حقلٍ لها هنا يعني رقمًا يُكتب ولا يُحفظ.
 */
export default function VitalSignsForm({
  patientId,
  requestId,
  doctorId,
  visitId,
  measures,
  onSaved,
}: {
  patientId: string;
  requestId?: string | null;
  doctorId?: string | null;
  visitId?: string | null;
  measures?: string[] | null;
  onSaved?: () => void;
}) {
  const { organization, branch } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>({});
  const [showGlucose, setShowGlucose] = useState(false);

  const active = useMemo(() => {
    const keys = measures && measures.length > 0 ? measures : [...GENERAL_MEASURES];
    const set = new Set<string>(keys);
    if (showGlucose) set.add("glucose");
    return VITAL_MEASURES.filter((m) => set.has(m.key));
  }, [measures, showGlucose]);

  const hasAny = Object.values(values).some((v) => String(v ?? "").trim() !== "");

  const bmiPreview = useMemo(() => {
    const h = Number(values.height_cm);
    const w = Number(values.weight_kg);
    if (!h || !w || h <= 0) return null;
    return (w / Math.pow(h / 100, 2)).toFixed(2);
  }, [values.height_cm, values.weight_kg]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = {};
      Object.entries(values).forEach(([k, v]) => {
        if (String(v ?? "").trim() !== "") payload[k] = String(v).trim();
      });
      const { data, error } = await supabase.rpc("app_record_vital_signs", {
        p_organization_id: organization!.id,
        p_patient_id: patientId,
        p_values: payload,
        p_request_id: requestId ?? null,
        p_visit_id: visitId ?? null,
        p_doctor_id: doctorId ?? null,
        p_branch_id: branch?.id ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast({
        title: "سُجّل القياس",
        description: doctorId ? "وصل لوحة الطبيب." : "حُفظ في ملف المريض.",
      });
      setValues({});
      queryClient.invalidateQueries({ queryKey: ["vitals-queue"] });
      queryClient.invalidateQueries({ queryKey: ["patient-vitals"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-vitals-inbox"] });
      onSaved?.();
    },
    onError: (err: any) =>
      toast({
        title: "تعذّر الحفظ",
        description: err?.message ?? "خطأ غير معروف",
        variant: "destructive",
      }),
  });

  const set = (field: string, v: string) => setValues((prev) => ({ ...prev, [field]: v }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {active.map((m) => (
          <div key={m.key} className="flex flex-col gap-1.5">
            <Label>
              {m.label}
              <span className="ms-1 text-xs font-normal text-muted-foreground">({m.unit})</span>
            </Label>
            {m.key === "blood_pressure" ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="انقباضي"
                  value={values.blood_pressure_systolic ?? ""}
                  onChange={(e) => set("blood_pressure_systolic", e.target.value)}
                />
                <span className="text-muted-foreground">/</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="انبساطي"
                  value={values.blood_pressure_diastolic ?? ""}
                  onChange={(e) => set("blood_pressure_diastolic", e.target.value)}
                />
              </div>
            ) : (
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={values[m.fields[0]] ?? ""}
                onChange={(e) => set(m.fields[0], e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {bmiPreview && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span>
            مؤشر كتلة الجسم: <strong className="tabular-nums">{bmiPreview}</strong>
          </span>
          <span className="text-xs text-muted-foreground">— تحسبه القاعدة عند الحفظ</span>
        </div>
      )}

      {!active.some((m) => m.key === "glucose") && (
        <button
          type="button"
          onClick={() => setShowGlucose(true)}
          className="self-start text-xs text-primary underline-offset-4 hover:underline"
        >
          + إضافة قياس السكر (يحتاج وخزة إصبع)
        </button>
      )}

      <Button className={cn("h-11")} disabled={!hasAny || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        حفظ القياس
        {doctorId ? " وإرساله للطبيب" : ""}
      </Button>
    </div>
  );
}
