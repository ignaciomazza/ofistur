"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/Spinner";
import { authFetch } from "@/utils/authFetch";
import type { ClientPayment } from "@/types";
import {
  formatDateOnlyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";
import { toast } from "react-toastify";

type DetailStatusFilter =
  | "ALL"
  | "ABIERTO"
  | "PENDIENTE"
  | "VENCIDA"
  | "PAGADA"
  | "CANCELADA";

type PersistedStatus = "PENDIENTE" | "PAGADA" | "CANCELADA";
type DerivedStatus = PersistedStatus | "VENCIDA";

type OperatorDueListItem = {
  id_due: number;
  agency_operator_due_id?: number | null;
  booking_id?: number | null;
  service_id?: number | null;
  due_date: string;
  concept?: string | null;
  status: string;
  derived_status?: string | null;
  is_overdue?: boolean;
  amount: number | string;
  currency: string;
  booking?: {
    id_booking: number;
    agency_booking_id?: number | null;
    details?: string | null;
    titular?: {
      first_name?: string | null;
      last_name?: string | null;
    } | null;
  } | null;
  service?: {
    id_service: number;
    agency_service_id?: number | null;
    description?: string | null;
    operator?: {
      id_operator: number;
      agency_operator_id?: number | null;
      name?: string | null;
    } | null;
  } | null;
};

type ClientPaymentsResponse = {
  items?: ClientPayment[];
  nextCursor?: number | null;
  error?: string;
};

type OperatorDuesResponse = {
  items?: OperatorDueListItem[];
  nextCursor?: number | null;
  error?: string;
};

type DetailFilters = {
  q: string;
  dueFrom: string;
  dueTo: string;
  currency: string;
  status: DetailStatusFilter;
};

type UnifiedBalanceRow = {
  source: "PAX" | "OPERADOR";
  id: number;
  agencyId: number | null;
  bookingId: number | null;
  bookingAgencyId: number | null;
  entityLabel: string;
  detailLabel: string;
  dueDate: string | null;
  dueMonth: string;
  amount: number;
  currency: string;
  status: PersistedStatus;
  derivedStatus: DerivedStatus;
  isOverdue: boolean;
};

const GLASS =
  "rounded-3xl border border-white/30 bg-white/10 p-4 shadow-lg shadow-sky-900/10 backdrop-blur dark:border-white/10 dark:bg-white/10";
const CHIP =
  "inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-xs shadow-sm shadow-sky-900/5";
const BTN =
  "inline-flex items-center justify-center rounded-3xl border border-sky-600/30 bg-sky-600/30 px-3 py-1.5 text-xs text-sky-950/80 shadow-sm shadow-sky-900/10 transition hover:bg-sky-600/40 hover:text-sky-950 dark:text-white disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "w-full rounded-2xl border border-white/30 bg-white/10 px-3 py-2 text-sm outline-none backdrop-blur dark:border-white/10 dark:bg-white/10";

const TAKE = 120;

function toAmountNumber(v: unknown): number {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function toPositiveInt(v: unknown): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function normalizeCurrency(v: unknown): string {
  return String(v || "ARS")
    .trim()
    .toUpperCase();
}

function normalizeStatus(v: unknown): PersistedStatus {
  const normalized = String(v || "")
    .trim()
    .toUpperCase();
  if (normalized === "PAGADA" || normalized === "PAGO") return "PAGADA";
  if (normalized === "CANCELADA" || normalized === "CANCELADO")
    return "CANCELADA";
  return "PENDIENTE";
}

function normalizeDerivedStatus(v: unknown): DerivedStatus {
  const normalized = String(v || "")
    .trim()
    .toUpperCase();
  if (normalized === "VENCIDA") return "VENCIDA";
  if (normalized === "PAGADA" || normalized === "PAGO") return "PAGADA";
  if (normalized === "CANCELADA" || normalized === "CANCELADO")
    return "CANCELADA";
  return "PENDIENTE";
}

function statusLabel(status: DerivedStatus): string {
  if (status === "VENCIDA") return "Vencida";
  if (status === "PAGADA") return "Pagada";
  if (status === "CANCELADA") return "Cancelada";
  return "Pendiente";
}

function statusTone(status: DerivedStatus): string {
  if (status === "PAGADA") {
    return "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/30 dark:text-emerald-100";
  }
  if (status === "VENCIDA") {
    return "border-red-300 bg-red-100 text-red-900 dark:border-red-800/40 dark:bg-red-900/30 dark:text-red-100";
  }
  if (status === "CANCELADA") {
    return "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-100";
  }
  return "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/30 dark:text-amber-100";
}

function formatMoney(amount: number, currency: string): string {
  const code = normalizeCurrency(currency);
  const safe = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${code} ${safe.toFixed(2)}`;
  }
}

function toDueMonth(dueDate: string | null): string {
  const key = toDateKeyInBuenosAiresLegacySafe(dueDate ?? null);
  if (!key || key.length < 7) return "sin-fecha";
  return key.slice(0, 7);
}

function formatMonth(monthKey: string): string {
  if (monthKey === "sin-fecha") return "Sin fecha";
  const [year, month] = monthKey.split("-");
  if (!year || !month) return monthKey;
  return `${month}/${year}`;
}

function matchesStatusFilter(
  row: UnifiedBalanceRow,
  status: DetailStatusFilter,
): boolean {
  if (status === "ALL") return true;
  if (status === "ABIERTO") {
    return row.derivedStatus === "PENDIENTE" || row.derivedStatus === "VENCIDA";
  }
  return row.derivedStatus === status;
}

function toStatusApiParam(status: DetailStatusFilter): string | null {
  if (status === "ALL") return null;
  if (status === "ABIERTO") return "PENDIENTE";
  return status;
}

function toEntityName(firstName?: string | null, lastName?: string | null): string {
  const full = `${lastName || ""} ${firstName || ""}`.trim();
  return full || "Sin nombre";
}

export default function DetailedBalancesPanel({
  token,
}: {
  token?: string | null;
}) {
  const [rows, setRows] = useState<UnifiedBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);

  const [q, setQ] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [currency, setCurrency] = useState("");
  const [status, setStatus] = useState<DetailStatusFilter>("ABIERTO");
  const [appliedFilters, setAppliedFilters] = useState<DetailFilters>({
    q: "",
    dueFrom: "",
    dueTo: "",
    currency: "",
    status: "ABIERTO",
  });

  const loadClientPayments = useCallback(
    async (filters: DetailFilters): Promise<ClientPayment[]> => {
      if (!token) return [];
      const out: ClientPayment[] = [];
      let cursor: number | null = null;

      for (let i = 0; i < 400; i += 1) {
        const qs = new URLSearchParams();
        qs.set("take", String(TAKE));
        if (cursor && cursor > 0) qs.set("cursor", String(cursor));
        if (filters.q.trim()) qs.set("q", filters.q.trim());
        if (filters.currency) qs.set("currency", filters.currency);
        if (filters.dueFrom) qs.set("dueFrom", filters.dueFrom);
        if (filters.dueTo) qs.set("dueTo", filters.dueTo);
        const statusApi = toStatusApiParam(filters.status);
        if (statusApi) qs.set("status", statusApi);

        const res = await authFetch(
          `/api/client-payments?context=balances&${qs.toString()}`,
          { cache: "no-store" },
          token,
        );
        const json = (await res.json().catch(() => null)) as ClientPaymentsResponse | null;
        if (!res.ok) {
          throw new Error(json?.error || "No se pudieron cargar saldos de pasajeros.");
        }

        const items = Array.isArray(json?.items) ? json.items : [];
        out.push(...items);
        const next =
          typeof json?.nextCursor === "number" && json.nextCursor > 0
            ? json.nextCursor
            : null;
        if (!next || items.length === 0) break;
        cursor = next;
      }

      return out;
    },
    [token],
  );

  const loadOperatorDues = useCallback(
    async (filters: DetailFilters): Promise<OperatorDueListItem[]> => {
      if (!token) return [];
      const out: OperatorDueListItem[] = [];
      let cursor: number | null = null;

      for (let i = 0; i < 400; i += 1) {
        const qs = new URLSearchParams();
        qs.set("scope", "all");
        qs.set("take", String(TAKE));
        if (cursor && cursor > 0) qs.set("cursor", String(cursor));
        if (filters.q.trim()) qs.set("q", filters.q.trim());
        if (filters.currency) qs.set("currency", filters.currency);
        if (filters.dueFrom) qs.set("dueFrom", filters.dueFrom);
        if (filters.dueTo) qs.set("dueTo", filters.dueTo);
        const statusApi = toStatusApiParam(filters.status);
        if (statusApi) qs.set("status", statusApi);

        const res = await authFetch(
          `/api/operator-dues?${qs.toString()}`,
          { cache: "no-store" },
          token,
        );
        const json = (await res.json().catch(() => null)) as OperatorDuesResponse | null;
        if (!res.ok) {
          throw new Error(json?.error || "No se pudieron cargar saldos de operadores.");
        }

        const items = Array.isArray(json?.items) ? json.items : [];
        out.push(...items);
        const next =
          typeof json?.nextCursor === "number" && json.nextCursor > 0
            ? json.nextCursor
            : null;
        if (!next || items.length === 0) break;
        cursor = next;
      }

      return out;
    },
    [token],
  );

  const buildRows = useCallback(
    (payments: ClientPayment[], dues: OperatorDueListItem[]): UnifiedBalanceRow[] => {
      const todayKey = todayDateKeyInBuenosAires();
      const paxRows: UnifiedBalanceRow[] = payments.map((payment) => {
        const dueKey = toDateKeyInBuenosAiresLegacySafe(payment.due_date ?? null);
        const status = normalizeStatus(payment.status);
        let derived = normalizeDerivedStatus(payment.derived_status ?? payment.status);
        if (derived === "PENDIENTE" && dueKey && dueKey < todayKey) {
          derived = "VENCIDA";
        }

        return {
          source: "PAX",
          id: payment.id_payment,
          agencyId: toPositiveInt(payment.agency_client_payment_id),
          bookingId: toPositiveInt(payment.booking_id),
          bookingAgencyId: toPositiveInt(payment.booking?.agency_booking_id),
          entityLabel: toEntityName(
            payment.client?.first_name,
            payment.client?.last_name,
          ),
          detailLabel:
            payment.service?.description?.trim() ||
            payment.booking?.details?.trim() ||
            "Cuota de pasajero",
          dueDate: dueKey,
          dueMonth: toDueMonth(dueKey),
          amount: toAmountNumber(payment.amount),
          currency: normalizeCurrency(payment.currency),
          status,
          derivedStatus: derived,
          isOverdue: derived === "VENCIDA",
        };
      });

      const operatorRows: UnifiedBalanceRow[] = dues.map((due) => {
        const dueKey = toDateKeyInBuenosAiresLegacySafe(due.due_date ?? null);
        const status = normalizeStatus(due.status);
        let derived = normalizeDerivedStatus(due.derived_status ?? due.status);
        if (derived === "PENDIENTE" && dueKey && dueKey < todayKey) {
          derived = "VENCIDA";
        }

        return {
          source: "OPERADOR",
          id: due.id_due,
          agencyId: toPositiveInt(due.agency_operator_due_id),
          bookingId: toPositiveInt(due.booking_id),
          bookingAgencyId: toPositiveInt(due.booking?.agency_booking_id),
          entityLabel: due.service?.operator?.name?.trim() || "Operador",
          detailLabel:
            due.concept?.trim() ||
            due.service?.description?.trim() ||
            due.booking?.details?.trim() ||
            "Saldo operador",
          dueDate: dueKey,
          dueMonth: toDueMonth(dueKey),
          amount: toAmountNumber(due.amount),
          currency: normalizeCurrency(due.currency),
          status,
          derivedStatus: derived,
          isOverdue: derived === "VENCIDA",
        };
      });

      return [...paxRows, ...operatorRows]
        .filter((row) => matchesStatusFilter(row, appliedFilters.status))
        .sort((a, b) => {
          const ak = a.dueDate || "9999-99-99";
          const bk = b.dueDate || "9999-99-99";
          if (ak !== bk) return ak.localeCompare(bk);
          if (a.source !== b.source) return a.source.localeCompare(b.source);
          return a.id - b.id;
        });
    },
    [appliedFilters.status],
  );

  const loadRows = useCallback(async () => {
    if (!token) {
      setRows([]);
      setInitialized(false);
      return;
    }

    setLoading(true);
    try {
      const [payments, dues] = await Promise.all([
        loadClientPayments(appliedFilters),
        loadOperatorDues(appliedFilters),
      ]);
      setRows(buildRows(payments, dues));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudieron cargar saldos con vencimiento.";
      toast.error(message);
      setRows([]);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [appliedFilters, buildRows, loadClientPayments, loadOperatorDues, token]);

  useEffect(() => {
    if (!token) {
      setRows([]);
      setInitialized(false);
      return;
    }
    void loadRows();
  }, [loadRows, token]);

  const summary = useMemo(() => {
    const totals = {
      pax: new Map<string, number>(),
      operators: new Map<string, number>(),
      all: new Map<string, number>(),
      paxCount: 0,
      operatorCount: 0,
    };
    for (const row of rows) {
      const bucket = row.source === "PAX" ? totals.pax : totals.operators;
      bucket.set(row.currency, (bucket.get(row.currency) ?? 0) + row.amount);
      totals.all.set(row.currency, (totals.all.get(row.currency) ?? 0) + row.amount);
      if (row.source === "PAX") totals.paxCount += 1;
      else totals.operatorCount += 1;
    }
    return totals;
  }, [rows]);

  const monthRows = useMemo(() => {
    const map = new Map<
      string,
      {
        month: string;
        pax: Map<string, number>;
        operators: Map<string, number>;
      }
    >();

    for (const row of rows) {
      const key = row.dueMonth;
      const current =
        map.get(key) ||
        ({
          month: key,
          pax: new Map<string, number>(),
          operators: new Map<string, number>(),
        } as const);
      const bucket = row.source === "PAX" ? current.pax : current.operators;
      bucket.set(row.currency, (bucket.get(row.currency) ?? 0) + row.amount);
      map.set(key, {
        month: current.month,
        pax: new Map(current.pax),
        operators: new Map(current.operators),
      });
    }

    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [rows]);

  const currencyOptions = useMemo(() => {
    const set = new Set<string>(["ARS", "USD"]);
    for (const row of rows) set.add(normalizeCurrency(row.currency));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const totalsLabel = (values: Map<string, number>): string => {
    const entries = Array.from(values.entries())
      .filter(([, amount]) => Number.isFinite(amount) && Math.abs(amount) > 0)
      .sort((a, b) => a[0].localeCompare(b[0], "es"));
    if (!entries.length) return "—";
    return entries.map(([cur, amount]) => formatMoney(amount, cur)).join(" y ");
  };

  const handleApplyFilters = () => {
    setAppliedFilters({
      q: q.trim(),
      dueFrom: dueFrom.trim(),
      dueTo: dueTo.trim(),
      currency: currency.trim().toUpperCase(),
      status,
    });
  };

  const handleResetFilters = () => {
    setQ("");
    setDueFrom("");
    setDueTo("");
    setCurrency("");
    setStatus("ABIERTO");
    setAppliedFilters({
      q: "",
      dueFrom: "",
      dueTo: "",
      currency: "",
      status: "ABIERTO",
    });
  };

  const downloadJson = async () => {
    if (exportingJson) return;
    setExportingJson(true);
    try {
      const payload = {
        generated_at: new Date().toISOString(),
        filters: appliedFilters,
        summary: {
          count: rows.length,
          passengers_count: summary.paxCount,
          operators_count: summary.operatorCount,
          totals: {
            all: Object.fromEntries(summary.all.entries()),
            passengers: Object.fromEntries(summary.pax.entries()),
            operators: Object.fromEntries(summary.operators.entries()),
          },
        },
        items: rows.map((row) => ({
          source: row.source,
          id: row.id,
          agency_id: row.agencyId,
          booking_id: row.bookingId,
          booking_agency_id: row.bookingAgencyId,
          entity: row.entityLabel,
          detail: row.detailLabel,
          due_date: row.dueDate,
          due_month: row.dueMonth,
          status: row.status,
          derived_status: row.derivedStatus,
          is_overdue: row.isOverdue,
          currency: row.currency,
          amount: Number(row.amount.toFixed(2)),
        })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `saldos_detallados_${todayDateKeyInBuenosAires()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo exportar el JSON de saldos.",
      );
    } finally {
      setExportingJson(false);
    }
  };

  return (
    <div className={GLASS}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-sky-950 dark:text-white">
            Saldos Con Vencimiento
          </h2>
          <p className="text-xs opacity-70">
            Unifica cuotas de pasajeros y deudas de operador con fecha y monto.
          </p>
        </div>
        <button
          type="button"
          className={BTN}
          onClick={downloadJson}
          disabled={exportingJson || rows.length === 0}
          title="Descargar datos en JSON"
        >
          {exportingJson ? "Exportando..." : "Exportar JSON"}
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-12">
        <div className="md:col-span-4">
          <label className="mb-1 block text-xs opacity-70">Buscar</label>
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className={INPUT}
            placeholder="Reserva, pax, operador o concepto..."
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs opacity-70">Estado</label>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as DetailStatusFilter)
            }
            className={INPUT}
          >
            <option value="ABIERTO">Abierto</option>
            <option value="ALL">Todos</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="VENCIDA">Vencida</option>
            <option value="PAGADA">Pagada</option>
            <option value="CANCELADA">Cancelada</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs opacity-70">Moneda</label>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className={INPUT}
          >
            <option value="">Todas</option>
            {currencyOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs opacity-70">Vence desde</label>
          <input
            type="date"
            value={dueFrom}
            onChange={(event) => setDueFrom(event.target.value)}
            className={INPUT}
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs opacity-70">Vence hasta</label>
          <input
            type="date"
            value={dueTo}
            onChange={(event) => setDueTo(event.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN}
          onClick={handleApplyFilters}
          disabled={loading}
        >
          {loading ? <Spinner /> : "Aplicar filtros"}
        </button>
        <button
          type="button"
          className={BTN}
          onClick={handleResetFilters}
          disabled={loading}
        >
          Limpiar filtros
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => void loadRows()}
          disabled={loading}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className={CHIP}>
          Pasajeros: {summary.paxCount} ({totalsLabel(summary.pax)})
        </span>
        <span className={CHIP}>
          Operadores: {summary.operatorCount} ({totalsLabel(summary.operators)})
        </span>
        <span className={CHIP}>
          Total: {rows.length} ({totalsLabel(summary.all)})
        </span>
      </div>

      <div className="mb-4 overflow-x-auto rounded-3xl border border-white/20">
        <table className="w-full text-xs">
          <thead className="bg-white/25 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-200">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-left font-medium">Reserva</th>
              <th className="px-3 py-2 text-left font-medium">Entidad</th>
              <th className="px-3 py-2 text-left font-medium">Detalle</th>
              <th className="px-3 py-2 text-left font-medium">Vencimiento</th>
              <th className="px-3 py-2 text-left font-medium">Mes</th>
              <th className="px-3 py-2 text-left font-medium">Estado</th>
              <th className="px-3 py-2 text-right font-medium">Monto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.source}-${row.id}`}
                className={`border-t border-white/15 ${index % 2 === 1 ? "bg-white/5 dark:bg-white/5" : ""}`}
              >
                <td className="px-3 py-2">
                  {row.source === "PAX" ? "Pasajero" : "Operador"}
                </td>
                <td className="px-3 py-2">
                  {row.bookingId ? (
                    <Link
                      href={`/bookings/services/${row.bookingId}`}
                      className="underline decoration-transparent hover:decoration-sky-600"
                      target="_blank"
                    >
                      {row.bookingAgencyId ?? row.bookingId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">{row.entityLabel}</td>
                <td className="max-w-[340px] px-3 py-2">{row.detailLabel}</td>
                <td className="px-3 py-2">
                  {row.dueDate ? formatDateOnlyInBuenosAires(row.dueDate) : "—"}
                </td>
                <td className="px-3 py-2">{formatMonth(row.dueMonth)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(row.derivedStatus)}`}
                  >
                    {statusLabel(row.derivedStatus)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {formatMoney(row.amount, row.currency)}
                </td>
              </tr>
            ))}

            {!loading && initialized && rows.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm opacity-70"
                >
                  No hay saldos con los filtros aplicados.
                </td>
              </tr>
            )}

            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center">
                  <Spinner />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {monthRows.length > 0 && (
        <div className="overflow-x-auto rounded-3xl border border-white/20">
          <table className="w-full text-xs">
            <thead className="bg-white/25 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Mes</th>
                <th className="px-3 py-2 text-left font-medium">Pasajeros</th>
                <th className="px-3 py-2 text-left font-medium">Operadores</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((month) => (
                <tr key={month.month} className="border-t border-white/15">
                  <td className="px-3 py-2">{formatMonth(month.month)}</td>
                  <td className="px-3 py-2">{totalsLabel(month.pax)}</td>
                  <td className="px-3 py-2">{totalsLabel(month.operators)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
