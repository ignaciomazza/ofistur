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

type DueRow = {
  id_travel_group_operator_due: number;
  agency_travel_group_operator_due_id: number | null;
  travel_group_passenger_id: number | null;
  travel_group_departure_id: number | null;
  operator_id: number | null;
  concept: string;
  service_ref: string | null;
  due_date: Date;
  status: string;
  amount: Prisma.Decimal | number | string;
  currency: string;
  created_at: Date;
  booking_id: number | null;
};

function normalizeDueStatus(raw: unknown): string {
  const normalized = String(raw || "")
    .trim()
    .toUpperCase();
  if (normalized === "PAGO") return "PAGADA";
  if (normalized === "CANCELADO") return "CANCELADA";
  if (normalized === "CANCELADA") return "CANCELADA";
  if (normalized === "PAGADA") return "PAGADA";
  return "PENDIENTE";
}

function buildDueResponse(row: DueRow) {
  const serviceId = Number(String(row.service_ref ?? "").replace(/\D/g, ""));
  return {
    id_due: row.id_travel_group_operator_due,
    agency_operator_due_id: row.agency_travel_group_operator_due_id,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    booking_id: row.booking_id ?? 0,
    service_id: Number.isFinite(serviceId) && serviceId > 0 ? serviceId : 0,
    due_date:
      row.due_date instanceof Date
        ? row.due_date.toISOString()
        : new Date(row.due_date).toISOString(),
    concept: row.concept,
    status: row.status,
    amount: toAmountNumber(row.amount),
    currency: normalizeCurrencyCode(row.currency),
    operator_id: row.operator_id,
    travel_group_passenger_id: row.travel_group_passenger_id,
    travel_group_departure_id: row.travel_group_departure_id,
    service_ref: row.service_ref,
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
    Prisma.sql`d."id_agency" = ${ctx.auth.id_agency}`,
    Prisma.sql`d."travel_group_id" = ${ctx.group.id_travel_group}`,
  ];
  if (passengerId) {
    filters.push(Prisma.sql`d."travel_group_passenger_id" = ${passengerId}`);
  }
  if (scope.departureId === null) {
    filters.push(Prisma.sql`d."travel_group_departure_id" IS NULL`);
  } else if (typeof scope.departureId === "number") {
    filters.push(Prisma.sql`d."travel_group_departure_id" = ${scope.departureId}`);
  }
  const whereSql = Prisma.join(filters, " AND ");

  try {
    const rows = await prisma.$queryRaw<DueRow[]>(Prisma.sql`
      SELECT
        d."id_travel_group_operator_due",
        d."agency_travel_group_operator_due_id",
        d."travel_group_passenger_id",
        d."travel_group_departure_id",
        d."operator_id",
        d."concept",
        d."service_ref",
        d."due_date",
        d."status",
        d."amount",
        d."currency",
        d."created_at",
        tp."booking_id"
      FROM "TravelGroupOperatorDue" d
      LEFT JOIN "TravelGroupPassenger" tp
        ON tp."id_travel_group_passenger" = d."travel_group_passenger_id"
      WHERE ${whereSql}
      ORDER BY d."due_date" ASC, d."id_travel_group_operator_due" ASC
    `);

    return res.status(200).json({
      success: true,
      dues: rows.map(buildDueResponse),
    });
  } catch (error) {
    if (isMissingGroupFinanceTableError(error)) {
      return res.status(200).json({
        success: true,
        dues: [],
        schema_ready: false,
      });
    }
    console.error("[groups][finance][operator-dues][GET]", error);
    return groupApiError(
      res,
      500,
      "No pudimos cargar los vencimientos de operador de la grupal.",
      {
        code: "GROUP_FINANCE_OPERATOR_DUES_LIST_ERROR",
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
    operatorId?: unknown;
    serviceId?: unknown;
    dueDate?: unknown;
    concept?: unknown;
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
  };

  const dueDate = parseDateInput(body.dueDate);
  if (!dueDate) {
    return groupApiError(res, 400, "Fecha de vencimiento inválida.", {
      code: "GROUP_FINANCE_DUE_DATE_INVALID",
    });
  }

  const concept =
    typeof body.concept === "string" && body.concept.trim()
      ? body.concept.trim().slice(0, 250)
      : null;
  if (!concept) {
    return groupApiError(res, 400, "El concepto es obligatorio.", {
      code: "GROUP_FINANCE_CONCEPT_REQUIRED",
    });
  }

  const amount = toDecimal(Number(body.amount)).toDecimalPlaces(2);
  if (amount.lte(0)) {
    return groupApiError(res, 400, "El monto debe ser mayor a cero.", {
      code: "GROUP_FINANCE_AMOUNT_INVALID",
    });
  }

  const status = normalizeDueStatus(body.status);
  const currency = normalizeCurrencyCode(body.currency);
  const operatorId = parseOptionalPositiveInt(body.operatorId);
  const passengerId = parseOptionalPositiveInt(body.passengerId);
  const departureIdRaw = parseOptionalPositiveInt(body.departureId);
  const serviceRef =
    body.serviceId === undefined || body.serviceId === null || body.serviceId === ""
      ? null
      : String(body.serviceId);

  let departureId: number | null = null;
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
  } else {
    departureId = departureIdRaw ?? null;
  }

  const created = await prisma.$transaction(async (tx) => {
    const agencyDueId = await getNextAgencyCounter(
      tx,
      ctx.auth.id_agency,
      "travel_group_operator_due",
    );
    const rows = await tx.$queryRaw<DueRow[]>(Prisma.sql`
      INSERT INTO "TravelGroupOperatorDue" (
        "agency_travel_group_operator_due_id",
        "id_agency",
        "travel_group_id",
        "travel_group_departure_id",
        "travel_group_passenger_id",
        "operator_id",
        "concept",
        "service_ref",
        "due_date",
        "status",
        "amount",
        "currency",
        "updated_at"
      ) VALUES (
        ${agencyDueId},
        ${ctx.auth.id_agency},
        ${ctx.group.id_travel_group},
        ${departureId},
        ${passengerId},
        ${operatorId},
        ${concept},
        ${serviceRef},
        ${dueDate},
        ${status},
        ${amount},
        ${currency},
        NOW()
      )
      RETURNING
        "id_travel_group_operator_due",
        "agency_travel_group_operator_due_id",
        "travel_group_passenger_id",
        "travel_group_departure_id",
        "operator_id",
        "concept",
        "service_ref",
        "due_date",
        "status",
        "amount",
        "currency",
        "created_at",
        NULL::INTEGER AS "booking_id"
    `);
    return rows[0];
  });

  return res.status(201).json({ success: true, due: buildDueResponse(created) });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
