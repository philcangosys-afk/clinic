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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: deviceName ? { "x-device-name": deviceName } : {},
  },
});
