// src/pages/api/other-incomes/report.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection, normalizeRole } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { hasSchemaColumn } from "@/lib/schemaColumns";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  parseDateInputInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

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
    const tokenAgencyId =
      Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    const tokenRole = normalizeRole(p.role);
    const email = p.email;

    if (id_user || email) {
      const u = await prisma.user.findFirst({
        where: id_user ? { id_user } : { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: normalizeRole(u.role) || tokenRole,
          email: email ?? u.email ?? undefined,
        };
    }

    if (!id_user || !tokenAgencyId) return null;
    return {
      id_user,
      id_agency: tokenAgencyId,
      role: tokenRole,
      email: email ?? undefined,
    };
  } catch {
    return null;
  }
}

function toLocalDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}

function parseDateFromQuery(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const value = raw.trim();
  const start = startOfDayUtcFromDateKeyInBuenosAires(value);
  if (start) return start;
  return toLocalDate(value);
}

function parseDateToQuery(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const value = raw.trim();
  const end = endOfDayUtcFromDateKeyInBuenosAires(value);
  if (end) return end;
  return toLocalDate(value);
}

function safeNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function decimalToNumber(v: Prisma.Decimal | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return (v as Prisma.Decimal).toNumber();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const auth = await getUserFromAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  const planAccess = await ensurePlanFeatureAccess(
    auth.id_agency,
    "other_incomes",
  );
  if (!planAccess.allowed) {
    return res.status(403).json({ error: "Plan insuficiente" });
  }

  const financeGrants = await getFinanceSectionGrants(
    auth.id_agency,
    auth.id_user,
  );
  const canOtherIncomes = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "other_incomes",
  );
  const canVerify = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "other_incomes_verify",
  );
  if (!canOtherIncomes && !canVerify) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  try {
    const [hasCategoryColumn, hasOperatorColumn] = await Promise.all([
      hasSchemaColumn("OtherIncome", "category_id"),
      hasSchemaColumn("OtherIncome", "operator_id"),
    ]);

    const currency =
      typeof req.query.currency === "string"
        ? req.query.currency.trim().toUpperCase()
        : "";
    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim().toUpperCase()
        : "";

    const dateFrom = parseDateFromQuery(
      Array.isArray(req.query.dateFrom)
        ? req.query.dateFrom[0]
        : req.query.dateFrom,
    );
    const dateTo = parseDateToQuery(
      Array.isArray(req.query.dateTo)
        ? req.query.dateTo[0]
        : req.query.dateTo,
    );

    const paymentMethodId = safeNumber(
      Array.isArray(req.query.payment_method_id)
        ? req.query.payment_method_id[0]
        : req.query.payment_method_id,
    );
    const accountId = safeNumber(
      Array.isArray(req.query.account_id)
        ? req.query.account_id[0]
        : req.query.account_id,
    );
    const categoryId = safeNumber(
      Array.isArray(req.query.category_id)
        ? req.query.category_id[0]
        : req.query.category_id,
    );

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: Prisma.OtherIncomeWhereInput = {
      id_agency: auth.id_agency,
      ...(currency ? { currency } : {}),
      ...(status ? { verification_status: status } : {}),
    };

    if (dateFrom || dateTo) {
      where.issue_date = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      };
    }

    const andFilters: Prisma.OtherIncomeWhereInput[] = [];

    if (paymentMethodId) {
      andFilters.push({
        OR: [
          { payment_method_id: paymentMethodId },
          { payments: { some: { payment_method_id: paymentMethodId } } },
        ],
      });
    }

    if (accountId) {
      andFilters.push({
        OR: [
          { account_id: accountId },
          { payments: { some: { account_id: accountId } } },
        ],
      });
    }

    if (categoryId && hasCategoryColumn) {
      andFilters.push({ category_id: categoryId });
    }

    if (q) {
      const qNum = Number(q);
      const or: Prisma.OtherIncomeWhereInput[] = [
        ...(Number.isFinite(qNum) ? [{ id_other_income: qNum }] : []),
        ...(Number.isFinite(qNum) ? [{ agency_other_income_id: qNum }] : []),
        { description: { contains: q, mode: "insensitive" } },
        { counterparty_type: { contains: q, mode: "insensitive" } },
        { counterparty_name: { contains: q, mode: "insensitive" } },
        { receipt_to: { contains: q, mode: "insensitive" } },
        { reference_note: { contains: q, mode: "insensitive" } },
        ...(hasOperatorColumn
          ? [
              {
                operator: {
                  is: { name: { contains: q, mode: "insensitive" } },
                },
              } as Prisma.OtherIncomeWhereInput,
            ]
          : []),
        ...(hasCategoryColumn
          ? [
              {
                category: {
                  is: { name: { contains: q, mode: "insensitive" } },
                },
              } as Prisma.OtherIncomeWhereInput,
            ]
          : []),
      ];
      andFilters.push({ OR: or });
    }

    if (andFilters.length) {
      where.AND = andFilters;
    }

    const items = await prisma.otherIncome.findMany({
      where,
      select: {
        amount: true,
        currency: true,
        payment_fee_amount: true,
        payment_method_id: true,
        account_id: true,
        payments: {
          select: { amount: true, payment_method_id: true, account_id: true },
        },
      },
    });

    const totalsByCurrency = new Map<
      string,
      { currency: string; amount: number; fees: number; count: number }
    >();

    const totalsByPaymentMethod = new Map<
      string,
      { payment_method_id: number | null; amount: number }
    >();

    const totalsByAccount = new Map<
      string,
      { account_id: number | null; amount: number }
    >();

    for (const inc of items) {
      const amount = decimalToNumber(inc.amount);
      const fee = decimalToNumber(inc.payment_fee_amount);
      const currencyKey = inc.currency || "ARS";

      if (!totalsByCurrency.has(currencyKey)) {
        totalsByCurrency.set(currencyKey, {
          currency: currencyKey,
          amount: 0,
          fees: 0,
          count: 0,
        });
      }
      const cur = totalsByCurrency.get(currencyKey);
      if (cur) {
        cur.amount += amount;
        cur.fees += fee;
        cur.count += 1;
      }

      const payments =
        Array.isArray(inc.payments) && inc.payments.length > 0
          ? inc.payments
          : [
              {
                amount: inc.amount,
                payment_method_id: inc.payment_method_id,
                account_id: inc.account_id,
              },
            ];

      for (const p of payments) {
        const pAmount = decimalToNumber(p.amount);
        if (!Number.isFinite(pAmount) || pAmount <= 0) continue;

        const pmId = p.payment_method_id ?? null;
        const pmKey = String(pmId ?? "none");
        if (!totalsByPaymentMethod.has(pmKey)) {
          totalsByPaymentMethod.set(pmKey, {
            payment_method_id: pmId,
            amount: 0,
          });
        }
        const pm = totalsByPaymentMethod.get(pmKey);
        if (pm) pm.amount += pAmount;

        const accId = p.account_id ?? null;
        const accKey = String(accId ?? "none");
        if (!totalsByAccount.has(accKey)) {
          totalsByAccount.set(accKey, { account_id: accId, amount: 0 });
        }
        const acc = totalsByAccount.get(accKey);
        if (acc) acc.amount += pAmount;
      }
    }

    return res.status(200).json({
      totalCount: items.length,
      totalsByCurrency: Array.from(totalsByCurrency.values()).sort((a, b) =>
        a.currency.localeCompare(b.currency, "es"),
      ),
      totalsByPaymentMethod: Array.from(totalsByPaymentMethod.values()).sort(
        (a, b) => (a.payment_method_id ?? 0) - (b.payment_method_id ?? 0),
      ),
      totalsByAccount: Array.from(totalsByAccount.values()).sort(
        (a, b) => (a.account_id ?? 0) - (b.account_id ?? 0),
      ),
    });
  } catch (e) {
    console.error("[other-incomes][report]", e);
    return res.status(500).json({ error: "Error al generar reporte" });
  }
}
