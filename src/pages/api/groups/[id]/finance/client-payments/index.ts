import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  deriveClientPaymentStatus,
  isMissingGroupFinanceTableError,
  normalizeCurrencyCode,
  parseDateInput,
  parseOptionalPositiveInt,
  parseScopeFilter,
  requireGroupFinanceContext,
  toAmountNumber,
  toDecimal,
} from "@/lib/groups/financeShared";

type PaymentRow = {
  id_travel_group_client_payment: number;
  agency_travel_group_client_payment_id: number | null;
  travel_group_passenger_id: number;
  travel_group_departure_id: number | null;
  client_id: number;
  amount: Prisma.Decimal | string | number;
  currency: string;
  due_date: Date;
  status: string;
  paid_at: Date | null;
  status_reason: string | null;
  created_at: Date;
  concept: string | null;
  service_ref: string | null;
  booking_id: number | null;
  agency_client_id: number | null;
  first_name: string | null;
  last_name: string | null;
};

function buildClientPaymentResponse(row: PaymentRow) {
  const dueDate = row.due_date instanceof Date ? row.due_date : new Date(row.due_date);
  const derived = deriveClientPaymentStatus(row.status, dueDate);
  return {
    id_payment: row.id_travel_group_client_payment,
    agency_client_payment_id: row.agency_travel_group_client_payment_id,
    booking_id: row.booking_id ?? 0,
    client_id: row.client_id,
    amount: toAmountNumber(row.amount),
    currency: normalizeCurrencyCode(row.currency),
    due_date: dueDate.toISOString(),
    status: row.status,
    derived_status: derived.derivedStatus,
    is_overdue: derived.isOverdue,
    paid_at: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    status_reason: row.status_reason,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    concept: row.concept,
    service_ref: row.service_ref,
    client: {
      id_client: row.client_id,
      agency_client_id: row.agency_client_id,
      first_name: row.first_name ?? "",
      last_name: row.last_name ?? "",
    },
  };
}

function splitAmounts(total: Prisma.Decimal, installments: number): Prisma.Decimal[] {
  const normalizedInstallments = Math.max(1, Math.trunc(installments));
  const totalCents = total.mul(100);
  const base = totalCents.div(normalizedInstallments).floor();
  const remainder = totalCents.minus(base.mul(normalizedInstallments)).toNumber();
  return Array.from({ length: normalizedInstallments }, (_, idx) => {
    const cents = base.plus(idx < remainder ? 1 : 0);
    return cents.div(100).toDecimalPlaces(2);
  });
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
      solution: "Usá `group` o `departure:{id}`.",
    });
  }

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
    const rows = await prisma.$queryRaw<PaymentRow[]>(Prisma.sql`
      SELECT
        p."id_travel_group_client_payment",
        p."agency_travel_group_client_payment_id",
        p."travel_group_passenger_id",
        p."travel_group_departure_id",
        p."client_id",
        p."amount",
        p."currency",
        p."due_date",
        p."status",
        p."paid_at",
        p."status_reason",
        p."created_at",
        p."concept",
        p."service_ref",
        tp."booking_id",
        c."agency_client_id",
        c."first_name",
        c."last_name"
      FROM "TravelGroupClientPayment" p
      LEFT JOIN "TravelGroupPassenger" tp
        ON tp."id_travel_group_passenger" = p."travel_group_passenger_id"
      LEFT JOIN "Client" c
        ON c."id_client" = p."client_id"
      WHERE ${whereSql}
      ORDER BY p."due_date" ASC, p."id_travel_group_client_payment" ASC
    `);

    return res.status(200).json({
      success: true,
      payments: rows.map(buildClientPaymentResponse),
    });
  } catch (error) {
    if (isMissingGroupFinanceTableError(error)) {
      return res.status(200).json({
        success: true,
        payments: [],
        schema_ready: false,
      });
    }
    console.error("[groups][finance][client-payments][GET]", error);
    return groupApiError(
      res,
      500,
      "No pudimos cargar las cuotas de la grupal.",
      {
        code: "GROUP_FINANCE_CLIENT_PAYMENTS_LIST_ERROR",
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
    clientId?: unknown;
    serviceId?: unknown;
    concept?: unknown;
    count?: unknown;
    amount?: unknown;
    amounts?: unknown;
    currency?: unknown;
    dueDates?: unknown;
  };

  const passengerId = parseOptionalPositiveInt(body.passengerId);
  if (!passengerId) {
    return groupApiError(res, 400, "Pasajero inválido para crear cuotas.", {
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
    },
  });
  if (!passenger) {
    return groupApiError(res, 404, "Pasajero no encontrado en esta grupal.", {
      code: "GROUP_FINANCE_PASSENGER_NOT_FOUND",
    });
  }

  const requestedClientId = parseOptionalPositiveInt(body.clientId);
  const clientId = requestedClientId ?? passenger.client_id ?? null;
  if (!clientId || clientId <= 0) {
    return groupApiError(res, 400, "Cliente inválido para crear cuotas.", {
      code: "GROUP_FINANCE_CLIENT_INVALID",
    });
  }
  if (passenger.client_id && passenger.client_id !== clientId) {
    return groupApiError(res, 400, "El cliente no coincide con el pasajero.", {
      code: "GROUP_FINANCE_CLIENT_MISMATCH",
      solution: "Creá/seleccioná el pasajero correcto antes de cargar cuotas.",
    });
  }

  const rawDueDates = Array.isArray(body.dueDates) ? body.dueDates : [];
  const parsedDueDates = rawDueDates
    .map((item) => parseDateInput(item))
    .filter((item): item is Date => item instanceof Date);
  if (parsedDueDates.length === 0) {
    return groupApiError(
      res,
      400,
      "Debés enviar al menos una fecha de vencimiento válida.",
      { code: "GROUP_FINANCE_DUE_DATES_INVALID" },
    );
  }
  if (parsedDueDates.length !== rawDueDates.length) {
    return groupApiError(res, 400, "Una o más fechas de vencimiento son inválidas.", {
      code: "GROUP_FINANCE_DUE_DATES_INVALID",
    });
  }

  const currency = normalizeCurrencyCode(body.currency);
  const concept =
    typeof body.concept === "string" && body.concept.trim()
      ? body.concept.trim().slice(0, 250)
      : null;
  const serviceRef =
    body.serviceId === undefined || body.serviceId === null || body.serviceId === ""
      ? null
      : String(body.serviceId);

  const installmentCount = Math.max(
    1,
    Number.isFinite(Number(body.count)) ? Number(body.count) : parsedDueDates.length,
  );
  const hasAmounts = Array.isArray(body.amounts);

  let amountsPerInstallment: Prisma.Decimal[] = [];
  if (hasAmounts) {
    const amounts = (body.amounts as unknown[])
      .map((item) => toDecimal(Number(item)))
      .map((item) => item.toDecimalPlaces(2));
    if (amounts.length !== parsedDueDates.length) {
      return groupApiError(
        res,
        400,
        "La cantidad de montos no coincide con los vencimientos enviados.",
        { code: "GROUP_FINANCE_AMOUNTS_INVALID" },
      );
    }
    if (amounts.some((item) => item.lte(0))) {
      return groupApiError(res, 400, "Todos los montos deben ser mayores a cero.", {
        code: "GROUP_FINANCE_AMOUNTS_INVALID",
      });
    }
    amountsPerInstallment = amounts;
  } else {
    const totalRaw = body.amount;
    if (totalRaw === undefined || totalRaw === null || totalRaw === "") {
      return groupApiError(res, 400, "El monto total es obligatorio.", {
        code: "GROUP_FINANCE_AMOUNT_REQUIRED",
      });
    }
    const total = toDecimal(
      typeof totalRaw === "number" ? totalRaw : Number(String(totalRaw)),
    ).toDecimalPlaces(2);
    if (total.lte(0)) {
      return groupApiError(res, 400, "El monto total debe ser mayor a cero.", {
        code: "GROUP_FINANCE_AMOUNT_INVALID",
      });
    }
    const n = parsedDueDates.length || installmentCount;
    amountsPerInstallment = splitAmounts(total, n);
  }

  const createdRows = await prisma.$transaction(async (tx) => {
    const rows: PaymentRow[] = [];
    for (let idx = 0; idx < parsedDueDates.length; idx += 1) {
      const agencyPaymentId = await getNextAgencyCounter(
        tx,
        ctx.auth.id_agency,
        "travel_group_client_payment",
      );
      const created = await tx.$queryRaw<PaymentRow[]>(Prisma.sql`
        INSERT INTO "TravelGroupClientPayment" (
          "agency_travel_group_client_payment_id",
          "id_agency",
          "travel_group_id",
          "travel_group_departure_id",
          "travel_group_passenger_id",
          "client_id",
          "concept",
          "service_ref",
          "amount",
          "currency",
          "due_date",
          "status",
          "updated_at"
        ) VALUES (
          ${agencyPaymentId},
          ${ctx.auth.id_agency},
          ${ctx.group.id_travel_group},
          ${passenger.travel_group_departure_id},
          ${passenger.id_travel_group_passenger},
          ${clientId},
          ${concept},
          ${serviceRef},
          ${amountsPerInstallment[idx]},
          ${currency},
          ${parsedDueDates[idx]},
          ${"PENDIENTE"},
          NOW()
        )
        RETURNING
          "id_travel_group_client_payment",
          "agency_travel_group_client_payment_id",
          "travel_group_passenger_id",
          "travel_group_departure_id",
          "client_id",
          "amount",
          "currency",
          "due_date",
          "status",
          "paid_at",
          "status_reason",
          "created_at",
          "concept",
          "service_ref",
          NULL::INTEGER AS "booking_id",
          NULL::INTEGER AS "agency_client_id",
          NULL::TEXT AS "first_name",
          NULL::TEXT AS "last_name"
      `);
      if (created[0]) rows.push(created[0]);
    }
    return rows;
  });

  const client = await prisma.client.findUnique({
    where: { id_client: clientId },
    select: {
      id_client: true,
      agency_client_id: true,
      first_name: true,
      last_name: true,
    },
  });

  return res.status(201).json({
    success: true,
    payments: createdRows.map((row) =>
      buildClientPaymentResponse({
        ...row,
        booking_id: null,
        agency_client_id: client?.agency_client_id ?? null,
        first_name: client?.first_name ?? null,
        last_name: client?.last_name ?? null,
      }),
    ),
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
