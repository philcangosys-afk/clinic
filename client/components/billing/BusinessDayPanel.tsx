import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, FileDown, FileSpreadsheet, Lock, Settings2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  hhmm,
  useBusinessDaySettings,
  useCurrentBusinessDate,
  type BusinessDaySettings,
} from "@/lib/business-day";
import { downloadDayPdf, downloadDayXlsx } from "@/lib/business-day-export";

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
  scheduled_close_at: string | null;
  auto_closed: boolean | null;
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

const MANAGER_ROLES = ["owner", "organization_admin", "branch_manager", "accountant"];

/**
 * اليومية المالية — يوم العمل الحالي وحده، والسابق بفلتر التاريخ.
 *
 * **لماذا يومية لا «تقرير اليوم»؟** لأن اليوم التقويميّ لا يطابق يوم العمل:
 * العيادة تُغلق بعد منتصف الليل، فتقع فواتير السهرة في يومٍ تالٍ لا أحد يعمل
 * فيه. فاليومية تُفتح بأوّل فاتورة وتُقفل عند نهاية يوم العمل المضبوطة في
 * «ضبط اليومية» (0181) — أو يدويًا لمن لم يضبطها.
 *
 * والمحصَّل يُقرأ من سندات القبض لا من خانة «المدفوع» في الفاتورة: السند هو
 * ما يقابله نقدٌ في الصندوق أو إشعارٌ من الشبكة.
 */
export default function BusinessDayPanel() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const { calendarDisplay } = useLocaleSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const organizationId = organization?.id;
  const canManage = legacyMode || MANAGER_ROLES.includes(membership?.role_key ?? "");
  const [note, setNote] = useState("");
  const [pickedDayId, setPickedDayId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  const settings = useBusinessDaySettings(organizationId);
  const currentDate = useCurrentBusinessDate(organizationId);
  // التاريخ المعروض: ما اختاره المستخدم، وإلّا يوم العمل الحالي
  const date = selectedDate ?? currentDate.data ?? null;

  const days = useQuery({
    queryKey: ["business-days", organizationId, date],
    enabled: Boolean(organizationId && date),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_business_day_summary")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("business_date", date)
        .order("day_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DaySummary[];
    },
  });

  const dayRows = days.data ?? [];
  /** اليومية المعروضة: ما اختاره المستخدم من يوميات التاريخ، وإلّا أحدثها. */
  const shownId =
    (pickedDayId && dayRows.some((row) => row.business_day_id === pickedDayId) ? pickedDayId : null) ??
    dayRows[0]?.business_day_id ??
    null;
  const shown = dayRows.find((row) => row.business_day_id === shownId) ?? null;

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

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["business-days"] });
    queryClient.invalidateQueries({ queryKey: ["business-day-collections"] });
    queryClient.invalidateQueries({ queryKey: ["business-day-invoices"] });
    queryClient.invalidateQueries({ queryKey: ["current-business-date"] });
    queryClient.invalidateQueries({ queryKey: ["business-day-settings"] });
    queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
  };

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
      refreshAll();
      setNote("");
      setPickedDayId(null);
      toast({ title: "أُقفلت اليومية — ما بعدها يبدأ يومية جديدة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إقفال اليومية",
        description: errorMessage(error),
      }),
  });

  const runExport = async (format: "xlsx" | "pdf") => {
    if (!shown) return;
    setExporting(format);
    try {
      const data = {
        organizationName: organization?.name ?? "",
        day: shown,
        collections: collections.data ?? [],
        invoices: invoices.data ?? [],
      };
      if (format === "xlsx") downloadDayXlsx(data);
      else await downloadDayPdf(data);
    } catch (error) {
      toast({ variant: "destructive", title: "تعذّر تنزيل الملف", description: errorMessage(error) });
    } finally {
      setExporting(null);
    }
  };

  const s = settings.data;
  const exportReady = Boolean(shown) && !collections.isLoading && !invoices.isLoading;

  return (
    <div className="flex flex-col gap-4">
      {/* ── الشريط: التاريخ، الضبط، التنزيل */}
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">تاريخ يوم العمل</Label>
              <Input
                type="date"
                className="w-44"
                value={date ?? ""}
                onChange={(event) => {
                  setSelectedDate(event.target.value || null);
                  setPickedDayId(null);
                }}
              />
            </div>
            {selectedDate && selectedDate !== currentDate.data && (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedDate(null);
                  setPickedDayId(null);
                }}
              >
                اليوم
              </Button>
            )}
            <p className="pb-2 text-xs text-muted-foreground">
              {s
                ? `يوم العمل من ${hhmm(s.day_start)} إلى ${hhmm(s.day_end)} — الإقفال التلقائي ${s.auto_close ? "مفعّل" : "معطّل"}`
                : "لم تُضبط اليومية بعد — الإقفال يدوي"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <Button variant="outline" onClick={() => setSettingsOpen(true)} disabled={settings.isError}>
                <Settings2 className="h-4 w-4" />
                ضبط اليومية
              </Button>
            )}
            <Button variant="outline" disabled={!exportReady || exporting !== null} onClick={() => void runExport("xlsx")}>
              <FileSpreadsheet className="h-4 w-4" />
              {exporting === "xlsx" ? "جارٍ التجهيز…" : "تنزيل Excel"}
            </Button>
            <Button variant="outline" disabled={!exportReady || exporting !== null} onClick={() => void runExport("pdf")}>
              <FileDown className="h-4 w-4" />
              {exporting === "pdf" ? "جارٍ التجهيز…" : "تنزيل PDF"}
            </Button>
          </div>
        </CardContent>
        {dayRows.length > 1 && (
          <CardContent className="flex flex-wrap items-center gap-2 pt-0">
            <span className="text-xs text-muted-foreground">يوميات هذا التاريخ:</span>
            {dayRows.map((row) => (
              <Button
                key={row.business_day_id}
                size="sm"
                variant={row.business_day_id === shownId ? "default" : "outline"}
                onClick={() => setPickedDayId(row.business_day_id)}
              >
                رقم {row.day_number}
                {row.is_open ? " — مفتوحة" : ""}
              </Button>
            ))}
          </CardContent>
        )}
      </Card>

      {(days.isLoading || currentDate.isLoading) && <Skeleton className="h-40 w-full" />}

      {!days.isLoading && !currentDate.isLoading && !shown && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {date === currentDate.data
              ? "لم تُفتح يومية اليوم بعد — تُفتح تلقائيًا مع أوّل فاتورة."
              : "لا يومية في هذا التاريخ."}
          </CardContent>
        </Card>
      )}

      {shown && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck className="h-5 w-5" />
                  {`اليومية رقم ${shown.day_number}${shown.is_open ? " — مفتوحة" : ""}`}
                </CardTitle>
                <CardDescription>
                  يوم العمل {shown.business_date} · فُتحت {formatDateTime(shown.opened_at, calendarDisplay)}
                  {shown.closed_at
                    ? ` · أُقفلت ${formatDateTime(shown.closed_at, calendarDisplay)}${shown.auto_closed ? " تلقائيًا" : ""}`
                    : shown.scheduled_close_at
                      ? ` · تُقفل تلقائيًا ${formatDateTime(shown.scheduled_close_at, calendarDisplay)}`
                      : " · لم تُقفل بعد"}
                </CardDescription>
              </div>
              {shown.is_open && canManage && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">ملاحظة الإقفال (اختيارية)</Label>
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
                          "سيُقفل يوم العمل الحالي الآن قبل موعده. كل فاتورة بعد الإقفال تُحسب في يومية جديدة. متابعة؟",
                        )
                      )
                        closeDay.mutate();
                    }}
                  >
                    <Lock className="h-4 w-4" />
                    {closeDay.isPending ? "جارٍ الإقفال..." : "تقفيل اليومية الآن"}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="عدد الفواتير" value={String(shown.invoices_count)} />
            <Metric label="الإجمالي قبل الخصم" value={formatAmount(shown.gross_amount)} />
            <Metric label="الخصومات" value={formatAmount(shown.discount_amount)} />
            <Metric label="الضريبة" value={formatAmount(shown.vat_amount)} />
            <Metric label="صافي الفواتير" value={formatAmount(shown.net_amount)} strong />
            <Metric label="المحصَّل فعليًا" value={formatAmount(shown.net_collected_amount)} strong tone="emerald" />
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
        </Card>
      )}

      {shown && (
        <>
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

        </>
      )}

      {settingsOpen && organizationId && (
        <BusinessDaySettingsDialog
          organizationId={organizationId}
          current={s ?? null}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

/**
 * ضبط اليومية: متى يبدأ يوم العمل ومتى ينتهي، وهل تُقفل اليومية وحدها.
 * النهاية قبل البداية أو مساويةٌ لها تعني أنّ اليوم يمتدّ بعد منتصف الليل.
 */
function BusinessDaySettingsDialog({
  organizationId,
  current,
  onClose,
  onSaved,
}: {
  organizationId: string;
  current: BusinessDaySettings | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [start, setStart] = useState(hhmm(current?.day_start) || "08:00");
  const [end, setEnd] = useState(hhmm(current?.day_end) || "00:00");
  const [autoClose, setAutoClose] = useState(current?.auto_close ?? true);
  const crossesMidnight = end <= start;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_set_business_day_settings", {
        p_organization_id: organizationId,
        p_day_start: start,
        p_day_end: end,
        p_auto_close: autoClose,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "حُفظ ضبط اليومية", description: "يسري على اليومية المفتوحة وما بعدها" });
      onSaved();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حفظ الضبط", description: errorMessage(error) }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ضبط اليومية</DialogTitle>
          <DialogDescription>
            وقت بداية يوم العمل ونهايته بتوقيت الرياض. عند النهاية تُقفل اليومية تلقائيًا، وأوّل فاتورة بعدها
            تفتح يومية جديدة.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>بداية يوم العمل</Label>
            <Input type="time" value={start} onChange={(event) => setStart(event.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نهاية يوم العمل</Label>
            <Input type="time" value={end} onChange={(event) => setEnd(event.target.value)} dir="ltr" />
          </div>
        </div>
        <p className="rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
          {crossesMidnight
            ? `يمتدّ يوم العمل بعد منتصف الليل: من ${start} حتى ${end} من اليوم التالي، وفواتير ما بعد منتصف الليل تُحسب لليوم السابق.`
            : `يوم العمل من ${start} حتى ${end}. ما يُسجَّل بعد ${end} وقبل ${start} يُحسب ليوم العمل التالي.`}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={autoClose} onCheckedChange={(checked) => setAutoClose(Boolean(checked))} />
          إقفال اليومية تلقائيًا عند نهاية يوم العمل
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!start || !end || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ…" : "حفظ الضبط"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
