// src/pages/api/clients/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { getNextAvailableAgencyClientId } from "@/lib/agencyClientId";
import { isMissingColumnError } from "@/lib/prismaErrors";
import { parseDateInputInBuenosAires } from "@/lib/buenosAiresDate";
import { jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import {
  DEFAULT_CLIENT_PROFILE_KEY,
  DOCUMENT_ANY_KEY,
  normalizeClientProfiles,
  resolveClientProfile,
  DOC_REQUIRED_FIELDS,
  REQUIRED_FIELD_OPTIONS,
} from "@/utils/clientConfig";
import { rankClientsBySimilarity } from "@/utils/clientSearch";
import {
  buildClientDuplicateResponse,
  findClientDuplicate,
} from "@/utils/clientDuplicate";

// ==== Tipos auxiliares ====
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
  role: string; // en minúscula
  email?: string;
};

// ==== JWT Secret (mismo en todos los endpoints, sin defaults) ====
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

// ==== Helpers comunes ====
function getTokenFromRequest(req: NextApiRequest): string | null {
  // 1) Cookie "token" (más confiable en prod con proxies)
  if (req.cookies?.token) return req.cookies.token;

  // 2) Authorization: Bearer
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  // 3) Otros nombres posibles de cookie
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
    const role = String(p.role || "").toLowerCase();
    const email = p.email;

    // Completar agencia si falta
    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u) {
        return {
          id_user,
          id_agency: u.id_agency,
          role: role || u.role.toLowerCase(),
          email: email ?? u.email ?? undefined,
        };
      }
    }

    // Buscar por email si falta id_user
    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true },
      });
      if (u) {
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role.toLowerCase(),
          email,
        };
      }
    }

    if (!id_user || !id_agency) return null;
    return { id_user, id_agency, role, email: email ?? undefined };
  } catch {
    return null;
  }
}

function toLocalDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}

function safeNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const REQUIRED_FIELD_LABELS = new Map(
  REQUIRED_FIELD_OPTIONS.map((option) => [option.key, option.label]),
);

function getFieldLabel(fieldKey: string): string {
  return REQUIRED_FIELD_LABELS.get(fieldKey) ?? fieldKey.replace(/_/g, " ");
}

function getMissingFieldMessage(fieldKey: string): string {
  return `Falta completar ${getFieldLabel(fieldKey)}.`;
}

type ClientCustomFieldDef = {
  key: string;
  type: string;
  options?: string[];
};

function normalizeCustomFieldValue(
  field: ClientCustomFieldDef,
  value: unknown,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  if (field.type === "boolean") {
    const normalized = raw.toLowerCase();
    if (["true", "1", "si", "sí", "yes"].includes(normalized)) return "true";
    if (["false", "0", "no"].includes(normalized)) return "false";
    return "";
  }

  if (field.type === "select") {
    const options = Array.isArray(field.options) ? field.options : [];
    if (options.length === 0) return raw;
    return options.includes(raw) ? raw : "";
  }

  if (field.type === "multiselect") {
    const options = new Set(Array.isArray(field.options) ? field.options : []);
    const selected = raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (selected.length === 0) return "";
    const sanitized = options.size
      ? selected.filter((item) => options.has(item))
      : selected;
    if (sanitized.length === 0) return "";
    return Array.from(new Set(sanitized)).join(", ");
  }

  return raw;
}

const userSelectSafe = {
  id_user: true,
  first_name: true,
  last_name: true,
  role: true,
  id_agency: true,
  email: true,
} as const;

const duplicateSelectSafe = {
  id_client: true,
  agency_client_id: true,
  first_name: true,
  last_name: true,
  birth_date: true,
  dni_number: true,
  passport_number: true,
  tax_id: true,
} as const;

const clientSelectSafe = {
  id_client: true,
  agency_client_id: true,
  profile_key: true,
  first_name: true,
  last_name: true,
  phone: true,
  address: true,
  postal_code: true,
  locality: true,
  company_name: true,
  tax_id: true,
  commercial_address: true,
  dni_number: true,
  passport_number: true,
  birth_date: true,
  nationality: true,
  gender: true,
  email: true,
  custom_fields: true,
  registration_date: true,
  id_agency: true,
  id_user: true,
  user: { select: userSelectSafe },
} as const satisfies Prisma.ClientSelect;

const clientLegacySelectSafe = {
  id_client: true,
  agency_client_id: true,
  first_name: true,
  last_name: true,
  phone: true,
  address: true,
  postal_code: true,
  locality: true,
  company_name: true,
  tax_id: true,
  commercial_address: true,
  dni_number: true,
  passport_number: true,
  birth_date: true,
  nationality: true,
  gender: true,
  email: true,
  custom_fields: true,
  registration_date: true,
  id_agency: true,
  id_user: true,
  user: { select: userSelectSafe },
} as const satisfies Prisma.ClientSelect;

type ClientRowSafe = Prisma.ClientGetPayload<{ select: typeof clientSelectSafe }>;
type ClientLegacyRowSafe = Prisma.ClientGetPayload<{
  select: typeof clientLegacySelectSafe;
}> & { profile_key: string };
type ClientRowCompat = ClientRowSafe | ClientLegacyRowSafe;

function withDefaultProfileKey<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    profile_key:
      typeof row.profile_key === "string" && row.profile_key.trim()
        ? row.profile_key
        : DEFAULT_CLIENT_PROFILE_KEY,
  };
}

type VisibilityMode = "all" | "team" | "own";

function normalizeVisibilityMode(v: unknown): VisibilityMode {
  return v === "team" || v === "own" || v === "all" ? v : "all";
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

// Alcance de líder (equipos que lidera + ids de usuarios alcanzables)
async function getLeaderScope(authUserId: number, authAgencyId: number) {
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

// ==== Handler principal ====
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const auth = await getUserFromAuth(req);
  if (!auth?.id_user || !auth.id_agency) {
    return res.status(401).json({ error: "No autenticado o token inválido." });
  }

  const role = (auth.role || "").toLowerCase();

  // ===== GET: lista con filtros + cursor =====
  if (req.method === "GET") {
    try {
      const takeParam = safeNumber(
        Array.isArray(req.query.take) ? req.query.take[0] : req.query.take,
      );
      const take = Math.min(Math.max(takeParam || 24, 1), 100);

      const cursorParam = safeNumber(
        Array.isArray(req.query.cursor)
          ? req.query.cursor[0]
          : req.query.cursor,
      );
      const cursor = cursorParam && cursorParam > 0 ? cursorParam : undefined;

      const userIdParam = safeNumber(
        Array.isArray(req.query.userId)
          ? req.query.userId[0]
          : req.query.userId,
      );
      const userId = userIdParam || 0;

      const teamIdParam = safeNumber(
        Array.isArray(req.query.teamId)
          ? req.query.teamId[0]
          : req.query.teamId,
      );
      const teamId = teamIdParam || 0;

      const relatedToParam = safeNumber(
        Array.isArray(req.query.related_to)
          ? req.query.related_to[0]
          : req.query.related_to,
      );
      const relatedToId = relatedToParam || 0;
      const profileKeyRaw = Array.isArray(req.query.profile_key)
        ? req.query.profile_key[0]
        : req.query.profile_key;
      const profileKey =
        typeof profileKeyRaw === "string"
          ? profileKeyRaw.trim().toLowerCase()
          : "";

      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const gender =
        typeof req.query.gender === "string" ? req.query.gender.trim() : "";
      const where: Prisma.ClientWhereInput = { id_agency: auth.id_agency };
      const roleNorm = (role || "").toLowerCase();
      const isLeader = roleNorm === "lider";
      const isSeller = roleNorm === "vendedor";

      const visibilityMode = isLeader
        ? "team"
        : isSeller
          ? await getVisibilityMode(auth.id_agency)
          : "all";

      if (visibilityMode === "own") {
        where.id_user = auth.id_user;
      } else if (visibilityMode === "team") {
        const scope = isLeader
          ? await getLeaderScope(auth.id_user, auth.id_agency)
          : await getTeamScope(auth.id_user, auth.id_agency);
        const allowedUserIds = scope.userIds.length
          ? scope.userIds
          : [auth.id_user];
        const allowedTeamIds = new Set(scope.teamIds);

        if (userId > 0 && allowedUserIds.includes(userId)) {
          where.id_user = userId;
        } else if (teamId > 0 && allowedTeamIds.has(teamId)) {
          const ids = scope.membersByTeam[teamId] || [];
          where.id_user = { in: ids.length ? ids : [-1] };
        } else {
          where.id_user = { in: allowedUserIds };
        }
      } else {
        if (userId > 0) where.id_user = userId;

        if (!userId && teamId !== 0) {
          if (teamId > 0) {
            const team = await prisma.salesTeam.findUnique({
              where: { id_team: teamId },
              include: { user_teams: { select: { id_user: true } } },
            });
            if (!team || team.id_agency !== auth.id_agency) {
              return res
                .status(403)
                .json({ error: "Equipo inválido para esta agencia." });
            }
            const ids = team.user_teams.map((ut) => ut.id_user);
            where.id_user = { in: ids.length ? ids : [-1] };
          } else if (teamId === -1) {
            const users = await prisma.user.findMany({
              where: { id_agency: auth.id_agency, sales_teams: { none: {} } },
              select: { id_user: true },
            });
            const ids = users.map((u) => u.id_user);
            where.id_user = { in: ids.length ? ids : [-1] };
          }
        }
      }

      if (gender) {
        where.gender = { equals: gender, mode: "insensitive" };
      }
      if (profileKey && profileKey !== "all") {
        where.profile_key = profileKey;
      }

      if (relatedToId > 0) {
        const relFilter: Prisma.ClientWhereInput = {
          OR: [
            {
              related_to: {
                some: { client_id: relatedToId, id_agency: auth.id_agency },
              },
            },
            {
              relations: {
                some: { related_client_id: relatedToId, id_agency: auth.id_agency },
              },
            },
          ],
        };
        where.AND = Array.isArray(where.AND)
          ? [...where.AND, relFilter]
          : [relFilter];
      }

      if (q) {
        // Cuando hay búsqueda por texto usamos ranking por similitud
        // en memoria para cubrir typo tolerance y campos custom.
        const offset = Math.max(cursorParam ?? 0, 0);
        let candidates: ClientRowCompat[] = [];
        try {
          candidates = await prisma.client.findMany({
            where,
            select: clientSelectSafe,
            orderBy: { id_client: "desc" },
          });
        } catch (error) {
          if (!isMissingColumnError(error, "Client.profile_key")) {
            throw error;
          }
          const legacyWhere = { ...where } as Record<string, unknown>;
          delete legacyWhere.profile_key;
          const legacyCandidates = await prisma.client.findMany({
            where: legacyWhere as Prisma.ClientWhereInput,
            select: clientLegacySelectSafe,
            orderBy: { id_client: "desc" },
          });
          candidates = legacyCandidates.map((row) => withDefaultProfileKey(row));
        }

        const ranked = rankClientsBySimilarity(candidates, q);
        const paged = ranked.slice(offset, offset + take);
        const nextCursor =
          offset + paged.length < ranked.length ? offset + paged.length : null;

        return res.status(200).json({ items: paged, nextCursor });
      }

      // Query con cursor
      let items: ClientRowCompat[] = [];
      try {
        items = await prisma.client.findMany({
          where,
          select: clientSelectSafe,
          orderBy: { id_client: "desc" },
          take: take + 1,
          ...(cursor ? { cursor: { id_client: cursor }, skip: 1 } : {}),
        });
      } catch (error) {
        if (!isMissingColumnError(error, "Client.profile_key")) {
          throw error;
        }
        const legacyWhere = { ...where } as Record<string, unknown>;
        delete legacyWhere.profile_key;
        const legacyItems = await prisma.client.findMany({
          where: legacyWhere as Prisma.ClientWhereInput,
          select: clientLegacySelectSafe,
          orderBy: { id_client: "desc" },
          take: take + 1,
          ...(cursor ? { cursor: { id_client: cursor }, skip: 1 } : {}),
        });
        items = legacyItems.map((row) => withDefaultProfileKey(row));
      }

      const hasMore = items.length > take;
      const sliced = hasMore ? items.slice(0, take) : items;
      const nextCursor = hasMore
        ? Number(sliced[sliced.length - 1].id_client)
        : null;

      return res.status(200).json({ items: sliced, nextCursor });
    } catch (e) {
      console.error("[clients][GET]", e);
      if (isMissingColumnError(e, "Client.profile_key")) {
        return res.status(500).json({
          error:
            "No se pudieron cargar los tipos de pax por una actualización pendiente del sistema.",
        });
      }
      return res.status(500).json({ error: "Error al obtener pasajeros" });
    }
  }

  // ===== POST: crear =====
  if (req.method === "POST") {
    try {
      const c = req.body ?? {};

      let config:
        | {
            required_fields: Prisma.JsonValue | null;
            hidden_fields: Prisma.JsonValue | null;
            custom_fields: Prisma.JsonValue | null;
            profiles?: Prisma.JsonValue | null;
          }
        | null = null;
      let supportsProfilesConfigColumn = true;
      try {
        config = await prisma.clientConfig.findFirst({
          where: { id_agency: auth.id_agency },
          select: {
            required_fields: true,
            hidden_fields: true,
            custom_fields: true,
            profiles: true,
          },
        });
      } catch (error) {
        if (!isMissingColumnError(error, "ClientConfig.profiles")) {
          throw error;
        }
        supportsProfilesConfigColumn = false;
        config = await prisma.clientConfig.findFirst({
          where: { id_agency: auth.id_agency },
          select: {
            required_fields: true,
            hidden_fields: true,
            custom_fields: true,
          },
        });
      }
      const profiles = normalizeClientProfiles(config?.profiles, {
        required_fields: config?.required_fields,
        hidden_fields: config?.hidden_fields,
        custom_fields: config?.custom_fields,
      });
      const requestedProfileKey = String(c.profile_key ?? "")
        .trim()
        .toLowerCase();
      if (requestedProfileKey && !profiles.some((p) => p.key === requestedProfileKey)) {
        return res.status(400).json({ error: "Tipo de pax inválido." });
      }
      const selectedProfile = resolveClientProfile(profiles, requestedProfileKey);
      const requiredFields = selectedProfile.required_fields;
      const customFields = selectedProfile.custom_fields;
      const requiredCustomKeys = customFields
        .filter((f) => f.required)
        .map((f) => f.key);
      const customFieldLabels = new Map(customFields.map((f) => [f.key, f.label]));

      const isFilled = (val: unknown) =>
        String(val ?? "")
          .trim()
          .length > 0;

      // Validaciones requeridas
      for (const f of requiredFields) {
        if (f === DOCUMENT_ANY_KEY) continue;
        if (!isFilled((c as Record<string, unknown>)[f])) {
          return res.status(400).json({ error: getMissingFieldMessage(f) });
        }
      }

      const first_name = String(c.first_name ?? "").trim();
      const last_name = String(c.last_name ?? "").trim();
      const dni = String(c.dni_number ?? "").trim();
      const pass = String(c.passport_number ?? "").trim();
      const taxId = String(c.tax_id ?? "").trim();

      const docRequired =
        requiredFields.includes(DOCUMENT_ANY_KEY) ||
        requiredFields.some((field) => DOC_REQUIRED_FIELDS.includes(field));
      if (docRequired && !dni && !pass && !taxId) {
        return res.status(400).json({
          error:
            "El DNI, el Pasaporte o el CUIT/RUT son obligatorios. Debes cargar al menos uno",
        });
      }

      const birthRaw = String(c.birth_date ?? "").trim();
      const birth = birthRaw ? toLocalDate(birthRaw) : undefined;
      if (birthRaw && !birth) {
        return res
          .status(400)
          .json({ error: "La fecha de nacimiento no es válida." });
      }
      if (requiredFields.includes("birth_date") && !birth) {
        return res
          .status(400)
          .json({ error: getMissingFieldMessage("birth_date") });
      }
      const birthForStorage = birth ?? null;

      const customPayload = isRecord(c.custom_fields)
        ? (c.custom_fields as Record<string, unknown>)
        : {};
      const allowedCustomKeys = new Set(customFields.map((f) => f.key));
      const customFieldMap = new Map(
        customFields.map((field) => [field.key, field]),
      );
      const sanitizedCustom = Object.fromEntries(
        Object.entries(customPayload)
          .filter(([key]) => allowedCustomKeys.has(key))
          .map(([key, value]) => {
            const definition = customFieldMap.get(key);
            const normalized = definition
              ? normalizeCustomFieldValue(
                  definition as ClientCustomFieldDef,
                  value,
                )
              : String(value ?? "").trim();
            return [key, normalized];
          })
          .filter(([, value]) => value.length > 0),
      );

      for (const key of requiredCustomKeys) {
        if (!isFilled(sanitizedCustom[key])) {
          const label = customFieldLabels.get(key) ?? key;
          return res.status(400).json({
            error: `Falta completar ${label}.`,
          });
        }
      }

      // Quién puede asignar a otro usuario
      const canAssignOthers = [
        "gerente",
        "administrativo",
        "desarrollador",
        "lider",
      ].includes(role);
      let usedUserId: number = auth.id_user;

      if (
        canAssignOthers &&
        typeof c.id_user === "number" &&
        Number.isFinite(c.id_user)
      ) {
        usedUserId = Number(c.id_user);
        // Si es líder y asigna a otro, debe estar en su alcance
        if (role === "lider" && usedUserId !== auth.id_user) {
          const scope = await getLeaderScope(auth.id_user, auth.id_agency);
          if (!scope.userIds.includes(usedUserId)) {
            return res
              .status(403)
              .json({ error: "No podés asignar fuera de tu equipo." });
          }
        }
      }

      // Duplicados (en el scope de la agencia) con detalle de campo en conflicto
      const duplicateCandidates = await prisma.client.findMany({
        where: { id_agency: auth.id_agency },
        select: duplicateSelectSafe,
        orderBy: { id_client: "desc" },
      });
      const duplicate = findClientDuplicate(duplicateCandidates, {
        first_name,
        last_name,
        birth_date: birth ?? null,
        dni_number: dni || null,
        passport_number: pass || null,
        tax_id: taxId || null,
      });
      if (duplicate) {
        return res.status(409).json(buildClientDuplicateResponse(duplicate));
      }

      const created = await prisma.$transaction(async (tx) => {
        const agencyClientId = await getNextAvailableAgencyClientId(
          tx,
          auth.id_agency,
        );
        const createDataBase = {
          agency_client_id: agencyClientId,
          first_name,
          last_name,
          phone: String(c.phone ?? "").trim(),
          address: c.address || null,
          postal_code: c.postal_code || null,
          locality: c.locality || null,
          company_name: c.company_name || null,
          tax_id: taxId || null,
          commercial_address: c.commercial_address || null,
          dni_number: dni || null,
          passport_number: pass || null,
          birth_date: birthForStorage,
          nationality: String(c.nationality ?? "").trim(),
          gender: String(c.gender ?? "").trim(),
          // Las categorías quedan reservadas al flujo de pax simple.
          category_id: null,
          email: String(c.email ?? "").trim() || null,
          id_user: usedUserId,
          id_agency: auth.id_agency, // SIEMPRE desde el token
          custom_fields:
            Object.keys(sanitizedCustom).length > 0 ? sanitizedCustom : undefined,
        };

        try {
          return await tx.client.create({
            data: {
              ...createDataBase,
              profile_key: selectedProfile.key,
            },
            select: clientSelectSafe,
          });
        } catch (error) {
          if (!isMissingColumnError(error, "Client.profile_key")) {
            throw error;
          }
          const legacyCreated = await tx.client.create({
            data: createDataBase,
            select: clientLegacySelectSafe,
          });
          return withDefaultProfileKey(legacyCreated);
        }
      });

      return res.status(201).json({
        ...created,
        ...(supportsProfilesConfigColumn
          ? {}
          : {
              schema_warning:
                "Se guardó en modo legado. Ejecutá `npx prisma migrate deploy` para habilitar Tipos de Pax.",
            }),
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const targetRaw = (
          e.meta as { target?: string[] | string } | undefined
        )?.target;
        const target = Array.isArray(targetRaw)
          ? targetRaw.join(",")
          : String(targetRaw ?? "");
        if (target.includes("agency_client_id")) {
          return res.status(409).json({
            error:
              "No se pudo guardar el pax por un conflicto con el numero interno. Reintenta.",
            code: "CLIENT_NUMBER_CONFLICT",
          });
        }
        return res.status(409).json({
          error: "No se pudo guardar el pax por un dato unico duplicado.",
          code: "CLIENT_UNIQUE_CONFLICT",
        });
      }
      if (
        isMissingColumnError(e, "ClientConfig.profiles") ||
        isMissingColumnError(e, "Client.profile_key")
      ) {
        return res.status(500).json({
          error:
            "No se pueden guardar tipos de pax por una actualización pendiente del sistema.",
        });
      }
      if (e instanceof Prisma.PrismaClientValidationError) {
        return res.status(400).json({
          error:
            "Hay datos incompletos o inválidos para este tipo de pax. Revisá los campos e intentá nuevamente.",
        });
      }
      console.error("[clients][POST]", e);
      return res.status(500).json({
        error: "No se pudo guardar el pax. Revisá los datos e intentá nuevamente.",
      });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
