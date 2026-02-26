// src/components/receipts/receipt-form/ReceiptHeader.tsx
"use client";

import React from "react";
import { pillBase, pillNeutral, pillOk } from "./primitives";

type Mode = "agency" | "booking";
type Action = "create" | "attach";

export default function GroupReceiptHeader(props: {
  visible: boolean;
  onToggle: () => void;

  editingReceiptId: number | null;
  action: Action;
  mode: Mode;

  selectedBookingDisplayId: number | null;
  selectedServiceCount: number;
  effectiveCurrency: string;
  lockedCurrency: string | null;
}) {
  const {
    visible,
    onToggle,
    editingReceiptId,
    action,
    mode,
    selectedBookingDisplayId,
    selectedServiceCount,
    effectiveCurrency,
    lockedCurrency,
  } = props;

  const title = editingReceiptId
    ? "Editar recibo"
    : action === "attach"
      ? "Asociar recibo existente"
      : "Agregar recibo";

  return (
    <div
      className={`sticky top-0 z-10 ${
        visible ? "rounded-t-3xl border-b" : ""
      } border-sky-200/70 bg-white/65 px-5 py-4 backdrop-blur-sm dark:border-sky-900/40 dark:bg-slate-900/50 md:px-6`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={visible}
      >
        <div className="flex items-center gap-3.5">
          <div className="grid size-9 place-items-center rounded-full border border-sky-300/70 bg-sky-100/80 text-sky-900 shadow-sm shadow-sky-100/70 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-100">
            {visible ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 12h14"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            )}
          </div>

          <div>
            <p className="text-base font-semibold leading-tight text-slate-900 dark:text-slate-100 md:text-lg">
              {title}
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 md:text-xs">
              {mode === "booking" ? "Reserva vinculada" : "Operación de agencia"}
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <span
            className={`${pillBase} ${action === "attach" ? pillOk : pillNeutral}`}
          >
            {action === "attach" ? "Asociar existente" : "Crear nuevo"}
          </span>

          <span className={`${pillBase} ${mode === "booking" ? pillOk : pillNeutral}`}>
            {mode === "booking" ? "Con reserva" : "Agencia"}
          </span>

          {mode === "booking" && selectedBookingDisplayId && (
            <span className={`${pillBase} ${pillNeutral}`}>
              Reserva N° {selectedBookingDisplayId}
            </span>
          )}

          {selectedServiceCount > 0 && (
            <span className={`${pillBase} ${pillOk}`}>Svcs: {selectedServiceCount}</span>
          )}

          {!!effectiveCurrency && lockedCurrency && lockedCurrency !== effectiveCurrency ? (
            <>
              <span className={`${pillBase} ${pillOk}`}>
                Servicio: {lockedCurrency} (lock)
              </span>
              <span className={`${pillBase} ${pillNeutral}`}>
                Cobro: {effectiveCurrency}
              </span>
            </>
          ) : (
            !!effectiveCurrency && (
              <span
                className={`${pillBase} ${lockedCurrency ? pillOk : pillNeutral}`}
              >
                {effectiveCurrency} {lockedCurrency ? "(lock)" : ""}
              </span>
            )
          )}
        </div>
      </button>
    </div>
  );
}
