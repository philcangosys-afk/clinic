// فحص: هل تستطيع الدالّة قراءة متغيّرات البيئة، وهل أسرار المشروع موجودة؟
// كل شيء داخل try حتى لا يسقط العامل بلا رسالة.
Deno.serve((req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  const report: Record<string, unknown> = {};
  for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_ORIGIN"]) {
    try {
      const value = Deno.env.get(key);
      report[key] = value ? `set(${String(value).length})` : "missing";
    } catch (error) {
      report[key] = "ERROR: " + String(error).slice(0, 120);
    }
  }
  try {
    report.denoVersion = Deno.version?.deno ?? "unknown";
  } catch (error) {
    report.denoVersion = "ERROR: " + String(error).slice(0, 120);
  }
  return new Response(JSON.stringify({ ok: true, report }), { headers });
});
