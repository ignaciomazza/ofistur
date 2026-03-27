// src/app/investments/InvestmentsForm.tsx
"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import Spinner from "@/components/Spinner";
import { formatMoneyInput, shouldPreferDotDecimal } from "@/utils/moneyInput";
import { parseAmountInput } from "@/utils/receipts/receiptForm";
import type {
  InvestmentFormState,
  Operator,
  RecurringFormState,
  RecurringInvestment,
  User,
} from "./types";

const Section = ({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) => (
  <section className="rounded-2xl border border-white/10 bg-white/10 p-4">
    <div className="mb-3">
      <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
        {title}
      </h3>
      {desc && (
        <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
          {desc}
        </p>
      )}
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
  </section>
);

const Field = ({
  id,
  label,
  hint,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <div className={["space-y-1", className].filter(Boolean).join(" ")}>
    <label
      htmlFor={id}
      className="ml-1 block text-sm font-medium text-sky-950 dark:text-white"
    >
      {label} {required && <span className="text-rose-600">*</span>}
    </label>
    {children}
    {hint && (
      <p
        id={`${id}-hint`}
        className="ml-1 text-xs text-sky-950/70 dark:text-white/70"
      >
        {hint}
      </p>
    )}
  </div>
);

type InvestmentsFormProps = {
  isFormOpen: boolean;
  setIsFormOpen: Dispatch<SetStateAction<boolean>>;
  editingId: number | null;
  headerPills: ReactNode;
  operatorOnly?: boolean;
  showOperatorConversionSection?: boolean;
  operatorServicesSection?: ReactNode;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
  loading: boolean;
  deleteCurrent: () => void;
  form: InvestmentFormState;
  setForm: Dispatch<SetStateAction<InvestmentFormState>>;
  categoryOptions: string[];
  currencyOptions: string[];
  currencyDict: Record<string, string>;
  uiPaymentMethodOptions: string[];
  requiresAccountForMethod: (method: string) => boolean;
  accountOptions: string[];
  showAccount: boolean;
  previewAmount: string;
  previewBase: string;
  previewCounter: string;
  isOperador: boolean;
  isSueldo: boolean;
  isComision: boolean;
  isUserCategory: boolean;
  users: User[];
  operators: Operator[];
  inputClass: string;
  recurringOpen: boolean;
  setRecurringOpen: Dispatch<SetStateAction<boolean>>;
  recurringEditingId: number | null;
  recurringForm: RecurringFormState;
  setRecurringForm: Dispatch<SetStateAction<RecurringFormState>>;
  onSubmitRecurring: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
  savingRecurring: boolean;
  loadingRecurring: boolean;
  recurring: RecurringInvestment[];
  fetchRecurring: () => void | Promise<void>;
  resetRecurringForm: () => void;
  beginRecurringEdit: (rule: RecurringInvestment) => void;
  toggleRecurringActive: (rule: RecurringInvestment) => void | Promise<void>;
  deleteRecurring: (id: number) => void | Promise<void>;
  showRecurringAccount: boolean;
  recurringPaymentMethodOptions: string[];
  dayOptions: Array<number | string>;
  intervalOptions: Array<number | string>;
  previewRecurringAmount: string;
  previewRecurringBase: string;
  previewRecurringCounter: string;
  isRecurringOperador: boolean;
  isRecurringSueldo: boolean;
  isRecurringComision: boolean;
  isRecurringUserCategory: boolean;
  nextRecurringRun: (rule: RecurringInvestment) => Date;
};

export default function InvestmentsForm({
  isFormOpen,
  setIsFormOpen,
  editingId,
  headerPills,
  operatorOnly = false,
  showOperatorConversionSection = false,
  operatorServicesSection,
  onSubmit,
  loading,
  deleteCurrent,
  form,
  setForm,
  categoryOptions,
  currencyOptions,
  currencyDict,
  uiPaymentMethodOptions,
  requiresAccountForMethod,
  accountOptions,
  showAccount,
  previewAmount,
  previewBase,
  previewCounter,
  isOperador,
  isSueldo,
  isComision,
  isUserCategory,
  users,
  operators,
  inputClass,
  recurringOpen,
  setRecurringOpen,
  recurringEditingId,
  recurringForm,
  setRecurringForm,
  onSubmitRecurring,
  savingRecurring,
  loadingRecurring,
  recurring,
  fetchRecurring,
  resetRecurringForm,
  beginRecurringEdit,
  toggleRecurringActive,
  deleteRecurring,
  showRecurringAccount,
  recurringPaymentMethodOptions,
  dayOptions,
  intervalOptions,
  previewRecurringAmount,
  previewRecurringBase,
  previewRecurringCounter,
  isRecurringOperador,
  isRecurringSueldo,
  isRecurringComision,
  isRecurringUserCategory,
  nextRecurringRun,
}: InvestmentsFormProps) {
  const itemLabel = operatorOnly ? "pago" : "gasto";
  const allowRecurring = !operatorOnly;
  const [showRecurringContent, setShowRecurringContent] = useState(false);
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const lineUid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const defaultPaymentCurrency =
    form.payments?.[0]?.payment_currency ||
    form.currency ||
    currencyOptions[0] ||
    "ARS";
  const paymentSummary = useMemo(() => {
    const lines = form.payments || [];
    let total = 0;
    let fees = 0;
    const currencies = new Set<string>();
    for (const line of lines) {
      const amount = parseAmountInput(line.amount) ?? 0;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      total += amount;
      const feeValue = parseAmountInput(line.fee_value) ?? 0;
      if (line.fee_mode === "PERCENT") {
        fees += amount * ((Number.isFinite(feeValue) && feeValue > 0 ? feeValue : 0) / 100);
      } else if (line.fee_mode === "FIXED") {
        fees += Number.isFinite(feeValue) && feeValue > 0 ? feeValue : 0;
      }
      const code = String(line.payment_currency || defaultPaymentCurrency)
        .trim()
        .toUpperCase();
      if (code) currencies.add(code);
    }
    return {
      total: round2(total),
      feeTotal: round2(fees),
      currencies: Array.from(currencies),
    };
  }, [defaultPaymentCurrency, form.payments]);

  const formatMoney = (value: number, currency = defaultPaymentCurrency) => {
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: String(currency || "ARS").toUpperCase(),
        minimumFractionDigits: 2,
      }).format(Number.isFinite(value) ? value : 0);
    } catch {
      return `${(Number.isFinite(value) ? value : 0).toFixed(2)} ${String(
        currency || "ARS",
      ).toUpperCase()}`;
    }
  };

  const updatePaymentLine = (
    key: string,
    patch: Partial<InvestmentFormState["payments"][number]>,
  ) => {
    setForm((prev) => ({
      ...prev,
      payments: (prev.payments || []).map((line) =>
        line.key === key ? { ...line, ...patch } : line,
      ),
    }));
  };

  const addPaymentLine = () => {
    setForm((prev) => ({
      ...prev,
      payments: [
        ...(prev.payments || []),
        {
          key: lineUid(),
          amount: "",
          payment_method: "",
          account: "",
          payment_currency: String(
            prev.payments?.[0]?.payment_currency ||
              prev.currency ||
              currencyOptions[0] ||
              "ARS",
          )
            .trim()
            .toUpperCase(),
          fee_mode: "NONE",
          fee_value: "",
        },
      ],
    }));
  };

  const removePaymentLine = (key: string) => {
    setForm((prev) => {
      const next = (prev.payments || []).filter((line) => line.key !== key);
      if (next.length === 0) return prev;
      return { ...prev, payments: next };
    });
  };

  const addManualPdfItem = () => {
    setForm((prev) => ({
      ...prev,
      manual_pdf_items: [
        ...(prev.manual_pdf_items || []),
        {
          key: lineUid(),
          description: "",
          date_label: "",
        },
      ],
    }));
  };

  const removeManualPdfItem = (key: string) => {
    setForm((prev) => ({
      ...prev,
      manual_pdf_items: (prev.manual_pdf_items || []).filter(
        (item) => item.key !== key,
      ),
    }));
  };

  const setManualPdfItemDescription = (key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      manual_pdf_items: (prev.manual_pdf_items || []).map((item) =>
        item.key === key ? { ...item, description: value } : item,
      ),
    }));
  };

  const setManualPdfItemDateLabel = (key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      manual_pdf_items: (prev.manual_pdf_items || []).map((item) =>
        item.key === key ? { ...item, date_label: value } : item,
      ),
    }));
  };

  useEffect(() => {
    if (recurringOpen) setShowRecurringContent(true);
  }, [recurringOpen]);

  const renderManualPdfItemsBlock = () => (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Cargar ítems del recibo manualmente</p>
          <p className="text-xs text-sky-950/70 dark:text-white/70">
            Si lo activás, podés agregar, quitar y editar filas del detalle de
            servicios del PDF.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.manual_pdf_items_enabled}
          onClick={() =>
            setForm((prev) => {
              const nextEnabled = !prev.manual_pdf_items_enabled;
              return {
                ...prev,
                manual_pdf_items_enabled: nextEnabled,
                manual_pdf_items:
                  nextEnabled && (prev.manual_pdf_items || []).length === 0
                    ? [
                        {
                          key: lineUid(),
                          description: "",
                          date_label: "",
                        },
                      ]
                    : prev.manual_pdf_items || [],
              };
            })
          }
          className={[
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
            form.manual_pdf_items_enabled
              ? "bg-sky-500/70"
              : "bg-sky-950/20 dark:bg-white/20",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              form.manual_pdf_items_enabled ? "translate-x-5" : "translate-x-1",
            ].join(" ")}
          />
        </button>
      </div>

      {form.manual_pdf_items_enabled && (
        <div className="mt-3 space-y-2">
          {(form.manual_pdf_items || []).length === 0 && (
            <p className="text-xs text-sky-950/70 dark:text-white/70">
              Todavía no hay ítems manuales.
            </p>
          )}

          {(form.manual_pdf_items || []).map((item, idx) => (
            <div
              key={item.key}
              className="rounded-2xl border border-white/10 bg-white/5 p-3"
            >
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-950/70 dark:text-white/70">
                Ítem Nº {idx + 1}
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-end">
                <div className="md:col-span-7">
                  <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                    Descripción
                  </label>
                  <input
                    value={item.description}
                    onChange={(e) =>
                      setManualPdfItemDescription(item.key, e.target.value)
                    }
                    placeholder="Ej.: Hotel + excursión ciudad"
                    className={inputClass}
                  />
                </div>

                <div className="md:col-span-4">
                  <label className="ml-1 block text-xs font-semibold uppercase tracking-wide text-sky-950/75 dark:text-white/75">
                    Fecha (opcional)
                  </label>
                  <input
                    value={item.date_label}
                    onChange={(e) =>
                      setManualPdfItemDateLabel(item.key, e.target.value)
                    }
                    placeholder="Ej.: 10/04/2026 - 14/04/2026"
                    className={inputClass}
                  />
                </div>

                <div className="md:col-span-1">
                  <button
                    type="button"
                    onClick={() => removeManualPdfItem(item.key)}
                    className="inline-flex size-10 items-center justify-center rounded-full border border-white/20 hover:bg-white/10"
                    title="Quitar ítem"
                    aria-label={`Quitar ítem ${idx + 1}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      className="size-4"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.59.68-1.14 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={addManualPdfItem}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
            >
              + Agregar ítem
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <motion.div
      layout
      initial={{ maxHeight: 96, opacity: 1 }}
      animate={{
        maxHeight: isFormOpen ? 1600 : 96,
        opacity: 1,
        transition: { duration: 0.35, ease: "easeInOut" },
      }}
      className="mb-6 overflow-auto rounded-3xl border border-white/10 bg-white/10 text-sky-950 shadow-md shadow-sky-950/10 dark:text-white"
    >
      <div
        className={`sticky top-0 z-10 ${
          isFormOpen ? "rounded-t-3xl border-b" : ""
        } border-white/10 px-4 py-3 backdrop-blur-sm`}
      >
        <button
          type="button"
          onClick={() => setIsFormOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={isFormOpen}
          aria-controls="investments-form-body"
        >
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/20 dark:bg-white/10 dark:text-white">
              {isFormOpen ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 12h14"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              )}
            </div>
            <div>
              <p className="text-lg font-semibold">
                {operatorOnly
                  ? editingId
                    ? "Editar pago a Operador"
                    : "Pago a Operador"
                  : editingId
                    ? `Editar ${itemLabel}`
                    : `Cargar ${itemLabel}`}
              </p>
              <p className="text-xs opacity-70">
                {editingId
                  ? `Actualizá la información del ${itemLabel}.`
                  : operatorOnly
                    ? "Registrá pagos y asociá servicios del mismo operador."
                    : "Registrá gastos manuales y automáticos."}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">{headerPills}</div>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isFormOpen && (
          <motion.div
            key="body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.form
              id="investments-form-body"
              onSubmit={onSubmit}
              className="space-y-5 px-4 pb-6 pt-4 md:px-6"
            >
              <Section
                title={`Detalle del ${itemLabel}`}
                desc={
                  operatorOnly
                    ? "Descripción y fecha del pago."
                    : "Categoría, fecha y descripción."
                }
              >
                {operatorOnly ? (
                  <>
                    <Field id="description" label="Descripción" required>
                      <input
                        id="description"
                        className={inputClass}
                        value={form.description}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            description: e.target.value,
                          }))
                        }
                        placeholder={`Concepto / detalle del ${itemLabel}…`}
                        required
                      />
                    </Field>

                    <Field id="paid_at" label="Fecha de pago (opcional)">
                      <input
                        id="paid_at"
                        type="date"
                        className={`${inputClass} cursor-pointer`}
                        value={form.paid_at}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, paid_at: e.target.value }))
                        }
                      />
                    </Field>

                    <div className="md:col-span-2">
                      {renderManualPdfItemsBlock()}
                    </div>
                  </>
                ) : (
                  <>
                    <Field id="category" label="Categoría" required>
                      <select
                        id="category"
                        className={`${inputClass} cursor-pointer appearance-none`}
                        value={form.category}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            category: e.target.value,
                            user_id: null,
                            operator_id: null,
                          }))
                        }
                        required
                        disabled={categoryOptions.length === 0}
                      >
                        <option value="" disabled>
                          {categoryOptions.length
                            ? "Seleccionar…"
                            : "Sin categorías habilitadas"}
                        </option>
                        {categoryOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field id="paid_at" label="Fecha de pago (opcional)">
                      <input
                        id="paid_at"
                        type="date"
                        className={`${inputClass} cursor-pointer`}
                        value={form.paid_at}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, paid_at: e.target.value }))
                        }
                      />
                    </Field>

                    <Field
                      id="description"
                      label="Descripción"
                      required
                      className="md:col-span-2"
                    >
                      <input
                        id="description"
                        className={inputClass}
                        value={form.description}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            description: e.target.value,
                          }))
                        }
                        placeholder={`Concepto / detalle del ${itemLabel}…`}
                        required
                      />
                    </Field>

                    <div className="md:col-span-2">
                      {renderManualPdfItemsBlock()}
                    </div>
                  </>
                )}
              </Section>

              <section className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {operatorOnly && (
                  <Field id="category" label="Categoría" required>
                    <select
                      id="category"
                      className={`${inputClass} cursor-pointer appearance-none`}
                      value={form.category}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          category: e.target.value,
                          user_id: null,
                          operator_id: null,
                        }))
                      }
                      required
                      disabled={categoryOptions.length === 0}
                    >
                      <option value="" disabled>
                        {categoryOptions.length
                          ? "Seleccionar…"
                          : "Sin categorías habilitadas"}
                      </option>
                      {categoryOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {isOperador && (
                  <Field
                    id="operator_id"
                    label="Operador"
                    required
                    className={operatorOnly ? undefined : "md:col-span-2"}
                  >
                    <select
                      id="operator_id"
                      className={`${inputClass} cursor-pointer appearance-none`}
                      value={form.operator_id ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          operator_id: e.target.value
                            ? Number(e.target.value)
                            : null,
                        }))
                      }
                      required
                      disabled={operators.length === 0}
                    >
                      <option value="" disabled>
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
                  </Field>
                )}

                {isUserCategory && (
                  <Field
                    id="user_id"
                    label={
                      isSueldo ? "Empleado" : isComision ? "Vendedor" : "Usuario"
                    }
                    required
                    className="md:col-span-2"
                  >
                    <select
                      id="user_id"
                      className={`${inputClass} cursor-pointer appearance-none`}
                      value={form.user_id ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          user_id: e.target.value
                            ? Number(e.target.value)
                            : null,
                        }))
                      }
                      required
                      disabled={users.length === 0}
                    >
                      <option value="" disabled>
                        {users.length ? "Seleccionar usuario…" : "Sin usuarios"}
                      </option>
                      {users.map((u) => (
                        <option key={u.id_user} value={u.id_user}>
                          {u.first_name} {u.last_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {!operatorOnly && (
                  <Field
                    id="counterparty_name"
                    label="A quién se le paga"
                    hint="Opcional. Nombre de empresa o persona."
                    className="md:col-span-2"
                  >
                    <input
                      id="counterparty_name"
                      className={inputClass}
                      value={form.counterparty_name}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          counterparty_name: e.target.value,
                        }))
                      }
                      placeholder="Empresa o persona"
                      maxLength={160}
                    />
                  </Field>
                )}
                </div>
              </section>

              <Section
                title={operatorOnly ? "Pagos" : "Pago"}
                desc={
                  operatorOnly
                    ? "Por línea definí importe, método, cuenta, moneda y costo financiero."
                    : "Monto, moneda y método de pago."
                }
              >
                {operatorOnly ? (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs md:col-span-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <span>
                          <b>Total cobrado:</b>{" "}
                          {previewAmount ||
                            formatMoney(
                              paymentSummary.total,
                              paymentSummary.currencies[0] ||
                                defaultPaymentCurrency,
                            )}
                        </span>
                        <span>
                          <b>Costo financiero:</b>{" "}
                          {formatMoney(
                            paymentSummary.feeTotal,
                            paymentSummary.currencies[0] ||
                              defaultPaymentCurrency,
                          )}
                        </span>
                      </div>
                      {paymentSummary.currencies.length > 1 && (
                        <p className="mt-2 text-amber-700 dark:text-amber-300">
                          Todas las líneas deben usar la misma moneda.
                        </p>
                      )}
                    </div>

                    <div className="space-y-3 md:col-span-2">
                      {(form.payments || []).map((line, idx) => {
                        const requiresAccount = requiresAccountForMethod(
                          line.payment_method || "",
                        );
                        const rawAmount = parseAmountInput(line.amount);
                        const amount = rawAmount != null && rawAmount > 0 ? rawAmount : 0;
                        const rawFee = parseAmountInput(line.fee_value);
                        const feeValue = rawFee != null && rawFee > 0 ? rawFee : 0;
                        const feeAmount =
                          line.fee_mode === "PERCENT"
                            ? round2(amount * (feeValue / 100))
                            : line.fee_mode === "FIXED"
                              ? round2(feeValue)
                              : 0;
                        const lineCurrency =
                          line.payment_currency || defaultPaymentCurrency;
                        const impact = round2(amount + feeAmount);
                        return (
                          <div
                            key={line.key}
                            className="rounded-2xl border border-white/10 bg-white/5 p-4"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-950/70 dark:text-white/70">
                                Pago #{idx + 1}
                              </p>
                              {(form.payments || []).length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removePaymentLine(line.key)}
                                  aria-label={`Quitar pago ${idx + 1}`}
                                  title="Quitar pago"
                                  className="inline-flex items-center justify-center rounded-full border border-rose-300/50 bg-rose-500/10 p-1.5 text-rose-700 transition hover:bg-rose-500/20 active:scale-[0.98] dark:border-rose-300/30 dark:text-rose-300"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={1.8}
                                    className="size-4"
                                    aria-hidden="true"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.59.68-1.14 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                    />
                                  </svg>
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                              <Field
                                id={`payment_amount_${line.key}`}
                                label="Monto"
                                required
                              >
                                <input
                                  id={`payment_amount_${line.key}`}
                                  inputMode="decimal"
                                  className={inputClass}
                                  value={line.amount}
                                  onChange={(e) =>
                                    updatePaymentLine(line.key, {
                                      amount: formatMoneyInput(
                                        e.target.value,
                                        lineCurrency,
                                        {
                                          preferDotDecimal:
                                            shouldPreferDotDecimal(e),
                                        },
                                      ),
                                    })
                                  }
                                  placeholder={formatMoney(0, lineCurrency)}
                                  required
                                />
                              </Field>

                              <Field
                                id={`payment_method_${line.key}`}
                                label="Método de pago"
                                required
                              >
                                <select
                                  id={`payment_method_${line.key}`}
                                  className={`${inputClass} cursor-pointer appearance-none`}
                                  value={line.payment_method}
                                  onChange={(e) =>
                                    updatePaymentLine(line.key, {
                                      payment_method: e.target.value,
                                      account: requiresAccountForMethod(
                                        e.target.value,
                                      )
                                        ? line.account
                                        : "",
                                    })
                                  }
                                  required
                                  disabled={uiPaymentMethodOptions.length === 0}
                                >
                                  <option value="" disabled>
                                    {uiPaymentMethodOptions.length
                                      ? "Seleccionar método"
                                      : "Sin monedas habilitadas"}
                                  </option>
                                  {uiPaymentMethodOptions.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              </Field>

                              <Field
                                id={`payment_account_${line.key}`}
                                label="Cuenta"
                              >
                                {requiresAccount ? (
                                  <select
                                    id={`payment_account_${line.key}`}
                                    className={`${inputClass} cursor-pointer appearance-none`}
                                    value={line.account}
                                    onChange={(e) =>
                                      updatePaymentLine(line.key, {
                                        account: e.target.value,
                                      })
                                    }
                                    required={requiresAccount}
                                    disabled={accountOptions.length === 0}
                                  >
                                    <option value="" disabled>
                                      {accountOptions.length
                                        ? "Seleccionar cuenta"
                                        : "Sin cuentas habilitadas"}
                                    </option>
                                    {accountOptions.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="text-sm text-sky-950/70 dark:text-white/70 md:pt-2">
                                    (No requiere cuenta)
                                  </div>
                                )}
                              </Field>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                              <Field
                                id={`payment_currency_${line.key}`}
                                label="Moneda del cobro"
                                required
                              >
                                <select
                                  id={`payment_currency_${line.key}`}
                                  className={`${inputClass} cursor-pointer appearance-none`}
                                  value={line.payment_currency || defaultPaymentCurrency}
                                  onChange={(e) => {
                                    const nextCurrency =
                                      e.target.value.toUpperCase();
                                    setForm((prev) => ({
                                      ...prev,
                                      payments: (prev.payments || []).map(
                                        (item) => ({
                                          ...item,
                                          payment_currency: nextCurrency,
                                          amount: item.amount
                                            ? formatMoneyInput(
                                                item.amount,
                                                nextCurrency,
                                              )
                                            : "",
                                          fee_value:
                                            item.fee_mode === "FIXED" &&
                                            item.fee_value
                                              ? formatMoneyInput(
                                                  item.fee_value,
                                                  nextCurrency,
                                                )
                                              : item.fee_value,
                                        }),
                                      ),
                                    }));
                                  }}
                                  disabled={currencyOptions.length === 0}
                                >
                                  <option value="" disabled>
                                    {currencyOptions.length
                                      ? "Seleccionar moneda"
                                      : "Sin métodos habilitados"}
                                  </option>
                                  {currencyOptions.map((code) => (
                                    <option key={code} value={code}>
                                      {currencyDict[code]
                                        ? `${code} — ${currencyDict[code]}`
                                        : code}
                                    </option>
                                  ))}
                                </select>
                              </Field>

                              <Field id={`payment_fee_mode_${line.key}`} label="Costo financiero">
                                <select
                                  id={`payment_fee_mode_${line.key}`}
                                  className={`${inputClass} cursor-pointer appearance-none`}
                                  value={line.fee_mode}
                                  onChange={(e) => {
                                    const nextMode =
                                      e.target.value === "FIXED" ||
                                      e.target.value === "PERCENT"
                                        ? e.target.value
                                        : "NONE";
                                    const parsedCurrent =
                                      parseAmountInput(line.fee_value);
                                    const nextFeeValue =
                                      nextMode === "NONE"
                                        ? ""
                                        : nextMode === "FIXED"
                                          ? parsedCurrent != null
                                            ? formatMoneyInput(
                                                String(parsedCurrent),
                                                lineCurrency,
                                              )
                                            : ""
                                          : parsedCurrent != null
                                            ? String(parsedCurrent)
                                            : "";
                                    updatePaymentLine(line.key, {
                                      fee_mode: nextMode,
                                      fee_value: nextFeeValue,
                                    });
                                  }}
                                >
                                  <option value="NONE">Sin costo</option>
                                  <option value="PERCENT">Porcentaje (%)</option>
                                  <option value="FIXED">Monto fijo</option>
                                </select>
                              </Field>

                              <Field
                                id={`payment_fee_value_${line.key}`}
                                label={
                                  line.fee_mode === "PERCENT"
                                    ? "Porcentaje (%)"
                                    : "Monto"
                                }
                              >
                                <input
                                  id={`payment_fee_value_${line.key}`}
                                  type={
                                    line.fee_mode === "PERCENT"
                                      ? "number"
                                      : "text"
                                  }
                                  step={
                                    line.fee_mode === "PERCENT"
                                      ? "0.01"
                                      : undefined
                                  }
                                  min={line.fee_mode === "PERCENT" ? "0" : undefined}
                                  inputMode="decimal"
                                  className={inputClass}
                                  value={line.fee_value}
                                  onChange={(e) =>
                                    updatePaymentLine(line.key, {
                                      fee_value:
                                        line.fee_mode === "FIXED"
                                          ? formatMoneyInput(
                                              e.target.value,
                                              lineCurrency,
                                              {
                                                preferDotDecimal:
                                                  shouldPreferDotDecimal(e),
                                              },
                                            )
                                          : e.target.value,
                                    })
                                  }
                                  disabled={line.fee_mode === "NONE"}
                                  placeholder={
                                    line.fee_mode === "PERCENT"
                                      ? "0,00"
                                      : formatMoney(0, lineCurrency)
                                  }
                                />
                              </Field>
                            </div>

                            <div className="mt-2 text-xs text-sky-950/70 dark:text-white/70">
                              Impacta en deuda: {formatMoney(impact, lineCurrency)}
                              {line.fee_mode !== "NONE"
                                ? ` (CF: ${formatMoney(feeAmount, lineCurrency)})`
                                : ""}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                      <button
                        type="button"
                        onClick={addPaymentLine}
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-sky-950 transition hover:bg-white/10 active:scale-[0.98] dark:text-white"
                      >
                        + Agregar línea
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-3">
                      <Field id="amount" label="Monto" required>
                        <input
                          id="amount"
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          className={inputClass}
                          value={form.amount}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, amount: e.target.value }))
                          }
                          placeholder="0.00"
                          required
                        />
                        {form.amount && (
                          <div className="ml-1 mt-1 text-xs opacity-80">
                            {previewAmount}
                          </div>
                        )}
                      </Field>

                      <Field id="currency" label="Moneda" required>
                        <select
                          id="currency"
                          className={`${inputClass} cursor-pointer appearance-none`}
                          value={form.currency}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, currency: e.target.value }))
                          }
                          required
                          disabled={currencyOptions.length === 0}
                        >
                          <option value="" disabled>
                            {currencyOptions.length
                              ? "Seleccionar moneda"
                              : "Sin monedas habilitadas"}
                          </option>
                          {currencyOptions.map((code) => (
                            <option key={code} value={code}>
                              {currencyDict[code]
                                ? `${code} — ${currencyDict[code]}`
                                : code}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field id="payment_method" label="Método de pago" required>
                        <select
                          id="payment_method"
                          className={`${inputClass} cursor-pointer appearance-none`}
                          value={form.payment_method}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              payment_method: e.target.value,
                            }))
                          }
                          required
                          disabled={uiPaymentMethodOptions.length === 0}
                        >
                          <option value="" disabled>
                            {uiPaymentMethodOptions.length
                              ? "Seleccionar método"
                              : "Sin métodos habilitados"}
                          </option>
                          {uiPaymentMethodOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    {showAccount && (
                      <Field id="account" label="Cuenta" required className="md:col-span-2">
                        <select
                          id="account"
                          className={`${inputClass} cursor-pointer appearance-none`}
                          value={form.account}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, account: e.target.value }))
                          }
                          required={showAccount}
                          disabled={accountOptions.length === 0}
                        >
                          <option value="" disabled>
                            {accountOptions.length
                              ? "Seleccionar cuenta"
                              : "Sin cuentas habilitadas"}
                          </option>
                          {accountOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </>
                )}
              </Section>

              {(!operatorOnly || showOperatorConversionSection) && (
                <Section
                  title="Conversión (opcional)"
                  desc={
                    operatorOnly
                      ? "Visible cuando la moneda del pago difiere de la moneda de los servicios asociados."
                      : "Registra valor y contravalor si el acuerdo está en otra divisa."
                  }
                >
                  {!operatorOnly && (
                    <div className="md:col-span-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          role="switch"
                          aria-label="Activar conversión"
                          aria-checked={form.use_conversion}
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              use_conversion: !f.use_conversion,
                            }))
                          }
                          className={[
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                            form.use_conversion
                              ? "bg-sky-500/70"
                              : "bg-sky-950/20 dark:bg-white/20",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                              form.use_conversion
                                ? "translate-x-5"
                                : "translate-x-1",
                            ].join(" ")}
                          />
                        </button>
                      </div>
                    </div>
                  )}

                  {form.use_conversion && (
                    <>
                      {operatorOnly && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-sky-950/70 dark:text-white/70 md:col-span-2">
                          <p>
                            Servicio en{" "}
                            <b>{form.base_currency || "—"}</b>. Cobro en{" "}
                            <b>{form.counter_currency || form.currency || "—"}</b>.
                          </p>
                          <div className="mt-2 grid gap-1 text-[11px]">
                            <div>
                              <span className="font-medium">Valor base:</span>{" "}
                              {previewBase || "—"}
                            </div>
                            <div>
                              <span className="font-medium">Contravalor:</span>{" "}
                              {previewCounter || "—"}
                            </div>
                          </div>
                        </div>
                      )}

                      <Field
                        id="base_amount"
                        label={
                          operatorOnly
                            ? "Valor base (moneda del servicio)"
                            : "Valor base"
                        }
                        required
                      >
                        <div className="flex gap-2">
                          <input
                            type={operatorOnly ? "text" : "number"}
                            step={operatorOnly ? undefined : "0.01"}
                            min={operatorOnly ? undefined : "0"}
                            inputMode="decimal"
                            className={inputClass}
                            placeholder={
                              operatorOnly
                                ? formatMoney(
                                    0,
                                    form.base_currency ||
                                      currencyOptions[0] ||
                                      "ARS",
                                  )
                                : "0.00"
                            }
                            value={form.base_amount}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                base_amount: operatorOnly
                                  ? formatMoneyInput(
                                      e.target.value,
                                      f.base_currency ||
                                        currencyOptions[0] ||
                                        "ARS",
                                      {
                                        preferDotDecimal:
                                          shouldPreferDotDecimal(e),
                                      },
                                    )
                                  : e.target.value,
                              }))
                            }
                          />
                          <select
                            className={`${inputClass} cursor-pointer appearance-none`}
                            value={form.base_currency}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                base_currency: e.target.value,
                                base_amount:
                                  operatorOnly && f.base_amount
                                    ? formatMoneyInput(
                                        f.base_amount,
                                        e.target.value,
                                      )
                                    : f.base_amount,
                              }))
                            }
                            disabled={currencyOptions.length === 0}
                          >
                            <option value="" disabled>
                              {currencyOptions.length ? "Moneda" : "Sin monedas"}
                            </option>
                            {currencyOptions.map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </select>
                        </div>
                        {previewBase && (
                          <div className="ml-1 mt-1 text-xs opacity-70">
                            {previewBase}
                          </div>
                        )}
                      </Field>

                      <Field
                        id="counter_amount"
                        label={
                          operatorOnly
                            ? "Contravalor (moneda del cobro)"
                            : "Contravalor"
                        }
                        required
                      >
                        <div className="flex gap-2">
                          <input
                            type={operatorOnly ? "text" : "number"}
                            step={operatorOnly ? undefined : "0.01"}
                            min={operatorOnly ? undefined : "0"}
                            inputMode="decimal"
                            className={inputClass}
                            placeholder={
                              operatorOnly
                                ? formatMoney(
                                    0,
                                    form.counter_currency ||
                                      currencyOptions[0] ||
                                      "ARS",
                                  )
                                : "0.00"
                            }
                            value={form.counter_amount}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                counter_amount: operatorOnly
                                  ? formatMoneyInput(
                                      e.target.value,
                                      f.counter_currency ||
                                        currencyOptions[0] ||
                                        "ARS",
                                      {
                                        preferDotDecimal:
                                          shouldPreferDotDecimal(e),
                                      },
                                    )
                                  : e.target.value,
                              }))
                            }
                          />
                          <select
                            className={`${inputClass} cursor-pointer appearance-none`}
                            value={form.counter_currency}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                counter_currency: e.target.value,
                                counter_amount:
                                  operatorOnly && f.counter_amount
                                    ? formatMoneyInput(
                                        f.counter_amount,
                                        e.target.value,
                                      )
                                    : f.counter_amount,
                              }))
                            }
                            disabled={currencyOptions.length === 0}
                          >
                            <option value="" disabled>
                              {currencyOptions.length ? "Moneda" : "Sin monedas"}
                            </option>
                            {currencyOptions.map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </select>
                        </div>
                        {previewCounter && (
                          <div className="ml-1 mt-1 text-xs opacity-70">
                            {previewCounter}
                          </div>
                        )}
                      </Field>

                      <div className="text-xs opacity-70 md:col-span-2">
                        Se guarda el valor y contravalor <b>sin tipo de cambio</b>
                        . Útil si pagás en una moneda y el servicio está en otra.
                      </div>
                    </>
                  )}
                </Section>
              )}

              {operatorServicesSection}

              <div className="sticky bottom-2 z-10 flex justify-end gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] ${
                    loading
                      ? "cursor-not-allowed bg-sky-950/20 text-white/60 dark:bg-white/5 dark:text-white/40"
                      : "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                  }`}
                >
                  {loading ? (
                    <Spinner />
                  ) : editingId ? (
                    `Actualizar ${itemLabel}`
                  ) : (
                    `Agregar ${itemLabel}`
                  )}
                </button>

                {editingId && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`¿Eliminar este ${itemLabel}?`)) deleteCurrent();
                    }}
                    className="rounded-full bg-red-600 px-6 py-2 text-center text-red-100 shadow-sm shadow-red-950/20 transition active:scale-[0.98] dark:bg-red-800"
                    title={`Eliminar ${itemLabel}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.4}
                      stroke="currentColor"
                      className="size-6"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.59.68-1.14 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </motion.form>

            {allowRecurring && (
              <div className="px-4 pb-6 md:px-6">
                <div className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
                        Gasto automático
                      </h3>
                      <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
                        Programá gastos recurrentes (ej.: alquiler mensual).
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showRecurringContent}
                      onClick={() => setShowRecurringContent((prev) => !prev)}
                      className={[
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                        showRecurringContent
                          ? "bg-sky-500/70"
                          : "bg-sky-950/20 dark:bg-white/20",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                          showRecurringContent ? "translate-x-5" : "translate-x-1",
                        ].join(" ")}
                      />
                    </button>
                  </div>

                  {showRecurringContent && (
                    <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRecurringOpen((v) => !v)}
                      className="rounded-full border border-amber-200 bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-950 shadow-sm shadow-amber-900/10 transition-transform hover:scale-95 active:scale-90 dark:bg-amber-400/20 dark:text-amber-200"
                    >
                      {recurringOpen ? "Cerrar" : "Nuevo automático"}
                    </button>
                    <button
                      type="button"
                      onClick={fetchRecurring}
                      className="rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold text-sky-950 shadow-sm shadow-sky-950/10 transition active:scale-[0.98] dark:bg-white/10 dark:text-white"
                      title="Actualizar lista"
                    >
                      Actualizar
                    </button>
                  </div>
                </div>

                {recurringOpen && (
                  <form
                    onSubmit={onSubmitRecurring}
                    className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2"
                  >
                    <div>
                      <label className="ml-2 block">Categoría</label>
                      <select
                        className={`${inputClass} cursor-pointer appearance-none`}
                        value={recurringForm.category}
                        onChange={(e) =>
                          setRecurringForm((f) => ({
                            ...f,
                            category: e.target.value,
                            user_id: null,
                            operator_id: null,
                          }))
                        }
                        required
                        disabled={categoryOptions.length === 0}
                      >
                        <option value="" disabled>
                          {categoryOptions.length
                            ? "Seleccionar…"
                            : "Sin categorías habilitadas"}
                        </option>
                        {categoryOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="ml-2 block">Fecha de inicio</label>
                      <input
                        type="date"
                        className={`${inputClass} cursor-pointer`}
                        value={recurringForm.start_date}
                        onChange={(e) =>
                          setRecurringForm((f) => ({
                            ...f,
                            start_date: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="ml-2 block">Día del mes</label>
                      <select
                        className={`${inputClass} cursor-pointer appearance-none`}
                        value={recurringForm.day_of_month}
                        onChange={(e) =>
                          setRecurringForm((f) => ({
                            ...f,
                            day_of_month: e.target.value,
                          }))
                        }
                      >
                        {dayOptions.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="ml-2 block">Intervalo (meses)</label>
                      <select
                        className={`${inputClass} cursor-pointer appearance-none`}
                        value={recurringForm.interval_months}
                        onChange={(e) =>
                          setRecurringForm((f) => ({
                            ...f,
                            interval_months: e.target.value,
                          }))
                        }
                      >
                        {intervalOptions.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="ml-2 block">Descripción</label>
                      <input
                        className={inputClass}
                        value={recurringForm.description}
                        onChange={(e) =>
                          setRecurringForm((f) => ({
                            ...f,
                            description: e.target.value,
                          }))
                        }
                        placeholder="Detalle del gasto automático…"
                        required
                      />
                    </div>

                    <div>
                      <label className="ml-2 block">Monto</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        className={inputClass}
                        value={recurringForm.amount}
                        onChange={(e) =>
                          setRecurringForm((f) => ({
                            ...f,
                            amount: e.target.value,
                          }))
                        }
                        placeholder="0.00"
                        required
                      />
                      {recurringForm.amount && (
                        <div className="ml-1 mt-1 text-xs opacity-80">
                          {previewRecurringAmount}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="ml-2 block">Moneda</label>
                      <select
                        className={`${inputClass} cursor-pointer appearance-none`}
                        value={recurringForm.currency}
                        onChange={(e) =>
                          setRecurringForm((f) => ({
                            ...f,
                            currency: e.target.value,
                          }))
                        }
                        required
                        disabled={currencyOptions.length === 0}
                      >
                        <option value="" disabled>
                          {currencyOptions.length
                            ? "Seleccionar moneda"
                            : "Sin monedas habilitadas"}
                        </option>
                        {currencyOptions.map((code) => (
                          <option key={code} value={code}>
                            {currencyDict[code]
                              ? `${code} — ${currencyDict[code]}`
                              : code}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="ml-2 block">Método de pago</label>
                      <select
                        className={`${inputClass} cursor-pointer appearance-none`}
                        value={recurringForm.payment_method}
                        onChange={(e) =>
                          setRecurringForm((f) => ({
                            ...f,
                            payment_method: e.target.value,
                          }))
                        }
                        required
                        disabled={recurringPaymentMethodOptions.length === 0}
                      >
                        <option value="" disabled>
                          {recurringPaymentMethodOptions.length
                            ? "Seleccionar método"
                            : "Sin métodos habilitados"}
                        </option>
                        {recurringPaymentMethodOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>

                    {showRecurringAccount && (
                      <div>
                        <label className="ml-2 block">Cuenta</label>
                        <select
                          className={`${inputClass} cursor-pointer appearance-none`}
                          value={recurringForm.account}
                          onChange={(e) =>
                            setRecurringForm((f) => ({
                              ...f,
                              account: e.target.value,
                            }))
                          }
                          required={showRecurringAccount}
                          disabled={accountOptions.length === 0}
                        >
                          <option value="" disabled>
                            {accountOptions.length
                              ? "Seleccionar cuenta"
                              : "Sin cuentas habilitadas"}
                          </option>
                          {accountOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="md:col-span-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          role="switch"
                          aria-label="Activar conversión automática"
                          aria-checked={recurringForm.use_conversion}
                          onClick={() =>
                            setRecurringForm((f) => ({
                              ...f,
                              use_conversion: !f.use_conversion,
                            }))
                          }
                          className={[
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                            recurringForm.use_conversion
                              ? "bg-sky-500/70"
                              : "bg-sky-950/20 dark:bg-white/20",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                              recurringForm.use_conversion
                                ? "translate-x-5"
                                : "translate-x-1",
                            ].join(" ")}
                          />
                        </button>
                      </div>
                    </div>

                    {recurringForm.use_conversion && (
                      <>
                        <div>
                          <p className="mb-1 text-sm font-medium">Valor base</p>
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              inputMode="decimal"
                              className={`col-span-2 ${inputClass}`}
                              placeholder="0.00"
                              value={recurringForm.base_amount}
                              onChange={(e) =>
                                setRecurringForm((f) => ({
                                  ...f,
                                  base_amount: e.target.value,
                                }))
                              }
                            />
                            <select
                              className={`${inputClass} cursor-pointer appearance-none`}
                              value={recurringForm.base_currency}
                              onChange={(e) =>
                                setRecurringForm((f) => ({
                                  ...f,
                                  base_currency: e.target.value,
                                }))
                              }
                              disabled={currencyOptions.length === 0}
                            >
                              <option value="" disabled>
                                {currencyOptions.length
                                  ? "Moneda"
                                  : "Sin monedas"}
                              </option>
                              {currencyOptions.map((code) => (
                                <option key={code} value={code}>
                                  {code}
                                </option>
                              ))}
                            </select>
                          </div>
                          {previewRecurringBase && (
                            <div className="ml-1 mt-1 text-xs opacity-70">
                              {previewRecurringBase}
                            </div>
                          )}
                        </div>

                        <div>
                          <p className="mb-1 text-sm font-medium">
                            Contravalor
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              inputMode="decimal"
                              className={`col-span-2 ${inputClass}`}
                              placeholder="0.00"
                              value={recurringForm.counter_amount}
                              onChange={(e) =>
                                setRecurringForm((f) => ({
                                  ...f,
                                  counter_amount: e.target.value,
                                }))
                              }
                            />
                            <select
                              className={`${inputClass} cursor-pointer appearance-none`}
                              value={recurringForm.counter_currency}
                              onChange={(e) =>
                                setRecurringForm((f) => ({
                                  ...f,
                                  counter_currency: e.target.value,
                                }))
                              }
                              disabled={currencyOptions.length === 0}
                            >
                              <option value="" disabled>
                                {currencyOptions.length
                                  ? "Moneda"
                                  : "Sin monedas"}
                              </option>
                              {currencyOptions.map((code) => (
                                <option key={code} value={code}>
                                  {code}
                                </option>
                              ))}
                            </select>
                          </div>
                          {previewRecurringCounter && (
                            <div className="ml-1 mt-1 text-xs opacity-70">
                              {previewRecurringCounter}
                            </div>
                          )}
                        </div>

                        <div className="text-xs opacity-70 md:col-span-2">
                          Se guarda el valor y contravalor sin tipo de cambio.
                        </div>
                      </>
                    )}

                    {isRecurringOperador && (
                      <div className="md:col-span-2">
                        <label className="ml-2 block">Operador</label>
                        <select
                          className={`${inputClass} cursor-pointer appearance-none`}
                          value={recurringForm.operator_id ?? ""}
                          onChange={(e) =>
                            setRecurringForm((f) => ({
                              ...f,
                              operator_id: e.target.value
                                ? Number(e.target.value)
                                : null,
                            }))
                          }
                          required
                          disabled={operators.length === 0}
                        >
                          <option value="" disabled>
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
                      </div>
                    )}

                    {isRecurringUserCategory && (
                      <div className="md:col-span-2">
                        <label className="ml-2 block">
                          {isRecurringSueldo
                            ? "Empleado"
                            : isRecurringComision
                              ? "Vendedor"
                              : "Usuario"}
                        </label>
                        <select
                          className={`${inputClass} cursor-pointer appearance-none`}
                          value={recurringForm.user_id ?? ""}
                          onChange={(e) =>
                            setRecurringForm((f) => ({
                              ...f,
                              user_id: e.target.value
                                ? Number(e.target.value)
                                : null,
                            }))
                          }
                          required
                          disabled={users.length === 0}
                        >
                          <option value="" disabled>
                            {users.length
                              ? "Seleccionar usuario…"
                              : "Sin usuarios"}
                          </option>
                          {users.map((u) => (
                            <option key={u.id_user} value={u.id_user}>
                              {u.first_name} {u.last_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-white/30 bg-white/30 text-sky-600 shadow-sm shadow-sky-950/10 dark:border-white/20 dark:bg-white/10"
                          checked={recurringForm.active}
                          onChange={(e) =>
                            setRecurringForm((f) => ({
                              ...f,
                              active: e.target.checked,
                            }))
                          }
                        />
                        Activo
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-3 md:col-span-2">
                      <button
                        type="submit"
                        disabled={savingRecurring}
                        className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] ${
                          savingRecurring
                            ? "cursor-not-allowed bg-sky-950/20 text-white/60 dark:bg-white/5 dark:text-white/40"
                            : "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                        }`}
                      >
                        {savingRecurring ? (
                          <Spinner />
                        ) : recurringEditingId ? (
                          "Actualizar automático"
                        ) : (
                          "Guardar automático"
                        )}
                      </button>

                      {recurringEditingId && (
                        <button
                          type="button"
                          onClick={() => {
                            resetRecurringForm();
                            setRecurringOpen(false);
                          }}
                          className="rounded-full bg-sky-950/10 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] dark:bg-white/10 dark:text-white"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </form>
                )}

                <div className="mt-4">
                  {loadingRecurring ? (
                    <div className="flex items-center">
                      <Spinner />
                    </div>
                  ) : recurring.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sm opacity-80">
                      Todavía no tenés gastos automáticos.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {recurring.map((rule) => {
                        const nextRun = nextRecurringRun(rule);
                        const amountLabel = (() => {
                          try {
                            return new Intl.NumberFormat("es-AR", {
                              style: "currency",
                              currency: rule.currency,
                            }).format(rule.amount);
                          } catch {
                            return `${Number(rule.amount).toFixed(2)} ${rule.currency}`;
                          }
                        })();
                        return (
                          <div
                            key={rule.id_recurring}
                            className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold">
                                    {rule.category}
                                  </span>
                                  <span
                                    className={`${
                                      rule.active
                                        ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-200"
                                        : "rounded-full bg-amber-300/30 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-200"
                                    }`}
                                  >
                                    {rule.active ? "Activo" : "Pausado"}
                                  </span>
                                </div>
                                <div className="mt-1 text-base opacity-90">
                                  {rule.description}
                                </div>
                              </div>
                              <div className="text-right text-sm font-semibold">
                                {amountLabel}
                              </div>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs opacity-80">
                              <span>
                                Próximo: {nextRun.toLocaleDateString("es-AR")}
                              </span>
                              <span>
                                Día {rule.day_of_month} · cada{" "}
                                {rule.interval_months} mes
                                {rule.interval_months > 1 ? "es" : ""}
                              </span>
                              {rule.payment_method && (
                                <span>Método: {rule.payment_method}</span>
                              )}
                              {rule.account && (
                                <span>Cuenta: {rule.account}</span>
                              )}
                              {rule.operator && (
                                <span>Operador: {rule.operator.name}</span>
                              )}
                              {rule.user && (
                                <span>
                                  Usuario: {rule.user.first_name}{" "}
                                  {rule.user.last_name}
                                </span>
                              )}
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => beginRecurringEdit(rule)}
                                className="rounded-full bg-sky-950/10 px-4 py-2 text-xs font-semibold text-sky-950 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] dark:bg-white/10 dark:text-white"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleRecurringActive(rule)}
                                disabled={savingRecurring}
                                className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-emerald-900/20 transition active:scale-[0.98] disabled:opacity-60 dark:bg-emerald-500/80"
                              >
                                {rule.active ? "Pausar" : "Reactivar"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    confirm("¿Eliminar este gasto automático?")
                                  ) {
                                    deleteRecurring(rule.id_recurring);
                                  }
                                }}
                                className="rounded-full bg-amber-300 px-4 py-2 text-xs font-semibold text-amber-950 shadow-sm shadow-amber-900/10 transition active:scale-[0.98] dark:bg-amber-400/20 dark:text-amber-200"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                </>
                  )}
              </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
