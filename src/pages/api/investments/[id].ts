// src/pages/api/investments/[id].ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { encodePublicId } from "@/lib/publicIds";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify, type JWTPayload } from "jose";
import {
  getBookingComponentGrants,
  getFinanceSectionGrants,
} from "@/lib/accessControl";
import {
  canAccessBookingComponent,
  canAccessFinanceSection,
} from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { hasSchemaColumn } from "@/lib/schemaColumns";
import { parseDateInputInBuenosAires } from "@/lib/buenosAiresDate";

/** ===== Auth helpers (unificado con otros endpoints) ===== */
type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  role?: string;
  email?: string;
};
type DecodedAuth = {
  id_user: number;
  id_agency: number;
  role: string;
  email?: string;
};

// Mismo criterio que clients/index.ts e investments/index.ts
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

// Cookie "token" primero; luego Authorization: Bearer; luego otras cookies comunes
function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;

  const a = req.headers.authorization || "";
  if (a.startsWith("Bearer ")) return a.slice(7);

  const c = req.cookies || {};
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    const v = c[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function getUserFromAuth(
  req: NextApiRequest,
): Promise<DecodedAuth | null> {
  try {
    const tok = getTokenFromRequest(req);
    if (!tok) return null;

    const { payload } = await jwtVerify(
      tok,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || undefined;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    const role = String(p.role || "").toLowerCase();
    const email = p.email;

    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u) {
        return {
          id_user,
          id_agency: u.id_agency,
          role: role || u.role.toLowerCase(),
          email: email ?? u.email ?? undefined,
        };
      }
    }

    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true },
      });
      if (u) {
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role.toLowerCase(),
          email,
        };
      }
    }

    if (!id_user || !id_agency) return null;
    return { id_user, id_agency, role, email: email ?? undefined };
  } catch {
    return null;
  }
}

/** ===== Utils ===== */
function toLocalDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}
function safeNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
// Igual que en receipts/investments index: Decimal opcional
const toDec = (v: unknown) =>
  v === undefined || v === null || v === ""
    ? undefined
    : new Prisma.Decimal(typeof v === "number" ? v : String(v));
// Normaliza updates string: string -> trimmed | null -> null | else -> undefined (no tocar)
const normStrUpdate = (
  v: unknown,
  opts?: { upper?: boolean; allowEmpty?: boolean },
): string | null | undefined => {
  if (v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t && !opts?.allowEmpty) return undefined;
    return opts?.upper ? t.toUpperCase() : t;
  }
  return undefined;
};

// ===== Crédito operador: helpers internos (cascade) =====
const CREDIT_METHOD = "Crédito operador";
const normSoft = (s?: string | null) =>
  (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

async function getOperatorCategoryNames(
  agencyId: number,
): Promise<string[]> {
  const hasScope = await hasSchemaColumn("ExpenseCategory", "scope");
  const rows = await prisma.expenseCategory.findMany({
    where: hasScope
      ? {
          id_agency: agencyId,
          scope: "INVESTMENT",
          requires_operator: true,
        }
      : { id_agency: agencyId, requires_operator: true },
    select: { name: true },
  });
  return rows.map((r) => r.name).filter((n) => typeof n === "string");
}

async function getUserCategoryNames(agencyId: number): Promise<string[]> {
  const hasScope = await hasSchemaColumn("ExpenseCategory", "scope");
  const rows = await prisma.expenseCategory.findMany({
    where: hasScope
      ? {
          id_agency: agencyId,
          scope: "INVESTMENT",
          requires_user: true,
        }
      : { id_agency: agencyId, requires_user: true },
    select: { name: true },
  });
  return rows.map((r) => r.name).filter((n) => typeof n === "string");
}

function buildOperatorCategorySet(names: string[]): Set<string> {
  const set = new Set<string>();
  for (const name of names) {
    const n = normSoft(name);
    if (n) set.add(n);
  }
  return set;
}

function buildUserCategorySet(names: string[]): Set<string> {
  const set = new Set<string>();
  for (const name of names) {
    const n = normSoft(name);
    if (n) set.add(n);
  }
  return set;
}

function isOperatorCategoryName(
  name: string,
  operatorCategorySet?: Set<string>,
) {
  const n = normSoft(name);
  if (!n) return false;
  if (n.startsWith("operador")) return true;
  return operatorCategorySet ? operatorCategorySet.has(n) : false;
}

function isUserCategoryName(name: string, userCategorySet?: Set<string>) {
  const n = normSoft(name);
  if (!n) return false;
  if (
    n === "sueldo" ||
    n === "sueldos" ||
    n === "comision" ||
    n === "comisiones"
  )
    return true;
  return userCategorySet ? userCategorySet.has(n) : false;
}

function parseServiceIds(raw: unknown): number[] {
  const ids: number[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) ids.push(Math.trunc(n));
    }
  } else if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(",")) {
      const n = Number(part.trim());
      if (Number.isFinite(n) && n > 0) ids.push(Math.trunc(n));
    }
  }
  return Array.from(new Set(ids));
}

const ASSIGNMENT_TOLERANCE = 0.01;
const INVESTMENT_FEE_MODES = new Set(["FIXED", "PERCENT"] as const);
const INVESTMENT_PAYMENT_LINE_SELECT = {
  id_investment_payment: true,
  amount: true,
  payment_method: true,
  account: true,
  payment_currency: true,
  fee_mode: true,
  fee_value: true,
  fee_amount: true,
} satisfies Prisma.InvestmentPaymentSelect;

type InvestmentSchemaFlags = {
  hasPaymentFeeAmount: boolean;
  hasPaymentLines: boolean;
};

async function getInvestmentSchemaFlags(): Promise<InvestmentSchemaFlags> {
  const [hasPaymentFeeAmount, hasPaymentLines] = await Promise.all([
    hasSchemaColumn("Investment", "payment_fee_amount"),
    hasSchemaColumn("InvestmentPayment", "id_investment_payment"),
  ]);
  return { hasPaymentFeeAmount, hasPaymentLines };
}

function buildInvestmentFullSelect(
  flags: InvestmentSchemaFlags,
  includeAllocations = false,
): Prisma.InvestmentSelect {
  return {
    id_investment: true,
    agency_investment_id: true,
    id_agency: true,
    category: true,
    description: true,
    counterparty_name: true,
    amount: true,
    currency: true,
    created_at: true,
    paid_at: true,
    payment_method: true,
    account: true,
    ...(flags.hasPaymentFeeAmount ? { payment_fee_amount: true } : {}),
    base_amount: true,
    base_currency: true,
    counter_amount: true,
    counter_currency: true,
    excess_action: true,
    excess_missing_account_action: true,
    operator_id: true,
    user_id: true,
    created_by: true,
    booking_id: true,
    serviceIds: true,
    recurring_id: true,
    user: { select: { id_user: true, first_name: true, last_name: true } },
    operator: true,
    ...(flags.hasPaymentLines
      ? { payments: { select: INVESTMENT_PAYMENT_LINE_SELECT } }
      : {}),
    createdBy: {
      select: { id_user: true, first_name: true, last_name: true },
    },
    booking: {
      select: { id_booking: true, agency_booking_id: true },
    },
    ...(includeAllocations ? { allocations: true } : {}),
  };
}

type InvestmentPaymentFeeMode = "FIXED" | "PERCENT";
type InvestmentPaymentLineIn = {
  amount?: unknown;
  payment_method?: unknown;
  account?: unknown;
  payment_currency?: unknown;
  fee_mode?: unknown;
  fee_value?: unknown;
  fee_amount?: unknown;
};

type InvestmentPaymentLineNormalized = {
  amount: number;
  payment_method: string;
  account?: string;
  payment_currency: string;
  fee_mode?: InvestmentPaymentFeeMode;
  fee_value?: number;
  fee_amount: number;
};

const normalizePaymentCurrency = (value: unknown): string => {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) return "ARS";
  if (["US$", "U$S", "U$D", "DOL"].includes(code)) return "USD";
  if (["$", "AR$"].includes(code)) return "ARS";
  return code;
};

const normalizeInvestmentFeeMode = (
  value: unknown,
): InvestmentPaymentFeeMode | null => {
  if (typeof value !== "string") return null;
  const mode = value.trim().toUpperCase() as InvestmentPaymentFeeMode;
  return INVESTMENT_FEE_MODES.has(mode) ? mode : null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const normalizeInvestmentPaymentFee = (line: {
  amount: number;
  fee_mode?: InvestmentPaymentFeeMode | null;
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

  if (!mode) return round2(Math.max(0, explicitAmount ?? 0));
  if (mode === "PERCENT") {
    return round2(Math.max(0, line.amount) * (Math.max(0, value ?? 0) / 100));
  }
  return round2(Math.max(0, value ?? 0));
};

const normalizeInvestmentPayments = (
  raw: unknown,
  fallbackCurrency: string,
): InvestmentPaymentLineNormalized[] => {
  if (!Array.isArray(raw)) return [];
  const out: InvestmentPaymentLineNormalized[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as InvestmentPaymentLineIn;
    const amount = Number(rec.amount);
    const payment_method =
      typeof rec.payment_method === "string"
        ? rec.payment_method.trim()
        : "";
    if (!Number.isFinite(amount) || amount <= 0 || !payment_method) continue;

    const account =
      typeof rec.account === "string" && rec.account.trim()
        ? rec.account.trim()
        : undefined;
    const payment_currency = normalizePaymentCurrency(
      rec.payment_currency ?? fallbackCurrency,
    );
    const fee_mode = normalizeInvestmentFeeMode(rec.fee_mode);
    const fee_value = Number(rec.fee_value);
    const fee_amount_raw = Number(rec.fee_amount);
    const fee_amount = normalizeInvestmentPaymentFee({
      amount,
      fee_mode,
      fee_value: Number.isFinite(fee_value) ? fee_value : undefined,
      fee_amount: Number.isFinite(fee_amount_raw) ? fee_amount_raw : undefined,
    });

    out.push({
      amount,
      payment_method,
      account,
      payment_currency,
      fee_mode: fee_mode ?? undefined,
      fee_value:
        fee_mode != null
          ? Number.isFinite(fee_value)
            ? Math.max(0, fee_value)
            : 0
          : undefined,
      fee_amount,
    });
  }
  return out;
};

type AllocationInput = {
  service_id: number;
  booking_id?: number | null;
  payment_currency?: string;
  service_currency?: string;
  amount_payment?: number;
  amount_service?: number;
  fx_rate?: number | null;
};

type AllocationNormalized = {
  service_id: number;
  booking_id: number;
  payment_currency: string;
  service_currency: string;
  amount_payment: number;
  amount_service: number;
  fx_rate: number | null;
};

function parseAllocations(raw: unknown): AllocationInput[] {
  if (!Array.isArray(raw)) return [];
  const out: AllocationInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const serviceIdRaw =
      rec.service_id ?? rec.serviceId ?? rec.id_service ?? rec.idService;
    const service_id = Number(serviceIdRaw);
    if (!Number.isFinite(service_id) || service_id <= 0) continue;
    const amount_payment = Number(
      rec.amount_payment ?? rec.amountPayment ?? 0,
    );
    const amount_service = Number(
      rec.amount_service ?? rec.amountService ?? 0,
    );
    const fx_rate_raw = rec.fx_rate ?? rec.fxRate;
    const fx_rate =
      fx_rate_raw === null || fx_rate_raw === undefined || fx_rate_raw === ""
        ? null
        : Number(fx_rate_raw);
    const booking_raw = rec.booking_id ?? rec.bookingId;
    const booking_id =
      booking_raw === null || booking_raw === undefined || booking_raw === ""
        ? undefined
        : Number(booking_raw);
    const payment_currency =
      typeof rec.payment_currency === "string"
        ? rec.payment_currency
        : typeof rec.paymentCurrency === "string"
          ? rec.paymentCurrency
          : undefined;
    const service_currency =
      typeof rec.service_currency === "string"
        ? rec.service_currency
        : typeof rec.serviceCurrency === "string"
          ? rec.serviceCurrency
          : undefined;

    out.push({
      service_id: Math.trunc(service_id),
      booking_id:
        Number.isFinite(Number(booking_id)) && Number(booking_id) > 0
          ? Math.trunc(Number(booking_id))
          : undefined,
      payment_currency,
      service_currency,
      amount_payment: Number.isFinite(amount_payment) ? amount_payment : 0,
      amount_service: Number.isFinite(amount_service) ? amount_service : 0,
      fx_rate: Number.isFinite(fx_rate as number) ? Number(fx_rate) : null,
    });
  }
  return out;
}

type ServicePick = {
  id_service: number;
  booking_id: number;
  id_operator: number;
  currency: string;
  cost_price: number | null;
};

async function getServicesByIds(
  agencyId: number,
  ids: number[],
): Promise<ServicePick[]> {
  if (ids.length === 0) return [];
  return prisma.service.findMany({
    where: { id_service: { in: ids }, id_agency: agencyId },
    select: {
      id_service: true,
      booking_id: true,
      id_operator: true,
      currency: true,
      cost_price: true,
    },
  });
}

const DOC_SIGN: Record<string, number> = { investment: -1, receipt: 1 };
const normDoc = (s?: string | null) => (s || "").trim().toLowerCase();
const signForDocType = (dt?: string | null) => DOC_SIGN[normDoc(dt)] ?? 1;
const deltaDecimal = (amountAbs: number, dt?: string | null) =>
  new Prisma.Decimal(Math.abs(amountAbs)).mul(signForDocType(dt));

async function removeLinkedCreditEntries(
  tx: Prisma.TransactionClient,
  investmentId: number,
  agencyId: number,
): Promise<number> {
  const entries = await tx.creditEntry.findMany({
    where: { id_agency: agencyId, investment_id: investmentId },
    select: { id_entry: true, account_id: true, amount: true, doc_type: true },
  });

  for (const e of entries) {
    const acc = await tx.creditAccount.findUnique({
      where: { id_credit_account: e.account_id },
      select: { balance: true },
    });
    if (!acc) continue;

    // Revertir el efecto que aplicó el alta: balance -= sign(dt) * amount
    const next = acc.balance.minus(deltaDecimal(Number(e.amount), e.doc_type));
    await tx.creditAccount.update({
      where: { id_credit_account: e.account_id },
      data: { balance: next },
    });

    await tx.creditEntry.delete({ where: { id_entry: e.id_entry } });
  }

  return entries.length;
}

async function findOrCreateOperatorCreditAccount(
  tx: Prisma.TransactionClient,
  agencyId: number,
  operatorId: number,
  currency: string,
): Promise<number> {
  const existing = await tx.creditAccount.findFirst({
    where: {
      id_agency: agencyId,
      operator_id: operatorId,
      client_id: null,
      currency,
    },
    select: { id_credit_account: true },
  });
  if (existing) return existing.id_credit_account;

  const agencyAccountId = await getNextAgencyCounter(
    tx,
    agencyId,
    "credit_account",
  );
  const created = await tx.creditAccount.create({
    data: {
      id_agency: agencyId,
      agency_credit_account_id: agencyAccountId,
      operator_id: operatorId,
      client_id: null,
      currency,
      balance: new Prisma.Decimal(0),
      enabled: true,
    },
    select: { id_credit_account: true },
  });
  return created.id_credit_account;
}

async function findOperatorCreditAccount(
  tx: Prisma.TransactionClient,
  agencyId: number,
  operatorId: number,
  currency: string,
): Promise<number | null> {
  const existing = await tx.creditAccount.findFirst({
    where: {
      id_agency: agencyId,
      operator_id: operatorId,
      client_id: null,
      currency,
    },
    select: { id_credit_account: true },
  });
  return existing?.id_credit_account ?? null;
}

async function createCreditEntryForInvestment(
  tx: Prisma.TransactionClient,
  agencyId: number,
  userId: number,
  inv: {
    id_investment: number;
    agency_investment_id?: number | null;
    operator_id: number;
    currency: string;
    amount: Prisma.Decimal | number; // <- acepta Decimal o number
    description: string | null;
    paid_at: Date | null;
  },
) {
  const account_id = await findOrCreateOperatorCreditAccount(
    tx,
    agencyId,
    inv.operator_id,
    inv.currency,
  );

  // Normaliza a number (Decimal -> number)
  const rawAmount =
    typeof inv.amount === "number"
      ? inv.amount
      : (inv.amount as Prisma.Decimal).toNumber();

  const amountAbs = Math.abs(rawAmount);

  const displayId = inv.agency_investment_id ?? inv.id_investment;

  const agencyEntryId = await getNextAgencyCounter(
    tx,
    agencyId,
    "credit_entry",
  );
  const entry = await tx.creditEntry.create({
    data: {
      id_agency: agencyId,
      agency_credit_entry_id: agencyEntryId,
      account_id,
      created_by: userId,
      concept: inv.description || `Gasto Operador N° ${displayId}`,
      amount: new Prisma.Decimal(amountAbs), // siempre positivo
      currency: inv.currency,
      doc_type: "investment", // aplica signo negativo al balance
      reference: `INV-${inv.id_investment}`,
      value_date: inv.paid_at,
      investment_id: inv.id_investment,
    },
    select: { id_entry: true },
  });

  // Aplicar efecto en balance (investment => negativo)
  const acc = await tx.creditAccount.findUnique({
    where: { id_credit_account: account_id },
    select: { balance: true },
  });
  if (acc) {
    const next = acc.balance.add(deltaDecimal(amountAbs, "investment"));
    await tx.creditAccount.update({
      where: { id_credit_account: account_id },
      data: { balance: next },
    });
  }

  return entry;
}

async function createCreditEntryForInvestmentAmount(
  tx: Prisma.TransactionClient,
  agencyId: number,
  userId: number,
  account_id: number,
  inv: {
    id_investment: number;
    agency_investment_id?: number | null;
    operator_id: number;
    currency: string;
    description: string | null;
    paid_at: Date | null;
  },
  amountAbs: number,
  opts?: { concept?: string; reference?: string; doc_type?: string },
) {
  const displayId = inv.agency_investment_id ?? inv.id_investment;
  const agencyEntryId = await getNextAgencyCounter(
    tx,
    agencyId,
    "credit_entry",
  );
  const entry = await tx.creditEntry.create({
    data: {
      id_agency: agencyId,
      agency_credit_entry_id: agencyEntryId,
      account_id,
      created_by: userId,
      concept:
        opts?.concept ||
        inv.description ||
        `Gasto Operador N° ${displayId}`,
      amount: new Prisma.Decimal(Math.abs(amountAbs)),
      currency: inv.currency,
      doc_type: opts?.doc_type || "investment",
      reference: opts?.reference || `INV-${inv.id_investment}`,
      value_date: inv.paid_at,
      investment_id: inv.id_investment,
    },
    select: { id_entry: true },
  });

  const acc = await tx.creditAccount.findUnique({
    where: { id_credit_account: account_id },
    select: { balance: true },
  });
  if (acc) {
    const next = acc.balance.add(
      deltaDecimal(Math.abs(amountAbs), opts?.doc_type || "investment"),
    );
    await tx.creditAccount.update({
      where: { id_credit_account: account_id },
      data: { balance: next },
    });
  }

  return entry;
}

function shouldHaveCreditEntry(
  payload: {
    category?: string | null;
    operator_id?: number | null;
    payment_method?: string | null;
  },
  operatorCategorySet?: Set<string>,
) {
  return (
    isOperatorCategoryName(payload.category || "", operatorCategorySet) &&
    !!payload.operator_id &&
    (payload.payment_method || "") === CREDIT_METHOD
  );
}

/** ===== Scoped getters ===== */
function getInvestmentLite(id_investment: number, id_agency: number) {
  return prisma.investment.findFirst({
    where: { id_investment, id_agency },
    select: {
      id_investment: true,
      category: true,
      operator_id: true,
      amount: true,
      currency: true,
      booking_id: true,
      serviceIds: true,
    },
  });
}

type InvestmentFullRecord = {
  id_investment: number;
  id_agency: number;
  category: string;
  booking: { id_booking: number; agency_booking_id: number | null } | null;
  payment_fee_amount?: unknown | null;
  payments?: unknown[];
  [key: string]: unknown;
};

function withCompatDefaults(
  item: InvestmentFullRecord,
  flags: InvestmentSchemaFlags,
): InvestmentFullRecord {
  return {
    ...item,
    ...(flags.hasPaymentFeeAmount ? {} : { payment_fee_amount: null }),
    ...(flags.hasPaymentLines ? {} : { payments: [] }),
  };
}

async function getInvestmentFull(
  id_investment: number,
  id_agency: number,
  flags: InvestmentSchemaFlags,
  includeAllocations = false,
): Promise<InvestmentFullRecord | null> {
  const result = (await prisma.investment.findFirst({
    where: { id_investment, id_agency },
    select: buildInvestmentFullSelect(flags, includeAllocations),
  })) as InvestmentFullRecord | null;
  return result ? withCompatDefaults(result, flags) : null;
}

/** ===== Handler ===== */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const auth = await getUserFromAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  const financeGrants = await getFinanceSectionGrants(
    auth.id_agency,
    auth.id_user,
  );
  const bookingGrants = await getBookingComponentGrants(
    auth.id_agency,
    auth.id_user,
  );
  const canInvestments = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "investments",
  );
  const canOperatorPaymentsSection = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "operator_payments",
  );
  const canOperatorPayments =
    canAccessBookingComponent(
      auth.role,
      bookingGrants,
      "operator_payments",
    ) || canOperatorPaymentsSection;
  if (!canInvestments && !canOperatorPayments) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const planAccess = await ensurePlanFeatureAccess(
    auth.id_agency,
    "investments",
  );
  const restrictToOperatorPayments = !planAccess.allowed;
  if (restrictToOperatorPayments && !canOperatorPayments) {
    return res.status(403).json({ error: "Plan insuficiente" });
  }

  let operatorCategorySet: Set<string> | undefined;
  const loadOperatorCategories = async () => {
    if (operatorCategorySet) return;
    const names = await getOperatorCategoryNames(auth.id_agency);
    operatorCategorySet = buildOperatorCategorySet(names);
  };
  let userCategorySet: Set<string> | undefined;
  const loadUserCategories = async () => {
    if (userCategorySet) return;
    const names = await getUserCategoryNames(auth.id_agency);
    userCategorySet = buildUserCategorySet(names);
  };

  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = safeNumber(idParam);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const schemaFlags = await getInvestmentSchemaFlags();

  if (req.method === "GET") {
    try {
      const includeAllocationsRaw = Array.isArray(
        req.query.includeAllocations,
      )
        ? req.query.includeAllocations[0]
        : req.query.includeAllocations;
      const includeAllocations =
        typeof includeAllocationsRaw === "string" &&
        (includeAllocationsRaw === "1" ||
          includeAllocationsRaw.toLowerCase() === "true");

      const inv = await getInvestmentFull(
        id,
        auth.id_agency,
        schemaFlags,
        includeAllocations,
      );
      if (!inv)
        return res.status(404).json({ error: "Inversión no encontrada" });
      if (restrictToOperatorPayments) {
        await loadOperatorCategories();
        if (!isOperatorCategoryName(inv.category, operatorCategorySet)) {
          return res.status(403).json({ error: "Plan insuficiente" });
        }
      }
      const payload = {
        ...inv,
        booking: inv.booking
          ? {
              ...inv.booking,
              public_id:
                inv.booking.agency_booking_id != null
                  ? encodePublicId({
                      t: "booking",
                      a: inv.id_agency,
                      i: inv.booking.agency_booking_id,
                    })
                  : null,
            }
          : null,
      };
      return res.status(200).json(payload);
    } catch (e) {
      console.error("[investments/:id][GET]", e);
      return res.status(500).json({ error: "Error al obtener la inversión" });
    }
  }

  if (req.method === "PUT") {
    try {
      const exists = await getInvestmentLite(id, auth.id_agency);
      if (!exists)
        return res.status(404).json({ error: "Inversión no encontrada" });
      if (restrictToOperatorPayments) {
        await loadOperatorCategories();
        if (!isOperatorCategoryName(exists.category, operatorCategorySet)) {
          return res.status(403).json({ error: "Plan insuficiente" });
        }
      }

      const b = req.body ?? {};
      const category =
        typeof b.category === "string" ? b.category.trim() : undefined;
      const description =
        typeof b.description === "string" ? b.description.trim() : undefined;
      const counterparty_name = normStrUpdate(b.counterparty_name);
      const rawCurrency =
        typeof b.currency === "string" ? b.currency.trim() : undefined;
      if (
        typeof counterparty_name === "string" &&
        counterparty_name.length > 160
      ) {
        return res.status(400).json({
          error: "counterparty_name supera 160 caracteres",
        });
      }

      if (category !== undefined || restrictToOperatorPayments) {
        await loadOperatorCategories();
      }
      if (
        restrictToOperatorPayments &&
        category !== undefined &&
        !isOperatorCategoryName(category, operatorCategorySet)
      ) {
        return res.status(403).json({ error: "Plan insuficiente" });
      }

      const paid_at =
        b.paid_at === null
          ? null
          : b.paid_at !== undefined
            ? toLocalDate(String(b.paid_at))
            : undefined;

      const operator_id =
        b.operator_id === null ? null : safeNumber(b.operator_id);
      const user_id = b.user_id === null ? null : safeNumber(b.user_id);

      // booking_id editable (validamos agencia si viene)
      let booking_id: number | null | undefined = undefined;
      if (b.booking_id !== undefined) {
        if (b.booking_id === null) {
          booking_id = null;
        } else {
          const bid = safeNumber(b.booking_id);
          if (!bid) {
            return res
              .status(400)
              .json({ error: "booking_id inválido (debe ser numérico)" });
          }
          const bkg = await prisma.booking.findFirst({
            where: { id_booking: bid, id_agency: auth.id_agency },
            select: { id_booking: true },
          });
          if (!bkg) {
            return res.status(400).json({
              error: "La reserva no existe o no pertenece a tu agencia",
            });
          }
          booking_id = bid;
        }
      } else if (b.booking_agency_id !== undefined) {
        if (b.booking_agency_id === null) {
          booking_id = null;
        } else {
          const bid = safeNumber(b.booking_agency_id);
          if (!bid) {
            return res.status(400).json({
              error: "booking_agency_id inválido (debe ser numérico)",
            });
          }
          const bkg = await prisma.booking.findFirst({
            where: {
              agency_booking_id: bid,
              id_agency: auth.id_agency,
            },
            select: { id_booking: true },
          });
          if (!bkg) {
            return res.status(400).json({
              error: "La reserva no existe o no pertenece a tu agencia",
            });
          }
          booking_id = bkg.id_booking;
        }
      }

      const hasServiceIds = Object.prototype.hasOwnProperty.call(
        b,
        "serviceIds",
      );
      const serviceIds = hasServiceIds
        ? parseServiceIds(b.serviceIds ?? [])
        : [];
      const hasAllocations = Object.prototype.hasOwnProperty.call(
        b,
        "allocations",
      );
      if (hasAllocations && !Array.isArray(b.allocations)) {
        return res.status(400).json({ error: "allocations inválidas" });
      }
      const allocations = hasAllocations ? parseAllocations(b.allocations) : [];

      const hasPaymentsPayload = Object.prototype.hasOwnProperty.call(
        b,
        "payments",
      );
      if (hasPaymentsPayload && !Array.isArray(b.payments)) {
        return res.status(400).json({ error: "payments inválido" });
      }

      const normalizedPayments = hasPaymentsPayload
        ? normalizeInvestmentPayments(
            b.payments,
            rawCurrency || exists.currency || "ARS",
          )
        : [];
      if (
        hasPaymentsPayload &&
        Array.isArray(b.payments) &&
        b.payments.length > 0 &&
        normalizedPayments.length === 0
      ) {
        return res.status(400).json({
          error:
            "payments inválido: cada línea debe incluir amount > 0 y payment_method.",
        });
      }

      const paymentCurrencies = Array.from(
        new Set(normalizedPayments.map((p) => p.payment_currency).filter(Boolean)),
      );
      if (paymentCurrencies.length > 1) {
        return res.status(400).json({
          error:
            "Todas las líneas de pago deben tener la misma moneda para este pago.",
        });
      }

      const paymentsCurrency = paymentCurrencies[0];
      const paymentsAmount = normalizedPayments.length
        ? round2(normalizedPayments.reduce((sum, p) => sum + p.amount, 0))
        : undefined;
      const paymentsFeeAmount = normalizedPayments.length
        ? round2(normalizedPayments.reduce((sum, p) => sum + (p.fee_amount || 0), 0))
        : undefined;

      const currency =
        paymentsCurrency ??
        (rawCurrency ? normalizePaymentCurrency(rawCurrency) : undefined);
      const amount = paymentsAmount ?? safeNumber(b.amount);

      // método de pago / cuenta (acepta string o null para limpiar)
      const payment_method =
        normalizedPayments.length > 0
          ? normalizedPayments[0].payment_method
          : normStrUpdate(b.payment_method);
      const account =
        normalizedPayments.length > 0
          ? normalizedPayments[0].account
          : normStrUpdate(b.account);
      const payment_fee_amount = !schemaFlags.hasPaymentFeeAmount
        ? undefined
        : normalizedPayments.length > 0
          ? toDec(paymentsFeeAmount)
          : b.payment_fee_amount === null
            ? null
            : (toDec(b.payment_fee_amount) as Prisma.Decimal | undefined);

      // conversión (acepta Decimal o null para limpiar)
      const base_amount =
        b.base_amount === null
          ? null
          : (toDec(b.base_amount) as Prisma.Decimal | undefined);
      const counter_amount =
        b.counter_amount === null
          ? null
          : (toDec(b.counter_amount) as Prisma.Decimal | undefined);
      const base_currency = normStrUpdate(b.base_currency, { upper: true });
      const counter_currency = normStrUpdate(b.counter_currency, {
        upper: true,
      });

      const rawExcessAction =
        typeof b.excess_action === "string" ? b.excess_action.trim() : undefined;
      const rawExcessMissing =
        typeof b.excess_missing_account_action === "string"
          ? b.excess_missing_account_action.trim()
          : undefined;
      const excess_action =
        rawExcessAction === "credit_entry" || rawExcessAction === "carry"
          ? rawExcessAction
          : undefined;
      const excess_missing_account_action =
        rawExcessMissing === "carry" ||
        rawExcessMissing === "block" ||
        rawExcessMissing === "create"
          ? rawExcessMissing
          : undefined;

      if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
        return res.status(400).json({ error: "El monto debe ser positivo" });
      }
      if (b.paid_at !== undefined && paid_at === undefined) {
        return res.status(400).json({ error: "Fecha de pago inválida" });
      }

      // Reglas por categoría si se envía cambio de categoría
      if (b.operator_id !== undefined && !operatorCategorySet) {
        await loadOperatorCategories();
      }
      const nextCategory = category ?? exists.category;
      const nextCategoryIsOperator = isOperatorCategoryName(
        nextCategory,
        operatorCategorySet,
      );
      if (nextCategoryIsOperator && b.operator_id !== undefined && operator_id == null) {
        return res.status(400).json({
          error: "Para categoría Operador, operator_id es obligatorio",
        });
      }
      if (b.user_id !== undefined && !userCategorySet) {
        await loadUserCategories();
      }
      if (
        isUserCategoryName(nextCategory || "", userCategorySet) &&
        b.user_id !== undefined &&
        user_id == null
      ) {
        return res
          .status(400)
          .json({ error: "Para categorías con usuario, user_id es obligatorio" });
      }

      if (!operatorCategorySet) {
        await loadOperatorCategories();
      }

      if (
        !hasAllocations &&
        (amount !== undefined || currency !== undefined)
      ) {
        const existingAllocations =
          await prisma.investmentServiceAllocation.findMany({
            where: { investment_id: id },
            select: { amount_payment: true },
          });
        if (existingAllocations.length > 0) {
          const assignedTotal = existingAllocations.reduce(
            (sum, a) => sum + Number(a.amount_payment || 0),
            0,
          );
          const nextAmountValue =
            amount !== undefined ? amount : Number(exists.amount || 0);
          if (assignedTotal - nextAmountValue > ASSIGNMENT_TOLERANCE) {
            return res.status(400).json({
              error: "El total asignado supera el monto del pago.",
            });
          }
        }
      }

      let serviceIdsToSave: number[] | undefined;
      let allocationServiceIds: number[] = [];
      let normalizedAllocations: AllocationNormalized[] = [];

      const nextCurrency =
        (currency ?? exists.currency ?? "").toString().toUpperCase();
      const nextAmount =
        amount !== undefined ? amount : Number(exists.amount);
      const nextOperatorId =
        operator_id !== undefined ? operator_id : exists.operator_id;

      if (hasAllocations) {
        allocationServiceIds = allocations.map((a) => a.service_id);
        serviceIdsToSave = allocationServiceIds;

        if (allocations.length > 0) {
          if (!nextCategoryIsOperator) {
            return res.status(400).json({
              error: "Solo podés asociar servicios a pagos de operador",
            });
          }

          const uniqueAllocationIds = new Set(allocationServiceIds);
          if (uniqueAllocationIds.size !== allocationServiceIds.length) {
            return res.status(400).json({
              error: "No podés repetir servicios en las asignaciones",
            });
          }

          const services = await getServicesByIds(
            auth.id_agency,
            allocationServiceIds,
          );
          if (services.length !== allocationServiceIds.length) {
            return res.status(400).json({
              error: "Algún servicio no existe o no pertenece a tu agencia",
            });
          }

          const operatorIds = new Set(services.map((s) => s.id_operator));
          if (operatorIds.size !== 1) {
            return res.status(400).json({
              error: "No podés mezclar servicios de distintos operadores",
            });
          }
          const serviceOperatorId = services[0].id_operator;
          if (!nextOperatorId || nextOperatorId !== serviceOperatorId) {
            return res.status(400).json({
              error: "El operador no coincide con los servicios seleccionados",
            });
          }

          const serviceMap = new Map(
            services.map((s) => [s.id_service, s]),
          );

          normalizedAllocations = allocations.map((a) => {
            const svc = serviceMap.get(a.service_id)!;
            const svcCurrency = (svc.currency || "").toUpperCase();
            const payment_currency = (
              a.payment_currency || nextCurrency
            ).toUpperCase();
            const service_currency = (
              a.service_currency || svcCurrency
            ).toUpperCase();
            return {
              service_id: a.service_id,
              booking_id: svc.booking_id,
              payment_currency,
              service_currency,
              amount_payment: Number(a.amount_payment || 0),
              amount_service: Number(a.amount_service || 0),
              fx_rate: a.fx_rate ?? null,
            };
          });

          for (const alloc of normalizedAllocations) {
            if (
              !Number.isFinite(alloc.amount_payment) ||
              alloc.amount_payment < 0
            ) {
              return res
                .status(400)
                .json({ error: "Monto asignado inválido" });
            }
            if (
              !Number.isFinite(alloc.amount_service) ||
              alloc.amount_service < 0
            ) {
              return res
                .status(400)
                .json({ error: "Monto por servicio inválido" });
            }
            if (
              alloc.fx_rate != null &&
              (!Number.isFinite(alloc.fx_rate) || alloc.fx_rate <= 0)
            ) {
              return res.status(400).json({ error: "Tipo de cambio inválido" });
            }
            if (alloc.payment_currency !== nextCurrency) {
              return res.status(400).json({
                error: "La moneda del pago no coincide con las asignaciones",
              });
            }
            const svc = serviceMap.get(alloc.service_id)!;
            const svcCurrency = (svc.currency || "").toUpperCase();
            if (alloc.service_currency !== svcCurrency) {
              return res.status(400).json({
                error: "La moneda del servicio no coincide con las asignaciones",
              });
            }
          }

          const assignedTotal = normalizedAllocations.reduce(
            (sum, a) => sum + Number(a.amount_payment || 0),
            0,
          );
          if (assignedTotal - nextAmount > ASSIGNMENT_TOLERANCE) {
            return res.status(400).json({
              error: "El total asignado supera el monto del pago.",
            });
          }

          const bookingIds = new Set(services.map((s) => s.booking_id));
          if (bookingIds.size === 1) {
            const onlyBookingId = services[0].booking_id;
            if (booking_id !== undefined && booking_id !== onlyBookingId) {
              return res.status(400).json({
                error: "La reserva no coincide con los servicios seleccionados",
              });
            }
            booking_id = onlyBookingId;
          } else {
            if (booking_id !== undefined) {
              return res.status(400).json({
                error:
                  "No podés asociar servicios de múltiples reservas y fijar una reserva",
              });
            }
            booking_id = null;
          }
        }
      } else if (hasServiceIds) {
        serviceIdsToSave = serviceIds;
        if (serviceIds.length > 0) {
          if (!nextCategoryIsOperator) {
            return res.status(400).json({
              error: "Solo podés asociar servicios a pagos de operador",
            });
          }

          const services = await getServicesByIds(auth.id_agency, serviceIds);
          if (services.length !== serviceIds.length) {
            return res.status(400).json({
              error: "Algún servicio no existe o no pertenece a tu agencia",
            });
          }

          const operatorIds = new Set(services.map((s) => s.id_operator));
          if (operatorIds.size !== 1) {
            return res.status(400).json({
              error: "No podés mezclar servicios de distintos operadores",
            });
          }
          const serviceOperatorId = services[0].id_operator;
          if (!nextOperatorId || nextOperatorId !== serviceOperatorId) {
            return res.status(400).json({
              error: "El operador no coincide con los servicios seleccionados",
            });
          }

          const currencies = new Set(
            services.map((s) => (s.currency || "").toUpperCase()),
          );
          if (currencies.size !== 1) {
            return res.status(400).json({
              error:
                "No podés mezclar servicios de monedas distintas sin conversión (usá asignaciones).",
            });
          }
          const serviceCurrency = (services[0].currency || "").toUpperCase();
          if (nextCurrency !== serviceCurrency) {
            return res.status(400).json({
              error: "La moneda del pago debe coincidir con la de los servicios",
            });
          }

          const bookingIds = new Set(services.map((s) => s.booking_id));
          if (bookingIds.size === 1) {
            const onlyBookingId = services[0].booking_id;
            if (booking_id !== undefined && booking_id !== onlyBookingId) {
              return res.status(400).json({
                error: "La reserva no coincide con los servicios seleccionados",
              });
            }
            booking_id = onlyBookingId;
          } else {
            if (booking_id !== undefined) {
              return res.status(400).json({
                error:
                  "No podés asociar servicios de múltiples reservas y fijar una reserva",
              });
            }
            booking_id = null;
          }
        }
      }

      // === TX: actualizar la inversión + (re)sincronizar cuenta de crédito si corresponde
      const updated = await prisma.$transaction(async (tx) => {
        // 1) Traigo el estado previo (opcional; útil para auditoría si la sumás)
        const before = await tx.investment.findFirst({
          where: { id_investment: id, id_agency: auth.id_agency },
          select: {
            id_investment: true,
            category: true,
            description: true,
            currency: true,
            amount: true,
            paid_at: true,
            operator_id: true,
            payment_method: true,
            excess_action: true,
            excess_missing_account_action: true,
          },
        });
        if (!before) throw new Error("Inversión no encontrada (TX)");

        // 2) Preparar asignaciones / excedente (si aplica)
        let assignedTotal = 0;
        let hasAssignments = false;
        if (hasAllocations) {
          assignedTotal = normalizedAllocations.reduce(
            (sum, a) => sum + Number(a.amount_payment || 0),
            0,
          );
          hasAssignments = normalizedAllocations.length > 0;
        } else {
          const existingAllocations =
            await tx.investmentServiceAllocation.findMany({
              where: { investment_id: id },
              select: { amount_payment: true },
            });
          if (existingAllocations.length > 0) {
            hasAssignments = true;
            assignedTotal = existingAllocations.reduce(
              (sum, a) => sum + Number(a.amount_payment || 0),
              0,
            );
          }
        }

        const nextAmountValue =
          amount !== undefined ? amount : Number(before.amount || 0);
        const excessAmount = hasAssignments ? nextAmountValue - assignedTotal : 0;
        const hasExcess = hasAssignments && excessAmount > ASSIGNMENT_TOLERANCE;

        let finalExcessAction =
          excess_action ?? (before.excess_action as string | null) ?? undefined;
        let finalMissingAction =
          excess_missing_account_action ??
          (before.excess_missing_account_action as string | null) ??
          undefined;

        if (hasAllocations && !hasAssignments) {
          finalExcessAction = null;
          finalMissingAction = null;
        } else if (hasExcess) {
          if (!finalExcessAction) finalExcessAction = "carry";
          if (finalExcessAction === "credit_entry") {
            if (!finalMissingAction) finalMissingAction = "carry";
          } else {
            finalMissingAction = null;
          }
        }

        // 3) Actualizo investment
        const data: Prisma.InvestmentUncheckedUpdateInput = {};
        if (category !== undefined) data.category = category;
        if (description !== undefined) data.description = description;
        if (counterparty_name !== undefined)
          data.counterparty_name = counterparty_name;
        if (currency !== undefined) data.currency = currency;
        if (amount !== undefined) data.amount = amount;
        if (paid_at !== undefined) data.paid_at = paid_at;
        if (operator_id !== undefined) data.operator_id = operator_id;
        if (user_id !== undefined) data.user_id = user_id;
        if (booking_id !== undefined) data.booking_id = booking_id;

        if (payment_method !== undefined) data.payment_method = payment_method;
        if (account !== undefined) data.account = account;
        if (payment_fee_amount !== undefined)
          data.payment_fee_amount = payment_fee_amount;

        if (base_amount !== undefined) data.base_amount = base_amount;
        if (base_currency !== undefined)
          data.base_currency = base_currency || undefined;
        if (counter_amount !== undefined) data.counter_amount = counter_amount;
        if (counter_currency !== undefined)
          data.counter_currency = counter_currency || undefined;
        if (serviceIdsToSave !== undefined) data.serviceIds = serviceIdsToSave;
        if (hasAllocations || excess_action !== undefined)
          data.excess_action = finalExcessAction ?? null;
        if (hasAllocations || excess_missing_account_action !== undefined)
          data.excess_missing_account_action = finalMissingAction ?? null;

        const after = await tx.investment.update({
          where: { id_investment: id },
          data,
          select: buildInvestmentFullSelect(schemaFlags),
        });

        if (hasPaymentsPayload && schemaFlags.hasPaymentLines) {
          await tx.investmentPayment.deleteMany({
            where: { investment_id: after.id_investment },
          });
          if (normalizedPayments.length > 0) {
            await tx.investmentPayment.createMany({
              data: normalizedPayments.map((line) => ({
                investment_id: after.id_investment,
                amount: new Prisma.Decimal(line.amount),
                payment_method: line.payment_method,
                account: line.account ?? null,
                payment_currency: line.payment_currency,
                fee_mode: line.fee_mode ?? null,
                fee_value:
                  line.fee_value != null
                    ? new Prisma.Decimal(line.fee_value)
                    : null,
                fee_amount: new Prisma.Decimal(line.fee_amount || 0),
              })),
            });
          }
        }

        if (hasAllocations) {
          await tx.investmentServiceAllocation.deleteMany({
            where: { investment_id: id },
          });
          if (normalizedAllocations.length > 0) {
            await tx.investmentServiceAllocation.createMany({
              data: normalizedAllocations.map((alloc) => ({
                investment_id: after.id_investment,
                service_id: alloc.service_id,
                booking_id: alloc.booking_id,
                payment_currency: alloc.payment_currency,
                service_currency: alloc.service_currency,
                amount_payment: new Prisma.Decimal(alloc.amount_payment || 0),
                amount_service: new Prisma.Decimal(alloc.amount_service || 0),
                fx_rate:
                  alloc.fx_rate != null
                    ? new Prisma.Decimal(alloc.fx_rate)
                    : null,
              })),
            });
          }
        }

        // 4) Cascade: limpiar movimientos previos vinculados a esta investment
        await removeLinkedCreditEntries(
          tx,
          after.id_investment,
          auth.id_agency,
        );

        const shouldCreditByMethod = shouldHaveCreditEntry(
          {
            category: after.category,
            operator_id: after.operator_id,
            payment_method: after.payment_method ?? undefined,
          },
          operatorCategorySet,
        );
        const paymentRows = hasPaymentsPayload
          ? normalizedPayments.map((line) => ({
              payment_method: line.payment_method,
              amount: line.amount,
            }))
          : schemaFlags.hasPaymentLines
            ? await tx.investmentPayment.findMany({
                where: { investment_id: after.id_investment },
                select: { payment_method: true, amount: true },
              })
            : [];
        const creditAmountFromLines = round2(
          paymentRows
            .filter((line) => line.payment_method === CREDIT_METHOD)
            .reduce((sum, line) => sum + Number(line.amount || 0), 0),
        );
        const creditAmountToApply =
          creditAmountFromLines > 0
            ? creditAmountFromLines
            : shouldCreditByMethod && paymentRows.length === 0
              ? round2(Math.abs(Number(after.amount || 0)))
              : 0;
        const wantCredit = creditAmountToApply > 0;

        // 5) Si ahora corresponde, crear movimiento de crédito (investment => negativo)
        if (wantCredit) {
          if (!after.operator_id) {
            throw new Error(
              "Para Crédito operador se requiere operator_id definido.",
            );
          }
          await createCreditEntryForInvestment(
            tx,
            auth.id_agency,
            auth.id_user,
            {
              id_investment: after.id_investment,
              agency_investment_id: after.agency_investment_id,
              operator_id: after.operator_id,
              currency: after.currency,
              amount: creditAmountToApply,
              description: after.description,
              paid_at: after.paid_at,
            },
          );
        }

        if (hasExcess && finalExcessAction === "credit_entry" && !wantCredit) {
          if (!after.operator_id) {
            throw new Error(
              "Para generar un movimiento en cuenta corriente se requiere operador.",
            );
          }
          const existingAccount = await findOperatorCreditAccount(
            tx,
            auth.id_agency,
            after.operator_id,
            after.currency,
          );
          let accountId = existingAccount;
          if (!accountId) {
            if (finalMissingAction === "block") {
              throw new Error(
                "No hay cuenta corriente del operador en la moneda del pago. Creala o elegí otra opción.",
              );
            }
            if (finalMissingAction === "create") {
              accountId = await findOrCreateOperatorCreditAccount(
                tx,
                auth.id_agency,
                after.operator_id,
                after.currency,
              );
            }
          }
          if (accountId) {
            await createCreditEntryForInvestmentAmount(
              tx,
              auth.id_agency,
              auth.id_user,
              accountId,
              {
                id_investment: after.id_investment,
                agency_investment_id: after.agency_investment_id,
                operator_id: after.operator_id,
                currency: after.currency,
                description: after.description,
                paid_at: after.paid_at,
              },
              Math.abs(excessAmount),
              {
                concept: `Excedente pago operador N° ${
                  after.agency_investment_id ?? after.id_investment
                }`,
                reference: `INV-${after.id_investment}-EXCESS`,
              },
            );
          }
        }

        if (hasExcess && finalExcessAction === "carry" && !wantCredit) {
          if (after.operator_id) {
            const existingAccount = await findOperatorCreditAccount(
              tx,
              auth.id_agency,
              after.operator_id,
              after.currency,
            );
            if (existingAccount) {
              await createCreditEntryForInvestmentAmount(
                tx,
                auth.id_agency,
                auth.id_user,
                existingAccount,
                {
                  id_investment: after.id_investment,
                  agency_investment_id: after.agency_investment_id,
                  operator_id: after.operator_id,
                  currency: after.currency,
                  description: after.description,
                  paid_at: after.paid_at,
                },
                Math.abs(excessAmount),
                {
                  concept: `Saldo a favor pago operador N° ${
                    after.agency_investment_id ?? after.id_investment
                  }`,
                  reference: `INV-${after.id_investment}-CARRY`,
                },
              );
            }
          }
        }

        const refreshedRaw = (await tx.investment.findFirst({
          where: { id_investment: after.id_investment, id_agency: auth.id_agency },
          select: buildInvestmentFullSelect(schemaFlags),
        })) as InvestmentFullRecord | null;
        if (!refreshedRaw)
          throw new Error("Inversión no encontrada tras actualizar.");
        return withCompatDefaults(refreshedRaw, schemaFlags);
      });

      return res.status(200).json(updated);
    } catch (e) {
      console.error("[investments/:id][PUT]", e);
      if (e instanceof Error) {
        if (
          e.message ===
            "No hay cuenta corriente del operador en la moneda del pago. Creala o elegí otra opción." ||
          e.message.includes("movimiento en cuenta corriente")
        ) {
          return res.status(400).json({ error: e.message });
        }
        return res.status(500).json({
          error: "Error al actualizar la inversión",
          details: e.message,
        });
      }
      return res
        .status(500)
        .json({ error: "Error al actualizar la inversión" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const exists = await getInvestmentLite(id, auth.id_agency);
      if (!exists)
        return res.status(404).json({ error: "Inversión no encontrada" });
      if (restrictToOperatorPayments) {
        await loadOperatorCategories();
        if (!isOperatorCategoryName(exists.category, operatorCategorySet)) {
          return res.status(403).json({ error: "Plan insuficiente" });
        }
      }

      await prisma.$transaction(async (tx) => {
        // 1) Borrar entries de CC vinculados y revertir sus efectos en el balance
        await removeLinkedCreditEntries(tx, id, auth.id_agency);
        // 2) Borrar la inversión
        const deleted = await tx.investment.deleteMany({
          where: { id_investment: id, id_agency: auth.id_agency },
        });
        if (deleted.count !== 1) {
          throw new Error("Inversión no encontrada al eliminar");
        }
      });

      return res.status(204).end();
    } catch (e) {
      console.error("[investments/:id][DELETE]", e);
      return res.status(500).json({ error: "Error al eliminar la inversión" });
    }
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
