/**
 * عامل التكاملات الخلفي — المرحلة 30.
 *
 * **لماذا يوجد هذا الملف أصلًا؟** لأن الإرسال إلى جهة خارجية لا يجوز أن يتمّ
 * من المتصفّح: المفتاح السرّي ينكشف، وبيانات المريض تخرج من جهاز غير موثوق.
 * فالقاعدة تحفظ الرسائل وجدولة إعادة محاولتها، وهذا العامل — وحده — يقرأ
 * المستحقّ منها ويرسله ويُبلّغ القاعدة بالنتيجة عبر
 * `app_mark_integration_attempt`.
 *
 * **ما ينقصه ليعمل عندك، وهو مقصود لا نسيان:**
 *   1) `callProvider` أدناه ترمي استثناءً عمدًا. اربطها بعميل زاتكا/نفيس
 *      الحقيقي — لم أكتب عميلًا لم أستطع اختباره في هذه البيئة، وشيفرةُ
 *      إرسالٍ غير مُختبَرة أسوأ من غيابها لأنها تُصدّق.
 *   2) الأسرار تُوضع في متغيّرات بيئة هذه الدالّة (Supabase Secrets)، ولا
 *      تُكتب في قاعدة البيانات: جدول `integration_settings` يحفظ **اسم
 *      المرجع** فقط، والقاعدة ترفض ما يبدو مفتاحًا.
 *   3) تُجدوَل هذه الدالّة كل بضع دقائق (Supabase Cron).
 *
 * **لا شيء هنا يخصّ الرسائل النصية**: قائمة التكاملات في القاعدة لا تقبل
 * `sms` أصلًا.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

type Kind = "einvoice" | "nphies";

interface DueMessage {
  id: string;
  organization_id: string;
  kind: Kind;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// مفتاح الخدمة يبقى في بيئة الدالّة ولا يغادرها إلى أيّ عميل
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE = 25;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

/** الرسائل التي حان موعد محاولتها ولم تمت بعد. */
async function fetchDue(): Promise<DueMessage[]> {
  const nowIso = new Date().toISOString();
  const out: DueMessage[] = [];

  const { data: einvoices, error: e1 } = await supabase
    .from("einvoice_documents")
    .select("id, organization_id")
    .eq("failed_permanently", false)
    .in("status", ["pending", "generated", "submitted"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(BATCH_SIZE);
  if (e1) throw e1;
  for (const row of einvoices ?? []) {
    out.push({ id: row.id, organization_id: row.organization_id, kind: "einvoice" });
  }

  const { data: nphies, error: e2 } = await supabase
    .from("nphies_messages")
    .select("id, organization_id")
    .eq("failed_permanently", false)
    .in("status", ["queued", "sending"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(BATCH_SIZE);
  if (e2) throw e2;
  for (const row of nphies ?? []) {
    out.push({ id: row.id, organization_id: row.organization_id, kind: "nphies" });
  }

  return out;
}

/**
 * الإرسال الفعلي — **غير مُنفَّذ عمدًا**.
 * اربطه بعميل المزوّد، وأعد النجاح أو ارمِ خطأً برسالة مفهومة: نصّ الخطأ
 * يُحفظ في `last_error` ويظهر لمن يعيد الإرسال، فاجعله يقول ما يجب إصلاحه.
 */
async function callProvider(_message: DueMessage): Promise<void> {
  throw new Error(
    "عميل المزوّد غير مربوط بعد — اربط زاتكا/نفيس هنا قبل تشغيل العامل",
  );
}

async function processOne(message: DueMessage): Promise<boolean> {
  try {
    await callProvider(message);
    await supabase.rpc("app_mark_integration_attempt", {
      p_kind: message.kind,
      p_id: message.id,
      p_success: true,
      p_error: null,
    });
    return true;
  } catch (error) {
    // الفشل يُبلَّغ للقاعدة: هي التي تجدول التالية أو تُميت الرسالة وتُنبّه
    await supabase.rpc("app_mark_integration_attempt", {
      p_kind: message.kind,
      p_id: message.id,
      p_success: false,
      p_error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

Deno.serve(async () => {
  try {
    const due = await fetchDue();
    let sent = 0;
    let failed = 0;
    for (const message of due) {
      if (await processOne(message)) sent += 1;
      else failed += 1;
    }
    return new Response(
      JSON.stringify({ picked: due.length, sent, failed }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
