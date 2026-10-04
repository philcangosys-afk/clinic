import type {
  FeatureKey,
  HealthcareOrganizationType,
  MembershipPermission,
  OrganizationRole,
} from "@shared/api";

export const ALWAYS_ACCESSIBLE_FEATURES: FeatureKey[] = [
  "core_dashboard",
  "settings",
];

export const CLINIC_DEFAULT_FEATURES: FeatureKey[] = [
  "core_dashboard",
  "reception",
  "appointments",
  "patients",
  "medical_records",
  "patient_journey",
  "medical_services",
  "departments_clinics",
  "doctors",
  "prescriptions",
  "billing_payments",
  "hr",
  "diagnosis",
  "reports",
  "audit_log",
  "settings",
  // الأصول والصيانة (المرحلة 21) ميزة أساسية لكل منشأة — العيادة الواحدة
  // تملك أجهزة تحتاج صيانة ومعايرة تمامًا كالمركز الطبي.
  "assets",
  // المستندات والموافقات (المرحلة 22): الموافقة الموقَّعة شرطٌ لتنفيذ
  // إجراءات تطلبها — ميزة أساسية لا اختيارية.
  "documents",
  // التنبيهات (المرحلة 23): كل عضو يحتاج أن يصله ما يخصّه.
  "notifications",
  // بوابة المريض (المرحلة 24): متاحة لكل منشأة، وتُعطَّل من
  // "التحكم في المديولات" لمن لا يريدها.
  "patient_portal",
  // مساحة عمل الطبيب (المرحلة 25): القيم الحرجة فيها، وهي مسألة سلامة
  // مرضى لا رفاهية واجهة.
  "doctor_workspace",
  // الجودة وسلامة المرضى (المرحلة 26): بلاغ السلامة حقٌّ لكل عامل.
  "quality",
  // التكاملات (المرحلة 30): زاتكا ونفيس قائمتان في كل منشأة سعودية.
  "integrations",
  // مركز المتابعة (0173): ما يقوله الطبيب للاستقبال — وبه وحده، بعد أن صارت
  // الفوترة للاستقبال لا للطبيب.
  "follow_up_center",
];

export const MEDICAL_CENTER_ADDED_FEATURES: FeatureKey[] = [
  "laboratory",
  "radiology",
  "radiology_console",
  "vitals",
  "pharmacy",
  "dispensing",
  "insurance_claims",
  "packages",
  "accounting",
  "procurement",
  "inventory",
  "messaging",
  "nursing",
  "advanced_analytics",
  "content",
  "emergency",
  "dental_lab",
  "inpatient",
  "procedures",
  "referrals",
];

export function getOrganizationPlanDefaultFeatures(_type: HealthcareOrganizationType) {
  return [...CLINIC_DEFAULT_FEATURES, ...MEDICAL_CENTER_ADDED_FEATURES];
}

const allFeatureKeys: FeatureKey[] = [
  "core_dashboard",
  "radiology_console",
  "vitals",
  "reception",
  "appointments",
  "patients",
  "medical_records",
  "patient_journey",
  "medical_services",
  "departments_clinics",
  "doctors",
  "laboratory",
  "radiology",
  "pharmacy",
  "prescriptions",
  "dispensing",
  "insurance_claims",
  "billing_payments",
  "packages",
  "hr",
  "diagnosis",
  "content",
  "reports",
  "advanced_analytics",
  "accounting",
  "procurement",
  "inventory",
  "assets",
  "documents",
  "notifications",
  "patient_portal",
  "doctor_workspace",
  "quality",
  "integrations",
  "messaging",
  "audit_log",
  "settings",
  "nursing",
  "emergency",
  "dental_lab",
  "inpatient",
  "procedures",
  "referrals",
  "follow_up_center",
];

const viewPermissions = (features: FeatureKey[]) =>
  features.map((feature) => `${feature}.view`);

const rolePermissions: Record<Exclude<OrganizationRole, "owner" | "organization_admin">, string[]> = {
  // قوائم الأسعار والموارد صارتا مفتاحين مستقلّين عن «الخدمات» (0204)
  branch_manager: [...viewPermissions(allFeatureKeys), "price_lists.view", "resources.view", "medical_records.write"],
  doctor: [...viewPermissions([
    "core_dashboard",
    "appointments",
    "patients",
    "medical_records",
    "patient_journey",
    "medical_services",
    "doctors",
    "prescriptions",
    "documents",
    "notifications",
    "doctor_workspace",
    "quality",
    "follow_up_center",
  ]), "doctors.self_edit", "medical_records.write"],
  nurse: [...viewPermissions([
    "core_dashboard",
    "reception",
    "appointments",
    "patients",
    "medical_records",
    "patient_journey",
    "nursing",
    "assets",
    "documents",
    "notifications",
    "doctor_workspace",
    "quality",
  ]), "medical_records.write"],
  receptionist: viewPermissions([
    "core_dashboard",
    "reception",
    "appointments",
    "patients",
    "patient_journey",
    "billing_payments",
    "documents",
    "notifications",
    "patient_portal",
    "follow_up_center",
  ]),
  // فنّيو المختبر والأشعة يبلّغون عن أعطال أجهزتهم، فيحتاجون رؤية سجل الأصول.
  lab_technician: viewPermissions(["core_dashboard", "patients", "laboratory", "assets", "notifications"]),
  radiology_technician: viewPermissions(["core_dashboard", "patients", "radiology", "assets", "notifications"]),
  pharmacist: viewPermissions([
    "core_dashboard",
    "patients",
    "pharmacy",
    "prescriptions",
    "dispensing",
    "notifications",
  ]),
  accountant: viewPermissions([
    "core_dashboard",
    "billing_payments",
    "insurance_claims",
    "accounting",
    "reports",
    "assets",
    "documents",
    "notifications",
    "integrations",
  ]),
  hr_manager: viewPermissions(["core_dashboard", "hr", "reports", "documents", "notifications"]),
  employee: viewPermissions(["core_dashboard", "notifications"]),
};

export function isOrganizationAdmin(role: OrganizationRole | undefined) {
  return role === "owner" || role === "organization_admin";
}

export function resolvePermissions(
  role: OrganizationRole | undefined,
  explicitPermissions: MembershipPermission[],
  /**
   * صلاحيات الدور المخصّص (0183). حين يُسنَد دورٌ مخصّص **تحلّ مجموعته محلّ
   * افتراض الدور الأساس ولا تُضاف إليه**: «كاشير» مبنيٌّ على «موظف استقبال»
   * لكن بلا إلغاء المواعيد — ولو جُمعت المجموعتان لبقي الإلغاء.
   * والترتيب نفسه مطبَّقٌ في `app_has_permission`، فما تراه الشاشة هو ما
   * تسمح به القاعدة.
   */
  customRolePermissions?: string[] | null,
  /**
   * **جواب القاعدة نفسها** — مفاتيح `v_my_permissions` الممنوحة، وهي ناتج
   * `app_has_permission` لكل مفتاح في الكتالوج.
   *
   * حين تصل، تُستعمل وحدها. وما تحتها في هذه الدالّة (خريطة `rolePermissions`
   * والدور المخصّص والاستثناءات) **حسابٌ ثانٍ لنفس السؤال في المتصفّح** —
   * مصدرُ حقيقةٍ موازٍ يجب أن يُطابق القاعدة يدويًّا، وقد افترق عنها فعلًا:
   * `branch_manager` هنا يرى كلّ الشاشات، ودورٌ مخصّص بلا صلاحية واحدة كان
   * يُتجاوَز فيبقى الافتراض. فصار الحساب المحلّي احتياطًا لا أصلًا: لا
   * يُستعمل إلّا إن تعذّرت قراءة المنظور، فلا يُغلق النظام في وجه الجميع
   * لانقطاع استعلام.
   */
  databasePermissions?: string[] | null,
) {
  if (isOrganizationAdmin(role)) return ["*"];
  if (databasePermissions) return [...new Set(databasePermissions)];
  const permissions = new Set(
    customRolePermissions ? customRolePermissions : role ? rolePermissions[role] : [],
  );
  explicitPermissions.forEach((permission) => {
    if (permission.granted) permissions.add(permission.permission_key);
    else permissions.delete(permission.permission_key);
  });
  return [...permissions];
}

export function resolveOrganizationAccessConfiguration({
  authenticated,
  legacyMode,
  demoOrganizationType,
  enabledFeatures,
  permissions,
  role,
}: {
  authenticated: boolean;
  legacyMode: boolean;
  demoOrganizationType: HealthcareOrganizationType | null;
  enabledFeatures: FeatureKey[];
  permissions: string[];
  role?: OrganizationRole;
}) {
  if (!authenticated && legacyMode && demoOrganizationType) {
    return {
      legacyMode: false,
      enabledFeatures: getOrganizationPlanDefaultFeatures(demoOrganizationType),
      permissions: ["*"],
      role: "organization_admin" as OrganizationRole,
    };
  }
  return { legacyMode, enabledFeatures, permissions, role };
}

export function canAccessFeature({
  legacyMode,
  featureKey,
  permissionKey,
  enabledFeatures,
  permissions,
  role,
}: {
  legacyMode: boolean;
  featureKey: FeatureKey;
  permissionKey: string;
  enabledFeatures: FeatureKey[];
  permissions: string[];
  role?: OrganizationRole;
}) {
  if (legacyMode) return true;
  const featureEnabled =
    // منشأةٌ لم تُضبط مزاياها بعد (لا صفّ في `organization_features`) ليست
    // منشأةً بلا مزايا. ولولا هذا الشرط لأغلق رفعُ «الوصول الكامل القديم»
    // كلَّ شاشةٍ في وجه المالك نفسه — لأنّ فحص المزية يسبق فحص الصفة.
    enabledFeatures.length === 0 ||
    ALWAYS_ACCESSIBLE_FEATURES.includes(featureKey) ||
    enabledFeatures.includes(featureKey);
  if (!featureEnabled) return false;
  if (isOrganizationAdmin(role)) return true;
  return permissions.includes("*") || permissions.includes(permissionKey);
}
