// src/app/templates/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import TemplateConfigForm from "@/components/templates/TemplateConfigForm";
import TemplateEditor from "@/components/templates/TemplateEditor";
import type {
  DocType,
  TemplateConfig,
  TemplateFormValues,
} from "@/types/templates";
import { buildInitialOrderedBlocks } from "@/lib/templateConfig";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ApiGetResponse = {
  exists: boolean;
  id_template: number | null;
  id_agency: number;
  doc_type: DocType;
  config: TemplateConfig;
  created_at: string | null;
  updated_at: string | null;
};

const EMPTY_CFG: TemplateConfig = {};
const EMPTY_VALUE: TemplateFormValues = { blocks: [] };
const CONTACT_STORAGE_KEY = "mupu:templates:contact";
const QUOTE_DRAFT_STORAGE_VERSION = 1;
const PANEL_CLASS =
  "rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur";
const HEADER_BTN_CLASS =
  "inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-950 shadow-sm shadow-sky-900/5 transition hover:scale-[0.98] dark:bg-sky-500/20 dark:text-sky-100";
const INPUT_CLASS =
  "w-full rounded-2xl border border-white/15 bg-white/15 px-3 py-2 text-sm outline-none transition placeholder:text-slate-500 focus:border-sky-400/60 dark:placeholder:text-slate-400";

type QuoteCreateResponse = {
  id_quote?: number;
  agency_quote_id?: number | null;
  error?: string;
};

function cleanInput(value: string): string | undefined {
  const next = value.trim();
  return next.length > 0 ? next : undefined;
}

function writeQuoteDraftToStorage(quoteId: number, value: TemplateFormValues): void {
  if (!Number.isFinite(quoteId) || quoteId <= 0) return;
  if (typeof window === "undefined") return;
  try {
    const storageKey = `ofistur:quotes:pdf-draft:${quoteId}`;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: QUOTE_DRAFT_STORAGE_VERSION,
        saved_at: new Date().toISOString(),
        value,
      }),
    );
  } catch {}
}

export default function TemplatesPage() {
  const router = useRouter();
  const { token } = useAuth();

  const [docType, setDocType] = useState<DocType>("quote");
  const [cfg, setCfg] = useState<TemplateConfig>(EMPTY_CFG);
  const [formValue, setFormValue] = useState<TemplateFormValues>(EMPTY_VALUE);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [quoteCreateError, setQuoteCreateError] = useState<string | null>(null);
  const [quickLeadName, setQuickLeadName] = useState("");
  const [quickLeadPhone, setQuickLeadPhone] = useState("");
  const [quickLeadEmail, setQuickLeadEmail] = useState("");
  const allowContactPersistRef = useRef(false);

  const docTypeOptions = useMemo(
    () => [
      {
        id: "quote" as DocType,
        label: "Cotizacion",
        description: "Propuesta y detalles iniciales",
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 4.5h9.75a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5v-12A1.5 1.5 0 016 4.5Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 8.25h6M8.25 12h6M8.25 15.75h4.5"
            />
          </svg>
        ),
      },
      {
        id: "confirmation" as DocType,
        label: "Confirmacion manual",
        description: "Cierre y datos finales (manual)",
        icon: (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.125 2.25h3.75L14.7 4.5h2.425a2.625 2.625 0 012.625 2.625v10.5a2.625 2.625 0 01-2.625 2.625H6.875A2.625 2.625 0 014.25 17.625v-10.5A2.625 2.625 0 016.875 4.5H9.3l.825-2.25Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75l2.25 2.25L15 11.25"
            />
          </svg>
        ),
      },
    ],
    [],
  );

  // Perfil (role)
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await authFetch(
          "/api/user/profile",
          { signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("Error al obtener perfil");
        const data = await res.json();
        setRole(data.role);
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error("❌ Error fetching profile:", err);
        }
      }
    })();
    return () => controller.abort();
  }, [token]);

  // Cargar config del docType (resuelta)
  const load = useCallback(async () => {
    if (!token || !docType) return { ok: false as const };
    setLoading(true);
    allowContactPersistRef.current = false;
    try {
      const res = await authFetch(
        `/api/template-config/${encodeURIComponent(docType)}?resolved=1`,
        { cache: "no-store" },
        token,
      );
      const data = (await res.json()) as ApiGetResponse;
      if (!res.ok) {
        const errMsg = (data as { error?: string })?.error;
        throw new Error(errMsg || "No se pudo cargar el template");
      }
      setCfg(data.config || EMPTY_CFG);

      // Inicializar blocks si existen en la config
      const hasBlocks = Array.isArray(data.config?.content?.blocks);
      const initialBlocks = hasBlocks
        ? buildInitialOrderedBlocks(data.config)
        : [];

      const storedContact =
        typeof window !== "undefined"
          ? (() => {
              try {
                const raw = window.localStorage.getItem(
                  `${CONTACT_STORAGE_KEY}:${docType}`,
                );
                return raw ? (JSON.parse(raw) as TemplateFormValues["contact"]) : null;
              } catch {
                return null;
              }
            })()
          : null;

      setFormValue({
        blocks: initialBlocks,
        contact: storedContact ?? undefined,
      });
      allowContactPersistRef.current = true;

      return { ok: true as const };
    } catch (e) {
      console.error("[templates/page] load error:", e);
      setCfg(EMPTY_CFG);
      setFormValue(EMPTY_VALUE);
      allowContactPersistRef.current = false;
      return { ok: false as const };
    } finally {
      setLoading(false);
    }
  }, [token, docType]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    allowContactPersistRef.current = false;
  }, [docType]);

  useEffect(() => {
    if (!docType || typeof window === "undefined") return;
    if (!allowContactPersistRef.current) return;
    try {
      if (!formValue.contact) {
        window.localStorage.removeItem(`${CONTACT_STORAGE_KEY}:${docType}`);
        return;
      }
      window.localStorage.setItem(
        `${CONTACT_STORAGE_KEY}:${docType}`,
        JSON.stringify(formValue.contact),
      );
    } catch {}
  }, [docType, formValue.contact]);

  const createQuoteFromTemplate = useCallback(async () => {
    if (!token || creatingQuote || docType !== "quote") return;
    try {
      setCreatingQuote(true);
      setQuoteCreateError(null);

      const payload = {
        lead_name: cleanInput(quickLeadName),
        lead_phone: cleanInput(quickLeadPhone),
        lead_email: cleanInput(quickLeadEmail),
        note: "Creada desde PDF libre (Templates).",
      };

      const res = await authFetch(
        "/api/quotes",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      );
      const data = (await res.json().catch(() => ({}))) as QuoteCreateResponse;
      if (!res.ok) {
        throw new Error(data.error || "No se pudo guardar como cotización.");
      }

      const quoteId = Number(data.id_quote);
      if (!Number.isFinite(quoteId) || quoteId <= 0) {
        throw new Error("No se obtuvo el identificador de la cotización creada.");
      }

      writeQuoteDraftToStorage(quoteId, formValue);
      router.push(`/quotes/${quoteId}/template`);
    } catch (err) {
      setQuoteCreateError(
        err instanceof Error ? err.message : "No se pudo guardar como cotización.",
      );
    } finally {
      setCreatingQuote(false);
    }
  }, [
    token,
    creatingQuote,
    docType,
    quickLeadName,
    quickLeadPhone,
    quickLeadEmail,
    formValue,
    router,
  ]);

  return (
    <ProtectedRoute>
      <section className="mx-auto p-6 text-slate-950 dark:text-white">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Templates</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
              Personaliza el documento, edita bloques y exporta el PDF final.
            </p>
          </div>
          {(role == "gerente" || role == "desarrollador") && (
            <Link
              className={HEADER_BTN_CLASS}
              href={`/template-config/${docType}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0Z"
                />
              </svg>
              Configurar template
            </Link>
          )}
        </div>

        {/* Selector DocType */}
        <div className={PANEL_CLASS}>
          <div className="mb-4">
            <h2 className="text-base font-semibold">Tipo de documento</h2>
            <p className="text-sm text-slate-500 dark:text-slate-300">
              Seleccioná el tipo de PDF y trabajá su versión editable.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {docTypeOptions.map((opt) => {
              const active = docType === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDocType(opt.id)}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-sky-400/60 bg-sky-500/10 text-sky-950 shadow-sm shadow-sky-950/10"
                      : "border-white/10 bg-white/10 text-slate-700 hover:border-sky-300/60 dark:text-slate-200"
                  }`}
                  aria-pressed={active}
                >
                  <span
                    className={`mt-0.5 inline-flex size-8 items-center justify-center rounded-2xl border ${
                      active
                        ? "border-sky-400/40 bg-sky-500/15 text-sky-800"
                        : "border-white/10 bg-white/10 text-slate-500"
                    }`}
                  >
                    {opt.icon}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-xs opacity-70">
                      {opt.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {docType === "quote" && (
          <div className={`${PANEL_CLASS} mt-6`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Guardar como cotización</h2>
                <p className="text-sm text-slate-500 dark:text-slate-300">
                  Convertí este PDF libre en cotización y seguí el flujo a reserva.
                </p>
              </div>
              <button
                type="button"
                onClick={createQuoteFromTemplate}
                disabled={creatingQuote || loading}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/90 px-5 py-2 text-sm font-medium text-emerald-900 shadow-sm shadow-emerald-900/10 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-100/70 dark:bg-emerald-500/20 dark:text-emerald-100"
              >
                {creatingQuote ? "Guardando..." : "Guardar y abrir cotización"}
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <input
                type="text"
                value={quickLeadName}
                onChange={(e) => setQuickLeadName(e.target.value)}
                placeholder="Cliente (opcional)"
                className={INPUT_CLASS}
              />
              <input
                type="text"
                value={quickLeadPhone}
                onChange={(e) => setQuickLeadPhone(e.target.value)}
                placeholder="Teléfono (opcional)"
                className={INPUT_CLASS}
              />
              <input
                type="email"
                value={quickLeadEmail}
                onChange={(e) => setQuickLeadEmail(e.target.value)}
                placeholder="Email (opcional)"
                className={INPUT_CLASS}
              />
            </div>

            <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
              Tip: podés guardar sin completar datos y terminarlos después en Cotizaciones.
            </p>
            {quoteCreateError && (
              <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">
                {quoteCreateError}
              </p>
            )}
          </div>
        )}

        {/* Layout principal */}
        {loading ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <div className="mb-4 px-1">
                <h2 className="text-base font-semibold">Personalización</h2>
                <p className="text-sm text-slate-500 dark:text-slate-300">
                  Elegí portada, contacto y forma de pago para el documento.
                </p>
              </div>
              <TemplateConfigForm
                cfg={cfg}
                value={formValue}
                onChange={setFormValue}
              />
            </div>

            <div>
              <div className="mb-4 px-1">
                <h2 className="text-base font-semibold">Vista previa editable</h2>
                <p className="text-sm text-slate-500 dark:text-slate-300">
                  Editá bloques y ajustá el contenido final antes de descargar
                  el PDF.
                </p>
              </div>
              <TemplateEditor
                cfg={cfg}
                value={formValue}
                onChange={setFormValue}
                docType={docType}
              />
            </div>
          </div>
        )}
      </section>
    </ProtectedRoute>
  );
}
