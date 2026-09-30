import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  APPOINTMENT_QUERY_KEYS,
  localDateKey,
  sendAppointmentToWaiting,
  waitingDayOptions,
} from "@/lib/appointment-extras";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  OverlapConfirmDialog,
  OverlapNotice,
  parseOverlapError,
  useAppointmentOverlap,
  type OverlapInfo,
} from "@/components/appointments/OverlapGuard";

/**
 * موعد الانتظار (W.P) — إرساله وحجز خانةٍ له (0197).
 *
 * «إرسال الموعد إلى الانتظار» في Kizen قائمة «Day 1 … Day 7 / Other». هنا
 * تُكتب الأيام بأسمائها وتواريخها، و«تاريخ آخر…» يفتح نافذةً تختار فيها اليوم
 * وهل ينتظر طوال اليوم أم من ساعةٍ بعينها. والقاعدة تتحقّق من الصلاحية
 * وحالة الموعد ودوام الطبيب ذلك اليوم.
 */

function useInvalidateAppointments() {
  const queryClient = useQueryClient();
  return () => APPOINTMENT_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [...key] }));
}

export function useSendToWaiting(onSent?: (freed: { appointmentId: string }) => void) {
  const { toast } = useToast();
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: async (input: { appointmentId: string; dayKey: string; fromTime?: string | null }) => {
      await sendAppointmentToWaiting(input.appointmentId, input.dayKey, input.fromTime ?? null);
      return input;
    },
    onSuccess: (input) => {
      invalidate();
      toast({ title: "أُرسل الموعد إلى الانتظار", description: `يوم ${input.dayKey}` });
      onSent?.({ appointmentId: input.appointmentId });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الإرسال إلى الانتظار", description: errorMessage(error) }),
  });
}

/** قائمة فرعية داخل قائمة الزرّ الأيمن. */
export function SendToWaitingSubmenu({
  disabled,
  onPick,
  onOther,
}: {
  disabled?: boolean;
  onPick: (dayKey: string) => void;
  onOther: () => void;
}) {
  const options = waitingDayOptions();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <Clock className="me-2 h-3.5 w-3.5" />
        إرسال إلى الانتظار
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56">
        {options.map((option) => (
          <ContextMenuItem key={option.key} onSelect={() => onPick(option.key)}>
            {option.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onOther}>تاريخ آخر أو من ساعةٍ بعينها…</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** «تاريخ آخر…»: اليوم، وطوال اليوم أو من ساعة. */
export function SendToWaitingDialog({
  target,
  onOpenChange,
  onSent,
}: {
  target: { id: string; patientName: string } | null;
  onOpenChange: (open: boolean) => void;
  onSent?: (freed: { appointmentId: string }) => void;
}) {
  const [dayKey, setDayKey] = useState(localDateKey(new Date()));
  const [allDay, setAllDay] = useState(true);
  const [fromTime, setFromTime] = useState("16:00");
  const send = useSendToWaiting((freed) => {
    onOpenChange(false);
    onSent?.(freed);
  });

  useEffect(() => {
    if (target) {
      setDayKey(localDateKey(new Date()));
      setAllDay(true);
    }
  }, [target?.id]);

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>إرسال موعد {target?.patientName} إلى الانتظار</DialogTitle>
          <DialogDescription>
            موعد انتظار: ليومٍ وطبيب بلا خانة وقت محجوزة. يُعرض في الجدول ويُحجز له وقتٌ حين يتاح.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>اليوم</Label>
            <Input type="date" min={localDateKey(new Date())} value={dayKey} onChange={(e) => setDayKey(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2 rounded-md border p-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" checked={allDay} onChange={() => setAllDay(true)} />
              طوال اليوم (من بداية دوام الطبيب)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" checked={!allDay} onChange={() => setAllDay(false)} />
              ينتظر من الساعة
              <Input
                type="time"
                value={fromTime}
                disabled={allDay}
                onChange={(e) => setFromTime(e.target.value)}
                className="h-8 w-28"
              />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            disabled={!target || !dayKey || send.isPending || (!allDay && !fromTime)}
            onClick={() =>
              target && send.mutate({ appointmentId: target.id, dayKey, fromTime: allDay ? null : fromTime })
            }
          >
            {send.isPending ? "جارٍ الإرسال..." : "إرسال إلى الانتظار"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * حجز خانةٍ لموعد انتظار — بفحص الدوام والتداخل كأيّ حجز، والتجاوز
 * بخطوتين كما في 0174.
 */
export function AssignWaitingSlotDialog({
  target,
  organizationId,
  onOpenChange,
}: {
  target: {
    id: string;
    patientName: string;
    doctorId: string;
    day: string;
    durationMinutes: number;
  } | null;
  organizationId: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateAppointments();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("30");
  const [overlapInfo, setOverlapInfo] = useState<OverlapInfo | null>(null);

  useEffect(() => {
    if (!target) return;
    setDate(target.day);
    setTime("");
    setDuration(String(target.durationMinutes || 30));
  }, [target?.id]);

  const start = date && time ? new Date(`${date}T${time}:00`) : null;
  const end = start ? new Date(start.getTime() + Number(duration) * 60_000) : null;
  const overlap = useAppointmentOverlap({
    organizationId,
    doctorId: target?.doctorId ?? null,
    start,
    end,
    excludeId: target?.id ?? null,
    enabled: Boolean(target && start && end),
  });

  const assign = useMutation({
    mutationFn: async (vars?: { override?: boolean }) => {
      if (!target || !start || !end) throw new Error("اختر الوقت");
      const { error } = await supabase.rpc("app_assign_waiting_slot", {
        p_appointment_id: target.id,
        p_start: start.toISOString(),
        p_end: end.toISOString(),
        p_override: Boolean(vars?.override),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "حُجزت خانةٌ للموعد وخرج من الانتظار" });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      const info = parseOverlapError(error);
      if (info) {
        setOverlapInfo(info);
        return;
      }
      toast({ variant: "destructive", title: "تعذّر حجز الخانة", description: errorMessage(error) });
    },
  });

  return (
    <>
      <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حجز خانة لموعد انتظار — {target?.patientName}</DialogTitle>
            <DialogDescription>يخرج الموعد من الانتظار ويحجز وقته كأيّ موعد.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 flex flex-col gap-1.5 sm:col-span-1">
              <Label>التاريخ</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الوقت</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المدّة (دقيقة)</Label>
              <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
          <OverlapNotice
            info={overlap.data}
            requestedStart={start}
            onMove={(next) => {
              setDate(localDateKey(next));
              setTime(`${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`);
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button disabled={!start || assign.isPending} onClick={() => assign.mutate({})}>
              {assign.isPending ? "جارٍ الحجز..." : "حجز الخانة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OverlapConfirmDialog
        info={overlapInfo}
        requestedStart={start}
        onClose={() => setOverlapInfo(null)}
        onMove={(next) => {
          setOverlapInfo(null);
          setDate(localDateKey(next));
          setTime(`${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`);
        }}
        allowOverride
        onOverrideConfirmed={() => {
          setOverlapInfo(null);
          assign.mutate({ override: true });
        }}
      />
    </>
  );
}
