import prisma from "@/lib/prisma";
import { normalizePlanKey, type PlanKey } from "@/lib/billing/pricing";
import {
  canAccessFeatureByPlan,
  type PlanFeatureKey,
} from "@/lib/planAccess";

export type AgencyPlanInfo = {
  planKey: PlanKey | null;
  hasPlan: boolean;
  ownerId: number;
};

export async function resolveAgencyPlanInfo(
  agencyId: number,
  db: typeof prisma = prisma,
): Promise<AgencyPlanInfo> {
  const agency = await db.agency.findUnique({
    where: { id_agency: agencyId },
    select: { id_agency: true, billing_owner_agency_id: true },
  });

  const ownerId = agency?.billing_owner_agency_id ?? agencyId;

  const config = await db.agencyBillingConfig.findUnique({
    where: { id_agency: ownerId },
    select: { plan_key: true },
  });

  if (!config) {
    return { planKey: null, hasPlan: false, ownerId };
  }

  const planKey = normalizePlanKey(config.plan_key) ?? "basico";
  return { planKey, hasPlan: true, ownerId };
}

export async function ensurePlanFeatureAccess(
  agencyId: number,
  feature: PlanFeatureKey,
  db: typeof prisma = prisma,
): Promise<AgencyPlanInfo & { allowed: boolean }> {
  const info = await resolveAgencyPlanInfo(agencyId, db);
  const allowed = canAccessFeatureByPlan(info.planKey, info.hasPlan, feature);
  return { ...info, allowed };
}
