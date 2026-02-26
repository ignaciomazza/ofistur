// src/components/template-config/sections/PaymentSection.tsx

"use client";
import React, { useEffect, useState } from "react";
import {
  getAt,
  setAt,
  section,
  input,
  asStringArray,
  isObject,
} from "./_helpers";
import { Config } from "../types";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";

type UiMode = "default" | "sales";

type Props = {
  cfg: Config;
  disabled: boolean;
  onChange: (next: Config) => void;
  uiMode?: UiMode;
};

type AgencyLite = { id?: number; id_agency?: number } & Record<string, unknown>;

const PaymentSection: React.FC<Props> = ({
  cfg,
  disabled,
  onChange,
  uiMode = "default",
}) => {
  const isSalesUi = uiMode === "sales";
  const paymentOptions = asStringArray(getAt(cfg, ["paymentOptions"], []));
  const selectedIndex =
    getAt<number | null>(cfg, ["payment", "selectedIndex"], null) ?? null;

  const mupuStyle = (getAt(cfg, ["payment", "mupuStyle"], {}) || {}) as {
    color?: string;
  };

  const setMupuStyle = (patch: Partial<typeof mupuStyle>) =>
    onChange(
      setAt(cfg, ["payment", "mupuStyle"], { ...(mupuStyle || {}), ...patch }),
    );

  const { token } = useAuth();
  const [isMupuAgency, setIsMupuAgency] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!token) return;
    (async () => {
      try {
        const res = await authFetch(
          "/api/agency",
          { cache: "no-store" },
          token,
        );
        const data = (await res.json().catch(() => ({}))) as unknown;
        const ag = isObject(data) ? (data as AgencyLite) : {};
        const agencyId =
          (typeof ag.id === "number" ? ag.id : ag.id_agency) ?? null;
        if (mounted) setIsMupuAgency(agencyId === 1);
      } catch {
        if (mounted) setIsMupuAgency(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token]);

  const addPayment = () =>
    onChange(
      setAt(
        cfg,
        ["paymentOptions"],
        [...paymentOptions, "Instrucciones de pago"],
      ),
    );

  const updatePayment = (idx: number, value: string) =>
    onChange(
      setAt(
        cfg,
        ["paymentOptions"],
        paymentOptions.map((v, i) => (i === idx ? value : v)),
      ),
    );

  const removePayment = (idx: number) => {
    let nextSelected: number | null = selectedIndex;
    if (selectedIndex !== null) {
      if (selectedIndex === idx) nextSelected = null;
      else if (selectedIndex > idx) nextSelected = selectedIndex - 1;
    }
    let next = setAt(
      cfg,
      ["paymentOptions"],
      paymentOptions.filter((_, i) => i !== idx),
    );
    next = setAt(next, ["payment", "selectedIndex"], nextSelected);
    onChange(next);
  };

  const selectForPreview = (idx: number | null) =>
    onChange(setAt(cfg, ["payment", "selectedIndex"], idx));

  return (
    <section className={section}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="inline-flex size-8 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-700 shadow-sm shadow-amber-900/10 dark:border-amber-400/20 dark:text-amber-300">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5Z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12h3.75" />
              </svg>
            </span>
            Opciones de pago
          </h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Definí cómo se muestran los medios de cobro en el PDF.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-sky-300/55 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-900 dark:border-sky-200/25 dark:text-sky-100">
            {paymentOptions.length} opciones
          </span>
          <button
            type="button"
            onClick={addPayment}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/45 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-200/30 dark:text-emerald-100"
            title="Agregar opción de pago"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Agregar
          </button>
        </div>
      </div>

      {paymentOptions.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/10 p-5 text-sm text-slate-600 shadow-sm shadow-sky-950/10 dark:text-slate-300">
          Aún no hay opciones de pago configuradas.
        </div>
      ) : (
        <div className={isSalesUi ? "space-y-3" : "space-y-2.5"}>
          {paymentOptions.map((option, idx) => {
            const active = selectedIndex === idx;
            return (
              <article
                key={idx}
                className={[
                  "rounded-2xl border bg-white/10 p-4 shadow-sm shadow-sky-950/10",
                  active
                    ? "border-emerald-400/60 ring-2 ring-emerald-300/40"
                    : "border-white/10",
                ].join(" ")}
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_1fr_auto] md:items-start">
                  <button
                    type="button"
                    onClick={() => selectForPreview(active ? null : idx)}
                    disabled={disabled}
                    className={[
                      "inline-flex size-9 items-center justify-center rounded-xl border transition",
                      active
                        ? "border-emerald-400/55 bg-emerald-500/15 text-emerald-800 dark:text-emerald-100"
                        : "border-white/15 bg-white/10 text-slate-600 dark:text-slate-200",
                    ].join(" ")}
                    title={active ? "Quitar de la vista previa" : "Usar en vista previa"}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.7}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m9 12.75 2.25 2.25L15 9.75" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  </button>

                  <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                    Texto visible
                    <textarea
                      className={`${input} mt-1 min-h-20 resize-y normal-case tracking-normal`}
                      value={option}
                      onChange={(e) => updatePayment(idx, e.target.value)}
                      disabled={disabled}
                      placeholder="Ej: Transferencia ARS - Alias ..."
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => removePayment(idx)}
                    disabled={disabled}
                    className="inline-flex size-9 items-center justify-center rounded-xl border border-rose-400/45 bg-rose-500/10 text-rose-700 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-200"
                    title="Eliminar opción"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.7}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79" />
                    </svg>
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <input
                      type="radio"
                      name="paymentPreview"
                      checked={active}
                      onChange={() => selectForPreview(idx)}
                      disabled={disabled}
                    />
                    Mostrar en vista previa
                  </label>
                  {active ? (
                    <span className="inline-flex items-center rounded-full border border-emerald-300/55 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-800 dark:border-emerald-200/30 dark:text-emerald-100">
                      Seleccionada
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2 py-0.5 font-medium text-slate-500 dark:text-slate-300">
                      Inactiva
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => selectForPreview(null)}
          disabled={disabled || selectedIndex === null}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-100"
          title="Quitar selección de vista previa"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
          Limpiar selección
        </button>
      </div>

      {isMupuAgency ? (
        <details className="mt-4 rounded-2xl border border-emerald-500/20 bg-white/10 p-4 shadow-sm shadow-sky-950/10">
          <summary className="cursor-pointer select-none text-sm font-medium text-emerald-800 dark:text-emerald-300">
            Mupu - Color del texto de opción seleccionada
          </summary>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[auto_1fr_auto] md:items-end">
            <label className="text-sm">
              Color
              <input
                type="color"
                className="mt-1 h-10 w-12 cursor-pointer rounded-2xl border border-white/15 bg-white/10 p-1"
                value={mupuStyle.color ?? "#1F2937"}
                onChange={(e) => setMupuStyle({ color: e.target.value })}
                disabled={disabled}
                title="Elegí un color"
              />
            </label>

            <label className="text-sm">
              Valor manual
              <input
                className={`${input} mt-1`}
                value={mupuStyle.color ?? ""}
                onChange={(e) =>
                  setMupuStyle({
                    color: e.target.value || undefined,
                  })
                }
                placeholder="#1F2937 o rgba(...)"
                disabled={disabled}
              />
            </label>

            <button
              type="button"
              onClick={() =>
                setMupuStyle({
                  color: undefined,
                })
              }
              disabled={disabled}
              className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-slate-700 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-100"
              title="Volver a heredar"
            >
              Restablecer
            </button>
          </div>
        </details>
      ) : null}
    </section>
  );
};

export default PaymentSection;
