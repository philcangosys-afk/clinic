import { describe, expect, it } from "vitest";
import { organizationType } from "./Onboarding";

describe("onboarding organization type", () => {
  it("uses the integrated medical center type", () => {
    expect(organizationType).toEqual(expect.objectContaining({
      value: "medical_center",
      label: "مركز طبي متكامل",
    }));
  });
});
