// src/components/groups/payments/GroupOperatorPaymentCard.tsx
"use client";

import { memo, useMemo, useState } from "react";
import { toast } from "react-toastify";
import Spinner from "@/components/Spinner";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import { authFetch } from "@/utils/authFetch";
import { responseErrorMessage } from "@/utils/httpError";

export type OperatorLite = { id_operator: number; name: string | null };
export type UserLite = {
  id_user: number;
  first_name: string;
  last_name: string;
};

export type InvestmentItem = {
  id_investment: number;
  agency_investment_id?: number | null;
  category: string;
  description: string;
  amount: number;
  currency: string;
  created_at: string;
  paid_at?: string | null;
  operator_id?: number | null;
  user_id?: number | null;
  context_id?: number | null;
  booking_id?: number | null;
  serviceIds?: number[] | null;
  allocations?: Array<{
    service_id?: number | string | null;
    service_currency?: string | null;
    amount_service?: number | string | null;
  }> | null;
  context?: { id_context: number; agency_context_id?: number | null } | null;
  booking?: { id_booking: number; agency_booking_id?: number | null } | null;
  operator?: OperatorLite | null;
  user?: UserLite | null;
  createdBy?: UserLite | null;

  // Nuevos campos
  payment_method?: string | null;
  account?: string | null;
  base_amount?: number | string | null;
  base_currency?: string | null;
  counter_amount?: number | string | null;
  counter_currency?: string | null;
};

type Props = {
  item: InvestmentItem;
  token?: string | null;
  groupId?: string;
  role?: string;
  allowDownload?: boolean;
  serviceDetailLines?: string[];
  onEdit?: (item: InvestmentItem) => void;
  onDeleted?: (id: number) => void;
};

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const formatPaidDate = (value?: string | null) =>
  value ? formatDateInBuenosAires(value) : "00/00/0000";

const normCurrency = (c?: string | null) => {
  const cu = (c || "").toUpperCase().trim();
  if (["USD", "US$", "U$S", "U$D", "DOL"].includes(cu)) return "USD";
  if (["ARS", "$", "AR$"].includes(cu)) return "ARS";
  if (/^[A-Z]{3}$/.test(cu)) return cu;
  return "ARS";
};

const toNumber = (v?: number | string | null) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

function fmtMoney(v?: number | string | null, cur?: string | null) {
  const n = toNumber(v);
  const currency = normCurrency(cur);
  const safe = Number.isFinite(n) ? n : 0;
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

function formatAgencyNumber(value: number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  return "Sin Nº";
}

const Chip: React.FC<{
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warn" | "danger" | "brand";
  title?: string;
  className?: string;
}> = ({ children, tone = "neutral", title, className = "" }) => {
  const palette =
    tone === "success"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800/40"
      : tone === "warn"
        ? "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800/40"
        : tone === "danger"
          ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800/40"
          : tone === "brand"
            ? "bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-800/40"
            : "bg-white text-slate-700 border-sky-300/70 dark:bg-sky-950/10 dark:text-slate-200 dark:border-sky-600/30";
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium md:text-xs ${palette} ${className}`}
    >
      {children}
    </span>
  );
};

const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
> = ({ loading, children, className = "", ...props }) => (
  <button
    {...props}
    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] shadow-sm transition-transform hover:scale-95 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 active:scale-90 disabled:opacity-50 md:text-sm ${className}`}
  >
    {loading ? <Spinner /> : children}
  </button>
);

function GroupOperatorPaymentCard({
  item,
  token,
  groupId,
  role,
  allowDownload = true,
  serviceDetailLines = [],
  onEdit,
  onDeleted,
}: Props) {
  const [loadingPDF, setLoadingPDF] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const canManage =
    role === "administrativo" ||
    role === "desarrollador" ||
    role === "gerente" ||
    role === "lider";
  const canEdit = canManage && typeof onEdit === "function";
  const canDelete = canManage && Boolean(groupId);
  const contextMeta = item.context
    ? item.context
    : item.booking
      ? {
          id_context: item.booking.id_booking,
          agency_context_id: item.booking.agency_booking_id ?? null,
        }
      : null;
  const contextNumber = formatAgencyNumber(contextMeta?.agency_context_id);
  const contextRef = item.context_id ?? item.booking_id;
  const paymentDisplayId = formatAgencyNumber(item.agency_investment_id);
  const paymentFileId = useMemo(() => {
    if (
      typeof item.agency_investment_id === "number" &&
      Number.isFinite(item.agency_investment_id) &&
      item.agency_investment_id > 0
    ) {
      return String(Math.trunc(item.agency_investment_id));
    }
    return "sin-numero";
  }, [item.agency_investment_id]);

  const downloadPDF = async () => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    setLoadingPDF(true);
    try {
      const endpoint = groupId
        ? `/api/groups/${encodeURIComponent(groupId)}/finance/operator-payments/${item.id_investment}/pdf`
        : `/api/investments/${item.id_investment}/pdf`;
      const res = await authFetch(
        endpoint,
        { headers: { Accept: "application/pdf" } },
        token,
      );
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const operatorName = item.operator?.name || "Operador";
      a.href = url;
      a.download = `Pago_Operador_${slugify(operatorName)}_${paymentFileId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Comprobante descargado exitosamente.");
    } catch {
      toast.error("No se pudo descargar el comprobante.");
    } finally {
      setLoadingPDF(false);
    }
  };

  const hasBase =
    item.base_amount !== null &&
    item.base_amount !== undefined &&
    !!item.base_currency;
  const hasCounter =
    item.counter_amount !== null &&
    item.counter_amount !== undefined &&
    !!item.counter_currency;
  const displayAmount = hasBase ? item.base_amount : item.amount;
  const displayCurrency = hasBase ? item.base_currency : item.currency;
  const cashAmount = hasCounter ? item.counter_amount : item.amount;
  const cashCurrency = hasCounter ? item.counter_currency : item.currency;
  const showCounter =
    hasCounter ||
    (hasBase && normCurrency(cashCurrency) !== normCurrency(displayCurrency));
  const amountCurrency = normCurrency(displayCurrency);
  const amountLabel =
    amountCurrency === "ARS"
      ? "Pesos"
      : amountCurrency === "USD"
        ? "Dólares"
        : amountCurrency;
  const servicesCount = Array.isArray(item.serviceIds) ? item.serviceIds.length : 0;
  const metaItemClass =
    "rounded-xl border border-sky-300/70 bg-white px-3 py-2.5 dark:border-sky-600/30 dark:bg-sky-950/10";

  const deletePayment = async () => {
    if (!groupId) return;
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    if (!confirm("¿Seguro querés eliminar este pago al operador?")) return;

    setLoadingDelete(true);
    try {
      const endpoint = `/api/groups/${encodeURIComponent(groupId)}/finance/operator-payments/${item.id_investment}`;
      const res = await authFetch(
        endpoint,
        { method: "DELETE" },
        token,
      );
      if (!res.ok && res.status !== 204) {
        throw new Error(
          await responseErrorMessage(res, "No se pudo eliminar el pago."),
        );
      }
      toast.success("Pago eliminado.");
      onDeleted?.(item.id_investment);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo eliminar el pago.";
      toast.error(message);
    } finally {
      setLoadingDelete(false);
    }
  };

  const amountCard = (
    <div className={metaItemClass}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {hasBase ? "Valor aplicado" : "Monto"}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums md:text-base">
        {fmtMoney(displayAmount, displayCurrency)}
      </p>
    </div>
  );

  const methodCard = (
    <div className={metaItemClass}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Método de pago
      </p>
      <p className="mt-1 text-[13px] font-medium md:text-sm">
        {item.payment_method || "—"}
      </p>
    </div>
  );

  const accountCard = (
    <div className={metaItemClass}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Cuenta
      </p>
      <p className="mt-1 text-[13px] font-medium md:text-sm">
        {item.account || "—"}
      </p>
    </div>
  );

  const counterCard = showCounter ? (
    <div className={metaItemClass}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Contravalor
      </p>
      <p className="mt-1 text-[13px] font-medium tabular-nums md:text-sm">
        {fmtMoney(cashAmount, cashCurrency)}
      </p>
    </div>
  ) : null;

  const servicesCard = (
    <div className={metaItemClass}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Servicios
      </p>
      <p className="mt-1 text-[13px] font-medium md:text-sm">
        {servicesCount > 0 ? `${servicesCount} seleccionados` : "—"}
      </p>
    </div>
  );

  const serviceDetailCard =
    serviceDetailLines.length > 0 ? (
      <section className={metaItemClass}>
        <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Detalle por servicio
        </p>
        <div className="mt-1 space-y-1">
          {serviceDetailLines.slice(0, 3).map((line) => (
            <p
              key={line}
              className="text-[11px] leading-snug text-slate-700 dark:text-slate-200"
            >
              {line}
            </p>
          ))}
          {serviceDetailLines.length > 3 ? (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              +{serviceDetailLines.length - 3} más
            </p>
          ) : null}
        </div>
      </section>
    ) : null;

  return (
    <article className="h-fit space-y-5 overflow-hidden rounded-2xl border border-sky-300/80 bg-white p-4 text-slate-900 shadow-sm shadow-slate-900/10 backdrop-blur-sm dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] text-slate-600 dark:text-slate-400 md:text-sm">
              Pago <span className="font-medium">Nº {paymentDisplayId}</span>
            </p>
            <Chip tone="brand" title="Categoría">
              {item.category || "Operador"}
            </Chip>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 md:text-sm">
            {item.operator?.name || "Operador"}
            {contextRef ? ` · Grupal Nº ${contextNumber}` : ""}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <Chip tone="neutral" className="mt-1" title="Moneda del monto">
            {amountLabel}
          </Chip>
        </div>
      </header>

      <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {amountCard}
        {methodCard}
        {accountCard}
        {counterCard}
        {servicesCard}
      </section>

      <section className="flex flex-col gap-2">
        {serviceDetailCard}
        <div className={metaItemClass}>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Concepto
          </p>
          <p className="mt-1 text-[13px] leading-relaxed md:text-sm">
            {item.description || "Pago a operador"}
          </p>
        </div>
      </section>

      <footer className="border-t border-sky-200/70 pt-4 dark:border-sky-900/40">
        {item.createdBy ? (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 md:text-xs">
            Cargado por: {item.createdBy.first_name} {item.createdBy.last_name}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 md:text-xs">
          Pagado: {formatPaidDate(item.paid_at)}
        </p>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {allowDownload ? (
            <IconButton
              onClick={downloadPDF}
              disabled={loadingPDF || loadingDelete}
              loading={loadingPDF}
              className="border-sky-300/80 bg-sky-100/80 text-sky-900 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/25 dark:text-sky-100 dark:hover:bg-sky-900/35"
              aria-label="Descargar comprobante"
              title="Descargar comprobante"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              Descargar PDF
            </IconButton>
          ) : null}
          {canEdit ? (
            <IconButton
              onClick={() => onEdit?.(item)}
              disabled={loadingPDF || loadingDelete}
              className="border-amber-300/80 bg-amber-100/90 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/40"
              aria-label="Editar pago"
              title="Editar pago"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m16.862 3.487 1.687-1.687a2.25 2.25 0 1 1 3.182 3.182l-1.687 1.687m-3.182-3.182L4.5 15.85V19.5h3.65L20.513 7.138m-3.651-3.651L20.513 7.14"
                />
              </svg>
              Editar
            </IconButton>
          ) : null}
          {canDelete ? (
            <IconButton
              onClick={deletePayment}
              disabled={loadingPDF || loadingDelete}
              loading={loadingDelete}
              className="border-rose-300/80 bg-rose-100/90 text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-200 dark:hover:bg-rose-900/40"
              aria-label="Eliminar pago"
              title="Eliminar pago"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                />
              </svg>
              Eliminar
            </IconButton>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

export default memo(GroupOperatorPaymentCard);
