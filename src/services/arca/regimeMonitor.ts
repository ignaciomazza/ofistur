import prisma from "@/lib/prisma";
import { getAfipForAgency } from "@/services/afip/afipConfig";
import { classifyTaxRegime } from "@/services/arca/taxRegime";

export async function refreshIssuerRegime(agencyId: number) {
  const config = await prisma.agencyArcaConfig.findUnique({
    where: { agencyId },
    select: {
      status: true,
      taxIdRepresentado: true,
      authorizedServices: true,
      taxRegime: true,
      observedTaxRegime: true,
      taxRegimeCheckedAt: true,
    },
  });
  if (!config || config.status !== "connected" ||
      !config.authorizedServices.includes("ws_sr_constancia_inscripcion")) return;
  if (config.taxRegimeCheckedAt &&
      Date.now() - config.taxRegimeCheckedAt.getTime() < 24 * 60 * 60 * 1000) return;

  try {
    const client = await getAfipForAgency(agencyId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ARCA no respondió a tiempo")), 10_000);
    });
    let details: unknown;
    try {
      details = await Promise.race([
        client.RegisterInscriptionProof.getTaxpayerDetails(Number(config.taxIdRepresentado)),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const observed = classifyTaxRegime(details);
    if (!observed) return;
    await prisma.agencyArcaConfig.update({
      where: { agencyId },
      data: {
        observedTaxRegime: observed,
        taxRegime: config.taxRegime ?? observed,
        taxRegimeCheckedAt: new Date(),
      },
    });
  } catch {
    // A failed read must not change the issuer or silently switch the regime.
  }
}
