import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileMinus2, Loader2, RotateCcw } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount } from "@/lib/locale";
import { useToast } from "@/hooks/use-toast";
import type { AgreementListRow, QuoteLineRow } from "@/lib/agreements";
import { invalidateAgreementQueries } from "@/components/agreements/AgreementDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * «تعديل فوترة بدون ضريبة» (0219).
 *
 * فاتورةٌ صدرت من ملفّ المريض لا من الاتفاقية: المريض دفع، والفاتورة الضريبية
 * صدرت وأُبلغت، لكنّ الاتفاقية بقي متبقّيها كأنّه لم يدفع. هنا يُخصم المبلغ من
 * بنود الاتفاقية **بلا فاتورة جديدة ولا ضريبة** — بمرجع الفاتورة الأخرى
 * (من النظام أو رقمٌ يُكتب) وملاحظة. والفوترة الضريبية بعدها من الاتفاقية تخصم
 * من المتبقّي كالمعتاد. لا يُحذف: يُلغى بسببٍ فيعود المبلغ إلى المتبقّي.
 */

const OUTSIDE = "__outside__";

type InvoiceOption = {
  id: string;
  invoice_number: number | null;
  document_prefix: string | null;
  document_number: number | null;
  issued_at: string | null;
  created_at: string;
  net_amount: number;
  agreement_id: string | null;
};

type SettlementRow = {
  batch_id: string;
  created_at: string;
  net_amount: number;
  lines: string | null;
  reference_number: string | null;
  note: string | null;
  is_cancelled: boolean;
  cancel_reason: string | null;
  created_by_name: string | null;
  cancelled_by_name: string | null;
};

function invoiceLabel(row: InvoiceOption) {
  return row.document_prefix && row.document_number != null
    ? `${row.document_prefix}-${row.document_number}`
    : String(row.invoice_number ?? row.id.slice(0, 8));
}

const num = (value: string) => {
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export default function AgreementSettlementDialog({
  open,
  onOpenChange,
  agreement,
  lines,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreement: AgreementListRow;
  /** بنود عرض السعر المفتوح (بمتبقّيها) */
  lines: QuoteLineRow[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [outsideNumber, setOutsideNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const openLines = useMemo(() => lines.filter((line) => Number(line.remaining_amount) > 0.009), [lines]);
  const totalRemaining = openLines.reduce((sum, line) => sum + Number(line.remaining_amount), 0);

  useEffect(() => {
    if (!open) return;
    setInvoiceId("");
    setOutsideNumber("");
    setAmount("");
    setNote("");
    setAlloc({});
  }, [open]);

  const invoices = useQuery({
    queryKey: ["settlement-invoices", agreement.patient_id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("id, invoice_number, document_prefix, document_number, issued_at, created_at, net_amount, agreement_id")
        .eq("patient_id", agreement.patient_id)
        .neq("status", "void")
        .eq("is_temporary", false)
        .eq("invoice_type", "sale")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as InvoiceOption[];
    },
  });

  const history = useQuery({
    queryKey: ["agreement-settlements", agreement.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agreement_settlements")
        .select("*")
        .eq("agreement_id", agreement.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SettlementRow[];
    },
  });

  /** توزيع المبلغ على البنود بالترتيب حتى ينفد — يُعدَّل يدويًّا بعده. */
  const distribute = (value: string) => {
    let left = Math.max(num(value), 0);
    const next: Record<string, string> = {};
    for (const line of openLines) {
      const take = Math.min(left, Number(line.remaining_amount));
      next[line.id] = take > 0 ? String(Math.round(take * 100) / 100) : "";
      left = Math.round((left - take) * 100) / 100;
    }
    setAlloc(next);
  };

  const pickInvoice = (value: string) => {
    setInvoiceId(value);
    if (value && value !== OUTSIDE) {
      const row = (invoices.data ?? []).find((r) => r.id === value);
      if (row && !amount) {
        const suggested = Math.min(Number(row.net_amount), totalRemaining);
        setAmount(String(Math.round(suggested * 100) / 100));
        distribute(String(suggested));
      }
    }
  };

  const allocated = openLines.reduce((sum, line) => sum + num(alloc[line.id] ?? ""), 0);
  const over = openLines.find((line) => num(alloc[line.id] ?? "") > Number(line.remaining_amount) + 0.01);
  const reference = invoiceId === OUTSIDE ? outsideNumber.trim() : invoiceId;
  const mismatch = Math.abs(allocated - num(amount)) > 0.009;
  const canSave = Boolean(reference) && num(amount) > 0 && !mismatch && !over && allocated > 0;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_add_agreement_settlement", {
        p_agreement_id: agreement.id,
        p_lines: openLines
          .filter((line) => num(alloc[line.id] ?? "") > 0)
          .map((line) => ({ agreement_item_id: line.id, amount: num(alloc[line.id] ?? "") })),
        p_reference_invoice_id: invoiceId && invoiceId !== OUTSIDE ? invoiceId : null,
        p_reference_number: invoiceId === OUTSIDE ? outsideNumber.trim() : null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAgreementQueries(queryClient, agreement.id);
      queryClient.invalidateQueries({ queryKey: ["agreement-settlements", agreement.id] });
      toast({
        title: `خُصم ${formatAmount(num(amount))} من الاتفاقية ${agreement.agreement_number}`,
        description: "بلا فاتورة ولا ضريبة — والفوترة القادمة تخصم من المتبقّي كالمعتاد.",
      });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "لم يُحفظ التعديل", description: errorMessage(error) }),
  });

  const cancel = useMutation({
    mutationFn: async ({ batchId, reason }: { batchId: string; reason: string }) => {
      const { error } = await supabase.rpc("app_cancel_agreement_settlement", { p_batch_id: batchId, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAgreementQueries(queryClient, agreement.id);
      queryClient.invalidateQueries({ queryKey: ["agreement-settlements", agreement.id] });
      toast({ title: "أُلغي التعديل", description: "عاد المبلغ إلى متبقّي الاتفاقية." });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الإلغاء", description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[92vh] w-[min(96vw,760px)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileMinus2 className="h-5 w-5 text-violet-600" />
            تعديل فوترة بدون ضريبة — اتفاقية {agreement.agreement_number}
          </DialogTitle>
          <DialogDescription>
            لمبلغٍ دُفع بفاتورةٍ أخرى صدرت من ملفّ المريض لا من الاتفاقية: يُخصم من بنودها بلا فاتورة جديدة ولا
            إبلاغ للضريبة، ويُسجَّل بمرجع تلك الفاتورة.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>الفاتورة التي دُفع بها المبلغ</Label>
              <Select value={invoiceId} onValueChange={pickInvoice}>
                <SelectTrigger>
                  <SelectValue placeholder={invoices.isLoading ? "جارٍ التحميل…" : "اختر الفاتورة"} />
                </SelectTrigger>
                <SelectContent>
                  {(invoices.data ?? []).map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {invoiceLabel(row)} — {formatAmount(row.net_amount)} —{" "}
                      {new Date(row.issued_at ?? row.created_at).toLocaleDateString("ar-SA")}
                      {row.agreement_id ? " (مربوطة باتفاقية)" : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={OUTSIDE}>فاتورة من خارج النظام (أكتب رقمها)</SelectItem>
                </SelectContent>
              </Select>
              {invoiceId === OUTSIDE && (
                <Input
                  placeholder="رقم الفاتورة، مثل C-10050"
                  value={outsideNumber}
                  onChange={(event) => setOutsideNumber(event.target.value)}
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المبلغ المخصوم (شامل الضريبة)</Label>
              <Input
                inputMode="decimal"
                className="tabular-nums"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  distribute(event.target.value);
                }}
                placeholder={`حتى ${formatAmount(totalRemaining)}`}
              />
              <span className="text-xs text-muted-foreground">متبقّي هذا العرض: {formatAmount(totalRemaining)}</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium">
                  <th>البند</th>
                  <th className="w-28">المتبقّي</th>
                  <th className="w-32">يُخصم منه</th>
                </tr>
              </thead>
              <tbody>
                {openLines.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-muted-foreground">
                      لا متبقٍّ في هذا العرض.
                    </td>
                  </tr>
                )}
                {openLines.map((line) => {
                  const value = alloc[line.id] ?? "";
                  const tooMuch = num(value) > Number(line.remaining_amount) + 0.01;
                  return (
                    <tr key={line.id} className="border-t [&>td]:px-2 [&>td]:py-1.5">
                      <td>{line.description}</td>
                      <td className="tabular-nums">{formatAmount(line.remaining_amount)}</td>
                      <td>
                        <Input
                          inputMode="decimal"
                          className={`h-8 tabular-nums ${tooMuch ? "border-destructive" : ""}`}
                          value={value}
                          onChange={(event) => setAlloc((prev) => ({ ...prev, [line.id]: event.target.value }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {openLines.length > 0 && (
                <tfoot>
                  <tr className="border-t bg-muted/30 font-semibold [&>td]:px-2 [&>td]:py-1.5">
                    <td colSpan={2}>الموزَّع</td>
                    <td className={`tabular-nums ${mismatch ? "text-destructive" : ""}`}>{formatAmount(allocated)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {mismatch && num(amount) > 0 && (
            <p className="text-xs text-destructive">
              الموزَّع على البنود ({formatAmount(allocated)}) لا يساوي المبلغ ({formatAmount(num(amount))}).
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Textarea
              rows={2}
              value={note}
              placeholder="مثال: دُفع بفاتورة من ملفّ المريض بدل الفوترة من الاتفاقية"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {(history.data ?? []).length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">تعديلات سابقة على هذه الاتفاقية</p>
              {(history.data ?? []).map((row) => (
                <div
                  key={row.batch_id}
                  className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                    row.is_cancelled ? "bg-muted/40 text-muted-foreground" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums">{formatAmount(row.net_amount)}</span>
                      <Badge variant="outline">فاتورة {row.reference_number ?? "—"}</Badge>
                      {row.is_cancelled && <Badge variant="secondary">ملغى — {row.cancel_reason}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {row.lines} · {row.created_by_name ?? "—"} ·{" "}
                      {new Date(row.created_at).toLocaleString("ar-SA")}
                    </p>
                    {row.note && <p className="text-xs">{row.note}</p>}
                  </div>
                  {!row.is_cancelled && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-destructive"
                      disabled={cancel.isPending}
                      onClick={() => {
                        const reason = window.prompt("سبب إلغاء التعديل (يعود المبلغ إلى المتبقّي):", "");
                        if (reason !== null && reason.trim()) cancel.mutate({ batchId: row.batch_id, reason: reason.trim() });
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      إلغاء
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          <Button
            className="gap-1 bg-violet-600 hover:bg-violet-700"
            disabled={!canSave || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileMinus2 className="h-4 w-4" />}
            خصم من الاتفاقية بدون ضريبة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
