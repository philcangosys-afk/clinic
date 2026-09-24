/**
 * ping — دالّة فحصٍ لا تستورد شيئًا ولا تقرأ سرًّا.
 *
 * غرضها سؤالٌ واحد: هل تُقلع أيّ دالّة طرفية في هذا المشروع أصلًا؟ فالدوالّ
 * الثلاث تردّ «Internal Server Error» على كلّ طلب — وهو تعثّرٌ قبل الوصول إلى
 * الشيفرة. فإن ردّت هذه «pong» كان الخلل في استيراداتنا، وإن تعثّرت هي أيضًا
 * فالخلل في المشروع نفسه لا في الشيفرة.
 *
 * تُحذف بعد انتهاء الفحص:
 *   npx supabase functions delete ping --project-ref <REF>
 */
Deno.serve((req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  return new Response(JSON.stringify({ ok: true, message: "pong", method: req.method }), { headers });
});
