// src/app/clients/config/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import type {
  ClientConfig,
  ClientCustomField,
  ClientProfileConfig,
  PassengerCategory,
} from "@/types";
import {
  BUILTIN_CUSTOM_FIELDS,
  CUSTOM_FIELD_TYPES,
  DEFAULT_CLIENT_PROFILE_KEY,
  DEFAULT_CLIENT_PROFILE_LABEL,
  DEFAULT_REQUIRED_FIELDS,
  LOCKED_REQUIRED_FIELDS,
  REQUIRED_FIELD_OPTIONS,
  buildClientProfileKey,
  buildCustomFieldKey,
  normalizeClientProfiles,
  normalizeCustomFields,
  normalizeHiddenFields,
  normalizeRequiredFields,
  requiresChoiceOptions,
  resolveClientProfile,
} from "@/utils/clientConfig";

/* ================= Estilos compartidos ================= */
const GLASS =
  "rounded-3xl border border-white/30 bg-white/10 backdrop-blur shadow-lg shadow-sky-900/10 dark:bg-white/10 dark:border-white/5";
const PRIMARY_BTN =
  "rounded-2xl bg-sky-600/30 px-4 py-2 text-sm font-medium text-sky-950 shadow-sm shadow-sky-900/10 transition hover:bg-sky-600/40 active:scale-[.99] disabled:opacity-50 dark:text-white";

type VisibilityMode = "all" | "team" | "own";
type ConfigStack = "visibility" | "simple" | "full";

type ApiError = { error: string };

type CategoryDraft = {
  name: string;
  code: string;
  min_age: string;
  max_age: string;
  ignore_age: boolean;
  enabled: boolean;
  sort_order: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function normalizeClientConfig(v: unknown): ClientConfig | null {
  if (!isRecord(v)) return null;
  const id_agency = typeof v.id_agency === "number" ? v.id_agency : 0;
  const visibility_mode =
    v.visibility_mode === "all" ||
    v.visibility_mode === "team" ||
    v.visibility_mode === "own"
      ? v.visibility_mode
      : "all";
  const profiles = normalizeClientProfiles(v.profiles, {
    required_fields: v.required_fields,
    hidden_fields: v.hidden_fields,
    custom_fields: v.custom_fields,
  }).map((profile) => ({
    ...profile,
    custom_fields: applyBuiltinMeta(profile.custom_fields),
  }));
  const primaryProfile = resolveClientProfile(
    profiles,
    DEFAULT_CLIENT_PROFILE_KEY,
  );
  const use_simple_companions =
    typeof v.use_simple_companions === "boolean"
      ? v.use_simple_companions
      : false;
  return {
    id_agency,
    visibility_mode,
    required_fields: primaryProfile.required_fields,
    custom_fields: primaryProfile.custom_fields,
    hidden_fields: primaryProfile.hidden_fields,
    profiles,
    use_simple_companions,
  };
}

function apiErrorMessage(v: unknown): string | null {
  return isRecord(v) && typeof (v as ApiError).error === "string"
    ? (v as ApiError).error
    : null;
}

function sortStringList(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function normalizeCustomList(values: ClientCustomField[]): ClientCustomField[] {
  return [...values].sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeProfilesForCompare(values: ClientProfileConfig[]) {
  return [...values]
    .map((profile) => ({
      ...profile,
      required_fields: sortStringList(profile.required_fields || []),
      hidden_fields: sortStringList(profile.hidden_fields || []),
      custom_fields: normalizeCustomList(profile.custom_fields || []),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function applyBuiltinMeta(fields: ClientCustomField[]) {
  const builtinMap = new Map(BUILTIN_CUSTOM_FIELDS.map((f) => [f.key, f]));
  return fields.map((field) => {
    const builtin = builtinMap.get(field.key);
    if (!builtin) return field;
    return {
      ...builtin,
      required:
        typeof field.required === "boolean" ? field.required : builtin.required,
    };
  });
}

function MiniSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ${
        checked
          ? "border-sky-500 bg-sky-500"
          : "border-sky-200 bg-sky-100 dark:border-white/25 dark:bg-white/10"
      } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
      aria-pressed={checked}
    >
      <span
        className={`inline-block size-4 rounded-full border border-slate-200 bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

const OPTIONS: {
  key: VisibilityMode;
  label: string;
  desc: string;
  hint: string;
}[] = [
  {
    key: "all",
    label: "Todos",
    desc: "Todos pueden ver pasajeros y estadísticas de toda la agencia.",
    hint: "Ideal para equipos chicos o agencias centralizadas.",
  },
  {
    key: "team",
    label: "Por equipo",
    desc: "Cada usuario ve los pasajeros de su equipo. Si no pertenece a un equipo, solo ve los suyos.",
    hint: "Recomendado para agencias con áreas comerciales separadas.",
  },
  {
    key: "own",
    label: "Solo propios",
    desc: "Cada usuario ve solo sus pasajeros.",
    hint: "Máxima privacidad por vendedor.",
  },
];

const STACK_OPTIONS: Array<{
  key: ConfigStack;
  label: string;
  desc: string;
}> = [
  {
    key: "visibility",
    label: "Visibilidad",
    desc: "Qué vendedores ven qué pasajeros.",
  },
  {
    key: "simple",
    label: "Pax Simple",
    desc: "Acompañantes simples y categorías.",
  },
  {
    key: "full",
    label: "Pax Completo",
    desc: "Tipos de pax y campos del formulario completo.",
  },
];

export default function ClientsConfigPage() {
  const { token } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  const [mode, setMode] = useState<VisibilityMode>("all");
  const [initialMode, setInitialMode] = useState<VisibilityMode>("all");
  const [profiles, setProfiles] = useState<ClientProfileConfig[]>([
    {
      key: DEFAULT_CLIENT_PROFILE_KEY,
      label: DEFAULT_CLIENT_PROFILE_LABEL,
      required_fields: DEFAULT_REQUIRED_FIELDS,
      hidden_fields: [],
      custom_fields: [],
    },
  ]);
  const [initialProfiles, setInitialProfiles] = useState<ClientProfileConfig[]>(
    [
      {
        key: DEFAULT_CLIENT_PROFILE_KEY,
        label: DEFAULT_CLIENT_PROFILE_LABEL,
        required_fields: DEFAULT_REQUIRED_FIELDS,
        hidden_fields: [],
        custom_fields: [],
      },
    ],
  );
  const [activeProfileKey, setActiveProfileKey] = useState<string>(
    DEFAULT_CLIENT_PROFILE_KEY,
  );
  const [useSimpleCompanions, setUseSimpleCompanions] = useState(false);
  const [initialUseSimpleCompanions, setInitialUseSimpleCompanions] =
    useState(false);

  const [categories, setCategories] = useState<PassengerCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(
    null,
  );
  const [categoryDrafts, setCategoryDrafts] = useState<
    Record<number, CategoryDraft>
  >({});
  const [newCategory, setNewCategory] = useState({
    name: "",
    code: "",
    min_age: "",
    max_age: "",
    ignore_age: false,
    enabled: true,
    sort_order: "0",
  });
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] =
    useState<ClientCustomField["type"]>("text");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([]);
  const [newFieldOptionDraft, setNewFieldOptionDraft] = useState("");
  const [customOptionDrafts, setCustomOptionDrafts] = useState<
    Record<string, string>
  >({});
  const [newProfileLabel, setNewProfileLabel] = useState("");
  const [activeStack, setActiveStack] = useState<ConfigStack>("visibility");
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null);

  const canEdit = useMemo(
    () =>
      ["gerente", "administrativo", "desarrollador"].includes(
        (role || "").toLowerCase(),
      ),
    [role],
  );

  const activeProfile = useMemo(
    () => resolveClientProfile(profiles, activeProfileKey),
    [activeProfileKey, profiles],
  );

  const requiredFields = activeProfile.required_fields;
  const hiddenFields = activeProfile.hidden_fields;
  const customFields = activeProfile.custom_fields;
  const selectedVisibilityOption =
    OPTIONS.find((opt) => opt.key === mode) ?? OPTIONS[0];

  const profilesDirty =
    JSON.stringify(normalizeProfilesForCompare(profiles)) !==
    JSON.stringify(normalizeProfilesForCompare(initialProfiles));
  const dirty =
    mode !== initialMode ||
    profilesDirty ||
    useSimpleCompanions !== initialUseSimpleCompanions;

  const updateActiveProfile = useCallback(
    (updater: (profile: ClientProfileConfig) => ClientProfileConfig) => {
      setProfiles((prev) =>
        prev.map((profile) =>
          profile.key === activeProfile.key ? updater(profile) : profile,
        ),
      );
    },
    [activeProfile.key],
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);

    (async () => {
      try {
        const [roleRes, cfgRes] = await Promise.all([
          authFetch("/api/user/profile", { cache: "no-store" }, token),
          authFetch("/api/clients/config", { cache: "no-store" }, token),
        ]);

        if (roleRes.ok) {
          const roleJson = (await roleRes.json().catch(() => ({}))) as {
            role?: string;
          };
          if (alive)
            setRole(roleJson.role ? String(roleJson.role).toLowerCase() : null);
        }

        if (cfgRes.ok) {
          const cfgJson = (await cfgRes.json().catch(() => null)) as unknown;
          const cfg = normalizeClientConfig(cfgJson);
          const warning =
            isRecord(cfgJson) && typeof cfgJson.schema_warning === "string"
              ? cfgJson.schema_warning
              : null;
          const nextMode = cfg?.visibility_mode || "all";
          const nextProfiles =
            cfg?.profiles && cfg.profiles.length > 0
              ? cfg.profiles
              : [
                  {
                    key: DEFAULT_CLIENT_PROFILE_KEY,
                    label: DEFAULT_CLIENT_PROFILE_LABEL,
                    required_fields: DEFAULT_REQUIRED_FIELDS,
                    hidden_fields: [],
                    custom_fields: [],
                  },
                ];
          if (alive) {
            setMode(nextMode);
            setInitialMode(nextMode);
            setProfiles(nextProfiles);
            setInitialProfiles(nextProfiles);
            setActiveProfileKey(nextProfiles[0].key);
            const simple = Boolean(cfg?.use_simple_companions);
            setUseSimpleCompanions(simple);
            setInitialUseSimpleCompanions(simple);
            setSchemaWarning(warning);
          }
        } else if (alive) {
          setMode("all");
          setInitialMode("all");
          const fallbackProfiles: ClientProfileConfig[] = [
            {
              key: DEFAULT_CLIENT_PROFILE_KEY,
              label: DEFAULT_CLIENT_PROFILE_LABEL,
              required_fields: DEFAULT_REQUIRED_FIELDS,
              hidden_fields: [],
              custom_fields: [],
            },
          ];
          setProfiles(fallbackProfiles);
          setInitialProfiles(fallbackProfiles);
          setActiveProfileKey(DEFAULT_CLIENT_PROFILE_KEY);
          setUseSimpleCompanions(false);
          setInitialUseSimpleCompanions(false);
          setSchemaWarning(null);
        }
      } catch (e) {
        console.error("[clients/config] load error", e);
        toast.error("No se pudo cargar la configuración de pasajeros.");
        if (alive) setSchemaWarning(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setCategoriesLoading(true);
    (async () => {
      try {
        const res = await authFetch(
          "/api/passenger-categories",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) throw new Error("No se pudieron cargar categorías.");
        const data = (await res.json().catch(() => [])) as PassengerCategory[];
        if (alive) setCategories(data);
      } catch {
        if (alive) {
          setCategories([]);
          toast.error("No se pudieron cargar las categorías.");
        }
      } finally {
        if (alive) setCategoriesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const saveConfig = async () => {
    if (!token || !dirty) return;
    setSaving(true);
    try {
      const normalizedProfiles = normalizeClientProfiles(
        profiles.map((profile) => {
          const normalizedHidden = normalizeHiddenFields(profile.hidden_fields);
          const normalizedRequired = normalizeRequiredFields(
            profile.required_fields,
          ).filter((field) => !normalizedHidden.includes(field));
          return {
            key: profile.key,
            label: profile.label.trim() || profile.key,
            required_fields: normalizedRequired,
            hidden_fields: normalizedHidden,
            custom_fields: normalizeCustomFields(
              applyBuiltinMeta(profile.custom_fields),
            ),
          };
        }),
      );
      const res = await authFetch(
        "/api/clients/config",
        {
          method: "PUT",
          body: JSON.stringify({
            visibility_mode: mode,
            profiles: normalizedProfiles,
            use_simple_companions: useSimpleCompanions,
          }),
        },
        token,
      );
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        throw new Error(apiErrorMessage(body) || "No se pudo guardar.");
      }
      const warning =
        isRecord(body) && typeof body.warning === "string"
          ? body.warning
          : null;
      setInitialMode(mode);
      setProfiles(normalizedProfiles);
      setInitialProfiles(normalizedProfiles);
      setActiveProfileKey((prev) =>
        normalizedProfiles.some((profile) => profile.key === prev)
          ? prev
          : normalizedProfiles[0].key,
      );
      setInitialUseSimpleCompanions(useSimpleCompanions);
      setSchemaWarning(warning);
      toast.success("Configuración guardada.");
      if (warning) toast.warn(warning);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo guardar.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const toggleRequiredField = (key: string, locked?: boolean) => {
    if (!canEdit || saving || locked) return;
    updateActiveProfile((profile) => {
      const nextRequired = profile.required_fields.includes(key)
        ? profile.required_fields.filter((k) => k !== key)
        : [...profile.required_fields, key];
      return {
        ...profile,
        required_fields: nextRequired,
      };
    });
  };

  const toggleHiddenField = (key: string) => {
    if (!canEdit || saving) return;
    if (LOCKED_REQUIRED_FIELDS.includes(key)) return;
    updateActiveProfile((profile) => {
      const nextHidden = profile.hidden_fields.includes(key)
        ? profile.hidden_fields.filter((k) => k !== key)
        : [...profile.hidden_fields, key];
      const nextRequired = nextHidden.includes(key)
        ? profile.required_fields.filter((k) => k !== key)
        : profile.required_fields;
      return {
        ...profile,
        hidden_fields: nextHidden,
        required_fields: nextRequired,
      };
    });
  };

  const isBuiltinActive = (key: string) =>
    customFields.some((field) => field.key === key);

  const toggleBuiltinField = (field: ClientCustomField) => {
    if (!canEdit || saving) return;
    updateActiveProfile((profile) => {
      const exists = profile.custom_fields.some((f) => f.key === field.key);
      const nextCustom = exists
        ? profile.custom_fields.filter((f) => f.key !== field.key)
        : [...profile.custom_fields, field];
      return {
        ...profile,
        custom_fields: nextCustom,
      };
    });
  };

  const startEditCategory = (cat: PassengerCategory) => {
    setEditingCategoryId(cat.id_category);
    setCategoryDrafts((prev) => ({
      ...prev,
      [cat.id_category]: {
        name: cat.name || "",
        code: cat.code || "",
        min_age:
          cat.min_age == null || Number.isNaN(cat.min_age)
            ? ""
            : String(cat.min_age),
        max_age:
          cat.max_age == null || Number.isNaN(cat.max_age)
            ? ""
            : String(cat.max_age),
        ignore_age: Boolean(cat.ignore_age),
        enabled: cat.enabled !== false,
        sort_order:
          cat.sort_order == null || Number.isNaN(cat.sort_order)
            ? "0"
            : String(cat.sort_order),
      },
    }));
  };

  const cancelEditCategory = () => {
    setEditingCategoryId(null);
  };

  const updateCategoryDraft = (id: number, patch: Partial<CategoryDraft>) => {
    setCategoryDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || ({} as CategoryDraft)), ...patch },
    }));
  };

  const createCategory = async () => {
    if (!token || !canEdit) return;
    const payload = {
      name: newCategory.name.trim(),
      code: newCategory.code.trim(),
      min_age: newCategory.min_age.trim(),
      max_age: newCategory.max_age.trim(),
      ignore_age: newCategory.ignore_age,
      enabled: newCategory.enabled,
      sort_order: newCategory.sort_order.trim(),
    };
    if (!payload.name) {
      toast.error("El nombre es obligatorio.");
      return;
    }
    try {
      const res = await authFetch(
        "/api/passenger-categories",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      );
      const data = (await res.json().catch(() => null)) as
        | PassengerCategory
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          (data as { error?: string })?.error ||
            "No se pudo crear la categoría.",
        );
      }
      setCategories((prev) => [...prev, data as PassengerCategory]);
      setNewCategory({
        name: "",
        code: "",
        min_age: "",
        max_age: "",
        ignore_age: false,
        enabled: true,
        sort_order: "0",
      });
      toast.success("Categoría creada.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo crear.";
      toast.error(msg);
    }
  };

  const saveCategory = async (id: number) => {
    if (!token || !canEdit) return;
    const draft = categoryDrafts[id];
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("El nombre es obligatorio.");
      return;
    }
    try {
      const res = await authFetch(
        `/api/passenger-categories/${id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            name: draft.name.trim(),
            code: draft.code.trim(),
            min_age: draft.min_age,
            max_age: draft.max_age,
            ignore_age: draft.ignore_age,
            enabled: draft.enabled,
            sort_order: draft.sort_order,
          }),
        },
        token,
      );
      const data = (await res.json().catch(() => null)) as
        | PassengerCategory
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          (data as { error?: string })?.error ||
            "No se pudo guardar la categoría.",
        );
      }
      setCategories((prev) =>
        prev.map((c) =>
          c.id_category === id ? (data as PassengerCategory) : c,
        ),
      );
      setEditingCategoryId(null);
      toast.success("Categoría actualizada.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo guardar.";
      toast.error(msg);
    }
  };

  const deleteCategory = async (id: number) => {
    if (!token || !canEdit) return;
    try {
      const res = await authFetch(
        `/api/passenger-categories/${id}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string };
        throw new Error(data?.error || "No se pudo eliminar.");
      }
      setCategories((prev) => prev.filter((c) => c.id_category !== id));
      if (editingCategoryId === id) setEditingCategoryId(null);
      toast.success("Categoría eliminada.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo eliminar.";
      toast.error(msg);
    }
  };

  const updateCustomField = (
    key: string,
    patch: Partial<ClientCustomField>,
  ) => {
    if (!canEdit || saving) return;
    updateActiveProfile((profile) => ({
      ...profile,
      custom_fields: profile.custom_fields.map((field) =>
        field.key === key ? { ...field, ...patch } : field,
      ),
    }));
  };

  const removeCustomField = (key: string) => {
    if (!canEdit || saving) return;
    updateActiveProfile((profile) => ({
      ...profile,
      custom_fields: profile.custom_fields.filter((field) => field.key !== key),
    }));
    setCustomOptionDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addNewFieldOption = () => {
    const value = newFieldOptionDraft.trim();
    if (!value) return;
    const alreadyExists = newFieldOptions.some(
      (option) => option.toLowerCase() === value.toLowerCase(),
    );
    if (alreadyExists) {
      toast.info("Esa opción ya está cargada.");
      return;
    }
    setNewFieldOptions((prev) => [...prev, value]);
    setNewFieldOptionDraft("");
  };

  const removeNewFieldOption = (option: string) => {
    setNewFieldOptions((prev) => prev.filter((item) => item !== option));
  };

  const addCustomFieldOption = (key: string) => {
    const value = String(customOptionDrafts[key] || "").trim();
    if (!value) return;
    const targetField = customFields.find((field) => field.key === key);
    if (!targetField || !requiresChoiceOptions(targetField.type)) return;
    const current = Array.isArray(targetField.options) ? targetField.options : [];
    const alreadyExists = current.some(
      (option) => option.toLowerCase() === value.toLowerCase(),
    );
    if (alreadyExists) {
      toast.info("Esa opción ya está cargada.");
      return;
    }
    updateCustomField(key, { options: [...current, value] });
    setCustomOptionDrafts((prev) => ({ ...prev, [key]: "" }));
  };

  const removeCustomFieldOption = (key: string, option: string) => {
    const targetField = customFields.find((field) => field.key === key);
    if (!targetField || !requiresChoiceOptions(targetField.type)) return;
    const current = Array.isArray(targetField.options) ? targetField.options : [];
    updateCustomField(key, {
      options: current.filter((item) => item !== option),
    });
  };

  const addCustomField = () => {
    if (!canEdit || saving) return;
    const label = newFieldLabel.trim();
    if (!label) {
      toast.error("Ingresá un nombre para el campo.");
      return;
    }
    if (requiresChoiceOptions(newFieldType) && newFieldOptions.length === 0) {
      toast.error("Agregá al menos una opción para este campo de lista.");
      return;
    }
    const existingKeys = new Set(customFields.map((f) => f.key));
    const key = buildCustomFieldKey(label, existingKeys);
    const next: ClientCustomField = {
      key,
      label,
      type: newFieldType,
      required: newFieldRequired,
      options: requiresChoiceOptions(newFieldType) ? newFieldOptions : undefined,
    };
    if (newFieldType === "date") next.placeholder = "dd/mm/aaaa";
    updateActiveProfile((profile) => ({
      ...profile,
      custom_fields: [...profile.custom_fields, next],
    }));
    setNewFieldLabel("");
    setNewFieldType("text");
    setNewFieldRequired(false);
    setNewFieldOptions([]);
    setNewFieldOptionDraft("");
  };

  const addProfile = () => {
    if (!canEdit || saving) return;
    const label = newProfileLabel.trim();
    if (!label) {
      toast.error("Ingresá un nombre para el tipo de pax.");
      return;
    }
    const existingKeys = new Set(profiles.map((profile) => profile.key));
    const key = buildClientProfileKey(label, existingKeys);
    const seed = resolveClientProfile(profiles, activeProfileKey);
    const nextProfile: ClientProfileConfig = {
      key,
      label,
      required_fields: [...seed.required_fields],
      hidden_fields: [...seed.hidden_fields],
      custom_fields: seed.custom_fields.map((field) => ({
        ...field,
        options: Array.isArray(field.options) ? [...field.options] : undefined,
      })),
    };
    setProfiles((prev) => [...prev, nextProfile]);
    setActiveProfileKey(key);
    setNewProfileLabel("");
  };

  const removeActiveProfile = () => {
    if (!canEdit || saving) return;
    if (profiles.length <= 1) {
      toast.error("Debe quedar al menos un tipo de pax.");
      return;
    }
    setProfiles((prev) => {
      const next = prev.filter((profile) => profile.key !== activeProfile.key);
      setActiveProfileKey(next[0]?.key || DEFAULT_CLIENT_PROFILE_KEY);
      return next;
    });
  };

  if (!mounted) return null;

  return (
    <ProtectedRoute>
      <section className="mx-auto px-4 py-6 text-sky-950 dark:text-white">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">
              Configuración de Pasajeros
            </h1>
            <p className="mt-1 text-sm text-sky-950/70 dark:text-white/70">
              Configurá visibilidad, pax simple y pax completo en pilas
              separadas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!canEdit && (
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs">
                Solo lectura
              </span>
            )}
            <button
              type="button"
              onClick={saveConfig}
              disabled={!dirty || !canEdit || saving}
              className={PRIMARY_BTN}
            >
              Guardar cambios
            </button>
          </div>
        </div>

        {schemaWarning ? (
          <div className="mb-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            {schemaWarning}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-6">
            <div className={`${GLASS} p-4`}>
              <div className="flex flex-wrap items-center gap-2">
                {STACK_OPTIONS.map((stack) => {
                  const active = activeStack === stack.key;
                  return (
                    <button
                      key={stack.key}
                      type="button"
                      onClick={() => setActiveStack(stack.key)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        active
                          ? "border-sky-400/60 bg-sky-500/20 text-sky-950 dark:text-sky-100"
                          : "border-white/20 bg-white/10 text-sky-950/80 hover:bg-white/20 dark:text-white/80"
                      }`}
                    >
                      {stack.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-sky-950/70 dark:text-white/70">
                {STACK_OPTIONS.find((stack) => stack.key === activeStack)?.desc}
              </p>
            </div>

            {activeStack === "visibility" && (
              <div className={`${GLASS} p-5`}>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-medium">Visibilidad</h2>
                    <p className="text-sm text-sky-950/70 dark:text-white/70">
                      Aplica a vendedores. Líderes ven su equipo. Y gerentes ven
                      todo.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {OPTIONS.map((opt) => {
                    const active = mode === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setMode(opt.key)}
                        disabled={!canEdit || saving}
                        className={`rounded-2xl border bg-white/10 p-4 text-left transition ${
                          active
                            ? "border-sky-400/70 ring-1 ring-sky-400/50"
                            : "border-white/20 hover:bg-white/20"
                        } ${!canEdit ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{opt.label}</span>
                          <span
                            className={`inline-flex size-5 items-center justify-center rounded-full border ${
                              active
                                ? "border-sky-500 bg-sky-500 text-white"
                                : "border-sky-200 bg-sky-100 text-transparent dark:border-white/25 dark:bg-white/10"
                            }`}
                            aria-hidden="true"
                          >
                            •
                          </span>
                        </div>
                        <p className="text-sm text-sky-950/80 dark:text-white/80">
                          {opt.desc}
                        </p>
                        <p className="mt-2 text-xs text-sky-950/65 dark:text-white/65">
                          {opt.hint}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 rounded-2xl border border-white/20 bg-white/10 px-3 py-2">
                  <p className="text-sm font-medium">
                    {selectedVisibilityOption.label}
                  </p>
                  <p className="text-xs text-sky-950/70 dark:text-white/70">
                    {selectedVisibilityOption.desc}
                  </p>
                  <p className="text-xs text-sky-950/60 dark:text-white/60">
                    {selectedVisibilityOption.hint}
                  </p>
                </div>
              </div>
            )}

            {activeStack === "simple" && (
              <>
                <div className={`${GLASS} p-5`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium">
                        Acompañantes simples
                      </h2>
                      <p className="text-sm text-sky-950/70 dark:text-white/70">
                        Activa la carga rápida con acompañantes por edad o
                        categoría. Al habilitar, se usa por defecto en reservas
                        y carga rápida.
                      </p>
                    </div>
                  </div>
                  <label
                    className={`flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm backdrop-blur ${
                      !canEdit ? "cursor-not-allowed opacity-60" : ""
                    }`}
                  >
                    <span className="flex-1">
                      Habilitar acompañantes simples (por defecto)
                    </span>
                    <MiniSwitch
                      checked={useSimpleCompanions}
                      disabled={!canEdit || saving}
                      onChange={() => setUseSimpleCompanions((prev) => !prev)}
                    />
                  </label>
                  <p className="mt-3 text-xs text-sky-950/60 dark:text-white/60">
                    Las categorías se configuran en la sección siguiente.
                  </p>
                </div>

                <div className={`${GLASS} p-5`}>
                  <div className="mb-4">
                    <h2 className="text-lg font-medium">
                      Categorías de pasajeros
                    </h2>
                    <p className="text-sm text-sky-950/70 dark:text-white/70">
                      Definí categorías por rango de edad u otros criterios.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
                    <div className="mb-3 text-sm font-medium">
                      Agregar nueva categoría
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.6fr_0.6fr_auto]">
                      <input
                        type="text"
                        value={newCategory.name}
                        onChange={(e) =>
                          setNewCategory((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="Ej: Adulto"
                        className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                        disabled={!canEdit || saving}
                      />
                      <input
                        type="text"
                        value={newCategory.code}
                        onChange={(e) =>
                          setNewCategory((prev) => ({
                            ...prev,
                            code: e.target.value,
                          }))
                        }
                        placeholder="adulto"
                        className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                        disabled={!canEdit || saving}
                      />
                      <input
                        type="number"
                        value={newCategory.min_age}
                        onChange={(e) =>
                          setNewCategory((prev) => ({
                            ...prev,
                            min_age: e.target.value,
                          }))
                        }
                        placeholder="Min"
                        className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                        disabled={!canEdit || saving}
                        min={0}
                      />
                      <input
                        type="number"
                        value={newCategory.max_age}
                        onChange={(e) =>
                          setNewCategory((prev) => ({
                            ...prev,
                            max_age: e.target.value,
                          }))
                        }
                        placeholder="Max"
                        className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                        disabled={!canEdit || saving}
                        min={0}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm">
                          <span>Ignora edad</span>
                          <MiniSwitch
                            checked={newCategory.ignore_age}
                            disabled={!canEdit || saving}
                            onChange={() =>
                              setNewCategory((prev) => ({
                                ...prev,
                                ignore_age: !prev.ignore_age,
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          onClick={createCategory}
                          disabled={!canEdit || saving}
                          className={PRIMARY_BTN}
                        >
                          Agregar
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    {categoriesLoading ? (
                      <div className="text-sm text-sky-950/70 dark:text-white/70">
                        Cargando categorías...
                      </div>
                    ) : categories.length === 0 ? (
                      <p className="text-sm text-sky-950/60 dark:text-white/60">
                        No hay categorías creadas.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {categories.map((cat) => {
                          const isEditing =
                            editingCategoryId === cat.id_category;
                          const draft = categoryDrafts[cat.id_category];
                          return (
                            <div
                              key={cat.id_category}
                              className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm"
                            >
                              <input
                                type="text"
                                value={
                                  isEditing ? (draft?.name ?? "") : cat.name
                                }
                                onChange={(e) =>
                                  updateCategoryDraft(cat.id_category, {
                                    name: e.target.value,
                                  })
                                }
                                disabled={!isEditing || !canEdit}
                                className="min-w-[140px] flex-1 rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm outline-none"
                              />
                              <input
                                type="text"
                                value={
                                  isEditing ? (draft?.code ?? "") : cat.code
                                }
                                onChange={(e) =>
                                  updateCategoryDraft(cat.id_category, {
                                    code: e.target.value,
                                  })
                                }
                                disabled={!isEditing || !canEdit}
                                className="min-w-[120px] rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm outline-none"
                              />
                              <input
                                type="number"
                                value={
                                  isEditing
                                    ? (draft?.min_age ?? "")
                                    : (cat.min_age ?? "")
                                }
                                onChange={(e) =>
                                  updateCategoryDraft(cat.id_category, {
                                    min_age: e.target.value,
                                  })
                                }
                                disabled={!isEditing || !canEdit}
                                className="w-20 rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm outline-none"
                                min={0}
                              />
                              <input
                                type="number"
                                value={
                                  isEditing
                                    ? (draft?.max_age ?? "")
                                    : (cat.max_age ?? "")
                                }
                                onChange={(e) =>
                                  updateCategoryDraft(cat.id_category, {
                                    max_age: e.target.value,
                                  })
                                }
                                disabled={!isEditing || !canEdit}
                                className="w-20 rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm outline-none"
                                min={0}
                              />
                              <div className="flex items-center gap-3 text-xs">
                                <span>Ignora edad</span>
                                <MiniSwitch
                                  checked={
                                    isEditing
                                      ? Boolean(draft?.ignore_age)
                                      : Boolean(cat.ignore_age)
                                  }
                                  disabled={!isEditing || !canEdit}
                                  onChange={() =>
                                    updateCategoryDraft(cat.id_category, {
                                      ignore_age: !(isEditing
                                        ? Boolean(draft?.ignore_age)
                                        : Boolean(cat.ignore_age)),
                                    })
                                  }
                                />
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                <span>Activa</span>
                                <MiniSwitch
                                  checked={
                                    isEditing
                                      ? Boolean(draft?.enabled)
                                      : cat.enabled !== false
                                  }
                                  disabled={!isEditing || !canEdit}
                                  onChange={() =>
                                    updateCategoryDraft(cat.id_category, {
                                      enabled: !(isEditing
                                        ? Boolean(draft?.enabled)
                                        : cat.enabled !== false),
                                    })
                                  }
                                />
                              </div>
                              <div className="ml-auto flex items-center gap-2">
                                {!isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => startEditCategory(cat)}
                                      disabled={!canEdit}
                                      className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                                    >
                                      Editar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        deleteCategory(cat.id_category)
                                      }
                                      disabled={!canEdit}
                                      className="rounded-full border border-rose-400/40 px-3 py-1 text-xs text-rose-700 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300"
                                    >
                                      Eliminar
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        saveCategory(cat.id_category)
                                      }
                                      disabled={!canEdit}
                                      className={PRIMARY_BTN}
                                    >
                                      Guardar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditCategory}
                                      disabled={!canEdit}
                                      className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                                    >
                                      Cancelar
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeStack === "full" && (
              <>
                <div className={`${GLASS} p-6`}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium">Tipos de pax</h2>
                      <p className="text-sm text-sky-950/70 dark:text-white/70">
                        Definí perfiles (ej. persona, empresa) y configurá
                        campos por tipo.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={removeActiveProfile}
                      disabled={!canEdit || saving || profiles.length <= 1}
                      className="rounded-full border border-rose-400/40 px-3 py-1 text-xs text-rose-700 hover:bg-rose-500/10 disabled:opacity-50 dark:text-rose-300"
                    >
                      Eliminar tipo activo
                    </button>
                  </div>

                  <div className="mb-4 rounded-2xl border border-sky-300/30 bg-sky-500/10 p-4">
                    <p className="text-sm font-semibold text-sky-950 dark:text-sky-100">
                      Crear nuevo tipo de pax
                    </p>
                    <p className="mt-1 text-xs text-sky-950/70 dark:text-white/70">
                      Usá esto para agregar un perfil nuevo (por ejemplo:
                      Empresa, Estudiante, Menor). Luego lo seleccionás abajo y
                      configurás sus campos.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={newProfileLabel}
                        onChange={(e) => setNewProfileLabel(e.target.value)}
                        placeholder="Nombre del nuevo tipo (ej: Empresa)"
                        disabled={!canEdit || saving}
                        className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none md:w-80"
                      />
                      <button
                        type="button"
                        onClick={addProfile}
                        disabled={!canEdit || saving}
                        className={PRIMARY_BTN}
                      >
                        Crear tipo de pax
                      </button>
                    </div>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {profiles.map((profile) => {
                      const active = profile.key === activeProfile.key;
                      return (
                        <button
                          key={profile.key}
                          type="button"
                          onClick={() => setActiveProfileKey(profile.key)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                            active
                              ? "border-sky-400/60 bg-sky-500/20 text-sky-950 dark:text-sky-100"
                              : "border-white/20 bg-white/10 text-sky-950/80 hover:bg-white/20 dark:text-white/80"
                          }`}
                        >
                          {profile.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-sky-950/80 dark:text-white/80">
                          Nombre del tipo activo
                        </span>
                        <input
                          type="text"
                          value={activeProfile.label}
                          onChange={(e) =>
                            updateActiveProfile((profile) => ({
                              ...profile,
                              label: e.target.value,
                            }))
                          }
                          disabled={!canEdit || saving}
                          className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-sky-950/80 dark:text-white/80">
                          Clave técnica
                        </span>
                        <input
                          type="text"
                          value={activeProfile.key}
                          disabled
                          className="w-full rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm opacity-80 outline-none"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className={`${GLASS} p-6`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium">
                        Campos obligatorios
                      </h2>
                      <p className="text-sm text-sky-950/70 dark:text-white/70">
                        Definí qué datos deben completarse al crear o editar un
                        pax.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {REQUIRED_FIELD_OPTIONS.map((opt) => {
                      const checked = requiredFields.includes(opt.key);
                      const locked = opt.locked;
                      return (
                        <div
                          key={opt.key}
                          className={`flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm backdrop-blur ${
                            !canEdit ? "cursor-not-allowed opacity-60" : ""
                          }`}
                        >
                          <span className="flex-1">{opt.label}</span>
                          {locked ? (
                            <span className="text-xs text-sky-950/60 dark:text-white/60">
                              Siempre requerido
                            </span>
                          ) : null}
                          <MiniSwitch
                            checked={checked}
                            disabled={!canEdit || saving || locked}
                            onChange={() =>
                              toggleRequiredField(opt.key, locked)
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={`${GLASS} p-6`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium">Campos ocultos</h2>
                      <p className="text-sm text-sky-950/70 dark:text-white/70">
                        Ocultá inputs que tu agencia no utiliza. Los campos
                        obligatorios no se pueden ocultar.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {REQUIRED_FIELD_OPTIONS.map((opt) => {
                      const checked = hiddenFields.includes(opt.key);
                      const locked = LOCKED_REQUIRED_FIELDS.includes(opt.key);
                      const requiredNow =
                        requiredFields.includes(opt.key) || locked;
                      const disabled =
                        !canEdit || saving || requiredNow || locked;
                      return (
                        <div
                          key={`hidden-${opt.key}`}
                          className={`flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm backdrop-blur ${
                            !canEdit ? "cursor-not-allowed opacity-60" : ""
                          }`}
                        >
                          <span className="flex-1">{opt.label}</span>
                          {requiredNow ? (
                            <span className="text-xs text-sky-950/60 dark:text-white/60">
                              Obligatorio
                            </span>
                          ) : null}
                          <MiniSwitch
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleHiddenField(opt.key)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={`${GLASS} p-6`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-medium">
                        Campos personalizados
                      </h2>
                      <p className="text-sm text-sky-950/70 dark:text-white/70">
                        Activá campos prearmados o sumá nuevos para tu agencia.
                      </p>
                    </div>
                  </div>

                  <div className="mb-5 grid gap-3 sm:grid-cols-2">
                    {BUILTIN_CUSTOM_FIELDS.map((field) => {
                      const active = isBuiltinActive(field.key);
                      return (
                        <div
                          key={field.key}
                          className={`flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm backdrop-blur ${
                            !canEdit ? "cursor-not-allowed opacity-60" : ""
                          }`}
                        >
                          <span className="flex-1">{field.label}</span>
                          {active ? (
                            <span className="text-xs text-sky-950/60 dark:text-white/60">
                              Activo
                            </span>
                          ) : null}
                          <MiniSwitch
                            checked={active}
                            disabled={!canEdit || saving}
                            onChange={() => toggleBuiltinField(field)}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-white/20 bg-white/10 p-4">
                    <div className="mb-3 text-sm font-medium">
                      Agregar nuevo campo
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_0.7fr_auto]">
                      <input
                        type="text"
                        value={newFieldLabel}
                        onChange={(e) => setNewFieldLabel(e.target.value)}
                        placeholder="Ej: Vencimiento Visa"
                        className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                        disabled={!canEdit || saving}
                      />
                      <select
                        value={newFieldType}
                        onChange={(e) => {
                          const nextType = e.target
                            .value as ClientCustomField["type"];
                          setNewFieldType(nextType);
                          if (!requiresChoiceOptions(nextType)) {
                            setNewFieldOptions([]);
                            setNewFieldOptionDraft("");
                          }
                        }}
                        className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
                        disabled={!canEdit || saving}
                      >
                        {CUSTOM_FIELD_TYPES.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 text-sm">
                        <span>Requerido</span>
                        <MiniSwitch
                          checked={newFieldRequired}
                          disabled={!canEdit || saving}
                          onChange={() => setNewFieldRequired((prev) => !prev)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={addCustomField}
                        disabled={!canEdit || saving}
                        className={PRIMARY_BTN}
                      >
                        Agregar
                      </button>
                    </div>
                    {requiresChoiceOptions(newFieldType) && (
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={newFieldOptionDraft}
                            onChange={(e) =>
                              setNewFieldOptionDraft(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              addNewFieldOption();
                            }}
                            placeholder="Agregar opción (ej: Turista)"
                            className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none md:w-auto md:flex-1"
                            disabled={!canEdit || saving}
                          />
                          <button
                            type="button"
                            onClick={addNewFieldOption}
                            disabled={!canEdit || saving}
                            className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                          >
                            Agregar opción
                          </button>
                        </div>
                        {newFieldOptions.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {newFieldOptions.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => removeNewFieldOption(option)}
                                disabled={!canEdit || saving}
                                className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                                title="Quitar opción"
                              >
                                {option} ×
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-sky-950/65 dark:text-white/65">
                            Este tipo de campo requiere al menos una opción.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {customFields.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {customFields.map((field) => {
                        const isBuiltin = Boolean(field.builtin);
                        const usesOptions = requiresChoiceOptions(field.type);
                        const optionDraft = customOptionDrafts[field.key] || "";
                        return (
                          <div
                            key={field.key}
                            className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-sm"
                          >
                            <input
                              type="text"
                              value={field.label}
                              onChange={(e) =>
                                updateCustomField(field.key, {
                                  label: e.target.value,
                                })
                              }
                              disabled={!canEdit || saving || isBuiltin}
                              className="min-w-[160px] flex-1 rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm outline-none"
                            />
                            <select
                              value={field.type}
                              onChange={(e) => {
                                const nextType = e.target
                                  .value as ClientCustomField["type"];
                                updateCustomField(field.key, {
                                  type: nextType,
                                  placeholder:
                                    nextType === "date"
                                      ? "dd/mm/aaaa"
                                      : field.placeholder,
                                  options: requiresChoiceOptions(nextType)
                                    ? Array.isArray(field.options)
                                      ? field.options
                                      : []
                                    : undefined,
                                });
                              }}
                              disabled={!canEdit || saving || isBuiltin}
                              className="rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm outline-none"
                            >
                              {CUSTOM_FIELD_TYPES.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-center gap-2">
                              <span>Requerido</span>
                              <MiniSwitch
                                checked={Boolean(field.required)}
                                disabled={!canEdit || saving}
                                onChange={() =>
                                  updateCustomField(field.key, {
                                    required: !Boolean(field.required),
                                  })
                                }
                              />
                            </label>
                            <span className="text-xs text-sky-950/60 dark:text-white/60">
                              {field.key}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeCustomField(field.key)}
                              disabled={!canEdit || saving}
                              className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                            >
                              Quitar
                            </button>
                            {usesOptions && (
                              <div className="w-full space-y-2 rounded-2xl border border-white/15 bg-white/5 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="text"
                                    value={optionDraft}
                                    onChange={(e) =>
                                      setCustomOptionDrafts((prev) => ({
                                        ...prev,
                                        [field.key]: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key !== "Enter") return;
                                      e.preventDefault();
                                      addCustomFieldOption(field.key);
                                    }}
                                    disabled={!canEdit || saving || isBuiltin}
                                    placeholder="Agregar opción"
                                    className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-sm outline-none md:w-auto md:flex-1"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => addCustomFieldOption(field.key)}
                                    disabled={!canEdit || saving || isBuiltin}
                                    className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                                  >
                                    Agregar opción
                                  </button>
                                </div>
                                {Array.isArray(field.options) &&
                                field.options.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {field.options.map((option) => (
                                      <button
                                        key={`${field.key}-${option}`}
                                        type="button"
                                        onClick={() =>
                                          removeCustomFieldOption(field.key, option)
                                        }
                                        disabled={!canEdit || saving || isBuiltin}
                                        className="rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                                        title="Quitar opción"
                                      >
                                        {option} ×
                                      </button>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-sky-950/60 dark:text-white/60">
                                    Sin opciones cargadas.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-sky-950/60 dark:text-white/60">
                      No hay campos personalizados activos.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>
      <ToastContainer position="bottom-right" autoClose={2200} />
    </ProtectedRoute>
  );
}
