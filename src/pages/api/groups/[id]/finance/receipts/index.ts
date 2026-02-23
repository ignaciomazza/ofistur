import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  isMissingGroupFinanceTableError,
  normalizeCurrencyCode,
  parseDateInput,
  parseOptionalPositiveInt,
  parseScopeFilter,
  requireGroupFinanceContext,
  toAmountNumber,
  toDecimal,
} from "@/lib/groups/financeShared";
import { validateGroupReceiptDebt } from "@/lib/groups/groupReceiptDebtValidation";

type ReceiptRow = {
  id_travel_group_receipt: number;
  agency_travel_group_receipt_id: number | null;
  travel_group_departure_id: number | null;
  travel_group_passenger_id: number;
  client_id: number;
  issue_date: Date;
  amount: Prisma.Decimal | number | string;
  amount_string: string;
  amount_currency: string;
  concept: string;
  currency: string;
  payment_method: string | null;
  payment_fee_amount: Prisma.Decimal | number | string | null;
  account: string | null;
  base_amount: Prisma.Decimal | number | string | null;
  base_currency: string | null;
  counter_amount: Prisma.Decimal | number | string | null;
  counter_currency: string | null;
  client_ids: number[] | null;
  service_refs: number[] | null;
  booking_id: number | null;
};

function toIsoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function buildReceiptResponse(row: ReceiptRow) {
  const numericAgencyId = row.agency_travel_group_receipt_id;
  const fallbackNumber = row.id_travel_group_receipt;
  const receiptNumber = String(numericAgencyId ?? fallbackNumber).padStart(6, "0");

  return {
    id_receipt: row.id_travel_group_receipt,
    agency_receipt_id: row.agency_travel_group_receipt_id,
    public_id: null,
    receipt_number: `GR-${receiptNumber}`,
    issue_date: toIsoDate(row.issue_date),
    amount: toAmountNumber(row.amount),
    amount_string: row.amount_string,
    amount_currency: normalizeCurrencyCode(row.amount_currency),
    concept: row.concept,
    currency: row.currency,
    payment_method: row.payment_method,
    payment_fee_amount:
      row.payment_fee_amount == null ? null : toAmountNumber(row.payment_fee_amount),
    account: row.account,
    base_amount: row.base_amount == null ? null : toAmountNumber(row.base_amount),
    base_currency: row.base_currency,
    counter_amount:
      row.counter_amount == null ? null : toAmountNumber(row.counter_amount),
    counter_currency: row.counter_currency,
    bookingId_booking: row.booking_id ?? 0,
    booking: row.booking_id
      ? {
          id_booking: row.booking_id,
        }
      : undefined,
    serviceIds: Array.isArray(row.service_refs) ? row.service_refs : [],
    clientIds: Array.isArray(row.client_ids) ? row.client_ids : [row.client_id],
    travel_group_passenger_id: row.travel_group_passenger_id,
    travel_group_departure_id: row.travel_group_departure_id,
  };
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res);
  if (!ctx) return;

  const passengerId = parseOptionalPositiveInt(
    Array.isArray(req.query.passengerId) ? req.query.passengerId[0] : req.query.passengerId,
  );
  const scope = parseScopeFilter(
    Array.isArray(req.query.scope) ? req.query.scope[0] : req.query.scope,
  );
  if (!scope) {
    return groupApiError(res, 400, "El scope financiero es inválido.", {
      code: "GROUP_FINANCE_SCOPE_INVALID",
    });
  }

  const filters: Prisma.Sql[] = [
    Prisma.sql`r."id_agency" = ${ctx.auth.id_agency}`,
    Prisma.sql`r."travel_group_id" = ${ctx.group.id_travel_group}`,
  ];
  if (passengerId) {
    filters.push(Prisma.sql`r."travel_group_passenger_id" = ${passengerId}`);
  }
  if (scope.departureId === null) {
    filters.push(Prisma.sql`r."travel_group_departure_id" IS NULL`);
  } else if (typeof scope.departureId === "number") {
    filters.push(Prisma.sql`r."travel_group_departure_id" = ${scope.departureId}`);
  }
  const whereSql = Prisma.join(filters, " AND ");

  try {
    const rows = await prisma.$queryRaw<ReceiptRow[]>(Prisma.sql`
      SELECT
        r."id_travel_group_receipt",
        r."agency_travel_group_receipt_id",
        r."travel_group_departure_id",
        r."travel_group_passenger_id",
        r."client_id",
        r."issue_date",
        r."amount",
        r."amount_string",
        r."amount_currency",
        r."concept",
        r."currency",
        r."payment_method",
        r."payment_fee_amount",
        r."account",
        r."base_amount",
        r."base_currency",
        r."counter_amount",
        r."counter_currency",
        r."client_ids",
        r."service_refs",
        tp."booking_id"
      FROM "TravelGroupReceipt" r
      LEFT JOIN "TravelGroupPassenger" tp
        ON tp."id_travel_group_passenger" = r."travel_group_passenger_id"
      WHERE ${whereSql}
      ORDER BY r."issue_date" DESC, r."id_travel_group_receipt" DESC
    `);

    return res.status(200).json({
      success: true,
      receipts: rows.map(buildReceiptResponse),
    });
  } catch (error) {
    if (isMissingGroupFinanceTableError(error)) {
      return res.status(200).json({
        success: true,
        receipts: [],
        schema_ready: false,
      });
    }
    console.error("[groups][finance][receipts][GET]", error);
    return groupApiError(
      res,
      500,
      "No pudimos cargar los recibos de la grupal.",
      {
        code: "GROUP_FINANCE_RECEIPTS_LIST_ERROR",
        solution: "Reintentá en unos segundos.",
      },
    );
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res, { write: true });
  if (!ctx) return;
  if (!req.body || typeof req.body !== "object") {
    return groupApiError(res, 400, "Body inválido o vacío.", {
      code: "GROUP_FINANCE_BODY_INVALID",
    });
  }

  const body = req.body as {
    passengerId?: unknown;
    clientIds?: unknown;
    serviceIds?: unknown;
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
  };

  const passengerId = parseOptionalPositiveInt(body.passengerId);
  if (!passengerId) {
    return groupApiError(res, 400, "Pasajero inválido para crear el recibo.", {
      code: "GROUP_FINANCE_PASSENGER_INVALID",
    });
  }

  const passenger = await prisma.travelGroupPassenger.findFirst({
    where: {
      id_agency: ctx.auth.id_agency,
      travel_group_id: ctx.group.id_travel_group,
      id_travel_group_passenger: passengerId,
    },
    select: {
      id_travel_group_passenger: true,
      travel_group_departure_id: true,
      client_id: true,
      booking_id: true,
    },
  });
  if (!passenger) {
    return groupApiError(res, 404, "Pasajero no encontrado en esta grupal.", {
      code: "GROUP_FINANCE_PASSENGER_NOT_FOUND",
    });
  }

  const conceptRaw =
    typeof body.concept === "string" ? body.concept.trim().slice(0, 300) : "";
  const concept = conceptRaw || "Cobro de grupal";

  const amount = toDecimal(Number(body.amount)).toDecimalPlaces(2);
  if (amount.lte(0)) {
    return groupApiError(res, 400, "El monto del recibo debe ser mayor a cero.", {
      code: "GROUP_FINANCE_AMOUNT_INVALID",
    });
  }

  const issueDate = parseDateInput(body.issue_date) ?? new Date();
  const amountCurrency = normalizeCurrencyCode(body.amountCurrency);
  const amountString =
    typeof body.amountString === "string" && body.amountString.trim()
      ? body.amountString.trim().slice(0, 300)
      : "";
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
    body.base_amount === null || body.base_amount === undefined || body.base_amount === ""
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
  const serviceIds = Array.isArray(body.serviceIds)
    ? body.serviceIds
        .map((item) => parseOptionalPositiveInt(item))
        .filter((item): item is number => !!item)
    : [];

  const finalClientIds =
    clientIds.length > 0
      ? Array.from(new Set(clientIds))
      : passenger.client_id
        ? [passenger.client_id]
        : [];
  if (finalClientIds.length === 0) {
    return groupApiError(res, 400, "No encontramos clientes para el recibo.", {
      code: "GROUP_FINANCE_CLIENT_REQUIRED",
    });
  }

  let finalServiceIds = Array.from(new Set(serviceIds));
  if (passenger.booking_id) {
    const [services, existingReceipts] = await Promise.all([
      prisma.service.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          booking_id: passenger.booking_id,
        },
        select: {
          id_service: true,
          currency: true,
          sale_price: true,
          card_interest: true,
          taxableCardInterest: true,
          vatOnCardInterest: true,
        },
      }),
      prisma.travelGroupReceipt.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          travel_group_passenger_id: passenger.id_travel_group_passenger,
        },
        select: {
          service_refs: true,
          amount: true,
          amount_currency: true,
          payment_fee_amount: true,
          base_amount: true,
          base_currency: true,
        },
      }),
    ]);

    const validation = validateGroupReceiptDebt({
      selectedServiceIds: finalServiceIds,
      services,
      existingReceipts,
      currentReceipt: {
        amount: toAmountNumber(amount),
        amountCurrency,
        paymentFeeAmount: paymentFeeAmount
          ? toAmountNumber(paymentFeeAmount)
          : 0,
        baseAmount: baseAmount ? toAmountNumber(baseAmount) : null,
        baseCurrency,
      },
    });
    if (!validation.ok) {
      return groupApiError(res, validation.status, validation.message, {
        code: validation.code,
      });
    }
    finalServiceIds = validation.normalizedServiceIds;
  } else if (finalServiceIds.length > 0) {
    return groupApiError(
      res,
      400,
      "No podés asociar servicios si el pasajero no tiene una reserva vinculada.",
      {
        code: "GROUP_FINANCE_SERVICE_WITHOUT_BOOKING",
      },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const agencyReceiptId = await getNextAgencyCounter(
      tx,
      ctx.auth.id_agency,
      "travel_group_receipt",
    );
    const rows = await tx.$queryRaw<ReceiptRow[]>(Prisma.sql`
      INSERT INTO "TravelGroupReceipt" (
        "agency_travel_group_receipt_id",
        "id_agency",
        "travel_group_id",
        "travel_group_departure_id",
        "travel_group_passenger_id",
        "client_id",
        "issue_date",
        "amount",
        "amount_string",
        "amount_currency",
        "concept",
        "currency",
        "payment_method",
        "payment_fee_amount",
        "account",
        "base_amount",
        "base_currency",
        "counter_amount",
        "counter_currency",
        "client_ids",
        "service_refs"
      ) VALUES (
        ${agencyReceiptId},
        ${ctx.auth.id_agency},
        ${ctx.group.id_travel_group},
        ${passenger.travel_group_departure_id},
        ${passenger.id_travel_group_passenger},
        ${finalClientIds[0]},
        ${issueDate},
        ${amount},
        ${amountString},
        ${amountCurrency},
        ${concept},
        ${currency},
        ${paymentMethod},
        ${paymentFeeAmount},
        ${account},
        ${baseAmount},
        ${baseCurrency},
        ${counterAmount},
        ${counterCurrency},
        ${finalClientIds},
        ${finalServiceIds}
      )
      RETURNING
        "id_travel_group_receipt",
        "agency_travel_group_receipt_id",
        "travel_group_departure_id",
        "travel_group_passenger_id",
        "client_id",
        "issue_date",
        "amount",
        "amount_string",
        "amount_currency",
        "concept",
        "currency",
        "payment_method",
        "payment_fee_amount",
        "account",
        "base_amount",
        "base_currency",
        "counter_amount",
        "counter_currency",
        "client_ids",
        "service_refs",
        NULL::INTEGER AS "booking_id"
    `);
    return rows[0];
  });

  return res.status(201).json({
    success: true,
    receipt: buildReceiptResponse(created),
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
