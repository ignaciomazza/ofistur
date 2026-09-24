import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

const mocks = vi.hoisted(() => ({ startArcaJob: vi.fn() }));

vi.mock("@/lib/arcaAuth", () => ({
  getAuthContext: vi.fn(async () => ({ id_agency: 135, role: "administrativo" })),
  hasArcaAccess: vi.fn(() => true),
}));
vi.mock("@/lib/arcaSecrets", () => ({ validateArcaSecretsKey: vi.fn() }));
vi.mock("@/lib/arcaStartJob", () => ({
  startArcaJob: mocks.startArcaJob,
  ArcaJobStartConflict: class ArcaJobStartConflict extends Error {},
}));
vi.mock("@/services/arca/logger", () => ({ logArca: vi.fn() }));

import connect from "@/pages/api/arca/connect";
import rotate from "@/pages/api/arca/rotate";
import { ArcaJobStartConflict } from "@/lib/arcaStartJob";

const body = {
  cuitRepresentado: "20123456789",
  cuitLogin: "20123456789",
  password: "clave-de-prueba",
};

function response() {
  const result = {
    code: 0,
    payload: null as Record<string, unknown> | null,
    status(code: number) { this.code = code; return this; },
    json(payload: Record<string, unknown>) { this.payload = payload; return this; },
  };
  return result;
}

describe("ARCA connection API errors", () => {
  beforeEach(() => mocks.startArcaJob.mockReset());

  it.each([
    ["connect", connect],
    ["rotate", rotate],
  ])("does not expose a database error from %s", async (_name, handler) => {
    mocks.startArcaJob.mockRejectedValueOnce(new Error("Invalid prisma.$executeRaw: pg_advisory_xact_lock failed"));
    const res = response();
    await handler({ method: "POST", body } as NextApiRequest, res as unknown as NextApiResponse);
    expect(res.code).toBe(503);
    expect(res.payload?.error).toContain("Volvé a intentar");
    expect(res.payload?.error).not.toContain("prisma");
  });

  it("keeps an actionable conflict message", async () => {
    mocks.startArcaJob.mockRejectedValueOnce(new ArcaJobStartConflict("Ya hay una conexión ARCA en curso."));
    const res = response();
    await connect({ method: "POST", body } as NextApiRequest, res as unknown as NextApiResponse);
    expect(res.code).toBe(409);
    expect(res.payload?.error).toBe("Ya hay una conexión ARCA en curso.");
  });
});
