// src/pages/api/receipts/[id].ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { decodePublicId, encodePublicId } from "@/lib/publicIds";
import { Prisma } from "@prisma/client";
import { jwtVerify, JWTPayload } from "jose";
import {
  canAccessBookingByRole,
  getBookingComponentGrants,
  getFinanceSectionGrants,
} from "@/lib/accessControl";
import {
  canAccessBookingComponent,
  canAccessFinanceSection,
} from "@/utils/permissions";
import { hasSchemaColumn } from "@/lib/schemaColumns";
import { extractReceiptServiceSelectionModeFromBookingAccessRules } from "@/utils/receiptServiceSelection";

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

type ReceiptFeeMode = "FIXED" | "PERCENT";

type ReceiptPaymentOut = {
  amount: number;
  payment_method_id: number | null;
  account_id: number | null;
  payment_currency?: string | null;
  fee_mode?: ReceiptFeeMode | null;
  fee_value?: number | null;
  fee_amount?: number | null;
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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

const CREDIT_DOC_SIGN: Record<string, number> = {
  receipt: 1,
  investment: -1,
  adjust_up: 1,
  adjust_down: -1,
};

const normDocType = (s?: string | null) => (s || "").trim().toLowerCase();
const creditSignForDoc = (dt?: string | null) =>
  CREDIT_DOC_SIGN[normDocType(dt)] ?? 1;

const toDec = (v: unknown) =>
  v === undefined || v === null || v === ""
    ? undefined
    : new Prisma.Decimal(typeof v === "number" ? v : String(v));

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? NaN);
  return n;
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

const isNonEmptyString = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0;

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
    const role = (p.role || "") as string | undefined;
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

async function deleteCreditEntriesForReceipt(
  tx: Prisma.TransactionClient,
  receiptId: number,
  agencyId: number,
) {
  const entries = await tx.creditEntry.findMany({
    where: { receipt_id: receiptId, id_agency: agencyId },
    select: {
      id_entry: true,
      account_id: true,
      amount: true,
      doc_type: true,
    },
  });

  for (const entry of entries) {
    const account = await tx.creditAccount.findUnique({
      where: { id_credit_account: entry.account_id },
      select: { balance: true },
    });

    if (account) {
      const delta = new Prisma.Decimal(entry.amount).mul(
        new Prisma.Decimal(creditSignForDoc(entry.doc_type)),
      );
      const next = account.balance.minus(delta);
      await tx.creditAccount.update({
        where: { id_credit_account: entry.account_id },
        data: { balance: next },
      });
    }

    await tx.creditEntry.delete({ where: { id_entry: entry.id_entry } });
  }
}

function normalizePaymentsFromReceipt(r: unknown): ReceiptPaymentOut[] {
  if (!r || typeof r !== "object") return [];
  const obj = r as Record<string, unknown>;
  const rel = Array.isArray(obj.payments) ? obj.payments : [];
  if (rel.length > 0) {
    return rel.map((p) => {
      const pay = (p ?? {}) as Record<string, unknown>;
      const feeValueRaw = toNum(pay.fee_value);
      const feeAmountRaw = toNum(pay.fee_amount);
      return {
        amount: Number(pay.amount ?? 0),
        payment_method_id:
          Number.isFinite(Number(pay.payment_method_id)) &&
          Number(pay.payment_method_id) > 0
            ? Number(pay.payment_method_id)
            : null,
        account_id:
          Number.isFinite(Number(pay.account_id)) && Number(pay.account_id) > 0
            ? Number(pay.account_id)
            : null,
        payment_currency: normalizeCurrency(
          pay.payment_currency ?? obj.amount_currency ?? "ARS",
        ),
        fee_mode: normalizeReceiptFeeMode(pay.fee_mode),
        fee_value: Number.isFinite(feeValueRaw) ? feeValueRaw : null,
        fee_amount: Number.isFinite(feeAmountRaw) ? feeAmountRaw : null,
      };
    });
  }

  const amt = Number(obj.amount ?? 0);
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

type ReceiptDebtView = {
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
) {
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
      (Math.abs(feeRemainder) > DEBT_TOLERANCE &&
      baseCurrency === amountCurrency
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

// Seguridad: aceptar recibos con booking o con agencia
async function ensureReceiptInAgency(receiptId: number, agencyId: number) {
  const r = await prisma.receipt.findUnique({
    where: { id_receipt: receiptId },
    select: {
      id_receipt: true,
      id_agency: true,
      booking: { select: { id_agency: true } },
    },
  });
  if (!r) throw new Error("Recibo no encontrado");
  const belongs = r.booking
    ? r.booking.id_agency === agencyId
    : r.id_agency === agencyId;
  if (!belongs) throw new Error("No autorizado para este recibo");
}

// validar que la reserva exista y pertenezca a la agencia
async function ensureBookingInAgency(bookingId: number, agencyId: number) {
  const b = await prisma.booking.findUnique({
    where: { id_booking: bookingId },
    select: { id_booking: true, id_agency: true },
  });
  if (!b) throw new Error("La reserva no existe");
  if (b.id_agency !== agencyId)
    throw new Error("Reserva no pertenece a tu agencia");
}

type PatchBody = {
  booking?: { id_booking?: number };
  serviceIds?: number[];
  serviceAllocations?: ReceiptServiceAllocationIn[];
  service_allocations?: ReceiptServiceAllocationIn[];
  clientIds?: number[];

  concept?: string;
  currency?: string;
  amountString?: string;
  amountCurrency?: string;
  amount?: number | string;
  payments?: ReceiptPaymentLineIn[];
  payment_fee_amount?: number | string;
  payment_method?: string;
  account?: string;
  payment_method_id?: number;
  account_id?: number;
  base_amount?: number | string;
  base_currency?: string;
  counter_amount?: number | string;
  counter_currency?: string;
  issue_date?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const rawId = req.query.id;
  if (!rawId || Array.isArray(rawId)) {
    return res.status(400).json({ error: "ID inválido" });
  }
  const rawIdStr = String(rawId);
  const parsedId = Number(rawIdStr);
  const decoded =
    Number.isFinite(parsedId) && parsedId > 0
      ? null
      : decodePublicId(rawIdStr);
  if (decoded && decoded.t !== "receipt") {
    return res.status(400).json({ error: "ID inválido" });
  }
  if (!decoded && (!Number.isFinite(parsedId) || parsedId <= 0)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const authUser = await getUserFromAuth(req);
  const authUserId = authUser?.id_user;
  const authAgencyId = authUser?.id_agency;
  const authRole = authUser?.role ?? "";
  if (!authUserId || !authAgencyId) {
    return res.status(401).json({ error: "No autenticado" });
  }
  const auth = authUser as DecodedUser;

  const financeGrants = await getFinanceSectionGrants(
    authAgencyId,
    authUserId,
  );
  const bookingGrants = await getBookingComponentGrants(
    authAgencyId,
    authUserId,
  );
  const canReceipts = canAccessFinanceSection(
    authRole,
    financeGrants,
    "receipts",
  );
  const canReceiptsForm = canAccessBookingComponent(
    authRole,
    bookingGrants,
    "receipts_form",
  );

  const id = decoded
    ? (
        await prisma.receipt.findFirst({
          where: { id_agency: authAgencyId, agency_receipt_id: decoded.i },
          select: { id_receipt: true },
        })
      )?.id_receipt
    : parsedId;
  if (!id) {
    return res.status(404).json({ error: "Recibo no encontrado" });
  }
  const schemaFlags = await getReceiptSchemaFlags();

  if (req.method === "GET") {
    try {
      await ensureReceiptInAgency(id, authAgencyId);
      const receipt = await prisma.receipt.findUnique({
        where: { id_receipt: id },
        include: {
          booking: true,
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
      if (!receipt)
        return res.status(404).json({ error: "Recibo no encontrado" });
      const canReadByRole = receipt.booking
        ? await canAccessBookingByRole(auth, {
            id_user: receipt.booking.id_user,
            id_agency: receipt.booking.id_agency,
          })
        : false;
      if (!canReceipts && !canReceiptsForm && !canReadByRole) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      const public_id =
        receipt.agency_receipt_id != null && receipt.id_agency != null
          ? encodePublicId({
              t: "receipt",
              a: receipt.id_agency,
              i: receipt.agency_receipt_id,
            })
          : null;
      const { booking, ...receiptData } = receipt;
      void booking;

      return res.status(200).json({
        receipt: {
          ...receiptData,
          public_id,
          payments: normalizePaymentsFromReceipt(receipt),
          service_allocations: normalizeServiceAllocationsFromReceipt(receipt),
        },
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Error al obtener el recibo";
      const status = msg.includes("No autorizado")
        ? 403
        : msg.includes("no encontrado")
          ? 404
          : 500;
      return res.status(status).json({ error: msg });
    }
  }

  if (req.method === "DELETE") {
    if (!canReceipts) {
      return res.status(403).json({ error: "Sin permisos" });
    }
    try {
      await ensureReceiptInAgency(id, authAgencyId);
      await prisma.$transaction(async (tx) => {
        await deleteCreditEntriesForReceipt(tx, id, authAgencyId);

        const linkedPayments = await tx.clientPayment.findMany({
          where: { id_agency: authAgencyId, receipt_id: id },
          select: { id_payment: true, status: true },
        });

        if (linkedPayments.length > 0) {
          const linkedIds = linkedPayments.map((p) => p.id_payment);

          await tx.clientPayment.updateMany({
            where: { id_payment: { in: linkedIds } },
            data: {
              status: "PENDIENTE",
              paid_at: null,
              paid_by: null,
              receipt_id: null,
              status_reason: `Recibo ${id} eliminado. Cuota reabierta.`,
            },
          });

          await tx.clientPaymentAudit.createMany({
            data: linkedPayments.map((p) => ({
              client_payment_id: p.id_payment,
              id_agency: authAgencyId,
              action: "RECEIPT_DELETED_REOPEN",
              from_status: p.status,
              to_status: "PENDIENTE",
              reason: `Se elimino el recibo #${id}. Cuota reabierta.`,
              changed_by: authUserId,
              data: {
                receipt_id: id,
              },
            })),
          });
        }

        await tx.receipt.delete({ where: { id_receipt: id } });
      });
      return res.status(204).end();
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : "No se pudo eliminar el recibo";
      const status = msg.includes("No autorizado")
        ? 403
        : msg.includes("no encontrado")
          ? 404
          : 500;
      return res.status(status).json({ error: msg });
    }
  }

  // Attach vía PATCH (igual que tenías)
  if (req.method === "PATCH") {
    try {
      const body = (req.body || {}) as PatchBody;
      const bookingId = Number(body.booking?.id_booking);
      const serviceIds = normalizeIdList(body.serviceIds);
      const isAttach = Number.isFinite(bookingId) || serviceIds.length > 0;

      if (!canReceipts && !canReceiptsForm) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      await ensureReceiptInAgency(id, authAgencyId);

      if (!canReceipts && !isAttach) {
        const linkedReceipt = await prisma.receipt.findUnique({
          where: { id_receipt: id },
          select: {
            bookingId_booking: true,
            booking: {
              select: {
                id_user: true,
                id_agency: true,
              },
            },
          },
        });

        if (!linkedReceipt?.bookingId_booking || !linkedReceipt.booking) {
          return res.status(403).json({ error: "Sin permisos" });
        }

        const canEditByRole = await canAccessBookingByRole(auth, {
          id_user: linkedReceipt.booking.id_user,
          id_agency: linkedReceipt.booking.id_agency,
        });
        if (!canEditByRole) {
          return res.status(403).json({ error: "Sin permisos" });
        }
      }

      if (isAttach) {
        if (!Number.isFinite(bookingId) || bookingId <= 0)
          return res.status(400).json({ error: "id_booking inválido" });

        await ensureBookingInAgency(bookingId, authAgencyId);

        const calcConfig = await prisma.serviceCalcConfig.findUnique({
          where: { id_agency: authAgencyId },
          select: { booking_access_rules: true },
        });
        const receiptServiceSelectionMode =
          extractReceiptServiceSelectionModeFromBookingAccessRules(
            calcConfig?.booking_access_rules,
          );

        const bookingServices = await prisma.service.findMany({
          where: { booking_id: bookingId },
          select: { id_service: true },
        });
        const allBookingServiceIds = bookingServices.map((s) => s.id_service);

        let resolvedServiceIds = serviceIds;
        if (receiptServiceSelectionMode === "booking") {
          resolvedServiceIds = allBookingServiceIds;
        } else if (
          receiptServiceSelectionMode === "optional" &&
          resolvedServiceIds.length === 0
        ) {
          resolvedServiceIds = allBookingServiceIds;
        } else if (
          receiptServiceSelectionMode === "required" &&
          resolvedServiceIds.length === 0
        ) {
          return res
            .status(400)
            .json({ error: "serviceIds debe contener al menos un ID" });
        }

        const ok = new Set(allBookingServiceIds);
        const bad = resolvedServiceIds.filter((sid) => !ok.has(sid));
        if (bad.length)
          return res
            .status(400)
            .json({ error: "Algún servicio no pertenece a la reserva" });

        let nextClientIds: number[] | undefined = undefined;
        if (Array.isArray(body.clientIds)) {
          if (body.clientIds.length) {
            const bk = await prisma.booking.findUnique({
              where: { id_booking: bookingId },
              select: {
                titular_id: true,
                clients: { select: { id_client: true } },
              },
            });
            const allowed = new Set<number>([
              bk!.titular_id,
              ...bk!.clients.map((c) => c.id_client),
            ]);
            const invalid = body.clientIds.filter((cid) => !allowed.has(cid));
            if (invalid.length)
              return res
                .status(400)
                .json({ error: "Algún pax no pertenece a la reserva" });
            nextClientIds = body.clientIds;
          } else {
            nextClientIds = [];
          }
        }

        const updated = await prisma.receipt.update({
          where: { id_receipt: id },
          data: {
            booking: { connect: { id_booking: bookingId } },
            agency: { disconnect: true },
            serviceIds: resolvedServiceIds,
            service_allocations: { deleteMany: {} },
            ...(nextClientIds !== undefined ? { clientIds: nextClientIds } : {}),
          },
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

        return res.status(200).json({
          receipt: {
            ...updated,
            payments: normalizePaymentsFromReceipt(updated),
            service_allocations: normalizeServiceAllocationsFromReceipt(updated),
          },
        });
      }

      const existing = await prisma.receipt.findUnique({
        where: { id_receipt: id },
        select: {
          id_receipt: true,
          bookingId_booking: true,
          serviceIds: true,
          service_allocations: {
            select: {
              service_id: true,
              amount_service: true,
              service_currency: true,
            },
          },
        },
      });

      if (!existing)
        return res.status(404).json({ error: "Recibo no encontrado" });

      const {
        concept,
        currency,
        amountString,
        amountCurrency,
        amount,
        payments,
        payment_fee_amount,
        payment_method,
        account,
        payment_method_id,
        account_id,
        base_amount,
        base_currency,
        counter_amount,
        counter_currency,
        serviceAllocations,
        service_allocations,
        clientIds,
        issue_date,
      } = body;

      const hasServiceAllocationsField =
        Object.prototype.hasOwnProperty.call(body, "serviceAllocations") ||
        Object.prototype.hasOwnProperty.call(body, "service_allocations");
      const parsedServiceAllocations = parseReceiptServiceAllocations(
        Array.isArray(serviceAllocations)
          ? serviceAllocations
          : service_allocations,
      );
      let normalizedServiceAllocationsForSave: ReceiptServiceAllocationNormalized[] =
        [];
      const normalizedExistingServiceAllocations: ReceiptServiceAllocationNormalized[] =
        Array.isArray(existing.service_allocations)
          ? existing.service_allocations
              .map((alloc) => ({
                service_id: Number(alloc.service_id),
                amount_service: round2(toNum(alloc.amount_service)),
                service_currency: normalizeCurrency(
                  alloc.service_currency || "ARS",
                ),
              }))
              .filter(
                (alloc) =>
                  Number.isFinite(alloc.service_id) &&
                  alloc.service_id > 0 &&
                  Number.isFinite(alloc.amount_service) &&
                  alloc.amount_service > 0,
              )
          : [];

      if (hasServiceAllocationsField) {
        if (!existing.bookingId_booking) {
          return res.status(400).json({
            error:
              "serviceAllocations solo se puede usar en recibos asociados a una reserva.",
          });
        }

        const bookingServices = await prisma.service.findMany({
          where: { booking_id: existing.bookingId_booking },
          select: { id_service: true, currency: true },
        });
        const serviceMap = new Map(
          bookingServices.map((service) => [service.id_service, service]),
        );
        const receiptServiceIds = normalizeIdList(existing.serviceIds);
        const receiptServiceSet = new Set(receiptServiceIds);
        const deduped = new Map<number, ReceiptServiceAllocationNormalized>();

        for (const alloc of parsedServiceAllocations) {
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

          const service = serviceMap.get(alloc.service_id);
          if (!service) {
            return res.status(400).json({
              error:
                "Algún servicio de serviceAllocations no pertenece a la reserva.",
            });
          }
          if (
            receiptServiceSet.size > 0 &&
            !receiptServiceSet.has(alloc.service_id)
          ) {
            return res.status(400).json({
              error:
                "serviceAllocations solo puede incluir servicios aplicados al recibo.",
            });
          }

          const serviceCurrency = normalizeCurrency(service.currency || "ARS");
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

        normalizedServiceAllocationsForSave = Array.from(deduped.values());
      }

      let nextClientIds: number[] | undefined = undefined;
      if (Array.isArray(clientIds)) {
        if (existing.bookingId_booking && clientIds.length > 0) {
          const bk = await prisma.booking.findUnique({
            where: { id_booking: existing.bookingId_booking },
            select: {
              titular_id: true,
              clients: { select: { id_client: true } },
            },
          });

          if (!bk) {
            return res.status(400).json({
              error: "La reserva asociada al recibo no existe.",
            });
          }

          const allowed = new Set<number>([
            bk.titular_id,
            ...bk.clients.map((c) => c.id_client),
          ]);
          const invalid = clientIds.filter((cid) => !allowed.has(cid));
          if (invalid.length) {
            return res
              .status(400)
              .json({ error: "Algún pax no pertenece a la reserva" });
          }
        }
        nextClientIds = clientIds;
      }

      let amountCurrencyISO = normalizeCurrency(amountCurrency || "");
      const baseCurrencyISO = base_currency
        ? base_currency.toUpperCase()
        : undefined;
      const counterCurrencyISO = counter_currency
        ? counter_currency.toUpperCase()
        : undefined;

      if (!isNonEmptyString(concept)) {
        return res.status(400).json({ error: "concept es requerido" });
      }
      if (!isNonEmptyString(amountString)) {
        return res.status(400).json({ error: "amountString es requerido" });
      }
      if (!isNonEmptyString(amountCurrencyISO) && !(Array.isArray(payments) && payments.length > 0)) {
        return res.status(400).json({
          error: "amountCurrency es requerido (ISO)",
        });
      }

      const parsedIssueDate = issue_date ? toLocalDate(issue_date) : undefined;
      if (issue_date && !parsedIssueDate) {
        return res.status(400).json({ error: "issue_date inválida" });
      }

      const hasPayments = Array.isArray(payments) && payments.length > 0;
      let normalizedPayments: ReceiptPaymentLineNormalized[] = [];
      let paymentFeeAmountNum = Number.isFinite(toNum(payment_fee_amount))
        ? Math.max(0, toNum(payment_fee_amount))
        : 0;

      if (hasPayments) {
        normalizedPayments = (payments || []).map((p) => {
          const amountValue = toNum(p.amount);
          const feeMode = normalizeReceiptFeeMode(p.fee_mode);
          const feeValueRaw = toNum(p.fee_value);
          const feeAmountRaw = toNum(p.fee_amount);
          const normalizedFee = normalizeReceiptPaymentFee({
            amount: Number.isFinite(amountValue) ? amountValue : 0,
            fee_mode: feeMode,
            fee_value: Number.isFinite(feeValueRaw) ? feeValueRaw : undefined,
            fee_amount: Number.isFinite(feeAmountRaw)
              ? feeAmountRaw
              : undefined,
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

        if (
          existing.bookingId_booking &&
          hasMixedPaymentCurrencies &&
          !hasBaseForMixed
        ) {
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
        paymentFeeAmountNum = round2(
          normalizedPayments.reduce((acc, p) => acc + (p.fee_amount || 0), 0),
        );
      }

      const legacyAmountNum = toNum(amount);
      const amountNum = hasPayments
        ? normalizedPayments.reduce((acc, p) => acc + Number(p.amount), 0)
        : legacyAmountNum;

      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        return res.status(400).json({ error: "amount numérico inválido" });
      }

      const serviceAllocationsForValidation = hasServiceAllocationsField
        ? normalizedServiceAllocationsForSave
        : normalizedExistingServiceAllocations;
      if (serviceAllocationsForValidation.length > 0) {
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

        const allocatedByCurrency = serviceAllocationsForValidation.reduce<
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

      const legacyPmId = hasPayments
        ? normalizedPayments[0]?.payment_method_id
        : Number.isFinite(Number(payment_method_id)) &&
            Number(payment_method_id) > 0
          ? Number(payment_method_id)
          : undefined;

      const legacyAccId = hasPayments
        ? normalizedPayments[0]?.account_id
        : Number.isFinite(Number(account_id)) && Number(account_id) > 0
          ? Number(account_id)
          : undefined;

      const updateData: Prisma.ReceiptUpdateInput = {
        concept: concept.trim(),
        amount: amountNum,
        amount_string: amountString.trim(),
        amount_currency: amountCurrencyISO,
        currency: isNonEmptyString(currency) ? currency : amountCurrencyISO,

        ...(isNonEmptyString(payment_method) ? { payment_method } : {}),
        ...(isNonEmptyString(account) ? { account } : {}),

        ...(legacyPmId ? { payment_method_id: legacyPmId } : {}),
        ...(legacyAccId ? { account_id: legacyAccId ?? undefined } : {}),

        ...(toDec(base_amount) ? { base_amount: toDec(base_amount) } : {}),
        ...(baseCurrencyISO ? { base_currency: baseCurrencyISO } : {}),
        ...(toDec(counter_amount)
          ? { counter_amount: toDec(counter_amount) }
          : {}),
        ...(counterCurrencyISO ? { counter_currency: counterCurrencyISO } : {}),
        ...(toDec(paymentFeeAmountNum)
          ? { payment_fee_amount: toDec(paymentFeeAmountNum) }
          : {}),

        ...(parsedIssueDate ? { issue_date: parsedIssueDate } : {}),
        ...(nextClientIds !== undefined ? { clientIds: nextClientIds } : {}),
      };

      const updated = await prisma.$transaction(async (tx) => {
        if (hasPayments) {
          if (!schemaFlags.hasPaymentCurrency) {
            const paymentCurrencies = Array.from(
              new Set(normalizedPayments.map((p) => p.payment_currency)),
            );
            if (paymentCurrencies.length > 1) {
              throw new Error(
                "Tu base no tiene soporte de moneda por línea. Aplicá la migración pendiente.",
              );
            }
          }

          if (schemaFlags.hasPaymentLines) {
            await tx.receiptPayment.deleteMany({ where: { receipt_id: id } });
            await tx.receiptPayment.createMany({
              data: normalizedPayments.map((p) => ({
                receipt_id: id,
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
                ...(schemaFlags.hasPaymentFeeMode
                  ? { fee_mode: p.fee_mode ?? null }
                  : {}),
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
        }

        if (hasServiceAllocationsField) {
          await tx.receiptServiceAllocation.deleteMany({
            where: { receipt_id: id },
          });
          if (normalizedServiceAllocationsForSave.length > 0) {
            await tx.receiptServiceAllocation.createMany({
              data: normalizedServiceAllocationsForSave.map((alloc) => ({
                receipt_id: id,
                service_id: alloc.service_id,
                amount_service: new Prisma.Decimal(
                  Number(alloc.amount_service),
                ),
                service_currency: normalizeCurrency(
                  alloc.service_currency || "ARS",
                ),
              })),
            });
          }
        }

        return tx.receipt.update({
          where: { id_receipt: id },
          data: updateData,
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
      });

      return res.status(200).json({
        receipt: {
          ...updated,
          payments: normalizePaymentsFromReceipt(updated),
          service_allocations: normalizeServiceAllocationsFromReceipt(updated),
        },
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Error actualizando recibo";
      const status = msg.includes("No autorizado")
        ? 403
        : msg.includes("migración pendiente")
          ? 400
        : msg.includes("no existe") || msg.includes("no encontrado")
          ? 404
          : 500;
      return res.status(status).json({ error: msg });
    }
  }

  res.setHeader("Allow", ["GET", "DELETE", "PATCH"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
