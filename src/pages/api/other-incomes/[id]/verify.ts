// src/pages/api/other-incomes/[id]/verify.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection, normalizeRole } from "@/utils/permissions";
import {
  normalizeReceiptVerificationRules,
  pickReceiptVerificationRule,
  receiptMatchesRule,
  ruleHasRestrictions,
} from "@/utils/receiptVerification";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";

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
          email: u.email,
        };
    }
    return { id_user, id_agency: tokenAgencyId, role: tokenRole, email };
  } catch {
    return null;
  }
}

function normalizeStatus(raw: unknown): "PENDING" | "VERIFIED" | null {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  if (value === "PENDING" || value === "VERIFIED") return value;
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", ["PATCH"]);
    return res.status(405).end();
  }

  const authUser = await getUserFromAuth(req);
  const authUserId = authUser?.id_user;
  const authAgencyId = authUser?.id_agency;
  const role = String(authUser?.role || "");

  if (!authUserId || !authAgencyId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const planAccess = await ensurePlanFeatureAccess(
    authAgencyId,
    "other_incomes_verify",
  );
  if (!planAccess.allowed) {
    return res.status(403).json({ error: "Plan insuficiente" });
  }

  const financeGrants = await getFinanceSectionGrants(
    authAgencyId,
    authUserId,
  );
  const canVerify = canAccessFinanceSection(
    role,
    financeGrants,
    "other_incomes_verify",
  );
  if (!canVerify) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!rawId) {
    return res.status(400).json({ error: "ID invalido" });
  }
  const parsedId = Number(rawId);
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    return res.status(400).json({ error: "ID invalido" });
  }

  const status = normalizeStatus((req.body as Record<string, unknown>)?.status);
  if (!status) {
    return res
      .status(400)
      .json({ error: "status invalido (PENDING | VERIFIED)" });
  }

  const income = await prisma.otherIncome.findFirst({
    where: { id_other_income: parsedId, id_agency: authAgencyId },
    select: {
      id_other_income: true,
      payment_method_id: true,
      account_id: true,
      payments: {
        select: { payment_method_id: true, account_id: true },
      },
    },
  });

  if (!income) {
    return res.status(404).json({ error: "Ingreso no encontrado" });
  }

  const config = await prisma.financeConfig.findFirst({
    where: { id_agency: authAgencyId },
    select: { receipt_verification_rules: true },
  });
  const rules = normalizeReceiptVerificationRules(
    config?.receipt_verification_rules,
  );
  const rule = pickReceiptVerificationRule(rules, authUserId);

  if (rule && ruleHasRestrictions(rule)) {
    const allowed = receiptMatchesRule(rule, {
      payment_method_id: income.payment_method_id,
      account_id: income.account_id,
      payments: income.payments ?? [],
    });
    if (!allowed) {
      return res.status(403).json({
        error: "No autorizado para verificar este ingreso",
      });
    }
  }

  const nextData =
    status === "VERIFIED"
      ? {
          verification_status: status,
          verified_at: new Date(),
          verified_by: authUserId,
        }
      : {
          verification_status: status,
          verified_at: null,
          verified_by: null,
        };

  const updated = await prisma.otherIncome.update({
    where: { id_other_income: income.id_other_income },
    data: nextData,
    select: {
      id_other_income: true,
      verification_status: true,
      verified_at: true,
      verified_by: true,
    },
  });

  return res.status(200).json({ item: updated });
}
