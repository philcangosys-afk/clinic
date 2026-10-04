import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Send } from "lucide-react";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDateTime, useLocaleSettings } from "@/lib/locale";
import {
  fetchZatcaPending,
  reportInvoiceToZatca,
  resolveAmbiguousZatca,
  useZatcaAutoSettings,
  type ZatcaPendingRow,
} from "@/lib/zatca-auto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: { label: "لم تُرسل", className: "bg-muted text-muted-foreground" },
  submitted: { label: "قيد الإرسال", className: "bg-sky-100 text-sky-800" },
  failed: { label: "تعذّر الإرسال", className: "bg-amber-100 text-amber-900" },
  rejected: { label: "مرفوضة", className: "bg-rose-100 text-rose-800" },
  ambiguous: { label: "غير محسومة", className: "bg-rose-200 text-rose-900" },
};

/** مدّة الإبلاغ النظامية للفاتورة المبسّطة — يُنبَّه قبلها. */
const WARN_HOURS = 20;

export function useZatcaPending(organizationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["zatca-pending", organizationId],
    enabled: Boolean(organizationId) && enabled,
    refetchInterval: 60_000,
    retry: false,
    queryFn: () => fetchZatcaPending(organizationId!),
  });
}

/**
 * «فواتير لم تُبلَّغ» — الصادرة منذ بدء الإبلاغ ولم تقبلها ZATCA في الإنتاج
 * بعد، بحالتها وآخر خطأ وعمرها. تُرسل واحدةً أو كلّها بالترتيب من الأقدم.
 */
export default function ZatcaPendingDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const { calendarDisplay } = useLocaleSettings();
  const queryClient = useQueryClient();
  const settings = useZatcaAutoSettings(organizationId);
  const pending = useZatcaPending(organizationId, open);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const canSend = can("billing.issue");
  const rows = pending.data ?? [];
  const blocked = rows.some((row) => row.zatca_status === "ambiguous");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["zatca-pending"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-zatca"] });
  };

  const sendOne = async (row: ZatcaPendingRow) => {
    setSendingId(row.invoice_id);
    const result = await reportInvoiceToZatca(row.invoice_id);
    setSendingId(null);
    refresh();
    toast(
      result.ok
        ? { title: `${row.label}: ${result.message}` }
        : { variant: "destructive", title: `لم تُقبل ${row.label}`, description: result.message },
    );
    return result;
  };

  /** «غير محسومة»: إعادة المستند الموقّع نفسه — يحسمها ويُطلق الجهاز (0224) */
  const resolveOne = async (row: ZatcaPendingRow) => {
    setSendingId(row.invoice_id);
    const result = await resolveAmbiguousZatca(row.invoice_id);
    setSendingId(null);
    refresh();
    toast(
      result.ok
        ? { title: `${row.label}: ${result.message}`, description: "يمكن الآن إرسال بقيّة الفواتير، والإبلاغ التلقائيّ يستأنف وحده." }
        : {
            variant: "destructive",
            title: result.resolved ? `${row.label}: حُسمت — مرفوضة` : `${row.label}: لم تُحسم بعد`,
            description: result.message,
          },
    );
  };

  const sendAll = async () => {
    const queue = rows.filter((row) => row.zatca_status !== "ambiguous" && row.zatca_status !== "submitted");
    setBulk({ done: 0, total: queue.length });
    let ok = 0;
    let failed = 0;
    for (const [index, row] of queue.entries()) {
      setSendingId(row.invoice_id);
      const result = await reportInvoiceToZatca(row.invoice_id);
      if (result.ok) ok += 1;
      else failed += 1;
      setBulk({ done: index + 1, total: queue.length });
      if (result.ambiguous) break;
    }
    setSendingId(null);
    setBulk(null);
    refresh();
    toast({
      variant: failed ? "destructive" : "default",
      title: `أُبلغت ${ok} فاتورة${failed ? ` — وتعذّرت ${failed}` : ""}`,
      description: failed ? "سبب كلّ فاتورة في عمود «آخر خطأ»." : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>فواتير لم تُبلَّغ ZATCA</DialogTitle>
          <DialogDescription>
            الفواتير الصادرة منذ بدء الإبلاغ
            {settings.data?.zatca_report_from
              ? ` (${formatDateTime(settings.data.zatca_report_from, calendarDisplay)})`
              : ""}{" "}
            ولم تقبلها ZATCA في الإنتاج بعد. الفاتورة المبسّطة تُبلَّغ خلال 24 ساعة من إصدارها.
          </DialogDescription>
        </DialogHeader>

        {!settings.isLoading && !settings.data?.zatca_report_from && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            لم يُحدَّد تاريخ بدء الإبلاغ بعد — حدّده من «الربط مع ZATCA» ← الإبلاغ التلقائيّ.
          </p>
        )}
        {settings.data?.zatca_report_from && !settings.data.zatca_auto_report && (
          <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
            الإبلاغ التلقائيّ متوقّف — الإرسال من هنا يدويّ.
          </p>
        )}
        {blocked && (
          <p className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            فاتورةٌ نتيجتها غير محسومة (انقطع الاتصال بـZATCA أثناء إرسالها) أوقفت الإرسال. اضغط
            «إعادة المستند نفسه» عليها: يُرسَل المستند الموقّع ذاته فيُحسم، ثمّ يستأنف الإبلاغ لبقيّة الفواتير.
          </p>
        )}
        {pending.isLoading && <Skeleton className="h-40 w-full" />}
        {pending.isError && (
          <p className="text-sm text-destructive">تعذّرت القراءة: {errorMessage(pending.error)}</p>
        )}
        {!pending.isLoading && !pending.isError && (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفاتورة</TableHead>
                  <TableHead>الإصدار</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الصافي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>منذ</TableHead>
                  <TableHead className="min-w-[14rem]">آخر خطأ</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const meta = STATUS_LABEL[row.zatca_status] ?? STATUS_LABEL.pending;
                  const late = row.hours_pending >= WARN_HOURS;
                  return (
                    <TableRow key={row.invoice_id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {row.label}
                        {row.document_type !== "invoice" && (
                          <span className="ms-1 text-muted-foreground">
                            ({row.document_type === "credit_note" ? "إشعار دائن" : "إشعار مدين"})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTime(row.issued_at, calendarDisplay)}
                      </TableCell>
                      <TableCell className="text-sm">{row.customer_name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{formatAmount(row.net_amount)}</TableCell>
                      <TableCell>
                        <Badge className={meta.className}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className={`whitespace-nowrap font-mono text-xs ${late ? "font-bold text-rose-700" : ""}`}>
                        {row.hours_pending} س
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground" dir="auto">
                        {row.last_error ?? "—"}
                      </TableCell>
                      <TableCell>
                        {canSend && row.zatca_status === "ambiguous" && (
                          <Button
                            size="sm"
                            className="bg-rose-600 text-white hover:bg-rose-700"
                            disabled={Boolean(sendingId)}
                            title="يُعاد إرسال المستند الموقّع نفسه (نفس الرقم والبصمة) — لا يُنشأ مستند جديد"
                            onClick={() => void resolveOne(row)}
                          >
                            {sendingId === row.invoice_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            إعادة المستند نفسه
                          </Button>
                        )}
                        {canSend && row.zatca_status !== "ambiguous" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={Boolean(sendingId) || blocked}
                            onClick={() => void sendOne(row)}
                          >
                            {sendingId === row.invoice_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            إرسال
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      {settings.data?.zatca_report_from ? "كلّ الفواتير مُبلَّغة." : "—"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {bulk ? `جارٍ الإرسال ${bulk.done} من ${bulk.total}…` : `${rows.length} فاتورة`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={refresh} disabled={Boolean(sendingId)}>
              <RefreshCw className="h-4 w-4" />
              تحديث
            </Button>
            {canSend && (
              <Button disabled={rows.length === 0 || Boolean(sendingId) || blocked} onClick={() => void sendAll()}>
                <Send className="h-4 w-4" />
                إرسال الكلّ
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
