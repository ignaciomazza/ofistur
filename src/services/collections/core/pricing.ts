import type { Prisma } from "@prisma/client";
import type { BillingMethodType } from "@prisma/client";
import { getBillingConfig } from "@/lib/billingConfig";
import {
  calcMonthlyBase,
  isPlanKey,
  normalizeUsersCount,
  PLAN_DATA,
  type PlanKey,
} from "@/lib/billing/pricing";

type TxClient = Prisma.TransactionClient;

type BuildPricingInput = {
  tx: TxClient;
  agencyId: number;
  subscriptionDiscountPct: number;
  methodType: BillingMethodType | null;
  fxRateDate: Date;
  fxRateArsPerUsd: number;
  anchorDate: Date;
};

type AddonSnapshot = {
  id_adjustment: number;
  label: string;
  kind: string;
  mode: string;
  currency: string | null;
  value: number;
  computed_usd: number;
  applied: boolean;
  reason: string | null;
};

export type PricingSnapshot = {
  planSnapshot: {
    plan_key: PlanKey;
    plan_label: string;
    billing_users: number;
    user_limit: number | null;
    base_plan_usd: number;
  };
  addonsSnapshot: AddonSnapshot[];
  baseAmountUsd: number;
  addonsTotalUsd: number;
  preDiscountNetUsd: number;
  discountPct: number;
  discountAmountUsd: number;
  netAmountUsd: number;
  vatRate: number;
  vatAmountUsd: number;
  totalUsd: number;
  totalArs: number;
  fxRateDate: Date;
  fxRateArsPerUsd: number;
};

function round2(value: number): number {
  const safe = Number.isFinite(value) ? value : 0;
  return Math.round(safe * 100) / 100;
}

function normalizeMode(mode: string | null | undefined): "PERCENT" | "ABSOLUTE" {
  const normalized = String(mode || "").trim().toUpperCase();
  if (normalized.includes("PERCENT") || normalized.includes("PORC") || normalized === "%") {
    return "PERCENT";
  }
  return "ABSOLUTE";
}

function isDiscountKind(kind: string | null | undefined): boolean {
  const normalized = String(kind || "").trim().toLowerCase();
  return normalized.includes("discount") || normalized.includes("descuento");
}

function adjustmentToUsd(base: number, adjustment: {
  kind: string;
  mode: string;
  value: Prisma.Decimal;
  currency: string | null;
}) {
  const mode = normalizeMode(adjustment.mode);
  const value = Number(adjustment.value || 0);

  if (adjustment.currency && adjustment.currency.toUpperCase() !== "USD") {
    return {
      amount: 0,
      applied: false,
      reason: "moneda-no-soportada",
    };
  }

  const raw = mode === "PERCENT" ? (base * value) / 100 : value;
  const signed = isDiscountKind(adjustment.kind) ? -Math.abs(raw) : raw;

  return {
    amount: round2(signed),
    applied: true,
    reason: null,
  };
}

export async function buildCyclePricingSnapshot(
  input: BuildPricingInput,
): Promise<PricingSnapshot> {
  const config = getBillingConfig();

  const [billingConfig, adjustments, storageConfig] = await Promise.all([
    input.tx.agencyBillingConfig.findUnique({
      where: { id_agency: input.agencyId },
      select: {
        plan_key: true,
        billing_users: true,
        user_limit: true,
      },
    }),
    input.tx.agencyBillingAdjustment.findMany({
      where: {
        id_agency: input.agencyId,
        active: true,
        OR: [{ starts_at: null }, { starts_at: { lte: input.anchorDate } }],
        AND: [{ OR: [{ ends_at: null }, { ends_at: { gte: input.anchorDate } }] }],
      },
      select: {
        id_adjustment: true,
        label: true,
        kind: true,
        mode: true,
        value: true,
        currency: true,
      },
      orderBy: [{ id_adjustment: "asc" }],
    }),
    input.tx.agencyStorageConfig.findUnique({
      where: { id_agency: input.agencyId },
      select: { enabled: true },
    }),
  ]);

  const planKey: PlanKey =
    billingConfig && isPlanKey(billingConfig.plan_key)
      ? billingConfig.plan_key
      : "basico";
  const billingUsers = normalizeUsersCount(billingConfig?.billing_users ?? 3);
  const basePlanUsd = round2(
    calcMonthlyBase(planKey, billingUsers, {
      storageEnabled: Boolean(storageConfig?.enabled),
    }),
  );

  const addonsSnapshot: AddonSnapshot[] = adjustments.map((item) => {
    const computed = adjustmentToUsd(basePlanUsd, {
      kind: item.kind,
      mode: item.mode,
      value: item.value,
      currency: item.currency,
    });

    return {
      id_adjustment: item.id_adjustment,
      label: item.label || item.kind,
      kind: item.kind,
      mode: item.mode,
      currency: item.currency,
      value: Number(item.value || 0),
      computed_usd: computed.amount,
      applied: computed.applied,
      reason: computed.reason,
    };
  });

  const addonsTotalUsd = round2(
    addonsSnapshot.reduce((acc, item) => acc + item.computed_usd, 0),
  );

  const preDiscountNetUsd = Math.max(0, round2(basePlanUsd + addonsTotalUsd));

  const discountPct =
    input.methodType === "DIRECT_DEBIT_CBU_GALICIA"
      ? round2(
          Number.isFinite(input.subscriptionDiscountPct)
            ? input.subscriptionDiscountPct
            : config.directDebitDiscountPct,
        )
      : 0;

  const discountAmountUsd = round2((preDiscountNetUsd * discountPct) / 100);
  const netAmountUsd = Math.max(0, round2(preDiscountNetUsd - discountAmountUsd));

  const vatRate = Number.isFinite(config.defaultVatRate) ? config.defaultVatRate : 0.21;
  const vatAmountUsd = round2(netAmountUsd * vatRate);
  const totalUsd = round2(netAmountUsd + vatAmountUsd);
  const totalArs = round2(totalUsd * input.fxRateArsPerUsd);

  return {
    planSnapshot: {
      plan_key: planKey,
      plan_label: PLAN_DATA[planKey].label,
      billing_users: billingUsers,
      user_limit: billingConfig?.user_limit ?? null,
      base_plan_usd: basePlanUsd,
    },
    addonsSnapshot,
    baseAmountUsd: basePlanUsd,
    addonsTotalUsd,
    preDiscountNetUsd,
    discountPct,
    discountAmountUsd,
    netAmountUsd,
    vatRate,
    vatAmountUsd,
    totalUsd,
    totalArs,
    fxRateDate: input.fxRateDate,
    fxRateArsPerUsd: input.fxRateArsPerUsd,
  };
}
