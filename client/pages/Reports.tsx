import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, FileCheck2, Percent, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { DocumentTemplateRow, OccupationalExamPurpose, OccupationalExamReportView, OccupationalFitnessStatus } from "@/lib/database.types";
import { buildMergeContext, mergeTemplate, printHtml } from "@/lib/document-merge";
import { localDayRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReceptionReports from "@/components/reports/ReceptionReports";
import ReportCenter from "@/components/reports/ReportCenter";
import UnbilledServices from "@/components/reports/UnbilledServices";
import PendingConsents from "@/components/reports/PendingConsents";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

const EXAM_PURPOSE_LABELS: Record<OccupationalExamPurpose, string> = {
  pre_employment: "ما قبل التوظيف",
  periodic: "دوري",
  return_to_work: "العودة للعمل",
  exit: "مغادرة العمل",
};
const FITNESS_STATUS_LABELS: Record<OccupationalFitnessStatus, string> = {
  fit: "لائق",
  fit_with_restrictions: "لائق بقيود",
  unfit: "غير لائق",
  pending: "قيد المراجعة",
};
const FITNESS_STATUS_BADGE: Record<OccupationalFitnessStatus, "success" | "default" | "destructive" | "secondary"> = {
  fit: "success",
  fit_with_restrictions: "default",
  unfit: "destructive",
  pending: "secondary",
};

/**
 * التاريخ **بتوقيت المتصفح** لا بـ UTC.
 *
 * `toISOString().slice(0,10)` يعطي تاريخ UTC: في الرياض (UTC+3) الساعة 1:30
 * فجرًا من 28 أغسطس يُعيد "2026-08-27" — فتفتح التقارير على نطاق ينتهي أمس
 * وتُسقِط فواتير اليوم كله بلا أي إشارة للمستخدم.
 */
function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function defaultFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return toDateInputValue(date);
}

const money = (value: number | null | undefined) => Number(value ?? 0).toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 2 });

export default function Reports() {
  const { organization } = useOrganizationAccess();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(toDateInputValue(new Date()));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">التقارير</h1>
          <p className="text-sm text-muted-foreground">كل التقارير محسوبة مباشرة من البيانات الحيّة — لا تقارير مخزَّنة قد تفقد التزامن</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
          </div>
        </div>
      </div>

      <KpiStrip organizationId={organization?.id} from={from} to={to} />

      <Tabs defaultValue="revenue">
        <TabsList>
          <TabsTrigger value="center">مركز التقارير</TabsTrigger>
          <TabsTrigger value="reception">الاستقبال والمواعيد</TabsTrigger>
          <TabsTrigger value="unbilled">المعلّقات</TabsTrigger>
          <TabsTrigger value="revenue">الإيراد</TabsTrigger>
          <TabsTrigger value="sales">المبيعات والعروض</TabsTrigger>
          <TabsTrigger value="profitability">الربحية</TabsTrigger>
          <TabsTrigger value="vat">الضرائب والمرتجعات</TabsTrigger>
          <TabsTrigger value="sources">المصادر والاتفاقيات</TabsTrigger>
          <TabsTrigger value="patients">إحصائيات المرضى</TabsTrigger>
          <TabsTrigger value="occupational">الفحوصات المهنية</TabsTrigger>
        </TabsList>
        <TabsContent value="center" className="mt-4">
          <ReportCenter />
        </TabsContent>
        <TabsContent value="reception" className="mt-4">
          <ReceptionReports />
        </TabsContent>

        <TabsContent value="unbilled" className="mt-4 flex flex-col gap-4">
          <UnbilledServices />
          <PendingConsents />
        </TabsContent>

        <TabsContent value="revenue">
          <RevenueTab organizationId={organization?.id} from={from} to={to} />
        </TabsContent>
        <TabsContent value="sales">
          <SalesTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="profitability">
          <ProfitabilityTab organizationId={organization?.id} from={from} to={to} />
        </TabsContent>
        <TabsContent value="vat">
          <VatReturnsTab organizationId={organization?.id} from={from} to={to} />
        </TabsContent>
        <TabsContent value="sources">
          <SourcesAgreementsTab organizationId={organization?.id} from={from} to={to} />
        </TabsContent>
        <TabsContent value="patients">
          <PatientFinancialsTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="occupational">
          <OccupationalExamsTab organizationId={organization?.id} from={from} to={to} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useInvoiceKpis(organizationId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["report-kpis", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_invoice_kpis", {
        p_organization_id: organizationId,
        p_date_from: from,
        p_date_to: to,
      });
      if (error) throw error;
      return (data?.[0] as Record<string, number>) ?? null;
    },
  });
}

function KpiStrip({ organizationId, from, to }: { organizationId: string | undefined; from: string; to: string }) {
  const kpis = useInvoiceKpis(organizationId, from, to);

  if (kpis.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const data = kpis.data;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard icon={Wallet} label="الإيراد الإجمالي" value={`${money(data?.gross_amount)} ر.س`} />
      <KpiCard icon={ReceiptText} label="الصافي" value={`${money(data?.net_amount)} ر.س`} />
      <KpiCard icon={Percent} label="نسبة الخصم" value={`${money(data?.discount_rate_percent)}%`} tone="warning" />
      <KpiCard icon={TrendingUp} label="نسبة التحصيل" value={`${money(data?.collection_rate_percent)}%`} tone="success" />
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  tone?: "warning" | "success";
}) {
  const toneClass =
    tone === "warning" ? "bg-amber-100 text-amber-700" : tone === "success" ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-base font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function useDailyRevenue(organizationId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["v-daily-revenue", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_daily_revenue")
        .select("*")
        .eq("organization_id", organizationId)
        .gte("revenue_date", from)
        .lte("revenue_date", to)
        .order("revenue_date");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * الإيراد حسب الطبيب وحسب العيادة — **بالفترة**.
 *
 * كانا يقرآن من `v_revenue_by_doctor` و`v_revenue_by_clinic`، والمنظورَان بلا
 * عمود تاريخ أصلًا: أي أن الجدولين كانا يعرضان إيراد كل التاريخ تحت مرشّح
 * «من/إلى». يغيّر المستخدم الفترة فيتحرّك الرسم أعلاه ولا يتحرّك الجدولان،
 * فتُقارَن إنتاجية طبيب أو تُحسب عمولته على رقم لا يمثّل الفترة. والأسوأ أن
 * المنظورَين كانا يجمعان الفواتير الملغاة وعروض الأسعار المؤقّتة.
 *
 * دالّتا 0143 تأخذان المدى وتستثنيان الملغاة والمؤقّتة، وتعدّان مواعيد العيادة
 * في نفس المدى لا في كل التاريخ.
 */
function useRevenueByDoctor(organizationId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["revenue-doctor", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_revenue_by_doctor", {
        p_organization_id: organizationId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function useRevenueByClinic(organizationId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["revenue-clinic", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_revenue_by_clinic", {
        p_organization_id: organizationId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function RevenueTab({ organizationId, from, to }: { organizationId: string | undefined; from: string; to: string }) {
  const daily = useDailyRevenue(organizationId, from, to);
  const byDoctor = useRevenueByDoctor(organizationId, from, to);
  const byClinic = useRevenueByClinic(organizationId, from, to);

  const chartData = (daily.data ?? []).map((row) => ({
    date: new Date(row.revenue_date).toLocaleDateString("ar-SA-u-nu-latn", { day: "2-digit", month: "2-digit" }),
    net_amount: Number(row.net_amount),
  }));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            الإيراد اليومي (الصافي)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {daily.isLoading && <Skeleton className="h-56 w-full" />}
          {!daily.isLoading && chartData.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">لا توجد فواتير في هذا المدى.</p>
          )}
          {!daily.isLoading && chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} width={50} />
                <Tooltip formatter={(value: number) => `${money(value)} ر.س`} />
                <Line type="monotone" dataKey="net_amount" stroke="#0d716a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الإيراد حسب الطبيب</CardTitle>
            <CardDescription>نقدي مقابل تأمين</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>نقدي</TableHead>
                  <TableHead>تأمين</TableHead>
                  <TableHead>الصافي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(byDoctor.data ?? []).map((row) => (
                  <TableRow key={row.doctor_id}>
                    <TableCell className="font-medium">د. {row.doctor_name}</TableCell>
                    <TableCell>{money(row.cash_amount)}</TableCell>
                    <TableCell>{money(row.insurance_amount)}</TableCell>
                    <TableCell className="font-semibold">{money(row.net_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الإيراد حسب العيادة/القسم</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العيادة</TableHead>
                  <TableHead>عدد الفواتير</TableHead>
                  <TableHead>المواعيد</TableHead>
                  <TableHead>الصافي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(byClinic.data ?? []).map((row) => (
                  <TableRow key={row.clinic_id}>
                    <TableCell className="font-medium">{row.clinic_name}</TableCell>
                    <TableCell>{row.invoice_count}</TableCell>
                    <TableCell>{row.appointment_count}</TableCell>
                    <TableCell className="font-semibold">{money(row.net_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SalesTab({ organizationId }: { organizationId: string | undefined }) {
  const sales = useQuery({
    queryKey: ["v-sales-by-item", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_sales_by_item")
        .select("*")
        .eq("organization_id", organizationId)
        .gt("qty_sold", 0)
        .order("net_revenue", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  const offers = useQuery({
    queryKey: ["v-offers-totals", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_offers_totals")
        .select("*")
        .eq("organization_id", organizationId)
        .order("total_discount_amount", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>الأصناف الأكثر مبيعًا</CardTitle>
        </CardHeader>
        <CardContent>
          {sales.isLoading && <Skeleton className="h-40 w-full" />}
          {!sales.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكمية المباعة</TableHead>
                  <TableHead>الإيراد الصافي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sales.data ?? []).map((row) => (
                  <TableRow key={row.item_id}>
                    <TableCell className="font-medium">{row.item_name}</TableCell>
                    <TableCell>{row.qty_sold}</TableCell>
                    <TableCell className="font-semibold">{money(row.net_revenue)}</TableCell>
                  </TableRow>
                ))}
                {(sales.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد بيانات مبيعات بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>إجماليات العروض</CardTitle>
          {/*
            العمود يعرض **حصّة العرض** وحدها منذ 0144: `v_offers_totals` كانت
            تجمع `discount_amount` أي خصم الفاتورة كاملًا، ففاتورة عليها خصم
            يدوي 200 ومرتبطة بعرضٍ خصمه 50 تُضيف 200 إلى حصيلة العرض — رقمٌ
            يُبنى عليه قرار إيقاف عرضٍ أو تمديده. صار المنظور يحسب
            `subtotal_amount × offer_percent` ويستثني الملغاة والمؤقّتة.
          */}
          <CardDescription>
            «خصم العرض» حصّة العرض وحدها — لا يشمل أي خصم يدوي على الفاتورة، ولا الفواتير الملغاة ولا عروض الأسعار
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العرض</TableHead>
                <TableHead>عدد الفواتير المطبَّق عليها</TableHead>
                <TableHead>إجمالي خصم العرض</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(offers.data ?? []).map((row) => (
                <TableRow key={row.offer_id}>
                  <TableCell className="font-medium">{row.title}</TableCell>
                  <TableCell>{row.applied_invoice_count}</TableCell>
                  <TableCell className="font-semibold text-amber-700">{money(row.total_discount_amount)}</TableCell>
                </TableRow>
              ))}
              {(offers.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد عروض مسجّلة بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfitabilityTab({ organizationId, from, to }: { organizationId: string | undefined; from: string; to: string }) {
  const profitability = useQuery({
    queryKey: ["v-invoice-profitability", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_invoice_profitability")
        .select("*")
        .eq("organization_id", organizationId)
        // حدود بتوقيت المتصفح لا بتوقيت الخادم — انظر date-range.ts
        .gte("created_at", localDayRange(from, to).from ?? `${from}T00:00:00`)
        .lte("created_at", localDayRange(from, to).to ?? `${to}T23:59:59`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const totals = (profitability.data ?? []).reduce(
    (acc, row) => ({
      revenue: acc.revenue + Number(row.gross_revenue),
      cost: acc.cost + Number(row.estimated_cost),
      profit: acc.profit + Number(row.estimated_profit),
    }),
    { revenue: 0, cost: 0, profit: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="grid grid-cols-3 gap-4 py-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground">الإيراد</p>
            <p className="text-lg font-bold">{money(totals.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">التكلفة التقديرية</p>
            <p className="text-lg font-bold text-rose-600">{money(totals.cost)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">الربح التقديري</p>
            <p className="text-lg font-bold text-emerald-700">{money(totals.profit)}</p>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        ملاحظة: التكلفة التقديرية مبنية على سعر تكلفة الصنف الحالي (items.cost_price)، وهي تبسيط متعمد قابل للترقية لاحقًا
        لتكلفة فعلية من دفعات المخزون وقت البيع.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>آخر 100 فاتورة في المدى المحدد</CardTitle>
        </CardHeader>
        <CardContent>
          {profitability.isLoading && <Skeleton className="h-40 w-full" />}
          {!profitability.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الإيراد</TableHead>
                  <TableHead>التكلفة</TableHead>
                  <TableHead>الربح</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(profitability.data ?? []).map((row) => (
                  <TableRow key={row.invoice_id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("ar-SA-u-nu-latn")}
                    </TableCell>
                    <TableCell>{money(row.gross_revenue)}</TableCell>
                    <TableCell>{money(row.estimated_cost)}</TableCell>
                    <TableCell className="font-semibold">{money(row.estimated_profit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VatReturnsTab({ organizationId, from, to }: { organizationId: string | undefined; from: string; to: string }) {
  const vatInvoices = useQuery({
    queryKey: ["v-vat-invoices", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_vat_statement_sales_invoices")
        .select("*")
        .eq("organization_id", organizationId)
        .gte("invoice_date", from)
        .lte("invoice_date", to);
      if (error) throw error;
      return data ?? [];
    },
  });
  /**
   * كشف المرتجعات **يتبع مرشّح الفترة** مثل جدول الضريبة فوقه.
   *
   * كان يقرأ آخر 30 سطرًا من كل التاريخ بلا `from/to`: يغيّر المستخدم الفترة
   * فيتحرّك الجدول الأعلى ولا يتحرّك الأسفل، فتُقرأ مرتجعات شهرٍ آخر كأنها
   * مرتجعات المدى المعروض — وتُطرح من ضريبة مدى لا تنتمي إليه. و`return_date`
   * من نوع `date` فالمقارنة بنصّ تاريخ صحيحة هنا (لا يوجد وقت يُقتطع).
   */
  const returns = useQuery({
    queryKey: ["v-returns-items", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_returns_statement_items")
        .select("*")
        .eq("organization_id", organizationId)
        .gte("return_date", from)
        .lte("return_date", to)
        .order("return_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const vatTotal = (vatInvoices.data ?? []).reduce((sum, row) => sum + Number(row.vat_amount), 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>كشف ضريبة القيمة المضافة — الفواتير</CardTitle>
          <CardDescription>إجمالي الضريبة في المدى المحدد: {money(vatTotal)} ر.س</CardDescription>
        </CardHeader>
        <CardContent>
          {vatInvoices.isLoading && <Skeleton className="h-32 w-full" />}
          {!vatInvoices.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#الفاتورة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الإجمالي الفرعي</TableHead>
                  <TableHead>الضريبة</TableHead>
                  <TableHead>الصافي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(vatInvoices.data ?? []).map((row) => (
                  <TableRow key={row.invoice_id}>
                    <TableCell className="font-mono text-xs">#{row.invoice_number}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.invoice_date).toLocaleDateString("ar-SA-u-nu-latn")}
                    </TableCell>
                    <TableCell>{money(row.subtotal_amount)}</TableCell>
                    <TableCell>{money(row.vat_amount)}</TableCell>
                    <TableCell className="font-semibold">{money(row.net_amount)}</TableCell>
                  </TableRow>
                ))}
                {(vatInvoices.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد فواتير خاضعة للضريبة في هذا المدى.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>كشف المرتجعات</CardTitle>
          <CardDescription>في المدى المحدد أعلى الشاشة — نفس مدى جدول الضريبة</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>تاريخ الإرجاع</TableHead>
                <TableHead>الصنف</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>المبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(returns.data ?? []).map((row, index) => (
                <TableRow key={`${row.return_invoice_id}-${index}`}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.return_date).toLocaleDateString("ar-SA-u-nu-latn")}
                  </TableCell>
                  <TableCell>{row.item_name ?? "—"}</TableCell>
                  <TableCell>{row.qty}</TableCell>
                  <TableCell className="font-semibold">{money(row.net_amount)}</TableCell>
                </TableRow>
              ))}
              {(returns.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد مرتجعات في هذا المدى.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function OccupationalExamsTab({ organizationId, from, to }: { organizationId: string | undefined; from: string; to: string }) {
  const exams = useQuery({
    queryKey: ["occupational-exam-report", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_occupational_exam_report")
        .select("*")
        .eq("organization_id", organizationId)
        .gte("exam_date", from)
        .lte("exam_date", to)
        .order("exam_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OccupationalExamReportView[];
    },
  });

  const summary = {
    total: (exams.data ?? []).length,
    fit: (exams.data ?? []).filter((r) => r.fitness_status === "fit").length,
    restricted: (exams.data ?? []).filter((r) => r.fitness_status === "fit_with_restrictions").length,
    unfit: (exams.data ?? []).filter((r) => r.fitness_status === "unfit").length,
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-4 text-center sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">إجمالي الفحوصات</p>
            <p className="text-lg font-bold">{summary.total}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">لائق</p>
            <p className="text-lg font-bold text-emerald-700">{summary.fit}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">لائق بقيود</p>
            <p className="text-lg font-bold text-amber-600">{summary.restricted}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">غير لائق</p>
            <p className="text-lg font-bold text-red-600">{summary.unfit}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>تقرير الفحوصات المهنية</CardTitle>
          <CardDescription>كل الفحوصات المهنية (ما قبل التوظيف/الدورية/العودة للعمل/المغادرة) في المدى المحدد</CardDescription>
        </CardHeader>
        <CardContent>
          {exams.isLoading && <Skeleton className="h-40 w-full" />}
          {!exams.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المريض</TableHead>
                  <TableHead>جهة العمل</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>الغرض</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الفحص</TableHead>
                  <TableHead>الفحص القادم</TableHead>
                  <TableHead>رقم الشهادة</TableHead>
                  <TableHead>شهادة اللياقة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(exams.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.patient_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.employer_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.doctor_name ? `د. ${row.doctor_name}` : "—"}</TableCell>
                    <TableCell className="text-xs">{EXAM_PURPOSE_LABELS[row.exam_purpose]}</TableCell>
                    <TableCell>
                      <Badge variant={FITNESS_STATUS_BADGE[row.fitness_status]}>{FITNESS_STATUS_LABELS[row.fitness_status]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(row.exam_date).toLocaleDateString("ar-SA-u-nu-latn")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.next_exam_due_date ? new Date(row.next_exam_due_date).toLocaleDateString("ar-SA-u-nu-latn") : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.certificate_number ?? "—"}</TableCell>
                    <TableCell>
                      <FitnessCertificateButton row={row} organizationId={organizationId} />
                    </TableCell>
                  </TableRow>
                ))}
                {(exams.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد فحوصات مهنية مسجَّلة في هذا المدى.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FitnessCertificateButton({ row, organizationId }: { row: OccupationalExamReportView; organizationId: string | undefined }) {
  const { session } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const generate = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { data: template, error: templateError } = await supabase
        .from("document_templates")
        .select("*")
        .eq("system_key", "fitness_certificate")
        .or(`organization_id.eq.${organizationId},organization_id.is.null`)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (templateError) throw templateError;
      if (!template) throw new Error("لم يُعثر على قالب شهادة اللياقة — تحقق من تطبيق الترحيل 34");
      const tpl = template as DocumentTemplateRow;

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("name, tax_number")
        .eq("id", organizationId)
        .maybeSingle();
      if (orgError) throw orgError;

      const merged = mergeTemplate(
        tpl.body_html,
        buildMergeContext({
          patient: { name_ar: row.patient_name, id_number: row.patient_id_number, mobile_number: row.patient_mobile_number },
          organization: org,
          exam: {
            exam_purpose: row.exam_purpose,
            fitness_status: row.fitness_status,
            employer_name: row.employer_name,
            restrictions_note: row.restrictions_note,
            certificate_number: row.certificate_number,
            exam_date: row.exam_date,
            next_exam_due_date: row.next_exam_due_date,
            doctor_name: row.doctor_name,
          },
        }),
      );
      const title = `شهادة لياقة — ${row.patient_name}`;

      const { error: insertError } = await supabase.from("generated_documents").insert({
        organization_id: organizationId,
        template_id: tpl.id,
        template_name_snapshot: tpl.name_ar,
        patient_id: row.patient_id,
        employee_id: null,
        title,
        body_html: merged,
        extra_fields: {},
        created_by: session?.user.id ?? null,
      });
      if (insertError) throw insertError;

      return { title, merged };
    },
    onSuccess: ({ title, merged }) => {
      queryClient.invalidateQueries({ queryKey: ["generated-documents", organizationId] });
      printHtml(title, merged);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر إصدار الشهادة", description: errorMessage(error, "خطأ غير متوقع") }),
  });

  return (
    <Button size="sm" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate()}>
      <FileCheck2 className="h-3.5 w-3.5" />
      {generate.isPending ? "جارٍ الإصدار..." : "طباعة شهادة"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// إحصائيات المرضى المالية (لقطة 30) — إجمالي الأعمال والمدفوعات والمتبقي
// ---------------------------------------------------------------------------

type PatientFinancialRow = {
  patient_id: string;
  file_number: number | null;
  patient_name: string;
  mobile_number: string | null;
  insurance_company_name: string | null;
  invoice_count: number;
  total_work: number;
  total_paid: number;
  total_remaining: number;
  last_invoice_at: string;
};

/** سقف صفوف جدول إحصائيات المرضى — معلن في الشاشة لا مخفيًّا في الكود. */
const PATIENT_ROW_LIMIT = 200;

const FINANCIAL_SORTS = [
  { value: "total_remaining", label: "الأعلى مديونية" },
  { value: "total_work", label: "الأعلى أعمالًا" },
  { value: "total_paid", label: "الأعلى سدادًا" },
  { value: "last_invoice_at", label: "الأحدث تعاملًا" },
];

function usePatientFinancials(
  organizationId: string | undefined,
  sortBy: string,
  debtorsOnly: boolean,
  search: string,
  doctorId: string,
) {
  return useQuery({
    queryKey: ["patient-financials", organizationId, sortBy, debtorsOnly, search, doctorId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // عند اختيار طبيب نقرأ من العرض المقسَّم حسب الطبيب (0041)؛ وبدونه من
      // العرض المجمَّع على المريض حتى لا يتكرر المريض الذي عالجه أكثر من طبيب.
      //
      // `count: "exact"` يُعيد عدد الصفوف المطابقة **قبل** السقف، فيُعرَف هل
      // بلغ الجدول حدّه: بلا هذا العدد كان سطر «الإجمالي» أسفل الجدول مجموع
      // أعلى 200 مريض ويُقرأ كإجمالي مديونية العيادة، بلا أي إشارة إلى أنه
      // مسقوف — وهو رقم يُنقل إلى تقرير التحصيل.
      let query = supabase
        .from(doctorId ? "v_patient_financials_by_doctor" : "v_patient_financials")
        .select("*", { count: "exact" })
        .eq("organization_id", organizationId)
        .order(sortBy, { ascending: false })
        .limit(PATIENT_ROW_LIMIT);
      if (doctorId) query = query.eq("doctor_id", doctorId);
      if (debtorsOnly) query = query.gt("total_remaining", 0);
      if (search.trim()) query = query.ilike("patient_name", `%${search.trim()}%`);
      const { data, error, count } = await query;
      if (error) throw error;
      return {
        rows: (data ?? []) as PatientFinancialRow[],
        matchedCount: count ?? (data ?? []).length,
      };
    },
  });
}

function PatientFinancialsTab({ organizationId }: { organizationId: string | undefined }) {
  const [sortBy, setSortBy] = useState("total_remaining");
  const [debtorsOnly, setDebtorsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const rows = usePatientFinancials(organizationId, sortBy, debtorsOnly, search, doctorId);

  const financialDoctors = useQuery({
    queryKey: ["doctors-for-financials", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const list = rows.data?.rows ?? [];
  const matchedCount = rows.data?.matchedCount ?? 0;
  const isCapped = matchedCount > list.length;
  // إجماليات الصفوف المعروضة — تُحسب هنا لا في العرض لأنها تتبع الفلترة الحالية
  const totals = list.reduce(
    (acc, row) => ({
      work: acc.work + Number(row.total_work ?? 0),
      paid: acc.paid + Number(row.total_paid ?? 0),
      remaining: acc.remaining + Number(row.total_remaining ?? 0),
    }),
    { work: 0, paid: 0, remaining: 0 },
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>إحصائيات المرضى المالية</CardTitle>
        <CardDescription>
          إجمالي الأعمال والمدفوعات والمتبقي لكل مريض — المرتجعات مخصومة والفواتير الملغاة مستبعدة
        </CardDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم المريض..."
            className="max-w-xs"
          />
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FINANCIAL_SORTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={doctorId || "__all__"}
            onValueChange={(value) => setDoctorId(value === "__all__" ? "" : value)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="كل الأطباء" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">كل الأطباء</SelectItem>
              {(financialDoctors.data ?? []).map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  {doctor.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={debtorsOnly}
              onChange={(e) => setDebtorsOnly(e.target.checked)}
              className="h-4 w-4"
            />
            المدينون فقط
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {rows.isLoading && <Skeleton className="h-40 w-full" />}
        {/* بلوغ السقف يُعلن قبل الجدول لا بعده: الرقم في سطر الإجمالي أدناه
            مجموع المعروض فقط، ومن لا يرى هذا السطر يقرؤه إجمالي العيادة. */}
        {!rows.isLoading && isCapped && (
          <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            بلغ الجدول حدّه: معروض {list.length} من {matchedCount} مريض مطابق. سطر «الإجمالي» أدناه مجموع
            المعروض فقط لا مجموع كل المرضى — ضيّق البحث أو اختر «المدينون فقط» لقراءة إجمالي أدقّ.
          </p>
        )}
        {!rows.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#الملف</TableHead>
                <TableHead>المريض</TableHead>
                <TableHead>الجوال</TableHead>
                <TableHead>التأمين</TableHead>
                <TableHead>الفواتير</TableHead>
                <TableHead>إجمالي الأعمال</TableHead>
                <TableHead>المدفوع</TableHead>
                <TableHead>المتبقي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((row) => (
                <TableRow key={row.patient_id}>
                  <TableCell className="font-mono text-xs">#{row.file_number ?? "—"}</TableCell>
                  <TableCell className="font-medium">{row.patient_name}</TableCell>
                  <TableCell className="font-mono text-xs">{row.mobile_number ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.insurance_company_name ?? "نقدي"}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.invoice_count}</TableCell>
                  <TableCell className="tabular-nums">{Number(row.total_work).toFixed(2)}</TableCell>
                  <TableCell className="tabular-nums text-emerald-700">
                    {Number(row.total_paid).toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={
                      Number(row.total_remaining) > 0
                        ? "font-semibold tabular-nums text-destructive"
                        : "tabular-nums"
                    }
                  >
                    {Number(row.total_remaining).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد بيانات مالية للمرضى.
                  </TableCell>
                </TableRow>
              )}
              {list.length > 0 && (
                <TableRow className="border-t-2 bg-muted/40 font-semibold">
                  <TableCell colSpan={5}>
                    {isCapped
                      ? `إجمالي المعروض فقط (${list.length} من ${matchedCount} مريض)`
                      : `الإجمالي (${list.length} مريض)`}
                  </TableCell>
                  <TableCell className="tabular-nums">{totals.work.toFixed(2)}</TableCell>
                  <TableCell className="tabular-nums text-emerald-700">{totals.paid.toFixed(2)}</TableCell>
                  <TableCell className="tabular-nums text-destructive">
                    {totals.remaining.toFixed(2)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// المصادر والاتفاقيات (لقطة 44) — تقارير كانت عروضها جاهزة في قاعدة البيانات
// منذ 0010 لكن لم تُعرَض في أي شاشة
// ---------------------------------------------------------------------------

function SourcesAgreementsTab({
  organizationId,
  from,
  to,
}: {
  organizationId: string | undefined;
  from: string;
  to: string;
}) {
  const bySource = useQuery({
    queryKey: ["v-revenue-by-source", organizationId, from, to],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_daily_revenue_by_source")
        .select("*")
        .eq("organization_id", organizationId)
        .gte("revenue_date", from)
        .lte("revenue_date", to);
      if (error) throw error;
      return (data ?? []) as {
        source_value_id: string | null;
        source_name_ar: string | null;
        net_amount: number;
        invoice_count: number;
      }[];
    },
  });

  const agreements = useQuery({
    queryKey: ["v-agreements-stats", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agreements_stats")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        agreement_count: number;
        total_amount: number;
        total_invoiced: number;
        total_remaining: number;
      } | null;
    },
  });

  const tempInvoices = useQuery({
    queryKey: ["v-temp-invoices-stats", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_temporary_invoices_stats")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data as { temp_invoice_count: number; total_amount: number } | null;
    },
  });

  /**
   * العرض يُرجع صفًا لكل (تاريخ × مصدر)، فنجمّع هنا على مستوى المصدر ليكون
   * التقرير قابلًا للقراءة. التجميع في الواجهة مقبول لأن المدى محدود بالفترة
   * المختارة أعلى الشاشة.
   */
  const sourceTotals = (() => {
    const map = new Map<string, { name: string; net: number; count: number }>();
    (bySource.data ?? []).forEach((row) => {
      const key = row.source_value_id ?? "__none__";
      const current = map.get(key) ?? { name: row.source_name_ar ?? "بلا مصدر محدد", net: 0, count: 0 };
      current.net += Number(row.net_amount ?? 0);
      current.count += Number(row.invoice_count ?? 0);
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.net - a.net);
  })();

  const grandTotal = sourceTotals.reduce((sum, row) => sum + row.net, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>الإيراد حسب مصدر المريض</CardTitle>
          <CardDescription>يوضّح أي قنوات جلب المرضى تحقّق أعلى إيراد خلال الفترة المختارة</CardDescription>
        </CardHeader>
        <CardContent>
          {bySource.isLoading && <Skeleton className="h-32 w-full" />}
          {!bySource.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المصدر</TableHead>
                  <TableHead>عدد الفواتير</TableHead>
                  <TableHead>الإيراد</TableHead>
                  <TableHead>النسبة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourceTotals.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tabular-nums">{row.count}</TableCell>
                    <TableCell className="tabular-nums">{row.net.toFixed(2)}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {grandTotal > 0 ? `${((row.net / grandTotal) * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {sourceTotals.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد فواتير في هذه الفترة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الاتفاقيات</CardTitle>
            <CardDescription>إجمالي اتفاقيات العلاج النشطة وما فُوتر منها</CardDescription>
          </CardHeader>
          <CardContent>
            {agreements.isLoading && <Skeleton className="h-24 w-full" />}
            {!agreements.isLoading && agreements.data && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">عدد الاتفاقيات</p>
                  <p className="text-xl font-bold tabular-nums">{agreements.data.agreement_count}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">القيمة الإجمالية</p>
                  <p className="text-xl font-bold tabular-nums">
                    {Number(agreements.data.total_amount).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">المفوتر</p>
                  <p className="text-xl font-bold tabular-nums text-emerald-700">
                    {Number(agreements.data.total_invoiced).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">المتبقي</p>
                  <p className="text-xl font-bold tabular-nums text-destructive">
                    {Number(agreements.data.total_remaining).toFixed(2)}
                  </p>
                </div>
              </div>
            )}
            {!agreements.isLoading && !agreements.data && (
              <p className="py-6 text-center text-sm text-muted-foreground">لا توجد اتفاقيات نشطة.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>عروض الأسعار المعلّقة</CardTitle>
            <CardDescription>فواتير مؤقتة لم تُحوَّل بعد إلى فواتير فعلية</CardDescription>
          </CardHeader>
          <CardContent>
            {tempInvoices.isLoading && <Skeleton className="h-24 w-full" />}
            {!tempInvoices.isLoading && tempInvoices.data && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">العدد</p>
                  <p className="text-xl font-bold tabular-nums">{tempInvoices.data.temp_invoice_count}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">القيمة</p>
                  <p className="text-xl font-bold tabular-nums">
                    {Number(tempInvoices.data.total_amount).toFixed(2)}
                  </p>
                </div>
              </div>
            )}
            {!tempInvoices.isLoading && !tempInvoices.data && (
              <p className="py-6 text-center text-sm text-muted-foreground">لا توجد عروض أسعار معلّقة.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
