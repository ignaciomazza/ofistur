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
import {
  decodeInventoryServiceId,
  encodeInventoryServiceId,
  resolveInventorySaleUnitPrice,
} from "@/lib/groups/inventoryServiceRefs";
import { isGroupServiceAssignment } from "@/lib/groups/clientPaymentRecordType";
import { calculateGroupInvoiceServiceTotals } from "@/lib/groups/groupInvoiceServiceTotals";
import {
  GroupFinanceRequestError,
  isGroupFinanceRequestError,
  lockGroupInventoryServiceIds,
  lockGroupPassenger,
} from "@/lib/groups/groupFinanceMutationGuards";

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
  const contextId = row.booking_id ?? 0;
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
    context_id: contextId,
    bookingId_booking: contextId,
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
    Array.isArray(req.query.passengerId)
      ? req.query.passengerId[0]
      : req.query.passengerId,
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
    filters.push(
      Prisma.sql`i."travel_group_departure_id" = ${scope.departureId}`,
    );
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

  const requestedClientId = parseOptionalPositiveInt(body.clientId);
  if (
    requestedClientId &&
    passenger.client_id &&
    requestedClientId !== passenger.client_id
  ) {
    return groupApiError(
      res,
      409,
      "El cliente indicado no corresponde al pasajero seleccionado.",
      {
        code: "GROUP_FINANCE_INVOICE_PASSENGER_CLIENT_MISMATCH",
        solution: "Refrescá la pantalla y volvé a seleccionar el pasajero.",
      },
    );
  }
  const clientId = passenger.client_id ?? requestedClientId ?? null;
  if (!clientId) {
    return groupApiError(res, 400, "Cliente inválido para facturar.", {
      code: "GROUP_FINANCE_CLIENT_INVALID",
    });
  }

  const serviceIds = Array.from(
    new Set(
      Array.isArray(body.services)
        ? body.services
            .map((item) => parseOptionalPositiveInt(item))
            .filter((item): item is number => !!item)
        : [],
    ),
  );

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
          const taxCategory = String(raw.taxCategory || "21")
            .trim()
            .toUpperCase();
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
        .filter(
          (
            item,
          ): item is {
            description: string;
            taxCategory: string;
            amount: number | null;
          } => !!item,
        )
    : [];

  const manualTotals =
    body.manualTotals && typeof body.manualTotals === "object"
      ? (body.manualTotals as { total?: unknown })
      : null;
  const manualTotal =
    manualTotals?.total !== undefined &&
    manualTotals.total !== null &&
    manualTotals.total !== ""
      ? toDecimal(Number(manualTotals.total)).toDecimalPlaces(2)
      : null;
  const customTotal = customItems.reduce(
    (acc, item) => acc + (item.amount != null ? Number(item.amount) : 0),
    0,
  );

  const tipoFactura = Number(body.tipoFactura);
  const type = tipoFactura === 1 ? "A" : "B";
  const issueDate = parseDateInput(body.invoiceDate) ?? new Date();
  const exchangeRate =
    body.exchangeRate === null ||
    body.exchangeRate === undefined ||
    body.exchangeRate === ""
      ? null
      : toDecimal(Number(body.exchangeRate)).toDecimalPlaces(6);
  const payloadAfip = {
    source: "GROUPS_INTERNAL",
    manualTotals: body.manualTotals ?? null,
    description21: Array.isArray(body.description21) ? body.description21 : [],
    description10_5: Array.isArray(body.description10_5)
      ? body.description10_5
      : [],
    descriptionNonComputable: Array.isArray(body.descriptionNonComputable)
      ? body.descriptionNonComputable
      : [],
    customItems,
  };

  let created: GroupInvoiceRow;
  try {
    created = await prisma.$transaction(async (tx) => {
      // Serialize a group invoice with an ARCA issuer switch for this agency.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(77445::integer, ${ctx.auth.id_agency}::integer)`;
      await lockGroupPassenger(tx, {
        agencyId: ctx.auth.id_agency,
        groupId: ctx.group.id_travel_group,
        passengerId: passenger.id_travel_group_passenger,
      });
      const lockedPassenger = await tx.travelGroupPassenger.findFirst({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          id_travel_group_passenger: passenger.id_travel_group_passenger,
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
      if (!lockedPassenger) {
        throw new GroupFinanceRequestError({
          status: 409,
          code: "GROUP_FINANCE_PASSENGER_CHANGED",
          message: "El pasajero cambió mientras se emitía la factura.",
          solution: "Refrescá la grupal y volvé a intentarlo.",
        });
      }
      if (
        requestedClientId &&
        lockedPassenger.client_id &&
        requestedClientId !== lockedPassenger.client_id
      ) {
        throw new GroupFinanceRequestError({
          status: 409,
          code: "GROUP_FINANCE_INVOICE_PASSENGER_CLIENT_MISMATCH",
          message: "El cliente ya no corresponde al pasajero seleccionado.",
          solution: "Refrescá la grupal y volvé a seleccionar el pasajero.",
        });
      }
      const lockedClientId =
        lockedPassenger.client_id ?? requestedClientId ?? null;
      if (!lockedClientId) {
        throw new GroupFinanceRequestError({
          status: 400,
          code: "GROUP_FINANCE_CLIENT_INVALID",
          message: "Cliente inválido para facturar.",
        });
      }

      await lockGroupInventoryServiceIds(tx, {
        agencyId: ctx.auth.id_agency,
        groupId: ctx.group.id_travel_group,
        serviceIds,
      });

      const regularServiceIds: number[] = [];
      const inventoryServiceIds: number[] = [];
      for (const serviceId of serviceIds) {
        const inventoryId = decodeInventoryServiceId(serviceId);
        if (inventoryId) inventoryServiceIds.push(inventoryId);
        else regularServiceIds.push(serviceId);
      }
      if (regularServiceIds.length > 0) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id_service"
          FROM "Service"
          WHERE "id_agency" = ${ctx.auth.id_agency}
            AND "id_service" IN (${Prisma.join(regularServiceIds)})
          ORDER BY "id_service"
          FOR UPDATE
        `);
      }

      const inventoryServiceRefs = inventoryServiceIds.map((inventoryId) =>
        String(encodeInventoryServiceId(inventoryId)),
      );
      const [regularServices, inventoryServices, assignmentRows] =
        await Promise.all([
          regularServiceIds.length > 0
            ? tx.service.findMany({
                where: {
                  id_service: { in: regularServiceIds },
                  id_agency: ctx.auth.id_agency,
                },
                select: {
                  id_service: true,
                  sale_price: true,
                  currency: true,
                },
              })
            : Promise.resolve([]),
          inventoryServiceIds.length > 0
            ? tx.travelGroupInventory.findMany({
                where: {
                  id_agency: ctx.auth.id_agency,
                  travel_group_id: ctx.group.id_travel_group,
                  id_travel_group_inventory: {
                    in: inventoryServiceIds,
                  },
                  ...(lockedPassenger.travel_group_departure_id == null
                    ? { travel_group_departure_id: null }
                    : {
                        OR: [
                          { travel_group_departure_id: null },
                          {
                            travel_group_departure_id:
                              lockedPassenger.travel_group_departure_id,
                          },
                        ],
                      }),
                },
                select: {
                  id_travel_group_inventory: true,
                  unit_cost: true,
                  currency: true,
                  total_qty: true,
                  note: true,
                },
              })
            : Promise.resolve([]),
          inventoryServiceRefs.length > 0
            ? tx.travelGroupClientPayment.findMany({
                where: {
                  id_agency: ctx.auth.id_agency,
                  travel_group_id: ctx.group.id_travel_group,
                  travel_group_passenger_id:
                    lockedPassenger.id_travel_group_passenger,
                  service_ref: { in: inventoryServiceRefs },
                  status: { not: "CANCELADA" },
                },
                select: {
                  service_ref: true,
                  amount: true,
                  currency: true,
                  concept: true,
                  status_reason: true,
                  metadata: true,
                },
              })
            : Promise.resolve([]),
        ]);

      const assignmentByServiceRef = new Map(
        assignmentRows
          .filter(isGroupServiceAssignment)
          .map((item) => [String(item.service_ref || ""), item] as const),
      );
      const serviceTotals = calculateGroupInvoiceServiceTotals({
        requestedServiceIds: serviceIds,
        services: [
          ...regularServices.map((service) => ({
            serviceId: service.id_service,
            currency: service.currency,
            amount: toAmountNumber(service.sale_price),
          })),
          ...inventoryServices.map((service) => {
            const serviceId = encodeInventoryServiceId(
              service.id_travel_group_inventory,
            );
            const assignment = assignmentByServiceRef.get(String(serviceId));
            return {
              serviceId,
              currency: assignment?.currency ?? service.currency,
              amount:
                assignment?.amount != null
                  ? toAmountNumber(assignment.amount)
                  : resolveInventorySaleUnitPrice(service),
            };
          }),
        ],
      });
      if (!serviceTotals.ok) {
        throw new GroupFinanceRequestError({
          status: 400,
          code: serviceTotals.code,
          message: serviceTotals.message,
          solution:
            serviceTotals.code ===
            "GROUP_FINANCE_INVOICE_CURRENCY_MIX_NOT_ALLOWED"
              ? "Seleccioná servicios de una sola moneda y emití las demás por separado."
              : "Refrescá la grupal y volvé a seleccionar los servicios.",
        });
      }

      let total = toDecimal(serviceTotals.total).toDecimalPlaces(2);
      if (manualTotal) {
        total = manualTotal;
      } else if (customTotal > 0) {
        total = toDecimal(customTotal).toDecimalPlaces(2);
      }
      if (total.lte(0)) {
        throw new GroupFinanceRequestError({
          status: 400,
          code: "GROUP_FINANCE_INVOICE_TOTAL_INVALID",
          message: "No pudimos calcular un total de factura válido.",
          solution:
            "Seleccioná servicios o completá un total manual mayor a cero.",
        });
      }
      const currency = normalizeCurrencyCode(serviceTotals.currency);
      const recipient = lockedPassenger.client?.company_name?.trim()
        ? lockedPassenger.client.company_name.trim()
        : `${lockedPassenger.client?.first_name ?? ""} ${lockedPassenger.client?.last_name ?? ""}`.trim() ||
          `Cliente ${lockedClientId}`;

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
        ${lockedPassenger.travel_group_departure_id},
        ${lockedPassenger.id_travel_group_passenger},
        ${lockedClientId},
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
        ${lockedPassenger.booking_id}::INTEGER AS "booking_id"
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
  } catch (error) {
    if (isGroupFinanceRequestError(error)) {
      return groupApiError(res, error.status, error.message, {
        code: error.code,
        solution: error.solution,
      });
    }
    throw error;
  }

  return res.status(201).json({
    success: true,
    invoices: [buildInvoiceResponse(created)],
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
