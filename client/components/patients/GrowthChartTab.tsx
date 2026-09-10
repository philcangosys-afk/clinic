import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { formatAmount, formatDate, useLocaleSettings } from "@/lib/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";

/**
 * مخططات النمو والمتابعة.
 *
 * تُرسَم من `patient_vital_signs` نفسها التي تُدخلها شاشة المؤشرات الحيوية —
 * لا جدول ثانٍ ولا إدخال ثانٍ: قياسٌ يُكتب مرّتين يفترق، والمنحنى المرسوم من
 * نسخةٍ ثانية يخالف الجدول الذي بجانبه.
 *
 * **ما لا يُرسَم عمدًا: منحنيات المئينات المرجعية** (WHO/CDC). رسمها يستلزم
 * جداول مرجعية رسمية بحسب العمر والجنس، وتقريبُها بأرقام مخترعة يُنتج مئينًا
 * كاذبًا يُبنى عليه قرار طبيّ. فالمعروض هنا **مسار المريض نفسه عبر الزمن** —
 * وهو ما يكشف الانقطاع والانحدار — ويبقى وضعُه على المنحنى المرجعيّ بحاجة إلى
 * جدولٍ يُعتمد من المالك.
 */

type VitalRow = {
  id: string;
  recorded_at: string;
  height_cm: number | null;
  weight_kg: number | null;
  bmi: number | null;
  heart_rate: number | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
};

const METRICS = {
  height_cm: { label: "الطول (سم)", keys: ["height_cm"] as const },
  weight_kg: { label: "الوزن (كجم)", keys: ["weight_kg"] as const },
  bmi: { label: "معدّل كتلة الجسم", keys: ["bmi"] as const },
  blood_pressure: {
    label: "ضغط الدم",
    keys: ["blood_pressure_systolic", "blood_pressure_diastolic"] as const,
  },
} as const;

type MetricKey = keyof typeof METRICS;

const SERIES_LABELS: Record<string, string> = {
  height_cm: "الطول",
  weight_kg: "الوزن",
  bmi: "كتلة الجسم",
  blood_pressure_systolic: "الانقباضي",
  blood_pressure_diastolic: "الانبساطي",
};

const SERIES_COLORS: Record<string, string> = {
  height_cm: "#0284c7",
  weight_kg: "#059669",
  bmi: "#7c3aed",
  blood_pressure_systolic: "#dc2626",
  blood_pressure_diastolic: "#ea580c",
};

export default function GrowthChartTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const { calendarDisplay } = useLocaleSettings();
  const [metric, setMetric] = useState<MetricKey>("weight_kg");

  const vitals = useQuery({
    queryKey: ["growth-vitals", patientId, organization?.id],
    enabled: Boolean(patientId && organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_vital_signs")
        .select(
          "id, recorded_at, height_cm, weight_kg, bmi, heart_rate, blood_pressure_systolic, blood_pressure_diastolic",
        )
        .eq("organization_id", organization!.id)
        .eq("patient_id", patientId)
        .order("recorded_at", { ascending: true })
        .limit(400);
      if (error) throw error;
      return (data ?? []) as VitalRow[];
    },
  });

  const rows = vitals.data ?? [];
  const keys = METRICS[metric].keys;

  /* النقطة بلا قيمة تُحذف لا تُرسَم صفرًا: قياسٌ لم يُؤخذ ليس وزنًا صفرًا،
     ورسمُه يُنتج هبوطًا حادًّا لا وجود له. */
  const series = useMemo(
    () =>
      rows
        .filter((row) => keys.some((key) => row[key] !== null && row[key] !== undefined))
        .map((row) => {
          const point: Record<string, number | string | null> = {
            label: formatDate(row.recorded_at, "gregorian"),
          };
          for (const key of keys) point[key] = row[key] === null ? null : Number(row[key]);
          return point;
        }),
    [rows, keys],
  );

  const latest = rows.length > 0 ? rows[rows.length - 1] : null;

  return (
    <div className="flex flex-col gap-3">
      <ScreenToolbar
        items={[{ key: "refresh", label: "تحديث", icon: RefreshCw, onClick: () => void vitals.refetch() }]}
      >
        <Select value={metric} onValueChange={(value) => setMetric(value as MetricKey)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(METRICS).map(([value, meta]) => (
              <SelectItem key={value} value={value}>
                {meta.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ScreenToolbar>

      <Card>
        <CardHeader>
          <CardTitle>مخطط النمو والمتابعة</CardTitle>
          <CardDescription>
            مسار المريض عبر الزمن من قياساته المسجَّلة في المؤشرات الحيوية. منحنيات المئينات
            المرجعية غير مرسومة — تحتاج جدولًا مرجعيًّا معتمدًا، وتقريبها يُنتج مئينًا كاذبًا.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vitals.isLoading && <Skeleton className="h-64 w-full" />}
          {vitals.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر تحميل القياسات: {errorMessage(vitals.error)}
            </p>
          )}
          {!vitals.isLoading && !vitals.isError && series.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              لا قياسات لهذا المؤشّر بعد — تُدخَل من قسم «المؤشرات الحيوية».
            </p>
          )}
          {!vitals.isLoading && !vitals.isError && series.length > 0 && (
            <div className="h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                  <Tooltip />
                  {keys.map((key) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={SERIES_LABELS[key]}
                      stroke={SERIES_COLORS[key]}
                      strokeWidth={2}
                      connectNulls
                      dot
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">القياسات</CardTitle>
          {latest && (
            <CardDescription>
              آخر قياس: {formatDate(latest.recorded_at, calendarDisplay)}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!vitals.isLoading && !vitals.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الطول</TableHead>
                  <TableHead>الوزن</TableHead>
                  <TableHead>كتلة الجسم</TableHead>
                  <TableHead>الضغط</TableHead>
                  <TableHead>النبض</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows].reverse().map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDate(row.recorded_at, calendarDisplay)}
                    </TableCell>
                    <TableCell>{row.height_cm === null ? "—" : formatAmount(row.height_cm)}</TableCell>
                    <TableCell>{row.weight_kg === null ? "—" : formatAmount(row.weight_kg)}</TableCell>
                    <TableCell>{row.bmi === null ? "—" : formatAmount(row.bmi)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.blood_pressure_systolic === null || row.blood_pressure_diastolic === null
                        ? "—"
                        : `${formatAmount(row.blood_pressure_systolic)} / ${formatAmount(row.blood_pressure_diastolic)}`}
                    </TableCell>
                    <TableCell>{row.heart_rate === null ? "—" : formatAmount(row.heart_rate)}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا قياسات مسجَّلة بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!vitals.isLoading && !vitals.isError && <GridFooterCount count={rows.length} />}
      </Card>
    </div>
  );
}
