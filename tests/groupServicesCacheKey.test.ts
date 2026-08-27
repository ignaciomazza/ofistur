import { describe, expect, it } from "vitest";
import { buildGroupServicesCacheKey } from "@/components/groups/collections/receipt-form/hooks/useServicesForGroupContext";

describe("group receipt services cache key", () => {
  it("isolates passengers that share the same financial context", () => {
    expect(buildGroupServicesCacheKey(700_100_011, "10:101")).not.toBe(
      buildGroupServicesCacheKey(700_100_011, "10:102"),
    );
  });

  it("keeps the legacy context-only scope for other consumers", () => {
    expect(buildGroupServicesCacheKey(42)).toBe("global::42");
  });
});
