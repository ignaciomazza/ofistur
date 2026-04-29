import { describe, expect, it } from "vitest";
import {
  canAccessRouteByPlan,
  resolvePlanFeatureFromRoute,
} from "@/lib/planAccess";
import { normalizePlanKey } from "@/lib/billing/pricing";

describe("planAccess groups feature", () => {
  it("maps grouped routes to groups feature", () => {
    expect(resolvePlanFeatureFromRoute("/groups")).toBe("groups");
    expect(resolvePlanFeatureFromRoute("/groups/config")).toBe("groups");
    expect(resolvePlanFeatureFromRoute("/groups/abc123")).toBe("groups");
  });

  it("requires pro plan for groups when agency has active plan", () => {
    expect(canAccessRouteByPlan("basico", true, "/groups")).toBe(false);
    expect(canAccessRouteByPlan("medio", true, "/groups")).toBe(false);
    expect(canAccessRouteByPlan("pro", true, "/groups")).toBe(true);
  });

  it("normalizes plan keys before checking gated routes", () => {
    expect(normalizePlanKey("Pro")).toBe("pro");
    expect(normalizePlanKey(" BASICO ")).toBe("basico");
    expect(canAccessRouteByPlan("Pro" as never, true, "/other-incomes")).toBe(
      true,
    );
  });

  it("preserves legacy behavior for agencies without billing plan", () => {
    expect(canAccessRouteByPlan("basico", false, "/groups")).toBe(true);
    expect(canAccessRouteByPlan(null, false, "/groups/config")).toBe(true);
  });
});
