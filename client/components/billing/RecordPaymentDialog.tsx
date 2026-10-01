/**
 * نافذة تسجيل الدفعة والاسترداد — مكوّن مشترك.
 *
 * أُخرجت من `pages/Billing.tsx` لتفتحها شاشة الفواتير وملفّ المريض سواءً.
 * نسخةٌ ثانية كانت تعني قواعد قبضٍ ثانية تتباعد عن الأولى مع كل تعديل:
 * صندوقٌ يُفحص هنا ولا يُفحص هناك، ومناوبةٌ تُشترط في شاشة وتُهمَل في أخرى —
 * وكلاهما يكتب في `financial_vouchers` نفسه.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDate, formatDateTime, formatTime, useLocaleSettings } from "@/lib/locale";
import type { SalesInvoiceStatus, SalesInvoiceWithPatient } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/lib/permissions";
import TaxSettingsTab, {
  EInvoicePanel,
  VatReturnPanel,
  TaxInvoicePreview,
} from "@/components/billing/TaxSettingsTab";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import CenteredPicker from "@/components/shared/CenteredPicker";

export type PaymentMethodRow = {
  id: string;
  code: string | null;
  name_ar: string;
  affects_drawer: boolean;
};

export function usePaymentMethods() {
  return useQuery({
    queryKey: ["payment-methods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lookup_values")
        .select("id, code, name_ar, extra, category:lookup_categories!inner(key)")
        .eq("lookup_categories.key", "payment_methods")
        .eq("is_disabled", false)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        code: r.code,
        name_ar: r.name_ar,
        affects_drawer: Boolean(r.extra?.affects_drawer),
      })) as PaymentMethodRow[];
    },
  });
}

export function useCashRegisters(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["cash-registers", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("id, name, branch_id, requires_shift")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        name: string;
        branch_id: string | null;
        requires_shift: boolean;
      }[];
    },
  });
}

export function useOpenShift(registerId: string) {
  return useQuery({
    queryKey: ["open-shift", registerId],
    enabled: Boolean(registerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_register_shifts")
        .select("id, shift_number, opened_at, opening_balance")
        .eq("cash_register_id", registerId)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; shift_number: number; opening_balance: number } | null;
    },
  });
}

export function useInvoicePayments(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ["invoice-payments", invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voucher_invoice_allocations")
        .select(
          "id, amount, voucher:financial_vouchers(id, voucher_number, voucher_type, voucher_date, is_void, void_reason, description, refund_of_voucher_id, method:lookup_values!financial_vouchers_payment_method_value_id_fkey(name_ar))",
        )
        .eq("sales_invoice_id", invoiceId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function RecordPaymentDialog({
  invoice,
  onOpenChange,
  organizationId,
}: {
  invoice: SalesInvoiceWithPatient | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const methods = usePaymentMethods();
  const registers = useCashRegisters(organizationId);
  const payments = useInvoicePayments(invoice?.id);

  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [reference, setReference] = useState("");
  const [refundMode, setRefundMode] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const shift = useOpenShift(registerId);
  const method = (methods.data ?? []).find((m) => m.id === methodId);
  const needsDrawer = Boolean(method?.affects_drawer);
  const register = (registers.data ?? []).find((r) => r.id === registerId);
  const shiftMissing = needsDrawer && register?.requires_shift && !shift.data;

  const remaining = Number(invoice?.remaining_amount ?? 0);
  const paid = Number(invoice?.paid_amount ?? 0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-payments", invoice?.id] });
    queryClient.invalidateQueries({ queryKey: ["open-shift", registerId] });
    queryClient.invalidateQueries({ queryKey: ["cash-shifts", organizationId] });
    // سجلّ فواتير المريض وتفاصيل الفاتورة يقرآن `remaining_amount` نفسه:
    // بلا إبطالهما يبقى «متبقّي 28.75» معروضًا بعد قبضه فيُقبض مرّتين.
    queryClient.invalidateQueries({ queryKey: ["patient-invoices"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-details", invoice?.id] });
  };

  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: errorMessage(error),
    });

  const reset = () => {
    setAmount("");
    setReference("");
    setRefundReason("");
    setRefundMode(false);
  };

  const receive = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("لا فاتورة");
      if (!methodId) throw new Error("اختر طريقة الدفع");
      const value = Number(amount);
      if (!value || value <= 0) throw new Error("أدخل مبلغًا صحيحًا");
      const { error } = await supabase.rpc("app_receive_invoice_payment", {
        p_invoice_id: invoice.id,
        p_amount: value,
        p_payment_method_value_id: methodId,
        p_cash_register_id: needsDrawer ? registerId || null : registerId || null,
        p_reference: reference.trim() || null,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "سُجّلت الدفعة" });
      reset();
    },
    onError: fail("تعذر تسجيل الدفعة"),
  });

  const refund = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("لا فاتورة");
      const value = Number(amount);
      if (!value || value <= 0) throw new Error("أدخل مبلغًا صحيحًا");
      if (!refundReason.trim()) throw new Error("اكتب سبب الاسترداد");
      const { error } = await supabase.rpc("app_refund_invoice_payment", {
        p_invoice_id: invoice.id,
        p_amount: value,
        p_reason: refundReason.trim(),
        p_cash_register_id: registerId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "سُجّل الاسترداد" });
      reset();
    },
    onError: fail("تعذر الاسترداد"),
  });

  const voidVoucher = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_void_financial_voucher", {
        p_voucher_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "أُلغي السند وأُعيد حساب الفاتورة" });
    },
    onError: fail("تعذر إلغاء السند"),
  });

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{refundMode ? "استرداد" : "تسجيل دفعة"}</DialogTitle>
          <DialogDescription>
            فاتورة #{invoice?.invoice_number} — الإجمالي{" "}
            {formatAmount(invoice?.net_amount ?? 0)} · المحصَّل{" "}
            {formatAmount(paid)} · المتبقّي {formatAmount(remaining)} ر.س
          </DialogDescription>
        </DialogHeader>

        {can("billing.refund") && paid > 0 && (
          <div className="flex rounded-lg border p-0.5">
            <Button
              size="sm"
              className="flex-1"
              variant={!refundMode ? "default" : "ghost"}
              onClick={() => setRefundMode(false)}
            >
              تحصيل
            </Button>
            <Button
              size="sm"
              className="flex-1"
              variant={refundMode ? "destructive" : "ghost"}
              onClick={() => setRefundMode(true)}
            >
              استرداد
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المبلغ *</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAmount(String(refundMode ? paid : remaining))}
              >
                الكل
              </Button>
            </div>
          </div>
          {!refundMode && (
            <div className="flex flex-col gap-1.5">
              <Label>طريقة الدفع *</Label>
              <CenteredPicker
                title="طريقة الدفع"
                placeholder="اختر الطريقة"
                value={methodId}
                onChange={setMethodId}
                loading={methods.isLoading}
                searchable={false}
                options={(methods.data ?? []).map((m) => ({
                  value: m.id,
                  label: m.name_ar,
                  hint: m.affects_drawer ? "نقد — يدخل الصندوق" : undefined,
                }))}
              />
            </div>
          )}
          {(needsDrawer || refundMode) && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>الصندوق {needsDrawer ? "*" : ""}</Label>
              <Select value={registerId} onValueChange={setRegisterId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الصندوق" />
                </SelectTrigger>
                <SelectContent>
                  {(registers.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {shiftMissing && (
                <p className="text-xs text-destructive">
                  لا مناوبة مفتوحة على هذا الصندوق — افتح مناوبة من تبويب الصناديق قبل القبض
                  النقدي.
                </p>
              )}
              {needsDrawer && shift.data && (
                <p className="text-xs text-emerald-700">
                  مناوبة #{shift.data.shift_number} مفتوحة برصيد افتتاحي{" "}
                  {formatAmount(shift.data.opening_balance)} ر.س
                </p>
              )}
            </div>
          )}
          {!refundMode && !needsDrawer && methodId && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>مرجع العملية</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="رقم الحوالة أو العملية"
                dir="ltr"
              />
            </div>
          )}
          {refundMode && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>سبب الاسترداد *</Label>
              <Textarea
                rows={2}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          )}
        </div>

        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          الدفع المختلط: سجّل كل وسيلة دفعةً مستقلّة — نقدًا ثم مدى مثلًا — والفاتورة تجمعها.
        </p>

        <TaxInvoicePreview invoiceId={invoice?.id ?? null} />

        {(payments.data ?? []).length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">سندات هذه الفاتورة</h4>
              {(payments.data ?? []).map((a) => {
                const v = Array.isArray(a.voucher) ? a.voucher[0] : a.voucher;
                if (!v) return null;
                const isRefund = Boolean(v.refund_of_voucher_id);
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div>
                      <span className={isRefund ? "text-rose-700" : "text-emerald-700"}>
                        {isRefund ? "استرداد" : "قبض"} #{v.voucher_number} —{" "}
                        {formatAmount(a.amount)} ر.س
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(v.voucher_date)}
                        {v.method?.name_ar ? ` · ${v.method.name_ar}` : ""}
                        {v.is_void ? ` · ملغى: ${v.void_reason ?? ""}` : ""}
                      </span>
                    </div>
                    {!v.is_void && can("billing.void") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const reason = window.prompt("سبب إلغاء السند؟");
                          if (reason && reason.trim())
                            voidVoucher.mutate({ id: v.id, reason: reason.trim() });
                        }}
                      >
                        إلغاء السند
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          {refundMode ? (
            <Button
              variant="destructive"
              disabled={!amount || !refundReason.trim() || refund.isPending}
              onClick={() => refund.mutate()}
            >
              {refund.isPending ? "جارٍ الاسترداد..." : "تنفيذ الاسترداد"}
            </Button>
          ) : (
            <Button
              disabled={!amount || !methodId || shiftMissing || receive.isPending}
              onClick={() => receive.mutate()}
            >
              {receive.isPending ? "جارٍ الحفظ..." : "تسجيل الدفعة"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
