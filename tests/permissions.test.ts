import { describe, expect, it } from "vitest";
import {
  canAccessBookingComponent,
  canAccessFinanceSection,
  normalizeRole,
} from "@/utils/permissions";

describe("permissions role normalization", () => {
  it("normalizes admin aliases to administrativo", () => {
    expect(normalizeRole("Administración")).toBe("administrativo");
    expect(normalizeRole("administracion")).toBe("administrativo");
    expect(normalizeRole("administrador")).toBe("administrativo");
    expect(normalizeRole("admin")).toBe("administrativo");
  });

  it("keeps admin defaults enabled for booking/finance permissions", () => {
    expect(
      canAccessBookingComponent("Administración", [], "receipts_form"),
    ).toBe(true);
    expect(canAccessFinanceSection("Administración", [], "receipts")).toBe(
      true,
    );
  });
});
