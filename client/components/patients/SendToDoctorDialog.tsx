import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { assertPatientNotBlocked } from "@/lib/patient-blocks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const NONE = "__none__";

/**
 * إرسال المريض إلى الطبيب من ملفه مباشرةً.
 *
 * كان الطريق الوحيد: يفتح الموظف ملف المريض، ثم يذهب إلى شاشة الاستقبال، ثم
 * يبحث عن المريض من جديد ليضيفه إلى الطابور — ثلاث شاشات لعملية واحدة يفعلها
 * عشرات المرّات في اليوم.
 *
 * الإضافة تمرّ بـ`app_add_walk_in` نفسها التي تستعملها شاشة الاستقبال، لا
 * بإدراج موعد مباشر: الدالّة تحجز رقم الطابور بقفل، وتتحقّق من تبعية المريض
 * للمنشأة وتوافر الطبيب للحجز، وتفرض الصلاحية. ونسخُ منطقها هنا كان سيُنتج
 * أرقام طابور مكرّرة عند إضافتَين في اللحظة نفسها.
 */
export default function SendToDoctorDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  organizationId,
  defaultDoctorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  organizationId: string;
  defaultDoctorId?: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [doctorId, setDoctorId] = useState(defaultDoctorId || "");
  const [clinicId, setClinicId] = useState(NONE);
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");

  const doctors = useQuery({
    queryKey: ["send-to-doctor-doctors", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        // نفس شرط الدالّة في القاعدة: طبيب معطَّل أو ممنوع من الحجز لا يُعرض
        // ليُختار ثم يُرفض
        .eq("is_enabled", true)
        .eq("disabled_from_booking", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const clinics = useQuery({
    queryKey: ["send-to-doctor-clinics", organizationId],
    enabled: open && Boolean(organizationId),
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

  const send = useMutation({
    mutationFn: async () => {
      if (!doctorId) throw new Error("اختر الطبيب");
      // حظر المواعيد يُفحَص قبل النداء كما في شاشة الاستقبال والمواعيد
      await assertPatientNotBlocked(patientId, "appointments");
      const { error } = await supabase.rpc("app_add_walk_in", {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_doctor_id: doctorId,
        p_clinic_id: clinicId === NONE ? null : clinicId,
        p_priority: priority,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["patient-appointments", patientId] });
      toast({ title: `أُضيف ${patientName} إلى طابور الطبيب` });
      setNote("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإرسال إلى الطبيب",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إرسال إلى الطبيب</DialogTitle>
          <DialogDescription>
            يُضاف {patientName} إلى طابور اليوم بحالة «في الانتظار»، ويظهر في شاشة الاستقبال وفي رحلة المريض.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الطبيب" />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {doctors.isSuccess && (doctors.data ?? []).length === 0 && (
              <span className="text-xs text-amber-700">لا يوجد طبيب متاح للحجز — راجع إعدادات الأطباء.</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>العيادة</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger>
                <SelectValue placeholder="بدون" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون</SelectItem>
                {(clinics.data ?? []).map((clinic) => (
                  <SelectItem key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>الأولوية</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* نفس قيم قيد `appointments_priority_check` في القاعدة — قيمة
                    غيرها تُرفَض عند الإدراج ولا تُكتشف إلا وقت الحفظ. */}
                <SelectItem value="normal">عادي</SelectItem>
                <SelectItem value="urgent">عاجل</SelectItem>
                <SelectItem value="emergency">طارئ</SelectItem>
                <SelectItem value="elderly">كبار السن</SelectItem>
                <SelectItem value="accessibility">ذوو الإعاقة</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة للطبيب</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!doctorId || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? "جارٍ الإرسال..." : "إرسال إلى الطابور"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
