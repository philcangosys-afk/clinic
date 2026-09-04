import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Plus, TrendingUp, Info } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import RequestVitalsDialog from "@/components/medical/RequestVitalsDialog";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/**
 * المؤشرات الحيوية (لقطة 118 — "مخططات النمو والمتابعة").
 *
 * جدول `patient_vital_signs` موجود منذ 0006 بلا واجهة. القالب الطبي كان
 * يخزّن المؤشرات في `exam_data` كنص حر داخل jsonb — كافٍ لعرض الزيارة، لكن
 * لا يصلح للتتبّع: لا يمكن رسم منحنى ضغط عبر السنة من نص داخل jsonb.
 *
 * الآن تُكتب مهيكلةً تلقائيًا عند حفظ الزيارة (شاشة السجلات الطبية)، وتُقرأ
 * هنا مع منحنى بسيط. ويمكن تسجيل قياس مستقل بلا زيارة — قياس الممرضة عند
 * الاستقبال ليس زيارة طبية.
 */
type VitalRow = {
  id: string;
  recorded_at: string;
  heart_rate: number | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  temperature_celsius: number | null;
  glucose_level: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  bmi: number | null;
  respiratory_rate: number | null;
  visit_id: string | null;
};

type MetricKey = "heart_rate" | "blood_pressure_systolic" | "temperature_celsius" | "glucose_level" | "weight_kg" | "bmi";

const METRICS: { key: MetricKey; label: string; unit: string }[] = [
  { key: "blood_pressure_systolic", label: "الضغط الانقباضي", unit: "ملم زئبق" },
  { key: "heart_rate", label: "النبض", unit: "نبضة/دقيقة" },
  { key: "temperature_celsius", label: "الحرارة", unit: "°م" },
  { key: "glucose_level", label: "السكر", unit: "ملغ/دل" },
  { key: "weight_kg", label: "الوزن", unit: "كغ" },
  { key: "bmi", label: "مؤشر كتلة الجسم", unit: "" },
];

/**
 * النطاقات الطبيعية للبالغين — للتلوين التحذيري فقط.
 * لا تُستخدم للأطفال: نطاقاتهم تختلف جذريًا بالعمر، ولون تحذيري خاطئ على
 * قياس طفل سليم أسوأ من غياب اللون.
 */
const ADULT_RANGES: Partial<Record<MetricKey, [number, number]>> = {
  blood_pressure_systolic: [90, 140],
  heart_rate: [60, 100],
  temperature_celsius: [36, 37.5],
  glucose_level: [70, 140],
  bmi: [18.5, 25],
};

function useVitals(patientId: string) {
  return useQuery({
    queryKey: ["patient-vitals", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_vital_signs")
        .select(
          "id, recorded_at, heart_rate, blood_pressure_systolic, blood_pressure_diastolic, temperature_celsius, glucose_level, height_cm, weight_kg, bmi, respiratory_rate, visit_id",
        )
        // المريض ينتمي لمنشأة واحدة، فالتقييد به يكفي لعزل المؤسسات
        .eq("patient_id", patientId)
        .order("recorded_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as VitalRow[];
    },
  });
}

/**
 * منحنى مصغَّر بـ SVG خالص — بلا مكتبة رسم.
 *
 * إضافة مكتبة مخططات (~100KB) لأجل خط واحد في تبويب واحد كلفة يدفعها كل
 * مستخدم في كل زيارة للنظام. `polyline` في SVG تكفي تمامًا هنا.
 */
function Sparkline({ points, min, max }: { points: number[]; min: number; max: number }) {
  if (points.length < 2) return null;
  const width = 100;
  const height = 28;
  const span = max - min || 1;
  const coords = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * width;
      // المحور مقلوب: قيمة أعلى تعني y أصغر
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-24" preserveAspectRatio="none">
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        className="text-primary"
      />
    </svg>
  );
}

function NewVitalsDialog({
  open,
  onOpenChange,
  patientId,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session, organization, branch } = useOrganizationAccess();
  const [form, setForm] = useState<Record<string, string>>({});

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const num = (raw: string | undefined, label?: string, max?: number) => {
        if (!raw || !raw.trim()) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("كل القيم يجب أن تكون أرقامًا موجبة");
        /**
         * `bmi` عمود محسوب `numeric(5,2)`: طولٌ كُتب بالمتر (1.7) يجعل الحساب
         * يتجاوز السعة فيفشل الإدراج كله برسالة قاعدة بيانات غامضة. الرسالة
         * هنا تقول للمستخدم ما الخطأ بالضبط.
         */
        if (max !== undefined && parsed > max)
          throw new Error(`قيمة "${label ?? "الحقل"}" خارج المدى المعقول — تأكد من الوحدة`);
        return parsed;
      };
      const payload = {
        organization_id: organizationId,
        patient_id: patientId,
        heart_rate: num(form.heart_rate),
        blood_pressure_systolic: num(form.blood_pressure_systolic),
        blood_pressure_diastolic: num(form.blood_pressure_diastolic),
        temperature_celsius: num(form.temperature_celsius),
        glucose_level: num(form.glucose_level),
        height_cm: num(form.height_cm, "الطول (سم)", 300),
        weight_kg: num(form.weight_kg, "الوزن (كغ)", 700),
        respiratory_rate: num(form.respiratory_rate),
        // bmi عمود محسوب في القاعدة من الطول والوزن — لا يُكتب من هنا
        created_by: session?.user.id ?? null,
      };
      const hasValue = Object.entries(payload).some(
        ([key, value]) => !["organization_id", "patient_id", "created_by"].includes(key) && value !== null,
      );
      if (!hasValue) throw new Error("أدخل قياسًا واحدًا على الأقل");

      // التسجيل يمرّ بـ`app_record_vital_signs` لا بإدخالٍ مباشر: الدالّة تفحص
      // الصلاحية (`vitals.record`)، وتتحقّق أن المريض من هذه المنشأة، وترفض
      // القيم المستحيلة (ضغط 1200، انبساطي أعلى من الانقباضي)، وتُغلق الطلب
      // المعلّق إن وُجد وتُخطر الطبيب. الإدخال المباشر كان يتخطّى ذلك كلّه.
      const values: Record<string, string> = {};
      Object.entries(payload).forEach(([key, value]) => {
        if (["organization_id", "patient_id", "created_by"].includes(key)) return;
        if (value !== null && value !== undefined) values[key] = String(value);
      });
      const { error } = await supabase.rpc("app_record_vital_signs", {
        p_organization_id: organization?.id,
        p_patient_id: patientId,
        p_values: values,
        p_request_id: null,
        p_visit_id: null,
        p_doctor_id: null,
        p_branch_id: branch?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-vitals", patientId] });
      toast({ title: "تم تسجيل القياس" });
      setForm({});
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const fields: { key: string; label: string; step?: string }[] = [
    { key: "blood_pressure_systolic", label: "الضغط الانقباضي" },
    { key: "blood_pressure_diastolic", label: "الضغط الانبساطي" },
    { key: "heart_rate", label: "النبض" },
    { key: "temperature_celsius", label: "الحرارة (°م)", step: "0.1" },
    { key: "glucose_level", label: "السكر" },
    { key: "respiratory_rate", label: "معدل التنفس" },
    { key: "height_cm", label: "الطول (سم)", step: "0.1" },
    { key: "weight_kg", label: "الوزن (كغ)", step: "0.1" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تسجيل قياس جديد</DialogTitle>
          <DialogDescription>
            اترك ما لم يُقَس فارغًا — القيمة الفارغة تعني "لم يُقَس" لا "صفر"
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label>{field.label}</Label>
              <Input
                type="number"
                min={0}
                step={field.step ?? "1"}
                value={form[field.key] ?? ""}
                onChange={(e) => set(field.key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          مؤشر كتلة الجسم يُحسب تلقائيًا من الطول والوزن.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ القياس"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VitalsTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const vitals = useVitals(patientId);
  const [createOpen, setCreateOpen] = useState(false);

  const rows = vitals.data ?? [];
  // المنحنى يُقرأ من الأقدم للأحدث؛ الجدول مرتَّب بالعكس
  const chronological = [...rows].reverse();

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            المؤشرات الحيوية
          </CardTitle>
          <CardDescription>
            تُسجَّل تلقائيًا مع كل زيارة طبية، ويمكن تسجيل قياس مستقل هنا
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* الطلب والتسجيل جنبًا إلى جنب: الاستقبال يطلب ليصل المريض مقيسًا،
              ومن يقيس بنفسه يسجّل مباشرة. الفعلان مختلفان فلهما زرّان. */}
          <RequestVitalsDialog patientId={patientId} />
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            تسجيل قياس
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {vitals.isLoading && <Skeleton className="h-40 w-full" />}

        {!vitals.isLoading && rows.length === 0 && (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              لا توجد قياسات بعد. تُسجَّل تلقائيًا عند حفظ زيارة طبية يحتوي قالبها على قسم
              المؤشرات الحيوية، أو سجّل قياسًا مستقلًا من الزر أعلاه.
            </span>
          </div>
        )}

        {!vitals.isLoading && rows.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {METRICS.map((metric) => {
                const series = chronological
                  .map((row) => row[metric.key])
                  .filter((value): value is number => value != null)
                  .map(Number);
                if (series.length === 0) return null;
                const latest = series[series.length - 1];
                const previous = series.length > 1 ? series[series.length - 2] : null;
                const min = Math.min(...series);
                const max = Math.max(...series);
                const range = ADULT_RANGES[metric.key];
                const outOfRange = range ? latest < range[0] || latest > range[1] : false;
                const delta = previous != null ? latest - previous : null;

                return (
                  <div key={metric.key} className="flex flex-col gap-1 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{metric.label}</span>
                      {series.length > 1 && <Sparkline points={series} min={min} max={max} />}
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-xl font-bold tabular-nums ${outOfRange ? "text-amber-600" : ""}`}
                      >
                        {latest}
                      </span>
                      <span className="text-xs text-muted-foreground">{metric.unit}</span>
                      {delta != null && delta !== 0 && (
                        <span
                          className={`flex items-center gap-0.5 text-xs ${delta > 0 ? "text-rose-600" : "text-emerald-600"}`}
                        >
                          <TrendingUp className={`h-3 w-3 ${delta < 0 ? "rotate-180" : ""}`} />
                          {Math.abs(Number(delta.toFixed(1)))}
                        </span>
                      )}
                    </div>
                    {outOfRange && (
                      <span className="text-[10px] text-amber-700">خارج النطاق المعتاد للبالغين</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                التلوين التحذيري يستعمل نطاقات <strong>البالغين</strong> فقط. نطاقات الأطفال
                تختلف جذريًا بالعمر، فلا يُعتمد اللون في تقييم قياسات الأطفال.
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الضغط</TableHead>
                  <TableHead>النبض</TableHead>
                  <TableHead>الحرارة</TableHead>
                  <TableHead>السكر</TableHead>
                  <TableHead>التنفس</TableHead>
                  <TableHead>الطول</TableHead>
                  <TableHead>الوزن</TableHead>
                  <TableHead>كتلة الجسم</TableHead>
                  <TableHead>المصدر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.recorded_at).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.blood_pressure_systolic != null && row.blood_pressure_diastolic != null
                        ? `${row.blood_pressure_systolic}/${row.blood_pressure_diastolic}`
                        : row.blood_pressure_systolic ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.heart_rate ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.temperature_celsius ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.glucose_level ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.respiratory_rate ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.height_cm ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.weight_kg ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.bmi ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.visit_id ? "زيارة" : "قياس مستقل"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>

      {createOpen && (
        <NewVitalsDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          patientId={patientId}
          organizationId={organization?.id}
        />
      )}
    </Card>
  );
}
