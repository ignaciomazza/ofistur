export type AutoAllocationServiceInput = {
  id_service: number;
  currency: string;
  cost_price?: number | null;
};

export type AutoAllocationDraftNumbers = {
  amountService: number;
  counterAmount: number | null;
};

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeCurrency = (value: string): string =>
  String(value || "ARS").trim().toUpperCase() || "ARS";

const normalizeAmount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed > 0 ? parsed : 0;
};

export const buildCostProrationDraftNumbers = (opts: {
  services: AutoAllocationServiceInput[];
  paymentCurrency: string;
  paymentAmount: number;
  fxRatesByCurrency?: Record<string, number>;
}): Record<number, AutoAllocationDraftNumbers> | null => {
  const { services, paymentAmount } = opts;
  const paymentCurrency = normalizeCurrency(opts.paymentCurrency);
  const safePaymentAmount = normalizeAmount(paymentAmount);

  if (!Array.isArray(services) || services.length === 0 || safePaymentAmount <= 0) {
    return null;
  }

  const rows = services.map((service) => {
    const serviceCurrency = normalizeCurrency(service.currency);
    const serviceCost = normalizeAmount(service.cost_price);
    const fxRateRaw =
      serviceCurrency === paymentCurrency
        ? 1
        : opts.fxRatesByCurrency?.[serviceCurrency];
    const fxRate = Number.isFinite(fxRateRaw) && Number(fxRateRaw) > 0
      ? Number(fxRateRaw)
      : null;

    return {
      service,
      serviceCurrency,
      serviceCost,
      fxRate,
      weight:
        fxRate != null && serviceCost > 0
          ? round2(serviceCost * fxRate)
          : 0,
    };
  });

  const hasMissingFx = rows.some(
    (row) => row.serviceCurrency !== paymentCurrency && row.fxRate == null,
  );
  if (hasMissingFx) return null;

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return null;

  let remaining = round2(safePaymentAmount);
  const output: Record<number, AutoAllocationDraftNumbers> = {};

  rows.forEach((row, index) => {
    const isLast = index === rows.length - 1;
    const ratio = row.weight / totalWeight;
    const amountPayment = isLast
      ? remaining
      : round2(safePaymentAmount * ratio);
    if (!isLast) remaining = round2(remaining - amountPayment);

    const fxRate = row.fxRate || 1;
    const amountService = round2(amountPayment / fxRate);

    output[row.service.id_service] = {
      amountService,
      counterAmount:
        row.serviceCurrency === paymentCurrency ? null : amountPayment,
    };
  });

  return output;
};

export const buildCostOnlyDraftNumbers = (opts: {
  services: AutoAllocationServiceInput[];
}): Record<number, AutoAllocationDraftNumbers> => {
  const out: Record<number, AutoAllocationDraftNumbers> = {};
  for (const service of opts.services || []) {
    out[service.id_service] = {
      amountService: round2(normalizeAmount(service.cost_price)),
      counterAmount: null,
    };
  }
  return out;
};

export const shouldConfirmFullExcessWithServices = (opts: {
  hasServices: boolean;
  paymentAmount: number;
  assignedTotal: number;
  excess: number;
  tolerance?: number;
}): boolean => {
  const tolerance =
    Number.isFinite(opts.tolerance) && Number(opts.tolerance) >= 0
      ? Number(opts.tolerance)
      : 0.01;

  if (!opts.hasServices) return false;

  const paymentAmount = Number.isFinite(opts.paymentAmount)
    ? Number(opts.paymentAmount)
    : 0;
  if (paymentAmount <= tolerance) return false;

  const assignedTotal = Number.isFinite(opts.assignedTotal)
    ? Number(opts.assignedTotal)
    : 0;
  const excess = Number.isFinite(opts.excess) ? Number(opts.excess) : 0;

  return assignedTotal <= tolerance && excess >= paymentAmount - tolerance;
};
