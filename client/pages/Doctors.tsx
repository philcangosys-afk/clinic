import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Stethoscope, Pencil, CalendarClock, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";

/** الحقول التي يقرأها/يكتبها نموذج الطبيب (إنشاء وتعديل). */
export type DoctorFormRow = {
  id: string;
  name_ar: string;
  name_en: string | null;
  job_title: string | null;
  clinic_id: string | null;
  specialty_value_id: string | null;
  gender: string | null;
  nationality_value_id: string | null;
  id_number: string | null;
  mobile_number: string | null;
  email: string | null;
  birth_date: string | null;
  default_appointment_duration_minutes: number | null;
  consultation_fee_renewal_days: number | null;
  free_reviews_count: number | null;
  patient_waiting_minutes: number | null;
  notes: string | null;
  address: string | null;
  specialty_authority: string | null;
  specialty_authority_number: string | null;
  disabled_from_booking: boolean;
  receive_appointment_confirmation_sms: boolean;
  hide_patient_messages: boolean;
  force_session_selection: boolean;
  is_enabled: boolean;
};

function useDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select(
          "id, file_number, name_ar, name_en, job_title, clinic_id, specialty_value_id, gender, nationality_value_id, id_number, mobile_number, email, birth_date, notes, address, specialty_authority, specialty_authority_number, consultation_fee_renewal_days, free_reviews_count, patient_waiting_minutes, is_enabled, disabled_from_booking, receive_appointment_confirmation_sms, hide_patient_messages, force_session_selection, default_appointment_duration_minutes, clinic:clinics(id, name)",
        )
        // RLS يسمح بكل مؤسسة ينتمي إليها المستخدم لا بالنشطة وحدها —
        // بدون هذا الفلتر تختلط بيانات منشأتين لعضوٍ في كلتيهما.
        .eq("organization_id", organizationId)
        .order("file_number");
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useClinicsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["clinics-select", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id, name")
        // العيادة تُكتب في `doctors.clinic_id` بلا قيد يربطها بنفس المنشأة —
        // فبلا هذا الفلتر يمكن إسناد طبيب منشأة إلى عيادة منشأة أخرى.
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

export default function Doctors() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DoctorFormRow | null>(null);
  const [hoursTarget, setHoursTarget] = useState<{ id: string; name: string } | null>(null);
  const doctors = useDoctors(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { data: affectedRows, error } = await supabase.from("doctors").update({ is_enabled }).eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctors-list"] }),
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر تحديث حالة الطبيب",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الأطباء</h1>
          <p className="text-sm text-muted-foreground">ملفات الأطباء وإعدادات الحجز الخاصة بكل طبيب</p>
        </div>
        <Button onClick={() => {
            setEditing(null);
            setCreateOpen(true);
          }}>
          <Plus className="h-4 w-4" />
          طبيب جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>قائمة الأطباء</CardTitle>
        </CardHeader>
        <CardContent>
          {doctors.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!doctors.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الاسم الإنجليزي</TableHead>
                  <TableHead>العيادة</TableHead>
                  <TableHead>الوظيفة</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>مدة الموعد</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(doctors.data ?? []).map((doctor: any) => (
                  <TableRow key={doctor.id}>
                    <TableCell className="font-mono text-xs">#{doctor.file_number}</TableCell>
                    <TableCell className="font-medium">د. {doctor.name_ar}</TableCell>
                    <TableCell className="text-muted-foreground">{doctor.name_en ?? "—"}</TableCell>
                    <TableCell>{doctor.clinic?.name ?? "—"}</TableCell>
                    <TableCell>{doctor.job_title ?? "—"}</TableCell>
                    <TableCell>{doctor.mobile_number ?? "—"}</TableCell>
                    <TableCell>{doctor.default_appointment_duration_minutes ?? 30} دقيقة</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={doctor.is_enabled ? "success" : "secondary"}>
                          {doctor.is_enabled ? "مفعّل" : "معطّل"}
                        </Badge>
                        {doctor.disabled_from_booking && <Badge variant="warning">محجوب عن الحجز</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="تعديل"
                          onClick={() => {
                            setEditing(doctor as unknown as DoctorFormRow);
                            setCreateOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="أوقات الدوام"
                          onClick={() => setHoursTarget({ id: doctor.id, name: doctor.name_ar })}
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleEnabled.mutate({ id: doctor.id, is_enabled: !doctor.is_enabled })}
                        >
                          {doctor.is_enabled ? "تعطيل" : "تفعيل"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(doctors.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد أطباء مسجّلون بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {createOpen && (
        <NewDoctorDialog
          key={editing?.id ?? "new"}
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) setEditing(null);
          }}
          organizationId={organization?.id}
          initial={editing}
        />
      )}

      {hoursTarget && (
        <WorkingHoursDialog
          doctorId={hoursTarget.id}
          doctorName={hoursTarget.name}
          onClose={() => setHoursTarget(null)}
        />
      )}
    </div>
  );
}

function NewDoctorDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  /** عند تمريره تتحول النافذة لوضع التعديل بدل الإنشاء. */
  initial?: DoctorFormRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const clinics = useClinicsList(organizationId);
  const [nameAr, setNameAr] = useState(initial?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(initial?.name_en ?? "");
  const [jobTitle, setJobTitle] = useState(initial?.job_title ?? "");
  const [clinicId, setClinicId] = useState(initial?.clinic_id ?? "");
  const [specialtyId, setSpecialtyId] = useState(initial?.specialty_value_id ?? "");
  const [gender, setGender] = useState<"male" | "female" | "">((initial?.gender as "male" | "female") ?? "");
  const [nationalityId, setNationalityId] = useState(initial?.nationality_value_id ?? "");
  const [idNumber, setIdNumber] = useState(initial?.id_number ?? "");
  const [mobile, setMobile] = useState(initial?.mobile_number ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [birthDate, setBirthDate] = useState(initial?.birth_date ?? "");
  const [duration, setDuration] = useState(String(initial?.default_appointment_duration_minutes ?? 30));
  const [renewalDays, setRenewalDays] = useState(
    initial?.consultation_fee_renewal_days != null ? String(initial.consultation_fee_renewal_days) : "",
  );
  const [freeReviews, setFreeReviews] = useState(String(initial?.free_reviews_count ?? 0));
  const [waitingMinutes, setWaitingMinutes] = useState(
    initial?.patient_waiting_minutes != null ? String(initial.patient_waiting_minutes) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // حقول كانت في جدول doctors منذ 0002 بلا إدخال في الواجهة (لقطة 4)
  const [address, setAddress] = useState(initial?.address ?? "");
  const [authority, setAuthority] = useState(initial?.specialty_authority ?? "");
  const [authorityNumber, setAuthorityNumber] = useState(initial?.specialty_authority_number ?? "");
  const [disabledFromBooking, setDisabledFromBooking] = useState(Boolean(initial?.disabled_from_booking));
  const [receiveConfirmationSms, setReceiveConfirmationSms] = useState(
    Boolean(initial?.receive_appointment_confirmation_sms),
  );
  const [hidePatientMessages, setHidePatientMessages] = useState(Boolean(initial?.hide_patient_messages));
  const [forceSessionSelection, setForceSessionSelection] = useState(
    Boolean(initial?.force_session_selection),
  );

  const resetForm = () => {
    setNameAr("");
    setNameEn("");
    setJobTitle("");
    setClinicId("");
    setSpecialtyId("");
    setGender("");
    setNationalityId("");
    setIdNumber("");
    setMobile("");
    setEmail("");
    setBirthDate("");
    setDuration("30");
    setRenewalDays("");
    setFreeReviews("0");
    setWaitingMinutes("");
    setNotes("");
    setAddress("");
    setAuthority("");
    setAuthorityNumber("");
    setDisabledFromBooking(false);
    setReceiveConfirmationSms(false);
    setHidePatientMessages(false);
    setForceSessionSelection(false);
  };

  const createDoctor = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const payload = {
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        job_title: jobTitle.trim() || null,
        clinic_id: clinicId || null,
        specialty_value_id: specialtyId || null,
        gender: gender || null,
        nationality_value_id: nationalityId || null,
        id_number: idNumber.trim() || null,
        mobile_number: mobile.trim() || null,
        email: email.trim() || null,
        birth_date: birthDate || null,
        default_appointment_duration_minutes: Number(duration) || 30,
        consultation_fee_renewal_days: renewalDays ? Number(renewalDays) : null,
        free_reviews_count: Number(freeReviews) || 0,
        patient_waiting_minutes: waitingMinutes ? Number(waitingMinutes) : null,
        notes: notes.trim() || null,
        address: address.trim() || null,
        specialty_authority: authority.trim() || null,
        specialty_authority_number: authorityNumber.trim() || null,
        disabled_from_booking: disabledFromBooking,
        receive_appointment_confirmation_sms: receiveConfirmationSms,
        hide_patient_messages: hidePatientMessages,
        force_session_selection: forceSessionSelection,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase
          .from("doctors")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("doctors").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctors-list"] });
      queryClient.invalidateQueries({ queryKey: ["doctors-enabled"] });
      toast({ title: initial ? "تم تحديث ملف الطبيب" : "تم حفظ ملف الطبيب" });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر حفظ الطبيب",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>طبيب جديد</DialogTitle>
          <DialogDescription>التخصص يحدّد قالب الفحص الافتراضي في السجل الطبي</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>اسم الطبيب بالعربية *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>اسم الطبيب بالإنجليزية</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المسمى الوظيفي</Label>
            <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="استشاري، أخصائي..." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>العيادة</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر عيادة" />
              </SelectTrigger>
              <SelectContent>
                {(clinics.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التخصص</Label>
            <LookupSelect categoryKey="medical_specialties" value={specialtyId} onChange={setSpecialtyId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنس</Label>
            <Select value={gender} onValueChange={(value) => setGender(value as "male" | "female")}>
              <SelectTrigger>
                <SelectValue placeholder="اختر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">ذكر</SelectItem>
                <SelectItem value="female">أنثى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الجنسية</Label>
            <LookupSelect categoryKey="nationalities" value={nationalityId} onChange={setNationalityId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الهوية/الإقامة</Label>
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الجوال</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البريد الإلكتروني</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الميلاد</Label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مدة الموعد الافتراضية (دقيقة)</Label>
            <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>أيام تجديد الكشفية (اتركها فارغة لاعتماد إعداد المؤسسة)</Label>
            <Input type="number" min={1} value={renewalDays} onChange={(e) => setRenewalDays(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>عدد المراجعات المجانية</Label>
            <Input type="number" min={0} value={freeReviews} onChange={(e) => setFreeReviews(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مدة انتظار المريض (دقيقة)</Label>
            <Input type="number" min={0} value={waitingMinutes} onChange={(e) => setWaitingMinutes(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>العنوان</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الهيئة المانحة للتخصص</Label>
            <Input value={authority} onChange={(e) => setAuthority(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم التصنيف بالهيئة</Label>
            <Input value={authorityNumber} onChange={(e) => setAuthorityNumber(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2 rounded-lg border p-3 sm:col-span-2">
            <p className="text-sm font-semibold">إعدادات الحجز والرسائل</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={disabledFromBooking}
                onChange={(e) => setDisabledFromBooking(e.target.checked)}
                className="h-4 w-4"
              />
              محجوب عن الحجز (لا تظهر له مواعيد جديدة)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={receiveConfirmationSms}
                onChange={(e) => setReceiveConfirmationSms(e.target.checked)}
                className="h-4 w-4"
              />
              يستلم رسالة تأكيد المواعيد
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hidePatientMessages}
                onChange={(e) => setHidePatientMessages(e.target.checked)}
                className="h-4 w-4"
              />
              حجب المرضى عن رسائل المواعيد
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={forceSessionSelection}
                onChange={(e) => setForceSessionSelection(e.target.checked)}
                className="h-4 w-4"
              />
              فرض اختيار جلسة عند الحجز
            </label>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!nameAr.trim() || createDoctor.isPending} onClick={() => createDoctor.mutate()}>
            <Stethoscope className="h-4 w-4" />
            {createDoctor.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// أوقات دوام الطبيب (لقطة 5) — جدول doctor_working_hours كان موجودًا منذ 0002
// بلا أي واجهة، فلم يكن ممكنًا تحديد أوقات عمل طبيب أو حجب فترة من جدوله
// ---------------------------------------------------------------------------

type WorkingHourRow = {
  id: string;
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  is_blocked: boolean;
};


function WorkingHoursDialog({
  doctorId,
  doctorName,
  onClose,
}: {
  doctorId: string;
  doctorName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [isBlocked, setIsBlocked] = useState(false);

  const hours = useQuery({
    queryKey: ["doctor-working-hours", doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctor_working_hours")
        .select("*")
        .eq("doctor_id", doctorId)
        .order("starts_at");
      if (error) throw error;
      return (data ?? []) as WorkingHourRow[];
    },
  });

  const addSlot = useMutation({
    mutationFn: async () => {
      if (!startsAt || !endsAt) throw new Error("حدّد وقت البداية والنهاية");
      if (new Date(startsAt) >= new Date(endsAt))
        throw new Error("وقت البداية يجب أن يسبق وقت النهاية");
      // التداخل مع فترة قائمة يُرفض هنا لا في القاعدة، لأن الجدول يسمح به
      // تقنيًا — وفترتا عمل متداخلتان تُربكان حساب المواعيد المتاحة.
      const overlapping = (hours.data ?? []).some(
        (row) => new Date(startsAt) < new Date(row.ends_at) && new Date(endsAt) > new Date(row.starts_at),
      );
      if (overlapping) throw new Error("هذه الفترة تتداخل مع فترة مسجَّلة بالفعل");

      const { error } = await supabase.from("doctor_working_hours").insert({
        doctor_id: doctorId,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        note: note.trim() || null,
        is_blocked: isBlocked,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-working-hours", doctorId] });
      toast({ title: "تمت إضافة الفترة" });
      setNote("");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const removeSlot = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("doctor_working_hours").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["doctor-working-hours", doctorId] }),
  });

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>أوقات الدوام — د. {doctorName}</DialogTitle>
          <DialogDescription>
            فترات العمل تحدد المواعيد المتاحة للحجز، وفترات الحجب تمنع الحجز فيها (إجازة، اجتماع، عملية)
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>من *</Label>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>إلى *</Label>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>ملاحظة</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isBlocked}
              onChange={(e) => setIsBlocked(e.target.checked)}
              className="h-4 w-4"
            />
            فترة حجب (غير متاحة للحجز)
          </label>
          <Button className="self-start" disabled={addSlot.isPending} onClick={() => addSlot.mutate()}>
            <Plus className="h-4 w-4" />
            إضافة فترة
          </Button>
        </div>

        {hours.isLoading && <Skeleton className="h-32 w-full" />}
        {!hours.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>من</TableHead>
                <TableHead>إلى</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>ملاحظة</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(hours.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs">
                    {new Date(row.starts_at).toLocaleString("ar-SA")}
                  </TableCell>
                  <TableCell className="text-xs">{new Date(row.ends_at).toLocaleString("ar-SA")}</TableCell>
                  <TableCell>
                    <Badge variant={row.is_blocked ? "destructive" : "success"}>
                      {row.is_blocked ? "محجوبة" : "عمل"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[10rem] truncate text-sm text-muted-foreground">
                    {row.note ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => removeSlot.mutate(row.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(hours.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد فترات دوام مسجَّلة لهذا الطبيب.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
