import { normalizePlanKey, type PlanKey } from "@/lib/billing/pricing";

export type PlanFeatureKey =
  | "calendar"
  | "resources"
  | "templates"
  | "groups"
  | "insights"
  | "client_stats"
  | "cashbox"
  | "investments"
  | "other_incomes"
  | "balances"
  | "earnings"
  | "receipts_verify"
  | "other_incomes_verify"
  | "credits"
  | "operators_insights"
  | "payment_plans";

const PLAN_RANK: Record<PlanKey, number> = {
  basico: 0,
  medio: 1,
  pro: 2,
};

export const PLAN_FEATURE_MIN: Record<PlanFeatureKey, PlanKey> = {
  calendar: "medio",
  resources: "medio",
  templates: "medio",
  groups: "pro",
  insights: "medio",
  client_stats: "medio",
  cashbox: "medio",
  investments: "medio",
  other_incomes: "medio",
  balances: "medio",
  earnings: "medio",
  receipts_verify: "medio",
  other_incomes_verify: "medio",
  credits: "medio",
  operators_insights: "medio",
  payment_plans: "medio",
};

const PLAN_ROUTE_FEATURES: Array<{ prefix: string; feature: PlanFeatureKey }> = [
  { prefix: "/operators/panel", feature: "operators_insights" },
  { prefix: "/operators/insights", feature: "operators_insights" },
  { prefix: "/receipts/verify", feature: "receipts_verify" },
  { prefix: "/other-incomes/verify", feature: "other_incomes_verify" },
  { prefix: "/earnings/my", feature: "earnings" },
  { prefix: "/earnings", feature: "earnings" },
  { prefix: "/balances", feature: "balances" },
  { prefix: "/cashbox", feature: "cashbox" },
  { prefix: "/finance/pases-saldo", feature: "cashbox" },
  { prefix: "/credits", feature: "credits" },
  { prefix: "/finance/payment-plans", feature: "payment_plans" },
  { prefix: "/other-incomes", feature: "other_incomes" },
  { prefix: "/insights", feature: "insights" },
  { prefix: "/client-stats", feature: "client_stats" },
  { prefix: "/calendar", feature: "calendar" },
  { prefix: "/resources", feature: "resources" },
  { prefix: "/template-config", feature: "templates" },
  { prefix: "/templates", feature: "templates" },
  { prefix: "/groups", feature: "groups" },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function resolvePlanFeatureFromRoute(
  pathname: string,
): PlanFeatureKey | null {
  for (const { prefix, feature } of PLAN_ROUTE_FEATURES) {
    if (matchesPrefix(pathname, prefix)) return feature;
  }
  return null;
}

export function canAccessFeatureByPlan(
  planKey: PlanKey | null | undefined,
  hasPlan: boolean,
  feature: PlanFeatureKey,
): boolean {
  if (!hasPlan) return true;
  const normalized = normalizePlanKey(planKey) ?? "basico";
  const minPlan = PLAN_FEATURE_MIN[feature];
  return PLAN_RANK[normalized] >= PLAN_RANK[minPlan];
}

export function canAccessRouteByPlan(
  planKey: PlanKey | null | undefined,
  hasPlan: boolean,
  pathname: string,
): boolean {
  const feature = resolvePlanFeatureFromRoute(pathname);
  if (!feature) return true;
  return canAccessFeatureByPlan(planKey, hasPlan, feature);
}
