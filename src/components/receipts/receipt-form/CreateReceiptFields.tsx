// src/components/receipts/receipt-form/CreateReceiptFields.tsx
"use client";

import React from "react";
import ClientPicker from "@/components/clients/ClientPicker";
import type {
  CurrencyCode,
  FinanceAccount,
  FinanceCurrency,
  FinancePaymentMethod,
  ReceiptPaymentFeeMode,
  ServiceLite,
} from "@/types/receipts";
import type { Client } from "@/types";
import Spinner from "@/components/Spinner";
import { parseAmountInput } from "@/utils/receipts/receiptForm";
import { formatMoneyInput, shouldPreferDotDecimal } from "@/utils/moneyInput";
import {
  Field,
  Section,
  inputBase,
  pillBase,
  pillNeutral,
} from "./primitives";

type CreditAccountOption = {
  id_credit_account: number;
  name: string;
  currency?: string;
  enabled?: boolean;
  operator_id?: number;
};

type PaymentDraft = {
  key: string;
  amount: string;
  payment_method_id: number | null;
  account_id: number | null;
  payment_currency: string;
  fee_mode: "NONE" | ReceiptPaymentFeeMode;
  fee_value: string;

  operator_id: number | null;

  credit_account_id: number | null;
};

type ServiceAllocationPresetMode = "manual" | "split_payment" | "use_costs";

export default function CreateReceiptFields(props: {
  token: string | null;

  // ✅ id del método crédito (real si existe, o virtual 0)
  creditMethodId: number;
  issueDate: string;
  setIssueDate: (v: string) => void;

  // pasajeros
  clientsCount: number;
  clientIds: (number | null)[];
  onIncClient: () => void;
  onDecClient: () => void;
  setClientAt: (index: number, client: Client | null) => void;
  excludeForIndex: (idx: number) => number[];

  // monto/moneda (total, readOnly)
  amountReceived: string;
  feeAmount: string;
  clientTotal: string;

  lockedCurrency: string | null;
  loadingPicks: boolean;

  currencies: FinanceCurrency[];
  effectiveCurrency: CurrencyCode;
  currencyOverride: boolean;

  suggestions: {
    base: number | null;
    fee: number | null;
    total: number | null;
  } | null;
  applySuggestedAmounts: () => void;
  formatNum: (n: number, cur?: string) => string;

  // palabras
  amountWords: string;
  setAmountWords: (v: string) => void;

  // picks
  paymentMethods: FinancePaymentMethod[];
  accounts: FinanceAccount[];
  getFilteredAccountsByCurrency: (currencyCode: string) => FinanceAccount[];
  hasMixedPaymentCurrencies: boolean;

  // pagos múltiples
  paymentLines: PaymentDraft[];
  addPaymentLine: () => void;
  removePaymentLine: (key: string) => void;
  setPaymentLineAmount: (key: string, v: string) => void;
  setPaymentLineMethod: (key: string, methodId: number | null) => void;
  setPaymentLineAccount: (key: string, accountId: number | null) => void;
  setPaymentLineCurrency: (key: string, currencyCode: string) => void;
  setPaymentLineFeeMode: (
    key: string,
    mode: "NONE" | ReceiptPaymentFeeMode,
  ) => void;
  setPaymentLineFeeValue: (key: string, value: string) => void;
  getPaymentLineFee: (key: string) => number;
  getPaymentLineImpact: (key: string) => number;

  setPaymentLineOperator: (key: string, operatorId: number | null) => void;

  setPaymentLineCreditAccount: (
    key: string,
    creditAccountId: number | null,
  ) => void;
  creditAccountsByOperator: Record<number, CreditAccountOption[]>;
  loadingCreditAccountsByOperator: Record<number, boolean>;

  operators: { id_operator: number; name: string }[];

  // detalle PDF
  paymentDescription: string;
  setPaymentDescription: (v: string) => void;

  // concepto / conversión
  concept: string;
  setConcept: (v: string) => void;

  baseAmount: string;
  setBaseAmount: (v: string) => void;
  baseCurrency: string;
  setBaseCurrency: (v: string) => void;

  counterAmount: string;
  setCounterAmount: (v: string) => void;
  counterCurrency: string;
  setCounterCurrency: (v: string) => void;

  showServiceAllocationSection: boolean;
  allocationServices: ServiceLite[];
  manualServiceAllocationsEnabled: boolean;
  setManualServiceAllocationsEnabled: (next: boolean) => void;
  serviceAllocationAmountsById: Record<number, string>;
  setServiceAllocationAmount: (serviceId: number, value: string) => void;
  serviceAllocationPaymentAmountsById: Record<number, string>;
  setServiceAllocationPaymentAmount: (serviceId: number, value: string) => void;
  serviceAllocationPaymentCurrencyById: Record<number, string>;
  setServiceAllocationPaymentCurrency: (
    serviceId: number,
    currencyCode: string,
  ) => void;
  allocationPaymentCurrencyOptions: string[];
  selectedServiceCurrencies: string[];
  serviceAllocationPresetMode: ServiceAllocationPresetMode;
  applyServiceAllocationPreset: (preset: ServiceAllocationPresetMode) => void;
  paymentAvailableForAllocationByCurrency: Record<string, number>;

  // errors
  errors: Record<string, string>;
}) {
  const {
    token,
    creditMethodId,
    issueDate,
    setIssueDate,

    clientsCount,
    clientIds,
    onIncClient,
    onDecClient,
    setClientAt,
    excludeForIndex,

    amountReceived,
    feeAmount,
    clientTotal,

    lockedCurrency,
    loadingPicks,

    currencies,
    effectiveCurrency,
    currencyOverride,

    suggestions,
    applySuggestedAmounts,
    formatNum,

    amountWords,
    setAmountWords,

    paymentMethods,
    getFilteredAccountsByCurrency,
    hasMixedPaymentCurrencies,

    paymentLines,
    addPaymentLine,
    removePaymentLine,
    setPaymentLineAmount,
    setPaymentLineMethod,
    setPaymentLineAccount,
    setPaymentLineCurrency,
    setPaymentLineFeeMode,
    setPaymentLineFeeValue,
    getPaymentLineFee,
    getPaymentLineImpact,
    setPaymentLineOperator,

    setPaymentLineCreditAccount,
    creditAccountsByOperator,
    loadingCreditAccountsByOperator,

    operators,

    paymentDescription,
    setPaymentDescription,

    concept,
    setConcept,

    baseAmount,
    setBaseAmount,
    baseCurrency,
    setBaseCurrency,

    counterAmount,
    setCounterAmount,
    counterCurrency,
    setCounterCurrency,

    showServiceAllocationSection,
    allocationServices,
    manualServiceAllocationsEnabled,
    setManualServiceAllocationsEnabled,
    serviceAllocationAmountsById,
    setServiceAllocationAmount,
    serviceAllocationPaymentAmountsById,
    setServiceAllocationPaymentAmount,
    serviceAllocationPaymentCurrencyById,
    setServiceAllocationPaymentCurrency,
    allocationPaymentCurrencyOptions,
    selectedServiceCurrencies,
    serviceAllocationPresetMode,
    applyServiceAllocationPreset,
    paymentAvailableForAllocationByCurrency,

    errors,
  } = props;

  const baseNum = parseAmountInput(baseAmount);
  const counterNum = parseAmountInput(counterAmount);

  const fmtMaybe = (raw: string, num: number | null, cur: string | null) => {
    if (num != null && cur) return formatNum(num, cur);
    if (raw && cur) return `${raw} ${cur}`;
    return "—";
  };
  const selectedAllocationCurrency =
    allocationPaymentCurrencyOptions[0] || selectedServiceCurrencies[0] || "ARS";
  const paymentAvailableForSelectedCurrency =
    paymentAvailableForAllocationByCurrency[selectedAllocationCurrency] || 0;
  const normalizeCode = (raw: string | null | undefined) =>
    String(raw || "")
      .trim()
      .toUpperCase();
  const allocationSelectableCurrencies = Array.from(
    new Set(
      [
        ...currencies.filter((c) => c.enabled).map((c) => normalizeCode(c.code)),
        ...allocationPaymentCurrencyOptions.map((code) => normalizeCode(code)),
        selectedAllocationCurrency,
      ].filter(Boolean),
    ),
  );
  const allocatedByCurrency = allocationServices.reduce<Record<string, number>>(
    (acc, service) => {
      const serviceCurrency = normalizeCode(service.currency || "ARS") || "ARS";
      const paymentCurrency =
        normalizeCode(serviceAllocationPaymentCurrencyById[service.id_service]) ||
        serviceCurrency;
      const amountService = parseAmountInput(
        serviceAllocationAmountsById[service.id_service] || "",
      );
      if (amountService == null || amountService <= 0) return acc;
      const amountPayment = parseAmountInput(
        serviceAllocationPaymentAmountsById[service.id_service] || "",
      );
      const allocated =
        amountPayment != null && amountPayment > 0 ? amountPayment : amountService;
      acc[paymentCurrency] = (acc[paymentCurrency] || 0) + allocated;
      return acc;
    },
    {},
  );
  const allocationDeltaWarnings = Array.from(
    new Set([
      ...Object.keys(paymentAvailableForAllocationByCurrency),
      ...Object.keys(allocatedByCurrency),
    ]),
  )
    .map((code) => {
      const available = paymentAvailableForAllocationByCurrency[code] || 0;
      const allocated = allocatedByCurrency[code] || 0;
      const delta = allocated - available;
      if (Math.abs(delta) <= 0.01) return null;
      return {
        code,
        available,
        allocated,
        delta,
      };
    })
    .filter(Boolean) as Array<{
    code: string;
    available: number;
    allocated: number;
    delta: number;
  }>;

  return (
    <>
      <Section
        title="Pasajeros"
        desc="Podés adjudicar el recibo a uno o varios pasajeros (opcional)."
      >
        <div className="flex items-center gap-2 pl-1 md:col-span-2">
          <button
            type="button"
            onClick={onDecClient}
            className="rounded-full border border-sky-950 p-1 disabled:opacity-40 dark:border-white"
            disabled={clientsCount <= 1}
          >
            −
          </button>
          <span className="rounded-full border border-sky-950 px-3 py-1 text-sm dark:border-white">
            {clientsCount}
          </span>
          <button
            type="button"
            onClick={onIncClient}
            className="rounded-full border border-sky-950 p-1 dark:border-white"
          >
            +
          </button>
        </div>

        <div className="space-y-3 md:col-span-2">
          {Array.from({ length: clientsCount }).map((_, idx) => (
            <div key={idx} className="pl-1">
              <ClientPicker
                token={token}
                label={`Pax ${idx + 1}`}
                placeholder="Buscar por ID, DNI, Pasaporte, CUIT o nombre..."
                valueId={clientIds[idx] ?? null}
                excludeIds={excludeForIndex(idx)}
                onSelect={(c) => setClientAt(idx, c)}
                onClear={() => setClientAt(idx, null)}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Fecha del recibo"
        desc="Podés cargar recibos con fechas anteriores."
      >
        <Field id="issue_date" label="Fecha" required>
          <input
            id="issue_date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className={`${inputBase} cursor-pointer`}
            required
          />
          {errors.issue_date && (
            <p className="mt-1 text-xs text-red-600">{errors.issue_date}</p>
          )}
        </Field>
      </Section>

      <Section
        title="Totales del cobro"
        desc="Resumen automático a partir de las líneas cargadas."
      >
        <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
          <article className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-950/70 dark:text-white/70">
              Total cobrado
            </p>
            <p className="mt-1 text-sm font-semibold">
              {amountReceived || "—"}
            </p>
            <p className="mt-1 text-[11px] text-sky-950/65 dark:text-white/65">
              Neto que entra a caja/banco.
            </p>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-950/70 dark:text-white/70">
              Costo financiero
            </p>
            <p className="mt-1 text-sm font-semibold">
              {feeAmount || "—"}
            </p>
            <p className="mt-1 text-[11px] text-sky-950/65 dark:text-white/65">
              Sumatoria de costos por pago.
            </p>
          </article>

          <article className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-950/70 dark:text-white/70">
              Total cliente
            </p>
            <p className="mt-1 text-sm font-semibold">
              {clientTotal || "—"}
            </p>
            <p className="mt-1 text-[11px] text-sky-950/65 dark:text-white/65">
              Cobro + costo financiero.
            </p>
          </article>
        </div>

        <div className="md:col-span-2">
          {errors.amount && (
            <p className="mt-1 text-xs text-red-600">{errors.amount}</p>
          )}
          {suggestions?.base != null && (
            <button
              type="button"
              onClick={applySuggestedAmounts}
              className="mt-2 text-xs underline underline-offset-2"
            >
              {currencyOverride
                ? "Usar valor base sugerido:"
                : "Ajustar al sugerido:"}{" "}
              {formatNum(suggestions.base, lockedCurrency || effectiveCurrency)}
            </button>
          )}
        </div>
      </Section>

      <Section
        title="Pagos"
        desc="Por cada método cargá importe, cuenta, moneda y costo financiero."
      >
        <div className="space-y-3 md:col-span-2">
          {errors.payments && (
            <p className="text-xs text-red-600">{errors.payments}</p>
          )}

          {paymentLines.map((line, idx) => {
            const method = paymentMethods.find(
              (m) => m.id_method === line.payment_method_id,
            );

            const isCredit =
              line.payment_method_id != null &&
              Number(line.payment_method_id) === Number(creditMethodId);

            const requiresAcc = !!method?.requires_account;

            const creditAccounts =
              line.operator_id != null
                ? creditAccountsByOperator[line.operator_id] || []
                : [];
            const loadingCredit =
              line.operator_id != null
                ? !!loadingCreditAccountsByOperator[line.operator_id]
                : false;
            const filteredAccountsForLine = getFilteredAccountsByCurrency(
              line.payment_currency || effectiveCurrency,
            );
            const lineCurrencyForCredit = (
              line.payment_currency || effectiveCurrency
            ).toUpperCase();

            const selectedCreditAccount = creditAccounts.find(
              (a) => a.id_credit_account === line.credit_account_id,
            );
            const fallbackCreditAccount =
              selectedCreditAccount ??
              (creditAccounts.length === 1 ? creditAccounts[0] : null);

            return (
              <div
                key={line.key}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-950/70 dark:text-white/70">
                    Pago #{idx + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() => removePaymentLine(line.key)}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10"
                    title="Quitar línea"
                  >
                    Quitar
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                  <div className="md:col-span-4">
                    <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                      Importe
                    </label>
                    <input
                      inputMode="decimal"
                      value={line.amount}
                      onChange={(e) =>
                        setPaymentLineAmount(
                          line.key,
                          formatMoneyInput(
                            e.target.value,
                            line.payment_currency || effectiveCurrency,
                            { preferDotDecimal: shouldPreferDotDecimal(e) },
                          ),
                        )
                      }
                      placeholder={formatNum(
                        0,
                        line.payment_currency || effectiveCurrency,
                      )}
                      className={inputBase}
                    />
                    {errors[`payment_amount_${idx}`] && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors[`payment_amount_${idx}`]}
                      </p>
                    )}
                  </div>

                  <div className="md:col-span-4">
                    <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                      Método
                    </label>
                    {loadingPicks ? (
                      <div className="flex h-[42px] items-center">
                        <Spinner />
                      </div>
                    ) : (
                      <select
                        value={line.payment_method_id ?? ""}
                        onChange={(e) =>
                          setPaymentLineMethod(
                            line.key,
                            e.target.value ? Number(e.target.value) : null,
                          )
                        }
                        className={`${inputBase} cursor-pointer appearance-none`}
                      >
                        <option value="">— Elegir —</option>
                        {paymentMethods.map((m) => (
                          <option key={m.id_method} value={m.id_method}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {errors[`payment_method_${idx}`] && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors[`payment_method_${idx}`]}
                      </p>
                    )}
                  </div>

                  <div className="md:col-span-4">
                    {isCredit ? (
                      <div className="space-y-3">
                        {/* Operador */}
                        <div>
                          <label className="ml-1 block text-sm font-medium">
                            Operador <span className="text-rose-600">*</span>
                          </label>
                          <select
                            className={`${inputBase} cursor-pointer appearance-none`}
                            value={line.operator_id ?? ""}
                            onChange={(e) =>
                              setPaymentLineOperator(
                                line.key,
                                e.target.value ? Number(e.target.value) : null,
                              )
                            }
                            disabled={!operators.length}
                          >
                            <option value="">
                              {operators.length
                                ? "Seleccionar operador…"
                                : "Sin operadores"}
                            </option>
                            {operators.map((o) => (
                              <option key={o.id_operator} value={o.id_operator}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                          {errors[`payment_operator_${idx}`] && (
                            <p className="mt-1 text-xs text-red-600">
                              {errors[`payment_operator_${idx}`]}
                            </p>
                          )}
                        </div>

                        {/* Cuenta crédito/corriente */}
                        <div>
                          <label className="ml-1 block text-sm font-medium">
                            Cuenta crédito/corriente{" "}
                            <span className="text-rose-600">*</span>
                          </label>

                          {loadingCredit ? (
                            <div className="flex h-[42px] items-center">
                              <Spinner />
                            </div>
                          ) : !line.operator_id ? (
                            <p className="text-sm text-sky-950/70 dark:text-white/70">
                              Elegí un operador para ver sus cuentas.
                            </p>
                          ) : creditAccounts.length === 0 ? (
                            <p className="text-sm text-sky-950/70 dark:text-white/70">
                              No hay cuentas crédito/corriente para este operador en{" "}
                              {lineCurrencyForCredit}.
                            </p>
                          ) : creditAccounts.length === 1 ? (
                            <div className="rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm">
                              <div className="font-semibold">
                                {fallbackCreditAccount?.name}
                              </div>
                              <div className="text-xs text-sky-950/70 dark:text-white/70">
                                Se impactará en esta cuenta crédito/corriente{" "}
                                {(
                                  fallbackCreditAccount?.currency ||
                                  lineCurrencyForCredit
                                )?.toUpperCase()}
                                .
                              </div>
                            </div>
                          ) : (
                            <select
                              className={`${inputBase} cursor-pointer appearance-none`}
                              value={line.credit_account_id ?? ""}
                              onChange={(e) =>
                                setPaymentLineCreditAccount(
                                  line.key,
                                  e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                )
                              }
                              disabled={
                                !line.operator_id || creditAccounts.length === 0
                              }
                            >
                              <option value="">
                                {!line.operator_id
                                  ? "Elegí operador primero…"
                                  : creditAccounts.length
                                    ? "Seleccionar cuenta crédito/corriente…"
                                    : "No hay cuentas crédito/corriente"}
                              </option>
                              {creditAccounts.map((a) => (
                                <option
                                  key={a.id_credit_account}
                                  value={a.id_credit_account}
                                >
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          )}

                          {errors[`payment_credit_account_${idx}`] && (
                            <p className="mt-1 text-xs text-red-600">
                              {errors[`payment_credit_account_${idx}`]}
                            </p>
                          )}

                          {!!line.operator_id &&
                            !loadingCredit &&
                            creditAccounts.length === 0 && (
                              <p className="mt-1 text-xs text-sky-950/70 dark:text-white/70">
                                No hay cuentas crédito/corriente para este operador en{" "}
                                {lineCurrencyForCredit}.
                              </p>
                            )}
                        </div>

                        {creditAccounts.length > 1 && (
                          <p className="text-xs text-sky-950/70 dark:text-white/70">
                            Elegí en qué cuenta crédito/corriente registrar este
                            cobro.
                          </p>
                        )}
                      </div>
                    ) : requiresAcc ? (
                      <>
                        <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                          Cuenta
                        </label>
                        <select
                          className={`${inputBase} cursor-pointer appearance-none`}
                          value={line.account_id ?? ""}
                          onChange={(e) =>
                            setPaymentLineAccount(
                              line.key,
                              e.target.value ? Number(e.target.value) : null,
                            )
                          }
                        >
                          <option value="">— Elegir —</option>
                          {filteredAccountsForLine.map((a) => (
                            <option key={a.id_account} value={a.id_account}>
                              {a.display_name || a.name}
                            </option>
                          ))}
                        </select>
                        {errors[`payment_account_${idx}`] && (
                          <p className="mt-1 text-xs text-red-600">
                            {errors[`payment_account_${idx}`]}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-sky-950/70 dark:text-white/70 md:pt-7">
                        (No requiere cuenta)
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                  <div className="md:col-span-4">
                    <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                      Moneda del cobro
                    </label>
                    {loadingPicks ? (
                      <div className="flex h-[42px] items-center">
                        <Spinner />
                      </div>
                    ) : (
                      <select
                        value={line.payment_currency || effectiveCurrency}
                        onChange={(e) => {
                          const nextCurrency = e.target.value;
                          setPaymentLineCurrency(line.key, nextCurrency);
                          if (line.amount) {
                            setPaymentLineAmount(
                              line.key,
                              formatMoneyInput(line.amount, nextCurrency),
                            );
                          }
                          if (line.fee_mode === "FIXED" && line.fee_value) {
                            setPaymentLineFeeValue(
                              line.key,
                              formatMoneyInput(line.fee_value, nextCurrency),
                            );
                          }
                        }}
                        className={`${inputBase} cursor-pointer appearance-none`}
                      >
                        {currencies
                          .filter((c) => c.enabled)
                          .map((c) => (
                            <option key={`${line.key}-${c.code}`} value={c.code}>
                              {c.code} {c.name ? `— ${c.name}` : ""}
                            </option>
                          ))}
                      </select>
                    )}
                    {errors[`payment_currency_${idx}`] && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors[`payment_currency_${idx}`]}
                      </p>
                    )}
                  </div>

                  <div className="md:col-span-4">
                    <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                      Costo financiero
                    </label>
                    <select
                      value={line.fee_mode}
                      onChange={(e) =>
                        setPaymentLineFeeMode(
                          line.key,
                          e.target.value as "NONE" | ReceiptPaymentFeeMode,
                        )
                      }
                      className={`${inputBase} cursor-pointer appearance-none`}
                    >
                      <option value="NONE">Sin costo</option>
                      <option value="PERCENT">Porcentaje (%)</option>
                      <option value="FIXED">Monto fijo</option>
                    </select>
                  </div>

                  <div className="md:col-span-4">
                    <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                      Valor del costo
                    </label>
                    <input
                      value={line.fee_value}
                      inputMode="decimal"
                      onChange={(e) => {
                        const next =
                          line.fee_mode === "FIXED"
                            ? formatMoneyInput(
                                e.target.value,
                                line.payment_currency || effectiveCurrency,
                                { preferDotDecimal: shouldPreferDotDecimal(e) },
                              )
                            : e.target.value;
                        setPaymentLineFeeValue(line.key, next);
                      }}
                      placeholder={
                        line.fee_mode === "PERCENT"
                          ? "Ej: 5"
                          : formatNum(
                              0,
                              line.payment_currency || effectiveCurrency,
                            )
                      }
                      className={inputBase}
                      disabled={line.fee_mode === "NONE"}
                    />
                    {errors[`payment_fee_value_${idx}`] && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors[`payment_fee_value_${idx}`]}
                      </p>
                    )}
                  </div>

                  <div className="md:col-span-12">
                    <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                      Impacta en deuda:{" "}
                      {formatNum(
                        getPaymentLineImpact(line.key),
                        line.payment_currency || effectiveCurrency,
                      )}
                      {line.fee_mode !== "NONE"
                        ? ` (CF: ${formatNum(
                            getPaymentLineFee(line.key),
                            line.payment_currency || effectiveCurrency,
                          )})`
                        : ""}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={addPaymentLine}
              className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
            >
              + Agregar método
            </button>
          </div>
        </div>
      </Section>

      {currencyOverride && (
        <Section
          title="Conversión (opcional)"
          desc="Usalo si cobrás en una moneda distinta al servicio."
        >
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-sky-950/70 dark:text-white/70 md:col-span-2">
            <p>
              Servicio en {lockedCurrency}.{" "}
              {hasMixedPaymentCurrencies
                ? "Cobro en múltiples monedas."
                : `Cobro en ${effectiveCurrency}.`}{" "}
              El PDF mostrará el valor base.
            </p>
            <div className="mt-2 grid gap-1 text-[11px]">
              <div>
                <span className="font-medium">Recibo (PDF):</span>{" "}
                {fmtMaybe(baseAmount, baseNum, baseCurrency || lockedCurrency)}
              </div>
              <div>
                <span className="font-medium">
                  Administración (entra al banco/caja):
                </span>{" "}
                {amountReceived || "—"}
              </div>
              <div>
                <span className="font-medium">Contravalor:</span>{" "}
                {counterAmount.trim()
                  ? fmtMaybe(
                      counterAmount,
                      counterNum,
                      counterCurrency || effectiveCurrency,
                    )
                  : hasMixedPaymentCurrencies
                    ? "—"
                    : amountReceived || "—"}
              </div>
            </div>
            {hasMixedPaymentCurrencies ? (
              <p className="mt-2 text-[10px] opacity-70">
                Con cobro en múltiples monedas, cargá el contravalor manualmente.
              </p>
            ) : (
              <p className="mt-2 text-[10px] opacity-70">
                Si dejás contravalor vacío, se toma el total cobrado.
              </p>
            )}
          </div>
          <Field
            id="base"
            label="Valor base (moneda del servicio)"
            hint="Ej.: 1500 USD (si es pago parcial, ingresá el parcial)."
          >
            <div className="flex gap-2">
              <input
                inputMode="decimal"
                value={baseAmount}
                onChange={(e) =>
                  setBaseAmount(
                    formatMoneyInput(
                      e.target.value,
                      baseCurrency || lockedCurrency || effectiveCurrency,
                      { preferDotDecimal: shouldPreferDotDecimal(e) },
                    ),
                  )
                }
                placeholder={formatNum(
                  0,
                  baseCurrency || lockedCurrency || effectiveCurrency,
                )}
                className={inputBase}
              />
              <select
                value={baseCurrency}
                onChange={(e) => {
                  const nextCurrency = e.target.value;
                  setBaseCurrency(nextCurrency);
                  if (baseAmount) {
                    setBaseAmount(
                      formatMoneyInput(baseAmount, nextCurrency || lockedCurrency),
                    );
                  }
                }}
                className={`${inputBase} cursor-pointer appearance-none`}
              >
                <option value="">Moneda</option>
                {currencies
                  .filter((c) => c.enabled)
                  .map((c) => (
                    <option key={`bc-${c.code}`} value={c.code}>
                      {c.code}
                    </option>
                  ))}
              </select>
            </div>
            {errors.base && (
              <p className="mt-1 text-xs text-red-600">{errors.base}</p>
            )}
          </Field>

          <Field
            id="counter"
            label="Contravalor (moneda del cobro)"
            hint="Ej.: 2.000.000 ARS"
          >
            <div className="flex gap-2">
              <input
                inputMode="decimal"
                value={counterAmount}
                onChange={(e) =>
                  setCounterAmount(
                    formatMoneyInput(
                      e.target.value,
                      counterCurrency || effectiveCurrency,
                      { preferDotDecimal: shouldPreferDotDecimal(e) },
                    ),
                  )
                }
                placeholder={formatNum(
                  0,
                  counterCurrency || effectiveCurrency,
                )}
                className={inputBase}
              />
              <select
                value={counterCurrency}
                onChange={(e) => {
                  const nextCurrency = e.target.value;
                  setCounterCurrency(nextCurrency);
                  if (counterAmount) {
                    setCounterAmount(
                      formatMoneyInput(counterAmount, nextCurrency || effectiveCurrency),
                    );
                  }
                }}
                className={`${inputBase} cursor-pointer appearance-none`}
              >
                <option value="">Moneda</option>
                {currencies
                  .filter((c) => c.enabled)
                  .map((c) => (
                    <option key={`cc-${c.code}`} value={c.code}>
                      {c.code}
                    </option>
                  ))}
              </select>
            </div>
            {errors.counter && (
              <p className="mt-1 text-xs text-red-600">{errors.counter}</p>
            )}
          </Field>
        </Section>
      )}

      {showServiceAllocationSection && (
        <Section
          title="Ajustar monto por servicio"
          desc="Asigná cuánto del cobro corresponde a cada servicio seleccionado."
        >
          <div className="space-y-3 md:col-span-2">
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3">
              <div>
                <p className="text-sm font-medium">Ajuste por servicio</p>
                <p className="text-xs text-sky-950/70 dark:text-white/70">
                  Activalo para distribuir el cobro por servicio.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={manualServiceAllocationsEnabled}
                onClick={() =>
                  allocationServices.length > 0 &&
                  setManualServiceAllocationsEnabled(
                    !manualServiceAllocationsEnabled,
                  )
                }
                disabled={allocationServices.length === 0}
                className={[
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  manualServiceAllocationsEnabled
                    ? "bg-sky-500/70"
                    : "bg-sky-950/20 dark:bg-white/20",
                  allocationServices.length === 0
                    ? "cursor-not-allowed opacity-60"
                    : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                    manualServiceAllocationsEnabled ? "translate-x-5" : "translate-x-1",
                  ].join(" ")}
                />
              </button>
            </div>

            {allocationServices.length === 0 && (
              <p className="text-xs text-sky-950/70 dark:text-white/70">
                Seleccioná servicios para poder asignar montos.
              </p>
            )}

            {manualServiceAllocationsEnabled && allocationServices.length > 0 && (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { value: "manual", label: "Manual" },
                          {
                            value: "split_payment",
                            label: "Dividir monto del pago",
                          },
                          { value: "use_costs", label: "Usar costos" },
                        ] as Array<{
                          value: ServiceAllocationPresetMode;
                          label: string;
                        }>
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => applyServiceAllocationPreset(opt.value)}
                          className={[
                            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                            serviceAllocationPresetMode === opt.value
                              ? "border-sky-300/60 bg-sky-500/15 text-sky-700 dark:text-sky-200"
                              : "border-white/20 bg-white/10 text-sky-950/80 hover:bg-white/15 dark:text-white/80",
                          ].join(" ")}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-sky-950/70 dark:text-white/70">
                      Disponible (cobro + CF) en {selectedAllocationCurrency}:{" "}
                      {formatNum(
                        paymentAvailableForSelectedCurrency,
                        selectedAllocationCurrency,
                      )}
                    </p>
                  </div>
                </div>

                {allocationDeltaWarnings.length > 0 && (
                  <div className="rounded-2xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                    {allocationDeltaWarnings.map((warn) => (
                      <p key={`alloc-delta-${warn.code}`}>
                        En {warn.code}: asignado{" "}
                        <b>{formatNum(warn.allocated, warn.code)}</b> vs cobro+CF{" "}
                        <b>{formatNum(warn.available, warn.code)}</b>{" "}
                        ({warn.delta > 0 ? "exceso" : "faltante"}{" "}
                        {formatNum(Math.abs(warn.delta), warn.code)}).
                      </p>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  {allocationServices.map((service) => {
                    const serviceCurrency = (
                      service.currency || "ARS"
                    ).toUpperCase();
                    const paymentCurrency = (
                      serviceAllocationPaymentCurrencyById[service.id_service] ||
                      allocationPaymentCurrencyOptions[0] ||
                      effectiveCurrency ||
                      serviceCurrency
                    ).toUpperCase();
                    const paymentBudget =
                      paymentAvailableForAllocationByCurrency[paymentCurrency] || 0;
                    const rawSale = Number(service.sale_price ?? 0);
                    const sale = Number.isFinite(rawSale) ? rawSale : 0;
                    const paymentCurrencyWithoutPayment =
                      !allocationPaymentCurrencyOptions.includes(paymentCurrency);
                    return (
                      <div
                        key={`alloc-${service.id_service}`}
                        className="rounded-2xl border border-white/10 bg-white/5 p-4"
                      >
                        <div className="mb-3 text-sm font-medium">
                          Servicio interno N°{" "}
                          {service.agency_service_id != null
                            ? service.agency_service_id
                            : "—"}{" "}
                          {service.type
                            ? `· ${service.type}`
                            : service.description || "Servicio"}
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                          <div className="md:col-span-4">
                            <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                              Monto servicio ({serviceCurrency})
                            </label>
                            <input
                              inputMode="decimal"
                              value={
                                serviceAllocationAmountsById[service.id_service] || ""
                              }
                              onChange={(e) =>
                                setServiceAllocationAmount(
                                  service.id_service,
                                  formatMoneyInput(e.target.value, serviceCurrency, {
                                    preferDotDecimal: shouldPreferDotDecimal(e),
                                  }),
                                )
                              }
                              placeholder={formatNum(0, serviceCurrency)}
                              className={inputBase}
                            />
                          </div>

                          <div className="md:col-span-3">
                            <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                              Moneda cobro
                            </label>
                            <select
                              value={paymentCurrency}
                              onChange={(e) =>
                                setServiceAllocationPaymentCurrency(
                                  service.id_service,
                                  e.target.value,
                                )
                              }
                              className={`${inputBase} cursor-pointer appearance-none`}
                            >
                              {allocationSelectableCurrencies.map((code) => (
                                <option
                                  key={`alloc-cur-${service.id_service}-${code}`}
                                  value={code}
                                >
                                  {code}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-5">
                            {paymentCurrency !== serviceCurrency && (
                              <>
                                <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                                  Contravalor ({paymentCurrency})
                                </label>
                                <input
                                  inputMode="decimal"
                                  value={
                                    serviceAllocationPaymentAmountsById[
                                      service.id_service
                                    ] || ""
                                  }
                                  onChange={(e) =>
                                    setServiceAllocationPaymentAmount(
                                      service.id_service,
                                      formatMoneyInput(
                                        e.target.value,
                                        paymentCurrency,
                                        {
                                          preferDotDecimal: shouldPreferDotDecimal(e),
                                        },
                                      ),
                                    )
                                  }
                                  placeholder={formatNum(0, paymentCurrency)}
                                  className={inputBase}
                                />
                              </>
                            )}
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className={`${pillBase} ${pillNeutral}`}>
                            Venta: {formatNum(sale, serviceCurrency)}
                          </span>
                          <span className={`${pillBase} ${pillNeutral}`}>
                            Presupuesto: {formatNum(paymentBudget, paymentCurrency)}
                          </span>
                        </div>
                        {paymentCurrencyWithoutPayment && (
                          <p className="mt-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                            No hay pagos directos en {paymentCurrency}. Cargá
                            contravalor y verificá que la conversión por servicio
                            cierre contra cobros y conversión general.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {errors.service_allocations && (
              <p className="text-xs text-red-600">{errors.service_allocations}</p>
            )}
          </div>
        </Section>
      )}

      <Section
        title="Importe en palabras"
        desc='Debe coincidir con el valor aplicado (ej.: "UN MILLÓN CIEN MIL").'
      >
        <Field id="amount_words" label="Equivalente en palabras" required>
          <input
            id="amount_words"
            value={amountWords}
            onChange={(e) => setAmountWords(e.target.value)}
            placeholder='Ej.: "UN MILLÓN CIEN MIL"'
            className={inputBase}
          />
          {errors.amountWords && (
            <p className="mt-1 text-xs text-red-600">{errors.amountWords}</p>
          )}
        </Field>
      </Section>

      <Section
        title="Detalle para PDF"
        desc="Texto visible en el recibo. Si no escribís nada, se autogenera."
      >
        <div className="md:col-span-2">
          <Field
            id="payment_desc"
            label="Método de pago (detalle para el PDF)"
            required
          >
            <input
              id="payment_desc"
              value={paymentDescription}
              onChange={(e) => setPaymentDescription(e.target.value)}
              placeholder="Ej.: Efectivo: 100 USD + Transferencia: 200 USD (si querés, agregá detalle entre paréntesis)"
              className={inputBase}
            />
            {errors.paymentDescription && (
              <p className="mt-1 text-xs text-red-600">
                {errors.paymentDescription}
              </p>
            )}
          </Field>

          <div className="mt-3">
            <Field id="concept" label="Concepto">
              <input
                id="concept"
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="Ej.: Pago parcial reserva N° 1024"
                className={inputBase}
              />
            </Field>
          </div>
        </div>
      </Section>
    </>
  );
}
