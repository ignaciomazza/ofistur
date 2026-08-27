import { describe, expect, it } from "vitest";
import {
  areGroupReceiptCreditsEquivalent,
  validateGroupReceiptDebt,
} from "@/lib/groups/groupReceiptDebtValidation";

const serviceUsd = {
  id_service: 1,
  currency: "USD",
  sale_price: 1440,
  card_interest: 0,
  taxableCardInterest: 0,
  vatOnCardInterest: 0,
};

describe("group receipt debt validation", () => {
  it("recognizes equivalent credited amounts across stored shapes", () => {
    expect(
      areGroupReceiptCreditsEquivalent(
        {
          service_refs: [1],
          amount: 100_000,
          amount_currency: "ARS",
          payment_fee_amount: 0,
          base_amount: 100,
          base_currency: "USD",
        },
        {
          amount: 100_000,
          amountCurrency: "ARS",
          paymentFeeAmount: 0,
          baseAmount: 100,
          baseCurrency: "USD",
        },
      ),
    ).toBe(true);
  });

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

  it("uses payment lines/fees by currency to avoid false ARS overpay", () => {
    const result = validateGroupReceiptDebt({
      selectedServiceIds: [1],
      services: [
        {
          ...serviceUsd,
          sale_price: 110,
        },
      ],
      existingReceipts: [
        {
          service_refs: [1],
          amount: 100,
          amount_currency: "USD",
          payment_fee_amount: 10,
          base_amount: null,
          base_currency: null,
          payments: [
            { amount: 100, payment_currency: "USD", fee_amount: 0 },
            { amount: 0, payment_currency: "ARS", fee_amount: 10 },
          ],
        },
      ],
      currentReceipt: {
        amount: 10,
        amountCurrency: "USD",
        paymentFeeAmount: 0,
        baseAmount: null,
        baseCurrency: null,
        payments: [{ amount: 10, payment_currency: "USD", fee_amount: 0 }],
      },
    });

    expect(result.ok).toBe(true);
  });

  it("validates all passenger receipts against the manual sale total", () => {
    const accepted = validateGroupReceiptDebt({
      selectedServiceIds: [1],
      services: [{ ...serviceUsd, sale_price: 100 }],
      saleTotalsOverride: { USD: 150 },
      existingReceipts: [
        {
          service_refs: [999],
          amount: 100,
          amount_currency: "USD",
          payment_fee_amount: 0,
          base_amount: null,
          base_currency: null,
        },
      ],
      currentReceipt: {
        amount: 50,
        amountCurrency: "USD",
        paymentFeeAmount: 0,
        baseAmount: null,
        baseCurrency: null,
      },
    });

    expect(accepted.ok).toBe(true);

    const overpaid = validateGroupReceiptDebt({
      selectedServiceIds: [1],
      services: [{ ...serviceUsd, sale_price: 100 }],
      saleTotalsOverride: { USD: 150 },
      existingReceipts: [
        {
          service_refs: [999],
          amount: 100,
          amount_currency: "USD",
          payment_fee_amount: 0,
          base_amount: null,
          base_currency: null,
        },
      ],
      currentReceipt: {
        amount: 60,
        amountCurrency: "USD",
        paymentFeeAmount: 0,
        baseAmount: null,
        baseCurrency: null,
      },
    });

    expect(overpaid.ok).toBe(false);
    if (overpaid.ok) return;
    expect(overpaid.code).toBe("GROUP_FINANCE_OVERPAY_NOT_ALLOWED");
  });

  it("validates a selected service against the passenger total balance", () => {
    const result = validateGroupReceiptDebt({
      selectedServiceIds: [2],
      debtServiceIds: [1, 2],
      services: [
        { ...serviceUsd, id_service: 1, sale_price: 500 },
        { ...serviceUsd, id_service: 2, sale_price: 500 },
      ],
      existingReceipts: [
        {
          service_refs: [1, 2],
          amount: 500,
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

    expect(result.ok).toBe(true);
  });

  it("allows a historical edit that does not increase credited amounts", () => {
    const result = validateGroupReceiptDebt({
      selectedServiceIds: [999],
      services: [],
      existingReceipts: [],
      previousReceipt: {
        service_refs: [999],
        amount: 100,
        amount_currency: "USD",
        payment_fee_amount: 0,
        base_amount: null,
        base_currency: null,
      },
      currentReceipt: {
        amount: 100,
        amountCurrency: "USD",
        paymentFeeAmount: 0,
        baseAmount: null,
        baseCurrency: null,
      },
    });

    expect(result.ok).toBe(true);
  });

  it("does not treat a larger historical edit as compatible", () => {
    const result = validateGroupReceiptDebt({
      selectedServiceIds: [999],
      services: [],
      existingReceipts: [],
      previousReceipt: {
        service_refs: [999],
        amount: 100,
        amount_currency: "USD",
        payment_fee_amount: 0,
        base_amount: null,
        base_currency: null,
      },
      currentReceipt: {
        amount: 110,
        amountCurrency: "USD",
        paymentFeeAmount: 0,
        baseAmount: null,
        baseCurrency: null,
      },
    });

    expect(result.ok).toBe(false);
  });

  it("allows a passenger-level receipt when a manual sale total is configured", () => {
    const result = validateGroupReceiptDebt({
      selectedServiceIds: [],
      services: [],
      saleTotalsOverride: { USD: 1_000 },
      existingReceipts: [],
      currentReceipt: {
        amount: 250,
        amountCurrency: "USD",
        paymentFeeAmount: 0,
        baseAmount: null,
        baseCurrency: null,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalizedServiceIds).toEqual([]);
  });
});
