const PENDING_TOLERANCE = 0.01;

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeCurrency = (raw: string): string => {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  if (!value) return "ARS";
  if (["$", "AR$"].includes(value)) return "ARS";
  if (["US$", "U$S", "U$D", "DOL"].includes(value)) return "USD";
  return value;
};

export type PassengerPendingSource =
  | "services_minus_receipts"
  | "installments_fallback";

export type PassengerPendingBreakdown = {
  currency: string;
  services: number;
  receipts: number;
  pending: number;
};

export type PassengerPendingValue = {
  amount: string;
  count: number;
  source: PassengerPendingSource;
  breakdown: PassengerPendingBreakdown[];
};

export type PassengerPendingInstallmentsFallback = {
  amount: string;
  count: number;
};

const toSortedBreakdown = (
  servicesByCurrency: Record<string, number>,
  receiptsByCurrency: Record<string, number>,
): PassengerPendingBreakdown[] => {
  const currencies = new Set([
    ...Object.keys(servicesByCurrency),
    ...Object.keys(receiptsByCurrency),
  ]);
  const rows: PassengerPendingBreakdown[] = [];
  for (const currencyKey of currencies) {
    const currency = normalizeCurrency(currencyKey);
    const services = round2(Math.max(0, Number(servicesByCurrency[currencyKey] || 0)));
    const receipts = round2(Math.max(0, Number(receiptsByCurrency[currencyKey] || 0)));
    const pending = round2(Math.max(0, services - receipts));
    if (services <= PENDING_TOLERANCE && receipts <= PENDING_TOLERANCE) continue;
    rows.push({
      currency,
      services,
      receipts,
      pending,
    });
  }
  return rows.sort((a, b) => a.currency.localeCompare(b.currency, "es"));
};

const formatAmountFromBreakdown = (
  breakdown: PassengerPendingBreakdown[],
): string => {
  const pendingRows = breakdown.filter((row) => row.pending > PENDING_TOLERANCE);
  if (pendingRows.length === 0) return "0";
  if (pendingRows.length === 1) {
    return `${pendingRows[0].pending.toFixed(2)} ${pendingRows[0].currency}`;
  }
  return pendingRows
    .map((row) => `${row.currency} ${row.pending.toFixed(2)}`)
    .join(" + ");
};

export function computePassengerPendingValue(args: {
  servicesByCurrency?: Record<string, number> | null;
  receiptsByCurrency?: Record<string, number> | null;
  installmentsFallback: PassengerPendingInstallmentsFallback;
}): PassengerPendingValue {
  const services = args.servicesByCurrency ?? {};
  const receipts = args.receiptsByCurrency ?? {};
  const hasDetectableServices = Object.values(services).some(
    (value) => Number(value) > PENDING_TOLERANCE,
  );

  if (!hasDetectableServices) {
    const fallbackCount = Number(args.installmentsFallback.count) || 0;
    return {
      amount: String(args.installmentsFallback.amount ?? "0"),
      count: Math.max(0, Math.trunc(fallbackCount)),
      source: "installments_fallback",
      breakdown: [],
    };
  }

  const breakdown = toSortedBreakdown(services, receipts);
  const pendingRows = breakdown.filter((row) => row.pending > PENDING_TOLERANCE);
  return {
    amount: formatAmountFromBreakdown(breakdown),
    count: pendingRows.length,
    source: "services_minus_receipts",
    breakdown,
  };
}
