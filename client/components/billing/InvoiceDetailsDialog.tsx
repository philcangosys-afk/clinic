import { useQuery } from "@tanstack/react-query";
import { Receipt, WalletCards } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDateTime, useLocaleSettings } from "@/lib/locale";
import {
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_LABELS,
  invoiceAcceptsPayment,
} from "@/lib/invoice-status";
import { useInvoicePayments } from "@/components/billing/RecordPaymentDialog";
import type { SalesInvoiceStatus, SalesInvoiceWithPatient } from "@/lib/database.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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

/**
 * تفاصيل الفاتورة — بنودها ومبالغها ودفعاتها.
 *
 * **العيب الذي تعالجه:** سجلّ الفواتير في ملفّ المريض كان صفوفًا غير قابلة
 * للضغط: يرى الموظّف «فاتورة #24 · متبقّي 28.75» ولا يستطيع أن يعرف **ممّ**
 * تتكوّن ولا أن يقبض المتبقّي. فيغادر الملفّ إلى شاشة الفواتير ويبحث عن
 * الفاتورة من جديد — أو يفتح فاتورة ثانية للمريض نفسه.
 *
 * البنود والدفعات تُجلب عند الفتح لا مع القائمة: تحميل بنود ثلاثين فاتورة
 * مقدّمًا لأجل واحدة قد تُفتح هدرٌ في كل فتح للملفّ.
 */

type InvoiceItemRow = {
  id: string;
  description: string | null;
  qty: number;
  price: number;
  discount_amount: number;
  vat_amount: number;
  exemption_amount: number | null;
  net_amount: number;
};

const INVOICE_COLUMNS =
  "id, invoice_number, invoice_type, created_at, status, is_temporary, note, " +
  "subtotal_amount, discount_amount, vat_amount, exemption_amount, net_amount, " +
  "paid_amount, remaining_amount, patient_id, external_customer_name, " +
  "insurance_share_amount, patient_share_amount, is_insurance_invoice";

export function useInvoiceDetails(invoiceId: string | null | undefined) {
  return useQuery({
    queryKey: ["invoice-details", invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const [invoiceResult, itemsResult] = await Promise.all([
        supabase.from("sales_invoices").select(INVOICE_COLUMNS).eq("id", invoiceId).maybeSingle(),
        supabase
          .from("sales_invoice_items")
          .select("id, description, qty, price, discount_amount, vat_amount, exemption_amount, net_amount")
          .eq("invoice_id", invoiceId)
          .order("created_at", { ascending: true }),
      ]);
      if (invoiceResult.error) throw invoiceResult.error;
      if (itemsResult.error) throw itemsResult.error;
      if (!invoiceResult.data) throw new Error("الفاتورة غير موجودة أو لا تملك الوصول إليها");
      return {
        invoice: invoiceResult.data as unknown as SalesInvoiceWithPatient,
        items: (itemsResult.data ?? []) as unknown as InvoiceItemRow[],
      };
    },
  });
}

export function InvoiceDetailsDialog({
  invoiceId,
  onOpenChange,
  onPay,
  canPay = true,
}: {
  invoiceId: string | null;
  onOpenChange: () => void;
  /** يُمرَّر صفّ الفاتورة كاملًا لتفتح عليه نافذة القبض */
  onPay?: (invoice: SalesInvoiceWithPatient) => void;
  canPay?: boolean;
}) {
  const { calendarDisplay } = useLocaleSettings();
  const details = useInvoiceDetails(invoiceId);
  const payments = useInvoicePayments(invoiceId ?? undefined);

  const invoice = details.data?.invoice;
  const items = details.data?.items ?? [];
  const remaining = Number(invoice?.remaining_amount ?? 0);
  const status = (invoice?.status ?? null) as SalesInvoiceStatus | null;
  const payable = invoiceAcceptsPayment(status, remaining);

  return (
    <Dialog open={Boolean(invoiceId)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Receipt className="h-4 w-4" />
            فاتورة #{invoice?.invoice_number ?? "—"}
            {status && (
              <Badge className={INVOICE_STATUS_BADGE[status]}>{INVOICE_STATUS_LABELS[status]}</Badge>
            )}
            {invoice?.is_temporary && <Badge variant="outline">مؤقّتة</Badge>}
          </DialogTitle>
          <DialogDescription>
            {invoice ? formatDateTime(invoice.created_at, calendarDisplay) : "جارٍ التحميل..."}
          </DialogDescription>
        </DialogHeader>

        {details.isLoading && <Skeleton className="h-48 w-full" />}

        {details.isError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            تعذّر تحميل الفاتورة: {errorMessage(details.error)}
          </p>
        )}

        {invoice && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-sm font-semibold">البنود</p>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الوصف</TableHead>
                      <TableHead className="w-16">الكمية</TableHead>
                      <TableHead className="w-24">السعر</TableHead>
                      <TableHead className="w-24">الخصم</TableHead>
                      <TableHead className="w-24">الضريبة</TableHead>
                      <TableHead className="w-24">الصافي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm">{item.description ?? "—"}</TableCell>
                        <TableCell className="text-sm">{formatAmount(item.qty)}</TableCell>
                        <TableCell className="text-sm">{formatAmount(item.price)}</TableCell>
                        <TableCell className="text-sm">{formatAmount(item.discount_amount)}</TableCell>
                        <TableCell className="text-sm">{formatAmount(item.vat_amount)}</TableCell>
                        <TableCell className="text-sm font-medium">{formatAmount(item.net_amount)}</TableCell>
                      </TableRow>
                    ))}
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                          لا بنود في هذه الفاتورة.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <Amount label="الإجمالي قبل الضريبة" value={invoice.subtotal_amount} />
              <Amount label="الخصم" value={invoice.discount_amount} />
              <Amount label="الضريبة" value={invoice.vat_amount} />
              <Amount label="الإعفاء" value={(invoice as any).exemption_amount} />
              {invoice.is_insurance_invoice && (
                <>
                  <Amount label="حصّة التأمين" value={(invoice as any).insurance_share_amount} />
                  <Amount label="حصّة المريض" value={(invoice as any).patient_share_amount} />
                </>
              )}
              <Separator className="my-1 sm:col-span-2" />
              <Amount label="الصافي" value={invoice.net_amount} strong />
              <Amount label="المدفوع" value={invoice.paid_amount} />
              <Amount label="المتبقّي" value={remaining} tone={remaining > 0 ? "rose" : "emerald"} strong />
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">الدفعات</p>
              {payments.isLoading && <Skeleton className="h-16 w-full" />}
              {!payments.isLoading && (payments.data ?? []).length === 0 && (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  لم تُسجَّل أيّ دفعة على هذه الفاتورة.
                </p>
              )}
              <div className="flex flex-col gap-1">
                {(payments.data ?? []).map((row: any) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        سند #{row.voucher?.voucher_number ?? "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(row.voucher?.voucher_date, calendarDisplay)}
                      </span>
                      {row.voucher?.method?.name_ar && (
                        <Badge variant="secondary">{row.voucher.method.name_ar}</Badge>
                      )}
                      {row.voucher?.is_void && <Badge variant="destructive">ملغى</Badge>}
                      {row.voucher?.refund_of_voucher_id && <Badge variant="outline">استرداد</Badge>}
                    </div>
                    <span className="font-semibold">{formatAmount(row.amount)} ر.س</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {invoice && canPay && payable && onPay && (
            <Button onClick={() => onPay(invoice)}>
              <WalletCards className="h-4 w-4" />
              سداد المتبقّي ({formatAmount(remaining)} ر.س)
            </Button>
          )}
          <Button variant="outline" onClick={onOpenChange}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Amount({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: unknown;
  strong?: boolean;
  tone?: "rose" | "emerald";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={[
          strong ? "font-semibold" : "",
          tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "",
        ].join(" ")}
      >
        {formatAmount(value ?? 0)} ر.س
      </span>
    </div>
  );
}

export default InvoiceDetailsDialog;
