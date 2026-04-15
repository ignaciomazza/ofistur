import { describe, expect, it } from "vitest";
import { computePassengerPendingValue } from "@/lib/groups/passengerPending";

describe("passenger pending", () => {
  it("uses services minus receipts when services are available", () => {
    const result = computePassengerPendingValue({
      servicesByCurrency: { USD: 1000 },
      receiptsByCurrency: { USD: 250 },
      installmentsFallback: { amount: "999", count: 3 },
    });

    expect(result.source).toBe("services_minus_receipts");
    expect(result.amount).toBe("750.00 USD");
    expect(result.count).toBe(1);
    expect(result.breakdown[0]).toMatchObject({
      currency: "USD",
      services: 1000,
      receipts: 250,
      pending: 750,
    });
  });

  it("falls back to installments when no detectable services", () => {
    const result = computePassengerPendingValue({
      servicesByCurrency: {},
      receiptsByCurrency: { USD: 500 },
      installmentsFallback: { amount: "1200", count: 2 },
    });

    expect(result.source).toBe("installments_fallback");
    expect(result.amount).toBe("1200");
    expect(result.count).toBe(2);
    expect(result.breakdown).toEqual([]);
  });

  it("handles fully paid services as zero pending", () => {
    const result = computePassengerPendingValue({
      servicesByCurrency: { ARS: 1000 },
      receiptsByCurrency: { ARS: 1000 },
      installmentsFallback: { amount: "0", count: 0 },
    });

    expect(result.source).toBe("services_minus_receipts");
    expect(result.amount).toBe("0");
    expect(result.count).toBe(0);
  });
});
