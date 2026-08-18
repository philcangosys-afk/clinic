import { describe, expect, it } from "vitest";
import type { FeatureKey } from "@shared/api";
import { canAccessFeature, resolvePermissions } from "./organization-access";
import { filterAccessibleModules, groupModules, type ModuleRegistryItem } from "./module-registry";
import { LayoutDashboard } from "lucide-react";

const items: ModuleRegistryItem[] = [
  { id: "first", label: "الأول", icon: LayoutDashboard, featureKey: "patients", requiredPermission: "view", category: "مجموعة", order: 1 },
  { id: "second", label: "الثاني", icon: LayoutDashboard, featureKey: "appointments", requiredPermission: "view", category: "مجموعة", order: 2 },
];

const access = (enabledFeatures: FeatureKey[]) => (featureKey: FeatureKey, permissionKey: string) => canAccessFeature({
  legacyMode: false,
  featureKey,
  permissionKey,
  enabledFeatures,
  permissions: ["view"],
  role: "staff",
});

describe("organization module access", () => {
  it("keeps all modules visible in legacy mode", () => {
    expect(filterAccessibleModules(items, () => true)).toEqual(items);
  });

  it("filters disabled features and preserves the category of remaining items", () => {
    const visible = filterAccessibleModules(items, access(["appointments"]));
    expect(visible.map((item) => item.id)).toEqual(["second"]);
    expect(groupModules(visible)).toEqual([{ section: "مجموعة", items: [items[1]] }]);
  });

  it("keeps dashboard and settings available to prevent lockout", () => {
    expect(canAccessFeature({ legacyMode: false, featureKey: "settings", permissionKey: "view", enabledFeatures: [], permissions: ["view"], role: "staff" })).toBe(true);
    expect(canAccessFeature({ legacyMode: false, featureKey: "core_dashboard", permissionKey: "view", enabledFeatures: [], permissions: ["view"], role: "staff" })).toBe(true);
  });

  it("combines conservative role permissions with explicit overrides", () => {
    expect(resolvePermissions("receptionist", [{ permission_key: "reports_view", granted: true }, { permission_key: "view", granted: false }])).toEqual(expect.arrayContaining(["appointments_manage", "patients_register", "reports_view"]));
    expect(resolvePermissions("receptionist", [{ permission_key: "view", granted: false }])).not.toContain("view");
    expect(resolvePermissions("owner", [])).toEqual(["*"]);
  });
});
