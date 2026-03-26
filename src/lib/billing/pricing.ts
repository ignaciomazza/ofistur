export type PlanKey = "basico" | "medio" | "pro";
export const IVA_RATE = 0.21;

export const PLAN_DATA: Record<
  PlanKey,
  { label: string; base: number; short: string }
> = {
  basico: {
    label: "Basico",
    base: 20,
    short: "Pasajeros, reservas, facturacion y recibos",
  },
  medio: {
    label: "Medio",
    base: 40,
    short: "Calendario, templates, gastos y analisis",
  },
  pro: {
    label: "Pro",
    base: 50,
    short: "Asesoramiento, capacitaciones, nuevas funcionalidades",
  },
};

export const STORAGE_PLAN_DATA: Record<
  PlanKey,
  { label: string; base: number; storage_gb: number; transfer_gb: number }
> = {
  basico: {
    label: "Basico",
    base: 20,
    storage_gb: 128,
    transfer_gb: 256,
  },
  medio: {
    label: "Pro",
    base: 40,
    storage_gb: 500,
    transfer_gb: 1024,
  },
  pro: {
    label: "Max",
    base: 70,
    storage_gb: 1024,
    transfer_gb: 2048,
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

export function calcStorageAddon(
  planKey: PlanKey,
  enabled = false,
): number {
  return enabled ? STORAGE_PLAN_DATA[planKey].base : 0;
}

export function calcMonthlyBase(
  planKey: PlanKey,
  users: number,
  opts?: { storageEnabled?: boolean },
): number {
  return (
    PLAN_DATA[planKey].base +
    calcExtraUsersCost(users) +
    calcInfraCost(users) +
    calcStorageAddon(planKey, Boolean(opts?.storageEnabled))
  );
}

export function applyVat(value: number, rate: number = IVA_RATE): number {
  const safe = Number.isFinite(value) ? value : 0;
  return safe * (1 + rate);
}

export function calcMonthlyBaseWithVat(
  planKey: PlanKey,
  users: number,
  opts?: { storageEnabled?: boolean },
): number {
  return applyVat(calcMonthlyBase(planKey, users, opts));
}

export function calcVatFromTotal(totalWithVat: number, rate: number = IVA_RATE): number {
  const safe = Number.isFinite(totalWithVat) ? totalWithVat : 0;
  return safe - safe / (1 + rate);
}
