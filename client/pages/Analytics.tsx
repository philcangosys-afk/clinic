import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { useLocaleSettings, formatMoney } from "@/lib/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * التحليلات — المرحلة 31.
 *
 * التقارير تُجيب «ماذا حدث؟»؛ وهذه الشاشة تُجيب **«هل نتحسّن أم نتراجع؟»**.
 *
 * وكل رقم هنا محسوب في القاعدة لا في المتصفّح: لو حسبت الشاشة الفروق بنفسها
 * لاختلف رقمها عن رقم التقرير عن رقم التصدير، ولصار لكل شاشة حقيقتها.
 */
const RANGES = [
  { value: "7", label: "آخر 7 أيام" },
  { value: "30", label: "آخر 30 يومًا" },
  { value: "90", label: "آخر 90 يومًا" },
];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Analytics() {
  const { organization } = useOrganizationAccess();
  const { currencyCode, dataLanguage } = useLocaleSettings();
  const [range, setRange] = useState("30");

  const { from, to } = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (Number(range) - 1));
    return { from: isoDate(start), to: isoDate(end) };
  }, [range]);

  const summary = useQuery({
    queryKey: ["analytics-summary", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_analytics_summary", {
        p_org: organization!.id, p_from: from, p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const daily = useQuery({
    queryKey: ["analytics-daily", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_analytics_daily").select("*")
        .eq("organization_id", organization!.id)
        .gte("report_date", from)
        .lte("report_date", to)
        .order("report_date");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // الفروع تُجمع في نقطة واحدة لكل يوم: الرسم عن المنشأة لا عن فرعٍ بعينه
  const series = useMemo(() => {
    const byDay = new Map<string, any>();
    for (const row of daily.data ?? []) {
      const key = String(row.report_date);
      const acc = byDay.get(key) ?? {
        day: key, appointments: 0, no_shows: 0, visits: 0,
        new_patients: 0, revenue: 0, waiting: 0, waitingDays: 0,
      };
      acc.appointments += Number(row.appointments_total ?? 0);
      acc.no_shows += Number(row.no_shows ?? 0);
      acc.visits += Number(row.visits_total ?? 0);
      acc.new_patients += Number(row.new_patients ?? 0);
      acc.revenue += Number(row.revenue ?? 0);
      if (row.avg_waiting_minutes != null) {
        acc.waiting += Number(row.avg_waiting_minutes);
        acc.waitingDays += 1;
      }
      byDay.set(key, acc);
    }
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({
        ...d,
        label: d.day.slice(5),
        waiting: d.waitingDays ? Math.round(d.waiting / d.waitingDays) : null,
      }));
  }, [daily.data]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">التحليلات</h1>
          <p className="text-sm text-muted-foreground">
            الاتجاه ومقارنة الفترة بما قبلها — لا القوائم
          </p>
        </div>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.isLoading &&
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        {!summary.isLoading && (summary.data ?? []).map((m) => (
          <KpiCard key={m.metric_key} metric={m} currencyCode={currencyCode}
                   dataLanguage={dataLanguage} />
        ))}
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">الحركة</TabsTrigger>
          <TabsTrigger value="revenue">الإيراد</TabsTrigger>
          <TabsTrigger value="services">أكثر الخدمات</TabsTrigger>
          <TabsTrigger value="peak">ساعات الذروة</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" />
                المواعيد والزيارات وعدم الحضور
              </CardTitle>
              <CardDescription>
                خطّ عدم الحضور المرتفع مع المواعيد الثابتة يعني فترات ضائعة.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {daily.isLoading && <Skeleton className="h-72 w-full" />}
              {!daily.isLoading && series.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  لا بيانات في هذه الفترة.
                </p>
              )}
              {!daily.isLoading && series.length > 0 && (
                <div className="h-72 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="appointments" name="مواعيد"
                            stroke="#2563eb" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="visits" name="زيارات"
                            stroke="#16a34a" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="no_shows" name="عدم حضور"
                            stroke="#dc2626" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenue" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">الإيراد اليومي</CardTitle>
              <CardDescription>
                من الفواتير غير الملغاة — الملغاة لا تُحتسب إيرادًا.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {daily.isLoading && <Skeleton className="h-72 w-full" />}
              {!daily.isLoading && series.length > 0 && (
                <div className="h-72 w-full" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => formatMoney(v, currencyCode, dataLanguage)} />
                      <Area type="monotone" dataKey="revenue" name="الإيراد"
                            stroke="#0891b2" fill="#0891b2" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {!daily.isLoading && series.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  لا بيانات في هذه الفترة.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="mt-4">
          <TopServices from={from} to={to} currencyCode={currencyCode}
                       dataLanguage={dataLanguage} />
        </TabsContent>

        <TabsContent value="peak" className="mt-4">
          <PeakHours from={from} to={to} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * بطاقة مؤشّر
 * ════════════════════════════════════════════════════════════════════════ */
function KpiCard({
  metric, currencyCode, dataLanguage,
}: { metric: any; currencyCode: string; dataLanguage: any }) {
  const change = metric.change_percent;
  const isMoney = metric.metric_key === "revenue";
  const higherIsBetter = Boolean(metric.higher_is_better);

  // الاتجاه يُقرأ بحسب طبيعة المؤشّر: ارتفاع عدم الحضور ليس تحسّنًا
  const good = change == null ? null : (Number(change) >= 0) === higherIsBetter;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{metric.metric_name}</CardDescription>
        <CardTitle className="text-2xl">
          {isMoney
            ? formatMoney(metric.current_value, currencyCode, dataLanguage)
            : Number(metric.current_value ?? 0).toLocaleString("ar-SA-u-nu-latn")}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {change == null ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Minus className="h-3 w-3" />
            لا مقارنة — الفترة السابقة صفر
          </span>
        ) : (
          <span className={`flex items-center gap-1 text-xs ${
            good ? "text-emerald-600" : "text-destructive"}`}>
            {Number(change) >= 0
              ? <ArrowUpRight className="h-3 w-3" />
              : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(Number(change))}% عن الفترة السابقة
            <span className="text-muted-foreground">
              ({isMoney
                ? formatMoney(metric.previous_value, currencyCode, dataLanguage)
                : Number(metric.previous_value ?? 0).toLocaleString("ar-SA-u-nu-latn")})
            </span>
          </span>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * أكثر الخدمات
 * ════════════════════════════════════════════════════════════════════════ */
function TopServices({
  from, to, currencyCode, dataLanguage,
}: { from: string; to: string; currencyCode: string; dataLanguage: any }) {
  const { organization } = useOrganizationAccess();

  const rows = useQuery({
    queryKey: ["analytics-top-services", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_analytics_top_services").select("*")
        .eq("organization_id", organization!.id)
        .gte("report_date", from).lte("report_date", to);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const aggregated = useMemo(() => {
    const byItem = new Map<string, any>();
    for (const r of rows.data ?? []) {
      const acc = byItem.get(r.item_id) ?? {
        item_id: r.item_id,
        name: dataLanguage === "en" && r.item_name_en ? r.item_name_en : r.item_name,
        times: 0, value: 0,
      };
      acc.times += Number(r.times_performed ?? 0);
      acc.value += Number(r.total_value ?? 0);
      byItem.set(r.item_id, acc);
    }
    return [...byItem.values()].sort((a, b) => b.times - a.times).slice(0, 15);
  }, [rows.data, dataLanguage]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">أكثر الخدمات تنفيذًا</CardTitle>
        <CardDescription>
          المنفَّذ فعلًا لا المسوَّدة — يجيب «فيمَ نعمل؟» لا «ماذا في الكتالوج؟».
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.isLoading && <Skeleton className="h-64 w-full" />}
        {!rows.isLoading && aggregated.length > 0 && (
          <>
            <div className="mb-4 h-64 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aggregated.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} height={60}
                         angle={-25} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="times" name="مرات التنفيذ" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الخدمة</TableHead>
                  <TableHead>مرات التنفيذ</TableHead>
                  <TableHead>القيمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregated.map((r) => (
                  <TableRow key={r.item_id}>
                    <TableCell className="text-sm">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.times}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatMoney(r.value, currencyCode, dataLanguage)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        {!rows.isLoading && aggregated.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            لا خدمات منفَّذة في هذه الفترة.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * ساعات الذروة
 * ════════════════════════════════════════════════════════════════════════ */
function PeakHours({ from, to }: { from: string; to: string }) {
  const { organization } = useOrganizationAccess();

  const rows = useQuery({
    queryKey: ["analytics-peak", organization?.id, from, to],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_analytics_peak_hours").select("*")
        .eq("organization_id", organization!.id)
        .gte("report_date", from).lte("report_date", to);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const byHour = useMemo(() => {
    const acc = new Map<number, { hour: number; appointments: number; no_shows: number }>();
    for (const r of rows.data ?? []) {
      const h = Number(r.hour_of_day);
      const cur = acc.get(h) ?? { hour: h, appointments: 0, no_shows: 0 };
      cur.appointments += Number(r.appointments ?? 0);
      cur.no_shows += Number(r.no_shows ?? 0);
      acc.set(h, cur);
    }
    return [...acc.values()]
      .sort((a, b) => a.hour - b.hour)
      .map((r) => ({ ...r, label: `${String(r.hour).padStart(2, "0")}:00` }));
  }, [rows.data]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">ساعات الذروة</CardTitle>
        <CardDescription>
          متى يزدحم المكان فعلًا — أساسٌ لتوزيع المناوبات لا للتخمين.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.isLoading && <Skeleton className="h-64 w-full" />}
        {!rows.isLoading && byHour.length > 0 && (
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byHour}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="appointments" name="مواعيد" fill="#2563eb" />
                <Bar dataKey="no_shows" name="عدم حضور" fill="#dc2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {!rows.isLoading && byHour.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            لا مواعيد في هذه الفترة.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
