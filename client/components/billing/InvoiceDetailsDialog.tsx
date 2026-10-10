import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Printer, Receipt, RefreshCw, Stethoscope, WalletCards } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDate, formatDateTime, useLocaleSettings } from "@/lib/locale";
import {
  INVOICE_STATUS_BADGE,
  INVOICE_STATUS_LABELS,
  invoiceAcceptsPayment,
} from "@/lib/invoice-status";
import { useInvoicePayments } from "@/components/billing/RecordPaymentDialog";
import InvoiceActions from "@/components/billing/InvoiceActions";
import ZatcaInvoicePanel from "@/components/billing/ZatcaInvoicePanel";
import { printPaymentReceipt } from "@/lib/payment-receipt";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  "paid_amount, remaining_amount, patient_id, external_customer_name, doctor_id, " +
  "patient:patients!sales_invoices_patient_tenant_fk(name_ar, file_number), " +
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

/**
 * دفعات الفاتورة بهويّتها الكاملة — من `v_invoice_payments` (0162).
 *
 * `useInvoicePayments` القديم يقرأ التخصيصات ويجلب معها السند بعلاقةٍ
 * متداخلة، فلا يصل منه اسم الصندوق ولا الطبيب ولا المستخدم ولا الجهاز.
 * والمنظور يجمعها في صفٍّ واحد — واحدةٌ من مهامّ المنظورات.
 *
 * ويبقى الخطّاف القديم مستعمَلًا في نافذة القبض (قائمةٌ مختصرة تكفيها)،
 * فلا يُحذف ولا يُوسَّع بما لا تحتاجه.
 */
export function useInvoicePaymentGrid(invoiceId: string | null | undefined) {
  return useQuery({
    queryKey: ["invoice-payment-grid", invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_invoice_payments")
        .select(
          "allocation_id, voucher_id, voucher_number, voucher_date, movement_label, " +
            "payment_method_name, register_name, doctor_name, user_name, amount, " +
            "device_name, note, bank_transfer_ref, is_void, void_reason, is_refund",
        )
        .eq("invoice_id", invoiceId)
        .order("voucher_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/**
 * مقاس ورق الإيصال وسطر العنوان — من `print_settings` لا مثبَّتَين في الشاشة.
 * المنشأة التي تطبع على شريط حراريّ 80 مم لا تريد A4 لسند قبض.
 */
function useReceiptPrintSettings(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["receipt-print-settings", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("print_settings")
        .select("receipt_paper_size, invoice_address_line")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as {
        receipt_paper_size: "a4" | "thermal_80mm";
        invoice_address_line: string | null;
      } | null;
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
  const { organization, session, membership } = useOrganizationAccess();
  const printSettings = useReceiptPrintSettings(organization?.id);
  const queryClient = useQueryClient();
  const details = useInvoiceDetails(invoiceId);
  const payments = useInvoicePaymentGrid(invoiceId);
  const { can } = usePermissions();
  const canCorrectMethod = can("billing.issue") || can("billing.void");
  const [correcting, setCorrecting] = useState<any | null>(null);
  const [fixingDoctor, setFixingDoctor] = useState(false);
  const canFixDoctor = DOCTOR_FIX_ROLES.includes(membership?.role_key ?? "");

  const invoice = details.data?.invoice;
  const items = details.data?.items ?? [];
  const remaining = Number(invoice?.remaining_amount ?? 0);
  const status = (invoice?.status ?? null) as SalesInvoiceStatus | null;
  const payable = invoiceAcceptsPayment(status, remaining);
  // PostgREST يُعيد العلاقة كائنًا أو مصفوفةً بحسب استنتاجه للتفرّد
  const patientRelation = (invoice as any)?.patient;
  const patientRow = Array.isArray(patientRelation) ? patientRelation[0] ?? null : patientRelation ?? null;
  const patientLabel = patientRow?.name_ar ?? null;
  const patientFileNumber = patientRow?.file_number ?? null;

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
          {invoiceId && (
            <InvoiceActions
              invoiceId={invoiceId}
              printedByName={null}
              variant="labeled"
              className="pt-1"
            />
          )}
        </DialogHeader>

        {details.isLoading && <Skeleton className="h-48 w-full" />}

        {details.isError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            تعذّر تحميل الفاتورة: {errorMessage(details.error)}
          </p>
        )}

        {/* حالة ZATCA والإرسال — مكوّنٌ مستقلّ باستعلامه: لو لم تُنفَّذ ترقيات
            الربط بعد تعطّل هو وحده، لا تفاصيل الفاتورة كلّها */}
        {invoiceId && invoice && <ZatcaInvoicePanel invoiceId={invoiceId} />}

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

            <InvoiceDoctorLine
              organizationId={organization?.id}
              doctorId={(invoice as any).doctor_id ?? null}
              canFix={canFixDoctor && status !== "void"}
              onFix={() => setFixingDoctor(true)}
            />

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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">الدفعات</p>
                <div className="flex flex-wrap gap-1">
                  {canPay && payable && onPay && (
                    <Button size="sm" variant="outline" onClick={() => onPay(invoice)}>
                      <WalletCards className="h-3.5 w-3.5" />
                      دفعة جديدة
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // إبطالُ الترويسة مع الشبكة: «المدفوع» و«المتبقّي» يُقرآن
                      // من الفاتورة لا من الشبكة، وتحديثُ إحداهما وحدها يترك
                      // الرقمين متناقضين على الشاشة نفسها.
                      queryClient.invalidateQueries({ queryKey: ["invoice-payment-grid", invoiceId] });
                      queryClient.invalidateQueries({ queryKey: ["invoice-details", invoiceId] });
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    تحديث الدفعات
                  </Button>
                </div>
              </div>

              {payments.isLoading && <Skeleton className="h-16 w-full" />}
              {payments.isError && (
                <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  تعذّر تحميل الدفعات: {errorMessage(payments.error)} — إن لم تُنفَّذ الترقية{" "}
                  <span className="font-mono">0162</span> على القاعدة بعد، نفِّذها.
                </p>
              )}
              {!payments.isLoading && !payments.isError && (payments.data ?? []).length === 0 && (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  لم تُسجَّل أيّ دفعة على هذه الفاتورة.
                </p>
              )}
              {(payments.data ?? []).length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">رقم السند</TableHead>
                        <TableHead className="whitespace-nowrap">التاريخ</TableHead>
                        <TableHead className="whitespace-nowrap">نوع</TableHead>
                        <TableHead className="whitespace-nowrap">الحساب</TableHead>
                        <TableHead className="whitespace-nowrap">اسم الطبيب</TableHead>
                        <TableHead className="whitespace-nowrap">المستخدم</TableHead>
                        <TableHead className="whitespace-nowrap">قيمة</TableHead>
                        <TableHead className="whitespace-nowrap">اسم الجهاز</TableHead>
                        <TableHead className="min-w-[8rem]">ملاحظة</TableHead>
                        <TableHead className="w-12"> </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(payments.data ?? []).map((row: any) => {
                        const value = Number(row.amount ?? 0);
                        return (
                          <TableRow key={row.allocation_id} className={row.is_void ? "opacity-60" : undefined}>
                            <TableCell className="whitespace-nowrap font-medium tabular-nums">
                              <span className="flex flex-wrap items-center gap-1">
                                {row.voucher_number ?? "—"}
                                {row.is_void && <Badge variant="destructive" className="text-[10px]">ملغى</Badge>}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs tabular-nums">
                              {formatDate(row.voucher_date, calendarDisplay)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              <Badge variant={row.is_refund ? "outline" : "secondary"}>
                                {row.movement_label ?? "—"}
                              </Badge>
                              {row.payment_method_name && (
                                <span className="ms-1 text-muted-foreground">{row.payment_method_name}</span>
                              )}
                              {canCorrectMethod && !row.is_void && (
                                <button
                                  type="button"
                                  onClick={() => setCorrecting(row)}
                                  title="تصحيح طريقة الدفع — لا يمسّ الفاتورة ولا ZATCA"
                                  className="ms-1.5 inline-flex items-center gap-0.5 rounded border border-primary/40 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10"
                                >
                                  <CreditCard className="h-3 w-3" />
                                  تصحيح
                                </button>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{row.register_name ?? "—"}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{row.doctor_name ?? "—"}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{row.user_name ?? "—"}</TableCell>
                            <TableCell
                              className={`whitespace-nowrap font-semibold tabular-nums ${value < 0 ? "text-rose-600" : ""}`}
                            >
                              {formatAmount(value)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{row.device_name ?? "—"}</TableCell>
                            <TableCell className="text-xs">{row.note ?? "—"}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="طباعة الدفعة"
                                onClick={() =>
                                  printPaymentReceipt(row, {
                                    sellerName: organization?.name ?? null,
                                    addressLine: printSettings.data?.invoice_address_line ?? null,
                                    invoiceNumber: invoice.invoice_number,
                                    patientName:
                                      patientLabel ??
                                      (invoice as any).external_customer_name ??
                                      null,
                                    fileNumber: patientFileNumber,
                                    invoiceNet: invoice.net_amount,
                                    invoicePaid: invoice.paid_amount,
                                    invoiceRemaining: remaining,
                                    calendarDisplay,
                                    paper: printSettings.data?.receipt_paper_size ?? "thermal_80mm",
                                    printedByName: session?.user.email ?? null,
                                  })
                                }
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}

        <CorrectPaymentMethodDialog
          row={correcting}
          organizationId={organization?.id}
          onClose={() => setCorrecting(null)}
          onDone={() => {
            setCorrecting(null);
            queryClient.invalidateQueries({ queryKey: ["invoice-payment-grid", invoiceId] });
            queryClient.invalidateQueries({ queryKey: ["invoice-payments"] });
          }}
        />

        {fixingDoctor && invoice && (
          <CorrectInvoiceDoctorDialog
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoice_number}
            organizationId={organization?.id}
            currentDoctorId={(invoice as any).doctor_id ?? null}
            onClose={() => setFixingDoctor(false)}
            onDone={() => {
              setFixingDoctor(false);
              queryClient.invalidateQueries({ queryKey: ["invoice-details", invoiceId] });
              queryClient.invalidateQueries({ queryKey: ["invoice-payment-grid", invoiceId] });
              // قوائم الفواتير واليومية وتقارير الأطباء تقرأ الطبيب من الفاتورة
              queryClient.invalidateQueries({
                predicate: (query) =>
                  typeof query.queryKey[0] === "string" &&
                  /invoice|business-day|report|revenue|doctor/i.test(query.queryKey[0] as string),
              });
            }}
          />
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

/**
 * تصحيح طريقة الدفع على سندٍ واحد (0232).
 *
 * طريقة الدفع تعيش في سند القبض لا في الفاتورة، ولا تدخل مستند ZATCA للفاتورة
 * العادية — فتصحيحها لا يمسّ الفاتورة ولا توقيعها ولا رمزها. بسببٍ مكتوب
 * وسطرٍ في سجلّ التدقيق. وما يمسّ النقد (نقدي ↔ بطاقة) تمنعه القاعدة بعد
 * إقفال المناوبة أو اليومية.
 */
function CorrectPaymentMethodDialog({
  row,
  organizationId,
  onClose,
  onDone,
}: {
  row: any | null;
  organizationId: string | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [methodId, setMethodId] = useState("");
  const [reason, setReason] = useState("");

  const voucher = useQuery({
    queryKey: ["voucher-method", row?.voucher_id],
    enabled: Boolean(row?.voucher_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_vouchers")
        .select("id, payment_method_value_id")
        .eq("id", row!.voucher_id)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; payment_method_value_id: string | null } | null;
    },
  });

  const methods = useQuery({
    queryKey: ["pc-payment-methods", organizationId],
    enabled: Boolean(organizationId) && Boolean(row),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reference_data")
        .select("value_id, code, name_ar, category_key, is_disabled, organization_id, sort_order")
        .eq("category_key", "payment_methods")
        .eq("is_disabled", false)
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("sort_order")
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { value_id: string; name_ar: string }[];
    },
  });

  const currentId = voucher.data?.payment_method_value_id ?? null;
  const choices = (methods.data ?? []).filter((m) => m.value_id !== currentId);

  const close = () => {
    setMethodId("");
    setReason("");
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!row) return;
      if (!methodId) throw new Error("اختر طريقة الدفع الصحيحة");
      if (!reason.trim()) throw new Error("اكتب سبب التصحيح");
      const { error } = await supabase.rpc("app_correct_voucher_payment_method", {
        p_voucher_id: row.voucher_id,
        p_payment_method_value_id: methodId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const name = (methods.data ?? []).find((m) => m.value_id === methodId)?.name_ar ?? "";
      toast({ title: "صُحّحت طريقة الدفع", description: `السند ${row?.voucher_number ?? ""} صار «${name}».` });
      setMethodId("");
      setReason("");
      onDone();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر التصحيح", description: errorMessage(error) }),
  });

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && !save.isPending && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تصحيح طريقة الدفع — سند {row?.voucher_number ?? ""}</DialogTitle>
          <DialogDescription>
            المبلغ {formatAmount(Number(row?.amount ?? 0))} ر.س · المسجَّل الآن: «{row?.payment_method_name ?? "غير محدَّدة"}».
            التصحيح على السند وحده — الفاتورة ورمز ZATCA لا يتغيّران.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>طريقة الدفع الصحيحة *</Label>
            <Select value={methodId} onValueChange={setMethodId}>
              <SelectTrigger>
                <SelectValue placeholder={methods.isLoading ? "جارٍ التحميل..." : "اختر الطريقة"} />
              </SelectTrigger>
              <SelectContent>
                {choices.map((m) => (
                  <SelectItem key={m.value_id} value={m.value_id}>
                    {m.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سبب التصحيح *</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: اختيرت فيزا بالخطأ والدفع كان بمدى" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            بين البطاقات والتحويلات يُصحَّح دائمًا. وبين النقد والبطاقة لا يُصحَّح بعد إقفال المناوبة أو اليومية — لأنّه يغيّر جرد الصندوق.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={close}>
            إلغاء
          </Button>
          <Button disabled={!methodId || !reason.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ التصحيح"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** من يصحّح طبيب الفاتورة (0236): الاستقبال وإدارة المنشأة — والقاعدة تفرضه. */
const DOCTOR_FIX_ROLES = ["owner", "organization_admin", "receptionist"];

type DoctorOption = { id: string; name_ar: string; is_enabled: boolean };

function useOrgDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["invoice-fix-doctors", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar, is_enabled")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as DoctorOption[];
    },
  });
}

/** سطر «الطبيب المعالج» في الفاتورة، وزرّ تصحيحه لمن يملكه. */
function InvoiceDoctorLine({
  organizationId,
  doctorId,
  canFix,
  onFix,
}: {
  organizationId: string | undefined;
  doctorId: string | null;
  canFix: boolean;
  onFix: () => void;
}) {
  const doctors = useOrgDoctors(organizationId);
  const name = doctorId ? (doctors.data ?? []).find((d) => d.id === doctorId)?.name_ar ?? null : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5">
        <Stethoscope className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">الطبيب المعالج:</span>
        <span className="font-semibold">{doctorId ? name ?? (doctors.isLoading ? "…" : "—") : "بلا طبيب"}</span>
      </span>
      {canFix && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onFix}>
          تصحيح الطبيب
        </Button>
      )}
    </div>
  );
}

/**
 * تصحيح طبيب الفاتورة (0236).
 *
 * الطبيب لا يدخل مستند ZATCA ولا مبالغ الفاتورة، فتصحيحه لا يمسّ الإبلاغ.
 * يتبعه طبيب سندات القبض التي كانت على الطبيب القديم، فتنتقل إيرادات
 * الفاتورة في تقارير الأطباء إلى الطبيب الصحيح. بسببٍ مكتوب وسطرٍ في سجلّ
 * التدقيق.
 */
function CorrectInvoiceDoctorDialog({
  invoiceId,
  invoiceNumber,
  organizationId,
  currentDoctorId,
  onClose,
  onDone,
}: {
  invoiceId: string;
  invoiceNumber: number | string | null | undefined;
  organizationId: string | undefined;
  currentDoctorId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const doctors = useOrgDoctors(organizationId);
  const [doctorId, setDoctorId] = useState("");
  const [reason, setReason] = useState("");
  const currentName = currentDoctorId
    ? (doctors.data ?? []).find((d) => d.id === currentDoctorId)?.name_ar ?? "—"
    : "بلا طبيب";
  const choices = (doctors.data ?? []).filter((d) => d.is_enabled && d.id !== currentDoctorId);

  const save = useMutation({
    mutationFn: async () => {
      if (!doctorId) throw new Error("اختر الطبيب الصحيح");
      if (!reason.trim()) throw new Error("اكتب سبب التصحيح");
      const { error } = await supabase.rpc("app_correct_invoice_doctor", {
        p_invoice_id: invoiceId,
        p_doctor_id: doctorId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const name = choices.find((d) => d.id === doctorId)?.name_ar ?? "";
      toast({ title: "صُحّح طبيب الفاتورة", description: `الفاتورة #${invoiceNumber ?? ""} صارت على «${name}».` });
      onDone();
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر التصحيح", description: errorMessage(error) }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>تصحيح طبيب الفاتورة #{invoiceNumber ?? ""}</DialogTitle>
          <DialogDescription>
            المسجَّل الآن: «{currentName}». يتغيّر الطبيب على الفاتورة وسندات قبضها فقط — المبالغ وZATCA لا تتغيّر.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب الصحيح *</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder={doctors.isLoading ? "جارٍ التحميل..." : "اختر الطبيب"} />
              </SelectTrigger>
              <SelectContent>
                {choices.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سبب التصحيح *</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: اختير د. فلان بالخطأ والمعالج د. فلان"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!doctorId || !reason.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ التصحيح"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
