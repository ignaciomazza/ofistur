import { describe, expect, it } from "vitest";
import { calculateGroupInvoiceServiceTotals } from "@/lib/groups/groupInvoiceServiceTotals";

describe("group invoice service totals", () => {
  it("sums services in the same currency", () => {
    expect(
      calculateGroupInvoiceServiceTotals({
        requestedServiceIds: [1, 2],
        services: [
          { serviceId: 1, currency: "usd", amount: 120 },
          { serviceId: 2, currency: "USD", amount: 80 },
        ],
      }),
    ).toEqual({ ok: true, currency: "USD", total: 200 });
  });

  it("rejects a mixed-currency invoice", () => {
    const result = calculateGroupInvoiceServiceTotals({
      requestedServiceIds: [1, 2],
      services: [
        { serviceId: 1, currency: "ARS", amount: 100_000 },
        { serviceId: 2, currency: "USD", amount: 100 },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "GROUP_FINANCE_INVOICE_CURRENCY_MIX_NOT_ALLOWED",
    });
  });

  it("rejects a service that disappeared from the passenger context", () => {
    const result = calculateGroupInvoiceServiceTotals({
      requestedServiceIds: [1, 2],
      services: [{ serviceId: 1, currency: "USD", amount: 100 }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "GROUP_FINANCE_INVOICE_SERVICE_NOT_FOUND",
    });
  });
});
