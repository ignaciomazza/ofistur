import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  buildGroupReceiptSettlementBuckets,
  pickFullySettledGroupClientPaymentIds,
  settleGroupReceiptClientPayments,
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

  it("aborts when another operation settles an installment first", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = {
      travelGroupClientPayment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id_travel_group_client_payment: 10,
            amount: 100,
            due_date: new Date("2026-08-01"),
            concept: "Cuota 1",
            status_reason: null,
            metadata: { record_type: "PAYMENT_INSTALLMENT" },
          },
        ]),
        updateMany,
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      settleGroupReceiptClientPayments(tx, {
        idAgency: 1,
        groupId: 2,
        passengerId: 3,
        clientIds: [4],
        receiptId: 5,
        issueDate: new Date("2026-08-26"),
        paidByUserId: 6,
        amount: 100,
        amountCurrency: "USD",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "GROUP_FINANCE_PAYMENT_ALREADY_SETTLED",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDIENTE",
          receipt_id: null,
        }),
      }),
    );
  });
});
