import type { Prisma } from "@prisma/client";

export const COUNTER_KEYS = [
  "booking",
  "quote",
  "client",
  "service",
  "receipt",
  "other_income",
  "client_payment",
  "investment",
  "operator_due",
  "user",
  "operator",
  "sales_team",
  "resource",
  "file",
  "recurring_investment",
  "template_config",
  "text_preset",
  "commission_rule_set",
  "finance_config",
  "client_config",
  "quote_config",
  "agency_billing_config",
  "agency_billing_adjustment",
  "agency_billing_charge",
  "finance_currency",
  "finance_account",
  "finance_payment_method",
  "expense_category",
  "service_type",
  "passenger_category",
  "service_type_preset",
  "service_calc_config",
  "lead",
  "credit_account",
  "credit_entry",
  "invoice",
  "credit_note",
  "travel_group",
  "travel_group_departure",
  "travel_group_inventory",
  "travel_group_passenger",
  "travel_group_payment_template",
  "travel_group_client_payment",
  "travel_group_receipt",
  "travel_group_operator_due",
  "travel_group_operator_payment",
  "travel_group_invoice",
] as const;

export type AgencyCounterKey = (typeof COUNTER_KEYS)[number];

export async function getNextAgencyCounterByKey(
  tx: Prisma.TransactionClient,
  id_agency: number,
  key: string,
): Promise<number> {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    throw new Error("Agency counter key inválida.");
  }

  const counter = await tx.agencyCounter.upsert({
    where: { id_agency_key: { id_agency, key: normalizedKey } },
    update: { next_value: { increment: 1 } },
    create: { id_agency, key: normalizedKey, next_value: 2 },
    select: { next_value: true },
  });

  return counter.next_value - 1;
}

export async function getNextAgencyCounter(
  tx: Prisma.TransactionClient,
  id_agency: number,
  key: AgencyCounterKey,
): Promise<number> {
  return getNextAgencyCounterByKey(tx, id_agency, key);
}

export async function setAgencyCounterNextValue(
  tx: Prisma.TransactionClient,
  id_agency: number,
  key: AgencyCounterKey,
  nextValue: number,
): Promise<number> {
  const normalized = Math.max(1, Math.trunc(nextValue));
  const counter = await tx.agencyCounter.upsert({
    where: { id_agency_key: { id_agency, key } },
    update: { next_value: normalized },
    create: { id_agency, key, next_value: normalized },
    select: { next_value: true },
  });
  return counter.next_value;
}

export async function ensureAgencyCounterAtLeast(
  tx: Prisma.TransactionClient,
  id_agency: number,
  key: AgencyCounterKey,
  minNextValue: number,
): Promise<void> {
  const normalized = Math.max(1, Math.trunc(minNextValue));
  const existing = await tx.agencyCounter.findUnique({
    where: { id_agency_key: { id_agency, key } },
    select: { next_value: true },
  });

  if (!existing) {
    await tx.agencyCounter.create({
      data: { id_agency, key, next_value: normalized },
    });
    return;
  }

  if (existing.next_value >= normalized) return;

  await tx.agencyCounter.update({
    where: { id_agency_key: { id_agency, key } },
    data: { next_value: normalized },
  });
}
