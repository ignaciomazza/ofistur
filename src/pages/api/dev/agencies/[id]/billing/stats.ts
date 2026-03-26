// src/pages/api/dev/agencies/[id]/billing/stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import {
  calcMonthlyBaseWithVat,
  isPlanKey,
  type PlanKey,
} from "@/lib/billing/pricing";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  email?: string;
};

type AppError = Error & { status?: number };

function httpError(status: number, message: string): AppError {
  const err = new Error(message) as AppError;
  err.status = status;
  return err;
}

function normalizeRole(r?: string) {
  return (r ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

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
    const v = req.cookies?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function requireDeveloper(req: NextApiRequest): Promise<{
  id_user: number;
  email?: string;
}> {
  const token = getTokenFromRequest(req);
  if (!token) throw httpError(401, "No autenticado");

  const { payload } = await jwtVerify(
    token,
    new TextEncoder().encode(JWT_SECRET),
  );
  const p = payload as TokenPayload;
  const id_user = Number(p.id_user ?? p.userId ?? p.uid) || 0;
  const role = normalizeRole(p.role);

  if (!id_user || role !== "desarrollador") {
    throw httpError(403, "No autorizado");
  }
  return { id_user, email: p.email };
}

function parseAgencyId(param: unknown): number {
  const raw = Array.isArray(param) ? param[0] : param;
  const id = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0)
    throw httpError(400, "ID de agencia invalido");
  return id;
}

async function resolveBillingOwnerId(id_agency: number): Promise<number> {
  const agency = await prisma.agency.findUnique({
    where: { id_agency },
    select: { id_agency: true, billing_owner_agency_id: true },
  });
  if (!agency) throw httpError(404, "Agencia no encontrada");
  return agency.billing_owner_agency_id ?? agency.id_agency;
}

type Adjustment = {
  kind: string;
  mode: string;
  value: unknown;
  currency: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  active: boolean;
};

function activeAdjustments(adjustments: Adjustment[], date: Date) {
  return adjustments.filter((adj) => {
    if (!adj.active) return false;
    if (adj.starts_at && date < adj.starts_at) return false;
    if (adj.ends_at && date > adj.ends_at) return false;
    return true;
  });
}

function calcDiscountTotal(base: number, adjustments: Adjustment[]) {
  const percent = adjustments
    .filter((adj) => adj.mode === "percent")
    .reduce((sum, adj) => sum + Number(adj.value || 0), 0);
  const fixed = adjustments
    .filter((adj) => adj.mode === "fixed")
    .reduce((sum, adj) => sum + Number(adj.value || 0), 0);
  return base * (percent / 100) + fixed;
}

function calcTotals(
  base: number,
  adjustments: Adjustment[],
  date: Date,
) {
  const active = activeAdjustments(adjustments, date);
  const discounts = active.filter((adj) => adj.kind === "discount");
  const discountUsd = calcDiscountTotal(base, discounts);
  const total = Math.max(base - discountUsd, 0);
  return { discountUsd, total };
}

function estimateForMonths(
  planKey: PlanKey,
  billingUsers: number,
  storageEnabled: boolean,
  adjustments: Adjustment[],
  months: number,
) {
  const base = calcMonthlyBaseWithVat(planKey, billingUsers, { storageEnabled });
  let total = 0;
  const start = new Date();
  for (let i = 0; i < months; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 15);
    const totals = calcTotals(base, adjustments, date);
    total += totals.total;
  }
  return { base, total };
}

function paidAmountToUsd(charge: {
  paid_amount: unknown;
  paid_currency: string | null;
  fx_rate: unknown;
  total_usd: unknown;
}) {
  const paid = Number(charge.paid_amount ?? 0);
  if (Number.isFinite(paid) && paid > 0) {
    const currency = (charge.paid_currency || "USD").toUpperCase();
    if (currency === "USD") return paid;
    const fx = Number(charge.fx_rate ?? 0);
    if (Number.isFinite(fx) && fx > 0) return paid / fx;
  }
  return Number(charge.total_usd ?? 0);
}

function chargeSortDate(charge: {
  period_end?: Date | null;
  period_start?: Date | null;
  created_at?: Date | null;
}) {
  return (
    charge.period_end ??
    charge.period_start ??
    charge.created_at ??
    new Date(0)
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", ["GET"]);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    await requireDeveloper(req);
    const id_agency = parseAgencyId(req.query.id);
    const billingOwnerId = await resolveBillingOwnerId(id_agency);

    const [config, adjustments, charges, storageConfig] = await Promise.all([
      prisma.agencyBillingConfig.findUnique({
        where: { id_agency: billingOwnerId },
      }),
      prisma.agencyBillingAdjustment.findMany({
        where: { id_agency: billingOwnerId },
      }),
      prisma.agencyBillingCharge.findMany({
        where: { id_agency: billingOwnerId },
      }),
      prisma.agencyStorageConfig.findUnique({
        where: { id_agency: billingOwnerId },
        select: { enabled: true },
      }),
    ]);

    const planKey = isPlanKey(config?.plan_key) ? config?.plan_key : "basico";
    const billingUsers = config?.billing_users ?? 3;
    const storageEnabled = Boolean(storageConfig?.enabled);

    const monthlyBase = calcMonthlyBaseWithVat(planKey, billingUsers, {
      storageEnabled,
    });
    const monthlyTotals = calcTotals(monthlyBase, adjustments, new Date());

    const estimates = {
      monthly_usd: monthlyTotals.total,
      quarterly_usd: estimateForMonths(
        planKey,
        billingUsers,
        storageEnabled,
        adjustments,
        3,
      ).total,
      semiannual_usd: estimateForMonths(
        planKey,
        billingUsers,
        storageEnabled,
        adjustments,
        6,
      ).total,
      annual_usd: estimateForMonths(
        planKey,
        billingUsers,
        storageEnabled,
        adjustments,
        12,
      ).total,
    };

    const recurringCharges = charges.filter(
      (c) => String(c.charge_kind || "RECURRING").toUpperCase() !== "EXTRA",
    );

    const paidTotal = recurringCharges.reduce((sum, c) => {
      if (String(c.status || "").toUpperCase() !== "PAID") return sum;
      return sum + paidAmountToUsd(c);
    }, 0);
    const pendingCharges = recurringCharges.filter(
      (c) => String(c.status || "").toUpperCase() !== "PAID",
    );
    const lastCharge = recurringCharges.reduce<typeof charges[0] | null>(
      (acc, c) => {
        if (!acc) return c;
        return chargeSortDate(c) > chargeSortDate(acc) ? c : acc;
      },
      null,
    );

    const lastPaymentAt = recurringCharges.reduce<Date | null>((acc, c) => {
      const baseDate = c.paid_at ?? c.created_at;
      if (!baseDate) return acc;
      if (!acc || baseDate > acc) return baseDate;
      return acc;
    }, null);

    return res.status(200).json({
      totals: {
        paid_usd: paidTotal,
      },
      counts: {
        total: recurringCharges.length,
        pending: pendingCharges.length,
        paid: recurringCharges.length - pendingCharges.length,
      },
      last_payment_at: lastPaymentAt,
      last_charge: lastCharge
        ? {
            status: lastCharge.status,
            period_start: lastCharge.period_start,
            period_end: lastCharge.period_end,
            total_usd: Number(lastCharge.total_usd ?? 0),
          }
        : null,
      estimates,
    });
  } catch (e) {
    const err = e as AppError;
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Error";
    return res.status(status).json({ error: message });
  }
}
