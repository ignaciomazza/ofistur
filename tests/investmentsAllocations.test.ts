import { describe, expect, it } from "vitest";
import {
  buildCostOnlyDraftNumbers,
  buildCostProrationDraftNumbers,
  shouldConfirmFullExcessWithServices,
} from "@/utils/investments/allocations";

describe("investments/allocations", () => {
  it("prorates by cost in same currency", () => {
    const drafts = buildCostProrationDraftNumbers({
      services: [
        { id_service: 1, currency: "ARS", cost_price: 30 },
        { id_service: 2, currency: "ARS", cost_price: 70 },
      ],
      paymentCurrency: "ARS",
      paymentAmount: 100,
    });

    expect(drafts).not.toBeNull();
    expect(drafts?.[1]).toEqual({ amountService: 30, counterAmount: null });
    expect(drafts?.[2]).toEqual({ amountService: 70, counterAmount: null });
  });

  it("prorates with fx rates for simple multi-currency", () => {
    const drafts = buildCostProrationDraftNumbers({
      services: [
        { id_service: 10, currency: "USD", cost_price: 50 },
        { id_service: 11, currency: "USD", cost_price: 50 },
      ],
      paymentCurrency: "ARS",
      paymentAmount: 200,
      fxRatesByCurrency: { USD: 2 },
    });

    expect(drafts).not.toBeNull();
    expect(drafts?.[10]).toEqual({ amountService: 50, counterAmount: 100 });
    expect(drafts?.[11]).toEqual({ amountService: 50, counterAmount: 100 });
  });

  it("returns cost-only defaults", () => {
    const drafts = buildCostOnlyDraftNumbers({
      services: [
        { id_service: 20, currency: "USD", cost_price: 123.45 },
        { id_service: 21, currency: "USD", cost_price: 0 },
      ],
    });

    expect(drafts[20]).toEqual({ amountService: 123.45, counterAmount: null });
    expect(drafts[21]).toEqual({ amountService: 0, counterAmount: null });
  });

  it("detects when full payment would remain as excess with services selected", () => {
    expect(
      shouldConfirmFullExcessWithServices({
        hasServices: true,
        paymentAmount: 1000,
        assignedTotal: 0,
        excess: 1000,
      }),
    ).toBe(true);

    expect(
      shouldConfirmFullExcessWithServices({
        hasServices: true,
        paymentAmount: 1000,
        assignedTotal: 200,
        excess: 800,
      }),
    ).toBe(false);

    expect(
      shouldConfirmFullExcessWithServices({
        hasServices: false,
        paymentAmount: 1000,
        assignedTotal: 0,
        excess: 1000,
      }),
    ).toBe(false);
  });
});
