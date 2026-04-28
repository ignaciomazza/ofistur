import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import {
  canWriteGroups,
  isLockedGroupStatus,
  parseGroupWhereInput,
  parsePositiveInt,
  requireAuth,
} from "@/lib/groups/apiShared";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  encodeInventoryServiceId,
  resolveInventoryEstimatedSaleUnitPrice,
} from "@/lib/groups/inventoryServiceRefs";

function pickParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function parseOptionalMoney(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const raw = String(value).trim();
  const numericOnly = raw.replace(/[^\d,.-]/g, "");
  const normalized = numericOnly.includes(",")
    ? numericOnly.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(numericOnly)
      ? numericOnly.replace(/\./g, "")
      : numericOnly;
  const parsed = typeof value === "number" ? value : Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (
    req.method !== "POST" &&
    req.method !== "PATCH" &&
    req.method !== "DELETE"
  ) {
    res.setHeader("Allow", ["POST", "PATCH", "DELETE"]);
    return groupApiError(res, 405, "Método no permitido para esta ruta.", {
      code: "METHOD_NOT_ALLOWED",
      solution:
        "Usá POST para asignar, PATCH para ajustar valor o DELETE para anular la asignación.",
    });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!canWriteGroups(auth.role)) {
    return groupApiError(
      res,
      403,
      "No tenés permisos para asignar servicios en la grupal.",
      {
        code: "GROUP_INVENTORY_ASSIGN_FORBIDDEN",
        solution: "Solicitá permisos de edición de grupales.",
      },
    );
  }

  const rawGroupId = pickParam(req.query.id);
  const inventoryId = parsePositiveInt(pickParam(req.query.inventoryId));
  const passengerId = parsePositiveInt(
    typeof req.body?.passengerId === "string" ||
      typeof req.body?.passengerId === "number"
      ? String(req.body.passengerId)
      : null,
  );
  const requestedSaleAmount = parseOptionalMoney(req.body?.saleAmount);

  if (!rawGroupId || !inventoryId || !passengerId) {
    return groupApiError(
      res,
      400,
      "Faltan datos para asignar el servicio al pasajero.",
      {
        code: "GROUP_INVENTORY_ASSIGN_INVALID",
        solution:
          "Refrescá la pantalla y volvé a seleccionar pasajero y servicio.",
      },
    );
  }
  if (
    requestedSaleAmount === null ||
    (req.method === "PATCH" && requestedSaleAmount === undefined)
  ) {
    return groupApiError(res, 400, "El valor de venta indicado no es válido.", {
      code: "GROUP_INVENTORY_ASSIGN_AMOUNT_INVALID",
      solution: "Ingresá un importe mayor o igual a cero.",
    });
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
      status: true,
    },
  });
  if (!group) {
    return groupApiError(res, 404, "No encontramos la grupal solicitada.", {
      code: "GROUP_NOT_FOUND",
      solution: "Revisá que exista y pertenezca a tu agencia.",
    });
  }
  if (isLockedGroupStatus(group.status)) {
    return groupApiError(
      res,
      409,
      "No se pueden asignar servicios en una grupal cerrada o cancelada.",
      {
        code: "GROUP_LOCKED",
        solution: "Cambiá el estado de la grupal antes de continuar.",
      },
    );
  }

  const [inventory, passenger] = await Promise.all([
    prisma.travelGroupInventory.findFirst({
      where: {
        id_travel_group_inventory: inventoryId,
        id_agency: auth.id_agency,
        travel_group_id: group.id_travel_group,
      },
    }),
    prisma.travelGroupPassenger.findFirst({
      where: {
        id_travel_group_passenger: passengerId,
        id_agency: auth.id_agency,
        travel_group_id: group.id_travel_group,
      },
      select: {
        id_travel_group_passenger: true,
        travel_group_departure_id: true,
        client_id: true,
        status: true,
      },
    }),
  ]);

  if (!inventory) {
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
  if (!passenger || !passenger.client_id) {
    return groupApiError(
      res,
      404,
      "No encontramos un pasajero válido para asignar el servicio.",
      {
        code: "GROUP_PASSENGER_NOT_FOUND",
        solution: "Seleccioná un pasajero con cliente vinculado.",
      },
    );
  }
  if (["CANCELADO", "CANCELADA"].includes(String(passenger.status || ""))) {
    return groupApiError(
      res,
      409,
      "No se puede asignar el servicio a un pasajero cancelado.",
      {
        code: "GROUP_PASSENGER_CANCELLED",
        solution: "Seleccioná un pasajero activo.",
      },
    );
  }
  const passengerClientId = passenger.client_id;

  const serviceRef = String(encodeInventoryServiceId(inventoryId));
  const existingAssignments = await prisma.travelGroupClientPayment.findMany({
    where: {
      id_agency: auth.id_agency,
      travel_group_id: group.id_travel_group,
      service_ref: serviceRef,
      status: { not: "CANCELADA" },
    },
    select: {
      travel_group_passenger_id: true,
    },
  });
  const assignedPassengerIds = new Set(
    existingAssignments.map((item) => item.travel_group_passenger_id),
  );
  if (req.method === "DELETE") {
    if (!assignedPassengerIds.has(passenger.id_travel_group_passenger)) {
      return groupApiError(
        res,
        409,
        "Ese servicio no está asignado al pasajero indicado.",
        {
          code: "GROUP_INVENTORY_NOT_ASSIGNED",
          solution: "Refrescá la pantalla y revisá las asignaciones.",
        },
      );
    }

    const passengerAssignments = await prisma.travelGroupClientPayment.findMany(
      {
        where: {
          id_agency: auth.id_agency,
          travel_group_id: group.id_travel_group,
          travel_group_passenger_id: passenger.id_travel_group_passenger,
          service_ref: serviceRef,
          status: { not: "CANCELADA" },
        },
        select: {
          id_travel_group_client_payment: true,
          status: true,
        },
      },
    );
    if (
      passengerAssignments.some(
        (item) => String(item.status || "").toUpperCase() !== "PENDIENTE",
      )
    ) {
      return groupApiError(
        res,
        409,
        "No se puede anular una asignación con pagos ya cobrados.",
        {
          code: "GROUP_INVENTORY_ASSIGNMENT_PAID",
          solution: "Revisá los cobros del pasajero antes de anular.",
        },
      );
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const cancelled = await tx.travelGroupClientPayment.updateMany({
          where: {
            id_agency: auth.id_agency,
            travel_group_id: group.id_travel_group,
            travel_group_passenger_id: passenger.id_travel_group_passenger,
            service_ref: serviceRef,
            status: "PENDIENTE",
          },
          data: {
            status: "CANCELADA",
            status_reason: "Asignación de servicio anulada",
            updated_at: new Date(),
          },
        });
        const updatedInventory = await tx.travelGroupInventory.update({
          where: {
            id_travel_group_inventory: inventory.id_travel_group_inventory,
          },
          data: {
            assigned_qty: Math.max(assignedPassengerIds.size - 1, 0),
          },
        });
        return { cancelled, inventory: updatedInventory };
      });

      return res.status(200).json({
        ok: true,
        cancelled_count: result.cancelled.count,
        assigned_qty: result.inventory.assigned_qty,
      });
    } catch (error) {
      console.error("[groups][inventories][unassign]", error);
      return groupApiError(res, 500, "No pudimos anular la asignación.", {
        code: "GROUP_INVENTORY_UNASSIGN_ERROR",
        solution: "Reintentá en unos segundos.",
      });
    }
  }

  if (req.method === "PATCH") {
    if (!assignedPassengerIds.has(passenger.id_travel_group_passenger)) {
      return groupApiError(
        res,
        409,
        "Ese servicio no está asignado al pasajero indicado.",
        {
          code: "GROUP_INVENTORY_NOT_ASSIGNED",
          solution: "Asigná el servicio antes de ajustar el valor de venta.",
        },
      );
    }

    const passengerAssignments = await prisma.travelGroupClientPayment.findMany(
      {
        where: {
          id_agency: auth.id_agency,
          travel_group_id: group.id_travel_group,
          travel_group_passenger_id: passenger.id_travel_group_passenger,
          service_ref: serviceRef,
          status: { not: "CANCELADA" },
        },
        select: {
          id_travel_group_client_payment: true,
          status: true,
        },
      },
    );
    if (
      passengerAssignments.some(
        (item) => String(item.status || "").toUpperCase() !== "PENDIENTE",
      )
    ) {
      return groupApiError(
        res,
        409,
        "No se puede ajustar una asignación con pagos ya cobrados.",
        {
          code: "GROUP_INVENTORY_ASSIGNMENT_PAID",
          solution: "Revisá los cobros del pasajero antes de ajustar.",
        },
      );
    }

    try {
      const updated = await prisma.travelGroupClientPayment.updateMany({
        where: {
          id_agency: auth.id_agency,
          travel_group_id: group.id_travel_group,
          travel_group_passenger_id: passenger.id_travel_group_passenger,
          service_ref: serviceRef,
          status: "PENDIENTE",
        },
        data: {
          amount: new Prisma.Decimal((requestedSaleAmount ?? 0).toFixed(2)),
          status_reason: "Valor de venta ajustado manualmente",
          updated_at: new Date(),
        },
      });

      return res.status(200).json({
        ok: true,
        updated_count: updated.count,
        amount: requestedSaleAmount ?? 0,
      });
    } catch (error) {
      console.error("[groups][inventories][assign][amount]", error);
      return groupApiError(
        res,
        500,
        "No pudimos actualizar el valor de venta.",
        {
          code: "GROUP_INVENTORY_ASSIGN_AMOUNT_ERROR",
          solution: "Reintentá en unos segundos.",
        },
      );
    }
  }

  const saleUnitPrice = resolveInventoryEstimatedSaleUnitPrice(inventory);
  if (
    requestedSaleAmount === undefined &&
    (saleUnitPrice == null || saleUnitPrice <= 0)
  ) {
    return groupApiError(
      res,
      400,
      "El servicio no tiene venta unitaria estimada para asignar.",
      {
        code: "GROUP_INVENTORY_SALE_PRICE_REQUIRED",
        solution: "Editá el servicio y cargá una venta unitaria estimada.",
      },
    );
  }
  const saleAmount = requestedSaleAmount ?? saleUnitPrice ?? 0;

  if (assignedPassengerIds.has(passenger.id_travel_group_passenger)) {
    return groupApiError(
      res,
      409,
      "Ese servicio ya está asignado al pasajero activo.",
      {
        code: "GROUP_INVENTORY_ALREADY_ASSIGNED",
        solution: "Seleccioná otro pasajero o revisá las cuotas existentes.",
      },
    );
  }

  const effectiveAssigned = Math.max(
    inventory.assigned_qty,
    assignedPassengerIds.size,
  );
  const availableQty = Math.max(
    inventory.total_qty - effectiveAssigned - inventory.blocked_qty,
    0,
  );
  if (availableQty <= 0) {
    return groupApiError(
      res,
      409,
      "No quedan cupos disponibles para asignar.",
      {
        code: "GROUP_INVENTORY_NO_AVAILABILITY",
        solution: "Aumentá cupos o liberá asignaciones antes de continuar.",
      },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const agencyPaymentId = await getNextAgencyCounter(
        tx,
        auth.id_agency,
        "travel_group_client_payment",
      );
      const created = await tx.travelGroupClientPayment.create({
        data: {
          agency_travel_group_client_payment_id: agencyPaymentId,
          id_agency: auth.id_agency,
          travel_group_id: group.id_travel_group,
          travel_group_departure_id: passenger.travel_group_departure_id,
          travel_group_passenger_id: passenger.id_travel_group_passenger,
          client_id: passengerClientId,
          concept: `Asignación: ${inventory.label}`.slice(0, 250),
          service_ref: serviceRef,
          amount: new Prisma.Decimal(saleAmount.toFixed(2)),
          currency:
            String(inventory.currency || "ARS")
              .trim()
              .toUpperCase() || "ARS",
          due_date: new Date(),
          status: "PENDIENTE",
        },
      });
      const updatedInventory = await tx.travelGroupInventory.update({
        where: {
          id_travel_group_inventory: inventory.id_travel_group_inventory,
        },
        data: {
          assigned_qty: assignedPassengerIds.size + 1,
        },
      });
      return { payment: created, inventory: updatedInventory };
    });

    return res.status(201).json({
      ok: true,
      payment_id: result.payment.id_travel_group_client_payment,
      assigned_qty: result.inventory.assigned_qty,
    });
  } catch (error) {
    console.error("[groups][inventories][assign]", error);
    return groupApiError(res, 500, "No pudimos asignar el servicio.", {
      code: "GROUP_INVENTORY_ASSIGN_ERROR",
      solution: "Reintentá en unos segundos.",
    });
  }
}
