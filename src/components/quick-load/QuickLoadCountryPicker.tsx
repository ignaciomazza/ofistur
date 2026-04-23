"use client";

import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/utils/authFetch";

type CountryOption = {
  id_country: number;
  name: string;
  iso2: string;
};

type QuickLoadCountryPickerProps = {
  token?: string | null;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export default function QuickLoadCountryPicker({
  token,
  value,
  onChange,
  placeholder = "Nacionalidad",
  disabled = false,
}: QuickLoadCountryPickerProps) {
  const [query, setQuery] = useState(value || "");
  const [debouncedQuery, setDebouncedQuery] = useState(value || "");
  const [results, setResults] = useState<CountryOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuery(value || "");
    setDebouncedQuery(value || "");
  }, [value]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 220);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
    };
  }, []);

  useEffect(() => {
    if (!token || !open || disabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (debouncedQuery.length > 0) params.set("q", debouncedQuery);
        params.set("take", "14");
        params.set("includeDisabled", "true");

        const res = await authFetch(
          `/api/countries?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("No se pudo obtener países");
        const json = await res.json();
        const items = Array.isArray(json?.items)
          ? (json.items as CountryOption[])
          : [];
        if (!controller.signal.aborted) setResults(items);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [token, debouncedQuery, open, disabled]);

  const pick = (country: CountryOption) => {
    const label = country.name;
    setQuery(label);
    onChange(label);
    setOpen(false);
  };

  const clear = () => {
    setQuery("");
    onChange("");
    setOpen(false);
    setResults([]);
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex w-full items-center gap-2 rounded-2xl border border-sky-300/45 bg-white/75 px-3 py-2 text-sm text-slate-900 shadow-sm shadow-sky-950/10 backdrop-blur dark:border-sky-200/35 dark:bg-sky-950/20 dark:text-sky-50 ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <input
          type="text"
          value={query}
          disabled={disabled}
          onFocus={() => !disabled && setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            onChange(next);
            if (!disabled) setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full bg-transparent outline-none placeholder:text-slate-500/80 dark:placeholder:text-sky-100/60"
        />
        {query ? (
          <button
            type="button"
            onClick={clear}
            className="rounded-full border border-sky-300/45 px-2 py-0.5 text-xs font-medium text-sky-900 hover:bg-sky-200/35 dark:border-sky-200/35 dark:text-sky-100 dark:hover:bg-sky-500/20"
            aria-label="Limpiar nacionalidad"
            title="Limpiar"
          >
            Limpiar
          </button>
        ) : null}
      </div>

      {open && !disabled && (
        <div className="absolute z-50 mt-2 max-h-64 w-full overflow-auto rounded-2xl border border-sky-300/40 bg-white/95 p-1 shadow-xl shadow-sky-950/15 backdrop-blur dark:border-sky-200/25 dark:bg-sky-950/95">
          {loading ? (
            <p className="px-3 py-2 text-xs opacity-75">Buscando países...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs opacity-75">Sin resultados</p>
          ) : (
            results.map((country) => (
              <button
                key={country.id_country}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(country);
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-sky-100/70 dark:hover:bg-sky-400/20"
              >
                <span>{country.name}</span>
                <span className="text-xs opacity-65">{country.iso2}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
