// src/pages/api/dev/agencies/[id]/billing/charges/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";

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

async function resolveBillingOwnerId(id_agency: number): Promise<number> {
  const agency = await prisma.agency.findUnique({
    where: { id_agency },
    select: { id_agency: true, billing_owner_agency_id: true },
  });
  if (!agency) throw httpError(404, "Agencia no encontrada");
  return agency.billing_owner_agency_id ?? agency.id_agency;
}

function toDate(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const decimalInput = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "string") return Number(v);
  return v;
}, z.number().finite());

const ChargeKindSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.trim().toUpperCase() : "RECURRING"))
  .refine((v) => v === "RECURRING" || v === "EXTRA", "Tipo de cobro invalido");

const ChargeSchema = z
  .object({
    period_start: z.union([z.string(), z.date(), z.null(), z.undefined()]),
    period_end: z.union([z.string(), z.date(), z.null(), z.undefined()]),
    due_date: z.union([z.string(), z.date(), z.null(), z.undefined()]),
    status: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim().toUpperCase() : "PENDING")),
    charge_kind: ChargeKindSchema,
    label: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : undefined)),
    base_amount_usd: decimalInput,
    adjustments_total_usd: decimalInput.optional(),
    total_usd: decimalInput.optional(),
    paid_amount: decimalInput.optional(),
    paid_currency: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim().toUpperCase() : undefined)),
    fx_rate: decimalInput.optional(),
    paid_at: z.union([z.string(), z.date(), z.null(), z.undefined()]),
    account: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : undefined)),
    payment_method: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : undefined)),
    notes: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : undefined)),
  })
  .strict();

type FiscalDocLike = {
  id_fiscal_document: number;
  document_type: string;
  status: string;
  afip_pto_vta: number | null;
  afip_cbte_tipo: number | null;
  afip_number: string | null;
  afip_cae: string | null;
  issued_at: Date | null;
  error_message: string | null;
  retry_count: number;
};

function serializeCharge(
  item: {
    id_charge: number;
    id_agency: number;
    agency_billing_charge_id: number;
    period_start: Date | null;
    period_end: Date | null;
    due_date: Date | null;
    status: string;
    charge_kind: string;
    label: string | null;
    base_amount_usd: unknown;
    adjustments_total_usd: unknown;
    total_usd: unknown;
    paid_amount: unknown;
    paid_currency: string | null;
    fx_rate: unknown;
    paid_at: Date | null;
    account: string | null;
    payment_method: string | null;
    notes: string | null;
    fiscalDocuments?: FiscalDocLike[];
  },
) {
  const rest = { ...item };
  delete (rest as { fiscalDocuments?: FiscalDocLike[] }).fiscalDocuments;
  const fiscal = Array.isArray(item.fiscalDocuments)
    ? item.fiscalDocuments[0]
    : null;
  return {
    ...rest,
    base_amount_usd: Number(item.base_amount_usd),
    adjustments_total_usd: Number(item.adjustments_total_usd),
    total_usd: Number(item.total_usd),
    paid_amount: item.paid_amount != null ? Number(item.paid_amount) : null,
    fx_rate: item.fx_rate != null ? Number(item.fx_rate) : null,
    fiscal_document: fiscal
      ? {
          id_fiscal_document: fiscal.id_fiscal_document,
          document_type: fiscal.document_type,
          status: fiscal.status,
          afip_pto_vta: fiscal.afip_pto_vta,
          afip_cbte_tipo: fiscal.afip_cbte_tipo,
          afip_number: fiscal.afip_number,
          afip_cae: fiscal.afip_cae,
          issued_at: fiscal.issued_at,
          error_message: fiscal.error_message,
          retry_count: fiscal.retry_count,
        }
      : null,
  };
}

async function handleGET(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);
  const id_agency = parseAgencyId(req.query.id);
  const billingOwnerId = await resolveBillingOwnerId(id_agency);

  const limitRaw = Array.isArray(req.query.limit)
    ? req.query.limit[0]
    : req.query.limit;
  const limit = Math.min(
    50,
    Math.max(5, Number.parseInt(String(limitRaw ?? "20"), 10) || 20),
  );
  const cursorRaw = Array.isArray(req.query.cursor)
    ? req.query.cursor[0]
    : req.query.cursor;
  const cursorId = cursorRaw ? Number.parseInt(String(cursorRaw), 10) : null;

  const list = await prisma.agencyBillingCharge.findMany({
    where: { id_agency: billingOwnerId },
    orderBy: { id_charge: "desc" },
    ...(cursorId ? { cursor: { id_charge: cursorId }, skip: 1 } : undefined),
    take: limit + 1,
    include: {
      fiscalDocuments: {
        select: {
          id_fiscal_document: true,
          document_type: true,
          status: true,
          afip_pto_vta: true,
          afip_cbte_tipo: true,
          afip_number: true,
          afip_cae: true,
          issued_at: true,
          error_message: true,
          retry_count: true,
        },
        orderBy: [{ updated_at: "desc" }, { id_fiscal_document: "desc" }],
        take: 1,
      },
    },
  });

  const normalized = list.map(serializeCharge);

  let nextCursor: number | null = null;
  let items = normalized;
  if (normalized.length > limit) {
    nextCursor = normalized[normalized.length - 1].id_charge;
    items = normalized.slice(0, limit);
  }

  return res.status(200).json({ items, nextCursor });
}

async function handlePOST(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);
  const id_agency = parseAgencyId(req.query.id);
  const billingOwnerId = await resolveBillingOwnerId(id_agency);

  const parsed = ChargeSchema.parse(req.body ?? {});
  const base = Number(parsed.base_amount_usd ?? 0);
  if (!Number.isFinite(base)) {
    return res.status(400).json({ error: "Base invalida" });
  }
  const adjustments = Number(parsed.adjustments_total_usd ?? 0);
  const total = base + adjustments;

  const created = await prisma.$transaction(async (tx) => {
    const agencyChargeId = await getNextAgencyCounter(
      tx,
      billingOwnerId,
      "agency_billing_charge",
    );
    return tx.agencyBillingCharge.create({
      data: {
        id_agency: billingOwnerId,
        agency_billing_charge_id: agencyChargeId,
        period_start: toDate(parsed.period_start),
        period_end: toDate(parsed.period_end),
        due_date: toDate(parsed.due_date),
        status: parsed.status || "PENDING",
        charge_kind: parsed.charge_kind || "RECURRING",
        label: parsed.label ?? null,
        base_amount_usd: base,
        adjustments_total_usd: adjustments,
        total_usd: total,
        paid_amount: parsed.paid_amount ?? null,
        paid_currency: parsed.paid_currency ?? null,
        fx_rate: parsed.fx_rate ?? null,
        paid_at: toDate(parsed.paid_at),
        account: parsed.account ?? null,
        payment_method: parsed.payment_method ?? null,
        notes: parsed.notes ?? null,
      },
    });
  });

  const withFiscal = await prisma.agencyBillingCharge.findUnique({
    where: { id_charge: created.id_charge },
    include: {
      fiscalDocuments: {
        select: {
          id_fiscal_document: true,
          document_type: true,
          status: true,
          afip_pto_vta: true,
          afip_cbte_tipo: true,
          afip_number: true,
          afip_cae: true,
          issued_at: true,
          error_message: true,
          retry_count: true,
        },
        orderBy: [{ updated_at: "desc" }, { id_fiscal_document: "desc" }],
        take: 1,
      },
    },
  });

  return res.status(201).json(
    withFiscal ? serializeCharge(withFiscal) : serializeCharge(created),
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method === "GET") return await handleGET(req, res);
    if (req.method === "POST") {
      try {
        return await handlePOST(req, res);
      } catch (e) {
        if (e instanceof z.ZodError) {
          return res
            .status(400)
            .json({ error: e.issues?.[0]?.message || "Datos invalidos" });
        }
        throw e;
      }
    }
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (e) {
    const err = e as AppError;
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Error";
    return res.status(status).json({ error: message });
  }
}
