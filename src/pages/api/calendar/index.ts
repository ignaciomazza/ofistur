// src/pages/api/calendar/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { encodePublicId } from "@/lib/publicIds";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { getBookingLeaderScope } from "@/lib/bookingVisibility";
import { normalizeRole } from "@/utils/permissions";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
  todayDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";

/** ====== Auth local al endpoint (sin helpers externos) ====== */
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

type CalendarContext = "operations" | "finance";
type OperationsKind = "trips" | "notes" | "birthdays";
type FinanceKind = "client_payments" | "operator_dues";
type FinanceStatus = "PENDIENTE" | "VENCIDA" | "PAGADA" | "CANCELADA";
type PersistedFinanceStatus = "PENDIENTE" | "PAGADA" | "CANCELADA";
type CalendarScopeMode = "all" | "team" | "own";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

function getTokenFromRequest(req: NextApiRequest): string | null {
  // 1) Cookie "token" (lo más estable en prod)
  if (req.cookies?.token) return req.cookies.token;

  // 2) Authorization: Bearer <token>
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  // 3) Otros nombres de cookie comunes (compat)
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

async function getUserFromAuth(req: NextApiRequest) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return null;

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    // intentar obtener id_user / id_agency directamente del token
    let id_user = Number(p.id_user ?? p.userId ?? p.uid) || undefined;
    let id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    let role = (p.role || "").toString();
    const email = p.email;

    // Completar agency si falta (por id_user)
    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u) {
        id_agency = u.id_agency;
        if (!role) role = u.role;
      }
    }

    // Completar id_user por email si faltara (poco común, pero útil)
    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true },
      });
      if (u) {
        id_user = u.id_user;
        if (!id_agency) id_agency = u.id_agency;
        if (!role) role = u.role;
      }
    }

    if (!id_user || !id_agency) return null;
    return { id_user, id_agency, role };
  } catch {
    return null;
  }
}
/** ============================================================ */

function toDateAtStart(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (isNaN(+d)) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}
function toDateAtEnd(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (isNaN(+d)) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

function toDateAtStartInBuenosAires(v?: string): Date | undefined {
  if (!v) return undefined;
  return startOfDayUtcFromDateKeyInBuenosAires(v) ?? toDateAtStart(v);
}

function toDateAtEndInBuenosAires(v?: string): Date | undefined {
  if (!v) return undefined;
  return endOfDayUtcFromDateKeyInBuenosAires(v) ?? toDateAtEnd(v);
}

function parseCsvValues(input: unknown): string[] {
  if (typeof input !== "string") return [];
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFinanceKinds(input: unknown): Set<FinanceKind> {
  const values = parseCsvValues(input).map((value) => value.toLowerCase());
  const selected = new Set<FinanceKind>();
  for (const value of values) {
    if (value === "client_payments" || value === "clientpayments") {
      selected.add("client_payments");
    }
    if (value === "operator_dues" || value === "operatordues") {
      selected.add("operator_dues");
    }
  }
  if (selected.size === 0) {
    selected.add("client_payments");
    selected.add("operator_dues");
  }
  return selected;
}

function parseOperationsKinds(input: unknown): Set<OperationsKind> {
  const values = parseCsvValues(input).map((value) => value.toLowerCase());
  const selected = new Set<OperationsKind>();
  for (const value of values) {
    if (value === "trips" || value === "viajes") {
      selected.add("trips");
    }
    if (value === "notes" || value === "notas") {
      selected.add("notes");
    }
    if (
      value === "birthdays" ||
      value === "birthday" ||
      value === "cumpleanos" ||
      value === "cumpleaños"
    ) {
      selected.add("birthdays");
    }
  }
  if (selected.size === 0) {
    selected.add("trips");
    selected.add("notes");
  }
  return selected;
}

function parseFinanceStatuses(input: unknown): Set<FinanceStatus> {
  const values = parseCsvValues(input).map((value) => value.toUpperCase());
  const selected = new Set<FinanceStatus>();
  for (const value of values) {
    if (
      value === "PENDIENTE" ||
      value === "VENCIDA" ||
      value === "PAGADA" ||
      value === "CANCELADA"
    ) {
      selected.add(value);
    }
  }

  if (selected.size === 0) {
    selected.add("PENDIENTE");
    selected.add("VENCIDA");
  }
  return selected;
}

function normalizePersistedStatus(raw: unknown): PersistedFinanceStatus {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  if (value === "PAGO" || value === "PAGADA") return "PAGADA";
  if (value === "CANCELADO" || value === "CANCELADA") return "CANCELADA";
  return "PENDIENTE";
}

function deriveFinanceStatus(
  statusRaw: unknown,
  dueDate: Date,
  todayKey: string,
): FinanceStatus {
  const persisted = normalizePersistedStatus(statusRaw);
  if (persisted === "PAGADA") return "PAGADA";
  if (persisted === "CANCELADA") return "CANCELADA";
  const dueKey = toDateKeyInBuenosAiresLegacySafe(dueDate);
  if (dueKey && todayKey && dueKey < todayKey) return "VENCIDA";
  return "PENDIENTE";
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // coherencia con el resto de tu API: solo GET
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // evitar que algún proxy navegue con caché
  res.setHeader("Cache-Control", "no-store");

  try {
    const auth = await getUserFromAuth(req);
    if (!auth?.id_user || !auth.id_agency) {
      return res.status(401).json({ error: "No autenticado o token inválido" });
    }

    const planAccess = await ensurePlanFeatureAccess(auth.id_agency, "calendar");
    if (!planAccess.allowed) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }

    const { id_agency } = auth;
    const normalizedRole = normalizeRole(auth.role);
    const scopeMode: CalendarScopeMode =
      normalizedRole === "gerente" ||
      normalizedRole === "administrativo" ||
      normalizedRole === "desarrollador"
        ? "all"
        : normalizedRole === "lider"
          ? "team"
          : "own";

    // --------- parámetros ---------
    const {
      userId,
      userIds,
      clientStatus,
      from,
      to,
      mode,
      operationsKinds,
      context,
      dueFrom,
      dueTo,
      financeKinds,
      financeStatuses,
    } = req.query;
    const calendarContext: CalendarContext =
      context === "finance" ? "finance" : "operations";
    const selectedOperationsKinds = parseOperationsKinds(operationsKinds);
    const calendarMode =
      typeof mode === "string" && mode === "services" ? "services" : "bookings";

    const baseBookingFilter: Prisma.BookingWhereInput = { id_agency };
    const requestedUserIds =
      typeof userIds === "string"
        ? userIds
            .split(",")
            .map((s) => parseInt(s, 10))
            .filter((n) => Number.isFinite(n))
        : typeof userId === "string"
          ? [parseInt(userId, 10)].filter((n) => Number.isFinite(n))
          : [];

    if (scopeMode === "all") {
      if (requestedUserIds.length === 1) {
        baseBookingFilter.id_user = requestedUserIds[0];
      } else if (requestedUserIds.length > 1) {
        baseBookingFilter.id_user = { in: requestedUserIds };
      }
    } else if (scopeMode === "own") {
      baseBookingFilter.id_user = auth.id_user;
    } else {
      const leaderScope = await getBookingLeaderScope(auth.id_user, id_agency);
      const allowedUserIds =
        leaderScope.userIds.length > 0
          ? leaderScope.userIds
          : [auth.id_user];
      const allowedSet = new Set(allowedUserIds);

      if (requestedUserIds.length > 0) {
        const requestedAllowed = requestedUserIds.filter((id) =>
          allowedSet.has(id),
        );
        if (requestedAllowed.length === 0) {
          baseBookingFilter.id_user = -1;
        } else if (requestedAllowed.length === 1) {
          baseBookingFilter.id_user = requestedAllowed[0];
        } else {
          baseBookingFilter.id_user = { in: requestedAllowed };
        }
      } else {
        // Lider: por defecto ve sus propios datos y puede elegir miembros del equipo.
        baseBookingFilter.id_user = auth.id_user;
      }
    }

    const bookingOperationFilter: Prisma.BookingWhereInput = {
      ...baseBookingFilter,
    };

    // estado de pax (siempre dentro de la agencia)
    if (typeof clientStatus === "string" && clientStatus !== "Todas") {
      bookingOperationFilter.clientStatus = clientStatus;
    }

    // rango por fecha de partida — extremos independientes
    const gte = toDateAtStart(typeof from === "string" ? from : undefined);
    const lte = toDateAtEnd(typeof to === "string" ? to : undefined);
    const bookingDateFilter =
      gte || lte
        ? {
            departure_date: {
              ...(gte ? { gte } : {}),
              ...(lte ? { lte } : {}),
            },
          }
        : {};

    // --------- datos ---------
    const bookingEvents =
      calendarContext === "operations" &&
      selectedOperationsKinds.has("trips") &&
      calendarMode === "bookings"
        ? (
            await prisma.booking.findMany({
              where: { ...bookingOperationFilter, ...bookingDateFilter },
              include: {
                titular: true,
                _count: { select: { services: true } },
              },
            })
          ).map((b) => {
            const publicId =
              b.agency_booking_id != null
                ? encodePublicId({
                    t: "booking",
                    a: b.id_agency,
                    i: b.agency_booking_id,
                  })
                : null;
            return {
              id: `b-${publicId ?? b.id_booking}`,
              title: `${b.titular.first_name} ${b.titular.last_name}`,
              start: b.departure_date,
              extendedProps: {
                kind: "booking",
                bookingPublicId: publicId ?? b.id_booking,
                details: b.details,
                paxCount: b.pax_count,
                clientStatus: b.clientStatus,
                status: b.status,
                servicesCount: b._count.services,
                returnDate: b.return_date,
              },
            };
          })
        : [];

    const serviceEvents =
      calendarContext === "operations" &&
      selectedOperationsKinds.has("trips") &&
      calendarMode === "services"
        ? (
            await prisma.service.findMany({
              where: {
                id_agency,
                ...(gte || lte
                  ? {
                      departure_date: {
                        ...(gte ? { gte } : {}),
                        ...(lte ? { lte } : {}),
                      },
                    }
                  : {}),
                booking: bookingOperationFilter,
              },
              include: {
                booking: {
                  select: {
                    id_booking: true,
                    agency_booking_id: true,
                    clientStatus: true,
                    status: true,
                    pax_count: true,
                    titular: { select: { first_name: true, last_name: true } },
                  },
                },
              },
            })
          ).map((s) => {
            const publicId =
              s.booking.agency_booking_id != null
                ? encodePublicId({
                    t: "booking",
                    a: id_agency,
                    i: s.booking.agency_booking_id,
                  })
                : null;
            return {
              id: `s-${s.id_service}`,
              title: `${s.booking.titular.first_name} ${s.booking.titular.last_name}`,
              start: s.departure_date,
              extendedProps: {
                kind: "service",
                bookingPublicId: publicId ?? s.booking.id_booking,
                bookingId: s.booking.id_booking,
                serviceType: s.type,
                destination: s.destination,
                reference: s.reference,
                description: s.description,
                note: s.note,
                clientStatus: s.booking.clientStatus,
                status: s.booking.status,
                paxCount: s.booking.pax_count,
                returnDate: s.return_date,
              },
            };
          })
        : [];

    if (calendarContext === "finance") {
      const selectedKinds = parseFinanceKinds(financeKinds);
      const selectedStatuses = parseFinanceStatuses(financeStatuses);
      // El calendario financiero opera solo sobre flujos no-grupales.
      const financeBookingFilter: Prisma.BookingWhereInput = {
        ...baseBookingFilter,
        travel_group_id: null,
      };
      const todayKey = todayDateKeyInBuenosAires();
      const fallbackTodayStart = new Date();
      fallbackTodayStart.setUTCHours(0, 0, 0, 0);
      const todayStart =
        startOfDayUtcFromDateKeyInBuenosAires(todayKey) ?? fallbackTodayStart;
      const dueGte = toDateAtStartInBuenosAires(
        typeof dueFrom === "string" ? dueFrom : undefined,
      );
      const dueLte = toDateAtEndInBuenosAires(
        typeof dueTo === "string" ? dueTo : undefined,
      );

      const dueDateFilter =
        dueGte || dueLte
          ? {
              due_date: {
                ...(dueGte ? { gte: dueGte } : {}),
                ...(dueLte ? { lte: dueLte } : {}),
              },
            }
          : {};

      const clientPaymentStatusClauses: Prisma.ClientPaymentWhereInput[] = [];
      if (selectedStatuses.has("PENDIENTE")) {
        clientPaymentStatusClauses.push({
          status: "PENDIENTE",
          ...(todayStart ? { due_date: { gte: todayStart } } : {}),
        });
      }
      if (selectedStatuses.has("VENCIDA")) {
        clientPaymentStatusClauses.push({
          status: "PENDIENTE",
          ...(todayStart ? { due_date: { lt: todayStart } } : {}),
        });
      }
      if (selectedStatuses.has("PAGADA")) {
        clientPaymentStatusClauses.push({ status: "PAGADA" });
      }
      if (selectedStatuses.has("CANCELADA")) {
        clientPaymentStatusClauses.push({ status: "CANCELADA" });
      }

      const clientPaymentEvents =
        selectedKinds.has("client_payments")
          ? (
              await prisma.clientPayment.findMany({
                where: {
                  id_agency,
                  booking: financeBookingFilter,
                  ...dueDateFilter,
                  ...(clientPaymentStatusClauses.length > 0
                    ? { OR: clientPaymentStatusClauses }
                    : {}),
                },
                include: {
                  client: {
                    select: { first_name: true, last_name: true },
                  },
                  booking: {
                    select: {
                      id_booking: true,
                      agency_booking_id: true,
                    },
                  },
                  service: {
                    select: {
                      type: true,
                      description: true,
                    },
                  },
                },
              })
            )
              .map((payment) => {
                const derivedStatus = deriveFinanceStatus(
                  payment.status,
                  payment.due_date,
                  todayKey,
                );
                if (!selectedStatuses.has(derivedStatus)) return null;
                const publicId =
                  payment.booking.agency_booking_id != null
                    ? encodePublicId({
                        t: "booking",
                        a: id_agency,
                        i: payment.booking.agency_booking_id,
                      })
                    : null;
                return {
                  id: `cp-${payment.id_payment}`,
                  title: `${payment.client.first_name} ${payment.client.last_name}`,
                  start: payment.due_date,
                  extendedProps: {
                    kind: "client_payment",
                    bookingPublicId: publicId ?? payment.booking.id_booking,
                    bookingId: payment.booking.id_booking,
                    status: derivedStatus,
                    details: payment.service?.description || undefined,
                    serviceType: payment.service?.type || undefined,
                    amount: Number(payment.amount),
                    currency: payment.currency,
                    paymentId: payment.id_payment,
                    paymentPublicId:
                      payment.agency_client_payment_id ?? payment.id_payment,
                  },
                };
              })
              .filter((event): event is NonNullable<typeof event> => !!event)
          : [];

      const operatorDueEvents =
        selectedKinds.has("operator_dues")
          ? (
              await prisma.operatorDue.findMany({
                where: {
                  id_agency,
                  booking: financeBookingFilter,
                  ...dueDateFilter,
                },
                include: {
                  booking: {
                    select: {
                      id_booking: true,
                      agency_booking_id: true,
                      titular: { select: { first_name: true, last_name: true } },
                    },
                  },
                  service: {
                    select: {
                      type: true,
                      description: true,
                      reference: true,
                    },
                  },
                },
              })
            )
              .map((due) => {
                const derivedStatus = deriveFinanceStatus(
                  due.status,
                  due.due_date,
                  todayKey,
                );
                if (!selectedStatuses.has(derivedStatus)) return null;
                const publicId =
                  due.booking.agency_booking_id != null
                    ? encodePublicId({
                        t: "booking",
                        a: id_agency,
                        i: due.booking.agency_booking_id,
                      })
                    : null;
                return {
                  id: `od-${due.id_due}`,
                  title: `${due.booking.titular.first_name} ${due.booking.titular.last_name}`,
                  start: due.due_date,
                  extendedProps: {
                    kind: "operator_due",
                    bookingPublicId: publicId ?? due.booking.id_booking,
                    bookingId: due.booking.id_booking,
                    details: due.concept,
                    serviceType: due.service.type,
                    description: due.service.description,
                    reference: due.service.reference,
                    status: derivedStatus,
                    amount: Number(due.amount),
                    currency: due.currency,
                    operatorDueId: due.id_due,
                    operatorDuePublicId: due.agency_operator_due_id ?? due.id_due,
                  },
                };
              })
              .filter((event): event is NonNullable<typeof event> => !!event)
          : [];

      return res.status(200).json([...clientPaymentEvents, ...operatorDueEvents]);
    }

    const bookingUserFilter = baseBookingFilter.id_user;
    const noteCreatorUserFilter =
      typeof bookingUserFilter === "number"
        ? { id_user: bookingUserFilter }
        : bookingUserFilter &&
            typeof bookingUserFilter === "object" &&
            "in" in bookingUserFilter &&
            Array.isArray(bookingUserFilter.in) &&
            bookingUserFilter.in.length > 0
          ? { id_user: { in: bookingUserFilter.in } }
          : {};
    const currentDateKey = todayDateKeyInBuenosAires();
    const currentYear =
      Number.parseInt(currentDateKey.slice(0, 4), 10) ||
      new Date().getUTCFullYear();
    const rawBirthdayFromKey =
      typeof from === "string" ? toDateKeyInBuenosAiresLegacySafe(from) : null;
    const rawBirthdayToKey =
      typeof to === "string" ? toDateKeyInBuenosAiresLegacySafe(to) : null;
    const fallbackFromYear =
      Number.parseInt(
        (rawBirthdayToKey ?? `${currentYear}-01-01`).slice(0, 4),
        10,
      ) || currentYear;
    const fallbackToYear =
      Number.parseInt(
        (rawBirthdayFromKey ?? `${currentYear}-12-31`).slice(0, 4),
        10,
      ) || currentYear;
    let birthdayFromKey = rawBirthdayFromKey ?? `${fallbackFromYear}-01-01`;
    let birthdayToKey = rawBirthdayToKey ?? `${fallbackToYear}-12-31`;
    if (birthdayFromKey > birthdayToKey) {
      const aux = birthdayFromKey;
      birthdayFromKey = birthdayToKey;
      birthdayToKey = aux;
    }
    const birthdayFromYear = Number.parseInt(birthdayFromKey.slice(0, 4), 10);
    const birthdayToYear = Number.parseInt(birthdayToKey.slice(0, 4), 10);

    const notes =
      calendarContext === "operations" && selectedOperationsKinds.has("notes")
        ? await prisma.calendarNote.findMany({
            where:
              calendarVisibility === "own"
                ? {
                    creator: { id_agency, id_user: auth.id_user },
                    ...(gte || lte
                      ? {
                          date: {
                            ...(gte ? { gte } : {}),
                            ...(lte ? { lte } : {}),
                          },
                        }
                      : {}),
                  }
                : {
                    creator: {
                      id_agency,
                      ...noteCreatorUserFilter,
                    },
                    ...(gte || lte
                      ? {
                          date: {
                            ...(gte ? { gte } : {}),
                            ...(lte ? { lte } : {}),
                          },
                        }
                      : {}),
                  },
            include: { creator: { select: { first_name: true, last_name: true } } },
          })
        : [];

    const noteEvents =
      calendarContext === "operations" && selectedOperationsKinds.has("notes")
        ? notes.map((n) => ({
            id: `n-${n.id}`,
            title: n.title,
            start: n.date,
            extendedProps: {
              kind: "note",
              content: n.content,
              creator: `${n.creator.first_name} ${n.creator.last_name}`,
            },
          }))
        : [];
    const birthdayEvents =
      calendarContext === "operations" &&
      selectedOperationsKinds.has("birthdays") &&
      Number.isFinite(birthdayFromYear) &&
      Number.isFinite(birthdayToYear)
        ? (
            await prisma.client.findMany({
              where: {
                id_agency,
                ...noteCreatorUserFilter,
                birth_date: { not: null },
              },
              select: {
                id_client: true,
                first_name: true,
                last_name: true,
                birth_date: true,
              },
              orderBy: [{ first_name: "asc" }, { last_name: "asc" }],
            })
          ).flatMap((client) => {
            if (!client.birth_date) return [];
            const birthDateKey = toDateKeyInBuenosAiresLegacySafe(
              client.birth_date,
            );
            if (!birthDateKey) return [];
            const [rawBirthYear, rawBirthMonth, rawBirthDay] = birthDateKey
              .split("-")
              .map((part) => Number.parseInt(part, 10));
            if (
              !Number.isFinite(rawBirthYear) ||
              !Number.isFinite(rawBirthMonth) ||
              !Number.isFinite(rawBirthDay)
            ) {
              return [];
            }
            const events: Array<Record<string, unknown>> = [];
            for (let year = birthdayFromYear; year <= birthdayToYear; year += 1) {
              const adjustedDay =
                rawBirthMonth === 2 && rawBirthDay === 29 && !isLeapYear(year)
                  ? 28
                  : rawBirthDay;
              const occurrenceDateKey = `${year}-${String(rawBirthMonth).padStart(2, "0")}-${String(adjustedDay).padStart(2, "0")}`;
              if (
                occurrenceDateKey < birthdayFromKey ||
                occurrenceDateKey > birthdayToKey
              ) {
                continue;
              }
              const turningAge = year - rawBirthYear;
              events.push({
                id: `bd-${client.id_client}-${year}`,
                title: `${client.first_name} ${client.last_name}`,
                start: occurrenceDateKey,
                extendedProps: {
                  kind: "birthday",
                  clientId: client.id_client,
                  birthDate: birthDateKey,
                  turningAge: turningAge >= 0 ? turningAge : undefined,
                },
              });
            }
            return events;
          })
        : [];

    return res
      .status(200)
      .json([...bookingEvents, ...serviceEvents, ...noteEvents, ...birthdayEvents]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error interno";
    return res.status(500).json({ error: msg });
  }
}
