import type { OrganizationRole } from "@shared/api";

/**
 * وضع المعاينة بالأدوار.
 *
 * **ما هو بالضبط، وما ليس هو.** هذه طبقة عرضٍ فوق حسابك أنت: تختار صفة
 * (استقبال، أشعة، طبيب…) فتتبدّل الشاشات والقوائم لتُريك ما يراه صاحب تلك
 * الصفة. أمّا قاعدة البيانات فتظل تراك أنت — بصلاحياتك أنت. فلو فتحت
 * «الأشعة» ثم حاولت شيئًا لا يملكه مختصّ الأشعة حقًّا، فلن تمنعك القاعدة،
 * لأن الجلسة جلستك.
 *
 * لذلك: **هذا للعرض والتجربة، وليس اختبارًا للصلاحيات.** اختبار الصلاحيات
 * الحقيقي يحتاج حسابًا مستقلًّا لكل موظّف — وعندها تعمل هذه الشاشات نفسها
 * بلا تغيير، لأنها تقرأ الدور من العضوية حين توجد.
 *
 * الاختيار محفوظ في `localStorage` لهذا المتصفّح وحده، ولا يُرسل للقاعدة.
 */
export type DemoRoleKey =
  | "organization_admin"
  | "receptionist"
  | "doctor"
  | "radiology_technician"
  | "lab_technician"
  | "dental_lab_technician"
  | "accountant";

export type DemoRoleDefinition = {
  key: DemoRoleKey;
  label: string;
  description: string;
  /** الشاشة التي تفتح مباشرة بعد الدخول بهذه الصفة. */
  home: string;
  /**
   * الموديولات التي تظهر في القائمة الجانبية لهذه الصفة.
   * `null` تعني «كل شيء» — للإدارة والاستقبال، وهما اللوحة الكاملة.
   */
  modules: string[] | null;
};

export const DEMO_ROLES: DemoRoleDefinition[] = [
  {
    key: "organization_admin",
    label: "الإدارة",
    description: "اللوحة الكاملة — كل الشاشات والتقارير والإعدادات",
    home: "/",
    modules: null,
  },
  {
    key: "receptionist",
    label: "الاستقبال",
    description: "التسجيل والمواعيد وطلبات الأطباء والفوترة",
    home: "/reception",
    modules: null,
  },
  {
    key: "doctor",
    label: "الطبيب",
    description: "مرضاه، وطلب أشعة ومختبر، وما يصله من نتائج",
    home: "/doctor-workspace",
    modules: [
      "doctor-workspace",
      // يكتب للاستقبال ما يخصّ مريضه — بدل الفاتورة التي لم تعد له (0173)
      "follow-up-center",
      "patients",
      "appointments",
      "medical-records",
      "patient-visits",
      "patient-journey",
      "laboratory",
      "radiology",
      "vitals",
      "prescriptions",
      "documents",
      // الطبيب صاحب طلبية التركيب: يرسلها ويتابعها. و`0165` تمنحه
      // `dental_lab.view` و`dental_lab.manage` في القاعدة.
      "dental-lab",
    ],
  },
  {
    key: "radiology_technician",
    label: "الأشعة",
    description: "ما طُلب من صور، ورفعها إلى ملف المريض",
    home: "/radiology-console",
    modules: ["radiology-console", "radiology", "patients", "documents"],
  },
  {
    key: "lab_technician",
    label: "المختبر",
    description: "طلبات التحاليل وإدخال نتائجها",
    home: "/laboratory",
    modules: ["laboratory", "vitals", "patients", "documents"],
  },
  {
    key: "dental_lab_technician",
    label: "معمل الأسنان",
    description: "طلبيات التركيبات ومتابعتها مع المعامل، والأصناف والأرصدة",
    home: "/dental-lab",
    /**
     * ثلاث وحدات لا أكثر: القسم، والمرضى لقراءة الملفّ الذي تخصّه الطلبية،
     * والمشتريات لأنّ المعامل مورّدون تُدار بياناتهم هناك. وما زاد على ذلك
     * فتحٌ لا يحتاجه عمله.
     */
    modules: ["dental-lab", "patients", "suppliers"],
  },
  {
    key: "accountant",
    label: "المحاسب",
    description: "الفوترة والمدفوعات والقيود والتقارير المالية",
    home: "/billing",
    modules: [
      "billing",
      "accounting",
      "reports",
      "custom-reports",
      "insurance",
      "price-lists",
      "packages",
      "offers",
      // المحاسب يسجّل فواتير الموردين والمصروفات ويسدّد، ولا يطلب الشراء
      "purchase-invoices",
      "cash-expenses",
      "suppliers",
      "purchase-reports",
      // المحاسب يرى أرصدة المعامل ولا يُنشئ طلبيات — والقاعدة تمنحه
      // `dental_lab.view` دون `dental_lab.manage`.
      "dental-lab",
    ],
  },
];

const STORAGE_KEY = "zaincare-demo-role";

export type DemoRoleState = {
  role: DemoRoleKey;
  /** اسم مَن يجرّب — يظهر في الشريط العلوي فقط. */
  name: string;
  /** الطبيب المختار حين تكون الصفة «طبيب» — لتصفية مرضاه ولوحته. */
  doctorId?: string | null;
};

export function readDemoRole(): DemoRoleState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoRoleState;
    if (!parsed || !DEMO_ROLES.some((r) => r.key === parsed.role)) return null;
    return parsed;
  } catch {
    // متصفّح يمنع التخزين، أو قيمة تالفة — الوضع الطبيعي أن لا صفة مختارة.
    return null;
  }
}

export function writeDemoRole(state: DemoRoleState | null) {
  if (typeof window === "undefined") return;
  try {
    if (state === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // لا شيء يُكسر إن فشل الحفظ: الصفة تبقى لهذه الجلسة في الذاكرة.
  }
}

export function demoRoleDefinition(key: DemoRoleKey | null | undefined) {
  if (!key) return null;
  return DEMO_ROLES.find((r) => r.key === key) ?? null;
}

export function demoRoleLabel(key: DemoRoleKey | null | undefined) {
  return demoRoleDefinition(key)?.label ?? "";
}

/** هل يظهر هذا الموديول في القائمة لهذه الصفة؟ */
export function demoRoleAllowsModule(key: DemoRoleKey | null | undefined, moduleId: string) {
  const def = demoRoleDefinition(key);
  if (!def) return true;          // لا صفة مختارة = لا ترشيح
  if (def.modules === null) return true;
  return def.modules.includes(moduleId);
}

/**
 * الأدوار التي تُترجم إلى صفة معاينة حين يكون للمستخدم عضوية حقيقية.
 * تُستعمل ليبدأ صاحب الحساب الحقيقي من شاشته الصحيحة بلا اختيار.
 */
export function demoRoleFromMembership(roleKey: string | null | undefined): DemoRoleKey | null {
  if (!roleKey) return null;
  const direct = DEMO_ROLES.find((r) => r.key === roleKey);
  if (direct) return direct.key;
  if (roleKey === "owner" || roleKey === "branch_manager") return "organization_admin";
  if (roleKey === "nurse") return "doctor";
  return null;
}
