import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import {
  parseDepartureWhereInput,
  getDeparturePublicId,
  parseGroupWhereInput,
  requireAuth,
} from "@/lib/groups/apiShared";
import { groupApiError } from "@/lib/groups/apiErrors";
import { addGroupReceiptToPaidByCurrency } from "@/lib/groups/groupReceiptDebtValidation";
import {
  decodeInventoryServiceId,
  resolveInventoryEstimatedSaleUnitPrice,
} from "@/lib/groups/inventoryServiceRefs";
import { readGroupReceiptPaymentsFromMetadata } from "@/lib/groups/groupReceiptMetadata";
import { computePassengerPendingValue } from "@/lib/groups/passengerPending";

function pickParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

const addCurrencyTotal = (
  target: Record<string, number>,
  currencyRaw: string | null | undefined,
  amountRaw: number,
) => {
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const currency =
    String(currencyRaw || "ARS")
      .trim()
      .toUpperCase() || "ARS";
  target[currency] = Math.round(((target[currency] || 0) + amount) * 100) / 100;
};

const hasDetectableTotals = (
  totals: Record<string, number> | null | undefined,
) =>
  Boolean(
    totals && Object.values(totals).some((value) => Number(value) > 0.01),
  );

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return groupApiError(res, 405, "Método no permitido para esta ruta.", {
      code: "METHOD_NOT_ALLOWED",
      details: `Método recibido: ${req.method ?? "desconocido"}.`,
      solution: "Usá una solicitud GET para consultar pasajeros.",
    });
  }

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
      name: true,
      status: true,
    },
  });
  if (!group) {
    return groupApiError(res, 404, "No encontramos la grupal solicitada.", {
      code: "GROUP_NOT_FOUND",
      solution: "Revisá que exista y pertenezca a tu agencia.",
    });
  }

  const departureFilterRaw = pickParam(req.query.departureId);
  let departureFilterId: number | null = null;

  if (departureFilterRaw) {
    const departureWhere = parseDepartureWhereInput(
      departureFilterRaw,
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

    departureFilterId = departure.id_travel_group_departure;
  }

  try {
    const passengers = await prisma.travelGroupPassenger.findMany({
      where: {
        id_agency: auth.id_agency,
        travel_group_id: group.id_travel_group,
        ...(departureFilterId
          ? { travel_group_departure_id: departureFilterId }
          : {}),
      },
      include: {
        client: {
          select: {
            id_client: true,
            agency_client_id: true,
            first_name: true,
            last_name: true,
            dni_number: true,
            passport_number: true,
            phone: true,
            email: true,
          },
        },
        travelGroupDeparture: {
          select: {
            id_travel_group_departure: true,
            agency_travel_group_departure_id: true,
            id_agency: true,
            name: true,
            status: true,
            departure_date: true,
            return_date: true,
            capacity_total: true,
          },
        },
      },
      orderBy: [
        { waitlist_position: "asc" },
        { created_at: "asc" },
        { id_travel_group_passenger: "asc" },
      ],
    });

    const passengerScopeIds = passengers
      .map((item) => item.id_travel_group_passenger)
      .filter((id) => Number.isFinite(id) && id > 0);

    const pendingByPassengerId = new Map<
      number,
      { amount: string; count: number }
    >();
    if (passengerScopeIds.length > 0) {
      try {
        const pendingAgg = await prisma.travelGroupClientPayment.groupBy({
          by: ["travel_group_passenger_id"],
          where: {
            id_agency: auth.id_agency,
            travel_group_id: group.id_travel_group,
            travel_group_passenger_id: { in: passengerScopeIds },
            status: "PENDIENTE",
          },
          _sum: { amount: true },
          _count: { _all: true },
        });
        for (const row of pendingAgg) {
          pendingByPassengerId.set(row.travel_group_passenger_id, {
            amount: row._sum.amount?.toString() ?? "0",
            count: row._count._all ?? 0,
          });
        }
      } catch (error) {
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === "P2021" || error.code === "P2022")
          )
        ) {
          throw error;
        }
      }
    }

    const inventoryRows = await prisma.travelGroupInventory.findMany({
      where: {
        id_agency: auth.id_agency,
        travel_group_id: group.id_travel_group,
        ...(departureFilterId
          ? {
              OR: [
                { travel_group_departure_id: null },
                { travel_group_departure_id: departureFilterId },
              ],
            }
          : {}),
      },
      select: {
        id_travel_group_inventory: true,
        travel_group_departure_id: true,
        currency: true,
        unit_cost: true,
        total_qty: true,
        note: true,
      },
    });
    const inventorySaleById = new Map<
      number,
      { currency: string | null; amount: number }
    >();
    for (const row of inventoryRows) {
      const saleUnitPrice = resolveInventoryEstimatedSaleUnitPrice(row) ?? 0;
      inventorySaleById.set(row.id_travel_group_inventory, {
        currency: row.currency,
        amount: Math.max(0, saleUnitPrice),
      });
    }

    const assignedInventoryIdsByPassengerId = new Map<number, Set<number>>();
    const assignedInventoryTotalsByPassengerId = new Map<
      number,
      Record<string, number>
    >();
    const assignedInventorySalesByPassengerId = new Map<
      number,
      Array<{ inventory_id: number; amount: number; currency: string }>
    >();
    if (passengerScopeIds.length > 0) {
      const assignmentRows = await prisma.travelGroupClientPayment.findMany({
        where: {
          id_agency: auth.id_agency,
          travel_group_id: group.id_travel_group,
          travel_group_passenger_id: { in: passengerScopeIds },
          service_ref: { not: null },
          status: { not: "CANCELADA" },
        },
        select: {
          travel_group_passenger_id: true,
          service_ref: true,
          amount: true,
          currency: true,
        },
      });
      for (const row of assignmentRows) {
        const inventoryId = decodeInventoryServiceId(Number(row.service_ref));
        if (!inventoryId || !inventorySaleById.has(inventoryId)) continue;

        const assignedSet =
          assignedInventoryIdsByPassengerId.get(
            row.travel_group_passenger_id,
          ) ?? new Set<number>();
        if (assignedSet.has(inventoryId)) continue;
        assignedSet.add(inventoryId);
        assignedInventoryIdsByPassengerId.set(
          row.travel_group_passenger_id,
          assignedSet,
        );

        const sale = inventorySaleById.get(inventoryId);
        if (!sale) continue;
        const assignmentAmount = Number(row.amount);
        const amount =
          Number.isFinite(assignmentAmount) && assignmentAmount >= 0
            ? assignmentAmount
            : sale.amount;
        const currency =
          String(row.currency || sale.currency || "ARS")
            .trim()
            .toUpperCase() || "ARS";
        const current =
          assignedInventoryTotalsByPassengerId.get(
            row.travel_group_passenger_id,
          ) || {};
        addCurrencyTotal(current, currency, amount);
        assignedInventoryTotalsByPassengerId.set(
          row.travel_group_passenger_id,
          current,
        );
        const saleRows =
          assignedInventorySalesByPassengerId.get(
            row.travel_group_passenger_id,
          ) ?? [];
        saleRows.push({
          inventory_id: inventoryId,
          amount,
          currency,
        });
        assignedInventorySalesByPassengerId.set(
          row.travel_group_passenger_id,
          saleRows,
        );
      }
    }
    const inventoryTotalsForPassenger = (
      passengerId: number,
    ): Record<string, number> | null => {
      const totals = assignedInventoryTotalsByPassengerId.get(passengerId);
      return hasDetectableTotals(totals) ? (totals ?? null) : null;
    };
    const assignedInventoryIdsForPassenger = (
      passengerId: number,
    ): number[] => {
      const assignedSet = assignedInventoryIdsByPassengerId.get(passengerId);
      if (!assignedSet) return [];
      return Array.from(assignedSet).sort((a, b) => a - b);
    };
    const assignedInventorySalesForPassenger = (
      passengerId: number,
    ): Array<{ inventory_id: number; amount: number; currency: string }> => {
      return (
        assignedInventorySalesByPassengerId.get(passengerId)?.sort((a, b) => {
          return a.inventory_id - b.inventory_id;
        }) ?? []
      );
    };

    const receiptsByPassengerId = new Map<number, Record<string, number>>();
    if (passengerScopeIds.length > 0) {
      const receiptRows = await prisma.travelGroupReceipt.findMany({
        where: {
          id_agency: auth.id_agency,
          travel_group_id: group.id_travel_group,
          travel_group_passenger_id: { in: passengerScopeIds },
        },
        select: {
          travel_group_passenger_id: true,
          amount: true,
          amount_currency: true,
          payment_fee_amount: true,
          base_amount: true,
          base_currency: true,
          metadata: true,
        },
      });

      for (const receipt of receiptRows) {
        const passengerId = receipt.travel_group_passenger_id;
        const current = receiptsByPassengerId.get(passengerId) || {};
        addGroupReceiptToPaidByCurrency(current, {
          service_refs: null,
          amount: receipt.amount,
          amount_currency: receipt.amount_currency,
          payment_fee_amount: receipt.payment_fee_amount,
          base_amount: receipt.base_amount,
          base_currency: receipt.base_currency,
          payments: readGroupReceiptPaymentsFromMetadata(receipt.metadata),
        });
        receiptsByPassengerId.set(passengerId, current);
      }
    }

    return res.status(200).json({
      group,
      items: passengers.map((item) => {
        const inventoryServicesByCurrency = inventoryTotalsForPassenger(
          item.id_travel_group_passenger,
        );

        return {
          ...item,
          assigned_inventory_ids: assignedInventoryIdsForPassenger(
            item.id_travel_group_passenger,
          ),
          assigned_inventory_sales: assignedInventorySalesForPassenger(
            item.id_travel_group_passenger,
          ),
          departure_public_id: item.travelGroupDeparture
            ? getDeparturePublicId(item.travelGroupDeparture)
            : null,
          pending_payment: computePassengerPendingValue({
            servicesByCurrency: inventoryServicesByCurrency,
            receiptsByCurrency:
              receiptsByPassengerId.get(item.id_travel_group_passenger) ?? null,
            installmentsFallback: pendingByPassengerId.get(
              item.id_travel_group_passenger,
            ) ?? {
              amount: "0",
              count: 0,
            },
          }),
        };
      }),
    });
  } catch (error) {
    console.error("[groups][passengers][GET]", error);
    return groupApiError(
      res,
      500,
      "No pudimos listar los pasajeros de la grupal.",
      {
        code: "GROUP_PASSENGER_LIST_ERROR",
        solution: "Reintentá en unos segundos.",
      },
    );
  }
}
