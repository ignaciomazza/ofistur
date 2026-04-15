import { describe, expect, it } from "vitest";
import {
  extractMonthKey,
  resolveInvestmentEffectiveDate,
  resolveInvestmentEffectiveMonthKey,
} from "@/utils/investments/effectiveDate";

describe("investments/effectiveDate", () => {
  it("prefers imputation month when requested", () => {
    const date = resolveInvestmentEffectiveDate(
      {
        imputation_month: "2026-04-01T03:00:00.000Z",
        paid_at: "2026-03-15T12:00:00.000Z",
        created_at: "2026-03-10T12:00:00.000Z",
      },
      { preferImputationMonth: true },
    );

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(3);
  });

  it("falls back to paid_at and then created_at", () => {
    const paidDate = resolveInvestmentEffectiveDate(
      {
        paid_at: "2026-03-15T12:00:00.000Z",
        created_at: "2026-03-10T12:00:00.000Z",
      },
      { preferImputationMonth: true },
    );
    expect(paidDate.toISOString()).toBe("2026-03-15T12:00:00.000Z");

    const createdDate = resolveInvestmentEffectiveDate(
      {
        created_at: "2026-03-10T12:00:00.000Z",
      },
      { preferImputationMonth: true },
    );
    expect(createdDate.toISOString()).toBe("2026-03-10T12:00:00.000Z");
  });

  it("resolves month keys for imputation and fallback dates", () => {
    expect(extractMonthKey("2026-07-01T03:00:00.000Z")).toBe("2026-07");

    const fromImputation = resolveInvestmentEffectiveMonthKey(
      {
        imputation_month: "2026-04-01T03:00:00.000Z",
        paid_at: "2026-03-15T12:00:00.000Z",
      },
      { preferImputationMonth: true },
    );
    expect(fromImputation).toBe("2026-04");

    const fallback = resolveInvestmentEffectiveMonthKey(
      {
        paid_at: "2026-03-15T12:00:00.000Z",
      },
      { preferImputationMonth: true },
    );
    expect(fallback).toBe("2026-03");
  });
});
