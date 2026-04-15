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

const hasOwn = (obj: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

type ExistingOperatorPayment = {
  id_travel_group_operator_payment: number;
  travel_group_departure_id: number | null;
  travel_group_passenger_id: number | null;
  operator_id: number | null;
  category: string;
  description: string;
  amount: Prisma.Decimal | number | string;
  currency: string;
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

function mapOperatorPaymentDetail(row: ExistingOperatorPayment) {
  const contextId = row.booking_id ?? null;
  const payload = asPayloadObject(row.payload);
  const allocations = parseGroupOperatorPaymentAllocations(payload.allocations);
  const payments = normalizeGroupOperatorPaymentLines(payload.payments, row.currency);
  const excessAction =
    normalizeGroupOperatorExcessAction(payload.excess_action) ?? "carry";
  const missingAction =
    normalizeGroupOperatorMissingAction(payload.excess_missing_account_action) ??
    "carry";
  const paymentFeeAmount = Number(payload.payment_fee_amount ?? 0);

  return {
    id_investment: row.id_travel_group_operator_payment,
    category: row.category,
    description: row.description,
    amount: toAmountNumber(row.amount),
    currency: normalizeCurrencyCode(row.currency),
    paid_at: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    operator_id: row.operator_id,
    operator: row.operator_id
      ? {
          id_operator: row.operator_id,
          name: row.operator_name ?? null,
        }
      : null,
    context_id: contextId,
    booking_id: contextId,
    context: contextId
      ? {
          id_context: contextId,
          agency_context_id: null,
        }
      : null,
    booking: contextId
      ? {
          id_booking: contextId,
          agency_booking_id: null,
        }
      : null,
    serviceIds: Array.isArray(row.service_refs) ? row.service_refs : [],
    payment_method: row.payment_method,
    account: row.account,
    base_amount:
      row.base_amount == null ? null : toAmountNumber(row.base_amount),
    base_currency: row.base_currency,
    counter_amount:
      row.counter_amount == null ? null : toAmountNumber(row.counter_amount),
    counter_currency: row.counter_currency,
    allocations,
    payments,
    payment_fee_amount: Number.isFinite(paymentFeeAmount) ? paymentFeeAmount : 0,
    excess_action: excessAction,
    excess_missing_account_action: missingAction,
  };
}

async function loadPayment(
  agencyId: number,
  groupId: number,
  paymentId: number,
): Promise<ExistingOperatorPayment | null> {
  const rows = await prisma.$queryRaw<ExistingOperatorPayment[]>(Prisma.sql`
    SELECT
      p."id_travel_group_operator_payment",
      p."travel_group_departure_id",
      p."travel_group_passenger_id",
      p."operator_id",
      p."category",
      p."description",
      p."amount",
      p."currency",
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
    WHERE p."id_travel_group_operator_payment" = ${paymentId}
      AND p."id_agency" = ${agencyId}
      AND p."travel_group_id" = ${groupId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function validateServicesConsistency(args: {
  agencyId: number;
  groupId: number;
  departureId: number | null;
  operatorId: number | null;
  serviceRefs: number[];
}): Promise<{ ok: true } | { ok: false; message: string; code: string }> {
  if (args.serviceRefs.length === 0) return { ok: true };

  const realServiceIds = args.serviceRefs.filter((id) => !decodeInventoryServiceId(id));
  const inventoryIds = Array.from(
    new Set(
      args.serviceRefs
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
        id_agency: args.agencyId,
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
      return {
        ok: false,
        message: "Algunos servicios asignados no existen o no pertenecen a la agencia.",
        code: "GROUP_FINANCE_ALLOCATION_SERVICE_NOT_FOUND",
      };
    }
    if (args.operatorId) {
      const mismatch = serviceRows.some(
        (row) =>
          Number.isFinite(row.id_operator) &&
          row.id_operator > 0 &&
          row.id_operator !== args.operatorId,
      );
      if (mismatch) {
        return {
          ok: false,
          message: "El operador del pago no coincide con los servicios seleccionados.",
          code: "GROUP_FINANCE_ALLOCATION_OPERATOR_MISMATCH",
        };
      }
    }
  }

  if (inventoryIds.length > 0) {
    const inventoryRows = await prisma.travelGroupInventory.findMany({
      where: {
        id_agency: args.agencyId,
        travel_group_id: args.groupId,
        id_travel_group_inventory: { in: inventoryIds },
        ...(args.departureId === null
          ? { travel_group_departure_id: null }
          : typeof args.departureId === "number"
            ? {
                OR: [
                  { travel_group_departure_id: null },
                  { travel_group_departure_id: args.departureId },
                ],
              }
            : {}),
      },
      select: { id_travel_group_inventory: true },
    });
    if (inventoryRows.length !== inventoryIds.length) {
      return {
        ok: false,
        message: "Hay servicios de inventario fuera del contexto de la grupal/salida.",
        code: "GROUP_FINANCE_ALLOCATION_INVENTORY_SCOPE_MISMATCH",
      };
    }
  }

  return { ok: true };
}

function validateAllocations(args: {
  allocations: ReturnType<typeof parseGroupOperatorPaymentAllocations>;
  amountValue: number;
  paymentCurrency: string;
}): { ok: true } | { ok: false; message: string; code: string } {
  if (hasDuplicatedServices(args.allocations)) {
    return {
      ok: false,
      message: "No podés repetir servicios en las asignaciones.",
      code: "GROUP_FINANCE_ALLOCATIONS_DUPLICATED_SERVICE",
    };
  }
  for (const allocation of args.allocations) {
    if (!Number.isFinite(allocation.amount_payment) || allocation.amount_payment < 0) {
      return {
        ok: false,
        message: "Monto asignado inválido.",
        code: "GROUP_FINANCE_ALLOCATION_AMOUNT_INVALID",
      };
    }
    if (!Number.isFinite(allocation.amount_service) || allocation.amount_service < 0) {
      return {
        ok: false,
        message: "Monto por servicio inválido.",
        code: "GROUP_FINANCE_ALLOCATION_SERVICE_AMOUNT_INVALID",
      };
    }
    if (
      allocation.fx_rate != null &&
      (!Number.isFinite(allocation.fx_rate) || allocation.fx_rate <= 0)
    ) {
      return {
        ok: false,
        message: "Tipo de cambio inválido.",
        code: "GROUP_FINANCE_ALLOCATION_FX_INVALID",
      };
    }
    if (
      allocation.payment_currency &&
      normalizeCurrencyCode(allocation.payment_currency) !== args.paymentCurrency
    ) {
      return {
        ok: false,
        message: "La moneda de asignación debe coincidir con la moneda del pago.",
        code: "GROUP_FINANCE_ALLOCATION_PAYMENT_CURRENCY_MISMATCH",
      };
    }
  }
  const assignedTotal = sumAssignedAmount(args.allocations);
  if (assignedTotal - args.amountValue > GROUP_OPERATOR_PAYMENT_TOLERANCE) {
    return {
      ok: false,
      message: "El total asignado no puede superar el monto del pago.",
      code: "GROUP_FINANCE_ALLOCATIONS_ASSIGNED_EXCEEDS_AMOUNT",
    };
  }
  return { ok: true };
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res);
  if (!ctx) return;

  const paymentId = parseOptionalPositiveInt(
    Array.isArray(req.query.paymentId)
      ? req.query.paymentId[0]
      : req.query.paymentId,
  );
  if (!paymentId) {
    return groupApiError(
      res,
      400,
      "El identificador del pago es inválido.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_ID_INVALID",
      },
    );
  }

  const row = await loadPayment(
    ctx.auth.id_agency,
    ctx.group.id_travel_group,
    paymentId,
  );
  if (!row) {
    return groupApiError(
      res,
      404,
      "No encontramos ese pago de operador en la grupal.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_NOT_FOUND",
      },
    );
  }

  return res.status(200).json({
    success: true,
    item: mapOperatorPaymentDetail(row),
  });
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res, { write: true });
  if (!ctx) return;

  const paymentId = parseOptionalPositiveInt(
    Array.isArray(req.query.paymentId)
      ? req.query.paymentId[0]
      : req.query.paymentId,
  );
  if (!paymentId) {
    return groupApiError(
      res,
      400,
      "El identificador del pago es inválido.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_ID_INVALID",
      },
    );
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return groupApiError(res, 400, "Body inválido o vacío.", {
      code: "GROUP_FINANCE_BODY_INVALID",
    });
  }

  const existing = await loadPayment(
    ctx.auth.id_agency,
    ctx.group.id_travel_group,
    paymentId,
  );
  if (!existing) {
    return groupApiError(
      res,
      404,
      "No encontramos ese pago de operador en la grupal.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_NOT_FOUND",
      },
    );
  }

  const body = req.body as Record<string, unknown>;
  const hasAllocations = hasOwn(body, "allocations");
  const hasPayments = hasOwn(body, "payments");
  const hasExcessAction = hasOwn(body, "excess_action");
  const hasMissingAction = hasOwn(body, "excess_missing_account_action");
  if (hasAllocations && !Array.isArray(body.allocations)) {
    return groupApiError(res, 400, "allocations inválidas", {
      code: "GROUP_FINANCE_ALLOCATIONS_INVALID",
    });
  }
  if (hasPayments && !Array.isArray(body.payments)) {
    return groupApiError(res, 400, "payments inválidos.", {
      code: "GROUP_FINANCE_OPERATOR_PAYMENT_PAYMENTS_INVALID",
    });
  }

  const allocations = hasAllocations
    ? parseGroupOperatorPaymentAllocations(body.allocations)
    : parseGroupOperatorPaymentAllocations(asPayloadObject(existing.payload).allocations);
  const payments = hasPayments
    ? normalizeGroupOperatorPaymentLines(body.payments, existing.currency)
    : normalizeGroupOperatorPaymentLines(asPayloadObject(existing.payload).payments, existing.currency);

  if (
    hasPayments &&
    Array.isArray(body.payments) &&
    body.payments.length > 0 &&
    payments.length === 0
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
    new Set(payments.map((line) => line.payment_currency).filter(Boolean)),
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

  const paymentCurrency = paymentCurrencies[0] ?? normalizeCurrencyCode(existing.currency);
  const amountValue = toAmountNumber(existing.amount);
  const allocationsValidation = validateAllocations({
    allocations,
    amountValue,
    paymentCurrency,
  });
  if (!allocationsValidation.ok) {
    return groupApiError(res, 400, allocationsValidation.message, {
      code: allocationsValidation.code,
    });
  }

  const serviceRefs = getServiceRefsFromAllocations(allocations);
  const serviceValidation = await validateServicesConsistency({
    agencyId: ctx.auth.id_agency,
    groupId: ctx.group.id_travel_group,
    departureId: existing.travel_group_departure_id ?? null,
    operatorId: existing.operator_id ?? null,
    serviceRefs,
  });
  if (!serviceValidation.ok) {
    return groupApiError(res, 400, serviceValidation.message, {
      code: serviceValidation.code,
    });
  }

  const excessAction = hasExcessAction
    ? normalizeGroupOperatorExcessAction(body.excess_action)
    : undefined;
  if (hasExcessAction && excessAction === undefined) {
    return groupApiError(res, 400, "excess_action inválido.", {
      code: "GROUP_FINANCE_EXCESS_ACTION_INVALID",
    });
  }
  const missingAction = hasMissingAction
    ? normalizeGroupOperatorMissingAction(body.excess_missing_account_action)
    : undefined;
  if (hasMissingAction && missingAction === undefined) {
    return groupApiError(
      res,
      400,
      "excess_missing_account_action inválido.",
      {
        code: "GROUP_FINANCE_EXCESS_MISSING_ACTION_INVALID",
      },
    );
  }

  const nextPayload = asPayloadObject(existing.payload);
  nextPayload.source = "groups-finance";
  nextPayload.allocations = allocations;
  nextPayload.payments = payments;
  nextPayload.payment_fee_amount = payments.reduce(
    (sum, line) => sum + (line.fee_amount || 0),
    0,
  );
  nextPayload.excess_action =
    excessAction ?? nextPayload.excess_action ?? "carry";
  nextPayload.excess_missing_account_action =
    missingAction ?? nextPayload.excess_missing_account_action ?? "carry";
  nextPayload.base_amount =
    existing.base_amount == null ? null : toAmountNumber(existing.base_amount);
  nextPayload.base_currency = existing.base_currency;
  nextPayload.counter_amount =
    existing.counter_amount == null ? null : toAmountNumber(existing.counter_amount);
  nextPayload.counter_currency = existing.counter_currency;

  const data: Prisma.TravelGroupOperatorPaymentUncheckedUpdateInput = {
    updated_at: new Date(),
    service_refs: serviceRefs,
    payload: nextPayload as Prisma.InputJsonValue,
  };

  await prisma.travelGroupOperatorPayment.update({
    where: { id_travel_group_operator_payment: paymentId },
    data,
  });

  return res.status(200).json({ success: true });
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res, { write: true });
  if (!ctx) return;

  const paymentId = parseOptionalPositiveInt(
    Array.isArray(req.query.paymentId)
      ? req.query.paymentId[0]
      : req.query.paymentId,
  );
  if (!paymentId) {
    return groupApiError(
      res,
      400,
      "El identificador del pago es inválido.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_ID_INVALID",
      },
    );
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return groupApiError(res, 400, "Body inválido o vacío.", {
      code: "GROUP_FINANCE_BODY_INVALID",
    });
  }

  const existing = await loadPayment(
    ctx.auth.id_agency,
    ctx.group.id_travel_group,
    paymentId,
  );
  if (!existing) {
    return groupApiError(
      res,
      404,
      "No encontramos ese pago de operador en la grupal.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_NOT_FOUND",
      },
    );
  }

  const body = req.body as Record<string, unknown>;
  const payloadObject = asPayloadObject(existing.payload);
  const data: Prisma.TravelGroupOperatorPaymentUncheckedUpdateInput = {
    updated_at: new Date(),
  };
  let touched = false;
  let payloadTouched = false;

  if (hasOwn(body, "category")) {
    const raw = body.category;
    if (typeof raw !== "string" || !raw.trim()) {
      return groupApiError(res, 400, "La categoría del pago es inválida.", {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_CATEGORY_INVALID",
      });
    }
    data.category = raw.trim().slice(0, 120);
    touched = true;
  }

  if (hasOwn(body, "description")) {
    const raw = body.description;
    if (typeof raw !== "string" || !raw.trim()) {
      return groupApiError(
        res,
        400,
        "La descripción del pago es inválida.",
        {
          code: "GROUP_FINANCE_OPERATOR_PAYMENT_DESCRIPTION_INVALID",
        },
      );
    }
    data.description = raw.trim().slice(0, 500);
    touched = true;
  }

  if (hasOwn(body, "operator_id")) {
    const raw = body.operator_id;
    if (raw === null || raw === "") {
      data.operator_id = null;
    } else {
      const parsed = parseOptionalPositiveInt(raw);
      if (!parsed) {
        return groupApiError(res, 400, "El operador del pago es inválido.", {
          code: "GROUP_FINANCE_OPERATOR_PAYMENT_OPERATOR_INVALID",
        });
      }
      data.operator_id = parsed;
    }
    touched = true;
  }

  if (hasOwn(body, "amount")) {
    const parsed = Number(body.amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return groupApiError(res, 400, "El monto del pago es inválido.", {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_AMOUNT_INVALID",
      });
    }
    data.amount = toDecimal(parsed).toDecimalPlaces(2);
    touched = true;
  }

  if (hasOwn(body, "currency")) {
    const raw = body.currency;
    if (typeof raw !== "string" || !raw.trim()) {
      return groupApiError(res, 400, "La moneda del pago es inválida.", {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_CURRENCY_INVALID",
      });
    }
    data.currency = normalizeCurrencyCode(raw);
    touched = true;
  }

  if (hasOwn(body, "paid_at")) {
    const raw = body.paid_at;
    if (raw === null || raw === "") {
      data.paid_at = null;
    } else {
      const parsed = parseDateInput(raw);
      if (!parsed) {
        return groupApiError(res, 400, "La fecha de pago es inválida.", {
          code: "GROUP_FINANCE_OPERATOR_PAYMENT_PAID_AT_INVALID",
        });
      }
      data.paid_at = parsed;
    }
    touched = true;
  }

  if (hasOwn(body, "payment_method")) {
    const raw = body.payment_method;
    if (raw === null || raw === "") {
      data.payment_method = null;
    } else if (typeof raw === "string" && raw.trim()) {
      data.payment_method = raw.trim().slice(0, 120);
    } else {
      return groupApiError(res, 400, "El método de pago es inválido.", {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_METHOD_INVALID",
      });
    }
    touched = true;
  }

  if (hasOwn(body, "account")) {
    const raw = body.account;
    if (raw === null || raw === "") {
      data.account = null;
    } else if (typeof raw === "string" && raw.trim()) {
      data.account = raw.trim().slice(0, 180);
    } else {
      return groupApiError(res, 400, "La cuenta del pago es inválida.", {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_ACCOUNT_INVALID",
      });
    }
    touched = true;
  }

  if (hasOwn(body, "base_amount")) {
    const raw = body.base_amount;
    if (raw === null || raw === "") {
      data.base_amount = null;
    } else {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return groupApiError(
          res,
          400,
          "El valor base del pago es inválido.",
          {
            code: "GROUP_FINANCE_OPERATOR_PAYMENT_BASE_AMOUNT_INVALID",
          },
        );
      }
      data.base_amount = toDecimal(parsed).toDecimalPlaces(2);
    }
    touched = true;
  }

  if (hasOwn(body, "counter_amount")) {
    const raw = body.counter_amount;
    if (raw === null || raw === "") {
      data.counter_amount = null;
    } else {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return groupApiError(
          res,
          400,
          "El contravalor del pago es inválido.",
          {
            code: "GROUP_FINANCE_OPERATOR_PAYMENT_COUNTER_AMOUNT_INVALID",
          },
        );
      }
      data.counter_amount = toDecimal(parsed).toDecimalPlaces(2);
    }
    touched = true;
  }

  if (hasOwn(body, "base_currency")) {
    const raw = body.base_currency;
    if (raw === null || raw === "") {
      data.base_currency = null;
    } else if (typeof raw === "string" && raw.trim()) {
      data.base_currency = normalizeCurrencyCode(raw);
    } else {
      return groupApiError(res, 400, "La moneda base es inválida.", {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_BASE_CURRENCY_INVALID",
      });
    }
    touched = true;
  }

  if (hasOwn(body, "counter_currency")) {
    const raw = body.counter_currency;
    if (raw === null || raw === "") {
      data.counter_currency = null;
    } else if (typeof raw === "string" && raw.trim()) {
      data.counter_currency = normalizeCurrencyCode(raw);
    } else {
      return groupApiError(res, 400, "La moneda de contravalor es inválida.", {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_COUNTER_CURRENCY_INVALID",
      });
    }
    touched = true;
  }

  const hasAllocations = hasOwn(body, "allocations");
  const hasPayments = hasOwn(body, "payments");
  if (hasAllocations && !Array.isArray(body.allocations)) {
    return groupApiError(res, 400, "allocations inválidas", {
      code: "GROUP_FINANCE_ALLOCATIONS_INVALID",
    });
  }
  if (hasPayments && !Array.isArray(body.payments)) {
    return groupApiError(res, 400, "payments inválidos.", {
      code: "GROUP_FINANCE_OPERATOR_PAYMENT_PAYMENTS_INVALID",
    });
  }

  const requestedAmountValue = hasOwn(body, "amount")
    ? Number(body.amount)
    : toAmountNumber(existing.amount);
  if (!Number.isFinite(requestedAmountValue) || requestedAmountValue <= 0) {
    return groupApiError(res, 400, "El monto del pago es inválido.", {
      code: "GROUP_FINANCE_OPERATOR_PAYMENT_AMOUNT_INVALID",
    });
  }

  const requestedCurrency = hasOwn(body, "currency")
    ? normalizeCurrencyCode(body.currency)
    : normalizeCurrencyCode(existing.currency);
  const nextOperatorId = hasOwn(body, "operator_id")
    ? data.operator_id == null
      ? null
      : Number(data.operator_id)
    : existing.operator_id;

  const payments = hasPayments
    ? normalizeGroupOperatorPaymentLines(body.payments, requestedCurrency)
    : normalizeGroupOperatorPaymentLines(payloadObject.payments, requestedCurrency);
  if (
    hasPayments &&
    Array.isArray(body.payments) &&
    body.payments.length > 0 &&
    payments.length === 0
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
    new Set(payments.map((line) => line.payment_currency).filter(Boolean)),
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
  const effectiveCurrency = paymentCurrencies[0] ?? requestedCurrency;
  const effectiveAmountValue =
    payments.length > 0
      ? payments.reduce((sum, line) => sum + line.amount, 0)
      : requestedAmountValue;

  const allocations = hasAllocations
    ? parseGroupOperatorPaymentAllocations(body.allocations)
    : parseGroupOperatorPaymentAllocations(payloadObject.allocations);
  const allocationsValidation = validateAllocations({
    allocations,
    amountValue: effectiveAmountValue,
    paymentCurrency: effectiveCurrency,
  });
  if (!allocationsValidation.ok) {
    return groupApiError(res, 400, allocationsValidation.message, {
      code: allocationsValidation.code,
    });
  }

  const serviceRefs = getServiceRefsFromAllocations(allocations);
  const servicesValidation = await validateServicesConsistency({
    agencyId: ctx.auth.id_agency,
    groupId: ctx.group.id_travel_group,
    departureId: existing.travel_group_departure_id ?? null,
    operatorId: nextOperatorId ?? null,
    serviceRefs,
  });
  if (!servicesValidation.ok) {
    return groupApiError(res, 400, servicesValidation.message, {
      code: servicesValidation.code,
    });
  }

  if (payments.length > 0) {
    data.currency = effectiveCurrency;
    data.amount = toDecimal(effectiveAmountValue).toDecimalPlaces(2);
    data.payment_method = payments[0].payment_method;
    data.account = payments[0].account ?? null;
    touched = true;
  }

  const hasExcessAction = hasOwn(body, "excess_action");
  const hasMissingAction = hasOwn(body, "excess_missing_account_action");
  const excessAction = hasExcessAction
    ? normalizeGroupOperatorExcessAction(body.excess_action)
    : undefined;
  if (hasExcessAction && excessAction === undefined) {
    return groupApiError(res, 400, "excess_action inválido.", {
      code: "GROUP_FINANCE_EXCESS_ACTION_INVALID",
    });
  }
  const missingAction = hasMissingAction
    ? normalizeGroupOperatorMissingAction(body.excess_missing_account_action)
    : undefined;
  if (hasMissingAction && missingAction === undefined) {
    return groupApiError(
      res,
      400,
      "excess_missing_account_action inválido.",
      {
        code: "GROUP_FINANCE_EXCESS_MISSING_ACTION_INVALID",
      },
    );
  }

  if (
    hasAllocations ||
    hasPayments ||
    hasExcessAction ||
    hasMissingAction ||
    hasOwn(body, "base_amount") ||
    hasOwn(body, "base_currency") ||
    hasOwn(body, "counter_amount") ||
    hasOwn(body, "counter_currency")
  ) {
    payloadTouched = true;
    payloadObject.source = "groups-finance";
    payloadObject.allocations = allocations;
    payloadObject.payments = payments;
    payloadObject.payment_fee_amount = payments.reduce(
      (sum, line) => sum + (line.fee_amount || 0),
      0,
    );
    payloadObject.excess_action =
      excessAction ?? payloadObject.excess_action ?? "carry";
    payloadObject.excess_missing_account_action =
      missingAction ?? payloadObject.excess_missing_account_action ?? "carry";
    payloadObject.base_amount = hasOwn(body, "base_amount")
      ? data.base_amount == null
        ? null
        : toAmountNumber(data.base_amount)
      : existing.base_amount == null
        ? null
        : toAmountNumber(existing.base_amount);
    payloadObject.base_currency = hasOwn(body, "base_currency")
      ? data.base_currency ?? null
      : existing.base_currency;
    payloadObject.counter_amount = hasOwn(body, "counter_amount")
      ? data.counter_amount == null
        ? null
        : toAmountNumber(data.counter_amount)
      : existing.counter_amount == null
        ? null
        : toAmountNumber(existing.counter_amount);
    payloadObject.counter_currency = hasOwn(body, "counter_currency")
      ? data.counter_currency ?? null
      : existing.counter_currency;
    data.service_refs = serviceRefs;
    touched = true;
  }

  if (!touched) {
    return groupApiError(res, 400, "No hay cambios para guardar.", {
      code: "GROUP_FINANCE_OPERATOR_PAYMENT_PATCH_EMPTY",
    });
  }

  if (payloadTouched) {
    data.payload = payloadObject as Prisma.InputJsonValue;
  }

  await prisma.travelGroupOperatorPayment.update({
    where: { id_travel_group_operator_payment: paymentId },
    data,
  });

  return res.status(200).json({ success: true });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res, { write: true });
  if (!ctx) return;

  const paymentId = parseOptionalPositiveInt(
    Array.isArray(req.query.paymentId)
      ? req.query.paymentId[0]
      : req.query.paymentId,
  );
  if (!paymentId) {
    return groupApiError(
      res,
      400,
      "El identificador del pago es inválido.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_ID_INVALID",
      },
    );
  }

  const deleted = await prisma.travelGroupOperatorPayment.deleteMany({
    where: {
      id_travel_group_operator_payment: paymentId,
      id_agency: ctx.auth.id_agency,
      travel_group_id: ctx.group.id_travel_group,
    },
  });
  if (deleted.count === 0) {
    return groupApiError(
      res,
      404,
      "No encontramos ese pago de operador en la grupal.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_NOT_FOUND",
      },
    );
  }

  return res.status(204).end();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "PUT") return handlePut(req, res);
  if (req.method === "PATCH") return handlePatch(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  res.setHeader("Allow", ["GET", "PUT", "PATCH", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
