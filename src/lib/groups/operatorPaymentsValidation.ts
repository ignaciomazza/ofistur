import { normalizeCurrencyCode } from "@/lib/groups/financeShared";

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
};

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const GROUP_OPERATOR_PAYMENT_TOLERANCE = 0.01;

export type GroupOperatorPaymentAllocation = {
  service_id: number;
  booking_id?: number;
  payment_currency?: string;
  service_currency?: string;
  amount_payment: number;
  amount_service: number;
  fx_rate: number | null;
};

export function parseGroupOperatorPaymentAllocations(
  raw: unknown,
): GroupOperatorPaymentAllocation[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupOperatorPaymentAllocation[] = [];

  for (const item of raw) {
    if (!isRecord(item)) continue;
    const serviceId = toPositiveInt(
      item.service_id ?? item.serviceId ?? item.id_service ?? item.idService,
    );
    if (!serviceId) continue;

    const amountPaymentRaw = toNumber(item.amount_payment ?? item.amountPayment ?? 0);
    const amountServiceRaw = toNumber(item.amount_service ?? item.amountService ?? 0);
    const fxRaw = item.fx_rate ?? item.fxRate;
    const fxNumber = fxRaw == null || fxRaw === "" ? NaN : toNumber(fxRaw);
    const bookingId = toPositiveInt(item.booking_id ?? item.bookingId);
    const paymentCurrency = toOptionalString(
      item.payment_currency ?? item.paymentCurrency,
    );
    const serviceCurrency = toOptionalString(
      item.service_currency ?? item.serviceCurrency,
    );

    out.push({
      service_id: serviceId,
      booking_id: bookingId ?? undefined,
      payment_currency: paymentCurrency
        ? normalizeCurrencyCode(paymentCurrency)
        : undefined,
      service_currency: serviceCurrency
        ? normalizeCurrencyCode(serviceCurrency)
        : undefined,
      amount_payment: Number.isFinite(amountPaymentRaw)
        ? round2(amountPaymentRaw)
        : 0,
      amount_service: Number.isFinite(amountServiceRaw)
        ? round2(amountServiceRaw)
        : 0,
      fx_rate: Number.isFinite(fxNumber) ? fxNumber : null,
    });
  }

  return out;
}

export type GroupOperatorPaymentLine = {
  amount: number;
  payment_method: string;
  account?: string;
  payment_currency: string;
  fee_mode?: "FIXED" | "PERCENT";
  fee_value?: number;
  fee_amount: number;
};

function normalizeFeeMode(value: unknown): "FIXED" | "PERCENT" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === "FIXED" || normalized === "PERCENT") {
    return normalized;
  }
  return undefined;
}

function computeFeeAmount(args: {
  amount: number;
  feeMode?: "FIXED" | "PERCENT";
  feeValue?: number;
  feeAmountRaw?: number;
}): number {
  const safeAmount = Math.max(0, args.amount);
  const rawFeeAmount =
    typeof args.feeAmountRaw === "number" && Number.isFinite(args.feeAmountRaw)
      ? Math.max(0, args.feeAmountRaw)
      : 0;
  if (!args.feeMode) return round2(rawFeeAmount);
  if (args.feeMode === "PERCENT") {
    return round2(safeAmount * (Math.max(0, args.feeValue ?? 0) / 100));
  }
  return round2(Math.max(0, args.feeValue ?? 0));
}

export function normalizeGroupOperatorPaymentLines(
  raw: unknown,
  fallbackCurrency: string,
): GroupOperatorPaymentLine[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupOperatorPaymentLine[] = [];
  const fallback = normalizeCurrencyCode(fallbackCurrency || "ARS");

  for (const item of raw) {
    if (!isRecord(item)) continue;
    const amount = toNumber(item.amount);
    const paymentMethod = toOptionalString(item.payment_method);
    if (!Number.isFinite(amount) || amount <= 0 || !paymentMethod) continue;

    const account = toOptionalString(item.account);
    const paymentCurrency = normalizeCurrencyCode(
      item.payment_currency ?? fallback,
    );
    const feeMode = normalizeFeeMode(item.fee_mode);
    const feeValueRaw = toNumber(item.fee_value);
    const feeValue =
      feeMode && Number.isFinite(feeValueRaw) ? Math.max(0, feeValueRaw) : undefined;
    const feeAmountRaw = toNumber(item.fee_amount);
    const feeAmount = computeFeeAmount({
      amount,
      feeMode,
      feeValue,
      feeAmountRaw: Number.isFinite(feeAmountRaw) ? feeAmountRaw : undefined,
    });

    out.push({
      amount: round2(amount),
      payment_method: paymentMethod,
      account,
      payment_currency: paymentCurrency,
      fee_mode: feeMode,
      fee_value: feeValue,
      fee_amount: feeAmount,
    });
  }

  return out;
}

export function normalizeGroupOperatorExcessAction(
  raw: unknown,
): "carry" | "credit_entry" | null | undefined {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  if (normalized === "carry" || normalized === "credit_entry") {
    return normalized;
  }
  return undefined;
}

export function normalizeGroupOperatorMissingAction(
  raw: unknown,
): "carry" | "block" | "create" | null | undefined {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  if (
    normalized === "carry" ||
    normalized === "block" ||
    normalized === "create"
  ) {
    return normalized;
  }
  return undefined;
}

export function sumAssignedAmount(
  allocations: GroupOperatorPaymentAllocation[],
): number {
  return round2(
    allocations.reduce(
      (sum, allocation) => sum + Math.max(0, allocation.amount_payment),
      0,
    ),
  );
}

export function hasDuplicatedServices(
  allocations: GroupOperatorPaymentAllocation[],
): boolean {
  const serviceIds = allocations.map((item) => item.service_id);
  return new Set(serviceIds).size !== serviceIds.length;
}

export function getServiceRefsFromAllocations(
  allocations: GroupOperatorPaymentAllocation[],
): number[] {
  return Array.from(new Set(allocations.map((item) => item.service_id)));
}

export function asPayloadObject(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  return { ...raw };
}
