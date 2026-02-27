// src/pages/api/bookings/[id].ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { decodePublicId, encodePublicId } from "@/lib/publicIds";
import { ensureAgencyCounterAtLeast } from "@/lib/agencyCounters";
import { parseDateInputInBuenosAires } from "@/lib/buenosAiresDate";
import { jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import { getBookingComponentGrants } from "@/lib/accessControl";
import {
  canAccessBookingOwnerByVisibility,
  getBookingLeaderScope,
} from "@/lib/bookingVisibility";
import { canAccessBookingComponent, normalizeRole } from "@/utils/permissions";
import { normalizeCommissionOverrides } from "@/utils/commissionOverrides";

/* ================== Tipos ================== */
type DecodedUser = {
  id_user?: number;
  role?: string;
  id_agency?: number;
  email?: string;
};

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

/* ================== Constantes ================== */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");
const AGENCY_BOOKING_ID_DUPLICATE_ERROR = "AGENCY_BOOKING_ID_DUPLICATE";
const BOOKING_MANUAL_ENABLED_KEY = "booking_manual_enabled";

/* ================== Helpers comunes ================== */
function getTokenFromRequest(req: NextApiRequest): string | null {
  // 1) cookie "token"
  if (req.cookies?.token) return req.cookies.token;

  // 2) Authorization: Bearer
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  // 3) otros posibles nombres de cookie
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

    // Completar por email si falta id_user
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

    // Completar agencia si falta
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

async function isSimpleCompanionsEnabled(id_agency: number) {
  const cfg = await prisma.clientConfig.findUnique({
    where: { id_agency },
    select: { use_simple_companions: true },
  });
  return Boolean(cfg?.use_simple_companions);
}

function toLocalDate(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}

function normalizeSaleTotals(
  input: unknown,
): Record<string, number> | null {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [keyRaw, val] of Object.entries(obj)) {
    const key = String(keyRaw || "").toUpperCase().trim();
    if (!key) continue;
    const n =
      typeof val === "number"
        ? val
        : Number(String(val).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return null;
    out[key] = n;
  }
  return out;
}

function parseNullableBool(input: unknown): boolean | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input === "boolean") return input;
  if (typeof input === "number") {
    if (input === 1) return true;
    if (input === 0) return false;
    return undefined;
  }
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (["1", "true", "t", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "f", "no", "n", "off"].includes(normalized))
      return false;
    if (["null", ""].includes(normalized)) return null;
  }
  return undefined;
}

type CommissionValidationResult = {
  value:
    | ReturnType<typeof normalizeCommissionOverrides>
    | null
    | undefined;
  error?: string;
  status?: number;
};

async function normalizeAndValidateCommissionOverrides(args: {
  commission_overrides: unknown;
  role: string;
  authAgencyId: number;
  existing: { id_booking: number; id_user: number; creation_date: Date };
}): Promise<CommissionValidationResult> {
  const { commission_overrides, role, authAgencyId, existing } = args;
  if (commission_overrides === undefined) return { value: undefined };

  const canEditCommission = ["gerente", "administrativo", "desarrollador"].includes(
    role,
  );
  if (!canEditCommission) {
    return {
      error: "Sin permisos para modificar comisiones.",
      status: 403,
      value: undefined,
    };
  }

  if (commission_overrides === null) return { value: null };

  const normalized = normalizeCommissionOverrides(commission_overrides);
  const rawIsObject =
    !!commission_overrides &&
    typeof commission_overrides === "object" &&
    !Array.isArray(commission_overrides);

  if (!normalized) {
    if (rawIsObject && Object.keys(commission_overrides as object).length) {
      return { error: "Comisiones inválidas.", status: 400, value: undefined };
    }
    return { value: null };
  }

  const ruleSets = await prisma.commissionRuleSet.findMany({
    where: {
      id_agency: authAgencyId,
      owner_user_id: existing.id_user,
    },
    include: { shares: true },
    orderBy: { valid_from: "asc" },
  });

  const createdAt = existing.creation_date;
  let chosen: (typeof ruleSets)[number] | null = ruleSets[0] ?? null;
  for (const r of ruleSets) {
    if (r.valid_from <= createdAt) chosen = r;
    else break;
  }
  if (chosen && chosen.valid_from > createdAt) chosen = null;

  const leaderIds = (chosen?.shares || []).map((s) =>
    Number(s.beneficiary_user_id),
  );
  const leaderSet = new Set(leaderIds.map((id) => String(id)));

  if (normalized.service) {
    const serviceIds = Object.keys(normalized.service)
      .map((k) => Number(k))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (serviceIds.length > 0) {
      const existingServices = await prisma.service.findMany({
        where: {
          id_service: { in: serviceIds },
          booking_id: existing.id_booking,
        },
        select: { id_service: true },
      });
      const existingSet = new Set(
        existingServices.map((s) => s.id_service),
      );
      if (existingSet.size !== serviceIds.length) {
        return {
          error: "Servicio inválido en comisión personalizada.",
          status: 400,
          value: undefined,
        };
      }
    }
  }

  const validateScope = (
    scope:
      | {
          sellerPct?: number | null;
          leaders?: Record<string, number>;
        }
      | undefined,
    label: string,
  ) => {
    if (!scope) return;
    if (typeof scope.sellerPct !== "number") {
      throw new Error(`Falta el % del vendedor (${label}).`);
    }
    if (scope.sellerPct < 0 || scope.sellerPct > 100) {
      throw new Error(`% del vendedor inválido (${label}).`);
    }
    const leaders = scope.leaders || {};
    for (const key of Object.keys(leaders)) {
      if (!leaderSet.has(String(key))) {
        throw new Error(`Líder inválido (${label}).`);
      }
      const pct = leaders[key];
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error(`% de líder inválido (${label}).`);
      }
    }
    if (leaderIds.length > 0) {
      for (const id of leaderIds) {
        if (!(String(id) in leaders)) {
          throw new Error(`Falta % para líderes (${label}).`);
        }
      }
    }
    const sum = Object.values(leaders).reduce(
      (acc, val) => acc + Number(val || 0),
      scope.sellerPct,
    );
    if (sum > 100.0001) {
      throw new Error(
        `La suma de porcentajes no puede superar 100% (${label}).`,
      );
    }
  };

  try {
    validateScope(normalized.booking, "reserva");
    if (normalized.currency) {
      for (const [cur, scope] of Object.entries(normalized.currency)) {
        validateScope(scope, `moneda ${cur}`);
      }
    }
    if (normalized.service) {
      for (const [sid, scope] of Object.entries(normalized.service)) {
        validateScope(scope, `servicio ${sid}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Comisiones inválidas.";
    return { error: msg, status: 400, value: undefined };
  }

  return { value: normalized };
}

/* ================== Handler ================== */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { id } = req.query;
  if (!id || Array.isArray(id)) {
    return res.status(400).json({ error: "N° de reserva inválido." });
  }
  const rawId = String(id);
  const bookingId = Number(rawId);
  const decoded =
    Number.isFinite(bookingId) && bookingId > 0
      ? null
      : decodePublicId(rawId);
  if (decoded && decoded.t !== "booking") {
    return res.status(400).json({ error: "N° de reserva inválido." });
  }

  // auth
  const auth = await getUserFromAuth(req);
  const roleFromCookie = normalizeRole(req.cookies?.role || "");
  const role = normalizeRole(auth?.role || roleFromCookie || "");
  const authUserId = auth?.id_user;
  const authAgencyId = auth?.id_agency;

  if (!authUserId || !authAgencyId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  // Traer la reserva para validar alcance/agencia
  if (decoded && decoded.a !== authAgencyId) {
    return res.status(404).json({ error: "Reserva no encontrada." });
  }

  const existing = await prisma.booking.findFirst({
    where: decoded
      ? { id_agency: authAgencyId, agency_booking_id: decoded.i }
      : { id_booking: bookingId },
    include: {
      user: true,
      simple_companions: { select: { id_companion: true } },
    },
  });
  if (!existing) {
    return res.status(404).json({ error: "Reserva no encontrada." });
  }
  if (existing.id_agency !== authAgencyId) {
    return res.status(403).json({ error: "No autorizado para esta agencia." });
  }

  const canAccessBooking = await canAccessBookingOwnerByVisibility({
    id_user: authUserId,
    id_agency: authAgencyId,
    role,
    owner_user_id: existing.id_user,
  });
  if (!canAccessBooking) {
    return res.status(403).json({ error: "No autorizado para esta reserva." });
  }

  // Reglas de lectura/alcance por rol
  if (req.method === "GET") {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id_booking: existing.id_booking },
        include: {
          titular: true,
          user: true,
          agency: true,
          clients: true,
          simple_companions: { include: { category: true } },
          services: { include: { operator: true } },
          invoices: true,
          Receipt: { include: { service_allocations: true } },
        },
      });
      const public_id =
        booking?.agency_booking_id != null
          ? encodePublicId({
              t: "booking",
              a: booking.id_agency,
              i: booking.agency_booking_id,
            })
          : null;
      return res.status(200).json(
        booking
          ? {
              ...booking,
              public_id,
            }
          : booking,
      );
    } catch (error) {
      console.error(
        "[bookings][GET by id] Error:",
        error instanceof Error ? error.message : error,
      );
      return res.status(500).json({ error: "Error al obtener la reserva." });
    }
  }

  if (req.method === "PATCH") {
    const {
      commission_overrides,
      sale_totals,
      use_booking_sale_total_override,
    } = req.body ?? {};

    if (
      commission_overrides === undefined &&
      sale_totals === undefined &&
      use_booking_sale_total_override === undefined
    ) {
      return res.status(400).json({
        error:
          "Debés enviar al menos uno de estos campos: commission_overrides, sale_totals, use_booking_sale_total_override.",
      });
    }

    const canEditSaleMode = ["gerente", "administrativo", "desarrollador"].includes(
      role,
    );

    let normalizedSaleTotals:
      | Record<string, number>
      | null
      | undefined = undefined;
    if (sale_totals !== undefined) {
      if (sale_totals === null) {
        normalizedSaleTotals = null;
      } else {
        const normalized = normalizeSaleTotals(sale_totals);
        if (normalized == null) {
          return res.status(400).json({
            error: "sale_totals inválido (espera objeto {MONEDA: monto})",
          });
        }
        normalizedSaleTotals = normalized;
      }
    }

    const parsedSaleTotalOverride = parseNullableBool(
      use_booking_sale_total_override,
    );
    if (
      use_booking_sale_total_override !== undefined &&
      parsedSaleTotalOverride === undefined
    ) {
      return res.status(400).json({
        error:
          "use_booking_sale_total_override inválido (acepta true/false/null).",
      });
    }
    if (
      use_booking_sale_total_override !== undefined &&
      !canEditSaleMode
    ) {
      return res.status(403).json({
        error: "Sin permisos para modificar venta total por reserva.",
      });
    }

    let normalizedCommissionOverrides:
      | ReturnType<typeof normalizeCommissionOverrides>
      | null
      | undefined = undefined;
    if (commission_overrides !== undefined) {
      const commissionValidation =
        await normalizeAndValidateCommissionOverrides({
          commission_overrides,
          role,
          authAgencyId,
          existing,
        });
      if (commissionValidation.error) {
        return res
          .status(commissionValidation.status ?? 400)
          .json({ error: commissionValidation.error });
      }
      normalizedCommissionOverrides = commissionValidation.value;
      if (normalizedCommissionOverrides === undefined) {
        return res.status(400).json({ error: "Comisiones inválidas." });
      }
    }

    try {
      const booking = await prisma.booking.update({
        where: { id_booking: existing.id_booking },
        data: {
          ...(normalizedCommissionOverrides !== undefined
            ? {
                commission_overrides:
                  normalizedCommissionOverrides === null
                    ? Prisma.DbNull
                    : normalizedCommissionOverrides,
              }
            : {}),
          ...(normalizedSaleTotals !== undefined
            ? {
                sale_totals:
                  normalizedSaleTotals === null
                    ? Prisma.DbNull
                    : normalizedSaleTotals,
              }
            : {}),
          ...(parsedSaleTotalOverride !== undefined
            ? { use_booking_sale_total_override: parsedSaleTotalOverride }
            : {}),
        },
        include: {
          titular: true,
          user: true,
          agency: true,
          clients: true,
          simple_companions: { include: { category: true } },
        },
      });
      return res.status(200).json(booking);
    } catch (error) {
      console.error(
        "[bookings][PATCH] Error:",
        error instanceof Error ? error.message : error,
      );
      return res.status(500).json({ error: "Error actualizando la reserva." });
    }
  }

  if (req.method === "PUT") {
    const {
      clientStatus,
      operatorStatus,
      status,
      details,
      invoice_type,
      invoice_observation,
      observation,
      titular_id,
      departure_date,
      return_date,
      sale_totals,
      use_booking_sale_total_override,
      commission_overrides,
      // pax_count (se recalcula abajo, no se usa del body)
      clients_ids,
      simple_companions,
      id_user, // opcional: reasignar creador
      creation_date, // opcional: setear fecha de creación
      agency_booking_id, // opcional: cambiar número de reserva manualmente
    } = req.body ?? {};

    // Validación mínima
    if (
      !clientStatus ||
      !operatorStatus ||
      !status ||
      !details ||
      !invoice_type ||
      !titular_id ||
      !departure_date ||
      !return_date
    ) {
      return res.status(400).json({
        error: "Todos los campos obligatorios deben ser completados.",
      });
    }

    let normalizedSaleTotals:
      | Record<string, number>
      | null
      | undefined = undefined;
    if (sale_totals !== undefined) {
      if (sale_totals === null) {
        normalizedSaleTotals = null;
      } else {
        const normalized = normalizeSaleTotals(sale_totals);
        if (normalized == null) {
          return res.status(400).json({
            error: "sale_totals inválido (espera objeto {MONEDA: monto})",
          });
        }
        normalizedSaleTotals = normalized;
      }
    }
    const saleTotalsValue =
      normalizedSaleTotals === null ? Prisma.DbNull : normalizedSaleTotals;

    const parsedSaleTotalOverride = parseNullableBool(
      use_booking_sale_total_override,
    );
    if (
      use_booking_sale_total_override !== undefined &&
      parsedSaleTotalOverride === undefined
    ) {
      return res.status(400).json({
        error:
          "use_booking_sale_total_override inválido (acepta true/false/null).",
      });
    }
    if (
      use_booking_sale_total_override !== undefined &&
      !["gerente", "administrativo", "desarrollador"].includes(role)
    ) {
      return res.status(403).json({
        error: "Sin permisos para modificar venta total por reserva.",
      });
    }

    const commissionValidation = await normalizeAndValidateCommissionOverrides({
      commission_overrides,
      role,
      authAgencyId,
      existing,
    });
    if (commissionValidation.error) {
      return res
        .status(commissionValidation.status ?? 400)
        .json({ error: commissionValidation.error });
    }
    const normalizedCommissionOverrides = commissionValidation.value;

    const bookingGrants = await getBookingComponentGrants(
      authAgencyId,
      authUserId,
    );
    const canEditStatus = canAccessBookingComponent(
      role,
      bookingGrants,
      "booking_status",
    );
    const nextStatus = String(status ?? "").trim();
    const currentStatus = String(existing.status ?? "").trim();
    if (!canEditStatus && nextStatus !== currentStatus) {
      return res
        .status(403)
        .json({ error: "Sin permisos para modificar el estado." });
    }

    const hasRequestedAgencyBookingId = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "agency_booking_id",
    );
    const requestedAgencyBookingId = hasRequestedAgencyBookingId
      ? Number(agency_booking_id)
      : undefined;
    if (
      hasRequestedAgencyBookingId &&
      (requestedAgencyBookingId == null ||
        !Number.isInteger(requestedAgencyBookingId) ||
        requestedAgencyBookingId <= 0)
    ) {
      return res.status(400).json({
        error: "El número de reserva de agencia debe ser un entero mayor a 0.",
      });
    }
    const shouldChangeAgencyBookingId =
      requestedAgencyBookingId != null &&
      requestedAgencyBookingId !== existing.agency_booking_id;
    if (shouldChangeAgencyBookingId) {
      const manualFlag = await prisma.agencyCounter.findUnique({
        where: {
          id_agency_key: {
            id_agency: authAgencyId,
            key: BOOKING_MANUAL_ENABLED_KEY,
          },
        },
        select: { next_value: true },
      });
      if (Number(manualFlag?.next_value) !== 1) {
        return res.status(403).json({
          error: "La carga manual de número de reserva está deshabilitada.",
        });
      }
    }

    try {
      // ===== Acompañantes: sanitizar placeholders, evitar duplicados y conflicto con titular
      const companions: number[] = Array.isArray(clients_ids)
        ? clients_ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)
        : [];

      if (companions.includes(Number(titular_id))) {
        return res.status(400).json({
          error: "El titular no puede estar en la lista de acompañantes.",
        });
      }

      const uniqueClients = new Set(companions);
      if (uniqueClients.size !== companions.length) {
        return res
          .status(400)
          .json({ error: "IDs duplicados en los acompañantes." });
      }

      // Verificar existencia de todos los IDs en la misma agencia
      const allClientIds = [Number(titular_id), ...companions];
      const existingClients = await prisma.client.findMany({
        where: { id_client: { in: allClientIds }, id_agency: authAgencyId },
        select: { id_client: true },
      });
      const okIds = new Set(existingClients.map((c) => c.id_client));
      const missingIds = allClientIds.filter((id: number) => !okIds.has(id));
      if (missingIds.length > 0) {
        return res
          .status(400)
          .json({ error: `IDs no válidos: ${missingIds.join(", ")}` });
      }

      const allowSimpleCompanions = await isSimpleCompanionsEnabled(authAgencyId);
      const shouldUpdateSimpleCompanions =
        allowSimpleCompanions && simple_companions !== undefined;
      const currentSimpleCount = Array.isArray(existing.simple_companions)
        ? existing.simple_companions.length
        : 0;

      const simpleCompanionsRaw = shouldUpdateSimpleCompanions
        ? Array.isArray(simple_companions)
          ? simple_companions
          : []
        : [];
      const simpleCompanions = simpleCompanionsRaw
        .map((c) => {
          if (!c || typeof c !== "object") return null;
          const rec = c as Record<string, unknown>;
          const category_id =
            rec.category_id == null ? null : Number(rec.category_id);
          const age = rec.age == null ? null : Number(rec.age);
          const notes =
            typeof rec.notes === "string" && rec.notes.trim()
              ? rec.notes.trim()
              : null;
          const safeCategory =
            category_id != null && Number.isFinite(category_id) && category_id > 0
              ? Math.floor(category_id)
              : null;
          const safeAge =
            age != null && Number.isFinite(age) && age >= 0
              ? Math.floor(age)
              : null;
          if (safeCategory == null && safeAge == null && !notes) return null;
          return {
            category_id: safeCategory,
            age: safeAge,
            notes,
          };
        })
        .filter(Boolean) as Array<{
        category_id: number | null;
        age: number | null;
        notes: string | null;
      }>;

      if (shouldUpdateSimpleCompanions && simpleCompanions.length > 0) {
        const categoryIds = Array.from(
          new Set(
            simpleCompanions
              .map((c) => c.category_id)
              .filter((id): id is number => typeof id === "number"),
          ),
        );
        if (categoryIds.length > 0) {
          const cats = await prisma.passengerCategory.findMany({
            where: { id_category: { in: categoryIds }, id_agency: authAgencyId },
            select: { id_category: true },
          });
          const ok = new Set(cats.map((c) => c.id_category));
          const bad = categoryIds.filter((id) => !ok.has(id));
          if (bad.length) {
            return res.status(400).json({
              error: `Hay categorías inválidas para tu agencia: ${bad.join(", ")}`,
            });
          }
        }
      }

      // Fechas viaje
      const parsedDeparture = toLocalDate(departure_date);
      const parsedReturn = toLocalDate(return_date);
      if (!parsedDeparture || !parsedReturn) {
        return res.status(400).json({ error: "Fechas inválidas." });
      }

      // ===== Reasignación de creador
      const canAssignOthers = [
        "gerente",
        "administrativo",
        "desarrollador",
        "lider",
      ].includes(role);

      let usedUserId: number = existing.id_user; // default: mantener

      if (typeof id_user === "number" && Number.isFinite(id_user)) {
        if (canAssignOthers) {
          if (role === "lider" && id_user !== authUserId) {
            const scope = await getBookingLeaderScope(authUserId, authAgencyId);
            if (!scope.userIds.includes(id_user)) {
              return res
                .status(403)
                .json({ error: "No podés asignar fuera de tu equipo." });
            }
          }
          // asegurar que el usuario pertenece a la misma agencia
          const targetUser = await prisma.user.findUnique({
            where: { id_user: Number(id_user) },
            select: { id_agency: true },
          });
          if (!targetUser || targetUser.id_agency !== authAgencyId) {
            return res
              .status(400)
              .json({ error: "Usuario asignado inválido para tu agencia." });
          }
          usedUserId = id_user;
        } else {
          // Sin permiso: si es igual al actual lo ignoramos; si es distinto => está intentando reasignar
          if (id_user !== existing.id_user) {
            return res
              .status(403)
              .json({ error: "No autorizado para reasignar usuario." });
          }
        }
      }
      // Si id_user viene vacío/undefined y no hay permiso, simplemente se mantiene el existente

      // ===== Edición de creation_date
      const canEditCreationDate = [
        "gerente",
        "administrativo",
        "desarrollador",
      ].includes(role);

      let parsedCreationDate: Date | undefined = undefined;
      if (creation_date != null && creation_date !== "") {
        if (canEditCreationDate) {
          parsedCreationDate = toLocalDate(creation_date);
          if (!parsedCreationDate) {
            return res.status(400).json({ error: "creation_date inválida." });
          }
        }
        // Si NO tiene permiso, ignoramos silenciosamente creation_date (no 403)
      }

      // pax_count consistente con acompañantes saneados + simples
      const nextSimpleCount = shouldUpdateSimpleCompanions
        ? simpleCompanions.length
        : currentSimpleCount;
      const nextPax = 1 + companions.length + nextSimpleCount;
      const shouldCancelPendingClientPayments =
        String(status || "")
          .trim()
          .toLowerCase() === "cancelada";

      const booking = await prisma.$transaction(async (tx) => {
        if (shouldChangeAgencyBookingId && requestedAgencyBookingId != null) {
          const duplicate = await tx.booking.findFirst({
            where: {
              id_agency: authAgencyId,
              agency_booking_id: requestedAgencyBookingId,
              NOT: { id_booking: existing.id_booking },
            },
            select: { id_booking: true },
          });
          if (duplicate) {
            throw new Error(AGENCY_BOOKING_ID_DUPLICATE_ERROR);
          }
        }

        if (shouldUpdateSimpleCompanions) {
          await tx.bookingCompanion.deleteMany({
            where: { booking_id: existing.id_booking },
          });
          if (simpleCompanions.length > 0) {
            await tx.bookingCompanion.createMany({
              data: simpleCompanions.map((c) => ({
                booking_id: existing.id_booking,
                category_id: c.category_id,
                age: c.age,
                notes: c.notes,
              })),
            });
          }
        }

        const updatedBooking = await tx.booking.update({
          where: { id_booking: existing.id_booking },
          data: {
            clientStatus,
            operatorStatus,
            status,
            details,
            invoice_type,
            invoice_observation,
            observation,
            departure_date: parsedDeparture,
            return_date: parsedReturn,
            pax_count: nextPax,
            ...(parsedCreationDate ? { creation_date: parsedCreationDate } : {}),
            ...(normalizedSaleTotals !== undefined
              ? { sale_totals: saleTotalsValue }
              : {}),
            ...(parsedSaleTotalOverride !== undefined
              ? { use_booking_sale_total_override: parsedSaleTotalOverride }
              : {}),
            ...(normalizedCommissionOverrides !== undefined
              ? {
                  commission_overrides:
                    normalizedCommissionOverrides === null
                      ? Prisma.DbNull
                      : normalizedCommissionOverrides,
                }
              : {}),
            ...(shouldChangeAgencyBookingId && requestedAgencyBookingId != null
              ? { agency_booking_id: requestedAgencyBookingId }
              : {}),
            titular: { connect: { id_client: Number(titular_id) } },
            user: { connect: { id_user: usedUserId } },
            // agency: NO se cambia por body; permanece la del token/existing
            clients: { set: companions.map((cid) => ({ id_client: cid })) },
          },
          include: {
            titular: true,
            user: true,
            agency: true,
            clients: true,
            simple_companions: { include: { category: true } },
          },
        });

        if (shouldChangeAgencyBookingId && requestedAgencyBookingId != null) {
          await ensureAgencyCounterAtLeast(
            tx,
            authAgencyId,
            "booking",
            requestedAgencyBookingId + 1,
          );
        }

        if (shouldCancelPendingClientPayments) {
          const pendingPayments = await tx.clientPayment.findMany({
            where: {
              booking_id: existing.id_booking,
              id_agency: authAgencyId,
              status: "PENDIENTE",
            },
            select: { id_payment: true },
          });

          if (pendingPayments.length > 0) {
            const paymentIds = pendingPayments.map((p) => p.id_payment);
            await tx.clientPayment.updateMany({
              where: { id_payment: { in: paymentIds } },
              data: {
                status: "CANCELADA",
                status_reason: "Reserva cancelada",
              },
            });

            await tx.clientPaymentAudit.createMany({
              data: paymentIds.map((id_payment) => ({
                client_payment_id: id_payment,
                id_agency: authAgencyId,
                action: "AUTO_CANCEL_BOOKING",
                from_status: "PENDIENTE",
                to_status: "CANCELADA",
                reason: "Reserva cancelada",
                changed_by: authUserId,
                data: { booking_id: existing.id_booking },
              })),
            });
          }
        }

        return updatedBooking;
      }, { maxWait: 10000, timeout: 30000 });

      return res.status(200).json(booking);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === AGENCY_BOOKING_ID_DUPLICATE_ERROR
      ) {
        return res
          .status(400)
          .json({ error: "El número de reserva de agencia ya está en uso." });
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res
          .status(400)
          .json({ error: "El número de reserva de agencia ya está en uso." });
      }
      console.error(
        "[bookings][PUT by id] Error:",
        error instanceof Error ? error.message : error,
      );
      return res.status(500).json({ error: "Error actualizando la reserva." });
    }
  }

  if (req.method === "DELETE") {
    // Permisos:
    // - Admin/Gerencia/Dev: siempre pueden eliminar
    // - Líder: si la reserva pertenece a alguien dentro de su equipo
    // - Vendedor: sólo si la reserva es suya
    if (["gerente", "administrativo", "desarrollador"].includes(role)) {
      // ok
    } else if (role === "lider") {
      // ok: alcance ya validado con canAccessBookingOwnerByVisibility
    } else if (role === "vendedor") {
      if (existing.id_user !== authUserId) {
        return res
          .status(403)
          .json({ error: "Sólo podés eliminar tus propias reservas." });
      }
    } else {
      return res.status(403).json({ error: "No autorizado para eliminar." });
    }

    try {
      await prisma.booking.delete({ where: { id_booking: existing.id_booking } });
      return res.status(200).json({ message: "Reserva eliminada con éxito." });
    } catch (error) {
      console.error(
        "[bookings][DELETE by id] Error:",
        error instanceof Error ? error.message : error,
      );
      return res.status(500).json({ error: "Error eliminando la reserva." });
    }
  }

  res.setHeader("Allow", ["GET", "PATCH", "PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
