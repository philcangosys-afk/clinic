import type {
  FeatureKey,
  MembershipPermission,
  OrganizationRole,
} from "@shared/api";

export const ALWAYS_ACCESSIBLE_FEATURES: FeatureKey[] = [
  "core_dashboard",
  "settings",
];

const rolePermissions: Partial<Record<OrganizationRole, string[]>> = {
  branch_manager: ["view", "manage_branch"],
  doctor: ["view", "clinical_read", "clinical_write"],
  nurse: ["view", "clinical_read", "clinical_write"],
  receptionist: ["view", "appointments_manage", "patients_register"],
  lab_technician: ["view", "laboratory_manage"],
  pharmacist: ["view", "pharmacy_manage"],
  accountant: ["view", "finance_manage", "reports_view"],
  hr_manager: ["view", "hr_manage"],
  staff: ["view"],
};

export function isOrganizationAdmin(role: OrganizationRole | undefined) {
  return role === "owner" || role === "organization_admin";
}

export function resolvePermissions(
  role: OrganizationRole | undefined,
  explicitPermissions: MembershipPermission[],
) {
  if (isOrganizationAdmin(role)) return ["*"];
  const permissions = new Set(role ? rolePermissions[role] ?? [] : []);
  explicitPermissions.forEach((permission) => {
    const allowed = permission.allowed ?? permission.granted ?? true;
    if (allowed) permissions.add(permission.permission_key);
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
