import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { NO_DOCTOR, useSessionDoctor } from "@/lib/session-doctor";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * تحويل المريض إلى طبيب آخر (0223).
 *
 * طلب المالك: «ميزة تسمح لطبيب بتحويل المريض إلى طبيب آخر فيصير المريض
 * مفتوحًا عند الاثنين». `app_transfer_patient_to_doctor` يضيف الطبيب المحوَّل
 * إليه (والمحوِّل إن لم يكن الطبيب المعالج) إلى الأطباء المشاركين — وعليهم
 * يبني «مرضى الطبيب» (0164) — فيظهر الملفّ عند الطبيبين، ولا يُزال أحد.
 * ويُكتب سطرٌ في ملاحظات الملفّ، ويصل الطبيبَ المحوَّلَ إليه تنبيه.
 *
 * يظهر للأطباء ولإدارة المنشأة (المالك، مدير المنشأة، مدير الفرع) — الصفات
 * نفسها التي تقبلها الدالّة. القائمة كلّ الأطباء النشطين لا طبيب الجلسة وحده:
 * التحويل إلى زميل.
 */

type PatientLite = {
  id: string;
  name_ar: string;
  treating_doctor_id?: string | null;
  participating_doctor_ids?: string[] | null;
};

const TRANSFER_ROLES = ["owner", "organization_admin", "branch_manager", "doctor"];

export function useCanTransferPatient() {
  const { membership } = useOrganizationAccess();
  return TRANSFER_ROLES.includes(membership?.role_key ?? "");
}

export default function TransferPatientButton({ patient }: { patient: PatientLite }) {
  const canTransfer = useCanTransferPatient();
  const [open, setOpen] = useState(false);
  if (!canTransfer) return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-500 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
        onClick={() => setOpen(true)}
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
        تحويل المريض إلى طبيب آخر
      </Button>
      <TransferPatientDialog patient={patient} open={open} onOpenChange={setOpen} />
    </>
  );
}

function TransferPatientDialog({
  patient,
  open,
  onOpenChange,
}: {
  patient: PatientLite;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { organization } = useOrganizationAccess();
  const { doctorId: sessionDoctorId } = useSessionDoctor();
  const selfDoctor = sessionDoctorId && sessionDoctorId !== NO_DOCTOR ? sessionDoctorId : null;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [toDoctorId, setToDoctorId] = useState("");
  const [note, setNote] = useState("");

  const doctors = useQuery({
    queryKey: ["transfer-doctors", organization?.id],
    enabled: open && Boolean(organization?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [doctorRows, clinicRows] = await Promise.all([
        supabase
          .from("doctors")
          .select("id, name_ar, clinic_id")
          .eq("organization_id", organization!.id)
          .eq("is_enabled", true)
          .order("name_ar"),
        supabase.from("clinics").select("id, name").eq("organization_id", organization!.id),
      ]);
      if (doctorRows.error) throw doctorRows.error;
      // اسم العيادة للتمييز فقط — فشل جلبه لا يمنع التحويل
      const clinicNames = new Map(((clinicRows.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
      return ((doctorRows.data ?? []) as { id: string; name_ar: string; clinic_id: string | null }[]).map((d) => ({
        id: d.id,
        name_ar: d.name_ar,
        clinic_name: d.clinic_id ? clinicNames.get(d.clinic_id) ?? null : null,
      }));
    },
  });

  const byId = useMemo(() => new Map((doctors.data ?? []).map((d) => [d.id, d])), [doctors.data]);
  const currentIds = useMemo(
    () =>
      Array.from(
        new Set([patient.treating_doctor_id, ...(patient.participating_doctor_ids ?? [])].filter(Boolean) as string[]),
      ),
    [patient.treating_doctor_id, patient.participating_doctor_ids],
  );
  const choices = (doctors.data ?? []).filter((d) => d.id !== selfDoctor);

  const reset = () => {
    setToDoctorId("");
    setNote("");
  };

  const transfer = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      if (!toDoctorId) throw new Error("اختر الطبيب المحوَّل إليه");
      const { data, error } = await supabase.rpc("app_transfer_patient_to_doctor", {
        p_organization_id: organization.id,
        p_patient_id: patient.id,
        p_to_doctor_id: toDoctorId,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      return data as { to_doctor_name: string; from_doctor_name: string | null; notified: boolean };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["patient", patient.id] });
      queryClient.invalidateQueries({ queryKey: ["is-my-patient"] });
      queryClient.invalidateQueries({ queryKey: ["patient-notes", patient.id] });
      queryClient.invalidateQueries({ queryKey: ["patient-note-counts"] });
      toast({
        title: `حُوِّل المريض إلى ${result.to_doctor_name}`,
        description: result.notified
          ? "صار الملفّ مفتوحًا عند الطبيبين، ووصله تنبيه."
          : "صار الملفّ مفتوحًا عند الطبيبين. (الطبيب بلا حساب دخول — لم يصله تنبيه.)",
      });
      reset();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر التحويل", description: errorMessage(error) }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تحويل المريض إلى طبيب آخر</DialogTitle>
          <DialogDescription>
            {patient.name_ar} — يصير الملفّ مفتوحًا عندك وعند الطبيب المحوَّل إليه، ولا يُزال أيّ طبيب من الملفّ.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {currentIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">أطباء الملفّ الآن:</span>
              {currentIds.map((id) => (
                <Badge key={id} variant={id === patient.treating_doctor_id ? "default" : "secondary"}>
                  {byId.get(id)?.name_ar ?? "طبيب"}
                  {id === patient.treating_doctor_id ? " (المعالج)" : ""}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>الطبيب المحوَّل إليه *</Label>
            <Select value={toDoctorId} onValueChange={setToDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder={doctors.isLoading ? "جارٍ التحميل..." : "اختر الطبيب"} />
              </SelectTrigger>
              <SelectContent>
                {choices.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name_ar}
                    {d.clinic_name ? ` — ${d.clinic_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {doctors.isError && (
              <p className="text-xs text-destructive">تعذّر تحميل الأطباء: {errorMessage(doctors.error)}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>سبب التحويل / ملاحظة للطبيب (اختياري)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="مثال: يحتاج تقييم تقويم"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={transfer.isPending}>
            إلغاء
          </Button>
          <Button disabled={!toDoctorId || transfer.isPending} onClick={() => transfer.mutate()}>
            {transfer.isPending ? "جارٍ التحويل..." : "تحويل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
