// src/pages/api/services/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { Prisma } from "@prisma/client";
import { resolveAuth } from "@/lib/auth";
import { canAccessBookingByRole } from "@/lib/accessControl";
import { isBookingClosedStatus } from "@/lib/bookingStatus";
import { parseDateInputInBuenosAires } from "@/lib/buenosAiresDate";
import {
  getBookingLeaderScope,
  getBookingTeamScope,
  resolveBookingVisibilityMode,
} from "@/lib/bookingVisibility";

const PENDING_TOLERANCE = 0.01;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function parsePositiveInt(input: unknown): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function parseTake(input: unknown, fallback = 120, min = 1, max = 300): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function parseBool(input: unknown, fallback: boolean): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    const v = input.trim().toLowerCase();
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  }
  if (typeof input === "number") return input !== 0;
  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toDateInBuenosAires(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return parseDateInputInBuenosAires(value);
}

type PendingServiceLite = {
  id_service: number;
  agency_service_id: number | null;
  booking_id: number;
  id_operator: number;
  currency: string;
  cost_price: number | null;
  type: string;
  destination: string;
  description: string;
  booking: {
    id_booking: number;
    agency_booking_id: number | null;
    details: string;
    id_user: number;
    id_agency: number;
    titular: { first_name: string; last_name: string } | null;
  } | null;
  operator: { id_operator: number; name: string } | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    const { bookingId, ids, operatorId, q, take, pendingOnly } = req.query;

    const idsParam = Array.isArray(ids) ? ids[0] : ids;
    if (idsParam) {
      const parsed = idsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.trunc(n));
      const uniqueIds = Array.from(new Set(parsed));
      if (uniqueIds.length === 0) {
        return res.status(400).json({ error: "ids inválidos" });
      }

      try {
        const auth = await resolveAuth(req);
        if (!auth) return res.status(401).json({ error: "Unauthorized" });

        const services = await prisma.service.findMany({
          where: { id_service: { in: uniqueIds }, id_agency: auth.id_agency },
          select: {
            id_service: true,
            agency_service_id: true,
            booking_id: true,
            id_operator: true,
            currency: true,
            cost_price: true,
            type: true,
            destination: true,
            booking: {
              select: {
                id_booking: true,
                agency_booking_id: true,
                id_agency: true,
                id_user: true,
              },
            },
            operator: {
              select: { id_operator: true, name: true },
            },
          },
        });

        for (const svc of services) {
          const booking = svc.booking;
          if (
            !booking ||
            !(await canAccessBookingByRole(auth, {
              id_user: booking.id_user,
              id_agency: booking.id_agency,
            }))
          ) {
            return res.status(403).json({ error: "No autorizado." });
          }
        }

        return res.status(200).json({ services, total: services.length });
      } catch (error) {
        console.error("Error al obtener servicios por ids:", error);
        return res
          .status(500)
          .json({ error: "Error al obtener servicios." });
      }
    }

    const operatorIdParam = Array.isArray(operatorId)
      ? operatorId[0]
      : operatorId;
    const parsedOperatorId = parsePositiveInt(operatorIdParam);
    if (parsedOperatorId && !bookingId) {
      try {
        const auth = await resolveAuth(req);
        if (!auth) return res.status(401).json({ error: "Unauthorized" });

        const mode = await resolveBookingVisibilityMode({
          id_agency: auth.id_agency,
          role: auth.role,
        });
        let allowedUserIds: number[] | null = null;
        if (mode === "own") {
          allowedUserIds = [auth.id_user];
        } else if (mode === "team") {
          const scope =
            auth.role === "lider"
              ? await getBookingLeaderScope(auth.id_user, auth.id_agency)
              : await getBookingTeamScope(auth.id_user, auth.id_agency);
          allowedUserIds = scope.userIds.length ? scope.userIds : [auth.id_user];
        }

        const qValue = typeof q === "string" ? q.trim() : "";
        const qNum = parsePositiveInt(qValue);
        const serviceTake = parseTake(
          Array.isArray(take) ? take[0] : take,
          120,
          1,
          300,
        );
        const pendingOnlyFlag = parseBool(
          Array.isArray(pendingOnly) ? pendingOnly[0] : pendingOnly,
          true,
        );

        const where: Prisma.ServiceWhereInput = {
          id_agency: auth.id_agency,
          id_operator: parsedOperatorId,
          booking: {
            id_agency: auth.id_agency,
            ...(allowedUserIds ? { id_user: { in: allowedUserIds } } : {}),
          },
        };

        const andFilters: Prisma.ServiceWhereInput[] = [];
        if (qValue) {
          const orFilters: Prisma.ServiceWhereInput[] = [
            { type: { contains: qValue, mode: "insensitive" } },
            { destination: { contains: qValue, mode: "insensitive" } },
            { description: { contains: qValue, mode: "insensitive" } },
            { booking: { is: { details: { contains: qValue, mode: "insensitive" } } } },
            {
              booking: {
                is: { titular: { first_name: { contains: qValue, mode: "insensitive" } } },
              },
            },
            {
              booking: {
                is: { titular: { last_name: { contains: qValue, mode: "insensitive" } } },
              },
            },
          ];
          if (qNum) {
            orFilters.push(
              { id_service: qNum },
              { agency_service_id: qNum },
              { booking_id: qNum },
              { booking: { is: { agency_booking_id: qNum } } },
            );
          }
          andFilters.push({ OR: orFilters });
        }
        if (andFilters.length > 0) where.AND = andFilters;

        const services = await prisma.service.findMany({
          where,
          take: serviceTake,
          orderBy: [{ booking_id: "desc" }, { id_service: "desc" }],
          select: {
            id_service: true,
            agency_service_id: true,
            booking_id: true,
            id_operator: true,
            currency: true,
            cost_price: true,
            type: true,
            destination: true,
            description: true,
            booking: {
              select: {
                id_booking: true,
                agency_booking_id: true,
                details: true,
                id_user: true,
                id_agency: true,
                titular: {
                  select: { first_name: true, last_name: true },
                },
              },
            },
            operator: {
              select: { id_operator: true, name: true },
            },
          },
        });

        const serviceIds = services.map((s) => s.id_service);
        if (serviceIds.length === 0) {
          return res.status(200).json({ services: [], total: 0 });
        }

        const paidByService = new Map<number, number>();
        const addPaid = (serviceId: number, amount: number) => {
          paidByService.set(
            serviceId,
            round2((paidByService.get(serviceId) || 0) + amount),
          );
        };

        const allocationSums = await prisma.investmentServiceAllocation.groupBy({
          by: ["service_id"],
          where: {
            service_id: { in: serviceIds },
            investment: {
              id_agency: auth.id_agency,
              operator_id: parsedOperatorId,
            },
          },
          _sum: { amount_service: true },
        });

        allocationSums.forEach((row) => {
          addPaid(row.service_id, Number(row._sum.amount_service || 0));
        });

        const legacyInvestments = await prisma.investment.findMany({
          where: {
            id_agency: auth.id_agency,
            operator_id: parsedOperatorId,
            serviceIds: { hasSome: serviceIds },
            allocations: { none: {} },
          },
          select: {
            id_investment: true,
            amount: true,
            currency: true,
            serviceIds: true,
          },
        });

        const allLegacyServiceIds = Array.from(
          new Set(
            legacyInvestments.flatMap((inv) =>
              (inv.serviceIds || [])
                .map((sid) => Number(sid))
                .filter((sid) => Number.isFinite(sid) && sid > 0),
            ),
          ),
        );

        const legacyServices =
          allLegacyServiceIds.length > 0
            ? await prisma.service.findMany({
                where: {
                  id_service: { in: allLegacyServiceIds },
                  id_agency: auth.id_agency,
                  id_operator: parsedOperatorId,
                },
                select: {
                  id_service: true,
                  currency: true,
                  cost_price: true,
                },
              })
            : [];
        const legacyServiceMap = new Map(
          legacyServices.map((svc) => [svc.id_service, svc]),
        );
        const requestedServiceIdSet = new Set(serviceIds);

        for (const inv of legacyInvestments) {
          const invAmount = Number(inv.amount || 0);
          const invCurrency = String(inv.currency || "").toUpperCase();
          const invServiceIds = Array.from(
            new Set(
              (inv.serviceIds || [])
                .map((sid) => Number(sid))
                .filter((sid) => Number.isFinite(sid) && sid > 0),
            ),
          );
          if (invServiceIds.length === 0) continue;

          const eligibleIds = invServiceIds.filter((sid) =>
            legacyServiceMap.has(sid),
          );
          if (eligibleIds.length === 0) continue;

          const sameCurrency = eligibleIds.every((sid) => {
            const svc = legacyServiceMap.get(sid);
            return (svc?.currency || "").toUpperCase() === invCurrency;
          });
          if (!sameCurrency) continue;

          const weights = eligibleIds.map((sid) =>
            Math.max(Number(legacyServiceMap.get(sid)?.cost_price || 0), 0),
          );
          const totalWeight = weights.reduce((sum, w) => sum + w, 0);

          let remaining = round2(invAmount);
          eligibleIds.forEach((sid, idx) => {
            const isLast = idx === eligibleIds.length - 1;
            const ratio =
              totalWeight > 0 ? weights[idx] / totalWeight : 1 / eligibleIds.length;
            const allocated = isLast
              ? remaining
              : round2(invAmount * ratio);
            if (!isLast) remaining = round2(remaining - allocated);
            if (requestedServiceIdSet.has(sid)) addPaid(sid, allocated);
          });
        }

        const responseServices = (services as PendingServiceLite[])
          .map((svc) => {
            const cost = round2(Number(svc.cost_price || 0));
            const paid = round2(Number(paidByService.get(svc.id_service) || 0));
            const pending = round2(Math.max(cost - paid, 0));
            return {
              ...svc,
              paid_amount: paid,
              pending_amount: pending,
              overpaid_amount: round2(Math.max(paid - cost, 0)),
            };
          })
          .filter((svc) =>
            pendingOnlyFlag ? svc.pending_amount > PENDING_TOLERANCE : true,
          );

        return res
          .status(200)
          .json({ services: responseServices, total: responseServices.length });
      } catch (error) {
        console.error("Error al obtener servicios pendientes por operador:", error);
        return res
          .status(500)
          .json({ error: "Error al obtener servicios." });
      }
    }

    if (!bookingId || Array.isArray(bookingId)) {
      return res.status(400).json({ error: "N° de reserva inválido" });
    }

    try {
      const auth = await resolveAuth(req);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const booking = await prisma.booking.findUnique({
        where: { id_booking: Number(bookingId) },
        select: { id_booking: true, id_agency: true, id_user: true },
      });
      if (!booking || booking.id_agency !== auth.id_agency) {
        return res.status(404).json({ error: "Reserva no encontrada." });
      }
      const allowed = await canAccessBookingByRole(auth, booking);
      if (!allowed) {
        return res.status(403).json({ error: "No autorizado." });
      }

      const services = await prisma.service.findMany({
        where: { booking_id: Number(bookingId), id_agency: auth.id_agency },
        orderBy: { id_service: "asc" }, // opcional, para que siempre vengan ordenados
        include: { booking: true, operator: true },
      });

      return res.status(200).json({ services, total: services.length });
    } catch (error) {
      console.error("Error al obtener servicios:", error);
      return res.status(500).json({ error: "Error al obtener servicios." });
    }
  } else if (req.method === "POST") {
    // 👇 tu código POST queda igual
    const auth = await resolveAuth(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const {
      type,
      description,
      note,
      sale_price,
      cost_price,
      destination,
      reference,
      tax_21,
      tax_105,
      exempt,
      other_taxes,
      currency,
      departure_date,
      return_date,
      id_operator,
      booking_id,
      nonComputable,
      taxableBase21,
      taxableBase10_5,
      commissionExempt,
      commission21,
      commission10_5,
      vatOnCommission21,
      vatOnCommission10_5,
      totalCommissionWithoutVAT,
      impIVA,
      card_interest,
      card_interest_21,
      taxableCardInterest,
      vatOnCardInterest,
      transfer_fee_pct,
      transfer_fee_amount,
      billing_override,
      extra_costs_amount,
      extra_taxes_amount,
      extra_adjustments,
    } = req.body;

    const parsedOperatorId = Number(id_operator);
    const parsedBookingId = Number(booking_id);
    const missingFields: string[] = [];

    if (!type || !String(type).trim()) missingFields.push("tipo");
    if (sale_price === undefined || sale_price === null || sale_price === "") {
      missingFields.push("precio de venta");
    }
    if (cost_price === undefined || cost_price === null || cost_price === "") {
      missingFields.push("precio de costo");
    }
    if (!currency || !String(currency).trim()) missingFields.push("moneda");
    if (!Number.isFinite(parsedOperatorId) || parsedOperatorId <= 0) {
      missingFields.push("operador");
    }
    if (!Number.isFinite(parsedBookingId) || parsedBookingId <= 0) {
      missingFields.push("N° de reserva");
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Faltan campos obligatorios: ${missingFields.join(", ")}.`,
      });
    }

    const salePriceNum = toNullableNumber(sale_price);
    const costPriceNum = toNullableNumber(cost_price);
    if (salePriceNum == null || costPriceNum == null) {
      return res.status(400).json({
        error: "Precios inválidos.",
      });
    }

    const parsedDepartureDate = toDateInBuenosAires(departure_date);
    const parsedReturnDate = toDateInBuenosAires(return_date);
    if (!parsedDepartureDate || !parsedReturnDate) {
      return res.status(400).json({
        error: "Fechas inválidas.",
      });
    }

    const bookingExists = await prisma.booking.findUnique({
      where: { id_booking: parsedBookingId },
      select: { id_booking: true, id_agency: true, id_user: true, status: true },
    });
    if (!bookingExists || bookingExists.id_agency !== auth.id_agency) {
      return res.status(404).json({ error: "Reserva no encontrada." });
    }
    if (isBookingClosedStatus(bookingExists.status)) {
      return res.status(409).json({
        error: "No se pueden cargar servicios en una reserva bloqueada o cancelada.",
      });
    }
    const canAccess = await canAccessBookingByRole(auth, bookingExists);
    if (!canAccess) {
      return res.status(403).json({ error: "No autorizado." });
    }

    const operatorExists = await prisma.operator.findUnique({
      where: { id_operator: parsedOperatorId },
      select: { id_operator: true, id_agency: true },
    });
    if (!operatorExists || operatorExists.id_agency !== auth.id_agency) {
      return res.status(404).json({ error: "Operador no encontrado." });
    }

    try {
      const service = await prisma.$transaction(async (tx) => {
        const agencyServiceId = await getNextAgencyCounter(
          tx,
          bookingExists.id_agency,
          "service",
        );

        return tx.service.create({
          data: {
            agency_service_id: agencyServiceId,
            type,
            description: description || null,
            note: note || null,
            sale_price: salePriceNum,
            cost_price: costPriceNum,
            destination: destination || "",
            reference: reference || "",
            tax_21: toNullableNumber(tax_21),
            tax_105: toNullableNumber(tax_105),
            exempt: toNullableNumber(exempt),
            other_taxes: toNullableNumber(other_taxes),
            currency,
            departure_date: parsedDepartureDate,
            return_date: parsedReturnDate,
            booking: { connect: { id_booking: parsedBookingId } },
            agency: { connect: { id_agency: bookingExists.id_agency } },
            operator: { connect: { id_operator: parsedOperatorId } },
            nonComputable: toNullableNumber(nonComputable),
            taxableBase21: toNullableNumber(taxableBase21),
            taxableBase10_5: toNullableNumber(taxableBase10_5),
            commissionExempt: toNullableNumber(commissionExempt),
            commission21: toNullableNumber(commission21),
            commission10_5: toNullableNumber(commission10_5),
            vatOnCommission21: toNullableNumber(vatOnCommission21),
            vatOnCommission10_5: toNullableNumber(vatOnCommission10_5),
            totalCommissionWithoutVAT: toNullableNumber(totalCommissionWithoutVAT),
            impIVA: toNullableNumber(impIVA),
            card_interest: toNullableNumber(card_interest),
            card_interest_21: toNullableNumber(card_interest_21),
            taxableCardInterest: toNullableNumber(taxableCardInterest),
            vatOnCardInterest: toNullableNumber(vatOnCardInterest),
            transfer_fee_pct: toNullableNumber(transfer_fee_pct),
            transfer_fee_amount: toNullableNumber(transfer_fee_amount),
            billing_override:
              billing_override == null ? Prisma.DbNull : billing_override,
            extra_costs_amount: toNullableNumber(extra_costs_amount),
            extra_taxes_amount: toNullableNumber(extra_taxes_amount),
            extra_adjustments: extra_adjustments ?? null,
          },
          include: { booking: true, operator: true },
        });
      });

      return res.status(201).json(service);
    } catch (error) {
      console.error("Error al crear servicio:", error);
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          return res.status(400).json({
            error: "Datos duplicados detectados en la base de datos.",
          });
        }
      }
      return res.status(500).json({ error: "Error al crear servicio." });
    }
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Método ${req.method} no permitido.`);
  }
}
