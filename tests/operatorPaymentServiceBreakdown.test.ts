import { describe, expect, it } from "vitest";
import { computeOperatorPaymentBreakdown } from "@/lib/operatorPayments/serviceBreakdown";

describe("operator payment service breakdown", () => {
  it("respects temporal order with tie-break by payment id", () => {
    const result = computeOperatorPaymentBreakdown({
      services: [
        {
          service_id: 1,
          service_label: "Servicio 1",
          service_currency: "USD",
          service_cost: 1000,
        },
      ],
      payments: [
        {
          payment_id: 11,
          amount: 200,
          currency: "USD",
          paid_at: "2026-01-10T10:00:00.000Z",
          created_at: "2026-01-10T10:00:00.000Z",
          allocations: [{ service_id: 1, amount_service: 200 }],
        },
        {
          payment_id: 10,
          amount: 500,
          currency: "USD",
          paid_at: "2026-01-10T10:00:00.000Z",
          created_at: "2026-01-10T09:00:00.000Z",
          allocations: [{ service_id: 1, amount_service: 500 }],
        },
      ],
    });

    const payment10 = result.byPaymentId.get(10);
    const payment11 = result.byPaymentId.get(11);
    expect(payment10).toBeDefined();
    expect(payment11).toBeDefined();
    if (!payment10 || !payment11) return;

    expect(payment10.service_rows[0].balance_before).toBe(1000);
    expect(payment10.service_rows[0].balance_after).toBe(500);
    expect(payment11.service_rows[0].balance_before).toBe(500);
    expect(payment11.service_rows[0].balance_after).toBe(300);
  });

  it("uses fallback cost proration when allocations are missing and resolvable", () => {
    const result = computeOperatorPaymentBreakdown({
      services: [
        {
          service_id: 1,
          service_label: "Servicio A",
          service_currency: "USD",
          service_cost: 1000,
        },
        {
          service_id: 2,
          service_label: "Servicio B",
          service_currency: "USD",
          service_cost: 2000,
        },
      ],
      payments: [
        {
          payment_id: 20,
          amount: 3000,
          currency: "USD",
          paid_at: "2026-02-01T00:00:00.000Z",
          service_ids: [1, 2],
        },
      ],
    });

    const payment = result.byPaymentId.get(20);
    expect(payment).toBeDefined();
    if (!payment) return;
    expect(payment.used_fallback).toBe(true);
    expect(payment.service_rows.every((row) => row.estimated)).toBe(true);

    const rowA = payment.service_rows.find((row) => row.service_id === 1);
    const rowB = payment.service_rows.find((row) => row.service_id === 2);
    expect(rowA?.applied_in_payment).toBe(1000);
    expect(rowB?.applied_in_payment).toBe(2000);
    expect(rowA?.balance_after).toBe(0);
    expect(rowB?.balance_after).toBe(0);
  });

  it("marks detail as unavailable when fallback cannot resolve conversion", () => {
    const result = computeOperatorPaymentBreakdown({
      services: [
        {
          service_id: 1,
          service_label: "Servicio USD",
          service_currency: "USD",
          service_cost: 1000,
        },
      ],
      payments: [
        {
          payment_id: 30,
          amount: 1_000_000,
          currency: "ARS",
          paid_at: "2026-03-01T00:00:00.000Z",
          service_ids: [1],
        },
      ],
    });

    const payment = result.byPaymentId.get(30);
    expect(payment).toBeDefined();
    if (!payment) return;
    expect(payment.has_unavailable_details).toBe(true);
    expect(payment.service_rows[0].unavailable).toBe(true);
    expect(payment.service_rows[0].unavailable_reason).toBe("missing_conversion");
    expect(payment.service_rows[0].applied_in_payment).toBeNull();
    expect(payment.service_rows[0].balance_after).toBeNull();
  });

  it("matches expected balances for the 73/74/84-like multi-payment scenario", () => {
    const result = computeOperatorPaymentBreakdown({
      services: [
        {
          service_id: 170,
          service_label: "N°170",
          service_currency: "USD",
          service_cost: 3045.1,
        },
        {
          service_id: 169,
          service_label: "N°169",
          service_currency: "USD",
          service_cost: 1072.56,
        },
        {
          service_id: 56,
          service_label: "N°56",
          service_currency: "USD",
          service_cost: 1134.1,
        },
      ],
      payments: [
        {
          payment_id: 73,
          amount: 1700,
          currency: "USD",
          paid_at: "2026-04-01T00:00:00.000Z",
          service_ids: [170],
        },
        {
          payment_id: 74,
          amount: 2100,
          currency: "USD",
          paid_at: "2026-04-02T00:00:00.000Z",
          allocations: [
            { service_id: 170, amount_service: 1345.1, service_currency: "USD" },
            { service_id: 169, amount_service: 754.9, service_currency: "USD" },
          ],
        },
        {
          payment_id: 84,
          amount: 1486,
          currency: "USD",
          paid_at: "2026-04-03T00:00:00.000Z",
          allocations: [
            { service_id: 169, amount_service: 317.66, service_currency: "USD" },
            { service_id: 56, amount_service: 1134.1, service_currency: "USD" },
          ],
        },
      ],
    });

    const payment73 = result.byPaymentId.get(73);
    const payment74 = result.byPaymentId.get(74);
    const payment84 = result.byPaymentId.get(84);
    expect(payment73).toBeDefined();
    expect(payment74).toBeDefined();
    expect(payment84).toBeDefined();
    if (!payment73 || !payment74 || !payment84) return;

    const row170in73 = payment73.service_rows.find((row) => row.service_id === 170);
    expect(row170in73?.applied_in_payment).toBe(1700);
    expect(row170in73?.balance_after).toBe(1345.1);

    const row170in74 = payment74.service_rows.find((row) => row.service_id === 170);
    const row169in74 = payment74.service_rows.find((row) => row.service_id === 169);
    expect(row170in74?.applied_in_payment).toBe(1345.1);
    expect(row170in74?.balance_after).toBe(0);
    expect(row169in74?.applied_in_payment).toBe(754.9);
    expect(row169in74?.balance_after).toBe(317.66);

    const row169in84 = payment84.service_rows.find((row) => row.service_id === 169);
    const row56in84 = payment84.service_rows.find((row) => row.service_id === 56);
    expect(row169in84?.balance_before).toBe(317.66);
    expect(row169in84?.applied_in_payment).toBe(317.66);
    expect(row169in84?.balance_after).toBe(0);
    expect(row56in84?.applied_in_payment).toBe(1134.1);
    expect(row56in84?.balance_after).toBe(0);
  });
});
