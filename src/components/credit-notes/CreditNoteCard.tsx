// src/components/credit-notes/CreditNoteCard.tsx
"use client";
import type { CreditNoteWithItems } from "@/services/creditNotes";
import type { Prisma } from "@prisma/client";
import { toast } from "react-toastify";
import Spinner from "@/components/Spinner";
import { useMemo, useState } from "react";
import { formatDateOnlyInBuenosAires } from "@/lib/buenosAiresDate";

/* ======================== Utils (idénticos a InvoiceCard) ======================== */
const normCurrency = (curr?: string | null) => {
  const c = (curr || "").toUpperCase();
  if (["USD", "DOL", "U$S", "US$"].includes(c)) return "USD";
  return "ARS";
};

const fmtMoney = (v?: number, curr?: string | null) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: normCurrency(curr),
  }).format(v ?? 0);

const slugify = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const fmtCbteDate = (raw: number | string | Date) => {
  if (raw instanceof Date) return formatDateOnlyInBuenosAires(raw);
  const s = String(raw);
  if (/^\d{8}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    return formatDateOnlyInBuenosAires(`${y}-${m}-${d}`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return formatDateOnlyInBuenosAires(s);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : formatDateOnlyInBuenosAires(d);
};

/* ======================== Chips (mismos estilos que InvoiceCard) ======================== */
const TipoChip: React.FC<{ tipo?: number }> = ({ tipo }) => {
  // 3 = NC A, 8 = NC B
  const label =
    tipo === 3
      ? "Nota de Credito A"
      : tipo === 8
        ? "Nota de Credito B"
        : "Nota de Credito";
  return (
    <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-900 dark:border-sky-800/40 dark:bg-sky-900/30 dark:text-sky-100">
      {label}
    </span>
  );
};

const CurrencyChip: React.FC<{ currency?: string | null }> = ({ currency }) => (
  <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-900 dark:border-sky-800/40 dark:bg-sky-900/30 dark:text-sky-100">
    {normCurrency(currency) === "ARS" ? "Pesos" : "Dólares"}
  </span>
);

const cardActionTrackClass =
  "grid grid-cols-[20px_0fr] items-center gap-0 overflow-hidden transition-[grid-template-columns,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:grid-cols-[20px_1fr] group-hover/btn:gap-2 group-focus-visible/btn:grid-cols-[20px_1fr] group-focus-visible/btn:gap-2";

const cardActionTextClass =
  "min-w-0 translate-x-2 whitespace-nowrap text-sm opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:translate-x-0 group-hover/btn:opacity-100 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:opacity-100";

const cardActionBtnSky =
  "group/btn rounded-full border border-sky-500/35 bg-sky-500/5 px-3 py-2 text-sky-900 shadow-sm shadow-sky-950/15 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-95 hover:bg-sky-500/10 active:scale-90 disabled:cursor-not-allowed disabled:opacity-60 dark:text-sky-100";

/* ======================== Tipos ======================== */
type VoucherMinimal = {
  CbteFch: number | string | Date;
  Iva?: { Id: number; BaseImp: number; Importe: number }[];
  ImpNeto?: number;
  ImpIVA?: number;
  recipient?: string;
  CbteTipo?: number; // para el chip
};

interface CreditNoteCardProps {
  creditNote: CreditNoteWithItems;
}

/* ======================== Componente ======================== */
export default function CreditNoteCard({ creditNote }: CreditNoteCardProps) {
  const [loading, setLoading] = useState(false);

  // payload puede venir "flat"
  const raw = creditNote.payloadAfip as Prisma.JsonObject | null;
  const voucher = raw as unknown as VoucherMinimal | undefined;

  // bases por alícuota (igual que InvoiceCard)
  const bases = useMemo(() => {
    const Iva = voucher?.Iva ?? [];
    let base21 = 0,
      base105 = 0,
      exento = 0;
    Iva.forEach(({ Id, BaseImp, Importe }) => {
      if (Id === 5) base21 += BaseImp + Importe;
      else if (Id === 4) base105 += BaseImp + Importe;
      else exento += BaseImp;
    });
    return { base21, base105, exento };
  }, [voucher]);

  const emitDate = voucher?.CbteFch ? fmtCbteDate(voucher.CbteFch) : "";

  const onDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/credit-notes/${creditNote.public_id ?? creditNote.id_credit_note}/pdf`,
        { headers: { Accept: "application/pdf" } },
      );
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const name = creditNote.recipient
        ? slugify(creditNote.recipient)
        : `nc_${creditNote.id_credit_note}`;

      link.download = `NotaCredito_${name}_${creditNote.id_credit_note}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success("Nota de crédito descargada exitosamente.");
    } catch {
      toast.error("No se pudo descargar la nota de crédito.");
    } finally {
      setLoading(false);
    }
  };

  /* -------- Fallback SIN payload AFIP (estructura + estilos iguales) -------- */
  if (!voucher) {
    return (
      <div className="group h-fit space-y-3 rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md backdrop-blur transition-transform hover:scale-[0.999] dark:text-white">
        <header className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-sm text-sky-950/70 dark:text-white/70">
              ID {creditNote.id_credit_note}
            </p>
            <CurrencyChip currency={creditNote.currency} />
          </div>
        </header>

        <div className="rounded-2xl border border-white/10 bg-white/20 p-3 dark:bg-white/10">
          <p className="text-sm font-semibold">
            Nota de crédito N°{" "}
            <span className="font-light">{creditNote.credit_number}</span>
          </p>
          <p className="text-sm">
            Fecha{" "}
            <span className="font-light">
              {creditNote.issue_date
                ? formatDateOnlyInBuenosAires(creditNote.issue_date)
                : "–"}
            </span>
          </p>
          <p className="mt-2 text-[13px] font-medium text-red-600 dark:text-red-400">
            Sin datos AFIP
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onDownload}
            disabled={loading}
            className={cardActionBtnSky}
          >
            {loading ? (
              <Spinner />
            ) : (
              <span className={cardActionTrackClass}>
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
                <span className={cardActionTextClass}>Descargar</span>
              </span>
            )}
          </button>
        </div>
      </div>
    );
  }

  /* -------- CON payload AFIP (layout espejado al de InvoiceCard) -------- */
  return (
    <div className="group h-fit rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur transition-transform hover:scale-[0.999] dark:text-white">
      {/* Header */}
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm text-sky-950/70 dark:text-white/70">
              ID {creditNote.id_credit_note}
            </p>
          </div>
          <p className="text-[15px]">
            Nota de crédito N°{" "}
            <span className="font-medium">{creditNote.credit_number}</span>
          </p>
          <p className="text-sm opacity-80">
            {creditNote.recipient} – Factura ID {creditNote.invoiceId}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <time className="text-xs text-sky-950/70 dark:text-white/70">
            {emitDate}
          </time>
        </div>
      </header>

      {/* Fila de chips (igual ubicación/estilos) */}
      <div className="mb-4 flex w-full justify-end gap-2">
        <TipoChip tipo={voucher.CbteTipo} />
        <CurrencyChip currency={creditNote.currency} />
      </div>

      {/* Totales en “cards” (misma grilla/sombras) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
          <p className="text-xs opacity-70">Base 21%</p>
          <p className="text-sm font-medium tabular-nums">
            {fmtMoney(bases.base21, creditNote.currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
          <p className="text-xs opacity-70">Base 10,5%</p>
          <p className="text-sm font-medium tabular-nums">
            {fmtMoney(bases.base105, creditNote.currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
          <p className="text-xs opacity-70">Exento</p>
          <p className="text-sm font-medium tabular-nums">
            {fmtMoney(bases.exento, creditNote.currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
          <p className="text-xs opacity-70">Neto</p>
          <p className="text-sm font-medium tabular-nums">
            {fmtMoney(voucher.ImpNeto ?? 0, creditNote.currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/20 p-3 shadow-sm shadow-sky-950/10 dark:bg-white/10">
          <p className="text-xs opacity-70">IVA</p>
          <p className="text-sm font-medium tabular-nums">
            {fmtMoney(voucher.ImpIVA ?? 0, creditNote.currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-sky-200/40 bg-sky-50/60 p-3 shadow-sm shadow-sky-950/10 dark:border-sky-400/10 dark:bg-sky-400/10">
          <p className="text-xs opacity-70">Total</p>
          <p className="text-base font-semibold tabular-nums">
            {fmtMoney(creditNote.total_amount, creditNote.currency)}
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          onClick={onDownload}
          disabled={loading}
          aria-label="Descargar PDF de la nota de crédito"
          className={cardActionBtnSky}
        >
          {loading ? (
            <Spinner />
          ) : (
            <span className={cardActionTrackClass}>
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
              <span className={cardActionTextClass}>Descargar PDF</span>
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
