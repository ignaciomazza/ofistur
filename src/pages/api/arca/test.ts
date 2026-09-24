// src/pages/api/arca/test.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getAuthContext, hasArcaAccess } from "@/lib/arcaAuth";
import { getAfipForAgency } from "@/services/afip/afipConfig";
import { runArcaDiagnostics } from "@/services/arca/diagnostics";
import { logArca } from "@/services/arca/logger";

function sanitizeError(err: unknown): string {
  const providerMessage =
    err && typeof err === "object" && "data" in err
      ? (err as { data?: { message?: unknown } }).data?.message
      : null;
  if (typeof providerMessage === "string" && providerMessage.trim()) {
    return providerMessage.trim().replace(/\s+/g, " ").slice(0, 320);
  }
  if (err instanceof Error && err.message) {
    const msg = err.message.trim();
    return msg ? msg.slice(0, 320) : "Error en ARCA";
  }
  return "Error en ARCA";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Método ${req.method} no permitido`);
  }

  const auth = await getAuthContext(req);
  if (!auth?.id_agency) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (!hasArcaAccess(auth.role)) {
    return res.status(403).json({ error: "No autorizado" });
  }

  const cfg = await prisma.agencyArcaConfig.findUnique({
    where: { agencyId: auth.id_agency },
    select: {
      certEncrypted: true,
      keyEncrypted: true,
      selectedSalesPoint: true,
      salesPointsDetected: true,
      taxRegime: true,
      status: true,
    },
  });
  if (!cfg?.certEncrypted || !cfg?.keyEncrypted) {
    logArca("warn", "API test missing cert/key", { agencyId: auth.id_agency });
    return res.status(400).json({ error: "No hay credenciales ARCA" });
  }
  if (cfg.status === "disconnected") {
    return res.status(409).json({ error: "ARCA está desconectada. Reconectá para volver a facturar." });
  }

  try {
    logArca("info", "API test start", { agencyId: auth.id_agency });
    const afip = await getAfipForAgency(auth.id_agency);
    const { serverStatus, salesPoints, missingSalesPoint } =
      await runArcaDiagnostics(afip);
    // New connections retain the points whose ARCA system matches their fiscal
    // regime. A manual test must not make an unrelated WSFE point selectable.
    const selectablePoints = cfg.taxRegime
      ? cfg.salesPointsDetected.filter((number) => salesPoints.includes(number))
      : salesPoints;
    const missingCompatiblePoint = missingSalesPoint || selectablePoints.length === 0;

    const rawSelected =
      req.body && typeof req.body === "object"
        ? (req.body as { selectedSalesPoint?: unknown }).selectedSalesPoint
        : undefined;
    const parsedSelected =
      typeof rawSelected === "number"
        ? rawSelected
        : typeof rawSelected === "string"
          ? Number(rawSelected)
          : NaN;
    const inputSelected =
      Number.isInteger(parsedSelected) && parsedSelected > 0
        ? parsedSelected
        : null;

    const baseSelected =
      inputSelected != null ? inputSelected : cfg?.selectedSalesPoint ?? null;
    const selectionValid =
      baseSelected != null ? selectablePoints.includes(baseSelected) : false;
    const nextSelected = missingCompatiblePoint
      ? null
      : selectionValid
        ? baseSelected
        : null;

    await prisma.agencyArcaConfig.update({
      where: { agencyId: auth.id_agency },
      data: {
        lastOkAt: new Date(),
        lastError: missingCompatiblePoint
          ? "Falta un punto de venta compatible con el régimen fiscal para Web Services. Reconectá ARCA para buscarlo."
          : baseSelected != null && !selectionValid
            ? "El punto de venta seleccionado no esta habilitado para WSFE."
            : nextSelected == null
              ? "Seleccioná un punto de venta habilitado para Web Services."
              : null,
        status: nextSelected != null ? "connected" : "error",
        salesPointsDetected: selectablePoints,
        selectedSalesPoint: nextSelected,
      },
    });

    return res.status(200).json({
      ok: true,
      missingSalesPoint: missingCompatiblePoint,
      salesPointsCount: selectablePoints.length,
      salesPoints: selectablePoints,
      selectedSalesPoint: nextSelected,
      selectionValid: baseSelected != null ? selectionValid : null,
      serverStatus,
    });
  } catch (err) {
    const msg = sanitizeError(err);
    logArca("warn", "API test error", { agencyId: auth.id_agency, error: msg });
    await prisma.agencyArcaConfig.updateMany({
      where: { agencyId: auth.id_agency },
      data: { lastError: msg },
    });
    return res.status(502).json({ error: msg });
  }
}
