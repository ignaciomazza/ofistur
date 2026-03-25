import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { normalizeRole } from "@/utils/permissions";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
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
  role: string;
  email?: string;
};

type VisibilityMode = "all" | "team" | "own";
type RoleInBooking = "ALL" | "TITULAR" | "COMPANION";
type DateMode = "creation" | "travel";
type MoneyMap = Record<string, number>;
type CustomFieldFilter = { key: string; value: string };

type PanelRecentBooking = {
  id_booking: number;
  agency_booking_id: number | null;
  role: "TITULAR" | "ACOMPANANTE";
  details: string | null;
  creation_date: string | null;
  departure_date: string | null;
  return_date: string | null;
  sale_amounts: MoneyMap;
  received_amounts: MoneyMap;
  debt_amounts: MoneyMap;
};

type PanelBookingSummary = {
  bookings_total: number;
  bookings_as_titular: number;
  bookings_as_companion: number;
  sale_amounts: MoneyMap;
  received_amounts: MoneyMap;
  debt_amounts: MoneyMap;
  last_booking_date: string | null;
  next_travel_date: string | null;
  recent_bookings: PanelRecentBooking[];
};

type PanelRow = {
  client: {
    id_client: number;
    agency_client_id: number | null;
    first_name: string;
    last_name: string;
    profile_key: string;
    id_user: number;
    user: {
      id_user: number;
      first_name: string;
      last_name: string;
    } | null;
  };
  summary: {
    bookings: PanelBookingSummary;
  };
};

type PanelKpis = {
  clients: number;
  with_activity_clients: number;
  bookings_total: number;
  bookings_as_titular: number;
  bookings_as_companion: number;
  sale_amounts: MoneyMap;
  received_amounts: MoneyMap;
  debt_amounts: MoneyMap;
};

type PanelResponse = {
  items: PanelRow[];
  nextCursor: number | null;
  kpis: PanelKpis;
};

type ClientLite = {
  id_client: number;
  agency_client_id: number | null;
  first_name: string;
  last_name: string;
  profile_key: string;
  custom_fields: Prisma.JsonValue | null;
  id_user: number;
  user: { id_user: number; first_name: string; last_name: string } | null;
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");
const CUSTOM_FIELD_KEY_REGEX = /^[a-z0-9_]{1,40}$/;

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

function safeNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCurrency(value: unknown): string {
  return String(value || "ARS")
    .trim()
    .toUpperCase();
}

function addMoney(target: MoneyMap, currency: string, amount: number): void {
  const code = normalizeCurrency(currency);
  if (!code) return;
  const safe = Number.isFinite(amount) ? amount : 0;
  target[code] = (target[code] ?? 0) + safe;
}

function addMoneyMaps(target: MoneyMap, source: MoneyMap): void {
  Object.entries(source).forEach(([currency, amount]) => {
    addMoney(target, currency, amount);
  });
}

function subtractMoneyMaps(a: MoneyMap, b: MoneyMap): MoneyMap {
  const out: MoneyMap = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.forEach((currency) => {
    out[currency] = (a[currency] ?? 0) - (b[currency] ?? 0);
  });
  return out;
}

function normalizeVisibilityMode(value: unknown): VisibilityMode {
  return value === "team" || value === "own" || value === "all"
    ? value
    : "all";
}

function normalizeRoleInBooking(value: unknown): RoleInBooking {
  const v = String(value || "")
    .trim()
    .toUpperCase();
  if (v === "TITULAR" || v === "COMPANION") return v;
  return "ALL";
}

function normalizeDateMode(value: unknown): DateMode {
  return String(value || "").trim().toLowerCase() === "creation"
    ? "creation"
    : "travel";
}

function normalizeFilterText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function normalizeCustomFieldFilters(value: unknown): CustomFieldFilter[] {
  if (value == null) return [];

  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const out: CustomFieldFilter[] = [];

  parsed.forEach((rawItem) => {
    if (!rawItem || typeof rawItem !== "object") return;
    const item = rawItem as Record<string, unknown>;
    const key = String(item.key ?? "")
      .trim()
      .toLowerCase();
    const filterValue = String(item.value ?? "").trim();
    if (!key || !filterValue || !CUSTOM_FIELD_KEY_REGEX.test(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, value: filterValue });
  });

  return out.slice(0, 8);
}

function readCustomFieldValue(
  customFields: Prisma.JsonValue | null,
  key: string,
): string {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return "";
  }
  const record = customFields as Record<string, unknown>;
  return String(record[key] ?? "").trim();
}

function matchesCustomFieldFilters(
  customFields: Prisma.JsonValue | null,
  filters: CustomFieldFilter[],
): boolean {
  if (filters.length === 0) return true;

  return filters.every((filter) => {
    const currentValue = readCustomFieldValue(customFields, filter.key);
    if (!currentValue) return false;
    const currentNorm = normalizeFilterText(currentValue);
    const expectedNorm = normalizeFilterText(filter.value);
    if (!expectedNorm) return false;
    return currentNorm.includes(expectedNorm);
  });
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
    const role = String(p.role || "").toLowerCase();
    const email = p.email;

    if (id_user && !id_agency) {
      const user = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (user) {
        return {
          id_user,
          id_agency: user.id_agency,
          role: role || user.role.toLowerCase(),
          email: email ?? user.email ?? undefined,
        };
      }
    }

    if (!id_user || !id_agency) return null;
    return { id_user, id_agency, role, email: email ?? undefined };
  } catch {
    return null;
  }
}

async function getVisibilityMode(authAgencyId: number): Promise<VisibilityMode> {
  const cfg = await prisma.clientConfig.findFirst({
    where: { id_agency: authAgencyId },
    select: { visibility_mode: true },
  });
  return normalizeVisibilityMode(cfg?.visibility_mode);
}

type TeamScope = {
  teamIds: number[];
  userIds: number[];
  membersByTeam: Record<number, number[]>;
};

async function getTeamScope(
  authUserId: number,
  authAgencyId: number,
): Promise<TeamScope> {
  const teams = await prisma.salesTeam.findMany({
    where: {
      id_agency: authAgencyId,
      user_teams: { some: { id_user: authUserId } },
    },
    include: { user_teams: { select: { id_user: true } } },
  });

  const teamIds = teams.map((t) => t.id_team);
  const userIds = new Set<number>([authUserId]);
  const membersByTeam: Record<number, number[]> = {};

  teams.forEach((t) => {
    const ids = t.user_teams.map((ut) => ut.id_user);
    membersByTeam[t.id_team] = ids;
    ids.forEach((id) => userIds.add(id));
  });

  return { teamIds, userIds: Array.from(userIds), membersByTeam };
}

async function getLeaderScope(
  authUserId: number,
  authAgencyId: number,
): Promise<TeamScope> {
  const teams = await prisma.salesTeam.findMany({
    where: {
      id_agency: authAgencyId,
      user_teams: { some: { user: { id_user: authUserId, role: "lider" } } },
    },
    include: { user_teams: { select: { id_user: true } } },
  });

  const teamIds = teams.map((t) => t.id_team);
  const userIds = new Set<number>([authUserId]);
  const membersByTeam: Record<number, number[]> = {};

  teams.forEach((t) => {
    const ids = t.user_teams.map((ut) => ut.id_user);
    membersByTeam[t.id_team] = ids;
    ids.forEach((id) => userIds.add(id));
  });

  return { teamIds, userIds: Array.from(userIds), membersByTeam };
}

function parseSaleTotalsFromJson(input: Prisma.JsonValue | null): MoneyMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: MoneyMap = {};
  Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
    const amount = toNum(value);
    if (!Number.isFinite(amount) || amount === 0) return;
    addMoney(out, key, amount);
  });
  return out;
}

function computeSaleByCurrency(booking: {
  sale_totals: Prisma.JsonValue | null;
  services: Array<{
    sale_price: number;
    currency: string;
    card_interest: number | null;
    taxableCardInterest: number | null;
    vatOnCardInterest: number | null;
  }>;
}): MoneyMap {
  const fromTotals = parseSaleTotalsFromJson(booking.sale_totals);
  if (Object.keys(fromTotals).length > 0) return fromTotals;

  const out: MoneyMap = {};
  booking.services.forEach((service) => {
    const splitInterest =
      toNum(service.taxableCardInterest) + toNum(service.vatOnCardInterest);
    const interest = splitInterest > 0 ? splitInterest : toNum(service.card_interest);
    addMoney(out, service.currency, toNum(service.sale_price) + interest);
  });
  return out;
}

function computeReceiptsByCurrency(receipts: Array<{
  amount: number;
  amount_currency: string;
  base_amount: Prisma.Decimal | null;
  base_currency: string | null;
  payment_fee_amount: Prisma.Decimal | null;
}>): MoneyMap {
  const out: MoneyMap = {};

  receipts.forEach((receipt) => {
    const baseCur = receipt.base_currency
      ? normalizeCurrency(receipt.base_currency)
      : null;
    const baseVal = toNum(receipt.base_amount);

    const amountCur = receipt.amount_currency
      ? normalizeCurrency(receipt.amount_currency)
      : null;
    const amountVal = toNum(receipt.amount);

    const feeVal = toNum(receipt.payment_fee_amount);
    const feeCur = amountCur ?? baseCur;

    if (baseCur) {
      const val = baseVal + (feeCur === baseCur ? feeVal : 0);
      if (val) addMoney(out, baseCur, val);
      return;
    }

    if (amountCur) {
      const val = amountVal + (feeCur === amountCur ? feeVal : 0);
      if (val) addMoney(out, amountCur, val);
      return;
    }

    if (feeCur && feeVal) {
      addMoney(out, feeCur, feeVal);
    }
  });

  return out;
}

function makeEmptyBookingSummary(): PanelBookingSummary {
  return {
    bookings_total: 0,
    bookings_as_titular: 0,
    bookings_as_companion: 0,
    sale_amounts: {},
    received_amounts: {},
    debt_amounts: {},
    last_booking_date: null,
    next_travel_date: null,
    recent_bookings: [],
  };
}

function makeEmptyKpis(): PanelKpis {
  return {
    clients: 0,
    with_activity_clients: 0,
    bookings_total: 0,
    bookings_as_titular: 0,
    bookings_as_companion: 0,
    sale_amounts: {},
    received_amounts: {},
    debt_amounts: {},
  };
}

function bookingDateWhere(
  dateMode: DateMode,
  from: string,
  to: string,
): Prisma.BookingWhereInput {
  const fromDate = from ? startOfDayUtcFromDateKeyInBuenosAires(from) : null;
  const toDate = to ? endOfDayUtcFromDateKeyInBuenosAires(to) : null;

  if (!fromDate && !toDate) return {};

  if (dateMode === "creation") {
    return {
      creation_date: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    };
  }

  const clauses: Prisma.BookingWhereInput[] = [];
  if (fromDate) clauses.push({ return_date: { gte: fromDate } });
  if (toDate) clauses.push({ departure_date: { lte: toDate } });

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { AND: clauses };
}

function shouldIncludeRole(
  roleFilter: RoleInBooking,
  participantRole: "TITULAR" | "ACOMPANANTE",
): boolean {
  if (roleFilter === "ALL") return true;
  if (roleFilter === "TITULAR") return participantRole === "TITULAR";
  return participantRole === "ACOMPANANTE";
}

function sortRecentBookings(
  rows: PanelRecentBooking[],
): PanelRecentBooking[] {
  return [...rows]
    .sort((a, b) => {
      const aKey = a.creation_date || a.departure_date || "";
      const bKey = b.creation_date || b.departure_date || "";
      return bKey.localeCompare(aKey);
    })
    .slice(0, 3);
}

async function buildRowsForClients(
  id_agency: number,
  clients: ClientLite[],
  roleFilter: RoleInBooking,
  dateMode: DateMode,
  from: string,
  to: string,
  includeEmpty: boolean,
): Promise<PanelRow[]> {
  if (clients.length === 0) return [];

  const clientIds = clients.map((client) => client.id_client);
  const clientIdSet = new Set(clientIds);

  const bookingWhere: Prisma.BookingWhereInput = {
    id_agency,
    ...bookingDateWhere(dateMode, from, to),
  };

  if (roleFilter === "TITULAR") {
    bookingWhere.titular_id = { in: clientIds };
  } else if (roleFilter === "COMPANION") {
    bookingWhere.clients = { some: { id_client: { in: clientIds } } };
  } else {
    bookingWhere.OR = [
      { titular_id: { in: clientIds } },
      { clients: { some: { id_client: { in: clientIds } } } },
    ];
  }

  const bookings = await prisma.booking.findMany({
    where: bookingWhere,
    select: {
      id_booking: true,
      agency_booking_id: true,
      details: true,
      creation_date: true,
      departure_date: true,
      return_date: true,
      titular_id: true,
      sale_totals: true,
      clients: {
        select: { id_client: true },
      },
      services: {
        select: {
          sale_price: true,
          currency: true,
          card_interest: true,
          taxableCardInterest: true,
          vatOnCardInterest: true,
        },
      },
      Receipt: {
        select: {
          amount: true,
          amount_currency: true,
          base_amount: true,
          base_currency: true,
          payment_fee_amount: true,
        },
      },
    },
    orderBy: { creation_date: "desc" },
  });

  const summaryByClientId = new Map<number, PanelBookingSummary>();
  clientIds.forEach((id) => summaryByClientId.set(id, makeEmptyBookingSummary()));

  const todayKey = todayDateKeyInBuenosAires();

  bookings.forEach((booking) => {
    const sale = computeSaleByCurrency(booking);
    const received = computeReceiptsByCurrency(booking.Receipt);
    const debt = subtractMoneyMaps(sale, received);

    const creationKey = toDateKeyInBuenosAiresLegacySafe(booking.creation_date);
    const departureKey = toDateKeyInBuenosAiresLegacySafe(booking.departure_date);
    const returnKey = toDateKeyInBuenosAiresLegacySafe(booking.return_date);

    const participants: Array<{
      id_client: number;
      role: "TITULAR" | "ACOMPANANTE";
    }> = [];

    if (clientIdSet.has(booking.titular_id)) {
      participants.push({ id_client: booking.titular_id, role: "TITULAR" });
    }

    booking.clients.forEach((clientRef) => {
      if (!clientIdSet.has(clientRef.id_client)) return;
      if (clientRef.id_client === booking.titular_id) return;
      participants.push({ id_client: clientRef.id_client, role: "ACOMPANANTE" });
    });

    participants.forEach((participant) => {
      if (!shouldIncludeRole(roleFilter, participant.role)) return;

      const summary = summaryByClientId.get(participant.id_client);
      if (!summary) return;

      summary.bookings_total += 1;
      if (participant.role === "TITULAR") summary.bookings_as_titular += 1;
      else summary.bookings_as_companion += 1;

      addMoneyMaps(summary.sale_amounts, sale);
      addMoneyMaps(summary.received_amounts, received);
      addMoneyMaps(summary.debt_amounts, debt);

      if (
        creationKey &&
        (!summary.last_booking_date || creationKey > summary.last_booking_date)
      ) {
        summary.last_booking_date = creationKey;
      }

      if (
        departureKey &&
        departureKey >= todayKey &&
        (!summary.next_travel_date || departureKey < summary.next_travel_date)
      ) {
        summary.next_travel_date = departureKey;
      }

      summary.recent_bookings.push({
        id_booking: booking.id_booking,
        agency_booking_id: booking.agency_booking_id,
        role: participant.role,
        details: booking.details,
        creation_date: creationKey,
        departure_date: departureKey,
        return_date: returnKey,
        sale_amounts: sale,
        received_amounts: received,
        debt_amounts: debt,
      });
    });
  });

  const rows = clients.map<PanelRow>((client) => {
    const summary = summaryByClientId.get(client.id_client) ?? makeEmptyBookingSummary();
    return {
      client: {
        id_client: client.id_client,
        agency_client_id: client.agency_client_id,
        first_name: client.first_name,
        last_name: client.last_name,
        profile_key: client.profile_key,
        id_user: client.id_user,
        user: client.user,
      },
      summary: {
        bookings: {
          ...summary,
          recent_bookings: sortRecentBookings(summary.recent_bookings),
        },
      },
    };
  });

  if (includeEmpty) return rows;
  return rows.filter((row) => row.summary.bookings.bookings_total > 0);
}

function buildKpis(rows: PanelRow[]): PanelKpis {
  const kpis = makeEmptyKpis();
  kpis.clients = rows.length;

  rows.forEach((row) => {
    const bookingSummary = row.summary.bookings;
    if (bookingSummary.bookings_total > 0) kpis.with_activity_clients += 1;

    kpis.bookings_total += bookingSummary.bookings_total;
    kpis.bookings_as_titular += bookingSummary.bookings_as_titular;
    kpis.bookings_as_companion += bookingSummary.bookings_as_companion;

    addMoneyMaps(kpis.sale_amounts, bookingSummary.sale_amounts);
    addMoneyMaps(kpis.received_amounts, bookingSummary.received_amounts);
    addMoneyMaps(kpis.debt_amounts, bookingSummary.debt_amounts);
  });

  return kpis;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PanelResponse | { error: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await getUserFromAuth(req);
  if (!auth?.id_user || !auth.id_agency) {
    return res.status(401).json({ error: "No autenticado o token inválido." });
  }

  try {
    const roleNorm = normalizeRole(auth.role);
    const isLeader = roleNorm === "lider";
    const isSeller = roleNorm === "vendedor";

    const visibilityMode = isLeader
      ? "team"
      : isSeller
        ? await getVisibilityMode(auth.id_agency)
        : "all";

    const ownerId = safeNumber(
      Array.isArray(req.query.ownerId) ? req.query.ownerId[0] : req.query.ownerId,
    );
    const q = String(Array.isArray(req.query.q) ? req.query.q[0] : req.query.q || "").trim();
    const profileKey = String(
      Array.isArray(req.query.profile_key)
        ? req.query.profile_key[0]
        : req.query.profile_key || "",
    )
      .trim()
      .toLowerCase();
    const roleFilter = normalizeRoleInBooking(
      Array.isArray(req.query.role_in_booking)
        ? req.query.role_in_booking[0]
        : req.query.role_in_booking,
    );
    const dateMode = normalizeDateMode(
      Array.isArray(req.query.date_mode)
        ? req.query.date_mode[0]
        : req.query.date_mode,
    );
    const customFilters = normalizeCustomFieldFilters(
      Array.isArray(req.query.custom_filters)
        ? req.query.custom_filters[0]
        : req.query.custom_filters,
    );

    const from = String(
      Array.isArray(req.query.from) ? req.query.from[0] : req.query.from || "",
    ).trim();
    const to = String(
      Array.isArray(req.query.to) ? req.query.to[0] : req.query.to || "",
    ).trim();

    const includeEmpty =
      String(
        Array.isArray(req.query.include_empty)
          ? req.query.include_empty[0]
          : req.query.include_empty || "",
      )
        .trim()
        .toLowerCase() === "true" ||
      String(
        Array.isArray(req.query.include_empty)
          ? req.query.include_empty[0]
          : req.query.include_empty || "",
      )
        .trim() === "1";

    const takeParam = safeNumber(
      Array.isArray(req.query.take) ? req.query.take[0] : req.query.take,
    );
    const take = Math.min(Math.max(takeParam || 24, 1), 100);

    const cursorParam = safeNumber(
      Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor,
    );
    let cursor = typeof cursorParam === "number" && cursorParam > 0 ? cursorParam : undefined;

    const where: Prisma.ClientWhereInput = { id_agency: auth.id_agency };

    if (profileKey && profileKey !== "all") {
      where.profile_key = profileKey;
    }

    let allowedUserIds: number[] | null = null;
    if (visibilityMode === "own") {
      where.id_user = auth.id_user;
    } else if (visibilityMode === "team") {
      const scope = isLeader
        ? await getLeaderScope(auth.id_user, auth.id_agency)
        : await getTeamScope(auth.id_user, auth.id_agency);
      allowedUserIds = scope.userIds.length ? scope.userIds : [auth.id_user];
      where.id_user = { in: allowedUserIds };
    }

    if (visibilityMode === "all") {
      if (ownerId && ownerId > 0) where.id_user = ownerId;
    } else if (visibilityMode === "team") {
      if (ownerId && ownerId > 0 && allowedUserIds?.includes(ownerId)) {
        where.id_user = ownerId;
      }
    }

    if (q) {
      const numericQ = safeNumber(q);
      where.OR = [
        { first_name: { contains: q, mode: "insensitive" } },
        { last_name: { contains: q, mode: "insensitive" } },
        { company_name: { contains: q, mode: "insensitive" } },
        { dni_number: { contains: q, mode: "insensitive" } },
        { passport_number: { contains: q, mode: "insensitive" } },
        { tax_id: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { locality: { contains: q, mode: "insensitive" } },
        ...(numericQ ? [{ id_client: numericQ }, { agency_client_id: numericQ }] : []),
      ];
    }

    const batchSize = Math.min(100, Math.max(take * 3, 50));
    const collected: PanelRow[] = [];
    let exhausted = false;

    while (collected.length < take + 1 && !exhausted) {
      const rawClients = await prisma.client.findMany({
        where,
        select: {
          id_client: true,
          agency_client_id: true,
          first_name: true,
          last_name: true,
          profile_key: true,
          custom_fields: true,
          id_user: true,
          user: {
            select: {
              id_user: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { id_client: "desc" },
        take: batchSize + 1,
        ...(cursor ? { cursor: { id_client: cursor }, skip: 1 } : {}),
      });

      if (rawClients.length === 0) {
        exhausted = true;
        break;
      }

      const hasMoreBatch = rawClients.length > batchSize;
      const batchClients = (hasMoreBatch ? rawClients.slice(0, batchSize) : rawClients) as ClientLite[];
      const filteredBatchClients = customFilters.length
        ? batchClients.filter((client) =>
            matchesCustomFieldFilters(client.custom_fields, customFilters),
          )
        : batchClients;

      cursor = batchClients[batchClients.length - 1]?.id_client;
      if (!hasMoreBatch) exhausted = true;

      if (!filteredBatchClients.length) continue;

      const rows = await buildRowsForClients(
        auth.id_agency,
        filteredBatchClients,
        roleFilter,
        dateMode,
        from,
        to,
        includeEmpty,
      );

      collected.push(...rows);
    }

    const items = collected.slice(0, take);
    const hasMore = collected.length > take || !exhausted;
    const nextCursor = hasMore && items.length
      ? items[items.length - 1]!.client.id_client
      : null;

    return res.status(200).json({
      items,
      nextCursor,
      kpis: buildKpis(items),
    });
  } catch (error) {
    console.error("[clients/panel][GET]", error);
    return res
      .status(500)
      .json({ error: "No se pudo cargar el panel de pasajeros." });
  }
}
