import { describe, expect, it } from "vitest";
import {
  normalizeGroupReceiptStoredPayments,
  resolveGroupReceiptVerificationState,
  withGroupReceiptVerificationInMetadata,
} from "@/lib/groups/groupReceiptMetadata";

describe("group receipt metadata helpers", () => {
  it("resolves verification from columns when available", () => {
    const now = new Date("2026-04-15T12:00:00.000Z");
    const state = resolveGroupReceiptVerificationState({
      hasVerificationColumns: true,
      columnStatus: "VERIFIED",
      columnVerifiedAt: now,
      columnVerifiedBy: 99,
      metadata: {
        verification: { status: "PENDING" },
      },
    });

    expect(state.source).toBe("columns");
    expect(state.status).toBe("VERIFIED");
    expect(state.verifiedBy).toBe(99);
    expect(state.verifiedAt?.toISOString()).toBe(now.toISOString());
  });

  it("falls back to metadata verification when columns are missing", () => {
    const state = resolveGroupReceiptVerificationState({
      hasVerificationColumns: false,
      metadata: {
        verification: {
          status: "VERIFIED",
          verified_at: "2026-04-14T15:30:00.000Z",
          verified_by: 7,
        },
      },
    });

    expect(state.source).toBe("metadata");
    expect(state.status).toBe("VERIFIED");
    expect(state.verifiedBy).toBe(7);
    expect(state.verifiedAt?.toISOString()).toBe("2026-04-14T15:30:00.000Z");
  });

  it("writes verification status to metadata", () => {
    const metadata = withGroupReceiptVerificationInMetadata({
      metadata: { foo: "bar" },
      status: "PENDING",
    });

    expect(metadata.foo).toBe("bar");
    expect(metadata.verification).toEqual({
      status: "PENDING",
      verified_at: null,
      verified_by: null,
    });
  });

  it("normalizes receipt payments and keeps currency/fees", () => {
    const payments = normalizeGroupReceiptStoredPayments([
      {
        amount: "100.50",
        payment_currency: "usd",
        fee_amount: "5",
        payment_method_id: "10",
        account_id: "20",
      },
      {
        amount: 0,
        fee_amount: 0,
      },
    ]);

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      amount: 100.5,
      payment_currency: "USD",
      fee_amount: 5,
      payment_method_id: 10,
      account_id: 20,
    });
  });
});
