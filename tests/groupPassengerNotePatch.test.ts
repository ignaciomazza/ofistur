import { describe, expect, it } from "vitest";
import { parseOptionalStringPatch } from "@/lib/groups/apiShared";

describe("group passenger optional note patch", () => {
  it("accepts an omitted note without turning a metadata-only update invalid", () => {
    expect(parseOptionalStringPatch(undefined, 1000)).toEqual({
      provided: false,
      valid: true,
      value: undefined,
    });
  });

  it("normalizes an explicitly empty note and rejects invalid values", () => {
    expect(parseOptionalStringPatch("   ", 1000)).toEqual({
      provided: true,
      valid: true,
      value: null,
    });
    expect(parseOptionalStringPatch("x".repeat(1001), 1000).valid).toBe(false);
    expect(parseOptionalStringPatch(123, 1000).valid).toBe(false);
  });
});
