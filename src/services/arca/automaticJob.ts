import { X509Certificate } from "crypto";
import Afip from "@afipsdk/afip.js";
import prisma from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/arcaSecrets";
import { invalidateAfipCache } from "@/services/afip/afipConfig";
import { runAutomation } from "@/services/arca/automationV2";
import { extractPemPair } from "@/services/arca/pem";
import { classifyTaxRegime } from "@/services/arca/taxRegime";

type Regime = "mono" | "ri";
type SalesPoint = {
  number?: string | number;
  system?: string;
  deactivated?: boolean;
  blocked?: boolean;
};

function safeMessage(value: string, password?: string) {
  return (password ? value.replaceAll(password, "[oculta]") : value)
    .replace(/password\s*[:=]\s*\S+/gi, "password:[oculta]")
    .replace(/clave\s*(fiscal)?\s*[:=]\s*\S+/gi, "clave:[oculta]")
    .replace(/-----BEGIN[\s\S]+?-----END[\s\S]+?-----/g, "[oculto]")
    .slice(0, 320);
}

function certificateValid(cert: string): boolean {
  try {
    return new Date(new X509Certificate(cert).validTo).getTime() > Date.now() + 7 * 86400_000;
  } catch {
    return false;
  }
}

function pointsFrom(data: unknown): SalesPoint[] {
  return Array.isArray(data) ? data.filter((p) => p && typeof p === "object") : [];
}

function compatible(point: SalesPoint, regime: Regime): boolean {
  if (point.deactivated || point.blocked) return false;
  const name = String(point.system ?? "").toLowerCase();
  return regime === "mono"
    ? name.includes("monotributo") && name.includes("web service")
    : (name.includes("rece") || name.includes("responsable inscripto")) &&
        name.includes("web service");
}

async function fail(jobId: number, message: string, action = false, password?: string) {
  return prisma.arcaConnectionJob.update({
    where: { id: jobId },
    data: {
      status: action ? "requires_action" : "error",
      lastError: safeMessage(message, password),
      longJobId: null,
      passwordEncrypted: null,
      ...(!action ? {
        completedAt: new Date(),
        stagedCertEncrypted: null,
        stagedKeyEncrypted: null,
      } : {}),
    },
  });
}

export async function advanceAutomaticJob(jobId: number) {
  const job = await prisma.arcaConnectionJob.findUnique({ where: { id: jobId } });
  if (!job || ["completed", "error", "requires_action"].includes(job.status)) return job;
  if (!job.passwordEncrypted) return fail(jobId, "La clave fiscal expiró. Volvé a ingresarla.", true);

  const password = decryptSecret(job.passwordEncrypted);
  const base = { cuit: job.taxIdRepresentado, username: job.taxIdLogin, password };
  const update = (data: Record<string, unknown>) =>
    prisma.arcaConnectionJob.update({ where: { id: jobId }, data });

  try {
    if (job.step === "create_cert") {
      const active = await prisma.agencyArcaConfig.findUnique({ where: { agencyId: job.agencyId } });
      if (active?.taxIdRepresentado === job.taxIdRepresentado &&
          active.certEncrypted && active.keyEncrypted &&
          certificateValid(decryptSecret(active.certEncrypted))) {
        return update({
          alias: active.alias,
          stagedCertEncrypted: active.certEncrypted,
          stagedKeyEncrypted: active.keyEncrypted,
          stagedServices: active.authorizedServices,
          step: "auth_ws",
          status: "running",
        });
      }
    }

    if (job.step === "detect_regime" && job.detectedTaxRegime) {
      return update({ step: "list_points", status: "running", retryCount: 0 });
    }
    if (job.step === "detect_regime") {
      if (!job.stagedCertEncrypted || !job.stagedKeyEncrypted) {
        return fail(jobId, "Falta certificado para consultar el régimen fiscal.");
      }
      const client = new Afip({
        CUIT: Number(job.taxIdRepresentado),
        cert: decryptSecret(job.stagedCertEncrypted),
        key: decryptSecret(job.stagedKeyEncrypted),
        production: true,
        access_token: process.env.AFIP_SDK_ACCESS_TOKEN || process.env.ACCESS_TOKEN,
      });
      const details = await client.RegisterInscriptionProof.getTaxpayerDetails(Number(job.taxIdRepresentado));
      const regime = classifyTaxRegime(details);
      if (!regime) {
        return fail(jobId, "ARCA no devolvió un régimen fiscal concluyente. Confirmalo para continuar.", true);
      }
      return update({ detectedTaxRegime: regime, regimeConfirmedByArca: true, step: "list_points", status: "running", retryCount: 0 });
    }

    const service = job.services[job.currentServiceIndex];
    const task = job.step === "create_cert" ? "create-cert-prod" :
      job.step === "auth_ws" && service ? "auth-web-service-prod" :
      job.step === "list_points" ? "list-sales-points" :
      job.step === "create_point" ? "create-sales-point" : null;

    if (job.step === "auth_ws" && (!service || job.stagedServices.includes(service))) {
      const next = !service ? job.currentServiceIndex : job.currentServiceIndex + 1;
      return update({
        currentServiceIndex: next,
        step: next >= job.services.length ? "detect_regime" : "auth_ws",
        status: "running",
      });
    }

    if (task) {
      const params: Record<string, unknown> = { ...base };
      if (task === "create-cert-prod") params.alias = job.alias;
      if (task === "auth-web-service-prod") {
        params.alias = job.alias;
        params.service = service;
      }
      if (task === "create-sales-point") {
        if (job.stagedSalesPoint == null || !job.detectedTaxRegime) {
          return fail(jobId, "No se pudo elegir un punto de venta seguro.");
        }
        params.numero = job.stagedSalesPoint;
        params.sistema = job.detectedTaxRegime === "mono" ? "MAW" : "RAW";
        params.nombreFantasia = "Ofistur";
      }
      const result = await runAutomation(task, params, job.longJobId);
      if (result.status === "pending") {
        return update({ status: "waiting", longJobId: result.id, lastError: null });
      }
      if (result.status === "error") {
        if (task === "create-sales-point" && /ya existe|already exists|duplicad/i.test(result.error)) {
          return update({ step: "list_points", longJobId: null, status: "running", retryCount: 0 });
        }
        if (result.retryable && job.retryCount < 3) {
          return update({ retryCount: job.retryCount + 1, status: "waiting", lastError: safeMessage(result.error, password) });
        }
        const quotaHint = /l[ií]mite de cuits/i.test(result.error)
          ? " Revisá el cupo de CUITs del plan de Afip SDK de OFISTUR."
          : "";
        return fail(jobId, result.error + quotaHint, false, password);
      }

      if (task === "create-cert-prod") {
        const pair = extractPemPair(result.data);
        if (!certificateValid(pair.certPem)) return fail(jobId, "ARCA devolvió un certificado inválido o vencido.");
        return update({
          stagedCertEncrypted: encryptSecret(pair.certPem),
          stagedKeyEncrypted: encryptSecret(pair.keyPem),
          step: "auth_ws", longJobId: null, status: "running", retryCount: 0,
        });
      }
      if (task === "auth-web-service-prod") {
        const stagedServices = Array.from(new Set([...job.stagedServices, service]));
        const next = job.currentServiceIndex + 1;
        return update({
          stagedServices, currentServiceIndex: next,
          step: next >= job.services.length ? "detect_regime" : "auth_ws",
          longJobId: null, status: "running", retryCount: 0,
        });
      }
      if (task === "list-sales-points") {
        const points = pointsFrom(result.data);
        const inferred = job.detectedTaxRegime;
        if (!inferred) {
          return fail(jobId, "No pude confirmar si este CUIT es monotributista o responsable inscripto. Elegí el régimen para continuar.", true);
        }
        const usable = points
          .filter((p) => compatible(p, inferred as Regime))
          .map((p) => Number(p.number))
          .filter((n) => Number.isInteger(n) && n > 0);
        const all = points.map((p) => Number(p.number)).filter((n) => Number.isInteger(n) && n > 0);
        const active = await prisma.agencyArcaConfig.findUnique({ where: { agencyId: job.agencyId } });
        const preferred = active?.taxIdRepresentado === job.taxIdRepresentado ? active.selectedSalesPoint : null;
        if (usable.length) {
          return update({
            detectedTaxRegime: inferred,
            stagedSalesPoints: usable,
            stagedSalesPoint: preferred && usable.includes(preferred) ? preferred : Math.min(...usable),
            step: "verify", longJobId: null, status: "running", retryCount: 0,
          });
        }
        const next = Math.max(0, ...all) + 1;
        if (next > 99999) return fail(jobId, "No hay números de punto de venta disponibles.");
        return update({
          detectedTaxRegime: inferred,
          stagedSalesPoint: next,
          stagedSalesPoints: [],
          step: "create_point", longJobId: null, status: "running", retryCount: 0,
        });
      }
      if (task === "create-sales-point") {
        return update({
          stagedSalesPoints: job.stagedSalesPoint == null ? [] : [job.stagedSalesPoint],
          step: "verify", longJobId: null, status: "running", retryCount: 0,
        });
      }
    }

    if (job.step === "verify") {
      if (!job.stagedCertEncrypted || !job.stagedKeyEncrypted || !job.detectedTaxRegime) {
        return fail(jobId, "Faltan datos para validar la conexión.");
      }
      const client = new Afip({
        CUIT: Number(job.taxIdRepresentado),
        cert: decryptSecret(job.stagedCertEncrypted),
        key: decryptSecret(job.stagedKeyEncrypted),
        production: true,
        access_token: process.env.AFIP_SDK_ACCESS_TOKEN || process.env.ACCESS_TOKEN,
      });
      const salesPoints = await client.ElectronicBilling.getSalesPoints();
      const verified = salesPoints.map((p: { Nro: number }) => p.Nro);
      const compatiblePoints = job.stagedSalesPoints.filter((number) => verified.includes(number));
      if (!job.stagedSalesPoint || !compatiblePoints.includes(job.stagedSalesPoint)) {
        if (job.retryCount < 12) return update({ retryCount: job.retryCount + 1, status: "waiting" });
        return fail(jobId, "ARCA aún no habilitó el punto de venta para Web Services. Reintentá más tarde.", true);
      }
      await prisma.$transaction([
        prisma.agencyArcaConfig.upsert({
          where: { agencyId: job.agencyId },
          create: {
            agencyId: job.agencyId,
            taxIdRepresentado: job.taxIdRepresentado,
            taxIdLogin: job.taxIdLogin,
            alias: job.alias,
            certEncrypted: job.stagedCertEncrypted,
            keyEncrypted: job.stagedKeyEncrypted,
            authorizedServices: job.stagedServices,
            salesPointsDetected: compatiblePoints,
            selectedSalesPoint: job.stagedSalesPoint,
            taxRegime: job.detectedTaxRegime,
            observedTaxRegime: job.regimeConfirmedByArca ? job.detectedTaxRegime : null,
            taxRegimeCheckedAt: job.regimeConfirmedByArca ? new Date() : null,
            status: "connected",
            lastOkAt: new Date(),
          },
          update: {
            taxIdRepresentado: job.taxIdRepresentado,
            taxIdLogin: job.taxIdLogin,
            alias: job.alias,
            certEncrypted: job.stagedCertEncrypted,
            keyEncrypted: job.stagedKeyEncrypted,
            authorizedServices: job.stagedServices,
            salesPointsDetected: compatiblePoints,
            selectedSalesPoint: job.stagedSalesPoint,
            taxRegime: job.detectedTaxRegime,
            observedTaxRegime: job.regimeConfirmedByArca ? job.detectedTaxRegime : null,
            taxRegimeCheckedAt: job.regimeConfirmedByArca ? new Date() : null,
            status: "connected", lastError: null, lastOkAt: new Date(),
          },
        }),
        prisma.arcaConnectionJob.update({
          where: { id: jobId },
          data: {
            status: "completed", step: "done", completedAt: new Date(),
            passwordEncrypted: null, stagedCertEncrypted: null,
            stagedKeyEncrypted: null, longJobId: null, lastError: null,
          },
        }),
      ]);
      invalidateAfipCache(job.agencyId);
      return prisma.arcaConnectionJob.findUnique({ where: { id: jobId } });
    }
    return fail(jobId, "Paso de conexión desconocido.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado en ARCA";
    if (job.retryCount < 3) {
      return update({ retryCount: job.retryCount + 1, status: "waiting", lastError: safeMessage(message, password) });
    }
    return fail(jobId, message, false, password);
  }
}
