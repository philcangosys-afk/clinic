import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { APPOINTMENT_QUERY_KEYS } from "@/lib/appointment-extras";
import { formatDateTime, formatTime, useLocaleSettings } from "@/lib/locale";
import { statusLabel } from "@/lib/appointment-status";
import type { AppointmentStatus } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * أولوية التقريب (P) — فرغت خانة: من يقبل موعدًا أبكر عند هذا الطبيب؟
 *
 * تُفتح بعد إلغاء موعدٍ أو نقله أو إرساله إلى الانتظار. القائمة مرضى الطبيب
 * نفسه ممن عُلِّم موعدهم «يقبل التقريب»، ومواعيدهم بعد الخانة الفارغة، مرتّبين
 * بأقربها. «انقله إلى الخانة» يمرّ بإعادة الجدولة في القاعدة (السبب مكتوب،
 * والدوام والتداخل مفحوصان).
 */
type Candidate = {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  status: AppointmentStatus;
  clinic_id: string | null;
  patient: { id: string; name_ar: string; file_number: number | string | null; mobile_number: string | null } | null;
};

export type FreedSlot = {
  doctorId: string;
  doctorName?: string | null;
  start: string;
  end: string;
};

export default function EarlierCandidatesDialog({
  organizationId,
  slot,
  onOpenChange,
}: {
  organizationId: string | undefined;
  slot: FreedSlot | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { calendarDisplay } = useLocaleSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [movedId, setMovedId] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: ["earlier-candidates", organizationId, slot?.doctorId, slot?.start],
    enabled: Boolean(organizationId && slot),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "id, scheduled_start, scheduled_end, status, clinic_id, " +
            "patient:patients!appointments_patient_tenant_fk(id, name_ar, file_number, mobile_number)",
        )
        .eq("organization_id", organizationId)
        .eq("doctor_id", slot!.doctorId)
        .eq("accepts_earlier", true)
        .eq("is_waiting", false)
        .in("status", ["new", "scheduled", "confirmed", "unconfirmed"])
        .gt("scheduled_start", slot!.start)
        .order("scheduled_start")
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as Candidate[];
    },
  });

  const move = useMutation({
    mutationFn: async (candidate: Candidate) => {
      if (!slot) return;
      const minutes = Math.max(
        5,
        Math.round((new Date(candidate.scheduled_end).getTime() - new Date(candidate.scheduled_start).getTime()) / 60000),
      );
      const start = new Date(slot.start);
      const end = new Date(start.getTime() + minutes * 60000);
      const { error } = await supabase.rpc("app_reschedule_appointment", {
        p_appointment_id: candidate.id,
        p_scheduled_start: start.toISOString(),
        p_scheduled_end: end.toISOString(),
        p_doctor_id: slot.doctorId,
        p_clinic_id: candidate.clinic_id,
        p_reason: `تقريب موعد — فرغت خانة ${formatTime(start)} ويقبل المريض موعدًا أبكر`,
      });
      if (error) throw error;
      return candidate;
    },
    onSuccess: (candidate) => {
      APPOINTMENT_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [...key] }));
      if (candidate) setMovedId(candidate.id);
      toast({ title: `قُرِّب موعد ${candidate?.patient?.name_ar ?? ""}`, description: "اتصل بالمريض لإبلاغه بالموعد الجديد." });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر تقريب الموعد", description: errorMessage(error) }),
  });

  const list = candidates.data ?? [];

  return (
    <Dialog
      open={Boolean(slot)}
      onOpenChange={(next) => {
        if (!next) setMovedId(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-primary" />
            فرغت خانة — مرضى يقبلون التقريب
          </DialogTitle>
          <DialogDescription>
            {slot
              ? `${slot.doctorName ? `د. ${slot.doctorName} · ` : ""}${formatDateTime(slot.start, calendarDisplay)} — مرضى هذا الطبيب الذين عُلِّم موعدهم «يقبل موعدًا أبكر»، بأقرب مواعيدهم.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {candidates.isLoading && <Skeleton className="h-24 w-full" />}
        {candidates.isError && (
          <p className="text-sm text-destructive">تعذّر القراءة: {errorMessage(candidates.error)}</p>
        )}
        {!candidates.isLoading && !candidates.isError && list.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">لا أحد من مرضى هذا الطبيب ينتظر تقريب موعده.</p>
        )}
        {list.length > 0 && (
          <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
            {list.map((candidate) => (
              <div key={candidate.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {candidate.patient?.name_ar ?? "—"}
                    {candidate.patient?.file_number != null && (
                      <span className="ms-1.5 text-xs text-muted-foreground">F#{candidate.patient.file_number}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    موعده الحالي {formatDateTime(candidate.scheduled_start, calendarDisplay)}
                    {candidate.patient?.mobile_number ? ` · ${candidate.patient.mobile_number}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline">{statusLabel(candidate.status)}</Badge>
                  {movedId === candidate.id ? (
                    <Badge variant="success">قُرِّب</Badge>
                  ) : (
                    <Button size="sm" disabled={move.isPending || Boolean(movedId)} onClick={() => move.mutate(candidate)}>
                      انقله إلى الخانة
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
