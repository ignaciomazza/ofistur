import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/arcaSecrets";
import prisma from "@/lib/prisma";

let job: Record<string, unknown>;
let config: Record<string, unknown> | null;
let agencyTaxId: string;
let invoiceCount: number;
const runAutomation = vi.fn();
const getSalesPoints = vi.fn();
const getTaxpayerDetails = vi.fn();
const getWsfeAuthorization = vi.fn();
const getConstanciaAuthorization = vi.fn();
const getPadronAuthorization = vi.fn();
const afipOptions = vi.fn();

vi.mock("@/services/arca/automationV2", () => ({ runAutomation }));
vi.mock("@afipsdk/afip.js", () => ({
  default: class {
    constructor(options: unknown) { afipOptions(options); }
    ElectronicBilling = { getSalesPoints, getTokenAuthorization: getWsfeAuthorization };
    RegisterInscriptionProof = { getTaxpayerDetails, getTokenAuthorization: getConstanciaAuthorization };
    RegisterScopeThirteen = { getTokenAuthorization: getPadronAuthorization };
  },
}));
vi.mock("@/services/afip/afipConfig", () => ({ invalidateAfipCache: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: (() => {
    const client = {
    $executeRaw: vi.fn(async () => 1),
    arcaConnectionJob: {
      findUnique: vi.fn(() => ({ ...job })),
      update: vi.fn(({ data }) => {
        job = { ...job, ...data };
        return { ...job };
      }),
    },
    agencyArcaConfig: {
      findUnique: vi.fn(() => config ? { ...config } : null),
      upsert: vi.fn(({ create, update }) => {
        config = config ? { ...config, ...update } : { ...create };
        return { ...config };
      }),
    },
    agency: {
      findUnique: vi.fn(async () => ({ tax_id: agencyTaxId })),
      update: vi.fn(async ({ data }) => {
        agencyTaxId = data.tax_id;
        return { tax_id: agencyTaxId };
      }),
    },
    invoice: { count: vi.fn(async () => invoiceCount) },
    travelGroupInvoice: { count: vi.fn(async () => 0) },
    invoiceIssuanceAttempt: { count: vi.fn(async () => 0) },
  };
  return {
    ...client,
    $transaction: vi.fn((callback: (tx: typeof client) => Promise<unknown>) => callback(client)),
  };
  })(),
}));

describe("automatic ARCA connection", () => {
  beforeEach(() => {
    process.env.AFIP_SDK_ACCESS_TOKEN = "test-default-token";
    delete process.env.AFIP_SDK_BYPASS_TAX_ID;
    delete process.env.AFIP_SDK_BYPASS_ACCESS_TOKEN;
    process.env.ARCA_SECRETS_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");
    job = {
      id: 1,
      agencyId: 99,
      action: "connect",
      status: "running",
      step: "create_cert",
      services: ["wsfe"],
      stagedServices: [],
      stagedSalesPoints: [],
      currentServiceIndex: 0,
      longJobId: null,
      retryCount: 0,
      taxIdRepresentado: "20123456789",
      taxIdLogin: "20123456789",
      alias: "ofistur20123456789",
      passwordEncrypted: encryptSecret("clave-de-prueba"),
    };
    config = {
      agencyId: 99,
      taxIdRepresentado: "30987654321",
      status: "connected",
      certEncrypted: "certificado-anterior",
      keyEncrypted: "clave-anterior",
      selectedSalesPoint: 3,
    };
    agencyTaxId = "30987654321";
    invoiceCount = 0;
    runAutomation.mockReset();
    getSalesPoints.mockReset();
    getTaxpayerDetails.mockReset();
    getWsfeAuthorization.mockReset();
    getConstanciaAuthorization.mockReset();
    getPadronAuthorization.mockReset();
    afipOptions.mockReset();
    vi.mocked(prisma.agencyArcaConfig.findUnique).mockClear();
  });

  it("preserves the active issuer when the provider rejects certificate creation", async () => {
    runAutomation.mockResolvedValue({
      status: "error",
      retryable: false,
      error: "Alcanzaste el límite de CUITs de tu plan",
    });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.status).toBe("blocked_provider");
    expect(job.passwordEncrypted).toBeNull();
    expect(config?.taxIdRepresentado).toBe("30987654321");
    expect(config?.status).toBe("connected");
    expect(agencyTaxId).toBe("30987654321");
  });

  it("creates a new certificate instead of reusing another issuer's credentials", async () => {
    runAutomation.mockResolvedValue({ status: "pending", id: "automation-1" });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(runAutomation).toHaveBeenCalledWith(
      "create-cert-prod",
      expect.objectContaining({ cuit: "20123456789", username: "20123456789" }),
      null,
    );
    expect(job.stagedCertEncrypted).toBeUndefined();
    expect(config?.taxIdRepresentado).toBe("30987654321");
  });

  it("creates a fresh certificate when reconnecting the same issuer", async () => {
    job = { ...job, action: "rotate", taxIdRepresentado: "30987654321" };
    runAutomation.mockResolvedValue({ status: "pending", id: "new-certificate" });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(prisma.agencyArcaConfig.findUnique).not.toHaveBeenCalled();
    expect(runAutomation).toHaveBeenCalledWith(
      "create-cert-prod",
      expect.objectContaining({ cuit: "30987654321" }),
      null,
    );
  });

  it("checks an existing WSFE authorization before creating another one", async () => {
    job = {
      ...job,
      step: "probe_ws",
      stagedCertEncrypted: encryptSecret("certificado-existente"),
      stagedKeyEncrypted: encryptSecret("clave-existente"),
    };
    getWsfeAuthorization.mockResolvedValue({ token: "test", sign: "test" });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.stagedServices).toEqual(["wsfe"]);
    expect(job.step).toBe("detect_regime");
    expect(getWsfeAuthorization).toHaveBeenCalledWith(true);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("uses the temporary account when verifying Bag's certificate", async () => {
    process.env.AFIP_SDK_BYPASS_TAX_ID = "30718124561";
    process.env.AFIP_SDK_BYPASS_ACCESS_TOKEN = "temporary-account";
    job = {
      ...job,
      taxIdRepresentado: "30718124561",
      step: "probe_ws",
      stagedCertEncrypted: encryptSecret("certificado-existente"),
      stagedKeyEncrypted: encryptSecret("clave-existente"),
    };
    getWsfeAuthorization.mockResolvedValue({ token: "test", sign: "test" });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(afipOptions).toHaveBeenCalledWith(expect.objectContaining({
      CUIT: 30718124561,
      access_token: "temporary-account",
    }));
  });

  it("authorizes only a service that ARCA reports as missing", async () => {
    job = {
      ...job,
      step: "probe_ws",
      stagedCertEncrypted: encryptSecret("certificado-existente"),
      stagedKeyEncrypted: encryptSecret("clave-existente"),
    };
    getWsfeAuthorization.mockRejectedValue({ data: { message: "No se encuentra autorizado a usar el servicio wsfe" } });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.step).toBe("auth_ws");
    expect(job.stagedServices).toEqual([]);
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("pauses on the provider CUIT limit while retaining staged credentials", async () => {
    const stagedCertEncrypted = encryptSecret("certificado-existente");
    job = {
      ...job,
      step: "probe_ws",
      stagedCertEncrypted,
      stagedKeyEncrypted: encryptSecret("clave-existente"),
    };
    getWsfeAuthorization.mockRejectedValue({ data: { message: "Alcanzaste el límite de CUITs que podés usar en este período" } });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.status).toBe("blocked_provider");
    expect(job.passwordEncrypted).toBeNull();
    expect(job.stagedCertEncrypted).toBe(stagedCertEncrypted);
    expect(config?.status).toBe("connected");
    expect(runAutomation).not.toHaveBeenCalled();
  });

  it("uses the observed fiscal regime when an existing authorization works", async () => {
    job = {
      ...job,
      step: "probe_ws",
      services: ["ws_sr_constancia_inscripcion"],
      stagedCertEncrypted: encryptSecret("certificado-existente"),
      stagedKeyEncrypted: encryptSecret("clave-existente"),
    };
    getConstanciaAuthorization.mockResolvedValue({ token: "test", sign: "test" });
    getTaxpayerDetails.mockResolvedValue({
      datosRegimenGeneral: { impuesto: { idImpuesto: 30, estadoImpuesto: "AC" } },
    });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.step).toBe("detect_regime");
    await advanceAutomaticJob(1);
    expect(job.detectedTaxRegime).toBe("ri");
    expect(job.regimeConfirmedByArca).toBe(true);
    expect(job.step).toBe("list_points");
  });

  it("reuses a compatible point of sale for the same issuer", async () => {
    job = { ...job, step: "list_points", taxIdRepresentado: "30987654321", detectedTaxRegime: "ri" };
    runAutomation.mockResolvedValue({
      status: "complete",
      data: [
        { number: "3", system: "RECE para aplicativo y web services", deactivated: false },
        { number: "4", system: "Factura en Línea - Responsable Inscripto", deactivated: false },
      ],
    });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.step).toBe("verify");
    expect(job.stagedSalesPoint).toBe(3);
    expect(config?.selectedSalesPoint).toBe(3);
  });

  it("creates a new sales point during a deliberate reconnection", async () => {
    job = { ...job, action: "rotate", step: "list_points", taxIdRepresentado: "30987654321", detectedTaxRegime: "ri" };
    runAutomation.mockResolvedValue({
      status: "complete",
      data: [{ number: "3", system: "RECE para aplicativo y web services" }],
    });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.step).toBe("create_point");
    expect(job.stagedSalesPoint).toBe(4);
    expect(config?.selectedSalesPoint).toBe(3);
  });

  it("recovers the requested point if ARCA created it before an ambiguous response", async () => {
    job = {
      ...job, action: "rotate", step: "list_points", taxIdRepresentado: "30987654321",
      detectedTaxRegime: "ri", stagedSalesPoint: 4,
    };
    runAutomation.mockResolvedValue({
      status: "complete",
      data: [
        { number: "3", system: "RECE para aplicativo y web services" },
        { number: "4", system: "RECE para aplicativo y web services" },
      ],
    });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.step).toBe("verify");
    expect(job.stagedSalesPoint).toBe(4);
  });

  it("connects a monotributista using a compatible Web Services point", async () => {
    job = { ...job, step: "list_points", detectedTaxRegime: "mono", regimeConfirmedByArca: true };
    runAutomation.mockResolvedValue({
      status: "complete",
      data: [
        { number: "2", system: "Factura en Línea - Monotributo", deactivated: false },
        { number: "7", system: "Factura Electronica - Monotributo - Web Services", deactivated: false },
      ],
    });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.step).toBe("verify");
    expect(job.stagedSalesPoint).toBe(7);
  });

  it("switches the issuer only after the new certificate and sales point are verified", async () => {
    job = {
      ...job,
      step: "verify",
      detectedTaxRegime: "ri",
      stagedCertEncrypted: encryptSecret("certificado-nuevo"),
      stagedKeyEncrypted: encryptSecret("clave-nueva"),
      stagedServices: ["wsfe", "ws_sr_constancia_inscripcion"],
      stagedSalesPoint: 5,
      stagedSalesPoints: [5],
    };
    getSalesPoints.mockResolvedValue([{ Nro: 5 }, { Nro: 8 }]);
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.status).toBe("completed");
    expect(job.passwordEncrypted).toBeNull();
    expect(config?.taxIdRepresentado).toBe("20123456789");
    expect(config?.selectedSalesPoint).toBe(5);
    expect(config?.salesPointsDetected).toEqual([5]);
    expect(config?.taxRegime).toBe("ri");
    expect(config?.taxRegimeCheckedAt).toBeNull();
    expect(agencyTaxId).toBe("20123456789");
  });

  it("does not replace an issuer if an invoice appeared during reconnection", async () => {
    invoiceCount = 1;
    job = {
      ...job,
      step: "verify",
      detectedTaxRegime: "ri",
      stagedCertEncrypted: encryptSecret("certificado-nuevo"),
      stagedKeyEncrypted: encryptSecret("clave-nueva"),
      stagedServices: ["wsfe", "ws_sr_constancia_inscripcion"],
      stagedSalesPoint: 5,
      stagedSalesPoints: [5],
    };
    getSalesPoints.mockResolvedValue([{ Nro: 5 }]);
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.status).toBe("error");
    expect(config?.taxIdRepresentado).toBe("30987654321");
    expect(agencyTaxId).toBe("30987654321");
  });
});
