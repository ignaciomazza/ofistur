"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import ClientPicker from "@/components/clients/ClientPicker";
import DestinationPicker, {
  type DestinationOption,
} from "@/components/DestinationPicker";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import {
  loadFinancePicks,
  type FinanceCurrency,
} from "@/utils/loadFinancePicks";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import type { ClientProfileConfig } from "@/types";
import {
  DOC_REQUIRED_FIELDS,
  DOCUMENT_ANY_KEY,
  DEFAULT_CLIENT_PROFILE_KEY,
  normalizeClientProfiles,
  resolveClientProfile,
} from "@/utils/clientConfig";
import { formatMoneyInput, shouldPreferDotDecimal } from "@/utils/moneyInput";
import {
  normalizeQuoteCustomFields,
  normalizeQuoteHiddenFields,
  normalizeQuoteRequiredFields,
  type QuoteCustomField,
} from "@/utils/quoteConfig";
import {
  normalizeQuoteBookingDraft,
  normalizeQuoteCustomValues,
  normalizeQuotePaxDrafts,
  normalizeQuoteServiceDrafts,
  type QuoteBookingDraft,
  type QuotePaxDraft,
  type QuoteServiceDraft,
} from "@/utils/quoteDrafts";
import { parseAmountInput } from "@/utils/receipts/receiptForm";

type QuoteUser = {
  id_user: number;
  first_name: string | null;
  last_name: string | null;
  role?: string | null;
};

type QuoteItem = {
  id_quote: number;
  user_quote_id?: number | null;
  agency_quote_id?: number | null;
  public_id?: string | null;
  id_user: number;
  quote_status?: "active" | "converted" | null;
  converted_at?: string | null;
  converted_booking_id?: number | null;
  pdf_draft?: unknown;
  pdf_draft_saved_at?: string | null;
  pdf_last_file_name?: string | null;
  lead_name?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  note?: string | null;
  booking_draft?: unknown;
  pax_drafts?: unknown;
  service_drafts?: unknown;
  custom_values?: unknown;
  creation_date: string;
  updated_at: string;
  user?: QuoteUser;
};

type QuoteConfigDTO = {
  required_fields?: unknown;
  hidden_fields?: unknown;
  custom_fields?: unknown;
};

type AppUserOption = {
  id_user: number;
  first_name: string | null;
  last_name: string | null;
  role?: string | null;
  email?: string | null;
};

type QuoteFormState = {
  id_quote: number | null;
  id_user: number | null;
  creation_date: string;
  lead_name: string;
  lead_phone: string;
  lead_email: string;
  note: string;
  booking_draft: QuoteBookingDraft;
  pax_drafts: QuotePaxDraft[];
  service_drafts: QuoteServiceDraft[];
  custom_values: Record<string, unknown>;
};

type ConvertPassengerForm = {
  mode: "existing" | "new";
  client_id: number | null;
  profile_key: string;
  first_name: string;
  last_name: string;
  phone: string;
  birth_date: string;
  nationality: string;
  gender: string;
  email: string;
  dni_number: string;
  passport_number: string;
  tax_id: string;
  company_name: string;
  commercial_address: string;
  address: string;
  locality: string;
  postal_code: string;
};

type ConvertServiceForm = {
  type: string;
  description: string;
  note: string;
  sale_price: string;
  cost_price: string;
  currency: string;
  destination: string;
  reference: string;
  operator_id: number | null;
  departure_date: string;
  return_date: string;
};

type ConvertFormState = {
  booking: {
    id_user: number | null;
    clientStatus: string;
    operatorStatus: string;
    status: string;
    details: string;
    invoice_type: string;
    invoice_observation: string;
    observation: string;
    departure_date: string;
    return_date: string;
  };
  titular: ConvertPassengerForm;
  companions: ConvertPassengerForm[];
  services: ConvertServiceForm[];
};

type Profile = {
  id_user: number;
  role: string;
};

type FormMode = "create" | "edit";
type QuoteWorkspaceView = "form" | "list";
type QuoteListView = "card" | "grid" | "table";
type QuoteStatusScope = "active" | "converted" | "all";
type QuoteListScope = "mine" | "team" | "agency";
type PresenceFilter = "all" | "with" | "without";
type MoneyFieldName = "sale_price" | "cost_price";
type ServiceTypeOption = {
  id?: number | null;
  value: string;
  label: string;
};
type OperatorOption = {
  id_operator: number;
  agency_operator_id?: number | null;
  name: string | null;
};

const BASE_PASSENGER_REQUIRED_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "birth_date",
  "nationality",
  "gender",
] as const;
const BOOKING_REQUIRED_FIELDS = [
  "clientStatus",
  "operatorStatus",
  "status",
  "details",
  "invoice_type",
  "departure_date",
  "return_date",
] as const;
const PASSENGER_FIELD_LABELS: Record<string, string> = {
  first_name: "Nombre",
  last_name: "Apellido",
  phone: "Teléfono",
  birth_date: "Fecha de nacimiento",
  nationality: "Nacionalidad",
  gender: "Género",
  email: "Email",
  dni_number: "DNI",
  passport_number: "Pasaporte",
  tax_id: "CUIT / RUT",
  company_name: "Razón social",
  commercial_address: "Domicilio comercial",
  address: "Dirección",
  locality: "Localidad",
  postal_code: "Código postal",
};
const BOOKING_FIELD_LABELS: Record<string, string> = {
  clientStatus: "Estado cliente",
  operatorStatus: "Estado operador",
  status: "Estado reserva",
  details: "Detalle",
  invoice_type: "Tipo de factura",
  departure_date: "Salida",
  return_date: "Regreso",
};
const SERVICE_FIELD_LABELS: Record<string, string> = {
  type: "Tipo de servicio",
  sale_price: "Precio de venta",
  cost_price: "Costo",
  currency: "Moneda",
  operator_id: "Operador",
};

const SECTION_GLASS =
  "rounded-2xl border border-sky-300/35 bg-white/45 shadow-sm shadow-sky-950/10 backdrop-blur-xl dark:border-sky-200/20 dark:bg-sky-950/25";
const BTN =
  "rounded-full border border-sky-500/45 bg-sky-400/20 px-4 py-2 text-sm font-medium text-sky-950 shadow-sm shadow-sky-950/20 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:opacity-95 hover:bg-sky-400/30 active:scale-[0.97] active:opacity-90 disabled:opacity-50 dark:border-sky-300/45 dark:bg-sky-400/20 dark:text-sky-100";
const AMBER_BTN =
  "rounded-full border border-sky-500/45 bg-sky-400/20 px-4 py-2 text-sm font-medium text-sky-950 shadow-sm shadow-sky-950/20 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:opacity-95 hover:bg-sky-400/30 active:scale-[0.97] active:opacity-90 disabled:opacity-50 dark:border-sky-300/45 dark:bg-sky-400/20 dark:text-sky-100";
const SUBTLE_BTN =
  "rounded-full border border-sky-500/35 bg-white/55 px-4 py-2 text-sm text-sky-900 shadow-sm shadow-sky-950/10 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:opacity-95 hover:bg-sky-100/65 active:scale-[0.97] active:opacity-90 disabled:opacity-50 dark:border-sky-300/35 dark:bg-sky-950/30 dark:text-sky-100";
const DANGER_BTN =
  "rounded-full border border-rose-500/55 bg-rose-200/20 px-4 py-2 text-sm font-medium text-rose-700 shadow-sm shadow-rose-950/20 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:opacity-95 hover:bg-rose-200/30 active:scale-[0.97] active:opacity-90 disabled:opacity-50 dark:border-rose-300/55 dark:bg-rose-300/20 dark:text-rose-200";
const DANGER_ICON_BTN =
  "inline-flex size-9 items-center justify-center rounded-full border border-rose-500/55 bg-rose-200/20 text-rose-700 shadow-sm shadow-rose-950/20 transition-[opacity,transform,background-color] duration-200 hover:scale-[0.99] hover:opacity-95 hover:bg-rose-200/30 active:scale-[0.97] active:opacity-90 disabled:opacity-50 dark:border-rose-300/55 dark:bg-rose-300/20 dark:text-rose-200";
const INPUT =
  "w-full rounded-2xl border border-sky-300/45 bg-white/75 px-3 py-2 text-sm text-slate-900 outline-none shadow-sm shadow-sky-950/10 backdrop-blur placeholder:text-slate-500/80 focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 dark:border-sky-200/35 dark:bg-sky-950/20 dark:text-sky-50 dark:placeholder:text-sky-100/60";
const SELECT =
  "w-full cursor-pointer appearance-none rounded-2xl border border-sky-300/45 bg-white/75 px-3 py-2 text-sm text-slate-900 outline-none shadow-sm shadow-sky-950/10 backdrop-blur focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 disabled:cursor-not-allowed dark:border-sky-200/35 dark:bg-sky-950/20 dark:text-sky-50";
const CHIP =
  "inline-flex items-center rounded-full border border-sky-400/40 bg-sky-300/20 px-2.5 py-1 text-[11px] font-semibold text-sky-900 dark:border-sky-300/40 dark:bg-sky-300/20 dark:text-sky-100";
const ACTION_TRACK =
  "inline-flex items-center overflow-hidden [&>*:last-child]:shrink-0";
const ACTION_TEXT_HOVER =
  "block max-w-0 overflow-hidden whitespace-nowrap text-left text-sm opacity-0 transition-[max-width,opacity,margin] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] mr-0 group-hover/btn:max-w-[11rem] group-hover/btn:mr-2 group-hover/btn:opacity-100 group-focus-visible/btn:max-w-[11rem] group-focus-visible/btn:mr-2 group-focus-visible/btn:opacity-100";
const ACTION_TEXT_BUTTON =
  "block overflow-hidden whitespace-nowrap text-left text-sm";
const ACTION_BTN_BASE =
  "group/btn inline-flex shrink-0 items-center rounded-full px-3 py-2 shadow-sm backdrop-blur-sm transition-[transform,background-color,border-color,box-shadow,opacity] duration-[560ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[0.992] hover:opacity-95 active:scale-[0.98] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
const MINI_TOGGLE_GROUP =
  "flex items-center gap-1 rounded-full border border-sky-300/35 bg-white/60 p-1 text-xs dark:border-sky-200/20 dark:bg-sky-950/20";
const ACTION_TONE_CLASS: Record<"sky" | "amber" | "rose" | "neutral", string> =
  {
    sky: `${ACTION_BTN_BASE} border border-sky-500/35 bg-sky-500/5 text-sky-900 shadow-sky-950/15 hover:bg-sky-500/10 dark:text-sky-100`,
    amber: `${ACTION_BTN_BASE} border border-amber-500/40 bg-amber-500/5 text-amber-900 shadow-amber-950/15 hover:bg-amber-500/15 dark:text-amber-100`,
    rose: `${ACTION_BTN_BASE} border border-rose-500/40 bg-rose-500/5 text-rose-900 shadow-rose-950/15 hover:bg-rose-500/15 dark:text-rose-100`,
    neutral: `${ACTION_BTN_BASE} border border-slate-500/35 bg-slate-500/5 text-slate-800 shadow-slate-950/10 hover:bg-slate-500/10 dark:border-slate-300/25 dark:text-slate-100`,
  };

const defaultPassenger = (): ConvertPassengerForm => ({
  mode: "new",
  client_id: null,
  profile_key: DEFAULT_CLIENT_PROFILE_KEY,
  first_name: "",
  last_name: "",
  phone: "",
  birth_date: "",
  nationality: "",
  gender: "",
  email: "",
  dni_number: "",
  passport_number: "",
  tax_id: "",
  company_name: "",
  commercial_address: "",
  address: "",
  locality: "",
  postal_code: "",
});

const defaultService = (): QuoteServiceDraft => ({
  type: "",
  description: "",
  note: "",
  sale_price: null,
  cost_price: null,
  currency: "ARS",
  destination: "",
  reference: "",
  operator_id: null,
  departure_date: "",
  return_date: "",
});

const defaultConvertService = (): ConvertServiceForm => ({
  type: "",
  description: "",
  note: "",
  sale_price: "",
  cost_price: "",
  currency: "ARS",
  destination: "",
  reference: "",
  operator_id: null,
  departure_date: "",
  return_date: "",
});

const defaultForm = (): QuoteFormState => ({
  id_quote: null,
  id_user: null,
  creation_date: "",
  lead_name: "",
  lead_phone: "",
  lead_email: "",
  note: "",
  booking_draft: {
    details: "",
    departure_date: "",
    return_date: "",
    pax_count: null,
    currency: "ARS",
    clientStatus: "",
    operatorStatus: "",
    status: "",
    invoice_type: "",
    invoice_observation: "",
    observation: "",
  },
  pax_drafts: [],
  service_drafts: [],
  custom_values: {},
});

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

function toNumber(v: unknown): number | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const parsed = parseAmountInput(raw);
  if (parsed != null && Number.isFinite(parsed)) return parsed;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

function pickArrayFromJson(
  payload: unknown,
  keys: string[] = ["data", "items", "types", "results"],
): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function toBoolish(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
  }
  return undefined;
}

function normalizeServiceTypes(payload: unknown): ServiceTypeOption[] {
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
      const value = cleanString(name || code);
      if (!value || enabled === false) return null;
      return { id: rawId, value, label: value } as ServiceTypeOption;
    })
    .filter((item): item is ServiceTypeOption => item !== null);

  return normalized.sort((a, b) => a.label.localeCompare(b.label, "es"));
}

function destinationValueToLabel(
  value: DestinationOption | DestinationOption[] | null,
): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    const labels = value.map((opt) => opt.displayLabel).filter(Boolean);
    return labels.join(", ");
  }
  return value.displayLabel || "";
}

function normalizeQuoteItem(input: unknown): QuoteItem | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  const id_quote = Number(rec.id_quote);
  const id_user = Number(rec.id_user);
  const creation_date = String(rec.creation_date ?? "");
  const updated_at = String(rec.updated_at ?? "");
  if (!Number.isFinite(id_quote) || !Number.isFinite(id_user)) return null;
  if (!creation_date || !updated_at) return null;
  return {
    id_quote,
    id_user,
    user_quote_id: rec.user_quote_id == null ? null : Number(rec.user_quote_id),
    agency_quote_id:
      rec.agency_quote_id == null ? null : Number(rec.agency_quote_id),
    quote_status:
      rec.quote_status === "converted"
        ? "converted"
        : rec.quote_status === "active"
          ? "active"
          : null,
    converted_at:
      typeof rec.converted_at === "string" ? rec.converted_at : null,
    converted_booking_id:
      rec.converted_booking_id == null
        ? null
        : Number(rec.converted_booking_id),
    pdf_draft: rec.pdf_draft,
    pdf_draft_saved_at:
      typeof rec.pdf_draft_saved_at === "string"
        ? rec.pdf_draft_saved_at
        : null,
    pdf_last_file_name:
      typeof rec.pdf_last_file_name === "string"
        ? rec.pdf_last_file_name
        : null,
    public_id: typeof rec.public_id === "string" ? rec.public_id : null,
    lead_name: typeof rec.lead_name === "string" ? rec.lead_name : null,
    lead_phone: typeof rec.lead_phone === "string" ? rec.lead_phone : null,
    lead_email: typeof rec.lead_email === "string" ? rec.lead_email : null,
    note: typeof rec.note === "string" ? rec.note : null,
    booking_draft: rec.booking_draft,
    pax_drafts: rec.pax_drafts,
    service_drafts: rec.service_drafts,
    custom_values: rec.custom_values,
    creation_date,
    updated_at,
    user:
      rec.user && typeof rec.user === "object"
        ? {
            id_user: Number((rec.user as Record<string, unknown>).id_user),
            first_name:
              typeof (rec.user as Record<string, unknown>).first_name ===
              "string"
                ? ((rec.user as Record<string, unknown>).first_name as string)
                : null,
            last_name:
              typeof (rec.user as Record<string, unknown>).last_name ===
              "string"
                ? ((rec.user as Record<string, unknown>).last_name as string)
                : null,
            role:
              typeof (rec.user as Record<string, unknown>).role === "string"
                ? ((rec.user as Record<string, unknown>).role as string)
                : null,
          }
        : undefined,
  };
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-AR");
}

function isManagerRole(role?: string | null): boolean {
  const normalized = cleanString(role).toLowerCase();
  return ["gerente", "administrativo", "desarrollador"].includes(normalized);
}

function isLeaderRole(role?: string | null): boolean {
  return cleanString(role).toLowerCase() === "lider";
}

function canOverrideQuoteMetaByRole(role?: string | null): boolean {
  const normalized = cleanString(role).toLowerCase();
  return [
    "gerente",
    "administrativo",
    "admin",
    "administrador",
    "desarrollador",
    "developer",
    "dev",
  ].includes(normalized);
}

function toDateInputValue(value: string | null | undefined): string {
  const raw = cleanString(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
    parsed.getDate(),
  ).padStart(2, "0")}`;
}

function todayDateInputValue(): string {
  return toDateInputValue(new Date().toISOString());
}

function resolveLeadFromPaxDrafts(paxDrafts: QuotePaxDraft[]): {
  leadName: string;
  leadPhone: string;
  leadEmail: string;
} {
  const primary = paxDrafts.find((pax) => pax.is_titular) ?? paxDrafts[0];
  if (!primary) {
    return { leadName: "", leadPhone: "", leadEmail: "" };
  }
  const firstName = cleanString(primary.first_name);
  const lastName = cleanString(primary.last_name);
  const leadName = `${firstName} ${lastName}`.trim();
  const leadPhone = cleanString(primary.phone);
  const leadEmail = cleanString(primary.email);
  return { leadName, leadPhone, leadEmail };
}

function isCustomValueMissing(
  field: QuoteCustomField,
  value: unknown,
): boolean {
  if (!field.required) return false;
  if (field.type === "boolean") return typeof value !== "boolean";
  if (field.type === "number") {
    const n = toNumber(value);
    return n == null;
  }
  if (field.type === "select") return cleanString(value) === "";
  return cleanString(value) === "";
}

function toPassengerFromDraft(draft: QuotePaxDraft): ConvertPassengerForm {
  const mode =
    draft.mode === "existing" && draft.client_id ? "existing" : "new";
  return {
    mode,
    client_id:
      mode === "existing" ? Number(draft.client_id || 0) || null : null,
    profile_key: DEFAULT_CLIENT_PROFILE_KEY,
    first_name: draft.first_name || "",
    last_name: draft.last_name || "",
    phone: draft.phone || "",
    birth_date: draft.birth_date || "",
    nationality: draft.nationality || "",
    gender: draft.gender || "",
    email: draft.email || "",
    dni_number: "",
    passport_number: "",
    tax_id: "",
    company_name: "",
    commercial_address: "",
    address: "",
    locality: "",
    postal_code: "",
  };
}

function toConvertServiceFromDraft(
  draft: QuoteServiceDraft,
): ConvertServiceForm {
  return {
    type: draft.type || "",
    description: draft.description || "",
    note: draft.note || "",
    sale_price:
      typeof draft.sale_price === "number" && Number.isFinite(draft.sale_price)
        ? String(draft.sale_price)
        : "",
    cost_price:
      typeof draft.cost_price === "number" && Number.isFinite(draft.cost_price)
        ? String(draft.cost_price)
        : "",
    currency: draft.currency || "ARS",
    destination: draft.destination || "",
    reference: draft.reference || "",
    operator_id:
      typeof draft.operator_id === "number" &&
      Number.isFinite(draft.operator_id)
        ? Math.trunc(draft.operator_id)
        : null,
    departure_date: draft.departure_date || "",
    return_date: draft.return_date || "",
  };
}

function formatUserName(
  user?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    id_user?: number;
  } | null,
): string {
  if (!user) return "Sin responsable";
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  if (fullName) return fullName;
  if (user.email) return user.email;
  if (typeof user.id_user === "number") return `Usuario ${user.id_user}`;
  return "Sin responsable";
}

function getQuoteUserNumber(quote: QuoteItem): number {
  return quote.user_quote_id ?? quote.agency_quote_id ?? quote.id_quote;
}

function getQuoteAgencyNumber(quote: QuoteItem): number {
  return quote.agency_quote_id ?? quote.id_quote;
}

function startOfDayMs(dateValue: string): number | null {
  if (!dateValue) return null;
  const d = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

function endOfDayMs(dateValue: string): number | null {
  if (!dateValue) return null;
  const d = new Date(`${dateValue}T23:59:59.999`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

function matchesPresenceFilter(filter: PresenceFilter, count: number): boolean {
  if (filter === "with") return count > 0;
  if (filter === "without") return count === 0;
  return true;
}

function toDateMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function moneyInputKey(
  scope: "draft" | "convert",
  index: number,
  field: MoneyFieldName,
): string {
  return `${scope}-${index}-${field}`;
}

function formatStoredMoneyInput(
  value: number | string | null | undefined,
  currency: string,
): string {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? (parseMoneyInputSafe(value) ?? 0)
        : 0;
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return formatMoneyInputSafe(String(numeric), currency, true);
}

function normalizeAmbiguousDotMoneyInput(
  raw: string,
  preferDotDecimal: boolean,
): string {
  if (preferDotDecimal) return raw;
  const cleaned = String(raw || "").replace(/[^\d.,]/g, "");
  if (!cleaned || cleaned.includes(",")) return raw;

  // When deleting over formatted values (e.g. "12.345" -> "12.34"),
  // keep dot as thousands separator and avoid converting it to decimals.
  const dotAsThousands = cleaned.match(/^(\d+)\.(\d{1,2})$/);
  if (!dotAsThousands) return raw;
  return `${dotAsThousands[1]}${dotAsThousands[2]}`;
}

function formatMoneyInputSafe(
  raw: string,
  currency: string,
  preferDotDecimal = false,
): string {
  try {
    const normalized = normalizeAmbiguousDotMoneyInput(raw, preferDotDecimal);
    return formatMoneyInput(normalized, currency, { preferDotDecimal });
  } catch {
    return "";
  }
}

function parseMoneyInputSafe(raw: string): number | null {
  try {
    const parsed = parseAmountInput(raw);
    return parsed != null && Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function miniToggleOptionClass(active: boolean): string {
  return `rounded-full px-3 py-1 transition ${
    active
      ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200"
      : "text-sky-900/75 dark:text-sky-100"
  }`;
}

function labelFromMap(
  map: Record<string, string>,
  key: string,
  fallback = key,
): string {
  return map[key] || fallback;
}

function RequiredMark() {
  return <span className="ml-1 text-rose-600 dark:text-rose-300">*</span>;
}

type ActionIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: "sky" | "amber" | "rose" | "neutral";
};

function ActionIconButton({
  label,
  tone = "sky",
  className = "",
  children,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: ActionIconButtonProps) {
  const [expanded, setExpanded] = useState(false);
  const [labelWidth, setLabelWidth] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelMeasureRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const el = labelMeasureRef.current;
    if (!el) return;
    setLabelWidth(Math.ceil(el.scrollWidth));
  }, [label]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openAnimated = useCallback(() => {
    clearCloseTimer();
    setExpanded(true);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setExpanded(false);
      closeTimerRef.current = null;
    }, 320);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  return (
    <button
      {...props}
      onMouseEnter={(event) => {
        openAnimated();
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        scheduleClose();
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        openAnimated();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        scheduleClose();
        onBlur?.(event);
      }}
      className={`${ACTION_TONE_CLASS[tone]} ${className}`}
    >
      <span className={ACTION_TRACK}>
        <motion.span
          className={ACTION_TEXT_BUTTON}
          initial={false}
          animate={{
            width: expanded ? labelWidth : 0,
            opacity: expanded ? 1 : 0,
            marginRight: expanded ? 8 : 0,
            x: expanded ? 0 : -4,
          }}
          transition={{
            width: {
              type: "spring",
              stiffness: 170,
              damping: 24,
              mass: 0.9,
            },
            marginRight: {
              type: "spring",
              stiffness: 170,
              damping: 24,
              mass: 0.9,
            },
            x: { duration: 0.22, ease: [0.25, 1, 0.5, 1] },
            opacity: {
              duration: expanded ? 0.22 : 0.14,
              ease: [0.25, 1, 0.5, 1],
              delay: expanded ? 0.03 : 0,
            },
          }}
          style={{ willChange: "width, margin-right, opacity, transform" }}
        >
          <span
            ref={labelMeasureRef}
            className="inline-block whitespace-nowrap"
          >
            {label}
          </span>
        </motion.span>
        {children}
      </span>
    </button>
  );
}

function TrashIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
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
}

function SectionCard({
  id,
  title,
  subtitle,
  open,
  onToggle,
  right,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: (id: string) => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`${SECTION_GLASS} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          className="flex-1 text-left transition hover:opacity-90"
          onClick={() => onToggle(id)}
        >
          <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-100">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-sky-900/75 dark:text-sky-100/70">
              {subtitle}
            </p>
          )}
        </button>
        <div className="flex items-center gap-2">
          {right}
          <button
            type="button"
            className={CHIP}
            onClick={() => onToggle(id)}
            aria-label={open ? `Ocultar ${title}` : `Expandir ${title}`}
          >
            {open ? "Ocultar" : "Expandir"}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key={`${id}-content`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: {
                type: "spring",
                stiffness: 230,
                damping: 28,
                mass: 0.86,
              },
              opacity: {
                duration: 0.2,
                ease: [0.22, 1, 0.36, 1],
              },
            }}
            className="overflow-hidden"
          >
            <motion.div
              initial={{ y: -4 }}
              animate={{ y: 0 }}
              exit={{ y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="border-t border-sky-300/30 p-4 dark:border-sky-200/15"
            >
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default function QuotesPage() {
  const router = useRouter();
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);

  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [workspaceView, setWorkspaceView] =
    useState<QuoteWorkspaceView>("list");
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [form, setForm] = useState<QuoteFormState>(defaultForm());
  const [listView, setListView] = useState<QuoteListView>("grid");
  const [expandedQuoteId, setExpandedQuoteId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listScope, setListScope] = useState<QuoteListScope>("mine");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [statusScope, setStatusScope] = useState<QuoteStatusScope>("active");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [paxFilter, setPaxFilter] = useState<PresenceFilter>("all");
  const [serviceFilter, setServiceFilter] = useState<PresenceFilter>("all");
  const [sortBy, setSortBy] = useState<
    | "updated_desc"
    | "updated_asc"
    | "created_desc"
    | "created_asc"
    | "quote_desc"
    | "quote_asc"
  >("updated_desc");
  const [formSections, setFormSections] = useState<Record<string, boolean>>({
    booking: true,
    custom: true,
    pax: true,
    services: true,
  });
  const [convertSections, setConvertSections] = useState<
    Record<string, boolean>
  >({
    booking: true,
    titular: true,
    companions: true,
    services: true,
  });
  const [showMetaOverrides, setShowMetaOverrides] = useState(false);

  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [hiddenFields, setHiddenFields] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<QuoteCustomField[]>([]);
  const [clientProfiles, setClientProfiles] = useState<ClientProfileConfig[]>([
    {
      key: DEFAULT_CLIENT_PROFILE_KEY,
      label: "Pax",
      required_fields: [],
      hidden_fields: [],
      custom_fields: [],
    },
  ]);

  const [users, setUsers] = useState<AppUserOption[]>([]);
  const [financeCurrencies, setFinanceCurrencies] = useState<FinanceCurrency[]>(
    [],
  );
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [loadingServiceTypes, setLoadingServiceTypes] = useState(false);
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [loadingOperators, setLoadingOperators] = useState(false);

  const [convertQuote, setConvertQuote] = useState<QuoteItem | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertFormState | null>(null);
  const [showConvertValidation, setShowConvertValidation] = useState(false);
  const [moneyInputs, setMoneyInputs] = useState<Record<string, string>>({});
  const cardActionRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const cardShellRefs = useRef<Map<number, HTMLElement>>(new Map());

  const canConfigure = useMemo(() => isManagerRole(profile?.role), [profile]);
  const canOverrideQuoteMeta = useMemo(
    () => canOverrideQuoteMetaByRole(profile?.role),
    [profile],
  );
  const canSeeTeamQuotes = useMemo(
    () => isLeaderRole(profile?.role),
    [profile],
  );
  const canSeeAgencyQuotes = useMemo(
    () => isManagerRole(profile?.role),
    [profile],
  );
  const showsAgencyCounter = listScope === "team" || listScope === "agency";
  const canAssignOwner = useMemo(
    () => isManagerRole(profile?.role) || isLeaderRole(profile?.role),
    [profile],
  );
  const currencyOptions = useMemo(() => {
    const configured = financeCurrencies
      .filter((currency) => currency.enabled)
      .map((currency) => currency.code.toUpperCase())
      .filter(Boolean);
    const unique = Array.from(new Set(configured)).sort((a, b) =>
      a.localeCompare(b, "es"),
    );
    return unique.length > 0 ? unique : ["ARS", "USD"];
  }, [financeCurrencies]);
  const convertProfileOptions = useMemo(
    () =>
      clientProfiles.map((profile) => ({
        key: profile.key,
        label: profile.label,
      })),
    [clientProfiles],
  );
  const clearMoneyInputsByScope = useCallback((scope: "draft" | "convert") => {
    setMoneyInputs((prev) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(`${scope}-`)) {
          next[key] = value;
        }
      }
      return next;
    });
  }, []);
  const clearMoneyInputsByIndex = useCallback(
    (scope: "draft" | "convert", index: number) => {
      setMoneyInputs((prev) => {
        const next = { ...prev };
        delete next[moneyInputKey(scope, index, "sale_price")];
        delete next[moneyInputKey(scope, index, "cost_price")];
        return next;
      });
    },
    [],
  );

  const toggleFormSection = useCallback((section: string) => {
    setFormSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);
  const toggleConvertSection = useCallback((section: string) => {
    setConvertSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const quoteRows = useMemo(
    () =>
      quotes.map((q) => {
        const bookingDraft = normalizeQuoteBookingDraft(q.booking_draft);
        const paxCount = normalizeQuotePaxDrafts(q.pax_drafts).length;
        const serviceCount = normalizeQuoteServiceDrafts(
          q.service_drafts,
        ).length;
        const userDisplayId = getQuoteUserNumber(q);
        const agencyDisplayId = getQuoteAgencyNumber(q);
        const dbDisplayId = q.id_quote;
        const displayId = showsAgencyCounter ? agencyDisplayId : userDisplayId;
        const ownerName = formatUserName(
          q.user
            ? {
                id_user: q.user.id_user,
                first_name: q.user.first_name,
                last_name: q.user.last_name,
              }
            : undefined,
        );
        const createdAtMs = toDateMs(q.creation_date);
        const updatedAtMs = toDateMs(q.updated_at);
        const localSearchBlob = [
          displayId,
          userDisplayId,
          agencyDisplayId,
          dbDisplayId,
          q.public_id || "",
          q.lead_name || "",
          q.lead_phone || "",
          q.lead_email || "",
          bookingDraft.details || "",
          ownerName,
        ]
          .join(" ")
          .toLowerCase();
        return {
          quote: q,
          bookingDraft,
          paxCount,
          serviceCount,
          displayId,
          userDisplayId,
          agencyDisplayId,
          dbDisplayId,
          ownerName,
          createdAtMs,
          updatedAtMs,
          localSearchBlob,
        };
      }),
    [quotes, showsAgencyCounter],
  );

  const ownerOptions = useMemo(
    () =>
      Array.from(
        new Map(
          quoteRows.map((row) => [row.quote.id_user, row.ownerName] as const),
        ).entries(),
      )
        .map(([id_user, label]) => ({ id_user, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [quoteRows],
  );

  const filteredQuotes = useMemo(() => {
    const fromMs = startOfDayMs(createdFrom);
    const toMs = endOfDayMs(createdTo);
    const ownerId = ownerFilter === "all" ? null : Number(ownerFilter);
    const hasOwnerFilter = ownerId != null && Number.isFinite(ownerId);
    const normalizedSearch = search.trim().toLowerCase();

    const base = quoteRows.filter((row) => {
      if (hasOwnerFilter && row.quote.id_user !== ownerId) return false;
      if (!matchesPresenceFilter(paxFilter, row.paxCount)) return false;
      if (!matchesPresenceFilter(serviceFilter, row.serviceCount)) return false;
      if (fromMs != null && row.createdAtMs < fromMs) return false;
      if (toMs != null && row.createdAtMs > toMs) return false;
      if (normalizedSearch && !row.localSearchBlob.includes(normalizedSearch))
        return false;
      return true;
    });

    const sorted = [...base].sort((a, b) => {
      if (sortBy === "updated_desc") return b.updatedAtMs - a.updatedAtMs;
      if (sortBy === "updated_asc") return a.updatedAtMs - b.updatedAtMs;
      if (sortBy === "created_desc") return b.createdAtMs - a.createdAtMs;
      if (sortBy === "created_asc") return a.createdAtMs - b.createdAtMs;
      if (sortBy === "quote_desc") return b.displayId - a.displayId;
      return a.displayId - b.displayId;
    });

    return sorted;
  }, [
    createdFrom,
    createdTo,
    ownerFilter,
    paxFilter,
    quoteRows,
    search,
    serviceFilter,
    sortBy,
  ]);

  const visibleQuotesCount = filteredQuotes.length;

  const hasActiveFilters = useMemo(
    () =>
      statusScope !== "active" ||
      ownerFilter !== "all" ||
      createdFrom !== "" ||
      createdTo !== "" ||
      paxFilter !== "all" ||
      serviceFilter !== "all",
    [
      createdFrom,
      createdTo,
      ownerFilter,
      paxFilter,
      serviceFilter,
      statusScope,
    ],
  );

  const clearFilters = useCallback(() => {
    setStatusScope("active");
    setOwnerFilter("all");
    setCreatedFrom("");
    setCreatedTo("");
    setPaxFilter("all");
    setServiceFilter("all");
    setSortBy("updated_desc");
  }, []);

  const toggleExpandedQuote = useCallback((quoteId: number) => {
    setExpandedQuoteId((prev) => (prev === quoteId ? null : quoteId));
  }, []);

  const loadQuotes = useCallback(async () => {
    if (!token) return;
    if (listScope === "team" && !canSeeTeamQuotes) return;
    if (listScope === "agency" && !canSeeAgencyQuotes) return;
    try {
      setLoading(true);
      const qs = new URLSearchParams({ take: "50" });
      qs.set("status_scope", statusScope);
      if (listScope === "mine" && profile?.id_user) {
        qs.set("userId", String(profile.id_user));
      }
      if (search.trim()) qs.set("q", search.trim());
      const res = await authFetch(
        `/api/quotes?${qs.toString()}`,
        { cache: "no-store" },
        token,
      );
      const payload = (await res.json().catch(() => null)) as {
        items?: unknown[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(payload?.error || "No se pudo cargar cotizaciones");
      }
      const items = Array.isArray(payload?.items)
        ? payload.items
            .map(normalizeQuoteItem)
            .filter((x): x is QuoteItem => x !== null)
        : [];
      setQuotes(items);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error cargando cotizaciones",
      );
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  }, [
    canSeeAgencyQuotes,
    canSeeTeamQuotes,
    listScope,
    profile?.id_user,
    search,
    statusScope,
    token,
  ]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const [profileRes, cfgRes, userRes, clientCfgRes] = await Promise.all([
          authFetch("/api/user/profile", { cache: "no-store" }, token),
          authFetch("/api/quotes/config", { cache: "no-store" }, token),
          authFetch("/api/users", { cache: "no-store" }, token),
          authFetch("/api/clients/config", { cache: "no-store" }, token),
        ]);

        if (profileRes.ok) {
          const p = (await profileRes.json()) as Profile;
          if (alive) setProfile(p);
        }

        if (cfgRes.ok) {
          const cfg = (await cfgRes.json()) as QuoteConfigDTO | null;
          if (alive) {
            setRequiredFields(
              normalizeQuoteRequiredFields(cfg?.required_fields),
            );
            setHiddenFields(normalizeQuoteHiddenFields(cfg?.hidden_fields));
            setCustomFields(normalizeQuoteCustomFields(cfg?.custom_fields));
          }
        }

        if (clientCfgRes.ok) {
          const cfg = (await clientCfgRes.json().catch(() => null)) as {
            profiles?: unknown;
            required_fields?: unknown;
            hidden_fields?: unknown;
            custom_fields?: unknown;
          } | null;
          if (alive) {
            setClientProfiles(
              normalizeClientProfiles(cfg?.profiles, {
                required_fields: cfg?.required_fields,
                hidden_fields: cfg?.hidden_fields,
                custom_fields: cfg?.custom_fields,
              }),
            );
          }
        }

        if (userRes.ok) {
          const list = (await userRes.json()) as unknown[];
          if (alive) {
            setUsers(
              (Array.isArray(list) ? list : [])
                .map((u) => {
                  if (!u || typeof u !== "object") return null;
                  const rec = u as Record<string, unknown>;
                  const id = Number(rec.id_user);
                  if (!Number.isFinite(id)) return null;
                  return {
                    id_user: id,
                    first_name:
                      typeof rec.first_name === "string"
                        ? rec.first_name
                        : null,
                    last_name:
                      typeof rec.last_name === "string" ? rec.last_name : null,
                    role: typeof rec.role === "string" ? rec.role : null,
                    email: typeof rec.email === "string" ? rec.email : null,
                  } as AppUserOption;
                })
                .filter((x): x is AppUserOption => x !== null),
            );
          }
        }
      } catch {
        if (alive) {
          toast.error("No se pudieron cargar datos de cotizaciones.");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        setLoadingOperators(true);
        const res = await authFetch("/api/operators", { cache: "no-store" }, token);
        if (!res.ok) throw new Error("No se pudieron cargar operadores");
        const data = (await res.json().catch(() => null)) as unknown;
        if (!alive) return;
        const next = (Array.isArray(data) ? data : [])
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const rec = item as Record<string, unknown>;
            const id = Number(rec.id_operator);
            if (!Number.isFinite(id) || id <= 0) return null;
            return {
              id_operator: Math.trunc(id),
              agency_operator_id:
                typeof rec.agency_operator_id === "number" &&
                Number.isFinite(rec.agency_operator_id)
                  ? Math.trunc(rec.agency_operator_id)
                  : null,
              name: typeof rec.name === "string" ? rec.name : null,
            } as OperatorOption;
          })
          .filter((item): item is OperatorOption => item !== null)
          .sort((a, b) =>
            (a.name || `Operador ${a.id_operator}`).localeCompare(
              b.name || `Operador ${b.id_operator}`,
              "es",
            ),
          );
        setOperators(next);
      } catch {
        if (!alive) return;
        setOperators([]);
      } finally {
        if (alive) setLoadingOperators(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        setLoadingCurrencies(true);
        const picks = await loadFinancePicks(token);
        if (!alive) return;
        setFinanceCurrencies(picks?.currencies ?? []);
      } catch {
        if (!alive) return;
        setFinanceCurrencies([]);
      } finally {
        if (alive) setLoadingCurrencies(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        setLoadingServiceTypes(true);
        const res = await authFetch(
          "/api/service-types",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) throw new Error("No se pudieron cargar tipos de servicio");
        const data = (await res.json().catch(() => null)) as unknown;
        if (!alive) return;
        setServiceTypes(normalizeServiceTypes(data));
      } catch {
        if (!alive) return;
        setServiceTypes([]);
      } finally {
        if (alive) setLoadingServiceTypes(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!profile) return;
    if (isManagerRole(profile.role)) return;
    if (isLeaderRole(profile.role)) {
      if (listScope === "agency") {
        setListScope("team");
      }
      return;
    }
    if (listScope !== "mine") {
      setListScope("mine");
    }
  }, [listScope, profile]);

  useEffect(() => {
    setOwnerFilter("all");
    setExpandedQuoteId(null);
  }, [listScope]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadQuotes();
    }, 250);
    return () => clearTimeout(t);
  }, [loadQuotes]);

  useEffect(() => {
    if (formMode !== "create") return;
    setForm((prev) => {
      let changed = false;
      const next = { ...prev };
      if (!next.id_user && profile?.id_user) {
        next.id_user = profile.id_user;
        changed = true;
      }
      if (!next.creation_date) {
        next.creation_date = todayDateInputValue();
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [formMode, profile?.id_user]);

  const onChangeBase =
    (key: keyof QuoteFormState) =>
    (
      e: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const value = e.target.value;
      setForm((prev) => ({ ...prev, [key]: value }));
    };

  const onChangeBookingDraft =
    (key: keyof QuoteBookingDraft) =>
    (
      e: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const raw = e.target.value;
      setForm((prev) => ({
        ...prev,
        booking_draft: {
          ...prev.booking_draft,
          [key]: key === "pax_count" ? (raw === "" ? null : Number(raw)) : raw,
        },
      }));
    };

  const startCreate = () => {
    setWorkspaceView("form");
    setFormMode("create");
    const next = defaultForm();
    next.id_user = profile?.id_user ?? null;
    next.creation_date = todayDateInputValue();
    next.booking_draft.currency = currencyOptions[0] || "ARS";
    setForm(next);
    setShowMetaOverrides(false);
    clearMoneyInputsByScope("draft");
    closeConvert();
    setExpandedQuoteId(null);
    setFormSections({
      booking: true,
      custom: true,
      pax: true,
      services: true,
    });
  };

  const startEdit = (quote: QuoteItem) => {
    setWorkspaceView("form");
    setFormMode("edit");
    closeConvert();
    const paxDrafts = normalizeQuotePaxDrafts(quote.pax_drafts);
    setForm({
      id_quote: quote.id_quote,
      id_user: quote.id_user,
      creation_date: toDateInputValue(quote.creation_date),
      lead_name: quote.lead_name || "",
      lead_phone: quote.lead_phone || "",
      lead_email: quote.lead_email || "",
      note: quote.note || "",
      booking_draft: {
        ...normalizeQuoteBookingDraft(quote.booking_draft),
        pax_count: paxDrafts.length,
      },
      pax_drafts: paxDrafts,
      service_drafts: normalizeQuoteServiceDrafts(quote.service_drafts),
      custom_values: normalizeQuoteCustomValues(quote.custom_values),
    });
    clearMoneyInputsByScope("draft");
    setExpandedQuoteId(quote.id_quote);
    setShowMetaOverrides(false);
    setFormSections({
      booking: true,
      custom: true,
      pax: false,
      services: false,
    });
  };

  const validateForm = (): string | null => {
    const required = requiredFields.filter((f) => !hiddenFields.includes(f));
    const leadFromPax = resolveLeadFromPaxDrafts(form.pax_drafts);
    const fallbackLeadName = cleanString(form.lead_name);
    const fallbackLeadPhone = cleanString(form.lead_phone);
    const fallbackLeadEmail = cleanString(form.lead_email);

    const valueByKey: Record<string, string> = {
      lead_name: leadFromPax.leadName || fallbackLeadName,
      lead_phone: leadFromPax.leadPhone || fallbackLeadPhone,
      lead_email: leadFromPax.leadEmail || fallbackLeadEmail,
      details: cleanString(form.booking_draft.details),
      departure_date: cleanString(form.booking_draft.departure_date),
      return_date: cleanString(form.booking_draft.return_date),
      currency: cleanString(form.booking_draft.currency),
      pax_count: String(form.pax_drafts.length),
    };

    for (const key of required) {
      if (!cleanString(valueByKey[key])) {
        return `El campo ${key} es obligatorio por configuración.`;
      }
    }

    for (const field of customFields) {
      if (isCustomValueMissing(field, form.custom_values[field.key])) {
        return `El campo personalizado ${field.label} es obligatorio.`;
      }
    }

    return null;
  };

  const saveQuote = async (nextAction: "stay" | "open_studio" = "stay") => {
    if (!token) return;
    const validation = validateForm();
    if (validation) {
      toast.error(validation);
      return;
    }

    const bookingDraftPayload = normalizeQuoteBookingDraft({
      ...form.booking_draft,
      pax_count: form.pax_drafts.length,
    });
    const leadFromPax = resolveLeadFromPaxDrafts(form.pax_drafts);
    const resolvedLeadName =
      leadFromPax.leadName || cleanString(form.lead_name);
    const resolvedLeadPhone =
      leadFromPax.leadPhone || cleanString(form.lead_phone);
    const resolvedLeadEmail =
      leadFromPax.leadEmail || cleanString(form.lead_email);
    const normalizedCreationDate = cleanString(form.creation_date);

    const payload = {
      lead_name: resolvedLeadName,
      lead_phone: resolvedLeadPhone,
      lead_email: resolvedLeadEmail,
      note: cleanString(form.note),
      booking_draft: bookingDraftPayload,
      pax_drafts: normalizeQuotePaxDrafts(form.pax_drafts),
      service_drafts: normalizeQuoteServiceDrafts(form.service_drafts),
      custom_values: normalizeQuoteCustomValues(form.custom_values),
      ...(canOverrideQuoteMeta && showMetaOverrides && form.id_user
        ? { id_user: form.id_user }
        : {}),
      ...(canOverrideQuoteMeta && showMetaOverrides && normalizedCreationDate
        ? { creation_date: normalizedCreationDate }
        : {}),
    };

    try {
      setSaving(true);
      const endpoint =
        formMode === "edit" && form.id_quote
          ? `/api/quotes/${form.id_quote}`
          : "/api/quotes";
      const method = formMode === "edit" && form.id_quote ? "PUT" : "POST";
      const res = await authFetch(
        endpoint,
        { method, body: JSON.stringify(payload) },
        token,
      );
      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | QuoteItem
        | null;
      if (!res.ok)
        throw new Error(
          data && "error" in data ? data.error || "Error" : "Error",
        );
      const normalized = normalizeQuoteItem(data);
      const targetId =
        normalized?.public_id ?? normalized?.id_quote ?? form.id_quote;

      if (nextAction === "open_studio" && targetId) {
        toast.success(
          formMode === "edit"
            ? "Cotización actualizada. Abriendo estudio..."
            : "Cotización creada. Abriendo estudio...",
        );
        router.push(`/quotes/${encodeURIComponent(String(targetId))}/template`);
        return;
      }

      toast.success(
        formMode === "edit" ? "Cotización actualizada" : "Cotización creada",
      );
      startCreate();
      await loadQuotes();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error guardando cotización",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteQuote = async (quote: QuoteItem) => {
    if (!token) return;
    const quoteLabel = showsAgencyCounter
      ? getQuoteAgencyNumber(quote)
      : getQuoteUserNumber(quote);
    const ok = window.confirm(`¿Eliminar cotización ${quoteLabel}?`);
    if (!ok) return;
    try {
      const res = await authFetch(
        `/api/quotes/${quote.id_quote}`,
        { method: "DELETE" },
        token,
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error || "No se pudo eliminar");
      if (form.id_quote === quote.id_quote) startCreate();
      await loadQuotes();
      toast.success("Cotización eliminada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error eliminando");
    }
  };

  const addPaxDraft = () => {
    setForm((prev) => ({
      ...prev,
      booking_draft: {
        ...prev.booking_draft,
        pax_count: prev.pax_drafts.length + 1,
      },
      pax_drafts: [
        ...prev.pax_drafts,
        {
          mode: "free",
          client_id: null,
          is_titular: prev.pax_drafts.length === 0,
          first_name: "",
          last_name: "",
          phone: "",
          email: "",
          birth_date: "",
          nationality: "",
          gender: "",
          notes: "",
        },
      ],
    }));
  };

  const updatePaxDraft = (
    index: number,
    patch: Partial<QuotePaxDraft>,
    normalizeTitular = false,
  ) => {
    setForm((prev) => {
      const next = prev.pax_drafts.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      );
      if (normalizeTitular && patch.is_titular) {
        return {
          ...prev,
          pax_drafts: next.map((p, i) => ({ ...p, is_titular: i === index })),
        };
      }
      return { ...prev, pax_drafts: next };
    });
  };

  const removePaxDraft = (index: number) => {
    setForm((prev) => {
      const next = prev.pax_drafts.filter((_, i) => i !== index);
      const hasTitular = next.some((p) => p.is_titular);
      if (!hasTitular && next.length > 0) {
        next[0] = { ...next[0], is_titular: true };
      }
      return {
        ...prev,
        booking_draft: { ...prev.booking_draft, pax_count: next.length },
        pax_drafts: next,
      };
    });
  };

  const addServiceDraft = () => {
    setForm((prev) => ({
      ...prev,
      service_drafts: [
        ...prev.service_drafts,
        { ...defaultService(), currency: currencyOptions[0] || "ARS" },
      ],
    }));
    clearMoneyInputsByScope("draft");
  };

  const updateServiceDraft = (
    index: number,
    patch: Partial<QuoteServiceDraft>,
  ) => {
    setForm((prev) => ({
      ...prev,
      service_drafts: prev.service_drafts.map((s, i) =>
        i === index ? { ...s, ...patch } : s,
      ),
    }));
  };

  const removeServiceDraft = (index: number) => {
    setForm((prev) => ({
      ...prev,
      service_drafts: prev.service_drafts.filter((_, i) => i !== index),
    }));
    clearMoneyInputsByScope("draft");
  };

  const openConvert = (quote: QuoteItem) => {
    if (quote.quote_status === "converted") {
      toast.info("Esta cotización ya está en Convertidas.");
      return;
    }
    const bookingDraft = normalizeQuoteBookingDraft(quote.booking_draft);
    const paxDrafts = normalizeQuotePaxDrafts(quote.pax_drafts);
    const serviceDrafts = normalizeQuoteServiceDrafts(quote.service_drafts);

    let titularDraft = paxDrafts.find((p) => p.is_titular);
    if (!titularDraft && paxDrafts.length > 0) titularDraft = paxDrafts[0];

    const companions = paxDrafts
      .filter((p) => p !== titularDraft)
      .map((p) => toPassengerFromDraft(p));

    const titular = titularDraft
      ? toPassengerFromDraft(titularDraft)
      : defaultPassenger();

    setWorkspaceView("form");
    setConvertSections({
      booking: true,
      titular: true,
      companions: true,
      services: true,
    });
    setConvertQuote(quote);
    setConvertForm({
      booking: {
        id_user: quote.id_user,
        clientStatus: bookingDraft.clientStatus || "Pendiente",
        operatorStatus: bookingDraft.operatorStatus || "Pendiente",
        status: bookingDraft.status || "Abierta",
        details: bookingDraft.details || "",
        invoice_type:
          bookingDraft.invoice_type || "Coordinar con administracion",
        invoice_observation: bookingDraft.invoice_observation || "",
        observation: bookingDraft.observation || "",
        departure_date: bookingDraft.departure_date || "",
        return_date: bookingDraft.return_date || "",
      },
      titular,
      companions,
      services:
        serviceDrafts.length > 0
          ? serviceDrafts.map((s) => toConvertServiceFromDraft(s))
          : [],
    });
    setShowConvertValidation(false);
    clearMoneyInputsByScope("convert");
  };

  const closeConvert = () => {
    setConvertQuote(null);
    setConvertForm(null);
    setShowConvertValidation(false);
    clearMoneyInputsByScope("convert");
  };

  const updateConvertPassenger = (
    scope: "titular" | "companions",
    index: number,
    patch: Partial<ConvertPassengerForm>,
  ) => {
    const normalizedPatch =
      patch.profile_key !== undefined
        ? {
            ...patch,
            profile_key: resolveClientProfile(clientProfiles, patch.profile_key)
              .key,
          }
        : patch;
    setConvertForm((prev) => {
      if (!prev) return prev;
      if (scope === "titular") {
        return { ...prev, titular: { ...prev.titular, ...normalizedPatch } };
      }
      return {
        ...prev,
        companions: prev.companions.map((c, i) =>
          i === index ? { ...c, ...normalizedPatch } : c,
        ),
      };
    });
  };

  const addConvertCompanion = () => {
    setConvertForm((prev) =>
      prev
        ? {
            ...prev,
            companions: [...prev.companions, defaultPassenger()],
          }
        : prev,
    );
  };

  const removeConvertCompanion = (index: number) => {
    setConvertForm((prev) =>
      prev
        ? {
            ...prev,
            companions: prev.companions.filter((_, i) => i !== index),
          }
        : prev,
    );
  };

  const updateConvertService = (
    index: number,
    patch: Partial<ConvertServiceForm>,
  ) => {
    setConvertForm((prev) =>
      prev
        ? {
            ...prev,
            services: prev.services.map((s, i) =>
              i === index ? { ...s, ...patch } : s,
            ),
          }
        : prev,
    );
  };

  const addConvertService = () => {
    setConvertForm((prev) =>
      prev
        ? {
            ...prev,
            services: [
              ...prev.services,
              {
                ...defaultConvertService(),
                currency: currencyOptions[0] || "ARS",
              },
            ],
          }
        : prev,
    );
    clearMoneyInputsByScope("convert");
  };

  const removeConvertService = (index: number) => {
    setConvertForm((prev) =>
      prev
        ? {
            ...prev,
            services: prev.services.filter((_, i) => i !== index),
          }
        : prev,
    );
    clearMoneyInputsByScope("convert");
  };

  type ConvertValidationIssue = {
    path: string;
    section: "booking" | "titular" | "companions" | "services";
    message: string;
    fix: string;
  };

  const getPassengerRequirementMeta = useCallback(
    (passenger: ConvertPassengerForm) => {
      const profile = resolveClientProfile(clientProfiles, passenger.profile_key);
      const required = new Set<string>(profile.required_fields);
      BASE_PASSENGER_REQUIRED_FIELDS.forEach((field) => required.add(field));
      const documentAnyRequired =
        required.has(DOCUMENT_ANY_KEY) ||
        DOC_REQUIRED_FIELDS.some((field) => required.has(field));
      required.delete(DOCUMENT_ANY_KEY);
      return { profile, required, documentAnyRequired };
    },
    [clientProfiles],
  );

  const convertValidation = useMemo(() => {
    const issues: ConvertValidationIssue[] = [];
    const seen = new Set<string>();

    const pushIssue = (issue: ConvertValidationIssue) => {
      if (seen.has(issue.path)) return;
      seen.add(issue.path);
      issues.push(issue);
    };

    if (!convertForm) return { issues };

    for (const key of BOOKING_REQUIRED_FIELDS) {
      const value = cleanString(convertForm.booking[key]);
      if (!value) {
        const label = labelFromMap(BOOKING_FIELD_LABELS, key, key);
        pushIssue({
          path: `booking.${key}`,
          section: "booking",
          message: `Falta ${label} en Datos base de reserva.`,
          fix: `Completá el campo "${label}" en la sección de reserva.`,
        });
      }
    }
    if (
      cleanString(convertForm.booking.departure_date) &&
      cleanString(convertForm.booking.return_date)
    ) {
      const departureMs = Date.parse(`${convertForm.booking.departure_date}T00:00:00`);
      const returnMs = Date.parse(`${convertForm.booking.return_date}T00:00:00`);
      if (
        Number.isFinite(departureMs) &&
        Number.isFinite(returnMs) &&
        returnMs < departureMs
      ) {
        pushIssue({
          path: "booking.return_date",
          section: "booking",
          message: "La fecha de regreso no puede ser anterior a la salida.",
          fix: "Ajustá las fechas de salida y regreso para que sean coherentes.",
        });
      }
    }

    const requestedPaxCount = 1 + convertForm.companions.length;
    const quotePaxCount = convertQuote
      ? normalizeQuotePaxDrafts(convertQuote.pax_drafts).length
      : 0;
    if (quotePaxCount > 0 && requestedPaxCount < quotePaxCount) {
      const missing = quotePaxCount - requestedPaxCount;
      pushIssue({
        path: "companions.count",
        section: "companions",
        message: `La cotización original tiene ${quotePaxCount} pax y faltan ${missing} en la conversión.`,
        fix: `Agregá ${missing} acompañante${missing > 1 ? "s" : ""} para mantener la misma cantidad.`,
      });
    }

    const quoteServiceCount = convertQuote
      ? normalizeQuoteServiceDrafts(convertQuote.service_drafts).length
      : 0;
    if (quoteServiceCount > 0 && convertForm.services.length < quoteServiceCount) {
      const missing = quoteServiceCount - convertForm.services.length;
      pushIssue({
        path: "services.count",
        section: "services",
        message: `La cotización original tiene ${quoteServiceCount} servicio(s) y faltan ${missing}.`,
        fix: `Agregá ${missing} servicio${missing > 1 ? "s" : ""} para completar la conversión.`,
      });
    }

    const validatePassenger = (
      passenger: ConvertPassengerForm,
      pathPrefix: string,
      section: "titular" | "companions",
      sectionLabel: string,
    ) => {
      if (passenger.mode === "existing") {
        if (
          typeof passenger.client_id !== "number" ||
          !Number.isFinite(passenger.client_id) ||
          passenger.client_id <= 0
        ) {
          pushIssue({
            path: `${pathPrefix}.client_id`,
            section,
            message: `No seleccionaste un pax existente en ${sectionLabel}.`,
            fix: `Elegí un pax desde el buscador o cambiá a modo "Pax nuevo".`,
          });
        }
        return;
      }

      const { profile, required, documentAnyRequired } =
        getPassengerRequirementMeta(passenger);

      for (const field of required) {
        if (field === DOCUMENT_ANY_KEY) continue;
        const value = cleanString((passenger as Record<string, unknown>)[field]);
        if (!value) {
          const fieldLabel = labelFromMap(
            PASSENGER_FIELD_LABELS,
            field,
            field,
          );
          pushIssue({
            path: `${pathPrefix}.${field}`,
            section,
            message: `Falta ${fieldLabel} en ${sectionLabel} (${profile.label}).`,
            fix: `Completá "${fieldLabel}" para continuar con la conversión.`,
          });
        }
      }

      if (documentAnyRequired) {
        const hasAnyDocument =
          cleanString(passenger.dni_number) ||
          cleanString(passenger.passport_number) ||
          cleanString(passenger.tax_id);
        if (!hasAnyDocument) {
          const docFix =
            'Cargá al menos uno: "DNI", "Pasaporte" o "CUIT / RUT".';
          pushIssue({
            path: `${pathPrefix}.dni_number`,
            section,
            message: `En ${sectionLabel} falta documentación obligatoria.`,
            fix: docFix,
          });
          pushIssue({
            path: `${pathPrefix}.passport_number`,
            section,
            message: `En ${sectionLabel} falta documentación obligatoria.`,
            fix: docFix,
          });
          pushIssue({
            path: `${pathPrefix}.tax_id`,
            section,
            message: `En ${sectionLabel} falta documentación obligatoria.`,
            fix: docFix,
          });
        }
      }
    };

    validatePassenger(convertForm.titular, "titular", "titular", "titular");
    convertForm.companions.forEach((passenger, index) => {
      validatePassenger(
        passenger,
        `companions.${index}`,
        "companions",
        `acompañante #${index + 1}`,
      );
    });

    convertForm.services.forEach((service, index) => {
      const basePath = `services.${index}`;

      if (!cleanString(service.type)) {
        pushIssue({
          path: `${basePath}.type`,
          section: "services",
          message: `Falta ${SERVICE_FIELD_LABELS.type} en servicio #${index + 1}.`,
          fix: 'Seleccioná el "Tipo de servicio".',
        });
      }
      if (!cleanString(service.currency)) {
        pushIssue({
          path: `${basePath}.currency`,
          section: "services",
          message: `Falta ${SERVICE_FIELD_LABELS.currency} en servicio #${index + 1}.`,
          fix: 'Seleccioná la "Moneda".',
        });
      }
      if (toNumber(service.sale_price) == null) {
        pushIssue({
          path: `${basePath}.sale_price`,
          section: "services",
          message: `Falta ${SERVICE_FIELD_LABELS.sale_price} en servicio #${index + 1}.`,
          fix: 'Ingresá un valor numérico en "Precio de venta".',
        });
      }
      if (toNumber(service.cost_price) == null) {
        pushIssue({
          path: `${basePath}.cost_price`,
          section: "services",
          message: `Falta ${SERVICE_FIELD_LABELS.cost_price} en servicio #${index + 1}.`,
          fix: 'Ingresá un valor numérico en "Costo".',
        });
      }
      if (
        typeof service.operator_id !== "number" ||
        !Number.isFinite(service.operator_id) ||
        service.operator_id <= 0
      ) {
        pushIssue({
          path: `${basePath}.operator_id`,
          section: "services",
          message: `Falta ${SERVICE_FIELD_LABELS.operator_id} en servicio #${index + 1}.`,
          fix: 'Seleccioná un "Operador" válido.',
        });
      }
    });

    return { issues };
  }, [convertForm, convertQuote, getPassengerRequirementMeta]);

  const convertInvalidPathSet = useMemo(() => {
    if (!showConvertValidation) return new Set<string>();
    return new Set(convertValidation.issues.map((issue) => issue.path));
  }, [convertValidation.issues, showConvertValidation]);

  const isConvertInvalid = useCallback(
    (path: string) => convertInvalidPathSet.has(path),
    [convertInvalidPathSet],
  );

  const convertInputClass = useCallback(
    (path: string, baseClass: string) =>
      `${baseClass} ${
        isConvertInvalid(path)
          ? "border-rose-500/70 bg-rose-50/65 text-rose-900 focus:border-rose-500/90 focus:ring-rose-400/40 dark:border-rose-300/65 dark:bg-rose-900/20 dark:text-rose-100"
          : ""
      }`,
    [isConvertInvalid],
  );

  const convertLabelClass = useCallback(
    (path?: string) =>
      path && isConvertInvalid(path)
        ? "mb-1 block text-xs font-medium text-rose-700 dark:text-rose-300"
        : "mb-1 block text-xs opacity-75",
    [isConvertInvalid],
  );

  const isPassengerFieldRequired = useCallback(
    (passenger: ConvertPassengerForm, field: string) => {
      if (passenger.mode !== "new") return false;
      const { required } = getPassengerRequirementMeta(passenger);
      return required.has(field);
    },
    [getPassengerRequirementMeta],
  );

  const isPassengerDocumentRequired = useCallback(
    (passenger: ConvertPassengerForm) => {
      if (passenger.mode !== "new") return false;
      const { documentAnyRequired } = getPassengerRequirementMeta(passenger);
      return documentAnyRequired;
    },
    [getPassengerRequirementMeta],
  );

  const passengerRequiredLabels = useCallback(
    (passenger: ConvertPassengerForm) => {
      if (passenger.mode !== "new") return [] as string[];
      const { required, documentAnyRequired } = getPassengerRequirementMeta(passenger);
      const labels = Array.from(required)
        .filter((field) => !DOC_REQUIRED_FIELDS.includes(field))
        .map((field) => labelFromMap(PASSENGER_FIELD_LABELS, field, field));
      if (documentAnyRequired) {
        labels.push("Documento (DNI/Pasaporte/CUIT)");
      }
      return labels;
    },
    [getPassengerRequirementMeta],
  );

  const convertFailureGuidance = useCallback((message: string): string => {
    const normalized = cleanString(message).toLowerCase();
    if (!normalized) return "";
    if (normalized.includes("falta") && normalized.includes("booking")) {
      return "Completá los campos marcados en rojo dentro de Datos base de reserva.";
    }
    if (normalized.includes("fechas de booking inválidas")) {
      return "Revisá Salida y Regreso usando fechas válidas (formato fecha).";
    }
    if (normalized.includes("para crear pax")) {
      return "Completá todos los campos obligatorios del titular y acompañantes según su perfil.";
    }
    if (normalized.includes("dni") || normalized.includes("pasaporte") || normalized.includes("cuit")) {
      return "Cargá al menos un documento válido por pasajero requerido.";
    }
    if (normalized.includes("servicio requiere")) {
      return "Completá Tipo, Moneda, Venta, Costo y Operador para cada servicio.";
    }
    if (normalized.includes("operador inválido")) {
      return "Elegí un operador existente de tu agencia en cada servicio.";
    }
    if (normalized.includes("tiene pax cargados")) {
      return "Agregá los acompañantes faltantes para igualar los pax de la cotización.";
    }
    if (normalized.includes("tiene servicios cargados")) {
      return "Agregá los servicios faltantes para igualar la cotización.";
    }
    return "";
  }, []);

  const submitConvert = async () => {
    if (!token || !convertQuote || !convertForm) return;

    setShowConvertValidation(true);
    if (convertValidation.issues.length > 0) {
      const sectionsToOpen = new Set<string>(
        convertValidation.issues.map((issue) => issue.section),
      );
      setConvertSections((prev) => ({
        ...prev,
        booking: sectionsToOpen.has("booking") ? true : prev.booking,
        titular: sectionsToOpen.has("titular") ? true : prev.titular,
        companions: sectionsToOpen.has("companions") ? true : prev.companions,
        services: sectionsToOpen.has("services") ? true : prev.services,
      }));

      toast.error(
        `No se pudo convertir: hay ${convertValidation.issues.length} validación(es) obligatoria(s).`,
      );
      const maxToasts = 4;
      const uniqueIssues = convertValidation.issues.filter(
        (issue, index, arr) =>
          arr.findIndex((candidate) => candidate.message === issue.message) ===
          index,
      );
      uniqueIssues.slice(0, maxToasts).forEach((issue) => {
        toast.error(`${issue.message} Solución: ${issue.fix}`);
      });
      if (uniqueIssues.length > maxToasts) {
        toast.info(
          `Hay ${uniqueIssues.length - maxToasts} validaciones adicionales marcadas en rojo.`,
        );
      }
      return;
    }

    const reqPassenger = (p: ConvertPassengerForm) => {
      if (p.mode === "existing") {
        return {
          mode: "existing" as const,
          client_id: p.client_id,
        };
      }
      return {
        mode: "new" as const,
        profile_key: cleanString(p.profile_key),
        first_name: cleanString(p.first_name),
        last_name: cleanString(p.last_name),
        phone: cleanString(p.phone),
        birth_date: cleanString(p.birth_date),
        nationality: cleanString(p.nationality),
        gender: cleanString(p.gender),
        email: cleanString(p.email),
        dni_number: cleanString(p.dni_number),
        passport_number: cleanString(p.passport_number),
        tax_id: cleanString(p.tax_id),
        company_name: cleanString(p.company_name),
        commercial_address: cleanString(p.commercial_address),
        address: cleanString(p.address),
        locality: cleanString(p.locality),
        postal_code: cleanString(p.postal_code),
      };
    };

    const payload = {
      booking: {
        ...convertForm.booking,
        id_user: canAssignOwner ? convertForm.booking.id_user : undefined,
      },
      titular: reqPassenger(convertForm.titular),
      companions: convertForm.companions.map((p) => reqPassenger(p)),
      services: convertForm.services.map((s) => ({
        type: cleanString(s.type),
        description: cleanString(s.description),
        note: cleanString(s.note),
        sale_price: toNumber(s.sale_price),
        cost_price: toNumber(s.cost_price),
        currency: cleanString(s.currency),
        destination: cleanString(s.destination),
        reference: cleanString(s.reference),
        operator_id: s.operator_id,
        departure_date: cleanString(s.departure_date),
        return_date: cleanString(s.return_date),
      })),
    };

    try {
      setConverting(true);
      const res = await authFetch(
        `/api/quotes/${convertQuote.id_quote}/convert`,
        { method: "POST", body: JSON.stringify(payload) },
        token,
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        id_booking?: number;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo convertir");
      }
      toast.success(
        `Cotización convertida y movida a Convertidas (reserva Nº ${data?.id_booking ?? ""})`,
      );
      setShowConvertValidation(false);
      closeConvert();
      await loadQuotes();
    } catch (error) {
      const baseMessage =
        error instanceof Error ? error.message : "Error al convertir";
      const guidance = convertFailureGuidance(baseMessage);
      toast.error(
        guidance ? `${baseMessage} Solución: ${guidance}` : baseMessage,
      );
    } finally {
      setConverting(false);
    }
  };
  const hasConvertOpen = Boolean(convertQuote && convertForm);

  const syncCardWidths = useCallback(() => {
    cardShellRefs.current.forEach((card, id) => {
      if (listView === "grid") {
        card.style.removeProperty("width");
        return;
      }
      const actionRow = cardActionRowRefs.current.get(id);
      if (!actionRow) return;
      const parentWidth = card.parentElement?.clientWidth ?? 0;
      const contentWidth = actionRow.scrollWidth + 24;
      card.style.width = `${Math.max(parentWidth, contentWidth)}px`;
    });
  }, [listView]);

  useEffect(() => {
    syncCardWidths();
    if (listView === "grid" || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => syncCardWidths());
    cardActionRowRefs.current.forEach((row) => observer.observe(row));
    const onResize = () => syncCardWidths();
    window.addEventListener("resize", onResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [filteredQuotes, listView, syncCardWidths]);

  if (loading && quotes.length === 0) {
    return (
      <ProtectedRoute>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner />
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <section className="mx-auto max-w-7xl p-6 text-slate-950 dark:text-white">
        <ToastContainer position="top-right" autoClose={2200} />

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-sky-950 dark:text-sky-50">
            Cotizaciones
          </h1>
          <p className="mt-1 text-sm text-sky-900/75 dark:text-sky-100/70">
            Creá cotizaciones y trabajalas en el estudio visual de PDF dentro
            del mismo flujo.
          </p>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex items-center gap-1 rounded-full border border-sky-300/35 bg-white/55 p-1 text-xs shadow-sm shadow-sky-950/10 dark:border-sky-200/25 dark:bg-sky-950/25">
              <button
                type="button"
                onClick={() => setWorkspaceView("form")}
                className={`relative flex items-center justify-center gap-1 overflow-hidden rounded-full px-4 py-1.5 text-sm transition-[color,transform,opacity] duration-300 ease-out hover:scale-[0.99] hover:opacity-95 active:scale-[0.97] active:opacity-90 ${
                  workspaceView === "form"
                    ? "text-sky-800 dark:text-sky-200"
                    : "text-sky-900/75 hover:text-sky-900 dark:text-sky-100"
                }`}
                aria-pressed={workspaceView === "form"}
              >
                {workspaceView === "form" && (
                  <motion.span
                    layoutId="quotes-workspace-toggle-pill"
                    className="absolute inset-0 z-0 rounded-full bg-sky-500/15 shadow-sm shadow-sky-900/20"
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  />
                )}
                <span className="relative z-10">
                  {hasConvertOpen ? "Convertir reserva" : "Formulario"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceView("list")}
                className={`relative flex items-center justify-center gap-1 overflow-hidden rounded-full px-4 py-1.5 text-sm transition-[color,transform,opacity] duration-300 ease-out hover:scale-[0.99] hover:opacity-95 active:scale-[0.97] active:opacity-90 ${
                  workspaceView === "list"
                    ? "text-sky-800 dark:text-sky-200"
                    : "text-sky-900/75 hover:text-sky-900 dark:text-sky-100"
                }`}
                aria-pressed={workspaceView === "list"}
              >
                {workspaceView === "list" && (
                  <motion.span
                    layoutId="quotes-workspace-toggle-pill"
                    className="absolute inset-0 z-0 rounded-full bg-sky-500/15 shadow-sm shadow-sky-900/20"
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  />
                )}
                <span className="relative z-10">Listado</span>
              </button>
            </div>
          </div>

          <div className={workspaceView === "form" ? "space-y-4" : "hidden"}>
            {!hasConvertOpen && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-sky-950 dark:text-sky-50">
                      {formMode === "edit"
                        ? "Editar cotización"
                        : "Nueva cotización"}
                    </h2>
                    <p className="text-xs text-sky-900/75 dark:text-sky-100/70">
                      Formulario flexible con datos base, pax y servicios.
                    </p>
                  </div>
                  {formMode === "edit" && (
                    <button
                      type="button"
                      className={SUBTLE_BTN}
                      onClick={startCreate}
                    >
                      Cancelar edición
                    </button>
                  )}
                </div>

                <SectionCard
                  id="booking"
                  title="Datos base de reserva"
                  subtitle="Borrador editable para la futura conversión"
                  open={Boolean(formSections.booking)}
                  onToggle={toggleFormSection}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    {!hiddenFields.includes("details") && (
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs opacity-75">
                          Detalle
                        </label>
                        <textarea
                          className={`${INPUT} min-h-20`}
                          placeholder="Resumen del viaje, condiciones, ideas o comentarios"
                          value={String(form.booking_draft.details || "")}
                          onChange={onChangeBookingDraft("details")}
                        />
                      </div>
                    )}
                    {!hiddenFields.includes("departure_date") && (
                      <div>
                        <label className="mb-1 block text-xs opacity-75">
                          Salida
                        </label>
                        <input
                          type="date"
                          className={INPUT}
                          placeholder="Seleccionar fecha"
                          value={String(
                            form.booking_draft.departure_date || "",
                          )}
                          onChange={onChangeBookingDraft("departure_date")}
                        />
                      </div>
                    )}
                    {!hiddenFields.includes("return_date") && (
                      <div>
                        <label className="mb-1 block text-xs opacity-75">
                          Regreso
                        </label>
                        <input
                          type="date"
                          className={INPUT}
                          placeholder="Seleccionar fecha"
                          value={String(form.booking_draft.return_date || "")}
                          onChange={onChangeBookingDraft("return_date")}
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-3">
                    <label className="mb-1 block text-xs opacity-75">
                      Notas
                    </label>
                    <textarea
                      className={`${INPUT} min-h-24`}
                      placeholder="Notas internas o contexto de la cotización"
                      value={form.note}
                      onChange={onChangeBase("note")}
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  id="pax"
                  title="Pax borrador"
                  subtitle="Titular y acompañantes opcionales"
                  open={Boolean(formSections.pax)}
                  onToggle={toggleFormSection}
                  right={
                    <button
                      type="button"
                      className={AMBER_BTN}
                      onClick={(e) => {
                        e.stopPropagation();
                        addPaxDraft();
                      }}
                    >
                      Agregar pax
                    </button>
                  }
                >
                  {form.pax_drafts.length === 0 ? (
                    <p className="text-xs opacity-75">No hay pax cargados.</p>
                  ) : (
                    <div className="space-y-3">
                      {form.pax_drafts.map((p, idx) => (
                        <div
                          key={`pax-${idx}`}
                          className="rounded-2xl border border-sky-300/30 bg-white/55 p-4 dark:border-sky-200/20 dark:bg-sky-950/20"
                        >
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-sky-800/70 dark:text-sky-100/70">
                                Pax #{idx + 1}
                              </p>
                              <p className="text-xs text-sky-900/75 dark:text-sky-100/75">
                                {p.is_titular
                                  ? "Titular de la cotización"
                                  : "Acompañante"}
                              </p>
                            </div>
                            <button
                              type="button"
                              className={DANGER_ICON_BTN}
                              onClick={() => removePaxDraft(idx)}
                              aria-label="Quitar pax"
                              title="Quitar pax"
                            >
                              <TrashIcon />
                            </button>
                          </div>

                          <div className="mb-3 grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Tipo de carga
                              </label>
                              <div className="flex items-center gap-1 rounded-full border border-sky-300/35 bg-white/60 p-1 text-xs dark:border-sky-200/20 dark:bg-sky-950/20">
                                <button
                                  type="button"
                                  className={`rounded-full px-3 py-1 transition ${
                                    p.mode !== "existing"
                                      ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200"
                                      : "text-sky-900/75 dark:text-sky-100"
                                  }`}
                                  onClick={() =>
                                    updatePaxDraft(idx, {
                                      mode: "free",
                                      client_id: null,
                                    })
                                  }
                                >
                                  Pax libre
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-full px-3 py-1 transition ${
                                    p.mode === "existing"
                                      ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200"
                                      : "text-sky-900/75 dark:text-sky-100"
                                  }`}
                                  onClick={() =>
                                    updatePaxDraft(idx, {
                                      mode: "existing",
                                      client_id: p.client_id || null,
                                    })
                                  }
                                >
                                  Pax existente
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Rol en reserva
                              </label>
                              <div className="flex items-center gap-1 rounded-full border border-sky-300/35 bg-white/60 p-1 text-xs dark:border-sky-200/20 dark:bg-sky-950/20">
                                <button
                                  type="button"
                                  className={`rounded-full px-3 py-1 transition ${
                                    p.is_titular
                                      ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200"
                                      : "text-sky-900/75 dark:text-sky-100"
                                  }`}
                                  onClick={() =>
                                    updatePaxDraft(
                                      idx,
                                      { is_titular: true },
                                      true,
                                    )
                                  }
                                >
                                  Titular
                                </button>
                                <button
                                  type="button"
                                  className={`rounded-full px-3 py-1 transition ${
                                    !p.is_titular
                                      ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200"
                                      : "text-sky-900/75 dark:text-sky-100"
                                  }`}
                                  onClick={() =>
                                    updatePaxDraft(idx, { is_titular: false })
                                  }
                                >
                                  No titular
                                </button>
                              </div>
                            </div>
                          </div>

                          {p.mode === "existing" ? (
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Pax existente
                              </label>
                              <ClientPicker
                                token={token}
                                valueId={p.client_id ?? null}
                                placeholder="Buscar pax existente..."
                                excludeIds={form.pax_drafts
                                  .map((draft, draftIdx) =>
                                    draftIdx !== idx &&
                                    draft.mode === "existing" &&
                                    typeof draft.client_id === "number"
                                      ? draft.client_id
                                      : null,
                                  )
                                  .filter(
                                    (id): id is number =>
                                      typeof id === "number",
                                  )}
                                onSelect={(client) =>
                                  updatePaxDraft(idx, {
                                    mode: "existing",
                                    client_id: client.id_client,
                                    first_name: client.first_name || "",
                                    last_name: client.last_name || "",
                                    phone: client.phone || "",
                                    email: client.email || "",
                                    birth_date: client.birth_date || "",
                                    nationality: client.nationality || "",
                                    gender: client.gender || "",
                                  })
                                }
                                onClear={() =>
                                  updatePaxDraft(idx, {
                                    client_id: null,
                                    first_name: "",
                                    last_name: "",
                                    phone: "",
                                    email: "",
                                    birth_date: "",
                                    nationality: "",
                                    gender: "",
                                  })
                                }
                              />
                            </div>
                          ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <label className="mb-1 block text-xs opacity-75">
                                  Nombre
                                </label>
                                <input
                                  className={INPUT}
                                  placeholder="Nombre"
                                  value={p.first_name || ""}
                                  onChange={(e) =>
                                    updatePaxDraft(idx, {
                                      first_name: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs opacity-75">
                                  Apellido
                                </label>
                                <input
                                  className={INPUT}
                                  placeholder="Apellido"
                                  value={p.last_name || ""}
                                  onChange={(e) =>
                                    updatePaxDraft(idx, {
                                      last_name: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs opacity-75">
                                  Teléfono
                                </label>
                                <input
                                  className={INPUT}
                                  placeholder="Teléfono"
                                  value={p.phone || ""}
                                  onChange={(e) =>
                                    updatePaxDraft(idx, {
                                      phone: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs opacity-75">
                                  Email
                                </label>
                                <input
                                  className={INPUT}
                                  placeholder="Email"
                                  value={p.email || ""}
                                  onChange={(e) =>
                                    updatePaxDraft(idx, {
                                      email: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs opacity-75">
                                  Fecha de nacimiento
                                </label>
                                <input
                                  type="date"
                                  className={INPUT}
                                  placeholder="Seleccionar fecha"
                                  value={p.birth_date || ""}
                                  onChange={(e) =>
                                    updatePaxDraft(idx, {
                                      birth_date: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs opacity-75">
                                  Género
                                </label>
                                <select
                                  className={SELECT}
                                  value={p.gender || ""}
                                  onChange={(e) =>
                                    updatePaxDraft(idx, {
                                      gender: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">Género</option>
                                  <option value="Masculino">Masculino</option>
                                  <option value="Femenino">Femenino</option>
                                  <option value="Otro">Otro</option>
                                  <option value="Prefiere no decir">
                                    Prefiere no decir
                                  </option>
                                </select>
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <label className="mb-1 block text-xs opacity-75">
                                  Nacionalidad
                                </label>
                                <DestinationPicker
                                  type="country"
                                  multiple={false}
                                  value={null}
                                  onChange={(value) =>
                                    updatePaxDraft(idx, {
                                      nationality:
                                        destinationValueToLabel(value),
                                    })
                                  }
                                  placeholder="Nacionalidad"
                                  includeDisabled={true}
                                  className="relative z-30 [&>label]:hidden"
                                />
                                {p.nationality ? (
                                  <p className="text-xs text-sky-900/70 dark:text-sky-100/70">
                                    Guardará: <b>{p.nationality}</b>
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  id="services"
                  title="Servicios borrador"
                  subtitle="Servicios opcionales a convertir luego en reserva"
                  open={Boolean(formSections.services)}
                  onToggle={toggleFormSection}
                  right={
                    <button
                      type="button"
                      className={AMBER_BTN}
                      onClick={(e) => {
                        e.stopPropagation();
                        addServiceDraft();
                      }}
                    >
                      Agregar servicio
                    </button>
                  }
                >
                  {form.service_drafts.length === 0 ? (
                    <p className="text-xs opacity-75">
                      No hay servicios cargados.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {form.service_drafts.map((s, idx) => (
                        <div
                          key={`svc-${idx}`}
                          className="rounded-2xl border border-sky-300/30 bg-white/55 p-4 dark:border-sky-200/20 dark:bg-sky-950/20"
                        >
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-sky-800/70 dark:text-sky-100/70">
                                Servicio #{idx + 1}
                              </p>
                              <p className="text-xs text-sky-900/75 dark:text-sky-100/75">
                                Carga comercial y de viaje
                              </p>
                            </div>
                            <button
                              type="button"
                              className={DANGER_ICON_BTN}
                              onClick={() => removeServiceDraft(idx)}
                              aria-label="Quitar servicio"
                              title="Quitar servicio"
                            >
                              <TrashIcon />
                            </button>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Tipo de servicio
                              </label>
                              <select
                                className={SELECT}
                                value={s.type || ""}
                                onChange={(e) =>
                                  updateServiceDraft(idx, {
                                    type: e.target.value,
                                  })
                                }
                                disabled={loadingServiceTypes}
                              >
                                <option value="">Tipo de servicio</option>
                                {serviceTypes.map((typeOption) => (
                                  <option
                                    key={typeOption.value}
                                    value={typeOption.value}
                                  >
                                    {typeOption.label}
                                  </option>
                                ))}
                                {s.type &&
                                  !serviceTypes.some(
                                    (typeOption) => typeOption.value === s.type,
                                  ) && (
                                    <option value={s.type}>
                                      {s.type} (no listado)
                                    </option>
                                  )}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Moneda
                              </label>
                              <select
                                className={SELECT}
                                value={s.currency || ""}
                                onChange={(e) => {
                                  updateServiceDraft(idx, {
                                    currency: e.target.value,
                                  });
                                  clearMoneyInputsByIndex("draft", idx);
                                }}
                                disabled={loadingCurrencies}
                              >
                                <option value="">Moneda</option>
                                {currencyOptions.map((code) => (
                                  <option key={code} value={code}>
                                    {code}
                                  </option>
                                ))}
                                {s.currency &&
                                  !currencyOptions.includes(
                                    s.currency.toUpperCase(),
                                  ) && (
                                    <option value={s.currency}>
                                      {s.currency} (no listado)
                                    </option>
                                  )}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Precio de venta
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                className={INPUT}
                                placeholder="Venta"
                                value={
                                  moneyInputs[
                                    moneyInputKey("draft", idx, "sale_price")
                                  ] ??
                                  formatStoredMoneyInput(
                                    s.sale_price,
                                    s.currency ||
                                      form.booking_draft.currency ||
                                      "ARS",
                                  )
                                }
                                onChange={(e) => {
                                  const currency =
                                    s.currency ||
                                    form.booking_draft.currency ||
                                    "ARS";
                                  const formatted = formatMoneyInputSafe(
                                    e.target.value,
                                    currency,
                                    shouldPreferDotDecimal(e),
                                  );
                                  const parsed = parseMoneyInputSafe(formatted);
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [moneyInputKey("draft", idx, "sale_price")]:
                                      formatted,
                                  }));
                                  updateServiceDraft(idx, {
                                    sale_price:
                                      parsed != null && Number.isFinite(parsed)
                                        ? parsed
                                        : null,
                                  });
                                }}
                                onBlur={(e) => {
                                  const currency =
                                    s.currency ||
                                    form.booking_draft.currency ||
                                    "ARS";
                                  const parsed = parseMoneyInputSafe(
                                    e.target.value,
                                  );
                                  const numeric =
                                    parsed != null && Number.isFinite(parsed)
                                      ? parsed
                                      : null;
                                  updateServiceDraft(idx, {
                                    sale_price: numeric,
                                  });
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [moneyInputKey("draft", idx, "sale_price")]:
                                      numeric != null
                                        ? formatMoneyInputSafe(
                                            String(numeric),
                                            currency,
                                          )
                                        : "",
                                  }));
                                }}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Costo
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                className={INPUT}
                                placeholder="Costo"
                                value={
                                  moneyInputs[
                                    moneyInputKey("draft", idx, "cost_price")
                                  ] ??
                                  formatStoredMoneyInput(
                                    s.cost_price,
                                    s.currency ||
                                      form.booking_draft.currency ||
                                      "ARS",
                                  )
                                }
                                onChange={(e) => {
                                  const currency =
                                    s.currency ||
                                    form.booking_draft.currency ||
                                    "ARS";
                                  const formatted = formatMoneyInputSafe(
                                    e.target.value,
                                    currency,
                                    shouldPreferDotDecimal(e),
                                  );
                                  const parsed = parseMoneyInputSafe(formatted);
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [moneyInputKey("draft", idx, "cost_price")]:
                                      formatted,
                                  }));
                                  updateServiceDraft(idx, {
                                    cost_price:
                                      parsed != null && Number.isFinite(parsed)
                                        ? parsed
                                        : null,
                                  });
                                }}
                                onBlur={(e) => {
                                  const currency =
                                    s.currency ||
                                    form.booking_draft.currency ||
                                    "ARS";
                                  const parsed = parseMoneyInputSafe(
                                    e.target.value,
                                  );
                                  const numeric =
                                    parsed != null && Number.isFinite(parsed)
                                      ? parsed
                                      : null;
                                  updateServiceDraft(idx, {
                                    cost_price: numeric,
                                  });
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [moneyInputKey("draft", idx, "cost_price")]:
                                      numeric != null
                                        ? formatMoneyInputSafe(
                                            String(numeric),
                                            currency,
                                          )
                                        : "",
                                  }));
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="mb-1 block text-xs opacity-75">
                                Destino
                              </label>
                              <DestinationPicker
                                type="destination"
                                multiple={false}
                                value={null}
                                onChange={(value) =>
                                  updateServiceDraft(idx, {
                                    destination: destinationValueToLabel(value),
                                  })
                                }
                                placeholder="Destino"
                                className="relative z-30 [&>label]:hidden"
                              />
                              {s.destination ? (
                                <p className="text-xs text-sky-900/70 dark:text-sky-100/70">
                                  Guardará: <b>{s.destination}</b>
                                </p>
                              ) : null}
                            </div>
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Salida
                              </label>
                              <input
                                type="date"
                                className={INPUT}
                                placeholder="Seleccionar fecha"
                                value={s.departure_date || ""}
                                onChange={(e) =>
                                  updateServiceDraft(idx, {
                                    departure_date: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Regreso
                              </label>
                              <input
                                type="date"
                                className={INPUT}
                                placeholder="Seleccionar fecha"
                                value={s.return_date || ""}
                                onChange={(e) =>
                                  updateServiceDraft(idx, {
                                    return_date: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="mb-1 block text-xs opacity-75">
                                Descripción
                              </label>
                              <textarea
                                className={`${INPUT} min-h-16`}
                                placeholder="Descripción"
                                value={s.description || ""}
                                onChange={(e) =>
                                  updateServiceDraft(idx, {
                                    description: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                {customFields.length > 0 && (
                  <SectionCard
                    id="custom"
                    title="Campos personalizados"
                    subtitle="Campos dinámicos configurados por agencia"
                    open={Boolean(formSections.custom)}
                    onToggle={toggleFormSection}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      {customFields.map((field) => {
                        const val = form.custom_values[field.key];
                        const commonProps = {
                          className: INPUT,
                          placeholder: field.label,
                          value:
                            typeof val === "string" || typeof val === "number"
                              ? String(val)
                              : "",
                          onChange: (
                            e: ChangeEvent<
                              | HTMLInputElement
                              | HTMLTextAreaElement
                              | HTMLSelectElement
                            >,
                          ) => {
                            const raw = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              custom_values: {
                                ...prev.custom_values,
                                [field.key]:
                                  field.type === "number"
                                    ? raw === ""
                                      ? ""
                                      : Number(raw)
                                    : raw,
                              },
                            }));
                          },
                        };

                        if (field.type === "textarea") {
                          return (
                            <div className="md:col-span-2" key={field.key}>
                              <label className="mb-1 block text-xs opacity-75">
                                {field.label}
                              </label>
                              <textarea
                                {...commonProps}
                                className={`${INPUT} min-h-20`}
                              />
                            </div>
                          );
                        }

                        if (field.type === "select") {
                          return (
                            <div key={field.key}>
                              <label className="mb-1 block text-xs opacity-75">
                                {field.label}
                              </label>
                              <select {...commonProps} className={SELECT}>
                                <option value="">Seleccionar</option>
                                {(field.options || []).map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        }

                        if (field.type === "boolean") {
                          return (
                            <div key={field.key}>
                              <label className="mb-1 block text-xs opacity-75">
                                {field.label}
                              </label>
                              <select
                                className={SELECT}
                                value={
                                  typeof val === "boolean"
                                    ? val
                                      ? "true"
                                      : "false"
                                    : ""
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setForm((prev) => ({
                                    ...prev,
                                    custom_values: {
                                      ...prev.custom_values,
                                      [field.key]:
                                        raw === ""
                                          ? ""
                                          : raw === "true"
                                            ? true
                                            : false,
                                    },
                                  }));
                                }}
                              >
                                <option value="">Seleccionar</option>
                                <option value="true">Sí</option>
                                <option value="false">No</option>
                              </select>
                            </div>
                          );
                        }

                        return (
                          <div key={field.key}>
                            <label className="mb-1 block text-xs opacity-75">
                              {field.label}
                            </label>
                            <input
                              {...commonProps}
                              type={
                                field.type === "number"
                                  ? "number"
                                  : field.type === "date"
                                    ? "date"
                                    : "text"
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {canOverrideQuoteMeta && (
                  <div className={`${SECTION_GLASS} p-4`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-sky-950 dark:text-sky-100">
                          Ajustes administrativos
                        </p>
                        <p className="text-xs text-sky-900/75 dark:text-sky-100/70">
                          Por defecto se usa tu usuario y la fecha actual.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={CHIP}
                        onClick={() => setShowMetaOverrides((prev) => !prev)}
                        aria-pressed={showMetaOverrides}
                      >
                        {showMetaOverrides
                          ? "Ocultar modificación"
                          : "Modificar vendedor y/o fecha de creación"}
                      </button>
                    </div>

                    {showMetaOverrides && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs opacity-75">
                            Vendedor responsable
                          </label>
                          <select
                            className={SELECT}
                            value={form.id_user || profile?.id_user || ""}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                id_user: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              }))
                            }
                          >
                            <option value="">Seleccionar</option>
                            {users.map((u) => (
                              <option key={u.id_user} value={u.id_user}>
                                {`${u.first_name || ""} ${u.last_name || ""}`.trim() ||
                                  u.email ||
                                  `Usuario ${u.id_user}`}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs opacity-75">
                            Fecha de creación
                          </label>
                          <input
                            type="date"
                            className={INPUT}
                            value={form.creation_date}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                creation_date: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={BTN}
                    onClick={() => void saveQuote("stay")}
                    disabled={saving}
                  >
                    {saving
                      ? "Guardando..."
                      : formMode === "edit"
                        ? "Guardar cambios"
                        : "Crear cotización"}
                  </button>
                  <button
                    type="button"
                    className={SUBTLE_BTN}
                    onClick={() => void saveQuote("open_studio")}
                    disabled={saving}
                  >
                    Guardar y abrir estudio
                  </button>
                  {formMode === "edit" && (
                    <button
                      type="button"
                      className={SUBTLE_BTN}
                      onClick={startCreate}
                    >
                      Nueva cotización
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className={workspaceView === "list" ? "space-y-4" : "hidden"}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-sky-950 dark:text-sky-50">
                  Listado
                </h2>
                <p className="text-xs text-sky-900/75 dark:text-sky-100/70">
                  Vistas: grilla, card y tabla.
                </p>
                <div className="flex gap-1">
                  <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-sky-300/35 bg-white/55 p-1 text-xs shadow-sm shadow-sky-950/10 dark:border-sky-200/25 dark:bg-sky-950/25">
                    {(
                      [
                        ["active", "Activas"],
                        ["converted", "Convertidas"],
                        ["all", "Todas"],
                      ] as Array<[QuoteStatusScope, string]>
                    ).map(([scope, label]) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => setStatusScope(scope)}
                        className={`rounded-full px-3 py-1 transition ${
                          statusScope === scope
                            ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200"
                            : "text-sky-900/75 hover:text-sky-900 dark:text-sky-100"
                        }`}
                        aria-pressed={statusScope === scope}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {(canSeeTeamQuotes || canSeeAgencyQuotes) && (
                    <>
                      <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-sky-300/35 bg-white/55 p-1 text-xs shadow-sm shadow-sky-950/10 dark:border-sky-200/25 dark:bg-sky-950/25">
                        {(
                          [
                            ["mine", "Mis cotizaciones"],
                            ...(canSeeTeamQuotes
                              ? ([["team", "Equipo"]] as Array<
                                  [QuoteListScope, string]
                                >)
                              : []),
                            ...(canSeeAgencyQuotes
                              ? ([["agency", "Agencia"]] as Array<
                                  [QuoteListScope, string]
                                >)
                              : []),
                          ] as Array<[QuoteListScope, string]>
                        ).map(([scope, label]) => (
                          <button
                            key={scope}
                            type="button"
                            onClick={() => setListScope(scope)}
                            className={`rounded-full px-3 py-1 transition ${
                              listScope === scope
                                ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-200"
                                : "text-sky-900/75 hover:text-sky-900 dark:text-sky-100"
                            }`}
                            aria-pressed={listScope === scope}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-sky-900/70 dark:text-sky-100/65">
                  {showsAgencyCounter
                    ? "Vista de gestión: numeración interna de agencia."
                    : "Vista normal: numeración interna por vendedor."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canConfigure && (
                  <Link href="/quotes/config" className={SUBTLE_BTN}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="size-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                      />
                    </svg>
                  </Link>
                )}
                <button
                  type="button"
                  className={SUBTLE_BTN}
                  onClick={() => void loadQuotes()}
                  disabled={loading}
                >
                  <span className="flex items-center justify-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.8}
                      stroke="currentColor"
                      className={`size-5 ${loading ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                      />
                    </svg>
                  </span>
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="relative">
                <input
                  className={`${INPUT} pr-12`}
                  placeholder="Buscar por número, cliente, teléfono o email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-sky-700/70 dark:text-sky-100/60">
                  Nº {visibleQuotesCount}
                </span>
              </div>
              <button
                type="button"
                className={hasActiveFilters ? AMBER_BTN : SUBTLE_BTN}
                onClick={() => setFiltersOpen((prev) => !prev)}
              >
                {filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}
              </button>
            </div>

            <div className="relative flex items-center gap-1 rounded-full border border-sky-300/35 bg-white/55 p-1 text-xs shadow-sm shadow-sky-950/10 dark:border-sky-200/25 dark:bg-sky-950/25">
              <button
                type="button"
                onClick={() => setListView("grid")}
                className={`relative flex items-center justify-center gap-1 overflow-hidden rounded-full px-4 py-1.5 text-sm transition-[color,transform,opacity] duration-300 ease-out hover:scale-[0.99] hover:opacity-95 active:scale-[0.97] active:opacity-90 ${
                  listView === "grid"
                    ? "text-sky-800 dark:text-sky-200"
                    : "text-sky-900/75 hover:text-sky-900 dark:text-sky-100"
                }`}
                aria-pressed={listView === "grid"}
              >
                {listView === "grid" && (
                  <motion.span
                    layoutId="quotes-list-view-toggle-pill"
                    className="absolute inset-0 z-0 rounded-full bg-sky-500/15 shadow-sm shadow-sky-900/20"
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
                    />
                  </svg>
                  Grilla
                </span>
              </button>
              <button
                type="button"
                onClick={() => setListView("card")}
                className={`relative flex items-center justify-center gap-1 overflow-hidden rounded-full px-4 py-1.5 text-sm transition-[color,transform,opacity] duration-300 ease-out hover:scale-[0.99] hover:opacity-95 active:scale-[0.97] active:opacity-90 ${
                  listView === "card"
                    ? "text-sky-800 dark:text-sky-200"
                    : "text-sky-900/75 hover:text-sky-900 dark:text-sky-100"
                }`}
                aria-pressed={listView === "card"}
              >
                {listView === "card" && (
                  <motion.span
                    layoutId="quotes-list-view-toggle-pill"
                    className="absolute inset-0 z-0 rounded-full bg-sky-500/15 shadow-sm shadow-sky-900/20"
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                    />
                  </svg>
                  Card
                </span>
              </button>
              <button
                type="button"
                onClick={() => setListView("table")}
                className={`relative flex items-center justify-center gap-1 overflow-hidden rounded-full px-4 py-1.5 text-sm transition-[color,transform,opacity] duration-300 ease-out hover:scale-[0.99] hover:opacity-95 active:scale-[0.97] active:opacity-90 ${
                  listView === "table"
                    ? "text-sky-800 dark:text-sky-200"
                    : "text-sky-900/75 hover:text-sky-900 dark:text-sky-100"
                }`}
                aria-pressed={listView === "table"}
              >
                {listView === "table" && (
                  <motion.span
                    layoutId="quotes-list-view-toggle-pill"
                    className="absolute inset-0 z-0 rounded-full bg-sky-500/15 shadow-sm shadow-sky-900/20"
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 5.25h16.5M3.75 9.75h16.5M3.75 14.25h16.5M3.75 18.75h16.5"
                    />
                  </svg>
                  Tabla
                </span>
              </button>
            </div>

            <AnimatePresence initial={false}>
              {filtersOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className={`${SECTION_GLASS} space-y-3 p-3`}
                >
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs opacity-75">
                        Responsable
                      </label>
                      <select
                        className={SELECT}
                        value={ownerFilter}
                        onChange={(e) => setOwnerFilter(e.target.value)}
                      >
                        <option value="all">Todos</option>
                        {ownerOptions.map((owner) => (
                          <option key={owner.id_user} value={owner.id_user}>
                            {owner.label || `Usuario ${owner.id_user}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs opacity-75">
                        Orden
                      </label>
                      <select
                        className={SELECT}
                        value={sortBy}
                        onChange={(e) =>
                          setSortBy(
                            e.target.value as
                              | "updated_desc"
                              | "updated_asc"
                              | "created_desc"
                              | "created_asc"
                              | "quote_desc"
                              | "quote_asc",
                          )
                        }
                      >
                        <option value="updated_desc">
                          Actualizadas (nuevas primero)
                        </option>
                        <option value="updated_asc">
                          Actualizadas (viejas primero)
                        </option>
                        <option value="created_desc">
                          Creadas (nuevas primero)
                        </option>
                        <option value="created_asc">
                          Creadas (viejas primero)
                        </option>
                        <option value="quote_desc">Número mayor a menor</option>
                        <option value="quote_asc">Número menor a mayor</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs opacity-75">
                        Creada desde
                      </label>
                      <input
                        type="date"
                        className={INPUT}
                        placeholder="Seleccionar fecha"
                        value={createdFrom}
                        onChange={(e) => setCreatedFrom(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs opacity-75">
                        Creada hasta
                      </label>
                      <input
                        type="date"
                        className={INPUT}
                        placeholder="Seleccionar fecha"
                        value={createdTo}
                        onChange={(e) => setCreatedTo(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs opacity-75">
                        Pax
                      </label>
                      <select
                        className={SELECT}
                        value={paxFilter}
                        onChange={(e) =>
                          setPaxFilter(e.target.value as PresenceFilter)
                        }
                      >
                        <option value="all">Todos</option>
                        <option value="with">Con pax</option>
                        <option value="without">Sin pax</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs opacity-75">
                        Servicios
                      </label>
                      <select
                        className={SELECT}
                        value={serviceFilter}
                        onChange={(e) =>
                          setServiceFilter(e.target.value as PresenceFilter)
                        }
                      >
                        <option value="all">Todos</option>
                        <option value="with">Con servicios</option>
                        <option value="without">Sin servicios</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      className={SUBTLE_BTN}
                      onClick={clearFilters}
                    >
                      Limpiar filtros
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {filteredQuotes.length === 0 ? (
              <div className="rounded-2xl border border-sky-300/35 bg-white/50 p-4 text-sm text-sky-900/80 dark:border-sky-200/20 dark:bg-sky-950/20 dark:text-sky-100/80">
                No hay cotizaciones para mostrar con estos filtros.
              </div>
            ) : listView === "table" ? (
              <div className="overflow-hidden rounded-2xl border border-sky-300/35 bg-white/55 shadow-sm shadow-sky-950/10 dark:border-sky-200/20 dark:bg-sky-950/20">
                <div className="max-h-[72vh] overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-sky-100/80 text-sky-900 dark:bg-sky-900/45 dark:text-sky-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">
                          Nº
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          Cliente
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          Responsable
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          Creación
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          Pax
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          Servicios
                        </th>
                        <th className="px-3 py-2 text-left font-semibold">
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredQuotes.map((row) => {
                        const q = row.quote;
                        const isConverted = q.quote_status === "converted";
                        const isExpanded = expandedQuoteId === q.id_quote;
                        const quoteTemplateId = q.public_id ?? q.id_quote;
                        return (
                          <Fragment key={q.id_quote}>
                            <tr
                              className="cursor-pointer border-t border-sky-300/25 text-sky-950 transition hover:bg-sky-100/55 dark:border-sky-200/15 dark:text-sky-50 dark:hover:bg-sky-800/25"
                              onClick={() => toggleExpandedQuote(q.id_quote)}
                            >
                              <td className="px-3 py-2 font-semibold">
                                {row.displayId}
                              </td>
                              <td className="px-3 py-2">
                                <p className="font-semibold">
                                  {q.lead_name || "Cliente sin nombre"}
                                </p>
                                <p className="text-xs opacity-75">
                                  {q.lead_phone || "Sin teléfono"}
                                </p>
                                {isConverted ? (
                                  <p className="mt-1 inline-flex w-max rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                                    Convertida
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">{row.ownerName}</td>
                              <td className="px-3 py-2">
                                {formatDate(q.creation_date)}
                              </td>
                              <td className="px-3 py-2">{row.paxCount}</td>
                              <td className="px-3 py-2">{row.serviceCount}</td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap gap-1">
                                  <button
                                    type="button"
                                    className="rounded-full border border-sky-500/45 bg-sky-300/25 px-3 py-1 text-xs font-medium text-sky-900 transition hover:bg-sky-300/35 dark:text-sky-50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEdit(q);
                                    }}
                                  >
                                    Editar
                                  </button>
                                  <Link
                                    href={`/quotes/${encodeURIComponent(String(quoteTemplateId))}/template`}
                                    className="rounded-full border border-emerald-500/45 bg-emerald-300/25 px-3 py-1 text-xs font-medium text-emerald-900 transition hover:bg-emerald-300/35 dark:text-emerald-50"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Abrir estudio
                                  </Link>
                                  {!isConverted && (
                                    <button
                                      type="button"
                                      className="rounded-full border border-amber-500/45 bg-amber-300/25 px-3 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-300/35 dark:text-amber-50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openConvert(q);
                                      }}
                                    >
                                      Convertir
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="border-t border-sky-300/25 bg-sky-100/40 dark:border-sky-200/15 dark:bg-sky-900/20">
                                <td colSpan={7} className="p-3">
                                  <div className="grid gap-2 text-xs text-sky-900/90 dark:text-sky-100/85">
                                    {showsAgencyCounter ? (
                                      <p>
                                        <span className="font-semibold">
                                          Correlativos:
                                        </span>{" "}
                                        Usuario Nº {row.userDisplayId} · Agencia
                                        Nº {row.agencyDisplayId} · DB #
                                        {row.dbDisplayId}
                                      </p>
                                    ) : (
                                      <p>
                                        <span className="font-semibold">
                                          Correlativo:
                                        </span>{" "}
                                        Usuario Nº {row.userDisplayId}
                                      </p>
                                    )}
                                    <p>
                                      <span className="font-semibold">
                                        Detalle:
                                      </span>{" "}
                                      {row.bookingDraft.details ||
                                        "Sin detalle"}
                                    </p>
                                    <p>
                                      <span className="font-semibold">
                                        Email:
                                      </span>{" "}
                                      {q.lead_email || "Sin email"}
                                    </p>
                                    <p>
                                      <span className="font-semibold">
                                        Salida/Regreso:
                                      </span>{" "}
                                      {formatDate(
                                        row.bookingDraft.departure_date || "",
                                      )}{" "}
                                      /{" "}
                                      {formatDate(
                                        row.bookingDraft.return_date || "",
                                      )}
                                    </p>
                                    {q.quote_status === "converted" ? (
                                      <p>
                                        <span className="font-semibold">
                                          Estado:
                                        </span>{" "}
                                        Convertida
                                        {q.converted_at
                                          ? ` el ${formatDate(q.converted_at)}`
                                          : ""}
                                      </p>
                                    ) : null}
                                    <div>
                                      <button
                                        type="button"
                                        className={`${DANGER_BTN} px-3 py-1 text-xs`}
                                        onClick={() => deleteQuote(q)}
                                      >
                                        Eliminar
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div
                className={
                  listView === "grid"
                    ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                    : "flex min-w-full flex-col items-start gap-3 overflow-x-auto pb-1"
                }
              >
                {filteredQuotes.map((row, idx) => {
                  const q = row.quote;
                  const isConverted = q.quote_status === "converted";
                  const isExpanded = expandedQuoteId === q.id_quote;
                  const quoteTemplateId = q.public_id ?? q.id_quote;
                  return (
                    <motion.article
                      key={q.id_quote}
                      ref={(el) => {
                        if (el) cardShellRefs.current.set(q.id_quote, el);
                        else cardShellRefs.current.delete(q.id_quote);
                      }}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.18,
                        delay: idx * 0.02,
                        layout: {
                          type: "spring",
                          stiffness: 220,
                          damping: 28,
                        },
                      }}
                      className={`overflow-hidden rounded-2xl border border-sky-300/35 bg-white/60 p-3 shadow-sm shadow-sky-950/10 backdrop-blur-xl dark:border-sky-200/20 dark:bg-sky-950/25 ${
                        listView === "grid"
                          ? "w-full"
                          : "inline-flex w-max min-w-full flex-col items-start"
                      }`}
                    >
                      <div className="mb-2 flex w-full flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-sky-800/75 dark:text-sky-100/70">
                            {showsAgencyCounter
                              ? "Cotización agencia Nº"
                              : "Cotización Nº"}{" "}
                            {row.displayId}
                          </p>
                          <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-50">
                            {q.lead_name || "Cliente sin nombre"}
                          </h3>
                          {isConverted ? (
                            <span className="mt-1 inline-flex rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-200">
                              Convertida
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs text-sky-900/75 dark:text-sky-100/70">
                          {formatDate(q.creation_date)}
                        </span>
                      </div>

                      <div className="w-full space-y-1 text-xs text-sky-900/85 dark:text-sky-100/80">
                        <p>{q.lead_phone || "Sin teléfono"}</p>
                        <p>{q.lead_email || "Sin email"}</p>
                        <p>{row.ownerName}</p>
                        <p>
                          Pax: {row.paxCount} · Servicios: {row.serviceCount}
                        </p>
                      </div>

                      <div
                        ref={(el) => {
                          if (el) cardActionRowRefs.current.set(q.id_quote, el);
                          else cardActionRowRefs.current.delete(q.id_quote);
                        }}
                        className="mt-3 inline-flex flex-nowrap items-center gap-2 self-start"
                      >
                        <ActionIconButton
                          type="button"
                          tone="sky"
                          onClick={() => startEdit(q)}
                          label="Editar"
                          aria-label="Editar cotización"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="size-5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.4}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                            />
                          </svg>
                        </ActionIconButton>
                        {!isConverted && (
                          <ActionIconButton
                            type="button"
                            tone="amber"
                            onClick={() => openConvert(q)}
                            label="Convertir"
                            aria-label="Convertir cotización"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="size-5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.4}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M8.25 4.5 3.75 9m0 0 4.5 4.5M3.75 9h10.5a4.5 4.5 0 0 1 0 9h-1.5"
                              />
                            </svg>
                          </ActionIconButton>
                        )}
                        <ActionIconButton
                          type="button"
                          tone="neutral"
                          onClick={() => toggleExpandedQuote(q.id_quote)}
                          label={isExpanded ? "Ocultar detalle" : "Ver detalle"}
                          aria-label={
                            isExpanded ? "Ocultar detalle" : "Ver detalle"
                          }
                        >
                          {isExpanded ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="size-5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.4}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m3 3 18 18M10.477 10.476a3 3 0 0 0 4.047 4.048M9.88 5.091A10.477 10.477 0 0 1 12 4.875c4.478 0 8.268 2.943 9.542 7.003a9.659 9.659 0 0 1-1.318 2.473M6.228 6.228A9.649 9.649 0 0 0 2.458 11.878C3.732 15.938 7.522 18.88 12 18.88c1.57 0 3.06-.362 4.386-1.007"
                              />
                            </svg>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="size-5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.4}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M2.458 12C3.732 7.94 7.523 5 12 5c4.478 0 8.268 2.94 9.542 7-1.274 4.06-5.064 7-9.542 7-4.477 0-8.268-2.94-9.542-7Z"
                              />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </ActionIconButton>
                        <Link
                          href={`/quotes/${encodeURIComponent(String(quoteTemplateId))}/template`}
                          className={ACTION_TONE_CLASS.neutral}
                          aria-label="Abrir estudio de cotización"
                        >
                          <span className={ACTION_TRACK}>
                            <span className={ACTION_TEXT_HOVER}>
                              Abrir estudio
                            </span>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="size-5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.4}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 16.5v-9m0 9-3-3m3 3 3-3M4.5 18.75A2.25 2.25 0 0 0 6.75 21h10.5a2.25 2.25 0 0 0 2.25-2.25"
                              />
                            </svg>
                          </span>
                        </Link>
                        <ActionIconButton
                          type="button"
                          tone="rose"
                          onClick={() => deleteQuote(q)}
                          label="Eliminar"
                          aria-label="Eliminar cotización"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="size-5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.4}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </svg>
                        </ActionIconButton>
                      </div>

                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 grid gap-2 rounded-2xl border border-amber-300/35 bg-gradient-to-br from-amber-100/35 via-amber-100/20 to-emerald-100/35 p-3 text-xs text-amber-900 dark:border-amber-200/30 dark:from-amber-900/25 dark:via-amber-900/15 dark:to-emerald-900/25 dark:text-amber-100">
                              {showsAgencyCounter ? (
                                <p>
                                  <span className="font-semibold">
                                    Correlativos:
                                  </span>{" "}
                                  Usuario Nº {row.userDisplayId} · Agencia Nº{" "}
                                  {row.agencyDisplayId} · DB #{row.dbDisplayId}
                                </p>
                              ) : (
                                <p>
                                  <span className="font-semibold">
                                    Correlativo:
                                  </span>{" "}
                                  Usuario Nº {row.userDisplayId}
                                </p>
                              )}
                              <p>
                                <span className="font-semibold">Detalle:</span>{" "}
                                {row.bookingDraft.details || "Sin detalle"}
                              </p>
                              <p>
                                <span className="font-semibold">Salida:</span>{" "}
                                {formatDate(
                                  row.bookingDraft.departure_date || "",
                                )}
                              </p>
                              <p>
                                <span className="font-semibold">Regreso:</span>{" "}
                                {formatDate(row.bookingDraft.return_date || "")}
                              </p>
                              <p>
                                <span className="font-semibold">Moneda:</span>{" "}
                                {row.bookingDraft.currency || "Sin moneda"}
                              </p>
                              {q.quote_status === "converted" ? (
                                <p>
                                  <span className="font-semibold">Estado:</span>{" "}
                                  Convertida
                                  {q.converted_at
                                    ? ` el ${formatDate(q.converted_at)}`
                                    : ""}
                                </p>
                              ) : null}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {convertQuote && convertForm && (
          <div className={workspaceView === "form" ? "space-y-4" : "hidden"}>
            <div className={`${SECTION_GLASS} max-h-[92vh] w-full overflow-auto p-4`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-sky-950 dark:text-sky-50">
                    Convertir cotización Nº{" "}
                    {showsAgencyCounter
                      ? getQuoteAgencyNumber(convertQuote)
                      : getQuoteUserNumber(convertQuote)}
                  </h2>
                  <p className="text-xs text-sky-900/75 dark:text-sky-100/70">
                    Completá los datos y confirmá para moverla a Convertidas.
                  </p>
                </div>
                <button
                  type="button"
                  className={SUBTLE_BTN}
                  onClick={closeConvert}
                >
                  Volver al formulario
                </button>
              </div>

              <div className="space-y-4">
                <SectionCard
                  id="booking"
                  title="Datos base de reserva"
                  subtitle="Información obligatoria para confirmar la conversión"
                  open={Boolean(convertSections.booking)}
                  onToggle={toggleConvertSection}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    {canAssignOwner && (
                      <div>
                        <label className={convertLabelClass()}>
                          Vendedor
                        </label>
                        <select
                          className={convertInputClass("booking.id_user", SELECT)}
                          value={convertForm.booking.id_user || ""}
                          onChange={(e) =>
                            setConvertForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    booking: {
                                      ...prev.booking,
                                      id_user: e.target.value
                                        ? Number(e.target.value)
                                        : null,
                                    },
                                  }
                                : prev,
                            )
                          }
                        >
                          <option value="">Seleccionar vendedor</option>
                          {users.map((u) => (
                            <option key={u.id_user} value={u.id_user}>
                              {`${u.first_name || ""} ${u.last_name || ""}`.trim() ||
                                u.email ||
                                `Usuario ${u.id_user}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className={convertLabelClass("booking.clientStatus")}>
                        Estado cliente
                        <RequiredMark />
                      </label>
                      <input
                        className={convertInputClass("booking.clientStatus", INPUT)}
                        placeholder="Estado cliente"
                        value={convertForm.booking.clientStatus}
                        required
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    clientStatus: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className={convertLabelClass("booking.operatorStatus")}>
                        Estado operador
                        <RequiredMark />
                      </label>
                      <input
                        className={convertInputClass("booking.operatorStatus", INPUT)}
                        placeholder="Estado operador"
                        value={convertForm.booking.operatorStatus}
                        required
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    operatorStatus: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className={convertLabelClass("booking.status")}>
                        Estado reserva
                        <RequiredMark />
                      </label>
                      <input
                        className={convertInputClass("booking.status", INPUT)}
                        placeholder="Estado reserva"
                        value={convertForm.booking.status}
                        required
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    status: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className={convertLabelClass("booking.invoice_type")}>
                        Tipo de factura
                        <RequiredMark />
                      </label>
                      <input
                        className={convertInputClass("booking.invoice_type", INPUT)}
                        placeholder="Tipo de factura"
                        value={convertForm.booking.invoice_type}
                        required
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    invoice_type: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className={convertLabelClass("booking.departure_date")}>
                        Salida
                        <RequiredMark />
                      </label>
                      <input
                        type="date"
                        className={convertInputClass("booking.departure_date", INPUT)}
                        placeholder="Seleccionar fecha"
                        value={convertForm.booking.departure_date}
                        required
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    departure_date: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className={convertLabelClass("booking.return_date")}>
                        Regreso
                        <RequiredMark />
                      </label>
                      <input
                        type="date"
                        className={convertInputClass("booking.return_date", INPUT)}
                        placeholder="Seleccionar fecha"
                        value={convertForm.booking.return_date}
                        required
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    return_date: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={convertLabelClass("booking.details")}>
                        Detalle
                        <RequiredMark />
                      </label>
                      <textarea
                        className={`${convertInputClass("booking.details", INPUT)} min-h-16`}
                        placeholder="Detalle"
                        value={convertForm.booking.details}
                        required
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    details: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={convertLabelClass()}>
                        Observación factura
                      </label>
                      <input
                        className={convertInputClass("booking.invoice_observation", INPUT)}
                        placeholder="Observación factura"
                        value={convertForm.booking.invoice_observation}
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    invoice_observation: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={convertLabelClass()}>
                        Observación interna
                      </label>
                      <input
                        className={convertInputClass("booking.observation", INPUT)}
                        placeholder="Observación interna"
                        value={convertForm.booking.observation}
                        onChange={(e) =>
                          setConvertForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  booking: {
                                    ...prev.booking,
                                    observation: e.target.value,
                                  },
                                }
                              : prev,
                          )
                        }
                      />
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  id="titular"
                  title="Titular"
                  subtitle="Elegí pax existente o cargalo manualmente"
                  open={Boolean(convertSections.titular)}
                  onToggle={toggleConvertSection}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1 md:col-span-2">
                      <label className={convertLabelClass()}>
                        Tipo de carga
                      </label>
                      <div className={MINI_TOGGLE_GROUP}>
                        <button
                          type="button"
                          className={miniToggleOptionClass(
                            convertForm.titular.mode === "new",
                          )}
                          onClick={() =>
                            updateConvertPassenger("titular", 0, {
                              mode: "new",
                              client_id: null,
                            })
                          }
                        >
                          Pax nuevo
                        </button>
                        <button
                          type="button"
                          className={miniToggleOptionClass(
                            convertForm.titular.mode === "existing",
                          )}
                          onClick={() =>
                            updateConvertPassenger("titular", 0, {
                              mode: "existing",
                              client_id: convertForm.titular.client_id,
                            })
                          }
                        >
                          Pax existente
                        </button>
                      </div>
                    </div>

                    {convertForm.titular.mode === "existing" ? (
                      <div className="space-y-1 md:col-span-2">
                        <label className={convertLabelClass("titular.client_id")}>
                          Titular existente
                          <RequiredMark />
                        </label>
                        <ClientPicker
                          token={token}
                          valueId={convertForm.titular.client_id ?? null}
                          placeholder="Buscar titular existente..."
                          excludeIds={convertForm.companions
                            .map((companion) =>
                              companion.mode === "existing" &&
                              typeof companion.client_id === "number"
                                ? companion.client_id
                                : null,
                            )
                            .filter(
                              (id): id is number => typeof id === "number",
                            )}
                          onSelect={(client) =>
                            updateConvertPassenger("titular", 0, {
                              mode: "existing",
                              client_id: client.id_client,
                              first_name: client.first_name || "",
                              last_name: client.last_name || "",
                              phone: client.phone || "",
                              email: client.email || "",
                              birth_date: client.birth_date || "",
                              nationality: client.nationality || "",
                              gender: client.gender || "",
                            })
                          }
                          onClear={() =>
                            updateConvertPassenger("titular", 0, {
                              client_id: null,
                              first_name: "",
                              last_name: "",
                              phone: "",
                              email: "",
                              birth_date: "",
                              nationality: "",
                              gender: "",
                            })
                          }
                        />
                        {isConvertInvalid("titular.client_id") ? (
                          <p className="text-xs text-rose-700 dark:text-rose-300">
                            Seleccioná un titular existente o cambiá a
                            {" "}
                            &quot;Pax nuevo&quot;.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <div className="rounded-2xl border border-rose-300/50 bg-rose-100/45 p-2 text-xs text-rose-800 dark:border-rose-300/40 dark:bg-rose-900/20 dark:text-rose-100 md:col-span-2">
                          <p className="font-medium">
                            Campos obligatorios del titular:
                          </p>
                          <p>
                            {passengerRequiredLabels(convertForm.titular).join(
                              " · ",
                            ) || "Sin obligatorios"}
                          </p>
                        </div>
                        {convertProfileOptions.length > 1 && (
                          <div>
                            <label className={convertLabelClass()}>
                              Perfil
                            </label>
                            <select
                              className={convertInputClass("titular.profile_key", SELECT)}
                              value={convertForm.titular.profile_key}
                              onChange={(e) =>
                                updateConvertPassenger("titular", 0, {
                                  profile_key: e.target.value,
                                })
                              }
                            >
                              {convertProfileOptions.map((opt) => (
                                <option key={opt.key} value={opt.key}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <input
                          className={convertInputClass("titular.first_name", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(convertForm.titular, "first_name")
                              ? "Nombre *"
                              : "Nombre"
                          }
                          value={convertForm.titular.first_name}
                          required={isPassengerFieldRequired(convertForm.titular, "first_name")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              first_name: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.last_name", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(convertForm.titular, "last_name")
                              ? "Apellido *"
                              : "Apellido"
                          }
                          value={convertForm.titular.last_name}
                          required={isPassengerFieldRequired(convertForm.titular, "last_name")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              last_name: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.phone", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(convertForm.titular, "phone")
                              ? "Teléfono *"
                              : "Teléfono"
                          }
                          value={convertForm.titular.phone}
                          required={isPassengerFieldRequired(convertForm.titular, "phone")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              phone: e.target.value,
                            })
                          }
                        />
                        <input
                          type="date"
                          className={convertInputClass("titular.birth_date", INPUT)}
                          placeholder="Seleccionar fecha"
                          value={convertForm.titular.birth_date}
                          required={isPassengerFieldRequired(convertForm.titular, "birth_date")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              birth_date: e.target.value,
                            })
                          }
                        />
                        <div className="space-y-1">
                          <label className={convertLabelClass("titular.nationality")}>
                            Nacionalidad
                            {isPassengerFieldRequired(
                              convertForm.titular,
                              "nationality",
                            ) ? <RequiredMark /> : null}
                          </label>
                          <DestinationPicker
                            type="country"
                            multiple={false}
                            value={null}
                            onChange={(value) =>
                              updateConvertPassenger("titular", 0, {
                                nationality: destinationValueToLabel(value),
                              })
                            }
                            placeholder="Nacionalidad"
                            includeDisabled={true}
                            className="relative z-30 [&>label]:hidden"
                          />
                          {convertForm.titular.nationality ? (
                            <p className="text-xs text-sky-900/70 dark:text-sky-100/70">
                              Guardará: <b>{convertForm.titular.nationality}</b>
                            </p>
                          ) : null}
                          {isConvertInvalid("titular.nationality") ? (
                            <p className="text-xs text-rose-700 dark:text-rose-300">
                              Seleccioná una nacionalidad para el titular.
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <label className={convertLabelClass("titular.gender")}>
                            Género
                            {isPassengerFieldRequired(convertForm.titular, "gender") ? (
                              <RequiredMark />
                            ) : null}
                          </label>
                          <select
                            className={convertInputClass("titular.gender", SELECT)}
                            value={convertForm.titular.gender}
                            required={isPassengerFieldRequired(convertForm.titular, "gender")}
                            onChange={(e) =>
                              updateConvertPassenger("titular", 0, {
                                gender: e.target.value,
                              })
                            }
                          >
                            <option value="">Género</option>
                            <option value="Masculino">Masculino</option>
                            <option value="Femenino">Femenino</option>
                            <option value="Otro">Otro</option>
                            <option value="Prefiere no decir">
                              Prefiere no decir
                            </option>
                          </select>
                        </div>
                        <input
                          className={convertInputClass("titular.email", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(convertForm.titular, "email")
                              ? "Email *"
                              : "Email"
                          }
                          value={convertForm.titular.email}
                          required={isPassengerFieldRequired(convertForm.titular, "email")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              email: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.dni_number", INPUT)}
                          placeholder={
                            isPassengerDocumentRequired(convertForm.titular) ||
                            isPassengerFieldRequired(convertForm.titular, "dni_number")
                              ? "DNI *"
                              : "DNI"
                          }
                          value={convertForm.titular.dni_number}
                          required={
                            isPassengerDocumentRequired(convertForm.titular) ||
                            isPassengerFieldRequired(convertForm.titular, "dni_number")
                          }
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              dni_number: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.passport_number", INPUT)}
                          placeholder={
                            isPassengerDocumentRequired(convertForm.titular) ||
                            isPassengerFieldRequired(convertForm.titular, "passport_number")
                              ? "Pasaporte *"
                              : "Pasaporte"
                          }
                          value={convertForm.titular.passport_number}
                          required={
                            isPassengerDocumentRequired(convertForm.titular) ||
                            isPassengerFieldRequired(convertForm.titular, "passport_number")
                          }
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              passport_number: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.tax_id", INPUT)}
                          placeholder={
                            isPassengerDocumentRequired(convertForm.titular) ||
                            isPassengerFieldRequired(convertForm.titular, "tax_id")
                              ? "CUIT / RUT *"
                              : "CUIT / RUT"
                          }
                          value={convertForm.titular.tax_id}
                          required={
                            isPassengerDocumentRequired(convertForm.titular) ||
                            isPassengerFieldRequired(convertForm.titular, "tax_id")
                          }
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              tax_id: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.company_name", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(convertForm.titular, "company_name")
                              ? "Razón social *"
                              : "Razón social"
                          }
                          value={convertForm.titular.company_name}
                          required={isPassengerFieldRequired(convertForm.titular, "company_name")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              company_name: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.commercial_address", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(
                              convertForm.titular,
                              "commercial_address",
                            )
                              ? "Domicilio comercial *"
                              : "Domicilio comercial"
                          }
                          value={convertForm.titular.commercial_address}
                          required={isPassengerFieldRequired(
                            convertForm.titular,
                            "commercial_address",
                          )}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              commercial_address: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.address", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(convertForm.titular, "address")
                              ? "Dirección *"
                              : "Dirección"
                          }
                          value={convertForm.titular.address}
                          required={isPassengerFieldRequired(convertForm.titular, "address")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              address: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.locality", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(convertForm.titular, "locality")
                              ? "Localidad *"
                              : "Localidad"
                          }
                          value={convertForm.titular.locality}
                          required={isPassengerFieldRequired(convertForm.titular, "locality")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              locality: e.target.value,
                            })
                          }
                        />
                        <input
                          className={convertInputClass("titular.postal_code", INPUT)}
                          placeholder={
                            isPassengerFieldRequired(convertForm.titular, "postal_code")
                              ? "Código postal *"
                              : "Código postal"
                          }
                          value={convertForm.titular.postal_code}
                          required={isPassengerFieldRequired(convertForm.titular, "postal_code")}
                          onChange={(e) =>
                            updateConvertPassenger("titular", 0, {
                              postal_code: e.target.value,
                            })
                          }
                        />
                      </>
                    )}
                  </div>
                </SectionCard>

                <SectionCard
                  id="companions"
                  title="Acompañantes"
                  subtitle="Pasajeros adicionales para la reserva"
                  open={Boolean(convertSections.companions)}
                  onToggle={toggleConvertSection}
                  right={
                    <button
                      type="button"
                      className={AMBER_BTN}
                      onClick={(e) => {
                        e.stopPropagation();
                        addConvertCompanion();
                      }}
                    >
                      Agregar pax
                    </button>
                  }
                >

                  {isConvertInvalid("companions.count") ? (
                    <p className="mb-3 text-xs font-medium text-rose-700 dark:text-rose-300">
                      Faltan acompañantes para respetar la cantidad original de pax
                      en la cotización.
                    </p>
                  ) : null}

                  {convertForm.companions.length === 0 ? (
                    <p className="text-xs text-sky-900/75 dark:text-sky-100/70">
                      Sin acompañantes.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {convertForm.companions.map((p, idx) => (
                        <div
                          key={`comp-${idx}`}
                          className="rounded-2xl border border-sky-300/30 bg-white/55 p-3 dark:border-sky-200/20 dark:bg-sky-950/20"
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-xs uppercase tracking-[0.16em] text-sky-800/70 dark:text-sky-100/70">
                                Acompañante #{idx + 1}
                              </p>
                              <div className={`mt-1 ${MINI_TOGGLE_GROUP}`}>
                                <button
                                  type="button"
                                  className={miniToggleOptionClass(
                                    p.mode === "new",
                                  )}
                                  onClick={() =>
                                    updateConvertPassenger("companions", idx, {
                                      mode: "new",
                                      client_id: null,
                                    })
                                  }
                                >
                                  Pax nuevo
                                </button>
                                <button
                                  type="button"
                                  className={miniToggleOptionClass(
                                    p.mode === "existing",
                                  )}
                                  onClick={() =>
                                    updateConvertPassenger("companions", idx, {
                                      mode: "existing",
                                      client_id: p.client_id,
                                    })
                                  }
                                >
                                  Pax existente
                                </button>
                              </div>
                            </div>
                            <button
                              type="button"
                              className={DANGER_ICON_BTN}
                              onClick={() => removeConvertCompanion(idx)}
                              aria-label="Quitar acompañante"
                              title="Quitar acompañante"
                            >
                              <TrashIcon />
                            </button>
                          </div>

                          {p.mode === "existing" ? (
                            <div className="space-y-1">
                              <label
                                className={convertLabelClass(
                                  `companions.${idx}.client_id`,
                                )}
                              >
                                Acompañante existente
                                <RequiredMark />
                              </label>
                              <ClientPicker
                                token={token}
                                valueId={p.client_id ?? null}
                                placeholder="Buscar acompañante existente..."
                                excludeIds={[
                                  ...(convertForm.titular.mode === "existing" &&
                                  typeof convertForm.titular.client_id ===
                                    "number"
                                    ? [convertForm.titular.client_id]
                                    : []),
                                  ...convertForm.companions
                                    .map((companion, companionIdx) =>
                                      companionIdx !== idx &&
                                      companion.mode === "existing" &&
                                      typeof companion.client_id === "number"
                                        ? companion.client_id
                                        : null,
                                    )
                                    .filter(
                                      (id): id is number =>
                                        typeof id === "number",
                                    ),
                                ]}
                                onSelect={(client) =>
                                  updateConvertPassenger("companions", idx, {
                                    mode: "existing",
                                    client_id: client.id_client,
                                    first_name: client.first_name || "",
                                    last_name: client.last_name || "",
                                    phone: client.phone || "",
                                    email: client.email || "",
                                    birth_date: client.birth_date || "",
                                    nationality: client.nationality || "",
                                    gender: client.gender || "",
                                  })
                                }
                                onClear={() =>
                                  updateConvertPassenger("companions", idx, {
                                    client_id: null,
                                    first_name: "",
                                    last_name: "",
                                    phone: "",
                                    email: "",
                                    birth_date: "",
                                    nationality: "",
                                    gender: "",
                                  })
                                }
                              />
                              {isConvertInvalid(`companions.${idx}.client_id`) ? (
                                <p className="text-xs text-rose-700 dark:text-rose-300">
                                  Seleccioná un acompañante existente o cambiá a
                                  {" "}
                                  &quot;Pax nuevo&quot;.
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <div className="grid gap-2 md:grid-cols-2">
                              <div className="rounded-2xl border border-rose-300/50 bg-rose-100/45 p-2 text-xs text-rose-800 dark:border-rose-300/40 dark:bg-rose-900/20 dark:text-rose-100 md:col-span-2">
                                <p className="font-medium">
                                  Campos obligatorios de este acompañante:
                                </p>
                                <p>
                                  {passengerRequiredLabels(p).join(" · ") ||
                                    "Sin obligatorios"}
                                </p>
                              </div>
                              {convertProfileOptions.length > 1 && (
                                <div className="md:col-span-2">
                                  <label className={convertLabelClass()}>
                                    Perfil
                                  </label>
                                  <select
                                    className={convertInputClass(
                                      `companions.${idx}.profile_key`,
                                      SELECT,
                                    )}
                                    value={p.profile_key}
                                    onChange={(e) =>
                                      updateConvertPassenger("companions", idx, {
                                        profile_key: e.target.value,
                                      })
                                    }
                                  >
                                    {convertProfileOptions.map((opt) => (
                                      <option key={opt.key} value={opt.key}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.first_name`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "first_name")
                                    ? "Nombre *"
                                    : "Nombre"
                                }
                                value={p.first_name}
                                required={isPassengerFieldRequired(p, "first_name")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    first_name: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.last_name`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "last_name")
                                    ? "Apellido *"
                                    : "Apellido"
                                }
                                value={p.last_name}
                                required={isPassengerFieldRequired(p, "last_name")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    last_name: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.phone`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "phone")
                                    ? "Teléfono *"
                                    : "Teléfono"
                                }
                                value={p.phone}
                                required={isPassengerFieldRequired(p, "phone")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    phone: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.email`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "email")
                                    ? "Email *"
                                    : "Email"
                                }
                                value={p.email}
                                required={isPassengerFieldRequired(p, "email")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    email: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.dni_number`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerDocumentRequired(p) ||
                                  isPassengerFieldRequired(p, "dni_number")
                                    ? "DNI *"
                                    : "DNI"
                                }
                                value={p.dni_number}
                                required={
                                  isPassengerDocumentRequired(p) ||
                                  isPassengerFieldRequired(p, "dni_number")
                                }
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    dni_number: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.passport_number`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerDocumentRequired(p) ||
                                  isPassengerFieldRequired(p, "passport_number")
                                    ? "Pasaporte *"
                                    : "Pasaporte"
                                }
                                value={p.passport_number}
                                required={
                                  isPassengerDocumentRequired(p) ||
                                  isPassengerFieldRequired(p, "passport_number")
                                }
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    passport_number: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.tax_id`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerDocumentRequired(p) ||
                                  isPassengerFieldRequired(p, "tax_id")
                                    ? "CUIT / RUT *"
                                    : "CUIT / RUT"
                                }
                                value={p.tax_id}
                                required={
                                  isPassengerDocumentRequired(p) ||
                                  isPassengerFieldRequired(p, "tax_id")
                                }
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    tax_id: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.company_name`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "company_name")
                                    ? "Razón social *"
                                    : "Razón social"
                                }
                                value={p.company_name}
                                required={isPassengerFieldRequired(p, "company_name")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    company_name: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.commercial_address`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "commercial_address")
                                    ? "Domicilio comercial *"
                                    : "Domicilio comercial"
                                }
                                value={p.commercial_address}
                                required={isPassengerFieldRequired(
                                  p,
                                  "commercial_address",
                                )}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    commercial_address: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.address`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "address")
                                    ? "Dirección *"
                                    : "Dirección"
                                }
                                value={p.address}
                                required={isPassengerFieldRequired(p, "address")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    address: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.locality`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "locality")
                                    ? "Localidad *"
                                    : "Localidad"
                                }
                                value={p.locality}
                                required={isPassengerFieldRequired(p, "locality")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    locality: e.target.value,
                                  })
                                }
                              />
                              <input
                                className={convertInputClass(
                                  `companions.${idx}.postal_code`,
                                  INPUT,
                                )}
                                placeholder={
                                  isPassengerFieldRequired(p, "postal_code")
                                    ? "Código postal *"
                                    : "Código postal"
                                }
                                value={p.postal_code}
                                required={isPassengerFieldRequired(p, "postal_code")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    postal_code: e.target.value,
                                  })
                                }
                              />
                              <input
                                type="date"
                                className={convertInputClass(
                                  `companions.${idx}.birth_date`,
                                  INPUT,
                                )}
                                placeholder="Seleccionar fecha"
                                value={p.birth_date}
                                required={isPassengerFieldRequired(p, "birth_date")}
                                onChange={(e) =>
                                  updateConvertPassenger("companions", idx, {
                                    birth_date: e.target.value,
                                  })
                                }
                              />
                              <div className="space-y-1">
                                <label
                                  className={convertLabelClass(
                                    `companions.${idx}.nationality`,
                                  )}
                                >
                                  Nacionalidad
                                  {isPassengerFieldRequired(p, "nationality") ? (
                                    <RequiredMark />
                                  ) : null}
                                </label>
                                <DestinationPicker
                                  type="country"
                                  multiple={false}
                                  value={null}
                                  onChange={(value) =>
                                    updateConvertPassenger("companions", idx, {
                                      nationality:
                                        destinationValueToLabel(value),
                                    })
                                  }
                                  placeholder="Nacionalidad"
                                  includeDisabled={true}
                                  className="relative z-30 [&>label]:hidden"
                                />
                                {p.nationality ? (
                                  <p className="text-xs text-sky-900/70 dark:text-sky-100/70">
                                    Guardará: <b>{p.nationality}</b>
                                  </p>
                                ) : null}
                                {isConvertInvalid(`companions.${idx}.nationality`) ? (
                                  <p className="text-xs text-rose-700 dark:text-rose-300">
                                    Seleccioná una nacionalidad para este acompañante.
                                  </p>
                                ) : null}
                              </div>
                              <div>
                                <label
                                  className={convertLabelClass(
                                    `companions.${idx}.gender`,
                                  )}
                                >
                                  Género
                                  {isPassengerFieldRequired(p, "gender") ? (
                                    <RequiredMark />
                                  ) : null}
                                </label>
                                <select
                                  className={convertInputClass(
                                    `companions.${idx}.gender`,
                                    SELECT,
                                  )}
                                  value={p.gender}
                                  required={isPassengerFieldRequired(p, "gender")}
                                  onChange={(e) =>
                                    updateConvertPassenger("companions", idx, {
                                      gender: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">Género</option>
                                  <option value="Masculino">Masculino</option>
                                  <option value="Femenino">Femenino</option>
                                  <option value="Otro">Otro</option>
                                  <option value="Prefiere no decir">
                                    Prefiere no decir
                                  </option>
                                </select>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  id="services"
                  title="Servicios"
                  subtitle="Servicios que pasarán a la reserva"
                  open={Boolean(convertSections.services)}
                  onToggle={toggleConvertSection}
                  right={
                    <button
                      type="button"
                      className={AMBER_BTN}
                      onClick={(e) => {
                        e.stopPropagation();
                        addConvertService();
                      }}
                    >
                      Agregar servicio
                    </button>
                  }
                >

                  {isConvertInvalid("services.count") ? (
                    <p className="mb-3 text-xs font-medium text-rose-700 dark:text-rose-300">
                      Faltan servicios para respetar la cantidad original de la
                      cotización.
                    </p>
                  ) : null}

                  {convertForm.services.length === 0 ? (
                    <p className="text-xs text-sky-900/75 dark:text-sky-100/70">
                      Sin servicios para convertir.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {convertForm.services.map((s, idx) => (
                        <div
                          key={`conv-svc-${idx}`}
                          className="rounded-2xl border border-sky-300/30 bg-white/55 p-3 dark:border-sky-200/20 dark:bg-sky-950/20"
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-sky-800/70 dark:text-sky-100/70">
                                Servicio #{idx + 1}
                              </p>
                              <p className="text-xs text-sky-900/75 dark:text-sky-100/75">
                                Datos comerciales y operativos
                              </p>
                            </div>
                            <button
                              type="button"
                              className={DANGER_ICON_BTN}
                              onClick={() => removeConvertService(idx)}
                              aria-label="Quitar servicio"
                              title="Quitar servicio"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <div>
                              <label
                                className={convertLabelClass(`services.${idx}.type`)}
                              >
                                Tipo de servicio
                                <RequiredMark />
                              </label>
                              <select
                                className={convertInputClass(
                                  `services.${idx}.type`,
                                  SELECT,
                                )}
                                value={s.type}
                                required
                                onChange={(e) =>
                                  updateConvertService(idx, {
                                    type: e.target.value,
                                  })
                                }
                                disabled={loadingServiceTypes}
                              >
                                <option value="">Tipo de servicio</option>
                                {serviceTypes.map((typeOption) => (
                                  <option
                                    key={typeOption.value}
                                    value={typeOption.value}
                                  >
                                    {typeOption.label}
                                  </option>
                                ))}
                                {s.type &&
                                  !serviceTypes.some(
                                    (typeOption) => typeOption.value === s.type,
                                  ) && (
                                    <option value={s.type}>
                                      {s.type} (no listado)
                                    </option>
                                  )}
                              </select>
                            </div>
                            <div>
                              <label
                                className={convertLabelClass(
                                  `services.${idx}.currency`,
                                )}
                              >
                                Moneda
                                <RequiredMark />
                              </label>
                              <select
                                className={convertInputClass(
                                  `services.${idx}.currency`,
                                  SELECT,
                                )}
                                value={s.currency}
                                required
                                onChange={(e) => {
                                  updateConvertService(idx, {
                                    currency: e.target.value,
                                  });
                                  clearMoneyInputsByIndex("convert", idx);
                                }}
                                disabled={loadingCurrencies}
                              >
                                <option value="">Moneda</option>
                                {currencyOptions.map((code) => (
                                  <option key={code} value={code}>
                                    {code}
                                  </option>
                                ))}
                                {s.currency &&
                                  !currencyOptions.includes(
                                    s.currency.toUpperCase(),
                                  ) && (
                                    <option value={s.currency}>
                                      {s.currency} (no listado)
                                    </option>
                                  )}
                              </select>
                            </div>
                            <div>
                              <label
                                className={convertLabelClass(
                                  `services.${idx}.operator_id`,
                                )}
                              >
                                Operador
                                <RequiredMark />
                              </label>
                              <select
                                className={convertInputClass(
                                  `services.${idx}.operator_id`,
                                  SELECT,
                                )}
                                value={
                                  typeof s.operator_id === "number" &&
                                  Number.isFinite(s.operator_id)
                                    ? String(s.operator_id)
                                    : ""
                                }
                                required
                                disabled={loadingOperators}
                                onChange={(e) =>
                                  updateConvertService(idx, {
                                    operator_id: e.target.value
                                      ? Number(e.target.value)
                                      : null,
                                  })
                                }
                              >
                                <option value="">
                                  {loadingOperators
                                    ? "Cargando operadores..."
                                    : "Seleccionar operador"}
                                </option>
                                {operators.map((operator) => (
                                  <option
                                    key={operator.id_operator}
                                    value={operator.id_operator}
                                  >
                                    {operator.name || "Operador"}{" "}
                                    {operator.agency_operator_id
                                      ? `· Nº ${operator.agency_operator_id}`
                                      : `· ID ${operator.id_operator}`}
                                  </option>
                                ))}
                                {typeof s.operator_id === "number" &&
                                Number.isFinite(s.operator_id) &&
                                s.operator_id > 0 &&
                                !operators.some(
                                  (operator) =>
                                    operator.id_operator === s.operator_id,
                                ) ? (
                                  <option value={s.operator_id}>
                                    Operador ID {s.operator_id} (no listado)
                                  </option>
                                ) : null}
                              </select>
                            </div>
                            <div>
                              <label
                                className={convertLabelClass(
                                  `services.${idx}.sale_price`,
                                )}
                              >
                                Precio de venta
                                <RequiredMark />
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                className={convertInputClass(
                                  `services.${idx}.sale_price`,
                                  INPUT,
                                )}
                                placeholder="Venta"
                                value={
                                  moneyInputs[
                                    moneyInputKey("convert", idx, "sale_price")
                                  ] ??
                                  formatStoredMoneyInput(
                                    s.sale_price,
                                    s.currency || "ARS",
                                  )
                                }
                                onChange={(e) => {
                                  const currency = s.currency || "ARS";
                                  const formatted = formatMoneyInputSafe(
                                    e.target.value,
                                    currency,
                                    shouldPreferDotDecimal(e),
                                  );
                                  const parsed = parseMoneyInputSafe(formatted);
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [moneyInputKey("convert", idx, "sale_price")]:
                                      formatted,
                                  }));
                                  updateConvertService(idx, {
                                    sale_price:
                                      parsed != null && Number.isFinite(parsed)
                                        ? String(parsed)
                                        : "",
                                  });
                                }}
                                onBlur={(e) => {
                                  const currency = s.currency || "ARS";
                                  const parsed = parseMoneyInputSafe(
                                    e.target.value,
                                  );
                                  const numeric =
                                    parsed != null && Number.isFinite(parsed)
                                      ? parsed
                                      : null;
                                  updateConvertService(idx, {
                                    sale_price:
                                      numeric != null ? String(numeric) : "",
                                  });
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [moneyInputKey("convert", idx, "sale_price")]:
                                      numeric != null
                                        ? formatMoneyInputSafe(
                                            String(numeric),
                                            currency,
                                          )
                                        : "",
                                  }));
                                }}
                                required
                              />
                            </div>
                            <div>
                              <label
                                className={convertLabelClass(
                                  `services.${idx}.cost_price`,
                                )}
                              >
                                Costo
                                <RequiredMark />
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                className={convertInputClass(
                                  `services.${idx}.cost_price`,
                                  INPUT,
                                )}
                                placeholder="Costo"
                                value={
                                  moneyInputs[
                                    moneyInputKey("convert", idx, "cost_price")
                                  ] ??
                                  formatStoredMoneyInput(
                                    s.cost_price,
                                    s.currency || "ARS",
                                  )
                                }
                                onChange={(e) => {
                                  const currency = s.currency || "ARS";
                                  const formatted = formatMoneyInputSafe(
                                    e.target.value,
                                    currency,
                                    shouldPreferDotDecimal(e),
                                  );
                                  const parsed = parseMoneyInputSafe(formatted);
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [moneyInputKey("convert", idx, "cost_price")]:
                                      formatted,
                                  }));
                                  updateConvertService(idx, {
                                    cost_price:
                                      parsed != null && Number.isFinite(parsed)
                                        ? String(parsed)
                                        : "",
                                  });
                                }}
                                onBlur={(e) => {
                                  const currency = s.currency || "ARS";
                                  const parsed = parseMoneyInputSafe(
                                    e.target.value,
                                  );
                                  const numeric =
                                    parsed != null && Number.isFinite(parsed)
                                      ? parsed
                                      : null;
                                  updateConvertService(idx, {
                                    cost_price:
                                      numeric != null ? String(numeric) : "",
                                  });
                                  setMoneyInputs((prev) => ({
                                    ...prev,
                                    [moneyInputKey("convert", idx, "cost_price")]:
                                      numeric != null
                                        ? formatMoneyInputSafe(
                                            String(numeric),
                                            currency,
                                          )
                                        : "",
                                  }));
                                }}
                                required
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="mb-1 block text-xs opacity-75">
                                Destino
                              </label>
                              <DestinationPicker
                                type="destination"
                                multiple={false}
                                value={null}
                                onChange={(value) =>
                                  updateConvertService(idx, {
                                    destination: destinationValueToLabel(value),
                                  })
                                }
                                placeholder="Destino"
                                className="relative z-30 [&>label]:hidden"
                              />
                              {s.destination ? (
                                <p className="text-xs text-sky-900/70 dark:text-sky-100/70">
                                  Guardará: <b>{s.destination}</b>
                                </p>
                              ) : null}
                            </div>
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Salida
                              </label>
                              <input
                                type="date"
                                className={INPUT}
                                placeholder="Seleccionar fecha"
                                value={s.departure_date}
                                onChange={(e) =>
                                  updateConvertService(idx, {
                                    departure_date: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs opacity-75">
                                Regreso
                              </label>
                              <input
                                type="date"
                                className={INPUT}
                                placeholder="Seleccionar fecha"
                                value={s.return_date}
                                onChange={(e) =>
                                  updateConvertService(idx, {
                                    return_date: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="mb-1 block text-xs opacity-75">
                                Descripción
                              </label>
                              <textarea
                                className={`${INPUT} min-h-16`}
                                placeholder="Descripción"
                                value={s.description}
                                onChange={(e) =>
                                  updateConvertService(idx, {
                                    description: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={SUBTLE_BTN}
                    onClick={closeConvert}
                    disabled={converting}
                  >
                    Cancelar conversión
                  </button>
                  <button
                    type="button"
                    className={BTN}
                    disabled={converting}
                    onClick={submitConvert}
                  >
                    {converting ? "Convirtiendo..." : "Confirmar conversión"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </ProtectedRoute>
  );
}
