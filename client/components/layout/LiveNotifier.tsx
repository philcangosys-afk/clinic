import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

/**
 * التنبيه الحيّ — نافذةٌ منبثقة وصوت لكلّ تنبيهٍ جديد في صندوق المستخدم.
 *
 * يقرأ `v_my_notifications` (تنبيهات المستخدم وحده) كلّ بضع ثوانٍ ويعرض ما
 * وصل بعد آخر ما عُرض: «أُرسل إليك مريض»، «ملاحظة من الاستقبال»، «اطّلع
 * الاستقبال على ملاحظتك»… (0210). يعمل لكلّ مستخدم، وبلا حاجة لفتح شاشة
 * التنبيهات.
 *
 * — «آخر ما عُرض» يُحفظ في المتصفّح لكلّ مستخدم، فلا يتكرّر الصوت بعد
 *   تحديث الصفحة. وفي أوّل تشغيل يبدأ من أحدث تنبيهٍ موجود (توقيت الخادم لا
 *   ساعة الجهاز) فلا تنهال التنبيهات القديمة دفعةً واحدة.
 * — المتصفّح لا يسمح بالصوت قبل أوّل نقرة في الصفحة: يُفتح الصوت مع أوّل
 *   نقرة أو ضغطة مفتاح، ويُطلب معها إذن تنبيهات سطح المكتب (حين تكون نافذة
 *   النظام في الخلفية).
 */

const POLL_MS = 10_000;
const NO_SOUND_KEY = "zaincare:notify-sound-off";

type LiveRow = {
  id: string;
  title: string;
  body: string | null;
  severity: "info" | "warning" | "critical";
  action_path: string | null;
  created_at: string;
};

const sinceKey = (org: string, user: string) => `zaincare:notified-until:${org}:${user}`;

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // التخزين غير متاح: يبقى التتبّع في الذاكرة لهذه الجلسة
  }
}

/* ── الصوت (يُولَّد بلا ملفّ) ─────────────────────────────────────────────── */
let audioCtx: AudioContext | null = null;
function getAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function playChime(urgent: boolean) {
  if (readStorage(NO_SOUND_KEY) === "1") return;
  const ctx = getAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const notes = urgent ? [988, 740, 988, 740] : [740, 988];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

export default function LiveNotifier() {
  const { organization, session } = useOrganizationAccess();
  const orgId = organization?.id;
  const userId = session?.user.id;
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sinceRef = useRef<string | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  // أوّل نقرة: يُفتح الصوت ويُطلب إذن تنبيهات سطح المكتب
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudio();
      if (ctx && ctx.state === "suspended") void ctx.resume();
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  // تغيّر المستخدم أو المنشأة: يبدأ التتبّع من جديد
  useEffect(() => {
    sinceRef.current = null;
    shownRef.current = new Set();
  }, [orgId, userId]);

  const live = useQuery({
    queryKey: ["live-notifications", orgId, userId],
    enabled: Boolean(orgId && userId),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<LiveRow[]> => {
      const key = sinceKey(orgId!, userId!);
      if (!sinceRef.current) {
        const stored = readStorage(key);
        if (stored) {
          sinceRef.current = stored;
        } else {
          // أوّل مرّة على هذا المتصفّح: من أحدث تنبيهٍ موجود، بتوقيت الخادم
          const { data } = await supabase
            .from("v_my_notifications")
            .select("created_at")
            .eq("organization_id", orgId!)
            .order("created_at", { ascending: false })
            .limit(1);
          sinceRef.current = (data?.[0] as { created_at: string } | undefined)?.created_at ?? "1970-01-01T00:00:00Z";
          writeStorage(key, sinceRef.current);
          return [];
        }
      }
      const { data, error } = await supabase
        .from("v_my_notifications")
        .select("id, title, body, severity, action_path, created_at")
        .eq("organization_id", orgId!)
        .is("read_at", null)
        .gt("created_at", sinceRef.current)
        .order("created_at", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as LiveRow[];
    },
  });

  useEffect(() => {
    const rows = live.data ?? [];
    if (rows.length === 0 || !orgId || !userId) return;
    const fresh = rows.filter((row) => !shownRef.current.has(row.id));
    sinceRef.current = rows[rows.length - 1].created_at;
    writeStorage(sinceKey(orgId, userId), sinceRef.current);
    if (fresh.length === 0) return;
    fresh.forEach((row) => shownRef.current.add(row.id));

    playChime(fresh.some((row) => row.severity !== "info"));

    // ثلاثة على الأكثر في المرّة — والبقية في شاشة التنبيهات
    for (const row of fresh.slice(-3)) {
      const open = () => {
        void supabase.rpc("app_mark_notification_read", { p_id: row.id }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["notification-summary"] });
        });
        navigate(row.action_path || "/alerts");
      };
      toast({
        title: row.title,
        description: row.body ?? undefined,
        variant: row.severity === "critical" ? "destructive" : undefined,
        duration: 15_000,
        action: (
          <ToastAction altText="فتح" onClick={open}>
            فتح
          </ToastAction>
        ),
      });
      if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
          const note = new Notification(row.title, { body: row.body ?? "", tag: row.id });
          note.onclick = () => {
            window.focus();
            open();
            note.close();
          };
        } catch {
          // بعض المتصفّحات تمنع الإنشاء المباشر — النافذة داخل النظام تكفي
        }
      }
    }
    if (fresh.length > 3) {
      toast({ title: `و${fresh.length - 3} تنبيهات أخرى`, description: "في شاشة التنبيهات.", duration: 8_000 });
    }
    queryClient.invalidateQueries({ queryKey: ["notification-summary"] });
    queryClient.invalidateQueries({ queryKey: ["my-notifications"] });
  }, [live.data, orgId, userId, navigate, queryClient, toast]);

  return null;
}

/** كتم صوت التنبيهات على هذا المتصفّح أو إعادته. */
export function setNotificationSound(enabled: boolean) {
  writeStorage(NO_SOUND_KEY, enabled ? "0" : "1");
  if (enabled) playChime(false);
}
export const isNotificationSoundOn = () => readStorage(NO_SOUND_KEY) !== "1";
