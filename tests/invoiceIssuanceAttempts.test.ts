import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attempts: [] as Array<Record<string, unknown>>,
  findUnique: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    invoiceIssuanceAttempt: {
      findUnique: mocks.findUnique,
      create: mocks.create,
    },
  },
}));

import {
  buildInvoiceAttemptHash,
  ensureInvoiceAttempt,
  isInvoiceAttemptFresh,
  normalizeInvoiceRequestKey,
} from "@/services/invoiceIssuanceAttempts";

describe("invoice issuance attempt helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attempts.length = 0;
    mocks.findUnique.mockImplementation(
      ({ where }: { where: Record<string, Record<string, unknown>> }) => {
        const byRequest = where.agency_invoice_issuance_item_unique;
        if (byRequest) {
          return (
            mocks.attempts.find(
              (attempt) =>
                attempt.id_agency === byRequest.id_agency &&
                attempt.request_key === byRequest.request_key &&
                attempt.item_key === byRequest.item_key,
            ) ?? null
          );
        }
        const byActive = where.agency_invoice_issuance_active_unique;
        return (
          mocks.attempts.find(
            (attempt) =>
              attempt.id_agency === byActive.id_agency &&
              attempt.active_key === byActive.active_key,
          ) ?? null
        );
      },
    );
    mocks.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        const attempt = {
          id_invoice_issuance_attempt: mocks.attempts.length + 1,
          prepared_payload: null,
          authorized_payload: null,
          qr_base64: null,
          invoice_id: null,
          error_message: null,
          created_at: new Date(),
          updated_at: new Date(),
          ...data,
        };
        mocks.attempts.push(attempt);
        return attempt;
      },
    );
  });

  it("keeps the same payload fingerprint deterministic", () => {
    const input = {
      bookingId: 12,
      clientId: 34,
      currency: "DOL",
      total: 315.06,
    };
    expect(buildInvoiceAttemptHash(input)).toBe(buildInvoiceAttemptHash(input));
    expect(buildInvoiceAttemptHash(input)).not.toBe(
      buildInvoiceAttemptHash({ ...input, total: 315.07 }),
    );
  });

  it("preserves a supplied request key and generates one when missing", () => {
    expect(normalizeInvoiceRequestKey(" request-1 ")).toBe("request-1");
    expect(normalizeInvoiceRequestKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("only treats a recently updated attempt as still active", () => {
    const now = new Date("2026-08-18T15:00:30.000Z");
    expect(
      isInvoiceAttemptFresh(
        { updated_at: new Date("2026-08-18T15:00:05.000Z") },
        now,
      ),
    ).toBe(true);
    expect(
      isInvoiceAttemptFresh(
        { updated_at: new Date("2026-08-18T14:59:00.000Z") },
        now,
      ),
    ).toBe(false);
  });

  it("reuses the active fiscal attempt even when a second tab sends another request key", async () => {
    const base = {
      agencyId: 52,
      itemKey: "0:4936:DOL",
      requestHash: "request-hash",
      activeKey: "fiscal-hash",
      bookingId: 2230,
      clientId: 4936,
      currency: "DOL",
      voucherType: 6,
    };

    const first = await ensureInvoiceAttempt({
      ...base,
      requestKey: "request-from-tab-one",
    });
    const second = await ensureInvoiceAttempt({
      ...base,
      requestKey: "request-from-tab-two",
    });

    expect(first.hashMatches).toBe(true);
    expect(second.hashMatches).toBe(true);
    expect(second.attempt.id_invoice_issuance_attempt).toBe(
      first.attempt.id_invoice_issuance_attempt,
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
