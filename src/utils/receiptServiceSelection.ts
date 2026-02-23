export type ReceiptServiceSelectionMode = "required" | "optional" | "booking";

export const DEFAULT_RECEIPT_SERVICE_SELECTION_MODE: ReceiptServiceSelectionMode =
  "required";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseReceiptServiceSelectionMode(
  value: unknown,
): ReceiptServiceSelectionMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();

  if (normalized === "required" || normalized === "obligatorio") {
    return "required";
  }
  if (normalized === "optional" || normalized === "opcional") {
    return "optional";
  }
  if (
    normalized === "booking" ||
    normalized === "booking_only" ||
    normalized === "booking-only" ||
    normalized === "reserva"
  ) {
    return "booking";
  }

  return null;
}

export function normalizeReceiptServiceSelectionMode(
  value: unknown,
): ReceiptServiceSelectionMode {
  return (
    parseReceiptServiceSelectionMode(value) ??
    DEFAULT_RECEIPT_SERVICE_SELECTION_MODE
  );
}

export function extractBookingComponentRulesFromAccessRules(
  value: unknown,
): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const rules = value.rules;
  return Array.isArray(rules) ? rules : [];
}

export function extractReceiptServiceSelectionModeFromBookingAccessRules(
  value: unknown,
): ReceiptServiceSelectionMode {
  if (!isRecord(value)) return DEFAULT_RECEIPT_SERVICE_SELECTION_MODE;
  return normalizeReceiptServiceSelectionMode(
    value.receipt_service_selection_mode,
  );
}

export function buildBookingAccessRulesValue(args: {
  existing: unknown;
  rules?: unknown[];
  receiptServiceSelectionMode?: unknown;
}): Record<string, unknown> {
  const base = isRecord(args.existing) ? { ...args.existing } : {};
  const nextRules = Array.isArray(args.rules)
    ? args.rules
    : extractBookingComponentRulesFromAccessRules(args.existing);
  const nextMode =
    args.receiptServiceSelectionMode !== undefined
      ? normalizeReceiptServiceSelectionMode(args.receiptServiceSelectionMode)
      : normalizeReceiptServiceSelectionMode(base.receipt_service_selection_mode);

  return {
    ...base,
    rules: nextRules,
    receipt_service_selection_mode: nextMode,
  };
}
