// src/pages/api/investments/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { encodePublicId } from "@/lib/publicIds";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import {
  getBookingComponentGrants,
  getFinanceSectionGrants,
} from "@/lib/accessControl";
import { hasSchemaColumn } from "@/lib/schemaColumns";
import {
  canAccessBookingComponent,
  canAccessFinanceSection,
} from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  parseDateInputInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
  toDateKeyInBuenosAires,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";

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

// ==== JWT Secret (unificado con otros endpoints) ====
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

// ==== helpers comunes (mismo patrón que clients) ====
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
      if (u)
        return {
          id_user,
          id_agency: u.id_agency,
          role: role || u.role.toLowerCase(),
          email: email ?? u.email ?? undefined,
        };
    }

    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true },
      });
      if (u)
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role.toLowerCase(),
          email,
        };
    }

    if (!id_user || !id_agency) return null;
    return { id_user, id_agency, role, email: email ?? undefined };
  } catch {
    return null;
  }
}

function toLocalDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}

function toDayStart(v?: string): Date | undefined {
  if (!v) return undefined;
  const start = startOfDayUtcFromDateKeyInBuenosAires(v);
  if (start) return start;
  const parsed = parseDateInputInBuenosAires(v);
  if (!parsed) return undefined;
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

function toDayEnd(v?: string): Date | undefined {
  if (!v) return undefined;
  const end = endOfDayUtcFromDateKeyInBuenosAires(v);
  if (end) return end;
  const parsed = parseDateInputInBuenosAires(v);
  if (!parsed) return undefined;
  parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}
function safeNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ==== NUEVO: helper para Decimal opcional (igual que en receipts) ====
const toDec = (v: unknown) =>
  v === undefined || v === null || v === ""
    ? undefined
    : new Prisma.Decimal(typeof v === "number" ? v : String(v));

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

const INVESTMENT_ALLOCATION_LIST_SELECT = {
  booking_id: true,
  amount_payment: true,
} satisfies Prisma.InvestmentServiceAllocationSelect;

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

function buildInvestmentListSelect(
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
    user: true,
    operator: true,
    ...(flags.hasPaymentLines
      ? { payments: { select: INVESTMENT_PAYMENT_LINE_SELECT } }
      : {}),
    ...(includeAllocations
      ? { allocations: { select: INVESTMENT_ALLOCATION_LIST_SELECT } }
      : {}),
    createdBy: {
      select: { id_user: true, first_name: true, last_name: true },
    },
    booking: { select: { id_booking: true, agency_booking_id: true } },
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

  if (!mode) {
    return round2(Math.max(0, explicitAmount ?? 0));
  }
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
    amount: Prisma.Decimal | number;
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
      amount: new Prisma.Decimal(amountAbs),
      currency: inv.currency,
      doc_type: "investment",
      reference: `INV-${inv.id_investment}`,
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
    const next = acc.balance.add(deltaDecimal(Math.abs(amountAbs), opts?.doc_type || "investment"));
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

function startOfDay(d: Date) {
  const key = toDateKeyInBuenosAires(d);
  if (key) {
    const parsed = parseDateInputInBuenosAires(key);
    if (parsed) return parsed;
  }
  const fallback = new Date(d);
  fallback.setUTCHours(0, 0, 0, 0);
  return fallback;
}

function clampDay(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.min(Math.max(day, 1), last);
}

function buildDueDate(year: number, month: number, day: number) {
  const clampedDay = clampDay(year, month, day);
  const monthKey = String(month + 1).padStart(2, "0");
  const dayKey = String(clampedDay).padStart(2, "0");
  const key = `${year}-${monthKey}-${dayKey}`;
  return (
    parseDateInputInBuenosAires(key) ??
    new Date(Date.UTC(year, month, clampedDay, 0, 0, 0, 0))
  );
}

function addMonthsToDue(date: Date, months: number, day: number) {
  const total = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(total / 12);
  const month = total % 12;
  return buildDueDate(year, month, day);
}

function computeFirstDue(
  startDate: Date,
  dayOfMonth: number,
  intervalMonths: number,
) {
  const base = startOfDay(startDate);
  let due = buildDueDate(base.getUTCFullYear(), base.getUTCMonth(), dayOfMonth);
  if (due < base) {
    due = addMonthsToDue(due, intervalMonths, dayOfMonth);
  }
  return due;
}

async function ensureRecurringInvestments(
  auth: DecodedAuth,
  operatorCategorySet?: Set<string>,
) {
  const rules = await prisma.recurringInvestment.findMany({
    where: { id_agency: auth.id_agency, active: true },
  });
  if (rules.length === 0) return;

  const today =
    parseDateInputInBuenosAires(todayDateKeyInBuenosAires()) ??
    startOfDay(new Date());
  const maxRuns = 36;

  for (const rule of rules) {
    const dayOfMonth = Number(rule.day_of_month);
    const intervalMonths = Math.max(Number(rule.interval_months) || 1, 1);
    if (dayOfMonth < 1 || dayOfMonth > 31 || intervalMonths < 1) continue;

    let nextDue = rule.last_run
      ? addMonthsToDue(rule.last_run, intervalMonths, dayOfMonth)
      : computeFirstDue(rule.start_date, dayOfMonth, intervalMonths);

    let processed: Date | null = null;
    let guard = 0;

    while (nextDue <= today && guard < maxRuns) {
      const exists = await prisma.investment.findFirst({
        where: {
          id_agency: auth.id_agency,
          recurring_id: rule.id_recurring,
          paid_at: nextDue,
        },
        select: { id_investment: true },
      });

      if (!exists) {
        await prisma.$transaction(async (tx) => {
          const agencyInvestmentId = await getNextAgencyCounter(
            tx,
            auth.id_agency,
            "investment",
          );
          const created = await tx.investment.create({
            data: {
              agency_investment_id: agencyInvestmentId,
              id_agency: auth.id_agency,
              recurring_id: rule.id_recurring,
              category: rule.category,
              description: rule.description,
              amount: rule.amount,
              currency: rule.currency,
              paid_at: nextDue,
              operator_id: rule.operator_id ?? null,
              user_id: rule.user_id ?? null,
              created_by: rule.created_by,
              ...(rule.payment_method ? { payment_method: rule.payment_method } : {}),
              ...(rule.account ? { account: rule.account } : {}),
              ...(rule.base_amount ? { base_amount: rule.base_amount } : {}),
              ...(rule.base_currency ? { base_currency: rule.base_currency } : {}),
              ...(rule.counter_amount
                ? { counter_amount: rule.counter_amount }
                : {}),
              ...(rule.counter_currency
                ? { counter_currency: rule.counter_currency }
                : {}),
            },
            select: {
              id_investment: true,
              agency_investment_id: true,
              operator_id: true,
              currency: true,
              amount: true,
              description: true,
              paid_at: true,
              payment_method: true,
              category: true,
            },
          });

          if (
            shouldHaveCreditEntry(
              {
                category: created.category,
                operator_id: created.operator_id ?? undefined,
                payment_method: created.payment_method ?? undefined,
              },
              operatorCategorySet,
            )
          ) {
            if (created.operator_id) {
              await createCreditEntryForInvestment(
                tx,
                auth.id_agency,
                rule.created_by,
                {
                  id_investment: created.id_investment,
                  agency_investment_id: created.agency_investment_id,
                  operator_id: created.operator_id,
                  currency: created.currency,
                  amount: created.amount,
                  description: created.description,
                  paid_at: created.paid_at,
                },
              );
            }
          }
        });
      }

      processed = nextDue;
      nextDue = addMonthsToDue(nextDue, intervalMonths, dayOfMonth);
      guard++;
    }

    if (processed) {
      await prisma.recurringInvestment.update({
        where: { id_recurring: rule.id_recurring },
        data: { last_run: processed },
      });
    }
  }
}

// ==== GET ====
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
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

  try {
    let operatorCategoryNames: string[] = [];
    let operatorCategorySet: Set<string> | undefined;
    const loadOperatorCategories = async () => {
      if (operatorCategorySet) return;
      operatorCategoryNames = await getOperatorCategoryNames(auth.id_agency);
      operatorCategorySet = buildOperatorCategorySet(operatorCategoryNames);
    };

    if (!restrictToOperatorPayments && canInvestments) {
      try {
        await loadOperatorCategories();
        await ensureRecurringInvestments(auth, operatorCategorySet);
      } catch (e) {
        console.error("[investments][recurring][sync]", e);
      }
    }

    const takeParam = safeNumber(
      Array.isArray(req.query.take) ? req.query.take[0] : req.query.take,
    );
    const take = Math.min(Math.max(takeParam || 24, 1), 100);

    const cursorParam = safeNumber(
      Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor,
    );
    const cursor = cursorParam;

    const category =
      typeof req.query.category === "string" ? req.query.category.trim() : "";
    const currency =
      typeof req.query.currency === "string" ? req.query.currency.trim() : "";
    const paymentMethod =
      typeof req.query.payment_method === "string"
        ? req.query.payment_method.trim()
        : "";
    const account =
      typeof req.query.account === "string" ? req.query.account.trim() : "";
    const operatorId = safeNumber(
      Array.isArray(req.query.operatorId)
        ? req.query.operatorId[0]
        : req.query.operatorId,
    );
    const userId = safeNumber(
      Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId,
    );
    // 👇 NUEVO: filtro por bookingId
    const bookingId = safeNumber(
      Array.isArray(req.query.bookingId)
        ? req.query.bookingId[0]
        : req.query.bookingId,
    );

    const createdFromRaw = Array.isArray(req.query.createdFrom)
      ? req.query.createdFrom[0]
      : (req.query.createdFrom as string | undefined);
    const createdToRaw = Array.isArray(req.query.createdTo)
      ? req.query.createdTo[0]
      : (req.query.createdTo as string | undefined);
    const paidFromRaw = Array.isArray(req.query.paidFrom)
      ? req.query.paidFrom[0]
      : (req.query.paidFrom as string | undefined);
    const paidToRaw = Array.isArray(req.query.paidTo)
      ? req.query.paidTo[0]
      : (req.query.paidTo as string | undefined);

    const createdFrom = toDayStart(createdFromRaw);
    const createdTo = toDayEnd(createdToRaw);
    const paidFrom = toDayStart(paidFromRaw);
    const paidTo = toDayEnd(paidToRaw);

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const operatorOnlyRaw = Array.isArray(req.query.operatorOnly)
      ? req.query.operatorOnly[0]
      : req.query.operatorOnly;
    const operatorOnly =
      typeof operatorOnlyRaw === "string" &&
      (operatorOnlyRaw === "1" || operatorOnlyRaw.toLowerCase() === "true");
    const excludeOperatorRaw = Array.isArray(req.query.excludeOperator)
      ? req.query.excludeOperator[0]
      : req.query.excludeOperator;
    const excludeOperator =
      typeof excludeOperatorRaw === "string" &&
      (excludeOperatorRaw === "1" ||
        excludeOperatorRaw.toLowerCase() === "true");
    const includeCountsRaw = Array.isArray(req.query.includeCounts)
      ? req.query.includeCounts[0]
      : req.query.includeCounts;
    const includeCounts =
      typeof includeCountsRaw === "string" &&
      (includeCountsRaw === "1" || includeCountsRaw.toLowerCase() === "true");

    if (operatorOnly && excludeOperator) {
      return res
        .status(400)
        .json({ error: "Parámetros incompatibles" });
    }
    if (restrictToOperatorPayments && excludeOperator) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }

    if (restrictToOperatorPayments || operatorOnly || excludeOperator) {
      await loadOperatorCategories();
    }

    const categoryIsOperator = category
      ? isOperatorCategoryName(category, operatorCategorySet)
      : false;

    if (restrictToOperatorPayments && category && !categoryIsOperator) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }
    if (operatorOnly && category && !categoryIsOperator) {
      return res
        .status(400)
        .json({ error: "La categoría no corresponde a operador" });
    }
    if (excludeOperator && category && categoryIsOperator) {
      return res
        .status(400)
        .json({ error: "La categoría corresponde a operador" });
    }

    const where: Prisma.InvestmentWhereInput = {
      id_agency: auth.id_agency,
      ...(currency ? { currency } : {}),
      ...(paymentMethod ? { payment_method: paymentMethod } : {}),
      ...(account ? { account } : {}),
      ...(operatorId ? { operator_id: operatorId } : {}),
      ...(userId ? { user_id: userId } : {}),
    };

    const andFilters: Prisma.InvestmentWhereInput[] = [];
    if (bookingId) {
      const bookingServices = await prisma.service.findMany({
        where: { booking_id: bookingId, id_agency: auth.id_agency },
        select: { id_service: true },
      });
      const bookingServiceIds = bookingServices.map((s) => s.id_service);
      if (bookingServiceIds.length > 0) {
        andFilters.push({
          OR: [
            { booking_id: bookingId },
            { serviceIds: { hasSome: bookingServiceIds } },
          ],
        });
      } else {
        where.booking_id = bookingId;
      }
    }
    if (category) {
      where.category = category;
    } else if (restrictToOperatorPayments || operatorOnly || excludeOperator) {
      const operatorOr: Prisma.InvestmentWhereInput[] = [
        { category: { startsWith: "operador", mode: "insensitive" } },
        ...(operatorCategoryNames.length
          ? [{ category: { in: operatorCategoryNames } }]
          : []),
      ];
      if (restrictToOperatorPayments || operatorOnly) {
        andFilters.push({ OR: operatorOr });
      } else if (excludeOperator) {
        andFilters.push({ NOT: { OR: operatorOr } });
      }
    }

    if (createdFrom || createdTo) {
      where.created_at = {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {}),
      };
    }
    if (paidFrom || paidTo) {
      where.paid_at = {
        ...(paidFrom ? { gte: paidFrom } : {}),
        ...(paidTo ? { lte: paidTo } : {}),
      };
    }

    if (q) {
      const qNum = Number(q);
      const or: Prisma.InvestmentWhereInput[] = [
        ...(Number.isFinite(qNum) ? [{ id_investment: qNum }] : []),
        ...(Number.isFinite(qNum) ? [{ agency_investment_id: qNum }] : []),
        ...(Number.isFinite(qNum) ? [{ booking_id: qNum }] : []), // 👈 búsqueda por N° de reserva
        ...(Number.isFinite(qNum)
          ? [{ booking: { agency_booking_id: qNum } }]
          : []),
        { description: { contains: q, mode: "insensitive" } },
        { counterparty_name: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { currency: { contains: q, mode: "insensitive" } },
        {
          user: {
            OR: [
              { first_name: { contains: q, mode: "insensitive" } },
              { last_name: { contains: q, mode: "insensitive" } },
            ],
          },
        },
        { operator: { is: { name: { contains: q, mode: "insensitive" } } } },
      ];
      andFilters.push({ OR: or });
    }
    if (andFilters.length) {
      where.AND = andFilters;
    }

    const baseWhere: Prisma.InvestmentWhereInput = {
      id_agency: auth.id_agency,
    };
    if (restrictToOperatorPayments || operatorOnly || excludeOperator) {
      const operatorOr: Prisma.InvestmentWhereInput[] = [
        { category: { startsWith: "operador", mode: "insensitive" } },
        ...(operatorCategoryNames.length
          ? [{ category: { in: operatorCategoryNames } }]
          : []),
      ];
      if (restrictToOperatorPayments || operatorOnly) {
        baseWhere.AND = [{ OR: operatorOr }];
      } else if (excludeOperator) {
        baseWhere.AND = [{ NOT: { OR: operatorOr } }];
      }
    }

    const schemaFlags = await getInvestmentSchemaFlags();
    const includeBookingAllocations = Boolean(bookingId);
    const items = (await prisma.investment.findMany({
      where,
      select: buildInvestmentListSelect(
        schemaFlags,
        includeBookingAllocations,
      ),
      orderBy: { id_investment: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id_investment: cursor }, skip: 1 } : {}),
    })) as Array<Record<string, unknown>>;

    const hasMore = items.length > take;
    const sliced = hasMore ? items.slice(0, take) : items;
    const normalized = sliced.map((item) => {
      const itemWithAllocations = item as Record<string, unknown> & {
        allocations?: Array<{ booking_id?: unknown; amount_payment?: unknown }>;
      };
      const { allocations, ...itemData } = itemWithAllocations;
      const booking = item.booking as
        | { id_booking: number; agency_booking_id?: number | null }
        | null
        | undefined;
      const idAgency = Number(item.id_agency);
      const bookingAmount =
        bookingId != null
          ? (() => {
              const allocatedAmount = round2(
                (allocations || [])
                  .filter((a) => Number(a.booking_id) === bookingId)
                  .reduce((sum, a) => sum + Number(a.amount_payment || 0), 0),
              );
              if (allocatedAmount > ASSIGNMENT_TOLERANCE) {
                return allocatedAmount;
              }
              const directBookingId = Number(item.booking_id || 0);
              const totalAmount = Number(item.amount || 0);
              if (
                directBookingId === bookingId &&
                Number.isFinite(totalAmount) &&
                totalAmount > 0
              ) {
                return round2(totalAmount);
              }
              return null;
            })()
          : null;

      return {
        ...itemData,
        ...(schemaFlags.hasPaymentFeeAmount
          ? {}
          : { payment_fee_amount: null }),
        ...(schemaFlags.hasPaymentLines ? {} : { payments: [] }),
        ...(bookingId != null ? { booking_amount: bookingAmount } : {}),
        booking: booking
          ? {
              ...booking,
              public_id:
                booking.agency_booking_id != null
                  ? encodePublicId({
                      t: "booking",
                      a: idAgency,
                      i: booking.agency_booking_id,
                    })
                  : null,
            }
          : null,
      };
    });
    const nextCursor = hasMore
      ? Number(sliced[sliced.length - 1].id_investment)
      : null;

    let totalCount: number | undefined;
    let filteredCount: number | undefined;
    if (includeCounts) {
      [filteredCount, totalCount] = await Promise.all([
        prisma.investment.count({ where }),
        prisma.investment.count({ where: baseWhere }),
      ]);
    }

    return res.status(200).json({
      items: normalized,
      nextCursor,
      ...(includeCounts
        ? { totalCount: totalCount ?? 0, filteredCount: filteredCount ?? 0 }
        : {}),
    });
  } catch (e: unknown) {
    console.error("[investments][GET]", e);
    return res
      .status(500)
      .json({ error: "Error al obtener inversiones/gastos" });
  }
}

// ==== POST ====
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
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

  try {
    const planAccess = await ensurePlanFeatureAccess(
      auth.id_agency,
      "investments",
    );
    const restrictToOperatorPayments = !planAccess.allowed;
    if (restrictToOperatorPayments && !canOperatorPayments) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }
    const schemaFlags = await getInvestmentSchemaFlags();

    const b = req.body ?? {};
    const category = String(b.category ?? "").trim(); // requerido
    const description = String(b.description ?? "").trim(); // requerido
    const counterparty_name =
      typeof b.counterparty_name === "string"
        ? b.counterparty_name.trim()
        : "";
    const currencyInput = String(b.currency ?? "").trim();
    const payments = normalizeInvestmentPayments(
      b.payments,
      currencyInput || "ARS",
    );
    const hasPaymentsPayload = Array.isArray(b.payments);
    if (hasPaymentsPayload && payments.length === 0) {
      return res.status(400).json({
        error:
          "payments inválido: cada línea debe incluir amount > 0 y payment_method.",
      });
    }
    const paymentCurrencies = Array.from(
      new Set(payments.map((p) => p.payment_currency).filter(Boolean)),
    );
    if (paymentCurrencies.length > 1) {
      return res.status(400).json({
        error:
          "Todas las líneas de pago deben tener la misma moneda para este pago.",
      });
    }

    const currency = (
      paymentCurrencies[0] || normalizePaymentCurrency(currencyInput)
    ).toUpperCase();
    const amount = payments.length
      ? round2(payments.reduce((sum, p) => sum + p.amount, 0))
      : Number(b.amount);
    if (!category || !description || !currency || !Number.isFinite(amount)) {
      return res.status(400).json({
        error: "category, description, currency y amount son obligatorios",
      });
    }
    if (counterparty_name.length > 160) {
      return res.status(400).json({
        error: "counterparty_name supera 160 caracteres",
      });
    }
    const operatorCategoryNames = await getOperatorCategoryNames(auth.id_agency);
    const operatorCategorySet = buildOperatorCategorySet(
      operatorCategoryNames,
    );
    const categoryIsOperator = isOperatorCategoryName(
      category,
      operatorCategorySet,
    );
    const userCategoryNames = await getUserCategoryNames(auth.id_agency);
    const userCategorySet = buildUserCategorySet(userCategoryNames);
    const categoryIsUser = isUserCategoryName(category, userCategorySet);
    if (restrictToOperatorPayments && !categoryIsOperator) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }

    const paid_at = b.paid_at ? toLocalDate(b.paid_at) : undefined;
    let operator_id = Number.isFinite(Number(b.operator_id))
      ? Number(b.operator_id)
      : undefined;
    const user_id = Number.isFinite(Number(b.user_id))
      ? Number(b.user_id)
      : undefined;
    // 👇 opcional
    const booking_id = Number.isFinite(Number(b.booking_id))
      ? Number(b.booking_id)
      : undefined;
    const booking_agency_id = Number.isFinite(Number(b.booking_agency_id))
      ? Number(b.booking_agency_id)
      : undefined;
    const serviceIds = parseServiceIds(b.serviceIds);
    const hasAllocations = Object.prototype.hasOwnProperty.call(
      b,
      "allocations",
    );
    if (hasAllocations && !Array.isArray(b.allocations)) {
      return res.status(400).json({ error: "allocations inválidas" });
    }
    const allocations = hasAllocations ? parseAllocations(b.allocations) : [];

    // 👇 NUEVO: método de pago / cuenta (opcionales)
    const payment_method =
      payments.length > 0
        ? payments[0].payment_method
        : typeof b.payment_method === "string"
          ? b.payment_method.trim()
          : undefined;
    const account =
      payments.length > 0
        ? payments[0].account
        : typeof b.account === "string"
          ? b.account.trim()
          : undefined;
    const payment_fee_amount_num = payments.length
      ? round2(payments.reduce((sum, p) => sum + (p.fee_amount || 0), 0))
      : Number.isFinite(Number(b.payment_fee_amount))
        ? Math.max(0, Number(b.payment_fee_amount))
        : undefined;
    const payment_fee_amount = toDec(payment_fee_amount_num);
    const creditAmountFromPayments = payments.length
      ? round2(
          payments
            .filter((p) => p.payment_method === CREDIT_METHOD)
            .reduce((sum, p) => sum + p.amount, 0),
        )
      : (payment_method || "") === CREDIT_METHOD
        ? amount
        : 0;

    // 👇 NUEVO: conversión (opcional, sin T.C. ni notas)
    const base_amount = toDec(b.base_amount);
    const base_currency =
      typeof b.base_currency === "string" && b.base_currency
        ? b.base_currency.toUpperCase()
        : undefined;
    const counter_amount = toDec(b.counter_amount);
    const counter_currency =
      typeof b.counter_currency === "string" && b.counter_currency
        ? b.counter_currency.toUpperCase()
        : undefined;

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

    // Reglas según categoría
    if (
      categoryIsOperator &&
      !operator_id &&
      serviceIds.length === 0 &&
      allocations.length === 0
    ) {
      return res
        .status(400)
        .json({
          error: "Para categorías de Operador, operator_id es obligatorio",
        });
    }
    if (categoryIsUser && !user_id) {
      return res.status(400).json({
        error: "Para categorías con usuario, user_id es obligatorio",
      });
    }

    // Validar booking (si viene) y que sea de la misma agencia
    let bookingIdToSave: number | null = null;
    if (typeof booking_id === "number") {
      const bkg = await prisma.booking.findFirst({
        where: { id_booking: booking_id, id_agency: auth.id_agency },
        select: { id_booking: true },
      });
      if (!bkg) {
        return res
          .status(400)
          .json({ error: "La reserva no existe o no pertenece a tu agencia" });
      }
      bookingIdToSave = bkg.id_booking;
    } else if (typeof booking_agency_id === "number") {
      const bkg = await prisma.booking.findFirst({
        where: {
          agency_booking_id: booking_agency_id,
          id_agency: auth.id_agency,
        },
        select: { id_booking: true },
      });
      if (!bkg) {
        return res
          .status(400)
          .json({ error: "La reserva no existe o no pertenece a tu agencia" });
      }
      bookingIdToSave = bkg.id_booking;
    }

    let allocationServiceIds: number[] = [];
    let normalizedAllocations: AllocationNormalized[] = [];

    // Validar asignaciones (si vienen)
    if (allocations.length > 0) {
      if (!categoryIsOperator) {
        return res.status(400).json({
          error: "Solo podés asociar servicios a pagos de operador",
        });
      }

      allocationServiceIds = allocations.map((a) => a.service_id);
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
      if (operator_id && operator_id !== serviceOperatorId) {
        return res.status(400).json({
          error: "El operador no coincide con los servicios seleccionados",
        });
      }
      if (!operator_id) operator_id = serviceOperatorId;

      const serviceMap = new Map(
        services.map((s) => [s.id_service, s]),
      );
      const payCur = currency.toUpperCase();

      normalizedAllocations = allocations.map((a) => {
        const svc = serviceMap.get(a.service_id)!;
        const svcCurrency = (svc.currency || "").toUpperCase();
        const payment_currency = (a.payment_currency || payCur).toUpperCase();
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
        if (!Number.isFinite(alloc.amount_payment) || alloc.amount_payment < 0) {
          return res
            .status(400)
            .json({ error: "Monto asignado inválido" });
        }
        if (!Number.isFinite(alloc.amount_service) || alloc.amount_service < 0) {
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
        if (alloc.payment_currency !== payCur) {
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
      if (assignedTotal - amount > ASSIGNMENT_TOLERANCE) {
        return res.status(400).json({
          error: "El total asignado supera el monto del pago.",
        });
      }

      const bookingIds = new Set(services.map((s) => s.booking_id));
      if (bookingIds.size === 1) {
        const onlyBookingId = services[0].booking_id;
        if (bookingIdToSave && bookingIdToSave !== onlyBookingId) {
          return res.status(400).json({
            error: "La reserva no coincide con los servicios seleccionados",
          });
        }
        bookingIdToSave = onlyBookingId;
      } else if (bookingIdToSave) {
        return res.status(400).json({
          error:
            "No podés asociar servicios de múltiples reservas y fijar una reserva",
        });
      } else {
        bookingIdToSave = null;
      }
    } else if (serviceIds.length > 0) {
      if (!categoryIsOperator) {
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
      if (operator_id && operator_id !== serviceOperatorId) {
        return res.status(400).json({
          error: "El operador no coincide con los servicios seleccionados",
        });
      }
      if (!operator_id) operator_id = serviceOperatorId;

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
      if (currency.toUpperCase() !== serviceCurrency) {
        return res.status(400).json({
          error: "La moneda del pago debe coincidir con la de los servicios",
        });
      }

      const bookingIds = new Set(services.map((s) => s.booking_id));
      if (bookingIds.size === 1) {
        const onlyBookingId = services[0].booking_id;
        if (bookingIdToSave && bookingIdToSave !== onlyBookingId) {
          return res.status(400).json({
            error: "La reserva no coincide con los servicios seleccionados",
          });
        }
        bookingIdToSave = onlyBookingId;
      } else if (bookingIdToSave) {
        return res.status(400).json({
          error:
            "No podés asociar servicios de múltiples reservas y fijar una reserva",
        });
      }
    }

    const assignedTotal = normalizedAllocations.reduce(
      (sum, a) => sum + Number(a.amount_payment || 0),
      0,
    );
    const hasAssignments = normalizedAllocations.length > 0;
    const excessAmount = hasAssignments ? amount - assignedTotal : 0;
    const hasExcess = hasAssignments && excessAmount > ASSIGNMENT_TOLERANCE;
    const finalExcessAction = hasExcess
      ? excess_action ?? "carry"
      : excess_action;
    const finalMissingAction =
      finalExcessAction === "credit_entry"
        ? excess_missing_account_action ?? "carry"
        : undefined;

    const created = await prisma.$transaction(async (tx) => {
      const agencyInvestmentId = await getNextAgencyCounter(
        tx,
        auth.id_agency,
        "investment",
      );

      const investment = await tx.investment.create({
        data: {
          agency_investment_id: agencyInvestmentId,
          id_agency: auth.id_agency,
          category,
          description,
          ...(counterparty_name ? { counterparty_name } : {}),
          amount,
          currency,
          paid_at: paid_at ?? null,
          operator_id: operator_id ?? null,
          user_id: user_id ?? null,
          created_by: auth.id_user,
          booking_id: bookingIdToSave,
          serviceIds: hasAllocations ? allocationServiceIds : serviceIds,
          ...(finalExcessAction ? { excess_action: finalExcessAction } : {}),
          ...(finalMissingAction
            ? { excess_missing_account_action: finalMissingAction }
            : {}),

          // 👇 NUEVO: guardar método de pago / cuenta si vienen
          ...(payment_method ? { payment_method } : {}),
          ...(account ? { account } : {}),
          ...(schemaFlags.hasPaymentFeeAmount && payment_fee_amount
            ? { payment_fee_amount }
            : {}),

          // 👇 NUEVO: guardar conversión si vienen
          ...(base_amount ? { base_amount } : {}),
          ...(base_currency ? { base_currency } : {}),
          ...(counter_amount ? { counter_amount } : {}),
          ...(counter_currency ? { counter_currency } : {}),
        },
        select: buildInvestmentListSelect(schemaFlags),
      });

      if (schemaFlags.hasPaymentLines && payments.length > 0) {
        await tx.investmentPayment.createMany({
          data: payments.map((line) => ({
            investment_id: investment.id_investment,
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

      if (normalizedAllocations.length > 0) {
        await tx.investmentServiceAllocation.createMany({
          data: normalizedAllocations.map((alloc) => ({
            investment_id: investment.id_investment,
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

      const wantCredit =
        isOperatorCategoryName(investment.category, operatorCategorySet) &&
        !!investment.operator_id &&
        creditAmountFromPayments > 0;

      if (wantCredit && investment.operator_id) {
        await createCreditEntryForInvestment(tx, auth.id_agency, auth.id_user, {
          id_investment: investment.id_investment,
          agency_investment_id: investment.agency_investment_id,
          operator_id: investment.operator_id,
          currency: investment.currency,
          amount: creditAmountFromPayments,
          description: investment.description,
          paid_at: investment.paid_at,
        });
      }

      if (
        hasExcess &&
        finalExcessAction === "credit_entry" &&
        !wantCredit
      ) {
        if (!investment.operator_id) {
          throw new Error(
            "Para generar un movimiento en cuenta corriente se requiere operador.",
          );
        }
        const existingAccount = await findOperatorCreditAccount(
          tx,
          auth.id_agency,
          investment.operator_id,
          investment.currency,
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
              investment.operator_id,
              investment.currency,
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
              id_investment: investment.id_investment,
              agency_investment_id: investment.agency_investment_id,
              operator_id: investment.operator_id,
              currency: investment.currency,
              description: investment.description,
              paid_at: investment.paid_at,
            },
            Math.abs(excessAmount),
            {
              concept: `Excedente pago operador N° ${
                investment.agency_investment_id ?? investment.id_investment
              }`,
              reference: `INV-${investment.id_investment}-EXCESS`,
            },
          );
        }
      }

      if (hasExcess && finalExcessAction === "carry" && !wantCredit) {
        if (investment.operator_id) {
          const existingAccount = await findOperatorCreditAccount(
            tx,
            auth.id_agency,
            investment.operator_id,
            investment.currency,
          );
          if (existingAccount) {
            await createCreditEntryForInvestmentAmount(
              tx,
              auth.id_agency,
              auth.id_user,
              existingAccount,
              {
                id_investment: investment.id_investment,
                agency_investment_id: investment.agency_investment_id,
                operator_id: investment.operator_id,
                currency: investment.currency,
                description: investment.description,
                paid_at: investment.paid_at,
              },
              Math.abs(excessAmount),
              {
                concept: `Saldo a favor pago operador N° ${
                  investment.agency_investment_id ?? investment.id_investment
                }`,
                reference: `INV-${investment.id_investment}-CARRY`,
              },
            );
          }
        }
      }

      return investment;
    });

    return res.status(201).json({
      ...created,
      ...(schemaFlags.hasPaymentFeeAmount ? {} : { payment_fee_amount: null }),
      ...(schemaFlags.hasPaymentLines ? {} : { payments: [] }),
    });
  } catch (e: unknown) {
    console.error("[investments][POST]", e);
    if (e instanceof Error) {
      if (
        e.message ===
          "No hay cuenta corriente del operador en la moneda del pago. Creala o elegí otra opción." ||
        e.message.includes("movimiento en cuenta corriente")
      ) {
        return res.status(400).json({ error: e.message });
      }
      return res.status(500).json({
        error: "Error al crear gasto",
        details: e.message,
      });
    }
    return res.status(500).json({ error: "Error al crear gasto" });
  }
}

// ==== router ====
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
