import { beforeEach, describe, expect, it, vi } from "vitest";

type ReviewCaseRow = {
  id_review_case: number;
  agency_id: number;
  charge_id: number;
  type: "LATE_DUPLICATE_PAYMENT" | "AMOUNT_MISMATCH" | "OTHER";
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "IGNORED";
  primary_paid_channel: string | null;
  secondary_late_channel: string | null;
  amount_ars: number | null;
  detected_at: Date;
  dedupe_key: string;
  resolution_type: "BALANCE_CREDIT" | "REFUND_MANUAL" | "NO_ACTION" | "OTHER" | null;
  resolution_notes: string | null;
  resolved_by_user_id: number | null;
  resolved_at: Date | null;
  metadata_json: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

const reviewCases: ReviewCaseRow[] = [];
const billingEvents: Array<Record<string, unknown>> = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

vi.mock("@/services/billing/events", () => ({
  logBillingEvent: vi.fn(async (payload: Record<string, unknown>) => {
    billingEvents.push(clone(payload));
  }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    agencyBillingPaymentReviewCase: {
      findUnique: vi.fn(async ({ where }: { where: { id_review_case?: number; dedupe_key?: string } }) => {
        if (where.id_review_case) {
          return clone(
            reviewCases.find((item) => item.id_review_case === where.id_review_case) || null,
          );
        }
        if (where.dedupe_key) {
          return clone(reviewCases.find((item) => item.dedupe_key === where.dedupe_key) || null);
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: ReviewCaseRow = {
          id_review_case: reviewCases.length + 1,
          agency_id: Number(data.agency_id),
          charge_id: Number(data.charge_id),
          type: String(data.type) as ReviewCaseRow["type"],
          status: String(data.status) as ReviewCaseRow["status"],
          primary_paid_channel: (data.primary_paid_channel as string | null) || null,
          secondary_late_channel: (data.secondary_late_channel as string | null) || null,
          amount_ars: data.amount_ars == null ? null : Number(data.amount_ars),
          detected_at: (data.detected_at as Date) || now,
          dedupe_key: String(data.dedupe_key),
          resolution_type: null,
          resolution_notes: null,
          resolved_by_user_id: null,
          resolved_at: null,
          metadata_json: (data.metadata_json as Record<string, unknown> | null) || null,
          created_at: now,
          updated_at: now,
        };
        reviewCases.push(row);
        return clone(row);
      }),
      findMany: vi.fn(async () =>
        clone(
          [...reviewCases].sort(
            (a, b) => b.detected_at.getTime() - a.detected_at.getTime(),
          ),
        ),
      ),
      update: vi.fn(async ({ where, data }: { where: { id_review_case: number }; data: Record<string, unknown> }) => {
        const row = reviewCases.find((item) => item.id_review_case === where.id_review_case);
        if (!row) throw new Error("review case not found");
        if (typeof data.status === "string") {
          row.status = data.status as ReviewCaseRow["status"];
        }
        if ("resolution_type" in data) {
          row.resolution_type =
            (data.resolution_type as ReviewCaseRow["resolution_type"]) || null;
        }
        if ("resolution_notes" in data) {
          row.resolution_notes = (data.resolution_notes as string | null) || null;
        }
        if ("resolved_by_user_id" in data) {
          row.resolved_by_user_id = Number(data.resolved_by_user_id) || null;
        }
        if ("resolved_at" in data) {
          row.resolved_at = (data.resolved_at as Date | null) || null;
        }
        row.updated_at = new Date();
        return clone(row);
      }),
    },
  },
}));

describe("payment review cases", () => {
  beforeEach(() => {
    reviewCases.splice(0, reviewCases.length);
    billingEvents.splice(0, billingEvents.length);
  });

  it("createLateDuplicatePaymentReviewCase is idempotent by dedupe key", async () => {
    const { createLateDuplicatePaymentReviewCase } = await import(
      "@/services/collections/review-cases/service"
    );

    const first = await createLateDuplicatePaymentReviewCase({
      agencyId: 3,
      chargeId: 101,
      primaryPaidChannel: "CIG_QR",
      secondaryLateChannel: "PD_GALICIA",
      amountArs: 12345.67,
      dedupeKey: "dup:101:pd:trace-1",
      source: "TEST",
    });
    const second = await createLateDuplicatePaymentReviewCase({
      agencyId: 3,
      chargeId: 101,
      primaryPaidChannel: "CIG_QR",
      secondaryLateChannel: "PD_GALICIA",
      amountArs: 12345.67,
      dedupeKey: "dup:101:pd:trace-1",
      source: "TEST",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(reviewCases).toHaveLength(1);
    expect(reviewCases[0]?.status).toBe("OPEN");
  });

  it("resolvePaymentReviewCase updates status and stores resolution metadata", async () => {
    const {
      createLateDuplicatePaymentReviewCase,
      resolvePaymentReviewCase,
    } = await import("@/services/collections/review-cases/service");

    const created = await createLateDuplicatePaymentReviewCase({
      agencyId: 3,
      chargeId: 202,
      primaryPaidChannel: "CIG_QR",
      secondaryLateChannel: "PD_GALICIA",
      amountArs: 5000,
      dedupeKey: "dup:202",
      source: "TEST",
    });

    const resolved = await resolvePaymentReviewCase({
      caseId: created.review_case_id,
      resolutionType: "NO_ACTION",
      notes: "Validado sin acción",
      actorUserId: 99,
      source: "TEST_RESOLVE",
    });

    expect(resolved.updated).toBe(true);
    expect(resolved.case_row.status).toBe("RESOLVED");
    expect(resolved.case_row.resolution_type).toBe("NO_ACTION");
    expect(resolved.case_row.resolution_notes).toBe("Validado sin acción");
    expect(resolved.case_row.resolved_by_user_id).toBe(99);
    expect(resolved.case_row.resolved_at).toBeTruthy();
    expect(
      billingEvents.some(
        (event) =>
          event.event_type === "PAYMENT_REVIEW_CASE_STATUS_CHANGED" &&
          (event.payload as { new_status?: string })?.new_status === "RESOLVED",
      ),
    ).toBe(true);
  });
});
