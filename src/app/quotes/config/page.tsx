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
  key: string;
  label: string;
  type: QuoteCustomFieldType;
  required: boolean;
  options: string;
  placeholder: string;
  help: string;
};

const GLASS =
  "rounded-3xl border border-sky-300/35 bg-gradient-to-br from-white/70 via-sky-100/55 to-sky-100/45 shadow-lg shadow-sky-950/10 backdrop-blur-xl dark:border-sky-200/20 dark:from-sky-950/40 dark:via-sky-900/35 dark:to-sky-900/25";
const BTN =
  "rounded-full border border-sky-500/45 bg-sky-400/20 px-4 py-2 text-sm font-medium text-sky-950 shadow-sm shadow-sky-950/20 transition duration-200 hover:-translate-y-0.5 hover:bg-sky-400/30 active:translate-y-0 disabled:opacity-50 dark:border-sky-300/45 dark:bg-sky-400/20 dark:text-sky-100";
const DANGER_BTN =
  "rounded-full border border-rose-500/55 bg-rose-200/20 px-4 py-2 text-sm font-medium text-rose-700 shadow-sm shadow-rose-950/20 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-200/30 active:translate-y-0 disabled:opacity-50 dark:border-rose-300/55 dark:bg-rose-300/20 dark:text-rose-200";
const INPUT =
  "w-full rounded-2xl border border-sky-300/45 bg-white/75 px-3 py-2 text-sm text-slate-900 outline-none shadow-sm shadow-sky-950/10 backdrop-blur placeholder:text-slate-500/80 focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 dark:border-sky-200/35 dark:bg-sky-950/25 dark:text-sky-50 dark:placeholder:text-sky-100/60";
const SELECT =
  "w-full appearance-none rounded-2xl border border-sky-300/45 bg-white/75 px-3 py-2 text-sm text-slate-900 outline-none shadow-sm shadow-sky-950/10 backdrop-blur focus:border-sky-500/65 focus:ring-2 focus:ring-sky-400/35 dark:border-sky-200/35 dark:bg-sky-950/25 dark:text-sky-50";

function normalizeRole(role?: string | null): string {
  return String(role || "").trim().toLowerCase();
}

function canEditByRole(role?: string | null): boolean {
  return ["gerente", "administrativo", "desarrollador"].includes(
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

const defaultNewField = (): NewFieldState => ({
  key: "",
  label: "",
  type: "text",
  required: false,
  options: "",
  placeholder: "",
  help: "",
});

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

  const canEdit = useMemo(() => canEditByRole(profile?.role), [profile]);
  const filteredCustomFields = useMemo(() => {
    const query = customSearch.trim().toLowerCase();
    if (!query) return customFields;
    return customFields.filter((field) =>
      `${field.label} ${field.key}`.toLowerCase().includes(query),
    );
  }, [customFields, customSearch]);

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
    const key = (newField.key.trim() || slugifyKey(label)).slice(0, 40);
    if (!label || !key) {
      toast.error("Definí al menos etiqueta y key para el campo.");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(key)) {
      toast.error("La key solo puede tener minúsculas, números y guiones bajos.");
      return;
    }
    if (customFields.some((f) => f.key === key)) {
      toast.error("Ya existe un campo con esa key.");
      return;
    }

    const field: QuoteCustomField = {
      key,
      label,
      type: newField.type,
      required: newField.required,
      placeholder: newField.placeholder.trim() || undefined,
      help: newField.help.trim() || undefined,
      options:
        newField.type === "select"
          ? newField.options
              .split(",")
              .map((opt) => opt.trim())
              .filter(Boolean)
          : undefined,
    };

    setCustomFields((prev) => [...prev, field]);
    setNewField(defaultNewField());
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
      toast.success("Configuración guardada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error guardando");
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
              Definí campos visibles, obligatorios y personalizados para el formulario de cotizaciones.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/quotes" className={BTN}>
              Volver a cotizaciones
            </Link>
            {canEdit && (
              <button type="button" className={BTN} onClick={saveConfig} disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
            )}
          </div>
        </div>

        <div className={`${GLASS} mb-5 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-sky-800/70 dark:text-sky-100/65">
                PDF de cotización
              </p>
              <p className="mt-1 text-base font-semibold text-sky-950 dark:text-sky-50">
                Editor de presupuesto PDF
              </p>
              <p className="mt-1 text-sm text-sky-900/75 dark:text-sky-100/70">
                Configurá estilos, portada, bloques y opciones para
                <code className="ml-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-xs">
                  quote_budget
                </code>
                .
              </p>
            </div>
            <Link href="/template-config/quote_budget" className={BTN}>
              Editar PDF
            </Link>
          </div>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className={`${GLASS} p-3`}>
            <p className="text-[11px] uppercase tracking-[0.18em] text-sky-800/70 dark:text-sky-100/65">
              Obligatorios
            </p>
            <p className="mt-1 text-xl font-semibold text-sky-950 dark:text-sky-50">
              {requiredFields.length}
            </p>
          </div>
          <div className={`${GLASS} p-3`}>
            <p className="text-[11px] uppercase tracking-[0.18em] text-sky-800/70 dark:text-sky-100/65">
              Ocultos
            </p>
            <p className="mt-1 text-xl font-semibold text-sky-950 dark:text-sky-50">
              {hiddenFields.length}
            </p>
          </div>
          <div className={`${GLASS} p-3`}>
            <p className="text-[11px] uppercase tracking-[0.18em] text-sky-800/70 dark:text-sky-100/65">
              Personalizados
            </p>
            <p className="mt-1 text-xl font-semibold text-sky-950 dark:text-sky-50">
              {customFields.length}
            </p>
          </div>
        </div>

        {!canEdit && (
          <div className={`${GLASS} mb-4 p-4 text-sm text-sky-900 dark:text-sky-100`}>
            Solo gerencia/administración puede editar esta configuración.
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <div className={`${GLASS} p-4`}>
            <h2 className="mb-3 text-sm font-semibold">Campos base obligatorios</h2>
            <div className="grid gap-2">
              {QUOTE_REQUIRED_FIELD_OPTIONS.map((opt) => (
                <label
                  key={`req-${opt.key}`}
                  className="flex items-center gap-2 rounded-2xl border border-sky-300/35 bg-white/45 px-3 py-2 text-sm text-sky-950 shadow-sm shadow-sky-950/10 dark:border-sky-200/20 dark:bg-sky-950/25 dark:text-sky-50"
                >
                  <input
                    type="checkbox"
                    checked={requiredFields.includes(opt.key)}
                    onChange={() => toggleRequired(opt.key)}
                    disabled={!canEdit}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={`${GLASS} p-4`}>
            <h2 className="mb-3 text-sm font-semibold">Campos base ocultos</h2>
            <div className="grid gap-2">
              {QUOTE_HIDDEN_FIELD_OPTIONS.map((opt) => (
                <label
                  key={`hid-${opt.key}`}
                  className="flex items-center gap-2 rounded-2xl border border-sky-300/35 bg-white/45 px-3 py-2 text-sm text-sky-950 shadow-sm shadow-sky-950/10 dark:border-sky-200/20 dark:bg-sky-950/25 dark:text-sky-50"
                >
                  <input
                    type="checkbox"
                    checked={hiddenFields.includes(opt.key)}
                    onChange={() => toggleHidden(opt.key)}
                    disabled={!canEdit}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={`${GLASS} p-4 lg:col-span-2`}>
            <h2 className="mb-3 text-sm font-semibold">Campos personalizados</h2>

            <div className="mb-4 grid gap-2 md:grid-cols-3">
              <input
                className={INPUT}
                placeholder="Etiqueta"
                value={newField.label}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, label: e.target.value }))
                }
                disabled={!canEdit}
              />
              <input
                className={INPUT}
                placeholder="Key (ej: forma_pago)"
                value={newField.key}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, key: e.target.value }))
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
                  }))
                }
                disabled={!canEdit}
              >
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="date">Fecha</option>
                <option value="select">Select</option>
                <option value="boolean">Boolean</option>
                <option value="textarea">Textarea</option>
              </select>
              <input
                className={INPUT}
                placeholder="Placeholder (opcional)"
                value={newField.placeholder}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, placeholder: e.target.value }))
                }
                disabled={!canEdit}
              />
              <input
                className={INPUT}
                placeholder="Help text (opcional)"
                value={newField.help}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, help: e.target.value }))
                }
                disabled={!canEdit}
              />
              <input
                className={INPUT}
                placeholder="Opciones select separadas por coma"
                value={newField.options}
                onChange={(e) =>
                  setNewField((prev) => ({ ...prev, options: e.target.value }))
                }
                disabled={!canEdit || newField.type !== "select"}
              />
              <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
                <input
                  type="checkbox"
                  checked={newField.required}
                  onChange={(e) =>
                    setNewField((prev) => ({ ...prev, required: e.target.checked }))
                  }
                  disabled={!canEdit}
                />
                Obligatorio
              </label>
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
                placeholder="Buscar campo personalizado por nombre o key"
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
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-300/35 bg-white/45 px-3 py-2 text-sm text-sky-950 shadow-sm shadow-sky-950/10 dark:border-sky-200/20 dark:bg-sky-950/25 dark:text-sky-50"
                  >
                    <div>
                      <p className="font-medium">
                        {field.label} <span className="opacity-70">({field.key})</span>
                      </p>
                      <p className="text-xs opacity-70">
                        {field.type}
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
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={`${GLASS} mt-5 p-4 text-sm text-sky-900 dark:text-sky-100`}>
          <p className="font-medium">Permisos de cotizaciones</p>
          <p className="mt-1 opacity-80">
            Se aplican los mismos criterios de alcance que reservas: vendedor (propias), líder (equipo), gerencia/admin/dev (agencia).
          </p>
        </div>
      </section>
    </ProtectedRoute>
  );
}
