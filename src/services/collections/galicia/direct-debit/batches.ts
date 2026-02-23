import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getBillingConfig } from "@/lib/billingConfig";
import { toDateKeyInBuenosAires } from "@/lib/buenosAiresDate";
import { hourInBuenosAires } from "@/services/collections/core/businessCalendarAr";
import {
  getAgencyCollectionsRolloutMap,
  isAgencyEnabledForPdAutomation,
  resolveAgencyCutoffHourAr,
} from "@/services/collections/core/agencyCollectionsRollout";
import {
  dateKeyInTimeZone,
  normalizeLocalDay,
} from "@/services/collections/core/dates";
import {
  type GaliciaPdAdapter,
  type PresentmentRow,
} from "@/services/collections/galicia/direct-debit/adapter";
import { DebugCsvAdapter } from "@/services/collections/galicia/direct-debit/adapters/debugCsvAdapter";
import { GaliciaPdV1Adapter } from "@/services/collections/galicia/direct-debit/adapters/galiciaPdV1Adapter";
import {
  readBatchFile,
  sha256OfBuffer,
  uploadBatchFile,
} from "@/services/collections/galicia/direct-debit/storage";
import {
  onPdAttemptPaid,
  onPdAttemptRejected,
} from "@/services/collections/dunning/service";
import { createLateDuplicatePaymentReviewCase } from "@/services/collections/review-cases/service";
import { maybeAutorunFiscalForPaidCharges } from "@/services/collections/fiscal/autorunOnChargePaid";
import { logBillingEvent } from "@/services/billing/events";

export type CreatePresentmentBatchInput = {
  businessDate: Date;
  actorUserId?: number | null;
};

export type PreparePresentmentBatchInput = {
  businessDate: Date;
  actorUserId?: number | null;
  adapterName?: string | null;
  dryRun?: boolean;
  cutoffDate?: Date;
  globalCutoffHourAr?: number | null;
  force?: boolean;
};

export type PreparePresentmentBatchResult = {
  no_op: boolean;
  dry_run: boolean;
  batch_id: number | null;
  adapter: string;
  attempts_count: number;
  amount_total: number;
  eligible_attempts: number;
  deferred_by_cutoff?: number;
  agencies_considered?: number;
  agencies_processed?: number;
  agencies_skipped_disabled?: number;
};

export type ExportPresentmentBatchResult = {
  batch_id: number;
  exported: boolean;
  already_exported: boolean;
  status: string;
  file_name: string | null;
  storage_key: string | null;
  file_hash: string | null;
  record_count: number;
  amount_total: number;
};

export type ExportPendingPreparedBatchesResult = {
  no_op: boolean;
  batches_considered: number;
  batches_exported: number;
  already_exported: number;
  batch_ids: number[];
  errors: Array<{ batch_id: number; message: string }>;
};

export type ImportResponseBatchInput = {
  outboundBatchId: number;
  uploadedFile: {
    fileName: string;
    bytes: Buffer;
    contentType?: string;
  };
  actorUserId?: number | null;
};

export type BatchSummary = {
  matched_rows: number;
  error_rows: number;
  rejected: number;
  paid: number;
  fiscal_issued: number;
  fiscal_failed: number;
};

const PD_CHANNEL = "OFFICE_BANKING";
const OUTBOUND_FILE_TYPE = "PD_PRESENTMENT";
const INBOUND_FILE_TYPE = "PD_RESPONSE";
const PD_TX_MAX_WAIT_MS = Number.parseInt(
  process.env.BILLING_PD_TX_MAX_WAIT_MS || "10000",
  10,
);
const PD_TX_TIMEOUT_MS = Number.parseInt(
  process.env.BILLING_PD_TX_TIMEOUT_MS || "45000",
  10,
);

function round2(value: number): number {
  const safe = Number.isFinite(value) ? value : 0;
  return Math.round(safe * 100) / 100;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "si"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function normalizeAdapterName(raw: string | null | undefined): string {
  return String(raw || "debug_csv")
    .trim()
    .toLowerCase();
}

function resolveAdapterByName(name: string | null | undefined): GaliciaPdAdapter {
  const mode = normalizeAdapterName(name);

  if (mode === "galicia_pd_v1") {
    return new GaliciaPdV1Adapter();
  }

  return new DebugCsvAdapter();
}

function resolveAdapter(): GaliciaPdAdapter {
  return resolveAdapterByName(process.env.BILLING_PD_ADAPTER || "debug_csv");
}

function buildStorageKey(params: {
  direction: "OUTBOUND" | "INBOUND";
  batchId: number;
  fileName: string;
  businessDate: Date;
}): string {
  const datePart = params.businessDate.toISOString().slice(0, 10);
  const cleanName = params.fileName
    .normalize("NFD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  const safeName = cleanName || "lote.csv";
  return `billing/direct-debit/${params.direction.toLowerCase()}/${datePart}/batch-${params.batchId}-${safeName}`;
}

function resolveContentType(fileName: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback;
  if (fileName.toLowerCase().endsWith(".txt")) return "text/plain; charset=utf-8";
  if (fileName.toLowerCase().endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

function isInboundFileCompatibleWithAdapter(input: {
  adapterName: string;
  fileName: string;
  bytes: Buffer;
}): boolean {
  const adapter = normalizeAdapterName(input.adapterName);
  const header = input.bytes.toString("utf8", 0, Math.min(512, input.bytes.length));
  const firstLine = header.split(/\r?\n/)[0] || "";
  const normalizedFileName = input.fileName.toLowerCase();

  if (adapter === "galicia_pd_v1") {
    if (firstLine.startsWith("H|GALICIA_PD_RESP|")) return true;
    if (firstLine.startsWith("H|GALICIA_PD|")) return true;
    return false;
  }

  if (adapter === "debug_csv") {
    const headerLower = firstLine.toLowerCase();
    return (
      normalizedFileName.endsWith(".csv") ||
      (headerLower.includes("external_reference") &&
        (headerLower.includes("result") || headerLower.includes("bank_result_code")))
    );
  }

  return true;
}

function normalizeExternalReference(raw: string | null | undefined, fallback: string): string {
  const normalized = String(raw || "").trim();
  return normalized || fallback;
}

function hashFallbackFromReference(externalReference: string): string {
  return createHash("sha256").update(`external_reference=${externalReference}`).digest("hex");
}

function serializeMeta(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function pdTxOptions() {
  return {
    maxWait: Number.isFinite(PD_TX_MAX_WAIT_MS) ? PD_TX_MAX_WAIT_MS : 10000,
    timeout: Number.isFinite(PD_TX_TIMEOUT_MS) ? PD_TX_TIMEOUT_MS : 45000,
  };
}

async function logBatchEventForAgencies(input: {
  agencyIds: number[];
  eventType: string;
  payload: Prisma.InputJsonValue;
  createdBy?: number | null;
}): Promise<void> {
  const uniqueAgencyIds = Array.from(
    new Set(input.agencyIds.filter((id) => Number.isInteger(id) && id > 0)),
  );

  for (const agencyId of uniqueAgencyIds) {
    await logBillingEvent({
      id_agency: agencyId,
      subscription_id: null,
      event_type: input.eventType,
      payload: input.payload,
      created_by: input.createdBy ?? null,
    });
  }
}

async function updateBatchStatus(
  idBatch: number,
  data: Parameters<typeof prisma.agencyBillingFileBatch.update>[0]["data"],
): Promise<void> {
  await prisma.agencyBillingFileBatch.update({
    where: { id_batch: idBatch },
    data,
  });
}

async function createBillingFileImportRun(input: {
  agencyIds: number[];
  outboundBatchId: number | null;
  fileName: string;
  fileHash: string;
  adapter: string;
  actorUserId?: number | null;
  source?: "MANUAL" | "CRON" | "SYSTEM";
  status: "SUCCESS" | "FAILED" | "DUPLICATE" | "INVALID";
  detectedTotals?: Record<string, unknown> | null;
  parsedRows?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const importRunDelegate = (prisma as unknown as {
    billingFileImportRun?: { create?: (args: unknown) => Promise<unknown> };
  }).billingFileImportRun;
  if (!importRunDelegate || typeof importRunDelegate.create !== "function") {
    return;
  }

  const uniqueAgencyIds = Array.from(
    new Set(
      input.agencyIds.filter(
        (agencyId) => Number.isInteger(agencyId) && Number(agencyId) > 0,
      ),
    ),
  );

  if (uniqueAgencyIds.length === 0) {
    return;
  }

  for (const agencyId of uniqueAgencyIds) {
    await importRunDelegate.create({
      data: {
        agency_id: agencyId,
        batch_id: input.outboundBatchId,
        file_name: input.fileName,
        file_hash: input.fileHash,
        adapter: input.adapter,
        uploaded_by: input.actorUserId ?? null,
        source: input.source || "MANUAL",
        status: input.status,
        detected_totals: toJsonValue(input.detectedTotals || null),
        parsed_rows: input.parsedRows ?? null,
        error_message: input.errorMessage ?? null,
        metadata_json: toJsonValue(input.metadata || null),
      },
    });
  }
}

async function resolveAgencyIdsFromOutboundItems(
  outboundItems: Array<{ charge_id: number | null }>,
): Promise<number[]> {
  const chargeIds = Array.from(
    new Set(
      outboundItems
        .map((item) => item.charge_id)
        .filter((id): id is number => Number.isInteger(id) && Number(id) > 0),
    ),
  );

  if (!chargeIds.length) return [];

  const charges = await prisma.agencyBillingCharge.findMany({
    where: { id_charge: { in: chargeIds } },
    select: { id_agency: true },
  });

  return Array.from(new Set(charges.map((item) => item.id_agency)));
}

async function buildPresentmentRows(params: {
  businessDate: Date;
  now: Date;
  scheduledUntil: Date;
  requireActiveMandate: boolean;
  globalCutoffHourAr?: number | null;
  force?: boolean;
}): Promise<{
  rows: Array<PresentmentRow & { attemptId: number }>;
  deferredByCutoff: number;
  agenciesConsidered: number;
  agenciesProcessed: number;
  agenciesSkippedDisabled: number;
}> {
  const attempts = await prisma.agencyBillingAttempt.findMany({
    where: {
      status: "PENDING",
      channel: PD_CHANNEL,
      scheduled_for: { lte: params.scheduledUntil },
    },
    include: {
      charge: {
        select: {
          id_charge: true,
          id_agency: true,
          status: true,
          amount_ars_due: true,
        },
      },
      paymentMethod: {
        select: {
          holder_name: true,
          holder_tax_id: true,
          mandate: {
            select: {
              status: true,
              cbu_last4: true,
            },
          },
        },
      },
    },
    orderBy: [{ scheduled_for: "asc" }, { id_attempt: "asc" }],
    take: 5000,
  });

  const agencyIds = Array.from(
    new Set(
      attempts
        .map((attempt) => attempt.charge?.id_agency)
        .filter((agencyId): agencyId is number => Number.isInteger(agencyId) && Number(agencyId) > 0),
    ),
  );
  const rolloutMap = await getAgencyCollectionsRolloutMap({ agencyIds });
  const nowDateKey = toDateKeyInBuenosAires(params.now);
  const businessDateKey = toDateKeyInBuenosAires(params.businessDate);
  const currentHourAr = hourInBuenosAires(params.now);

  let deferredByCutoff = 0;
  const agenciesConsidered = new Set<number>();
  const agenciesProcessed = new Set<number>();
  const agenciesSkippedDisabled = new Set<number>();

  const filtered = attempts.filter((attempt) => {
    if (!attempt.charge) return false;
    if (attempt.charge.status === "PAID") return false;
    agenciesConsidered.add(attempt.charge.id_agency);

    const rollout = rolloutMap.get(attempt.charge.id_agency);
    if (!params.force && !isAgencyEnabledForPdAutomation(rollout)) {
      agenciesSkippedDisabled.add(attempt.charge.id_agency);
      return false;
    }

    if (params.requireActiveMandate) {
      const mandateStatus = attempt.paymentMethod?.mandate?.status;
      if (mandateStatus !== "ACTIVE") return false;
    }

    if (!params.force && nowDateKey && businessDateKey && nowDateKey === businessDateKey) {
      const cutoffHour = resolveAgencyCutoffHourAr({
        rollout,
        globalCutoffHourAr: params.globalCutoffHourAr ?? null,
      });
      if (cutoffHour != null && currentHourAr >= cutoffHour) {
        deferredByCutoff += 1;
        return false;
      }
    }

    agenciesProcessed.add(attempt.charge.id_agency);
    return true;
  });

  const rows = filtered.map((attempt) => {
    const externalReference = normalizeExternalReference(
      attempt.external_reference,
      `AT-${attempt.id_attempt}`,
    );

    return {
      attemptId: attempt.id_attempt,
      chargeId: attempt.charge.id_charge,
      agencyId: attempt.charge.id_agency,
      externalReference,
      amountArs: Number(attempt.charge.amount_ars_due || 0),
      scheduledFor: attempt.scheduled_for,
      holderName: attempt.paymentMethod?.holder_name || null,
      holderTaxId: attempt.paymentMethod?.holder_tax_id || null,
      cbuLast4: attempt.paymentMethod?.mandate?.cbu_last4 || null,
    };
  });

  return {
    rows,
    deferredByCutoff,
    agenciesConsidered: agenciesConsidered.size,
    agenciesProcessed: agenciesProcessed.size,
    agenciesSkippedDisabled: agenciesSkippedDisabled.size,
  };
}

function endOfLocalDay(date: Date): Date {
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return new Date(nextDay.getTime() - 1);
}

function buildAdapterConfig(): Record<string, unknown> {
  return {
    layout_version: process.env.BILLING_PD_LAYOUT_VERSION || undefined,
    entity: process.env.BILLING_PD_ENTITY || undefined,
    service: process.env.BILLING_PD_SERVICE || undefined,
  };
}

async function createEmptyOutboundBatch(input: {
  businessDate: Date;
  adapter: GaliciaPdAdapter;
  actorUserId?: number | null;
  meta?: Record<string, unknown>;
}) {
  return prisma.agencyBillingFileBatch.create({
    data: {
      direction: "OUTBOUND",
      channel: PD_CHANNEL,
      file_type: OUTBOUND_FILE_TYPE,
      adapter: input.adapter.name,
      adapter_version: input.adapter.version,
      business_date: input.businessDate,
      status: "EMPTY",
      total_rows: 0,
      total_amount_ars: 0,
      record_count: 0,
      amount_total: 0,
      meta: toJsonValue(input.meta || {}),
      created_by: input.actorUserId ?? null,
    },
  });
}

export async function preparePresentmentBatch(
  input: PreparePresentmentBatchInput,
): Promise<PreparePresentmentBatchResult> {
  const config = getBillingConfig();
  const now = new Date();
  const businessDate = normalizeLocalDay(input.businessDate, config.timezone);
  const cutoffDate = input.cutoffDate
    ? new Date(input.cutoffDate)
    : endOfLocalDay(businessDate);
  const adapter = resolveAdapterByName(input.adapterName);
  const dryRun = Boolean(input.dryRun);
  const requireActiveMandate = parseBooleanEnv(
    "BILLING_PD_REQUIRE_ACTIVE_MANDATE",
    true,
  );

  const selection = await buildPresentmentRows({
    businessDate,
    now,
    scheduledUntil: cutoffDate,
    requireActiveMandate,
    globalCutoffHourAr: input.globalCutoffHourAr ?? null,
    force: Boolean(input.force),
  });
  const rows = selection.rows;
  const totalAmount = round2(rows.reduce((acc, row) => acc + row.amountArs, 0));

  if (!rows.length) {
    return {
      no_op: true,
      dry_run: dryRun,
      batch_id: null,
      adapter: adapter.name,
      attempts_count: 0,
      amount_total: 0,
      eligible_attempts: 0,
      deferred_by_cutoff: selection.deferredByCutoff,
      agencies_considered: selection.agenciesConsidered,
      agencies_processed: selection.agenciesProcessed,
      agencies_skipped_disabled: selection.agenciesSkippedDisabled,
    };
  }

  if (dryRun) {
    return {
      no_op: false,
      dry_run: true,
      batch_id: null,
      adapter: adapter.name,
      attempts_count: rows.length,
      amount_total: totalAmount,
      eligible_attempts: rows.length,
      deferred_by_cutoff: selection.deferredByCutoff,
      agencies_considered: selection.agenciesConsidered,
      agencies_processed: selection.agenciesProcessed,
      agencies_skipped_disabled: selection.agenciesSkippedDisabled,
    };
  }

  const created = await prisma.$transaction(
    async (tx) => {
      const batch = await tx.agencyBillingFileBatch.create({
        data: {
          direction: "OUTBOUND",
          channel: PD_CHANNEL,
          file_type: OUTBOUND_FILE_TYPE,
          adapter: adapter.name,
          adapter_version: adapter.version,
          business_date: businessDate,
          status: "PREPARED",
          total_rows: rows.length,
          total_amount_ars: totalAmount,
          record_count: rows.length,
          amount_total: totalAmount,
          meta: toJsonValue({
            require_active_mandate: requireActiveMandate,
            cutoff_date: cutoffDate.toISOString(),
            prepared_at: new Date().toISOString(),
            adapter_config: buildAdapterConfig(),
          }),
          created_by: input.actorUserId ?? null,
        },
      });

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        await tx.agencyBillingAttempt.update({
          where: { id_attempt: row.attemptId },
          data: {
            external_reference: row.externalReference,
            status: "PROCESSING",
          },
        });

        await tx.agencyBillingFileBatchItem.create({
          data: {
            batch_id: batch.id_batch,
            attempt_id: row.attemptId,
            charge_id: row.chargeId,
            line_no: i + 2,
            external_reference: row.externalReference,
            raw_hash: hashFallbackFromReference(row.externalReference),
            amount_ars: row.amountArs,
            status: "PENDING",
            row_payload: toJsonValue(row),
          },
        });
      }

      const chargeIds = Array.from(new Set(rows.map((row) => row.chargeId)));
      if (chargeIds.length > 0) {
        await tx.agencyBillingCharge.updateMany({
          where: {
            id_charge: { in: chargeIds },
            status: { in: ["READY", "PENDING"] },
          },
          data: { status: "PROCESSING" },
        });
      }

      return { batchId: batch.id_batch };
    },
    pdTxOptions(),
  );

  await logBatchEventForAgencies({
    agencyIds: rows.map((row) => row.agencyId),
    eventType: "PD_BATCH_PREPARED",
    payload: {
      batch_id: created.batchId,
      business_date: dateKeyInTimeZone(businessDate, config.timezone),
      total_rows: rows.length,
      total_amount_ars: totalAmount,
      adapter: adapter.name,
      adapter_version: adapter.version,
    },
    createdBy: input.actorUserId ?? null,
  });

  return {
    no_op: false,
    dry_run: false,
    batch_id: created.batchId,
    adapter: adapter.name,
    attempts_count: rows.length,
    amount_total: totalAmount,
    eligible_attempts: rows.length,
    deferred_by_cutoff: selection.deferredByCutoff,
    agencies_considered: selection.agenciesConsidered,
    agencies_processed: selection.agenciesProcessed,
    agencies_skipped_disabled: selection.agenciesSkippedDisabled,
  };
}

async function readRowsForPreparedBatch(input: {
  batchId: number;
}): Promise<{
  batch: {
    id_batch: number;
    business_date: Date;
    adapter: string | null;
    meta: Prisma.JsonValue;
  };
  rows: Array<PresentmentRow & { attemptId: number }>;
  agencyIds: number[];
}> {
  const batch = await prisma.agencyBillingFileBatch.findUnique({
    where: { id_batch: input.batchId },
    select: {
      id_batch: true,
      business_date: true,
      adapter: true,
      meta: true,
      direction: true,
      file_type: true,
      items: {
        where: { attempt_id: { not: null } },
        orderBy: [{ line_no: "asc" }, { id_item: "asc" }],
        select: {
          id_item: true,
          attempt_id: true,
          charge_id: true,
          external_reference: true,
          amount_ars: true,
          row_payload: true,
          attempt: {
            select: {
              id_attempt: true,
              external_reference: true,
              charge: {
                select: {
                  id_charge: true,
                  id_agency: true,
                  amount_ars_due: true,
                },
              },
              paymentMethod: {
                select: {
                  holder_name: true,
                  holder_tax_id: true,
                  mandate: {
                    select: {
                      cbu_last4: true,
                    },
                  },
                },
              },
              scheduled_for: true,
            },
          },
        },
      },
    },
  });

  if (!batch || batch.direction !== "OUTBOUND" || batch.file_type !== OUTBOUND_FILE_TYPE) {
    throw new Error("Batch outbound no encontrado para exportación");
  }

  const rows: Array<PresentmentRow & { attemptId: number }> = [];
  const agencyIds = new Set<number>();

  for (const item of batch.items) {
    const attempt = item.attempt;
    const attemptId = item.attempt_id || attempt?.id_attempt;
    const chargeId = item.charge_id || attempt?.charge?.id_charge;
    const agencyId = attempt?.charge?.id_agency;
    if (!attemptId || !chargeId || !agencyId) {
      continue;
    }

    const rowPayload = serializeMeta(item.row_payload);
    const externalReference = normalizeExternalReference(
      item.external_reference ||
        attempt?.external_reference ||
        (rowPayload.externalReference as string | undefined),
      `AT-${attemptId}`,
    );
    const amountArs = round2(
      Number(
        item.amount_ars ??
          rowPayload.amountArs ??
          attempt?.charge?.amount_ars_due ??
          0,
      ),
    );

    rows.push({
      attemptId,
      chargeId,
      agencyId,
      externalReference,
      amountArs,
      scheduledFor:
        attempt?.scheduled_for ||
        (typeof rowPayload.scheduledFor === "string" &&
        Number.isFinite(new Date(rowPayload.scheduledFor).getTime())
          ? new Date(rowPayload.scheduledFor)
          : null),
      holderName:
        attempt?.paymentMethod?.holder_name ||
        String(rowPayload.holderName || "") ||
        null,
      holderTaxId:
        attempt?.paymentMethod?.holder_tax_id ||
        String(rowPayload.holderTaxId || "") ||
        null,
      cbuLast4:
        attempt?.paymentMethod?.mandate?.cbu_last4 ||
        String(rowPayload.cbuLast4 || "") ||
        null,
    });

    agencyIds.add(agencyId);
  }

  return {
    batch: {
      id_batch: batch.id_batch,
      business_date: batch.business_date,
      adapter: batch.adapter,
      meta: batch.meta,
    },
    rows,
    agencyIds: Array.from(agencyIds),
  };
}

async function rollbackPreparedBatchOnExportError(input: {
  batchId: number;
  errorMessage: string;
}) {
  const itemRefs = await prisma.agencyBillingFileBatchItem.findMany({
    where: { batch_id: input.batchId, attempt_id: { not: null } },
    select: { attempt_id: true },
  });
  const attemptIds = Array.from(
    new Set(
      itemRefs
        .map((item) => item.attempt_id)
        .filter((id): id is number => Number.isInteger(id) && Number(id) > 0),
    ),
  );

  await prisma.$transaction(
    async (tx) => {
      const batch = await tx.agencyBillingFileBatch.findUnique({
        where: { id_batch: input.batchId },
        select: { meta: true },
      });

      await tx.agencyBillingFileBatch.update({
        where: { id_batch: input.batchId },
        data: {
          status: "FAILED",
          meta: toJsonValue({
            ...(serializeMeta(batch?.meta) || {}),
            error: input.errorMessage,
          }),
        },
      });

      if (attemptIds.length > 0) {
        await tx.agencyBillingAttempt.updateMany({
          where: {
            id_attempt: { in: attemptIds },
            status: "PROCESSING",
          },
          data: { status: "PENDING" },
        });
      }
    },
    pdTxOptions(),
  );
}

export async function exportPresentmentBatch(input: {
  batchId: number;
  actorUserId?: number | null;
}): Promise<ExportPresentmentBatchResult> {
  const batch = await prisma.agencyBillingFileBatch.findUnique({
    where: { id_batch: input.batchId },
    select: {
      id_batch: true,
      status: true,
      direction: true,
      file_type: true,
      business_date: true,
      storage_key: true,
      file_hash: true,
      record_count: true,
      amount_total: true,
      total_rows: true,
      total_amount_ars: true,
      exported_at: true,
      adapter: true,
      adapter_version: true,
      meta: true,
      original_file_name: true,
      sha256: true,
    },
  });

  if (!batch || batch.direction !== "OUTBOUND" || batch.file_type !== OUTBOUND_FILE_TYPE) {
    throw new Error("Batch outbound no encontrado");
  }

  const alreadyExported =
    Boolean(batch.exported_at) ||
    Boolean(batch.storage_key) ||
    ["READY", "EXPORTED", "RECONCILED"].includes(String(batch.status || "").toUpperCase());

  if (alreadyExported) {
    return {
      batch_id: batch.id_batch,
      exported: false,
      already_exported: true,
      status: batch.status,
      file_name: batch.original_file_name,
      storage_key: batch.storage_key,
      file_hash: batch.file_hash || batch.sha256,
      record_count: batch.record_count ?? batch.total_rows ?? 0,
      amount_total: round2(Number(batch.amount_total ?? batch.total_amount_ars ?? 0)),
    };
  }

  const adapter = resolveAdapterByName(batch.adapter);
  const prepared = await readRowsForPreparedBatch({
    batchId: batch.id_batch,
  });

  if (prepared.rows.length === 0) {
    await updateBatchStatus(batch.id_batch, {
      status: "EMPTY",
      total_rows: 0,
      total_amount_ars: 0,
      record_count: 0,
      amount_total: 0,
      exported_at: new Date(),
    });
    return {
      batch_id: batch.id_batch,
      exported: false,
      already_exported: false,
      status: "EMPTY",
      file_name: null,
      storage_key: null,
      file_hash: null,
      record_count: 0,
      amount_total: 0,
    };
  }

  const built = adapter.buildOutboundFile({
    batch: {
      id_batch: prepared.batch.id_batch,
      business_date: prepared.batch.business_date,
      channel: PD_CHANNEL,
      file_type: OUTBOUND_FILE_TYPE,
    },
    attempts: prepared.rows,
    config: buildAdapterConfig(),
    meta: {
      batch_id: prepared.batch.id_batch,
    },
  });

  const outboundValidation = adapter.validateOutboundControlTotals({
    controlTotals: built.controlTotals,
    attempts: prepared.rows,
  });
  if (!outboundValidation.ok) {
    throw new Error(
      `Control totals outbound inválidos (${adapter.name}): ${outboundValidation.errors.join("; ")}`,
    );
  }

  const sha256 = sha256OfBuffer(built.fileBuffer);
  const storageKey = buildStorageKey({
    direction: "OUTBOUND",
    batchId: prepared.batch.id_batch,
    fileName: built.fileName,
    businessDate: prepared.batch.business_date,
  });

  try {
    await uploadBatchFile({
      storageKey,
      bytes: built.fileBuffer,
      contentType: resolveContentType(built.fileName),
    });

    await updateBatchStatus(prepared.batch.id_batch, {
      status: "EXPORTED",
      storage_key: storageKey,
      sha256,
      file_hash: sha256,
      original_file_name: built.fileName,
      adapter_version: built.adapter_version,
      record_count: built.controlTotals.record_count,
      amount_total: built.controlTotals.amount_total,
      total_rows: built.controlTotals.record_count,
      total_amount_ars: built.controlTotals.amount_total,
      exported_at: new Date(),
      meta: toJsonValue({
        ...(serializeMeta(prepared.batch.meta) || {}),
        adapter_metadata: built.rawMetadata,
        control_totals: built.controlTotals,
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al exportar lote outbound";
    await rollbackPreparedBatchOnExportError({
      batchId: prepared.batch.id_batch,
      errorMessage: message,
    });
    throw error;
  }

  await logBatchEventForAgencies({
    agencyIds: prepared.agencyIds,
    eventType: "PD_BATCH_OUTBOUND_EXPORTED",
    payload: {
      batch_id: prepared.batch.id_batch,
      total_rows: built.controlTotals.record_count,
      total_amount_ars: built.controlTotals.amount_total,
      adapter: adapter.name,
      adapter_version: built.adapter_version,
      control_totals: built.controlTotals,
    },
    createdBy: input.actorUserId ?? null,
  });

  return {
    batch_id: prepared.batch.id_batch,
    exported: true,
    already_exported: false,
    status: "EXPORTED",
    file_name: built.fileName,
    storage_key: storageKey,
    file_hash: sha256,
    record_count: built.controlTotals.record_count,
    amount_total: built.controlTotals.amount_total,
  };
}

export async function exportPendingPreparedBatches(input?: {
  actorUserId?: number | null;
  adapterName?: string | null;
  limit?: number;
}): Promise<ExportPendingPreparedBatchesResult> {
  const adapterName = input?.adapterName
    ? normalizeAdapterName(input.adapterName)
    : null;
  const limit = Math.min(200, Math.max(1, input?.limit ?? 20));

  const batches = await prisma.agencyBillingFileBatch.findMany({
    where: {
      direction: "OUTBOUND",
      channel: PD_CHANNEL,
      file_type: OUTBOUND_FILE_TYPE,
      status: { in: ["PREPARED", "CREATED"] },
      ...(adapterName ? { adapter: adapterName } : {}),
    },
    orderBy: [{ business_date: "asc" }, { id_batch: "asc" }],
    take: limit,
    select: {
      id_batch: true,
    },
  });

  if (!batches.length) {
    return {
      no_op: true,
      batches_considered: 0,
      batches_exported: 0,
      already_exported: 0,
      batch_ids: [],
      errors: [],
    };
  }

  let batchesExported = 0;
  let alreadyExported = 0;
  const batchIds: number[] = [];
  const errors: Array<{ batch_id: number; message: string }> = [];

  for (const batch of batches) {
    try {
      const exported = await exportPresentmentBatch({
        batchId: batch.id_batch,
        actorUserId: input?.actorUserId ?? null,
      });
      if (exported.exported) batchesExported += 1;
      if (exported.already_exported) alreadyExported += 1;
      if (exported.exported || exported.already_exported) {
        batchIds.push(batch.id_batch);
      }
    } catch (error) {
      errors.push({
        batch_id: batch.id_batch,
        message:
          error instanceof Error ? error.message : "Error al exportar batch",
      });
    }
  }

  return {
    no_op: batchesExported === 0 && errors.length === 0,
    batches_considered: batches.length,
    batches_exported: batchesExported,
    already_exported: alreadyExported,
    batch_ids: batchIds,
    errors,
  };
}

export async function createPresentmentBatch(
  input: CreatePresentmentBatchInput,
): Promise<{
  batch: {
    id_batch: number;
    direction: string;
    business_date: Date;
    status: string;
    total_rows: number;
    total_amount_ars: number | null;
    storage_key: string | null;
    sha256: string | null;
  };
  downloadFileName: string | null;
}> {
  const config = getBillingConfig();
  const businessDate = normalizeLocalDay(input.businessDate, config.timezone);
  const adapter = resolveAdapter();

  const prepared = await preparePresentmentBatch({
    businessDate,
    actorUserId: input.actorUserId ?? null,
    adapterName: adapter.name,
    dryRun: false,
    cutoffDate: endOfLocalDay(businessDate),
  });

  if (!prepared.batch_id) {
    const empty = await createEmptyOutboundBatch({
      businessDate,
      adapter,
      actorUserId: input.actorUserId ?? null,
      meta: {
        no_op: true,
      },
    });

    return {
      batch: {
        id_batch: empty.id_batch,
        direction: empty.direction,
        business_date: empty.business_date,
        status: empty.status,
        total_rows: empty.total_rows,
        total_amount_ars:
          empty.total_amount_ars == null ? null : Number(empty.total_amount_ars),
        storage_key: empty.storage_key,
        sha256: empty.sha256,
      },
      downloadFileName: null,
    };
  }

  const exported = await exportPresentmentBatch({
    batchId: prepared.batch_id,
    actorUserId: input.actorUserId ?? null,
  });

  const batch = await prisma.agencyBillingFileBatch.findUnique({
    where: { id_batch: prepared.batch_id },
    select: {
      id_batch: true,
      direction: true,
      business_date: true,
      status: true,
      total_rows: true,
      total_amount_ars: true,
      storage_key: true,
      sha256: true,
    },
  });

  if (!batch) {
    throw new Error("No se pudo cargar el batch exportado");
  }

  return {
    batch: {
      id_batch: batch.id_batch,
      direction: batch.direction,
      business_date: batch.business_date,
      status: batch.status,
      total_rows: batch.total_rows,
      total_amount_ars:
        batch.total_amount_ars == null ? null : Number(batch.total_amount_ars),
      storage_key: batch.storage_key,
      sha256: batch.sha256,
    },
    downloadFileName: exported.file_name,
  };
}

export async function listDirectDebitBatches(input: { from: Date; to: Date }) {
  const items = await prisma.agencyBillingFileBatch.findMany({
    where: {
      business_date: {
        gte: input.from,
        lte: input.to,
      },
      file_type: { in: [OUTBOUND_FILE_TYPE, INBOUND_FILE_TYPE] },
      channel: PD_CHANNEL,
    },
    include: {
      parentBatch: {
        select: {
          id_batch: true,
          direction: true,
          business_date: true,
        },
      },
      _count: {
        select: {
          items: true,
        },
      },
    },
    orderBy: [{ business_date: "desc" }, { id_batch: "desc" }],
    take: 300,
  });

  return items.map((item) => ({
    id_batch: item.id_batch,
    parent_batch_id: item.parent_batch_id,
    direction: item.direction,
    channel: item.channel,
    file_type: item.file_type,
    adapter: item.adapter,
    adapter_version: item.adapter_version,
    business_date: item.business_date,
    status: item.status,
    storage_key: item.storage_key,
    original_file_name: item.original_file_name,
    sha256: item.sha256,
    file_hash: item.file_hash,
    record_count: item.record_count,
    amount_total: item.amount_total == null ? null : Number(item.amount_total),
    exported_at: item.exported_at,
    imported_at: item.imported_at,
    total_rows: item.total_rows,
    total_amount_ars:
      item.total_amount_ars == null ? null : Number(item.total_amount_ars),
    total_paid_rows: item.total_paid_rows,
    total_rejected_rows: item.total_rejected_rows,
    total_error_rows: item.total_error_rows,
    created_at: item.created_at,
    updated_at: item.updated_at,
    items_count: item._count.items,
    parent_batch: item.parentBatch,
  }));
}

export async function downloadDirectDebitBatchFile(idBatch: number): Promise<{
  fileName: string;
  bytes: Buffer;
  contentType: string;
}> {
  const batch = await prisma.agencyBillingFileBatch.findUnique({
    where: { id_batch: idBatch },
    select: {
      id_batch: true,
      storage_key: true,
      original_file_name: true,
      direction: true,
      file_type: true,
    },
  });

  if (!batch) {
    throw new Error("Batch no encontrado");
  }

  if (!batch.storage_key) {
    throw new Error("Batch sin archivo asociado");
  }

  const fileName =
    batch.original_file_name ||
    `batch-${batch.id_batch}-${batch.direction.toLowerCase()}.csv`;

  const bytes = await readBatchFile(batch.storage_key);
  return {
    fileName,
    bytes,
    contentType: resolveContentType(fileName),
  };
}

export async function importResponseBatch(
  input: ImportResponseBatchInput,
): Promise<{
  inbound_batch_id: number;
  already_imported: boolean;
  summary: BatchSummary;
}> {
  const outbound = await prisma.agencyBillingFileBatch.findUnique({
    where: { id_batch: input.outboundBatchId },
    include: {
      items: {
        select: {
          id_item: true,
          attempt_id: true,
          charge_id: true,
          external_reference: true,
          raw_hash: true,
          amount_ars: true,
          status: true,
        },
      },
    },
  });

  if (
    !outbound ||
    outbound.direction !== "OUTBOUND" ||
    outbound.file_type !== OUTBOUND_FILE_TYPE
  ) {
    throw new Error("Batch outbound no encontrado");
  }
  const outboundAlreadyReconciled =
    String(outbound.status || "").toUpperCase() === "RECONCILED";

  const agencyIds = await resolveAgencyIdsFromOutboundItems(outbound.items);
  const inboundSha = sha256OfBuffer(input.uploadedFile.bytes);

  const adapter = resolveAdapterByName(
    outbound.adapter || process.env.BILLING_PD_ADAPTER || "debug_csv",
  );
  if (
    !isInboundFileCompatibleWithAdapter({
      adapterName: adapter.name,
      fileName: input.uploadedFile.fileName,
      bytes: input.uploadedFile.bytes,
    })
  ) {
    await createBillingFileImportRun({
      agencyIds,
      outboundBatchId: outbound.id_batch,
      fileName: input.uploadedFile.fileName,
      fileHash: inboundSha,
      adapter: adapter.name,
      actorUserId: input.actorUserId ?? null,
      source: "MANUAL",
      status: "INVALID",
      errorMessage: "adapter mismatch",
      metadata: {
        expected_adapter: adapter.name,
        file_name: input.uploadedFile.fileName,
      },
    });
    throw new Error("adapter mismatch");
  }

  let parsed: ReturnType<GaliciaPdAdapter["parseInboundFile"]>;
  try {
    parsed = adapter.parseInboundFile({ fileBuffer: input.uploadedFile.bytes });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "layout parse error";
    await createBillingFileImportRun({
      agencyIds,
      outboundBatchId: outbound.id_batch,
      fileName: input.uploadedFile.fileName,
      fileHash: inboundSha,
      adapter: adapter.name,
      actorUserId: input.actorUserId ?? null,
      source: "MANUAL",
      status: "INVALID",
      errorMessage: message,
      metadata: {
        expected_adapter: adapter.name,
      },
    });
    throw error;
  }

  const inboundValidation = adapter.validateInboundControlTotals({ parsed });
  if (!inboundValidation.ok) {
    await createBillingFileImportRun({
      agencyIds,
      outboundBatchId: outbound.id_batch,
      fileName: input.uploadedFile.fileName,
      fileHash: inboundSha,
      adapter: adapter.name,
      actorUserId: input.actorUserId ?? null,
      source: "MANUAL",
      status: "INVALID",
      detectedTotals: parsed.controlTotals,
      parsedRows: parsed.rows.length,
      errorMessage: `totals mismatch: ${inboundValidation.errors.join("; ")}`,
    });
    throw new Error(
      `Control totals inbound inválidos (${adapter.name}): ${inboundValidation.errors.join("; ")}`,
    );
  }

  const inboundRecordCount = parsed.controlTotals.record_count;
  const inboundAmountTotal = round2(parsed.controlTotals.amount_total);

  const duplicate = await prisma.agencyBillingFileBatch.findFirst({
    where: {
      direction: "INBOUND",
      parent_batch_id: outbound.id_batch,
      adapter: adapter.name,
      OR: [
        {
          file_hash: inboundSha,
          record_count: inboundRecordCount,
          amount_total: inboundAmountTotal,
        },
        {
          sha256: inboundSha,
          total_rows: inboundRecordCount,
          total_amount_ars: inboundAmountTotal,
        },
      ],
    },
  });

  if (duplicate) {
    await createBillingFileImportRun({
      agencyIds,
      outboundBatchId: outbound.id_batch,
      fileName: input.uploadedFile.fileName,
      fileHash: inboundSha,
      adapter: adapter.name,
      actorUserId: input.actorUserId ?? null,
      source: "MANUAL",
      status: "DUPLICATE",
      detectedTotals: parsed.controlTotals,
      parsedRows: parsed.rows.length,
      metadata: {
        inbound_batch_id: duplicate.id_batch,
      },
    });

    await logBatchEventForAgencies({
      agencyIds,
      eventType: "PD_BATCH_INBOUND_ALREADY_IMPORTED",
      payload: {
        outbound_batch_id: outbound.id_batch,
        inbound_batch_id: duplicate.id_batch,
        adapter: adapter.name,
        file_hash: inboundSha,
        record_count: inboundRecordCount,
        amount_total: inboundAmountTotal,
      },
      createdBy: input.actorUserId ?? null,
    });

    return {
      inbound_batch_id: duplicate.id_batch,
      already_imported: true,
      summary: {
        matched_rows: duplicate.total_rows,
        error_rows: duplicate.total_error_rows,
        rejected: duplicate.total_rejected_rows,
        paid: duplicate.total_paid_rows,
        fiscal_issued: 0,
        fiscal_failed: 0,
      },
    };
  }

  if (outboundAlreadyReconciled) {
    throw new Error("batch already reconciled");
  }

  try {
    const config = getBillingConfig();
    const businessDate = normalizeLocalDay(new Date(), config.timezone);

    const inbound = await prisma.agencyBillingFileBatch.create({
    data: {
      parent_batch_id: outbound.id_batch,
      direction: "INBOUND",
      channel: PD_CHANNEL,
      file_type: INBOUND_FILE_TYPE,
      adapter: adapter.name,
      adapter_version: adapter.version,
      business_date: businessDate,
      status: "PROCESSING",
      total_rows: parsed.rows.length,
      total_amount_ars: inboundAmountTotal,
      record_count: inboundRecordCount,
      amount_total: inboundAmountTotal,
      file_hash: inboundSha,
      created_by: input.actorUserId ?? null,
      original_file_name: input.uploadedFile.fileName,
      meta: {
        parse_warnings: parsed.parseWarnings,
        control_totals: parsed.controlTotals,
      },
    },
  });

    const inboundStorageKey = buildStorageKey({
    direction: "INBOUND",
    batchId: inbound.id_batch,
    fileName: input.uploadedFile.fileName,
    businessDate,
  });

    await uploadBatchFile({
    storageKey: inboundStorageKey,
    bytes: input.uploadedFile.bytes,
    contentType: resolveContentType(
      input.uploadedFile.fileName,
      input.uploadedFile.contentType,
    ),
  });

    const byExternal = new Map<string, (typeof outbound.items)[number]>();
    const byRawHash = new Map<string, (typeof outbound.items)[number]>();
    const touchedAgencyIds = new Set<number>();

    for (const item of outbound.items) {
      if (item.external_reference) byExternal.set(item.external_reference, item);
      if (item.raw_hash) byRawHash.set(item.raw_hash, item);
    }

    let matchedRows = 0;
    let paidRows = 0;
    let rejectedRows = 0;
    let errorRows = 0;
    const paidChargeIds = new Set<number>();

    for (const row of parsed.rows) {
    const paidReference = row.operation_id || row.processor_trace_id || null;

    const match =
      (row.external_attempt_ref
        ? byExternal.get(row.external_attempt_ref)
        : undefined) ||
      byRawHash.get(row.raw_hash) ||
      (row.external_attempt_ref
        ? byRawHash.get(hashFallbackFromReference(row.external_attempt_ref))
        : undefined);

    if (!match || !match.attempt_id || !match.charge_id) {
      errorRows += 1;
      await prisma.agencyBillingFileBatchItem.create({
        data: {
          batch_id: inbound.id_batch,
          line_no: row.lineNo,
          external_reference: row.external_attempt_ref,
          raw_hash: row.raw_hash,
          amount_ars: row.amount,
          status: "ERROR",
          response_code: row.bank_result_code,
          response_message: row.bank_result_message || "No se pudo matchear registro",
          paid_reference: paidReference,
          row_payload: toJsonValue({
            ...row.raw_payload,
            mapped_status: row.mapped_status,
            mapped_detailed_reason: row.mapped_detailed_reason,
            raw_line: row.raw_line,
          }),
          processed_at: new Date(),
        },
      });
      continue;
    }

    matchedRows += 1;

    await prisma.$transaction(
      async (tx) => {
        const attempt = await tx.agencyBillingAttempt.findUnique({
          where: { id_attempt: match.attempt_id as number },
          select: {
            id_attempt: true,
            charge_id: true,
            attempt_no: true,
            status: true,
          },
        });

        const charge = await tx.agencyBillingCharge.findUnique({
          where: { id_charge: match.charge_id as number },
          select: {
            id_charge: true,
            id_agency: true,
            cycle_id: true,
            status: true,
            amount_ars_due: true,
            paid_via_channel: true,
          },
        });

        if (!attempt || !charge) {
          errorRows += 1;
          await tx.agencyBillingFileBatchItem.create({
            data: {
              batch_id: inbound.id_batch,
              line_no: row.lineNo,
              attempt_id: match.attempt_id,
              charge_id: match.charge_id,
              external_reference: row.external_attempt_ref,
              raw_hash: row.raw_hash,
              amount_ars: row.amount,
              status: "ERROR",
              response_code: row.bank_result_code,
              response_message: "Attempt o Charge no encontrado",
              paid_reference: paidReference,
              row_payload: toJsonValue({
                ...row.raw_payload,
                mapped_status: row.mapped_status,
                mapped_detailed_reason: row.mapped_detailed_reason,
                raw_line: row.raw_line,
              }),
              processed_at: new Date(),
            },
          });
          return;
        }

        touchedAgencyIds.add(charge.id_agency);

        const processorPayload = toJsonValue({
          ...row.raw_payload,
          mapped_status: row.mapped_status,
          mapped_detailed_reason: row.mapped_detailed_reason,
          raw_line: row.raw_line,
        });

        const processorData = {
          processor_result_code: row.bank_result_code,
          processor_result_message: row.bank_result_message,
          processor_trace_id: row.processor_trace_id || row.operation_id,
          processor_settlement_date: row.settled_at,
          processor_raw_payload: processorPayload,
        } satisfies Prisma.AgencyBillingAttemptUpdateInput;

        if (row.mapped_status === "PAID") {
          const paidAt = row.settled_at || new Date();
          const paidAmount = row.amount ?? Number(charge.amount_ars_due || 0);

          await tx.agencyBillingAttempt.update({
            where: { id_attempt: attempt.id_attempt },
            data: {
              status: "PAID",
              processed_at: paidAt,
              paid_reference: paidReference,
              rejection_code: null,
              rejection_reason: null,
              ...processorData,
            },
          });

          const closeResult = await onPdAttemptPaid({
            chargeId: charge.id_charge,
            amount: paidAmount,
            paidAt,
            sourceRef: paidReference,
            actorUserId: input.actorUserId ?? null,
            source: "PD_RECONCILIATION",
            tx,
          });

          await tx.agencyBillingFileBatchItem.updateMany({
            where: { id_item: match.id_item },
            data: {
              status: "PAID",
              response_code: row.bank_result_code,
              response_message: row.bank_result_message,
              paid_reference: paidReference,
              processed_at: paidAt,
            },
          });

          await tx.agencyBillingFileBatchItem.create({
            data: {
              batch_id: inbound.id_batch,
              line_no: row.lineNo,
              attempt_id: attempt.id_attempt,
              charge_id: charge.id_charge,
              external_reference: row.external_attempt_ref,
              raw_hash: row.raw_hash,
              amount_ars: paidAmount,
              status: "PAID",
              response_code: row.bank_result_code,
              response_message: row.bank_result_message,
              paid_reference: paidReference,
              row_payload: processorPayload,
              processed_at: paidAt,
            },
          });

          await logBillingEvent(
            {
              id_agency: charge.id_agency,
              subscription_id: null,
              event_type: "ATTEMPT_MARKED_PAID",
              payload: {
                outbound_batch_id: outbound.id_batch,
                inbound_batch_id: inbound.id_batch,
                attempt_id: attempt.id_attempt,
                charge_id: charge.id_charge,
                paid_reference: paidReference,
                amount_ars: paidAmount,
                processor_result_code: row.bank_result_code,
                processor_trace_id: row.processor_trace_id,
                close_result: {
                  closed: closeResult.closed,
                  already_paid: closeResult.already_paid,
                  paid_via_channel: closeResult.paid_via_channel,
                },
              },
              created_by: input.actorUserId ?? null,
            },
            tx,
          );

          if (
            closeResult.already_paid &&
            closeResult.paid_via_channel &&
            closeResult.paid_via_channel !== "PD_GALICIA"
          ) {
            await createLateDuplicatePaymentReviewCase({
              agencyId: charge.id_agency,
              chargeId: charge.id_charge,
              primaryPaidChannel: closeResult.paid_via_channel,
              secondaryLateChannel: "PD_GALICIA",
              amountArs: paidAmount,
              detectedAt: paidAt,
              dedupeKey: `late-duplicate:${charge.id_charge}:pd:${attempt.id_attempt}:${paidReference || row.raw_hash}`,
              metadata: {
                outbound_batch_id: outbound.id_batch,
                inbound_batch_id: inbound.id_batch,
                attempt_id: attempt.id_attempt,
                paid_reference: paidReference,
                processor_trace_id: row.processor_trace_id || null,
                bank_result_code: row.bank_result_code || null,
              },
              actorUserId: input.actorUserId ?? null,
              source: "PD_RECONCILIATION",
              tx,
            });

            await logBillingEvent(
              {
                id_agency: charge.id_agency,
                subscription_id: null,
                event_type: "PD_LATE_SUCCESS_AFTER_FALLBACK_PAID",
                payload: {
                  charge_id: charge.id_charge,
                  attempt_id: attempt.id_attempt,
                  paid_reference: paidReference,
                  amount_ars: paidAmount,
                  previous_paid_via_channel: closeResult.paid_via_channel,
                  source: "PD_RECONCILIATION",
                },
                created_by: input.actorUserId ?? null,
              },
              tx,
            );
          }

          paidRows += 1;
          if (closeResult.closed) {
            paidChargeIds.add(charge.id_charge);
          }
          return;
        }

        if (row.mapped_status === "REJECTED") {
          const processedAt = row.settled_at || new Date();

          if (attempt.status !== "PAID") {
            await tx.agencyBillingAttempt.update({
              where: { id_attempt: attempt.id_attempt },
              data: {
                status: "REJECTED",
                processed_at: processedAt,
                rejection_code: row.bank_result_code,
                rejection_reason: row.bank_result_message,
                ...processorData,
              },
            });
          }

          if (charge.status !== "PAID") {
            await tx.agencyBillingCharge.update({
              where: { id_charge: charge.id_charge },
              data: {
                status: "PAST_DUE",
                reconciliation_status: "UNMATCHED",
              },
            });
          }

          await tx.agencyBillingFileBatchItem.updateMany({
            where: { id_item: match.id_item },
            data: {
              status: "REJECTED",
              response_code: row.bank_result_code,
              response_message: row.bank_result_message,
              paid_reference: paidReference,
              processed_at: processedAt,
            },
          });

          await tx.agencyBillingFileBatchItem.create({
            data: {
              batch_id: inbound.id_batch,
              line_no: row.lineNo,
              attempt_id: attempt.id_attempt,
              charge_id: charge.id_charge,
              external_reference: row.external_attempt_ref,
              raw_hash: row.raw_hash,
              amount_ars: row.amount,
              status: "REJECTED",
              response_code: row.bank_result_code,
              response_message: row.bank_result_message,
              paid_reference: paidReference,
              row_payload: processorPayload,
              processed_at: processedAt,
            },
          });

          await logBillingEvent(
            {
              id_agency: charge.id_agency,
              subscription_id: null,
              event_type: "ATTEMPT_MARKED_REJECTED",
              payload: {
                outbound_batch_id: outbound.id_batch,
                inbound_batch_id: inbound.id_batch,
                attempt_id: attempt.id_attempt,
                charge_id: charge.id_charge,
                rejection_code: row.bank_result_code,
                rejection_reason: row.bank_result_message,
                mapped_detailed_reason: row.mapped_detailed_reason,
              },
              created_by: input.actorUserId ?? null,
            },
            tx,
          );

          await onPdAttemptRejected({
            chargeId: charge.id_charge,
            attemptId: attempt.id_attempt,
            actorUserId: input.actorUserId ?? null,
            reasonCode: row.bank_result_code,
            reasonText: row.bank_result_message,
            source: "PD_RECONCILIATION",
            tx,
          });

          rejectedRows += 1;
          return;
        }

        const processedAt = row.settled_at || new Date();

        if (attempt.status !== "PAID") {
          await tx.agencyBillingAttempt.update({
            where: { id_attempt: attempt.id_attempt },
            data: {
              status: "FAILED",
              processed_at: processedAt,
              rejection_code: row.bank_result_code,
              rejection_reason:
                row.bank_result_message ||
                (row.mapped_status === "UNKNOWN"
                  ? "Resultado bancario desconocido"
                  : "Error de procesamiento bancario"),
              ...processorData,
            },
          });
        }

        if (charge.status !== "PAID") {
          await tx.agencyBillingCharge.update({
            where: { id_charge: charge.id_charge },
            data:
              charge.status === "PROCESSING"
                ? {
                    status: "PENDING",
                    reconciliation_status: "ERROR",
                  }
                : {
                    reconciliation_status: "ERROR",
                  },
          });
        }

        await tx.agencyBillingFileBatchItem.updateMany({
          where: { id_item: match.id_item },
          data: {
            status: "ERROR",
            response_code: row.bank_result_code,
            response_message: row.bank_result_message || "Resultado inválido",
            paid_reference: paidReference,
            processed_at: processedAt,
          },
        });

        await tx.agencyBillingFileBatchItem.create({
          data: {
            batch_id: inbound.id_batch,
            line_no: row.lineNo,
            attempt_id: attempt.id_attempt,
            charge_id: charge.id_charge,
            external_reference: row.external_attempt_ref,
            raw_hash: row.raw_hash,
            amount_ars: row.amount,
            status: "ERROR",
            response_code: row.bank_result_code,
            response_message: row.bank_result_message || "Resultado inválido",
            paid_reference: paidReference,
            row_payload: processorPayload,
            processed_at: processedAt,
          },
        });

        await logBillingEvent(
          {
            id_agency: charge.id_agency,
            subscription_id: null,
            event_type: "ATTEMPT_MARKED_ERROR",
            payload: {
              outbound_batch_id: outbound.id_batch,
              inbound_batch_id: inbound.id_batch,
              attempt_id: attempt.id_attempt,
              charge_id: charge.id_charge,
              processor_result_code: row.bank_result_code,
              processor_result_message: row.bank_result_message,
              mapped_status: row.mapped_status,
              mapped_detailed_reason: row.mapped_detailed_reason,
            },
            created_by: input.actorUserId ?? null,
          },
          tx,
        );

        errorRows += 1;
      },
      pdTxOptions(),
    );
  }

    const fiscalAutorun = await maybeAutorunFiscalForPaidCharges({
    chargeIds: Array.from(paidChargeIds),
    actorUserId: input.actorUserId ?? null,
  });

    await prisma.$transaction(
    async (tx) => {
      await tx.agencyBillingFileBatch.update({
        where: { id_batch: inbound.id_batch },
        data: {
          status: "PROCESSED",
          storage_key: inboundStorageKey,
          sha256: inboundSha,
          file_hash: inboundSha,
          adapter_version: adapter.version,
          total_rows: parsed.rows.length,
          total_amount_ars: inboundAmountTotal,
          record_count: inboundRecordCount,
          amount_total: inboundAmountTotal,
          total_paid_rows: paidRows,
          total_rejected_rows: rejectedRows,
          total_error_rows: errorRows,
          imported_at: new Date(),
          meta: {
            ...(serializeMeta(inbound.meta) || {}),
            parse_warnings: parsed.parseWarnings,
            control_totals: parsed.controlTotals,
            validated_totals: true,
          },
        },
      });

      await tx.agencyBillingFileBatch.update({
        where: { id_batch: outbound.id_batch },
        data: {
          status: matchedRows > 0 ? "RECONCILED" : outbound.status,
        },
      });
    },
    pdTxOptions(),
  );

    await logBatchEventForAgencies({
    agencyIds: Array.from(touchedAgencyIds),
    eventType: "PD_BATCH_INBOUND_IMPORTED",
    payload: {
      outbound_batch_id: outbound.id_batch,
      inbound_batch_id: inbound.id_batch,
      matched_rows: matchedRows,
      paid_rows: paidRows,
      rejected_rows: rejectedRows,
      error_rows: errorRows,
      adapter: adapter.name,
      adapter_version: adapter.version,
      control_totals: parsed.controlTotals,
      parse_warnings: parsed.parseWarnings,
      already_imported: false,
      fiscal_autorun_enabled: fiscalAutorun.enabled,
      fiscal_issued: fiscalAutorun.issued,
      fiscal_failed: fiscalAutorun.failed,
    },
    createdBy: input.actorUserId ?? null,
  });

    await createBillingFileImportRun({
      agencyIds: Array.from(touchedAgencyIds),
      outboundBatchId: outbound.id_batch,
      fileName: input.uploadedFile.fileName,
      fileHash: inboundSha,
      adapter: adapter.name,
      actorUserId: input.actorUserId ?? null,
      source: "MANUAL",
      status: "SUCCESS",
      detectedTotals: parsed.controlTotals,
      parsedRows: parsed.rows.length,
      metadata: {
        inbound_batch_id: inbound.id_batch,
        paid_rows: paidRows,
        rejected_rows: rejectedRows,
        error_rows: errorRows,
      },
    });

    return {
      inbound_batch_id: inbound.id_batch,
      already_imported: false,
      summary: {
        matched_rows: matchedRows,
        error_rows: errorRows,
        rejected: rejectedRows,
        paid: paidRows,
        fiscal_issued: fiscalAutorun.issued,
        fiscal_failed: fiscalAutorun.failed,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al importar respuesta bancaria";

    await createBillingFileImportRun({
      agencyIds,
      outboundBatchId: outbound.id_batch,
      fileName: input.uploadedFile.fileName,
      fileHash: inboundSha,
      adapter: adapter.name,
      actorUserId: input.actorUserId ?? null,
      source: "MANUAL",
      status: "FAILED",
      detectedTotals: parsed.controlTotals,
      parsedRows: parsed.rows.length,
      errorMessage: message,
    });

    throw error;
  }
}
