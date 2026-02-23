import type { BillingFallbackProvider, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

type BillingDbClient = Prisma.TransactionClient | typeof prisma;

export type AgencyCollectionsRollout = {
  agency_id: number;
  has_config: boolean;
  collections_pd_enabled: boolean;
  collections_dunning_enabled: boolean;
  collections_fallback_enabled: boolean;
  collections_fallback_provider: BillingFallbackProvider | null;
  collections_fallback_auto_sync_enabled: boolean;
  collections_suspended: boolean;
  collections_cutoff_override_hour_ar: number | null;
  collections_notes: string | null;
};

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "si"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function normalizeProvider(raw: string | null | undefined): BillingFallbackProvider | null {
  const normalized = String(raw || "").trim().toUpperCase();
  if (normalized === "CIG_QR") return "CIG_QR";
  if (normalized === "MP") return "MP";
  if (normalized === "OTHER") return "OTHER";
  return null;
}

function parseCutoffHour(value: number | null | undefined): number | null {
  if (!Number.isFinite(Number(value))) return null;
  const hour = Math.trunc(Number(value));
  if (hour < 0 || hour > 23) return null;
  return hour;
}

export function isAgencyFlagRolloutRequired(): boolean {
  return parseBooleanEnv("BILLING_COLLECTIONS_ROLLOUT_REQUIRE_AGENCY_FLAG", true);
}

export function buildDefaultAgencyCollectionsRollout(
  agencyId: number,
  requireAgencyFlag = isAgencyFlagRolloutRequired(),
): AgencyCollectionsRollout {
  const enabledByDefault = !requireAgencyFlag;
  return {
    agency_id: agencyId,
    has_config: false,
    collections_pd_enabled: enabledByDefault,
    collections_dunning_enabled: enabledByDefault,
    collections_fallback_enabled: enabledByDefault,
    collections_fallback_provider: null,
    collections_fallback_auto_sync_enabled: false,
    collections_suspended: false,
    collections_cutoff_override_hour_ar: null,
    collections_notes: null,
  };
}

export async function getAgencyCollectionsRolloutMap(input: {
  agencyIds: number[];
  tx?: BillingDbClient;
  requireAgencyFlag?: boolean;
}): Promise<Map<number, AgencyCollectionsRollout>> {
  const uniqueAgencyIds = Array.from(
    new Set(input.agencyIds.filter((id) => Number.isInteger(id) && id > 0)),
  );

  const map = new Map<number, AgencyCollectionsRollout>();
  if (uniqueAgencyIds.length === 0) return map;

  const requireAgencyFlag = input.requireAgencyFlag ?? isAgencyFlagRolloutRequired();

  const client = input.tx ?? prisma;
  const configDelegate = (client as unknown as {
    agencyBillingConfig?: { findMany?: (args: unknown) => Promise<unknown[]> };
  }).agencyBillingConfig;

  if (!configDelegate || typeof configDelegate.findMany !== "function") {
    for (const agencyId of uniqueAgencyIds) {
      // Compatibilidad con entornos/mocks legacy sin tabla de rollout.
      map.set(agencyId, buildDefaultAgencyCollectionsRollout(agencyId, false));
    }
    return map;
  }

  let rows: Array<{
    id_agency: number;
    collections_pd_enabled?: boolean | null;
    collections_dunning_enabled?: boolean | null;
    collections_fallback_enabled?: boolean | null;
    collections_fallback_provider?: string | null;
    collections_fallback_auto_sync_enabled?: boolean | null;
    collections_suspended?: boolean | null;
    collections_cutoff_override_hour_ar?: number | null;
    collections_notes?: string | null;
  }> = [];

  try {
    rows = (await configDelegate.findMany({
      where: { id_agency: { in: uniqueAgencyIds } },
      select: {
        id_agency: true,
        collections_pd_enabled: true,
        collections_dunning_enabled: true,
        collections_fallback_enabled: true,
        collections_fallback_provider: true,
        collections_fallback_auto_sync_enabled: true,
        collections_suspended: true,
        collections_cutoff_override_hour_ar: true,
        collections_notes: true,
      },
    })) as typeof rows;
  } catch {
    for (const agencyId of uniqueAgencyIds) {
      // Si la selección falla por columnas ausentes, evitamos bloquear cobranza.
      map.set(agencyId, buildDefaultAgencyCollectionsRollout(agencyId, false));
    }
    return map;
  }

  for (const agencyId of uniqueAgencyIds) {
    map.set(
      agencyId,
      buildDefaultAgencyCollectionsRollout(agencyId, requireAgencyFlag),
    );
  }

  for (const row of rows) {
    map.set(row.id_agency, {
      agency_id: row.id_agency,
      has_config: true,
      collections_pd_enabled: Boolean(row.collections_pd_enabled),
      collections_dunning_enabled: Boolean(row.collections_dunning_enabled),
      collections_fallback_enabled: Boolean(row.collections_fallback_enabled),
      collections_fallback_provider: normalizeProvider(
        row.collections_fallback_provider,
      ),
      collections_fallback_auto_sync_enabled: Boolean(
        row.collections_fallback_auto_sync_enabled,
      ),
      collections_suspended: Boolean(row.collections_suspended),
      collections_cutoff_override_hour_ar: parseCutoffHour(
        row.collections_cutoff_override_hour_ar,
      ),
      collections_notes: row.collections_notes || null,
    });
  }

  return map;
}

export function isAgencyEnabledForPdAutomation(
  rollout: AgencyCollectionsRollout | null | undefined,
): boolean {
  if (!rollout) return false;
  return !rollout.collections_suspended && rollout.collections_pd_enabled;
}

export function isAgencyEnabledForDunning(
  rollout: AgencyCollectionsRollout | null | undefined,
): boolean {
  if (!rollout) return false;
  return !rollout.collections_suspended && rollout.collections_dunning_enabled;
}

export function isAgencyEnabledForFallback(
  rollout: AgencyCollectionsRollout | null | undefined,
): boolean {
  if (!rollout) return false;
  return !rollout.collections_suspended && rollout.collections_fallback_enabled;
}

export function canAutoSyncFallbackForAgency(
  rollout: AgencyCollectionsRollout | null | undefined,
): boolean {
  if (!rollout) return false;
  return (
    !rollout.collections_suspended &&
    rollout.collections_fallback_enabled &&
    rollout.collections_fallback_auto_sync_enabled
  );
}

export function resolveAgencyCutoffHourAr(input: {
  rollout: AgencyCollectionsRollout | null | undefined;
  globalCutoffHourAr: number | null;
}): number | null {
  const override = input.rollout?.collections_cutoff_override_hour_ar;
  if (override != null && Number.isFinite(override) && override >= 0 && override <= 23) {
    return Math.trunc(override);
  }

  if (
    input.globalCutoffHourAr != null &&
    Number.isFinite(input.globalCutoffHourAr) &&
    input.globalCutoffHourAr >= 0 &&
    input.globalCutoffHourAr <= 23
  ) {
    return Math.trunc(input.globalCutoffHourAr);
  }

  return null;
}
