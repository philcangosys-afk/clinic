import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { fetchZatcaPending, reportInvoiceToZatca, useZatcaAutoSettings } from "@/lib/zatca-auto";

/** كلّ كم يُراجَع ما لم يُبلَّغ. */
const TICK_MS = 3 * 60 * 1000;
/** مهلةٌ بعد الإصدار: نافذة الفاتورة تُبلِّغ فورًا، فلا يتسابق معها هذا المُبلِّغ. */
const GRACE_MS = 2 * 60 * 1000;
/** بعد هذا العدد من المحاولات يُترك للمراجعة من «فواتير لم تُبلَّغ». */
const MAX_ATTEMPTS = 20;

/**
 * المُبلِّغ الخلفيّ لـZATCA — بلا واجهة، في إطار التطبيق.
 *
 * الفاتورة المبسّطة تُبلَّغ خلال 24 ساعة من إصدارها. نافذة الفاتورة تُبلِّغ
 * فور الإصدار، وهذا يلتقط ما فاتها: فاتورةٌ صدرت من مسارٍ آخر (إشعار دائن،
 * فاتورة طبيب، حجز الموقع)، أو تعذّر إبلاغها لانقطاع الشبكة. يعمل ما دام
 * التطبيق مفتوحًا عند مستخدمٍ يملك `billing.issue` والإبلاغ التلقائيّ مفعّل.
 *
 * * «مرفوضة» (خطأ في البيانات) لا تُعاد آليًّا — تُصحَّح ثمّ تُرسل من القائمة.
 * * «غير محسومة» تُوقف الجهاز لدى الخادم؛ فيتوقّف المُبلِّغ ويُنبَّه المستخدم.
 * * التزامن بين تبويبين أو موظّفَين يحسمه الخادم: سجلّ الإرسال قفلٌ لكلّ
 *   فاتورة، وحجز ICV/PIH ذرّيّ.
 */
export default function ZatcaAutoReporter() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settings = useZatcaAutoSettings(organization?.id);
  const organizationId = organization?.id;
  const enabled = Boolean(
    organizationId &&
      settings.data?.zatca_auto_report &&
      settings.data?.zatca_report_from &&
      can("billing.issue"),
  );
  const running = useRef(false);
  const halted = useRef(false);

  useEffect(() => {
    if (!enabled || !organizationId) return;
    let cancelled = false;

    const tick = async () => {
      if (running.current || halted.current || cancelled) return;
      running.current = true;
      try {
        const rows = await fetchZatcaPending(organizationId, 50);
        const now = Date.now();
        const due = rows.filter(
          (row) =>
            (row.zatca_status === "pending" || row.zatca_status === "failed") &&
            now - new Date(row.issued_at).getTime() >= GRACE_MS &&
            row.attempt_count < MAX_ATTEMPTS,
        );
        let reported = 0;
        for (const row of due) {
          if (cancelled) break;
          const result = await reportInvoiceToZatca(row.invoice_id);
          if (result.ok) {
            reported += 1;
          } else if (result.ambiguous) {
            halted.current = true;
            toast({
              variant: "destructive",
              title: "توقّف الإبلاغ التلقائيّ لـZATCA",
              description: `نتيجة إرسال ${row.label} غير محسومة — راجعها من «فواتير لم تُبلَّغ» في المبيعات قبل أيّ إرسال آخر.`,
            });
            break;
          }
        }
        if (reported > 0 || due.length > 0) {
          queryClient.invalidateQueries({ queryKey: ["zatca-pending"] });
          queryClient.invalidateQueries({ queryKey: ["invoice-zatca"] });
        }
      } catch {
        // تعذّر الجلب (شبكة أو صلاحية) — يُعاد في الدورة التالية بصمت
      } finally {
        running.current = false;
      }
    };

    const first = window.setTimeout(tick, 20_000);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, organizationId]);

  return null;
}
