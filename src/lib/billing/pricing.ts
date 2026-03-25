export type PlanKey = "basico" | "medio" | "pro";
export const IVA_RATE = 0.21;

export const PLAN_DATA: Record<
  PlanKey,
  { label: string; base: number; short: string }
> = {
  basico: {
    label: "Basico",
    base: 20,
    short: "Incluye 128 GB de storage y 256 GB de transferencia por mes",
  },
  medio: {
    label: "Pro",
    base: 40,
    short: "Incluye 500 GB de storage y 1 TB de transferencia por mes",
  },
  pro: {
    label: "Max",
    base: 70,
    short: "Incluye 1 TB de storage y 2 TB de transferencia por mes",
  },
};

export function isPlanKey(value: unknown): value is PlanKey {
  return value === "basico" || value === "medio" || value === "pro";
}

export function normalizeUsersCount(value: number) {
  const safe = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, safe);
}

export function calcExtraUsersCost(users: number): number {
  const n = normalizeUsersCount(users);
  if (n <= 3) return 0;
  if (n <= 10) return (n - 3) * 5;
  return 35 + (n - 10) * 10;
}

export function calcInfraCost(users: number): number {
  const n = normalizeUsersCount(users);
  if (n <= 3) return 0;
  if (n <= 7) return 20;
  if (n <= 12) return 30;
  return 30 + (n - 12) * 10;
}

export function calcMonthlyBase(planKey: PlanKey, users: number): number {
  return PLAN_DATA[planKey].base + calcExtraUsersCost(users) + calcInfraCost(users);
}

export function applyVat(value: number, rate: number = IVA_RATE): number {
  const safe = Number.isFinite(value) ? value : 0;
  return safe * (1 + rate);
}

export function calcMonthlyBaseWithVat(planKey: PlanKey, users: number): number {
  return applyVat(calcMonthlyBase(planKey, users));
}

export function calcVatFromTotal(totalWithVat: number, rate: number = IVA_RATE): number {
  const safe = Number.isFinite(totalWithVat) ? totalWithVat : 0;
  return safe - safe / (1 + rate);
}
