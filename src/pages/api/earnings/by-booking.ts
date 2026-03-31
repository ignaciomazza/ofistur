// src/pages/api/earnings/by-booking.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { computeBillingAdjustments } from "@/utils/billingAdjustments";
import { getGrossIncomeTaxAmountFromBillingOverride } from "@/utils/billingOverride";
import type { BillingAdjustmentConfig } from "@/types";
import type { CommissionOverrides, CommissionRule } from "@/types/commission";
import {
  canAccessBookingByRole,
  getFinanceSectionGrants,
} from "@/lib/accessControl";
import { canAccessFinanceSection } from "@/utils/permissions";
import { resolveAuth } from "@/lib/auth";
import {
  normalizeCommissionOverridesLenient,
  pruneOverridesByLeaderIds,
  resolveCommissionForContext,
  sanitizeCommissionOverrides,
} from "@/utils/commissionOverrides";

function normalizeSaleTotals(
  input: unknown,
  allowed?: Set<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const obj = input as Record<string, unknown>;
  for (const [keyRaw, val] of Object.entries(obj)) {
    const key = String(keyRaw || "").trim().toUpperCase();
    if (!key) continue;
    if (allowed && allowed.size > 0 && !allowed.has(key)) continue;
    const n =
      typeof val === "number"
        ? val
        : Number(String(val).replace(",", "."));
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
}

async function getAuth(
  req: NextApiRequest,
): Promise<{ id_agency: number; id_user: number; role: string } | null> {
  const auth = await resolveAuth(req);
  if (!auth) return null;
  return { id_agency: auth.id_agency, id_user: auth.id_user, role: auth.role };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    | {
        ownerPct: number;
        rule?: CommissionRule;
        custom?: CommissionOverrides | null;
        commissionBaseByCurrency: Record<string, number>;
        sellerEarningsByCurrency: Record<string, number>;
      }
    | { error: string }
  >,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const bookingId = Number(req.query.bookingId);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    return res.status(400).json({ error: "bookingId inválido" });
  }

  const auth = await getAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });
  const financeGrants = await getFinanceSectionGrants(
    auth.id_agency,
    auth.id_user,
  );
  const canEarnings = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "earnings",
  );

  try {
    // Booking + owner + fecha
    const booking = await prisma.booking.findUnique({
      where: { id_booking: bookingId },
      select: {
        id_booking: true,
        id_agency: true,
        id_user: true,
        creation_date: true,
        sale_totals: true,
        use_booking_sale_total_override: true,
        commission_overrides: true,
      },
    });
    if (!booking || booking.id_agency !== auth.id_agency) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }
    const canReadByRole = await canAccessBookingByRole(auth, {
      id_user: booking.id_user,
      id_agency: booking.id_agency,
    });
    if (!canEarnings && !canReadByRole) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    const createdAt = booking.creation_date;
    const ownerId = booking.id_user;

    const agency = await prisma.agency.findUnique({
      where: { id_agency: auth.id_agency },
      select: { transfer_fee_pct: true },
    });
    const agencyFeePct =
      agency?.transfer_fee_pct != null ? Number(agency.transfer_fee_pct) : 0.024;
    const calcConfig = await prisma.serviceCalcConfig.findUnique({
      where: { id_agency: auth.id_agency },
      select: { use_booking_sale_total: true, billing_adjustments: true },
    });
    const inheritedUseBookingSaleTotal = Boolean(calcConfig?.use_booking_sale_total);
    const useBookingSaleTotal =
      typeof booking.use_booking_sale_total_override === "boolean"
        ? booking.use_booking_sale_total_override
        : inheritedUseBookingSaleTotal;
    const billingAdjustments = Array.isArray(calcConfig?.billing_adjustments)
      ? (calcConfig?.billing_adjustments as unknown[])
      : [];

    const currencyRows = await prisma.financeCurrency.findMany({
      where: { id_agency: auth.id_agency, enabled: true },
      select: { code: true },
    });
    const enabledCurrencies = new Set(
      currencyRows
        .map((c) => String(c.code || "").trim().toUpperCase())
        .filter(Boolean),
    );
    const hasCurrencyFilter = enabledCurrencies.size > 0;
    const isCurrencyAllowed = (cur: string) =>
      !!cur && (!hasCurrencyFilter || enabledCurrencies.has(cur));

    // Servicios de la reserva (para base de comisión)
    const services = await prisma.service.findMany({
      // ⬇️ filtrar por la relación booking
      where: { booking: { id_booking: bookingId } },
      select: {
        id_service: true,
        currency: true,
        sale_price: true,
        cost_price: true,
        other_taxes: true,
        totalCommissionWithoutVAT: true,
        transfer_fee_amount: true,
        transfer_fee_pct: true,
        extra_costs_amount: true,
        extra_taxes_amount: true,
        extra_adjustments: true,
        billing_override: true,
      },
    });

    const commissionBaseByCurrency: Record<string, number> = {};
    const inc = (cur: string, amount: number) => {
      if (!isCurrencyAllowed(cur)) return;
      commissionBaseByCurrency[cur] = (commissionBaseByCurrency[cur] || 0) + amount;
    };

    if (useBookingSaleTotal) {
      const addTo = (acc: Record<string, number>, cur: string, val: number) => {
        if (!isCurrencyAllowed(cur)) return;
        acc[cur] = (acc[cur] || 0) + val;
      };

      const saleTotals = normalizeSaleTotals(
        booking.sale_totals,
        hasCurrencyFilter ? enabledCurrencies : undefined,
      );
      const fallbackTotals: Record<string, number> = {};
      const costTotals: Record<string, number> = {};
      const taxTotals: Record<string, number> = {};
      const grossIncomeTaxTotals: Record<string, number> = {};

      for (const s of services) {
        const cur = String(s.currency || "").trim().toUpperCase();
        if (!cur) continue;
        addTo(fallbackTotals, cur, Number(s.sale_price) || 0);
        addTo(costTotals, cur, Number(s.cost_price) || 0);
        addTo(taxTotals, cur, Number(s.other_taxes) || 0);
        addTo(
          grossIncomeTaxTotals,
          cur,
          getGrossIncomeTaxAmountFromBillingOverride(s.billing_override),
        );
      }

      const totals =
        Object.keys(saleTotals).length > 0 ? saleTotals : fallbackTotals;

      const serviceAdjustmentsByCurrency: Record<string, BillingAdjustmentConfig[]> =
        {};
      for (const s of services) {
        const cur = String(s.currency || "").trim().toUpperCase();
        if (!cur || !isCurrencyAllowed(cur)) continue;
        const items = Array.isArray(s.extra_adjustments)
          ? (s.extra_adjustments as unknown[])
          : [];
        if (!items.length) continue;
        const normalized = items
          .filter((item) => {
            if (!item || typeof item !== "object") return false;
            const rec = item as Record<string, unknown>;
            return (
              rec.active !== false &&
              String(rec.source || "").toLowerCase() === "service"
            );
          })
          .map((item, idx): BillingAdjustmentConfig => {
            const rec = item as Record<string, unknown>;
            const kind: BillingAdjustmentConfig["kind"] =
              rec.kind === "tax" || rec.kind === "cost" ? rec.kind : "cost";
            const basis: BillingAdjustmentConfig["basis"] =
              rec.basis === "cost" ||
              rec.basis === "margin" ||
              rec.basis === "sale"
                ? rec.basis
                : "sale";
            const valueType: BillingAdjustmentConfig["valueType"] =
              rec.valueType === "fixed" || rec.valueType === "percent"
                ? rec.valueType
                : "percent";
            const value =
              typeof rec.value === "number"
                ? rec.value
                : Number(String(rec.value ?? "").replace(",", "."));
            return {
              id:
                typeof rec.id === "string" && rec.id
                  ? rec.id
                  : `service-${s.id_service}-${idx}`,
              label:
                typeof rec.label === "string" && rec.label
                  ? rec.label
                  : "Ajuste servicio",
              kind,
              basis,
              valueType,
              value: Number.isFinite(value) ? value : 0,
              active: rec.active !== false,
              source: "service",
            };
          });
        if (!normalized.length) continue;
        serviceAdjustmentsByCurrency[cur] = [
          ...(serviceAdjustmentsByCurrency[cur] || []),
          ...normalized,
        ];
      }

      for (const [cur, total] of Object.entries(totals)) {
        if (!isCurrencyAllowed(cur)) continue;
        const sale = Number(total) || 0;
        const cost = Number(costTotals[cur] || 0);
        const taxes = Number(taxTotals[cur] || 0);
        const commissionBeforeFee = sale - cost - taxes;
        const fee =
          sale * (Number.isFinite(agencyFeePct) ? agencyFeePct : 0.024);
        const combinedAdjustments = [
          ...(billingAdjustments as BillingAdjustmentConfig[]),
          ...(serviceAdjustmentsByCurrency[cur] || []),
        ];
        const adjustments = computeBillingAdjustments(
          combinedAdjustments,
          sale,
          cost,
        );
        const iibb = grossIncomeTaxTotals[cur] || 0;
        commissionBaseByCurrency[cur] = Math.max(
          commissionBeforeFee - fee - adjustments.total - iibb,
          0,
        );
      }
    } else {
      // Base por moneda (mismo cálculo de /api/earnings)
      for (const s of services) {
        const cur = String(s.currency || "").trim().toUpperCase();
        if (!cur) continue;
        if (!isCurrencyAllowed(cur)) continue;
        const sale = Number(s.sale_price) || 0;
        const pct =
          s.transfer_fee_pct != null ? Number(s.transfer_fee_pct) : agencyFeePct;
        const fee =
          s.transfer_fee_amount != null
            ? Number(s.transfer_fee_amount)
            : sale * (Number.isFinite(pct) ? pct : 0.024);
        const dbCommission = Number(s.totalCommissionWithoutVAT ?? 0);
        const extraCosts = Number(s.extra_costs_amount ?? 0);
        const extraTaxes = Number(s.extra_taxes_amount ?? 0);
        inc(cur, Math.max(dbCommission - fee - extraCosts - extraTaxes, 0));
      }
    }

    // Resolver regla efectiva (última con valid_from <= createdAt; null = -∞)
    const rules = await prisma.commissionRuleSet.findMany({
      where: { id_agency: auth.id_agency, owner_user_id: ownerId },
      include: {
        shares: {
          select: {
            beneficiary_user_id: true,
            percent: true,
            beneficiary: { select: { first_name: true, last_name: true } },
          },
        },
      },
      orderBy: { valid_from: "asc" },
    });

    const createdTs = createdAt.getTime();
    let chosenRule: (typeof rules)[number] | null = rules[0] ?? null;
    for (const r of rules) {
      const ts = r.valid_from
        ? r.valid_from.getTime()
        : Number.NEGATIVE_INFINITY;
      if (ts <= createdTs) chosenRule = r;
      else break;
    }
    if (chosenRule && chosenRule.valid_from.getTime() > createdTs) {
      chosenRule = null;
    }

    const rule: CommissionRule = {
      sellerPct: chosenRule ? Number(chosenRule.own_pct) : 100,
      leaders: chosenRule
        ? chosenRule.shares.map((s) => ({
            userId: Number(s.beneficiary_user_id),
            pct: Number(s.percent),
            name: `${s.beneficiary.first_name} ${s.beneficiary.last_name}`,
          }))
        : [],
    };

    const customRaw = normalizeCommissionOverridesLenient(
      booking.commission_overrides,
    );
    const custom = sanitizeCommissionOverrides(
      pruneOverridesByLeaderIds(customRaw, rule.leaders.map((l) => l.userId)),
    );

    const sellerEarningsByCurrency: Record<string, number> = {};

    if (useBookingSaleTotal) {
      for (const [cur, base] of Object.entries(commissionBaseByCurrency)) {
        const { sellerPct } = resolveCommissionForContext({
          rule,
          overrides: custom,
          currency: cur,
          allowService: false,
        });
        sellerEarningsByCurrency[cur] = base * (sellerPct / 100);
      }
    } else {
      for (const s of services) {
        const cur = String(s.currency || "").trim().toUpperCase();
        if (!cur) continue;
        if (!isCurrencyAllowed(cur)) continue;
        const sale = Number(s.sale_price) || 0;
        const pct =
          s.transfer_fee_pct != null ? Number(s.transfer_fee_pct) : agencyFeePct;
        const fee =
          s.transfer_fee_amount != null
            ? Number(s.transfer_fee_amount)
            : sale * (Number.isFinite(pct) ? pct : 0.024);
        const dbCommission = Number(s.totalCommissionWithoutVAT ?? 0);
        const extraCosts = Number(s.extra_costs_amount ?? 0);
        const extraTaxes = Number(s.extra_taxes_amount ?? 0);
        const base = Math.max(dbCommission - fee - extraCosts - extraTaxes, 0);
        const { sellerPct } = resolveCommissionForContext({
          rule,
          overrides: custom,
          currency: cur,
          serviceId: s.id_service,
          allowService: true,
        });
        sellerEarningsByCurrency[cur] =
          (sellerEarningsByCurrency[cur] || 0) + base * (sellerPct / 100);
      }
    }

    return res.status(200).json({
      ownerPct: rule.sellerPct,
      rule,
      custom,
      commissionBaseByCurrency,
      sellerEarningsByCurrency,
    });
  } catch (err) {
    console.error("[earnings/by-booking][GET]", err);
    return res.status(500).json({ error: "Error obteniendo datos" });
  }
}
