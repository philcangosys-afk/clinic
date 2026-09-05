/**
 * أدلّة الأقسام — النصّ الذي يظهر عند الضغط على زرّ «شرح القسم» العائم.
 *
 * القاعدة في كتابة هذه الأدلّة:
 * - تشرح المفهوم والارتباطات وأثر كل زرّ، بلغة موظّف العيادة لا لغة المطوّر.
 * - لا تذكر أسماء جداول ولا أعمدة ولا دوالّ ولا رموزًا تقنية: من يقرأ هذا
 *   يريد أن يعرف ماذا يضغط وما الذي سيحدث بعده، لا كيف بُني النظام.
 * - لا تذكر زرًّا غير موجود في الشاشة. الدليل الذي يوصف فيه زرّ لا وجود له
 *   أسوأ من غياب الدليل، لأنه يجعل المستخدم يظنّ أن النظام معطوب.
 */

export type GuideAction = {
  /** نصّ الزرّ أو التبويب كما يقرأه المستخدم على الشاشة */
  label: string;
  /** ما يحدث فعلًا بعد الضغط: أين تُحفظ، وأين تظهر بعد ذلك */
  effect: string;
};

export type GuideTerm = {
  term: string;
  meaning: string;
};

export type SectionGuide = {
  /** عنوان القسم كما يظهر في القائمة الجانبية */
  title: string;
  /** ما هذا القسم ولماذا يوجد — سطران على الأكثر */
  purpose: string;
  /** المفاهيم التي يجب فهمها قبل الاستعمال */
  concepts?: GuideTerm[];
  /** خطوات الاستعمال بالترتيب الطبيعي للعمل اليومي */
  flow?: string[];
  /** الأزرار والتبويبات الظاهرة وأثر كلٍّ منها */
  actions?: GuideAction[];
  /** الارتباطات: من أين تأتي بيانات هذا القسم وإلى أين تذهب */
  links?: string[];
  /** ما ينبغي الحذر منه أو ما يُفسَّر خطأً عادةً */
  cautions?: string[];
};

/**
 * مفاتيح الشاشات التي لها دليل. تُحفظ هنا — لا في ملفّ النصوص — حتى يعرف
 * الزرّ هل لهذه الشاشة شرح دون تحميل النصوص كلّها. الاختبار يمنع اختلاف هذه
 * القائمة عن النصوص الفعلية.
 */
export const SECTION_GUIDE_KEYS = [
  "dashboard",
  "services",
  "reception",
  "patient-profile",
  "appointments",
  "patients",
  "medical-records",
  "patient-journey",
  "waitlist",
  "patient-portal",
  "blocked-contacts",
  "departments",
  "price-lists",
  "resources",
  "doctors",
  "doctor-workspace",
  "laboratory",
  "vitals",
  "radiology",
  "radiology-console",
  "reference-data",
  "diagnoses",
  "exam-templates",
  "patient-visits",
  "pharmacy",
  "prescriptions",
  "dispensing",
  "insurance",
  "billing",
  "offers",
  "packages",
  "employees",
  "attendance",
  "leave",
  "payroll",
  "contracts",
  "recruitment",
  "performance",
  "training",
  "shifts",
  "hr-reports",
  "document-templates",
  "accounting",
  "procurement",
  "inventory",
  "warehouses",
  "assets",
  "dental-lab",
  "messaging",
  "external-clients",
  "audit",
  "content",
  "quality",
  "reports",
  "analytics",
  "custom-reports",
  "documents",
  "users",
  "licenses",
  "integrations",
  "launch-readiness",
  "system-control",
  "device-settings",
  "organization-settings",
  "operations-settings",
  "alerts",
  "settings",
];

const KEY_SET = new Set<string>(SECTION_GUIDE_KEYS);

/**
 * يستخرج مفتاح دليل الشاشة من مسارها. المسارات في هذا النظام هي معرّف
 * الموديول نفسه، وملفّ المريض هو الاستثناء الوحيد لأنه يحمل رقم المريض.
 */
export function guideKeyForPath(pathname: string): string | null {
  const clean = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  if (clean === "" || clean === "/") return "dashboard";
  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 0) return "dashboard";
  if (segments[0] === "patients" && segments.length > 1) return "patient-profile";
  return segments[0];
}

export function hasSectionGuide(key: string | null): boolean {
  return key !== null && KEY_SET.has(key);
}

/**
 * يحمّل نصّ الدليل عند الطلب. الاستيراد الديناميكي مقصود: نصوص الأدلّة
 * كبيرة، فلا يدفع ثمنها من لم يفتح لوح الشرح.
 */
export async function loadSectionGuide(key: string): Promise<SectionGuide | null> {
  if (!KEY_SET.has(key)) return null;
  const module = await import("./section-guides-data");
  return module.sectionGuides[key] ?? null;
}
