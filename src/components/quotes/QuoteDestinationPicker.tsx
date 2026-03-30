"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import Spinner from "@/components/Spinner";

type ApiDestination = {
  id_destination: number;
  name: string;
  country?: { id_country?: number; name?: string; iso2?: string } | null;
};

type ApiCountry = {
  id_country: number;
  name: string;
  iso2?: string | null;
};

type PickerOption = {
  id: number;
  kind: "destination" | "country";
  label: string;
};

type QuoteDestinationPickerProps = {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
};

function useDebounced<T>(value: T, delay = 280) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function toDestinationLabel(destination: ApiDestination): string {
  const destinationName = String(destination.name || "").trim();
  const countryName = String(destination.country?.name || "").trim();
  const countryIso = String(destination.country?.iso2 || "").trim();
  const countrySuffix = [countryName, countryIso ? `(${countryIso})` : ""]
    .filter(Boolean)
    .join(" ");
  return [destinationName, countrySuffix].filter(Boolean).join(", ");
}

function toCountryLabel(country: ApiCountry): string {
  const countryName = String(country.name || "").trim();
  const countryIso = String(country.iso2 || "").trim();
  return [countryName, countryIso ? `(${countryIso})` : ""]
    .filter(Boolean)
    .join(" ");
}

function normalizeText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function looksLikeCountryQuery(query: string): boolean {
  const clean = String(query || "").trim();
  if (!clean) return false;
  if (clean.includes(",")) return false;
  if (/[0-9]/.test(clean)) return false;
  return clean.length >= 2;
}

function getBestCountryMatch(
  countries: ApiCountry[],
  query: string,
): ApiCountry | null {
  const qn = normalizeText(query);
  if (!qn) return null;
  const best =
    countries.find((country) => normalizeText(country.name) === qn) ||
    countries.find((country) => normalizeText(country.name).startsWith(qn)) ||
    countries.find((country) => normalizeText(country.name).includes(qn)) ||
    null;
  if (!best) return null;

  const bn = normalizeText(best.name);
  const reasonable =
    bn === qn ||
    (qn.length >= 3 &&
      (bn.startsWith(qn) || qn.startsWith(bn) || bn.includes(qn)));

  return reasonable ? best : null;
}

export default function QuoteDestinationPicker({
  value,
  onChange,
  placeholder = "Destino",
  className = "",
  disabled = false,
  name,
}: QuoteDestinationPickerProps) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounced(value.trim());
  const canSearch = debouncedQuery.length >= 1;

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleDocumentClick);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  }, []);

  useEffect(() => {
    if (!token || !open || !canSearch) {
      setOptions([]);
      setLoading(false);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        setLoading(true);
        const loadItems = async <T,>(
          endpoint: string,
          params: Record<string, string>,
        ): Promise<T[]> => {
          try {
            const qs = new URLSearchParams(params);
            const res = await authFetch(
              `${endpoint}?${qs.toString()}`,
              { cache: "no-store", signal: controller.signal },
              token,
            );
            if (!res.ok) return [];
            const payload = (await res.json().catch(() => null)) as
              | {
                  items?: T[] | null;
                }
              | null;
            return Array.isArray(payload?.items) ? payload.items : [];
          } catch (error) {
            if ((error as { name?: string })?.name === "AbortError") {
              throw error;
            }
            return [];
          }
        };

        const take = 12;
        const cleanQuery = debouncedQuery.trim();
        const [destinationItems, countryItems] = await Promise.all([
          loadItems<ApiDestination>("/api/destinations", {
            q: cleanQuery,
            take: String(take),
            includeDisabled: "false",
          }),
          loadItems<ApiCountry>("/api/countries", {
            q: cleanQuery,
            take: "8",
            includeDisabled: "true",
          }),
        ]);

        let countryDestinationItems: ApiDestination[] = [];
        if (
          looksLikeCountryQuery(cleanQuery) &&
          destinationItems.length < 8 &&
          countryItems.length > 0
        ) {
          const bestCountry = getBestCountryMatch(countryItems, cleanQuery);
          if (bestCountry?.id_country) {
            countryDestinationItems = await loadItems<ApiDestination>(
              "/api/destinations",
              {
                countryId: String(bestCountry.id_country),
                take: String(take),
                includeDisabled: "false",
              },
            );
          }
        }

        const destinationOptions = [...countryDestinationItems, ...destinationItems]
          .map((item) => ({
            id: Number(item.id_destination),
            kind: "destination" as const,
            label: toDestinationLabel(item),
          }))
          .filter(
            (item) =>
              Number.isFinite(item.id) &&
              item.id > 0 &&
              String(item.label).trim().length > 0,
          );

        const countryOptions = countryItems
          .map((item) => ({
            id: Number(item.id_country),
            kind: "country" as const,
            label: toCountryLabel(item),
          }))
          .filter(
            (item) =>
              Number.isFinite(item.id) &&
              item.id > 0 &&
              String(item.label).trim().length > 0,
          );

        const next = [...countryOptions, ...destinationOptions];

        const deduped = Array.from(
          new Map(
            next.map((item) => [
              `${item.kind}:${item.label.toLowerCase()}`,
              item,
            ]),
          ).values(),
        );
        setOptions(deduped);
        setHighlight(0);
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        setOptions([]);
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [token, open, canSearch, debouncedQuery]);

  const applyOption = useCallback(
    (option: PickerOption) => {
      onChange(option.label);
      setOpen(false);
    },
    [onChange],
  );

  const hasSuggestions = options.length > 0;
  const showPopover = open && (loading || canSearch || hasSuggestions);
  const helperText = useMemo(() => {
    if (!canSearch) return "Escribí para buscar países y destinos o cargalo manual.";
    if (loading) return "";
    if (!hasSuggestions)
      return "Sin coincidencias de países/destinos. Se guardará lo que escribiste.";
    return "";
  }, [canSearch, hasSuggestions, loading]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((prev) =>
        Math.min(prev + 1, Math.max(options.length - 1, 0)),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (hasSuggestions && options[highlight]) {
        event.preventDefault();
        applyOption(options[highlight]);
      } else {
        setOpen(false);
      }
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        type="text"
        name={name}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-sky-300/45 bg-white/75 px-3 py-2 text-sm text-slate-900 shadow-sm shadow-sky-950/10 outline-none backdrop-blur placeholder:text-slate-500/80 focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-200/35 dark:bg-sky-950/20 dark:text-sky-50 dark:placeholder:text-sky-100/60"
      />

      {showPopover && (
        <div className="absolute inset-x-0 z-50 mt-1 overflow-hidden rounded-2xl border border-white/20 bg-white/95 shadow-xl backdrop-blur dark:border-white/10 dark:bg-sky-950/95">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-1 p-3">
              <Spinner />
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Cargando destinos y países...
              </p>
            </div>
          ) : hasSuggestions ? (
            <ul className="max-h-60 overflow-auto p-1">
              {options.map((option, idx) => {
                const selected = idx === highlight;
                return (
                  <li key={`${option.id}-${option.label}`}>
                    <button
                      type="button"
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                        selected
                          ? "bg-sky-100 text-sky-900 dark:bg-white/10 dark:text-white"
                          : "text-slate-800 hover:bg-sky-100/60 dark:text-slate-100 dark:hover:bg-white/5"
                      }`}
                      onMouseEnter={() => setHighlight(idx)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyOption(option);
                      }}
                    >
                      <span className="block">{option.label}</span>
                      <span className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {option.kind === "country" ? "País" : "Destino"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
              {helperText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
