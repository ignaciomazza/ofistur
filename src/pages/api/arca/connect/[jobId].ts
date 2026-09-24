// src/pages/api/arca/connect/[jobId].ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getAuthContext, hasArcaAccess } from "@/lib/arcaAuth";
import { encryptSecret } from "@/lib/arcaSecrets";
import { start } from "workflow/api";
import { connectArcaWorkflow } from "@/services/arca/automaticWorkflow";
import { logArca } from "@/services/arca/logger";

function parseJobId(raw: string | string[] | undefined): number {
  const val = Array.isArray(raw) ? raw[0] : raw;
  return val ? parseInt(val, 10) : 0;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const auth = await getAuthContext(req);
  if (!auth?.id_agency) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (!hasArcaAccess(auth.role)) {
    return res.status(403).json({ error: "No autorizado" });
  }

  const jobId = parseJobId(req.query.jobId);
  if (!jobId) return res.status(400).json({ error: "jobId inválido" });

  const job = await prisma.arcaConnectionJob.findUnique({ where: { id: jobId } });
  if (!job || job.agencyId !== auth.id_agency) {
    return res.status(404).json({ error: "Job no encontrado" });
  }

  if (req.method === "POST") {
    const password = String((req.body ?? {}).password ?? "");
    if (!password.trim()) {
      return res.status(400).json({ error: "Clave fiscal requerida" });
    }
    logArca("info", "API resume job", {
      jobId,
      agencyId: auth.id_agency,
      hasPassword: Boolean(password),
      passwordLength: password.length,
    });
    if (!["requires_action", "blocked_provider"].includes(job.status)) {
      return res.status(409).json({ error: "Esta conexión no requiere reanudar." });
    }
    const newer = await prisma.arcaConnectionJob.findFirst({
      where: { agencyId: auth.id_agency, id: { gt: jobId } },
      select: { id: true },
    });
    if (newer) return res.status(409).json({ error: "Hay una conexión más reciente. Actualizá la página." });
    const regime = (req.body ?? {}).taxRegime;
    if (job.status === "requires_action" && ["detect_regime", "list_points"].includes(job.step) &&
        !job.detectedTaxRegime && !["mono", "ri"].includes(regime)) {
      return res.status(400).json({ error: "Seleccioná el régimen fiscal confirmado en ARCA." });
    }
    const resumed = await prisma.arcaConnectionJob.updateMany({
      where: { id: jobId, agencyId: auth.id_agency, status: job.status },
      data: {
        passwordEncrypted: encryptSecret(password),
        detectedTaxRegime: job.status === "requires_action" && ["mono", "ri"].includes(regime)
          ? regime : job.detectedTaxRegime,
        status: "running", lastError: null, retryCount: 0,
      },
    });
    if (resumed.count !== 1) {
      return res.status(409).json({ error: "La conexión cambió de estado. Actualizá la página." });
    }
    try {
      await start(connectArcaWorkflow, [jobId]);
    } catch {
      await prisma.arcaConnectionJob.update({
        where: { id: jobId },
        data: { status: job.status, passwordEncrypted: null, lastError: "No se pudo reanudar el proceso automático." },
      });
      return res.status(503).json({ error: "No se pudo reanudar el proceso automático." });
    }
  } else if (req.method !== "GET") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Método ${req.method} no permitido`);
  }

  const updated = await prisma.arcaConnectionJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      step: true,
      services: true,
      currentServiceIndex: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  return res.status(200).json({ job: updated });
}
