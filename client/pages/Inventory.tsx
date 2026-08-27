import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Plus, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  InventoryMovementType,
  StockTransferPriority,
  StockTransferStatus,
  StockTransferType,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import ItemPicker from "@/components/shared/ItemPicker";

const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  purchase_in: "استلام شراء",
  sale_out: "بيع",
  return_in: "مرتجع وارد",
  return_out: "مرتجع صادر",
  transfer_in: "مناقلة واردة",
  transfer_out: "مناقلة صادرة",
  adjustment_in: "تسوية زيادة",
  adjustment_out: "تسوية نقص",
  consumption_out: "استهلاك",
};
const IN_TYPES: InventoryMovementType[] = ["purchase_in", "return_in", "transfer_in", "adjustment_in"];

const TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  pending: "قيد الانتظار",
  approved: "مُعتمَدة",
  rejected: "مرفوضة",
  completed: "مكتملة",
};
const PRIORITY_LABELS: Record<StockTransferPriority, string> = {
  low: "منخفضة",
  normal: "عادية",
  high: "مرتفعة",
  urgent: "عاجلة",
};

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

export default function Inventory() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">حركات المخزون</h1>
        <p className="text-sm text-muted-foreground">سجل الحركات، الدفعات وصلاحيتها، والمناقلات بين المستودعات</p>
      </div>

      <Tabs defaultValue="movements">
        <TabsList>
          <TabsTrigger value="movements">سجل الحركات</TabsTrigger>
          <TabsTrigger value="lots">الدفعات والصلاحية</TabsTrigger>
          <TabsTrigger value="transfers">المناقلات</TabsTrigger>
        </TabsList>
        <TabsContent value="movements" className="mt-4">
          <MovementsTab />
        </TabsContent>
        <TabsContent value="lots" className="mt-4">
          <LotsTab />
        </TabsContent>
        <TabsContent value="transfers" className="mt-4">
          <TransfersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// سجل الحركات
// ---------------------------------------------------------------------------
function useInventoryMovements(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["inventory-movements", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id, movement_type, qty, unit_price, total_amount, created_at, item:items(name_ar), warehouse:warehouses(name)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function MovementsTab() {
  const { organization } = useOrganizationAccess();
  const movements = useInventoryMovements(organization?.id);
  const [adjustOpen, setAdjustOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>آخر 100 حركة</CardTitle>
          <CardDescription>سجل كامل غير قابل للتعديل — أي تصحيح يتم بحركة تسوية جديدة لا بتعديل حركة قديمة</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
          <Plus className="h-4 w-4" />
          تسوية مخزون يدوية
        </Button>
      </CardHeader>
      <CardContent>
        {movements.isLoading && <Skeleton className="h-40 w-full" />}
        {!movements.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الصنف</TableHead>
                <TableHead>المستودع</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الكمية</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(movements.data ?? []).map((m) => {
                const item = Array.isArray(m.item) ? m.item[0] : m.item;
                const warehouse = Array.isArray(m.warehouse) ? m.warehouse[0] : m.warehouse;
                const isIn = IN_TYPES.includes(m.movement_type as InventoryMovementType);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{new Date(m.created_at).toLocaleString("ar-SA")}</TableCell>
                    <TableCell className="font-medium">{item?.name_ar ?? "—"}</TableCell>
                    <TableCell>{warehouse?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={isIn ? "success" : "secondary"}>
                        {MOVEMENT_TYPE_LABELS[m.movement_type as InventoryMovementType]}
                      </Badge>
                    </TableCell>
                    <TableCell className={isIn ? "text-emerald-700" : "text-red-700"}>
                      {isIn ? "+" : "-"}
                      {m.qty}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(movements.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد حركات مخزون بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <AdjustmentDialog open={adjustOpen} onOpenChange={setAdjustOpen} organizationId={organization?.id} />
    </Card>
  );
}

function AdjustmentDialog({
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
  const warehouses = useWarehousesList(organizationId);
  const [warehouseId, setWarehouseId] = useState("");
  const [direction, setDirection] = useState<"adjustment_in" | "adjustment_out">("adjustment_in");
  const [item, setItem] = useState<{ id: string; name_ar: string } | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");

  const createAdjustment = useMutation({
    mutationFn: async () => {
      if (!organizationId || !warehouseId || !item) throw new Error("بيانات غير مكتملة");
      const { error } = await supabase.from("inventory_movements").insert({
        organization_id: organizationId,
        warehouse_id: warehouseId,
        item_id: item.id,
        movement_type: direction,
        qty: Number(qty) || 0,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-movements", organizationId] });
      toast({ title: "تم تسجيل التسوية" });
      setItem(null);
      setQty("1");
      setNote("");
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
          <DialogTitle>تسوية مخزون يدوية</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
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
          <div className="flex flex-col gap-1.5">
            <Label>الصنف *</Label>
            {item ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="font-medium">{item.name_ar}</span>
                <Button size="sm" variant="ghost" onClick={() => setItem(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <ItemPicker onSelect={(i) => setItem({ id: i.id, name_ar: i.name_ar })} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>الاتجاه</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "adjustment_in" | "adjustment_out")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adjustment_in">زيادة (+)</SelectItem>
                  <SelectItem value="adjustment_out">نقص (-)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الكمية</Label>
              <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سبب التسوية</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: جرد فعلي، تلف، تصحيح خطأ إدخال" />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!warehouseId || !item || createAdjustment.isPending} onClick={() => createAdjustment.mutate()}>
            {createAdjustment.isPending ? "جارٍ الحفظ..." : "حفظ التسوية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// الدفعات والصلاحية
// ---------------------------------------------------------------------------
function useInventoryLots(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["inventory-lots", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_lots")
        .select("id, lot_number, qty_remaining, expiry_date, unit_cost, item:items(name_ar), warehouse:warehouses(name)")
        .eq("organization_id", organizationId)
        .gt("qty_remaining", 0)
        .order("expiry_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function LotsTab() {
  const { organization } = useOrganizationAccess();
  const lots = useInventoryLots(organization?.id);
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  return (
    <Card>
      <CardHeader>
        <CardTitle>الدفعات المتاحة</CardTitle>
        <CardDescription>الدفعات التي ستنتهي خلال 30 يومًا مُميَّزة — نفس البيانات التي تغذّي تنبيهات انتهاء الصلاحية الموحَّدة</CardDescription>
      </CardHeader>
      <CardContent>
        {lots.isLoading && <Skeleton className="h-40 w-full" />}
        {!lots.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الصنف</TableHead>
                <TableHead>المستودع</TableHead>
                <TableHead>رقم الدفعة</TableHead>
                <TableHead>المتبقي</TableHead>
                <TableHead>تاريخ الانتهاء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(lots.data ?? []).map((lot) => {
                const item = Array.isArray(lot.item) ? lot.item[0] : lot.item;
                const warehouse = Array.isArray(lot.warehouse) ? lot.warehouse[0] : lot.warehouse;
                const isNearExpiry = lot.expiry_date && new Date(lot.expiry_date) <= thirtyDaysFromNow;
                return (
                  <TableRow key={lot.id}>
                    <TableCell className="font-medium">{item?.name_ar ?? "—"}</TableCell>
                    <TableCell>{warehouse?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{lot.lot_number ?? "—"}</TableCell>
                    <TableCell>{lot.qty_remaining}</TableCell>
                    <TableCell>
                      {lot.expiry_date ? (
                        <Badge variant={isNearExpiry ? "warning" : "secondary"}>{lot.expiry_date}</Badge>
                      ) : (
                        "بلا تاريخ انتهاء"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(lots.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد دفعات متاحة حاليًا.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// المناقلات
// ---------------------------------------------------------------------------
function useStockTransfers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["stock-transfers", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_transfers")
        .select(
          "id, transfer_type, status, priority, note, created_at, from_warehouse_id, to_warehouse_id, from_warehouse:warehouses!stock_transfers_from_warehouse_id_fkey(name), to_warehouse:warehouses!stock_transfers_to_warehouse_id_fkey(name), stock_transfer_items(id, item_id, qty, item:items(name_ar))",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function TransfersTab() {
  const { organization } = useOrganizationAccess();
  const transfers = useStockTransfers(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase.from("stock_transfers").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers", organization?.id] });
      toast({ title: "تم تحديث حالة المناقلة" });
    },
  });

  const completeTransfer = useMutation({
    mutationFn: async (transfer: { id: string; from_warehouse_id: string | null; to_warehouse_id: string | null; items: { item_id: string; qty: number }[] }) => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!transfer.from_warehouse_id || !transfer.to_warehouse_id) throw new Error("المناقلة تحتاج مستودعًا مصدرًا ووجهة");

      for (const line of transfer.items) {
        const { error: outError } = await supabase.from("inventory_movements").insert({
          organization_id: organization.id,
          warehouse_id: transfer.from_warehouse_id,
          item_id: line.item_id,
          movement_type: "transfer_out",
          qty: line.qty,
          related_stock_transfer_id: transfer.id,
        });
        if (outError) throw outError;

        const { error: inError } = await supabase.from("inventory_movements").insert({
          organization_id: organization.id,
          warehouse_id: transfer.to_warehouse_id,
          item_id: line.item_id,
          movement_type: "transfer_in",
          qty: line.qty,
          related_stock_transfer_id: transfer.id,
        });
        if (inError) throw inError;
      }

      const { error: statusError } = await supabase.from("stock_transfers").update({ status: "completed" }).eq("id", transfer.id);
      if (statusError) throw statusError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
      toast({ title: "تم تنفيذ المناقلة وتحديث المخزون في المستودعين" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تنفيذ المناقلة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>مناقلات المستودعات</CardTitle>
          <CardDescription>طلب ← اعتماد ← تنفيذ (ينشئ حركتين: صادر من المصدر ووارد للوجهة في آن واحد)</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          طلب مناقلة جديد
        </Button>
      </CardHeader>
      <CardContent>
        {transfers.isLoading && <Skeleton className="h-40 w-full" />}
        {!transfers.isLoading && (
          <div className="flex flex-col gap-3">
            {(transfers.data ?? []).map((t) => {
              const fromWh = Array.isArray(t.from_warehouse) ? t.from_warehouse[0] : t.from_warehouse;
              const toWh = Array.isArray(t.to_warehouse) ? t.to_warehouse[0] : t.to_warehouse;
              const items = (t.stock_transfer_items ?? []).map((line) => {
                const lineItem = Array.isArray(line.item) ? line.item[0] : line.item;
                return { name: lineItem?.name_ar ?? "—", qty: line.qty };
              });
              return (
                <div key={t.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium">
                      <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                      {fromWh?.name ?? "—"} ← {toWh?.name ?? "—"}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.priority === "urgent" || t.priority === "high" ? "warning" : "secondary"}>
                        {PRIORITY_LABELS[t.priority as StockTransferPriority]}
                      </Badge>
                      <Badge
                        variant={
                          t.status === "completed" ? "success" : t.status === "rejected" ? "destructive" : t.status === "approved" ? "default" : "secondary"
                        }
                      >
                        {TRANSFER_STATUS_LABELS[t.status as StockTransferStatus]}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{items.map((i) => `${i.name} × ${i.qty}`).join(" · ")}</p>
                  <div className="mt-2 flex gap-2">
                    {t.status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: t.id, status: "approved" })}>
                          اعتماد
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ id: t.id, status: "rejected" })}>
                          رفض
                        </Button>
                      </>
                    )}
                    {t.status === "approved" && (
                      <Button
                        size="sm"
                        disabled={completeTransfer.isPending}
                        onClick={() =>
                          completeTransfer.mutate({
                            id: t.id,
                            from_warehouse_id: t.from_warehouse_id,
                            to_warehouse_id: t.to_warehouse_id,
                            items: (t.stock_transfer_items ?? []).map((line) => ({ item_id: line.item_id, qty: Number(line.qty) })),
                          })
                        }
                      >
                        تنفيذ
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {(transfers.data ?? []).length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">لا توجد مناقلات بعد.</p>
            )}
          </div>
        )}
      </CardContent>
      <NewTransferDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewTransferDialog({
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
  const warehouses = useWarehousesList(organizationId);
  const [transferType, setTransferType] = useState<StockTransferType>("transfer");
  const [priority, setPriority] = useState<StockTransferPriority>("normal");
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<{ itemId: string; name: string; qty: string }[]>([]);

  const createTransfer = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (lines.length === 0) throw new Error("أضف صنفًا واحدًا على الأقل");

      const { data: transfer, error: transferError } = await supabase
        .from("stock_transfers")
        .insert({
          organization_id: organizationId,
          transfer_type: transferType,
          priority,
          from_warehouse_id: fromWarehouseId || null,
          to_warehouse_id: toWarehouseId || null,
          note: note.trim() || null,
        })
        .select("id")
        .single();
      if (transferError) throw transferError;

      const { error: itemsError } = await supabase.from("stock_transfer_items").insert(
        lines.map((line) => ({ transfer_id: transfer.id, item_id: line.itemId, qty: Number(line.qty) || 1 })),
      );
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers", organizationId] });
      toast({ title: "تم تسجيل طلب المناقلة" });
      setFromWarehouseId("");
      setToWarehouseId("");
      setNote("");
      setLines([]);
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>طلب مناقلة جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>من مستودع</Label>
              <Select value={fromWarehouseId} onValueChange={setFromWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="المصدر" />
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
            <div className="flex flex-col gap-1.5">
              <Label>إلى مستودع</Label>
              <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="الوجهة" />
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
              <Label>النوع</Label>
              <Select value={transferType} onValueChange={(v) => setTransferType(v as StockTransferType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transfer">مناقلة بين مستودعين</SelectItem>
                  <SelectItem value="purchase_requisition">طلب شراء</SelectItem>
                  <SelectItem value="disbursement">صرف/إخراج</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الأولوية</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as StockTransferPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Label>البنود</Label>
          <ItemPicker onSelect={(item) => setLines((ls) => [...ls, { itemId: item.id, name: item.name_ar, qty: "1" }])} />
          {lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{line.name}</span>
              <Input
                type="number"
                min={1}
                className="w-24"
                value={line.qty}
                onChange={(e) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, qty: e.target.value } : l)))}
              />
              <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={lines.length === 0 || createTransfer.isPending} onClick={() => createTransfer.mutate()}>
            {createTransfer.isPending ? "جارٍ الحفظ..." : "إرسال الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
