// src/pages/api/receipts/[id]/pdf.tsx
import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient, Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";
import { renderToStream } from "@react-pdf/renderer";
import ReceiptDocument, {
  ReceiptPdfData,
  ReceiptPdfPaymentLine,
} from "@/services/receipts/ReceiptDocument";
import ReceiptStandaloneDocument, {
  ReceiptStandalonePdfData,
} from "@/services/receipts/ReceiptStandaloneDocument";
import { decodePublicId } from "@/lib/publicIds";
import { jwtVerify, type JWTPayload } from "jose";
import { hasSchemaColumn } from "@/lib/schemaColumns";

type PdfPaymentRaw = {
  amount: number;
  payment_method_id: number | null;
  account_id: number | null;
  payment_currency?: string | null;
  fee_mode?: "FIXED" | "PERCENT" | null;
  fee_value?: number | null;
  fee_amount?: number | null;
  payment_method_text?: string;
  account_text?: string;
};

type ReceiptWithRelations = Prisma.ReceiptGetPayload<{
  include: {
    payments: true;
    booking: {
      include: { titular: true; agency: true; services: true; clients: true };
    };
    agency: true;
  };
}>; 

type ReceiptSchemaFlags = {
  hasPaymentLines: boolean;
  hasPaymentCurrency: boolean;
  hasPaymentFeeMode: boolean;
  hasPaymentFeeValue: boolean;
  hasPaymentFeeAmount: boolean;
};

async function getReceiptSchemaFlags(): Promise<ReceiptSchemaFlags> {
  const [
    hasPaymentLines,
    hasPaymentCurrency,
    hasPaymentFeeMode,
    hasPaymentFeeValue,
    hasPaymentFeeAmount,
  ] = await Promise.all([
    hasSchemaColumn("ReceiptPayment", "id_receipt_payment"),
    hasSchemaColumn("ReceiptPayment", "payment_currency"),
    hasSchemaColumn("ReceiptPayment", "fee_mode"),
    hasSchemaColumn("ReceiptPayment", "fee_value"),
    hasSchemaColumn("ReceiptPayment", "fee_amount"),
  ]);

  return {
    hasPaymentLines,
    hasPaymentCurrency,
    hasPaymentFeeMode,
    hasPaymentFeeValue,
    hasPaymentFeeAmount,
  };
}

function buildReceiptPaymentSelect(
  flags: ReceiptSchemaFlags,
): Prisma.ReceiptPaymentSelect {
  return {
    amount: true,
    payment_method_id: true,
    account_id: true,
    ...(flags.hasPaymentCurrency ? { payment_currency: true } : {}),
    ...(flags.hasPaymentFeeMode ? { fee_mode: true } : {}),
    ...(flags.hasPaymentFeeValue ? { fee_value: true } : {}),
    ...(flags.hasPaymentFeeAmount ? { fee_amount: true } : {}),
  };
}

type AgencyExtras = {
  id_agency?: number | null;
  logo_url?: string | null;
  slug?: string | null;
  logo_filename?: string | null;

  // 👇 campos que venías leyendo con (ag as any)
  legal_name?: string | null;
  tax_id?: string | null;
  address?: string | null;
};

type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  email?: string;
};

type DecodedUser = {
  id_user?: number;
  role?: string;
  id_agency?: number;
  email?: string;
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const c = req.cookies || {};
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    if (c[k]) return c[k]!;
  }
  return null;
}

async function getUserFromAuth(
  req: NextApiRequest,
): Promise<DecodedUser | null> {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return null;
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || undefined;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    const role = p.role;
    const email = p.email;

    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role,
          email: u.email,
        };
    }
    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user,
          id_agency: u.id_agency,
          role: role ?? u.role,
          email: email ?? u.email ?? undefined,
        };
    }
    return { id_user, id_agency, role, email };
  } catch {
    return null;
  }
}

const toNum = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  const s = (v as { toString?: () => string })?.toString?.();
  const n = Number(s ?? NaN);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeCurrency = (value: unknown): string => {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) return "ARS";
  if (["US$", "U$S", "U$D", "DOL"].includes(code)) return "USD";
  if (["$", "AR$"].includes(code)) return "ARS";
  return code;
};

const normalizeFeeMode = (
  value: unknown,
): "FIXED" | "PERCENT" | null => {
  if (typeof value !== "string") return null;
  const mode = value.trim().toUpperCase();
  if (mode === "FIXED" || mode === "PERCENT") return mode;
  return null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function normalizePayments(receipt: ReceiptWithRelations): PdfPaymentRaw[] {
  const rel = Array.isArray(receipt.payments) ? receipt.payments : [];

  if (rel.length > 0) {
    return rel.map((p) => ({
      amount: toNum(p.amount, 0),
      payment_method_id:
        Number.isFinite(Number(p.payment_method_id)) &&
        Number(p.payment_method_id) > 0
          ? Number(p.payment_method_id)
          : null,
      account_id:
        Number.isFinite(Number(p.account_id)) && Number(p.account_id) > 0
          ? Number(p.account_id)
          : null,
      payment_currency: normalizeCurrency(
        (p as unknown as { payment_currency?: unknown }).payment_currency ??
          receipt.amount_currency,
      ),
      fee_mode: normalizeFeeMode(
        (p as unknown as { fee_mode?: unknown }).fee_mode,
      ),
      fee_value: Number.isFinite(
        toNum((p as unknown as { fee_value?: unknown }).fee_value, NaN),
      )
        ? toNum((p as unknown as { fee_value?: unknown }).fee_value, 0)
        : null,
      fee_amount: Number.isFinite(
        toNum((p as unknown as { fee_amount?: unknown }).fee_amount, NaN),
      )
        ? toNum((p as unknown as { fee_amount?: unknown }).fee_amount, 0)
        : null,
    }));
  }

  // fallback legacy
  const amt = toNum(receipt.amount, 0);
  const pmText = String(
    (receipt as unknown as { payment_method?: unknown })?.payment_method ?? "",
  ).trim();
  const accText = String(
    (receipt as unknown as { account?: unknown })?.account ?? "",
  ).trim();

  const pmId =
    Number.isFinite(
      Number(
        (receipt as unknown as { payment_method_id?: unknown })
          ?.payment_method_id,
      ),
    ) &&
    Number(
      (receipt as unknown as { payment_method_id?: unknown })
        ?.payment_method_id,
    ) > 0
      ? Number(
          (receipt as unknown as { payment_method_id?: unknown })
            ?.payment_method_id,
        )
      : null;

  const accId =
    Number.isFinite(
      Number((receipt as unknown as { account_id?: unknown })?.account_id),
    ) &&
    Number((receipt as unknown as { account_id?: unknown })?.account_id) > 0
      ? Number((receipt as unknown as { account_id?: unknown })?.account_id)
      : null;

  if (Number.isFinite(amt) && (pmText || accText || pmId || accId)) {
    return [
      {
        amount: amt,
        payment_method_id: pmId,
        account_id: accId,
        payment_currency: normalizeCurrency(receipt.amount_currency),
        ...(pmText ? { payment_method_text: pmText } : {}),
        ...(accText ? { account_text: accText } : {}),
      },
    ];
  }

  return [];
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

const prisma = new PrismaClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const authUser = await getUserFromAuth(req);
  const authAgencyId = authUser?.id_agency;
  if (!authUser?.id_user || !authAgencyId) {
    return res.status(401).end("No autenticado");
  }

  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!rawId) return res.status(400).end("ID inválido");
  const rawIdStr = String(rawId);
  const parsedId = Number(rawIdStr);
  const decoded =
    Number.isFinite(parsedId) && parsedId > 0
      ? null
      : decodePublicId(rawIdStr);
  if (decoded && decoded.t !== "receipt") {
    return res.status(400).end("ID inválido");
  }
  if (!decoded && (!Number.isFinite(parsedId) || parsedId <= 0)) {
    return res.status(400).end("ID inválido");
  }

  if (decoded && decoded.a !== authAgencyId) {
    return res.status(403).end("No tenés permisos para descargar este recibo.");
  }

  const schemaFlags = await getReceiptSchemaFlags();

  // 1) Recibo + relaciones
  const receipt = await prisma.receipt.findFirst({
    where: decoded
      ? { id_agency: decoded.a, agency_receipt_id: decoded.i }
      : {
          id_receipt: parsedId,
          OR: [
            { id_agency: authAgencyId },
            { booking: { id_agency: authAgencyId } },
          ],
        },
    include: {
      ...(schemaFlags.hasPaymentLines
        ? { payments: { select: buildReceiptPaymentSelect(schemaFlags) } }
        : {}),
      booking: {
        include: { titular: true, agency: true, services: true, clients: true },
      },
      agency: true,
    },
  });
  if (!receipt) return res.status(404).end("Recibo no encontrado");

  const receiptTyped = receipt as ReceiptWithRelations;
  const agency = (receipt.booking?.agency ?? receipt.agency) as
    | (typeof receipt.agency & AgencyExtras)
    | null;

  const receiptDisplayNumber =
    receipt.agency_receipt_id != null
      ? String(receipt.agency_receipt_id)
      : receipt.receipt_number;

  // 2) Logo multi-agencia
  let logoBase64: string | undefined;
  let logoMime: string | undefined;

  try {
    const fetched = await fetchLogoFromUrl(agency?.logo_url);
    if (fetched) {
      logoBase64 = fetched.base64;
      logoMime = fetched.mime;
    }

    if (!logoBase64) {
      const preferred: string[] = [];
      const slug = agency?.slug ?? undefined;
      const logoFile = agency?.logo_filename ?? undefined;

      if (logoFile) preferred.push(logoFile);
      if (slug) preferred.push(`logo_${slug}.png`);
      if (agency?.id_agency) preferred.push(`logo_ag_${agency.id_agency}.png`);

      for (const fname of preferred) {
        const candidate = path.join(process.cwd(), "public", "agencies", fname);
        if (fs.existsSync(candidate)) {
          logoBase64 = fs.readFileSync(candidate).toString("base64");
          logoMime =
            candidate.toLowerCase().endsWith(".jpg") ||
            candidate.toLowerCase().endsWith(".jpeg")
              ? "image/jpeg"
              : "image/png";
          break;
        }
      }

      if (!logoBase64) {
        const fallback = path.join(process.cwd(), "public", "logo.png");
        if (fs.existsSync(fallback)) {
          logoBase64 = fs.readFileSync(fallback).toString("base64");
          logoMime = "image/png";
        }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("⚠️ Error obteniendo logo de agencia:", e);
  }

  // 3) Servicios seleccionados (si hay booking)
  const bookingServices = receipt.booking?.services ?? [];
  const selectedServices = bookingServices.filter((s) =>
    (receipt.serviceIds ?? []).includes(s.id_service),
  );

  // 4) Destinatarios
  const rawClients = receipt.clientIds?.length
    ? await prisma.client.findMany({
        where: { id_client: { in: receipt.clientIds } },
      })
    : [];
  const recipientsArr = rawClients.length
    ? rawClients
    : receipt.booking
      ? [receipt.booking.titular]
      : [];

  // 5) Pagos normalizados (soporta viejos y nuevos)
  const paymentsRaw = normalizePayments(receipt);

  // 5b) Lookup nombres (si hay IDs)
  const agencyId =
    agency?.id_agency ??
    receipt.id_agency ??
    receipt.booking?.id_agency ??
    null;

  const methodIds = Array.from(
    new Set(
      paymentsRaw
        .map((p) => p.payment_method_id)
        .filter((x): x is number => typeof x === "number" && x > 0),
    ),
  );

  const accountIds = Array.from(
    new Set(
      paymentsRaw
        .map((p) => p.account_id)
        .filter((x): x is number => typeof x === "number" && x > 0),
    ),
  );

  const methods =
    agencyId && methodIds.length
      ? await prisma.financePaymentMethod.findMany({
          where: { id_agency: Number(agencyId), id_method: { in: methodIds } },
          select: { id_method: true, name: true },
        })
      : [];

  const accounts =
    agencyId && accountIds.length
      ? await prisma.financeAccount.findMany({
          where: {
            id_agency: Number(agencyId),
            id_account: { in: accountIds },
          },
          select: { id_account: true, name: true },
        })
      : [];

  const methodNameById = new Map(methods.map((m) => [m.id_method, m.name]));
  const accountNameById = new Map(accounts.map((a) => [a.id_account, a.name]));

  const payments: ReceiptPdfPaymentLine[] = paymentsRaw.map((p) => ({
    amount: p.amount,
    payment_method_id: p.payment_method_id,
    account_id: p.account_id,
    payment_currency: p.payment_currency ?? receipt.amount_currency,
    fee_mode: p.fee_mode ?? null,
    fee_value: p.fee_value ?? null,
    fee_amount: p.fee_amount ?? null,
    paymentMethodName:
      (p.payment_method_id
        ? methodNameById.get(p.payment_method_id)
        : undefined) ??
      p.payment_method_text ??
      undefined,
    accountName:
      (p.account_id ? accountNameById.get(p.account_id) : undefined) ??
      p.account_text ??
      undefined,
  }));
  const paymentFeeAmountTotal =
    receiptTyped.payment_fee_amount != null
      ? toNum(receiptTyped.payment_fee_amount, 0)
      : round2(
          payments.reduce((acc, p) => acc + (toNum(p.fee_amount, 0) || 0), 0),
        );

  // 6) Armar datos para el PDF
  const ag = (receiptTyped.booking?.agency ?? receiptTyped.agency) as
    | (typeof receiptTyped.agency & AgencyExtras)
    | null;

  const agencyInfo = {
    name: ag?.name ?? "-",
    legalName: ag?.legal_name ?? ag?.name ?? "-",
    taxId: ag?.tax_id ?? "-",
    address: ag?.address ?? "-",
    logoBase64,
    logoMime,
  };

  const recipients = recipientsArr.map((c) => ({
    firstName: c.first_name,
    lastName: c.last_name,
    dni: c.dni_number ?? "-",
    address: c.address ?? "-",
    locality: c.locality ?? "-",
    companyName: c.company_name ?? undefined,
  }));

  const hasBooking = !!receipt.booking?.id_booking;
  const safeReceiptLabel = receiptDisplayNumber.replace(
    /[^a-zA-Z0-9_-]+/g,
    "_",
  );

  // 6) Armar datos para el PDF
  const data: ReceiptPdfData = {
    receiptNumber: receiptDisplayNumber,
    issueDate: receipt.issue_date ?? new Date(),
    concept: receipt.concept,
    amount: Number(receipt.amount),
    amountString: receipt.amount_string,
    currency: receipt.currency || receipt.amount_currency,
    amount_currency: receipt.amount_currency,

    base_amount:
      receiptTyped.base_amount != null
        ? toNum(receiptTyped.base_amount, 0)
        : null,
    base_currency: receiptTyped.base_currency ?? null,
    counter_amount:
      receiptTyped.counter_amount != null
        ? toNum(receiptTyped.counter_amount, 0)
        : null,
    counter_currency: receiptTyped.counter_currency ?? null,

    paymentFeeAmount: paymentFeeAmountTotal,

    payments,

    services: selectedServices.map((s) => ({
      id: s.id_service,
      description: s.description ?? `Servicio ${s.id_service}`,
      salePrice: s.sale_price,
      cardInterest: s.card_interest ?? 0,
      currency: s.currency,
      departureDate: s.departure_date ?? null,
      returnDate: s.return_date ?? null,
    })),

    booking: {
      details: receipt.booking?.details ?? "-",
      departureDate:
        receipt.booking?.departure_date ?? receipt.issue_date ?? new Date(),
      returnDate:
        receipt.booking?.return_date ??
        receipt.booking?.departure_date ??
        receipt.issue_date ??
        new Date(),
      titular: receipt.booking
        ? {
            firstName: receipt.booking.titular.first_name,
            lastName: receipt.booking.titular.last_name,
            dni: receipt.booking.titular.dni_number ?? "-",
            address: receipt.booking.titular.address ?? "-",
            locality: receipt.booking.titular.locality ?? "-",
          }
        : {
            firstName: "-",
            lastName: "-",
            dni: "-",
            address: "-",
            locality: "-",
          },
      agency: agencyInfo,
    },

    recipients,
  };

  const standalone: ReceiptStandalonePdfData = {
    receiptNumber: receiptDisplayNumber,
    issueDate: receipt.issue_date ?? new Date(),
    concept: receipt.concept,
    amount: Number(receipt.amount),
    amountString: receipt.amount_string,
    amountCurrency: receipt.amount_currency,
    paymentDescription: receipt.currency || receipt.amount_currency,
    paymentFeeAmount: paymentFeeAmountTotal,
    payments,
    base_amount:
      receiptTyped.base_amount != null
        ? toNum(receiptTyped.base_amount, 0)
        : null,
    base_currency: receiptTyped.base_currency ?? null,
    counter_amount:
      receiptTyped.counter_amount != null
        ? toNum(receiptTyped.counter_amount, 0)
        : null,
    counter_currency: receiptTyped.counter_currency ?? null,
    agency: agencyInfo,
    recipients,
  };

  // 7) Render
  const stream = hasBooking
    ? await renderToStream(<ReceiptDocument {...data} />)
    : await renderToStream(<ReceiptStandaloneDocument {...standalone} />);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=recibo_${safeReceiptLabel || receipt.id_receipt}.pdf`,
  );
  stream.pipe(res);
}
