import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BellOff,
  CheckCircle2,
  Flag,
  Printer,
  Undo2,
  UserCheck,
  UserX,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { printHtml } from "@/lib/document-merge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

/**
 * لوحة الاستقبال.
 *
 * تقرأ `v_reception_queue_ordered` (0065) لا الجدول مباشرةً — **الترتيب في
 * القاعدة لا في المتصفح**. الترتيب في العميل كان يجعل كل موظف يرى ترتيبًا قد
 * يختلف عن زميله، ولا يمكن لتقرير أن يُعيد إنتاج «من كان التالي».
 *
 * ومدّة الانتظار تُحسب من **وقت الوصول** وتتوقّف عند النداء: ما بعد النداء
 * انتظار الطبيب لا انتظار الاستقبال، وخلطهما يجعل كل الأرقام بلا معنى.
 */

type QueueRow = {
  appointment_id: string;
  queue_number: number | null;
  status: string;
  priority: string;
  scheduled_start: string;
  arrived_at: string | null;
  checked_in_at: string | null;
  called_at: string | null;
  patient_id: string;
  patient_name: string;
  file_number: number | string | null;
  mobile_number: string | null;
  blood_type: string | null;
  insurance_company_name: string | null;
  insurance_valid: boolean | null;
  doctor_id: string;
  doctor_name: string;
  clinic_id: string | null;
  clinic_name: string | null;
  medical_alert: string | null;
  waiting_minutes: number | null;
  waiting_state: "none" | "ok" | "warning" | "critical";
  invoice_id: string | null;
  invoice_status: string | null;
  remaining_amount: number | null;
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "مؤكد",
  arrived: "وصل",
  checked_in: "مسجَّل",
  called: "نودي",
  in_progress: "في الزيارة",
  walk_in: "حضوري",
  waiting: "بالانتظار",
};

const PRIORITY_LABELS: Record<string, string> = {
  normal: "عادي",
  urgent: "عاجل",
  emergency: "طارئ",
  elderly: "كبير سن",
  accessibility: "ذوو احتياج",
};

const WAITING_STYLES: Record<QueueRow["waiting_state"], string> = {
  none: "text-muted-foreground",
  ok: "text-emerald-700",
  warning: "text-amber-700 font-medium",
  critical: "text-rose-700 font-bold",
};

export default function ReceptionBoard({
  organizationId,
  organizationName,
  doctors,
  clinics,
  doctorFilter,
  highlightAppointmentId,
}: {
  organizationId: string | undefined;
  organizationName: string;
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
  /**
   * مرشّح الطبيب يأتي من الشاشة ولا يُملَك هنا.
   *
   * كان للوحة مرشِّحها المستقلّ، فتظهر في الشاشة قائمتان بنفس العنوان «كل
   * الأطباء»: العليا (مرشّح الصفحة) بلا أثر على اللوحة، والسفلى هي العاملة —
   * فيختار الموظف طبيبًا من العليا ويبقى الطابور كما هو فيحسب التصفية معطّلة.
   */
  doctorFilter: string;
  /** صفّ الموعد القادم من `?appointmentId=` يُبرَز حتى يُعثَر عليه بلا بحث. */
  highlightAppointmentId?: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [transferTarget, setTransferTarget] = useState<QueueRow | null>(null);
  const [priorityTarget, setPriorityTarget] = useState<QueueRow | null>(null);
  const [undoTarget, setUndoTarget] = useState<QueueRow | null>(null);
  /**
   * عدم الحضور كان غائبًا عن اللوحة كليًا مع أن `app_reception_transition`
   * تدعمه: مريضٌ مؤكَّد لم يحضر لا يمكن إغلاق موعده إلا بالتبديل إلى عرض
   * «بطاقات» — فيبقى في الطابور بقية اليوم ويشوّه عدّاد الانتظار.
   */
  const [noShowTarget, setNoShowTarget] = useState<QueueRow | null>(null);

  const queue = useQuery({
    queryKey: ["reception-board", organizationId],
    enabled: Boolean(organizationId),
    // التحديث الدوري لا التحديث اليدوي: الطابور يتغيّر بفعل زملاء آخرين،
    // وشاشة لا تتحدّث تجعل الموظف ينادي مريضًا نُودي قبل دقيقة.
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reception_queue_ordered")
        .select("*")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as QueueRow[];
    },
  });

  const rows = useMemo(
    () => (queue.data ?? []).filter((row) => doctorFilter === "all" || row.doctor_id === doctorFilter),
    [queue.data, doctorFilter],
  );

  const transition = useMutation({
    mutationFn: async ({ id, action, reason }: { id: string; action: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("app_reception_transition", {
        p_appointment_id: id,
        p_action: action,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return { id, action, result: Array.isArray(data) ? data[0] : data };
    },
    onSuccess: ({ id, action }) => {
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      if (action === "start") navigate(`/medical-records?appointmentId=${id}`);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر تنفيذ الإجراء",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const printTicket = (row: QueueRow) => {
    // اسم مختصر: الاسم الأول والأخير. التذكرة تُترك على طاولة أو تُعلَّق،
    // وطباعة الاسم الرباعي عليها إفشاء لا داعي له.
    const parts = row.patient_name.trim().split(/\s+/);
    const shortName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : row.patient_name;
    printHtml(
      `تذكرة دور ${row.queue_number ?? ""}`,
      `<div style="text-align:center;font-family:sans-serif">
         <h2 style="margin:0">${organizationName}</h2>
         <p style="margin:4px 0;font-size:12px">تذكرة الدور</p>
         <div style="font-size:64px;font-weight:bold;margin:12px 0">${row.queue_number ?? "—"}</div>
         <p style="margin:2px 0">${shortName}</p>
         <p style="margin:2px 0;font-size:12px">${row.doctor_name}${row.clinic_name ? ` · ${row.clinic_name}` : ""}</p>
         <p style="margin:2px 0;font-size:12px">
           وقت التسجيل: ${new Date(row.arrived_at ?? Date.now()).toLocaleString("ar-SA")}
         </p>
       </div>`,
      "thermal_80mm",
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{rows.length} مريض في الطابور</span>
          {rows.some((row) => row.waiting_state === "critical") && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              انتظار طويل
            </Badge>
          )}
        </div>
        {doctorFilter !== "all" && (
          <span className="text-xs text-muted-foreground">
            مصفّى على: {doctors.find((doctor) => doctor.id === doctorFilter)?.name_ar ?? "طبيب"}
          </span>
        )}
      </div>

      {queue.isLoading && <Skeleton className="h-72 w-full" />}

      {!queue.isLoading && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">الدور</TableHead>
                <TableHead>المريض</TableHead>
                <TableHead>الطبيب / العيادة</TableHead>
                <TableHead>الموعد</TableHead>
                <TableHead>الوصول</TableHead>
                <TableHead>الانتظار</TableHead>
                <TableHead>الأولوية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التأمين</TableHead>
                <TableHead>الفاتورة</TableHead>
                <TableHead className="min-w-[16rem]">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.appointment_id}
                  className={row.appointment_id === highlightAppointmentId ? "ring-2 ring-inset ring-primary" : undefined}
                >
                  <TableCell className="text-center font-bold tabular-nums">
                    {row.queue_number ?? "—"}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-start"
                      onClick={() => navigate(`/patients/${row.patient_id}`)}
                    >
                      <div className="font-medium hover:text-primary">{row.patient_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[row.file_number && `ملف ${row.file_number}`, row.mobile_number]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
                    {(row.medical_alert || row.blood_type) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.blood_type && (
                          <Badge variant="outline" className="text-[10px]">
                            {row.blood_type}
                          </Badge>
                        )}
                        {row.medical_alert && (
                          <Badge variant="destructive" className="max-w-[12rem] truncate text-[10px]">
                            {row.medical_alert}
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{row.doctor_name}</div>
                    <div className="text-xs text-muted-foreground">{row.clinic_name ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {new Date(row.scheduled_start).toLocaleTimeString("ar-SA", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {row.arrived_at
                      ? new Date(row.arrived_at).toLocaleTimeString("ar-SA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className={`tabular-nums ${WAITING_STYLES[row.waiting_state]}`}>
                    {row.waiting_minutes === null ? "—" : `${row.waiting_minutes} د`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.priority === "normal" ? "outline" : "destructive"}>
                      {PRIORITY_LABELS[row.priority] ?? row.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.insurance_company_name ? (
                      <Badge variant={row.insurance_valid ? "success" : "destructive"}>
                        {row.insurance_valid ? row.insurance_company_name : "بطاقة منتهية"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">نقدي</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.invoice_id ? (
                      <span className={Number(row.remaining_amount) > 0 ? "text-rose-600" : "text-emerald-700"}>
                        متبقٍ {Number(row.remaining_amount ?? 0).toLocaleString("ar-SA")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">لا فاتورة</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.status === "confirmed" && can("reception.check_in") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => transition.mutate({ id: row.appointment_id, action: "arrive" })}
                        >
                          <UserCheck className="h-3.5 w-3.5" /> وصول
                        </Button>
                      )}
                      {row.status === "arrived" && can("reception.check_in") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => transition.mutate({ id: row.appointment_id, action: "check_in" })}
                        >
                          تسجيل
                        </Button>
                      )}
                      {["arrived", "checked_in", "waiting", "walk_in"].includes(row.status) &&
                        can("reception.call") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => transition.mutate({ id: row.appointment_id, action: "call" })}
                          >
                            <Bell className="h-3.5 w-3.5" /> نداء
                          </Button>
                        )}
                      {row.status === "called" && can("reception.call") && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => transition.mutate({ id: row.appointment_id, action: "recall" })}
                          >
                            <Bell className="h-3.5 w-3.5" /> إعادة نداء
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => transition.mutate({ id: row.appointment_id, action: "uncall" })}
                          >
                            <BellOff className="h-3.5 w-3.5" /> إلغاء النداء
                          </Button>
                        </>
                      )}
                      {["called", "checked_in", "arrived", "waiting", "walk_in"].includes(row.status) &&
                        can("reception.start_visit") && (
                          <Button
                            size="sm"
                            onClick={() => transition.mutate({ id: row.appointment_id, action: "start" })}
                          >
                            بدء الزيارة
                          </Button>
                        )}
                      {row.status === "in_progress" && can("reception.finish") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => transition.mutate({ id: row.appointment_id, action: "finish" })}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> إنهاء
                        </Button>
                      )}
                      {["confirmed", "arrived"].includes(row.status) && can("reception.check_in") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setNoShowTarget(row)}
                        >
                          <UserX className="h-3.5 w-3.5" /> لم يحضر
                        </Button>
                      )}
                      {can("reception.transfer") && (
                        <Button size="sm" variant="ghost" onClick={() => setTransferTarget(row)}>
                          <ArrowLeftRight className="h-3.5 w-3.5" /> نقل
                        </Button>
                      )}
                      {can("appointments.update") && (
                        <Button size="sm" variant="ghost" onClick={() => setPriorityTarget(row)}>
                          <Flag className="h-3.5 w-3.5" /> أولوية
                        </Button>
                      )}
                      {can("reception.override") && (
                        <Button size="sm" variant="ghost" onClick={() => setUndoTarget(row)}>
                          <Undo2 className="h-3.5 w-3.5" /> تراجع
                        </Button>
                      )}
                      {row.queue_number !== null && (
                        <Button size="sm" variant="ghost" onClick={() => printTicket(row)}>
                          <Printer className="h-3.5 w-3.5" /> تذكرة
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                    لا مرضى في الطابور الآن.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <TransferDialog
        row={transferTarget}
        doctors={doctors}
        clinics={clinics}
        onClose={() => setTransferTarget(null)}
      />
      <PriorityDialog row={priorityTarget} onClose={() => setPriorityTarget(null)} />
      <NoShowDialog
        row={noShowTarget}
        onClose={() => setNoShowTarget(null)}
        onConfirm={(reason) => {
          if (!noShowTarget) return;
          transition.mutate({ id: noShowTarget.appointment_id, action: "no_show", reason });
          setNoShowTarget(null);
        }}
      />
      <UndoDialog
        row={undoTarget}
        onClose={() => setUndoTarget(null)}
        onConfirm={(reason) => {
          if (!undoTarget) return;
          transition.mutate({ id: undoTarget.appointment_id, action: "undo", reason });
          setUndoTarget(null);
        }}
      />
    </div>
  );
}

function TransferDialog({
  row,
  doctors,
  clinics,
  onClose,
}: {
  row: QueueRow | null;
  doctors: { id: string; name_ar: string }[];
  clinics: { id: string; name: string }[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [doctorId, setDoctorId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [reason, setReason] = useState("");

  const transfer = useMutation({
    mutationFn: async () => {
      if (!row) return;
      if (!reason.trim()) throw new Error("سبب النقل مطلوب");
      const { error } = await supabase.rpc("app_transfer_reception_appointment", {
        p_appointment_id: row.appointment_id,
        p_doctor_id: doctorId || null,
        p_clinic_id: clinicId || null,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-appointments"] });
      toast({ title: "تم النقل" });
      setDoctorId("");
      setClinicId("");
      setReason("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر النقل",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>نقل المريض</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — حاليًا مع {row?.doctor_name}
            {row?.clinic_name ? ` في ${row.clinic_name}` : ""}.
            <br />
            رقم الدور لا يتغيّر بالنقل: من وقف في الطابور لا يفقد دوره لأن الطبيب تغيّر.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب الجديد</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="بلا تغيير" />
              </SelectTrigger>
              <SelectContent>
                {doctors
                  .filter((doctor) => doctor.id !== row?.doctor_id)
                  .map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.name_ar}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العيادة الجديدة</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger>
                <SelectValue placeholder="بلا تغيير" />
              </SelectTrigger>
              <SelectContent>
                {clinics.map((clinic) => (
                  <SelectItem key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>سبب النقل *</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={transfer.isPending || !reason.trim() || (!doctorId && !clinicId)}
            onClick={() => transfer.mutate()}
          >
            {transfer.isPending ? "جارٍ النقل..." : "تأكيد النقل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriorityDialog({ row, onClose }: { row: QueueRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [priority, setPriority] = useState("urgent");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const { error } = await supabase.rpc("app_set_appointment_priority", {
        p_appointment_id: row.appointment_id,
        p_priority: priority,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-board"] });
      toast({ title: "تم تحديث الأولوية" });
      setReason("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تغيير الأولوية</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — الأولوية الحالية: {PRIORITY_LABELS[row?.priority ?? "normal"]}.
            <br />
            تقديم مريض على آخر قرار يُسأل عنه، فالسبب إلزامي ويُسجَّل في التدقيق.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الأولوية الجديدة</Label>
            <Select value={priority} onValueChange={setPriority}>
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
          <div className="flex flex-col gap-1.5">
            <Label>السبب *</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || !reason.trim()} onClick={() => save.mutate()}>
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoShowDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: QueueRow | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل عدم الحضور</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — موعد {row ? new Date(row.scheduled_start).toLocaleString("ar-SA") : ""}.
            <br />
            السبب إلزامي وتفرضه القاعدة: «لم يحضر» بلا سبب يمنع أي متابعة لاحقة للمريض،
            ولا يفرّق بين من لم يُتصل به ومن اعتذر.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>سبب عدم الحضور *</Label>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            تأكيد عدم الحضور
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UndoDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: QueueRow | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>التراجع عن الانتقال الأخير</DialogTitle>
          <DialogDescription>
            {row?.patient_name} — الحالة الآن: {STATUS_LABELS[row?.status ?? ""] ?? row?.status}.
            <br />
            خطوة واحدة إلى الوراء فقط. الحالات المكتملة والجارية تُصحَّح بإجراء صريح لا بالتراجع،
            لأن الزيارة قد تكون صدرت بها فاتورة.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>سبب التراجع *</Label>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            تأكيد التراجع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
