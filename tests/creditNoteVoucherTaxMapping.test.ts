import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest } from "next";

const mocks = vi.hoisted(() => {
  const afipClient = {
    ElectronicBilling: {
      getServerStatus: vi.fn(),
      getLastVoucher: vi.fn(),
      getVoucherInfo: vi.fn(),
      createVoucher: vi.fn(),
      executeRequest: vi.fn(),
    },
  };

  return {
    afipClient,
    getAfipFromRequest: vi.fn(),
    getAgencyCUITFromRequest: vi.fn(),
    getAgencyIdFromRequest: vi.fn(),
    resolveSalesPoint: vi.fn(),
    agencyArcaConfigFindUnique: vi.fn(),
    qrToDataUrl: vi.fn(),
  };
});

vi.mock("@/services/afip/afipConfig", () => ({
  getAfipFromRequest: mocks.getAfipFromRequest,
  getAgencyCUITFromRequest: mocks.getAgencyCUITFromRequest,
  getAgencyIdFromRequest: mocks.getAgencyIdFromRequest,
}));

vi.mock("@/services/afip/salesPoints", () => ({
  resolveSalesPoint: mocks.resolveSalesPoint,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    agencyArcaConfig: {
      findUnique: mocks.agencyArcaConfigFindUnique,
    },
  },
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: mocks.qrToDataUrl,
  },
}));

import { createCreditNoteVoucher } from "@/services/afip/creditNoteService";

const reqStub = {} as unknown as NextApiRequest;

function detail(overrides: Record<string, unknown> = {}) {
  return {
    sale_price: 0,
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
    nonComputable: 0,
    exempt: 0,
    ...overrides,
  };
}

describe("createCreditNoteVoucher tax mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getAfipFromRequest.mockResolvedValue(mocks.afipClient);
    mocks.getAgencyCUITFromRequest.mockResolvedValue(20401234567);
    mocks.getAgencyIdFromRequest.mockResolvedValue(10);
    mocks.resolveSalesPoint.mockResolvedValue(3);
    mocks.agencyArcaConfigFindUnique.mockResolvedValue({ selectedSalesPoint: null });
    mocks.qrToDataUrl.mockResolvedValue("data:image/png;base64,qr");

    mocks.afipClient.ElectronicBilling.getServerStatus.mockResolvedValue({
      AppServer: "OK",
      DbServer: "OK",
      AuthServer: "OK",
    });
    mocks.afipClient.ElectronicBilling.getLastVoucher.mockResolvedValue(44);
    mocks.afipClient.ElectronicBilling.getVoucherInfo.mockResolvedValue({
      CbteFch: "20260501",
    });
    mocks.afipClient.ElectronicBilling.createVoucher.mockResolvedValue({
      CAE: "12345678901234",
      CAEFchVto: "20260531",
    });
  });

  it("keeps regular taxed breakdown in IVA and neto gravado", async () => {
    const response = await createCreditNoteVoucher(
      reqStub,
      8,
      "12345678",
      96,
      [detail({ sale_price: 1210, taxableBase21: 1000, tax_21: 210 })],
      "PES",
      undefined,
      "2026-05-10",
      [{ Tipo: 6, PtoVta: 3, Nro: 100 }],
    );

    expect(response.success).toBe(true);
    const payload = mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotal).toBe(1210);
    expect(payload.ImpNeto).toBe(1000);
    expect(payload.ImpIVA).toBe(210);
    expect(payload.ImpTotConc).toBe(0);
    expect(payload.ImpOpEx).toBe(0);
    expect(payload.Iva).toEqual([{ Id: 5, BaseImp: 1000, Importe: 210 }]);
  });

  it("moves zero-IVA legacy base to ImpOpEx instead of IVA list", async () => {
    const response = await createCreditNoteVoucher(
      reqStub,
      8,
      "12345678",
      96,
      [detail({ sale_price: 1000, taxableBase21: 1000, tax_21: 0 })],
      "PES",
      undefined,
      "2026-05-10",
      [{ Tipo: 6, PtoVta: 3, Nro: 100 }],
    );

    expect(response.success).toBe(true);
    const payload = mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotal).toBe(1000);
    expect(payload.ImpNeto).toBe(0);
    expect(payload.ImpIVA).toBe(0);
    expect(payload.ImpTotConc).toBe(0);
    expect(payload.ImpOpEx).toBe(1000);
    expect(payload).not.toHaveProperty("Iva");
  });

  it("splits no gravado and exento into their dedicated AFIP fields", async () => {
    const response = await createCreditNoteVoucher(
      reqStub,
      8,
      "12345678",
      96,
      [detail({ sale_price: 1200, nonComputable: 200, exempt: 1000 })],
      "PES",
      undefined,
      "2026-05-10",
      [{ Tipo: 6, PtoVta: 3, Nro: 100 }],
    );

    expect(response.success).toBe(true);
    const payload = mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotal).toBe(1200);
    expect(payload.ImpNeto).toBe(0);
    expect(payload.ImpIVA).toBe(0);
    expect(payload.ImpTotConc).toBe(200);
    expect(payload.ImpOpEx).toBe(1000);
    expect(payload).not.toHaveProperty("Iva");
  });

  it("maps mixed gravado + exento into IVA taxable lines plus ImpOpEx", async () => {
    const response = await createCreditNoteVoucher(
      reqStub,
      8,
      "12345678",
      96,
      [detail({ sale_price: 6560, taxableBase21: 1044.35, tax_21: 219.31 })],
      "PES",
      undefined,
      "2026-05-10",
      [{ Tipo: 6, PtoVta: 3, Nro: 100 }],
    );

    expect(response.success).toBe(true);
    const payload = mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotal).toBe(6560);
    expect(payload.ImpNeto).toBe(1044.35);
    expect(payload.ImpIVA).toBe(219.31);
    expect(payload.ImpTotConc).toBe(0);
    expect(payload.ImpOpEx).toBe(5296.34);
    expect(payload.Iva).toEqual([{ Id: 5, BaseImp: 1044.35, Importe: 219.31 }]);
  });
});
