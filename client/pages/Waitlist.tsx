import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Check, X } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { AppointmentWaitlistRow, WaitlistStatus } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
          "*, patient:patients(id, name_ar, file_number, mobile_number), doctor:doctors(id, name_ar)",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as WaitlistRowJoined[];
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
        status: "waiting" as const,
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      toast({ title: "تمت إضافة المريض لقائمة الانتظار" });
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة لقائمة الانتظار</DialogTitle>
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
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState("waiting");
  const [addOpen, setAddOpen] = useState(false);
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">قوائم الانتظار</h1>
          <p className="text-sm text-muted-foreground">
            مرضى بانتظار شاغر — يُحوَّلون إلى مواعيد عند توفر وقت لدى الطبيب
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          إضافة للانتظار
        </Button>
      </div>

      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          <TabsTrigger value="waiting">بالانتظار</TabsTrigger>
          <TabsTrigger value="booked">تم الحجز</TabsTrigger>
          <TabsTrigger value="cancelled">ملغاة</TabsTrigger>
          <TabsTrigger value="all">الكل</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            القائمة
          </CardTitle>
          <CardDescription>مرتَّبة حسب أسبقية التسجيل — الأقدم أولًا</CardDescription>
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
                  <TableHead>تاريخ التسجيل</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-28">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.patient?.name_ar ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.patient?.file_number ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.patient?.mobile_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.doctor?.name_ar ?? "أي طبيب"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {row.registration_note ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.status === "waiting" && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="تم حجز موعد له"
                            onClick={() => setRowStatus.mutate({ id: row.id, next: "booked" })}
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
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد مرضى في هذه القائمة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {addOpen && (
        <AddToWaitlistDialog open={addOpen} onOpenChange={setAddOpen} organizationId={organization?.id} />
      )}
    </div>
  );
}
