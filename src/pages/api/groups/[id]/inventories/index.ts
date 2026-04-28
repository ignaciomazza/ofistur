import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import {
  canWriteGroups,
  isLockedGroupStatus,
  parseDepartureWhereInput,
  parseGroupWhereInput,
  parseOptionalInt,
  parseOptionalString,
  requireAuth,
} from "@/lib/groups/apiShared";
import { groupApiError } from "@/lib/groups/apiErrors";
import { encodeInventoryServiceId } from "@/lib/groups/inventoryServiceRefs";

type Body = {
  departure_id?: unknown;
  inventory_type?: unknown;
  service_type?: unknown;
  label?: unknown;
  provider?: unknown;
  locator?: unknown;
  total_qty?: unknown;
  assigned_qty?: unknown;
  confirmed_qty?: unknown;
  blocked_qty?: unknown;
  currency?: unknown;
  unit_cost?: unknown;
  note?: unknown;
};

function pickParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function parseOptionalDecimal(
  value: unknown,
): Prisma.Decimal | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n =
    typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return new Prisma.Decimal(n.toFixed(2));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const rawGroupId = pickParam(req.query.id);
  if (!rawGroupId) {
    return groupApiError(
      res,
      400,
      "El identificador de la grupal es inválido.",
      {
        code: "GROUP_ID_INVALID",
        solution: "Volvé al listado de grupales y abrila nuevamente.",
      },
    );
  }
  const groupWhere = parseGroupWhereInput(rawGroupId, auth.id_agency);
  if (!groupWhere) {
    return groupApiError(res, 404, "No encontramos la grupal solicitada.", {
      code: "GROUP_NOT_FOUND",
      solution: "Revisá que exista y pertenezca a tu agencia.",
    });
  }
  const group = await prisma.travelGroup.findFirst({
    where: groupWhere,
    select: {
      id_travel_group: true,
      id_agency: true,
      status: true,
    },
  });
  if (!group) {
    return groupApiError(res, 404, "No encontramos la grupal solicitada.", {
      code: "GROUP_NOT_FOUND",
      solution: "Revisá que exista y pertenezca a tu agencia.",
    });
  }

  if (req.method === "GET") {
    const departureParam = pickParam(req.query.departureId);
    let departureId: number | null = null;
    if (departureParam) {
      const departureWhere = parseDepartureWhereInput(
        departureParam,
        auth.id_agency,
      );
      if (!departureWhere) {
        return groupApiError(res, 404, "La salida indicada es inválida.", {
          code: "DEPARTURE_INVALID",
          solution: "Seleccioná una salida válida de esta grupal.",
        });
      }
      const departure = await prisma.travelGroupDeparture.findFirst({
        where: {
          AND: [
            departureWhere,
            {
              id_agency: auth.id_agency,
              travel_group_id: group.id_travel_group,
            },
          ],
        },
        select: { id_travel_group_departure: true },
      });
      if (!departure) {
        return groupApiError(
          res,
          404,
          "No encontramos esa salida dentro de la grupal.",
          {
            code: "DEPARTURE_NOT_FOUND",
            solution: "Refrescá la pantalla y elegí una salida existente.",
          },
        );
      }
      departureId = departure.id_travel_group_departure;
    }

    try {
      const items = await prisma.travelGroupInventory.findMany({
        where: {
          id_agency: auth.id_agency,
          travel_group_id: group.id_travel_group,
          ...(departureId
            ? {
                OR: [
                  { travel_group_departure_id: null },
                  { travel_group_departure_id: departureId },
                ],
              }
            : {}),
        },
        include: {
          travelGroupDeparture: {
            select: {
              id_travel_group_departure: true,
              name: true,
              departure_date: true,
            },
          },
        },
        orderBy: [
          { created_at: "desc" },
          { id_travel_group_inventory: "desc" },
        ],
      });
      const serviceRefs = items.map((item) =>
        String(encodeInventoryServiceId(item.id_travel_group_inventory)),
      );
      const assignedRows =
        serviceRefs.length > 0
          ? await prisma.travelGroupClientPayment.findMany({
              where: {
                id_agency: auth.id_agency,
                travel_group_id: group.id_travel_group,
                service_ref: { in: serviceRefs },
                status: { not: "CANCELADA" },
              },
              select: {
                service_ref: true,
                travel_group_passenger_id: true,
              },
            })
          : [];
      const assignedByServiceRef = new Map<string, Set<number>>();
      for (const row of assignedRows) {
        const serviceRef = String(row.service_ref || "");
        if (!serviceRef) continue;
        const set = assignedByServiceRef.get(serviceRef) ?? new Set<number>();
        set.add(row.travel_group_passenger_id);
        assignedByServiceRef.set(serviceRef, set);
      }
      return res.status(200).json({
        items: items.map((item) => {
          const serviceRef = String(
            encodeInventoryServiceId(item.id_travel_group_inventory),
          );
          const derivedAssigned =
            assignedByServiceRef.get(serviceRef)?.size ?? 0;
          return {
            ...item,
            assigned_qty: derivedAssigned,
          };
        }),
      });
    } catch (error) {
      console.error("[groups][inventories][GET]", error);
      return groupApiError(
        res,
        500,
        "No pudimos listar los servicios de la grupal.",
        {
          code: "GROUP_INVENTORY_LIST_ERROR",
          solution: "Reintentá en unos segundos.",
        },
      );
    }
  }

  if (req.method === "POST") {
    if (!canWriteGroups(auth.role)) {
      return groupApiError(
        res,
        403,
        "No tenés permisos para cargar servicios en la grupal.",
        {
          code: "GROUP_INVENTORY_CREATE_FORBIDDEN",
          solution:
            "Solicitá permisos de edición de grupales a un administrador.",
        },
      );
    }
    if (isLockedGroupStatus(group.status)) {
      return groupApiError(
        res,
        409,
        "No se pueden cargar servicios en una grupal cerrada o cancelada.",
        {
          code: "GROUP_LOCKED",
          solution: "Cambiá el estado de la grupal antes de continuar.",
        },
      );
    }

    const body = (req.body ?? {}) as Body;
    const inventoryType = parseOptionalString(body.inventory_type, 50);
    if (!inventoryType) {
      return groupApiError(res, 400, "El tipo de servicio es obligatorio.", {
        code: "GROUP_INVENTORY_TYPE_REQUIRED",
        solution: "Elegí o escribí un tipo válido (aéreo, hotel, etc.).",
      });
    }
    const serviceType = parseOptionalString(body.service_type, 80);
    if (serviceType === undefined) {
      return groupApiError(res, 400, "El subtipo de servicio es inválido.", {
        code: "GROUP_INVENTORY_SERVICE_TYPE_INVALID",
        solution: "Usá hasta 80 caracteres o dejalo vacío.",
      });
    }
    const label = parseOptionalString(body.label, 160);
    if (!label) {
      return groupApiError(res, 400, "El nombre del servicio es obligatorio.", {
        code: "GROUP_INVENTORY_LABEL_REQUIRED",
        solution: "Ingresá una etiqueta corta para identificar el servicio.",
      });
    }
    const provider = parseOptionalString(body.provider, 120);
    if (provider === undefined) {
      return groupApiError(res, 400, "El proveedor del servicio es inválido.", {
        code: "GROUP_INVENTORY_PROVIDER_INVALID",
        solution: "Usá hasta 120 caracteres o dejalo vacío.",
      });
    }
    const locator = parseOptionalString(body.locator, 120);
    if (locator === undefined) {
      return groupApiError(
        res,
        400,
        "El localizador/referencia del servicio es inválido.",
        {
          code: "GROUP_INVENTORY_LOCATOR_INVALID",
          solution: "Usá hasta 120 caracteres o dejalo vacío.",
        },
      );
    }

    const totalQty = parseOptionalInt(body.total_qty);
    if (totalQty == null || totalQty <= 0) {
      return groupApiError(
        res,
        400,
        "La cantidad total del servicio es inválida.",
        {
          code: "GROUP_INVENTORY_TOTAL_QTY_INVALID",
          solution: "Ingresá una cantidad mayor a 0.",
        },
      );
    }
    const assignedQty = parseOptionalInt(body.assigned_qty);
    if (assignedQty === undefined || (assignedQty != null && assignedQty < 0)) {
      return groupApiError(
        res,
        400,
        "La cantidad asignada del servicio es inválida.",
        {
          code: "GROUP_INVENTORY_ASSIGNED_QTY_INVALID",
          solution: "Ingresá una cantidad válida o dejá 0.",
        },
      );
    }
    const confirmedQty = parseOptionalInt(body.confirmed_qty);
    if (
      confirmedQty === undefined ||
      (confirmedQty != null && confirmedQty < 0)
    ) {
      return groupApiError(
        res,
        400,
        "La cantidad confirmada del servicio es inválida.",
        {
          code: "GROUP_INVENTORY_CONFIRMED_QTY_INVALID",
          solution: "Ingresá una cantidad válida o dejá 0.",
        },
      );
    }
    const blockedQty = parseOptionalInt(body.blocked_qty);
    if (blockedQty === undefined || (blockedQty != null && blockedQty < 0)) {
      return groupApiError(
        res,
        400,
        "La cantidad bloqueada del servicio es inválida.",
        {
          code: "GROUP_INVENTORY_BLOCKED_QTY_INVALID",
          solution: "Ingresá una cantidad válida o dejá 0.",
        },
      );
    }

    const currency = parseOptionalString(body.currency, 12);
    if (currency === undefined) {
      return groupApiError(res, 400, "La moneda del servicio es inválida.", {
        code: "GROUP_INVENTORY_CURRENCY_INVALID",
        solution: "Usá hasta 12 caracteres o dejala vacía.",
      });
    }

    const unitCost = parseOptionalDecimal(body.unit_cost);
    if (unitCost === undefined) {
      return groupApiError(res, 400, "El costo del servicio es inválido.", {
        code: "GROUP_INVENTORY_UNIT_COST_INVALID",
        solution: "Ingresá un valor numérico mayor o igual a 0.",
      });
    }

    const note = parseOptionalString(body.note, 1000);
    if (note === undefined) {
      return groupApiError(res, 400, "La nota del servicio es inválida.", {
        code: "GROUP_INVENTORY_NOTE_INVALID",
        solution: "Usá hasta 1000 caracteres o dejala vacía.",
      });
    }

    const departureRaw = body.departure_id;
    let departureId: number | null = null;
    if (departureRaw != null && departureRaw !== "") {
      const departureWhere = parseDepartureWhereInput(
        String(departureRaw),
        auth.id_agency,
      );
      if (!departureWhere) {
        return groupApiError(res, 404, "La salida indicada es inválida.", {
          code: "DEPARTURE_INVALID",
          solution: "Seleccioná una salida válida de esta grupal.",
        });
      }
      const departure = await prisma.travelGroupDeparture.findFirst({
        where: {
          AND: [
            departureWhere,
            {
              id_agency: auth.id_agency,
              travel_group_id: group.id_travel_group,
            },
          ],
        },
        select: { id_travel_group_departure: true },
      });
      if (!departure) {
        return groupApiError(
          res,
          404,
          "No encontramos esa salida dentro de la grupal.",
          {
            code: "DEPARTURE_NOT_FOUND",
            solution: "Refrescá la pantalla y elegí una salida existente.",
          },
        );
      }
      departureId = departure.id_travel_group_departure;
    }

    const assigned = assignedQty ?? 0;
    const confirmed = confirmedQty ?? 0;
    const blocked = blockedQty ?? 0;
    if (assigned > totalQty || confirmed > totalQty || blocked > totalQty) {
      return groupApiError(
        res,
        400,
        "Las cantidades asignada/confirmada/bloqueada no pueden superar el total.",
        {
          code: "GROUP_INVENTORY_QTY_OUT_OF_RANGE",
          solution:
            "Ajustá los valores para que sean menores o iguales al total del servicio.",
        },
      );
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const agencyInventoryId = await getNextAgencyCounter(
          tx,
          auth.id_agency,
          "travel_group_inventory",
        );
        return tx.travelGroupInventory.create({
          data: {
            agency_travel_group_inventory_id: agencyInventoryId,
            id_agency: auth.id_agency,
            travel_group_id: group.id_travel_group,
            travel_group_departure_id: departureId,
            inventory_type: inventoryType,
            service_type: serviceType,
            label,
            provider,
            locator,
            total_qty: totalQty,
            assigned_qty: assigned,
            confirmed_qty: confirmed,
            blocked_qty: blocked,
            currency: currency ? currency.toUpperCase() : null,
            unit_cost: unitCost,
            note,
          },
          include: {
            travelGroupDeparture: {
              select: {
                id_travel_group_departure: true,
                name: true,
                departure_date: true,
              },
            },
          },
        });
      });
      return res.status(201).json(created);
    } catch (error) {
      console.error("[groups][inventories][POST]", error);
      return groupApiError(
        res,
        500,
        "No pudimos cargar el servicio de la grupal.",
        {
          code: "GROUP_INVENTORY_CREATE_ERROR",
          solution: "Revisá los datos e intentá nuevamente.",
        },
      );
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return groupApiError(res, 405, "Método no permitido para esta ruta.", {
    code: "METHOD_NOT_ALLOWED",
    details: `Método recibido: ${req.method ?? "desconocido"}.`,
    solution: "Usá GET para listar o POST para crear servicios.",
  });
}
