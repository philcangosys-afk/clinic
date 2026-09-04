import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReceptionBoard from "@/components/reception/ReceptionBoard";
import DoctorRequests from "@/components/reception/DoctorRequests";
import {
  CalendarClock,
  CheckCircle2,
  LogIn,
  Megaphone,
  FileText,
  Plus,
  Receipt,
  Stethoscope,
  UserX,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import type { AppointmentStatus, AppointmentWithRelations } from "@/lib/database.types";
import { statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
import QuickAddPatientDialog from "@/components/shared/QuickAddPatientDialog";
import { useToast } from "@/hooks/use-toast";

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}
function endOfTodayIso() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

type ReceptionAppointment = AppointmentWithRelations & {
  priority: "normal" | "urgent" | "emergency" | "elderly" | "accessibility";
  queue_number: number | null;
  invoices?: { id: string; status: string; remaining_amount: number; is_temporary: boolean }[];
  patient?: (NonNullable<AppointmentWithRelations["patient"]> & {
    insurance_company_name: string | null;
    insurance_policy_number: string | null;
  }) | null;
};

type ReceptionAction = "arrive" | "check_in" | "call" | "start" | "finish" | "no_show";

const PRIORITY_ORDER: Record<ReceptionAppointment["priority"], number> = {
  emergency: 0,
  urgent: 1,
  accessibility: 2,
  elderly: 3,
  normal: 4,
};

const PRIORITY_LABEL: Record<ReceptionAppointment["priority"], string> = {
  emergency: "طارئ",
  urgent: "عاجل",
  accessibility: "ذوو الإعاقة",
  elderly: "كبار السن",
  normal: "عادي",
};

const ACTIVE_STATUSES: AppointmentStatus[] = [
  "new",
  "scheduled",
  "confirmed",
  "unconfirmed",
  "arrived",
  "checked_in",
  "called",
  "in_progress",
  "waiting",
  "walk_in",
];

function useTodayQueue(organizationId: string | undefined, doctorFilter: string) {
  return useQuery({
    queryKey: ["reception-queue", organizationId, doctorFilter],
    enabled: Boolean(organizationId),
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = supabase
        .from("appointments")
        .select(
          "id, organization_id, scheduled_start, scheduled_end, status, priority, queue_number, cancellation_reason, no_show_reason, checked_in_1_at, checked_in_2_at, called_at, entered_at, left_at, visit_type_value_id, source_value_id, note, sms_reminder_sent, created_by, created_at, updated_at, doctor_id, patient_id, clinic_id, patient:patients!appointments_patient_tenant_fk(id, name_ar, mobile_number, file_number, insurance_company_name, insurance_policy_number), doctor:doctors!appointments_doctor_tenant_fk(id, name_ar), clinic:clinics!appointments_clinic_tenant_fk(id, name), invoices:sales_invoices!sales_invoices_appointment_tenant_fk(id, status, remaining_amount, is_temporary)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها —
        // بدون هذا الفلتر تختلط بيانات منشأتين لعضوٍ في كلتيهما.
        .eq("organization_id", organizationId)
        .gte("scheduled_start", startOfTodayIso())
        .lte("scheduled_start", endOfTodayIso())
        .order("scheduled_start", { ascending: true });
      if (doctorFilter !== "all") query = query.eq("doctor_id", doctorFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as ReceptionAppointment[];
    },
  });
}

function useDoctorsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-enabled", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true)
        .eq("disabled_from_booking", false)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Reception() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [noShowTarget, setNoShowTarget] = useState<ReceptionAppointment | null>(null);
  const [noShowReason, setNoShowReason] = useState("");
  /**
   * اللوحة هي الافتراضي: هي التي تعرض مدّة الانتظار وحالة الفاتورة والتأمين
   * والتنبيه الطبي والترتيب المحسوم في القاعدة. والبطاقات القديمة تبقى
   * بزرّ — لا تُستبدل شاشة يعمل عليها موظف كل يوم بلا مخرج.
   */
  const [mode, setMode] = useState<"board" | "cards">("board");
  const clinicList = useQuery({
    queryKey: ["reception-clinic-list", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organization?.id)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const canManageQueue = legacyMode || ["owner", "organization_admin", "branch_manager", "receptionist"].includes(membership?.role_key ?? "");
  const canEditClinical = legacyMode || ["owner", "organization_admin", "doctor", "nurse"].includes(membership?.role_key ?? "");
  const queue = useTodayQueue(organization?.id, doctorFilter);
  const doctors = useDoctorsList(organization?.id);

  const grouped = useMemo(() => {
    const rows = queue.data ?? [];
    const active = rows.filter((row) => ACTIVE_STATUSES.includes(row.status)).sort((a, b) =>
      PRIORITY_ORDER[a.priority ?? "normal"] - PRIORITY_ORDER[b.priority ?? "normal"] ||
      (a.queue_number ?? Number.MAX_SAFE_INTEGER) - (b.queue_number ?? Number.MAX_SAFE_INTEGER) ||
      new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());
    const done = rows.filter((row) => !ACTIVE_STATUSES.includes(row.status));
    return { active, done };
  }, [queue.data]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, action, reason }: { id: string; action: ReceptionAction; reason?: string }) => {
      const { data, error } = await supabase.rpc("app_reception_transition", {
        p_appointment_id: id,
        p_action: action,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      return { id, action, result: Array.isArray(data) ? data[0] : data };
    },
    onSuccess: ({ id, action }) => {
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      if (action === "start" && canEditClinical) navigate(`/medical-records?appointmentId=${id}`);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تحديث الحالة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الاستقبال والانتظار</h1>
          <p className="text-sm text-muted-foreground">طابور اليوم الحي — يتحدّث تلقائيًا كل 30 ثانية.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={doctorFilter} onValueChange={setDoctorFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="كل الأطباء" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأطباء</SelectItem>
              {(doctors.data ?? []).map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  د. {doctor.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setMode("board")}
              className={`rounded px-2.5 py-1 text-xs ${mode === "board" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              اللوحة
            </button>
            <button
              type="button"
              onClick={() => setMode("cards")}
              className={`rounded px-2.5 py-1 text-xs ${mode === "cards" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              بطاقات
            </button>
          </div>
          {canManageQueue && <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            إضافة للطابور
          </Button>}
        </div>
      </div>

      {/* ما يرسله الأطباء يظهر فوق الطابور: طلبٌ ينتظر لا يجوز أن يُدفن
          تحت قوائم الانتظار حتى يسأل عنه الطبيب. */}
      <DoctorRequests />

      {mode === "board" && (
        <ReceptionBoard
          organizationId={organization?.id}
          organizationName={organization?.name ?? ""}
          doctors={doctors.data ?? []}
          clinics={clinicList.data ?? []}
        />
      )}

      {mode === "cards" && (
      <Card>
        <CardHeader>
          <CardTitle>قيد الانتظار الآن ({grouped.active.length})</CardTitle>
          <CardDescription>حسب الأولوية ثم رقم الدور ووقت الموعد</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {queue.isLoading &&
            Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}
          {!queue.isLoading && grouped.active.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">لا يوجد أحد في الطابور حاليًا.</p>
          )}
          {grouped.active.map((appointment) => (
            <QueueRow
              key={appointment.id}
              appointment={appointment}
              onUpdate={(action) => action === "no_show"
                ? setNoShowTarget(appointment)
                : updateStatus.mutate({ id: appointment.id, action })}
              onPatient={() => navigate(`/patients/${appointment.patient_id}`)}
              onVisit={() => navigate(canEditClinical ? `/medical-records?appointmentId=${appointment.id}` : `/patients/${appointment.patient_id}`)}
              onInvoice={() => navigate(`/billing?appointmentId=${appointment.id}`)}
            />
          ))}
        </CardContent>
      </Card>
      )}

      {mode === "cards" && grouped.done.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>منتهية اليوم ({grouped.done.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {grouped.done.map((appointment) => (
              <QueueRow
                key={appointment.id}
                appointment={appointment}
                onUpdate={(action) => action === "no_show"
                ? setNoShowTarget(appointment)
                : updateStatus.mutate({ id: appointment.id, action })}
              onPatient={() => navigate(`/patients/${appointment.patient_id}`)}
              onVisit={() => navigate(canEditClinical ? `/medical-records?appointmentId=${appointment.id}` : `/patients/${appointment.patient_id}`)}
              onInvoice={() => navigate(`/billing?appointmentId=${appointment.id}`)}
                readOnly
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(noShowTarget)} onOpenChange={(open) => { if (!open) { setNoShowTarget(null); setNoShowReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>تسجيل عدم الحضور</DialogTitle><DialogDescription>سيُحفظ السبب في سجل الموعد والتدقيق.</DialogDescription></DialogHeader>
          <Textarea value={noShowReason} onChange={(event) => setNoShowReason(event.target.value)} placeholder="سبب عدم الحضور أو ملاحظة التواصل" rows={3} />
          <DialogFooter><Button variant="destructive" disabled={!noShowReason.trim() || updateStatus.isPending} onClick={() => {
            if (!noShowTarget) return;
            updateStatus.mutate({ id: noShowTarget.id, action: "no_show", reason: noShowReason }, { onSuccess: () => { setNoShowTarget(null); setNoShowReason(""); } });
          }}>تأكيد عدم الحضور</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AddToQueueDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        organizationId={organization?.id}
        doctors={doctors.data ?? []}
      />
    </div>
  );
}

/**
 * أزمنة الطابور الخمسة — تُكتب ولا تُعرض.
 *
 * التدقيق أثبت أن `checked_in_1_at` و`checked_in_2_at` و`called_at` و
 * `entered_at` و`left_at` تُكتب كلها بأزرار هذا الصف وتُجلب في الاستعلام،
 * **ولا تُعرض أي قيمة منها**. فلا أحد يعرف كم انتظر المريض بين وصوله ودخوله،
 * ولا كم استغرقت الجلسة — وهي أهم رقمين تشغيليين في شاشة الاستقبال، ومطلوبان
 * في مؤشرات CBAHI لزمن الانتظار.
 */
function QueueTimeline({ appointment }: { appointment: ReceptionAppointment }) {
  const fmt = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })
      : null;

  const stamps = [
    { label: "وصل", value: fmt(appointment.checked_in_1_at) },
    { label: "استقبال 2", value: fmt(appointment.checked_in_2_at) },
    { label: "نودي", value: fmt(appointment.called_at) },
    { label: "دخل", value: fmt(appointment.entered_at) },
    { label: "خرج", value: fmt(appointment.left_at) },
  ].filter((stamp) => stamp.value);

  // الفروق تُحتسب من الطوابع نفسها لا من حقول محفوظة: حقل محسوب مسبقًا يصبح
  // خاطئًا لحظة تصحيح أي طابع.
  const minutesBetween = (from: string | null | undefined, to: string | null | undefined) => {
    if (!from || !to) return null;
    const diff = (new Date(to).getTime() - new Date(from).getTime()) / 60000;
    return diff >= 0 ? Math.round(diff) : null;
  };
  const waited = minutesBetween(appointment.checked_in_1_at, appointment.entered_at);
  const duration = minutesBetween(appointment.entered_at, appointment.left_at);

  if (stamps.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {stamps.map((stamp) => (
        <span key={stamp.label} className="tabular-nums">
          {stamp.label} {stamp.value}
        </span>
      ))}
      {waited !== null && (
        <span className="font-medium text-amber-700 tabular-nums">انتظر {waited} د</span>
      )}
      {duration !== null && (
        <span className="font-medium text-emerald-700 tabular-nums">الجلسة {duration} د</span>
      )}
    </div>
  );
}

function QueueRow({
  appointment,
  onUpdate,
  onPatient,
  onVisit,
  onInvoice,
  readOnly,
}: {
  appointment: ReceptionAppointment;
  onUpdate: (action: ReceptionAction) => void;
  onPatient: () => void;
  onVisit: () => void;
  onInvoice: () => void;
  readOnly?: boolean;
}) {
  const time = new Date(appointment.scheduled_start).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-3">
      <div className="flex min-w-[7rem] items-center gap-2 text-sm text-muted-foreground">
        <CalendarClock className="h-4 w-4" />
        {time}
      </div>
      <div className="min-w-[10rem] flex-1">
        <button type="button" className="text-start" onClick={onPatient}>
          <p className="text-sm font-semibold hover:text-primary">{appointment.patient?.name_ar ?? "—"}</p>
          <p className="text-xs text-muted-foreground">#{appointment.patient?.file_number} · {appointment.patient?.mobile_number ?? "—"}</p>
        </button>
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          {appointment.queue_number && <Badge variant="outline">الدور {appointment.queue_number}</Badge>}
          {appointment.priority !== "normal" && <Badge variant={appointment.priority === "emergency" ? "destructive" : "warning"}>{PRIORITY_LABEL[appointment.priority]}</Badge>}
          {appointment.patient?.insurance_company_name && <Badge variant="outline">تأمين: {appointment.patient.insurance_company_name}</Badge>}
          {(appointment.invoices ?? []).filter((invoice) => !invoice.is_temporary).map((invoice) => (
            <Badge key={invoice.id} variant={invoice.remaining_amount > 0 ? "warning" : "success"}>
              {invoice.remaining_amount > 0 ? `متبقي ${Number(invoice.remaining_amount).toFixed(2)}` : "مدفوع"}
            </Badge>
          ))}
        </div>
      </div>
      <div className="min-w-[8rem] text-sm text-muted-foreground">د. {appointment.doctor?.name_ar ?? "—"}</div>
      <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1">
          {["new", "scheduled", "confirmed", "unconfirmed"].includes(appointment.status) && (
            <Button size="sm" variant="outline" onClick={() => onUpdate("arrive")}><LogIn className="h-3.5 w-3.5" />حضر</Button>
          )}
          {appointment.status === "arrived" && appointment.checked_in_1_at && !appointment.checked_in_2_at && (
            <Button size="sm" variant="outline" onClick={() => onUpdate("check_in")}><LogIn className="h-3.5 w-3.5" />استقبال 2</Button>
          )}
          {["arrived", "checked_in", "waiting", "walk_in"].includes(appointment.status) && (
            <Button size="sm" variant="outline" onClick={() => onUpdate("call")}><Megaphone className="h-3.5 w-3.5" />نداء</Button>
          )}
          {["arrived", "checked_in", "called", "waiting", "walk_in"].includes(appointment.status) && (
            <Button size="sm" variant="outline" onClick={() => onUpdate("start")}><Stethoscope className="h-3.5 w-3.5" />دخول</Button>
          )}
          {appointment.status === "in_progress" && (
            <Button size="sm" variant="outline" onClick={() => onUpdate("finish")}><CheckCircle2 className="h-3.5 w-3.5" />إنهاء</Button>
          )}
          {["new", "scheduled", "confirmed", "unconfirmed", "arrived"].includes(appointment.status) && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onUpdate("no_show")}><UserX className="h-3.5 w-3.5" />لم يحضر</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onVisit}><FileText className="h-3.5 w-3.5" />السجل</Button>
          <Button size="sm" variant="ghost" onClick={onInvoice}><Receipt className="h-3.5 w-3.5" />الفاتورة</Button>
        </div>
      )}
      <QueueTimeline appointment={appointment} />
    </div>
  );
}

function AddToQueueDialog({
  open,
  onOpenChange,
  organizationId,
  doctors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  doctors: { id: string; name_ar: string }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [clinicId, setClinicId] = useState("none");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const clinics = useQuery({
    queryKey: ["reception-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name")
        .eq("organization_id", organizationId).eq("is_disabled", false).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const createAppointment = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient || !doctorId) throw new Error("أكمل بيانات المريض والطبيب");
      // نفس الحظر المطبَّق في شاشة المواعيد — الطابور مسار إنشاء موعد آخر
      await assertPatientNotBlocked(patient.id, "appointments");
      const { error } = await supabase.rpc("app_add_walk_in", {
        p_organization_id: organizationId,
        p_patient_id: patient.id,
        p_doctor_id: doctorId,
        p_clinic_id: clinicId === "none" ? null : clinicId,
        p_priority: priority,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      toast({ title: "تمت الإضافة إلى الطابور" });
      setPatient(null);
      setDoctorId("");
      setClinicId("none");
      setPriority("normal");
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإضافة",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة مريض إلى طابور اليوم</DialogTitle>
            <DialogDescription>للحجز المسبق استخدم شاشة المواعيد — هذا لحضور اليوم فقط.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <PatientPicker onSelect={(found) => setPatient({ id: found.id, name_ar: found.name_ar })} />
              {patient && <p className="text-xs text-emerald-700">المريض المحدد: {patient.name_ar}</p>}
              <button
                type="button"
                className="self-start text-xs font-medium text-primary hover:underline"
                onClick={() => setQuickAddOpen(true)}
              >
                مريض جديد بلا ملف؟ فتح ملف سريع
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الطبيب *</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الطبيب" />
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      د. {doctor.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5"><Label>العيادة</Label><Select value={clinicId} onValueChange={setClinicId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون</SelectItem>{(clinics.data ?? []).map((clinic) => <SelectItem key={clinic.id} value={clinic.id}>{clinic.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="flex flex-col gap-1.5"><Label>الأولوية</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">عادي</SelectItem><SelectItem value="urgent">عاجل</SelectItem><SelectItem value="emergency">طارئ</SelectItem><SelectItem value="elderly">كبار السن</SelectItem><SelectItem value="accessibility">ذوو الإعاقة</SelectItem></SelectContent></Select></div>
            </div>
            <div className="flex flex-col gap-1.5"><Label>ملاحظة الاستقبال</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></div>
          </div>

          <DialogFooter>
            <Button
              disabled={!patient || !doctorId || createAppointment.isPending}
              onClick={() => createAppointment.mutate()}
            >
              {createAppointment.isPending ? "جارٍ الإضافة..." : "إضافة للطابور"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickAddPatientDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onCreated={(created) => setPatient({ id: created.id, name_ar: created.name_ar })}
      />
    </>
  );
}
