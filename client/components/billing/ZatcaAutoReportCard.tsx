import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { formatDateTime, useLocaleSettings } from "@/lib/locale";
import { useZatcaAutoSettings } from "@/lib/zatca-auto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** قيمة `datetime-local` بالتوقيت المحلّيّ. */
function toLocalInput(value: string | Date) {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * الإبلاغ التلقائيّ (0200) — في شاشة «الربط مع ZATCA».
 *
 * مفعّلًا: تُبلَّغ الفاتورة فور إصدارها من نافذة الفاتورة، ويلتقط المُبلِّغ
 * الخلفيّ ما فات كلّ بضع دقائق. «بدء الإبلاغ» يستثني فواتير التجربة قبل
 * التشغيل الحقيقيّ. ويعمل فقط حين يكون جهاز الإنتاج مفعّلًا — الخادم يرفض
 * غير ذلك مهما كان هذا الإعداد.
 */
export default function ZatcaAutoReportCard({ organizationId }: { organizationId: string | undefined }) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const { calendarDisplay } = useLocaleSettings();
  const queryClient = useQueryClient();
  const settings = useZatcaAutoSettings(organizationId);
  const canManage = can("integrations.manage");
  const [enabled, setEnabled] = useState(false);
  const [from, setFrom] = useState("");

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(Boolean(settings.data.zatca_auto_report));
    setFrom(settings.data.zatca_report_from ? toLocalInput(settings.data.zatca_report_from) : toLocalInput(new Date()));
  }, [settings.data?.zatca_auto_report, settings.data?.zatca_report_from]);

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا منشأة نشطة");
      const { error } = await supabase.rpc("app_set_zatca_auto_report", {
        p_organization_id: organizationId,
        p_enabled: enabled,
        p_report_from: from ? new Date(from).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zatca-auto-settings"] });
      queryClient.invalidateQueries({ queryKey: ["zatca-pending"] });
      toast({ title: enabled ? "فُعِّل الإبلاغ التلقائيّ" : "حُفظ — الإبلاغ التلقائيّ متوقّف" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) }),
  });

  const changed =
    Boolean(settings.data) &&
    (enabled !== Boolean(settings.data?.zatca_auto_report) ||
      (settings.data?.zatca_report_from ? toLocalInput(settings.data.zatca_report_from) : "") !== from);

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <Send className="h-4 w-4" />
        الإبلاغ التلقائيّ للفواتير
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        الفاتورة المبسّطة تُبلَّغ ZATCA خلال 24 ساعة من إصدارها. مفعّلًا: تُرسل الفاتورة إلى الإنتاج فور إصدارها، وما تعذّر
        يُعاد كلّ بضع دقائق ما دام النظام مفتوحًا عند موظّفٍ يملك صلاحية إصدار الفواتير. يعمل فقط وجهاز الإنتاج مفعّل.
        القائمة الكاملة في «الفوترة» ← «فواتير لم تُبلَّغ».
      </p>
      {settings.isLoading ? null : (
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              disabled={!canManage}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            تفعيل الإبلاغ التلقائيّ
          </label>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">تُبلَّغ الفواتير الصادرة من</Label>
            <Input
              type="datetime-local"
              value={from}
              disabled={!canManage}
              onChange={(event) => setFrom(event.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              ما قبله فواتير تجربة لا تُرسل. اجعله لحظة بدء العمل الحقيقيّ على ZainCare.
              {settings.data?.zatca_report_from
                ? ` المحفوظ: ${formatDateTime(settings.data.zatca_report_from, calendarDisplay)}.`
                : ""}
            </span>
          </div>
          <div className="flex items-start justify-end">
            {canManage && (
              <Button disabled={!changed || save.isPending || (enabled && !from)} onClick={() => save.mutate()}>
                {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
