// src/app/operators/insights/page.tsx
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { useAgencyOperators } from "@/hooks/receipts/useAgencyOperators";

type PeriodType = "day" | "week" | "month" | "quarter" | "semester" | "year";
type DateMode = "creation" | "travel";
type InsightsView =
  | "all"
  | "incomes"
  | "expenses"
  | "cashflow"
  | "clientDebt"
  | "operatorDebt"
  | "due"
  | "activity";

type MoneyMap = Record<string, number>;
type StatTone = "sky" | "emerald" | "rose" | "amber" | "slate";

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
  { value: "quarter", label: "Trimestre" },
  { value: "semester", label: "Semestre" },
  { value: "year", label: "Ano" },
];

const DATE_MODE_OPTIONS: { value: DateMode; label: string }[] = [
  { value: "creation", label: "Creacion" },
  { value: "travel", label: "Viaje" },
];

const VIEW_OPTIONS: { value: InsightsView; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "incomes", label: "Ingresos" },
  { value: "expenses", label: "Egresos" },
  { value: "cashflow", label: "Ingresos + Egresos" },
  { value: "clientDebt", label: "Deuda pax" },
  { value: "operatorDebt", label: "Deuda operador" },
  { value: "due", label: "Vencimientos" },
  { value: "activity", label: "Actividad" },
];

const CARD_GLOW: Record<StatTone, string> = {
  sky: "bg-sky-400/20",
  emerald: "bg-sky-400/18",
  rose: "bg-sky-500/16",
  amber: "bg-sky-300/20",
  slate: "bg-sky-200/20",
};

const PILL_TONE: Record<StatTone, string> = {
  sky: "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100",
  emerald:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100",
  rose: "bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-100",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
  slate: "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-100",
};

type OperatorInsightsResponse = {
  operator: {
    id_operator: number;
    agency_operator_id?: number | null;
    name: string | null;
  };
  range: { from: string; to: string; mode: DateMode };
  counts: {
    services: number;
    bookings: number;
    receipts: number;
    otherIncomes: number;
    investments: number;
    investmentsUnlinked: number;
    debtServices: number;
    operatorDues: number;
  };
  totals: {
    sales: MoneyMap;
    incomes: MoneyMap;
    expenses: MoneyMap;
    expensesUnlinked: MoneyMap;
    net: MoneyMap;
    operatorDebt: MoneyMap;
    clientDebt: MoneyMap;
  };
  averages: {
    avgSalePerBooking: MoneyMap;
    avgIncomePerReceipt: MoneyMap;
    servicesPerBooking: number;
  };
  lists: {
    bookings: {
      id_booking: number;
      agency_booking_id?: number | null;
      details: string | null;
      departure_date: string | null;
      return_date: string | null;
      creation_date: string | null;
      titular: {
        id_client: number;
        first_name: string;
        last_name: string;
      } | null;
      shared_operators: {
        id_operator: number;
        agency_operator_id?: number | null;
        name: string | null;
      }[];
      debt: MoneyMap;
      sale_with_interest: MoneyMap;
      paid: MoneyMap;
      operator_cost: MoneyMap;
      operator_payments: MoneyMap;
      operator_debt: MoneyMap;
      unreceipted_services: {
        id_service: number;
        agency_service_id?: number | null;
        description: string;
        sale_price: number;
        cost_price: number;
        currency: string;
      }[];
    }[];
    operatorDues: {
      id_due: number;
      due_date: string;
      status: string;
      amount: number;
      currency: string;
      booking_id: number;
      booking_agency_id?: number | null;
      service_id: number;
      service_agency_id?: number | null;
      concept: string;
    }[];
    receipts: {
      id_receipt: number;
      agency_receipt_id?: number | null;
      issue_date: string;
      concept: string;
      amount: number;
      currency: string;
      booking_id: number | null;
      booking_agency_id?: number | null;
    }[];
    otherIncomes: {
      id_other_income: number;
      agency_other_income_id?: number | null;
      issue_date: string;
      concept: string;
      amount: number;
      currency: string;
      category_name?: string | null;
      operator_name?: string | null;
      booking_id: null;
      booking_agency_id?: null;
    }[];
    investments: {
      id_investment: number;
      agency_investment_id?: number | null;
      created_at: string;
      description: string;
      amount: number;
      currency: string;
      booking_id: number | null;
      booking_agency_id?: number | null;
    }[];
    investmentsUnlinked: {
      id_investment: number;
      agency_investment_id?: number | null;
      created_at: string;
      description: string;
      amount: number;
      currency: string;
      booking_id: number | null;
      booking_agency_id?: number | null;
    }[];
  };
};

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromYmd(value?: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const d = fromYmd(value) ?? new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-AR").format(value);
}

function formatMoney(value: number, currency: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${safe.toFixed(2)} ${currency}`;
  }
}

function formatName(first?: string | null, last?: string | null): string {
  const parts = [first, last].filter((item) => item && item.trim().length > 0);
  return parts.length > 0 ? parts.join(" ") : "Sin titular";
}

const slugify = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function DownloadIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

function MoneyLines({ data }: { data?: MoneyMap }) {
  const entries = Object.entries(data || {}).filter(
    ([, value]) => Number.isFinite(value) && Math.abs(value) > 0.0001,
  );

  if (entries.length === 0) {
    return <div className="text-xs text-slate-500">Sin datos</div>;
  }

  return (
    <div className="space-y-1 text-sm">
      {entries.map(([currency, value]) => (
        <div key={currency} className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {currency}
          </span>
          <span className="font-medium">{formatMoney(value, currency)}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({
  title,
  tone = "slate",
  children,
}: {
  title: string;
  tone?: StatTone;
  children: ReactNode;
}) {
  const glow = CARD_GLOW[tone];
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur transition-transform duration-300 hover:-translate-y-0.5">
      <div
        className={`pointer-events-none absolute -right-12 -top-12 size-28 rounded-full blur-2xl ${glow}`}
      />
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: StatTone;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/60 p-3 text-sm shadow-sm shadow-sky-950/10 backdrop-blur dark:bg-slate-900/50">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span
          className={`inline-flex size-2 rounded-full ${PILL_TONE[tone]}`}
        />
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: StatTone }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PILL_TONE[tone]}`}
    >
      {label}
    </span>
  );
}

function dueStatusTone(status?: string): StatTone {
  const normalized = (status || "").trim().toUpperCase();
  if (normalized === "PAGADA") return "emerald";
  if (normalized === "CANCELADA") return "slate";
  if (normalized === "VENCIDA" || normalized === "VENCIDO") return "rose";
  return "amber";
}

export default function OperatorInsightsPage() {
  const { token } = useAuth();
  const { operators } = useAgencyOperators(token);
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | "">("");
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [dateMode, setDateMode] = useState<DateMode>("creation");
  const [view, setView] = useState<InsightsView>("all");

  const now = useMemo(() => new Date(), []);
  const todayYmd = useMemo(() => toYmd(now), [now]);
  const [dayValue, setDayValue] = useState<string>(todayYmd);
  const [weekValue, setWeekValue] = useState<string>(todayYmd);
  const [monthValue, setMonthValue] = useState<string>(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [quarterYear, setQuarterYear] = useState<number>(now.getFullYear());
  const [quarter, setQuarter] = useState<number>(
    Math.floor(now.getMonth() / 3) + 1,
  );
  const [semesterYear, setSemesterYear] = useState<number>(now.getFullYear());
  const [semester, setSemester] = useState<number>(now.getMonth() < 6 ? 1 : 2);
  const [yearValue, setYearValue] = useState<number>(now.getFullYear());

  const [data, setData] = useState<OperatorInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<
    number | null
  >(null);
  const [downloadingInvestmentId, setDownloadingInvestmentId] = useState<
    number | null
  >(null);

  const operatorName = useMemo(() => {
    if (data?.operator?.name) return data.operator.name;
    if (typeof selectedOperatorId !== "number") return "";
    const found = operators.find((op) => op.id_operator === selectedOperatorId);
    return found?.name || "";
  }, [data?.operator?.name, operators, selectedOperatorId]);

  const operatorNumber = useMemo(() => {
    if (data?.operator?.agency_operator_id != null) {
      return data.operator.agency_operator_id;
    }
    if (typeof selectedOperatorId !== "number") return null;
    const found = operators.find((op) => op.id_operator === selectedOperatorId);
    return found?.agency_operator_id ?? selectedOperatorId;
  }, [data?.operator?.agency_operator_id, operators, selectedOperatorId]);

  useEffect(() => {
    if (selectedOperatorId) return;
    if (operators.length === 0) return;
    setSelectedOperatorId(operators[0].id_operator);
  }, [operators, selectedOperatorId]);

  const range = useMemo(() => {
    if (periodType === "day") {
      const day = fromYmd(dayValue) ?? now;
      const ymd = toYmd(day);
      return { from: ymd, to: ymd };
    }

    if (periodType === "week") {
      const base = fromYmd(weekValue) ?? now;
      const start = startOfWeek(base);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: toYmd(start), to: toYmd(end) };
    }

    if (periodType === "month") {
      const [y, m] = monthValue.split("-").map(Number);
      const start = new Date(y, (m || 1) - 1, 1);
      const end = new Date(y, m || 1, 0);
      return { from: toYmd(start), to: toYmd(end) };
    }

    if (periodType === "quarter") {
      const q = Math.min(Math.max(quarter, 1), 4);
      const start = new Date(quarterYear, (q - 1) * 3, 1);
      const end = new Date(quarterYear, q * 3, 0);
      return { from: toYmd(start), to: toYmd(end) };
    }

    if (periodType === "semester") {
      const s = Math.min(Math.max(semester, 1), 2);
      const start = new Date(semesterYear, (s - 1) * 6, 1);
      const end = new Date(semesterYear, s * 6, 0);
      return { from: toYmd(start), to: toYmd(end) };
    }

    const start = new Date(yearValue, 0, 1);
    const end = new Date(yearValue, 11, 31);
    return { from: toYmd(start), to: toYmd(end) };
  }, [
    periodType,
    dayValue,
    weekValue,
    monthValue,
    quarter,
    quarterYear,
    semester,
    semesterYear,
    yearValue,
    now,
  ]);

  const periodLabel = useMemo(() => {
    if (periodType === "day") {
      return `Dia ${formatDate(range.from)}`;
    }
    if (periodType === "week") {
      return `Semana ${formatDate(range.from)} - ${formatDate(range.to)}`;
    }
    if (periodType === "month") {
      return `Mes ${monthValue}`;
    }
    if (periodType === "quarter") {
      return `Trimestre Q${quarter} ${quarterYear}`;
    }
    if (periodType === "semester") {
      return `Semestre S${semester} ${semesterYear}`;
    }
    return `Ano ${yearValue}`;
  }, [
    periodType,
    range,
    monthValue,
    quarter,
    quarterYear,
    semester,
    semesterYear,
    yearValue,
  ]);

  const dateModeLabel = useMemo(
    () => (dateMode === "travel" ? "Viaje" : "Creacion reserva"),
    [dateMode],
  );

  const operatorTitle = operatorName || "Panel de operadores";
  const operatorMeta =
    typeof selectedOperatorId === "number" && operatorNumber != null
      ? `N° ${operatorNumber}`
      : "";

  const getReceiptDisplayNumber = useCallback(
    (item: { agency_receipt_id?: number | null; id_receipt: number }) => {
      if (item.agency_receipt_id != null) {
        return String(item.agency_receipt_id);
      }
      return String(item.id_receipt);
    },
    [],
  );

  const downloadReceiptPdf = useCallback(
    async (item: {
      id_receipt: number;
      agency_receipt_id?: number | null;
      issue_date: string;
    }) => {
      if (!token) {
        toast.error("Sesion no iniciada");
        return;
      }

      setDownloadingReceiptId(item.id_receipt);
      try {
        const res = await authFetch(
          `/api/receipts/${item.id_receipt}/pdf`,
          { headers: { Accept: "application/pdf" } },
          token,
        );
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const displayId = getReceiptDisplayNumber(item);
        downloadBlob(
          blob,
          `Recibo_${slugify(displayId)}_${item.issue_date || "sin_fecha"}.pdf`,
        );
        toast.success("Comprobante de recibo descargado.");
      } catch {
        toast.error("No se pudo descargar el recibo.");
      } finally {
        setDownloadingReceiptId((prev) =>
          prev === item.id_receipt ? null : prev,
        );
      }
    },
    [getReceiptDisplayNumber, token],
  );

  const downloadInvestmentPdf = useCallback(
    async (item: {
      id_investment: number;
      agency_investment_id?: number | null;
      created_at: string;
    }) => {
      if (!token) {
        toast.error("Sesion no iniciada");
        return;
      }

      setDownloadingInvestmentId(item.id_investment);
      try {
        const res = await authFetch(
          `/api/investments/${item.id_investment}/pdf`,
          { headers: { Accept: "application/pdf" } },
          token,
        );
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const displayId = String(
          item.agency_investment_id ?? item.id_investment,
        );
        downloadBlob(
          blob,
          `Pago_Operador_${slugify(displayId)}_${item.created_at || "sin_fecha"}.pdf`,
        );
        toast.success("Comprobante de pago descargado.");
      } catch {
        toast.error("No se pudo descargar el comprobante de pago.");
      } finally {
        setDownloadingInvestmentId((prev) =>
          prev === item.id_investment ? null : prev,
        );
      }
    },
    [token],
  );
  const sharedBookings = useMemo(() => {
    if (!data?.lists.bookings) return 0;
    return data.lists.bookings.filter((b) => b.shared_operators.length > 0)
      .length;
  }, [data]);

  const incomeMovements = useMemo(() => {
    if (!data) return [] as Array<{
      key: string;
      kind: "receipt" | "other_income";
      id_receipt?: number;
      agency_receipt_id?: number | null;
      id_other_income?: number;
      agency_other_income_id?: number | null;
      idLabel: string;
      issue_date: string;
      concept: string;
      amount: number;
      currency: string;
      booking_id: number | null;
      booking_agency_id?: number | null;
      category_name?: string | null;
    }>;

    const receipts = data.lists.receipts.map((item) => ({
      key: `receipt:${item.id_receipt}`,
      kind: "receipt" as const,
      id_receipt: item.id_receipt,
      agency_receipt_id: item.agency_receipt_id ?? null,
      idLabel: `Recibo N° ${getReceiptDisplayNumber(item)}`,
      issue_date: item.issue_date,
      concept: item.concept,
      amount: item.amount,
      currency: item.currency,
      booking_id: item.booking_id,
      booking_agency_id: item.booking_agency_id ?? null,
      category_name: null,
    }));

    const otherIncomes = (data.lists.otherIncomes || []).map((item) => ({
      key: `other_income:${item.id_other_income}`,
      kind: "other_income" as const,
      id_other_income: item.id_other_income,
      agency_other_income_id: item.agency_other_income_id ?? null,
      idLabel: `Ingreso N° ${
        item.agency_other_income_id ?? item.id_other_income
      }`,
      issue_date: item.issue_date,
      concept: item.concept,
      amount: item.amount,
      currency: item.currency,
      booking_id: null,
      booking_agency_id: null,
      category_name: item.category_name ?? null,
    }));

    return [...receipts, ...otherIncomes].sort((a, b) => {
      const aTime = Date.parse(a.issue_date);
      const bTime = Date.parse(b.issue_date);
      return bTime - aTime;
    });
  }, [data, getReceiptDisplayNumber]);

  const showIncomeCard =
    view === "all" || view === "incomes" || view === "cashflow";
  const showExpenseCard =
    view === "all" || view === "expenses" || view === "cashflow";
  const showNetCard = view === "all" || view === "cashflow";
  const showSalesCard =
    view === "all" || view === "clientDebt" || view === "operatorDebt";
  const showClientDebtCard = view === "all" || view === "clientDebt";
  const showOperatorDebtCard = view === "all" || view === "operatorDebt";
  const showSummary =
    showIncomeCard ||
    showExpenseCard ||
    showNetCard ||
    showSalesCard ||
    showClientDebtCard ||
    showOperatorDebtCard;

  const showClientDebtSection = view === "all" || view === "clientDebt";
  const showOperatorDebtSection = view === "all" || view === "operatorDebt";
  const showDueSection = view === "all" || view === "due";
  const showActivitySection = view === "all" || view === "activity";
  const showMovements =
    view === "all" ||
    view === "cashflow" ||
    view === "incomes" ||
    view === "expenses";
  const showIncomeMovements =
    view === "all" || view === "cashflow" || view === "incomes";
  const showExpenseMovements =
    view === "all" || view === "cashflow" || view === "expenses";
  const movementCols =
    showIncomeMovements && showExpenseMovements
      ? "md:grid-cols-2"
      : "md:grid-cols-1";

  const loadInsights = useCallback(async () => {
    if (!token) {
      toast.error("Sesion no iniciada");
      return;
    }
    if (!selectedOperatorId) {
      toast.error("Selecciona un operador");
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/operators/insights?operatorId=${selectedOperatorId}&from=${range.from}&to=${range.to}&dateMode=${dateMode}`,
        { cache: "no-store" },
        token,
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err?.error || "No se pudo cargar el panel");
      }
      const json = (await res.json()) as OperatorInsightsResponse;
      setData(json);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error inesperado";
      toast.error(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, selectedOperatorId, range, dateMode]);

  useEffect(() => {
    if (!selectedOperatorId) return;
    loadInsights();
  }, [selectedOperatorId, range, dateMode, loadInsights]);

  return (
    <ProtectedRoute>
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-500/10" />
        <div className="pointer-events-none absolute left-0 top-28 size-72 rounded-full bg-sky-200/20 blur-3xl dark:bg-sky-500/10" />
        <div className="relative space-y-6 text-sky-950 dark:text-white">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Operador
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight">
                    {operatorTitle}
                  </h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Movimientos, deuda y actividad por operador y periodo.
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="rounded-full border border-white/10 bg-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {periodLabel}
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {dateModeLabel}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {range.from} - {range.to}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {operatorMeta ? (
                  <span className="rounded-full border border-white/10 bg-white/20 px-3 py-1 font-semibold uppercase tracking-wide">
                    Operador {operatorMeta}
                  </span>
                ) : null}
                <span className="rounded-full border border-white/10 bg-white/20 px-3 py-1 font-semibold uppercase tracking-wide">
                  Rango activo
                </span>
                <span className="rounded-full border border-white/10 bg-white/20 px-3 py-1 font-semibold">
                  {range.from}
                </span>
                <span className="text-slate-400">-&gt;</span>
                <span className="rounded-full border border-white/10 bg-white/20 px-3 py-1 font-semibold">
                  {range.to}
                </span>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Resumen rapido
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <KpiCard
                  label="Servicios"
                  value={data ? formatNumber(data.counts.services) : "--"}
                  tone="sky"
                />
                <KpiCard
                  label="Reservas"
                  value={data ? formatNumber(data.counts.bookings) : "--"}
                  tone="emerald"
                />
                <KpiCard
                  label="Ingresos"
                  value={
                    data
                      ? formatNumber(
                          data.counts.receipts + data.counts.otherIncomes,
                        )
                      : "--"
                  }
                  tone="amber"
                />
                <KpiCard
                  label="Pagos"
                  value={data ? formatNumber(data.counts.investments) : "--"}
                  tone="rose"
                />
              </div>
              {data?.counts.investmentsUnlinked ? (
                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Pagos sin reserva:{" "}
                  {formatNumber(data.counts.investmentsUnlinked)}
                </div>
              ) : null}
            </div>
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadInsights();
            }}
            className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur"
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Operador
                    </label>
                    <select
                      value={selectedOperatorId}
                      onChange={(event) => {
                        const val = event.target.value;
                        setSelectedOperatorId(val ? Number(val) : "");
                      }}
                      className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                    >
                      {operators.length === 0 ? (
                        <option value="">Sin operadores</option>
                      ) : null}
                      {operators.map((op) => (
                        <option key={op.id_operator} value={op.id_operator}>
                          {op.name ||
                            `Operador ${op.agency_operator_id ?? op.id_operator}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Periodo
                    </label>
                    <div className="flex flex-wrap items-center gap-2 rounded-full border border-white/20 bg-white/80 p-1 text-xs font-semibold uppercase tracking-wide shadow-sm dark:bg-slate-900/60">
                      {PERIOD_OPTIONS.map((option) => {
                        const active = periodType === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setPeriodType(option.value)}
                            className={`rounded-full px-3 py-1 transition ${
                              active
                                ? "bg-sky-950 text-white shadow-sm dark:bg-white/10"
                                : "text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Base del rango
                  </label>
                  <div className="flex flex-wrap items-center gap-2 rounded-full border border-white/20 bg-white/80 p-1 text-xs font-semibold uppercase tracking-wide shadow-sm dark:bg-slate-900/60">
                    {DATE_MODE_OPTIONS.map((option) => {
                      const active = dateMode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDateMode(option.value)}
                          className={`rounded-full px-3 py-1 transition ${
                            active
                              ? "bg-sky-950 text-white shadow-sm dark:bg-white/10"
                              : "text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  {dateMode === "travel" ? (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Los pagos sin reserva se muestran aparte.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/60 p-4 shadow-sm dark:bg-slate-900/50">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Detalle del periodo
                  </div>
                  {periodType === "day" && (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Dia
                      </label>
                      <input
                        type="date"
                        value={dayValue}
                        onChange={(event) => setDayValue(event.target.value)}
                        className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                      />
                    </div>
                  )}

                  {periodType === "week" && (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Semana
                      </label>
                      <input
                        type="date"
                        value={weekValue}
                        onChange={(event) => setWeekValue(event.target.value)}
                        className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                      />
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Selecciona un dia de la semana a consultar.
                      </p>
                    </div>
                  )}
                  {periodType === "month" && (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Mes
                      </label>
                      <input
                        type="month"
                        value={monthValue}
                        onChange={(event) => setMonthValue(event.target.value)}
                        className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                      />
                    </div>
                  )}

                  {periodType === "quarter" && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Ano
                        </label>
                        <input
                          type="number"
                          min={2000}
                          max={2100}
                          value={quarterYear}
                          onChange={(event) =>
                            setQuarterYear(Number(event.target.value))
                          }
                          className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Trimestre
                        </label>
                        <select
                          value={quarter}
                          onChange={(event) =>
                            setQuarter(Number(event.target.value))
                          }
                          className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                        >
                          {[1, 2, 3, 4].map((q) => (
                            <option key={q} value={q}>
                              Q{q}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {periodType === "semester" && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Ano
                        </label>
                        <input
                          type="number"
                          min={2000}
                          max={2100}
                          value={semesterYear}
                          onChange={(event) =>
                            setSemesterYear(Number(event.target.value))
                          }
                          className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Semestre
                        </label>
                        <select
                          value={semester}
                          onChange={(event) =>
                            setSemester(Number(event.target.value))
                          }
                          className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                        >
                          {[1, 2].map((s) => (
                            <option key={s} value={s}>
                              S{s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {periodType === "year" && (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Ano
                      </label>
                      <input
                        type="number"
                        min={2000}
                        max={2100}
                        value={yearValue}
                        onChange={(event) =>
                          setYearValue(Number(event.target.value))
                        }
                        className="w-full rounded-2xl border border-white/20 bg-white/80 px-4 py-2 text-sm shadow-sm outline-none transition focus:border-sky-300 dark:bg-slate-900/60"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/60 p-4 shadow-sm dark:bg-slate-900/50">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Rango seleccionado ({dateModeLabel})
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-white/10 bg-white/20 px-3 py-1 text-slate-600 dark:text-slate-200">
                    {range.from}
                  </span>
                  <span className="text-slate-400">-&gt;</span>
                  <span className="rounded-full border border-white/10 bg-white/20 px-3 py-1 text-slate-600 dark:text-slate-200">
                    {range.to}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Se actualiza automaticamente al cambiar filtros.
                </p>
                <button
                  type="submit"
                  className="mt-4 w-full rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
                  disabled={loading}
                >
                  {loading ? "Cargando..." : "Actualizar"}
                </button>
              </div>
            </div>
          </form>

          {loading && (
            <div className="flex min-h-[20vh] items-center justify-center">
              <Spinner />
            </div>
          )}

          {!loading && data && (
            <>
              <section className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Visualizacion
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {VIEW_OPTIONS.map((option) => {
                    const active = view === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setView(option.value)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                          active
                            ? "border-sky-900 bg-sky-950 text-white dark:border-white/40 dark:bg-white/10"
                            : "border-white/10 bg-white/60 text-slate-600 hover:border-sky-200 hover:text-slate-900 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:text-white"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </section>
              {showSummary && (
                <section className="grid gap-4 md:grid-cols-3">
                  {showIncomeCard && (
                    <StatCard title="Ingresos" tone="emerald">
                      <MoneyLines data={data.totals.incomes} />
                    </StatCard>
                  )}
                  {showExpenseCard && (
                    <StatCard title="Egresos" tone="rose">
                      <MoneyLines data={data.totals.expenses} />
                    </StatCard>
                  )}
                  {showNetCard && (
                    <StatCard title="Neto" tone="sky">
                      <MoneyLines data={data.totals.net} />
                    </StatCard>
                  )}
                  {showSalesCard && (
                    <StatCard title="Ventas del operador" tone="amber">
                      <MoneyLines data={data.totals.sales} />
                    </StatCard>
                  )}
                  {showClientDebtCard && (
                    <StatCard title="Deuda pax" tone="amber">
                      <MoneyLines data={data.totals.clientDebt} />
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Servicios sin recibo:{" "}
                        {formatNumber(data.counts.debtServices)}
                      </div>
                    </StatCard>
                  )}
                  {showOperatorDebtCard && (
                    <StatCard title="Deuda al operador" tone="rose">
                      <MoneyLines data={data.totals.operatorDebt} />
                    </StatCard>
                  )}
                </section>
              )}

              {showClientDebtSection && (
                <section className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <span>Deuda pax por reserva</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={`${data.lists.bookings.length} reservas`}
                        tone="slate"
                      />
                      <StatusPill
                        label={`${data.counts.debtServices} servicios sin recibo`}
                        tone="amber"
                      />
                    </div>
                  </div>
                  <div className="mb-4 rounded-2xl border border-white/10 bg-white/60 p-4 shadow-sm dark:bg-slate-900/50">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Deuda pax (venta - cobrado)
                    </div>
                    <div className="mt-2">
                      <MoneyLines data={data.totals.clientDebt} />
                    </div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Servicios sin recibo:{" "}
                      {formatNumber(data.counts.debtServices)}
                    </div>
                  </div>
                  {data.lists.bookings.length === 0 ? (
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      No hay reservas con servicios del operador en el periodo.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {data.lists.bookings.map((booking) => {
                        const sharedCount = booking.shared_operators.length;
                        const sharedNames = booking.shared_operators
                          .map(
                            (op) =>
                              op.name ||
                              `Operador N° ${
                                op.agency_operator_id ?? op.id_operator
                              }`,
                          )
                          .join(", ");
                        const titularName = formatName(
                          booking.titular?.first_name,
                          booking.titular?.last_name,
                        );
                        return (
                          <div
                            key={booking.id_booking}
                            className="rounded-2xl border border-white/10 bg-white/60 p-4 text-slate-800 shadow-sm dark:bg-slate-900/60 dark:text-slate-100"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="space-y-1">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Reserva N°{" "}
                                  {booking.agency_booking_id ??
                                    booking.id_booking}
                                </div>
                                <div className="text-lg font-semibold">
                                  {booking.details || "Sin detalle"}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  Titular: {titularName}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  Viaje: {formatDate(booking.departure_date)} -{" "}
                                  {formatDate(booking.return_date)}
                                </div>
                                {sharedCount > 0 ? (
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    Compartida con: {sharedNames}
                                  </div>
                                ) : null}
                              </div>
                              <div className="min-w-[220px] text-right">
                                {sharedCount > 0 ? (
                                  <StatusPill
                                    label={`Compartida (${sharedCount + 1})`}
                                    tone="rose"
                                  />
                                ) : (
                                  <StatusPill
                                    label="Solo operador"
                                    tone="emerald"
                                  />
                                )}
                                <div className="mt-3 text-left">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Deuda pax
                                  </div>
                                  <div className="mt-2">
                                    <MoneyLines data={booking.debt} />
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    Venta + interes - cobrado
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 border-t border-white/10 pt-4">
                              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                <span>Servicios del operador sin recibo</span>
                                <StatusPill
                                  label={`${booking.unreceipted_services.length} items`}
                                  tone="amber"
                                />
                              </div>
                              {booking.unreceipted_services.length === 0 ? (
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                  Todos los servicios del operador tienen recibo.
                                </div>
                              ) : (
                                <div className="grid gap-3 md:grid-cols-2">
                                  {booking.unreceipted_services.map((svc) => (
                                    <div
                                      key={svc.id_service}
                                      className="rounded-2xl border border-white/10 bg-white/70 p-3 shadow-sm dark:bg-slate-900/50"
                                    >
                                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                        <span>
                                          Servicio N° 
                                          {svc.agency_service_id ??
                                            svc.id_service}
                                        </span>
                                        <StatusPill
                                          label={svc.currency}
                                          tone="amber"
                                        />
                                      </div>
                                      <div className="mt-1 font-medium">
                                        {svc.description}
                                      </div>
                                      <div className="mt-2 text-right text-sm font-semibold">
                                        {formatMoney(
                                          svc.sale_price,
                                          svc.currency,
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {dateMode === "travel"
                      ? "Filtrado por fecha de viaje del servicio."
                      : "Filtrado por fecha de creacion de la reserva."}
                  </p>
                </section>
              )}

              {showOperatorDebtSection && (
                <section className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <span>Deuda al operador por reserva</span>
                    <StatusPill
                      label={`${data.lists.bookings.length} reservas`}
                      tone="slate"
                    />
                  </div>
                  <div className="mb-4 rounded-2xl border border-white/10 bg-white/60 p-4 shadow-sm dark:bg-slate-900/50">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Deuda al operador (costo - pagos)
                    </div>
                    <div className="mt-2">
                      <MoneyLines data={data.totals.operatorDebt} />
                    </div>
                  </div>
                  {data.lists.bookings.length === 0 ? (
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      No hay reservas con servicios del operador en el periodo.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {data.lists.bookings.map((booking) => {
                        const sharedCount = booking.shared_operators.length;
                        const sharedNames = booking.shared_operators
                          .map(
                            (op) =>
                              op.name ||
                              `Operador N° ${
                                op.agency_operator_id ?? op.id_operator
                              }`,
                          )
                          .join(", ");
                        const titularName = formatName(
                          booking.titular?.first_name,
                          booking.titular?.last_name,
                        );
                        return (
                          <div
                            key={booking.id_booking}
                            className="rounded-2xl border border-white/10 bg-white/60 p-4 text-slate-800 shadow-sm dark:bg-slate-900/60 dark:text-slate-100"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="space-y-1">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Reserva N°{" "}
                                  {booking.agency_booking_id ??
                                    booking.id_booking}
                                </div>
                                <div className="text-lg font-semibold">
                                  {booking.details || "Sin detalle"}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  Titular: {titularName}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  Viaje: {formatDate(booking.departure_date)} -{" "}
                                  {formatDate(booking.return_date)}
                                </div>
                                {sharedCount > 0 ? (
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    Compartida con: {sharedNames}
                                  </div>
                                ) : null}
                              </div>
                              <div className="min-w-[220px] text-right">
                                {sharedCount > 0 ? (
                                  <StatusPill
                                    label={`Compartida (${sharedCount + 1})`}
                                    tone="rose"
                                  />
                                ) : (
                                  <StatusPill
                                    label="Solo operador"
                                    tone="emerald"
                                  />
                                )}
                                <div className="mt-3 text-left">
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Deuda operador
                                  </div>
                                  <div className="mt-2">
                                    <MoneyLines data={booking.operator_debt} />
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    Costo - pagos
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 md:grid-cols-2">
                              <div className="rounded-2xl border border-white/10 bg-white/70 p-3 shadow-sm dark:bg-slate-900/50">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Costo del operador
                                </div>
                                <div className="mt-2">
                                  <MoneyLines data={booking.operator_cost} />
                                </div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/70 p-3 shadow-sm dark:bg-slate-900/50">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Pagos al operador
                                </div>
                                <div className="mt-2">
                                  <MoneyLines data={booking.operator_payments} />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {dateMode === "travel"
                      ? "Filtrado por fecha de viaje del servicio."
                      : "Filtrado por fecha de creacion de la reserva."}
                  </p>
                </section>
              )}

              {showDueSection && (
                <section className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <span>Vencimientos de pago</span>
                    <StatusPill
                      label={`${data.lists.operatorDues.length} items`}
                      tone="slate"
                    />
                  </div>
                  {data.lists.operatorDues.length === 0 ? (
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      No hay vencimientos cargados en el periodo.
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {data.lists.operatorDues.map((due) => (
                        <div
                          key={due.id_due}
                          className="rounded-2xl border border-white/10 bg-white/60 p-3 text-slate-800 shadow-sm dark:bg-slate-900/60 dark:text-slate-100"
                        >
                          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <span>Vence {formatDate(due.due_date)}</span>
                            <StatusPill
                              label={due.status}
                              tone={dueStatusTone(due.status)}
                            />
                          </div>
                          <div className="mt-1 font-medium">
                            {due.concept ||
                              `Servicio N° ${
                                due.service_agency_id ?? due.service_id
                              }`}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span>
                              Reserva {due.booking_agency_id ?? due.booking_id} ·{" "}
                              Servicio {due.service_agency_id ?? due.service_id}
                            </span>
                            <span className="flex items-center gap-2">
                              <StatusPill label={due.currency} tone="sky" />
                              <span className="font-semibold">
                                {formatMoney(due.amount, due.currency)}
                              </span>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Filtrados por fecha de vencimiento del operador.
                  </p>
                </section>
              )}

              {showActivitySection && (
                <section className="grid gap-4 md:grid-cols-2">
                  <StatCard title="Actividad" tone="slate">
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>Servicios</span>
                        <span className="font-semibold">
                          {formatNumber(data.counts.services)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Reservas</span>
                        <span className="font-semibold">
                          {formatNumber(data.counts.bookings)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Reservas compartidas</span>
                        <span className="font-semibold">
                          {formatNumber(sharedBookings)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Recibos</span>
                        <span className="font-semibold">
                          {formatNumber(data.counts.receipts)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Ingresos extra</span>
                        <span className="font-semibold">
                          {formatNumber(data.counts.otherIncomes)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Pagos a operador</span>
                        <span className="font-semibold">
                          {formatNumber(data.counts.investments)}
                          {data.counts.investmentsUnlinked
                            ? ` (+${formatNumber(
                                data.counts.investmentsUnlinked,
                              )} sin reserva)`
                            : ""}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Vencimientos operador</span>
                        <span className="font-semibold">
                          {formatNumber(data.counts.operatorDues)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Servicios sin recibo</span>
                        <span className="font-semibold">
                          {formatNumber(data.counts.debtServices)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Servicios por reserva</span>
                        <span className="font-semibold">
                          {data.averages.servicesPerBooking.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </StatCard>

                  <StatCard title="Promedios" tone="slate">
                    <div className="space-y-4 text-sm">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Venta promedio por reserva
                        </div>
                        <div className="mt-2">
                          <MoneyLines data={data.averages.avgSalePerBooking} />
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Ingreso promedio por recibo
                        </div>
                        <div className="mt-2">
                          <MoneyLines data={data.averages.avgIncomePerReceipt} />
                        </div>
                      </div>
                    </div>
                  </StatCard>
                </section>
              )}

              {showMovements && (
                <section className={`grid gap-4 ${movementCols}`}>
                  {showIncomeMovements && (
                    <div className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur">
                      <div className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <span>Movimientos - Ingresos</span>
                        <StatusPill
                          label={`${incomeMovements.length} items`}
                          tone="slate"
                        />
                      </div>
                      {incomeMovements.length === 0 ? (
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          Sin ingresos en el periodo.
                        </div>
                      ) : (
                        <div className="space-y-3 text-sm">
                          {incomeMovements.map((item) => (
                            <div
                              key={item.key}
                              className="rounded-2xl border border-white/10 bg-white/60 p-3 text-slate-800 shadow-sm dark:bg-slate-900/60 dark:text-slate-100"
                            >
                              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                <span>{item.idLabel}</span>
                                <div className="flex items-center gap-2">
                                  {item.kind === "receipt" && item.id_receipt ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        downloadReceiptPdf({
                                          id_receipt: item.id_receipt as number,
                                          agency_receipt_id:
                                            item.agency_receipt_id ?? null,
                                          issue_date: item.issue_date,
                                        })
                                      }
                                      disabled={
                                        downloadingReceiptId === item.id_receipt
                                      }
                                      className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-900 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-sky-500/20 dark:text-sky-100"
                                      title="Descargar comprobante"
                                      aria-label="Descargar comprobante"
                                    >
                                      {downloadingReceiptId === item.id_receipt
                                        ? "..."
                                        : <DownloadIcon />}
                                    </button>
                                  ) : null}
                                  <span>{formatDate(item.issue_date)}</span>
                                </div>
                              </div>
                              <div className="mt-1 font-medium">
                                {item.concept}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                                <span>
                                  {item.booking_id
                                    ? `Reserva ${
                                        item.booking_agency_id ??
                                        item.booking_id
                                      }`
                                    : item.kind === "other_income"
                                      ? "Ingreso extra (sin reserva)"
                                      : "Sin reserva"}
                                </span>
                                <span className="flex items-center gap-2 text-[11px]">
                                  {item.kind === "other_income" &&
                                  item.category_name ? (
                                    <StatusPill
                                      label={item.category_name}
                                      tone="amber"
                                    />
                                  ) : null}
                                  <StatusPill
                                    label={item.currency}
                                    tone="sky"
                                  />
                                  <span className="font-semibold">
                                    {formatMoney(item.amount, item.currency)}
                                  </span>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {showExpenseMovements && (
                    <div className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur">
                      <div className="mb-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <span>Movimientos - Egresos</span>
                        <StatusPill
                          label={`${data.lists.investments.length} items`}
                          tone="slate"
                        />
                      </div>
                      {data.lists.investments.length === 0 ? (
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          Sin pagos asociados a reservas en el periodo.
                        </div>
                      ) : (
                        <div className="space-y-3 text-sm">
                          {data.lists.investments.map((item) => (
                            <div
                              key={item.id_investment}
                              className="rounded-2xl border border-white/10 bg-white/60 p-3 text-slate-800 shadow-sm dark:bg-slate-900/60 dark:text-slate-100"
                            >
                              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                <span>
                                  Pago N° 
                                  {item.agency_investment_id ??
                                    item.id_investment}
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => downloadInvestmentPdf(item)}
                                    disabled={
                                      downloadingInvestmentId ===
                                      item.id_investment
                                    }
                                    className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-900 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-rose-500/20 dark:text-rose-100"
                                    title="Descargar comprobante"
                                    aria-label="Descargar comprobante"
                                  >
                                    {downloadingInvestmentId ===
                                    item.id_investment
                                      ? "..."
                                      : <DownloadIcon />}
                                  </button>
                                  <span>{formatDate(item.created_at)}</span>
                                </div>
                              </div>
                              <div className="mt-1 font-medium">
                                {item.description}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                                <span>
                                  {item.booking_id
                                    ? `Reserva ${item.booking_id}`
                                    : "Sin reserva"}
                                </span>
                                <span className="flex items-center gap-2">
                                  <StatusPill
                                    label={item.currency}
                                    tone="rose"
                                  />
                                  <span className="font-semibold">
                                    {formatMoney(item.amount, item.currency)}
                                  </span>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {data.lists.investmentsUnlinked.length > 0 ? (
                        <div className="mt-4 border-t border-white/10 pt-4">
                          <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <span>Pagos sin reserva</span>
                            <StatusPill
                              label={`${data.counts.investmentsUnlinked} items`}
                              tone="slate"
                            />
                          </div>
                          <div className="mb-3">
                            <MoneyLines data={data.totals.expensesUnlinked} />
                          </div>
                          <div className="space-y-3 text-sm">
                            {data.lists.investmentsUnlinked.map((item) => (
                              <div
                                key={item.id_investment}
                                className="rounded-2xl border border-white/10 bg-white/60 p-3 text-slate-800 shadow-sm dark:bg-slate-900/60 dark:text-slate-100"
                              >
                                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                  <span>
                                    Pago N° 
                                    {item.agency_investment_id ??
                                      item.id_investment}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        downloadInvestmentPdf(item)
                                      }
                                      disabled={
                                        downloadingInvestmentId ===
                                        item.id_investment
                                      }
                                      className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-900 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-rose-500/20 dark:text-rose-100"
                                      title="Descargar comprobante"
                                      aria-label="Descargar comprobante"
                                    >
                                      {downloadingInvestmentId ===
                                      item.id_investment
                                        ? "..."
                                        : <DownloadIcon />}
                                    </button>
                                    <span>{formatDate(item.created_at)}</span>
                                  </div>
                                </div>
                                <div className="mt-1 font-medium">
                                  {item.description}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span>Sin reserva</span>
                                  <span className="flex items-center gap-2">
                                    <StatusPill
                                      label={item.currency}
                                      tone="rose"
                                    />
                                    <span className="font-semibold">
                                      {formatMoney(item.amount, item.currency)}
                                    </span>
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {dateMode === "travel"
                              ? "No aplican fecha de viaje ni se suman al neto."
                              : "Filtrados por fecha de pago y fuera del neto."}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </section>
              )}

            </>
          )}

          {!loading && !data && (
            <div className="rounded-3xl border border-white/10 bg-white/10 p-6 text-center text-sm text-slate-500 shadow-md shadow-sky-950/10 backdrop-blur dark:text-slate-400">
              Selecciona un operador para ver sus metricas.
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </ProtectedRoute>
  );
}
