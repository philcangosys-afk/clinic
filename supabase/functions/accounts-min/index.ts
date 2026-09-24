// فحص: نفس استيراد admin-users مع معالجٍ صغير
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const clean = (value: unknown) => String(value ?? "").trim();
let currentOrigin = "";
const getCorsHeaders = () => {
  const appOrigin = clean(Deno.env.get("APP_ORIGIN"));
  return {
    "Access-Control-Allow-Origin": appOrigin || currentOrigin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-name",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  currentOrigin = clean(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders() });
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const client = createClient(url, anon);
  return respond({
    ok: true,
    variant: "accounts-min",
    hasUrl: Boolean(url),
    hasAnon: Boolean(anon),
    hasService: Boolean(service),
    client: typeof client.auth,
  });
});
