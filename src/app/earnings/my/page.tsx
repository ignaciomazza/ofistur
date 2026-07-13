// src/app/earnings/my/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { toast } from "react-toastify";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  TooltipProps,
} from "recharts";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import {
  loadFinancePicks,
  type FinanceCurrency,
  type FinancePaymentMethod,
  type FinanceAccount,
} from "@/utils/loadFinancePicks";

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

/* ============ Helpers de fecha (TZ BA) ============ */
function getTzParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year || 0),
    m: Number(parts.month || 1),
    d: Number(parts.day || 1),
  };
}

function ymdFromParts(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addMonthsYmd(y: number, m: number, delta: number) {
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { y: ny, m: nm };
}

function defaultRange12Months(timeZone = DEFAULT_TZ) {
  const today = new Date();
  const parts = getTzParts(today, timeZone);
  const start = addMonthsYmd(parts.y, parts.m, -11);
  const from = ymdFromParts(start.y, start.m, 1);

  const endDay = new Date(Date.UTC(parts.y, parts.m, 0)).getUTCDate();
  const to = ymdFromParts(parts.y, parts.m, endDay);

  return { from, to };
}

function monthRangeInTz(timeZone = DEFAULT_TZ) {
  const today = new Date();
  const parts = getTzParts(today, timeZone);
  return {
    from: ymdFromParts(parts.y, parts.m, 1),
    to: ymdFromParts(parts.y, parts.m, parts.d),
  };
}

function monthKeyToLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 15));
  return d.toLocaleDateString("es-AR", {
    month: "short",
    year: "numeric",
    timeZone: DEFAULT_TZ,
  });
}

function buildMonthsRange(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return [] as string[];
  const result: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    const next = addMonthsYmd(y, m, 1);
    y = next.y;
    m = next.m;
  }
  return result;
}

/* ============ Tipos API ============ */
type MyMonthlyItem = {
  month: string; // YYYY-MM
  currency: string; // codigo
  seller: number;
  beneficiary: number;
  total: number;
};
type MyMonthlyResponse = {
  items: MyMonthlyItem[];
  totalsByCurrency: Record<
    string,
    { seller: number; beneficiary: number; total: number }
  >;
};

/* ============ UI consts ============ */
const CARD =
  "h-fit space-y-3 rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white";
const INPUT =
  "w-full min-w-[180px] cursor-pointer rounded-2xl border border-white/20 bg-white/40 px-3 py-2 text-sm text-sky-950 shadow-sm shadow-sky-950/10 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white";
const BTN_SKY =
  "rounded-full border border-sky-200/50 bg-sky-100/70 px-4 py-2 text-sky-950 shadow-sm shadow-sky-900/20 transition hover:scale-[.98] active:scale-95 disabled:opacity-50 dark:border-sky-400/30 dark:bg-sky-900/30 dark:text-sky-100";
const BTN_ROSE =
  "rounded-full border border-rose-200/50 bg-rose-100/60 px-4 py-2 text-rose-950 shadow-sm shadow-rose-900/20 transition hover:scale-[.98] active:scale-95 disabled:opacity-50 dark:border-rose-400/30 dark:bg-rose-900/30 dark:text-rose-100";
const PILL_WHITE =
  "inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs text-sky-900 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white";
const PILL_SKY =
  "rounded-full border border-sky-200/50 bg-sky-100/70 px-3 py-1 text-xs text-sky-900 shadow-sm transition hover:bg-sky-100/90 dark:border-sky-400/30 dark:bg-sky-900/30 dark:text-sky-100";
const STACK_AMBER =
  "rounded-2xl border border-amber-200/50 bg-amber-100/10 p-3 text-amber-950 shadow-sm shadow-amber-900/10 dark:border-amber-400/5 dark:bg-amber-900/10 dark:text-amber-100";
const STACK_SKY =
  "rounded-2xl border border-sky-200/50 bg-sky-100/10 p-3 text-sky-950 shadow-sm shadow-sky-900/10 dark:border-sky-400/30 dark:bg-sky-900/10 dark:text-sky-100";
const STACK_EMERALD =
  "rounded-2xl border border-emerald-200/50 bg-emerald-100/10 p-3 text-emerald-950 shadow-sm shadow-emerald-900/10 dark:border-emerald-400/30 dark:bg-emerald-900/10 dark:text-emerald-100";

/* ============ Formateo de dinero sin depender de `decimals` ============ */
function formatMoney(value: number, code: string) {
  const n = Number.isFinite(value) ? Number(value) : 0;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
    }).format(n);
  } catch {
    return `${code} ${new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)}`;
  }
}

function clampPct(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

const STATUS_OPTIONS = ["Todas", "Pendiente", "Pago", "Facturado"] as const;

/* ============ Tooltip ============ */
const MoneyTooltip: React.FC<
  TooltipProps<number, string> & { code: string }
> = ({ active, payload, label, code }) => {
  if (!active || !payload?.length) return null;
  const seller = payload.find((p) => p.dataKey === "seller")?.value ?? 0;
  const beneficiary =
    payload.find((p) => p.dataKey === "beneficiary")?.value ?? 0;
  const total = (Number(seller) || 0) + (Number(beneficiary) || 0);

  return (
    <div className="space-y-2 rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md backdrop-blur dark:bg-sky-950/10 dark:text-white">
      <p className="text-xs font-medium">{label}</p>
      <p className="text-xs">
        <strong>Vendedor:</strong> {formatMoney(Number(seller) || 0, code)}
      </p>
      <p className="text-xs">
        <strong>Lider de equipo:</strong>{" "}
        {formatMoney(Number(beneficiary) || 0, code)}
      </p>
      <p className="text-xs">
        <strong>Total:</strong> {formatMoney(total, code)}
      </p>
    </div>
  );
};

/* ============ Tipado local de picks para evitar `any` ============ */
type CurrencyLike = Pick<FinanceCurrency, "code"> & {
  enabled?: boolean | null;
};

type FiltersState = {
  clientStatus: string;
  operatorStatus: string;
  paymentMethodId: string;
  accountId: string;
};

/* ============ Pagina ============ */
export default function MyEarningsPage() {
  const { token } = useAuth();
  const { from: defaultFrom, to: defaultTo } = useMemo(
    () => defaultRange12Months(DEFAULT_TZ),
    [],
  );
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [appliedRange, setAppliedRange] = useState({
    from: defaultFrom,
    to: defaultTo,
  });
  const [dateField, setDateField] = useState<"creation" | "departure">(
    "creation",
  );
  const [minPaidPct, setMinPaidPct] = useState(40);
  const [filters, setFilters] = useState<FiltersState>({
    clientStatus: "Todas",
    operatorStatus: "Todas",
    paymentMethodId: "",
    accountId: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState<MyMonthlyItem[]>([]);
  const [totalsByCurrency, setTotalsByCurrency] = useState<
    MyMonthlyResponse["totalsByCurrency"]
  >({});

  const [paymentMethods, setPaymentMethods] = useState<FinancePaymentMethod[]>(
    [],
  );
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const picksRef = useRef<{
    codesEnabled: Set<string>;
    hasCurrencyFilter: boolean;
  }>({ codesEnabled: new Set(), hasCurrencyFilter: false });
  const picksLoadedRef = useRef(false);

  const loadPicks = useCallback(async () => {
    if (!token) return picksRef.current;
    if (picksLoadedRef.current) return picksRef.current;
    try {
      const picks = await loadFinancePicks(token);
      const raw = (picks?.currencies ?? []) as unknown as CurrencyLike[];
      const enabled = raw.filter((c) => !!c.enabled);
      const codesEnabled = new Set(enabled.map((c) => c.code));
      const hasCurrencyFilter = codesEnabled.size > 0;
      picksRef.current = { codesEnabled, hasCurrencyFilter };
      picksLoadedRef.current = true;
      setPaymentMethods((picks?.paymentMethods ?? []).filter((m) => m.enabled));
      setAccounts((picks?.accounts ?? []).filter((a) => a.enabled));
      return picksRef.current;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Error cargando configuracion",
      );
      picksLoadedRef.current = true;
      return picksRef.current;
    }
  }, [token]);

  const loadAll = useCallback(async () => {
    if (new Date(from) > new Date(to)) {
      toast.error("El rango 'Desde' no puede ser posterior a 'Hasta'");
      return;
    }
    if (!token) {
      toast.error("Sesion no iniciada");
      return;
    }
    setLoading(true);
    try {
      const { codesEnabled, hasCurrencyFilter } = await loadPicks();

      const qs = new URLSearchParams({
        from,
        to,
        tz: DEFAULT_TZ,
        dateField,
        minPaidPct: String(minPaidPct),
      });
      if (filters.clientStatus !== "Todas")
        qs.set("clientStatus", filters.clientStatus);
      if (filters.operatorStatus !== "Todas")
        qs.set("operatorStatus", filters.operatorStatus);
      if (filters.paymentMethodId)
        qs.set("paymentMethodId", filters.paymentMethodId);
      if (filters.accountId) qs.set("accountId", filters.accountId);

      const res = await authFetch(
        `/api/earnings/my-monthly?${qs.toString()}`,
        { cache: "no-store" },
        token,
      );
      if (!res.ok) throw new Error("Error al cargar datos");
      const json: MyMonthlyResponse = await res.json();

      setItems(
        hasCurrencyFilter
          ? json.items.filter((i) => codesEnabled.has(i.currency))
          : json.items,
      );

      const filteredTotals: typeof json.totalsByCurrency = {};
      for (const [code, v] of Object.entries(json.totalsByCurrency)) {
        if (!hasCurrencyFilter || codesEnabled.has(code))
          filteredTotals[code] = v;
      }
      setTotalsByCurrency(filteredTotals);
      setAppliedRange({ from, to });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [from, to, token, dateField, minPaidPct, filters, loadPicks]);

  // Llamada inicial UNA vez, sin desactivar eslint
  const didRunInitial = useRef(false);
  useEffect(() => {
    if (!token || didRunInitial.current) return;
    didRunInitial.current = true;
    void loadAll();
  }, [token, loadAll]);

  /* Series por moneda con meses faltantes en 0 */
  const monthsRange = useMemo(
    () => buildMonthsRange(appliedRange.from, appliedRange.to),
    [appliedRange],
  );

  const dataByCurrency = useMemo(() => {
    const map: Record<
      string,
      Array<{
        month: string;
        seller: number;
        beneficiary: number;
        total: number;
      }>
    > = {};
    const grouped: Record<
      string,
      Record<string, { seller: number; beneficiary: number; total: number }>
    > = {};

    for (const it of items) {
      grouped[it.currency] ||= {};
      grouped[it.currency][it.month] ||= {
        seller: 0,
        beneficiary: 0,
        total: 0,
      };
      grouped[it.currency][it.month].seller += it.seller;
      grouped[it.currency][it.month].beneficiary += it.beneficiary;
      grouped[it.currency][it.month].total += it.total;
    }

    for (const cur of Object.keys(grouped)) {
      map[cur] = monthsRange.map((m) => {
        const s = grouped[cur][m] || { seller: 0, beneficiary: 0, total: 0 };
        return {
          month: monthKeyToLabel(m),
          seller: s.seller,
          beneficiary: s.beneficiary,
          total: s.total,
        };
      });
    }
    return map;
  }, [items, monthsRange]);

  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        {/* Header */}
        <div className="mb-6 flex w-full flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Mis ganancias (mensual)</h1>
            <p className="text-sm opacity-70">
              Detalle por mes y moneda. Incluye lo que ganas como vendedor y
              como lider.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs opacity-70">
            <span className={PILL_WHITE}>Zona Horaria: Buenos Aires</span>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadAll();
          }}
          className={`${CARD} mb-8`}
        >
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
              <div className="flex flex-col gap-2">
                <label className="block text-xs opacity-70">Desde</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className={INPUT}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="block text-xs opacity-70">Hasta</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className={INPUT}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="block text-xs opacity-70">
                  Tipo de fecha
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDateField("creation")}
                    className={`size-fit flex-1 rounded-full border border-sky-200/50 bg-sky-100/70 py-2 text-sm text-sky-950 shadow-sm shadow-sky-900/20 transition hover:scale-[.98] active:scale-95 disabled:opacity-50 dark:border-sky-400/30 dark:bg-sky-900/30 dark:text-sky-100 ${
                      dateField === "creation"
                        ? "border-sky-400/50"
                        : "opacity-70"
                    }`}
                  >
                    Creacion
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateField("departure")}
                    className={`size-fit flex-1 rounded-full border border-sky-200/50 bg-sky-100/70 py-2 text-sm text-sky-950 shadow-sm shadow-sky-900/20 transition hover:scale-[.98] active:scale-95 disabled:opacity-50 dark:border-sky-400/30 dark:bg-sky-900/30 dark:text-sky-100 ${
                      dateField === "departure"
                        ? "border-sky-400/50"
                        : "opacity-70"
                    }`}
                  >
                    Viaje
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="block text-xs opacity-70">
                  Cobrado minimo (%)
                </label>
                <div className="flex items-center justify-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={minPaidPct}
                    onChange={(e) => setMinPaidPct(clampPct(e.target.value))}
                    className="w-full accent-sky-500 hover:cursor-pointer"
                  />
                  <span className="text-sm font-medium">{minPaidPct}%</span>
                </div>
                <p className="mt-1 text-[11px] opacity-60">
                  Aplica a reservas con al menos este % cobrado. (recibos
                  iguales o mayores al {minPaidPct}% del total de la reserva).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className={PILL_SKY}
                aria-expanded={showAdvanced}
              >
                <span className="flex items-center justify-center gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className={`size-3 transition ${
                      showAdvanced ? "rotate-180" : ""
                    }`}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m19.5 8.25-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                  {showAdvanced ? "Ocultar filtros" : "Filtros avanzados"}
                </span>
              </button>

              <div className="flex items-center gap-3">
                <button type="submit" disabled={loading} className={BTN_SKY}>
                  {loading ? (
                    <Spinner />
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        className="size-5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                        />
                      </svg>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilters({
                      clientStatus: "Todas",
                      operatorStatus: "Todas",
                      paymentMethodId: "",
                      accountId: "",
                    });
                    setDateField("creation");
                    setMinPaidPct(40);
                    setShowAdvanced(false);
                    const range = defaultRange12Months(DEFAULT_TZ);
                    setFrom(range.from);
                    setTo(range.to);
                  }}
                  className={BTN_ROSE}
                >
                  <span className="gap flex items-center justify-center gap-2 text-sm">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="size-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                    Limpiar
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const range = monthRangeInTz(DEFAULT_TZ);
                    setFrom(range.from);
                    setTo(range.to);
                  }}
                  className={BTN_SKY}
                >
                  <span className="flex items-center justify-center gap-2 text-sm">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="size-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6.75 3v1.5M17.25 3v1.5M3 8.25h18M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6.75a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 0 3 6.75V18a1.5 1.5 0 0 0 1.5 1.5ZM8.25 12h.008v.008H8.25V12Zm0 3h.008v.008H8.25V15Zm3-3h.008v.008H11.25V12Zm0 3h.008v.008H11.25V15Zm3-3h.008v.008H14.25V12Zm0 3h.008v.008H14.25V15Z"
                      />
                    </svg>
                    Mes actual
                  </span>
                </button>
              </div>
            </div>

            {showAdvanced && (
              <div className="grid grid-cols-1 gap-6 border-t border-white/10 pt-6 md:grid-cols-2 xl:grid-cols-4">
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">
                    Estado pax
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={`client-${opt}`}
                        type="button"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            clientStatus: opt,
                          }))
                        }
                        className={`${PILL_SKY} ${
                          filters.clientStatus === opt
                            ? "border-sky-400/50"
                            : "opacity-70"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">
                    Estado operador
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={`op-${opt}`}
                        type="button"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            operatorStatus: opt,
                          }))
                        }
                        className={`${PILL_SKY} ${
                          filters.operatorStatus === opt
                            ? "border-sky-400/50"
                            : "opacity-70"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">
                    Metodo de pago
                  </label>
                  <select
                    value={filters.paymentMethodId}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        paymentMethodId: e.target.value,
                      }))
                    }
                    className={INPUT}
                  >
                    <option value="">Todos</option>
                    {paymentMethods.map((m) => (
                      <option key={m.id_method} value={String(m.id_method)}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">Cuenta</label>
                  <select
                    value={filters.accountId}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        accountId: e.target.value,
                      }))
                    }
                    className={INPUT}
                  >
                    <option value="">Todas</option>
                    {accounts.map((a) => (
                      <option key={a.id_account} value={String(a.id_account)}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Totales por moneda */}
        {Object.keys(totalsByCurrency).length > 0 && (
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            {Object.entries(totalsByCurrency).map(([code, v]) => (
              <div key={code} className={CARD}>
                <p className="text-end font-light tracking-wide">{code}</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className={STACK_SKY}>
                    <p className="text-xs uppercase opacity-70">Vendedor</p>
                    <p className="text-lg font-semibold">
                      {formatMoney(v.seller, code)}
                    </p>
                  </div>
                  <div className={STACK_AMBER}>
                    <p className="text-xs uppercase opacity-70">
                      Lider de equipo
                    </p>
                    <p className="text-lg font-semibold">
                      {formatMoney(v.beneficiary, code)}
                    </p>
                  </div>
                  <div className={STACK_EMERALD}>
                    <p className="text-xs uppercase opacity-70">Total</p>
                    <p className="text-lg font-semibold">
                      {formatMoney(v.total, code)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Graficos por moneda */}
        {Object.keys(dataByCurrency).map((code) => {
          const data = dataByCurrency[code] || [];
          if (data.length === 0) return null;
          return (
            <div key={code} className={`${CARD} mb-8`}>
              <h2 className="mb-4 text-center text-2xl font-medium">{code}</h2>
              <ResponsiveContainer width="100%" height={380}>
                <BarChart
                  data={data}
                  margin={{ bottom: 70, left: 8, right: 8 }}
                >
                  <CartesianGrid
                    stroke="currentColor"
                    strokeOpacity={0.15}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="month"
                    height={60}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    tick={{ fill: "currentColor", fontSize: 12 }}
                  />
                  <YAxis
                    tick={{ fill: "currentColor", fontSize: 12 }}
                    width={80}
                  />
                  <Tooltip content={<MoneyTooltip code={code} />} />
                  <Legend
                    verticalAlign="top"
                    wrapperStyle={{ color: "currentColor" }}
                    height={50}
                  />
                  <Bar
                    dataKey="seller"
                    stackId="a"
                    name="Vendedor"
                    fill="rgba(125, 211, 252, 0.85)"
                  />
                  <Bar
                    dataKey="beneficiary"
                    stackId="a"
                    name="Lider de equipo"
                    radius={[8, 8, 0, 0]}
                    fill="rgba(14, 165, 233, 0.85)"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })}

        {/* Tablas por moneda */}
        {Object.keys(dataByCurrency).map((code) => {
          const data = dataByCurrency[code] || [];
          if (data.length === 0) return null;
          return (
            <div key={`tbl-${code}`} className={`${CARD} mb-8 overflow-x-auto`}>
              <h3 className="mb-2 font-medium">{code}</h3>
              <table className="w-full text-center">
                <thead>
                  <tr className="text-sky-700 dark:text-sky-200">
                    <th className="px-4 py-2 font-medium">Mes</th>
                    <th className="px-4 py-2 font-medium">Vendedor</th>
                    <th className="px-4 py-2 font-medium">Lider de equipo</th>
                    <th className="px-4 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr
                      key={`${code}-${row.month}`}
                      className="border-b font-light dark:border-white/10"
                    >
                      <td className="px-4 py-2">{row.month}</td>
                      <td className="px-4 py-2">
                        {formatMoney(row.seller, code)}
                      </td>
                      <td className="px-4 py-2">
                        {formatMoney(row.beneficiary, code)}
                      </td>
                      <td className="px-4 py-2">
                        {formatMoney(row.total, code)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}

        {!loading && items.length === 0 && (
          <p className="text-center opacity-80">No hay datos para ese rango.</p>
        )}
      </section>
    </ProtectedRoute>
  );
}
