import type {
  BillingCollectionChannel,
  BillingFallbackIntentStatus,
  BillingFallbackProvider,
  Prisma,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { logBillingEvent } from "@/services/billing/events";
import {
  canAutoSyncFallbackForAgency,
  getAgencyCollectionsRolloutMap,
  isAgencyEnabledForDunning,
  isAgencyEnabledForFallback,
} from "@/services/collections/core/agencyCollectionsRollout";
import { resolveFallbackProvider } from "@/services/collections/fallback/providers";

type BillingDbClient = Prisma.TransactionClient | typeof prisma;

const OPEN_FALLBACK_STATUSES: BillingFallbackIntentStatus[] = [
  "CREATED",
  "PENDING",
  "PRESENTED",
];

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "si"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[name] || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function round2(value: number): number {
  const safe = Number.isFinite(value) ? value : 0;
  return Math.round(safe * 100) / 100;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function resolveFallbackProviderFromEnv(
  raw?: string | null,
): BillingFallbackProvider {
  const normalized = String(raw || process.env.BILLING_FALLBACK_DEFAULT_PROVIDER || "cig_qr")
    .trim()
    .toLowerCase();

  if (normalized === "mp") return "MP";
  if (normalized === "other") return "OTHER";
  return "CIG_QR";
}

function mapProviderToPaidChannel(
  provider: BillingFallbackProvider,
): BillingCollectionChannel {
  if (provider === "MP") return "MP";
  if (provider === "OTHER") return "OTHER";
  return "CIG_QR";
}

function initialStatusFromProvider(
  status: "CREATED" | "PENDING" | "PRESENTED",
): BillingFallbackIntentStatus {
  if (status === "CREATED") return "CREATED";
  if (status === "PRESENTED") return "PRESENTED";
  return "PENDING";
}

function fallbackConfig() {
  return {
    enabled: parseBooleanEnv("BILLING_DUNNING_ENABLE_FALLBACK", true),
    defaultProvider: resolveFallbackProviderFromEnv(),
    expiresHours: Math.max(
      1,
      parseIntegerEnv("BILLING_FALLBACK_EXPIRES_HOURS", 72),
    ),
    mpEnabled: parseBooleanEnv("BILLING_FALLBACK_MP_ENABLED", false),
    syncBatchSize: Math.max(
      1,
      parseIntegerEnv("BILLING_FALLBACK_SYNC_BATCH_SIZE", 100),
    ),
    autoSync: parseBooleanEnv("BILLING_FALLBACK_AUTO_SYNC", false),
  };
}

function buildExternalReference(input: {
  chargeId: number;
  provider: BillingFallbackProvider;
  sequence: number;
}): string {
  return `FBK-${input.chargeId}-${input.provider}-${String(input.sequence).padStart(3, "0")}`;
}

export type CloseChargeAsPaidInput = {
  chargeId: number;
  paidViaChannel: BillingCollectionChannel;
  paidAt?: Date | null;
  amount?: number | null;
  sourceRef?: string | null;
  idempotencyKey?: string | null;
  actorUserId?: number | null;
  source?: string | null;
  keepFallbackIntentId?: number | null;
  tx?: BillingDbClient;
};

export type CloseChargeAsPaidResult = {
  closed: boolean;
  already_paid: boolean;
  charge_id: number;
  agency_id: number;
  paid_via_channel: BillingCollectionChannel | null;
  paid_at: Date | null;
  amount_ars_paid: number | null;
};

export async function closeChargeAsPaid(
  input: CloseChargeAsPaidInput,
): Promise<CloseChargeAsPaidResult> {
  const client = input.tx ?? prisma;
  const paidAt = input.paidAt || new Date();

  const charge = await client.agencyBillingCharge.findUnique({
    where: { id_charge: input.chargeId },
    select: {
      id_charge: true,
      id_agency: true,
      cycle_id: true,
      status: true,
      amount_ars_due: true,
      amount_ars_paid: true,
      paid_at: true,
      paid_via_channel: true,
    },
  });

  if (!charge) {
    throw new Error(`Charge ${input.chargeId} no encontrado`);
  }

  if (charge.status === "PAID") {
    return {
      closed: false,
      already_paid: true,
      charge_id: charge.id_charge,
      agency_id: charge.id_agency,
      paid_via_channel: charge.paid_via_channel,
      paid_at: charge.paid_at,
      amount_ars_paid:
        charge.amount_ars_paid == null ? null : Number(charge.amount_ars_paid),
    };
  }

  const paidAmount = round2(Number(input.amount ?? charge.amount_ars_due ?? 0));

  await client.agencyBillingCharge.update({
    where: { id_charge: charge.id_charge },
    data: {
      status: "PAID",
      amount_ars_paid: paidAmount,
      paid_at: paidAt,
      paid_reference: input.sourceRef ?? null,
      reconciliation_status: "MATCHED",
      paid_currency: "ARS",
      paid_via_channel: input.paidViaChannel,
      last_dunning_action_at: paidAt,
    },
  });

  await client.agencyBillingAttempt.updateMany({
    where: {
      charge_id: charge.id_charge,
      status: { in: ["PENDING", "SCHEDULED", "PROCESSING"] },
    },
    data: {
      status: "CANCELED",
      processed_at: paidAt,
      notes: "Cancelado por cobro confirmado en otro canal",
    },
  });

  await client.agencyBillingFallbackIntent.updateMany({
    where: {
      charge_id: charge.id_charge,
      status: { in: OPEN_FALLBACK_STATUSES },
      ...(input.keepFallbackIntentId
        ? { id_fallback_intent: { not: input.keepFallbackIntentId } }
        : {}),
    },
    data: {
      status: "CANCELED",
      failure_code: "CANCELED_ON_CHARGE_CLOSED",
      failure_message: "Cancelado porque el charge fue cerrado por otro canal",
    },
  });

  if (charge.cycle_id) {
    await client.agencyBillingCycle.update({
      where: { id_cycle: charge.cycle_id },
      data: { status: "PAID" },
    });
  }

  await logBillingEvent(
    {
      id_agency: charge.id_agency,
      subscription_id: null,
      event_type: "BILLING_CHARGE_PAID",
      payload: {
        charge_id: charge.id_charge,
        agency_id: charge.id_agency,
        paid_at: paidAt,
        amount: paidAmount,
        channel: input.paidViaChannel,
        source_ref: input.sourceRef || null,
        source: input.source || "SYSTEM",
        idempotency_key: input.idempotencyKey || null,
      },
      created_by: input.actorUserId ?? null,
    },
    client,
  );

  return {
    closed: true,
    already_paid: false,
    charge_id: charge.id_charge,
    agency_id: charge.id_agency,
    paid_via_channel: input.paidViaChannel,
    paid_at: paidAt,
    amount_ars_paid: paidAmount,
  };
}

export async function advanceDunningStageForCharge(input: {
  chargeId: number;
  newStage: number;
  actorUserId?: number | null;
  source?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  tx?: BillingDbClient;
}): Promise<{
  charge_id: number;
  previous_stage: number;
  new_stage: number;
  moved: boolean;
}> {
  const client = input.tx ?? prisma;
  const now = new Date();
  const charge = await client.agencyBillingCharge.findUnique({
    where: { id_charge: input.chargeId },
    select: {
      id_charge: true,
      id_agency: true,
      status: true,
      dunning_stage: true,
      overdue_since: true,
      collections_escalated_at: true,
    },
  });

  if (!charge) throw new Error(`Charge ${input.chargeId} no encontrado`);

  const previousStage = Number(charge.dunning_stage || 0);
  const targetStage = Math.max(previousStage, Math.max(0, Math.trunc(input.newStage)));

  if (charge.status === "PAID" || targetStage === previousStage) {
    return {
      charge_id: charge.id_charge,
      previous_stage: previousStage,
      new_stage: previousStage,
      moved: false,
    };
  }

  await client.agencyBillingCharge.update({
    where: { id_charge: charge.id_charge },
    data: {
      dunning_stage: targetStage,
      last_dunning_action_at: now,
      overdue_since:
        previousStage === 0 && targetStage > 0 && !charge.overdue_since
          ? now
          : undefined,
      collections_escalated_at:
        targetStage >= 4 && !charge.collections_escalated_at ? now : undefined,
    },
  });

  await logBillingEvent(
    {
      id_agency: charge.id_agency,
      subscription_id: null,
      event_type: "CHARGE_DUNNING_STAGE_CHANGED",
      payload: {
        charge_id: charge.id_charge,
        previous_stage: previousStage,
        new_stage: targetStage,
        source: input.source || "SYSTEM",
        reason_code: input.reasonCode || null,
        reason_text: input.reasonText || null,
      },
      created_by: input.actorUserId ?? null,
    },
    client,
  );

  return {
    charge_id: charge.id_charge,
    previous_stage: previousStage,
    new_stage: targetStage,
    moved: true,
  };
}

export type CreateFallbackIntentResult = {
  created: boolean;
  no_op: boolean;
  reason: string | null;
  charge_id: number;
  provider: BillingFallbackProvider;
  fallback_intent_id: number | null;
  status: BillingFallbackIntentStatus | null;
  payment_url: string | null;
  qr_payload: string | null;
  expires_at: Date | null;
};

export async function createFallbackIntentForCharge(input: {
  chargeId: number;
  provider?: BillingFallbackProvider | null;
  actorUserId?: number | null;
  source?: string | null;
  dryRun?: boolean;
  tx?: BillingDbClient;
}): Promise<CreateFallbackIntentResult> {
  const client = input.tx ?? prisma;
  const config = fallbackConfig();
  const now = new Date();
  let provider = input.provider || config.defaultProvider;

  if (provider === "MP" && !config.mpEnabled) {
    return {
      created: false,
      no_op: true,
      reason: "provider_mp_disabled",
      charge_id: input.chargeId,
      provider,
      fallback_intent_id: null,
      status: null,
      payment_url: null,
      qr_payload: null,
      expires_at: null,
    };
  }

  if (!config.enabled) {
    return {
      created: false,
      no_op: true,
      reason: "fallback_disabled",
      charge_id: input.chargeId,
      provider,
      fallback_intent_id: null,
      status: null,
      payment_url: null,
      qr_payload: null,
      expires_at: null,
    };
  }

  const charge = await client.agencyBillingCharge.findUnique({
    where: { id_charge: input.chargeId },
    select: {
      id_charge: true,
      id_agency: true,
      status: true,
      amount_ars_due: true,
      dunning_stage: true,
    },
  });

  if (!charge) throw new Error(`Charge ${input.chargeId} no encontrado`);

  const rolloutMap = await getAgencyCollectionsRolloutMap({
    agencyIds: [charge.id_agency],
    tx: client,
  });
  const rollout = rolloutMap.get(charge.id_agency);
  if (!isAgencyEnabledForFallback(rollout)) {
    return {
      created: false,
      no_op: true,
      reason: "fallback_disabled_for_agency",
      charge_id: charge.id_charge,
      provider,
      fallback_intent_id: null,
      status: null,
      payment_url: null,
      qr_payload: null,
      expires_at: null,
    };
  }

  if (!input.provider && rollout?.collections_fallback_provider) {
    provider = rollout.collections_fallback_provider;
  }

  if (provider === "MP" && !config.mpEnabled) {
    return {
      created: false,
      no_op: true,
      reason: "provider_mp_disabled",
      charge_id: charge.id_charge,
      provider,
      fallback_intent_id: null,
      status: null,
      payment_url: null,
      qr_payload: null,
      expires_at: null,
    };
  }

  if (charge.status === "PAID") {
    return {
      created: false,
      no_op: true,
      reason: "charge_already_paid",
      charge_id: charge.id_charge,
      provider,
      fallback_intent_id: null,
      status: null,
      payment_url: null,
      qr_payload: null,
      expires_at: null,
    };
  }

  const existingOpen = await client.agencyBillingFallbackIntent.findFirst({
    where: {
      charge_id: charge.id_charge,
      provider,
      status: { in: OPEN_FALLBACK_STATUSES },
    },
    orderBy: [{ created_at: "desc" }],
  });

  if (existingOpen) {
    return {
      created: false,
      no_op: true,
      reason: "fallback_already_open",
      charge_id: charge.id_charge,
      provider,
      fallback_intent_id: existingOpen.id_fallback_intent,
      status: existingOpen.status,
      payment_url: existingOpen.payment_url,
      qr_payload: existingOpen.qr_payload,
      expires_at: existingOpen.expires_at,
    };
  }

  const expiresAt = new Date(now.getTime() + config.expiresHours * 60 * 60 * 1000);

  if (input.dryRun) {
    return {
      created: false,
      no_op: false,
      reason: null,
      charge_id: charge.id_charge,
      provider,
      fallback_intent_id: null,
      status: "PENDING",
      payment_url: null,
      qr_payload: null,
      expires_at: expiresAt,
    };
  }

  const existingCount = await client.agencyBillingFallbackIntent.count({
    where: {
      charge_id: charge.id_charge,
      provider,
    },
  });
  const externalReference = buildExternalReference({
    chargeId: charge.id_charge,
    provider,
    sequence: existingCount + 1,
  });

  const providerApi = resolveFallbackProvider(provider);
  const providerIntent = await providerApi.createPaymentIntentForCharge({
    charge: {
      id_charge: charge.id_charge,
      id_agency: charge.id_agency,
    },
    amount: round2(Number(charge.amount_ars_due || 0)),
    currency: "ARS",
    external_reference: externalReference,
    idempotency_key: externalReference,
    expires_at: expiresAt,
  });

  const created = await client.agencyBillingFallbackIntent.create({
    data: {
      agency_id: charge.id_agency,
      charge_id: charge.id_charge,
      provider,
      status: initialStatusFromProvider(providerIntent.status),
      amount: round2(Number(charge.amount_ars_due || 0)),
      currency: "ARS",
      external_reference: externalReference,
      provider_payment_id: providerIntent.provider_payment_id,
      provider_status: providerIntent.provider_status,
      provider_status_detail: providerIntent.provider_status_detail,
      payment_url: providerIntent.payment_url,
      qr_payload: providerIntent.qr_payload,
      qr_image_url: providerIntent.qr_image_url,
      expires_at: expiresAt,
      provider_raw_payload: asJson(providerIntent.provider_raw_payload),
    },
  });

  const stageUpdate = await advanceDunningStageForCharge({
    chargeId: charge.id_charge,
    newStage: 3,
    actorUserId: input.actorUserId ?? null,
    source: input.source || "SYSTEM",
    tx: client,
  });

  await client.agencyBillingCharge.update({
    where: { id_charge: charge.id_charge },
    data: {
      fallback_offered_at: now,
      fallback_expires_at: expiresAt,
      last_dunning_action_at: now,
      overdue_since: now,
    },
  });

  await logBillingEvent(
    {
      id_agency: charge.id_agency,
      subscription_id: null,
      event_type: "FALLBACK_INTENT_CREATED",
      payload: {
        charge_id: charge.id_charge,
        fallback_intent_id: created.id_fallback_intent,
        provider,
        amount: Number(created.amount || 0),
        status: created.status,
        payment_url: created.payment_url,
        expires_at: created.expires_at,
        source: input.source || "SYSTEM",
        previous_stage: stageUpdate.previous_stage,
        new_stage: stageUpdate.new_stage,
      },
      created_by: input.actorUserId ?? null,
    },
    client,
  );

  return {
    created: true,
    no_op: false,
    reason: null,
    charge_id: charge.id_charge,
    provider,
    fallback_intent_id: created.id_fallback_intent,
    status: created.status,
    payment_url: created.payment_url,
    qr_payload: created.qr_payload,
    expires_at: created.expires_at,
  };
}

export async function evaluateAndCreateFallback(input: {
  chargeId: number;
  actorUserId?: number | null;
  source?: string | null;
  provider?: BillingFallbackProvider | null;
  tx?: BillingDbClient;
}): Promise<CreateFallbackIntentResult> {
  return createFallbackIntentForCharge({
    chargeId: input.chargeId,
    actorUserId: input.actorUserId ?? null,
    source: input.source || "SYSTEM",
    provider: input.provider ?? null,
    tx: input.tx,
  });
}

export async function onPdAttemptRejected(input: {
  chargeId: number;
  attemptId: number;
  actorUserId?: number | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  source?: string | null;
  tx?: BillingDbClient;
}): Promise<{
  stage: number;
  fallback_created: boolean;
  fallback_intent_id: number | null;
  reason: string | null;
}> {
  const client = input.tx ?? prisma;
  const attempt = await client.agencyBillingAttempt.findUnique({
    where: { id_attempt: input.attemptId },
    select: {
      id_attempt: true,
      charge_id: true,
      attempt_no: true,
      status: true,
    },
  });

  if (!attempt || attempt.charge_id !== input.chargeId) {
    return {
      stage: 0,
      fallback_created: false,
      fallback_intent_id: null,
      reason: "attempt_not_found",
    };
  }

  const charge = await client.agencyBillingCharge.findUnique({
    where: { id_charge: input.chargeId },
    select: {
      id_agency: true,
      dunning_stage: true,
    },
  });

  if (!charge) {
    return {
      stage: 0,
      fallback_created: false,
      fallback_intent_id: null,
      reason: "charge_not_found",
    };
  }

  const rolloutMap = await getAgencyCollectionsRolloutMap({
    agencyIds: [charge.id_agency],
    tx: client,
  });
  const rollout = rolloutMap.get(charge.id_agency);
  if (!isAgencyEnabledForDunning(rollout)) {
    return {
      stage: Number(charge.dunning_stage || 0),
      fallback_created: false,
      fallback_intent_id: null,
      reason: "dunning_disabled_for_agency",
    };
  }

  const staged = await advanceDunningStageForCharge({
    chargeId: input.chargeId,
    newStage:
      attempt.attempt_no <= 1 ? 1 : attempt.attempt_no === 2 ? 2 : 2,
    actorUserId: input.actorUserId ?? null,
    source: input.source || "PD_REJECTED",
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    tx: client,
  });

  const [pendingFuture, maxAttempt] = await Promise.all([
    client.agencyBillingAttempt.count({
      where: {
        charge_id: input.chargeId,
        attempt_no: { gt: attempt.attempt_no },
        status: { in: ["PENDING", "SCHEDULED", "PROCESSING"] },
      },
    }),
    client.agencyBillingAttempt.findFirst({
      where: { charge_id: input.chargeId },
      orderBy: [{ attempt_no: "desc" }],
      select: { attempt_no: true },
    }),
  ]);

  const finalAttemptNo = maxAttempt?.attempt_no || attempt.attempt_no;
  const isFinalRejected =
    pendingFuture === 0 && attempt.attempt_no >= finalAttemptNo;

  if (!isFinalRejected) {
    return {
      stage: staged.new_stage,
      fallback_created: false,
      fallback_intent_id: null,
      reason: "pd_attempts_remaining",
    };
  }

  const fallback = await evaluateAndCreateFallback({
    chargeId: input.chargeId,
    actorUserId: input.actorUserId ?? null,
    source: input.source || "PD_REJECTED_FINAL",
    tx: client,
  });

  return {
    stage: fallback.created ? 3 : staged.new_stage,
    fallback_created: fallback.created,
    fallback_intent_id: fallback.fallback_intent_id,
    reason: fallback.reason,
  };
}

export async function onPdAttemptPaid(input: {
  chargeId: number;
  amount?: number | null;
  paidAt?: Date | null;
  sourceRef?: string | null;
  actorUserId?: number | null;
  source?: string | null;
  tx?: BillingDbClient;
}): Promise<CloseChargeAsPaidResult> {
  return closeChargeAsPaid({
    chargeId: input.chargeId,
    paidViaChannel: "PD_GALICIA",
    amount: input.amount ?? null,
    paidAt: input.paidAt ?? null,
    sourceRef: input.sourceRef ?? null,
    actorUserId: input.actorUserId ?? null,
    source: input.source || "PD_RECONCILIATION",
    tx: input.tx,
  });
}

export async function onFallbackPaid(input: {
  fallbackIntentId: number;
  paidAt?: Date | null;
  actorUserId?: number | null;
  source?: string | null;
  tx?: BillingDbClient;
}): Promise<{
  fallback_intent_id: number;
  charge_id: number;
  already_paid: boolean;
  closed_charge: boolean;
}> {
  const execute = async (
    client: BillingDbClient,
  ): Promise<{
    fallback_intent_id: number;
    charge_id: number;
    already_paid: boolean;
    closed_charge: boolean;
  }> => {
    const intent = await client.agencyBillingFallbackIntent.findUnique({
      where: { id_fallback_intent: input.fallbackIntentId },
      select: {
        id_fallback_intent: true,
        agency_id: true,
        charge_id: true,
        provider: true,
        status: true,
        amount: true,
        external_reference: true,
        paid_at: true,
      },
    });

    if (!intent) {
      throw new Error(`Fallback intent ${input.fallbackIntentId} no encontrado`);
    }

    const paidAt = input.paidAt || intent.paid_at || new Date();

    const wasAlreadyPaid = intent.status === "PAID";

    if (!wasAlreadyPaid) {
      await client.agencyBillingFallbackIntent.update({
        where: { id_fallback_intent: intent.id_fallback_intent },
        data: {
          status: "PAID",
          paid_at: paidAt,
          provider_status: "PAID",
          provider_status_detail: "CONFIRMED",
        },
      });

      await logBillingEvent(
        {
          id_agency: intent.agency_id,
          subscription_id: null,
          event_type: "FALLBACK_PAYMENT_CONFIRMED",
          payload: {
            charge_id: intent.charge_id,
            fallback_intent_id: intent.id_fallback_intent,
            provider: intent.provider,
            paid_at: paidAt,
            amount: Number(intent.amount || 0),
            source: input.source || "FALLBACK_SYNC",
          },
          created_by: input.actorUserId ?? null,
        },
        client,
      );
    }

    const closeResult = await closeChargeAsPaid({
      chargeId: intent.charge_id,
      paidViaChannel: mapProviderToPaidChannel(intent.provider),
      paidAt,
      amount: Number(intent.amount || 0),
      sourceRef: intent.external_reference,
      actorUserId: input.actorUserId ?? null,
      source: input.source || "FALLBACK_SYNC",
      tx: client,
      keepFallbackIntentId: intent.id_fallback_intent,
    });

    if (closeResult.closed) {
      await logBillingEvent(
        {
          id_agency: intent.agency_id,
          subscription_id: null,
          event_type: "CHARGE_PAID_VIA_FALLBACK",
          payload: {
            charge_id: intent.charge_id,
            fallback_intent_id: intent.id_fallback_intent,
            provider: intent.provider,
            paid_at: paidAt,
            amount: Number(intent.amount || 0),
          },
          created_by: input.actorUserId ?? null,
        },
        client,
      );
    }

    return {
      fallback_intent_id: intent.id_fallback_intent,
      charge_id: intent.charge_id,
      already_paid: closeResult.already_paid,
      closed_charge: closeResult.closed,
    };
  };

  if (input.tx) return execute(input.tx);
  return prisma.$transaction((tx) => execute(tx));
}

export async function onFallbackExpired(input: {
  fallbackIntentId: number;
  actorUserId?: number | null;
  source?: string | null;
  tx?: BillingDbClient;
}): Promise<{
  fallback_intent_id: number;
  charge_id: number;
  escalated: boolean;
}> {
  const client = input.tx ?? prisma;
  const now = new Date();
  const intent = await client.agencyBillingFallbackIntent.findUnique({
    where: { id_fallback_intent: input.fallbackIntentId },
    select: {
      id_fallback_intent: true,
      agency_id: true,
      charge_id: true,
      provider: true,
      status: true,
    },
  });

  if (!intent) {
    throw new Error(`Fallback intent ${input.fallbackIntentId} no encontrado`);
  }

  if (!["PAID", "CANCELED"].includes(intent.status)) {
    await client.agencyBillingFallbackIntent.update({
      where: { id_fallback_intent: intent.id_fallback_intent },
      data: {
        status: "EXPIRED",
        provider_status: "EXPIRED",
        provider_status_detail: "EXPIRED_BY_PROVIDER_OR_TTL",
      },
    });
  }

  const stage = await advanceDunningStageForCharge({
    chargeId: intent.charge_id,
    newStage: 4,
    actorUserId: input.actorUserId ?? null,
    source: input.source || "FALLBACK_EXPIRED",
    reasonCode: "FALLBACK_EXPIRED",
    reasonText: "Fallback vencido",
    tx: client,
  });

  await logBillingEvent(
    {
      id_agency: intent.agency_id,
      subscription_id: null,
      event_type: "FALLBACK_PAYMENT_EXPIRED",
      payload: {
        charge_id: intent.charge_id,
        fallback_intent_id: intent.id_fallback_intent,
        provider: intent.provider,
        expired_at: now,
        stage_after: stage.new_stage,
      },
      created_by: input.actorUserId ?? null,
    },
    client,
  );

  return {
    fallback_intent_id: intent.id_fallback_intent,
    charge_id: intent.charge_id,
    escalated: stage.new_stage >= 4,
  };
}

export async function cancelFallbackIntent(input: {
  fallbackIntentId: number;
  actorUserId?: number | null;
  source?: string | null;
}): Promise<{
  canceled: boolean;
  fallback_intent_id: number;
  charge_id: number;
  status: BillingFallbackIntentStatus;
}> {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.agencyBillingFallbackIntent.findUnique({
      where: { id_fallback_intent: input.fallbackIntentId },
      select: {
        id_fallback_intent: true,
        agency_id: true,
        charge_id: true,
        provider: true,
        status: true,
        external_reference: true,
        provider_payment_id: true,
        provider_status: true,
        provider_status_detail: true,
        expires_at: true,
        paid_at: true,
      },
    });

    if (!intent) {
      throw new Error(`Fallback intent ${input.fallbackIntentId} no encontrado`);
    }

    if (intent.status === "PAID" || intent.status === "CANCELED") {
      return {
        canceled: false,
        fallback_intent_id: intent.id_fallback_intent,
        charge_id: intent.charge_id,
        status: intent.status,
      };
    }

    const providerApi = resolveFallbackProvider(intent.provider);
    const cancellation = await providerApi.cancelPaymentIntent({
      id_fallback_intent: intent.id_fallback_intent,
      provider: intent.provider,
      status: intent.status,
      external_reference: intent.external_reference,
      provider_payment_id: intent.provider_payment_id,
      provider_status: intent.provider_status,
      provider_status_detail: intent.provider_status_detail,
      expires_at: intent.expires_at,
      paid_at: intent.paid_at,
    });

    const nextStatus: BillingFallbackIntentStatus =
      cancellation.final_status === "PAID" ? "PAID" : "CANCELED";

    await tx.agencyBillingFallbackIntent.update({
      where: { id_fallback_intent: intent.id_fallback_intent },
      data: {
        status: nextStatus,
        provider_status: cancellation.final_status,
        provider_status_detail:
          cancellation.final_status === "PAID"
            ? "ALREADY_PAID"
            : "CANCELED_MANUAL",
        provider_raw_payload: asJson(cancellation.raw_payload),
      },
    });

    await logBillingEvent(
      {
        id_agency: intent.agency_id,
        subscription_id: null,
        event_type:
          nextStatus === "PAID"
            ? "FALLBACK_PAYMENT_CONFIRMED"
            : "FALLBACK_PAYMENT_CANCELED",
        payload: {
          charge_id: intent.charge_id,
          fallback_intent_id: intent.id_fallback_intent,
          provider: intent.provider,
          source: input.source || "MANUAL",
        },
        created_by: input.actorUserId ?? null,
      },
      tx,
    );

    return {
      canceled: nextStatus === "CANCELED",
      fallback_intent_id: intent.id_fallback_intent,
      charge_id: intent.charge_id,
      status: nextStatus,
    };
  });
}

export async function markFallbackIntentPaid(input: {
  fallbackIntentId: number;
  actorUserId?: number | null;
}): Promise<{
  fallback_intent_id: number;
  charge_id: number;
  already_paid: boolean;
  closed_charge: boolean;
}> {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.agencyBillingFallbackIntent.findUnique({
      where: { id_fallback_intent: input.fallbackIntentId },
      select: {
        id_fallback_intent: true,
      },
    });

    if (!intent) {
      throw new Error(`Fallback intent ${input.fallbackIntentId} no encontrado`);
    }

    await tx.agencyBillingFallbackIntent.update({
      where: { id_fallback_intent: intent.id_fallback_intent },
      data: {
        provider_status: "PAID",
        provider_status_detail: "MANUAL_MARK_PAID",
      },
    });

    return onFallbackPaid({
      fallbackIntentId: intent.id_fallback_intent,
      actorUserId: input.actorUserId ?? null,
      source: "MANUAL_MARK_PAID",
      tx,
    });
  });
}

export async function syncFallbackStatuses(input?: {
  provider?: BillingFallbackProvider | null;
  fallbackIntentId?: number | null;
  limit?: number;
  actorUserId?: number | null;
  onlyAutoSyncEnabled?: boolean;
}): Promise<{
  considered: number;
  paid: number;
  pending: number;
  expired: number;
  failed: number;
  no_op: boolean;
  ids: number[];
}> {
  const config = fallbackConfig();
  const limit = Math.min(
    500,
    Math.max(1, input?.limit ?? config.syncBatchSize),
  );

  const intents = await prisma.agencyBillingFallbackIntent.findMany({
    where: {
      ...(input?.fallbackIntentId
        ? { id_fallback_intent: input.fallbackIntentId }
        : {}),
      ...(input?.provider ? { provider: input.provider } : {}),
      status: { in: OPEN_FALLBACK_STATUSES },
    },
    orderBy: [{ id_fallback_intent: "asc" }],
    take: limit,
  });

  if (!intents.length) {
    return {
      considered: 0,
      paid: 0,
      pending: 0,
      expired: 0,
      failed: 0,
      no_op: true,
      ids: [],
    };
  }

  const rolloutMap = await getAgencyCollectionsRolloutMap({
    agencyIds: intents.map((intent) => intent.agency_id),
  });
  const eligibleIntents = intents.filter((intent) => {
    const rollout = rolloutMap.get(intent.agency_id);
    if (!isAgencyEnabledForFallback(rollout)) return false;
    if (input?.onlyAutoSyncEnabled) {
      return canAutoSyncFallbackForAgency(rollout);
    }
    return true;
  });

  if (!eligibleIntents.length) {
    return {
      considered: 0,
      paid: 0,
      pending: 0,
      expired: 0,
      failed: 0,
      no_op: true,
      ids: [],
    };
  }

  let paid = 0;
  let pending = 0;
  let expired = 0;
  let failed = 0;

  for (const intent of eligibleIntents) {
    const providerApi = resolveFallbackProvider(intent.provider);
    const status = await providerApi.getPaymentStatus({
      id_fallback_intent: intent.id_fallback_intent,
      provider: intent.provider,
      status: intent.status,
      external_reference: intent.external_reference,
      provider_payment_id: intent.provider_payment_id,
      provider_status: intent.provider_status,
      provider_status_detail: intent.provider_status_detail,
      expires_at: intent.expires_at,
      paid_at: intent.paid_at,
    });

    if (status.mapped_status === "PAID") {
      await onFallbackPaid({
        fallbackIntentId: intent.id_fallback_intent,
        paidAt: status.paid_at,
        actorUserId: input?.actorUserId ?? null,
        source: "FALLBACK_SYNC",
      });
      paid += 1;
      continue;
    }

    if (status.mapped_status === "EXPIRED") {
      await onFallbackExpired({
        fallbackIntentId: intent.id_fallback_intent,
        actorUserId: input?.actorUserId ?? null,
        source: "FALLBACK_SYNC",
      });
      expired += 1;
      continue;
    }

    if (status.mapped_status === "FAILED") {
      await prisma.$transaction(async (tx) => {
        await tx.agencyBillingFallbackIntent.update({
          where: { id_fallback_intent: intent.id_fallback_intent },
          data: {
            status: "FAILED",
            provider_status: status.provider_status,
            provider_status_detail: "FAILED",
            provider_raw_payload: asJson(status.raw_payload),
            failure_code: status.provider_status || "FAILED",
            failure_message: "Fallback rechazado por provider",
          },
        });

        await advanceDunningStageForCharge({
          chargeId: intent.charge_id,
          newStage: 4,
          actorUserId: input?.actorUserId ?? null,
          source: "FALLBACK_SYNC",
          reasonCode: status.provider_status || "FAILED",
          reasonText: "Fallback failed",
          tx,
        });

        await logBillingEvent(
          {
            id_agency: intent.agency_id,
            subscription_id: null,
            event_type: "FALLBACK_INTENT_UPDATED",
            payload: {
              charge_id: intent.charge_id,
              fallback_intent_id: intent.id_fallback_intent,
              status: "FAILED",
              provider_status: status.provider_status,
            },
            created_by: input?.actorUserId ?? null,
          },
          tx,
        );
      });
      failed += 1;
      continue;
    }

    await prisma.agencyBillingFallbackIntent.update({
      where: { id_fallback_intent: intent.id_fallback_intent },
      data: {
        status: intent.status === "CREATED" ? "PRESENTED" : intent.status,
        provider_status: status.provider_status,
        provider_status_detail: "SYNC_PENDING",
        provider_raw_payload: asJson(status.raw_payload),
      },
    });
    pending += 1;
  }

  return {
    considered: eligibleIntents.length,
    paid,
    pending,
    expired,
    failed,
    no_op: false,
    ids: eligibleIntents.map((item) => item.id_fallback_intent),
  };
}

export async function createFallbackForEligibleCharges(input?: {
  chargeId?: number | null;
  provider?: BillingFallbackProvider | null;
  allowedAgencyIds?: number[];
  limit?: number;
  dryRun?: boolean;
  actorUserId?: number | null;
}): Promise<{
  considered: number;
  created: number;
  no_op: boolean;
  ids: number[];
  reasons: string[];
}> {
  const limit = Math.min(500, Math.max(1, input?.limit ?? 100));
  const charges = await prisma.agencyBillingCharge.findMany({
    where: {
      ...(input?.chargeId ? { id_charge: input.chargeId } : {}),
      ...(input?.allowedAgencyIds && input.allowedAgencyIds.length > 0
        ? { id_agency: { in: input.allowedAgencyIds } }
        : {}),
      status: { not: "PAID" },
      dunning_stage: { gte: 3 },
    },
    orderBy: [{ id_charge: "asc" }],
    take: limit,
    select: {
      id_charge: true,
      id_agency: true,
    },
  });

  if (!charges.length) {
    return {
      considered: 0,
      created: 0,
      no_op: true,
      ids: [],
      reasons: [],
    };
  }

  let created = 0;
  const ids: number[] = [];
  const reasons: string[] = [];
  const rolloutMap = await getAgencyCollectionsRolloutMap({
    agencyIds: charges.map((charge) => charge.id_agency),
  });

  for (const charge of charges) {
    if (!isAgencyEnabledForFallback(rolloutMap.get(charge.id_agency))) {
      reasons.push(`charge_${charge.id_charge}:fallback_disabled_for_agency`);
      continue;
    }

    const result = await createFallbackIntentForCharge({
      chargeId: charge.id_charge,
      provider: input?.provider ?? null,
      dryRun: Boolean(input?.dryRun),
      actorUserId: input?.actorUserId ?? null,
      source: "FALLBACK_CREATE_JOB",
    });

    if (result.created && result.fallback_intent_id) {
      created += 1;
      ids.push(result.fallback_intent_id);
    } else if (result.reason) {
      reasons.push(`charge_${charge.id_charge}:${result.reason}`);
    }
  }

  return {
    considered: charges.length,
    created,
    no_op: created === 0,
    ids,
    reasons,
  };
}

export function getFallbackRuntimeConfig() {
  return fallbackConfig();
}
