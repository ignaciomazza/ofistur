import { describe, expect, it } from "vitest";
import { canManageOperatorsWithGrants } from "@/lib/operatorAccess";

describe("operator access", () => {
  it("keeps manager roles enabled by default", () => {
    expect(canManageOperatorsWithGrants("administracion", [], [])).toBe(true);
  });

  it("does not open operator management to sellers without explicit grants", () => {
    expect(canManageOperatorsWithGrants("vendedor", [], [])).toBe(false);
  });

  it("allows sellers with operator-related grants", () => {
    expect(
      canManageOperatorsWithGrants("vendedor", ["operator_payments"], []),
    ).toBe(true);
    expect(
      canManageOperatorsWithGrants("vendedor", ["operators_insights"], []),
    ).toBe(true);
    expect(
      canManageOperatorsWithGrants("vendedor", [], ["operator_payments"]),
    ).toBe(true);
  });
});
