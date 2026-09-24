// فحص: أيّ صيغة استيرادٍ تُنشئ عميل Supabase فعلًا (لا استيرادًا فقط)؟
// كلّ محاولة داخل try، فتظهر رسالة الخطأ بدل سقوط العامل بصمت.
import { createClient as npmCreate } from "npm:@supabase/supabase-js@2.45.4";
import { createClient as esmCreate } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve((req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const report: Record<string, string> = {};

  for (const [name, factory] of [["npm", npmCreate], ["esm", esmCreate]] as const) {
    try {
      const client = (factory as any)(url, key);
      report[name] = "ok: " + typeof client.from;
    } catch (error) {
      report[name] = "ERROR: " + String((error as Error)?.message ?? error).slice(0, 200);
    }
  }

  return new Response(JSON.stringify({ ok: true, report }), { headers });
});
