import { beforeEach, describe, expect, it, vi } from "vitest";

let activeCuit = "20123456789";
let issuedInvoices = 0;
let groupInvoices = 0;
const create = vi.fn();
const start = vi.fn();

vi.mock("workflow/api", () => ({ start }));
vi.mock("@/services/arca/automaticWorkflow", () => ({ connectArcaWorkflow: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(async () => [{ pg_advisory_xact_lock: null }]),
    arcaConnectionJob: {
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create,
    },
    agencyArcaConfig: {
      findUnique: vi.fn(async () => ({ taxIdRepresentado: activeCuit })),
    },
    agency: { findUnique: vi.fn(async () => ({ tax_id: activeCuit })) },
    invoice: { count: vi.fn(async () => issuedInvoices) },
    travelGroupInvoice: { count: vi.fn(async () => groupInvoices) },
  };
  return {
    default: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      arcaConnectionJob: { findUnique: vi.fn(async () => ({ id: 1, status: "running" })), update: vi.fn() },
    },
  };
});

describe("starting an ARCA connection", () => {
  beforeEach(() => {
    process.env.ARCA_SECRETS_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");
    activeCuit = "20123456789";
    issuedInvoices = 0;
    groupInvoices = 0;
    create.mockReset().mockResolvedValue({ id: 1 });
    start.mockReset().mockResolvedValue({ runId: "run-1" });
  });

  const input = {
    agencyId: 99,
    action: "rotate" as const,
    cuitRepresentado: "20123456789",
    cuitLogin: "20123456789",
    alias: "ofistur20123456789",
    services: ["wsfe", "ws_sr_constancia_inscripcion"],
    password: "clave-de-prueba",
  };

  it("keeps the existing issuer unchanged while the replacement runs", async () => {
    const { startArcaJob } = await import("@/lib/arcaStartJob");
    await startArcaJob(input);
    expect(create).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(activeCuit).toBe("20123456789");
  });

  it("blocks a new CUIT when booking or group invoices exist", async () => {
    groupInvoices = 1;
    const { startArcaJob } = await import("@/lib/arcaStartJob");
    await expect(startArcaJob({ ...input, cuitRepresentado: "30987654321" }))
      .rejects.toThrow("facturas emitidas con otro CUIT");
    expect(create).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
