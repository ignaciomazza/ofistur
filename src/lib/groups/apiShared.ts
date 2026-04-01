import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { decodePublicId, encodePublicId } from "@/lib/publicIds";
import { resolveAuth, type AuthContext } from "@/lib/auth";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { normalizeRole } from "@/utils/permissions";
import { groupApiError } from "@/lib/groups/apiErrors";

export const GROUP_TYPES = [
  "AGENCIA",
  "ESTUDIANTIL",
  "MICRO",
  "PRECOMPRADO",
] as const;
export const GROUP_STATUSES = [
  "BORRADOR",
  "PUBLICADA",
  "CONFIRMADA",
  "CERRADA",
  "CANCELADA",
] as const;
export const GROUP_CAPACITY_MODES = ["TOTAL", "SERVICIO"] as const;

const WRITER_ROLES = [
  "desarrollador",
  "gerente",
  "administrativo",
  "lider",
  "vendedor",
] as const;

const CONFIG_MANAGER_ROLES = [
  "desarrollador",
  "gerente",
  "administrativo",
  "lider",
] as const;

type GroupStatus = (typeof GROUP_STATUSES)[number];

const STATUS_TRANSITIONS: Record<GroupStatus, GroupStatus[]> = {
  BORRADOR: ["PUBLICADA", "CANCELADA"],
  PUBLICADA: ["CONFIRMADA", "CANCELADA"],
  CONFIRMADA: ["CERRADA", "CANCELADA"],
  CERRADA: [],
  CANCELADA: [],
};

export function canWriteGroups(role: string | null | undefined): boolean {
  return WRITER_ROLES.includes(normalizeRole(role) as (typeof WRITER_ROLES)[number]);
}

export function canManageGroupConfig(role: string | null | undefined): boolean {
  return CONFIG_MANAGER_ROLES.includes(
    normalizeRole(role) as (typeof CONFIG_MANAGER_ROLES)[number],
  );
}

export async function requireAuth(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<AuthContext | null> {
  const auth = await resolveAuth(req);
  if (!auth) {
    res.status(401).json({
      error: "Tu sesión expiró o no es válida.",
      code: "AUTH_REQUIRED",
      solution: "Iniciá sesión nuevamente y volvé a intentar.",
    });
    return null;
  }
  let resolvedAuth: AuthContext = auth;

  try {
    const user = await prisma.user.findUnique({
      where: { id_user: auth.id_user },
      select: { id_agency: true, role: true, email: true },
    });
    if (user?.id_agency && user.id_agency !== auth.id_agency) {
      resolvedAuth = {
        id_user: auth.id_user,
        id_agency: user.id_agency,
        role: normalizeRole(auth.role || user.role),
        email: auth.email ?? user.email ?? undefined,
      };
    }
  } catch {
    // Si falla esta verificación, seguimos con el contexto del token.
  }

  const planAccess = await ensurePlanFeatureAccess(resolvedAuth.id_agency, "groups");
  if (!planAccess.allowed) {
    groupApiError(
      res,
      403,
      "Plan insuficiente para usar grupales.",
      {
        code: "GROUP_PLAN_FORBIDDEN",
        solution: "Actualizá la suscripción de la agencia al plan Pro para habilitar Grupales.",
      },
    );
    return null;
  }

  return resolvedAuth;
}

export function parsePositiveInt(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

export function toDistinctPositiveInts(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<number>();
  for (const item of value) {
    const id = parsePositiveInt(item);
    if (id) set.add(id);
  }
  return Array.from(set);
}

export function parseOptionalInt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(",", "."))
        : NaN;
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  return i >= 0 ? i : undefined;
}

export function parseOptionalBoolean(
  value: unknown,
): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["1", "true", "t", "yes", "y", "si", "on"].includes(s)) return true;
    if (["0", "false", "f", "no", "n", "off"].includes(s)) return false;
    if (["null", ""].includes(s)) return null;
  }
  return undefined;
}

export function parseOptionalDate(
  value: unknown,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const ymd = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    return new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      0,
      0,
      0,
      0,
    );
  }
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d;
}

export function parseOptionalString(
  value: unknown,
  max = 255,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

export function normalizeGroupType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
  if (!s) return null;
  if (["AGENCIA", "AGENCY", "GRUPAL", "GROUP"].includes(s)) return "AGENCIA";
  if (["ESTUDIANTIL", "ESTUDIANTES", "STUDENT", "SCHOOL"].includes(s)) {
    return "ESTUDIANTIL";
  }
  if (["MICRO", "MINIBUS", "SHUTTLE"].includes(s)) {
    return "MICRO";
  }
  if (
    [
      "PRECOMPRADO",
      "PRE-COMPRADO",
      "PRECOMPRADOS",
      "PREPURCHASED",
      "PRE_PURCHASED",
      "PREBOUGHT",
      "CUPO",
      "CUPOS",
    ].includes(s)
  ) {
    return "PRECOMPRADO";
  }
  return GROUP_TYPES.includes(s as (typeof GROUP_TYPES)[number]) ? s : null;
}

export function normalizeGroupTemplateTarget(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const s = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
  if (!s || s === "ALL" || s === "TODOS" || s === "TODAS") return null;
  return normalizeGroupType(s);
}

export function normalizeGroupStatus(
  value: unknown,
): GroupStatus | null {
  if (typeof value !== "string") return null;
  const s = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
  return GROUP_STATUSES.includes(s as GroupStatus) ? (s as GroupStatus) : null;
}

export function normalizeCapacityMode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
  if (["TOTAL", "CUPO_TOTAL", "GENERAL"].includes(s)) return "TOTAL";
  if (["SERVICIO", "POR_SERVICIO", "SERVICE"].includes(s)) return "SERVICIO";
  return GROUP_CAPACITY_MODES.includes(s as (typeof GROUP_CAPACITY_MODES)[number])
    ? s
    : null;
}

export function canTransitionStatus(
  current: string,
  next: string,
): boolean {
  const currentNormalized = normalizeGroupStatus(current);
  const nextNormalized = normalizeGroupStatus(next);
  if (!currentNormalized || !nextNormalized) return false;
  if (currentNormalized === nextNormalized) return true;
  return STATUS_TRANSITIONS[currentNormalized].includes(nextNormalized);
}

export function isLockedGroupStatus(status: string): boolean {
  const s = normalizeGroupStatus(status);
  return s === "CERRADA" || s === "CANCELADA";
}

export function parseGroupWhereInput(
  rawId: string,
  idAgency: number,
): Prisma.TravelGroupWhereInput | null {
  const numeric = parsePositiveInt(rawId);
  if (numeric) {
    return { id_travel_group: numeric, id_agency: idAgency };
  }
  const decoded = decodePublicId(rawId);
  if (!decoded || decoded.t !== "travel_group" || decoded.a !== idAgency) {
    return null;
  }
  return { id_agency: idAgency, agency_travel_group_id: decoded.i };
}

export function parseDepartureWhereInput(
  rawId: string,
  idAgency: number,
): Prisma.TravelGroupDepartureWhereInput | null {
  const numeric = parsePositiveInt(rawId);
  if (numeric) {
    return { id_travel_group_departure: numeric, id_agency: idAgency };
  }
  const decoded = decodePublicId(rawId);
  if (
    !decoded ||
    decoded.t !== "travel_group_departure" ||
    decoded.a !== idAgency
  ) {
    return null;
  }
  return {
    id_agency: idAgency,
    agency_travel_group_departure_id: decoded.i,
  };
}

export function getGroupPublicId(group: {
  id_agency: number;
  agency_travel_group_id: number | null;
}): string | null {
  if (group.agency_travel_group_id == null) return null;
  return encodePublicId({
    t: "travel_group",
    a: group.id_agency,
    i: group.agency_travel_group_id,
  });
}

export function getDeparturePublicId(departure: {
  id_agency: number;
  agency_travel_group_departure_id: number | null;
}): string | null {
  if (departure.agency_travel_group_departure_id == null) return null;
  return encodePublicId({
    t: "travel_group_departure",
    a: departure.id_agency,
    i: departure.agency_travel_group_departure_id,
  });
}

export function toJsonInput(value: unknown): Prisma.InputJsonValue | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value as Prisma.InputJsonArray;
  }
  if (typeof value === "object") {
    return value as Prisma.InputJsonObject;
  }
  return undefined;
}

export function toDistinctStringArray(
  value: unknown,
  maxItems = 100,
  maxItemLength = 80,
): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const set = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const cleaned = raw.trim();
    if (!cleaned) continue;
    if (cleaned.length > maxItemLength) return null;
    if (set.has(cleaned)) continue;
    set.add(cleaned);
    out.push(cleaned);
    if (out.length > maxItems) return null;
  }
  return out;
}
