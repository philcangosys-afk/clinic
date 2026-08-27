import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Stethoscope } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { DoctorRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

function useDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["doctors-list", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select(
          "id, file_number, name_ar, name_en, job_title, mobile_number, is_enabled, disabled_from_booking, default_appointment_duration_minutes, clinic:clinics(id, name)",
        )
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
      const { data, error } = await supabase.from("clinics").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

export default function Doctors() {
  const { organization } = useOrganizationAccess();
  const [createOpen, setCreateOpen] = useState(false);
  const doctors = useDoctors(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { error } = await supabase.from("doctors").update({ is_enabled }).eq("id", id);
      if (error) throw error;
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
        <Button onClick={() => setCreateOpen(true)}>
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleEnabled.mutate({ id: doctor.id, is_enabled: !doctor.is_enabled })}
                      >
                        {doctor.is_enabled ? "تعطيل" : "تفعيل"}
                      </Button>
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

      <NewDoctorDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </div>
  );
}

function NewDoctorDialog({
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
  const clinics = useClinicsList(organizationId);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [nationalityId, setNationalityId] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [duration, setDuration] = useState("30");
  const [renewalDays, setRenewalDays] = useState("");
  const [freeReviews, setFreeReviews] = useState("0");
  const [waitingMinutes, setWaitingMinutes] = useState("");
  const [notes, setNotes] = useState("");

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
  };

  const createDoctor = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.from("doctors").insert({
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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctors-list"] });
      queryClient.invalidateQueries({ queryKey: ["doctors-enabled"] });
      toast({ title: "تم حفظ ملف الطبيب" });
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
