import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { issueFiscalForCharge } from "@/services/collections/fiscal/issueOnPaid";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  email?: string;
};

type AppError = Error & { status?: number };

function httpError(status: number, message: string): AppError {
  const err = new Error(message) as AppError;
  err.status = status;
  return err;
}

function normalizeRole(r?: string) {
  return (r ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    const v = req.cookies?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function requireDeveloper(req: NextApiRequest): Promise<{
  id_user: number;
  email?: string;
}> {
  const token = getTokenFromRequest(req);
  if (!token) throw httpError(401, "No autenticado");

  const { payload } = await jwtVerify(
    token,
    new TextEncoder().encode(JWT_SECRET),
  );
  const p = payload as TokenPayload;
  const id_user = Number(p.id_user ?? p.userId ?? p.uid) || 0;
  const role = normalizeRole(p.role);

  if (!id_user || role !== "desarrollador") {
    throw httpError(403, "No autorizado");
  }
  return { id_user, email: p.email };
}

function parseAgencyId(param: unknown): number {
  const raw = Array.isArray(param) ? param[0] : param;
  const id = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0)
    throw httpError(400, "ID de agencia invalido");
  return id;
}

function parseChargeId(param: unknown): number {
  const raw = Array.isArray(param) ? param[0] : param;
  const id = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, "ID invalido");
  return id;
}

async function resolveBillingOwnerId(id_agency: number): Promise<number> {
  const agency = await prisma.agency.findUnique({
    where: { id_agency },
    select: { id_agency: true, billing_owner_agency_id: true },
  });
  if (!agency) throw httpError(404, "Agencia no encontrada");
  return agency.billing_owner_agency_id ?? agency.id_agency;
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function resolveLatestBspRate(): Promise<number | null> {
  const latest = await prisma.billingFxRate.findFirst({
    orderBy: [{ rate_date: "desc" }, { id_fx_rate: "desc" }],
    select: { ars_per_usd: true },
  });
  return toPositiveNumber(latest?.ars_per_usd);
}

async function resolveMupuIssuerAgencyId(): Promise<number> {
  const fromEnv = Number.parseInt(
    String(
      process.env.BILLING_FISCAL_MUPU_ISSUER_AGENCY_ID ||
        process.env.BILLING_FISCAL_ISSUER_AGENCY_ID ||
        "",
    ),
    10,
  );
  const preferredIssuerId =
    Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 1; // Mupu Viajes

  const preferredAgency = await prisma.agency.findUnique({
    where: { id_agency: preferredIssuerId },
    select: { id_agency: true },
  });
  if (preferredAgency?.id_agency) return preferredAgency.id_agency;

  const mupuByName = await prisma.agency.findFirst({
    where: {
      OR: [
        { name: { contains: "mupu", mode: "insensitive" } },
        { legal_name: { contains: "mupu", mode: "insensitive" } },
      ],
    },
    select: { id_agency: true },
    orderBy: { id_agency: "asc" },
  });
  if (mupuByName?.id_agency) return mupuByName.id_agency;

  throw httpError(
    400,
    "No se pudo resolver la agencia emisora fiscal de Mupu. Configura BILLING_FISCAL_MUPU_ISSUER_AGENCY_ID.",
  );
}

async function computeChargeAmountArs(charge: {
  amount_ars_paid: unknown;
  amount_ars_due: unknown;
  paid_amount: unknown;
  paid_currency: string | null;
  fx_rate: unknown;
  total_usd: unknown;
}): Promise<{ amountArs: number | null; fxUsed: number | null }> {
  const alreadyPaid = toPositiveNumber(charge.amount_ars_paid);
  if (alreadyPaid) return { amountArs: alreadyPaid, fxUsed: null };

  const alreadyDue = toPositiveNumber(charge.amount_ars_due);
  if (alreadyDue) return { amountArs: alreadyDue, fxUsed: null };

  const paidAmount = toPositiveNumber(charge.paid_amount);
  const totalUsd = toPositiveNumber(charge.total_usd);
  const paidCurrency = String(charge.paid_currency || "")
    .trim()
    .toUpperCase();
  const chargeFx = toPositiveNumber(charge.fx_rate);
  const fallbackFx = chargeFx ?? (await resolveLatestBspRate());

  if (paidCurrency === "ARS" && paidAmount) {
    return { amountArs: Number(paidAmount.toFixed(2)), fxUsed: null };
  }

  if (paidCurrency === "USD" && paidAmount && fallbackFx) {
    return {
      amountArs: Number((paidAmount * fallbackFx).toFixed(2)),
      fxUsed: fallbackFx,
    };
  }

  if (totalUsd && fallbackFx) {
    return {
      amountArs: Number((totalUsd * fallbackFx).toFixed(2)),
      fxUsed: fallbackFx,
    };
  }

  return { amountArs: null, fxUsed: fallbackFx ?? null };
}

const BodySchema = z
  .object({
    documentType: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : undefined)),
    forceRetry: z.boolean().optional(),
    issuerAgencyId: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

async function handlePOST(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireDeveloper(req);
  const id_agency = parseAgencyId(req.query.id);
  const billingOwnerId = await resolveBillingOwnerId(id_agency);
  const id_charge = parseChargeId(req.query.chargeId);

  const parsed = BodySchema.parse(req.body ?? {});

  const charge = await prisma.agencyBillingCharge.findUnique({
    where: { id_charge },
    select: {
      id_charge: true,
      id_agency: true,
      status: true,
      paid_at: true,
      paid_amount: true,
      paid_currency: true,
      fx_rate: true,
      total_usd: true,
      amount_ars_due: true,
      amount_ars_paid: true,
    },
  });
  if (!charge || charge.id_agency !== billingOwnerId) {
    return res.status(404).json({ error: "Cobro no encontrado" });
  }

  const resolved = await computeChargeAmountArs(charge);
  if (!resolved.amountArs) {
    return res.status(400).json({
      error:
        "No se pudo determinar un monto en ARS para emitir AFIP. Completá pago en ARS o informá cotización.",
    });
  }

  const updateData: Record<string, unknown> = {};
  if (!toPositiveNumber(charge.amount_ars_due)) {
    updateData.amount_ars_due = resolved.amountArs;
  }
  const shouldSetPaidArs =
    !toPositiveNumber(charge.amount_ars_paid) &&
    (charge.status === "PAID" ||
      charge.paid_at != null ||
      toPositiveNumber(charge.paid_amount) != null);
  if (shouldSetPaidArs) {
    updateData.amount_ars_paid = resolved.amountArs;
  }
  if (Object.keys(updateData).length > 0) {
    await prisma.agencyBillingCharge.update({
      where: { id_charge: charge.id_charge },
      data: updateData,
    });
  }

  const issuerAgencyId = await resolveMupuIssuerAgencyId();

  const result = await issueFiscalForCharge({
    chargeId: charge.id_charge,
    documentType: parsed.documentType,
    forceRetry: parsed.forceRetry ?? false,
    actorUserId: auth.id_user,
    issuerAgencyId,
    amountArsOverride: resolved.amountArs,
  });

  const fiscalDocument = await prisma.agencyBillingFiscalDocument.findFirst({
    where: { charge_id: charge.id_charge },
    orderBy: [{ updated_at: "desc" }, { id_fiscal_document: "desc" }],
    select: {
      id_fiscal_document: true,
      document_type: true,
      status: true,
      afip_pto_vta: true,
      afip_cbte_tipo: true,
      afip_number: true,
      afip_cae: true,
      afip_cae_due: true,
      issued_at: true,
      error_message: true,
      retry_count: true,
    },
  });

  return res.status(result.ok ? 200 : 400).json({
    ...result,
    issuerAgencyId,
    amount_ars: resolved.amountArs,
    fx_used: resolved.fxUsed,
    fiscal_document: fiscalDocument,
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
    return await handlePOST(req, res);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: e.issues?.[0]?.message || "Datos invalidos" });
    }
    const err = e as AppError;
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Error";
    return res.status(status).json({ error: message });
  }
}
