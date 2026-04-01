"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "next/navigation";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { AnimatePresence, motion } from "framer-motion";
import { requestGroupApi } from "@/lib/groups/clientApi";
import { authFetch } from "@/utils/authFetch";
import ClientPicker from "@/components/clients/ClientPicker";
import DestinationPicker, {
  DestinationOption,
} from "@/components/DestinationPicker";
import type { Client, ClientCustomField, ClientProfileConfig } from "@/types";
import type {
  ClientPayment,
  Invoice,
  Operator,
  OperatorDue,
  Receipt,
  Service,
} from "@/types";
import type { CreditNoteWithItems } from "@/services/creditNotes";
import {
  DEFAULT_CLIENT_PROFILE_KEY,
  DEFAULT_CLIENT_PROFILE_LABEL,
  DEFAULT_REQUIRED_FIELDS,
  DOCUMENT_ANY_KEY,
  normalizeClientProfiles,
  resolveClientProfile,
} from "@/utils/clientConfig";
import { useAuth } from "@/context/AuthContext";
import GroupReceiptForm from "@/components/groups/collections/GroupReceiptForm";
import GroupReceiptList from "@/components/groups/collections/GroupReceiptList";
import GroupClientPaymentForm from "@/components/groups/collections/GroupClientPaymentForm";
import GroupClientPaymentList from "@/components/groups/collections/GroupClientPaymentList";
import GroupOperatorDueForm from "@/components/groups/payments/GroupOperatorDueForm";
import GroupOperatorDueList from "@/components/groups/payments/GroupOperatorDueList";
import GroupOperatorPaymentForm from "@/components/groups/payments/GroupOperatorPaymentForm";
import GroupOperatorPaymentList from "@/components/groups/payments/GroupOperatorPaymentList";
import type { InvestmentItem as GroupOperatorPaymentItem } from "@/components/groups/payments/GroupOperatorPaymentCard";
import GroupInvoiceForm, {
  type InvoiceFormData,
} from "@/components/groups/billing/GroupInvoiceForm";
import GroupInvoiceList from "@/components/groups/billing/GroupInvoiceList";
import CreditNoteList from "@/components/credit-notes/CreditNoteList";
import type { ServiceLite, SubmitResult } from "@/types/receipts";
import {
  computeManualTotals,
  type ManualTotalsInput,
} from "@/services/afip/manualTotals";
import {
  formatDateOnlyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";
import type { GroupFinanceContext } from "@/components/groups/finance/contextTypes";

type GroupStatus =
  | "BORRADOR"
  | "PUBLICADA"
  | "CONFIRMADA"
  | "CERRADA"
  | "CANCELADA";

type GroupType = "AGENCIA" | "ESTUDIANTIL" | "MICRO" | "PRECOMPRADO";

type Departure = {
  id_travel_group_departure: number;
  agency_travel_group_departure_id?: number | null;
  public_id: string | null;
  name: string;
  code?: string | null;
  status: string;
  departure_date: string;
  return_date: string | null;
  capacity_total: number | null;
};

type Group = {
  id_travel_group: number;
  agency_travel_group_id?: number | null;
  public_id: string | null;
  code?: string | null;
  name: string;
  type: GroupType;
  status: GroupStatus;
  capacity_mode: string;
  capacity_total: number | null;
  allow_overbooking: boolean;
  waitlist_enabled: boolean;
  sale_mode?: string | null;
  start_date: string | null;
  end_date: string | null;
  departures: Departure[];
  _count: {
    passengers: number;
    bookings: number;
    departures: number;
    inventories: number;
  };
};

type PassengerItem = {
  id_travel_group_passenger: number;
  status: string;
  waitlist_position: number | null;
  metadata?: Record<string, unknown> | null;
  client_id: number | null;
  booking_id: number | null;
  client: {
    id_client: number;
    agency_client_id: number | null;
    first_name: string;
    last_name: string;
    dni_number: string | null;
    phone: string;
    email: string | null;
  } | null;
  booking?: {
    id_booking: number;
    agency_booking_id: number | null;
  } | null;
  travelGroupDeparture: {
    id_travel_group_departure: number;
    name: string;
  } | null;
  pending_payment: {
    amount: string;
    count: number;
  };
};

type GroupInventoryItem = {
  id_travel_group_inventory: number;
  agency_travel_group_inventory_id: number | null;
  travel_group_departure_id: number | null;
  inventory_type: string;
  service_type: string | null;
  label: string;
  provider: string | null;
  locator: string | null;
  total_qty: number;
  assigned_qty: number;
  confirmed_qty: number;
  blocked_qty: number;
  currency: string | null;
  unit_cost: string | number | null;
  note: string | null;
  travelGroupDeparture?: {
    id_travel_group_departure: number;
    name: string;
    departure_date: string | Date;
  } | null;
};

type ServiceTypeOption = {
  id_service_type: number;
  code: string;
  name: string;
  enabled?: boolean;
};

type OperatorOption = {
  id_operator: number;
  agency_operator_id?: number | null;
  name: string;
};

type FinanceCurrencyOption = {
  code: string;
  name?: string | null;
  symbol?: string | null;
  enabled?: boolean;
  is_primary?: boolean;
};

type ServiceCalcConfigPayload = {
  transfer_fee_pct?: number | string | null;
};

type InventoryFinancialMeta = {
  v: 1;
  pricingMode?: "MANUAL" | "VENTA_TOTAL";
  billingMode?: "AUTO" | "MANUAL";
  operatorId?: number | null;
  saleUnitPrice?: number | null;
  saleTotalPrice?: number | null;
  taxable21?: number | null;
  taxable105?: number | null;
  exemptAmount?: number | null;
  otherTaxes?: number | null;
  transferFeePct?: number | null;
};

type InventoryFinancialRow = {
  inventoryId: number;
  currency: string;
  totalQty: number;
  assignedQty: number;
  confirmedQty: number;
  blockedQty: number;
  availableQty: number;
  unitCost: number;
  costTotal: number;
  costAssigned: number;
  costConfirmed: number;
  costBlocked: number;
  costAvailable: number;
  saleTotal: number;
  transferFeePct: number;
  transferFeeAmount: number;
  taxesTotal: number;
  grossMargin: number;
  operationalDebt: number;
};

type GroupFinanceScopeOption = {
  key: string;
  label: string;
  passengerCount: number;
  departureId: number | null;
  departureName: string | null;
};

type GroupFinanceContextPayload = GroupFinanceContext & {
  Receipt?: Receipt[];
  invoices?: Invoice[];
  services?: Service[];
  public_id?: string | null;
};

type ClientEditableDraft = {
  id_client?: number;
  profile_key: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  dni_number: string;
  passport_number: string;
  tax_id: string;
  birth_date: string;
  nationality: string;
  gender: string;
  address: string;
  locality: string;
  postal_code: string;
  company_name: string;
  commercial_address: string;
  custom_fields: Record<string, string>;
} | null;

type ClientConfigPayload = {
  profiles?: unknown;
  required_fields?: unknown;
  hidden_fields?: unknown;
  custom_fields?: unknown;
} | null;

type InventoryDraft = {
  departure_id: string;
  inventory_type: string;
  service_type: string;
  operator_id: string;
  label: string;
  provider: string;
  locator: string;
  pricing_mode: "MANUAL" | "VENTA_TOTAL";
  billing_mode: "AUTO" | "MANUAL";
  total_qty: string;
  assigned_qty: string;
  confirmed_qty: string;
  blocked_qty: string;
  currency: string;
  unit_cost: string;
  sale_unit_price: string;
  sale_total_price: string;
  taxable_21: string;
  taxable_105: string;
  exempt_amount: string;
  other_taxes: string;
  transfer_fee_pct: string;
  note: string;
};

type DepartureDetail = Departure & {
  code: string | null;
  release_date: string | null;
  allow_overbooking: boolean | null;
  overbooking_limit: number | null;
  waitlist_enabled: boolean | null;
  waitlist_limit: number | null;
  note: string | null;
};

type DepartureDraft = {
  name: string;
  code: string;
  status: GroupStatus;
  departure_date: string;
  return_date: string;
  release_date: string;
  capacity_total: string;
  allow_overbooking: boolean;
  overbooking_limit: string;
  waitlist_enabled: boolean;
  waitlist_limit: string;
  note: string;
};

function formatDate(value: string | null | undefined) {
  return formatDateOnlyInBuenosAires(value ?? null);
}

function formatPendingInstallmentAmount(
  value: string | number | null | undefined,
): string {
  const raw = String(value ?? "").trim();
  const normalized = raw.toUpperCase();
  const currencySymbol =
    normalized.includes("USD") ||
    normalized.includes("US$") ||
    normalized.includes("U$S") ||
    normalized.includes("U$D")
      ? "US$"
      : normalized.includes("EUR") || normalized.includes("€")
        ? "€"
        : normalized.includes("GBP") || normalized.includes("£")
          ? "£"
          : "$";
  const numericOnly = raw.replace(/[^\d,.-]/g, "");
  const parsedCandidate =
    numericOnly.includes(".") && numericOnly.includes(",")
      ? numericOnly.replace(/\./g, "").replace(",", ".")
      : numericOnly.replace(",", ".");
  const parsed =
    typeof value === "number" ? value : Number(parsedCandidate || "0");
  const amount = Number.isFinite(parsed) ? parsed : 0;
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currencySymbol} ${formatted}`;
}

function toDateInputValue(value: string | null | undefined): string {
  return toDateKeyInBuenosAiresLegacySafe(value ?? null) ?? "";
}

function parsePassengerNote(
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (!metadata || typeof metadata !== "object") return "";
  const raw = metadata.note;
  return typeof raw === "string" ? raw : "";
}

function toAmountNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toReceiptServiceLite(service: Service): ServiceLite {
  return {
    id_service: service.id_service,
    description:
      service.description || service.type || `Servicio ${service.id_service}`,
    currency: normalizeCurrencyCode(service.currency || "ARS"),
    sale_price: toAmountNumber(service.sale_price),
    card_interest: toAmountNumber(service.card_interest || 0),
    taxableCardInterest: toAmountNumber(service.taxableCardInterest || 0),
    vatOnCardInterest: toAmountNumber(service.vatOnCardInterest || 0),
    type: service.type,
    destination: service.destination,
  };
}

function pickFinanceContext(payload: {
  context?: GroupFinanceContextPayload;
  booking?: GroupFinanceContextPayload;
}): GroupFinanceContextPayload | null {
  return payload.context ?? payload.booking ?? null;
}

const INVENTORY_META_PREFIX = "[OFI_INV_META]";
const INVENTORY_META_SUFFIX = "[/OFI_INV_META]";

function normalizeMoneyValue(
  value: number | string | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  const parsed =
    typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(2));
}

function parseInventoryNote(note: string | null | undefined): {
  noteText: string;
  meta: InventoryFinancialMeta | null;
} {
  const raw = String(note || "");
  const start = raw.indexOf(INVENTORY_META_PREFIX);
  const end = raw.indexOf(INVENTORY_META_SUFFIX);
  if (start !== 0 || end <= INVENTORY_META_PREFIX.length) {
    return { noteText: raw.trim(), meta: null };
  }
  const jsonText = raw.slice(INVENTORY_META_PREFIX.length, end).trim();
  const text = raw.slice(end + INVENTORY_META_SUFFIX.length).trim();
  try {
    const parsed = JSON.parse(jsonText) as Partial<InventoryFinancialMeta>;
    if (Number(parsed?.v) !== 1) {
      return { noteText: text, meta: null };
    }
    const pricingMode =
      parsed.pricingMode === "VENTA_TOTAL" ? "VENTA_TOTAL" : "MANUAL";
    const billingMode = parsed.billingMode === "MANUAL" ? "MANUAL" : "AUTO";
    const meta: InventoryFinancialMeta = {
      v: 1,
      pricingMode,
      billingMode,
      operatorId:
        typeof parsed.operatorId === "number" && parsed.operatorId > 0
          ? parsed.operatorId
          : null,
      saleUnitPrice: normalizeMoneyValue(parsed.saleUnitPrice),
      saleTotalPrice: normalizeMoneyValue(parsed.saleTotalPrice),
      taxable21: normalizeMoneyValue(parsed.taxable21),
      taxable105: normalizeMoneyValue(parsed.taxable105),
      exemptAmount: normalizeMoneyValue(parsed.exemptAmount),
      otherTaxes: normalizeMoneyValue(parsed.otherTaxes),
      transferFeePct: normalizeMoneyValue(parsed.transferFeePct),
    };
    return { noteText: text, meta };
  } catch {
    return { noteText: raw.trim(), meta: null };
  }
}

function buildInventoryNote(
  noteText: string,
  meta: InventoryFinancialMeta | null,
): string | null {
  const normalizedNote = noteText.trim();
  if (!meta) return normalizedNote || null;
  const compact = {
    v: 1,
    pricingMode: meta.pricingMode || "MANUAL",
    billingMode: meta.billingMode || "AUTO",
    operatorId: meta.operatorId || null,
    saleUnitPrice: normalizeMoneyValue(meta.saleUnitPrice),
    saleTotalPrice: normalizeMoneyValue(meta.saleTotalPrice),
    taxable21: normalizeMoneyValue(meta.taxable21),
    taxable105: normalizeMoneyValue(meta.taxable105),
    exemptAmount: normalizeMoneyValue(meta.exemptAmount),
    otherTaxes: normalizeMoneyValue(meta.otherTaxes),
    transferFeePct: normalizeMoneyValue(meta.transferFeePct),
  };
  const hasMeaningfulValue = Object.entries(compact).some(([key, value]) => {
    if (key === "v") return false;
    if (value == null) return false;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  });
  if (!hasMeaningfulValue) return normalizedNote || null;
  const serialized = JSON.stringify(compact);
  const merged = `${INVENTORY_META_PREFIX}${serialized}${INVENTORY_META_SUFFIX}${normalizedNote ? `\n${normalizedNote}` : ""}`;
  return merged;
}

function formatMoney(value: number, currency: string): string {
  const code = String(currency || "ARS").toUpperCase();
  if (!Number.isFinite(value)) return `0 ${code}`;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

const PASSENGER_STATUSES = [
  "PENDIENTE",
  "CONFIRMADO",
  "LISTA_ESPERA",
  "CANCELADO",
] as const;

const STATUS_STYLES: Record<string, string> = {
  BORRADOR:
    "border-slate-300/80 bg-slate-100/80 text-slate-700 dark:border-sky-600/40 dark:bg-sky-900/15 dark:text-slate-200",
  PUBLICADA:
    "border-sky-300/80 bg-sky-100/80 text-sky-700 dark:border-sky-600/40 dark:bg-sky-900/15 dark:text-sky-200",
  CONFIRMADA:
    "border-emerald-300/80 bg-emerald-100/80 text-emerald-700 dark:border-emerald-500/70 dark:bg-emerald-900/10 dark:text-emerald-200",
  CERRADA:
    "border-zinc-300/80 bg-zinc-100/80 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
  CANCELADA:
    "border-amber-300/80 bg-amber-100/90 text-amber-800 dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200",
  LISTA_ESPERA:
    "border-amber-300/80 bg-amber-100/90 text-amber-800 dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200",
  CONFIRMADO:
    "border-emerald-300/80 bg-emerald-100/80 text-emerald-700 dark:border-emerald-500/70 dark:bg-emerald-900/10 dark:text-emerald-200",
  PENDIENTE:
    "border-sky-300/80 bg-sky-100/80 text-sky-700 dark:border-sky-600/40 dark:bg-sky-900/15 dark:text-sky-200",
  CANCELADO:
    "border-zinc-300/80 bg-zinc-100/80 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
};

const PASSENGER_STATUS_LABELS: Record<
  (typeof PASSENGER_STATUSES)[number],
  string
> = {
  PENDIENTE: "Pendiente",
  CONFIRMADO: "Confirmado",
  LISTA_ESPERA: "Lista de espera",
  CANCELADO: "Cancelado",
};

const PILL_BASE =
  "rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const PILL_INACTIVE =
  "border-sky-300 bg-sky-50/70 text-sky-900 hover:border-sky-400 dark:border-sky-600/30 dark:bg-sky-950/20 dark:text-sky-100 dark:hover:border-sky-600";
const PILL_SKY_ACTIVE =
  "border-sky-400 bg-sky-100/90 text-sky-800 dark:border-sky-500 dark:bg-sky-900/5 dark:text-sky-200";
const PILL_EMERALD_ACTIVE =
  "border-emerald-400 bg-emerald-50/50 text-emerald-800 dark:border-emerald-500/70 dark:bg-emerald-900/10 dark:text-emerald-200";
const PILL_AMBER_ACTIVE =
  "border-amber-400 bg-amber-100/90 text-amber-800 dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200";
const DOC_FIELD_KEYS = ["dni_number", "passport_number", "tax_id"] as const;
const FIELD_INPUT_CLASS =
  "w-full rounded-2xl border border-sky-300/80 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-slate-900/10 outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-100 dark:focus:border-sky-400";
const FIELD_TEXTAREA_CLASS =
  "w-full rounded-2xl border border-sky-300/80 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-slate-900/10 outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-100 dark:focus:border-sky-400";
const FIELD_LABEL_CLASS =
  "ml-1 block text-sm font-medium text-slate-900 dark:text-slate-100";
const FIELD_HINT_CLASS = "ml-1 text-xs text-slate-600 dark:text-slate-400";
const FLAT_NOTE_CLASS =
  "border-l-2 border-slate-300/80 pl-3 py-1 text-xs text-slate-700 dark:border-sky-600/40 dark:text-slate-300";
const FLAT_WARN_CLASS =
  "border-l-2 border-amber-400/80 pl-3 py-1 text-xs text-amber-900 dark:border-amber-500/70 dark:text-amber-200";
type SectionFilterKey = "GRUPAL" | "COBROS" | "PAGOS" | "FACTURACION";

const SECTION_FILTERS: ReadonlyArray<{
  id: SectionFilterKey;
  label: string;
  tone: "sky" | "emerald" | "amber";
}> = [
  { id: "GRUPAL", label: "Grupal", tone: "emerald" },
  { id: "COBROS", label: "Cobros", tone: "sky" },
  { id: "PAGOS", label: "Pagos", tone: "amber" },
  { id: "FACTURACION", label: "Facturación", tone: "emerald" },
] as const;

const createEmptyInvoiceFormData = (): InvoiceFormData => ({
  tipoFactura: "6",
  clientIds: [],
  services: [],
  exchangeRate: "",
  description21: [],
  description10_5: [],
  descriptionNonComputable: [],
  invoiceDate: "",
  manualTotalsEnabled: false,
  manualTotal: "",
  manualBase21: "",
  manualIva21: "",
  manualBase10_5: "",
  manualIva10_5: "",
  manualExempt: "",
  distributionMode: "percentage",
  distributionValues: [],
  paxDocTypes: [],
  paxDocNumbers: [],
  paxLookupData: [],
  paxLookupPersist: [],
  customItems: [],
});

function normalizeCurrencyCode(value: string | null | undefined): string {
  return (
    String(value || "ARS")
      .trim()
      .toUpperCase() || "ARS"
  );
}

function pillClass(
  active: boolean,
  tone: "sky" | "emerald" | "amber" = "sky",
): string {
  if (!active) return `${PILL_BASE} ${PILL_INACTIVE}`;
  const toneClass =
    tone === "emerald"
      ? PILL_EMERALD_ACTIVE
      : tone === "amber"
        ? PILL_AMBER_ACTIVE
        : PILL_SKY_ACTIVE;
  return `${PILL_BASE} ${toneClass}`;
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 dark:border-sky-600/40 dark:border-t-slate-200" />
      {label}
    </span>
  );
}

function CollapsiblePanel({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={{ height: 0, opacity: 0, y: -6 }}
          animate={{ height: "auto", opacity: 1, y: 0 }}
          exit={{ height: 0, opacity: 0, y: -6 }}
          transition={{
            height: { duration: 0.28, ease: "easeInOut" },
            opacity: { duration: 0.2, ease: "easeInOut" },
            y: { duration: 0.22, ease: "easeInOut" },
          }}
          className={`overflow-hidden ${className}`}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function CollapsibleSectionHeader({
  open,
  onToggle,
  title,
  subtitle,
  disabled = false,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={`sticky top-0 z-10 ${
        open ? "rounded-t-3xl border-b" : ""
      } border-sky-300/70 bg-white px-5 py-4 backdrop-blur-sm dark:border-sky-600/30 dark:bg-sky-950/10 md:px-6`}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-60"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3.5">
          <div className="grid size-9 place-items-center rounded-full border border-sky-300/70 bg-white text-sky-900 shadow-sm shadow-slate-900/10 dark:border-sky-600/40 dark:bg-sky-900/10 dark:text-sky-100">
            {open ? (
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
            <p className="text-base font-semibold leading-tight text-slate-900 dark:text-slate-100 md:text-lg">
              {title}
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 md:text-xs">
              {subtitle}
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}

type ClientDraftField = Exclude<
  keyof NonNullable<ClientEditableDraft>,
  "id_client" | "custom_fields"
>;

function PassengerClientFields({
  draft,
  onChange,
  onCustomChange,
  onProfileChange,
  disabled,
  profileKey,
  profileOptions = [],
  requiredFields,
  hiddenFields,
  customFields,
  title = "Datos personales",
  description = "Completá datos de contacto, identidad y facturación del pasajero.",
}: {
  draft: ClientEditableDraft;
  onChange: (field: ClientDraftField, value: string) => void;
  onCustomChange: (key: string, value: string) => void;
  onProfileChange?: (key: string) => void;
  disabled: boolean;
  profileKey?: string;
  profileOptions?: Array<{ key: string; label: string }>;
  requiredFields: string[];
  hiddenFields: string[];
  customFields: ClientCustomField[];
  title?: string;
  description?: string;
}) {
  if (!draft) return null;

  const hiddenSet = new Set(hiddenFields);
  const requiredSet = new Set(
    requiredFields.filter((field) => !hiddenSet.has(field)),
  );

  const isHidden = (field: string) => hiddenSet.has(field);
  const isRequired = (field: string) => requiredSet.has(field);
  const docRequired = requiredSet.has(DOCUMENT_ANY_KEY);
  const hasDoc = DOC_FIELD_KEYS.some(
    (field) => String(draft[field] ?? "").trim().length > 0,
  );

  const requiredLabel = (label: string, required: boolean) => (
    <label
      className={`${FIELD_LABEL_CLASS} ${
        required ? "after:ml-1 after:text-rose-500 after:content-['*']" : ""
      }`}
    >
      {label}
    </label>
  );

  const handleNationalitySelect = (
    value: DestinationOption | DestinationOption[] | null,
  ) => {
    const selected = value && !Array.isArray(value) ? value.displayLabel : "";
    onChange("nationality", selected);
  };

  return (
    <div className="rounded-2xl border border-sky-300/80 bg-white p-4 shadow-sm shadow-slate-900/10 dark:border-sky-600/30 dark:bg-sky-950/10">
      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </p>
        <p className={FIELD_HINT_CLASS}>{description}</p>
      </div>

      {docRequired && !hasDoc ? (
        <p className="mb-3 rounded-xl border border-amber-300/80 bg-amber-100/85 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200">
          Debés completar al menos uno: DNI, Pasaporte o CUIT/RUT.
        </p>
      ) : null}

      {profileOptions.length > 1 ? (
        <div className="mb-4 space-y-1">
          <label className={FIELD_LABEL_CLASS}>Tipo de pax</label>
          <select
            value={profileKey || profileOptions[0]?.key || ""}
            onChange={(e) => onProfileChange?.(e.target.value)}
            disabled={disabled}
            className={FIELD_INPUT_CLASS}
          >
            {profileOptions.map((profile) => (
              <option key={profile.key} value={profile.key}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {!isHidden("first_name") ? (
          <div className="space-y-1">
            {requiredLabel("Nombre", isRequired("first_name"))}
            <input
              value={draft.first_name}
              onChange={(e) => onChange("first_name", e.target.value)}
              disabled={disabled}
              placeholder="Ej: Juan"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("last_name") ? (
          <div className="space-y-1">
            {requiredLabel("Apellido", isRequired("last_name"))}
            <input
              value={draft.last_name}
              onChange={(e) => onChange("last_name", e.target.value)}
              disabled={disabled}
              placeholder="Ej: Pérez"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("phone") ? (
          <div className="space-y-1">
            {requiredLabel("Teléfono", isRequired("phone"))}
            <input
              value={draft.phone}
              onChange={(e) => onChange("phone", e.target.value)}
              disabled={disabled}
              placeholder="Ej: 11 1234 5678"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("email") ? (
          <div className="space-y-1">
            {requiredLabel("Correo electrónico", isRequired("email"))}
            <input
              type="email"
              value={draft.email}
              onChange={(e) => onChange("email", e.target.value)}
              disabled={disabled}
              placeholder="nombre@email.com"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("gender") ? (
          <div className="space-y-1">
            {requiredLabel("Género", isRequired("gender"))}
            <select
              value={draft.gender}
              onChange={(e) => onChange("gender", e.target.value)}
              disabled={disabled}
              className={FIELD_INPUT_CLASS}
            >
              <option value="">Seleccionar</option>
              <option value="Masculino">Masculino</option>
              <option value="Femenino">Femenino</option>
              <option value="No Binario">No Binario</option>
            </select>
          </div>
        ) : null}

        {!isHidden("birth_date") ? (
          <div className="space-y-1">
            {requiredLabel("Fecha de nacimiento", isRequired("birth_date"))}
            <input
              type="date"
              value={draft.birth_date}
              onChange={(e) => onChange("birth_date", e.target.value)}
              disabled={disabled}
              className={FIELD_INPUT_CLASS}
            />
            <p className={FIELD_HINT_CLASS}>Completá en formato día/mes/año.</p>
          </div>
        ) : null}

        {!isHidden("nationality") ? (
          <div className="space-y-1 md:col-span-2">
            {requiredLabel("Nacionalidad", isRequired("nationality"))}
            <DestinationPicker
              type="country"
              multiple={false}
              value={null}
              onChange={handleNationalitySelect}
              placeholder="Ej.: Argentina, Uruguay..."
              disabled={disabled}
              includeDisabled={true}
            />
            <p className={FIELD_HINT_CLASS}>
              {draft.nationality
                ? `Se guardará: ${draft.nationality}`
                : "Buscá el país para registrar la nacionalidad."}
            </p>
          </div>
        ) : null}

        {!isHidden("dni_number") ? (
          <div className="space-y-1">
            {requiredLabel("Documento / DNI", isRequired("dni_number"))}
            <input
              value={draft.dni_number}
              onChange={(e) => onChange("dni_number", e.target.value)}
              disabled={disabled}
              placeholder="Ej: 32123456"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("passport_number") ? (
          <div className="space-y-1">
            {requiredLabel("Pasaporte", isRequired("passport_number"))}
            <input
              value={draft.passport_number}
              onChange={(e) => onChange("passport_number", e.target.value)}
              disabled={disabled}
              placeholder="Ej: AA123456"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("tax_id") ? (
          <div className="space-y-1">
            {requiredLabel("CUIT / RUT", isRequired("tax_id"))}
            <input
              value={draft.tax_id}
              onChange={(e) => onChange("tax_id", e.target.value)}
              disabled={disabled}
              placeholder="Ej: 20-12345678-3"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("postal_code") ? (
          <div className="space-y-1">
            {requiredLabel("Código postal", isRequired("postal_code"))}
            <input
              value={draft.postal_code}
              onChange={(e) => onChange("postal_code", e.target.value)}
              disabled={disabled}
              placeholder="Ej: 1425"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("address") ? (
          <div className="space-y-1 md:col-span-2">
            {requiredLabel("Dirección", isRequired("address"))}
            <input
              value={draft.address}
              onChange={(e) => onChange("address", e.target.value)}
              disabled={disabled}
              placeholder="Ej: Av. Corrientes 1234"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("locality") ? (
          <div className="space-y-1">
            {requiredLabel("Localidad", isRequired("locality"))}
            <input
              value={draft.locality}
              onChange={(e) => onChange("locality", e.target.value)}
              disabled={disabled}
              placeholder="Ej: CABA"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("company_name") ? (
          <div className="space-y-1">
            {requiredLabel("Razón social", isRequired("company_name"))}
            <input
              value={draft.company_name}
              onChange={(e) => onChange("company_name", e.target.value)}
              disabled={disabled}
              placeholder="Opcional para facturación"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {!isHidden("commercial_address") ? (
          <div className="space-y-1 md:col-span-2">
            {requiredLabel(
              "Domicilio comercial",
              isRequired("commercial_address"),
            )}
            <input
              value={draft.commercial_address}
              onChange={(e) => onChange("commercial_address", e.target.value)}
              disabled={disabled}
              placeholder="Opcional para facturación"
              className={FIELD_INPUT_CLASS}
            />
          </div>
        ) : null}

        {customFields.map((field) => {
          const value = draft.custom_fields[field.key] || "";
          const fieldRequired = Boolean(field.required);
          const inputType = field.type === "number" ? "number" : "text";
          const options = Array.isArray(field.options) ? field.options : [];
          return (
            <div key={field.key} className="space-y-1 md:col-span-2">
              {requiredLabel(field.label, fieldRequired)}
              {field.type === "date" ? (
                <input
                  type="date"
                  value={value}
                  onChange={(e) => onCustomChange(field.key, e.target.value)}
                  disabled={disabled}
                  className={FIELD_INPUT_CLASS}
                />
              ) : field.type === "select" && options.length > 0 ? (
                <select
                  value={value}
                  onChange={(e) => onCustomChange(field.key, e.target.value)}
                  disabled={disabled}
                  className={FIELD_INPUT_CLASS}
                >
                  <option value="">
                    {field.placeholder || "Seleccionar"}
                  </option>
                  {options.map((option) => (
                    <option key={`${field.key}-${option}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "multiselect" && options.length > 0 ? (
                <select
                  multiple
                  value={value
                    .split(",")
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0)}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map(
                      (option) => option.value,
                    );
                    onCustomChange(field.key, selected.join(", "));
                  }}
                  disabled={disabled}
                  className={`${FIELD_INPUT_CLASS} min-h-[96px]`}
                >
                  {options.map((option) => (
                    <option key={`${field.key}-${option}`} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "boolean" ? (
                <select
                  value={value}
                  onChange={(e) => onCustomChange(field.key, e.target.value)}
                  disabled={disabled}
                  className={FIELD_INPUT_CLASS}
                >
                  <option value="">
                    {field.placeholder || "Seleccionar"}
                  </option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  value={value}
                  onChange={(e) => onCustomChange(field.key, e.target.value)}
                  disabled={disabled}
                  placeholder={field.placeholder || ""}
                  className={FIELD_INPUT_CLASS}
                  rows={3}
                />
              ) : (
                <input
                  type={inputType}
                  value={value}
                  onChange={(e) => onCustomChange(field.key, e.target.value)}
                  disabled={disabled}
                  placeholder={field.placeholder || ""}
                  className={FIELD_INPUT_CLASS}
                />
              )}
              {field.help ? (
                <p className={FIELD_HINT_CLASS}>{field.help}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatPassengerStatus(value: string): string {
  return (
    PASSENGER_STATUS_LABELS[value as keyof typeof PASSENGER_STATUS_LABELS] ??
    value
  );
}

function formatDepartureReference(dep: Departure): string {
  const code = typeof dep.code === "string" ? dep.code.trim() : "";
  if (code) return `Código ${code}`;
  if (dep.agency_travel_group_departure_id) {
    return `Salida Nº${dep.agency_travel_group_departure_id}`;
  }
  return `Salida Nº${dep.id_travel_group_departure}`;
}

function sortDeparturesByDate(rows: Departure[]): Departure[] {
  return [...rows].sort((a, b) => {
    const aDateKey =
      toDateKeyInBuenosAiresLegacySafe(a.departure_date ?? null) ?? "";
    const bDateKey =
      toDateKeyInBuenosAiresLegacySafe(b.departure_date ?? null) ?? "";
    if (aDateKey && bDateKey && aDateKey !== bDateKey) {
      return aDateKey.localeCompare(bDateKey);
    }
    if (aDateKey && !bDateKey) return -1;
    if (!aDateKey && bDateKey) return 1;
    return a.id_travel_group_departure - b.id_travel_group_departure;
  });
}

function parseOptionalPositiveInteger(raw: string): number | null {
  const normalized = raw.trim();
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function defaultDepartureDraft(
  source?: Partial<DepartureDetail>,
): DepartureDraft {
  return {
    name: source?.name ?? "",
    code: source?.code ?? "",
    status: (source?.status as GroupStatus) ?? "BORRADOR",
    departure_date: source?.departure_date?.slice(0, 10) ?? "",
    return_date: source?.return_date?.slice(0, 10) ?? "",
    release_date: source?.release_date?.slice(0, 10) ?? "",
    capacity_total:
      source?.capacity_total != null ? String(source.capacity_total) : "",
    allow_overbooking: Boolean(source?.allow_overbooking),
    overbooking_limit:
      source?.overbooking_limit != null ? String(source.overbooking_limit) : "",
    waitlist_enabled: Boolean(source?.waitlist_enabled),
    waitlist_limit:
      source?.waitlist_limit != null ? String(source.waitlist_limit) : "",
    note: source?.note ?? "",
  };
}

function defaultInventoryDraft(
  source?: Partial<GroupInventoryItem>,
  options?: {
    defaultTransferFeePct?: number;
    operators?: OperatorOption[];
  },
): InventoryDraft {
  const parsedNote = parseInventoryNote(source?.note ?? "");
  const meta = parsedNote.meta;
  const providers = Array.isArray(options?.operators) ? options?.operators : [];
  const fallbackOperator =
    source?.provider &&
    providers.find(
      (op) =>
        op.name.trim().toLowerCase() === source.provider?.trim().toLowerCase(),
    );
  const transferFeePct =
    meta?.transferFeePct != null
      ? meta.transferFeePct
      : (options?.defaultTransferFeePct ?? 2.4);
  return {
    departure_id:
      source?.travel_group_departure_id != null
        ? String(source.travel_group_departure_id)
        : "",
    inventory_type: source?.inventory_type ?? "",
    service_type: source?.service_type ?? "",
    operator_id:
      meta?.operatorId != null && meta.operatorId > 0
        ? String(meta.operatorId)
        : fallbackOperator
          ? String(fallbackOperator.id_operator)
          : "",
    label: source?.label ?? "",
    provider: source?.provider ?? "",
    locator: source?.locator ?? "",
    pricing_mode: "MANUAL",
    billing_mode: "AUTO",
    total_qty: source?.total_qty != null ? String(source.total_qty) : "",
    assigned_qty:
      source?.assigned_qty != null ? String(source.assigned_qty) : "0",
    confirmed_qty:
      source?.confirmed_qty != null ? String(source.confirmed_qty) : "0",
    blocked_qty: source?.blocked_qty != null ? String(source.blocked_qty) : "0",
    currency: source?.currency ?? "ARS",
    unit_cost: source?.unit_cost != null ? String(source.unit_cost) : "",
    sale_unit_price:
      meta?.saleUnitPrice != null ? String(meta.saleUnitPrice) : "",
    sale_total_price:
      meta?.saleTotalPrice != null ? String(meta.saleTotalPrice) : "",
    taxable_21: meta?.taxable21 != null ? String(meta.taxable21) : "",
    taxable_105: meta?.taxable105 != null ? String(meta.taxable105) : "",
    exempt_amount: meta?.exemptAmount != null ? String(meta.exemptAmount) : "",
    other_taxes: meta?.otherTaxes != null ? String(meta.otherTaxes) : "",
    transfer_fee_pct: transferFeePct != null ? String(transferFeePct) : "",
    note: parsedNote.noteText,
  };
}

function defaultClientDraft(
  source?: Record<string, unknown> | null,
): NonNullable<ClientEditableDraft> {
  const sourceCustomFields =
    source?.custom_fields && typeof source.custom_fields === "object"
      ? (source.custom_fields as Record<string, unknown>)
      : {};
  const customFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourceCustomFields)) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedKey || !normalizedValue) continue;
    customFields[normalizedKey] = normalizedValue;
  }

  return {
    id_client:
      source && Number.isFinite(Number(source.id_client))
        ? Number(source.id_client)
        : undefined,
    profile_key:
      source &&
      typeof source.profile_key === "string" &&
      source.profile_key.trim()
        ? source.profile_key.trim().toLowerCase()
        : DEFAULT_CLIENT_PROFILE_KEY,
    first_name: String(source?.first_name ?? ""),
    last_name: String(source?.last_name ?? ""),
    phone: String(source?.phone ?? ""),
    email: String(source?.email ?? ""),
    dni_number: String(source?.dni_number ?? ""),
    passport_number: String(source?.passport_number ?? ""),
    tax_id: String(source?.tax_id ?? ""),
    birth_date: toDateInputValue(
      source?.birth_date ? String(source.birth_date) : "",
    ),
    nationality: String(source?.nationality ?? ""),
    gender: String(source?.gender ?? ""),
    address: String(source?.address ?? ""),
    locality: String(source?.locality ?? ""),
    postal_code: String(source?.postal_code ?? ""),
    company_name: String(source?.company_name ?? ""),
    commercial_address: String(source?.commercial_address ?? ""),
    custom_fields: customFields,
  };
}

function toFriendlyServiceOptionsError(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("auth_required")
  ) {
    return "No pudimos cargar la configuración de servicios porque tu sesión expiró. Iniciá sesión nuevamente.";
  }
  if (normalized.includes("sin permisos") || normalized.includes("forbidden")) {
    return "No tenés permisos para ver toda la configuración de servicios. Podés continuar con carga manual.";
  }
  if (
    normalized.includes("service-type") ||
    normalized.includes("service type")
  ) {
    return "No pudimos cargar los tipos de servicio. Verificá configuración de servicios.";
  }
  return message;
}

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const groupId = String(params?.id || "");
  const { token, role } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [group, setGroup] = useState<Group | null>(null);
  const [passengers, setPassengers] = useState<PassengerItem[]>([]);
  const [clientProfiles, setClientProfiles] = useState<ClientProfileConfig[]>([
    {
      key: DEFAULT_CLIENT_PROFILE_KEY,
      label: DEFAULT_CLIENT_PROFILE_LABEL,
      required_fields: DEFAULT_REQUIRED_FIELDS,
      hidden_fields: [],
      custom_fields: [],
    },
  ]);

  const [showDepartureCreate, setShowDepartureCreate] = useState(false);
  const [showDeparturePanel, setShowDeparturePanel] = useState(false);
  const [createDepartureDraft, setCreateDepartureDraft] =
    useState<DepartureDraft>(() => defaultDepartureDraft());
  const [activeDepartureId, setActiveDepartureId] = useState<number | null>(
    null,
  );
  const [editingDepartureId, setEditingDepartureId] = useState<number | null>(
    null,
  );
  const [editingDepartureDraft, setEditingDepartureDraft] =
    useState<DepartureDraft>(() => defaultDepartureDraft());
  const [loadingDepartureId, setLoadingDepartureId] = useState<number | null>(
    null,
  );

  const [passengerView, setPassengerView] = useState<"TABLE" | "LIST" | "GRID">(
    "TABLE",
  );
  const [passengerSearch, setPassengerSearch] = useState("");
  const [passengerStatusFilter, setPassengerStatusFilter] = useState<
    "ALL" | string
  >("ALL");
  const [showPassengerFilters, setShowPassengerFilters] = useState(false);
  const [showPrimaryDeparturePanel, setShowPrimaryDeparturePanel] =
    useState(false);
  const [showPassengerForm, setShowPassengerForm] = useState(false);
  const [showPassengerInternalNote, setShowPassengerInternalNote] =
    useState(false);
  const [passengerFormMode, setPassengerFormMode] = useState<
    "ALTA" | "EDICION"
  >("ALTA");

  const [newPassengerMode, setNewPassengerMode] = useState<
    "EXISTENTE" | "NUEVO"
  >("EXISTENTE");
  const [newPassengerClientId, setNewPassengerClientId] = useState<
    number | null
  >(null);
  const [newClientDraft, setNewClientDraft] = useState<ClientEditableDraft>(
    () => defaultClientDraft(),
  );
  const [activePassengerId, setActivePassengerId] = useState<number | null>(
    null,
  );
  const [activePassengerStatus, setActivePassengerStatus] = useState("");
  const [activePassengerDepartureId, setActivePassengerDepartureId] =
    useState("");
  const [activePassengerNote, setActivePassengerNote] = useState("");
  const [activeClientDraft, setActiveClientDraft] =
    useState<ClientEditableDraft>(null);
  const [activeClientRaw, setActiveClientRaw] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [activeClientLoading, setActiveClientLoading] = useState(false);

  const [inventories, setInventories] = useState<GroupInventoryItem[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [operatorOptions, setOperatorOptions] = useState<OperatorOption[]>([]);
  const [financeCurrencies, setFinanceCurrencies] = useState<
    FinanceCurrencyOption[]
  >([]);
  const [serviceOptionsError, setServiceOptionsError] = useState<string | null>(
    null,
  );
  const [defaultTransferFeePct, setDefaultTransferFeePct] = useState(2.4);
  const [showInventoryForm, setShowInventoryForm] = useState(false);
  const [showInventoryInternalNote, setShowInventoryInternalNote] =
    useState(false);
  const [editingInventoryId, setEditingInventoryId] = useState<number | null>(
    null,
  );
  const [inventoryDraft, setInventoryDraft] = useState<InventoryDraft>(() =>
    defaultInventoryDraft(undefined, { defaultTransferFeePct: 2.4 }),
  );
  const [sectionFilter, setSectionFilter] =
    useState<SectionFilterKey>("GRUPAL");
  const [collectContext, setCollectContext] =
    useState<GroupFinanceContextPayload | null>(null);
  const [collectClientPayments, setCollectClientPayments] = useState<
    ClientPayment[]
  >([]);
  const [collectReceipts, setCollectReceipts] = useState<Receipt[]>([]);
  const [collectLoading, setCollectLoading] = useState(false);
  const [collectLoadingError, setCollectLoadingError] = useState<string | null>(
    null,
  );
  const [collectReceiptFormVisible, setCollectReceiptFormVisible] =
    useState(false);
  const [editingCollectReceipt, setEditingCollectReceipt] =
    useState<Receipt | null>(null);

  const [financeContext, setFinanceContext] =
    useState<GroupFinanceContextPayload | null>(null);
  const [financeInvoices, setFinanceInvoices] = useState<Invoice[]>([]);
  const [financeCreditNotes, setFinanceCreditNotes] = useState<
    CreditNoteWithItems[]
  >([]);
  const [financeInvoiceFormVisible, setFinanceInvoiceFormVisible] =
    useState(false);
  const [financeInvoiceSubmitting, setFinanceInvoiceSubmitting] =
    useState(false);
  const [financeInvoiceFormData, setFinanceInvoiceFormData] =
    useState<InvoiceFormData>(() => createEmptyInvoiceFormData());
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeLoadingError, setFinanceLoadingError] = useState<string | null>(
    null,
  );
  const [
    financeOperatorPaymentsReloadKey,
    setFinanceOperatorPaymentsReloadKey,
  ] = useState(0);
  const [editingOperatorPayment, setEditingOperatorPayment] =
    useState<GroupOperatorPaymentItem | null>(null);

  const [paymentsContext, setPaymentsContext] =
    useState<GroupFinanceContextPayload | null>(null);
  const [paymentsOperatorDues, setPaymentsOperatorDues] = useState<
    OperatorDue[]
  >([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsLoadingError, setPaymentsLoadingError] = useState<
    string | null
  >(null);
  const activeDepartureRef = useRef<number | null>(null);
  const lastScopedDepartureRef = useRef<number | null>(null);

  const fetchAll = useCallback(
    async (requestedDepartureId?: number | null) => {
      setLoading(true);
      setError(null);
      try {
        const groupData = await requestGroupApi<Group>(
          `/api/groups/${encodeURIComponent(groupId)}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar la grupal.",
        );
        const orderedDepartures = sortDeparturesByDate(
          Array.isArray(groupData.departures) ? groupData.departures : [],
        );
        const baselineDepartureId =
          requestedDepartureId ?? activeDepartureRef.current;
        const activeDepartureExists =
          baselineDepartureId != null &&
          orderedDepartures.some(
            (item) => item.id_travel_group_departure === baselineDepartureId,
          );
        const scopedDepartureId =
          activeDepartureExists && baselineDepartureId != null
            ? baselineDepartureId
            : (orderedDepartures[0]?.id_travel_group_departure ?? null);
        if (activeDepartureRef.current !== scopedDepartureId) {
          activeDepartureRef.current = scopedDepartureId;
          setActiveDepartureId((prev) =>
            prev === scopedDepartureId ? prev : scopedDepartureId,
          );
        }
        const departureQuery = scopedDepartureId
          ? `?departureId=${encodeURIComponent(String(scopedDepartureId))}`
          : "";

        const passengersData = await requestGroupApi<{
          items?: PassengerItem[];
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/passengers${departureQuery}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar los pasajeros.",
        );
        const inventoriesData = await requestGroupApi<{
          items?: GroupInventoryItem[];
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/inventories${departureQuery}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar los servicios de la grupal.",
        );
        const clientConfigData = await requestGroupApi<ClientConfigPayload>(
          "/api/clients/config",
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar la configuración de pasajeros.",
        ).catch(() => null);
        setGroup(groupData);
        setPassengers(
          Array.isArray(passengersData.items) ? passengersData.items : [],
        );
        setInventories(
          Array.isArray(inventoriesData.items) ? inventoriesData.items : [],
        );

        const normalizedProfiles = normalizeClientProfiles(
          clientConfigData?.profiles,
          {
            required_fields: clientConfigData?.required_fields,
            hidden_fields: clientConfigData?.hidden_fields,
            custom_fields: clientConfigData?.custom_fields,
          },
        );
        setClientProfiles(normalizedProfiles);
        setNewClientDraft((prev) =>
          prev
            ? {
                ...prev,
                profile_key: resolveClientProfile(
                  normalizedProfiles,
                  prev.profile_key,
                ).key,
              }
            : prev,
        );
        setActiveClientDraft((prev) =>
          prev
            ? {
                ...prev,
                profile_key: resolveClientProfile(
                  normalizedProfiles,
                  prev.profile_key,
                ).key,
              }
            : prev,
        );
        try {
          const serviceTypesData = await requestGroupApi<ServiceTypeOption[]>(
            "/api/service-types?enabled=true",
            {
              credentials: "include",
              cache: "no-store",
            },
            "No pudimos cargar los tipos de servicio.",
          ).catch(() => []);
          const operatorsData = await requestGroupApi<OperatorOption[]>(
            "/api/operators",
            {
              credentials: "include",
              cache: "no-store",
            },
            "No pudimos cargar los operadores.",
          ).catch(() => []);
          const financePicksData = await requestGroupApi<{
            currencies?: FinanceCurrencyOption[];
          }>(
            "/api/finance/picks",
            {
              credentials: "include",
              cache: "no-store",
            },
            "No pudimos cargar las monedas de finanzas.",
          ).catch(() => ({ currencies: [] }));
          const calcConfigData =
            await requestGroupApi<ServiceCalcConfigPayload>(
              "/api/service-calc-config",
              {
                credentials: "include",
                cache: "no-store",
              },
              "No pudimos cargar la configuración de costos de transferencia.",
            ).catch(
              (): ServiceCalcConfigPayload => ({ transfer_fee_pct: 2.4 }),
            );

          const validServiceTypes = Array.isArray(serviceTypesData)
            ? serviceTypesData.filter(
                (item) =>
                  typeof item.name === "string" &&
                  item.name.trim().length > 0 &&
                  item.enabled !== false,
              )
            : [];
          const validOperators = Array.isArray(operatorsData)
            ? operatorsData.filter(
                (item) =>
                  Number.isFinite(Number(item.id_operator)) &&
                  Number(item.id_operator) > 0 &&
                  typeof item.name === "string" &&
                  item.name.trim().length > 0,
              )
            : [];
          const validCurrencies = Array.isArray(financePicksData?.currencies)
            ? financePicksData.currencies.filter(
                (item) =>
                  typeof item.code === "string" &&
                  item.code.trim().length > 0 &&
                  item.enabled !== false,
              )
            : [];

          const parsedTransferFeePct = Number(
            String(calcConfigData?.transfer_fee_pct ?? "2.4").replace(",", "."),
          );
          const transferFeePct = Number.isFinite(parsedTransferFeePct)
            ? parsedTransferFeePct
            : 2.4;

          setServiceTypes(validServiceTypes);
          setOperatorOptions(validOperators);
          setFinanceCurrencies(validCurrencies);
          setDefaultTransferFeePct(transferFeePct);
          setServiceOptionsError(null);

          setInventoryDraft((prev) => {
            const next = { ...prev };
            if (
              !next.transfer_fee_pct.trim() ||
              Number.isNaN(Number(next.transfer_fee_pct.replace(",", ".")))
            ) {
              next.transfer_fee_pct = String(transferFeePct);
            }
            if (!next.currency.trim() && validCurrencies.length > 0) {
              next.currency = String(validCurrencies[0].code || "ARS")
                .trim()
                .toUpperCase();
            }
            return next;
          });
        } catch (serviceOptionsErrorRaw) {
          const serviceOptionsMessage =
            serviceOptionsErrorRaw instanceof Error
              ? serviceOptionsErrorRaw.message
              : "No pudimos cargar configuración de servicios.";
          setServiceTypes([]);
          setOperatorOptions([]);
          setFinanceCurrencies([]);
          setDefaultTransferFeePct(2.4);
          setServiceOptionsError(
            toFriendlyServiceOptionsError(serviceOptionsMessage),
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "No pudimos cargar la pantalla de esta grupal.";
        setError(message);
        toast.error(message);
        setGroup(null);
        setPassengers([]);
        setInventories([]);
        setServiceTypes([]);
        setOperatorOptions([]);
        setFinanceCurrencies([]);
        setServiceOptionsError(null);
        setDefaultTransferFeePct(2.4);
        setClientProfiles([
          {
            key: DEFAULT_CLIENT_PROFILE_KEY,
            label: DEFAULT_CLIENT_PROFILE_LABEL,
            required_fields: DEFAULT_REQUIRED_FIELDS,
            hidden_fields: [],
            custom_fields: [],
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [groupId],
  );

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    activeDepartureRef.current = activeDepartureId;
  }, [activeDepartureId]);

  const sortedDepartures = useMemo(() => {
    if (!group?.departures) return [];
    return sortDeparturesByDate(group.departures);
  }, [group?.departures]);

  const isSingleDepartureMode = useMemo(() => {
    return String(group?.sale_mode || "").toUpperCase() === "UNICA";
  }, [group?.sale_mode]);

  const primaryDeparture = useMemo(() => {
    if (!isSingleDepartureMode) return null;
    return sortedDepartures[0] ?? null;
  }, [isSingleDepartureMode, sortedDepartures]);

  const activePassenger = useMemo(() => {
    if (!activePassengerId) return null;
    return (
      passengers.find(
        (item) => item.id_travel_group_passenger === activePassengerId,
      ) ?? null
    );
  }, [activePassengerId, passengers]);

  const selectedCollectPassenger = activePassenger;

  const selectedCollectClientId = useMemo(() => {
    const clientId = Number(selectedCollectPassenger?.client_id || 0);
    return Number.isFinite(clientId) && clientId > 0 ? clientId : null;
  }, [selectedCollectPassenger?.client_id]);

  const selectedFinancePassenger = activePassenger;

  const activeDeparture = useMemo(() => {
    if (activeDepartureId == null) return null;
    return (
      sortedDepartures.find(
        (item) => item.id_travel_group_departure === activeDepartureId,
      ) ?? null
    );
  }, [activeDepartureId, sortedDepartures]);

  const selectedFinanceScope = useMemo<GroupFinanceScopeOption | null>(() => {
    if (sortedDepartures.length > 0) {
      const departureId =
        activeDepartureId ?? sortedDepartures[0]?.id_travel_group_departure;
      if (departureId == null) return null;
      const departureName =
        activeDeparture?.name ||
        sortedDepartures.find(
          (item) => item.id_travel_group_departure === departureId,
        )?.name ||
        null;
      return {
        key: `departure:${departureId}`,
        label: `Salida: ${departureName || `#${departureId}`}`,
        passengerCount: passengers.length,
        departureId,
        departureName,
      };
    }

    return {
      key: "group",
      label: "Grupal general",
      passengerCount: passengers.length,
      departureId: null,
      departureName: null,
    };
  }, [
    activeDeparture?.name,
    activeDepartureId,
    passengers.length,
    sortedDepartures,
  ]);

  const selectedPaymentsScope = selectedFinanceScope;

  useEffect(() => {
    if (sortedDepartures.length === 0) {
      if (activeDepartureId != null) {
        setActiveDepartureId(null);
        void fetchAll(null);
      }
      return;
    }
    const hasActive = sortedDepartures.some(
      (item) => item.id_travel_group_departure === activeDepartureId,
    );
    if (hasActive) return;
    const fallbackDepartureId = sortedDepartures[0].id_travel_group_departure;
    setActiveDepartureId(fallbackDepartureId);
    void fetchAll(fallbackDepartureId);
  }, [activeDepartureId, fetchAll, sortedDepartures]);

  useEffect(() => {
    if (passengers.length === 0) {
      setActivePassengerId(null);
      return;
    }
    if (
      activePassengerId == null ||
      !passengers.some(
        (item) => item.id_travel_group_passenger === activePassengerId,
      )
    ) {
      setActivePassengerId(passengers[0].id_travel_group_passenger);
    }
  }, [activePassengerId, passengers]);

  useEffect(() => {
    const previousDepartureId = lastScopedDepartureRef.current;
    if (previousDepartureId === activeDepartureId) return;
    lastScopedDepartureRef.current = activeDepartureId;

    if (previousDepartureId == null) return;

    setEditingCollectReceipt(null);
    setCollectReceiptFormVisible(false);
    setFinanceInvoiceFormVisible(false);
    setFinanceInvoiceFormData(createEmptyInvoiceFormData());
    setShowPassengerInternalNote(false);
    setShowPassengerFilters(false);
    setShowInventoryInternalNote(false);
    setEditingInventoryId(null);
    setShowInventoryForm(false);
    setShowDepartureCreate(false);
    setInventoryDraft(
      defaultInventoryDraft(undefined, {
        defaultTransferFeePct,
        operators: operatorOptions,
      }),
    );
  }, [activeDepartureId, defaultTransferFeePct, operatorOptions]);

  useEffect(() => {
    setEditingCollectReceipt(null);
    setCollectReceiptFormVisible(false);
  }, [
    selectedCollectPassenger?.id_travel_group_passenger,
    selectedCollectClientId,
  ]);

  useEffect(() => {
    if (sectionFilter !== "COBROS") return;
    setEditingCollectReceipt(null);
    setCollectReceiptFormVisible(false);
  }, [sectionFilter]);

  useEffect(() => {
    if (!activePassenger) {
      setActivePassengerStatus("");
      setActivePassengerDepartureId("");
      setActivePassengerNote("");
      setShowPassengerInternalNote(false);
      return;
    }
    setActivePassengerStatus(activePassenger.status || "");
    setActivePassengerDepartureId(
      activePassenger.travelGroupDeparture?.id_travel_group_departure
        ? String(activePassenger.travelGroupDeparture.id_travel_group_departure)
        : "",
    );
    setActivePassengerNote(parsePassengerNote(activePassenger.metadata));
    setShowPassengerInternalNote(false);
  }, [activePassenger]);

  useEffect(() => {
    if (!activePassenger && passengerFormMode === "EDICION") {
      setPassengerFormMode("ALTA");
    }
  }, [activePassenger, passengerFormMode]);

  useEffect(() => {
    if (isSingleDepartureMode || editingInventoryId) return;
    const scopedDepartureValue =
      activeDeparture?.public_id ||
      (activeDepartureId != null ? String(activeDepartureId) : "");
    setInventoryDraft((prev) =>
      prev.departure_id === scopedDepartureValue
        ? prev
        : { ...prev, departure_id: scopedDepartureValue },
    );
  }, [
    activeDeparture?.public_id,
    activeDepartureId,
    editingInventoryId,
    isSingleDepartureMode,
  ]);

  const serviceTypeOptions = useMemo(() => {
    return [...serviceTypes].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [serviceTypes]);

  const inventoryCurrencyOptions = useMemo(() => {
    const configCodes = financeCurrencies
      .map((item) =>
        String(item.code || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);
    const inventoryCodes = inventories
      .map((item) =>
        String(item.currency || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);
    return Array.from(new Set([...configCodes, ...inventoryCodes, "ARS"]));
  }, [financeCurrencies, inventories]);

  const currencyLabelByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of financeCurrencies) {
      const code = String(item.code || "")
        .trim()
        .toUpperCase();
      if (!code) continue;
      const name = String(item.name || "").trim();
      map.set(code, name ? `${code} · ${name}` : code);
    }
    return map;
  }, [financeCurrencies]);

  const inventoryFinancialRows = useMemo<InventoryFinancialRow[]>(() => {
    return inventories.map((item) => {
      const parsedNote = parseInventoryNote(item.note ?? "");
      const meta = parsedNote.meta;
      const currency = String(item.currency || "ARS").toUpperCase();
      const totalQty = Number(item.total_qty || 0);
      const assignedQty = Number(item.assigned_qty || 0);
      const confirmedQty = Number(item.confirmed_qty || 0);
      const blockedQty = Number(item.blocked_qty || 0);
      const availableQty = Math.max(totalQty - assignedQty - blockedQty, 0);
      const unitCost = toAmountNumber(item.unit_cost);
      const costTotal = unitCost * totalQty;
      const costAssigned = unitCost * assignedQty;
      const costConfirmed = unitCost * confirmedQty;
      const costBlocked = unitCost * blockedQty;
      const costAvailable = unitCost * availableQty;
      const saleTotal =
        meta?.pricingMode === "VENTA_TOTAL"
          ? Number(meta.saleTotalPrice || 0)
          : Number(meta?.saleUnitPrice || 0) * totalQty;
      const transferFeePct =
        Number(
          meta?.transferFeePct != null
            ? meta.transferFeePct
            : defaultTransferFeePct,
        ) || 0;
      const transferFeeAmount =
        saleTotal > 0 ? (saleTotal * transferFeePct) / 100 : 0;
      const taxesTotal =
        Number(meta?.taxable21 || 0) +
        Number(meta?.taxable105 || 0) +
        Number(meta?.exemptAmount || 0) +
        Number(meta?.otherTaxes || 0);
      const grossMargin =
        saleTotal - costTotal - transferFeeAmount - taxesTotal;
      const operationalDebt = Math.max(costAssigned - costConfirmed, 0);
      return {
        inventoryId: item.id_travel_group_inventory,
        currency,
        totalQty,
        assignedQty,
        confirmedQty,
        blockedQty,
        availableQty,
        unitCost,
        costTotal,
        costAssigned,
        costConfirmed,
        costBlocked,
        costAvailable,
        saleTotal,
        transferFeePct,
        transferFeeAmount,
        taxesTotal,
        grossMargin,
        operationalDebt,
      };
    });
  }, [defaultTransferFeePct, inventories]);

  const inventoryFinancialById = useMemo(() => {
    return new Map(
      inventoryFinancialRows.map((item) => [item.inventoryId, item] as const),
    );
  }, [inventoryFinancialRows]);

  const inventoryDraftPreview = useMemo(() => {
    const qtyTotal = Number(inventoryDraft.total_qty || 0);
    const qtyAssigned = Number(inventoryDraft.assigned_qty || 0);
    const qtyConfirmed = Number(inventoryDraft.confirmed_qty || 0);
    const qtyBlocked = Number(inventoryDraft.blocked_qty || 0);
    const qtyAvailable = Math.max(qtyTotal - qtyAssigned - qtyBlocked, 0);
    const unitCost = toAmountNumber(inventoryDraft.unit_cost);
    const costTotal = unitCost * qtyTotal;
    const saleTotal = toAmountNumber(inventoryDraft.sale_unit_price) * qtyTotal;
    const taxes =
      toAmountNumber(inventoryDraft.taxable_21) +
      toAmountNumber(inventoryDraft.taxable_105) +
      toAmountNumber(inventoryDraft.exempt_amount) +
      toAmountNumber(inventoryDraft.other_taxes);
    const transferFeePct = toAmountNumber(inventoryDraft.transfer_fee_pct);
    const transferFeeAmount =
      saleTotal > 0 ? (saleTotal * transferFeePct) / 100 : 0;
    const margin = saleTotal - costTotal - taxes - transferFeeAmount;
    const operationalDebt = Math.max(
      (qtyAssigned - qtyConfirmed) * unitCost,
      0,
    );
    return {
      qtyTotal,
      qtyAssigned,
      qtyConfirmed,
      qtyBlocked,
      qtyAvailable,
      unitCost,
      costTotal,
      saleTotal,
      taxes,
      transferFeePct,
      transferFeeAmount,
      margin,
      operationalDebt,
    };
  }, [inventoryDraft]);

  const filteredPassengers = useMemo(() => {
    const q = passengerSearch.trim().toLowerCase();
    return passengers.filter((item) => {
      if (
        passengerStatusFilter !== "ALL" &&
        item.status !== passengerStatusFilter
      ) {
        return false;
      }
      if (!q) return true;
      const fullName =
        `${item.client?.first_name || ""} ${item.client?.last_name || ""}`
          .trim()
          .toLowerCase();
      const departureName =
        item.travelGroupDeparture?.name?.toLowerCase() || "";
      const contextRef = String(
        item.booking?.agency_booking_id ?? item.booking?.id_booking ?? "",
      );
      const clientRef = String(
        item.client?.agency_client_id ?? item.client?.id_client ?? "",
      );
      return (
        fullName.includes(q) ||
        departureName.includes(q) ||
        contextRef.includes(q) ||
        clientRef.includes(q)
      );
    });
  }, [passengers, passengerSearch, passengerStatusFilter]);

  const resolveClientDraftProfile = useCallback(
    (profileKey?: string) => resolveClientProfile(clientProfiles, profileKey),
    [clientProfiles],
  );

  function updateNewClientDraftField(field: ClientDraftField, value: string) {
    setNewClientDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function updateActiveClientDraftField(
    field: ClientDraftField,
    value: string,
  ) {
    setActiveClientDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function updateNewClientCustomField(key: string, value: string) {
    setNewClientDraft((prev) =>
      prev
        ? {
            ...prev,
            custom_fields: {
              ...(prev.custom_fields || {}),
              [key]: value,
            },
          }
        : prev,
    );
  }

  function updateActiveClientCustomField(key: string, value: string) {
    setActiveClientDraft((prev) =>
      prev
        ? {
            ...prev,
            custom_fields: {
              ...(prev.custom_fields || {}),
              [key]: value,
            },
          }
        : prev,
    );
  }

  function sanitizeClientCustomFields(
    draft: NonNullable<ClientEditableDraft>,
  ): Record<string, string> {
    const allowedClientCustomKeys = new Set(
      resolveClientDraftProfile(draft.profile_key).custom_fields.map(
        (field) => field.key,
      ),
    );
    const out: Record<string, string> = {};
    for (const key of allowedClientCustomKeys) {
      const value = String(draft.custom_fields?.[key] ?? "").trim();
      if (!value) continue;
      out[key] = value;
    }
    return out;
  }

  function validateClientDraft(
    draft: NonNullable<ClientEditableDraft> | null,
  ): string | null {
    if (!draft) return "Completá los datos del pasajero.";
    const selectedProfile = resolveClientDraftProfile(draft.profile_key);
    const effectiveClientRequiredFields =
      selectedProfile.required_fields.filter(
        (field) => !selectedProfile.hidden_fields.includes(field),
      );
    const requiredClientCustomKeys = selectedProfile.custom_fields
      .filter((field) => field.required)
      .map((field) => field.key);
    const read = (field: keyof NonNullable<ClientEditableDraft>) =>
      String(draft[field] ?? "").trim();

    for (const field of effectiveClientRequiredFields) {
      if (field === DOCUMENT_ANY_KEY) continue;
      if (selectedProfile.hidden_fields.includes(field)) continue;
      if (!read(field as keyof NonNullable<ClientEditableDraft>)) {
        const fieldLabel = field.replaceAll("_", " ");
        return `El campo ${fieldLabel} es obligatorio.`;
      }
    }

    const docRequired =
      effectiveClientRequiredFields.includes(DOCUMENT_ANY_KEY) ||
      effectiveClientRequiredFields.some((field) =>
        DOC_FIELD_KEYS.includes(field as (typeof DOC_FIELD_KEYS)[number]),
      );
    if (docRequired) {
      const hasDoc = DOC_FIELD_KEYS.some(
        (field) => String(draft[field] ?? "").trim().length > 0,
      );
      if (!hasDoc) {
        return "Completá DNI, Pasaporte o CUIT/RUT para continuar.";
      }
    }

    for (const key of requiredClientCustomKeys) {
      const value = String(draft.custom_fields?.[key] ?? "").trim();
      if (!value) {
        const fieldLabel =
          selectedProfile.custom_fields.find((field) => field.key === key)
            ?.label || key;
        return `El campo ${fieldLabel} es obligatorio.`;
      }
    }

    return null;
  }

  const activePassengerClientId = activePassenger?.client?.id_client ?? null;
  const clientProfileOptions = useMemo(
    () =>
      clientProfiles.map((profile) => ({
        key: profile.key,
        label: profile.label,
      })),
    [clientProfiles],
  );
  const newClientProfile = useMemo(
    () => resolveClientDraftProfile(newClientDraft?.profile_key),
    [newClientDraft?.profile_key, resolveClientDraftProfile],
  );
  const activeClientProfile = useMemo(
    () =>
      activeClientDraft
        ? resolveClientDraftProfile(activeClientDraft.profile_key)
        : resolveClientDraftProfile(DEFAULT_CLIENT_PROFILE_KEY),
    [activeClientDraft, resolveClientDraftProfile],
  );

  useEffect(() => {
    if (!activePassengerClientId) {
      setActiveClientDraft(null);
      setActiveClientRaw(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        setActiveClientLoading(true);
        const client = await requestGroupApi<Record<string, unknown>>(
          `/api/clients/${activePassengerClientId}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar los datos del pasajero.",
        );
        if (cancelled) return;
        setActiveClientRaw(client);
        setActiveClientDraft(defaultClientDraft(client));
      } catch {
        if (!cancelled) {
          setActiveClientDraft(null);
          setActiveClientRaw(null);
        }
      } finally {
        if (!cancelled) setActiveClientLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [activePassengerClientId]);

  const fetchCollectFinanceData = useCallback(
    async (clientId: number | null, passengerId: number | null) => {
      if (!clientId || clientId <= 0 || !passengerId || passengerId <= 0) {
        setCollectContext(null);
        setCollectReceipts([]);
        setCollectClientPayments([]);
        setCollectLoading(false);
        setCollectLoadingError(null);
        return;
      }

      setCollectLoading(true);
      setCollectLoadingError(null);

      const errors: string[] = [];
      try {
        const contextData = await requestGroupApi<{
          context?: GroupFinanceContextPayload;
          booking?: GroupFinanceContextPayload;
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/finance/context?passengerId=${passengerId}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar el contexto financiero del pasajero.",
        );
        setCollectContext(pickFinanceContext(contextData));
      } catch (error) {
        setCollectContext(null);
        errors.push(
          error instanceof Error
            ? error.message
            : "Contexto operativo no disponible.",
        );
      }

      try {
        const receiptsData = await requestGroupApi<{ receipts?: Receipt[] }>(
          `/api/groups/${encodeURIComponent(groupId)}/finance/receipts?passengerId=${passengerId}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar los recibos del pasajero en la grupal.",
        );
        const allReceipts = Array.isArray(receiptsData.receipts)
          ? receiptsData.receipts
          : [];
        const filteredReceipts = allReceipts.filter((receipt) => {
          const ids = Array.isArray(receipt.clientIds)
            ? receipt.clientIds
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0)
            : [];
          if (ids.length === 0) {
            const contextTitularId = Number(
              receipt.booking?.titular?.id_client || 0,
            );
            if (Number.isFinite(contextTitularId) && contextTitularId > 0) {
              return contextTitularId === clientId;
            }
            return true;
          }
          return ids.includes(clientId);
        });
        setCollectReceipts(filteredReceipts);
      } catch (error) {
        setCollectReceipts([]);
        errors.push(
          error instanceof Error ? error.message : "Recibos no disponibles.",
        );
      }

      try {
        const clientPaymentsData = await requestGroupApi<{
          payments?: ClientPayment[];
          items?: ClientPayment[];
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/finance/client-payments?passengerId=${passengerId}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar las cuotas del pasajero en la grupal.",
        );
        const rows = Array.isArray(clientPaymentsData.payments)
          ? clientPaymentsData.payments
          : Array.isArray(clientPaymentsData.items)
            ? clientPaymentsData.items
            : [];
        setCollectClientPayments(rows);
      } catch (error) {
        setCollectClientPayments([]);
        errors.push(
          error instanceof Error ? error.message : "Cuotas no disponibles.",
        );
      }

      setCollectLoadingError(errors.length > 0 ? errors[0] : null);
      setCollectLoading(false);
    },
    [groupId],
  );

  const refreshCollectData = useCallback(async () => {
    await fetchCollectFinanceData(
      selectedCollectClientId,
      selectedCollectPassenger?.id_travel_group_passenger ?? null,
    );
  }, [
    fetchCollectFinanceData,
    selectedCollectClientId,
    selectedCollectPassenger?.id_travel_group_passenger,
  ]);

  useEffect(() => {
    if (sectionFilter !== "COBROS") return;
    void fetchCollectFinanceData(
      selectedCollectClientId,
      selectedCollectPassenger?.id_travel_group_passenger ?? null,
    );
  }, [
    sectionFilter,
    fetchCollectFinanceData,
    selectedCollectClientId,
    selectedCollectPassenger?.id_travel_group_passenger,
  ]);

  const fetchPaymentsDataByScope = useCallback(
    async (scopeOption: GroupFinanceScopeOption | null) => {
      if (!scopeOption) {
        setPaymentsContext(null);
        setPaymentsOperatorDues([]);
        setPaymentsLoading(false);
        setPaymentsLoadingError(null);
        return;
      }

      setPaymentsLoading(true);
      setPaymentsLoadingError(null);

      const errors: string[] = [];
      const scopeParam = encodeURIComponent(scopeOption.key);

      try {
        const contextResult = await requestGroupApi<{
          context?: GroupFinanceContextPayload;
          booking?: GroupFinanceContextPayload;
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/finance/context?scope=${scopeParam}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar el contexto operativo principal.",
        );
        setPaymentsContext(pickFinanceContext(contextResult));
      } catch (error) {
        setPaymentsContext(null);
        errors.push(
          error instanceof Error
            ? error.message
            : "Contexto operativo no disponible.",
        );
      }

      try {
        const operatorDuesResult = await requestGroupApi<{
          dues?: OperatorDue[];
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/finance/operator-dues?scope=${scopeParam}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar vencimientos de operador del contexto de la grupal.",
        );
        setPaymentsOperatorDues(
          Array.isArray(operatorDuesResult.dues) ? operatorDuesResult.dues : [],
        );
      } catch (error) {
        setPaymentsOperatorDues([]);
        errors.push(
          error instanceof Error
            ? error.message
            : "Vencimientos de operador no disponibles.",
        );
      }

      setPaymentsLoadingError(errors.length > 0 ? errors[0] : null);
      setPaymentsLoading(false);
    },
    [groupId],
  );

  const refreshPaymentsData = useCallback(async () => {
    await fetchPaymentsDataByScope(selectedPaymentsScope);
  }, [fetchPaymentsDataByScope, selectedPaymentsScope]);

  useEffect(() => {
    if (sectionFilter !== "PAGOS") return;
    void fetchPaymentsDataByScope(selectedPaymentsScope);
  }, [sectionFilter, fetchPaymentsDataByScope, selectedPaymentsScope]);

  const fetchFinanceDataByScope = useCallback(
    async (scopeOption: GroupFinanceScopeOption | null) => {
      if (!scopeOption) {
        setFinanceContext(null);
        setFinanceInvoices([]);
        setFinanceCreditNotes([]);
        setFinanceLoading(false);
        setFinanceLoadingError(null);
        return;
      }

      setFinanceLoading(true);
      setFinanceLoadingError(null);

      const errors: string[] = [];

      try {
        const contextResult = await requestGroupApi<{
          context?: GroupFinanceContextPayload;
          booking?: GroupFinanceContextPayload;
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/finance/context?scope=${encodeURIComponent(scopeOption.key)}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar el contexto operativo principal.",
        );
        setFinanceContext(pickFinanceContext(contextResult));
      } catch (error) {
        setFinanceContext(null);
        errors.push(
          error instanceof Error
            ? error.message
            : "Contexto operativo no disponible.",
        );
      }

      const scopeParam = encodeURIComponent(scopeOption.key);

      try {
        const invoicesResult = await requestGroupApi<{ invoices?: Invoice[] }>(
          `/api/groups/${encodeURIComponent(groupId)}/finance/invoices?scope=${scopeParam}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar facturas del contexto de la grupal.",
        );
        setFinanceInvoices(
          Array.isArray(invoicesResult.invoices) ? invoicesResult.invoices : [],
        );
      } catch (error) {
        setFinanceInvoices([]);
        errors.push(
          error instanceof Error ? error.message : "Facturas no disponibles.",
        );
      }

      try {
        const notesResult = await requestGroupApi<{
          creditNotes?: CreditNoteWithItems[];
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/finance/credit-notes?scope=${scopeParam}`,
          {
            credentials: "include",
            cache: "no-store",
          },
          "No pudimos cargar notas de crédito del contexto de la grupal.",
        );
        setFinanceCreditNotes(
          Array.isArray(notesResult.creditNotes) ? notesResult.creditNotes : [],
        );
      } catch (error) {
        setFinanceCreditNotes([]);
        errors.push(
          error instanceof Error
            ? error.message
            : "Notas de crédito no disponibles.",
        );
      }

      setFinanceLoadingError(errors.length > 0 ? errors[0] : null);
      setFinanceLoading(false);
    },
    [groupId],
  );

  const refreshFinanceData = useCallback(async () => {
    await fetchFinanceDataByScope(selectedFinanceScope);
  }, [fetchFinanceDataByScope, selectedFinanceScope]);

  useEffect(() => {
    if (sectionFilter !== "FACTURACION") return;
    void fetchFinanceDataByScope(selectedFinanceScope);
  }, [sectionFilter, fetchFinanceDataByScope, selectedFinanceScope]);

  const handleFinanceInvoiceChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFinanceInvoiceFormData((prev) => ({ ...prev, [name]: value }));
  };

  const updateFinanceInvoiceFormData = (
    key: keyof InvoiceFormData,
    value: InvoiceFormData[keyof InvoiceFormData],
  ) => {
    setFinanceInvoiceFormData((prev) => ({ ...prev, [key]: value }));
  };

  const parseManualAmount = (value?: string) => {
    if (value == null) return undefined;
    const trimmed = String(value).trim();
    if (!trimmed) return undefined;
    const num = Number(trimmed.replace(",", "."));
    return Number.isFinite(num) ? num : undefined;
  };

  const buildManualTotals = (data: {
    manualTotalsEnabled: boolean;
    manualTotal: string;
    manualBase21: string;
    manualIva21: string;
    manualBase10_5: string;
    manualIva10_5: string;
    manualExempt: string;
  }): { manualTotals?: ManualTotalsInput; error?: string } => {
    if (!data.manualTotalsEnabled) return { manualTotals: undefined };

    const manualTotals: ManualTotalsInput = {
      total: parseManualAmount(data.manualTotal),
      base21: parseManualAmount(data.manualBase21),
      iva21: parseManualAmount(data.manualIva21),
      base10_5: parseManualAmount(data.manualBase10_5),
      iva10_5: parseManualAmount(data.manualIva10_5),
      exempt: parseManualAmount(data.manualExempt),
    };

    const hasManualValues = Object.values(manualTotals).some(
      (v) => typeof v === "number",
    );

    if (!hasManualValues) {
      return { error: "Completá al menos un importe manual." };
    }

    const validation = computeManualTotals(manualTotals);
    if (!validation.ok) {
      return { error: validation.error };
    }

    return { manualTotals };
  };

  const getInvoiceErrorToast = (raw?: string): string => {
    const msg = String(raw ?? "").trim();
    if (!msg) {
      return "No se pudo crear la factura. Revisá los datos e intentá de nuevo.";
    }

    const m = msg.toLowerCase();

    if (m.includes("importes manuales")) return msg;
    if (m.includes("no autenticado") || m.includes("x-user-id")) {
      return "Tu sesión expiró. Volvé a iniciar sesión.";
    }
    if (m.includes("token")) {
      return "Tu sesión expiró. Volvé a iniciar sesión.";
    }
    if (m.includes("agencia asociada")) {
      return "Tu usuario no tiene agencia asignada. Contactá a un administrador.";
    }
    if (m.includes("agencia no encontrada")) {
      return "No se encontró la agencia. Contactá a un administrador.";
    }
    if (
      m.includes("reserva no pertenece") ||
      m.includes("contexto financiero no pertenece")
    ) {
      return "El contexto financiero no pertenece a tu agencia.";
    }
    if (
      m.includes("reserva no encontrada") ||
      m.includes("contexto financiero no encontrado")
    ) {
      return "No se encontró el contexto financiero.";
    }
    if (m.includes("falta cuit") || m.includes("cuit inválido")) {
      return "Error en el CUIT. Revisá el CUIT del pax o de la agencia.";
    }
    if (m.includes("cuit invalido") || m.includes("tax_id")) {
      return "Error en el CUIT. Revisá el CUIT del pax o de la agencia.";
    }
    if (m.includes("falta dni")) {
      return "Falta DNI del pax. Revisá el documento para Factura B.";
    }
    if (m.includes("docnro") || m.includes("documento")) {
      return "Documento del pax inválido. Revisá DNI/CUIT.";
    }
    if (
      m.includes("cert") ||
      m.includes("key") ||
      m.includes("afip_secret_key") ||
      m.includes("formato cifrado")
    ) {
      return "Credenciales AFIP inválidas o faltantes. Revisá certificado y clave.";
    }
    if (
      m.includes("fecha de factura") ||
      m.includes("formato de fecha") ||
      m.includes("yyyy-mm-dd")
    ) {
      return "Fecha de factura inválida. Debe estar dentro de los 8 días.";
    }
    if (
      m.includes("fchserv") ||
      m.includes("fecha de servicio") ||
      m.includes("servicio desde") ||
      m.includes("servicio hasta")
    ) {
      return "Fecha de servicio inválida. Revisá las fechas de los servicios.";
    }
    if (
      m.includes("punto de venta") ||
      m.includes("feparamgetptosventa") ||
      m.includes("ptovta") ||
      m.includes("seleccionado no esta habilitado")
    ) {
      return "Punto de venta inválido para WSFE. Revisalo en ARCA y reintentá.";
    }
    if (m.includes("cbtnro") || m.includes("cbtenro")) {
      return "Número de comprobante inválido. Revisá el punto de venta en ARCA.";
    }
    if (
      m.includes("iva") ||
      m.includes("impuesto") ||
      m.includes("tributo") ||
      m.includes("alicuota")
    ) {
      return "Error en impuestos/IVA de los servicios. Revisá los importes.";
    }
    if (
      m.includes("cotización") ||
      m.includes("cotizacion") ||
      m.includes("exchangerate") ||
      m.includes("moncotiz")
    ) {
      return "Cotización inválida. Revisá la moneda y el tipo de cambio.";
    }
    if (
      m.includes("afip no disponible") ||
      m.includes("internal server error") ||
      m.includes("invalid xml") ||
      m.includes("request failed")
    ) {
      return "AFIP no respondió correctamente. Intentá más tarde.";
    }
    if (m.includes("cae")) {
      return "AFIP no otorgó CAE. Intentá nuevamente más tarde.";
    }
    if (m.includes("debe haber al menos un servicio")) {
      return "Seleccioná al menos un servicio.";
    }
    if (m.includes("debe haber al menos un pax")) {
      return "Seleccioná un pax válido para continuar.";
    }
    if (m.includes("tipofactura")) {
      return "Tipo de factura inválido. Elegí Factura A o B.";
    }
    if (m.includes("no se generó ninguna factura")) {
      return "No se pudo generar la factura. Revisá CUIT/DNI del pax y los servicios.";
    }

    return msg;
  };

  const handleFinanceInvoiceSubmit = async (e: FormEvent<Element>) => {
    e.preventDefault();
    if (financeInvoiceSubmitting) return;
    if (!token) {
      toast.error("Necesitás sesión activa para facturar.");
      return;
    }
    const financeContextId = Number(
      financeContext?.id_context ?? financeContext?.id_booking ?? 0,
    );
    if (!financeContextId) {
      toast.error("No se pudo identificar el contexto operativo.");
      return;
    }
    if (!selectedFinanceInvoiceClientId) {
      toast.error("Seleccioná un pasajero para facturar.");
      return;
    }
    if (!selectedFinanceInvoicePassenger?.id_travel_group_passenger) {
      toast.error("No se pudo identificar el pasajero seleccionado.");
      return;
    }
    if (
      !financeInvoiceFormData.tipoFactura ||
      financeInvoiceFormData.services.length === 0
    ) {
      toast.error("Completá tipo de factura y al menos un servicio.");
      return;
    }

    const serviceCount = financeInvoiceFormData.services.length;
    const tipoLabel =
      financeInvoiceFormData.tipoFactura === "1" ? "Factura A" : "Factura B";
    const dateLabel = financeInvoiceFormData.invoiceDate
      ? `\nFecha: ${financeInvoiceFormData.invoiceDate}`
      : "";
    const paxName = selectedFinanceInvoicePassenger?.client
      ? `${selectedFinanceInvoicePassenger.client.first_name} ${selectedFinanceInvoicePassenger.client.last_name}`.trim()
      : `Cliente ${selectedFinanceInvoiceClientId}`;

    if (
      !window.confirm(
        `¿Emitir ${tipoLabel} para ${paxName} y ${serviceCount} servicio(s)?${dateLabel}`,
      )
    ) {
      return;
    }

    const manualBuild = buildManualTotals(financeInvoiceFormData);
    if (manualBuild.error) {
      toast.error(manualBuild.error);
      return;
    }

    const selectedServiceIds = financeInvoiceFormData.services
      .map((raw) => Number(raw))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (selectedServiceIds.length === 0) {
      toast.error("Seleccioná al menos un servicio válido.");
      return;
    }

    const onlyDigits = (value?: string | null) =>
      String(value ?? "").replace(/\D/g, "");

    const paxDocType = financeInvoiceFormData.paxDocTypes?.[0] || "";
    const paxDocNumber = onlyDigits(financeInvoiceFormData.paxDocNumbers?.[0]);
    const paxLookup = financeInvoiceFormData.paxLookupData?.[0] || null;
    const paxLookupDni = onlyDigits(paxLookup?.dni);
    const paxLookupCuit = onlyDigits(paxLookup?.cuit);

    const paxData = [
      {
        clientId: selectedFinanceInvoiceClientId,
        dni:
          paxDocType === "DNI"
            ? paxDocNumber || paxLookupDni || undefined
            : paxLookupDni || undefined,
        cuit:
          paxDocType === "CUIT"
            ? paxDocNumber || paxLookupCuit || undefined
            : paxLookupCuit || undefined,
        persistLookup: Boolean(financeInvoiceFormData.paxLookupPersist?.[0]),
        first_name: paxLookup?.first_name || undefined,
        last_name: paxLookup?.last_name || undefined,
        company_name: paxLookup?.company_name || undefined,
        address: paxLookup?.address || undefined,
        locality: paxLookup?.locality || undefined,
        postal_code: paxLookup?.postal_code || undefined,
        commercial_address: paxLookup?.commercial_address || undefined,
      },
    ];

    const customItems = (financeInvoiceFormData.customItems || [])
      .map((item) => {
        const description = String(item.description || "").trim();
        const amountRaw = String(item.amount || "").trim();
        const amountParsed = amountRaw
          ? Number(amountRaw.replace(",", "."))
          : undefined;
        return {
          description,
          taxCategory: item.taxCategory,
          amount:
            typeof amountParsed === "number" &&
            Number.isFinite(amountParsed) &&
            amountParsed > 0
              ? amountParsed
              : undefined,
        };
      })
      .filter((item) => item.description.length > 0);

    const derivedDescriptions = customItems.reduce(
      (acc, item) => {
        if (item.taxCategory === "21") {
          acc.description21.push(item.description);
        } else if (item.taxCategory === "10_5") {
          acc.description10_5.push(item.description);
        } else {
          acc.descriptionNonComputable.push(item.description);
        }
        return acc;
      },
      {
        description21: [] as string[],
        description10_5: [] as string[],
        descriptionNonComputable: [] as string[],
      },
    );

    const payload = {
      passengerId: selectedFinanceInvoicePassenger.id_travel_group_passenger,
      clientId: selectedFinanceInvoiceClientId,
      scope: selectedFinanceScope?.key || undefined,
      services: selectedServiceIds,
      tipoFactura: parseInt(financeInvoiceFormData.tipoFactura, 10),
      exchangeRate: financeInvoiceFormData.exchangeRate
        ? parseFloat(financeInvoiceFormData.exchangeRate)
        : undefined,
      description21:
        derivedDescriptions.description21.length > 0
          ? derivedDescriptions.description21
          : (financeInvoiceFormData.description21 || []).filter(
              (d) => d.trim().length > 0,
            ),
      description10_5:
        derivedDescriptions.description10_5.length > 0
          ? derivedDescriptions.description10_5
          : (financeInvoiceFormData.description10_5 || []).filter(
              (d) => d.trim().length > 0,
            ),
      descriptionNonComputable:
        derivedDescriptions.descriptionNonComputable.length > 0
          ? derivedDescriptions.descriptionNonComputable
          : (financeInvoiceFormData.descriptionNonComputable || []).filter(
              (d) => d.trim().length > 0,
            ),
      paxData,
      customItems,
      invoiceDate: financeInvoiceFormData.invoiceDate,
      manualTotals: manualBuild.manualTotals,
    };

    setFinanceInvoiceSubmitting(true);
    try {
      const res = await authFetch(
        `/api/groups/${encodeURIComponent(groupId)}/finance/invoices`,
        { method: "POST", body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        const raw = await res.text();
        let message = raw;
        try {
          message = (JSON.parse(raw) as { message?: string }).message || raw;
        } catch {
          // mantiene raw si no es JSON
        }
        throw new Error(getInvoiceErrorToast(message));
      }

      const result = (await res.json()) as {
        success?: boolean;
        invoices?: Invoice[];
        message?: string;
      };

      if (!result.success) {
        toast.error(getInvoiceErrorToast(result.message));
        return;
      }

      const createdInvoices = Array.isArray(result.invoices)
        ? result.invoices
        : [];
      if (createdInvoices.length > 0) {
        setFinanceInvoices((prev) => {
          const map = new Map<number, Invoice>();
          for (const row of prev) map.set(row.id_invoice, row);
          for (const row of createdInvoices) map.set(row.id_invoice, row);
          return [...map.values()];
        });
      }

      toast.success("Factura creada exitosamente.");
      setFinanceInvoiceFormVisible(false);

      const paxDni = String(
        selectedFinanceInvoicePassenger?.client?.dni_number || "",
      ).replace(/\D/g, "");
      setFinanceInvoiceFormData({
        ...createEmptyInvoiceFormData(),
        clientIds: [String(selectedFinanceInvoiceClientId)],
        distributionValues: ["100"],
        paxDocTypes: [paxDni ? "DNI" : ""],
        paxDocNumbers: [paxDni],
        paxLookupData: [null],
        paxLookupPersist: [false],
      });

      void refreshFinanceData();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Error servidor.";
      toast.error(getInvoiceErrorToast(msg));
    } finally {
      setFinanceInvoiceSubmitting(false);
    }
  };

  const financeRole = useMemo(() => String(role || "").toLowerCase(), [role]);

  const collectContextServices = useMemo<Service[]>(() => {
    return Array.isArray(collectContext?.services)
      ? collectContext.services
      : [];
  }, [collectContext?.services]);
  const collectServicesByContextRef = useRef<Map<number, ServiceLite[]>>(
    new Map(),
  );

  useEffect(() => {
    collectServicesByContextRef.current.clear();
  }, [groupId]);

  const loadCollectServicesForContext = useCallback(
    async (contextId: number): Promise<ServiceLite[]> => {
      const normalizedContextId = Number(contextId);
      if (!Number.isFinite(normalizedContextId) || normalizedContextId <= 0) {
        return [];
      }

      const cached =
        collectServicesByContextRef.current.get(normalizedContextId);
      if (cached) return cached;

      if (
        Number(
          collectContext?.id_context ?? collectContext?.id_booking ?? 0,
        ) === normalizedContextId &&
        collectContextServices.length > 0
      ) {
        const local = collectContextServices.map(toReceiptServiceLite);
        collectServicesByContextRef.current.set(normalizedContextId, local);
        return local;
      }

      const payload = await requestGroupApi<{
        context?: GroupFinanceContextPayload;
        booking?: GroupFinanceContextPayload;
      }>(
        `/api/groups/${encodeURIComponent(groupId)}/finance/context?contextId=${normalizedContextId}&bookingId=${normalizedContextId}`,
        {
          credentials: "include",
          cache: "no-store",
        },
        "No pudimos cargar servicios del contexto financiero.",
      );

      const resolvedContext = pickFinanceContext(payload);
      const remoteServices = Array.isArray(resolvedContext?.services)
        ? resolvedContext.services
        : [];
      const mapped = remoteServices.map(toReceiptServiceLite);
      collectServicesByContextRef.current.set(normalizedContextId, mapped);
      return mapped;
    },
    [
      collectContext?.id_context,
      collectContext?.id_booking,
      collectContextServices,
      groupId,
    ],
  );

  const financeContextServices = useMemo<Service[]>(() => {
    return Array.isArray(financeContext?.services)
      ? financeContext.services
      : [];
  }, [financeContext?.services]);

  const paymentsContextServices = useMemo<Service[]>(() => {
    return Array.isArray(paymentsContext?.services)
      ? paymentsContext.services
      : [];
  }, [paymentsContext?.services]);

  const selectedFinanceInvoicePassenger = selectedFinancePassenger;

  const selectedFinanceInvoiceClientId = useMemo(() => {
    const clientId = Number(selectedFinanceInvoicePassenger?.client_id || 0);
    return Number.isFinite(clientId) && clientId > 0 ? clientId : null;
  }, [selectedFinanceInvoicePassenger?.client_id]);

  useEffect(() => {
    setFinanceInvoiceFormVisible(false);
    setFinanceInvoiceFormData(createEmptyInvoiceFormData());
  }, [selectedFinanceScope?.key]);

  useEffect(() => {
    setEditingOperatorPayment(null);
  }, [selectedPaymentsScope?.key]);

  useEffect(() => {
    const clientId = selectedFinanceInvoiceClientId;
    const paxDni = String(
      selectedFinanceInvoicePassenger?.client?.dni_number || "",
    ).replace(/\D/g, "");
    setFinanceInvoiceFormData((prev) => {
      const next = { ...prev };

      if (!clientId) {
        if (
          prev.clientIds.length === 0 &&
          prev.distributionValues.length === 0 &&
          prev.paxDocTypes.length === 0 &&
          prev.paxDocNumbers.length === 0
        ) {
          return prev;
        }
        next.clientIds = [];
        next.distributionValues = [];
        next.paxDocTypes = [];
        next.paxDocNumbers = [];
        next.paxLookupData = [];
        next.paxLookupPersist = [];
        return next;
      }

      const nextClientId = String(clientId);
      const nextDocType = paxDni ? "DNI" : "";

      if (
        prev.clientIds.length === 1 &&
        prev.clientIds[0] === nextClientId &&
        prev.distributionValues.length === 1 &&
        prev.distributionValues[0] === "100" &&
        prev.paxDocTypes.length === 1 &&
        prev.paxDocTypes[0] === nextDocType &&
        prev.paxDocNumbers.length === 1 &&
        prev.paxDocNumbers[0] === paxDni &&
        prev.paxLookupData.length === 1 &&
        prev.paxLookupPersist.length === 1
      ) {
        return prev;
      }

      next.clientIds = [nextClientId];
      next.distributionValues = ["100"];
      next.paxDocTypes = [nextDocType];
      next.paxDocNumbers = [paxDni];
      next.paxLookupData = [prev.paxLookupData?.[0] ?? null];
      next.paxLookupPersist = [prev.paxLookupPersist?.[0] ?? false];
      return next;
    });
  }, [
    selectedFinanceInvoiceClientId,
    selectedFinanceInvoicePassenger?.client?.dni_number,
  ]);

  const showGroupPanels = sectionFilter === "GRUPAL";
  const showCobrosPanels = sectionFilter === "COBROS";
  const showPagosPanels = sectionFilter === "PAGOS";
  const showFacturacionPanel = sectionFilter === "FACTURACION";
  const showDepartureSelector = sortedDepartures.length > 0;
  const showDepartureSection =
    !isSingleDepartureMode ||
    sortedDepartures.length === 0 ||
    showDepartureCreate;

  type ActionResult = {
    toastMessage?: string;
    summaryLines?: string[];
  };

  type RunActionOptions = {
    notifySuccess?: boolean;
  };

  async function runAction(
    title: string,
    fn: () => Promise<ActionResult | void>,
    options?: RunActionOptions,
  ): Promise<boolean> {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fn();
      await fetchAll();

      const successMessage = result?.toastMessage || `${title} completada.`;
      setMessage(successMessage);
      if (options?.notifySuccess !== false) {
        toast.success(successMessage);
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error inesperado.";
      setError(msg);
      toast.error(msg);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddPassenger(e: FormEvent) {
    e.preventDefault();
    let clientIdToAdd = newPassengerClientId;
    const creatingNewPassenger = newPassengerMode === "NUEVO";
    if (newPassengerMode === "NUEVO") {
      const validationError = validateClientDraft(
        newClientDraft as NonNullable<ClientEditableDraft> | null,
      );
      if (validationError) {
        setError(validationError);
        toast.error(validationError);
        return;
      }
      if (!newClientDraft) {
        const msg = "Completá los datos del nuevo pasajero.";
        setError(msg);
        toast.error(msg);
        return;
      }

      const sanitizedCustomFields = sanitizeClientCustomFields(newClientDraft);
      try {
        const createdClient = await requestGroupApi<{ id_client: number }>(
          "/api/clients",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              profile_key: newClientDraft.profile_key,
              first_name: newClientDraft.first_name.trim(),
              last_name: newClientDraft.last_name.trim(),
              phone: newClientDraft.phone.trim(),
              email: newClientDraft.email.trim(),
              dni_number: newClientDraft.dni_number.trim(),
              passport_number: newClientDraft.passport_number.trim(),
              tax_id: newClientDraft.tax_id.trim(),
              birth_date: newClientDraft.birth_date || "",
              nationality: newClientDraft.nationality.trim(),
              gender: newClientDraft.gender.trim(),
              address: newClientDraft.address.trim(),
              locality: newClientDraft.locality.trim(),
              postal_code: newClientDraft.postal_code.trim(),
              company_name: newClientDraft.company_name.trim(),
              commercial_address: newClientDraft.commercial_address.trim(),
              custom_fields: sanitizedCustomFields,
            }),
          },
          "No pudimos crear el pasajero nuevo.",
        );
        clientIdToAdd = Number(createdClient.id_client);
      } catch (createError) {
        const msg =
          createError instanceof Error
            ? createError.message
            : "No pudimos crear el pasajero nuevo.";
        setError(msg);
        toast.error(msg);
        return;
      }
    }

    if (!clientIdToAdd) {
      const msg = "Seleccioná o creá un pasajero para agregar a la grupal.";
      setError(msg);
      toast.error(msg);
      return;
    }
    let createdPassengerId: number | null = null;
    let createdCount = 0;
    const completed = await runAction(
      "Alta de pasajero",
      async () => {
        const data = await requestGroupApi<{
          created_count?: number;
          skipped_count?: number;
          created?: Array<{ passenger_id?: number }>;
        }>(
          `/api/groups/${encodeURIComponent(groupId)}/passengers/single-create`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              clientIds: [clientIdToAdd],
              departureId:
                activeDeparture?.public_id ||
                (activeDepartureId != null ? String(activeDepartureId) : null),
            }),
          },
          "No pudimos agregar el pasajero.",
        );
        createdCount = Number(data.created_count ?? 0);
        const firstCreated = Array.isArray(data.created)
          ? data.created[0]
          : null;
        createdPassengerId =
          firstCreated && typeof firstCreated.passenger_id === "number"
            ? firstCreated.passenger_id
            : null;
        setNewPassengerClientId(null);
        if (newPassengerMode === "NUEVO") {
          setNewClientDraft(defaultClientDraft());
          setNewPassengerMode("EXISTENTE");
        }
        return {
          toastMessage: `Pasajero agregado. Creados: ${data.created_count ?? 0}.`,
          summaryLines: [
            `Pasajeros creados: ${data.created_count ?? 0}`,
            `Pasajeros omitidos: ${data.skipped_count ?? 0}`,
          ],
        };
      },
      { notifySuccess: false },
    );

    if (completed && createdCount > 0) {
      toast.success(
        creatingNewPassenger
          ? "Pasajero nuevo creado y agregado a la grupal."
          : "Pasajero agregado a la grupal.",
      );
    }
    if (createdPassengerId) {
      setActivePassengerId(createdPassengerId);
      setPassengerFormMode("EDICION");
    }
  }

  async function handleSaveActiveClient(e: FormEvent) {
    e.preventDefault();
    if (!activePassenger) {
      const msg = "Seleccioná un pasajero para editar.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!activeClientDraft || !activeClientRaw) {
      const msg = "No hay datos de pasajero para guardar.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!activeClientDraft.id_client) {
      const msg = "No encontramos el identificador del pasajero para editar.";
      setError(msg);
      toast.error(msg);
      return;
    }

    const validationError = validateClientDraft(activeClientDraft);
    if (validationError) {
      setError(validationError);
      toast.error(validationError);
      return;
    }

    const sanitizedCustomFields = sanitizeClientCustomFields(activeClientDraft);
    const payload: Record<string, unknown> = {
      ...activeClientRaw,
      profile_key: activeClientDraft.profile_key,
      first_name: activeClientDraft.first_name.trim(),
      last_name: activeClientDraft.last_name.trim(),
      phone: activeClientDraft.phone.trim(),
      email: activeClientDraft.email.trim() || null,
      dni_number: activeClientDraft.dni_number.trim() || null,
      passport_number: activeClientDraft.passport_number.trim() || null,
      tax_id: activeClientDraft.tax_id.trim() || null,
      birth_date: activeClientDraft.birth_date || null,
      nationality: activeClientDraft.nationality.trim(),
      gender: activeClientDraft.gender.trim(),
      address: activeClientDraft.address.trim() || null,
      locality: activeClientDraft.locality.trim() || null,
      postal_code: activeClientDraft.postal_code.trim() || null,
      company_name: activeClientDraft.company_name.trim() || null,
      commercial_address: activeClientDraft.commercial_address.trim() || null,
      custom_fields: sanitizedCustomFields,
    };

    await runAction("Actualización de datos del pasajero", async () => {
      await requestGroupApi(
        `/api/clients/${activeClientDraft.id_client}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        },
        "No pudimos guardar los datos del pasajero.",
      );

      const passengerPayload: Record<string, unknown> = {
        passengerIds: [activePassenger.id_travel_group_passenger],
      };
      if (
        activePassengerStatus &&
        activePassengerStatus !== activePassenger.status
      ) {
        passengerPayload.status = activePassengerStatus;
      }
      if (activePassengerDepartureId === "CLEAR") {
        passengerPayload.clearDeparture = true;
      } else if (activePassengerDepartureId) {
        passengerPayload.departureId = activePassengerDepartureId;
      }
      passengerPayload.note = activePassengerNote.trim();

      const passengerUpdate = await requestGroupApi<{
        updated_count?: number;
      }>(
        `/api/groups/${encodeURIComponent(groupId)}/passengers/single-update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(passengerPayload),
        },
        "No pudimos guardar los datos operativos del pasajero.",
      );
      return {
        toastMessage: "Datos del pasajero actualizados correctamente.",
        summaryLines: [
          "Los cambios personales y operativos fueron guardados.",
          `Registros operativos actualizados: ${passengerUpdate.updated_count ?? 0}`,
        ],
      };
    });
  }

  async function handleDeletePassenger(passenger: PassengerItem) {
    const passengerLabel = passenger.client
      ? `${passenger.client.first_name} ${passenger.client.last_name}`
      : `#${passenger.id_travel_group_passenger}`;
    const confirmed = window.confirm(
      `¿Seguro que querés eliminar al pasajero ${passengerLabel} de la grupal?`,
    );
    if (!confirmed) return;

    try {
      setSubmitting(true);
      setError(null);
      await requestGroupApi(
        `/api/groups/${encodeURIComponent(groupId)}/passengers/${passenger.id_travel_group_passenger}`,
        {
          method: "DELETE",
          credentials: "include",
        },
        "No pudimos eliminar el pasajero.",
      );
      if (activePassengerId === passenger.id_travel_group_passenger) {
        setPassengerFormMode("ALTA");
      }
      toast.success("Pasajero eliminado.");
      await fetchAll();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "No pudimos eliminar el pasajero.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveInventory(e: FormEvent) {
    e.preventDefault();
    const parsedOperatorId = parseOptionalPositiveInteger(
      inventoryDraft.operator_id,
    );
    const selectedOperatorName =
      parsedOperatorId != null
        ? (operatorOptions.find((item) => item.id_operator === parsedOperatorId)
            ?.name ?? "")
        : "";
    const providerValue =
      selectedOperatorName.trim() || inventoryDraft.provider.trim();
    const scopedDepartureForPayload = !isSingleDepartureMode
      ? activeDeparture?.public_id ||
        (activeDepartureId != null ? String(activeDepartureId) : null)
      : inventoryDraft.departure_id || null;
    const financialMeta: InventoryFinancialMeta = {
      v: 1,
      pricingMode: "MANUAL",
      billingMode: "AUTO",
      operatorId: parsedOperatorId ?? null,
      saleUnitPrice: normalizeMoneyValue(inventoryDraft.sale_unit_price),
      saleTotalPrice: null,
      taxable21: normalizeMoneyValue(inventoryDraft.taxable_21),
      taxable105: normalizeMoneyValue(inventoryDraft.taxable_105),
      exemptAmount: normalizeMoneyValue(inventoryDraft.exempt_amount),
      otherTaxes: normalizeMoneyValue(inventoryDraft.other_taxes),
      transferFeePct: normalizeMoneyValue(inventoryDraft.transfer_fee_pct),
    };

    const payload = {
      departure_id: scopedDepartureForPayload,
      inventory_type: inventoryDraft.inventory_type.trim(),
      service_type: inventoryDraft.service_type.trim() || null,
      label: inventoryDraft.label.trim(),
      provider: providerValue || null,
      locator: inventoryDraft.locator.trim() || null,
      total_qty: inventoryDraft.total_qty.trim(),
      assigned_qty: inventoryDraft.assigned_qty.trim() || "0",
      confirmed_qty: inventoryDraft.confirmed_qty.trim() || "0",
      blocked_qty: inventoryDraft.blocked_qty.trim() || "0",
      currency: inventoryDraft.currency.trim().toUpperCase() || null,
      unit_cost: inventoryDraft.unit_cost.trim() || null,
      note: buildInventoryNote(inventoryDraft.note, financialMeta),
    };

    if (parsedOperatorId == null) {
      const msg = "Seleccioná un operador para el servicio.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!payload.label || !payload.inventory_type || !payload.total_qty) {
      const msg = "Completá tipo, nombre y cantidad total del servicio.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (payload.note && payload.note.length > 1000) {
      const msg =
        "La nota del servicio supera el límite permitido. Reducí texto o datos adicionales.";
      setError(msg);
      toast.error(msg);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      if (editingInventoryId) {
        await requestGroupApi(
          `/api/groups/${encodeURIComponent(groupId)}/inventories/${editingInventoryId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          },
          "No pudimos actualizar el servicio.",
        );
        toast.success("Servicio actualizado.");
      } else {
        await requestGroupApi(
          `/api/groups/${encodeURIComponent(groupId)}/inventories`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          },
          "No pudimos cargar el servicio.",
        );
        toast.success("Servicio cargado.");
      }
      setInventoryDraft(
        defaultInventoryDraft(undefined, {
          defaultTransferFeePct,
          operators: operatorOptions,
        }),
      );
      setEditingInventoryId(null);
      setShowInventoryForm(false);
      await fetchAll();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "No pudimos guardar el servicio.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function startEditInventory(item: GroupInventoryItem) {
    setEditingInventoryId(item.id_travel_group_inventory);
    const nextDraft = defaultInventoryDraft(item, {
      defaultTransferFeePct,
      operators: operatorOptions,
    });
    setInventoryDraft(nextDraft);
    setShowInventoryForm(true);
  }

  async function handleDeleteInventory(item: GroupInventoryItem) {
    const confirmed = window.confirm(
      `¿Seguro que querés eliminar el servicio "${item.label}"?`,
    );
    if (!confirmed) return;

    const requiresForceDelete = item.assigned_qty > 0 || item.confirmed_qty > 0;
    if (requiresForceDelete) {
      const forcedConfirmed = window.confirm(
        "Este servicio tiene cupos asignados o confirmados. ¿Querés forzar la eliminación?",
      );
      if (!forcedConfirmed) return;
    }

    try {
      setSubmitting(true);
      await requestGroupApi(
        `/api/groups/${encodeURIComponent(groupId)}/inventories/${item.id_travel_group_inventory}${requiresForceDelete ? "?force=1" : ""}`,
        {
          method: "DELETE",
          credentials: "include",
        },
        "No pudimos eliminar el servicio.",
      );
      toast.success("Servicio eliminado.");
      await fetchAll();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "No pudimos eliminar el servicio.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function buildDeparturePayload(draft: DepartureDraft): {
    payload: Record<string, unknown> | null;
    error: string | null;
  } {
    if (!draft.name.trim()) {
      return {
        payload: null,
        error: "El nombre de la salida es obligatorio.",
      };
    }
    if (!draft.departure_date) {
      return {
        payload: null,
        error: "La fecha de salida es obligatoria.",
      };
    }

    const capacityTotal = parseOptionalPositiveInteger(draft.capacity_total);
    if (draft.capacity_total.trim() && capacityTotal == null) {
      return {
        payload: null,
        error: "El cupo total de la salida es inválido.",
      };
    }
    const overbookingLimit = parseOptionalPositiveInteger(
      draft.overbooking_limit,
    );
    if (draft.overbooking_limit.trim() && overbookingLimit == null) {
      return {
        payload: null,
        error: "El límite de sobreventa es inválido.",
      };
    }
    const waitlistLimit = parseOptionalPositiveInteger(draft.waitlist_limit);
    if (draft.waitlist_limit.trim() && waitlistLimit == null) {
      return {
        payload: null,
        error: "El límite de lista de espera es inválido.",
      };
    }

    return {
      payload: {
        name: draft.name.trim(),
        code: draft.code.trim() || null,
        status: draft.status,
        departure_date: draft.departure_date,
        return_date: draft.return_date || null,
        release_date: draft.release_date || null,
        capacity_total: capacityTotal,
        allow_overbooking: draft.allow_overbooking,
        overbooking_limit: overbookingLimit,
        waitlist_enabled: draft.waitlist_enabled,
        waitlist_limit: waitlistLimit,
        note: draft.note.trim() || null,
      },
      error: null,
    };
  }

  async function handleCreateDeparture(e: FormEvent) {
    e.preventDefault();
    const parsed = buildDeparturePayload(createDepartureDraft);
    if (!parsed.payload) {
      setError(parsed.error ?? "No pudimos validar la salida.");
      toast.error(parsed.error ?? "No pudimos validar la salida.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await requestGroupApi(
        `/api/groups/${encodeURIComponent(groupId)}/departures`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(parsed.payload),
        },
        "No pudimos crear la salida.",
      );
      setCreateDepartureDraft(defaultDepartureDraft());
      setShowDepartureCreate(false);
      setMessage("Salida creada correctamente.");
      toast.success("Salida creada correctamente.");
      await fetchAll();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "No pudimos crear la salida.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function startEditDeparture(dep: Departure) {
    const routeId = dep.public_id || String(dep.id_travel_group_departure);
    try {
      setEditingDepartureId(dep.id_travel_group_departure);
      setEditingDepartureDraft(defaultDepartureDraft(dep));
      setLoadingDepartureId(dep.id_travel_group_departure);
      setError(null);
      const data = await requestGroupApi<DepartureDetail>(
        `/api/groups/${encodeURIComponent(groupId)}/departures/${encodeURIComponent(routeId)}`,
        {
          credentials: "include",
          cache: "no-store",
        },
        "No pudimos cargar los datos de la salida.",
      );
      setEditingDepartureDraft(defaultDepartureDraft(data));
      if (isSingleDepartureMode) {
        setShowPrimaryDeparturePanel(true);
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "No pudimos cargar los datos de la salida.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoadingDepartureId(null);
    }
  }

  async function handleUpdateDeparture(e: FormEvent) {
    e.preventDefault();
    if (!editingDepartureId || !group) {
      return;
    }
    const currentDeparture = group.departures.find(
      (item) => item.id_travel_group_departure === editingDepartureId,
    );
    if (!currentDeparture) {
      const msg = "No encontramos la salida seleccionada para editar.";
      setError(msg);
      toast.error(msg);
      return;
    }

    const parsed = buildDeparturePayload(editingDepartureDraft);
    if (!parsed.payload) {
      setError(parsed.error ?? "No pudimos validar la salida.");
      toast.error(parsed.error ?? "No pudimos validar la salida.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      const routeId =
        currentDeparture.public_id ||
        String(currentDeparture.id_travel_group_departure);
      await requestGroupApi(
        `/api/groups/${encodeURIComponent(groupId)}/departures/${encodeURIComponent(routeId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(parsed.payload),
        },
        "No pudimos actualizar la salida.",
      );
      setEditingDepartureId(null);
      setEditingDepartureDraft(defaultDepartureDraft());
      setMessage("Salida actualizada correctamente.");
      toast.success("Salida actualizada correctamente.");
      await fetchAll();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "No pudimos actualizar la salida.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteDeparture(dep: Departure) {
    const confirmed = window.confirm(
      `¿Seguro que querés eliminar la salida "${dep.name}"?`,
    );
    if (!confirmed) return;

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      const routeId = dep.public_id || String(dep.id_travel_group_departure);
      await requestGroupApi(
        `/api/groups/${encodeURIComponent(groupId)}/departures/${encodeURIComponent(routeId)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
        "No pudimos eliminar la salida.",
      );
      if (editingDepartureId === dep.id_travel_group_departure) {
        setEditingDepartureId(null);
        setEditingDepartureDraft(defaultDepartureDraft());
      }
      setMessage("Salida eliminada correctamente.");
      toast.success("Salida eliminada correctamente.");
      await fetchAll();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "No pudimos eliminar la salida.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function focusPassengerPanel(passengerId: number) {
    setActivePassengerId(passengerId);
  }

  const showPrimaryDepartureEditForm =
    Boolean(primaryDeparture) &&
    editingDepartureId === primaryDeparture?.id_travel_group_departure;

  const departureEditForm = (
    <form
      onSubmit={handleUpdateDeparture}
      className="space-y-3 rounded-2xl border border-amber-300/80 bg-amber-100/40 p-4 dark:border-amber-500/70 dark:bg-amber-900/15"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Formulario de salida
        </p>
        <button
          type="button"
          onClick={() => {
            setEditingDepartureId(null);
            setEditingDepartureDraft(defaultDepartureDraft());
          }}
          className="rounded-full border border-amber-300 bg-amber-50/90 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200"
        >
          Cancelar
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Nombre
          <input
            value={editingDepartureDraft.name}
            onChange={(e) =>
              setEditingDepartureDraft((prev) => ({
                ...prev,
                name: e.target.value,
              }))
            }
            disabled={submitting}
            className={FIELD_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Cupo total
          <input
            value={editingDepartureDraft.capacity_total}
            onChange={(e) =>
              setEditingDepartureDraft((prev) => ({
                ...prev,
                capacity_total: e.target.value,
              }))
            }
            inputMode="numeric"
            disabled={submitting}
            className={FIELD_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Fecha de salida
          <input
            type="date"
            value={editingDepartureDraft.departure_date}
            onChange={(e) =>
              setEditingDepartureDraft((prev) => ({
                ...prev,
                departure_date: e.target.value,
              }))
            }
            disabled={submitting}
            className={FIELD_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Fecha de regreso
          <input
            type="date"
            value={editingDepartureDraft.return_date}
            onChange={(e) =>
              setEditingDepartureDraft((prev) => ({
                ...prev,
                return_date: e.target.value,
              }))
            }
            disabled={submitting}
            className={FIELD_INPUT_CLASS}
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-full border border-amber-300 bg-amber-100/90 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200"
      >
        {submitting ? (
          <Spinner label="Guardando salida..." />
        ) : (
          "Guardar cambios de salida"
        )}
      </button>
    </form>
  );

  if (loading && !group) {
    return (
      <main className="min-h-screen px-4 py-6 text-sky-950 dark:text-sky-50 sm:px-6 lg:px-8 [&_*]:!text-sky-950 dark:[&_*]:!text-sky-50">
        <div className="mx-auto max-w-7xl rounded-3xl border border-sky-200/80 bg-white/70 p-6 shadow-sm shadow-slate-900/10 backdrop-blur-md dark:border-sky-700/40 dark:bg-sky-950/10">
          Cargando grupal...
        </div>
      </main>
    );
  }

  if (!group) {
    return (
      <main className="min-h-screen px-4 py-6 text-sky-950 dark:text-sky-50 sm:px-6 lg:px-8 [&_*]:!text-sky-950 dark:[&_*]:!text-sky-50">
        <div className="mx-auto max-w-7xl rounded-3xl border border-amber-300/80 bg-amber-100/90 p-6 text-amber-900 shadow-sm shadow-amber-900/10 backdrop-blur-sm dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200">
          {error || "No se encontró la grupal."}
          <div className="mt-3">
            <Link
              href="/groups"
              className="rounded-full border border-slate-300 bg-white/90 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-sky-600/40 dark:bg-sky-950/20 dark:text-slate-200 dark:hover:border-sky-500/50"
            >
              Volver a grupales
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-6 text-sky-950 dark:text-sky-50 sm:px-6 lg:px-8 [&_*]:!text-sky-950 dark:[&_*]:!text-sky-50 [&_input]:border-sky-300/80 [&_input]:!text-sky-950 dark:[&_input]:border-sky-700/40 dark:[&_input]:bg-sky-950/20 dark:[&_input]:!text-sky-50 [&_select:hover]:cursor-pointer [&_select]:border-sky-300/80 [&_select]:!text-sky-950 dark:[&_select]:border-sky-700/40 dark:[&_select]:bg-sky-950/20 dark:[&_select]:!text-sky-50 [&_textarea]:border-sky-300/80 [&_textarea]:!text-sky-950 dark:[&_textarea]:border-sky-700/40 dark:[&_textarea]:bg-sky-950/20 dark:[&_textarea]:!text-sky-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header
          id="panel-resumen"
          className="rounded-3xl border border-sky-200/80 bg-white p-6 shadow-sm shadow-slate-900/10 backdrop-blur-md dark:border-sky-600/30 dark:bg-sky-950/10"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto,1fr,auto] md:items-center">
            <Link
              href="/groups"
              className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-300 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 dark:border-sky-600/30 dark:bg-sky-950/20 dark:text-slate-200 dark:hover:border-sky-600"
            >
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
                  d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
                />
              </svg>
              Volver
            </Link>
            <div className="min-w-0 text-right">
              <h1 className="truncate text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {group.name}
              </h1>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400">
                Detalle de grupal
              </p>
            </div>
            <div className="hidden md:block" aria-hidden />
          </div>
        </header>

        <nav className="sticky top-3 z-10 rounded-2xl border border-sky-200/80 bg-white p-2 shadow-sm shadow-slate-900/10 dark:border-sky-600/30 dark:bg-sky-950/20">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {SECTION_FILTERS.map((section) => (
                <button
                  type="button"
                  key={`section-filter-${section.id}`}
                  onClick={() => setSectionFilter(section.id)}
                  className={pillClass(
                    sectionFilter === section.id,
                    section.tone,
                  )}
                >
                  {section.label}
                </button>
              ))}
            </div>

            {showDepartureSelector ? (
              <label className="relative flex w-fit items-center rounded-xl border border-sky-300/80 bg-sky-50/70 px-2.5 py-1 text-[11px] font-medium dark:border-sky-500/60 dark:bg-sky-900/20">
                <select
                  value={
                    activeDepartureId ??
                    sortedDepartures[0]?.id_travel_group_departure ??
                    ""
                  }
                  onChange={(e) => {
                    const nextDepartureId = e.target.value
                      ? Number(e.target.value)
                      : null;
                    setActiveDepartureId(nextDepartureId);
                    void fetchAll(nextDepartureId);
                  }}
                  disabled={loading || submitting}
                  className="w-full bg-transparent text-[11px] font-normal outline-none"
                >
                  {sortedDepartures.map((dep) => (
                    <option
                      key={`active-departure-${dep.id_travel_group_departure}`}
                      value={dep.id_travel_group_departure}
                    >
                      {dep.name} · {formatDate(dep.departure_date)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </nav>

        {showGroupPanels && isSingleDepartureMode ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
              Salida principal
            </p>
            <section className="overflow-auto rounded-3xl border border-sky-200/80 bg-white shadow-sm shadow-slate-900/10 backdrop-blur-md dark:border-sky-600/30 dark:bg-sky-950/10">
              <CollapsibleSectionHeader
                open={showPrimaryDeparturePanel}
                onToggle={() => {
                  const next = !showPrimaryDeparturePanel;
                  setShowPrimaryDeparturePanel(next);
                  if (
                    next &&
                    primaryDeparture &&
                    editingDepartureId !==
                      primaryDeparture.id_travel_group_departure &&
                    loadingDepartureId !==
                      primaryDeparture.id_travel_group_departure
                  ) {
                    void startEditDeparture(primaryDeparture);
                  }
                }}
                title="Salida principal"
                subtitle={
                  primaryDeparture
                    ? formatDepartureReference(primaryDeparture)
                    : "Sin salida creada"
                }
              />
              <CollapsiblePanel
                open={showPrimaryDeparturePanel}
                className="px-5 pb-5 pt-4 md:px-6"
              >
                {!primaryDeparture ? (
                  <p className="rounded-2xl border border-sky-300/70 bg-white px-4 py-3 text-sm text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                    Todavía no hay salida principal creada.
                  </p>
                ) : showPrimaryDepartureEditForm ? (
                  departureEditForm
                ) : (
                  <div className="rounded-2xl border border-sky-300/70 bg-white px-4 py-3 text-sm text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                    Cargando formulario de salida...
                  </div>
                )}
              </CollapsiblePanel>
            </section>
          </>
        ) : null}

        {error ? (
          <p className="rounded-2xl border border-amber-300/80 bg-amber-100/90 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-2xl border border-emerald-300/80 bg-emerald-100/90 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-500/70 dark:bg-emerald-900/10 dark:text-emerald-200">
            {message}
          </p>
        ) : null}

        {showGroupPanels && showDepartureSection ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
              Gestión de salidas
            </p>
            <section
              id="panel-salidas"
              className="overflow-auto rounded-3xl border border-sky-200/80 bg-white shadow-sm shadow-slate-900/10 backdrop-blur-md dark:border-sky-600/30 dark:bg-sky-950/10"
            >
              <CollapsibleSectionHeader
                open={showDeparturePanel}
                onToggle={() => setShowDeparturePanel((prev) => !prev)}
                title={
                  isSingleDepartureMode
                    ? "Salida principal"
                    : "Salidas"
                }
                subtitle={
                  isSingleDepartureMode
                    ? "Creá la salida principal para operar esta grupal."
                    : "Creá, editá o eliminá lotes/salidas de esta grupal."
                }
              />
              <CollapsiblePanel
                open={showDeparturePanel}
                className="px-5 pb-5 pt-4 md:px-6"
              >
                {!isSingleDepartureMode || sortedDepartures.length === 0 ? (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      {isSingleDepartureMode
                        ? "La capacidad se define por salida."
                        : `${sortedDepartures.length} salida${sortedDepartures.length === 1 ? "" : "s"} cargada${sortedDepartures.length === 1 ? "" : "s"}.`}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDepartureCreate((prev) => !prev);
                          if (!showDepartureCreate) {
                            setCreateDepartureDraft(
                              defaultDepartureDraft({
                                name: group.name,
                                status: group.status,
                                capacity_total: group.capacity_total,
                              }),
                            );
                          }
                        }}
                        className={pillClass(showDepartureCreate, "sky")}
                      >
                        {showDepartureCreate
                          ? "Cancelar nueva salida"
                          : isSingleDepartureMode
                            ? "Crear salida principal"
                            : "Agregar salida"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {sortedDepartures.length === 0 ? (
                  <p className="rounded-2xl border border-sky-300/70 bg-white px-4 py-3 text-sm text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                    {isSingleDepartureMode
                      ? "La salida principal todavía no está creada."
                      : "Esta grupal todavía no tiene salidas cargadas."}
                  </p>
                ) : isSingleDepartureMode ? null : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {sortedDepartures.map((dep) => (
                      <article
                        key={dep.id_travel_group_departure}
                        className="rounded-2xl border border-sky-300/70 bg-white p-4 shadow-sm shadow-slate-900/10 dark:border-sky-600/30 dark:bg-sky-950/10"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {dep.name}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {formatDepartureReference(dep)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
                            <span>
                              Salida: {formatDate(dep.departure_date)}
                            </span>
                            <span>Regreso: {formatDate(dep.return_date)}</span>
                            <span>Cupo: {dep.capacity_total ?? "-"}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void startEditDeparture(dep)}
                              disabled={
                                submitting ||
                                loadingDepartureId ===
                                  dep.id_travel_group_departure
                              }
                              className="inline-flex items-center justify-center rounded-full border border-sky-300 bg-sky-50/70 p-2 text-sky-800 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-600/30 dark:bg-sky-950/20 dark:text-sky-200 dark:hover:border-sky-600"
                              title="Editar salida"
                              aria-label="Editar salida"
                            >
                              {loadingDepartureId ===
                              dep.id_travel_group_departure ? (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="size-4 animate-spin"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M16 16v-3a4 4 0 0 0-8 0v3"
                                  />
                                  <circle
                                    cx="12"
                                    cy="17"
                                    r="1"
                                    fill="currentColor"
                                  />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M4 12a8 8 0 0 1 8-8"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  strokeWidth={1.5}
                                  stroke="currentColor"
                                  className="size-5 p-px"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                                  />
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteDeparture(dep)}
                              disabled={submitting}
                              className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-rose-100/90 p-2 text-rose-800 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/70 dark:bg-rose-900/15 dark:text-rose-200"
                              title="Eliminar salida"
                              aria-label="Eliminar salida"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.5}
                                stroke="currentColor"
                                className="size-5 p-px"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <CollapsiblePanel open={showDepartureCreate} className="mt-4">
                  <form
                    onSubmit={handleCreateDeparture}
                    className="space-y-3 rounded-2xl border border-sky-300/70 bg-white p-4 dark:border-sky-600/30 dark:bg-sky-950/10"
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Nueva salida
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      El código de salida se genera automáticamente.
                    </p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-sm">
                        Nombre
                        <input
                          value={createDepartureDraft.name}
                          onChange={(e) =>
                            setCreateDepartureDraft((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                          placeholder="Lote 1 / Salida principal"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Cupo total de esta salida
                        <input
                          value={createDepartureDraft.capacity_total}
                          onChange={(e) =>
                            setCreateDepartureDraft((prev) => ({
                              ...prev,
                              capacity_total: e.target.value,
                            }))
                          }
                          inputMode="numeric"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                          placeholder="20"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Fecha de salida
                        <input
                          type="date"
                          value={createDepartureDraft.departure_date}
                          onChange={(e) =>
                            setCreateDepartureDraft((prev) => ({
                              ...prev,
                              departure_date: e.target.value,
                            }))
                          }
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Fecha de regreso
                        <input
                          type="date"
                          value={createDepartureDraft.return_date}
                          onChange={(e) =>
                            setCreateDepartureDraft((prev) => ({
                              ...prev,
                              return_date: e.target.value,
                            }))
                          }
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-full border border-sky-300 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-600/30 dark:bg-sky-950/20 dark:text-slate-200 dark:hover:border-sky-600"
                    >
                      {submitting ? (
                        <Spinner label="Creando salida..." />
                      ) : (
                        "Crear salida"
                      )}
                    </button>
                  </form>
                </CollapsiblePanel>

                {!isSingleDepartureMode ? (
                  <CollapsiblePanel
                    open={Boolean(editingDepartureId)}
                    className="mt-4"
                  >
                    {departureEditForm}
                  </CollapsiblePanel>
                ) : null}
              </CollapsiblePanel>
            </section>
          </>
        ) : null}

        {showGroupPanels ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
              Gestión de pasajeros
            </p>
            <section
              id="panel-pasajero-activo"
              className="overflow-auto rounded-3xl border border-sky-200/80 bg-white shadow-sm shadow-slate-900/10 backdrop-blur-md dark:border-sky-600/30 dark:bg-sky-950/10"
            >
              <CollapsibleSectionHeader
                open={showPassengerForm}
                onToggle={() => setShowPassengerForm((prev) => !prev)}
                title="Pax"
                subtitle="Un único formulario para alta y edición de pasajeros."
              />

              <CollapsiblePanel
                open={showPassengerForm}
                className="px-5 pb-5 pt-4 md:px-6"
              >
                <div className="flex flex-wrap items-center gap-4">
                  <div className="inline-flex items-center gap-1 rounded-2xl bg-sky-50 p-1.5 shadow-inner dark:bg-sky-900/15">
                    <button
                      type="button"
                      onClick={() => setPassengerFormMode("ALTA")}
                      className={`rounded-xl border border-transparent px-4 py-1.5 text-xs font-semibold transition ${
                        passengerFormMode === "ALTA"
                          ? "!border-sky-200 bg-sky-50/80 text-sky-950 shadow-sm shadow-sky-700/10 hover:border dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-100"
                          : "text-sky-950 hover:border-sky-200 hover:bg-sky-50/80 dark:text-sky-100 dark:hover:bg-sky-900/50"
                      }`}
                      disabled={submitting}
                    >
                      Alta
                    </button>
                    <button
                      type="button"
                      onClick={() => setPassengerFormMode("EDICION")}
                      className={`rounded-xl border border-transparent px-4 py-1.5 text-xs font-semibold transition ${
                        passengerFormMode === "EDICION"
                          ? "!border-sky-200 bg-sky-50/80 text-sky-950 shadow-sm shadow-sky-700/10 hover:border dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-100"
                          : "text-sky-950 hover:border-sky-200 hover:bg-sky-50/80 dark:text-sky-100 dark:hover:bg-sky-900/50"
                      }`}
                      disabled={submitting || !activePassenger}
                    >
                      Edición
                    </button>
                  </div>

                  {passengerFormMode === "ALTA" ? (
                    <div className="inline-flex items-center gap-1 rounded-2xl bg-sky-50 p-1.5 shadow-inner dark:bg-sky-900/15">
                      <button
                        type="button"
                        onClick={() => setNewPassengerMode("EXISTENTE")}
                        className={`rounded-xl border border-transparent px-4 py-1.5 text-xs font-semibold transition ${
                          newPassengerMode === "EXISTENTE"
                            ? "!border-sky-200 bg-sky-50/80 text-sky-950 shadow-sm shadow-sky-700/10 hover:border dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-100"
                            : "text-sky-950 hover:border-sky-200 hover:bg-sky-50/80 dark:text-sky-100 dark:hover:bg-sky-900/50"
                        }`}
                        disabled={submitting}
                      >
                        Pasajero existente
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewPassengerMode("NUEVO")}
                        className={`rounded-xl border border-transparent px-4 py-1.5 text-xs font-semibold transition ${
                          newPassengerMode === "NUEVO"
                            ? "!border-sky-200 bg-sky-50/80 text-sky-950 shadow-sm shadow-sky-700/10 hover:border dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-100"
                            : "text-sky-950 hover:border-sky-200 hover:bg-sky-50/80 dark:text-sky-100 dark:hover:bg-sky-900/50"
                        }`}
                        disabled={submitting}
                      >
                        Pasajero nuevo
                      </button>
                    </div>
                  ) : null}
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={passengerFormMode}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >
                    {passengerFormMode === "ALTA" ? (
                      <form
                        onSubmit={handleAddPassenger}
                        className="mt-3 flex flex-col gap-4"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={newPassengerMode}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.16, ease: "easeInOut" }}
                          >
                            {newPassengerMode === "EXISTENTE" ? (
                              <div className="space-y-1">
                                <label className="ml-1 block text-sm font-medium text-slate-900 dark:text-slate-100">
                                  Pasajero
                                </label>
                                <div className="flex flex-col gap-2 md:flex-row md:items-end">
                                  <div className="min-w-0 flex-1">
                                    <ClientPicker
                                      label=""
                                      valueId={newPassengerClientId}
                                      onSelect={(client: Client) =>
                                        setNewPassengerClientId(
                                          client.id_client,
                                        )
                                      }
                                      onClear={() =>
                                        setNewPassengerClientId(null)
                                      }
                                      placeholder="Buscar por N° pax, DNI, pasaporte, CUIT o nombre..."
                                    />
                                  </div>
                                  <button
                                    type="submit"
                                    disabled={
                                      submitting || !newPassengerClientId
                                    }
                                    className="h-10 shrink-0 whitespace-nowrap rounded-2xl border border-sky-300 bg-sky-50/70 px-5 text-sm font-semibold text-sky-800 transition hover:border-sky-400 hover:bg-sky-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-600/40 dark:bg-sky-950/20 dark:text-sky-200"
                                  >
                                    {submitting ? (
                                      <Spinner label="Guardando..." />
                                    ) : (
                                      "Agregar pasajero"
                                    )}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <PassengerClientFields
                                draft={newClientDraft}
                                onChange={updateNewClientDraftField}
                                onCustomChange={updateNewClientCustomField}
                                onProfileChange={(key) =>
                                  updateNewClientDraftField("profile_key", key)
                                }
                                disabled={submitting}
                                profileKey={newClientDraft?.profile_key}
                                profileOptions={clientProfileOptions}
                                requiredFields={
                                  newClientProfile.required_fields
                                }
                                hiddenFields={newClientProfile.hidden_fields}
                                customFields={newClientProfile.custom_fields}
                                title="Nuevo pasajero"
                                description="Completá los datos mínimos para crear y sumar el pasajero a esta grupal."
                              />
                            )}
                          </motion.div>
                        </AnimatePresence>

                        {newPassengerMode === "NUEVO" ? (
                          <button
                            type="submit"
                            disabled={submitting}
                            className="rounded-full border border-sky-300 bg-sky-50/70 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:border-sky-400 hover:bg-sky-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-600/40 dark:bg-sky-950/20 dark:text-sky-200"
                          >
                            {submitting ? (
                              <Spinner label="Guardando..." />
                            ) : (
                              "Crear pasajero y agregar"
                            )}
                          </button>
                        ) : null}
                      </form>
                    ) : !activePassenger ? (
                      <p className="mt-3 rounded-2xl border border-sky-300/70 bg-white px-4 py-3 text-sm text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                        Seleccioná un pasajero en la tabla, lista o grilla para
                        editarlo.
                      </p>
                    ) : (
                      <div className="mt-3 flex flex-col gap-4">
                        <div className="w-fit rounded-2xl border border-emerald-300/80 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/70 dark:bg-emerald-900/20 dark:text-emerald-300">
                          Pasajero activo:{" "}
                          <span className="font-semibold text-emerald-900 dark:text-emerald-100">
                            {activePassenger.client
                              ? `${activePassenger.client.first_name} ${activePassenger.client.last_name}`
                              : `Cliente Nº${activePassenger.client_id ?? "-"}`}
                          </span>
                        </div>

                        <form
                          onSubmit={handleSaveActiveClient}
                          className="flex flex-col gap-3"
                        >
                          {activeClientLoading || !activeClientDraft ? (
                            <p className="rounded-2xl border border-sky-300/70 bg-white px-4 py-3 text-xs text-slate-600 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-400">
                              Cargando datos del pasajero...
                            </p>
                          ) : (
                            <>
                              <PassengerClientFields
                                draft={activeClientDraft}
                                onChange={updateActiveClientDraftField}
                                onCustomChange={updateActiveClientCustomField}
                                onProfileChange={(key) =>
                                  updateActiveClientDraftField(
                                    "profile_key",
                                    key,
                                  )
                                }
                                disabled={submitting}
                                profileKey={activeClientDraft?.profile_key}
                                profileOptions={clientProfileOptions}
                                requiredFields={
                                  activeClientProfile.required_fields
                                }
                                hiddenFields={activeClientProfile.hidden_fields}
                                customFields={activeClientProfile.custom_fields}
                                title="Datos personales del pasajero"
                                description="Este bloque se reutiliza para editar la información del pasajero activo."
                              />
                              <div className="space-y-3">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  Datos operativos
                                </p>
                                {!isSingleDepartureMode && (
                                  <label className="flex flex-col gap-1 text-sm">
                                    <span className="ml-1 font-medium text-slate-900 dark:text-slate-100">
                                      Salida
                                    </span>
                                    <select
                                      value={activePassengerDepartureId}
                                      onChange={(e) =>
                                        setActivePassengerDepartureId(
                                          e.target.value,
                                        )
                                      }
                                      disabled={submitting}
                                      className="rounded-2xl border bg-white/90 px-3 py-2 shadow-sm shadow-slate-900/10 outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                      <option value="CLEAR">
                                        Sin salida asignada
                                      </option>
                                      {sortedDepartures.map((dep) => (
                                        <option
                                          key={dep.id_travel_group_departure}
                                          value={
                                            dep.public_id ||
                                            dep.id_travel_group_departure
                                          }
                                        >
                                          {dep.name} ·{" "}
                                          {formatDate(dep.departure_date)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                                <div className="space-y-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setShowPassengerInternalNote(
                                        (prev) => !prev,
                                      )
                                    }
                                    className={`${pillClass(
                                      showPassengerInternalNote,
                                      "sky",
                                    )} inline-flex items-center gap-2`}
                                  >
                                    Nota interna (opcional)
                                  </button>
                                  <CollapsiblePanel
                                    open={showPassengerInternalNote}
                                    className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10"
                                  >
                                    <label className="flex flex-col gap-1 text-sm">
                                      <span className="ml-1 font-medium text-slate-900 dark:text-slate-100">
                                        Nota interna
                                      </span>
                                      <textarea
                                        value={activePassengerNote}
                                        onChange={(e) =>
                                          setActivePassengerNote(e.target.value)
                                        }
                                        rows={2}
                                        disabled={submitting}
                                        placeholder="Observaciones de este pasajero dentro de la grupal..."
                                        className={FIELD_TEXTAREA_CLASS}
                                      />
                                    </label>
                                  </CollapsiblePanel>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="submit"
                                  disabled={submitting}
                                  className="rounded-full border border-sky-300 bg-sky-50/70 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:border-sky-400 hover:bg-sky-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-600/40 dark:bg-sky-950/20 dark:text-sky-200"
                                >
                                  {submitting ? (
                                    <Spinner label="Guardando..." />
                                  ) : (
                                    "Guardar datos personales"
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() =>
                                    void handleDeletePassenger(activePassenger)
                                  }
                                  className="rounded-full border border-rose-300 bg-rose-100/90 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/70 dark:bg-rose-900/15 dark:text-rose-200"
                                >
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
                                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </>
                          )}
                        </form>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </CollapsiblePanel>
            </section>
          </>
        ) : null}

        {showGroupPanels ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
              Servicios de la grupal
            </p>
            <section
              id="panel-servicios"
              className="overflow-auto rounded-3xl border border-sky-200/80 bg-white shadow-sm shadow-slate-900/10 backdrop-blur-md dark:border-sky-600/30 dark:bg-sky-950/10"
            >
              <CollapsibleSectionHeader
                open={showInventoryForm}
                onToggle={() => {
                  setShowInventoryForm((prev) => !prev);
                  if (showInventoryForm) {
                    setEditingInventoryId(null);
                    setShowInventoryInternalNote(false);
                    setInventoryDraft(
                      defaultInventoryDraft(undefined, {
                        defaultTransferFeePct,
                        operators: operatorOptions,
                      }),
                    );
                  }
                }}
                title="Servicios"
                subtitle={
                  editingInventoryId
                    ? "Edición de servicio activa."
                    : "Agregá y administrá servicios por salida o generales."
                }
              />
              {serviceOptionsError ? (
                <p className="mx-5 mt-3 rounded-2xl border border-amber-300/80 bg-amber-100/85 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/70 dark:bg-amber-900/15 dark:text-amber-200 md:mx-6">
                  {serviceOptionsError}
                </p>
              ) : null}
              <CollapsiblePanel
                open={showInventoryForm}
                className="px-5 pb-5 pt-4 md:px-6"
              >
                <form
                  onSubmit={handleSaveInventory}
                  className="space-y-4 rounded-2xl border border-sky-300/70 bg-white p-4 dark:border-sky-600/30 dark:bg-sky-950/10"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Datos del servicio
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Cargá inventario con tipo, nombre, operador y precios.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                      Servicio
                    </p>
                    <div
                      className={`mt-3 grid grid-cols-1 gap-3 ${
                        isSingleDepartureMode
                          ? "md:grid-cols-2"
                          : "lg:grid-cols-3"
                      }`}
                    >
                      <label className="flex flex-col gap-1 text-sm">
                        Tipo de servicio
                        <select
                          value={inventoryDraft.service_type}
                          onChange={(e) => {
                            const next = e.target.value;
                            const selected = serviceTypeOptions.find(
                              (item) => item.code === next,
                            );
                            setInventoryDraft((prev) => ({
                              ...prev,
                              service_type: next,
                              inventory_type:
                                selected?.name?.trim() || prev.inventory_type,
                            }));
                          }}
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        >
                          <option value="">Seleccionar tipo</option>
                          {serviceTypeOptions.map((option) => (
                            <option
                              key={option.id_service_type}
                              value={option.code}
                            >
                              {option.name}
                            </option>
                          ))}
                          {inventoryDraft.service_type &&
                          !serviceTypeOptions.some(
                            (item) => item.code === inventoryDraft.service_type,
                          ) ? (
                            <option value={inventoryDraft.service_type}>
                              {inventoryDraft.inventory_type?.trim() ||
                                "Tipo guardado (no disponible)"}
                            </option>
                          ) : null}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Nombre / etiqueta
                        <input
                          value={inventoryDraft.label}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              label: e.target.value,
                            }))
                          }
                          placeholder="Ej: Bloqueo hotel Río / Aéreo AR1234"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      {!isSingleDepartureMode ? (
                        <label className="flex flex-col gap-1 text-sm">
                          Salida activa
                          <select
                            value={inventoryDraft.departure_id}
                            onChange={(e) =>
                              setInventoryDraft((prev) => ({
                                ...prev,
                                departure_id: e.target.value,
                              }))
                            }
                            disabled={submitting || activeDepartureId != null}
                            className={FIELD_INPUT_CLASS}
                          >
                            {activeDeparture ? (
                              <option
                                value={
                                  activeDeparture.public_id ||
                                  activeDeparture.id_travel_group_departure
                                }
                              >
                                {activeDeparture.name} ·{" "}
                                {formatDate(activeDeparture.departure_date)}
                              </option>
                            ) : (
                              <option value="">
                                Seleccioná una salida desde la barra superior
                              </option>
                            )}
                          </select>
                          <span className={FIELD_HINT_CLASS}>
                            Los servicios nuevos se guardan sobre la salida
                            activa.
                          </span>
                        </label>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                      Operador
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-sm">
                        Operador
                        <select
                          value={inventoryDraft.operator_id}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            const selected = operatorOptions.find(
                              (item) => String(item.id_operator) === nextId,
                            );
                            setInventoryDraft((prev) => ({
                              ...prev,
                              operator_id: nextId,
                              provider: selected?.name || prev.provider,
                            }));
                          }}
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        >
                          <option value="">
                            {operatorOptions.length > 0
                              ? "Seleccionar operador"
                              : "Sin operadores disponibles"}
                          </option>
                          {operatorOptions.map((operator) => (
                            <option
                              key={operator.id_operator}
                              value={operator.id_operator}
                            >
                              {operator.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Cupos comprados
                        <input
                          value={inventoryDraft.total_qty}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              total_qty: e.target.value,
                            }))
                          }
                          inputMode="numeric"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Localizador / referencia (opcional)
                        <input
                          value={inventoryDraft.locator}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              locator: e.target.value,
                            }))
                          }
                          disabled={submitting}
                          placeholder="Ej: ABC123 / LOC-7788"
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                      Precios e impuestos
                    </p>
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                      Modo de venta: por unidad.
                    </p>

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-sm">
                        Moneda
                        <select
                          value={inventoryDraft.currency}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              currency: e.target.value.toUpperCase(),
                            }))
                          }
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        >
                          {inventoryCurrencyOptions.map((code) => (
                            <option key={code} value={code}>
                              {currencyLabelByCode.get(code) || code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Costo unitario
                        <input
                          value={inventoryDraft.unit_cost}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              unit_cost: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          placeholder="0,00"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Venta unitaria estimada
                        <input
                          value={inventoryDraft.sale_unit_price}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              sale_unit_price: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          placeholder="0,00"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Base/importe 21% (opcional)
                        <input
                          value={inventoryDraft.taxable_21}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              taxable_21: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          placeholder="0,00"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Base/importe 10,5% (opcional)
                        <input
                          value={inventoryDraft.taxable_105}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              taxable_105: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          placeholder="0,00"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Exento (opcional)
                        <input
                          value={inventoryDraft.exempt_amount}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              exempt_amount: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          placeholder="0,00"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Otros impuestos (opcional)
                        <input
                          value={inventoryDraft.other_taxes}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              other_taxes: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          placeholder="0,00"
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Costo de transferencia (%)
                        <input
                          value={inventoryDraft.transfer_fee_pct}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              transfer_fee_pct: e.target.value,
                            }))
                          }
                          inputMode="decimal"
                          placeholder={String(defaultTransferFeePct)}
                          disabled={submitting}
                          className={FIELD_INPUT_CLASS}
                        />
                        <span className="ml-1 text-xs text-slate-600 dark:text-slate-400">
                          Se usa para estimar costo financiero de cobro sobre la
                          venta.
                        </span>
                      </label>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 rounded-2xl border border-sky-300/70 bg-white p-3 text-xs text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/5 dark:text-slate-300 md:grid-cols-2">
                      <p>
                        Costo total estimado:{" "}
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(
                            inventoryDraftPreview.costTotal,
                            inventoryDraft.currency || "ARS",
                          )}
                        </span>
                      </p>
                      <p>
                        Venta estimada:{" "}
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(
                            inventoryDraftPreview.saleTotal,
                            inventoryDraft.currency || "ARS",
                          )}
                        </span>
                      </p>
                      <p>
                        Costos/impuestos adicionales:{" "}
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(
                            inventoryDraftPreview.taxes +
                              inventoryDraftPreview.transferFeeAmount,
                            inventoryDraft.currency || "ARS",
                          )}
                        </span>
                      </p>
                      <p>
                        Margen bruto estimado:{" "}
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatMoney(
                            inventoryDraftPreview.margin,
                            inventoryDraft.currency || "ARS",
                          )}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() =>
                        setShowInventoryInternalNote((prev) => !prev)
                      }
                      className={`${pillClass(
                        showInventoryInternalNote,
                        "sky",
                      )} inline-flex items-center gap-2`}
                    >
                      Nota interna (opcional)
                    </button>
                    <CollapsiblePanel
                      open={showInventoryInternalNote}
                      className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10"
                    >
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="ml-1 font-medium text-slate-900 dark:text-slate-100">
                          Nota interna
                        </span>
                        <textarea
                          value={inventoryDraft.note}
                          onChange={(e) =>
                            setInventoryDraft((prev) => ({
                              ...prev,
                              note: e.target.value,
                            }))
                          }
                          rows={2}
                          disabled={submitting}
                          className={FIELD_TEXTAREA_CLASS}
                        />
                      </label>
                    </CollapsiblePanel>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-full border border-sky-300 bg-sky-50/70 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:border-sky-400 hover:bg-sky-100/70 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-600/40 dark:bg-sky-950/20 dark:text-sky-200"
                  >
                    {submitting ? (
                      <Spinner label="Guardando servicio..." />
                    ) : editingInventoryId ? (
                      "Guardar servicio"
                    ) : (
                      "Agregar servicio"
                    )}
                  </button>
                </form>
              </CollapsiblePanel>
            </section>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {inventories.length === 0 ? (
                <p className="rounded-2xl border border-sky-300/80 bg-white px-4 py-3 text-sm text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300 lg:col-span-3">
                  Todavía no hay servicios cargados.
                </p>
              ) : (
                inventories.map((item) => {
                  const parsedNote = parseInventoryNote(item.note ?? "");
                  const metrics = inventoryFinancialById.get(
                    item.id_travel_group_inventory,
                  );
                  return (
                    <article
                      key={item.id_travel_group_inventory}
                      className="rounded-2xl border border-sky-300/80 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {item.label}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {item.inventory_type}
                            {item.service_type ? ` · ${item.service_type}` : ""}
                            {item.travelGroupDeparture?.name
                              ? ` · ${item.travelGroupDeparture.name}`
                              : ""}
                            {item.provider ? ` · ${item.provider}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <span className="rounded-full border border-sky-300/80 bg-sky-50/60 px-2 py-0.5 dark:border-sky-600/40 dark:bg-sky-950/20">
                          Comprados: {item.total_qty}
                        </span>
                        <span className="rounded-full border border-sky-300/80 bg-sky-50/60 px-2 py-0.5 dark:border-sky-600/40 dark:bg-sky-950/20">
                          Asignados a pasajeros: {item.assigned_qty}
                        </span>
                        {metrics ? (
                          <>
                            <span className="rounded-full border border-sky-300/80 bg-sky-50/60 px-2 py-0.5 dark:border-sky-600/40 dark:bg-sky-950/20">
                              Costo total:{" "}
                              {formatMoney(metrics.costTotal, metrics.currency)}
                            </span>
                            {metrics.saleTotal > 0 ? (
                              <span className="rounded-full border border-emerald-300/80 bg-emerald-50/50 px-2 py-0.5 text-emerald-800 dark:border-emerald-500/70 dark:bg-emerald-900/10 dark:text-emerald-200">
                                Venta estimada:{" "}
                                {formatMoney(
                                  metrics.saleTotal,
                                  metrics.currency,
                                )}
                              </span>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEditInventory(item)}
                          disabled={submitting}
                          className="inline-flex items-center justify-center rounded-full border border-sky-300 bg-sky-50/70 px-4 py-2 text-sky-800 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-600/40 dark:bg-sky-950/20 dark:text-sky-200 dark:hover:border-sky-600"
                          title="Editar servicio"
                          aria-label="Editar servicio"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="size-5 p-px"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteInventory(item)}
                          disabled={submitting}
                          className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-rose-100/90 px-4 py-2 text-rose-800 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/70 dark:bg-rose-900/15 dark:text-rose-200"
                          title="Eliminar servicio"
                          aria-label="Eliminar servicio"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="size-5 p-px"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </svg>
                        </button>
                      </div>
                      {parsedNote.noteText ? (
                        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                          Nota: {parsedNote.noteText}
                        </p>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </>
        ) : null}

        {showCobrosPanels ? (
          <section id="panel-cobros" className="">
            <div className="mt-4 space-y-4">
              {passengers.length === 0 ? (
                <p className={FLAT_NOTE_CLASS}>
                  Todavía no hay pasajeros vinculados para gestionar cobros.
                </p>
              ) : !selectedCollectPassenger ? (
                <p className={FLAT_NOTE_CLASS}>
                  Seleccioná un pasajero activo en la tabla para continuar.
                </p>
              ) : !selectedCollectClientId ? (
                <p className={FLAT_NOTE_CLASS}>
                  El pasajero activo no tiene contexto financiero válido.
                </p>
              ) : !collectContext ? (
                <p className={FLAT_NOTE_CLASS}>
                  {collectLoading
                    ? "Cargando datos de cobro..."
                    : "No encontramos el contexto financiero del pasajero."}
                </p>
              ) : (
                <div className="flex flex-col gap-5">
                  <div className="w-fit rounded-2xl border border-emerald-300/80 bg-emerald-50/30 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/70 dark:bg-emerald-900/20 dark:text-emerald-300">
                    Pasajero activo:{" "}
                    <span className="font-semibold text-emerald-900 dark:text-emerald-100">
                      {selectedCollectPassenger.client
                        ? `${selectedCollectPassenger.client.first_name} ${selectedCollectPassenger.client.last_name}`
                        : `Cliente ${selectedCollectClientId}`}
                    </span>
                  </div>

                  {collectLoadingError ? (
                    <p className={FLAT_WARN_CLASS}>{collectLoadingError}</p>
                  ) : null}

                  <section className="order-2 space-y-4">
                    <div className="mx-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                        Plan de pagos
                      </p>
                    </div>
                    {!token ? (
                      <p className={FLAT_WARN_CLASS}>
                        Necesitás sesión activa para crear cuotas del pasajero.
                      </p>
                    ) : (
                      <GroupClientPaymentForm
                        token={token}
                        context={collectContext}
                        groupId={groupId}
                        groupPassengerId={
                          selectedCollectPassenger.id_travel_group_passenger
                        }
                        groupDepartureId={
                          selectedCollectPassenger.travelGroupDeparture
                            ?.id_travel_group_departure ?? null
                        }
                        defaultClientId={selectedCollectClientId}
                        lockClient={true}
                        onCreated={() => {
                          void refreshCollectData();
                        }}
                      />
                    )}
                    <GroupClientPaymentList
                      payments={collectClientPayments}
                      context={collectContext}
                      groupId={groupId}
                      role={financeRole}
                      loading={collectLoading}
                      onPaymentDeleted={() => {
                        void refreshCollectData();
                      }}
                    />
                  </section>

                  <section className="order-1 space-y-4">
                    <div className="mx-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                        Agregar recibo
                      </p>
                    </div>
                    {!token ? (
                      <p className={FLAT_WARN_CLASS}>
                        Necesitás sesión activa para crear/editar recibos.
                      </p>
                    ) : (
                      <GroupReceiptForm
                        token={token}
                        groupId={groupId}
                        groupPassengerId={
                          selectedCollectPassenger.id_travel_group_passenger
                        }
                        requireServiceSelection={false}
                        editingReceiptId={
                          editingCollectReceipt?.id_receipt ?? null
                        }
                        isFormVisible={collectReceiptFormVisible}
                        setIsFormVisible={setCollectReceiptFormVisible}
                        contextId={
                          Number(
                            collectContext?.id_context ??
                              collectContext?.id_booking ??
                              0,
                          ) || undefined
                        }
                        allowAgency={false}
                        initialServiceIds={
                          editingCollectReceipt?.serviceIds || []
                        }
                        initialConcept={editingCollectReceipt?.concept || ""}
                        initialAmount={
                          editingCollectReceipt
                            ? toAmountNumber(editingCollectReceipt.amount)
                            : undefined
                        }
                        initialCurrency={
                          editingCollectReceipt?.amount_currency
                            ? normalizeCurrencyCode(
                                editingCollectReceipt.amount_currency,
                              )
                            : undefined
                        }
                        initialAmountWords={
                          editingCollectReceipt?.amount_string || ""
                        }
                        initialAmountWordsCurrency={
                          editingCollectReceipt?.base_currency
                            ? normalizeCurrencyCode(
                                editingCollectReceipt.base_currency,
                              )
                            : undefined
                        }
                        initialPaymentDescription={
                          editingCollectReceipt?.currency || ""
                        }
                        initialFeeAmount={
                          editingCollectReceipt?.payment_fee_amount != null
                            ? toAmountNumber(
                                editingCollectReceipt.payment_fee_amount,
                              )
                            : undefined
                        }
                        initialIssueDate={toDateInputValue(
                          editingCollectReceipt?.issue_date,
                        )}
                        initialBaseAmount={
                          editingCollectReceipt?.base_amount ?? null
                        }
                        initialBaseCurrency={
                          editingCollectReceipt?.base_currency ?? null
                        }
                        initialCounterAmount={
                          editingCollectReceipt?.counter_amount ?? null
                        }
                        initialCounterCurrency={
                          editingCollectReceipt?.counter_currency ?? null
                        }
                        initialClientIds={[Number(selectedCollectClientId)]}
                        lockClientSelection={true}
                        lockedClientLabel={
                          selectedCollectPassenger.client
                            ? `${selectedCollectPassenger.client.first_name} ${selectedCollectPassenger.client.last_name}`.trim()
                            : selectedCollectClientId
                              ? `Cliente ${selectedCollectClientId}`
                              : "Pasajero activo"
                        }
                        loadServicesForContext={loadCollectServicesForContext}
                        onSubmit={async (payload) => {
                          const normalizedPayload = {
                            ...payload,
                            passengerId:
                              selectedCollectPassenger.id_travel_group_passenger,
                            clientIds: [Number(selectedCollectClientId)],
                          };

                          if (editingCollectReceipt?.id_receipt) {
                            const response =
                              await requestGroupApi<SubmitResult>(
                                `/api/groups/${encodeURIComponent(groupId)}/finance/receipts/${editingCollectReceipt.id_receipt}`,
                                {
                                  method: "PATCH",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  credentials: "include",
                                  body: JSON.stringify(normalizedPayload),
                                },
                                "No pudimos actualizar el recibo.",
                              );
                            setEditingCollectReceipt(null);
                            setCollectReceiptFormVisible(false);
                            await refreshCollectData();
                            return response;
                          }

                          const response = await requestGroupApi<SubmitResult>(
                            `/api/groups/${encodeURIComponent(groupId)}/finance/receipts`,
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              credentials: "include",
                              body: JSON.stringify(normalizedPayload),
                            },
                            "No pudimos crear el recibo.",
                          );
                          setCollectReceiptFormVisible(false);
                          await refreshCollectData();
                          return response;
                        }}
                        onCancel={() => {
                          setEditingCollectReceipt(null);
                          setCollectReceiptFormVisible(false);
                        }}
                      />
                    )}

                    {collectReceipts.length > 0 ? (
                      <GroupReceiptList
                        token={token}
                        receipts={collectReceipts}
                        context={collectContext}
                        groupId={groupId}
                        services={collectContextServices}
                        role={financeRole}
                        onReceiptDeleted={() => {
                          void refreshCollectData();
                        }}
                        onReceiptEdit={(receipt) => {
                          setEditingCollectReceipt(receipt);
                          setCollectReceiptFormVisible(true);
                        }}
                      />
                    ) : (
                      <p className={FLAT_NOTE_CLASS}>
                        No hay recibos cargados para este pasajero.
                      </p>
                    )}
                  </section>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {showPagosPanels ? (
          <section id="panel-finanzas" className="">
            <div className="mt-4 space-y-4">
              {!selectedPaymentsScope ? (
                <p className={FLAT_NOTE_CLASS}>
                  Seleccioná una salida para continuar.
                </p>
              ) : !paymentsContext ? (
                <p className={FLAT_NOTE_CLASS}>
                  {paymentsLoading
                    ? "Cargando datos de pagos..."
                    : "No encontramos el contexto financiero."}
                </p>
              ) : (
                <div className="space-y-5">
                  <div className="w-fit rounded-2xl border border-emerald-300/80 bg-emerald-50/30 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/70 dark:bg-emerald-900/20 dark:text-emerald-300">
                    {selectedPaymentsScope.departureId != null
                      ? "Salida activa: "
                      : ""}
                    <span className="font-semibold text-emerald-900 dark:text-emerald-100">
                      {selectedPaymentsScope.label}
                    </span>
                  </div>
                  {paymentsLoadingError ? (
                    <p className={FLAT_WARN_CLASS}>{paymentsLoadingError}</p>
                  ) : null}

                  <section className="space-y-4">
                    <div className="mx-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                        Pagos al operador
                      </p>
                    </div>
                    {!token ? (
                      <p className={FLAT_WARN_CLASS}>
                        Necesitás sesión activa para registrar pagos a operador.
                      </p>
                    ) : (
                      <GroupOperatorPaymentForm
                        token={token}
                        context={paymentsContext}
                        groupId={groupId}
                        groupDepartureId={
                          selectedPaymentsScope.departureId ?? null
                        }
                        availableServices={paymentsContextServices}
                        operators={operatorOptions as unknown as Operator[]}
                        editingPayment={editingOperatorPayment}
                        onCancelEdit={() => {
                          setEditingOperatorPayment(null);
                        }}
                        onCreated={() => {
                          setEditingOperatorPayment(null);
                          setFinanceOperatorPaymentsReloadKey(
                            (prev) => prev + 1,
                          );
                          void refreshPaymentsData();
                        }}
                      />
                    )}
                    <GroupOperatorPaymentList
                      token={token}
                      groupId={groupId}
                      role={financeRole}
                      scopeKey={selectedPaymentsScope.key}
                      reloadKey={financeOperatorPaymentsReloadKey}
                      onPaymentEdit={(payment) => {
                        setEditingOperatorPayment(payment);
                      }}
                      onPaymentDeleted={(deletedId) => {
                        setEditingOperatorPayment((prev) =>
                          prev && prev.id_investment === deletedId ? null : prev,
                        );
                        setFinanceOperatorPaymentsReloadKey((prev) => prev + 1);
                        void refreshPaymentsData();
                      }}
                    />
                  </section>

                  <section className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                      Vencimientos del operador
                    </p>
                    {!token ? (
                      <p className={FLAT_WARN_CLASS}>
                        Necesitás sesión activa para crear vencimientos de
                        operador.
                      </p>
                    ) : (
                      <GroupOperatorDueForm
                        token={token}
                        context={paymentsContext}
                        groupId={groupId}
                        groupDepartureId={
                          selectedPaymentsScope.departureId ?? null
                        }
                        availableServices={paymentsContextServices}
                        onCreated={() => {
                          void refreshPaymentsData();
                        }}
                      />
                    )}
                    <GroupOperatorDueList
                      dues={paymentsOperatorDues}
                      context={paymentsContext}
                      groupId={groupId}
                      role={financeRole}
                      operators={operatorOptions as unknown as Operator[]}
                      loading={paymentsLoading}
                      onDueDeleted={() => {
                        void refreshPaymentsData();
                      }}
                      onStatusChanged={() => {
                        void refreshPaymentsData();
                      }}
                    />
                  </section>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {showFacturacionPanel ? (
          <section id="panel-facturacion" className="">
            <div className="mt-4 space-y-4">
              {passengers.length === 0 ? (
                <p className={FLAT_NOTE_CLASS}>
                  Todavía no hay pasajeros disponibles para facturar.
                </p>
              ) : !selectedFinancePassenger ? (
                <p className={FLAT_NOTE_CLASS}>
                  Seleccioná un pasajero activo en la tabla para ver
                  facturación.
                </p>
              ) : !selectedFinanceScope ? (
                <p className={FLAT_NOTE_CLASS}>
                  No encontramos el contexto financiero del pasajero activo.
                </p>
              ) : !financeContext ? (
                <p className={FLAT_NOTE_CLASS}>
                  {financeLoading
                    ? "Cargando facturación..."
                    : "Contexto operativo no disponible."}
                </p>
              ) : (
                <div className="space-y-5">
                  <div className="w-fit rounded-2xl border border-emerald-300/80 bg-emerald-50/30 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/70 dark:bg-emerald-900/20 dark:text-emerald-300">
                    Pasajero activo:{" "}
                    <span className="font-semibold text-emerald-900 dark:text-emerald-100">
                      {selectedFinancePassenger.client
                        ? `${selectedFinancePassenger.client.first_name} ${selectedFinancePassenger.client.last_name}`
                        : `Cliente ${selectedFinancePassenger.client_id ?? "-"}`}
                    </span>
                  </div>

                  {financeLoadingError ? (
                    <p className={FLAT_WARN_CLASS}>{financeLoadingError}</p>
                  ) : null}

                  <section className="space-y-4">
                    <div className="mx-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                        Emitir factura al pasajero
                      </p>
                    </div>

                    {!selectedFinanceInvoicePassenger ? (
                      <p className={FLAT_NOTE_CLASS}>
                        No hay pasajero activo para facturar.
                      </p>
                    ) : (
                      <>
                        <div className="text-xs text-slate-700 dark:text-slate-300">
                          <p>
                            <span className="font-semibold">Pasajero:</span>{" "}
                            <span className="font-semibold">
                              {selectedFinanceInvoicePassenger.client
                                ? `${selectedFinanceInvoicePassenger.client.first_name} ${selectedFinanceInvoicePassenger.client.last_name}`
                                : selectedFinanceInvoiceClientId
                                  ? `Cliente ${selectedFinanceInvoiceClientId}`
                                  : "Sin seleccionar"}
                            </span>
                          </p>
                        </div>

                        {!token ? (
                          <p className={FLAT_WARN_CLASS}>
                            Necesitás sesión activa para facturar.
                          </p>
                        ) : !selectedFinanceInvoiceClientId ? (
                          <p className={FLAT_NOTE_CLASS}>
                            Seleccioná un pasajero válido para facturar.
                          </p>
                        ) : (
                          <GroupInvoiceForm
                            formData={financeInvoiceFormData}
                            availableServices={financeContextServices}
                            handleChange={handleFinanceInvoiceChange}
                            handleSubmit={handleFinanceInvoiceSubmit}
                            isFormVisible={financeInvoiceFormVisible}
                            setIsFormVisible={setFinanceInvoiceFormVisible}
                            updateFormData={updateFinanceInvoiceFormData}
                            isSubmitting={financeInvoiceSubmitting}
                            token={token}
                            collapsible
                            lockClientSelection={true}
                            lockedClientLabel={
                              selectedFinanceInvoicePassenger.client
                                ? `${selectedFinanceInvoicePassenger.client.first_name} ${selectedFinanceInvoicePassenger.client.last_name}`.trim()
                                : selectedFinanceInvoiceClientId
                                  ? `Cliente ${selectedFinanceInvoiceClientId}`
                                  : "Pasajero activo"
                            }
                          />
                        )}
                      </>
                    )}
                  </section>

                  <section className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                      Facturas
                    </p>
                    <GroupInvoiceList
                      invoices={financeInvoices}
                      loading={financeLoading && financeInvoices.length === 0}
                    />
                  </section>

                  <section className="space-y-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-300">
                      Notas de crédito
                    </p>
                    <CreditNoteList creditNotes={financeCreditNotes} />
                  </section>
                </div>
              )}
            </div>
          </section>
        ) : null}
        {showGroupPanels ? (
          <section
            id="panel-pasajeros"
            className="rounded-3xl border border-sky-200/80 bg-white p-5 shadow-sm shadow-slate-900/10 backdrop-blur-md dark:border-sky-600/30 dark:bg-sky-950/10"
          >
            <div className="my-1 flex flex-wrap items-center justify-between gap-4">
              <h2 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Pasajeros
              </h2>

              <div className="flex items-center gap-1 rounded-full border border-sky-300/70 bg-white p-1 text-xs dark:border-sky-600/30 dark:bg-sky-950/10">
                <button
                  type="button"
                  onClick={() => setPassengerView("GRID")}
                  className={`flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm transition-colors ${
                    passengerView === "GRID"
                      ? "bg-emerald-500/15 text-emerald-700 shadow-sm shadow-emerald-900/20 dark:text-emerald-300"
                      : "text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                  }`}
                  aria-pressed={passengerView === "GRID"}
                >
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
                </button>
                <button
                  type="button"
                  onClick={() => setPassengerView("LIST")}
                  className={`flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm transition-colors ${
                    passengerView === "LIST"
                      ? "bg-emerald-500/15 text-emerald-700 shadow-sm shadow-emerald-900/20 dark:text-emerald-300"
                      : "text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                  }`}
                  aria-pressed={passengerView === "LIST"}
                >
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
                  Lista
                </button>
                <button
                  type="button"
                  onClick={() => setPassengerView("TABLE")}
                  className={`flex items-center justify-center gap-1 rounded-full px-4 py-1.5 text-sm transition-colors ${
                    passengerView === "TABLE"
                      ? "bg-emerald-500/15 text-emerald-700 shadow-sm shadow-emerald-900/20 dark:text-emerald-300"
                      : "text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                  }`}
                  aria-pressed={passengerView === "TABLE"}
                >
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
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300">
              Pasajero activo:{" "}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {activePassenger?.client
                  ? `${activePassenger.client.first_name} ${activePassenger.client.last_name}`
                  : activePassenger
                    ? `Cliente Nº${activePassenger.client_id ?? "-"}`
                    : "Sin seleccionar"}
              </span>
            </p>

            <div className="mt-3 flex w-full flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex w-full items-center gap-2 rounded-2xl border border-sky-300/70 bg-white px-4 py-1 text-slate-900 shadow-sm shadow-slate-900/10 backdrop-blur dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-100">
                <input
                  value={passengerSearch}
                  onChange={(e) => setPassengerSearch(e.target.value)}
                  placeholder="Buscar pasajero/salida/código..."
                  className="w-full bg-transparent py-1 outline-none placeholder:font-light placeholder:tracking-wide"
                />
                <button
                  type="button"
                  aria-label="Buscar"
                  className="p-1 opacity-80 hover:opacity-100"
                  title="Buscar"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="size-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                    />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowPassengerFilters((v) => !v)}
                className="flex items-center justify-center gap-2 rounded-2xl border border-sky-300/70 bg-sky-50/60 px-6 py-2 text-slate-700 shadow-sm backdrop-blur transition hover:border-sky-400 dark:border-sky-600/30 dark:bg-sky-950/20 dark:text-slate-200 dark:hover:border-sky-600"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.4}
                  stroke="currentColor"
                  className="size-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
                  />
                </svg>
                <span>{showPassengerFilters ? "Ocultar" : "Filtros"}</span>
              </button>
            </div>

            <CollapsiblePanel open={showPassengerFilters} className="mt-3">
              <div className="overflow-hidden rounded-3xl border border-sky-300/80 bg-white p-4 text-slate-900 shadow-sm shadow-slate-900/10 backdrop-blur dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-100">
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Estado
                    <select
                      value={passengerStatusFilter}
                      onChange={(e) => setPassengerStatusFilter(e.target.value)}
                      className={FIELD_INPUT_CLASS}
                    >
                      <option value="ALL">Todos</option>
                      {PASSENGER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {formatPassengerStatus(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setPassengerSearch("");
                      setPassengerStatusFilter("ALL");
                    }}
                    className={pillClass(
                      passengerStatusFilter === "ALL" &&
                        !passengerSearch.trim(),
                      "emerald",
                    )}
                  >
                    Limpiar filtros
                  </button>
                </div>
              </div>
            </CollapsiblePanel>

            {filteredPassengers.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-sky-300/70 bg-white px-4 py-3 text-sm text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                No hay pasajeros para los filtros actuales.
              </p>
            ) : passengerView === "TABLE" ? (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-sky-300/70 bg-white shadow-sm shadow-slate-900/10 dark:border-sky-600/30 dark:bg-sky-950/10">
                <table className="min-w-full text-left text-sm text-slate-800 dark:text-slate-100">
                  <thead className="border-b border-sky-200/80 text-xs uppercase tracking-[0.08em] text-slate-500 dark:border-sky-600/30 dark:text-slate-400">
                    <tr>
                      <th className="p-2">Pasajero</th>
                      {!isSingleDepartureMode ? (
                        <th className="p-2">Salida</th>
                      ) : null}
                      <th className="p-2">Cuotas pendientes</th>
                      <th className="p-2">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPassengers.map((item) => {
                      const isActive =
                        activePassengerId === item.id_travel_group_passenger;
                      return (
                        <tr
                          key={item.id_travel_group_passenger}
                          className={`border-b border-sky-200/70 align-top dark:border-sky-600/30 ${
                            isActive
                              ? "bg-emerald-50/50 dark:bg-emerald-900/10"
                              : ""
                          }`}
                        >
                          <td className="p-2">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {item.client
                                ? `${item.client.first_name} ${item.client.last_name}`
                                : `Cliente Nº${item.client_id ?? "-"}`}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              DNI: {item.client?.dni_number || "-"} · Tel:{" "}
                              {item.client?.phone || "-"}
                            </p>
                          </td>
                          {!isSingleDepartureMode ? (
                            <td className="p-2 text-xs text-slate-700 dark:text-slate-300">
                              {item.travelGroupDeparture
                                ? item.travelGroupDeparture.name
                                : "-"}
                            </td>
                          ) : null}
                          <td className="p-2 text-xs text-slate-700 dark:text-slate-300">
                            {item.pending_payment.count} ·{" "}
                            {formatPendingInstallmentAmount(
                              item.pending_payment.amount,
                            )}
                          </td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  focusPassengerPanel(
                                    item.id_travel_group_passenger,
                                  )
                                }
                                className={`${pillClass(isActive, "sky")} inline-flex items-center gap-1`}
                                title={isActive ? "En edición" : "Gestionar"}
                                aria-label={
                                  isActive ? "En edición" : "Gestionar"
                                }
                              >
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
                                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                                  />
                                </svg>
                                {isActive ? "En edición" : "Gestionar"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeletePassenger(item)}
                                disabled={submitting}
                                className="grid size-8 place-items-center rounded-full border border-rose-300 bg-rose-100/90 text-rose-800 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/70 dark:bg-rose-900/15 dark:text-rose-200"
                                title="Eliminar pasajero"
                                aria-label="Eliminar pasajero"
                              >
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
                                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                  />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : passengerView === "LIST" ? (
              <div className="mt-4 space-y-2">
                {filteredPassengers.map((item) => {
                  const isActive =
                    activePassengerId === item.id_travel_group_passenger;
                  return (
                    <article
                      key={item.id_travel_group_passenger}
                      className={`rounded-2xl border p-3 shadow-sm shadow-slate-900/10 ${
                        isActive
                          ? "border-emerald-300/80 bg-emerald-50/60 dark:border-emerald-500/70 dark:bg-emerald-900/10"
                          : "border-sky-300/70 bg-white dark:border-sky-600/30 dark:bg-sky-950/10"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {item.client
                              ? `${item.client.first_name} ${item.client.last_name}`
                              : `Cliente Nº${item.client_id ?? "-"}`}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {isSingleDepartureMode
                              ? item.travelGroupDeparture?.name || "-"
                              : `Salida: ${item.travelGroupDeparture?.name || "-"}`}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              focusPassengerPanel(
                                item.id_travel_group_passenger,
                              )
                            }
                            className={`${pillClass(isActive, "sky")} inline-flex items-center gap-1`}
                            title={isActive ? "En edición" : "Gestionar"}
                            aria-label={isActive ? "En edición" : "Gestionar"}
                          >
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
                                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                              />
                            </svg>
                            {isActive ? "En edición" : "Gestionar"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeletePassenger(item)}
                            disabled={submitting}
                            className="grid size-8 place-items-center rounded-full border border-rose-300 bg-rose-100/90 text-rose-800 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/70 dark:bg-rose-900/15 dark:text-rose-200"
                            title="Eliminar pasajero"
                            aria-label="Eliminar pasajero"
                          >
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
                                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {item.status !== "CONFIRMADO" ? (
                          <span
                            className={`rounded-full border px-2 py-0.5 font-bold ${STATUS_STYLES[item.status] || STATUS_STYLES.PENDIENTE}`}
                          >
                            {formatPassengerStatus(item.status)}
                          </span>
                        ) : null}
                        <span className="rounded-full border border-sky-300/70 bg-white px-2 py-0.5 text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                          Pendientes: {item.pending_payment.count}
                        </span>
                        <span className="rounded-full border border-sky-300/70 bg-white px-2 py-0.5 text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                          Monto:{" "}
                          {formatPendingInstallmentAmount(
                            item.pending_payment.amount,
                          )}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredPassengers.map((item) => {
                  const isActive =
                    activePassengerId === item.id_travel_group_passenger;
                  return (
                    <article
                      key={item.id_travel_group_passenger}
                      className={`rounded-2xl border p-3 shadow-sm shadow-slate-900/10 ${
                        isActive
                          ? "border-emerald-300/80 bg-emerald-50/60 dark:border-emerald-500/70 dark:bg-emerald-900/10"
                          : "border-sky-300/70 bg-white dark:border-sky-600/30 dark:bg-sky-950/10"
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        {item.status !== "CONFIRMADO" ? (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLES[item.status] || STATUS_STYLES.PENDIENTE}`}
                          >
                            {formatPassengerStatus(item.status)}
                          </span>
                        ) : (
                          <span />
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              focusPassengerPanel(
                                item.id_travel_group_passenger,
                              )
                            }
                            className={`${pillClass(isActive, "sky")} inline-flex items-center gap-1`}
                            title={isActive ? "En edición" : "Gestionar"}
                            aria-label={isActive ? "En edición" : "Gestionar"}
                          >
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
                                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                              />
                            </svg>
                            {isActive ? "En edición" : "Gestionar"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeletePassenger(item)}
                            disabled={submitting}
                            className="grid size-8 place-items-center rounded-full border border-rose-300 bg-rose-100/90 text-rose-800 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/70 dark:bg-rose-900/15 dark:text-rose-200"
                            title="Eliminar pasajero"
                            aria-label="Eliminar pasajero"
                          >
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
                                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {item.client
                          ? `${item.client.first_name} ${item.client.last_name}`
                          : `Cliente Nº${item.client_id ?? "-"}`}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        DNI: {item.client?.dni_number || "-"} · Tel:{" "}
                        {item.client?.phone || "-"}
                      </p>
                      <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                        {isSingleDepartureMode
                          ? item.travelGroupDeparture?.name || "-"
                          : `Salida: ${item.travelGroupDeparture?.name || "-"}`}
                      </p>
                      <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                        Pendientes: {item.pending_payment.count} ·{" "}
                        {formatPendingInstallmentAmount(
                          item.pending_payment.amount,
                        )}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
      </div>
      <ToastContainer position="top-right" autoClose={3200} />
    </main>
  );
}
