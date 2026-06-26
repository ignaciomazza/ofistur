import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const afipClient = {
    ElectronicBilling: {
      getSalesPoints: vi.fn(),
      getLastVoucher: vi.fn(),
      createVoucher: vi.fn(),
    },
  };

  return {
    afipClient,
    getAfipForAgency: vi.fn(),
    logBillingEvent: vi.fn(),
    prisma: {
      agencyBillingCharge: {
        findUnique: vi.fn(),
      },
      agencyBillingFiscalDocument: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

vi.mock("@/services/afip/afipConfig", () => ({
  getAfipForAgency: mocks.getAfipForAgency,
}));

vi.mock("@/services/billing/events", () => ({
  logBillingEvent: mocks.logBillingEvent,
}));

import { issueFiscalForCharge } from "@/services/collections/fiscal/issueOnPaid";

describe("issueFiscalForCharge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BILLING_FISCAL_ISSUER_MODE;
    delete process.env.BILLING_AFIP_PTO_VTA;
    delete process.env.BILLING_AFIP_CBTE_TIPO;
    process.env.BILLING_DEFAULT_VAT_RATE = "0.21";
    process.env.AFIP_ENV = "production";

    mocks.prisma.agencyBillingCharge.findUnique.mockResolvedValue({
      id_charge: 10,
      id_agency: 99,
      status: "PAID",
      amount_ars_due: 1000,
      amount_ars_paid: null,
      paid_at: new Date("2026-05-06T12:00:00Z"),
      agency: { tax_id: "30-71794593-6" },
    });
    mocks.prisma.agencyBillingFiscalDocument.findUnique.mockResolvedValue(null);
    mocks.prisma.agencyBillingFiscalDocument.upsert.mockResolvedValue({
      id_fiscal_document: 50,
    });
    mocks.prisma.agencyBillingFiscalDocument.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id_fiscal_document: 50,
        external_reference: data.external_reference ?? null,
      }),
    );

    mocks.getAfipForAgency.mockResolvedValue(mocks.afipClient);
    mocks.afipClient.ElectronicBilling.getSalesPoints.mockResolvedValue([
      { Nro: 4 },
      { Nro: 3 },
    ]);
    mocks.afipClient.ElectronicBilling.getLastVoucher.mockResolvedValue(2088);
    mocks.afipClient.ElectronicBilling.createVoucher.mockResolvedValue({
      CAE: "12345678901234",
      CAEFchVto: "20260516",
    });
    mocks.logBillingEvent.mockResolvedValue(undefined);
  });

  it("uses the first WSFE-enabled sales point when no billing point is configured", async () => {
    const result = await issueFiscalForCharge({
      chargeId: 10,
      issuerAgencyId: 1,
      amountArsOverride: 1000,
    });

    expect(result.ok).toBe(true);
    expect(mocks.getAfipForAgency).toHaveBeenCalledWith(1);
    expect(mocks.afipClient.ElectronicBilling.getLastVoucher).toHaveBeenCalledWith(
      3,
      6,
    );
    expect(mocks.afipClient.ElectronicBilling.createVoucher).toHaveBeenCalledWith(
      expect.objectContaining({
        PtoVta: 3,
        CbteTipo: 6,
        CbteDesde: 2089,
        CbteHasta: 2089,
        ImpTotal: 1000,
      }),
    );
    const payload = mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotConc).toBe(0);
    expect(payload.DocTipo).toBe(80);
    expect(payload.DocNro).toBe(30717945936);
    expect(payload.ImpNeto).toBeCloseTo(826.45, 2);
    expect(payload.ImpIVA).toBeCloseTo(173.55, 2);
    expect(payload.Iva).toEqual([
      {
        Id: 5,
        BaseImp: 826.45,
        Importe: 173.55,
      },
    ]);
    expect(mocks.prisma.agencyBillingFiscalDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ISSUED",
          afip_pto_vta: 3,
          afip_cbte_tipo: 6,
          afip_number: "2089",
        }),
      }),
    );
  });

  it("uses BILLING_AFIP_PTO_VTA only when that point is enabled for WSFE", async () => {
    process.env.BILLING_AFIP_PTO_VTA = "4";

    const result = await issueFiscalForCharge({
      chargeId: 10,
      issuerAgencyId: 1,
      amountArsOverride: 1000,
    });

    expect(result.ok).toBe(true);
    expect(mocks.afipClient.ElectronicBilling.getLastVoucher).toHaveBeenCalledWith(
      4,
      6,
    );
  });

  it("falls back to consumidor final when the charged agency has no valid CUIT", async () => {
    mocks.prisma.agencyBillingCharge.findUnique.mockResolvedValueOnce({
      id_charge: 10,
      id_agency: 99,
      status: "PAID",
      amount_ars_due: 1000,
      amount_ars_paid: null,
      paid_at: new Date("2026-05-06T12:00:00Z"),
      agency: { tax_id: "" },
    });

    const result = await issueFiscalForCharge({
      chargeId: 10,
      issuerAgencyId: 1,
      amountArsOverride: 1000,
    });

    expect(result.ok).toBe(true);
    const payload = mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.DocTipo).toBe(99);
    expect(payload.DocNro).toBe(0);
  });

  it("fails before numbering when the configured billing point is not enabled", async () => {
    process.env.BILLING_AFIP_PTO_VTA = "1";

    const result = await issueFiscalForCharge({
      chargeId: 10,
      issuerAgencyId: 1,
      amountArsOverride: 1000,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.message).toContain("punto de venta seleccionado");
    expect(mocks.afipClient.ElectronicBilling.getLastVoucher).not.toHaveBeenCalled();
    expect(mocks.prisma.agencyBillingFiscalDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          error_message: expect.stringContaining("punto de venta seleccionado"),
        }),
      }),
    );
  });

  it("sends non-taxed amounts for comprobantes without IVA breakdown", async () => {
    process.env.BILLING_AFIP_CBTE_TIPO = "11"; // Factura C

    const result = await issueFiscalForCharge({
      chargeId: 10,
      issuerAgencyId: 1,
      amountArsOverride: 1000,
    });

    expect(result.ok).toBe(true);
    const payload = mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.CbteTipo).toBe(11);
    expect(payload.ImpTotal).toBe(1000);
    expect(payload.ImpTotConc).toBe(1000);
    expect(payload.ImpNeto).toBe(0);
    expect(payload.ImpIVA).toBe(0);
    expect(payload.Iva).toEqual([]);
  });
});
