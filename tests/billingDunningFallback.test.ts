import { beforeEach, describe, expect, it, vi } from "vitest";

type ChargeRow = {
  id_charge: number;
  id_agency: number;
  cycle_id: number | null;
  status: string;
  amount_ars_due: number;
  amount_ars_paid: number | null;
  paid_at: Date | null;
  paid_via_channel: "PD_GALICIA" | "CIG_QR" | "MP" | "OTHER" | null;
  dunning_stage: number;
  fallback_offered_at: Date | null;
  fallback_expires_at: Date | null;
  overdue_since: Date | null;
  collections_escalated_at: Date | null;
};

type AttemptRow = {
  id_attempt: number;
  charge_id: number;
  attempt_no: number;
  status: string;
  processed_at: Date | null;
  notes: string | null;
};

type FallbackIntentRow = {
  id_fallback_intent: number;
  agency_id: number;
  charge_id: number;
  provider: "CIG_QR" | "MP" | "OTHER";
  status: "CREATED" | "PENDING" | "PRESENTED" | "PAID" | "EXPIRED" | "CANCELED" | "FAILED";
  amount: number;
  currency: string;
  external_reference: string;
  provider_payment_id: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  payment_url: string | null;
  qr_payload: string | null;
  qr_image_url: string | null;
  expires_at: Date | null;
  paid_at: Date | null;
  failure_code: string | null;
  failure_message: string | null;
  provider_raw_payload: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

let charges: ChargeRow[] = [];
let attempts: AttemptRow[] = [];
let fallbackIntents: FallbackIntentRow[] = [];
let loggedEvents: Array<Record<string, unknown>> = [];

function clone<T>(value: T): T {
  return structuredClone(value);
}

const logBillingEventMock = vi.fn(async (input: Record<string, unknown>) => {
  loggedEvents.push(clone(input));
});

function nextId(rows: Array<Record<string, unknown>>, key: string): number {
  const max = rows.reduce((acc, item) => {
    const value = Number(item[key] || 0);
    return Number.isFinite(value) && value > acc ? value : acc;
  }, 0);
  return max + 1;
}

function findCharges(where?: Record<string, unknown>): ChargeRow[] {
  return charges.filter((row) => {
    if (where?.id_charge && typeof where.id_charge === "number" && row.id_charge !== where.id_charge) return false;
    if (where?.status && typeof where.status === "object" && "not" in where.status) {
      if (row.status === (where.status as { not: string }).not) return false;
    }
    if (where?.dunning_stage && typeof where.dunning_stage === "object" && "gte" in where.dunning_stage) {
      if (row.dunning_stage < Number((where.dunning_stage as { gte: number }).gte)) return false;
    }
    return true;
  });
}

const prismaMock = {
  agencyBillingCharge: {
    findUnique: vi.fn(async ({ where }: { where: { id_charge: number } }) => {
      return charges.find((item) => item.id_charge === where.id_charge) || null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id_charge: number }; data: Record<string, unknown> }) => {
      const row = charges.find((item) => item.id_charge === where.id_charge);
      if (!row) throw new Error("charge not found");
      Object.assign(row, data);
      return clone(row);
    }),
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => findCharges(where)),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
      return findCharges(where).length;
    }),
  },
  agencyBillingAttempt: {
    findUnique: vi.fn(async ({ where }: { where: { id_attempt: number } }) => {
      return attempts.find((item) => item.id_attempt === where.id_attempt) || null;
    }),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return attempts.filter((item) => {
        if (where.charge_id != null && item.charge_id !== Number(where.charge_id)) {
          return false;
        }
        if (where.attempt_no && typeof where.attempt_no === "object" && "gt" in where.attempt_no) {
          if (item.attempt_no <= Number((where.attempt_no as { gt: number }).gt)) return false;
        }
        if (where.status && typeof where.status === "object" && "in" in where.status) {
          const list = (where.status as { in: string[] }).in;
          if (!list.includes(item.status)) return false;
        }
        return true;
      }).length;
    }),
    findFirst: vi.fn(async ({ where, orderBy }: {
      where: Record<string, unknown>;
      orderBy?: Array<Record<string, "asc" | "desc">>;
    }) => {
      let items = attempts.filter((item) => {
        if (where.charge_id != null && item.charge_id !== Number(where.charge_id)) {
          return false;
        }
        return true;
      });
      const byAttemptNo = orderBy?.find((item) => "attempt_no" in item);
      if (byAttemptNo?.attempt_no === "desc") {
        items = [...items].sort((a, b) => b.attempt_no - a.attempt_no);
      } else if (byAttemptNo?.attempt_no === "asc") {
        items = [...items].sort((a, b) => a.attempt_no - b.attempt_no);
      }
      return items[0] || null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of attempts) {
        if (where.charge_id != null && row.charge_id !== Number(where.charge_id)) continue;
        if (where.status && typeof where.status === "object" && "in" in where.status) {
          if (!(where.status as { in: string[] }).in.includes(row.status)) continue;
        }
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    }),
  },
  agencyBillingFallbackIntent: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const list = fallbackIntents.filter((item) => {
        if (where.charge_id != null && item.charge_id !== Number(where.charge_id)) return false;
        if (where.provider != null && item.provider !== where.provider) return false;
        if (where.status && typeof where.status === "object" && "in" in where.status) {
          if (!(where.status as { in: string[] }).in.includes(item.status)) return false;
        }
        return true;
      });
      return list.sort((a, b) => b.id_fallback_intent - a.id_fallback_intent)[0] || null;
    }),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return fallbackIntents.filter((item) => {
        if (where.charge_id != null && item.charge_id !== Number(where.charge_id)) return false;
        if (where.provider != null && item.provider !== where.provider) return false;
        if (where.status && typeof where.status === "object" && "in" in where.status) {
          if (!(where.status as { in: string[] }).in.includes(item.status)) return false;
        }
        return true;
      }).length;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: FallbackIntentRow = {
        id_fallback_intent: nextId(fallbackIntents as unknown as Array<Record<string, unknown>>, "id_fallback_intent"),
        agency_id: Number(data.agency_id),
        charge_id: Number(data.charge_id),
        provider: data.provider as FallbackIntentRow["provider"],
        status: data.status as FallbackIntentRow["status"],
        amount: Number(data.amount ?? 0),
        currency: String(data.currency || "ARS"),
        external_reference: String(data.external_reference),
        provider_payment_id: (data.provider_payment_id as string | null) ?? null,
        provider_status: (data.provider_status as string | null) ?? null,
        provider_status_detail: (data.provider_status_detail as string | null) ?? null,
        payment_url: (data.payment_url as string | null) ?? null,
        qr_payload: (data.qr_payload as string | null) ?? null,
        qr_image_url: (data.qr_image_url as string | null) ?? null,
        expires_at: (data.expires_at as Date | null) ?? null,
        paid_at: (data.paid_at as Date | null) ?? null,
        failure_code: (data.failure_code as string | null) ?? null,
        failure_message: (data.failure_message as string | null) ?? null,
        provider_raw_payload:
          (data.provider_raw_payload as Record<string, unknown> | null) ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      fallbackIntents.push(row);
      return clone(row);
    }),
    findUnique: vi.fn(async ({ where }: { where: { id_fallback_intent: number } }) => {
      return (
        fallbackIntents.find((item) => item.id_fallback_intent === where.id_fallback_intent) ||
        null
      );
    }),
    update: vi.fn(async ({ where, data }: { where: { id_fallback_intent: number }; data: Record<string, unknown> }) => {
      const row = fallbackIntents.find((item) => item.id_fallback_intent === where.id_fallback_intent);
      if (!row) throw new Error("fallback not found");
      Object.assign(row, data, { updated_at: new Date() });
      return clone(row);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of fallbackIntents) {
        if (where.charge_id != null && row.charge_id !== Number(where.charge_id)) continue;
        if (where.status && typeof where.status === "object" && "in" in where.status) {
          if (!(where.status as { in: string[] }).in.includes(row.status)) continue;
        }
        if (where.id_fallback_intent && typeof where.id_fallback_intent === "object" && "not" in where.id_fallback_intent) {
          if (row.id_fallback_intent === Number((where.id_fallback_intent as { not: number }).not)) {
            continue;
          }
        }
        Object.assign(row, data, { updated_at: new Date() });
        count += 1;
      }
      return { count };
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return fallbackIntents.filter((item) => {
        if (where.id_fallback_intent != null && item.id_fallback_intent !== Number(where.id_fallback_intent)) {
          return false;
        }
        if (where.provider != null && item.provider !== where.provider) return false;
        if (where.status && typeof where.status === "object" && "in" in where.status) {
          if (!(where.status as { in: string[] }).in.includes(item.status)) return false;
        }
        return true;
      });
    }),
  },
  agencyBillingCycle: {
    update: vi.fn(async () => ({})),
  },
  $transaction: vi.fn(async (arg: unknown): Promise<unknown> => {
    if (typeof arg === "function") {
      return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
    }
    throw new Error("Unsupported transaction signature");
  }),
};

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
}));

vi.mock("@/services/billing/events", () => ({
  logBillingEvent: logBillingEventMock,
}));

describe("billing dunning + fallback service", () => {
  beforeEach(() => {
    charges = [
      {
        id_charge: 10,
        id_agency: 3,
        cycle_id: null,
        status: "PAST_DUE",
        amount_ars_due: 1000,
        amount_ars_paid: null,
        paid_at: null,
        paid_via_channel: null,
        dunning_stage: 0,
        fallback_offered_at: null,
        fallback_expires_at: null,
        overdue_since: null,
        collections_escalated_at: null,
      },
    ];

    attempts = [
      { id_attempt: 100, charge_id: 10, attempt_no: 1, status: "REJECTED", processed_at: null, notes: null },
      { id_attempt: 101, charge_id: 10, attempt_no: 2, status: "REJECTED", processed_at: null, notes: null },
      { id_attempt: 102, charge_id: 10, attempt_no: 3, status: "REJECTED", processed_at: null, notes: null },
    ];

    fallbackIntents = [];
    loggedEvents = [];
    logBillingEventMock.mockClear();
    process.env.BILLING_DUNNING_ENABLE_FALLBACK = "true";
    process.env.BILLING_FALLBACK_DEFAULT_PROVIDER = "cig_qr";
    process.env.BILLING_FALLBACK_EXPIRES_HOURS = "72";
    process.env.BILLING_FALLBACK_MP_ENABLED = "false";
  });

  it("creates fallback only after final PD rejection", async () => {
    const { onPdAttemptRejected } = await import(
      "@/services/collections/dunning/service"
    );

    const first = await onPdAttemptRejected({
      chargeId: 10,
      attemptId: 100,
      source: "TEST",
    });
    expect(first.fallback_created).toBe(false);
    expect(charges[0]?.dunning_stage).toBe(1);

    const second = await onPdAttemptRejected({
      chargeId: 10,
      attemptId: 101,
      source: "TEST",
    });
    expect(second.fallback_created).toBe(false);
    expect(charges[0]?.dunning_stage).toBe(2);

    const third = await onPdAttemptRejected({
      chargeId: 10,
      attemptId: 102,
      source: "TEST",
    });
    expect(third.fallback_created).toBe(true);
    expect(charges[0]?.dunning_stage).toBe(3);
    expect(fallbackIntents).toHaveLength(1);
    expect(fallbackIntents[0]?.status).toBe("PENDING");
  });

  it("createFallbackIntentForCharge is idempotent per open intent", async () => {
    const { createFallbackIntentForCharge } = await import(
      "@/services/collections/dunning/service"
    );

    charges[0].dunning_stage = 3;
    const first = await createFallbackIntentForCharge({
      chargeId: 10,
      source: "TEST",
    });
    const second = await createFallbackIntentForCharge({
      chargeId: 10,
      source: "TEST",
    });

    expect(first.created).toBe(true);
    expect(second.no_op).toBe(true);
    expect(second.reason).toBe("fallback_already_open");
    expect(fallbackIntents).toHaveLength(1);
  });

  it("fallback payment closes charge, marks paid_via_channel and cancels pending PD attempts", async () => {
    const { onFallbackPaid } = await import(
      "@/services/collections/dunning/service"
    );

    attempts.push({
      id_attempt: 103,
      charge_id: 10,
      attempt_no: 4,
      status: "PENDING",
      processed_at: null,
      notes: null,
    });

    fallbackIntents.push({
      id_fallback_intent: 1,
      agency_id: 3,
      charge_id: 10,
      provider: "CIG_QR",
      status: "PENDING",
      amount: 1000,
      currency: "ARS",
      external_reference: "FBK-10-CIG_QR-001",
      provider_payment_id: "cig_1",
      provider_status: "PENDING",
      provider_status_detail: null,
      payment_url: "https://stub/cig/1",
      qr_payload: "qr",
      qr_image_url: null,
      expires_at: new Date(Date.now() + 30 * 60 * 1000),
      paid_at: null,
      failure_code: null,
      failure_message: null,
      provider_raw_payload: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const first = await onFallbackPaid({
      fallbackIntentId: 1,
      source: "TEST",
    });
    expect(first.closed_charge).toBe(true);
    expect(charges[0]?.status).toBe("PAID");
    expect(charges[0]?.paid_via_channel).toBe("CIG_QR");
    expect(attempts.find((a) => a.id_attempt === 103)?.status).toBe("CANCELED");

    const second = await onFallbackPaid({
      fallbackIntentId: 1,
      source: "TEST",
    });
    expect(second.already_paid).toBe(true);

    const paidEvents = loggedEvents.filter(
      (event) => event.event_type === "BILLING_CHARGE_PAID",
    );
    expect(paidEvents).toHaveLength(1);
  });

  it("late PD paid keeps first win when charge is already paid via fallback", async () => {
    const { onPdAttemptPaid } = await import(
      "@/services/collections/dunning/service"
    );

    charges[0].status = "PAID";
    charges[0].paid_via_channel = "CIG_QR";
    charges[0].paid_at = new Date("2026-03-08T12:00:00.000Z");
    charges[0].amount_ars_paid = 1000;

    const result = await onPdAttemptPaid({
      chargeId: 10,
      amount: 1000,
      paidAt: new Date("2026-03-09T12:00:00.000Z"),
      source: "TEST_LATE_PD",
    });

    expect(result.already_paid).toBe(true);
    expect(result.paid_via_channel).toBe("CIG_QR");
    expect(charges[0]?.paid_via_channel).toBe("CIG_QR");
  });

  it("fallback expiration escalates charge to stage 4", async () => {
    const { onFallbackExpired } = await import(
      "@/services/collections/dunning/service"
    );

    charges[0].dunning_stage = 3;
    fallbackIntents.push({
      id_fallback_intent: 2,
      agency_id: 3,
      charge_id: 10,
      provider: "CIG_QR",
      status: "PENDING",
      amount: 1000,
      currency: "ARS",
      external_reference: "FBK-10-CIG_QR-002",
      provider_payment_id: "cig_2",
      provider_status: "PENDING",
      provider_status_detail: null,
      payment_url: null,
      qr_payload: null,
      qr_image_url: null,
      expires_at: new Date(Date.now() - 60_000),
      paid_at: null,
      failure_code: null,
      failure_message: null,
      provider_raw_payload: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const result = await onFallbackExpired({
      fallbackIntentId: 2,
      source: "TEST",
    });

    expect(result.escalated).toBe(true);
    expect(charges[0]?.dunning_stage).toBe(4);
    expect(charges[0]?.collections_escalated_at).toBeTruthy();
    expect(fallbackIntents.find((it) => it.id_fallback_intent === 2)?.status).toBe("EXPIRED");
  });
});
