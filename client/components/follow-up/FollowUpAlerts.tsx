import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck, Eye, Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useSessionDoctor } from "@/lib/session-doctor";
import { usePermissions } from "@/lib/permissions";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatTime } from "@/lib/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import FollowUpServicesList from "@/components/follow-up/FollowUpServicesList";
import { printPrescription } from "@/lib/prescriptions";
import {
  FOLLOW_UP_COLUMNS,
  FOLLOW_UP_QUERY_KEYS,
  FOLLOW_UP_TYPE,
  localDayBounds,
  todayLocalDate,
  type FollowUpRow,
} from "@/components/follow-up/follow-up-meta";

/**
 * تنبيه الاستقبال بما يصل من الأطباء (0173) — نافذةٌ جانبية وصوت.
 *
 * **مُثبَّتة في إطار التطبيق لا في شاشة:** موظّف الاستقبال يكون في المواعيد أو
 * الفوترة أو ملفّ مريض حين تصل الملاحظة، لا في مركز المتابعة. فالتنبيه
 * يلحقه حيث هو.
 *
 * **مصدران للحدث:** البثّ الفوريّ (إدراجٌ في الجدول ← تنبيهٌ خلال ثانية)،
 * والاستطلاع كلّ عشرين ثانية احتياطًا — إن انقطع البثّ أو لم يُفعَّل النشر
 * تأخّر التنبيه ولم يضِع.
 *
 * **تبقى حتى «اطّلعت»:** إغلاقها بالـ× يُخفيها ولا يختمها — يبقى زرٌّ عائم
 * بعددها، وتعود النافذة مع أوّل ملاحظةٍ جديدة. والختم يسري على كلّ أجهزة
 * الاستقبال: ما اطّلعت عليه زميلتك يختفي من نافذتك.
 */
export default function FollowUpAlerts() {
  const { organization, canAccess } = useOrganizationAccess();
  const { isDoctorRole } = useSessionDoctor();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const organizationId = organization?.id ?? null;
  const enabled =
    Boolean(organizationId) &&
    !isDoctorRole &&
    canAccess("follow_up_center", "follow_up_center.view") &&
    can("reception.requests");

  const [open, setOpen] = useState(false);
  /** ما عُرف من قبل — `null` قبل أوّل قراءة. الجديد يُنبَّه له، والمعروف لا يُعاد صوته. */
  const known = useRef<Set<string> | null>(null);

  useUnlockAudioOnFirstGesture();

  const unseen = useQuery({
    queryKey: ["follow-up-unseen", organizationId],
    enabled,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { fromIso } = localDayBounds(todayLocalDate());
      const { data, error } = await supabase
        .from("v_follow_up_center")
        .select(FOLLOW_UP_COLUMNS)
        .eq("organization_id", organizationId!)
        .gte("requested_at", fromIso)
        .is("seen_at", null)
        .eq("status", "pending")
        .order("requested_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as FollowUpRow[];
    },
  });

  // البثّ الفوريّ: الإدراج يُنبّه، والتحديث يُزيل ما ختمته زميلة
  useEffect(() => {
    if (!enabled || !organizationId) return;
    const refresh = () =>
      FOLLOW_UP_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [...key] }));
    const filter = `organization_id=eq.${organizationId}`;
    const channel = supabase
      .channel(`follow-up-${organizationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_requests", filter }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "staff_requests", filter }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "appointment_requests", filter }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "appointment_requests", filter }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, organizationId, queryClient]);

  const onCenterPage = location.pathname.startsWith("/follow-up-center");
  const rows = enabled ? unseen.data ?? [] : [];

  // الجديد: صوتٌ ونافذة
  useEffect(() => {
    if (!enabled || !unseen.data) return;
    const list = unseen.data;
    if (known.current === null) {
      known.current = new Set(list.map((r) => r.id));
      // ما وصل قبل فتح الصفحة ولم يُرَ يُعرض مرّة — لم يره أحد بعد
      if (list.length > 0) {
        playChime(list.some((r) => r.priority === "urgent"));
        if (!onCenterPage) setOpen(true);
      }
      return;
    }
    const fresh = list.filter((r) => !known.current!.has(r.id));
    list.forEach((r) => known.current!.add(r.id));
    if (fresh.length > 0) {
      playChime(fresh.some((r) => r.priority === "urgent"));
      if (!onCenterPage) setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen.data, enabled]);

  // لا شيء باقٍ — تُغلق وحدها
  useEffect(() => {
    if (rows.length === 0 && open) setOpen(false);
  }, [rows.length, open]);

  const markSeen = useMutation({
    mutationFn: async (targets: FollowUpRow[]) => {
      const { error } = await supabase.rpc("app_mark_follow_up_seen", {
        p_organization_id: organizationId,
        p_staff_ids: targets.filter((r) => r.source_kind === "staff").map((r) => r.id),
        p_appointment_ids: targets.filter((r) => r.source_kind === "appointment").map((r) => r.id),
      });
      if (error) throw error;
    },
    onSuccess: () =>
      FOLLOW_UP_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [...key] })),
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الختم", description: errorMessage(error, "خطأ غير متوقع") }),
  });

  if (!enabled || rows.length === 0) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-primary" />
              من الأطباء
              <Badge variant="destructive">{rows.length}</Badge>
            </SheetTitle>
            <SheetDescription>لم يُطَّلع عليها بعد — تبقى حتى تضغط «اطّلعت».</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {rows.map((row) => {
              const type = FOLLOW_UP_TYPE[row.request_type] ?? FOLLOW_UP_TYPE.note;
              const TypeIcon = type.icon;
              return (
                <div
                  key={`${row.source_kind}-${row.id}`}
                  className={cn(
                    "rounded-lg border bg-background p-3 shadow-sm",
                    row.priority === "urgent" && "border-s-4 border-s-rose-500",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="gap-1">
                      <TypeIcon className="h-3 w-3" />
                      {type.label}
                    </Badge>
                    {row.priority === "urgent" && <Badge variant="destructive">عاجلة</Badge>}
                    <span className="ms-auto text-xs tabular-nums text-muted-foreground">
                      {formatTime(row.requested_at)}
                    </span>
                  </div>
                  <div className="mt-2 text-sm">
                    <span className="font-semibold">{row.doctor_name ?? "طبيب"}</span>
                    <span className="text-muted-foreground"> — </span>
                    {row.patient_id ? (
                      <Link
                        to={`/patients/${row.patient_id}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        onClick={() => setOpen(false)}
                      >
                        {row.patient_name ?? "مريض"}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {row.file_number !== null && (
                      <span className="text-xs text-muted-foreground"> · ملف {row.file_number}</span>
                    )}
                  </div>
                  {row.body && <p className="mt-1.5 whitespace-pre-wrap text-sm">{row.body}</p>}
                  <FollowUpServicesList services={row.services} />
                  {row.prescription_id && (
                    <Button size="sm" variant="outline" className="mt-1.5 h-7 gap-1 text-xs"
                            onClick={() => void printPrescription(row.prescription_id!)}>
                      <Printer className="h-3.5 w-3.5" />
                      طباعة الوصفة
                    </Button>
                  )}
                  {row.amount !== null && !row.services?.length && (
                    <p className="mt-1 text-sm font-semibold tabular-nums">المبلغ: {formatAmount(row.amount)}</p>
                  )}
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      disabled={markSeen.isPending}
                      onClick={() => markSeen.mutate([row])}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      اطّلعت
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <SheetFooter className="flex-row gap-2 border-t p-3 sm:justify-between">
            <Button
              className="gap-1.5"
              disabled={markSeen.isPending}
              onClick={() => markSeen.mutate(rows)}
            >
              <CheckCheck className="h-4 w-4" />
              اطّلعت على الكلّ
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                navigate("/follow-up-center");
              }}
            >
              فتح مركز المتابعة
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* أُغلقت ولم تُختم: عدّادٌ عائم فوق زرّ «شرح القسم» يُعيدها */}
      {!open && (
        <Button
          className="fixed bottom-20 end-5 z-40 h-10 gap-2 rounded-full bg-rose-600 px-4 shadow-lg hover:bg-rose-700"
          onClick={() => setOpen(true)}
        >
          <BellRing className="h-4 w-4" />
          {rows.length} من الأطباء
        </Button>
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * الصوت بـWeb Audio لا بملفّ: نغمتان قصيرتان (وأربعٌ للعاجلة) لا تحتاجان
 * تحميلًا ولا ترخيصًا، ولا تتعطّلان إن غاب ملفٌّ من الخادم.
 *
 * والمتصفّحات تمنع الصوت قبل أوّل تفاعلٍ في الصفحة؛ فيُفتح السياق مع أوّل
 * ضغطة. وما قبلها يمرّ بلا صوت والنافذة تظهر — الصوت تحسينٌ لا شرط.
 */
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  audioContext = audioContext ?? new Ctor();
  return audioContext;
}

function useUnlockAudioOnFirstGesture() {
  useEffect(() => {
    const unlock = () => {
      try {
        const ctx = getAudioContext();
        if (ctx && ctx.state === "suspended") void ctx.resume();
      } catch {
        /* لا صوت في هذا المتصفّح */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
}

function playChime(urgent: boolean) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const tones = urgent ? [880, 1320, 880, 1320] : [880, 1320];
    tones.forEach((frequency, index) => {
      const start = ctx.currentTime + index * 0.18;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.17);
    });
  } catch {
    /* الصوت تحسينٌ لا شرط */
  }
}
