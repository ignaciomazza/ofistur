// src/components/receipts/ReceiptForm.tsx
"use client";

import React, {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import Spinner from "@/components/Spinner";
import { toast } from "react-toastify";
import type { Client } from "@/types";
import { authFetch } from "@/utils/authFetch";

import type {
  AttachableReceiptOption,
  BookingOption,
  CurrencyCode,
  ReceiptPayload,
  ServiceLite,
  FinanceAccount,
  FinanceCurrency,
  FinancePaymentMethod,
  SubmitResult,
  ReceiptPaymentFeeMode,
  ReceiptPaymentLine,
  ReceiptServiceAllocationLine,
} from "@/types/receipts";

import {
  asArray,
  parseAmountInput,
  resolveReceiptIdFrom,
} from "@/utils/receipts/receiptForm";
import { filterAccountsByCurrency } from "@/utils/receipts/accounts";
import {
  decodeReceiptPdfItemsPayload,
  encodeReceiptPdfItemsPayload,
  normalizeReceiptPdfManualItems,
} from "@/utils/receipts/pdfItemsPayload";
import {
  type ReceiptServiceSelectionMode,
  normalizeReceiptServiceSelectionMode,
} from "@/utils/receiptServiceSelection";

import { useFinancePicks } from "@/hooks/receipts/useFinancePicks";
import { useBookingSearch } from "@/hooks/receipts/useBookingSearch";
import { useServicesForBooking } from "@/hooks/receipts/useServicesForBooking";
import { useReceiptSearch } from "@/hooks/receipts/useReceiptSearch";

import {
  createCreditEntryForReceipt,
  createFinanceEntryForReceipt,
  createClientCreditEntryForReceipt,
} from "@/services/receipts/entries";
import { attachExistingReceipt } from "@/services/receipts/attach";

import ReceiptHeader from "@/components/receipts/receipt-form/ReceiptHeader";
import ContextSection from "@/components/receipts/receipt-form/ContextSection";
import AttachReceiptSection from "@/components/receipts/receipt-form/AttachReceiptSection";
import CreateReceiptFields from "@/components/receipts/receipt-form/CreateReceiptFields";

type Mode = "agency" | "booking";

const OPERATOR_CREDIT_METHOD_LABEL = "Crédito/corriente operador";
const CLIENT_CREDIT_METHOD_LABEL = "Crédito/corriente cliente";
const VIRTUAL_OPERATOR_CREDIT_METHOD_ID = 999_000_000;
const VIRTUAL_CLIENT_CREDIT_METHOD_ID = 999_000_001;

const normalizeMethodName = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

const OPERATOR_CREDIT_METHOD_ALIASES = new Set([
  "credito operador",
  "credito/corriente operador",
  "cuenta corriente operador",
]);

const isOperatorCreditMethodName = (value: string) =>
  OPERATOR_CREDIT_METHOD_ALIASES.has(normalizeMethodName(value));

const CLIENT_CREDIT_METHOD_ALIASES = new Set([
  "credito cliente",
  "credito/corriente cliente",
  "cuenta corriente cliente",
  "credito pax",
  "credito/corriente pax",
  "cuenta corriente pax",
]);

const isClientCreditMethodName = (value: string) =>
  CLIENT_CREDIT_METHOD_ALIASES.has(normalizeMethodName(value));

// 👇 Cambiá esto si tu endpoint es otro
const CREDIT_ACCOUNTS_ENDPOINT = "/api/credit/account";

type CreditAccountOption = {
  id_credit_account: number;
  name: string;
  currency?: string; // "ARS" | "USD" ...
  enabled?: boolean;
  operator_id?: number;
  client_id?: number;
};

type OperatorLite = {
  id_operator: number;
  name: string;
};

type PaymentDraft = {
  key: string;
  amount: string;
  payment_method_id: number | null;
  account_id: number | null;
  payment_currency: string;
  fee_mode: "NONE" | ReceiptPaymentFeeMode;
  fee_value: string;

  // crédito operador
  operator_id: number | null;
  client_id: number | null;
  client_credit_mode: "DEBIT" | "CREDIT";

  // ✅ cuenta crédito (CreditAccount)
  credit_account_id: number | null;
};

type ReceiptForDebt = {
  amount?: number | string | null;
  amount_currency?: string | null;
  base_amount?: number | string | null;
  base_currency?: string | null;
  payment_fee_amount?: number | string | null;
  payment_fee_currency?: string | null;
  serviceIds?: number[] | null;
  service_allocations?: Array<{
    service_id?: number | string | null;
    amount_service?: number | string | null;
    service_currency?: string | null;
    amount_payment?: number | string | null;
    payment_currency?: string | null;
    fx_rate?: number | string | null;
  }> | null;
  payments?: Array<{
    amount?: number | string | null;
    payment_currency?: string | null;
    fee_amount?: number | string | null;
  }> | null;
};

type InitialReceiptServiceAllocation = {
  service_id: number;
  amount_service: number | string;
  service_currency?: string | null;
  amount_payment?: number | string | null;
  payment_currency?: string | null;
  fx_rate?: number | string | null;
};

type ServiceAllocationPresetMode = "manual" | "split_payment" | "use_costs";
type ManualPdfItemDraft = {
  key: string;
  description: string;
  date_label: string;
};

const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const pad2 = (n: number) => String(n).padStart(2, "0");
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const toInputDate = (value?: string | null) => {
  if (!value) return "";
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DEBT_TOLERANCE = 0.01;

const normalizeCurrencyCodeLoose = (raw: string | null | undefined): string => {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return "ARS";
  const map: Record<string, string> = {
    U$D: "USD",
    U$S: "USD",
    US$: "USD",
    USD$: "USD",
    AR$: "ARS",
    $: "ARS",
  };
  return map[s] || s;
};
const normalizeOptionalCurrencyCodeLoose = (
  raw: string | null | undefined,
): string => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  return normalizeCurrencyCodeLoose(trimmed);
};

const toNumberLoose = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = parseAmountInput(value);
    if (parsed != null && Number.isFinite(parsed)) return parsed;
    const numeric = Number(value.replace(",", "."));
    return Number.isFinite(numeric) ? numeric : 0;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const addReceiptToPaidByCurrency = (
  target: Record<string, number>,
  receipt: ReceiptForDebt,
  options?: { selectedServiceIds?: Set<number> },
) => {
  const selectedServiceIds = options?.selectedServiceIds;
  const rawAllocations = Array.isArray(receipt.service_allocations)
    ? receipt.service_allocations
    : [];
  if (selectedServiceIds && rawAllocations.length > 0) {
    let appliedAllocation = false;
    for (const alloc of rawAllocations) {
      const serviceId = Number(alloc?.service_id);
      if (!Number.isFinite(serviceId) || serviceId <= 0) continue;
      if (!selectedServiceIds.has(Math.trunc(serviceId))) continue;
      const amount = toNumberLoose(alloc?.amount_service ?? 0);
      if (Math.abs(amount) <= DEBT_TOLERANCE) continue;
      appliedAllocation = true;
      const currency = normalizeCurrencyCodeLoose(
        alloc?.service_currency || "ARS",
      );
      target[currency] = round2((target[currency] || 0) + amount);
    }
    if (appliedAllocation) return;
  }

  const amountCurrency = normalizeCurrencyCodeLoose(
    receipt.amount_currency || "ARS",
  );
  const amountValue = toNumberLoose(receipt.amount ?? 0);
  const feeValue = toNumberLoose(receipt.payment_fee_amount ?? 0);
  const baseValue = toNumberLoose(receipt.base_amount ?? 0);
  const baseCurrency = receipt.base_currency
    ? normalizeCurrencyCodeLoose(receipt.base_currency)
    : null;
  const paymentLines = Array.isArray(receipt.payments) ? receipt.payments : [];

  if (baseCurrency && Math.abs(baseValue) > DEBT_TOLERANCE) {
    const lineFeeTotal = paymentLines.reduce(
      (sum, line) => sum + toNumberLoose(line?.fee_amount ?? 0),
      0,
    );
    const feeRemainder = feeValue - lineFeeTotal;
    const feeInBase =
      (paymentLines.length > 0
        ? paymentLines.reduce((sum, line) => {
            const lineCurrency = normalizeCurrencyCodeLoose(
              line?.payment_currency || amountCurrency,
            );
            if (lineCurrency !== baseCurrency) return sum;
            return sum + toNumberLoose(line?.fee_amount ?? 0);
          }, 0)
        : amountCurrency === baseCurrency
          ? feeValue
          : 0) +
      (Math.abs(feeRemainder) > DEBT_TOLERANCE &&
      amountCurrency === baseCurrency
        ? feeRemainder
        : 0);
    const credited = baseValue + feeInBase;
    if (Math.abs(credited) <= DEBT_TOLERANCE) return;
    target[baseCurrency] = round2((target[baseCurrency] || 0) + credited);
    return;
  }

  if (paymentLines.length > 0) {
    let lineFeeTotal = 0;
    for (const line of paymentLines) {
      const lineCurrency = normalizeCurrencyCodeLoose(
        line?.payment_currency || amountCurrency,
      );
      const lineAmount = toNumberLoose(line?.amount ?? 0);
      const lineFee = toNumberLoose(line?.fee_amount ?? 0);
      lineFeeTotal += lineFee;
      const credited = lineAmount + lineFee;
      if (Math.abs(credited) <= DEBT_TOLERANCE) continue;
      target[lineCurrency] = round2((target[lineCurrency] || 0) + credited);
    }
    const feeRemainder = feeValue - lineFeeTotal;
    if (Math.abs(feeRemainder) > DEBT_TOLERANCE) {
      target[amountCurrency] = round2(
        (target[amountCurrency] || 0) + feeRemainder,
      );
    }
    return;
  }

  const credited = amountValue + feeValue;
  if (Math.abs(credited) <= DEBT_TOLERANCE) return;
  target[amountCurrency] = round2((target[amountCurrency] || 0) + credited);
};

const buildServiceAllocationAvailabilityByCurrency = (
  receipt: ReceiptForDebt,
) => {
  const out: Record<string, number> = {};

  const amountCurrency = normalizeCurrencyCodeLoose(
    receipt.amount_currency || "ARS",
  );
  const feeValue = toNumberLoose(receipt.payment_fee_amount ?? 0);
  const baseValue = toNumberLoose(receipt.base_amount ?? 0);
  const baseCurrency = receipt.base_currency
    ? normalizeCurrencyCodeLoose(receipt.base_currency)
    : null;
  const paymentLines = Array.isArray(receipt.payments) ? receipt.payments : [];

  if (paymentLines.length > 0) {
    let lineFeeTotal = 0;
    for (const line of paymentLines) {
      const lineCurrency = normalizeCurrencyCodeLoose(
        line?.payment_currency || amountCurrency,
      );
      const lineAmount = toNumberLoose(line?.amount ?? 0);
      const lineFee = toNumberLoose(line?.fee_amount ?? 0);
      lineFeeTotal += lineFee;
      const credited = lineAmount + lineFee;
      if (Math.abs(credited) <= DEBT_TOLERANCE) continue;
      out[lineCurrency] = round2((out[lineCurrency] || 0) + credited);
    }

    const feeRemainder = feeValue - lineFeeTotal;
    if (Math.abs(feeRemainder) > DEBT_TOLERANCE) {
      out[amountCurrency] = round2((out[amountCurrency] || 0) + feeRemainder);
    }

    // Si no hay pagos directos en moneda base, permitimos usar la conversión base.
    if (baseCurrency && Math.abs(baseValue) > DEBT_TOLERANCE) {
      const hasDirectBase = Math.abs(out[baseCurrency] || 0) > DEBT_TOLERANCE;
      if (!hasDirectBase) {
        const feeInBaseFromLines = paymentLines.reduce((sum, line) => {
          const lineCurrency = normalizeCurrencyCodeLoose(
            line?.payment_currency || amountCurrency,
          );
          if (lineCurrency !== baseCurrency) return sum;
          return sum + toNumberLoose(line?.fee_amount ?? 0);
        }, 0);
        const feeInBaseWithRemainder =
          feeInBaseFromLines +
          (Math.abs(feeRemainder) > DEBT_TOLERANCE &&
          amountCurrency === baseCurrency
            ? feeRemainder
            : 0);
        const converted = baseValue + feeInBaseWithRemainder;
        if (Math.abs(converted) > DEBT_TOLERANCE) {
          out[baseCurrency] = round2(
            Math.max(out[baseCurrency] || 0, converted),
          );
        }
      }
    }

    return out;
  }

  if (baseCurrency && Math.abs(baseValue) > DEBT_TOLERANCE) {
    const feeInBase = amountCurrency === baseCurrency ? feeValue : 0;
    const credited = baseValue + feeInBase;
    if (Math.abs(credited) > DEBT_TOLERANCE) {
      out[baseCurrency] = round2((out[baseCurrency] || 0) + credited);
    }
    return out;
  }

  const amountValue = toNumberLoose(receipt.amount ?? 0);
  const credited = amountValue + feeValue;
  if (Math.abs(credited) > DEBT_TOLERANCE) {
    out[amountCurrency] = round2((out[amountCurrency] || 0) + credited);
  }
  return out;
};

const normalizeIdListLoose = (input: unknown): number[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of input) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    const id = Math.trunc(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

const addUnallocatedReceiptPaidByCurrencyForSelection = (args: {
  target: Record<string, number>;
  receipt: ReceiptForDebt;
  selectedServiceIds: Set<number>;
  allServiceIds: number[];
  serviceCurrencyById: Map<number, string>;
  serviceWeightById: Map<number, number>;
}) => {
  const rawScopeIds = normalizeIdListLoose(args.receipt.serviceIds);
  const validScopedIds = rawScopeIds.filter((id) =>
    args.serviceCurrencyById.has(id),
  );
  const scopeIds =
    validScopedIds.length > 0
      ? validScopedIds
      : args.allServiceIds.filter((id) => args.serviceCurrencyById.has(id));
  if (!scopeIds.length) return;

  const selectedScopeIds = scopeIds.filter((id) =>
    args.selectedServiceIds.has(id),
  );
  if (!selectedScopeIds.length) return;

  const fullPaidByCurrency: Record<string, number> = {};
  addReceiptToPaidByCurrency(fullPaidByCurrency, args.receipt);

  const sumWeight = (ids: number[]) =>
    ids.reduce(
      (sum, id) => sum + Math.max(0, args.serviceWeightById.get(id) || 0),
      0,
    );

  for (const [currencyRaw, amountRaw] of Object.entries(fullPaidByCurrency)) {
    const currency = normalizeCurrencyCodeLoose(currencyRaw || "ARS");
    const amount = toNumberLoose(amountRaw);
    if (!Number.isFinite(amount) || Math.abs(amount) <= DEBT_TOLERANCE)
      continue;

    const scopeIdsForCurrency = scopeIds.filter(
      (id) => args.serviceCurrencyById.get(id) === currency,
    );
    const selectedIdsForCurrency = selectedScopeIds.filter(
      (id) => args.serviceCurrencyById.get(id) === currency,
    );

    let ratio = 0;
    const totalWeightForCurrency = sumWeight(scopeIdsForCurrency);
    const selectedWeightForCurrency = sumWeight(selectedIdsForCurrency);
    if (
      totalWeightForCurrency > DEBT_TOLERANCE &&
      selectedWeightForCurrency > DEBT_TOLERANCE
    ) {
      ratio = selectedWeightForCurrency / totalWeightForCurrency;
    } else if (
      scopeIdsForCurrency.length > 0 &&
      selectedIdsForCurrency.length > 0
    ) {
      ratio = selectedIdsForCurrency.length / scopeIdsForCurrency.length;
    } else {
      const totalWeight = sumWeight(scopeIds);
      const selectedWeight = sumWeight(selectedScopeIds);
      if (totalWeight > DEBT_TOLERANCE && selectedWeight > DEBT_TOLERANCE) {
        ratio = selectedWeight / totalWeight;
      } else {
        ratio = selectedScopeIds.length / scopeIds.length;
      }
    }

    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const proratedAmount = round2(amount * ratio);
    if (Math.abs(proratedAmount) <= DEBT_TOLERANCE) continue;
    args.target[currency] = round2(
      (args.target[currency] || 0) + proratedAmount,
    );
  }
};

const calcPaymentLineFee = (line: {
  amount: string;
  fee_mode: "NONE" | ReceiptPaymentFeeMode;
  fee_value: string;
}) => {
  const amount = parseAmountInput(line.amount) ?? 0;
  const rawFeeValue = parseAmountInput(line.fee_value) ?? 0;
  if (line.fee_mode === "NONE") return 0;
  if (line.fee_mode === "PERCENT") {
    return round2(Math.max(0, amount) * (Math.max(0, rawFeeValue) / 100));
  }
  return round2(Math.max(0, rawFeeValue));
};

const formatCurrencyMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const formatCurrencyBreakdown = (totals: Record<string, number>) => {
  const parts = Object.entries(totals)
    .filter(([, value]) => Math.abs(value) > 0.000001)
    .map(([currency, value]) =>
      formatCurrencyMoney(round2(value), normalizeCurrencyCodeLoose(currency)),
    );
  return parts.length ? parts.join(" + ") : "";
};

const normalizeSaleTotalsLoose = (input: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const obj = input as Record<string, unknown>;
  for (const [keyRaw, val] of Object.entries(obj)) {
    const key = normalizeCurrencyCodeLoose(keyRaw);
    const n =
      typeof val === "number"
        ? val
        : Number(String(val ?? "").replace(",", "."));
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
};

export interface ReceiptFormProps {
  token: string | null;

  editingReceiptId?: number | null;
  isFormVisible?: boolean;
  setIsFormVisible?: React.Dispatch<React.SetStateAction<boolean>>;

  bookingId?: number;
  bookingDisplayId?: number;
  allowAgency?: boolean;

  searchBookings?: (q: string) => Promise<BookingOption[]>;
  loadServicesForBooking?: (bookingId: number) => Promise<ServiceLite[]>;

  initialServiceIds?: number[];
  initialConcept?: string;
  initialAmount?: number;
  initialAmountWords?: string;
  initialAmountWordsCurrency?: CurrencyCode;
  initialPaymentDescription?: string;
  initialFeeAmount?: number;
  initialIssueDate?: string | null;
  initialBaseAmount?: number | string | null;
  initialBaseCurrency?: CurrencyCode | string | null;
  initialCounterAmount?: number | string | null;
  initialCounterCurrency?: CurrencyCode | string | null;
  initialCurrency?: CurrencyCode;
  initialPaymentMethodId?: number | null;
  initialFinanceAccountId?: number | null;
  initialClientIds?: number[];
  initialPayments?: ReceiptPaymentLine[];
  initialServiceAllocations?: InitialReceiptServiceAllocation[];

  onSubmit: (payload: ReceiptPayload) => Promise<SubmitResult> | SubmitResult;
  onCancel?: () => void;

  enableAttachAction?: boolean;
  searchReceipts?: (q: string) => Promise<AttachableReceiptOption[]>;
  onAttachExisting?: (args: {
    id_receipt: number;
    bookingId: number;
    serviceIds: number[];
  }) => Promise<void> | void;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

type ClientCreditExcessResult = {
  clientId: number;
  byCurrency: Record<string, number>;
};

function extractClientCreditExcess(
  value: unknown,
): ClientCreditExcessResult | null {
  if (!isRecord(value)) return null;

  const direct = isRecord(value.client_credit_excess)
    ? value.client_credit_excess
    : null;
  const nested =
    isRecord(value.data) && isRecord(value.data.client_credit_excess)
      ? value.data.client_credit_excess
      : null;
  const source = direct || nested;
  if (!source) return null;

  const clientId = Number(source.client_id);
  if (!Number.isFinite(clientId) || clientId <= 0) return null;

  const rawByCurrency = isRecord(source.by_currency)
    ? source.by_currency
    : null;
  if (!rawByCurrency) return null;

  const byCurrency: Record<string, number> = {};
  for (const [currencyRaw, amountRaw] of Object.entries(rawByCurrency)) {
    const currency = normalizeCurrencyCodeLoose(currencyRaw);
    const amount =
      typeof amountRaw === "number"
        ? amountRaw
        : Number(String(amountRaw ?? "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    byCurrency[currency] = round2(amount);
  }

  if (!Object.keys(byCurrency).length) return null;
  return { clientId, byCurrency };
}

export default function ReceiptForm({
  token,
  editingReceiptId = null,
  isFormVisible,
  setIsFormVisible,
  bookingId,
  bookingDisplayId,
  allowAgency = true,
  searchBookings,
  loadServicesForBooking,
  initialServiceIds = [],
  initialConcept = "",
  initialAmount,
  initialAmountWords = "",
  initialPaymentDescription = "",
  initialFeeAmount,
  initialIssueDate = null,
  initialBaseAmount = null,
  initialBaseCurrency = null,
  initialCounterAmount = null,
  initialCounterCurrency = null,
  initialCurrency,
  initialPaymentMethodId = null,
  initialFinanceAccountId = null,
  initialClientIds = [],
  initialPayments = [],
  initialServiceAllocations = [],
  onSubmit,
  onCancel,
  enableAttachAction = false,
  searchReceipts,
  onAttachExisting,
}: ReceiptFormProps) {
  /* ===== Visibilidad ===== */
  const [internalVisible, setInternalVisible] = useState(false);
  const visible = isFormVisible ?? internalVisible;
  const setVisible = (v: boolean) =>
    setIsFormVisible ? setIsFormVisible(v) : setInternalVisible(v);

  /* ===== Acción ===== */
  const [action, setAction] = useState<"create" | "attach">("create");
  const attachEnabled = !!enableAttachAction;

  /* ===== Picks ===== */
  const {
    loading: loadingPicks,
    paymentMethods,
    accounts,
    currencies,
  } = useFinancePicks(token);

  const paymentMethodsTyped: FinancePaymentMethod[] = paymentMethods;
  const accountsTyped: FinanceAccount[] = accounts;
  const currenciesTyped: FinanceCurrency[] = currencies;

  /* ===== Crédito/corriente: métodos reales o virtuales ===== */
  const operatorCreditMethodId = useMemo(() => {
    const m = paymentMethodsTyped.find((pm) =>
      isOperatorCreditMethodName(pm.name || ""),
    );
    return m?.id_method ?? VIRTUAL_OPERATOR_CREDIT_METHOD_ID;
  }, [paymentMethodsTyped]);

  const clientCreditMethodId = useMemo(() => {
    const m = paymentMethodsTyped.find((pm) =>
      isClientCreditMethodName(pm.name || ""),
    );
    return m?.id_method ?? VIRTUAL_CLIENT_CREDIT_METHOD_ID;
  }, [paymentMethodsTyped]);

  const paymentMethodsUi = useMemo(() => {
    const hasOperatorCreditInDb = paymentMethodsTyped.some((pm) =>
      isOperatorCreditMethodName(pm.name || ""),
    );
    const hasClientCreditInDb = paymentMethodsTyped.some((pm) =>
      isClientCreditMethodName(pm.name || ""),
    );

    if (hasOperatorCreditInDb && hasClientCreditInDb)
      return paymentMethodsTyped;

    const virtualMethods: FinancePaymentMethod[] = [];
    if (!hasOperatorCreditInDb) {
      virtualMethods.push({
        id_method: VIRTUAL_OPERATOR_CREDIT_METHOD_ID,
        name: OPERATOR_CREDIT_METHOD_LABEL,
        requires_account: false,
        enabled: true,
      });
    }
    if (!hasClientCreditInDb) {
      virtualMethods.push({
        id_method: VIRTUAL_CLIENT_CREDIT_METHOD_ID,
        name: CLIENT_CREDIT_METHOD_LABEL,
        requires_account: false,
        enabled: true,
      });
    }

    return [...virtualMethods, ...paymentMethodsTyped];
  }, [paymentMethodsTyped]);

  const isOperatorCreditPayment = useCallback(
    (methodId: number | null | undefined) =>
      methodId != null &&
      Number.isFinite(Number(methodId)) &&
      Number(methodId) === Number(operatorCreditMethodId),
    [operatorCreditMethodId],
  );

  const isClientCreditPayment = useCallback(
    (methodId: number | null | undefined) =>
      methodId != null &&
      Number.isFinite(Number(methodId)) &&
      Number(methodId) === Number(clientCreditMethodId),
    [clientCreditMethodId],
  );

  const isAnyCreditPayment = useCallback(
    (methodId: number | null | undefined) =>
      isOperatorCreditPayment(methodId) || isClientCreditPayment(methodId),
    [isOperatorCreditPayment, isClientCreditPayment],
  );

  /* ===== Mode ===== */
  const forcedBookingMode = !!bookingId;
  const [mode, setMode] = useState<Mode>(
    forcedBookingMode ? "booking" : "agency",
  );

  useEffect(() => {
    if (forcedBookingMode) setMode("booking");
  }, [forcedBookingMode]);

  useEffect(() => {
    if (action === "attach") setMode("booking");
  }, [action]);

  const canToggleAgency =
    !forcedBookingMode && allowAgency && action !== "attach";

  /* ===== Booking ===== */
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(
    bookingId ?? null,
  );

  useEffect(() => {
    const nextBookingId =
      typeof bookingId === "number" &&
      Number.isFinite(bookingId) &&
      bookingId > 0
        ? bookingId
        : null;
    if (nextBookingId == null) return;
    setSelectedBookingId((prev) =>
      prev === nextBookingId ? prev : nextBookingId,
    );
  }, [bookingId]);

  const bookingSearchEnabled = !forcedBookingMode && mode === "booking";
  const { bookingQuery, setBookingQuery, bookingOptions, loadingBookings } =
    useBookingSearch({
      token,
      enabled: bookingSearchEnabled,
      searchBookings,
    });

  /* ===== Services ===== */
  const { services, loadingServices } = useServicesForBooking({
    bookingId: selectedBookingId,
    loadServicesForBooking,
  });

  const [selectedServiceIds, setSelectedServiceIds] =
    useState<number[]>(initialServiceIds);
  const [receiptServiceSelectionMode, setReceiptServiceSelectionMode] =
    useState<ReceiptServiceSelectionMode>("required");

  useEffect(() => {
    setSelectedServiceIds((prev) =>
      prev.filter((id) => services.some((s) => s.id_service === id)),
    );
  }, [services]);

  const allBookingServiceIds = useMemo(
    () => services.map((s) => s.id_service),
    [services],
  );
  const allBookingServiceIdSet = useMemo(
    () => new Set(allBookingServiceIds),
    [allBookingServiceIds],
  );

  const serviceIdsForContext = useMemo(() => {
    if (mode !== "booking" || !selectedBookingId) return selectedServiceIds;
    if (receiptServiceSelectionMode === "booking") return allBookingServiceIds;
    if (selectedServiceIds.length > 0) return selectedServiceIds;
    if (receiptServiceSelectionMode === "optional") return allBookingServiceIds;
    return selectedServiceIds;
  }, [
    mode,
    selectedBookingId,
    receiptServiceSelectionMode,
    selectedServiceIds,
    allBookingServiceIds,
  ]);
  const hideContextSection =
    receiptServiceSelectionMode === "booking" &&
    forcedBookingMode &&
    mode === "booking" &&
    action !== "create";

  const userSelectedServices = useMemo(
    () => services.filter((s) => selectedServiceIds.includes(s.id_service)),
    [services, selectedServiceIds],
  );

  const selectedServices = useMemo(
    () => services.filter((s) => serviceIdsForContext.includes(s.id_service)),
    [services, serviceIdsForContext],
  );
  const allocationServices = useMemo(() => {
    if (mode !== "booking") return [] as ServiceLite[];
    if (receiptServiceSelectionMode === "booking") return selectedServices;
    return userSelectedServices;
  }, [
    mode,
    receiptServiceSelectionMode,
    selectedServices,
    userSelectedServices,
  ]);
  const [manualServiceAllocationsEnabled, setManualServiceAllocationsEnabled] =
    useState(
      Array.isArray(initialServiceAllocations) &&
        initialServiceAllocations.length > 0,
    );
  const [serviceAllocationAmountsById, setServiceAllocationAmountsById] =
    useState<Record<number, string>>(() => {
      const out: Record<number, string> = {};
      for (const alloc of initialServiceAllocations || []) {
        const serviceId = Number(alloc?.service_id);
        const amountRaw = Number(alloc?.amount_service ?? 0);
        if (!Number.isFinite(serviceId) || serviceId <= 0) continue;
        if (!Number.isFinite(amountRaw) || amountRaw <= 0) continue;
        out[Math.trunc(serviceId)] = String(amountRaw);
      }
      return out;
    });
  const [
    serviceAllocationPaymentAmountsById,
    setServiceAllocationPaymentAmountsById,
  ] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const alloc of initialServiceAllocations || []) {
      const serviceId = Number(alloc?.service_id);
      const amountRaw = Number(alloc?.amount_payment ?? 0);
      if (!Number.isFinite(serviceId) || serviceId <= 0) continue;
      if (!Number.isFinite(amountRaw) || amountRaw <= 0) continue;
      out[Math.trunc(serviceId)] = String(amountRaw);
    }
    return out;
  });
  const [
    serviceAllocationPaymentCurrencyById,
    setServiceAllocationPaymentCurrencyById,
  ] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const alloc of initialServiceAllocations || []) {
      const serviceId = Number(alloc?.service_id);
      const paymentCurrency = normalizeOptionalCurrencyCodeLoose(
        alloc?.payment_currency || "",
      );
      if (!Number.isFinite(serviceId) || serviceId <= 0) continue;
      if (!paymentCurrency) continue;
      out[Math.trunc(serviceId)] = paymentCurrency;
    }
    return out;
  });

  useEffect(() => {
    setServiceAllocationAmountsById((prev) => {
      const validIds = new Set(
        services
          .map((service) => Number(service.id_service))
          .filter((id) => Number.isFinite(id) && id > 0),
      );
      const next: Record<number, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        const id = Number(key);
        if (!Number.isFinite(id) || !validIds.has(id)) continue;
        next[id] = value;
      }
      return next;
    });
  }, [services]);
  useEffect(() => {
    setServiceAllocationPaymentAmountsById((prev) => {
      const validIds = new Set(
        services
          .map((service) => Number(service.id_service))
          .filter((id) => Number.isFinite(id) && id > 0),
      );
      const next: Record<number, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        const id = Number(key);
        if (!Number.isFinite(id) || !validIds.has(id)) continue;
        next[id] = value;
      }
      return next;
    });
  }, [services]);
  useEffect(() => {
    setServiceAllocationPaymentCurrencyById((prev) => {
      const validIds = new Set(
        services
          .map((service) => Number(service.id_service))
          .filter((id) => Number.isFinite(id) && id > 0),
      );
      const next: Record<number, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        const id = Number(key);
        if (!Number.isFinite(id) || !validIds.has(id)) continue;
        const currency = normalizeOptionalCurrencyCodeLoose(value || "");
        if (!currency) continue;
        next[id] = currency;
      }
      return next;
    });
  }, [services]);

  const setServiceAllocationAmount = useCallback(
    (serviceId: number, value: string) => {
      if (!Number.isFinite(serviceId) || serviceId <= 0) return;
      setServiceAllocationAmountsById((prev) => ({
        ...prev,
        [Math.trunc(serviceId)]: value,
      }));
    },
    [],
  );
  const setServiceAllocationPaymentAmount = useCallback(
    (serviceId: number, value: string) => {
      if (!Number.isFinite(serviceId) || serviceId <= 0) return;
      setServiceAllocationPaymentAmountsById((prev) => ({
        ...prev,
        [Math.trunc(serviceId)]: value,
      }));
    },
    [],
  );
  const setServiceAllocationPaymentCurrency = useCallback(
    (serviceId: number, currencyCode: string) => {
      if (!Number.isFinite(serviceId) || serviceId <= 0) return;
      const normalized = normalizeOptionalCurrencyCodeLoose(currencyCode || "");
      if (!normalized) return;
      setServiceAllocationPaymentCurrencyById((prev) => ({
        ...prev,
        [Math.trunc(serviceId)]: normalized,
      }));
    },
    [],
  );
  const [serviceAllocationPresetMode, setServiceAllocationPresetMode] =
    useState<ServiceAllocationPresetMode>("manual");
  const selectedServiceCurrencies = useMemo(
    () =>
      Array.from(
        new Set(
          allocationServices.map((service) =>
            normalizeCurrencyCodeLoose(service.currency || "ARS"),
          ),
        ),
      ),
    [allocationServices],
  );

  useEffect(() => {
    if (manualServiceAllocationsEnabled && allocationServices.length === 0) {
      setManualServiceAllocationsEnabled(false);
    }
  }, [manualServiceAllocationsEnabled, allocationServices]);

  const selectedBookingDisplayId = useMemo(() => {
    if (!selectedBookingId) return null;
    const opt = bookingOptions.find((b) => b.id_booking === selectedBookingId);
    if (typeof opt?.agency_booking_id === "number" && opt.agency_booking_id > 0) {
      return opt.agency_booking_id;
    }
    if (
      selectedBookingId === bookingId &&
      typeof bookingDisplayId === "number" &&
      Number.isFinite(bookingDisplayId) &&
      bookingDisplayId > 0
    ) {
      return Math.trunc(bookingDisplayId);
    }
    return selectedBookingId;
  }, [bookingDisplayId, bookingId, bookingOptions, selectedBookingId]);

  const lockedCurrency = useMemo(() => {
    if (!userSelectedServices.length) return null;
    const first = userSelectedServices[0].currency;
    return userSelectedServices.every((service) => service.currency === first)
      ? first
      : null;
  }, [userSelectedServices]);

  const toggleService = (svc: ServiceLite) => {
    setSelectedServiceIds((prev) =>
      prev.includes(svc.id_service)
        ? prev.filter((id) => id !== svc.id_service)
        : [...prev, svc.id_service],
    );
  };

  const clearBookingContext = () => {
    setSelectedBookingId(null);
    setSelectedServiceIds([]);
  };

  useEffect(() => {
    if (editingReceiptId) return;
    setManualServiceAllocationsEnabled(false);
    setServiceAllocationAmountsById({});
    setServiceAllocationPaymentAmountsById({});
    setServiceAllocationPaymentCurrencyById({});
    setServiceAllocationPresetMode("manual");
  }, [selectedBookingId, mode, action, editingReceiptId]);

  /* ===== Concepto ===== */
  const [concept, setConcept] = useState(initialConcept);
  const [issueDate, setIssueDate] = useState<string>(() => {
    const normalized = toInputDate(initialIssueDate);
    return normalized || todayInput();
  });

  /* ===== Moneda base de referencia (cuando no hay pagos cargados) ===== */

  const [freeCurrency, setFreeCurrency] = useState<CurrencyCode>(
    initialCurrency || "ARS",
  );
  const [currencyTouched, setCurrencyTouched] = useState(
    Boolean(initialCurrency),
  );

  useEffect(() => {
    if (lockedCurrency) return;
    if (currencyTouched) return;
    if (!currenciesTyped.length) return;
    const firstEnabled = currenciesTyped.find((c) => c.enabled)?.code || "ARS";
    setFreeCurrency(firstEnabled);
  }, [currenciesTyped, lockedCurrency, currencyTouched]);

  useEffect(() => {
    if (!lockedCurrency) return;
    if (currencyTouched) return;
    setFreeCurrency(lockedCurrency);
  }, [lockedCurrency, currencyTouched]);

  const defaultCurrency: CurrencyCode = freeCurrency;

  const suggestions = useMemo(() => {
    if (!selectedServices.length) return null;
    const currenciesInSelection = new Set(
      selectedServices.map((s) =>
        normalizeCurrencyCodeLoose(s.currency || "ARS"),
      ),
    );
    if (currenciesInSelection.size > 1) return null;

    const base = selectedServices.reduce((acc, service) => {
      if (
        typeof service.pending_amount === "number" &&
        Number.isFinite(service.pending_amount)
      ) {
        return acc + Math.max(0, service.pending_amount);
      }
      return acc + (service.sale_price ?? 0);
    }, 0);
    const fee = selectedServices.reduce((acc, service) => {
      if (
        typeof service.pending_amount === "number" &&
        Number.isFinite(service.pending_amount)
      ) {
        return acc;
      }
      return acc + (service.card_interest ?? 0);
    }, 0);
    const total = base + fee;
    if (base <= 0 && fee <= 0) return null;
    return {
      base: base > 0 ? base : null,
      fee: fee > 0 ? fee : null,
      total: total > 0 ? total : null,
    };
  }, [selectedServices]);

  const normalizedServiceAllocationsForPayload = useMemo(() => {
    if (!manualServiceAllocationsEnabled)
      return [] as ReceiptServiceAllocationLine[];
    if (!allocationServices.length) return [] as ReceiptServiceAllocationLine[];

    const serviceById = new Map(
      services.map((service) => [service.id_service, service]),
    );
    const out: ReceiptServiceAllocationLine[] = [];

    for (const service of allocationServices) {
      const serviceId = service.id_service;
      const amount = parseAmountInput(
        serviceAllocationAmountsById[serviceId] || "",
      );
      if (amount == null || amount <= 0) continue;
      const resolvedService = serviceById.get(serviceId);
      const serviceCurrency = normalizeCurrencyCodeLoose(
        resolvedService?.currency || "ARS",
      );
      const paymentCurrency = normalizeCurrencyCodeLoose(
        serviceAllocationPaymentCurrencyById[serviceId] || serviceCurrency,
      );
      const amountPayment = parseAmountInput(
        serviceAllocationPaymentAmountsById[serviceId] || "",
      );
      const hasPaymentAmount =
        amountPayment != null &&
        Number.isFinite(amountPayment) &&
        amountPayment > 0;
      out.push({
        service_id: serviceId,
        amount_service: round2(amount),
        service_currency: serviceCurrency,
        ...(paymentCurrency ? { payment_currency: paymentCurrency } : {}),
        ...(hasPaymentAmount
          ? {
              amount_payment: round2(amountPayment),
              fx_rate:
                serviceCurrency !== paymentCurrency
                  ? round2(amountPayment / amount)
                  : undefined,
            }
          : {}),
      });
    }

    return out;
  }, [
    manualServiceAllocationsEnabled,
    allocationServices,
    services,
    serviceAllocationAmountsById,
    serviceAllocationPaymentAmountsById,
    serviceAllocationPaymentCurrencyById,
  ]);

  /* ===== Payments (múltiples líneas) ===== */
  const [paymentLines, setPaymentLines] = useState<PaymentDraft[]>(() => {
    if (Array.isArray(initialPayments) && initialPayments.length > 0) {
      const hasPerLineFee = initialPayments.some(
        (p) =>
          p.fee_mode === "FIXED" ||
          p.fee_mode === "PERCENT" ||
          (typeof p.fee_amount === "number" && p.fee_amount > 0),
      );
      return initialPayments.map((p, idx) => ({
        key: uid(),
        amount: p.amount != null ? String(p.amount) : "",
        payment_method_id:
          p.payment_method_id != null ? Number(p.payment_method_id) : null,
        account_id: p.account_id ?? null,
        payment_currency: normalizeCurrencyCodeLoose(
          p.payment_currency ??
            initialCurrency ??
            initialBaseCurrency ??
            lockedCurrency ??
            "ARS",
        ),
        fee_mode:
          p.fee_mode === "FIXED" || p.fee_mode === "PERCENT"
            ? p.fee_mode
            : !hasPerLineFee &&
                idx === 0 &&
                initialFeeAmount != null &&
                initialFeeAmount > 0
              ? "FIXED"
              : "NONE",
        fee_value:
          p.fee_mode === "FIXED" || p.fee_mode === "PERCENT"
            ? String(p.fee_value ?? 0)
            : !hasPerLineFee &&
                idx === 0 &&
                initialFeeAmount != null &&
                initialFeeAmount > 0
              ? String(initialFeeAmount)
              : "",
        operator_id: p.operator_id ?? null,
        client_id: p.client_id ?? null,
        client_credit_mode:
          p.client_credit_mode === "CREDIT" ? "CREDIT" : "DEBIT",
        credit_account_id: p.credit_account_id ?? null,
      }));
    }

    return [
      {
        key: uid(),
        amount: initialAmount != null ? String(initialAmount) : "",
        payment_method_id: initialPaymentMethodId ?? null,
        account_id: initialFinanceAccountId ?? null,
        payment_currency: normalizeCurrencyCodeLoose(
          initialCurrency || initialBaseCurrency || lockedCurrency || "ARS",
        ),
        fee_mode:
          initialFeeAmount != null && initialFeeAmount > 0 ? "FIXED" : "NONE",
        fee_value:
          initialFeeAmount != null && initialFeeAmount > 0
            ? String(initialFeeAmount)
            : "",
        operator_id: null,
        client_id: null,
        client_credit_mode: "DEBIT",
        credit_account_id: null,
      },
    ];
  });

  const paymentsTotalNum = useMemo(() => {
    return paymentLines.reduce(
      (acc, l) => acc + (parseAmountInput(l.amount) ?? 0),
      0,
    );
  }, [paymentLines]);

  const paymentLineFeeByKey = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const line of paymentLines) {
      acc[line.key] = calcPaymentLineFee(line);
    }
    return acc;
  }, [paymentLines]);

  const paymentLineImpactByKey = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const line of paymentLines) {
      const amount = parseAmountInput(line.amount) ?? 0;
      const fee = paymentLineFeeByKey[line.key] ?? calcPaymentLineFee(line);
      acc[line.key] = round2(Math.max(0, amount) + Math.max(0, fee));
    }
    return acc;
  }, [paymentLines, paymentLineFeeByKey]);

  const paymentsAmountByCurrency = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const line of paymentLines) {
      const amount = parseAmountInput(line.amount) ?? 0;
      if (amount <= 0) continue;
      const currency = normalizeCurrencyCodeLoose(line.payment_currency);
      acc[currency] = round2((acc[currency] || 0) + amount);
    }
    return acc;
  }, [paymentLines]);

  const paymentsFeeByCurrency = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const line of paymentLines) {
      const fee = paymentLineFeeByKey[line.key] ?? calcPaymentLineFee(line);
      if (fee <= 0) continue;
      const currency = normalizeCurrencyCodeLoose(line.payment_currency);
      acc[currency] = round2((acc[currency] || 0) + fee);
    }
    return acc;
  }, [paymentLines, paymentLineFeeByKey]);

  const amountReceived = useMemo(
    () => formatCurrencyBreakdown(paymentsAmountByCurrency),
    [paymentsAmountByCurrency],
  );

  const feeAmount = useMemo(
    () => formatCurrencyBreakdown(paymentsFeeByCurrency),
    [paymentsFeeByCurrency],
  );

  const clientTotalByCurrency = useMemo(() => {
    const acc: Record<string, number> = {};
    const currencies = new Set([
      ...Object.keys(paymentsAmountByCurrency),
      ...Object.keys(paymentsFeeByCurrency),
    ]);
    for (const currency of currencies) {
      const total =
        (paymentsAmountByCurrency[currency] || 0) +
        (paymentsFeeByCurrency[currency] || 0);
      if (total <= 0) continue;
      acc[currency] = round2(total);
    }
    return acc;
  }, [paymentsAmountByCurrency, paymentsFeeByCurrency]);

  const paymentsFeeTotalNum = useMemo(() => {
    return round2(
      Object.values(paymentLineFeeByKey).reduce((acc, fee) => acc + fee, 0),
    );
  }, [paymentLineFeeByKey]);

  const paymentCurrenciesInUse = useMemo(() => {
    const set = new Set<string>();
    for (const line of paymentLines) {
      const amount = parseAmountInput(line.amount) ?? 0;
      if (amount <= 0) continue;
      set.add(normalizeCurrencyCodeLoose(line.payment_currency));
    }
    return Array.from(set);
  }, [paymentLines]);

  const hasMixedPaymentCurrencies = paymentCurrenciesInUse.length > 1;
  const effectiveCurrency: CurrencyCode =
    paymentCurrenciesInUse[0] || defaultCurrency;
  const currencyOverride =
    lockedCurrency != null &&
    (hasMixedPaymentCurrencies || effectiveCurrency !== lockedCurrency);
  const [conversionEnabled, setConversionEnabled] = useState(false);
  const allocationPaymentCurrencyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const line of paymentLines) {
      const code = normalizeCurrencyCodeLoose(line.payment_currency);
      if (!code) continue;
      set.add(code);
    }
    if (!set.size && effectiveCurrency) set.add(effectiveCurrency);
    return Array.from(set);
  }, [paymentLines, effectiveCurrency]);

  useEffect(() => {
    if (!allocationServices.length) return;
    setServiceAllocationPaymentCurrencyById((prev) => {
      const fallback =
        allocationPaymentCurrencyOptions[0] || effectiveCurrency || "ARS";
      const next = { ...prev };
      for (const service of allocationServices) {
        const serviceId = service.id_service;
        const existing = normalizeOptionalCurrencyCodeLoose(
          next[serviceId] || "",
        );
        if (existing) continue;
        const serviceCurrency = normalizeCurrencyCodeLoose(
          service.currency || "ARS",
        );
        const preferred = allocationPaymentCurrencyOptions.includes(
          serviceCurrency,
        )
          ? serviceCurrency
          : fallback;
        next[serviceId] = normalizeCurrencyCodeLoose(preferred);
      }
      return next;
    });
  }, [allocationServices, allocationPaymentCurrencyOptions, effectiveCurrency]);

  const addPaymentLine = () => {
    setPaymentLines((prev) => [
      ...prev,
      {
        key: uid(),
        amount: "",
        payment_method_id: null,
        account_id: null,
        payment_currency: normalizeCurrencyCodeLoose(
          freeCurrency || lockedCurrency || "ARS",
        ),
        fee_mode: "NONE",
        fee_value: "",
        operator_id: null,
        client_id: null,
        client_credit_mode: "DEBIT",
        credit_account_id: null,
      },
    ]);
  };

  const removePaymentLine = (key: string) => {
    setPaymentLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.key !== key),
    );
  };

  const setPaymentLineAmount = (key: string, v: string) => {
    setPaymentLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, amount: v } : l)),
    );
  };

  const setPaymentLineCurrency = (key: string, currencyCode: string) => {
    const nextCurrency = normalizeCurrencyCodeLoose(currencyCode);
    setPaymentLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, payment_currency: nextCurrency } : l,
      ),
    );
    setFreeCurrency(nextCurrency);
    setCurrencyTouched(true);
  };

  const setPaymentLineFeeMode = (
    key: string,
    mode: "NONE" | ReceiptPaymentFeeMode,
  ) => {
    setPaymentLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              fee_mode: mode,
              fee_value: mode === "NONE" ? "" : l.fee_value || "",
            }
          : l,
      ),
    );
  };

  const setPaymentLineFeeValue = (key: string, value: string) => {
    setPaymentLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, fee_value: value } : l)),
    );
  };

  /* ===== Credit accounts (cache por operador/cliente) ===== */
  const [creditAccountsByOperator, setCreditAccountsByOperator] = useState<
    Record<number, CreditAccountOption[]>
  >({});
  const [loadingCreditAccountsByOperator, setLoadingCreditAccountsByOperator] =
    useState<Record<number, boolean>>({});
  const [creditAccountsByClient, setCreditAccountsByClient] = useState<
    Record<number, CreditAccountOption[]>
  >({});
  const [loadingCreditAccountsByClient, setLoadingCreditAccountsByClient] =
    useState<Record<number, boolean>>({});

  // si cambia moneda efectiva, limpiamos cache (para no mezclar cuentas por moneda)
  useEffect(() => {
    setCreditAccountsByOperator({});
    setLoadingCreditAccountsByOperator({});
    setCreditAccountsByClient({});
    setLoadingCreditAccountsByClient({});
    setPaymentLines((prev) =>
      prev.map((l) => ({ ...l, credit_account_id: null })),
    );
  }, [effectiveCurrency]);

  const fetchCreditAccountsForOperator = useCallback(
    async (operatorId: number): Promise<CreditAccountOption[]> => {
      if (!token) return [];
      if (!operatorId || operatorId <= 0) return [];

      if (creditAccountsByOperator[operatorId]?.length)
        return creditAccountsByOperator[operatorId];

      if (loadingCreditAccountsByOperator[operatorId])
        return creditAccountsByOperator[operatorId] ?? [];

      setLoadingCreditAccountsByOperator((m) => ({ ...m, [operatorId]: true }));
      try {
        const qs = new URLSearchParams();
        const cur = String(effectiveCurrency || "").toUpperCase();
        qs.set("operator_id", String(operatorId));
        qs.set("operatorId", String(operatorId)); // compat backend viejo
        if (cur) qs.set("currency", cur);
        qs.set("enabled", "true");

        const res = await authFetch(
          `${CREDIT_ACCOUNTS_ENDPOINT}?${qs.toString()}`,
          { cache: "no-store" },
          token,
        );

        const data = await safeJson<unknown>(res);

        if (!res.ok) {
          const msg =
            isRecord(data) && typeof data["error"] === "string"
              ? String(data["error"])
              : isRecord(data) && typeof data["message"] === "string"
                ? String(data["message"])
                : "No se pudieron cargar las cuentas crédito/corriente.";
          throw new Error(msg);
        }

        const rawList: unknown[] = Array.isArray(data)
          ? data
          : isRecord(data) && Array.isArray(data["items"])
            ? (data["items"] as unknown[])
            : isRecord(data) && Array.isArray(data["accounts"])
              ? (data["accounts"] as unknown[])
              : [];

        const items: CreditAccountOption[] = rawList
          .filter(isRecord)
          .map((x) => {
            const id = Number(x["id_credit_account"]);
            const rawName = typeof x["name"] === "string" ? x["name"] : "";

            return {
              id_credit_account: id,
              name:
                rawName && rawName.trim().length > 0
                  ? rawName
                  : `Cuenta N° ${id}`,
              currency:
                typeof x["currency"] === "string"
                  ? String(x["currency"])
                  : undefined,
              enabled:
                typeof x["enabled"] === "boolean"
                  ? Boolean(x["enabled"])
                  : undefined,
              operator_id:
                typeof x["operator_id"] === "number"
                  ? Number(x["operator_id"])
                  : undefined,
            };
          })
          .filter(
            (a) =>
              Number.isFinite(a.id_credit_account) && a.id_credit_account > 0,
          );

        const filtered = items.filter((a) => {
          const okEnabled = a.enabled === undefined ? true : !!a.enabled;
          const okCur = a.currency
            ? String(a.currency).toUpperCase() ===
              String(effectiveCurrency).toUpperCase()
            : true;
          return okEnabled && okCur;
        });

        setCreditAccountsByOperator((m) => ({ ...m, [operatorId]: filtered }));
        return filtered;
      } finally {
        setLoadingCreditAccountsByOperator((m) => ({
          ...m,
          [operatorId]: false,
        }));
      }
    },
    [
      token,
      effectiveCurrency,
      creditAccountsByOperator,
      loadingCreditAccountsByOperator,
    ],
  );

  const fetchCreditAccountsForClient = useCallback(
    async (clientId: number): Promise<CreditAccountOption[]> => {
      if (!token) return [];
      if (!clientId || clientId <= 0) return [];

      if (creditAccountsByClient[clientId]?.length)
        return creditAccountsByClient[clientId];

      if (loadingCreditAccountsByClient[clientId])
        return creditAccountsByClient[clientId] ?? [];

      setLoadingCreditAccountsByClient((m) => ({ ...m, [clientId]: true }));
      try {
        const qs = new URLSearchParams();
        const cur = String(effectiveCurrency || "").toUpperCase();
        qs.set("client_id", String(clientId));
        qs.set("clientId", String(clientId)); // compat backend viejo
        if (cur) qs.set("currency", cur);
        qs.set("enabled", "true");

        const res = await authFetch(
          `${CREDIT_ACCOUNTS_ENDPOINT}?${qs.toString()}`,
          { cache: "no-store" },
          token,
        );

        const data = await safeJson<unknown>(res);

        if (!res.ok) {
          const msg =
            isRecord(data) && typeof data["error"] === "string"
              ? String(data["error"])
              : isRecord(data) && typeof data["message"] === "string"
                ? String(data["message"])
                : "No se pudieron cargar las cuentas crédito/corriente.";
          throw new Error(msg);
        }

        const rawList: unknown[] = Array.isArray(data)
          ? data
          : isRecord(data) && Array.isArray(data["items"])
            ? (data["items"] as unknown[])
            : isRecord(data) && Array.isArray(data["accounts"])
              ? (data["accounts"] as unknown[])
              : [];

        const items: CreditAccountOption[] = rawList
          .filter(isRecord)
          .map((x) => {
            const id = Number(x["id_credit_account"]);
            const rawName = typeof x["name"] === "string" ? x["name"] : "";

            return {
              id_credit_account: id,
              name:
                rawName && rawName.trim().length > 0
                  ? rawName
                  : `Cuenta N° ${id}`,
              currency:
                typeof x["currency"] === "string"
                  ? String(x["currency"])
                  : undefined,
              enabled:
                typeof x["enabled"] === "boolean"
                  ? Boolean(x["enabled"])
                  : undefined,
              client_id:
                typeof x["client_id"] === "number"
                  ? Number(x["client_id"])
                  : undefined,
            };
          })
          .filter(
            (a) =>
              Number.isFinite(a.id_credit_account) && a.id_credit_account > 0,
          );

        const filtered = items.filter((a) => {
          const okEnabled = a.enabled === undefined ? true : !!a.enabled;
          const okCur = a.currency
            ? String(a.currency).toUpperCase() ===
              String(effectiveCurrency).toUpperCase()
            : true;
          return okEnabled && okCur;
        });

        setCreditAccountsByClient((m) => ({ ...m, [clientId]: filtered }));
        return filtered;
      } finally {
        setLoadingCreditAccountsByClient((m) => ({
          ...m,
          [clientId]: false,
        }));
      }
    },
    [
      token,
      effectiveCurrency,
      creditAccountsByClient,
      loadingCreditAccountsByClient,
    ],
  );

  const setPaymentLineMethod = (key: string, methodId: number | null) => {
    const method = paymentMethodsUi.find((m) => m.id_method === methodId);
    const isOperatorCredit = isOperatorCreditPayment(methodId);
    const isClientCredit = isClientCreditPayment(methodId);

    setPaymentLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;

        if (isOperatorCredit) {
          return {
            ...l,
            payment_method_id: methodId,
            account_id: null,
            client_id: null,
            client_credit_mode: "DEBIT",
            // operator_id y credit_account_id se eligen a mano
          };
        }

        if (isClientCredit) {
          return {
            ...l,
            payment_method_id: methodId,
            account_id: null,
            operator_id: null,
            client_credit_mode:
              l.client_credit_mode === "CREDIT" ? "CREDIT" : "DEBIT",
            // client_id y credit_account_id se eligen a mano
          };
        }

        // no crédito: limpiar campos de crédito
        if (!method?.requires_account) {
          return {
            ...l,
            payment_method_id: methodId,
            account_id: null,
            operator_id: null,
            client_id: null,
            client_credit_mode: "DEBIT",
            credit_account_id: null,
          };
        }

        return {
          ...l,
          payment_method_id: methodId,
          operator_id: null,
          client_id: null,
          client_credit_mode: "DEBIT",
          credit_account_id: null,
        };
      }),
    );
  };

  const setPaymentLineAccount = (key: string, accountId: number | null) => {
    setPaymentLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, account_id: accountId } : l)),
    );
  };

  const setPaymentLineCreditAccount = (
    key: string,
    creditAccountId: number | null,
  ) => {
    setPaymentLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, credit_account_id: creditAccountId } : l,
      ),
    );
  };

  const setPaymentLineOperator = (key: string, operatorId: number | null) => {
    setPaymentLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              operator_id: operatorId,
              client_id: null,
              client_credit_mode: "DEBIT",
              credit_account_id: null,
            }
          : l,
      ),
    );

    if (!operatorId) return;

    fetchCreditAccountsForOperator(operatorId)
      .then((items) => {
        const validIds = items.map((a) => a.id_credit_account);
        setPaymentLines((prev) =>
          prev.map((l) => {
            if (l.key !== key) return l;
            if (l.operator_id !== operatorId) return l;

            const hasCurrent =
              l.credit_account_id != null &&
              validIds.includes(l.credit_account_id);

            if (hasCurrent) return l;

            if (items.length === 1) {
              return { ...l, credit_account_id: items[0].id_credit_account };
            }

            return { ...l, credit_account_id: null };
          }),
        );
      })
      .catch((err) => {
        toast.error(
          err instanceof Error
            ? err.message
            : "Error cargando cuentas crédito/corriente.",
        );
      });
  };

  const setPaymentLineClient = (key: string, clientId: number | null) => {
    setPaymentLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              client_id: clientId,
              operator_id: null,
              credit_account_id: null,
            }
          : l,
      ),
    );

    if (!clientId) return;

    fetchCreditAccountsForClient(clientId)
      .then((items) => {
        const validIds = items.map((a) => a.id_credit_account);
        setPaymentLines((prev) =>
          prev.map((l) => {
            if (l.key !== key) return l;
            if (l.client_id !== clientId) return l;

            const hasCurrent =
              l.credit_account_id != null &&
              validIds.includes(l.credit_account_id);

            if (hasCurrent) return l;

            if (items.length === 1) {
              return { ...l, credit_account_id: items[0].id_credit_account };
            }

            return { ...l, credit_account_id: null };
          }),
        );
      })
      .catch((err) => {
        toast.error(
          err instanceof Error
            ? err.message
            : "Error cargando cuentas crédito/corriente.",
        );
      });
  };

  const setPaymentLineClientCreditMode = (
    key: string,
    mode: "DEBIT" | "CREDIT",
  ) => {
    setPaymentLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, client_credit_mode: mode } : l)),
    );
  };

  // aplicar sugeridos: ajusta la ÚLTIMA línea para que el total matchee
  const applySuggestedAmounts = () => {
    if (!suggestions) return;

    if (conversionEnabled && lockedCurrency) {
      if (suggestions.base != null) setBaseAmount(String(suggestions.base));
      if (!baseCurrency) setBaseCurrency(lockedCurrency);
      return;
    }

    if (suggestions.base == null) return;
    const target = suggestions.base;

    setPaymentLines((prev) => {
      if (!prev.length) {
        return [
          {
            key: uid(),
            amount: String(target),
            payment_method_id: null,
            account_id: null,
            payment_currency: normalizeCurrencyCodeLoose(
              freeCurrency || lockedCurrency || "ARS",
            ),
            fee_mode: "NONE",
            fee_value: "",
            operator_id: null,
            client_id: null,
            client_credit_mode: "DEBIT",
            credit_account_id: null,
          },
        ];
      }
      const lastIdx = prev.length - 1;
      const sumExceptLast = prev
        .slice(0, lastIdx)
        .reduce((acc, l) => acc + (parseAmountInput(l.amount) ?? 0), 0);
      const nextLast = Math.max(0, target - sumExceptLast);

      const next = [...prev];
      next[lastIdx] = {
        ...next[lastIdx],
        amount: nextLast.toLocaleString("es-AR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        ...(suggestions.fee != null
          ? {
              fee_mode: "FIXED" as const,
              fee_value: suggestions.fee.toLocaleString("es-AR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
            }
          : {}),
      };
      return next;
    });
  };

  const clientTotal = useMemo(() => {
    const byPayments = formatCurrencyBreakdown(clientTotalByCurrency);
    if (byPayments) return byPayments;
    if (conversionEnabled) return "";

    const base = suggestions?.base ?? null;
    const fee = suggestions?.fee ?? null;
    if (base === null && fee === null) return "";
    const total = (base ?? 0) + (fee ?? 0);
    if (!total || total <= 0) return "";
    return formatCurrencyMoney(
      total,
      lockedCurrency || defaultCurrency || "ARS",
    );
  }, [
    clientTotalByCurrency,
    suggestions,
    conversionEnabled,
    lockedCurrency,
    defaultCurrency,
  ]);

  /* ===== Detalle de pago para PDF ===== */
  const initialPdfItemsPayload = decodeReceiptPdfItemsPayload(
    initialPaymentDescription,
  );
  const [paymentDescription, setPaymentDescriptionState] = useState(
    initialPdfItemsPayload.paymentDetail,
  );
  const [paymentDescriptionDirty, setPaymentDescriptionDirty] = useState(
    Boolean(
      initialPdfItemsPayload.paymentDetail || initialPdfItemsPayload.encoded,
    ),
  );
  const [manualPdfItemsEnabled, setManualPdfItemsEnabled] = useState(
    initialPdfItemsPayload.items.length > 0,
  );
  const [manualPdfItems, setManualPdfItems] = useState<ManualPdfItemDraft[]>(
    () =>
      initialPdfItemsPayload.items.map((item) => ({
        key: uid(),
        description: item.description,
        date_label: item.date_label || "",
      })),
  );

  const handlePaymentDescriptionChange = useCallback((v: string) => {
    setPaymentDescriptionState(v);
    setPaymentDescriptionDirty(true);
  }, []);
  const addManualPdfItem = useCallback(() => {
    setManualPdfItems((prev) => [
      ...prev,
      { key: uid(), description: "", date_label: "" },
    ]);
  }, []);
  const removeManualPdfItem = useCallback((key: string) => {
    setManualPdfItems((prev) => prev.filter((item) => item.key !== key));
  }, []);
  const setManualPdfItemDescription = useCallback(
    (key: string, value: string) => {
      setManualPdfItems((prev) =>
        prev.map((item) =>
          item.key === key ? { ...item, description: value } : item,
        ),
      );
    },
    [],
  );
  const setManualPdfItemDateLabel = useCallback(
    (key: string, value: string) => {
      setManualPdfItems((prev) =>
        prev.map((item) =>
          item.key === key ? { ...item, date_label: value } : item,
        ),
      );
    },
    [],
  );
  const normalizedManualPdfItems = useMemo(
    () =>
      normalizeReceiptPdfManualItems(
        manualPdfItems.map((item) => ({
          description: item.description,
          date_label: item.date_label,
        })),
      ),
    [manualPdfItems],
  );

  const getFilteredAccountsByCurrency = useCallback(
    (currencyCode: string) =>
      filterAccountsByCurrency({
        accounts: accountsTyped,
        currencies: currenciesTyped,
        effectiveCurrency: currencyCode,
        enabled: true,
      }),
    [accountsTyped, currenciesTyped],
  );

  const [agencyId, setAgencyId] = useState<number | null>(null);
  const [operators, setOperators] = useState<OperatorLite[]>([]);

  useEffect(() => {
    if (!token) {
      setAgencyId(null);
      setOperators([]);
      return;
    }

    const ac = new AbortController();

    (async () => {
      try {
        const profileRes = await authFetch(
          "/api/user/profile",
          { cache: "no-store", signal: ac.signal },
          token,
        );
        const profileJson = await safeJson<{ id_agency?: number }>(profileRes);
        const ag = profileJson?.id_agency ?? null;
        setAgencyId(ag ?? null);

        if (ag == null) {
          setOperators([]);
          return;
        }

        const opsRes = await authFetch(
          `/api/operators?agencyId=${ag}`,
          { cache: "no-store", signal: ac.signal },
          token,
        );

        if (!opsRes.ok) {
          setOperators([]);
          return;
        }

        const opsJson = (await safeJson<OperatorLite[]>(opsRes)) ?? [];
        setOperators(
          opsJson
            .filter((o) => o && typeof o.id_operator === "number")
            .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es")),
        );
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          setOperators([]);
        }
      }
    })();

    return () => ac.abort();
  }, [token]);

  const paymentSummary = useMemo(() => {
    const lines: {
      label: string;
      amount: number;
      fee: number;
      currency: string;
    }[] = [];

    for (const l of paymentLines) {
      const amt = parseAmountInput(l.amount);
      if (!amt || amt <= 0) continue;

      const isOperatorCredit = isOperatorCreditPayment(l.payment_method_id);
      const isClientCredit = isClientCreditPayment(l.payment_method_id);

      const m = paymentMethodsUi.find(
        (pm) => pm.id_method === l.payment_method_id,
      );
      const mName = isOperatorCredit
        ? OPERATOR_CREDIT_METHOD_LABEL
        : isClientCredit
          ? CLIENT_CREDIT_METHOD_LABEL
          : m?.name || "Método";

      const lineCurrency = normalizeCurrencyCodeLoose(
        l.payment_currency || effectiveCurrency,
      );
      const lineFee = paymentLineFeeByKey[l.key] ?? calcPaymentLineFee(l);

      lines.push({
        label: mName,
        amount: amt,
        fee: lineFee,
        currency: lineCurrency,
      });
    }

    if (!lines.length) return "";

    const fmt = (value: number) =>
      value.toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const parts = lines.map((line) =>
      line.fee > 0
        ? `${line.label}: ${fmt(line.amount + line.fee)} ${line.currency} (CF ${fmt(line.fee)})`
        : `${line.label}: ${fmt(line.amount)} ${line.currency}`,
    );

    return parts.join(" + ");
  }, [
    paymentLines,
    paymentMethodsUi,
    effectiveCurrency,
    paymentLineFeeByKey,
    isOperatorCreditPayment,
    isClientCreditPayment,
  ]);

  /* ===== Conversión (opcional) ===== */
  const [baseAmount, setBaseAmount] = useState(
    initialBaseAmount != null ? String(initialBaseAmount) : "",
  );
  const [baseCurrency, setBaseCurrency] = useState(
    initialBaseCurrency ? String(initialBaseCurrency) : "",
  );
  const [counterAmount, setCounterAmount] = useState(
    initialCounterAmount != null ? String(initialCounterAmount) : "",
  );
  const [counterCurrency, setCounterCurrency] = useState(
    initialCounterCurrency ? String(initialCounterCurrency) : "",
  );

  const toNum = useCallback((v: number | string | null | undefined) => {
    const n = typeof v === "number" ? v : Number(v ?? NaN);
    return Number.isFinite(n) ? n : 0;
  }, []);

  const normalizeCurrencyCode = useCallback(
    (raw: string | null | undefined) => {
      const s = (raw || "").trim().toUpperCase();
      if (!s) return "ARS";
      const map: Record<string, string> = {
        U$D: "USD",
        U$S: "USD",
        US$: "USD",
        USD$: "USD",
        AR$: "ARS",
        $: "ARS",
      };
      return map[s] || s;
    },
    [],
  );

  const formatDebtLabel = useCallback((value: number, currency: string) => {
    const safe = Number.isFinite(value) ? value : 0;
    const num = new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(safe);
    return currency === "ARS" ? `$ ${num}` : `${num} ${currency}`;
  }, []);

  const [bookingReceipts, setBookingReceipts] = useState<ReceiptForDebt[]>([]);
  const [bookingReceiptsLoaded, setBookingReceiptsLoaded] = useState(false);
  const [bookingSaleTotals, setBookingSaleTotals] = useState<
    Record<string, number>
  >({});
  const [bookingSaleOverride, setBookingSaleOverride] = useState<
    boolean | null
  >(null);
  const [bookingContextLoaded, setBookingContextLoaded] = useState(false);
  const [inheritedUseBookingSaleTotal, setInheritedUseBookingSaleTotal] =
    useState(false);
  const [, setBillingBreakdownMode] = useState<"auto" | "manual">("auto");
  const [calcConfigLoaded, setCalcConfigLoaded] = useState(false);

  useEffect(() => {
    if (!token || !selectedBookingId || mode !== "booking") {
      setBookingReceipts([]);
      setBookingReceiptsLoaded(false);
      return;
    }

    const ac = new AbortController();
    let alive = true;
    setBookingReceiptsLoaded(false);

    (async () => {
      try {
        const qs = new URLSearchParams();
        qs.set("bookingId", String(selectedBookingId));
        let debugDebt = false;
        if (typeof window !== "undefined") {
          try {
            const params = new URLSearchParams(window.location.search);
            const queryEnabled = params.get("debugDebt") === "1";
            const storageEnabled = ["1", "true", "on"].includes(
              String(window.localStorage.getItem("ofistur:debugDebt") || "")
                .trim()
                .toLowerCase(),
            );
            debugDebt = queryEnabled || storageEnabled;
          } catch {
            debugDebt = false;
          }
        }
        if (debugDebt) qs.set("debugDebt", "1");

        const res = await authFetch(
          `/api/receipts?${qs.toString()}`,
          { cache: "no-store", signal: ac.signal },
          token,
        );
        if (!res.ok) throw new Error("fetch failed");
        const json = await safeJson<unknown>(res);
        if (debugDebt && isRecord(json) && isRecord(json.debug_debt)) {
          console.warn("[debt-debug][receipt-form]", json.debug_debt);
        }
        const list = asArray<ReceiptForDebt>(json);
        if (alive) setBookingReceipts(list);
      } catch {
        if (alive) setBookingReceipts([]);
      } finally {
        if (alive) setBookingReceiptsLoaded(true);
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [token, selectedBookingId, mode]);

  useEffect(() => {
    if (!token) {
      setInheritedUseBookingSaleTotal(false);
      setBillingBreakdownMode("auto");
      setCalcConfigLoaded(false);
      return;
    }

    const ac = new AbortController();
    let alive = true;
    setCalcConfigLoaded(false);

    (async () => {
      try {
        const res = await authFetch(
          "/api/service-calc-config",
          { cache: "no-store", signal: ac.signal },
          token,
        );
        if (!res.ok) throw new Error("fetch failed");
        const json = await safeJson<{
          use_booking_sale_total?: unknown;
          billing_breakdown_mode?: unknown;
          receipt_service_selection_mode?: unknown;
        }>(res);
        if (alive) {
          setInheritedUseBookingSaleTotal(
            Boolean(json?.use_booking_sale_total),
          );
          setBillingBreakdownMode(
            String(json?.billing_breakdown_mode || "auto").toLowerCase() ===
              "manual"
              ? "manual"
              : "auto",
          );
          setReceiptServiceSelectionMode(
            normalizeReceiptServiceSelectionMode(
              json?.receipt_service_selection_mode,
            ),
          );
        }
      } catch {
        if (alive) {
          setInheritedUseBookingSaleTotal(false);
          setBillingBreakdownMode("auto");
          setReceiptServiceSelectionMode("required");
        }
      } finally {
        if (alive) setCalcConfigLoaded(true);
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedBookingId || mode !== "booking") {
      setBookingSaleTotals({});
      setBookingSaleOverride(null);
      setBookingContextLoaded(false);
      return;
    }

    const ac = new AbortController();
    let alive = true;
    setBookingContextLoaded(false);

    (async () => {
      try {
        const res = await authFetch(
          `/api/bookings/${selectedBookingId}`,
          { cache: "no-store", signal: ac.signal },
          token,
        );
        if (!res.ok) throw new Error("fetch failed");
        const json = await safeJson<{
          sale_totals?: unknown;
          use_booking_sale_total_override?: unknown;
        }>(res);

        if (!alive) return;

        const totals = normalizeSaleTotalsLoose(json?.sale_totals);
        const overrideRaw = json?.use_booking_sale_total_override;
        const override = typeof overrideRaw === "boolean" ? overrideRaw : null;

        setBookingSaleTotals(totals);
        setBookingSaleOverride(override);
      } catch {
        if (!alive) return;
        setBookingSaleTotals({});
        setBookingSaleOverride(null);
      } finally {
        if (alive) setBookingContextLoaded(true);
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [token, selectedBookingId, mode]);

  const bookingSaleMode =
    mode === "booking"
      ? typeof bookingSaleOverride === "boolean"
        ? bookingSaleOverride
        : inheritedUseBookingSaleTotal
      : false;
  const paymentAvailableForAllocationByCurrency = useMemo(() => {
    return buildServiceAllocationAvailabilityByCurrency({
      amount: paymentsTotalNum || (suggestions?.base ?? 0),
      amount_currency: effectiveCurrency,
      payment_fee_amount: paymentsFeeTotalNum,
      base_amount: parseAmountInput(baseAmount),
      base_currency: baseCurrency || null,
      payments: paymentLines.map((line) => ({
        amount: parseAmountInput(line.amount) ?? 0,
        payment_currency: line.payment_currency || effectiveCurrency,
        fee_amount: paymentLineFeeByKey[line.key] ?? calcPaymentLineFee(line),
      })),
    });
  }, [
    paymentsTotalNum,
    suggestions,
    effectiveCurrency,
    paymentsFeeTotalNum,
    baseAmount,
    baseCurrency,
    paymentLines,
    paymentLineFeeByKey,
  ]);
  const applyServiceAllocationPreset = useCallback(
    (preset: ServiceAllocationPresetMode) => {
      if (!allocationServices.length) {
        toast.error("Seleccioná servicios para poder asignar montos.");
        return;
      }

      if (preset === "manual") {
        setServiceAllocationPresetMode("manual");
        setManualServiceAllocationsEnabled(true);
        return;
      }

      const nextAmounts: Record<number, string> = {};
      const nextPaymentAmounts: Record<number, string> = {};
      const nextPaymentCurrencies: Record<number, string> = {};
      const fallbackPaymentCurrency =
        allocationPaymentCurrencyOptions[0] || effectiveCurrency || "ARS";

      if (preset === "use_costs") {
        let hasAnyCost = false;
        for (const service of allocationServices) {
          const cost = round2(Math.max(0, toNum(service.cost_price)));
          if (cost <= 0) continue;
          hasAnyCost = true;
          nextAmounts[service.id_service] = String(cost);
          const serviceCurrency = normalizeCurrencyCodeLoose(
            service.currency || "ARS",
          );
          const paymentCurrency = normalizeCurrencyCodeLoose(
            serviceAllocationPaymentCurrencyById[service.id_service] ||
              fallbackPaymentCurrency,
          );
          nextPaymentCurrencies[service.id_service] = paymentCurrency;
          if (serviceCurrency === paymentCurrency) {
            nextPaymentAmounts[service.id_service] = String(cost);
          }
        }
        if (!hasAnyCost) {
          toast.error(
            "No hay costos cargados para los servicios seleccionados.",
          );
          return;
        }
      } else if (preset === "split_payment") {
        const currency = fallbackPaymentCurrency;
        const total = round2(
          Math.max(0, paymentAvailableForAllocationByCurrency[currency] || 0),
        );
        if (total <= 0) {
          toast.error("No hay monto de pago disponible para dividir.");
          return;
        }

        let remaining = total;
        allocationServices.forEach((service, idx) => {
          const isLast = idx === allocationServices.length - 1;
          const amount = isLast
            ? remaining
            : round2(total / allocationServices.length);
          if (!isLast) remaining = round2(remaining - amount);
          nextAmounts[service.id_service] = String(Math.max(0, amount));
          nextPaymentAmounts[service.id_service] = String(Math.max(0, amount));
          nextPaymentCurrencies[service.id_service] = currency;
        });
      }

      setServiceAllocationAmountsById((prev) => ({
        ...prev,
        ...nextAmounts,
      }));
      setServiceAllocationPaymentAmountsById((prev) => ({
        ...prev,
        ...nextPaymentAmounts,
      }));
      setServiceAllocationPaymentCurrencyById((prev) => ({
        ...prev,
        ...nextPaymentCurrencies,
      }));
      setServiceAllocationPresetMode(preset);
      setManualServiceAllocationsEnabled(true);
    },
    [
      allocationServices,
      allocationPaymentCurrencyOptions,
      effectiveCurrency,
      paymentAvailableForAllocationByCurrency,
      serviceAllocationPaymentCurrencyById,
      toNum,
    ],
  );

  const relevantReceipts = useMemo(() => {
    if (!bookingReceipts.length) return [];
    const receiptsExcludingCurrent =
      editingReceiptId &&
      Number.isFinite(editingReceiptId) &&
      editingReceiptId > 0
        ? bookingReceipts.filter((r) => {
            const receiptId = Number(
              (r as { id_receipt?: unknown; id?: unknown }).id_receipt ??
                (r as { id?: unknown }).id,
            );
            return !(
              Number.isFinite(receiptId) &&
              Math.trunc(receiptId) === Math.trunc(editingReceiptId)
            );
          })
        : bookingReceipts;
    if (bookingSaleMode) return receiptsExcludingCurrent;
    if (!serviceIdsForContext.length) return [];
    const svcSet = new Set(serviceIdsForContext);
    return receiptsExcludingCurrent.filter((r) => {
      const allocIds = Array.isArray(r.service_allocations)
        ? Array.from(
            new Set(
              r.service_allocations
                .filter(
                  (alloc) =>
                    Math.abs(toNum(alloc?.amount_service ?? 0)) >
                    DEBT_TOLERANCE,
                )
                .map((alloc) => Number(alloc?.service_id))
                .filter((id) => Number.isFinite(id) && id > 0)
                .map((id) => Math.trunc(id)),
            ),
          )
        : [];
      if (allocIds.length > 0) {
        return allocIds.some((id) => svcSet.has(id));
      }
      const ids = Array.isArray(r.serviceIds)
        ? r.serviceIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
            .map((id) => Math.trunc(id))
            .filter((id) => allBookingServiceIdSet.has(id))
        : [];
      if (!ids.length) return true;
      return ids.some((id) => svcSet.has(id));
    });
  }, [
    allBookingServiceIdSet,
    bookingReceipts,
    bookingSaleMode,
    editingReceiptId,
    serviceIdsForContext,
    toNum,
  ]);

  const salesByCurrency = useMemo(() => {
    if (bookingSaleMode) {
      if (Object.keys(bookingSaleTotals).length > 0) {
        return Object.entries(bookingSaleTotals).reduce<Record<string, number>>(
          (acc, [currency, rawTotal]) => {
            const total = toNum(rawTotal);
            if (total > 0) acc[normalizeCurrencyCode(currency)] = total;
            return acc;
          },
          {},
        );
      }

      return services.reduce<Record<string, number>>((acc, s) => {
        const cur = normalizeCurrencyCode(s.currency || "ARS");
        const sale = toNum(s.sale_price);
        if (sale > 0) acc[cur] = (acc[cur] || 0) + sale;
        return acc;
      }, {});
    }

    return selectedServices.reduce<Record<string, number>>((acc, s) => {
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const sale = toNum(s.sale_price);
      const split = toNum(s.taxableCardInterest) + toNum(s.vatOnCardInterest);
      const interest = split > 0 ? split : toNum(s.card_interest);
      const total = sale + interest;
      if (total > 0) acc[cur] = (acc[cur] || 0) + total;
      return acc;
    }, {});
  }, [
    bookingSaleMode,
    bookingSaleTotals,
    services,
    selectedServices,
    normalizeCurrencyCode,
    toNum,
  ]);

  const serviceCurrencyById = useMemo(
    () =>
      new Map(
        services.map((service) => [
          service.id_service,
          normalizeCurrencyCodeLoose(service.currency || "ARS"),
        ]),
      ),
    [services],
  );

  const serviceWeightById = useMemo(
    () =>
      new Map(
        services.map((service) => {
          const sale = Math.max(0, toNumberLoose(service.sale_price));
          const splitInterest =
            toNumberLoose(service.taxableCardInterest) +
            toNumberLoose(service.vatOnCardInterest);
          const cardInterest =
            splitInterest > 0
              ? splitInterest
              : toNumberLoose(service.card_interest);
          return [service.id_service, round2(Math.max(0, sale + cardInterest))];
        }),
      ),
    [services],
  );

  const paidByCurrency = useMemo(() => {
    return relevantReceipts.reduce<Record<string, number>>((acc, receipt) => {
      if (bookingSaleMode) {
        addReceiptToPaidByCurrency(acc, receipt);
        return acc;
      }

      const selectedServiceIdSet = new Set(serviceIdsForContext);
      const hasAllocations =
        Array.isArray(receipt.service_allocations) &&
        receipt.service_allocations.length > 0;

      if (hasAllocations) {
        addReceiptToPaidByCurrency(acc, receipt, {
          selectedServiceIds: selectedServiceIdSet,
        });
        return acc;
      }

      addUnallocatedReceiptPaidByCurrencyForSelection({
        target: acc,
        receipt,
        selectedServiceIds: selectedServiceIdSet,
        allServiceIds: allBookingServiceIds,
        serviceCurrencyById,
        serviceWeightById,
      });
      return acc;
    }, {});
  }, [
    relevantReceipts,
    serviceIdsForContext,
    bookingSaleMode,
    allBookingServiceIds,
    serviceCurrencyById,
    serviceWeightById,
  ]);

  const bookingDebtContextReady =
    mode !== "booking" ||
    !selectedBookingId ||
    serviceIdsForContext.length === 0 ||
    (bookingReceiptsLoaded && bookingContextLoaded && calcConfigLoaded);

  const currentPaidByCurrency = useMemo(() => {
    const acc: Record<string, number> = {};
    if (
      !bookingSaleMode &&
      manualServiceAllocationsEnabled &&
      normalizedServiceAllocationsForPayload.length > 0
    ) {
      for (const alloc of normalizedServiceAllocationsForPayload) {
        const currency = normalizeCurrencyCode(alloc.service_currency || "ARS");
        acc[currency] = round2(
          (acc[currency] || 0) + toNum(alloc.amount_service),
        );
      }
      return acc;
    }

    const baseVal = parseAmountInput(baseAmount);
    const baseCur = baseCurrency ? normalizeCurrencyCode(baseCurrency) : null;

    if (baseCur && baseVal != null && baseVal > 0) {
      const feeInBaseCurrency = paymentsFeeByCurrency[baseCur] || 0;
      const val = round2(baseVal + feeInBaseCurrency);
      if (val > 0) acc[baseCur] = val;
      return acc;
    }

    for (const line of paymentLines) {
      const amountVal = parseAmountInput(line.amount) ?? 0;
      if (amountVal <= 0) continue;
      const lineCurrency = normalizeCurrencyCode(
        line.payment_currency || effectiveCurrency || "ARS",
      );
      const lineFee = paymentLineFeeByKey[line.key] ?? calcPaymentLineFee(line);
      const totalLine = amountVal + Math.max(0, lineFee);
      if (totalLine <= 0) continue;
      acc[lineCurrency] = round2((acc[lineCurrency] || 0) + totalLine);
    }

    return acc;
  }, [
    bookingSaleMode,
    manualServiceAllocationsEnabled,
    normalizedServiceAllocationsForPayload,
    baseAmount,
    baseCurrency,
    paymentLines,
    paymentLineFeeByKey,
    paymentsFeeByCurrency,
    effectiveCurrency,
    normalizeCurrencyCode,
    toNum,
  ]);

  const debtByCurrency = useMemo(() => {
    const acc: Record<string, number> = {};
    const currencies = new Set([
      ...Object.keys(salesByCurrency),
      ...Object.keys(paidByCurrency),
      ...Object.keys(currentPaidByCurrency),
    ]);
    currencies.forEach((cur) => {
      const sale = salesByCurrency[cur] || 0;
      const paid =
        (paidByCurrency[cur] || 0) + (currentPaidByCurrency[cur] || 0);
      acc[cur] = sale - paid;
    });
    return acc;
  }, [salesByCurrency, paidByCurrency, currentPaidByCurrency]);

  const overpaidByCurrency = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const [currency, debt] of Object.entries(debtByCurrency)) {
      if (debt < -DEBT_TOLERANCE) {
        acc[currency] = round2(Math.abs(debt));
      }
    }
    return acc;
  }, [debtByCurrency]);

  const debtSuffix = useMemo(() => {
    if (!serviceIdsForContext.length || !bookingDebtContextReady) return "";
    const parts = Object.entries(debtByCurrency)
      .filter(([, v]) => v > DEBT_TOLERANCE)
      .map(([cur, v]) => formatDebtLabel(v, cur));
    if (!Object.keys(debtByCurrency).length) return "";
    if (!parts.length) return "-NO ADEUDA SALDO-";
    return `-ADEUDA ${parts.join(" y ")}`;
  }, [
    serviceIdsForContext,
    bookingDebtContextReady,
    debtByCurrency,
    formatDebtLabel,
  ]);

  const paymentDescriptionAuto = useMemo(() => {
    if (!paymentSummary.trim()) return "";
    const hasBookingContext =
      !!selectedBookingId && serviceIdsForContext.length > 0;
    if (hasBookingContext && !bookingDebtContextReady) return paymentSummary;
    const suffix = hasBookingContext ? debtSuffix.trim() : "";
    return suffix ? `${paymentSummary} ${suffix}` : paymentSummary;
  }, [
    paymentSummary,
    selectedBookingId,
    serviceIdsForContext,
    bookingDebtContextReady,
    debtSuffix,
  ]);

  useEffect(() => {
    if (editingReceiptId) return;
    setPaymentDescriptionState("");
    setPaymentDescriptionDirty(false);
    setManualPdfItemsEnabled(false);
    setManualPdfItems([]);
  }, [selectedBookingId, mode, editingReceiptId]);

  useEffect(() => {
    if (paymentDescriptionDirty) return;
    if (paymentDescriptionAuto.trim()) {
      setPaymentDescriptionState(paymentDescriptionAuto);
    } else if (!paymentSummary.trim()) {
      setPaymentDescriptionState("");
    }
  }, [paymentDescriptionAuto, paymentSummary, paymentDescriptionDirty]);

  /* ===== Pasajeros ===== */
  const [clientsCount, setClientsCount] = useState(
    Math.max(1, initialClientIds?.length || 1),
  );
  const [clientIds, setClientIds] = useState<(number | null)[]>(
    clientsCount === (initialClientIds?.length || 0)
      ? initialClientIds
      : Array.from({ length: Math.max(1, initialClientIds?.length || 1) }).map(
          (_, i) => initialClientIds?.[i] ?? null,
        ),
  );

  const onIncClient = () => {
    setClientsCount((c) => c + 1);
    setClientIds((arr) => [...arr, null]);
  };
  const onDecClient = () => {
    if (clientsCount <= 1) return;
    setClientsCount((c) => c - 1);
    setClientIds((arr) => arr.slice(0, -1));
  };
  const setClientAt = (index: number, client: Client | null) => {
    setClientIds((prev) => {
      const next = [...prev];
      next[index] = client ? client.id_client : null;
      return next;
    });
  };
  const excludeForIndex = (idx: number) =>
    clientIds.filter((_, i) => i !== idx).filter(Boolean) as number[];

  /* ===== Importe en palabras (PDF) ===== */
  const [amountWords, setAmountWords] = useState(initialAmountWords);

  useEffect(() => {
    if (!lockedCurrency) return;
    setBaseCurrency((prev) => prev || lockedCurrency);
  }, [lockedCurrency]);

  useEffect(() => {
    if (!conversionEnabled) return;
    setCounterCurrency((prev) => prev || effectiveCurrency);
  }, [conversionEnabled, effectiveCurrency]);

  /* ===== Attach search ===== */
  const attachSearchEnabled = attachEnabled && action === "attach";
  const { receiptQuery, setReceiptQuery, receiptOptions, loadingReceipts } =
    useReceiptSearch({
      token,
      enabled: attachSearchEnabled,
      searchReceipts,
    });
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(
    null,
  );

  /* ===== Validación ===== */
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateCreate = () => {
    const e: Record<string, string> = {};

    if (mode === "booking") {
      if (!selectedBookingId) e.booking = "Elegí una reserva.";
      if (
        receiptServiceSelectionMode === "required" &&
        serviceIdsForContext.length === 0
      )
        e.services = "Seleccioná al menos un servicio.";
      if (
        selectedServiceCurrencies.length > 1 &&
        !manualServiceAllocationsEnabled
      ) {
        e.service_allocations =
          'Con servicios en múltiples monedas activá "Ajuste por servicio" y cargá la conversión por servicio.';
      }
      if (manualServiceAllocationsEnabled) {
        if (allocationServices.length === 0) {
          e.service_allocations =
            "Seleccioná servicios para poder asignar montos.";
        } else if (normalizedServiceAllocationsForPayload.length === 0) {
          e.service_allocations =
            "Cargá al menos un monto por servicio o desactivá el ajuste manual.";
        } else {
          const missingConversionService =
            normalizedServiceAllocationsForPayload.find((alloc) => {
              const serviceCurrency = normalizeCurrencyCodeLoose(
                alloc.service_currency || "ARS",
              );
              const paymentCurrency = normalizeCurrencyCodeLoose(
                alloc.payment_currency || serviceCurrency,
              );
              if (serviceCurrency === paymentCurrency) return false;
              const amountPayment = toNum(alloc.amount_payment);
              return !Number.isFinite(amountPayment) || amountPayment <= 0;
            });
          if (missingConversionService) {
            const service = allocationServices.find(
              (item) => item.id_service === missingConversionService.service_id,
            );
            const serviceLabel =
              service?.agency_service_id != null
                ? service.agency_service_id
                : "sin número interno";
            e.service_allocations = `Completá el contravalor del servicio N° ${serviceLabel} para validar la conversión por servicio.`;
          }

          const availableByCurrency =
            buildServiceAllocationAvailabilityByCurrency({
              amount: paymentsTotalNum || (suggestions?.base ?? 0),
              amount_currency: effectiveCurrency,
              payment_fee_amount: paymentsFeeTotalNum,
              base_amount: parseAmountInput(baseAmount),
              base_currency: baseCurrency || null,
              payments: paymentLines.map((line) => ({
                amount: parseAmountInput(line.amount) ?? 0,
                payment_currency: line.payment_currency || effectiveCurrency,
                fee_amount:
                  paymentLineFeeByKey[line.key] ?? calcPaymentLineFee(line),
              })),
            });

          if (!e.service_allocations) {
            const allocatedByCurrency =
              normalizedServiceAllocationsForPayload.reduce<
                Record<string, number>
              >((acc, alloc) => {
                const serviceCurrency = normalizeCurrencyCodeLoose(
                  alloc.service_currency || "ARS",
                );
                const paymentCurrency = normalizeCurrencyCodeLoose(
                  alloc.payment_currency || serviceCurrency,
                );
                const amountPayment = toNum(alloc.amount_payment);
                const amountService = toNum(alloc.amount_service);
                const amount =
                  Number.isFinite(amountPayment) && amountPayment > 0
                    ? amountPayment
                    : amountService;
                const code = paymentCurrency || serviceCurrency;
                acc[code] = round2((acc[code] || 0) + amount);
                return acc;
              }, {});

            for (const [code, allocated] of Object.entries(
              allocatedByCurrency,
            )) {
              const available = availableByCurrency[code] || 0;
              if (allocated - available > DEBT_TOLERANCE) {
                e.service_allocations = `Los montos por servicio exceden el monto disponible en ${code}.`;
                break;
              }
            }
          }
        }
      }
    }

    if (!paymentLines.length) {
      e.payments = "Cargá al menos una línea de pago.";
    } else {
      paymentLines.forEach((l, idx) => {
        const isOperatorCredit = isOperatorCreditPayment(l.payment_method_id);
        const isClientCredit = isClientCreditPayment(l.payment_method_id);
        const isCredit = isOperatorCredit || isClientCredit;

        const m = paymentMethodsUi.find(
          (pm) => pm.id_method === l.payment_method_id,
        );
        const requiresAcc = !!m?.requires_account;

        const amt = parseAmountInput(l.amount);
        if (!amt || amt <= 0) e[`payment_amount_${idx}`] = "Importe inválido.";
        if (!normalizeCurrencyCodeLoose(l.payment_currency))
          e[`payment_currency_${idx}`] = "Elegí moneda.";

        if (l.fee_mode !== "NONE") {
          const fv = parseAmountInput(l.fee_value);
          if (fv == null || fv < 0) {
            e[`payment_fee_value_${idx}`] = "Costo financiero inválido.";
          }
          if (l.fee_mode === "PERCENT" && fv != null && fv > 1000) {
            e[`payment_fee_value_${idx}`] =
              "El porcentaje de costo financiero es muy alto.";
          }
        }

        // 👇 clave: 0 es válido, solo invalidamos null/undefined
        if (l.payment_method_id == null)
          e[`payment_method_${idx}`] = "Elegí método.";

        if (isOperatorCredit) {
          const lineCurrencyForError = normalizeCurrencyCodeLoose(
            l.payment_currency || effectiveCurrency,
          );
          if (!l.operator_id) e[`payment_operator_${idx}`] = "Elegí operador.";
          const accountsForOperator =
            l.operator_id != null
              ? creditAccountsByOperator[l.operator_id] || []
              : [];
          if (!l.credit_account_id) {
            e[`payment_credit_account_${idx}`] =
              accountsForOperator.length === 0
                ? `El operador no tiene cuentas crédito/corriente en ${
                    lineCurrencyForError || "esta moneda"
                  }.`
                : "Elegí la cuenta crédito/corriente.";
          }
        }

        if (isClientCredit) {
          const lineCurrencyForError = normalizeCurrencyCodeLoose(
            l.payment_currency || effectiveCurrency,
          );
          if (!l.client_id)
            e[`payment_client_${idx}`] = "Elegí cliente pagador.";
          const accountsForClient =
            l.client_id != null
              ? creditAccountsByClient[l.client_id] || []
              : [];
          if (!l.credit_account_id) {
            e[`payment_credit_account_${idx}`] =
              accountsForClient.length === 0
                ? `El cliente no tiene cuentas crédito/corriente en ${
                    lineCurrencyForError || "esta moneda"
                  }.`
                : "Elegí la cuenta crédito/corriente.";
          }
        }

        if (!isCredit && requiresAcc) {
          if (!l.account_id) e[`payment_account_${idx}`] = "Elegí cuenta.";
        }
      });
    }

    const total =
      paymentsTotalNum || (conversionEnabled ? 0 : suggestions?.base || 0);
    if (!total || total <= 0)
      e.amount = "El total es inválido. Cargá importes o usá el sugerido.";
    if (!effectiveCurrency)
      e.payments = "Elegí una moneda en las líneas de pago para continuar.";
    const issueDateOk = /^\d{4}-\d{2}-\d{2}$/.test(issueDate);
    if (!issueDateOk) e.issue_date = "Elegí la fecha del recibo.";
    const baseNum = parseAmountInput(baseAmount);
    if (conversionEnabled && baseAmount.trim() !== "") {
      if (!baseNum || baseNum <= 0) {
        e.base = "Ingresá un valor base válido.";
      } else if (!baseCurrency) {
        e.base = "Elegí la moneda del valor base.";
      } else if (lockedCurrency && baseCurrency !== lockedCurrency) {
        e.base = `La moneda base debe ser ${lockedCurrency}.`;
      }
    }

    const counterNum = parseAmountInput(counterAmount);
    if (conversionEnabled && counterAmount.trim() !== "") {
      if (!counterNum || counterNum <= 0) {
        e.counter = "Ingresá un contravalor válido.";
      } else if (!counterCurrency) {
        e.counter = "Elegí la moneda del contravalor.";
      }
    }

    if (!amountWords.trim()) e.amountWords = "Ingresá el importe en palabras.";
    if (!paymentDescription.trim())
      e.paymentDescription =
        "Agregá el detalle del método de pago (para el PDF).";
    if (manualPdfItemsEnabled && normalizedManualPdfItems.length === 0) {
      e.pdf_items =
        "Cargá al menos un ítem manual o desactivá la carga manual del PDF.";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateAttach = () => {
    const e: Record<string, string> = {};
    if (!selectedReceiptId) e.receipt = "Elegí un recibo.";
    if (!selectedBookingId) e.booking = "Elegí una reserva.";
    if (
      receiptServiceSelectionMode === "required" &&
      serviceIdsForContext.length === 0
    )
      e.services = "Seleccioná al menos un servicio.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  /* ===== Submit ===== */
  const [submitting, setSubmitting] = useState(false);

  const handleAttachExisting = async () => {
    if (!token || !selectedReceiptId || !selectedBookingId) return;
    if (onAttachExisting) {
      await onAttachExisting({
        id_receipt: selectedReceiptId,
        bookingId: selectedBookingId,
        serviceIds: serviceIdsForContext,
      });
      return;
    }
    await attachExistingReceipt({
      token,
      receiptId: selectedReceiptId,
      bookingId: selectedBookingId,
      serviceIds: serviceIdsForContext,
    });
  };

  const onLocalSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (action === "attach") {
      if (!validateAttach()) return;
      setSubmitting(true);
      try {
        await handleAttachExisting();
        toast.success("Recibo asociado correctamente.");
        setVisible(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "No se pudo asociar el recibo.",
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!validateCreate()) return;

    // 👇 IMPORTANTE: no convertir null -> 0, porque 0 es nuestro crédito virtual
    const normalizedPayments: ReceiptPaymentLine[] = paymentLines
      .map((l): ReceiptPaymentLine => {
        const pmId =
          l.payment_method_id == null ? -1 : Number(l.payment_method_id);
        const isCredit = isAnyCreditPayment(pmId);
        const feeValue = parseAmountInput(l.fee_value);
        const feeAmount = paymentLineFeeByKey[l.key] ?? calcPaymentLineFee(l);
        return {
          amount: parseAmountInput(l.amount) ?? 0,
          payment_method_id:
            l.payment_method_id == null ? null : Number(l.payment_method_id),
          account_id: isCredit ? null : (l.account_id ?? null),
          payment_currency: normalizeCurrencyCodeLoose(
            l.payment_currency || effectiveCurrency,
          ),
          fee_mode:
            l.fee_mode === "FIXED" || l.fee_mode === "PERCENT"
              ? l.fee_mode
              : undefined,
          fee_value:
            l.fee_mode === "FIXED" || l.fee_mode === "PERCENT"
              ? (feeValue ?? 0)
              : undefined,
          fee_amount: feeAmount > 0 ? feeAmount : undefined,
          operator_id: l.operator_id ?? null,
          client_id: l.client_id ?? null,
          client_credit_mode:
            l.client_credit_mode === "CREDIT" ? "CREDIT" : "DEBIT",
          credit_account_id: l.credit_account_id ?? null,
        };
      })
      .filter((p) => {
        const pmId = Number(p.payment_method_id ?? NaN);
        const isCredit = isAnyCreditPayment(pmId);
        return p.amount > 0 && (pmId > 0 || isCredit);
      });

    let finalAmount = normalizedPayments.reduce((acc, p) => acc + p.amount, 0);

    if (
      (!finalAmount || finalAmount <= 0) &&
      !conversionEnabled &&
      suggestions?.base != null
    ) {
      finalAmount = suggestions.base;
    }

    if (!finalAmount || finalAmount <= 0) {
      toast.error("El total del recibo es inválido.");
      return;
    }

    const finalFee = paymentsFeeTotalNum;
    const paymentFeeForPayload = finalFee > 0 ? finalFee : undefined;

    // para los campos legacy: preferí un pago real (>0), sino el primero (puede ser crédito)
    const primaryPayment =
      normalizedPayments.find(
        (p) => !isAnyCreditPayment(p.payment_method_id),
      ) ??
      normalizedPayments[0] ??
      null;

    const single =
      normalizedPayments.length === 1 ? normalizedPayments[0] : null;

    const singleMethodName = single
      ? isOperatorCreditPayment(single.payment_method_id)
        ? OPERATOR_CREDIT_METHOD_LABEL
        : isClientCreditPayment(single.payment_method_id)
          ? CLIENT_CREDIT_METHOD_LABEL
          : paymentMethodsUi.find(
              (m) => m.id_method === single.payment_method_id,
            )?.name
      : undefined;

    const singleAccountName =
      single?.account_id != null
        ? accountsTyped.find((a) => a.id_account === single.account_id)
            ?.display_name ||
          accountsTyped.find((a) => a.id_account === single.account_id)?.name
        : undefined;

    const baseAmountNum = parseAmountInput(baseAmount);
    const counterAmountNum = parseAmountInput(counterAmount);
    const paymentCurrenciesForPayload = Array.from(
      new Set(
        normalizedPayments
          .map((p) => normalizeCurrencyCodeLoose(p.payment_currency || "ARS"))
          .filter(Boolean),
      ),
    );
    const hasMixedPayments = paymentCurrenciesForPayload.length > 1;
    const baseAmountValid = baseAmountNum != null && baseAmountNum > 0;
    const counterAmountValid = counterAmountNum != null && counterAmountNum > 0;
    const baseReady = conversionEnabled && baseAmountValid && !!baseCurrency;
    const useConversion = conversionEnabled && baseReady;
    const payloadAmount =
      hasMixedPayments && baseReady ? (baseAmountNum as number) : finalAmount;
    const payloadAmountCurrency =
      hasMixedPayments && baseReady
        ? baseCurrency || effectiveCurrency
        : effectiveCurrency;

    const payloadBaseAmount = baseReady ? baseAmountNum : undefined;
    const payloadBaseCurrency = baseReady
      ? baseCurrency || undefined
      : undefined;

    const payloadCounterAmount = counterAmountValid
      ? counterAmountNum
      : useConversion && !hasMixedPayments
        ? finalAmount
        : undefined;
    const payloadCounterCurrency = counterAmountValid
      ? counterCurrency || undefined
      : useConversion && !hasMixedPayments
        ? effectiveCurrency
        : undefined;

    let allowClientCreditExcess = false;
    let clientCreditClientId: number | undefined;
    if (
      mode === "booking" &&
      selectedBookingId &&
      Object.keys(overpaidByCurrency).length > 0
    ) {
      const selectedClientIds = clientIds.filter(
        (id): id is number => typeof id === "number" && Number.isFinite(id),
      );
      if (!selectedClientIds.length) {
        toast.error(
          "Para registrar excedente en cuenta crédito/corriente, seleccioná al menos un pax.",
        );
        return;
      }

      const overpaidLabel = Object.entries(overpaidByCurrency)
        .map(([currency, amount]) => formatDebtLabel(amount, currency))
        .join(" y ");
      const targetClient = selectedClientIds[0];
      const confirmed = window.confirm(
        `El cobro excede el saldo pendiente en ${overpaidLabel}. ¿Querés dejar ese excedente en la cuenta crédito/corriente del pax seleccionado (ID ${targetClient})?`,
      );
      if (!confirmed) {
        return;
      }

      allowClientCreditExcess = true;
      clientCreditClientId = targetClient;
    }

    const apiBody: ReceiptPayload = {
      ...(mode === "booking" && selectedBookingId
        ? {
            booking: { id_booking: selectedBookingId },
            serviceIds: serviceIdsForContext,
            serviceAllocations: manualServiceAllocationsEnabled
              ? normalizedServiceAllocationsForPayload
              : [],
            service_allocations: manualServiceAllocationsEnabled
              ? normalizedServiceAllocationsForPayload
              : [],
            ...(allowClientCreditExcess
              ? {
                  allow_client_credit_excess: true,
                  client_credit_client_id: clientCreditClientId,
                }
              : {}),
          }
        : {}),

      issue_date: issueDate || undefined,
      concept: (concept ?? "").trim(),
      amount: payloadAmount,
      amountString: amountWords.trim(),
      amountCurrency: payloadAmountCurrency,

      payment_fee_amount: paymentFeeForPayload,

      clientIds: clientIds.filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      ),

      payment_method:
        singleMethodName ||
        (normalizedPayments.length > 1 ? "Múltiples" : undefined),
      account: singleAccountName,

      payment_method_id: primaryPayment?.payment_method_id ?? undefined,
      account_id: primaryPayment?.account_id ?? undefined,

      payments: normalizedPayments,

      currency:
        encodeReceiptPdfItemsPayload({
          paymentDetail: paymentDescription?.trim() || "",
          items: normalizedManualPdfItems,
          enabled: manualPdfItemsEnabled,
        }) || undefined,

      base_amount: payloadBaseAmount,
      base_currency: payloadBaseCurrency,
      counter_amount: payloadCounterAmount,
      counter_currency: payloadCounterCurrency,
    };

    setSubmitting(true);
    try {
      const submitRes = await Promise.resolve(onSubmit(apiBody));
      const rid = await resolveReceiptIdFrom(submitRes);

      if (editingReceiptId) {
        toast.success("Recibo actualizado correctamente.");
        setVisible(false);
        return;
      }

      if (!rid) {
        toast.success("Recibo creado (sin ID detectable para movimientos).");
        setVisible(false);
        return;
      }

      const creditEntryErrors: string[] = [];
      const financeEntryErrors: string[] = [];
      const clientCreditEntryErrors: string[] = [];

      for (const [idx, p] of normalizedPayments.entries()) {
        const lineLabel = `línea ${idx + 1}`;
        const isOperatorCredit = isOperatorCreditPayment(p.payment_method_id);
        const isClientCredit = isClientCreditPayment(p.payment_method_id);
        const isCredit = isOperatorCredit || isClientCredit;

        if (isOperatorCredit) {
          const opId = p.operator_id ?? null;
          const caId = p.credit_account_id ?? null;

          if (!opId) {
            creditEntryErrors.push(
              `Crédito/corriente operador (${lineLabel}): falta operador.`,
            );
          } else if (!caId) {
            creditEntryErrors.push(
              `Crédito/corriente operador (${lineLabel}): falta cuenta crédito/corriente.`,
            );
          } else {
            try {
              await createCreditEntryForReceipt({
                token: token!,
                receiptId: rid,
                amount: p.amount,
                currency: p.payment_currency || apiBody.amountCurrency || "ARS",
                concept: apiBody.concept,
                bookingId: selectedBookingId ?? bookingId ?? undefined,
                operatorId: opId,
                agencyId,
                creditAccountId: caId,
              });
            } catch (err) {
              creditEntryErrors.push(
                `Crédito/corriente operador (${lineLabel}): ${
                  err instanceof Error
                    ? err.message
                    : "error creando movimiento de crédito/corriente."
                }`,
              );
            }
          }
        }

        if (isClientCredit) {
          const clientId = p.client_id ?? null;
          const caId = p.credit_account_id ?? null;
          const clientCreditMode =
            p.client_credit_mode === "CREDIT" ? "CREDIT" : "DEBIT";
          const docType =
            clientCreditMode === "CREDIT" ? "adjust_up" : "adjust_down";
          const modeLabel =
            clientCreditMode === "CREDIT" ? "agregar saldo" : "descontar saldo";

          if (!clientId) {
            clientCreditEntryErrors.push(
              `Crédito/corriente cliente (${lineLabel}): falta cliente.`,
            );
          } else if (!caId) {
            clientCreditEntryErrors.push(
              `Crédito/corriente cliente (${lineLabel}): falta cuenta crédito/corriente.`,
            );
          } else {
            try {
              await createClientCreditEntryForReceipt({
                token: token!,
                receiptId: rid,
                amount: p.amount,
                currency: p.payment_currency || apiBody.amountCurrency || "ARS",
                concept: `${apiBody.concept} (${modeLabel})`,
                bookingId: selectedBookingId ?? bookingId ?? undefined,
                clientId,
                agencyId,
                creditAccountId: caId,
                docType,
              });
            } catch (err) {
              clientCreditEntryErrors.push(
                `Crédito/corriente cliente (${lineLabel}): ${
                  err instanceof Error
                    ? err.message
                    : "error creando movimiento de crédito/corriente."
                }`,
              );
            }
          }
        }

        if (!isCredit && p.account_id != null) {
          try {
            await createFinanceEntryForReceipt({
              token: token!,
              accountId: p.account_id,
              receiptId: rid,
              amount: p.amount,
              currency: p.payment_currency || apiBody.amountCurrency || "ARS",
              concept: apiBody.concept,
              bookingId: selectedBookingId ?? bookingId ?? undefined,
              agencyId,
            });
          } catch (err) {
            financeEntryErrors.push(
              `Cuenta financiera (${lineLabel}): ${
                err instanceof Error
                  ? err.message
                  : "error creando movimiento de cuenta."
              }`,
            );
          }
        }
      }

      const clientCreditExcess = extractClientCreditExcess(submitRes);
      if (clientCreditExcess) {
        for (const [currency, amount] of Object.entries(
          clientCreditExcess.byCurrency,
        )) {
          try {
            await createClientCreditEntryForReceipt({
              token: token!,
              receiptId: rid,
              amount,
              currency,
              concept: `${apiBody.concept} (excedente a cuenta corriente pax)`,
              bookingId: selectedBookingId ?? bookingId ?? undefined,
              clientId: clientCreditExcess.clientId,
              agencyId,
            });
          } catch (err) {
            clientCreditEntryErrors.push(
              `Pax (ID ${clientCreditExcess.clientId}, ${currency}): ${
                err instanceof Error
                  ? err.message
                  : "error creando movimiento de crédito/corriente."
              }`,
            );
          }
        }
      }

      if (
        creditEntryErrors.length ||
        financeEntryErrors.length ||
        clientCreditEntryErrors.length
      ) {
        const details: string[] = [];
        if (creditEntryErrors.length) {
          details.push(
            `crédito/corriente operador: ${creditEntryErrors.join(" | ")}`,
          );
        }
        if (financeEntryErrors.length) {
          details.push(
            `cuentas financieras: ${financeEntryErrors.join(" | ")}`,
          );
        }
        if (clientCreditEntryErrors.length) {
          details.push(
            `crédito/corriente de pax: ${clientCreditEntryErrors.join(" | ")}`,
          );
        }
        toast.warn(
          `Recibo creado, pero hubo problemas al impactar movimientos: ${details.join(" | ")}`,
        );
      } else {
        toast.success("Recibo creado correctamente.");
      }

      setVisible(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo crear el recibo.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* ===== UI helpers ===== */
  const formatNum = (n: number, cur = "ARS") =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <motion.div
      id="receipt-form"
      layout
      initial={{ maxHeight: 96, opacity: 1 }}
      animate={{
        maxHeight: visible ? 1600 : 96,
        opacity: 1,
        transition: { duration: 0.35, ease: "easeInOut" },
      }}
      className="mb-6 overflow-auto rounded-3xl border border-white/10 bg-white/10 text-sky-950 shadow-md shadow-sky-950/10 dark:text-white"
    >
      <ReceiptHeader
        visible={visible}
        onToggle={() => setVisible(!visible)}
        editingReceiptId={editingReceiptId}
        action={action}
        mode={mode}
        selectedBookingDisplayId={selectedBookingDisplayId}
        selectedServiceCount={serviceIdsForContext.length}
        effectiveCurrency={effectiveCurrency}
        lockedCurrency={lockedCurrency}
      />

      <AnimatePresence initial={false}>
        {visible && (
          <motion.div
            key="body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <form
              onSubmit={onLocalSubmit}
              className="space-y-5 px-4 pb-6 pt-4 md:px-6"
            >
              <ContextSection
                attachEnabled={attachEnabled}
                action={action}
                setAction={setAction}
                hideContext={hideContextSection}
                canToggleAgency={canToggleAgency}
                mode={mode}
                setMode={setMode}
                clearBookingContext={clearBookingContext}
                forcedBookingMode={forcedBookingMode}
                bookingId={bookingId}
                selectedBookingDisplayId={selectedBookingDisplayId}
                bookingQuery={bookingQuery}
                setBookingQuery={setBookingQuery}
                bookingOptions={bookingOptions}
                loadingBookings={loadingBookings}
                selectedBookingId={selectedBookingId}
                setSelectedBookingId={setSelectedBookingId}
                services={services}
                loadingServices={loadingServices}
                serviceSelectionMode={receiptServiceSelectionMode}
                selectedServiceIds={selectedServiceIds}
                effectiveServiceIds={serviceIdsForContext}
                toggleService={toggleService}
                lockedCurrency={lockedCurrency}
                effectiveCurrency={effectiveCurrency}
                preferPendingAmount={mode === "booking" && !bookingSaleMode}
                errors={errors}
                formatNum={formatNum}
              />

              <AttachReceiptSection
                show={attachEnabled && action === "attach"}
                receiptQuery={receiptQuery}
                setReceiptQuery={setReceiptQuery}
                receiptOptions={receiptOptions}
                loadingReceipts={loadingReceipts}
                selectedReceiptId={selectedReceiptId}
                setSelectedReceiptId={setSelectedReceiptId}
                errors={errors}
              />

              {action === "create" && (
                <CreateReceiptFields
                  token={token}
                  creditMethodId={operatorCreditMethodId}
                  clientCreditMethodId={clientCreditMethodId}
                  issueDate={issueDate}
                  setIssueDate={setIssueDate}
                  clientsCount={clientsCount}
                  clientIds={clientIds}
                  onIncClient={onIncClient}
                  onDecClient={onDecClient}
                  setClientAt={setClientAt}
                  excludeForIndex={excludeForIndex}
                  amountReceived={amountReceived}
                  feeAmount={feeAmount}
                  clientTotal={clientTotal}
                  lockedCurrency={lockedCurrency}
                  loadingPicks={loadingPicks}
                  currencies={currenciesTyped}
                  effectiveCurrency={effectiveCurrency}
                  currencyOverride={currencyOverride}
                  conversionEnabled={conversionEnabled}
                  setConversionEnabled={setConversionEnabled}
                  suggestions={suggestions}
                  applySuggestedAmounts={applySuggestedAmounts}
                  formatNum={formatNum}
                  amountWords={amountWords}
                  setAmountWords={setAmountWords}
                  paymentMethods={paymentMethodsUi}
                  accounts={accountsTyped}
                  getFilteredAccountsByCurrency={getFilteredAccountsByCurrency}
                  hasMixedPaymentCurrencies={hasMixedPaymentCurrencies}
                  paymentLines={paymentLines}
                  addPaymentLine={addPaymentLine}
                  removePaymentLine={removePaymentLine}
                  setPaymentLineAmount={setPaymentLineAmount}
                  setPaymentLineMethod={setPaymentLineMethod}
                  setPaymentLineAccount={setPaymentLineAccount}
                  setPaymentLineCurrency={setPaymentLineCurrency}
                  setPaymentLineFeeMode={setPaymentLineFeeMode}
                  setPaymentLineFeeValue={setPaymentLineFeeValue}
                  getPaymentLineFee={(key) => paymentLineFeeByKey[key] ?? 0}
                  getPaymentLineImpact={(key) =>
                    paymentLineImpactByKey[key] ?? 0
                  }
                  setPaymentLineOperator={setPaymentLineOperator}
                  setPaymentLineClient={setPaymentLineClient}
                  setPaymentLineClientCreditMode={
                    setPaymentLineClientCreditMode
                  }
                  setPaymentLineCreditAccount={setPaymentLineCreditAccount}
                  operators={operators}
                  creditAccountsByOperator={creditAccountsByOperator}
                  creditAccountsByClient={creditAccountsByClient}
                  loadingCreditAccountsByOperator={
                    loadingCreditAccountsByOperator
                  }
                  loadingCreditAccountsByClient={loadingCreditAccountsByClient}
                  paymentDescription={paymentDescription}
                  setPaymentDescription={handlePaymentDescriptionChange}
                  manualPdfItemsEnabled={manualPdfItemsEnabled}
                  setManualPdfItemsEnabled={setManualPdfItemsEnabled}
                  manualPdfItems={manualPdfItems}
                  addManualPdfItem={addManualPdfItem}
                  removeManualPdfItem={removeManualPdfItem}
                  setManualPdfItemDescription={setManualPdfItemDescription}
                  setManualPdfItemDateLabel={setManualPdfItemDateLabel}
                  concept={concept}
                  setConcept={setConcept}
                  baseAmount={baseAmount}
                  setBaseAmount={setBaseAmount}
                  baseCurrency={baseCurrency}
                  setBaseCurrency={setBaseCurrency}
                  counterAmount={counterAmount}
                  setCounterAmount={setCounterAmount}
                  counterCurrency={counterCurrency}
                  setCounterCurrency={setCounterCurrency}
                  showServiceAllocationSection={mode === "booking"}
                  allocationServices={allocationServices}
                  manualServiceAllocationsEnabled={
                    manualServiceAllocationsEnabled
                  }
                  setManualServiceAllocationsEnabled={
                    setManualServiceAllocationsEnabled
                  }
                  serviceAllocationAmountsById={serviceAllocationAmountsById}
                  setServiceAllocationAmount={setServiceAllocationAmount}
                  serviceAllocationPaymentAmountsById={
                    serviceAllocationPaymentAmountsById
                  }
                  setServiceAllocationPaymentAmount={
                    setServiceAllocationPaymentAmount
                  }
                  serviceAllocationPaymentCurrencyById={
                    serviceAllocationPaymentCurrencyById
                  }
                  setServiceAllocationPaymentCurrency={
                    setServiceAllocationPaymentCurrency
                  }
                  allocationPaymentCurrencyOptions={
                    allocationPaymentCurrencyOptions
                  }
                  selectedServiceCurrencies={selectedServiceCurrencies}
                  serviceAllocationPresetMode={serviceAllocationPresetMode}
                  applyServiceAllocationPreset={applyServiceAllocationPreset}
                  paymentAvailableForAllocationByCurrency={
                    paymentAvailableForAllocationByCurrency
                  }
                  errors={errors}
                />
              )}

              {/* ACTION BAR */}
              <div className="sticky bottom-2 z-10 flex justify-end gap-3">
                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-full bg-sky-950/10 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] dark:bg-white/10 dark:text-white"
                  >
                    Cancelar
                  </button>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  aria-busy={submitting}
                  className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] ${
                    submitting
                      ? "cursor-not-allowed bg-sky-950/20 text-white/60 dark:bg-white/5 dark:text-white/40"
                      : "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                  }`}
                >
                  {submitting ? (
                    <Spinner />
                  ) : editingReceiptId ? (
                    "Guardar Cambios"
                  ) : action === "attach" ? (
                    "Asociar Recibo"
                  ) : (
                    "Crear Recibo"
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
