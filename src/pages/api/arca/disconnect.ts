import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getAuthContext, hasArcaAccess } from "@/lib/arcaAuth";
import { invalidateAfipCache } from "@/services/afip/afipConfig";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }
  const auth = await getAuthContext(req);
  if (!auth?.id_agency) return res.status(401).json({ error: "No autenticado" });
  if (!hasArcaAccess(auth.role)) return res.status(403).json({ error: "No autorizado" });

  const active = await prisma.arcaConnectionJob.findFirst({
    where: { agencyId: auth.id_agency, status: { in: ["pending", "running", "waiting"] } },
    select: { id: true },
  });
  if (active) return res.status(409).json({ error: "Esperá a que termine la conexión en curso." });

  const result = await prisma.agencyArcaConfig.updateMany({
    where: { agencyId: auth.id_agency, certEncrypted: { not: null }, keyEncrypted: { not: null } },
    data: { status: "disconnected", lastError: null },
  });
  if (result.count === 0) return res.status(404).json({ error: "No hay conexión ARCA para desconectar." });
  invalidateAfipCache(auth.id_agency);
  return res.status(200).json({ disconnected: true });
}
