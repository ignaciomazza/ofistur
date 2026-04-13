// src/components/groups/collections/GroupReceiptCard.tsx

"use client";

import { useCallback, useMemo, useState } from "react";
import { Receipt, Service } from "@/types";
import {
  resolveGroupFinanceContextId,
  type GroupFinanceContext,
} from "@/components/groups/finance/contextTypes";
import { toast } from "react-toastify";
import Spinner from "@/components/Spinner";
import { authFetch } from "@/utils/authFetch";
import { responseErrorMessage } from "@/utils/httpError";
import { formatDateOnlyInBuenosAires } from "@/lib/buenosAiresDate";

/* ======================== Utils ======================== */

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
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const fmtMoney = (v?: number | string | null, curr?: string | null) => {
  const n = toNumber(v);
  const currency = normCurrency(curr);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
    }).format(safe);
  } catch {
    // fallback raro (por si es una moneda exótica)
    return `${currency} ${safe.toFixed(2)}`;
  }
};

const slugify = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const MAX_SERVICE_DESC = 64;
const MAX_SERVICE_LINES = 3;

const truncate = (value: string, max: number) => {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

const cleanServiceLabel = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const withoutPrefix = raw.replace(/^n[°º]?\s*/i, "");
  return withoutPrefix.replace(/[,\s]+$/g, "");
};

const cleanServiceDescription = (value: unknown) => {
  const raw = String(value ?? "");
  const flattened = raw
    .replace(/[\r\n]+/g, " ")
    .replace(/[•]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flattened) return "";
  const withoutNumberList = flattened.replace(
    /^(n[°º]?\s*\d+([,;]\s*n[°º]?\s*\d+)*)[,\s-]*/i,
    "",
  );
  return withoutNumberList.replace(/[,\s-]+$/g, "").trim();
};

const formatAgencyNumber = (value: number | null | undefined): string => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  return "Sin Nº";
};

/* ======================== Micro-componentes ======================== */

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

/* ======================== Props ======================== */

interface ReceiptCardProps {
  token: string | null;
  receipt: Receipt;
  context: GroupFinanceContext;
  groupId?: string;
  services: Service[];
  role: string;
  onReceiptDeleted?: (id: number) => void;
  onReceiptEdit?: (receipt: Receipt) => void;
}

/* ======================== Componente ======================== */

export default function GroupReceiptCard({
  token,
  receipt,
  context,
  groupId,
  services,
  role,
  onReceiptDeleted,
  onReceiptEdit,
}: ReceiptCardProps) {
  const contextId = resolveGroupFinanceContextId(context);
  const [loadingPDF, setLoadingPDF] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const canDownload = true;

  const getClientName = useCallback(
    (id: number): string => {
      if (context.titular?.id_client === id) {
        const titularNumber = formatAgencyNumber(
          context.titular.agency_client_id,
        );
        return `${context.titular.first_name} ${context.titular.last_name} · Nº${titularNumber}`;
      }
      const found = context.clients?.find((c) => c.id_client === id);
      return found
        ? `${found.first_name} ${found.last_name} · Nº${formatAgencyNumber(
            found.agency_client_id,
          )}`
        : "Sin Nº";
    },
    [context],
  );

  const clientsStr = useMemo(() => {
    return receipt.clientIds?.length
      ? receipt.clientIds.map(getClientName).join(", ")
      : context.titular
        ? `${context.titular.first_name} ${context.titular.last_name} · Nº${
            formatAgencyNumber(context.titular.agency_client_id)
          }`
        : "—";
  }, [receipt.clientIds, getClientName, context.titular]);

  const servicesPool = useMemo(
    () => (services?.length ? services : (context.services ?? [])),
    [services, context.services],
  );
  const serviceMap = useMemo(() => {
    const map = new Map<number, Service>();
    for (const svc of servicesPool || []) {
      map.set(svc.id_service, svc);
    }
    return map;
  }, [servicesPool]);

  const serviceDetails = useMemo(() => {
    const ids = receipt.serviceIds ?? [];
    if (!ids.length) return [];
    return ids.map((id) => {
      const svc = serviceMap.get(id);
      const labelId = cleanServiceLabel(svc?.agency_service_id);
      const rawDescription =
        svc?.description || svc?.type || "Servicio";
      const description = truncate(
        cleanServiceDescription(rawDescription),
        MAX_SERVICE_DESC,
      );
      const hasMeta = Boolean(description);
      return {
        id,
        labelId,
        description,
        hasMeta,
      };
    });
  }, [receipt.serviceIds, serviceMap]);

  const serviceNumbers = useMemo(() => {
    const ids = receipt.serviceIds ?? [];
    if (!ids.length) return [];
    const labels = ids
      .map((id) => cleanServiceLabel(serviceMap.get(id)?.agency_service_id))
      .filter((id) => id && id !== "0");
    return Array.from(new Set(labels));
  }, [receipt.serviceIds, serviceMap]);

  const serviceDescriptions = useMemo(
    () => serviceDetails.map((svc) => svc.description).filter(Boolean),
    [serviceDetails],
  );

  const serviceDescriptionPreview = useMemo(
    () => serviceDescriptions.slice(0, MAX_SERVICE_LINES),
    [serviceDescriptions],
  );
  const serviceDescriptionExtra =
    serviceDescriptions.length - serviceDescriptionPreview.length;

  const serviceNumbersLabel = useMemo(() => {
    if (!serviceNumbers.length) return "—";
    const base = serviceNumbers.map((id) => `Nº ${id}`).join(", ");
    return serviceDescriptions.length ? `${base}:` : base;
  }, [serviceNumbers, serviceDescriptions.length]);

  const hasBase =
    receipt.base_amount !== null &&
    receipt.base_amount !== undefined &&
    !!receipt.base_currency;
  const hasCounter =
    receipt.counter_amount !== null &&
    receipt.counter_amount !== undefined &&
    !!receipt.counter_currency;

  const hasPaymentFee =
    receipt.payment_fee_amount !== null &&
    receipt.payment_fee_amount !== undefined &&
    toNumber(receipt.payment_fee_amount) !== 0;

  const receiptDisplayNumber = formatAgencyNumber(receipt.agency_receipt_id);
  const receiptFileLabel = receiptDisplayNumber.replace(
    /[^a-zA-Z0-9_-]+/g,
    "_",
  );

  const displayAmount = hasBase ? receipt.base_amount : receipt.amount;
  const displayCurrency = hasBase
    ? receipt.base_currency
    : receipt.amount_currency;

  const cashAmount = hasCounter ? receipt.counter_amount : receipt.amount;
  const cashCurrency = hasCounter
    ? receipt.counter_currency
    : receipt.amount_currency;
  const showCounter =
    hasCounter ||
    (hasBase && normCurrency(cashCurrency) !== normCurrency(displayCurrency));

  if (!receipt?.id_receipt) {
    return (
      <div className="flex h-40 items-center justify-center dark:text-slate-100">
        <Spinner />
      </div>
    );
  }

  /* ====== handlers ====== */
  const downloadPDF = async () => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }

    setLoadingPDF(true);
    try {
      const endpoint = groupId
        ? `/api/groups/${encodeURIComponent(groupId)}/finance/receipts/${receipt.id_receipt}/pdf`
        : `/api/receipts/${receipt.public_id ?? receipt.id_receipt}/pdf`;
      const res = await authFetch(
        endpoint,
        { headers: { Accept: "application/pdf" } },
        token,
      );
      if (!res.ok) {
        throw new Error(
          await responseErrorMessage(res, "No se pudo descargar el recibo."),
        );
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const rawName =
        context.titular?.company_name ||
        `${context.titular?.first_name || ""} ${context.titular?.last_name || ""}`.trim() ||
        `Grupal_${contextId ?? "sin-contexto"}`;
      a.href = url;
      a.download = `Recibo_${slugify(rawName)}_${receiptFileLabel}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Recibo descargado exitosamente.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo descargar el recibo.",
      );
    } finally {
      setLoadingPDF(false);
    }
  };

  const deleteReceipt = async () => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    if (!confirm("¿Seguro querés eliminar este recibo?")) return;

    setLoadingDelete(true);
    try {
      const deleteEndpoint = groupId
        ? `/api/groups/${encodeURIComponent(groupId)}/finance/receipts/${receipt.id_receipt}`
        : `/api/receipts/${receipt.public_id ?? receipt.id_receipt}`;
      const res = await authFetch(
        deleteEndpoint,
        { method: "DELETE" },
        token,
      );
      if (!res.ok && res.status !== 204) throw new Error();
      onReceiptDeleted?.(receipt.id_receipt);
      toast.success("Recibo eliminado.");
    } catch {
      toast.error("No se pudo eliminar el recibo.");
    } finally {
      setLoadingDelete(false);
    }
  };

  const amountCurrency = normCurrency(displayCurrency);
  const amountLabel =
    amountCurrency === "ARS"
      ? "Pesos"
      : amountCurrency === "USD"
        ? "Dólares"
        : amountCurrency;

  const compactTotalsLayout = !showCounter && !hasPaymentFee;
  const metaItemClass =
    "rounded-xl border border-sky-300/70 bg-white px-3 py-2.5 dark:border-sky-600/30 dark:bg-sky-950/10";

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

  const paymentFeeCard = hasPaymentFee ? (
    <div className={metaItemClass}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Costo financiero
      </p>
      <p className="mt-1 text-[13px] font-medium tabular-nums md:text-sm">
        {fmtMoney(
          receipt.payment_fee_amount,
          receipt.amount_currency || amountCurrency,
        )}
      </p>
    </div>
  ) : null;

  const methodCard = (
    <div
      className={`${metaItemClass} ${
        compactTotalsLayout ? "col-span-2" : "col-span-1"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Método de pago
      </p>
      <p className="mt-1 text-[13px] font-medium md:text-sm">
        {/* currency = detalle legado / texto para PDF; payment_method = nombre corto */}
        {receipt.currency || receipt.payment_method || "—"}
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
      {serviceNumbers.length || serviceDescriptions.length ? (
        <div className="mt-1 text-[11px] md:text-xs">
          <p className="font-semibold">{serviceNumbersLabel}</p>
          {serviceDescriptionPreview.length > 0 && (
            <div className="mt-2 space-y-1">
              {serviceDescriptionPreview.map((desc, idx) => (
                <p
                  key={`${receipt.id_receipt}-svc-${idx}`}
                  className="leading-snug"
                >
                  • {desc}
                </p>
              ))}
              {serviceDescriptionExtra > 0 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  +{serviceDescriptionExtra} más
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-1 text-[13px] font-medium md:text-sm">—</p>
      )}
    </div>
  );

  /* ====== UI ====== */
  return (
    <div className="h-fit space-y-5 overflow-hidden rounded-2xl border border-sky-300/80 bg-white p-4 text-slate-900 shadow-sm shadow-slate-900/10 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-100">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] text-slate-600 dark:text-slate-400 md:text-sm">
              Recibo{" "}
              <span className="font-medium">Nº {receiptDisplayNumber}</span>
            </p>
            {receipt.payment_method ? (
              <Chip tone="brand" title="Método de pago">
                {receipt.payment_method}
              </Chip>
            ) : null}
          </div>
          <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 md:text-sm">
            {clientsStr}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <time
            className="text-[11px] text-slate-500 dark:text-slate-400 md:text-xs"
            title="Fecha de emisión"
          >
            {receipt.issue_date
              ? formatDateOnlyInBuenosAires(receipt.issue_date)
              : "–"}
          </time>
          <Chip tone="neutral" className="mt-1" title="Moneda del monto">
            {amountLabel}
          </Chip>
        </div>
      </header>

      {/* Totales / info principal */}
      <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {amountCard}
        {compactTotalsLayout && servicesCard}
        {paymentFeeCard}
        {methodCard}
        {counterCard}
        {!compactTotalsLayout && servicesCard}
      </section>

      {/* Concepto y Monto en letras */}
      <section className="flex flex-col gap-2">
        <div className={metaItemClass}>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Concepto
          </p>
          <p className="mt-1 text-[13px] leading-relaxed md:text-sm">{receipt.concept}</p>
        </div>
      </section>

      {/* Footer acciones */}
      <footer className="border-t border-sky-200/70 pt-4 dark:border-sky-900/40">
        <div className="flex flex-wrap justify-end gap-2">
        {canDownload ? (
          <IconButton
            onClick={downloadPDF}
            disabled={loadingPDF}
            loading={loadingPDF}
            aria-label="Descargar PDF del recibo"
            className="border-sky-300/80 bg-sky-100/80 text-sky-900 hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900/25 dark:text-sky-100 dark:hover:bg-sky-900/35"
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

        {onReceiptEdit && (
          <IconButton
            onClick={() => onReceiptEdit(receipt)}
            disabled={loadingDelete || loadingPDF}
            aria-label="Editar recibo"
            className="border-amber-300/80 bg-amber-100/90 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/40"
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
        )}

        {(role === "administrativo" ||
          role === "desarrollador" ||
          role === "gerente" ||
          role === "lider") && (
          <IconButton
            onClick={deleteReceipt}
            disabled={loadingDelete || loadingPDF}
            loading={loadingDelete}
            aria-label="Eliminar recibo"
            className="border-rose-300/80 bg-rose-100/90 text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-200 dark:hover:bg-rose-900/40"
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
        </div>
      </footer>
    </div>
  );
}
