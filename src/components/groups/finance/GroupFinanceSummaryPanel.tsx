"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { GroupFinanceSummaryResult } from "@/lib/groups/financeSummary";

type SummaryScope = {
  type: "all" | "departure";
  key: string;
  label: string;
  departureId: number | null;
};

export type GroupFinanceSummaryPayload = {
  success: true;
  scope: SummaryScope;
  summary: GroupFinanceSummaryResult;
  generated_at: string;
  schema_ready?: boolean;
};

type Props = {
  data: GroupFinanceSummaryPayload | null;
  loading: boolean;
  error: string | null;
};

function formatMoney(value: number, currency: string): string {
  const code = String(currency || "ARS")
    .trim()
    .toUpperCase();
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${code} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  }
}

function formatSignedMoney(value: number, currency: string): string {
  return formatMoney(value, currency);
}

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function currencyLabel(currency: string): string {
  const labels: Record<string, string> = {
    ARS: "Pesos",
    USD: "Dólares",
    UYU: "Pesos uruguayos",
  };
  const code = String(currency || "ARS")
    .trim()
    .toUpperCase();
  return labels[code] || code;
}

function valueToneClass(tone: "default" | "strong" | "warning" | "success") {
  if (tone === "strong") return "text-sky-900 dark:text-sky-100";
  if (tone === "warning") return "text-amber-700 dark:text-amber-300";
  if (tone === "success") return "text-emerald-700 dark:text-emerald-300";
  return "text-slate-900 dark:text-slate-100";
}

function MetricRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "strong" | "warning" | "success";
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span
        className={`text-right text-sm font-semibold tabular-nums ${valueToneClass(
          tone,
        )}`}
      >
        {value}
      </span>
    </div>
  );
}

function SummaryBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-sky-200/80 bg-sky-50/55 p-4 dark:border-sky-600/30 dark:bg-sky-950/10">
      <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      <div className="divide-y divide-sky-200/70 dark:divide-sky-700/40">
        {children}
      </div>
    </section>
  );
}

function PctBadge({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="rounded-full border border-sky-200/80 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm shadow-slate-900/5 dark:border-sky-600/30 dark:bg-sky-950/20 dark:text-slate-300">
      {label} {formatPct(value)}
    </span>
  );
}

export default function GroupFinanceSummaryPanel({
  data,
  loading,
  error,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const currencies = data?.summary.currencies ?? [];
  const hasRows = currencies.length > 0;

  const servicesByCurrency = useMemo(() => {
    const services = data?.summary.services ?? [];
    const map = new Map<string, typeof services>();
    for (const service of services) {
      const rows = map.get(service.currency) ?? [];
      map.set(service.currency, [...rows, service]);
    }
    return map;
  }, [data?.summary.services]);

  return (
    <section
      id="panel-resumen-financiero"
      className="rounded-3xl border border-sky-200/80 bg-white p-4 shadow-sm shadow-slate-900/10 backdrop-blur-md dark:border-sky-600/30 dark:bg-sky-950/10 md:p-5"
    >
      {error ? (
        <p className="border-l-2 border-amber-400/80 py-1 pl-3 text-xs text-amber-900 dark:border-amber-500/70 dark:text-amber-200">
          {error}
        </p>
      ) : null}

      {data?.schema_ready === false ? (
        <p className="mt-3 border-l-2 border-amber-400/80 py-1 pl-3 text-xs text-amber-900 dark:border-amber-500/70 dark:text-amber-200">
          La estructura financiera de grupales todavía no está disponible en
          esta base.
        </p>
      ) : null}

      {loading && !data ? (
        <div className="flex min-h-28 items-center justify-center rounded-3xl border border-sky-200/80 bg-sky-50/70 text-sm text-slate-600 dark:border-sky-600/30 dark:bg-sky-950/20 dark:text-slate-300">
          Calculando resumen de la salida...
        </div>
      ) : !loading && !hasRows ? (
        <p className="rounded-2xl border border-sky-300/70 bg-sky-50/70 px-4 py-3 text-sm text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/20 dark:text-slate-300">
          Todavía no hay venta asignada, cobros, pagos o facturación para
          resumir.
        </p>
      ) : (
        <>
          <div className="space-y-4">
            {currencies.map((row) => {
              const hasPassengerCredit = row.passengerCredit > 0.01;
              const passengerBalanceTone = hasPassengerCredit
                ? "success"
                : row.passengerDebt > 0.01
                  ? "warning"
                  : "default";
              const passengerBalanceLabel = hasPassengerCredit
                ? "Saldo a favor pax"
                : "Deuda pax";
              const invoicePendingTone =
                row.invoicePending > 0.01 ? "warning" : "default";

              return (
                <div
                  key={`summary-currency-${row.currency}`}
                  className="border-b border-sky-200/70 pb-4 last:border-b-0 last:pb-0 dark:border-sky-700/40"
                >
                  <header className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {currencyLabel(row.currency)}
                      </h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <PctBadge label="Cobrado" value={row.collectionPct} />
                      <PctBadge label="Operador" value={row.operatorPaidPct} />
                      <PctBadge label="Facturado" value={row.invoicedPct} />
                    </div>
                  </header>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <SummaryBlock title="Pasajeros">
                      <MetricRow
                        label="Venta asignada"
                        value={formatMoney(row.assignedSale, row.currency)}
                        tone="strong"
                      />
                      <MetricRow
                        label="Cobrado"
                        value={formatMoney(row.collected, row.currency)}
                      />
                      <MetricRow
                        label={passengerBalanceLabel}
                        value={formatSignedMoney(
                          hasPassengerCredit
                            ? row.passengerCredit
                            : row.passengerDebt,
                          row.currency,
                        )}
                        tone={passengerBalanceTone}
                      />
                    </SummaryBlock>

                    <SummaryBlock title="Resultado estimado">
                      <MetricRow
                        label="Costo asignado"
                        value={formatMoney(row.assignedCost, row.currency)}
                      />
                      <MetricRow
                        label="Impuestos + fees"
                        value={formatMoney(row.taxesAndFees, row.currency)}
                      />
                      <MetricRow
                        label="Comisión neta est."
                        value={formatMoney(
                          row.estimatedNetCommission,
                          row.currency,
                        )}
                        tone="strong"
                      />
                    </SummaryBlock>

                    <SummaryBlock title="Operador y facturación">
                      <MetricRow
                        label="Costo total operador"
                        value={formatMoney(row.operatorCost, row.currency)}
                      />
                      <MetricRow
                        label="Pagado operador"
                        value={formatMoney(row.operatorPaid, row.currency)}
                      />
                      <MetricRow
                        label="Deuda operador"
                        value={formatMoney(row.operatorDebt, row.currency)}
                        tone={row.operatorDebt > 0.01 ? "warning" : "default"}
                      />
                      <MetricRow
                        label="Facturado"
                        value={formatMoney(row.invoiced, row.currency)}
                      />
                      <MetricRow
                        label="Pendiente facturar"
                        value={formatSignedMoney(
                          row.invoicePending,
                          row.currency,
                        )}
                        tone={invoicePendingTone}
                      />
                    </SummaryBlock>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
              className="rounded-full border border-sky-300 bg-white px-4 py-2 text-xs font-semibold text-sky-800 transition hover:border-sky-400 dark:border-sky-600/40 dark:bg-sky-950/20 dark:text-sky-200"
              aria-expanded={showDetails}
            >
              {showDetails
                ? "Ocultar detalle por servicio"
                : "Ver detalle por servicio"}
            </button>
          </div>

          {showDetails ? (
            <div className="mt-4 space-y-4">
              {currencies.map((currencyRow) => {
                const rows = servicesByCurrency.get(currencyRow.currency) ?? [];
                if (rows.length === 0) return null;
                return (
                  <div
                    key={`summary-services-${currencyRow.currency}`}
                    className="border-t border-sky-200/70 pt-4 dark:border-sky-700/40"
                  >
                    <header className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Detalle por servicio
                      </h3>
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {currencyLabel(currencyRow.currency)}
                      </span>
                    </header>

                    <div className="divide-y divide-sky-200/70 dark:divide-sky-700/40">
                      {rows.map((service) => (
                        <section
                          key={`summary-service-${service.currency}-${service.inventoryId}`}
                          className="py-3 first:pt-0 last:pb-0"
                        >
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {service.label}
                          </h4>
                          <div className="mt-2 grid grid-cols-2 gap-x-4 text-xs md:grid-cols-3 xl:grid-cols-6">
                            <MetricRow
                              label="Asignados"
                              value={String(service.assignedCount)}
                            />
                            <MetricRow
                              label="Venta"
                              value={formatMoney(
                                service.assignedSale,
                                service.currency,
                              )}
                            />
                            <MetricRow
                              label="Costo"
                              value={formatMoney(
                                service.assignedCost,
                                service.currency,
                              )}
                            />
                            <MetricRow
                              label="Impuestos"
                              value={formatMoney(
                                service.estimatedTaxes,
                                service.currency,
                              )}
                            />
                            <MetricRow
                              label="Fees"
                              value={formatMoney(
                                service.transferFees,
                                service.currency,
                              )}
                            />
                            <MetricRow
                              label="Margen est."
                              value={formatMoney(
                                service.estimatedMargin,
                                service.currency,
                              )}
                              tone="strong"
                            />
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
