import { createPrivateKey, randomBytes, X509Certificate } from "crypto";
import Afip from "@afipsdk/afip.js";
import prisma from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/arcaSecrets";
import { invalidateAfipCache } from "@/services/afip/afipConfig";
import { runAutomation } from "@/services/arca/automationV2";
import { extractPemPair } from "@/services/arca/pem";
import { classifyTaxRegime } from "@/services/arca/taxRegime";
import { arcaErrorMessage, isInvalidCertificate, isMissingServiceAuthorization, isProviderCuitLimit } from "@/services/arca/connectionErrors";
import { getAfipSdkAccessToken } from "@/services/afip/accessToken";

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

function certificateValid(cert: string, key?: string): boolean {
  try {
    const certificate = new X509Certificate(cert);
    return new Date(certificate.validTo).getTime() > Date.now() + 7 * 86400_000 &&
      (!key || certificate.checkPrivateKey(createPrivateKey(key)));
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
  const providerBlocked = isProviderCuitLimit(message);
  return prisma.arcaConnectionJob.update({
    where: { id: jobId },
    data: {
      status: providerBlocked ? "blocked_provider" : action ? "requires_action" : "error",
      // Keep the provider's reference ID for support; the UI shows a separate,
      // actionable explanation to the agency.
      lastError: safeMessage(message, password),
      longJobId: null,
      passwordEncrypted: null,
      ...(!action && !providerBlocked ? {
        completedAt: new Date(),
        stagedCertEncrypted: null,
        stagedKeyEncrypted: null,
      } : {}),
    },
  });
}

export async function advanceAutomaticJob(jobId: number) {
  const job = await prisma.arcaConnectionJob.findUnique({ where: { id: jobId } });
  if (!job || ["completed", "error", "requires_action", "blocked_provider"].includes(job.status)) return job;
  if (!job.passwordEncrypted) return fail(jobId, "La clave fiscal expiró. Volvé a ingresarla.", true);

  const password = decryptSecret(job.passwordEncrypted);
  const base = { cuit: job.taxIdRepresentado, username: job.taxIdLogin, password };
  const update = (data: Record<string, unknown>) =>
    prisma.arcaConnectionJob.update({ where: { id: jobId }, data });

  try {
    if (job.step === "create_cert" && job.action !== "rotate") {
      const active = await prisma.agencyArcaConfig.findUnique({ where: { agencyId: job.agencyId } });
      if (active?.taxIdRepresentado === job.taxIdRepresentado &&
          active.certEncrypted && active.keyEncrypted &&
          certificateValid(decryptSecret(active.certEncrypted), decryptSecret(active.keyEncrypted))) {
        return update({
          alias: active.alias,
          stagedCertEncrypted: active.certEncrypted,
          stagedKeyEncrypted: active.keyEncrypted,
          stagedServices: [],
          currentServiceIndex: 0,
          step: "probe_ws",
          status: "running",
        });
      }
    }

    if (job.step === "probe_ws") {
      const service = job.services[job.currentServiceIndex];
      if (!service) return update({ step: "detect_regime", status: "running", retryCount: 0 });
      if (!job.stagedCertEncrypted || !job.stagedKeyEncrypted) {
        return fail(jobId, "Falta certificado para verificar los servicios.");
      }
      const client = new Afip({
        CUIT: Number(job.taxIdRepresentado),
        cert: decryptSecret(job.stagedCertEncrypted),
        key: decryptSecret(job.stagedKeyEncrypted),
        production: true,
        access_token: getAfipSdkAccessToken(job.taxIdRepresentado),
      });
      try {
        // WSAA can confirm access even when the agency has no point of sale yet.
        // Force a fresh ticket so a cached authorization cannot mask a revoked one.
        if (service === "wsfe") await client.ElectronicBilling.getTokenAuthorization(true);
        else if (service === "ws_sr_constancia_inscripcion") {
          await client.RegisterInscriptionProof.getTokenAuthorization(true);
        } else if (service === "ws_sr_padron_a13") {
          await client.RegisterScopeThirteen.getTokenAuthorization(true);
        }
        const next = job.currentServiceIndex + 1;
        return update({
          stagedServices: Array.from(new Set([...job.stagedServices, service])),
          currentServiceIndex: next,
          step: next >= job.services.length ? "detect_regime" : "probe_ws",
          status: "running", retryCount: 0,
        });
      } catch (error) {
        const message = arcaErrorMessage(error);
        if (isProviderCuitLimit(message)) return fail(jobId, message, false, password);
        if (isMissingServiceAuthorization(message)) {
          return update({ step: "auth_ws", status: "running", retryCount: 0 });
        }
        if (isInvalidCertificate(message)) {
          return update({
            step: "renew_cert", status: "running", retryCount: 0,
            alias: `${job.alias.slice(0, 20)}${randomBytes(4).toString("hex")}`,
            stagedCertEncrypted: null, stagedKeyEncrypted: null, stagedServices: [],
            currentServiceIndex: 0, detectedTaxRegime: null, regimeConfirmedByArca: false,
          });
        }
        throw error;
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
        access_token: getAfipSdkAccessToken(job.taxIdRepresentado),
      });
      const details = await client.RegisterInscriptionProof.getTaxpayerDetails(Number(job.taxIdRepresentado));
      const regime = classifyTaxRegime(details);
      if (!regime) {
        return fail(jobId, "ARCA no devolvió un régimen fiscal concluyente. Confirmalo para continuar.", true);
      }
      return update({ detectedTaxRegime: regime, regimeConfirmedByArca: true, step: "list_points", status: "running", retryCount: 0 });
    }

    const service = job.services[job.currentServiceIndex];
    const task = job.step === "create_cert" || job.step === "renew_cert" ? "create-cert-prod" :
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
        if (isProviderCuitLimit(result.error)) return fail(jobId, result.error, false, password);
        if (result.retryable && job.retryCount < 3) {
          return update({ retryCount: job.retryCount + 1, status: "waiting", lastError: safeMessage(result.error, password) });
        }
        return fail(jobId, result.error, false, password);
      }

      if (task === "create-cert-prod") {
        const pair = extractPemPair(result.data);
        if (!certificateValid(pair.certPem, pair.keyPem)) return fail(jobId, "ARCA devolvió un certificado o clave inválidos.");
        return update({
          stagedCertEncrypted: encryptSecret(pair.certPem),
          stagedKeyEncrypted: encryptSecret(pair.keyPem),
          stagedServices: [], currentServiceIndex: 0,
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
        // An ambiguous response may occur after ARCA created the requested point.
        // Recover that exact point instead of creating another one on retry.
        const requestedPoint = job.action === "rotate" && job.stagedSalesPoint != null &&
          usable.includes(job.stagedSalesPoint) ? job.stagedSalesPoint : null;
        if (requestedPoint || (usable.length && job.action !== "rotate")) {
          return update({
            detectedTaxRegime: inferred,
            stagedSalesPoints: usable,
            stagedSalesPoint: requestedPoint ??
              (preferred && usable.includes(preferred) ? preferred : Math.min(...usable)),
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
        access_token: getAfipSdkAccessToken(job.taxIdRepresentado),
      });
      const salesPoints = await client.ElectronicBilling.getSalesPoints();
      const verified = salesPoints.map((p: { Nro: number }) => p.Nro);
      const compatiblePoints = job.stagedSalesPoints.filter((number) => verified.includes(number));
      if (!job.stagedSalesPoint || !compatiblePoints.includes(job.stagedSalesPoint)) {
        if (job.retryCount < 12) return update({ retryCount: job.retryCount + 1, status: "waiting" });
        return fail(jobId, "ARCA aún no habilitó el punto de venta para Web Services. Reintentá más tarde.", true);
      }
      const activated = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(77445::integer, ${job.agencyId}::integer)`;
        const [current, agency] = await Promise.all([
          tx.agencyArcaConfig.findUnique({
            where: { agencyId: job.agencyId },
            select: { taxIdRepresentado: true },
          }),
          tx.agency.findUnique({
            where: { id_agency: job.agencyId },
            select: { tax_id: true },
          }),
        ]);
        const agencyCuit = String(agency?.tax_id ?? "").replace(/\D/g, "");
        const changingIssuer =
          (current?.taxIdRepresentado && current.taxIdRepresentado !== job.taxIdRepresentado) ||
          (agencyCuit && agencyCuit !== job.taxIdRepresentado);
        if (changingIssuer) {
          const [invoices, groupInvoices, unfinishedAttempts] = await Promise.all([
            tx.invoice.count({ where: { id_agency: job.agencyId } }),
            tx.travelGroupInvoice.count({ where: { id_agency: job.agencyId } }),
            tx.invoiceIssuanceAttempt.count({
              where: {
                id_agency: job.agencyId,
                status: { in: ["PENDING", "PREPARING", "PROCESSING", "AUTHORIZED", "REVIEW_REQUIRED"] },
              },
            }),
          ]);
          if (invoices || groupInvoices || unfinishedAttempts) return false;
        }
        await tx.agency.update({
          where: { id_agency: job.agencyId },
          data: {
            tax_id: job.taxIdRepresentado,
            afip_cert_base64: null,
            afip_key_base64: null,
          },
        });
        await tx.agencyArcaConfig.upsert({
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
        });
        await tx.arcaConnectionJob.update({
          where: { id: jobId },
          data: {
            status: "completed", step: "done", completedAt: new Date(),
            passwordEncrypted: null, stagedCertEncrypted: null,
            stagedKeyEncrypted: null, longJobId: null, lastError: null,
          },
        });
        return true;
      });
      if (!activated) {
        return fail(jobId, "Se emitieron comprobantes o quedó una emisión pendiente con el CUIT anterior durante la reconexión. Creá una agencia nueva para ese emisor.");
      }
      invalidateAfipCache(job.agencyId);
      return prisma.arcaConnectionJob.findUnique({ where: { id: jobId } });
    }
    return fail(jobId, "Paso de conexión desconocido.");
  } catch (error) {
    const message = arcaErrorMessage(error);
    if (isProviderCuitLimit(message)) return fail(jobId, message, false, password);
    if (job.retryCount < 3) {
      return update({ retryCount: job.retryCount + 1, status: "waiting", lastError: safeMessage(message, password) });
    }
    return fail(jobId, message, false, password);
  }
}
