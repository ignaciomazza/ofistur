import { afterEach, describe, expect, it } from "vitest";
import {
  addBusinessDaysAr,
  isBusinessDayAr,
  nextBusinessDayAr,
  resolveOperationalDateAr,
} from "@/services/collections/core/businessCalendarAr";

describe("businessCalendarAr", () => {
  afterEach(() => {
    delete process.env.BILLING_AR_HOLIDAYS_JSON;
  });

  it("detects weekend as non business day", () => {
    expect(isBusinessDayAr("2026-03-07")).toBe(false); // sábado
    expect(isBusinessDayAr("2026-03-08")).toBe(false); // domingo
    expect(isBusinessDayAr("2026-03-09")).toBe(true); // lunes
  });

  it("supports AR holidays from env and resolves next business day", () => {
    process.env.BILLING_AR_HOLIDAYS_JSON = '["2026-03-09"]';

    expect(isBusinessDayAr("2026-03-09")).toBe(false);
    expect(nextBusinessDayAr("2026-03-08")).toBe("2026-03-10");
  });

  it("adds business days skipping weekend and holidays", () => {
    process.env.BILLING_AR_HOLIDAYS_JSON = "2026-03-09";

    const result = addBusinessDaysAr("2026-03-06", 1); // viernes +1 => martes (lunes feriado)
    expect(result.toISOString().slice(0, 10)).toBe("2026-03-10");
  });

  it("resolveOperationalDateAr defers non-business day unless allowNonBusinessDay=true", () => {
    const deferred = resolveOperationalDateAr({
      targetDateAr: "2026-03-08",
      allowNonBusinessDay: false,
    });

    expect(deferred.target_date_ar).toBe("2026-03-08");
    expect(deferred.business_day).toBe(false);
    expect(deferred.deferred_to_next_business_day).toBe(true);
    expect(deferred.business_date_ar).toBe("2026-03-09");

    const nonDeferred = resolveOperationalDateAr({
      targetDateAr: "2026-03-08",
      allowNonBusinessDay: true,
    });
    expect(nonDeferred.business_date_ar).toBe("2026-03-08");
    expect(nonDeferred.deferred_to_next_business_day).toBe(false);
  });
});
