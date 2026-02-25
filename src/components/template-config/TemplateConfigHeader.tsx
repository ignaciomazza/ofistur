// src/components/template-config/TemplateConfigHeader.tsx
"use client";

import React from "react";
import Spinner from "@/components/Spinner";

export type TemplateMeta = {
  id_template: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type Props = {
  docType: string;
  exists: boolean;
  meta: TemplateMeta;
  resolvedView: boolean;
  disabled: boolean;
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  onToggleResolved: (v: boolean) => void;
  onSave: () => void;
  onDelete: () => void;
  onResetDefaults: () => void;
};

const chip = (ok: boolean) =>
  ok
    ? "inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-700 shadow-sm shadow-emerald-900/10 backdrop-blur dark:text-emerald-300"
    : "inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm text-amber-700 shadow-sm shadow-amber-900/10 backdrop-blur dark:text-amber-300";

const metaItem =
  "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-600 shadow-sm shadow-sky-950/10 backdrop-blur dark:text-slate-200";

const TemplateConfigHeader: React.FC<Props> = ({
  docType,
  exists,
  meta,
  resolvedView,
  disabled,
  loading,
  saving,
  deleting,
  onToggleResolved,
  onSave,
  onDelete,
  onResetDefaults,
}) => {
  return (
    <div className="mb-6 rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-700 shadow-sm shadow-amber-900/10 dark:border-amber-400/20 dark:text-amber-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 6h9.75M3.75 6h3M10.5 12h9.75M3.75 12h3M10.5 18h9.75M3.75 18h3"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 6a.75.75 0 11-1.5 0 .75.75 0 011.5 0Zm0 6a.75.75 0 11-1.5 0 .75.75 0 011.5 0Zm0 6a.75.75 0 11-1.5 0 .75.75 0 011.5 0Z"
              />
            </svg>
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Configuración</h1>
            <p className="text-sm text-slate-500 dark:text-slate-300">
              {docType === "quote"
                ? "Cotización"
                : docType === "quote_budget"
                  ? "Presupuesto de cotización"
                : docType === "confirmation"
                  ? "Confirmación manual"
                  : docType === "voucher"
                    ? "Confirmación"
                    : "Sin tipo de documento"}
            </p>
          </div>
        </div>

        {!loading && (
          <span className={chip(exists)}>
            {exists ? (
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75l2.25 2.25L15 9.75"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21a9 9 0 100-18 9 9 0 000 18z"
                />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m0 3h.008v.008H12v-.008z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.125 3.375h3.75L20.25 9.75v10.875a1.125 1.125 0 01-1.125 1.125H4.875A1.125 1.125 0 013.75 20.625V5.25A1.125 1.125 0 014.875 4.125h5.25z"
                />
              </svg>
            )}
            {exists ? "Configurado" : "Sin configurar"}
          </span>
        )}
      </div>

      {!loading && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={metaItem}>
            <svg
              viewBox="0 0 24 24"
              className="size-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 6.75h15m-15 5.25h9m-9 5.25h6"
              />
            </svg>
            ID: {meta.id_template ?? "-"}
          </span>
          <span className={metaItem}>
            <svg
              viewBox="0 0 24 24"
              className="size-4 text-emerald-500"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6l4 2"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 12a9 9 0 10-9 9"
              />
            </svg>
            Creado:{" "}
            {meta.created_at ? new Date(meta.created_at).toLocaleString() : "-"}
          </span>
          <span className={metaItem}>
            <svg
              viewBox="0 0 24 24"
              className="size-4 text-amber-500"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6l4 2"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 21a9 9 0 100-18 9 9 0 000 18z"
              />
            </svg>
            Actualizado:{" "}
            {meta.updated_at ? new Date(meta.updated_at).toLocaleString() : "-"}
          </span>

          <label className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-600 shadow-sm shadow-sky-950/5 dark:text-slate-200">
            <input
              type="checkbox"
              checked={resolvedView}
              onChange={(e) => onToggleResolved(e.target.checked)}
              disabled={loading}
            />
            <span className="inline-flex items-center gap-1">
              <svg
                viewBox="0 0 24 24"
                className="size-4 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12s3.75-7.5 9.75-7.5S21.75 12 21.75 12s-3.75 7.5-9.75 7.5S2.25 12 2.25 12z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
                />
              </svg>
              Ver defaults
            </span>
          </label>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          onClick={onSave}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-5 py-2 text-sm text-emerald-700 shadow-sm shadow-emerald-900/10 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:text-emerald-300"
        >
          {saving ? (
            <Spinner />
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75l2.25 2.25L15 9.75"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 21a9 9 0 100-18 9 9 0 000 18z"
              />
            </svg>
          )}
          Guardar
        </button>

        <button
          onClick={onDelete}
          disabled={disabled || !exists}
          className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2 text-sm text-red-100 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-red-800"
          title="Eliminar configuración"
        >
          {deleting ? (
            <Spinner />
          ) : (
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
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          )}
          Eliminar
        </button>

        <div className="mx-2 h-6 w-px bg-white/10" />

        <button
          onClick={onResetDefaults}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-2 text-sm text-amber-700 shadow-sm transition-transform hover:scale-95 active:scale-90 dark:text-amber-300"
          title="Usar valores sugeridos"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992m0 0v4.992m0-4.992l-4.992 4.992M7.977 14.652H3m0 0v-4.992m0 4.992l4.992-4.992"
            />
          </svg>
          Sugeridos
        </button>

        {loading && (
          <div className="ml-auto">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateConfigHeader;
