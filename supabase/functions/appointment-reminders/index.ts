/**
 * دالة حافة: تشغيل تذكيرات المواعيد.
 *
 * لماذا دالة حافة لا `pg_cron`: كتلة الجدولة في الهجرة 0050 مشروطة بوجود
 * امتداد `pg_cron`، وهو **غير مثبَّت في هذا المشروع** — فالدالة كانت موجودة
 * ولا يستدعيها أحد، أي أن التذكيرات لم تُرسَل ولا مرة منذ بنائها.
 *
 * دورة التشغيل (تُجدوَل كل دقيقة أو خمس):
 *   1) `app_process_due_appointment_reminders` — تحوّل المهام المستحقة إلى
 *      رسائل في `message_log` بحالة `pending`.
 *   2) `app_claim_pending_messages` — تسحب دفعة وتُعلّمها `processing` ذرّيًا
 *      (`for update skip locked`)، فلا ترسل نسختان من الدالة نفس الرسالة
 *      مرتين للمريض لو تداخل تشغيلان.
 *   3) الإرسال عبر المزوّد، ثم `app_mark_message_sent` أو
 *      `app_mark_message_failed` — **الحالة لا تتقدّم إلى `sent` إلا بردّ
 *      المزوّد**، وهذا هو الفرق الجوهري عن السلوك السابق.
 *
 * الحماية: الدوال الأربع محجوبة عن `anon` و`authenticated` في 0050 و0054،
 * فلا تُستدعى إلا بمفتاح الخدمة. وهذه الدالة تطلب فوقه ترويسة سرية خاصة بها
 * حتى لا يكفي تسريب مفتاح الخدمة وحده لإغراق المرضى برسائل.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("REMINDERS_CRON_SECRET") ?? "";
const SMS_ENDPOINT = Deno.env.get("SMS_PROVIDER_URL") ?? "";
const SMS_TOKEN = Deno.env.get("SMS_PROVIDER_TOKEN") ?? "";

type ClaimedMessage = {
  id: number;
  organization_id: string;
  channel: string;
  recipient: string;
  message_text: string;
  attempts: number;
};

/**
 * أخطاء دائمة لا تُعاد المحاولة معها: رقم غير صالح، أو رفض المزوّد للمحتوى.
 * إعادة المحاولة معها تستهلك المحاولات الثلاث بلا أمل وتؤخّر كشف الخطأ.
 */
function isPermanentFailure(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 422;
}

async function sendSms(
  recipient: string,
  body: string,
): Promise<{ ok: boolean; providerId?: string; error?: string; permanent?: boolean }> {
  // بلا إعداد مزوّد لا تُدَّعى نتيجة: تُسجَّل فشلًا دائمًا برسالة صريحة بدل
  // أن تبقى الرسائل معلَّقة إلى الأبد بلا سبب ظاهر.
  if (!SMS_ENDPOINT) {
    return { ok: false, error: "SMS_PROVIDER_URL غير مضبوط في متغيّرات البيئة", permanent: true };
  }
  try {
    const response = await fetch(SMS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SMS_TOKEN ? { Authorization: `Bearer ${SMS_TOKEN}` } : {}),
      },
      body: JSON.stringify({ to: recipient, message: body }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `المزوّد ردّ ${response.status}: ${text.slice(0, 200)}`,
        permanent: isPermanentFailure(response.status),
      };
    }
    const payload = await response.json().catch(() => ({}));
    return { ok: true, providerId: payload?.id ?? payload?.messageId ?? undefined };
  } catch (error) {
    // انقطاع شبكة أو مهلة: عابر بطبيعته، فتُعاد المحاولة
    return { ok: false, error: error instanceof Error ? error.message : "خطأ اتصال غير معروف" };
  }
}

Deno.serve(async (request) => {
  const headers = { "Content-Type": "application/json" };

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...headers, Allow: "POST" },
    });
  }

  if (!CRON_SECRET) {
    return new Response(JSON.stringify({ error: "cron_secret_not_configured" }), {
      status: 503,
      headers,
    });
  }

  if (request.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers,
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // (1) تحويل المهام المستحقة إلى رسائل
  const { data: queued, error: processError } = await supabase.rpc(
    "app_process_due_appointment_reminders",
    { p_limit: 100 },
  );
  if (processError) {
    return new Response(JSON.stringify({ step: "process", error: processError.message }), {
      status: 500,
      headers,
    });
  }

  // (2) سحب دفعة للإرسال
  const { data: claimed, error: claimError } = await supabase.rpc(
    "app_claim_pending_messages",
    { p_limit: 50 },
  );
  if (claimError) {
    return new Response(JSON.stringify({ step: "claim", error: claimError.message }), {
      status: 500,
      headers,
    });
  }

  const messages = (claimed ?? []) as ClaimedMessage[];
  let sent = 0;
  let failed = 0;

  // (3) الإرسال ثم تسجيل النتيجة الحقيقية
  for (const message of messages) {
    if (!message.recipient) {
      await supabase.rpc("app_mark_message_failed", {
        p_message_id: message.id,
        p_error: "لا يوجد رقم مستقبِل",
        p_permanent: true,
      });
      failed += 1;
      continue;
    }

    const result = await sendSms(message.recipient, message.message_text);
    if (result.ok) {
      await supabase.rpc("app_mark_message_sent", {
        p_message_id: message.id,
        p_provider_message_id: result.providerId ?? null,
      });
      sent += 1;
    } else {
      await supabase.rpc("app_mark_message_failed", {
        p_message_id: message.id,
        p_error: result.error ?? "فشل غير معروف",
        p_permanent: result.permanent ?? false,
      });
      failed += 1;
    }
  }

  return new Response(
    JSON.stringify({ queued: queued ?? 0, claimed: messages.length, sent, failed }),
    { headers },
  );
});
