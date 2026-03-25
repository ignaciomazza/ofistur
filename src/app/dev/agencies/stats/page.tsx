// src/app/dev/agencies/stats/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { useRouter } from "next/navigation";
import { calcVatFromTotal } from "@/lib/billing/pricing";

type PeriodKey = "month" | "quarter" | "ytd" | "all";

type FinanceStats = {
  range: {
    from: string | null;
    to: string | null;
    label: string;
  };
  totals: {
    paid_total: number;
  };
  counts: {
    agencies_total: number;
    agencies_with_billing: number;
    agencies_with_charges: number;
    charges_total: number;
    charges_paid: number;
    charges_pending: number;
    agencies_pending_latest: number;
  };
  plan_mix: {
    basico: number;
    medio: number;
    pro: number;
    sin_plan: number;
  };
  pending_latest: {
    id_agency: number;
    name: string;
    legal_name: string;
    id_charge: number;
    status: string;
    period_start: string | null;
    period_end: string | null;
    total_usd: number;
  }[];
  recent_payments: {
    id_charge: number;
    agency_name: string;
    paid_at: string | null;
    paid_amount: number;
    paid_currency: "USD" | "ARS";
  }[];
  currency: "USD" | "ARS";
};

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "month", label: "Mes actual" },
  { key: "quarter", label: "Ultimos 90 dias" },
  { key: "ytd", label: "Año en curso" },
  { key: "all", label: "Todo" },
];

function formatMoney(value: number, currency: "USD" | "ARS") {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(safe);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR");
}

export default function DevFinanceStatsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [displayCurrency, setDisplayCurrency] = useState<"USD" | "ARS">("USD");
  const [stats, setStats] = useState<FinanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchStats(activePeriod: PeriodKey, isRefresh = false) {
    if (!token) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await authFetch(
        `/api/dev/stats/finance?period=${activePeriod}&currency=${displayCurrency}`,
        {},
        token,
      );
      if (!res.ok) throw new Error("No se pudieron cargar estadisticas");
      const data = (await res.json()) as FinanceStats;
      setStats(data);
    } catch (e) {
      console.error(e);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    fetchStats(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, period, displayCurrency]);

  const mrrSplit = useMemo(() => {
    if (!stats) return [];
    return [
      { label: "Basico", value: stats.plan_mix.basico },
      { label: "Medio", value: stats.plan_mix.medio },
      { label: "Pro", value: stats.plan_mix.pro },
      { label: "Sin plan", value: stats.plan_mix.sin_plan },
    ];
  }, [stats]);

  const paidBreakdown = useMemo(() => {
    if (!stats) return null;
    const total = stats.totals.paid_total;
    const vat = calcVatFromTotal(total);
    return { total, vat, net: total - vat };
  }, [stats]);

  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                Estadisticas generales
              </h1>
              <p className="mt-1 text-sm text-sky-950/70 dark:text-white/70">
                Resumen financiero y actividad global de agencias.
              </p>
              {stats?.range && (
                <p className="mt-1 text-xs text-sky-950/60 dark:text-white/60">
                  Rango: {stats.range.label}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => router.push("/dev/agencies")}
                className="rounded-full border border-sky-300/40 bg-sky-100/20 px-4 py-1.5 text-xs text-sky-900 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-sky-200"
              >
                Volver a agencias
              </button>
              <div className="flex items-center gap-1">
                {(["USD", "ARS"] as const).map((cur) => {
                  const active = displayCurrency === cur;
                  return (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => setDisplayCurrency(cur)}
                      className={`rounded-full border px-3 py-1 text-xs transition-transform hover:scale-95 active:scale-90 ${
                        active
                          ? "border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                          : "border-white/10 bg-white/10 text-sky-950/70 dark:text-white/70"
                      }`}
                    >
                      {cur}
                    </button>
                  );
                })}
              </div>
              {PERIODS.map((p) => {
                const active = period === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPeriod(p.key)}
                    className={`rounded-full border px-4 py-1.5 text-xs shadow-sm transition-transform hover:scale-95 active:scale-90 ${
                      active
                        ? "border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                        : "border-white/10 bg-white/10 text-sky-950/70 hover:border-sky-300/40 hover:bg-sky-100/20 dark:text-white/70"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => fetchStats(period, true)}
                disabled={refreshing}
                className="rounded-full border border-sky-300/40 bg-sky-100/20 px-4 py-1.5 text-xs text-sky-900 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:text-sky-200"
              >
                {refreshing ? "Actualizando..." : "Actualizar"}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center rounded-3xl border border-white/10 bg-white/10 shadow-md shadow-sky-950/10 backdrop-blur">
              <div className="flex items-center gap-2 text-sm text-sky-950/60 dark:text-white/60">
                <Spinner />
                Cargando estadisticas...
              </div>
            </div>
          ) : !stats ? (
            <div className="rounded-3xl border border-dashed border-white/20 bg-white/10 p-6 text-sm text-sky-950/70 dark:text-white/70">
              No hay datos disponibles para el periodo seleccionado.
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-3xl border border-sky-300/30 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur">
                  <p className="text-xs text-sky-900/70 dark:text-sky-200/70">
                    Cobrado
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {formatMoney(stats.totals.paid_total, displayCurrency)}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xl font-light opacity-70">Neto:</p>
                    <p className="mt-1 text-xl font-light opacity-70">
                      {formatMoney(paidBreakdown?.net ?? 0, displayCurrency)}
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xl font-light opacity-70">Iva:</p>
                    <p className="text-xl font-light opacity-70">
                      {formatMoney(paidBreakdown?.vat ?? 0, displayCurrency)}
                    </p>
                  </div>
                </div>
                <div className="rounded-3xl border border-sky-300/30 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur">
                  <p className="text-xs text-sky-900/70 dark:text-sky-200/70">
                    Pendientes (ultimo cobro)
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {stats.counts.agencies_pending_latest}
                  </p>
                </div>
                <div className="rounded-3xl border border-sky-300/30 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur">
                  <p className="text-xs text-sky-900/70 dark:text-sky-200/70">
                    Cobros pendientes
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {stats.counts.charges_pending}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur">
                  <h2 className="text-sm font-semibold">Actividad</h2>
                  <div className="mt-3 space-y-2 text-xs text-sky-950/70 dark:text-white/70">
                    <div className="flex justify-between">
                      <span>Agencias totales</span>
                      <span className="font-semibold">
                        {stats.counts.agencies_total}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Agencias con plan</span>
                      <span className="font-semibold">
                        {stats.counts.agencies_with_billing}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Agencias con cobros</span>
                      <span className="font-semibold">
                        {stats.counts.agencies_with_charges}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cobros registrados</span>
                      <span className="font-semibold">
                        {stats.counts.charges_total}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cobros pagados</span>
                      <span className="font-semibold">
                        {stats.counts.charges_paid}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cobros pendientes</span>
                      <span className="font-semibold">
                        {stats.counts.charges_pending}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur">
                  <h2 className="text-sm font-semibold">Mix de planes</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mrrSplit.map((item) => (
                      <span
                        key={item.label}
                        className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-xs text-sky-900 dark:text-sky-200"
                      >
                        {item.label}: {item.value}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur">
                  <h2 className="text-sm font-semibold">Ultimos pagos</h2>
                  <div className="mt-3 space-y-2 text-xs text-sky-950/70 dark:text-white/70">
                    {stats.recent_payments.length === 0 ? (
                      <p>No hay pagos recientes en este periodo.</p>
                    ) : (
                      stats.recent_payments.map((row) => (
                        <div
                          key={row.id_charge}
                          className="flex items-center justify-between rounded-2xl border border-sky-300/30 bg-sky-100/10 px-3 py-2"
                        >
                          <div>
                            <p className="font-semibold">{row.agency_name}</p>
                            <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                              {formatDate(row.paid_at)}
                            </p>
                          </div>
                          <span className="font-semibold">
                            {formatMoney(row.paid_amount, displayCurrency)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur">
                <h2 className="text-sm font-semibold">
                  Agencias pendientes (ultimo cobro)
                </h2>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {stats.pending_latest.length === 0 ? (
                    <p className="text-xs text-sky-950/60 dark:text-white/60">
                      No hay agencias pendientes en este periodo.
                    </p>
                  ) : (
                    stats.pending_latest.map((row) => (
                      <div
                        key={row.id_agency}
                        className="rounded-2xl border border-sky-300/30 bg-sky-100/10 p-3 text-xs text-sky-950/70 dark:text-white/70"
                      >
                        <p className="text-sm font-semibold">{row.name}</p>
                        <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                          {row.legal_name}
                        </p>
                        <div className="mt-2 flex items-center justify-between">
                          <span>Ultimo cobro</span>
                          <span className="font-semibold">{row.status}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span>Periodo</span>
                          <span className="font-semibold">
                            {formatDate(row.period_start)} →{" "}
                            {formatDate(row.period_end)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span>Total</span>
                          <span className="font-semibold">
                            {formatMoney(row.total_usd, "USD")}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </ProtectedRoute>
  );
}
