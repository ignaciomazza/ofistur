import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  canWriteGroups,
  isLockedGroupStatus,
  parseDepartureWhereInput,
  parseGroupWhereInput,
  parseOptionalInt,
  parseOptionalString,
  parsePositiveInt,
  requireAuth,
} from "@/lib/groups/apiShared";
import { groupApiError } from "@/lib/groups/apiErrors";

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

function parseForceFlag(value: string | string[] | undefined): boolean {
  if (!value) return false;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "si";
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
    select: { id_travel_group: true, status: true },
  });
  if (!group) {
    return groupApiError(res, 404, "No encontramos la grupal solicitada.", {
      code: "GROUP_NOT_FOUND",
      solution: "Revisá que exista y pertenezca a tu agencia.",
    });
  }

  const inventoryIdRaw = pickParam(req.query.inventoryId);
  const inventoryId = parsePositiveInt(inventoryIdRaw);
  if (!inventoryId) {
    return groupApiError(
      res,
      400,
      "El identificador del servicio es inválido.",
      {
        code: "GROUP_INVENTORY_ID_INVALID",
        solution: "Refrescá la pantalla y volvé a intentarlo.",
      },
    );
  }

  const current = await prisma.travelGroupInventory.findFirst({
    where: {
      id_travel_group_inventory: inventoryId,
      id_agency: auth.id_agency,
      travel_group_id: group.id_travel_group,
    },
  });
  if (!current) {
    return groupApiError(
      res,
      404,
      "No encontramos el servicio dentro de esta grupal.",
      {
        code: "GROUP_INVENTORY_NOT_FOUND",
        solution: "Verificá que el servicio exista y pertenezca a esta grupal.",
      },
    );
  }

  if (req.method === "GET") {
    return res.status(200).json(current);
  }

  if (req.method === "PATCH") {
    if (!canWriteGroups(auth.role)) {
      return groupApiError(
        res,
        403,
        "No tenés permisos para editar servicios en la grupal.",
        {
          code: "GROUP_INVENTORY_UPDATE_FORBIDDEN",
          solution:
            "Solicitá permisos de edición de grupales a un administrador.",
        },
      );
    }
    if (isLockedGroupStatus(group.status)) {
      return groupApiError(
        res,
        409,
        "No se pueden editar servicios en una grupal cerrada o cancelada.",
        {
          code: "GROUP_LOCKED",
          solution: "Cambiá el estado de la grupal antes de continuar.",
        },
      );
    }

    const body = (req.body ?? {}) as Body;
    const patch: Prisma.TravelGroupInventoryUncheckedUpdateInput = {};

    if (body.departure_id !== undefined) {
      if (body.departure_id == null || body.departure_id === "") {
        patch.travel_group_departure_id = null;
      } else {
        const departureWhere = parseDepartureWhereInput(
          String(body.departure_id),
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
        patch.travel_group_departure_id = departure.id_travel_group_departure;
      }
    }

    if (body.inventory_type !== undefined) {
      const inventoryType = parseOptionalString(body.inventory_type, 50);
      if (!inventoryType) {
        return groupApiError(res, 400, "El tipo de servicio es obligatorio.", {
          code: "GROUP_INVENTORY_TYPE_REQUIRED",
          solution: "Elegí o escribí un tipo válido (aéreo, hotel, etc.).",
        });
      }
      patch.inventory_type = inventoryType;
    }

    if (body.service_type !== undefined) {
      const serviceType = parseOptionalString(body.service_type, 80);
      if (serviceType === undefined) {
        return groupApiError(res, 400, "El subtipo de servicio es inválido.", {
          code: "GROUP_INVENTORY_SERVICE_TYPE_INVALID",
          solution: "Usá hasta 80 caracteres o dejalo vacío.",
        });
      }
      patch.service_type = serviceType;
    }

    if (body.label !== undefined) {
      const label = parseOptionalString(body.label, 160);
      if (!label) {
        return groupApiError(
          res,
          400,
          "El nombre del servicio es obligatorio.",
          {
            code: "GROUP_INVENTORY_LABEL_REQUIRED",
            solution:
              "Ingresá una etiqueta corta para identificar el servicio.",
          },
        );
      }
      patch.label = label;
    }

    if (body.provider !== undefined) {
      const provider = parseOptionalString(body.provider, 120);
      if (provider === undefined) {
        return groupApiError(
          res,
          400,
          "El proveedor del servicio es inválido.",
          {
            code: "GROUP_INVENTORY_PROVIDER_INVALID",
            solution: "Usá hasta 120 caracteres o dejalo vacío.",
          },
        );
      }
      patch.provider = provider;
    }

    if (body.locator !== undefined) {
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
      patch.locator = locator;
    }

    const nextTotal =
      body.total_qty !== undefined
        ? parseOptionalInt(body.total_qty)
        : current.total_qty;
    if (body.total_qty !== undefined && (nextTotal == null || nextTotal <= 0)) {
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
    if (body.total_qty !== undefined) {
      patch.total_qty = nextTotal!;
    }

    const nextAssigned =
      body.assigned_qty !== undefined
        ? parseOptionalInt(body.assigned_qty)
        : current.assigned_qty;
    if (
      body.assigned_qty !== undefined &&
      (nextAssigned === undefined || nextAssigned == null || nextAssigned < 0)
    ) {
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
    if (body.assigned_qty !== undefined) {
      patch.assigned_qty = nextAssigned!;
    }

    const nextConfirmed =
      body.confirmed_qty !== undefined
        ? parseOptionalInt(body.confirmed_qty)
        : current.confirmed_qty;
    if (
      body.confirmed_qty !== undefined &&
      (nextConfirmed === undefined ||
        nextConfirmed == null ||
        nextConfirmed < 0)
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
    if (body.confirmed_qty !== undefined) {
      patch.confirmed_qty = nextConfirmed!;
    }

    const nextBlocked =
      body.blocked_qty !== undefined
        ? parseOptionalInt(body.blocked_qty)
        : current.blocked_qty;
    if (
      body.blocked_qty !== undefined &&
      (nextBlocked === undefined || nextBlocked == null || nextBlocked < 0)
    ) {
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
    if (body.blocked_qty !== undefined) {
      patch.blocked_qty = nextBlocked!;
    }

    const finalTotal =
      (patch.total_qty as number | undefined) ?? current.total_qty;
    const finalAssigned =
      (patch.assigned_qty as number | undefined) ?? current.assigned_qty;
    const finalConfirmed =
      (patch.confirmed_qty as number | undefined) ?? current.confirmed_qty;
    const finalBlocked =
      (patch.blocked_qty as number | undefined) ?? current.blocked_qty;
    if (
      finalAssigned > finalTotal ||
      finalConfirmed > finalTotal ||
      finalBlocked > finalTotal
    ) {
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

    if (body.currency !== undefined) {
      const currency = parseOptionalString(body.currency, 12);
      if (currency === undefined) {
        return groupApiError(res, 400, "La moneda del servicio es inválida.", {
          code: "GROUP_INVENTORY_CURRENCY_INVALID",
          solution: "Usá hasta 12 caracteres o dejala vacía.",
        });
      }
      patch.currency = currency ? currency.toUpperCase() : null;
    }

    if (body.unit_cost !== undefined) {
      const unitCost = parseOptionalDecimal(body.unit_cost);
      if (unitCost === undefined) {
        return groupApiError(res, 400, "El costo del servicio es inválido.", {
          code: "GROUP_INVENTORY_UNIT_COST_INVALID",
          solution: "Ingresá un valor numérico mayor o igual a 0.",
        });
      }
      patch.unit_cost = unitCost;
    }

    if (body.note !== undefined) {
      const note = parseOptionalString(body.note, 1000);
      if (note === undefined) {
        return groupApiError(res, 400, "La nota del servicio es inválida.", {
          code: "GROUP_INVENTORY_NOTE_INVALID",
          solution: "Usá hasta 1000 caracteres o dejala vacía.",
        });
      }
      patch.note = note;
    }

    try {
      const updated = await prisma.travelGroupInventory.update({
        where: { id_travel_group_inventory: current.id_travel_group_inventory },
        data: patch,
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
      return res.status(200).json(updated);
    } catch (error) {
      console.error("[groups][inventories][PATCH]", error);
      return groupApiError(
        res,
        500,
        "No pudimos actualizar el servicio de la grupal.",
        {
          code: "GROUP_INVENTORY_UPDATE_ERROR",
          solution: "Revisá los datos e intentá nuevamente.",
        },
      );
    }
  }

  if (req.method === "DELETE") {
    if (!canWriteGroups(auth.role)) {
      return groupApiError(
        res,
        403,
        "No tenés permisos para eliminar servicios en la grupal.",
        {
          code: "GROUP_INVENTORY_DELETE_FORBIDDEN",
          solution:
            "Solicitá permisos de edición de grupales a un administrador.",
        },
      );
    }
    if (isLockedGroupStatus(group.status)) {
      return groupApiError(
        res,
        409,
        "No se pueden eliminar servicios en una grupal cerrada o cancelada.",
        {
          code: "GROUP_LOCKED",
          solution: "Cambiá el estado de la grupal antes de continuar.",
        },
      );
    }
    const forceDelete = parseForceFlag(req.query.force);
    if (
      !forceDelete &&
      (current.assigned_qty > 0 || current.confirmed_qty > 0)
    ) {
      return groupApiError(
        res,
        409,
        "No podés eliminar un servicio con cupos asignados o confirmados.",
        {
          code: "GROUP_INVENTORY_DELETE_BLOCKED",
          solution:
            "Confirmá el borrado forzado desde la interfaz o quitá primero las asignaciones/confirmaciones.",
        },
      );
    }
    try {
      await prisma.travelGroupInventory.delete({
        where: { id_travel_group_inventory: current.id_travel_group_inventory },
      });
      return res.status(200).json({
        ok: true,
        forced: forceDelete,
      });
    } catch (error) {
      console.error("[groups][inventories][DELETE]", error);
      return groupApiError(
        res,
        500,
        "No pudimos eliminar el servicio de la grupal.",
        {
          code: "GROUP_INVENTORY_DELETE_ERROR",
          solution: "Reintentá en unos segundos.",
        },
      );
    }
  }

  res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
  return groupApiError(res, 405, "Método no permitido para esta ruta.", {
    code: "METHOD_NOT_ALLOWED",
    details: `Método recibido: ${req.method ?? "desconocido"}.`,
    solution: "Usá GET, PATCH o DELETE en esta ruta.",
  });
}
