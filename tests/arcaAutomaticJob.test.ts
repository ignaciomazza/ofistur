import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/arcaSecrets";

let job: Record<string, unknown>;
let config: Record<string, unknown> | null;
const runAutomation = vi.fn();
const getSalesPoints = vi.fn();

vi.mock("@/services/arca/automationV2", () => ({ runAutomation }));
vi.mock("@afipsdk/afip.js", () => ({
  default: class {
    ElectronicBilling = { getSalesPoints };
  },
}));
vi.mock("@/services/afip/afipConfig", () => ({ invalidateAfipCache: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
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
    $transaction: vi.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  },
}));

describe("automatic ARCA connection", () => {
  beforeEach(() => {
    process.env.ARCA_SECRETS_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");
    job = {
      id: 1,
      agencyId: 99,
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
    runAutomation.mockReset();
    getSalesPoints.mockReset();
  });

  it("preserves the active issuer when the provider rejects certificate creation", async () => {
    runAutomation.mockResolvedValue({
      status: "error",
      retryable: false,
      error: "Alcanzaste el límite de CUITs de tu plan",
    });
    const { advanceAutomaticJob } = await import("@/services/arca/automaticJob");
    await advanceAutomaticJob(1);
    expect(job.status).toBe("error");
    expect(job.passwordEncrypted).toBeNull();
    expect(config?.taxIdRepresentado).toBe("30987654321");
    expect(config?.status).toBe("connected");
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
  });
});
