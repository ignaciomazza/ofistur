// src/pages/api/arca/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getAuthContext, hasArcaAccess } from "@/lib/arcaAuth";
import { validateArcaSecretsKey } from "@/lib/arcaSecrets";
import { logArca } from "@/services/arca/logger";
import { refreshIssuerRegime } from "@/services/arca/regimeMonitor";

async function handleGET(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getAuthContext(req);
  if (!auth?.id_agency) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (!hasArcaAccess(auth.role)) {
    return res.status(403).json({ error: "No autorizado" });
  }

  try {
    let secretsKeyValid = true;
    let secretsKeyError: string | null = null;
    try {
      validateArcaSecretsKey();
    } catch (err) {
      secretsKeyValid = false;
      secretsKeyError =
        err instanceof Error
          ? err.message
          : "ARCA_SECRETS_KEY inválido";
    }
    await prisma.arcaConnectionJob.updateMany({
      where: {
        agencyId: auth.id_agency,
        status: { in: ["pending", "running", "waiting"] },
        updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
      },
      data: {
        status: "requires_action",
        passwordEncrypted: null,
        lastError: "La conexión se detuvo. Podés retomarla desde este paso.",
      },
    });
    await refreshIssuerRegime(auth.id_agency);
    const [config, job] = await Promise.all([
      prisma.agencyArcaConfig.findUnique({
        where: { agencyId: auth.id_agency },
        select: {
          taxIdRepresentado: true,
          taxIdLogin: true,
          alias: true,
          authorizedServices: true,
          salesPointsDetected: true,
          selectedSalesPoint: true,
          taxRegime: true,
          observedTaxRegime: true,
          taxRegimeCheckedAt: true,
          status: true,
          lastError: true,
          lastOkAt: true,
          certEncrypted: true,
          keyEncrypted: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.arcaConnectionJob.findFirst({
        where: {
          agencyId: auth.id_agency,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
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
      }),
    ]);
    logArca("info", "API status", {
      agencyId: auth.id_agency,
      hasConfig: Boolean(config),
      hasActiveJob: Boolean(job),
      status: config?.status ?? null,
      secretsKeyValid,
    });

    return res.status(200).json({
      config: config
        ? {
            taxIdRepresentado: config.taxIdRepresentado,
            taxIdLogin: config.taxIdLogin,
            alias: config.alias,
            authorizedServices: config.authorizedServices,
            salesPointsDetected: config.salesPointsDetected,
            selectedSalesPoint: config.selectedSalesPoint,
            taxRegime: config.taxRegime,
            observedTaxRegime: config.observedTaxRegime,
            taxRegimeCheckedAt: config.taxRegimeCheckedAt,
            status: config.status,
            lastError: config.lastError,
            lastOkAt: config.lastOkAt,
            createdAt: config.createdAt,
            updatedAt: config.updatedAt,
            hasCert: Boolean(config.certEncrypted),
            hasKey: Boolean(config.keyEncrypted),
          }
        : null,
      activeJob: job?.status === "completed" ? null : job ?? null,
      secretsKeyValid,
      secretsKeyError,
    });
  } catch (err) {
    logArca("error", "API status error", { error: String(err) });
    return res.status(500).json({ error: "Error cargando estado ARCA" });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGET(req, res);
  res.setHeader("Allow", ["GET"]);
  return res.status(405).end(`Método ${req.method} no permitido`);
}
