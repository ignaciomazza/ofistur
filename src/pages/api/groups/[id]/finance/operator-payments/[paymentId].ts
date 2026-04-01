import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  normalizeCurrencyCode,
  parseDateInput,
  parseOptionalPositiveInt,
  requireGroupFinanceContext,
  toDecimal,
} from "@/lib/groups/financeShared";

type AllocationInput = {
  service_id: number;
  booking_id?: number;
  payment_currency?: string;
  service_currency?: string;
  amount_payment: number;
  amount_service: number;
  fx_rate: number | null;
};

const parseCurrencyCode = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toUpperCase();
  return trimmed || undefined;
};

function parseAllocations(raw: unknown): AllocationInput[] {
  if (!Array.isArray(raw)) return [];
  const out: AllocationInput[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const serviceId = parseOptionalPositiveInt(
      rec.service_id ?? rec.serviceId ?? rec.id_service ?? rec.idService,
    );
    if (!serviceId) continue;

    const amountPayment = Number(rec.amount_payment ?? rec.amountPayment ?? 0);
    const amountService = Number(rec.amount_service ?? rec.amountService ?? 0);
    const fxRaw = rec.fx_rate ?? rec.fxRate;
    const fxRate =
      fxRaw === null || fxRaw === undefined || fxRaw === ""
        ? null
        : Number(fxRaw);
    const bookingId = parseOptionalPositiveInt(rec.booking_id ?? rec.bookingId);
    const paymentCurrency = parseCurrencyCode(
      rec.payment_currency ?? rec.paymentCurrency,
    );
    const serviceCurrency = parseCurrencyCode(
      rec.service_currency ?? rec.serviceCurrency,
    );

    out.push({
      service_id: serviceId,
      booking_id: bookingId ?? undefined,
      payment_currency: paymentCurrency,
      service_currency: serviceCurrency,
      amount_payment: Number.isFinite(amountPayment) ? amountPayment : 0,
      amount_service: Number.isFinite(amountService) ? amountService : 0,
      fx_rate: Number.isFinite(fxRate as number) ? Number(fxRate) : null,
    });
  }

  return out;
}

const normalizeExcessAction = (
  raw: unknown,
): "carry" | "credit_entry" | null | undefined => {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  if (normalized === "carry" || normalized === "credit_entry") {
    return normalized;
  }
  return undefined;
};

const normalizeMissingAction = (
  raw: unknown,
): "carry" | "block" | "create" | null | undefined => {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  if (
    normalized === "carry" ||
    normalized === "block" ||
    normalized === "create"
  ) {
    return normalized;
  }
  return undefined;
};

const hasOwn = (obj: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

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

  const body = req.body as Record<string, unknown>;
  const hasAllocations = Object.prototype.hasOwnProperty.call(body, "allocations");
  const hasExcessAction = Object.prototype.hasOwnProperty.call(
    body,
    "excess_action",
  );
  const hasMissingAction = Object.prototype.hasOwnProperty.call(
    body,
    "excess_missing_account_action",
  );

  if (hasAllocations && !Array.isArray(body.allocations)) {
    return groupApiError(res, 400, "allocations inválidas", {
      code: "GROUP_FINANCE_ALLOCATIONS_INVALID",
    });
  }

  const allocations = hasAllocations ? parseAllocations(body.allocations) : [];
  const serviceRefs = Array.from(new Set(allocations.map((item) => item.service_id)));
  if (serviceRefs.length !== allocations.length) {
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
    if (
      !Number.isFinite(allocation.amount_payment) ||
      allocation.amount_payment < 0
    ) {
      return groupApiError(res, 400, "Monto asignado inválido.", {
        code: "GROUP_FINANCE_ALLOCATION_AMOUNT_INVALID",
      });
    }
    if (
      !Number.isFinite(allocation.amount_service) ||
      allocation.amount_service < 0
    ) {
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
  }

  const excessAction = hasExcessAction
    ? normalizeExcessAction(body.excess_action)
    : undefined;
  if (hasExcessAction && excessAction === undefined) {
    return groupApiError(res, 400, "excess_action inválido.", {
      code: "GROUP_FINANCE_EXCESS_ACTION_INVALID",
    });
  }
  const missingAction = hasMissingAction
    ? normalizeMissingAction(body.excess_missing_account_action)
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

  const existing = await prisma.travelGroupOperatorPayment.findFirst({
    where: {
      id_travel_group_operator_payment: paymentId,
      id_agency: ctx.auth.id_agency,
      travel_group_id: ctx.group.id_travel_group,
    },
    select: {
      id_travel_group_operator_payment: true,
      payload: true,
      service_refs: true,
    },
  });
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

  const payloadObject: Record<string, unknown> =
    existing.payload &&
    typeof existing.payload === "object" &&
    !Array.isArray(existing.payload)
      ? { ...(existing.payload as Record<string, unknown>) }
      : {};

  if (hasAllocations) {
    payloadObject.allocations = allocations;
    payloadObject.source = "groups-finance";
  }
  if (hasExcessAction) {
    payloadObject.excess_action = excessAction;
  }
  if (hasMissingAction) {
    payloadObject.excess_missing_account_action = missingAction;
  }

  const data: Prisma.TravelGroupOperatorPaymentUncheckedUpdateInput = {
    updated_at: new Date(),
  };
  if (hasAllocations) {
    data.service_refs = serviceRefs;
  }
  if (hasAllocations || hasExcessAction || hasMissingAction) {
    data.payload = payloadObject as Prisma.InputJsonValue;
  }

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

  const body = req.body as Record<string, unknown>;
  const existing = await prisma.travelGroupOperatorPayment.findFirst({
    where: {
      id_travel_group_operator_payment: paymentId,
      id_agency: ctx.auth.id_agency,
      travel_group_id: ctx.group.id_travel_group,
    },
    select: {
      id_travel_group_operator_payment: true,
      payload: true,
      service_refs: true,
    },
  });
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

  const payloadObject: Record<string, unknown> =
    existing.payload &&
    typeof existing.payload === "object" &&
    !Array.isArray(existing.payload)
      ? { ...(existing.payload as Record<string, unknown>) }
      : {};

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

  if (hasOwn(body, "allocations")) {
    if (!Array.isArray(body.allocations)) {
      return groupApiError(res, 400, "allocations inválidas", {
        code: "GROUP_FINANCE_ALLOCATIONS_INVALID",
      });
    }
    const allocations = parseAllocations(body.allocations);
    const serviceRefs = Array.from(
      new Set(allocations.map((item) => item.service_id)),
    );
    if (serviceRefs.length !== allocations.length) {
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
      if (
        !Number.isFinite(allocation.amount_payment) ||
        allocation.amount_payment < 0
      ) {
        return groupApiError(res, 400, "Monto asignado inválido.", {
          code: "GROUP_FINANCE_ALLOCATION_AMOUNT_INVALID",
        });
      }
      if (
        !Number.isFinite(allocation.amount_service) ||
        allocation.amount_service < 0
      ) {
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
    }

    data.service_refs = serviceRefs;
    payloadObject.allocations = allocations;
    payloadObject.source = "groups-finance";
    payloadTouched = true;
    touched = true;
  }

  if (hasOwn(body, "payments")) {
    const raw = body.payments;
    if (raw == null) {
      payloadObject.payments = [];
    } else if (Array.isArray(raw)) {
      payloadObject.payments = raw;
    } else {
      return groupApiError(res, 400, "payments inválidos.", {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_PAYMENTS_INVALID",
      });
    }
    payloadTouched = true;
    touched = true;
  }

  if (hasOwn(body, "excess_action")) {
    const excessAction = normalizeExcessAction(body.excess_action);
    if (excessAction === undefined) {
      return groupApiError(res, 400, "excess_action inválido.", {
        code: "GROUP_FINANCE_EXCESS_ACTION_INVALID",
      });
    }
    payloadObject.excess_action = excessAction;
    payloadTouched = true;
    touched = true;
  }

  if (hasOwn(body, "excess_missing_account_action")) {
    const missingAction = normalizeMissingAction(
      body.excess_missing_account_action,
    );
    if (missingAction === undefined) {
      return groupApiError(
        res,
        400,
        "excess_missing_account_action inválido.",
        {
          code: "GROUP_FINANCE_EXCESS_MISSING_ACTION_INVALID",
        },
      );
    }
    payloadObject.excess_missing_account_action = missingAction;
    payloadTouched = true;
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
  if (req.method === "PUT") return handlePut(req, res);
  if (req.method === "PATCH") return handlePatch(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  res.setHeader("Allow", ["PUT", "PATCH", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
