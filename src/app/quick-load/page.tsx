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
import OperatorPicker from "@/components/operators/OperatorPicker";
import QuickLoadCountryPicker from "@/components/quick-load/QuickLoadCountryPicker";
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
    phone?: string;
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

type SimpleCompanionDraft = {
  category_id: number | null;
  age: number | null;
  notes: string;
};

type ServiceDestinationUiState = {
  noDestination: boolean;
  countryMode: boolean;
  multiMode: boolean;
};

type ServiceDraft = {
  id: string;
  type: string;
  description: string;
  note?: string;
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

type AdjustmentTotals = ReturnType<typeof computeBillingAdjustments>;

const EMPTY_ADJUSTMENTS: AdjustmentTotals = {
  items: [],
  totalCosts: 0,
  totalTaxes: 0,
  total: 0,
};

type QuickLoadSectionId = "clients" | "booking" | "services" | "summary";

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

const SECTION_GLASS =
  "rounded-2xl border border-sky-300/35 bg-white/45 shadow-sm shadow-sky-950/10 backdrop-blur-xl dark:border-sky-200/20 dark:bg-sky-950/25";
const INPUT =
  "w-full rounded-2xl border border-sky-300/45 bg-white/75 px-3 py-2 text-sm text-slate-900 outline-none shadow-sm shadow-sky-950/10 backdrop-blur placeholder:text-slate-500/80 focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 dark:border-sky-200/35 dark:bg-sky-950/20 dark:text-sky-50 dark:placeholder:text-sky-100/60";
const INPUT_SOFT =
  "w-full rounded-2xl border border-sky-300/35 bg-white/65 px-3 py-2 text-sm text-slate-900 outline-none shadow-sm shadow-sky-950/10 backdrop-blur placeholder:text-slate-500/80 focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 dark:border-sky-200/30 dark:bg-sky-950/15 dark:text-sky-50 dark:placeholder:text-sky-100/60";
const SUBCARD =
  "rounded-2xl border border-sky-300/30 bg-white/55 p-4 shadow-sm shadow-sky-950/10 backdrop-blur dark:border-sky-200/20 dark:bg-sky-950/20";
const BTN_SKY =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-sky-500/45 bg-sky-400/20 px-4 py-2 text-sm font-medium text-sky-950 shadow-sm shadow-sky-950/20 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:opacity-95 hover:bg-sky-400/30 active:scale-[0.97] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-300/45 dark:bg-sky-400/20 dark:text-sky-100";
const BTN_EMERALD =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-sky-500/45 bg-sky-400/20 px-4 py-2 text-sm font-medium text-sky-950 shadow-sm shadow-sky-950/20 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:opacity-95 hover:bg-sky-400/30 active:scale-[0.97] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-300/45 dark:bg-sky-400/20 dark:text-sky-100";
const CHIP =
  "inline-flex items-center rounded-full border border-sky-400/40 bg-sky-300/20 px-2.5 py-1 text-[11px] font-semibold text-sky-900 dark:border-sky-300/40 dark:bg-sky-300/20 dark:text-sky-100";
const MINI_TOGGLE_GROUP =
  "flex items-center gap-1 rounded-full border border-sky-300/35 bg-white/60 p-1 text-xs dark:border-sky-200/20 dark:bg-sky-950/20";
const DANGER_ICON_BTN =
  "inline-flex size-9 items-center justify-center rounded-full border border-rose-500/55 bg-rose-200/20 text-rose-700 shadow-sm shadow-rose-950/20 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:opacity-95 hover:bg-rose-200/30 active:scale-[0.97] active:opacity-90 disabled:opacity-50 dark:border-rose-300/55 dark:bg-rose-300/20 dark:text-rose-200";
const SERVICE_SECTION =
  "rounded-2xl border border-sky-300/35 bg-white/35 p-4 shadow-sm shadow-sky-950/5 dark:border-sky-500/25 dark:bg-white/[0.04]";
const SERVICE_INPUT =
  "w-full rounded-2xl border border-sky-300/80 bg-white/70 p-2 px-3 text-sky-950 shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:bg-white focus:ring-2 focus:ring-sky-200/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-500/40 dark:bg-white/10 dark:text-white dark:focus:bg-white/15 dark:focus:ring-sky-500/30";
const NO_DESTINATION_LABEL = "Sin destino";
const DESTINATION_MULTI_SEPARATOR = " · ";

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
        className={`ml-1 block text-sm font-medium text-sky-950 dark:text-white ${
          required
            ? "relative pl-4 before:absolute before:left-0 before:top-1/2 before:size-2 before:-translate-y-1/2 before:rounded-full before:bg-rose-600"
            : ""
        }`}
      >
        {children}
      </label>
    );
  }
  return (
    <span
      className={`ml-1 block text-sm font-medium text-sky-950 dark:text-white ${
        required
          ? "relative pl-4 before:absolute before:left-0 before:top-1/2 before:size-2 before:-translate-y-1/2 before:rounded-full before:bg-rose-600"
          : ""
      }`}
    >
      {children}
    </span>
  );
};

function miniToggleOptionClass(active: boolean): string {
  return `rounded-full px-3 py-1 transition ${
    active
      ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200"
      : "text-sky-900/75 dark:text-sky-100"
  }`;
}

const MiniSwitch = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 items-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-sky-300/60 ${
      checked
        ? "border-sky-500 bg-sky-500"
        : "border-sky-300/80 bg-sky-100/80 dark:border-sky-500/40 dark:bg-sky-900/20"
    } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
  >
    <span
      className={`pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm transition ${
        checked ? "translate-x-4" : "translate-x-0.5"
      }`}
    />
  </button>
);

const ServiceField = ({
  id,
  label,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div className="space-y-1">
    <label
      htmlFor={id}
      className="ml-1 block text-sm font-medium text-sky-950 dark:text-white"
    >
      {label} {required ? <span className="text-rose-600">*</span> : null}
    </label>
    {children}
    {hint ? (
      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">{hint}</p>
    ) : null}
  </div>
);

const SectionCard = ({
  title,
  subtitle,
  open,
  onToggle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className={`${SECTION_GLASS} overflow-hidden`}>
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <button
        type="button"
        className="flex-1 text-left transition hover:opacity-90"
        onClick={onToggle}
        aria-expanded={open}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-xs text-sky-900/70 dark:text-white/70">
            {subtitle}
          </p>
        ) : null}
      </button>
      <div className="flex items-center gap-2">
        {right}
        <button
          type="button"
          className={CHIP}
          onClick={onToggle}
          aria-label={open ? `Ocultar ${title}` : `Expandir ${title}`}
        >
          {open ? "Ocultar" : "Expandir"}
        </button>
      </div>
    </div>

    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: "easeInOut" }}
          className="overflow-hidden"
        >
          <div className="border-t border-sky-300/30 p-4 dark:border-sky-200/15">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </section>
);

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

const hasNumericInput = (value: string | number | null | undefined) => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return false;
};

const normalizeSimpleCompanion = (companion: {
  category_id?: number | null;
  age?: number | null;
  notes?: string | null;
}) => {
  const categoryId =
    companion.category_id != null ? Number(companion.category_id) : null;
  const age = companion.age != null ? Number(companion.age) : null;
  const notes =
    typeof companion.notes === "string" && companion.notes.trim()
      ? companion.notes.trim()
      : null;

  const safeCategory =
    categoryId != null && Number.isFinite(categoryId) && categoryId > 0
      ? Math.floor(categoryId)
      : null;
  const safeAge =
    age != null && Number.isFinite(age) && age >= 0 ? Math.floor(age) : null;

  if (safeCategory == null && safeAge == null && !notes) return null;
  return {
    category_id: safeCategory,
    age: safeAge,
    notes,
  };
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
  note: "",
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

const snapshotFromClient = (
  client: Client,
): ExistingClientDraft["snapshot"] => ({
  first_name: client.first_name,
  last_name: client.last_name,
  phone: client.phone,
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
});

const emptyExistingSnapshot = (): ExistingClientDraft["snapshot"] => ({
  first_name: "",
  last_name: "",
  phone: "",
  birth_date: "",
  dni_number: "",
  passport_number: "",
  email: "",
  address: "",
  postal_code: "",
  locality: "",
  company_name: "",
  commercial_address: "",
  tax_id: "",
});

const isServiceComplete = (
  service: ServiceDraft,
  {
    allowMissingSale = false,
    noDestination = false,
    requireDestination = true,
  }: {
    allowMissingSale?: boolean;
    noDestination?: boolean;
    requireDestination?: boolean;
  } = {},
) => {
  const sale = Number(service.sale_price);
  const cost = Number(service.cost_price);
  const saleOk = allowMissingSale
    ? true
    : hasNumericInput(service.sale_price) && Number.isFinite(sale);
  const costOk = hasNumericInput(service.cost_price) && Number.isFinite(cost);
  const destinationOk =
    !requireDestination || noDestination || service.destination.trim().length > 0;
  return (
    service.type.trim() &&
    service.id_operator > 0 &&
    service.currency.trim() &&
    service.departure_date.trim() &&
    service.return_date.trim() &&
    saleOk &&
    costOk &&
    destinationOk
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
                    className="rounded-full border border-rose-500/55 bg-rose-200/20 px-3 py-1 text-xs font-medium text-rose-700 shadow-sm shadow-rose-950/20 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:bg-rose-200/30 hover:opacity-95 active:scale-[0.97] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-300/55 dark:bg-rose-300/20 dark:text-rose-200"
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
  const [manualOverrideByService, setManualOverrideByService] = useState<
    Record<string, boolean>
  >({});
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
  const [simpleModeByClient, setSimpleModeByClient] = useState<
    Record<string, boolean>
  >({});
  const [calcConfigLoading, setCalcConfigLoading] = useState(false);
  const initialClientDraft = useMemo(() => emptyClient(), []);
  const [clients, setClients] = useState<ClientDraft[]>([initialClientDraft]);
  const [simpleCompanionsByClient, setSimpleCompanionsByClient] = useState<
    Record<string, SimpleCompanionDraft>
  >({});
  const [titularId, setTitularId] = useState<string | null>(
    initialClientDraft.id,
  );
  const [booking, setBooking] = useState<BookingDraft>(emptyBooking);
  const [services, setServices] = useState<ServiceDraft[]>([]);
  const [serviceDestinationModes, setServiceDestinationModes] = useState<
    Record<string, ServiceDestinationUiState>
  >({});
  const [serviceDestinationSelections, setServiceDestinationSelections] =
    useState<Record<string, DestinationOption[]>>({});
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<
    Record<QuickLoadSectionId, boolean>
  >({
    clients: false,
    booking: false,
    services: false,
    summary: false,
  });
  const sectionRefs = useRef<Record<QuickLoadSectionId, HTMLDivElement | null>>({
    clients: null,
    booking: null,
    services: null,
    summary: null,
  });

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
    if (
      !canOverrideBillingMode ||
      billingMode === "manual" ||
      useBookingSaleTotal
    ) {
      setManualOverrideByService((prev) => {
        if (Object.keys(prev).length === 0) return prev;
        return {};
      });
    }
  }, [billingMode, canOverrideBillingMode, useBookingSaleTotal]);

  useEffect(() => {
    if (!useSimpleCompanions) {
      setSimpleModeByClient((prev) => {
        if (Object.keys(prev).length === 0) return prev;
        return {};
      });
    }
  }, [useSimpleCompanions]);

  useEffect(() => {
    if (clients.length === 0) {
      const draft = {
        ...emptyClient(),
        profile_key: resolveClientProfile(clientProfiles, undefined).key,
      };
      setClients([draft]);
      setTitularId(draft.id);
      return;
    }
    if (!titularId || !clients.some((client) => client.id === titularId)) {
      setTitularId(clients[0]?.id ?? null);
    }
  }, [clients, titularId, clientProfiles]);

  useEffect(() => {
    if (!useSimpleCompanions) return;
    setSimpleModeByClient((prev) => {
      const next: Record<string, boolean> = {};
      clients.forEach((client) => {
        if (client.id === titularId) return;
        if (prev[client.id]) {
          next[client.id] = true;
        }
      });
      const prevKeys = Object.keys(prev).sort();
      const nextKeys = Object.keys(next).sort();
      if (
        prevKeys.length === nextKeys.length &&
        prevKeys.every((key, idx) => key === nextKeys[idx])
      ) {
        return prev;
      }
      return next;
    });
  }, [clients, titularId, useSimpleCompanions]);

  useEffect(() => {
    setServiceDestinationModes((prev) => {
      const next: Record<string, ServiceDestinationUiState> = {};
      services.forEach((service) => {
        next[service.id] = prev[service.id] || {
          noDestination: false,
          countryMode: false,
          multiMode: false,
        };
      });
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const sameLength = prevKeys.length === nextKeys.length;
      const sameKeys =
        sameLength && nextKeys.every((key) => Object.prototype.hasOwnProperty.call(prev, key));
      if (sameKeys) return prev;
      return next;
    });
  }, [services]);

  useEffect(() => {
    setManualOverrideByService((prev) => {
      const next: Record<string, boolean> = {};
      services.forEach((service) => {
        if (prev[service.id]) {
          next[service.id] = true;
        }
      });
      const prevKeys = Object.keys(prev).sort();
      const nextKeys = Object.keys(next).sort();
      if (
        prevKeys.length === nextKeys.length &&
        prevKeys.every((key, idx) => key === nextKeys[idx])
      ) {
        return prev;
      }
      return next;
    });
  }, [services]);

  useEffect(() => {
    setServiceDestinationSelections((prev) => {
      const next: Record<string, DestinationOption[]> = {};
      services.forEach((service) => {
        next[service.id] = prev[service.id] || [];
      });
      const prevKeys = Object.keys(prev).sort();
      const nextKeys = Object.keys(next).sort();
      if (
        prevKeys.length === nextKeys.length &&
        prevKeys.every((key, idx) => key === nextKeys[idx])
      ) {
        return prev;
      }
      return next;
    });
  }, [services]);

  const addNewClient = () => {
    const draft = {
      ...emptyClient(),
      profile_key: resolveClientProfile(clientProfiles, undefined).key,
    };
    setClients((prev) => [...prev, draft]);
    if (!titularId) setTitularId(draft.id);
  };

  const setClientToNew = (id: string) => {
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.kind !== "existing") return c;
        return {
          ...emptyClient(),
          id: c.id,
          profile_key: resolveClientProfile(clientProfiles, undefined).key,
          first_name: c.snapshot.first_name || "",
          last_name: c.snapshot.last_name || "",
          phone: c.snapshot.phone || "",
          birth_date: c.snapshot.birth_date || "",
          dni_number: c.snapshot.dni_number || "",
          passport_number: c.snapshot.passport_number || "",
          email: c.snapshot.email || "",
          address: c.snapshot.address || "",
          postal_code: c.snapshot.postal_code || "",
          locality: c.snapshot.locality || "",
          company_name: c.snapshot.company_name || "",
          commercial_address: c.snapshot.commercial_address || "",
          tax_id: c.snapshot.tax_id || "",
        };
      }),
    );
  };

  const setClientToExisting = (id: string) => {
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.kind !== "new") return c;
        return {
          id: c.id,
          kind: "existing",
          existingId: 0,
          snapshot: {
            first_name: c.first_name || "",
            last_name: c.last_name || "",
            phone: c.phone || "",
            birth_date: c.birth_date || "",
            dni_number: c.dni_number || "",
            passport_number: c.passport_number || "",
            email: c.email || "",
            address: c.address || "",
            postal_code: c.postal_code || "",
            locality: c.locality || "",
            company_name: c.company_name || "",
            commercial_address: c.commercial_address || "",
            tax_id: c.tax_id || "",
          },
        };
      }),
    );
  };

  const selectExistingClientForDraft = (draftId: string, client: Client) => {
    let duplicate = false;
    setClients((prev) => {
      if (
        prev.some(
          (item) =>
            item.id !== draftId &&
            item.kind === "existing" &&
            item.existingId === client.id_client,
        )
      ) {
        duplicate = true;
        return prev;
      }
      return prev.map((item) =>
        item.id === draftId
          ? {
              id: item.id,
              kind: "existing",
              existingId: client.id_client,
              snapshot: snapshotFromClient(client),
            }
          : item,
      );
    });
    if (duplicate) {
      toast.info("Ese pax ya está en la lista.");
      return;
    }
  };

  const clearExistingClientForDraft = (draftId: string) => {
    setClients((prev) =>
      prev.map((item) =>
        item.id === draftId && item.kind === "existing"
          ? {
              ...item,
              existingId: 0,
              snapshot: emptyExistingSnapshot(),
            }
          : item,
      ),
    );
  };

  const removeClient = (id: string) => {
    setClients((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((c) => c.id !== id);
      setTitularId((current) => {
        if (current && next.some((c) => c.id === current)) return current;
        return next[0]?.id ?? null;
      });
      setSimpleCompanionsByClient((current) => {
        if (!(id in current)) return current;
        const nextMap = { ...current };
        delete nextMap[id];
        return nextMap;
      });
      setSimpleModeByClient((current) => {
        if (!(id in current)) return current;
        const nextMap = { ...current };
        delete nextMap[id];
        return nextMap;
      });
      return next;
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

  const updateBookingField = (field: keyof BookingDraft, value: string) => {
    setBooking((prev) => ({ ...prev, [field]: value }));
  };

  const updateSimpleCompanionForClient = (
    clientId: string,
    patch: Partial<SimpleCompanionDraft>,
  ) => {
    setSimpleCompanionsByClient((prev) => {
      const current = prev[clientId] || {
        category_id: null,
        age: null,
        notes: "",
      };
      return {
        ...prev,
        [clientId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const updateBookingSaleTotal = (currency: string, value: string) => {
    setBookingSaleTotals((prev) => ({ ...prev, [currency]: value }));
  };

  const presetCacheRef = useRef<Map<string, ServiceTypePresetLite[]>>(new Map());

  const isClientSimpleCompanion = useCallback(
    (clientId: string) => {
      if (!useSimpleCompanions) return false;
      if (!titularId) return false;
      if (clientId === titularId) return false;
      return Boolean(simpleModeByClient[clientId]);
    },
    [useSimpleCompanions, titularId, simpleModeByClient],
  );

  const activeSimpleCompanions = useMemo(() => {
    if (!useSimpleCompanions) return [];
    return clients
      .filter((client) => isClientSimpleCompanion(client.id))
      .map((client) => {
        const draft = simpleCompanionsByClient[client.id] || {
          category_id: null,
          age: null,
          notes: "",
        };
        return normalizeSimpleCompanion(draft);
      })
      .filter((item): item is { category_id: number | null; age: number | null; notes: string | null } =>
        item !== null,
      );
  }, [useSimpleCompanions, clients, simpleCompanionsByClient, isClientSimpleCompanion]);

  const simpleCompanionCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    activeSimpleCompanions.forEach((c) => {
      const id = c.category_id;
      if (typeof id !== "number" || !Number.isFinite(id)) return;
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }, [activeSimpleCompanions]);

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

  const updateServiceDestinationMode = useCallback(
    (id: string, patch: Partial<ServiceDestinationUiState>) => {
      setServiceDestinationModes((prev) => {
        const current = prev[id] || {
          noDestination: false,
          countryMode: false,
          multiMode: false,
        };
        return {
          ...prev,
          [id]: {
            ...current,
            ...patch,
          },
        };
      });
    },
    [],
  );

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

  const resolveServiceDestinationPickerValue = useCallback(
    (
      service: ServiceDraft,
      mode: ServiceDestinationUiState,
    ): DestinationOption | DestinationOption[] | null => {
      const selected = serviceDestinationSelections[service.id] || [];
      if (selected.length > 0) {
        return mode.multiMode ? selected : selected[0] || null;
      }

      const rawDestination = (service.destination || "").trim();
      if (
        !rawDestination ||
        rawDestination.toLowerCase() === NO_DESTINATION_LABEL.toLowerCase()
      ) {
        return null;
      }

      const chunks = mode.multiMode
        ? rawDestination
            .split(DESTINATION_MULTI_SEPARATOR)
            .map((item) => item.trim())
            .filter(Boolean)
        : [rawDestination];
      const fallback = chunks.map<DestinationOption>((label, idx) => ({
        id: -(idx + 1),
        kind: mode.countryMode ? "country" : "destination",
        name: label,
        displayLabel: label,
      }));
      if (fallback.length === 0) return null;
      return mode.multiMode ? fallback : fallback[0];
    },
    [serviceDestinationSelections],
  );

  const handleDestinationSelect = (
    id: string,
    val: DestinationOption | DestinationOption[] | null,
  ) => {
    const mode = serviceDestinationModes[id];
    if (mode?.noDestination) {
      setServiceDestinationSelections((prev) => ({ ...prev, [id]: [] }));
      updateServiceField(id, "destination", NO_DESTINATION_LABEL);
      return;
    }
    const selected = Array.isArray(val) ? val : val ? [val] : [];
    setServiceDestinationSelections((prev) => ({ ...prev, [id]: selected }));
    const label = selected.map((opt) => opt.displayLabel).join(DESTINATION_MULTI_SEPARATOR);
    updateServiceField(id, "destination", label);
  };

  const toggleServiceNoDestination = (serviceId: string, checked: boolean) => {
    updateServiceDestinationMode(serviceId, { noDestination: checked });
    if (checked) {
      setServiceDestinationSelections((prev) => ({ ...prev, [serviceId]: [] }));
      updateServiceField(serviceId, "destination", NO_DESTINATION_LABEL);
      return;
    }
    setServices((prev) =>
      prev.map((service) =>
        service.id === serviceId && service.destination === NO_DESTINATION_LABEL
          ? { ...service, destination: "" }
          : service,
      ),
    );
  };

  const servicesReady = services.every((service) => {
    const mode = serviceDestinationModes[service.id];
    const noDestination =
      mode?.noDestination === true ||
      service.destination.trim().toLowerCase() ===
        NO_DESTINATION_LABEL.toLowerCase();
    return isServiceComplete(service, {
      allowMissingSale: useBookingSaleTotal,
      noDestination,
    });
  });
  const nextSaleTotalOverridePayload = useMemo(
    () =>
      useBookingSaleTotal === inheritedUseBookingSaleTotal
        ? null
        : useBookingSaleTotal,
    [inheritedUseBookingSaleTotal, useBookingSaleTotal],
  );
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

  const toggleSection = useCallback((section: QuickLoadSectionId) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const openSection = useCallback((section: QuickLoadSectionId) => {
    setOpenSections((prev) => ({ ...prev, [section]: true }));
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      sectionRefs.current[section]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const focusFirstFieldInSection = useCallback((section: QuickLoadSectionId) => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const root = sectionRefs.current[section];
      if (!root) return;
      const firstInteractive = root.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      );
      firstInteractive?.focus();
    });
  }, []);

  const currenciesForSaleTotals = useMemo(
    () =>
      services.length > 0
        ? Array.from(
            new Set(services.map((s) => (s.currency || "ARS").toUpperCase())),
          )
        : ["ARS"],
    [services],
  );
  const clientsForBooking = useMemo(() => {
    if (!useSimpleCompanions || !titularId) return clients;
    return clients.filter(
      (client) =>
        client.id === titularId || !isClientSimpleCompanion(client.id),
    );
  }, [clients, titularId, useSimpleCompanions, isClientSimpleCompanion]);
  const incompleteNewClients = useMemo(
    () =>
      clientsForBooking.filter(
        (client) =>
          client.kind === "new" && missingClientFields(client).length > 0,
      ),
    [clientsForBooking, missingClientFields],
  );
  const pendingExistingClients = useMemo(
    () =>
      clientsForBooking.filter(
        (client) => client.kind === "existing" && client.existingId <= 0,
      ),
    [clientsForBooking],
  );
  const incompleteClientCount =
    incompleteNewClients.length + pendingExistingClients.length;
  const incompleteSimpleCompanionCount = useMemo(() => {
    if (!useSimpleCompanions || !titularId) return 0;
    return clients.reduce((acc, client) => {
      if (!isClientSimpleCompanion(client.id)) return acc;
      const draft = simpleCompanionsByClient[client.id] || {
        category_id: null,
        age: null,
        notes: "",
      };
      return normalizeSimpleCompanion(draft) ? acc : acc + 1;
    }, 0);
  }, [
    useSimpleCompanions,
    titularId,
    clients,
    simpleCompanionsByClient,
    isClientSimpleCompanion,
  ]);
  const missingSaleTotalCurrencies = useMemo(() => {
    if (!useBookingSaleTotal || services.length === 0) return [];
    return currenciesForSaleTotals.filter((cur) => {
      const raw = bookingSaleTotals[cur];
      return raw == null || toNumber(raw) <= 0;
    });
  }, [
    bookingSaleTotals,
    currenciesForSaleTotals,
    useBookingSaleTotal,
    services.length,
  ]);

  const sectionIssues = useMemo(
    () => ({
      clients:
        clients.length === 0 ||
        !titularId ||
        incompleteClientCount > 0 ||
        incompleteSimpleCompanionCount > 0,
      booking:
        !booking.details.trim() ||
        !booking.departure_date.trim() ||
        !booking.return_date.trim() ||
        !booking.invoice_type.trim(),
      services:
        missingSaleTotalCurrencies.length > 0 ||
        (services.length > 0 && !servicesReady),
    }),
    [
      clients.length,
      titularId,
      incompleteClientCount,
      incompleteSimpleCompanionCount,
      booking.details,
      booking.departure_date,
      booking.return_date,
      booking.invoice_type,
      missingSaleTotalCurrencies.length,
      services.length,
      servicesReady,
    ],
  );

  const missingSummary = useMemo(() => {
    const missing: string[] = [];
    if (clients.length === 0) {
      missing.push("Agregar al menos un pax.");
    }
    if (!titularId) {
      missing.push("Definir un titular.");
    }
    if (incompleteNewClients.length > 0) {
      const paxLabel = incompleteNewClients.length === 1 ? "pax" : "pasajeros";
      missing.push(
        `Completar ${incompleteNewClients.length} ${paxLabel} con datos obligatorios.`,
      );
    }
    if (pendingExistingClients.length > 0) {
      const paxLabel = pendingExistingClients.length === 1 ? "pax" : "pasajeros";
      missing.push(
        `Seleccionar ${pendingExistingClients.length} ${paxLabel} existente${
          pendingExistingClients.length === 1 ? "" : "s"
        }.`,
      );
    }
    if (incompleteSimpleCompanionCount > 0) {
      const paxLabel =
        incompleteSimpleCompanionCount === 1 ? "acompañante" : "acompañantes";
      missing.push(
        `Completar ${incompleteSimpleCompanionCount} ${paxLabel} simple${
          incompleteSimpleCompanionCount === 1 ? "" : "s"
        } (categoría, edad o nota).`,
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
    if (missingSaleTotalCurrencies.length > 0) {
      missing.push(`Completar venta total (${missingSaleTotalCurrencies.join(", ")}).`);
    }
    if (services.length > 0 && !servicesReady) {
      missing.push("Revisar servicios incompletos.");
    }
    return missing;
  }, [
    clients.length,
    titularId,
    incompleteNewClients.length,
    pendingExistingClients.length,
    incompleteSimpleCompanionCount,
    booking.details,
    booking.departure_date,
    booking.return_date,
    booking.invoice_type,
    missingSaleTotalCurrencies,
    services.length,
    servicesReady,
  ]);

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

  const buildClientIds = async (sourceClients: ClientDraft[]) => {
    if (!token) throw new Error("Sin sesión");
    const idMap = new Map<string, number>();
    for (const client of sourceClients) {
      if (client.kind === "existing") {
        if (!Number.isFinite(client.existingId) || client.existingId <= 0) {
          throw new Error("Falta seleccionar un pax existente.");
        }
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
    if (!Number.isFinite(existingId) || existingId <= 0) {
      toast.error("Seleccioná un titular existente válido.");
      return false;
    }
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
      const firstMissingSection: QuickLoadSectionId = sectionIssues.clients
        ? "clients"
        : sectionIssues.booking
          ? "booking"
          : sectionIssues.services
            ? "services"
            : "summary";
      setOpenSections((prev) => ({
        ...prev,
        clients: prev.clients || sectionIssues.clients,
        booking: prev.booking || sectionIssues.booking,
        services: prev.services || sectionIssues.services,
        summary: prev.summary,
      }));
      toast.error(
        <div className="space-y-1">
          <p className="text-sm font-semibold">Faltan datos para confirmar:</p>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {missingSummary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>,
        { autoClose: 9000 },
      );
      openSection(firstMissingSection);
      focusFirstFieldInSection(firstMissingSection);
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
      const idMap = await buildClientIds(clientsForBooking);
      const titularBackendId = idMap.get(titularId);
      if (!titularBackendId) throw new Error("Titular inválido.");
      const companions = clientsForBooking
        .filter((c) => c.id !== titularId)
        .map((c) => idMap.get(c.id))
        .filter((id): id is number => typeof id === "number");
      const simpleCompanions = activeSimpleCompanions;

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

      for (const [index, service] of services.entries()) {
        const serviceLabel = `Servicio ${index + 1}`;
        const mode = serviceDestinationModes[service.id];
        const noDestination =
          mode?.noDestination === true ||
          service.destination.trim().toLowerCase() ===
            NO_DESTINATION_LABEL.toLowerCase();
        const salePresent = hasNumericInput(service.sale_price);
        const costPresent = hasNumericInput(service.cost_price);
        if (!useBookingSaleTotal && !salePresent) {
          throw new Error(`${serviceLabel}: completá el precio de venta.`);
        }
        if (!costPresent) {
          throw new Error(`${serviceLabel}: completá el precio de costo.`);
        }
        if (!noDestination && !service.destination.trim()) {
          throw new Error(`${serviceLabel}: completá el destino.`);
        }
        const saleValue =
          useBookingSaleTotal && !salePresent ? 0 : toNumber(service.sale_price);
        const costValue = toNumber(service.cost_price);
        const transferPct = Number.isFinite(service.transfer_fee_pct)
          ? service.transfer_fee_pct
          : transferFeePct || 0.024;
        const transferAmount =
          Number.isFinite(service.transfer_fee_amount)
            ? (service.transfer_fee_amount as number)
            : saleValue * transferPct;
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
          note: service.note?.trim() || null,
          sale_price: saleValue,
          cost_price: costValue,
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
          destination: noDestination
            ? NO_DESTINATION_LABEL
            : service.destination.trim(),
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

      toast.success("Carga rápida confirmada. Abriendo la reserva...");
      router.push(`/bookings/services/${createdBooking.id_booking}`);
    } catch (err) {
      console.error("❌ Error confirmando carga rápida:", err);
      toast.error(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setSaving(false);
    }
  };

  const operatorMap = useMemo(() => {
    const map = new Map<number, Operator>();
    operators.forEach((op) => map.set(op.id_operator, op));
    return map;
  }, [operators]);

  return (
    <ProtectedRoute>
      <section className="space-y-8 text-sky-950 dark:text-white">
        {loadingProfile ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-4">
            <div
              ref={(node) => {
                sectionRefs.current.clients = node;
              }}
            >
              <SectionCard
                title="Clientes"
                subtitle="Alta rápida de pasajeros, titular y acompañantes."
                open={openSections.clients}
                onToggle={() => toggleSection("clients")}
              >
                {openSections.clients && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
	                <div className="grid gap-6">
	                  {clients.map((client, index) => {
	                    const isTitular = client.id === titularId;
                      const isSimpleCompanionCard = isClientSimpleCompanion(
                        client.id,
                      );
	                    const existingExcludeIds = clients
	                      .filter(
	                        (item): item is ExistingClientDraft =>
	                          item.id !== client.id &&
	                          item.kind === "existing" &&
	                          item.existingId > 0,
	                      )
	                      .map((item) => item.existingId);
	                    const profileConfig =
	                      client.kind === "new"
	                        ? resolveProfile(client.profile_key)
                        : null;
	                    const customFieldsForClient =
	                      client.kind === "new"
	                        ? getCustomFieldsForClient(client)
	                        : [];
	                    const simpleCompanionDraft = simpleCompanionsByClient[
	                      client.id
	                    ] || {
	                      category_id: null,
	                      age: null,
	                      notes: "",
	                    };
	                    return (
	                      <motion.div
	                        key={client.id}
	                        layout
	                        className="rounded-2xl border border-sky-300/30 bg-white/55 p-4 dark:border-sky-200/20 dark:bg-sky-950/20"
	                      >
	                        <div className="mb-4 flex items-start justify-between gap-3">
	                          <div className="flex-1">
	                            <p className="text-xs uppercase tracking-[0.16em] text-sky-800/70 dark:text-sky-100/70">
	                              Pax Nº {index + 1}
	                            </p>
	                            <p className="text-xs text-sky-900/75 dark:text-sky-100/75">
	                              {isTitular ? "Titular de la reserva" : "Acompañante"}
	                            </p>
	                          </div>
	                          <button
	                            type="button"
	                            className={DANGER_ICON_BTN}
	                            onClick={() => removeClient(client.id)}
	                            aria-label="Quitar pax"
	                            title="Quitar pax"
	                            disabled={clients.length <= 1}
	                          >
	                            <IconTrash className="size-4" />
	                          </button>
	                        </div>

	                        <div className="mb-3 grid gap-3 md:grid-cols-2">
	                          <div>
	                            <label className="mb-1 block text-xs opacity-75">
	                              Tipo de carga
	                            </label>
	                            <div className={MINI_TOGGLE_GROUP}>
	                              <button
	                                type="button"
	                                className={miniToggleOptionClass(client.kind === "new")}
	                                onClick={() => setClientToNew(client.id)}
	                              >
	                                Pax nuevo
	                              </button>
	                              <button
	                                type="button"
	                                className={miniToggleOptionClass(
	                                  client.kind === "existing",
	                                )}
	                                onClick={() => setClientToExisting(client.id)}
	                              >
	                                Pax existente
	                              </button>
	                            </div>
	                          </div>
	                          <div>
	                            <label className="mb-1 block text-xs opacity-75">
	                              Rol en reserva
	                            </label>
	                            <div className={`${MINI_TOGGLE_GROUP} flex-wrap`}>
	                              <button
	                                type="button"
	                                className={miniToggleOptionClass(isTitular)}
	                                onClick={() => setTitularId(client.id)}
	                              >
	                                Titular
	                              </button>
	                              {clients.length > 1 ? (
	                                <button
	                                  type="button"
	                                  className={miniToggleOptionClass(!isTitular)}
	                                  onClick={() =>
	                                    setTitularId((current) => {
	                                      if (current !== client.id) return current;
	                                      return (
	                                        clients.find((item) => item.id !== client.id)?.id ??
	                                        null
	                                      );
	                                    })
	                                  }
	                                >
	                                  No titular
	                                </button>
	                              ) : null}
	                              {useSimpleCompanions && !isTitular ? (
	                                <>
	                                  <span
	                                    aria-hidden
	                                    className="mx-1 h-4 w-px bg-sky-300/45 dark:bg-sky-200/25"
	                                  />
	                                  <button
	                                    type="button"
	                                    className={miniToggleOptionClass(
                                      !isSimpleCompanionCard,
                                    )}
	                                    onClick={() =>
                                      setSimpleModeByClient((prev) => {
                                        if (!(client.id in prev)) return prev;
                                        const next = { ...prev };
                                        delete next[client.id];
                                        return next;
                                      })
                                    }
	                                  >
	                                    Completo
	                                  </button>
	                                  <button
	                                    type="button"
	                                    className={miniToggleOptionClass(
                                      isSimpleCompanionCard,
                                    )}
	                                    onClick={() =>
                                      setSimpleModeByClient((prev) => ({
                                        ...prev,
                                        [client.id]: true,
                                      }))
                                    }
	                                  >
	                                    Simple
	                                  </button>
	                                </>
	                              ) : null}
	                            </div>
	                          </div>
	                        </div>

	                        {isSimpleCompanionCard && !isTitular ? (
	                          <div className="grid gap-3 md:grid-cols-3">
	                            <div>
	                              <label className="mb-1 block text-xs opacity-75">
	                                Categoría
	                              </label>
	                              <select
	                                value={simpleCompanionDraft.category_id ?? ""}
	                                onChange={(e) =>
	                                  updateSimpleCompanionForClient(client.id, {
	                                    category_id: e.target.value
	                                      ? Number(e.target.value)
	                                      : null,
	                                  })
	                                }
	                                className={`${INPUT} cursor-pointer`}
	                              >
	                                <option value="">Categoría</option>
	                                {passengerCategories
	                                  .filter((item) => item.enabled !== false)
	                                  .map((item) => (
	                                    <option
	                                      key={item.id_category}
	                                      value={item.id_category}
	                                    >
	                                      {item.name}
	                                    </option>
	                                  ))}
	                              </select>
	                            </div>
	                            <div>
	                              <label className="mb-1 block text-xs opacity-75">
	                                Edad
	                              </label>
	                              <input
	                                type="number"
	                                min={0}
	                                value={simpleCompanionDraft.age ?? ""}
	                                onChange={(e) =>
	                                  updateSimpleCompanionForClient(client.id, {
	                                    age: e.target.value
	                                      ? Number(e.target.value)
	                                      : null,
	                                  })
	                                }
	                                className={INPUT}
	                                placeholder="Edad"
	                              />
	                            </div>
	                            <div>
	                              <label className="mb-1 block text-xs opacity-75">
	                                Notas
	                              </label>
	                              <input
	                                type="text"
	                                value={simpleCompanionDraft.notes ?? ""}
	                                onChange={(e) =>
	                                  updateSimpleCompanionForClient(client.id, {
	                                    notes: e.target.value,
	                                  })
	                                }
	                                className={INPUT}
	                                placeholder="Opcional"
	                              />
	                            </div>
	                          </div>
	                        ) : client.kind === "existing" ? (
	                          <div>
	                            <ClientPicker
	                              token={token}
	                              placeholder="Buscar pax existente..."
	                              valueId={client.existingId > 0 ? client.existingId : null}
	                              excludeIds={existingExcludeIds}
	                              onSelect={(selected) =>
	                                selectExistingClientForDraft(client.id, selected)
	                              }
	                              onClear={() => clearExistingClientForDraft(client.id)}
	                            />
	                          </div>
	                        ) : (
	                          <div>
	                            <div className="grid gap-3 md:grid-cols-2">
	                              {clientProfiles.length > 1 && (
	                                <div>
	                                  <FieldLabel htmlFor={`profile-${client.id}`} required>
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
	                                    className={`${INPUT} cursor-pointer`}
	                                  >
	                                    {clientProfiles.map((profile) => (
	                                      <option key={profile.key} value={profile.key}>
	                                        {profile.label}
	                                      </option>
	                                    ))}
	                                  </select>
	                                </div>
	                              )}
	                              <div
	                                className={
	                                  isHiddenField(client, "first_name") ? "hidden" : ""
	                                }
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
	                                  placeholder="Nombre"
	                                />
	                              </div>
	                              <div
	                                className={
	                                  isHiddenField(client, "last_name") ? "hidden" : ""
	                                }
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
	                                  placeholder="Apellido"
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
	                                  placeholder="Teléfono"
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
	                                  placeholder="Email"
	                                />
	                              </div>
	                              <div
	                                className={
	                                  isHiddenField(client, "birth_date") ? "hidden" : ""
	                                }
	                              >
	                                <FieldLabel
	                                  htmlFor={`birth-${client.id}`}
	                                  required={isRequiredField(client, "birth_date")}
	                                >
	                                  Fecha de nacimiento
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
	                                  <option value="">Género</option>
	                                  <option value="Masculino">Masculino</option>
	                                  <option value="Femenino">Femenino</option>
	                                  <option value="Otro">Otro</option>
	                                </select>
	                              </div>
	                              <div
	                                className={`md:col-span-2 ${
	                                  isHiddenField(client, "nationality") ? "hidden" : ""
	                                }`}
	                              >
	                                <FieldLabel
	                                  required={isRequiredField(client, "nationality")}
	                                >
	                                  Nacionalidad
	                                </FieldLabel>
	                                <QuickLoadCountryPicker
	                                  token={token}
	                                  value={client.nationality || ""}
	                                  onChange={(next) =>
	                                    updateClientField(client.id, "nationality", next)
	                                  }
	                                  placeholder="Nacionalidad"
	                                />
	                              </div>
	                              <div
	                                className={
	                                  isHiddenField(client, "dni_number") ? "hidden" : ""
	                                }
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
	                                  placeholder="DNI"
	                                />
	                              </div>
	                              <div
	                                className={
	                                  isHiddenField(client, "passport_number")
	                                    ? "hidden"
	                                    : ""
	                                }
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
	                                  placeholder="Pasaporte"
	                                />
	                              </div>
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
	                                  className={INPUT}
	                                  placeholder="CUIT / RUT"
	                                />
	                              </div>
	                              <div
	                                className={
	                                  isHiddenField(client, "company_name") ? "hidden" : ""
	                                }
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
	                                  className={INPUT}
	                                  placeholder="Razón social"
	                                />
	                              </div>
	                              <div
	                                className={
	                                  isHiddenField(client, "commercial_address")
	                                    ? "hidden"
	                                    : ""
	                                }
	                              >
	                                <FieldLabel
	                                  htmlFor={`address-${client.id}`}
	                                  required={isRequiredField(
	                                    client,
	                                    "commercial_address",
	                                  )}
	                                >
	                                  Domicilio comercial
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
	                                  className={INPUT}
	                                  placeholder="Domicilio comercial"
	                                />
	                              </div>
	                              <div
	                                className={isHiddenField(client, "address") ? "hidden" : ""}
	                              >
	                                <FieldLabel
	                                  htmlFor={`home-${client.id}`}
	                                  required={isRequiredField(client, "address")}
	                                >
	                                  Dirección
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
	                                  className={INPUT}
	                                  placeholder="Dirección"
	                                />
	                              </div>
	                              <div
	                                className={isHiddenField(client, "locality") ? "hidden" : ""}
	                              >
	                                <FieldLabel
	                                  htmlFor={`locality-${client.id}`}
	                                  required={isRequiredField(client, "locality")}
	                                >
	                                  Localidad
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
	                                  className={INPUT}
	                                  placeholder="Localidad"
	                                />
	                              </div>
	                              <div
	                                className={
	                                  isHiddenField(client, "postal_code") ? "hidden" : ""
	                                }
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
	                                  className={INPUT}
	                                  placeholder="Código postal"
	                                />
	                              </div>
	                              {customFieldsForClient.map((field) => (
	                                <div
	                                  key={`${client.id}-${field.key}`}
	                                  className={
	                                    field.type === "textarea" ? "md:col-span-2" : ""
	                                  }
	                                >
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
	                                      value={client.custom_fields?.[field.key] || ""}
	                                      onChange={(e) =>
	                                        updateClientCustomField(
	                                          client.id,
	                                          field.key,
	                                          e.target.value,
	                                        )
	                                      }
	                                      className={`${INPUT} cursor-pointer`}
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
	                                      value={client.custom_fields?.[field.key] || ""}
	                                      onChange={(e) =>
	                                        updateClientCustomField(
	                                          client.id,
	                                          field.key,
	                                          e.target.value,
	                                        )
	                                      }
	                                      className={`${INPUT} cursor-pointer`}
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
	                                      value={client.custom_fields?.[field.key] || ""}
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
	                                      value={client.custom_fields?.[field.key] || ""}
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
                      </motion.div>
	                    );
	                  })}
	                </div>

	                <div>
	                  <button
	                    type="button"
	                    className={BTN_SKY}
	                    onClick={addNewClient}
	                  >
	                    <IconPlus className="size-4" />
	                    Agregar pax
	                  </button>
	                </div>

              </motion.div>
                )}
              </SectionCard>
            </div>

            <div
              ref={(node) => {
                sectionRefs.current.booking = node;
              }}
            >
              <SectionCard
                title="Reserva"
                subtitle="Datos básicos, fechas y facturación."
                open={openSections.booking}
                onToggle={() => toggleSection("booking")}
              >
                {openSections.booking && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                <div className="rounded-2xl border border-sky-300/30 bg-white/55 p-4 dark:border-sky-200/20 dark:bg-sky-950/20">
                  <div className="grid gap-3 md:grid-cols-2">
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
                    <div>
                      <FieldLabel htmlFor="booking-from" required>
                        Fecha salida
                      </FieldLabel>
                      <input
                        id="booking-from"
                        type="date"
                        value={booking.departure_date}
                        onChange={(e) =>
                          updateBookingField("departure_date", e.target.value)
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
                          updateBookingField("invoice_observation", e.target.value)
                        }
                        className={INPUT}
                        placeholder="Ej: Facturar al pax N° 342"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <FieldLabel htmlFor="booking-observation">
                        Observación interna
                      </FieldLabel>
                      <textarea
                        id="booking-observation"
                        value={booking.observation}
                        onChange={(e) =>
                          updateBookingField("observation", e.target.value)
                        }
                        className={INPUT}
                        placeholder="Notas internas, pedidos especiales..."
                        rows={3}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
                )}
              </SectionCard>
            </div>

            <div
              ref={(node) => {
                sectionRefs.current.services = node;
              }}
            >
              <SectionCard
                title="Servicios"
                subtitle="Carga y desglose de servicios."
                open={openSections.services}
                onToggle={() => toggleSection("services")}
              >
                {openSections.services && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                <div className="rounded-3xl border border-sky-900/10 bg-white/35 p-4 text-sky-950 shadow-sm shadow-sky-950/5 backdrop-blur dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
                  <div className="mt-6 grid gap-4">
                    {(canOverrideSaleTotal || useBookingSaleTotal) && (
                      <div className="rounded-2xl border border-sky-900/10 bg-white/60 p-4 shadow-sm shadow-sky-950/5 dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">Modo de montos</p>
                            <p className="text-xs text-sky-900/70 dark:text-white/70">
                              Elegí entre monto total de reserva o montos por
                              servicio.
                            </p>
                            {calcConfigLoading ? (
                              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                                Cargando configuración...
                              </p>
                            ) : null}
                          </div>
                          {canOverrideSaleTotal ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-full border border-sky-900/10 bg-white/70 p-1 dark:border-white/10 dark:bg-white/10">
                              <button
                                type="button"
                                className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition ${
                                  useBookingSaleTotal
                                    ? "bg-sky-500/20 text-sky-950 dark:bg-sky-500/40 dark:text-white"
                                    : "text-sky-900/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/15"
                                }`}
                                onClick={() => setUseBookingSaleTotal(true)}
                              >
                                Monto total reserva
                              </button>
                              <button
                                type="button"
                                className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition ${
                                  !useBookingSaleTotal
                                    ? "bg-sky-500/20 text-sky-950 dark:bg-sky-500/40 dark:text-white"
                                    : "text-sky-900/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/15"
                                }`}
                                onClick={() => setUseBookingSaleTotal(false)}
                              >
                                Montos por servicio
                              </button>
                            </div>
                          ) : (
                            <span className="rounded-full border border-sky-900/10 bg-white/70 px-3 py-1 text-[11px] font-medium text-sky-900/80 dark:border-white/10 dark:bg-white/10 dark:text-white/70">
                              {useBookingSaleTotal
                                ? "Monto total reserva"
                                : "Montos por servicio"}
                            </span>
                          )}
                        </div>

                        {useBookingSaleTotal && (
                          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                        {services.map((service, idx) => {
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
                          const destinationMode =
                            serviceDestinationModes[service.id] || {
                              noDestination: false,
                              countryMode: false,
                              multiMode: false,
                            };
                          const destinationPickerValue =
                            resolveServiceDestinationPickerValue(
                              service,
                              destinationMode,
                            );
                          const serviceManualOverride = Boolean(
                            manualOverrideByService[service.id],
                          );
                          const serviceManualMode =
                            useBookingSaleTotal ||
                            billingMode === "manual" ||
                            (canOverrideBillingMode && serviceManualOverride);
                          return (
                            <motion.div
                              key={service.id}
                              layout
                              className="rounded-3xl border border-sky-900/10 bg-white/60 p-4 text-sky-950 shadow-sm shadow-sky-950/5 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
                            >
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <p className="text-base font-semibold">
                                    Servicio {idx + 1}
                                  </p>
                                  <p className="text-xs text-sky-900/70 dark:text-white/70">
                                    Completá datos básicos, fechas y montos.
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className={DANGER_ICON_BTN}
                                    onClick={() => removeService(service.id)}
                                    aria-label="Quitar servicio"
                                    title="Quitar servicio"
                                  >
                                    <IconTrash className="size-4" />
                                  </button>
                                </div>
                              </div>

                              <div className="mt-5 space-y-4">
                                <section className={SERVICE_SECTION}>
                                  <div className="mb-3">
                                    <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
                                      Datos básicos
                                    </h3>
                                    <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
                                      Definen qué compró el pax y cómo lo vas a identificar.
                                    </p>
                                  </div>
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <ServiceField
                                      id={`service-type-${service.id}`}
                                      label="Tipo de servicio"
                                      required
                                    >
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
                                        className={`${SERVICE_INPUT} cursor-pointer`}
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
                                    </ServiceField>

                                    <ServiceField
                                      id={`service-desc-${service.id}`}
                                      label="Descripción"
                                      hint="Detalle corto y claro."
                                    >
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
                                        className={SERVICE_INPUT}
                                        placeholder="Ej: Hotel + desayuno"
                                      />
                                    </ServiceField>

                                    <div className="col-span-full -mb-1 flex flex-wrap items-center gap-4 px-1">
                                      <label className="inline-flex items-center gap-2 text-sm">
                                        <MiniSwitch
                                          checked={destinationMode.noDestination}
                                          onChange={(checked) =>
                                            toggleServiceNoDestination(
                                              service.id,
                                              checked,
                                            )
                                          }
                                          ariaLabel="Sin destino"
                                        />
                                        Sin destino
                                      </label>
                                      <label className="inline-flex items-center gap-2 text-sm">
                                        <MiniSwitch
                                          checked={destinationMode.countryMode}
                                          onChange={(checked) =>
                                            updateServiceDestinationMode(
                                              service.id,
                                              { countryMode: checked },
                                            )
                                          }
                                          disabled={destinationMode.noDestination}
                                          ariaLabel="Solo país"
                                        />
                                        Solo país
                                      </label>
                                      <label className="inline-flex items-center gap-2 text-sm">
                                        <MiniSwitch
                                          checked={destinationMode.multiMode}
                                          onChange={(checked) =>
                                            updateServiceDestinationMode(
                                              service.id,
                                              { multiMode: checked },
                                            )
                                          }
                                          disabled={destinationMode.noDestination}
                                          ariaLabel="Múltiples destinos"
                                        />
                                        Múltiples destinos
                                      </label>
                                    </div>

                                    {destinationMode.noDestination ? (
                                      <div className="rounded-2xl border border-amber-200/40 bg-amber-100/30 px-3 py-2 text-xs text-amber-900/90 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100">
                                        Este servicio se guardará como{" "}
                                        <b>{NO_DESTINATION_LABEL}</b>.
                                      </div>
                                    ) : (
                                      <ServiceField
                                        id={`service-destination-${service.id}`}
                                        label="Destino"
                                        hint={
                                          destinationMode.multiMode
                                            ? "Podés sumar varios destinos/países."
                                            : destinationMode.countryMode
                                              ? "Elegí el país correspondiente."
                                              : "Elegí un destino habilitado."
                                        }
                                      >
                                        <DestinationPicker
                                          type={
                                            destinationMode.countryMode
                                              ? "country"
                                              : "destination"
                                          }
                                          multiple={destinationMode.multiMode}
                                          value={destinationPickerValue}
                                          onChange={(val) =>
                                            handleDestinationSelect(
                                              service.id,
                                              val,
                                            )
                                          }
                                          inputContainerClassName="!border-sky-300/80 focus-within:!border-sky-400/70 dark:!border-sky-500/40"
                                          placeholder={
                                            destinationMode.countryMode
                                              ? "Ej.: Italia, Perú..."
                                              : "Ej.: París, Salta..."
                                          }
                                          className="relative z-30 [&>label]:hidden"
                                        />
                                        {service.destination ? (
                                          <p className="ml-1 text-xs text-sky-900/70 dark:text-white/70">
                                            Guardará como: <b>{service.destination}</b>
                                          </p>
                                        ) : null}
                                      </ServiceField>
                                    )}

                                    <ServiceField
                                      id={`service-ref-${service.id}`}
                                      label="Referencia"
                                      hint="Localizador o número de reserva del operador."
                                    >
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
                                        className={SERVICE_INPUT}
                                        placeholder="Ej: ABC12345"
                                      />
                                    </ServiceField>
                                  </div>
                                </section>

                                <section className={SERVICE_SECTION}>
                                  <div className="mb-3">
                                    <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
                                      Fechas y operador
                                    </h3>
                                  </div>
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <ServiceField
                                      id={`service-from-${service.id}`}
                                      label="Desde"
                                      required
                                    >
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
                                        className={`${SERVICE_INPUT} cursor-pointer`}
                                        placeholder="aaaa-mm-dd"
                                      />
                                    </ServiceField>

                                    <ServiceField
                                      id={`service-to-${service.id}`}
                                      label="Hasta"
                                      required
                                    >
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
                                        className={`${SERVICE_INPUT} cursor-pointer`}
                                        placeholder="aaaa-mm-dd"
                                      />
                                    </ServiceField>

                                    <ServiceField
                                      id={`service-op-${service.id}`}
                                      label="Operador"
                                      required
                                    >
                                      <OperatorPicker
                                        operators={operators}
                                        valueId={
                                          service.id_operator > 0
                                            ? service.id_operator
                                            : null
                                        }
                                        onSelect={(operator) =>
                                          updateServiceField(
                                            service.id,
                                            "id_operator",
                                            operator.id_operator,
                                          )
                                        }
                                        onClear={() =>
                                          updateServiceField(
                                            service.id,
                                            "id_operator",
                                            0,
                                          )
                                        }
                                        placeholder="Buscar operador por nombre o número..."
                                      />
                                    </ServiceField>

                                    <ServiceField
                                      id={`service-currency-${service.id}`}
                                      label="Moneda"
                                      required
                                    >
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
                                        className={`${SERVICE_INPUT} cursor-pointer`}
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
                                    </ServiceField>
                                  </div>
                                </section>

                                <section className={SERVICE_SECTION}>
                                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
                                        Precios
                                      </h3>
                                      <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
                                        Ingresá los montos en la moneda seleccionada.
                                      </p>
                                    </div>
                                    {canManualOverride && !useBookingSaleTotal ? (
                                      <label className="inline-flex items-center gap-2 text-sm">
                                        <MiniSwitch
                                          checked={serviceManualOverride}
                                          onChange={(checked) =>
                                            setManualOverrideByService((prev) => {
                                              if (!checked) {
                                                if (!(service.id in prev)) {
                                                  return prev;
                                                }
                                                const next = { ...prev };
                                                delete next[service.id];
                                                return next;
                                              }
                                              return {
                                                ...prev,
                                                [service.id]: true,
                                              };
                                            })
                                          }
                                          ariaLabel="Manual"
                                        />
                                        Manual
                                      </label>
                                    ) : null}
                                  </div>
                                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    {useBookingSaleTotal ? (
                                      <div className="col-span-full rounded-xl border border-amber-200/40 bg-amber-100/30 p-3 text-xs text-amber-900/80 dark:border-amber-200/20 dark:bg-amber-100/10 dark:text-amber-100">
                                        La venta se define a nivel reserva. Este servicio sólo requiere costos e impuestos.
                                      </div>
                                    ) : null}

                                    <ServiceField
                                      id={`service-cost-${service.id}`}
                                      label="Costo"
                                      required
                                    >
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
                                        className={SERVICE_INPUT}
                                        placeholder="0.00"
                                      />
                                    </ServiceField>

                                    <ServiceField
                                      id={`service-sale-${service.id}`}
                                      label="Venta"
                                      required={!useBookingSaleTotal}
                                      hint={
                                        useBookingSaleTotal
                                          ? "Se toma de la venta total de la reserva."
                                          : undefined
                                      }
                                    >
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
                                        className={SERVICE_INPUT}
                                        placeholder="0.00"
                                        disabled={useBookingSaleTotal}
                                      />
                                    </ServiceField>

                                    {!serviceManualMode ? (
                                      <>
                                        <ServiceField
                                          id={`service-iva21-${service.id}`}
                                          label="IVA 21%"
                                        >
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
                                            className={SERVICE_INPUT}
                                            placeholder="0.00"
                                          />
                                        </ServiceField>
                                        <ServiceField
                                          id={`service-iva105-${service.id}`}
                                          label="IVA 10,5%"
                                        >
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
                                            className={SERVICE_INPUT}
                                            placeholder="0.00"
                                          />
                                        </ServiceField>
                                        <ServiceField
                                          id={`service-exempt-${service.id}`}
                                          label="Exento"
                                        >
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
                                            className={SERVICE_INPUT}
                                            placeholder="0.00"
                                          />
                                        </ServiceField>
                                      </>
                                    ) : null}

                                    <ServiceField
                                      id={`service-other-${service.id}`}
                                      label={
                                        serviceManualMode
                                          ? "Impuestos"
                                          : "Otros impuestos"
                                      }
                                    >
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
                                        className={SERVICE_INPUT}
                                        placeholder="0.00"
                                      />
                                    </ServiceField>
                                  </div>
                                </section>

                                <section className={SERVICE_SECTION}>
                                  <div className="mb-3">
                                    <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
                                      Tarjeta
                                    </h3>
                                    <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
                                      {serviceManualMode
                                        ? "En modo manual no se usa interés/IVA de tarjeta en el desglose."
                                        : "Si la operación tiene interés por financiación, podés discriminarlo."}
                                    </p>
                                  </div>
                                  {serviceManualMode ? (
                                    <p className="text-xs text-sky-900/70 dark:text-white/70">
                                      Activá modo automático para cargar interés e IVA de tarjeta.
                                    </p>
                                  ) : (
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                      <ServiceField
                                        id={`service-card-${service.id}`}
                                        label="Interés"
                                      >
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
                                          className={SERVICE_INPUT}
                                          placeholder="0.00"
                                        />
                                      </ServiceField>
                                      <ServiceField
                                        id={`service-card-iva-${service.id}`}
                                        label="IVA 21% (Interés)"
                                      >
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
                                          className={SERVICE_INPUT}
                                          placeholder="0.00"
                                        />
                                      </ServiceField>
                                    </div>
                                  )}
                                </section>
                              </div>

                              <div className="mt-4">
                                <ServiceAdjustmentsEditor
                                  items={serviceMiniAdjustments}
                                  onChange={(next) =>
                                    updateServiceAdjustments(service.id, next)
                                  }
                                />
                              </div>

                              {useBookingSaleTotal ? (
                                <div className={SUBCARD}>
                                  <p className="text-xs text-sky-900/70 dark:text-white/70">
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
                                (serviceManualMode ? (
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
                          </motion.div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={addService}
                        className={BTN_SKY}
                      >
                        <IconPlus className="size-4" />
                        Agregar servicio
                      </button>
                    </div>
                  )}
                </div>
              </div>

              </motion.div>
                )}
              </SectionCard>
            </div>

            <div
              ref={(node) => {
                sectionRefs.current.summary = node;
              }}
            >
              <SectionCard
                title="Resumen"
                subtitle="Revisión final y confirmación."
                open={openSections.summary}
                onToggle={() => toggleSection("summary")}
              >
                {openSections.summary && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                <div className="rounded-3xl border border-sky-900/10 bg-white/35 p-4 text-sky-950 shadow-sm shadow-sky-950/5 backdrop-blur dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
                  <SummaryCard
                    totalsByCurrency={totalsByCurrency}
                    services={summaryServices as Service[]}
                    receipts={[]}
                    useBookingSaleTotal={useBookingSaleTotal}
                    bookingSaleTotals={bookingSaleTotals}
                    hideRefreshButton
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-sky-900/10 bg-white/60 p-4 shadow-sm shadow-sky-950/5 dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="text-sm font-semibold">Pasajeros</p>
                    <div className="mt-3 space-y-2 text-sm">
                      {clientsForBooking.map((client) => {
                        const label =
                          client.kind === "existing"
                            ? `${client.snapshot.first_name} ${client.snapshot.last_name}`
                            : `${client.first_name} ${client.last_name}`.trim();
                        return (
                          <div key={`summary-${client.id}`} className="truncate">
                            {label || "Pax sin nombre"}
                            {client.id === titularId ? " · Titular" : ""}
                          </div>
                        );
                      })}
                      {activeSimpleCompanions.length > 0 && (
                        <div className="mt-3 text-xs text-sky-900/70 dark:text-white/70">
                          Acompañantes: {activeSimpleCompanions.length}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-sky-900/10 bg-white/60 p-4 shadow-sm shadow-sky-950/5 dark:border-white/10 dark:bg-white/[0.03]">
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

                  <div className="rounded-2xl border border-sky-900/10 bg-white/60 p-4 shadow-sm shadow-sky-950/5 dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="text-sm font-semibold">Servicios</p>
                    <div className="mt-3 space-y-2 text-sm">
                      {services.length === 0 && (
                        <p className="text-sky-900/60 dark:text-white/60">
                          Sin servicios cargados.
                        </p>
                      )}
                      {services.map((service) => (
                        <div key={`summary-service-${service.id}`} className="flex-1">
                          <p className="font-medium">{service.type || "Servicio"}</p>
                          <p className="text-xs text-sky-900/60 dark:text-white/60">
                            {operatorMap.get(service.id_operator)?.name ||
                              "Operador pendiente"}
                          </p>
                          <p className="text-xs text-sky-900/60 dark:text-white/60">
                            {fmtMoney(Number(service.sale_price), service.currency)} ·{" "}
                            {formatDate(service.departure_date)} →{" "}
                            {formatDate(service.return_date)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    className={BTN_EMERALD}
                    onClick={handleConfirm}
                    disabled={saving}
                  >
                    {saving ? <ButtonSpinner /> : <IconCheck className="size-4" />}
                    Confirmar y abrir reserva
                  </button>
                </div>
              </motion.div>
                )}
              </SectionCard>
            </div>
          </div>
        )}
      </section>

      <ToastContainer position="bottom-right" />
    </ProtectedRoute>
  );
}
