"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import {
  DEFAULT_CLIENT_PROFILE_KEY,
  normalizeClientProfiles,
} from "@/utils/clientConfig";
import type { ClientProfileConfig } from "@/types";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

type MoneyMap = Record<string, number>;
type RoleInBooking = "ALL" | "TITULAR" | "COMPANION";
type DateMode = "creation" | "travel";
type FieldFilterScope = "base" | "custom";
type FieldFilterInputType = "text" | "number" | "date" | "select";
type FieldFilter = { scope: FieldFilterScope; key: string; value: string };
type FieldFilterDraft = FieldFilter & { id: string };
type FieldFilterOption = {
  scope: FieldFilterScope;
  key: string;
  label: string;
  inputType: FieldFilterInputType;
  placeholder?: string;
  options?: string[];
};
type SortKey =
  | "last_booking_desc"
  | "next_trip_asc"
  | "bookings_desc"
  | "titular_desc"
  | "companion_desc"
  | "name_asc";

const BASE_FIELD_FILTER_OPTIONS: FieldFilterOption[] = [
  {
    scope: "base",
    key: "first_name",
    label: "Nombre",
    inputType: "text",
    placeholder: "Ej: Juan",
  },
  {
    scope: "base",
    key: "last_name",
    label: "Apellido",
    inputType: "text",
    placeholder: "Ej: Pérez",
  },
  {
    scope: "base",
    key: "agency_client_id",
    label: "Nº pax",
    inputType: "number",
    placeholder: "Ej: 125",
  },
  {
    scope: "base",
    key: "dni_number",
    label: "DNI / CI",
    inputType: "text",
    placeholder: "Ej: 30111222",
  },
  {
    scope: "base",
    key: "passport_number",
    label: "Pasaporte",
    inputType: "text",
    placeholder: "Ej: AA123456",
  },
  {
    scope: "base",
    key: "tax_id",
    label: "CUIT / RUT",
    inputType: "text",
    placeholder: "Ej: 20-12345678-3",
  },
  {
    scope: "base",
    key: "phone",
    label: "Teléfono",
    inputType: "text",
    placeholder: "Ej: +54 11...",
  },
  {
    scope: "base",
    key: "email",
    label: "Email",
    inputType: "text",
    placeholder: "Ej: pax@mail.com",
  },
  {
    scope: "base",
    key: "birth_date",
    label: "Fecha de nacimiento",
    inputType: "date",
  },
  {
    scope: "base",
    key: "gender",
    label: "Género",
    inputType: "select",
    options: ["Masculino", "Femenino", "No Binario"],
  },
  {
    scope: "base",
    key: "nationality",
    label: "Nacionalidad",
    inputType: "text",
    placeholder: "Ej: Argentina",
  },
  {
    scope: "base",
    key: "locality",
    label: "Localidad",
    inputType: "text",
    placeholder: "Ej: CABA",
  },
  {
    scope: "base",
    key: "address",
    label: "Dirección",
    inputType: "text",
  },
  {
    scope: "base",
    key: "postal_code",
    label: "Código postal",
    inputType: "text",
  },
  {
    scope: "base",
    key: "company_name",
    label: "Razón social",
    inputType: "text",
  },
  {
    scope: "base",
    key: "commercial_address",
    label: "Domicilio comercial",
    inputType: "text",
  },
];

type UserLite = {
  id_user: number;
  first_name: string;
  last_name: string;
};

type PanelRecentBooking = {
  id_booking: number;
  agency_booking_id: number | null;
  role: "TITULAR" | "ACOMPANANTE";
  details: string | null;
  creation_date: string | null;
  departure_date: string | null;
  return_date: string | null;
  sale_amounts: MoneyMap;
  received_amounts: MoneyMap;
  debt_amounts: MoneyMap;
};

type PanelRow = {
  client: {
    id_client: number;
    agency_client_id: number | null;
    first_name: string;
    last_name: string;
    profile_key: string;
    id_user: number;
    user: {
      id_user: number;
      first_name: string;
      last_name: string;
    } | null;
  };
  summary: {
    bookings: {
      bookings_total: number;
      bookings_as_titular: number;
      bookings_as_companion: number;
      sale_amounts: MoneyMap;
      received_amounts: MoneyMap;
      debt_amounts: MoneyMap;
      last_booking_date: string | null;
      next_travel_date: string | null;
      recent_bookings: PanelRecentBooking[];
    };
  };
};

type PanelKpis = {
  clients: number;
  with_activity_clients: number;
  bookings_total: number;
  bookings_as_titular: number;
  bookings_as_companion: number;
  sale_amounts: MoneyMap;
  received_amounts: MoneyMap;
  debt_amounts: MoneyMap;
};

type PanelApiResponse = {
  items: PanelRow[];
  nextCursor: number | null;
  kpis: PanelKpis;
  error?: string;
};

const GLASS =
  "rounded-3xl border border-white/20 bg-white/10 p-4 shadow-md shadow-sky-950/10 dark:border-white/10 dark:bg-white/10";
const CHIP =
  "inline-flex items-center rounded-full border border-white/20 bg-white/20 px-3 py-1 text-xs font-medium shadow-sm dark:bg-white/10";
const KPI_CARD =
  "rounded-2xl border border-white/15 bg-white/10 p-3 shadow-sm shadow-sky-950/10";
const BTN =
  "inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium shadow-sm transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "w-full rounded-2xl border border-white/30 bg-white/30 px-3 py-2 text-sm outline-none dark:bg-white/5";
const SELECT =
  "w-full cursor-pointer rounded-2xl border border-white/30 bg-white/30 px-3 py-2 text-sm outline-none transition hover:border-white/50 dark:bg-white/5";
const TOGGLE_GROUP =
  "inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 p-1";
const TOGGLE_BTN =
  "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition";
const TOGGLE_BTN_ACTIVE =
  "bg-sky-100/80 text-sky-950 shadow-sm dark:bg-white/20 dark:text-white";
const TOGGLE_BTN_IDLE =
  "text-sky-950/70 hover:bg-white/20 dark:text-white/70 dark:hover:bg-white/20";

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type IconProps = { className?: string };

function HeroMagnifyingGlassIcon({ className }: IconProps) {
  return (
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
        d="m21 21-4.35-4.35m0 0A7.5 7.5 0 1 0 5.5 5.5a7.5 7.5 0 0 0 11.15 11.15Z"
      />
    </svg>
  );
}

function HeroAdjustmentsHorizontalIcon({ className }: IconProps) {
  return (
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
        d="M10.5 6H20.25m-9.75 0a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0m0 0H3.75m6.75 12h9.75m-9.75 0a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0m0 0H3.75m6.75-6h9.75m-9.75 0a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0m0 0H3.75"
      />
    </svg>
  );
}

function HeroUserIcon({ className }: IconProps) {
  return (
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
        d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
      />
    </svg>
  );
}

function HeroCalendarIcon({ className }: IconProps) {
  return (
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
        d="M6.75 3v2.25M17.25 3v2.25M3.75 18.75h16.5M4.5 6.75h15a.75.75 0 0 1 .75.75v11.25a.75.75 0 0 1-.75.75h-15a.75.75 0 0 1-.75-.75V7.5a.75.75 0 0 1 .75-.75Z"
      />
    </svg>
  );
}

function HeroArrowsUpDownIcon({ className }: IconProps) {
  return (
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
        d="M8.25 15 12 18.75 15.75 15M8.25 9 12 5.25 15.75 9"
      />
    </svg>
  );
}

function HeroChevronDownIcon({ className }: IconProps) {
  return (
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
        d="m19.5 8.25-7.5 7.5-7.5-7.5"
      />
    </svg>
  );
}

function HeroXMarkIcon({ className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

const EMPTY_KPIS: PanelKpis = {
  clients: 0,
  with_activity_clients: 0,
  bookings_total: 0,
  bookings_as_titular: 0,
  bookings_as_companion: 0,
  sale_amounts: {},
  received_amounts: {},
  debt_amounts: {},
};

function mergeMoneyMaps(a: MoneyMap, b: MoneyMap): MoneyMap {
  const out: MoneyMap = { ...a };
  Object.entries(b).forEach(([currency, amount]) => {
    out[currency] = (out[currency] ?? 0) + (Number(amount) || 0);
  });
  return out;
}

function mergeKpis(base: PanelKpis, next: PanelKpis): PanelKpis {
  return {
    clients: base.clients + next.clients,
    with_activity_clients:
      base.with_activity_clients + next.with_activity_clients,
    bookings_total: base.bookings_total + next.bookings_total,
    bookings_as_titular:
      base.bookings_as_titular + next.bookings_as_titular,
    bookings_as_companion:
      base.bookings_as_companion + next.bookings_as_companion,
    sale_amounts: mergeMoneyMaps(base.sale_amounts, next.sale_amounts),
    received_amounts: mergeMoneyMaps(
      base.received_amounts,
      next.received_amounts,
    ),
    debt_amounts: mergeMoneyMaps(base.debt_amounts, next.debt_amounts),
  };
}

function moneyEntries(values: MoneyMap): Array<{ currency: string; amount: number }> {
  return Object.entries(values)
    .filter(([, amount]) => Number.isFinite(amount))
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([currency, amount]) => ({ currency, amount }));
}

function formatMoney(amount: number, currency: string): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const code = String(currency || "ARS")
    .trim()
    .toUpperCase();
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: code || "ARS",
      minimumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${safe.toFixed(2)} ${code || "ARS"}`;
  }
}

function formatMoneyMap(values: MoneyMap): string {
  const entries = moneyEntries(values);
  if (entries.length === 0) return "—";
  return entries
    .map(({ currency, amount }) => formatMoney(amount, currency))
    .join(" / ");
}

function getAmountTone(amount: number): "debt" | "credit" | "neutral" {
  if (!Number.isFinite(amount)) return "neutral";
  if (amount > 0.009) return "debt";
  if (amount < -0.009) return "credit";
  return "neutral";
}

function getBalanceTone(values: MoneyMap): "debt" | "credit" | "neutral" {
  let hasPositive = false;
  let hasNegative = false;
  Object.values(values).forEach((amount) => {
    if (!Number.isFinite(amount)) return;
    if (amount > 0.009) hasPositive = true;
    if (amount < -0.009) hasNegative = true;
  });
  if (hasPositive) return "debt";
  if (hasNegative) return "credit";
  return "neutral";
}

function formatDateSafe(value?: string | null): string {
  if (!value) return "—";
  try {
    return formatDateInBuenosAires(value);
  } catch {
    return "—";
  }
}

function roleCanSelectOwner(role: string): boolean {
  return ["gerente", "administrativo", "desarrollador", "lider"].includes(role);
}

function roleLabel(role: "TITULAR" | "ACOMPANANTE"): string {
  return role === "TITULAR" ? "Titular" : "Acompañante";
}

function buildFieldFilterId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function filterFieldId(scope: FieldFilterScope, key: string): string {
  return `${scope}:${key}`;
}

function parseFilterFieldId(value: string): {
  scope: FieldFilterScope;
  key: string;
} | null {
  const [scopeRaw, ...rest] = String(value || "")
    .trim()
    .toLowerCase()
    .split(":");
  const key = rest.join(":").trim();
  if (!key) return null;
  if (scopeRaw === "base") return { scope: "base", key };
  if (scopeRaw === "custom") return { scope: "custom", key };
  return null;
}

function sanitizeFieldFilters(filters: FieldFilter[]): FieldFilter[] {
  const seen = new Set<string>();
  const out: FieldFilter[] = [];
  filters.forEach((filter) => {
    const scope = filter.scope === "base" ? "base" : "custom";
    const key = String(filter.key || "")
      .trim()
      .toLowerCase();
    const value = String(filter.value || "").trim();
    const id = filterFieldId(scope, key);
    if (!key || !value || seen.has(id)) return;
    seen.add(id);
    out.push({ scope, key, value });
  });
  return out.slice(0, 8);
}

type QueryOverrides = Partial<{
  q: string;
  roleInBooking: RoleInBooking;
  dateMode: DateMode;
  profileKey: string;
  ownerId: number;
  fieldFilters: FieldFilter[];
  from: string;
  to: string;
  includeEmpty: boolean;
}>;

export default function ClientsPanelPage() {
  const { token, role: contextRole } = useAuth() as {
    token?: string | null;
    role?: string | null;
  };

  const role = String(contextRole || "")
    .trim()
    .toLowerCase();
  const canSelectOwner = roleCanSelectOwner(role);

  const [rows, setRows] = useState<PanelRow[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [kpis, setKpis] = useState<PanelKpis>(EMPTY_KPIS);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [appliedBaseQS, setAppliedBaseQS] = useState("");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [roleInBooking, setRoleInBooking] = useState<RoleInBooking>("ALL");

  const [profileKey, setProfileKey] = useState("all");
  const [ownerId, setOwnerId] = useState<number>(0);
  const [customFieldFilters, setCustomFieldFilters] = useState<
    FieldFilterDraft[]
  >([]);
  const [dateMode, setDateMode] = useState<DateMode>("travel");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("last_booking_desc");
  const isDateRangeInvalid = Boolean(from && to && from > to);

  const [profileOptions, setProfileOptions] = useState<ClientProfileConfig[]>([
    {
      key: DEFAULT_CLIENT_PROFILE_KEY,
      label: "Pax",
      required_fields: [],
      hidden_fields: [],
      custom_fields: [],
    },
  ]);
  const [ownerOptions, setOwnerOptions] = useState<UserLite[]>([]);

  const profileLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    profileOptions.forEach((profile) => map.set(profile.key, profile.label));
    return map;
  }, [profileOptions]);

  const ownerLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    ownerOptions.forEach((owner) => {
      const label = `${owner.first_name || ""} ${owner.last_name || ""}`.trim();
      if (!label) return;
      map.set(owner.id_user, label);
    });
    return map;
  }, [ownerOptions]);
  const selectedProfile = useMemo(
    () => profileOptions.find((profile) => profile.key === profileKey) ?? null,
    [profileKey, profileOptions],
  );
  const selectedProfileCustomFields = useMemo(
    () => selectedProfile?.custom_fields ?? [],
    [selectedProfile],
  );
  const customFilterFieldOptions = useMemo<FieldFilterOption[]>(
    () =>
      selectedProfileCustomFields.map((field) => {
        let inputType: FieldFilterInputType = "text";
        if (field.type === "number") inputType = "number";
        else if (field.type === "date") inputType = "date";
        else if (
          field.type === "select" ||
          field.type === "multiselect" ||
          field.type === "boolean"
        ) {
          inputType = "select";
        }

        const options =
          field.type === "boolean"
            ? ["true", "false"]
            : Array.isArray(field.options)
              ? field.options
              : undefined;

        return {
          scope: "custom" as const,
          key: field.key,
          label: field.label,
          inputType,
          placeholder: field.placeholder,
          options,
        };
      }),
    [selectedProfileCustomFields],
  );
  const availableFieldFilterOptions = useMemo<FieldFilterOption[]>(
    () =>
      profileKey === "all"
        ? BASE_FIELD_FILTER_OPTIONS
        : [...BASE_FIELD_FILTER_OPTIONS, ...customFilterFieldOptions],
    [profileKey, customFilterFieldOptions],
  );
  const availableFieldFilterMap = useMemo(
    () =>
      new Map(
        availableFieldFilterOptions.map((field) => [
          filterFieldId(field.scope, field.key),
          field,
        ]),
      ),
    [availableFieldFilterOptions],
  );
  const fieldFilterLabelMap = useMemo(
    () =>
      new Map(
        availableFieldFilterOptions.map((field) => [
          filterFieldId(field.scope, field.key),
          field.label,
        ]),
      ),
    [availableFieldFilterOptions],
  );
  const normalizedCustomFieldFilters = useMemo(
    () =>
      sanitizeFieldFilters(
        customFieldFilters.map((filter) => ({
          scope: filter.scope,
          key: filter.key,
          value: filter.value,
        })),
      ),
    [customFieldFilters],
  );

  useEffect(() => {
    setCustomFieldFilters((prev) => {
      const validIds = new Set(
        availableFieldFilterOptions.map((field) =>
          filterFieldId(field.scope, field.key),
        ),
      );
      const next = prev.filter((filter) =>
        validIds.has(filterFieldId(filter.scope, filter.key)),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [availableFieldFilterOptions]);

  useEffect(() => {
    if (!token) return;
    let alive = true;

    (async () => {
      try {
        const res = await authFetch(
          "/api/clients/config",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) return;
        const cfg = (await res.json().catch(() => null)) as
          | {
              profiles?: unknown;
              required_fields?: unknown;
              hidden_fields?: unknown;
              custom_fields?: unknown;
            }
          | null;
        if (!alive) return;
        const profiles = normalizeClientProfiles(cfg?.profiles, {
          required_fields: cfg?.required_fields,
          hidden_fields: cfg?.hidden_fields,
          custom_fields: cfg?.custom_fields,
        });
        setProfileOptions(profiles);
      } catch {
        // fallback silencioso
      }
    })();

    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !canSelectOwner) {
      setOwnerOptions([]);
      return;
    }
    let alive = true;

    (async () => {
      try {
        const res = await authFetch("/api/users", { cache: "no-store" }, token);
        if (!res.ok) return;
        const users = (await res.json().catch(() => [])) as UserLite[];
        if (!alive) return;
        setOwnerOptions(Array.isArray(users) ? users : []);
      } catch {
        // fallback silencioso
      }
    })();

    return () => {
      alive = false;
    };
  }, [token, canSelectOwner]);

  const buildQS = useCallback(
    (cursor?: number | null, overrides?: QueryOverrides) => {
      const effectiveQ = overrides?.q ?? q;
      const effectiveRole = overrides?.roleInBooking ?? roleInBooking;
      const effectiveDateMode = overrides?.dateMode ?? dateMode;
      const effectiveProfileKey = overrides?.profileKey ?? profileKey;
      const effectiveOwnerId = overrides?.ownerId ?? ownerId;
      const effectiveFieldFilters =
        overrides?.fieldFilters ?? normalizedCustomFieldFilters;
      const effectiveFrom = overrides?.from ?? from;
      const effectiveTo = overrides?.to ?? to;
      const effectiveIncludeEmpty = overrides?.includeEmpty ?? includeEmpty;

      const params = new URLSearchParams();
      params.set("take", "24");
      if (cursor && cursor > 0) params.set("cursor", String(cursor));
      if (effectiveQ.trim()) params.set("q", effectiveQ.trim());
      params.set("role_in_booking", effectiveRole);
      params.set("date_mode", effectiveDateMode);
      if (effectiveProfileKey && effectiveProfileKey !== "all") {
        params.set("profile_key", effectiveProfileKey);
      }
      if (canSelectOwner && effectiveOwnerId > 0) {
        params.set("ownerId", String(effectiveOwnerId));
      }
      if (effectiveFieldFilters.length > 0) {
        params.set(
          "field_filters",
          JSON.stringify(effectiveFieldFilters),
        );
      }
      if (effectiveFrom) params.set("from", effectiveFrom);
      if (effectiveTo) params.set("to", effectiveTo);
      if (effectiveIncludeEmpty) params.set("include_empty", "1");
      return params.toString();
    },
    [
      q,
      roleInBooking,
      dateMode,
      profileKey,
      canSelectOwner,
      ownerId,
      normalizedCustomFieldFilters,
      from,
      to,
      includeEmpty,
    ],
  );

  const currentBaseQS = useMemo(() => buildQS(undefined), [buildQS]);
  const hasPendingFilterChanges =
    initialized && !!appliedBaseQS && currentBaseQS !== appliedBaseQS;
  const globalBalanceTone = useMemo(
    () => getBalanceTone(kpis.debt_amounts),
    [kpis.debt_amounts],
  );

  const fetchReset = useCallback(async (overrides?: QueryOverrides) => {
    if (!token) return;
    const effectiveFrom = overrides?.from ?? from;
    const effectiveTo = overrides?.to ?? to;
    if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
      toast.error("El rango de fechas es inválido.");
      return;
    }
    const nextBaseQS = buildQS(undefined, overrides);
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/clients/panel?${nextBaseQS}`,
        { cache: "no-store" },
        token,
      );
      const json = (await res.json().catch(() => null)) as PanelApiResponse | null;
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo cargar el panel.");
      }
      setRows(Array.isArray(json?.items) ? json.items : []);
      setNextCursor(
        typeof json?.nextCursor === "number" ? json.nextCursor : null,
      );
      setKpis(json?.kpis ?? EMPTY_KPIS);
      setAppliedBaseQS(nextBaseQS);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo cargar el panel.";
      toast.error(message);
      setRows([]);
      setNextCursor(null);
      setKpis(EMPTY_KPIS);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [buildQS, from, to, token]);

  const fetchMore = useCallback(async () => {
    if (!token || !nextCursor || loadingMore || hasPendingFilterChanges || isDateRangeInvalid) {
      return;
    }
    const params = new URLSearchParams(appliedBaseQS || buildQS(undefined));
    params.set("cursor", String(nextCursor));
    setLoadingMore(true);
    try {
      const res = await authFetch(
        `/api/clients/panel?${params.toString()}`,
        { cache: "no-store" },
        token,
      );
      const json = (await res.json().catch(() => null)) as PanelApiResponse | null;
      if (!res.ok) {
        throw new Error(json?.error || "No se pudo cargar más resultados.");
      }
      const items = Array.isArray(json?.items) ? json.items : [];
      setRows((prev) => [...prev, ...items]);
      setNextCursor(
        typeof json?.nextCursor === "number" ? json.nextCursor : null,
      );
      setKpis((prev) => mergeKpis(prev, json?.kpis ?? EMPTY_KPIS));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo cargar más resultados.";
      toast.error(message);
    } finally {
      setLoadingMore(false);
    }
  }, [
    appliedBaseQS,
    buildQS,
    hasPendingFilterChanges,
    isDateRangeInvalid,
    loadingMore,
    nextCursor,
    token,
  ]);

  useEffect(() => {
    if (!token) return;
    void fetchReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const clearFilters = () => {
    setQ("");
    setRoleInBooking("ALL");
    setProfileKey("all");
    setOwnerId(0);
    setCustomFieldFilters([]);
    setDateMode("travel");
    setFrom("");
    setTo("");
    setIncludeEmpty(false);
  };

  const addCustomFieldFilter = useCallback(() => {
    if (availableFieldFilterOptions.length === 0) return;
    setCustomFieldFilters((prev) => {
      const usedIds = new Set(
        prev.map((filter) => filterFieldId(filter.scope, filter.key)),
      );
      const available = availableFieldFilterOptions.find(
        (field) => !usedIds.has(filterFieldId(field.scope, field.key)),
      );
      if (!available) return prev;
      return [
        ...prev,
        {
          id: buildFieldFilterId(),
          scope: available.scope,
          key: available.key,
          value: "",
        },
      ];
    });
  }, [availableFieldFilterOptions]);

  const removeCustomFieldFilter = useCallback((id: string) => {
    setCustomFieldFilters((prev) => prev.filter((filter) => filter.id !== id));
  }, []);

  const sortedRows = useMemo(() => {
    const rowsCopy = [...rows];
    const dateKey = (value?: string | null) => (value ? value : "");
    const fullName = (row: PanelRow) =>
      `${row.client.first_name || ""} ${row.client.last_name || ""}`.trim();

    rowsCopy.sort((a, b) => {
      const sa = a.summary.bookings;
      const sb = b.summary.bookings;
      switch (sortKey) {
        case "bookings_desc":
          return sb.bookings_total - sa.bookings_total;
        case "titular_desc":
          return sb.bookings_as_titular - sa.bookings_as_titular;
        case "companion_desc":
          return sb.bookings_as_companion - sa.bookings_as_companion;
        case "next_trip_asc": {
          const aKey = dateKey(sa.next_travel_date);
          const bKey = dateKey(sb.next_travel_date);
          if (!aKey && !bKey) return 0;
          if (!aKey) return 1;
          if (!bKey) return -1;
          return aKey.localeCompare(bKey);
        }
        case "name_asc":
          return fullName(a).localeCompare(fullName(b), "es");
        default:
          return dateKey(sb.last_booking_date).localeCompare(
            dateKey(sa.last_booking_date),
          );
      }
    });

    return rowsCopy;
  }, [rows, sortKey]);

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (q.trim()) labels.push(`Búsqueda: ${q.trim()}`);
    if (roleInBooking !== "ALL") {
      labels.push(
        roleInBooking === "TITULAR" ? "Solo titular" : "Solo acompañante",
      );
    }
    if (profileKey !== "all") {
      const label =
        profileLabelMap.get(profileKey) || profileKey || "Tipo de pax";
      labels.push(`Tipo: ${label}`);
    }
    if (canSelectOwner && ownerId > 0) {
      labels.push(`Vendedor: ${ownerLabelMap.get(ownerId) || "Seleccionado"}`);
    }
    normalizedCustomFieldFilters.forEach((filter) => {
      const fieldLabel =
        fieldFilterLabelMap.get(filterFieldId(filter.scope, filter.key)) ||
        filter.key;
      const displayValue =
        filter.value === "true"
          ? "Sí"
          : filter.value === "false"
            ? "No"
            : filter.value;
      labels.push(`${fieldLabel}: ${displayValue}`);
    });
    if (from) labels.push(`Desde: ${from}`);
    if (to) labels.push(`Hasta: ${to}`);
    if (dateMode === "creation") labels.push("Base: creación");
    if (includeEmpty) labels.push("Incluye sin reservas");
    return labels;
  }, [
    q,
    roleInBooking,
    profileKey,
    profileLabelMap,
    canSelectOwner,
    ownerId,
    ownerLabelMap,
    fieldFilterLabelMap,
    normalizedCustomFieldFilters,
    from,
    to,
    dateMode,
    includeEmpty,
  ]);
  const canAddCustomFieldFilter =
    customFieldFilters.length < availableFieldFilterOptions.length;

  return (
    <ProtectedRoute>
      <section className="space-y-4 text-sky-950 dark:text-white">
        <header className={GLASS}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="inline-flex items-center gap-2 text-xl font-semibold">
                <HeroAdjustmentsHorizontalIcon className="size-5" />
                Panel de Pasajeros
              </h1>
              <p className="mt-1 text-sm opacity-75">
                Enfoque por reservas: participación, venta, recibos y saldo.
              </p>
            </div>
            <span className={CHIP}>Solo lectura</span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className={KPI_CARD}>
              <p className="text-[11px] uppercase tracking-[0.2em] opacity-60">
                Pasajeros visibles
              </p>
              <p className="mt-1 text-xl font-semibold">{kpis.clients}</p>
            </article>
            <article className={KPI_CARD}>
              <p className="text-[11px] uppercase tracking-[0.2em] opacity-60">
                Reservas
              </p>
              <p className="mt-1 text-xl font-semibold">{kpis.bookings_total}</p>
            </article>
            <article className={KPI_CARD}>
              <p className="text-[11px] uppercase tracking-[0.2em] opacity-60">
                Flujo
              </p>
              <p className="mt-1 text-sm font-semibold">
                Venta: {formatMoneyMap(kpis.sale_amounts)}
              </p>
              <p className="mt-1 text-xs opacity-80">
                Recibos: {formatMoneyMap(kpis.received_amounts)}
              </p>
            </article>
            <article className={KPI_CARD}>
              <p className="text-[11px] uppercase tracking-[0.2em] opacity-60">
                Saldo visible
              </p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  globalBalanceTone === "debt"
                    ? "text-rose-700 dark:text-rose-300"
                    : globalBalanceTone === "credit"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : ""
                }`}
              >
                {formatMoneyMap(kpis.debt_amounts)}
              </p>
            </article>
          </div>
        </header>

        <div className={GLASS}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_auto_auto]">
            <label className="flex flex-col gap-1 text-xs">
              <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] opacity-70">
                <HeroMagnifyingGlassIcon className="size-4" />
                Buscar pasajero
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void fetchReset();
                }}
                placeholder="Nombre, DNI, email, N° pax"
                className={INPUT}
              />
            </label>

            <div className="flex flex-col gap-1 text-xs">
              <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] opacity-70">
                <HeroUserIcon className="size-4" />
                Rol en reserva
              </span>
              <div className={TOGGLE_GROUP}>
                {[
                  { value: "ALL", label: "Todos" },
                  { value: "TITULAR", label: "Titular" },
                  { value: "COMPANION", label: "Acompañante" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cx(
                      TOGGLE_BTN,
                      roleInBooking === option.value
                        ? TOGGLE_BTN_ACTIVE
                        : TOGGLE_BTN_IDLE,
                    )}
                    onClick={() => setRoleInBooking(option.value as RoleInBooking)}
                    aria-pressed={roleInBooking === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                className={`${BTN} ${
                  hasPendingFilterChanges
                    ? "border-amber-300/70 bg-amber-100/20 text-amber-900 dark:text-amber-200"
                    : ""
                }`}
                onClick={() => void fetchReset()}
                disabled={loading || isDateRangeInvalid}
              >
                {hasPendingFilterChanges ? "Aplicar cambios" : "Aplicar"}
              </button>
              <button
                type="button"
                className={`${BTN} min-w-[172px] justify-between`}
                onClick={() => setFiltersOpen((prev) => !prev)}
              >
                <span className="inline-flex items-center gap-1.5">
                  <HeroAdjustmentsHorizontalIcon className="size-4" />
                  Avanzados
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className={cx(
                      "size-2 rounded-full",
                      filtersOpen ? "bg-emerald-400" : "bg-sky-300",
                    )}
                  />
                  <HeroChevronDownIcon
                    className={cx(
                      "size-4 transition-transform",
                      filtersOpen && "rotate-180",
                    )}
                  />
                </span>
              </button>
            </div>

            <div className="flex items-end justify-end">
              <button
                type="button"
                className={`${BTN} size-10 rounded-2xl p-0`}
                onClick={() => {
                  clearFilters();
                  void fetchReset({
                    q: "",
                    roleInBooking: "ALL",
                    profileKey: "all",
                    ownerId: 0,
                    fieldFilters: [],
                    dateMode: "travel",
                    from: "",
                    to: "",
                    includeEmpty: false,
                  });
                }}
                disabled={loading}
                title="Limpiar filtros"
                aria-label="Limpiar filtros"
              >
                <HeroXMarkIcon className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {hasPendingFilterChanges && (
              <span className="inline-flex items-center rounded-full border border-amber-300/70 bg-amber-100/20 px-3 py-1 text-xs font-medium text-amber-900 dark:text-amber-200">
                Tenés cambios sin aplicar
              </span>
            )}
            {isDateRangeInvalid && (
              <span className="inline-flex items-center rounded-full border border-rose-300/70 bg-rose-100/20 px-3 py-1 text-xs font-medium text-rose-700 dark:text-rose-300">
                Rango inválido: Desde debe ser menor o igual a Hasta
              </span>
            )}
          </div>

          {filtersOpen && (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 lg:grid-cols-12">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/10 p-3 lg:col-span-4">
                <p className="text-[11px] uppercase tracking-[0.16em] opacity-65">
                  Segmentación
                </p>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="inline-flex items-center gap-1 opacity-80">
                    <HeroUserIcon className="size-4" />
                    Tipo de pax
                  </span>
                  <select
                    value={profileKey}
                    onChange={(e) => setProfileKey(e.target.value)}
                    className={SELECT}
                  >
                    <option value="all">Todos</option>
                    {profileOptions.map((profile) => (
                      <option key={profile.key} value={profile.key}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                </label>

                {canSelectOwner && (
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="inline-flex items-center gap-1 opacity-80">
                      <HeroUserIcon className="size-4" />
                      Vendedor
                    </span>
                    <select
                      value={ownerId}
                      onChange={(e) => setOwnerId(Number(e.target.value))}
                      className={SELECT}
                    >
                      <option value={0}>Todos</option>
                      {ownerOptions.map((owner) => (
                        <option key={owner.id_user} value={owner.id_user}>
                          {`${owner.first_name || ""} ${owner.last_name || ""}`.trim() ||
                            "Sin nombre"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/10 p-3 lg:col-span-4">
                <p className="text-[11px] uppercase tracking-[0.16em] opacity-65">
                  Filtros por campo
                </p>
                <p className="text-xs opacity-75">
                  Filtrá por campos base del pasajero y, si elegís un tipo de pax,
                  también por sus campos personalizados.
                </p>
                <div className="space-y-2">
                  {customFieldFilters.length === 0 && (
                    <p className="rounded-2xl border border-white/10 bg-white/10 p-3 text-xs opacity-70">
                      Todavía no agregaste campos para filtrar.
                    </p>
                  )}
                  {customFieldFilters.map((filter) => {
                    const selectedField = availableFieldFilterMap.get(
                      filterFieldId(filter.scope, filter.key),
                    );
                    const usedByOthers = new Set(
                      customFieldFilters
                        .filter((item) => item.id !== filter.id)
                        .map((item) => filterFieldId(item.scope, item.key)),
                    );
                    const rowOptions = availableFieldFilterOptions.filter(
                      (field) => {
                        const id = filterFieldId(field.scope, field.key);
                        return (
                          id === filterFieldId(filter.scope, filter.key) ||
                          !usedByOthers.has(id)
                        );
                      },
                    );

                    return (
                      <div
                        key={filter.id}
                        className="grid grid-cols-1 gap-2 rounded-2xl border border-white/10 bg-white/10 p-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                      >
                        <select
                          value={filterFieldId(filter.scope, filter.key)}
                          onChange={(e) => {
                            const parsed = parseFilterFieldId(e.target.value);
                            if (!parsed) return;
                            setCustomFieldFilters((prev) =>
                              prev.map((item) =>
                                item.id === filter.id
                                  ? {
                                      ...item,
                                      scope: parsed.scope,
                                      key: parsed.key,
                                      value: "",
                                    }
                                  : item,
                              ),
                            );
                          }}
                          className={SELECT}
                        >
                          {rowOptions.map((field) => (
                            <option
                              key={filterFieldId(field.scope, field.key)}
                              value={filterFieldId(field.scope, field.key)}
                            >
                              {field.label}
                            </option>
                          ))}
                        </select>

                        {selectedField?.inputType === "select" &&
                        Array.isArray(selectedField.options) &&
                        selectedField.options.length > 0 ? (
                          <select
                            value={filter.value}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setCustomFieldFilters((prev) =>
                                prev.map((item) =>
                                  item.id === filter.id
                                    ? { ...item, value: nextValue }
                                    : item,
                                ),
                              );
                            }}
                            className={SELECT}
                          >
                            <option value="">Seleccionar</option>
                            {selectedField.options.map((option) => (
                              <option key={option} value={option}>
                                {option === "true"
                                  ? "Sí"
                                  : option === "false"
                                    ? "No"
                                    : option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={selectedField?.inputType || "text"}
                            value={filter.value}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setCustomFieldFilters((prev) =>
                                prev.map((item) =>
                                  item.id === filter.id
                                    ? { ...item, value: nextValue }
                                    : item,
                                ),
                              );
                            }}
                            placeholder={
                              selectedField?.placeholder ||
                              "Escribí un valor para filtrar"
                            }
                            className={INPUT}
                          />
                        )}

                        <button
                          type="button"
                          className={`${BTN} px-3`}
                          onClick={() => removeCustomFieldFilter(filter.id)}
                        >
                          Quitar
                        </button>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className={`${BTN} w-full`}
                  onClick={addCustomFieldFilter}
                  disabled={!canAddCustomFieldFilter}
                >
                  Agregar campo
                </button>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/10 p-3 lg:col-span-4">
                <p className="text-[11px] uppercase tracking-[0.16em] opacity-65">
                  Tiempo y orden
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1 text-xs">
                    <span className="inline-flex items-center gap-1 opacity-80">
                      <HeroCalendarIcon className="size-4" />
                      Base temporal
                    </span>
                    <div className={TOGGLE_GROUP}>
                      {[
                        { value: "travel", label: "Viaje" },
                        { value: "creation", label: "Creación" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={cx(
                            TOGGLE_BTN,
                            dateMode === option.value
                              ? TOGGLE_BTN_ACTIVE
                              : TOGGLE_BTN_IDLE,
                          )}
                          onClick={() => setDateMode(option.value as DateMode)}
                          aria-pressed={dateMode === option.value}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="inline-flex items-center gap-1 opacity-80">
                      <HeroArrowsUpDownIcon className="size-4" />
                      Orden
                    </span>
                    <select
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value as SortKey)}
                      className={SELECT}
                    >
                      <option value="last_booking_desc">Última reserva</option>
                      <option value="next_trip_asc">Próximo viaje</option>
                      <option value="bookings_desc">Más reservas</option>
                      <option value="titular_desc">Más titular</option>
                      <option value="companion_desc">Más acompañante</option>
                      <option value="name_asc">Nombre (A-Z)</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="inline-flex items-center gap-1 opacity-80">
                      <HeroCalendarIcon className="size-4" />
                      Desde
                    </span>
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      className={`${INPUT} cursor-pointer transition hover:border-sky-300/70`}
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs">
                    <span className="inline-flex items-center gap-1 opacity-80">
                      <HeroCalendarIcon className="size-4" />
                      Hasta
                    </span>
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className={`${INPUT} cursor-pointer transition hover:border-sky-300/70`}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => setIncludeEmpty((prev) => !prev)}
                  className="inline-flex items-center gap-2 text-xs"
                  aria-pressed={includeEmpty}
                >
                  <span
                    className={cx(
                      "relative inline-flex h-5 w-10 items-center rounded-full border border-white/20 transition",
                      includeEmpty ? "bg-emerald-300/60" : "bg-white/20",
                    )}
                  >
                    <span
                      className={cx(
                        "inline-block size-4 rounded-full bg-white shadow-sm transition",
                        includeEmpty ? "translate-x-5" : "translate-x-0.5",
                      )}
                    />
                  </span>
                  Incluir pasajeros sin reservas en el período
                </button>
              </div>

              {from && to && from > to && (
                <p className="text-xs text-rose-700 dark:text-rose-300 lg:col-span-12">
                  El rango de fechas es inválido: &quot;Desde&quot; debe ser menor
                  o igual a &quot;Hasta&quot;.
                </p>
              )}
            </div>
          )}

          {activeFilterLabels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeFilterLabels.map((label) => (
                <span key={label} className={CHIP}>
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className={GLASS}>
          {!initialized || loading ? (
            <div className="flex h-56 items-center justify-center">
              <Spinner />
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="rounded-2xl border border-white/15 bg-white/10 p-8 text-center text-sm opacity-75">
              No hay pasajeros para los filtros aplicados.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl border border-white/15">
                <table className="w-full min-w-[1540px] border-separate border-spacing-0 text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.13em]">
                    <tr>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-left dark:bg-white/10">
                        Pasajero
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-left dark:bg-white/10">
                        Vendedor
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-center dark:bg-white/10">
                        Titular
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-center dark:bg-white/10">
                        Acompañante
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-center dark:bg-white/10">
                        Reservas
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-right dark:bg-white/10">
                        Venta
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-right dark:bg-white/10">
                        Recibos
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-right dark:bg-white/10">
                        Saldo
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-right dark:bg-white/10">
                        Última reserva
                      </th>
                      <th className="border-b border-white/20 bg-white/45 p-3 text-right dark:bg-white/10">
                        Próximo viaje
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, index) => {
                      const bookingSummary = row.summary.bookings;
                      const fullName =
                        `${row.client.first_name || ""} ${row.client.last_name || ""}`.trim() ||
                        `Pax ${row.client.id_client}`;
                      const clientNumber =
                        row.client.agency_client_id ?? row.client.id_client;
                      const profileLabel =
                        profileLabelMap.get(
                          String(row.client.profile_key || DEFAULT_CLIENT_PROFILE_KEY),
                        ) || row.client.profile_key || "Pax";
                      const ownerLabel = row.client.user
                        ? `${row.client.user.first_name || ""} ${row.client.user.last_name || ""}`.trim() ||
                          "Sin vendedor asignado"
                        : ownerLabelMap.get(row.client.id_user) ||
                          "Sin vendedor asignado";
                      const debtTone = getBalanceTone(bookingSummary.debt_amounts);
                      const debtStatus =
                        debtTone === "debt"
                          ? "Pendiente"
                          : debtTone === "credit"
                            ? "A favor"
                            : "Al día";
                      const rowBg =
                        index % 2 === 0 ? "bg-white/[0.02]" : "bg-white/[0.06]";
                      const saleEntries = moneyEntries(bookingSummary.sale_amounts);
                      const receiptEntries = moneyEntries(bookingSummary.received_amounts);
                      const debtEntries = moneyEntries(bookingSummary.debt_amounts);

                      return (
                        <tr
                          key={row.client.id_client}
                          className={cx(
                            "border-t border-white/10 transition-colors hover:bg-sky-100/20 dark:hover:bg-white/10",
                            rowBg,
                          )}
                        >
                          <td className="border-r border-white/10 p-3 align-top">
                            <p className="font-medium">{fullName}</p>
                            <p className="text-xs opacity-70">
                              N° {clientNumber} · {profileLabel}
                            </p>
                            <div className="mt-1.5 space-y-1">
                              {bookingSummary.recent_bookings
                                .slice(0, 2)
                                .map((booking) => (
                                  <div
                                    key={`${row.client.id_client}-${booking.id_booking}-${booking.role}`}
                                    className="flex flex-wrap items-center gap-1.5 text-xs"
                                  >
                                    <Link
                                      href={`/bookings/services/${booking.id_booking}`}
                                      className="inline-flex rounded-full border border-sky-300/60 bg-sky-100/70 px-2 py-0.5 font-medium text-sky-900 hover:bg-sky-100 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                                    >
                                      R° {booking.agency_booking_id ?? booking.id_booking}
                                    </Link>
                                    <span className="inline-flex rounded-full border border-white/20 bg-white/20 px-2 py-0.5">
                                      {roleLabel(booking.role)}
                                    </span>
                                    <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-2 py-0.5 opacity-80">
                                      {formatMoneyMap(booking.sale_amounts)}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </td>
                          <td className="p-3 align-top">
                            <p className="font-medium">{ownerLabel}</p>
                          </td>
                          <td className="p-3 text-center align-top">
                            <span className="inline-flex min-w-8 items-center justify-center rounded-full border border-sky-300/60 bg-sky-100/60 px-2 py-0.5 text-xs font-semibold text-sky-900 dark:border-white/20 dark:bg-white/10 dark:text-white">
                              {bookingSummary.bookings_as_titular}
                            </span>
                          </td>
                          <td className="p-3 text-center align-top">
                            <span className="inline-flex min-w-8 items-center justify-center rounded-full border border-amber-300/60 bg-amber-100/60 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:border-amber-400/40 dark:bg-amber-900/30 dark:text-amber-100">
                              {bookingSummary.bookings_as_companion}
                            </span>
                          </td>
                          <td className="p-3 text-center align-top">
                            <span className="inline-flex min-w-8 items-center justify-center rounded-full border border-white/20 bg-white/20 px-2 py-0.5 text-xs font-semibold">
                              {bookingSummary.bookings_total}
                            </span>
                          </td>
                          <td className="p-3 align-top">
                            <div className="flex flex-wrap justify-end gap-1">
                              {saleEntries.length > 0 ? (
                                saleEntries.map((entry) => (
                                  <span
                                    key={`sale-${row.client.id_client}-${entry.currency}`}
                                    className="inline-flex rounded-full border border-sky-300/60 bg-sky-100/60 px-2 py-0.5 text-xs font-medium text-sky-900 dark:border-white/20 dark:bg-white/10 dark:text-white/90"
                                  >
                                    {formatMoney(entry.amount, entry.currency)}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs opacity-60">—</span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 align-top">
                            <div className="flex flex-wrap justify-end gap-1">
                              {receiptEntries.length > 0 ? (
                                receiptEntries.map((entry) => (
                                  <span
                                    key={`rcpt-${row.client.id_client}-${entry.currency}`}
                                    className="inline-flex rounded-full border border-emerald-300/60 bg-emerald-100/60 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-900/30 dark:text-emerald-100"
                                  >
                                    {formatMoney(entry.amount, entry.currency)}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs opacity-60">—</span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 align-top">
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={cx(
                                  "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                                  debtTone === "debt" &&
                                    "border-rose-300/60 bg-rose-100/60 text-rose-700 dark:border-rose-400/40 dark:bg-rose-900/30 dark:text-rose-300",
                                  debtTone === "credit" &&
                                    "border-emerald-300/60 bg-emerald-100/60 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-900/30 dark:text-emerald-300",
                                  debtTone === "neutral" &&
                                    "border-white/20 bg-white/20 text-zinc-800/80 dark:text-white/80",
                                )}
                              >
                                {debtStatus}
                              </span>
                              <div className="flex flex-wrap justify-end gap-1">
                                {debtEntries.length > 0 ? (
                                  debtEntries.map((entry) => {
                                    const tone = getAmountTone(entry.amount);
                                    return (
                                      <span
                                        key={`debt-${row.client.id_client}-${entry.currency}`}
                                        className={cx(
                                          "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                                          tone === "debt" &&
                                            "border-rose-300/60 bg-rose-100/60 text-rose-700 dark:border-rose-400/40 dark:bg-rose-900/30 dark:text-rose-300",
                                          tone === "credit" &&
                                            "border-emerald-300/60 bg-emerald-100/60 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-900/30 dark:text-emerald-300",
                                          tone === "neutral" &&
                                            "border-white/20 bg-white/20",
                                        )}
                                      >
                                        {formatMoney(entry.amount, entry.currency)}
                                      </span>
                                    );
                                  })
                                ) : (
                                  <span className="text-xs opacity-60">—</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-right align-top">
                            <span className="inline-flex rounded-full border border-white/20 bg-white/20 px-2 py-0.5 text-xs">
                              {formatDateSafe(bookingSummary.last_booking_date)}
                            </span>
                          </td>
                          <td className="p-3 text-right align-top">
                            <span className="inline-flex rounded-full border border-white/20 bg-white/20 px-2 py-0.5 text-xs">
                              {formatDateSafe(bookingSummary.next_travel_date)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs opacity-70">
                  Saldo total visible: {formatMoneyMap(kpis.debt_amounts)}
                </span>
                {nextCursor ? (
                  <button
                    type="button"
                    className={BTN}
                    onClick={() => void fetchMore()}
                    disabled={loadingMore || hasPendingFilterChanges || isDateRangeInvalid}
                  >
                    {loadingMore
                      ? "Cargando..."
                      : hasPendingFilterChanges
                        ? "Aplicá filtros para continuar"
                        : "Ver más"}
                  </button>
                ) : (
                  <span className="text-xs opacity-70">Sin más resultados</span>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <ToastContainer position="top-right" autoClose={3000} />
    </ProtectedRoute>
  );
}
