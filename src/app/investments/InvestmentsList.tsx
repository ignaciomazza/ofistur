// src/app/investments/InvestmentsList.tsx
"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import Spinner from "@/components/Spinner";
import { authFetch } from "@/utils/authFetch";
import type { Investment, Operator } from "./types";

type Counters = {
  op: number;
  others: number;
  total: number;
  filtered: number;
};

type GroupedMonth = {
  key: string;
  label: string;
  items: Investment[];
  totals: Record<string, number>;
};

type InvestmentsListProps = {
  filterPanelClass: string;
  filterControlClass: string;
  q: string;
  setQ: Dispatch<SetStateAction<string>>;
  fetchList: () => void | Promise<void>;
  onExportCSV: () => void | Promise<void>;
  exportingCsv?: boolean;
  itemLabel?: string;
  searchPlaceholder?: string;
  showCategoryFilter?: boolean;
  showOperatorFilter?: boolean;
  showOperatorMode?: boolean;
  category: string;
  setCategory: Dispatch<SetStateAction<string>>;
  currency: string;
  setCurrency: Dispatch<SetStateAction<string>>;
  paymentMethodFilter: string;
  setPaymentMethodFilter: Dispatch<SetStateAction<string>>;
  accountFilter: string;
  setAccountFilter: Dispatch<SetStateAction<string>>;
  operatorFilter: number;
  setOperatorFilter: Dispatch<SetStateAction<number>>;
  categoryOptions: string[];
  currencyOptions: string[];
  paymentMethodOptions: string[];
  accountOptions: string[];
  operators: Operator[];
  operadorMode: "all" | "only" | "others";
  setOperadorMode: Dispatch<SetStateAction<"all" | "only" | "others">>;
  counters: Counters;
  resetFilters: () => void;
  viewMode: "cards" | "table" | "monthly";
  setViewMode: Dispatch<SetStateAction<"cards" | "table" | "monthly">>;
  totalsByCurrencyAll: Record<string, number>;
  totalsByCurrencyFiltered: Record<string, number>;
  loadingList: boolean;
  filteredItems: Investment[];
  groupedByMonth: GroupedMonth[];
  nextCursor: number | null;
  loadingMore: boolean;
  loadMore: () => void | Promise<void>;
  formatDate: (s?: string | null) => string;
  onEdit: (it: Investment) => void;
  token?: string | null;
  showOperatorPaymentPdf?: boolean;
  canDownloadOperatorPaymentPdf?: (it: Investment) => boolean;
};

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

function PaymentPdfButton({
  token,
  item,
  variant = "chip",
}: {
  token?: string | null;
  item: Investment;
  variant?: "chip" | "table";
}) {
  const [loading, setLoading] = useState(false);
  const paymentDisplayId = item.agency_investment_id ?? item.id_investment;
  const recipientName = item.operator?.name
    ? item.operator.name
    : item.user
      ? `${item.user.first_name} ${item.user.last_name}`
      : item.category || "Egreso";

  const downloadPDF = async () => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/investments/${item.id_investment}/pdf`,
        { headers: { Accept: "application/pdf" } },
        token,
      );
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Comprobante_Pago_${slugify(recipientName)}_${paymentDisplayId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Comprobante descargado exitosamente.");
    } catch {
      toast.error("No se pudo descargar el comprobante.");
    } finally {
      setLoading(false);
    }
  };

  const className =
    variant === "table"
      ? "rounded-full bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
      : "rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white";

  return (
    <button
      type="button"
      onClick={downloadPDF}
      disabled={loading}
      className={className}
      title="Descargar comprobante"
      aria-label="Descargar comprobante"
    >
      {loading ? (
        <Spinner />
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="size-4"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
      )}
    </button>
  );
}

function InvestmentCard({
  item,
  onEdit,
  formatDate,
  itemLabel,
  token,
  showOperatorPaymentPdf,
  canDownloadOperatorPaymentPdf,
}: {
  item: Investment;
  onEdit: (it: Investment) => void;
  formatDate: (s?: string | null) => string;
  itemLabel: string;
  token?: string | null;
  showOperatorPaymentPdf?: boolean;
  canDownloadOperatorPaymentPdf?: (it: Investment) => boolean;
}) {
  const bookingNumber = item.booking?.agency_booking_id ?? item.booking_id;
  const showPdf =
    typeof canDownloadOperatorPaymentPdf === "function"
      ? canDownloadOperatorPaymentPdf(item)
      : !!showOperatorPaymentPdf;
  return (
    <div className="rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span>{item.category}</span>
          {item.recurring_id && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              Auto
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm opacity-70">
            N° {item.agency_investment_id ?? item.id_investment}
          </div>
          {showPdf && (
            <PaymentPdfButton token={token} item={item} />
          )}
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="text-sky-700/70 transition-colors hover:text-sky-800 dark:text-white/60 dark:hover:text-white"
            title={`Editar ${itemLabel}`}
            aria-label={`Editar ${itemLabel} seleccionado`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="size-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-1 text-lg opacity-90">{item.description}</div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
        <span>
          <b>Monto:</b>{" "}
          {new Intl.NumberFormat("es-AR", {
            style: "currency",
            currency: item.currency,
          }).format(item.amount)}
        </span>
        <span>
          <b>Creado:</b> {formatDate(item.created_at)}
        </span>
        {item.paid_at && (
          <span>
            <b>Pagado:</b> {formatDate(item.paid_at)}
          </span>
        )}
        {item.payment_method && (
          <span>
            <b>Método:</b> {item.payment_method}
          </span>
        )}
        {item.account && (
          <span>
            <b>Cuenta:</b> {item.account}
          </span>
        )}
        {item.base_amount && item.base_currency && (
          <span>
            <b>Valor:</b>{" "}
            {new Intl.NumberFormat("es-AR", {
              style: "currency",
              currency: item.base_currency,
            }).format(item.base_amount)}
          </span>
        )}
        {item.counter_amount && item.counter_currency && (
          <span>
            <b>Contravalor:</b>{" "}
            {new Intl.NumberFormat("es-AR", {
              style: "currency",
              currency: item.counter_currency,
            }).format(item.counter_amount)}
          </span>
        )}
        {item.operator && (
          <span>
            <b>Operador:</b> {item.operator.name}
          </span>
        )}
        {item.counterparty_name && (
          <span>
            <b>A quién se le paga:</b> {item.counterparty_name}
          </span>
        )}
        {item.user && (
          <span>
            <b>Usuario:</b> {item.user.first_name} {item.user.last_name}
          </span>
        )}
        {item.createdBy && (
          <span className="opacity-80">
            <b>Cargado por:</b> {item.createdBy.first_name}{" "}
            {item.createdBy.last_name}
          </span>
        )}
        {item.booking_id && (
          <span className="flex w-fit items-center gap-2">
            <b>Reserva N° </b> {bookingNumber}
            <Link
              href={`/bookings/services/${item.booking?.public_id ?? item.booking_id}`}
              target="_blank"
              className="rounded-full bg-sky-100 p-2 text-sky-900 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
              aria-label={`Abrir reserva ${bookingNumber} en nueva pestaña`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="size-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}

function InvestmentsCardsList({
  items,
  onEdit,
  formatDate,
  itemLabel,
  token,
  showOperatorPaymentPdf,
  canDownloadOperatorPaymentPdf,
}: {
  items: Investment[];
  onEdit: (it: Investment) => void;
  formatDate: (s?: string | null) => string;
  itemLabel: string;
  token?: string | null;
  showOperatorPaymentPdf?: boolean;
  canDownloadOperatorPaymentPdf?: (it: Investment) => boolean;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <InvestmentCard
          key={item.id_investment}
          item={item}
          onEdit={onEdit}
          formatDate={formatDate}
          itemLabel={itemLabel}
          token={token}
          showOperatorPaymentPdf={showOperatorPaymentPdf}
          canDownloadOperatorPaymentPdf={canDownloadOperatorPaymentPdf}
        />
      ))}
    </div>
  );
}

export default function InvestmentsList({
  filterPanelClass,
  filterControlClass,
  q,
  setQ,
  fetchList,
  onExportCSV,
  exportingCsv = false,
  itemLabel = "gasto",
  searchPlaceholder = "Buscar por texto, usuario u operador…",
  showCategoryFilter = true,
  showOperatorFilter = true,
  showOperatorMode = true,
  category,
  setCategory,
  currency,
  setCurrency,
  paymentMethodFilter,
  setPaymentMethodFilter,
  accountFilter,
  setAccountFilter,
  operatorFilter,
  setOperatorFilter,
  categoryOptions,
  currencyOptions,
  paymentMethodOptions,
  accountOptions,
  operators,
  operadorMode,
  setOperadorMode,
  counters,
  resetFilters,
  viewMode,
  setViewMode,
  totalsByCurrencyAll,
  totalsByCurrencyFiltered,
  loadingList,
  filteredItems,
  groupedByMonth,
  nextCursor,
  loadingMore,
  loadMore,
  formatDate,
  onEdit,
  token,
  showOperatorPaymentPdf,
  canDownloadOperatorPaymentPdf,
}: InvestmentsListProps) {
  const itemLabelPlural = itemLabel.endsWith("s") ? itemLabel : `${itemLabel}s`;
  return (
    <>
      {/* FILTROS */}
      <div className={`mb-4 ${filterPanelClass}`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex w-full items-center gap-2 rounded-2xl border border-sky-200 bg-white/50 text-sky-950 shadow-sm shadow-sky-950/10 outline-none backdrop-blur focus-within:border-emerald-300/60 focus-within:ring-2 focus-within:ring-emerald-200/40 dark:border-sky-200/60 dark:bg-sky-100/10 dark:text-white">
            <input
              className="w-full bg-transparent p-2 px-4 outline-none"
              placeholder={searchPlaceholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchList();
              }}
              aria-label={`Buscar ${itemLabel}s`}
            />
            <button
              type="button"
              onClick={fetchList}
              className="w-fit cursor-pointer appearance-none px-3 text-emerald-700 outline-none dark:text-white"
              title="Buscar"
              aria-label="Ejecutar búsqueda"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="size-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
            </button>
          </div>

          {showCategoryFilter && (
            <select
              className={filterControlClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={categoryOptions.length === 0}
              aria-label="Filtrar por categoría"
            >
              <option value="">
                {categoryOptions.length
                  ? "Categoría (todas)"
                  : "Sin categorías"}
              </option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}

          <select
            className={filterControlClass}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={currencyOptions.length === 0}
            aria-label="Filtrar por moneda"
          >
            <option value="">
              {currencyOptions.length ? "Moneda (todas)" : "Sin monedas"}
            </option>
            {currencyOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>

          <select
            className={filterControlClass}
            value={paymentMethodFilter}
            onChange={(e) => setPaymentMethodFilter(e.target.value)}
            disabled={paymentMethodOptions.length === 0}
            aria-label="Filtrar por método de pago"
          >
            <option value="">
              {paymentMethodOptions.length ? "Método (todos)" : "Sin métodos"}
            </option>
            {paymentMethodOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            className={filterControlClass}
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            disabled={accountOptions.length === 0}
            aria-label="Filtrar por cuenta"
          >
            <option value="">
              {accountOptions.length ? "Cuenta (todas)" : "Sin cuentas"}
            </option>
            {accountOptions.map((acc) => (
              <option key={acc} value={acc}>
                {acc}
              </option>
            ))}
          </select>

          {showOperatorFilter && (
            <select
              className={filterControlClass}
              value={operatorFilter}
              onChange={(e) => setOperatorFilter(Number(e.target.value))}
              disabled={operators.length === 0}
              aria-label="Filtrar por operador"
            >
              <option value={0}>
                {operators.length ? "Operador (todos)" : "Sin operadores"}
              </option>
              {operators.map((o) => (
                <option key={o.id_operator} value={o.id_operator}>
                  {o.name}
                </option>
              ))}
            </select>
          )}

          {showOperatorMode && (
            <div className="flex items-center rounded-2xl border border-white/10 bg-white/60 shadow-sm shadow-sky-950/10 backdrop-blur dark:bg-white/10">
              {[
                { key: "all", label: "Todos", badge: counters.total },
                { key: "only", label: "Operador", badge: counters.op },
                { key: "others", label: "Otros", badge: counters.others },
              ].map((opt) => {
                const active =
                  operadorMode === (opt.key as typeof operadorMode);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      setOperadorMode(opt.key as "all" | "only" | "others")
                    }
                    className={[
                      "flex items-center gap-2 rounded-2xl px-4 py-2 text-sm transition-colors",
                      active
                        ? "bg-sky-500/15 text-sky-700 dark:text-sky-200"
                        : "text-sky-950/80 hover:bg-white/60 dark:text-white/80",
                    ].join(" ")}
                    title={`Mostrar ${opt.label.toLowerCase()}`}
                  >
                    <span>{opt.label}</span>
                    <span className="rounded-full border border-white/10 bg-white/40 px-2 text-xs">
                      {opt.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={resetFilters}
            className={filterControlClass}
            title="Limpiar filtros"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="size-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={onExportCSV}
            disabled={exportingCsv}
            className={filterControlClass}
            title="Exportar CSV"
          >
            {exportingCsv ? "Exportando..." : "Exportar CSV"}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/60 p-1 shadow-sm shadow-sky-950/10 dark:bg-white/10">
          {[
            { key: "cards", label: "Tarjetas" },
            { key: "table", label: "Tabla" },
            { key: "monthly", label: "Mensual" },
          ].map((opt) => {
            const active = viewMode === (opt.key as typeof viewMode);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() =>
                  setViewMode(opt.key as "cards" | "table" | "monthly")
                }
                className={[
                  "rounded-xl px-4 py-2 text-xs font-semibold transition-colors",
                  active
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-200"
                    : "text-sky-950/80 hover:bg-white/60 dark:text-white/80",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-sky-950/70 dark:text-white/70">
          Vista actual:{" "}
          <b className="text-emerald-700 dark:text-emerald-200">
            {viewMode === "cards"
              ? "Tarjetas"
              : viewMode === "table"
                ? "Tabla"
                : "Mensual"}
          </b>
        </div>
      </div>

      {Object.keys(totalsByCurrencyAll).length > 0 && (
        <div className="mb-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="opacity-70">
              Resumen (filtrado • {counters.filtered}/{counters.total}):
            </span>
            {Object.entries(totalsByCurrencyFiltered).map(([cur, total]) => (
              <span
                key={`f-${cur}`}
                className="rounded-xl border border-emerald-300/60 bg-white/70 px-3 py-1 text-emerald-700 dark:border-emerald-400/60 dark:bg-white/10 dark:text-emerald-200"
              >
                {cur}:{" "}
                {new Intl.NumberFormat("es-AR", {
                  style: "currency",
                  currency: cur,
                }).format(total)}
              </span>
            ))}
          {Object.keys(totalsByCurrencyFiltered).length === 0 && (
            <span className="opacity-60">
              Sin totales para el filtro actual
            </span>
          )}
        </div>
      </div>
    )}

      {loadingList ? (
        <div className="flex min-h-[40vh] items-center">
          <Spinner />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-white/10 p-6 text-center text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
          No hay {itemLabelPlural} para el filtro seleccionado.
        </div>
      ) : (
        <>
          {viewMode === "table" ? (
            <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/10 shadow-md shadow-sky-950/10 backdrop-blur">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-white/60 text-sky-950 dark:bg-white/10 dark:text-white">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Categoría</th>
                    <th className="px-4 py-3">Descripción</th>
                    <th className="px-4 py-3">Monto</th>
                    <th className="px-4 py-3">Método</th>
                    <th className="px-4 py-3">Cuenta</th>
                    <th className="px-4 py-3">Referencias</th>
                    <th className="px-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((it) => {
                    const showPdf =
                      typeof canDownloadOperatorPaymentPdf === "function"
                        ? canDownloadOperatorPaymentPdf(it)
                        : !!showOperatorPaymentPdf;
                    const amountLabel = new Intl.NumberFormat("es-AR", {
                      style: "currency",
                      currency: it.currency,
                    }).format(it.amount);
                    return (
                      <tr
                        key={it.id_investment}
                        className="border-t border-white/10"
                      >
                        <td className="px-4 py-3 text-xs opacity-70">
                          {formatDate(it.paid_at ?? it.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 text-xs font-semibold">
                            <span>{it.category}</span>
                            {it.recurring_id && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                                Auto
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] opacity-60">
                            N° {it.agency_investment_id ?? it.id_investment}
                          </div>
                        </td>
                        <td className="px-4 py-3">{it.description}</td>
                        <td className="px-4 py-3 font-semibold">
                          {amountLabel}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {it.payment_method || "-"}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {it.account || "-"}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {it.operator
                            ? `Operador: ${it.operator.name}`
                            : it.user
                              ? `Usuario: ${it.user.first_name} ${it.user.last_name}`
                              : it.counterparty_name
                                ? `A quién se le paga: ${it.counterparty_name}`
                                : "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {showPdf && (
                              <PaymentPdfButton
                                token={token}
                                item={it}
                                variant="table"
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => onEdit(it)}
                              className="rounded-full bg-white/70 px-3 py-2 text-xs font-semibold text-sky-950 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
                            >
                              Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : viewMode === "monthly" ? (
            <div className="space-y-4">
              {groupedByMonth.map((group) => (
                <div
                  key={group.key}
                  className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-lg font-semibold">{group.label}</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {Object.entries(group.totals).map(([cur, total]) => (
                        <span
                          key={`${group.key}-${cur}`}
                          className="rounded-full border border-emerald-300/60 bg-white/70 px-3 py-1 text-emerald-700 dark:border-emerald-400/60 dark:bg-white/10 dark:text-emerald-200"
                        >
                          {cur}:{" "}
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: cur,
                          }).format(total)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 divide-y divide-white/10">
                    {group.items.map((it) => {
                      const showPdf =
                        typeof canDownloadOperatorPaymentPdf === "function"
                          ? canDownloadOperatorPaymentPdf(it)
                          : !!showOperatorPaymentPdf;
                      return (
                        <div
                          key={it.id_investment}
                          className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {it.description}
                              </span>
                              {it.recurring_id && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                                  Auto
                                </span>
                              )}
                            </div>
                            <div className="text-xs opacity-70">
                              {formatDate(it.paid_at ?? it.created_at)} ·{" "}
                              {it.category}
                              {it.counterparty_name
                                ? ` · ${it.counterparty_name}`
                                : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {showPdf && (
                              <PaymentPdfButton token={token} item={it} />
                            )}
                            <div className="text-sm font-semibold">
                              {new Intl.NumberFormat("es-AR", {
                                style: "currency",
                                currency: it.currency,
                              }).format(it.amount)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <InvestmentsCardsList
              items={filteredItems}
              onEdit={onEdit}
              formatDate={formatDate}
              itemLabel={itemLabel}
              token={token}
              showOperatorPaymentPdf={showOperatorPaymentPdf}
              canDownloadOperatorPaymentPdf={canDownloadOperatorPaymentPdf}
            />
          )}

          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-full bg-emerald-200/80 px-6 py-2 text-emerald-950 shadow-sm shadow-emerald-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
              >
                {loadingMore ? <Spinner /> : "Ver más"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
