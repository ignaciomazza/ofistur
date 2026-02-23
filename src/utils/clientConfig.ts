import type {
  ClientCustomField,
  ClientCustomFieldType,
  ClientProfileConfig,
} from "@/types";

export const DOCUMENT_ANY_KEY = "document_any";
export const DOC_REQUIRED_FIELDS = ["dni_number", "passport_number", "tax_id"];
export const DEFAULT_CLIENT_PROFILE_KEY = "persona";
export const DEFAULT_CLIENT_PROFILE_LABEL = "Pax";

export const DEFAULT_REQUIRED_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "birth_date",
  "nationality",
  "gender",
  DOCUMENT_ANY_KEY,
];

export const LOCKED_REQUIRED_FIELDS: string[] = [];

export const REQUIRED_FIELD_OPTIONS: Array<{
  key: string;
  label: string;
  locked?: boolean;
}> = [
  { key: "first_name", label: "Nombre" },
  { key: "last_name", label: "Apellido" },
  { key: "phone", label: "Teléfono / WhatsApp" },
  { key: "birth_date", label: "Fecha de Nacimiento" },
  { key: "nationality", label: "Nacionalidad" },
  { key: "gender", label: "Género" },
  { key: "email", label: "Correo electrónico" },
  { key: "dni_number", label: "Documento / CI / DNI" },
  { key: "passport_number", label: "Pasaporte" },
  { key: "tax_id", label: "CUIT / RUT" },
  { key: DOCUMENT_ANY_KEY, label: "Documento (DNI/Pasaporte/CUIT)" },
  { key: "company_name", label: "Razón Social" },
  { key: "commercial_address", label: "Domicilio Comercial" },
  { key: "address", label: "Dirección Particular" },
  { key: "locality", label: "Localidad / Ciudad" },
  { key: "postal_code", label: "Código Postal" },
];

export const HIDDEN_FIELD_OPTIONS = REQUIRED_FIELD_OPTIONS;

export const BUILTIN_CUSTOM_FIELDS: ClientCustomField[] = [
  {
    key: "dni_expiration",
    label: "Vencimiento DNI/CI",
    type: "date",
    placeholder: "dd/mm/aaaa",
    builtin: true,
  },
  {
    key: "passport_expiration",
    label: "Vencimiento Pasaporte",
    type: "date",
    placeholder: "dd/mm/aaaa",
    builtin: true,
  },
];

export const CUSTOM_FIELD_TYPES: Array<{
  value: ClientCustomFieldType;
  label: string;
}> = [
  { value: "text", label: "Texto" },
  { value: "date", label: "Fecha" },
  { value: "number", label: "Número" },
];

const KEY_REGEX = /^[a-z0-9_]+$/;

export function normalizeRequiredFields(input: unknown): string[] {
  if (input == null) return [...DEFAULT_REQUIRED_FIELDS];
  const allowed = new Set(REQUIRED_FIELD_OPTIONS.map((opt) => opt.key));
  const raw = Array.isArray(input) ? input : [];
  const normalized = raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v && allowed.has(v));
  const out = new Set<string>([...normalized, ...LOCKED_REQUIRED_FIELDS]);
  return Array.from(out);
}

export function normalizeHiddenFields(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(HIDDEN_FIELD_OPTIONS.map((opt) => opt.key));
  const raw = input
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v && allowed.has(v));
  const out = new Set<string>(raw);
  LOCKED_REQUIRED_FIELDS.forEach((key) => out.delete(key));
  return Array.from(out);
}

export function normalizeCustomFields(input: unknown): ClientCustomField[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ClientCustomField[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<ClientCustomField>;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const type =
      raw.type === "text" || raw.type === "date" || raw.type === "number"
        ? raw.type
        : null;
    if (!key || !label || !type || !KEY_REGEX.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const field: ClientCustomField = {
      key,
      label,
      type,
    };
    if (typeof raw.required === "boolean") field.required = raw.required;
    if (typeof raw.placeholder === "string" && raw.placeholder.trim()) {
      field.placeholder = raw.placeholder.trim();
    }
    if (typeof raw.help === "string" && raw.help.trim()) {
      field.help = raw.help.trim();
    }
    if (typeof raw.builtin === "boolean") field.builtin = raw.builtin;
    out.push(field);
  }
  return out;
}

type LegacyConfigInput = {
  required_fields?: unknown;
  hidden_fields?: unknown;
  custom_fields?: unknown;
};

export function normalizeClientProfiles(
  input: unknown,
  legacy?: LegacyConfigInput | null,
): ClientProfileConfig[] {
  const seen = new Set<string>();
  const out: ClientProfileConfig[] = [];

  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const key = String(rec.key ?? "")
        .trim()
        .toLowerCase();
      const label = String(rec.label ?? "").trim();
      if (!key || !label || !KEY_REGEX.test(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);

      const hidden_fields = normalizeHiddenFields(rec.hidden_fields);
      const required_fields = normalizeRequiredFields(
        rec.required_fields,
      ).filter((field) => !hidden_fields.includes(field));
      const custom_fields = normalizeCustomFields(rec.custom_fields);

      out.push({
        key,
        label,
        required_fields,
        hidden_fields,
        custom_fields,
      });
    }
  }

  if (out.length > 0) return out;

  const hidden_fields = normalizeHiddenFields(legacy?.hidden_fields);
  const required_fields = normalizeRequiredFields(legacy?.required_fields).filter(
    (field) => !hidden_fields.includes(field),
  );
  const custom_fields = normalizeCustomFields(legacy?.custom_fields);

  return [
    {
      key: DEFAULT_CLIENT_PROFILE_KEY,
      label: DEFAULT_CLIENT_PROFILE_LABEL,
      required_fields,
      hidden_fields,
      custom_fields,
    },
  ];
}

export function resolveClientProfile(
  profiles: ClientProfileConfig[],
  key: unknown,
): ClientProfileConfig {
  const normalizedKey =
    typeof key === "string"
      ? key.trim().toLowerCase()
      : DEFAULT_CLIENT_PROFILE_KEY;

  return (
    profiles.find((profile) => profile.key === normalizedKey) ??
    profiles[0] ?? {
      key: DEFAULT_CLIENT_PROFILE_KEY,
      label: DEFAULT_CLIENT_PROFILE_LABEL,
      required_fields: [...DEFAULT_REQUIRED_FIELDS],
      hidden_fields: [],
      custom_fields: [],
    }
  );
}

export function buildClientProfileKey(
  label: string,
  existingKeys: Set<string>,
): string {
  const base = slugifyKey(label) || "perfil";
  let next = base;
  let i = 2;
  while (existingKeys.has(next)) {
    next = `${base}_${i}`;
    i += 1;
  }
  return next;
}

export function buildCustomFieldKey(
  label: string,
  existingKeys: Set<string>,
): string {
  const base = slugifyKey(label) || "campo";
  let next = base;
  let i = 2;
  while (existingKeys.has(next)) {
    next = `${base}_${i}`;
    i += 1;
  }
  return next;
}

function slugifyKey(label: string): string {
  const ascii = label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const cleaned = ascii.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned;
}
