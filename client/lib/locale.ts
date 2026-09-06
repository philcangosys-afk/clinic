import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";

/**
 * لغة عرض البيانات والتقويم والعملة — المرحلة 29.
 *
 * **ما يفعله هذا الملف وما لا يفعله، بصراحة:**
 *
 *  يفعل: يختار الاسم الإنجليزي حين تكون لغة عرض البيانات إنجليزية (وفي
 *  المخطط 45 عمود `name_en` لم يكن يقرؤها أحد)، وينسّق التواريخ بالتقويم
 *  الذي تختاره المنشأة (ميلادي/هجري/كليهما)، والمبالغ بعملة بلدها.
 *
 *  لا يفعل: **لا يترجم نصوص الواجهة نفسها** — العناوين والأزرار تبقى عربية
 *  في هذه المرحلة. ولذلك اسم الإعداد في الشاشة «لغة عرض البيانات» لا «لغة
 *  النظام»: تسميته الأخرى وعدٌ لا يُنفَّذ.
 *
 * ومصدر اللغة مرتّب: اختيار العضو لنفسه (`display_language`) يسبق افتراض
 * المنشأة (`data_language`).
 */
export type DataLanguage = "ar" | "en";
export type CalendarDisplay = "gregorian" | "hijri" | "both";

export interface LocaleSettings {
  countryCode: string;
  currencyCode: string;
  dataLanguage: DataLanguage;
  calendarDisplay: CalendarDisplay;
  enforceIdValidation: boolean;
}

const FALLBACK: LocaleSettings = {
  countryCode: "SA",
  currencyCode: "SAR",
  dataLanguage: "ar",
  calendarDisplay: "gregorian",
  enforceIdValidation: false,
};

export function useLocaleSettings(): LocaleSettings {
  const { organization, membership } = useOrganizationAccess();

  const settings = useQuery({
    queryKey: ["locale-settings", organization?.id],
    enabled: Boolean(organization?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_locale_settings").select("*")
        .eq("organization_id", organization!.id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const row = settings.data;
  const orgLanguage = (row?.data_language ?? FALLBACK.dataLanguage) as DataLanguage;
  // اختيار العضو لنفسه يسبق افتراض المنشأة
  const memberLanguage = (membership as any)?.display_language as DataLanguage | undefined;

  return {
    countryCode: row?.country_code ?? FALLBACK.countryCode,
    currencyCode: row?.currency_code ?? FALLBACK.currencyCode,
    dataLanguage: memberLanguage ?? orgLanguage,
    calendarDisplay: (row?.calendar_display ?? FALLBACK.calendarDisplay) as CalendarDisplay,
    enforceIdValidation: Boolean(row?.enforce_id_validation),
  };
}

/**
 * الاسم بلغة العرض. **لا يُترك فارغًا أبدًا**: إن غاب الاسم الإنجليزي يُعرض
 * العربي بدله — صفٌّ فارغ في جدول أسوأ من اسمٍ بلغةٍ أخرى.
 */
export function localName(
  row: { name_ar?: string | null; name_en?: string | null; name?: string | null } | null | undefined,
  language: DataLanguage,
): string {
  if (!row) return "";
  const ar = row.name_ar ?? row.name ?? "";
  const en = row.name_en ?? "";
  if (language === "en") return en.trim() || ar;
  return ar.trim() || en;
}

/** هل الاسم معروض بلغة غير المطلوبة؟ يُستعمل لوسم النقص في الشاشات. */
export function isFallbackName(
  row: { name_ar?: string | null; name_en?: string | null } | null | undefined,
  language: DataLanguage,
): boolean {
  if (!row) return false;
  if (language !== "en") return false;
  return !(row.name_en ?? "").trim() && Boolean((row.name_ar ?? "").trim());
}

const HIJRI_LOCALE = "ar-SA-u-ca-islamic-umalqura";

/**
 * العربية بأرقام لاتينية وتقويم ميلادي **صريحين**.
 *
 * `"ar-SA"` وحدها لا تعني ما تبدو أنها تعنيه: المتصفّحات تُرجع بها التقويم
 * الهجري (أم القرى) والأرقام العربية-الهندية (٠١٢٣). فكان إعداد المنشأة
 * «تقويم ميلادي» يُنتج تاريخًا هجريًا، والمبالغ تُطبع بأرقام لا تُطابق أرقام
 * الفاتورة المطبوعة ولا رقم الفاتورة اللاتيني في الصف نفسه — فتظهر الجداول
 * المالية «مقطّعة» بخلط اتجاهَين وأبجديتَي أرقام في السطر الواحد.
 *
 * التصريح بـ`-u-ca-gregory-nu-latn` يجعل النتيجة واحدة في كل متصفّح.
 */
const AR_GREGORIAN = "ar-SA-u-ca-gregory-nu-latn";
const AR_NUMBERS = "ar-SA-u-nu-latn";

/**
 * التاريخ بالتقويم المختار. التحويل الهجري يتمّ في المتصفّح عبر `Intl`
 * (تقويم أم القرى) — لا جدول تحويل يدويّ في القاعدة، لأن جدولًا يدويًّا
 * يتأخّر عن التعديلات الرسمية ويُنتج تواريخ خاطئة بصمت.
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  calendar: CalendarDisplay = "gregorian",
  language: DataLanguage = "ar",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const gregorian = date.toLocaleDateString(language === "en" ? "en-GB" : AR_GREGORIAN, {
    year: "numeric", month: "2-digit", day: "2-digit",
  });

  if (calendar === "gregorian") return gregorian;

  let hijri = "";
  try {
    hijri = date.toLocaleDateString(HIJRI_LOCALE, {
      year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    // متصفّح بلا دعم أم القرى: يُعرض الميلادي بدل تاريخٍ مخترع
    return gregorian;
  }

  if (calendar === "hijri") return hijri;
  return `${hijri} · ${gregorian}`;
}

/** المبلغ بعملة المنشأة — لا رمز ريال مثبَّت في الشيفرة. */
export function formatMoney(
  value: unknown,
  currencyCode = "SAR",
  language: DataLanguage = "ar",
): string {
  const amount = Number(value ?? 0);
  try {
    return amount.toLocaleString(language === "en" ? "en-US" : AR_NUMBERS, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

/**
 * مبلغ في عمود جدول — بلا رمز عملة وبمنزلتَين عشريتَين دائمًا.
 *
 * رمز العملة في كل خلية من ستّة أعمدة مالية يُضاعف عرض الجدول ويكرّر ما
 * يقوله عنوان العمود مرّة، فيُكتب في العنوان ويُترك الرقم صافيًا. والمنزلتان
 * ثابتتان: عمودٌ فيه «150» و«149.5» و«3.75» لا تصطفّ أرقامه فيُقرأ خطأً.
 */
export function formatAmount(value: unknown, language: DataLanguage = "ar"): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString(language === "en" ? "en-US" : AR_NUMBERS, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** عدد صحيح (كمّيات، أعداد) بأرقام لاتينية موحَّدة. */
export function formatCount(value: unknown, language: DataLanguage = "ar"): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString(language === "en" ? "en-US" : AR_NUMBERS, {
    maximumFractionDigits: 3,
  });
}

/** الوقت بأرقام لاتينية — بلا ثوانٍ. */
export function formatTime(
  value: string | number | Date | null | undefined,
  language: DataLanguage = "ar",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(language === "en" ? "en-GB" : AR_NUMBERS, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** التاريخ والوقت في سطر واحد — للجداول التي لا تتحمّل عمودَين. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  calendar: CalendarDisplay = "gregorian",
  language: DataLanguage = "ar",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDate(date, calendar, language)} · ${formatTime(date, language)}`;
}
