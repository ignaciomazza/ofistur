import { createHash, randomUUID } from "node:crypto";
import { Prisma, type InvoiceIssuanceAttempt } from "@prisma/client";
import prisma from "@/lib/prisma";

export const INVOICE_ATTEMPT_STATUS = {
  PENDING: "PENDING",
  PREPARING: "PREPARING",
  PROCESSING: "PROCESSING",
  AUTHORIZED: "AUTHORIZED",
  PERSISTED: "PERSISTED",
  FAILED: "FAILED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
} as const;

export interface EnsureInvoiceAttemptInput {
  agencyId: number;
  requestKey: string;
  itemKey: string;
  requestHash: string;
  activeKey: string;
  bookingId: number;
  clientId: number;
  currency: string;
  voucherType: number;
}

const uniqueWhere = (input: {
  agencyId: number;
  requestKey: string;
  itemKey: string;
}) => ({
  agency_invoice_issuance_item_unique: {
    id_agency: input.agencyId,
    request_key: input.requestKey,
    item_key: input.itemKey,
  },
});

export function normalizeInvoiceRequestKey(value?: string): string {
  const clean = String(value ?? "").trim();
  return clean || randomUUID();
}

export function buildInvoiceAttemptHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function isInvoiceAttemptFresh(
  attempt: Pick<InvoiceIssuanceAttempt, "updated_at">,
  now = new Date(),
  thresholdMs = 30_000,
): boolean {
  return now.getTime() - attempt.updated_at.getTime() < thresholdMs;
}

export async function ensureInvoiceAttempt(
  input: EnsureInvoiceAttemptInput,
): Promise<{ attempt: InvoiceIssuanceAttempt; hashMatches: boolean }> {
  let attempt = await prisma.invoiceIssuanceAttempt.findUnique({
    where: uniqueWhere(input),
  });
  if (!attempt) {
    attempt = await prisma.invoiceIssuanceAttempt.findUnique({
      where: {
        agency_invoice_issuance_active_unique: {
          id_agency: input.agencyId,
          active_key: input.activeKey,
        },
      },
    });
  }
  if (!attempt) {
    try {
      attempt = await prisma.invoiceIssuanceAttempt.create({
        data: {
          id_agency: input.agencyId,
          request_key: input.requestKey,
          item_key: input.itemKey,
          request_hash: input.requestHash,
          active_key: input.activeKey,
          booking_id: input.bookingId,
          client_id: input.clientId,
          currency: input.currency,
          cbte_tipo: input.voucherType,
          status: INVOICE_ATTEMPT_STATUS.PENDING,
        },
      });
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        (error as { code?: string }).code !== "P2002"
      ) {
        throw error;
      }
      attempt = await prisma.invoiceIssuanceAttempt.findUnique({
        where: {
          agency_invoice_issuance_active_unique: {
            id_agency: input.agencyId,
            active_key: input.activeKey,
          },
        },
      });
      if (!attempt) throw error;
    }
  }

  if (
    attempt.status === INVOICE_ATTEMPT_STATUS.FAILED &&
    attempt.request_hash !== input.requestHash
  ) {
    attempt = await prisma.invoiceIssuanceAttempt.update({
      where: {
        id_invoice_issuance_attempt: attempt.id_invoice_issuance_attempt,
      },
      data: {
        request_hash: input.requestHash,
        status: INVOICE_ATTEMPT_STATUS.PENDING,
        prepared_payload: Prisma.DbNull,
        authorized_payload: Prisma.DbNull,
        qr_base64: null,
        error_message: null,
      },
    });
  }

  return { attempt, hashMatches: attempt.request_hash === input.requestHash };
}

export async function reloadInvoiceAttempt(
  id: number,
): Promise<InvoiceIssuanceAttempt> {
  return prisma.invoiceIssuanceAttempt.findUniqueOrThrow({
    where: { id_invoice_issuance_attempt: id },
  });
}

export async function claimInvoiceAttempt(id: number): Promise<boolean> {
  const result = await prisma.invoiceIssuanceAttempt.updateMany({
    where: {
      id_invoice_issuance_attempt: id,
      status: {
        in: [INVOICE_ATTEMPT_STATUS.PENDING, INVOICE_ATTEMPT_STATUS.FAILED],
      },
    },
    data: {
      status: INVOICE_ATTEMPT_STATUS.PREPARING,
      error_message: null,
    },
  });
  return result.count === 1;
}

export async function resetInvoiceAttempt(id: number): Promise<void> {
  await prisma.invoiceIssuanceAttempt.update({
    where: { id_invoice_issuance_attempt: id },
    data: {
      status: INVOICE_ATTEMPT_STATUS.PENDING,
      prepared_payload: Prisma.DbNull,
      authorized_payload: Prisma.DbNull,
      qr_base64: null,
      error_message: null,
    },
  });
}

export async function markInvoiceAttemptPrepared(
  id: number,
  payload: Prisma.JsonObject,
): Promise<void> {
  await prisma.invoiceIssuanceAttempt.update({
    where: { id_invoice_issuance_attempt: id },
    data: {
      status: INVOICE_ATTEMPT_STATUS.PROCESSING,
      prepared_payload: payload,
      error_message: null,
    },
  });
}

export async function markInvoiceAttemptAuthorized(
  id: number,
  payload: Prisma.JsonObject,
  qrBase64?: string,
): Promise<void> {
  await prisma.invoiceIssuanceAttempt.update({
    where: { id_invoice_issuance_attempt: id },
    data: {
      status: INVOICE_ATTEMPT_STATUS.AUTHORIZED,
      authorized_payload: payload,
      ...(qrBase64 !== undefined ? { qr_base64: qrBase64 } : {}),
      error_message: null,
    },
  });
}

export async function markInvoiceAttemptFailed(
  id: number,
  message: string,
): Promise<void> {
  await prisma.invoiceIssuanceAttempt.update({
    where: { id_invoice_issuance_attempt: id },
    data: {
      status: INVOICE_ATTEMPT_STATUS.FAILED,
      error_message: message,
    },
  });
}

export async function markInvoiceAttemptForReview(
  id: number,
  message: string,
): Promise<void> {
  await prisma.invoiceIssuanceAttempt.update({
    where: { id_invoice_issuance_attempt: id },
    data: {
      status: INVOICE_ATTEMPT_STATUS.REVIEW_REQUIRED,
      error_message: message,
    },
  });
}
