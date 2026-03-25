import type { NextApiRequest, NextApiResponse } from "next";
import { resolveAuth } from "@/lib/auth";
import { normalizeRole } from "@/utils/permissions";
import { buildUserDataMigrationPreview } from "@/services/users/userDataMigration";

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

  const sourceRaw = Array.isArray(req.query.sourceUserId)
    ? req.query.sourceUserId[0]
    : req.query.sourceUserId;
  const source_user_id = Number(sourceRaw);
  if (!Number.isFinite(source_user_id) || source_user_id <= 0) {
    return res.status(400).json({ error: "sourceUserId inválido" });
  }

  try {
    const preview = await buildUserDataMigrationPreview({
      id_agency: auth.id_agency,
      source_user_id,
    });
    return res.status(200).json(preview);
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "No se pudo preparar la migración";
    return res.status(400).json({ error: message });
  }
}
