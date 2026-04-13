import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { toDateKeyInBuenosAires } from "@/lib/buenosAiresDate";
import { getAfipForAgency } from "@/services/afip/afipConfig";
import { logBillingEvent } from "@/services/billing/events";

type FiscalStatus = "ISSUED" | "FAILED" | "PENDING";

type IssueFiscalInput = {
  chargeId: number;
  documentType?: string;
  forceRetry?: boolean;
  actorUserId?: number | null;
  issuerAgencyId?: number | null;
  amountArsOverride?: number | null;
};

type IssueFiscalResult = {
  ok: boolean;
  documentId: number;
  status: FiscalStatus;
  message: string;
};

type EmitResult = {
  status: "ISSUED";
  externalReference: string;
  afipPtoVta: number;
  afipCbteTipo: number;
  afipNumber: string;
  afipCae?: string;
  afipCaeDue?: Date | null;
  payload?: Prisma.InputJsonValue;
};

function shouldMockFiscalIssue(): boolean {
  const mode = String(process.env.BILLING_FISCAL_ISSUER_MODE || "").trim().toUpperCase();
  if (mode === "MOCK") return true;
  return String(process.env.AFIP_ENV || "").trim().toLowerCase() === "testing";
}

function resolveDocumentType(input?: string): string {
  const value = String(input || process.env.BILLING_FISCAL_DOCUMENT_TYPE || "INVOICE_B").trim();
  return value || "INVOICE_B";
}

function parseIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Error desconocido al emitir AFIP");
}

async function emitMock(chargeId: number, amountArs: number): Promise<EmitResult> {
  const now = Date.now();
  const ptoVta = parseIntEnv("BILLING_AFIP_PTO_VTA", 1);
  const cbteTipo = parseIntEnv("BILLING_AFIP_CBTE_TIPO", 6);
  const number = `${now}`;
  return {
    status: "ISSUED",
    externalReference: `MOCK-${chargeId}-${now}`,
    afipPtoVta: ptoVta,
    afipCbteTipo: cbteTipo,
    afipNumber: number,
    afipCae: `MOCKCAE${now}`,
    afipCaeDue: new Date(now + 1000 * 60 * 60 * 24 * 10),
    payload: {
      mock: true,
      amount_ars: amountArs,
    },
  };
}

async function emitWithAfip(params: {
  issuerAgencyId?: number | null;
  amountArsOverride?: number | null;
  charge: {
    id_charge: number;
    id_agency: number;
    amount_ars_paid: unknown;
    amount_ars_due: unknown;
  };
}): Promise<EmitResult> {
  const { charge, issuerAgencyId, amountArsOverride } = params;
  const amountArs = Number(
    amountArsOverride ?? charge.amount_ars_paid ?? charge.amount_ars_due ?? 0,
  );
  if (!Number.isFinite(amountArs) || amountArs <= 0) {
    throw new Error("Monto ARS inválido para emitir comprobante fiscal");
  }

  const effectiveIssuerAgencyId =
    Number.isFinite(Number(issuerAgencyId)) && Number(issuerAgencyId) > 0
      ? Number(issuerAgencyId)
      : charge.id_agency;

  const afip = await getAfipForAgency(effectiveIssuerAgencyId);
  const ptoVta = parseIntEnv("BILLING_AFIP_PTO_VTA", 1);
  const cbteTipo = parseIntEnv("BILLING_AFIP_CBTE_TIPO", 6); // Factura B

  const lastVoucher = await afip.ElectronicBilling.getLastVoucher(ptoVta, cbteTipo);
  const nextVoucher = Number(lastVoucher || 0) + 1;

  const todayKey = toDateKeyInBuenosAires(new Date());
  if (!todayKey) throw new Error("No se pudo resolver fecha local para AFIP");
  const cbteFch = todayKey.replace(/-/g, "");

  const payload = {
    CantReg: 1,
    PtoVta: ptoVta,
    CbteTipo: cbteTipo,
    Concepto: 1,
    DocTipo: 99,
    DocNro: 0,
    CbteDesde: nextVoucher,
    CbteHasta: nextVoucher,
    CbteFch: cbteFch,
    ImpTotal: amountArs,
    ImpTotConc: 0,
    ImpNeto: amountArs,
    ImpOpEx: 0,
    ImpIVA: 0,
    ImpTrib: 0,
    MonId: "PES",
    MonCotiz: 1,
    Iva: [],
  };

  const created = await afip.ElectronicBilling.createVoucher(payload);
  const cae = created?.CAE ? String(created.CAE) : undefined;
  const payloadJson = JSON.parse(
    JSON.stringify({
      request: payload,
      response: created,
      metadata: {
        issuer_agency_id: effectiveIssuerAgencyId,
      },
    }),
  ) as Prisma.InputJsonValue;

  return {
    status: "ISSUED",
    externalReference: `AFIP-${ptoVta}-${cbteTipo}-${nextVoucher}`,
    afipPtoVta: ptoVta,
    afipCbteTipo: cbteTipo,
    afipNumber: String(nextVoucher),
    afipCae: cae,
    payload: payloadJson,
  };
}

export async function issueFiscalForCharge(
  input: IssueFiscalInput,
): Promise<IssueFiscalResult> {
  const documentType = resolveDocumentType(input.documentType);

  const charge = await prisma.agencyBillingCharge.findUnique({
    where: { id_charge: input.chargeId },
    select: {
      id_charge: true,
      id_agency: true,
      status: true,
      amount_ars_due: true,
      amount_ars_paid: true,
      paid_at: true,
    },
  });

  if (!charge) {
    throw new Error("Charge no encontrado");
  }

  const existing = await prisma.agencyBillingFiscalDocument.findUnique({
    where: {
      agency_billing_fiscal_unique: {
        charge_id: charge.id_charge,
        document_type: documentType,
      },
    },
  });

  if (existing?.status === "ISSUED" && !input.forceRetry) {
    return {
      ok: true,
      documentId: existing.id_fiscal_document,
      status: "ISSUED",
      message: "Comprobante fiscal ya emitido",
    };
  }

  const fiscalDoc = await prisma.agencyBillingFiscalDocument.upsert({
    where: {
      agency_billing_fiscal_unique: {
        charge_id: charge.id_charge,
        document_type: documentType,
      },
    },
    create: {
      charge_id: charge.id_charge,
      document_type: documentType,
      status: "PENDING",
      retry_count: 0,
    },
    update: {
      status: "PENDING",
      retry_count: {
        increment: existing ? 1 : 0,
      },
      error_message: null,
    },
  });

  try {
    const amountArs = Number(
      input.amountArsOverride ?? charge.amount_ars_paid ?? charge.amount_ars_due ?? 0,
    );
    const emitted = shouldMockFiscalIssue()
      ? await emitMock(charge.id_charge, amountArs)
      : await emitWithAfip({
          charge,
          issuerAgencyId: input.issuerAgencyId,
          amountArsOverride: input.amountArsOverride,
        });

    const updated = await prisma.agencyBillingFiscalDocument.update({
      where: { id_fiscal_document: fiscalDoc.id_fiscal_document },
      data: {
        status: emitted.status,
        external_reference: emitted.externalReference,
        afip_pto_vta: emitted.afipPtoVta,
        afip_cbte_tipo: emitted.afipCbteTipo,
        afip_number: emitted.afipNumber,
        afip_cae: emitted.afipCae ?? null,
        afip_cae_due: emitted.afipCaeDue ?? null,
        payload: emitted.payload as Prisma.InputJsonValue | undefined,
        error_message: null,
        issued_at: new Date(),
      },
    });

    await logBillingEvent({
      id_agency: charge.id_agency,
      subscription_id: null,
      event_type: "FISCAL_DOCUMENT_ISSUED",
      payload: {
        charge_id: charge.id_charge,
        fiscal_document_id: updated.id_fiscal_document,
        document_type: documentType,
        external_reference: updated.external_reference,
      },
      created_by: input.actorUserId ?? null,
    });

    return {
      ok: true,
      documentId: updated.id_fiscal_document,
      status: "ISSUED",
      message: "Comprobante fiscal emitido",
    };
  } catch (error) {
    const message = normalizeError(error);

    const updated = await prisma.agencyBillingFiscalDocument.update({
      where: { id_fiscal_document: fiscalDoc.id_fiscal_document },
      data: {
        status: "FAILED",
        error_message: message,
      },
    });

    await logBillingEvent({
      id_agency: charge.id_agency,
      subscription_id: null,
      event_type: "FISCAL_DOCUMENT_FAILED",
      payload: {
        charge_id: charge.id_charge,
        fiscal_document_id: updated.id_fiscal_document,
        document_type: documentType,
        error: message,
      },
      created_by: input.actorUserId ?? null,
    });

    return {
      ok: false,
      documentId: updated.id_fiscal_document,
      status: "FAILED",
      message,
    };
  }
}
