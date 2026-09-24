/**
 * نموذج الأدوار المخصّصة في الواجهة (0183).
 *
 * كتالوج الصلاحيات في القاعدة مسطَّح: مفتاحٌ ونطاق (`module_key`). والشاشة
 * تحتاج طبقتين — **قسمٌ** يجمع نطاقات متقاربة، و**نطاقٌ** له ثلاث حالات:
 * بدون وصول، قراءة فقط، إدارة كاملة. هذا الملفّ يحوّل بينهما.
 *
 * **قاعدة الحالات الثلاث:** «قراءة فقط» = مفاتيح العرض وحدها (`*.view`)،
 * و«إدارة كاملة» = كلّ مفاتيح النطاق. وما خالفهما — منحٌ انتقائيّ — يُسمّى
 * «مخصّص» ولا يُقسر على إحداها: قسرُه يمحو اختيارًا دقيقًا صنعه المالك.
 *
 * **«فتح الشاشات» نطاقٌ خاصّ:** مفاتيحه `<الشاشة>.view` واحدٌ لكلّ شاشة، وهي
 * ما يُظهر عناصر القائمة الجانبية. فتُعرض شاشةً شاشةً بحالتين لا ثلاث.
 */

/** الأدوار الثابتة في القاعدة — بها تُقاس سياسات الحماية (RLS). */
export const ROLE_LABELS: Record<string, string> = {
  owner: "مالك المنشأة",
  organization_admin: "مدير النظام",
  branch_manager: "مدير فرع",
  doctor: "طبيب",
  nurse: "ممرّض/ة",
  receptionist: "موظف استقبال",
  pharmacist: "صيدلاني",
  lab_technician: "فني مختبر",
  radiology_technician: "فني أشعة",
  accountant: "محاسب",
  hr_manager: "مدير موارد بشرية",
  employee: "موظف",
};

/** ما يصلح أساسًا لدورٍ مخصّص — «المالك» لا يُصنع من شاشة الأدوار. */
export const BASE_ROLE_KEYS = [
  "organization_admin",
  "branch_manager",
  "doctor",
  "nurse",
  "receptionist",
  "pharmacist",
  "lab_technician",
  "radiology_technician",
  "accountant",
  "hr_manager",
  "employee",
];

export type CatalogRow = {
  permission_key: string;
  name_ar: string;
  module_key: string;
  description_ar: string | null;
  display_order: number | null;
};

export type AccessLevel = "none" | "read" | "full" | "custom";

export const SCREENS_MODULE = "screens";

/** عناوين عربية لنطاقات الكتالوج — المفتاح الخام يُعرض إن استُجدّ نطاق. */
export const MODULE_LABELS: Record<string, string> = {
  screens: "فتح الشاشات",
  users: "المستخدمون والصلاحيات",
  security: "الخصوصية وسجل التدقيق",
  settings: "الإعدادات والسياسات",
  structure: "الفروع والأقسام",
  patients: "ملفات المرضى",
  reception: "الاستقبال",
  appointments: "المواعيد",
  visits: "الزيارات",
  vitals: "العلامات الحيوية",
  doctor_workspace: "مساحة عمل الطبيب",
  doctors: "الأطباء",
  exam_templates: "قوالب الفحص",
  laboratory: "المختبر",
  radiology: "الأشعة والتصوير",
  radiology_console: "محطة الأشعة",
  pharmacy: "الصيدلية وصرف الأدوية",
  inventory: "المخزون",
  purchasing: "المشتريات والموردون",
  catalog: "الأصناف والخدمات",
  billing: "الفوترة والمدفوعات",
  cashier: "الصندوق",
  accounting: "المحاسبة",
  insurance: "التأمين والمطالبات",
  documents: "المستندات",
  hr: "الموارد البشرية",
  quality: "الجودة والحوادث",
  assets: "الأصول والصيانة",
  messaging: "الرسائل",
  notifications: "التنبيهات",
  integrations: "التكاملات",
  portal: "بوابة المريض",
  reports: "التقارير",
  analytics: "التحليلات",
};

export const moduleLabel = (moduleKey: string) => MODULE_LABELS[moduleKey] ?? moduleKey;

/** القسم الذي ينتمي إليه كل نطاق — ما لم يُذكر يقع في «أخرى». */
const MODULE_SECTION: Record<string, string> = {
  screens: "فتح الشاشات",

  reception: "الاستقبال والمرضى",
  appointments: "الاستقبال والمرضى",
  patients: "الاستقبال والمرضى",
  visits: "الاستقبال والمرضى",
  portal: "الاستقبال والمرضى",

  doctors: "الطبّ والعيادات",
  doctor_workspace: "الطبّ والعيادات",
  exam_templates: "الطبّ والعيادات",
  vitals: "الطبّ والعيادات",

  laboratory: "المختبر والأشعة والصيدلية",
  radiology: "المختبر والأشعة والصيدلية",
  radiology_console: "المختبر والأشعة والصيدلية",
  pharmacy: "المختبر والأشعة والصيدلية",

  billing: "الفوترة والصندوق",
  cashier: "الفوترة والصندوق",
  insurance: "الفوترة والصندوق",

  accounting: "المحاسبة والمالية",

  purchasing: "المشتريات والمخزون",
  inventory: "المشتريات والمخزون",
  catalog: "المشتريات والمخزون",

  hr: "الموارد البشرية",

  assets: "الأصول والمستندات",
  documents: "الأصول والمستندات",

  quality: "الجودة والسلامة",

  reports: "التقارير والتحليلات",
  analytics: "التقارير والتحليلات",

  users: "النظام والمستخدمون",
  security: "النظام والمستخدمون",
  settings: "النظام والمستخدمون",
  structure: "النظام والمستخدمون",
  integrations: "النظام والمستخدمون",
  notifications: "النظام والمستخدمون",
  messaging: "النظام والمستخدمون",
};

export const SECTION_ORDER = [
  "فتح الشاشات",
  "الاستقبال والمرضى",
  "الطبّ والعيادات",
  "المختبر والأشعة والصيدلية",
  "الفوترة والصندوق",
  "المحاسبة والمالية",
  "المشتريات والمخزون",
  "الموارد البشرية",
  "الأصول والمستندات",
  "الجودة والسلامة",
  "التقارير والتحليلات",
  "النظام والمستخدمون",
  "أخرى",
];

export const sectionOf = (moduleKey: string) => MODULE_SECTION[moduleKey] ?? "أخرى";

export const isReadKey = (permissionKey: string) => permissionKey.endsWith(".view");

export type RoleModule = { key: string; label: string; rows: CatalogRow[] };
export type RoleSection = { key: string; modules: RoleModule[] };

/** يبني أقسام الشاشة من كتالوج القاعدة — لا قائمة ثابتة في الشيفرة. */
export function buildRoleSections(catalog: CatalogRow[]): RoleSection[] {
  const byModule = new Map<string, CatalogRow[]>();
  for (const row of catalog) {
    const list = byModule.get(row.module_key);
    if (list) list.push(row);
    else byModule.set(row.module_key, [row]);
  }

  const bySection = new Map<string, RoleModule[]>();
  for (const [key, rows] of byModule) {
    const section = sectionOf(key);
    const sorted = [...rows].sort(
      (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name_ar.localeCompare(b.name_ar, "ar"),
    );
    const list = bySection.get(section);
    const entry: RoleModule = { key, label: moduleLabel(key), rows: sorted };
    if (list) list.push(entry);
    else bySection.set(section, [entry]);
  }

  return [...bySection]
    .map(([key, modules]) => ({
      key,
      modules: modules.sort((a, b) => a.label.localeCompare(b.label, "ar")),
    }))
    .sort((a, b) => {
      const ai = SECTION_ORDER.indexOf(a.key);
      const bi = SECTION_ORDER.indexOf(b.key);
      return (ai < 0 ? SECTION_ORDER.length : ai) - (bi < 0 ? SECTION_ORDER.length : bi);
    });
}

/** حالة نطاقٍ بحسب المفاتيح الممنوحة. */
export function moduleLevel(rows: CatalogRow[], granted: Set<string>): AccessLevel {
  const keys = rows.map((row) => row.permission_key);
  const grantedKeys = keys.filter((key) => granted.has(key));
  if (grantedKeys.length === 0) return "none";
  if (grantedKeys.length === keys.length) return "full";
  const readKeys = keys.filter(isReadKey);
  if (readKeys.length > 0 && grantedKeys.length === readKeys.length && grantedKeys.every(isReadKey)) {
    return "read";
  }
  return "custom";
}

/** المفاتيح التي تُمنح عند اختيار حالة. */
export function keysForLevel(rows: CatalogRow[], level: Exclude<AccessLevel, "custom">): string[] {
  if (level === "none") return [];
  const keys = rows.map((row) => row.permission_key);
  return level === "full" ? keys : keys.filter(isReadKey);
}

export const LEVEL_LABELS: Record<AccessLevel, string> = {
  none: "بدون وصول",
  read: "قراءة فقط",
  full: "إدارة كاملة",
  custom: "مخصّص",
};

/** حالة قسمٍ كامل — تُعرض بجانب عنوانه وتُغيّر كلّ نطاقاته دفعةً واحدة. */
export function sectionLevel(modules: RoleModule[], granted: Set<string>): AccessLevel {
  const levels = modules.map((module) => moduleLevel(module.rows, granted));
  if (levels.every((level) => level === "none")) return "none";
  if (levels.every((level) => level === "full")) return "full";
  if (levels.every((level) => level === "read" || level === "none")) return "read";
  return "custom";
}
