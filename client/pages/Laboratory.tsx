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
import ExamCategoryManager, { ExamCategorySelect } from "@/components/shared/ExamCategoryManager";
import ResultAttachments from "@/components/shared/ResultAttachments";
import { useToast } from "@/hooks/use-toast";
import PatientPicker from "@/components/shared/PatientPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import BillingItemLink from "@/components/shared/BillingItemLink";
import { errorMessage } from "@/lib/error-message";

/**
 * دورة حياة طلب المختبر (0083) — تسع حالات وثلاث استثنائية.
 *
 * `completed` القديمة رُحِّلت إلى `resulted`: الاسمان لمعنى واحد، و«مكتمل»
 * يوهم أن الطلب انتهى بينما النتيجة لم تُراجَع بعد.
 */
const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  ordered: "مطلوب",
  specimen_collected: "سُحبت العيّنة",
  received: "استُلمت العيّنة",
  in_progress: "قيد التحليل",
  resulted: "صدرت النتيجة",
  verified: "مراجَعة",
  approved: "معتمدة",
  delivered: "مسلَّمة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
  recollection_required: "تحتاج إعادة سحب",
};
const STATUS_BADGE: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  draft: "secondary",
  ordered: "secondary",
  specimen_collected: "default",
  received: "default",
  in_progress: "default",
  resulted: "warning",
  verified: "warning",
  approved: "success",
  delivered: "success",
  rejected: "destructive",
  cancelled: "destructive",
  recollection_required: "destructive",
};

/** الانتقال التالي المتاح من كل حالة — نفس خريطة `app_lab_status_allowed`. */
const NEXT_STATUS: Record<string, { value: string; label: string; needsReason?: boolean }[]> = {
  draft: [{ value: "ordered", label: "إرسال الطلب" }],
  ordered: [
    { value: "specimen_collected", label: "سحب العيّنة" },
    { value: "rejected", label: "رفض", needsReason: true },
  ],
  specimen_collected: [
    { value: "received", label: "استلام العيّنة" },
    { value: "recollection_required", label: "إعادة سحب", needsReason: true },
  ],
  received: [
    { value: "in_progress", label: "بدء التحليل" },
    { value: "recollection_required", label: "إعادة سحب", needsReason: true },
  ],
  in_progress: [
    { value: "resulted", label: "إصدار النتيجة" },
    { value: "recollection_required", label: "إعادة سحب", needsReason: true },
  ],
  resulted: [
    { value: "verified", label: "مراجعة" },
    { value: "in_progress", label: "إعادة إلى التحليل" },
  ],
  verified: [
    { value: "approved", label: "اعتماد" },
    { value: "resulted", label: "إرجاع للمراجعة" },
  ],
  approved: [{ value: "delivered", label: "تسليم" }],
  recollection_required: [{ value: "specimen_collected", label: "سحب جديد" }],
};
/**
 * حالات الطلب التي تسمح فيها `app_enter_lab_result` بإدخال نتيجة — حرفيًّا كما
 * في الدالّة.
 *
 * الحقول كانت مفتوحة في كل الحالات، والحفظ في `onBlur` وحده: يكتب الفنّي
 * النتيجة على طلبٍ «مطلوب» فتُرفض الدالّة، ويبقى الرقم معروضًا في الحقل كأنه
 * محفوظ فيقرأه من بعده نتيجةً مسجَّلة. ولو أدخل النتائج كلّها قبل استلام
 * العيّنة لم تُحفظ واحدة منها.
 */
const RESULT_ENTRY_STATUSES = ["received", "in_progress", "resulted", "verified"];

type LabTestWithCategory = LabTestRow & {
  category: { name_ar: string } | { name_ar: string }[] | null;
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
        .select("id, code, name_ar, unit, specimen_type, normal_range_text, normal_range_min, normal_range_max, turnaround_hours, is_active, category_id, category:lab_test_categories(name_ar), billing_item_id, billing_item:items!lab_tests_billing_item_id_fkey(id, name_ar, price)")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as unknown as LabTestWithCategory[];
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
          <TabsTrigger value="categories">التصنيفات</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>الطلبات الجارية</CardTitle>
              {/* المنظور كان يُخفي الطلب فور اعتماد نتيجته، ومسار المختبر بعد
                  الاعتماد خطوتان: الاعتماد الإداري ثم التسليم — فكان الطلب
                  يختفي وهو ينتظر التسليم ولا سبيل إلى إتمامه. صار يبقى حتى
                  يُسلَّم (0144). */}
              <CardDescription>تبقى حتى الاعتماد والتسليم، ثم تخرج من القائمة</CardDescription>
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
                    {/* الفشل يُعرض فشلًا لا «لا توجد طلبات»: الطابور الفارغ
                        الكاذب يجعل المختبر يمضي وطلباتٌ في انتظاره. */}
                    {orders.isError && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-destructive">
                          تعذّر تحميل الطلبات: {(orders.error as any)?.message ?? "خطأ غير معروف"}
                        </TableCell>
                      </TableRow>
                    )}
                    {!orders.isError && (orders.data ?? []).length === 0 && (
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
        <TabsContent value="categories" className="mt-4">
          <ExamCategoryManager
            table="lab_test_categories"
            title="تصنيفات فحوصات المختبر"
            description="تنظّم الكتالوج (كيمياء حيوية، أمصال، دم...) — الفحص بلا تصنيف يبقى صالحًا للاستعمال"
          />
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
                <TableHead>التصنيف</TableHead>
                <TableHead>نوع العيّنة</TableHead>
                <TableHead>الوحدة</TableHead>
                <TableHead>المدى الطبيعي</TableHead>
                <TableHead>صنف الفوترة</TableHead>
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
                  <TableCell className="text-sm text-muted-foreground">
                    {(Array.isArray(test.category) ? test.category[0] : test.category)?.name_ar ?? "—"}
                  </TableCell>
                  <TableCell>{test.specimen_type}</TableCell>
                  <TableCell>{test.unit ?? "—"}</TableCell>
                  <TableCell>
                    {test.normal_range_min !== null && test.normal_range_max !== null
                      ? `${test.normal_range_min} - ${test.normal_range_max}`
                      : test.normal_range_text ?? "—"}
                  </TableCell>
                  <TableCell>
                    <BillingItemLink
                      table="lab_tests"
                      rowId={test.id}
                      value={
                        (Array.isArray((test as any).billing_item)
                          ? (test as any).billing_item[0]
                          : (test as any).billing_item) ?? null
                      }
                      invalidateKey={["lab-tests", organizationId]}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={test.is_active ? "success" : "secondary"}>{test.is_active ? "نشط" : "معطّل"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(tests.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
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
  // التصنيف: عمود `category_id` موجود منذ 0013 ولم يكن له أي حقل إدخال
  const [categoryId, setCategoryId] = useState("");
  // صنف الفوترة: عمود `billing_item_id` موجود منذ 0013 ولم يكن يُقرأ ولا يُكتب
  const [billingItem, setBillingItem] = useState<{ id: string; name_ar: string } | null>(null);

  const createTest = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      // صنف الفوترة إلزامي في القاعدة (`billing_item_id not null` منذ 0083/0084)
      // ولا يمكن أن يكون فارغًا: بلا ربطه لا يُفوتَر الفحص من الزيارة. كان
      // النموذج يمرّر `null` فيفشل الحفظ دائمًا برسالة قاعدة غير مفهومة، وهذا
      // يمنع إضافة فحص واحد إلى الكتالوج. الفحص هنا يقول للمستخدم ما ينقص.
      if (!nameAr.trim()) throw new Error("اسم الفحص مطلوب");
      if (!billingItem?.id)
        throw new Error("اربط الفحص بصنف فوترة — بدونه لا يظهر الفحص في فاتورة الزيارة");
      const { error } = await supabase.from("lab_tests").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        category_id: categoryId || null,
        unit: unit.trim() || null,
        normal_range_min: rangeMin ? Number(rangeMin) : null,
        normal_range_max: rangeMax ? Number(rangeMax) : null,
        normal_range_text: rangeText.trim() || null,
        billing_item_id: billingItem.id,
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
      setCategoryId("");
      setBillingItem(null);
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
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
            <Label>التصنيف</Label>
            <ExamCategorySelect table="lab_test_categories" value={categoryId} onChange={setCategoryId} />
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
          <div className="flex flex-col gap-1.5">
            <Label>صنف الفوترة</Label>
            <p className="text-xs text-muted-foreground">
              بلا صنف مربوط لا يمكن فوترة هذا الفحص تلقائيًا من الزيارة — الصنف يحمل السعر
              والمعاملة الضريبية.
            </p>
            {billingItem ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{billingItem.name_ar}</Badge>
                <Button size="sm" variant="ghost" onClick={() => setBillingItem(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <ItemPicker onSelect={(item) => setBillingItem({ id: item.id, name_ar: item.name_ar })} />
            )}
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
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  return useQuery({
    queryKey: ["doctors-active-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .order("name_ar");
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
  const { branch } = useOrganizationAccess();
  const tests = useLabTests(organizationId);
  const doctors = useDoctorsList();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState<string>("");
  const [priority, setPriority] = useState<LabOrderPriority>("routine");
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  /**
   * الكتالوج يعرض الفحص المعطَّل (لتفعيله لاحقًا)، أمّا الطلب فلا.
   *
   * فحصٌ عُطِّل — جهاز خارج الخدمة أو تحليل توقّف — لا يُنفَّذ، وطلبه يصل
   * المختبر فحصًا لا أحد يستطيع إنجازه، فيبقى الطلب معلّقًا إلى الأبد.
   * و`app_create_lab_order` ترفضه أصلًا (`coalesce(is_active, true)`)، فإظهاره
   * هنا وعدٌ لا يُنفَّذ.
   */
  const selectableTests = (tests.data ?? []).filter((test) => test.is_active);

  const createOrder = useMutation({
    /**
     * الإنشاء عبر `app_create_lab_order` لا بإدخالين متتاليين.
     *
     * الإدخالان (`lab_orders` ثم `lab_order_items`) ليسا في معاملة واحدة: لو
     * فشل الثاني بقي طلبٌ بلا فحص واحد — يظهر في الطابور بعدد صفر ولا يمكن
     * إنجازه أبدًا. والدالّة أيضًا تفرض صلاحية `lab.order`، وتتحقّق من انتماء
     * المريض للمنشأة، وتُطلق إخطار القسم (`/laboratory`) الذي كان الطلب
     * المُنشأ من هذه الشاشة لا يُطلقه، فلا يعلم به المختبر.
     */
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر المريض أولًا");
      if (selectedTestIds.length === 0) throw new Error("اختر فحصًا واحدًا على الأقل");
      const { error } = await supabase.rpc("app_create_lab_order", {
        p_organization_id: organizationId,
        p_patient_id: patient.id,
        p_doctor_id: doctorId || null,
        p_test_ids: selectedTestIds,
        p_priority: priority,
        p_notes: notes.trim() || null,
        p_branch_id: branch?.id ?? null,
      });
      if (error) throw error;
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
        description: errorMessage(error),
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
              {selectableTests.map((test) => (
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
              {selectableTests.length === 0 && (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                  {(tests.data ?? []).length === 0
                    ? 'لا توجد فحوصات في الكتالوج بعد — أضفها من تبويب "كتالوج الفحوصات".'
                    : "كل فحوص الكتالوج معطَّلة — فعّل الفحص من تبويب «كتالوج الفحوصات» قبل طلبه."}
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
  const { session } = useOrganizationAccess();
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  const saveResult = useMutation({
    /**
     * الحفظ عبر `app_enter_lab_result` (0083) لا بتحديث مباشر.
     *
     * الدالة تختار المدى المرجعي المناسب **لعمر المريض وجنسه**، وتعلّم
     * النتيجة شاذة أو حرجة، وتحفظ النسخة السابقة في سجلّ التعديلات. التحديث
     * المباشر كان يكتب رقمًا ولا يعرف أشاذٌّ هو أم لا.
     */
    mutationFn: async ({
      itemId,
      value,
      reason,
    }: {
      itemId: string;
      value: string;
      reason?: string;
    }) => {
      const numeric = Number(value);
      const { data, error } = await supabase.rpc("app_enter_lab_result", {
        p_item_id: itemId,
        p_value: value,
        p_numeric: Number.isFinite(numeric) && value.trim() !== "" ? numeric : null,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return data as { is_abnormal: boolean; is_critical: boolean } | null;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["lab-order-details", orderId] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
      if (result?.is_critical) {
        toast({
          variant: "destructive",
          title: "قيمة حرجة",
          description: "النتيجة خارج الحدّ الحرج — أبلغ الطبيب المعالج.",
        });
      }
    },
    onError: (error: unknown, variables) => {
      // إرجاع الحقل إلى قيمته المحفوظة: الرقم الذي رُفض حفظه لو بقي معروضًا
      // قرأه من يمرّ على الشاشة بعده نتيجةً مسجَّلة، وهي ليست في القاعدة.
      setDraftValues((draft) => {
        const next = { ...draft };
        delete next[variables.itemId];
        return next;
      });
      toast({
        variant: "destructive",
        title: "تعذر حفظ النتيجة",
        description: errorMessage(error),
      });
    },
  });

  /**
   * تقدُّم الطلب في دورته.
   *
   * كل انتقال يمرّ بـ`app_set_lab_order_status` (0083): الدالة ترفض القفز
   * بين الحالات، وتفرض لكل انتقال صلاحيته (من يسحب العيّنة ليس من يعتمد
   * النتيجة)، وتُلزم بسبب للرفض وإعادة السحب، وتمنع إصدار نتيجة وبعض
   * الفحوص فارغة، وتسجّل من نفّذ ومتى.
   *
   * قبل هذا كانت الشاشة تكتب `status` مباشرةً، فأي قيمة تمرّ وأي مستخدم.
   */
  const [transition, setTransition] = useState<{ value: string; label: string } | null>(null);
  const [transitionReason, setTransitionReason] = useState("");

  const advanceStatus = useMutation({
    mutationFn: async ({ next, reason }: { next: string; reason?: string }) => {
      if (!orderId) return;
      const { error } = await supabase.rpc("app_set_lab_order_status", {
        p_order_id: orderId,
        p_status: next,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-order-details", orderId] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders"] });
      setTransition(null);
      setTransitionReason("");
      toast({ title: "تم تحديث حالة الطلب" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تحديث الحالة",
        description: errorMessage(error),
      }),
  });

  const orderStatus = (details.data?.order as { status?: string } | undefined)?.status ?? "";
  const canEnterResults = RESULT_ENTRY_STATUSES.includes(orderStatus);

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
        {!details.isLoading && !canEnterResults && (details.data?.items ?? []).length > 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {orderStatus === "ordered" || orderStatus === "specimen_collected"
              ? "إدخال النتائج مغلق — استلم العيّنة أولًا من أزرار الحالة أسفل النافذة."
              : `إدخال النتائج مغلق والطلب في حالة «${STATUS_LABELS[orderStatus] ?? orderStatus}».`}
          </p>
        )}
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
                      disabled={!canEnterResults || saveResult.isPending}
                      onChange={(e) => setDraftValues((d) => ({ ...d, [item.id]: e.target.value }))}
                      onBlur={() => {
                        if (value !== (item.result_value ?? "")) saveResult.mutate({ itemId: item.id, value });
                      }}
                      placeholder={canEnterResults ? "النتيجة..." : "غير متاح الآن"}
                      className="max-w-40"
                    />
                    {item.is_abnormal && <Badge variant="warning">غير طبيعي</Badge>}
                    {/* «قيمة حرجة» قراءةٌ لا كتابة: `app_enter_lab_result` تعيد
                        حسابها من المدى المرجعي لعمر المريض وجنسه عند كل إدخال،
                        فأي علامة يدوية تُمحى صامتةً عند أول تصحيح للرقم — وتضيع
                        تنبيهة الطبيب على قيمةٍ يعرف الفنّي أنها حرجة. عرضُها
                        كما حسبتها القاعدة لا يَعِد بما لا يبقى. */}
                    {item.is_critical && <Badge variant="destructive">قيمة حرجة</Badge>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Separator />
        {/* مرفقات النتيجة: ورقة التحليل الأصلية أو صورة الجهاز (دلو 0045) */}
        {orderId && <ResultAttachments kind="lab" parentId={orderId} />}

        <Separator />
        {/* الانتقالات المتاحة تُشتقّ من الحالة الحالية بنفس خريطة القاعدة،
            فلا يظهر زرٌّ مصيره الرفض. */}
        <DialogFooter className="flex-wrap gap-2">
          {(NEXT_STATUS[(details.data?.order as any)?.status ?? ""] ?? []).map((step) => (
            <Button
              key={step.value}
              variant={step.needsReason ? "outline" : "default"}
              disabled={advanceStatus.isPending}
              onClick={() => {
                if (step.needsReason) {
                  setTransition(step);
                } else {
                  advanceStatus.mutate({ next: step.value });
                }
              }}
            >
              {step.label}
            </Button>
          ))}
          {(NEXT_STATUS[(details.data?.order as any)?.status ?? ""] ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              لا إجراء متاح — الطلب في حالة نهائية.
            </p>
          )}
        </DialogFooter>

        <Dialog open={Boolean(transition)} onOpenChange={(open) => !open && setTransition(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{transition?.label}</DialogTitle>
              <DialogDescription>
                هذا الإجراء يحتاج سببًا مكتوبًا — يُحفظ في سجلّ التدقيق.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label>السبب *</Label>
              <Textarea
                rows={2}
                value={transitionReason}
                onChange={(e) => setTransitionReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTransition(null)}>
                إلغاء
              </Button>
              <Button
                variant="destructive"
                disabled={!transitionReason.trim() || advanceStatus.isPending}
                onClick={() =>
                  transition &&
                  advanceStatus.mutate({ next: transition.value, reason: transitionReason.trim() })
                }
              >
                تأكيد
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
