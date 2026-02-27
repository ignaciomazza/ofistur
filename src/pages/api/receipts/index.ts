// src/pages/api/receipts/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { jwtVerify, JWTPayload } from "jose";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { encodePublicId } from "@/lib/publicIds";
import {
  canAccessBookingByRole,
  getBookingComponentGrants,
  getFinanceSectionGrants,
} from "@/lib/accessControl";
import {
  normalizeReceiptVerificationRules,
  pickReceiptVerificationRule,
  ruleHasRestrictions,
} from "@/utils/receiptVerification";
import {
  canAccessBookingComponent,
  canAccessFinanceSection,
} from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { hasSchemaColumn } from "@/lib/schemaColumns";
import { extractReceiptServiceSelectionModeFromBookingAccessRules } from "@/utils/receiptServiceSelection";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";

/* ======================================================
 * Tipos
 * ====================================================== */

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

// Línea de pago (NUEVO, con IDs)
type ReceiptFeeMode = "FIXED" | "PERCENT";

export type ReceiptPaymentLine = {
  amount: number | string;
  payment_method_id: number;
  account_id?: number;
  payment_currency?: string;
  fee_mode?: ReceiptFeeMode | null;
  fee_value?: number | string | null;
  fee_amount?: number | string | null;

  // ✅ nuevo (no se persiste en ReceiptPayment, se usa para el FE)
  operator_id?: number;
};

// Respuesta normalizada (para no romper recibos viejos)
export type ReceiptPaymentOut = {
  amount: number;
  payment_method_id: number | null;
  account_id: number | null;
  payment_currency?: string | null;
  fee_mode?: ReceiptFeeMode | null;
  fee_value?: number | null;
  fee_amount?: number | null;

  // extras legacy para UI/PDF si existían como texto
  payment_method_text?: string;
  account_text?: string;
};

type ReceiptPaymentLineIn = {
  amount: unknown;
  payment_method_id: unknown;
  account_id?: unknown;
  payment_currency?: unknown;
  fee_mode?: unknown;
  fee_value?: unknown;
  fee_amount?: unknown;
  operator_id?: unknown;
};
 
type ReceiptPaymentLineNormalized = {
  amount: number;
  payment_method_id: number;
  account_id?: number;
  payment_currency: string;
  fee_mode?: ReceiptFeeMode;
  fee_value?: number;
  fee_amount?: number;
  operator_id?: number;
};

type ReceiptServiceAllocationIn = {
  service_id: unknown;
  amount_service: unknown;
  service_currency?: unknown;
  amount_payment?: unknown;
  payment_currency?: unknown;
  fx_rate?: unknown;
};

type ReceiptServiceAllocationNormalized = {
  service_id: number;
  amount_service: number;
  service_currency?: string;
  amount_payment?: number;
  payment_currency?: string;
  fx_rate?: number;
};

type ReceiptServiceAllocationOut = {
  id_receipt_service_allocation?: number;
  service_id: number;
  amount_service: number;
  service_currency: string;
};

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
    id_receipt_payment: true,
    amount: true,
    payment_method_id: true,
    account_id: true,
    ...(flags.hasPaymentCurrency ? { payment_currency: true } : {}),
    ...(flags.hasPaymentFeeMode ? { fee_mode: true } : {}),
    ...(flags.hasPaymentFeeValue ? { fee_value: true } : {}),
    ...(flags.hasPaymentFeeAmount ? { fee_amount: true } : {}),
  };
}

const RECEIPT_SERVICE_ALLOCATION_SELECT = {
  id_receipt_service_allocation: true,
  service_id: true,
  amount_service: true,
  service_currency: true,
} satisfies Prisma.ReceiptServiceAllocationSelect;

type ReceiptPostBody = {
  // Opcional si el recibo pertenece a una reserva
  booking?: { id_booking?: number };

  // Datos comunes
  concept: string;
  currency?: string; // Texto libre (para PDF / legacy)
  amountString: string; // "UN MILLÓN..."
  amountCurrency?: string; // ISO del amount/amountString (ARS | USD | ...)
  amount: number | string;
  issue_date?: string;

  // NUEVO: pagos múltiples (si viene esto, el amount total sale de la suma)
  payments?: ReceiptPaymentLineIn[];

  // Costo financiero agregado (sumatoria de fees por línea)
  payment_fee_amount?: number | string;

  // Asociaciones
  serviceIds?: number[];
  serviceAllocations?: ReceiptServiceAllocationIn[];
  service_allocations?: ReceiptServiceAllocationIn[];
  clientIds?: number[];

  // Metadatos legacy (texto)
  payment_method?: string;
  account?: string;

  // legacy ids a nivel Receipt (existen en tu schema)
  payment_method_id?: number;
  account_id?: number;

  // FX opcional
  base_amount?: number | string;
  base_currency?: string;
  counter_amount?: number | string;
  counter_currency?: string;

  // opcional: permitir excedente a cuenta crédito/corriente del pax
  allow_client_credit_excess?: boolean;
  client_credit_client_id?: number;
};

/* ======================================================
 * JWT / Auth
 * ====================================================== */

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
    const role = p.role || "" || undefined;
    const email = p.email;

    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (u) {
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role,
          email: u.email,
        };
      }
    }

    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u) {
        return {
          id_user,
          id_agency: u.id_agency,
          role: role ?? u.role,
          email: email ?? u.email ?? undefined,
        };
      }
    }

    return { id_user, id_agency, role, email };
  } catch {
    return null;
  }
}

/* ======================================================
 * Helpers
 * ====================================================== */

const toDec = (v: unknown) =>
  v === undefined || v === null || v === ""
    ? undefined
    : new Prisma.Decimal(typeof v === "number" ? v : String(v));

const isNonEmptyString = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0;

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? NaN);
  return n;
};

function toLocalDate(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const ymd = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd)
    return new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      0,
      0,
      0,
      0,
    );
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

const toOptionalId = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v ?? NaN);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  return i > 0 ? i : undefined;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DEBT_TOLERANCE = 0.01;
const VALID_RECEIPT_FEE_MODES = new Set<ReceiptFeeMode>([
  "FIXED",
  "PERCENT",
]);

const normalizeCurrency = (value: unknown): string => {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) return "ARS";
  if (["US$", "U$S", "U$D", "DOL"].includes(code)) return "USD";
  if (["$", "AR$"].includes(code)) return "ARS";
  return code;
};

const normalizeReceiptFeeMode = (value: unknown): ReceiptFeeMode | null => {
  if (typeof value !== "string") return null;
  const mode = value.trim().toUpperCase() as ReceiptFeeMode;
  return VALID_RECEIPT_FEE_MODES.has(mode) ? mode : null;
};

const normalizeReceiptPaymentFee = (line: {
  amount: number;
  fee_mode?: ReceiptFeeMode | null;
  fee_value?: number;
  fee_amount?: number;
}) => {
  const mode = line.fee_mode ?? null;
  const value = Number.isFinite(line.fee_value ?? NaN)
    ? Number(line.fee_value)
    : undefined;
  const explicitAmount = Number.isFinite(line.fee_amount ?? NaN)
    ? Number(line.fee_amount)
    : undefined;

  if (!mode) {
    const amount = explicitAmount != null ? Math.max(0, explicitAmount) : 0;
    return {
      fee_mode: undefined,
      fee_value: undefined,
      fee_amount: round2(amount),
    };
  }

  if (mode === "PERCENT") {
    const pct = value != null ? Math.max(0, value) : 0;
    const amount = round2((line.amount * pct) / 100);
    return {
      fee_mode: "PERCENT" as const,
      fee_value: round2(pct),
      fee_amount: amount,
    };
  }

  const fixed = value != null ? Math.max(0, value) : 0;
  return {
    fee_mode: "FIXED" as const,
    fee_value: round2(fixed),
    fee_amount: round2(fixed),
  };
};

const normalizeIdList = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const out = new Set<number>();
  for (const item of value) {
    const n = Number(item);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.add(Math.trunc(n));
  }
  return Array.from(out);
};

function parseReceiptServiceAllocations(
  raw: unknown,
): ReceiptServiceAllocationNormalized[] {
  if (!Array.isArray(raw)) return [];
  const out: ReceiptServiceAllocationNormalized[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const serviceIdRaw =
      rec.service_id ?? rec.serviceId ?? rec.id_service ?? rec.idService;
    const amountServiceRaw =
      rec.amount_service ?? rec.amountService ?? rec.amount ?? 0;
    const serviceCurrencyRaw =
      rec.service_currency ?? rec.serviceCurrency ?? rec.currency;
    const amountPaymentRaw =
      rec.amount_payment ?? rec.amountPayment ?? rec.counter_amount;
    const paymentCurrencyRaw =
      rec.payment_currency ?? rec.paymentCurrency ?? rec.counter_currency;
    const fxRateRaw = rec.fx_rate ?? rec.fxRate;

    const service_id = Number(serviceIdRaw);
    const amount_service = Number(amountServiceRaw);
    const service_currency = isNonEmptyString(serviceCurrencyRaw)
      ? normalizeCurrency(serviceCurrencyRaw)
      : undefined;
    const amount_payment = Number(amountPaymentRaw);
    const payment_currency = isNonEmptyString(paymentCurrencyRaw)
      ? normalizeCurrency(paymentCurrencyRaw)
      : undefined;
    const fx_rate = Number(fxRateRaw);

    if (!Number.isFinite(service_id) || service_id <= 0) continue;
    if (!Number.isFinite(amount_service)) continue;

    const hasAmountPayment = Number.isFinite(amount_payment) && amount_payment > 0;
    const hasFxRate = Number.isFinite(fx_rate) && fx_rate > 0;
    out.push({
      service_id: Math.trunc(service_id),
      amount_service: round2(Math.max(0, amount_service)),
      ...(service_currency ? { service_currency } : {}),
      ...(hasAmountPayment ? { amount_payment: round2(amount_payment) } : {}),
      ...(payment_currency ? { payment_currency } : {}),
      ...(hasFxRate ? { fx_rate: round2(fx_rate) } : {}),
    });
  }

  return out;
}

const normalizeSaleTotals = (input: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const obj = input as Record<string, unknown>;
  for (const [keyRaw, val] of Object.entries(obj)) {
    const key = normalizeCurrency(keyRaw);
    const n = typeof val === "number" ? val : Number(String(val).replace(",", "."));
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
};

type ServiceDebtInput = {
  id_service: number;
  currency: string | null;
  sale_price: number | string | Prisma.Decimal | null;
  card_interest?: number | string | Prisma.Decimal | null;
  taxableCardInterest?: number | string | Prisma.Decimal | null;
  vatOnCardInterest?: number | string | Prisma.Decimal | null;
};

function buildSelectedServiceSalesByCurrency(args: {
  selectedServiceIds: number[];
  services: ServiceDebtInput[];
  bookingSaleMode: boolean;
  manualMode: boolean;
  bookingSaleTotals: Record<string, number>;
}): Record<string, number> {
  const out: Record<string, number> = {};
  const selectedSet = new Set(args.selectedServiceIds);
  const add = (code: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    out[code] = round2((out[code] || 0) + amount);
  };

  if (args.bookingSaleMode) {
    const saleTotalsByCurrencyFromServices: Record<string, number> = {};

    for (const svc of args.services) {
      const code = normalizeCurrency(svc.currency || "ARS");
      const sale = Math.max(0, toNum(svc.sale_price));
      saleTotalsByCurrencyFromServices[code] = round2(
        (saleTotalsByCurrencyFromServices[code] || 0) + sale,
      );
    }

    const saleTotalsByCurrency =
      Object.keys(args.bookingSaleTotals).length > 0
        ? args.bookingSaleTotals
        : saleTotalsByCurrencyFromServices;

    for (const [code, totalRaw] of Object.entries(saleTotalsByCurrency)) {
      const total = Math.max(0, toNum(totalRaw));
      if (total <= 0) continue;
      add(code, total);
    }

    return out;
  }

  for (const svc of args.services) {
    if (!selectedSet.has(svc.id_service)) continue;
    const code = normalizeCurrency(svc.currency || "ARS");
    const sale = Math.max(0, toNum(svc.sale_price));

    if (args.manualMode) {
      add(code, sale);
      continue;
    }

    const splitInterest =
      toNum(svc.taxableCardInterest) + toNum(svc.vatOnCardInterest);
    const cardInterest = splitInterest > 0 ? splitInterest : toNum(svc.card_interest);
    const serviceTotal = Math.max(0, sale + (Number.isFinite(cardInterest) ? cardInterest : 0));
    add(code, serviceTotal);
  }

  return out;
}

type ReceiptDebtView = {
  serviceIds?: number[] | null;
  service_allocations?: Array<{
    service_id?: number | string | null;
    amount_service?: number | string | Prisma.Decimal | null;
    service_currency?: string | null;
  }> | null;
  amount: number | string | Prisma.Decimal | null;
  amount_currency: string | null;
  payment_fee_amount?: number | string | Prisma.Decimal | null;
  base_amount?: number | string | Prisma.Decimal | null;
  base_currency?: string | null;
  payments?: Array<{
    amount?: number | string | Prisma.Decimal | null;
    payment_currency?: string | null;
    fee_amount?: number | string | Prisma.Decimal | null;
  }> | null;
};

function addReceiptToPaidByCurrency(
  target: Record<string, number>,
  receipt: ReceiptDebtView,
  options?: { selectedServiceIds?: Set<number> },
) {
  const selectedServiceIds = options?.selectedServiceIds;
  const rawAllocations = Array.isArray(receipt.service_allocations)
    ? receipt.service_allocations
    : [];

  if (selectedServiceIds && rawAllocations.length > 0) {
    for (const alloc of rawAllocations) {
      const serviceId = Number(alloc?.service_id);
      if (!Number.isFinite(serviceId) || serviceId <= 0) continue;
      if (!selectedServiceIds.has(Math.trunc(serviceId))) continue;
      const amount = toNum(alloc?.amount_service ?? 0);
      if (!Number.isFinite(amount) || Math.abs(amount) <= DEBT_TOLERANCE)
        continue;
      const currency = normalizeCurrency(alloc?.service_currency || "ARS");
      target[currency] = round2((target[currency] || 0) + amount);
    }
    return;
  }

  const amountCurrency = normalizeCurrency(receipt.amount_currency || "ARS");
  const parsedAmount = toNum(receipt.amount ?? 0);
  const parsedFee = toNum(receipt.payment_fee_amount ?? 0);
  const parsedBase = toNum(receipt.base_amount ?? 0);
  const amountValue = Number.isFinite(parsedAmount) ? parsedAmount : 0;
  const feeValue = Number.isFinite(parsedFee) ? parsedFee : 0;
  const baseValue = Number.isFinite(parsedBase) ? parsedBase : 0;
  const baseCurrency = receipt.base_currency
    ? normalizeCurrency(receipt.base_currency)
    : null;
  const paymentLines = Array.isArray(receipt.payments) ? receipt.payments : [];
  const lineFeeTotal = paymentLines.reduce(
    (sum, line) => sum + toNum(line?.fee_amount ?? 0),
    0,
  );
  const feeRemainder = feeValue - lineFeeTotal;

  // Respetar signo para contemplar ajustes/reversiones de recibos históricos.
  if (baseCurrency && Math.abs(baseValue) > DEBT_TOLERANCE) {
    const feeInBaseCurrency =
      paymentLines.length > 0
        ? paymentLines.reduce((sum, line) => {
            const lineCurrency = normalizeCurrency(
              line?.payment_currency || amountCurrency,
            );
            if (lineCurrency !== baseCurrency) return sum;
            return sum + toNum(line?.fee_amount ?? 0);
          }, 0)
        : baseCurrency === amountCurrency
          ? feeValue
          : 0;
    const feeInBaseWithRemainder =
      feeInBaseCurrency +
      (Math.abs(feeRemainder) > DEBT_TOLERANCE && baseCurrency === amountCurrency
        ? feeRemainder
        : 0);
    const credited = baseValue + feeInBaseWithRemainder;
    if (Math.abs(credited) <= DEBT_TOLERANCE) return;
    target[baseCurrency] = round2((target[baseCurrency] || 0) + credited);
    return;
  }

  if (paymentLines.length > 0) {
    for (const line of paymentLines) {
      const lineCurrency = normalizeCurrency(
        line?.payment_currency || amountCurrency,
      );
      const lineAmount = toNum(line?.amount ?? 0);
      const lineFee = toNum(line?.fee_amount ?? 0);
      const credited = lineAmount + lineFee;
      if (Math.abs(credited) <= DEBT_TOLERANCE) continue;
      target[lineCurrency] = round2((target[lineCurrency] || 0) + credited);
    }
    if (Math.abs(feeRemainder) > DEBT_TOLERANCE) {
      target[amountCurrency] = round2(
        (target[amountCurrency] || 0) + feeRemainder,
      );
    }
    return;
  }

  const credited = amountValue + feeValue;
  if (Math.abs(credited) <= DEBT_TOLERANCE) return;
  target[amountCurrency] = round2((target[amountCurrency] || 0) + credited);
}

function normalizePaymentsFromReceipt(r: unknown): ReceiptPaymentOut[] {
  if (!r || typeof r !== "object") return [];

  const obj = r as Record<string, unknown>;
  const rel = Array.isArray(obj.payments) ? obj.payments : [];

  if (rel.length > 0) {
    return rel.map((p) => {
      const pay = (p ?? {}) as Record<string, unknown>;
      const pm = Number(pay.payment_method_id);
      const acc = Number(pay.account_id);
      const feeValueRaw = toNum(pay.fee_value);
      const feeAmountRaw = toNum(pay.fee_amount);
      const feeMode = normalizeReceiptFeeMode(pay.fee_mode);
      return {
        amount: Number(pay.amount ?? 0),
        payment_method_id: Number.isFinite(pm) && pm > 0 ? pm : null,
        account_id: Number.isFinite(acc) && acc > 0 ? acc : null,
        payment_currency: normalizeCurrency(
          pay.payment_currency ?? obj.amount_currency ?? "ARS",
        ),
        fee_mode: feeMode,
        fee_value: Number.isFinite(feeValueRaw) ? feeValueRaw : null,
        fee_amount: Number.isFinite(feeAmountRaw) ? feeAmountRaw : null,
      };
    });
  }

  const amt = toNum(obj.amount);
  const pmText = String(obj.payment_method ?? "").trim();
  const accText = String(obj.account ?? "").trim();

  const pmIdRaw = Number(obj.payment_method_id);
  const accIdRaw = Number(obj.account_id);

  const pmId = Number.isFinite(pmIdRaw) && pmIdRaw > 0 ? pmIdRaw : null;
  const accId = Number.isFinite(accIdRaw) && accIdRaw > 0 ? accIdRaw : null;

  if (Number.isFinite(amt) && (pmText || accText || pmId || accId)) {
    return [
      {
        amount: amt,
        payment_method_id: pmId,
        account_id: accId,
        payment_currency: normalizeCurrency(obj.amount_currency ?? "ARS"),
        ...(pmText ? { payment_method_text: pmText } : {}),
        ...(accText ? { account_text: accText } : {}),
      },
    ];
  }

  return [];
}

function normalizeServiceAllocationsFromReceipt(
  r: unknown,
): ReceiptServiceAllocationOut[] {
  if (!r || typeof r !== "object") return [];
  const obj = r as Record<string, unknown>;
  const rel = Array.isArray(obj.service_allocations)
    ? obj.service_allocations
    : [];

  return rel
    .map((item) => {
      const rec = (item ?? {}) as Record<string, unknown>;
      const serviceId = Number(rec.service_id);
      const amountRaw = toNum(rec.amount_service);
      const amountService = Number.isFinite(amountRaw)
        ? round2(amountRaw)
        : 0;
      const currency = normalizeCurrency(rec.service_currency ?? "ARS");
      const allocIdRaw = Number(rec.id_receipt_service_allocation);
      return {
        id_receipt_service_allocation:
          Number.isFinite(allocIdRaw) && allocIdRaw > 0
            ? allocIdRaw
            : undefined,
        service_id:
          Number.isFinite(serviceId) && serviceId > 0
            ? Math.trunc(serviceId)
            : 0,
        amount_service: amountService,
        service_currency: currency,
      };
    })
    .filter((row) => row.service_id > 0);
}

async function ensureBookingInAgency(
  bookingId: number,
  agencyId: number,
): Promise<{
  id_booking: number;
  id_agency: number;
  id_user: number;
  sale_totals: Prisma.JsonValue | null;
  use_booking_sale_total_override: boolean | null;
}> {
  const b = await prisma.booking.findUnique({
    where: { id_booking: bookingId },
    select: {
      id_booking: true,
      id_agency: true,
      id_user: true,
      sale_totals: true,
      use_booking_sale_total_override: true,
    },
  });

  if (!b) throw new Error("La reserva no existe.");
  if (b.id_agency !== agencyId)
    throw new Error("La reserva no pertenece a tu agencia.");
  return b;
}

async function nextReceiptNumberForBooking(bookingId: number) {
  const existing = await prisma.receipt.findMany({
    where: { receipt_number: { startsWith: `${bookingId}-` } },
    select: { receipt_number: true },
  });

  const used = existing
    .map((r) => parseInt(String(r.receipt_number).split("-")[1], 10))
    .filter((n) => Number.isFinite(n));

  const nextIdx = used.length ? Math.max(...used) + 1 : 1;
  return `${bookingId}-${nextIdx}`;
}

async function nextReceiptNumberForAgency(agencyId: number) {
  const existing = await prisma.receipt.findMany({
    where: {
      receipt_number: { startsWith: `A${agencyId}-` },
    },
    select: { receipt_number: true },
  });

  const used = existing
    .map((r) => parseInt(String(r.receipt_number).split("-")[1], 10))
    .filter((n) => Number.isFinite(n));

  const nextIdx = used.length ? Math.max(...used) + 1 : 1;
  return `A${agencyId}-${nextIdx}`;
}

/* ======================================================
 * GET /api/receipts
 * ====================================================== */

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authUser = await getUserFromAuth(req);
    const authUserId = authUser?.id_user;
    const authAgencyId = authUser?.id_agency;
    const authRole = authUser?.role ?? "";

    if (!authUserId || !authAgencyId) {
      return res.status(401).json({ error: "No autenticado" });
    }
    const auth = authUser as DecodedUser;

    // ====== Modo detalle: por booking ======
    const bookingIdParam = Array.isArray(req.query.bookingId)
      ? req.query.bookingId[0]
      : req.query.bookingId;
    const bookingId = Number(bookingIdParam);

    const financeGrants = await getFinanceSectionGrants(
      authAgencyId,
      authUserId,
    );
    const canReceipts = canAccessFinanceSection(
      authRole,
      financeGrants,
      "receipts",
    );
    const canVerify = canAccessFinanceSection(
      authRole,
      financeGrants,
      "receipts_verify",
    );
    const schemaFlags = await getReceiptSchemaFlags();
    const needsBookingScope = Number.isFinite(bookingId);
    let canBookingReceipts = false;
    if (!canReceipts && !canVerify && needsBookingScope) {
      const bookingGrants = await getBookingComponentGrants(
        authAgencyId,
        authUserId,
      );
      canBookingReceipts = canAccessBookingComponent(
        authRole,
        bookingGrants,
        "receipts_form",
      );
    }

    if (Number.isFinite(bookingId)) {
      const booking = await ensureBookingInAgency(bookingId, authAgencyId);
      const canReadByRole = await canAccessBookingByRole(auth, booking);
      if (!canReceipts && !canVerify && !canBookingReceipts && !canReadByRole) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      const receipts = await prisma.receipt.findMany({
        where: { booking: { id_booking: bookingId } },
        orderBy: { issue_date: "desc" },
        include: {
          ...(schemaFlags.hasPaymentLines
            ? {
                payments: { select: buildReceiptPaymentSelect(schemaFlags) },
              }
            : {}),
          service_allocations: {
            select: RECEIPT_SERVICE_ALLOCATION_SELECT,
          },
        },
      });

      const normalized = receipts.map((r) => ({
        ...r,
        public_id:
          r.agency_receipt_id != null
            ? encodePublicId({
                t: "receipt",
                a: r.id_agency ?? authAgencyId,
                i: r.agency_receipt_id,
              })
            : null,
        payments: normalizePaymentsFromReceipt(r),
        service_allocations: normalizeServiceAllocationsFromReceipt(r),
      }));

      return res.status(200).json({ receipts: normalized });
    }
    if (!canReceipts && !canVerify) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    // ====== Listado mixto (por filtros) ======
    const q =
      (Array.isArray(req.query.q) ? req.query.q[0] : req.query.q)?.trim() || "";

    const amountCurrencyQuery = (
      Array.isArray(req.query.amountCurrency)
        ? req.query.amountCurrency[0]
        : req.query.amountCurrency
    )
      ?.toString()
      .toUpperCase()
      .trim();

    const currencyParamRaw =
      (Array.isArray(req.query.currency)
        ? req.query.currency[0]
        : req.query.currency) ?? "";

    const currencyTextParam =
      (Array.isArray(req.query.currencyText)
        ? req.query.currencyText[0]
        : req.query.currencyText) ?? "";

    // legacy filtros por texto (Receipt.payment_method / Receipt.account)
    const payment_method_text =
      (Array.isArray(req.query.payment_method)
        ? req.query.payment_method[0]
        : req.query.payment_method) || undefined;

    const account_text =
      (Array.isArray(req.query.account)
        ? req.query.account[0]
        : req.query.account) || undefined;

    // NUEVO filtros por IDs (ReceiptPayment)
    const payment_method_id = Number(
      Array.isArray(req.query.payment_method_id)
        ? req.query.payment_method_id[0]
        : req.query.payment_method_id,
    );

    const account_id = Number(
      Array.isArray(req.query.account_id)
        ? req.query.account_id[0]
        : req.query.account_id,
    );

    const ownerId = Number(
      Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId,
    );

    const from =
      (Array.isArray(req.query.from) ? req.query.from[0] : req.query.from) ||
      "";
    const to =
      (Array.isArray(req.query.to) ? req.query.to[0] : req.query.to) || "";

    const minAmount = Number(
      Array.isArray(req.query.minAmount)
        ? req.query.minAmount[0]
        : req.query.minAmount,
    );
    const maxAmount = Number(
      Array.isArray(req.query.maxAmount)
        ? req.query.maxAmount[0]
        : req.query.maxAmount,
    );

    const associationParamRaw = Array.isArray(req.query.association)
      ? req.query.association[0]
      : req.query.association;
    const association = String(associationParamRaw || "")
      .trim()
      .toLowerCase();

    const verificationStatusRaw = Array.isArray(req.query.verification_status)
      ? req.query.verification_status[0]
      : Array.isArray(req.query.verificationStatus)
        ? req.query.verificationStatus[0]
        : req.query.verification_status ?? req.query.verificationStatus ?? "";

    const verificationStatus = String(verificationStatusRaw || "")
      .trim()
      .toUpperCase();

    const verificationScopeRaw = Array.isArray(req.query.verification_scope)
      ? req.query.verification_scope[0]
      : Array.isArray(req.query.verify_scope)
        ? req.query.verify_scope[0]
        : Array.isArray(req.query.verificationScope)
          ? req.query.verificationScope[0]
          : req.query.verification_scope ??
            req.query.verify_scope ??
            req.query.verificationScope ??
            "";

    const verificationScope = ["1", "true", "yes", "on"].includes(
      String(verificationScopeRaw || "")
        .trim()
        .toLowerCase(),
    );

    if (verificationScope || verificationStatus) {
      const planAccess = await ensurePlanFeatureAccess(
        authAgencyId,
        "receipts_verify",
      );
      if (!planAccess.allowed) {
        return res.status(403).json({ error: "Plan insuficiente" });
      }
    }

    const take = Math.max(
      1,
      Math.min(
        200,
        Number(
          Array.isArray(req.query.take) ? req.query.take[0] : req.query.take,
        ) || 120,
      ),
    );

    const cursorId = Number(
      Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor,
    );

    // 1) Alcance por agencia / usuario
    const agencyScope: Prisma.ReceiptWhereInput =
      Number.isFinite(ownerId) && ownerId > 0
        ? { booking: { id_agency: authAgencyId, user: { id_user: ownerId } } }
        : {
            OR: [
              { booking: { id_agency: authAgencyId } },
              { id_agency: authAgencyId },
            ],
          };

    const whereAND: Prisma.ReceiptWhereInput[] = [agencyScope];

    // 2) Búsqueda libre
    if (q) {
      const maybeNum = Number(q);
      whereAND.push({
        OR: [
          { concept: { contains: q, mode: "insensitive" } },
          { amount_string: { contains: q, mode: "insensitive" } },
          { receipt_number: { contains: q, mode: "insensitive" } },
          ...(Number.isFinite(maybeNum)
            ? [{ agency_receipt_id: maybeNum }]
            : []),
          ...(Number.isFinite(maybeNum)
            ? [
                { booking: { id_booking: maybeNum } },
                { booking: { agency_booking_id: maybeNum } },
              ]
            : []),
        ],
      });
    }

    // 3) Filtros por moneda / texto
    if (amountCurrencyQuery && /^[A-Z]{3}$/.test(amountCurrencyQuery)) {
      whereAND.push({ amount_currency: amountCurrencyQuery });
    }

    const currencyParam = currencyParamRaw.toString().trim();
    if (currencyParam) {
      if (/^[A-Za-z]{3}$/.test(currencyParam)) {
        whereAND.push({ amount_currency: currencyParam.toUpperCase() });
      } else {
        whereAND.push({
          currency: { contains: currencyParam, mode: "insensitive" },
        });
      }
    }

    if (currencyTextParam) {
      whereAND.push({
        currency: { contains: currencyTextParam, mode: "insensitive" },
      });
    }

    // 3bis) filtros legacy texto
    if (payment_method_text)
      whereAND.push({ payment_method: payment_method_text });
    if (account_text) whereAND.push({ account: account_text });

    // 3ter) filtros nuevos por IDs (payments)
    if (Number.isFinite(payment_method_id) && payment_method_id > 0) {
      if (schemaFlags.hasPaymentLines) {
        whereAND.push({ payments: { some: { payment_method_id } } });
      } else {
        whereAND.push({ payment_method_id });
      }
    }
    if (Number.isFinite(account_id) && account_id > 0) {
      if (schemaFlags.hasPaymentLines) {
        whereAND.push({ payments: { some: { account_id } } });
      } else {
        whereAND.push({ account_id });
      }
    }

    // 4) Rango de fechas
    const dateRange: Prisma.DateTimeFilter = {};
    if (from) {
      const parsedFrom = startOfDayUtcFromDateKeyInBuenosAires(from);
      if (parsedFrom) dateRange.gte = parsedFrom;
    }
    if (to) {
      const parsedTo = endOfDayUtcFromDateKeyInBuenosAires(to);
      if (parsedTo) dateRange.lte = parsedTo;
    }
    if (dateRange.gte || dateRange.lte)
      whereAND.push({ issue_date: dateRange });

    // 5) Rango de importes (total del recibo)
    const amountRange: Prisma.FloatFilter = {};
    if (Number.isFinite(minAmount)) amountRange.gte = Number(minAmount);
    if (Number.isFinite(maxAmount)) amountRange.lte = Number(maxAmount);
    if (amountRange.gte !== undefined || amountRange.lte !== undefined) {
      whereAND.push({ amount: amountRange });
    }

    if (association === "linked" || association === "associated") {
      whereAND.push({ bookingId_booking: { not: null } });
    } else if (
      association === "unlinked" ||
      association === "unassociated" ||
      association === "none"
    ) {
      whereAND.push({ bookingId_booking: null });
    }

    if (verificationStatus && verificationStatus !== "ALL") {
      if (["PENDING", "VERIFIED"].includes(verificationStatus)) {
        whereAND.push({ verification_status: verificationStatus });
      }
    }

    if (verificationScope) {
      const config = await prisma.financeConfig.findFirst({
        where: { id_agency: authAgencyId },
        select: { receipt_verification_rules: true },
      });
      const rules = normalizeReceiptVerificationRules(
        config?.receipt_verification_rules,
      );
      const rule = pickReceiptVerificationRule(rules, authUserId);

      if (rule && ruleHasRestrictions(rule)) {
        if (rule.payment_method_ids.length > 0) {
          if (schemaFlags.hasPaymentLines) {
            whereAND.push({
              OR: [
                { payment_method_id: { in: rule.payment_method_ids } },
                {
                  payments: {
                    some: {
                      payment_method_id: { in: rule.payment_method_ids },
                    },
                  },
                },
              ],
            });
          } else {
            whereAND.push({ payment_method_id: { in: rule.payment_method_ids } });
          }
        }

        if (rule.account_ids.length > 0) {
          if (schemaFlags.hasPaymentLines) {
            whereAND.push({
              OR: [
                { account_id: { in: rule.account_ids } },
                {
                  payments: {
                    some: {
                      account_id: { in: rule.account_ids },
                    },
                  },
                },
              ],
            });
          } else {
            whereAND.push({ account_id: { in: rule.account_ids } });
          }
        }
      }
    }

    const baseWhere: Prisma.ReceiptWhereInput = { AND: whereAND };

    const items = await prisma.receipt.findMany({
      where: cursorId
        ? { AND: [baseWhere, { id_receipt: { lt: cursorId } }] }
        : baseWhere,
      orderBy: { id_receipt: "desc" },
      take,
      select: {
        id_receipt: true,
        agency_receipt_id: true,
        receipt_number: true,
        issue_date: true,
        amount: true,
        amount_string: true,
        amount_currency: true,
        payment_fee_amount: true,
        verification_status: true,
        verified_at: true,
        verified_by: true,

        concept: true,
        currency: true,

        // legacy (Receipt)
        payment_method: true,
        account: true,
        payment_method_id: true,
        account_id: true,

        base_amount: true,
        base_currency: true,
        counter_amount: true,
        counter_currency: true,
        serviceIds: true,
        clientIds: true,
        service_allocations: {
          select: RECEIPT_SERVICE_ALLOCATION_SELECT,
        },

        ...(schemaFlags.hasPaymentLines
          ? {
              payments: {
                select: buildReceiptPaymentSelect(schemaFlags),
              },
            }
          : {}),

        booking: {
          select: {
            id_booking: true,
            agency_booking_id: true,
            user: {
              select: { id_user: true, first_name: true, last_name: true },
            },
            titular: {
              select: { id_client: true, first_name: true, last_name: true },
            },
          },
        },
        verifiedBy: {
          select: { id_user: true, first_name: true, last_name: true },
        },
        agency: { select: { id_agency: true, name: true } },
      },
    });

    const uniqueClientIds = Array.from(
      new Set(
        items.flatMap((r) =>
          Array.isArray(r.clientIds)
            ? r.clientIds.filter(
                (id): id is number => Number.isFinite(id) && id > 0,
              )
            : [],
        ),
      ),
    );

    const receiptClients = uniqueClientIds.length
      ? await prisma.client.findMany({
          where: {
            id_agency: authAgencyId,
            id_client: { in: uniqueClientIds },
          },
          select: {
            id_client: true,
            agency_client_id: true,
            first_name: true,
            last_name: true,
          },
        })
      : [];

    const receiptClientById = new Map(
      receiptClients.map((c) => [c.id_client, c]),
    );

    const formatClientLabel = (clientId: number): string => {
      const found = receiptClientById.get(clientId);
      if (!found) return `N°${clientId}`;
      const fullName = `${found.first_name ?? ""} ${found.last_name ?? ""}`.trim();
      const displayId = found.agency_client_id ?? found.id_client ?? clientId;
      return fullName ? `${fullName} · N°${displayId}` : `N°${displayId}`;
    };

    const normalized = items.map((r) => {
      const public_id =
        r.agency_receipt_id != null
          ? encodePublicId({
              t: "receipt",
              a: r.agency?.id_agency ?? authAgencyId,
              i: r.agency_receipt_id,
            })
          : null;
      const bookingPublicId =
        r.booking?.agency_booking_id != null
          ? encodePublicId({
              t: "booking",
              a: authAgencyId,
              i: r.booking.agency_booking_id,
            })
          : null;
      const clientLabels = Array.isArray(r.clientIds)
        ? r.clientIds
            .filter((id): id is number => Number.isFinite(id) && id > 0)
            .map((id) => formatClientLabel(id))
        : [];
      return {
        ...r,
        clientLabels,
        public_id,
        booking: r.booking
          ? { ...r.booking, public_id: bookingPublicId }
          : r.booking,
        payments: normalizePaymentsFromReceipt(r),
        service_allocations: normalizeServiceAllocationsFromReceipt(r),
      };
    });

    const nextCursor =
      items.length === take
        ? (items[items.length - 1]?.id_receipt ?? null)
        : null;

    return res.status(200).json({ items: normalized, nextCursor });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Error obteniendo recibos";
    const stack = error instanceof Error ? error.stack : undefined;
    // eslint-disable-next-line no-console
    console.error("[API] GET /api/receipts error:", { msg, stack });
    return res.status(500).json({ error: msg });
  }
}

/* ======================================================
 * POST /api/receipts
 * ====================================================== */

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const authUser = await getUserFromAuth(req);
    const authUserId = authUser?.id_user;
    const authAgencyId = authUser?.id_agency;
    const authRole = authUser?.role ?? "";

    if (!authUserId || !authAgencyId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const financeGrants = await getFinanceSectionGrants(
      authAgencyId,
      authUserId,
    );
    const canReceipts = canAccessFinanceSection(
      authRole,
      financeGrants,
      "receipts",
    );
    let canReceiptsForm = false;
    if (!canReceipts) {
      const bookingGrants = await getBookingComponentGrants(
        authAgencyId,
        authUserId,
      );
      canReceiptsForm = canAccessBookingComponent(
        authRole,
        bookingGrants,
        "receipts_form",
      );
    }

    if (!canReceipts && !canReceiptsForm) {
      return res.status(403).json({ error: "Sin permisos" });
    }
  const schemaFlags = await getReceiptSchemaFlags();

  const rawBody = req.body;
  // eslint-disable-next-line no-console
  console.log("[API] POST /api/receipts raw body:", rawBody);

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return res.status(400).json({ error: "Body inválido o vacío" });
  }

  const {
    booking,
    concept,
    currency,
    amountString,
    amountCurrency,
    serviceIds: rawServiceIds = [],
    serviceAllocations: rawServiceAllocationsCamel,
    service_allocations: rawServiceAllocationsSnake,
    clientIds: rawClientIds = [],
    amount,
    issue_date,
    payments,
    payment_fee_amount,

    // legacy
    payment_method,
    account,
    payment_method_id,
    account_id,

    base_amount,
    base_currency,
    counter_amount,
    counter_currency,
    allow_client_credit_excess,
    client_credit_client_id,
  } = rawBody as ReceiptPostBody;

  let amountCurrencyISO = normalizeCurrency(amountCurrency || "");
  const baseCurrencyISO = base_currency
    ? base_currency.toUpperCase()
    : undefined;
  const counterCurrencyISO = counter_currency
    ? counter_currency.toUpperCase()
    : undefined;

  const bookingId = Number(booking?.id_booking);
  const hasBooking = Number.isFinite(bookingId);
  const normalizedServiceIds = normalizeIdList(rawServiceIds);
  const rawServiceAllocations = Array.isArray(rawServiceAllocationsCamel)
    ? rawServiceAllocationsCamel
    : Array.isArray(rawServiceAllocationsSnake)
      ? rawServiceAllocationsSnake
      : [];
  const normalizedRequestedServiceAllocations = parseReceiptServiceAllocations(
    rawServiceAllocations,
  );
  let normalizedClientIds = normalizeIdList(rawClientIds);
  const allowClientCreditExcess = Boolean(allow_client_credit_excess);
  const requestedClientCreditClientId = toOptionalId(client_credit_client_id);

  if (!hasBooking && normalizedRequestedServiceAllocations.length > 0) {
    return res.status(400).json({
      error:
        "serviceAllocations solo se permite en recibos asociados a una reserva.",
    });
  }

  if (!isNonEmptyString(concept)) {
    return res.status(400).json({ error: "concept es requerido" });
  }
  if (!isNonEmptyString(amountString)) {
    return res.status(400).json({ error: "amountString es requerido" });
  }
  if (!isNonEmptyString(amountCurrencyISO) && !(Array.isArray(payments) && payments.length > 0)) {
    return res.status(400).json({ error: "amountCurrency es requerido (ISO)" });
  }

  const parsedIssueDate = issue_date ? toLocalDate(issue_date) : undefined;
  if (issue_date && !parsedIssueDate) {
    return res.status(400).json({ error: "issue_date inválida" });
  }

  // ---- NUEVO: validar pagos múltiples si vienen
  const hasPayments = Array.isArray(payments) && payments.length > 0;

  let normalizedPayments: ReceiptPaymentLineNormalized[] = [];
  let paymentFeeAmountNum = Number.isFinite(toNum(payment_fee_amount))
    ? Math.max(0, toNum(payment_fee_amount))
    : 0;

  if (Array.isArray(payments) && payments.length > 0) {
    normalizedPayments = payments.map((p) => {
      const amountValue = toNum(p.amount);
      const feeMode = normalizeReceiptFeeMode(p.fee_mode);
      const feeValueRaw = toNum(p.fee_value);
      const feeAmountRaw = toNum(p.fee_amount);
      const normalizedFee = normalizeReceiptPaymentFee({
        amount: Number.isFinite(amountValue) ? amountValue : 0,
        fee_mode: feeMode,
        fee_value: Number.isFinite(feeValueRaw) ? feeValueRaw : undefined,
        fee_amount: Number.isFinite(feeAmountRaw) ? feeAmountRaw : undefined,
      });

      return {
        amount: amountValue,
        payment_method_id: Number(p.payment_method_id),
        account_id: toOptionalId(p.account_id),
        payment_currency: normalizeCurrency(
          p.payment_currency ?? amountCurrencyISO ?? "ARS",
        ),
        fee_mode: normalizedFee.fee_mode,
        fee_value: normalizedFee.fee_value,
        fee_amount: normalizedFee.fee_amount,
        operator_id: toOptionalId(p.operator_id),
      };
    });

    const invalid = normalizedPayments.find(
      (p) =>
        !Number.isFinite(p.amount) ||
        p.amount <= 0 ||
        !Number.isFinite(p.payment_method_id) ||
        p.payment_method_id <= 0 ||
        !isNonEmptyString(p.payment_currency),
    );

    if (invalid) {
      return res.status(400).json({
        error:
          "payments inválido: cada línea debe tener amount > 0 y payment_method_id válido",
      });
    }

    const currenciesInPayments = Array.from(
      new Set(
        normalizedPayments
          .map((p) => normalizeCurrency(p.payment_currency))
          .filter(Boolean),
      ),
    );
    const hasMixedPaymentCurrencies = currenciesInPayments.length > 1;
    const hasBaseForMixed =
      isNonEmptyString(baseCurrencyISO) && toNum(base_amount) > 0;

    if (hasBooking && hasMixedPaymentCurrencies && !hasBaseForMixed) {
      return res.status(400).json({
        error:
          "Con cobro en múltiples monedas debés informar valor base y moneda base.",
      });
    }

    if (currenciesInPayments.length > 0) {
      amountCurrencyISO = normalizeCurrency(
        hasMixedPaymentCurrencies && hasBaseForMixed
          ? baseCurrencyISO
          : currenciesInPayments[0],
      );
    }

    if (!schemaFlags.hasPaymentCurrency && hasMixedPaymentCurrencies) {
      return res.status(400).json({
        error:
          "Tu base no tiene soporte de moneda por línea. Aplicá la migración pendiente.",
      });
    }
    paymentFeeAmountNum = round2(
      normalizedPayments.reduce((acc, p) => acc + (p.fee_amount || 0), 0),
    );
  }

  // amount total
  const legacyAmountNum = toNum(amount);
  const amountNum = hasPayments
    ? normalizedPayments.reduce((acc, p) => acc + Number(p.amount), 0)
    : legacyAmountNum;

  if (!Number.isFinite(amountNum)) {
    return res.status(400).json({ error: "amount numérico inválido" });
  }
 
  let serviceIdsForReceipt = normalizedServiceIds;
  let serviceAllocationsForReceipt: ReceiptServiceAllocationNormalized[] = [];
  let clientCreditExcessByCurrency: Record<string, number> = {};
  let clientCreditClientId: number | null = null;

  try {
    // Si hay booking: validar pertenencia y servicios
    if (hasBooking) {
      const booking = await ensureBookingInAgency(bookingId, authAgencyId);

      const calcConfig = await prisma.serviceCalcConfig.findUnique({
        where: { id_agency: authAgencyId },
        select: {
          use_booking_sale_total: true,
          billing_breakdown_mode: true,
          booking_access_rules: true,
        },
      });
      const receiptServiceSelectionMode =
        extractReceiptServiceSelectionModeFromBookingAccessRules(
          calcConfig?.booking_access_rules,
        );

      const inheritedUseBookingSaleTotal = Boolean(calcConfig?.use_booking_sale_total);
      const bookingSaleMode =
        typeof booking.use_booking_sale_total_override === "boolean"
          ? booking.use_booking_sale_total_override
          : inheritedUseBookingSaleTotal;
      const billingMode = String(calcConfig?.billing_breakdown_mode || "auto")
        .trim()
        .toLowerCase();
      const manualMode = billingMode === "manual" || bookingSaleMode;
      const bookingSaleTotals = normalizeSaleTotals(booking.sale_totals);

      const services = await prisma.service.findMany({
        where: { booking_id: bookingId },
        select: {
          id_service: true,
          currency: true,
          sale_price: true,
          card_interest: true,
          taxableCardInterest: true,
          vatOnCardInterest: true,
        },
      });

      const allServiceIds = services.map((s) => s.id_service);
      let resolvedServiceIds = normalizedServiceIds;

      if (receiptServiceSelectionMode === "booking") {
        resolvedServiceIds = allServiceIds;
      } else if (
        receiptServiceSelectionMode === "optional" &&
        resolvedServiceIds.length === 0
      ) {
        resolvedServiceIds = allServiceIds;
      } else if (
        receiptServiceSelectionMode === "required" &&
        resolvedServiceIds.length === 0
      ) {
        return res.status(400).json({
          error:
            "serviceIds debe tener al menos un ID para recibos asociados a una reserva",
        });
      }

      const okServiceIds = new Set(services.map((s) => s.id_service));
      const badServices = resolvedServiceIds.filter((id) => !okServiceIds.has(id));

      if (badServices.length > 0) {
        return res
          .status(400)
          .json({ error: "Algún servicio no pertenece a la reserva" });
      }

      if (bookingSaleMode) {
        serviceIdsForReceipt = allServiceIds;
      } else {
        serviceIdsForReceipt = resolvedServiceIds;
      }

      if (normalizedRequestedServiceAllocations.length > 0) {
        const serviceMap = new Map(
          services.map((service) => [service.id_service, service]),
        );
        const validServiceIds = new Set(serviceIdsForReceipt);
        const deduped = new Map<number, ReceiptServiceAllocationNormalized>();

        for (const alloc of normalizedRequestedServiceAllocations) {
          if (alloc.amount_service <= 0) {
            return res.status(400).json({
              error: "serviceAllocations debe tener montos mayores a 0.",
            });
          }
          if (deduped.has(alloc.service_id)) {
            return res.status(400).json({
              error: "No podés repetir servicios en serviceAllocations.",
            });
          }
          if (!okServiceIds.has(alloc.service_id)) {
            return res.status(400).json({
              error:
                "Algún servicio de serviceAllocations no pertenece a la reserva.",
            });
          }
          if (!validServiceIds.has(alloc.service_id)) {
            return res.status(400).json({
              error:
                "serviceAllocations solo puede incluir servicios aplicados al recibo.",
            });
          }

          const service = serviceMap.get(alloc.service_id);
          const serviceCurrency = normalizeCurrency(service?.currency || "ARS");
          const paymentCurrency = alloc.payment_currency
            ? normalizeCurrency(alloc.payment_currency)
            : undefined;
          const amountPayment = toNum(alloc.amount_payment);
          if (
            alloc.service_currency &&
            normalizeCurrency(alloc.service_currency) !== serviceCurrency
          ) {
            return res.status(400).json({
              error:
                "La moneda de serviceAllocations no coincide con la moneda del servicio.",
            });
          }
          if (paymentCurrency && paymentCurrency !== serviceCurrency) {
            if (!Number.isFinite(amountPayment) || amountPayment <= 0) {
              return res.status(400).json({
                error:
                  "Cuando la moneda de pago difiere de la moneda del servicio, serviceAllocations debe incluir amount_payment > 0.",
              });
            }
          }

          deduped.set(alloc.service_id, {
            service_id: alloc.service_id,
            amount_service: round2(alloc.amount_service),
            service_currency: serviceCurrency,
            ...(Number.isFinite(amountPayment) && amountPayment > 0
              ? { amount_payment: round2(amountPayment) }
              : {}),
            ...(paymentCurrency ? { payment_currency: paymentCurrency } : {}),
            ...(Number.isFinite(alloc.fx_rate) && Number(alloc.fx_rate) > 0
              ? { fx_rate: round2(Number(alloc.fx_rate)) }
              : {}),
          });
        }

        serviceAllocationsForReceipt = Array.from(deduped.values());
      } else {
        serviceAllocationsForReceipt = [];
      }

      if (serviceAllocationsForReceipt.length > 0) {
        const availableByCurrency: Record<string, number> = {};
        addReceiptToPaidByCurrency(availableByCurrency, {
          amount: amountNum,
          amount_currency: amountCurrencyISO,
          payment_fee_amount: paymentFeeAmountNum,
          base_amount: base_amount ?? null,
          base_currency: baseCurrencyISO ?? null,
          payments: normalizedPayments.map((p) => ({
            amount: p.amount,
            payment_currency: p.payment_currency,
            fee_amount: p.fee_amount,
          })),
        });

        const allocatedByCurrency = serviceAllocationsForReceipt.reduce<
          Record<string, number>
        >((acc, alloc) => {
          const serviceCurrency = normalizeCurrency(alloc.service_currency || "ARS");
          const paymentCurrency = normalizeCurrency(
            alloc.payment_currency || serviceCurrency,
          );
          const amountPayment = toNum(alloc.amount_payment);
          const amountService = toNum(alloc.amount_service);
          const amount =
            Number.isFinite(amountPayment) && amountPayment > 0
              ? amountPayment
              : amountService;
          const code = paymentCurrency || serviceCurrency;
          acc[code] = round2((acc[code] || 0) + amount);
          return acc;
        }, {});

        for (const [code, allocated] of Object.entries(allocatedByCurrency)) {
          const available = availableByCurrency[code] || 0;
          if (allocated - available > DEBT_TOLERANCE) {
            return res.status(400).json({
              error: `serviceAllocations excede el monto disponible en ${code}.`,
            });
          }
        }
      }

      const salesByCurrency = buildSelectedServiceSalesByCurrency({
        selectedServiceIds: resolvedServiceIds,
        services,
        bookingSaleMode,
        manualMode,
        bookingSaleTotals,
      });

      const selectedServiceIdSet = new Set(resolvedServiceIds);
      const allocationScopeServiceIds = bookingSaleMode
        ? undefined
        : selectedServiceIdSet;
      const existingReceipts = await prisma.receipt.findMany({
        where: {
          bookingId_booking: bookingId,
        },
        select: {
          serviceIds: true,
          service_allocations: {
            select: {
              service_id: true,
              amount_service: true,
              service_currency: true,
            },
          },
          amount: true,
          amount_currency: true,
          payment_fee_amount: true,
          base_amount: true,
          base_currency: true,
          ...(schemaFlags.hasPaymentLines
            ? {
                payments: {
                  select: {
                    amount: true,
                    ...(schemaFlags.hasPaymentCurrency
                      ? { payment_currency: true }
                      : {}),
                    ...(schemaFlags.hasPaymentFeeAmount
                      ? { fee_amount: true }
                      : {}),
                  },
                },
              }
            : {}),
        },
      });

      const paidByCurrency: Record<string, number> = {};
      for (const receipt of existingReceipts) {
        const receiptAllocationIds = Array.isArray(receipt.service_allocations)
          ? Array.from(
              new Set(
                receipt.service_allocations
                  .map((alloc) => Number(alloc?.service_id))
                  .filter((sid) => Number.isFinite(sid) && sid > 0)
                  .map((sid) => Math.trunc(sid)),
              ),
            )
          : [];
        const receiptServiceIds = normalizeIdList(receipt.serviceIds);
        const appliesToSelection =
          bookingSaleMode ||
          (receiptAllocationIds.length > 0
            ? receiptAllocationIds.some((id) => selectedServiceIdSet.has(id))
            : receiptServiceIds.length === 0 ||
              receiptServiceIds.some((id) => selectedServiceIdSet.has(id)));
        if (!appliesToSelection) continue;
        addReceiptToPaidByCurrency(
          paidByCurrency,
          receipt,
          allocationScopeServiceIds
            ? {
                selectedServiceIds: allocationScopeServiceIds,
              }
            : undefined,
        );
      }

      const remainingBeforeCurrent: Record<string, number> = {};
      const debtCurrencies = new Set([
        ...Object.keys(salesByCurrency),
        ...Object.keys(paidByCurrency),
      ]);
      for (const code of debtCurrencies) {
        const remaining = round2(
          (salesByCurrency[code] || 0) - (paidByCurrency[code] || 0),
        );
        remainingBeforeCurrent[code] = remaining;
      }

      const hasPendingBalance = Object.values(remainingBeforeCurrent).some(
        (value) => value > DEBT_TOLERANCE,
      );
      if (!hasPendingBalance) {
        return res.status(400).json({
          error: bookingSaleMode
            ? "La reserva ya está saldada."
            : "Los servicios seleccionados ya están saldados.",
        });
      }

      const currentPaidByCurrency: Record<string, number> = {};
      addReceiptToPaidByCurrency(currentPaidByCurrency, {
        amount: amountNum,
        amount_currency: amountCurrencyISO,
        payment_fee_amount: paymentFeeAmountNum,
        base_amount: base_amount ?? null,
        base_currency: baseCurrencyISO ?? null,
        service_allocations: serviceAllocationsForReceipt,
        payments: normalizedPayments.map((p) => ({
          amount: p.amount,
          payment_currency: p.payment_currency,
          fee_amount: p.fee_amount,
        })),
      }, allocationScopeServiceIds
        ? {
            selectedServiceIds: allocationScopeServiceIds,
          }
        : undefined);

      const overpaidCurrencies: string[] = [];
      const overpaidByCurrency: Record<string, number> = {};
      const allCurrencies = new Set([
        ...Object.keys(remainingBeforeCurrent),
        ...Object.keys(currentPaidByCurrency),
      ]);
      for (const code of allCurrencies) {
        const remainingAfterCurrent = round2(
          (remainingBeforeCurrent[code] || 0) - (currentPaidByCurrency[code] || 0),
        );
        if (remainingAfterCurrent < -DEBT_TOLERANCE) {
          overpaidCurrencies.push(code);
          overpaidByCurrency[code] = round2(Math.abs(remainingAfterCurrent));
        }
      }

      if (overpaidCurrencies.length > 0) {
        if (!allowClientCreditExcess) {
          return res.status(400).json({
            error: `El recibo excede el saldo pendiente en ${overpaidCurrencies.join(", ")}.`,
          });
        }
        clientCreditExcessByCurrency = overpaidByCurrency;
        clientCreditClientId =
          requestedClientCreditClientId ?? normalizedClientIds[0] ?? null;
        if (!clientCreditClientId) {
          return res.status(400).json({
            error:
              "Para dejar excedente en cuenta crédito/corriente, seleccioná un pax.",
          });
        }
      }
    }

    // Validar clientIds contra la reserva (solo si hay booking)
    if (
      hasBooking &&
      (normalizedClientIds.length > 0 || clientCreditClientId != null)
    ) {
      const bk = await prisma.booking.findUnique({
        where: { id_booking: bookingId },
        select: {
          titular_id: true,
          clients: { select: { id_client: true } },
        },
      });

      if (!bk) {
        return res.status(400).json({ error: "La reserva no existe" });
      }

      const allowed = new Set<number>();
      if (bk.titular_id) allowed.add(bk.titular_id);
      bk.clients.forEach((c) => allowed.add(c.id_client));

      const badClients = normalizedClientIds.filter((id) => !allowed.has(id));

      if (badClients.length > 0) {
        return res
          .status(400)
          .json({ error: "Algún pax no pertenece a la reserva" });
      }

      if (clientCreditClientId != null && !allowed.has(clientCreditClientId)) {
        return res.status(400).json({
          error:
            "El pax elegido para cuenta crédito/corriente no pertenece a la reserva.",
        });
      }
      if (
        clientCreditClientId != null &&
        !normalizedClientIds.includes(clientCreditClientId)
      ) {
        normalizedClientIds = [...normalizedClientIds, clientCreditClientId];
      }
    }

    const receipt_number = hasBooking
      ? await nextReceiptNumberForBooking(bookingId)
      : await nextReceiptNumberForAgency(authAgencyId);

    // legacy fields: si hay payments => seteo ids a nivel Receipt (primera línea)
    const legacyPmId = hasPayments
      ? normalizedPayments[0].payment_method_id
      : Number.isFinite(Number(payment_method_id)) &&
          Number(payment_method_id) > 0
        ? Number(payment_method_id)
        : undefined;

    const legacyAccId = hasPayments
      ? normalizedPayments[0].account_id
      : Number.isFinite(Number(account_id)) && Number(account_id) > 0
        ? Number(account_id)
        : undefined;

    const data: Prisma.ReceiptCreateInput = {
      receipt_number,
      concept,
      amount: amountNum,
      amount_string: amountString,
      amount_currency: amountCurrencyISO,
      currency: isNonEmptyString(currency) ? currency : amountCurrencyISO,
      serviceIds: serviceIdsForReceipt,
      clientIds: normalizedClientIds,
      issue_date: parsedIssueDate ?? new Date(),

      // legacy texto (para no romper listados viejos)
      ...(isNonEmptyString(payment_method) ? { payment_method } : {}),
      ...(isNonEmptyString(account) ? { account } : {}),

      // ids a nivel Receipt (existen en tu schema)
      ...(legacyPmId ? { payment_method_id: legacyPmId } : {}),
      ...(legacyAccId ? { account_id: legacyAccId ?? undefined } : {}),

      ...(toDec(base_amount) ? { base_amount: toDec(base_amount) } : {}),
      ...(baseCurrencyISO ? { base_currency: baseCurrencyISO } : {}),
      ...(toDec(counter_amount)
        ? { counter_amount: toDec(counter_amount) }
        : {}),
      ...(counterCurrencyISO ? { counter_currency: counterCurrencyISO } : {}),
      ...(toDec(paymentFeeAmountNum) ? { payment_fee_amount: toDec(paymentFeeAmountNum) } : {}),

      agency: { connect: { id_agency: authAgencyId } },
      ...(hasBooking
        ? { booking: { connect: { id_booking: bookingId } } }
        : {}),
    };

    // ---- Crear recibo + payments en transacción
    const createdReceipt = await prisma.$transaction(async (tx) => {
      const agencyReceiptId = await getNextAgencyCounter(
        tx,
        authAgencyId,
        "receipt",
      );
      const created = await tx.receipt.create({
        data: {
          ...data,
          agency_receipt_id: agencyReceiptId,
        },
      });

      if (hasPayments && schemaFlags.hasPaymentLines) {
        await tx.receiptPayment.createMany({
          data: normalizedPayments.map((p) => ({
            receipt_id: created.id_receipt,
            amount: new Prisma.Decimal(Number(p.amount)),
            payment_method_id: Number(p.payment_method_id),
            account_id: p.account_id ? Number(p.account_id) : null,
            ...(schemaFlags.hasPaymentCurrency
              ? {
                  payment_currency: normalizeCurrency(
                    p.payment_currency || amountCurrencyISO,
                  ),
                }
              : {}),
            ...(schemaFlags.hasPaymentFeeMode ? { fee_mode: p.fee_mode ?? null } : {}),
            ...(schemaFlags.hasPaymentFeeValue
              ? {
                  fee_value:
                    p.fee_value != null
                      ? new Prisma.Decimal(Number(p.fee_value))
                      : null,
                }
              : {}),
            ...(schemaFlags.hasPaymentFeeAmount
              ? {
                  fee_amount:
                    p.fee_amount != null
                      ? new Prisma.Decimal(Number(p.fee_amount))
                      : null,
                }
              : {}),
          })),
        });
      }

      if (serviceAllocationsForReceipt.length > 0) {
        await tx.receiptServiceAllocation.createMany({
          data: serviceAllocationsForReceipt.map((alloc) => ({
            receipt_id: created.id_receipt,
            service_id: alloc.service_id,
            amount_service: new Prisma.Decimal(Number(alloc.amount_service)),
            service_currency: normalizeCurrency(
              alloc.service_currency || "ARS",
            ),
          })),
        });
      }

      return created;
    });

    res.setHeader("Location", `/api/receipts/${createdReceipt.id_receipt}`);
    res.setHeader("X-Receipt-Id", String(createdReceipt.id_receipt));

    const full = await prisma.receipt.findUnique({
      where: { id_receipt: createdReceipt.id_receipt },
      include: {
        ...(schemaFlags.hasPaymentLines
          ? {
              payments: { select: buildReceiptPaymentSelect(schemaFlags) },
            }
          : {}),
        service_allocations: {
          select: RECEIPT_SERVICE_ALLOCATION_SELECT,
        },
      },
    });

    const createdPublicId =
      createdReceipt.agency_receipt_id != null
        ? encodePublicId({
            t: "receipt",
            a: authAgencyId,
            i: createdReceipt.agency_receipt_id,
          })
        : null;

    const clientCreditExcessPayload =
      clientCreditClientId != null &&
      Object.keys(clientCreditExcessByCurrency).length > 0
        ? {
            client_id: clientCreditClientId,
            by_currency: clientCreditExcessByCurrency,
          }
        : null;

    return res.status(201).json({
      receipt: full
        ? {
            ...full,
            public_id: createdPublicId,
            payments: normalizePaymentsFromReceipt(full),
            service_allocations: normalizeServiceAllocationsFromReceipt(full),
          }
        : { ...createdReceipt, public_id: createdPublicId },
      ...(clientCreditExcessPayload
        ? { client_credit_excess: clientCreditExcessPayload }
        : {}),
    });
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.log("[API] POST /api/receipts error:", error);
    const msg =
      error instanceof Error ? error.message : "Error interno al crear recibo";
    return res.status(500).json({ error: msg });
  }
}

/* ======================================================
 * Router principal
 * ====================================================== */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
