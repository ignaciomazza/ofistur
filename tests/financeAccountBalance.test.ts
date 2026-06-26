import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    financeAccount: { findFirst: vi.fn() },
    financeAccountOpeningBalance: { findFirst: vi.fn() },
    receipt: { findMany: vi.fn() },
    otherIncome: { findMany: vi.fn() },
    investment: { findMany: vi.fn() },
    financeTransfer: { findMany: vi.fn() },
    financeAccountAdjustment: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", async () => {
  const actual = await vi.importActual<typeof import("@prisma/client")>(
    "@prisma/client",
  );
  return {
    default: mocks.prisma,
    Prisma: actual.Prisma,
  };
});

import { computeExpectedAccountBalanceAtDate } from "@/lib/financeAccountBalance";

describe("finance account balance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.financeAccount.findFirst.mockResolvedValue({
      id_account: 7,
      name: "Caja USD",
      currency: "USD",
    });
    mocks.prisma.financeAccountOpeningBalance.findFirst.mockResolvedValue(null);
    mocks.prisma.otherIncome.findMany.mockResolvedValue([]);
    mocks.prisma.investment.findMany.mockResolvedValue([]);
    mocks.prisma.financeTransfer.findMany.mockResolvedValue([]);
    mocks.prisma.financeAccountAdjustment.findMany.mockResolvedValue([]);
  });

  it("counts receipt payment lines by their own currency", async () => {
    mocks.prisma.receipt.findMany.mockResolvedValue([
      {
        amount: new Prisma.Decimal(1_000_000),
        amount_currency: "ARS",
        currency: "ARS",
        account_id: null,
        counter_amount: null,
        counter_currency: null,
        payments: [
          {
            amount: new Prisma.Decimal(50),
            account_id: 7,
            payment_currency: "USD",
          },
          {
            amount: new Prisma.Decimal(1_000_000),
            account_id: 8,
            payment_currency: "ARS",
          },
        ],
      },
    ]);

    const result = await computeExpectedAccountBalanceAtDate(
      50,
      7,
      "USD",
      new Date("2026-06-26T12:00:00Z"),
    );

    expect(result.expected).toBe(50);
  });
});
