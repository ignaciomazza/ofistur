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

import {
  createVoucherService,
  recoverPreparedVoucherService,
} from "@/services/afip/createVoucherService";

const serviceDateFrom = new Date("2026-05-01T12:00:00Z");
const serviceDateTo = new Date("2026-05-10T12:00:00Z");
const reqStub = {} as unknown as NextApiRequest;

function baseServiceDetail(overrides: Record<string, unknown> = {}) {
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
    departure_date: serviceDateFrom,
    return_date: serviceDateTo,
    ...overrides,
  };
}

describe("createVoucherService tax mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getAfipFromRequest.mockResolvedValue(mocks.afipClient);
    mocks.getAgencyCUITFromRequest.mockResolvedValue(20401234567);
    mocks.getAgencyIdFromRequest.mockResolvedValue(10);
    mocks.resolveSalesPoint.mockResolvedValue(3);
    mocks.agencyArcaConfigFindUnique.mockResolvedValue({
      selectedSalesPoint: null,
    });
    mocks.qrToDataUrl.mockResolvedValue("data:image/png;base64,qr");

    mocks.afipClient.ElectronicBilling.getServerStatus.mockResolvedValue({
      AppServer: "OK",
      DbServer: "OK",
      AuthServer: "OK",
    });
    mocks.afipClient.ElectronicBilling.getLastVoucher.mockResolvedValue(120);
    mocks.afipClient.ElectronicBilling.getVoucherInfo.mockResolvedValue({
      CbteFch: "20260501",
    });
    mocks.afipClient.ElectronicBilling.createVoucher.mockResolvedValue({
      CAE: "12345678901234",
      CAEFchVto: "20260531",
    });
  });

  it("maps manual exempt totals to ImpOpEx and avoids IVA 0% taxable lines", async () => {
    const response = await createVoucherService(
      reqStub,
      6,
      "12345678",
      96,
      [baseServiceDetail({ sale_price: 6030 })],
      "PES",
      undefined,
      "2026-05-10",
      { total: 6030 },
    );

    expect(response.success).toBe(true);
    const payload =
      mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotal).toBe(6030);
    expect(payload.ImpNeto).toBe(0);
    expect(payload.ImpIVA).toBe(0);
    expect(payload.ImpTotConc).toBe(0);
    expect(payload.ImpOpEx).toBe(6030);
    expect(payload.Iva).toEqual([]);
  });

  it("moves zero-IVA taxable bases to ImpOpEx for legacy/incorrect service data", async () => {
    const response = await createVoucherService(
      reqStub,
      6,
      "12345678",
      96,
      [baseServiceDetail({ sale_price: 1000, taxableBase21: 1000, tax_21: 0 })],
      "PES",
      undefined,
      "2026-05-10",
    );

    expect(response.success).toBe(true);
    const payload =
      mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotal).toBe(1000);
    expect(payload.ImpNeto).toBe(0);
    expect(payload.ImpIVA).toBe(0);
    expect(payload.ImpOpEx).toBe(1000);
    expect(payload.ImpTotConc).toBe(0);
    expect(payload.Iva).toEqual([]);
  });

  it("preserves split between no gravado and exento when service data provides both", async () => {
    const response = await createVoucherService(
      reqStub,
      6,
      "12345678",
      96,
      [
        baseServiceDetail({
          sale_price: 1200,
          nonComputable: 200,
          exempt: 1000,
        }),
      ],
      "PES",
      undefined,
      "2026-05-10",
    );

    expect(response.success).toBe(true);
    const payload =
      mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotal).toBe(1200);
    expect(payload.ImpNeto).toBe(0);
    expect(payload.ImpIVA).toBe(0);
    expect(payload.ImpTotConc).toBe(200);
    expect(payload.ImpOpEx).toBe(1000);
    expect(payload.Iva).toEqual([]);
  });

  it("maps mixed gravado + exento into taxable IVA lines plus ImpOpEx", async () => {
    const response = await createVoucherService(
      reqStub,
      6,
      "12345678",
      96,
      [
        baseServiceDetail({
          sale_price: 6560,
          taxableBase21: 1044.35,
          tax_21: 219.31,
        }),
      ],
      "PES",
      undefined,
      "2026-05-10",
    );

    expect(response.success).toBe(true);
    const payload =
      mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
    expect(payload.ImpTotal).toBe(6560);
    expect(payload.ImpNeto).toBe(1044.35);
    expect(payload.ImpIVA).toBe(219.31);
    expect(payload.ImpTotConc).toBe(0);
    expect(payload.ImpOpEx).toBe(5296.34);
    expect(payload.Iva).toEqual([{ Id: 5, BaseImp: 1044.35, Importe: 219.31 }]);
  });

  it("keeps AFIP payload balanced and avoids IVA lines with zero tax across scenarios", async () => {
    const scenarios = [
      {
        name: "gravado 21",
        services: [
          baseServiceDetail({
            sale_price: 1210,
            taxableBase21: 1000,
            tax_21: 210,
          }),
        ],
      },
      {
        name: "gravado 10.5",
        services: [
          baseServiceDetail({
            sale_price: 1105,
            taxableBase10_5: 1000,
            tax_105: 105,
          }),
        ],
      },
      {
        name: "mixto",
        services: [
          baseServiceDetail({
            sale_price: 2315,
            taxableBase21: 1000,
            tax_21: 210,
            taxableBase10_5: 1000,
            tax_105: 105,
          }),
        ],
      },
      {
        name: "no gravado + exento",
        services: [
          baseServiceDetail({
            sale_price: 2000,
            nonComputable: 500,
            exempt: 1500,
          }),
        ],
      },
      {
        name: "legacy base iva0",
        services: [
          baseServiceDetail({
            sale_price: 1300,
            taxableBase21: 1300,
            tax_21: 0,
          }),
        ],
      },
      {
        name: "manual total-only",
        services: [baseServiceDetail({ sale_price: 6030 })],
        manualTotals: { total: 6030 },
      },
    ] as const;

    for (const scenario of scenarios) {
      mocks.afipClient.ElectronicBilling.createVoucher.mockClear();

      const response = await createVoucherService(
        reqStub,
        6,
        "12345678",
        96,
        [...scenario.services],
        "PES",
        undefined,
        "2026-05-10",
        "manualTotals" in scenario ? scenario.manualTotals : undefined,
      );

      expect(response.success, scenario.name).toBe(true);
      const payload =
        mocks.afipClient.ElectronicBilling.createVoucher.mock.calls[0][0];
      const impTotal = Number(payload.ImpTotal || 0);
      const impNeto = Number(payload.ImpNeto || 0);
      const impIva = Number(payload.ImpIVA || 0);
      const impTotConc = Number(payload.ImpTotConc || 0);
      const impOpEx = Number(payload.ImpOpEx || 0);

      expect(
        Math.abs(impTotal - (impNeto + impIva + impTotConc + impOpEx)) <= 0.01,
        scenario.name,
      ).toBe(true);

      const ivaLines = Array.isArray(payload.Iva) ? payload.Iva : [];
      const hasZeroTaxLine = ivaLines.some(
        (line: { BaseImp?: number; Importe?: number }) =>
          Number(line.BaseImp || 0) > 0 &&
          Math.abs(Number(line.Importe || 0)) <= 0.01,
      );
      expect(hasZeroTaxLine, scenario.name).toBe(false);
    }
  });

  it("persists lifecycle checkpoints on both sides of the irreversible ARCA call", async () => {
    const onPrepared = vi.fn();
    const onAuthorized = vi.fn();

    const response = await createVoucherService(
      reqStub,
      6,
      "12345678",
      96,
      [baseServiceDetail({ sale_price: 1000, exempt: 1000 })],
      "PES",
      undefined,
      "2026-05-10",
      undefined,
      { onPrepared, onAuthorized },
    );

    expect(response.success).toBe(true);
    expect(onPrepared).toHaveBeenCalledTimes(1);
    expect(onAuthorized).toHaveBeenCalledTimes(1);
    expect(onPrepared.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.afipClient.ElectronicBilling.createVoucher.mock
        .invocationCallOrder[0],
    );
    expect(onAuthorized.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.afipClient.ElectronicBilling.createVoucher.mock
        .invocationCallOrder[0],
    );
    expect(onAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({
        PtoVta: 3,
        CbteTipo: 6,
        CbteDesde: 121,
        CAE: "12345678901234",
      }),
    );
  });

  it("recovers an already authorized prepared voucher without issuing it again", async () => {
    mocks.afipClient.ElectronicBilling.getVoucherInfo.mockResolvedValueOnce({
      Concepto: 2,
      DocTipo: 96,
      DocNro: 12345678,
      CbteDesde: 121,
      CbteHasta: 121,
      CbteFch: 20260510,
      ImpTotal: 1000,
      MonId: "PES",
      MonCotiz: 1,
      CodAutorizacion: "12345678901234",
      FchVto: "20260531",
    });

    const recovered = await recoverPreparedVoucherService(reqStub, {
      PtoVta: 3,
      CbteTipo: 6,
      CbteDesde: 121,
      CbteHasta: 121,
      CbteFch: 20260510,
      Concepto: 2,
      DocTipo: 96,
      DocNro: 12345678,
      ImpTotal: 1000,
      MonId: "PES",
      MonCotiz: 1,
    });

    expect(recovered.status).toBe("AUTHORIZED");
    expect(
      mocks.afipClient.ElectronicBilling.createVoucher,
    ).not.toHaveBeenCalled();
    if (recovered.status === "AUTHORIZED") {
      expect(recovered.details).toEqual(
        expect.objectContaining({
          PtoVta: 3,
          CbteTipo: 6,
          CbteDesde: 121,
          CAE: "12345678901234",
        }),
      );
      expect(recovered.qrBase64).toBe("data:image/png;base64,qr");
    }
  });
});
