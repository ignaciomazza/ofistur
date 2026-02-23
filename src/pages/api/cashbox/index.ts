// src/pages/api/cashbox/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import {
  startOfDayUtcFromDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";

/* =========================================================
 * Tipos de dominio para Cashbox
 * ========================================================= */

type DecimalLike = number | Prisma.Decimal;

type MovementKind =
  | "income" // Ingresos (cobros, etc.)
  | "expense" // Egresos (gastos, pagos, etc.)
  | "client_debt" // Deuda de pasajeros hacia la agencia
  | "operator_debt" // Deuda de la agencia hacia operadores
  | "other";

type MovementSource =
  | "receipt"
  | "other_income"
  | "investment"
  | "client_payment"
  | "operator_due"
  | "credit_entry"
  | "manual"
  | "other";

type PaymentBreakdown = {
  amount: number;
  paymentMethod?: string | null;
  account?: string | null;
};

export type CashboxMovement = {
  id: string; // ej: "receipt:123", "investment:45"
  date: string; // ISO: fecha principal del movimiento (caja)
  type: MovementKind;
  source: MovementSource;
  description: string;
  currency: string; // "ARS" | "USD" | ...
  amount: number; // siempre positivo (el signo lo define "type")

  // Enlazados opcionales
  clientName?: string | null;
  operatorName?: string | null;
  bookingLabel?: string | null;

  // Para deudas / vencimientos
  dueDate?: string | null; // ISO si aplica

  // NUEVO: clasificación de caja
  paymentMethod?: string | null; // Efectivo, Transferencia, MP, etc.
  account?: string | null; // Banco / billetera / caja física, etc.
  categoryName?: string | null;
  counterpartyName?: string | null; // Quién paga (ingresos)
  payeeName?: string | null; // A quién se le paga (egresos)

  // Detalle de cobros múltiples (si aplica)
  payments?: PaymentBreakdown[];
};

type CurrencySummary = {
  currency: string;
  income: number;
  expenses: number;
  net: number;
};

type DebtSummary = {
  currency: string;
  amount: number;
};

type PaymentMethodSummary = {
  paymentMethod: string; // "Efectivo", "Transferencia", "Sin método", etc.
  currency: string;
  income: number;
  expenses: number;
  net: number;
};

type AccountSummary = {
  account: string; // "Macro CC", "MP", "Caja local", "Sin cuenta", etc.
  currency: string;
  income: number;
  expenses: number;
  net: number;
  opening?: number;
  closing?: number;
};

export type CashboxSummaryResponse = {
  // Rango principal de análisis (normalmente un mes)
  range: {
    year: number;
    month: number; // 1-12
    from: string; // ISO inicio de mes
    to: string; // ISO fin de mes
  };

  // Totales de caja por moneda en el rango
  totalsByCurrency: CurrencySummary[];

  // NUEVO: totales por medio de pago y cuenta
  totalsByPaymentMethod: PaymentMethodSummary[];
  totalsByAccount: AccountSummary[];

  // Saldos globales (foto actual) por moneda
  balances: {
    clientDebtByCurrency: DebtSummary[]; // lo que los pasajeros deben a la agencia
    operatorDebtByCurrency: DebtSummary[]; // lo que la agencia debe a operadores
  };

  // Deudas con vencimiento dentro del rango (por ahora: ClientPayment + OperatorDue)
  upcomingDue: CashboxMovement[];

  // Lista plana de movimientos del rango (ingresos, egresos, deudas del mes)
  movements: CashboxMovement[];
};

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string };

/* =========================================================
 * Auth (alineado con /api/bookings)
 * ========================================================= */

type UserRole =
  | "gerente"
  | "lider"
  | "administrativo"
  | "desarrollador"
  | "vendedor";

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

type AuthPayload = {
  id_user: number;
  id_agency: number;
  role?: UserRole | string;
  email?: string;
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET no configurado");
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getTokenFromRequest(req: NextApiRequest): string | null {
  // 1) cookie "token" (principal en prod)
  if (req.cookies?.token) return req.cookies.token;

  // 2) Authorization: Bearer ...
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();

  // 3) otros posibles nombres de cookie
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

async function getAuth(req: NextApiRequest): Promise<AuthPayload> {
  const token = getTokenFromRequest(req);
  if (!token) {
    throw new HttpError(401, "Falta token de autenticación.");
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || 0;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || 0;
    const role = (p.role || "") as string | undefined;
    const email = p.email;

    if (!id_user || !id_agency) {
      throw new HttpError(
        401,
        "Token inválido (faltan campos requeridos en el payload).",
      );
    }

    return { id_user, id_agency, role, email };
  } catch (err) {
    console.error("[cashbox] Error verificando JWT:", err);
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, "Token inválido o expirado.");
  }
}

/* =========================================================
 * Helpers
 * ========================================================= */

function getNumberFromQuery(
  value: string | string[] | undefined,
): number | undefined {
  if (!value) return undefined;
  const v = Array.isArray(value) ? value[0] : value;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildMonthRange(year: number, month: number) {
  const monthSafe = Math.min(Math.max(Math.trunc(month), 1), 12);
  const monthLabel = String(monthSafe).padStart(2, "0");
  const fromKey = `${year}-${monthLabel}-01`;
  const from =
    startOfDayUtcFromDateKeyInBuenosAires(fromKey) ||
    new Date(Date.UTC(year, monthSafe - 1, 1, 3, 0, 0, 0));

  const nextYear = monthSafe === 12 ? year + 1 : year;
  const nextMonth = monthSafe === 12 ? 1 : monthSafe + 1;
  const nextMonthLabel = String(nextMonth).padStart(2, "0");
  const nextFromKey = `${nextYear}-${nextMonthLabel}-01`;
  const nextFrom =
    startOfDayUtcFromDateKeyInBuenosAires(nextFromKey) ||
    new Date(Date.UTC(nextYear, nextMonth - 1, 1, 3, 0, 0, 0));

  const to = new Date(nextFrom.getTime() - 1);
  return { from, to };
}

function decimalToNumber(value: DecimalLike | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return Number(value);
}

const round2 = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function toCashboxDateIso(value: Date | null | undefined): string {
  if (!value || !Number.isFinite(value.getTime())) return new Date().toISOString();

  const isExactUtcMidnight =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;

  if (!isExactUtcMidnight) {
    return value.toISOString();
  }

  const key = toDateKeyInBuenosAiresLegacySafe(value);
  const normalized = key ? startOfDayUtcFromDateKeyInBuenosAires(key) : null;
  return normalized?.toISOString() ?? value.toISOString();
}

function toAccountCurrencyKey(account: string, currency: string): string {
  return `${account.trim().toLowerCase()}::${currency.trim().toUpperCase()}`;
}

function getCashFlowEntries(m: CashboxMovement): {
  amount: number;
  paymentMethod: string;
  account: string;
}[] {
  const fallback = [
    {
      amount: Number.isFinite(m.amount) ? m.amount : 0,
      paymentMethod: (m.paymentMethod ?? "Sin método").trim() || "Sin método",
      account: (m.account ?? "Sin cuenta").trim() || "Sin cuenta",
    },
  ];

  const rows =
    Array.isArray(m.payments) && m.payments.length > 0
      ? m.payments.map((entry) => ({
          amount: Number(entry.amount),
          paymentMethod:
            (entry.paymentMethod ?? "Sin método").trim() || "Sin método",
          account: (entry.account ?? "Sin cuenta").trim() || "Sin cuenta",
        }))
      : fallback;

  return rows.filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0);
}

/**
 * Agrega todos los movimientos y arma el resumen “caja”:
 * - Totales por moneda (ingresos / egresos / neto)
 * - Totales por medio de pago y por cuenta
 * - Deuda pasajeros / operadores por moneda (puede venir override)
 * - Próximos vencimientos dentro del rango
 */
function aggregateCashbox(
  year: number,
  month: number,
  from: Date,
  to: Date,
  movements: CashboxMovement[],
  openingBalancesByAccount: { account: string; currency: string; amount: number }[] = [],
  balancesOverride?: {
    clientDebtByCurrency?: DebtSummary[];
    operatorDebtByCurrency?: DebtSummary[];
  },
): CashboxSummaryResponse {
  const totalsByCurrencyMap = new Map<
    string,
    { currency: string; income: number; expenses: number }
  >();

  // NUEVO: mapas para medios de pago y cuentas
  const totalsByPaymentMethodMap = new Map<
    string,
    {
      paymentMethod: string;
      currency: string;
      income: number;
      expenses: number;
    }
  >();

  const totalsByAccountMap = new Map<
    string,
    {
      account: string;
      currency: string;
      income: number;
      expenses: number;
      opening?: number;
    }
  >();
  const openingByCurrencyMap = new Map<string, number>();

  const clientDebtByCurrencyMap = new Map<string, number>();
  const operatorDebtByCurrencyMap = new Map<string, number>();
  const upcomingDue: CashboxMovement[] = [];

  for (const m of movements) {
    const isCashFlow = m.type === "income" || m.type === "expense";

    // === Totales por moneda (solo ingresos / egresos) ===
    if (isCashFlow) {
      if (!totalsByCurrencyMap.has(m.currency)) {
        totalsByCurrencyMap.set(m.currency, {
          currency: m.currency,
          income: 0,
          expenses: 0,
        });
      }

      const currentTotals = totalsByCurrencyMap.get(m.currency);
      if (currentTotals) {
        if (m.type === "income") {
          currentTotals.income += m.amount;
        } else if (m.type === "expense") {
          currentTotals.expenses += m.amount;
        }
      }

      const entries = getCashFlowEntries(m);
      for (const entry of entries) {
        const entryAmount = Number(entry.amount);
        if (!Number.isFinite(entryAmount) || entryAmount <= 0) continue;

        // === NUEVO: totales por medio de pago ===
        const pmLabel = entry.paymentMethod || "Sin método";
        const pmKey = `${pmLabel.toLowerCase()}::${m.currency}`;

        if (!totalsByPaymentMethodMap.has(pmKey)) {
          totalsByPaymentMethodMap.set(pmKey, {
            paymentMethod: pmLabel,
            currency: m.currency,
            income: 0,
            expenses: 0,
          });
        }
        const pmTotals = totalsByPaymentMethodMap.get(pmKey);
        if (pmTotals) {
          if (m.type === "income") {
            pmTotals.income += entryAmount;
          } else if (m.type === "expense") {
            pmTotals.expenses += entryAmount;
          }
        }

        // === NUEVO: totales por cuenta ===
        const accLabel = entry.account || "Sin cuenta";
        const accKey = toAccountCurrencyKey(accLabel, m.currency);

        if (!totalsByAccountMap.has(accKey)) {
          totalsByAccountMap.set(accKey, {
            account: accLabel,
            currency: m.currency,
            income: 0,
            expenses: 0,
          });
        }
        const accTotals = totalsByAccountMap.get(accKey);
        if (accTotals) {
          if (m.type === "income") {
            accTotals.income += entryAmount;
          } else if (m.type === "expense") {
            accTotals.expenses += entryAmount;
          }
        }
      }
    }

    // === Deudas por moneda (si no hay override, las calculamos desde movimientos) ===
    if (m.type === "client_debt") {
      const current = clientDebtByCurrencyMap.get(m.currency) ?? 0;
      clientDebtByCurrencyMap.set(m.currency, current + m.amount);
    }

    if (m.type === "operator_debt") {
      const current = operatorDebtByCurrencyMap.get(m.currency) ?? 0;
      operatorDebtByCurrencyMap.set(m.currency, current + m.amount);
    }

    // === Próximos vencimientos (solo deudas) dentro del rango ===
    if ((m.type === "client_debt" || m.type === "operator_debt") && m.dueDate) {
      const due = new Date(m.dueDate);
      if (due >= from && due <= to) {
        upcomingDue.push(m);
      }
    }
  }

  // === Saldos iniciales por cuenta (si existen) ===
  for (const ob of openingBalancesByAccount) {
    const currentOpening = openingByCurrencyMap.get(ob.currency) ?? 0;
    openingByCurrencyMap.set(ob.currency, currentOpening + ob.amount);

    const accLabel = ob.account?.trim() || "Sin cuenta";
    const accKey = toAccountCurrencyKey(accLabel, ob.currency);
    if (!totalsByAccountMap.has(accKey)) {
      totalsByAccountMap.set(accKey, {
        account: accLabel,
        currency: ob.currency,
        income: 0,
        expenses: 0,
        opening: ob.amount,
      });
      continue;
    }
    const accTotals = totalsByAccountMap.get(accKey);
    if (accTotals && accTotals.opening == null) {
      accTotals.opening = ob.amount;
    }
  }

  // Si hay saldos iniciales sin movimientos, aseguramos la moneda en el resumen
  for (const [currency] of openingByCurrencyMap.entries()) {
    if (!totalsByCurrencyMap.has(currency)) {
      totalsByCurrencyMap.set(currency, {
        currency,
        income: 0,
        expenses: 0,
      });
    }
  }

  // Totales caja por moneda
  const totalsByCurrency: CurrencySummary[] = Array.from(
    totalsByCurrencyMap.values(),
  )
    .map((t) => {
      const opening = openingByCurrencyMap.get(t.currency) ?? 0;
      return {
        ...t,
        net: t.income - t.expenses + opening,
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency, "es"));

  // Totales por medio de pago
  const totalsByPaymentMethod: PaymentMethodSummary[] = Array.from(
    totalsByPaymentMethodMap.values(),
  )
    .map((t) => ({
      ...t,
      net: t.income - t.expenses,
    }))
    .sort((a, b) => {
      const byName = a.paymentMethod.localeCompare(b.paymentMethod, "es");
      if (byName !== 0) return byName;
      return a.currency.localeCompare(b.currency, "es");
    });

  // Totales por cuenta
  const totalsByAccount: AccountSummary[] = Array.from(
    totalsByAccountMap.values(),
  )
    .map((t) => ({
      ...t,
      net: t.income - t.expenses,
      opening: t.opening,
      closing:
        typeof t.opening === "number"
          ? t.opening + (t.income - t.expenses)
          : undefined,
    }))
    .sort((a, b) => {
      const byAcc = a.account.localeCompare(b.account, "es");
      if (byAcc !== 0) return byAcc;
      return a.currency.localeCompare(b.currency, "es");
    });

  // Deudas calculadas desde movimientos (fallback)
  const computedClientDebtByCurrency: DebtSummary[] = Array.from(
    clientDebtByCurrencyMap.entries(),
  ).map(([currency, amount]) => ({ currency, amount }));

  const computedOperatorDebtByCurrency: DebtSummary[] = Array.from(
    operatorDebtByCurrencyMap.entries(),
  ).map(([currency, amount]) => ({ currency, amount }));

  // Si tenemos overrides desde CreditAccount, los usamos
  const clientDebtByCurrency =
    balancesOverride?.clientDebtByCurrency ?? computedClientDebtByCurrency;

  const operatorDebtByCurrency =
    balancesOverride?.operatorDebtByCurrency ?? computedOperatorDebtByCurrency;

  // Ordenamos movimientos y vencimientos por fecha ascendente (para tablas / tarjetas)
  const sortedMovements = [...movements].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const sortedUpcomingDue = [...upcomingDue].sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : 0;
    return da - db;
  });

  return {
    range: {
      year,
      month,
      from: from.toISOString(),
      to: to.toISOString(),
    },
    totalsByCurrency,
    totalsByPaymentMethod,
    totalsByAccount,
    balances: {
      clientDebtByCurrency,
      operatorDebtByCurrency,
    },
    upcomingDue: sortedUpcomingDue,
    movements: sortedMovements,
  };
}

/* =========================================================
 * Acceso a datos (Prisma): movimientos del mes
 * ========================================================= */

type GetMonthlyMovementsOptions = {
  hideOperatorExpenses?: boolean;
  accountNameById?: Map<number, string>;
  methodNameById?: Map<number, string>;
};

/**
 * Movimientos mensuales para Caja:
 * - Receipt (ingresos)
 * - OtherIncome (ingresos varios)
 * - Investment (egresos)
 * - ClientPayment (deuda de pasajeros + vencimientos)
 * - OperatorDue (deuda con operadores + vencimientos)
 */
async function getMonthlyMovements(
  agencyId: number,
  from: Date,
  to: Date,
  options: GetMonthlyMovementsOptions = {},
): Promise<CashboxMovement[]> {
  const { hideOperatorExpenses, accountNameById, methodNameById } = options;

  /* ----------------------------
   * 1) INGRESOS: Recibos
   * ---------------------------- */
  const receiptsRaw = await prisma.receipt.findMany({
    where: {
      issue_date: {
        gte: from,
        lte: to,
      },
      OR: [
        { id_agency: agencyId },
        {
          booking: {
            id_agency: agencyId,
          },
        },
      ],
    },
    include: {
      booking: {
        select: {
          id_booking: true,
          agency_booking_id: true,
          details: true,
          titular: {
            select: {
              id_client: true,
              first_name: true,
              last_name: true,
            },
          },
          clients: {
            select: {
              id_client: true,
              first_name: true,
              last_name: true,
            },
          },
        },
      },
    },
  });

  const receipts = receiptsRaw.filter((r) => {
    const { enabled } = r as { enabled?: boolean | null };
    return enabled !== false;
  });

  const receiptMovements: CashboxMovement[] = receipts.map((r) => {
    const booking = r.booking;
    const titular = booking?.titular;

    const namesByClientId = new Map<number, string>();
    if (titular?.id_client) {
      namesByClientId.set(
        titular.id_client,
        `${titular.first_name} ${titular.last_name}`.trim(),
      );
    }
    for (const client of booking?.clients ?? []) {
      namesByClientId.set(
        client.id_client,
        `${client.first_name} ${client.last_name}`.trim(),
      );
    }

    const receiptClientIds = Array.isArray(r.clientIds)
      ? r.clientIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.trunc(value))
      : [];

    const receiptClientNames = Array.from(
      new Set(
        receiptClientIds
          .map((id) => namesByClientId.get(id) || null)
          .filter((name): name is string => !!name),
      ),
    );

    const clientName =
      receiptClientNames.length > 0
        ? receiptClientNames.join(", ")
        : titular
          ? `${titular.first_name} ${titular.last_name}`.trim()
          : null;

    const bookingLabel = booking
      ? `N° ${booking.agency_booking_id ?? booking.id_booking} • ${booking.details}`.trim()
      : null;

    const hasCounter =
      (r as { counter_amount?: unknown }).counter_amount != null &&
      (r as { counter_currency?: string | null }).counter_currency;
    const currency = hasCounter
      ? (r as { counter_currency?: string | null }).counter_currency ??
        "ARS"
      : (r as { amount_currency?: string | null }).amount_currency ??
        r.currency ??
        "ARS";

    return {
      id: `receipt:${r.id_receipt}`,
      date: toCashboxDateIso(r.issue_date),
      type: "income",
      source: "receipt",
      description: r.concept ?? `Recibo ${r.receipt_number}`,
      currency,
      amount: hasCounter
        ? decimalToNumber(
            (r as { counter_amount?: DecimalLike | null }).counter_amount,
          )
        : decimalToNumber(r.amount),
      clientName,
      bookingLabel,
      dueDate: null,
      paymentMethod: r.payment_method ?? null,
      account:
        (r.account_id && accountNameById?.get(r.account_id)) ||
        r.account ||
        null,
    };
  });

  /* ----------------------------
   * 2) INGRESOS: Ingresos
   * ---------------------------- */
  const otherIncomes = await prisma.otherIncome.findMany({
    where: {
      id_agency: agencyId,
      issue_date: {
        gte: from,
        lte: to,
      },
    },
    // Compatibilidad con bases que aún no tienen columnas nuevas
    // (ej: operator_id). Evitamos el select implícito de "todas las columnas".
    select: {
      id_other_income: true,
      issue_date: true,
      description: true,
      counterparty_name: true,
      currency: true,
      amount: true,
      payment_method_id: true,
      account_id: true,
      category: {
        select: {
          name: true,
        },
      },
      operator: {
        select: {
          name: true,
        },
      },
      payments: {
        select: {
          amount: true,
          payment_method_id: true,
          account_id: true,
        },
      },
    },
  });

  const otherIncomeMovements: CashboxMovement[] = otherIncomes.map((inc) => {
    const rawPayments = Array.isArray(inc.payments) ? inc.payments : [];
    const payments = rawPayments.map((p) => ({
      amount: decimalToNumber(p.amount),
      paymentMethod: p.payment_method_id
        ? methodNameById?.get(p.payment_method_id) ?? null
        : null,
      account: p.account_id
        ? accountNameById?.get(p.account_id) ?? null
        : null,
    }));

    const fallbackMethod =
      inc.payment_method_id && methodNameById
        ? methodNameById.get(inc.payment_method_id) ?? null
        : null;
    const fallbackAccount =
      inc.account_id && accountNameById
        ? accountNameById.get(inc.account_id) ?? null
        : null;

    const useSingle = payments.length === 1;
    const useMultiple = payments.length > 1;

    return {
      id: `other_income:${inc.id_other_income}`,
      date: toCashboxDateIso(inc.issue_date),
      type: "income",
      source: "other_income",
      description: inc.description || "Ingresos",
      currency: inc.currency,
      amount: decimalToNumber(inc.amount),
      dueDate: null,
      operatorName: inc.operator?.name ?? null,
      categoryName: inc.category?.name ?? null,
      counterpartyName: inc.counterparty_name ?? null,
      paymentMethod: useSingle
        ? payments[0]?.paymentMethod ?? null
        : useMultiple
          ? "Varios"
          : fallbackMethod,
      account: useSingle
        ? payments[0]?.account ?? null
        : useMultiple
          ? null
          : fallbackAccount,
      payments: payments.length > 0 ? payments : undefined,
    };
  });

  /* ----------------------------
   * 3) EGRESOS: Investments
   * ---------------------------- */

  const investmentWhere: Prisma.InvestmentWhereInput = {
    id_agency: agencyId,
    OR: [
      {
        paid_at: {
          gte: from,
          lte: to,
        },
      },
      {
        AND: [
          { paid_at: null },
          {
            created_at: {
              gte: from,
              lte: to,
            },
          },
        ],
      },
    ],
  };

  if (hideOperatorExpenses) {
    investmentWhere.operator_id = null;
  }

  const investments = await prisma.investment.findMany({
    where: investmentWhere,
    select: {
      id_investment: true,
      category: true,
      description: true,
      counterparty_name: true,
      amount: true,
      currency: true,
      created_at: true,
      paid_at: true,
      payment_method: true,
      account: true,
      operator: {
        select: { name: true },
      },
      booking: {
        select: {
          id_booking: true,
          agency_booking_id: true,
          details: true,
        },
      },
    },
  });

  const investmentMovements: CashboxMovement[] = investments.map((inv) => {
    const date = inv.paid_at ?? inv.created_at;
    const operatorName = inv.operator?.name ?? null;
    const bookingLabel = inv.booking
      ? `N° ${inv.booking.agency_booking_id ?? inv.booking.id_booking} • ${inv.booking.details}`
      : null;

    const descriptionParts = [inv.category, inv.description].filter(Boolean);
    const description =
      inv.description?.trim() ||
      (descriptionParts.length > 0
        ? descriptionParts.join(" • ")
        : "Gasto / inversión");

    return {
      id: `investment:${inv.id_investment}`,
      date: toCashboxDateIso(date),
      type: "expense",
      source: "investment",
      description,
      currency: inv.currency,
      amount: decimalToNumber(inv.amount),
      operatorName,
      bookingLabel,
      dueDate: null,
      categoryName: inv.category ?? null,
      payeeName: inv.counterparty_name ?? null,
      paymentMethod: inv.payment_method ?? null,
      account: inv.account ?? null,
    };
  });

  /* ----------------------------
   * 3bis) MOVIMIENTOS INTERNOS: Transferencias
   * ---------------------------- */
  const transfers = await prisma.financeTransfer.findMany({
    where: {
      id_agency: agencyId,
      deleted_at: null,
      transfer_date: {
        gte: from,
        lte: to,
      },
    },
    select: {
      id_transfer: true,
      transfer_date: true,
      note: true,
      origin_account_id: true,
      origin_method_id: true,
      origin_currency: true,
      origin_amount: true,
      destination_account_id: true,
      destination_method_id: true,
      destination_currency: true,
      destination_amount: true,
      fee_amount: true,
      fee_currency: true,
      fee_account_id: true,
      fee_method_id: true,
      fee_note: true,
    },
  });

  const transferMovements: CashboxMovement[] = [];
  for (const tf of transfers) {
    const baseDescription = tf.note?.trim()
      ? `Transferencia interna • ${tf.note.trim()}`
      : `Transferencia interna #${tf.id_transfer}`;

    const originAmount = decimalToNumber(tf.origin_amount);
    if (originAmount > 0) {
      transferMovements.push({
        id: `finance_transfer:${tf.id_transfer}:origin`,
        date: toCashboxDateIso(tf.transfer_date),
        type: "expense",
        source: "manual",
        description: `${baseDescription} (origen)`,
        currency: tf.origin_currency,
        amount: originAmount,
        dueDate: null,
        paymentMethod:
          (tf.origin_method_id && methodNameById?.get(tf.origin_method_id)) ||
          null,
        account:
          (tf.origin_account_id && accountNameById?.get(tf.origin_account_id)) ||
          null,
      });
    }

    const destinationAmount = decimalToNumber(tf.destination_amount);
    if (destinationAmount > 0) {
      transferMovements.push({
        id: `finance_transfer:${tf.id_transfer}:destination`,
        date: toCashboxDateIso(tf.transfer_date),
        type: "income",
        source: "manual",
        description: `${baseDescription} (destino)`,
        currency: tf.destination_currency,
        amount: destinationAmount,
        dueDate: null,
        paymentMethod:
          (tf.destination_method_id &&
            methodNameById?.get(tf.destination_method_id)) ||
          null,
        account:
          (tf.destination_account_id &&
            accountNameById?.get(tf.destination_account_id)) ||
          null,
      });
    }

    const feeAmount = decimalToNumber(tf.fee_amount);
    if (feeAmount > 0 && tf.fee_currency) {
      transferMovements.push({
        id: `finance_transfer:${tf.id_transfer}:fee`,
        date: toCashboxDateIso(tf.transfer_date),
        type: "expense",
        source: "manual",
        description: tf.fee_note?.trim()
          ? `${baseDescription} • Comisión (${tf.fee_note.trim()})`
          : `${baseDescription} • Comisión`,
        currency: tf.fee_currency,
        amount: feeAmount,
        dueDate: null,
        paymentMethod:
          (tf.fee_method_id && methodNameById?.get(tf.fee_method_id)) || null,
        account:
          (tf.fee_account_id && accountNameById?.get(tf.fee_account_id)) || null,
      });
    }
  }

  /* ----------------------------
   * 3ter) AJUSTES DE SALDO
   * ---------------------------- */
  const adjustments = await prisma.financeAccountAdjustment.findMany({
    where: {
      id_agency: agencyId,
      effective_date: {
        gte: from,
        lte: to,
      },
    },
    select: {
      id_adjustment: true,
      account_id: true,
      currency: true,
      amount: true,
      effective_date: true,
      reason: true,
      note: true,
    },
  });

  const adjustmentMovements: CashboxMovement[] = [];
  for (const adj of adjustments) {
    const rawAmount = decimalToNumber(adj.amount);
    const absAmount = Math.abs(rawAmount);
    if (absAmount === 0) continue;

    adjustmentMovements.push({
      id: `account_adjustment:${adj.id_adjustment}`,
      date: toCashboxDateIso(adj.effective_date),
      type: rawAmount >= 0 ? "income" : "expense",
      source: "manual",
      description: adj.note?.trim()
        ? `Ajuste de saldo • ${adj.reason} • ${adj.note.trim()}`
        : `Ajuste de saldo • ${adj.reason}`,
      currency: adj.currency,
      amount: absAmount,
      dueDate: null,
      paymentMethod: "Ajuste de saldo",
      account: (adj.account_id && accountNameById?.get(adj.account_id)) || null,
    });
  }

  /* ----------------------------
   * 4) DEUDA CLIENTES: ClientPayment
   * ---------------------------- */

  const clientPayments = await prisma.clientPayment.findMany({
    where: {
      booking: {
        id_agency: agencyId,
      },
      status: { in: ["PENDIENTE", "pendiente"] },
      due_date: {
        gte: from,
        lte: to,
      },
    },
    include: {
      client: {
        select: {
          first_name: true,
          last_name: true,
        },
      },
      booking: {
        select: {
          id_booking: true,
          agency_booking_id: true,
          details: true,
        },
      },
    },
  });

  const clientPaymentMovements: CashboxMovement[] = clientPayments.map((cp) => {
    const clientName = `${cp.client.first_name} ${cp.client.last_name}`;
    const bookingLabel = `N° ${
      cp.booking.agency_booking_id ?? cp.booking.id_booking
    } • ${cp.booking.details}`;

    return {
      id: `client_payment:${cp.id_payment}`,
      date: toCashboxDateIso(cp.created_at),
      type: "client_debt",
      source: "client_payment",
      description: "Pago de pax pendiente",
      currency: cp.currency,
      amount: decimalToNumber(cp.amount),
      clientName,
      bookingLabel,
      dueDate: toCashboxDateIso(cp.due_date),
      // Para deudas no usamos método / cuenta
    };
  });

  /* ----------------------------
   * 5) DEUDA OPERADORES: OperatorDue
   * ---------------------------- */

  const operatorDues = await prisma.operatorDue.findMany({
    where: {
      booking: {
        id_agency: agencyId,
      },
      due_date: {
        gte: from,
        lte: to,
      },
    },
    include: {
      booking: {
        select: {
          id_booking: true,
          agency_booking_id: true,
          details: true,
        },
      },
      service: {
        select: {
          description: true,
          operator: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  const operatorDueMovements: CashboxMovement[] = operatorDues.map((od) => {
    const operatorName = od.service.operator?.name ?? null;
    const bookingLabel = `N° ${
      od.booking.agency_booking_id ?? od.booking.id_booking
    } • ${od.booking.details}`;

    const descriptionParts = [od.concept, od.service.description].filter(
      Boolean,
    );
    const description =
      descriptionParts.length > 0
        ? descriptionParts.join(" • ")
        : "Deuda con operador";

    return {
      id: `operator_due:${od.id_due}`,
      date: toCashboxDateIso(od.created_at),
      type: "operator_debt",
      source: "operator_due",
      description,
      currency: od.currency,
      amount: decimalToNumber(od.amount),
      operatorName,
      bookingLabel,
      dueDate: toCashboxDateIso(od.due_date),
      // Deuda, sin método / cuenta
    };
  });

  return [
    ...receiptMovements,
    ...otherIncomeMovements,
    ...investmentMovements,
    ...transferMovements,
    ...adjustmentMovements,
    ...clientPaymentMovements,
    ...operatorDueMovements,
  ];
}

/* =========================================================
 * Acceso a datos (Prisma): saldos globales de deuda
 * ========================================================= */

async function getDebtBalances(agencyId: number): Promise<{
  clientDebtByCurrency: DebtSummary[];
  operatorDebtByCurrency: DebtSummary[];
}> {
  const accounts = await prisma.creditAccount.findMany({
    where: {
      id_agency: agencyId,
      enabled: true,
    },
    select: {
      currency: true,
      balance: true,
      client_id: true,
      operator_id: true,
    },
  });

  const clientNegMap = new Map<string, number>();
  const clientPosMap = new Map<string, number>();
  const operatorMap = new Map<string, number>();

  for (const acc of accounts) {
    const currency = acc.currency;
    const bal = decimalToNumber(acc.balance);

    if (acc.client_id != null) {
      if (bal < 0) {
        const current = clientNegMap.get(currency) ?? 0;
        clientNegMap.set(currency, current + Math.abs(bal));
      } else if (bal > 0) {
        const current = clientPosMap.get(currency) ?? 0;
        clientPosMap.set(currency, current + bal);
      }
      continue;
    }

    if (acc.operator_id != null) {
      if (bal > 0) {
        const current = operatorMap.get(currency) ?? 0;
        operatorMap.set(currency, current + bal);
      }
      continue;
    }
  }

  const clientDebtByCurrency: DebtSummary[] = [];
  const allClientCurrencies = new Set<string>([
    ...Array.from(clientNegMap.keys()),
    ...Array.from(clientPosMap.keys()),
  ]);

  allClientCurrencies.forEach((currency) => {
    const neg = clientNegMap.get(currency) ?? 0;
    const pos = clientPosMap.get(currency) ?? 0;
    const amount = neg !== 0 ? neg : pos;
    if (amount > 0) {
      clientDebtByCurrency.push({ currency, amount });
    }
  });

  const operatorDebtByCurrency: DebtSummary[] = Array.from(
    operatorMap.entries(),
  ).map(([currency, amount]) => ({ currency, amount }));

  return { clientDebtByCurrency, operatorDebtByCurrency };
}

type OpeningBalanceSeed = {
  account: string;
  currency: string;
  amount: number;
  effectiveDate: Date;
};

async function getOpeningBalanceSeedsByAccount(
  agencyId: number,
  from: Date,
): Promise<OpeningBalanceSeed[]> {
  const rows = await prisma.financeAccountOpeningBalance.findMany({
    where: {
      id_agency: agencyId,
      effective_date: {
        lte: from,
      },
    },
    include: {
      account: { select: { name: true } },
    },
    orderBy: [
      { account_id: "asc" },
      { currency: "asc" },
      { effective_date: "desc" },
    ],
  });

  const seen = new Set<string>();
  const result: OpeningBalanceSeed[] = [];

  for (const row of rows) {
    const key = `${row.account_id}::${row.currency.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      account: row.account?.name ?? "Sin cuenta",
      currency: String(row.currency || "ARS").toUpperCase(),
      amount: decimalToNumber(row.amount),
      effectiveDate: row.effective_date,
    });
  }

  return result;
}

async function getOpeningBalancesByAccount(
  agencyId: number,
  from: Date,
  options: GetMonthlyMovementsOptions = {},
): Promise<{ account: string; currency: string; amount: number }[]> {
  const seeds = await getOpeningBalanceSeedsByAccount(agencyId, from);
  const seedByKey = new Map<string, OpeningBalanceSeed>();
  const balancesMap = new Map<
    string,
    { account: string; currency: string; amount: number }
  >();

  for (const seed of seeds) {
    const key = toAccountCurrencyKey(seed.account, seed.currency);
    seedByKey.set(key, seed);
    balancesMap.set(key, {
      account: seed.account,
      currency: seed.currency,
      amount: seed.amount,
    });
  }

  const historyTo = new Date(from.getTime() - 1);
  const historyFrom = new Date(Date.UTC(2000, 0, 1, 0, 0, 0, 0));
  if (historyTo < historyFrom) {
    return Array.from(balancesMap.values());
  }

  const historyMovements = await getMonthlyMovements(
    agencyId,
    historyFrom,
    historyTo,
    options,
  );

  for (const movement of historyMovements) {
    if (movement.type !== "income" && movement.type !== "expense") continue;

    const movementDate = new Date(movement.date);
    const movementTime = movementDate.getTime();
    if (!Number.isFinite(movementTime)) continue;

    const entries = getCashFlowEntries(movement);
    for (const entry of entries) {
      const key = toAccountCurrencyKey(entry.account, movement.currency);
      const seed = seedByKey.get(key);
      if (seed && movementTime <= seed.effectiveDate.getTime()) {
        continue;
      }

      const delta = movement.type === "income" ? entry.amount : -entry.amount;
      if (!Number.isFinite(delta) || delta === 0) continue;

      const current = balancesMap.get(key) ?? {
        account: entry.account,
        currency: movement.currency,
        amount: 0,
      };
      current.amount += delta;
      balancesMap.set(key, current);
    }
  }

  return Array.from(balancesMap.values())
    .map((row) => ({
      ...row,
      amount: round2(row.amount),
    }))
    .sort((a, b) => {
      const byAccount = a.account.localeCompare(b.account, "es");
      if (byAccount !== 0) return byAccount;
      return a.currency.localeCompare(b.currency, "es");
    });
}

/* =========================================================
 * Handler principal
 * ========================================================= */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CashboxSummaryResponse>>,
) {
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ ok: false, error: "Método no permitido. Usá GET." });
  }

  try {
    // 1) Auth (unificado con /api/bookings)
    const auth = await getAuth(req);
    const planAccess = await ensurePlanFeatureAccess(
      auth.id_agency,
      "cashbox",
    );
    if (!planAccess.allowed) {
      throw new HttpError(403, "Plan insuficiente.");
    }
    const financeGrants = await getFinanceSectionGrants(
      auth.id_agency,
      auth.id_user,
    );
    const canCashbox = canAccessFinanceSection(
      auth.role,
      financeGrants,
      "cashbox",
    );
    if (!canCashbox) {
      throw new HttpError(403, "Sin permisos.");
    }

    // 2) Params básicos (año/mes)
    const now = new Date();
    const year = getNumberFromQuery(req.query.year) ?? now.getFullYear();
    const month = getNumberFromQuery(req.query.month) ?? now.getMonth() + 1;

    const requestedAgencyId = getNumberFromQuery(req.query.agencyId);
    const isManagerOrDev =
      auth.role === "gerente" || auth.role === "desarrollador";

    const agencyId = requestedAgencyId ?? auth.id_agency;

    if (
      requestedAgencyId &&
      requestedAgencyId !== auth.id_agency &&
      !isManagerOrDev
    ) {
      throw new HttpError(
        403,
        "No tenés permisos para ver la caja de otra agencia.",
      );
    }

    if (!agencyId) {
      throw new HttpError(
        400,
        "No se pudo determinar la agencia (falta agencyId).",
      );
    }

    if (month < 1 || month > 12) {
      throw new HttpError(400, "El parámetro 'month' debe estar entre 1 y 12.");
    }

    const { from, to } = buildMonthRange(year, month);

    // 3) Config financiera
    const financeConfig = await prisma.financeConfig.findUnique({
      where: { id_agency: agencyId },
      select: {
        hide_operator_expenses_in_investments: true,
      },
    });

    const hideOperatorExpenses =
      !!financeConfig?.hide_operator_expenses_in_investments;

    // Mapa de cuentas por ID (para normalizar nombres)
    const accounts = await prisma.financeAccount.findMany({
      where: { id_agency: agencyId },
      select: { id_account: true, name: true },
    });
    const accountNameById = new Map<number, string>();
    for (const acc of accounts) {
      accountNameById.set(acc.id_account, acc.name);
    }

    const methods = await prisma.financePaymentMethod.findMany({
      where: { id_agency: agencyId },
      select: { id_method: true, name: true },
    });
    const methodNameById = new Map<number, string>();
    for (const method of methods) {
      methodNameById.set(method.id_method, method.name);
    }

    // 4) Movimientos del mes
    const movements = await getMonthlyMovements(agencyId, from, to, {
      hideOperatorExpenses,
      accountNameById,
      methodNameById,
    });

    // 5) Saldos globales de deuda (pasajeros / operadores)
    const balances = await getDebtBalances(agencyId);

    // 5.1) Saldos iniciales por cuenta (hasta el inicio del mes)
    const openingBalancesByAccount = await getOpeningBalancesByAccount(
      agencyId,
      from,
      {
        hideOperatorExpenses,
        accountNameById,
        methodNameById,
      },
    );

    // 6) Agregación / resumen
    const summary = aggregateCashbox(
      year,
      month,
      from,
      to,
      movements,
      openingBalancesByAccount,
      balances,
    );

    return res.status(200).json({ ok: true, data: summary });
  } catch (err) {
    console.error("[API /cashbox] Error:", err);

    if (err instanceof HttpError) {
      return res.status(err.status).json({
        ok: false,
        error: err.message,
      });
    }

    return res.status(500).json({
      ok: false,
      error: "Error interno al calcular la caja del mes.",
    });
  }
}
