import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  LogIn,
  LogOut,
  Megaphone,
  Plus,
  UserX,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { AppointmentStatus, AppointmentWithRelations } from "@/lib/database.types";
import { statusBadgeClass, statusLabel } from "@/lib/appointment-status";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
          "id, scheduled_start, scheduled_end, status, checked_in_1_at, called_at, entered_at, left_at, note, doctor_id, patient_id, clinic_id, patient:patients(id, name_ar, mobile_number, file_number), doctor:doctors(id, name_ar), clinic:clinics(id, name)",
        )
        .gte("scheduled_start", startOfTodayIso())
        .lte("scheduled_start", endOfTodayIso())
        .order("scheduled_start", { ascending: true });
      if (doctorFilter !== "all") query = query.eq("doctor_id", doctorFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as AppointmentWithRelations[];
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
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function Reception() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);

  const queue = useTodayQueue(organization?.id, doctorFilter);
  const doctors = useDoctorsList(organization?.id);

  const grouped = useMemo(() => {
    const rows = queue.data ?? [];
    const active = rows.filter((row) => ACTIVE_STATUSES.includes(row.status));
    const done = rows.filter((row) => !ACTIVE_STATUSES.includes(row.status));
    return { active, done };
  }, [queue.data]);

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      timestampField,
    }: {
      id: string;
      status: AppointmentStatus;
      timestampField?: "checked_in_1_at" | "called_at" | "entered_at" | "left_at";
    }) => {
      const patch: Record<string, unknown> = { status };
      if (timestampField) patch[timestampField] = new Date().toISOString();
      const { error } = await supabase.from("appointments").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reception-queue"] }),
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
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            إضافة للطابور
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>قيد الانتظار الآن ({grouped.active.length})</CardTitle>
          <CardDescription>بالترتيب الزمني حسب وقت الموعد المجدول</CardDescription>
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
              onUpdate={(status, timestampField) =>
                updateStatus.mutate({ id: appointment.id, status, timestampField })
              }
            />
          ))}
        </CardContent>
      </Card>

      {grouped.done.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>منتهية اليوم ({grouped.done.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {grouped.done.map((appointment) => (
              <QueueRow
                key={appointment.id}
                appointment={appointment}
                onUpdate={(status, timestampField) =>
                  updateStatus.mutate({ id: appointment.id, status, timestampField })
                }
                readOnly
              />
            ))}
          </CardContent>
        </Card>
      )}

      <AddToQueueDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        organizationId={organization?.id}
        doctors={doctors.data ?? []}
      />
    </div>
  );
}

function QueueRow({
  appointment,
  onUpdate,
  readOnly,
}: {
  appointment: AppointmentWithRelations;
  onUpdate: (status: AppointmentStatus, timestampField?: "checked_in_1_at" | "called_at" | "entered_at" | "left_at") => void;
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
        <p className="text-sm font-semibold">{appointment.patient?.name_ar ?? "—"}</p>
        <p className="text-xs text-muted-foreground">
          #{appointment.patient?.file_number} · {appointment.patient?.mobile_number ?? "—"}
        </p>
      </div>
      <div className="min-w-[8rem] text-sm text-muted-foreground">د. {appointment.doctor?.name_ar ?? "—"}</div>
      <Badge className={statusBadgeClass(appointment.status)}>{statusLabel(appointment.status)}</Badge>
      {!readOnly && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => onUpdate("arrived", "checked_in_1_at")}>
            <LogIn className="h-3.5 w-3.5" />
            حضر
          </Button>
          <Button size="sm" variant="outline" onClick={() => onUpdate("called", "called_at")}>
            <Megaphone className="h-3.5 w-3.5" />
            نداء
          </Button>
          <Button size="sm" variant="outline" onClick={() => onUpdate("in_progress", "entered_at")}>
            دخول
          </Button>
          <Button size="sm" variant="outline" onClick={() => onUpdate("completed", "left_at")}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            إنهاء
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onUpdate("no_show")}>
            <UserX className="h-3.5 w-3.5" />
            لم يحضر
          </Button>
        </div>
      )}
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
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const createAppointment = useMutation({
    mutationFn: async () => {
      if (!organizationId || !patient || !doctorId) throw new Error("أكمل بيانات المريض والطبيب");
      const now = new Date();
      const { error } = await supabase.from("appointments").insert({
        organization_id: organizationId,
        doctor_id: doctorId,
        patient_id: patient.id,
        scheduled_start: now.toISOString(),
        scheduled_end: new Date(now.getTime() + 30 * 60_000).toISOString(),
        status: "waiting",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      toast({ title: "تمت الإضافة إلى الطابور" });
      setPatient(null);
      setDoctorId("");
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
