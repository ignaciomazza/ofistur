import type { NextApiRequest, NextApiResponse } from "next";
import { resolveAuth } from "@/lib/auth";
import { normalizeRole } from "@/utils/permissions";
import { getUserDataMigrationJob } from "@/services/users/userDataMigration";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
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

  const job = await getUserDataMigrationJob(id_job, auth.id_agency);
  if (!job) return res.status(404).json({ error: "Trabajo no encontrado" });

  return res.status(200).json(job);
}
