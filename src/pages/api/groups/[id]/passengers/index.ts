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
import { resolveInventoryEstimatedSaleUnitPrice } from "@/lib/groups/inventoryServiceRefs";
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

    const bookingIds = Array.from(
      new Set(
        passengers
          .map((item) =>
            Number((item as { booking_id?: unknown }).booking_id ?? 0),
          )
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.trunc(value)),
      ),
    );
    const bookingPassengerCount = new Map<number, number>();
    for (const bookingId of passengers
      .map((item) => Number((item as { booking_id?: unknown }).booking_id ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value))) {
      bookingPassengerCount.set(
        bookingId,
        (bookingPassengerCount.get(bookingId) ?? 0) + 1,
      );
    }

    const serviceTotalsByBookingId = new Map<number, Record<string, number>>();
    if (bookingIds.length > 0) {
      const serviceRows = await prisma.service.findMany({
        where: {
          id_agency: auth.id_agency,
          booking_id: { in: bookingIds },
        },
        select: {
          booking_id: true,
          currency: true,
          sale_price: true,
          card_interest: true,
          taxableCardInterest: true,
          vatOnCardInterest: true,
        },
      });

      for (const row of serviceRows) {
        const bookingId = Number(row.booking_id || 0);
        if (!Number.isFinite(bookingId) || bookingId <= 0) continue;
        const currency =
          String(row.currency || "ARS")
            .trim()
            .toUpperCase() || "ARS";
        const sale = Number(row.sale_price || 0);
        const splitInterest =
          Number(row.taxableCardInterest || 0) +
          Number(row.vatOnCardInterest || 0);
        const interest =
          splitInterest > 0 ? splitInterest : Number(row.card_interest || 0);
        const total = Math.max(0, sale + Math.max(0, interest));
        if (total <= 0) continue;

        const current = serviceTotalsByBookingId.get(bookingId) || {};
        addCurrencyTotal(current, currency, total);
        serviceTotalsByBookingId.set(bookingId, current);
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
        travel_group_departure_id: true,
        currency: true,
        unit_cost: true,
        total_qty: true,
        note: true,
      },
    });
    const inventoryTotalsByDepartureId = new Map<
      number | null,
      Record<string, number>
    >();
    for (const row of inventoryRows) {
      const saleUnitPrice = resolveInventoryEstimatedSaleUnitPrice(row) ?? 0;
      if (saleUnitPrice <= 0) continue;
      const departureId = row.travel_group_departure_id ?? null;
      const current = inventoryTotalsByDepartureId.get(departureId) || {};
      addCurrencyTotal(current, row.currency, saleUnitPrice);
      inventoryTotalsByDepartureId.set(departureId, current);
    }
    const inventoryTotalsForPassenger = (
      departureId: number | null,
    ): Record<string, number> | null => {
      const totals: Record<string, number> = {};
      const globalTotals = inventoryTotalsByDepartureId.get(null);
      if (globalTotals) {
        for (const [currency, amount] of Object.entries(globalTotals)) {
          addCurrencyTotal(totals, currency, amount);
        }
      }
      if (departureId != null) {
        const scopedTotals = inventoryTotalsByDepartureId.get(departureId);
        if (scopedTotals) {
          for (const [currency, amount] of Object.entries(scopedTotals)) {
            addCurrencyTotal(totals, currency, amount);
          }
        }
      }
      return hasDetectableTotals(totals) ? totals : null;
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
        const bookingId = Number(
          (item as { booking_id?: unknown }).booking_id ?? 0,
        );
        const normalizedBookingId =
          Number.isFinite(bookingId) && bookingId > 0
            ? Math.trunc(bookingId)
            : 0;
        const isUnambiguousBooking =
          normalizedBookingId > 0 &&
          (bookingPassengerCount.get(normalizedBookingId) ?? 0) === 1;
        const servicesByCurrency = isUnambiguousBooking
          ? (serviceTotalsByBookingId.get(normalizedBookingId) ?? null)
          : null;
        const inventoryServicesByCurrency = inventoryTotalsForPassenger(
          item.travel_group_departure_id ?? null,
        );

        return {
          ...item,
          departure_public_id: item.travelGroupDeparture
            ? getDeparturePublicId(item.travelGroupDeparture)
            : null,
          pending_payment: computePassengerPendingValue({
            servicesByCurrency:
              inventoryServicesByCurrency ?? servicesByCurrency,
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
