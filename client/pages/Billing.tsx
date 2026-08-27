import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, WalletCards } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { SalesInvoiceStatus, SalesInvoiceWithPatient } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import PatientPicker from "@/components/shared/PatientPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  unpaid: "غير مدفوعة",
  partial: "مدفوعة جزئيًا",
  paid: "مدفوعة بالكامل",
  void: "ملغاة",
};
const STATUS_BADGE: Record<SalesInvoiceStatus, string> = {
  unpaid: "bg-rose-100 text-rose-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  void: "bg-slate-100 text-slate-500",
};

function useInvoices(organizationId: string | undefined, status: string) {
  return useQuery({
    queryKey: ["invoices-list", organizationId, status],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("sales_invoices")
        .select(
          "id, invoice_number, created_at, status, net_amount, paid_amount, remaining_amount, external_customer_name, patient:patients(id, name_ar, file_number)",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as SalesInvoiceWithPatient[];
    },
  });
}

export default function Billing() {
  const { organization } = useOrganizationAccess();
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<SalesInvoiceWithPatient | null>(null);
  const invoices = useInvoices(organization?.id, statusFilter);

  const totals = useMemo(() => {
    const rows = invoices.data ?? [];
    return {
      net: rows.reduce((sum, row) => sum + Number(row.net_amount), 0),
      remaining: rows.reduce((sum, row) => sum + Number(row.remaining_amount), 0),
    };
  }, [invoices.data]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الفوترة والمدفوعات</h1>
          <p className="text-sm text-muted-foreground">
            إجمالي الفواتير: {totals.net.toLocaleString("ar-SA")} ر.س · متبقي: {totals.remaining.toLocaleString("ar-SA")} ر.س
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="unpaid">غير مدفوعة</SelectItem>
              <SelectItem value="partial">مدفوعة جزئيًا</SelectItem>
              <SelectItem value="paid">مدفوعة بالكامل</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            فاتورة جديدة
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الفواتير</CardTitle>
          <CardDescription>آخر 50 فاتورة</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!invoices.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#الفاتورة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الصافي</TableHead>
                  <TableHead>المتبقي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices.data ?? []).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">#{invoice.invoice_number}</TableCell>
                    <TableCell>{invoice.patient?.name_ar ?? invoice.external_customer_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(invoice.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell>{Number(invoice.net_amount).toLocaleString("ar-SA")}</TableCell>
                    <TableCell className={Number(invoice.remaining_amount) > 0 ? "text-rose-600" : ""}>
                      {Number(invoice.remaining_amount).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[invoice.status]}>{STATUS_LABELS[invoice.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      {invoice.status !== "paid" && invoice.status !== "void" && (
                        <Button size="sm" variant="outline" onClick={() => setPaymentTarget(invoice)}>
                          <WalletCards className="h-3.5 w-3.5" />
                          تسجيل دفعة
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(invoices.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد فواتير مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NewInvoiceDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} vatRate={organization?.default_vat_rate ?? 15} />
      <RecordPaymentDialog invoice={paymentTarget} onOpenChange={() => setPaymentTarget(null)} organizationId={organization?.id} />
    </div>
  );
}

type DraftLine = {
  key: string;
  item_id: string | null;
  description: string;
  price: number;
  qty: number;
  discount_percent: number;
  is_vat_exempt: boolean;
};

function NewInvoiceDialog({
  open,
  onOpenChange,
  organizationId,
  vatRate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  vatRate: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [externalName, setExternalName] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);

  const addLine = (item: { id: string; name_ar: string; price: number; is_vat_exempt: boolean }) => {
    setLines((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        item_id: item.id,
        description: item.name_ar,
        price: Number(item.price),
        qty: 1,
        discount_percent: 0,
        is_vat_exempt: item.is_vat_exempt,
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let vat = 0;
    const computed = lines.map((line) => {
      const lineSubtotal = line.price * line.qty;
      const lineDiscount = (lineSubtotal * line.discount_percent) / 100;
      const taxable = lineSubtotal - lineDiscount;
      const lineVat = line.is_vat_exempt ? 0 : (taxable * vatRate) / 100;
      subtotal += lineSubtotal;
      discount += lineDiscount;
      vat += lineVat;
      return { ...line, lineSubtotal, lineDiscount, lineVat, net: taxable + lineVat };
    });
    return { computed, subtotal, discount, vat, net: subtotal - discount + vat };
  }, [lines, vatRate]);

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!patient && !externalName.trim()) throw new Error("اختر مريضًا أو أدخل اسم عميل خارجي");
      if (lines.length === 0) throw new Error("أضف بندًا واحدًا على الأقل");

      const { data: invoice, error: invoiceError } = await supabase
        .from("sales_invoices")
        .insert({
          organization_id: organizationId,
          patient_id: patient?.id ?? null,
          external_customer_name: patient ? null : externalName.trim(),
          subtotal_amount: totals.subtotal,
          discount_amount: totals.discount,
          vat_amount: totals.vat,
          net_amount: totals.net,
        })
        .select("id")
        .single();
      if (invoiceError) throw invoiceError;

      const itemsPayload = totals.computed.map((line) => ({
        invoice_id: invoice.id,
        item_id: line.item_id,
        description: line.description,
        price: line.price,
        qty: line.qty,
        discount_percent: line.discount_percent,
        discount_amount: line.lineDiscount,
        vat_rate: line.is_vat_exempt ? 0 : vatRate,
        vat_amount: line.lineVat,
        net_amount: line.net,
      }));
      const { error: linesError } = await supabase.from("sales_invoice_items").insert(itemsPayload);
      if (linesError) throw linesError;
      return invoice.id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      toast({ title: "تم إنشاء الفاتورة" });
      setPatient(null);
      setExternalName("");
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء الفاتورة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>فاتورة مبيعات جديدة</DialogTitle>
          <DialogDescription>الضريبة محسوبة تلقائيًا بنسبة {vatRate}% (إعداد المؤسسة الافتراضي)</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض</Label>
            <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
            {patient && <p className="text-xs text-emerald-700">المحدد: {patient.name_ar}</p>}
          </div>
          {!patient && (
            <div className="flex flex-col gap-1.5">
              <Label>أو اسم عميل خارجي (بلا ملف)</Label>
              <Input value={externalName} onChange={(e) => setExternalName(e.target.value)} />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>إضافة بند</Label>
            <ItemPicker onSelect={addLine} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-2">
            {totals.computed.length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">لم تُضف بنود بعد.</p>
            )}
            {totals.computed.map((line) => (
              <div key={line.key} className="grid grid-cols-12 items-center gap-2 text-sm">
                <span className="col-span-4 truncate">{line.description}</span>
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  value={line.price}
                  onChange={(e) => updateLine(line.key, { price: Number(e.target.value) })}
                />
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: Number(e.target.value) })}
                />
                <Input
                  className="col-span-2 h-8"
                  type="number"
                  min={0}
                  max={100}
                  value={line.discount_percent}
                  onChange={(e) => updateLine(line.key, { discount_percent: Number(e.target.value) })}
                  title="نسبة الخصم %"
                />
                <span className="col-span-1 text-left text-xs font-semibold">{line.net.toFixed(2)}</span>
                <Button variant="ghost" size="sm" className="col-span-1" onClick={() => removeLine(line.key)}>
                  حذف
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-end gap-1 text-sm">
            <span>الإجمالي الفرعي: {totals.subtotal.toFixed(2)}</span>
            <span>الخصم: {totals.discount.toFixed(2)}</span>
            <span>الضريبة: {totals.vat.toFixed(2)}</span>
            <span className="text-base font-bold">الصافي: {totals.net.toFixed(2)} ر.س</span>
          </div>
        </div>

        <DialogFooter>
          <Button disabled={createInvoice.isPending || lines.length === 0} onClick={() => createInvoice.mutate()}>
            <Receipt className="h-4 w-4" />
            {createInvoice.isPending ? "جارٍ الحفظ..." : "حفظ الفاتورة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentDialog({
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
  const [amount, setAmount] = useState("");

  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!organizationId || !invoice) throw new Error("بيانات غير مكتملة");
      const paymentAmount = Number(amount);
      if (!paymentAmount || paymentAmount <= 0) throw new Error("أدخل مبلغًا صحيحًا");

      const { data: voucher, error: voucherError } = await supabase
        .from("financial_vouchers")
        .insert({
          organization_id: organizationId,
          voucher_type: "receipt",
          amount: paymentAmount,
          patient_id: invoice.patient?.id ?? null,
          related_sales_invoice_id: invoice.id,
          description: `دفعة على الفاتورة #${invoice.invoice_number}`,
        })
        .select("id")
        .single();
      if (voucherError) throw voucherError;

      const { error: allocationError } = await supabase.from("voucher_invoice_allocations").insert({
        voucher_id: voucher.id,
        sales_invoice_id: invoice.id,
        amount: paymentAmount,
      });
      if (allocationError) throw allocationError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      toast({ title: "تم تسجيل الدفعة" });
      setAmount("");
      onOpenChange();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تسجيل الدفعة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل دفعة</DialogTitle>
          <DialogDescription>
            فاتورة #{invoice?.invoice_number} — المتبقي {Number(invoice?.remaining_amount ?? 0).toLocaleString("ar-SA")} ر.س
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>المبلغ المستلم</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button disabled={recordPayment.isPending || !amount} onClick={() => recordPayment.mutate()}>
            {recordPayment.isPending ? "جارٍ الحفظ..." : "تسجيل الدفعة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
