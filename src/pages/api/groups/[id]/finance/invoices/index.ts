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

type GroupInvoiceRow = {
  id_travel_group_invoice: number;
  agency_travel_group_invoice_id: number | null;
  travel_group_departure_id: number | null;
  travel_group_passenger_id: number | null;
  client_id: number;
  issue_date: Date;
  invoice_number: string;
  total_amount: Prisma.Decimal | number | string;
  currency: string;
  status: string;
  type: string;
  recipient: string;
  payload_afip: unknown;
  booking_id: number | null;
};

function buildInvoiceResponse(row: GroupInvoiceRow) {
  return {
    id_invoice: row.id_travel_group_invoice,
    agency_invoice_id: row.agency_travel_group_invoice_id,
    public_id: null,
    id_agency: 0,
    invoice_number: row.invoice_number,
    issue_date:
      row.issue_date instanceof Date
        ? row.issue_date.toISOString()
        : new Date(row.issue_date).toISOString(),
    total_amount: toAmountNumber(row.total_amount),
    status: row.status,
    type: row.type,
    bookingId_booking: row.booking_id ?? 0,
    currency: normalizeCurrencyCode(row.currency),
    recipient: row.recipient,
    client_id: row.client_id,
    payloadAfip: row.payload_afip ?? undefined,
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
    Prisma.sql`i."id_agency" = ${ctx.auth.id_agency}`,
    Prisma.sql`i."travel_group_id" = ${ctx.group.id_travel_group}`,
  ];
  if (passengerId) {
    filters.push(Prisma.sql`i."travel_group_passenger_id" = ${passengerId}`);
  }
  if (scope.departureId === null) {
    filters.push(Prisma.sql`i."travel_group_departure_id" IS NULL`);
  } else if (typeof scope.departureId === "number") {
    filters.push(Prisma.sql`i."travel_group_departure_id" = ${scope.departureId}`);
  }
  const whereSql = Prisma.join(filters, " AND ");

  try {
    const rows = await prisma.$queryRaw<GroupInvoiceRow[]>(Prisma.sql`
      SELECT
        i."id_travel_group_invoice",
        i."agency_travel_group_invoice_id",
        i."travel_group_departure_id",
        i."travel_group_passenger_id",
        i."client_id",
        i."issue_date",
        i."invoice_number",
        i."total_amount",
        i."currency",
        i."status",
        i."type",
        i."recipient",
        i."payload_afip",
        tp."booking_id"
      FROM "TravelGroupInvoice" i
      LEFT JOIN "TravelGroupPassenger" tp
        ON tp."id_travel_group_passenger" = i."travel_group_passenger_id"
      WHERE ${whereSql}
      ORDER BY i."issue_date" DESC, i."id_travel_group_invoice" DESC
    `);

    return res.status(200).json({
      success: true,
      invoices: rows.map(buildInvoiceResponse),
    });
  } catch (error) {
    if (isMissingGroupFinanceTableError(error)) {
      return res.status(200).json({
        success: true,
        invoices: [],
        schema_ready: false,
      });
    }
    console.error("[groups][finance][invoices][GET]", error);
    return groupApiError(
      res,
      500,
      "No pudimos cargar las facturas de la grupal.",
      {
        code: "GROUP_FINANCE_INVOICES_LIST_ERROR",
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
    services?: unknown;
    tipoFactura?: unknown;
    exchangeRate?: unknown;
    invoiceDate?: unknown;
    manualTotals?: unknown;
    description21?: unknown;
    description10_5?: unknown;
    descriptionNonComputable?: unknown;
    customItems?: unknown;
  };

  const passengerId = parseOptionalPositiveInt(body.passengerId);
  if (!passengerId) {
    return groupApiError(res, 400, "Pasajero inválido para emitir factura.", {
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
      client: {
        select: {
          first_name: true,
          last_name: true,
          company_name: true,
        },
      },
    },
  });
  if (!passenger) {
    return groupApiError(res, 404, "Pasajero no encontrado en esta grupal.", {
      code: "GROUP_FINANCE_PASSENGER_NOT_FOUND",
    });
  }

  const clientId = parseOptionalPositiveInt(body.clientId) ?? passenger.client_id ?? null;
  if (!clientId) {
    return groupApiError(res, 400, "Cliente inválido para facturar.", {
      code: "GROUP_FINANCE_CLIENT_INVALID",
    });
  }

  const serviceIds = Array.isArray(body.services)
    ? body.services
        .map((item) => parseOptionalPositiveInt(item))
        .filter((item): item is number => !!item)
    : [];

  const customItems = Array.isArray(body.customItems)
    ? body.customItems
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const raw = item as {
            description?: unknown;
            taxCategory?: unknown;
            amount?: unknown;
          };
          const description =
            typeof raw.description === "string" ? raw.description.trim() : "";
          if (!description) return null;
          const taxCategory = String(raw.taxCategory || "21").trim().toUpperCase();
          const amount =
            raw.amount === null || raw.amount === undefined || raw.amount === ""
              ? null
              : Number(raw.amount);
          return {
            description: description.slice(0, 300),
            taxCategory: ["21", "10_5", "EXEMPT"].includes(taxCategory)
              ? taxCategory
              : "21",
            amount:
              amount != null && Number.isFinite(amount) && amount >= 0
                ? Number(amount.toFixed(2))
                : null,
          };
        })
        .filter((item): item is { description: string; taxCategory: string; amount: number | null } => !!item)
    : [];

  let currency = "ARS";
  let servicesTotal = new Prisma.Decimal(0);
  if (serviceIds.length > 0) {
    const services = await prisma.service.findMany({
      where: {
        id_service: { in: serviceIds },
        id_agency: ctx.auth.id_agency,
      },
      select: { sale_price: true, currency: true },
    });
    if (services.length > 0) {
      currency = normalizeCurrencyCode(services[0].currency);
      servicesTotal = services.reduce(
        (acc, item) => acc.plus(toDecimal(item.sale_price ?? 0)),
        new Prisma.Decimal(0),
      );
    }
  }

  let total = servicesTotal;
  const manualTotals =
    body.manualTotals && typeof body.manualTotals === "object"
      ? (body.manualTotals as { total?: unknown })
      : null;
  if (manualTotals?.total !== undefined && manualTotals.total !== null && manualTotals.total !== "") {
    total = toDecimal(Number(manualTotals.total)).toDecimalPlaces(2);
  } else if (customItems.length > 0) {
    const customSum = customItems.reduce(
      (acc, item) => acc + (item.amount != null ? Number(item.amount) : 0),
      0,
    );
    if (customSum > 0) {
      total = toDecimal(customSum).toDecimalPlaces(2);
    }
  }

  if (total.lte(0)) {
    return groupApiError(res, 400, "No pudimos calcular un total de factura válido.", {
      code: "GROUP_FINANCE_INVOICE_TOTAL_INVALID",
      solution: "Seleccioná servicios o completá un total manual mayor a cero.",
    });
  }

  const tipoFactura = Number(body.tipoFactura);
  const type = tipoFactura === 1 ? "A" : "B";
  const issueDate = parseDateInput(body.invoiceDate) ?? new Date();
  const exchangeRate =
    body.exchangeRate === null ||
    body.exchangeRate === undefined ||
    body.exchangeRate === ""
      ? null
      : toDecimal(Number(body.exchangeRate)).toDecimalPlaces(6);
  const recipient = passenger.client?.company_name?.trim()
    ? passenger.client.company_name.trim()
    : `${passenger.client?.first_name ?? ""} ${passenger.client?.last_name ?? ""}`.trim() ||
      `Cliente ${clientId}`;

  const payloadAfip = {
    source: "GROUPS_INTERNAL",
    manualTotals: body.manualTotals ?? null,
    description21: Array.isArray(body.description21) ? body.description21 : [],
    description10_5: Array.isArray(body.description10_5) ? body.description10_5 : [],
    descriptionNonComputable: Array.isArray(body.descriptionNonComputable)
      ? body.descriptionNonComputable
      : [],
    customItems,
  };

  const created = await prisma.$transaction(async (tx) => {
    const agencyInvoiceId = await getNextAgencyCounter(
      tx,
      ctx.auth.id_agency,
      "travel_group_invoice",
    );
    const invoiceNumber = `${type}-${String(agencyInvoiceId).padStart(8, "0")}`;

    const rows = await tx.$queryRaw<GroupInvoiceRow[]>(Prisma.sql`
      INSERT INTO "TravelGroupInvoice" (
        "agency_travel_group_invoice_id",
        "id_agency",
        "travel_group_id",
        "travel_group_departure_id",
        "travel_group_passenger_id",
        "client_id",
        "issue_date",
        "invoice_number",
        "total_amount",
        "currency",
        "status",
        "type",
        "recipient",
        "exchange_rate",
        "tipo_factura",
        "service_refs",
        "payload_afip",
        "updated_at"
      ) VALUES (
        ${agencyInvoiceId},
        ${ctx.auth.id_agency},
        ${ctx.group.id_travel_group},
        ${passenger.travel_group_departure_id},
        ${passenger.id_travel_group_passenger},
        ${clientId},
        ${issueDate},
        ${invoiceNumber},
        ${total.toDecimalPlaces(2)},
        ${currency},
        ${"EMITIDA"},
        ${type},
        ${recipient},
        ${exchangeRate},
        ${Number.isFinite(tipoFactura) ? tipoFactura : null},
        ${serviceIds},
        ${payloadAfip}::jsonb,
        NOW()
      )
      RETURNING
        "id_travel_group_invoice",
        "agency_travel_group_invoice_id",
        "travel_group_departure_id",
        "travel_group_passenger_id",
        "client_id",
        "issue_date",
        "invoice_number",
        "total_amount",
        "currency",
        "status",
        "type",
        "recipient",
        "payload_afip",
        ${passenger.booking_id}::INTEGER AS "booking_id"
    `);
    const createdInvoice = rows[0];

    if (customItems.length > 0 && createdInvoice) {
      for (const item of customItems) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "TravelGroupInvoiceItem" (
            "travel_group_invoice_id",
            "description",
            "tax_category",
            "amount",
            "updated_at"
          ) VALUES (
            ${createdInvoice.id_travel_group_invoice},
            ${item.description},
            ${item.taxCategory},
            ${item.amount == null ? null : toDecimal(item.amount).toDecimalPlaces(2)},
            NOW()
          )
        `);
      }
    }

    return createdInvoice;
  });

  return res.status(201).json({
    success: true,
    invoices: [buildInvoiceResponse(created)],
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
