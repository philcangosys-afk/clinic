import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Plus, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import {
  allocateFifo,
  fetchSourceLots,
  writeInboundLotsAndMovements,
  writeOutboundMovements,
  type LotAllocation,
} from "@/lib/inventory-lots";
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
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdvancedInventory from "@/components/inventory/AdvancedInventory";
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

// حالات المناقلة كما يقبلها قيد القاعدة (0098). كانت هذه الخريطة تحمل
// `pending` و`completed` ولا وجود لهما في القيد، فكانت شارة الحالة تظهر فارغة
// لخمس حالات من سبع، وكان زرّ التنفيذ يحاول ختم المناقلة بحالة يرفضها القيد
// **بعد** أن نقل المخزون فعلًا — فتبقى معروضة كمعلَّقة وتُنفَّذ ثانيةً.
const TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  draft: "مسوّدة",
  requested: "طلب مُرسَل",
  approved: "مُعتمَدة",
  rejected: "مرفوضة",
  shipped: "أُرسلت",
  received: "استُلمت",
  cancelled: "ملغاة",
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

      <Tabs defaultValue="onhand">
        <TabsList>
          <TabsTrigger value="onhand">الموجودات</TabsTrigger>
          <TabsTrigger value="movements">سجل الحركات</TabsTrigger>
          <TabsTrigger value="lots">الدفعات والصلاحية</TabsTrigger>
          <TabsTrigger value="alerts">التنبيهات</TabsTrigger>
          <TabsTrigger value="transfers">المناقلات</TabsTrigger>
          <TabsTrigger value="advanced">المخزون المتقدم</TabsTrigger>
        </TabsList>
        <TabsContent value="onhand" className="mt-4">
          <OnHandTab />
        </TabsContent>
        <TabsContent value="movements" className="mt-4">
          <MovementsTab />
        </TabsContent>
        <TabsContent value="lots" className="mt-4">
          <LotsTab />
        </TabsContent>
        <TabsContent value="alerts" className="mt-4">
          <StockAlertsTab />
        </TabsContent>
        <TabsContent value="advanced" className="mt-4">
          <AdvancedInventory />
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
        .select("id, movement_type, qty, unit_price, total_amount, created_at, item_id, warehouse_id, doctor_id, item:items(name_ar), warehouse:warehouses(name), doctor:doctors(name_ar)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * تجميعات سجل الحركات (لقطتا 72 و73). التجميع يتم في الواجهة على الحركات
 * المحمَّلة (آخر 100) لا في قاعدة البيانات — وهذا حدّ معلَن في الواجهة نفسها
 * حتى لا يُقرأ الإجمالي على أنه إجمالي كل تاريخ المخزون.
 */
const GROUP_MODES = [
  { value: "none", label: "بلا تجميع" },
  { value: "item", label: "حسب الصنف" },
  { value: "warehouse", label: "حسب المستودع" },
  { value: "doctor", label: "حسب الطبيب" },
];

function MovementsTab() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const movements = useInventoryMovements(organization?.id);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [groupMode, setGroupMode] = useState("none");
  // التسوية صلاحية منفصلة عن إدارة المخزون: `inventory.manage` تكفي للاستلام
  // والصرف، والتسوية تغيّر الرصيد بلا مستند مقابل فلها `inventory.adjust`.
  // كان الزرّ معروضًا للجميع بينما زرّ «تسوية» على الدفعة في التبويب المجاور
  // محجوبٌ بالصلاحية نفسها — تناقضٌ يجعل الحاجز بلا معنى.
  const canAdjust = can("inventory.adjust");

  const grouped = (() => {
    if (groupMode === "none") return null;
    // المفتاح يُحفظ داخل القيمة ليُستعمل مفتاحًا لصف React: الاسم وحده لا
    // يصلح — لا شيء يمنع صنفين من حمل نفس الاسم (القيد الفريد على الكود لا
    // على الاسم)، فيتكرّر مفتاح React ويختلط الصفان عند تبديل نمط التجميع.
    const map = new Map<
      string,
      { key: string; label: string; inQty: number; outQty: number; amount: number; count: number }
    >();
    (movements.data ?? []).forEach((m: any) => {
      const item = Array.isArray(m.item) ? m.item[0] : m.item;
      const warehouse = Array.isArray(m.warehouse) ? m.warehouse[0] : m.warehouse;
      const doctor = Array.isArray(m.doctor) ? m.doctor[0] : m.doctor;
      const key =
        groupMode === "item"
          ? (m.item_id ?? "—")
          : groupMode === "warehouse"
            ? (m.warehouse_id ?? "—")
            : (m.doctor_id ?? "__none__");
      const label =
        groupMode === "item"
          ? (item?.name_ar ?? "صنف محذوف")
          : groupMode === "warehouse"
            ? (warehouse?.name ?? "مستودع محذوف")
            : (doctor?.name_ar ?? "بلا طبيب");
      const isIn = IN_TYPES.includes(m.movement_type as InventoryMovementType);
      const current = map.get(key) ?? { key, label, inQty: 0, outQty: 0, amount: 0, count: 0 };
      if (isIn) current.inQty += Number(m.qty ?? 0);
      else current.outQty += Number(m.qty ?? 0);
      current.amount += Number(m.total_amount ?? 0);
      current.count += 1;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  })();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>آخر 100 حركة</CardTitle>
          <CardDescription>سجل كامل غير قابل للتعديل — أي تصحيح يتم بحركة تسوية جديدة لا بتعديل حركة قديمة</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupMode} onValueChange={setGroupMode}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_MODES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canAdjust && (
            <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
              <Plus className="h-4 w-4" />
              تسوية مخزون يدوية
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {movements.isLoading && <Skeleton className="h-40 w-full" />}

        {!movements.isLoading && grouped && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              التجميع محسوب على آخر 100 حركة معروضة فقط، لا على كامل تاريخ المخزون.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{GROUP_MODES.find((g) => g.value === groupMode)?.label.replace("حسب ", "")}</TableHead>
                  <TableHead>عدد الحركات</TableHead>
                  <TableHead>وارد</TableHead>
                  <TableHead>صادر</TableHead>
                  <TableHead>الصافي</TableHead>
                  <TableHead>القيمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="tabular-nums">{row.count}</TableCell>
                    <TableCell className="tabular-nums text-emerald-700">{row.inQty.toFixed(2)}</TableCell>
                    <TableCell className="tabular-nums text-destructive">{row.outQty.toFixed(2)}</TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {(row.inQty - row.outQty).toFixed(2)}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.amount.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {grouped.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد حركات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {!movements.isLoading && !grouped && (
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
  const [unitCostInput, setUnitCostInput] = useState("");

  /**
   * متوسط التكلفة الحالي للصنف في هذا المستودع — يُقرأ قبل الحفظ لا بعده، حتى
   * يرى المستخدم بأي تكلفة ستدخل بضاعته. عودته فارغًا تعني «لا رصيد سابق»،
   * وكانت التسوية حينها تُدخل الدفعة بتكلفة صفر بلا أي تنبيه: فتنخفض قيمة
   * المخزون والمتوسط المرجَّح، ويظهر «الربح المتوقع» أكبر ممّا هو.
   */
  const onHandCost = useQuery({
    queryKey: ["adjust-avg-cost", organizationId, warehouseId, item?.id],
    enabled: Boolean(organizationId && warehouseId && item?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_inventory_on_hand")
        .select("weighted_avg_cost")
        .eq("organization_id", organizationId)
        .eq("warehouse_id", warehouseId)
        .eq("item_id", item!.id)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.weighted_avg_cost ?? 0);
    },
  });
  const knownAvgCost = Number(onHandCost.data ?? 0);
  const needsManualCost = direction === "adjustment_in" && !(knownAvgCost > 0);

  /**
   * **إصلاح الخلل نفسه الموجود في المناقلات**: التسوية كانت تُدرج حركة بلا
   * `lot_id`، والمُحفِّز يتجاهلها — فتظهر في السجل ولا تغيّر الرصيد إطلاقًا.
   * جردٌ فعليّ ينقص قطعتين تالفتين كان يُسجَّل ولا يُنقص شيئًا.
   *
   * والنقص الآن يمرّ بـ `app_adjust_stock` لكل دفعة مخصَّصة بدل الكتابة
   * المباشرة في `inventory_movements`: **لماذا؟** لأن سياسة RLS على جدول
   * الحركات تفحص `inventory.manage` وحدها، فمن يملكها ولا يملك
   * `inventory.adjust` كان ينقص الرصيد بلا حقّ، وبلا سببٍ مسجَّل، ودون أن
   * يُفحَص المحجوز لوصفات لم تُصرَف بعد. الدالّة تفحص الثلاثة وتكتب قيد تدقيق.
   *
   * التسوية بالزيادة تُنشئ دفعة جديدة، ولا دفعة قائمة تُمرَّر إلى الدالّة —
   * فبقيت كتابةً من العميل، بتكلفة يُلزَم المستخدم بها إن لم يكن للصنف رصيد
   * سابق يُشتقّ منه المتوسط.
   */
  const createAdjustment = useMutation({
    mutationFn: async () => {
      if (!organizationId || !warehouseId || !item) throw new Error("بيانات غير مكتملة");
      const quantity = Number(qty);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر");
      // السبب إلزامي في الواجهة كما هو إلزامي داخل `app_adjust_stock`: تسويةٌ
      // بلا سبب مسجَّل تجعل فرق الجرد غير قابل للمراجعة لاحقًا.
      if (!note.trim()) throw new Error("اكتب سبب التسوية");

      if (direction === "adjustment_out") {
        const lots = await fetchSourceLots(organizationId, warehouseId, item.id);
        const allocations = allocateFifo(lots, quantity, item.name_ar);
        // التخصيص على عدّة دفعات = عدّة استدعاءات، وكلّ استدعاء معاملةٌ وحده.
        // فلو رفضت القاعدة دفعةً وسطى (كمية محجوزة مثلًا) وجب أن تقول الرسالة
        // ما نُقص فعلًا بدل «تعذرت التسوية» التي تُفهَم أنه لم يُنقص شيء.
        let doneQty = 0;
        for (const allocation of allocations) {
          const { error } = await supabase.rpc("app_adjust_stock", {
            p_lot_id: allocation.lotId,
            p_qty: -allocation.qty,
            p_reason: note.trim(),
          });
          if (error) {
            if (doneQty > 0)
              throw new Error(
                `${error.message} — نُقص ${doneQty} من ${quantity} قبل التوقّف؛ راجع الرصيد قبل إعادة المحاولة`,
              );
            throw error;
          }
          doneQty += allocation.qty;
        }
        return;
      }

      const unitCost = knownAvgCost > 0 ? knownAvgCost : Number(unitCostInput);
      if (!Number.isFinite(unitCost) || unitCost <= 0)
        throw new Error("لا رصيد سابق لهذا الصنف في المستودع — اكتب تكلفة الوحدة");
      await writeInboundLotsAndMovements({
        organizationId,
        warehouseId,
        itemId: item.id,
        movementType: "adjustment_in",
        allocations: [{ lotId: "", qty: quantity, unitCost, expiryDate: null }],
        note: note.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-movements", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lots"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-on-hand"] });
      queryClient.invalidateQueries({ queryKey: ["stock-alerts", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["adjust-avg-cost", organizationId] });
      toast({ title: "تم تسجيل التسوية وتحديث الرصيد" });
      setItem(null);
      setQty("1");
      setNote("");
      setUnitCostInput("");
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
          {direction === "adjustment_in" && item && warehouseId && !onHandCost.isLoading && (
            needsManualCost ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
                <p className="text-xs text-amber-800">
                  لا رصيد سابق لهذا الصنف في المستودع، فلا متوسط تكلفة يُشتقّ منه. إدخال البضاعة
                  بتكلفة صفر يخفض قيمة المخزون ويُظهر الربح المتوقع أكبر ممّا هو — اكتب تكلفة الوحدة.
                </p>
                <Label>تكلفة الوحدة *</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitCostInput}
                  onChange={(e) => setUnitCostInput(e.target.value)}
                />
              </div>
            ) : (
              <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                تكلفة الوحدة ستكون متوسط تكلفة الصنف الحالي في هذا المستودع: {knownAvgCost.toFixed(2)}
              </p>
            )
          )}
          <div className="flex flex-col gap-1.5">
            <Label>سبب التسوية *</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: جرد فعلي، تلف، تصحيح خطأ إدخال" />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={
              !warehouseId ||
              !item ||
              !note.trim() ||
              (needsManualCost && !(Number(unitCostInput) > 0)) ||
              createAdjustment.isPending
            }
            onClick={() => createAdjustment.mutate()}
          >
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
        .select(
          "id, lot_number, qty_remaining, reserved_quantity, status, expiry_date, unit_cost, selling_price, item:items!inventory_lots_item_id_fkey(name_ar), warehouse:warehouses!inventory_lots_warehouse_id_fkey(name)",
        )
        .eq("organization_id", organizationId)
        .gt("qty_remaining", 0)
        .order("expiry_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

const LOT_STATUS_LABELS: Record<string, string> = {
  quarantined: "محجورة",
  recalled: "مسحوبة",
  expired: "منتهية",
};

/** نطاقات تنبيه الصلاحية — كانت العتبة مثبَّتة 30 يومًا في الكود (لقطة 75). */
const EXPIRY_WINDOWS = [
  { value: "30", label: "30 يومًا" },
  { value: "60", label: "60 يومًا" },
  { value: "90", label: "90 يومًا" },
  { value: "180", label: "180 يومًا" },
];

function LotsTab() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const lots = useInventoryLots(organization?.id);
  const [expiryWindow, setExpiryWindow] = useState("90");
  const [nearExpiryOnly, setNearExpiryOnly] = useState(false);
  const [adjustLot, setAdjustLot] = useState<any | null>(null);
  const canAdjust = can("inventory.adjust");

  const threshold = new Date();
  threshold.setDate(threshold.getDate() + Number(expiryWindow));

  const isNear = (expiry: string | null) => Boolean(expiry && new Date(expiry) <= threshold);
  const visibleLots = (lots.data ?? []).filter((lot: any) =>
    nearExpiryOnly ? isNear(lot.expiry_date) : true,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>الدفعات المتاحة</CardTitle>
        <CardDescription>
          الدفعات التي ستنتهي خلال المدة المختارة مُميَّزة — نفس البيانات التي تغذّي تنبيهات انتهاء
          الصلاحية الموحَّدة
        </CardDescription>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm font-normal text-muted-foreground">تنبيه قبل</Label>
            <Select value={expiryWindow} onValueChange={setExpiryWindow}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_WINDOWS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={nearExpiryOnly}
              onChange={(e) => setNearExpiryOnly(e.target.checked)}
              className="h-4 w-4"
            />
            المقاربة على الانتهاء فقط
          </label>
        </div>
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
                <TableHead>المحجوز</TableHead>
                <TableHead>المتاح</TableHead>
                <TableHead>تاريخ الانتهاء</TableHead>
                {canAdjust && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLots.map((lot: any) => {
                const item = Array.isArray(lot.item) ? lot.item[0] : lot.item;
                const warehouse = Array.isArray(lot.warehouse) ? lot.warehouse[0] : lot.warehouse;
                const isNearExpiry = isNear(lot.expiry_date);
                return (
                  <TableRow key={lot.id}>
                    <TableCell className="font-medium">{item?.name_ar ?? "—"}</TableCell>
                    <TableCell>{warehouse?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{lot.lot_number ?? "—"}</TableCell>
                    <TableCell>{lot.qty_remaining}</TableCell>
                    <TableCell>{Number(lot.reserved_quantity ?? 0)}</TableCell>
                    <TableCell className="font-medium">
                      {Number(lot.qty_remaining) - Number(lot.reserved_quantity ?? 0)}
                    </TableCell>
                    <TableCell>
                      {lot.expiry_date ? (
                        <Badge variant={isNearExpiry ? "warning" : "secondary"}>{lot.expiry_date}</Badge>
                      ) : (
                        "بلا تاريخ انتهاء"
                      )}
                      {lot.status && lot.status !== "available" && (
                        <Badge variant="destructive" className="mr-2">
                          {LOT_STATUS_LABELS[lot.status as string] ?? lot.status}
                        </Badge>
                      )}
                    </TableCell>
                    {canAdjust && (
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setAdjustLot(lot)}>
                          تسوية
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {visibleLots.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canAdjust ? 8 : 7} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد دفعات مطابقة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <LotAdjustDialog lot={adjustLot} onClose={() => setAdjustLot(null)} organizationId={organization?.id} />
    </Card>
  );
}

/**
 * تسوية دفعة بعينها عبر `app_adjust_stock` (0088).
 *
 * التسوية القديمة كانت على مستوى **الصنف**: تختار الكمية والاتجاه، والعميل
 * يوزّعها على الدفعات. ذلك يصلح للجرد العام، ولا يصلح حين تكسر عبوةٌ بعينها
 * أو تُتلَف دفعةٌ بعينها — وهو أكثر ما يحدث في صيدلية. والأهم أن الدالّة
 * تمنع النزول دون الكمية المحجوزة لوصفات لم تُصرَف بعد.
 */
function LotAdjustDialog({
  lot,
  onClose,
  organizationId,
}: {
  lot: any | null;
  onClose: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");

  const adjust = useMutation({
    mutationFn: async () => {
      if (!lot) throw new Error("لا دفعة محدَّدة");
      const amount = Number(qty);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر");
      if (!reason.trim()) throw new Error("اكتب سبب التسوية");
      const { error } = await supabase.rpc("app_adjust_stock", {
        p_lot_id: lot.id,
        p_qty: direction === "in" ? amount : -amount,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-lots", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["stock-alerts", organizationId] });
      toast({ title: "سُجّلت التسوية" });
      setQty("1");
      setReason("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذرت التسوية",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const item = lot ? (Array.isArray(lot.item) ? lot.item[0] : lot.item) : null;
  const available = lot ? Number(lot.qty_remaining) - Number(lot.reserved_quantity ?? 0) : 0;

  return (
    <Dialog open={Boolean(lot)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسوية دفعة</DialogTitle>
          <DialogDescription>
            {item?.name_ar ?? "صنف"} — دفعة {lot?.lot_number ?? "بلا رقم"}: المتبقّي {lot?.qty_remaining}،
            المتاح {available}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاتجاه</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "in" | "out")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="out">نقص (تلف، فقد، جرد)</SelectItem>
                <SelectItem value="in">زيادة (تصحيح جرد)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الكمية *</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>السبب *</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            التسوية تُسجَّل حركةً في سجل المخزون وقيدًا في سجل التدقيق، ولا يمكن حذفها.
            النقص لا ينزل دون الكمية المحجوزة لوصفات لم تُصرَف بعد.
          </p>
        </div>
        <DialogFooter>
          <Button disabled={!reason.trim() || adjust.isPending} onClick={() => adjust.mutate()}>
            {adjust.isPending ? "جارٍ الحفظ..." : "تسجيل التسوية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// تنبيهات المخزون
// ---------------------------------------------------------------------------
type StockAlertRow = {
  organization_id: string;
  warehouse_id: string;
  warehouse_name: string;
  item_id: string;
  item_name: string;
  item_code: string | null;
  lot_id: string;
  lot_number: string | null;
  qty_remaining: number;
  expiry_date: string | null;
  days_to_expiry: number | null;
  reorder_level: number;
  alert_type: "expired" | "expiring_soon" | "low_stock";
  alert_label: string;
};

const ALERT_TONE: Record<string, "destructive" | "warning" | "secondary"> = {
  expired: "destructive",
  expiring_soon: "warning",
  low_stock: "secondary",
};

function useStockAlerts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["stock-alerts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_stock_alerts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("expiry_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as StockAlertRow[];
    },
  });
}

/**
 * التنبيهات لم تكن موجودة قبل 0088: دفعةٌ انتهت أمس وبها خمسون قرصًا لم يكن
 * في النظام كله ما يُظهرها، ولا شاشةٌ تقول إن صنفًا نزل دون حدّ إعادة طلبه.
 */
function StockAlertsTab() {
  const { organization } = useOrganizationAccess();
  const alerts = useStockAlerts(organization?.id);
  const [filter, setFilter] = useState("all");

  const rows = (alerts.data ?? []).filter((a) => filter === "all" || a.alert_type === filter);
  const counts = {
    expired: (alerts.data ?? []).filter((a) => a.alert_type === "expired").length,
    expiring_soon: (alerts.data ?? []).filter((a) => a.alert_type === "expiring_soon").length,
    low_stock: (alerts.data ?? []).filter((a) => a.alert_type === "low_stock").length,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>تنبيهات المخزون</CardTitle>
        <CardDescription>
          منتهية بها رصيد ({counts.expired}) — تنتهي خلال ٩٠ يومًا ({counts.expiring_soon}) — دون حدّ
          إعادة الطلب ({counts.low_stock})
        </CardDescription>
        <div className="mt-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل التنبيهات</SelectItem>
              <SelectItem value="expired">منتهية بها رصيد</SelectItem>
              <SelectItem value="expiring_soon">تقارب الانتهاء</SelectItem>
              <SelectItem value="low_stock">دون حدّ إعادة الطلب</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {alerts.isLoading && <Skeleton className="h-40 w-full" />}
        {!alerts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الصنف</TableHead>
                <TableHead>المستودع</TableHead>
                <TableHead>الدفعة</TableHead>
                <TableHead>الرصيد</TableHead>
                <TableHead>الانتهاء</TableHead>
                <TableHead>التنبيه</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={`${a.lot_id}-${a.alert_type}`}>
                  <TableCell className="font-medium">
                    {a.item_name}
                    {a.item_code && <span className="block text-xs text-muted-foreground">{a.item_code}</span>}
                  </TableCell>
                  <TableCell>{a.warehouse_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.lot_number ?? "—"}</TableCell>
                  <TableCell>{Number(a.qty_remaining).toLocaleString("ar-SA")}</TableCell>
                  <TableCell>
                    {a.expiry_date ?? "—"}
                    {a.days_to_expiry != null && (
                      <span className="block text-xs text-muted-foreground">
                        {a.days_to_expiry < 0
                          ? `انتهت منذ ${Math.abs(a.days_to_expiry)} يومًا`
                          : `بقي ${a.days_to_expiry} يومًا`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ALERT_TONE[a.alert_type]}>{a.alert_label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا تنبيهات — المخزون سليم.
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
          "id, transfer_number, transfer_type, status, priority, note, created_at, requested_by, approved_by, from_warehouse_id, to_warehouse_id, from_warehouse:warehouses!stock_transfers_from_warehouse_id_fkey(name), to_warehouse:warehouses!stock_transfers_to_warehouse_id_fkey(name), stock_transfer_items(id, item_id, qty, unit_cost, item:items(name_ar))",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * أسماء المستخدمين تُقرأ من `v_organization_members_directory` (0026) لا من
 * `auth.users` — العميل لا يملك صلاحية قراءة `auth.users` مباشرة.
 */
function useMemberNames(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["member-names", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_organization_members_directory")
        .select("user_id, display_name")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return new Map(
        ((data ?? []) as { user_id: string; display_name: string }[]).map((row) => [
          row.user_id,
          row.display_name,
        ]),
      );
    },
  });
}

function TransfersTab() {
  const { organization } = useOrganizationAccess();
  const transfers = useStockTransfers(organization?.id);
  const memberNames = useMemberNames(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [createOpen, setCreateOpen] = useState(false);

  const invalidateTransfers = () => {
    queryClient.invalidateQueries({ queryKey: ["stock-transfers", organization?.id] });
    // تبويب «المخزون المتقدم» يقرأ نفس المستندات من v_transfer_pipeline بمفتاح
    // آخر: بلا إبطاله يظهر المستند فيه بحالته القديمة وأزرارها القديمة.
    queryClient.invalidateQueries({ queryKey: ["transfer-pipeline", organization?.id] });
  };

  /**
   * الاعتماد والرفض عبر دالّتَي القاعدة لا بكتابةٍ مباشرة على الجدول.
   *
   * **لماذا كان خطأً**: سياسة RLS على `stock_transfers` هي `app_is_member` لكل
   * العمليات — أي أن الكتابة المباشرة تجعل **أي عضو** في المنشأة معتمِدًا،
   * وتسمح لطالب المناقلة باعتماد طلبه بنفسه، وتُمرِّر رفضًا بلا سبب مكتوب.
   * `app_approve_stock_transfer`/`app_reject_stock_transfer` تفحصان صلاحية
   * `inventory.transfer_approve`، وتمنعان الطالب من اعتماد طلبه، وتُلزمان
   * الرفض بسبب — وكلّها كانت مُتخطّاة. وكان المُتحوّل بلا `onError` أصلًا،
   * فرفض RLS أو القيد يمرّ صامتًا بلا نجاح ولا خطأ.
   */
  const approveTransfer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_approve_stock_transfer", {
        p_transfer_id: id,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateTransfers();
      toast({ title: "اعتُمدت المناقلة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الاعتماد",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const rejectTransfer = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_reject_stock_transfer", {
        p_transfer_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateTransfers();
      toast({ title: "رُفضت المناقلة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الرفض",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  /**
   * تنفيذ المناقلة.
   *
   * **إصلاح خلل حقيقي**: الحركتان كانتا تُدرَجان بلا `lot_id`، ومُحفِّز
   * `app_apply_inventory_movement` (0003) يتجاهل أي حركة بلا دفعة —
   * فالمناقلة كانت تُسجَّل في السجل ولا تنقل قطعة واحدة، بينما تظهر رسالة
   * "تم تحديث المخزون في المستودعين". تحقّقت من ذلك بتنفيذ السيناريو على
   * قاعدة حقيقية قبل الإصلاح.
   *
   * الآن: تُخصَّص دفعات المصدر FIFO، وتُنشأ دفعة مقابلة لكل منها في الوجهة
   * بنفس التكلفة وتاريخ الانتهاء.
   */
  const completeTransfer = useMutation({
    mutationFn: async (transfer: {
      id: string;
      from_warehouse_id: string | null;
      to_warehouse_id: string | null;
      items: { item_id: string; item_name: string; qty: number }[];
    }) => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!transfer.from_warehouse_id || !transfer.to_warehouse_id)
        throw new Error("المناقلة تحتاج مستودعًا مصدرًا ووجهة");
      if (transfer.from_warehouse_id === transfer.to_warehouse_id)
        throw new Error("لا يمكن المناقلة إلى المستودع نفسه");

      /**
       * الرصيد يُفحَص لكل الأصناف **قبل** كتابة أي حركة: العميل لا يملك
       * معاملة ذرية عبر PostgREST، فلو صُرف الصنف الأول ثم تبيّن نقص الثاني
       * لبقيت المناقلة نصف منفَّذة بلا طريقة تراجع.
       */
      const plan: { itemId: string; allocations: LotAllocation[] }[] = [];
      for (const line of transfer.items) {
        const lots = await fetchSourceLots(organization.id, transfer.from_warehouse_id, line.item_id);
        plan.push({ itemId: line.item_id, allocations: allocateFifo(lots, line.qty, line.item_name) });
      }

      for (const entry of plan) {
        await writeOutboundMovements({
          organizationId: organization.id,
          warehouseId: transfer.from_warehouse_id,
          itemId: entry.itemId,
          movementType: "transfer_out",
          allocations: entry.allocations,
          relatedStockTransferId: transfer.id,
        });
        await writeInboundLotsAndMovements({
          organizationId: organization.id,
          warehouseId: transfer.to_warehouse_id,
          itemId: entry.itemId,
          movementType: "transfer_in",
          allocations: entry.allocations,
          relatedStockTransferId: transfer.id,
        });
      }

      const { data: completedTransfer, error: statusError } = await supabase
        .from("stock_transfers")
        // «استُلمت» هي نهاية دورة المناقلة في القاعدة. كانت `completed` وهي
        // قيمة يرفضها القيد، فيفشل الختم بعد أن تحرّك المخزون.
        .update({ status: "received" })
        .eq("id", transfer.id)
        .select("id");
      if (statusError) throw statusError;
      // المخزون تحرّك قبل هذا السطر. لو لم تُختم الحالة «مكتمل» بقي التحويل
      // معروضًا كمعلَّق، فيُنفَّذ ثانيةً وتُخصم الكمية مرتين.
      if (!completedTransfer || completedTransfer.length === 0) {
        throw new Error("نُقلت الكمية لكن تعذّر ختم التحويل كمكتمل — راجعه يدويًا قبل إعادة التنفيذ");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lots"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-on-hand"] });
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
                return { name: lineItem?.name_ar ?? "—", qty: line.qty, unitCost: line.unit_cost };
              });
              // إجمالي القيمة يتخطّى السطور بلا تكلفة بدل معاملتها صفرًا، حتى
              // لا يبدو الإجمالي أقل من الحقيقة وكأن الصنف بلا قيمة.
              const totalQty = items.reduce((sum, line) => sum + Number(line.qty ?? 0), 0);
              const pricedLines = items.filter((line) => line.unitCost != null);
              const totalValue = pricedLines.reduce(
                (sum, line) => sum + Number(line.qty ?? 0) * Number(line.unitCost ?? 0),
                0,
              );
              const hasUnpricedLines = pricedLines.length < items.length;
              return (
                <div key={t.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium">
                      <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-xs text-muted-foreground">
                        #{t.transfer_number ?? "—"}
                      </span>
                      {fromWh?.name ?? "—"} ← {toWh?.name ?? "—"}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.priority === "urgent" || t.priority === "high" ? "warning" : "secondary"}>
                        {PRIORITY_LABELS[t.priority as StockTransferPriority]}
                      </Badge>
                      <Badge
                        variant={
                          t.status === "received"
                            ? "success"
                            : t.status === "rejected" || t.status === "cancelled"
                              ? "destructive"
                              : t.status === "approved" || t.status === "shipped"
                                ? "default"
                                : "secondary"
                        }
                      >
                        {TRANSFER_STATUS_LABELS[t.status as StockTransferStatus]}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{items.map((i) => `${i.name} × ${i.qty}`).join(" · ")}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>عدد الأصناف: <span className="tabular-nums">{items.length}</span></span>
                    <span>إجمالي الكمية: <span className="tabular-nums">{totalQty}</span></span>
                    <span>
                      إجمالي القيمة: <span className="tabular-nums">{totalValue.toFixed(2)}</span>
                      {hasUnpricedLines ? " (بعض السطور بلا تكلفة)" : ""}
                    </span>
                    <span>
                      طلبها: {t.requested_by ? memberNames.data?.get(t.requested_by) ?? "—" : "—"}
                    </span>
                    {t.approved_by && (
                      <span>
                        {t.status === "rejected" ? "رفضها" : "اعتمدها"}:{" "}
                        {memberNames.data?.get(t.approved_by) ?? "—"}
                      </span>
                    )}
                    <span>{new Date(t.created_at).toLocaleString("ar-SA")}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {(t.status === "requested" || t.status === "draft") &&
                      can("inventory.transfer_approve") && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={approveTransfer.isPending}
                            onClick={() => approveTransfer.mutate(t.id)}
                          >
                            اعتماد
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={rejectTransfer.isPending}
                            onClick={() => {
                              // الدالّة ترفض السبب الفارغ، فالسؤال هنا يوفّر على
                              // المستخدم رسالة خطأ من القاعدة بدل نموذج ناقص.
                              const reason = window.prompt("سبب رفض المناقلة؟") ?? "";
                              if (!reason.trim()) return;
                              rejectTransfer.mutate({ id: t.id, reason: reason.trim() });
                            }}
                          >
                            رفض
                          </Button>
                        </>
                      )}
                    {(t.status === "approved" || t.status === "shipped") && (
                      <Button
                        size="sm"
                        disabled={completeTransfer.isPending}
                        onClick={() =>
                          completeTransfer.mutate({
                            id: t.id,
                            from_warehouse_id: t.from_warehouse_id,
                            to_warehouse_id: t.to_warehouse_id,
                            items: (t.stock_transfer_items ?? []).map((line) => {
                              const lineItem = Array.isArray(line.item) ? line.item[0] : line.item;
                              return {
                                item_id: line.item_id,
                                item_name: lineItem?.name_ar ?? "—",
                                qty: Number(line.qty),
                              };
                            }),
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
  const { session } = useOrganizationAccess();
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
          // الطلب يبدأ «مُرسَلًا» لا مسوّدة: هذه الشاشة تُنشئ طلبًا لينظر فيه
          // المعتمِد، والمسوّدة حالة لا تعرضها الواجهة ولا تُصعّدها.
          status: "requested",
          // requested_by كان يُترك فارغًا دائمًا رغم وجود العمود منذ 0003 —
          // فكانت المناقلة بلا صاحب طلب معروف، وهو أهم عمود رقابي فيها.
          requested_by: session?.user.id ?? null,
        })
        .select("id")
        .single();
      if (transferError) throw transferError;

      /**
       * تكلفة الوحدة تُثبَّت لحظة الطلب من متوسط تكلفة المستودع المصدر
       * (`v_inventory_on_hand` — 0038). حسابها لاحقًا وقت العرض كان سيُظهر
       * قيمة مناقلة قديمة بأسعار اليوم، فتتغيّر قيمة مستند مُقفَل بأثر رجعي.
       * تعذُّر الحصول على التكلفة يترك العمود فارغًا لا صفرًا — الصفر يعني
       * "بلا قيمة" وهو ادّعاء مختلف عن "غير معروفة".
       */
      let costByItem = new Map<string, number>();
      if (fromWarehouseId) {
        const { data: onHand } = await supabase
          .from("v_inventory_on_hand")
          .select("item_id, weighted_avg_cost")
          .eq("warehouse_id", fromWarehouseId)
          .in("item_id", lines.map((line) => line.itemId));
        costByItem = new Map(
          ((onHand ?? []) as { item_id: string; weighted_avg_cost: number | null }[])
            .filter((row) => row.weighted_avg_cost != null)
            .map((row) => [row.item_id, Number(row.weighted_avg_cost)]),
        );
      }

      const { error: itemsError } = await supabase.from("stock_transfer_items").insert(
        lines.map((line) => ({
          transfer_id: transfer.id,
          item_id: line.itemId,
          qty: Number(line.qty) || 1,
          unit_cost: costByItem.get(line.itemId) ?? null,
        })),
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

// ---------------------------------------------------------------------------
// موجودات المستودع (لقطة 74) — الرصيد الحالي بقيمته والمتوسط المرجَّح
// ---------------------------------------------------------------------------

type OnHandRow = {
  warehouse_id: string;
  warehouse_name: string;
  item_id: string;
  item_code: string;
  item_name_ar: string;
  sale_price: number;
  lot_count: number;
  qty_on_hand: number;
  stock_value: number;
  weighted_avg_cost: number | null;
  expected_profit: number;
  nearest_expiry: string | null;
};

function useOnHand(organizationId: string | undefined, warehouseId: string, search: string) {
  return useQuery({
    queryKey: ["inventory-on-hand", organizationId, warehouseId, search],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("v_inventory_on_hand")
        .select("*")
        .eq("organization_id", organizationId)
        .order("item_name_ar");
      if (warehouseId !== "all") query = query.eq("warehouse_id", warehouseId);
      if (search.trim()) query = query.ilike("item_name_ar", `%${search.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as OnHandRow[];
    },
  });
}

/**
 * الترميز اللوني لحالة المخزون (لقطة 74).
 * العتبات مبنية على الكمية المتبقية فقط لأن النظام لا يخزّن حدًّا أدنى لكل
 * صنف — عند إضافة حقل reorder_level مستقبلًا يجب أن تُشتقّ منه بدل الثوابت.
 */
function stockTone(qty: number) {
  if (qty <= 0) return { label: "نفد", variant: "destructive" as const };
  if (qty <= 5) return { label: "منخفض", variant: "warning" as const };
  return { label: "متوفر", variant: "success" as const };
}

function OnHandTab() {
  const { organization } = useOrganizationAccess();
  const warehouses = useWarehousesList(organization?.id);
  const [warehouseId, setWarehouseId] = useState("all");
  const [search, setSearch] = useState("");
  const rows = useOnHand(organization?.id, warehouseId, search);

  const list = rows.data ?? [];
  const totals = list.reduce(
    (acc, row) => ({
      value: acc.value + Number(row.stock_value ?? 0),
      profit: acc.profit + Number(row.expected_profit ?? 0),
      qty: acc.qty + Number(row.qty_on_hand ?? 0),
    }),
    { value: 0, profit: 0, qty: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>قيمة المخزون</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{totals.value.toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>الربح المتوقع</CardDescription>
            <CardTitle className="text-2xl tabular-nums text-emerald-700">
              {totals.profit.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>عدد الأصناف</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{list.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>موجودات المستودع</CardTitle>
          <CardDescription>
            الرصيد الحالي محسوب من الدفعات المتبقية، والمتوسط مرجَّح بتكلفة شراء كل دفعة
          </CardDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم الصنف..."
              className="max-w-xs"
            />
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المستودعات</SelectItem>
                {(warehouses.data ?? []).map((warehouse: { id: string; name: string }) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {rows.isLoading && <Skeleton className="h-40 w-full" />}
          {!rows.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>المستودع</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>متوسط الشراء</TableHead>
                  <TableHead>سعر البيع</TableHead>
                  <TableHead>قيمة المخزون</TableHead>
                  <TableHead>الربح المتوقع</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => {
                  const tone = stockTone(Number(row.qty_on_hand));
                  return (
                    <TableRow key={`${row.warehouse_id}-${row.item_id}`}>
                      <TableCell>
                        <p className="font-medium">{row.item_name_ar}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{row.item_code}</p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.warehouse_name}</TableCell>
                      <TableCell className="tabular-nums">{Number(row.qty_on_hand).toFixed(2)}</TableCell>
                      <TableCell className="tabular-nums">
                        {row.weighted_avg_cost != null ? Number(row.weighted_avg_cost).toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">{Number(row.sale_price).toFixed(2)}</TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {Number(row.stock_value).toFixed(2)}
                      </TableCell>
                      <TableCell
                        className={
                          Number(row.expected_profit) >= 0
                            ? "font-medium tabular-nums text-emerald-700"
                            : "font-medium tabular-nums text-destructive"
                        }
                      >
                        {Number(row.expected_profit).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tone.variant}>{tone.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد كميات متبقية في المخزون.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
