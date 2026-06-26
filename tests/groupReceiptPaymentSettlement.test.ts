import { describe, expect, it } from "vitest";
import {
  buildGroupReceiptSettlementBuckets,
  pickFullySettledGroupClientPaymentIds,
} from "@/lib/groups/groupReceiptPaymentSettlement";

describe("group receipt payment settlement", () => {
  it("settles client payments in the receipt base currency when converted", () => {
    expect(
      buildGroupReceiptSettlementBuckets({
        amount: 1_000_000,
        amountCurrency: "ARS",
        baseAmount: 720,
        baseCurrency: "USD",
      }),
    ).toEqual([{ currency: "USD", amount: 720 }]);
  });

  it("uses stored payment lines when a receipt has split currencies", () => {
    expect(
      buildGroupReceiptSettlementBuckets({
        amount: 150,
        amountCurrency: "ARS",
        payments: [
          { amount: 100, payment_currency: "ARS", fee_amount: 0 },
          { amount: 50, payment_currency: "USD", fee_amount: 0 },
        ],
      }),
    ).toEqual([
      { currency: "ARS", amount: 100 },
      { currency: "USD", amount: 50 },
    ]);
  });

  it("marks only fully covered installments in due-date order", () => {
    const ids = pickFullySettledGroupClientPaymentIds(
      [
        {
          id_travel_group_client_payment: 3,
          amount: 50,
          due_date: "2026-03-01",
        },
        {
          id_travel_group_client_payment: 1,
          amount: 80,
          due_date: "2026-01-01",
        },
        {
          id_travel_group_client_payment: 2,
          amount: 120,
          due_date: "2026-02-01",
        },
      ],
      200,
    );

    expect(ids).toEqual([1, 2]);
  });
});
