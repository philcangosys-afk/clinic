import { describe, expect, it } from "vitest";
import type { FeatureKey, OrganizationRole } from "@shared/api";
import {
  CLINIC_DEFAULT_FEATURES,
  MEDICAL_CENTER_ADDED_FEATURES,
  canAccessFeature,
  getOrganizationPlanDefaultFeatures,
  resolveOrganizationAccessConfiguration,
  resolvePermissions,
} from "./organization-access";
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
    expect(new Set(databaseFeatureKeys).size).toBe(41);
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

  it("keeps every current module visible with no demo selection", () => {
    const configuration = resolveOrganizationAccessConfiguration({
      authenticated: false,
      legacyMode: true,
      demoOrganizationType: null,
      enabledFeatures: [],
      permissions: [],
    });
    const visible = filterAccessibleModules(moduleRegistry, (featureKey, permissionKey) => canAccessFeature({ ...configuration, featureKey, permissionKey }));
    expect(visible).toEqual(moduleRegistry);
  });

  it("keeps the shared core modules in the unified center", () => {
    expect(CLINIC_DEFAULT_FEATURES).toHaveLength(23);
    expect(getOrganizationPlanDefaultFeatures("medical_center")).toEqual(
      expect.arrayContaining(CLINIC_DEFAULT_FEATURES),
    );
  });

  it("enables every medical and administrative module for the medical center", () => {
    expect(MEDICAL_CENTER_ADDED_FEATURES).toHaveLength(18);
    const configuration = resolveOrganizationAccessConfiguration({
      authenticated: false,
      legacyMode: true,
      demoOrganizationType: "medical_center",
      enabledFeatures: [],
      permissions: [],
    });
    expect(getOrganizationPlanDefaultFeatures("medical_center")).toHaveLength(41);
    expect(canAccessFeature({ ...configuration, featureKey: "laboratory", permissionKey: "laboratory.view" })).toBe(true);
    expect(canAccessFeature({ ...configuration, featureKey: "pharmacy", permissionKey: "pharmacy.view" })).toBe(true);
    expect(canAccessFeature({ ...configuration, featureKey: "accounting", permissionKey: "accounting.view" })).toBe(true);
    expect(canAccessFeature({ ...configuration, featureKey: "emergency", permissionKey: "emergency.view" })).toBe(true);
    expect(canAccessFeature({ ...configuration, featureKey: "dental_lab", permissionKey: "dental_lab.view" })).toBe(true);
    expect(canAccessFeature({ ...configuration, featureKey: "inpatient", permissionKey: "inpatient.view" })).toBe(true);
  });

  it("ignores demo selection for authenticated access", () => {
    const configuration = resolveOrganizationAccessConfiguration({
      authenticated: true,
      legacyMode: false,
      demoOrganizationType: "medical_center",
      enabledFeatures: ["reports"],
      permissions: ["*"],
      role: "organization_admin",
    });
    expect(configuration.enabledFeatures).toEqual(["reports"]);
    expect(canAccessFeature({ ...configuration, featureKey: "reports", permissionKey: "reports.view" })).toBe(true);
    expect(canAccessFeature({ ...configuration, featureKey: "laboratory", permissionKey: "laboratory.view" })).toBe(false);
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
