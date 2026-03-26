"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import ReceiptForm from "@/components/receipts/ReceiptForm";
import { useAuth } from "@/context/AuthContext";
import type { ClientPayment } from "@/types";
import type { ReceiptPayload, ServiceLite } from "@/types/receipts";
import { authFetch } from "@/utils/authFetch";
import { toast, ToastContainer } from "react-toastify";
import {
  formatDateInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";
import "react-toastify/dist/ReactToastify.css";

const GLASS =
  "rounded-3xl border border-white/20 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10";
const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/20 px-3 py-1 text-xs font-medium shadow-sm dark:bg-white/10";
const BTN =
  "inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium shadow-sm transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60";

const TAKE = 80;

type PaymentDisplayStatus = "PENDIENTE" | "VENCIDA" | "PAGADA" | "CANCELADA";
type StatusFilter = "ALL" | PaymentDisplayStatus;

type PaymentsListResponse = {
  items?: ClientPayment[];
  nextCursor?: number | null;
  error?: string;
};

type PaymentDetailResponse = ClientPayment & {
  audits?: Array<{
    id_audit: number;
    action: string;
    from_status?: string | null;
    to_status?: string | null;
    reason?: string | null;
    changed_at: string;
    changedBy?: {
      id_user: number;
      first_name?: string | null;
      last_name?: string | null;
    } | null;
    changed_by?: number | null;
  }>;
};

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseApiError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return typeof payload.error === "string" ? payload.error : null;
}

function toPositiveInt(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeCurrency(value: unknown): string {
  const c = String(value ?? "ARS").trim().toUpperCase();
  return c || "ARS";
}

function toDateKey(value?: string | Date | null): string | null {
  return toDateKeyInBuenosAiresLegacySafe(value ?? null);
}

function todayKey(): string {
  return todayDateKeyInBuenosAires();
}

function formatDate(value?: string | Date | null): string {
  const key = toDateKey(value);
  if (!key) return "-";
  return formatDateInBuenosAires(key);
}

function formatMoney(amount: number, currency: string): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: normalizeCurrency(currency),
      minimumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${normalizeCurrency(currency)} ${safe.toFixed(2)}`;
  }
}

function getDisplayStatus(payment: ClientPayment): PaymentDisplayStatus {
  const rawDerived = String(payment.derived_status || "")
    .trim()
    .toUpperCase();
  if (rawDerived === "VENCIDA") return "VENCIDA";
  if (rawDerived === "PAGADA") return "PAGADA";
  if (rawDerived === "CANCELADA") return "CANCELADA";

  const raw = String(payment.status || "")
    .trim()
    .toUpperCase();
  if (raw === "PAGADA") return "PAGADA";
  if (raw === "CANCELADA") return "CANCELADA";

  const due = toDateKey(payment.due_date);
  if (due && due < todayKey()) return "VENCIDA";
  return "PENDIENTE";
}

function isSettleEligible(payment: ClientPayment): boolean {
  const st = getDisplayStatus(payment);
  return st === "PENDIENTE" || st === "VENCIDA";
}

function validateSettleSelection(payments: ClientPayment[]): string | null {
  if (payments.length === 0) return "Selecciona al menos una cuota.";

  const first = payments[0];
  const bookingId = first.booking_id;
  const clientId = first.client_id;
  const currency = normalizeCurrency(first.currency);

  for (const payment of payments) {
    if (!isSettleEligible(payment)) {
      return "Solo podes liquidar cuotas pendientes o vencidas.";
    }
    if (payment.booking_id !== bookingId) {
      return "Todas las cuotas seleccionadas deben pertenecer a la misma reserva.";
    }
    if (payment.client_id !== clientId) {
      return "Todas las cuotas seleccionadas deben pertenecer al mismo pax.";
    }
    if (normalizeCurrency(payment.currency) !== currency) {
      return "Todas las cuotas seleccionadas deben tener la misma moneda.";
    }
  }

  return null;
}

function statusTone(status: PaymentDisplayStatus): string {
  if (status === "PAGADA") {
    return "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/30 dark:text-emerald-100";
  }
  if (status === "VENCIDA") {
    return "border-red-300 bg-red-100 text-red-900 dark:border-red-800/40 dark:bg-red-900/30 dark:text-red-100";
  }
  if (status === "CANCELADA") {
    return "border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-100";
  }
  return "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/30 dark:text-amber-100";
}

function paymentStatusLabel(status?: string | null): string {
  const raw = String(status || "")
    .trim()
    .toUpperCase();
  if (!raw) return "-";
  if (raw === "PENDIENTE" || raw === "PENDING") return "Pendiente";
  if (raw === "VENCIDA" || raw === "OVERDUE") return "Vencida";
  if (raw === "PAGADA" || raw === "PAID" || raw === "SETTLED") return "Pagada";
  if (raw === "CANCELADA" || raw === "CANCELLED" || raw === "CANCELED")
    return "Cancelada";
  return String(status || "-");
}

function paymentAuditActionLabel(action?: string | null): string {
  const raw = String(action || "")
    .trim()
    .toUpperCase();
  if (!raw) return "Actualización";
  if (
    raw === "STATUS_CHANGED" ||
    raw === "STATUS_CHANGE" ||
    raw === "CHANGE_STATUS" ||
    raw === "UPDATE_STATUS"
  ) {
    return "Cambio de estado";
  }
  if (raw === "CREATED" || raw === "CREATE") return "Creación";
  if (raw === "UPDATED" || raw === "UPDATE") return "Actualización";
  if (raw === "SETTLED" || raw === "SETTLE") return "Liquidación";
  if (raw === "REOPENED" || raw === "REOPEN") return "Reapertura";
  if (raw === "DELETED" || raw === "DELETE") return "Eliminación";
  return "Actualización";
}

function extractReceiptId(payload: unknown): number | null {
  if (!isRecord(payload)) return null;

  const direct =
    toPositiveInt(payload.id_receipt) ??
    toPositiveInt(payload.id) ??
    toPositiveInt(payload.receiptId);
  if (direct) return direct;

  const receipt = isRecord(payload.receipt) ? payload.receipt : null;
  if (receipt) {
    const nested =
      toPositiveInt(receipt.id_receipt) ??
      toPositiveInt(receipt.id) ??
      toPositiveInt(receipt.receiptId);
    if (nested) return nested;
  }

  const data = isRecord(payload.data) ? payload.data : null;
  if (data) {
    const fromData =
      toPositiveInt(data.id_receipt) ??
      toPositiveInt(data.id) ??
      toPositiveInt(data.receiptId);
    if (fromData) return fromData;
  }

  return null;
}

function ymdToday(): string {
  return todayDateKeyInBuenosAires();
}

function useDebounced<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}

function Modal({ open, onClose, title, wide = false, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        className="absolute inset-0 size-full bg-black/20 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Cerrar modal"
      />
      <div
        className={`${GLASS} absolute left-1/2 top-1/2 max-h-[90vh] ${
          wide ? "w-[min(96vw,1140px)]" : "w-[min(95vw,760px)]"
        } -translate-x-1/2 -translate-y-1/2 overflow-auto p-5`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className={BTN}
            aria-label="Cerrar"
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function PaymentPlansPage() {
  const { token } = useAuth() as {
    token?: string | null;
  };

  const [rows, setRows] = useState<ClientPayment[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [currency, setCurrency] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);

  const [settleOpen, setSettleOpen] = useState(false);
  const [settlePayments, setSettlePayments] = useState<ClientPayment[]>([]);
  const [receiptFormVisible, setReceiptFormVisible] = useState(true);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPayment, setHistoryPayment] = useState<PaymentDetailResponse | null>(
    null,
  );

  const debouncedQ = useDebounced(q, 350);

  const buildQS = useCallback(
    (cursor?: number | null) => {
      const params = new URLSearchParams();
      params.set("take", String(TAKE));
      if (cursor && cursor > 0) params.set("cursor", String(cursor));
      if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
      if (status !== "ALL") params.set("status", status);
      if (currency.trim()) params.set("currency", currency.trim().toUpperCase());
      if (dueFrom) params.set("dueFrom", dueFrom);
      if (dueTo) params.set("dueTo", dueTo);
      return params;
    },
    [currency, debouncedQ, dueFrom, dueTo, status],
  );

  const fetchReset = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    try {
      const res = await authFetch(
        `/api/client-payments?${buildQS().toString()}`,
        { cache: "no-store" },
        token,
      );
      const json = (await res.json().catch(() => null)) as PaymentsListResponse | null;

      if (!res.ok) {
        throw new Error(parseApiError(json) || "No se pudieron cargar las cuotas.");
      }

      const items = Array.isArray(json?.items) ? json.items : [];
      setRows(items);
      setNextCursor(
        typeof json?.nextCursor === "number" && json.nextCursor > 0
          ? json.nextCursor
          : null,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudieron cargar las cuotas.";
      toast.error(message);
      setRows([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [buildQS, token]);

  const fetchMore = useCallback(async () => {
    if (!token || !nextCursor || loading) return;

    setLoading(true);
    try {
      const res = await authFetch(
        `/api/client-payments?${buildQS(nextCursor).toString()}`,
        { cache: "no-store" },
        token,
      );
      const json = (await res.json().catch(() => null)) as PaymentsListResponse | null;

      if (!res.ok) {
        throw new Error(parseApiError(json) || "No se pudieron cargar mas cuotas.");
      }

      const items = Array.isArray(json?.items) ? json.items : [];
      setRows((prev) => [...prev, ...items]);
      setNextCursor(
        typeof json?.nextCursor === "number" && json.nextCursor > 0
          ? json.nextCursor
          : null,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudieron cargar mas cuotas.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [buildQS, loading, nextCursor, token]);

  useEffect(() => {
    if (!token) return;
    setSelectedIds([]);
    void fetchReset();
  }, [fetchReset, token]);

  useEffect(() => {
    const available = new Set(rows.map((r) => r.id_payment));
    setSelectedIds((prev) => prev.filter((id) => available.has(id)));
  }, [rows]);

  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id_payment, row])),
    [rows],
  );

  const selectedRows = useMemo(
    () =>
      selectedIds
        .map((id) => rowsById.get(id))
        .filter((row): row is ClientPayment => Boolean(row)),
    [rowsById, selectedIds],
  );

  const selectedError = useMemo(
    () => validateSettleSelection(selectedRows),
    [selectedRows],
  );

  const selectedTotal = useMemo(
    () => selectedRows.reduce((acc, row) => acc + toNumber(row.amount), 0),
    [selectedRows],
  );

  const selectedCurrency = useMemo(
    () => normalizeCurrency(selectedRows[0]?.currency),
    [selectedRows],
  );

  const summary = useMemo(() => {
    const totalsByCurrency = new Map<string, number>();
    let pending = 0;
    let overdue = 0;
    let paid = 0;
    let cancelled = 0;

    for (const row of rows) {
      const amount = toNumber(row.amount);
      const curr = normalizeCurrency(row.currency);
      totalsByCurrency.set(curr, (totalsByCurrency.get(curr) ?? 0) + amount);

      const st = getDisplayStatus(row);
      if (st === "PAGADA") paid += 1;
      else if (st === "CANCELADA") cancelled += 1;
      else if (st === "VENCIDA") overdue += 1;
      else pending += 1;
    }

    return {
      pending,
      overdue,
      paid,
      cancelled,
      totalsByCurrency: Array.from(totalsByCurrency.entries()),
    };
  }, [rows]);

  const currencyOptions = useMemo(() => {
    const all = new Set<string>();
    for (const row of rows) all.add(normalizeCurrency(row.currency));
    return Array.from(all).sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const canSelectWithCurrent = useCallback(
    (row: ClientPayment): boolean => {
      if (!isSettleEligible(row)) return false;
      const first = selectedRows[0];
      if (!first) return true;
      return (
        row.booking_id === first.booking_id &&
        row.client_id === first.client_id &&
        normalizeCurrency(row.currency) === normalizeCurrency(first.currency)
      );
    },
    [selectedRows],
  );

  const toggleSelected = (row: ClientPayment) => {
    const already = selectedIds.includes(row.id_payment);
    if (already) {
      setSelectedIds((prev) => prev.filter((id) => id !== row.id_payment));
      return;
    }

    if (!canSelectWithCurrent(row)) {
      toast.error(
        "Solo podes agrupar cuotas del mismo pax, reserva y moneda en un mismo recibo.",
      );
      return;
    }

    setSelectedIds((prev) => [...prev, row.id_payment]);
  };

  const startSettle = (payments: ClientPayment[]) => {
    const ordered = [...payments].sort((a, b) => {
      const ak = toDateKey(a.due_date) || "";
      const bk = toDateKey(b.due_date) || "";
      return ak.localeCompare(bk);
    });

    const err = validateSettleSelection(ordered);
    if (err) {
      toast.error(err);
      return;
    }

    setSettlePayments(ordered);
    setReceiptFormVisible(true);
    setSettleOpen(true);
  };

  const closeSettleModal = () => {
    setSettleOpen(false);
    setSettlePayments([]);
    setReceiptFormVisible(true);
  };

  const loadServicesForBooking = useCallback(
    async (bookingId: number): Promise<ServiceLite[]> => {
      if (!token || !Number.isFinite(bookingId) || bookingId <= 0) return [];

      const parseServices = (payload: unknown): ServiceLite[] => {
        const source = isRecord(payload)
          ? Array.isArray(payload.services)
            ? payload.services
            : Array.isArray(payload.items)
              ? payload.items
              : Array.isArray(payload.results)
                ? payload.results
                : []
          : Array.isArray(payload)
            ? payload
            : [];

        if (!Array.isArray(source)) return [];

        const out: ServiceLite[] = [];
        for (const raw of source) {
          if (!isRecord(raw)) continue;

          const id = toPositiveInt(raw.id_service) ?? toPositiveInt(raw.id);
          if (!id) continue;

          const agencyServiceId = toPositiveInt(raw.agency_service_id);
          const description =
            typeof raw.description === "string"
              ? raw.description
              : typeof raw.type === "string"
                ? raw.type
                : `Servicio ${id}`;

          out.push({
            id_service: id,
            agency_service_id: agencyServiceId ?? undefined,
            description,
            currency: normalizeCurrency(raw.currency ?? raw.sale_currency),
            sale_price: toNumber(raw.sale_price) || undefined,
            card_interest: toNumber(raw.card_interest) || undefined,
            taxableCardInterest: toNumber(raw.taxableCardInterest) || undefined,
            vatOnCardInterest: toNumber(raw.vatOnCardInterest) || undefined,
            type: typeof raw.type === "string" ? raw.type : undefined,
            destination:
              typeof raw.destination === "string"
                ? raw.destination
                : typeof raw.destino === "string"
                  ? raw.destino
                  : undefined,
            departure_date:
              typeof raw.departure_date === "string" ? raw.departure_date : null,
            return_date:
              typeof raw.return_date === "string" ? raw.return_date : null,
          });
        }

        return out;
      };

      const endpoints = [
        `/api/services?bookingId=${bookingId}`,
        `/api/bookings/${bookingId}/services`,
        `/api/bookings/${bookingId}?include=services`,
      ];

      for (const endpoint of endpoints) {
        try {
          const res = await authFetch(endpoint, { cache: "no-store" }, token);
          if (!res.ok) continue;
          const json = (await res.json().catch(() => null)) as unknown;
          const mapped = parseServices(json);
          if (mapped.length > 0) return mapped;
        } catch {
          // try next endpoint
        }
      }

      return [];
    },
    [token],
  );

  const handleReceiptSubmit = useCallback(
    async (payload: ReceiptPayload) => {
      if (!token) throw new Error("Sesion expirada.");

      const currentSelection = [...settlePayments];
      const selectionError = validateSettleSelection(currentSelection);
      if (selectionError) throw new Error(selectionError);

      const paymentIds = currentSelection.map((payment) => payment.id_payment);

      const receiptRes = await authFetch(
        "/api/receipts",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token,
      );

      const receiptJson = (await receiptRes.json().catch(() => null)) as unknown;
      if (!receiptRes.ok) {
        throw new Error(
          parseApiError(receiptJson) || "No se pudo crear el recibo para liquidar cuotas.",
        );
      }

      const receiptId = extractReceiptId(receiptJson);
      if (!receiptId) {
        throw new Error(
          "Se creo el recibo, pero no se pudo detectar su ID para cerrar las cuotas.",
        );
      }

      const settleRes = await authFetch(
        "/api/client-payments/settle",
        {
          method: "POST",
          body: JSON.stringify({
            paymentIds,
            receiptId,
            reason: "Pago registrado desde /finance/payment-plans",
          }),
        },
        token,
      );

      const settleJson = (await settleRes.json().catch(() => null)) as unknown;
      if (!settleRes.ok) {
        const backend = parseApiError(settleJson);
        throw new Error(
          backend ||
            `El recibo #${receiptId} se creo, pero no se pudieron liquidar las cuotas seleccionadas.`,
        );
      }

      toast.success(
        paymentIds.length > 1
          ? "Pago registrado. Se liquidaron las cuotas seleccionadas."
          : "Pago registrado. La cuota fue liquidada.",
      );

      closeSettleModal();
      setSelectedIds((prev) => prev.filter((id) => !paymentIds.includes(id)));
      void fetchReset();

      return receiptId;
    },
    [fetchReset, settlePayments, token],
  );

  const settleBookingId = settlePayments[0]?.booking_id;
  const settleBookingDisplayId =
    toPositiveInt(settlePayments[0]?.booking?.agency_booking_id) ??
    settleBookingId;
  const settleClientId = settlePayments[0]?.client_id;
  const settleCurrency = normalizeCurrency(settlePayments[0]?.currency);
  const settleServiceIds = useMemo(
    () =>
      Array.from(
        new Set(
          settlePayments
            .map((payment) => toPositiveInt(payment.service_id))
            .filter((value): value is number => value !== null),
        ),
      ),
    [settlePayments],
  );
  const settleTotal = useMemo(
    () => settlePayments.reduce((acc, payment) => acc + toNumber(payment.amount), 0),
    [settlePayments],
  );
  const settleConcept = useMemo(() => {
    if (settlePayments.length === 1) {
      const one = settlePayments[0];
      const num = one.agency_client_payment_id ?? one.id_payment;
      return `Pago cuota N ${num}`;
    }
    const labels = settlePayments
      .slice(0, 4)
      .map((payment) => payment.agency_client_payment_id ?? payment.id_payment)
      .join(", ");
    const extra = settlePayments.length > 4 ? ", ..." : "";
    return `Pago de ${settlePayments.length} cuotas (${labels}${extra})`;
  }, [settlePayments]);

  const mutateStatus = async (
    payment: ClientPayment,
    nextStatus: "CANCELADA" | "PENDIENTE",
  ) => {
    if (!token) {
      toast.error("Sesion expirada.");
      return;
    }

    const defaultReason =
      nextStatus === "CANCELADA"
        ? "Cancelacion manual de cuota"
        : "Reapertura manual de cuota";

    const answer = window.prompt(
      nextStatus === "CANCELADA"
        ? "Motivo de cancelacion de la cuota:"
        : "Motivo de reapertura de la cuota:",
      defaultReason,
    );

    if (answer === null) return;
    const reason = answer.trim() || defaultReason;

    setStatusBusyId(payment.id_payment);
    try {
      const res = await authFetch(
        `/api/client-payments/${payment.id_payment}`,
        {
          method: "PUT",
          body: JSON.stringify({
            status: nextStatus,
            reason,
          }),
        },
        token,
      );

      const json = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        throw new Error(parseApiError(json) || "No se pudo actualizar la cuota.");
      }

      toast.success(
        nextStatus === "CANCELADA"
          ? "Cuota cancelada correctamente."
          : "Cuota reabierta correctamente.",
      );
      void fetchReset();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo actualizar la cuota.";
      toast.error(message);
    } finally {
      setStatusBusyId(null);
    }
  };

  const openHistory = async (idPayment: number) => {
    if (!token) {
      toast.error("Sesion expirada.");
      return;
    }

    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryPayment(null);

    try {
      const res = await authFetch(
        `/api/client-payments/${idPayment}`,
        { cache: "no-store" },
        token,
      );
      const json = (await res.json().catch(() => null)) as unknown;

      if (!res.ok) {
        throw new Error(parseApiError(json) || "No se pudo cargar el historial.");
      }

      setHistoryPayment(json as PaymentDetailResponse);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo cargar el historial.";
      toast.error(message);
      setHistoryOpen(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <section className="space-y-4 text-sky-950 dark:text-white">
        <header className={GLASS}>
          <h1 className="text-xl font-semibold">Planes de pago de clientes</h1>
          <p className="mt-1 text-sm opacity-75">
            Gestion de cuotas, vencimientos y cobros manuales vinculados a reservas y
            recibos.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className={CHIP}>Pendientes: {summary.pending}</span>
            <span className={CHIP}>Vencidas: {summary.overdue}</span>
            <span className={CHIP}>Pagadas: {summary.paid}</span>
            <span className={CHIP}>Canceladas: {summary.cancelled}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.totalsByCurrency.map(([curr, total]) => (
              <span key={curr} className={CHIP}>
                {curr}: {formatMoney(total, curr)}
              </span>
            ))}
          </div>
        </header>

        <div className={`${GLASS} space-y-3`}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
            <label className="flex flex-col gap-1 text-xs">
              Buscar
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Pax, reserva, cuota"
                className="rounded-2xl border border-white/30 bg-white/30 px-3 py-2 text-sm outline-none dark:bg-white/5"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              Estado
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                className="rounded-2xl border border-white/30 bg-white/30 px-3 py-2 text-sm outline-none dark:bg-white/5"
              >
                <option value="ALL">Todos</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="VENCIDA">Vencida</option>
                <option value="PAGADA">Pagada</option>
                <option value="CANCELADA">Cancelada</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              Moneda
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="rounded-2xl border border-white/30 bg-white/30 px-3 py-2 text-sm outline-none dark:bg-white/5"
              >
                <option value="">Todas</option>
                {currencyOptions.map((curr) => (
                  <option key={curr} value={curr}>
                    {curr}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              Vence desde
              <input
                type="date"
                value={dueFrom}
                onChange={(e) => setDueFrom(e.target.value)}
                className="rounded-2xl border border-white/30 bg-white/30 px-3 py-2 text-sm outline-none dark:bg-white/5"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              Vence hasta
              <input
                type="date"
                value={dueTo}
                onChange={(e) => setDueTo(e.target.value)}
                className="rounded-2xl border border-white/30 bg-white/30 px-3 py-2 text-sm outline-none dark:bg-white/5"
              />
            </label>

            <div className="flex items-end gap-2">
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  setQ("");
                  setStatus("ALL");
                  setCurrency("");
                  setDueFrom("");
                  setDueTo("");
                }}
              >
                Limpiar
              </button>
              <button type="button" className={BTN} onClick={() => void fetchReset()}>
                Refrescar
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-white/10 p-2">
            <span className={CHIP}>Seleccionadas: {selectedRows.length}</span>
            {selectedRows.length > 0 && (
              <span className={CHIP}>
                Total: {formatMoney(selectedTotal, selectedCurrency)}
              </span>
            )}
            <button
              type="button"
              className={`${BTN} ml-auto`}
              disabled={selectedRows.length === 0 || !!selectedError}
              onClick={() => startSettle(selectedRows)}
              title={selectedError || "Registrar pago"}
            >
              Registrar pago
            </button>
            <button
              type="button"
              className={BTN}
              disabled={selectedRows.length === 0}
              onClick={() => setSelectedIds([])}
            >
              Limpiar seleccion
            </button>
          </div>
        </div>

        <div className={GLASS}>
          {!initialized && loading ? (
            <div className="flex h-56 items-center justify-center">
              <Spinner />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-white/15 bg-white/10 p-8 text-center text-sm opacity-75">
              No hay cuotas para los filtros aplicados.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl border border-white/15">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead className="bg-white/20 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="p-3 text-left">Sel</th>
                      <th className="p-3 text-left">Cuota</th>
                      <th className="p-3 text-left">Pax</th>
                      <th className="p-3 text-left">Reserva</th>
                      <th className="p-3 text-left">Servicio</th>
                      <th className="p-3 text-left">Vence</th>
                      <th className="p-3 text-left">Monto</th>
                      <th className="p-3 text-left">Estado</th>
                      <th className="p-3 text-left">Recibo</th>
                      <th className="p-3 text-left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const displayStatus = getDisplayStatus(row);
                      const selected = selectedIds.includes(row.id_payment);
                      const canSelect = canSelectWithCurrent(row);
                      const paymentNumber =
                        row.agency_client_payment_id ?? row.id_payment;

                      const paxName = row.client
                        ? `${row.client.first_name || ""} ${row.client.last_name || ""}`.trim() ||
                          `Pax ${row.client_id}`
                        : `Pax ${row.client_id}`;

                      const paxNumber = row.client?.agency_client_id ?? row.client_id;
                      const bookingNumber =
                        row.booking?.agency_booking_id ?? row.booking_id;

                      const receiptLabel =
                        row.receipt?.receipt_number ||
                        (row.receipt_id ? `#${row.receipt_id}` : "-");

                      const rowBusy = statusBusyId === row.id_payment;

                      return (
                        <tr key={row.id_payment} className="border-t border-white/10">
                          <td className="p-3 align-top">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleSelected(row)}
                              disabled={!selected && !canSelect}
                              aria-label={`Seleccionar cuota ${paymentNumber}`}
                              className="mt-1"
                            />
                          </td>

                          <td className="p-3 align-top">
                            <p className="font-medium">N {paymentNumber}</p>
                            <p className="text-xs opacity-70">
                              Creada: {formatDate(row.created_at)}
                            </p>
                          </td>

                          <td className="p-3 align-top">
                            <p>{paxName}</p>
                            <p className="text-xs opacity-70">N {paxNumber}</p>
                          </td>

                          <td className="p-3 align-top">
                            <p>N {bookingNumber}</p>
                            {row.booking?.details ? (
                              <p className="max-w-[240px] truncate text-xs opacity-70">
                                {row.booking.details}
                              </p>
                            ) : null}
                            <Link
                              href={`/bookings/services/${row.booking_id}`}
                              className="mt-1 inline-block text-xs underline opacity-80"
                            >
                              Ver reserva
                            </Link>
                          </td>

                          <td className="p-3 align-top">
                            {row.service ? (
                              <>
                                <p>
                                  {row.service.description || row.service.type || "Servicio"}
                                </p>
                                <p className="text-xs opacity-70">
                                  N {row.service.agency_service_id ?? row.service.id_service}
                                </p>
                              </>
                            ) : (
                              <p className="text-xs opacity-70">General</p>
                            )}
                          </td>

                          <td className="p-3 align-top">{formatDate(row.due_date)}</td>

                          <td className="p-3 align-top">
                            {formatMoney(toNumber(row.amount), normalizeCurrency(row.currency))}
                          </td>

                          <td className="p-3 align-top">
                            <span
                              className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${statusTone(displayStatus)}`}
                            >
                              {displayStatus === "PENDIENTE"
                                ? "Pendiente"
                                : displayStatus === "VENCIDA"
                                  ? "Vencida"
                                  : displayStatus === "PAGADA"
                                    ? "Pagada"
                                    : "Cancelada"}
                            </span>
                          </td>

                          <td className="p-3 align-top">
                            {row.receipt_id ? (
                              <Link
                                href={`/receipts?q=${encodeURIComponent(receiptLabel)}`}
                                className="text-xs underline"
                              >
                                {receiptLabel}
                              </Link>
                            ) : (
                              <span className="text-xs opacity-70">-</span>
                            )}
                          </td>

                          <td className="p-3 align-top">
                            <div className="flex flex-wrap gap-1">
                              {isSettleEligible(row) && (
                                <button
                                  type="button"
                                  className={BTN}
                                  onClick={() => startSettle([row])}
                                >
                                  Pagar
                                </button>
                              )}

                              {(displayStatus === "PENDIENTE" ||
                                displayStatus === "VENCIDA") && (
                                <button
                                  type="button"
                                  className={BTN}
                                  disabled={rowBusy}
                                  onClick={() => void mutateStatus(row, "CANCELADA")}
                                >
                                  {rowBusy ? "..." : "Cancelar"}
                                </button>
                              )}

                              {displayStatus === "CANCELADA" && (
                                <button
                                  type="button"
                                  className={BTN}
                                  disabled={rowBusy}
                                  onClick={() => void mutateStatus(row, "PENDIENTE")}
                                >
                                  {rowBusy ? "..." : "Reabrir"}
                                </button>
                              )}

                              <button
                                type="button"
                                className={BTN}
                                onClick={() => void openHistory(row.id_payment)}
                              >
                                Historial
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex justify-center">
                {nextCursor ? (
                  <button
                    type="button"
                    className={BTN}
                    disabled={loading}
                    onClick={() => void fetchMore()}
                  >
                    {loading ? "Cargando..." : "Cargar mas"}
                  </button>
                ) : (
                  <span className="text-xs opacity-70">No hay mas resultados.</span>
                )}
              </div>
            </>
          )}
        </div>

        <Modal
          open={settleOpen}
          onClose={closeSettleModal}
          title="Registrar pago y generar recibo"
          wide
        >
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 text-sm md:grid-cols-3">
            <div>
              <p className="text-xs opacity-70">Cuotas</p>
              <p className="font-medium">{settlePayments.length}</p>
            </div>
            <div>
              <p className="text-xs opacity-70">Total</p>
              <p className="font-medium">
                {formatMoney(settleTotal, settleCurrency || "ARS")}
              </p>
            </div>
            <div>
              <p className="text-xs opacity-70">Reserva</p>
              <p className="font-medium">N {settleBookingDisplayId ?? "-"}</p>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-white/15 bg-white/10 p-3 text-xs opacity-80">
            Se creara un recibo y luego se marcara la/s cuota/s como PAGADA.
            {settleServiceIds.length === 0 && (
              <>
                {" "}
                Estas cuotas no tienen servicio asociado, por lo que en el form deberas
                seleccionar al menos un servicio de la reserva para poder emitir el recibo.
              </>
            )}
          </div>

          {settleBookingId ? (
            <ReceiptForm
              token={token || null}
              bookingId={settleBookingId}
              bookingDisplayId={settleBookingDisplayId}
              isFormVisible={receiptFormVisible}
              setIsFormVisible={setReceiptFormVisible}
              loadServicesForBooking={loadServicesForBooking}
              initialServiceIds={settleServiceIds}
              initialConcept={settleConcept}
              initialAmount={settleTotal}
              initialCurrency={settleCurrency}
              initialAmountWordsCurrency={settleCurrency}
              initialIssueDate={ymdToday()}
              initialClientIds={settleClientId ? [settleClientId] : []}
              onSubmit={handleReceiptSubmit}
              onCancel={closeSettleModal}
            />
          ) : (
            <p className="text-sm text-red-200">
              No se detecto una reserva valida para las cuotas seleccionadas.
            </p>
          )}
        </Modal>

        <Modal
          open={historyOpen}
          onClose={() => {
            setHistoryOpen(false);
            setHistoryPayment(null);
          }}
          title="Historial de cambios"
        >
          {historyLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : historyPayment ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs opacity-70">Cuota</p>
                  <p className="font-medium">
                    N {historyPayment.agency_client_payment_id ?? historyPayment.id_payment}
                  </p>
                </div>
                <div>
                  <p className="text-xs opacity-70">Estado actual</p>
                  <p className="font-medium">
                    {getDisplayStatus(historyPayment)}
                  </p>
                </div>
                <div>
                  <p className="text-xs opacity-70">Monto</p>
                  <p className="font-medium">
                    {formatMoney(
                      toNumber(historyPayment.amount),
                      normalizeCurrency(historyPayment.currency),
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs opacity-70">Vence</p>
                  <p className="font-medium">{formatDate(historyPayment.due_date)}</p>
                </div>
              </div>

              {!historyPayment.audits || historyPayment.audits.length === 0 ? (
                <p className="rounded-2xl border border-white/15 bg-white/10 p-3 text-sm opacity-75">
                  No hay registros de auditoria para esta cuota.
                </p>
              ) : (
                <ul className="space-y-2">
                  {historyPayment.audits.map((audit) => {
                    const changedByName = audit.changedBy
                      ? `${audit.changedBy.first_name || ""} ${audit.changedBy.last_name || ""}`.trim() ||
                        `Usuario ${audit.changedBy.id_user}`
                      : audit.changed_by
                        ? `Usuario ${audit.changed_by}`
                        : "Sistema";

                    return (
                      <li
                        key={audit.id_audit}
                        className="rounded-2xl border border-white/15 bg-white/10 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs opacity-80">
                          <span className={CHIP}>
                            {paymentAuditActionLabel(audit.action)}
                          </span>
                          <span>{formatDate(audit.changed_at)}</span>
                        </div>

                        {(audit.from_status || audit.to_status) && (
                          <p className="mt-2 text-sm">
                            Estado: {paymentStatusLabel(audit.from_status)} -&gt;{" "}
                            {paymentStatusLabel(audit.to_status)}
                          </p>
                        )}

                        <p className="mt-1 text-sm">Usuario: {changedByName}</p>

                        {audit.reason ? (
                          <p className="mt-1 text-sm opacity-85">Motivo: {audit.reason}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm opacity-75">No se pudo cargar el historial.</p>
          )}
        </Modal>

        <ToastContainer />
      </section>
    </ProtectedRoute>
  );
}
