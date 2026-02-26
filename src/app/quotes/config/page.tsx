"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  QUOTE_HIDDEN_FIELD_OPTIONS,
  QUOTE_REQUIRED_FIELD_OPTIONS,
  normalizeQuoteCustomFields,
  normalizeQuoteHiddenFields,
  normalizeQuoteRequiredFields,
  type QuoteCustomField,
  type QuoteCustomFieldType,
} from "@/utils/quoteConfig";

type Profile = {
  id_user: number;
  role: string;
};

type QuoteConfigDTO = {
  required_fields?: unknown;
  hidden_fields?: unknown;
  custom_fields?: unknown;
};

type NewFieldState = {
  label: string;
  type: QuoteCustomFieldType;
  required: boolean;
  options: string[];
  optionDraft: string;
  placeholder: string;
  help: string;
};

type ConfigStack =
  | "diseno_pdf"
  | "obligatorios"
  | "ocultos"
  | "personalizados"
  | "permisos";

const STACK_OPTIONS: Array<{
  key: ConfigStack;
  label: string;
  desc: string;
}> = [
  {
    key: "diseno_pdf",
    label: "Diseño de documento",
    desc: "Atajos para ajustar la apariencia de los documentos de cotización.",
  },
  {
    key: "obligatorios",
    label: "Obligatorios",
    desc: "Datos que siempre se piden al cargar una cotización.",
  },
  {
    key: "ocultos",
    label: "Ocultos",
    desc: "Datos base que no querés mostrar en el formulario.",
  },
  {
    key: "personalizados",
    label: "Personalizados",
    desc: "Campos propios para adaptar el formulario a tu forma de venta.",
  },
  {
    key: "permisos",
    label: "Permisos",
    desc: "Quién puede editar y cómo aplica el alcance por rol.",
  },
];

const FIELD_TYPE_LABELS: Record<QuoteCustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  date: "Fecha",
  select: "Lista desplegable",
  boolean: "Sí / No",
  textarea: "Texto largo",
};

const GLASS =
  "rounded-3xl border border-sky-300/30 bg-gradient-to-br from-white/56 via-sky-100/40 to-sky-100/32 shadow-lg shadow-sky-950/10 backdrop-blur-xl dark:border-sky-200/18 dark:from-sky-950/30 dark:via-sky-900/24 dark:to-sky-900/18";
const BTN =
  "rounded-full border border-sky-500/45 bg-sky-400/20 px-4 py-2 text-sm font-medium text-sky-950 shadow-sm shadow-sky-950/20 transition duration-200 hover:-translate-y-0.5 hover:bg-sky-400/30 active:translate-y-0 disabled:opacity-50 dark:border-sky-300/45 dark:bg-sky-400/20 dark:text-sky-100";
const SUBTLE_BTN =
  "rounded-full border border-sky-500/35 bg-white/55 px-4 py-2 text-sm text-sky-900 shadow-sm shadow-sky-950/10 transition duration-200 hover:-translate-y-0.5 hover:bg-sky-100/65 active:translate-y-0 disabled:opacity-50 dark:border-sky-300/35 dark:bg-sky-950/30 dark:text-sky-100";
const DANGER_BTN =
  "rounded-full border border-rose-500/55 bg-rose-200/20 px-4 py-2 text-sm font-medium text-rose-700 shadow-sm shadow-rose-950/20 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-200/30 active:translate-y-0 disabled:opacity-50 dark:border-rose-300/55 dark:bg-rose-300/20 dark:text-rose-200";
const INPUT =
  "w-full rounded-2xl border border-sky-300/40 bg-white/60 px-3 py-2 text-sm text-slate-900 outline-none shadow-sm shadow-sky-950/10 backdrop-blur placeholder:text-slate-500/80 focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 dark:border-sky-200/30 dark:bg-sky-950/20 dark:text-sky-50 dark:placeholder:text-sky-100/60";
const SELECT =
  "w-full appearance-none rounded-2xl border border-sky-300/40 bg-white/60 px-3 py-2 text-sm text-slate-900 outline-none shadow-sm shadow-sky-950/10 backdrop-blur focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 dark:border-sky-200/30 dark:bg-sky-950/20 dark:text-sky-50";
const CHIP =
  "inline-flex items-center rounded-full border border-sky-400/40 bg-sky-300/20 px-2.5 py-1 text-[11px] font-semibold text-sky-900 dark:border-sky-300/40 dark:bg-sky-300/20 dark:text-sky-100";
const SOFT_ROW =
  "rounded-2xl border border-sky-300/30 bg-white/34 px-3 py-2 text-sky-950 shadow-sm shadow-sky-950/10 dark:border-sky-200/18 dark:bg-sky-950/20 dark:text-sky-50";

function normalizeRole(role?: string | null): string {
  return String(role || "").trim().toLowerCase();
}

function canEditByRole(role?: string | null): boolean {
  return [
    "gerente",
    "administrativo",
    "admin",
    "administrador",
    "desarrollador",
    "dev",
    "developer",
  ].includes(
    normalizeRole(role),
  );
}

function slugifyKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function buildUniqueKey(label: string, existingKeys: string[]): string {
  const base = slugifyKey(label) || "campo";
  const used = new Set(existingKeys);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (suffix < 2000) {
    const next = `${base.slice(0, 36)}_${suffix}`;
    if (!used.has(next)) return next;
    suffix += 1;
  }
  return `${base.slice(0, 35)}_${Date.now().toString().slice(-4)}`;
}

const defaultNewField = (): NewFieldState => ({
  label: "",
  type: "text",
  required: false,
  options: [],
  optionDraft: "",
  placeholder: "",
  help: "",
});

function ToggleSwitch({
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
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
        checked
          ? "border-sky-500/70 bg-sky-500"
          : "border-sky-200/70 bg-sky-100/80 dark:border-white/25 dark:bg-white/10"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span
        className={`inline-block size-5 rounded-full border border-slate-200 bg-white shadow-sm transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function QuotesConfigPage() {
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [hiddenFields, setHiddenFields] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<QuoteCustomField[]>([]);
  const [newField, setNewField] = useState<NewFieldState>(defaultNewField());
  const [customSearch, setCustomSearch] = useState("");
  const [activeStack, setActiveStack] = useState<ConfigStack>("obligatorios");

  const canEdit = useMemo(() => canEditByRole(profile?.role), [profile]);
  const filteredCustomFields = useMemo(() => {
    const query = customSearch.trim().toLowerCase();
    if (!query) return customFields;
    return customFields.filter((field) =>
      `${field.label} ${field.key}`.toLowerCase().includes(query),
    );
  }, [customFields, customSearch]);
  const stackStatus = useMemo<Record<ConfigStack, string>>(
    () => ({
      diseno_pdf: "Listo",
      obligatorios:
        requiredFields.length > 0
          ? `${requiredFields.length} activos`
          : "Sin definir",
      ocultos:
        hiddenFields.length > 0 ? `${hiddenFields.length} activos` : "Sin definir",
      personalizados:
        customFields.length > 0 ? `${customFields.length} creados` : "Sin campos",
      permisos: canEdit ? "Editable" : "Solo lectura",
    }),
    [requiredFields.length, hiddenFields.length, customFields.length, canEdit],
  );

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [profileRes, cfgRes] = await Promise.all([
          authFetch("/api/user/profile", { cache: "no-store" }, token),
          authFetch("/api/quotes/config", { cache: "no-store" }, token),
        ]);

        if (profileRes.ok && alive) {
          setProfile((await profileRes.json()) as Profile);
        }

        if (cfgRes.ok && alive) {
          const cfg = (await cfgRes.json()) as QuoteConfigDTO | null;
          setRequiredFields(normalizeQuoteRequiredFields(cfg?.required_fields));
          setHiddenFields(normalizeQuoteHiddenFields(cfg?.hidden_fields));
          setCustomFields(normalizeQuoteCustomFields(cfg?.custom_fields));
        }
      } catch {
        if (alive) toast.error("No se pudo cargar la configuración.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token]);

  const toggleRequired = (key: string) => {
    setRequiredFields((prev) => {
      const next = prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key];
      return Array.from(new Set(next));
    });

    setHiddenFields((prev) => prev.filter((item) => item !== key));
  };

  const toggleHidden = (key: string) => {
    setHiddenFields((prev) => {
      const next = prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key];
      return Array.from(new Set(next));
    });

    setRequiredFields((prev) => prev.filter((item) => item !== key));
  };

  const addCustomField = () => {
    const label = newField.label.trim();
    if (!label) {
      toast.error("Definí al menos el nombre del campo.");
      return;
    }
    if (newField.type === "select" && newField.options.length === 0) {
      toast.error("Agregá al menos una opción para este campo de lista.");
      return;
    }
    const key = buildUniqueKey(label, customFields.map((field) => field.key));

    const field: QuoteCustomField = {
      key,
      label,
      type: newField.type,
      required: newField.required,
      placeholder: newField.placeholder.trim() || undefined,
      help: newField.help.trim() || undefined,
      options: newField.type === "select" ? newField.options : undefined,
    };

    setCustomFields((prev) => [...prev, field]);
    setNewField(defaultNewField());
  };

  const addNewFieldOption = () => {
    const value = newField.optionDraft.trim();
    if (!value) return;
    const alreadyExists = newField.options.some(
      (option) => option.toLowerCase() === value.toLowerCase(),
    );
    if (alreadyExists) {
      toast.info("Esa opción ya está cargada.");
      return;
    }
    setNewField((prev) => ({
      ...prev,
      options: [...prev.options, value],
      optionDraft: "",
    }));
  };

  const removeNewFieldOption = (option: string) => {
    setNewField((prev) => ({
      ...prev,
      options: prev.options.filter((item) => item !== option),
    }));
  };

  const removeCustomField = (key: string) => {
    setCustomFields((prev) => prev.filter((f) => f.key !== key));
  };

  const saveConfig = async () => {
    if (!token || !canEdit) return;
    try {
      setSaving(true);
      const res = await authFetch(
        "/api/quotes/config",
        {
          method: "PUT",
          body: JSON.stringify({
            required_fields: requiredFields,
            hidden_fields: hiddenFields,
            custom_fields: customFields,
          }),
        },
        token,
      );
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "No se pudo guardar");
      toast.success("Configuración guardada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
      <section className="mx-auto max-w-6xl p-6 text-slate-950 dark:text-white">
        <ToastContainer position="top-right" autoClose={2200} />

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-sky-950 dark:text-sky-50">
              Configuración de Cotizaciones
            </h1>
            <p className="mt-1 text-sm text-sky-900/75 dark:text-sky-100/70">
              Organizá la configuración en pilas con estado para separar cada bloque de trabajo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!canEdit && (
              <span className="rounded-full border border-sky-300/35 bg-white/35 px-3 py-1 text-xs text-sky-900 dark:border-sky-200/20 dark:bg-sky-950/25 dark:text-sky-100">
                Solo lectura
              </span>
            )}
            <Link href="/quotes" className={BTN}>
              Volver a cotizaciones
            </Link>
            {canEdit && (
              <button type="button" className={BTN} onClick={saveConfig} disabled={saving}>
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            )}
          </div>
        </div>

        <div className={`${GLASS} mb-5 p-4`}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-sky-800/70 dark:text-sky-100/65">
            Pilas de configuración
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {STACK_OPTIONS.map((stack) => {
              const active = activeStack === stack.key;
              return (
                <button
                  key={stack.key}
                  type="button"
                  onClick={() => setActiveStack(stack.key)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "border-sky-500/60 bg-sky-500/20 text-sky-950 dark:text-sky-100"
                      : "border-sky-300/35 bg-white/30 text-sky-900 hover:bg-white/45 dark:border-sky-200/20 dark:bg-sky-950/20 dark:text-sky-100"
                  }`}
                >
                  <span>{stack.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      active
                        ? "bg-sky-500/25 text-sky-900 dark:text-sky-100"
                        : "bg-sky-500/15 text-sky-900/90 dark:text-sky-100/90"
                    }`}
                  >
                    {stackStatus[stack.key]}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-sky-900/70 dark:text-sky-100/70">
            {STACK_OPTIONS.find((stack) => stack.key === activeStack)?.desc}
          </p>
        </div>

        {!canEdit && (
          <div className={`${GLASS} mb-5 p-4 text-sm text-sky-900 dark:text-sky-100`}>
            Solo gerencia y administración pueden editar esta configuración.
          </div>
        )}

        {activeStack === "diseno_pdf" && (
          <div className={`${GLASS} p-4`}>
            <p className="text-[11px] uppercase tracking-[0.18em] text-sky-800/70 dark:text-sky-100/65">
              Diseño de documento
            </p>
            <p className="mt-1 text-base font-semibold text-sky-950 dark:text-sky-50">
              Atajos al diseño de documentos
            </p>
            <p className="mt-1 text-sm text-sky-900/75 dark:text-sky-100/70">
              Entrá directo al diseño que quieras ajustar, sin salir de esta pantalla.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                {
                  href: "/template-config/quote_budget",
                  title: "Presupuesto de cotización",
                  desc: "Modelo principal del documento para enviar al cliente.",
                },
                {
                  href: "/template-config/quote",
                  title: "Propuesta comercial",
                  desc: "Modelo alternativo para distintas presentaciones.",
                },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="hover:bg-white/62 group rounded-2xl border border-sky-300/35 bg-white/50 p-3 shadow-sm shadow-sky-950/10 transition hover:-translate-y-0.5 dark:border-sky-200/20 dark:bg-sky-950/20 dark:hover:bg-sky-950/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-sky-950 dark:text-sky-50">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs text-sky-900/75 dark:text-sky-100/70">
                        {item.desc}
                      </p>
                    </div>
                    <span className="inline-flex size-8 items-center justify-center rounded-xl border border-sky-300/45 bg-sky-500/10 text-sky-900 transition group-hover:scale-[0.98] dark:border-sky-200/25 dark:text-sky-100">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 4.5H19.5V10.5M10.5 19.5H4.5V13.5M19.5 4.5L12 12M12 12L4.5 19.5"
                        />
                      </svg>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {activeStack === "obligatorios" && (
          <div className={`${GLASS} p-4`}>
            <h2 className="mb-1 text-lg font-semibold text-sky-950 dark:text-sky-50">
              Campos obligatorios
            </h2>
            <p className="mb-3 text-sm text-sky-900/75 dark:text-sky-100/70">
              Activá los datos que querés pedir siempre en cada cotización.
            </p>

            <div className="grid gap-2">
              {QUOTE_REQUIRED_FIELD_OPTIONS.map((opt) => {
                const active = requiredFields.includes(opt.key);
                return (
                  <div key={`req-${opt.key}`} className={`${SOFT_ROW} flex items-center justify-between gap-3`}>
                    <div>
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="text-xs opacity-70">
                        {active ? "Se pide siempre." : "Se puede dejar opcional."}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={active}
                      onChange={() => toggleRequired(opt.key)}
                      disabled={!canEdit}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeStack === "ocultos" && (
          <div className={`${GLASS} p-4`}>
            <h2 className="mb-1 text-lg font-semibold text-sky-950 dark:text-sky-50">
              Campos ocultos
            </h2>
            <p className="mb-3 text-sm text-sky-900/75 dark:text-sky-100/70">
              Marcá los datos base que no querés mostrar en el formulario.
            </p>

            <div className="grid gap-2">
              {QUOTE_HIDDEN_FIELD_OPTIONS.map((opt) => {
                const active = hiddenFields.includes(opt.key);
                return (
                  <div key={`hid-${opt.key}`} className={`${SOFT_ROW} flex items-center justify-between gap-3`}>
                    <div>
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="text-xs opacity-70">
                        {active ? "No se muestra en pantalla." : "Se muestra normalmente."}
                      </p>
                    </div>
                    <ToggleSwitch
                      checked={active}
                      onChange={() => toggleHidden(opt.key)}
                      disabled={!canEdit}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeStack === "personalizados" && (
          <div className={`${GLASS} p-4`}>
            <h2 className="mb-1 text-lg font-semibold text-sky-950 dark:text-sky-50">
              Campos personalizados
            </h2>
            <p className="mb-3 text-sm text-sky-900/75 dark:text-sky-100/70">
              Creá campos a medida y administralos desde un solo bloque.
            </p>

            <div className="mb-4 grid gap-2 md:grid-cols-3">
              <input
                className={INPUT}
                placeholder="Nombre del campo"
                value={newField.label}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, label: e.target.value }))
                }
                disabled={!canEdit}
              />
              <select
                className={SELECT}
                value={newField.type}
                onChange={(e) =>
                  setNewField((prev) => ({
                    ...prev,
                    type: e.target.value as QuoteCustomFieldType,
                    options:
                      e.target.value === "select" ? prev.options : [],
                    optionDraft: "",
                  }))
                }
                disabled={!canEdit}
              >
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="date">Fecha</option>
                <option value="select">Lista desplegable</option>
                <option value="boolean">Sí / No</option>
                <option value="textarea">Texto largo</option>
              </select>
              <input
                className={INPUT}
                placeholder="Texto de ejemplo (opcional)"
                value={newField.placeholder}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, placeholder: e.target.value }))
                }
                disabled={!canEdit}
              />
              <input
                className={INPUT}
                placeholder="Mensaje de ayuda (opcional)"
                value={newField.help}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, help: e.target.value }))
                }
                disabled={!canEdit}
              />
              {newField.type === "select" && (
                <div className="space-y-2 md:col-span-3">
                  <div className="flex gap-2">
                    <input
                      className={INPUT}
                      placeholder="Agregar opción de la lista"
                      value={newField.optionDraft}
                      onChange={(e) =>
                        setNewField((prev) => ({ ...prev, optionDraft: e.target.value }))
                      }
                      disabled={!canEdit}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        addNewFieldOption();
                      }}
                    />
                    <button
                      type="button"
                      className={SUBTLE_BTN}
                      onClick={addNewFieldOption}
                      disabled={!canEdit}
                    >
                      Agregar opción
                    </button>
                  </div>
                  {newField.options.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {newField.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={CHIP}
                          onClick={() => removeNewFieldOption(option)}
                          disabled={!canEdit}
                          title="Quitar opción"
                        >
                          {option} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className={`${SOFT_ROW} flex items-center justify-between gap-3 md:col-span-2`}>
                <div>
                  <p className="text-sm font-medium">Obligatorio</p>
                  <p className="text-xs opacity-70">
                    Activalo si querés que este dato se pida siempre.
                  </p>
                </div>
                <ToggleSwitch
                  checked={newField.required}
                  onChange={() =>
                    setNewField((prev) => ({ ...prev, required: !prev.required }))
                  }
                  disabled={!canEdit}
                />
              </div>
              <div className="md:col-span-3">
                <button
                  type="button"
                  className={BTN}
                  onClick={addCustomField}
                  disabled={!canEdit}
                >
                  Agregar campo
                </button>
              </div>
            </div>

            <div className="mb-3">
              <input
                className={INPUT}
                placeholder="Buscar campo personalizado por nombre"
                value={customSearch}
                onChange={(e) => setCustomSearch(e.target.value)}
              />
            </div>

            {filteredCustomFields.length === 0 ? (
              <p className="text-sm opacity-70">No hay campos personalizados.</p>
            ) : (
              <div className="space-y-2">
                {filteredCustomFields.map((field) => (
                  <div
                    key={field.key}
                    className={`${SOFT_ROW} flex flex-wrap items-center justify-between gap-2`}
                  >
                    <div>
                      <p className="font-medium">{field.label}</p>
                      <p className="text-xs opacity-70">
                        {FIELD_TYPE_LABELS[field.type]}
                        {field.required ? " · obligatorio" : ""}
                        {field.options?.length ? ` · ${field.options.join(", ")}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={DANGER_BTN}
                      onClick={() => removeCustomField(field.key)}
                      disabled={!canEdit}
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeStack === "permisos" && (
          <div className={`${GLASS} p-4 text-sm text-sky-900 dark:text-sky-100`}>
            <p className="font-medium">Permisos de cotizaciones</p>
            <p className="mt-1 opacity-80">
              Se aplican los mismos criterios de alcance que en reservas: vendedor
              (propias), líder (equipo) y gerencia o administración (agencia).
            </p>
          </div>
        )}
      </section>
    </ProtectedRoute>
  );
}
