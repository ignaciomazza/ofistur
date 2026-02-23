import { beforeEach, describe, expect, it, vi } from "vitest";
import { toDateKeyInBuenosAires } from "@/lib/buenosAiresDate";

type LockRow = {
  id_lock: number;
  lock_key: string;
  acquired_at: Date;
  expires_at: Date;
  owner_run_id: string | null;
  metadata: Record<string, unknown> | null;
  released_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type JobRunRow = {
  id_job_run: number;
  job_name: string;
  run_id: string;
  source: "CRON" | "MANUAL" | "SYSTEM";
  status:
    | "RUNNING"
    | "SUCCESS"
    | "PARTIAL"
    | "FAILED"
    | "SKIPPED_LOCKED"
    | "NO_OP";
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  target_date_ar: string | null;
  adapter: string | null;
  counters_json: Record<string, unknown> | null;
  error_message: string | null;
  error_stack: string | null;
  metadata_json: Record<string, unknown> | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
};

let locks: LockRow[] = [];
let runs: JobRunRow[] = [];
let subscriptions: Array<{ id_agency: number; status: "ACTIVE" | "CANCELED" }> = [];
let agencyConfigs: Array<{
  id_agency: number;
  collections_pd_enabled: boolean;
  collections_dunning_enabled: boolean;
  collections_fallback_enabled: boolean;
  collections_fallback_provider: string | null;
  collections_fallback_auto_sync_enabled: boolean;
  collections_suspended: boolean;
  collections_cutoff_override_hour_ar: number | null;
  collections_notes: string | null;
}> = [];

const runAnchorMock = vi.fn();
const preparePresentmentBatchMock = vi.fn();
const exportPendingPreparedBatchesMock = vi.fn();
const exportPresentmentBatchMock = vi.fn();
const importResponseBatchMock = vi.fn();
const createFallbackForEligibleChargesMock = vi.fn();
const syncFallbackStatusesMock = vi.fn();

function clone<T>(value: T): T {
  return structuredClone(value);
}

vi.mock("@/services/collections/core/runAnchor", () => ({
  runAnchor: runAnchorMock,
}));

vi.mock("@/services/collections/galicia/direct-debit/batches", () => ({
  preparePresentmentBatch: preparePresentmentBatchMock,
  exportPendingPreparedBatches: exportPendingPreparedBatchesMock,
  exportPresentmentBatch: exportPresentmentBatchMock,
  importResponseBatch: importResponseBatchMock,
}));

vi.mock("@/services/collections/dunning/service", () => ({
  createFallbackForEligibleCharges: createFallbackForEligibleChargesMock,
  syncFallbackStatuses: syncFallbackStatusesMock,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    agencyBillingSubscription: {
      findMany: vi.fn(
        async ({ where }: { where?: { status?: "ACTIVE" | "CANCELED" } } = {}) =>
          clone(
            subscriptions
              .filter((item) =>
                where?.status ? item.status === where.status : true,
              )
              .map((item) => ({ id_agency: item.id_agency })),
          ),
      ),
    },
    agencyBillingConfig: {
      findMany: vi.fn(async ({ where }: { where?: { id_agency?: { in?: number[] } } } = {}) => {
        const ids = where?.id_agency?.in || [];
        return clone(
          agencyConfigs.filter((item) => (ids.length ? ids.includes(item.id_agency) : true)),
        );
      }),
    },
    billingJobLock: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const lockKey = String(data.lock_key);
        if (locks.some((item) => item.lock_key === lockKey)) {
          throw { code: "P2002" };
        }

        const now = new Date();
        const row: LockRow = {
          id_lock: locks.length + 1,
          lock_key: lockKey,
          acquired_at: (data.acquired_at as Date) || now,
          expires_at: (data.expires_at as Date) || now,
          owner_run_id: (data.owner_run_id as string | null) || null,
          metadata: (data.metadata as Record<string, unknown> | null) || null,
          released_at: (data.released_at as Date | null) || null,
          created_at: now,
          updated_at: now,
        };
        locks.push(row);
        return clone(row);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of locks) {
          const keyOk =
            where.lock_key == null || row.lock_key === String(where.lock_key);
          if (!keyOk) continue;

          if (where.owner_run_id != null && row.owner_run_id !== where.owner_run_id) {
            continue;
          }

          if (where.released_at === null && row.released_at !== null) {
            continue;
          }

          const orConditions = (where.OR as Array<Record<string, unknown>> | undefined) || [];
          if (orConditions.length > 0) {
            const matchesOr = orConditions.some((condition) => {
              if (condition.expires_at && typeof condition.expires_at === "object") {
                const lte = (condition.expires_at as { lte?: Date }).lte;
                if (lte) {
                  return row.expires_at.getTime() <= lte.getTime();
                }
              }
              if (condition.released_at && typeof condition.released_at === "object") {
                const not = (condition.released_at as { not?: unknown }).not;
                if (not === null) {
                  return row.released_at !== null;
                }
              }
              return false;
            });
            if (!matchesOr) continue;
          }

          if (data.acquired_at instanceof Date) row.acquired_at = data.acquired_at;
          if (data.expires_at instanceof Date) row.expires_at = data.expires_at;
          if (typeof data.owner_run_id === "string") row.owner_run_id = data.owner_run_id;
          if ("metadata" in data) {
            row.metadata = (data.metadata as Record<string, unknown> | null) || null;
          }
          if ("released_at" in data) {
            row.released_at = (data.released_at as Date | null) || null;
          }
          row.updated_at = new Date();
          count += 1;
        }
        return { count };
      }),
      findUnique: vi.fn(async ({ where }: { where: { lock_key: string } }) => {
        const found = locks.find((item) => item.lock_key === where.lock_key);
        return found ? clone(found) : null;
      }),
    },
    billingJobRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: JobRunRow = {
          id_job_run: runs.length + 1,
          job_name: String(data.job_name),
          run_id: String(data.run_id),
          source: (data.source as JobRunRow["source"]) || "SYSTEM",
          status: (data.status as JobRunRow["status"]) || "RUNNING",
          started_at: now,
          finished_at: null,
          duration_ms: null,
          target_date_ar: (data.target_date_ar as string | null) || null,
          adapter: (data.adapter as string | null) || null,
          counters_json: null,
          error_message: null,
          error_stack: null,
          metadata_json: (data.metadata_json as Record<string, unknown> | null) || null,
          created_by: (data.created_by as number | null) || null,
          created_at: now,
          updated_at: now,
        };
        runs.push(row);
        return clone(row);
      }),
      findUnique: vi.fn(async ({ where }: { where: { id_job_run: number } }) => {
        const found = runs.find((item) => item.id_job_run === where.id_job_run);
        return found ? clone(found) : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id_job_run: number }; data: Record<string, unknown> }) => {
        const found = runs.find((item) => item.id_job_run === where.id_job_run);
        if (!found) throw new Error("run not found");
        if (typeof data.status === "string") found.status = data.status as JobRunRow["status"];
        if ("finished_at" in data) found.finished_at = (data.finished_at as Date | null) || null;
        if ("duration_ms" in data) found.duration_ms = Number(data.duration_ms ?? 0);
        if ("counters_json" in data) {
          found.counters_json = (data.counters_json as Record<string, unknown> | null) || null;
        }
        if ("error_message" in data) {
          found.error_message = (data.error_message as string | null) || null;
        }
        if ("error_stack" in data) {
          found.error_stack = (data.error_stack as string | null) || null;
        }
        if ("metadata_json" in data) {
          found.metadata_json = (data.metadata_json as Record<string, unknown> | null) || null;
        }
        found.updated_at = new Date();
        return clone(found);
      }),
      findMany: vi.fn(async () =>
        clone(
          [...runs].sort((a, b) => b.started_at.getTime() - a.started_at.getTime()),
        ),
      ),
    },
  },
}));

describe("billing jobs runner", () => {
  beforeEach(() => {
    locks = [];
    runs = [];
    subscriptions = [
      { id_agency: 1, status: "ACTIVE" },
      { id_agency: 2, status: "ACTIVE" },
    ];
    agencyConfigs = [
      {
        id_agency: 1,
        collections_pd_enabled: true,
        collections_dunning_enabled: true,
        collections_fallback_enabled: true,
        collections_fallback_provider: "CIG_QR",
        collections_fallback_auto_sync_enabled: true,
        collections_suspended: false,
        collections_cutoff_override_hour_ar: null,
        collections_notes: null,
      },
      {
        id_agency: 2,
        collections_pd_enabled: false,
        collections_dunning_enabled: false,
        collections_fallback_enabled: false,
        collections_fallback_provider: null,
        collections_fallback_auto_sync_enabled: false,
        collections_suspended: false,
        collections_cutoff_override_hour_ar: null,
        collections_notes: null,
      },
    ];
    runAnchorMock.mockReset();
    preparePresentmentBatchMock.mockReset();
    exportPendingPreparedBatchesMock.mockReset();
    exportPresentmentBatchMock.mockReset();
    importResponseBatchMock.mockReset();
    createFallbackForEligibleChargesMock.mockReset();
    syncFallbackStatusesMock.mockReset();

    process.env.BILLING_JOBS_ENABLED = "true";
    process.env.BILLING_JOBS_TZ = "America/Argentina/Buenos_Aires";
    process.env.BILLING_PD_ADAPTER = "debug_csv";
    process.env.BILLING_BATCH_AUTO_EXPORT = "true";
    process.env.BILLING_BATCH_AUTO_RECONCILE = "false";
    process.env.BILLING_FISCAL_AUTORUN = "false";
    process.env.BILLING_DUNNING_ENABLE_FALLBACK = "true";
    process.env.BILLING_FALLBACK_DEFAULT_PROVIDER = "cig_qr";
    process.env.BILLING_FALLBACK_AUTO_SYNC = "false";
    process.env.BILLING_FALLBACK_SYNC_BATCH_SIZE = "100";
    process.env.BILLING_JOB_LOCK_TTL_SECONDS = "60";
    process.env.BILLING_COLLECTIONS_ROLLOUT_REQUIRE_AGENCY_FLAG = "true";
    delete process.env.BILLING_BATCH_CUTOFF_HOUR_AR;
  });

  it("runAnchorDailyJob twice same date keeps idempotent counters and persists BillingJobRun", async () => {
    runAnchorMock
      .mockResolvedValueOnce({
        anchor_date: "2026-03-08",
        override_fx: false,
        subscriptions_total: 1,
        subscriptions_processed: 1,
        cycles_created: 1,
        charges_created: 1,
        attempts_created: 3,
        skipped_idempotent: 0,
        fx_rates_used: [],
        errors: [],
      })
      .mockResolvedValueOnce({
        anchor_date: "2026-03-08",
        override_fx: false,
        subscriptions_total: 1,
        subscriptions_processed: 1,
        cycles_created: 0,
        charges_created: 0,
        attempts_created: 0,
        skipped_idempotent: 1,
        fx_rates_used: [],
        errors: [],
      });

    const { runAnchorDailyJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const first = await runAnchorDailyJob({
      source: "MANUAL",
      targetDateAr: "2026-03-08",
      actorUserId: 7,
    });
    const second = await runAnchorDailyJob({
      source: "MANUAL",
      targetDateAr: "2026-03-08",
      actorUserId: 7,
    });

    const firstInput = runAnchorMock.mock.calls[0][0] as {
      anchorDate: Date;
      agencyIds?: number[];
    };
    expect(toDateKeyInBuenosAires(firstInput.anchorDate)).toBe("2026-03-08");
    expect(firstInput.agencyIds).toEqual([1]);
    expect(first.status).toBe("SUCCESS");
    expect(second.status).toBe("SUCCESS");
    expect((second.counters.skipped_idempotent as number) || 0).toBe(1);
    expect((first.counters.agencies_considered as number) || 0).toBe(2);
    expect((first.counters.agencies_processed as number) || 0).toBe(1);
    expect((first.counters.agencies_skipped_disabled as number) || 0).toBe(1);
    expect(runs).toHaveLength(2);
    expect(runs.every((item) => item.status !== "RUNNING")).toBe(true);
    const lockRow = locks.find((item) => item.lock_key === "billing:run_anchor:2026-03-08");
    expect(lockRow?.released_at).not.toBeNull();
  });

  it("prepare job returns SKIPPED_LOCKED when lock is active", async () => {
    locks.push({
      id_lock: 1,
      lock_key: "billing:prepare_batch:debug_csv:2026-03-08",
      acquired_at: new Date("2026-03-08T03:00:00.000Z"),
      expires_at: new Date("2026-03-08T23:59:59.000Z"),
      owner_run_id: "existing-lock",
      metadata: null,
      released_at: null,
      created_at: new Date("2026-03-08T03:00:00.000Z"),
      updated_at: new Date("2026-03-08T03:00:00.000Z"),
    });

    const { preparePdBatchJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const result = await preparePdBatchJob({
      source: "MANUAL",
      targetDateAr: "2026-03-08",
      adapter: "debug_csv",
    });

    expect(result.status).toBe("SKIPPED_LOCKED");
    expect(preparePresentmentBatchMock).not.toHaveBeenCalled();
  });

  it("prepare job can acquire expired lock and return NO_OP", async () => {
    locks.push({
      id_lock: 1,
      lock_key: "billing:prepare_batch:debug_csv:2026-03-08",
      acquired_at: new Date("2020-03-08T00:00:00.000Z"),
      expires_at: new Date("2020-03-08T00:00:10.000Z"),
      owner_run_id: "expired-lock",
      metadata: null,
      released_at: null,
      created_at: new Date("2020-03-08T00:00:00.000Z"),
      updated_at: new Date("2020-03-08T00:00:00.000Z"),
    });

    preparePresentmentBatchMock.mockResolvedValue({
      no_op: true,
      dry_run: false,
      batch_id: null,
      adapter: "debug_csv",
      attempts_count: 0,
      amount_total: 0,
      eligible_attempts: 0,
    });

    const { preparePdBatchJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const result = await preparePdBatchJob({
      source: "MANUAL",
      targetDateAr: "2026-03-08",
      adapter: "debug_csv",
      now: new Date("2026-03-08T03:30:00.000Z"),
    });

    expect(result.status).toBe("NO_OP");
    expect(result.skipped_locked).toBe(false);
    expect(preparePresentmentBatchMock).toHaveBeenCalledTimes(1);
  });

  it("export job returns NO_OP for already exported batches", async () => {
    exportPendingPreparedBatchesMock.mockResolvedValue({
      no_op: true,
      batches_considered: 1,
      batches_exported: 0,
      already_exported: 1,
      batch_ids: [24],
      errors: [],
    });

    const { exportPdBatchJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const result = await exportPdBatchJob({
      source: "MANUAL",
      targetDateAr: "2026-03-08",
      adapter: "debug_csv",
    });

    expect(result.status).toBe("NO_OP");
    expect((result.counters.already_exported as number) || 0).toBe(1);
  });

  it("prepare job in CRON skips non business day", async () => {
    const { preparePdBatchJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const result = await preparePdBatchJob({
      source: "CRON",
      targetDateAr: "2026-03-08", // domingo
      adapter: "debug_csv",
      now: new Date("2026-03-08T10:00:00.000Z"),
    });

    expect(result.status).toBe("NO_OP");
    expect((result.counters.skipped_non_business_day as number) || 0).toBe(1);
    expect(preparePresentmentBatchMock).not.toHaveBeenCalled();
  });

  it("export job in CRON defers when cutoff already passed", async () => {
    process.env.BILLING_BATCH_CUTOFF_HOUR_AR = "15";

    const { exportPdBatchJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const result = await exportPdBatchJob({
      source: "CRON",
      targetDateAr: "2026-03-09",
      adapter: "debug_csv",
      now: new Date("2026-03-09T19:00:00.000Z"), // 16:00 AR
    });

    expect(result.status).toBe("NO_OP");
    expect((result.counters.deferred_by_cutoff as number) || 0).toBe(1);
    expect(exportPendingPreparedBatchesMock).not.toHaveBeenCalled();
  });

  it("fallback create job persists SUCCESS counters", async () => {
    createFallbackForEligibleChargesMock.mockResolvedValue({
      considered: 2,
      created: 1,
      no_op: false,
      ids: [501],
      reasons: [],
    });

    const { fallbackCreateJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const result = await fallbackCreateJob({
      source: "MANUAL",
      targetDateAr: "2026-03-08",
      provider: "CIG_QR",
      actorUserId: 9,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.job_name).toBe("fallback_create");
    expect((result.counters.created as number) || 0).toBe(1);
  });

  it("fallback sync job returns NO_OP when there are no pending intents", async () => {
    syncFallbackStatusesMock.mockResolvedValue({
      considered: 0,
      paid: 0,
      pending: 0,
      expired: 0,
      failed: 0,
      no_op: true,
      ids: [],
    });

    const { fallbackStatusSyncJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const result = await fallbackStatusSyncJob({
      source: "MANUAL",
      targetDateAr: "2026-03-08",
      provider: "CIG_QR",
      actorUserId: 9,
    });

    expect(result.status).toBe("NO_OP");
    expect(result.job_name).toBe("fallback_status_sync");
    expect((result.counters.no_op as boolean) || false).toBe(true);
  });

  it("cron runner respects BILLING_JOBS_ENABLED=false", async () => {
    process.env.BILLING_JOBS_ENABLED = "false";

    const { runBillingCronTick } = await import(
      "@/services/collections/jobs/runner"
    );

    const tick = await runBillingCronTick();
    expect(tick.enabled).toBe(false);
    expect(tick.run_anchor).toBeNull();
    expect(tick.prepare_batch).toBeNull();
    expect(tick.export_batch).toBeNull();
  });

  it("persists BillingJobRun as FAILED when job execution errors", async () => {
    preparePresentmentBatchMock.mockRejectedValue(new Error("prepare exploded"));

    const { preparePdBatchJob } = await import(
      "@/services/collections/jobs/runner"
    );

    const result = await preparePdBatchJob({
      source: "MANUAL",
      targetDateAr: "2026-03-08",
      adapter: "debug_csv",
    });

    expect(result.status).toBe("FAILED");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("FAILED");
    expect(runs[0]?.error_message).toContain("prepare exploded");
  });
});
