import type {
  FeatureKey,
  MembershipPermission,
  OrganizationRole,
} from "@shared/api";

export const ALWAYS_ACCESSIBLE_FEATURES: FeatureKey[] = [
  "core_dashboard",
  "settings",
];

const allFeatureKeys: FeatureKey[] = [
  "core_dashboard",
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
  "messaging",
  "audit_log",
  "settings",
  "nursing",
  "emergency",
  "inpatient",
  "procedures",
  "referrals",
];

const viewPermissions = (features: FeatureKey[]) =>
  features.map((feature) => `${feature}.view`);

const rolePermissions: Record<Exclude<OrganizationRole, "owner" | "organization_admin">, string[]> = {
  branch_manager: viewPermissions(allFeatureKeys),
  doctor: viewPermissions([
    "core_dashboard",
    "appointments",
    "patients",
    "medical_records",
    "patient_journey",
    "medical_services",
    "doctors",
    "prescriptions",
  ]),
  nurse: viewPermissions([
    "core_dashboard",
    "reception",
    "appointments",
    "patients",
    "medical_records",
    "patient_journey",
    "nursing",
  ]),
  receptionist: viewPermissions([
    "core_dashboard",
    "reception",
    "appointments",
    "patients",
    "patient_journey",
    "billing_payments",
  ]),
  lab_technician: viewPermissions(["core_dashboard", "patients", "laboratory"]),
  radiology_technician: viewPermissions(["core_dashboard", "patients", "radiology"]),
  pharmacist: viewPermissions([
    "core_dashboard",
    "patients",
    "pharmacy",
    "prescriptions",
    "dispensing",
  ]),
  accountant: viewPermissions([
    "core_dashboard",
    "billing_payments",
    "insurance_claims",
    "accounting",
    "reports",
  ]),
  hr_manager: viewPermissions(["core_dashboard", "hr", "reports"]),
  employee: viewPermissions(["core_dashboard"]),
};

export function isOrganizationAdmin(role: OrganizationRole | undefined) {
  return role === "owner" || role === "organization_admin";
}

export function resolvePermissions(
  role: OrganizationRole | undefined,
  explicitPermissions: MembershipPermission[],
) {
  if (isOrganizationAdmin(role)) return ["*"];
  const permissions = new Set(role ? rolePermissions[role] : []);
  explicitPermissions.forEach((permission) => {
    if (permission.granted) permissions.add(permission.permission_key);
    else permissions.delete(permission.permission_key);
  });
  return [...permissions];
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
    ALWAYS_ACCESSIBLE_FEATURES.includes(featureKey) ||
    enabledFeatures.includes(featureKey);
  if (!featureEnabled) return false;
  if (isOrganizationAdmin(role)) return true;
  return permissions.includes("*") || permissions.includes(permissionKey);
}
