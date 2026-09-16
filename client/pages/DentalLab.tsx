import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, Plus, Smile, Wallet, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { formatAmount, formatCount, formatDate, formatDateTime, useLocaleSettings } from "@/lib/locale";
import type {
  DentalLabBalanceRow,
  DentalLabItemRow,
  DentalLabOrderStatus,
  DistributorRow,
  ToothShadeGuideRow,
  ToothShadeRow,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";
import { useSessionDoctor } from "@/lib/session-doctor";
import {
  LabBoardTab,
  LabByDoctorTab,
  LabPerformanceTab,
} from "@/components/dental/DentalLabPanels";
import { errorMessage } from "@/lib/error-message";

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

/**
 * الانتقالات المشروعة لحالة الطلبية.
 *
 * كانت القائمة تعرض الحالات الأربع دائمًا، فطلبية «تم التسليم» تُعاد إلى «قيد
 * الانتظار» بضغطة واحدة — وتاريخ الاستلام يبقى مكتوبًا فيها من التسليم
 * السابق، فيصير في السجل تاريخُ استلامٍ لطلبية لم تُستلَم. والإلغاء كان متاحًا
 * لطلبية سُدّد عليها سندات صرف، فتبقى المبالغ مصروفةً على مستند ملغى.
 *
 * «ملغاة» نهاية لا رجوع منها من هذه الشاشة: الرجوع عنها قرار مالي يحتاج
 * معالجة السندات أوّلًا.
 */
/**
 * أفعال الطلبية — **أفعالٌ لا حالات**.
 *
 * القائمة القديمة كانت تعرض الحالات الأربع، فيُنقل «تم التسليم» إلى «قيد
 * الانتظار» بضغطة، ويُكتب `status` وحده بلا طابعه الزمنيّ. وهذه تعرض ما
 * يصحّ فعله من الحالة الحالية، وكلٌّ منها يستدعي `app_dental_lab_transition`
 * (0166) فتكتب القاعدة الحالة والطابع والحدث معًا.
 *
 * و«الإعادة» ليست حالة: التركيبة التي عادت من التجربة ما زالت عند المعمل.
 * تُسجَّل حدثًا بسببه، ومنه تُحسب نسبة إعادة كل معمل.
 */
type LabAction = "send" | "try_in" | "rework" | "receive" | "deliver" | "reopen" | "cancel";

const LAB_ACTIONS: Record<
  LabAction,
  { label: string; done: string; from: DentalLabOrderStatus[]; needsReason?: boolean }
> = {
  send:    { label: "إرسال للمعمل", done: "سُجِّل إرسال الطلبية", from: ["pending"] },
  try_in:  { label: "تجربة",        done: "سُجِّلت التجربة",      from: ["in_progress"] },
  rework:  { label: "إعادة",        done: "سُجِّلت الإعادة",      from: ["in_progress"], needsReason: true },
  receive: { label: "استلام",       done: "سُجِّل الاستلام",      from: ["in_progress"] },
  deliver: { label: "تسليم للمريض", done: "سُلِّمت الطلبية",      from: ["pending", "in_progress"] },
  reopen:  { label: "إعادة فتح",    done: "أُعيد فتح الطلبية",   from: ["delivered"], needsReason: true },
  cancel:  { label: "إلغاء",        done: "أُلغيت الطلبية",      from: ["pending", "in_progress"], needsReason: true },
};

/** الترتيب المعروض — مسار العمل من اليمين إلى اليسار كما يجري فعلًا. */
const LAB_ACTION_ORDER: LabAction[] = [
  "send",
  "try_in",
  "rework",
  "receive",
  "deliver",
  "reopen",
  "cancel",
];

const LAB_STATUS_BADGE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  in_progress: "bg-sky-100 text-sky-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

/**
 * قوائم اختيار المعمل — النشط غير المؤرشف فقط.
 *
 * كان المرشِّح على `is_disabled` وحده، و«المؤرشف» في هذا النظام يعني أُخرِج من
 * التعامل نهائيًّا لا أُخفي مؤقّتًا: فكان معملٌ مؤرشف يظهر خيارًا عاديًّا في
 * «طلبية جديدة» و«أصناف المعامل» فتُصدَر إليه تركيبة ويُفتح له حساب من جديد.
 */
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
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as Pick<DistributorRow, "id" | "name_ar">[];
    },
  });
}

/**
 * سندات الصرف **الملغاة** المرتبطة بطلبيات المعامل.
 *
 * **لماذا يلزم هذا الاستعلام**: `app_recalc_dental_lab_order_paid` في القاعدة
 * تجمع `sum(amount)` من `financial_vouchers` لكل سندات المصروف المرتبطة
 * بالطلبية **بلا استثناء `is_void = true`**. فسندٌ أُلغي عبر
 * `app_void_financial_voucher` يظلّ محسوبًا في `paid_amount` المخزَّن (وفي
 * `remaining_amount` المولَّد منه، وفي عرض `dental_lab_balances` الذي يجمعه) —
 * أي أن الشاشة تقول إن المنشأة سدّدت للمعمل مبلغًا أُلغيت دفعته، فيبدو المتبقّي
 * أقلّ من الحقيقة.
 *
 * إصلاح الجذر هجرةٌ في القاعدة (مذكورة في التقرير). وحتى ذلك، تخصم الشاشة
 * الملغى من المخزَّن فلا تعرض رقمًا تعرف أنه خطأ.
 */
function useVoidedLabVouchers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["dental-lab-voided-vouchers", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_vouchers")
        .select("id, amount, dental_lab_order_id, dental_lab_order:dental_lab_orders(distributor_id)")
        .eq("organization_id", organizationId)
        .eq("voucher_type", "expense")
        .eq("is_void", true)
        .not("dental_lab_order_id", "is", null);
      if (error) throw error;
      const byOrder = new Map<string, number>();
      const byLab = new Map<string, number>();
      for (const row of (data ?? []) as any[]) {
        const amount = Number(row.amount ?? 0);
        if (row.dental_lab_order_id)
          byOrder.set(row.dental_lab_order_id, (byOrder.get(row.dental_lab_order_id) ?? 0) + amount);
        const order = Array.isArray(row.dental_lab_order) ? row.dental_lab_order[0] : row.dental_lab_order;
        if (order?.distributor_id)
          byLab.set(order.distributor_id, (byLab.get(order.distributor_id) ?? 0) + amount);
      }
      return { byOrder, byLab };
    },
  });
}

export default function DentalLab() {
  const { organization } = useOrganizationAccess();
  const { doctorId: scopeDoctorId, isDoctorScope } = useSessionDoctor();
  const labs = useDentalLabs(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Smile className="h-6 w-6 text-primary" />
          معمل الأسنان
        </h1>
        <p className="text-sm text-muted-foreground">
          طلبيات التركيبات ومتابعتها، وأداء المعامل، وكتالوج الأصناف، والأرصدة
        </p>
      </div>

      {!labs.isLoading && (labs.data ?? []).length === 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-800">
            لا يوجد معمل أسنان مسجَّل بعد — أضف مورّدًا جديدًا من شاشة "المشتريات والموردون" وفعّل خانة "معمل أسنان" فيه
            أولًا.
          </CardContent>
        </Card>
      )}

      {/* اللوحة أوّلًا لا الطلبيات: من يفتح القسم يسأل «ما الذي يحتاج
          تصرّفًا اليوم؟» قبل أن يسأل «ما الطلبيات؟». */}
      <Tabs defaultValue="board">
        <TabsList className="flex-wrap">
          <TabsTrigger value="board">اللوحة</TabsTrigger>
          <TabsTrigger value="orders">الطلبيات</TabsTrigger>
          <TabsTrigger value="by-doctor">حسب الطبيب</TabsTrigger>
          <TabsTrigger value="labs">أداء المعامل</TabsTrigger>
          <TabsTrigger value="items">أصناف المعامل</TabsTrigger>
          <TabsTrigger value="balances">الأرصدة</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="mt-4">
          {/* الطبيب الداخل بصفته يرى طلبياته هو. وغيرُه يرى الكلّ. */}
          <LabBoardTab
            organizationId={organization?.id}
            doctorId={isDoctorScope ? scopeDoctorId : null}
          />
        </TabsContent>
        <TabsContent value="by-doctor" className="mt-4">
          <LabByDoctorTab organizationId={organization?.id} />
        </TabsContent>
        <TabsContent value="labs" className="mt-4">
          <LabPerformanceTab organizationId={organization?.id} />
        </TabsContent>
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
/** بند طلبية معمل الأسنان كما يُقرأ في القائمة. */
type DentalLabOrderItemRow = {
  id: string;
  description: string | null;
  tooth_numbers: string[] | null;
  price: number | null;
  qty: number | null;
  net_amount: number | null;
};

function useDentalLabOrders(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["dental-lab-orders", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // البنود مضمَّنة في الاستعلام نفسه: `dental_lab_order_items` كان يُكتب
      // إليه ولا يقرؤه أحد منذ 0007، فطلبيةٌ بثلاث تركيبات تُعرض بإجماليها
      // وحده ولا سبيل إلى معرفة ما طُلب من المعمل.
      const { data, error } = await supabase
        .from("dental_lab_orders")
        .select(
          "id, order_number, order_date, delivery_date, total_amount, paid_amount, remaining_amount, status, note, distributor:distributors(name_ar), patient:patients(name_ar, file_number), doctor:doctors(name_ar), dental_lab_order_items(id, description, tooth_numbers, price, qty, net_amount)",
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
  const voided = useVoidedLabVouchers(organizationId);
  const { calendarDisplay } = useLocaleSettings();
  /* الطلبية تُفتح على بنودها بالضغط: صفٌّ إضافيّ دائم لكل طلبية يُغرق الجدول،
     وإخفاء البنود بالكلّية هو العيب الذي نُصلحه. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [expenseFor, setExpenseFor] = useState<{ id: string; remaining: number } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  /** الطلبية التي يُطلب لها سببٌ قبل تنفيذ إجرائها. */
  const [reasonFor, setReasonFor] = useState<{ id: string; action: LabAction } | null>(null);

  const transition = useMutation({
    mutationFn: async ({ id, action, note }: { id: string; action: LabAction; note?: string }) => {
      const { error } = await supabase.rpc("app_dental_lab_transition", {
        p_order_id: id,
        p_action: action,
        p_note: note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["dental-lab-orders", organizationId] });
      // الأرصدة تُجمَّع من الطلبيات، واللوحات تقرأ منظور 0166
      queryClient.invalidateQueries({ queryKey: ["dental-lab-balances", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["dental-lab-board"] });
      queryClient.invalidateQueries({ queryKey: ["dental-lab-by-doctor"] });
      queryClient.invalidateQueries({ queryKey: ["dental-lab-by-lab"] });
      setReasonFor(null);
      toast({ title: LAB_ACTIONS[variables.action].done });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر تنفيذ الإجراء",
        description: errorMessage(error),
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
              {(orders.data ?? []).map((order: any) => {
                // المخزَّن يشمل السندات الملغاة (انظر useVoidedLabVouchers)
                const voidedAmount = voided.data?.byOrder.get(order.id) ?? 0;
                const paid = Number(order.paid_amount ?? 0) - voidedAmount;
                const remaining = Number(order.total_amount ?? 0) - paid;
                const items = (order.dental_lab_order_items ?? []) as DentalLabOrderItemRow[];
                const isOpen = Boolean(expanded[order.id]);
                return (
                // الشظيّة تحمل المفتاح لأنّها الجذر المُعاد من map — و`<>`
                // لا تقبل key، فتُكتب صريحةً
                <Fragment key={order.id}>
                <TableRow>
                  <TableCell className="font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [order.id]: !prev[order.id] }))}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      title={items.length > 0 ? "عرض بنود الطلبية" : "لا بنود مسجَّلة لهذه الطلبية"}
                      disabled={items.length === 0}
                    >
                      {items.length > 0 &&
                        (isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                        ))}
                      #{order.order_number}
                      {items.length > 0 && (
                        <span className="rounded bg-muted px-1 text-[10px]">{formatCount(items.length)}</span>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="font-medium">{order.distributor?.name_ar ?? "—"}</TableCell>
                  <TableCell>
                    {order.patient?.name_ar ? `${order.patient.name_ar} (#${order.patient.file_number})` : "—"}
                  </TableCell>
                  <TableCell>{order.doctor?.name_ar ? `د. ${order.doctor.name_ar}` : "—"}</TableCell>
                  <TableCell>{formatDate(order.order_date, calendarDisplay)}</TableCell>
                  <TableCell>{formatAmount(order.total_amount)}</TableCell>
                  <TableCell className="text-emerald-700">
                    {formatAmount(paid)}
                    {voidedAmount > 0 && (
                      <span className="block text-[10px] text-muted-foreground">
                        بعد استثناء {formatAmount(voidedAmount)} من سندات ملغاة
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={remaining > 0 ? "text-rose-600" : ""}>
                    {formatAmount(remaining)}
                  </TableCell>
                  <TableCell>
                    {/* **أفعالٌ لا حالات.** القائمة القديمة كانت تعرض الحالات
                        الأربع فيُختار منها أيّها كان؛ وهذه تعرض ما يصحّ فعله
                        من هنا، والقاعدة تفرض الباقي وتكتب طابعه الزمنيّ. */}
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge className={LAB_STATUS_BADGE[order.status] ?? ""}>
                        {STATUS_LABELS_AR[order.status as DentalLabOrderStatus] ?? order.status}
                      </Badge>
                      {LAB_ACTION_ORDER.filter((action) =>
                        LAB_ACTIONS[action].from.includes(order.status as DentalLabOrderStatus),
                      ).map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === "cancel" ? "ghost" : "outline"}
                          className={`h-7 px-2 text-[11px] ${action === "cancel" ? "text-destructive" : ""}`}
                          disabled={transition.isPending}
                          onClick={() =>
                            LAB_ACTIONS[action].needsReason
                              ? setReasonFor({ id: order.id, action })
                              : transition.mutate({ id: order.id, action })
                          }
                        >
                          {LAB_ACTIONS[action].label}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {remaining > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpenseFor({ id: order.id, remaining })}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        تسجيل مصروف
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {isOpen && <OrderTimelineRow orderId={order.id} />}
                {isOpen && items.length > 0 && (
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={10} className="py-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold">بنود الطلبية</span>
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-s-2 ps-2 text-xs"
                          >
                            <span className="font-medium">{item.description ?? "بند"}</span>
                            {(item.tooth_numbers ?? []).length > 0 && (
                              <span className="text-muted-foreground">
                                الأسنان: {(item.tooth_numbers ?? []).join("، ")}
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              {formatCount(item.qty)} × {formatAmount(item.price)}
                            </span>
                            <span className="font-mono">{formatAmount(item.net_amount)}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
                );
              })}
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
      {/* السبب يُطلب **قبل** الاستدعاء: القاعدة ترفض بدونه، وطلبُه بعد الرفض
          يجعل الموظّف يرى رسالة خطأ على فعلٍ قصده. */}
      <LabReasonDialog
        target={reasonFor}
        pending={transition.isPending}
        onClose={() => setReasonFor(null)}
        onConfirm={(note) => {
          if (!reasonFor) return;
          transition.mutate({ id: reasonFor.id, action: reasonFor.action, note });
        }}
      />

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
  /**
   * نوع الحالة والمادّة والأولوية — أعمدة 0166.
   *
   * كانت تُكتب نصًّا حرًّا في وصف البند: «تاج زركونيا 11» في طلبية و«زركون
   * تاج» في أخرى. فلا يُفرز، ولا يُقارن سعرُ مادّةٍ بين معملين، ولا يُعرف
   * متوسّط زمن إنجاز الجسور. وهي في القاعدة لوائح تُدار من شاشة اللوائح.
   */
  const [caseTypeId, setCaseTypeId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [priority, setPriority] = useState("normal");
  /**
   * الطلبية المُعادة: تُربط بأصلها بسببٍ إلزاميّ (قيدٌ في القاعدة).
   *
   * بلا الربط تُفتح طلبيةٌ منفصلة فينكسر أثر الحالة الواحدة، ويبدو المعمل
   * أكثر إنتاجًا ممّا هو — طلبيتان حيث العمل واحد أُعيد.
   */
  const [reworkOfId, setReworkOfId] = useState("");
  const [reworkReason, setReworkReason] = useState("");
  const [note, setNote] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [toothNumbers, setToothNumbers] = useState("");
  const [price, setPrice] = useState("0");
  const [qty, setQty] = useState("1");
  /**
   * بنود الطلبية.
   *
   * كانت الطلبية محصورة ببند واحد: `insert` مفرد داخل `if (itemDescription)`
   * بلا مصفوفة. فطلبية بثلاث تركيبات لأسنان مختلفة كانت تحتاج ثلاث طلبيات
   * منفصلة إلى نفس المعمل في نفس اليوم — فينكسر إجمالي الطلبية، ويستقبل
   * المعمل ثلاثة أوامر لحالة واحدة، ويتعذّر تتبّع التسليم كوحدة.
   *
   * `dental_lab_order_items` صُمِّم للتعدد منذ البداية (مفتاح `order_id`)،
   * فالنقص كان في الواجهة وحدها.
   */
  const [lines, setLines] = useState<
    { key: string; description: string; teeth: string; price: number; qty: number }[]
  >([]);

  const doctors = useQuery({
    queryKey: ["doctors-select", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const shadeGuides = useQuery({
    queryKey: ["tooth-shade-guides", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // بلا هذا المرشّح يرى المستخدم العضو في أكثر من منشأة أدلّة ألوان
      // المنشآت الأخرى مختلطة بأدلّته — سياسة app_is_member تسمح بكلها.
      const { data, error } = await supabase
        .from("tooth_shade_guides")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
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
    setCaseTypeId("");
    setMaterialId("");
    setPriority("normal");
    setReworkOfId("");
    setReworkReason("");
    setNote("");
    setItemDescription("");
    setToothNumbers("");
    setPrice("0");
    setQty("1");
    setLines([]);
  };

  const addLine = () => {
    const description = itemDescription.trim();
    if (!description) return;
    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description,
        teeth: toothNumbers.trim(),
        price: Number(price) || 0,
        qty: Number(qty) || 1,
      },
    ]);
    setItemDescription("");
    setToothNumbers("");
    setPrice("0");
    setQty("1");
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));

  const parseTeeth = (raw: string) =>
    raw
      .split(/[,\s]+/)
      .map((tooth) => tooth.trim())
      .filter(Boolean);

  /**
   * البند المكتوب في الحقول ولم يُضَف بعد يُحتسب ضمن الطلبية.
   *
   * بدون هذا، الموظف الذي يكتب تركيبة واحدة ويضغط "حفظ الطلبية" مباشرةً
   * (وهو المسار الأكثر شيوعًا) كان سيحفظ طلبية بلا بنود إطلاقًا.
   */
  const pendingLine = itemDescription.trim()
    ? [
        {
          key: "pending",
          description: itemDescription.trim(),
          teeth: toothNumbers.trim(),
          price: Number(price) || 0,
          qty: Number(qty) || 1,
        },
      ]
    : [];
  /**
   * ما يصلح أن تكون هذه إعادةً له.
   *
   * المُسلَّم وحده: طلبيةٌ ما زالت عند المعمل تُعاد بإجراء «إعادة» عليها لا
   * بفتح طلبيةٍ جديدة. وتسعون يومًا حدٌّ عمليّ — تركيبةٌ سُلِّمت قبل سنة
   * عودتها حالةٌ جديدة لا إعادة.
   */
  const reworkCandidates = useQuery({
    queryKey: ["dental-lab-rework-candidates", organizationId],
    enabled: Boolean(organizationId) && open,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const { data, error } = await supabase
        .from("v_dental_lab_orders")
        .select("id, order_number, patient_name, lab_name")
        .eq("organization_id", organizationId)
        .eq("status", "delivered")
        .gte("order_date", since.toISOString().slice(0, 10))
        .order("order_number", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as { id: string; order_number: number; patient_name: string | null; lab_name: string | null }[];
    },
  });

  const allLines = [...lines, ...pendingLine];
  const orderTotal = allLines.reduce((sum, line) => sum + line.price * line.qty, 0);

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!distributorId) throw new Error("اختر المعمل");
      if (allLines.length === 0) throw new Error("أضف تركيبة واحدة على الأقل");
      // القاعدة تفرض هذا بقيدٍ أيضًا؛ وفحصه هنا يجعل الرفض مستحيلًا بدل أن
      // يكون رسالة خطأ بعد الضغط.
      if (reworkOfId && !reworkReason.trim())
        throw new Error("طلبية الإعادة تحتاج سببًا — بلا «لماذا» لا يُقاس أداء المعمل");
      const net = orderTotal;
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
          case_type_value_id: caseTypeId || null,
          material_value_id: materialId || null,
          priority,
          rework_of_order_id: reworkOfId || null,
          rework_reason: reworkOfId ? reworkReason.trim() : null,
          note: note.trim() || null,
          total_amount: net,
        })
        .select("id")
        .single();
      if (error) throw error;

      const { error: itemError } = await supabase.from("dental_lab_order_items").insert(
        allLines.map((line) => ({
          order_id: order.id,
          description: line.description,
          tooth_numbers: parseTeeth(line.teeth),
          shade_id: shadeId || null,
          price: line.price,
          qty: line.qty,
          // صافي البند لا صافي الطلبية: كان يُكتب الإجمالي في كل بند، فبند
          // واحد كان يبدو بقيمة الطلبية كاملة لو أُضيف أكثر من بند.
          net_amount: line.price * line.qty,
        })),
      );
      if (itemError) throw itemError;
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
        description: errorMessage(error),
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
            <Label>نوع الحالة</Label>
            <LookupSelect
              categoryKey="dental_lab_case_types"
              value={caseTypeId}
              onChange={setCaseTypeId}
              placeholder="تاج، جسر، طقم..."
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المادّة</Label>
            <LookupSelect
              categoryKey="dental_lab_materials"
              value={materialId}
              onChange={setMaterialId}
              placeholder="زركونيا، إيماكس..."
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الأولوية</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">عادية</SelectItem>
                <SelectItem value="urgent">عاجلة</SelectItem>
              </SelectContent>
            </Select>
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
          <div className="flex items-end sm:col-span-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!itemDescription.trim()}
              onClick={addLine}
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة تركيبة أخرى للطلبية نفسها
            </Button>
          </div>
          {lines.length > 0 && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>تركيبات الطلبية</Label>
              <div className="flex flex-col gap-1 rounded-md border p-2">
                {lines.map((line) => (
                  <div key={line.key} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{line.description}</span>
                    {line.teeth && (
                      <span className="font-mono text-[10px] text-muted-foreground">{line.teeth}</span>
                    )}
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {line.price} × {line.qty}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => removeLine(line.key)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {allLines.length > 0 && (
            <div className="text-sm font-medium tabular-nums sm:col-span-2">
              إجمالي الطلبية: {formatAmount(orderTotal)}
              <span className="mr-2 text-xs font-normal text-muted-foreground">
                ({allLines.length} تركيبة)
              </span>
            </div>
          )}
          {/* الإعادة تُربط بأصلها: طلبيةٌ منفصلة تكسر أثر الحالة الواحدة،
              وتجعل المعمل يبدو أكثر إنتاجًا ممّا هو. */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>هذه إعادة لطلبية سابقة؟ (اختياري)</Label>
            <Select
              value={reworkOfId || NONE_ORDER}
              onValueChange={(value) => setReworkOfId(value === NONE_ORDER ? "" : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="لا — طلبية جديدة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_ORDER}>لا — طلبية جديدة</SelectItem>
                {(reworkCandidates.data ?? []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    #{row.order_number}
                    {row.patient_name ? ` · ${row.patient_name}` : ""}
                    {row.lab_name ? ` · ${row.lab_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {reworkOfId && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>سبب الإعادة *</Label>
              <Input
                value={reworkReason}
                onChange={(e) => setReworkReason(e.target.value)}
                placeholder="مثال: اللون غير مطابق، أو الإطباق مرتفع"
              />
              <p className="text-[11px] text-muted-foreground">
                السبب إلزاميّ في القاعدة: نسبة الإعادة تقول «كم»، والسبب يقول «لماذا» —
                وبلا الثاني لا يُصلَح معمل.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>ملاحظة</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!distributorId || allLines.length === 0 || createOrder.isPending}
            onClick={() => createOrder.mutate()}
          >
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
        description: errorMessage(error),
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
          <Label>المبلغ {order ? `(المتبقي: ${formatAmount(order.remaining)})` : ""}</Label>
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
    // كانت بلا onError إطلاقًا: رفض RLS أو قيد فريد على (المعمل، الاسم) كان
    // يُلتقط داخل react-query فلا يظهر شيء — لا صنف جديد ولا رسالة، فيعيد
    // المستخدم المحاولة بلا أن يعرف ما المانع.
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذرت الإضافة",
        description: errorMessage(error),
      }),
  });

  const toggleDisabled = useMutation({
    mutationFn: async (item: DentalLabItemRow) => {
      const { data, error } = await supabase
        .from("dental_lab_items")
        .update({ is_disabled: !item.is_disabled })
        .eq("id", item.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يُحفظ التغيير — راجع صلاحيتك");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dental-lab-items", selectedLab] }),
    // كانت بلا onError إطلاقًا: رفض RLS أو قيد في القاعدة كان يمرّ صامتًا تمامًا
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
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
                      <TableCell>{formatAmount(item.price)}</TableCell>
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
  const voided = useVoidedLabVouchers(organizationId);
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

  // العرض `dental_lab_balances` يجمع `paid_amount` من الطلبيات فيَرِث خطأ
  // احتساب السندات الملغاة — فيُخصم هنا كما في جدول الطلبيات.
  const rows = (balances.data ?? []).map((row) => {
    const voidedAmount = voided.data?.byLab.get(row.distributor_id) ?? 0;
    const totalPaid = Number(row.total_paid ?? 0) - voidedAmount;
    return {
      ...row,
      voidedAmount,
      totalPaid,
      balanceDue: Number(row.total_orders ?? 0) - totalPaid,
    };
  });

  const totals = rows.reduce(
    (acc, row) => ({
      total_orders: acc.total_orders + Number(row.total_orders),
      total_paid: acc.total_paid + row.totalPaid,
      balance_due: acc.balance_due + row.balanceDue,
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
              {rows.map((row) => (
                <TableRow key={row.distributor_id}>
                  <TableCell className="font-medium">{row.name_ar}</TableCell>
                  <TableCell>{formatAmount(row.total_orders)}</TableCell>
                  <TableCell className="text-emerald-700">
                    {formatAmount(row.totalPaid)}
                    {row.voidedAmount > 0 && (
                      <span className="block text-[10px] text-muted-foreground">
                        بعد استثناء {formatAmount(row.voidedAmount)} من سندات ملغاة
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={row.balanceDue > 0 ? "text-rose-600" : ""}>
                    {formatAmount(row.balanceDue)}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد بيانات بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {rows.length > 0 && (
              <TableBody>
                <TableRow className="font-semibold">
                  <TableCell>الإجمالي</TableCell>
                  <TableCell>{formatAmount(totals.total_orders)}</TableCell>
                  <TableCell className="text-emerald-700">{formatAmount(totals.total_paid)}</TableCell>
                  <TableCell className={totals.balance_due > 0 ? "text-rose-600" : ""}>
                    {formatAmount(totals.balance_due)}
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

/**
 * سبب الإعادة أو الإلغاء أو إعادة الفتح.
 *
 * الثلاثة تُلزم بسببٍ في القاعدة (0166): الإعادة لأنّ «كم» بلا «لماذا» لا
 * يُصلح معملًا، والإلغاء وإعادة الفتح لأنّهما يمسّان مستندًا ماليًّا.
 */
function LabReasonDialog({
  target,
  pending,
  onClose,
  onConfirm,
}: {
  target: { id: string; action: LabAction } | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [target?.id, target?.action]);

  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target ? LAB_ACTIONS[target.action].label : ""}</DialogTitle>
          <DialogDescription>
            السبب يُحفظ في سجلّ أحداث الطلبية، ومنه تُحسب نسبة إعادة كل معمل.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>السبب *</Label>
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button disabled={!note.trim() || pending} onClick={() => onConfirm(note.trim())}>
            {pending ? "جارٍ التنفيذ..." : "تأكيد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Radix Select يرفض القيمة الفارغة، فيُستعمل رمزٌ صريح لـ«لا». */
const NONE_ORDER = "__none_order__";

const EVENT_LABELS: Record<string, string> = {
  created: "أُنشئت",
  sent: "أُرسلت للمعمل",
  try_in: "تجربة",
  rework: "إعادة",
  received: "استُلمت من المعمل",
  delivered: "سُلِّمت للمريض",
  cancelled: "أُلغيت",
  note: "ملاحظة",
};

const EVENT_TONE: Record<string, string> = {
  rework: "text-amber-700",
  cancelled: "text-rose-600",
  delivered: "text-emerald-700",
};

/**
 * خطّ أحداث الطلبية — «متى» لا «أين هي».
 *
 * الحالة تقول أين وصلت الطلبية اليوم، وهذا يقول متى صارت كذلك ومَن نقلها
 * وبأيّ سبب. والسؤال الذي يُطرح فعلًا عند الخلاف مع المعمل هو الثاني:
 * «متى أرسلناها؟» لا «ما حالتها؟».
 *
 * يُجلب عند فتح الصفّ لا مع القائمة: جلب أحداث مئة طلبية لأجل واحدة قد
 * تُفتح هدرٌ في كل فتح للشاشة.
 */
function OrderTimelineRow({ orderId }: { orderId: string }) {
  const { calendarDisplay } = useLocaleSettings();
  const events = useQuery({
    queryKey: ["dental-lab-events", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_lab_order_events")
        .select("id, event_type, occurred_at, note")
        .eq("order_id", orderId)
        .order("occurred_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        event_type: string;
        occurred_at: string;
        note: string | null;
      }[];
    },
  });

  return (
    <TableRow className="bg-muted/20">
      <TableCell colSpan={10} className="py-2">
        <span className="mb-1 block text-xs font-semibold">مسار الطلبية</span>
        {events.isLoading && <Skeleton className="h-8 w-full" />}
        {events.isError && (
          <span className="text-xs text-destructive">
            تعذّر تحميل المسار: {errorMessage(events.error)} — الترقية{" "}
            <span className="font-mono">0166</span> تُنشئ هذا السجلّ.
          </span>
        )}
        {!events.isLoading && !events.isError && (events.data ?? []).length === 0 && (
          <span className="text-xs text-muted-foreground">
            لا أحداث مسجَّلة — الطلبية أُنشئت قبل ترقية المسار، أو لم يُنفَّذ عليها إجراء بعد.
          </span>
        )}
        <div className="flex flex-col gap-1">
          {(events.data ?? []).map((event) => (
            <div key={event.id} className="flex flex-wrap items-baseline gap-2 text-xs">
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatDateTime(event.occurred_at, calendarDisplay)}
              </span>
              <span className={`font-medium ${EVENT_TONE[event.event_type] ?? ""}`}>
                {EVENT_LABELS[event.event_type] ?? event.event_type}
              </span>
              {event.note && <span className="text-muted-foreground">— {event.note}</span>}
            </div>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}
