// src/components/receipts/receipt-form/ContextSection.tsx
"use client";

import React from "react";
import Spinner from "@/components/Spinner";
import type { BookingOption, ServiceLite } from "@/types/receipts";
import { Field, Section, inputBase, pillBase, pillNeutral, pillOk } from "./primitives";

type Mode = "agency" | "booking";
type Action = "create" | "attach";

export default function GroupContextSection(props: {
  attachEnabled: boolean;
  action: Action;
  setAction: (a: Action) => void;
  requireServiceSelection: boolean;

  canToggleAgency: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
  clearBookingContext: () => void;

  forcedBookingMode: boolean;
  bookingId?: number;

  bookingQuery: string;
  setBookingQuery: (v: string) => void;
  bookingOptions: BookingOption[];
  loadingBookings: boolean;

  selectedBookingId: number | null;
  setSelectedBookingId: (id: number | null) => void;

  services: ServiceLite[];
  loadingServices: boolean;
  selectedServiceIds: number[];
  toggleService: (svc: ServiceLite) => void;
  serviceDisabledReasons: Record<number, string>;

  lockedCurrency: string | null;
  effectiveCurrency: string;

  errors: Record<string, string>;
  formatNum: (n: number, cur?: string) => string;
}) {
  const {
    attachEnabled,
    action,
    setAction,
    requireServiceSelection,

    canToggleAgency,
    mode,
    setMode,
    clearBookingContext,

    forcedBookingMode,
    bookingId,

    bookingQuery,
    setBookingQuery,
    bookingOptions,
    loadingBookings,

    selectedBookingId,
    setSelectedBookingId,

    services,
    loadingServices,
    selectedServiceIds,
    toggleService,
    serviceDisabledReasons,

    lockedCurrency,
    effectiveCurrency,

    errors,
    formatNum,
  } = props;

  return (
    <>
      {attachEnabled && (
        <Section
          title="Modo"
          desc="Podés crear un recibo nuevo o asociar uno existente a una reserva/servicios."
        >
          <div className="md:col-span-2">
            <div className="inline-flex rounded-2xl border border-slate-300/80 bg-white/85 p-1 shadow-sm shadow-slate-900/10 dark:border-slate-600 dark:bg-slate-900/60">
              <button
                type="button"
                onClick={() => setAction("create")}
                className={[
                  "rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors md:text-sm",
                  action === "create"
                    ? "border border-sky-300/80 bg-sky-100/80 text-sky-900 dark:border-sky-700 dark:bg-sky-900/25 dark:text-sky-100"
                    : "text-slate-700 hover:bg-sky-50/45 dark:text-slate-200 dark:hover:bg-slate-800/70",
                ].join(" ")}
              >
                Crear nuevo
              </button>
              <button
                type="button"
                onClick={() => setAction("attach")}
                className={[
                  "rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors md:text-sm",
                  action === "attach"
                    ? "border border-sky-300/80 bg-sky-100/80 text-sky-900 dark:border-sky-700 dark:bg-sky-900/25 dark:text-sky-100"
                    : "text-slate-700 hover:bg-sky-50/45 dark:text-slate-200 dark:hover:bg-slate-800/70",
                ].join(" ")}
              >
                Asociar existente
              </button>
            </div>
          </div>
        </Section>
      )}

      <Section
        title="Contexto"
        desc={
          action === "attach"
            ? requireServiceSelection
              ? "Elegí la reserva y los servicios a los que querés asociar el recibo."
              : "Elegí la reserva y, si aplica, los servicios a los que querés asociar el recibo."
            : requireServiceSelection
              ? "Podés asociarlo a una reserva y elegir servicios, o crearlo como recibo de agencia."
              : "Podés asociarlo a una reserva y elegir servicios de forma opcional, o crearlo como recibo de agencia."
        }
      >
        {canToggleAgency && (
          <div className="md:col-span-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-slate-700 dark:text-slate-200 md:text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-slate-300 bg-white text-sky-600 shadow-sm shadow-slate-900/10 focus:ring-sky-300 dark:border-slate-600 dark:bg-slate-900"
                checked={mode === "booking"}
                onChange={(e) => {
                  const next = e.target.checked ? "booking" : "agency";
                  setMode(next);
                  if (next === "agency") clearBookingContext();
                }}
              />
              Asociar a una reserva ahora
            </label>
          </div>
        )}

        {mode === "booking" && (
          <>
            {forcedBookingMode ? (
              <div className="rounded-xl border border-sky-200/70 bg-sky-50/45 p-3 text-[13px] text-slate-700 dark:border-sky-900/40 dark:bg-slate-900/55 dark:text-slate-300 md:col-span-2 md:text-sm">
                ID de reserva: <span className="font-semibold">N° {bookingId}</span>{" "}
                <span className="ml-2 rounded-full border border-sky-200/70 bg-sky-50/60 px-2 py-0.5 text-[11px] dark:border-sky-900/40 dark:bg-slate-900/55 md:text-xs">
                  bloqueado
                </span>
              </div>
            ) : (
              <>
                <Field id="booking_search" label="Buscar reserva" hint="Por número o titular…">
                  <input
                    id="booking_search"
                    value={bookingQuery}
                    onChange={(e) => setBookingQuery(e.target.value)}
                    placeholder="Escribí al menos 2 caracteres"
                    className={inputBase}
                    autoComplete="off"
                  />
                </Field>

                <div className="md:col-span-2">
                  {loadingBookings ? (
                    <div className="py-2">
                      <Spinner />
                    </div>
                  ) : bookingOptions.length > 0 ? (
                    <div className="max-h-56 overflow-auto rounded-2xl border border-sky-200/70 bg-white/70 dark:border-sky-900/40 dark:bg-slate-900/50">
                      {bookingOptions.map((opt) => {
                        const active = selectedBookingId === opt.id_booking;
                        return (
                          <button
                            key={opt.id_booking}
                            type="button"
                            className={`w-full px-3 py-2 text-left transition ${
                              active
                                ? "bg-sky-100/70 text-slate-900 dark:bg-sky-900/25 dark:text-slate-100"
                                : "text-slate-700 hover:bg-sky-50/45 dark:text-slate-200 dark:hover:bg-slate-800/70"
                            }`}
                            onClick={() => setSelectedBookingId(opt.id_booking)}
                          >
                            <div className="text-[13px] font-medium md:text-sm">{opt.label}</div>
                            {opt.subtitle && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-400 md:text-xs">
                                {opt.subtitle}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : bookingQuery && bookingQuery.length >= 2 ? (
                    <p className="text-[13px] text-slate-600 dark:text-slate-400 md:text-sm">
                      Sin resultados.
                    </p>
                  ) : null}

                  {errors.booking && <p className="mt-1 text-xs text-red-600">{errors.booking}</p>}
                </div>
              </>
            )}

            {selectedBookingId && (
              <div className="md:col-span-2">
                <label className="mb-1 ml-1 block text-[13px] font-medium text-slate-900 dark:text-slate-100 md:text-sm">
                  Servicios de la reserva
                </label>

                {loadingServices ? (
                  <div className="py-2">
                    <Spinner />
                  </div>
                ) : services.length === 0 ? (
                  <p className="text-[13px] text-slate-600 dark:text-slate-400 md:text-sm">
                    {requireServiceSelection
                      ? "No hay servicios para esta reserva."
                      : "No hay servicios para esta reserva. Podés continuar igual."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {services.map((svc) => {
                      const checked = selectedServiceIds.includes(svc.id_service);
                      const currencyLocked =
                        !!lockedCurrency && svc.currency !== lockedCurrency && !checked;
                      const settledReason = serviceDisabledReasons[svc.id_service];
                      const settledLocked = !!settledReason && !checked;
                      const disabled = currencyLocked || settledLocked;

                      return (
                        <label
                          key={svc.id_service}
                          className={`flex items-start gap-3 rounded-2xl border px-3 py-2 ${
                            checked
                              ? "border-sky-300/80 bg-sky-100/70 text-slate-900 dark:border-sky-700 dark:bg-sky-900/25 dark:text-slate-100"
                              : "border-slate-300/80 bg-white/85 text-slate-700 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200"
                          } ${disabled ? "opacity-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 size-4"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleService(svc)}
                          />
                          <div className="flex-1">
                            <div className="text-[13px] font-medium md:text-sm">
                              N° {svc.agency_service_id ?? svc.id_service}{" "}
                              {svc.type
                                ? `· ${svc.type}`
                                : svc.description || "Servicio"}
                              {svc.destination ? ` · ${svc.destination}` : ""}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 md:text-xs">
                              Moneda: <b>{svc.currency}</b>
                              {typeof svc.sale_price === "number" && (
                                <>
                                  {" "}
                                  • Venta:{" "}
                                  {formatNum(
                                    (svc.sale_price ?? 0) + (svc.card_interest ?? 0),
                                    (svc.currency || "ARS").toUpperCase(),
                                  )}
                                </>
                              )}
                              {settledReason && (
                                <>
                                  {" "}
                                  •{" "}
                                  <span className="font-semibold text-rose-600 dark:text-rose-300">
                                    {settledReason}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`${pillBase} ${lockedCurrency ? pillOk : pillNeutral}`}>
                    Moneda {lockedCurrency ? `${lockedCurrency} (lock)` : "libre"}
                  </span>
                  {!!effectiveCurrency && !lockedCurrency && (
                    <span className={`${pillBase} ${pillNeutral}`}>
                      {effectiveCurrency}
                    </span>
                  )}
                </div>

                {errors.services && <p className="mt-1 text-xs text-red-600">{errors.services}</p>}
              </div>
            )}
          </>
        )}
      </Section>
    </>
  );
}
