// src/pages/api/finance/section-access/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { jwtVerify, type JWTPayload } from "jose";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { isMissingColumnError } from "@/lib/prismaErrors";
import {
  normalizeFinanceSectionRules,
  pickFinanceSectionRule,
  normalizeRole,
} from "@/utils/permissions";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

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

type AuthContext = {
  id_user: number;
  id_agency: number;
  role: string;
};

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    const v = (req.cookies || {})[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function resolveAuth(req: NextApiRequest): Promise<AuthContext | null> {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;
    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || 0;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || 0;
    const role = normalizeRole(p.role);
    const email = p.email;

    if (id_user || email) {
      const user = await prisma.user.findFirst({
        where: id_user ? { id_user } : { email },
        select: { id_user: true, id_agency: true, role: true },
      });
      if (user?.id_user && user.id_agency) {
        return {
          id_user: user.id_user,
          id_agency: user.id_agency,
          role: normalizeRole(user.role) || role,
        };
      }
    }

    if (id_user && id_agency) {
      return { id_user, id_agency, role: role || "" };
    }
  } catch {
    return null;
  }
  return null;
}

const MANAGER_ROLES = new Set(["gerente", "desarrollador"]);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const auth = await resolveAuth(req);
  if (!auth?.id_agency || !auth.id_user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    try {
      const scopeParam = Array.isArray(req.query.scope)
        ? req.query.scope[0]
        : req.query.scope;
      const scope = String(scopeParam || "").trim().toLowerCase();
      const wantsAll = scope === "all";
      const isManager = MANAGER_ROLES.has(normalizeRole(auth.role));

      let rules: ReturnType<typeof normalizeFinanceSectionRules> = [];
      try {
        const config = await prisma.financeConfig.findFirst({
          where: { id_agency: auth.id_agency },
          select: { section_access_rules: true },
        });
        rules = normalizeFinanceSectionRules(config?.section_access_rules);
      } catch (error) {
        if (!isMissingColumnError(error, "FinanceConfig.section_access_rules")) {
          throw error;
        }
      }

      if (wantsAll && isManager) {
        return res.status(200).json({ rules });
      }

      const ownRule = pickFinanceSectionRule(rules, auth.id_user);
      return res.status(200).json({ rules: ownRule ? [ownRule] : [] });
    } catch (error) {
      console.error("[finance/section-access][GET]", reqId, error);
      return res.status(500).json({ error: "Error obteniendo configuracion" });
    }
  }

  if (req.method === "PUT") {
    const role = normalizeRole(auth.role);
    if (!MANAGER_ROLES.has(role)) {
      return res.status(403).json({ error: "Sin permisos" });
    }
    try {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const rawRules = (body as Record<string, unknown>)?.rules;
      if (!Array.isArray(rawRules)) {
        return res.status(400).json({ error: "rules invalido" });
      }

      const normalized = normalizeFinanceSectionRules(rawRules);
      const userIds = normalized.map((rule) => rule.id_user);

      const users = userIds.length
        ? await prisma.user.findMany({
            where: {
              id_agency: auth.id_agency,
              id_user: { in: userIds },
            },
            select: { id_user: true },
          })
        : [];
      const allowed = new Set(users.map((u) => u.id_user));
      const sanitized = normalized.filter((rule) => allowed.has(rule.id_user));

      await prisma.$transaction(async (tx) => {
        const existing = await tx.financeConfig.findUnique({
          where: { id_agency: auth.id_agency },
          select: { id_config: true },
        });

        if (existing) {
          await tx.financeConfig.update({
            where: { id_agency: auth.id_agency },
            data: { section_access_rules: sanitized },
          });
          return;
        }

        const primaryCurrency = await tx.financeCurrency.findFirst({
          where: { id_agency: auth.id_agency, is_primary: true },
          select: { code: true },
        });
        const fallbackCurrency = await tx.financeCurrency.findFirst({
          where: { id_agency: auth.id_agency },
          orderBy: { sort_order: "asc" },
          select: { code: true },
        });
        const defaultCurrency =
          primaryCurrency?.code || fallbackCurrency?.code || "ARS";

        const agencyConfigId = await getNextAgencyCounter(
          tx,
          auth.id_agency,
          "finance_config",
        );
        await tx.financeConfig.create({
          data: {
            id_agency: auth.id_agency,
            agency_finance_config_id: agencyConfigId,
            default_currency_code: defaultCurrency,
            hide_operator_expenses_in_investments: false,
            section_access_rules: sanitized,
          },
        });
      });

      return res.status(200).json({ rules: sanitized });
    } catch (error) {
      if (isMissingColumnError(error, "FinanceConfig.section_access_rules")) {
        return res.status(409).json({
          error:
            "La base no tiene la columna section_access_rules. Ejecuta las migraciones.",
        });
      }
      console.error("[finance/section-access][PUT]", reqId, error);
      return res.status(500).json({ error: "Error guardando configuracion" });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
