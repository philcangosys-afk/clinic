import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarX2, Clock, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatTime, useLocaleSettings } from "@/lib/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * تعارض المواعيد (0174) — الوقت المحجوز يُرى قبل الحفظ، ويُقال من أيّ ساعةٍ
 * يُحجز، ويُتجاوز بخطوتين لا بخطوة.
 *
 * **مصدرٌ واحد للحقيقة:** الفحص المسبق (`app_check_appointment_overlap`)
 * ورفض الحفظ (مُحفِّز `app_prevent_appointment_overlap`) يقرآن الدالّة نفسها
 * في القاعدة. فما يُعرض هنا هو بالضبط ما سيرفضه الحفظ — لا تقديرٌ في المتصفّح
 * من مواعيد حُمِّلت قبل دقيقتين.
 */

export type OverlapConflict = {
  from: string;
  until: string;
  in_session: boolean;
  status: string;
  service_name: string | null;
  patient_name: string | null;
};

export type OverlapInfo = {
  busy_from: string;
  busy_until: string;
  in_session: boolean;
  next_free: string;
  duration_minutes: number;
  conflicts: OverlapConflict[];
};

/** رفض الحفظ يحمل التفاصيل نفسها مقروءةً آليًّا — لا يُحلَّل نصّ الرسالة. */
export function parseOverlapError(error: unknown): OverlapInfo | null {
  const e = error as { hint?: string | null; details?: string | null } | null;
  if (!e || e.hint !== "ZC_APPOINTMENT_OVERLAP" || !e.details) return null;
  try {
    return JSON.parse(e.details) as OverlapInfo;
  } catch {
    return null;
  }
}

export function useAppointmentOverlap({
  organizationId,
  doctorId,
  start,
  end,
  excludeId,
  enabled = true,
}: {
  organizationId: string | undefined | null;
  doctorId: string | null;
  start: Date | null;
  end: Date | null;
  excludeId?: string | null;
  enabled?: boolean;
}) {
  const valid =
    Boolean(start && end) &&
    !Number.isNaN(start!.getTime()) &&
    !Number.isNaN(end!.getTime()) &&
    end!.getTime() > start!.getTime();
  return useQuery({
    queryKey: [
      "appointment-overlap",
      organizationId,
      doctorId,
      valid ? start!.toISOString() : null,
      valid ? end!.toISOString() : null,
      excludeId ?? null,
    ],
    enabled: enabled && Boolean(organizationId && doctorId) && valid,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_check_appointment_overlap", {
        p_organization_id: organizationId,
        p_doctor_id: doctorId,
        p_start: start!.toISOString(),
        p_end: end!.toISOString(),
        p_exclude_id: excludeId ?? null,
      });
      if (error) throw error;
      return (data ?? null) as OverlapInfo | null;
    },
  });
}

/** «احجز من …» — بالساعة وحدها إن كان اليوم نفسه، وبالتاريخ إن انتقل. */
function useNextFreeLabel(info: OverlapInfo, requestedStart: Date | null) {
  const { calendarDisplay } = useLocaleSettings();
  const next = new Date(info.next_free);
  const sameDay = requestedStart ? next.toDateString() === requestedStart.toDateString() : true;
  return sameDay ? formatTime(next) : formatDateTime(next, calendarDisplay);
}

function ConflictLines({ info }: { info: OverlapInfo }) {
  return (
    <ul className="flex flex-col gap-1">
      {info.conflicts.map((c, index) => (
        <li key={`${c.from}-${index}`} className="flex flex-wrap items-center gap-1.5 text-xs">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono tabular-nums">
            {formatTime(c.from)}–{formatTime(c.until)}
          </span>
          {c.service_name && <span>· {c.service_name}</span>}
          {c.patient_name && (
            <span className="flex items-center gap-1">
              · <UserRound className="h-3 w-3" />
              {c.patient_name}
            </span>
          )}
          {c.in_session && (
            <Badge className="h-5 bg-rose-600 px-1.5 text-[10px] hover:bg-rose-600">المريض داخل الآن</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * البلوك تحت حقول الوقت: يظهر ما دام الوقت المختار محجوزًا.
 *
 * «انقل إلى …» يضع أقرب وقتٍ يتّسع للمدّة **كاملة** — لا نهاية التعارض الأوّل
 * وحدها، فقد يليه تعارضٌ ثانٍ. والتجاوز لا يُعرض هنا زرًّا مستقلًّا: يُطلب
 * عند «حجز» بخطوتين، حتى لا يُضغط سهوًا.
 */
export function OverlapNotice({
  info,
  requestedStart,
  onMove,
  overrideConfirmed = false,
  onUndoOverride,
}: {
  info: OverlapInfo | null | undefined;
  requestedStart: Date | null;
  onMove: (next: Date) => void;
  overrideConfirmed?: boolean;
  onUndoOverride?: () => void;
}) {
  if (!info) return null;
  return <OverlapNoticeBody info={info} requestedStart={requestedStart} onMove={onMove} overrideConfirmed={overrideConfirmed} onUndoOverride={onUndoOverride} />;
}

function OverlapNoticeBody({
  info,
  requestedStart,
  onMove,
  overrideConfirmed,
  onUndoOverride,
}: {
  info: OverlapInfo;
  requestedStart: Date | null;
  onMove: (next: Date) => void;
  overrideConfirmed: boolean;
  onUndoOverride?: () => void;
}) {
  const nextLabel = useNextFreeLabel(info, requestedStart);
  return (
    <div
      className={
        overrideConfirmed
          ? "flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950"
          : "flex flex-col gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-rose-950"
      }
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CalendarX2 className="h-4 w-4" />
        هذا الوقت محجوز — الطبيب مشغول من {formatTime(info.busy_from)} حتى {formatTime(info.busy_until)}
      </div>
      <ConflictLines info={info} />
      {overrideConfirmed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium">التجاهل مؤكَّد — سيُحجز الموعد متداخلًا ويُسجَّل باسمك.</span>
          {onUndoOverride && (
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onUndoOverride}>
              تراجع عن التجاهل
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs">احجز من {nextLabel} فما بعد.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 bg-background text-xs"
            onClick={() => onMove(new Date(info.next_free))}
          >
            انقل إلى {nextLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * نافذة القرار عند «حجز» والوقت محجوز: انقل، أو تجاهل ثمّ أكّد.
 *
 * **التجاهل بخطوتين:** الأولى تُظهر ما سيُتجاوَز، والثانية تقول إنّه يُسجَّل
 * باسم من أكّده. خطوةٌ واحدة تُضغط كما يُضغط «موافق» على كلّ نافذة.
 *
 * و`allowOverride = false` حين لا يملك المسار حمل التجاوز (حجز طلب المتابعة
 * يمرّ بدالّةٍ في القاعدة لا تقبله) — فلا يُعرض زرٌّ يُرفض.
 */
export function OverlapConfirmDialog({
  info,
  requestedStart,
  onClose,
  onMove,
  allowOverride,
  onOverrideConfirmed,
}: {
  info: OverlapInfo | null;
  requestedStart: Date | null;
  onClose: () => void;
  onMove: (next: Date) => void;
  allowOverride: boolean;
  onOverrideConfirmed: () => void;
}) {
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  useEffect(() => {
    if (info) setStep("choose");
  }, [info]);

  return (
    <AlertDialog open={Boolean(info)} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        {info && (
          <OverlapConfirmBody
            info={info}
            requestedStart={requestedStart}
            step={step}
            setStep={setStep}
            onClose={onClose}
            onMove={onMove}
            allowOverride={allowOverride}
            onOverrideConfirmed={onOverrideConfirmed}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function OverlapConfirmBody({
  info,
  requestedStart,
  step,
  setStep,
  onClose,
  onMove,
  allowOverride,
  onOverrideConfirmed,
}: {
  info: OverlapInfo;
  requestedStart: Date | null;
  step: "choose" | "confirm";
  setStep: (step: "choose" | "confirm") => void;
  onClose: () => void;
  onMove: (next: Date) => void;
  allowOverride: boolean;
  onOverrideConfirmed: () => void;
}) {
  const nextLabel = useNextFreeLabel(info, requestedStart);

  if (step === "confirm") {
    return (
      <>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive">تأكيد التجاهل</AlertDialogTitle>
          <AlertDialogDescription>
            سيُحجز الموعد متداخلًا مع {info.conflicts.length === 1 ? "موعدٍ آخر" : `${info.conflicts.length} مواعيد`} للطبيب
            نفسه بين {formatTime(info.busy_from)} و{formatTime(info.busy_until)}
            {info.in_session ? "، والمريض داخل الآن" : ""}. ويُسجَّل على الموعد أنّك أنت من تجاوز التعارض ومتى.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => setStep("choose")}>
            رجوع
          </Button>
          <Button type="button" variant="destructive" onClick={onOverrideConfirmed}>
            نعم، احجز رغم التعارض
          </Button>
        </AlertDialogFooter>
      </>
    );
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <CalendarX2 className="h-5 w-5 text-rose-600" />
          الوقت محجوز
        </AlertDialogTitle>
        <AlertDialogDescription>
          الطبيب مشغول من {formatTime(info.busy_from)} حتى {formatTime(info.busy_until)}
          {info.in_session ? " — المريض داخل الآن" : ""}. أقرب وقتٍ يتّسع لموعدٍ مدّته {info.duration_minutes} دقيقة:{" "}
          <span className="font-semibold text-foreground">{nextLabel}</span>.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="rounded-md border bg-muted/40 p-2.5">
        <ConflictLines info={info} />
      </div>
      <AlertDialogFooter className="flex-wrap gap-2 sm:justify-between">
        <Button type="button" variant="ghost" onClick={onClose}>
          إلغاء
        </Button>
        <div className="flex flex-wrap gap-2">
          {allowOverride && (
            <Button type="button" variant="outline" onClick={() => setStep("confirm")}>
              تجاهل التعارض
            </Button>
          )}
          <Button
            type="button"
            onClick={() => {
              onMove(new Date(info.next_free));
              onClose();
            }}
          >
            انقل إلى {nextLabel}
          </Button>
        </div>
      </AlertDialogFooter>
    </>
  );
}
