import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase public environment variables are not configured");
}

/**
 * اسم الجهاز يُقرأ من التخزين المحلي ويُرسَل كترويسة في كل طلب، فيلتقطه
 * مُحفِّز سجل التدقيق (`app_audit_log_auto` بعد 0043) ويحفظه في
 * `audit_log.device_name`.
 *
 * لماذا ترويسة لا عمود يُرسله كل استدعاء: التسجيل يتم في مُحفِّز داخل
 * القاعدة لا في كود العميل، فلا يوجد مكان في الاستدعاء يمرَّر فيه اسم الجهاز.
 * والترويسة تصل إلى المُحفِّز عبر `current_setting('request.headers')` بلا
 * تعديل أي استعلام في المشروع.
 *
 * تُقرأ مرة واحدة عند الإقلاع: تغييرها في شاشة إعدادات الجهاز يسري بعد إعادة
 * تحميل الصفحة — وهو مقبول لإعداد يُضبط مرة عند تجهيز الجهاز.
 */
function readDeviceName(): string {
  try {
    const raw = window.localStorage.getItem("zaincare-device-settings");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { deviceName?: string };
    // الترويسات لا تقبل إلا ASCII — الاسم العربي يُرمَّز بـ encodeURIComponent
    // ويفكّه المُحفِّز، وإلا رفض المتصفح الطلب كله.
    return parsed.deviceName ? encodeURIComponent(parsed.deviceName) : "";
  } catch {
    return "";
  }
}

const deviceName = typeof window === "undefined" ? "" : readDeviceName();

/**
 * الجلسة تنتهي بإغلاق المتصفّح (0218).
 *
 * الحاسوب الواحد في العيادة يعمل عليه أكثر من طبيب: من أغلق المتصفّح أو
 * الحاسوب ثم فتحه وجد شاشة الدخول لا حساب من كان قبله. Supabase يحفظ
 * الجلسة في التخزين المحلّيّ فتبقى أيّامًا، فتُربط بكعكة جلسةٍ بلا تاريخ
 * انتهاء — يمحوها المتصفّح عند إغلاقه، وتشترك فيها كلّ ألسنته. إن لم توجد
 * عند الإقلاع فهذا فتحٌ جديد للمتصفّح: تُمحى الجلسة المحفوظة قبل إنشاء
 * العميل، فيبدأ بلا دخول.
 */
const LIVE_COOKIE = "zc_live";

function endSessionIfBrowserWasClosed() {
  try {
    const alive = document.cookie.split(";").some((part) => part.trim().startsWith(`${LIVE_COOKIE}=`));
    if (!alive) {
      for (const key of Object.keys(window.localStorage)) {
        if (/^sb-.+-auth-token$/.test(key)) window.localStorage.removeItem(key);
      }
    }
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LIVE_COOKIE}=1; path=/; SameSite=Lax${secure}`;
  } catch {
    // متصفّحٌ يمنع الكعكات أو التخزين: تبقى الجلسة كما كانت
  }
}

if (typeof window !== "undefined") endSessionIfBrowserWasClosed();

/**
 * ═══ حارس الجلسة على طلبات البيانات (10/10/2026) ═══════════════════════════
 *
 * شكوى المالك: ظهر للمستخدم في شاشة المرضى
 *   «permission denied for table patients · GRANT SELECT … TO anon [42501]».
 *
 * السبب: رمز الدخول ينتهي كلّ ساعة ويُجدَّد في الخلفية. حين يتأخّر خادم الدخول
 * (سُجّل له 504 «context deadline exceeded» في ساعة ضغطٍ على القاعدة) يفشل
 * التجديد فشلًا «قابلًا للإعادة»، فتبقى الجلسة محفوظة لكنّ `supabase-js`
 * يُرسل الطلب **بمفتاح الزائر (anon)** بدل رمز المستخدم — فترفضه القاعدة
 * كما يجب (المرضى لا يُقرؤون بلا دخول)، وتُعرض رسالتها التقنية كما هي.
 *
 * الحارس: طلب بيانات يخرج بمفتاح الزائر **وفي المتصفّح جلسةٌ محفوظة** = تجديدٌ
 * فشل، لا زائر. فيُعاد التجديد (مرّتين بمهلة) ويُرسل الطلب برمز المستخدم. وإن
 * تعذّر يُعاد ردٌّ عربيّ واضح بدل رسالة الصلاحيات التقنية. الصفحات العامّة
 * (الحجز الإلكتروني) لا جلسة فيها، فتمرّ طلباتها بمفتاح الزائر كما هي.
 */
const SESSION_LOST_MESSAGE =
  "تعذّر تجديد جلسة الدخول — خادم الدخول بطيء لحظيًّا. أعد المحاولة بعد ثوانٍ، وإن تكرّر فسجّل الخروج ثمّ الدخول.";

function hasStoredSession(): boolean {
  try {
    return Object.keys(window.localStorage).some((key) => /^sb-.+-auth-token$/.test(key));
  } catch {
    return false;
  }
}

let recovering: Promise<string | null> | null = null;

/** تجديدٌ واحد مشترك لكلّ الطلبات المتزامنة — لا عشرات التجديدات معًا. */
function recoverAccessToken(): Promise<string | null> {
  if (!recovering) {
    recovering = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const { data } = await supabase.auth.refreshSession();
          if (data.session?.access_token) return data.session.access_token;
        } catch {
          // يُعاد مرّةً بعد مهلة
        }
      }
      return null;
    })().finally(() => {
      // التجديد التالي (بعد ساعة) يبدأ من جديد
      setTimeout(() => {
        recovering = null;
      }, 0);
    });
  }
  return recovering;
}

const guardedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/\/(rest|functions|storage)\/v1\//.test(url) && typeof window !== "undefined" && hasStoredSession()) {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers.get("Authorization") === `Bearer ${supabaseAnonKey}`) {
      const token = await recoverAccessToken();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      }
      return new Response(JSON.stringify({ code: "ZC_SESSION", message: SESSION_LOST_MESSAGE, details: null, hint: null }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  return fetch(input, init);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: deviceName ? { "x-device-name": deviceName } : {},
    fetch: guardedFetch,
  },
});
