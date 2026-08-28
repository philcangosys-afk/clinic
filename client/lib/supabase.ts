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
