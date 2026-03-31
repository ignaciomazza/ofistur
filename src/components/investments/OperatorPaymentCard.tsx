// src/components/investments/OperatorPaymentCard.tsx
"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import { toast } from "react-toastify";
import { authFetch } from "@/utils/authFetch";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import Spinner from "@/components/Spinner";
import type { Service } from "@/types";

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
  booking_amount?: number | string | null;
  currency: string;
  created_at: string;
  paid_at?: string | null;
  operator_id?: number | null;
  user_id?: number | null;
  booking_id?: number | null;
  serviceIds?: number[] | null;
  allocations?: Array<{
    service_id?: number | string | null;
    booking_id?: number | string | null;
  }> | null;
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
  payment_fee_amount?: number | string | null;
  payments?: Array<{
    id_investment_payment?: number;
    amount: number | string;
    payment_method: string;
    account?: string | null;
    payment_currency?: string | null;
    fee_mode?: "FIXED" | "PERCENT" | null;
    fee_value?: number | string | null;
    fee_amount?: number | string | null;
  }> | null;
};

type Props = {
  item: InvestmentItem;
  services?: Service[];
  token?: string | null;
  role?: string;
  onDeleted?: (id: number) => void;
  onEdit?: (item: InvestmentItem) => void;
};

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

function formatDate(s?: string | null) {
  if (!s) return "-";
  return formatDateInBuenosAires(s);
}

function fmtMoney(v?: number | string | null, cur?: string | null) {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  const currency = (cur || "ARS").toUpperCase();
  if (!Number.isFinite(n)) return "–";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function truncate(value: string, max: number): string {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

type ChipProps = {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warn";
};

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  label: string;
  tone?: "sky" | "rose";
};

const Chip = ({ children, tone = "neutral" }: ChipProps) => {
  const palette =
    tone === "brand"
      ? "bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-800/40"
      : tone === "success"
        ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800/40"
        : tone === "warn"
          ? "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800/40"
          : "bg-white/20 text-sky-950 border-white/10 dark:bg-white/10 dark:text-white";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${palette}`}
    >
      {children}
    </span>
  );
};

const cardActionTrackClass =
  "grid grid-cols-[20px_0fr] items-center gap-0 overflow-hidden transition-[grid-template-columns,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:grid-cols-[20px_1fr] group-hover/btn:gap-2 group-focus-visible/btn:grid-cols-[20px_1fr] group-focus-visible/btn:gap-2";

const cardActionTextClass =
  "min-w-0 translate-x-2 whitespace-nowrap text-sm opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:translate-x-0 group-hover/btn:opacity-100 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:opacity-100";

const cardActionBtnBase =
  "group/btn rounded-full px-3 py-2 shadow-sm backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-95 active:scale-90 disabled:cursor-not-allowed disabled:opacity-60";

const cardActionToneClass: Record<"sky" | "rose", string> = {
  sky: `${cardActionBtnBase} border border-sky-500/35 bg-sky-500/5 text-sky-900 shadow-sky-950/15 hover:bg-sky-500/10 dark:text-sky-100`,
  rose: `${cardActionBtnBase} border border-rose-500/40 bg-rose-500/5 text-rose-900 shadow-rose-950/15 hover:bg-rose-500/15 dark:text-rose-100`,
};

const IconButton = ({
  loading,
  label,
  tone = "sky",
  className = "",
  children,
  ...props
}: IconButtonProps) => (
  <button
    {...props}
    className={`${cardActionToneClass[tone]} ${className}`}
  >
    {loading ? (
      <Spinner />
    ) : (
      <span className={cardActionTrackClass}>
        {children}
        <span className={cardActionTextClass}>{label}</span>
      </span>
    )}
  </button>
);

function OperatorPaymentCard({
  item,
  services,
  token,
  role,
  onDeleted,
  onEdit,
}: Props) {
  const [loadingPDF, setLoadingPDF] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const totalAmount = Number(item.amount || 0);
  const scopedBookingAmount =
    item.booking_amount == null ? NaN : Number(item.booking_amount);
  const hasScopedBookingAmount = Number.isFinite(scopedBookingAmount);
  const amountToShow = hasScopedBookingAmount ? scopedBookingAmount : totalAmount;
  const showTotalAmount =
    hasScopedBookingAmount &&
    Number.isFinite(totalAmount) &&
    Math.abs(totalAmount - scopedBookingAmount) > 0.009;
  const formattedAmount = useMemo(
    () => fmtMoney(amountToShow, item.currency),
    [amountToShow, item.currency],
  );
  const paymentDisplayId = item.agency_investment_id ?? item.id_investment;

  const downloadPDF = async () => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    setLoadingPDF(true);
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
      const operatorName = item.operator?.name || "Operador";
      a.href = url;
      a.download = `Pago_Operador_${slugify(operatorName)}_${paymentDisplayId}.pdf`;
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

  const deletePayment = async () => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    if (!confirm("¿Seguro querés eliminar este pago al operador?")) return;

    setLoadingDelete(true);
    try {
      const res = await authFetch(
        `/api/investments/${item.id_investment}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok && res.status !== 204) throw new Error();
      onDeleted?.(item.id_investment);
      toast.success("Pago eliminado.");
    } catch {
      toast.error("No se pudo eliminar el pago.");
    } finally {
      setLoadingDelete(false);
    }
  };

  const openEdit = () => {
    if (onEdit) {
      onEdit(item);
      return;
    }
    if (typeof window !== "undefined") {
      window.location.assign(`/operators/payments?edit=${item.id_investment}`);
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
  const paymentLines = Array.isArray(item.payments) ? item.payments : [];
  const effectiveFeeTotal =
    item.payment_fee_amount != null
      ? Number(item.payment_fee_amount)
      : paymentLines.reduce(
          (sum, line) =>
            sum +
            (typeof line.fee_amount === "string"
              ? Number(line.fee_amount)
              : Number(line.fee_amount || 0)),
          0,
        );
  const hasPaymentMethod = !!item.payment_method && paymentLines.length === 0;
  const hasAccount = !!item.account && paymentLines.length === 0;
  const serviceLines = useMemo(() => {
    const serviceMap = new Map<number, Service>();
    const serviceMapByAgencyId = new Map<number, Service>();
    for (const svc of services ?? []) {
      if (svc?.id_service) serviceMap.set(svc.id_service, svc);
      if (svc?.agency_service_id) {
        serviceMapByAgencyId.set(svc.agency_service_id, svc);
      }
    }

    const rawIds: unknown[] = [];
    if (Array.isArray(item.serviceIds)) rawIds.push(...item.serviceIds);
    if (Array.isArray(item.allocations)) {
      for (const alloc of item.allocations) {
        rawIds.push(alloc?.service_id);
      }
    }
    if (rawIds.length === 0 && item.description) {
      const match = item.description.match(
        /servicios?\s*n[°º]?\s*([0-9,\s-]+)/i,
      );
      const group = match?.[1] ?? "";
      if (group) {
        for (const token of group.split(/[^0-9]+/g)) {
          if (token) rawIds.push(token);
        }
      }
    }
    const ids = Array.from(
      new Set(
        rawIds
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v > 0)
          .map((v) => Math.trunc(v)),
      ),
    );
    if (ids.length === 0) return [];

    return ids.map((id) => {
      const svc = serviceMap.get(id) ?? serviceMapByAgencyId.get(id);
      const serviceDisplayId = svc?.agency_service_id ?? id;
      const descRaw =
        (svc?.description || svc?.type || "Servicio")
          .replace(/\s+/g, " ")
          .trim() || "Servicio";
      return `N° ${serviceDisplayId} • ${truncate(descRaw, 54)}`;
    });
  }, [item.serviceIds, item.allocations, item.description, services]);
  const canManage =
    role === "administrativo" ||
    role === "desarrollador" ||
    role === "gerente" ||
    role === "lider";
  const operatorLabel = item.operator?.name?.trim() || "Operador";

  return (
    <div className="h-fit rounded-3xl border border-white/10 bg-white/10 p-5 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur transition-[transform,box-shadow] hover:scale-[0.998] dark:border-white/10 dark:bg-white/10 dark:text-white">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-sky-950/70 dark:text-white/70">
            N° {paymentDisplayId} • {formatDate(item.created_at)}
          </p>
        </div>
        <div className="max-w-48 rounded-xl border border-sky-300/60 bg-sky-100/45 px-2.5 py-1.5 text-right shadow-sm shadow-sky-950/10 dark:border-sky-400/50 dark:bg-sky-500/15">
          <p className="text-xs font-semibold leading-tight text-sky-900 dark:text-sky-100">
            {operatorLabel}
          </p>
        </div>
      </header>

      <section className="mb-3 rounded-2xl border border-white/10 bg-white/15 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
          Servicios
        </p>
        {serviceLines.length > 0 ? (
          <div className="mt-1.5 space-y-1">
            {serviceLines.slice(0, 3).map((line) => (
              <p key={line} className="text-xs leading-snug opacity-90">
                {line}
              </p>
            ))}
            {serviceLines.length > 3 && (
              <p className="text-[11px] opacity-65">
                +{serviceLines.length - 3} más
              </p>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-xs opacity-65">Sin servicios asociados</p>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-sky-200/40 bg-sky-50/60 p-3 shadow-sm shadow-sky-950/10 dark:border-sky-400/10 dark:bg-sky-400/10">
          <p className="text-xs opacity-70">
            {hasScopedBookingAmount ? "Aplicado" : "Monto"}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {formattedAmount}
          </p>
          {showTotalAmount && (
            <p className="mt-1 text-xs opacity-75">
              Total {fmtMoney(totalAmount, item.currency)}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
          <div className="flex flex-wrap gap-2">
            {hasPaymentMethod && <Chip tone="brand">{item.payment_method}</Chip>}
            {hasAccount && <Chip>{item.account}</Chip>}
            {item.paid_at && (
              <Chip tone="success">{formatDate(item.paid_at)}</Chip>
            )}
            {effectiveFeeTotal > 0 && (
              <Chip tone="warn">
                CF {fmtMoney(effectiveFeeTotal, item.currency)}
              </Chip>
            )}
          </div>
        </div>
      </section>

      {(hasBase || hasCounter) && (
        <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
            <p className="text-xs opacity-70">Base</p>
            <p className="mt-1 text-sm font-medium tabular-nums">
              {hasBase ? fmtMoney(item.base_amount, item.base_currency) : "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
            <p className="text-xs opacity-70">Contravalor</p>
            <p className="mt-1 text-sm font-medium tabular-nums">
              {hasCounter
                ? fmtMoney(item.counter_amount, item.counter_currency)
                : "—"}
            </p>
          </div>
        </section>
      )}

      {paymentLines.length > 0 && (
        <section className="mt-3 rounded-2xl border border-white/10 bg-white/10 p-3 shadow-sm shadow-sky-950/10">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-65">
            Pagos
          </p>
          <div className="space-y-2">
            {paymentLines.map((line, idx) => {
              const lineAmount =
                typeof line.amount === "string"
                  ? Number(line.amount)
                  : Number(line.amount || 0);
              const lineCurrency = String(
                line.payment_currency || item.currency || "ARS",
              ).toUpperCase();
              const lineFee =
                typeof line.fee_amount === "string"
                  ? Number(line.fee_amount)
                  : Number(line.fee_amount || 0);
              return (
                <div
                  key={`${line.id_investment_payment ?? idx}`}
                  className="rounded-xl border border-white/10 bg-white/10 px-2.5 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{line.payment_method}</span>
                    <span className="tabular-nums opacity-90">
                      {fmtMoney(lineAmount, lineCurrency)}
                    </span>
                    {line.account ? (
                      <span className="opacity-75">{line.account}</span>
                    ) : null}
                    {lineFee > 0 ? (
                      <span className="opacity-75">
                        CF {fmtMoney(lineFee, lineCurrency)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
        <IconButton
          onClick={downloadPDF}
          disabled={loadingPDF || loadingDelete}
          loading={loadingPDF}
          label="Descargar"
          tone="sky"
          aria-label="Descargar comprobante"
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
        </IconButton>

        <IconButton
          onClick={openEdit}
          disabled={loadingPDF || loadingDelete}
          label="Editar"
          tone="sky"
          aria-label="Editar pago"
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
              d="m16.862 3.487 1.687-1.687a2.25 2.25 0 1 1 3.182 3.182l-1.687 1.687m-3.182-3.182L4.5 15.85V19.5h3.65L20.513 7.138m-3.651-3.651L20.513 7.14"
            />
          </svg>
        </IconButton>

        {canManage && (
          <IconButton
            onClick={deletePayment}
            disabled={loadingPDF || loadingDelete}
            loading={loadingDelete}
            label="Eliminar"
            tone="rose"
            aria-label="Eliminar pago"
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
          </IconButton>
        )}
      </footer>
    </div>
  );
}

export default memo(OperatorPaymentCard);
