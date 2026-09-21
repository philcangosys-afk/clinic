import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Check, RefreshCw, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { checkDoctorAvailability } from "@/lib/doctor-availability";
import type { AppointmentWaitlistRow, WaitlistStatus } from "@/lib/database.types";
import { PatientSearchInput } from "@/components/shared/PatientSearchInput";
import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";
import { matchesPatientSearch, type PatientSearchScope } from "@/lib/patient-search";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import PatientPicker from "@/components/shared/PatientPicker";
import LookupSelect from "@/components/shared/LookupSelect";
import { errorMessage } from "@/lib/error-message";
import { formatDate, useLocaleSettings } from "@/lib/locale";

/**
 * قوائم الانتظار (لقطة 102).
 *
 * جدول `appointment_waitlist` موجود منذ 0002 بحالاته الثلاث
 * (waiting/booked/cancelled) لكنه لم يُستخدم في أي شاشة إطلاقًا — الميزة
 * كانت بنية بيانات بلا واجهة. تسجّل هذه الشاشة المريض في قائمة انتظار طبيب
 * أو تخصص، ثم تُحوّله إلى موعد فعلي عند توفر شاغر.
 */
const STATUS_LABELS: Record<WaitlistStatus, string> = {
  waiting: "بالانتظار",
  booked: "تم الحجز",
  cancelled: "ملغاة",
};
const STATUS_BADGE: Record<WaitlistStatus, "warning" | "success" | "secondary"> = {
  waiting: "warning",
  booked: "success",
  cancelled: "secondary",
};
const ANY_DOCTOR = "__any__";

/**
 * الأولوية والتاريخ المرغوب كانا يُحفظان ولا يُعرضان.
 *
 * الموظف يختار «طارئ» ويحدّد تاريخًا، ثم يرى صفوفًا متشابهة مرتَّبة بالأقدمية
 * وحدها — فيتعذّر معرفة مَن يُقدَّم عند توفّر شاغر إلا بفتح كل صفّ. الترتيب
 * هنا بالأولوية ثم الأقدمية، كترتيب طابور الاستقبال نفسه، حتى لا يكون لنفس
 * السؤال جوابان في شاشتين.
 */
const PRIORITY_ORDER: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  accessibility: 2,
  elderly: 3,
  normal: 4,
};

const PRIORITY_LABELS: Record<string, string> = {
  emergency: "طارئ",
  urgent: "عاجل",
  accessibility: "ذوو الإعاقة",
  elderly: "كبار السن",
  normal: "عادي",
};

type WaitlistRowJoined = AppointmentWaitlistRow & {
  patient: { id: string; name_ar: string; file_number: number | null; mobile_number: string | null } | null;
  doctor: { id: string; name_ar: string } | null;
};

function useWaitlist(organizationId: string | undefined, status: string) {
  return useQuery({
    queryKey: ["waitlist", organizationId, status],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("appointment_waitlist")
        .select(
          "*, patient:patients!waitlist_patient_tenant_fk(id, name_ar, file_number, mobile_number, id_number, phone_1), doctor:doctors!waitlist_doctor_tenant_fk(id, name_ar)",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as unknown as WaitlistRowJoined[];
      // الترتيب بالأولوية يجري بعد الجلب: قيم `priority` نصّية، وترتيبها في
      // القاعدة أبجديٌّ يضع «عادي» قبل «طارئ».
      return [...rows].sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority ?? "normal"] ?? 4) - (PRIORITY_ORDER[b.priority ?? "normal"] ?? 4) ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    },
  });
}

function useDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-waitlist", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        // عمود التفعيل في `doctors` اسمه `is_enabled` لا `is_disabled` (0002).
        // الاستعلام القديم كان يفشل كليًا فتبقى قائمة الأطباء فارغة دائمًا.
        .eq("is_enabled", true)
        .eq("disabled_from_booking", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });
}

function AddToWaitlistDialog({
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
  const { session } = useOrganizationAccess();
  const doctors = useDoctors(organizationId);
  const [patient, setPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [doctorId, setDoctorId] = useState(ANY_DOCTOR);
  const [specialtyId, setSpecialtyId] = useState("");
  const [desiredDate, setDesiredDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!patient) throw new Error("اختر المريض أولًا");
      const { error } = await supabase.from("appointment_waitlist").insert({
        organization_id: organizationId,
        patient_id: patient.id,
        doctor_id: doctorId === ANY_DOCTOR ? null : doctorId,
        specialty_value_id: specialtyId || null,
        registration_note: note.trim() || null,
        desired_date: desiredDate || null,
        priority,
        status: "waiting" as const,
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      toast({ title: "تمت إضافة المريض لقائمة انتظار المواعيد" });
      setPatient(null);
      setDoctorId(ANY_DOCTOR);
      setSpecialtyId("");
      setDesiredDate("");
      setPriority("normal");
      setNote("");
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة لقائمة انتظار المواعيد</DialogTitle>
          <DialogDescription>
            يُسجَّل المريض بانتظار شاغر لدى طبيب معيّن أو ضمن تخصص، ويمكن تحويله لموعد لاحقًا
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>المريض *</Label>
            {patient ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                <span className="text-sm font-medium">{patient.name_ar}</span>
                <Button variant="ghost" size="sm" onClick={() => setPatient(null)}>
                  تغيير
                </Button>
              </div>
            ) : (
              <PatientPicker onSelect={(row) => setPatient({ id: row.id, name_ar: row.name_ar })} />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب المطلوب</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="أي طبيب" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_DOCTOR}>أي طبيب</SelectItem>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التخصص</Label>
            <LookupSelect
              categoryKey="medical_specialties"
              value={specialtyId}
              onChange={setSpecialtyId}
              placeholder="اختياري"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5"><Label>التاريخ المرغوب</Label><Input type="date" value={desiredDate} onChange={(event) => setDesiredDate(event.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label>الأولوية</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="normal">عادي</SelectItem><SelectItem value="urgent">عاجل</SelectItem><SelectItem value="emergency">طارئ</SelectItem><SelectItem value="elderly">كبار السن</SelectItem><SelectItem value="accessibility">ذوو الإعاقة</SelectItem></SelectContent></Select></div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة التسجيل</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "إضافة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Waitlist() {
  const { calendarDisplay } = useLocaleSettings();
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState("waiting");
  const [search, setSearch] = useState("");
  const [searchScopes, setSearchScopes] = useState<PatientSearchScope[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<WaitlistRowJoined | null>(null);
  const canManageWaitlist = legacyMode || ["owner", "organization_admin", "branch_manager", "receptionist"].includes(membership?.role_key ?? "");
  const list = useWaitlist(organization?.id, status);

  const setRowStatus = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: WaitlistStatus }) => {
      const { data: affectedRows, error } = await supabase.from("appointment_waitlist").update({ status: next }).eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      toast({ title: "تم تحديث الحالة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  // الترشيح مرّة واحدة: الشبكة والعدّاد يقرآن القائمة نفسها فلا يختلفان
  const visibleWaitlist = (list.data ?? []).filter((row) =>
    matchesPatientSearch(row.patient, search, searchScopes),
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">قائمة انتظار المواعيد</h1>
          <p className="text-sm text-muted-foreground">
            مرضى يريدون موعدًا ولم يجدوا وقتًا — يُحوَّلون إلى مواعيد عند توفّر شاغر. ليست طابور
            اليوم: من حضر اليوم مكانه «الاستقبال».
          </p>
        </div>
      </div>

      <ScreenToolbar
        items={[
          {
            key: "new",
            label: "إضافة للانتظار",
            icon: Plus,
            hidden: !canManageWaitlist,
            onClick: () => setAddOpen(true),
          },
          { key: "sep1", separator: true },
          { key: "refresh", label: "تحديث", icon: RefreshCw, onClick: () => void list.refetch() },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={status} onValueChange={setStatus}>
          <TabsList>
            <TabsTrigger value="waiting">بالانتظار</TabsTrigger>
            <TabsTrigger value="booked">تم الحجز</TabsTrigger>
            <TabsTrigger value="cancelled">ملغاة</TabsTrigger>
            <TabsTrigger value="all">الكل</TabsTrigger>
          </TabsList>
        </Tabs>
        <PatientSearchInput
          value={search}
          onChange={setSearch}
          scopes={searchScopes}
          onScopesChange={setSearchScopes}
          className="w-full sm:w-auto"
          inputClassName="sm:w-64"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            القائمة
          </CardTitle>
          <CardDescription>مرتَّبة بالأولوية ثم أسبقية التسجيل — كترتيب طابور الاستقبال</CardDescription>
        </CardHeader>
        <CardContent>
          {list.isLoading && <Skeleton className="h-40 w-full" />}
          {!list.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المريض</TableHead>
                  <TableHead>رقم الملف</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>الطبيب المطلوب</TableHead>
                  <TableHead>الأولوية</TableHead>
                  <TableHead>التاريخ المرغوب</TableHead>
                  <TableHead>تاريخ التسجيل</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-28">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleWaitlist.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.patient?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.patient?.file_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.patient?.mobile_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.doctor?.name_ar ?? "أي طبيب"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.priority === "emergency"
                            ? "destructive"
                            : row.priority && row.priority !== "normal"
                              ? "warning"
                              : "outline"
                        }
                      >
                        {PRIORITY_LABELS[row.priority ?? "normal"] ?? row.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {formatDate(row.desired_date, calendarDisplay)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(row.created_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {row.registration_note ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      {canManageWaitlist && row.status === "waiting" && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="تم حجز موعد له"
                            onClick={() => setConvertTarget(row)}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="إلغاء"
                            onClick={() => setRowStatus.mutate({ id: row.id, next: "cancelled" })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(list.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد مرضى في هذه القائمة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!list.isLoading && <GridFooterCount count={visibleWaitlist.length} />}
      </Card>

      {addOpen && (
        <AddToWaitlistDialog open={addOpen} onOpenChange={setAddOpen} organizationId={organization?.id} />
      )}
      <ConvertWaitlistDialog target={convertTarget} onOpenChange={(open) => { if (!open) setConvertTarget(null); }} organizationId={organization?.id} />
    </div>
  );
}

function ConvertWaitlistDialog({
  target,
  onOpenChange,
  organizationId,
}: {
  target: WaitlistRowJoined | null;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const doctors = useDoctors(organizationId);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("30");
  const [clinicId, setClinicId] = useState("none");
  const [visitTypeId, setVisitTypeId] = useState("");
  const [note, setNote] = useState("");
  /* التجاوز يُعاد إلى مغلق مع كل طلب: خيارٌ يبقى مفعَّلًا من تحويلٍ سابق
     يتجاوز الدوام في التالي بلا أن ينتبه أحد. */
  const [allowOutsideHours, setAllowOutsideHours] = useState(false);

  const clinics = useQuery({
    queryKey: ["waitlist-clinics", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.from("clinics").select("id, name")
        .eq("organization_id", organizationId).eq("is_disabled", false).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  useEffect(() => {
    if (!target) return;
    setDoctorId(target.doctor_id ?? "");
    setDate(target.desired_date ?? new Date().toLocaleDateString("en-CA"));
    setNote(target.registration_note ?? "");
    setAllowOutsideHours(false);
  }, [target]);

  const convert = useMutation({
    mutationFn: async () => {
      if (!target || !doctorId || !date || !time) throw new Error("أكمل الطبيب والتاريخ والوقت");
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + Number(duration) * 60_000);
      const availability = await checkDoctorAvailability(doctorId, start, end);
      if (availability.status === "blocked") throw new Error(availability.message ?? "الطبيب غير متاح");
      /* الخروج عن الدوام تحذيرٌ يُتجاوَز صراحةً، كما في شاشة المواعيد.
         كانت هذه الشاشة تمنع منعًا، فالشاشتان تحكمان على الحالة نفسها
         حكمَين مختلفَين: يُحجَز الموعد من المواعيد ويُرفض من الانتظار. */
      if (availability.status === "outside" && !allowOutsideHours)
        throw new Error(
          `${availability.message ?? "الموعد خارج دوام الطبيب"} — فعّل "حجز خارج الدوام" إن كنت متأكدًا`,
        );
      const { error } = await supabase.rpc("app_convert_waitlist_to_appointment", {
        p_waitlist_id: target.id,
        p_doctor_id: doctorId,
        p_scheduled_start: start.toISOString(),
        p_scheduled_end: end.toISOString(),
        p_clinic_id: clinicId === "none" ? null : clinicId,
        p_visit_type_value_id: visitTypeId || null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      queryClient.invalidateQueries({ queryKey: ["appointments-day"] });
      toast({ title: "تم إنشاء الموعد وربطه بطلب الانتظار" });
      onOpenChange(false);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذر إنشاء الموعد", description: errorMessage(error, "حدث خطأ") }),
  });

  return <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>تحويل إلى موعد</DialogTitle><DialogDescription>سيُنشأ موعد فعلي للمريض {target?.patient?.name_ar} ويُربط بطلب الانتظار.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div><Label>الطبيب *</Label><Select value={doctorId} onValueChange={setDoctorId}><SelectTrigger><SelectValue placeholder="اختر الطبيب" /></SelectTrigger><SelectContent>{(doctors.data ?? []).map((doctor) => <SelectItem key={doctor.id} value={doctor.id}>{doctor.name_ar}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid grid-cols-3 gap-2"><div><Label>التاريخ</Label><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div><div><Label>الوقت</Label><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div><div><Label>المدة</Label><Input type="number" min={5} step={5} value={duration} onChange={(event) => setDuration(event.target.value)} /></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>العيادة</Label><Select value={clinicId} onValueChange={setClinicId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">بدون</SelectItem>{(clinics.data ?? []).map((clinic) => <SelectItem key={clinic.id} value={clinic.id}>{clinic.name}</SelectItem>)}</SelectContent></Select></div><div><Label>نوع الزيارة</Label><LookupSelect categoryKey="visit_types" value={visitTypeId} onChange={setVisitTypeId} placeholder="بدون" /></div></div>
        <div><Label>ملاحظة الموعد</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></div>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={allowOutsideHours}
            onChange={(event) => setAllowOutsideHours(event.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span>حجز خارج فترات دوام الطبيب</span>
            <span className="text-xs text-muted-foreground">
              فترات الحجب (إجازة أو عملية) تبقى ممنوعة ولا يتجاوزها هذا الخيار.
            </span>
          </span>
        </label>
      </div>
      <DialogFooter><Button disabled={convert.isPending || !doctorId || !date} onClick={() => convert.mutate()}>{convert.isPending ? "جارٍ إنشاء الموعد..." : "إنشاء الموعد"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
