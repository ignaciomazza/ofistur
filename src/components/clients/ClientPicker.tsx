// src/components/clients/ClientPicker.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useId } from "react";
import type { Client } from "@/types";
import Spinner from "@/components/Spinner";
import { authFetch } from "@/utils/authFetch";

type Props = {
  token?: string | null;
  label?: string;
  placeholder?: string;
  valueId: number | null; // id del pax seleccionado (si hay)
  onSelect: (client: Client) => void; // cuando eligen un pax
  onClear?: () => void;
  excludeIds?: number[]; // ids que no se pueden seleccionar (p.ej. titular o duplicados)
  disabled?: boolean;
  required?: boolean;
  compact?: boolean;
  hideSelectedSummary?: boolean;
};

export default function ClientPicker({
  token,
  label,
  placeholder = "Buscar por Nº interno, DNI, Pasaporte, CUIT o nombre...",
  valueId,
  onSelect,
  onClear,
  excludeIds = [],
  disabled,
  required,
  compact = false,
  hideSelectedSummary = false,
}: Props) {
  const [term, setTerm] = useState<string>("");
  const [results, setResults] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const excludeIdsSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  // Para accesibilidad del listbox
  const listboxId = useId();

  // Cargar el pax actual si tenemos un id (modo edición) por ID exacto
  useEffect(() => {
    if (!valueId) {
      setSelected(null);
      setTerm("");
      return;
    }
    if (selected?.id_client === valueId) return;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    (async () => {
      try {
        setLoading(true);

        // 1) Intento exacto por ID
        const byId = await authFetch(
          `/api/clients/${valueId}`,
          { signal: controller.signal, cache: "no-store" },
          token ?? null,
        );

        if (byId.ok) {
          const c = (await byId.json()) as Client;
          if (c?.id_client === valueId) {
            setSelected(c);
            setTerm(displayClient(c));
            return;
          }
        }

        // 2) Fallback: búsqueda y match por id_client
        const res = await authFetch(
          `/api/clients?q=${encodeURIComponent(String(valueId))}&take=8&for=booking`,
          { signal: controller.signal },
          token ?? null,
        );
        if (!res.ok) return;

        const data = await res.json();
        const items: Client[] = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
            ? data
            : [];

        const c = items.find((x) => x.id_client === valueId);
        if (c) {
          setSelected(c);
          setTerm(displayClient(c));
        }
      } catch {
        // ignore
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueId, token]);

  // Debounce del término
  const [debouncedTerm, setDebouncedTerm] = useState(term);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(term), 300);
    return () => clearTimeout(t);
  }, [term]);

  // Buscar sugerencias cuando cambia el término
  useEffect(() => {
    const q = debouncedTerm.trim();
    if (!q || selected?.id_client === valueId) {
      if (results.length > 0) setResults([]);
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    (async () => {
      try {
        setLoading(true);
        const res = await authFetch(
          `/api/clients?q=${encodeURIComponent(q)}&take=8&for=booking`,
          { signal: controller.signal },
          token ?? null,
        );
        if (!res.ok) return;

        const data = await res.json();
        const items: Client[] = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
            ? data
            : [];

        const filtered = items.filter((c) => !excludeIdsSet.has(c.id_client));
        setResults(filtered);
        setOpen(true);
      } catch {
        // ignore
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [debouncedTerm, token, excludeIdsSet, selected, valueId, results.length]);

  // Seleccionar un pax
  const pick = (c: Client) => {
    setSelected(c);
    setTerm(displayClient(c));
    setOpen(false);
    setResults([]);
    onSelect(c);
  };

  // Limpiar selección
  const clear = () => {
    setSelected(null);
    setTerm("");
    setOpen(false);
    setResults([]);
    onClear?.();
  };

  const inputBase = compact
    ? "w-full appearance-none rounded-xl border border-sky-200 bg-white/50 p-2 px-3 text-sm outline-none shadow-sm shadow-sky-950/10 backdrop-blur placeholder:font-light placeholder:tracking-wide dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white"
    : "w-full appearance-none rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 outline-none shadow-sm shadow-sky-950/10 backdrop-blur placeholder:font-light placeholder:tracking-wide dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";

  return (
    <div className="relative">
      {label && <label className="mb-1 ml-2 block font-medium">{label}</label>}

      <div className="flex items-center gap-2">
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setSelected(null);
            setOpen(true);
          }}
          onFocus={() => term && setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className={inputBase}
          required={required && !selected}
        />
        {loading && (
          <div className="w-10">
            <Spinner />
          </div>
        )}
        {(selected || term) && !disabled && (
          <button
            type="button"
            onClick={clear}
            className={
              compact
                ? "rounded-xl bg-sky-100 px-3 py-2 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
                : "rounded-2xl bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
            }
            title="Limpiar selección"
          >
            {compact ? "Limpiar" : "Limpiar"}
          </button>
        )}
      </div>

      {/* Sugerencias */}
      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="mt-2 w-full appearance-none rounded-2xl border border-sky-950/10 p-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
        >
          {results.map((c) => {
            const clientNumber = formatAgencyClientNumber(c.agency_client_id);
            return (
              <li
                key={c.id_client}
                role="option"
                aria-selected={selected?.id_client === c.id_client}
                className="cursor-pointer rounded-xl px-3 py-2 hover:bg-white/30 dark:hover:bg-white/10"
                onClick={() => pick(c)}
              >
                <div className="flex justify-between">
                  <span className="font-medium">
                    {c.first_name} {c.last_name}
                  </span>
                  <span className="opacity-70">Nº {clientNumber}</span>
                </div>
                <div className="text-xs opacity-80">{compactIdentity(c)}</div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Resumen del seleccionado */}
      {selected && !hideSelectedSummary && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/10 p-2 px-3 text-sm dark:text-white">
          <div className="flex justify-between">
            <span className="font-semibold">
              {selected.first_name} {selected.last_name}
            </span>
            <span className="opacity-70">
              Nº {formatAgencyClientNumber(selected.agency_client_id)}
            </span>
          </div>
          <div className="mt-1 text-xs opacity-80">
            {fullIdentity(selected)}
          </div>
        </div>
      )}
    </div>
  );
}

function displayClient(c: Client) {
  const clientNumber = formatAgencyClientNumber(c.agency_client_id);
  return `${c.first_name ?? ""} ${c.last_name ?? ""} — Nº ${clientNumber}`;
}

function formatAgencyClientNumber(value: number | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  return "Sin Nº";
}

function compactIdentity(c: Client) {
  const parts = [
    c.dni_number && `DNI ${c.dni_number}`,
    c.passport_number && `Pasaporte ${c.passport_number}`,
    c.tax_id && `CUIT ${c.tax_id}`,
    c.email,
  ].filter(Boolean) as string[];
  return parts.join(" · ");
}

function fullIdentity(c: Client) {
  const parts = [
    c.dni_number && `DNI: ${c.dni_number}`,
    c.passport_number && `Pasaporte: ${c.passport_number}`,
    c.tax_id && `CUIT: ${c.tax_id}`,
    c.email && `Email: ${c.email}`,
  ].filter(Boolean) as string[];
  return parts.join(" — ");
}
