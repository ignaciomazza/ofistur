import { extractBookingComponentRulesFromAccessRules } from "@/utils/receiptServiceSelection";

export type Role = string;

const ADMIN_ROLES = ["desarrollador", "gerente", "administrativo"] as const;

export const FINANCE_SECTIONS = [
  {
    key: "cashbox",
    label: "Caja",
    route: "/cashbox",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "credits",
    label: "Creditos",
    route: "/credits",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "account_transfers",
    label: "Pases de saldo",
    route: "/finance/pases-saldo",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "investments",
    label: "Inversion",
    route: "/investments",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "operator_payments",
    label: "Pagos Operadores",
    route: "/operators/payments",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "operators_insights",
    label: "Panel Operadores",
    route: "/operators/panel",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "receipts",
    label: "Recibos",
    route: "/receipts",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "payment_plans",
    label: "Planes de pago",
    route: "/finance/payment-plans",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "other_incomes",
    label: "Ingresos",
    route: "/other-incomes",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "receipts_verify",
    label: "Verificacion recibos",
    route: "/receipts/verify",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "other_incomes_verify",
    label: "Verificacion ingresos",
    route: "/receipts/verify",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "balances",
    label: "Saldos",
    route: "/balances",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "earnings",
    label: "Ganancias",
    route: "/earnings",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "earnings_my",
    label: "Mis ganancias",
    route: "/earnings/my",
    defaultRoles: [
      "desarrollador",
      "gerente",
      "administrativo",
      "vendedor",
      "lider",
    ],
  },
  {
    key: "finance_config",
    label: "Configuracion",
    route: "/finance/config",
    defaultRoles: ADMIN_ROLES,
  },
] as const;

export type FinanceSectionKey = (typeof FINANCE_SECTIONS)[number]["key"];

export type FinanceSectionAccessRule = {
  id_user: number;
  sections: FinanceSectionKey[];
};

export const BOOKING_COMPONENTS = [
  {
    key: "receipts_form",
    label: "Formulario de recibos",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "billing",
    label: "Facturacion (facturas/notas)",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "operator_payments",
    label: "Pagos al operador",
    defaultRoles: ADMIN_ROLES,
  },
  {
    key: "booking_status",
    label: "Estado de la reserva",
    defaultRoles: ADMIN_ROLES,
  },
] as const;

export type BookingComponentKey = (typeof BOOKING_COMPONENTS)[number]["key"];

export type BookingComponentAccessRule = {
  id_user: number;
  components: BookingComponentKey[];
};

const RESOURCE_ACCESS_ADMIN_ROLES = [
  "desarrollador",
  "gerente",
  "administrativo",
] as const;

const RESOURCE_NOTES_MANAGER_ROLES = [
  "desarrollador",
  "gerente",
  "administrativo",
  "lider",
] as const;

const CALENDAR_MANAGER_ROLES = [
  "desarrollador",
  "gerente",
  "administrativo",
] as const;

export const RESOURCE_SECTIONS = [
  {
    key: "resources_notes",
    label: "Notas (Recursos)",
    route: "/resources",
    // El sistema historicamente dejo este modulo abierto para cualquier rol.
    // Si hay regla explicita por usuario, esa regla toma prioridad.
    openByDefault: true,
    defaultRoles: RESOURCE_ACCESS_ADMIN_ROLES,
    manageRoles: RESOURCE_NOTES_MANAGER_ROLES,
  },
  {
    key: "calendar",
    label: "Calendario",
    route: "/calendar",
    // El sistema historicamente dejo este modulo abierto para cualquier rol.
    // Si hay regla explicita por usuario, esa regla toma prioridad.
    openByDefault: true,
    defaultRoles: RESOURCE_ACCESS_ADMIN_ROLES,
    manageRoles: CALENDAR_MANAGER_ROLES,
  },
] as const;

export type ResourceSectionKey = (typeof RESOURCE_SECTIONS)[number]["key"];

export type CalendarVisibilityMode = "all" | "own";

export type ResourceSectionAccessRule = {
  id_user: number;
  sections: ResourceSectionKey[];
  calendar_visibility: CalendarVisibilityMode;
};

const financeKeySet = new Set(FINANCE_SECTIONS.map((s) => s.key));
const bookingKeySet = new Set(BOOKING_COMPONENTS.map((c) => c.key));
const resourceKeySet = new Set(RESOURCE_SECTIONS.map((s) => s.key));

const financeByKey = new Map(
  FINANCE_SECTIONS.map((section) => [section.key, section]),
);
const bookingByKey = new Map(
  BOOKING_COMPONENTS.map((component) => [component.key, component]),
);
const resourceByKey = new Map(
  RESOURCE_SECTIONS.map((section) => [section.key, section]),
);

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? Math.trunc(value) : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return null;
}

function toKeyArray<T extends string>(
  value: unknown,
  allowed: Set<T>,
): T[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<T>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const key = item.trim() as T;
    if (!key) continue;
    if (!allowed.has(key)) continue;
    seen.add(key);
  }
  return Array.from(seen).sort();
}

function normalizeCalendarVisibility(
  value: unknown,
): CalendarVisibilityMode {
  return value === "own" ? "own" : "all";
}

export function normalizeRole(role?: string | null): string {
  const normalized = (role ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("vendedor")) return "vendedor";
  if (normalized.startsWith("lider") || normalized === "leader") {
    return "lider";
  }
  if (normalized.startsWith("gerent")) return "gerente";
  if (normalized === "admin" || normalized.startsWith("administr")) {
    return "administrativo";
  }
  if (["dev", "developer"].includes(normalized)) return "desarrollador";
  if (normalized.startsWith("desarrollador")) return "desarrollador";
  return normalized;
}

export function normalizeFinanceSectionRules(
  raw: unknown,
): FinanceSectionAccessRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: FinanceSectionAccessRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = toPositiveInt(rec.id_user);
    if (!id) continue;
    rules.push({
      id_user: id,
      sections: toKeyArray(rec.sections, financeKeySet),
    });
  }
  return rules.sort((a, b) => a.id_user - b.id_user);
}

export function normalizeBookingComponentRules(
  raw: unknown,
): BookingComponentAccessRule[] {
  const source = extractBookingComponentRulesFromAccessRules(raw);
  if (!Array.isArray(source)) return [];
  const rules: BookingComponentAccessRule[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = toPositiveInt(rec.id_user);
    if (!id) continue;
    rules.push({
      id_user: id,
      components: toKeyArray(rec.components, bookingKeySet),
    });
  }
  return rules.sort((a, b) => a.id_user - b.id_user);
}

export function normalizeResourceSectionRules(
  raw: unknown,
): ResourceSectionAccessRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: ResourceSectionAccessRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = toPositiveInt(rec.id_user);
    if (!id) continue;
    rules.push({
      id_user: id,
      sections: toKeyArray(rec.sections, resourceKeySet),
      calendar_visibility: normalizeCalendarVisibility(rec.calendar_visibility),
    });
  }
  return rules.sort((a, b) => a.id_user - b.id_user);
}

export function pickFinanceSectionRule(
  rules: FinanceSectionAccessRule[],
  userId?: number | null,
): FinanceSectionAccessRule | null {
  if (!userId) return null;
  return rules.find((rule) => rule.id_user === userId) ?? null;
}

export function pickBookingComponentRule(
  rules: BookingComponentAccessRule[],
  userId?: number | null,
): BookingComponentAccessRule | null {
  if (!userId) return null;
  return rules.find((rule) => rule.id_user === userId) ?? null;
}

export function pickResourceSectionRule(
  rules: ResourceSectionAccessRule[],
  userId?: number | null,
): ResourceSectionAccessRule | null {
  if (!userId) return null;
  return rules.find((rule) => rule.id_user === userId) ?? null;
}

function hasRole(list: readonly string[], role: string): boolean {
  return list.includes(role);
}

export function canAccessFinanceSection(
  role: string | null | undefined,
  granted: FinanceSectionKey[] | null | undefined,
  key: FinanceSectionKey,
): boolean {
  const section = financeByKey.get(key);
  if (!section) return false;
  const normalized = normalizeRole(role);
  if (hasRole(section.defaultRoles, normalized)) return true;
  return !!granted?.includes(key);
}

export function canAccessAnyFinanceSection(
  role: string | null | undefined,
  granted: FinanceSectionKey[] | null | undefined,
): boolean {
  return FINANCE_SECTIONS.some((section) =>
    canAccessFinanceSection(role, granted, section.key),
  );
}

export function canAccessBookingComponent(
  role: string | null | undefined,
  granted: BookingComponentKey[] | null | undefined,
  key: BookingComponentKey,
): boolean {
  const component = bookingByKey.get(key);
  if (!component) return false;
  const normalized = normalizeRole(role);
  if (hasRole(component.defaultRoles, normalized)) return true;
  return !!granted?.includes(key);
}

export function canAccessResourceSection(
  role: string | null | undefined,
  granted: ResourceSectionKey[] | null | undefined,
  key: ResourceSectionKey,
  hasCustomRule = false,
): boolean {
  void role;
  void granted;
  void key;
  void hasCustomRule;
  // Recursos y calendario siempre son visibles.
  return true;
}

export function canAccessAnyResourceSection(
  role: string | null | undefined,
  granted: ResourceSectionKey[] | null | undefined,
  hasCustomRule = false,
): boolean {
  return RESOURCE_SECTIONS.some((section) =>
    canAccessResourceSection(role, granted, section.key, hasCustomRule),
  );
}

export function canManageResourceSection(
  role: string | null | undefined,
  granted: ResourceSectionKey[] | null | undefined,
  key: ResourceSectionKey,
  hasCustomRule = false,
): boolean {
  const section = resourceByKey.get(key);
  if (!section) return false;
  const normalized = normalizeRole(role);

  // Calendario: gerencia/administracion/desarrollo siempre pueden gestionar
  // notas, incluso si existe una regla personalizada sin ese toggle.
  if (key === "calendar" && hasRole(section.manageRoles, normalized)) {
    return true;
  }

  if (hasCustomRule) return !!granted?.includes(key);
  if (hasRole(section.manageRoles, normalized)) return true;

  // Compat: si llega una lista de grants (sin regla explicita), respetarla.
  return !!granted?.includes(key);
}

export function resolveCalendarVisibility(
  role: string | null | undefined,
  rule?: ResourceSectionAccessRule | null,
  hasCustomRule = false,
): CalendarVisibilityMode {
  if (hasCustomRule) {
    return normalizeCalendarVisibility(rule?.calendar_visibility);
  }
  const normalized = normalizeRole(role);
  return normalized === "vendedor" ? "own" : "all";
}
