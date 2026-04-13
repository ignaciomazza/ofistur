import { describe, expect, it } from "vitest";
import {
  canAccessResourceSection,
  canManageResourceSection,
  canAccessBookingComponent,
  canAccessFinanceSection,
  normalizeRole,
  resolveCalendarDataScope,
  resolveCalendarVisibility,
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

  it("requires explicit booking grants for seller roles", () => {
    expect(canAccessBookingComponent("vendedor", [], "billing")).toBe(false);
    expect(canAccessBookingComponent("vendedor", [], "booking_status")).toBe(
      false,
    );
    expect(
      canAccessBookingComponent("vendedor", ["receipts_form"], "billing"),
    ).toBe(false);
    expect(
      canAccessBookingComponent("vendedor", ["billing"], "billing"),
    ).toBe(true);
  });

  it("always allows viewing resources and calendar", () => {
    expect(canAccessResourceSection("vendedor", [], "resources_notes")).toBe(
      true,
    );
    expect(canAccessResourceSection("vendedor", [], "calendar", true)).toBe(
      true,
    );
  });

  it("applies custom rules only to edit permissions", () => {
    expect(canManageResourceSection("lider", [], "resources_notes")).toBe(true);
    expect(canManageResourceSection("vendedor", [], "calendar")).toBe(false);
    expect(
      canManageResourceSection("vendedor", ["calendar"], "calendar", true),
    ).toBe(true);
    expect(
      canManageResourceSection(
        "administrativo",
        ["calendar"],
        "resources_notes",
        true,
      ),
    ).toBe(false);
    expect(
      canManageResourceSection(
        "administrativo",
        ["resources_notes"],
        "calendar",
        true,
      ),
    ).toBe(true);
  });

  it("resolves calendar visibility by role or custom rule", () => {
    expect(resolveCalendarVisibility("vendedor", null, false)).toBe("own");
    expect(resolveCalendarVisibility("gerente", null, false)).toBe("all");
    expect(
      resolveCalendarVisibility(
        "gerente",
        {
          id_user: 1,
          sections: [],
          calendar_visibility: "own",
        },
        true,
      ),
    ).toBe("own");
  });

  it("resolves calendar data scope by role", () => {
    expect(resolveCalendarDataScope("marketing")).toBe("all");
    expect(resolveCalendarDataScope("gerente")).toBe("all");
    expect(resolveCalendarDataScope("lider")).toBe("team");
    expect(resolveCalendarDataScope("vendedor")).toBe("own");
  });
});
