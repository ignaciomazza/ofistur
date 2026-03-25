import type { NextApiRequest, NextApiResponse } from "next";
import { resolveAuth } from "@/lib/auth";
import { normalizeRole } from "@/utils/permissions";
import {
  startUserDataMigrationJob,
  validateMigrationStart,
} from "@/services/users/userDataMigration";

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

  const source_user_id = Number(req.body?.sourceUserId);
  const target_user_id = Number(req.body?.targetUserId);

  if (!Number.isFinite(source_user_id) || source_user_id <= 0) {
    return res.status(400).json({ error: "sourceUserId inválido" });
  }
  if (!Number.isFinite(target_user_id) || target_user_id <= 0) {
    return res.status(400).json({ error: "targetUserId inválido" });
  }

  try {
    await validateMigrationStart({
      id_agency: auth.id_agency,
      source_user_id,
      target_user_id,
      actor_user_id: auth.id_user,
    });

    const result = await startUserDataMigrationJob({
      id_agency: auth.id_agency,
      source_user_id,
      target_user_id,
      started_by: auth.id_user,
    });

    return res.status(200).json(result);
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "No se pudo iniciar la migración";
    return res.status(400).json({ error: message });
  }
}
