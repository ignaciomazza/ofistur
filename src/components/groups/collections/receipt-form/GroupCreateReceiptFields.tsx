// src/components/receipts/receipt-form/CreateReceiptFields.tsx
"use client";

import React from "react";
import ClientPicker from "@/components/clients/ClientPicker";
import type {
  CurrencyCode,
  FinanceAccount,
  FinanceCurrency,
  FinancePaymentMethod,
} from "@/types/receipts";
import type { Client } from "@/types";
import Spinner from "@/components/Spinner";
import { parseAmountInput } from "@/utils/receipts/receiptForm";
import { Field, Section, inputBase } from "./primitives";

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

  operator_id: number | null;

  credit_account_id: number | null;
};

export default function GroupCreateReceiptFields(props: {
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
  setFeeAmount: (v: string) => void;
  clientTotal: string;

  lockedCurrency: string | null;
  loadingPicks: boolean;

  currencies: FinanceCurrency[];
  freeCurrency: CurrencyCode;
  setFreeCurrency: (v: CurrencyCode) => void;
  effectiveCurrency: CurrencyCode;
  currencyOverride: boolean;
  conversionEnabled: boolean;
  conversionRequired: boolean;
  setConversionEnabled: (next: boolean) => void;

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
  amountWordsISO: string;
  setAmountWordsISO: (v: string) => void;

  // picks
  paymentMethods: FinancePaymentMethod[];
  accounts: FinanceAccount[];
  filteredAccounts: FinanceAccount[];

  // pagos múltiples
  paymentLines: PaymentDraft[];
  addPaymentLine: () => void;
  removePaymentLine: (key: string) => void;
  setPaymentLineAmount: (key: string, v: string) => void;
  setPaymentLineMethod: (key: string, methodId: number | null) => void;
  setPaymentLineAccount: (key: string, accountId: number | null) => void;

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
    setFeeAmount,
    clientTotal,

    lockedCurrency,
    loadingPicks,

    currencies,
    freeCurrency,
    setFreeCurrency,
    effectiveCurrency,
    currencyOverride,
    conversionEnabled,
    conversionRequired,
    setConversionEnabled,

    suggestions,
    applySuggestedAmounts,
    formatNum,

    amountWords,
    setAmountWords,
    amountWordsISO,
    setAmountWordsISO,

    paymentMethods,
    filteredAccounts,

    paymentLines,
    addPaymentLine,
    removePaymentLine,
    setPaymentLineAmount,
    setPaymentLineMethod,
    setPaymentLineAccount,
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

    errors,
  } = props;

  const baseNum = parseAmountInput(baseAmount);
  const counterNum = parseAmountInput(counterAmount);
  const paymentsNum = parseAmountInput(amountReceived);

  const fmtMaybe = (raw: string, num: number | null, cur: string | null) => {
    if (num != null && cur) return formatNum(num, cur);
    if (raw && cur) return `${raw} ${cur}`;
    return "—";
  };

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
            className="rounded-full border border-sky-300/80 bg-sky-100/80 px-2 py-1 text-[13px] font-semibold text-sky-900 shadow-sm shadow-sky-100/60 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-700 dark:bg-sky-900/25 dark:text-sky-100 md:text-sm"
            disabled={clientsCount <= 1}
          >
            −
          </button>
          <span className="rounded-full border border-sky-200/70 bg-sky-50/45 px-3 py-1 text-[13px] font-medium text-slate-700 dark:border-sky-900/40 dark:bg-slate-900/55 dark:text-slate-200 md:text-sm">
            {clientsCount}
          </span>
          <button
            type="button"
            onClick={onIncClient}
            className="rounded-full border border-sky-300/80 bg-sky-100/80 px-2 py-1 text-[13px] font-semibold text-sky-900 shadow-sm shadow-sky-100/60 transition active:scale-[0.98] dark:border-sky-700 dark:bg-sky-900/25 dark:text-sky-100 md:text-sm"
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
        desc="Se calcula desde las líneas de pago. Esta moneda es la del cobro."
      >
        <Field
          id="amount_received"
          label="Total cobrado (entra al banco/caja)"
          hint="Suma de los importes cargados abajo."
          required
        >
          <input
            id="amount_received"
            value={amountReceived}
            readOnly
            disabled
            className="w-full rounded-xl border border-sky-200/70 bg-sky-50/45 p-2 px-3 text-[13px] text-slate-700 dark:border-sky-900/40 dark:bg-slate-900/55 dark:text-slate-300 md:text-sm"
          />
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
        </Field>

        <Field
          id="fee_amount"
          label="Costo financiero (retención del medio. Ej: Intereses de tarjeta)"
          hint="Solo si el medio retiene parte del cobro."
        >
          <input
            id="fee_amount"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
            placeholder="0,00"
            className={inputBase}
          />
          {!currencyOverride && suggestions?.fee != null && (
            <button
              type="button"
              onClick={applySuggestedAmounts}
              className="mt-2 text-xs underline underline-offset-2"
            >
              Usar costo financiero sugerido:{" "}
              {formatNum(suggestions.fee, lockedCurrency || effectiveCurrency)}
            </button>
          )}
        </Field>

        <Field
          id="client_total"
          label="Total con costo financiero"
          hint="Pagos + retención del medio."
        >
          <input
            id="client_total"
            value={clientTotal ? `${clientTotal} ${effectiveCurrency}` : ""}
            readOnly
            disabled
            className="w-full rounded-xl border border-sky-200/70 bg-sky-50/45 p-2 px-3 text-[13px] text-slate-700 dark:border-sky-900/40 dark:bg-slate-900/55 dark:text-slate-300 md:text-sm"
          />
        </Field>

        <Field id="currency" label="Moneda del cobro" required>
          {loadingPicks ? (
            <div className="flex h-[42px] items-center">
              <Spinner />
            </div>
          ) : (
            <select
              id="currency"
              value={freeCurrency}
              onChange={(e) => setFreeCurrency(e.target.value as CurrencyCode)}
              className={`${inputBase} cursor-pointer appearance-none`}
            >
              {currencies
                .filter((c) => c.enabled)
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} {c.name ? `— ${c.name}` : ""}
                  </option>
                ))}
            </select>
          )}
          {lockedCurrency && (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Servicios en {lockedCurrency}. Si cobrás en otra moneda, completá
              Valor base y Contravalor.
            </p>
          )}
          {errors.currency && (
            <p className="mt-1 text-xs text-red-600">{errors.currency}</p>
          )}
        </Field>
      </Section>

      <Section
        title="Pagos"
        desc={`Acá cargás varios métodos. Importes en ${effectiveCurrency}.`}
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

            const selectedCreditAccount = creditAccounts.find(
              (a) => a.id_credit_account === line.credit_account_id,
            );
            const fallbackCreditAccount =
              selectedCreditAccount ??
              (creditAccounts.length === 1 ? creditAccounts[0] : null);

            return (
              <div
                key={line.key}
                className="rounded-2xl border border-sky-200/70 bg-sky-50/45 p-4 dark:border-sky-900/40 dark:bg-slate-900/55"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                  <div className="md:col-span-3">
                    <label className="ml-1 block text-[13px] font-medium text-slate-900 dark:text-slate-100 md:text-sm">
                      Importe
                    </label>
                    <input
                      value={line.amount}
                      onChange={(e) =>
                        setPaymentLineAmount(line.key, e.target.value)
                      }
                      placeholder="0,00"
                      className={inputBase}
                    />
                    {errors[`payment_amount_${idx}`] && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors[`payment_amount_${idx}`]}
                      </p>
                    )}
                  </div>

                  <div className="md:col-span-4">
                    <label className="ml-1 block text-[13px] font-medium text-slate-900 dark:text-slate-100 md:text-sm">
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
                          <label className="ml-1 block text-[13px] font-medium text-slate-900 dark:text-slate-100 md:text-sm">
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

                        {/* Cuenta crédito */}
                        <div>
                          <label className="ml-1 block text-[13px] font-medium text-slate-900 dark:text-slate-100 md:text-sm">
                            Cuenta crédito{" "}
                            <span className="text-rose-600">*</span>
                          </label>

                          {loadingCredit ? (
                            <div className="flex h-[42px] items-center">
                              <Spinner />
                            </div>
                          ) : !line.operator_id ? (
                            <p className="text-[13px] text-slate-600 dark:text-slate-400 md:text-sm">
                              Elegí un operador para ver sus cuentas.
                            </p>
                          ) : creditAccounts.length === 0 ? (
                            <p className="text-[13px] text-slate-600 dark:text-slate-400 md:text-sm">
                              No hay cuentas crédito para este operador en{" "}
                              {effectiveCurrency}.
                            </p>
                          ) : creditAccounts.length === 1 ? (
                            <div className="rounded-xl border border-sky-200/70 bg-white/80 px-3 py-2 text-[13px] dark:border-sky-900/40 dark:bg-slate-900/60 md:text-sm">
                              <div className="font-semibold">
                                {fallbackCreditAccount?.name}
                              </div>
                              <div className="text-xs text-slate-600 dark:text-slate-400">
                                Se impactará en esta cuenta crédito{" "}
                                {(
                                  fallbackCreditAccount?.currency ||
                                  effectiveCurrency
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
                                    ? "Seleccionar cuenta crédito…"
                                    : "No hay cuentas crédito"}
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
                              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                No hay cuentas crédito para este operador en{" "}
                                {effectiveCurrency}.
                              </p>
                            )}
                        </div>

                        {creditAccounts.length > 1 && (
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            Elegí en qué cuenta crédito registrar este cobro.
                          </p>
                        )}
                      </div>
                    ) : requiresAcc ? (
                      <>
                        <label className="ml-1 block text-[13px] font-medium text-slate-900 dark:text-slate-100 md:text-sm">
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
                          {filteredAccounts.map((a) => (
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
                      <div className="text-[13px] text-slate-600 dark:text-slate-400 md:pt-7 md:text-sm">
                        (No requiere cuenta)
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end md:col-span-1">
                    <button
                      type="button"
                      onClick={() => removePaymentLine(line.key)}
                      className="rounded-full border border-slate-300/80 bg-white/85 px-3 py-2 text-[13px] text-slate-700 shadow-sm shadow-slate-900/10 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800/70 md:text-sm"
                      title="Quitar línea"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={addPaymentLine}
              className="rounded-full border border-sky-300/80 bg-sky-100/80 px-4 py-2 text-[13px] font-medium text-sky-900 shadow-sm shadow-sky-100/60 transition hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/25 dark:text-sky-100 dark:hover:bg-sky-900/35 md:text-sm"
            >
              + Agregar método
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Importe en palabras (PDF)"
        desc='Debe coincidir con el valor aplicado (ej.: "UN MILLÓN CIEN MIL" + Moneda).'
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

        <Field id="amount_words_iso" label="Moneda del texto" required>
          <select
            id="amount_words_iso"
            value={amountWordsISO}
            onChange={(e) => setAmountWordsISO(e.target.value)}
            className={`${inputBase} cursor-pointer appearance-none`}
          >
            <option value="">— Elegir —</option>
            {currencies
              .filter((c) => c.enabled)
              .map((c) => (
                <option key={`w-${c.code}`} value={c.code}>
                  {c.code}
                </option>
              ))}
          </select>
          {errors.amountWordsISO && (
            <p className="mt-1 text-xs text-red-600">{errors.amountWordsISO}</p>
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
        </div>
      </Section>

      <Section title="Concepto" desc="Opcional — visible en el recibo.">
        <div className="md:col-span-2">
          <Field id="concept" label="Detalle / Concepto">
            <input
              id="concept"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Ej.: Pago parcial reserva N° 1024"
              className={inputBase}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Conversión (opcional)"
        desc="Usalo si cobrás en una moneda distinta al servicio."
      >
        <div className="md:col-span-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200 md:text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 bg-white text-sky-600 shadow-sm shadow-slate-900/10 focus:ring-sky-300 dark:border-slate-600 dark:bg-slate-900"
              checked={conversionEnabled}
              onChange={(e) => setConversionEnabled(e.target.checked)}
              disabled={conversionRequired}
            />
            Registrar valor / contravalor
          </label>
          {conversionRequired && (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Obligatorio cuando cobrás en una moneda distinta al servicio.
            </p>
          )}
        </div>

        {conversionEnabled && (
          <>
            {currencyOverride && (
              <div className="rounded-2xl border border-sky-200/70 bg-sky-50/45 p-4 text-xs text-slate-700 dark:border-sky-900/40 dark:bg-slate-900/55 dark:text-slate-300 md:col-span-2">
                <p>
                  Servicio en {lockedCurrency}. Cobro en {effectiveCurrency}. El
                  PDF mostrará el valor base.
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
                    {fmtMaybe(amountReceived, paymentsNum, effectiveCurrency)}
                  </div>
                  <div>
                    <span className="font-medium">Contravalor:</span>{" "}
                    {fmtMaybe(
                      counterAmount || amountReceived,
                      counterNum ?? paymentsNum,
                      counterCurrency || effectiveCurrency,
                    )}
                  </div>
                </div>
                <p className="mt-2 text-[10px] opacity-70">
                  Si dejás contravalor vacío, se toma el total cobrado.
                </p>
              </div>
            )}

            <Field
              id="base"
              label="Valor base (moneda del servicio)"
              hint="Ej.: 1500 USD (si es pago parcial, ingresá el parcial)."
              required={conversionRequired}
            >
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={baseAmount}
                  onChange={(e) => setBaseAmount(e.target.value)}
                  placeholder="1500"
                  className={inputBase}
                />
                <select
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
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
                  type="number"
                  step="0.01"
                  value={counterAmount}
                  onChange={(e) => setCounterAmount(e.target.value)}
                  placeholder="2000000"
                  className={inputBase}
                />
                <select
                  value={counterCurrency}
                  onChange={(e) => setCounterCurrency(e.target.value)}
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
          </>
        )}
      </Section>
    </>
  );
}
