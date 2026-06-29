import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { jwtVerify, type JWTPayload } from "jose";
import { renderToStream } from "@react-pdf/renderer";
import InvoiceDocument, {
  type VoucherData,
} from "@/services/invoices/InvoiceDocument";

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
type JsonRecord = Record<string, unknown>;

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

async function requireDeveloper(req: NextApiRequest): Promise<void> {
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

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPositiveNumber(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n != null && n > 0 ? n : null;
}

function normalizeCurrencyCode(value: unknown): string {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!code) return "ARS";
  if (code === "PES") return "ARS";
  if (code === "DOL" || code === "U$S") return "USD";
  return code;
}

function afipDateKey(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10).replace(/-/g, "");
  }
  const raw = String(value ?? "").trim();
  if (/^\d{8}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10).replace(/-/g, "");
  const parsed = raw ? new Date(raw) : null;
  if (parsed && Number.isFinite(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10).replace(/-/g, "");
  }
  return "";
}

function fallbackCaeDue(issueDate: unknown): string {
  const key = afipDateKey(issueDate);
  if (!key) return "";
  const base = new Date(
    Number(key.slice(0, 4)),
    Number(key.slice(4, 6)) - 1,
    Number(key.slice(6, 8)),
  );
  base.setDate(base.getDate() + 10);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatVoucherFilePart(
  ptoVta: number,
  number: number | string,
): string {
  return `${String(ptoVta || 0).padStart(5, "0")}-${String(number || "").padStart(8, "0")}`;
}

async function fetchLogoFromUrl(
  url?: string | null,
): Promise<{ base64: string; mime: string } | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    let mime = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (!mime) {
      const u = url.toLowerCase();
      if (u.endsWith(".jpg") || u.endsWith(".jpeg")) mime = "image/jpeg";
      else if (u.endsWith(".png")) mime = "image/png";
      else if (u.endsWith(".webp")) mime = "image/webp";
      else mime = "image/png";
    }
    return { base64: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

async function resolveMupuFiscalAgency(): Promise<{
  id_agency: number;
  name: string | null;
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  logo_url: string | null;
} | null> {
  const fromEnv = Number.parseInt(
    String(
      process.env.BILLING_FISCAL_MUPU_ISSUER_AGENCY_ID ||
        process.env.BILLING_FISCAL_ISSUER_AGENCY_ID ||
        "",
    ),
    10,
  );

  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    const byId = await prisma.agency.findUnique({
      where: { id_agency: fromEnv },
      select: {
        id_agency: true,
        name: true,
        legal_name: true,
        tax_id: true,
        address: true,
        logo_url: true,
      },
    });
    if (byId?.id_agency) return byId;
  }

  return prisma.agency.findFirst({
    where: {
      OR: [
        { name: { contains: "mupu", mode: "insensitive" } },
        { legal_name: { contains: "mupu", mode: "insensitive" } },
      ],
    },
    select: {
      id_agency: true,
      name: true,
      legal_name: true,
      tax_id: true,
      address: true,
      logo_url: true,
    },
    orderBy: { id_agency: "asc" },
  });
}

function buildChargeConcept(charge: {
  charge_kind?: string | null;
  label?: string | null;
  period_start?: Date | null;
  period_end?: Date | null;
}): string {
  const base =
    charge.label?.trim() ||
    (charge.charge_kind === "EXTRA" ? "Cobro extra" : "Servicio Ofistur");
  if (charge.charge_kind === "EXTRA") return base;
  const date = charge.period_start ?? charge.period_end;
  if (!date) return base;
  const period = date.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
  return `${base} - ${period}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", ["GET"]);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    await requireDeveloper(req);

    const id_agency = parseAgencyId(req.query.id);
    const id_charge = parseChargeId(req.query.chargeId);
    const billingOwnerId = await resolveBillingOwnerId(id_agency);

    const charge = await prisma.agencyBillingCharge.findUnique({
      where: { id_charge },
      select: {
        id_charge: true,
        agency_billing_charge_id: true,
        id_agency: true,
        charge_kind: true,
        label: true,
        period_start: true,
        period_end: true,
        total_usd: true,
        paid_amount: true,
        amount_ars_due: true,
        amount_ars_paid: true,
        fiscalDocuments: {
          orderBy: [{ issued_at: "desc" }, { created_at: "desc" }],
          take: 1,
          select: {
            id_fiscal_document: true,
            document_type: true,
            status: true,
            afip_pto_vta: true,
            afip_cbte_tipo: true,
            afip_number: true,
            afip_cae: true,
            afip_cae_due: true,
            payload: true,
            issued_at: true,
          },
        },
      },
    });

    if (!charge || charge.id_agency !== billingOwnerId) {
      return res.status(404).json({ error: "Cobro no encontrado" });
    }

    const fiscalDoc = charge.fiscalDocuments[0] ?? null;
    if (!fiscalDoc || fiscalDoc.status !== "ISSUED") {
      return res.status(409).json({
        error: "La factura AFIP todavia no esta emitida para este cobro.",
      });
    }

    const [mupuFiscalAgency, recipientAgency] = await Promise.all([
      resolveMupuFiscalAgency(),
      prisma.agency.findUnique({
        where: { id_agency },
        select: {
          id_agency: true,
          name: true,
          legal_name: true,
          tax_id: true,
          address: true,
        },
      }),
    ]);

    if (!recipientAgency) {
      return res.status(400).json({
        error: "No encontramos la agencia receptora de la factura.",
      });
    }

    const payload = asRecord(fiscalDoc.payload);
    const request = asRecord(payload.request);
    const response = asRecord(payload.response);

    const cbteTipo =
      toPositiveNumber(fiscalDoc.afip_cbte_tipo) ??
      toPositiveNumber(request.CbteTipo) ??
      6;
    const ptoVta =
      toPositiveNumber(fiscalDoc.afip_pto_vta) ??
      toPositiveNumber(request.PtoVta) ??
      1;
    const cbteDesde =
      toPositiveNumber(fiscalDoc.afip_number) ??
      toPositiveNumber(request.CbteDesde) ??
      charge.agency_billing_charge_id ??
      charge.id_charge;
    const issueDate =
      afipDateKey(request.CbteFch) || afipDateKey(fiscalDoc.issued_at) || "";
    const impTotal =
      toFiniteNumber(request.ImpTotal) ??
      toPositiveNumber(charge.amount_ars_paid) ??
      toPositiveNumber(charge.amount_ars_due) ??
      toPositiveNumber(charge.paid_amount) ??
      toPositiveNumber(charge.total_usd) ??
      0;
    const impNeto = toFiniteNumber(request.ImpNeto) ?? 0;
    const impIva = toFiniteNumber(request.ImpIVA) ?? 0;
    const impTotConc = toFiniteNumber(request.ImpTotConc) ?? 0;
    const impOpEx = toFiniteNumber(request.ImpOpEx) ?? 0;
    const impOtrosTributos =
      toFiniteNumber(request.ImpOtrosTributos) ??
      toFiniteNumber(request.ImpTrib) ??
      0;
    const iva = Array.isArray(request.Iva)
      ? (request.Iva as VoucherData["Iva"])
      : [];
    const cae = fiscalDoc.afip_cae || String(response.CAE || "");
    const caeDue =
      afipDateKey(fiscalDoc.afip_cae_due) ||
      afipDateKey(response.CAEFchVto) ||
      fallbackCaeDue(issueDate);
    const monId = String(request.MonId || "PES");
    const currency = normalizeCurrencyCode(monId);
    const concept = buildChargeConcept(charge);

    const voucherData: VoucherData = {
      CbteTipo: cbteTipo,
      PtoVta: ptoVta,
      CbteDesde: cbteDesde,
      CbteFch: issueDate || fiscalDoc.issued_at || new Date(),
      ImpTotal: impTotal,
      ImpNeto: impNeto,
      ImpIVA: impIva,
      ImpTotConc: impTotConc,
      ImpOpEx: impOpEx,
      ImpOtrosTributos: impOtrosTributos,
      MonId: monId,
      MonCotiz: toFiniteNumber(request.MonCotiz) ?? 1,
      CAE: cae,
      CAEFchVto: caeDue,
      DocNro:
        toFiniteNumber(request.DocNro) ??
        toPositiveNumber(recipientAgency.tax_id?.replace(/\D/g, "")) ??
        0,
      Iva: iva,
      recipient:
        recipientAgency.legal_name || recipientAgency.name || "Agencia",
      recipientAddress: recipientAgency.address || undefined,
      recipientCondIVA: cbteTipo === 1 ? "Responsable Inscripto" : undefined,
      emitterName:
        mupuFiscalAgency?.name || mupuFiscalAgency?.legal_name || "MUPU",
      emitterLegalName:
        mupuFiscalAgency?.legal_name || mupuFiscalAgency?.name || "MUPU",
      emitterTaxId: mupuFiscalAgency?.tax_id || undefined,
      emitterAddress: mupuFiscalAgency?.address || undefined,
      customItems: [
        {
          description: concept,
          taxCategory: impIva > 0 ? "21" : "EXEMPT",
          amount: impTotal,
        },
      ],
    };

    let logoBase64: string | undefined;
    let logoMime: string | undefined;
    const fetched = await fetchLogoFromUrl(mupuFiscalAgency?.logo_url);
    if (fetched) {
      logoBase64 = fetched.base64;
      logoMime = fetched.mime;
    } else {
      const fallback = path.join(process.cwd(), "public", "logo.png");
      if (fs.existsSync(fallback)) {
        logoBase64 = fs.readFileSync(fallback).toString("base64");
        logoMime = "image/png";
      }
    }

    const stream = await renderToStream(
      <InvoiceDocument
        voucherData={voucherData}
        currency={currency}
        logoBase64={logoBase64}
        logoMime={logoMime}
      />,
    );

    const safeNumber = formatVoucherFilePart(ptoVta, cbteDesde);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=factura_afip_${safeNumber}.pdf`,
    );
    stream.pipe(res);
  } catch (e) {
    const err = e as AppError;
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Error generando factura AFIP";
    return res.status(status).json({ error: message });
  }
}
