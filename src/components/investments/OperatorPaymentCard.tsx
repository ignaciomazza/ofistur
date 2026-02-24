// src/components/investments/OperatorPaymentCard.tsx
"use client";

import { memo, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { authFetch } from "@/utils/authFetch";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import Spinner from "@/components/Spinner";

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
  token?: string | null;
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

function OperatorPaymentCard({ item, token }: Props) {
  const [loadingPDF, setLoadingPDF] = useState(false);
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
  const bookingNumber = item.booking?.agency_booking_id ?? item.booking_id;
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

  return (
    <div className="rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">
          Pago a Operador
          {item.operator?.name ? ` · ${item.operator.name}` : ""}
        </div>
        <div className="flex items-center gap-2">
          {item.booking_id ? (
            <span className="text-xs opacity-70">
              Reserva N° {bookingNumber}
            </span>
          ) : null}
          <span className="text-sm opacity-70">N° {paymentDisplayId}</span>
          <button
            type="button"
            onClick={downloadPDF}
            disabled={loadingPDF}
            className="group/btn rounded-full border border-sky-500/35 bg-sky-500/5 px-3 py-2 text-sky-900 shadow-sm shadow-sky-950/15 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-95 hover:bg-sky-500/10 active:scale-90 disabled:cursor-not-allowed disabled:opacity-60 dark:text-sky-100"
            title="Descargar comprobante"
            aria-label="Descargar comprobante"
          >
            {loadingPDF ? (
              <Spinner />
            ) : (
              <span className="grid grid-cols-[16px_0fr] items-center gap-0 overflow-hidden transition-[grid-template-columns,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:grid-cols-[16px_1fr] group-hover/btn:gap-2 group-focus-visible/btn:grid-cols-[16px_1fr] group-focus-visible/btn:gap-2">
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
                <span className="min-w-0 translate-x-2 whitespace-nowrap text-xs opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:translate-x-0 group-hover/btn:opacity-100 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:opacity-100">
                  Descargar
                </span>
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="mt-1 text-lg opacity-90">{item.description}</div>

      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        <span>
          <b>{hasScopedBookingAmount ? "Monto aplicado:" : "Monto:"}</b>{" "}
          {formattedAmount}
        </span>
        {showTotalAmount && (
          <span>
            <b>Total del pago:</b> {fmtMoney(totalAmount, item.currency)}
          </span>
        )}

        {/* Método de pago / Cuenta (opcionales) */}
        {item.payment_method && paymentLines.length === 0 && (
          <span>
            <b>Método:</b> {item.payment_method}
          </span>
        )}
        {item.account && paymentLines.length === 0 && (
          <span>
            <b>Cuenta:</b> {item.account}
          </span>
        )}
        {effectiveFeeTotal > 0 && (
          <span>
            <b>Costo financiero:</b> {fmtMoney(effectiveFeeTotal, item.currency)}
          </span>
        )}

        {/* Valor base / Contravalor */}
        {(hasBase || hasCounter) && (
          <span>
            <b>Valor base / Contravalor:</b>{" "}
            {hasBase ? fmtMoney(item.base_amount, item.base_currency) : "–"} /{" "}
            {hasCounter
              ? fmtMoney(item.counter_amount, item.counter_currency)
              : "–"}
          </span>
        )}

        <span>
          <b>Creado:</b> {formatDate(item.created_at)}
        </span>
        {item.paid_at && (
          <span>
            <b>Pagado:</b> {formatDate(item.paid_at)}
          </span>
        )}
        {item.operator?.name && (
          <span>
            <b>Operador:</b> {item.operator.name}
          </span>
        )}
        {item.serviceIds && item.serviceIds.length > 0 && (
          <span>
            <b>Servicios:</b> {item.serviceIds.length}
          </span>
        )}
        {item.createdBy && (
          <span className="opacity-80">
            <b>Cargado por:</b> {item.createdBy.first_name}{" "}
            {item.createdBy.last_name}
          </span>
        )}
      </div>

      {paymentLines.length > 0 && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
          <p className="mb-2 font-semibold">Pagos</p>
          <div className="space-y-1">
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
                <p key={`${line.id_investment_payment ?? idx}`}>
                  #{idx + 1} {line.payment_method} -{" "}
                  {fmtMoney(lineAmount, lineCurrency)}
                  {line.account ? ` - ${line.account}` : " - sin cuenta"}
                  {lineFee > 0 ? ` - CF ${fmtMoney(lineFee, lineCurrency)}` : ""}
                </p>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(OperatorPaymentCard);
