import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarX, Check, ChevronLeft, ChevronRight, Edit3, ExternalLink, Plus, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import { checkDoctorAvailability } from "@/lib/doctor-availability";
import type { AppointmentStatus, AppointmentWithRelations } from "@/lib/database.types";
import { statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import PatientPicker from "@/components/shared/PatientPicker";
import LookupSelect from "@/components/shared/LookupSelect";
import CannedTextPicker, { appendCannedText } from "@/components/shared/CannedTextPicker";
import QuickAddPatientDialog from "@/components/shared/QuickAddPatientDialog";

/** Radix Select يرفض قيمة فارغة، فيُستخدم رمز صريح لـ"بدون". */
const NONE_VALUE = "__none__";
import { useToast } from "@/hooks/use-toast";

/**
 * تنسيق تاريخ لحقل `<input type="date">` **بالتقويم المحلي** لا بـ UTC.
 *
 * `toISOString()` يحوّل إلى UTC أولًا. في الرياض (UTC+3) كان
 * `new Date("2026-08-28T00:00:00")` = `2026-08-27T21:00Z`، وبعد `+1 يوم`
 * يصير `2026-08-28T21:00Z`، فيُعيد `slice(0,10)` نفس اليوم — **سهم "التالي"
 * لا يتحرك إطلاقًا**، وسهم "السابق" يقفز يومين. وبين منتصف الليل والثالثة
 * فجرًا كانت الشاشة تفتح على يوم أمس.
 */
function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
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

function useDayAppointments(organizationId: string | undefined, day: string) {
  return useQuery({
    queryKey: ["appointments-day", organizationId, day],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const start = new Date(`${day}T00:00:00`);
      const end = new Date(`${day}T23:59:59`);
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, organization_id, clinic_id, scheduled_start, scheduled_end, status, priority, queue_number, cancellation_reason, no_show_reason, checked_in_1_at, checked_in_2_at, called_at, entered_at, left_at, visit_type_value_id, source_value_id, note, sms_reminder_sent, created_by, created_at, updated_at, doctor_id, patient_id, patient:patients!appointments_patient_tenant_fk(id, name_ar, mobile_number, file_number), doctor:doctors!appointments_doctor_tenant_fk(id, name_ar), clinic:clinics!appointments_clinic_tenant_fk(id, name)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organizationId)
        .gte("scheduled_start", start.toISOString())
        .lte("scheduled_start", end.toISOString())
        .order("scheduled_start", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AppointmentWithRelations[];
    },
  });
}

export default function Appointments() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [day, setDay] = useState(() => toDateInputValue(new Date()));
  const [createOpen, setCreateOpen] = useState(false);
  const [managedAppointment, setManagedAppointment] = useState<AppointmentWithRelations | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const doctors = useDoctorsList(organization?.id);
  const appointments = useDayAppointments(organization?.id, day);
  const canSchedule = legacyMode || ["owner", "organization_admin", "branch_manager", "receptionist"].includes(membership?.role_key ?? "");

  const filteredAppointments = useMemo(() => (appointments.data ?? []).filter((appointment) => {
    const matchesSearch = !search.trim() ||
      appointment.patient?.name_ar?.includes(search.trim()) ||
      String(appointment.patient?.file_number ?? "").includes(search.trim()) ||
      appointment.patient?.mobile_number?.includes(search.trim());
    return matchesSearch && (statusFilter === "all" || appointment.status === statusFilter);
  }), [appointments.data, search, statusFilter]);

  const confirmAppointment = useMutation({
    mutationFn: async (appointment: AppointmentWithRelations) => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase.from("appointments")
        .update({ status: "confirmed" })
        .eq("id", appointment.id)
        .eq("organization_id", organization.id)
        .in("status", ["new", "scheduled", "unconfirmed"])
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("تغيّرت حالة الموعد؛ حدّث الصفحة وأعد المحاولة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      toast({ title: "تم تأكيد الموعد" });
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر التأكيد", description: error instanceof Error ? error.message : "حدث خطأ" }),
  });

  const byDoctor = useMemo(() => {
    const map = new Map<string, AppointmentWithRelations[]>();
    (doctors.data ?? []).forEach((doctor) => map.set(doctor.id, []));
    filteredAppointments.forEach((appointment) => {
      const list = map.get(appointment.doctor_id) ?? [];
      list.push(appointment);
      map.set(appointment.doctor_id, list);
    });
    return map;
  }, [doctors.data, filteredAppointments]);

  const shiftDay = (delta: number) => {
    const next = new Date(`${day}T00:00:00`);
    next.setDate(next.getDate() + delta);
    setDay(toDateInputValue(next));
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المواعيد</h1>
          <p className="text-sm text-muted-foreground">جدول الأطباء اليومي</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shiftDay(-1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-40" />
          <Button variant="outline" size="icon" onClick={() => shiftDay(1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {canSchedule && <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            موعد جديد
          </Button>}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم المريض أو الملف أو الجوال" className="pr-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {(["scheduled", "confirmed", "arrived", "checked_in", "called", "in_progress", "completed", "no_show", "cancelled_by_patient", "cancelled_by_staff"] as AppointmentStatus[]).map((status) => (
                <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => navigate("/waitlist")}>قائمة الانتظار</Button>
        </CardContent>
      </Card>

      {appointments.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      )}

      {!appointments.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...byDoctor.entries()].map(([doctorId, list]) => {
            const doctor = (doctors.data ?? []).find((item) => item.id === doctorId);
            return (
              <Card key={doctorId}>
                <CardHeader>
                  <CardTitle className="text-base">د. {doctor?.name_ar ?? "—"}</CardTitle>
                  <p className="text-xs text-muted-foreground">{list.length} موعد</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {list.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">لا مواعيد</p>}
                  {list.map((appointment) => (
                    <div key={appointment.id} className="rounded-lg border px-2.5 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <button type="button" className="text-right" onClick={() => navigate(`/patients/${appointment.patient_id}`)}>
                          <p className="text-sm font-medium hover:text-primary">{appointment.patient?.name_ar}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(appointment.scheduled_start).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                            {appointment.clinic?.name ? ` · ${appointment.clinic.name}` : ""}
                          </p>
                        </button>
                        <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {canSchedule && ["new", "scheduled", "unconfirmed"].includes(appointment.status) && (
                          <Button size="sm" variant="outline" onClick={() => confirmAppointment.mutate(appointment)}>
                            <Check className="h-3.5 w-3.5" /> تأكيد
                          </Button>
                        )}
                        {canSchedule && !['completed','no_show','cancelled_by_patient','cancelled_by_staff'].includes(appointment.status) && (
                          <Button size="sm" variant="outline" onClick={() => setManagedAppointment(appointment)}>
                            <Edit3 className="h-3.5 w-3.5" /> تعديل
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/reception?appointmentId=${appointment.id}`)}>
                          <ExternalLink className="h-3.5 w-3.5" /> الاستقبال
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ManageAppointmentDialog
        appointment={managedAppointment}
        onOpenChange={(open) => { if (!open) setManagedAppointment(null); }}
        organizationId={organization?.id}
        doctors={doctors.data ?? []}
      />
      <CreateAppointmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organization?.id}
        doctors={doctors.data ?? []}
        defaultDay={day}
      />
    </div>
  );
}

function ManageAppointmentDialog({
  appointment,
  onOpenChange,
  organizationId,
  doctors,
}: {
  appointment: AppointmentWithRelations | null;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  doctors: { id: string; name_ar: string }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [clinicId, setClinicId] = useState(NONE_VALUE);
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);

  const clinics = useQuery({
    queryKey: ["appointment-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name")
        .eq("organization_id", organizationId).eq("is_disabled", false).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  useEffect(() => {
    if (!appointment) return;
    const start = new Date(appointment.scheduled_start);
    const minutes = Math.max(5, Math.round((new Date(appointment.scheduled_end).getTime() - start.getTime()) / 60_000));
    setDoctorId(appointment.doctor_id);
    setDate(toDateInputValue(start));
    setTime(`${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`);
    setDuration(String(minutes));
    setClinicId(appointment.clinic_id ?? NONE_VALUE);
    setPriority(appointment.priority ?? "normal");
    setNote(appointment.note ?? "");
    setCancellationReason(appointment.cancellation_reason ?? "");
    setAllowOutsideHours(false);
  }, [appointment]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
    queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!appointment || !organizationId || !doctorId || !date || !time) throw new Error("أكمل بيانات الموعد");
      await assertPatientNotBlocked(appointment.patient_id, "appointments");
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + Number(duration) * 60_000);
      const availability = await checkDoctorAvailability(doctorId, start, end);
      if (availability.status === "blocked") throw new Error(availability.message ?? "الطبيب غير متاح");
      if (availability.status === "outside" && !allowOutsideHours) throw new Error(`${availability.message} — فعّل الحجز خارج الدوام إن كنت متأكدًا`);
      const { data, error } = await supabase.from("appointments").update({
        doctor_id: doctorId,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        clinic_id: clinicId === NONE_VALUE ? null : clinicId,
        priority,
        note: note.trim() || null,
      }).eq("id", appointment.id).eq("organization_id", organizationId)
        .not("status", "in", "(completed,no_show,cancelled_by_patient,cancelled_by_staff)").select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("لم يعد الموعد قابلًا للتعديل");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم تحديث الموعد" });
      onOpenChange(false);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر التحديث", description: error instanceof Error ? error.message : "حدث خطأ" }),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      if (!appointment || !organizationId || !cancellationReason.trim()) throw new Error("اكتب سبب الإلغاء");
      const { data, error } = await supabase.from("appointments").update({
        status: "cancelled_by_staff",
        cancellation_reason: cancellationReason.trim(),
      }).eq("id", appointment.id).eq("organization_id", organizationId)
        .not("status", "in", "(completed,no_show,cancelled_by_patient,cancelled_by_staff)").select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("لم يعد الموعد قابلًا للإلغاء");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم إلغاء الموعد وتسجيل السبب" });
      onOpenChange(false);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر الإلغاء", description: error instanceof Error ? error.message : "حدث خطأ" }),
  });

  return <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>إدارة موعد {appointment?.patient?.name_ar}</DialogTitle>
        <DialogDescription>إعادة الجدولة أو تغيير الطبيب والعيادة والأولوية، مع تسجيل سبب الإلغاء.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div><Label>الطبيب</Label><Select value={doctorId} onValueChange={setDoctorId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{doctors.map((doctor) => <SelectItem key={doctor.id} value={doctor.id}>{doctor.name_ar}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>العيادة</Label><Select value={clinicId} onValueChange={setClinicId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE_VALUE}>بدون</SelectItem>{(clinics.data ?? []).map((clinic) => <SelectItem key={clinic.id} value={clinic.id}>{clinic.name}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
          <div><Label>الوقت</Label><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div>
          <div><Label>المدة</Label><Input type="number" min={5} step={5} value={duration} onChange={(event) => setDuration(event.target.value)} /></div>
        </div>
        <div><Label>الأولوية</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">عادي</SelectItem><SelectItem value="urgent">عاجل</SelectItem><SelectItem value="emergency">طارئ</SelectItem><SelectItem value="elderly">كبار السن</SelectItem><SelectItem value="accessibility">ذوو الإعاقة</SelectItem></SelectContent></Select></div>
        <div><Label>ملاحظة</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></div>
        <label className="flex items-center gap-2 rounded-md border p-2.5 text-sm"><input type="checkbox" checked={allowOutsideHours} onChange={(event) => setAllowOutsideHours(event.target.checked)} />السماح بإعادة الجدولة خارج دوام الطبيب</label>
        <div><Label>سبب الإلغاء</Label><Textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="مطلوب عند إلغاء الموعد" rows={2} /></div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="destructive" disabled={cancel.isPending || !cancellationReason.trim()} onClick={() => cancel.mutate()}><CalendarX className="h-4 w-4" />إلغاء الموعد</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "جارٍ الحفظ..." : "حفظ التعديلات"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CreateAppointmentDialog({
  open,
  onOpenChange,
  organizationId,
  doctors,
  defaultDay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  doctors: { id: string; name_ar: string }[];
  defaultDay: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(defaultDay);
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("30");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  /**
   * العيادة ونوع الزيارة والملاحظة أعمدة في `appointments` منذ 0002 لم تكن
   * النافذة تُدخل أيًا منها — فكان كل موعد يُحجَز بلا عيادة ولا نوع، وهما
   * أساس فرز شاشة الاستقبال وتقارير أنواع الزيارات.
   */
  const [clinicId, setClinicId] = useState(NONE_VALUE);
  const [visitTypeValueId, setVisitTypeValueId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  /**
   * تجاوز الحجز خارج فترات الدوام.
   *
   * الحجب (إجازة/عملية) لا يُتجاوَز — لأنه غياب فعلي لا تفضيل. أما "خارج
   * الدوام" فيُتجاوَز بإقرار صريح: الحالات المستعجلة والمواعيد المتفق عليها
   * هاتفيًا واقع يومي، ومنعها كليًا يدفع الموظف لتعطيل التحقق لا لاحترامه.
   */
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);

  useEffect(() => {
    if (open) setDate(defaultDay);
  }, [defaultDay, open]);

  const clinics = useQuery({
    queryKey: ["appointment-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const createAppointment = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient || !doctorId) throw new Error("أكمل بيانات المريض والطبيب والوقت");
      // حظر المواعيد في ملف المريض كان معروضًا بلا فرض — يُفرض هنا قبل أي كتابة
      await assertPatientNotBlocked(patient.id, "appointments");
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + Number(duration) * 60_000);

      // دوام الطبيب كان مسجَّلًا في `doctor_working_hours` ولا تقرؤه هذه الشاشة
      const availability = await checkDoctorAvailability(doctorId, start, end);
      if (availability.status === "blocked") throw new Error(availability.message ?? "الطبيب غير متاح");
      if (availability.status === "outside" && !allowOutsideHours)
        throw new Error(
          `${availability.message} — فعّل "حجز خارج الدوام" إن كنت متأكدًا`,
        );

      const { error } = await supabase.from("appointments").insert({
        organization_id: organizationId,
        doctor_id: doctorId,
        patient_id: patient.id,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        status: "scheduled",
        clinic_id: clinicId === NONE_VALUE ? null : clinicId,
        visit_type_value_id: visitTypeValueId || null,
        priority,
        note: note.trim() || null,
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      toast({ title: "تم حجز الموعد" });
      setPatient(null);
      setDoctorId("");
      setClinicId(NONE_VALUE);
      setVisitTypeValueId("");
      setPriority("normal");
      setAllowOutsideHours(false);
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حجز الموعد",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حجز موعد جديد</DialogTitle>
            <DialogDescription>حجز مسبق لمريض موجود أو فتح ملف سريع أولًا</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>المريض</Label>
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
              <Label>الطبيب</Label>
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
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label>التاريخ</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>الوقت</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>المدة (دقيقة)</Label>
                <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>العيادة</Label>
                <Select value={clinicId} onValueChange={setClinicId}>
                  <SelectTrigger>
                    <SelectValue placeholder="بدون" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>بدون</SelectItem>
                    {(clinics.data ?? []).map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id}>
                        {clinic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>نوع الزيارة</Label>
                <LookupSelect
                  categoryKey="visit_types"
                  value={visitTypeValueId}
                  onChange={setVisitTypeValueId}
                  placeholder="بدون"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>أولوية الاستقبال</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">عادي</SelectItem>
                  <SelectItem value="urgent">عاجل</SelectItem>
                  <SelectItem value="emergency">طارئ</SelectItem>
                  <SelectItem value="elderly">كبار السن</SelectItem>
                  <SelectItem value="accessibility">ذوو الإعاقة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>ملاحظة الموعد</Label>
                {/* مستهلك `canned_texts` لموضع appointment_note (0009) */}
                <CannedTextPicker
                  locationKey="appointment_note"
                  onInsert={(text) => setNote((prev) => appendCannedText(prev, text))}
                />
              </div>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={allowOutsideHours}
                onChange={(e) => setAllowOutsideHours(e.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span>حجز خارج فترات دوام الطبيب</span>
                <span className="text-xs text-muted-foreground">
                  فترات الحجب (إجازة أو عملية) تبقى ممنوعة ولا يتجاوزها هذا الخيار.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button
              disabled={!patient || !doctorId || createAppointment.isPending}
              onClick={() => createAppointment.mutate()}
            >
              {createAppointment.isPending ? "جارٍ الحجز..." : "حجز الموعد"}
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
