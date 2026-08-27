import type { BillingAdjustmentConfig } from "@/types";
import { computeBillingAdjustments } from "@/utils/billingAdjustments";
import {
  decodeInventoryServiceId,
  encodeInventoryServiceId,
  resolveInventoryEstimatedSaleUnitPrice,
} from "@/lib/groups/inventoryServiceRefs";
import { addGroupReceiptToPaidByCurrency } from "@/lib/groups/groupReceiptDebtValidation";
import { parseGroupOperatorPaymentAllocations } from "@/lib/groups/operatorPaymentsValidation";

const MONEY_TOLERANCE = 0.01;
const INVENTORY_META_PREFIX = "[OFI_INV_META]";
const INVENTORY_META_SUFFIX = "[/OFI_INV_META]";

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toAmountNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toNumber?: unknown }).toNumber === "function"
  ) {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const normalizeCurrencyCode = (value: unknown): string => {
  const raw = String(value || "ARS")
    .trim()
    .toUpperCase();
  if (!raw) return "ARS";
  if (["$", "AR$", "PES"].includes(raw)) return "ARS";
  if (["U$S", "US$", "USD$", "U$D", "DOL"].includes(raw)) return "USD";
  return raw;
};

const normalizeFeeRate = (
  raw: number | string | null | undefined,
  fallback: number,
): number => {
  const parsed = raw == null || raw === "" ? NaN : toAmountNumber(raw);
  const candidate = Number.isFinite(parsed) ? parsed : fallback;
  if (!Number.isFinite(candidate) || candidate < 0) return 0;
  return candidate > 1 ? candidate / 100 : candidate;
};

const positiveMoneyOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = toAmountNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return round2(parsed);
};

type InventoryFinancialMeta = {
  v?: unknown;
  pricingMode?: unknown;
  costTotalPrice?: unknown;
  saleUnitPrice?: unknown;
  saleTotalPrice?: unknown;
  taxable21?: unknown;
  taxable105?: unknown;
  exemptAmount?: unknown;
  otherTaxes?: unknown;
  transferFeePct?: unknown;
};

function parseInventoryMeta(
  note: string | null | undefined,
): InventoryFinancialMeta | null {
  const raw = String(note || "");
  const start = raw.indexOf(INVENTORY_META_PREFIX);
  const end = raw.indexOf(INVENTORY_META_SUFFIX);
  if (start !== 0 || end <= INVENTORY_META_PREFIX.length) return null;
  const jsonText = raw.slice(INVENTORY_META_PREFIX.length, end).trim();
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as InventoryFinancialMeta;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export type GroupFinanceSummaryInventory = {
  id_travel_group_inventory: number;
  travel_group_departure_id?: number | null;
  label: string;
  inventory_type?: string | null;
  service_type?: string | null;
  provider?: string | null;
  currency?: string | null;
  unit_cost?: unknown;
  total_qty?: unknown;
  note?: string | null;
};

export type GroupFinanceSummaryAssignment = {
  id?: number | null;
  travel_group_passenger_id: number;
  travel_group_departure_id?: number | null;
  service_ref?: string | number | null;
  amount?: unknown;
  currency?: string | null;
  status?: string | null;
};

export type GroupFinanceSummaryReceipt = {
  amount: unknown;
  amount_currency?: string | null;
  payment_fee_amount?: unknown;
  base_amount?: unknown;
  base_currency?: string | null;
  payments?: unknown;
};

export type GroupFinanceSummaryOperatorPayment = {
  amount: unknown;
  currency?: string | null;
  base_amount?: unknown;
  base_currency?: string | null;
  service_refs?: number[] | null;
  payload?: unknown;
};

export type GroupFinanceSummaryOperatorDue = {
  amount: unknown;
  currency?: string | null;
  status?: string | null;
};

export type GroupFinanceSummaryInvoice = {
  total_amount: unknown;
  currency?: string | null;
  status?: string | null;
};

export type GroupFinanceSummaryPassengerSaleOverride = {
  travel_group_passenger_id: number;
  saleTotals: Record<string, number>;
};

export type GroupFinanceSummaryCurrencyTotal = {
  currency: string;
  assignedSale: number;
  collected: number;
  passengerBalance: number;
  passengerDebt: number;
  passengerCredit: number;
  assignedCost: number;
  operatorCost: number;
  estimatedTaxes: number;
  transferFees: number;
  adjustments: number;
  taxesAndFees: number;
  estimatedNetCommission: number;
  operatorPaid: number;
  operatorDebt: number;
  invoiced: number;
  invoicePending: number;
  collectionPct: number | null;
  operatorPaidPct: number | null;
  invoicedPct: number | null;
};

export type GroupFinanceSummaryServiceRow = {
  inventoryId: number;
  serviceRef: number;
  label: string;
  currency: string;
  assignedCount: number;
  assignedSale: number;
  assignedCost: number;
  estimatedTaxes: number;
  transferFees: number;
  estimatedMargin: number;
};

export type GroupFinanceSummaryResult = {
  currencies: GroupFinanceSummaryCurrencyTotal[];
  services: GroupFinanceSummaryServiceRow[];
};

export type BuildGroupFinanceSummaryArgs = {
  inventories: GroupFinanceSummaryInventory[];
  assignments: GroupFinanceSummaryAssignment[];
  receipts: GroupFinanceSummaryReceipt[];
  operatorPayments: GroupFinanceSummaryOperatorPayment[];
  operatorDues: GroupFinanceSummaryOperatorDue[];
  invoices: GroupFinanceSummaryInvoice[];
  passengerSaleOverrides?: GroupFinanceSummaryPassengerSaleOverride[];
  transferFeePct?: number | string | null;
  billingAdjustments?: BillingAdjustmentConfig[] | null;
};

type InventoryMetrics = {
  inventoryId: number;
  serviceRef: number;
  label: string;
  currency: string;
  totalQty: number;
  unitCost: number;
  saleUnit: number;
  saleTotal: number;
  costTotal: number;
  taxesTotal: number;
  transferFeeRate: number;
};

type MutableCurrencyTotal = Omit<
  GroupFinanceSummaryCurrencyTotal,
  | "passengerBalance"
  | "passengerDebt"
  | "passengerCredit"
  | "taxesAndFees"
  | "estimatedNetCommission"
  | "invoicePending"
  | "collectionPct"
  | "operatorPaidPct"
  | "invoicedPct"
>;

function makeMutableCurrencyTotal(currency: string): MutableCurrencyTotal {
  return {
    currency,
    assignedSale: 0,
    collected: 0,
    assignedCost: 0,
    operatorCost: 0,
    estimatedTaxes: 0,
    transferFees: 0,
    adjustments: 0,
    operatorPaid: 0,
    operatorDebt: 0,
    invoiced: 0,
  };
}

function addCurrencyAmount(
  target: Map<string, MutableCurrencyTotal>,
  currencyRaw: unknown,
  key: keyof Omit<MutableCurrencyTotal, "currency">,
  amountRaw: number,
) {
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || Math.abs(amount) <= MONEY_TOLERANCE) return;
  const currency = normalizeCurrencyCode(currencyRaw);
  const row = target.get(currency) ?? makeMutableCurrencyTotal(currency);
  row[key] = round2(Number(row[key] || 0) + amount);
  target.set(currency, row);
}

function pct(numerator: number, denominator: number): number | null {
  if (
    !Number.isFinite(denominator) ||
    Math.abs(denominator) <= MONEY_TOLERANCE
  ) {
    return null;
  }
  return round2((numerator / denominator) * 100);
}

function buildInventoryMetrics(
  inventory: GroupFinanceSummaryInventory,
  fallbackTransferFeeRate: number,
): InventoryMetrics {
  const meta = parseInventoryMeta(inventory.note);
  const totalQtyRaw = Number(inventory.total_qty ?? 0);
  const totalQty =
    Number.isFinite(totalQtyRaw) && totalQtyRaw > 0 ? totalQtyRaw : 0;
  const storedUnitCost = toAmountNumber(inventory.unit_cost);
  const costTotal =
    positiveMoneyOrNull(meta?.costTotalPrice) ??
    round2(storedUnitCost * Math.max(totalQty, 1));
  const unitCost = totalQty > 0 ? round2(costTotal / totalQty) : storedUnitCost;
  const saleUnit =
    resolveInventoryEstimatedSaleUnitPrice({
      total_qty: inventory.total_qty,
      note: inventory.note ?? null,
    }) ?? 0;
  const saleTotalFromMeta = positiveMoneyOrNull(meta?.saleTotalPrice);
  const saleTotal =
    String(meta?.pricingMode || "")
      .trim()
      .toUpperCase() === "VENTA_TOTAL" && saleTotalFromMeta != null
      ? saleTotalFromMeta
      : round2(saleUnit * Math.max(totalQty, 0));
  const taxesTotal = round2(
    toAmountNumber(meta?.taxable21) +
      toAmountNumber(meta?.taxable105) +
      toAmountNumber(meta?.exemptAmount) +
      toAmountNumber(meta?.otherTaxes),
  );
  return {
    inventoryId: inventory.id_travel_group_inventory,
    serviceRef: encodeInventoryServiceId(inventory.id_travel_group_inventory),
    label:
      String(inventory.label || "").trim() ||
      `Servicio grupal ${inventory.id_travel_group_inventory}`,
    currency: normalizeCurrencyCode(inventory.currency || "ARS"),
    totalQty,
    unitCost,
    saleUnit,
    saleTotal,
    costTotal,
    taxesTotal,
    transferFeeRate: normalizeFeeRate(
      meta?.transferFeePct as number | string | null | undefined,
      fallbackTransferFeeRate,
    ),
  };
}

function isCancelledStatus(status: unknown): boolean {
  const normalized = String(status || "")
    .trim()
    .toUpperCase();
  return [
    "CANCELADA",
    "CANCELADO",
    "CANCELLED",
    "CANCELED",
    "ANULADA",
  ].includes(normalized);
}

function sortedAssignments(
  assignments: GroupFinanceSummaryAssignment[],
): GroupFinanceSummaryAssignment[] {
  return [...assignments].sort((a, b) => {
    const aId = Number(a.id || 0);
    const bId = Number(b.id || 0);
    if (aId !== bId) return aId - bId;
    return a.travel_group_passenger_id - b.travel_group_passenger_id;
  });
}

export function buildGroupFinanceSummary(
  args: BuildGroupFinanceSummaryArgs,
): GroupFinanceSummaryResult {
  const transferFeeRate = normalizeFeeRate(args.transferFeePct, 0.024);
  const totals = new Map<string, MutableCurrencyTotal>();
  const serviceRows = new Map<string, GroupFinanceSummaryServiceRow>();
  const inventoryById = new Map<number, InventoryMetrics>();
  const assignedSaleByPassengerCurrency = new Map<string, number>();
  const transferFeesByPassengerCurrency = new Map<string, number>();

  for (const inventory of args.inventories) {
    const metrics = buildInventoryMetrics(inventory, transferFeeRate);
    inventoryById.set(metrics.inventoryId, metrics);
    addCurrencyAmount(
      totals,
      metrics.currency,
      "operatorCost",
      metrics.costTotal,
    );
  }

  const seenAssignmentKeys = new Set<string>();
  for (const assignment of sortedAssignments(args.assignments)) {
    if (isCancelledStatus(assignment.status)) continue;
    const inventoryId = decodeInventoryServiceId(
      Number(assignment.service_ref),
    );
    if (!inventoryId) continue;
    const inventory = inventoryById.get(inventoryId);
    if (!inventory) continue;

    const assignmentKey = `${assignment.travel_group_passenger_id}:${inventoryId}`;
    if (seenAssignmentKeys.has(assignmentKey)) continue;
    seenAssignmentKeys.add(assignmentKey);

    const assignmentCurrency = normalizeCurrencyCode(
      assignment.currency || inventory.currency,
    );
    const rawSale = toAmountNumber(assignment.amount);
    const assignedSale = rawSale >= 0 ? round2(rawSale) : inventory.saleUnit;
    const assignedCost = round2(inventory.unitCost);
    const taxRatio =
      inventory.saleTotal > MONEY_TOLERANCE
        ? assignedSale / inventory.saleTotal
        : inventory.totalQty > 0
          ? 1 / inventory.totalQty
          : 0;
    const estimatedTaxes = round2(Math.max(0, inventory.taxesTotal * taxRatio));
    const transferFees = round2(assignedSale * inventory.transferFeeRate);
    const estimatedMargin = round2(
      assignedSale - assignedCost - estimatedTaxes - transferFees,
    );

    addCurrencyAmount(totals, assignmentCurrency, "assignedSale", assignedSale);
    const passengerCurrencyKey = `${assignment.travel_group_passenger_id}:${assignmentCurrency}`;
    assignedSaleByPassengerCurrency.set(
      passengerCurrencyKey,
      round2(
        (assignedSaleByPassengerCurrency.get(passengerCurrencyKey) ?? 0) +
          assignedSale,
      ),
    );
    transferFeesByPassengerCurrency.set(
      passengerCurrencyKey,
      round2(
        (transferFeesByPassengerCurrency.get(passengerCurrencyKey) ?? 0) +
          transferFees,
      ),
    );
    addCurrencyAmount(totals, assignmentCurrency, "assignedCost", assignedCost);
    addCurrencyAmount(
      totals,
      assignmentCurrency,
      "estimatedTaxes",
      estimatedTaxes,
    );
    addCurrencyAmount(totals, assignmentCurrency, "transferFees", transferFees);

    const serviceKey = `${inventoryId}:${assignmentCurrency}`;
    const serviceRow = serviceRows.get(serviceKey) ?? {
      inventoryId,
      serviceRef: inventory.serviceRef,
      label: inventory.label,
      currency: assignmentCurrency,
      assignedCount: 0,
      assignedSale: 0,
      assignedCost: 0,
      estimatedTaxes: 0,
      transferFees: 0,
      estimatedMargin: 0,
    };
    serviceRow.assignedCount += 1;
    serviceRow.assignedSale = round2(serviceRow.assignedSale + assignedSale);
    serviceRow.assignedCost = round2(serviceRow.assignedCost + assignedCost);
    serviceRow.estimatedTaxes = round2(
      serviceRow.estimatedTaxes + estimatedTaxes,
    );
    serviceRow.transferFees = round2(serviceRow.transferFees + transferFees);
    serviceRow.estimatedMargin = round2(
      serviceRow.estimatedMargin + estimatedMargin,
    );
    serviceRows.set(serviceKey, serviceRow);
  }

  for (const override of args.passengerSaleOverrides ?? []) {
    const passengerPrefix = `${override.travel_group_passenger_id}:`;
    const currencies = new Set(
      Object.keys(override.saleTotals).map(normalizeCurrencyCode),
    );
    for (const key of assignedSaleByPassengerCurrency.keys()) {
      if (!key.startsWith(passengerPrefix)) continue;
      currencies.add(key.slice(passengerPrefix.length));
    }
    for (const currency of currencies) {
      const automaticSale =
        assignedSaleByPassengerCurrency.get(
          `${override.travel_group_passenger_id}:${currency}`,
        ) ?? 0;
      const overriddenSale = round2(
        Math.max(0, toAmountNumber(override.saleTotals[currency])),
      );
      const saleDelta = round2(overriddenSale - automaticSale);
      const automaticTransferFees =
        transferFeesByPassengerCurrency.get(
          `${override.travel_group_passenger_id}:${currency}`,
        ) ?? 0;
      const overriddenTransferFees = round2(overriddenSale * transferFeeRate);
      addCurrencyAmount(totals, currency, "assignedSale", saleDelta);
      addCurrencyAmount(
        totals,
        currency,
        "transferFees",
        round2(overriddenTransferFees - automaticTransferFees),
      );
    }
  }

  const collectedByCurrency: Record<string, number> = {};
  for (const receipt of args.receipts) {
    addGroupReceiptToPaidByCurrency(collectedByCurrency, {
      service_refs: null,
      amount: receipt.amount,
      amount_currency: receipt.amount_currency || "ARS",
      payment_fee_amount: receipt.payment_fee_amount,
      base_amount: receipt.base_amount,
      base_currency: receipt.base_currency || null,
      payments: receipt.payments,
    });
  }
  for (const [currency, amount] of Object.entries(collectedByCurrency)) {
    addCurrencyAmount(totals, currency, "collected", amount);
  }

  for (const payment of args.operatorPayments) {
    const allocations = parseGroupOperatorPaymentAllocations(
      payment.payload &&
        typeof payment.payload === "object" &&
        !Array.isArray(payment.payload)
        ? (payment.payload as Record<string, unknown>).allocations
        : undefined,
    );
    const usableAllocations = allocations.filter(
      (allocation) => allocation.amount_service > MONEY_TOLERANCE,
    );
    if (usableAllocations.length > 0) {
      for (const allocation of usableAllocations) {
        addCurrencyAmount(
          totals,
          allocation.service_currency || payment.currency || "ARS",
          "operatorPaid",
          allocation.amount_service,
        );
      }
      continue;
    }

    const baseCurrency = payment.base_currency
      ? normalizeCurrencyCode(payment.base_currency)
      : null;
    const baseAmount = toAmountNumber(payment.base_amount);
    if (baseCurrency && baseAmount > MONEY_TOLERANCE) {
      addCurrencyAmount(totals, baseCurrency, "operatorPaid", baseAmount);
    } else {
      addCurrencyAmount(
        totals,
        payment.currency || "ARS",
        "operatorPaid",
        toAmountNumber(payment.amount),
      );
    }
  }

  for (const invoice of args.invoices) {
    if (isCancelledStatus(invoice.status)) continue;
    addCurrencyAmount(
      totals,
      invoice.currency || "ARS",
      "invoiced",
      toAmountNumber(invoice.total_amount),
    );
  }

  const billingAdjustments = Array.isArray(args.billingAdjustments)
    ? args.billingAdjustments
    : [];
  for (const total of totals.values()) {
    const computed = computeBillingAdjustments(
      billingAdjustments,
      total.assignedSale,
      total.assignedCost,
    );
    total.adjustments = round2(computed.total);
  }

  const currencies = Array.from(totals.values())
    .map<GroupFinanceSummaryCurrencyTotal>((total) => {
      const passengerBalance = round2(total.assignedSale - total.collected);
      const invoicePending = round2(total.assignedSale - total.invoiced);
      const taxesAndFees = round2(
        total.estimatedTaxes + total.transferFees + total.adjustments,
      );
      const estimatedNetCommission = round2(
        total.assignedSale -
          total.assignedCost -
          total.estimatedTaxes -
          total.transferFees -
          total.adjustments,
      );
      const operatorDebt = round2(
        Math.max(0, total.operatorCost - total.operatorPaid),
      );
      const operatorReference = Math.max(
        total.operatorCost,
        total.operatorPaid,
      );
      return {
        ...total,
        assignedSale: round2(total.assignedSale),
        collected: round2(total.collected),
        passengerBalance,
        passengerDebt: round2(Math.max(0, passengerBalance)),
        passengerCredit: round2(Math.max(0, -passengerBalance)),
        assignedCost: round2(total.assignedCost),
        operatorCost: round2(total.operatorCost),
        estimatedTaxes: round2(total.estimatedTaxes),
        transferFees: round2(total.transferFees),
        adjustments: round2(total.adjustments),
        taxesAndFees,
        estimatedNetCommission,
        operatorPaid: round2(total.operatorPaid),
        operatorDebt,
        invoiced: round2(total.invoiced),
        invoicePending,
        collectionPct: pct(total.collected, total.assignedSale),
        operatorPaidPct: pct(total.operatorPaid, operatorReference),
        invoicedPct: pct(total.invoiced, total.assignedSale),
      };
    })
    .filter((row) =>
      [
        row.assignedSale,
        row.collected,
        row.assignedCost,
        row.operatorCost,
        row.operatorPaid,
        row.operatorDebt,
        row.invoiced,
      ].some((value) => Math.abs(value) > MONEY_TOLERANCE),
    )
    .sort((a, b) => a.currency.localeCompare(b.currency, "es"));

  return {
    currencies,
    services: Array.from(serviceRows.values()).sort((a, b) => {
      const cur = a.currency.localeCompare(b.currency, "es");
      if (cur !== 0) return cur;
      return a.label.localeCompare(b.label, "es");
    }),
  };
}
