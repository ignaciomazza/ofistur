import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify, type JWTPayload } from "jose";
import {
  canAccessBookingByRole,
  getFinanceSectionGrants,
} from "@/lib/accessControl";
import { canAccessFinanceSection } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  parseDateInputInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";

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

type PersistedStatus = "PENDIENTE" | "PAGADA" | "CANCELADA";
type DerivedStatus = PersistedStatus | "VENCIDA";

type ClientPaymentsPostBody = {
  bookingId: number;
  clientId: number;
  serviceId?: number | null;
  count?: number;
  amount: number | string;
  currency: string;
  amounts?: Array<number | string>;
  dueDates: string[];
};

const RO_CREATE = new Set([
  "vendedor",
  "administrativo",
  "gerente",
  "desarrollador",
  "lider",
]);

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
      if (u) {
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role,
          email: u.email,
        };
      }
    }

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

    return { id_user, id_agency, role, email };
  } catch {
    return null;
  }
}

function normalizePersistedStatus(v: unknown): PersistedStatus {
  const s = String(v || "").trim().toUpperCase();
  if (s === "PAGADA") return "PAGADA";
  if (s === "CANCELADA") return "CANCELADA";
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

function parseDueDate(input: string): Date | null {
  return parseDateInputInBuenosAires(input);
}

function parseDateStart(input: unknown): Date | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const dateKey = String(input).trim();
  const start = startOfDayUtcFromDateKeyInBuenosAires(dateKey);
  if (start) return start;
  return parseDueDate(dateKey);
}

function parseDateEnd(input: unknown): Date | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const dateKey = String(input).trim();
  const end = endOfDayUtcFromDateKeyInBuenosAires(dateKey);
  if (end) return end;
  return parseDueDate(dateKey);
}

async function ensureBookingInAgency(
  bookingId: number,
  agencyId: number,
): Promise<{ id_booking: number; id_agency: number; id_user: number }> {
  const booking = await prisma.booking.findUnique({
    where: { id_booking: bookingId },
    select: { id_booking: true, id_agency: true, id_user: true },
  });
  if (!booking) throw new Error("La reserva no existe.");
  if (booking.id_agency !== agencyId) {
    throw new Error("La reserva no pertenece a tu agencia.");
  }
  return booking;
}

async function ensureClientInBooking(
  clientId: number,
  bookingId: number,
  agencyId: number,
): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id_booking: bookingId },
    select: {
      id_agency: true,
      titular_id: true,
      clients: { select: { id_client: true } },
    },
  });

  if (!booking) throw new Error("La reserva no existe.");
  if (booking.id_agency !== agencyId) {
    throw new Error("La reserva no pertenece a tu agencia.");
  }

  const allowed = new Set<number>([
    booking.titular_id,
    ...booking.clients.map((c) => c.id_client),
  ]);

  if (!allowed.has(clientId)) {
    throw new Error("El pax no pertenece a la reserva.");
  }
}

async function ensureServiceInBooking(
  serviceId: number,
  bookingId: number,
  agencyId: number,
): Promise<void> {
  const service = await prisma.service.findFirst({
    where: {
      id_service: serviceId,
      booking_id: bookingId,
      id_agency: agencyId,
    },
    select: { id_service: true },
  });

  if (!service) {
    throw new Error("El servicio no pertenece a la reserva.");
  }
}

async function ensureCanUseModule(authUser: Required<DecodedUser>): Promise<void> {
  const planAccess = await ensurePlanFeatureAccess(
    authUser.id_agency,
    "payment_plans",
  );
  if (!planAccess.allowed) {
    throw new Error("PLAN_INSUFICIENTE");
  }
}

async function canAccessFinanceModule(
  authUser: Required<DecodedUser>,
): Promise<boolean> {
  const grants = await getFinanceSectionGrants(
    authUser.id_agency,
    authUser.id_user,
  );
  return canAccessFinanceSection(authUser.role, grants, "payment_plans");
}

async function canAccessBalancesModule(
  authUser: Required<DecodedUser>,
): Promise<boolean> {
  const grants = await getFinanceSectionGrants(
    authUser.id_agency,
    authUser.id_user,
  );
  return canAccessFinanceSection(authUser.role, grants, "balances");
}

async function canAccessBookingScope(
  authUser: Required<DecodedUser>,
  booking: { id_user: number; id_agency: number },
): Promise<boolean> {
  return canAccessBookingByRole(authUser, booking);
}

function mapPaymentWithDerived<T extends { status: string; due_date: Date }>(
  payment: T,
): T & {
  status: PersistedStatus;
  derived_status: DerivedStatus;
  is_overdue: boolean;
} {
  const status = normalizePersistedStatus(payment.status);
  const { derivedStatus, isOverdue } = deriveStatus(status, payment.due_date);
  return {
    ...payment,
    status,
    derived_status: derivedStatus,
    is_overdue: isOverdue,
  };
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authUserRaw = await getUserFromAuth(req);
    const authUser = authUserRaw as Required<DecodedUser> | null;

    if (!authUser?.id_user || !authUser?.id_agency || !authUser?.role) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const context = String(
      Array.isArray(req.query.context) ? req.query.context[0] : req.query.context || "",
    )
      .trim()
      .toLowerCase();
    const balancesContext = context === "balances";

    if (balancesContext) {
      const [balancesAccess, paymentPlansAccess] = await Promise.all([
        ensurePlanFeatureAccess(authUser.id_agency, "balances"),
        ensurePlanFeatureAccess(authUser.id_agency, "payment_plans"),
      ]);
      if (!balancesAccess.allowed && !paymentPlansAccess.allowed) {
        return res.status(403).json({ error: "Plan insuficiente" });
      }
    } else {
      await ensureCanUseModule(authUser);
    }

    const bookingId = Number(
      Array.isArray(req.query.bookingId)
        ? req.query.bookingId[0]
        : req.query.bookingId,
    );

    const include = {
      client: {
        select: {
          id_client: true,
          agency_client_id: true,
          first_name: true,
          last_name: true,
        },
      },
      booking: {
        select: {
          id_booking: true,
          agency_booking_id: true,
          details: true,
          status: true,
          id_user: true,
        },
      },
      service: {
        select: {
          id_service: true,
          agency_service_id: true,
          description: true,
          type: true,
        },
      },
      receipt: {
        select: {
          id_receipt: true,
          receipt_number: true,
          issue_date: true,
          amount: true,
          amount_currency: true,
        },
      },
    } satisfies Prisma.ClientPaymentInclude;

    if (Number.isFinite(bookingId) && bookingId > 0) {
      const booking = await ensureBookingInAgency(bookingId, authUser.id_agency);
      const canFinance = await canAccessFinanceModule(authUser);
      const canBalances = balancesContext
        ? await canAccessBalancesModule(authUser)
        : false;
      const canBooking = await canAccessBookingScope(authUser, booking);

      if (!canFinance && !canBalances && !canBooking) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      const payments = await prisma.clientPayment.findMany({
        where: { booking_id: bookingId, id_agency: authUser.id_agency },
        orderBy: [{ due_date: "asc" }, { id_payment: "asc" }],
        include,
      });

      return res.status(200).json({
        payments: payments.map((payment) => mapPaymentWithDerived(payment)),
      });
    }

    const canFinance = await canAccessFinanceModule(authUser);
    const canBalances = balancesContext
      ? await canAccessBalancesModule(authUser)
      : false;
    if (!canFinance && !canBalances) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    const takeRaw = Number(
      Array.isArray(req.query.take) ? req.query.take[0] : req.query.take,
    );
    const take = Math.max(1, Math.min(200, Number.isFinite(takeRaw) ? takeRaw : 80));

    const cursorRaw = Number(
      Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor,
    );

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

    const clientId = Number(
      Array.isArray(req.query.clientId) ? req.query.clientId[0] : req.query.clientId,
    );
    const serviceId = Number(
      Array.isArray(req.query.serviceId)
        ? req.query.serviceId[0]
        : req.query.serviceId,
    );
    const filterBookingId = Number(
      Array.isArray(req.query.bookingId) ? req.query.bookingId[0] : req.query.bookingId,
    );

    const dueFrom = parseDateStart(
      Array.isArray(req.query.dueFrom) ? req.query.dueFrom[0] : req.query.dueFrom,
    );
    const dueTo = parseDateEnd(
      Array.isArray(req.query.dueTo) ? req.query.dueTo[0] : req.query.dueTo,
    );

    const where: Prisma.ClientPaymentWhereInput = {
      id_agency: authUser.id_agency,
    };

    if (Number.isFinite(cursorRaw) && cursorRaw > 0) {
      where.id_payment = { lt: cursorRaw };
    }

    if (Number.isFinite(filterBookingId) && filterBookingId > 0) {
      where.booking_id = filterBookingId;
    }

    if (Number.isFinite(clientId) && clientId > 0) {
      where.client_id = clientId;
    }

    if (Number.isFinite(serviceId) && serviceId > 0) {
      where.service_id = serviceId;
    }

    if (currency) {
      where.currency = currency;
    }

    if (dueFrom || dueTo) {
      where.due_date = {
        ...(dueFrom ? { gte: dueFrom } : {}),
        ...(dueTo ? { lte: dueTo } : {}),
      };
    }

    const todayStart =
      startOfDayUtcFromDateKeyInBuenosAires(todayDateKeyInBuenosAires()) ??
      new Date();

    if (statusFilter === "PAGADA" || statusFilter === "CANCELADA" || statusFilter === "PENDIENTE") {
      where.status = statusFilter;
    } else if (statusFilter === "VENCIDA") {
      where.status = "PENDIENTE";
      const dueFilterBase =
        where.due_date &&
        typeof where.due_date === "object" &&
        !Array.isArray(where.due_date)
          ? (where.due_date as Prisma.DateTimeFilter)
          : {};
      where.due_date = {
        ...dueFilterBase,
        lt: todayStart,
      };
    }

    if (q) {
      const maybeNumber = Number(q);
      where.OR = [
        { client: { first_name: { contains: q, mode: "insensitive" } } },
        { client: { last_name: { contains: q, mode: "insensitive" } } },
        { booking: { details: { contains: q, mode: "insensitive" } } },
        ...(Number.isFinite(maybeNumber)
          ? [
              { id_payment: maybeNumber },
              { agency_client_payment_id: maybeNumber },
              { booking: { agency_booking_id: maybeNumber } },
            ]
          : []),
      ];
    }

    const rows = await prisma.clientPayment.findMany({
      where,
      take: take + 1,
      orderBy: [{ id_payment: "desc" }],
      include,
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.id_payment ?? null : null;

    return res.status(200).json({
      items: items.map((payment) => mapPaymentWithDerived(payment)),
      nextCursor,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Error obteniendo cuotas";
    if (msg === "PLAN_INSUFICIENTE") {
      return res.status(403).json({ error: "Plan insuficiente" });
    }
    return res.status(500).json({ error: msg });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authUserRaw = await getUserFromAuth(req);
    const authUser = authUserRaw as Required<DecodedUser> | null;

    if (!authUser?.id_user || !authUser?.id_agency || !authUser?.role) {
      return res.status(401).json({ error: "No autenticado" });
    }

    await ensureCanUseModule(authUser);

    const role = String(authUser.role || "").toLowerCase();
    if (!RO_CREATE.has(role)) {
      return res
        .status(403)
        .json({ error: "No autorizado a crear cuotas del pax." });
    }

    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "Body inválido o vacío" });
    }

    const { bookingId, clientId, serviceId, count = 1, amount, currency, amounts, dueDates } =
      req.body as ClientPaymentsPostBody;

    const bId = Number(bookingId);
    const cId = Number(clientId);
    const sId =
      serviceId === null || serviceId === undefined ? undefined : Number(serviceId);

    if (!Number.isFinite(bId) || bId <= 0) {
      return res.status(400).json({ error: "bookingId es requerido" });
    }
    if (!Number.isFinite(cId) || cId <= 0) {
      return res.status(400).json({ error: "clientId es requerido" });
    }

    const booking = await ensureBookingInAgency(bId, authUser.id_agency);
    const canFinance = await canAccessFinanceModule(authUser);
    const canBooking = await canAccessBookingScope(authUser, booking);

    if (!canFinance && !canBooking) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    await ensureClientInBooking(cId, bId, authUser.id_agency);

    if (Number.isFinite(sId) && (sId as number) > 0) {
      await ensureServiceInBooking(Number(sId), bId, authUser.id_agency);
    }

    if (amount === undefined || amount === null || amount === "") {
      return res.status(400).json({ error: "amount es requerido" });
    }

    if (!currency || typeof currency !== "string") {
      return res.status(400).json({ error: "currency es requerido" });
    }

    const hasAmounts = Array.isArray(amounts);
    const n = hasAmounts
      ? (amounts as unknown[]).length
      : Math.max(1, Number(count || 1));

    if (!Array.isArray(dueDates) || dueDates.length !== n) {
      return res.status(400).json({
        error: "Debés enviar dueDates con exactamente una fecha por cuota.",
      });
    }

    const dueDatesParsed: Date[] = [];
    for (let i = 0; i < n; i++) {
      const parsed = parseDueDate(dueDates[i]);
      if (!parsed) {
        return res.status(400).json({
          error: `La fecha de la cuota N°${i + 1} es inválida.`,
        });
      }
      dueDatesParsed.push(parsed);
    }

    const cur = currency.trim().toUpperCase();

    let perInstallmentDecimals: Prisma.Decimal[] = [];

    if (hasAmounts) {
      const parsed = (amounts as Array<number | string>).map((x, i) => {
        const d = new Prisma.Decimal(typeof x === "number" ? x : String(x));
        if (d.lte(0)) {
          throw new Error(`Monto de la cuota N°${i + 1} debe ser > 0.`);
        }
        return d.toDecimalPlaces(2);
      });

      const totalFromArray = parsed.reduce(
        (acc, d) => acc.plus(d),
        new Prisma.Decimal(0),
      );
      const totalFromBody = new Prisma.Decimal(
        typeof amount === "number" ? amount : String(amount),
      ).toDecimalPlaces(2);

      const diffCents = totalFromArray
        .minus(totalFromBody)
        .mul(100)
        .abs()
        .toNumber();

      if (diffCents >= 1) {
        return res.status(400).json({
          error: "La suma de los montos por cuota no coincide con el monto total.",
        });
      }

      perInstallmentDecimals = parsed;
    } else {
      const total = new Prisma.Decimal(
        typeof amount === "number" ? amount : String(amount),
      ).toDecimalPlaces(2);

      const totalCents = total.mul(100);
      const base = totalCents.div(n).floor();
      const remainder = totalCents.minus(base.mul(n)).toNumber();

      perInstallmentDecimals = Array.from({ length: n }, (_, i) => {
        const cents = base.plus(i < remainder ? 1 : 0);
        return cents.div(100).toDecimalPlaces(2);
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const items = [];

      for (let i = 0; i < n; i++) {
        const agencyPaymentId = await getNextAgencyCounter(
          tx,
          authUser.id_agency,
          "client_payment",
        );

        const payment = await tx.clientPayment.create({
          data: {
            agency_client_payment_id: agencyPaymentId,
            id_agency: authUser.id_agency,
            booking_id: bId,
            client_id: cId,
            service_id:
              Number.isFinite(sId) && (sId as number) > 0 ? Number(sId) : null,
            amount: perInstallmentDecimals[i],
            currency: cur,
            due_date: dueDatesParsed[i],
            status: "PENDIENTE",
          },
          include: {
            client: {
              select: {
                id_client: true,
                agency_client_id: true,
                first_name: true,
                last_name: true,
              },
            },
            service: {
              select: {
                id_service: true,
                agency_service_id: true,
                description: true,
                type: true,
              },
            },
            booking: {
              select: {
                id_booking: true,
                agency_booking_id: true,
                details: true,
                status: true,
                id_user: true,
              },
            },
          },
        });

        await tx.clientPaymentAudit.create({
          data: {
            client_payment_id: payment.id_payment,
            id_agency: authUser.id_agency,
            action: "CREATED",
            from_status: null,
            to_status: "PENDIENTE",
            reason: "Cuota creada",
            changed_by: authUser.id_user,
            data: {
              amount: payment.amount.toString(),
              currency: payment.currency,
              due_date: payment.due_date.toISOString(),
              service_id: payment.service_id,
            },
          },
        });

        items.push(payment);
      }

      return items;
    });

    return res.status(201).json({
      payments: created.map((payment) => mapPaymentWithDerived(payment)),
      success: true,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Error creando cuotas";
    if (msg === "PLAN_INSUFICIENTE") {
      return res.status(403).json({ error: "Plan insuficiente" });
    }
    return res.status(500).json({ error: msg });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
