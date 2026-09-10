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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import LookupSelect from "@/components/shared/LookupSelect";
import { printHtml } from "@/lib/document-merge";
import { formatDateTime, useLocaleSettings } from "@/lib/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const NONE = "__none__";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * إرسال المريض إلى الطبيب من ملفه مباشرةً.
 *
 * كان الطريق الوحيد: يفتح الموظف ملف المريض، ثم يذهب إلى شاشة الاستقبال، ثم
 * يبحث عن المريض من جديد ليضيفه إلى الطابور — ثلاث شاشات لعملية واحدة يفعلها
 * عشرات المرّات في اليوم.
 *
 * الإضافة تمرّ بـ`app_send_patient_to_doctor` (0154) التي تغلّف
 * `app_add_walk_in` نفسها التي تستعملها شاشة الاستقبال، لا بإدراج موعد مباشر:
 * الدالّة تحجز رقم الطابور بقفل، وتتحقّق من تبعية المريض للمنشأة وتوافر
 * الطبيب للحجز، وتفرض الصلاحية. ونسخُ منطقها هنا كان سيُنتج أرقام طابور
 * مكرّرة عند إضافتَين في اللحظة نفسها.
 *
 * وتُضيف الغلافة ثلاثة نواقص كانت تفصلنا عن النظام المرجعيّ:
 *
 * - **نوع الزيارة والمدّة المتوقّعة**: شاشة الدور تُلوّن الصفّ وتُحصي بنوع
 *   الزيارة (كشفية/مراجعة)، ولم يكن يُسأل عنه عند الإرسال إطلاقًا.
 * - **المرسِل**: من أرسل المريض إلى الطبيب. بدونه لا يُعرف مصدر ازدحام عيادة.
 * - **فحص فاتورة الكشفية**: يُمنع الإرسال قبل أن تُفتَح فاتورة كشفية أو
 *   مراجعة اليوم، ويبقى التجاوز صريحًا بخانةٍ يضغطها الموظّف — لا صامتًا.
 *   ولا فحص أصلًا في منشأةٍ لم تُعرِّف قواعد كشفية بعد.
 *
 * و**كرت الانتظار** يُطبع برقم الدور بعد الإرسال، إلّا أن يُلغيه الموظّف.
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
  const [visitTypeId, setVisitTypeId] = useState("");
  const [duration, setDuration] = useState("");
  /* الخياران يُعادان إلى وضعهما الافتراضيّ مع كل فتح: تجاوزٌ بقي مفعَّلًا من
     مريضٍ سابق يُدخل التالي بلا فاتورة بلا أن ينتبه أحد. */
  const [skipConsultationCheck, setSkipConsultationCheck] = useState(false);
  const [skipCard, setSkipCard] = useState(false);
  const { calendarDisplay } = useLocaleSettings();

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
      const minutes = Number(duration);
      const { data, error } = await supabase.rpc("app_send_patient_to_doctor", {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_doctor_id: doctorId,
        p_clinic_id: clinicId === NONE ? null : clinicId,
        p_priority: priority,
        p_note: note.trim() || null,
        p_visit_type_value_id: visitTypeId || null,
        p_expected_duration_minutes:
          duration.trim() && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null,
        p_skip_consultation_check: skipConsultationCheck,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { appointment_id: string; queue_number: number | null }
        | undefined;
      return row ?? null;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["reception-queue"] });
      queryClient.invalidateQueries({ queryKey: ["patient-appointments", patientId] });
      toast({
        title: `أُضيف ${patientName} إلى طابور الطبيب`,
        description: row?.queue_number ? `رقم الدور: ${row.queue_number}` : undefined,
      });
      if (!skipCard && row?.queue_number) {
        const doctorName =
          (doctors.data ?? []).find((doctor) => doctor.id === doctorId)?.name_ar ?? "";
        const clinicName =
          clinicId === NONE
            ? ""
            : ((clinics.data ?? []).find((clinic) => clinic.id === clinicId)?.name ?? "");
        printHtml(
          "كرت الانتظار",
          `<div style="text-align:center">
             <h3>${escapeHtml(patientName)}</h3>
             <p style="font-size:64px;margin:0;font-weight:700">${row.queue_number}</p>
             <p>${escapeHtml(doctorName)}${clinicName ? ` — ${escapeHtml(clinicName)}` : ""}</p>
             <p>${escapeHtml(formatDateTime(new Date(), calendarDisplay))}</p>
           </div>`,
          "thermal80",
        );
      }
      setNote("");
      setDuration("");
      setVisitTypeId("");
      setSkipConsultationCheck(false);
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>نوع الزيارة</Label>
              <LookupSelect
                categoryKey="visit_types"
                value={visitTypeId}
                onChange={setVisitTypeId}
                placeholder="بدون"
                allowClear
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المدّة المتوقّعة (دقيقة)</Label>
              <Input
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                placeholder="اختياري"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة للطبيب</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={skipConsultationCheck}
              onChange={(event) => setSkipConsultationCheck(event.target.checked)}
            />
            <span className="flex flex-col gap-0.5">
              <span>عدم التحقق من فاتورة الكشفية أو المراجعة</span>
              <span className="text-xs text-muted-foreground">
                الأصل أن تُفتَح للمريض فاتورة كشفية أو مراجعة اليوم قبل دخوله على الطبيب.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={skipCard}
              onChange={(event) => setSkipCard(event.target.checked)}
            />
            <span>عدم طباعة كرت الانتظار للمريض</span>
          </label>
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
