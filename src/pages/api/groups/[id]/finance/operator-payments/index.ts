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
import { decodeInventoryServiceId } from "@/lib/groups/inventoryServiceRefs";
import {
  GROUP_OPERATOR_PAYMENT_TOLERANCE,
  asPayloadObject,
  getServiceRefsFromAllocations,
  hasDuplicatedServices,
  normalizeGroupOperatorExcessAction,
  normalizeGroupOperatorMissingAction,
  normalizeGroupOperatorPaymentLines,
  parseGroupOperatorPaymentAllocations,
  sumAssignedAmount,
} from "@/lib/groups/operatorPaymentsValidation";

type OperatorPaymentRow = {
  id_travel_group_operator_payment: number;
  agency_travel_group_operator_payment_id: number | null;
  travel_group_departure_id: number | null;
  travel_group_passenger_id: number | null;
  operator_id: number | null;
  category: string;
  description: string;
  amount: Prisma.Decimal | number | string;
  currency: string;
  created_at: Date;
  paid_at: Date | null;
  payment_method: string | null;
  account: string | null;
  base_amount: Prisma.Decimal | number | string | null;
  base_currency: string | null;
  counter_amount: Prisma.Decimal | number | string | null;
  counter_currency: string | null;
  service_refs: number[] | null;
  payload: Prisma.JsonValue | null;
  booking_id: number | null;
  operator_name: string | null;
};

function buildOperatorPaymentItem(row: OperatorPaymentRow) {
  const contextId = row.booking_id ?? null;
  const payload = asPayloadObject(row.payload);
  const allocations = parseGroupOperatorPaymentAllocations(payload.allocations);
  return {
    id_investment: row.id_travel_group_operator_payment,
    agency_investment_id: row.agency_travel_group_operator_payment_id,
    category: row.category,
    description: row.description,
    amount: toAmountNumber(row.amount),
    currency: normalizeCurrencyCode(row.currency),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    paid_at: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    operator_id: row.operator_id,
    context_id: contextId,
    context: contextId
      ? {
          id_context: contextId,
          agency_context_id: null,
        }
      : null,
    booking_id: contextId,
    booking: contextId
      ? {
          id_booking: contextId,
          agency_booking_id: null,
        }
      : null,
    serviceIds: Array.isArray(row.service_refs) ? row.service_refs : [],
    allocations,
    payment_method: row.payment_method,
    account: row.account,
    base_amount:
      row.base_amount == null ? null : toAmountNumber(row.base_amount),
    base_currency: row.base_currency,
    counter_amount:
      row.counter_amount == null ? null : toAmountNumber(row.counter_amount),
    counter_currency: row.counter_currency,
    operator: row.operator_id
      ? {
          id_operator: row.operator_id,
          name: row.operator_name ?? null,
        }
      : null,
  };
}

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res);
  if (!ctx) return;

  const scope = parseScopeFilter(
    Array.isArray(req.query.scope) ? req.query.scope[0] : req.query.scope,
  );
  if (!scope) {
    return groupApiError(res, 400, "El scope financiero es inválido.", {
      code: "GROUP_FINANCE_SCOPE_INVALID",
    });
  }

  const passengerId = parseOptionalPositiveInt(
    Array.isArray(req.query.passengerId) ? req.query.passengerId[0] : req.query.passengerId,
  );

  const filters: Prisma.Sql[] = [
    Prisma.sql`p."id_agency" = ${ctx.auth.id_agency}`,
    Prisma.sql`p."travel_group_id" = ${ctx.group.id_travel_group}`,
  ];
  if (passengerId) {
    filters.push(Prisma.sql`p."travel_group_passenger_id" = ${passengerId}`);
  }
  if (scope.departureId === null) {
    filters.push(Prisma.sql`p."travel_group_departure_id" IS NULL`);
  } else if (typeof scope.departureId === "number") {
    filters.push(Prisma.sql`p."travel_group_departure_id" = ${scope.departureId}`);
  }
  const whereSql = Prisma.join(filters, " AND ");

  try {
    const rows = await prisma.$queryRaw<OperatorPaymentRow[]>(Prisma.sql`
      SELECT
        p."id_travel_group_operator_payment",
        p."agency_travel_group_operator_payment_id",
        p."travel_group_departure_id",
        p."travel_group_passenger_id",
        p."operator_id",
        p."category",
        p."description",
        p."amount",
        p."currency",
        p."created_at",
        p."paid_at",
        p."payment_method",
        p."account",
        p."base_amount",
        p."base_currency",
        p."counter_amount",
        p."counter_currency",
        p."service_refs",
        p."payload",
        tp."booking_id",
        op."name" AS "operator_name"
      FROM "TravelGroupOperatorPayment" p
      LEFT JOIN "TravelGroupPassenger" tp
        ON tp."id_travel_group_passenger" = p."travel_group_passenger_id"
      LEFT JOIN "Operator" op
        ON op."id_operator" = p."operator_id"
      WHERE ${whereSql}
      ORDER BY p."created_at" DESC, p."id_travel_group_operator_payment" DESC
      LIMIT 200
    `);

    return res.status(200).json({
      success: true,
      items: rows.map(buildOperatorPaymentItem),
      nextCursor: null,
    });
  } catch (error) {
    if (isMissingGroupFinanceTableError(error)) {
      return res.status(200).json({
        success: true,
        items: [],
        nextCursor: null,
        schema_ready: false,
      });
    }
    console.error("[groups][finance][operator-payments][GET]", error);
    return groupApiError(
      res,
      500,
      "No pudimos cargar los pagos al operador de la grupal.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENTS_LIST_ERROR",
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
    departureId?: unknown;
    operator_id?: unknown;
    category?: unknown;
    description?: unknown;
    amount?: unknown;
    currency?: unknown;
    paid_at?: unknown;
    payment_method?: unknown;
    account?: unknown;
    base_amount?: unknown;
    base_currency?: unknown;
    counter_amount?: unknown;
    counter_currency?: unknown;
    allocations?: unknown;
    payments?: unknown;
    excess_action?: unknown;
    excess_missing_account_action?: unknown;
  };

  const category =
    typeof body.category === "string" && body.category.trim()
      ? body.category.trim().slice(0, 120)
      : "Pago a operador";
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, 500)
      : "Pago a operador";
  const currencyFallback = normalizeCurrencyCode(body.currency);
  const hasPaymentsPayload = Object.prototype.hasOwnProperty.call(body, "payments");
  if (hasPaymentsPayload && !Array.isArray(body.payments)) {
    return groupApiError(res, 400, "payments inválidos.", {
      code: "GROUP_FINANCE_OPERATOR_PAYMENT_PAYMENTS_INVALID",
    });
  }
  const normalizedPayments = normalizeGroupOperatorPaymentLines(
    Array.isArray(body.payments) ? body.payments : [],
    currencyFallback,
  );
  if (
    hasPaymentsPayload &&
    Array.isArray(body.payments) &&
    body.payments.length > 0 &&
    normalizedPayments.length === 0
  ) {
    return groupApiError(
      res,
      400,
      "payments inválidos: cada línea debe incluir amount > 0 y payment_method.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_PAYMENTS_INVALID_LINES",
      },
    );
  }

  const paymentCurrencies = Array.from(
    new Set(normalizedPayments.map((line) => line.payment_currency).filter(Boolean)),
  );
  if (paymentCurrencies.length > 1) {
    return groupApiError(
      res,
      400,
      "Todas las líneas de pago deben tener la misma moneda.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_PAYMENTS_MIXED_CURRENCY",
      },
    );
  }

  const paymentsAmount = normalizedPayments.length
    ? round2(normalizedPayments.reduce((sum, line) => sum + line.amount, 0))
    : null;
  const paymentFeeAmount = normalizedPayments.length
    ? round2(
        normalizedPayments.reduce((sum, line) => sum + (line.fee_amount || 0), 0),
      )
    : 0;
  const amountNumber = paymentsAmount ?? Number(body.amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return groupApiError(res, 400, "El monto del pago debe ser mayor a cero.", {
      code: "GROUP_FINANCE_AMOUNT_INVALID",
    });
  }
  const amount = toDecimal(amountNumber).toDecimalPlaces(2);
  const currency = paymentCurrencies[0] ?? currencyFallback;

  const paidAt = parseDateInput(body.paid_at) ?? new Date();
  const passengerId = parseOptionalPositiveInt(body.passengerId);
  const departureIdRaw = parseOptionalPositiveInt(body.departureId);
  const operatorId = parseOptionalPositiveInt(body.operator_id);
  const paymentMethod = normalizedPayments.length
    ? normalizedPayments[0].payment_method
    : typeof body.payment_method === "string" && body.payment_method.trim()
      ? body.payment_method.trim().slice(0, 120)
      : null;
  const account = normalizedPayments.length
    ? (normalizedPayments[0].account ?? null)
    : typeof body.account === "string" && body.account.trim()
      ? body.account.trim().slice(0, 180)
      : null;

  const baseAmount =
    body.base_amount === null || body.base_amount === undefined || body.base_amount === ""
      ? null
      : toDecimal(Number(body.base_amount)).toDecimalPlaces(2);
  const counterAmount =
    body.counter_amount === null ||
    body.counter_amount === undefined ||
    body.counter_amount === ""
      ? null
      : toDecimal(Number(body.counter_amount)).toDecimalPlaces(2);
  const baseCurrency =
    typeof body.base_currency === "string" && body.base_currency.trim()
      ? normalizeCurrencyCode(body.base_currency)
      : null;
  const counterCurrency =
    typeof body.counter_currency === "string" && body.counter_currency.trim()
      ? normalizeCurrencyCode(body.counter_currency)
      : null;
  const hasAllocations = Object.prototype.hasOwnProperty.call(body, "allocations");
  if (hasAllocations && !Array.isArray(body.allocations)) {
    return groupApiError(res, 400, "allocations inválidas.", {
      code: "GROUP_FINANCE_ALLOCATIONS_INVALID",
    });
  }
  const allocations = parseGroupOperatorPaymentAllocations(body.allocations);
  if (hasDuplicatedServices(allocations)) {
    return groupApiError(
      res,
      400,
      "No podés repetir servicios en las asignaciones.",
      {
        code: "GROUP_FINANCE_ALLOCATIONS_DUPLICATED_SERVICE",
      },
    );
  }
  for (const allocation of allocations) {
    if (!Number.isFinite(allocation.amount_payment) || allocation.amount_payment < 0) {
      return groupApiError(res, 400, "Monto asignado inválido.", {
        code: "GROUP_FINANCE_ALLOCATION_AMOUNT_INVALID",
      });
    }
    if (!Number.isFinite(allocation.amount_service) || allocation.amount_service < 0) {
      return groupApiError(res, 400, "Monto por servicio inválido.", {
        code: "GROUP_FINANCE_ALLOCATION_SERVICE_AMOUNT_INVALID",
      });
    }
    if (
      allocation.fx_rate != null &&
      (!Number.isFinite(allocation.fx_rate) || allocation.fx_rate <= 0)
    ) {
      return groupApiError(res, 400, "Tipo de cambio inválido.", {
        code: "GROUP_FINANCE_ALLOCATION_FX_INVALID",
      });
    }
    if (
      allocation.payment_currency &&
      normalizeCurrencyCode(allocation.payment_currency) !== currency
    ) {
      return groupApiError(
        res,
        400,
        "La moneda de asignación debe coincidir con la moneda del pago.",
        {
          code: "GROUP_FINANCE_ALLOCATION_PAYMENT_CURRENCY_MISMATCH",
        },
      );
    }
  }
  const assignedTotal = sumAssignedAmount(allocations);
  if (assignedTotal - amountNumber > GROUP_OPERATOR_PAYMENT_TOLERANCE) {
    return groupApiError(
      res,
      400,
      "El total asignado no puede superar el monto del pago.",
      {
        code: "GROUP_FINANCE_ALLOCATIONS_ASSIGNED_EXCEEDS_AMOUNT",
      },
    );
  }
  const excessAction = Object.prototype.hasOwnProperty.call(body, "excess_action")
    ? normalizeGroupOperatorExcessAction(body.excess_action)
    : "carry";
  if (excessAction === undefined) {
    return groupApiError(res, 400, "excess_action inválido.", {
      code: "GROUP_FINANCE_EXCESS_ACTION_INVALID",
    });
  }
  const missingAction = Object.prototype.hasOwnProperty.call(
    body,
    "excess_missing_account_action",
  )
    ? normalizeGroupOperatorMissingAction(body.excess_missing_account_action)
    : "carry";
  if (missingAction === undefined) {
    return groupApiError(res, 400, "excess_missing_account_action inválido.", {
      code: "GROUP_FINANCE_EXCESS_MISSING_ACTION_INVALID",
    });
  }

  let departureId: number | null = departureIdRaw ?? null;
  if (passengerId) {
    const passenger = await prisma.travelGroupPassenger.findFirst({
      where: {
        id_agency: ctx.auth.id_agency,
        travel_group_id: ctx.group.id_travel_group,
        id_travel_group_passenger: passengerId,
      },
      select: {
        id_travel_group_passenger: true,
        travel_group_departure_id: true,
      },
    });
    if (!passenger) {
      return groupApiError(res, 404, "Pasajero no encontrado en esta grupal.", {
        code: "GROUP_FINANCE_PASSENGER_NOT_FOUND",
      });
    }
    departureId = passenger.travel_group_departure_id ?? null;
  }

  const serviceRefs = getServiceRefsFromAllocations(allocations);
  if (serviceRefs.length > 0) {
    const realServiceIds = serviceRefs.filter((id) => !decodeInventoryServiceId(id));
    const inventoryIds = Array.from(
      new Set(
        serviceRefs
          .map((id) => decodeInventoryServiceId(id))
          .filter(
            (id): id is number =>
              typeof id === "number" && Number.isFinite(id) && id > 0,
          ),
      ),
    );

    if (realServiceIds.length > 0) {
      const serviceRows = await prisma.service.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          id_service: { in: realServiceIds },
        },
        select: {
          id_service: true,
          id_operator: true,
        },
      });
      const foundIds = new Set(serviceRows.map((row) => row.id_service));
      const missingServices = realServiceIds.filter((id) => !foundIds.has(id));
      if (missingServices.length > 0) {
        return groupApiError(
          res,
          400,
          "Algunos servicios asignados no existen o no pertenecen a la agencia.",
          {
            code: "GROUP_FINANCE_ALLOCATION_SERVICE_NOT_FOUND",
          },
        );
      }
      if (operatorId) {
        const operatorMismatch = serviceRows.some(
          (row) =>
            Number.isFinite(row.id_operator) &&
            row.id_operator > 0 &&
            row.id_operator !== operatorId,
        );
        if (operatorMismatch) {
          return groupApiError(
            res,
            400,
            "El operador del pago no coincide con los servicios seleccionados.",
            {
              code: "GROUP_FINANCE_ALLOCATION_OPERATOR_MISMATCH",
            },
          );
        }
      }
    }

    if (inventoryIds.length > 0) {
      const inventoryWhere: Prisma.TravelGroupInventoryWhereInput = {
        id_agency: ctx.auth.id_agency,
        travel_group_id: ctx.group.id_travel_group,
        id_travel_group_inventory: { in: inventoryIds },
        ...(departureId === null
          ? { travel_group_departure_id: null }
          : typeof departureId === "number"
            ? {
                OR: [
                  { travel_group_departure_id: null },
                  { travel_group_departure_id: departureId },
                ],
              }
            : {}),
      };
      const inventoryRows = await prisma.travelGroupInventory.findMany({
        where: inventoryWhere,
        select: { id_travel_group_inventory: true },
      });
      if (inventoryRows.length !== inventoryIds.length) {
        return groupApiError(
          res,
          400,
          "Hay servicios de inventario fuera del contexto de la grupal/salida.",
          {
            code: "GROUP_FINANCE_ALLOCATION_INVENTORY_SCOPE_MISMATCH",
          },
        );
      }
    }
  }

  const payload = {
    allocations,
    payments: normalizedPayments,
    payment_fee_amount: paymentFeeAmount,
    excess_action: excessAction ?? null,
    excess_missing_account_action: missingAction ?? null,
    base_amount: baseAmount == null ? null : toAmountNumber(baseAmount),
    base_currency: baseCurrency,
    counter_amount: counterAmount == null ? null : toAmountNumber(counterAmount),
    counter_currency: counterCurrency,
    source: "groups-finance",
  };

  await prisma.$transaction(async (tx) => {
    const agencyPaymentId = await getNextAgencyCounter(
      tx,
      ctx.auth.id_agency,
      "travel_group_operator_payment",
    );
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "TravelGroupOperatorPayment" (
        "agency_travel_group_operator_payment_id",
        "id_agency",
        "travel_group_id",
        "travel_group_departure_id",
        "travel_group_passenger_id",
        "operator_id",
        "category",
        "description",
        "amount",
        "currency",
        "paid_at",
        "payment_method",
        "account",
        "base_amount",
        "base_currency",
        "counter_amount",
        "counter_currency",
        "service_refs",
        "payload",
        "created_by",
        "updated_at"
      ) VALUES (
        ${agencyPaymentId},
        ${ctx.auth.id_agency},
        ${ctx.group.id_travel_group},
        ${departureId},
        ${passengerId},
        ${operatorId},
        ${category},
        ${description},
        ${amount},
        ${currency},
        ${paidAt},
        ${paymentMethod},
        ${account},
        ${baseAmount},
        ${baseCurrency},
        ${counterAmount},
        ${counterCurrency},
        ${serviceRefs},
        ${payload}::jsonb,
        ${ctx.auth.id_user},
        NOW()
      )
    `);
  });

  return res.status(201).json({ success: true });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
