// src/services/arca/diagnostics.ts
import type { AfipClient } from "@/services/afip/afipConfig";

export async function runArcaDiagnostics(afip: AfipClient) {
  const [serverStatus, salesPoints] = await Promise.all([
    afip.ElectronicBilling.getServerStatus(),
    afip.ElectronicBilling.getSalesPoints(),
  ]);

  const list = (Array.isArray(salesPoints) ? salesPoints : [])
    .map((p) => p.Nro)
    .sort((a, b) => a - b);
  const missingSalesPoint = list.length === 0;

  return {
    serverStatus,
    salesPoints: list,
    missingSalesPoint,
  };
}
