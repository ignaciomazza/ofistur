// src/app/quick-load/page.tsx
"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { toast, ToastContainer } from "react-toastify";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import ClientPicker from "@/components/clients/ClientPicker";
import DestinationPicker, {
  type DestinationOption,
} from "@/components/DestinationPicker";
import SummaryCard from "@/components/services/SummaryCard";
import BillingBreakdown from "@/components/BillingBreakdown";
import BillingBreakdownManual from "@/components/BillingBreakdownManual";
import { computeBillingAdjustments } from "@/utils/billingAdjustments";
import {
  composeBillingOverridePayload,
  extractBillingOverrideMeta,
  extractBillingOverrideValues,
} from "@/utils/billingOverride";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { loadFinancePicks, type FinanceCurrency } from "@/utils/loadFinancePicks";
import { normalizeRole } from "@/utils/permissions";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import type {
  BillingAdjustmentComputed,
  BillingAdjustmentConfig,
  BillingOverridePayload,
  BillingData,
  Client,
  ClientProfileConfig,
  ClientSimpleCompanion,
  ClientCustomField,
  Operator,
  PassengerCategory,
  Service,
} from "@/types";
import {
  BUILTIN_CUSTOM_FIELDS,
  DEFAULT_CLIENT_PROFILE_KEY,
  DEFAULT_CLIENT_PROFILE_LABEL,
  DEFAULT_REQUIRED_FIELDS,
  DOCUMENT_ANY_KEY,
  REQUIRED_FIELD_OPTIONS,
  normalizeClientProfiles,
  resolveClientProfile,
} from "@/utils/clientConfig";
import "react-toastify/dist/ReactToastify.css";

type Profile = {
  id_user: number;
  id_agency: number;
  role: string;
  first_name?: string;
  last_name?: string;
};

type NewClientDraft = {
  id: string;
  kind: "new";
  profile_key: string;
  first_name: string;
  last_name: string;
  phone: string;
  birth_date: string;
  nationality: string;
  gender: string;
  dni_number: string;
  passport_number: string;
  email: string;
  address: string;
  postal_code: string;
  locality: string;
  company_name: string;
  commercial_address: string;
  tax_id: string;
  custom_fields: Record<string, string>;
};

type ExistingClientDraft = {
  id: string;
  kind: "existing";
  existingId: number;
  snapshot: {
    first_name: string;
    last_name: string;
    birth_date?: string | null;
    dni_number?: string;
    passport_number?: string;
    email?: string;
    address?: string;
    postal_code?: string;
    locality?: string;
    company_name?: string;
    commercial_address?: string;
    tax_id?: string;
  };
};

type ClientDraft = NewClientDraft | ExistingClientDraft;

type BookingDraft = {
  clientStatus: string;
  operatorStatus: string;
  status: string;
  details: string;
  invoice_type: string;
  invoice_observation: string;
  observation: string;
  departure_date: string;
  return_date: string;
  simple_companions?: Array<{
    category_id?: number | null;
    age?: number | null;
    notes?: string | null;
  }>;
};

type ServiceDraft = {
  id: string;
  type: string;
  description: string;
  sale_price: string;
  cost_price: string;
  tax_21: string;
  tax_105: string;
  exempt: string;
  other_taxes: string;
  card_interest: string;
  card_interest_21: string;
  destination: string;
  reference: string;
  currency: string;
  id_operator: number;
  departure_date: string;
  return_date: string;
  extra_costs_amount: string;
  extra_taxes_amount: string;
  taxableCardInterest: number;
  vatOnCardInterest: number;
  nonComputable: number;
  taxableBase21: number;
  taxableBase10_5: number;
  commissionExempt: number;
  commission21: number;
  commission10_5: number;
  vatOnCommission21: number;
  vatOnCommission10_5: number;
  totalCommissionWithoutVAT: number;
  impIVA: number;
  transfer_fee_pct: number;
  transfer_fee_amount: number;
  billing_override?: BillingOverridePayload;
  breakdown_warning_messages?: string[];
  service_adjustments?: BillingAdjustmentConfig[];
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

type QuickLoadDraft = {
  step: number;
  clients: ClientDraft[];
  titularId: string | null;
  booking: BookingDraft;
  services: ServiceDraft[];
  useBookingSaleTotal?: boolean;
  bookingSaleTotals?: Record<string, string>;
  manualOverride?: boolean;
  updatedAt: string;
};

type AdjustmentTotals = ReturnType<typeof computeBillingAdjustments>;

const EMPTY_ADJUSTMENTS: AdjustmentTotals = {
  items: [],
  totalCosts: 0,
  totalTaxes: 0,
  total: 0,
};

const DRAFT_KEY = "quick-load-draft-v1";

const STEP_LABELS = [
  { id: 1, label: "Pasajeros", desc: "Alta rápida de pasajeros" },
  { id: 2, label: "Reserva", desc: "Fechas y facturación" },
  { id: 3, label: "Servicios", desc: "Carga y desglose" },
  { id: 4, label: "Resumen", desc: "Revisión final" },
] as const;

const INVOICE_TYPES = [
  { value: "Factura A", label: "Responsable Inscripto (Factura A)" },
  { value: "Factura B", label: "Consumidor final (Factura B)" },
  {
    value: "Coordinar con administracion",
    label: "No facturar hasta coordinar con administración",
  },
] as const;

type ServiceTypeOption = {
  id?: number | null;
  value: string;
  label: string;
};

const pickArrayFromJson = (
  payload: unknown,
  keys: string[] = ["data", "items", "types", "results"],
): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
};

const toBoolish = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
  }
  return undefined;
};

const normalizeServiceTypes = (payload: unknown): ServiceTypeOption[] => {
  const items = pickArrayFromJson(payload);
  const normalized = items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name =
        typeof record.name === "string"
          ? record.name
          : typeof record.label === "string"
            ? record.label
            : typeof record.type === "string"
              ? record.type
              : "";
      const rawId =
        typeof record.id_service_type === "number"
          ? record.id_service_type
          : typeof record.id === "number"
            ? record.id
            : null;
      const code = typeof record.code === "string" ? record.code : "";
      const enabled =
        toBoolish(
          record.enabled ??
            record.is_active ??
            record.isActive ??
            record.active,
        ) ?? true;
      const value = name || code;
      if (!value || enabled === false) return null;
      return { id: rawId, value, label: name || code };
    })
    .filter(Boolean) as ServiceTypeOption[];
  return normalized.sort((a, b) => a.label.localeCompare(b.label, "es"));
};

const REQUIRED_FIELD_LABELS = new Map(
  REQUIRED_FIELD_OPTIONS.map((opt) => [opt.key, opt.label]),
);
const isFilledValue = (value: unknown): boolean =>
  (value ?? "").toString().trim().length > 0;

const applyBuiltinMeta = (fields: ClientCustomField[]) => {
  const builtinMap = new Map(BUILTIN_CUSTOM_FIELDS.map((f) => [f.key, f]));
  return fields.map((field) => {
    const builtin = builtinMap.get(field.key);
    if (!builtin) return field;
    return {
      ...builtin,
      required:
        typeof field.required === "boolean"
          ? field.required
          : builtin.required,
    };
  });
};

const normalizeClientConfig = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const profiles = normalizeClientProfiles(record.profiles, {
    required_fields: record.required_fields,
    hidden_fields: record.hidden_fields,
    custom_fields: record.custom_fields,
  }).map((profile) => ({
    ...profile,
    custom_fields: applyBuiltinMeta(profile.custom_fields),
  }));
  return {
    profiles,
    use_simple_companions:
      typeof record.use_simple_companions === "boolean"
        ? record.use_simple_companions
        : false,
  };
};

const buildMissingClientFields = (
  client: NewClientDraft,
  requiredFields: string[],
  customFields: ClientCustomField[],
) => {
  const missing: string[] = [];
  for (const field of requiredFields) {
    if (field === DOCUMENT_ANY_KEY) continue;
    const key = field as keyof NewClientDraft;
    if (!isFilledValue(client[key])) {
      missing.push(REQUIRED_FIELD_LABELS.get(field) ?? field);
    }
  }
  const hasDoc =
    isFilledValue(client.dni_number) ||
    isFilledValue(client.passport_number) ||
    isFilledValue(client.tax_id);
  const docRequired = requiredFields.includes(DOCUMENT_ANY_KEY);
  if (docRequired && !hasDoc) {
    missing.push("DNI, Pasaporte o CUIT");
  }
  for (const field of customFields) {
    if (!field.required) continue;
    if (!isFilledValue(client.custom_fields?.[field.key])) {
      missing.push(field.label);
    }
  }
  return missing;
};

const humanizeCreatePaxError = (raw: unknown): string => {
  const message = String(raw ?? "").trim();
  if (!message) {
    return "No se pudo guardar el pax. Revisá los datos e intentá nuevamente.";
  }
  const normalized = message.toLowerCase();
  if (
    normalized.includes("tipo de pax inválido") ||
    normalized.includes("profile_key")
  ) {
    return "El tipo de pax seleccionado no es válido.";
  }
  if (normalized.includes("category_id")) {
    return "La categoría seleccionada no es válida.";
  }
  if (
    normalized.includes("falta la migración de tipos de pax") ||
    normalized.includes("actualización pendiente del sistema")
  ) {
    return "No se puede guardar este tipo de pax por el momento. Intentá nuevamente en unos minutos.";
  }
  if (normalized === "error al crear pax") {
    return "No se pudo guardar el pax. Revisá los datos e intentá nuevamente.";
  }
  return message;
};

// const GLASS =
//   "rounded-3xl border border-sky-200/60 bg-white/70 p-6 text-sky-950 shadow-sm shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white";
const PANEL =
  "rounded-3xl border border-sky-200/60 bg-white/60 p-6 shadow-sm shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/5";
const INPUT =
  "w-full rounded-2xl border border-white/20 bg-white/70 px-3 py-2.5 text-sm text-sky-950 shadow-sm shadow-sky-950/10 outline-none transition placeholder:text-sky-950/40 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:placeholder:text-white/40";
const INPUT_SOFT =
  "w-full rounded-2xl border border-white/10 bg-white/60 px-3 py-2.5 text-sm text-sky-950 shadow-sm shadow-sky-950/10 outline-none transition placeholder:text-sky-950/40 focus:border-sky-300/70 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 dark:text-white dark:placeholder:text-white/40";
const SUBCARD =
  "rounded-2xl border border-white/10 bg-white/70 p-5 shadow-sm shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10";
const BTN_SKY =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-sky-200/60 bg-sky-100/80 px-4 py-2 text-sm font-semibold text-sky-950 shadow-sm shadow-sky-900/20 transition hover:-translate-y-0.5 hover:bg-sky-100/90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-400/40 dark:bg-sky-900/30 dark:text-sky-100";
const BTN_EMERALD =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-emerald-200/60 bg-emerald-100/70 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-sm shadow-emerald-900/20 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400/40 dark:bg-emerald-900/30 dark:text-emerald-100";
const BTN_ROSE =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-rose-200/60 bg-rose-100/70 px-3 py-2 text-sm font-semibold text-rose-950 shadow-sm shadow-rose-900/20 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-400/40 dark:bg-rose-900/30 dark:text-rose-100";

const PILL_BASE =
  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold";
const PILL_OK =
  "border border-emerald-200/60 bg-emerald-100/70 text-emerald-900";
const PILL_WARN = "border border-amber-200/60 bg-amber-100/70 text-amber-900";
const PILL_SKY = "border border-sky-200/60 bg-sky-100/70 text-sky-900";

const STACK_EMERALD =
  "rounded-2xl border border-emerald-200/60 bg-emerald-100/30 p-5 shadow-sm shadow-emerald-900/10";
const STACK_ROSE =
  "rounded-2xl border border-rose-200/60 bg-rose-100/30 p-5 shadow-sm shadow-rose-900/10";
const STACK_AMBER =
  "rounded-2xl border border-amber-200/60 bg-amber-100/30 p-5 shadow-sm shadow-amber-900/10";
const STACK_SKY =
  "rounded-2xl border border-sky-200/60 bg-sky-100/20 p-5 shadow-sm shadow-sky-900/10";

const FieldLabel = ({
  htmlFor,
  children,
  required,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
}) => {
  if (htmlFor) {
    return (
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold text-sky-950 dark:text-white"
      >
        {children}
        {required ? <span className="ml-1 text-rose-600">*</span> : null}
      </label>
    );
  }
  return (
    <span className="text-xs font-semibold text-sky-950 dark:text-white">
      {children}
      {required ? <span className="ml-1 text-rose-600">*</span> : null}
    </span>
  );
};

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatDate = (iso?: string) =>
  iso
    ? formatDateInBuenosAires(iso, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "-";

const fmtMoney = (value: number, currency: string) => {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: currency || "ARS",
    }).format(safe);
  } catch {
    return `${currency || "ARS"} ${safe.toFixed(2)}`;
  }
};

const toNumber = (value: string | number | null | undefined) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const normalizeSaleTotals = (input: Record<string, string>) => {
  const out: Record<string, number> = {};
  for (const [rawKey, rawVal] of Object.entries(input || {})) {
    const key = String(rawKey || "").toUpperCase().trim();
    if (!key) continue;
    const value = toNumber(rawVal);
    if (value > 0) out[key] = value;
  }
  return out;
};

const normalizeServiceAdjustmentConfigs = (
  input: BillingAdjustmentConfig[] | BillingAdjustmentComputed[] | null | undefined,
): BillingAdjustmentConfig[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, idx): BillingAdjustmentConfig => {
      const kind: BillingAdjustmentConfig["kind"] =
        item.kind === "tax" ? "tax" : "cost";
      const basis: BillingAdjustmentConfig["basis"] =
        item.basis === "cost" || item.basis === "margin" || item.basis === "sale"
          ? item.basis
          : "sale";
      const valueType: BillingAdjustmentConfig["valueType"] =
        item.valueType === "fixed" ? "fixed" : "percent";
      return {
        id: item.id || `service-adj-${idx}`,
        label: item.label || "Ajuste servicio",
        kind,
        basis,
        valueType,
        value: Number.isFinite(item.value) ? Number(item.value) : 0,
        active: item.active !== false,
        source: "service",
      };
    })
    .filter((item) => item.id.trim() !== "");
};

const emptyBooking = (): BookingDraft => ({
  clientStatus: "Pendiente",
  operatorStatus: "Pendiente",
  status: "Abierta",
  details: "",
  invoice_type: "",
  invoice_observation: "",
  observation: "",
  departure_date: "",
  return_date: "",
  simple_companions: [],
});

const emptyService = (booking?: BookingDraft): ServiceDraft => ({
  id: makeId(),
  type: "",
  description: "",
  sale_price: "",
  cost_price: "",
  tax_21: "",
  tax_105: "",
  exempt: "",
  other_taxes: "",
  card_interest: "",
  card_interest_21: "",
  destination: "",
  reference: "",
  currency: "ARS",
  id_operator: 0,
  departure_date: booking?.departure_date || "",
  return_date: booking?.return_date || "",
  extra_costs_amount: "",
  extra_taxes_amount: "",
  taxableCardInterest: 0,
  vatOnCardInterest: 0,
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
  transfer_fee_pct: 0.024,
  transfer_fee_amount: 0,
  billing_override: null,
  breakdown_warning_messages: [],
  service_adjustments: [],
});

const emptyClient = (): NewClientDraft => ({
  id: makeId(),
  kind: "new",
  profile_key: DEFAULT_CLIENT_PROFILE_KEY,
  first_name: "",
  last_name: "",
  phone: "",
  birth_date: "",
  nationality: "",
  gender: "",
  dni_number: "",
  passport_number: "",
  email: "",
  address: "",
  postal_code: "",
  locality: "",
  company_name: "",
  commercial_address: "",
  tax_id: "",
  custom_fields: {},
});

const isServiceComplete = (
  service: ServiceDraft,
  allowMissingSale = false,
) => {
  const sale = Number(service.sale_price);
  const cost = Number(service.cost_price);
  const saleOk = allowMissingSale ? true : Number.isFinite(sale);
  return (
    service.type.trim() &&
    service.id_operator > 0 &&
    service.currency.trim() &&
    service.departure_date.trim() &&
    service.return_date.trim() &&
    saleOk &&
    Number.isFinite(cost)
  );
};

const ButtonSpinner = () => (
  <span className="inline-flex size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
);

const AdjustmentsPanel = ({
  items,
  totalCosts,
  totalTaxes,
  netCommission,
  format,
}: {
  items: BillingAdjustmentComputed[];
  totalCosts: number;
  totalTaxes: number;
  netCommission: number | null;
  format: (value: number) => string;
}) => {
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
    <div className={SUBCARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
          Ajustes extra
        </p>
        <span className="rounded-full bg-white/40 px-2.5 py-1 text-[11px] font-semibold text-sky-900/70 dark:bg-white/10 dark:text-white/70">
          {items.length} activo{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
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

      <div className="mt-4 grid gap-2 md:grid-cols-2">
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
            Comisión neta (Costos Bancarios + ajustes)
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {format(netCommission)}
          </div>
        </div>
      )}
    </div>
  );
};

const makeAdjustmentId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `adj-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatPercentInput = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  return String(parseFloat((safe * 100).toFixed(4)));
};

const parsePercentInput = (raw: string) => {
  const normalized = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(normalized)) return 0;
  return normalized / 100;
};

const ServiceAdjustmentsEditor = ({
  items,
  onChange,
  disabled = false,
}: {
  items: BillingAdjustmentConfig[];
  onChange: (next: BillingAdjustmentConfig[]) => void;
  disabled?: boolean;
}) => {
  const addItem = () => {
    onChange([
      ...items,
      {
        id: makeAdjustmentId(),
        label: "Ajuste servicio",
        kind: "cost",
        basis: "sale",
        valueType: "percent",
        value: 0,
        active: true,
        source: "service",
      },
    ]);
  };

  const updateItem = (id: string, patch: Partial<BillingAdjustmentConfig>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className={SUBCARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
            Mini ajustes por servicio
          </p>
          <p className="mt-1 text-xs text-sky-900/70 dark:text-white/70">
            Se aplican al servicio actual. En venta total por reserva impactan
            en el cálculo global.
          </p>
        </div>
        <button
          type="button"
          onClick={addItem}
          disabled={disabled}
          className="rounded-full border border-white/20 bg-white/70 px-3 py-1 text-xs font-semibold text-sky-950 shadow-sm shadow-sky-950/10 transition disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/10 dark:text-white"
        >
          Agregar mini ajuste
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-xs text-sky-900/70 dark:text-white/70">
          No hay mini ajustes en este servicio.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-white/10 bg-white/60 p-3 dark:bg-white/5"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <FieldLabel>Nombre</FieldLabel>
                  <input
                    type="text"
                    value={item.label}
                    disabled={disabled}
                    onChange={(e) => updateItem(item.id, { label: e.target.value })}
                    className={INPUT_SOFT}
                  />
                </div>
                <div>
                  <FieldLabel>Tipo</FieldLabel>
                  <select
                    value={item.kind}
                    disabled={disabled}
                    onChange={(e) =>
                      updateItem(item.id, {
                        kind: e.target.value as BillingAdjustmentConfig["kind"],
                      })
                    }
                    className={`${INPUT_SOFT} cursor-pointer`}
                  >
                    <option value="cost">Costo</option>
                    <option value="tax">Impuesto</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Base</FieldLabel>
                  <select
                    value={item.basis}
                    disabled={disabled}
                    onChange={(e) =>
                      updateItem(item.id, {
                        basis: e.target.value as BillingAdjustmentConfig["basis"],
                      })
                    }
                    className={`${INPUT_SOFT} cursor-pointer`}
                  >
                    <option value="sale">Venta</option>
                    <option value="cost">Costo</option>
                    <option value="margin">Ganancia</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Modo</FieldLabel>
                  <select
                    value={item.valueType}
                    disabled={disabled}
                    onChange={(e) =>
                      updateItem(item.id, {
                        valueType:
                          e.target.value as BillingAdjustmentConfig["valueType"],
                      })
                    }
                    className={`${INPUT_SOFT} cursor-pointer`}
                  >
                    <option value="percent">Porcentaje</option>
                    <option value="fixed">Monto fijo</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>
                    {item.valueType === "percent" ? "Valor (%)" : "Valor fijo"}
                  </FieldLabel>
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
                    className={INPUT_SOFT}
                  />
                </div>
                <div className="flex items-end justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-sm text-sky-900 dark:text-white">
                    <input
                      type="checkbox"
                      checked={item.active}
                      disabled={disabled}
                      onChange={(e) =>
                        updateItem(item.id, { active: e.target.checked })
                      }
                      className="size-4 rounded border-white/30 bg-white/30 text-sky-700 shadow-sm shadow-sky-950/10 dark:border-white/20 dark:bg-white/10"
                    />
                    Activo
                  </label>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={disabled}
                    className="rounded-full border border-rose-300/50 bg-rose-100/70 px-3 py-1 text-xs font-semibold text-rose-900 shadow-sm shadow-rose-900/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-300/30 dark:bg-rose-500/10 dark:text-rose-100"
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

const IconTrash = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
    />
  </svg>
);

const IconClock = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    className={className}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
    />
  </svg>
);

const IconPlus = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    className={className}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
  </svg>
);

const IconArrowLeft = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    className={className}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

const IconCheck = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    className={className}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

export default function QuickLoadPage() {
  const { token } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loadingOperators, setLoadingOperators] = useState(false);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [loadingServiceTypes, setLoadingServiceTypes] = useState(false);
  const [serviceTypesError, setServiceTypesError] = useState<string | null>(
    null,
  );
  const [financeCurrencies, setFinanceCurrencies] = useState<
    FinanceCurrency[] | null
  >(null);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);
  const [billingMode, setBillingMode] = useState<"auto" | "manual">("auto");
  const [transferFeePct, setTransferFeePct] = useState(0.024);
  const [inheritedUseBookingSaleTotal, setInheritedUseBookingSaleTotal] =
    useState(false);
  const [useBookingSaleTotal, setUseBookingSaleTotal] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [billingAdjustments, setBillingAdjustments] = useState<
    BillingAdjustmentConfig[]
  >([]);
  const [bookingSaleTotals, setBookingSaleTotals] = useState<
    Record<string, string>
  >({});
  const [clientProfiles, setClientProfiles] = useState<ClientProfileConfig[]>([
    {
      key: DEFAULT_CLIENT_PROFILE_KEY,
      label: DEFAULT_CLIENT_PROFILE_LABEL,
      required_fields: DEFAULT_REQUIRED_FIELDS,
      hidden_fields: [],
      custom_fields: [],
    },
  ]);
  const [useSimpleCompanions, setUseSimpleCompanions] = useState(false);
  const [passengerCategories, setPassengerCategories] = useState<
    PassengerCategory[]
  >([]);
  const [savedCompanions, setSavedCompanions] = useState<
    ClientSimpleCompanion[]
  >([]);
  const [savedCompanionsLoading, setSavedCompanionsLoading] = useState(false);
  const [useSimpleMode, setUseSimpleMode] = useState(false);
  const [calcConfigLoading, setCalcConfigLoading] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [clients, setClients] = useState<ClientDraft[]>([]);
  const [titularId, setTitularId] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingDraft>(emptyBooking);
  const [services, setServices] = useState<ServiceDraft[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const [draftStatus, setDraftStatus] = useState<
    "idle" | "available" | "active"
  >("idle");
  const [storedDraft, setStoredDraft] = useState<QuickLoadDraft | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const normalizedRole = useMemo(
    () => normalizeRole(profile?.role),
    [profile?.role],
  );
  const canOverrideBillingMode = useMemo(
    () =>
      ["administrativo", "gerente", "desarrollador"].includes(normalizedRole),
    [normalizedRole],
  );
  const resolveProfile = useCallback(
    (profileKey?: string) => resolveClientProfile(clientProfiles, profileKey),
    [clientProfiles],
  );

  const getRequiredFieldsForClient = useCallback(
    (client: NewClientDraft) => resolveProfile(client.profile_key).required_fields,
    [resolveProfile],
  );

  const getHiddenFieldsForClient = useCallback(
    (client: NewClientDraft) => resolveProfile(client.profile_key).hidden_fields,
    [resolveProfile],
  );

  const getCustomFieldsForClient = useCallback(
    (client: NewClientDraft) =>
      applyBuiltinMeta(resolveProfile(client.profile_key).custom_fields),
    [resolveProfile],
  );

  const isRequiredField = useCallback(
    (client: NewClientDraft, field: string) =>
      getRequiredFieldsForClient(client).includes(field),
    [getRequiredFieldsForClient],
  );
  const isHiddenField = useCallback(
    (client: NewClientDraft, field: string) =>
      getHiddenFieldsForClient(client).includes(field),
    [getHiddenFieldsForClient],
  );

  const isDocumentRequiredForClient = useCallback(
    (client: NewClientDraft) =>
      getRequiredFieldsForClient(client).includes(DOCUMENT_ANY_KEY),
    [getRequiredFieldsForClient],
  );

  const missingClientFields = useCallback(
    (client: NewClientDraft) => {
      const customFieldsForClient = getCustomFieldsForClient(client);
      return buildMissingClientFields(
        client,
        getRequiredFieldsForClient(client),
        customFieldsForClient,
      );
    },
    [getCustomFieldsForClient, getRequiredFieldsForClient],
  );

  const isClientComplete = (client: ClientDraft) => {
    if (client.kind === "existing") return true;
    return missingClientFields(client).length === 0;
  };

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoadingProfile(true);
    (async () => {
      try {
        const res = await authFetch(
          "/api/user/profile",
          { signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("No se pudo cargar el perfil");
        const data = (await res.json()) as Profile;
        setProfile(data);
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("❌ Error perfil:", err);
          toast.error("No se pudo cargar tu perfil.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingProfile(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!profile?.id_agency || !token) return;
    const controller = new AbortController();
    setLoadingOperators(true);
    (async () => {
      try {
        const res = await authFetch(
          `/api/operators?agencyId=${profile.id_agency}`,
          { signal: controller.signal, cache: "no-store" },
          token,
        );
        if (!res.ok) throw new Error("Error al cargar operadores");
        const data = (await res.json()) as Operator[];
        setOperators(data);
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("❌ Error operadores:", err);
          toast.error("No se pudieron cargar los operadores.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingOperators(false);
      }
    })();
    return () => controller.abort();
  }, [profile?.id_agency, token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoadingServiceTypes(true);
    setServiceTypesError(null);
    (async () => {
      try {
        const res = await authFetch(
          "/api/service-types",
          { cache: "no-store", signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("Error al cargar tipos de servicio");
        const data = await res.json();
        const normalized = normalizeServiceTypes(data);
        if (!controller.signal.aborted) setServiceTypes(normalized);
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("❌ Error tipos de servicio:", err);
          setServiceTypes([]);
          setServiceTypesError("No se pudieron cargar los tipos.");
          toast.error("No se pudieron cargar los tipos de servicio.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingServiceTypes(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoadingCurrencies(true);
    (async () => {
      try {
        const picks = await loadFinancePicks(token);
        if (!controller.signal.aborted) {
          setFinanceCurrencies(picks?.currencies ?? null);
        }
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("❌ Error cargando monedas:", err);
          setFinanceCurrencies(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingCurrencies(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setCalcConfigLoading(true);
    (async () => {
      try {
        const res = await authFetch(
          "/api/service-calc-config",
          { cache: "no-store", signal: controller.signal },
          token,
        );
        if (res.ok) {
          const data = (await res.json()) as {
            billing_breakdown_mode?: string;
            transfer_fee_pct?: number;
            use_booking_sale_total?: boolean;
            billing_adjustments?: BillingAdjustmentConfig[];
          };
          const mode =
            data.billing_breakdown_mode === "manual" ? "manual" : "auto";
          setBillingMode(mode);
          const pct = Number(data.transfer_fee_pct);
          const safePct = Number.isFinite(pct)
            ? Math.min(Math.max(pct, 0), 1)
            : 0.024;
          setTransferFeePct(safePct);
          const inherited = Boolean(data.use_booking_sale_total);
          setInheritedUseBookingSaleTotal(inherited);
          setUseBookingSaleTotal(inherited);
          setBillingAdjustments(
            Array.isArray(data.billing_adjustments)
              ? data.billing_adjustments
              : [],
          );
        }
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("❌ Error cargando config de servicios:", err);
          setInheritedUseBookingSaleTotal(false);
          setUseBookingSaleTotal(false);
          setBillingAdjustments([]);
        }
      } finally {
        if (!controller.signal.aborted) setCalcConfigLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await authFetch(
          "/api/clients/config",
          { cache: "no-store", signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("Error al cargar config de clientes");
        const data = await res.json();
        const config = normalizeClientConfig(data);
        if (!controller.signal.aborted && config) {
          setClientProfiles(config.profiles);
          setClients((prev) =>
            prev.map((client) =>
              client.kind === "new"
                ? {
                    ...client,
                    profile_key: resolveClientProfile(
                      config.profiles,
                      client.profile_key,
                    ).key,
                  }
                : client,
            ),
          );
          setUseSimpleCompanions(Boolean(config.use_simple_companions));
        }
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("❌ Error config clientes:", err);
          setClientProfiles([
            {
              key: DEFAULT_CLIENT_PROFILE_KEY,
              label: DEFAULT_CLIENT_PROFILE_LABEL,
              required_fields: DEFAULT_REQUIRED_FIELDS,
              hidden_fields: [],
              custom_fields: [],
            },
          ]);
          setUseSimpleCompanions(false);
        }
      } finally {
        // nothing else to do
      }
    })();
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await authFetch(
          "/api/passenger-categories",
          { cache: "no-store", signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("Error al cargar categorías de pasajeros");
        const data = (await res.json().catch(() => [])) as PassengerCategory[];
        if (!controller.signal.aborted) setPassengerCategories(data);
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("❌ Error categorías pasajeros:", err);
          setPassengerCategories([]);
        }
      }
    })();
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token || !titularId) {
      setSavedCompanions([]);
      setSavedCompanionsLoading(false);
      return;
    }
    const target = clients.find((c) => c.id === titularId);
    if (!target || target.kind !== "existing") {
      setSavedCompanions([]);
      setSavedCompanionsLoading(false);
      return;
    }
    const controller = new AbortController();
    setSavedCompanionsLoading(true);
    (async () => {
      try {
        const res = await authFetch(
          `/api/client-simple-companions?client_id=${target.existingId}`,
          { cache: "no-store", signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("No se pudieron cargar acompañantes.");
        const data = (await res.json().catch(() => [])) as ClientSimpleCompanion[];
        if (!controller.signal.aborted) {
          setSavedCompanions(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!controller.signal.aborted) setSavedCompanions([]);
      } finally {
        if (!controller.signal.aborted) setSavedCompanionsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, titularId, clients]);

  useEffect(() => {
    if (
      !canOverrideBillingMode ||
      billingMode === "manual" ||
      useBookingSaleTotal
    ) {
      setManualOverride(false);
    }
  }, [billingMode, canOverrideBillingMode, useBookingSaleTotal]);

  useEffect(() => {
    setUseSimpleMode(useSimpleCompanions);
  }, [useSimpleCompanions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) {
      setDraftStatus("active");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as QuickLoadDraft;
      if (parsed && parsed.clients && parsed.booking) {
        setStoredDraft(parsed);
        setDraftStatus("available");
        setLastSavedAt(parsed.updatedAt || null);
      } else {
        setDraftStatus("active");
      }
    } catch {
      setDraftStatus("active");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (draftStatus !== "active") return;
    const payload: QuickLoadDraft = {
      step,
      clients,
      titularId,
      booking,
      services,
      useBookingSaleTotal,
      bookingSaleTotals,
      manualOverride,
      updatedAt: new Date().toISOString(),
    };
    const t = window.setTimeout(() => {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      setLastSavedAt(payload.updatedAt);
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    draftStatus,
    step,
    clients,
    titularId,
    booking,
    services,
    useBookingSaleTotal,
    bookingSaleTotals,
    manualOverride,
  ]);

  const recoverDraft = () => {
    if (!storedDraft) return;
    setClients(
      (storedDraft.clients || []).map((client) =>
        client.kind === "new"
          ? {
              ...client,
              profile_key: resolveProfile(client.profile_key).key,
            }
          : client,
      ),
    );
    setTitularId(storedDraft.titularId ?? null);
    setBooking(storedDraft.booking || emptyBooking());
    setServices(storedDraft.services || []);
    setUseBookingSaleTotal(Boolean(storedDraft.useBookingSaleTotal));
    setBookingSaleTotals(storedDraft.bookingSaleTotals || {});
    setManualOverride(Boolean(storedDraft.manualOverride));
    setStep(
      storedDraft.step === 1 ||
        storedDraft.step === 2 ||
        storedDraft.step === 3 ||
        storedDraft.step === 4
        ? storedDraft.step
        : 1,
    );
    setDraftStatus("active");
    toast.success("Borrador recuperado.");
  };

  const discardDraft = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(DRAFT_KEY);
    }
    setStoredDraft(null);
    setDraftStatus("active");
    toast.info("Borrador descartado.");
  };

  const addNewClient = () => {
    const draft = {
      ...emptyClient(),
      profile_key: resolveClientProfile(clientProfiles, undefined).key,
    };
    setClients((prev) => [...prev, draft]);
    if (!titularId) setTitularId(draft.id);
  };

  const addExistingClient = (client: Client) => {
    const exists = clients.some(
      (c) => c.kind === "existing" && c.existingId === client.id_client,
    );
    if (exists) {
      toast.info("Ese pax ya está en la lista.");
      return;
    }
    const draft: ExistingClientDraft = {
      id: `existing-${client.id_client}`,
      kind: "existing",
      existingId: client.id_client,
      snapshot: {
        first_name: client.first_name,
        last_name: client.last_name,
        birth_date: client.birth_date,
        dni_number: client.dni_number,
        passport_number: client.passport_number,
        email: client.email,
        address: client.address,
        postal_code: client.postal_code,
        locality: client.locality,
        company_name: client.company_name,
        commercial_address: client.commercial_address,
        tax_id: client.tax_id,
      },
    };
    setClients((prev) => [...prev, draft]);
    if (!titularId) setTitularId(draft.id);
    setPickerKey((prev) => prev + 1);
    toast.success("Pax agregado.");
  };

  const removeClient = (id: string) => {
    setClients((prev) => prev.filter((c) => c.id !== id));
    setTitularId((prev) => {
      if (prev !== id) return prev;
      const remaining = clients.filter((c) => c.id !== id);
      return remaining[0]?.id ?? null;
    });
  };

  const updateClientField = (
    id: string,
    field: keyof NewClientDraft,
    value: string | number | null,
  ) => {
    setClients((prev) =>
      prev.map((c) =>
        c.id === id && c.kind === "new"
          ? field === "profile_key"
            ? (() => {
                const profile = resolveProfile(String(value ?? ""));
                const allowedKeys = new Set(
                  profile.custom_fields.map((item) => item.key),
                );
                const nextCustom = Object.fromEntries(
                  Object.entries(c.custom_fields || {}).filter(([key]) =>
                    allowedKeys.has(key),
                  ),
                );
                return {
                  ...c,
                  profile_key: profile.key,
                  custom_fields: nextCustom,
                };
              })()
            : { ...c, [field]: value }
          : c,
      ),
    );
  };

  const updateClientCustomField = (id: string, key: string, value: string) => {
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.kind !== "new") return c;
        const nextCustom = { ...(c.custom_fields || {}) };
        nextCustom[key] = value;
        return { ...c, custom_fields: nextCustom };
      }),
    );
  };

  const handleNationalitySelect = (
    id: string,
    val: DestinationOption | DestinationOption[] | null,
  ) => {
    const label = Array.isArray(val)
      ? val.map((opt) => opt.displayLabel).join(", ")
      : val?.displayLabel || "";
    updateClientField(id, "nationality", label);
  };

  const updateBookingField = (field: keyof BookingDraft, value: string) => {
    setBooking((prev) => ({ ...prev, [field]: value }));
  };

  const addSimpleCompanion = () => {
    setBooking((prev) => ({
      ...prev,
      simple_companions: [
        ...(prev.simple_companions || []),
        { category_id: null, age: null, notes: "" },
      ],
    }));
  };

  const updateSimpleCompanion = (
    index: number,
    patch: { category_id?: number | null; age?: number | null; notes?: string },
  ) => {
    setBooking((prev) => {
      const next = Array.isArray(prev.simple_companions)
        ? [...prev.simple_companions]
        : [];
      const current = next[index] || {};
      next[index] = { ...current, ...patch };
      return { ...prev, simple_companions: next };
    });
  };

  const removeSimpleCompanion = (index: number) => {
    setBooking((prev) => {
      const next = Array.isArray(prev.simple_companions)
        ? [...prev.simple_companions]
        : [];
      next.splice(index, 1);
      return { ...prev, simple_companions: next };
    });
  };

  const addSavedCompanion = (comp: ClientSimpleCompanion) => {
    setBooking((prev) => {
      const next = Array.isArray(prev.simple_companions)
        ? [...prev.simple_companions]
        : [];
      const exists = next.some(
        (c) =>
          (c.category_id ?? null) === (comp.category_id ?? null) &&
          (c.age ?? null) === (comp.age ?? null) &&
          String(c.notes ?? "") === String(comp.notes ?? ""),
      );
      if (!exists) {
        next.push({
          category_id: comp.category_id ?? null,
          age: comp.age ?? null,
          notes: comp.notes ?? null,
        });
      }
      return { ...prev, simple_companions: next };
    });
  };

  const updateBookingSaleTotal = (currency: string, value: string) => {
    setBookingSaleTotals((prev) => ({ ...prev, [currency]: value }));
  };

  const presetCacheRef = useRef<Map<string, ServiceTypePresetLite[]>>(new Map());

  const simpleCompanionCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    if (!Array.isArray(booking.simple_companions)) return counts;
    booking.simple_companions.forEach((c) => {
      const id = c.category_id;
      if (typeof id !== "number" || !Number.isFinite(id)) return;
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }, [booking.simple_companions]);

  const passengerCategoryCounts = useMemo(() => {
    return { ...simpleCompanionCounts };
  }, [simpleCompanionCounts]);

  const addService = () => {
    setServices((prev) => [
      ...prev,
      { ...emptyService(booking), transfer_fee_pct: transferFeePct },
    ]);
  };

  const removeService = (id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
  };

  const updateServiceField = (
    id: string,
    field: keyof ServiceDraft,
    value: string | number,
  ) => {
    const resetBilling: Partial<ServiceDraft> = {
      taxableCardInterest: 0,
      vatOnCardInterest: 0,
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
      transfer_fee_amount: 0,
      billing_override: null,
      breakdown_warning_messages: [],
    };
    const billingInputs = new Set<keyof ServiceDraft>([
      "sale_price",
      "cost_price",
      "tax_21",
      "tax_105",
      "exempt",
      "other_taxes",
      "card_interest",
      "card_interest_21",
    ]);
    setServices((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, [field]: value };
        return billingInputs.has(field) ? { ...next, ...resetBilling } : next;
      }),
    );

    if (field === "type" || field === "id_operator") {
      const nextType =
        field === "type"
          ? String(value)
          : services.find((s) => s.id === id)?.type;
      const nextOperator =
        field === "id_operator"
          ? Number(value)
          : services.find((s) => s.id === id)?.id_operator ?? 0;
      const serviceTypeId =
        serviceTypes.find((t) => t.value === nextType)?.id ?? null;
      if (serviceTypeId) {
        void applyPresetForService(id, serviceTypeId, nextOperator);
      }
    }
  };

  const updateServiceAdjustments = useCallback(
    (id: string, adjustments: BillingAdjustmentConfig[]) => {
      const normalized = normalizeServiceAdjustmentConfigs(adjustments);
      setServices((prev) =>
        prev.map((service) =>
          service.id === id
            ? {
                ...service,
                service_adjustments: normalized,
              }
            : service,
        ),
      );
    },
    [],
  );

  const applyPresetForService = async (
    serviceId: string,
    serviceTypeId: number,
    operatorId: number,
  ) => {
    if (!token) return;
    const cacheKey = `${serviceTypeId}:${operatorId || 0}`;
    let presets = presetCacheRef.current.get(cacheKey);
    if (!presets) {
      const fetchPresets = async (withOperator: boolean) => {
        const qs = new URLSearchParams();
        qs.set("service_type_id", String(serviceTypeId));
        qs.set("enabled", "true");
        if (withOperator && operatorId > 0) {
          qs.set("operator_id", String(operatorId));
        }
        const res = await authFetch(
          `/api/service-type-presets?${qs.toString()}`,
          { cache: "no-store" },
          token,
        );
        if (!res.ok) return [];
        const data = (await res.json().catch(() => [])) as ServiceTypePresetLite[];
        return Array.isArray(data) ? data : [];
      };
      if (operatorId > 0) {
        presets = await fetchPresets(true);
      }
      if (!presets || presets.length === 0) {
        presets = await fetchPresets(false);
      }
      presetCacheRef.current.set(cacheKey, presets || []);
    }

    const sorted = (presets || [])
      .filter((p) => p && p.items && p.items.length > 0 && p.enabled !== false)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const preset = sorted[0];
    if (!preset) return;

    let totalCount = 0;
    let saleTotal = 0;
    let costTotal = 0;
    const parts: string[] = [];
    for (const item of preset.items) {
      const count = Number(passengerCategoryCounts[item.category_id] || 0);
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
    setServices((prev) =>
      prev.map((s) =>
        s.id === serviceId
          ? {
              ...s,
              sale_price: String(saleTotal),
              cost_price: String(costTotal),
              currency: preset.currency || s.currency,
              description: parts.length ? parts.join(", ") : s.description,
            }
          : s,
      ),
    );
  };

  const updateServiceBilling = useCallback(
    (id: string, data: BillingData) => {
      setServices((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          if (s.id !== id) return s;
          const billingOverridePayload = composeBillingOverridePayload({
            values: data.breakdownOverride,
            meta: {
              commissionVatMode: data.commissionVatMode,
              grossIncomeTaxEnabled: data.grossIncomeTaxEnabled,
              grossIncomeTaxBase: data.grossIncomeTaxBase,
              grossIncomeTaxPct: data.grossIncomeTaxPct,
              grossIncomeTaxAmount: data.grossIncomeTaxAmount,
            },
          });
          const nextValues = {
            nonComputable: data.nonComputable ?? 0,
            taxableBase21: data.taxableBase21 ?? 0,
            taxableBase10_5: data.taxableBase10_5 ?? 0,
            commissionExempt: data.commissionExempt ?? 0,
            commission21: data.commission21 ?? 0,
            commission10_5: data.commission10_5 ?? 0,
            vatOnCommission21: data.vatOnCommission21 ?? 0,
            vatOnCommission10_5: data.vatOnCommission10_5 ?? 0,
            totalCommissionWithoutVAT: data.totalCommissionWithoutVAT ?? 0,
            impIVA: data.impIVA ?? 0,
            taxableCardInterest: data.taxableCardInterest ?? 0,
            vatOnCardInterest: data.vatOnCardInterest ?? 0,
            transfer_fee_pct: data.transferFeePct ?? transferFeePct,
            transfer_fee_amount: data.transferFeeAmount ?? 0,
            billing_override: billingOverridePayload,
            breakdown_warning_messages: Array.isArray(
              data.breakdownWarningMessages,
            )
              ? data.breakdownWarningMessages
              : [],
          };
          const numericSame = (
            [
              "nonComputable",
              "taxableBase21",
              "taxableBase10_5",
              "commissionExempt",
              "commission21",
              "commission10_5",
              "vatOnCommission21",
              "vatOnCommission10_5",
              "totalCommissionWithoutVAT",
              "impIVA",
              "taxableCardInterest",
              "vatOnCardInterest",
              "transfer_fee_pct",
              "transfer_fee_amount",
            ] as const
          ).every((key) => (s as Record<string, unknown>)[key] === nextValues[key]);
          const sameOverride =
            JSON.stringify(s.billing_override ?? null) ===
            JSON.stringify(nextValues.billing_override ?? null);
          const sameWarnings =
            JSON.stringify(s.breakdown_warning_messages || []) ===
            JSON.stringify(nextValues.breakdown_warning_messages || []);
          const same = numericSame && sameOverride && sameWarnings;
          if (same) return s;
          changed = true;
          return { ...s, ...nextValues };
        });
        return changed ? next : prev;
      });
    },
    [transferFeePct],
  );

  const handleDestinationSelect = (
    id: string,
    val: DestinationOption | DestinationOption[] | null,
  ) => {
    const label = Array.isArray(val)
      ? val.map((opt) => opt.displayLabel).join(", ")
      : val?.displayLabel || "";
    updateServiceField(id, "destination", label);
  };

  const servicesReady = services.every((s) =>
    isServiceComplete(s, useBookingSaleTotal),
  );
  const nextSaleTotalOverridePayload = useMemo(
    () =>
      useBookingSaleTotal === inheritedUseBookingSaleTotal
        ? null
        : useBookingSaleTotal,
    [inheritedUseBookingSaleTotal, useBookingSaleTotal],
  );
  const manualMode =
    useBookingSaleTotal ||
    billingMode === "manual" ||
    (canOverrideBillingMode && manualOverride);
  const canManualOverride =
    canOverrideBillingMode && billingMode === "auto" && !useBookingSaleTotal;
  const canOverrideSaleTotal = canOverrideBillingMode;
  const currencyOptions = useMemo(() => {
    const configured = (financeCurrencies || [])
      .filter((currency) => currency.enabled)
      .map((currency) => currency.code.toUpperCase())
      .filter(Boolean);
    const unique = Array.from(new Set(configured)).sort((a, b) =>
      a.localeCompare(b, "es"),
    );
    return unique.length > 0 ? unique : ["ARS", "USD"];
  }, [financeCurrencies]);

  const adjustmentsByServiceId = useMemo(() => {
    const map = new Map<string, AdjustmentTotals>();
    services.forEach((service) => {
      const serviceAdjustments = normalizeServiceAdjustmentConfigs(
        service.service_adjustments,
      );
      const combinedAdjustments = [
        ...billingAdjustments.map((item) => ({ ...item, source: "global" as const })),
        ...serviceAdjustments.map((item) => ({ ...item, source: "service" as const })),
      ];
      if (useBookingSaleTotal) {
        map.set(service.id, {
          items: combinedAdjustments.map((item) => ({ ...item, amount: 0 })),
          totalCosts: 0,
          totalTaxes: 0,
          total: 0,
        });
        return;
      }
      const sale = toNumber(service.sale_price);
      const cost = toNumber(service.cost_price);
      map.set(service.id, computeBillingAdjustments(combinedAdjustments, sale, cost));
    });
    return map;
  }, [services, billingAdjustments, useBookingSaleTotal]);

  const goToStep = (target: 1 | 2 | 3 | 4) => {
    setStep(target);
  };

  const missingSummary = useMemo(() => {
    const missing: string[] = [];
    const currenciesForTotals =
      services.length > 0
        ? Array.from(
            new Set(services.map((s) => (s.currency || "ARS").toUpperCase())),
          )
        : ["ARS"];
    if (clients.length === 0) {
      missing.push("Agregar al menos un pax.");
    }
    if (!titularId) {
      missing.push("Definir un titular.");
    }
    const incompleteClients = clients.filter(
      (c) => c.kind === "new" && missingClientFields(c).length > 0,
    ).length;
    if (incompleteClients > 0) {
      const paxLabel = incompleteClients === 1 ? "pax" : "pasajeros";
      missing.push(
        `Completar ${incompleteClients} ${paxLabel} con datos obligatorios.`,
      );
    }
    if (!booking.details.trim()) {
      missing.push("Completar el detalle de la reserva.");
    }
    if (!booking.departure_date.trim()) {
      missing.push("Completar la fecha de salida.");
    }
    if (!booking.return_date.trim()) {
      missing.push("Completar la fecha de regreso.");
    }
    if (!booking.invoice_type.trim()) {
      missing.push("Seleccionar el tipo de factura.");
    }
    if (useBookingSaleTotal) {
      const missingTotals = currenciesForTotals.filter((cur) => {
        const raw = bookingSaleTotals[cur];
        return raw == null || toNumber(raw) <= 0;
      });
      if (missingTotals.length > 0) {
        missing.push(
          `Completar venta total (${missingTotals.join(", ")}).`,
        );
      }
    }
    if (services.length > 0 && !servicesReady) {
      missing.push("Revisar servicios incompletos.");
    }
    return missing;
  }, [
    bookingSaleTotals,
    clients,
    missingClientFields,
    titularId,
    booking.details,
    booking.departure_date,
    booking.return_date,
    booking.invoice_type,
    services,
    servicesReady,
    useBookingSaleTotal,
  ]);

  const canConfirm = missingSummary.length === 0 && !saving;

  const summaryServices = useMemo(() => {
    return services.map((service, idx) => {
      const adjustments = adjustmentsByServiceId.get(service.id) ?? EMPTY_ADJUSTMENTS;
      const billingMeta = extractBillingOverrideMeta(service.billing_override);
      const iibbAmount =
        billingMeta?.grossIncomeTaxEnabled === true
          ? Number(billingMeta.grossIncomeTaxAmount || 0)
          : 0;
      const iibbAdjustment: BillingAdjustmentComputed | null =
        iibbAmount > 0
          ? {
              id: "gross-income-tax",
              label: "Ingresos Brutos",
              kind: "tax",
              basis:
                billingMeta?.grossIncomeTaxBase === "sale" ? "sale" : "margin",
              valueType: "percent",
              value: Number(billingMeta?.grossIncomeTaxPct || 0) / 100,
              active: true,
              source: "global",
              amount: iibbAmount,
            }
          : null;
      const effectiveExtraAdjustments = iibbAdjustment
        ? [...adjustments.items, iibbAdjustment]
        : adjustments.items;

      return {
        id_service: idx + 1,
        type: service.type,
        description: service.description,
        sale_price: toNumber(service.sale_price),
        cost_price: toNumber(service.cost_price),
        destination: service.destination,
        reference: service.reference,
        tax_21: toNumber(service.tax_21),
        tax_105: toNumber(service.tax_105),
        exempt: toNumber(service.exempt),
        other_taxes: toNumber(service.other_taxes),
        card_interest: toNumber(service.card_interest),
        card_interest_21: toNumber(service.card_interest_21),
        taxableCardInterest: service.taxableCardInterest,
        vatOnCardInterest: service.vatOnCardInterest,
        nonComputable: service.nonComputable,
        taxableBase21: service.taxableBase21,
        taxableBase10_5: service.taxableBase10_5,
        commissionExempt: service.commissionExempt,
        commission21: service.commission21,
        commission10_5: service.commission10_5,
        vatOnCommission21: service.vatOnCommission21,
        vatOnCommission10_5: service.vatOnCommission10_5,
        totalCommissionWithoutVAT: service.totalCommissionWithoutVAT,
        impIVA: service.impIVA,
        transfer_fee_pct: Number.isFinite(service.transfer_fee_pct)
          ? service.transfer_fee_pct
          : transferFeePct,
        transfer_fee_amount: service.transfer_fee_amount,
        extra_costs_amount: adjustments.totalCosts,
        extra_taxes_amount: adjustments.totalTaxes + iibbAmount,
        extra_adjustments: effectiveExtraAdjustments,
        currency: service.currency,
        departure_date: service.departure_date,
        return_date: service.return_date,
        booking_id: 0,
        id_operator: service.id_operator,
        created_at: new Date().toISOString(),
      };
    });
  }, [services, transferFeePct, adjustmentsByServiceId]);

  const totalsByCurrency = useMemo(() => {
    const zero = {
      sale_price: 0,
      cost_price: 0,
      tax_21: 0,
      tax_105: 0,
      exempt: 0,
      other_taxes: 0,
      taxableCardInterest: 0,
      vatOnCardInterest: 0,
      nonComputable: 0,
      taxableBase21: 0,
      taxableBase10_5: 0,
      commissionExempt: 0,
      commission21: 0,
      commission10_5: 0,
      vatOnCommission21: 0,
      vatOnCommission10_5: 0,
      totalCommissionWithoutVAT: 0,
      cardInterestRaw: 0,
      transferFeesAmount: 0,
      extra_costs_amount: 0,
      extra_taxes_amount: 0,
    };

    return summaryServices.reduce<Record<string, typeof zero>>((acc, s) => {
      const c = (s.currency || "ARS").toUpperCase();
      if (!acc[c]) acc[c] = { ...zero };
      const t = acc[c];

      t.sale_price += toNumber(s.sale_price);
      t.cost_price += toNumber(s.cost_price);
      t.tax_21 += toNumber(s.tax_21);
      t.tax_105 += toNumber(s.tax_105);
      t.exempt += toNumber(s.exempt);
      t.other_taxes += toNumber(s.other_taxes);
      t.taxableCardInterest += toNumber(s.taxableCardInterest);
      t.vatOnCardInterest += toNumber(s.vatOnCardInterest);
      t.nonComputable += toNumber(s.nonComputable);
      t.taxableBase21 += toNumber(s.taxableBase21);
      t.taxableBase10_5 += toNumber(s.taxableBase10_5);
      t.commissionExempt += toNumber(s.commissionExempt);
      t.commission21 += toNumber(s.commission21);
      t.commission10_5 += toNumber(s.commission10_5);
      t.vatOnCommission21 += toNumber(s.vatOnCommission21);
      t.vatOnCommission10_5 += toNumber(s.vatOnCommission10_5);
      t.totalCommissionWithoutVAT += toNumber(s.totalCommissionWithoutVAT);
      t.extra_costs_amount += toNumber(s.extra_costs_amount);
      t.extra_taxes_amount += toNumber(s.extra_taxes_amount);

      const split =
        toNumber(s.taxableCardInterest) + toNumber(s.vatOnCardInterest);
      if (split <= 0) {
        t.cardInterestRaw += toNumber(s.card_interest);
      }

      const pct =
        typeof s.transfer_fee_pct === "number" &&
        Number.isFinite(s.transfer_fee_pct)
          ? s.transfer_fee_pct
          : transferFeePct;
      const feeAmount =
        Number.isFinite(s.transfer_fee_amount)
          ? s.transfer_fee_amount
          : toNumber(s.sale_price) * pct;
      t.transferFeesAmount += feeAmount;

      return acc;
    }, {});
  }, [summaryServices, transferFeePct]);

  const summaryCurrencies = useMemo(() => {
    const set = new Set<string>();
    summaryServices.forEach((s) =>
      set.add((s.currency || "ARS").toUpperCase()),
    );
    if (set.size === 0) set.add("ARS");
    return Array.from(set);
  }, [summaryServices]);

  const buildClientIds = async () => {
    if (!token) throw new Error("Sin sesión");
    const idMap = new Map<string, number>();
    for (const client of clients) {
      if (client.kind === "existing") {
        idMap.set(client.id, client.existingId);
        continue;
      }
      const missing = missingClientFields(client);
      if (missing.length) {
        throw new Error(`Pax incompleto: ${missing.join(", ")}`);
      }

      const res = await authFetch(
        "/api/clients",
        {
          method: "POST",
          body: JSON.stringify({
            first_name: client.first_name,
            last_name: client.last_name,
            profile_key: client.profile_key,
            phone: client.phone,
            birth_date: client.birth_date,
            nationality: client.nationality,
            gender: client.gender,
            dni_number: client.dni_number,
            passport_number: client.passport_number,
            email: client.email,
            address: client.address,
            postal_code: client.postal_code,
            locality: client.locality,
            company_name: client.company_name,
            commercial_address: client.commercial_address,
            tax_id: client.tax_id,
            custom_fields: client.custom_fields ?? {},
          }),
        },
        token,
      );

      if (!res.ok) {
        let msg = "No se pudo guardar el pax. Revisá los datos e intentá nuevamente.";
        try {
          const err = await res.json();
          if (err?.error) msg = humanizeCreatePaxError(err.error);
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const created = (await res.json()) as Client;
      idMap.set(client.id, created.id_client);
    }
    return idMap;
  };

  const validateFacturaA = async (titularLocalId: string) => {
    if (booking.invoice_type !== "Factura A") return true;
    const titular = clients.find((c) => c.id === titularLocalId);
    if (!titular) {
      toast.error("Seleccioná un titular válido.");
      return false;
    }
    if (titular.kind === "new") {
      const missing = [];
      if (!titular.company_name.trim()) missing.push("Razón social");
      if (!titular.commercial_address.trim())
        missing.push("Domicilio comercial");
      if (!titular.email.trim()) missing.push("Email");
      if (!titular.tax_id.trim()) missing.push("CUIT");
      if (missing.length) {
        toast.error(
          `Para Factura A faltan datos del titular: ${missing.join(", ")}.`,
        );
        return false;
      }
      return true;
    }
    if (!token) return false;
    const existingId = titular.existingId;
    const res = await authFetch(
      `/api/clients/${existingId}`,
      { cache: "no-store" },
      token,
    );
    if (!res.ok) {
      toast.error("No se pudo validar el titular.");
      return false;
    }
    const data = (await res.json()) as Client;
    if (
      !data.company_name?.trim() ||
      !data.commercial_address?.trim() ||
      !data.email?.trim() ||
      !data.tax_id?.trim()
    ) {
      toast.error(
        "Para Factura A, el titular debe tener Razón Social, Domicilio Comercial, Email y CUIT.",
      );
      return false;
    }
    return true;
  };

  const handleConfirm = async () => {
    if (missingSummary.length > 0) {
      toast.error("Hay datos pendientes antes de confirmar.");
      return;
    }
    if (!titularId || !profile?.id_user) {
      toast.error("Titular o perfil inválido.");
      return;
    }
    if (!token) {
      toast.error("Sesión vencida.");
      return;
    }
    setSaving(true);
    try {
      const facturaOk = await validateFacturaA(titularId);
      if (!facturaOk) {
        setSaving(false);
        return;
      }
      const idMap = await buildClientIds();
      const titularBackendId = idMap.get(titularId);
      if (!titularBackendId) throw new Error("Titular inválido.");
      const companions = clients
        .filter((c) => c.id !== titularId)
        .map((c) => idMap.get(c.id))
        .filter((id): id is number => typeof id === "number");
      const simpleCompanions = Array.isArray(booking.simple_companions)
        ? booking.simple_companions
            .map((c) => {
              if (!c) return null;
              const category_id =
                c.category_id != null ? Number(c.category_id) : null;
              const age = c.age != null ? Number(c.age) : null;
              const notes =
                typeof c.notes === "string" && c.notes.trim()
                  ? c.notes.trim()
                  : null;
              const safeCategory =
                category_id != null && Number.isFinite(category_id) && category_id > 0
                  ? Math.floor(category_id)
                  : null;
              const safeAge =
                age != null && Number.isFinite(age) && age >= 0
                  ? Math.floor(age)
                  : null;
              if (safeCategory == null && safeAge == null && !notes) return null;
              return { category_id: safeCategory, age: safeAge, notes };
            })
            .filter(Boolean)
        : [];

      const payload = {
        clientStatus: booking.clientStatus,
        operatorStatus: booking.operatorStatus,
        status: booking.status,
        details: booking.details,
        invoice_type: booking.invoice_type,
        invoice_observation:
          booking.invoice_observation.trim() || "Sin observaciones",
        observation: booking.observation,
        titular_id: titularBackendId,
        departure_date: booking.departure_date,
        return_date: booking.return_date,
        pax_count: 1 + companions.length + simpleCompanions.length,
        clients_ids: companions,
        simple_companions: simpleCompanions,
        id_user: profile.id_user,
      };

      const bookingRes = await authFetch(
        "/api/bookings",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      );

      if (!bookingRes.ok) {
        let msg = "Error al crear la reserva.";
        try {
          const err = await bookingRes.json();
          if (err?.error) msg = String(err.error);
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const createdBooking = (await bookingRes.json()) as {
        id_booking: number;
      };

      const saleTotals = normalizeSaleTotals(bookingSaleTotals);
      const shouldPersistSaleMode =
        nextSaleTotalOverridePayload !== null ||
        Object.keys(saleTotals).length > 0;
      if (shouldPersistSaleMode) {
        const updateRes = await authFetch(
          `/api/bookings/${createdBooking.id_booking}`,
          {
            method: "PUT",
            body: JSON.stringify({
              ...payload,
              clients_ids: companions,
              ...(Object.keys(saleTotals).length > 0
                ? { sale_totals: saleTotals }
                : {}),
              use_booking_sale_total_override: nextSaleTotalOverridePayload,
            }),
          },
          token,
        );
        if (!updateRes.ok) {
          toast.error("No se pudo guardar la configuración de venta general.");
        }
      }

      for (const service of services) {
        const transferPct = Number.isFinite(service.transfer_fee_pct)
          ? service.transfer_fee_pct
          : transferFeePct || 0.024;
        const transferAmount =
          Number.isFinite(service.transfer_fee_amount)
            ? (service.transfer_fee_amount as number)
            : toNumber(service.sale_price) * transferPct;
        const adjustments =
          adjustmentsByServiceId.get(service.id) ?? EMPTY_ADJUSTMENTS;
        const billingMeta = extractBillingOverrideMeta(service.billing_override);
        const iibbAmount =
          billingMeta?.grossIncomeTaxEnabled === true
            ? Number(billingMeta.grossIncomeTaxAmount || 0)
            : 0;
        const iibbAdjustment: BillingAdjustmentComputed | null =
          iibbAmount > 0
            ? {
                id: "gross-income-tax",
                label: "Ingresos Brutos",
                kind: "tax",
                basis:
                  billingMeta?.grossIncomeTaxBase === "sale"
                    ? "sale"
                    : "margin",
                valueType: "percent",
                value: Number(billingMeta?.grossIncomeTaxPct || 0) / 100,
                active: true,
                source: "global",
                amount: iibbAmount,
              }
            : null;
        const effectiveExtraAdjustments = iibbAdjustment
          ? [...adjustments.items, iibbAdjustment]
          : adjustments.items;
        const servicePayload = {
          type: service.type,
          description: service.description,
          sale_price: toNumber(service.sale_price),
          cost_price: toNumber(service.cost_price),
          tax_21: toNumber(service.tax_21),
          tax_105: toNumber(service.tax_105),
          exempt: toNumber(service.exempt),
          other_taxes: toNumber(service.other_taxes),
          card_interest: toNumber(service.card_interest),
          card_interest_21: toNumber(service.card_interest_21),
          taxableCardInterest: service.taxableCardInterest,
          vatOnCardInterest: service.vatOnCardInterest,
          nonComputable: service.nonComputable,
          taxableBase21: service.taxableBase21,
          taxableBase10_5: service.taxableBase10_5,
          commissionExempt: service.commissionExempt,
          commission21: service.commission21,
          commission10_5: service.commission10_5,
          vatOnCommission21: service.vatOnCommission21,
          vatOnCommission10_5: service.vatOnCommission10_5,
          totalCommissionWithoutVAT: service.totalCommissionWithoutVAT,
          impIVA: service.impIVA,
          transfer_fee_pct: transferPct,
          transfer_fee_amount: transferAmount,
          billing_override: service.billing_override ?? null,
          extra_costs_amount: adjustments.totalCosts,
          extra_taxes_amount: adjustments.totalTaxes + iibbAmount,
          extra_adjustments: effectiveExtraAdjustments,
          destination: service.destination,
          reference: service.reference,
          currency: service.currency,
          departure_date: service.departure_date,
          return_date: service.return_date,
          id_operator: service.id_operator,
          booking_id: createdBooking.id_booking,
        };

        const res = await authFetch(
          "/api/services",
          { method: "POST", body: JSON.stringify(servicePayload) },
          token,
        );
        if (!res.ok) {
          let msg = "Error al crear un servicio.";
          try {
            const err = await res.json();
            if (err?.error) msg = String(err.error);
          } catch {
            // ignore
          }
          throw new Error(msg);
        }
      }

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DRAFT_KEY);
      }

      toast.success("Carga rápida confirmada. Abriendo la reserva...");
      router.push(`/bookings/services/${createdBooking.id_booking}`);
    } catch (err) {
      console.error("❌ Error confirmando carga rápida:", err);
      toast.error(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setSaving(false);
    }
  };

  const totalPax =
    clients.length +
    (Array.isArray(booking.simple_companions)
      ? booking.simple_companions.length
      : 0);
  const clientCountLabel = `${totalPax} ${totalPax === 1 ? "pax" : "pasajeros"}`;
  const serviceCountLabel = `${services.length} servicio${services.length === 1 ? "" : "s"}`;

  const titularLabel = useMemo(() => {
    const target = clients.find((c) => c.id === titularId);
    if (!target) return "Sin titular";
    if (target.kind === "existing") {
      return `${target.snapshot.first_name} ${target.snapshot.last_name}`;
    }
    return `${target.first_name || "Titular"} ${target.last_name || ""}`.trim();
  }, [clients, titularId]);

  const operatorMap = useMemo(() => {
    const map = new Map<number, Operator>();
    operators.forEach((op) => map.set(op.id_operator, op));
    return map;
  }, [operators]);

  return (
    <ProtectedRoute>
      <section className="space-y-8 text-sky-950 dark:text-white">
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-3xl text-sky-950 dark:text-white"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-sky-700/70 dark:text-white/60">
                carga rápida
              </p>
              <h1 className="text-3xl font-semibold">Carga rápida</h1>
              <p className="max-w-2xl text-sm text-sky-900/70 dark:text-white/70">
                Pasajeros, reserva y servicios en un solo flujo.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`${PILL_BASE} ${PILL_SKY}`}>
                {clientCountLabel}
              </span>
              <span className={`${PILL_BASE} ${PILL_SKY}`}>
                {serviceCountLabel}
              </span>
              <span className={`${PILL_BASE} ${PILL_OK}`}>
                Titular: {titularLabel}
              </span>
            </div>
          </div>
        </motion.header>

        {draftStatus === "available" && storedDraft && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200/60 bg-amber-100/40 px-4 py-2 text-xs text-amber-950 shadow-sm shadow-amber-900/10 dark:border-amber-200/30 dark:bg-amber-200/10 dark:text-amber-100"
          >
            <div className="flex flex-wrap items-center gap-2">
              <IconClock className="size-4" />
              <span className="font-semibold">Borrador disponible</span>
              <span className="text-[11px] opacity-70">
                Actualizado {formatDate(lastSavedAt || undefined)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300/60 bg-emerald-200/60 px-3 py-1 text-[11px] font-semibold text-emerald-950 transition hover:bg-emerald-200/80 dark:border-emerald-300/30 dark:bg-emerald-500/20 dark:text-emerald-50"
                onClick={recoverDraft}
              >
                <IconCheck className="size-4" />
                Recuperar
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-rose-300/60 bg-rose-100/60 px-3 py-1 text-[11px] font-semibold text-rose-900 transition hover:bg-rose-100/80 dark:border-rose-300/30 dark:bg-rose-500/20 dark:text-rose-50"
                onClick={discardDraft}
              >
                <IconTrash className="size-4" />
                Descartar
              </button>
            </div>
          </motion.div>
        )}

        <div className={PANEL}>
          <div className="flex flex-wrap items-center gap-3">
            {STEP_LABELS.map((item) => {
              const active = step === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goToStep(item.id)}
                  className={`cursor-pointer rounded-full px-4 py-1 text-xs font-semibold transition ${
                    active
                      ? "border border-sky-300/60 bg-sky-200/70 text-sky-950 dark:border-sky-300/40 dark:bg-sky-500/30 dark:text-white"
                      : "border border-sky-200/40 bg-white/60 text-sky-900/70 hover:bg-white/80 dark:border-white/10 dark:bg-white/10 dark:text-white/60"
                  }`}
                >
                  Paso {item.id}: {item.label}
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-2 text-xs text-sky-900/70 dark:text-white/60">
              <span>Guardado:</span>
              <span>
                {lastSavedAt ? formatDate(lastSavedAt) : "sin borrador"}
              </span>
            </div>
          </div>
        </div>

        {loadingProfile ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                <div className={PANEL}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold">
                        Paso 1 · Pasajeros
                      </h2>
                      <p className="text-sm text-sky-900/70 dark:text-white/70">
                        Sumá pasajeros y elegí titular.
                      </p>
                    </div>
                    {useSimpleCompanions && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-sky-900/70 dark:text-white/70">
                          Modo:
                        </span>
                        <button
                          type="button"
                          onClick={() => setUseSimpleMode(true)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            useSimpleMode
                              ? "border-emerald-300/60 bg-emerald-200/70 text-emerald-950 dark:border-emerald-300/40 dark:bg-emerald-500/30 dark:text-emerald-50"
                              : "border-sky-200/40 bg-white/60 text-sky-900/70 hover:bg-white/80 dark:border-white/10 dark:bg-white/10 dark:text-white/60"
                          }`}
                        >
                          Simple
                        </button>
                        <button
                          type="button"
                          onClick={() => setUseSimpleMode(false)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            !useSimpleMode
                              ? "border-sky-300/60 bg-sky-200/70 text-sky-950 dark:border-sky-300/40 dark:bg-sky-500/30 dark:text-white"
                              : "border-sky-200/40 bg-white/60 text-sky-900/70 hover:bg-white/80 dark:border-white/10 dark:bg-white/10 dark:text-white/60"
                          }`}
                        >
                          Completo
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-8 space-y-4">
                    <div className={`${STACK_SKY} bg-sky-100/5`}>
                      <h3 className="text-sm font-semibold">
                        Agregar pax existente
                      </h3>
                      <p className="text-xs text-sky-900/60 dark:text-white/60">
                        Buscá por nombre, documento o número de pax.
                      </p>
                      <div className="mt-3">
                        <ClientPicker
                          key={pickerKey}
                          token={token}
                          label="Pax existente"
                          placeholder="Buscar por DNI, Pasaporte, CUIT o nombre..."
                          valueId={null}
                          excludeIds={clients
                            .filter((c) => c.kind === "existing")
                            .map((c) => c.existingId)}
                          onSelect={addExistingClient}
                          onClear={() => undefined}
                        />
                      </div>
                    </div>

                    <div className={`${STACK_EMERALD} bg-emerald-100/5`}>
                      <h3 className="text-sm font-semibold">
                        ¿Pax nuevo? Cargalo acá
                      </h3>
                      <p className="mt-2 text-xs text-emerald-900/70 dark:text-emerald-50/70">
                        Sumá un pasajero nuevo y completá sus datos en el
                        formulario de abajo.
                      </p>
                      <button
                        type="button"
                        className={`${BTN_EMERALD} mt-4 w-full justify-center py-3 text-base`}
                        onClick={addNewClient}
                      >
                        <IconPlus className="size-5" />
                        Nuevo pax
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-6">
                  {clients.length === 0 && (
                    <div className={STACK_ROSE}>
                      <p className="text-sm font-semibold">
                        Todavía no hay pasajeros cargados.
                      </p>
                      <p className="text-xs text-sky-900/70 dark:text-white/70">
                        Agregá al menos un pax para avanzar.
                      </p>
                    </div>
                  )}

                  {clients.map((client, index) => {
                    const isTitular = client.id === titularId;
                    const isComplete = isClientComplete(client);
                    const missing =
                      client.kind === "new" ? missingClientFields(client) : [];
                    const profileConfig =
                      client.kind === "new"
                        ? resolveProfile(client.profile_key)
                        : null;
                    const customFieldsForClient =
                      client.kind === "new"
                        ? getCustomFieldsForClient(client)
                        : [];
                    return (
                      <motion.div
                        key={client.id}
                        layout
                        className="relative isolate z-0 overflow-visible rounded-3xl border border-white/10 bg-white/60 p-6 shadow-sm shadow-sky-950/10 backdrop-blur focus-within:z-40 dark:border-white/10 dark:bg-white/10"
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-sm font-semibold">
                              Pax {index + 1}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span
                                className={`${PILL_BASE} ${
                                  isComplete ? PILL_OK : PILL_WARN
                                }`}
                              >
                                {isComplete ? "Completo" : "Incompleto"}
                              </span>
                              {isTitular && (
                                <span className={`${PILL_BASE} ${PILL_SKY}`}>
                                  Titular
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!isTitular && (
                              <button
                                type="button"
                                className={BTN_EMERALD}
                                onClick={() => setTitularId(client.id)}
                              >
                                <IconCheck className="size-4" />
                                Marcar titular
                              </button>
                            )}
                            <button
                              type="button"
                              className={BTN_ROSE}
                              onClick={() => removeClient(client.id)}
                            >
                              <IconTrash className="size-4" />
                              Quitar
                            </button>
                          </div>
                        </div>

                        {client.kind === "new" && clientProfiles.length > 1 && (
                          <div className="mt-4">
                            <FieldLabel htmlFor={`profile-${client.id}`}>
                              Tipo de pax
                            </FieldLabel>
                            <select
                              id={`profile-${client.id}`}
                              value={client.profile_key || profileConfig?.key || ""}
                              onChange={(e) =>
                                updateClientField(
                                  client.id,
                                  "profile_key",
                                  e.target.value,
                                )
                              }
                              className={`${INPUT} mt-1 max-w-sm`}
                            >
                              {clientProfiles.map((profile) => (
                                <option key={profile.key} value={profile.key}>
                                  {profile.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {client.kind === "existing" ? (
                          <div className="mt-4 grid gap-2 text-sm text-sky-900/70 dark:text-white/70">
                            <p>
                              {client.snapshot.first_name}{" "}
                              {client.snapshot.last_name}
                            </p>
                            <p>
                              DNI: {client.snapshot.dni_number || "-"} ·
                              Pasaporte:{" "}
                              {client.snapshot.passport_number || "-"}
                            </p>
                            <p>Email: {client.snapshot.email || "-"}</p>
                          </div>
                        ) : (
                          <div className="mt-6 grid gap-6">
                            <div className={SUBCARD}>
                              <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                Datos personales
                              </p>
                              <div className="mt-4 grid gap-4 md:grid-cols-3">
                                <div
                                  className={isHiddenField(client, "first_name") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`first-${client.id}`}
                                    required={isRequiredField(client, "first_name")}
                                  >
                                    Nombre
                                  </FieldLabel>
                                  <input
                                    id={`first-${client.id}`}
                                    value={client.first_name}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "first_name",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT}
                                    placeholder="Ej: Juan"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "last_name") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`last-${client.id}`}
                                    required={isRequiredField(client, "last_name")}
                                  >
                                    Apellido
                                  </FieldLabel>
                                  <input
                                    id={`last-${client.id}`}
                                    value={client.last_name}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "last_name",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT}
                                    placeholder="Ej: Pérez"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "phone") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`phone-${client.id}`}
                                    required={isRequiredField(client, "phone")}
                                  >
                                    Teléfono
                                  </FieldLabel>
                                  <input
                                    id={`phone-${client.id}`}
                                    value={client.phone}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "phone",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT}
                                    placeholder="Ej: 11 2345-6789"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "birth_date") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`birth-${client.id}`}
                                    required={isRequiredField(client, "birth_date")}
                                  >
                                    Nacimiento
                                  </FieldLabel>
                                  <input
                                    id={`birth-${client.id}`}
                                    type="date"
                                    value={client.birth_date}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "birth_date",
                                        e.target.value,
                                      )
                                    }
                                    className={`${INPUT} cursor-pointer`}
                                    placeholder="aaaa-mm-dd"
                                  />
                                </div>
                                <div
                                  className={`space-y-2 ${
                                    isHiddenField(client, "nationality") ? "hidden" : ""
                                  }`}
                                >
                                  <FieldLabel
                                    required={isRequiredField(client, "nationality")}
                                  >
                                    Nacionalidad
                                  </FieldLabel>
                                  <DestinationPicker
                                    type="country"
                                    multiple={false}
                                    value={null}
                                    onChange={(val) =>
                                      handleNationalitySelect(client.id, val)
                                    }
                                    placeholder="Ej.: Argentina, Uruguay…"
                                    includeDisabled={true}
                                    className="relative z-30 [&>label]:hidden"
                                  />
                                  {client.nationality ? (
                                    <p className="text-xs text-sky-900/70 dark:text-white/70">
                                      Guardará: <b>{client.nationality}</b>
                                    </p>
                                  ) : isRequiredField(client, "nationality") ? (
                                    <p className="text-xs text-rose-600">
                                      Obligatorio
                                    </p>
                                  ) : null}
                                </div>
                                <div
                                  className={isHiddenField(client, "gender") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`gender-${client.id}`}
                                    required={isRequiredField(client, "gender")}
                                  >
                                    Género
                                  </FieldLabel>
                                  <select
                                    id={`gender-${client.id}`}
                                    value={client.gender}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "gender",
                                        e.target.value,
                                      )
                                    }
                                    className={`${INPUT} cursor-pointer`}
                                  >
                                    <option value="">Seleccionar género</option>
                                    <option value="Masculino">Masculino</option>
                                    <option value="Femenino">Femenino</option>
                                    <option value="Otro">Otro</option>
                                  </select>
                                </div>
                              </div>
                            </div>

                            <div className={SUBCARD}>
                              <div className="flex flex-col gap-1">
                                <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                  Documentación y contacto
                                </p>
                                {isDocumentRequiredForClient(client) ? (
                                  <p className="text-xs text-sky-900/60 dark:text-white/60">
                                    <span className="text-rose-600">*</span>{" "}
                                    Cargá DNI, Pasaporte o CUIT.
                                  </p>
                                ) : (
                                  <p className="text-xs text-sky-900/60 dark:text-white/60">
                                    Opcional
                                  </p>
                                )}
                              </div>
                              <div className="mt-4 grid gap-4 md:grid-cols-3">
                                <div
                                  className={isHiddenField(client, "dni_number") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`dni-${client.id}`}
                                    required={isRequiredField(client, "dni_number")}
                                  >
                                    DNI
                                  </FieldLabel>
                                  <input
                                    id={`dni-${client.id}`}
                                    value={client.dni_number}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "dni_number",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT}
                                    placeholder="Ej: 12345678"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "passport_number") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`pass-${client.id}`}
                                    required={isRequiredField(client, "passport_number")}
                                  >
                                    Pasaporte
                                  </FieldLabel>
                                  <input
                                    id={`pass-${client.id}`}
                                    value={client.passport_number}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "passport_number",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT}
                                    placeholder="Ej: AA123456"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "email") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`email-${client.id}`}
                                    required={isRequiredField(client, "email")}
                                  >
                                    Email
                                  </FieldLabel>
                                  <input
                                    id={`email-${client.id}`}
                                    value={client.email}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "email",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT}
                                    placeholder="Ej: pax@mail.com"
                                  />
                                </div>
                              </div>
                            </div>

                            {customFieldsForClient.length > 0 && (
                              <div className={SUBCARD}>
                                <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                  Campos extra
                                </p>
                                <div className="mt-4 grid gap-4 md:grid-cols-3">
                                  {customFieldsForClient.map((field) => (
                                    <div key={`${client.id}-${field.key}`}>
                                      <FieldLabel
                                        htmlFor={`custom-${client.id}-${field.key}`}
                                        required={field.required}
                                      >
                                        {field.label}
                                      </FieldLabel>
                                      {field.type === "select" &&
                                      Array.isArray(field.options) &&
                                      field.options.length > 0 ? (
                                        <select
                                          id={`custom-${client.id}-${field.key}`}
                                          value={
                                            client.custom_fields?.[field.key] ||
                                            ""
                                          }
                                          onChange={(e) =>
                                            updateClientCustomField(
                                              client.id,
                                              field.key,
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                        >
                                          <option value="">
                                            {field.placeholder || "Seleccionar"}
                                          </option>
                                          {field.options.map((option) => (
                                            <option key={option} value={option}>
                                              {option}
                                            </option>
                                          ))}
                                        </select>
                                      ) : field.type === "multiselect" &&
                                        Array.isArray(field.options) &&
                                        field.options.length > 0 ? (
                                        <select
                                          id={`custom-${client.id}-${field.key}`}
                                          multiple
                                          value={String(
                                            client.custom_fields?.[field.key] || "",
                                          )
                                            .split(",")
                                            .map((item) => item.trim())
                                            .filter((item) => item.length > 0)}
                                          onChange={(e) => {
                                            const selected = Array.from(
                                              e.target.selectedOptions,
                                            ).map((option) => option.value);
                                            updateClientCustomField(
                                              client.id,
                                              field.key,
                                              selected.join(", "),
                                            );
                                          }}
                                          className={`${INPUT} min-h-[96px]`}
                                        >
                                          {field.options.map((option) => (
                                            <option key={option} value={option}>
                                              {option}
                                            </option>
                                          ))}
                                        </select>
                                      ) : field.type === "boolean" ? (
                                        <select
                                          id={`custom-${client.id}-${field.key}`}
                                          value={
                                            client.custom_fields?.[field.key] ||
                                            ""
                                          }
                                          onChange={(e) =>
                                            updateClientCustomField(
                                              client.id,
                                              field.key,
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                        >
                                          <option value="">
                                            {field.placeholder || "Seleccionar"}
                                          </option>
                                          <option value="true">Sí</option>
                                          <option value="false">No</option>
                                        </select>
                                      ) : field.type === "textarea" ? (
                                        <textarea
                                          id={`custom-${client.id}-${field.key}`}
                                          value={
                                            client.custom_fields?.[field.key] ||
                                            ""
                                          }
                                          onChange={(e) =>
                                            updateClientCustomField(
                                              client.id,
                                              field.key,
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                          placeholder={field.placeholder || ""}
                                          rows={3}
                                        />
                                      ) : (
                                        <input
                                          id={`custom-${client.id}-${field.key}`}
                                          type={
                                            field.type === "number"
                                              ? "number"
                                              : field.type === "date"
                                                ? "date"
                                                : "text"
                                          }
                                          value={
                                            client.custom_fields?.[field.key] ||
                                            ""
                                          }
                                          onChange={(e) =>
                                            updateClientCustomField(
                                              client.id,
                                              field.key,
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                          placeholder={
                                            field.type === "date"
                                              ? "aaaa-mm-dd"
                                              : field.placeholder || ""
                                          }
                                        />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className={SUBCARD}>
                              <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                Datos fiscales (si aplica)
                              </p>
                              <div className="mt-4 grid gap-4 md:grid-cols-3">
                                <div
                                  className={isHiddenField(client, "tax_id") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`tax-${client.id}`}
                                    required={isRequiredField(client, "tax_id")}
                                  >
                                    CUIT / RUT
                                  </FieldLabel>
                                  <input
                                    id={`tax-${client.id}`}
                                    value={client.tax_id}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "tax_id",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT_SOFT}
                                    placeholder="Ej: 30-12345678-9"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "company_name") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`company-${client.id}`}
                                    required={isRequiredField(client, "company_name")}
                                  >
                                    Razón social
                                  </FieldLabel>
                                  <input
                                    id={`company-${client.id}`}
                                    value={client.company_name}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "company_name",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT_SOFT}
                                    placeholder="Ej: Ofistur SRL"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "commercial_address") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`address-${client.id}`}
                                    required={isRequiredField(
                                      client,
                                      "commercial_address",
                                    )}
                                  >
                                    Domicilio comercial (Factura)
                                  </FieldLabel>
                                  <input
                                    id={`address-${client.id}`}
                                    value={client.commercial_address}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "commercial_address",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT_SOFT}
                                    placeholder="Ej: Calle 123, CABA"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "address") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`home-${client.id}`}
                                    required={isRequiredField(client, "address")}
                                  >
                                    Dirección particular
                                  </FieldLabel>
                                  <input
                                    id={`home-${client.id}`}
                                    value={client.address}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "address",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT_SOFT}
                                    placeholder="Ej: Calle 123, CABA"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "locality") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`locality-${client.id}`}
                                    required={isRequiredField(client, "locality")}
                                  >
                                    Localidad / Ciudad
                                  </FieldLabel>
                                  <input
                                    id={`locality-${client.id}`}
                                    value={client.locality}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "locality",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT_SOFT}
                                    placeholder="Ej: San Miguel"
                                  />
                                </div>
                                <div
                                  className={isHiddenField(client, "postal_code") ? "hidden" : ""}
                                >
                                  <FieldLabel
                                    htmlFor={`postal-${client.id}`}
                                    required={isRequiredField(client, "postal_code")}
                                  >
                                    Código postal
                                  </FieldLabel>
                                  <input
                                    id={`postal-${client.id}`}
                                    value={client.postal_code}
                                    onChange={(e) =>
                                      updateClientField(
                                        client.id,
                                        "postal_code",
                                        e.target.value,
                                      )
                                    }
                                    className={INPUT_SOFT}
                                    placeholder="Ej: 1663"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {client.kind === "new" && missing.length > 0 && (
                          <p className="mt-3 text-xs text-amber-700">
                            Completar: {missing.join(", ")}.
                          </p>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {useSimpleCompanions && useSimpleMode && (
                  <div className={PANEL}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">
                          Acompañantes simples
                        </h3>
                        <p className="text-xs text-sky-900/70 dark:text-white/70">
                          Cargá edad y/o categoría sin crear pasajeros nuevos.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={BTN_SKY}
                        onClick={addSimpleCompanion}
                      >
                        <IconPlus className="size-4" />
                        Agregar acompañante
                      </button>
                    </div>

                    {(!booking.simple_companions ||
                      booking.simple_companions.length === 0) && (
                      <p className="mt-4 text-xs text-sky-900/70 dark:text-white/70">
                        No hay acompañantes simples cargados.
                      </p>
                    )}

                    {savedCompanionsLoading ? (
                      <p className="mt-4 text-xs text-sky-900/70 dark:text-white/70">
                        Cargando acompañantes guardados…
                      </p>
                    ) : savedCompanions.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-3">
                        <p className="text-xs font-semibold text-sky-900/70 dark:text-white/70">
                          Guardados del titular
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {savedCompanions.map((c, idx) => (
                            <button
                              key={`saved-${c.id_template ?? c.category_id ?? idx}`}
                              type="button"
                              onClick={() => addSavedCompanion(c)}
                              className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10"
                            >
                              {c.category?.name || "Sin categoría"}
                              {c.age != null ? ` · ${c.age} años` : ""}
                              {c.notes ? ` · ${c.notes}` : ""}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {Array.isArray(booking.simple_companions) &&
                      booking.simple_companions.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {booking.simple_companions.map((c, idx) => (
                            <div
                              key={`simple-comp-${idx}`}
                              className="grid gap-3 md:grid-cols-[1.2fr_0.6fr_1.6fr_auto]"
                            >
                              <select
                                value={c.category_id ?? ""}
                                onChange={(e) =>
                                  updateSimpleCompanion(idx, {
                                    category_id: e.target.value
                                      ? Number(e.target.value)
                                      : null,
                                  })
                                }
                                className={`${INPUT} cursor-pointer`}
                              >
                                <option value="">Categoría</option>
                                {passengerCategories
                                  .filter((p) => p.enabled !== false)
                                  .map((p) => (
                                    <option
                                      key={p.id_category}
                                      value={p.id_category}
                                    >
                                      {p.name}
                                    </option>
                                  ))}
                              </select>
                              <input
                                type="number"
                                min={0}
                                value={c.age ?? ""}
                                onChange={(e) =>
                                  updateSimpleCompanion(idx, {
                                    age: e.target.value
                                      ? Number(e.target.value)
                                      : null,
                                  })
                                }
                                className={INPUT}
                                placeholder="Edad"
                              />
                              <input
                                type="text"
                                value={c.notes ?? ""}
                                onChange={(e) =>
                                  updateSimpleCompanion(idx, {
                                    notes: e.target.value,
                                  })
                                }
                                className={INPUT}
                                placeholder="Notas (opcional)"
                              />
                              <button
                                type="button"
                                onClick={() => removeSimpleCompanion(idx)}
                                className={BTN_ROSE}
                              >
                                <IconTrash className="size-4" />
                                Quitar
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    className={BTN_EMERALD}
                    onClick={() => goToStep(2)}
                  >
                    Siguiente: Reserva
                  </button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                <div className={PANEL}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold">
                        Paso 2 · Reserva
                      </h2>
                      <p className="text-sm text-sky-900/70 dark:text-white/70">
                        Datos básicos, fechas y facturación.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`${PILL_BASE} ${PILL_SKY}`}>
                        Pax:{" "}
                        {clients.length +
                          (Array.isArray(booking.simple_companions)
                            ? booking.simple_companions.length
                            : 0)}
                      </span>
                      <span className={`${PILL_BASE} ${PILL_SKY}`}>
                        Titular: {titularLabel}
                      </span>
                    </div>
                  </div>

                  <div className="mt-8 grid gap-6 lg:grid-cols-2">
                    <div className={SUBCARD}>
                      <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                        Datos de reserva
                      </p>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                          <FieldLabel htmlFor="booking-details" required>
                            Detalle de la reserva
                          </FieldLabel>
                          <input
                            id="booking-details"
                            value={booking.details}
                            onChange={(e) =>
                              updateBookingField("details", e.target.value)
                            }
                            className={INPUT}
                            placeholder="Ej: Paquete Caribe + hotel"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <FieldLabel htmlFor="booking-observation">
                            Observación interna
                          </FieldLabel>
                          <input
                            id="booking-observation"
                            value={booking.observation}
                            onChange={(e) =>
                              updateBookingField("observation", e.target.value)
                            }
                            className={INPUT}
                            placeholder="Notas internas, pedidos especiales..."
                          />
                        </div>
                        <div>
                          <FieldLabel htmlFor="booking-from" required>
                            Fecha salida
                          </FieldLabel>
                          <input
                            id="booking-from"
                            type="date"
                            value={booking.departure_date}
                            onChange={(e) =>
                              updateBookingField(
                                "departure_date",
                                e.target.value,
                              )
                            }
                            className={`${INPUT} cursor-pointer`}
                            placeholder="aaaa-mm-dd"
                          />
                        </div>
                        <div>
                          <FieldLabel htmlFor="booking-to" required>
                            Fecha regreso
                          </FieldLabel>
                          <input
                            id="booking-to"
                            type="date"
                            value={booking.return_date}
                            onChange={(e) =>
                              updateBookingField("return_date", e.target.value)
                            }
                            className={`${INPUT} cursor-pointer`}
                            placeholder="aaaa-mm-dd"
                          />
                        </div>
                      </div>
                    </div>

                    <div className={SUBCARD}>
                      <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                        Facturación
                      </p>
                      <div className="mt-4 grid gap-4">
                        <div>
                          <FieldLabel htmlFor="booking-invoice" required>
                            Tipo de factura
                          </FieldLabel>
                          <select
                            id="booking-invoice"
                            value={booking.invoice_type}
                            onChange={(e) =>
                              updateBookingField("invoice_type", e.target.value)
                            }
                            className={`${INPUT} cursor-pointer`}
                          >
                            <option value="">Seleccionar tipo</option>
                            {INVOICE_TYPES.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <FieldLabel htmlFor="booking-invoice-note">
                            Observación factura
                          </FieldLabel>
                          <input
                            id="booking-invoice-note"
                            value={booking.invoice_observation}
                            onChange={(e) =>
                              updateBookingField(
                                "invoice_observation",
                                e.target.value,
                              )
                            }
                            className={INPUT}
                            placeholder="Ej: Facturar al pax N° 342"
                          />
                        </div>
                        <p className="text-xs text-sky-900/60 dark:text-white/60">
                          Los estados de reserva, pax y operador se ajustan
                          luego dentro de la reserva.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              <div className="flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  className={BTN_SKY}
                  onClick={() => goToStep(1)}
                >
                  <IconArrowLeft className="size-4" />
                  Volver
                </button>
                <button
                  type="button"
                  className={BTN_EMERALD}
                  onClick={() => goToStep(3)}
                >
                  Siguiente: Servicios
                </button>
              </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                <div className={PANEL}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold">
                        Paso 3 · Servicios
                      </h2>
                      <p className="text-sm text-sky-900/70 dark:text-white/70">
                        Opcional: agregá servicios y revisá totales.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-sky-900/70 dark:text-white/60">
                        {canManualOverride && (
                          <>
                            <button
                              type="button"
                              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                !manualOverride
                                  ? "border-sky-300/60 bg-sky-200/70 text-sky-950 dark:border-sky-300/40 dark:bg-sky-500/30 dark:text-white"
                                  : "border-sky-200/40 bg-white/60 text-sky-900/70 hover:bg-white/80 dark:border-white/10 dark:bg-white/10 dark:text-white/60"
                              }`}
                              onClick={() => setManualOverride(false)}
                            >
                              Automático
                            </button>
                            <button
                              type="button"
                              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                manualOverride
                                  ? "border-amber-300/70 bg-amber-200/70 text-amber-950 dark:border-amber-300/40 dark:bg-amber-500/30 dark:text-amber-50"
                                  : "border-amber-200/40 bg-white/60 text-amber-900/70 hover:bg-white/80 dark:border-white/10 dark:bg-white/10 dark:text-white/60"
                              }`}
                              onClick={() => setManualOverride(true)}
                            >
                              Manual
                            </button>
                          </>
                        )}
                        <span className={canManualOverride ? "ml-2" : ""}>
                          Costos Bancarios: {(transferFeePct * 100).toFixed(2)}%
                        </span>
                        {calcConfigLoading && (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Cargando config
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2" />
                  </div>

                  <div className="mt-6 grid gap-4">
                    {(canOverrideSaleTotal || useBookingSaleTotal) && (
                      <div className={SUBCARD}>
                        <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                          Venta general
                        </p>
                        {canOverrideSaleTotal && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                useBookingSaleTotal
                                  ? "border-emerald-300/60 bg-emerald-200/70 text-emerald-950 dark:border-emerald-300/40 dark:bg-emerald-500/30 dark:text-emerald-50"
                                  : "border-emerald-200/40 bg-white/60 text-emerald-900/70 hover:bg-white/80 dark:border-white/10 dark:bg-white/10 dark:text-white/60"
                              }`}
                              onClick={() => setUseBookingSaleTotal(true)}
                            >
                              Local ON
                            </button>
                            <button
                              type="button"
                              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                !useBookingSaleTotal
                                  ? "border-sky-300/60 bg-sky-200/70 text-sky-950 dark:border-sky-300/40 dark:bg-sky-500/30 dark:text-white"
                                  : "border-sky-200/40 bg-white/60 text-sky-900/70 hover:bg-white/80 dark:border-white/10 dark:bg-white/10 dark:text-white/60"
                              }`}
                              onClick={() => setUseBookingSaleTotal(false)}
                            >
                              Local OFF
                            </button>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium">
                          <span className="rounded-full border border-white/20 bg-white/60 px-2 py-1 dark:bg-white/10">
                            Global:{" "}
                            {inheritedUseBookingSaleTotal ? "Activo" : "Inactivo"}
                          </span>
                          <span className="rounded-full border border-white/20 bg-white/60 px-2 py-1 dark:bg-white/10">
                            Local:{" "}
                            {nextSaleTotalOverridePayload == null
                              ? "Heredado"
                              : nextSaleTotalOverridePayload
                                ? "Override Activo"
                                : "Override Inactivo"}
                          </span>
                        </div>

                        {useBookingSaleTotal && (
                          <div className="mt-5 grid gap-4">
                            {summaryCurrencies.map((cur) => (
                              <div key={cur}>
                                <FieldLabel
                                  htmlFor={`booking-sale-${cur}`}
                                  required
                                >
                                  Venta total {cur}
                                </FieldLabel>
                                <input
                                  id={`booking-sale-${cur}`}
                                  type="number"
                                  value={bookingSaleTotals[cur] || ""}
                                  onChange={(e) =>
                                    updateBookingSaleTotal(cur, e.target.value)
                                  }
                                  className={INPUT}
                                  placeholder={`0.00 ${cur}`}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {loadingOperators ? (
                      <div className="flex items-center gap-3 text-sm text-sky-900/70 dark:text-white/70">
                        <Spinner />
                        Cargando operadores...
                      </div>
                    ) : (
                      <div className="grid gap-6">
                        {services.length === 0 && (
                          <div className={STACK_SKY}>
                            <p className="text-sm font-semibold">
                              No hay servicios cargados.
                            </p>
                            <p className="text-xs text-sky-900/70 dark:text-white/70">
                              Podés confirmar la reserva sin servicios y
                              agregarlos después.
                            </p>
                          </div>
                        )}
                        {services.map((service, idx) => {
                          const ready = isServiceComplete(
                            service,
                            useBookingSaleTotal,
                          );
                          const saleValue = toNumber(service.sale_price);
                          const costValue = toNumber(service.cost_price);
                          const hasBillingInputs = [
                            saleValue,
                            costValue,
                            toNumber(service.tax_21),
                            toNumber(service.tax_105),
                            toNumber(service.exempt),
                            toNumber(service.other_taxes),
                            toNumber(service.card_interest),
                            toNumber(service.card_interest_21),
                          ].some((value) => Math.abs(value) > 0.000001);
                          const showBreakdown =
                            Number.isFinite(saleValue) &&
                            Number.isFinite(costValue) &&
                            hasBillingInputs;
                          const adjustmentTotals =
                            adjustmentsByServiceId.get(service.id) ??
                            EMPTY_ADJUSTMENTS;
                          const billingOverrideValues =
                            extractBillingOverrideValues(service.billing_override);
                          const billingMeta = extractBillingOverrideMeta(
                            service.billing_override,
                          );
                          const iibbAmount =
                            billingMeta?.grossIncomeTaxEnabled === true
                              ? Number(billingMeta.grossIncomeTaxAmount || 0)
                              : 0;
                          const iibbAdjustment: BillingAdjustmentComputed | null =
                            iibbAmount > 0
                              ? {
                                  id: "gross-income-tax",
                                  label: "Ingresos Brutos",
                                  kind: "tax",
                                  basis:
                                    billingMeta?.grossIncomeTaxBase === "sale"
                                      ? "sale"
                                      : "margin",
                                  valueType: "percent",
                                  value:
                                    Number(billingMeta?.grossIncomeTaxPct || 0) /
                                    100,
                                  active: true,
                                  source: "global",
                                  amount: iibbAmount,
                                }
                              : null;
                          const effectiveAdjustmentItems = iibbAdjustment
                            ? [...adjustmentTotals.items, iibbAdjustment]
                            : adjustmentTotals.items;
                          const effectiveAdjustmentTaxes =
                            adjustmentTotals.totalTaxes + iibbAmount;
                          const serviceMiniAdjustments =
                            normalizeServiceAdjustmentConfigs(
                              service.service_adjustments,
                            );
                          const transferPct = Number.isFinite(
                            service.transfer_fee_pct,
                          )
                            ? service.transfer_fee_pct
                            : transferFeePct;
                          const transferAmount =
                            Number.isFinite(service.transfer_fee_amount)
                              ? service.transfer_fee_amount
                              : saleValue * transferPct;
                          const baseCommission = Number(
                            service.totalCommissionWithoutVAT ?? 0,
                          );
                          const netCommission = showBreakdown
                            ? baseCommission -
                              transferAmount -
                              adjustmentTotals.total -
                              iibbAmount
                            : null;
                          return (
                            <motion.div
                              key={service.id}
                              layout
                              className="relative isolate z-0 overflow-visible rounded-3xl border border-white/10 bg-white/60 p-6 shadow-sm shadow-sky-950/10 backdrop-blur focus-within:z-40 dark:border-white/10 dark:bg-white/10"
                            >
                              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <p className="text-sm font-semibold">
                                    Servicio {idx + 1}
                                  </p>
                                  <span
                                    className={`${PILL_BASE} ${
                                      ready ? PILL_OK : PILL_WARN
                                    } mt-2`}
                                  >
                                    {ready ? "Completo" : "Pendiente"}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className={BTN_ROSE}
                                  onClick={() => removeService(service.id)}
                                >
                                  <IconTrash className="size-4" />
                                  Quitar
                                </button>
                              </div>

                              <div className="mt-6 grid gap-6">
                                <div className={SUBCARD}>
                                <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                  Datos principales
                                </p>
                                <div className="mt-4 grid gap-4 md:grid-cols-3">
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-type-${service.id}`}
                                      required
                                    >
                                      Tipo
                                    </FieldLabel>
                                    <select
                                      id={`service-type-${service.id}`}
                                      value={service.type}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "type",
                                          e.target.value,
                                        )
                                      }
                                      className={`${INPUT} cursor-pointer`}
                                      disabled={loadingServiceTypes}
                                      required
                                    >
                                      {loadingServiceTypes && (
                                        <option value="" disabled>
                                          Cargando tipos...
                                        </option>
                                      )}
                                      {!loadingServiceTypes &&
                                        serviceTypes.length === 0 && (
                                          <option value="" disabled>
                                            {serviceTypesError
                                              ? "Error al cargar tipos"
                                              : "Sin tipos disponibles"}
                                          </option>
                                        )}
                                      {!loadingServiceTypes &&
                                        serviceTypes.length > 0 && (
                                          <>
                                            <option value="" disabled>
                                              Seleccionar tipo
                                            </option>
                                            {serviceTypes.map((opt) => (
                                              <option
                                                key={opt.value}
                                                value={opt.value}
                                              >
                                                {opt.label}
                                              </option>
                                            ))}
                                          </>
                                        )}
                                      {service.type &&
                                        !serviceTypes.some(
                                          (opt) => opt.value === service.type,
                                        ) && (
                                          <option value={service.type}>
                                            {service.type} (no listado)
                                          </option>
                                        )}
                                    </select>
                                  </div>
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-op-${service.id}`}
                                      required
                                    >
                                      Operador
                                    </FieldLabel>
                                    <select
                                      id={`service-op-${service.id}`}
                                      value={service.id_operator}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "id_operator",
                                          Number(e.target.value),
                                        )
                                      }
                                      className={`${INPUT} cursor-pointer`}
                                    >
                                      <option value={0}>
                                        Seleccionar operador
                                      </option>
                                      {operators.map((op) => (
                                        <option
                                          key={op.id_operator}
                                          value={op.id_operator}
                                        >
                                          {op.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-currency-${service.id}`}
                                      required
                                    >
                                      Moneda
                                    </FieldLabel>
                                    <select
                                      id={`service-currency-${service.id}`}
                                      value={service.currency}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "currency",
                                          e.target.value,
                                        )
                                      }
                                      className={`${INPUT} cursor-pointer`}
                                      disabled={loadingCurrencies}
                                    >
                                      {loadingCurrencies && (
                                        <>
                                          {service.currency && (
                                            <option value={service.currency}>
                                              {service.currency}
                                            </option>
                                          )}
                                          <option value="" disabled>
                                            Cargando monedas...
                                          </option>
                                        </>
                                      )}
                                      {!loadingCurrencies &&
                                        currencyOptions.map((code) => (
                                          <option key={code} value={code}>
                                            {code}
                                          </option>
                                        ))}
                                      {!loadingCurrencies &&
                                        service.currency &&
                                        !currencyOptions.includes(
                                          service.currency.toUpperCase(),
                                        ) && (
                                          <option value={service.currency}>
                                            {service.currency} (no listado)
                                          </option>
                                        )}
                                    </select>
                                  </div>
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-sale-${service.id}`}
                                      required={!useBookingSaleTotal}
                                    >
                                      Venta
                                    </FieldLabel>
                                    <input
                                      id={`service-sale-${service.id}`}
                                      type="number"
                                      value={service.sale_price}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "sale_price",
                                          e.target.value,
                                        )
                                      }
                                      className={`${INPUT} disabled:cursor-not-allowed disabled:opacity-60`}
                                      placeholder="0.00"
                                      disabled={useBookingSaleTotal}
                                    />
                                  </div>
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-cost-${service.id}`}
                                      required
                                    >
                                      Costo
                                    </FieldLabel>
                                    <input
                                      id={`service-cost-${service.id}`}
                                      type="number"
                                      value={service.cost_price}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "cost_price",
                                          e.target.value,
                                        )
                                      }
                                      className={INPUT}
                                      placeholder="0.00"
                                    />
                                  </div>
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-desc-${service.id}`}
                                    >
                                      Descripción
                                    </FieldLabel>
                                    <input
                                      id={`service-desc-${service.id}`}
                                      value={service.description}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "description",
                                          e.target.value,
                                        )
                                      }
                                      className={INPUT}
                                      placeholder="Ej: Hotel + desayuno"
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className={SUBCARD}>
                                <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                  Destino y fechas
                                </p>
                                <div className="mt-4 grid gap-4 md:grid-cols-3">
                                  <div className="space-y-2 md:col-span-2">
                                    <FieldLabel>Destino</FieldLabel>
                                    <DestinationPicker
                                      type="destination"
                                      multiple={false}
                                      value={null}
                                      onChange={(val) =>
                                        handleDestinationSelect(service.id, val)
                                      }
                                      placeholder="Ej.: París, Salta, Roma..."
                                      className="relative z-30 [&>label]:hidden"
                                    />
                                    {service.destination ? (
                                      <p className="text-xs text-sky-900/70 dark:text-white/70">
                                        Guardará: <b>{service.destination}</b>
                                      </p>
                                    ) : null}
                                  </div>
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-ref-${service.id}`}
                                    >
                                      Referencia
                                    </FieldLabel>
                                    <input
                                      id={`service-ref-${service.id}`}
                                      value={service.reference}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "reference",
                                          e.target.value,
                                        )
                                      }
                                      className={INPUT}
                                      placeholder="Ej: ABC12345"
                                    />
                                  </div>
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-from-${service.id}`}
                                      required
                                    >
                                      Desde
                                    </FieldLabel>
                                    <input
                                      id={`service-from-${service.id}`}
                                      type="date"
                                      value={service.departure_date}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "departure_date",
                                          e.target.value,
                                        )
                                      }
                                      className={`${INPUT} cursor-pointer`}
                                      placeholder="aaaa-mm-dd"
                                    />
                                  </div>
                                  <div>
                                    <FieldLabel
                                      htmlFor={`service-to-${service.id}`}
                                      required
                                    >
                                      Hasta
                                    </FieldLabel>
                                    <input
                                      id={`service-to-${service.id}`}
                                      type="date"
                                      value={service.return_date}
                                      onChange={(e) =>
                                        updateServiceField(
                                          service.id,
                                          "return_date",
                                          e.target.value,
                                        )
                                      }
                                      className={`${INPUT} cursor-pointer`}
                                      placeholder="aaaa-mm-dd"
                                    />
                                  </div>
                                </div>
                              </div>

                              {manualMode ? (
                                <div className={SUBCARD}>
                                  <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                    Impuestos (manual)
                                  </p>
                                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div>
                                      <FieldLabel
                                        htmlFor={`service-tax-${service.id}`}
                                      >
                                        Impuestos
                                      </FieldLabel>
                                      <input
                                        id={`service-tax-${service.id}`}
                                        type="number"
                                        value={service.other_taxes}
                                        onChange={(e) =>
                                          updateServiceField(
                                            service.id,
                                            "other_taxes",
                                            e.target.value,
                                          )
                                        }
                                        className={INPUT}
                                        placeholder="0.00"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className={SUBCARD}>
                                    <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                      Impuestos e IVA
                                    </p>
                                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                                      <div>
                                        <FieldLabel
                                          htmlFor={`service-iva21-${service.id}`}
                                        >
                                          IVA 21%
                                        </FieldLabel>
                                        <input
                                          id={`service-iva21-${service.id}`}
                                          type="number"
                                          value={service.tax_21}
                                          onChange={(e) =>
                                            updateServiceField(
                                              service.id,
                                              "tax_21",
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                          placeholder="0.00"
                                        />
                                      </div>
                                      <div>
                                        <FieldLabel
                                          htmlFor={`service-iva105-${service.id}`}
                                        >
                                          IVA 10,5%
                                        </FieldLabel>
                                        <input
                                          id={`service-iva105-${service.id}`}
                                          type="number"
                                          value={service.tax_105}
                                          onChange={(e) =>
                                            updateServiceField(
                                              service.id,
                                              "tax_105",
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                          placeholder="0.00"
                                        />
                                      </div>
                                      <div>
                                        <FieldLabel
                                          htmlFor={`service-exempt-${service.id}`}
                                        >
                                          Exento
                                        </FieldLabel>
                                        <input
                                          id={`service-exempt-${service.id}`}
                                          type="number"
                                          value={service.exempt}
                                          onChange={(e) =>
                                            updateServiceField(
                                              service.id,
                                              "exempt",
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                          placeholder="0.00"
                                        />
                                      </div>
                                      <div className="md:col-span-2">
                                        <FieldLabel
                                          htmlFor={`service-other-${service.id}`}
                                        >
                                          Otros impuestos
                                        </FieldLabel>
                                        <input
                                          id={`service-other-${service.id}`}
                                          type="number"
                                          value={service.other_taxes}
                                          onChange={(e) =>
                                            updateServiceField(
                                              service.id,
                                              "other_taxes",
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                          placeholder="0.00"
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  <div className={SUBCARD}>
                                    <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                      Tarjeta
                                    </p>
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                      <div>
                                        <FieldLabel
                                          htmlFor={`service-card-${service.id}`}
                                        >
                                          Interés tarjeta
                                        </FieldLabel>
                                        <input
                                          id={`service-card-${service.id}`}
                                          type="number"
                                          value={service.card_interest}
                                          onChange={(e) =>
                                            updateServiceField(
                                              service.id,
                                              "card_interest",
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                          placeholder="0.00"
                                        />
                                      </div>
                                      <div>
                                        <FieldLabel
                                          htmlFor={`service-card-iva-${service.id}`}
                                        >
                                          IVA interés (21%)
                                        </FieldLabel>
                                        <input
                                          id={`service-card-iva-${service.id}`}
                                          type="number"
                                          value={service.card_interest_21}
                                          onChange={(e) =>
                                            updateServiceField(
                                              service.id,
                                              "card_interest_21",
                                              e.target.value,
                                            )
                                          }
                                          className={INPUT}
                                          placeholder="0.00"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}

                              <ServiceAdjustmentsEditor
                                items={serviceMiniAdjustments}
                                onChange={(next) =>
                                  updateServiceAdjustments(service.id, next)
                                }
                              />

                              {useBookingSaleTotal ? (
                                <div className={SUBCARD}>
                                  <p className="text-[11px] uppercase tracking-[0.25em] text-sky-900/60 dark:text-white/60">
                                    Ajustes extra
                                  </p>
                                  <p className="mt-2 text-xs text-sky-900/70 dark:text-white/70">
                                    Con venta general, los ajustes se calculan
                                    en el resumen por moneda.
                                  </p>
                                </div>
                              ) : effectiveAdjustmentItems.length > 0 ? (
                                <AdjustmentsPanel
                                  items={effectiveAdjustmentItems}
                                  totalCosts={adjustmentTotals.totalCosts}
                                  totalTaxes={effectiveAdjustmentTaxes}
                                  netCommission={netCommission}
                                  format={(value) =>
                                    fmtMoney(value, service.currency || "ARS")
                                  }
                                />
                              ) : null}

                              {showBreakdown &&
                                (manualMode ? (
                                  <BillingBreakdownManual
                                    importeVenta={saleValue}
                                    costo={costValue}
                                    impuestos={toNumber(service.other_taxes)}
                                    moneda={service.currency || "ARS"}
                                    transferFeePct={transferPct}
                                    initialGrossIncomeTaxEnabled={
                                      billingMeta?.grossIncomeTaxEnabled
                                    }
                                    initialGrossIncomeTaxBase={
                                      billingMeta?.grossIncomeTaxBase
                                    }
                                    initialGrossIncomeTaxPct={
                                      billingMeta?.grossIncomeTaxPct
                                    }
                                    onBillingUpdate={(data) =>
                                      updateServiceBilling(service.id, data)
                                    }
                                  />
                                ) : (
                                  <BillingBreakdown
                                    importeVenta={saleValue}
                                    costo={costValue}
                                    montoIva21={toNumber(service.tax_21)}
                                    montoIva10_5={toNumber(service.tax_105)}
                                    montoExento={toNumber(service.exempt)}
                                    otrosImpuestos={toNumber(
                                      service.other_taxes,
                                    )}
                                    cardInterest={toNumber(
                                      service.card_interest,
                                    )}
                                    cardInterestIva={toNumber(
                                      service.card_interest_21,
                                    )}
                                    moneda={service.currency || "ARS"}
                                    transferFeePct={transferPct}
                                    onBillingUpdate={(data) =>
                                      updateServiceBilling(service.id, data)
                                    }
                                    allowBreakdownOverrideEdit={
                                      canOverrideBillingMode
                                    }
                                    initialBreakdownOverride={billingOverrideValues}
                                    initialCommissionVatMode={
                                      billingMeta?.commissionVatMode
                                    }
                                    initialGrossIncomeTaxEnabled={
                                      billingMeta?.grossIncomeTaxEnabled
                                    }
                                    initialGrossIncomeTaxBase={
                                      billingMeta?.grossIncomeTaxBase
                                    }
                                    initialGrossIncomeTaxPct={
                                      billingMeta?.grossIncomeTaxPct
                                    }
                                  />
                                ))}
                            </div>
                          </motion.div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={addService}
                        className="group flex w-full items-center justify-between rounded-3xl border border-dashed border-sky-200/70 bg-white/40 p-5 text-left text-sky-950 shadow-sm shadow-sky-950/10 transition hover:-translate-y-0.5 hover:bg-white/60 dark:border-white/10 dark:bg-white/5 dark:text-white"
                      >
                        <div>
                          <p className="text-sm font-semibold">
                            Agregar servicio
                          </p>
                          <p className="text-xs text-sky-900/60 dark:text-white/60">
                            Usá presets por categoría si existen.
                          </p>
                        </div>
                        <span className="inline-flex size-9 items-center justify-center rounded-full border border-sky-200/60 bg-sky-100/70 text-sky-900 transition group-hover:scale-105 dark:border-white/10 dark:bg-white/10 dark:text-white">
                          <IconPlus className="size-4" />
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-between gap-3">
                  <button
                    type="button"
                    className={BTN_SKY}
                    onClick={() => goToStep(2)}
                  >
                    <IconArrowLeft className="size-4" />
                    Volver
                  </button>
                  <button
                    type="button"
                    className={BTN_EMERALD}
                    onClick={() => goToStep(4)}
                  >
                    Siguiente: Resumen
                  </button>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                <div className={PANEL}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold">
                        Paso 4 · Resumen financiero
                      </h2>
                      <p className="text-sm text-sky-900/70 dark:text-white/70">
                        Revisá márgenes, impuestos y costos bancarios.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-sky-900/70 dark:text-white/60">
                      <span className={`${PILL_BASE} ${PILL_SKY}`}>
                        Costos Bancarios: {(transferFeePct * 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  <div className="mt-8">
                    <SummaryCard
                      totalsByCurrency={totalsByCurrency}
                      services={summaryServices as Service[]}
                      receipts={[]}
                      useBookingSaleTotal={useBookingSaleTotal}
                      bookingSaleTotals={bookingSaleTotals}
                    />
                  </div>
                </div>

                <div className={PANEL}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Revisión final</h3>
                      <p className="text-sm text-sky-900/70 dark:text-white/70">
                        Editá lo necesario y confirmá.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={BTN_SKY}
                        onClick={() => goToStep(1)}
                      >
                        Editar pasajeros
                      </button>
                      <button
                        type="button"
                        className={BTN_SKY}
                        onClick={() => goToStep(2)}
                      >
                        Editar reserva
                      </button>
                      <button
                        type="button"
                        className={BTN_SKY}
                        onClick={() => goToStep(3)}
                      >
                        Editar servicios
                      </button>
                    </div>
                  </div>

                  <div className="mt-8 grid gap-6 lg:grid-cols-3">
                    <div className={STACK_SKY}>
                      <p className="text-sm font-semibold">Pasajeros</p>
                      <div className="mt-3 space-y-2 text-sm">
                        {clients.map((client) => {
                          const label =
                            client.kind === "existing"
                              ? `${client.snapshot.first_name} ${client.snapshot.last_name}`
                              : `${client.first_name} ${client.last_name}`.trim();
                          return (
                            <div
                              key={`summary-${client.id}`}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="truncate">
                                {label || "Pax sin nombre"}
                                {client.id === titularId ? " · Titular" : ""}
                              </span>
                              <button
                                type="button"
                                className="cursor-pointer text-rose-600 hover:text-rose-700"
                                onClick={() => removeClient(client.id)}
                                aria-label="Eliminar pax"
                              >
                                <IconTrash className="size-4" />
                              </button>
                            </div>
                          );
                        })}
                        {Array.isArray(booking.simple_companions) &&
                          booking.simple_companions.length > 0 && (
                            <div className="mt-3 text-xs text-sky-900/70 dark:text-white/70">
                              Acompañantes simples:{" "}
                              {booking.simple_companions.length}
                            </div>
                          )}
                      </div>
                    </div>

                    <div className={STACK_EMERALD}>
                      <p className="text-sm font-semibold">Reserva</p>
                      <div className="mt-3 space-y-1 text-sm text-sky-900/80 dark:text-white/80">
                        <p>Detalle: {booking.details || "-"}</p>
                        <p>
                          Fechas: {formatDate(booking.departure_date)} →{" "}
                          {formatDate(booking.return_date)}
                        </p>
                        <p>Factura: {booking.invoice_type || "-"}</p>
                      </div>
                    </div>

                    <div className={`${STACK_AMBER} bg-amber-100/5`}>
                      <p className="text-sm font-semibold">Servicios</p>
                      <div className="mt-3 space-y-2 text-sm">
                        {services.length === 0 && (
                          <p className="text-sky-900/60 dark:text-white/60">
                            Sin servicios cargados.
                          </p>
                        )}
                        {services.map((service) => (
                          <div
                            key={`summary-service-${service.id}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <div className="flex-1">
                              <p className="font-medium">
                                {service.type || "Servicio"}
                              </p>
                              <p className="text-xs text-sky-900/60 dark:text-white/60">
                                {operatorMap.get(service.id_operator)?.name ||
                                  "Operador pendiente"}
                              </p>
                              <p className="text-xs text-sky-900/60 dark:text-white/60">
                                {fmtMoney(
                                  Number(service.sale_price),
                                  service.currency,
                                )}{" "}
                                · {formatDate(service.departure_date)} →{" "}
                                {formatDate(service.return_date)}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="cursor-pointer text-rose-600 hover:text-rose-700"
                              onClick={() => removeService(service.id)}
                              aria-label="Eliminar servicio"
                            >
                              <IconTrash className="size-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {missingSummary.length > 0 && (
                    <div className={`${STACK_ROSE} mt-6 bg-rose-100/5`}>
                      <p className="text-sm font-semibold">
                        Faltan datos para confirmar
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-sky-900/80 dark:text-white/80">
                        {missingSummary.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-6 flex flex-wrap justify-between gap-3">
                    <button
                      type="button"
                      className={BTN_SKY}
                      onClick={() => goToStep(3)}
                    >
                      <IconArrowLeft className="size-4" />
                      Volver
                    </button>
                    <button
                      type="button"
                      className={BTN_EMERALD}
                      onClick={handleConfirm}
                      disabled={!canConfirm}
                    >
                      {saving ? (
                        <ButtonSpinner />
                      ) : (
                        <IconCheck className="size-4" />
                      )}
                      Confirmar y abrir reserva
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </section>

      <ToastContainer position="bottom-right" />
    </ProtectedRoute>
  );
}
