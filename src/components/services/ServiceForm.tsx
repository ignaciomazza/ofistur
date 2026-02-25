// src/components/services/ServiceForm.tsx
"use client";

import type React from "react";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Operator,
  BillingData,
  BillingBreakdownOverride,
  BillingAdjustmentConfig,
  BillingAdjustmentComputed,
} from "@/types";
import BillingBreakdown from "@/components/BillingBreakdown";
import BillingBreakdownManual from "@/components/BillingBreakdownManual";
import { computeBillingAdjustments } from "@/utils/billingAdjustments";
import DestinationPicker, {
  DestinationOption,
} from "@/components/DestinationPicker";
import NoteComposer from "@/components/notes/NoteComposer";
import Spinner from "@/components/Spinner";
import { loadFinancePicks } from "@/utils/loadFinancePicks";
import { authFetch } from "@/utils/authFetch";
import { parseAmountInput } from "@/utils/receipts/receiptForm";
import { formatMoneyInput, shouldPreferDotDecimal } from "@/utils/moneyInput";

/* =========================
 * Tipos del formulario
 * ========================= */
export type ServiceFormData = {
  type: string;
  description?: string;
  note?: string;
  sale_price: number;
  cost_price: number;
  destination?: string;
  reference?: string;
  tax_21?: number;
  tax_105?: number;
  exempt?: number;
  other_taxes?: number;
  card_interest?: number;
  card_interest_21?: number;
  currency: string;
  id_operator: number;
  departure_date: string;
  return_date: string;
  transfer_fee_pct?: number | null;
  extra_adjustments?: BillingAdjustmentComputed[] | null;
  billing_override?: Partial<BillingBreakdownOverride> | null;
};

type ServiceFormProps = {
  formData: ServiceFormData;
  handleChange: (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => void;
  handleSubmit: (e: FormEvent) => void | Promise<void>;
  editingServiceId: number | null;
  operators: Operator[];
  isFormVisible: boolean;
  setIsFormVisible: React.Dispatch<React.SetStateAction<boolean>>;
  onBillingUpdate?: (data: BillingData) => void;
  /** Fallback para costos bancarios si no viene de config del tipo o de la API */
  agencyTransferFeePct: number;
  token: string | null;
  /** NUEVO: indica que ya se leyó correctamente la config global de fee */
  transferFeeReady: boolean;
  /** Permite forzar modo manual aunque la config global esté en auto */
  canOverrideBillingMode?: boolean;
  /** Usa venta total por reserva (desactiva venta por servicio) */
  useBookingSaleTotal?: boolean;
  /** Indica que ya cargaron operadores (aunque estén vacíos) */
  operatorsReady?: boolean;
  /** Cantidad de acompañantes simples por categoría */
  passengerCategoryCounts?: Record<number, number>;
};

/* ---------- helpers UI ---------- */
const Section: React.FC<{
  title: string;
  desc?: string;
  children: React.ReactNode;
}> = ({ title, desc, children }) => (
  <section className="rounded-2xl border border-sky-900/10 bg-white/35 p-4 shadow-sm shadow-sky-950/5 dark:border-white/10 dark:bg-white/[0.04]">
    <div className="mb-3">
      <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
        {title}
      </h3>
      {desc && (
        <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
          {desc}
        </p>
      )}
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
  </section>
);

const Field: React.FC<{
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ id, label, hint, required, children }) => (
  <div className="space-y-1">
    <label
      htmlFor={id}
      className="ml-1 block text-sm font-medium text-sky-950 dark:text-white"
    >
      {label} {required && <span className="text-rose-600">*</span>}
    </label>
    {children}
    {hint && (
      <p
        id={`${id}-hint`}
        className="ml-1 text-xs text-sky-950/70 dark:text-white/70"
      >
        {hint}
      </p>
    )}
  </div>
);

const AdjustmentsPanel: React.FC<{
  items: BillingAdjustmentComputed[];
  totalCosts: number;
  totalTaxes: number;
  netCommission: number | null;
  format: (value: number) => string;
}> = ({ items, totalCosts, totalTaxes, netCommission, format }) => {
  if (!items.length) return null;
  const kindLabels: Record<BillingAdjustmentComputed["kind"], string> = {
    cost: "Costo",
    tax: "Impuesto",
  };
  const basisLabels: Record<BillingAdjustmentComputed["basis"], string> = {
    sale: "Venta",
    cost: "Costo",
    margin: "Ganancia",
  };

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-sm shadow-sky-950/10 dark:text-white">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Ajustes adicionales</h3>
        <span className="rounded-full bg-white/30 px-2.5 py-1 text-xs font-medium dark:bg-white/10">
          {items.length} activos
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {items.map((adj) => {
          const valueLabel =
            adj.valueType === "percent"
              ? `${(adj.value * 100).toFixed(2)}%`
              : "Monto fijo";
          return (
            <div
              key={adj.id}
              className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-3 py-2"
            >
              <div>
                <div className="text-sm font-medium">{adj.label}</div>
                <div className="text-[11px] opacity-70">
                  {kindLabels[adj.kind]} · Base {basisLabels[adj.basis]} ·{" "}
                  {valueLabel}
                </div>
              </div>
              <div className="font-medium tabular-nums">
                {format(adj.amount)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
          <div className="text-xs opacity-70">Costos adicionales</div>
          <div className="text-sm font-semibold tabular-nums">
            {format(totalCosts)}
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
          <div className="text-xs opacity-70">Impuestos adicionales</div>
          <div className="text-sm font-semibold tabular-nums">
            {format(totalTaxes)}
          </div>
        </div>
      </div>

      {netCommission != null && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/20 p-3">
          <div className="text-sm opacity-70">
            Comisión neta (fee + ajustes)
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {format(netCommission)}
          </div>
        </div>
      )}
    </div>
  );
};

const makeAdjustmentId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `adj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const formatPercentInput = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  return String(parseFloat((safe * 100).toFixed(4)));
};

const parsePercentInput = (raw: string) => {
  const normalized = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(normalized)) return 0;
  return normalized / 100;
};

const ServiceAdjustmentsEditor: React.FC<{
  items: BillingAdjustmentConfig[];
  onChange: (next: BillingAdjustmentConfig[]) => void;
  disabled?: boolean;
}> = ({ items, onChange, disabled = false }) => {
  const addItem = () => {
    const next: BillingAdjustmentConfig = {
      id: makeAdjustmentId(),
      label: "Ajuste servicio",
      kind: "cost",
      basis: "sale",
      valueType: "percent",
      value: 0,
      active: true,
      source: "service",
    };
    onChange([...items, next]);
  };

  const updateItem = (
    id: string,
    patch: Partial<BillingAdjustmentConfig>,
  ) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-sm shadow-sky-950/10 dark:text-white">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Ajustes por servicio</h3>
          <p className="text-[11px] opacity-70">
            Se aplican solo al servicio actual. En venta total por reserva se
            toman a nivel resumen.
          </p>
        </div>
        <button
          type="button"
          onClick={addItem}
          disabled={disabled}
          className="rounded-full border border-white/10 bg-white/20 px-3 py-1 text-xs font-semibold shadow-sm shadow-sky-950/10 transition disabled:opacity-50 dark:bg-white/10"
        >
          Agregar mini ajuste
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs opacity-70">No hay ajustes por servicio.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="ml-1 block text-xs font-medium opacity-80">
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={item.label}
                    disabled={disabled}
                    onChange={(e) => updateItem(item.id, { label: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-white/60 px-2.5 py-1.5 text-sm outline-none dark:bg-white/10"
                  />
                </div>

                <div className="space-y-1">
                  <label className="ml-1 block text-xs font-medium opacity-80">
                    Tipo
                  </label>
                  <select
                    value={item.kind}
                    disabled={disabled}
                    onChange={(e) =>
                      updateItem(item.id, {
                        kind: e.target.value as BillingAdjustmentConfig["kind"],
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/60 px-2.5 py-1.5 text-sm outline-none dark:bg-white/10"
                  >
                    <option value="cost">Costo</option>
                    <option value="tax">Impuesto</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="ml-1 block text-xs font-medium opacity-80">
                    Base
                  </label>
                  <select
                    value={item.basis}
                    disabled={disabled}
                    onChange={(e) =>
                      updateItem(item.id, {
                        basis: e.target.value as BillingAdjustmentConfig["basis"],
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/60 px-2.5 py-1.5 text-sm outline-none dark:bg-white/10"
                  >
                    <option value="sale">Venta</option>
                    <option value="cost">Costo</option>
                    <option value="margin">Ganancia</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="ml-1 block text-xs font-medium opacity-80">
                    Modo
                  </label>
                  <select
                    value={item.valueType}
                    disabled={disabled}
                    onChange={(e) =>
                      updateItem(item.id, {
                        valueType:
                          e.target.value as BillingAdjustmentConfig["valueType"],
                        value: item.value,
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/60 px-2.5 py-1.5 text-sm outline-none dark:bg-white/10"
                  >
                    <option value="percent">Porcentaje</option>
                    <option value="fixed">Monto fijo</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="ml-1 block text-xs font-medium opacity-80">
                    {item.valueType === "percent" ? "Valor (%)" : "Valor fijo"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={
                      item.valueType === "percent"
                        ? formatPercentInput(item.value)
                        : String(item.value)
                    }
                    disabled={disabled}
                    onChange={(e) =>
                      updateItem(item.id, {
                        value:
                          item.valueType === "percent"
                            ? parsePercentInput(e.target.value)
                            : Number(e.target.value.replace(",", ".")) || 0,
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/60 px-2.5 py-1.5 text-sm outline-none dark:bg-white/10"
                  />
                </div>

                <div className="flex items-end gap-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.active}
                      disabled={disabled}
                      onChange={(e) =>
                        updateItem(item.id, { active: e.target.checked })
                      }
                      className="size-4 rounded border-sky-900/20 bg-white/80 text-sky-600 shadow-sm shadow-sky-950/10 focus:ring-2 focus:ring-sky-300/50 dark:border-white/20 dark:bg-white/10"
                    />
                    Activo
                  </label>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={disabled}
                    className="rounded-full border border-rose-300/40 bg-rose-200/40 px-3 py-1 text-xs font-semibold text-rose-900 shadow-sm shadow-rose-900/10 disabled:opacity-50 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-100"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* util mínima */
const uniqSorted = (arr: string[]) =>
  Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "es"),
  );
const NO_DESTINATION_LABEL = "Sin destino";

type FinanceCurrency = { code: string; name: string; enabled: boolean };

/* =========================
 * Tipos/normalizadores API
 * ========================= */
type RawServiceType = {
  id_service_type?: number | string | null;
  id?: number | string | null;
  name?: string | null;
  label?: string | null;
  value?: string | null;
  countryOnly?: boolean | number | string | null;
  multiDestDefault?: boolean | number | string | null;
  allowNoDestination?: boolean | number | string | null;
  allow_no_destination?: boolean | number | string | null;
  is_active?: boolean | number | string | null;
};

type NormalizedServiceType = {
  id?: number | null;
  value: string;
  label: string;
  countryOnly?: boolean;
  multiDestDefault?: boolean;
  allowNoDestination?: boolean;
};

type RawServiceCalcCfg = {
  value?: string | null;
  countryOnly?: boolean | number | string | null;
  multiDestDefault?: boolean | number | string | null;
  defaultTransferFeePct?: number | string | null;
};

type ServiceCalcCfg = {
  value: string;
  countryOnly?: boolean;
  multiDestDefault?: boolean;
  defaultTransferFeePct?: number;
};

type ServiceTypePresetItemLite = {
  category_id: number;
  sale_price: number;
  cost_price: number;
  sale_markup_pct?: number | null;
  category?: { name?: string | null } | null;
};

type ServiceTypePresetLite = {
  id_preset: number;
  operator_id?: number | null;
  currency: string;
  enabled?: boolean;
  sort_order?: number | null;
  items: ServiceTypePresetItemLite[];
};

type CalcConfigResponse = {
  billing_breakdown_mode: "auto" | "manual";
  transfer_fee_pct: number; // proporción (0.024 = 2.4%)
  billing_adjustments: BillingAdjustmentConfig[];
  use_booking_sale_total?: boolean;
};

/* ---- helpers sin `any` ---- */
function isRecord(val: unknown): val is Record<string, unknown> {
  return !!val && typeof val === "object" && !Array.isArray(val);
}

function toBool(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "t", "yes", "y"].includes(s)) return true;
    if (["0", "false", "f", "no", "n"].includes(s)) return false;
  }
  return undefined;
}

function normalizePct(v: unknown): number | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  const percLike = s.endsWith("%");
  const n = parseFloat(s.replace("%", "").replace(",", "."));
  if (isNaN(n)) return undefined;
  if (percLike) return Math.max(0, n) / 100;
  if (n > 1) return Math.max(0, n) / 100;
  if (n >= 0 && n <= 1) return n;
  return undefined;
}

function normalizeServiceType(
  raw: RawServiceType,
): NormalizedServiceType | null {
  const value = (raw.value || raw.name || raw.label || "").toString().trim();
  if (!value) return null;
  const label = (raw.label || raw.name || value).toString().trim();
  const rawId = raw.id_service_type ?? raw.id;
  const id =
    rawId != null && Number.isFinite(Number(rawId)) ? Number(rawId) : null;
  const countryOnly = toBool(raw.countryOnly);
  const multiDestDefault = toBool(raw.multiDestDefault);
  const allowNoDestination = toBool(
    raw.allowNoDestination ?? raw.allow_no_destination,
  );
  return {
    id,
    value,
    label,
    countryOnly,
    multiDestDefault,
    allowNoDestination,
  };
}

function normalizeCalcCfg(raw: RawServiceCalcCfg): ServiceCalcCfg | null {
  const value = (raw.value || "").toString().trim();
  if (!value) return null;
  const countryOnly = toBool(raw.countryOnly);
  const multiDestDefault = toBool(raw.multiDestDefault);
  const defaultTransferFeePct = normalizePct(raw.defaultTransferFeePct);
  return { value, countryOnly, multiDestDefault, defaultTransferFeePct };
}

function pickArrayFromJson<T = unknown>(
  json: unknown,
  keys: string[] = ["data", "types", "items", "results"],
): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const k of keys) {
      const v = obj[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

/* Heurísticas para destino por nombre */
const nameBasedCountryOnly = (name?: string) =>
  (name || "").toLowerCase().includes("visa") ||
  (name || "").toLowerCase().includes("visado");

const nameBasedMultiDefault = (name?: string) => {
  const n = (name || "").toLowerCase();
  return (
    n.includes("tour") ||
    n.includes("circuito") ||
    n.includes("crucero") ||
    n.includes("excursion") ||
    n.includes("excursión") ||
    n.includes("excursiones")
  );
};

/* === helpers robustos para traer service-calc-config por tipo (opcional) === */
function getStringField(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function toRawServiceCalcCfg(u: unknown): RawServiceCalcCfg | null {
  if (!isRecord(u)) return null;
  const value =
    getStringField(u, "value") ??
    getStringField(u, "type") ??
    getStringField(u, "service") ??
    null;

  const countryOnly = (u["countryOnly"] ?? u["country_only"]) as
    | boolean
    | number
    | string
    | null
    | undefined;
  const multiDestDefault = (u["multiDestDefault"] ??
    u["multi_dest_default"]) as boolean | number | string | null | undefined;
  const defaultTransferFeePct = (u["defaultTransferFeePct"] ??
    u["transfer_fee_pct"]) as number | string | null | undefined;

  return { value, countryOnly, multiDestDefault, defaultTransferFeePct };
}

async function fetchServiceCalcCfg(
  token: string,
  typeValue: string,
): Promise<ServiceCalcCfg | null> {
  const endpoints = [
    (t: string) => `/api/service-calc-config?type=${encodeURIComponent(t)}`,
    (t: string) => `/api/service/calc-config?type=${encodeURIComponent(t)}`,
    (t: string) => `/api/services/calc-config?type=${encodeURIComponent(t)}`,
  ];

  for (const build of endpoints) {
    try {
      const res = await authFetch(
        build(typeValue),
        { cache: "no-store" },
        token,
      );
      if (!res.ok) continue;

      const json: unknown = await res.json();

      // 1) Array en distintas claves
      let candidates = pickArrayFromJson<unknown>(json)
        .map(toRawServiceCalcCfg)
        .filter(Boolean) as RawServiceCalcCfg[];

      // 2) Objeto directo o envuelto en "data"
      if (!candidates.length) {
        const direct = toRawServiceCalcCfg(json);
        const nestedData = isRecord(json)
          ? toRawServiceCalcCfg(json["data"])
          : null;
        candidates = [direct, nestedData].filter(
          Boolean,
        ) as RawServiceCalcCfg[];
      }

      if (candidates.length) {
        const normalized = candidates
          .map((c) => normalizeCalcCfg(c))
          .filter(Boolean) as ServiceCalcCfg[];
        const match =
          normalized.find((n) => n.value === typeValue) || normalized[0];
        if (match) return match;
      }
    } catch {
      // probar siguiente endpoint
    }
  }

  return null;
}

/* ========= Helpers de moneda ========= */
function pickDisplayCurrency(
  formCode: string,
  enabledOptions: string[],
): string {
  const form = (formCode || "").trim().toUpperCase();
  if (form) return form;
  const first = (enabledOptions[0] || "").trim().toUpperCase();
  return first || "ARS";
}

function extractServiceAdjustments(
  source: BillingAdjustmentComputed[] | null | undefined,
): BillingAdjustmentConfig[] {
  if (!Array.isArray(source)) return [];
  return source
    .filter((item) => item && item.source === "service")
    .map((item) => ({
      id: item.id || makeAdjustmentId(),
      label: item.label || "Ajuste servicio",
      kind: item.kind,
      basis: item.basis,
      valueType: item.valueType,
      value: Number.isFinite(item.value) ? Number(item.value) : 0,
      active: item.active !== false,
      source: "service",
    }));
}

type MoneyFieldName =
  | "cost_price"
  | "sale_price"
  | "tax_21"
  | "tax_105"
  | "exempt"
  | "other_taxes"
  | "card_interest"
  | "card_interest_21";

const MONEY_FIELDS: MoneyFieldName[] = [
  "cost_price",
  "sale_price",
  "tax_21",
  "tax_105",
  "exempt",
  "other_taxes",
  "card_interest",
  "card_interest_21",
];

const formatMoneyFieldValue = (
  value: number | null | undefined,
  currency: string,
) => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) return "";
  return formatMoneyInput(String(num), currency);
};

/* =========================
 * Componente
 * ========================= */
export default function ServiceForm({
  formData,
  handleChange,
  handleSubmit,
  editingServiceId,
  operators,
  isFormVisible,
  setIsFormVisible,
  onBillingUpdate,
  agencyTransferFeePct,
  token,
  transferFeeReady,
  canOverrideBillingMode = false,
  useBookingSaleTotal = false,
  operatorsReady,
  passengerCategoryCounts = {},
}: ServiceFormProps) {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ========== TIPOS DINÁMICOS ========== */
  const [serviceTypes, setServiceTypes] = useState<NormalizedServiceType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [presetLoading, setPresetLoading] = useState(false);
  const [activePreset, setActivePreset] = useState<ServiceTypePresetLite | null>(
    null,
  );

  const selectedTypeFromList = useMemo(
    () => serviceTypes.find((t) => t.value === formData.type),
    [serviceTypes, formData.type],
  );

  /* ========== CONFIG POR TIPO (opcional) ========== */
  const [calcCfg, setCalcCfg] = useState<ServiceCalcCfg | null>(null);
  const [loadingCfg, setLoadingCfg] = useState(false);

  /* ========== AGENCY CONFIG (modo y fee global) ========== */
  const [loadingAgencyCfg, setLoadingAgencyCfg] = useState(false);
  const [agencyBillingMode, setAgencyBillingMode] = useState<"auto" | "manual">(
    "auto",
  );
  const [manualOverride, setManualOverride] = useState(false);
  const [agencyFeePctFromApi, setAgencyFeePctFromApi] = useState<
    number | undefined
  >(undefined);
  const [agencyAdjustments, setAgencyAdjustments] = useState<
    BillingAdjustmentConfig[]
  >([]);
  const [serviceAdjustments, setServiceAdjustments] = useState<
    BillingAdjustmentConfig[]
  >([]);
  const [baseBillingData, setBaseBillingData] = useState<BillingData | null>(
    null,
  );

  /* ========== MONEDAS ========== */
  const [financeCurrencies, setFinanceCurrencies] = useState<
    FinanceCurrency[] | null
  >(null);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);

  const formReady =
    transferFeeReady &&
    !loadingTypes &&
    !loadingAgencyCfg &&
    !loadingCurrencies &&
    !presetLoading &&
    (operatorsReady ?? true);

  /* ==========================================
   * Pipeline al ABRIR el formulario (secuencial)
   * tipos → config agencia → monedas
   * ========================================== */
  const openPipelineRef = useRef<{ ac: AbortController; id: number } | null>(
    null,
  );

  useEffect(() => {
    if (!isFormVisible || !token) return;

    // abortar pipeline anterior
    if (openPipelineRef.current) openPipelineRef.current.ac.abort();

    const ac = new AbortController();
    const runId = Date.now();
    openPipelineRef.current = { ac, id: runId };

    const isActive = () =>
      mountedRef.current &&
      openPipelineRef.current?.id === runId &&
      !ac.signal.aborted;

    (async () => {
      // 1) Tipos
      try {
        setLoadingTypes(true);
        setTypesError(null);
        const res = await authFetch(
          "/api/service-types",
          { cache: "no-store", signal: ac.signal },
          token,
        );
        if (!res.ok) throw new Error("No se pudo obtener tipos de servicio.");
        const json = await res.json();
        const raw = pickArrayFromJson<RawServiceType>(json);
        const norm = raw
          .filter((r) => r?.is_active == null || toBool(r.is_active) !== false)
          .map(normalizeServiceType)
          .filter(Boolean) as NormalizedServiceType[];
        if (isActive()) setServiceTypes(norm);
      } catch (e) {
        if (isActive()) {
          setServiceTypes([]);
          setTypesError(
            e instanceof Error
              ? e.message
              : "Error cargando tipos de servicio.",
          );
        }
      } finally {
        if (isActive()) setLoadingTypes(false);
      }

      // 2) Config de agencia (modo + fee)
      if (!isActive()) return;
      try {
        setLoadingAgencyCfg(true);
        const res = await authFetch(
          "/api/service-calc-config",
          { cache: "no-store", signal: ac.signal },
          token,
        );
        if (!res.ok) throw new Error("No se pudo obtener service-calc-config.");
        const data = (await res.json()) as CalcConfigResponse;
        if (!isActive()) return;
        setAgencyBillingMode(
          data.billing_breakdown_mode === "manual" ? "manual" : "auto",
        );
        setAgencyFeePctFromApi(
          typeof data.transfer_fee_pct === "number"
            ? data.transfer_fee_pct
            : undefined,
        );
        setAgencyAdjustments(
          Array.isArray(data.billing_adjustments) ? data.billing_adjustments : [],
        );
      } catch {
        if (isActive()) {
          setAgencyBillingMode("auto");
          setAgencyFeePctFromApi(undefined);
          setAgencyAdjustments([]);
        }
      } finally {
        if (isActive()) setLoadingAgencyCfg(false);
      }

      // 3) Monedas
      if (!isActive()) return;
      try {
        setLoadingCurrencies(true);
        const picks = await loadFinancePicks(token);
        if (!isActive()) return;
        setFinanceCurrencies(picks?.currencies ?? null);
      } catch {
        if (isActive()) setFinanceCurrencies(null);
      } finally {
        if (isActive()) setLoadingCurrencies(false);
      }
    })();

    return () => ac.abort();
  }, [isFormVisible, token]);

  useEffect(() => {
    if (!isFormVisible || agencyBillingMode === "manual") {
      setManualOverride(false);
    }
  }, [agencyBillingMode, isFormVisible]);

  useEffect(() => {
    if (!isFormVisible) return;
    setServiceAdjustments(extractServiceAdjustments(formData.extra_adjustments));
  }, [editingServiceId, formData.extra_adjustments, isFormVisible]);

  /* ===================================================
   * Fetch de config por TIPO (solo si el form está abierto)
   * =================================================== */
  const typeCfgRef = useRef<{ ac: AbortController; id: number } | null>(null);

  useEffect(() => {
    if (!isFormVisible || !token || !formData.type) {
      setCalcCfg(null);
      return;
    }

    if (typeCfgRef.current) typeCfgRef.current.ac.abort();
    const ac = new AbortController();
    const id = Date.now();
    typeCfgRef.current = { ac, id };

    const isActive = () =>
      mountedRef.current && typeCfgRef.current?.id === id && !ac.signal.aborted;

    (async () => {
      try {
        setLoadingCfg(true);
        const cfg = await fetchServiceCalcCfg(token, formData.type);
        if (isActive()) setCalcCfg(cfg);
      } catch {
        if (isActive()) setCalcCfg(null);
      } finally {
        if (isActive()) setLoadingCfg(false);
      }
    })();

    return () => ac.abort();
  }, [isFormVisible, token, formData.type]);

  /* ========== Presets por tipo/operador ========== */
  useEffect(() => {
    if (!isFormVisible || !token) {
      setActivePreset(null);
      return;
    }
    const typeId = selectedTypeFromList?.id;
    if (!typeId) {
      setActivePreset(null);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    const operatorId = formData.id_operator || 0;
    const fetchPresets = async (withOperator: boolean) => {
      const qs = new URLSearchParams();
      qs.set("service_type_id", String(typeId));
      qs.set("enabled", "true");
      if (withOperator && operatorId > 0) {
        qs.set("operator_id", String(operatorId));
      }
      const res = await authFetch(
        `/api/service-type-presets?${qs.toString()}`,
        { cache: "no-store", signal: controller.signal },
        token,
      );
      if (!res.ok) return [];
      const data = (await res.json().catch(() => [])) as ServiceTypePresetLite[];
      return Array.isArray(data) ? data : [];
    };

    (async () => {
      try {
        setPresetLoading(true);
        let presets: ServiceTypePresetLite[] = [];
        if (operatorId > 0) {
          presets = await fetchPresets(true);
        }
        if (!presets.length) {
          presets = await fetchPresets(false);
        }
        if (!alive || controller.signal.aborted) return;
        const sorted = presets
          .filter((p) => p && p.items && p.items.length > 0 && p.enabled !== false)
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const selected = sorted[0] || null;
        setActivePreset(selected);
      } catch {
        if (alive) setActivePreset(null);
      } finally {
        if (alive) setPresetLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [isFormVisible, token, selectedTypeFromList?.id, formData.id_operator]);

  /* ========== Moneda segura para UI/formatos ========== */
  const currencyOptions = useMemo(() => {
    const financeEnabled = uniqSorted(
      (financeCurrencies || [])
        .filter((c) => c.enabled)
        .map((c) => (c.code || "").toUpperCase()),
    );

    // Mantener visible la moneda actual o la sugerida por preset aunque no
    // llegue en la lista de configuración.
    const contextual = uniqSorted(
      [formData.currency, activePreset?.currency]
        .map((code) => String(code || "").toUpperCase())
        .filter(Boolean),
    );

    return uniqSorted([...financeEnabled, ...contextual]);
  }, [financeCurrencies, formData.currency, activePreset?.currency]);

  const currencyLabelDict = useMemo(() => {
    const dict: Record<string, string> = {};
    for (const c of financeCurrencies || []) {
      if (c.enabled) dict[String(c.code).toUpperCase()] = c.name;
    }
    return dict;
  }, [financeCurrencies]);

  const displayCurrency = useMemo(
    () => pickDisplayCurrency(formData.currency, currencyOptions),
    [formData.currency, currencyOptions],
  );

  /* ========== FORMATO & KPI CABECERA ========== */
  const currencySymbol = useMemo(() => {
    if (displayCurrency === "USD") return "US$";
    if (displayCurrency === "ARS") return "$";
    return displayCurrency;
  }, [displayCurrency]);

  const formatCurrency = (value: number) => {
    if (!Number.isFinite(value)) return "";
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: displayCurrency,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${displayCurrency}`;
    }
  };

  const formatIsoToDisplay = (v: string) =>
    !v || v.includes("/") ? v : v.split("-").reverse().join("/");
  const formatDisplayToIso = (v: string) => {
    const p = v.split("/");
    return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : v;
  };

  const handleDateChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value: raw } = e.target;
    const d = raw.replace(/\D/g, "");
    let f = "";
    if (d.length >= 1) f += d.substring(0, 2);
    if (d.length >= 3) f += "/" + d.substring(2, 4);
    if (d.length >= 5) f += "/" + d.substring(4, 8);
    handleChange({
      target: { name, value: f },
    } as ChangeEvent<HTMLInputElement>);
  };
  const handleDatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData("text").replace(/\D/g, "");
    if (t.length === 8) {
      e.preventDefault();
      handleChange({
        target: {
          name: e.currentTarget.name,
          value: `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4, 8)}`,
        },
      } as ChangeEvent<HTMLInputElement>);
    }
  };
  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    handleChange({
      target: { name, value: formatDisplayToIso(value) },
    } as ChangeEvent<HTMLInputElement>);
  };

  const updateField = useCallback(
    (name: string, value: string | number) => {
      handleChange({
        target: { name, value },
      } as ChangeEvent<HTMLInputElement>);
    },
    [handleChange],
  );

  const presetOverrideRef = useRef(false);
  useEffect(() => {
    presetOverrideRef.current = false;
  }, [activePreset?.id_preset, activePreset?.operator_id]);

  const handlePresetSensitiveChange = useCallback(
    (
      e: ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => {
      presetOverrideRef.current = true;
      handleChange(e);
    },
    [handleChange],
  );

  const getMoneyFieldDisplayValue = useCallback(
    (name: MoneyFieldName, currencyCode: string) =>
      formatMoneyFieldValue(
        Number(formData[name] ?? 0),
        currencyCode || formData.currency || "ARS",
      ),
    [formData],
  );

  const [moneyInputs, setMoneyInputs] = useState<Record<MoneyFieldName, string>>(
    () =>
      MONEY_FIELDS.reduce<Record<MoneyFieldName, string>>((acc, key) => {
        acc[key] = getMoneyFieldDisplayValue(key, formData.currency || "ARS");
        return acc;
      }, {} as Record<MoneyFieldName, string>),
  );
  const [focusedMoneyField, setFocusedMoneyField] =
    useState<MoneyFieldName | null>(null);

  useEffect(() => {
    setMoneyInputs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of MONEY_FIELDS) {
        if (focusedMoneyField === key) continue;
        const formatted = getMoneyFieldDisplayValue(
          key,
          formData.currency || "ARS",
        );
        if (next[key] !== formatted) {
          next[key] = formatted;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [
    focusedMoneyField,
    getMoneyFieldDisplayValue,
    formData.currency,
    formData.cost_price,
    formData.sale_price,
    formData.tax_21,
    formData.tax_105,
    formData.exempt,
    formData.other_taxes,
    formData.card_interest,
    formData.card_interest_21,
  ]);

  const applyMoneyFieldValue = useCallback(
    (name: MoneyFieldName, amount: number, presetSensitive = false) => {
      if (presetSensitive) presetOverrideRef.current = true;
      updateField(name, String(amount));
    },
    [updateField],
  );

  const handleMoneyInputChange = useCallback(
    (name: MoneyFieldName, presetSensitive: boolean) =>
      (e: ChangeEvent<HTMLInputElement>) => {
        const formatted = formatMoneyInput(
          e.target.value,
          formData.currency || "ARS",
          { preferDotDecimal: shouldPreferDotDecimal(e) },
        );
        setMoneyInputs((prev) => ({ ...prev, [name]: formatted }));
        const parsed = parseAmountInput(formatted) ?? 0;
        applyMoneyFieldValue(name, parsed, presetSensitive);
      },
    [applyMoneyFieldValue, formData.currency],
  );

  const handleMoneyInputBlur = useCallback(
    (name: MoneyFieldName, presetSensitive: boolean) =>
      (e: React.FocusEvent<HTMLInputElement>) => {
        const parsed = parseAmountInput(e.target.value);
        const value = parsed != null && Number.isFinite(parsed) ? parsed : 0;
        applyMoneyFieldValue(name, value, presetSensitive);
        setMoneyInputs((prev) => ({
          ...prev,
          [name]: formatMoneyFieldValue(value, formData.currency || "ARS"),
        }));
        setFocusedMoneyField((curr) => (curr === name ? null : curr));
      },
    [applyMoneyFieldValue, formData.currency],
  );

  const applyPreset = useCallback(
    (preset: ServiceTypePresetLite) => {
      if (!preset || editingServiceId) return;
      if (presetOverrideRef.current) return;
      if (!Array.isArray(preset.items) || preset.items.length === 0) return;
      const counts = passengerCategoryCounts || {};
      let totalCount = 0;
      let saleTotal = 0;
      let costTotal = 0;
      const parts: string[] = [];
      for (const item of preset.items) {
        const count = Number(counts[item.category_id] || 0);
        if (count <= 0) continue;
        totalCount += count;
        const markup =
          typeof item.sale_markup_pct === "number"
            ? item.sale_markup_pct
            : null;
        const saleUnit =
          markup != null
            ? item.cost_price * (1 + markup / 100)
            : item.sale_price;
        saleTotal += saleUnit * count;
        costTotal += item.cost_price * count;
        const label = item.category?.name || `Cat ${item.category_id}`;
        parts.push(`${label} x${count}`);
      }
      if (totalCount === 0) return;
      const nextSale = Number(saleTotal.toFixed(2));
      const nextCost = Number(costTotal.toFixed(2));
      const currentSale = Number(formData.sale_price || 0);
      const currentCost = Number(formData.cost_price || 0);
      const nextDescription = parts.join(", ");
      const currentDescription = (formData.description || "").trim();
      const needsSale = Math.abs(currentSale - nextSale) > 0.005;
      const needsCost = Math.abs(currentCost - nextCost) > 0.005;
      const needsCurrency =
        preset.currency && preset.currency !== formData.currency;
      const needsDescription =
        parts.length > 0 && currentDescription !== nextDescription;

      if (!needsSale && !needsCost && !needsCurrency && !needsDescription) {
        return;
      }
      if (needsSale) updateField("sale_price", String(nextSale));
      if (needsCost) updateField("cost_price", String(nextCost));
      if (needsCurrency) updateField("currency", preset.currency);
      if (needsDescription) updateField("description", nextDescription);
    },
    [
      editingServiceId,
      passengerCategoryCounts,
      formData.cost_price,
      formData.currency,
      formData.description,
      formData.sale_price,
      updateField,
    ],
  );

  useEffect(() => {
    if (!activePreset) return;
    applyPreset(activePreset);
  }, [activePreset, applyPreset]);

  const hasPrices =
    Number(formData.cost_price) > 0 &&
    (Number(formData.sale_price) > 0 || useBookingSaleTotal);
  const margin = useMemo(
    () =>
      hasPrices
        ? Number(formData.sale_price) - Number(formData.cost_price)
        : 0,
    [formData.sale_price, formData.cost_price, hasPrices],
  );

  /* ========== DESTINATION PICKER ========== */
  const [countryMode, setCountryMode] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const selectedTypeAllowsNoDestination = Boolean(
    selectedTypeFromList?.allowNoDestination,
  );
  const noDestination = useMemo(
    () =>
      (formData.destination || "").trim().toLowerCase() ===
      NO_DESTINATION_LABEL.toLowerCase(),
    [formData.destination],
  );

  useEffect(() => {
    const t = formData.type;
    const country =
      (calcCfg?.countryOnly ??
        selectedTypeFromList?.countryOnly ??
        (t ? nameBasedCountryOnly(t) : false)) ||
      false;

    const multi =
      (calcCfg?.multiDestDefault ??
        selectedTypeFromList?.multiDestDefault ??
        (t ? nameBasedMultiDefault(t) : false)) ||
      false;

    setCountryMode(!!country);
    setMultiMode(!!multi);
  }, [calcCfg, selectedTypeFromList, formData.type]);

  const [destSelection, setDestSelection] = useState<
    DestinationOption | DestinationOption[] | null
  >(null);
  const [destValid, setDestValid] = useState(false);

  useEffect(() => {
    if (!formData.type) return;
    if (loadingTypes || selectedTypeAllowsNoDestination) return;
    if (noDestination) {
      setDestValid(false);
      setDestSelection(null);
      handleChange({
        target: { name: "destination", value: "" },
      } as ChangeEvent<HTMLInputElement>);
    }
  }, [
    selectedTypeAllowsNoDestination,
    noDestination,
    formData.type,
    formData.destination,
    loadingTypes,
    handleChange,
  ]);

  // Si cambiás entre "solo país" / "múltiples destinos", reseteamos el picker,
  // pero NO tocamos el valor de destination en formData.
  useEffect(() => {
    setDestSelection(null);
    setDestValid(false);
  }, [countryMode, multiMode]);

  const handleNoDestinationToggle = useCallback(
    (checked: boolean) => {
      setDestSelection(null);
      if (checked) {
        setDestValid(true);
        handleChange({
          target: { name: "destination", value: NO_DESTINATION_LABEL },
        } as ChangeEvent<HTMLInputElement>);
        return;
      }
      setDestValid(false);
      handleChange({
        target: { name: "destination", value: "" },
      } as ChangeEvent<HTMLInputElement>);
    },
    [handleChange],
  );

  const handleDestinationChange = (
    val: DestinationOption | DestinationOption[] | null,
  ) => {
    if (noDestination) return;
    setDestSelection(val);

    let text = "";
    if (Array.isArray(val)) {
      text = val.map((v) => v.displayLabel).join(" · ");
    } else if (val) {
      text = val.displayLabel;
    }

    // El picker considera válido si hay texto
    const isValid = text.trim().length > 0;
    setDestValid(isValid);

    handleChange({
      target: { name: "destination", value: text },
    } as ChangeEvent<HTMLInputElement>);
  };

  /* ========== SUBMIT ========== */
  const [submitting, setSubmitting] = useState(false);
  const onLocalSubmit = async (e: FormEvent) => {
    // ⛔ No dejamos enviar si la config todavía está cargando
    const waitingConfig =
      loadingTypes ||
      loadingAgencyCfg ||
      loadingCurrencies ||
      loadingCfg ||
      !transferFeeReady;

    if (waitingConfig) {
      e.preventDefault();
      return;
    }

    setSubmitting(true);
    try {
      await Promise.resolve(handleSubmit(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBaseBillingUpdate = useCallback((data: BillingData) => {
    setBaseBillingData(data);
  }, []);

  // Transfer fee efectivo:
  // 1) Config por tipo de servicio
  // 2) Config general de la agencia (service-calc-config)
  // 3) Valor ya guardado en el servicio (legado / sin config)
  // 4) Fallback del prop (agencyTransferFeePct)
  // Transfer fee efectivo:
  const effectiveTransferFeePct = useMemo(() => {
    // 1) Config específica del tipo de servicio
    if (calcCfg?.defaultTransferFeePct != null) {
      return calcCfg.defaultTransferFeePct;
    }

    // 2) Config general de la agencia (service-calc-config)
    if (typeof agencyFeePctFromApi === "number") {
      return agencyFeePctFromApi;
    }

    // 3) Valor que ya tenga el servicio (solo si no hay config arriba)
    if (formData.transfer_fee_pct != null) {
      return formData.transfer_fee_pct;
    }

    // 4) Fallback: lo que venga del container (/api/agency/transfer-fee o default 2,4 %)
    return agencyTransferFeePct;
  }, [
    calcCfg?.defaultTransferFeePct,
    agencyFeePctFromApi,
    formData.transfer_fee_pct,
    agencyTransferFeePct,
  ]);

  // ⚙️ Modo de facturación: API de agencia + override manual (si aplica)
  const manualMode =
    useBookingSaleTotal ||
    agencyBillingMode === "manual" ||
    (canOverrideBillingMode && manualOverride);

  // Solo bloqueamos si NO hay texto de destino y además el picker dice que no es válido.
  const destinationHasText = useMemo(
    () => !!(formData.destination && formData.destination.trim()),
    [formData.destination],
  );

  const pctToShow = Number.isFinite(effectiveTransferFeePct)
    ? (effectiveTransferFeePct as number)
    : 0;
  const fallbackBillingData = useMemo<BillingData>(
    () => ({
      nonComputable: 0,
      taxableBase21: 0,
      taxableBase10_5: 0,
      commissionExempt: 0,
      commission21: 0,
      commission10_5: 0,
      vatOnCommission21: 0,
      vatOnCommission10_5: 0,
      totalCommissionWithoutVAT: 0,
      impIVA: 0,
      taxableCardInterest: 0,
      vatOnCardInterest: 0,
      transferFeeAmount: 0,
      transferFeePct: pctToShow,
    }),
    [pctToShow],
  );
  const isSameBillingData = (a: BillingData | null, b: BillingData) =>
    !!a &&
    a.nonComputable === b.nonComputable &&
    a.taxableBase21 === b.taxableBase21 &&
    a.taxableBase10_5 === b.taxableBase10_5 &&
    a.commissionExempt === b.commissionExempt &&
    a.commission21 === b.commission21 &&
    a.commission10_5 === b.commission10_5 &&
    a.vatOnCommission21 === b.vatOnCommission21 &&
    a.vatOnCommission10_5 === b.vatOnCommission10_5 &&
    a.totalCommissionWithoutVAT === b.totalCommissionWithoutVAT &&
    a.impIVA === b.impIVA &&
    a.taxableCardInterest === b.taxableCardInterest &&
    a.vatOnCardInterest === b.vatOnCardInterest &&
    a.transferFeeAmount === b.transferFeeAmount &&
    a.transferFeePct === b.transferFeePct;

  const combinedAdjustments = useMemo<BillingAdjustmentConfig[]>(
    () => [
      ...agencyAdjustments.map((item) => ({ ...item, source: "global" as const })),
      ...serviceAdjustments.map((item) => ({ ...item, source: "service" as const })),
    ],
    [agencyAdjustments, serviceAdjustments],
  );

  const adjustmentTotals = useMemo(() => {
    if (useBookingSaleTotal) {
      return {
        items: combinedAdjustments.map((item) => ({ ...item, amount: 0 })),
        totalCosts: 0,
        totalTaxes: 0,
        total: 0,
      };
    }
    return computeBillingAdjustments(
      combinedAdjustments,
      Number(formData.sale_price || 0),
      Number(formData.cost_price || 0),
    );
  }, [
    combinedAdjustments,
    formData.sale_price,
    formData.cost_price,
    useBookingSaleTotal,
  ]);

  const netCommissionAfterAdjustments = useMemo(() => {
    if (!baseBillingData) return null;
    const base = Number(baseBillingData.totalCommissionWithoutVAT || 0);
    const fee = Number(baseBillingData.transferFeeAmount || 0);
    return base - fee - adjustmentTotals.total;
  }, [adjustmentTotals.total, baseBillingData]);

  useEffect(() => {
    if (!useBookingSaleTotal || hasPrices) return;
    if (isSameBillingData(baseBillingData, fallbackBillingData)) return;
    setBaseBillingData(fallbackBillingData);
  }, [useBookingSaleTotal, hasPrices, baseBillingData, fallbackBillingData]);

  useEffect(() => {
    if (!onBillingUpdate || !baseBillingData) return;
    onBillingUpdate({
      ...baseBillingData,
      extraCostsAmount: adjustmentTotals.totalCosts,
      extraTaxesAmount: adjustmentTotals.totalTaxes,
      extraAdjustments: adjustmentTotals.items,
    });
  }, [adjustmentTotals, baseBillingData, onBillingUpdate]);

  // ⚠️ Config todavía cargando (no dejamos enviar)
  const waitingConfig =
    loadingTypes ||
    loadingAgencyCfg ||
    loadingCurrencies ||
    loadingCfg ||
    !transferFeeReady;

  const missingDestination =
    !noDestination && !destValid && !destinationHasText;
  const submitDisabled = submitting || waitingConfig || missingDestination;

  return (
    <motion.div
      layout
      initial={{ maxHeight: 96, opacity: 1 }}
      animate={{
        maxHeight: isFormVisible ? 700 : 96,
        opacity: 1,
        transition: { duration: 0.35, ease: "easeInOut" },
      }}
      id="service-form"
      className="mb-6 overflow-auto rounded-3xl border border-sky-900/10 bg-white/20 text-sky-950 shadow-md shadow-sky-950/10 dark:border-white/10 dark:bg-white/[0.05] dark:text-white"
    >
      {/* HEADER */}
      <div
        className={`sticky top-0 z-10 ${isFormVisible ? "rounded-t-3xl border-b" : ""} border-white/10 px-4 py-3 backdrop-blur-sm`}
      >
        <button
          type="button"
          onClick={() => setIsFormVisible(!isFormVisible)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={isFormVisible}
          aria-controls="service-form-body"
        >
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/20 dark:bg-white/10 dark:text-white">
              {isFormVisible ? (
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
              <p className="text-lg font-semibold">
                {editingServiceId ? "Editar Servicio" : "Agregar Servicio"}
              </p>
              {(loadingTypes ||
                loadingCfg ||
                loadingAgencyCfg ||
                loadingCurrencies) && (
                <p className="text-xs text-sky-950/70 dark:text-white/70">
                  {loadingTypes
                    ? "Cargando tipos..."
                    : loadingCfg
                      ? "Aplicando configuración del tipo..."
                      : loadingCurrencies
                        ? "Cargando monedas..."
                        : "Leyendo configuración de la agencia..."}
                </p>
              )}
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <span className="rounded-full bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10">
              {displayCurrency}
            </span>
            {hasPrices && !useBookingSaleTotal && (
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Margen: {formatCurrency(margin)}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* BODY */}
      <AnimatePresence initial={false}>
        {isFormVisible && (
          <motion.div
            key="body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative"
          >
            {!formReady ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 py-8 text-sm text-sky-950/70 dark:text-white/70">
                <Spinner />
                <div className="text-center">
                  <p className="text-sm font-medium">Preparando formulario</p>
                  <p className="text-xs">
                    Cargando tipos, operadores y configuraciones…
                  </p>
                </div>
              </div>
            ) : (
              <motion.form
                id="service-form-body"
                onSubmit={onLocalSubmit}
                className="space-y-5 px-4 pb-6 pt-4 md:px-6"
              >
              {/* DATOS BÁSICOS */}
              <Section
                title="Datos básicos"
                desc="Definen qué compró el pax y cómo lo vas a identificar."
              >
                <Field
                  id="type"
                  label="Tipo de Servicio"
                  required
                  hint={
                    typesError
                      ? "No se pudieron cargar los tipos. Intentá recargar."
                      : "Seleccioná una categoría."
                  }
                >
                  <select
                    id="type"
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    required
                    disabled={loadingTypes}
                    className="w-full cursor-pointer appearance-none rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                    aria-describedby="type-hint"
                  >
                    {loadingTypes && (
                      <option value="" disabled>
                        Cargando tipos…
                      </option>
                    )}
                    {!loadingTypes && serviceTypes.length === 0 && (
                      <option value="" disabled>
                        {typesError
                          ? "Error al cargar tipos"
                          : "Sin tipos disponibles"}
                      </option>
                    )}
                    {!loadingTypes && serviceTypes.length > 0 && (
                      <>
                        <option value="" disabled>
                          Seleccionar tipo
                        </option>
                        {serviceTypes.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                        {formData.type &&
                          !serviceTypes.some(
                            (t) => t.value === formData.type,
                          ) && (
                            <option value={formData.type}>
                              {formData.type} (no listado)
                            </option>
                          )}
                      </>
                    )}
                  </select>
                </Field>

                <Field
                  id="description"
                  label="Descripción"
                  hint="Aparece en recibos. Sé claro y breve."
                >
                  <input
                    id="description"
                    type="text"
                    name="description"
                    value={formData.description || ""}
                    onChange={handlePresetSensitiveChange}
                    placeholder="Detalle del servicio..."
                    className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                  />
                </Field>

                {/* Destination controls */}
                <div className="col-span-full -mb-1 flex flex-wrap items-center gap-4 px-1">
                  {selectedTypeAllowsNoDestination && (
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={noDestination}
                        onChange={(e) =>
                          handleNoDestinationToggle(e.target.checked)
                        }
                        className="size-4 rounded border-sky-900/20 bg-white/80 text-sky-600 shadow-sm shadow-sky-950/10 focus:ring-2 focus:ring-sky-300/50 dark:border-white/20 dark:bg-white/10"
                      />
                      Sin destino
                    </label>
                  )}
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={countryMode}
                      onChange={(e) => setCountryMode(e.target.checked)}
                      disabled={noDestination}
                      className="size-4 rounded border-sky-900/20 bg-white/80 text-sky-600 shadow-sm shadow-sky-950/10 focus:ring-2 focus:ring-sky-300/50 dark:border-white/20 dark:bg-white/10"
                    />
                    Solo país
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={multiMode}
                      onChange={(e) => setMultiMode(e.target.checked)}
                      disabled={noDestination}
                      className="size-4 rounded border-sky-900/20 bg-white/80 text-sky-600 shadow-sm shadow-sky-950/10 focus:ring-2 focus:ring-sky-300/50 dark:border-white/20 dark:bg-white/10"
                    />
                    Múltiples destinos
                  </label>
                </div>

                {/* DestinationPicker */}
                {noDestination ? (
                  <div className="rounded-2xl border border-amber-200/40 bg-amber-100/30 px-3 py-2 text-xs text-amber-900/90 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100">
                    Este servicio se guardará como <b>{NO_DESTINATION_LABEL}</b>.
                  </div>
                ) : (
                  <div className="space-y-1">
                    <DestinationPicker
                      type={countryMode ? "country" : "destination"}
                      multiple={multiMode}
                      value={destSelection}
                      onChange={handleDestinationChange}
                      onValidChange={setDestValid}
                      placeholder={
                        countryMode
                          ? "Ej.: Italia, Peru..."
                          : "Ej.: París, Salta…"
                      }
                      hint={
                        multiMode
                          ? "Podés sumar varios destinos/países. Se guardan como texto."
                          : countryMode
                            ? "Elegí el país correspondiente."
                            : "Elegí un destino habilitado."
                      }
                    />
                    {formData.destination ? (
                      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                        Guardará como: <b>{formData.destination}</b>
                      </p>
                    ) : null}
                  </div>
                )}

                <Field
                  id="reference"
                  label="Referencia"
                  hint="Localizador, nro de reserva del operador, etc."
                >
                  <input
                    id="reference"
                    type="text"
                    name="reference"
                    value={formData.reference || ""}
                    onChange={handleChange}
                    placeholder="Ej: ABC12345"
                    className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                  />
                </Field>
              </Section>

              {/* FECHAS & OPERADOR */}
              <Section title="Fechas y Operador">
                <Field
                  id="departure_date"
                  label="Desde"
                  hint="Formato: dd/mm/aaaa"
                >
                  <input
                    id="departure_date"
                    type="text"
                    name="departure_date"
                    value={
                      formData.departure_date
                        ? formatIsoToDisplay(formData.departure_date)
                        : ""
                    }
                    onChange={handleDateChange}
                    onPaste={handleDatePaste}
                    onBlur={handleDateBlur}
                    inputMode="numeric"
                    placeholder="dd/mm/aaaa"
                    className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                  />
                </Field>

                <Field
                  id="return_date"
                  label="Hasta"
                  hint="Formato: dd/mm/aaaa"
                >
                  <input
                    id="return_date"
                    type="text"
                    name="return_date"
                    value={
                      formData.return_date
                        ? formatIsoToDisplay(formData.return_date)
                        : ""
                    }
                    onChange={handleDateChange}
                    onPaste={handleDatePaste}
                    onBlur={handleDateBlur}
                    inputMode="numeric"
                    placeholder="dd/mm/aaaa"
                    className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                  />
                </Field>

                <Field id="id_operator" label="Operador" required>
                  <select
                    id="id_operator"
                    name="id_operator"
                    value={formData.id_operator || 0}
                    onChange={handleChange}
                    required
                    className="w-full cursor-pointer appearance-none rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                  >
                    <option value={0} disabled>
                      Seleccionar operador
                    </option>
                    {operators.map((op) => (
                      <option key={op.id_operator} value={op.id_operator}>
                        {op.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field id="currency" label="Moneda" required>
                  <select
                    id="currency"
                    name="currency"
                    value={formData.currency}
                    onChange={handlePresetSensitiveChange}
                    required
                    disabled={currencyOptions.length === 0}
                    className="w-full cursor-pointer appearance-none rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                  >
                    <option value="" disabled>
                      {loadingCurrencies
                        ? "Cargando monedas…"
                        : currencyOptions.length
                          ? "Seleccionar moneda"
                          : "Sin monedas habilitadas"}
                    </option>
                    {currencyOptions.map((code) => (
                      <option key={code} value={code}>
                        {currencyLabelDict[code]
                          ? `${code} — ${currencyLabelDict[code]}`
                          : code}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>

              {/* NOTAS INTERNAS */}
              <Section
                title="Notas internas"
                desc="Solo para uso interno del equipo."
              >
                <div className="md:col-span-2">
                  <Field id="note" label="Nota">
                    <NoteComposer
                      id="note"
                      name="note"
                      value={formData.note || ""}
                      onChange={(next) => updateField("note", next)}
                      placeholder="Notas internas del servicio…"
                      rows={3}
                    />
                  </Field>
                </div>
              </Section>

              {/* PRECIOS */}
              <Section
                title="Precios"
                desc="Ingresá los montos en la moneda seleccionada."
              >
                {useBookingSaleTotal && (
                  <div className="col-span-full">
                    <div className="rounded-xl border border-amber-200/40 bg-amber-100/30 p-3 text-xs text-amber-900/80 dark:border-amber-200/20 dark:bg-amber-100/10 dark:text-amber-100">
                      La venta se define a nivel reserva. Los servicios sólo
                      requieren costos e impuestos.
                    </div>
                  </div>
                )}
                {canOverrideBillingMode &&
                  !loadingAgencyCfg &&
                  agencyBillingMode === "auto" &&
                  !useBookingSaleTotal && (
                    <div className="col-span-full">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/10 p-3 text-xs">
                        <div>
                          <p className="text-sm font-medium">
                            Desglose de facturación
                          </p>
                          <p className="text-[11px] text-sky-950/70 dark:text-white/70">
                            La agencia está en automático. Podés forzar manual
                            para este servicio.
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={manualOverride}
                            onChange={(e) =>
                              setManualOverride(e.target.checked)
                            }
                            className="size-4 rounded border-sky-900/20 bg-white/80 text-sky-600 shadow-sm shadow-sky-950/10 focus:ring-2 focus:ring-sky-300/50 dark:border-white/20 dark:bg-white/10"
                          />
                          Manual
                        </label>
                      </div>
                    </div>
                  )}
                <Field
                  id="cost_price"
                  label="Costo"
                  required
                  hint={`Se mostrará como ${currencySymbol} en los totales.`}
                >
                  <div className="relative">
                    <input
                      id="cost_price"
                      type="text"
                      name="cost_price"
                      inputMode="decimal"
                      value={moneyInputs.cost_price}
                      onFocus={() => setFocusedMoneyField("cost_price")}
                      onChange={handleMoneyInputChange("cost_price", true)}
                      onBlur={handleMoneyInputBlur("cost_price", true)}
                      placeholder="0,00"
                      required
                      className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                    />
                  </div>
                  <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                    {formatCurrency(formData.cost_price)}
                  </p>
                </Field>

                <Field
                  id="sale_price"
                  label="Venta"
                  required={!useBookingSaleTotal}
                  hint={
                    useBookingSaleTotal
                      ? "Se toma de la venta total de la reserva."
                      : undefined
                  }
                >
                  <div className="relative">
                    <input
                      id="sale_price"
                      type="text"
                      name="sale_price"
                      inputMode="decimal"
                      value={moneyInputs.sale_price}
                      onFocus={() => setFocusedMoneyField("sale_price")}
                      onChange={handleMoneyInputChange("sale_price", true)}
                      onBlur={handleMoneyInputBlur("sale_price", true)}
                      placeholder="0,00"
                      required={!useBookingSaleTotal}
                      disabled={useBookingSaleTotal}
                      className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                    />
                  </div>
                  <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                    {formatCurrency(formData.sale_price)}
                  </p>
                </Field>

                {/* ⛔ Ocultos en modo manual */}
                {!manualMode && (
                  <>
                    <Field id="tax_21" label="IVA 21%">
                      <input
                        id="tax_21"
                        type="text"
                        name="tax_21"
                        inputMode="decimal"
                        value={moneyInputs.tax_21}
                        onFocus={() => setFocusedMoneyField("tax_21")}
                        onChange={handleMoneyInputChange("tax_21", false)}
                        onBlur={handleMoneyInputBlur("tax_21", false)}
                        placeholder="0,00"
                        className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                      />
                      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                        {formatCurrency(formData.tax_21 || 0)}
                      </p>
                    </Field>

                    <Field id="tax_105" label="IVA 10,5%">
                      <input
                        id="tax_105"
                        type="text"
                        name="tax_105"
                        inputMode="decimal"
                        value={moneyInputs.tax_105}
                        onFocus={() => setFocusedMoneyField("tax_105")}
                        onChange={handleMoneyInputChange("tax_105", false)}
                        onBlur={handleMoneyInputBlur("tax_105", false)}
                        placeholder="0,00"
                        className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                      />
                      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                        {formatCurrency(formData.tax_105 || 0)}
                      </p>
                    </Field>

                    <Field id="exempt" label="Exento">
                      <input
                        id="exempt"
                        type="text"
                        name="exempt"
                        inputMode="decimal"
                        value={moneyInputs.exempt}
                        onFocus={() => setFocusedMoneyField("exempt")}
                        onChange={handleMoneyInputChange("exempt", false)}
                        onBlur={handleMoneyInputBlur("exempt", false)}
                        placeholder="0,00"
                        className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                      />
                      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                        {formatCurrency(formData.exempt || 0)}
                      </p>
                    </Field>
                  </>
                )}

                {/* Siempre visible: renombrado según modo */}
                <Field
                  id="other_taxes"
                  label={manualMode ? "Impuestos" : "Otros Impuestos"}
                >
                  <input
                    id="other_taxes"
                    type="text"
                    name="other_taxes"
                    inputMode="decimal"
                    value={moneyInputs.other_taxes}
                    onFocus={() => setFocusedMoneyField("other_taxes")}
                    onChange={handleMoneyInputChange("other_taxes", false)}
                    onBlur={handleMoneyInputBlur("other_taxes", false)}
                    placeholder="0,00"
                    className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                  />
                  <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                    {formatCurrency(formData.other_taxes || 0)}
                  </p>
                </Field>
              </Section>

              {/* TARJETA */}
              <Section
                title="Tarjeta"
                desc={
                  manualMode
                    ? "En modo manual el interés/IVA de tarjeta no participa del desglose."
                    : "Si la operación tiene interés por financiación, podés discriminarlo."
                }
              >
                {/* ⛔ Ocultos en modo manual */}
                {!manualMode && (
                  <>
                    <Field id="card_interest" label="Interés">
                      <input
                        id="card_interest"
                        type="text"
                        name="card_interest"
                        inputMode="decimal"
                        value={moneyInputs.card_interest}
                        onFocus={() => setFocusedMoneyField("card_interest")}
                        onChange={handleMoneyInputChange("card_interest", false)}
                        onBlur={handleMoneyInputBlur("card_interest", false)}
                        placeholder="0,00"
                        className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                      />
                      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                        {formatCurrency(formData.card_interest || 0)}
                      </p>
                    </Field>

                    <Field id="card_interest_21" label="IVA 21% (Interés)">
                      <input
                        id="card_interest_21"
                        type="text"
                        name="card_interest_21"
                        inputMode="decimal"
                        value={moneyInputs.card_interest_21}
                        onFocus={() => setFocusedMoneyField("card_interest_21")}
                        onChange={handleMoneyInputChange("card_interest_21", false)}
                        onBlur={handleMoneyInputBlur("card_interest_21", false)}
                        placeholder="0,00"
                        className="w-full rounded-2xl border border-sky-900/10 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30"
                      />
                      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                        {formatCurrency(formData.card_interest_21 || 0)}
                      </p>
                    </Field>
                  </>
                )}

                <div className="col-span-full">
                  <div className="rounded-xl border border-white/10 bg-white/10 p-3 text-xs">
                    <span className="font-medium">Costos bancarios</span>{" "}
                    aplicado en cálculos:{" "}
                    <span className="rounded-full bg-white/30 px-2 py-0.5 font-medium">
                      {(pctToShow * 100).toFixed(2)}%
                    </span>
                    {waitingConfig && (
                      <span className="ml-2 text-[11px] text-amber-700 dark:text-amber-300">
                        Cargando configuración…
                      </span>
                    )}
                  </div>
                </div>
              </Section>

              <ServiceAdjustmentsEditor
                items={serviceAdjustments}
                onChange={setServiceAdjustments}
                disabled={waitingConfig}
              />

              {/* DESGLOSE */}
              {hasPrices &&
                (manualMode ? (
                  <BillingBreakdownManual
                    importeVenta={formData.sale_price}
                    costo={formData.cost_price}
                    impuestos={formData.other_taxes || 0}
                    moneda={displayCurrency}
                    onBillingUpdate={handleBaseBillingUpdate}
                    transferFeePct={pctToShow}
                  />
                ) : (
                  <BillingBreakdown
                    importeVenta={formData.sale_price}
                    costo={formData.cost_price}
                    montoIva21={formData.tax_21 || 0}
                    montoIva10_5={formData.tax_105 || 0}
                    montoExento={formData.exempt || 0}
                    otrosImpuestos={formData.other_taxes || 0}
                    cardInterest={formData.card_interest || 0}
                    cardInterestIva={formData.card_interest_21 || 0}
                    moneda={displayCurrency}
                    onBillingUpdate={handleBaseBillingUpdate}
                    transferFeePct={pctToShow}
                    allowBreakdownOverrideEdit={canOverrideBillingMode}
                    initialBreakdownOverride={formData.billing_override}
                  />
                ))}

              <AdjustmentsPanel
                items={adjustmentTotals.items}
                totalCosts={adjustmentTotals.totalCosts}
                totalTaxes={adjustmentTotals.totalTaxes}
                netCommission={netCommissionAfterAdjustments}
                format={formatCurrency}
              />

              {/* ACTION BAR */}
              <div className="sticky bottom-2 z-10 flex justify-end">
                <button
                  type="submit"
                  disabled={submitDisabled}
                  aria-busy={submitting || waitingConfig}
                  className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] ${
                    submitDisabled
                      ? "cursor-not-allowed bg-sky-950/20 text-white/60 dark:bg-white/5 dark:text-white/40"
                      : "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                  }`}
                  aria-label={
                    editingServiceId
                      ? "Guardar cambios del servicio"
                      : "Agregar servicio"
                  }
                >
                  {waitingConfig ? (
                    "Esperá a que termine de cargar…"
                  ) : submitting ? (
                    <Spinner />
                  ) : editingServiceId ? (
                    "Guardar Cambios"
                  ) : (
                    "Agregar Servicio"
                  )}
                </button>
              </div>
              </motion.form>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
