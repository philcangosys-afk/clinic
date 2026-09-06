import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { formatAmount, formatDateTime, useLocaleSettings } from "@/lib/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type DaySummary = {
  business_day_id: string;
  day_number: number;
  business_date: string;
  opened_at: string;
  closed_at: string | null;
  is_open: boolean;
  note: string | null;
  invoices_count: number;
  gross_amount: number;
  discount_amount: number;
  vat_amount: number;
  exemption_amount: number;
  net_amount: number;
  collected_amount: number;
  refunded_amount: number;
  net_collected_amount: number;
  outstanding_amount: number;
};

type DayCollection = {
  method_name: string;
  affects_drawer: boolean;
  vouchers_count: number;
  amount: number;
};

type DayInvoice = {
  invoice_id: string;
  invoice_number: number;
  created_at: string;
  status: string;
  is_temporary: boolean;
  invoice_type: string;
  net_amount: number;
  paid_amount: number;
  remaining_amount: number;
  patient_name: string | null;
  file_number: number | null;
  external_customer_name: string | null;
  doctor_name: string | null;
};

/**
 * اليومية المالية — ما جرى منذ الفتح، وزرّ الإغلاق.
 *
 * **لماذا يومية لا «تقرير اليوم»؟** لأن اليوم التقويميّ لا يطابق يوم العمل:
 * العيادة تُغلق بعد منتصف الليل، فتقع فواتير السهرة في يومٍ تالٍ لا أحد يعمل
 * فيه، ولا يطابق جردُ الصندوق شيئًا. فاليومية تُفتح بأوّل فاتورة وتُغلق بقرار،
 * وكل ما يأتي بعد الإغلاق يقع في يومية جديدة ولو في التاريخ نفسه.
 *
 * والمحصَّل يُقرأ من سندات القبض لا من خانة «المدفوع» في الفاتورة: السند هو
 * ما يقابله نقدٌ في الصندوق أو إشعارٌ من الشبكة.
 */
export default function BusinessDayPanel() {
  const { organization } = useOrganizationAccess();
  const { calendarDisplay } = useLocaleSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const organizationId = organization?.id;
  const [note, setNote] = useState("");
  const [openedDayId, setOpenedDayId] = useState<string | null>(null);

  const days = useQuery({
    queryKey: ["business-days", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_business_day_summary")
        .select("*")
        .eq("organization_id", organizationId)
        .order("day_number", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as DaySummary[];
    },
  });

  const current = (days.data ?? []).find((row) => row.is_open) ?? null;
  /** اليومية المعروضة: المفتوحة افتراضًا، أو ما يختاره المستخدم من السجل. */
  const shownId = openedDayId ?? current?.business_day_id ?? days.data?.[0]?.business_day_id ?? null;
  const shown = (days.data ?? []).find((row) => row.business_day_id === shownId) ?? null;

  const collections = useQuery({
    queryKey: ["business-day-collections", shownId],
    enabled: Boolean(shownId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_business_day_collections")
        .select("method_name, affects_drawer, vouchers_count, amount")
        .eq("business_day_id", shownId)
        .order("amount", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DayCollection[];
    },
  });

  const invoices = useQuery({
    queryKey: ["business-day-invoices", shownId],
    enabled: Boolean(shownId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_business_day_invoices")
        .select("*")
        .eq("business_day_id", shownId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DayInvoice[];
    },
  });

  const closeDay = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.rpc("app_close_business_day", {
        p_organization_id: organizationId,
        // نفس النطاق الذي وُسِمت به الفاتورة: الفاتورة لا تحمل فرعًا اليوم،
        // فاليومية على مستوى المنشأة — وتمرير فرعٍ هنا يبحث عن يومية أخرى.
        p_branch_id: null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-days"] });
      queryClient.invalidateQueries({ queryKey: ["business-day-collections"] });
      queryClient.invalidateQueries({ queryKey: ["business-day-invoices"] });
      setNote("");
      setOpenedDayId(null);
      toast({ title: "أُغلقت اليومية — ما بعدها يبدأ يومية جديدة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إغلاق اليومية",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  if (days.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarCheck className="h-5 w-5" />
                {shown
                  ? `اليومية رقم ${shown.day_number}${shown.is_open ? " — مفتوحة" : ""}`
                  : "لا توجد يومية بعد"}
              </CardTitle>
              <CardDescription>
                {shown ? (
                  <>
                    فُتحت {formatDateTime(shown.opened_at, calendarDisplay)}
                    {shown.closed_at
                      ? ` · أُغلقت ${formatDateTime(shown.closed_at, calendarDisplay)}`
                      : " · لم تُغلق بعد"}
                  </>
                ) : (
                  "تُفتح اليومية تلقائيًا بأوّل فاتورة."
                )}
              </CardDescription>
            </div>
            {shown?.is_open && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">ملاحظة الإغلاق (اختيارية)</Label>
                  <Input
                    className="w-56"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="مثال: تسليم الوردية المسائية"
                  />
                </div>
                <Button
                  disabled={closeDay.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "سيُغلق يوم العمل الحالي. كل فاتورة بعد الإغلاق تُحسب في يومية جديدة ولو في التاريخ نفسه. متابعة؟",
                      )
                    )
                      closeDay.mutate();
                  }}
                >
                  <Lock className="h-4 w-4" />
                  {closeDay.isPending ? "جارٍ الإغلاق..." : "تقفيل اليومية"}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        {shown && (
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="عدد الفواتير" value={String(shown.invoices_count)} />
            <Metric label="الإجمالي قبل الخصم" value={formatAmount(shown.gross_amount)} />
            <Metric label="الخصومات" value={formatAmount(shown.discount_amount)} />
            <Metric label="الضريبة" value={formatAmount(shown.vat_amount)} />
            <Metric label="صافي الفواتير" value={formatAmount(shown.net_amount)} strong />
            <Metric
              label="المحصَّل فعليًا"
              value={formatAmount(shown.net_collected_amount)}
              strong
              tone="emerald"
            />
            {Number(shown.exemption_amount) > 0 && (
              <Metric label="المعفى من الضريبة" value={formatAmount(shown.exemption_amount)} />
            )}
            {Number(shown.refunded_amount) > 0 && (
              <Metric label="المرتجع" value={formatAmount(shown.refunded_amount)} tone="rose" />
            )}
            <Metric
              label="غير محصَّل"
              value={formatAmount(shown.outstanding_amount)}
              tone={Number(shown.outstanding_amount) > 0 ? "rose" : undefined}
            />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">المحصَّل بحسب طريقة الدفع</CardTitle>
          <CardDescription>هذا ما يُجرَد به الصندوق عند التسليم.</CardDescription>
        </CardHeader>
        <CardContent>
          {collections.isLoading && <Skeleton className="h-20 w-full" />}
          {!collections.isLoading && (collections.data ?? []).length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">لا تحصيل في هذه اليومية بعد.</p>
          )}
          {!collections.isLoading && (collections.data ?? []).length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">الطريقة</TableHead>
                  <TableHead className="whitespace-nowrap">عدد السندات</TableHead>
                  <TableHead className="whitespace-nowrap text-end">المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(collections.data ?? []).map((row) => (
                  <TableRow key={row.method_name}>
                    <TableCell className="whitespace-nowrap">
                      {row.method_name}
                      {row.affects_drawer && (
                        <Badge variant="secondary" className="ms-2 text-[10px]">
                          نقد في الصندوق
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.vouchers_count}</TableCell>
                    <TableCell className="whitespace-nowrap text-end font-medium tabular-nums">
                      {formatAmount(row.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">فواتير اليومية</CardTitle>
          <CardDescription>راجعها قبل التقفيل.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.isLoading && <Skeleton className="h-24 w-full" />}
          {!invoices.isLoading && (invoices.data ?? []).length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">لا فواتير في هذه اليومية.</p>
          )}
          {!invoices.isLoading && (invoices.data ?? []).length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">#الفاتورة</TableHead>
                  <TableHead className="whitespace-nowrap">الوقت</TableHead>
                  <TableHead className="min-w-[9rem]">العميل</TableHead>
                  <TableHead className="hidden whitespace-nowrap lg:table-cell">الطبيب</TableHead>
                  <TableHead className="whitespace-nowrap text-end">الصافي</TableHead>
                  <TableHead className="whitespace-nowrap text-end">المدفوع</TableHead>
                  <TableHead className="whitespace-nowrap text-end">المتبقي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices.data ?? []).map((row) => (
                  <TableRow key={row.invoice_id}>
                    <TableCell className="whitespace-nowrap tabular-nums text-xs">
                      #{row.invoice_number}
                      {row.is_temporary && (
                        <Badge className="ms-1 bg-indigo-100 text-[10px] text-indigo-700">عرض سعر</Badge>
                      )}
                      {row.invoice_type === "return" && (
                        <Badge variant="secondary" className="ms-1 text-[10px]">مرتجع</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(row.created_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="min-w-[9rem]">
                      {row.patient_name ?? row.external_customer_name ?? "—"}
                      {row.file_number != null && (
                        <span className="block text-[10px] tabular-nums text-muted-foreground">
                          ملف {row.file_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {row.doctor_name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-end font-medium tabular-nums">
                      {formatAmount(row.net_amount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-end tabular-nums text-emerald-700">
                      {formatAmount(row.paid_amount)}
                    </TableCell>
                    <TableCell
                      className={`whitespace-nowrap text-end tabular-nums ${
                        Number(row.remaining_amount) > 0 ? "font-semibold text-rose-600" : "text-muted-foreground"
                      }`}
                    >
                      {formatAmount(row.remaining_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">اليوميات السابقة</CardTitle>
          <CardDescription>اختر يومية لعرض تفاصيلها.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">اليومية</TableHead>
                <TableHead className="whitespace-nowrap">من</TableHead>
                <TableHead className="whitespace-nowrap">إلى</TableHead>
                <TableHead className="whitespace-nowrap">فواتير</TableHead>
                <TableHead className="whitespace-nowrap text-end">الصافي</TableHead>
                <TableHead className="whitespace-nowrap text-end">المحصَّل</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(days.data ?? []).map((row) => (
                <TableRow
                  key={row.business_day_id}
                  className={row.business_day_id === shownId ? "bg-muted/50" : ""}
                >
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {row.day_number}
                    {row.is_open && (
                      <Badge className="ms-2 bg-emerald-100 text-[10px] text-emerald-800">مفتوحة</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(row.opened_at, calendarDisplay)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {row.closed_at ? formatDateTime(row.closed_at, calendarDisplay) : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.invoices_count}</TableCell>
                  <TableCell className="whitespace-nowrap text-end tabular-nums">
                    {formatAmount(row.net_amount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-end tabular-nums text-emerald-700">
                    {formatAmount(row.net_collected_amount)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpenedDayId(row.business_day_id)}
                    >
                      عرض
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(days.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    لم تُفتح يومية بعد — تُفتح تلقائيًا مع أوّل فاتورة.
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

function Metric({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "emerald" | "rose";
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`tabular-nums ${strong ? "text-lg font-bold" : "text-base font-medium"} ${
          tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-600" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
