import {
  getBookingComponentGrants,
  getFinanceSectionGrants,
} from "@/lib/accessControl";
import {
  canAccessBookingComponent,
  canAccessFinanceSection,
  normalizeRole,
  type BookingComponentKey,
  type FinanceSectionKey,
} from "@/utils/permissions";

const OPERATOR_MANAGER_ROLES = new Set([
  "desarrollador",
  "gerente",
  "administrativo",
]);

type OperatorAccessAuth = {
  id_user?: number | null;
  id_agency?: number | null;
  role?: string | null;
};

export function canManageOperatorsWithGrants(
  role: string | null | undefined,
  financeGrants: FinanceSectionKey[] | null | undefined,
  bookingGrants: BookingComponentKey[] | null | undefined,
): boolean {
  const normalizedRole = normalizeRole(role);
  if (OPERATOR_MANAGER_ROLES.has(normalizedRole)) return true;

  return (
    canAccessFinanceSection(normalizedRole, financeGrants, "operator_payments") ||
    canAccessFinanceSection(normalizedRole, financeGrants, "operators_insights") ||
    canAccessBookingComponent(normalizedRole, bookingGrants, "operator_payments")
  );
}

export async function canManageOperators(
  auth: OperatorAccessAuth,
): Promise<boolean> {
  const normalizedRole = normalizeRole(auth.role);
  if (OPERATOR_MANAGER_ROLES.has(normalizedRole)) return true;
  if (!auth.id_agency || !auth.id_user) return false;

  const [financeGrants, bookingGrants] = await Promise.all([
    getFinanceSectionGrants(auth.id_agency, auth.id_user),
    getBookingComponentGrants(auth.id_agency, auth.id_user),
  ]);

  return canManageOperatorsWithGrants(
    normalizedRole,
    financeGrants,
    bookingGrants,
  );
}
