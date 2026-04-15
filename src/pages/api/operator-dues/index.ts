// src/pages/api/operator-dues/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify, JWTPayload } from "jose";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  parseDateInputInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";

/** ===== Roles ===== */
const RO_CREATE = new Set([
  "vendedor",
  "administrativo",
  "gerente",
  "desarrollador",
]);

// ========= Tipos =========
type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  email?: string;
};

type DecodedUser = {
  id_user?: number;
  role?: string;
  id_agency?: number;
  email?: string;
};

type OperatorDuePostBody = {
  bookingId: number;
  serviceId: number;
  dueDate: string; // "YYYY-MM-DD" o ISO
  concept: string;
  status: string; // "Pendiente" | "Pago" (libre)
  amount: number | string; // Decimal(18,2) en DB
  currency: string; // "ARS" | "USD" | libre
};

type PersistedStatus = "PENDIENTE" | "PAGADA" | "CANCELADA";
type DerivedStatus = PersistedStatus | "VENCIDA";

// ========= JWT =========
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
): Promise<DecodedUser | null> {
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
    const role = (p.role || "") as string | undefined;
    const email = p.email;

    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role,
          email: u.email,
        };
    }

    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user,
          id_agency: u.id_agency,
          role: role ?? u.role,
          email: email ?? u.email ?? undefined,
        };
    }

    return { id_user, id_agency, role, email };
  } catch {
    return null;
  }
}

// ========= Helpers =========
const toDec = (v: unknown) =>
  new Prisma.Decimal(typeof v === "number" ? v : String(v));

function toLocalDate(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}

function parseDateStart(input: unknown): Date | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const dateKey = String(input).trim();
  const start = startOfDayUtcFromDateKeyInBuenosAires(dateKey);
  if (start) return start;
  return parseDateInputInBuenosAires(dateKey);
}

function parseDateEnd(input: unknown): Date | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const dateKey = String(input).trim();
  const end = endOfDayUtcFromDateKeyInBuenosAires(dateKey);
  if (end) return end;
  return parseDateInputInBuenosAires(dateKey);
}

function normalizePersistedStatus(v: unknown): PersistedStatus {
  const s = String(v || "").trim().toUpperCase();
  if (s === "PAGADA" || s === "PAGO") return "PAGADA";
  if (s === "CANCELADA" || s === "CANCELADO") return "CANCELADA";
  return "PENDIENTE";
}

function deriveStatus(status: PersistedStatus, dueDate: Date): {
  derivedStatus: DerivedStatus;
  isOverdue: boolean;
} {
  if (status !== "PENDIENTE") {
    return { derivedStatus: status, isOverdue: false };
  }
  const dueKey = toDateKeyInBuenosAiresLegacySafe(dueDate);
  const todayKey = todayDateKeyInBuenosAires();
  const isOverdue = !!dueKey && !!todayKey && dueKey < todayKey;
  return { derivedStatus: isOverdue ? "VENCIDA" : "PENDIENTE", isOverdue };
}

function mapDueWithDerived<T extends { status: string; due_date: Date }>(
  due: T,
): T & {
  status: PersistedStatus;
  derived_status: DerivedStatus;
  is_overdue: boolean;
} {
  const status = normalizePersistedStatus(due.status);
  const { derivedStatus, isOverdue } = deriveStatus(status, due.due_date);
  return {
    ...due,
    status,
    derived_status: derivedStatus,
    is_overdue: isOverdue,
  };
}

async function ensureBookingInAgency(bookingId: number, agencyId: number) {
  const b = await prisma.booking.findUnique({
    where: { id_booking: bookingId },
    select: { id_booking: true, id_agency: true },
  });
  if (!b) throw new Error("La reserva no existe.");
  if (b.id_agency !== agencyId)
    throw new Error("La reserva no pertenece a tu agencia.");
}

async function ensureServiceBelongsToBooking(
  serviceId: number,
  bookingId: number,
) {
  const svc = await prisma.service.findUnique({
    where: { id_service: serviceId },
    select: { booking_id: true },
  });
  if (!svc || svc.booking_id !== bookingId) {
    throw new Error("El servicio no pertenece a la reserva indicada.");
  }
}

async function canAccessGlobalDues(
  authUser: Required<DecodedUser>,
): Promise<boolean> {
  const grants = await getFinanceSectionGrants(
    authUser.id_agency,
    authUser.id_user,
  );
  return (
    canAccessFinanceSection(authUser.role, grants, "balances") ||
    canAccessFinanceSection(authUser.role, grants, "payment_plans")
  );
}

// ========= GET =========
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authUser = await getUserFromAuth(req);
    const authUserId = authUser?.id_user;
    const authAgencyId = authUser?.id_agency;
    if (!authUserId || !authAgencyId)
      return res.status(401).json({ error: "No autenticado" });

    const scope = String(
      Array.isArray(req.query.scope) ? req.query.scope[0] : req.query.scope || "",
    )
      .trim()
      .toLowerCase();

    const bookingIdParam = Number(
      Array.isArray(req.query.bookingId)
        ? req.query.bookingId[0]
        : req.query.bookingId,
    );
    const bookingId =
      Number.isFinite(bookingIdParam) && bookingIdParam > 0 ? bookingIdParam : null;

    if (scope !== "all") {
      if (!bookingId) {
        return res.status(400).json({ error: "bookingId inválido" });
      }

      await ensureBookingInAgency(bookingId, authAgencyId);

      const dues = await prisma.operatorDue.findMany({
        where: { booking_id: bookingId },
        orderBy: [{ due_date: "asc" }, { id_due: "asc" }],
      });

      return res.status(200).json({ dues });
    }

    const [balancesAccess, paymentPlansAccess] = await Promise.all([
      ensurePlanFeatureAccess(authAgencyId, "balances"),
      ensurePlanFeatureAccess(authAgencyId, "payment_plans"),
    ]);
    if (!balancesAccess.allowed && !paymentPlansAccess.allowed) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }

    const authUserRequired = authUser as Required<DecodedUser>;
    const canReadGlobal = await canAccessGlobalDues(authUserRequired);
    if (!canReadGlobal) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    const takeRaw = Number(
      Array.isArray(req.query.take) ? req.query.take[0] : req.query.take,
    );
    const take = Math.max(1, Math.min(200, Number.isFinite(takeRaw) ? takeRaw : 80));

    const cursorRaw = Number(
      Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor,
    );
    const cursor =
      Number.isFinite(cursorRaw) && cursorRaw > 0 ? Math.trunc(cursorRaw) : null;

    const q = String(
      Array.isArray(req.query.q) ? req.query.q[0] : req.query.q || "",
    ).trim();
    const statusFilter = String(
      Array.isArray(req.query.status) ? req.query.status[0] : req.query.status || "ALL",
    )
      .trim()
      .toUpperCase();
    const currency = String(
      Array.isArray(req.query.currency)
        ? req.query.currency[0]
        : req.query.currency || "",
    )
      .trim()
      .toUpperCase();
    const serviceIdRaw = Number(
      Array.isArray(req.query.serviceId)
        ? req.query.serviceId[0]
        : req.query.serviceId,
    );
    const serviceId =
      Number.isFinite(serviceIdRaw) && serviceIdRaw > 0
        ? Math.trunc(serviceIdRaw)
        : null;
    const operatorIdRaw = Number(
      Array.isArray(req.query.operatorId)
        ? req.query.operatorId[0]
        : req.query.operatorId,
    );
    const operatorId =
      Number.isFinite(operatorIdRaw) && operatorIdRaw > 0
        ? Math.trunc(operatorIdRaw)
        : null;
    const dueFrom = parseDateStart(
      Array.isArray(req.query.dueFrom) ? req.query.dueFrom[0] : req.query.dueFrom,
    );
    const dueTo = parseDateEnd(
      Array.isArray(req.query.dueTo) ? req.query.dueTo[0] : req.query.dueTo,
    );

    const andFilters: Prisma.OperatorDueWhereInput[] = [
      { id_agency: authAgencyId },
    ];

    if (cursor) andFilters.push({ id_due: { lt: cursor } });
    if (bookingId) andFilters.push({ booking_id: bookingId });
    if (serviceId) andFilters.push({ service_id: serviceId });
    if (operatorId) andFilters.push({ service: { id_operator: operatorId } });
    if (currency) {
      andFilters.push({
        currency: { equals: currency, mode: "insensitive" },
      });
    }
    if (dueFrom || dueTo) {
      andFilters.push({
        due_date: {
          ...(dueFrom ? { gte: dueFrom } : {}),
          ...(dueTo ? { lte: dueTo } : {}),
        },
      });
    }

    const todayStart =
      startOfDayUtcFromDateKeyInBuenosAires(todayDateKeyInBuenosAires()) ??
      new Date();

    if (statusFilter === "PENDIENTE" || statusFilter === "VENCIDA") {
      andFilters.push({
        status: { equals: "PENDIENTE", mode: "insensitive" },
      });
    } else if (statusFilter === "PAGADA") {
      andFilters.push({
        OR: [
          { status: { equals: "PAGADA", mode: "insensitive" } },
          { status: { equals: "PAGO", mode: "insensitive" } },
        ],
      });
    } else if (statusFilter === "CANCELADA") {
      andFilters.push({
        OR: [
          { status: { equals: "CANCELADA", mode: "insensitive" } },
          { status: { equals: "CANCELADO", mode: "insensitive" } },
        ],
      });
    }

    if (statusFilter === "VENCIDA") {
      andFilters.push({
        due_date: { lt: todayStart },
      });
    }

    if (q) {
      const maybeNumber = Number(q);
      andFilters.push({
        OR: [
          { concept: { contains: q, mode: "insensitive" } },
          { booking: { details: { contains: q, mode: "insensitive" } } },
          { service: { description: { contains: q, mode: "insensitive" } } },
          { service: { operator: { name: { contains: q, mode: "insensitive" } } } },
          ...(Number.isFinite(maybeNumber)
            ? [
                { id_due: maybeNumber },
                { agency_operator_due_id: maybeNumber },
                { booking: { agency_booking_id: maybeNumber } },
                { service: { agency_service_id: maybeNumber } },
              ]
            : []),
        ],
      });
    }

    const where: Prisma.OperatorDueWhereInput =
      andFilters.length === 1 ? andFilters[0] : { AND: andFilters };

    const rows = await prisma.operatorDue.findMany({
      where,
      take: take + 1,
      orderBy: [{ id_due: "desc" }],
      include: {
        booking: {
          select: {
            id_booking: true,
            agency_booking_id: true,
            details: true,
            status: true,
            titular: {
              select: {
                id_client: true,
                agency_client_id: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
        service: {
          select: {
            id_service: true,
            agency_service_id: true,
            description: true,
            type: true,
            operator: {
              select: {
                id_operator: true,
                agency_operator_id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id_due ?? null : null;

    return res.status(200).json({
      items: items.map((due) => mapDueWithDerived(due)),
      nextCursor,
    });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Error obteniendo vencimientos";
    if (msg === "PLAN_INSUFICIENTE") {
      return res.status(403).json({ error: "Plan insuficiente" });
    }
    return res.status(500).json({ error: msg });
  }
}

// ========= POST =========
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authUser = await getUserFromAuth(req);
    const authUserId = authUser?.id_user;
    const authAgencyId = authUser?.id_agency;
    const role = (authUser?.role || "").toLowerCase();
    if (!authUserId || !authAgencyId)
      return res.status(401).json({ error: "No autenticado" });

    // Permisos: vendedores (y superiores) pueden crear
    if (!RO_CREATE.has(role)) {
      return res
        .status(403)
        .json({ error: "No autorizado a crear cuotas al operador." });
    }

    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "Body inválido o vacío" });
    }

    const { bookingId, serviceId, dueDate, concept, status, amount, currency } =
      req.body as OperatorDuePostBody;

    const bId = Number(bookingId);
    const sId = Number(serviceId);
    if (!Number.isFinite(bId))
      return res.status(400).json({ error: "bookingId es requerido" });
    if (!Number.isFinite(sId))
      return res.status(400).json({ error: "serviceId es requerido" });
    if (!concept || typeof concept !== "string")
      return res.status(400).json({ error: "concept es requerido" });
    if (!status || typeof status !== "string")
      return res.status(400).json({ error: "status es requerido" });
    if (amount === undefined || amount === null || amount === "") {
      return res.status(400).json({ error: "amount es requerido" });
    }
    if (!currency || typeof currency !== "string") {
      return res.status(400).json({ error: "currency es requerido" });
    }

    // fecha
    const parsedDue = toLocalDate(dueDate);
    if (!parsedDue) return res.status(400).json({ error: "dueDate inválida" });

    // seguridad
    await ensureBookingInAgency(bId, authAgencyId);
    await ensureServiceBelongsToBooking(sId, bId);

    // validación de monto positivo
    const decAmount = toDec(amount).toDecimalPlaces(2);
    if (decAmount.lte(0)) {
      return res.status(400).json({ error: "El monto debe ser > 0" });
    }

    // crear
    const created = await prisma.$transaction(async (tx) => {
      const agencyDueId = await getNextAgencyCounter(
        tx,
        authAgencyId,
        "operator_due",
      );

      return tx.operatorDue.create({
        data: {
          agency_operator_due_id: agencyDueId,
          id_agency: authAgencyId,
          booking_id: bId,
          service_id: sId,
          due_date: parsedDue,
          concept: concept.trim(),
          status: status.trim(),
          amount: decAmount,
          currency: currency.trim().toUpperCase(),
        },
      });
    });

    return res.status(201).json({ due: created, success: true });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Error creando vencimiento";
    return res.status(500).json({ error: msg });
  }
}

// ========= Router =========
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
