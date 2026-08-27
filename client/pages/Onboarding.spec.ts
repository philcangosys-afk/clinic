import { describe, expect, it } from "vitest";
import { organizationTypes } from "./Onboarding";

describe("onboarding organization types", () => {
  it("offers exactly the clinic and integrated medical center choices", () => {
    expect(organizationTypes).toEqual([
      expect.objectContaining({ value: "clinic", label: "عيادة" }),
      expect.objectContaining({ value: "medical_center", label: "مركز طبي متكامل" }),
    ]);
    expect(organizationTypes).toHaveLength(2);
  });
});
