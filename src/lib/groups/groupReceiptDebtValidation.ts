import { normalizeCurrencyCode, toAmountNumber } from "@/lib/groups/financeShared";

const DEBT_TOLERANCE = 0.01;

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toSafeNumber = (value: unknown): number => {
  const n = toAmountNumber(value);
  return Number.isFinite(n) ? n : 0;
};

const uniquePositiveIds = (values: number[]): number[] => {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const n = Math.trunc(value);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
};

const normalizeServiceRefList = (
  values: number[] | null | undefined,
): number[] => {
  if (!Array.isArray(values)) return [];
  return uniquePositiveIds(values);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const addToCurrency = (
  target: Record<string, number>,
  currencyRaw: unknown,
  amountRaw: number,
) => {
  const currency = normalizeCurrencyCode(currencyRaw);
  if (!currency) return;
  if (Math.abs(amountRaw) <= DEBT_TOLERANCE) return;
  target[currency] = round2((target[currency] || 0) + amountRaw);
};

export type GroupReceiptDebtService = {
  id_service: number;
  currency: string | null;
  sale_price: number | null;
  card_interest: number | null;
  taxableCardInterest: number | null;
  vatOnCardInterest: number | null;
};

export type GroupReceiptDebtReceipt = {
  service_refs: number[] | null;
  amount: unknown;
  amount_currency: string | null;
  payment_fee_amount: unknown;
  base_amount: unknown;
  base_currency: string | null;
  payments?: unknown;
};

export type GroupReceiptDebtCurrent = {
  amount: number;
  amountCurrency: string;
  paymentFeeAmount: number;
  baseAmount: number | null;
  baseCurrency: string | null;
  payments?: unknown;
};

export type GroupReceiptDebtPaymentLine = {
  amount: number;
  payment_currency: string;
  fee_amount: number;
};

function parsePaymentLine(raw: unknown): GroupReceiptDebtPaymentLine | null {
  if (!isRecord(raw)) return null;
  const amount = Math.max(0, toSafeNumber(raw.amount));
  const feeAmount = Math.max(0, toSafeNumber(raw.fee_amount));
  const paymentCurrency = normalizeCurrencyCode(
    raw.payment_currency ?? raw.paymentCurrency ?? "ARS",
  );
  if (amount <= 0 && feeAmount <= 0) return null;
  return {
    amount: round2(amount),
    payment_currency: paymentCurrency,
    fee_amount: round2(feeAmount),
  };
}

export function normalizeGroupReceiptPaymentLines(
  raw: unknown,
): GroupReceiptDebtPaymentLine[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupReceiptDebtPaymentLine[] = [];
  for (const item of raw) {
    const parsed = parsePaymentLine(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function addGroupReceiptToPaidByCurrency(
  target: Record<string, number>,
  receipt: GroupReceiptDebtReceipt,
) {
  const amountCurrency = normalizeCurrencyCode(receipt.amount_currency || "ARS");
  const amountValue = Math.max(0, toSafeNumber(receipt.amount));
  const feeValue = Math.max(0, toSafeNumber(receipt.payment_fee_amount));
  const baseValue = Math.max(0, toSafeNumber(receipt.base_amount));
  const baseCurrency = receipt.base_currency
    ? normalizeCurrencyCode(receipt.base_currency)
    : null;
  const paymentLines = normalizeGroupReceiptPaymentLines(receipt.payments);

  if (baseCurrency && baseValue > DEBT_TOLERANCE) {
    const lineFeeTotal = paymentLines.reduce(
      (sum, line) => sum + Math.max(0, line.fee_amount),
      0,
    );
    const feeRemainder = round2(feeValue - lineFeeTotal);
    const feeInBase =
      (paymentLines.length > 0
        ? paymentLines.reduce((sum, line) => {
            if (line.payment_currency !== baseCurrency) return sum;
            return sum + Math.max(0, line.fee_amount);
          }, 0)
        : amountCurrency === baseCurrency
          ? feeValue
          : 0) +
      (Math.abs(feeRemainder) > DEBT_TOLERANCE &&
      amountCurrency === baseCurrency
        ? feeRemainder
        : 0);
    addToCurrency(target, baseCurrency, round2(baseValue + feeInBase));
    return;
  }

  if (paymentLines.length > 0) {
    let lineFeeTotal = 0;
    for (const line of paymentLines) {
      lineFeeTotal += Math.max(0, line.fee_amount);
      const credited = round2(Math.max(0, line.amount) + Math.max(0, line.fee_amount));
      addToCurrency(target, line.payment_currency, credited);
    }
    const feeRemainder = round2(feeValue - lineFeeTotal);
    if (Math.abs(feeRemainder) > DEBT_TOLERANCE) {
      addToCurrency(target, amountCurrency, feeRemainder);
    }
    return;
  }

  addToCurrency(target, amountCurrency, round2(amountValue + feeValue));
}

export type GroupReceiptDebtValidationResult =
  | {
      ok: true;
      normalizedServiceIds: number[];
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

function serviceTotal(service: GroupReceiptDebtService): number {
  const sale = Math.max(0, toSafeNumber(service.sale_price));
  const splitInterest =
    toSafeNumber(service.taxableCardInterest) +
    toSafeNumber(service.vatOnCardInterest);
  const cardInterest = splitInterest > 0 ? splitInterest : toSafeNumber(service.card_interest);
  return round2(Math.max(0, sale + Math.max(0, cardInterest)));
}

function buildSalesByCurrency(args: {
  selectedServiceIds: number[];
  servicesById: Map<number, GroupReceiptDebtService>;
}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const serviceId of args.selectedServiceIds) {
    const service = args.servicesById.get(serviceId);
    if (!service) continue;
    const total = serviceTotal(service);
    if (total <= 0) continue;
    addToCurrency(out, service.currency || "ARS", total);
  }
  return out;
}

function buildCurrentPaidByCurrency(
  current: GroupReceiptDebtCurrent,
): Record<string, number> {
  const out: Record<string, number> = {};
  const payloadAsReceipt: GroupReceiptDebtReceipt = {
    service_refs: [],
    amount: current.amount,
    amount_currency: current.amountCurrency,
    payment_fee_amount: current.paymentFeeAmount,
    base_amount: current.baseAmount,
    base_currency: current.baseCurrency,
    payments: current.payments,
  };
  addGroupReceiptToPaidByCurrency(out, payloadAsReceipt);
  return out;
}

export function validateGroupReceiptDebt(args: {
  selectedServiceIds: number[];
  services: GroupReceiptDebtService[];
  existingReceipts: GroupReceiptDebtReceipt[];
  currentReceipt: GroupReceiptDebtCurrent;
}): GroupReceiptDebtValidationResult {
  const normalizedServiceIds = uniquePositiveIds(args.selectedServiceIds);
  if (normalizedServiceIds.length === 0) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_SERVICES_REQUIRED",
      message: "Seleccioná al menos un servicio para registrar el cobro.",
    };
  }

  const servicesById = new Map<number, GroupReceiptDebtService>();
  for (const service of args.services) {
    servicesById.set(service.id_service, service);
  }
  if (servicesById.size === 0) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_SERVICES_NOT_FOUND",
      message: "No encontramos servicios para validar este cobro.",
    };
  }

  const invalidServiceIds = normalizedServiceIds.filter(
    (serviceId) => !servicesById.has(serviceId),
  );
  if (invalidServiceIds.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_SERVICE_NOT_IN_GROUP_CONTEXT",
      message: "Algún servicio seleccionado no pertenece al contexto de la grupal.",
    };
  }

  const selectedCurrencies = new Set(
    normalizedServiceIds.map((serviceId) =>
      normalizeCurrencyCode(servicesById.get(serviceId)?.currency || "ARS"),
    ),
  );
  if (selectedCurrencies.size > 1) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_SERVICE_CURRENCY_MIX_NOT_ALLOWED",
      message:
        "No se puede cobrar servicios de distinta moneda en un mismo recibo.",
    };
  }

  const salesByCurrency = buildSalesByCurrency({
    selectedServiceIds: normalizedServiceIds,
    servicesById,
  });
  if (Object.keys(salesByCurrency).length === 0) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_SERVICE_TOTAL_INVALID",
      message: "Los servicios seleccionados no tienen importes válidos.",
    };
  }

  const amountCurrency = normalizeCurrencyCode(args.currentReceipt.amountCurrency);
  const baseCurrency = args.currentReceipt.baseCurrency
    ? normalizeCurrencyCode(args.currentReceipt.baseCurrency)
    : null;
  const baseAmount = toSafeNumber(args.currentReceipt.baseAmount);
  const hasBaseConversion =
    !!baseCurrency && baseAmount > DEBT_TOLERANCE;
  const saleCurrencies = Object.keys(salesByCurrency);

  if (
    !saleCurrencies.includes(amountCurrency) &&
    !hasBaseConversion
  ) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_BASE_CONVERSION_REQUIRED",
      message:
        "Si cobrás en otra moneda, cargá valor base y moneda base del servicio.",
    };
  }

  if (
    hasBaseConversion &&
    baseCurrency &&
    !saleCurrencies.includes(baseCurrency)
  ) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_BASE_CURRENCY_MISMATCH",
      message: "La moneda base debe coincidir con la moneda del servicio.",
    };
  }

  const selectedSet = new Set(normalizedServiceIds);
  const paidByCurrency: Record<string, number> = {};
  for (const receipt of args.existingReceipts) {
    const refs = normalizeServiceRefList(receipt.service_refs);
    const appliesToSelection =
      refs.length === 0 || refs.some((serviceId) => selectedSet.has(serviceId));
    if (!appliesToSelection) continue;
    addGroupReceiptToPaidByCurrency(paidByCurrency, receipt);
  }

  const remainingBeforeCurrent: Record<string, number> = {};
  const debtCurrencies = new Set([
    ...Object.keys(salesByCurrency),
    ...Object.keys(paidByCurrency),
  ]);
  for (const currency of debtCurrencies) {
    remainingBeforeCurrent[currency] = round2(
      (salesByCurrency[currency] || 0) - (paidByCurrency[currency] || 0),
    );
  }

  const hasPendingBalance = Object.values(remainingBeforeCurrent).some(
    (value) => value > DEBT_TOLERANCE,
  );
  if (!hasPendingBalance) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_SERVICES_ALREADY_PAID",
      message: "Los servicios seleccionados ya están saldados.",
    };
  }

  const currentPaidByCurrency = buildCurrentPaidByCurrency(args.currentReceipt);
  const allCurrencies = new Set([
    ...Object.keys(remainingBeforeCurrent),
    ...Object.keys(currentPaidByCurrency),
  ]);

  const overpaidCurrencies: string[] = [];
  for (const currency of allCurrencies) {
    const remainingBefore = round2(remainingBeforeCurrent[currency] || 0);
    const currentPaid = round2(currentPaidByCurrency[currency] || 0);
    const remainingAfterCurrent = round2(
      remainingBefore - currentPaid,
    );
    const currentCreatesOrWorsensOverpay =
      currentPaid > DEBT_TOLERANCE || remainingBefore >= -DEBT_TOLERANCE;
    if (
      remainingAfterCurrent < -DEBT_TOLERANCE &&
      currentCreatesOrWorsensOverpay
    ) {
      overpaidCurrencies.push(currency);
    }
  }

  if (overpaidCurrencies.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "GROUP_FINANCE_OVERPAY_NOT_ALLOWED",
      message: `El recibo excede el saldo pendiente en ${overpaidCurrencies.join(", ")}.`,
    };
  }

  return {
    ok: true,
    normalizedServiceIds,
  };
}
