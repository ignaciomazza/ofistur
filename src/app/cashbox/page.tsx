// src/app/cashbox/page.tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { authFetch } from "@/utils/authFetch";
import { useAuth } from "@/context/AuthContext";
import { loadFinancePicks } from "@/utils/loadFinancePicks";
import {
  formatDateInBuenosAires,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";

/* =========================================================
 * Tipos (alineados con /api/cashbox)
 * ========================================================= */

type MovementKind =
  | "income"
  | "expense"
  | "client_debt"
  | "operator_debt"
  | "other";

type MovementSource =
  | "receipt"
  | "other_income"
  | "investment"
  | "client_payment"
  | "operator_due"
  | "credit_entry"
  | "manual"
  | "other";

type PaymentBreakdown = {
  amount: number;
  paymentMethod?: string | null;
  account?: string | null;
};

type CashboxMovement = {
  id: string;
  date: string;
  type: MovementKind;
  source: MovementSource;
  description: string;
  currency: string;
  amount: number;
  clientName?: string | null;
  operatorName?: string | null;
  bookingLabel?: string | null;
  dueDate?: string | null;

  // Nuevos campos
  paymentMethod?: string | null;
  account?: string | null;
  categoryName?: string | null;
  counterpartyName?: string | null;
  payeeName?: string | null;

  // Detalle de cobros múltiples (si aplica)
  payments?: PaymentBreakdown[];
};

type CurrencySummary = {
  currency: string;
  income: number;
  expenses: number;
  net: number;
};

type DebtSummary = {
  currency: string;
  amount: number;
};

type PaymentMethodSummary = {
  paymentMethod: string;
  currency: string;
  income: number;
  expenses: number;
  net: number;
};

type AccountSummary = {
  account: string;
  currency: string;
  income: number;
  expenses: number;
  net: number;
  opening?: number;
  closing?: number;
};

type CashboxSummaryResponse = {
  range: {
    year: number;
    month: number;
    from: string;
    to: string;
  };

  // Totales por moneda
  totalsByCurrency: CurrencySummary[];

  // Nuevos totales
  totalsByPaymentMethod: PaymentMethodSummary[];
  totalsByAccount: AccountSummary[];

  balances: {
    clientDebtByCurrency: DebtSummary[];
    operatorDebtByCurrency: DebtSummary[];
  };
  upcomingDue: CashboxMovement[];
  movements: CashboxMovement[];
};

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string };

type FinanceCurrency = {
  code: string;
  name: string;
  enabled: boolean;
};

type MovementOrder = "newest" | "oldest";

const MONTH_OPTIONS = [
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

// Opciones de filtro de tipo SOLO para ingresos/egresos en la tabla
const MOVEMENT_TYPE_FILTER_OPTIONS: {
  value: MovementKind | "ALL";
  label: string;
}[] = [
  { value: "ALL", label: "Ingresos y egresos" },
  { value: "income", label: "Sólo ingresos" },
  { value: "expense", label: "Sólo egresos" },
];

/* =========================================================
 * Helpers de formato / moneda
 * ========================================================= */

// mismo criterio que en Recibos
const normCurrency = (c?: string | null) => {
  const cu = (c || "").toUpperCase().trim();
  if (["USD", "US$", "U$S", "DOL"].includes(cu)) return "USD";
  if (["ARS", "$"].includes(cu)) return "ARS";
  if (/^[A-Z]{3}$/.test(cu)) return cu;
  return "ARS";
};

function formatAmount(amount: number, rawCurrency: string): string {
  const currency = normCurrency(rawCurrency);
  const safe = Number.isFinite(amount) ? amount : 0;

  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${safe.toFixed(2)} ${currency}`;
  }
}

function formatDateShort(iso: string): string {
  return formatDateInBuenosAires(iso, {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatDateTime(iso: string): string {
  return formatDateInBuenosAires(iso, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function movementTypeLabel(type: MovementKind): string {
  switch (type) {
    case "income":
      return "Ingreso";
    case "expense":
      return "Egreso";
    case "client_debt":
      return "Deuda pax";
    case "operator_debt":
      return "Deuda operador";
    default:
      return "Otro";
  }
}

/**
 * Pilas/Chips de tipo de movimiento
 * Más contraste en light, manteniendo glow en dark.
 */
function movementTypeColor(type: MovementKind): string {
  switch (type) {
    case "income":
      return "bg-emerald-500/10 text-emerald-800 border-emerald-500/40 dark:bg-emerald-500/25 dark:text-emerald-50";
    case "expense":
      return "bg-rose-500/10 text-rose-800 border-rose-500/40 dark:bg-rose-500/25 dark:text-rose-50";
    case "client_debt":
      return "bg-amber-500/10 text-amber-800 border-amber-500/40 dark:bg-amber-500/25 dark:text-amber-50";
    case "operator_debt":
      return "bg-sky-500/10 text-sky-800 border-sky-500/40 dark:bg-sky-500/25 dark:text-sky-50";
    default:
      return "bg-zinc-500/10 text-zinc-800 border-zinc-500/40 dark:bg-sky-500/25 dark:text-zinc-50";
  }
}

/* =========================================================
 * Page component
 * ========================================================= */

export default function CashboxPage() {
  const { token } = useAuth();

  const now = useMemo(() => new Date(), []);
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(
    now.getMonth() + 1,
  );

  const [cashbox, setCashbox] = useState<CashboxSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  // Filtros locales para tabla
  const [filterCurrency, setFilterCurrency] = useState<string>("ALL");
  const [filterType, setFilterType] = useState<MovementKind | "ALL">("ALL");
  const [filterPaymentMethod, setFilterPaymentMethod] = useState<string>("ALL");
  const [filterAccount, setFilterAccount] = useState<string>("ALL");
  const [movementOrder, setMovementOrder] = useState<MovementOrder>("newest");

  // Monedas desde configuración financiera
  const [financeCurrencies, setFinanceCurrencies] = useState<
    FinanceCurrency[] | null
  >(null);

  const hasData = !!cashbox;

  /* ------------------------------
   * Fetch cashbox
   * ------------------------------ */
  const fetchCashbox = useCallback(
    async (opts?: { initial?: boolean }) => {
      if (!token) return;

      const isFirstLoad = !!opts?.initial;

      if (isFirstLoad) {
        setIsLoading(true);
        setIsRefreshing(false);
      } else {
        setIsRefreshing(true);
      }

      try {
        const params = new URLSearchParams({
          year: String(selectedYear),
          month: String(selectedMonth),
        });

        const res = await authFetch(
          `/api/cashbox?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
          },
          token || undefined,
        );

        let json: ApiResponse<CashboxSummaryResponse> | null = null;

        try {
          json = (await res.json()) as ApiResponse<CashboxSummaryResponse>;
        } catch {
          // ignoramos error de parseo de JSON; lo manejamos abajo
        }

        if (!res.ok || !json) {
          const message =
            json && !json.ok && json.error
              ? json.error
              : "No se pudo cargar la caja.";
          toast.error(message);
          return;
        }

        if (!json.ok) {
          toast.error(json.error || "Error al cargar la caja.");
          return;
        }

        setCashbox(json.data);
      } catch (error) {
        console.error("[cashbox/page] Error al fetcher caja:", error);
        toast.error("Error inesperado al cargar la caja.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [token, selectedYear, selectedMonth],
  );

  useEffect(() => {
    if (!token) return;
    void fetchCashbox({ initial: true });
  }, [token, fetchCashbox]);

  /* ------------------------------
   * Cargar monedas desde FinanceConfig
   * ------------------------------ */
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const run = async () => {
      try {
        const picks = await loadFinancePicks(token);
        if (cancelled) return;
        setFinanceCurrencies(picks?.currencies ?? null);
      } catch {
        if (!cancelled) setFinanceCurrencies(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const movements = useMemo(() => cashbox?.movements ?? [], [cashbox]);

  const clientDebts = cashbox?.balances.clientDebtByCurrency ?? [];
  const operatorDebts = cashbox?.balances.operatorDebtByCurrency ?? [];
  const upcomingDue = cashbox?.upcomingDue ?? [];

  const totalsByPaymentMethod = cashbox?.totalsByPaymentMethod ?? [];
  const totalsByAccount = cashbox?.totalsByAccount ?? [];

  /* ------------------------------
   * Diccionario de labels de moneda y opciones
   * ------------------------------ */
  const currencyLabelDict = useMemo(() => {
    const dict: Record<string, string> = {};
    for (const c of financeCurrencies || []) {
      if (c.enabled && c.code) {
        dict[normCurrency(c.code)] = c.name;
      }
    }
    return dict;
  }, [financeCurrencies]);

  const movementCurrencyCodes = useMemo(() => {
    const set = new Set<string>();
    movements.forEach((m) => set.add(normCurrency(m.currency)));
    return Array.from(set);
  }, [movements]);

  const currencyOptions = useMemo(() => {
    const fromConfig =
      financeCurrencies
        ?.filter((c) => c.enabled)
        .map((c) => normCurrency(c.code)) ?? [];
    const all = new Set<string>([...fromConfig, ...movementCurrencyCodes]);
    return Array.from(all).sort((a, b) => a.localeCompare(b, "es"));
  }, [financeCurrencies, movementCurrencyCodes]);

  // Opciones de medio de pago (sólo ingresos/egresos)
  const paymentMethodOptions = useMemo(() => {
    const set = new Set<string>();
    movements.forEach((m) => {
      if (m.type === "income" || m.type === "expense") {
        if (Array.isArray(m.payments) && m.payments.length > 0) {
          m.payments.forEach((p) => {
            const label = (p.paymentMethod ?? "Sin método").trim();
            if (label) set.add(label);
          });
        } else {
          const label = (m.paymentMethod ?? "Sin método").trim();
          if (label) set.add(label);
        }
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [movements]);

  // Opciones de cuenta según medio de pago seleccionado
  const accountOptions = useMemo(() => {
    if (filterPaymentMethod === "ALL") return [];
    const set = new Set<string>();
    movements.forEach((m) => {
      if (m.type !== "income" && m.type !== "expense") return;
      if (Array.isArray(m.payments) && m.payments.length > 0) {
        m.payments.forEach((p) => {
          const pmLabel = (p.paymentMethod ?? "Sin método").trim();
          if (pmLabel !== filterPaymentMethod) return;
          const accLabel = (p.account ?? "Sin cuenta").trim();
          if (accLabel) set.add(accLabel);
        });
      } else {
        const pmLabel = (m.paymentMethod ?? "Sin método").trim();
        if (pmLabel !== filterPaymentMethod) return;
        const accLabel = (m.account ?? "Sin cuenta").trim();
        if (accLabel) set.add(accLabel);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [movements, filterPaymentMethod]);

  // Forzar que filterCurrency siga siendo válido
  useEffect(() => {
    if (
      filterCurrency !== "ALL" &&
      currencyOptions.length > 0 &&
      !currencyOptions.includes(filterCurrency)
    ) {
      setFilterCurrency("ALL");
    }
  }, [currencyOptions, filterCurrency]);

  // Si cambia el medio de pago y ya no existe, reseteamos
  useEffect(() => {
    if (
      filterPaymentMethod !== "ALL" &&
      paymentMethodOptions.length > 0 &&
      !paymentMethodOptions.includes(filterPaymentMethod)
    ) {
      setFilterPaymentMethod("ALL");
      setFilterAccount("ALL");
    }
  }, [paymentMethodOptions, filterPaymentMethod]);

  // Si la cuenta actual deja de existir para ese medio, reseteamos
  useEffect(() => {
    if (
      filterAccount !== "ALL" &&
      accountOptions.length > 0 &&
      !accountOptions.includes(filterAccount)
    ) {
      setFilterAccount("ALL");
    }
  }, [accountOptions, filterAccount]);

  /* ------------------------------
   * Totales por moneda (agrupados por código)
   * ------------------------------ */
  const totalsByCurrency = useMemo(() => {
    const raw: CurrencySummary[] = cashbox?.totalsByCurrency ?? [];

    const map = new Map<
      string,
      { currency: string; income: number; expenses: number; net: number }
    >();

    for (const t of raw) {
      const code = normCurrency(t.currency);
      const existing = map.get(code);
      if (existing) {
        existing.income += t.income;
        existing.expenses += t.expenses;
        existing.net += t.net;
      } else {
        map.set(code, {
          currency: code,
          income: t.income,
          expenses: t.expenses,
          net: t.net,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency, "es"),
    );
  }, [cashbox]);

  /* ------------------------------
   * Movimientos filtrados (sólo ingresos y egresos)
   * ------------------------------ */
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      // Sólo queremos ingresos y egresos en la tabla de movimientos
      if (m.type !== "income" && m.type !== "expense") {
        return false;
      }

      const matchCurrency =
        filterCurrency === "ALL" ||
        normCurrency(m.currency) === normCurrency(filterCurrency);

      const matchType = filterType === "ALL" || m.type === filterType;

      const paymentCandidates =
        Array.isArray(m.payments) && m.payments.length > 0
          ? m.payments
          : [
              {
                paymentMethod: m.paymentMethod,
                account: m.account,
              },
            ];

      const matchPaymentAccount =
        filterPaymentMethod === "ALL" && filterAccount === "ALL"
          ? true
          : paymentCandidates.some((p) => {
              const pmLabel = (p.paymentMethod ?? "Sin método").trim();
              const accLabel = (p.account ?? "Sin cuenta").trim();
              const matchPm =
                filterPaymentMethod === "ALL" ||
                pmLabel === filterPaymentMethod;
              const matchAcc =
                filterAccount === "ALL" || accLabel === filterAccount;
              return matchPm && matchAcc;
            });

      return matchCurrency && matchType && matchPaymentAccount;
    });
  }, [
    movements,
    filterCurrency,
    filterType,
    filterPaymentMethod,
    filterAccount,
  ]);

  const sortedFilteredMovements = useMemo(() => {
    const sorted = [...filteredMovements];
    sorted.sort((a, b) => {
      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();
      if (timeA === timeB) {
        return movementOrder === "newest"
          ? b.id.localeCompare(a.id, "es")
          : a.id.localeCompare(b.id, "es");
      }
      return movementOrder === "newest" ? timeB - timeA : timeA - timeB;
    });
    return sorted;
  }, [filteredMovements, movementOrder]);

  const handleSetCurrentMonth = () => {
    const current = new Date();
    setSelectedYear(current.getFullYear());
    setSelectedMonth(current.getMonth() + 1);
  };

  const handleRefreshClick = () => {
    void fetchCashbox({ initial: false });
  };

  const downloadCSV = useCallback(() => {
    setExportingCsv(true);
    try {
      const headers = [
        "Fecha",
        "Tipo",
        "Origen",
        "Categoría",
        "Detalle",
        "Quién paga",
        "A quién se le paga",
        "Moneda",
        "Monto",
        "Medio",
        "Cuenta",
        "Relacionado",
        "Vence",
      ].join(";");

      const rows = sortedFilteredMovements.map((movement) => {
        const paymentEntries =
          Array.isArray(movement.payments) && movement.payments.length > 0
            ? movement.payments
            : [
                {
                  amount: movement.amount,
                  paymentMethod: movement.paymentMethod,
                  account: movement.account,
                },
              ];

        const methodText = Array.from(
          new Set(
            paymentEntries
              .map((entry) => (entry.paymentMethod ?? "Sin método").trim())
              .filter(Boolean),
          ),
        ).join(" | ");

        const accountText = Array.from(
          new Set(
            paymentEntries
              .map((entry) => (entry.account ?? "Sin cuenta").trim())
              .filter(Boolean),
          ),
        ).join(" | ");

        const relatedText = [
          movement.clientName ? `Pax: ${movement.clientName}` : "",
          movement.operatorName ? `Operador: ${movement.operatorName}` : "",
          movement.bookingLabel || "",
        ]
          .filter(Boolean)
          .join(" | ");

        const cells = [
          formatDateShort(movement.date),
          movementTypeLabel(movement.type),
          movement.source,
          movement.categoryName || "",
          movement.description || "",
          movement.counterpartyName || "",
          movement.payeeName || "",
          normCurrency(movement.currency),
          formatAmount(movement.amount, movement.currency),
          methodText || "",
          accountText || "",
          relatedText,
          movement.dueDate ? formatDateShort(movement.dueDate) : "",
        ];

        return cells
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(";");
      });

      const csv = [headers, ...rows].join("\r\n");
      const blob = new Blob(["\uFEFF", csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `caja_movimientos_${todayDateKeyInBuenosAires()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[cashbox/page] Error exportando CSV:", error);
      toast.error("No se pudo exportar los movimientos.");
    } finally {
      setExportingCsv(false);
    }
  }, [sortedFilteredMovements]);

  return (
    <ProtectedRoute>
      <main className="min-h-screen text-zinc-900 dark:text-zinc-50">
        <ToastContainer
          position="top-right"
          autoClose={4000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          pauseOnHover
          draggable
          theme="dark"
        />

        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8">
          {/* Header / Filtros */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-3xl">
                Caja de la agencia
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Panel mensual para gerencia: ingresos, egresos, deudas y
                vencimientos de la agencia en un solo lugar.
              </p>
              {cashbox && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Rango analizado: {formatDateShort(cashbox.range.from)} –{" "}
                  {formatDateShort(cashbox.range.to)}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-3xl border border-zinc-900/10 bg-white/10 px-3 py-2 shadow-md shadow-zinc-900/10 backdrop-blur dark:border-white/10 dark:bg-sky-900/10 dark:shadow-zinc-950/40">
                <select
                  className="cursor-pointer appearance-none rounded-2xl border border-zinc-900/20 bg-transparent px-2 py-1 text-xs text-zinc-900 outline-none hover:border-emerald-400/60 dark:border-white/10 dark:bg-sky-950/10 dark:text-zinc-100"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="w-20 rounded-2xl border border-zinc-900/20 bg-transparent px-2 py-1 text-xs text-zinc-900 outline-none hover:border-emerald-400/60 dark:border-white/10 dark:bg-sky-950/10 dark:text-zinc-100"
                  value={selectedYear}
                  onChange={(e) =>
                    setSelectedYear(Number(e.target.value) || selectedYear)
                  }
                />
              </div>

              <button
                type="button"
                onClick={handleSetCurrentMonth}
                className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 shadow-md shadow-emerald-900/10 transition hover:bg-emerald-500/20 dark:text-emerald-200 dark:shadow-emerald-900/40"
              >
                Mes actual
              </button>

              <button
                type="button"
                onClick={handleRefreshClick}
                disabled={isLoading || isRefreshing || !token}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-500/40 bg-zinc-900/5 px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-md shadow-zinc-900/10 transition hover:bg-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-900/10 dark:text-zinc-100 dark:shadow-zinc-950/40 dark:hover:bg-zinc-800/80"
              >
                {isRefreshing || isLoading ? (
                  <>
                    <Spinner />
                    Actualizando...
                  </>
                ) : (
                  <>
                    <span className="inline-block size-2 animate-pulse rounded-full bg-emerald-500" />
                    Actualizar datos
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Loading inicial */}
          {isLoading && !hasData && (
            <div className="flex min-h-[200px] items-center justify-center rounded-3xl border border-zinc-900/10 bg-white/10 shadow-md shadow-zinc-900/10 backdrop-blur dark:border-white/10 dark:bg-sky-900/10 dark:shadow-zinc-950/60">
              <div className="flex flex-col items-center gap-3 text-zinc-700 dark:text-zinc-200">
                <Spinner />
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Calculando caja del mes...
                </p>
              </div>
            </div>
          )}

          {/* Sin datos */}
          {!isLoading && !hasData && (
            <div className="rounded-3xl border border-dashed border-zinc-400/60 bg-white/5 p-6 text-center text-sm text-zinc-600 shadow-md shadow-zinc-900/10 backdrop-blur dark:border-zinc-600/60 dark:bg-sky-900/10 dark:text-zinc-300 dark:shadow-zinc-950/60">
              No hay datos de caja para el período seleccionado. Probá con otro
              mes o generá movimientos (recibos / gastos / deudas).
            </div>
          )}

          {/* Contenido principal */}
          {hasData && cashbox && (
            <>
              {/* Resumen superior */}
              <section className="grid gap-4 md:grid-cols-3">
                {/* Card neto total por moneda */}
                <div className="rounded-3xl border border-emerald-500/40 bg-emerald-500/5 p-5 shadow-md shadow-emerald-900/10 backdrop-blur dark:bg-emerald-500/5 dark:shadow-emerald-900/40">
                  <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    Resultado neto del mes por moneda
                  </p>

                  <div className="mt-3 space-y-2">
                    {totalsByCurrency.length === 0 ? (
                      <p className="text-xs text-emerald-800/80 dark:text-emerald-100/80">
                        No hay ingresos ni egresos registrados en este período.
                      </p>
                    ) : (
                      totalsByCurrency.map((t) => {
                        const code = normCurrency(t.currency);
                        const label = currencyLabelDict[code];
                        const sign = t.net > 0 ? "+" : t.net < 0 ? "-" : "";
                        const absNet = Math.abs(t.net);
                        const isPositive = t.net >= 0;

                        return (
                          <div
                            key={code}
                            className="flex items-center justify-between rounded-2xl bg-emerald-500/5 px-3 py-2 dark:bg-emerald-500/10"
                          >
                            <div>
                              <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-50">
                                {code}
                                {label ? ` — ${label}` : ""}
                              </p>
                              <p className="text-[11px] text-emerald-800/80 dark:text-emerald-100/80">
                                Ingresos − egresos + saldo inicial
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                isPositive
                                  ? "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-50"
                                  : "bg-rose-500/15 text-rose-800 dark:bg-rose-500/25 dark:text-rose-50"
                              }`}
                            >
                              {sign}
                              {formatAmount(absNet, code)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <p className="mt-3 text-[11px] text-emerald-700/80 dark:text-emerald-100/80">
                    El resultado se calcula por moneda, sin mezclar distintos
                    tipos de cambio. Si hay saldo inicial cargado en cuentas, se
                    suma al resultado. Usalo como termómetro rápido de cómo
                    viene el mes en cada moneda.
                  </p>
                </div>

                {/* Totales por moneda (ya agrupados) */}
                <div className="rounded-3xl border border-white/20 bg-white/10 p-5 shadow-md shadow-zinc-900/10 backdrop-blur dark:border-white/10 dark:bg-sky-900/10 dark:shadow-zinc-950/70">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                    Totales por moneda
                  </p>
                  <div className="mt-3 space-y-3">
                    {totalsByCurrency.length === 0 && (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        No hay movimientos registrados en este período.
                      </p>
                    )}
                    {totalsByCurrency.map((t) => {
                      const code = normCurrency(t.currency);
                      const label = currencyLabelDict[code];
                      return (
                        <div
                          key={code}
                          className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2 dark:bg-sky-900/10"
                        >
                          <div>
                            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                              {code}
                              {label ? ` — ${label}` : ""}
                            </p>
                            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                              Ingresos • Egresos
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 text-[11px]">
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-200">
                              {formatAmount(t.income, code)}
                            </span>
                            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:text-rose-200">
                              {formatAmount(t.expenses, code)}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 ${
                                t.net >= 0
                                  ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100"
                                  : "bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-100"
                              }`}
                            >
                              Neto (incluye saldo inicial):{" "}
                              {formatAmount(t.net, code)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Saldos globales (deudas) */}
                <div className="rounded-3xl border border-white/20 bg-white/10 p-5 shadow-md shadow-zinc-900/10 backdrop-blur dark:border-white/10 dark:bg-sky-900/10 dark:shadow-zinc-950/70">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                    Cuentas Credito{" "}
                    <span className="font-light lowercase opacity-70">
                      (General)
                    </span>
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                    <div className="rounded-2xl bg-white/5 p-3 dark:bg-sky-900/10">
                      <p className="mb-1 text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                        Pasajeros ➜ Agencia
                      </p>
                      {clientDebts.length === 0 && (
                        <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          Sin deuda registrada.
                        </p>
                      )}
                      {clientDebts.map((d) => {
                        const code = normCurrency(d.currency);
                        return (
                          <div
                            key={`${code}-client`}
                            className="flex items-center justify-between"
                          >
                            <span className="text-zinc-700 dark:text-zinc-300">
                              {code}
                            </span>
                            <span className="text-amber-700 dark:text-amber-200">
                              {formatAmount(d.amount, code)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="rounded-2xl bg-white/5 p-3 dark:bg-sky-900/10">
                      <p className="mb-1 text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                        Agencia ➜ Operadores
                      </p>
                      {operatorDebts.length === 0 && (
                        <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          Sin deuda registrada.
                        </p>
                      )}
                      {operatorDebts.map((d) => {
                        const code = normCurrency(d.currency);
                        return (
                          <div
                            key={`${code}-operator`}
                            className="flex items-center justify-between"
                          >
                            <span className="text-zinc-700 dark:text-zinc-300">
                              {code}
                            </span>
                            <span className="text-sky-700 dark:text-sky-200">
                              {formatAmount(d.amount, code)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                    {`Para ver mas informacion ingresa a la seccion "Creditos".`}
                  </p>
                </div>
              </section>

              {/* NUEVO: resumen por medio de pago y por cuenta */}
              <section className="grid gap-4 md:grid-cols-2">
                {/* Por medio de pago */}
                <div className="rounded-3xl border border-white/20 bg-white/10 p-5 shadow-md shadow-zinc-900/10 backdrop-blur dark:border-white/10 dark:bg-sky-900/10 dark:shadow-zinc-950/70">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                    Caja por medio de pago
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                    Cómo se reparten ingresos y egresos entre efectivo,
                    transferencias, billeteras, etc.
                  </p>

                  <div className="mt-3 space-y-2">
                    {totalsByPaymentMethod.length === 0 ? (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        No hay movimientos con medios de pago registrados en
                        este período.
                      </p>
                    ) : (
                      totalsByPaymentMethod.map((t) => {
                        const code = normCurrency(t.currency);
                        const label = currencyLabelDict[code];
                        const isPositive = t.net >= 0;

                        return (
                          <div
                            key={`${t.paymentMethod}-${code}`}
                            className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2 dark:bg-sky-900/20"
                          >
                            <div>
                              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                                {t.paymentMethod || "Sin método"}
                              </p>
                              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                                {code}
                                {label ? ` — ${label}` : ""}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1 text-[11px]">
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100">
                                {formatAmount(t.income, code)}
                              </span>
                              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:bg-rose-500/20 dark:text-rose-100">
                                {formatAmount(t.expenses, code)}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 ${
                                  isPositive
                                    ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-50"
                                    : "bg-rose-500/10 text-rose-700 dark:bg-rose-500/25 dark:text-rose-50"
                                }`}
                              >
                                Neto: {formatAmount(t.net, code)}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Por cuenta */}
                <div className="rounded-3xl border border-white/20 bg-white/10 p-5 shadow-md shadow-zinc-900/10 backdrop-blur dark:border-white/10 dark:bg-sky-900/10 dark:shadow-zinc-950/70">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                    Caja por cuenta
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                    Evolución por cuenta específica (ej. Macro CC, Caja local,
                    Mercado Pago, etc.).
                  </p>

                  <div className="mt-3 space-y-2">
                    {totalsByAccount.length === 0 ? (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        No hay movimientos con cuentas asociadas en este
                        período.
                      </p>
                    ) : (
                      totalsByAccount.map((t) => {
                        const code = normCurrency(t.currency);
                        const label = currencyLabelDict[code];
                        const isPositive = t.net >= 0;
                        const hasBalance = typeof t.opening === "number";
                        const opening =
                          typeof t.opening === "number" ? t.opening : 0;
                        const closing =
                          typeof t.closing === "number"
                            ? t.closing
                            : opening + t.net;

                        return (
                          <div
                            key={`${t.account}-${code}`}
                            className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2 dark:bg-sky-900/20"
                          >
                            <div>
                              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                                {t.account || "Sin cuenta"}
                              </p>
                              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                                {code}
                                {label ? ` — ${label}` : ""}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1 text-[11px]">
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100">
                                {formatAmount(t.income, code)}
                              </span>
                              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:bg-rose-500/20 dark:text-rose-100">
                                {formatAmount(t.expenses, code)}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 ${
                                  isPositive
                                    ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-50"
                                    : "bg-rose-500/10 text-rose-700 dark:bg-rose-500/25 dark:text-rose-50"
                                }`}
                              >
                                Neto: {formatAmount(t.net, code)}
                              </span>
                              {hasBalance && (
                                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:bg-sky-500/20 dark:text-sky-100">
                                  Saldo: {formatAmount(opening, code)} →{" "}
                                  {formatAmount(closing, code)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </section>

              {/* Movimientos del mes + filtros (sólo ingresos/egresos, sin gráfico) */}
              <section className="rounded-3xl border border-white/20 bg-white/10 p-5 shadow-md shadow-zinc-900/10 backdrop-blur dark:border-white/10 dark:bg-sky-900/10 dark:shadow-zinc-950/80">
                <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-800 dark:text-zinc-200">
                      Movimientos del mes
                    </p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                      Ingresos y egresos registrados en el período seleccionado.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={downloadCSV}
                      disabled={
                        exportingCsv || sortedFilteredMovements.length === 0
                      }
                      className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-100"
                    >
                      {exportingCsv ? "Exportando..." : "Exportar CSV"}
                    </button>
                    <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-zinc-800 shadow-sm shadow-zinc-900/10 dark:bg-sky-800/10 dark:text-zinc-200">
                      {sortedFilteredMovements.length} movimiento
                      {sortedFilteredMovements.length === 1 ? "" : "s"} (con
                      filtros)
                    </span>
                  </div>
                </div>

                {movements.length === 0 ? (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    No hay movimientos registrados para este período.
                  </p>
                ) : (
                  <>
                    {/* Filtros locales */}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Moneda */}
                        <div className="flex items-center gap-1">
                          <span className="text-zinc-700 dark:text-zinc-300">
                            Moneda:
                          </span>
                          <select
                            value={filterCurrency}
                            onChange={(e) => setFilterCurrency(e.target.value)}
                            className="cursor-pointer appearance-none rounded-2xl border border-white/30 bg-white/10 px-2 py-1 text-xs text-zinc-900 outline-none backdrop-blur hover:border-emerald-400/60 dark:border-white/15 dark:bg-sky-900/10 dark:text-zinc-100"
                          >
                            <option value="ALL">Todas</option>
                            {currencyOptions.map((code) => (
                              <option key={code} value={code}>
                                {currencyLabelDict[code]
                                  ? `${code} — ${currencyLabelDict[code]}`
                                  : code}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Tipo */}
                        <div className="flex items-center gap-1">
                          <span className="text-zinc-700 dark:text-zinc-300">
                            Tipo:
                          </span>
                          <select
                            value={filterType}
                            onChange={(e) =>
                              setFilterType(
                                e.target.value as MovementKind | "ALL",
                              )
                            }
                            className="cursor-pointer appearance-none rounded-2xl border border-white/30 bg-white/10 px-2 py-1 text-xs text-zinc-900 outline-none backdrop-blur hover:border-emerald-400/60 dark:border-white/15 dark:bg-sky-900/10 dark:text-zinc-100"
                          >
                            {MOVEMENT_TYPE_FILTER_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-1">
                          <span className="text-zinc-700 dark:text-zinc-300">
                            Orden:
                          </span>
                          <select
                            value={movementOrder}
                            onChange={(e) =>
                              setMovementOrder(e.target.value as MovementOrder)
                            }
                            className="cursor-pointer appearance-none rounded-2xl border border-white/30 bg-white/10 px-2 py-1 text-xs text-zinc-900 outline-none backdrop-blur hover:border-emerald-400/60 dark:border-white/15 dark:bg-sky-900/10 dark:text-zinc-100"
                          >
                            <option value="newest">Más nuevos</option>
                            <option value="oldest">Más viejos</option>
                          </select>
                        </div>

                        {/* Medio de pago */}
                        <div className="flex items-center gap-1">
                          <span className="text-zinc-700 dark:text-zinc-300">
                            Medio:
                          </span>
                          <select
                            value={filterPaymentMethod}
                            onChange={(e) => {
                              setFilterPaymentMethod(e.target.value);
                              setFilterAccount("ALL");
                            }}
                            className="cursor-pointer appearance-none rounded-2xl border border-white/30 bg-white/10 px-2 py-1 text-xs text-zinc-900 outline-none backdrop-blur hover:border-emerald-400/60 dark:border-white/15 dark:bg-sky-900/10 dark:text-zinc-100"
                          >
                            <option value="ALL">Todos</option>
                            {paymentMethodOptions.map((pm) => (
                              <option key={pm} value={pm}>
                                {pm}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Cuenta (solo si el medio tiene cuentas asociadas) */}
                        {filterPaymentMethod !== "ALL" &&
                          accountOptions.length > 0 && (
                            <div className="flex items-center gap-1">
                              <span className="text-zinc-700 dark:text-zinc-300">
                                Cuenta:
                              </span>
                              <select
                                value={filterAccount}
                                onChange={(e) =>
                                  setFilterAccount(e.target.value)
                                }
                                className="cursor-pointer appearance-none rounded-2xl border border-white/30 bg-white/10 px-2 py-1 text-xs text-zinc-900 outline-none backdrop-blur hover:border-emerald-400/60 dark:border-white/15 dark:bg-sky-900/10 dark:text-zinc-100"
                              >
                                <option value="ALL">Todas</option>
                                {accountOptions.map((acc) => (
                                  <option key={acc} value={acc}>
                                    {acc}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                      </div>

                      <p className="text-[10px] text-zinc-500 dark:text-zinc-500">
                        Los filtros se aplican a la tabla de movimientos.
                      </p>
                    </div>

                    {/* Aviso: gráfico desactivado */}
                    <p className="mb-4 text-[11px] text-zinc-500 dark:text-zinc-500">
                      El gráfico de evolución mensual está desactivado
                      temporalmente. Podés seguir analizando todo desde la tabla
                      de movimientos.
                    </p>

                    {/* Tabla de movimientos filtrados */}
                    {sortedFilteredMovements.length === 0 ? (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        No hay movimientos que coincidan con los filtros
                        seleccionados.
                      </p>
                    ) : (
                      <div className="max-h-[420px] overflow-auto rounded-2xl border border-white/15 bg-white/5 dark:border-white/10 dark:bg-sky-900/10">
                        <table className="min-w-full text-left text-xs text-zinc-900 dark:text-zinc-100">
                          <thead className="sticky top-0 bg-white/60 backdrop-blur-sm dark:bg-sky-900/10">
                            <tr>
                              <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                                Fecha
                              </th>
                              <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                                Tipo
                              </th>
                              <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                                Detalle
                              </th>
                              <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                                Monto
                              </th>
                              <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                                Relacionado
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedFilteredMovements.map((m) => (
                              <tr
                                key={m.id}
                                className="border-t border-white/10 transition-colors odd:bg-white/0 even:bg-white/5 hover:bg-white/10 dark:border-white/10 dark:odd:bg-zinc-950/0 dark:even:bg-zinc-950/40 dark:hover:bg-zinc-900/70"
                              >
                                <td className="px-3 py-2 align-top text-zinc-900 dark:text-zinc-100">
                                  <div className="flex flex-col">
                                    <span>{formatDateShort(m.date)}</span>
                                    {m.dueDate && (
                                      <span className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-200">
                                        Vence: {formatDateShort(m.dueDate)}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <div className="flex flex-col gap-1">
                                    <span
                                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${movementTypeColor(
                                        m.type,
                                      )}`}
                                    >
                                      {movementTypeLabel(m.type)}
                                    </span>
                                    <span className="inline-flex rounded-full bg-zinc-900/5 px-2 py-0.5 text-[10px] text-zinc-700 dark:bg-sky-800/10 dark:text-zinc-200">
                                      {m.source}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-top text-[11px] text-zinc-900 dark:text-zinc-100">
                                  <div className="max-w-md">
                                    <p className="line-clamp-2">
                                      {m.description}
                                    </p>
                                    <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                                      Registrado: {formatDateTime(m.date)}
                                    </p>
                                    {(m.categoryName ||
                                      m.counterpartyName ||
                                      m.payeeName) && (
                                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-600 dark:text-zinc-300">
                                        {m.categoryName && (
                                          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-800 dark:bg-violet-500/20 dark:text-violet-100">
                                            Categoría: {m.categoryName}
                                          </span>
                                        )}
                                        {m.counterpartyName && (
                                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100">
                                            Quién paga: {m.counterpartyName}
                                          </span>
                                        )}
                                        {m.payeeName && (
                                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-800 dark:bg-amber-500/20 dark:text-amber-100">
                                            A quién se le paga: {m.payeeName}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {(m.paymentMethod || m.account) && (
                                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-600 dark:text-zinc-300">
                                        {m.paymentMethod && (
                                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100">
                                            Medio: {m.paymentMethod}
                                          </span>
                                        )}
                                        {m.account && (
                                          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-800 dark:bg-sky-500/20 dark:text-sky-100">
                                            Cuenta: {m.account}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {Array.isArray(m.payments) &&
                                      m.payments.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-600 dark:text-zinc-300">
                                          {m.payments.map((p, idx) => (
                                            <span
                                              key={`${m.id}-pay-${idx}`}
                                              className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-zinc-700 dark:bg-white/10 dark:text-zinc-200"
                                            >
                                              {(p.paymentMethod ?? "Sin método").trim()}
                                              {p.account
                                                ? ` • ${p.account}`
                                                : ""}
                                              {" • "}
                                              {formatAmount(
                                                Number.isFinite(p.amount)
                                                  ? p.amount
                                                  : 0,
                                                m.currency,
                                              )}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                  </div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 align-top text-[11px] font-semibold">
                                  <span
                                    className={
                                      m.type === "income"
                                        ? "text-emerald-700 dark:text-emerald-200"
                                        : m.type === "expense"
                                          ? "text-rose-700 dark:text-rose-200"
                                          : "text-zinc-900 dark:text-zinc-100"
                                    }
                                  >
                                    {formatAmount(m.amount, m.currency)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 align-top text-[11px] text-zinc-800 dark:text-zinc-200">
                                  <div className="flex flex-col gap-0.5">
                                    {m.clientName && (
                                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100">
                                        Pax: {m.clientName}
                                      </span>
                                    )}
                                    {m.operatorName && (
                                      <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-800 dark:bg-sky-500/10 dark:text-sky-100">
                                        Operador: {m.operatorName}
                                      </span>
                                    )}
                                    {m.bookingLabel && (
                                      <span className="rounded-full bg-zinc-700/10 px-2 py-0.5 text-[10px] text-zinc-800 dark:bg-sky-700/10 dark:text-zinc-100">
                                        {m.bookingLabel}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Vencimientos del período (ahí quedan las deudas) */}
              <section className="mt-2 rounded-3xl border border-amber-200/40 bg-white/5 p-5 shadow-md shadow-amber-900/10 backdrop-blur dark:shadow-amber-900/40">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200">
                      Vencimientos del período
                    </p>
                    <p className="text-xs text-amber-800/90 dark:text-amber-100/80">
                      Deudas de pasajeros y operadores que vencen dentro del
                      rango seleccionado.
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-800 shadow-sm shadow-amber-900/20 dark:bg-amber-500/20 dark:text-amber-50">
                    {upcomingDue.length} registro
                    {upcomingDue.length === 1 ? "" : "s"}
                  </span>
                </div>

                {upcomingDue.length === 0 ? (
                  <p className="text-xs text-amber-800/80 dark:text-amber-50/80">
                    No hay vencimientos registrados en este período.
                  </p>
                ) : (
                  <div className="max-h-72 overflow-auto rounded-2xl border border-amber-200/30 bg-white/5 dark:bg-sky-900/10">
                    <table className="min-w-full text-left text-xs text-zinc-900 dark:text-zinc-100">
                      <thead className="sticky top-0 bg-white/60 backdrop-blur-sm dark:bg-sky-900/10">
                        <tr>
                          <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                            Vence
                          </th>
                          <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                            Tipo
                          </th>
                          <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                            Detalle
                          </th>
                          <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                            Monto
                          </th>
                          <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                            Relacionado
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcomingDue.map((m) => (
                          <tr
                            key={m.id}
                            className="border-t border-white/10 transition-colors odd:bg-white/0 even:bg-white/5 hover:bg-white/10 dark:border-white/10 dark:odd:bg-zinc-950/0 dark:even:bg-zinc-950/40 dark:hover:bg-zinc-900/70"
                          >
                            <td className="px-3 py-2 align-top text-amber-800 dark:text-amber-100">
                              {m.dueDate ? formatDateShort(m.dueDate) : "-"}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${movementTypeColor(
                                  m.type,
                                )}`}
                              >
                                {movementTypeLabel(m.type)}
                              </span>
                            </td>
                            <td className="px-3 py-2 align-top text-[11px] text-zinc-900 dark:text-zinc-100">
                              <div className="max-w-xs">
                                <p className="line-clamp-2">{m.description}</p>
                                <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                                  Creado: {formatDateTime(m.date)}
                                </p>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 align-top text-[11px] font-semibold text-amber-800 dark:text-amber-100">
                              {formatAmount(m.amount, m.currency)}
                            </td>
                            <td className="px-3 py-2 align-top text-[11px] text-zinc-800 dark:text-zinc-200">
                              <div className="flex flex-col gap-0.5">
                                {m.clientName && (
                                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100">
                                    Pax: {m.clientName}
                                  </span>
                                )}
                                {m.operatorName && (
                                  <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-800 dark:bg-sky-500/10 dark:text-sky-50">
                                    Operador: {m.operatorName}
                                  </span>
                                )}
                                {m.bookingLabel && (
                                  <span className="rounded-full bg-zinc-700/10 px-2 py-0.5 text-[10px] text-zinc-800 dark:bg-sky-700/10 dark:text-zinc-100">
                                    {m.bookingLabel}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </ProtectedRoute>
  );
}
