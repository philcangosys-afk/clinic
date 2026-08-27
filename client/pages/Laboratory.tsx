import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FlaskConical, Plus, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  LabOrderPriority,
  LabOrderRow,
  LabOrderStatus,
  LabPendingOrderView,
  LabTestRow,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
import { useToast } from "@/hooks/use-toast";
import PatientPicker from "@/components/shared/PatientPicker";

const STATUS_LABELS: Record<LabOrderStatus, string> = {
  ordered: "مطلوب",
  specimen_collected: "تم سحب العيّنة",
  in_progress: "قيد التحليل",
  completed: "مكتمل (بانتظار المراجعة)",
  verified: "موثَّق",
  cancelled: "ملغي",
};
const STATUS_BADGE: Record<LabOrderStatus, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  ordered: "secondary",
  specimen_collected: "default",
  in_progress: "default",
  completed: "warning",
  verified: "success",
  cancelled: "destructive",
};
const PRIORITY_LABELS: Record<LabOrderPriority, string> = {
  routine: "عادي",
  urgent: "عاجل",
  stat: "فوري (STAT)",
};

function useLabTests(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["lab-tests", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_tests")
        .select("id, code, name_ar, unit, specimen_type, normal_range_text, normal_range_min, normal_range_max, turnaround_hours, is_active")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as LabTestRow[];
    },
  });
}

function useLabOrders(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["lab-orders", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_lab_pending_orders")
        .select("*")
        .eq("organization_id", organizationId)
        .order("ordered_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LabPendingOrderView[];
    },
  });
}

export default function Laboratory() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const orders = useLabOrders(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المختبر</h1>
          <p className="text-sm text-muted-foreground">طلبات الفحص المخبري، سحب العيّنات، وإدخال النتائج</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          طلب فحص جديد
        </Button>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">الطلبات الحالية</TabsTrigger>
          <TabsTrigger value="catalog">كتالوج الفحوصات</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>الطلبات غير الموثَّقة</CardTitle>
              <CardDescription>تختفي من هذه القائمة تلقائيًا بعد توثيق النتيجة (verified)</CardDescription>
            </CardHeader>
            <CardContent>
              {orders.isLoading && (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              )}
              {!orders.isLoading && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المريض</TableHead>
                      <TableHead>الطبيب الطالب</TableHead>
                      <TableHead>الأولوية</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>عدد الفحوصات</TableHead>
                      <TableHead>نتائج غير طبيعية</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(orders.data ?? []).map((order) => (
                      <TableRow key={order.lab_order_id}>
                        <TableCell className="font-medium">{order.patient_name}</TableCell>
                        <TableCell>{order.doctor_name ?? "—"}</TableCell>
                        <TableCell>
                          {order.priority !== "routine" ? (
                            <Badge variant="warning">{PRIORITY_LABELS[order.priority]}</Badge>
                          ) : (
                            PRIORITY_LABELS[order.priority]
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_BADGE[order.status]}>{STATUS_LABELS[order.status]}</Badge>
                        </TableCell>
                        <TableCell>{order.tests_count}</TableCell>
                        <TableCell>
                          {Number(order.abnormal_count) > 0 ? (
                            <span className="flex items-center gap-1 text-amber-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {order.abnormal_count}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setOpenOrderId(order.lab_order_id)}>
                            فتح
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(orders.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          لا توجد طلبات فحص معلّقة حاليًا.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalog" className="mt-4">
          <LabTestsCatalog organizationId={organization?.id} />
        </TabsContent>
      </Tabs>

      <NewLabOrderDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
      <LabOrderDetailsDialog orderId={openOrderId} onOpenChange={() => setOpenOrderId(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// كتالوج الفحوصات
// ---------------------------------------------------------------------------
function LabTestsCatalog({ organizationId }: { organizationId: string | undefined }) {
  const tests = useLabTests(organizationId);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>كتالوج الفحوصات</CardTitle>
          <CardDescription>المدى الطبيعي العددي يُستخدم لتمييز النتائج غير الطبيعية تلقائيًا عند إدخالها</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          فحص جديد
        </Button>
      </CardHeader>
      <CardContent>
        {tests.isLoading && <Skeleton className="h-40 w-full" />}
        {!tests.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>نوع العيّنة</TableHead>
                <TableHead>الوحدة</TableHead>
                <TableHead>المدى الطبيعي</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tests.data ?? []).map((test) => (
                <TableRow key={test.id}>
                  <TableCell className="flex items-center gap-2 font-medium">
                    <FlaskConical className="h-4 w-4 text-muted-foreground" />
                    {test.name_ar}
                  </TableCell>
                  <TableCell>{test.specimen_type}</TableCell>
                  <TableCell>{test.unit ?? "—"}</TableCell>
                  <TableCell>
                    {test.normal_range_min !== null && test.normal_range_max !== null
                      ? `${test.normal_range_min} - ${test.normal_range_max}`
                      : test.normal_range_text ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={test.is_active ? "success" : "secondary"}>{test.is_active ? "نشط" : "معطّل"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(tests.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد فحوصات مُعرَّفة بعد. أضف أول فحص.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewLabTestDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organizationId} />
    </Card>
  );
}

function NewLabTestDialog({
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
  const [unit, setUnit] = useState("");
  const [rangeMin, setRangeMin] = useState("");
  const [rangeMax, setRangeMax] = useState("");
  const [rangeText, setRangeText] = useState("");

  const createTest = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("lab_tests").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        unit: unit.trim() || null,
        normal_range_min: rangeMin ? Number(rangeMin) : null,
        normal_range_max: rangeMax ? Number(rangeMax) : null,
        normal_range_text: rangeText.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-tests", organizationId] });
      toast({ title: "تم حفظ الفحص" });
      setNameAr("");
      setUnit("");
      setRangeMin("");
      setRangeMax("");
      setRangeText("");
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
          <DialogTitle>فحص مخبري جديد</DialogTitle>
          <DialogDescription>حدّد مدى عدديًا لتفعيل تمييز النتائج غير الطبيعية تلقائيًا، أو مدى نصيًا إن لم يكن عدديًا</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>اسم الفحص *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>وحدة القياس</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="mg/dL" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>الحد الأدنى الطبيعي</Label>
              <Input type="number" value={rangeMin} onChange={(e) => setRangeMin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحد الأقصى الطبيعي</Label>
              <Input type="number" value={rangeMax} onChange={(e) => setRangeMax(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>أو مدى وصفي (إن لم يكن عدديًا)</Label>
            <Input value={rangeText} onChange={(e) => setRangeText(e.target.value)} placeholder="مثال: سلبي" />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!nameAr.trim() || createTest.isPending} onClick={() => createTest.mutate()}>
            {createTest.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// طلب فحص جديد
// ---------------------------------------------------------------------------
function useDoctorsList() {
  return useQuery({
    queryKey: ["doctors-active-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("doctors").select("id, name_ar").eq("is_enabled", true).order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function NewLabOrderDialog({
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
  const tests = useLabTests(organizationId);
  const doctors = useDoctorsList();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState<string>("");
  const [priority, setPriority] = useState<LabOrderPriority>("routine");
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر المريض أولًا");
      if (selectedTestIds.length === 0) throw new Error("اختر فحصًا واحدًا على الأقل");
      const { data: order, error: orderError } = await supabase
        .from("lab_orders")
        .insert({
          organization_id: organizationId,
          patient_id: patient.id,
          ordering_doctor_id: doctorId || null,
          priority,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (orderError) throw orderError;

      const { error: itemsError } = await supabase
        .from("lab_order_items")
        .insert(selectedTestIds.map((testId) => ({ lab_order_id: order.id, lab_test_id: testId })));
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", organizationId] });
      toast({ title: "تم إنشاء طلب الفحص" });
      setPatient(null);
      setDoctorId("");
      setPriority("routine");
      setSelectedTestIds([]);
      setNotes("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء الطلب",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>طلب فحص مخبري جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض *</Label>
            {patient ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="font-medium">{patient.name_ar}</span>
                <Button size="sm" variant="ghost" onClick={() => setPatient(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <PatientPicker onSelect={(p) => setPatient({ id: p.id, name_ar: p.name_ar })} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب الطالب</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختياري" />
                </SelectTrigger>
                <SelectContent>
                  {(doctors.data ?? []).map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الأولوية</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as LabOrderPriority)}>
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

          <div className="flex flex-col gap-1.5">
            <Label>الفحوصات المطلوبة *</Label>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {(tests.data ?? []).map((test) => (
                <label key={test.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selectedTestIds.includes(test.id)}
                    onChange={(e) =>
                      setSelectedTestIds((ids) =>
                        e.target.checked ? [...ids, test.id] : ids.filter((id) => id !== test.id),
                      )
                    }
                  />
                  {test.name_ar}
                </label>
              ))}
              {(tests.data ?? []).length === 0 && (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                  لا توجد فحوصات في الكتالوج بعد — أضفها من تبويب "كتالوج الفحوصات".
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظات (اختياري)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!patient || selectedTestIds.length === 0 || createOrder.isPending}
            onClick={() => createOrder.mutate()}
          >
            {createOrder.isPending ? "جارٍ الإنشاء..." : "إنشاء الطلب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// تفاصيل الطلب — إدخال النتائج وتوثيقها
// ---------------------------------------------------------------------------
function useLabOrderDetails(orderId: string | null) {
  return useQuery({
    queryKey: ["lab-order-details", orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const { data: order, error: orderError } = await supabase
        .from("lab_orders")
        .select("*, patient:patients(id, name_ar)")
        .eq("id", orderId)
        .single();
      if (orderError) throw orderError;

      const { data: items, error: itemsError } = await supabase
        .from("lab_order_items")
        .select("*, lab_test:lab_tests(id, name_ar, unit, normal_range_text, normal_range_min, normal_range_max)")
        .eq("lab_order_id", orderId);
      if (itemsError) throw itemsError;

      return { order, items: items ?? [] };
    },
  });
}

function LabOrderDetailsDialog({ orderId, onOpenChange }: { orderId: string | null; onOpenChange: () => void }) {
  const details = useLabOrderDetails(orderId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  const saveResult = useMutation({
    mutationFn: async ({ itemId, value }: { itemId: string; value: string }) => {
      const numeric = Number(value);
      const { error } = await supabase
        .from("lab_order_items")
        .update({
          result_value: value,
          result_numeric: Number.isFinite(numeric) && value.trim() !== "" ? numeric : null,
        })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-order-details", orderId] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ النتيجة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const verifyOrder = useMutation({
    mutationFn: async () => {
      if (!orderId) return;
      const { error } = await supabase
        .from("lab_orders")
        .update({ status: "verified", verified_at: new Date().toISOString() })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
      toast({ title: "تم توثيق نتائج الطلب" });
      onOpenChange();
    },
  });

  const toggleCritical = useMutation({
    mutationFn: async ({ itemId, critical }: { itemId: string; critical: boolean }) => {
      const { error } = await supabase.from("lab_order_items").update({ is_critical: critical }).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lab-order-details", orderId] }),
  });

  return (
    <Dialog open={Boolean(orderId)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            طلب فحص — {(details.data?.order as { patient?: { name_ar?: string } } | undefined)?.patient?.name_ar ?? ""}
          </DialogTitle>
          <DialogDescription>
            إدخال نتيجة عددية لفحص له مدى طبيعي محدَّد يُفعِّل تمييز "غير طبيعي" تلقائيًا — لا حاجة لتحديده يدويًا
          </DialogDescription>
        </DialogHeader>

        {details.isLoading && <Skeleton className="h-48 w-full" />}
        {!details.isLoading && (
          <div className="flex flex-col gap-3">
            {(details.data?.items ?? []).map((item) => {
              const test = (item as { lab_test?: { name_ar: string; unit: string | null; normal_range_text: string | null; normal_range_min: number | null; normal_range_max: number | null } }).lab_test;
              const value = draftValues[item.id] ?? item.result_value ?? "";
              return (
                <div key={item.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{test?.name_ar}</span>
                    <span className="text-xs text-muted-foreground">
                      المدى الطبيعي:{" "}
                      {test?.normal_range_min != null && test?.normal_range_max != null
                        ? `${test.normal_range_min} - ${test.normal_range_max} ${test.unit ?? ""}`
                        : test?.normal_range_text ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={value}
                      onChange={(e) => setDraftValues((d) => ({ ...d, [item.id]: e.target.value }))}
                      onBlur={() => {
                        if (value !== (item.result_value ?? "")) saveResult.mutate({ itemId: item.id, value });
                      }}
                      placeholder="النتيجة..."
                      className="max-w-40"
                    />
                    {item.is_abnormal && <Badge variant="warning">غير طبيعي</Badge>}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={item.is_critical}
                        onChange={(e) => toggleCritical.mutate({ itemId: item.id, critical: e.target.checked })}
                      />
                      قيمة حرجة
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Separator />
        <DialogFooter>
          <Button
            disabled={verifyOrder.isPending || (details.data?.order as LabOrderRow | undefined)?.status === "verified"}
            onClick={() => verifyOrder.mutate()}
          >
            {verifyOrder.isPending ? "جارٍ التوثيق..." : "توثيق النتائج (Verify)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
