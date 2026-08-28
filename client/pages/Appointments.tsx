import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import { checkDoctorAvailability } from "@/lib/doctor-availability";
import type { AppointmentWithRelations } from "@/lib/database.types";
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
          "id, scheduled_start, scheduled_end, status, doctor_id, patient_id, patient:patients(id, name_ar, mobile_number, file_number), doctor:doctors(id, name_ar)",
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
  const { organization } = useOrganizationAccess();
  const [day, setDay] = useState(() => toDateInputValue(new Date()));
  const [createOpen, setCreateOpen] = useState(false);
  const doctors = useDoctorsList(organization?.id);
  const appointments = useDayAppointments(organization?.id, day);

  const byDoctor = useMemo(() => {
    const map = new Map<string, AppointmentWithRelations[]>();
    (doctors.data ?? []).forEach((doctor) => map.set(doctor.id, []));
    (appointments.data ?? []).forEach((appointment) => {
      const list = map.get(appointment.doctor_id) ?? [];
      list.push(appointment);
      map.set(appointment.doctor_id, list);
    });
    return map;
  }, [doctors.data, appointments.data]);

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
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            موعد جديد
          </Button>
        </div>
      </div>

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
                    <div key={appointment.id} className="flex items-center justify-between rounded-lg border px-2.5 py-2">
                      <div>
                        <p className="text-sm font-medium">{appointment.patient?.name_ar}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(appointment.scheduled_start).toLocaleTimeString("ar-SA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
  const [note, setNote] = useState("");
  /**
   * تجاوز الحجز خارج فترات الدوام.
   *
   * الحجب (إجازة/عملية) لا يُتجاوَز — لأنه غياب فعلي لا تفضيل. أما "خارج
   * الدوام" فيُتجاوَز بإقرار صريح: الحالات المستعجلة والمواعيد المتفق عليها
   * هاتفيًا واقع يومي، ومنعها كليًا يدفع الموظف لتعطيل التحقق لا لاحترامه.
   */
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);

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
        note: note.trim() || null,
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
