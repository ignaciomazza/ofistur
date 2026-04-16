"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Operator } from "@/types";

type OperatorOption = Pick<Operator, "id_operator" | "agency_operator_id" | "name">;

type OperatorPickerProps = {
  operators: OperatorOption[];
  valueId: number | null;
  onSelect: (operator: OperatorOption) => void;
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  hideSelectedSummary?: boolean;
  className?: string;
};

const normalizeText = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const toPositiveInt = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const int = Math.trunc(n);
  return int > 0 ? int : null;
};

const getOperatorDisplayId = (operator: OperatorOption): number =>
  toPositiveInt(operator.agency_operator_id) ?? operator.id_operator;

const getOperatorName = (operator: OperatorOption): string =>
  String(operator.name || "").trim() || `Operador N° ${getOperatorDisplayId(operator)}`;

const getOperatorSearchText = (operator: OperatorOption): string =>
  normalizeText(
    `${getOperatorName(operator)} ${operator.id_operator} ${getOperatorDisplayId(operator)}`,
  );

export default function OperatorPicker({
  operators,
  valueId,
  onSelect,
  onClear,
  placeholder = "Buscar operador por nombre o número...",
  disabled = false,
  required = false,
  hideSelectedSummary = false,
  className = "",
}: OperatorPickerProps) {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<OperatorOption | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const preserveTermOnNextClearRef = useRef(false);
  const listboxId = useId();

  const normalizedTerm = useMemo(() => normalizeText(term), [term]);

  const normalizedOperators = useMemo(() => {
    const base = (operators || []).filter(
      (operator) =>
        Number.isFinite(Number(operator.id_operator)) && Number(operator.id_operator) > 0,
    );
    return [...base].sort((a, b) =>
      getOperatorName(a).localeCompare(getOperatorName(b), "es", {
        sensitivity: "base",
      }),
    );
  }, [operators]);

  const filtered = useMemo(() => {
    if (!normalizedTerm) return normalizedOperators.slice(0, 12);
    return normalizedOperators
      .filter((operator) => getOperatorSearchText(operator).includes(normalizedTerm))
      .slice(0, 12);
  }, [normalizedOperators, normalizedTerm]);

  useEffect(() => {
    setHighlight(0);
  }, [normalizedTerm, open]);

  useEffect(() => {
    const parsedValue = toPositiveInt(valueId);
    if (parsedValue == null) {
      setSelected(null);
      if (preserveTermOnNextClearRef.current) {
        preserveTermOnNextClearRef.current = false;
      } else {
        setTerm("");
      }
      return;
    }

    const found = normalizedOperators.find((operator) => operator.id_operator === parsedValue);
    if (found) {
      setSelected(found);
      setTerm(getOperatorName(found));
      return;
    }

    const fallback: OperatorOption = {
      id_operator: parsedValue,
      agency_operator_id: null,
      name: `Operador N° ${parsedValue}`,
    };
    setSelected(fallback);
    setTerm(`Operador N° ${parsedValue} (no listado)`);
  }, [valueId, normalizedOperators]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  const pick = (operator: OperatorOption) => {
    setSelected(operator);
    setTerm(getOperatorName(operator));
    setOpen(false);
    setHighlight(0);
    onSelect(operator);
  };

  const clear = () => {
    setSelected(null);
    setTerm("");
    setOpen(false);
    setHighlight(0);
    onClear?.();
  };

  const handleInputChange = (nextValue: string) => {
    setTerm(nextValue);
    setOpen(true);
    setHighlight(0);

    if (selected && onClear) {
      preserveTermOnNextClearRef.current = true;
      setSelected(null);
      onClear();
    } else if (selected) {
      setSelected(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((prev) => Math.min(prev + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter" && filtered.length > 0) {
      event.preventDefault();
      pick(filtered[highlight] || filtered[0]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          value={term}
          onChange={(event) => handleInputChange(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required && !selected}
          className="w-full rounded-2xl border border-sky-300/80 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-sky-500/40 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
        />
        {(selected || term) && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="rounded-2xl bg-sky-100 px-4 py-2 text-sm text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
            title="Limpiar operador"
          >
            Limpiar
          </button>
        )}
      </div>

      {open && !disabled && (
        <ul
          id={listboxId}
          role="listbox"
          className="mt-2 max-h-64 w-full overflow-auto rounded-2xl border border-sky-300/70 bg-white/95 p-2 shadow-lg shadow-sky-950/10 backdrop-blur dark:border-sky-500/30 dark:bg-slate-900/95"
        >
          {filtered.length > 0 ? (
            filtered.map((operator, index) => {
              const displayId = getOperatorDisplayId(operator);
              const operatorName = getOperatorName(operator);
              const isHighlighted = index === highlight;
              return (
                <li
                  key={operator.id_operator}
                  role="option"
                  aria-selected={selected?.id_operator === operator.id_operator}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(operator)}
                  className={`cursor-pointer rounded-xl px-3 py-2 transition ${
                    isHighlighted
                      ? "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                      : "hover:bg-sky-50 dark:hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{operatorName}</span>
                    <span className="text-xs opacity-70">N° {displayId}</span>
                  </div>
                </li>
              );
            })
          ) : (
            <li className="px-3 py-2 text-sm text-sky-950/70 dark:text-white/70">
              No se encontraron operadores.
            </li>
          )}
        </ul>
      )}

      {selected && !hideSelectedSummary && (
        <p className="ml-1 mt-1 text-xs text-sky-950/70 dark:text-white/70">
          Seleccionado: <b>{getOperatorName(selected)}</b>
        </p>
      )}
    </div>
  );
}
