import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { jwtVerify, type JWTPayload } from "jose";
import { renderToStream } from "@react-pdf/renderer";
import ReceiptStandaloneDocument from "@/services/receipts/ReceiptStandaloneDocument";
import type { ReceiptPdfPaymentLine } from "@/services/receipts/ReceiptDocument";

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

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeCurrencyCode(value: unknown): string {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!code) return "USD";
  if (code === "DOL") return "USD";
  if (code === "PES") return "ARS";
  return code;
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR");
}

function toMonthLabel(value?: Date | null): string {
  if (!value) return "sin período";
  return value.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
}

function buildAmountString(amount: number, currency: string): string {
  const formatted = formatMoney(amount, currency);
  return `COBRO REGISTRADO POR ${formatted}`.toUpperCase();
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

async function resolveOfisturBrandAgency(): Promise<{
  id_agency: number;
  name: string | null;
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  logo_url: string | null;
} | null> {
  const fromEnv = Number.parseInt(
    String(
      process.env.BILLING_RECEIPT_BRAND_AGENCY_ID ||
        process.env.BILLING_RECEIPT_ISSUER_AGENCY_ID ||
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
        { name: { contains: "ofistur", mode: "insensitive" } },
        { legal_name: { contains: "ofistur", mode: "insensitive" } },
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

async function resolveMupuFiscalAgency(): Promise<{
  id_agency: number;
  name: string | null;
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
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
    },
    orderBy: { id_agency: "asc" },
  });
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
        paid_currency: true,
        fx_rate: true,
        paid_at: true,
        payment_method: true,
        account: true,
      },
    });

    if (!charge || charge.id_agency !== billingOwnerId) {
      return res.status(404).json({ error: "Cobro no encontrado" });
    }

    const [ofisturBrandAgency, mupuFiscalAgency, recipientAgency] =
      await Promise.all([
        resolveOfisturBrandAgency(),
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
      return res
        .status(400)
        .json({ error: "No encontramos la agencia receptora del recibo." });
    }

    let logoBase64: string | undefined;
    let logoMime: string | undefined;
    const fetched = await fetchLogoFromUrl(ofisturBrandAgency?.logo_url);
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

    const amountCurrency = normalizeCurrencyCode(
      charge.paid_currency || "USD",
    );
    const amount =
      toPositiveNumber(charge.paid_amount) ??
      toPositiveNumber(charge.total_usd) ??
      0;
    const issueDate = charge.paid_at ?? new Date();
    const periodLabel =
      charge.charge_kind === "EXTRA"
        ? "cargo extraordinario"
        : `periodo ${toMonthLabel(charge.period_start ?? charge.period_end)}`;
    const conceptBase =
      charge.label?.trim() ||
      (charge.charge_kind === "EXTRA" ? "Cobro extra" : "Cobro mensual");
    const concept = `${conceptBase} (${periodLabel})`;

    const payments: ReceiptPdfPaymentLine[] = [
      {
        amount,
        payment_method_id: null,
        account_id: null,
        payment_currency: amountCurrency,
        paymentMethodName: charge.payment_method || "Transferencia",
        accountName: charge.account || "Cuenta corriente",
      },
    ];

    const paymentDescriptionParts = [
      charge.payment_method ? `Metodo: ${charge.payment_method}` : null,
      charge.account ? `Cuenta: ${charge.account}` : null,
      charge.fx_rate ? `Cotizacion: ${Number(charge.fx_rate).toFixed(4)}` : null,
      `Fecha de pago: ${formatDate(charge.paid_at ?? issueDate)}`,
    ].filter(Boolean);

    const document = (
      <ReceiptStandaloneDocument
        receiptNumber={`C-${charge.agency_billing_charge_id}`}
        issueDate={issueDate}
        concept={concept}
        amount={amount}
        amountString={buildAmountString(amount, amountCurrency)}
        amountCurrency={amountCurrency}
        paymentDescription={paymentDescriptionParts.join(" · ")}
        payments={payments}
        agency={{
          name: "Ofistur",
          legalName:
            mupuFiscalAgency?.legal_name ||
            mupuFiscalAgency?.name ||
            ofisturBrandAgency?.legal_name ||
            ofisturBrandAgency?.name ||
            "Ofistur",
          taxId: mupuFiscalAgency?.tax_id || ofisturBrandAgency?.tax_id || "-",
          address:
            mupuFiscalAgency?.address || ofisturBrandAgency?.address || "-",
          logoBase64,
          logoMime,
        }}
        recipients={[
          {
            firstName: "",
            lastName: "",
            companyName:
              recipientAgency.legal_name || recipientAgency.name || "Agencia",
            dni: recipientAgency.tax_id || "-",
            address: recipientAgency.address || "-",
            locality: "",
          },
        ]}
      />
    );

    const stream = await renderToStream(document);
    const safeNumber = String(charge.agency_billing_charge_id || charge.id_charge);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=recibo_cobro_${safeNumber}.pdf`,
    );
    stream.pipe(res);
  } catch (e) {
    const err = e as AppError;
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Error generando recibo";
    return res.status(status).json({ error: message });
  }
}
