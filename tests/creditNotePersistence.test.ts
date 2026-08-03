import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest } from "next";

const mocks = vi.hoisted(() => {
  const transactionClient = {
    creditNote: { create: vi.fn() },
    creditNoteItem: { create: vi.fn() },
  };

  return {
    transactionClient,
    invoiceFindUnique: vi.fn(),
    transaction: vi.fn(),
    getNextAgencyCounter: vi.fn(),
    createCreditNoteVoucher: vi.fn(),
    logArca: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    invoice: { findUnique: mocks.invoiceFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/agencyCounters", () => ({
  getNextAgencyCounter: mocks.getNextAgencyCounter,
}));

vi.mock("@/services/afip/creditNoteService", () => ({
  createCreditNoteVoucher: mocks.createCreditNoteVoucher,
}));

vi.mock("@/services/arca/logger", () => ({
  logArca: mocks.logArca,
}));

import { createCreditNote } from "@/services/creditNotes";

const request = {} as NextApiRequest;

describe("credit note local persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.invoiceFindUnique.mockResolvedValue({
      id_invoice: 55,
      id_agency: 136,
      currency: "PES",
      payloadAfip: {
        voucherData: {
          PtoVta: 4,
          CbteTipo: 6,
          CbteDesde: 78,
          DocTipo: 96,
          DocNro: 30111222,
          Iva: [],
          ImpTotConc: 0,
          ImpOpEx: 0,
          MonId: "PES",
        },
      },
      client: {
        company_name: "Agencia de prueba",
        first_name: "",
        last_name: "",
      },
      InvoiceItem: [],
    });
    mocks.getNextAgencyCounter.mockResolvedValue(9);
    mocks.createCreditNoteVoucher.mockResolvedValue({
      success: true,
      details: {
        PtoVta: 7,
        CbteTipo: 8,
        CbteDesde: 3,
        ImpTotal: 1500,
        CAE: "12345678901234",
      },
      qrBase64: "data:image/png;base64,qr",
    });
    mocks.transactionClient.creditNote.create.mockResolvedValue({
      id_credit_note: 100,
      agency_credit_note_id: 9,
      id_agency: 136,
      credit_number: "3",
      pto_vta: 7,
      cbte_tipo: 8,
    });
    mocks.transaction.mockImplementation(async (callback) =>
      callback(mocks.transactionClient),
    );
  });

  it("stores the full ARCA voucher identity instead of a global number", async () => {
    const result = await createCreditNote(request, {
      invoiceId: 55,
      tipoNota: 8,
    });

    expect(result.success).toBe(true);
    expect(mocks.transactionClient.creditNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id_agency: 136,
          pto_vta: 7,
          cbte_tipo: 8,
          credit_number: "3",
        }),
      }),
    );
    expect(mocks.logArca).toHaveBeenCalledWith(
      "info",
      "Credit note authorized",
      expect.objectContaining({
        agencyId: 136,
        salesPoint: 7,
        voucherType: 8,
        voucherNumber: "3",
      }),
    );
    expect(mocks.logArca).toHaveBeenCalledWith(
      "info",
      "Credit note persisted",
      expect.objectContaining({ creditNoteId: 100 }),
    );
  });

  it("logs the authorized voucher identity if the local save fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      createCreditNote(request, { invoiceId: 55, tipoNota: 8 }),
    ).rejects.toThrow("database unavailable");

    expect(mocks.logArca).toHaveBeenCalledWith(
      "error",
      "Credit note local persistence failed",
      expect.objectContaining({
        agencyId: 136,
        salesPoint: 7,
        voucherType: 8,
        voucherNumber: "3",
        message: "database unavailable",
      }),
    );
  });
});
