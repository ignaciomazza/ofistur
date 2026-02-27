// src/components/receipts/receipt-form/ContextSection.tsx
"use client";

import React from "react";
import Spinner from "@/components/Spinner";
import type { BookingOption, ServiceLite } from "@/types/receipts";
import { Field, Section, inputBase, pillBase, pillNeutral, pillOk } from "./primitives";

type Mode = "agency" | "booking";
type Action = "create" | "attach";

export default function ContextSection(props: {
  attachEnabled: boolean;
  action: Action;
  setAction: (a: Action) => void;
  hideContext?: boolean;

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
  serviceSelectionMode: "required" | "optional" | "booking";
  selectedServiceIds: number[];
  effectiveServiceIds: number[];
  toggleService: (svc: ServiceLite) => void;

  lockedCurrency: string | null;
  effectiveCurrency: string;

  errors: Record<string, string>;
  formatNum: (n: number, cur?: string) => string;
}) {
  const {
    attachEnabled,
    action,
    setAction,
    hideContext = false,

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
    serviceSelectionMode,
    selectedServiceIds,
    effectiveServiceIds,
    toggleService,

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
            <div className="inline-flex rounded-2xl border border-white/10 bg-white/60 p-1 shadow-sm shadow-sky-950/10 dark:bg-white/10">
              <button
                type="button"
                onClick={() => setAction("create")}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                  action === "create"
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-200"
                    : "text-sky-950/80 hover:bg-white/60 dark:text-white/80",
                ].join(" ")}
              >
                Crear nuevo
              </button>
              <button
                type="button"
                onClick={() => setAction("attach")}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                  action === "attach"
                    ? "bg-sky-500/15 text-sky-700 dark:text-sky-200"
                    : "text-sky-950/80 hover:bg-white/60 dark:text-white/80",
                ].join(" ")}
              >
                Asociar existente
              </button>
            </div>
          </div>
        </Section>
      )}

      {!hideContext && (
        <Section
          title="Contexto"
          desc={
            action === "attach"
              ? serviceSelectionMode === "booking"
                ? "Elegí la reserva. Los servicios se asociarán automáticamente por configuración."
                : "Elegí la reserva y los servicios a los que querés asociar el recibo."
              : serviceSelectionMode === "booking"
                ? "Podés asociarlo a una reserva. Los servicios se tomarán automáticamente."
                : "Podés asociarlo a una reserva y elegir servicios, o crearlo como recibo de agencia."
          }
        >
          {canToggleAgency && (
            <div className="md:col-span-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-white/30 bg-white/30 text-sky-600 shadow-sm shadow-sky-950/10 dark:border-white/20 dark:bg-white/10"
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
                <div className="rounded-xl border border-white/10 bg-white/10 p-3 text-sm md:col-span-2">
                  ID de reserva:{" "}
                  <span className="font-semibold">N° {bookingId}</span>{" "}
                  <span className="ml-2 rounded-full bg-white/30 px-2 py-0.5 text-xs">
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
                      <div className="max-h-56 overflow-auto rounded-2xl border border-white/10">
                        {bookingOptions.map((opt) => {
                          const active = selectedBookingId === opt.id_booking;
                          return (
                            <button
                              key={opt.id_booking}
                              type="button"
                              className={`w-full px-3 py-2 text-left transition hover:bg-white/5 ${
                                active ? "bg-white/10" : ""
                              }`}
                              onClick={() => setSelectedBookingId(opt.id_booking)}
                            >
                              <div className="text-sm font-medium">{opt.label}</div>
                              {opt.subtitle && (
                                <div className="text-xs text-sky-950/70 dark:text-white/70">
                                  {opt.subtitle}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : bookingQuery && bookingQuery.length >= 2 ? (
                      <p className="text-sm text-sky-950/70 dark:text-white/70">Sin resultados.</p>
                    ) : null}

                    {errors.booking && <p className="mt-1 text-xs text-red-600">{errors.booking}</p>}
                  </div>
                </>
              )}

              {selectedBookingId && (
                <div className="md:col-span-2">
                  <label className="mb-1 ml-1 block text-sm font-medium text-sky-950 dark:text-white">
                    Servicios de la reserva
                  </label>

                  {loadingServices ? (
                    <div className="py-2">
                      <Spinner />
                    </div>
                  ) : services.length === 0 ? (
                    <p className="text-sm text-sky-950/70 dark:text-white/70">
                      No hay servicios para esta reserva.
                    </p>
                  ) : serviceSelectionMode === "booking" ? (
                    <div className="rounded-2xl border border-white/10 bg-white/10 p-3 text-sm text-sky-950/80 dark:text-white/80">
                      Por configuración de la agencia, este recibo se aplica a{" "}
                      <b>todos los servicios</b> de la reserva (
                      {services.length} en total).
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {services.map((svc) => {
                        const checked = selectedServiceIds.includes(svc.id_service);

                        return (
                          <label
                            key={svc.id_service}
                            className={`flex items-start gap-3 rounded-2xl border px-3 py-2 ${
                              checked ? "border-white/20 bg-white/10" : "border-white/10"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4"
                              checked={checked}
                              onChange={() => toggleService(svc)}
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                N° {svc.agency_service_id ?? "—"}{" "}
                                {svc.type
                                  ? `· ${svc.type}`
                                  : svc.description || "Servicio"}
                                {svc.destination ? ` · ${svc.destination}` : ""}
                              </div>
                              <div className="text-xs text-sky-950/70 dark:text-white/70">
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
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {serviceSelectionMode === "optional" &&
                    services.length > 0 &&
                    selectedServiceIds.length === 0 && (
                      <p className="mt-2 text-xs text-sky-950/70 dark:text-white/70">
                        Sin selección manual, el recibo se aplicará a todos los
                        servicios de la reserva.
                      </p>
                    )}

                  <div className="mt-2">
                    <span className={`${pillBase} ${pillNeutral}`}>
                      Servicios aplicados: {effectiveServiceIds.length}
                    </span>
                    <span className={`${pillBase} ${lockedCurrency ? pillOk : pillNeutral}`}>
                      Moneda {lockedCurrency ? `${lockedCurrency} (lock)` : "libre"}
                    </span>
                    {!!effectiveCurrency && !lockedCurrency && (
                      <span className={`${pillBase} ${pillNeutral} ml-2`}>
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
      )}
    </>
  );
}
