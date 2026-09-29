import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarDays, ChevronDown, ChevronLeft, FileSignature, Receipt, Stethoscope } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDateTime } from "@/lib/locale";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * أرشيف النظام السابق (Kizen) — للاطلاع (0194).
 *
 * فواتير Kizen وسنداتها ومواعيدها واتفاقياتها وزياراتها كما كانت هناك،
 * برقمها ورقم ZATCA الذي صدرت به. ليست مستنداتٍ في هذا النظام: لا تدخل
 * الحسابات ولا اليومية ولا الترقيم، ولا تُعدَّل.
 *
 * الكتابة الوحيدة: **تسوية متبقٍّ** على فاتورةٍ قديمة — يُحصَّل المال بسند
 * قبضٍ عاديّ، ثم تُعلَّم الفاتورة هنا «سُوّيت» برقم السند.
 */

type LegacyInvoice = {
  id: string;
  legacy_number: number;
  zatca_number: string | null;
  kind: "sale" | "return";
  issued_at: string | null;
  doctor_name: string | null;
  employee_name: string | null;
  clinic_name: string | null;
  works: string | null;
  gross_amount: number;
  discount_amount: number;
  vat_amount: number;
  exemption_amount: number;
  net_amount: number;
  paid_amount: number;
  remaining_amount: number;
  note: string | null;
  agreement_number: number | null;
  settled_at: string | null;
  settle_note: string | null;
};

type LegacyItem = {
  id: string;
  line_no: number;
  source_code: string | null;
  service: string | null;
  doctor_name: string | null;
  unit_price: number;
  qty: number;
  discount_amount: number;
  vat_amount: number;
  exemption_amount: number;
  net_amount: number;
  offer_name: string | null;
};

type LegacyReceipt = {
  id: string;
  legacy_number: number;
  received_at: string | null;
  method: string | null;
  amount: number;
  bank_reference: string | null;
  user_name: string | null;
};

type LegacyAgreement = {
  id: string;
  legacy_number: number;
  agreement_date: string | null;
  services: string | null;
  teeth: string | null;
  doctor_name: string | null;
  total_amount: number;
  invoiced_amount: number;
  remaining_amount: number;
  debt_cancelled: boolean;
  is_disabled: boolean;
  agreement_text: string | null;
  note: string | null;
  migrated: { agreement_number: number } | { agreement_number: number }[] | null;
};

type LegacyAppointment = {
  id: string;
  legacy_id: number;
  starts_at: string | null;
  doctor_name: string | null;
  status: string | null;
  notes: string | null;
  added_by: string | null;
};

type LegacyRecord = {
  id: string;
  kind: "note" | "visit" | "dental_visit";
  recorded_at: string | null;
  clinic_name: string | null;
  doctor_name: string | null;
  user_name: string | null;
  title: string | null;
  complaint: string | null;
  diagnosis: string | null;
  procedure_text: string | null;
  tooth: string | null;
  details: string | null;
  is_disabled: boolean;
  match_method: string | null;
};

const KIND_LABEL: Record<LegacyRecord["kind"], string> = {
  note: "ملاحظة",
  visit: "زيارة",
  dental_visit: "زيارة أسنان",
};

function useLegacy<T>(table: string, patientId: string, order: string, enabled = true, select = "*") {
  return useQuery({
    queryKey: ["legacy", table, patientId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq("patient_id", patientId)
        .order(order, { ascending: false, nullsFirst: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as T[];
    },
  });
}

function InvoiceDetails({ invoiceId }: { invoiceId: string }) {
  const lines = useQuery({
    queryKey: ["legacy", "items", invoiceId],
    queryFn: async () => {
      const [items, receipts] = await Promise.all([
        supabase.from("legacy_invoice_items").select("*").eq("legacy_invoice_id", invoiceId).order("line_no"),
        supabase.from("legacy_receipts").select("*").eq("legacy_invoice_id", invoiceId).order("received_at"),
      ]);
      if (items.error) throw items.error;
      if (receipts.error) throw receipts.error;
      return { items: (items.data ?? []) as LegacyItem[], receipts: (receipts.data ?? []) as LegacyReceipt[] };
    },
  });
  if (lines.isLoading) return <Skeleton className="h-16 w-full" />;
  if (lines.error) return <p className="text-sm text-destructive">{errorMessage(lines.error)}</p>;
  return (
    <div className="grid gap-3 bg-muted/30 p-3">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:text-start [&>th]:font-medium">
            <th>الكود</th>
            <th>الخدمة</th>
            <th>الطبيب</th>
            <th>السعر</th>
            <th>العدد</th>
            <th>الخصم</th>
            <th>الضريبة</th>
            <th>الإعفاء</th>
            <th>الصافي</th>
          </tr>
        </thead>
        <tbody>
          {(lines.data?.items ?? []).map((line) => (
            <tr key={line.id} className="border-t tabular-nums [&>td]:px-2 [&>td]:py-1">
              <td className="font-mono">{line.source_code ?? "—"}</td>
              <td>
                {line.service}
                {line.offer_name && <span className="ms-1 text-muted-foreground">({line.offer_name})</span>}
              </td>
              <td>{line.doctor_name ?? "—"}</td>
              <td>{formatAmount(line.unit_price)}</td>
              <td>{line.qty}</td>
              <td className="text-rose-700">{formatAmount(line.discount_amount)}</td>
              <td>{formatAmount(line.vat_amount)}</td>
              <td>{formatAmount(line.exemption_amount)}</td>
              <td className="font-semibold">{formatAmount(line.net_amount)}</td>
            </tr>
          ))}
          {(lines.data?.items ?? []).length === 0 && (
            <tr>
              <td colSpan={9} className="px-2 py-2 text-muted-foreground">لا بنود مسجّلة لهذه الفاتورة في التصدير.</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="text-xs">
        <p className="mb-1 font-medium">سندات القبض</p>
        {(lines.data?.receipts ?? []).length === 0 && <p className="text-muted-foreground">لا سندات.</p>}
        {(lines.data?.receipts ?? []).map((r) => (
          <p key={r.id} className="tabular-nums">
            سند {r.legacy_number} — {formatDateTime(r.received_at)} — {r.method ?? "—"} —{" "}
            <span className="font-semibold">{formatAmount(r.amount)}</span>
            {r.bank_reference ? ` — مرجع ${r.bank_reference}` : ""}
            {r.user_name ? ` — ${r.user_name}` : ""}
          </p>
        ))}
      </div>
    </div>
  );
}

function SettleDialog({
  invoice,
  onOpenChange,
}: {
  invoice: LegacyInvoice | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const undo = Boolean(invoice?.settled_at);
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_settle_legacy_invoice", {
        p_legacy_invoice_id: invoice?.id,
        p_note: note.trim(),
        p_undo: undo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["legacy"] });
      toast({ title: undo ? "أُلغيت التسوية" : "سُجّلت التسوية" });
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) }),
  });
  return (
    <Dialog open={Boolean(invoice)} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {undo ? "إلغاء تسوية" : "تسوية متبقٍّ"} — فاتورة Kizen رقم {invoice?.legacy_number}
          </DialogTitle>
          <DialogDescription>
            {undo
              ? "تعود الفاتورة القديمة مفتوحةً بمتبقّيها. اكتب سبب الإلغاء."
              : `المتبقي ${formatAmount(invoice?.remaining_amount)}. حصّله بسند قبضٍ عاديّ من الصندوق أوّلًا، ثم اكتب رقم السند هنا.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Label>{undo ? "سبب الإلغاء" : "رقم سند القبض / ملاحظة"}</Label>
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            تراجع
          </Button>
          <Button disabled={!note.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "جارٍ الحفظ…" : undo ? "إلغاء التسوية" : "تسجيل التسوية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LegacyArchiveTab({ patientId }: { patientId: string }) {
  const { can } = usePermissions();
  const canBilling = can("billing.view");
  const canMedical = can("patients.view_medical");
  const canSettle = can("cashier.receive");
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);
  const [settle, setSettle] = useState<LegacyInvoice | null>(null);

  const invoices = useLegacy<LegacyInvoice>("legacy_invoices", patientId, "issued_at", canBilling);
  const agreements = useLegacy<LegacyAgreement>(
    "legacy_agreements",
    patientId,
    "agreement_date",
    true,
    "*, migrated:treatment_agreements(agreement_number)",
  );
  const appointments = useLegacy<LegacyAppointment>("legacy_appointments", patientId, "starts_at");
  const records = useLegacy<LegacyRecord>("legacy_patient_records", patientId, "recorded_at");

  const invoiceRows = invoices.data ?? [];
  const openBalance = invoiceRows
    .filter((row) => !row.settled_at)
    .reduce((sum, row) => sum + Number(row.remaining_amount), 0);
  const totalNet = invoiceRows.reduce((sum, row) => sum + Number(row.net_amount), 0);

  const empty =
    !invoices.isLoading &&
    !agreements.isLoading &&
    !appointments.isLoading &&
    !records.isLoading &&
    invoiceRows.length === 0 &&
    (agreements.data ?? []).length === 0 &&
    (appointments.data ?? []).length === 0 &&
    (records.data ?? []).length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="h-4 w-4" />
          أرشيف النظام السابق (Kizen)
        </CardTitle>
        <CardDescription>
          ما سُجّل لهذا المريض في Kizen كما هو، للاطلاع فقط — لا يدخل الحسابات ولا ترقيم الفواتير ولا يُعدَّل.
        </CardDescription>
        {canBilling && invoiceRows.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2 text-sm">
            <Badge variant="outline">{invoiceRows.length} فاتورة</Badge>
            <Badge variant="outline">صافي {formatAmount(totalNet)}</Badge>
            {Math.abs(openBalance) > 0.004 && (
              <Badge className={openBalance > 0 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}>
                {openBalance > 0 ? "متبقٍّ عليه" : "رصيد له"} {formatAmount(Math.abs(openBalance))}
              </Badge>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-6 text-center text-sm text-muted-foreground">لا شيء لهذا المريض في أرشيف النظام السابق.</p>
        ) : (
          <Tabs defaultValue={canBilling ? "invoices" : "agreements"} dir="rtl">
            <TabsList className="flex-wrap">
              {canBilling && (
                <TabsTrigger value="invoices" className="gap-1">
                  <Receipt className="h-3.5 w-3.5" />
                  الفواتير ({invoiceRows.length})
                </TabsTrigger>
              )}
              <TabsTrigger value="agreements" className="gap-1">
                <FileSignature className="h-3.5 w-3.5" />
                الاتفاقيات ({(agreements.data ?? []).length})
              </TabsTrigger>
              <TabsTrigger value="appointments" className="gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                المواعيد ({(appointments.data ?? []).length})
              </TabsTrigger>
              <TabsTrigger value="records" className="gap-1">
                <Stethoscope className="h-3.5 w-3.5" />
                الملاحظات والزيارات ({(records.data ?? []).length})
              </TabsTrigger>
            </TabsList>

            {canBilling && (
              <TabsContent value="invoices">
                {invoices.isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead className="bg-muted/60 text-xs">
                        <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                          <th className="w-6" />
                          <th>الرقم</th>
                          <th>ZATCA</th>
                          <th>التاريخ</th>
                          <th>الطبيب</th>
                          <th>الأعمال</th>
                          <th>الصافي</th>
                          <th>المدفوع</th>
                          <th>المتبقي</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceRows.map((row) => {
                          const remaining = Number(row.remaining_amount);
                          const expanded = openInvoice === row.id;
                          return (
                            <Fragment key={row.id}>
                              <tr
                                className="cursor-pointer border-t tabular-nums hover:bg-muted/40 [&>td]:px-2 [&>td]:py-1.5"
                                onClick={() => setOpenInvoice(expanded ? null : row.id)}
                              >
                                <td>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</td>
                                <td className="font-mono">
                                  {row.legacy_number}
                                  {row.kind === "return" && <Badge variant="secondary" className="ms-1">مرتجع</Badge>}
                                </td>
                                <td className="font-mono text-xs">{row.zatca_number ?? "—"}</td>
                                <td className="whitespace-nowrap text-xs">{formatDateTime(row.issued_at)}</td>
                                <td className="whitespace-nowrap">{row.doctor_name ?? "—"}</td>
                                <td className="max-w-[18rem] truncate" title={row.works ?? ""}>
                                  {row.works ?? "—"}
                                  {row.agreement_number ? (
                                    <span className="ms-1 text-xs text-muted-foreground">(اتفاقية {row.agreement_number})</span>
                                  ) : null}
                                </td>
                                <td className="font-semibold">{formatAmount(row.net_amount)}</td>
                                <td className="text-emerald-700">{formatAmount(row.paid_amount)}</td>
                                <td className={remaining > 0.004 && !row.settled_at ? "font-semibold text-amber-700" : ""}>
                                  {formatAmount(remaining)}
                                  {row.settled_at && (
                                    <span className="block text-[10px] text-emerald-700" title={row.settle_note ?? ""}>
                                      سُوّيت
                                    </span>
                                  )}
                                </td>
                                <td onClick={(event) => event.stopPropagation()}>
                                  {canSettle && Math.abs(remaining) > 0.004 && (
                                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSettle(row)}>
                                      {row.settled_at ? "إلغاء التسوية" : "تسوية"}
                                    </Button>
                                  )}
                                </td>
                              </tr>
                              {expanded && (
                                <tr>
                                  <td colSpan={10} className="p-0">
                                    <InvoiceDetails invoiceId={row.id} />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                        {invoiceRows.length === 0 && (
                          <tr>
                            <td colSpan={10} className="py-6 text-center text-muted-foreground">
                              لا فواتير في Kizen لهذا المريض.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            )}

            <TabsContent value="agreements">
              {agreements.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="grid gap-2">
                  {(agreements.data ?? []).map((row) => {
                    const migrated = Array.isArray(row.migrated) ? row.migrated[0] : row.migrated;
                    return (
                      <div key={row.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">اتفاقية Kizen رقم {row.legacy_number}</span>
                          <span className="text-xs text-muted-foreground">{formatDateTime(row.agreement_date)}</span>
                          {row.doctor_name && <Badge variant="outline">{row.doctor_name}</Badge>}
                          {row.is_disabled && <Badge variant="secondary">معطّلة</Badge>}
                          {row.debt_cancelled && <Badge variant="secondary">أُلغيت مديونيتها</Badge>}
                          {migrated && (
                            <Badge className="bg-emerald-100 text-emerald-900">
                              نُقل متبقّيها إلى اتفاقية رقم {migrated.agreement_number}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1">{row.services ?? "—"}</p>
                        {row.teeth && <p className="text-xs text-muted-foreground">الأسنان: {row.teeth}</p>}
                        <p className="mt-1 tabular-nums text-xs">
                          الإجمالي {formatAmount(row.total_amount)} — المفوتر {formatAmount(row.invoiced_amount)} — المتبقي{" "}
                          <span className="font-semibold">{formatAmount(row.remaining_amount)}</span>
                        </p>
                        {row.agreement_text && <p className="mt-1 whitespace-pre-wrap text-xs">{row.agreement_text}</p>}
                        {row.note && <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>}
                      </div>
                    );
                  })}
                  {(agreements.data ?? []).length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">لا اتفاقيات في Kizen لهذا المريض.</p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="appointments">
              {appointments.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-xs">
                      <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                        <th>الموعد</th>
                        <th>الطبيب</th>
                        <th>الحالة</th>
                        <th>ملاحظات</th>
                        <th>أدخله</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(appointments.data ?? []).map((row) => (
                        <tr key={row.id} className="border-t [&>td]:px-2 [&>td]:py-1.5">
                          <td className="whitespace-nowrap text-xs">{formatDateTime(row.starts_at)}</td>
                          <td>{row.doctor_name ?? "—"}</td>
                          <td>{row.status ?? "—"}</td>
                          <td className="max-w-[20rem] truncate" title={row.notes ?? ""}>{row.notes ?? ""}</td>
                          <td className="text-xs text-muted-foreground">{row.added_by ?? ""}</td>
                        </tr>
                      ))}
                      {(appointments.data ?? []).length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-muted-foreground">لا مواعيد في Kizen لهذا المريض.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="records">
              {records.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="grid gap-2">
                  {(records.data ?? []).map((row) => (
                    <div key={row.id} className={`rounded-lg border p-3 text-sm ${row.is_disabled ? "opacity-60" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{KIND_LABEL[row.kind]}</Badge>
                        <span className="text-xs text-muted-foreground">{formatDateTime(row.recorded_at)}</span>
                        {row.doctor_name && <span className="text-xs">{row.doctor_name}</span>}
                        {row.clinic_name && <span className="text-xs text-muted-foreground">{row.clinic_name}</span>}
                        {row.match_method && row.match_method !== "file" && (
                          <span className="text-[10px] text-muted-foreground" title="تقرير Kizen بلا رقم ملف — رُبطت بالاسم">
                            (رُبطت بالاسم)
                          </span>
                        )}
                      </div>
                      {row.title && <p className="mt-1 font-medium">{row.title}</p>}
                      {row.tooth && <p className="mt-1 text-xs">السن: {row.tooth}</p>}
                      {row.complaint && <p className="mt-1 text-xs">الشكوى: {row.complaint}</p>}
                      {row.diagnosis && <p className="text-xs">التشخيص: {row.diagnosis}</p>}
                      {row.procedure_text && <p className="text-xs">الإجراء: {row.procedure_text}</p>}
                      {row.details && <p className="mt-1 whitespace-pre-wrap text-xs">{row.details}</p>}
                      {row.user_name && row.kind === "note" && (
                        <p className="mt-1 text-[10px] text-muted-foreground">{row.user_name}</p>
                      )}
                    </div>
                  ))}
                  {(records.data ?? []).length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {canMedical ? "لا ملاحظات ولا زيارات في Kizen لهذا المريض." : "لا ملاحظات في Kizen لهذا المريض."}
                    </p>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
      <SettleDialog invoice={settle} onOpenChange={(open) => !open && setSettle(null)} />
    </Card>
  );
}
