import { describe, expect, it } from "vitest";
import { validateGroupReceiptDebt } from "@/lib/groups/groupReceiptDebtValidation";

const serviceUsd = {
  id_service: 1,
  currency: "USD",
  sale_price: 1440,
  card_interest: 0,
  taxableCardInterest: 0,
  vatOnCardInterest: 0,
};

describe("group receipt debt validation", () => {
  it("rejects overpay in same currency", () => {
    const result = validateGroupReceiptDebt({
      selectedServiceIds: [1],
      services: [serviceUsd],
      existingReceipts: [
        {
          service_refs: [1],
          amount: 1000,
          amount_currency: "USD",
          payment_fee_amount: 0,
          base_amount: null,
          base_currency: null,
        },
      ],
      currentReceipt: {
        amount: 500,
        amountCurrency: "USD",
        paymentFeeAmount: 0,
        baseAmount: null,
        baseCurrency: null,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("GROUP_FINANCE_OVERPAY_NOT_ALLOWED");
  });

  it("requires base conversion when payment currency differs", () => {
    const result = validateGroupReceiptDebt({
      selectedServiceIds: [1],
      services: [serviceUsd],
      existingReceipts: [],
      currentReceipt: {
        amount: 1_000_000,
        amountCurrency: "ARS",
        paymentFeeAmount: 0,
        baseAmount: null,
        baseCurrency: null,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("GROUP_FINANCE_BASE_CONVERSION_REQUIRED");
  });

  it("accepts conversion with base and keeps normalized services", () => {
    const result = validateGroupReceiptDebt({
      selectedServiceIds: [1, 1],
      services: [serviceUsd],
      existingReceipts: [],
      currentReceipt: {
        amount: 1_000_000,
        amountCurrency: "ARS",
        paymentFeeAmount: 0,
        baseAmount: 720,
        baseCurrency: "USD",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalizedServiceIds).toEqual([1]);
  });
});

