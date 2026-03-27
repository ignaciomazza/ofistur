"use client";

import React, { useCallback, useMemo, useState } from "react";
import { toast } from "react-toastify";
import Spinner from "@/components/Spinner";
import { Client, ClientCustomField, ClientProfileConfig } from "@/types";
import { authFetch } from "@/utils/authFetch";
import {
  formatDateInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";
import {
  DEFAULT_CLIENT_PROFILE_KEY,
  DEFAULT_CLIENT_PROFILE_LABEL,
  DOCUMENT_ANY_KEY,
  resolveClientProfile,
} from "@/utils/clientConfig";

const CUSTOM_COLUMN_PREFIX = "custom:";

type BaseColumnKey =
  | "client_number"
  | "profile_key"
  | "first_name"
  | "last_name"
  | "gender"
  | "birth_date"
  | "phone"
  | "email"
  | "nationality"
  | "dni_number"
  | "passport_number"
  | "tax_id"
  | "address"
  | "postal_code"
  | "locality"
  | "company_name"
  | "commercial_address"
  | "id_client"
  | "registration_date";

type CustomColumnKey = `${typeof CUSTOM_COLUMN_PREFIX}${string}`;

type ColumnKey = BaseColumnKey | CustomColumnKey;

type BaseEditableKey = Exclude<
  BaseColumnKey,
  "client_number" | "profile_key" | "id_client" | "registration_date"
>;

type EditableKey = BaseEditableKey | CustomColumnKey;

type ColumnDef = {
  key: ColumnKey;
  label: string;
  readOnly?: boolean;
  always?: boolean;
  defaultVisible?: boolean;
};

type Drafts = Record<number, Partial<Record<EditableKey, string>>>;
type RowErrors = Record<number, Partial<Record<EditableKey, string>>>;

type ClientTableProps = {
  clients: Client[];
  token?: string | null;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  onClientsUpdated: (updates: Client[]) => void;
  profiles?: ClientProfileConfig[];
  customFields?: ClientCustomField[];
};

const GENDER_OPTIONS = ["Masculino", "Femenino", "No Binario"] as const;

const COLUMN_DEFS: ColumnDef[] = [
  {
    key: "client_number",
    label: "Nº",
    readOnly: true,
    always: true,
    defaultVisible: true,
  },
  {
    key: "profile_key",
    label: "Tipo",
    readOnly: true,
    defaultVisible: true,
  },
  { key: "first_name", label: "Nombre", defaultVisible: true },
  { key: "last_name", label: "Apellido", defaultVisible: true },
  { key: "gender", label: "Género", defaultVisible: true },
  { key: "birth_date", label: "Nacimiento", defaultVisible: true },
  { key: "phone", label: "Teléfono", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "nationality", label: "Nacionalidad", defaultVisible: true },
  { key: "dni_number", label: "DNI", defaultVisible: true },
  { key: "passport_number", label: "Pasaporte", defaultVisible: false },
  { key: "tax_id", label: "CUIT/CUIL", defaultVisible: false },
  { key: "locality", label: "Localidad", defaultVisible: false },
  { key: "address", label: "Dirección", defaultVisible: false },
  { key: "postal_code", label: "Código Postal", defaultVisible: false },
  { key: "company_name", label: "Razón Social", defaultVisible: false },
  {
    key: "commercial_address",
    label: "Dirección Comercial",
    defaultVisible: false,
  },
  {
    key: "registration_date",
    label: "Registrado",
    readOnly: true,
    defaultVisible: false,
  },
];

const BASE_FIELD_LABELS: Record<BaseEditableKey, string> = {
  first_name: "Nombre",
  last_name: "Apellido",
  gender: "Género",
  birth_date: "Nacimiento",
  phone: "Teléfono",
  email: "Email",
  nationality: "Nacionalidad",
  dni_number: "DNI",
  passport_number: "Pasaporte",
  tax_id: "CUIT/CUIL",
  address: "Dirección",
  postal_code: "Código Postal",
  locality: "Localidad",
  company_name: "Razón Social",
  commercial_address: "Dirección Comercial",
};

const DEFAULT_VISIBLE = COLUMN_DEFS.filter((c) => c.defaultVisible).map(
  (c) => c.key,
);

const GLASS =
  "rounded-3xl border border-white/30 bg-white/10 backdrop-blur shadow-lg shadow-sky-900/10 dark:bg-white/10 dark:border-white/5";
const CHIP =
  "inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 backdrop-blur px-3 py-1.5 text-sm shadow-sm shadow-sky-900/5 dark:bg-white/10 dark:border-white/10";
const ICON_BTN =
  "rounded-3xl bg-sky-600/30 px-3 py-1.5 text-sm text-sky-950/80 hover:text-sky-950 dark:text-white shadow-sm shadow-sky-900/10 hover:bg-sky-600/30 border border-sky-600/30 active:scale-[.99] transition";
const PRIMARY_BTN =
  "rounded-3xl bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-900 hover:text-emerald-900 dark:text-emerald-200 shadow-sm shadow-emerald-900/10 hover:bg-emerald-500/30 border border-emerald-500/30 active:scale-[.99] transition";

const isCustomColumn = (key: ColumnKey): key is CustomColumnKey =>
  key.startsWith(CUSTOM_COLUMN_PREFIX);

const toCustomColumnKey = (key: string): CustomColumnKey =>
  `${CUSTOM_COLUMN_PREFIX}${key}`;

const fromCustomColumnKey = (key: CustomColumnKey) =>
  key.slice(CUSTOM_COLUMN_PREFIX.length);

function parseMultiSelectValue(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function serializeMultiSelectValue(values: string[]): string {
  return values.join(", ");
}

function toDateInputValue(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return toDateKeyInBuenosAiresLegacySafe(trimmed) ?? "";
}

function formatDateDisplay(value?: string | null): string {
  if (!value) return "—";
  const key = toDateKeyInBuenosAiresLegacySafe(value);
  if (!key) return "—";
  return formatDateInBuenosAires(key);
}

function normalizeCompareValue(field: EditableKey, value: string): string {
  if (isCustomColumn(field)) return value.trim();
  if (field === "birth_date") return toDateInputValue(value);
  return value.trim();
}

function getClientFieldValue(client: Client, field: BaseEditableKey): string {
  switch (field) {
    case "first_name":
      return client.first_name || "";
    case "last_name":
      return client.last_name || "";
    case "gender":
      return client.gender || "";
    case "birth_date":
      return toDateInputValue(client.birth_date);
    case "phone":
      return client.phone || "";
    case "email":
      return client.email || "";
    case "nationality":
      return client.nationality || "";
    case "dni_number":
      return client.dni_number || "";
    case "passport_number":
      return client.passport_number || "";
    case "tax_id":
      return client.tax_id || "";
    case "address":
      return client.address || "";
    case "postal_code":
      return client.postal_code || "";
    case "locality":
      return client.locality || "";
    case "company_name":
      return client.company_name || "";
    case "commercial_address":
      return client.commercial_address || "";
  }
}

function formatFieldValue(field: EditableKey, value: string): string {
  if (!value) return "—";
  if (field === "birth_date") return formatDateDisplay(value);
  return value;
}

function buildPayload(
  client: Client,
  draft: Partial<Record<EditableKey, string>>,
) {
  const base = {
    profile_key: client.profile_key || DEFAULT_CLIENT_PROFILE_KEY,
    first_name: client.first_name || "",
    last_name: client.last_name || "",
    phone: client.phone || "",
    address: client.address || "",
    postal_code: client.postal_code || "",
    locality: client.locality || "",
    company_name: client.company_name || "",
    tax_id: client.tax_id || "",
    commercial_address: client.commercial_address || "",
    dni_number: client.dni_number || "",
    passport_number: client.passport_number || "",
    birth_date: toDateInputValue(client.birth_date),
    nationality: client.nationality || "",
    gender: client.gender || "",
    email: client.email || "",
    custom_fields: client.custom_fields || {},
  };
  const baseDraft: Partial<Record<BaseEditableKey, string>> = {};
  const customDraft: Record<string, string> = {};
  Object.entries(draft || {}).forEach(([key, value]) => {
    const typedKey = key as EditableKey;
    if (isCustomColumn(typedKey)) {
      customDraft[fromCustomColumnKey(typedKey)] = value ?? "";
    } else {
      baseDraft[typedKey as BaseEditableKey] = value ?? "";
    }
  });
  const mergedBase = { ...base, ...baseDraft };
  const mergedCustom = {
    ...(base.custom_fields || {}),
    ...customDraft,
  };
  return {
    ...mergedBase,
    birth_date: toDateInputValue(mergedBase.birth_date),
    custom_fields: mergedCustom,
  };
}

function validatePayload(
  payload: ReturnType<typeof buildPayload>,
  requiredFields: string[],
  requiredCustomKeys: string[],
) {
  const fieldErrors: Partial<Record<EditableKey, string>> = {};
  const isFilled = (val: unknown) =>
    String(val ?? "")
      .trim()
      .length > 0;

  requiredFields.forEach((field) => {
    if (field === DOCUMENT_ANY_KEY) return;
    if (!isFilled((payload as Record<string, unknown>)[field])) {
      if (field in payload) {
        fieldErrors[field as EditableKey] = "Requerido";
      }
    }
  });

  if (
    payload.gender &&
    !GENDER_OPTIONS.includes(payload.gender as (typeof GENDER_OPTIONS)[number])
  ) {
    fieldErrors.gender = "Género inválido";
  }

  if (
    payload.birth_date &&
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.birth_date)
  ) {
    fieldErrors.birth_date = "Fecha inválida";
  }

  const docRequired = requiredFields.includes(DOCUMENT_ANY_KEY);
  const hasDoc =
    String(payload.dni_number || "").trim() ||
    String(payload.passport_number || "").trim() ||
    String(payload.tax_id || "").trim();
  if (docRequired && !hasDoc) {
    fieldErrors.dni_number = "DNI, Pasaporte o CUIT requerido";
    fieldErrors.passport_number = "DNI, Pasaporte o CUIT requerido";
    fieldErrors.tax_id = "DNI, Pasaporte o CUIT requerido";
  }

  const customFilled = (payload.custom_fields || {}) as Record<string, string>;
  const missingCustomKeys = requiredCustomKeys.filter(
    (key) => !isFilled(customFilled[key]),
  );
  missingCustomKeys.forEach((key) => {
    fieldErrors[toCustomColumnKey(key)] = "Requerido";
  });

  const ok =
    Object.keys(fieldErrors).length === 0 && missingCustomKeys.length === 0;

  return { ok, fieldErrors, missingCustomKeys };
}

export default function ClientTable({
  clients,
  token,
  isLoading,
  hasMore,
  onLoadMore,
  loadingMore,
  onClientsUpdated,
  profiles = [],
  customFields = [],
}: ClientTableProps) {
  const normalizedProfiles = useMemo(
    () =>
      profiles.length > 0
        ? profiles
        : [
            {
              key: DEFAULT_CLIENT_PROFILE_KEY,
              label: DEFAULT_CLIENT_PROFILE_LABEL,
              required_fields: [],
              hidden_fields: [],
              custom_fields: [],
            },
          ],
    [profiles],
  );
  const customFieldMap = useMemo(
    () => new Map(customFields.map((field) => [field.key, field])),
    [customFields],
  );
  const profileLabelMap = useMemo(
    () => new Map(normalizedProfiles.map((profile) => [profile.key, profile.label])),
    [normalizedProfiles],
  );
  const customColumnDefs = useMemo<ColumnDef[]>(
    () =>
      customFields.map((field) => ({
        key: toCustomColumnKey(field.key),
        label: field.label,
      })),
    [customFields],
  );
  const allColumnDefs = useMemo(
    () => [...COLUMN_DEFS, ...customColumnDefs],
    [customColumnDefs],
  );
  const [visibleKeys, setVisibleKeys] = useState<ColumnKey[]>(DEFAULT_VISIBLE);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [savingRows, setSavingRows] = useState<Record<number, boolean>>({});
  const [saveAllOpen, setSaveAllOpen] = useState(false);
  const [saveAllBusy, setSaveAllBusy] = useState(false);
  const [saveAllErrors, setSaveAllErrors] = useState<
    { clientId: number; message: string }[]
  >([]);

  const clientMap = useMemo(
    () => new Map(clients.map((c) => [c.id_client, c])),
    [clients],
  );

  const ensureCustomColumnsVisible = useCallback(
    (keys: string[]) => {
      if (keys.length === 0) return;
      setVisibleKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.add(toCustomColumnKey(key)));
        const order = allColumnDefs.map((c) => c.key);
        return order.filter((k) => next.has(k));
      });
    },
    [allColumnDefs],
  );

  const getFieldValue = useCallback(
    (client: Client, field: EditableKey) => {
      if (isCustomColumn(field)) {
        const key = fromCustomColumnKey(field);
        const raw = client.custom_fields?.[key];
        if (typeof raw === "string") return raw;
        if (raw == null) return "";
        return String(raw);
      }
      return getClientFieldValue(client, field as BaseEditableKey);
    },
    [],
  );

  const normalizeValue = useCallback(
    (field: EditableKey, value: string) => {
      if (isCustomColumn(field)) {
        const key = fromCustomColumnKey(field);
        const def = customFieldMap.get(key);
        if (def?.type === "date") {
          return toDateInputValue(value);
        }
        if (def?.type === "multiselect") {
          return serializeMultiSelectValue(
            parseMultiSelectValue(value).sort((a, b) => a.localeCompare(b)),
          );
        }
        return value.trim();
      }
      return normalizeCompareValue(field, value);
    },
    [customFieldMap],
  );

  const getFieldLabel = useCallback(
    (field: EditableKey) => {
      if (isCustomColumn(field)) {
        const key = fromCustomColumnKey(field);
        return customFieldMap.get(key)?.label || key;
      }
      return BASE_FIELD_LABELS[field as BaseEditableKey];
    },
    [customFieldMap],
  );

  const formatValue = useCallback(
    (field: EditableKey, value: string) => {
      if (!value) return "—";
      if (isCustomColumn(field)) {
        const key = fromCustomColumnKey(field);
        const def = customFieldMap.get(key);
        if (def?.type === "date") return formatDateDisplay(value);
        if (def?.type === "boolean") {
          if (value === "true") return "Sí";
          if (value === "false") return "No";
        }
        return value;
      }
      return formatFieldValue(field, value);
    },
    [customFieldMap],
  );

  const changes = useMemo(() => {
    const items: {
      clientId: number;
      field: EditableKey;
      from: string;
      to: string;
    }[] = [];
    Object.entries(drafts).forEach(([id, draft]) => {
      const clientId = Number(id);
      const client = clientMap.get(clientId);
      if (!client || !draft) return;
      (Object.keys(draft) as EditableKey[]).forEach((field) => {
        const rawFrom = getFieldValue(client, field);
        const rawTo = draft[field] ?? "";
        if (
          normalizeValue(field, rawFrom) === normalizeValue(field, rawTo)
        ) {
          return;
        }
        items.push({
          clientId,
          field,
          from: rawFrom,
          to: rawTo,
        });
      });
    });
    return items;
  }, [drafts, clientMap, getFieldValue, normalizeValue]);

  const summary = useMemo(() => {
    const map = new Map<
      string,
      { field: EditableKey; from: string; to: string; count: number }
    >();
    changes.forEach((change) => {
      const key = `${change.field}|${change.from}|${change.to}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          field: change.field,
          from: change.from,
          to: change.to,
          count: 1,
        });
      }
    });
    return Array.from(map.values());
  }, [changes]);

  const hasChanges = changes.length > 0;

  const setDraftValue = (
    clientId: number,
    field: EditableKey,
    value: string,
  ) => {
    const client = clientMap.get(clientId);
    if (!client) return;
    const original = getFieldValue(client, field);
    const normalizedOriginal = normalizeValue(field, original);
    const normalizedValue = normalizeValue(field, value);

    setDrafts((prev) => {
      const next = { ...prev };
      const existing = next[clientId] || {};
      if (normalizedOriginal === normalizedValue) {
        const rest = { ...existing };
        delete rest[field];
        if (Object.keys(rest).length === 0) {
          delete next[clientId];
        } else {
          next[clientId] = rest;
        }
      } else {
        next[clientId] = { ...existing, [field]: value };
      }
      return next;
    });

    setRowErrors((prev) => {
      const current = prev[clientId];
      if (!current) return prev;
      const next = { ...prev };
      const nextRow = { ...current };
      delete nextRow[field];
      if (field === "dni_number" || field === "passport_number") {
        delete nextRow.dni_number;
        delete nextRow.passport_number;
      }
      if (Object.keys(nextRow).length === 0) {
        delete next[clientId];
      } else {
        next[clientId] = nextRow;
      }
      return next;
    });
  };

  const clearDraftForClient = (clientId: number) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  };

  const saveRow = async (clientId: number) => {
    const client = clientMap.get(clientId);
    const draft = drafts[clientId];
    if (!client || !draft || !token) {
      if (!token) toast.error("Sesión inválida. Volvé a iniciar sesión.");
      return;
    }

    const payload = buildPayload(client, draft);
    const selectedProfile = resolveClientProfile(
      normalizedProfiles,
      payload.profile_key || client.profile_key,
    );
    const requiredCustomKeys = selectedProfile.custom_fields
      .filter((field) => field.required)
      .map((field) => field.key);
    const validation = validatePayload(
      payload,
      selectedProfile.required_fields,
      requiredCustomKeys,
    );
    if (!validation.ok) {
      setRowErrors((prev) => ({ ...prev, [clientId]: validation.fieldErrors }));
      if (validation.missingCustomKeys.length) {
        ensureCustomColumnsVisible(validation.missingCustomKeys);
        toast.error("Completá los campos personalizados obligatorios.");
      } else {
        toast.error("Revisá los campos requeridos antes de guardar.");
      }
      return;
    }

    setSavingRows((prev) => ({ ...prev, [clientId]: true }));
    try {
      const res = await authFetch(
        `/api/clients/${clientId}`,
        { method: "PUT", body: JSON.stringify(payload) },
        token,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || "Error al guardar el pax.");
      }
      onClientsUpdated([body as Client]);
      clearDraftForClient(clientId);
      toast.success("Pax actualizado.");
    } catch (err) {
      console.error("saveRow client:", err);
      toast.error((err as Error).message || "Error al guardar el pax.");
    } finally {
      setSavingRows((prev) => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
    }
  };

  const revertChange = (clientId: number, field: EditableKey) => {
    setDrafts((prev) => {
      const next = { ...prev };
      const current = next[clientId];
      if (!current) return prev;
      const rest = { ...current };
      delete rest[field];
      if (Object.keys(rest).length === 0) {
        delete next[clientId];
      } else {
        next[clientId] = rest;
      }
      return next;
    });
  };

  const saveAll = async () => {
    if (!token) {
      toast.error("Sesión inválida. Volvé a iniciar sesión.");
      return;
    }

    setSaveAllBusy(true);
    setSaveAllErrors([]);

    const updates: Client[] = [];
    const errors: { clientId: number; message: string }[] = [];

    const entries = Object.entries(drafts).map(([id, draft]) => {
      const clientId = Number(id);
      return { clientId, draft };
    });

    const tasks = entries.map(async ({ clientId, draft }) => {
      const client = clientMap.get(clientId);
      if (!client) return;
      const payload = buildPayload(client, draft);
      const selectedProfile = resolveClientProfile(
        normalizedProfiles,
        payload.profile_key || client.profile_key,
      );
      const requiredCustomKeys = selectedProfile.custom_fields
        .filter((field) => field.required)
        .map((field) => field.key);
      const validation = validatePayload(
        payload,
        selectedProfile.required_fields,
        requiredCustomKeys,
      );
      if (!validation.ok) {
        setRowErrors((prev) => ({
          ...prev,
          [clientId]: validation.fieldErrors,
        }));
        if (validation.missingCustomKeys.length) {
          ensureCustomColumnsVisible(validation.missingCustomKeys);
          errors.push({
            clientId,
            message: "Faltan campos personalizados obligatorios.",
          });
        } else {
          errors.push({
            clientId,
            message: "Validación pendiente en algunos campos.",
          });
        }
        return;
      }

      const res = await authFetch(
        `/api/clients/${clientId}`,
        { method: "PUT", body: JSON.stringify(payload) },
        token,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        errors.push({
          clientId,
          message: body?.error || "Error al guardar el pax.",
        });
        return;
      }
      updates.push(body as Client);
    });

    try {
      await Promise.all(tasks);
      if (updates.length) {
        onClientsUpdated(updates);
        updates.forEach((u) => clearDraftForClient(u.id_client));
      }
      if (errors.length) {
        setSaveAllErrors(errors);
        toast.error("Algunos cambios no se pudieron guardar.");
      } else {
        setSaveAllOpen(false);
        toast.success("Cambios guardados.");
      }
    } catch (err) {
      console.error("saveAll clients:", err);
      toast.error("Error al guardar cambios.");
    } finally {
      setSaveAllBusy(false);
    }
  };

  const renderCell = (client: Client, field: ColumnKey) => {
    if (field === "client_number") {
      return client.agency_client_id ?? "Sin Nº";
    }
    if (field === "profile_key") {
      const key = String(client.profile_key || "");
      return (
        <span className="inline-flex rounded-full border border-sky-200/70 bg-sky-100/70 px-2 py-0.5 text-xs font-semibold text-sky-900 dark:border-sky-700/70 dark:bg-sky-900/40 dark:text-sky-100">
          {profileLabelMap.get(key) || key || DEFAULT_CLIENT_PROFILE_LABEL}
        </span>
      );
    }
    if (field === "id_client") {
      return client.id_client;
    }
    if (field === "registration_date") {
      return formatDateDisplay(client.registration_date);
    }

    const editableField = field as EditableKey;
    const draftValue = drafts[client.id_client]?.[editableField];
    const rawValue = getFieldValue(client, editableField);
    const value = draftValue !== undefined ? draftValue : rawValue;
    const isDirty = normalizeValue(editableField, rawValue) !==
      normalizeValue(editableField, value);
    const hasError = rowErrors[client.id_client]?.[editableField];
    const baseInput =
      "w-full min-w-[140px] rounded-2xl border border-sky-200 bg-white/50 px-3 py-2 text-sm shadow-sm shadow-sky-950/10 outline-none transition dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";
    const tone = isDirty ? "bg-emerald-500/10 border-emerald-500/40" : "";
    const error = hasError ? "ring-2 ring-rose-500/50" : "";

    if (isCustomColumn(editableField)) {
      const key = fromCustomColumnKey(editableField);
      const def = customFieldMap.get(key);
      const options = Array.isArray(def?.options) ? def.options : [];

      if (def?.type === "select") {
        return (
          <select
            value={value}
            onChange={(e) =>
              setDraftValue(client.id_client, editableField, e.target.value)
            }
            title={hasError || undefined}
            className={`${baseInput} ${tone} ${error} cursor-pointer appearance-none`}
          >
            <option value="">Seleccionar</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      }

      if (def?.type === "multiselect") {
        if (options.length === 0) {
          return (
            <input
              type="text"
              value={value}
              onChange={(e) =>
                setDraftValue(client.id_client, editableField, e.target.value)
              }
              title={hasError || undefined}
              placeholder="Sin opciones"
              className={`${baseInput} ${tone} ${error}`}
            />
          );
        }
        const selectedValues = parseMultiSelectValue(value);
        return (
          <select
            multiple
            value={selectedValues}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map(
                (option) => option.value,
              );
              setDraftValue(
                client.id_client,
                editableField,
                serializeMultiSelectValue(selected),
              );
            }}
            title={hasError || undefined}
            className={`${baseInput} ${tone} ${error} min-h-[96px]`}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      }

      if (def?.type === "boolean") {
        return (
          <select
            value={value}
            onChange={(e) =>
              setDraftValue(client.id_client, editableField, e.target.value)
            }
            title={hasError || undefined}
            className={`${baseInput} ${tone} ${error} cursor-pointer appearance-none`}
          >
            <option value="">Seleccionar</option>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        );
      }

      if (def?.type === "textarea") {
        return (
          <textarea
            value={value}
            onChange={(e) =>
              setDraftValue(client.id_client, editableField, e.target.value)
            }
            title={hasError || undefined}
            rows={2}
            className={`${baseInput} ${tone} ${error}`}
          />
        );
      }

      const inputType = def?.type === "number" ? "number" : def?.type === "date" ? "date" : "text";
      const displayValue = def?.type === "date" ? toDateInputValue(value) : value;
      return (
        <input
          type={inputType}
          value={displayValue}
          onChange={(e) =>
            setDraftValue(client.id_client, editableField, e.target.value)
          }
          title={hasError || undefined}
          className={`${baseInput} ${tone} ${error}`}
        />
      );
    }

    if (editableField === "gender") {
      return (
        <select
          value={value}
          onChange={(e) =>
            setDraftValue(client.id_client, editableField, e.target.value)
          }
          title={hasError || undefined}
          className={`${baseInput} ${tone} ${error} cursor-pointer appearance-none`}
        >
          <option value="">Seleccionar</option>
          {GENDER_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (editableField === "birth_date") {
      return (
        <input
          type="date"
          value={toDateInputValue(value)}
          onChange={(e) =>
            setDraftValue(client.id_client, editableField, e.target.value)
          }
          title={hasError || undefined}
          className={`${baseInput} ${tone} ${error}`}
        />
      );
    }

    return (
      <input
        type={editableField === "email" ? "email" : "text"}
        inputMode={
          editableField === "phone"
            ? "tel"
            : editableField === "email"
              ? "email"
              : "text"
        }
        value={value}
        onChange={(e) =>
          setDraftValue(client.id_client, editableField, e.target.value)
        }
        title={hasError || undefined}
        className={`${baseInput} ${tone} ${error}`}
      />
    );
  };

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <span className={CHIP}>Filas: {clients.length}</span>
          <span className={CHIP}>Cambios: {changes.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setColumnPickerOpen(true)}
            className={ICON_BTN}
          >
            Columnas
          </button>
          <button
            onClick={() => {
              setSaveAllErrors([]);
              setSaveAllOpen(true);
            }}
            disabled={!hasChanges}
            className={`${PRIMARY_BTN} disabled:opacity-50`}
          >
            Guardar todo
          </button>
        </div>
      </div>

      <div className={`${GLASS} w-full min-w-0 max-w-full overflow-x-auto`}>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-zinc-700 backdrop-blur dark:text-zinc-200">
              {visibleKeys.map((col) => {
                const def = allColumnDefs.find((d) => d.key === col);
                return (
                  <th key={col} className="p-3 text-left font-medium">
                    {def?.label}
                  </th>
                );
              })}
              <th className="p-3 text-left font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => {
              const rowDirty = Boolean(drafts[client.id_client]);
              return (
                <tr
                  key={client.id_client}
                  className={`border-t border-white/30 backdrop-blur-sm transition dark:border-white/10 ${
                    rowDirty
                      ? "bg-emerald-500/10"
                      : "hover:bg-white/10 dark:hover:bg-white/10"
                  }`}
                >
                  {visibleKeys.map((col) => (
                    <td key={col} className="px-3 py-2 align-top">
                      {renderCell(client, col)}
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top">
                    {rowDirty ? (
                      <button
                        onClick={() => saveRow(client.id_client)}
                        disabled={
                          Boolean(savingRows[client.id_client]) || saveAllBusy
                        }
                        className={`${PRIMARY_BTN} disabled:opacity-50`}
                      >
                        {savingRows[client.id_client] ? <Spinner /> : "Guardar"}
                      </button>
                    ) : (
                      <span className="text-xs opacity-60">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {isLoading && clients.length === 0 && (
              <tr>
                <td
                  colSpan={visibleKeys.length + 1}
                  className="px-4 py-10 text-center"
                >
                  <Spinner />
                </td>
              </tr>
            )}

            {!isLoading && clients.length === 0 && (
              <tr>
                <td
                  colSpan={visibleKeys.length + 1}
                  className="px-4 py-10 text-center opacity-70"
                >
                  No hay resultados. Ajustá los filtros y probá de nuevo.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex w-full items-center justify-between border-t border-white/30 bg-white/10 px-3 py-2 text-xs backdrop-blur dark:border-white/10 dark:bg-white/10">
          <div className="opacity-70">{clients.length} filas</div>
          <button
            onClick={onLoadMore}
            disabled={loadingMore || !hasMore}
            className={`${ICON_BTN} disabled:opacity-50`}
          >
            {!hasMore
              ? "No hay más"
              : loadingMore
                ? "Cargando..."
                : "Cargar más"}
          </button>
        </div>
      </div>

      <ColumnPickerModal
        open={columnPickerOpen}
        onClose={() => setColumnPickerOpen(false)}
        items={allColumnDefs.map((c) => ({
          key: c.key,
          label: c.label,
          locked: c.always,
        }))}
        visibleKeys={visibleKeys}
        onToggle={(key) =>
          setVisibleKeys((prev) => {
            const next = prev.includes(key)
              ? prev.filter((k) => k !== key)
              : [...prev, key];
            const order = allColumnDefs.map((c) => c.key);
            return order.filter((k) => next.includes(k));
          })
        }
        onAll={() => setVisibleKeys(allColumnDefs.map((c) => c.key))}
        onNone={() =>
          setVisibleKeys(
            allColumnDefs.filter((c) => c.always).map((c) => c.key),
          )
        }
        onReset={() => setVisibleKeys(DEFAULT_VISIBLE)}
      />

      <SaveAllModal
        open={saveAllOpen}
        onClose={() => setSaveAllOpen(false)}
        changes={changes}
        summary={summary}
        saveAllBusy={saveAllBusy}
        onSaveAll={saveAll}
        onRevert={revertChange}
        clientMap={clientMap}
        errors={saveAllErrors}
        getLabel={getFieldLabel}
        formatValue={formatValue}
      />
    </div>
  );
}

function ColumnPickerModal({
  open,
  onClose,
  items,
  visibleKeys,
  onToggle,
  onAll,
  onNone,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  items: { key: ColumnKey; label: string; locked?: boolean }[];
  visibleKeys: ColumnKey[];
  onToggle: (k: ColumnKey) => void;
  onAll: () => void;
  onNone: () => void;
  onReset: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120]">
      <div
        className="absolute inset-0 bg-black/10 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`${GLASS} absolute left-1/2 top-1/2 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 p-5`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Columnas</h3>
          <button onClick={onClose} className={ICON_BTN}>
            ✕
          </button>
        </div>
        <div className="max-h-72 space-y-1 overflow-auto pr-1">
          {items.map((it) => (
            <label
              key={it.key}
              className={`flex cursor-pointer items-center justify-between rounded-3xl px-2 py-1 text-sm ${
                it.locked
                  ? "opacity-60"
                  : "hover:bg-white/10 dark:hover:bg-zinc-800/50"
              }`}
            >
              <span>{it.label}</span>
              <input
                type="checkbox"
                checked={visibleKeys.includes(it.key)}
                onChange={() => !it.locked && onToggle(it.key)}
                disabled={it.locked}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={onAll} className={ICON_BTN}>
            Todas
          </button>
          <button onClick={onNone} className={ICON_BTN}>
            Ninguna
          </button>
          <button onClick={onReset} className={ICON_BTN}>
            Reset
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className={PRIMARY_BTN}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveAllModal({
  open,
  onClose,
  changes,
  summary,
  saveAllBusy,
  onSaveAll,
  onRevert,
  clientMap,
  errors,
  getLabel,
  formatValue,
}: {
  open: boolean;
  onClose: () => void;
  changes: { clientId: number; field: EditableKey; from: string; to: string }[];
  summary: { field: EditableKey; from: string; to: string; count: number }[];
  saveAllBusy: boolean;
  onSaveAll: () => void;
  onRevert: (clientId: number, field: EditableKey) => void;
  clientMap: Map<number, Client>;
  errors: { clientId: number; message: string }[];
  getLabel: (field: EditableKey) => string;
  formatValue: (field: EditableKey, value: string) => string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130]">
      <div
        className="absolute inset-0 bg-black/10 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`${GLASS} absolute left-1/2 top-1/2 w-[min(92vw,720px)] -translate-x-1/2 -translate-y-1/2 p-5`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Guardar todo</h3>
          <button onClick={onClose} className={ICON_BTN}>
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sky-900/70 dark:text-sky-100/70">
              Resumen de cambios
            </p>
            <div className="mt-2 grid gap-2">
              {summary.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm opacity-70">
                  No hay cambios pendientes.
                </div>
              )}
              {summary.map((s, idx) => (
                <div
                  key={`${s.field}-${idx}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{getLabel(s.field)}</span>
                  <span className="opacity-70">
                    {formatValue(s.field, s.from)} →{" "}
                    {formatValue(s.field, s.to)}
                  </span>
                  <span className="font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sky-900/70 dark:text-sky-100/70">
              Cambios detallados
            </p>
            <div className="mt-2 max-h-64 space-y-2 overflow-auto pr-1">
              {changes.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm opacity-70">
                  No hay cambios pendientes.
                </div>
              )}
              {changes.map((c, idx) => {
                const client = clientMap.get(c.clientId);
                const clientNumber = client?.agency_client_id ?? "Sin Nº";
                const clientName =
                  client?.first_name || client?.last_name
                    ? `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim()
                    : `Pax ${clientNumber}`;
                return (
                  <div
                    key={`${c.clientId}-${c.field}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.2em] text-sky-900/60 dark:text-sky-100/60">
                        Pax Nº {clientNumber}
                      </span>
                      <span className="font-medium">{clientName}</span>
                      <span className="opacity-70">
                        {getLabel(c.field)}: {formatValue(c.field, c.from)} →{" "}
                        {formatValue(c.field, c.to)}
                      </span>
                    </div>
                    <button
                      onClick={() => onRevert(c.clientId, c.field)}
                      className={ICON_BTN}
                    >
                      Revertir
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {errors.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-rose-700/80 dark:text-rose-200/80">
                Errores detectados
              </p>
              <div className="mt-2 space-y-2">
                {errors.map((err) => {
                  const client = clientMap.get(err.clientId);
                  const clientNumber = client?.agency_client_id ?? "Sin Nº";
                  const clientName =
                    client?.first_name || client?.last_name
                      ? `${client?.first_name ?? ""} ${client?.last_name ?? ""}`.trim()
                      : "";
                  return (
                    <div
                      key={`${err.clientId}-${err.message}`}
                      className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-900 dark:text-rose-100"
                    >
                      Pax Nº {clientNumber} {clientName && `(${clientName})`}
                      : {err.message}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className={ICON_BTN} disabled={saveAllBusy}>
            Cerrar
          </button>
          <button
            onClick={onSaveAll}
            className={PRIMARY_BTN}
            disabled={saveAllBusy || changes.length === 0}
          >
            {saveAllBusy ? <Spinner /> : "Guardar todo"}
          </button>
        </div>
      </div>
    </div>
  );
}
