import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, ScanLine, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  RadiologyExamRow,
  RadiologyModality,
  RadiologyOrderPriority,
  RadiologyOrderRow,
  RadiologyOrderStatus,
  RadiologyUnreportedOrderView,
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

const STATUS_LABELS: Record<RadiologyOrderStatus, string> = {
  ordered: "مطلوب",
  scheduled: "مُجدوَل",
  in_progress: "قيد التصوير",
  completed: "تم التصوير (بانتظار التقرير)",
  reported: "تقرير موثَّق",
  cancelled: "ملغي",
};
const STATUS_BADGE: Record<RadiologyOrderStatus, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  ordered: "secondary",
  scheduled: "default",
  in_progress: "default",
  completed: "warning",
  reported: "success",
  cancelled: "destructive",
};
const PRIORITY_LABELS: Record<RadiologyOrderPriority, string> = {
  routine: "عادي",
  urgent: "عاجل",
  stat: "فوري (STAT)",
};
const MODALITY_LABELS: Record<RadiologyModality, string> = {
  xray: "أشعة سينية",
  ct: "أشعة مقطعية",
  mri: "رنين مغناطيسي",
  ultrasound: "فوق صوتية",
  mammography: "تصوير الثدي",
  fluoroscopy: "تنظير بالأشعة",
  other: "أخرى",
};

function useRadiologyExams(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["radiology-exams", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("radiology_exams")
        .select("id, code, name_ar, modality, body_part, requires_contrast, preparation_instructions, is_active")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as RadiologyExamRow[];
    },
  });
}

function useRadiologyOrders(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["radiology-orders", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_radiology_unreported_orders")
        .select("*")
        .eq("organization_id", organizationId)
        .order("ordered_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RadiologyUnreportedOrderView[];
    },
  });
}

export default function Radiology() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const orders = useRadiologyOrders(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الأشعة والتصوير الطبي</h1>
          <p className="text-sm text-muted-foreground">طلبات التصوير، تنفيذها، وكتابة التقارير وتوثيقها</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          طلب تصوير جديد
        </Button>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">الطلبات الحالية</TabsTrigger>
          <TabsTrigger value="catalog">كتالوج فحوصات الأشعة</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>الطلبات غير المُقرَّرة</CardTitle>
              <CardDescription>تختفي من هذه القائمة تلقائيًا بعد توثيق التقرير (reported)</CardDescription>
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
                      <TableHead>موجودات عاجلة</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(orders.data ?? []).map((order) => (
                      <TableRow key={order.radiology_order_id}>
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
                        <TableCell>{order.exams_count}</TableCell>
                        <TableCell>
                          {Number(order.urgent_findings_count) > 0 ? (
                            <span className="flex items-center gap-1 text-red-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {order.urgent_findings_count}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setOpenOrderId(order.radiology_order_id)}>
                            فتح
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(orders.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          لا توجد طلبات تصوير معلّقة حاليًا.
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
          <RadiologyExamsCatalog organizationId={organization?.id} />
        </TabsContent>
      </Tabs>

      <NewRadiologyOrderDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
      <RadiologyOrderDetailsDialog orderId={openOrderId} onOpenChange={() => setOpenOrderId(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// كتالوج فحوصات الأشعة
// ---------------------------------------------------------------------------
function RadiologyExamsCatalog({ organizationId }: { organizationId: string | undefined }) {
  const exams = useRadiologyExams(organizationId);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>كتالوج فحوصات الأشعة</CardTitle>
          <CardDescription>تعليمات التحضير (مثل الصيام) تظهر تلقائيًا عند طلب الفحص</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          فحص جديد
        </Button>
      </CardHeader>
      <CardContent>
        {exams.isLoading && <Skeleton className="h-40 w-full" />}
        {!exams.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>نوع الجهاز</TableHead>
                <TableHead>العضو/المنطقة</TableHead>
                <TableHead>يحتاج صبغة تباين</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(exams.data ?? []).map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell className="flex items-center gap-2 font-medium">
                    <ScanLine className="h-4 w-4 text-muted-foreground" />
                    {exam.name_ar}
                  </TableCell>
                  <TableCell>{MODALITY_LABELS[exam.modality]}</TableCell>
                  <TableCell>{exam.body_part ?? "—"}</TableCell>
                  <TableCell>{exam.requires_contrast ? "نعم" : "لا"}</TableCell>
                  <TableCell>
                    <Badge variant={exam.is_active ? "success" : "secondary"}>{exam.is_active ? "نشط" : "معطّل"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(exams.data ?? []).length === 0 && (
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
      <NewRadiologyExamDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organizationId} />
    </Card>
  );
}

function NewRadiologyExamDialog({
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
  const [modality, setModality] = useState<RadiologyModality>("xray");
  const [bodyPart, setBodyPart] = useState("");
  const [requiresContrast, setRequiresContrast] = useState(false);
  const [prep, setPrep] = useState("");

  const createExam = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("radiology_exams").insert({
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        modality,
        body_part: bodyPart.trim() || null,
        requires_contrast: requiresContrast,
        preparation_instructions: prep.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radiology-exams", organizationId] });
      toast({ title: "تم حفظ الفحص" });
      setNameAr("");
      setModality("xray");
      setBodyPart("");
      setRequiresContrast(false);
      setPrep("");
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
          <DialogTitle>فحص أشعة جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>اسم الفحص *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نوع الجهاز</Label>
            <Select value={modality} onValueChange={(v) => setModality(v as RadiologyModality)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODALITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العضو/المنطقة</Label>
            <Input value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} placeholder="مثال: الصدر" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresContrast} onChange={(e) => setRequiresContrast(e.target.checked)} />
            يحتاج صبغة تباين
          </label>
          <div className="flex flex-col gap-1.5">
            <Label>تعليمات التحضير (اختياري)</Label>
            <Textarea value={prep} onChange={(e) => setPrep(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!nameAr.trim() || createExam.isPending} onClick={() => createExam.mutate()}>
            {createExam.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// طلب تصوير جديد
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

function NewRadiologyOrderDialog({
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
  const exams = useRadiologyExams(organizationId);
  const doctors = useDoctorsList();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState<string>("");
  const [priority, setPriority] = useState<RadiologyOrderPriority>("routine");
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([]);
  const [clinicalIndication, setClinicalIndication] = useState("");

  const selectedExams = (exams.data ?? []).filter((exam) => selectedExamIds.includes(exam.id));
  const preparationNotes = selectedExams.map((exam) => exam.preparation_instructions).filter(Boolean) as string[];

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient) throw new Error("اختر المريض أولًا");
      if (selectedExamIds.length === 0) throw new Error("اختر فحصًا واحدًا على الأقل");
      const { data: order, error: orderError } = await supabase
        .from("radiology_orders")
        .insert({
          organization_id: organizationId,
          patient_id: patient.id,
          ordering_doctor_id: doctorId || null,
          priority,
          clinical_indication: clinicalIndication.trim() || null,
        })
        .select("id")
        .single();
      if (orderError) throw orderError;

      const { error: itemsError } = await supabase
        .from("radiology_order_items")
        .insert(selectedExamIds.map((examId) => ({ radiology_order_id: order.id, radiology_exam_id: examId })));
      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radiology-orders", organizationId] });
      toast({ title: "تم إنشاء طلب التصوير" });
      setPatient(null);
      setDoctorId("");
      setPriority("routine");
      setSelectedExamIds([]);
      setClinicalIndication("");
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
          <DialogTitle>طلب تصوير جديد</DialogTitle>
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
              <Select value={priority} onValueChange={(v) => setPriority(v as RadiologyOrderPriority)}>
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
              {(exams.data ?? []).map((exam) => (
                <label key={exam.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selectedExamIds.includes(exam.id)}
                    onChange={(e) =>
                      setSelectedExamIds((ids) =>
                        e.target.checked ? [...ids, exam.id] : ids.filter((id) => id !== exam.id),
                      )
                    }
                  />
                  {exam.name_ar}
                </label>
              ))}
              {(exams.data ?? []).length === 0 && (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                  لا توجد فحوصات في الكتالوج بعد — أضفها من تبويب "كتالوج فحوصات الأشعة".
                </p>
              )}
            </div>
          </div>

          {preparationNotes.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <span className="font-medium">تعليمات تحضير المريض: </span>
              {preparationNotes.join(" · ")}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>السبب السريري للطلب (اختياري)</Label>
            <Textarea value={clinicalIndication} onChange={(e) => setClinicalIndication(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!patient || selectedExamIds.length === 0 || createOrder.isPending}
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
// تفاصيل الطلب — تنفيذ التصوير وكتابة التقرير وتوثيقه
// ---------------------------------------------------------------------------
function useRadiologyOrderDetails(orderId: string | null) {
  return useQuery({
    queryKey: ["radiology-order-details", orderId],
    enabled: Boolean(orderId),
    queryFn: async () => {
      const { data: order, error: orderError } = await supabase
        .from("radiology_orders")
        .select("*, patient:patients(id, name_ar)")
        .eq("id", orderId)
        .single();
      if (orderError) throw orderError;

      const { data: items, error: itemsError } = await supabase
        .from("radiology_order_items")
        .select("*, radiology_exam:radiology_exams(id, name_ar, body_part, modality)")
        .eq("radiology_order_id", orderId);
      if (itemsError) throw itemsError;

      return { order, items: items ?? [] };
    },
  });
}

function RadiologyOrderDetailsDialog({ orderId, onOpenChange }: { orderId: string | null; onOpenChange: () => void }) {
  const details = useRadiologyOrderDetails(orderId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draftFindings, setDraftFindings] = useState<Record<string, { findings: string; impression: string }>>({});

  const markPerformed = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("radiology_order_items")
        .update({ performed_at: new Date().toISOString() })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radiology-order-details", orderId] });
      queryClient.invalidateQueries({ queryKey: ["radiology-orders"] });
    },
  });

  const saveReport = useMutation({
    mutationFn: async ({ itemId, findings, impression }: { itemId: string; findings: string; impression: string }) => {
      const { error } = await supabase.from("radiology_order_items").update({ findings, impression }).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radiology-order-details", orderId] });
      toast({ title: "تم حفظ التقرير" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ التقرير",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const toggleUrgent = useMutation({
    mutationFn: async ({ itemId, urgent }: { itemId: string; urgent: boolean }) => {
      const { error } = await supabase.from("radiology_order_items").update({ is_urgent_finding: urgent }).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["radiology-order-details", orderId] }),
  });

  const markReported = useMutation({
    mutationFn: async () => {
      if (!orderId) return;
      const { error } = await supabase
        .from("radiology_orders")
        .update({ status: "reported", reported_at: new Date().toISOString() })
        .eq("id", orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radiology-orders"] });
      toast({ title: "تم توثيق تقرير الطلب" });
      onOpenChange();
    },
  });

  const orderStatus = (details.data?.order as RadiologyOrderRow | undefined)?.status;
  const allHaveFindings = (details.data?.items ?? []).every(
    (item) => typeof item.findings === "string" && item.findings.trim() !== "",
  );

  return (
    <Dialog open={Boolean(orderId)} onOpenChange={(next) => !next && onOpenChange()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            طلب تصوير — {(details.data?.order as { patient?: { name_ar?: string } } | undefined)?.patient?.name_ar ?? ""}
          </DialogTitle>
          <DialogDescription>أنجز التصوير أولًا، ثم اكتب الموجودات والانطباع، ثم وثّق التقرير النهائي</DialogDescription>
        </DialogHeader>

        {details.isLoading && <Skeleton className="h-48 w-full" />}
        {!details.isLoading && (
          <div className="flex flex-col gap-3">
            {(details.data?.items ?? []).map((item) => {
              const exam = (item as { radiology_exam?: { name_ar: string; body_part: string | null } }).radiology_exam;
              const draft = draftFindings[item.id] ?? { findings: item.findings ?? "", impression: item.impression ?? "" };
              return (
                <div key={item.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {exam?.name_ar} {exam?.body_part ? `— ${exam.body_part}` : ""}
                    </span>
                    {!item.performed_at ? (
                      <Button size="sm" variant="outline" onClick={() => markPerformed.mutate(item.id)}>
                        تأكيد تنفيذ التصوير
                      </Button>
                    ) : (
                      <Badge variant="success">تم التصوير</Badge>
                    )}
                  </div>
                  {item.performed_at && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">الموجودات (Findings)</Label>
                        <Textarea
                          rows={2}
                          value={draft.findings}
                          onChange={(e) =>
                            setDraftFindings((d) => ({ ...d, [item.id]: { ...draft, findings: e.target.value } }))
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">الانطباع التشخيصي (Impression)</Label>
                        <Textarea
                          rows={1}
                          value={draft.impression}
                          onChange={(e) =>
                            setDraftFindings((d) => ({ ...d, [item.id]: { ...draft, impression: e.target.value } }))
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={item.is_urgent_finding}
                            onChange={(e) => toggleUrgent.mutate({ itemId: item.id, urgent: e.target.checked })}
                          />
                          موجودة عاجلة تستدعي تنبيه الطبيب الطالب
                        </label>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saveReport.isPending}
                          onClick={() => saveReport.mutate({ itemId: item.id, findings: draft.findings, impression: draft.impression })}
                        >
                          حفظ التقرير
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Separator />
        <DialogFooter>
          <Button
            disabled={markReported.isPending || orderStatus === "reported" || !allHaveFindings}
            onClick={() => markReported.mutate()}
          >
            {markReported.isPending ? "جارٍ التوثيق..." : "توثيق التقرير النهائي"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
