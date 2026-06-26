import prisma, { Prisma } from "@/lib/prisma";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  parseDateInputInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";

type DecimalLike = number | Prisma.Decimal | null | undefined;

function toNum(value: DecimalLike): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return Number(value);
}

function toUpperCurrency(value?: string | null): string {
  return String(value || "").trim().toUpperCase();
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function monthRange(year: number, month: number): { from: Date; to: Date } {
  const monthKey = String(month).padStart(2, "0");
  const fromKey = `${year}-${monthKey}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const toKey = `${year}-${monthKey}-${String(lastDay).padStart(2, "0")}`;
  const from =
    startOfDayUtcFromDateKeyInBuenosAires(fromKey) ??
    parseDateInputInBuenosAires(fromKey) ??
    new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const to =
    endOfDayUtcFromDateKeyInBuenosAires(toKey) ??
    parseDateInputInBuenosAires(toKey) ??
    new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { from, to };
}

export type ExpectedAccountBalance = {
  accountId: number;
  currency: string;
  expected: number;
  openingAmount: number;
  openingDate: Date | null;
};

export async function computeExpectedAccountBalanceAtDate(
  agencyId: number,
  accountId: number,
  currency: string,
  atDate: Date,
): Promise<ExpectedAccountBalance> {
  const targetCurrency = toUpperCurrency(currency);

  const account = await prisma.financeAccount.findFirst({
    where: { id_agency: agencyId, id_account: accountId },
    select: { id_account: true, name: true, currency: true },
  });
  if (!account) {
    throw new Error("Cuenta no encontrada.");
  }
  if (
    account.currency &&
    toUpperCurrency(account.currency) !== targetCurrency
  ) {
    throw new Error(
      `La cuenta tiene moneda fija (${toUpperCurrency(account.currency)}).`,
    );
  }

  const opening = await prisma.financeAccountOpeningBalance.findFirst({
    where: {
      id_agency: agencyId,
      account_id: accountId,
      currency: targetCurrency,
      effective_date: { lte: atDate },
    },
    orderBy: [{ effective_date: "desc" }],
    select: {
      amount: true,
      effective_date: true,
    },
  });

  const openingDate = opening?.effective_date ?? null;
  const openingAmount = toNum(opening?.amount);
  let expected = openingAmount;

  const dateWhere: Prisma.DateTimeFilter = openingDate
    ? { gte: openingDate, lte: atDate }
    : { lte: atDate };

  const receipts = await prisma.receipt.findMany({
    where: {
      issue_date: dateWhere,
      AND: [
        {
          OR: [{ id_agency: agencyId }, { booking: { id_agency: agencyId } }],
        },
        {
          OR: [
            { account_id: accountId },
            { payments: { some: { account_id: accountId } } },
          ],
        },
      ],
    },
    select: {
      amount: true,
      amount_currency: true,
      currency: true,
      account_id: true,
      counter_amount: true,
      counter_currency: true,
      payments: {
        select: {
          amount: true,
          account_id: true,
          payment_currency: true,
        },
      },
    },
  });

  for (const receipt of receipts) {
    const hasCounter =
      receipt.counter_amount != null && !!receipt.counter_currency;
    const receiptCurrency = toUpperCurrency(
      hasCounter ? receipt.counter_currency : receipt.amount_currency || receipt.currency,
    );

    const payments = Array.isArray(receipt.payments) ? receipt.payments : [];
    if (payments.length > 0) {
      for (const payment of payments) {
        const paymentCurrency = toUpperCurrency(
          payment.payment_currency || receiptCurrency,
        );
        if (payment.account_id === accountId && paymentCurrency === targetCurrency) {
          expected += toNum(payment.amount);
        }
      }
      continue;
    }

    if (receiptCurrency !== targetCurrency) continue;
    if (receipt.account_id === accountId) {
      expected += hasCounter
        ? toNum(receipt.counter_amount)
        : toNum(receipt.amount);
    }
  }

  const otherIncomes = await prisma.otherIncome.findMany({
    where: {
      id_agency: agencyId,
      issue_date: dateWhere,
      currency: targetCurrency,
      OR: [{ account_id: accountId }, { payments: { some: { account_id: accountId } } }],
    },
    select: {
      amount: true,
      account_id: true,
      payments: {
        select: {
          amount: true,
          account_id: true,
        },
      },
    },
  });

  for (const income of otherIncomes) {
    const payments = Array.isArray(income.payments) ? income.payments : [];
    if (payments.length > 0) {
      for (const payment of payments) {
        if (payment.account_id === accountId) {
          expected += toNum(payment.amount);
        }
      }
      continue;
    }
    if (income.account_id === accountId) {
      expected += toNum(income.amount);
    }
  }

  if (account.name?.trim()) {
    const accountName = account.name.trim();
    const investmentWhere: Prisma.InvestmentWhereInput = {
      id_agency: agencyId,
      currency: targetCurrency,
      account: accountName,
      OR: [
        { paid_at: dateWhere },
        { AND: [{ paid_at: null }, { created_at: dateWhere }] },
      ],
    };
    const investments = await prisma.investment.findMany({
      where: investmentWhere,
      select: { amount: true },
    });
    for (const inv of investments) {
      expected -= toNum(inv.amount);
    }
  }

  const transfers = await prisma.financeTransfer.findMany({
    where: {
      id_agency: agencyId,
      deleted_at: null,
      transfer_date: dateWhere,
      OR: [
        { origin_account_id: accountId },
        { destination_account_id: accountId },
        { fee_account_id: accountId },
      ],
    },
    select: {
      origin_account_id: true,
      origin_currency: true,
      origin_amount: true,
      destination_account_id: true,
      destination_currency: true,
      destination_amount: true,
      fee_account_id: true,
      fee_currency: true,
      fee_amount: true,
    },
  });

  for (const transfer of transfers) {
    if (
      transfer.origin_account_id === accountId &&
      toUpperCurrency(transfer.origin_currency) === targetCurrency
    ) {
      expected -= toNum(transfer.origin_amount);
    }
    if (
      transfer.destination_account_id === accountId &&
      toUpperCurrency(transfer.destination_currency) === targetCurrency
    ) {
      expected += toNum(transfer.destination_amount);
    }
    if (
      transfer.fee_account_id === accountId &&
      transfer.fee_amount != null &&
      toUpperCurrency(transfer.fee_currency) === targetCurrency
    ) {
      expected -= toNum(transfer.fee_amount);
    }
  }

  const adjustments = await prisma.financeAccountAdjustment.findMany({
    where: {
      id_agency: agencyId,
      account_id: accountId,
      currency: targetCurrency,
      effective_date: dateWhere,
    },
    select: { amount: true },
  });
  for (const adj of adjustments) {
    expected += toNum(adj.amount);
  }

  return {
    accountId,
    currency: targetCurrency,
    expected: round2(expected),
    openingAmount: round2(openingAmount),
    openingDate,
  };
}

export async function computeExpectedAccountBalanceAtMonthEnd(
  agencyId: number,
  accountId: number,
  currency: string,
  year: number,
  month: number,
): Promise<ExpectedAccountBalance> {
  const { to } = monthRange(year, month);
  return computeExpectedAccountBalanceAtDate(
    agencyId,
    accountId,
    currency,
    to,
  );
}
