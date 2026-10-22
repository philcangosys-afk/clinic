import { useEffect } from "react";
import { focusManager, useQueryClient, type Query } from "@tanstack/react-query";

/**
 * إيقاف التحديث الدوريّ عند خمول الجهاز (22/10/2026).
 *
 * أجهزة العيادة تبقى مفتوحةً طوال اليوم، وكلّ شاشةٍ فيها تسأل القاعدة كلّ
 * 30–60 ثانية ولو لم يلمسها أحد ساعات. على خادم Nano هذا ما يستنزف رصيد
 * قراءة/كتابة القرص حتى يتوقّف النظام (8/10، 22/10).
 *
 * بعد 5 دقائق بلا حركة (فأرة، لمس، لوحة مفاتيح، تمرير) يُعلَن للمكتبة أنّ
 * الصفحة «غير مركَّزة»، فتتوقّف كلّ دورة تحديث — كما تتوقّف أصلًا والتبويب
 * في الخلفية. ومع أوّل حركة يعود الوضع الطبيعيّ وتُجلب فورًا الشاشات التي
 * لها دورة تحديث، فلا يرى المستخدم رقمًا قديمًا.
 *
 * ما لا يتوقّف:
 * - التحديث الفوريّ (Realtime): «وصل»، «نداء»، «دخل»، «خرج»، وطلبات المتابعة
 *   تُبطل مفاتيحها فتُجلب في الحال ولو كان الجهاز خاملًا.
 * - تنبيهات المستخدم وصوتها (`LiveNotifier`): تعمل بـ refetchIntervalInBackground
 *   فلا يخضع لهذا الإيقاف — شاشة الطبيب تبقى بلا نقر وتنبّه.
 * - مُبلِّغ ZATCA في المتصفّح ومهمّة الخادم المجدولة.
 */
const IDLE_MS = 5 * 60 * 1000;
const CHECK_MS = 30 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

type ObservedQuery = { observers?: Array<{ options: { refetchInterval?: unknown } }> };

/** الاستعلامات النشطة التي لها دورة تحديث — هي وحدها تُجلب عند العودة. */
const hasRefetchInterval = (query: Query) =>
  ((query as unknown as ObservedQuery).observers ?? []).some((observer) => {
    const interval = observer.options.refetchInterval;
    return typeof interval === "number" ? interval > 0 : typeof interval === "function";
  });

export default function IdleQueryPause() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let lastActivity = Date.now();
    let idle = false;

    const wake = () => {
      lastActivity = Date.now();
      if (!idle) return;
      idle = false;
      // يعود الحكم لظهور التبويب كما في الوضع الافتراضيّ للمكتبة
      focusManager.setFocused(undefined);
      void queryClient.refetchQueries({ type: "active", predicate: hasRefetchInterval });
    };

    const timer = window.setInterval(() => {
      if (!idle && Date.now() - lastActivity >= IDLE_MS) {
        idle = true;
        focusManager.setFocused(false);
      }
    }, CHECK_MS);

    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, wake, { passive: true, capture: true }));
    return () => {
      window.clearInterval(timer);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, wake, { capture: true }));
      focusManager.setFocused(undefined);
    };
  }, [queryClient]);

  return null;
}
