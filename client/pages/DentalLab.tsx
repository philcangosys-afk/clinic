import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Smile, Wallet } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  DentalLabBalanceRow,
  DentalLabItemRow,
  DentalLabOrderRow,
  DentalLabOrderStatus,
  DistributorRow,
  ToothShadeGuideRow,
  ToothShadeRow,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import PatientPicker from "@/components/shared/PatientPicker";
import { useToast } from "@/hooks/use-toast";

/**
 * معامل الأسنان — موديول كانت قاعدة بياناته جاهزة بالكامل (dental_lab_items/
 * orders/order_items + عرض dental_lab_balances من 0007_dental_lab.sql) بلا أي
 * واجهة إطلاقًا (لقطات 54–61، 106، 123 في تقرير فجوات التنفيذ). هذه الشاشة
 * الأولى له: الطلبيات، كتالوج أصناف كل معمل، والأرصدة.
 */

const STATUS_LABELS_AR: Record<DentalLabOrderStatus, string> = {
  pending: "قيد الانتظار",
  in_progress: "قيد التنفيذ",
  delivered: "تم التسليم",
  cancelled: "ملغاة",
};

function useDentalLabs(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["dental-labs", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_dental_lab", true)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as Pick<DistributorRow, "id" | "name_ar">[];
    },
  });
}

export default function DentalLab() {
  const { organization } = useOrganizationAccess();
  const labs = useDentalLabs(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Smile className="h-6 w-6 text-primary" />
          معامل الأسنان
        </h1>
        <p className="text-sm text-muted-foreground">طلبيات التركيبات، كتالوج أصناف كل معمل، وأرصدة المعامل</p>
      </div>

      {!labs.isLoading && (labs.data ?? []).length === 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-800">
            لا يوجد معمل أسنان مسجَّل بعد — أضف مورّدًا جديدًا من شاشة "المشتريات والموردون" وفعّل خانة "معمل أسنان" فيه
            أولًا.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">الطلبيات</TabsTrigger>
          <TabsTrigger value="items">أصناف المعامل</TabsTrigger>
          <TabsTrigger value="balances">الأرصدة</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="mt-4">
          <OrdersTab organizationId={organization?.id} labs={labs.data ?? []} />
        </TabsContent>
        <TabsContent value="items" className="mt-4">
          <ItemsTab organizationId={organization?.id} labs={labs.data ?? []} />
        </TabsContent>
        <TabsContent value="balances" className="mt-4">
          <BalancesTab organizationId={organization?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الطلبيات
// ---------------------------------------------------------------------------
function useDentalLabOrders(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["dental-lab-orders", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_lab_orders")
        .select(
          "id, order_number, order_date, delivery_date, total_amount, paid_amount, remaining_amount, status, note, distributor:distributors(name_ar), patient:patients(name_ar, file_number), doctor:doctors(name_ar)",
        )
        .eq("organization_id", organizationId)
        .order("order_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function OrdersTab({
  organizationId,
  labs,
}: {
  organizationId: string | undefined;
  labs: Pick<DistributorRow, "id" | "name_ar">[];
}) {
  const orders = useDentalLabOrders(organizationId);
  const [createOpen, setCreateOpen] = useState(false);
  const [expenseFor, setExpenseFor] = useState<{ id: string; remaining: number } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DentalLabOrderStatus }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "delivered") patch.received_date = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from("dental_lab_orders").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dental-lab-orders", organizationId] }),
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تحديث الحالة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>طلبيات معامل الأسنان</CardTitle>
          <CardDescription>المدفوع والمتبقي يُحسبان تلقائيًا من سندات الصرف المرتبطة بكل طلبية</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={labs.length === 0}>
          <Plus className="h-4 w-4" />
          طلبية جديدة
        </Button>
      </CardHeader>
      <CardContent>
        {orders.isLoading && <Skeleton className="h-40 w-full" />}
        {!orders.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#الطلبية</TableHead>
                <TableHead>المعمل</TableHead>
                <TableHead>المريض</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>المدفوع</TableHead>
                <TableHead>المتبقي</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(orders.data ?? []).map((order: any) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">#{order.order_number}</TableCell>
                  <TableCell className="font-medium">{order.distributor?.name_ar ?? "—"}</TableCell>
                  <TableCell>
                    {order.patient?.name_ar ? `${order.patient.name_ar} (#${order.patient.file_number})` : "—"}
                  </TableCell>
                  <TableCell>{order.doctor?.name_ar ? `د. ${order.doctor.name_ar}` : "—"}</TableCell>
                  <TableCell>{new Date(order.order_date).toLocaleDateString("ar-SA")}</TableCell>
                  <TableCell>{Number(order.total_amount).toLocaleString("ar-SA")}</TableCell>
                  <TableCell className="text-emerald-700">{Number(order.paid_amount).toLocaleString("ar-SA")}</TableCell>
                  <TableCell className={Number(order.remaining_amount) > 0 ? "text-rose-600" : ""}>
                    {Number(order.remaining_amount).toLocaleString("ar-SA")}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={order.status}
                      onValueChange={(value) => updateStatus.mutate({ id: order.id, status: value as DentalLabOrderStatus })}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS_AR).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {Number(order.remaining_amount) > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpenseFor({ id: order.id, remaining: Number(order.remaining_amount) })}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        تسجيل مصروف
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(orders.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد طلبيات معامل أسنان بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewDentalLabOrderDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organizationId} labs={labs} />
      <RegisterExpenseDialog
        organizationId={organizationId}
        order={expenseFor}
        onOpenChange={(open) => !open && setExpenseFor(null)}
      />
    </Card>
  );
}

function NewDentalLabOrderDialog({
  open,
  onOpenChange,
  organizationId,
  labs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  labs: Pick<DistributorRow, "id" | "name_ar">[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [distributorId, setDistributorId] = useState("");
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState("");
  const [shadeGuideId, setShadeGuideId] = useState("");
  const [shadeId, setShadeId] = useState("");
  const [note, setNote] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [toothNumbers, setToothNumbers] = useState("");
  const [price, setPrice] = useState("0");
  const [qty, setQty] = useState("1");

  const doctors = useQuery({
    queryKey: ["doctors-select", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("doctors").select("id, name_ar").order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const shadeGuides = useQuery({
    queryKey: ["tooth-shade-guides", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("tooth_shade_guides").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as Pick<ToothShadeGuideRow, "id" | "name">[];
    },
  });

  const shades = useQuery({
    queryKey: ["tooth-shades", shadeGuideId],
    enabled: Boolean(shadeGuideId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tooth_shades")
        .select("id, code")
        .eq("shade_guide_id", shadeGuideId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Pick<ToothShadeRow, "id" | "code">[];
    },
  });

  const resetForm = () => {
    setDistributorId("");
    setPatient(null);
    setDoctorId("");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setDeliveryDate("");
    setShadeGuideId("");
    setShadeId("");
    setNote("");
    setItemDescription("");
    setToothNumbers("");
    setPrice("0");
    setQty("1");
  };

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!distributorId) throw new Error("اختر المعمل");
      const net = (Number(price) || 0) * (Number(qty) || 1);
      const { data: order, error } = await supabase
        .from("dental_lab_orders")
        .insert({
          organization_id: organizationId,
          distributor_id: distributorId,
          order_date: orderDate,
          delivery_date: deliveryDate || null,
          patient_id: patient?.id || null,
          doctor_id: doctorId || null,
          shade_guide_id: shadeGuideId || null,
          shade_id: shadeId || null,
          note: note.trim() || null,
          total_amount: net,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (itemDescription.trim()) {
        const teeth = toothNumbers
          .split(/[,\s]+/)
          .map((t) => t.trim())
          .filter(Boolean);
        const { error: itemError } = await supabase.from("dental_lab_order_items").insert({
          order_id: order.id,
          description: itemDescription.trim(),
          tooth_numbers: teeth,
          shade_id: shadeId || null,
          price: Number(price) || 0,
          qty: Number(qty) || 1,
          net_amount: net,
        });
        if (itemError) throw itemError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dental-lab-orders", organizationId] });
      toast({ title: "تم إنشاء الطلبية" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء الطلبية",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>طلبية معمل أسنان جديدة</DialogTitle>
          <DialogDescription>يمكن إضافة بنود إضافية من ملف الطلبية بعد إنشائها</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>المعمل *</Label>
            <Select value={distributorId} onValueChange={setDistributorId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر معمل" />
              </SelectTrigger>
              <SelectContent>
                {labs.map((lab) => (
                  <SelectItem key={lab.id} value={lab.id}>
                    {lab.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر طبيبًا" />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    د. {d.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>المريض</Label>
            <PatientPicker onSelect={(p) => setPatient({ id: p.id, name_ar: p.name_ar })} />
            {patient && <p className="text-xs text-muted-foreground">المحدَّد: {patient.name_ar}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الطلب</Label>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ التسليم المتوقع</Label>
            <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>دليل الألوان</Label>
            <Select value={shadeGuideId} onValueChange={(v) => { setShadeGuideId(v); setShadeId(""); }}>
              <SelectTrigger>
                <SelectValue placeholder="اختر دليلًا" />
              </SelectTrigger>
              <SelectContent>
                {(shadeGuides.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اللون</Label>
            <Select value={shadeId} onValueChange={setShadeId} disabled={!shadeGuideId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر لونًا" />
              </SelectTrigger>
              <SelectContent>
                {(shades.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>وصف التركيبة (مثال: تقويم زركون ضاحك علوي)</Label>
            <Input value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>أرقام الأسنان (FDI، مفصولة بفواصل)</Label>
            <Input value={toothNumbers} onChange={(e) => setToothNumbers(e.target.value)} placeholder="11, 21" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>السعر × الكمية</Label>
            <div className="flex gap-2">
              <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!distributorId || createOrder.isPending} onClick={() => createOrder.mutate()}>
            {createOrder.isPending ? "جارٍ الحفظ..." : "حفظ الطلبية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegisterExpenseDialog({
  organizationId,
  order,
  onOpenChange,
}: {
  organizationId: string | undefined;
  order: { id: string; remaining: number } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");

  const registerExpense = useMutation({
    mutationFn: async () => {
      if (!organizationId || !order) throw new Error("لا توجد بيانات كافية");
      const { error } = await supabase.from("financial_vouchers").insert({
        organization_id: organizationId,
        voucher_type: "expense",
        amount: Number(amount) || 0,
        dental_lab_order_id: order.id,
        description: "دفعة لمعمل أسنان",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dental-lab-orders", organizationId] });
      toast({ title: "تم تسجيل المصروف" });
      setAmount("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تسجيل المصروف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(order)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل مصروف للطلبية</DialogTitle>
          <DialogDescription>ينشئ سند صرف يُحدِّث المدفوع/المتبقي في الطلبية تلقائيًا</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>المبلغ {order ? `(المتبقي: ${order.remaining.toLocaleString("ar-SA")})` : ""}</Label>
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button disabled={!amount || registerExpense.isPending} onClick={() => registerExpense.mutate()}>
            {registerExpense.isPending ? "جارٍ الحفظ..." : "تسجيل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// أصناف المعامل
// ---------------------------------------------------------------------------
function ItemsTab({
  organizationId,
  labs,
}: {
  organizationId: string | undefined;
  labs: Pick<DistributorRow, "id" | "name_ar">[];
}) {
  const [selectedLab, setSelectedLab] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [price, setPrice] = useState("0");

  const items = useQuery({
    queryKey: ["dental-lab-items", selectedLab],
    enabled: Boolean(selectedLab),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_lab_items")
        .select("*")
        .eq("distributor_id", selectedLab)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as DentalLabItemRow[];
    },
  });

  const addItem = useMutation({
    mutationFn: async () => {
      if (!organizationId || !selectedLab) throw new Error("اختر معملًا أولًا");
      const { error } = await supabase.from("dental_lab_items").insert({
        organization_id: organizationId,
        distributor_id: selectedLab,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        price: Number(price) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dental-lab-items", selectedLab] });
      toast({ title: "تمت الإضافة" });
      setNameAr("");
      setNameEn("");
      setPrice("0");
    },
  });

  const toggleDisabled = useMutation({
    mutationFn: async (item: DentalLabItemRow) => {
      const { error } = await supabase
        .from("dental_lab_items")
        .update({ is_disabled: !item.is_disabled })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dental-lab-items", selectedLab] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>أصناف معامل الأسنان</CardTitle>
        <CardDescription>كتالوج مستقل لكل معمل (تركيبات/خدمات بأسعارها) يُستخدم عند إنشاء الطلبيات</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>المعمل</Label>
          <Select value={selectedLab} onValueChange={setSelectedLab}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="اختر معملًا" />
            </SelectTrigger>
            <SelectContent>
              {labs.map((lab) => (
                <SelectItem key={lab.id} value={lab.id}>
                  {lab.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedLab && (
          <>
            <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1.5">
                <Label>اسم الصنف بالعربية</Label>
                <Input className="w-48" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>بالإنجليزية</Label>
                <Input className="w-48" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>السعر</Label>
                <Input type="number" min={0} className="w-28" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <Button disabled={!nameAr.trim() || addItem.isPending} onClick={() => addItem.mutate()}>
                <Plus className="h-4 w-4" />
                إضافة
              </Button>
            </div>

            {items.isLoading && <Skeleton className="h-24 w-full" />}
            {!items.isLoading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>السعر</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(items.data ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.name_ar}
                        {item.name_en && <span className="text-muted-foreground"> · {item.name_en}</span>}
                      </TableCell>
                      <TableCell>{Number(item.price).toLocaleString("ar-SA")}</TableCell>
                      <TableCell>
                        <Badge variant={item.is_disabled ? "secondary" : "success"}>
                          {item.is_disabled ? "معطّل" : "مفعّل"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => toggleDisabled.mutate(item)}>
                          {item.is_disabled ? "تفعيل" : "تعطيل"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(items.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        لا توجد أصناف لهذا المعمل بعد.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الأرصدة
// ---------------------------------------------------------------------------
function BalancesTab({ organizationId }: { organizationId: string | undefined }) {
  const balances = useQuery({
    queryKey: ["dental-lab-balances", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_lab_balances")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as DentalLabBalanceRow[];
    },
  });

  const totals = (balances.data ?? []).reduce(
    (acc, row) => ({
      total_orders: acc.total_orders + Number(row.total_orders),
      total_paid: acc.total_paid + Number(row.total_paid),
      balance_due: acc.balance_due + Number(row.balance_due),
    }),
    { total_orders: 0, total_paid: 0, balance_due: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>إحصائيات حسابات معامل الأسنان</CardTitle>
        <CardDescription>إجمالي الطلبيات والمدفوع والمتبقي لكل معمل</CardDescription>
      </CardHeader>
      <CardContent>
        {balances.isLoading && <Skeleton className="h-32 w-full" />}
        {!balances.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المعمل</TableHead>
                <TableHead>إجمالي الطلبيات</TableHead>
                <TableHead>المدفوع</TableHead>
                <TableHead>المتبقي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(balances.data ?? []).map((row) => (
                <TableRow key={row.distributor_id}>
                  <TableCell className="font-medium">{row.name_ar}</TableCell>
                  <TableCell>{Number(row.total_orders).toLocaleString("ar-SA")}</TableCell>
                  <TableCell className="text-emerald-700">{Number(row.total_paid).toLocaleString("ar-SA")}</TableCell>
                  <TableCell className={Number(row.balance_due) > 0 ? "text-rose-600" : ""}>
                    {Number(row.balance_due).toLocaleString("ar-SA")}
                  </TableCell>
                </TableRow>
              ))}
              {(balances.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد بيانات بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {(balances.data ?? []).length > 0 && (
              <TableBody>
                <TableRow className="font-semibold">
                  <TableCell>الإجمالي</TableCell>
                  <TableCell>{totals.total_orders.toLocaleString("ar-SA")}</TableCell>
                  <TableCell className="text-emerald-700">{totals.total_paid.toLocaleString("ar-SA")}</TableCell>
                  <TableCell className={totals.balance_due > 0 ? "text-rose-600" : ""}>
                    {totals.balance_due.toLocaleString("ar-SA")}
                  </TableCell>
                </TableRow>
              </TableBody>
            )}
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
