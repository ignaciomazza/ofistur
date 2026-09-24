// src/lib/arcaStartJob.ts
import prisma from "@/lib/prisma";
import { encryptSecret } from "@/lib/arcaSecrets";
import { start } from "workflow/api";
import { connectArcaWorkflow } from "@/services/arca/automaticWorkflow";
import { logArca } from "@/services/arca/logger";
import { randomBytes } from "crypto";

type StartJobInput = {
  agencyId: number;
  action: "connect" | "rotate";
  cuitRepresentado: string;
  cuitLogin: string;
  alias: string;
  services: string[];
  password: string;
};

export class ArcaJobStartConflict extends Error {}

export async function startArcaJob(input: StartJobInput) {
  logArca("info", "Start ARCA job", {
    agencyId: input.agencyId,
    action: input.action,
    cuitRepresentado: input.cuitRepresentado,
    cuitLogin: input.cuitLogin,
    alias: input.alias,
    services: input.services,
    hasPassword: Boolean(input.password),
    passwordLength: input.password.length,
  });
  const job = await prisma.$transaction(async (tx) => {
    // Prisma binds JavaScript numbers as bigint. PostgreSQL's two-key advisory
    // lock accepts integer, integer, so cast both arguments explicitly.
    // The lock returns void, which Prisma cannot deserialize via $queryRaw.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(77445::integer, ${input.agencyId}::integer)`;
    const active = await tx.arcaConnectionJob.findFirst({
      where: { agencyId: input.agencyId, status: { in: ["pending", "running", "waiting"] } },
    });
    if (active) throw new ArcaJobStartConflict("Ya hay una conexión ARCA en curso.");
    const [current, agency] = await Promise.all([
      tx.agencyArcaConfig.findUnique({
        where: { agencyId: input.agencyId },
        select: { taxIdRepresentado: true },
      }),
      tx.agency.findUnique({
        where: { id_agency: input.agencyId },
        select: { tax_id: true },
      }),
    ]);
    const priorCuit = String(current?.taxIdRepresentado || agency?.tax_id || "").replace(/\D/g, "");
    if (priorCuit && priorCuit !== input.cuitRepresentado) {
      const [issued, groupInvoices, unfinishedAttempts] = await Promise.all([
        tx.invoice.count({ where: { id_agency: input.agencyId } }),
        tx.travelGroupInvoice.count({ where: { id_agency: input.agencyId } }),
        tx.invoiceIssuanceAttempt.count({
          where: {
            id_agency: input.agencyId,
            status: { in: ["PENDING", "PREPARING", "PROCESSING", "AUTHORIZED", "REVIEW_REQUIRED"] },
          },
        }),
      ]);
      if (issued > 0 || groupInvoices > 0 || unfinishedAttempts > 0) {
        throw new ArcaJobStartConflict("Esta agencia ya tiene comprobantes o emisiones en curso con otro CUIT. Para conservar su historial fiscal, creá una agencia nueva para el nuevo emisor.");
      }
    }
    await tx.arcaConnectionJob.updateMany({
      where: { agencyId: input.agencyId, status: { in: ["requires_action", "blocked_provider"] } },
      data: {
        status: "error",
        passwordEncrypted: null,
        stagedCertEncrypted: null,
        stagedKeyEncrypted: null,
        longJobId: null,
        lastError: "Se inició una conexión nueva.",
        completedAt: new Date(),
      },
    });
    return tx.arcaConnectionJob.create({
      data: {
        agencyId: input.agencyId,
        // Any new attempt for an existing connection creates fresh credentials.
        // The previous config stays active until verification succeeds.
        action: current ? "rotate" : input.action,
        status: "running",
        step: "create_cert",
        services: input.services,
        passwordEncrypted: encryptSecret(input.password),
        currentServiceIndex: 0,
        taxIdRepresentado: input.cuitRepresentado,
        taxIdLogin: input.cuitLogin,
        // A failed attempt may leave the previous alias in ARCA. A fresh alias
        // prevents the next attempt from colliding with that remote certificate.
        alias: `${input.alias.slice(0, 20)}${randomBytes(4).toString("hex")}`,
      },
    });
  });

  logArca("info", "Job created", { jobId: job.id, agencyId: input.agencyId });
  try {
    await start(connectArcaWorkflow, [job.id]);
  } catch (error) {
    await prisma.arcaConnectionJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        lastError: "No se pudo iniciar el proceso automático.",
        passwordEncrypted: null,
        completedAt: new Date(),
      },
    });
    throw error;
  }

  return prisma.arcaConnectionJob.findUnique({
    where: { id: job.id },
    select: {
      id: true, status: true, step: true, services: true,
      currentServiceIndex: true, lastError: true,
      createdAt: true, updatedAt: true, completedAt: true,
    },
  });
}
