/**
 * الإبلاغ التلقائيّ لـZATCA (0200).
 *
 * الإرسال نفسه في الدالّة الطرفية `zatca-invoice` بكلّ حراساتها (الصلاحية،
 * وتفعيل الإنتاج على الجهاز، وسلامة الشهادة، وتسلسل ICV/PIH الذرّيّ). هنا
 * الإعداد، والنداء، وقراءة الخطأ بالعربية.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** العبارة التي يشترطها الخادم لكلّ إرسالٍ إنتاجيّ — تُرسل آليًّا حين يُفعِّل المدير الإبلاغ التلقائيّ. */
export const ZATCA_PRODUCTION_CONFIRMATION = "SUBMIT_REAL_ZATCA_INVOICE";

export type ZatcaAutoSettings = {
  zatca_auto_report: boolean;
  zatca_report_from: string | null;
};

export function useZatcaAutoSettings(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["zatca-auto-settings", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_vat_settings")
        .select("zatca_auto_report, zatca_report_from")
        .eq("organization_id", organizationId)
        .maybeSingle();
      // قبل تنفيذ 0200 لا عمودان — الإبلاغ التلقائيّ ببساطة غير متاح
      if (error) return { zatca_auto_report: false, zatca_report_from: null } as ZatcaAutoSettings;
      return (data ?? { zatca_auto_report: false, zatca_report_from: null }) as ZatcaAutoSettings;
    },
  });
}

export type ZatcaPendingRow = {
  invoice_id: string;
  label: string;
  document_type: string;
  issued_at: string;
  customer_name: string | null;
  net_amount: number;
  zatca_status: string;
  zatca_mode: string | null;
  last_error: string | null;
  attempt_count: number;
  hours_pending: number;
};

export async function fetchZatcaPending(organizationId: string, limit = 300) {
  const { data, error } = await supabase.rpc("app_zatca_pending_invoices", {
    p_organization_id: organizationId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ZatcaPendingRow[];
}

/** رسالة الخطأ من ردّ الدالّة الطرفية، مع أوّل خطأ تحقّق من ZATCA إن وُجد. */
export async function readZatcaInvokeError(error: unknown, data: any) {
  let payload = data;
  const context = (error as { context?: Response } | null)?.context;
  if (!payload?.error && context) {
    payload = await context.clone().json().catch(() => null);
  }
  const validation = payload?.details?.validationResults ?? payload?.validationResults;
  const first = Array.isArray(validation?.errorMessages) ? validation.errorMessages[0] : null;
  return (
    [payload?.error, first?.code ? `[${first.code}] ${first.message ?? ""}` : null].filter(Boolean).join(" — ") ||
    (error instanceof Error ? error.message : "تعذّر الإرسال")
  );
}

export type ZatcaReportResult = {
  ok: boolean;
  status?: string;
  message: string;
  /** نتيجةٌ غير محسومة تُوقف الجهاز حتى المراجعة — لا يُعاد الإرسال بعدها آليًّا. */
  ambiguous?: boolean;
};

/**
 * حسم فاتورةٍ «غير محسومة» بإعادة إرسال المستند الموقّع نفسه (0224).
 *
 * نفس UUID والبصمة والتسلسل — لا مستند جديد. إن قبلته ZATCA (أو كانت استلمته
 * من قبل) ثُبِّت ورُفع إيقاف الجهاز، وإن رفضته صراحةً صارت «مرفوضة» وأُطلق
 * الجهاز، وإن تعذّر الاتصال بقيت كما هي.
 */
export async function resolveAmbiguousZatca(invoiceId: string): Promise<ZatcaReportResult & { resolved?: boolean }> {
  try {
    const { data, error } = await supabase.functions.invoke("zatca-invoice", {
      body: {
        invoiceId,
        mode: "production",
        action: "resolve_ambiguous",
        productionConfirmation: ZATCA_PRODUCTION_CONFIRMATION,
      },
    });
    if (error || data?.error) {
      let payload = data;
      const context = (error as { context?: Response } | null)?.context;
      if (!payload?.error && context) payload = await context.clone().json().catch(() => null);
      const message = await readZatcaInvokeError(error, data);
      return {
        ok: false,
        status: payload?.status,
        message,
        ambiguous: payload?.status === "ambiguous",
        resolved: Boolean(payload?.resolved),
      };
    }
    return { ok: true, status: data?.status, message: data?.message ?? "حُسمت الفاتورة", resolved: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "تعذّر الإرسال", ambiguous: true };
  }
}

/** إبلاغ ZATCA (الإنتاج) بفاتورة. لا يرمي — يُعيد النتيجة. */
export async function reportInvoiceToZatca(invoiceId: string): Promise<ZatcaReportResult> {
  try {
    const { data, error } = await supabase.functions.invoke("zatca-invoice", {
      body: { invoiceId, mode: "production", productionConfirmation: ZATCA_PRODUCTION_CONFIRMATION },
    });
    if (error || data?.error) {
      const message = await readZatcaInvokeError(error, data);
      const ambiguous = data?.status === "ambiguous" || /غير محسوم/.test(message);
      return { ok: false, status: data?.status, message, ambiguous };
    }
    return { ok: true, status: data?.status, message: data?.message ?? "أُبلغت ZATCA بالفاتورة" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "تعذّر الإرسال" };
  }
}
