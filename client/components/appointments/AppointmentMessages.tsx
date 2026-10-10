import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, RefreshCw, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * حالة تذكيرات الموعد وسجل رسائله (0069).
 *
 * الموظف كان لا يعرف: هل أُرسل تذكير الأربع والعشرين ساعة؟ ولماذا فشل تذكير
 * الساعتين؟ فيتصل بالمريض احتياطًا في كل مرة — وهو ما تُلغيه التذكيرات
 * أصلًا.
 *
 * **«أُرسلت» هنا تعني ردَّ المزوّد بالقبول**، لا أن النظام كتب صفًا. الفرق
 * جوهري: الحالة لا تتقدّم إلى `sent` إلا بعد أن يؤكّد المزوّد، ومعها معرّف
 * الرسالة عنده للمراجعة حين ينكر المريض الاستلام.
 */

type MessageRow = {
  message_id: number;
  channel: string;
  event_key: string;
  message_text: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  created_at: string;
  provider_message_id: string | null;
  reminder_type: string | null;
};

type ReminderStatus = {
  due_24h: string | null;
  status_24h: string | null;
  due_2h: string | null;
  status_2h: string | null;
  last_error: string | null;
  last_processed_at: string | null;
};

const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }> = {
  pending:    { label: "بالانتظار",   variant: "secondary" },
  queued:     { label: "في الطابور",  variant: "secondary" },
  processing: { label: "قيد الإرسال", variant: "secondary" },
  sent:       { label: "أُرسلت",      variant: "success" },
  delivered:  { label: "وصلت",        variant: "success" },
  failed:     { label: "فشلت",        variant: "destructive" },
  cancelled:  { label: "ملغاة",       variant: "outline" },
};

const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "مجدول",
  processing: "قيد الإرسال",
  sent: "أُرسل",
  failed: "فشل",
  cancelled: "ملغى",
};

export default function AppointmentMessages({ appointmentId }: { appointmentId: string }) {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const reminders = useQuery({
    queryKey: ["appointment-reminder-status", appointmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_appointment_reminder_status")
        .select("*")
        .eq("appointment_id", appointmentId)
        .maybeSingle();
      if (error) throw error;
      return data as ReminderStatus | null;
    },
  });

  const messages = useQuery({
    queryKey: ["appointment-messages", appointmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_appointment_messages")
        .select("*")
        .eq("appointment_id", appointmentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MessageRow[];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["appointment-messages", appointmentId] });
    queryClient.invalidateQueries({ queryKey: ["appointment-reminder-status", appointmentId] });
  };

  const resend = useMutation({
    mutationFn: async (messageId: number) => {
      const { error } = await supabase.rpc("app_resend_message", { p_message_id: messageId });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast({ title: "أُعيدت الرسالة إلى الطابور", description: "تُرسَل في الدورة القادمة." });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّرت إعادة الإرسال",
        description: errorMessage(error),
      }),
  });

  const sendConfirmation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_send_appointment_confirmation", {
        p_appointment_id: appointmentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast({ title: "أُضيف تأكيد الموعد إلى الطابور" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر إرسال التأكيد",
        description: errorMessage(error),
      }),
  });

  const status = reminders.data;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">التذكيرات والرسائل</span>
        {can("messages.resend") && (
          <Button size="sm" variant="outline" disabled={sendConfirmation.isPending} onClick={() => sendConfirmation.mutate()}>
            <Send className="h-3.5 w-3.5" />
            إرسال تأكيد الآن
          </Button>
        )}
      </div>

      {reminders.isLoading && <Skeleton className="h-12 w-full" />}
      {!reminders.isLoading && (
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { label: "تذكير 24 ساعة", due: status?.due_24h, state: status?.status_24h },
            { label: "تذكير ساعتين", due: status?.due_2h, state: status?.status_2h },
          ].map((item) => (
            <div key={item.label} className="rounded-md border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{item.label}</span>
                <Badge variant={item.state === "cancelled" ? "outline" : "secondary"}>
                  {item.state ? JOB_STATUS_LABELS[item.state] ?? item.state : "غير مجدول"}
                </Badge>
              </div>
              {item.due && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {new Date(item.due).toLocaleString("ar-SA-u-nu-latn")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {status?.last_error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span>{status.last_error}</span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">سجل الرسائل</span>
        {messages.isLoading && <Skeleton className="h-16 w-full" />}
        {!messages.isLoading && (messages.data ?? []).length === 0 && (
          <p className="py-3 text-center text-xs text-muted-foreground">لا رسائل لهذا الموعد.</p>
        )}
        {(messages.data ?? []).map((row) => {
          const meta = STATUS_META[row.status] ?? { label: row.status, variant: "outline" as const };
          return (
            <div key={row.message_id} className="rounded-md border p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                <span className="text-muted-foreground">{row.channel}</span>
                {row.reminder_type && (
                  <span className="text-muted-foreground">
                    {row.reminder_type === "24h" ? "تذكير 24 ساعة" : "تذكير ساعتين"}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {new Date(row.created_at).toLocaleString("ar-SA-u-nu-latn")}
                </span>
                <span className="flex-1" />
                {row.attempts > 0 && (
                  <span className="text-muted-foreground">{row.attempts} محاولة</span>
                )}
                {["failed", "cancelled"].includes(row.status) && can("messages.resend") && (
                  <Button size="sm" variant="ghost" disabled={resend.isPending} onClick={() => resend.mutate(row.message_id)}>
                    <RefreshCw className="h-3 w-3" />
                    إعادة إرسال
                  </Button>
                )}
              </div>
              <div className="mt-1 line-clamp-2 text-muted-foreground">{row.message_text}</div>
              {row.last_error && (
                <div className="mt-1 flex items-start gap-1 text-destructive">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{row.last_error}</span>
                </div>
              )}
              {row.next_attempt_at && row.status === "failed" && (
                <div className="mt-0.5 text-muted-foreground">
                  المحاولة التالية: {new Date(row.next_attempt_at).toLocaleString("ar-SA-u-nu-latn")}
                </div>
              )}
              {row.sent_at && (
                <div className="mt-0.5 flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  أكّد المزوّد الاستلام {new Date(row.sent_at).toLocaleString("ar-SA-u-nu-latn")}
                  {row.provider_message_id && ` · مرجع ${row.provider_message_id}`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
