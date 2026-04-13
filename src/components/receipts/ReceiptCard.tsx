// src/components/receipts/ReceiptCard.tsx

"use client";

import { useCallback, useMemo, useState } from "react";
import { Receipt, Booking, Service } from "@/types";
import { toast } from "react-toastify";
import Spinner from "@/components/Spinner";
import { authFetch } from "@/utils/authFetch";
import { responseErrorMessage } from "@/utils/httpError";
import { formatDateOnlyInBuenosAires } from "@/lib/buenosAiresDate";
import { decodeReceiptPdfItemsPayload } from "@/utils/receipts/pdfItemsPayload";

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

const toFiniteNumber = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};

const toInputDate = (value?: string | null) => {
  if (!value) return "";
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeIdList = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((id) => Number.isFinite(id) && id > 0)
        .map((id) => Math.trunc(id)),
    ),
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fmtMoney = (v?: number | string | null, curr?: string | null) => {
  const n = toNumber(v);
  const currency = normCurrency(curr);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    const formatted = new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
    }).format(safe);
    return currency === "USD" ? formatted.replace("US$", "U$D") : formatted;
  } catch {
    const symbol =
      currency === "USD" ? "U$D" : currency === "ARS" ? "$" : `${currency} `;
    return `${symbol}${safe.toLocaleString("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
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
            : "bg-white/20 text-sky-950 border-white/10 dark:bg-white/10 dark:text-white";
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${palette} ${className}`}
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

const cardActionToneClass: Record<"sky" | "emerald" | "rose", string> = {
  sky: `${cardActionBtnBase} border border-sky-500/35 bg-sky-500/5 text-sky-900 shadow-sky-950/15 hover:bg-sky-500/10 dark:text-sky-100`,
  emerald: `${cardActionBtnBase} border border-emerald-500/40 bg-emerald-500/5 text-emerald-900 shadow-emerald-950/15 hover:bg-emerald-500/15 dark:text-emerald-100`,
  rose: `${cardActionBtnBase} border border-rose-500/40 bg-rose-500/5 text-rose-900 shadow-rose-950/15 hover:bg-rose-500/15 dark:text-rose-100`,
};

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  label: string;
  tone?: "sky" | "emerald" | "rose";
};

const IconButton: React.FC<IconButtonProps> = ({
  loading,
  label,
  tone = "sky",
  children,
  className = "",
  ...props
}) => (
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

/* ======================== Props ======================== */

interface ReceiptCardProps {
  token: string | null;
  receipt: Receipt;
  booking: Booking;
  services: Service[];
  role: string;
  onReceiptDeleted?: (id: number) => void;
  onReceiptEdit?: (receipt: Receipt) => void;
  onReceiptDuplicated?: () => void;
}

/* ======================== Componente ======================== */

export default function ReceiptCard({
  token,
  receipt,
  booking,
  services,
  role,
  onReceiptDeleted,
  onReceiptEdit,
  onReceiptDuplicated,
}: ReceiptCardProps) {
  const [loadingPDF, setLoadingPDF] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const [loadingDuplicate, setLoadingDuplicate] = useState(false);
  const paymentDetail = useMemo(() => {
    const decoded = decodeReceiptPdfItemsPayload(receipt.currency || "");
    return decoded.paymentDetail || "";
  }, [receipt.currency]);

  const getClientName = useCallback(
    (id: number): string => {
      if (booking.titular?.id_client === id) {
        const titularNumber =
          booking.titular.agency_client_id ?? booking.titular.id_client;
        return `${booking.titular.first_name} ${booking.titular.last_name} · N°${titularNumber}`;
      }
      const found = booking.clients?.find((c) => c.id_client === id);
      return found
        ? `${found.first_name} ${found.last_name} · N°${id}`
        : `N°${id}`;
    },
    [booking],
  );

  const clientsStr = useMemo(() => {
    return receipt.clientIds?.length
      ? receipt.clientIds.map(getClientName).join(", ")
      : booking.titular
        ? `${booking.titular.first_name} ${booking.titular.last_name} · N°${
            booking.titular.agency_client_id ?? booking.titular.id_client
          }`
        : "—";
  }, [receipt.clientIds, getClientName, booking.titular]);

  const servicesPool = useMemo(
    () => (services?.length ? services : (booking.services ?? [])),
    [services, booking.services],
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
      const labelId = cleanServiceLabel(svc?.agency_service_id ?? id);
      const rawDescription =
        svc?.description || svc?.type || (id ? `Servicio ${id}` : "Servicio");
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
      .map((id) =>
        cleanServiceLabel(serviceMap.get(id)?.agency_service_id ?? id),
      )
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
    const base = serviceNumbers.map((id) => `N° ${id}`).join(", ");
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

  const receiptDisplayNumber =
    receipt.agency_receipt_id != null
      ? String(receipt.agency_receipt_id)
      : receipt.receipt_number;
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
      <div className="flex h-40 items-center justify-center dark:text-white">
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
      const res = await authFetch(
        `/api/receipts/${receipt.public_id ?? receipt.id_receipt}/pdf`,
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
        booking.titular?.company_name ||
        `${booking.titular?.first_name || ""} ${booking.titular?.last_name || ""}`.trim() ||
        `Reserva_${booking.id_booking}`;
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

  const duplicateReceipt = async () => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    if (loadingDuplicate) return;

    setLoadingDuplicate(true);
    try {
      const sourceRes = await authFetch(
        `/api/receipts/${receipt.public_id ?? receipt.id_receipt}`,
        { cache: "no-store" },
        token,
      );
      if (!sourceRes.ok) {
        throw new Error(
          await responseErrorMessage(
            sourceRes,
            "No se pudo leer el recibo a duplicar.",
          ),
        );
      }

      const sourceJson: unknown = await sourceRes.json().catch(() => null);
      const source =
        isRecord(sourceJson) && isRecord(sourceJson.receipt)
          ? sourceJson.receipt
          : null;
      if (!source || !Number.isFinite(Number(source.id_receipt))) {
        throw new Error("No se pudo leer el recibo a duplicar.");
      }

      const concept = String(source.concept ?? receipt.concept ?? "").trim();
      const amountString = String(
        source.amount_string ?? receipt.amount_string ?? "",
      ).trim();
      const amountCurrency =
        String(source.amount_currency ?? receipt.amount_currency ?? "ARS")
          .trim()
          .toUpperCase() || "ARS";
      const amount = toFiniteNumber(source.amount ?? receipt.amount);

      if (!concept) throw new Error("El recibo no tiene concepto para duplicar.");
      if (!amountString) {
        throw new Error("El recibo no tiene monto en letras para duplicar.");
      }
      if (!Number.isFinite(amount)) {
        throw new Error("El recibo tiene un monto inválido para duplicar.");
      }

      type DuplicatePaymentPayload = {
        amount: number;
        payment_method_id: number;
        account_id: number | undefined;
        payment_currency: string;
        fee_mode: "FIXED" | "PERCENT" | undefined;
        fee_value?: number;
        fee_amount?: number;
      };

      const sourcePayments = Array.isArray(source.payments)
        ? source.payments
        : [];
      const normalizedPayments = sourcePayments
        .map((payment): DuplicatePaymentPayload | null => {
          if (!isRecord(payment)) return null;
          const paymentAmount = toFiniteNumber(payment.amount);
          const paymentMethodId = Number(payment.payment_method_id ?? NaN);
          if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) return null;
          if (!Number.isFinite(paymentMethodId) || paymentMethodId <= 0)
            return null;

          const accountId = Number(payment.account_id ?? NaN);
          const feeValue = toFiniteNumber(payment.fee_value);
          const feeAmount = toFiniteNumber(payment.fee_amount);
          const feeModeRaw = String(payment.fee_mode ?? "").trim().toUpperCase();

          return {
            amount: paymentAmount,
            payment_method_id: Math.trunc(paymentMethodId),
            account_id:
              Number.isFinite(accountId) && accountId > 0
                ? Math.trunc(accountId)
                : undefined,
            payment_currency:
              String(payment.payment_currency || amountCurrency || "ARS")
                .trim()
                .toUpperCase() || "ARS",
            fee_mode:
              feeModeRaw === "FIXED" || feeModeRaw === "PERCENT"
                ? (feeModeRaw as "FIXED" | "PERCENT")
                : undefined,
            ...(Number.isFinite(feeValue) ? { fee_value: feeValue } : {}),
            ...(Number.isFinite(feeAmount) ? { fee_amount: feeAmount } : {}),
          };
        })
        .filter(
          (
            payment,
          ): payment is DuplicatePaymentPayload => payment !== null,
        );

      const canReusePayments =
        sourcePayments.length > 0 &&
        normalizedPayments.length === sourcePayments.length;

      const serviceAllocations = Array.isArray(source.service_allocations)
        ? source.service_allocations
            .map((alloc) => {
              if (!isRecord(alloc)) return null;
              const serviceId = Number(alloc.service_id ?? NaN);
              const amountService = toFiniteNumber(alloc.amount_service);
              if (!Number.isFinite(serviceId) || serviceId <= 0) return null;
              if (!Number.isFinite(amountService) || amountService <= 0)
                return null;
              const serviceCurrency = String(
                alloc.service_currency ?? "",
              ).trim();
              return {
                service_id: Math.trunc(serviceId),
                amount_service: amountService,
                ...(serviceCurrency
                  ? { service_currency: serviceCurrency }
                  : {}),
              };
            })
            .filter(
              (
                alloc,
              ): alloc is {
                service_id: number;
                amount_service: number;
                service_currency?: string;
              } => alloc !== null,
            )
        : [];

      const issueDate = toInputDate(
        typeof source.issue_date === "string"
          ? source.issue_date
          : receipt.issue_date,
      );
      const payload: Record<string, unknown> = {
        concept,
        currency: source.currency ?? receipt.currency ?? amountCurrency,
        amountString,
        amountCurrency,
        amount,
        ...(issueDate ? { issue_date: issueDate } : {}),
        serviceIds: normalizeIdList(source.serviceIds ?? receipt.serviceIds),
        clientIds: normalizeIdList(source.clientIds ?? receipt.clientIds),
        serviceAllocations,
        ...(Number.isFinite(toFiniteNumber(source.payment_fee_amount))
          ? { payment_fee_amount: toFiniteNumber(source.payment_fee_amount) }
          : {}),
        ...(source.base_amount != null ? { base_amount: source.base_amount } : {}),
        ...(source.base_currency ? { base_currency: source.base_currency } : {}),
        ...(source.counter_amount != null
          ? { counter_amount: source.counter_amount }
          : {}),
        ...(source.counter_currency
          ? { counter_currency: source.counter_currency }
          : {}),
      };

      const bookingId = Number(
        source.bookingId_booking ?? receipt.bookingId_booking ?? NaN,
      );
      if (Number.isFinite(bookingId) && bookingId > 0) {
        payload.booking = { id_booking: Math.trunc(bookingId) };
      }

      if (canReusePayments) {
        payload.payments = normalizedPayments;
      } else {
        const receiptLegacy = receipt as unknown as Record<string, unknown>;
        const paymentMethodId = Number(
          source.payment_method_id ?? receiptLegacy.payment_method_id ?? NaN,
        );
        const accountId = Number(
          source.account_id ?? receiptLegacy.account_id ?? NaN,
        );
        const paymentMethodText = String(
          source.payment_method ?? receipt.payment_method ?? "",
        ).trim();
        const accountText = String(
          source.account ?? receipt.account ?? "",
        ).trim();

        if (Number.isFinite(paymentMethodId) && paymentMethodId > 0) {
          payload.payment_method_id = Math.trunc(paymentMethodId);
        }
        if (Number.isFinite(accountId) && accountId > 0) {
          payload.account_id = Math.trunc(accountId);
        }
        if (paymentMethodText) {
          payload.payment_method = paymentMethodText;
        }
        if (accountText) {
          payload.account = accountText;
        }
      }

      const createRes = await authFetch(
        "/api/receipts",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token,
      );
      if (!createRes.ok) {
        throw new Error(
          await responseErrorMessage(createRes, "No se pudo duplicar el recibo."),
        );
      }

      onReceiptDuplicated?.();
      toast.success("Recibo duplicado.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo duplicar el recibo.",
      );
    } finally {
      setLoadingDuplicate(false);
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
      const res = await authFetch(
        `/api/receipts/${receipt.public_id ?? receipt.id_receipt}`,
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

  const amountCard = (
    <div className="rounded-2xl border border-sky-200/40 bg-sky-50/60 p-3 shadow-sm shadow-sky-950/10 dark:border-sky-400/10 dark:bg-sky-400/10">
      <p className="text-xs opacity-70">
        {hasBase ? "Valor aplicado" : "Monto"}
      </p>
      <p className="text-base font-semibold tabular-nums">
        {fmtMoney(displayAmount, displayCurrency)}
      </p>
    </div>
  );

  const paymentFeeCard = hasPaymentFee ? (
    <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
      <p className="text-xs opacity-70">Costo financiero método</p>
      <p className="text-sm font-medium tabular-nums">
        {fmtMoney(
          receipt.payment_fee_amount,
          receipt.amount_currency || amountCurrency,
        )}
      </p>
    </div>
  ) : null;

  const methodCard = (
    <div
      className={`rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10 ${
        compactTotalsLayout ? "col-span-2" : "col-span-1"
      }`}
    >
      <p className="text-xs opacity-70">Método de pago</p>
      <p className="mt-1 text-sm font-medium">
        {/* currency = detalle legado / texto para PDF; payment_method = nombre corto */}
        {receipt.payment_method || paymentDetail || "—"}
      </p>
    </div>
  );

  const counterCard = showCounter ? (
    <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
      <p className="text-xs opacity-70">Contravalor</p>
      <p className="text-sm font-medium tabular-nums">
        {fmtMoney(cashAmount, cashCurrency)}
      </p>
    </div>
  ) : null;

  const servicesCard = (
    <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
      <p className="text-xs opacity-70">Servicios</p>
      {serviceNumbers.length || serviceDescriptions.length ? (
        <div className="mt-1 text-xs">
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
                <p className="text-[11px] opacity-70">
                  +{serviceDescriptionExtra} más
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm font-medium">—</p>
      )}
    </div>
  );

  /* ====== UI ====== */
  return (
    <div className="h-fit rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur transition-[transform,box-shadow] hover:scale-[0.999] dark:text-white">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-sky-950/70 dark:text-white/70">
              Recibo{" "}
              <span className="font-medium">N° {receiptDisplayNumber}</span>
            </p>
            {receipt.payment_method ? (
              <Chip tone="brand" title="Método de pago">
                {receipt.payment_method}
              </Chip>
            ) : null}
          </div>
          <p className="text-sm opacity-80">{clientsStr}</p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <time
            className="text-xs text-sky-950/70 dark:text-white/70"
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
        <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
          <p className="text-xs opacity-70">Concepto</p>
          <p className="mt-1 text-sm">{receipt.concept}</p>
        </div>
      </section>

      {/* Footer acciones */}
      <footer className="mt-6 flex flex-wrap justify-end gap-2">
        <IconButton
          onClick={downloadPDF}
          disabled={loadingPDF}
          loading={loadingPDF}
          label="Descargar PDF"
          tone="sky"
          aria-label="Descargar PDF del recibo"
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

        {onReceiptEdit && (
          <IconButton
            onClick={() => onReceiptEdit(receipt)}
            disabled={loadingDelete || loadingPDF || loadingDuplicate}
            label="Editar"
            tone="sky"
            aria-label="Editar recibo"
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

        {(onReceiptEdit || onReceiptDuplicated) && (
          <IconButton
            onClick={duplicateReceipt}
            disabled={loadingDelete || loadingPDF || loadingDuplicate}
            loading={loadingDuplicate}
            label="Duplicar"
            tone="emerald"
            aria-label="Duplicar recibo"
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
                d="M8.25 7.5H6A2.25 2.25 0 0 0 3.75 9.75V18A2.25 2.25 0 0 0 6 20.25h8.25A2.25 2.25 0 0 0 16.5 18v-2.25M9.75 3.75H18A2.25 2.25 0 0 1 20.25 6v8.25A2.25 2.25 0 0 1 18 16.5H9.75A2.25 2.25 0 0 1 7.5 14.25V6A2.25 2.25 0 0 1 9.75 3.75Z"
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
            disabled={loadingDelete || loadingPDF || loadingDuplicate}
            loading={loadingDelete}
            label="Eliminar"
            tone="rose"
            aria-label="Eliminar recibo"
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
