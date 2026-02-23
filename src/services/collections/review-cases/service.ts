import type {
  BillingCollectionChannel,
  BillingPaymentReviewCaseStatus,
  BillingPaymentReviewCaseType,
  BillingPaymentReviewResolutionType,
  Prisma,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { logBillingEvent } from "@/services/billing/events";

type BillingDbClient = Prisma.TransactionClient | typeof prisma;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function round2(value: number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

export async function createLateDuplicatePaymentReviewCase(input: {
  agencyId: number;
  chargeId: number;
  primaryPaidChannel: BillingCollectionChannel;
  secondaryLateChannel: BillingCollectionChannel;
  amountArs: number | null;
  detectedAt?: Date | null;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
  actorUserId?: number | null;
  source?: string | null;
  tx?: BillingDbClient;
}): Promise<{
  created: boolean;
  review_case_id: number;
  status: BillingPaymentReviewCaseStatus;
}> {
  const client = input.tx ?? prisma;

  const existing = await client.agencyBillingPaymentReviewCase.findUnique({
    where: { dedupe_key: input.dedupeKey },
    select: {
      id_review_case: true,
      status: true,
    },
  });

  if (existing) {
    return {
      created: false,
      review_case_id: existing.id_review_case,
      status: existing.status,
    };
  }

  const created = await client.agencyBillingPaymentReviewCase.create({
    data: {
      agency_id: input.agencyId,
      charge_id: input.chargeId,
      type: "LATE_DUPLICATE_PAYMENT",
      status: "OPEN",
      primary_paid_channel: input.primaryPaidChannel,
      secondary_late_channel: input.secondaryLateChannel,
      amount_ars: round2(input.amountArs),
      detected_at: input.detectedAt || new Date(),
      dedupe_key: input.dedupeKey,
      metadata_json: asJson({
        ...(input.metadata || {}),
        source: input.source || "SYSTEM",
      }),
    },
    select: {
      id_review_case: true,
      status: true,
    },
  });

  await logBillingEvent(
    {
      id_agency: input.agencyId,
      subscription_id: null,
      event_type: "PAYMENT_REVIEW_CASE_CREATED",
      payload: {
        review_case_id: created.id_review_case,
        charge_id: input.chargeId,
        type: "LATE_DUPLICATE_PAYMENT",
        status: created.status,
        primary_paid_channel: input.primaryPaidChannel,
        secondary_late_channel: input.secondaryLateChannel,
        amount_ars: round2(input.amountArs),
        source: input.source || "SYSTEM",
      },
      created_by: input.actorUserId ?? null,
    },
    client,
  );

  return {
    created: true,
    review_case_id: created.id_review_case,
    status: created.status,
  };
}

export async function listPaymentReviewCases(input?: {
  status?: BillingPaymentReviewCaseStatus | null;
  type?: BillingPaymentReviewCaseType | null;
  agencyId?: number | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
}) {
  const limit = Math.min(500, Math.max(1, input?.limit ?? 100));

  return prisma.agencyBillingPaymentReviewCase.findMany({
    where: {
      ...(input?.status ? { status: input.status } : {}),
      ...(input?.type ? { type: input.type } : {}),
      ...(input?.agencyId ? { agency_id: input.agencyId } : {}),
      ...(input?.from || input?.to
        ? {
            detected_at: {
              ...(input?.from ? { gte: input.from } : {}),
              ...(input?.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ detected_at: "desc" }, { id_review_case: "desc" }],
    take: limit,
    select: {
      id_review_case: true,
      agency_id: true,
      charge_id: true,
      type: true,
      status: true,
      primary_paid_channel: true,
      secondary_late_channel: true,
      amount_ars: true,
      detected_at: true,
      resolution_type: true,
      resolution_notes: true,
      resolved_by_user_id: true,
      resolved_at: true,
      metadata_json: true,
      created_at: true,
      updated_at: true,
    },
  });
}

async function transitionReviewCaseStatus(input: {
  caseId: number;
  nextStatus: BillingPaymentReviewCaseStatus;
  actorUserId?: number | null;
  source?: string | null;
  resolutionType?: BillingPaymentReviewResolutionType | null;
  notes?: string | null;
}): Promise<{
  updated: boolean;
  case_row: {
    id_review_case: number;
    agency_id: number;
    charge_id: number;
    status: BillingPaymentReviewCaseStatus;
    resolution_type: BillingPaymentReviewResolutionType | null;
    resolution_notes: string | null;
    resolved_at: Date | null;
    resolved_by_user_id: number | null;
  };
}> {
  const existing = await prisma.agencyBillingPaymentReviewCase.findUnique({
    where: { id_review_case: input.caseId },
    select: {
      id_review_case: true,
      agency_id: true,
      charge_id: true,
      type: true,
      status: true,
      resolution_type: true,
      resolution_notes: true,
      resolved_at: true,
      resolved_by_user_id: true,
    },
  });

  if (!existing) {
    throw new Error(`Review case ${input.caseId} no encontrado`);
  }

  const alreadyTerminal =
    existing.status === "RESOLVED" || existing.status === "IGNORED";

  const shouldUpdate =
    existing.status !== input.nextStatus && !(alreadyTerminal && input.nextStatus !== existing.status);

  if (!shouldUpdate) {
    return {
      updated: false,
      case_row: {
        id_review_case: existing.id_review_case,
        agency_id: existing.agency_id,
        charge_id: existing.charge_id,
        status: existing.status,
        resolution_type: existing.resolution_type,
        resolution_notes: existing.resolution_notes,
        resolved_at: existing.resolved_at,
        resolved_by_user_id: existing.resolved_by_user_id,
      },
    };
  }

  const now = new Date();
  const updated = await prisma.agencyBillingPaymentReviewCase.update({
    where: { id_review_case: existing.id_review_case },
    data: {
      status: input.nextStatus,
      resolution_type: input.resolutionType ?? undefined,
      resolution_notes: input.notes ?? undefined,
      resolved_at:
        input.nextStatus === "RESOLVED" || input.nextStatus === "IGNORED"
          ? now
          : null,
      resolved_by_user_id:
        input.nextStatus === "RESOLVED" || input.nextStatus === "IGNORED"
          ? input.actorUserId ?? null
          : null,
    },
    select: {
      id_review_case: true,
      agency_id: true,
      charge_id: true,
      status: true,
      resolution_type: true,
      resolution_notes: true,
      resolved_at: true,
      resolved_by_user_id: true,
    },
  });

  await logBillingEvent({
    id_agency: updated.agency_id,
    subscription_id: null,
    event_type: "PAYMENT_REVIEW_CASE_STATUS_CHANGED",
    payload: {
      review_case_id: updated.id_review_case,
      charge_id: updated.charge_id,
      previous_status: existing.status,
      new_status: updated.status,
      resolution_type: updated.resolution_type,
      notes: updated.resolution_notes,
      source: input.source || "MANUAL",
    },
    created_by: input.actorUserId ?? null,
  });

  return {
    updated: true,
    case_row: updated,
  };
}

export async function startPaymentReviewCase(input: {
  caseId: number;
  actorUserId?: number | null;
  source?: string | null;
}) {
  return transitionReviewCaseStatus({
    caseId: input.caseId,
    nextStatus: "IN_REVIEW",
    actorUserId: input.actorUserId ?? null,
    source: input.source || "MANUAL_START_REVIEW",
  });
}

export async function resolvePaymentReviewCase(input: {
  caseId: number;
  resolutionType: BillingPaymentReviewResolutionType;
  notes?: string | null;
  actorUserId?: number | null;
  source?: string | null;
}) {
  return transitionReviewCaseStatus({
    caseId: input.caseId,
    nextStatus: "RESOLVED",
    resolutionType: input.resolutionType,
    notes: input.notes ?? null,
    actorUserId: input.actorUserId ?? null,
    source: input.source || "MANUAL_RESOLVE",
  });
}

export async function ignorePaymentReviewCase(input: {
  caseId: number;
  notes?: string | null;
  actorUserId?: number | null;
  source?: string | null;
}) {
  return transitionReviewCaseStatus({
    caseId: input.caseId,
    nextStatus: "IGNORED",
    resolutionType: "NO_ACTION",
    notes: input.notes ?? null,
    actorUserId: input.actorUserId ?? null,
    source: input.source || "MANUAL_IGNORE",
  });
}
