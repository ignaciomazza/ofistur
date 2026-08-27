import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  normalizeCurrencyCode,
  parseDateInput,
  parseOptionalPositiveInt,
  requireGroupFinanceContext,
  toAmountNumber,
  toDecimal,
} from "@/lib/groups/financeShared";
import { validateGroupReceiptDebtForPassenger } from "@/lib/groups/groupReceiptDebtContext";
import { areGroupReceiptCreditsEquivalent } from "@/lib/groups/groupReceiptDebtValidation";
import {
  GroupFinanceRequestError,
  isGroupFinanceRequestError,
  lockGroupInventoryServiceIds,
  lockGroupPassenger,
} from "@/lib/groups/groupFinanceMutationGuards";
import {
  normalizeGroupReceiptPdfItems,
  normalizeGroupReceiptStoredPayments,
  readGroupReceiptPdfItemsFromMetadata,
  readGroupReceiptPaymentsFromMetadata,
  withGroupReceiptPdfItemsInMetadata,
  withGroupReceiptPaymentsInMetadata,
} from "@/lib/groups/groupReceiptMetadata";
import {
  releaseGroupReceiptClientPayments,
  settleGroupReceiptClientPayments,
} from "@/lib/groups/groupReceiptPaymentSettlement";

async function findReceipt(
  agencyId: number,
  groupId: number,
  receiptId: number,
) {
  const rows = await prisma.$queryRaw<
    Array<{
      id_travel_group_receipt: number;
      travel_group_passenger_id: number;
      client_id: number;
      client_ids: number[] | null;
      service_refs: number[] | null;
      metadata: Prisma.JsonValue | null;
      amount: Prisma.Decimal | number | string;
      amount_currency: string;
      payment_fee_amount: Prisma.Decimal | number | string | null;
      base_amount: Prisma.Decimal | number | string | null;
      base_currency: string | null;
      booking_id: number | null;
    }>
  >(Prisma.sql`
    SELECT
      r."id_travel_group_receipt",
      r."travel_group_passenger_id",
      r."client_id",
      r."client_ids",
      r."service_refs",
      r."metadata",
      r."amount",
      r."amount_currency",
      r."payment_fee_amount",
      r."base_amount",
      r."base_currency",
      p."booking_id"
    FROM "TravelGroupReceipt" r
    LEFT JOIN "TravelGroupPassenger" p
      ON p."id_travel_group_passenger" = r."travel_group_passenger_id"
    WHERE r."id_travel_group_receipt" = ${receiptId}
      AND r."id_agency" = ${agencyId}
      AND r."travel_group_id" = ${groupId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res, { write: true });
  if (!ctx) return;
  if (!req.body || typeof req.body !== "object") {
    return groupApiError(res, 400, "Body inválido o vacío.", {
      code: "GROUP_FINANCE_BODY_INVALID",
    });
  }

  const receiptId = parseOptionalPositiveInt(
    Array.isArray(req.query.receiptId)
      ? req.query.receiptId[0]
      : req.query.receiptId,
  );
  if (!receiptId) {
    return groupApiError(res, 400, "El identificador del recibo es inválido.", {
      code: "GROUP_FINANCE_RECEIPT_ID_INVALID",
    });
  }

  const existing = await findReceipt(
    ctx.auth.id_agency,
    ctx.group.id_travel_group,
    receiptId,
  );
  if (!existing) {
    return groupApiError(res, 404, "No encontramos ese recibo de grupal.", {
      code: "GROUP_FINANCE_RECEIPT_NOT_FOUND",
    });
  }

  const body = req.body as {
    concept?: unknown;
    amount?: unknown;
    amountString?: unknown;
    amountCurrency?: unknown;
    issue_date?: unknown;
    payment_fee_amount?: unknown;
    payment_method?: unknown;
    account?: unknown;
    currency?: unknown;
    base_amount?: unknown;
    base_currency?: unknown;
    counter_amount?: unknown;
    counter_currency?: unknown;
    clientIds?: unknown;
    serviceIds?: unknown;
    payments?: unknown;
    pdf_items?: unknown;
  };

  const conceptRaw =
    typeof body.concept === "string" ? body.concept.trim().slice(0, 300) : "";
  const concept = conceptRaw || "Cobro de grupal";

  const amount = toDecimal(Number(body.amount)).toDecimalPlaces(2);
  if (amount.lte(0)) {
    return groupApiError(
      res,
      400,
      "El monto del recibo debe ser mayor a cero.",
      {
        code: "GROUP_FINANCE_AMOUNT_INVALID",
      },
    );
  }

  const issueDate = parseDateInput(body.issue_date) ?? new Date();
  const amountString =
    typeof body.amountString === "string" && body.amountString.trim()
      ? body.amountString.trim().slice(0, 300)
      : "";
  const amountCurrency = normalizeCurrencyCode(body.amountCurrency);
  const paymentFeeAmount =
    body.payment_fee_amount === null ||
    body.payment_fee_amount === undefined ||
    body.payment_fee_amount === ""
      ? null
      : toDecimal(Number(body.payment_fee_amount)).toDecimalPlaces(2);
  const paymentMethod =
    typeof body.payment_method === "string" && body.payment_method.trim()
      ? body.payment_method.trim().slice(0, 120)
      : null;
  const account =
    typeof body.account === "string" && body.account.trim()
      ? body.account.trim().slice(0, 180)
      : null;
  const currency =
    typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().slice(0, 120)
      : amountCurrency;

  const baseAmount =
    body.base_amount === null ||
    body.base_amount === undefined ||
    body.base_amount === ""
      ? null
      : toDecimal(Number(body.base_amount)).toDecimalPlaces(2);
  const baseCurrency =
    typeof body.base_currency === "string" && body.base_currency.trim()
      ? normalizeCurrencyCode(body.base_currency)
      : null;
  const counterAmount =
    body.counter_amount === null ||
    body.counter_amount === undefined ||
    body.counter_amount === ""
      ? null
      : toDecimal(Number(body.counter_amount)).toDecimalPlaces(2);
  const counterCurrency =
    typeof body.counter_currency === "string" && body.counter_currency.trim()
      ? normalizeCurrencyCode(body.counter_currency)
      : null;

  const clientIds = Array.isArray(body.clientIds)
    ? body.clientIds
        .map((item) => parseOptionalPositiveInt(item))
        .filter((item): item is number => !!item)
    : [];
  const finalClientIds =
    clientIds.length > 0
      ? Array.from(new Set(clientIds))
      : Array.isArray(existing.client_ids) && existing.client_ids.length > 0
        ? existing.client_ids
        : [existing.client_id].filter((item): item is number => !!item);
  const serviceIdsRaw = Array.isArray(body.serviceIds) ? body.serviceIds : null;
  const serviceIds = Array.isArray(serviceIdsRaw)
    ? serviceIdsRaw
        .map((item) => parseOptionalPositiveInt(item))
        .filter((item): item is number => !!item)
    : [];
  const hasPayments = Object.prototype.hasOwnProperty.call(body, "payments");
  if (hasPayments && !Array.isArray(body.payments)) {
    return groupApiError(res, 400, "payments inválidos.", {
      code: "GROUP_FINANCE_RECEIPT_PAYMENTS_INVALID",
    });
  }
  const normalizedPayments = normalizeGroupReceiptStoredPayments(
    Array.isArray(body.payments) ? body.payments : [],
  );
  if (
    hasPayments &&
    Array.isArray(body.payments) &&
    body.payments.length > 0 &&
    normalizedPayments.length === 0
  ) {
    return groupApiError(
      res,
      400,
      "payments inválidos: cada línea debe incluir un monto o fee válido.",
      {
        code: "GROUP_FINANCE_RECEIPT_PAYMENTS_INVALID_LINES",
      },
    );
  }
  const effectivePayments = hasPayments
    ? normalizedPayments
    : readGroupReceiptPaymentsFromMetadata(existing.metadata);
  const hasPdfItems = Object.prototype.hasOwnProperty.call(body, "pdf_items");
  const effectivePdfItems = hasPdfItems
    ? normalizeGroupReceiptPdfItems(body.pdf_items)
    : readGroupReceiptPdfItemsFromMetadata(existing.metadata);

  const linkedPassenger = await prisma.travelGroupPassenger.findFirst({
    where: {
      id_agency: ctx.auth.id_agency,
      travel_group_id: ctx.group.id_travel_group,
      id_travel_group_passenger: existing.travel_group_passenger_id,
    },
    select: {
      id_travel_group_passenger: true,
      travel_group_departure_id: true,
      metadata: true,
    },
  });
  if (!linkedPassenger) {
    return groupApiError(
      res,
      409,
      "El pasajero asociado al recibo ya no está disponible.",
      {
        code: "GROUP_FINANCE_RECEIPT_PASSENGER_MISSING",
        solution: "Refrescá la grupal y revisá el recibo.",
      },
    );
  }

  let finalServiceIds = Array.from(
    new Set(
      serviceIdsRaw
        ? serviceIds
        : Array.isArray(existing.service_refs)
          ? existing.service_refs
          : [],
    ),
  );
  const nextMetadata = withGroupReceiptPdfItemsInMetadata(
    withGroupReceiptPaymentsInMetadata(existing.metadata, effectivePayments),
    effectivePdfItems,
  );
  const previousPayments = readGroupReceiptPaymentsFromMetadata(
    existing.metadata,
  );
  const creditsAreEquivalent = areGroupReceiptCreditsEquivalent(
    {
      service_refs: existing.service_refs,
      amount: existing.amount,
      amount_currency: existing.amount_currency,
      payment_fee_amount: existing.payment_fee_amount,
      base_amount: existing.base_amount,
      base_currency: existing.base_currency,
      payments: previousPayments,
    },
    {
      amount: toAmountNumber(amount),
      amountCurrency,
      paymentFeeAmount: paymentFeeAmount
        ? toAmountNumber(paymentFeeAmount)
        : 0,
      baseAmount: baseAmount ? toAmountNumber(baseAmount) : null,
      baseCurrency,
      payments: effectivePayments,
    },
  );
  const normalizedPreviousClientIds = Array.from(
    new Set(
      (Array.isArray(existing.client_ids) && existing.client_ids.length > 0
        ? existing.client_ids
        : [existing.client_id]
      ).filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).sort((a, b) => a - b);
  const normalizedFinalClientIds = [...finalClientIds].sort((a, b) => a - b);
  const clientsAreEquivalent =
    normalizedPreviousClientIds.length === normalizedFinalClientIds.length &&
    normalizedPreviousClientIds.every(
      (value, index) => value === normalizedFinalClientIds[index],
    );
  const shouldResettle = !creditsAreEquivalent || !clientsAreEquivalent;

  try {
    await prisma.$transaction(async (tx) => {
      const validation = await validateGroupReceiptDebtForPassenger(tx, {
        agencyId: ctx.auth.id_agency,
        groupId: ctx.group.id_travel_group,
        passenger: {
          id: linkedPassenger.id_travel_group_passenger,
          departureId: linkedPassenger.travel_group_departure_id,
          metadata: linkedPassenger.metadata,
        },
        selectedServiceIds: finalServiceIds,
        currentReceipt: {
          amount: toAmountNumber(amount),
          amountCurrency,
          paymentFeeAmount: paymentFeeAmount
            ? toAmountNumber(paymentFeeAmount)
            : 0,
          baseAmount: baseAmount ? toAmountNumber(baseAmount) : null,
          baseCurrency,
          payments: effectivePayments,
        },
        excludeReceiptId: receiptId,
      });
      if (!validation.ok) {
        throw new GroupFinanceRequestError({
          status: validation.status,
          code: validation.code,
          message: validation.message,
        });
      }
      finalServiceIds = validation.normalizedServiceIds;

      if (shouldResettle) {
        await releaseGroupReceiptClientPayments(tx, {
          idAgency: ctx.auth.id_agency,
          groupId: ctx.group.id_travel_group,
          receiptId,
          reason: "Recibo de grupal editado",
        });
      }

      const updatedReceiptCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "TravelGroupReceipt"
      SET "issue_date" = ${issueDate},
          "amount" = ${amount},
          "amount_string" = ${amountString},
          "amount_currency" = ${amountCurrency},
          "concept" = ${concept},
          "currency" = ${currency},
          "payment_method" = ${paymentMethod},
          "payment_fee_amount" = ${paymentFeeAmount},
          "account" = ${account},
          "base_amount" = ${baseAmount},
          "base_currency" = ${baseCurrency},
          "counter_amount" = ${counterAmount},
          "counter_currency" = ${counterCurrency},
          "client_ids" = ${finalClientIds},
          "service_refs" = ${finalServiceIds},
          "metadata" = ${nextMetadata}::jsonb,
          "updated_at" = NOW()
      WHERE "id_travel_group_receipt" = ${receiptId}
        AND "id_agency" = ${ctx.auth.id_agency}
        AND "travel_group_id" = ${ctx.group.id_travel_group}
    `);
      if (updatedReceiptCount !== 1) {
        throw new GroupFinanceRequestError({
          status: 409,
          code: "GROUP_FINANCE_RECEIPT_CHANGED",
          message: "El recibo cambió mientras intentabas editarlo.",
          solution: "Refrescá la grupal y volvé a intentarlo.",
        });
      }

      if (shouldResettle) {
        await settleGroupReceiptClientPayments(tx, {
          idAgency: ctx.auth.id_agency,
          groupId: ctx.group.id_travel_group,
          passengerId: existing.travel_group_passenger_id,
          clientIds: finalClientIds,
          receiptId,
          issueDate,
          paidByUserId: ctx.auth.id_user,
          amount,
          amountCurrency,
          paymentFeeAmount,
          baseAmount,
          baseCurrency,
          payments: effectivePayments,
        });
      } else {
        await tx.travelGroupClientPayment.updateMany({
          where: {
            id_agency: ctx.auth.id_agency,
            travel_group_id: ctx.group.id_travel_group,
            receipt_id: receiptId,
            status: "PAGADA",
          },
          data: {
            paid_at: issueDate,
            updated_at: new Date(),
          },
        });
      }
    });
  } catch (error) {
    if (isGroupFinanceRequestError(error)) {
      return groupApiError(res, error.status, error.message, {
        code: error.code,
        solution: error.solution,
      });
    }
    throw error;
  }

  return res.status(200).json({ success: true, id_receipt: receiptId });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res, { write: true });
  if (!ctx) return;

  const receiptId = parseOptionalPositiveInt(
    Array.isArray(req.query.receiptId)
      ? req.query.receiptId[0]
      : req.query.receiptId,
  );
  if (!receiptId) {
    return groupApiError(res, 400, "El identificador del recibo es inválido.", {
      code: "GROUP_FINANCE_RECEIPT_ID_INVALID",
    });
  }

  const existing = await findReceipt(
    ctx.auth.id_agency,
    ctx.group.id_travel_group,
    receiptId,
  );
  if (!existing) {
    return groupApiError(res, 404, "No encontramos ese recibo de grupal.", {
      code: "GROUP_FINANCE_RECEIPT_NOT_FOUND",
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await lockGroupPassenger(tx, {
        agencyId: ctx.auth.id_agency,
        groupId: ctx.group.id_travel_group,
        passengerId: existing.travel_group_passenger_id,
        requireExisting: false,
      });
      await lockGroupInventoryServiceIds(tx, {
        agencyId: ctx.auth.id_agency,
        groupId: ctx.group.id_travel_group,
        serviceIds: Array.isArray(existing.service_refs)
          ? existing.service_refs
          : [],
        requireExisting: false,
      });
      await releaseGroupReceiptClientPayments(tx, {
        idAgency: ctx.auth.id_agency,
        groupId: ctx.group.id_travel_group,
        receiptId,
        reason: "Recibo de grupal eliminado",
      });

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "TravelGroupReceipt"
        WHERE "id_travel_group_receipt" = ${receiptId}
          AND "id_agency" = ${ctx.auth.id_agency}
          AND "travel_group_id" = ${ctx.group.id_travel_group}
      `);
    });
  } catch (error) {
    if (isGroupFinanceRequestError(error)) {
      return groupApiError(res, error.status, error.message, {
        code: error.code,
        solution: error.solution,
      });
    }
    throw error;
  }

  return res.status(204).end();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PATCH") return handlePatch(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  res.setHeader("Allow", ["PATCH", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
