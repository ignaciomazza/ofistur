import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { BUENOS_AIRES_TIME_ZONE } from "@/lib/buenosAiresDate";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { getBillingConfig } from "@/lib/billingConfig";
import { toDateKeyInBuenosAires } from "@/lib/buenosAiresDate";
import { logBillingEvent } from "@/services/billing/events";
import { addBusinessDaysAr } from "@/services/collections/core/businessCalendarAr";
import {
  addDaysLocal,
  dateKeyInTimeZone,
  getAnchorDateForMonth,
  nextAnchorDate,
  startOfLocalDay,
} from "@/services/collections/core/dates";
import { buildCyclePricingSnapshot } from "@/services/collections/core/pricing";

type RunAnchorInput = {
  anchorDate: Date;
  overrideFx?: boolean;
  actorUserId?: number | null;
  actorAgencyId?: number | null;
  agencyIds?: number[] | null;
};

type RunAnchorSummary = {
  anchor_date: string;
  override_fx: boolean;
  subscriptions_total: number;
  subscriptions_processed: number;
  cycles_created: number;
  charges_created: number;
  attempts_created: number;
  skipped_idempotent: number;
  fx_rates_used: Array<{ date: string; ars_per_usd: number }>;
  errors: Array<{ id_agency: number; message: string }>;
};

const RUN_ANCHOR_TX_MAX_WAIT_MS = Number.parseInt(
  process.env.BILLING_RUN_ANCHOR_TX_MAX_WAIT_MS || "10000",
  10,
);
const RUN_ANCHOR_TX_TIMEOUT_MS = Number.parseInt(
  process.env.BILLING_RUN_ANCHOR_TX_TIMEOUT_MS || "45000",
  10,
);

type FxRateResolved = {
  rateDate: Date;
  arsPerUsd: number;
  rateDateKey: string;
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Error inesperado";
}

function sortedRetryOffsets(days: number[]): number[] {
  const unique = new Set<number>([0]);
  for (const day of days) {
    const normalized = Math.max(0, Math.trunc(day));
    unique.add(normalized);
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function buildChargeLabel(anchorDate: Date): string {
  const key = toDateKeyInBuenosAires(anchorDate) || "";
  const [year, month] = key.split("-");
  if (!year || !month) return "Suscripción mensual";
  return `Suscripción ${month}/${year}`;
}

async function resolveFxRateForDate(
  dateKey: string,
  overrideFx: boolean,
): Promise<FxRateResolved> {
  const targetDate = startOfLocalDay(dateKey, getBillingConfig().timezone);

  const exact = await prisma.billingFxRate.findUnique({
    where: {
      fx_type_rate_date: {
        fx_type: "DOLAR_BSP",
        rate_date: targetDate,
      },
    },
  });

  if (exact) {
    return {
      rateDate: exact.rate_date,
      arsPerUsd: Number(exact.ars_per_usd || 0),
      rateDateKey: toDateKeyInBuenosAires(exact.rate_date) || dateKey,
    };
  }

  if (!overrideFx) {
    throw new Error(`Falta cotización BSP para ${dateKey}`);
  }

  const fallback = await prisma.billingFxRate.findFirst({
    where: {
      fx_type: "DOLAR_BSP",
      rate_date: { lte: targetDate },
    },
    orderBy: [{ rate_date: "desc" }, { id_fx_rate: "desc" }],
  });

  if (!fallback) {
    throw new Error(`No hay cotización BSP disponible para ${dateKey}`);
  }

  return {
    rateDate: fallback.rate_date,
    arsPerUsd: Number(fallback.ars_per_usd || 0),
    rateDateKey: toDateKeyInBuenosAires(fallback.rate_date) || dateKey,
  };
}

async function pickSelectedPaymentMethod(
  tx: Prisma.TransactionClient,
  subscriptionId: number,
) {
  const method = await tx.agencyBillingPaymentMethod.findFirst({
    where: {
      subscription_id: subscriptionId,
      status: { in: ["ACTIVE", "PENDING"] },
    },
    orderBy: [{ is_default: "desc" }, { id_payment_method: "asc" }],
  });

  if (method) return method;

  return tx.agencyBillingPaymentMethod.findFirst({
    where: { subscription_id: subscriptionId },
    orderBy: [{ is_default: "desc" }, { id_payment_method: "asc" }],
  });
}

export async function runAnchor(input: RunAnchorInput): Promise<RunAnchorSummary> {
  const config = getBillingConfig();
  const overrideFx = Boolean(input.overrideFx);
  const baseDate = input.anchorDate;
  const agencyIds = Array.from(
    new Set(
      (input.agencyIds || []).filter(
        (agencyId) => Number.isInteger(agencyId) && Number(agencyId) > 0,
      ),
    ),
  );

  const subscriptions = await prisma.agencyBillingSubscription.findMany({
    where: {
      status: "ACTIVE",
      ...(agencyIds.length > 0 ? { id_agency: { in: agencyIds } } : {}),
    },
    select: {
      id_subscription: true,
      id_agency: true,
      status: true,
      anchor_day: true,
      timezone: true,
      direct_debit_discount_pct: true,
    },
    orderBy: [{ id_agency: "asc" }],
  });

  const fxCache = new Map<string, FxRateResolved>();
  const usedFxByKey = new Map<string, number>();

  let subscriptionsProcessed = 0;
  let cyclesCreated = 0;
  let chargesCreated = 0;
  let attemptsCreated = 0;
  let skippedIdempotent = 0;
  const errors: Array<{ id_agency: number; message: string }> = [];

  const retryOffsets = sortedRetryOffsets(config.dunningRetryDays);

  for (const subscription of subscriptions) {
    const timezone = subscription.timezone || config.timezone;
    const anchorDate = getAnchorDateForMonth(baseDate, subscription.anchor_day, timezone);
    const anchorDateKey = dateKeyInTimeZone(anchorDate, timezone);

    try {
      let fx = fxCache.get(anchorDateKey);
      if (!fx) {
        fx = await resolveFxRateForDate(anchorDateKey, overrideFx);
        fxCache.set(anchorDateKey, fx);
      }
      usedFxByKey.set(fx.rateDateKey, fx.arsPerUsd);

      const result = await prisma.$transaction(
        async (tx) => {
          const selectedMethod = await pickSelectedPaymentMethod(
            tx,
            subscription.id_subscription,
          );

        const pricing = await buildCyclePricingSnapshot({
          tx,
          agencyId: subscription.id_agency,
          subscriptionDiscountPct: Number(
            subscription.direct_debit_discount_pct || config.directDebitDiscountPct,
          ),
          methodType: selectedMethod?.method_type ?? null,
          fxRateDate: fx.rateDate,
          fxRateArsPerUsd: fx.arsPerUsd,
          anchorDate,
        });

        const existingCycle = await tx.agencyBillingCycle.findUnique({
          where: {
            agency_billing_cycle_unique: {
              subscription_id: subscription.id_subscription,
              anchor_date: anchorDate,
            },
          },
        });

        const cycle =
          existingCycle ||
          (await tx.agencyBillingCycle.create({
            data: {
              id_agency: subscription.id_agency,
              subscription_id: subscription.id_subscription,
              anchor_date: anchorDate,
              period_start: anchorDate,
              period_end: nextAnchorDate(anchorDate, subscription.anchor_day, timezone),
              status: "FROZEN",
              fx_type: "DOLAR_BSP",
              fx_rate_date: pricing.fxRateDate,
              fx_rate_ars_per_usd: pricing.fxRateArsPerUsd,
              base_amount_usd: pricing.baseAmountUsd,
              addons_total_usd: pricing.addonsTotalUsd,
              discount_pct: pricing.discountPct,
              discount_amount_usd: pricing.discountAmountUsd,
              net_amount_usd: pricing.netAmountUsd,
              vat_rate: pricing.vatRate,
              vat_amount_usd: pricing.vatAmountUsd,
              total_usd: pricing.totalUsd,
              total_ars: pricing.totalArs,
              plan_snapshot: pricing.planSnapshot,
              addons_snapshot: pricing.addonsSnapshot,
              frozen_at: new Date(),
            },
          }));

        const idempotencyKey = `${subscription.id_agency}-${anchorDateKey}`;
        const existingCharge = await tx.agencyBillingCharge.findUnique({
          where: {
            agency_billing_charge_idempotency_unique: {
              id_agency: subscription.id_agency,
              idempotency_key: idempotencyKey,
            },
          },
        });

        const charge =
          existingCharge ||
          (await (async () => {
            const agencyChargeId = await getNextAgencyCounter(
              tx,
              subscription.id_agency,
              "agency_billing_charge",
            );

            return tx.agencyBillingCharge.create({
              data: {
                id_agency: subscription.id_agency,
                agency_billing_charge_id: agencyChargeId,
                period_start: cycle.period_start,
                period_end: cycle.period_end,
                due_date: anchorDate,
                status: "READY",
                charge_kind: "RECURRING",
                label: buildChargeLabel(anchorDate),
                base_amount_usd: pricing.preDiscountNetUsd,
                adjustments_total_usd: Math.round(
                  (pricing.vatAmountUsd - pricing.discountAmountUsd) * 100,
                ) / 100,
                total_usd: pricing.totalUsd,
                fx_rate: pricing.fxRateArsPerUsd,
                payment_method: selectedMethod?.method_type || null,
                notes: "Cobranza recurrente Galicia (PR#2)",
                subscription_id: subscription.id_subscription,
                cycle_id: cycle.id_cycle,
                selected_method_id: selectedMethod?.id_payment_method || null,
                amount_ars_due: pricing.totalArs,
                reconciliation_status: "PENDING",
                idempotency_key: idempotencyKey,
                dunning_stage: 0,
                collection_channel: "PD_GALICIA",
              },
            });
          })());

        let createdAttempts = 0;
        for (let i = 0; i < retryOffsets.length; i += 1) {
          const attemptNo = i + 1;
          const offsetDays = retryOffsets[i];
          const scheduledFor =
            config.dunningUseBusinessDays &&
            timezone === BUENOS_AIRES_TIME_ZONE &&
            offsetDays > 0
              ? addBusinessDaysAr(anchorDate, offsetDays)
              : addDaysLocal(anchorDate, offsetDays, timezone);

          const existingAttempt = await tx.agencyBillingAttempt.findUnique({
            where: {
              agency_billing_attempt_unique: {
                charge_id: charge.id_charge,
                attempt_no: attemptNo,
              },
            },
            select: { id_attempt: true },
          });

          if (!existingAttempt) {
            await tx.agencyBillingAttempt.create({
              data: {
                charge_id: charge.id_charge,
                payment_method_id: selectedMethod?.id_payment_method || null,
                attempt_no: attemptNo,
                status: "PENDING",
                channel: "OFFICE_BANKING",
                scheduled_for: scheduledFor,
                notes: "Programado por corrida ancla",
              },
            });
            createdAttempts += 1;
          }
        }

        await tx.agencyBillingSubscription.update({
          where: { id_subscription: subscription.id_subscription },
          data: {
            next_anchor_date: nextAnchorDate(anchorDate, subscription.anchor_day, timezone),
          },
        });

        await logBillingEvent(
          {
            id_agency: subscription.id_agency,
            subscription_id: subscription.id_subscription,
            event_type: "ANCHOR_RUN_PROCESSED",
            payload: {
              anchor_date: anchorDateKey,
              cycle_id: cycle.id_cycle,
              charge_id: charge.id_charge,
              attempts_created: createdAttempts,
              fx_rate_date: pricing.fxRateDate,
              fx_rate_ars_per_usd: pricing.fxRateArsPerUsd,
            },
            created_by: input.actorUserId ?? null,
          },
          tx,
        );

          return {
            cycleCreated: !existingCycle,
            chargeCreated: !existingCharge,
            createdAttempts,
          };
        },
        {
          maxWait: Number.isFinite(RUN_ANCHOR_TX_MAX_WAIT_MS)
            ? RUN_ANCHOR_TX_MAX_WAIT_MS
            : 10000,
          timeout: Number.isFinite(RUN_ANCHOR_TX_TIMEOUT_MS)
            ? RUN_ANCHOR_TX_TIMEOUT_MS
            : 45000,
        },
      );

      subscriptionsProcessed += 1;
      if (result.cycleCreated) cyclesCreated += 1;
      if (result.chargeCreated) chargesCreated += 1;
      attemptsCreated += result.createdAttempts;
      if (!result.cycleCreated && !result.chargeCreated && result.createdAttempts === 0) {
        skippedIdempotent += 1;
      }
    } catch (error) {
      errors.push({
        id_agency: subscription.id_agency,
        message: normalizeErrorMessage(error),
      });
    }
  }

  const summary: RunAnchorSummary = {
    anchor_date: dateKeyInTimeZone(getAnchorDateForMonth(baseDate, config.anchorDay, config.timezone), config.timezone),
    override_fx: overrideFx,
    subscriptions_total: subscriptions.length,
    subscriptions_processed: subscriptionsProcessed,
    cycles_created: cyclesCreated,
    charges_created: chargesCreated,
    attempts_created: attemptsCreated,
    skipped_idempotent: skippedIdempotent,
    fx_rates_used: Array.from(usedFxByKey.entries()).map(([date, ars_per_usd]) => ({
      date,
      ars_per_usd,
    })),
    errors,
  };

  return summary;
}
