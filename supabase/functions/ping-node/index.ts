// فحص: هل تُقلع دالّةٌ تستورد وحدات node وحزمة jsrsasign الثقيلة؟
import { createHash } from "node:crypto";
import { KJUR } from "npm:jsrsasign@11.1.3";

Deno.serve((req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  return new Response(
    JSON.stringify({ ok: true, variant: "node", hash: typeof createHash, kjur: typeof KJUR }),
    { headers },
  );
});
