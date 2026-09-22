import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest } from "next";

const mocks = vi.hoisted(() => {
  const tx = {
    invoice: { create: vi.fn(), findUnique: vi.fn() },
    invoiceItem: { create: vi.fn() },
    invoiceIssuanceAttempt: { update: vi.fn() },
  };
  return {
    tx,
    bookingFindUnique: vi.fn(),
    serviceFindMany: vi.fn(),
    clientFindUnique: vi.fn(),
    clientUpdate: vi.fn(),
    invoiceFindUnique: vi.fn(),
    invoiceFindFirst: vi.fn(),
    attemptUpdate: vi.fn(),
    transaction: vi.fn(),
    getNextAgencyCounter: vi.fn(),
    createVoucherService: vi.fn(),
    recoverPreparedVoucherService: vi.fn(),
    ensureInvoiceAttempt: vi.fn(),
    claimInvoiceAttempt: vi.fn(),
    reloadInvoiceAttempt: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    booking: { findUnique: mocks.bookingFindUnique },
    service: { findMany: mocks.serviceFindMany },
    client: {
      findUnique: mocks.clientFindUnique,
      update: mocks.clientUpdate,
    },
    invoice: {
      findUnique: mocks.invoiceFindUnique,
      findFirst: mocks.invoiceFindFirst,
    },
    invoiceIssuanceAttempt: { update: mocks.attemptUpdate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/agencyCounters", () => ({
  getNextAgencyCounter: mocks.getNextAgencyCounter,
}));

vi.mock("@/services/afip/createVoucherService", () => ({
  createVoucherService: mocks.createVoucherService,
  recoverPreparedVoucherService: mocks.recoverPreparedVoucherService,
}));

vi.mock("@/services/invoiceIssuanceAttempts", () => ({
  INVOICE_ATTEMPT_STATUS: {
    PENDING: "PENDING",
    PREPARING: "PREPARING",
    PROCESSING: "PROCESSING",
    AUTHORIZED: "AUTHORIZED",
    PERSISTED: "PERSISTED",
    FAILED: "FAILED",
    REVIEW_REQUIRED: "REVIEW_REQUIRED",
  },
  buildInvoiceAttemptHash: vi.fn(() => "hash"),
  claimInvoiceAttempt: mocks.claimInvoiceAttempt,
  ensureInvoiceAttempt: mocks.ensureInvoiceAttempt,
  isInvoiceAttemptFresh: vi.fn(() => false),
  markInvoiceAttemptAuthorized: vi.fn(),
  markInvoiceAttemptFailed: vi.fn(),
  markInvoiceAttemptForReview: vi.fn(),
  markInvoiceAttemptPrepared: vi.fn(),
  normalizeInvoiceRequestKey: vi.fn(
    (value?: string) => value || "generated-key",
  ),
  reloadInvoiceAttempt: mocks.reloadInvoiceAttempt,
  resetInvoiceAttempt: vi.fn(),
}));

import { createInvoices } from "@/services/invoices";
import { markInvoiceAttemptFailed } from "@/services/invoiceIssuanceAttempts";

const request = {} as NextApiRequest;
const service = {
  id_service: 77,
  sale_price: 1000,
  taxableBase21: 0,
  commission21: 0,
  tax_21: 0,
  vatOnCommission21: 0,
  taxableBase10_5: 0,
  commission10_5: 0,
  tax_105: 0,
  vatOnCommission10_5: 0,
  taxableCardInterest: 0,
  vatOnCardInterest: 0,
  currency: "USD",
  description: "Servicio",
  nonComputable: 0,
  exempt: 1000,
  departure_date: new Date("2026-09-01T12:00:00Z"),
  return_date: new Date("2026-09-10T12:00:00Z"),
};
const client = {
  id_client: 4936,
  first_name: "Pax",
  last_name: "Prueba",
  company_name: null,
  dni_number: "29152071",
  tax_id: null,
};
const invoice = {
  id_invoice: 900,
  agency_invoice_id: 20,
  id_agency: 52,
  invoice_number: "00001-00000108",
  pto_vta: 1,
  cbte_tipo: 6,
  issue_date: new Date(),
  total_amount: 1000,
  currency: "DOL",
  status: "Autorizada",
  type: "Factura B",
  recipient: "Pax Prueba",
  facturaHtml: null,
  payloadAfip: {},
  bookingId_booking: 2230,
  client_id: 4936,
  InvoiceItem: [],
};

const attemptBase = {
  id_invoice_issuance_attempt: 10,
  id_agency: 52,
  request_key: "invoice-request-1234",
  item_key: "0:4936:DOL",
  request_hash: "hash",
  active_key: "hash",
  booking_id: 2230,
  client_id: 4936,
  currency: "DOL",
  cbte_tipo: 6,
  prepared_payload: null,
  authorized_payload: null,
  qr_base64: null,
  error_message: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe("invoice issuance retry recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bookingFindUnique.mockResolvedValue({
      id_booking: 2230,
      id_agency: 52,
    });
    mocks.serviceFindMany.mockResolvedValue([service]);
    mocks.clientFindUnique.mockResolvedValue(client);
    mocks.invoiceFindFirst.mockResolvedValue(null);
    mocks.getNextAgencyCounter.mockResolvedValue(21);
    mocks.transaction.mockImplementation(async (callback) =>
      callback(mocks.tx),
    );
  });

  it("returns the invoice already linked to the same attempt without calling ARCA", async () => {
    mocks.ensureInvoiceAttempt.mockResolvedValue({
      attempt: {
        ...attemptBase,
        status: "PERSISTED",
        invoice_id: invoice.id_invoice,
        active_key: null,
      },
      hashMatches: true,
    });
    mocks.invoiceFindUnique.mockResolvedValue(invoice);

    const result = await createInvoices(request, {
      idempotencyKey: "invoice-request-1234",
      bookingId: 2230,
      services: [77],
      clientIds: [4936],
      tipoFactura: 6,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        complete: true,
        plannedCount: 1,
        completedCount: 1,
      }),
    );
    expect(mocks.createVoucherService).not.toHaveBeenCalled();
  });

  it("persists a checkpointed ARCA authorization without issuing another voucher", async () => {
    mocks.ensureInvoiceAttempt.mockResolvedValue({
      attempt: {
        ...attemptBase,
        status: "AUTHORIZED",
        invoice_id: null,
        authorized_payload: {
          PtoVta: 1,
          CbteTipo: 6,
          CbteDesde: 108,
          ImpTotal: 1000,
          CAE: "12345678901234",
          CAEFchVto: "20260920",
        },
        qr_base64: "data:image/png;base64,qr",
      },
      hashMatches: true,
    });
    mocks.tx.invoice.create.mockResolvedValue(invoice);
    mocks.tx.invoice.findUnique.mockResolvedValue(invoice);
    mocks.tx.invoiceItem.create.mockResolvedValue({ id: 1 });
    mocks.tx.invoiceIssuanceAttempt.update.mockResolvedValue({});

    const result = await createInvoices(request, {
      idempotencyKey: "invoice-request-1234",
      bookingId: 2230,
      services: [77],
      clientIds: [4936],
      tipoFactura: 6,
    });

    expect(result.success).toBe(true);
    expect(mocks.createVoucherService).not.toHaveBeenCalled();
    expect(mocks.tx.invoice.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.invoiceIssuanceAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PERSISTED",
          active_key: null,
          invoice_id: invoice.id_invoice,
        }),
      }),
    );
  });

  it("preserves ARCA's rejection after confirming the voucher was not authorized", async () => {
    const rejection =
      "(10018) Si ImpIva es igual a 0 el objeto Iva y AlicIva no deben informarse.";
    mocks.ensureInvoiceAttempt.mockResolvedValue({
      attempt: { ...attemptBase, status: "PENDING" },
      hashMatches: true,
    });
    mocks.claimInvoiceAttempt.mockResolvedValue(true);
    mocks.createVoucherService.mockResolvedValue({
      success: false,
      message: rejection,
    });
    mocks.reloadInvoiceAttempt.mockResolvedValue({
      ...attemptBase,
      status: "PROCESSING",
      prepared_payload: { PtoVta: 4, CbteTipo: 6, CbteDesde: 2 },
    });
    mocks.recoverPreparedVoucherService.mockResolvedValue({
      status: "NOT_FOUND",
    });

    const result = await createInvoices(request, {
      idempotencyKey: "invoice-request-1234",
      bookingId: 2230,
      services: [77],
      clientIds: [4936],
      tipoFactura: 6,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe(rejection);
    expect(markInvoiceAttemptFailed).toHaveBeenCalledWith(
      attemptBase.id_invoice_issuance_attempt,
      rejection,
    );
  });
});
