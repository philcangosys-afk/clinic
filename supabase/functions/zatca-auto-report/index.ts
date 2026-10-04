/**
 * zatca-auto-report — الإبلاغ المجدول لـZATCA (0225).
 *
 * طلب المالك: «يعيد إرسال التي تذهب لقائمة لم تُبلَّغ ZATCA تلقائيًا لأنّ
 * الموظف يمكن أن ينسى». المُبلِّغ في المتصفّح (ZatcaAutoReporter) لا يعمل إلّا
 * والتطبيق مفتوح عند موظّفٍ له billing.issue؛ هذه الدالّة يستدعيها pg_cron كلّ
 * 5 دقائق من القاعدة نفسها، فتعمل ولو لم يفتح أحدٌ النظام.
 *
 * — الحماية: المفتاح `x-zatca-cron-secret` يُقرأ من Vault في مهمّة pg_cron،
 *   ويُتحقَّق منه بـ `zatca_cron_secret_valid` (service_role). لا سرّ في الكود.
 * — الإرسال نفسه في `zatca-invoice` بكلّ حراساتها (نداء نظام بالمفتاح نفسه):
 *   تسلسل ICV/PIH الذرّيّ، وقفل سجلّ الإرسال لكلّ فاتورة، فلا تعارض مع
 *   المتصفّح إن كان مفتوحًا.
 * — الترتيب لكلّ منشأة: «غير محسومة» أوّلًا (تُحسم بإعادة المستند الموقّع نفسه)،
 *   فإن بقيت غير محسومة لا يُرسل بعدها شيء لتلك المنشأة في هذه الدورة. ثمّ
 *   «لم تُرسل» و«تعذّر الإرسال» بالأقدم. و«مرفوضة» تُعاد كلّ 3 ساعات (قد
 *   تكون صُحّحت) حتى 8 محاولات.
 * — مهلة الدورة ~110 ثانية؛ ما لم يُرسل يُلحق في الدورة التالية.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const PRODUCTION_CONFIRMATION = "SUBMIT_REAL_ZATCA_INVOICE";
const BUDGET_MS = 110_000;
const GRACE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 60;
const REJECTED_MAX_ATTEMPTS = 8;
const REJECTED_RETRY_MS = 3 * 60 * 60 * 1000;

type QueueRow = {
  organization_id: string;
  invoice_id: string;
  label: string;
  zatca_status: string;
  attempt_count: number;
  issued_at: string;
  last_try: string | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, serviceKey);

  const secret = (req.headers.get("x-zatca-cron-secret") ?? "").trim();
  if (!secret) return json({ error: "Unauthorized" }, 401);
  const { data: valid, error: validError } = await admin.rpc("zatca_cron_secret_valid", { p_secret: secret });
  if (validError || valid !== true) return json({ error: "Unauthorized" }, 401);

  const started = Date.now();
  const { data: queueData, error: queueError } = await admin.rpc("app_zatca_cron_queue", { p_limit: 60 });
  if (queueError) {
    console.error("zatca-auto-report queue", queueError);
    return json({ error: queueError.message }, 500);
  }
  const queue = (queueData ?? []) as QueueRow[];

  const stoppedOrgs = new Set<string>();
  const results: { label: string; status: string; error?: string }[] = [];

  for (const row of queue) {
    if (Date.now() - started > BUDGET_MS) break;
    if (stoppedOrgs.has(row.organization_id)) continue;

    const attempts = Number(row.attempt_count ?? 0);
    const lastTry = row.last_try ? Date.parse(row.last_try) : 0;
    let action: string | undefined;
    if (row.zatca_status === "ambiguous") {
      action = "resolve_ambiguous";
    } else if (row.zatca_status === "rejected") {
      if (attempts >= REJECTED_MAX_ATTEMPTS || Date.now() - lastTry < REJECTED_RETRY_MS) continue;
    } else if (["pending", "failed", "submitted"].includes(row.zatca_status)) {
      if (attempts >= MAX_ATTEMPTS) continue;
      if (Date.now() - Date.parse(row.issued_at) < GRACE_MS) continue;
    } else {
      continue;
    }

    let status = "error";
    let error: string | undefined;
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/zatca-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-zatca-cron-secret": secret },
        body: JSON.stringify({
          invoiceId: row.invoice_id,
          mode: "production",
          productionConfirmation: PRODUCTION_CONFIRMATION,
          ...(action ? { action } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await response.json().catch(() => ({}));
      status = String(body?.status ?? (response.ok ? "ok" : `http_${response.status}`));
      if (body?.error) error = String(body.error).slice(0, 300);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    results.push({ label: row.label, status, ...(error ? { error } : {}) });

    // غير محسومة باقية ⇒ لا يُرسل شيءٌ بعدها لهذه المنشأة في هذه الدورة
    if (status === "ambiguous") stoppedOrgs.add(row.organization_id);
  }

  console.log("zatca-auto-report", JSON.stringify({ queued: queue.length, processed: results.length, results }));
  return json({ queued: queue.length, processed: results.length, results });
});
