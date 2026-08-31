import { createClient } from "jsr:@supabase/supabase-js@2";

type Kind = "einvoice" | "nphies";

type DueMessage = {
  id: string;
  organization_id: string;
  kind: Kind;
  environment: "sandbox" | "simulation" | "production";
};

type IntegrationSetting = {
  base_url: string;
  secret_ref: string | null;
};

type ProviderResult = {
  status?: string;
  response_id?: string;
  [key: string]: unknown;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_TOKEN = Deno.env.get("INTEGRATION_WORKER_TOKEN")!;
const BATCH_SIZE = 25;
const REQUEST_TIMEOUT_MS = 30_000;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function fetchDue(): Promise<DueMessage[]> {
  const nowIso = new Date().toISOString();
  const out: DueMessage[] = [];

  const { data: einvoices, error: einvoiceError } = await supabase
    .from("einvoice_documents")
    .select("id, organization_id, environment")
    .eq("failed_permanently", false)
    .in("status", ["pending", "generated", "submitted"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(BATCH_SIZE);
  if (einvoiceError) throw einvoiceError;
  for (const row of einvoices ?? []) {
    out.push({ ...row, kind: "einvoice" } as DueMessage);
  }

  const { data: nphies, error: nphiesError } = await supabase
    .from("nphies_messages")
    .select("id, organization_id, environment")
    .eq("failed_permanently", false)
    .in("status", ["queued", "sending"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(BATCH_SIZE);
  if (nphiesError) throw nphiesError;
  for (const row of nphies ?? []) {
    out.push({ ...row, kind: "nphies" } as DueMessage);
  }

  return out.slice(0, BATCH_SIZE);
}

async function loadSetting(message: DueMessage): Promise<IntegrationSetting> {
  const integrationKey = message.kind === "einvoice" ? "zatca" : "nphies";
  const environment = message.environment === "production" ? "production" : "sandbox";
  const { data, error } = await supabase
    .from("integration_settings")
    .select("base_url, secret_ref")
    .eq("organization_id", message.organization_id)
    .eq("integration_key", integrationKey)
    .eq("environment", environment)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`إعداد ${integrationKey} ${environment} غير مفعّل`);
  return data;
}

async function loadPayload(message: DueMessage) {
  const table = message.kind === "einvoice" ? "einvoice_documents" : "nphies_messages";
  const fields = message.kind === "einvoice"
    ? "request_payload, xml_payload, invoice_hash, uuid_value"
    : "request_payload, request_id, message_type, correlation_id";
  const { data, error } = await supabase.from(table).select(fields).eq("id", message.id).single();
  if (error) throw error;
  return data;
}

async function callProvider(message: DueMessage): Promise<ProviderResult> {
  const setting = await loadSetting(message);
  if (!setting.secret_ref) throw new Error("اسم مرجع سر التكامل غير مضبوط");
  const credential = Deno.env.get(setting.secret_ref);
  if (!credential) throw new Error(`سر التكامل ${setting.secret_ref} غير موجود في بيئة الدالة`);

  const payload = await loadPayload(message);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(setting.base_url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        "x-idempotency-key": `${message.kind}:${message.id}`,
      },
      body: JSON.stringify({
        kind: message.kind,
        environment: message.environment,
        message_id: message.id,
        payload,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed: ProviderResult = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as ProviderResult;
      } catch {
        parsed = { body: raw.slice(0, 4_000) };
      }
    }
    if (!response.ok) {
      throw new Error(`فشل المزوّد HTTP ${response.status}: ${raw.slice(0, 1_000)}`);
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function saveProviderResult(message: DueMessage, result: ProviderResult) {
  const now = new Date().toISOString();
  if (message.kind === "einvoice") {
    const allowed = ["submitted", "accepted", "warning"];
    const status = allowed.includes(String(result.status)) ? String(result.status) : "submitted";
    const { error } = await supabase
      .from("einvoice_documents")
      .update({
        status,
        response_payload: result,
        submitted_at: now,
        responded_at: status === "submitted" ? null : now,
        cleared_at: status === "accepted" ? now : null,
      })
      .eq("id", message.id);
    if (error) throw error;
    return;
  }

  const allowed = ["sent", "acknowledged", "completed"];
  const status = allowed.includes(String(result.status)) ? String(result.status) : "sent";
  const { error } = await supabase
    .from("nphies_messages")
    .update({
      status,
      response_payload: result,
      response_id: typeof result.response_id === "string" ? result.response_id : null,
      sent_at: now,
      responded_at: status === "sent" ? null : now,
    })
    .eq("id", message.id);
  if (error) throw error;
}

async function processOne(message: DueMessage): Promise<boolean> {
  try {
    const result = await callProvider(message);
    await saveProviderResult(message, result);
    const { error } = await supabase.rpc("app_mark_integration_attempt", {
      p_kind: message.kind,
      p_id: message.id,
      p_success: true,
      p_error: null,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    await supabase.rpc("app_mark_integration_attempt", {
      p_kind: message.kind,
      p_id: message.id,
      p_success: false,
      p_error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

Deno.serve(async (request) => {
  if (!WORKER_TOKEN || request.headers.get("x-worker-token") !== WORKER_TOKEN) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const due = await fetchDue();
    let sent = 0;
    let failed = 0;
    for (const message of due) {
      if (await processOne(message)) sent += 1;
      else failed += 1;
    }
    return new Response(JSON.stringify({ picked: due.length, sent, failed }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
