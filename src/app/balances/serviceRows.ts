export type CurrencyCode = "ARS" | "USD";

export type CurrencyTotals = Record<CurrencyCode, number>;

export type TaxBucket = {
  iva21: number;
  iva105: number;
  iva21Comm: number;
  iva105Comm: number;
  exento: number;
  otros: number;
  noComp: number;
  cardIntBase: number;
  cardIntIVA: number;
  transf: number;
  base21: number;
  base105: number;
  commSinIVA: number;
  commNet: number;
  commWithVAT: number;
  total: number;
};

export type ServiceRowInput = {
  id_service?: number | null;
  agency_service_id?: number | null;
  type?: string | null;
  description?: string | null;
  reference?: string | null;
  departure_date?: string | Date | null;
  return_date?: string | Date | null;
  operator?: {
    name?: string | null;
  } | null;
  sale_price?: number | null;
  cost_price?: number | null;
  currency?: string | null;
  tax_21?: number | null;
  tax_105?: number | null;
  exempt?: number | null;
  other_taxes?: number | null;
  nonComputable?: number | null;
  taxableBase21?: number | null;
  taxableBase10_5?: number | null;
  taxableCardInterest?: number | null;
  vatOnCardInterest?: number | null;
  transfer_fee_amount?: number | string | null;
  transfer_fee_pct?: number | string | null;
  extra_costs_amount?: number | null;
  extra_taxes_amount?: number | null;
  totalCommissionWithoutVAT?: number | null;
  vatOnCommission21?: number | null;
  vatOnCommission10_5?: number | null;
};

export type ServiceFinancialRow = {
  serviceIndex: number;
  id_service: number | null;
  agency_service_id: number | null;
  type: string;
  description: string;
  reference: string;
  departure_date: string | Date | null;
  return_date: string | Date | null;
  operator_name: string;
  saleNoInt: CurrencyTotals;
  cost: CurrencyTotals;
  paid: CurrencyTotals;
  debt: CurrencyTotals;
  operatorDebt: CurrencyTotals;
  taxByCurrency: Record<CurrencyCode, TaxBucket>;
};

export type BuildServiceFinancialRowsInput = {
  services: ServiceRowInput[];
  bookingSaleNoInt: CurrencyTotals;
  bookingPaid: CurrencyTotals;
  bookingDebt: CurrencyTotals;
  bookingOperatorDebt: CurrencyTotals;
  bookingTaxByCurrency?: Record<CurrencyCode, Pick<TaxBucket, "commNet">>;
  transferFeePct: number;
  useBookingSaleTotal: boolean;
};

const ZERO_TOTALS: CurrencyTotals = { ARS: 0, USD: 0 };
const CURRENCIES: CurrencyCode[] = ["ARS", "USD"];

function toNum(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

function normalizeCurrency(raw: string | null | undefined): CurrencyCode {
  const s = String(raw || "")
    .trim()
    .toUpperCase();
  if (s === "USD" || s === "US$" || s === "U$S" || s === "U$D") return "USD";
  return "ARS";
}

function makeEmptyTaxBucket(): TaxBucket {
  return {
    iva21: 0,
    iva105: 0,
    iva21Comm: 0,
    iva105Comm: 0,
    exento: 0,
    otros: 0,
    noComp: 0,
    cardIntBase: 0,
    cardIntIVA: 0,
    transf: 0,
    base21: 0,
    base105: 0,
    commSinIVA: 0,
    commNet: 0,
    commWithVAT: 0,
    total: 0,
  };
}

function distributeTotal(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const safeTotal = Number.isFinite(total) ? total : 0;
  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = safeWeights.reduce((acc, w) => acc + w, 0);

  if (sum <= 0) {
    const out = new Array<number>(weights.length).fill(0);
    let assigned = 0;
    for (let i = 0; i < out.length; i += 1) {
      if (i === out.length - 1) out[i] = safeTotal - assigned;
      else {
        const value = safeTotal / out.length;
        out[i] = value;
        assigned += value;
      }
    }
    return out;
  }

  const out = new Array<number>(weights.length).fill(0);
  let assigned = 0;
  for (let i = 0; i < safeWeights.length; i += 1) {
    if (i === safeWeights.length - 1) {
      out[i] = safeTotal - assigned;
      continue;
    }
    const value = (safeTotal * safeWeights[i]) / sum;
    out[i] = value;
    assigned += value;
  }
  return out;
}

function buildServiceTaxBucket(
  service: ServiceRowInput,
  transferFeePct: number,
): TaxBucket {
  const iva21 = toNum(service.tax_21);
  const iva105 = toNum(service.tax_105);
  const iva21Comm = toNum(service.vatOnCommission21);
  const iva105Comm = toNum(service.vatOnCommission10_5);
  const exento = toNum(service.exempt);
  const otros = toNum(service.other_taxes);
  const noComp = toNum(service.nonComputable);
  const base21 = toNum(service.taxableBase21);
  const base105 = toNum(service.taxableBase10_5);
  const cardIntBase = toNum(service.taxableCardInterest);
  const cardIntIVA = toNum(service.vatOnCardInterest);
  const commSinIVA = toNum(service.totalCommissionWithoutVAT);
  const commWithVAT = commSinIVA + iva21Comm + iva105Comm;
  const sale = toNum(service.sale_price);
  const pctRaw = service.transfer_fee_pct;
  const pct =
    pctRaw != null && String(pctRaw).trim() !== ""
      ? toNum(pctRaw)
      : transferFeePct;
  const transf =
    service.transfer_fee_amount != null
      ? toNum(service.transfer_fee_amount)
      : sale * (Number.isFinite(pct) ? pct : 0);
  const extraCosts = toNum(service.extra_costs_amount);
  const extraTaxes = toNum(service.extra_taxes_amount);
  const commNet = Math.max(commSinIVA - transf - extraCosts - extraTaxes, 0);
  const total =
    iva21 +
    iva105 +
    iva21Comm +
    iva105Comm +
    cardIntIVA +
    otros +
    noComp +
    transf;

  return {
    iva21,
    iva105,
    iva21Comm,
    iva105Comm,
    exento,
    otros,
    noComp,
    cardIntBase,
    cardIntIVA,
    transf,
    base21,
    base105,
    commSinIVA,
    commNet,
    commWithVAT,
    total,
  };
}

function initCurrencyTotals(): CurrencyTotals {
  return { ...ZERO_TOTALS };
}

function initTaxByCurrency(): Record<CurrencyCode, TaxBucket> {
  return {
    ARS: makeEmptyTaxBucket(),
    USD: makeEmptyTaxBucket(),
  };
}

function costByCurrency(
  currency: CurrencyCode,
  cost: number | null | undefined,
): CurrencyTotals {
  return {
    ARS: currency === "ARS" ? toNum(cost) : 0,
    USD: currency === "USD" ? toNum(cost) : 0,
  };
}

export function buildServiceFinancialRows(
  input: BuildServiceFinancialRowsInput,
): ServiceFinancialRow[] {
  const services = Array.isArray(input.services) ? input.services : [];
  if (!services.length) return [];

  const indexesByCurrency: Record<CurrencyCode, number[]> = { ARS: [], USD: [] };
  const weightsByCurrency: Record<CurrencyCode, number[]> = { ARS: [], USD: [] };

  services.forEach((service, index) => {
    const currency = normalizeCurrency(service.currency);
    indexesByCurrency[currency].push(index);
    weightsByCurrency[currency].push(toNum(service.sale_price));
  });

  const allocatedSaleByService: CurrencyTotals[] = services.map(() =>
    initCurrencyTotals(),
  );
  const allocatedPaidByService: CurrencyTotals[] = services.map(() =>
    initCurrencyTotals(),
  );
  const allocatedDebtByService: CurrencyTotals[] = services.map(() =>
    initCurrencyTotals(),
  );
  const allocatedOperatorDebtByService: CurrencyTotals[] = services.map(() =>
    initCurrencyTotals(),
  );
  const allocatedCommNetByService: CurrencyTotals[] = services.map(() =>
    initCurrencyTotals(),
  );

  for (const currency of CURRENCIES) {
    const indexes = indexesByCurrency[currency];
    if (!indexes.length) continue;
    const weights = weightsByCurrency[currency];

    const saleDistribution = input.useBookingSaleTotal
      ? distributeTotal(input.bookingSaleNoInt[currency] || 0, weights)
      : weights.map((w) => (Number.isFinite(w) ? w : 0));
    const paidDistribution = distributeTotal(input.bookingPaid[currency] || 0, weights);
    const debtDistribution = distributeTotal(input.bookingDebt[currency] || 0, weights);
    const operatorDebtDistribution = distributeTotal(
      input.bookingOperatorDebt[currency] || 0,
      weights,
    );
    const commNetDistribution = distributeTotal(
      input.bookingTaxByCurrency?.[currency]?.commNet || 0,
      weights,
    );

    for (let i = 0; i < indexes.length; i += 1) {
      const serviceIndex = indexes[i];
      allocatedSaleByService[serviceIndex][currency] = saleDistribution[i] || 0;
      allocatedPaidByService[serviceIndex][currency] = paidDistribution[i] || 0;
      allocatedDebtByService[serviceIndex][currency] = debtDistribution[i] || 0;
      allocatedOperatorDebtByService[serviceIndex][currency] =
        operatorDebtDistribution[i] || 0;
      allocatedCommNetByService[serviceIndex][currency] =
        commNetDistribution[i] || 0;
    }
  }

  return services.map((service, serviceIndex) => {
    const currency = normalizeCurrency(service.currency);
    const taxByCurrency = initTaxByCurrency();
    taxByCurrency[currency] = buildServiceTaxBucket(service, input.transferFeePct);

    if (input.useBookingSaleTotal) {
      taxByCurrency[currency].commNet =
        allocatedCommNetByService[serviceIndex][currency] || 0;
    }

    return {
      serviceIndex,
      id_service:
        typeof service.id_service === "number" && Number.isFinite(service.id_service)
          ? service.id_service
          : null,
      agency_service_id:
        typeof service.agency_service_id === "number" &&
        Number.isFinite(service.agency_service_id)
          ? service.agency_service_id
          : null,
      type: String(service.type || "").trim(),
      description: String(service.description || "").trim(),
      reference: String(service.reference || "").trim(),
      departure_date: service.departure_date ?? null,
      return_date: service.return_date ?? null,
      operator_name: String(service.operator?.name || "").trim(),
      saleNoInt: allocatedSaleByService[serviceIndex],
      cost: costByCurrency(currency, service.cost_price),
      paid: allocatedPaidByService[serviceIndex],
      debt: allocatedDebtByService[serviceIndex],
      operatorDebt: allocatedOperatorDebtByService[serviceIndex],
      taxByCurrency,
    };
  });
}
