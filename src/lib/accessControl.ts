import prisma from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/prismaErrors";
import { canAccessBookingOwnerByVisibility } from "@/lib/bookingVisibility";
import {
  canAccessAnyFinanceSection,
  canAccessBookingComponent,
  canAccessFinanceSection,
  normalizeRole,
  normalizeBookingComponentRules,
  normalizeFinanceSectionRules,
  pickBookingComponentRule,
  pickFinanceSectionRule,
  type BookingComponentKey,
  type FinanceSectionKey,
} from "@/utils/permissions";

const ADMIN_ROLES = new Set(["desarrollador", "gerente", "administrativo"]);
const ACCESS_CACHE_TTL_MS = 15_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const financeSectionGrantCache = new Map<
  string,
  CacheEntry<FinanceSectionKey[]>
>();
const bookingComponentGrantCache = new Map<
  string,
  CacheEntry<BookingComponentKey[]>
>();
const financePicksAccessCache = new Map<
  string,
  CacheEntry<{ canRead: boolean; canWrite: boolean }>
>();

const financeSectionGrantInflight = new Map<string, Promise<FinanceSectionKey[]>>();
const bookingComponentGrantInflight = new Map<
  string,
  Promise<BookingComponentKey[]>
>();
const financePicksAccessInflight = new Map<
  string,
  Promise<{ canRead: boolean; canWrite: boolean }>
>();

function getCachedValue<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
): void {
  map.set(key, { value, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS });
}

function invalidateMapEntriesByPrefix<T>(
  map: Map<string, T>,
  prefix: string,
): void {
  for (const key of map.keys()) {
    if (key.startsWith(prefix)) {
      map.delete(key);
    }
  }
}

export function invalidateBookingPermissionCaches(
  id_agency?: number | null,
  id_user?: number | null,
): void {
  if (!id_agency) return;

  const agencyPrefix = `${id_agency}:`;
  const bookingGrantPrefix = id_user
    ? `${id_agency}:${id_user}`
    : agencyPrefix;
  const financeAccessPrefix = id_user
    ? `${id_agency}:${id_user}:`
    : agencyPrefix;

  invalidateMapEntriesByPrefix(bookingComponentGrantCache, bookingGrantPrefix);
  invalidateMapEntriesByPrefix(
    bookingComponentGrantInflight,
    bookingGrantPrefix,
  );
  invalidateMapEntriesByPrefix(financePicksAccessCache, financeAccessPrefix);
  invalidateMapEntriesByPrefix(
    financePicksAccessInflight,
    financeAccessPrefix,
  );
}

export async function canAccessBookingByRole(
  auth: {
    id_user?: number | null;
    id_agency?: number | null;
    role?: string | null;
  },
  booking: { id_user: number; id_agency: number },
): Promise<boolean> {
  if (!auth?.id_user || !auth.id_agency) return false;
  if (!booking?.id_user || !booking.id_agency) return false;
  if (booking.id_agency !== auth.id_agency) return false;

  const role = normalizeRole(auth.role);
  if (!role) return false;
  if (ADMIN_ROLES.has(role)) return true;
  return canAccessBookingOwnerByVisibility({
    id_user: auth.id_user,
    id_agency: auth.id_agency,
    role,
    owner_user_id: booking.id_user,
  });
}

export async function getFinanceSectionGrants(
  id_agency?: number | null,
  id_user?: number | null,
): Promise<FinanceSectionKey[]> {
  if (!id_agency || !id_user) return [];
  const key = `${id_agency}:${id_user}`;
  const cached = getCachedValue(financeSectionGrantCache, key);
  if (cached) return cached;
  const inflight = financeSectionGrantInflight.get(key);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const config = await prisma.financeConfig.findFirst({
        where: { id_agency },
        select: { section_access_rules: true },
      });
      const rules = normalizeFinanceSectionRules(config?.section_access_rules);
      const rule = pickFinanceSectionRule(rules, id_user);
      const sections = rule?.sections ?? [];
      setCachedValue(financeSectionGrantCache, key, sections);
      return sections;
    } catch (error) {
      if (isMissingColumnError(error, "FinanceConfig.section_access_rules")) {
        setCachedValue(financeSectionGrantCache, key, []);
        return [];
      }
      throw error;
    }
  })();
  financeSectionGrantInflight.set(key, task);
  try {
    return await task;
  } finally {
    financeSectionGrantInflight.delete(key);
  }
}

export async function getBookingComponentGrants(
  id_agency?: number | null,
  id_user?: number | null,
): Promise<BookingComponentKey[]> {
  if (!id_agency || !id_user) return [];
  const key = `${id_agency}:${id_user}`;
  const cached = getCachedValue(bookingComponentGrantCache, key);
  if (cached) return cached;
  const inflight = bookingComponentGrantInflight.get(key);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const config = await prisma.serviceCalcConfig.findUnique({
        where: { id_agency },
        select: { booking_access_rules: true },
      });
      const rules = normalizeBookingComponentRules(config?.booking_access_rules);
      const rule = pickBookingComponentRule(rules, id_user);
      const components = rule?.components ?? [];
      setCachedValue(bookingComponentGrantCache, key, components);
      return components;
    } catch (error) {
      if (isMissingColumnError(error, "ServiceCalcConfig.booking_access_rules")) {
        setCachedValue(bookingComponentGrantCache, key, []);
        return [];
      }
      throw error;
    }
  })();
  bookingComponentGrantInflight.set(key, task);
  try {
    return await task;
  } finally {
    bookingComponentGrantInflight.delete(key);
  }
}

export async function getFinancePicksAccess(
  id_agency: number,
  id_user: number,
  role: string,
): Promise<{ canRead: boolean; canWrite: boolean }> {
  const key = `${id_agency}:${id_user}:${normalizeRole(role)}`;
  const cached = getCachedValue(financePicksAccessCache, key);
  if (cached) return cached;
  const inflight = financePicksAccessInflight.get(key);
  if (inflight) return inflight;

  const task = (async () => {
    const financeGrants = await getFinanceSectionGrants(id_agency, id_user);
    const bookingGrants = await getBookingComponentGrants(id_agency, id_user);
    const canRead =
      canAccessAnyFinanceSection(role, financeGrants) ||
      canAccessBookingComponent(role, bookingGrants, "receipts_form") ||
      canAccessBookingComponent(role, bookingGrants, "operator_payments");
    const canWrite = canAccessFinanceSection(
      role,
      financeGrants,
      "finance_config",
    );
    const access = { canRead, canWrite };
    setCachedValue(financePicksAccessCache, key, access);
    return access;
  })();
  financePicksAccessInflight.set(key, task);
  try {
    return await task;
  } finally {
    financePicksAccessInflight.delete(key);
  }
}
