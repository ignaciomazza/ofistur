import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prismaErrors";
import { normalizeRole } from "@/utils/permissions";

export type BookingVisibilityMode = "all" | "team" | "own";

export type BookingScope = {
  teamIds: number[];
  userIds: number[];
  membersByTeam: Record<number, number[]>;
};

export function normalizeBookingVisibilityMode(
  value: unknown,
  fallback: BookingVisibilityMode = "own",
): BookingVisibilityMode {
  if (value === "all" || value === "team" || value === "own") return value;
  return fallback;
}

export async function getBookingVisibilityMode(
  authAgencyId: number,
): Promise<BookingVisibilityMode> {
  try {
    const cfg = await prisma.serviceCalcConfig.findUnique({
      where: { id_agency: authAgencyId },
      select: { booking_visibility_mode: true },
    });
    return normalizeBookingVisibilityMode(cfg?.booking_visibility_mode, "own");
  } catch (error) {
    if (
      isMissingColumnError(error, "ServiceCalcConfig.booking_visibility_mode")
    ) {
      return "own";
    }
    throw error;
  }
}

async function getScopeByWhere(
  where: Prisma.SalesTeamWhereInput,
  authUserId: number,
): Promise<BookingScope> {
  const teams = await prisma.salesTeam.findMany({
    where,
    include: { user_teams: { select: { id_user: true } } },
  });
  const teamIds = teams.map((t) => t.id_team);
  const userIds = new Set<number>([authUserId]);
  const membersByTeam: Record<number, number[]> = {};

  teams.forEach((team) => {
    const ids = team.user_teams.map((ut) => ut.id_user);
    membersByTeam[team.id_team] = ids;
    ids.forEach((id) => userIds.add(id));
  });

  return { teamIds, userIds: Array.from(userIds), membersByTeam };
}

export async function getBookingTeamScope(
  authUserId: number,
  authAgencyId: number,
): Promise<BookingScope> {
  return getScopeByWhere(
    {
      id_agency: authAgencyId,
      user_teams: { some: { id_user: authUserId } },
    },
    authUserId,
  );
}

export async function getBookingLeaderScope(
  authUserId: number,
  authAgencyId: number,
): Promise<BookingScope> {
  return getScopeByWhere(
    {
      id_agency: authAgencyId,
      user_teams: { some: { id_user: authUserId } },
    },
    authUserId,
  );
}

export async function resolveBookingVisibilityMode(auth: {
  id_agency: number;
  role?: string | null;
}): Promise<BookingVisibilityMode> {
  const role = normalizeRole(auth.role);
  if (
    role === "gerente" ||
    role === "administrativo" ||
    role === "desarrollador"
  ) {
    return "all";
  }
  if (role === "lider") return "team";
  if (role === "vendedor") return getBookingVisibilityMode(auth.id_agency);
  return "own";
}

export async function canAccessBookingOwnerByVisibility(auth: {
  id_user: number;
  id_agency: number;
  role?: string | null;
  owner_user_id: number;
}): Promise<boolean> {
  const role = normalizeRole(auth.role);
  if (!role) return false;

  const mode = await resolveBookingVisibilityMode(auth);
  if (mode === "all") return true;
  if (mode === "own") return auth.owner_user_id === auth.id_user;

  const scope =
    role === "lider"
      ? await getBookingLeaderScope(auth.id_user, auth.id_agency)
      : await getBookingTeamScope(auth.id_user, auth.id_agency);
  return scope.userIds.includes(auth.owner_user_id);
}
