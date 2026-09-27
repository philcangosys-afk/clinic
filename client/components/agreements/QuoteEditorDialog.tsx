import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, LayoutGrid, Percent, Receipt, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount } from "@/lib/locale";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import {
  computeQuoteLine,
  useAgreementQuotes,
  useAgreementVat,
  useQuoteLines,
  type AgreementListRow,
} from "@/lib/agreements";
import ServiceBrowserDialog, { type PickedService } from "@/components/billing/ServiceBrowserDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * عرض سعر تابع لاتفاقية — كشاشة الفاتورة، لكنّه مرن.
 *
 * يُعدَّل ما شاء الطبيب والاستقبال: الخدمات والكمّيات والسعر ضمن حدّيه والخصم
 * مبلغًا أو نسبة، والأرقام تتحدّث مع كلّ حرف. ولا يُحفظ شيءٌ ضريبيّ: الضريبة
 * هنا بيانٌ لما ستكون عليه الفاتورة. و«فوترة» تفتح الفاتورة الحقيقية بما لم
 * يُفوتَر بعد من البنود.
 *
 * **ما فُوتر من بندٍ يُقيّده:** لا يُحذف، ولا ينزل عدده تحت ما فُوتر، ولا
 * تُستبدل خدمته — والقاعدة تفرض ذلك، والشاشة تمنعه قبلها فلا يُفاجأ أحد.
 */

const NONE = "__none__";

type DraftLine = {
  key: string;
  id: string | null;
  itemId: string;
  code: string | null;
  barcode: string | null;
  description: string;
  price: number;
  qty: number;
  /** الخصم بالريال إن كُتب مبلغًا — وإلّا صفر وتُستعمل النسبة. */
  discountAmount: number;
  discountPercent: number;
  itemVatExempt: boolean;
  minPrice: number | null;
  maxPrice: number | null;
  invoicedQty: number;
};

function useDoctorsAndClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["agreement-doctors-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const [doctors, clinics] = await Promise.all([
        supabase.from("doctors").select("id, name_ar").eq("organization_id", organizationId).eq("is_enabled", true).order("name_ar"),
        supabase.from("clinics").select("id, name").eq("organization_id", organizationId).eq("is_disabled", false).order("name"),
      ]);
      if (doctors.error) throw doctors.error;
      if (clinics.error) throw clinics.error;
      return {
        doctors: (doctors.data ?? []) as { id: string; name_ar: string }[],
        clinics: (clinics.data ?? []) as { id: string; name: string }[],
      };
    },
  });
}

export { useDoctorsAndClinics };

const toLocalInput = (iso: string | Date) => {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function QuoteEditorDialog({
  open,
  onOpenChange,
  organizationId,
  agreement,
  quoteId,
  onSaved,
  onInvoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  agreement: AgreementListRow;
  /** `null` = عرض سعر جديد. */
  quoteId: string | null;
  onSaved: (quoteId: string) => void;
  /** «فوترة»: يفتح الأب نافذة الفاتورة ببنود هذا العرض. */
  onInvoice: (quoteId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can("agreements.manage") && !agreement.is_disabled;
  const lists = useDoctorsAndClinics(organizationId);
  const vat = useAgreementVat(organizationId, agreement.patient_id);
  const quotes = useAgreementQuotes(agreement.id);
  const existingLines = useQuoteLines(quoteId);
  const quote = (quotes.data ?? []).find((row) => row.id === quoteId) ?? null;
  const isCancelled = Boolean(quote?.is_cancelled);
  const readOnly = !canManage || isCancelled;

  const [doctorId, setDoctorId] = useState(NONE);
  const [clinicId, setClinicId] = useState(NONE);
  const [quoteDate, setQuoteDate] = useState(() => toLocalInput(new Date()));
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [generalDiscount, setGeneralDiscount] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // تعبئة الرأس والبنود مرّةً لكلّ عرضٍ يُفتح
  useEffect(() => {
    if (!open) {
      setLoadedFor(null);
      return;
    }
    const key = quoteId ?? "new";
    if (loadedFor === key) return;
    if (quoteId) {
      if (!quote || !existingLines.data) return;
      setDoctorId(quote.doctor_id ?? NONE);
      setClinicId(quote.clinic_id ?? NONE);
      setQuoteDate(toLocalInput(quote.quote_date));
      setNote(quote.note ?? "");
      setLines(
        existingLines.data.map((row) => ({
          key: row.id,
          id: row.id,
          itemId: row.item_id ?? "",
          code: row.item_code,
          barcode: row.item_barcode,
          description: row.description,
          price: Number(row.unit_price),
          qty: Number(row.qty),
          // المبلغ المحفوظ هو المرجع، والنسبة بيانٌ منه
          discountAmount: Number(row.discount_amount),
          discountPercent: Number(row.discount_percent),
          itemVatExempt: row.item_vat_exempt,
          minPrice: row.min_price,
          maxPrice: row.max_price,
          invoicedQty: Number(row.invoiced_qty),
        })),
      );
    } else {
      setDoctorId(agreement.doctor_id ?? NONE);
      setClinicId(agreement.clinic_id ?? NONE);
      setQuoteDate(toLocalInput(new Date()));
      setNote("");
      setLines([]);
      // عرضٌ جديد يبدأ من الكتالوج: لا معنى لعرضٍ بلا خدمة
      if (canManage) setBrowserOpen(true);
    }
    setDirty(false);
    setLoadedFor(key);
  }, [open, quoteId, quote, existingLines.data, loadedFor]);

  const vatContext = { rate: vat.data?.rate ?? 0, patientExempt: vat.data?.patientExempt ?? false };
  const computed = useMemo(
    () =>
      lines.map((line) => ({
        line,
        calc: computeQuoteLine(
          {
            qty: line.qty,
            price: line.price,
            discountAmount: line.discountAmount,
            discountPercent: line.discountPercent,
            itemVatExempt: line.itemVatExempt,
          },
          vatContext,
        ),
      })),
    [lines, vatContext.rate, vatContext.patientExempt],
  );
  const totals = computed.reduce(
    (sum, { line, calc }) => ({
      gross: sum.gross + calc.gross,
      discount: sum.discount + calc.discount,
      taxable: sum.taxable + calc.taxable,
      vat: sum.vat + calc.vatAmount,
      exemption: sum.exemption + calc.exemption,
      net: sum.net + calc.net,
      invoiced: sum.invoiced + line.invoicedQty,
    }),
    { gross: 0, discount: 0, taxable: 0, vat: 0, exemption: 0, net: 0, invoiced: 0 },
  );
  const remainingQty = lines.reduce((sum, line) => sum + Math.max(line.qty - line.invoicedQty, 0), 0);

  const update = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setDirty(true);
  };

  const addService = (item: PickedService) => {
    setLines((prev) => [
      ...prev,
      {
        key: `new-${item.id}-${Date.now()}`,
        id: null,
        itemId: item.id,
        code: item.code,
        barcode: null,
        description: item.name_ar,
        price: Number(item.price) || 0,
        qty: 1,
        discountAmount: 0,
        discountPercent: Number(item.default_discount_percent) || 0,
        itemVatExempt: Boolean(item.is_vat_exempt),
        minPrice: item.min_price,
        maxPrice: item.max_price,
        invoicedQty: 0,
      },
    ]);
    setDirty(true);
  };

  /** خصمٌ عامّ: نسبةٌ واحدة على كلّ البنود — كزرّ «خصم عام» في النظام المرجعيّ. */
  const applyGeneralDiscount = () => {
    const pct = Number(generalDiscount);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast({ variant: "destructive", title: "النسبة من 0 إلى 100" });
      return;
    }
    setLines((prev) => prev.map((line) => ({ ...line, discountAmount: 0, discountPercent: pct })));
    setDirty(true);
  };

  const priceProblem = (line: DraftLine) => {
    if (line.minPrice != null && line.price > 0 && line.price < line.minPrice) return `أقلّ من الحدّ الأدنى ${line.minPrice}`;
    if (line.maxPrice != null && line.price > line.maxPrice) return `أعلى من الحدّ الأقصى ${line.maxPrice}`;
    return null;
  };

  const save = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error("أضف خدمةً واحدة على الأقلّ");
      const { data, error } = await supabase.rpc("app_save_agreement_quote", {
        p_agreement_id: agreement.id,
        p_quote_id: quoteId,
        p_doctor_id: doctorId === NONE ? null : doctorId,
        p_clinic_id: clinicId === NONE ? null : clinicId,
        p_quote_date: new Date(quoteDate).toISOString(),
        p_note: note.trim() || null,
        p_lines: lines.map((line) => ({
          id: line.id,
          item_id: line.itemId,
          description: line.description,
          qty: line.qty,
          price: line.price,
          // وجهان لخصمٍ واحد: المبلغ إن كُتب، وإلّا النسبة
          discount_amount: line.discountAmount > 0 ? line.discountAmount : null,
          discount_percent: line.discountAmount > 0 ? null : line.discountPercent,
        })),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (savedId) => {
      queryClient.invalidateQueries({ queryKey: ["agreement-quotes", agreement.id] });
      queryClient.invalidateQueries({ queryKey: ["agreement-quote-lines", savedId] });
      queryClient.invalidateQueries({ queryKey: ["agreement-list"] });
      queryClient.invalidateQueries({ queryKey: ["agreement", agreement.id] });
      queryClient.invalidateQueries({ queryKey: ["billing-agreement-items"] });
      setDirty(false);
      setLoadedFor(null);
      toast({ title: quoteId ? "حُفظ عرض السعر" : "أُضيف عرض السعر" });
      onSaved(savedId);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حفظ عرض السعر", description: errorMessage(error) }),
  });

  const cancelQuote = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase.rpc("app_cancel_agreement_quote", { p_quote_id: quoteId, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agreement-quotes", agreement.id] });
      queryClient.invalidateQueries({ queryKey: ["agreement-list"] });
      queryClient.invalidateQueries({ queryKey: ["agreement", agreement.id] });
      queryClient.invalidateQueries({ queryKey: ["billing-agreement-items"] });
      toast({ title: "أُلغي عرض السعر" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الإلغاء", description: errorMessage(error) }),
  });

  const invoice = async () => {
    // ما يُفوتَر هو المحفوظ: تعديلٌ لم يُحفظ يُحفظ أوّلًا، وإلّا فُوتر القديم
    if (dirty || !quoteId) {
      try {
        const savedId = await save.mutateAsync();
        onInvoice(savedId);
      } catch {
        /* الرسالة عرضها onError */
      }
      return;
    }
    onInvoice(quoteId);
  };

  const title = quoteId
    ? `عرض سعر رقم ${quote?.quote_number ?? "…"} تابع لاتفاقية رقم ${agreement.agreement_number}`
    : `عرض سعر جديد تابع لاتفاقية رقم ${agreement.agreement_number}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[95vh] w-[min(96vw,1200px)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {title}
            {isCancelled && <Badge variant="secondary">ملغى — {quote?.cancel_reason}</Badge>}
            {dirty && <Badge variant="outline" className="border-amber-400 text-amber-700">تعديلات لم تُحفظ</Badge>}
          </DialogTitle>
          <DialogDescription>
            مستندٌ مرن للاتفاق مع المريض — لا يُرسَل للضريبة. الفاتورة الضريبية تصدر بـ«فوترة».
          </DialogDescription>
        </DialogHeader>

        {/* ── شريط الأوامر ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
          <Button size="sm" disabled={readOnly || save.isPending} onClick={() => save.mutate()}>
            <Save className="h-4 w-4" />
            {save.isPending ? "جارٍ الحفظ…" : "حفظ"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={save.isPending || isCancelled || lines.length === 0 || remainingQty <= 0 || agreement.is_disabled}
            onClick={() => void invoice()}
            title={remainingQty <= 0 ? "كلّ البنود مفوتَرة" : "إصدار فاتورة ضريبية بما لم يُفوتَر بعد"}
          >
            <Receipt className="h-4 w-4" />
            فوترة
          </Button>
          <Button size="sm" variant="outline" disabled={readOnly} onClick={() => setBrowserOpen(true)}>
            <LayoutGrid className="h-4 w-4" />
            إضافة خدمة
          </Button>
          <div className="flex items-center gap-1">
            <Input
              className="h-8 w-20"
              type="number"
              min={0}
              max={100}
              placeholder="%"
              value={generalDiscount}
              disabled={readOnly}
              onChange={(event) => setGeneralDiscount(event.target.value)}
            />
            <Button size="sm" variant="outline" disabled={readOnly || !generalDiscount} onClick={applyGeneralDiscount}>
              <Percent className="h-4 w-4" />
              خصم عام
            </Button>
          </div>
          {quoteId && canManage && !isCancelled && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={totals.invoiced > 0 || cancelQuote.isPending}
              title={totals.invoiced > 0 ? "فُوتر منه — لا يُلغى" : "إلغاء عرض السعر"}
              onClick={() => {
                const reason = window.prompt("سبب إلغاء عرض السعر؟");
                if (reason && reason.trim()) cancelQuote.mutate(reason.trim());
              }}
            >
              <Ban className="h-4 w-4" />
              إلغاء العرض
            </Button>
          )}
        </div>

        {/* ── الرأس ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <div className="flex flex-col gap-1 lg:col-span-2">
            <Label className="text-xs">اسم المريض</Label>
            <Input value={agreement.patient_name} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">رقم الملف</Label>
            <Input value={String(agreement.file_number ?? "")} disabled dir="ltr" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">الطبيب المعالج</Label>
            <Select value={doctorId} onValueChange={(value) => { setDoctorId(value); setDirty(true); }} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— بلا طبيب —</SelectItem>
                {(lists.data?.doctors ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>{doctor.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">العيادة</Label>
            <Select value={clinicId} onValueChange={(value) => { setClinicId(value); setDirty(true); }} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— بلا عيادة —</SelectItem>
                {(lists.data?.clinics ?? []).map((clinic) => (
                  <SelectItem key={clinic.id} value={clinic.id}>{clinic.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">تاريخ العرض</Label>
            <Input
              type="datetime-local"
              value={quoteDate}
              disabled={readOnly}
              onChange={(event) => { setQuoteDate(event.target.value); setDirty(true); }}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1 md:col-span-4 lg:col-span-6">
            <Label className="text-xs">ملاحظات</Label>
            <Textarea rows={1} value={note} disabled={readOnly} onChange={(event) => { setNote(event.target.value); setDirty(true); }} />
          </div>
        </div>

        {vat.data && (
          <p className="text-xs text-muted-foreground">
            الضريبة {vat.data.rate}%
            {vat.data.patientExempt
              ? ` — ${vat.data.exemptReason ?? "المريض معفى"}: الضريبة صفر، وعمود «الإعفاء» قيمتها التي تتحمّلها الدولة.`
              : ""}
          </p>
        )}

        {/* ── البنود ──────────────────────────────────────────────── */}
        {quoteId && existingLines.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[1100px] text-sm [&_th]:whitespace-nowrap">
              <thead className="bg-muted/60 text-xs">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                  <th className="w-8" />
                  <th>الكود</th>
                  <th>باركود المصدر</th>
                  <th className="min-w-[14rem]">العمل</th>
                  <th>السعر</th>
                  <th>العدد</th>
                  <th>المفوتر</th>
                  <th>الإجمالي</th>
                  <th>الخصم #</th>
                  <th>الخصم %</th>
                  <th>بلا ضريبة</th>
                  <th>الضريبة %</th>
                  <th>الضريبة #</th>
                  <th>الإعفاء</th>
                  <th>الصافي</th>
                </tr>
              </thead>
              <tbody>
                {computed.map(({ line, calc }) => {
                  const problem = priceProblem(line);
                  const locked = line.invoicedQty > 0;
                  return (
                    <tr key={line.key} className="border-t [&>td]:px-2 [&>td]:py-1 tabular-nums">
                      <td>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          disabled={readOnly || locked}
                          title={locked ? "فُوتر منه — لا يُحذف" : "حذف البند"}
                          onClick={() => {
                            setLines((prev) => prev.filter((row) => row.key !== line.key));
                            setDirty(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                      <td className="font-mono text-xs">{line.code ?? "—"}</td>
                      <td className="font-mono text-xs">{line.barcode ?? "—"}</td>
                      <td className="max-w-[18rem] truncate" title={line.description}>{line.description}</td>
                      <td>
                        <Input
                          className={`h-8 w-24 ${problem ? "border-destructive" : ""}`}
                          type="number"
                          min={0}
                          value={line.price}
                          disabled={readOnly}
                          title={
                            problem ??
                            [line.minPrice != null ? `الأدنى ${line.minPrice}` : "", line.maxPrice != null ? `الأعلى ${line.maxPrice}` : ""]
                              .filter(Boolean)
                              .join(" · ")
                          }
                          onChange={(event) => update(line.key, { price: Number(event.target.value) })}
                        />
                      </td>
                      <td>
                        <Input
                          className="h-8 w-20"
                          type="number"
                          min={Math.max(line.invoicedQty, 0.01)}
                          step="1"
                          value={line.qty}
                          disabled={readOnly}
                          onChange={(event) => update(line.key, { qty: Number(event.target.value) })}
                        />
                      </td>
                      <td className={line.invoicedQty > 0 ? "font-semibold text-emerald-700" : "text-muted-foreground"}>
                        {line.invoicedQty}
                      </td>
                      <td>{formatAmount(calc.gross)}</td>
                      <td>
                        <Input
                          className="h-8 w-24 text-rose-700"
                          type="number"
                          min={0}
                          value={line.discountAmount > 0 ? line.discountAmount : calc.discount || ""}
                          placeholder="0"
                          disabled={readOnly}
                          onChange={(event) =>
                            update(line.key, { discountAmount: Number(event.target.value) || 0, discountPercent: 0 })
                          }
                        />
                      </td>
                      <td>
                        <Input
                          className="h-8 w-20"
                          type="number"
                          min={0}
                          max={100}
                          value={calc.percent || ""}
                          placeholder="0"
                          disabled={readOnly}
                          onChange={(event) =>
                            update(line.key, { discountPercent: Number(event.target.value) || 0, discountAmount: 0 })
                          }
                        />
                      </td>
                      <td>{formatAmount(calc.taxable)}</td>
                      <td>{calc.vatRate}</td>
                      <td>{formatAmount(calc.vatAmount)}</td>
                      <td>{formatAmount(calc.exemption)}</td>
                      <td className="font-semibold text-emerald-700">{formatAmount(calc.net)}</td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={15} className="py-8 text-center text-sm text-muted-foreground">
                      لا بنود بعد — «إضافة خدمة» لاختيارها من الكتالوج.
                    </td>
                  </tr>
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot className="border-t bg-muted/40 font-semibold tabular-nums">
                  <tr className="[&>td]:px-2 [&>td]:py-2">
                    <td colSpan={6}>الإجمالي — {lines.length} بندًا</td>
                    <td>{totals.invoiced}</td>
                    <td>{formatAmount(totals.gross)}</td>
                    <td className="text-rose-700">{formatAmount(totals.discount)}</td>
                    <td />
                    <td>{formatAmount(totals.taxable)}</td>
                    <td />
                    <td>{formatAmount(totals.vat)}</td>
                    <td>{formatAmount(totals.exemption)}</td>
                    <td className="text-emerald-700">{formatAmount(totals.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <ServiceBrowserDialog open={browserOpen} onOpenChange={setBrowserOpen} onSelect={addService} />
      </DialogContent>
    </Dialog>
  );
}
