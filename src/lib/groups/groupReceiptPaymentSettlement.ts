import { Prisma } from "@prisma/client";
import {
  addGroupReceiptToPaidByCurrency,
  type GroupReceiptDebtReceipt,
} from "@/lib/groups/groupReceiptDebtValidation";
import {
  normalizeCurrencyCode,
  toAmountNumber,
} from "@/lib/groups/financeShared";
import type { GroupReceiptStoredPaymentLine } from "@/lib/groups/groupReceiptMetadata";

const SETTLEMENT_TOLERANCE_CENTS = 1;

type SettlementPaymentRow = {
  id_travel_group_client_payment: number;
  amount: unknown;
  due_date?: Date | string | null;
};

export type GroupReceiptSettlementBucket = {
  currency: string;
  amount: number;
};

export function buildGroupReceiptSettlementBuckets(args: {
  amount: unknown;
  amountCurrency: string | null | undefined;
  paymentFeeAmount?: unknown;
  baseAmount?: unknown;
  baseCurrency?: string | null;
  payments?: GroupReceiptStoredPaymentLine[];
}): GroupReceiptSettlementBucket[] {
  const paidByCurrency: Record<string, number> = {};
  const receipt: GroupReceiptDebtReceipt = {
    service_refs: [],
    amount: args.amount,
    amount_currency: normalizeCurrencyCode(args.amountCurrency || "ARS"),
    payment_fee_amount: args.paymentFeeAmount ?? 0,
    base_amount: args.baseAmount ?? null,
    base_currency: args.baseCurrency ?? null,
    payments: args.payments,
  };
  addGroupReceiptToPaidByCurrency(paidByCurrency, receipt);

  return Object.entries(paidByCurrency)
    .map(([currency, amount]) => ({
      currency: normalizeCurrencyCode(currency),
      amount: round2(Math.max(0, amount)),
    }))
    .filter((bucket) => toCents(bucket.amount) > SETTLEMENT_TOLERANCE_CENTS);
}

export function pickFullySettledGroupClientPaymentIds(
  payments: SettlementPaymentRow[],
  availableAmount: number,
): number[] {
  let remainingCents = toCents(availableAmount);
  const settledIds: number[] = [];
  const sorted = [...payments].sort((a, b) => {
    const aDate = dateMs(a.due_date);
    const bDate = dateMs(b.due_date);
    if (aDate !== bDate) return aDate - bDate;
    return a.id_travel_group_client_payment - b.id_travel_group_client_payment;
  });

  for (const payment of sorted) {
    const amountCents = toCents(toAmountNumber(payment.amount));
    if (amountCents <= 0) continue;
    if (remainingCents + SETTLEMENT_TOLERANCE_CENTS < amountCents) break;
    settledIds.push(payment.id_travel_group_client_payment);
    remainingCents -= amountCents;
  }

  return settledIds;
}

export async function settleGroupReceiptClientPayments(
  tx: Prisma.TransactionClient,
  args: {
    idAgency: number;
    groupId: number;
    passengerId: number;
    clientIds: number[];
    receiptId: number;
    issueDate: Date;
    paidByUserId: number;
    amount: unknown;
    amountCurrency: string;
    paymentFeeAmount?: unknown;
    baseAmount?: unknown;
    baseCurrency?: string | null;
    payments?: GroupReceiptStoredPaymentLine[];
  },
): Promise<number[]> {
  const clientIds = uniquePositiveInts(args.clientIds);
  if (clientIds.length === 0) return [];

  const settledIds: number[] = [];
  const buckets = buildGroupReceiptSettlementBuckets({
    amount: args.amount,
    amountCurrency: args.amountCurrency,
    paymentFeeAmount: args.paymentFeeAmount,
    baseAmount: args.baseAmount,
    baseCurrency: args.baseCurrency,
    payments: args.payments,
  });

  for (const bucket of buckets) {
    const pendingPayments = await tx.travelGroupClientPayment.findMany({
      where: {
        id_agency: args.idAgency,
        travel_group_id: args.groupId,
        travel_group_passenger_id: args.passengerId,
        client_id: { in: clientIds },
        status: "PENDIENTE",
        receipt_id: null,
        currency: bucket.currency,
      },
      select: {
        id_travel_group_client_payment: true,
        amount: true,
        due_date: true,
      },
      orderBy: [
        { due_date: "asc" },
        { id_travel_group_client_payment: "asc" },
      ],
    });
    const ids = pickFullySettledGroupClientPaymentIds(
      pendingPayments,
      bucket.amount,
    );
    if (ids.length === 0) continue;

    await tx.travelGroupClientPayment.updateMany({
      where: {
        id_agency: args.idAgency,
        travel_group_id: args.groupId,
        id_travel_group_client_payment: { in: ids },
      },
      data: {
        status: "PAGADA",
        paid_at: args.issueDate,
        paid_by: args.paidByUserId,
        receipt_id: args.receiptId,
        status_reason: "Recibo de grupal",
        updated_at: new Date(),
      },
    });
    settledIds.push(...ids);
  }

  return settledIds;
}

export async function releaseGroupReceiptClientPayments(
  tx: Prisma.TransactionClient,
  args: {
    idAgency: number;
    groupId: number;
    receiptId: number;
    reason: string;
  },
): Promise<number> {
  const result = await tx.travelGroupClientPayment.updateMany({
    where: {
      id_agency: args.idAgency,
      travel_group_id: args.groupId,
      receipt_id: args.receiptId,
      status: { not: "CANCELADA" },
    },
    data: {
      status: "PENDIENTE",
      paid_at: null,
      paid_by: null,
      receipt_id: null,
      status_reason: args.reason,
      updated_at: new Date(),
    },
  });
  return result.count;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(value: number): number {
  return Math.round(round2(value) * 100);
}

function dateMs(value: Date | string | null | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function uniquePositiveInts(values: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const n = Math.trunc(value);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
