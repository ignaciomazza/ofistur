import type { NextApiRequest, NextApiResponse } from "next";
import { resolveAuth } from "@/lib/auth";
import { normalizeRole } from "@/utils/permissions";
import { retryUserDataMigrationJob } from "@/services/users/userDataMigration";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res
      .status(405)
      .json({ error: `Método ${req.method} no permitido` });
  }

  const auth = await resolveAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  const role = normalizeRole(auth.role);
  const isManager = role === "gerente" || role === "desarrollador";
  if (!isManager) return res.status(403).json({ error: "No autorizado" });

  const idRaw = Array.isArray(req.query.jobId)
    ? req.query.jobId[0]
    : req.query.jobId;
  const id_job = Number(idRaw);
  if (!Number.isFinite(id_job) || id_job <= 0) {
    return res.status(400).json({ error: "jobId inválido" });
  }

  try {
    const job = await retryUserDataMigrationJob({
      id_job,
      id_agency: auth.id_agency,
    });
    return res.status(200).json(job);
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "No se pudo reintentar la migración";
    return res.status(400).json({ error: message });
  }
}
