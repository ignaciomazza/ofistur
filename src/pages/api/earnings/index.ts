// src/pages/api/earnings/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { computeBillingAdjustments } from "@/utils/billingAdjustments";
import { getGrossIncomeTaxAmountFromBillingOverride } from "@/utils/billingOverride";
import type { BillingAdjustmentConfig } from "@/types";
import type { CommissionRule } from "@/types/commission";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import {
  normalizeCommissionOverridesLenient,
  pruneOverridesByLeaderIds,
  resolveCommissionForContext,
  sanitizeCommissionOverrides,
} from "@/utils/commissionOverrides";
import {
  addDaysToDateKey,
  startOfDayUtcFromDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";

interface EarningItem {
  currency: string;
  userId: number; // dueño de la reserva (seller)
  userName: string;
  teamId: number;
  teamName: string;
  totalSellerComm: number;
  totalLeaderComm: number; // <-- todos los Lideres de equipo distintos del dueño
  totalAgencyShare: number;
  debt: number;
  bookingIds: number[];
  bookingRefs: Array<{ bookingId: number; agencyBookingId: number | null }>;
}
interface EarningBookingServiceDetail {
  idService: number;
  agencyServiceId: number | null;
  bookingId: number;
  agencyBookingId: number | null;
  currency: string;
  type: string;
  description: string;
  destination: string;
  sale: number;
  paid: number;
  pending: number;
  sellerCommission: number;
  leaderCommission: number;
  agencyCommission: number;
}
interface EarningBookingDetail {
  bookingId: number;
  agencyBookingId: number | null;
  creationDate: string | null;
  services: EarningBookingServiceDetail[];
}
interface EarningsResponse {
  totals: {
    sellerComm: Record<string, number>;
    leaderComm: Record<string, number>;
    agencyShare: Record<string, number>;
  };
  statsByCurrency: Record<
    string,
    {
      saleTotal: number;
      paidTotal: number;
      debtTotal: number;
      commissionTotal: number;
      paymentRate: number;
    }
  >;
  breakdowns: {
    byCountry: Record<string, Record<string, number>>;
    byMethod: Record<string, Record<string, number>>;
  };
  items: EarningItem[];
  bookingDetails: EarningBookingDetail[];
}

// ===== Auth (para agencia) =====
type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  role?: string;
};
const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

function normalizeSaleTotals(
  input: unknown,
  allowed?: Set<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const obj = input as Record<string, unknown>;
  for (const [keyRaw, val] of Object.entries(obj)) {
    const key = String(keyRaw || "").trim().toUpperCase();
    if (!key) continue;
    if (allowed && allowed.size > 0 && !allowed.has(key)) continue;
    const n =
      typeof val === "number"
        ? val
        : Number(String(val).replace(",", "."));
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
}

async function getAuth(
  req: NextApiRequest,
): Promise<{ id_agency: number; id_user: number; role: string } | null> {
  try {
    const cookieTok = req.cookies?.token;
    let token = cookieTok && typeof cookieTok === "string" ? cookieTok : null;
    if (!token) {
      const auth = req.headers.authorization || "";
      if (auth.startsWith("Bearer ")) token = auth.slice(7);
    }
    if (!token) return null;
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;
    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || 0;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || 0;
    const role = String(p.role || "");
    if (!id_user || !id_agency) return null;
    return { id_agency, id_user, role };
  } catch {
    return null;
  }
}

function parseCsvParam(input: string | string[] | undefined): string[] | null {
  if (typeof input === "string") {
    const items = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length ? items : null;
  }
  if (Array.isArray(input)) {
    const items = input.map((s) => String(s).trim()).filter(Boolean);
    return items.length ? items : null;
  }
  return null;
}

function parsePaidPct(input: string | string[] | undefined): number {
  const raw =
    typeof input === "string"
      ? Number(input)
      : Array.isArray(input)
        ? Number(input[0])
        : NaN;
  if (!Number.isFinite(raw)) return 0.4;
  if (raw <= 1) return Math.max(0, raw);
  return Math.max(0, raw / 100);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_TOLERANCE = 0.01;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function isDateKeyWithinRange(
  key: string | null | undefined,
  fromKey: string,
  toKey: string,
): boolean {
  return !!key && key >= fromKey && key <= toKey;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<EarningsResponse | { error: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const auth = await getAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  const planAccess = await ensurePlanFeatureAccess(
    auth.id_agency,
    "earnings",
  );
  if (!planAccess.allowed) {
    return res.status(403).json({ error: "Plan insuficiente" });
  }

  const financeGrants = await getFinanceSectionGrants(
    auth.id_agency,
    auth.id_user,
  );
  const canEarnings = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "earnings",
  );
  if (!canEarnings) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const {
    from,
    to,
    dateField,
    minPaidPct,
    clientStatus,
    operatorStatus,
    paymentMethodId,
    accountId,
    teamId,
  } = req.query;
  if (typeof from !== "string" || typeof to !== "string") {
    return res.status(400).json({ error: "Parámetros from y to requeridos" });
  }

  const fromDate = startOfDayUtcFromDateKeyInBuenosAires(from);
  const toPlusOne = addDaysToDateKey(to, 1);
  const toDateExclusive = toPlusOne
    ? startOfDayUtcFromDateKeyInBuenosAires(toPlusOne)
    : null;
  if (!fromDate || !toDateExclusive) {
    return res.status(400).json({ error: "Parámetros from/to inválidos" });
  }
  const paidPct = parsePaidPct(minPaidPct);
  const clientStatusArr = parseCsvParam(clientStatus)?.filter(
    (s) => s !== "Todas",
  );
  const operatorStatusArr = parseCsvParam(operatorStatus)?.filter(
    (s) => s !== "Todas",
  );
  const parsedPaymentMethodId = Number(
    Array.isArray(paymentMethodId) ? paymentMethodId[0] : paymentMethodId,
  );
  const parsedAccountId = Number(
    Array.isArray(accountId) ? accountId[0] : accountId,
  );
  const parsedTeamId = Number(Array.isArray(teamId) ? teamId[0] : teamId);
  const dateFieldKey =
    String(dateField || "").toLowerCase() === "departure" ||
    String(dateField || "").toLowerCase() === "travel" ||
    String(dateField || "").toLowerCase() === "viaje"
      ? "departure_date"
      : "creation_date";

  try {
    const agency = await prisma.agency.findUnique({
      where: { id_agency: auth.id_agency },
      select: { transfer_fee_pct: true },
    });
    const agencyFeePct =
      agency?.transfer_fee_pct != null ? Number(agency.transfer_fee_pct) : 0.024;
    const calcConfig = await prisma.serviceCalcConfig.findUnique({
      where: { id_agency: auth.id_agency },
      select: { use_booking_sale_total: true, billing_adjustments: true },
    });
    const inheritedUseBookingSaleTotal = Boolean(
      calcConfig?.use_booking_sale_total,
    );
    const billingAdjustments = Array.isArray(calcConfig?.billing_adjustments)
      ? (calcConfig?.billing_adjustments as BillingAdjustmentConfig[])
      : [];

    const currencyRows = await prisma.financeCurrency.findMany({
      where: { id_agency: auth.id_agency, enabled: true },
      select: { code: true },
    });
    const enabledCurrencies = new Set(
      currencyRows
        .map((c) => String(c.code || "").trim().toUpperCase())
        .filter(Boolean),
    );
    const hasCurrencyFilter = enabledCurrencies.size > 0;

    // 1) Equipos/usuarios de MI agencia (para etiquetar por equipo)
    const teams = await prisma.salesTeam.findMany({
      where: { id_agency: auth.id_agency },
      include: { user_teams: { include: { user: true } } },
    });
    const teamMap = new Map<number, { name: string; members: number[] }>();
    const userToMemberTeams = new Map<number, number[]>();
    teams.forEach(({ id_team, name, user_teams }) => {
      const members = user_teams.map((ut) => ut.user.id_user);
      teamMap.set(id_team, { name, members });
      members.forEach((uid) => {
        userToMemberTeams.set(uid, [
          ...(userToMemberTeams.get(uid) || []),
          id_team,
        ]);
      });
    });

    const expandedFrom = new Date(fromDate.getTime() - ONE_DAY_MS);
    const expandedToExclusive = new Date(toDateExclusive.getTime() + ONE_DAY_MS);
    const bookingDateFilter =
      dateFieldKey === "departure_date"
        ? { departure_date: { gte: expandedFrom, lt: expandedToExclusive } }
        : { creation_date: { gte: expandedFrom, lt: expandedToExclusive } };

    // 2) Servicios del rango (por fecha seleccionada en booking) SOLO de mi agencia
    const services = await prisma.service.findMany({
      where: {
        booking: {
          id_agency: auth.id_agency,
          ...bookingDateFilter,
          ...(clientStatusArr?.length
            ? { clientStatus: { in: clientStatusArr } }
            : {}),
          ...(operatorStatusArr?.length
            ? { operatorStatus: { in: operatorStatusArr } }
            : {}),
        },
      },
      select: {
        id_service: true,
        agency_service_id: true,
        booking_id: true,
        currency: true,
        type: true,
        description: true,
        sale_price: true,
        card_interest: true,
        taxableCardInterest: true,
        vatOnCardInterest: true,
        cost_price: true,
        other_taxes: true,
        totalCommissionWithoutVAT: true,
        transfer_fee_amount: true,
        transfer_fee_pct: true,
        extra_costs_amount: true,
        extra_taxes_amount: true,
        extra_adjustments: true,
        billing_override: true,
        destination: true,
        ServiceDestination: {
          select: {
            destination: {
              select: { name: true, slug: true, country: true },
            },
          },
        },
      },
    });

    if (services.length === 0) {
      return res.status(200).json({
        totals: { sellerComm: {}, leaderComm: {}, agencyShare: {} },
        statsByCurrency: {},
        breakdowns: { byCountry: {}, byMethod: {} },
        items: [],
        bookingDetails: [],
      });
    }

    const isCurrencyAllowed = (cur: string) =>
      !!cur && (!hasCurrencyFilter || enabledCurrencies.has(cur));
    const addByBooking = (
      map: Map<number, Record<string, number>>,
      bid: number,
      cur: string,
      amount: number,
    ) => {
      if (!isCurrencyAllowed(cur)) return;
      const prev = map.get(bid) || {};
      prev[cur] = (prev[cur] || 0) + amount;
      map.set(bid, prev);
    };

    const fallbackSaleTotalsByBooking = new Map<number, Record<string, number>>();
    const costTotalsByBooking = new Map<number, Record<string, number>>();
    const taxTotalsByBooking = new Map<number, Record<string, number>>();
    const grossIncomeTaxByBooking = new Map<number, Record<string, number>>();
    const serviceAdjustmentsByBookingCurrency = new Map<
      number,
      Record<string, BillingAdjustmentConfig[]>
    >();

    const bookingCountry = new Map<number, string>();

    services.forEach((svc) => {
      const bid = svc.booking_id;
      const cur = String(svc.currency || "").trim().toUpperCase();
      if (!cur) return;

      addByBooking(
        fallbackSaleTotalsByBooking,
        bid,
        cur,
        Number(svc.sale_price) || 0,
      );
      addByBooking(
        costTotalsByBooking,
        bid,
        cur,
        Number(svc.cost_price) || 0,
      );
      addByBooking(
        taxTotalsByBooking,
        bid,
        cur,
        Number(svc.other_taxes) || 0,
      );
      addByBooking(
        grossIncomeTaxByBooking,
        bid,
        cur,
        getGrossIncomeTaxAmountFromBillingOverride(svc.billing_override),
      );

      const items = Array.isArray(svc.extra_adjustments)
        ? (svc.extra_adjustments as unknown[])
        : [];
      if (items.length > 0) {
        const normalized = items
          .filter((item) => {
            if (!item || typeof item !== "object") return false;
            const rec = item as Record<string, unknown>;
            return (
              rec.active !== false &&
              String(rec.source || "").toLowerCase() === "service"
            );
          })
          .map((item, idx): BillingAdjustmentConfig => {
            const rec = item as Record<string, unknown>;
            const kind: BillingAdjustmentConfig["kind"] =
              rec.kind === "tax" || rec.kind === "cost" ? rec.kind : "cost";
            const basis: BillingAdjustmentConfig["basis"] =
              rec.basis === "cost" ||
              rec.basis === "margin" ||
              rec.basis === "sale"
                ? rec.basis
                : "sale";
            const valueType: BillingAdjustmentConfig["valueType"] =
              rec.valueType === "fixed" || rec.valueType === "percent"
                ? rec.valueType
                : "percent";
            const value =
              typeof rec.value === "number"
                ? rec.value
                : Number(String(rec.value ?? "").replace(",", "."));
            return {
              id:
                typeof rec.id === "string" && rec.id
                  ? rec.id
                  : `service-${svc.id_service}-${idx}`,
              label:
                typeof rec.label === "string" && rec.label
                  ? rec.label
                  : "Ajuste servicio",
              kind,
              basis,
              valueType,
              value: Number.isFinite(value) ? value : 0,
              active: rec.active !== false,
              source: "service",
            };
          });
        if (normalized.length > 0) {
          const byCurrency = serviceAdjustmentsByBookingCurrency.get(bid) || {};
          byCurrency[cur] = [...(byCurrency[cur] || []), ...normalized];
          serviceAdjustmentsByBookingCurrency.set(bid, byCurrency);
        }
      }

      if (!bookingCountry.has(bid)) {
        const sd = svc.ServiceDestination?.[0];
        const country = sd?.destination?.country;
        const label =
          country?.iso2 ||
          country?.name ||
          (svc.destination || "").trim() ||
          "Sin pais";
        bookingCountry.set(bid, label);
      }
    });

    // 2.1) Dueños (vendedores) de cada booking (siempre desde Booking)
    const bookingOwners = new Map<
      number,
      { userId: number; userName: string; bookingCreatedAt: Date }
    >();
    const bookingAgencyIdByBooking = new Map<number, number | null>();
    const bookingCreationDateByBooking = new Map<number, Date>();
    let bookings: Array<{
      id_booking: number;
      agency_booking_id: number | null;
      creation_date: Date;
      departure_date: Date;
      sale_totals: unknown | null;
      use_booking_sale_total_override: boolean | null;
      commission_overrides: unknown | null;
      user: { id_user: number; first_name: string; last_name: string };
    }> = [];
    const bookingIds = Array.from(
      new Set(services.map((svc) => svc.booking_id)),
    );
    if (bookingIds.length > 0) {
      bookings = await prisma.booking.findMany({
        where: { id_agency: auth.id_agency, id_booking: { in: bookingIds } },
        select: {
          id_booking: true,
          agency_booking_id: true,
          creation_date: true,
          departure_date: true,
          sale_totals: true,
          use_booking_sale_total_override: true,
          commission_overrides: true,
          user: { select: { id_user: true, first_name: true, last_name: true } },
        },
      });
      bookings.forEach((b) => {
        bookingOwners.set(b.id_booking, {
          userId: b.user.id_user,
          userName: `${b.user.first_name} ${b.user.last_name}`,
          bookingCreatedAt: b.creation_date,
        });
        bookingCreationDateByBooking.set(b.id_booking, b.creation_date);
        bookingAgencyIdByBooking.set(
          b.id_booking,
          b.agency_booking_id != null &&
            Number.isFinite(Number(b.agency_booking_id)) &&
            Number(b.agency_booking_id) > 0
            ? Number(b.agency_booking_id)
            : null,
        );
      });
    }

    const overridesByBooking = new Map<
      number,
      ReturnType<typeof normalizeCommissionOverridesLenient>
    >();
    const bookingSaleModeByBooking = new Map<number, boolean>();
    bookings.forEach((b) => {
      overridesByBooking.set(
        b.id_booking,
        normalizeCommissionOverridesLenient(b.commission_overrides),
      );
      bookingSaleModeByBooking.set(
        b.id_booking,
        typeof b.use_booking_sale_total_override === "boolean"
          ? b.use_booking_sale_total_override
          : inheritedUseBookingSaleTotal,
      );
    });

    const matchesTeamFilter = (userId: number): boolean => {
      if (!Number.isFinite(parsedTeamId) || parsedTeamId <= 0) return true;
      const teamIds = userToMemberTeams.get(userId) || [];
      return teamIds.includes(parsedTeamId);
    };
    const allowedBookingIdsByDate = new Set<number>();
    bookings.forEach((b) => {
      const rawDate =
        dateFieldKey === "departure_date" ? b.departure_date : b.creation_date;
      const key = toDateKeyInBuenosAiresLegacySafe(rawDate);
      if (isDateKeyWithinRange(key, from, to)) {
        allowedBookingIdsByDate.add(b.id_booking);
      }
    });
    const allowedBookingIds = new Set<number>();
    bookingOwners.forEach((owner, bid) => {
      if (
        matchesTeamFilter(owner.userId) &&
        allowedBookingIdsByDate.has(bid)
      ) {
        allowedBookingIds.add(bid);
      }
    });

    if (allowedBookingIds.size === 0) {
      return res.status(200).json({
        totals: { sellerComm: {}, leaderComm: {}, agencyShare: {} },
        statsByCurrency: {},
        breakdowns: { byCountry: {}, byMethod: {} },
        items: [],
        bookingDetails: [],
      });
    }

    const servicesByBooking = new Map<number, (typeof services)[number][]>();
    const serviceById = new Map<number, (typeof services)[number]>();
    const serviceIdsByBooking = new Map<number, number[]>();
    const serviceIdSetByBooking = new Map<number, Set<number>>();

    services.forEach((svc) => {
      const bid = svc.booking_id;
      if (!allowedBookingIds.has(bid)) return;
      const list = servicesByBooking.get(bid) || [];
      list.push(svc);
      servicesByBooking.set(bid, list);
      serviceById.set(svc.id_service, svc);
    });

    servicesByBooking.forEach((bookingServices, bid) => {
      const ids = Array.from(
        new Set(bookingServices.map((svc) => svc.id_service)),
      ).sort((a, b) => a - b);
      serviceIdsByBooking.set(bid, ids);
      serviceIdSetByBooking.set(bid, new Set(ids));
    });

    const paidByService = new Map<number, number>();
    const serviceCommissionById = new Map<
      number,
      { seller: number; leader: number; agency: number }
    >();
    const bookingCommissionTotalsByCurrency = new Map<
      number,
      Record<string, { seller: number; leader: number; agency: number }>
    >();
    const addPaidByService = (serviceId: number, amount: number) => {
      if (!Number.isFinite(serviceId) || serviceId <= 0) return;
      if (!Number.isFinite(amount) || Math.abs(amount) <= PENDING_TOLERANCE) {
        return;
      }
      paidByService.set(
        serviceId,
        round2((paidByService.get(serviceId) || 0) + amount),
      );
    };
    const addServiceCommission = (
      serviceId: number,
      seller: number,
      leader: number,
      agency: number,
    ) => {
      if (!Number.isFinite(serviceId) || serviceId <= 0) return;
      const existing = serviceCommissionById.get(serviceId) || {
        seller: 0,
        leader: 0,
        agency: 0,
      };
      serviceCommissionById.set(serviceId, {
        seller: round2(existing.seller + (Number.isFinite(seller) ? seller : 0)),
        leader: round2(existing.leader + (Number.isFinite(leader) ? leader : 0)),
        agency: round2(existing.agency + (Number.isFinite(agency) ? agency : 0)),
      });
    };
    const addBookingCommissionTotals = (
      bookingId: number,
      currency: string,
      seller: number,
      leader: number,
      agency: number,
    ) => {
      const cur = String(currency || "").trim().toUpperCase();
      if (!cur) return;
      const byCurrency = bookingCommissionTotalsByCurrency.get(bookingId) || {};
      const existing = byCurrency[cur] || { seller: 0, leader: 0, agency: 0 };
      byCurrency[cur] = {
        seller: round2(existing.seller + (Number.isFinite(seller) ? seller : 0)),
        leader: round2(existing.leader + (Number.isFinite(leader) ? leader : 0)),
        agency: round2(existing.agency + (Number.isFinite(agency) ? agency : 0)),
      };
      bookingCommissionTotalsByCurrency.set(bookingId, byCurrency);
    };
    const getServiceDue = (svc: (typeof services)[number]) => {
      const sale = Math.max(Number(svc.sale_price || 0), 0);
      const splitInterest = Math.max(
        (Number(svc.taxableCardInterest || 0) || 0) +
          (Number(svc.vatOnCardInterest || 0) || 0),
        0,
      );
      const fallbackInterest = Math.max(Number(svc.card_interest || 0), 0);
      return round2(Math.max(sale + (splitInterest > 0 ? splitInterest : fallbackInterest), 0));
    };
    const distributeByServiceWeight = (serviceIds: number[], total: number) => {
      if (serviceIds.length === 0) return;
      if (!Number.isFinite(total) || Math.abs(total) <= PENDING_TOLERANCE) return;

      const weights = serviceIds.map((sid) => {
        const svc = serviceById.get(sid);
        if (!svc) return 0;
        return Math.max(getServiceDue(svc), 0);
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let remaining = round2(total);

      serviceIds.forEach((sid, idx) => {
        const isLast = idx === serviceIds.length - 1;
        const ratio =
          totalWeight > 0 ? weights[idx] / totalWeight : 1 / serviceIds.length;
        const amount = isLast ? remaining : round2(total * ratio);
        if (!isLast) remaining = round2(remaining - amount);
        addPaidByService(sid, amount);
      });
    };
    const distributeCommissionByServiceWeight = (
      serviceIds: number[],
      totals: { seller: number; leader: number; agency: number },
    ) => {
      if (serviceIds.length === 0) return;
      const totalAbs =
        Math.abs(totals.seller) + Math.abs(totals.leader) + Math.abs(totals.agency);
      if (totalAbs <= PENDING_TOLERANCE) return;

      const weights = serviceIds.map((sid) => {
        const svc = serviceById.get(sid);
        if (!svc) return 0;
        return Math.max(getServiceDue(svc), 0);
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

      let remainingSeller = round2(totals.seller);
      let remainingLeader = round2(totals.leader);
      let remainingAgency = round2(totals.agency);

      serviceIds.forEach((sid, idx) => {
        const isLast = idx === serviceIds.length - 1;
        const ratio =
          totalWeight > 0 ? weights[idx] / totalWeight : 1 / serviceIds.length;
        const sellerAmount = isLast
          ? remainingSeller
          : round2(totals.seller * ratio);
        const leaderAmount = isLast
          ? remainingLeader
          : round2(totals.leader * ratio);
        const agencyAmount = isLast
          ? remainingAgency
          : round2(totals.agency * ratio);

        if (!isLast) {
          remainingSeller = round2(remainingSeller - sellerAmount);
          remainingLeader = round2(remainingLeader - leaderAmount);
          remainingAgency = round2(remainingAgency - agencyAmount);
        }

      addServiceCommission(sid, sellerAmount, leaderAmount, agencyAmount);
      });
    };

    // 3) Venta total por reserva/moneda (para deuda y % pago)
    const saleTotalsByBooking = new Map<number, Record<string, number>>();
    bookings.forEach((b) => {
      if (!allowedBookingIds.has(b.id_booking)) return;
      const useBookingSaleTotal =
        bookingSaleModeByBooking.get(b.id_booking) ??
        inheritedUseBookingSaleTotal;
      const fallback = fallbackSaleTotalsByBooking.get(b.id_booking) || {};
      if (!useBookingSaleTotal) {
        saleTotalsByBooking.set(b.id_booking, fallback);
        return;
      }
      const normalized = normalizeSaleTotals(
        b.sale_totals,
        hasCurrencyFilter ? enabledCurrencies : undefined,
      );
      const hasValues = Object.values(normalized).some((v) => v > 0);
      saleTotalsByBooking.set(b.id_booking, hasValues ? normalized : fallback);
    });

    // 4) Recibos de esas reservas (misma agencia por FK booking)
    const receiptBookingIds = Array.from(saleTotalsByBooking.keys()).filter(
      (bid) => allowedBookingIds.has(bid),
    );
    const receiptWhere: Record<string, unknown> = {
      bookingId_booking: { in: receiptBookingIds },
    };
    if (Number.isFinite(parsedPaymentMethodId) && parsedPaymentMethodId > 0) {
      receiptWhere.payment_method_id = parsedPaymentMethodId;
    }
    if (Number.isFinite(parsedAccountId) && parsedAccountId > 0) {
      receiptWhere.account_id = parsedAccountId;
    }
    const allReceipts = await prisma.receipt.findMany({
      where: receiptWhere,
      select: {
        bookingId_booking: true,
        amount: true,
        amount_currency: true,
        payment_fee_amount: true,
        base_amount: true,
        base_currency: true,
        serviceIds: true,
        service_allocations: {
          select: {
            service_id: true,
            amount_service: true,
          },
        },
        payment_method: true,
        payment_method_id: true,
        account: true,
        account_id: true,
      },
    });

    const receiptsMap = new Map<number, Record<string, number>>();
    const receiptsByBookingMethod = new Map<
      number,
      { methodLabel: string; currency: string; amount: number }[]
    >();

    for (const r of allReceipts) {
      const bid = r.bookingId_booking;
      if (bid == null) continue; // evita TS2345 y casos sin booking
      const useBase = r.base_amount != null && r.base_currency;
      const cur = String(
        useBase ? r.base_currency : r.amount_currency || "",
      )
        .trim()
        .toUpperCase();
      if (!isCurrencyAllowed(cur)) continue;
      const prev = receiptsMap.get(bid) || {};
      const val = Number(useBase ? r.base_amount : r.amount) || 0;
      prev[cur] = (prev[cur] || 0) + val;
      receiptsMap.set(bid, prev);

      const methodLabel =
        (r.payment_method || "").trim() ||
        (r.payment_method_id ? `Metodo #${r.payment_method_id}` : "Sin metodo");
      const list = receiptsByBookingMethod.get(bid) || [];
      list.push({ methodLabel, currency: cur, amount: val });
      receiptsByBookingMethod.set(bid, list);

      const bookingServiceIds = serviceIdsByBooking.get(bid) || [];
      const bookingServiceIdSet = serviceIdSetByBooking.get(bid);
      if (bookingServiceIds.length === 0 || !bookingServiceIdSet) continue;

      const allocations = Array.isArray(r.service_allocations)
        ? r.service_allocations
        : [];

      let appliedAllocation = false;
      if (allocations.length > 0) {
        for (const alloc of allocations) {
          const serviceId = Number(alloc.service_id);
          if (!bookingServiceIdSet.has(serviceId)) continue;
          const amount = Number(alloc.amount_service || 0);
          if (Math.abs(amount) <= PENDING_TOLERANCE) continue;
          addPaidByService(serviceId, amount);
          appliedAllocation = true;
        }
        if (appliedAllocation) continue;
      }

      const scopedServiceIds = Array.from(
        new Set(
          (Array.isArray(r.serviceIds) ? r.serviceIds : [])
            .map((id) => Number(id))
            .filter(
              (id) => Number.isFinite(id) && bookingServiceIdSet.has(id),
            ),
        ),
      );
      const effectiveScopedServiceIds =
        scopedServiceIds.length > 0 ? scopedServiceIds : bookingServiceIds;

      const amountCurrency = String(r.amount_currency || "").trim().toUpperCase();
      const baseCurrency = String(r.base_currency || "").trim().toUpperCase();
      const amountValue = Number(r.amount || 0) || 0;
      const feeValue = Number(r.payment_fee_amount || 0) || 0;
      const baseValue = Number(r.base_amount || 0) || 0;

      let distributed = false;
      if (baseCurrency && Math.abs(baseValue) > PENDING_TOLERANCE) {
        const baseServiceIds = effectiveScopedServiceIds.filter((serviceId) => {
          const serviceCurrency = String(
            serviceById.get(serviceId)?.currency || "",
          )
            .trim()
            .toUpperCase();
          return serviceCurrency === baseCurrency;
        });
        if (baseServiceIds.length > 0) {
          const total =
            baseValue + (baseCurrency === amountCurrency ? feeValue : 0);
          distributeByServiceWeight(baseServiceIds, total);
          distributed = true;
        }
      }

      if (!distributed && amountCurrency) {
        const amountServiceIds = effectiveScopedServiceIds.filter(
          (serviceId) => {
            const serviceCurrency = String(
              serviceById.get(serviceId)?.currency || "",
            )
              .trim()
              .toUpperCase();
            return serviceCurrency === amountCurrency;
          },
        );
        if (amountServiceIds.length > 0) {
          distributeByServiceWeight(amountServiceIds, amountValue + feeValue);
        }
      }
    }

    // 5) Validar % cobrado en la misma moneda
    const validBookingCurrency = new Set<string>();
    saleTotalsByBooking.forEach((totals, bid) => {
      const paid = receiptsMap.get(bid) || {};
      for (const [cur, total] of Object.entries(totals)) {
        const t = Number(total) || 0;
        const p = Number(paid[cur] || 0);
        if (t > 0 && p / t >= paidPct) {
          validBookingCurrency.add(`${bid}-${cur}`);
        }
      }
    });

    // 6) Deuda por reserva
    const debtByBooking = new Map<number, Record<string, number>>();
    saleTotalsByBooking.forEach((totals, bid) => {
      const paid = receiptsMap.get(bid) || {};
      const debt: Record<string, number> = {};
      for (const [cur, total] of Object.entries(totals)) {
        const t = Number(total) || 0;
        const p = Number(paid[cur] || 0);
        debt[cur] = t - p;
      }
      debtByBooking.set(bid, debt);
    });

    // 7) Prefetch de REGLAS por usuario (versión por valid_from <= creation_date)
    const uniqueOwners = Array.from(
      new Set(Array.from(bookingOwners.values()).map((o) => o.userId)),
    );
    const ruleSets = await prisma.commissionRuleSet.findMany({
      where: { id_agency: auth.id_agency, owner_user_id: { in: uniqueOwners } },
      include: { shares: true },
      orderBy: [{ owner_user_id: "asc" }, { valid_from: "asc" }], // ordenadas crecientes
    });
    const rulesByOwner = new Map<number, typeof ruleSets>();
    ruleSets.forEach((rs) => {
      const arr = rulesByOwner.get(rs.owner_user_id) || [];
      arr.push(rs);
      rulesByOwner.set(rs.owner_user_id, arr);
    });

    function resolveRule(
      ownerId: number,
      bookingCreatedAt: Date,
    ): CommissionRule {
      const list = rulesByOwner.get(ownerId);
      if (!list || list.length === 0) return { sellerPct: 100, leaders: [] };
      // tomamos la última con valid_from <= bookingCreatedAt
      let chosen = list[0];
      for (const r of list) {
        if (r.valid_from <= bookingCreatedAt) chosen = r;
        else break;
      }
      if (chosen.valid_from > bookingCreatedAt) {
        // todas empiezan después → usar default 100
        return { sellerPct: 100, leaders: [] };
      }
      return {
        sellerPct: Number(chosen.own_pct),
        leaders: chosen.shares.map((s) => ({
          userId: s.beneficiary_user_id,
          pct: Number(s.percent),
        })),
      };
    }

    // 8) Filtrar servicios válidos por % pago
    const filteredServices = services.filter((svc) => {
      const bid = svc.booking_id;
      const useBookingSaleTotal =
        bookingSaleModeByBooking.get(bid) ?? inheritedUseBookingSaleTotal;
      if (useBookingSaleTotal) return false;
      const cur = String(svc.currency || "").trim().toUpperCase();
      return validBookingCurrency.has(`${bid}-${cur}`);
    });

    // 9) Agregación (una fila por vendedor+moneda, NO por equipo)
    const totals = {
      sellerComm: {} as Record<string, number>,
      leaderComm: {} as Record<string, number>,
      agencyShare: {} as Record<string, number>,
    };
    const statsByCurrency: EarningsResponse["statsByCurrency"] = {};
    const byCountry: EarningsResponse["breakdowns"]["byCountry"] = {};
    const byMethod: EarningsResponse["breakdowns"]["byMethod"] = {};
    const commissionByBooking = new Map<number, Record<string, number>>();

    const inc = (rec: Record<string, number>, cur: string, amount: number) => {
      rec[cur] = (rec[cur] || 0) + amount;
    };

    const ensureStats = (cur: string) => {
      if (!statsByCurrency[cur]) {
        statsByCurrency[cur] = {
          saleTotal: 0,
          paidTotal: 0,
          debtTotal: 0,
          commissionTotal: 0,
          paymentRate: 0,
        };
      }
    };

    saleTotalsByBooking.forEach((totalsByCur, bid) => {
      if (!allowedBookingIds.has(bid)) return;
      const paid = receiptsMap.get(bid) || {};
      for (const [cur, total] of Object.entries(totalsByCur)) {
        if (!validBookingCurrency.has(`${bid}-${cur}`)) continue;
        const sale = Number(total) || 0;
        const paidAmt = Number(paid[cur] || 0);
        ensureStats(cur);
        statsByCurrency[cur].saleTotal += sale;
        statsByCurrency[cur].paidTotal += paidAmt;
        statsByCurrency[cur].debtTotal += sale - paidAmt;
      }
    });

    receiptsByBookingMethod.forEach((entries, bid) => {
      if (!allowedBookingIds.has(bid)) return;
      for (const entry of entries) {
        if (!validBookingCurrency.has(`${bid}-${entry.currency}`)) continue;
        const bucket = byMethod[entry.methodLabel] || {};
        bucket[entry.currency] = (bucket[entry.currency] || 0) + entry.amount;
        byMethod[entry.methodLabel] = bucket;
      }
    });
    const itemsMap = new Map<string, EarningItem>();

    // Dado un usuario, armamos info de equipo para mostrar
    function getTeamDisplay(userId: number): {
      teamId: number;
      teamName: string;
    } {
      const teamIds = userToMemberTeams.get(userId) || [];

      if (!teamIds.length) {
        return { teamId: 0, teamName: "Sin equipo" };
      }

      const names = teamIds
        .map((id) => teamMap.get(id)?.name)
        .filter((n): n is string => Boolean(n));

      if (!names.length) {
        return { teamId: teamIds[0] ?? 0, teamName: "Sin equipo" };
      }

      if (names.length === 1) {
        return { teamId: teamIds[0], teamName: names[0] };
      }

      // Si está en varios equipos, mostramos todos en una sola etiqueta
      return {
        teamId: teamIds[0],
        teamName: names.join(" / "),
      };
    }

    function addRow(
      currency: string,
      userId: number,
      userName: string,
      sellerComm: number,
      leaderComm: number,
      agencyShare: number,
      debt: number,
      bid: number,
    ) {
      if (!matchesTeamFilter(userId)) return false;
      inc(totals.sellerComm, currency, sellerComm);
      inc(totals.leaderComm, currency, leaderComm);
      inc(totals.agencyShare, currency, agencyShare);

      const key = `${currency}-${userId}`;
      const existing = itemsMap.get(key);
      const agencyBookingId = bookingAgencyIdByBooking.get(bid) ?? null;

      if (existing) {
        existing.totalSellerComm += sellerComm;
        existing.totalLeaderComm += leaderComm;
        existing.totalAgencyShare += agencyShare;

        // Deuda: sólo se suma una vez por reserva
        if (!existing.bookingIds.includes(bid)) {
          existing.debt = Math.max(0, existing.debt + debt);
          existing.bookingIds.push(bid);
          existing.bookingRefs.push({
            bookingId: bid,
            agencyBookingId,
          });
        }
      } else {
        const { teamId, teamName } = getTeamDisplay(userId);
        itemsMap.set(key, {
          currency,
          userId,
          userName,
          teamId,
          teamName,
          totalSellerComm: sellerComm,
          totalLeaderComm: leaderComm,
          totalAgencyShare: agencyShare,
          debt: Math.max(0, debt),
          bookingIds: [bid],
          bookingRefs: [{ bookingId: bid, agencyBookingId }],
        });
      }
      return true;
    }

    const commissionBaseByBooking = new Map<number, Record<string, number>>();

    saleTotalsByBooking.forEach((totalsByCur, bid) => {
      const useBookingSaleTotal =
        bookingSaleModeByBooking.get(bid) ?? inheritedUseBookingSaleTotal;
      if (!useBookingSaleTotal) return;
      const costTotals = costTotalsByBooking.get(bid) || {};
      const taxTotals = taxTotalsByBooking.get(bid) || {};
      const baseByCur: Record<string, number> = {};

      for (const [cur, total] of Object.entries(totalsByCur)) {
        const sale = Number(total) || 0;
        const cost = Number(costTotals[cur] || 0);
        const taxes = Number(taxTotals[cur] || 0);
        const commissionBeforeFee = Math.max(sale - cost - taxes, 0);
        const fee =
          sale * (Number.isFinite(agencyFeePct) ? agencyFeePct : 0.024);
        const serviceAdjustments =
          serviceAdjustmentsByBookingCurrency.get(bid)?.[cur] || [];
        const combinedAdjustments = [
          ...billingAdjustments,
          ...serviceAdjustments,
        ];
        const adjustments = computeBillingAdjustments(
          combinedAdjustments,
          sale,
          cost,
        ).total;
        const iibb =
          grossIncomeTaxByBooking.get(bid)?.[cur] || 0;
        baseByCur[cur] = Math.max(
          commissionBeforeFee - fee - adjustments - iibb,
          0,
        );
      }

      commissionBaseByBooking.set(bid, baseByCur);
    });

    for (const [bid, baseByCur] of commissionBaseByBooking.entries()) {
      const owner = bookingOwners.get(bid);
      if (!owner) continue;
      const {
        userId: sellerId,
        userName: sellerName,
        bookingCreatedAt,
      } = owner;

      const rule = resolveRule(sellerId, bookingCreatedAt);
      const overrides = sanitizeCommissionOverrides(
        pruneOverridesByLeaderIds(
          overridesByBooking.get(bid) || null,
          rule.leaders.map((l) => l.userId),
        ),
      );

      for (const [cur, commissionBase] of Object.entries(baseByCur)) {
        if (!validBookingCurrency.has(`${bid}-${cur}`)) continue;
        const { sellerPct, leaderPcts } = resolveCommissionForContext({
          rule,
          overrides,
          currency: cur,
          allowService: false,
        });
        const sellerComm = commissionBase * (sellerPct / 100);
        const leaderComm = Object.values(leaderPcts).reduce(
          (sum, pct) => sum + commissionBase * (pct / 100),
          0,
        );
        const agencyShareAmt = Math.max(
          0,
          commissionBase - sellerComm - leaderComm,
        );
        const debtForBooking = debtByBooking.get(bid)?.[cur] ?? 0;

        const added = addRow(
          cur,
          sellerId,
          sellerName,
          sellerComm,
          leaderComm,
          agencyShareAmt,
          debtForBooking,
          bid,
        );
        if (added) {
          const bookingComm = commissionByBooking.get(bid) || {};
          bookingComm[cur] = (bookingComm[cur] || 0) + commissionBase;
          commissionByBooking.set(bid, bookingComm);
        }
        addBookingCommissionTotals(
          bid,
          cur,
          sellerComm,
          leaderComm,
          agencyShareAmt,
        );

        const bookingServiceIdsForCurrency = Array.from(
          new Set(
            (servicesByBooking.get(bid) || [])
              .filter(
                (service) =>
                  String(service.currency || "").trim().toUpperCase() === cur,
              )
              .map((service) => service.id_service),
          ),
        ).sort((a, b) => a - b);
        distributeCommissionByServiceWeight(bookingServiceIdsForCurrency, {
          seller: sellerComm,
          leader: leaderComm,
          agency: agencyShareAmt,
        });
      }
    }

    for (const svc of filteredServices) {
      const bid = svc.booking_id;
      const cur = String(svc.currency || "").trim().toUpperCase();
      if (!cur) continue;
      const owner = bookingOwners.get(bid);
      if (!owner) continue;
      const {
        userId: sellerId,
        userName: sellerName,
        bookingCreatedAt,
      } = owner;

      // base de comisión (con tu ajuste actual)
      const sale = Number(svc.sale_price) || 0;
      const pct =
        svc.transfer_fee_pct != null
          ? Number(svc.transfer_fee_pct)
          : agencyFeePct;
      const fee =
        svc.transfer_fee_amount != null
          ? Number(svc.transfer_fee_amount)
          : sale * (Number.isFinite(pct) ? pct : 0.024);
      const dbCommission = Number(svc.totalCommissionWithoutVAT ?? 0);
      const extraCosts = Number(svc.extra_costs_amount ?? 0);
      const extraTaxes = Number(svc.extra_taxes_amount ?? 0);
      const commissionBase = Math.max(
        dbCommission - fee - extraCosts - extraTaxes,
        0,
      );

      // regla efectiva por fecha de creación de la reserva
      const rule = resolveRule(sellerId, bookingCreatedAt);
      const overrides = sanitizeCommissionOverrides(
        pruneOverridesByLeaderIds(
          overridesByBooking.get(bid) || null,
          rule.leaders.map((l) => l.userId),
        ),
      );
      const { sellerPct, leaderPcts } = resolveCommissionForContext({
        rule,
        overrides,
        currency: cur,
        serviceId: svc.id_service,
        allowService: true,
      });

      const sellerComm = commissionBase * (sellerPct / 100);
      const leaderComm = Object.values(leaderPcts).reduce(
        (sum, pct) => sum + commissionBase * (pct / 100),
        0,
      );
      const agencyShareAmt = Math.max(
        0,
        commissionBase - sellerComm - leaderComm,
      );

      const debtForBooking = debtByBooking.get(bid)?.[cur] ?? 0;

      // 🔴 OJO: ahora agregamos UNA sola fila por vendedor+moneda
      const added = addRow(
        cur,
        sellerId,
        sellerName,
        sellerComm,
        leaderComm,
        agencyShareAmt,
        debtForBooking,
        bid,
      );
      if (added) {
        const bookingComm = commissionByBooking.get(bid) || {};
        bookingComm[cur] = (bookingComm[cur] || 0) + commissionBase;
        commissionByBooking.set(bid, bookingComm);
      }
      addBookingCommissionTotals(
        bid,
        cur,
        sellerComm,
        leaderComm,
        agencyShareAmt,
      );
      addServiceCommission(
        svc.id_service,
        sellerComm,
        leaderComm,
        agencyShareAmt,
      );
    }

    bookingCommissionTotalsByCurrency.forEach((byCurrency, bid) => {
      const bookingServices = servicesByBooking.get(bid) || [];
      if (bookingServices.length === 0) return;

      Object.entries(byCurrency).forEach(([cur, totals]) => {
        const serviceIdsForCurrency = Array.from(
          new Set(
            bookingServices
              .filter(
                (svc) => String(svc.currency || "").trim().toUpperCase() === cur,
              )
              .map((svc) => svc.id_service),
          ),
        ).sort((a, b) => a - b);
        if (serviceIdsForCurrency.length === 0) return;

        const expectedAbs =
          Math.abs(totals.seller) +
          Math.abs(totals.leader) +
          Math.abs(totals.agency);
        if (expectedAbs <= PENDING_TOLERANCE) return;

        const assignedAbs = serviceIdsForCurrency.reduce((sum, serviceId) => {
          const existing = serviceCommissionById.get(serviceId);
          if (!existing) return sum;
          return (
            sum +
            Math.abs(existing.seller || 0) +
            Math.abs(existing.leader || 0) +
            Math.abs(existing.agency || 0)
          );
        }, 0);

        if (assignedAbs <= PENDING_TOLERANCE) {
          distributeCommissionByServiceWeight(serviceIdsForCurrency, totals);
        }
      });
    });

    commissionByBooking.forEach((byCur, bid) => {
      const label = bookingCountry.get(bid) || "Sin pais";
      const bucket = byCountry[label] || {};
      for (const [cur, amount] of Object.entries(byCur)) {
        bucket[cur] = (bucket[cur] || 0) + amount;
      }
      byCountry[label] = bucket;
    });

    Object.keys(statsByCurrency).forEach((cur) => {
      statsByCurrency[cur].commissionTotal =
        (totals.sellerComm[cur] || 0) +
        (totals.leaderComm[cur] || 0) +
        (totals.agencyShare[cur] || 0);
      statsByCurrency[cur].paymentRate =
        statsByCurrency[cur].saleTotal > 0
          ? statsByCurrency[cur].paidTotal / statsByCurrency[cur].saleTotal
          : 0;
    });

    const referencedBookingIds = new Set<number>();
    itemsMap.forEach((item) => {
      item.bookingIds.forEach((bid) => {
        if (allowedBookingIds.has(bid)) referencedBookingIds.add(bid);
      });
    });

    const bookingDetails: EarningBookingDetail[] = Array.from(
      referencedBookingIds,
    )
      .sort((a, b) => {
        const aAgency = bookingAgencyIdByBooking.get(a) ?? Number.MAX_SAFE_INTEGER;
        const bAgency = bookingAgencyIdByBooking.get(b) ?? Number.MAX_SAFE_INTEGER;
        return aAgency - bAgency || a - b;
      })
      .map((bid) => {
        const agencyBookingId = bookingAgencyIdByBooking.get(bid) ?? null;
        const creationDateRaw = bookingCreationDateByBooking.get(bid) || null;
        const bookingServices = (servicesByBooking.get(bid) || [])
          .filter((svc) => {
            const cur = String(svc.currency || "").trim().toUpperCase();
            if (!cur) return false;
            return validBookingCurrency.has(`${bid}-${cur}`);
          })
          .sort((a, b) => {
            const aAgency = a.agency_service_id ?? Number.MAX_SAFE_INTEGER;
            const bAgency = b.agency_service_id ?? Number.MAX_SAFE_INTEGER;
            return aAgency - bAgency || a.id_service - b.id_service;
          })
          .map((svc) => {
            const currency = String(svc.currency || "").trim().toUpperCase();
            const sale = getServiceDue(svc);
            const paid = round2(
              Math.max(Number(paidByService.get(svc.id_service) || 0), 0),
            );
            const pending = round2(Math.max(sale - paid, 0));
            const serviceCommissions = serviceCommissionById.get(svc.id_service) || {
              seller: 0,
              leader: 0,
              agency: 0,
            };

            return {
              idService: svc.id_service,
              agencyServiceId:
                svc.agency_service_id != null &&
                Number.isFinite(Number(svc.agency_service_id)) &&
                Number(svc.agency_service_id) > 0
                  ? Number(svc.agency_service_id)
                  : null,
              bookingId: bid,
              agencyBookingId,
              currency,
              type: String(svc.type || "").trim(),
              description: String(svc.description || "").trim(),
              destination: String(svc.destination || "").trim(),
              sale,
              paid,
              pending,
              sellerCommission: round2(
                Math.max(Number(serviceCommissions.seller || 0), 0),
              ),
              leaderCommission: round2(
                Math.max(Number(serviceCommissions.leader || 0), 0),
              ),
              agencyCommission: round2(
                Math.max(Number(serviceCommissions.agency || 0), 0),
              ),
            };
          });

        return {
          bookingId: bid,
          agencyBookingId,
          creationDate: creationDateRaw ? creationDateRaw.toISOString() : null,
          services: bookingServices,
        };
      });

    return res.status(200).json({
      totals,
      statsByCurrency,
      breakdowns: { byCountry, byMethod },
      items: Array.from(itemsMap.values()),
      bookingDetails,
    });
  } catch (err: unknown) {
    console.error("Error en earnings API:", err);
    return res.status(500).json({ error: "Error obteniendo datos" });
  }
}
