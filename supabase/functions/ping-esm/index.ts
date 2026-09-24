// فحص: هل تُقلع دالّةٌ تستورد مكتبة Supabase من esm.sh؟
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve((req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  return new Response(JSON.stringify({ ok: true, variant: "esm", createClient: typeof createClient }), { headers });
});
