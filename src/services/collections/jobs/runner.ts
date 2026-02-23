import { createHash } from "node:crypto";
import type {
  BillingFallbackProvider,
  BillingJobRunStatus,
  BillingJobSource,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { toDateKeyInBuenosAires } from "@/lib/buenosAiresDate";
import {
  hourInBuenosAires,
  isBusinessDayAr,
} from "@/services/collections/core/businessCalendarAr";
import {
  getAgencyCollectionsRolloutMap,
  isAgencyEnabledForPdAutomation,
} from "@/services/collections/core/agencyCollectionsRollout";
import {
  addDaysLocal,
  dateKeyInTimeZone,
  startOfLocalDay,
} from "@/services/collections/core/dates";
import { runAnchor } from "@/services/collections/core/runAnchor";
import {
  exportPendingPreparedBatches,
  exportPresentmentBatch,
  importResponseBatch,
  preparePresentmentBatch,
  type ExportPendingPreparedBatchesResult,
  type PreparePresentmentBatchResult,
} from "@/services/collections/galicia/direct-debit/batches";
import { getBillingJobsConfig } from "@/services/collections/jobs/config";
import {
  acquireBillingJobLock,
  releaseBillingJobLock,
} from "@/services/collections/jobs/locks";
import {
  finishBillingJobRun,
  listRecentBillingJobRuns,
  startBillingJobRun,
  type BillingJobCounters,
  type BillingJobName,
} from "@/services/collections/jobs/runs";
import {
  createFallbackForEligibleCharges,
  syncFallbackStatuses,
} from "@/services/collections/dunning/service";

type JobTerminalStatus = Exclude<BillingJobRunStatus, "RUNNING">;
const OPEN_FALLBACK_STATUSES = ["CREATED", "PENDING", "PRESENTED"] as const;

export type BillingJobResult = {
  job_name: BillingJobName;
  run_id: string;
  status: JobTerminalStatus;
  target_date_ar: string | null;
  adapter: string | null;
  started_at: Date;
  finished_at: Date;
  duration_ms: number;
  counters: BillingJobCounters;
  lock_key: string;
  skipped_locked: boolean;
  no_op: boolean;
  error_message: string | null;
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "Error inesperado en job de cobranzas");
}

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "si"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function nowDateKey(timezone: string, now = new Date()): string {
  return dateKeyInTimeZone(now, timezone);
}

function dayWindowForDateKey(input: {
  dateKey: string;
  timezone: string;
}): {
  start: Date;
  endExclusive: Date;
} {
  const start = startOfLocalDay(input.dateKey, input.timezone);
  const endExclusive = addDaysLocal(start, 1, input.timezone);
  return { start, endExclusive };
}

async function executeBillingJob(input: {
  jobName: BillingJobName;
  source: BillingJobSource;
  lockKey: string;
  now?: Date;
  targetDateAr?: string | null;
  adapter?: string | null;
  actorUserId?: number | null;
  metadata?: Record<string, unknown>;
  onExecute: (ctx: { runId: string; now: Date }) => Promise<{
    status: JobTerminalStatus;
    counters: BillingJobCounters;
    metadata?: Record<string, unknown>;
    noOp?: boolean;
    errorMessage?: string | null;
  }>;
}): Promise<BillingJobResult> {
  const config = getBillingJobsConfig();
  const startedAt = new Date();
  const run = await startBillingJobRun({
    jobName: input.jobName,
    source: input.source,
    targetDateAr: input.targetDateAr ?? null,
    adapter: input.adapter ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: {
      ...(input.metadata || {}),
      lock_key: input.lockKey,
    },
  });

  console.info("[billing-jobs] started", {
    job_name: input.jobName,
    run_id: run.runId,
    source: input.source,
    target_date_ar: input.targetDateAr ?? null,
    adapter: input.adapter ?? null,
    lock_key: input.lockKey,
    started_at: startedAt.toISOString(),
  });

  const lock = await acquireBillingJobLock({
    lockKey: input.lockKey,
    ownerRunId: run.runId,
    ttlSeconds: config.lockTtlSeconds,
    metadata: {
      job_name: input.jobName,
      source: input.source,
      target_date_ar: input.targetDateAr ?? null,
      adapter: input.adapter ?? null,
    },
  });

  if (!lock.acquired) {
    const finishedAt = new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    const counters = { skipped_locked: 1 };

    await finishBillingJobRun({
      id: run.id,
      status: "SKIPPED_LOCKED",
      counters,
      finishedAt,
      metadata: {
        lock_key: input.lockKey,
      },
      errorMessage: null,
      errorStack: null,
    });

    console.info("[billing-jobs] skipped_locked", {
      job_name: input.jobName,
      run_id: run.runId,
      lock_key: input.lockKey,
      duration_ms: durationMs,
    });

    return {
      job_name: input.jobName,
      run_id: run.runId,
      status: "SKIPPED_LOCKED",
      target_date_ar: input.targetDateAr ?? null,
      adapter: input.adapter ?? null,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: durationMs,
      counters,
      lock_key: input.lockKey,
      skipped_locked: true,
      no_op: true,
      error_message: null,
    };
  }

  try {
    const result = await input.onExecute({
      runId: run.runId,
      now: input.now || new Date(),
    });

    const finishedAt = new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

    await finishBillingJobRun({
      id: run.id,
      status: result.status,
      counters: result.counters,
      metadata: {
        ...(result.metadata || {}),
        lock_key: input.lockKey,
      },
      errorMessage: result.errorMessage ?? null,
      errorStack: null,
      finishedAt,
    });

    console.info("[billing-jobs] finished", {
      job_name: input.jobName,
      run_id: run.runId,
      status: result.status,
      target_date_ar: input.targetDateAr ?? null,
      adapter: input.adapter ?? null,
      counters: result.counters,
      duration_ms: durationMs,
    });

    return {
      job_name: input.jobName,
      run_id: run.runId,
      status: result.status,
      target_date_ar: input.targetDateAr ?? null,
      adapter: input.adapter ?? null,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: durationMs,
      counters: result.counters,
      lock_key: input.lockKey,
      skipped_locked: false,
      no_op: Boolean(result.noOp || result.status === "NO_OP"),
      error_message: result.errorMessage ?? null,
    };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const stack = error instanceof Error ? error.stack || null : null;
    const finishedAt = new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

    await finishBillingJobRun({
      id: run.id,
      status: "FAILED",
      counters: { errors_count: 1 },
      errorMessage: message,
      errorStack: stack,
      finishedAt,
      metadata: {
        lock_key: input.lockKey,
      },
    });

    console.error("[billing-jobs] failed", {
      job_name: input.jobName,
      run_id: run.runId,
      lock_key: input.lockKey,
      error: message,
      duration_ms: durationMs,
    });

    return {
      job_name: input.jobName,
      run_id: run.runId,
      status: "FAILED",
      target_date_ar: input.targetDateAr ?? null,
      adapter: input.adapter ?? null,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: durationMs,
      counters: { errors_count: 1 },
      lock_key: input.lockKey,
      skipped_locked: false,
      no_op: false,
      error_message: message,
    };
  } finally {
    await releaseBillingJobLock({
      lockKey: input.lockKey,
      ownerRunId: run.runId,
    });
  }
}

function resolveTargetDateAr(input: {
  targetDateAr?: string | null;
  timezone: string;
  now?: Date;
}): string {
  const explicit = String(input.targetDateAr || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return nowDateKey(input.timezone, input.now || new Date());
}

function resolveFallbackProvider(
  provider?: string | BillingFallbackProvider | null,
): BillingFallbackProvider {
  const normalized = String(provider || "")
    .trim()
    .toUpperCase();
  if (normalized === "MP") return "MP";
  if (normalized === "OTHER") return "OTHER";
  if (normalized === "CIG_QR") return "CIG_QR";
  return "CIG_QR";
}

function hasPassedGlobalCutoff(input: {
  now: Date;
  targetDateAr: string;
  cutoffHourAr: number | null;
}): boolean {
  if (input.cutoffHourAr == null) return false;
  const nowKey = toDateKeyInBuenosAires(input.now);
  if (!nowKey || nowKey !== input.targetDateAr) return false;
  return hourInBuenosAires(input.now) >= input.cutoffHourAr;
}

function shouldEnforceOperationalWindow(source: BillingJobSource): boolean {
  return source === "CRON";
}

async function resolvePdRolloutStats(): Promise<{
  agenciesConsidered: number;
  agenciesEnabled: number;
  agenciesSkippedDisabled: number;
  eligibleAgencyIds: number[];
  applyAgencyFilter: boolean;
}> {
  const subscriptionsDelegate = (prisma as unknown as {
    agencyBillingSubscription?: {
      findMany?: (args: unknown) => Promise<Array<{ id_agency: number }>>;
    };
  }).agencyBillingSubscription;

  if (!subscriptionsDelegate || typeof subscriptionsDelegate.findMany !== "function") {
    return {
      agenciesConsidered: 0,
      agenciesEnabled: 0,
      agenciesSkippedDisabled: 0,
      eligibleAgencyIds: [],
      applyAgencyFilter: false,
    };
  }

  const subscriptions = await subscriptionsDelegate.findMany({
    where: { status: "ACTIVE" },
    select: { id_agency: true },
  });

  const agencyIds = Array.from(new Set(subscriptions.map((sub) => sub.id_agency)));
  const rolloutMap = await getAgencyCollectionsRolloutMap({ agencyIds });
  const eligibleAgencyIds = agencyIds.filter((agencyId) =>
    isAgencyEnabledForPdAutomation(rolloutMap.get(agencyId)),
  );

  return {
    agenciesConsidered: agencyIds.length,
    agenciesEnabled: eligibleAgencyIds.length,
    agenciesSkippedDisabled: Math.max(0, agencyIds.length - eligibleAgencyIds.length),
    eligibleAgencyIds,
    applyAgencyFilter: true,
  };
}

export async function runAnchorDailyJob(input?: {
  source?: BillingJobSource;
  actorUserId?: number | null;
  targetDateAr?: string | null;
  overrideFx?: boolean;
  now?: Date;
}): Promise<BillingJobResult> {
  const config = getBillingJobsConfig();
  const source = input?.source || "SYSTEM";
  const targetDateAr = resolveTargetDateAr({
    targetDateAr: input?.targetDateAr,
    timezone: config.timezone,
    now: input?.now,
  });
  const anchorDate = startOfLocalDay(targetDateAr, config.timezone);
  const overrideFx = Boolean(input?.overrideFx);

  return executeBillingJob({
    jobName: "run_anchor_daily",
    source,
    now: input?.now,
    lockKey: `billing:run_anchor:${targetDateAr}`,
    targetDateAr,
    actorUserId: input?.actorUserId ?? null,
    onExecute: async () => {
      const rollout = await resolvePdRolloutStats();
      if (rollout.applyAgencyFilter && rollout.eligibleAgencyIds.length === 0) {
        return {
          status: "NO_OP" as JobTerminalStatus,
          noOp: true,
          counters: {
            anchor_date: targetDateAr,
            subscriptions_considered: 0,
            subscriptions_processed: 0,
            cycles_created: 0,
            charges_created: 0,
            attempts_created: 0,
            skipped_idempotent: 0,
            errors_count: 0,
            agencies_considered: rollout.agenciesConsidered,
            agencies_processed: 0,
            agencies_skipped_disabled: rollout.agenciesSkippedDisabled,
          },
        };
      }

      const summary = await runAnchor({
        anchorDate,
        overrideFx,
        actorUserId: input?.actorUserId ?? null,
        agencyIds: rollout.applyAgencyFilter
          ? rollout.eligibleAgencyIds
          : undefined,
      });

      const status: JobTerminalStatus =
        summary.errors.length > 0
          ? summary.subscriptions_processed > 0
            ? "PARTIAL"
            : "FAILED"
          : summary.subscriptions_processed > 0
            ? "SUCCESS"
            : "NO_OP";

      return {
        status,
        noOp: status === "NO_OP",
        counters: {
          anchor_date: summary.anchor_date,
          subscriptions_considered: summary.subscriptions_total,
          subscriptions_processed: summary.subscriptions_processed,
          cycles_created: summary.cycles_created,
          charges_created: summary.charges_created,
          attempts_created: summary.attempts_created,
          skipped_idempotent: summary.skipped_idempotent ?? 0,
          errors_count: summary.errors.length,
          agencies_considered: rollout.agenciesConsidered,
          agencies_processed: rollout.applyAgencyFilter
            ? rollout.agenciesEnabled
            : 0,
          agencies_skipped_disabled: rollout.agenciesSkippedDisabled,
        },
        metadata: {
          fx_rates_used: summary.fx_rates_used,
          errors: summary.errors,
        },
      };
    },
  });
}

function summarizePrepareResult(result: PreparePresentmentBatchResult): BillingJobCounters {
  return {
    no_op: result.no_op,
    dry_run: result.dry_run,
    batch_id: result.batch_id,
    adapter: result.adapter,
    attempts_count: result.attempts_count,
    amount_total: result.amount_total,
    eligible_attempts: result.eligible_attempts,
    deferred_by_cutoff: result.deferred_by_cutoff ?? 0,
    agencies_considered: result.agencies_considered ?? 0,
    agencies_processed: result.agencies_processed ?? 0,
    agencies_skipped_disabled: result.agencies_skipped_disabled ?? 0,
  };
}

export async function preparePdBatchJob(input?: {
  source?: BillingJobSource;
  actorUserId?: number | null;
  targetDateAr?: string | null;
  adapter?: string | null;
  dryRun?: boolean;
  force?: boolean;
  now?: Date;
}): Promise<BillingJobResult> {
  const config = getBillingJobsConfig();
  const source = input?.source || "SYSTEM";
  const targetDateAr = resolveTargetDateAr({
    targetDateAr: input?.targetDateAr,
    timezone: config.timezone,
    now: input?.now,
  });
  const adapter = String(input?.adapter || config.pdAdapter).trim().toLowerCase();
  const businessDate = startOfLocalDay(targetDateAr, config.timezone);
  const dryRun = Boolean(input?.dryRun);
  const force = Boolean(input?.force);

  return executeBillingJob({
    jobName: "prepare_pd_batch",
    source,
    now: input?.now,
    lockKey: `billing:prepare_batch:${adapter}:${targetDateAr}`,
    targetDateAr,
    adapter,
    actorUserId: input?.actorUserId ?? null,
    metadata: {
      dry_run: dryRun,
      force,
    },
    onExecute: async ({ now }) => {
      const enforceOperationalWindow =
        shouldEnforceOperationalWindow(source) && !force;

      if (enforceOperationalWindow && !isBusinessDayAr(targetDateAr)) {
        const counters: BillingJobCounters = {
          no_op: true,
          reason: "non_business_day",
          skipped_non_business_day: 1,
          deferred_by_cutoff: 0,
        };
        return {
          status: "NO_OP" as JobTerminalStatus,
          noOp: true,
          counters,
        };
      }

      if (
        enforceOperationalWindow &&
        hasPassedGlobalCutoff({
          now,
          targetDateAr,
          cutoffHourAr: config.batchCutoffHourAr,
        })
      ) {
        const counters: BillingJobCounters = {
          no_op: true,
          reason: "deferred_to_next_window",
          deferred_by_cutoff: 1,
          skipped_non_business_day: 0,
        };
        return {
          status: "NO_OP" as JobTerminalStatus,
          noOp: true,
          counters,
        };
      }

      const prepared = await preparePresentmentBatch({
        businessDate,
        actorUserId: input?.actorUserId ?? null,
        adapterName: adapter,
        dryRun,
        globalCutoffHourAr: config.batchCutoffHourAr,
        force,
      });

      const status: JobTerminalStatus = prepared.no_op ? "NO_OP" : "SUCCESS";
      return {
        status,
        noOp: prepared.no_op,
        counters: summarizePrepareResult(prepared),
      };
    },
  });
}

function summarizeExportResult(
  result: ExportPendingPreparedBatchesResult,
): BillingJobCounters {
  return {
    batches_considered: result.batches_considered,
    batches_exported: result.batches_exported,
    already_exported: result.already_exported,
    no_op: result.no_op,
    errors_count: result.errors.length,
    batch_ids: result.batch_ids.join(","),
  };
}

export async function exportPdBatchJob(input?: {
  source?: BillingJobSource;
  actorUserId?: number | null;
  targetDateAr?: string | null;
  adapter?: string | null;
  batchId?: number | null;
  force?: boolean;
  now?: Date;
}): Promise<BillingJobResult> {
  const config = getBillingJobsConfig();
  const source = input?.source || "SYSTEM";
  const targetDateAr = resolveTargetDateAr({
    targetDateAr: input?.targetDateAr,
    timezone: config.timezone,
    now: input?.now,
  });
  const adapter = String(input?.adapter || config.pdAdapter).trim().toLowerCase();
  const batchId = input?.batchId && input.batchId > 0 ? input.batchId : null;
  const force = Boolean(input?.force);
  const lockKey = batchId
    ? `billing:export_batch:${batchId}`
    : `billing:export_batch:${adapter}:${targetDateAr}`;

  return executeBillingJob({
    jobName: "export_pd_batch",
    source,
    now: input?.now,
    lockKey,
    targetDateAr,
    adapter,
    actorUserId: input?.actorUserId ?? null,
    onExecute: async ({ now }) => {
      const enforceOperationalWindow =
        shouldEnforceOperationalWindow(source) && !force;

      if (!batchId && enforceOperationalWindow && !isBusinessDayAr(targetDateAr)) {
        const counters: BillingJobCounters = {
          no_op: true,
          reason: "non_business_day",
          skipped_non_business_day: 1,
          deferred_by_cutoff: 0,
        };
        return {
          status: "NO_OP" as JobTerminalStatus,
          noOp: true,
          counters,
        };
      }

      if (
        !batchId &&
        enforceOperationalWindow &&
        hasPassedGlobalCutoff({
          now,
          targetDateAr,
          cutoffHourAr: config.batchCutoffHourAr,
        })
      ) {
        const counters: BillingJobCounters = {
          no_op: true,
          reason: "deferred_to_next_window",
          deferred_by_cutoff: 1,
          skipped_non_business_day: 0,
        };
        return {
          status: "NO_OP" as JobTerminalStatus,
          noOp: true,
          counters,
        };
      }

      if (batchId) {
        const exported = await exportPresentmentBatch({
          batchId,
          actorUserId: input?.actorUserId ?? null,
        });
        const status: JobTerminalStatus = exported.already_exported
          ? "NO_OP"
          : exported.exported
            ? "SUCCESS"
            : "NO_OP";
        const counters: BillingJobCounters = {
          batch_id: batchId,
          exported: exported.exported,
          already_exported: exported.already_exported,
          status: exported.status,
          amount_total: exported.amount_total,
          record_count: exported.record_count,
        };
        return {
          status,
          noOp: status === "NO_OP",
          counters,
        };
      }

      const result = await exportPendingPreparedBatches({
        actorUserId: input?.actorUserId ?? null,
        adapterName: adapter,
      });
      const status: JobTerminalStatus =
        result.errors.length > 0
          ? result.batches_exported > 0
            ? "PARTIAL"
            : "FAILED"
          : result.no_op
            ? "NO_OP"
            : "SUCCESS";

      return {
        status,
        noOp: result.no_op,
        counters: summarizeExportResult(result),
        metadata: {
          errors: result.errors,
        },
      };
    },
  });
}

export async function reconcilePdBatchJob(input: {
  source?: BillingJobSource;
  actorUserId?: number | null;
  outboundBatchId?: number | null;
  fileName?: string | null;
  fileBytes?: Buffer | null;
  fileContentType?: string | null;
}): Promise<BillingJobResult> {
  const config = getBillingJobsConfig();
  const source = input.source || "SYSTEM";
  const targetDateAr = nowDateKey(config.timezone);
  const fileHash = input.fileBytes
    ? createHash("sha256").update(input.fileBytes).digest("hex")
    : null;
  const lockKey = input.outboundBatchId
    ? `billing:reconcile:${input.outboundBatchId}:${fileHash || "nofile"}`
    : `billing:reconcile:${targetDateAr}:nofile`;

  return executeBillingJob({
    jobName: "reconcile_pd_batch",
    source,
    lockKey,
    targetDateAr,
    actorUserId: input.actorUserId ?? null,
    onExecute: async () => {
      if (!input.outboundBatchId || !input.fileBytes) {
        const counters: BillingJobCounters = {
          no_op: true,
          reason: "missing_inbound_file_or_batch",
        };
        return {
          status: "NO_OP",
          noOp: true,
          counters,
        };
      }

      const imported = await importResponseBatch({
        outboundBatchId: input.outboundBatchId,
        uploadedFile: {
          fileName: input.fileName || `respuesta-${input.outboundBatchId}.csv`,
          bytes: input.fileBytes,
          contentType: input.fileContentType || "text/csv",
        },
        actorUserId: input.actorUserId ?? null,
      });

      const counters: BillingJobCounters = {
        outbound_batch_id: input.outboundBatchId,
        inbound_batch_id: imported.inbound_batch_id,
        already_imported: imported.already_imported,
        matched_rows: imported.summary.matched_rows,
        paid: imported.summary.paid,
        rejected: imported.summary.rejected,
        error_rows: imported.summary.error_rows,
        fiscal_issued: imported.summary.fiscal_issued,
        fiscal_failed: imported.summary.fiscal_failed,
      };

      return {
        status: imported.already_imported ? "NO_OP" : "SUCCESS",
        noOp: imported.already_imported,
        counters,
      };
    },
  });
}

export async function fallbackCreateJob(input?: {
  source?: BillingJobSource;
  actorUserId?: number | null;
  targetDateAr?: string | null;
  provider?: BillingFallbackProvider | null;
  chargeId?: number | null;
  dryRun?: boolean;
  now?: Date;
}): Promise<BillingJobResult> {
  const config = getBillingJobsConfig();
  const source = input?.source || "SYSTEM";
  const targetDateAr = resolveTargetDateAr({
    targetDateAr: input?.targetDateAr,
    timezone: config.timezone,
    now: input?.now,
  });
  const provider = resolveFallbackProvider(
    input?.provider || config.fallbackDefaultProvider,
  );
  const chargeId = input?.chargeId && input.chargeId > 0 ? input.chargeId : null;
  const dryRun = Boolean(input?.dryRun);
  const lockKey = chargeId
    ? `billing:fallback_create:charge:${chargeId}`
    : `billing:fallback_create:${targetDateAr}`;

  return executeBillingJob({
    jobName: "fallback_create",
    source,
    now: input?.now,
    lockKey,
    targetDateAr,
    adapter: provider,
    actorUserId: input?.actorUserId ?? null,
    metadata: {
      dry_run: dryRun,
      charge_id: chargeId,
    },
    onExecute: async () => {
      if (!config.fallbackEnabled) {
        const counters: BillingJobCounters = {
          no_op: true,
          reason: "fallback_disabled",
        };
        return {
          status: "NO_OP",
          noOp: true,
          counters,
        };
      }

      const created = await createFallbackForEligibleCharges({
        chargeId,
        provider,
        dryRun,
        actorUserId: input?.actorUserId ?? null,
      });

      const status: JobTerminalStatus = created.no_op ? "NO_OP" : "SUCCESS";
      const counters: BillingJobCounters = {
        considered: created.considered,
        created: created.created,
        no_op: created.no_op,
        ids: created.ids.join(","),
        reasons: created.reasons.slice(0, 20).join(";") || null,
      };
      return {
        status,
        noOp: created.no_op,
        counters,
      };
    },
  });
}

export async function fallbackStatusSyncJob(input?: {
  source?: BillingJobSource;
  actorUserId?: number | null;
  targetDateAr?: string | null;
  provider?: BillingFallbackProvider | null;
  fallbackIntentId?: number | null;
  limit?: number;
  now?: Date;
}): Promise<BillingJobResult> {
  const config = getBillingJobsConfig();
  const source = input?.source || "SYSTEM";
  const targetDateAr = resolveTargetDateAr({
    targetDateAr: input?.targetDateAr,
    timezone: config.timezone,
    now: input?.now,
  });
  const provider = resolveFallbackProvider(
    input?.provider || config.fallbackDefaultProvider,
  );
  const fallbackIntentId =
    input?.fallbackIntentId && input.fallbackIntentId > 0
      ? input.fallbackIntentId
      : null;
  const lockKey = fallbackIntentId
    ? `billing:fallback_sync:intent:${fallbackIntentId}`
    : `billing:fallback_sync:${provider}:${targetDateAr}`;

  return executeBillingJob({
    jobName: "fallback_status_sync",
    source,
    now: input?.now,
    lockKey,
    targetDateAr,
    adapter: provider,
    actorUserId: input?.actorUserId ?? null,
    onExecute: async () => {
      if (!config.fallbackEnabled) {
        const counters: BillingJobCounters = {
          no_op: true,
          reason: "fallback_disabled",
        };
        return {
          status: "NO_OP",
          noOp: true,
          counters,
        };
      }

      const synced = await syncFallbackStatuses({
        provider,
        fallbackIntentId,
        limit: input?.limit ?? config.fallbackSyncBatchSize,
        actorUserId: input?.actorUserId ?? null,
        onlyAutoSyncEnabled: source === "CRON",
      });

      const status: JobTerminalStatus = synced.no_op ? "NO_OP" : "SUCCESS";
      const counters: BillingJobCounters = {
        considered: synced.considered,
        paid: synced.paid,
        pending: synced.pending,
        expired: synced.expired,
        failed: synced.failed,
        no_op: synced.no_op,
        ids: synced.ids.join(","),
      };
      return {
        status,
        noOp: synced.no_op,
        counters,
      };
    },
  });
}

export async function runBillingCronTick(input?: {
  now?: Date;
}): Promise<{
  enabled: boolean;
  timezone: string;
  run_anchor: BillingJobResult | null;
  prepare_batch: BillingJobResult | null;
  export_batch: BillingJobResult | null;
  reconcile_batch: BillingJobResult | null;
  fallback_create: BillingJobResult | null;
  fallback_status_sync: BillingJobResult | null;
}> {
  const config = getBillingJobsConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      timezone: config.timezone,
      run_anchor: null,
      prepare_batch: null,
      export_batch: null,
      reconcile_batch: null,
      fallback_create: null,
      fallback_status_sync: null,
    };
  }

  const now = input?.now || new Date();
  const dateKey = nowDateKey(config.timezone, now);

  const runAnchorResult = await runAnchorDailyJob({
    source: "CRON",
    targetDateAr: dateKey,
    overrideFx: parseBoolean(process.env.BILLING_RUN_ANCHOR_OVERRIDE_FX, false),
  });

  const prepareResult = await preparePdBatchJob({
    source: "CRON",
    targetDateAr: dateKey,
    adapter: config.pdAdapter,
    dryRun: false,
  });

  const exportResult = config.autoExport
    ? await exportPdBatchJob({
        source: "CRON",
        targetDateAr: dateKey,
        adapter: config.pdAdapter,
      })
    : null;

  const reconcileResult = config.autoReconcile
    ? await reconcilePdBatchJob({
        source: "CRON",
      })
    : null;

  const fallbackCreateResult = config.fallbackEnabled
    ? await fallbackCreateJob({
        source: "CRON",
        targetDateAr: dateKey,
        provider: config.fallbackDefaultProvider,
      })
    : null;

  const fallbackSyncResult =
    config.fallbackEnabled && config.fallbackAutoSync
      ? await fallbackStatusSyncJob({
          source: "CRON",
          targetDateAr: dateKey,
          provider: config.fallbackDefaultProvider,
        })
      : null;

  return {
    enabled: true,
    timezone: config.timezone,
    run_anchor: runAnchorResult,
    prepare_batch: prepareResult,
    export_batch: exportResult,
    reconcile_batch: reconcileResult,
    fallback_create: fallbackCreateResult,
    fallback_status_sync: fallbackSyncResult,
  };
}

export async function getBillingJobsOverview(input?: {
  timezone?: string;
  now?: Date;
  runsLimit?: number;
}): Promise<{
  timezone: string;
  today_date_ar: string;
  metrics: {
    pending_attempts: number;
    processing_attempts: number;
    paid_today: number;
    rejected_today: number;
    overdue_charges: number;
    batches_prepared_today: number;
    batches_exported_today: number;
    batches_imported_today: number;
    charges_fallback_offered: number;
    fallback_intents_pending: number;
    fallback_paid_today: number;
    fallback_expired_today: number;
    paid_via_pd_last_30d: number;
    paid_via_fallback_last_30d: number;
    jobs_failed_last_24h: number;
    stale_prepared_batches: number;
    stale_exported_batches: number;
    fallback_expiring_24h: number;
    review_cases_open: number;
    charges_escalated_suspended: number;
    late_duplicates_last_30d: number;
    recovery_rate_30d: number;
  };
  recent_runs: Awaited<ReturnType<typeof listRecentBillingJobRuns>>;
}> {
  const config = getBillingJobsConfig();
  const timezone = input?.timezone || config.timezone;
  const now = input?.now || new Date();
  const todayDateAr = nowDateKey(timezone, now);
  const todayWindow = dayWindowForDateKey({
    dateKey: todayDateAr,
    timezone,
  });
  const last30WindowStart = addDaysLocal(todayWindow.start, -30, timezone);
  const last24hWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const stalePreparedBefore = new Date(
    now.getTime() - config.healthStaleExportHours * 60 * 60 * 1000,
  );
  const staleExportedBefore = new Date(
    now.getTime() - config.healthStaleReconcileHours * 60 * 60 * 1000,
  );
  const next24hWindowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [
    pendingAttempts,
    processingAttempts,
    paidToday,
    rejectedToday,
    overdueCharges,
    preparedToday,
    exportedToday,
    importedToday,
    chargesFallbackOffered,
    fallbackIntentsPending,
    fallbackPaidToday,
    fallbackExpiredToday,
    paidViaPdLast30d,
    paidViaFallbackLast30d,
    fallbackCreatedLast30d,
    jobsFailedLast24h,
    stalePreparedBatches,
    staleExportedBatches,
    fallbackExpiring24h,
    reviewCasesOpen,
    chargesEscalatedSuspended,
    lateDuplicatesLast30d,
    recentRuns,
  ] = await Promise.all([
    prisma.agencyBillingAttempt.count({
      where: {
        status: { in: ["PENDING", "SCHEDULED"] },
      },
    }),
    prisma.agencyBillingAttempt.count({
      where: { status: "PROCESSING" },
    }),
    prisma.agencyBillingCharge.count({
      where: {
        status: "PAID",
        paid_at: {
          gte: todayWindow.start,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingAttempt.count({
      where: {
        status: "REJECTED",
        processed_at: {
          gte: todayWindow.start,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingCharge.count({
      where: {
        status: { not: "PAID" },
        due_date: { lt: todayWindow.start },
      },
    }),
    prisma.agencyBillingFileBatch.count({
      where: {
        direction: "OUTBOUND",
        status: { in: ["PREPARED", "CREATED"] },
        created_at: {
          gte: todayWindow.start,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingFileBatch.count({
      where: {
        direction: "OUTBOUND",
        exported_at: {
          gte: todayWindow.start,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingFileBatch.count({
      where: {
        direction: "INBOUND",
        imported_at: {
          gte: todayWindow.start,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingCharge.count({
      where: {
        status: { not: "PAID" },
        dunning_stage: 3,
      },
    }),
    prisma.agencyBillingFallbackIntent.count({
      where: {
        status: { in: [...OPEN_FALLBACK_STATUSES] },
      },
    }),
    prisma.agencyBillingFallbackIntent.count({
      where: {
        status: "PAID",
        paid_at: {
          gte: todayWindow.start,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingFallbackIntent.count({
      where: {
        status: "EXPIRED",
        updated_at: {
          gte: todayWindow.start,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingCharge.count({
      where: {
        status: "PAID",
        paid_via_channel: "PD_GALICIA",
        paid_at: {
          gte: last30WindowStart,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingCharge.count({
      where: {
        status: "PAID",
        paid_via_channel: { in: ["CIG_QR", "MP", "OTHER"] },
        paid_at: {
          gte: last30WindowStart,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.agencyBillingFallbackIntent.count({
      where: {
        created_at: {
          gte: last30WindowStart,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    prisma.billingJobRun.count({
      where: {
        status: "FAILED",
        started_at: {
          gte: last24hWindowStart,
          lt: now,
        },
      },
    }),
    prisma.agencyBillingFileBatch.count({
      where: {
        direction: "OUTBOUND",
        status: { in: ["PREPARED", "CREATED"] },
        created_at: {
          lt: stalePreparedBefore,
        },
      },
    }),
    prisma.agencyBillingFileBatch.count({
      where: {
        direction: "OUTBOUND",
        status: "EXPORTED",
        exported_at: { lt: staleExportedBefore },
        childBatches: {
          none: {
            direction: "INBOUND",
            imported_at: { not: null },
          },
        },
      },
    }),
    prisma.agencyBillingFallbackIntent.count({
      where: {
        status: { in: [...OPEN_FALLBACK_STATUSES] },
        expires_at: {
          gte: now,
          lt: next24hWindowEnd,
        },
      },
    }),
    prisma.agencyBillingPaymentReviewCase.count({
      where: {
        status: { in: ["OPEN", "IN_REVIEW"] },
      },
    }),
    prisma.agencyBillingCharge.count({
      where: {
        status: { not: "PAID" },
        dunning_stage: { gte: 4 },
      },
    }),
    prisma.agencyBillingPaymentReviewCase.count({
      where: {
        type: "LATE_DUPLICATE_PAYMENT",
        detected_at: {
          gte: last30WindowStart,
          lt: todayWindow.endExclusive,
        },
      },
    }),
    listRecentBillingJobRuns({ limit: input?.runsLimit ?? 12 }),
  ]);

  const recoveryRate30d =
    fallbackCreatedLast30d > 0
      ? Number(
          ((paidViaFallbackLast30d / fallbackCreatedLast30d) * 100).toFixed(2),
        )
      : 0;

  return {
    timezone,
    today_date_ar: todayDateAr,
    metrics: {
      pending_attempts: pendingAttempts,
      processing_attempts: processingAttempts,
      paid_today: paidToday,
      rejected_today: rejectedToday,
      overdue_charges: overdueCharges,
      batches_prepared_today: preparedToday,
      batches_exported_today: exportedToday,
      batches_imported_today: importedToday,
      charges_fallback_offered: chargesFallbackOffered,
      fallback_intents_pending: fallbackIntentsPending,
      fallback_paid_today: fallbackPaidToday,
      fallback_expired_today: fallbackExpiredToday,
      paid_via_pd_last_30d: paidViaPdLast30d,
      paid_via_fallback_last_30d: paidViaFallbackLast30d,
      jobs_failed_last_24h: jobsFailedLast24h,
      stale_prepared_batches: stalePreparedBatches,
      stale_exported_batches: staleExportedBatches,
      fallback_expiring_24h: fallbackExpiring24h,
      review_cases_open: reviewCasesOpen,
      charges_escalated_suspended: chargesEscalatedSuspended,
      late_duplicates_last_30d: lateDuplicatesLast30d,
      recovery_rate_30d: recoveryRate30d,
    },
    recent_runs: recentRuns,
  };
}
