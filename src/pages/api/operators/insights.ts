// src/pages/api/operators/insights.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import {
  addDaysToDateKey,
  parseDateInputInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
  toDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";

type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  role?: string;
  email?: string;
};

type DecodedAuth = {
  id_user: number;
  id_agency: number;
  role?: string;
  email?: string;
};

type MoneyMap = Record<string, number>;
type DateMode = "creation" | "travel";

type OperatorInsightsResponse = {
  operator: {
    id_operator: number;
    agency_operator_id?: number | null;
    name: string | null;
  };
  range: { from: string; to: string; mode: DateMode };
  counts: {
    services: number;
    bookings: number;
    receipts: number;
    otherIncomes: number;
    investments: number;
    investmentsUnlinked: number;
    debtServices: number;
    operatorDues: number;
  };
  totals: {
    sales: MoneyMap;
    incomes: MoneyMap;
    expenses: MoneyMap;
    expensesUnlinked: MoneyMap;
    net: MoneyMap;
    operatorDebt: MoneyMap;
    clientDebt: MoneyMap;
  };
  averages: {
    avgSalePerBooking: MoneyMap;
    avgIncomePerReceipt: MoneyMap;
    servicesPerBooking: number;
  };
  lists: {
    bookings: {
      id_booking: number;
      details: string | null;
      departure_date: string | null;
      return_date: string | null;
      creation_date: string | null;
      titular: {
        id_client: number;
        first_name: string;
        last_name: string;
      } | null;
      shared_operators: {
        id_operator: number;
        agency_operator_id?: number | null;
        name: string | null;
      }[];
      debt: MoneyMap;
      sale_with_interest: MoneyMap;
      paid: MoneyMap;
      operator_cost: MoneyMap;
      operator_payments: MoneyMap;
      operator_debt: MoneyMap;
      unreceipted_services: {
        id_service: number;
        description: string;
        sale_price: number;
        cost_price: number;
        currency: string;
      }[];
    }[];
    operatorDues: {
      id_due: number;
      due_date: string;
      status: string;
      amount: number;
      currency: string;
      booking_id: number;
      service_id: number;
      concept: string;
    }[];
    receipts: {
      id_receipt: number;
      issue_date: string;
      concept: string;
      amount: number;
      currency: string;
      booking_id: number | null;
      booking_agency_id?: number | null;
    }[];
    otherIncomes: {
      id_other_income: number;
      agency_other_income_id?: number | null;
      issue_date: string;
      concept: string;
      amount: number;
      currency: string;
      category_name?: string | null;
      operator_name?: string | null;
      booking_id: null;
    }[];
    investments: {
      id_investment: number;
      created_at: string;
      description: string;
      amount: number;
      currency: string;
      booking_id: number | null;
    }[];
    investmentsUnlinked: {
      id_investment: number;
      created_at: string;
      description: string;
      amount: number;
      currency: string;
      booking_id: number | null;
    }[];
  };
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const c = req.cookies || {};
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    if (c[k]) return c[k]!;
  }
  return null;
}

async function getUserFromAuth(
  req: NextApiRequest,
): Promise<DecodedAuth | null> {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return null;
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || undefined;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    const role = typeof p.role === "string" ? p.role : undefined;
    const email = typeof p.email === "string" ? p.email : undefined;

    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u) {
        return {
          id_user,
          id_agency: u.id_agency,
          role: role ?? u.role,
          email: email ?? u.email ?? undefined,
        };
      }
    }

    if (!id_user || !id_agency) return null;
    return { id_user, id_agency, role, email };
  } catch {
    return null;
  }
}

function safeNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toLocalDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}

function nextDayStartInBuenosAires(date: Date): Date {
  const key = toDateKeyInBuenosAires(date);
  if (key) {
    const nextKey = addDaysToDateKey(key, 1);
    if (nextKey) {
      const nextStart = startOfDayUtcFromDateKeyInBuenosAires(nextKey);
      if (nextStart) return nextStart;
    }
  }
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

function addMoney(target: MoneyMap, currency: string, amount: number) {
  if (!currency) return;
  if (!Number.isFinite(amount)) return;
  const code = currency.toUpperCase();
  target[code] = (target[code] ?? 0) + amount;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sumSalesWithInterest(services: {
  currency: string;
  sale_price: unknown;
  taxableCardInterest?: unknown;
  vatOnCardInterest?: unknown;
  card_interest?: unknown;
}[]): MoneyMap {
  const totals: MoneyMap = {};
  services.forEach((s) => {
    const cur = String(s.currency || "ARS").toUpperCase();
    const sale = Number(s.sale_price) || 0;
    const split =
      (Number(s.taxableCardInterest) || 0) + (Number(s.vatOnCardInterest) || 0);
    const interest = split > 0 ? split : Number(s.card_interest) || 0;
    addMoney(totals, cur, sale + interest);
  });
  return totals;
}

function sumCosts(services: {
  currency: string;
  cost_price: unknown;
}[]): MoneyMap {
  const totals: MoneyMap = {};
  services.forEach((svc) => {
    addMoney(totals, svc.currency, Number(svc.cost_price) || 0);
  });
  return totals;
}

function combineNet(incomes: MoneyMap, expenses: MoneyMap): MoneyMap {
  const out: MoneyMap = {};
  const keys = new Set([...Object.keys(incomes), ...Object.keys(expenses)]);
  for (const key of keys) {
    out[key] = (incomes[key] ?? 0) - (expenses[key] ?? 0);
  }
  return out;
}

function subtractMoneyMaps(base: MoneyMap, subtract: MoneyMap): MoneyMap {
  const out: MoneyMap = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(subtract)]);
  for (const key of keys) {
    out[key] = (base[key] ?? 0) - (subtract[key] ?? 0);
  }
  return out;
}

function mergeMoneyMaps(target: MoneyMap, addition: MoneyMap) {
  Object.entries(addition).forEach(([currency, amount]) => {
    addMoney(target, currency, amount);
  });
}

function pickMoney(
  amount: unknown,
  currency: unknown,
  baseAmount?: unknown,
  baseCurrency?: unknown,
) {
  const hasBase =
    baseAmount !== null &&
    baseAmount !== undefined &&
    baseCurrency !== null &&
    baseCurrency !== undefined &&
    String(baseCurrency).trim().length > 0;
  const rawCur = hasBase ? baseCurrency : currency;
  const cur = String(rawCur || "ARS").toUpperCase();
  const rawAmount = hasBase ? baseAmount : amount;
  const val = Number(rawAmount ?? 0);
  return { cur, val };
}

function pickInvestmentAmount(inv: {
  amount: unknown;
  currency: unknown;
  base_amount?: unknown;
  base_currency?: unknown;
  allocations?: { amount_payment: unknown; payment_currency: unknown }[] | null;
}) {
  if (inv.allocations && inv.allocations.length > 0) {
    const cur = String(inv.currency || inv.allocations[0]?.payment_currency || "ARS").toUpperCase();
    const val = inv.allocations.reduce(
      (sum, a) => sum + Number(a.amount_payment ?? 0),
      0,
    );
    return { cur, val };
  }
  return pickMoney(inv.amount, inv.currency, inv.base_amount, inv.base_currency);
}

function parseDateMode(raw: unknown): DateMode {
  return raw === "travel" ? "travel" : "creation";
}

function buildBookingDateFilter(
  mode: DateMode,
  fromDate: Date,
  toExclusive: Date,
) {
  if (mode === "travel") {
    return {
      departure_date: { lt: toExclusive },
      return_date: { gte: fromDate },
    };
  }
  return { creation_date: { gte: fromDate, lt: toExclusive } };
}

function buildServiceTravelFilter(fromDate: Date, toExclusive: Date) {
  return {
    departure_date: { lt: toExclusive },
    return_date: { gte: fromDate },
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OperatorInsightsResponse | { error: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getUserFromAuth(req);
  if (!auth?.id_agency) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const planAccess = await ensurePlanFeatureAccess(
    auth.id_agency,
    "operators_insights",
  );
  if (!planAccess.allowed) {
    return res.status(403).json({ error: "Plan insuficiente" });
  }

  const financeGrants = await getFinanceSectionGrants(
    auth.id_agency,
    auth.id_user,
  );
  const canOperatorsInsights = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "operators_insights",
  );
  if (!canOperatorsInsights) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const operatorId =
    safeNumber(
      Array.isArray(req.query.operatorId)
        ? req.query.operatorId[0]
        : req.query.operatorId,
    ) ??
    safeNumber(
      Array.isArray(req.query.operator_id)
        ? req.query.operator_id[0]
        : req.query.operator_id,
    );

  if (!operatorId) {
    return res.status(400).json({ error: "operatorId requerido" });
  }

  const fromRaw = Array.isArray(req.query.from)
    ? req.query.from[0]
    : req.query.from;
  const toRaw = Array.isArray(req.query.to) ? req.query.to[0] : req.query.to;

  if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
    return res.status(400).json({ error: "from/to requeridos" });
  }

  const fromDate = toLocalDate(fromRaw);
  const toDate = toLocalDate(toRaw);
  if (!fromDate || !toDate) {
    return res.status(400).json({ error: "from/to inválidos" });
  }
  const toExclusive = nextDayStartInBuenosAires(toDate);
  const dateMode = parseDateMode(
    Array.isArray(req.query.dateMode)
      ? req.query.dateMode[0]
      : req.query.dateMode,
  );
  const bookingDateFilter = buildBookingDateFilter(
    dateMode,
    fromDate,
    toExclusive,
  );

  const operator = await prisma.operator.findFirst({
    where: { id_operator: operatorId, id_agency: auth.id_agency },
    select: { id_operator: true, agency_operator_id: true, name: true },
  });
  if (!operator) {
    return res.status(404).json({ error: "Operador no encontrado" });
  }

  try {
    const services = await prisma.service.findMany({
      where: {
        id_operator: operatorId,
        ...(dateMode === "travel"
          ? buildServiceTravelFilter(fromDate, toExclusive)
          : {}),
        booking: {
          id_agency: auth.id_agency,
          ...(dateMode === "creation" ? bookingDateFilter : {}),
        },
      },
      select: {
        id_service: true,
        agency_service_id: true,
        booking_id: true,
        currency: true,
        sale_price: true,
        cost_price: true,
        description: true,
      },
    });

    const bookingIds = new Set<number>();
    const salesByCurrency: MoneyMap = {};
    const operatorCostByBooking = new Map<number, MoneyMap>();
    const operatorServiceIdsByBooking = new Map<number, Set<number>>();
    services.forEach((svc) => {
      bookingIds.add(svc.booking_id);
      addMoney(salesByCurrency, svc.currency, Number(svc.sale_price) || 0);

      const serviceSet =
        operatorServiceIdsByBooking.get(svc.booking_id) ?? new Set<number>();
      serviceSet.add(svc.id_service);
      operatorServiceIdsByBooking.set(svc.booking_id, serviceSet);

      const costMap = operatorCostByBooking.get(svc.booking_id) ?? {};
      addMoney(costMap, svc.currency, Number(svc.cost_price) || 0);
      operatorCostByBooking.set(svc.booking_id, costMap);
    });

    const receipts = await prisma.receipt.findMany({
      where: {
        booking: {
          id_agency: auth.id_agency,
          ...bookingDateFilter,
          services: { some: { id_operator: operatorId } },
        },
      },
      select: {
        id_receipt: true,
        issue_date: true,
        concept: true,
        amount: true,
        amount_currency: true,
        base_amount: true,
        base_currency: true,
        agency_receipt_id: true,
        bookingId_booking: true,
        booking: { select: { agency_booking_id: true } },
      },
      orderBy: { issue_date: "desc" },
    });

    const otherIncomes = await prisma.otherIncome.findMany({
      where: {
        id_agency: auth.id_agency,
        operator_id: operatorId,
        issue_date: {
          gte: fromDate,
          lt: toExclusive,
        },
      },
      select: {
        id_other_income: true,
        agency_other_income_id: true,
        issue_date: true,
        description: true,
        amount: true,
        currency: true,
        category: { select: { name: true } },
        operator: { select: { name: true } },
      },
      orderBy: { issue_date: "desc" },
    });

    const incomesByCurrency: MoneyMap = {};
    const receiptIncomeByCurrency: MoneyMap = {};
    const incomeCounts: Record<string, number> = {};
    receipts.forEach((rec) => {
      const { cur, val } = pickMoney(
        rec.amount,
        rec.amount_currency,
        rec.base_amount,
        rec.base_currency,
      );
      addMoney(incomesByCurrency, cur, val);
      addMoney(receiptIncomeByCurrency, cur, val);
      incomeCounts[cur] = (incomeCounts[cur] ?? 0) + 1;
    });
    otherIncomes.forEach((item) => {
      addMoney(
        incomesByCurrency,
        String(item.currency || "ARS").toUpperCase(),
        Number(item.amount) || 0,
      );
    });

    const serviceIds = services.map((svc) => svc.id_service);
    const serviceIdSet = new Set(serviceIds);
    const bookingIdList = Array.from(bookingIds);
    const serviceMetaById = new Map(
      services.map((svc) => [
        svc.id_service,
        {
          booking_id: svc.booking_id,
          currency: String(svc.currency || "ARS").toUpperCase(),
          cost_price: Math.max(Number(svc.cost_price) || 0, 0),
        },
      ]),
    );

    const operatorPayments = bookingIdList.length
      ? await prisma.investment.findMany({
          where: {
            id_agency: auth.id_agency,
            operator_id: operatorId,
            OR: [
              { booking_id: { in: bookingIdList } },
              { serviceIds: { hasSome: serviceIds } },
            ],
          },
          select: {
            booking_id: true,
            amount: true,
            currency: true,
            base_amount: true,
            base_currency: true,
            serviceIds: true,
            allocations: {
              select: {
                booking_id: true,
                service_id: true,
                amount_payment: true,
                payment_currency: true,
              },
            },
          },
        })
      : [];

    const operatorPaymentsByBooking = new Map<number, MoneyMap>();
    const addPaymentByBooking = (
      bookingId: number,
      currencyCode: string,
      amountValue: number,
    ) => {
      if (!bookingIds.has(bookingId)) return;
      const amount = Number(amountValue || 0);
      if (!Number.isFinite(amount)) return;
      const map = operatorPaymentsByBooking.get(bookingId) ?? {};
      addMoney(map, currencyCode, amount);
      operatorPaymentsByBooking.set(bookingId, map);
    };

    operatorPayments.forEach((inv) => {
      if (inv.allocations && inv.allocations.length > 0) {
        inv.allocations.forEach((alloc) => {
          const allocServiceId = Number(alloc.service_id || 0);
          const allocBookingId =
            Number(alloc.booking_id || 0) ||
            serviceMetaById.get(allocServiceId)?.booking_id ||
            0;
          if (!allocBookingId) return;
          const allocCur = String(
            alloc.payment_currency || inv.currency || "ARS",
          ).toUpperCase();
          const allocAmount = Number(alloc.amount_payment || 0);
          addPaymentByBooking(allocBookingId, allocCur, allocAmount);
        });
        return;
      }

      const legacyServiceIds = Array.from(
        new Set(
          (inv.serviceIds || [])
            .map((sid) => Number(sid))
            .filter((sid) => Number.isFinite(sid) && sid > 0),
        ),
      ).filter((sid) => serviceMetaById.has(sid));

      if (legacyServiceIds.length > 0) {
        const invCur = String(inv.currency || "").toUpperCase();
        const sameCurrency =
          !!invCur &&
          legacyServiceIds.every(
            (sid) => serviceMetaById.get(sid)?.currency === invCur,
          );

        if (sameCurrency) {
          const invAmount = Number(inv.amount || 0);
          const weights = legacyServiceIds.map(
            (sid) => serviceMetaById.get(sid)?.cost_price || 0,
          );
          const totalWeight = weights.reduce((sum, value) => sum + value, 0);
          let remaining = round2(invAmount);

          legacyServiceIds.forEach((sid, idx) => {
            const isLast = idx === legacyServiceIds.length - 1;
            const ratio =
              totalWeight > 0
                ? weights[idx] / totalWeight
                : 1 / legacyServiceIds.length;
            const allocated = isLast ? remaining : round2(invAmount * ratio);
            if (!isLast) remaining = round2(remaining - allocated);
            const bookingId = serviceMetaById.get(sid)?.booking_id;
            if (!bookingId) return;
            addPaymentByBooking(bookingId, invCur, allocated);
          });
          return;
        }
      }

      if (!inv.booking_id) return;
      const { cur, val } = pickMoney(
        inv.amount,
        inv.currency,
        inv.base_amount,
        inv.base_currency,
      );
      addPaymentByBooking(inv.booking_id, cur, val);
    });

    const bookings = bookingIdList.length
      ? await prisma.booking.findMany({
          where: {
            id_agency: auth.id_agency,
            id_booking: { in: bookingIdList },
          },
          select: {
            id_booking: true,
            agency_booking_id: true,
            details: true,
            creation_date: true,
            departure_date: true,
            return_date: true,
            titular: {
              select: {
                id_client: true,
                first_name: true,
                last_name: true,
              },
            },
            services: {
              select: {
                id_service: true,
                agency_service_id: true,
                id_operator: true,
                description: true,
                cost_price: true,
                currency: true,
                sale_price: true,
                card_interest: true,
                taxableCardInterest: true,
                vatOnCardInterest: true,
                operator: {
                  select: {
                    id_operator: true,
                    agency_operator_id: true,
                    name: true,
                  },
                },
              },
            },
            Receipt: {
              select: {
                id_receipt: true,
                amount: true,
                amount_currency: true,
                base_amount: true,
                base_currency: true,
                payment_fee_amount: true,
                serviceIds: true,
                service_allocations: {
                  select: {
                    service_id: true,
                    amount_service: true,
                    service_currency: true,
                  },
                },
              },
            },
          },
        })
      : [];

    const receiptedServiceIds = new Set<number>();
    bookings.forEach((booking) => {
      booking.Receipt.forEach((rec) => {
        const allocations = Array.isArray(rec.service_allocations)
          ? rec.service_allocations
          : [];
        if (allocations.length > 0) {
          allocations.forEach((alloc) => {
            const sid = Number(alloc.service_id);
            const amount = Number(alloc.amount_service ?? 0);
            if (!Number.isFinite(sid) || sid <= 0) return;
            if (!Number.isFinite(amount) || amount <= 0) return;
            if (serviceIdSet.has(sid)) receiptedServiceIds.add(sid);
          });
          return;
        }

        (rec.serviceIds || []).forEach((sid) => {
          if (serviceIdSet.has(sid)) receiptedServiceIds.add(sid);
        });
      });
    });

    const debtServices = services.filter(
      (svc) => !receiptedServiceIds.has(svc.id_service),
    );

    const serviceIdsInRange = new Set(services.map((svc) => svc.id_service));
    const bookingSummaries = bookings.map((booking) => {
      const operatorServiceIds =
        operatorServiceIdsByBooking.get(booking.id_booking) ?? new Set<number>();
      const operatorServices = booking.services.filter((svc) =>
        operatorServiceIds.has(svc.id_service),
      );
      const saleWithInterest = sumSalesWithInterest(operatorServices);
      const paid: MoneyMap = {};
      booking.Receipt.forEach((rec) => {
        const allocations = Array.isArray(rec.service_allocations)
          ? rec.service_allocations
          : [];
        if (allocations.length > 0) {
          allocations.forEach((alloc) => {
            const sid = Number(alloc.service_id);
            const amount = Number(alloc.amount_service ?? 0);
            if (!Number.isFinite(sid) || sid <= 0) return;
            if (!operatorServiceIds.has(sid)) return;
            if (!Number.isFinite(amount) || amount <= 0) return;
            const serviceCurrency = serviceMetaById.get(sid)?.currency;
            const allocCurrency = String(
              serviceCurrency || alloc.service_currency || "ARS",
            ).toUpperCase();
            addMoney(paid, allocCurrency, amount);
          });
          return;
        }

        const appliesToOperator = (rec.serviceIds || []).some((sid) =>
          operatorServiceIds.has(sid),
        );
        if (!appliesToOperator) return;
        const { cur, val } = pickMoney(
          rec.amount,
          rec.amount_currency,
          rec.base_amount,
          rec.base_currency,
        );
        const fee = Number(rec.payment_fee_amount) || 0;
        addMoney(paid, cur, val + fee);
      });
      const debt = subtractMoneyMaps(saleWithInterest, paid);

      const otherOperators = new Map<
        number,
        { name: string | null; agency_operator_id?: number | null }
      >();
      booking.services.forEach((svc) => {
        if (svc.id_operator !== operatorId && svc.operator) {
          otherOperators.set(svc.operator.id_operator, {
            name: svc.operator.name ?? null,
            agency_operator_id: svc.operator.agency_operator_id ?? null,
          });
        }
      });

      const operatorCost =
        operatorCostByBooking.get(booking.id_booking) ??
        sumCosts(operatorServices);
      const operatorPayments =
        operatorPaymentsByBooking.get(booking.id_booking) ?? {};
      const operatorDebt = subtractMoneyMaps(operatorCost, operatorPayments);

      const unreceiptedServices = booking.services
        .filter(
          (svc) =>
            svc.id_operator === operatorId &&
            serviceIdsInRange.has(svc.id_service) &&
            !receiptedServiceIds.has(svc.id_service),
        )
        .map((svc) => ({
          id_service: svc.id_service,
          description: svc.description,
          sale_price: Number(svc.sale_price) || 0,
          cost_price: Number(svc.cost_price) || 0,
          currency: String(svc.currency || "ARS").toUpperCase(),
        }));

        return {
          id_booking: booking.id_booking,
          details: booking.details,
          creation_date: booking.creation_date
            ? (toDateKeyInBuenosAiresLegacySafe(booking.creation_date) ?? null)
            : null,
          departure_date: booking.departure_date
            ? (toDateKeyInBuenosAiresLegacySafe(booking.departure_date) ?? null)
            : null,
          return_date: booking.return_date
            ? (toDateKeyInBuenosAiresLegacySafe(booking.return_date) ?? null)
            : null,
          titular: booking.titular
            ? {
                id_client: booking.titular.id_client,
                first_name: booking.titular.first_name,
                last_name: booking.titular.last_name,
              }
            : null,
          shared_operators: Array.from(otherOperators.entries()).map(
            ([id_operator, meta]) => ({
              id_operator,
              agency_operator_id: meta.agency_operator_id ?? null,
              name: meta.name,
            }),
          ),
        debt,
        sale_with_interest: saleWithInterest,
        paid,
        operator_cost: operatorCost,
        operator_payments: operatorPayments,
        operator_debt: operatorDebt,
        unreceipted_services: unreceiptedServices,
      };
    });

    const clientDebtTotals: MoneyMap = {};
    const operatorDebtTotals: MoneyMap = {};
    bookingSummaries.forEach((summary) => {
      mergeMoneyMaps(clientDebtTotals, summary.debt);
      mergeMoneyMaps(operatorDebtTotals, summary.operator_debt);
    });

    const sortedBookings = [...bookingSummaries].sort((a, b) => {
      const aKey = dateMode === "travel" ? a.departure_date : a.creation_date;
      const bKey = dateMode === "travel" ? b.departure_date : b.creation_date;
      const aTime = aKey ? Date.parse(aKey) : 0;
      const bTime = bKey ? Date.parse(bKey) : 0;
      if (dateMode === "travel") {
        return aTime - bTime;
      }
      return bTime - aTime;
    });

    const investmentsWithBooking = await prisma.investment.findMany({
      where: {
        id_agency: auth.id_agency,
        operator_id: operatorId,
        booking: {
          id_agency: auth.id_agency,
          ...bookingDateFilter,
        },
      },
      select: {
        id_investment: true,
        agency_investment_id: true,
        created_at: true,
        description: true,
        amount: true,
        currency: true,
        base_amount: true,
        base_currency: true,
        booking_id: true,
        booking: { select: { agency_booking_id: true } },
        allocations: {
          select: { amount_payment: true, payment_currency: true },
        },
      },
      orderBy: { created_at: "desc" },
    });

    const investmentsUnlinked = await prisma.investment.findMany({
      where: {
        id_agency: auth.id_agency,
        operator_id: operatorId,
        booking_id: null,
        created_at: { gte: fromDate, lt: toExclusive },
      },
      select: {
        id_investment: true,
        agency_investment_id: true,
        created_at: true,
        description: true,
        amount: true,
        currency: true,
        base_amount: true,
        base_currency: true,
        booking_id: true,
        booking: { select: { agency_booking_id: true } },
        allocations: {
          select: { amount_payment: true, payment_currency: true },
        },
      },
      orderBy: { created_at: "desc" },
    });

    const operatorDues = await prisma.operatorDue.findMany({
      where: {
        booking: {
          id_agency: auth.id_agency,
        },
        service: {
          id_operator: operatorId,
        },
        due_date: { gte: fromDate, lt: toExclusive },
      },
      select: {
        id_due: true,
        due_date: true,
        status: true,
        amount: true,
        currency: true,
        booking_id: true,
        service_id: true,
        concept: true,
        booking: { select: { agency_booking_id: true } },
        service: { select: { agency_service_id: true } },
      },
      orderBy: { due_date: "asc" },
    });

    const expensesByCurrency: MoneyMap = {};
    investmentsWithBooking.forEach((inv) => {
      const { cur, val } = pickInvestmentAmount(inv);
      addMoney(expensesByCurrency, cur, val);
    });

    const expensesUnlinkedByCurrency: MoneyMap = {};
    investmentsUnlinked.forEach((inv) => {
      const { cur, val } = pickInvestmentAmount(inv);
      addMoney(expensesUnlinkedByCurrency, cur, val);
    });

    const bookingCount = bookings.length;
    const servicesPerBooking =
      bookingCount > 0 ? services.length / bookingCount : 0;

    const avgSalePerBooking: MoneyMap = {};
    Object.entries(salesByCurrency).forEach(([cur, total]) => {
      if (bookingCount > 0) avgSalePerBooking[cur] = total / bookingCount;
    });

    const avgIncomePerReceipt: MoneyMap = {};
    Object.entries(receiptIncomeByCurrency).forEach(([cur, total]) => {
      const count = incomeCounts[cur] ?? 0;
      if (count > 0) avgIncomePerReceipt[cur] = total / count;
    });

    const recentReceipts = receipts.slice(0, 10).map((rec) => {
      const { cur, val } = pickMoney(
        rec.amount,
        rec.amount_currency,
        rec.base_amount,
        rec.base_currency,
      );
      return {
        id_receipt: rec.id_receipt,
        agency_receipt_id: rec.agency_receipt_id ?? null,
        issue_date:
          toDateKeyInBuenosAiresLegacySafe(rec.issue_date) ??
          rec.issue_date.toISOString(),
        concept: rec.concept,
        amount: val,
        currency: cur,
        booking_id: rec.bookingId_booking ?? null,
        booking_agency_id: rec.booking?.agency_booking_id ?? null,
      };
    });

    const recentOtherIncomes = otherIncomes.slice(0, 10).map((item) => ({
      id_other_income: item.id_other_income,
      agency_other_income_id: item.agency_other_income_id ?? null,
      issue_date:
        toDateKeyInBuenosAiresLegacySafe(item.issue_date) ??
        item.issue_date.toISOString(),
      concept: item.description || "Ingreso",
      amount: Number(item.amount) || 0,
      currency: String(item.currency || "ARS").toUpperCase(),
      category_name: item.category?.name ?? null,
      operator_name: item.operator?.name ?? null,
      booking_id: null as null,
    }));

    const recentInvestments = investmentsWithBooking.slice(0, 10).map((inv) => {
      const { cur, val } = pickInvestmentAmount(inv);
      return {
        id_investment: inv.id_investment,
        agency_investment_id: inv.agency_investment_id ?? null,
        created_at:
          toDateKeyInBuenosAires(inv.created_at) ?? inv.created_at.toISOString(),
        description: inv.description,
        amount: val,
        currency: cur,
        booking_id: inv.booking_id ?? null,
        booking_agency_id: inv.booking?.agency_booking_id ?? null,
      };
    });

    const recentInvestmentsUnlinked = investmentsUnlinked
      .slice(0, 8)
      .map((inv) => {
        const { cur, val } = pickInvestmentAmount(inv);
        return {
          id_investment: inv.id_investment,
          agency_investment_id: inv.agency_investment_id ?? null,
          created_at:
            toDateKeyInBuenosAires(inv.created_at) ??
            inv.created_at.toISOString(),
          description: inv.description,
          amount: val,
          currency: cur,
          booking_id: inv.booking_id ?? null,
          booking_agency_id: inv.booking?.agency_booking_id ?? null,
        };
      });

    return res.status(200).json({
        operator,
        range: { from: fromRaw, to: toRaw, mode: dateMode },
        counts: {
          services: services.length,
          bookings: bookingCount,
          receipts: receipts.length,
          otherIncomes: otherIncomes.length,
          investments: investmentsWithBooking.length,
          investmentsUnlinked: investmentsUnlinked.length,
          debtServices: debtServices.length,
          operatorDues: operatorDues.length,
        },
        totals: {
          sales: salesByCurrency,
          incomes: incomesByCurrency,
          expenses: expensesByCurrency,
          expensesUnlinked: expensesUnlinkedByCurrency,
          net: combineNet(incomesByCurrency, expensesByCurrency),
          operatorDebt: operatorDebtTotals,
          clientDebt: clientDebtTotals,
        },
        averages: {
          avgSalePerBooking,
          avgIncomePerReceipt,
          servicesPerBooking,
      },
        lists: {
          bookings: sortedBookings,
          operatorDues: operatorDues.map((due) => ({
            id_due: due.id_due,
            due_date:
              toDateKeyInBuenosAiresLegacySafe(due.due_date) ??
              due.due_date.toISOString(),
            status: due.status,
            amount: Number(due.amount) || 0,
            currency: String(due.currency || "ARS").toUpperCase(),
            booking_id: due.booking_id,
            booking_agency_id: due.booking?.agency_booking_id ?? null,
            service_id: due.service_id,
            service_agency_id: due.service?.agency_service_id ?? null,
            concept: due.concept,
          })),
          receipts: recentReceipts,
          otherIncomes: recentOtherIncomes,
          investments: recentInvestments,
          investmentsUnlinked: recentInvestmentsUnlinked,
        },
      });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Error cargando insights";
    return res.status(500).json({ error: msg });
  }
}
