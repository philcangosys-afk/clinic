import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Truck, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { DistributorRow, PurchaseInvoiceRow, PurchasePaymentTerm } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import LookupSelect from "@/components/shared/LookupSelect";
import ItemPicker from "@/components/shared/ItemPicker";

function useWarehousesList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["warehouses-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Procurement() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">المشتريات والموردون</h1>
        <p className="text-sm text-muted-foreground">إدارة الموردين وفواتير الشراء — كل فاتورة شراء تُنشئ تلقائيًا دفعة مخزون وحركة استلام</p>
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">فواتير الشراء</TabsTrigger>
          <TabsTrigger value="distributors">الموردون</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices" className="mt-4">
          <PurchaseInvoicesTab />
        </TabsContent>
        <TabsContent value="distributors" className="mt-4">
          <DistributorsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الموردون
// ---------------------------------------------------------------------------
function useDistributors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["distributors", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, file_number, name_ar, mobile_1, is_dental_lab, is_disabled")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as Pick<DistributorRow, "id" | "file_number" | "name_ar" | "mobile_1" | "is_dental_lab" | "is_disabled">[];
    },
  });
}

function DistributorsTab() {
  const { organization } = useOrganizationAccess();
  const distributors = useDistributors(organization?.id);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>الموردون</CardTitle>
          <CardDescription>تشمل موزعي الأدوية ومعامل الأسنان وموردي المستلزمات</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          مورد جديد
        </Button>
      </CardHeader>
      <CardContent>
        {distributors.isLoading && <Skeleton className="h-40 w-full" />}
        {!distributors.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#الملف</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>الجوال</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(distributors.data ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">#{d.file_number}</TableCell>
                  <TableCell className="flex items-center gap-2 font-medium">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    {d.name_ar}
                  </TableCell>
                  <TableCell>{d.mobile_1 ?? "—"}</TableCell>
                  <TableCell>{d.is_dental_lab ? <Badge variant="default">معمل أسنان</Badge> : "مورد عام"}</TableCell>
                  <TableCell>
                    <Badge variant={d.is_disabled ? "secondary" : "success"}>{d.is_disabled ? "معطّل" : "نشط"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(distributors.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا يوجد موردون بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewDistributorDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewDistributorDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nameAr, setNameAr] = useState("");
  const [mobile, setMobile] = useState("");
  const [typeValueId, setTypeValueId] = useState("");
  const [isDentalLab, setIsDentalLab] = useState(false);

  const createDistributor = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("distributors").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        mobile_1: mobile.trim() || null,
        distributor_type_value_id: typeValueId || null,
        is_dental_lab: isDentalLab,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributors", organizationId] });
      toast({ title: "تم حفظ المورد" });
      setNameAr("");
      setMobile("");
      setTypeValueId("");
      setIsDentalLab(false);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>مورد جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجوال</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نوع المورد</Label>
            <LookupSelect categoryKey="distributor_types" value={typeValueId} onChange={setTypeValueId} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDentalLab} onChange={(e) => setIsDentalLab(e.target.checked)} />
            معمل أسنان
          </label>
        </div>
        <DialogFooter>
          <Button disabled={!nameAr.trim() || createDistributor.isPending} onClick={() => createDistributor.mutate()}>
            {createDistributor.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// فواتير الشراء
// ---------------------------------------------------------------------------
function usePurchaseInvoices(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-invoices", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_number, invoice_date, payment_term, net_amount, distributor:distributors(name_ar)")
        .eq("organization_id", organizationId)
        .order("invoice_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function PurchaseInvoicesTab() {
  const { organization } = useOrganizationAccess();
  const invoices = usePurchaseInvoices(organization?.id);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>فواتير الشراء</CardTitle>
          <CardDescription>حفظ الفاتورة يُنشئ تلقائيًا دفعة مخزون (Lot) وحركة استلام (purchase_in) لكل بند</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          فاتورة شراء جديدة
        </Button>
      </CardHeader>
      <CardContent>
        {invoices.isLoading && <Skeleton className="h-40 w-full" />}
        {!invoices.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الفاتورة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>المورد</TableHead>
                <TableHead>طريقة السداد</TableHead>
                <TableHead>الصافي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoices.data ?? []).map((inv) => {
                const distributor = Array.isArray(inv.distributor) ? inv.distributor[0] : inv.distributor;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">{inv.invoice_number ?? "—"}</TableCell>
                    <TableCell>{inv.invoice_date}</TableCell>
                    <TableCell className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {distributor?.name_ar ?? "—"}
                    </TableCell>
                    <TableCell>{inv.payment_term === "credit" ? "آجل" : "نقدي"}</TableCell>
                    <TableCell>{Number(inv.net_amount).toLocaleString("ar-SA")} ر.س</TableCell>
                  </TableRow>
                );
              })}
              {(invoices.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد فواتير شراء بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewPurchaseInvoiceDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewPurchaseInvoiceDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const distributors = useDistributors(organizationId);
  const warehouses = useWarehousesList(organizationId);
  const [distributorId, setDistributorId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paymentTerm, setPaymentTerm] = useState<PurchasePaymentTerm>("cash");
  const [lines, setLines] = useState<{ itemId: string; name: string; qty: string; price: string; expiryDate: string }[]>([]);

  const subtotal = lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.price) || 0), 0);
  const vatAmount = subtotal * 0.15;
  const netAmount = subtotal + vatAmount;

  const createInvoice = useMutation({
    mutationFn: async () => {
      if (!organizationId || !warehouseId) throw new Error("اختر المستودع");
      if (lines.length === 0) throw new Error("أضف بندًا واحدًا على الأقل");

      const { data: invoice, error: invoiceError } = await supabase
        .from("purchase_invoices")
        .insert({
          organization_id: organizationId,
          warehouse_id: warehouseId,
          distributor_id: distributorId || null,
          invoice_number: invoiceNumber.trim() || null,
          payment_term: paymentTerm,
          subtotal_amount: subtotal,
          vat_amount: vatAmount,
          net_amount: netAmount,
        })
        .select("id")
        .single();
      if (invoiceError) throw invoiceError;

      for (const line of lines) {
        const qty = Number(line.qty) || 0;
        const price = Number(line.price) || 0;
        const lineVat = qty * price * 0.15;

        const { data: invoiceItem, error: itemError } = await supabase
          .from("purchase_invoice_items")
          .insert({
            purchase_invoice_id: invoice.id,
            item_id: line.itemId,
            purchase_price: price,
            qty,
            vat_rate: 15,
            vat_amount: lineVat,
            net_amount: qty * price + lineVat,
            expiry_date: line.expiryDate || null,
          })
          .select("id")
          .single();
        if (itemError) throw itemError;

        const { data: lot, error: lotError } = await supabase
          .from("inventory_lots")
          .insert({
            organization_id: organizationId,
            warehouse_id: warehouseId,
            item_id: line.itemId,
            purchase_invoice_item_id: invoiceItem.id,
            unit_cost: price,
            qty_received: qty,
            qty_remaining: qty,
            expiry_date: line.expiryDate || null,
          })
          .select("id")
          .single();
        if (lotError) throw lotError;

        const { error: movementError } = await supabase.from("inventory_movements").insert({
          organization_id: organizationId,
          warehouse_id: warehouseId,
          item_id: line.itemId,
          lot_id: lot.id,
          movement_type: "purchase_in",
          qty,
          unit_price: price,
          total_amount: qty * price,
          related_purchase_invoice_id: invoice.id,
        });
        if (movementError) throw movementError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lots"] });
      toast({ title: "تم حفظ فاتورة الشراء واستلام المخزون" });
      setDistributorId("");
      setWarehouseId("");
      setInvoiceNumber("");
      setLines([]);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الفاتورة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>فاتورة شراء جديدة</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>المورد</Label>
              <Select value={distributorId} onValueChange={setDistributorId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختياري" />
                </SelectTrigger>
                <SelectContent>
                  {(distributors.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المستودع *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر المستودع" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>رقم فاتورة المورد</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>طريقة السداد</Label>
              <Select value={paymentTerm} onValueChange={(v) => setPaymentTerm(v as PurchasePaymentTerm)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="credit">آجل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />
          <Label>البنود</Label>
          <ItemPicker
            onSelect={(item) =>
              setLines((ls) => [...ls, { itemId: item.id, name: item.name_ar, qty: "1", price: String(item.price), expiryDate: "" }])
            }
          />
          {lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2 rounded-md border p-2">
              <span className="flex-1 text-sm font-medium">{line.name}</span>
              <Input
                type="number"
                min={0}
                className="w-20"
                placeholder="الكمية"
                value={line.qty}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, qty: e.target.value } : l)))}
              />
              <Input
                type="number"
                min={0}
                className="w-24"
                placeholder="سعر الشراء"
                value={line.price}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, price: e.target.value } : l)))}
              />
              <Input
                type="date"
                className="w-36"
                value={line.expiryDate}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, expiryDate: e.target.value } : l)))}
              />
              <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex justify-end gap-6 rounded-md border p-2 text-sm">
            <span>الإجمالي: {subtotal.toLocaleString("ar-SA")}</span>
            <span>الضريبة: {vatAmount.toLocaleString("ar-SA")}</span>
            <span className="font-semibold">الصافي: {netAmount.toLocaleString("ar-SA")}</span>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!warehouseId || lines.length === 0 || createInvoice.isPending} onClick={() => createInvoice.mutate()}>
            {createInvoice.isPending ? "جارٍ الحفظ..." : "حفظ الفاتورة واستلام المخزون"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
