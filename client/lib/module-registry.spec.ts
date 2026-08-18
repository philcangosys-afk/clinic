import { describe, expect, it } from "vitest";
import type { FeatureKey, OrganizationRole } from "@shared/api";
import { canAccessFeature, resolvePermissions } from "./organization-access";
import { filterAccessibleModules, moduleRegistry, settingsModule } from "./module-registry";

const databaseFeatureKeys: FeatureKey[] = [
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

function accessFor(role: OrganizationRole, enabledFeatures: FeatureKey[], legacyMode = false) {
  const permissions = resolvePermissions(role, []);
  return (featureKey: FeatureKey, permissionKey: string) => canAccessFeature({
    legacyMode,
    featureKey,
    permissionKey,
    enabledFeatures,
    permissions,
    role,
  });
}

describe("organization module access", () => {
  it("aligns every registered module and permission with database feature keys", () => {
    [...moduleRegistry, settingsModule].forEach((module) => {
      expect(databaseFeatureKeys).toContain(module.featureKey);
      expect(module.requiredPermission).toBe(`${module.featureKey}.view`);
    });
    expect(new Set(databaseFeatureKeys).size).toBe(33);
  });

  it("allows a doctor only the configured clinical modules", () => {
    const enabled = databaseFeatureKeys;
    const canAccess = accessFor("doctor", enabled);
    expect(canAccess("medical_records", "medical_records.view")).toBe(true);
    expect(canAccess("prescriptions", "prescriptions.view")).toBe(true);
    expect(canAccess("billing_payments", "billing_payments.view")).toBe(false);
    expect(canAccess("hr", "hr.view")).toBe(false);
  });

  it("prevents a lab technician from accessing finance", () => {
    const canAccess = accessFor("lab_technician", databaseFeatureKeys);
    expect(canAccess("laboratory", "laboratory.view")).toBe(true);
    expect(canAccess("billing_payments", "billing_payments.view")).toBe(false);
    expect(canAccess("accounting", "accounting.view")).toBe(false);
  });

  it("allows administrators to access enabled features", () => {
    const canAccess = accessFor("organization_admin", ["reports"]);
    expect(canAccess("reports", "reports.view")).toBe(true);
  });

  it("blocks disabled features for non-legacy access", () => {
    expect(accessFor("organization_admin", [])("reports", "reports.view")).toBe(false);
    expect(accessFor("doctor", [])("patients", "patients.view")).toBe(false);
  });

  it("keeps every current module visible in legacy mode", () => {
    const visible = filterAccessibleModules(moduleRegistry, accessFor("employee", [], true));
    expect(visible).toEqual(moduleRegistry);
  });

  it("applies explicit denied permissions after role defaults", () => {
    const permissions = resolvePermissions("doctor", [{
      organization_id: "org-1",
      user_id: "user-1",
      permission_key: "patients.view",
      granted: false,
    }]);
    expect(permissions).not.toContain("patients.view");
    expect(permissions).toContain("medical_records.view");
  });
});
