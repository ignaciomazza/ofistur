// src/pages/api/other-incomes/[id].ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection, normalizeRole } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { hasSchemaColumn } from "@/lib/schemaColumns";
import { parseDateInputInBuenosAires } from "@/lib/buenosAiresDate";

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

function toLocalDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}

const toDec = (v: unknown) =>
  v === undefined || v === null || v === ""
    ? undefined
    : new Prisma.Decimal(typeof v === "number" ? v : String(v));

type ParsedUpdateText = {
  present: boolean;
  value: string | null;
  error?: string;
};

function parseUpdateOptionalText(
  raw: unknown,
  field: string,
  maxLen: number,
): ParsedUpdateText {
  if (raw === undefined) return { present: false, value: null };
  if (raw === null) return { present: true, value: null };
  if (typeof raw !== "string") {
    return { present: true, value: null, error: `${field} inválido` };
  }
  const value = raw.trim();
  if (!value) return { present: true, value: null };
  if (value.length > maxLen) {
    return {
      present: true,
      value: null,
      error: `${field} supera ${maxLen} caracteres`,
    };
  }
  return { present: true, value };
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

  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = safeNumber(rawId);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const [hasCategoryColumn, hasOperatorColumn] = await Promise.all([
    hasSchemaColumn("OtherIncome", "category_id"),
    hasSchemaColumn("OtherIncome", "operator_id"),
  ]);

  const item = await prisma.otherIncome.findFirst({
    where: { id_other_income: id, id_agency: auth.id_agency },
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

  if (!item) return res.status(404).json({ error: "No encontrado" });

  return res.status(200).json({ item });
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
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

  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = safeNumber(rawId);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const [hasCategoryColumn, hasCategoryScope, hasOperatorColumn] =
    await Promise.all([
      hasSchemaColumn("OtherIncome", "category_id"),
      hasSchemaColumn("ExpenseCategory", "scope"),
      hasSchemaColumn("OtherIncome", "operator_id"),
    ]);

  const existing = await prisma.otherIncome.findFirst({
    where: { id_other_income: id, id_agency: auth.id_agency },
    select: {
      id_other_income: true,
      verification_status: true,
      ...(hasCategoryColumn ? { category_id: true } : {}),
      ...(hasOperatorColumn ? { operator_id: true } : {}),
    },
  });
  if (!existing) return res.status(404).json({ error: "No encontrado" });

  if (existing.verification_status === "VERIFIED") {
    return res
      .status(409)
      .json({ error: "Desverificá el ingreso antes de editarlo." });
  }

  const b = req.body ?? {};

  const descriptionRaw =
    typeof b.description === "string" ? b.description.trim() : undefined;
  if (b.description !== undefined && !descriptionRaw) {
    return res.status(400).json({ error: "description inválido" });
  }

  const currencyRaw =
    typeof b.currency === "string" ? b.currency.trim().toUpperCase() : undefined;
  if (b.currency !== undefined && !currencyRaw) {
    return res.status(400).json({ error: "currency inválido" });
  }

  const issueDate = b.issue_date ? toLocalDate(b.issue_date) : undefined;
  if (b.issue_date && !issueDate) {
    return res.status(400).json({ error: "issue_date inválida" });
  }

  const paymentFee = toDec(b.payment_fee_amount);
  if (paymentFee && paymentFee.toNumber() < 0) {
    return res.status(400).json({ error: "payment_fee_amount inválido" });
  }

  const counterpartyType = parseUpdateOptionalText(
    b.counterparty_type,
    "counterparty_type",
    60,
  );
  if (counterpartyType.error) {
    return res.status(400).json({ error: counterpartyType.error });
  }
  const counterpartyName = parseUpdateOptionalText(
    b.counterparty_name,
    "counterparty_name",
    160,
  );
  if (counterpartyName.error) {
    return res.status(400).json({ error: counterpartyName.error });
  }
  const receiptTo = parseUpdateOptionalText(b.receipt_to, "receipt_to", 160);
  if (receiptTo.error) {
    return res.status(400).json({ error: receiptTo.error });
  }
  const referenceNote = parseUpdateOptionalText(
    b.reference_note,
    "reference_note",
    500,
  );
  if (referenceNote.error) {
    return res.status(400).json({ error: referenceNote.error });
  }

  const hasPayments = Object.prototype.hasOwnProperty.call(b, "payments");
  if (hasPayments && !Array.isArray(b.payments)) {
    return res.status(400).json({ error: "payments inválidos" });
  }
  const payments = hasPayments ? parsePayments(b.payments) : [];
  if (hasPayments && payments.length === 0) {
    return res.status(400).json({ error: "payments inválidos" });
  }

  const amountRaw = safeNumber(b.amount);
  const amount = hasPayments
    ? payments.reduce((acc, p) => acc + Number(p.amount || 0), 0)
    : amountRaw;

  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    return res.status(400).json({ error: "amount inválido" });
  }

  const rawPmId = hasPayments
    ? payments[0]?.payment_method_id
    : safeNumber(b.payment_method_id);
  const legacyPmId = rawPmId && rawPmId > 0 ? rawPmId : undefined;

  const rawAccId = hasPayments
    ? payments[0]?.account_id
    : safeNumber(b.account_id);
  const legacyAccId = rawAccId && rawAccId > 0 ? rawAccId : undefined;
  const hasCategory = Object.prototype.hasOwnProperty.call(b, "category_id");
  const categoryId = parsePositiveInt(b.category_id);
  const categoryClear =
    b.category_id === null ||
    b.category_id === undefined ||
    b.category_id === "";
  if (hasCategory && !categoryClear && categoryId === undefined) {
    return res.status(400).json({ error: "category_id inválido" });
  }
  if (hasCategory && !hasCategoryColumn) {
    return res.status(409).json({
      error:
        "La base conectada por la app no tiene OtherIncome.category_id. Ejecutá migraciones en esa misma conexión.",
    });
  }

  const hasOperator = Object.prototype.hasOwnProperty.call(b, "operator_id");
  const operatorId = parsePositiveInt(b.operator_id);
  const operatorClear =
    b.operator_id === null || b.operator_id === undefined || b.operator_id === "";
  if (hasOperator && !operatorClear && operatorId === undefined) {
    return res.status(400).json({ error: "operator_id inválido" });
  }
  if (hasOperator && !hasOperatorColumn) {
    return res.status(409).json({
      error:
        "La base conectada por la app no tiene OtherIncome.operator_id. Ejecutá migraciones en esa misma conexión.",
    });
  }

  const existingCategoryId = hasCategoryColumn
    ? ((existing as { category_id?: number | null }).category_id ?? null)
    : null;
  const nextCategoryId = hasCategory ? (categoryId ?? null) : existingCategoryId;

  let category:
    | {
        id_category: number;
        name: string;
        requires_operator: boolean;
      }
    | null = null;
  if (nextCategoryId) {
    category = await prisma.expenseCategory.findFirst({
      where: {
        id_category: nextCategoryId,
        id_agency: auth.id_agency,
        ...(hasCategoryScope ? { scope: "OTHER_INCOME" } : {}),
      },
      select: { id_category: true, name: true, requires_operator: true },
    });
    if (!category) {
      return res.status(400).json({ error: "category_id inválido" });
    }
  }
  const categoryRequiresOperator = isOperatorCategory(category);

  const existingOperatorId = hasOperatorColumn
    ? ((existing as { operator_id?: number | null }).operator_id ?? null)
    : null;
  const nextOperatorId = hasOperator ? (operatorId ?? null) : existingOperatorId;

  if (categoryRequiresOperator && !nextOperatorId) {
    return res.status(400).json({
      error:
        "Para categorías vinculadas a operadores, operator_id es obligatorio.",
    });
  }
  if (nextOperatorId) {
    const operator = await prisma.operator.findFirst({
      where: { id_operator: nextOperatorId, id_agency: auth.id_agency },
      select: { id_operator: true },
    });
    if (!operator) {
      return res.status(400).json({ error: "operator_id inválido" });
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const data: Prisma.OtherIncomeUncheckedUpdateInput = {};
      if (descriptionRaw !== undefined) data.description = descriptionRaw;
      if (currencyRaw !== undefined) data.currency = currencyRaw;
      if (issueDate !== undefined) data.issue_date = issueDate;
      if (counterpartyType.present) data.counterparty_type = counterpartyType.value;
      if (counterpartyName.present) data.counterparty_name = counterpartyName.value;
      if (receiptTo.present) data.receipt_to = receiptTo.value;
      if (referenceNote.present) data.reference_note = referenceNote.value;
      if (b.payment_fee_amount === null) {
        data.payment_fee_amount = null;
      } else if (paymentFee !== undefined) {
        data.payment_fee_amount = paymentFee;
      }
      if (amount !== undefined) data.amount = amount;

      if (hasPayments) {
        data.payment_method_id = legacyPmId ?? null;
        data.account_id = legacyAccId ?? null;
      } else {
        if (b.payment_method_id !== undefined)
          data.payment_method_id = legacyPmId ?? null;
        if (b.account_id !== undefined) data.account_id = legacyAccId ?? null;
      }
      if (hasCategory && hasCategoryColumn) {
        data.category_id = categoryId ?? null;
      }
      if (hasOperatorColumn && (hasOperator || hasCategory)) {
        data.operator_id = categoryRequiresOperator ? (nextOperatorId ?? null) : null;
      }

      const after = await tx.otherIncome.update({
        where: { id_other_income: id },
        data,
        select: { id_other_income: true },
      });

      if (hasPayments) {
        await tx.otherIncomePayment.deleteMany({
          where: { other_income_id: id },
        });
        await tx.otherIncomePayment.createMany({
          data: payments.map((p) => ({
            other_income_id: id,
            amount: new Prisma.Decimal(p.amount),
            payment_method_id: p.payment_method_id,
            account_id: p.account_id ?? null,
          })),
        });
      }

      return tx.otherIncome.findUnique({
        where: { id_other_income: after.id_other_income },
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

    return res.status(200).json({ item: updated });
  } catch (e) {
    console.error("[other-incomes][PUT]", e);
    return res
      .status(500)
      .json({ error: "Error al actualizar ingresos" });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
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

  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = safeNumber(rawId);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const existing = await prisma.otherIncome.findFirst({
    where: { id_other_income: id, id_agency: auth.id_agency },
    select: { id_other_income: true, verification_status: true },
  });
  if (!existing) return res.status(404).json({ error: "No encontrado" });

  if (existing.verification_status === "VERIFIED") {
    return res
      .status(409)
      .json({ error: "Desverificá el ingreso antes de eliminarlo." });
  }

  const hasCategoryColumn = await hasSchemaColumn("OtherIncome", "category_id");
  if (hasCategoryColumn) {
    await prisma.otherIncome.delete({ where: { id_other_income: id } });
  } else {
    await prisma.otherIncome.deleteMany({ where: { id_other_income: id } });
  }
  return res.status(200).json({ ok: true });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "PUT") return handlePut(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
