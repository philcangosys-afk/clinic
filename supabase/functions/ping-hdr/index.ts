// فحص: هل قيمة APP_ORIGIN صالحةً كترويسة؟ قيمةٌ فيها محرفٌ غير مسموح
// تجعل كل `new Response(... headers ...)` يرمي خطأً فيسقط العامل بلا رسالة.
Deno.serve(() => {
  const safe = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const raw = Deno.env.get("APP_ORIGIN") ?? "";
  const codes = [...raw].map((c) => c.codePointAt(0));
  let headerTest = "not tried";
  try {
    new Response("x", { headers: { "Access-Control-Allow-Origin": raw } });
    headerTest = "ok";
  } catch (error) {
    headerTest = "ERROR: " + String((error as Error)?.message ?? error).slice(0, 200);
  }
  let trimmedTest = "not tried";
  try {
    new Response("x", { headers: { "Access-Control-Allow-Origin": raw.trim() } });
    trimmedTest = "ok";
  } catch (error) {
    trimmedTest = "ERROR: " + String((error as Error)?.message ?? error).slice(0, 200);
  }
  return new Response(
    JSON.stringify({ length: raw.length, value: raw, codes, headerTest, trimmedTest }),
    { headers: safe },
  );
});
