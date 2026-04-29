// src/pages/api/other-incomes/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify, type JWTPayload } from "jose";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection, normalizeRole } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { hasSchemaColumn } from "@/lib/schemaColumns";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  parseDateInputInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
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

function parsePositiveInt(v: unknown): number | undefined {
  const n = safeNumber(v);
  if (n == null || !Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

const normSoft = (s?: string | null) =>
  (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

function isOperatorCategory(
  category: { requires_operator?: boolean | null; name?: string | null } | null,
) {
  if (!category) return false;
  if (category.requires_operator) return true;
  return normSoft(category.name).startsWith("operador");
}

const toDec = (v: unknown) =>
  v === undefined || v === null || v === ""
    ? undefined
    : new Prisma.Decimal(typeof v === "number" ? v : String(v));

function parseCreateOptionalText(
  raw: unknown,
  field: string,
  maxLen: number,
): { value?: string; error?: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "string") {
    return { error: `${field} inválido` };
  }
  const value = raw.trim();
  if (!value) return {};
  if (value.length > maxLen) {
    return { error: `${field} supera ${maxLen} caracteres` };
  }
  return { value };
}

type PaymentLineInput = {
  amount: unknown;
  payment_method_id: unknown;
  account_id?: unknown;
};

type PaymentLineNormalized = {
  amount: number;
  payment_method_id: number;
  account_id?: number;
};

function parsePayments(raw: unknown): PaymentLineNormalized[] {
  if (!Array.isArray(raw)) return [];
  const out: PaymentLineNormalized[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as PaymentLineInput;
    const amount = Number(rec.amount ?? 0);
    const payment_method_id = Number(rec.payment_method_id);
    const account_id =
      rec.account_id === null || rec.account_id === undefined || rec.account_id === ""
        ? undefined
        : Number(rec.account_id);

    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!Number.isFinite(payment_method_id) || payment_method_id <= 0) continue;

    out.push({
      amount,
      payment_method_id: Math.trunc(payment_method_id),
      account_id:
        Number.isFinite(account_id as number) && Number(account_id) > 0
          ? Math.trunc(Number(account_id))
          : undefined,
    });
  }
  return out;
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
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

    const takeParam = safeNumber(
      Array.isArray(req.query.take) ? req.query.take[0] : req.query.take,
    );
    const take = Math.min(Math.max(takeParam || 24, 1), 100);

    const cursorParam = safeNumber(
      Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor,
    );
    const cursor = cursorParam;

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
        id_other_income: true,
        agency_other_income_id: true,
        id_agency: true,
        description: true,
        counterparty_type: true,
        counterparty_name: true,
        receipt_to: true,
        reference_note: true,
        amount: true,
        currency: true,
        issue_date: true,
        payment_fee_amount: true,
        payment_method_id: true,
        account_id: true,
        ...(hasCategoryColumn ? { category_id: true } : {}),
        ...(hasOperatorColumn ? { operator_id: true } : {}),
        verification_status: true,
        verified_at: true,
        verified_by: true,
        created_at: true,
        created_by: true,
        payments: true,
        ...(hasCategoryColumn
          ? {
              category: {
                select: { id_category: true, name: true, enabled: true },
              },
            }
          : {}),
        ...(hasOperatorColumn
          ? {
              operator: {
                select: {
                  id_operator: true,
                  agency_operator_id: true,
                  name: true,
                },
              },
            }
          : {}),
        verifiedBy: {
          select: { id_user: true, first_name: true, last_name: true },
        },
        createdBy: {
          select: { id_user: true, first_name: true, last_name: true },
        },
      },
      orderBy: { id_other_income: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id_other_income: cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > take;
    const sliced = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id_other_income : null;

    return res.status(200).json({ items: sliced, nextCursor });
  } catch (e) {
    console.error("[other-incomes][GET]", e);
    return res
      .status(500)
      .json({ error: "Error al obtener ingresos" });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
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
  if (!canOtherIncomes) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  try {
    const [hasCategoryColumn, hasCategoryScope, hasOperatorColumn] =
      await Promise.all([
      hasSchemaColumn("OtherIncome", "category_id"),
      hasSchemaColumn("ExpenseCategory", "scope"),
      hasSchemaColumn("OtherIncome", "operator_id"),
    ]);

    const b = req.body ?? {};

    const description = String(b.description ?? "").trim();
    const currency = String(b.currency ?? "").trim().toUpperCase();
    const counterpartyTypeResult = parseCreateOptionalText(
      b.counterparty_type,
      "counterparty_type",
      60,
    );
    if (counterpartyTypeResult.error) {
      return res.status(400).json({ error: counterpartyTypeResult.error });
    }
    const counterpartyNameResult = parseCreateOptionalText(
      b.counterparty_name,
      "counterparty_name",
      160,
    );
    if (counterpartyNameResult.error) {
      return res.status(400).json({ error: counterpartyNameResult.error });
    }
    const receiptToResult = parseCreateOptionalText(
      b.receipt_to,
      "receipt_to",
      160,
    );
    if (receiptToResult.error) {
      return res.status(400).json({ error: receiptToResult.error });
    }
    const referenceNoteResult = parseCreateOptionalText(
      b.reference_note,
      "reference_note",
      500,
    );
    if (referenceNoteResult.error) {
      return res.status(400).json({ error: referenceNoteResult.error });
    }

    const parsedIssueDate = b.issue_date ? toLocalDate(b.issue_date) : undefined;
    if (b.issue_date && !parsedIssueDate) {
      return res.status(400).json({ error: "issue_date inválida" });
    }
    const fallbackIssueDate =
      parseDateInputInBuenosAires(todayDateKeyInBuenosAires()) ?? new Date();

    if (!description) {
      return res.status(400).json({ error: "description es requerido" });
    }
    if (!currency) {
      return res.status(400).json({ error: "currency es requerido" });
    }

    const hasPaymentsProp = Object.prototype.hasOwnProperty.call(
      b,
      "payments",
    );
    if (hasPaymentsProp && !Array.isArray(b.payments)) {
      return res.status(400).json({ error: "payments inválidos" });
    }
    const payments = Array.isArray(b.payments) ? parsePayments(b.payments) : [];
    const hasPayments = payments.length > 0;

    const amountRaw = Number(b.amount);
    const amount = hasPayments
      ? payments.reduce((acc, p) => acc + Number(p.amount || 0), 0)
      : amountRaw;

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount inválido" });
    }

    const paymentFee = toDec(b.payment_fee_amount);
    if (paymentFee && paymentFee.toNumber() < 0) {
      return res
        .status(400)
        .json({ error: "payment_fee_amount inválido" });
    }

    const legacyPmId = hasPayments
      ? payments[0].payment_method_id
      : Number.isFinite(Number(b.payment_method_id)) &&
          Number(b.payment_method_id) > 0
        ? Number(b.payment_method_id)
        : undefined;

    const legacyAccId = hasPayments
      ? payments[0].account_id
      : Number.isFinite(Number(b.account_id)) && Number(b.account_id) > 0
        ? Number(b.account_id)
        : undefined;
    const categoryId = parsePositiveInt(b.category_id);
    if (
      b.category_id !== undefined &&
      b.category_id !== null &&
      categoryId === undefined
    ) {
      return res.status(400).json({ error: "category_id inválido" });
    }

    if (categoryId && !hasCategoryColumn) {
      return res.status(409).json({
        error:
          "La base conectada por la app no tiene OtherIncome.category_id. Ejecutá migraciones en esa misma conexión.",
      });
    }

    const hasOperatorInput =
      b.operator_id !== undefined && b.operator_id !== null && b.operator_id !== "";
    const operatorId = parsePositiveInt(b.operator_id);
    if (hasOperatorInput && operatorId === undefined) {
      return res.status(400).json({ error: "operator_id inválido" });
    }
    if (operatorId && !hasOperatorColumn) {
      return res.status(409).json({
        error:
          "La base conectada por la app no tiene OtherIncome.operator_id. Ejecutá migraciones en esa misma conexión.",
      });
    }

    let category:
      | {
          id_category: number;
          name: string;
          requires_operator: boolean;
        }
      | null
      | undefined;
    if (categoryId) {
      category = await prisma.expenseCategory.findFirst({
        where: {
          id_category: categoryId,
          id_agency: auth.id_agency,
          ...(hasCategoryScope ? { scope: "OTHER_INCOME" } : {}),
        },
        select: { id_category: true, name: true, requires_operator: true },
      });
      if (!category) {
        return res.status(400).json({ error: "category_id inválido" });
      }
    }
    const categoryRequiresOperator = isOperatorCategory(category ?? null);

    if (categoryRequiresOperator && !operatorId) {
      return res.status(400).json({
        error:
          "Para categorías vinculadas a operadores, operator_id es obligatorio.",
      });
    }
    if (operatorId) {
      const operator = await prisma.operator.findFirst({
        where: { id_operator: operatorId, id_agency: auth.id_agency },
        select: { id_operator: true },
      });
      if (!operator) {
        return res.status(400).json({ error: "operator_id inválido" });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const agencyOtherIncomeId = await getNextAgencyCounter(
        tx,
        auth.id_agency,
        "other_income",
      );

      const base = await tx.otherIncome.create({
        data: {
          agency_other_income_id: agencyOtherIncomeId,
          id_agency: auth.id_agency,
          description,
          ...(counterpartyTypeResult.value
            ? { counterparty_type: counterpartyTypeResult.value }
            : {}),
          ...(counterpartyNameResult.value
            ? { counterparty_name: counterpartyNameResult.value }
            : {}),
          ...(receiptToResult.value ? { receipt_to: receiptToResult.value } : {}),
          ...(referenceNoteResult.value
            ? { reference_note: referenceNoteResult.value }
            : {}),
          amount,
          currency,
          issue_date: parsedIssueDate ?? fallbackIssueDate,
          ...(paymentFee ? { payment_fee_amount: paymentFee } : {}),
          ...(legacyPmId ? { payment_method_id: legacyPmId } : {}),
          ...(legacyAccId ? { account_id: legacyAccId } : {}),
          ...(hasCategoryColumn && categoryId ? { category_id: categoryId } : {}),
          ...(hasOperatorColumn
            ? {
                operator_id:
                  categoryRequiresOperator && operatorId ? operatorId : null,
              }
            : {}),
          created_by: auth.id_user,
        },
        select: { id_other_income: true },
      });

      if (hasPayments) {
        await tx.otherIncomePayment.createMany({
          data: payments.map((p) => ({
            other_income_id: base.id_other_income,
            amount: new Prisma.Decimal(p.amount),
            payment_method_id: p.payment_method_id,
            account_id: p.account_id ?? null,
          })),
        });
      }

      return tx.otherIncome.findUnique({
        where: { id_other_income: base.id_other_income },
        select: {
          id_other_income: true,
          agency_other_income_id: true,
          id_agency: true,
          description: true,
          counterparty_type: true,
          counterparty_name: true,
          receipt_to: true,
          reference_note: true,
          amount: true,
          currency: true,
          issue_date: true,
          payment_fee_amount: true,
          payment_method_id: true,
          account_id: true,
          ...(hasCategoryColumn ? { category_id: true } : {}),
          ...(hasOperatorColumn ? { operator_id: true } : {}),
          verification_status: true,
          verified_at: true,
          verified_by: true,
          created_at: true,
          created_by: true,
          payments: true,
          ...(hasCategoryColumn
            ? {
                category: {
                  select: { id_category: true, name: true, enabled: true },
                },
              }
            : {}),
          ...(hasOperatorColumn
            ? {
                operator: {
                  select: {
                    id_operator: true,
                    agency_operator_id: true,
                    name: true,
                  },
                },
              }
            : {}),
          verifiedBy: {
            select: { id_user: true, first_name: true, last_name: true },
          },
          createdBy: {
            select: { id_user: true, first_name: true, last_name: true },
          },
        },
      });
    });

    return res.status(201).json({ item: created });
  } catch (e) {
    console.error("[other-incomes][POST]", e);
    return res
      .status(500)
      .json({ error: "Error al crear ingresos" });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
