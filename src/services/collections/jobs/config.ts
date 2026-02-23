import { BUENOS_AIRES_TIME_ZONE } from "@/lib/buenosAiresDate";

export type BillingJobSource = "CRON" | "MANUAL" | "SYSTEM";

export type BillingJobsConfig = {
  enabled: boolean;
  timezone: string;
  pdAdapter: string;
  autoExport: boolean;
  autoReconcile: boolean;
  fiscalAutorun: boolean;
  fallbackEnabled: boolean;
  fallbackDefaultProvider: "CIG_QR" | "MP" | "OTHER";
  fallbackAutoSync: boolean;
  fallbackSyncBatchSize: number;
  lockTtlSeconds: number;
  runnerSecret: string | null;
  batchCutoffHourAr: number | null;
  rolloutRequireAgencyFlag: boolean;
  reviewCasesEnabled: boolean;
  healthStaleExportHours: number;
  healthStaleReconcileHours: number;
};

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "si"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseInteger(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(input || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseBatchCutoffHour(raw: string | undefined): number | null {
  const parsed = Number.parseInt(String(raw || "").trim(), 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 23) return null;
  return parsed;
}

export function getBillingJobsConfig(): BillingJobsConfig {
  const fallbackProviderRaw = String(
    process.env.BILLING_FALLBACK_DEFAULT_PROVIDER || "cig_qr",
  )
    .trim()
    .toLowerCase();

  return {
    enabled: parseBoolean(process.env.BILLING_JOBS_ENABLED, false),
    timezone:
      process.env.BILLING_JOBS_TZ?.trim() || BUENOS_AIRES_TIME_ZONE,
    pdAdapter:
      process.env.BILLING_PD_ADAPTER?.trim().toLowerCase() || "debug_csv",
    autoExport: parseBoolean(process.env.BILLING_BATCH_AUTO_EXPORT, true),
    autoReconcile: parseBoolean(process.env.BILLING_BATCH_AUTO_RECONCILE, false),
    fiscalAutorun: parseBoolean(process.env.BILLING_FISCAL_AUTORUN, false),
    fallbackEnabled: parseBoolean(process.env.BILLING_DUNNING_ENABLE_FALLBACK, true),
    fallbackDefaultProvider:
      fallbackProviderRaw === "mp"
        ? "MP"
        : fallbackProviderRaw === "other"
          ? "OTHER"
          : "CIG_QR",
    fallbackAutoSync: parseBoolean(process.env.BILLING_FALLBACK_AUTO_SYNC, false),
    fallbackSyncBatchSize: Math.max(
      1,
      parseInteger(process.env.BILLING_FALLBACK_SYNC_BATCH_SIZE, 100),
    ),
    lockTtlSeconds: Math.max(
      60,
      parseInteger(process.env.BILLING_JOB_LOCK_TTL_SECONDS, 15 * 60),
    ),
    runnerSecret: process.env.BILLING_JOB_RUNNER_SECRET?.trim() || null,
    batchCutoffHourAr: parseBatchCutoffHour(process.env.BILLING_BATCH_CUTOFF_HOUR_AR),
    rolloutRequireAgencyFlag: parseBoolean(
      process.env.BILLING_COLLECTIONS_ROLLOUT_REQUIRE_AGENCY_FLAG,
      true,
    ),
    reviewCasesEnabled: parseBoolean(process.env.BILLING_REVIEW_CASES_ENABLED, true),
    healthStaleExportHours: Math.max(
      1,
      parseInteger(process.env.BILLING_HEALTH_STALE_EXPORT_HOURS, 24),
    ),
    healthStaleReconcileHours: Math.max(
      1,
      parseInteger(process.env.BILLING_HEALTH_STALE_RECONCILE_HOURS, 24),
    ),
  };
}
