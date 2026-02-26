"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import TemplateConfigForm from "@/components/templates/TemplateConfigForm";
import TemplateEditor from "@/components/templates/TemplateEditor";
import TextPresetPicker from "@/components/templates/TextPresetPicker";
import StudioShell, { type StudioTab } from "@/components/studio/StudioShell";
import StudioSystemNavigation from "@/components/studio/StudioSystemNavigation";
import type {
  DocType,
  TemplateConfig,
  TemplateFormValues,
  OrderedBlock,
  BlockType,
  BlockFormValue,
} from "@/types/templates";
import { buildInitialOrderedBlocks } from "@/lib/templateConfig";
import { nanoid } from "nanoid/non-secure";

type ApiGetResponse = {
  exists: boolean;
  id_template: number | null;
  id_agency: number;
  doc_type: DocType;
  config: TemplateConfig;
  created_at: string | null;
  updated_at: string | null;
};

type QuoteCreateResponse = {
  id_quote?: number;
  agency_quote_id?: number | null;
  error?: string;
};

type StudioPanel = "system" | "design" | "manage";
type DesignMenuSection = "look" | "cover" | "contact" | "payment";
type StyleOverrides = NonNullable<TemplateFormValues["styles"]>;
type StyleOverrideColors = NonNullable<StyleOverrides["colors"]>;
type StyleOverrideUi = NonNullable<StyleOverrides["ui"]>;

const EMPTY_CFG: TemplateConfig = {};
const EMPTY_VALUE: TemplateFormValues = { blocks: [] };
const CONTACT_STORAGE_KEY = "mupu:templates:contact";
const QUOTE_DRAFT_STORAGE_VERSION = 1;
const PANEL_CLASS =
  "rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur";
const STUDIO_ICON_TAB =
  "inline-flex items-center justify-center rounded-xl border border-slate-300/55 bg-white/85 p-2 text-slate-700 shadow-sm transition hover:scale-[0.98] dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100";
const STUDIO_ICON_TAB_ACTIVE =
  "border-sky-500/55 bg-sky-500/15 text-sky-900 dark:border-sky-300/50 dark:bg-sky-500/30 dark:text-sky-50";
const INPUT_CLASS =
  "w-full rounded-2xl border border-white/15 bg-white/15 px-3 py-2 text-sm outline-none transition placeholder:text-slate-500 focus:border-sky-400/60 dark:placeholder:text-slate-400";

const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

function canManageTemplateConfig(role: string | null | undefined): boolean {
  const normalized = String(role || "").trim().toLowerCase();
  return [
    "gerente",
    "administrativo",
    "admin",
    "administrador",
    "desarrollador",
    "dev",
    "developer",
  ].includes(normalized);
}

function cleanInput(value: string): string | undefined {
  const next = value.trim();
  return next.length > 0 ? next : undefined;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidBlockType(type: string): type is BlockType {
  return (
    type === "heading" ||
    type === "subtitle" ||
    type === "paragraph" ||
    type === "list" ||
    type === "keyValue" ||
    type === "twoColumns" ||
    type === "threeColumns"
  );
}

function presetValueFor(
  type: BlockType,
  raw: Record<string, unknown>,
): BlockFormValue {
  const value = isObj(raw.value) ? (raw.value as Record<string, unknown>) : {};
  switch (type) {
    case "heading":
      return {
        type: "heading",
        text: String(value.text ?? raw.text ?? raw.label ?? ""),
        level: (value.level as 1 | 2 | 3) ?? 1,
      };
    case "subtitle":
      return {
        type: "subtitle",
        text: String(value.text ?? raw.text ?? raw.label ?? ""),
      };
    case "paragraph":
      return {
        type: "paragraph",
        text: String(value.text ?? raw.text ?? ""),
      };
    case "list":
      return {
        type: "list",
        items: Array.isArray(value.items)
          ? value.items.map((x) => String(x ?? ""))
          : Array.isArray(raw.items)
            ? raw.items.map((x) => String(x ?? ""))
            : [],
      };
    case "keyValue":
      return {
        type: "keyValue",
        pairs: Array.isArray(value.pairs)
          ? value.pairs.map((pair) => ({
              key: String((pair as { key?: unknown }).key ?? ""),
              value: String((pair as { value?: unknown }).value ?? ""),
            }))
          : Array.isArray(raw.pairs)
            ? raw.pairs.map((pair) => ({
                key: String((pair as { key?: unknown }).key ?? ""),
                value: String((pair as { value?: unknown }).value ?? ""),
              }))
            : [],
      };
    case "twoColumns":
      return {
        type: "twoColumns",
        left: String(value.left ?? raw.left ?? ""),
        right: String(value.right ?? raw.right ?? ""),
      };
    case "threeColumns":
      return {
        type: "threeColumns",
        left: String(value.left ?? raw.left ?? ""),
        center: String(value.center ?? raw.center ?? ""),
        right: String(value.right ?? raw.right ?? ""),
      };
  }
}

function presetBlocksToOrdered(input: unknown): OrderedBlock[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      if (!isObj(raw)) return null;
      const type = String(raw.type || "");
      if (!isValidBlockType(type)) return null;
      const origin =
        raw.origin === "fixed" || raw.origin === "form" ? raw.origin : "extra";
      return {
        id: nanoid(),
        origin,
        type,
        value: presetValueFor(type, raw),
      } satisfies OrderedBlock;
    })
    .filter(Boolean) as OrderedBlock[];
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

  const [docType, setDocType] = useState<DocType>("quote_budget");
  const [cfg, setCfg] = useState<TemplateConfig>(EMPTY_CFG);
  const [formValue, setFormValue] = useState<TemplateFormValues>(EMPTY_VALUE);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [quoteCreateError, setQuoteCreateError] = useState<string | null>(null);
  const [quickLeadName, setQuickLeadName] = useState("");
  const [quickLeadPhone, setQuickLeadPhone] = useState("");
  const [quickLeadEmail, setQuickLeadEmail] = useState("");
  const [studioPanel, setStudioPanel] = useState<StudioPanel>("design");
  const [designMenuSection, setDesignMenuSection] = useState<DesignMenuSection>("look");
  const [presetRefreshSignal, setPresetRefreshSignal] = useState(0);
  const allowContactPersistRef = useRef(false);

  const canConfigure = useMemo(() => {
    return canManageTemplateConfig(role);
  }, [role]);

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
          console.error("[templates] profile error", err);
        }
      }
    })();
    return () => controller.abort();
  }, [token]);

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

      const hasBlocks = Array.isArray(data.config?.content?.blocks);
      const initialBlocks = hasBlocks ? buildInitialOrderedBlocks(data.config) : [];

      const storedContact =
        typeof window !== "undefined"
          ? (() => {
              try {
                const raw = window.localStorage.getItem(`${CONTACT_STORAGE_KEY}:${docType}`);
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
      setQuoteCreateError(null);

      return { ok: true as const };
    } catch (e) {
      console.error("[templates/page] load error", e);
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
    if (!token || creatingQuote || docType !== "quote_budget") return;
    try {
      setCreatingQuote(true);
      setQuoteCreateError(null);

      const payload = {
        lead_name: cleanInput(quickLeadName),
        lead_phone: cleanInput(quickLeadPhone),
        lead_email: cleanInput(quickLeadEmail),
        note: "Creada desde Estudio PDF (Templates).",
        pdf_draft: formValue,
        pdf_draft_saved_at: new Date().toISOString(),
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

  const saveCurrentAsPreset = useCallback(async () => {
    try {
      if (!token) throw new Error("No hay token de autenticación.");
      const blocks = Array.isArray(formValue.blocks) ? formValue.blocks : [];
      if (blocks.length === 0) {
        window.alert("No hay bloques para guardar.");
        return;
      }
      const title = window.prompt("Nombre del preset de contenido:");
      if (!title || !title.trim()) return;

      const payload = {
        title: title.trim(),
        content: "",
        doc_type: docType,
        data: {
          version: 2,
          kind: "data" as const,
          data: { blocks },
        },
      };

      const res = await fetch("/api/text-preset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "No se pudo guardar el preset.");
      }

      setPresetRefreshSignal((prev) => prev + 1);
      window.alert("Preset guardado.");
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Error guardando el preset.",
      );
    }
  }, [docType, formValue.blocks, token]);

  const selectedBackgroundColor =
    formValue.styles?.colors?.background ?? cfg.styles?.colors?.background ?? "#ffffff";
  const selectedTextColor =
    formValue.styles?.colors?.text ?? cfg.styles?.colors?.text ?? "#111111";
  const selectedAccentColor =
    formValue.styles?.colors?.accent ?? cfg.styles?.colors?.accent ?? "#0ea5e9";
  const selectedDensity = formValue.styles?.ui?.density ?? cfg.styles?.ui?.density ?? "comfortable";
  const selectedContentWidth =
    formValue.styles?.ui?.contentWidth ?? cfg.styles?.ui?.contentWidth ?? "normal";
  const selectedRadius = formValue.styles?.ui?.radius ?? cfg.styles?.ui?.radius ?? "2xl";
  const selectedDividers = formValue.styles?.ui?.dividers ?? cfg.styles?.ui?.dividers ?? true;
  const selectedLayout = formValue.layout ?? cfg.layout ?? "layoutA";

  const patchStyleOverrides = useCallback(
    (patch: { colors?: Partial<StyleOverrideColors>; ui?: Partial<StyleOverrideUi> }) => {
      setFormValue((prev) => ({
        ...prev,
        styles: {
          ...(prev.styles ?? {}),
          colors: {
            ...(prev.styles?.colors ?? {}),
            ...(patch.colors ?? {}),
          },
          ui: {
            ...(prev.styles?.ui ?? {}),
            ...(patch.ui ?? {}),
          },
        },
      }));
    },
    [],
  );

  const resetStyleOverrides = useCallback(() => {
    setFormValue((prev) => {
      if (!prev.styles) return prev;
      const next = { ...prev };
      delete next.styles;
      return next;
    });
  }, []);

  const studioVisualToggleClass = (active: boolean) =>
    cx(
      "inline-flex h-12 w-full items-center justify-center rounded-xl border p-1.5 transition hover:scale-[0.98]",
      active
        ? "border-sky-500/60 bg-sky-500/15"
        : "border-slate-300/60 bg-white/85 dark:border-slate-200/20 dark:bg-slate-900/60",
    );

  const panelTitle =
    studioPanel === "system"
      ? "Menú"
      : studioPanel === "design"
      ? "Diseño"
      : "Cotización";

  const tabs: StudioTab[] = useMemo(
    () => [
      {
        key: "system",
        srLabel: "Menú",
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12H12m-8.25 5.25h16.5" />
          </svg>
        ),
      },
      {
        key: "design",
        srLabel: "Diseño",
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
          </svg>
        ),
      },
      {
        key: "manage",
        srLabel: "Cotización",
        label: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 21H4.5a1.5 1.5 0 0 1-1.5-1.5V5.56a1.5 1.5 0 0 1 .44-1.06l1.06-1.06A1.5 1.5 0 0 1 5.56 3h11.38a1.5 1.5 0 0 1 1.06.44l1.06 1.06a1.5 1.5 0 0 1 .44 1.06V19.5A1.5 1.5 0 0 1 19.5 21Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v5.25h7.5V3M8.25 21v-6h7.5v6" />
          </svg>
        ),
      },
    ],
    [],
  );

  const designMenuItems: Array<{
    key: DesignMenuSection;
    label: string;
    icon: JSX.Element;
  }> = [
    {
      key: "look",
      label: "Estilo",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75h15m-15 5.25h9m-9 5.25h15" />
          <circle cx="17.25" cy="6.75" r="1.5" />
          <circle cx="9.75" cy="12" r="1.5" />
          <circle cx="15.75" cy="17.25" r="1.5" />
        </svg>
      ),
    },
    {
      key: "cover",
      label: "Imágenes",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Z" />
        </svg>
      ),
    },
    {
      key: "contact",
      label: "Contacto",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102A1.125 1.125 0 0 0 5.872 2.25H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
        </svg>
      ),
    },
    {
      key: "payment",
      label: "Cobro",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
        </svg>
      ),
    },
  ];

  const panelBody = (() => {
    if (studioPanel === "system") {
      return (
        <StudioSystemNavigation
          backHref="/quotes"
          backLabel="Volver a cotizaciones"
          intro="Saltá entre áreas sin perder el contexto del estudio de PDF."
        />
      );
    }

    if (studioPanel === "design") {
      return (
        <div className="space-y-3">
          <div className={PANEL_CLASS}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Módulos de diseño</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Elegí un módulo y editá ese grupo de opciones.</p>
              </div>
              {canConfigure ? (
                <Link
                  href={`/template-config/${docType}`}
                  className="inline-flex size-9 items-center justify-center rounded-xl border border-sky-300/45 bg-sky-500/10 text-sky-900 shadow-sm transition hover:scale-[0.98] dark:border-sky-200/25 dark:text-sky-100"
                  title="Configuración base del PDF"
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
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                  <span className="sr-only">Config base</span>
                </Link>
              ) : null}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {designMenuItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setDesignMenuSection(item.key)}
                  className={cx(STUDIO_ICON_TAB, designMenuSection === item.key && STUDIO_ICON_TAB_ACTIVE)}
                  title={item.label}
                >
                  {item.icon}
                  <span className="sr-only">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[10px] font-medium text-slate-500 dark:text-slate-300">
              {designMenuItems.map((item) => (
                <span key={item.key}>{item.label}</span>
              ))}
            </div>
          </div>

          {designMenuSection === "look" ? (
            <div className={PANEL_CLASS}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Apariencia del PDF</h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Elegí un boceto visual y ajustá esta versión sin tocar la configuración global.</p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { key: "layoutA", label: "A" },
                  { key: "layoutB", label: "B" },
                  { key: "layoutC", label: "C" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      setFormValue((prev) => ({
                        ...prev,
                        layout: opt.key as TemplateFormValues["layout"],
                      }))
                    }
                    className={cx(
                      "rounded-xl border px-2 py-2 transition hover:scale-[0.98]",
                      selectedLayout === opt.key
                        ? "border-sky-500/60 bg-sky-500/15"
                        : "border-slate-300/60 bg-white/85 dark:border-slate-200/20 dark:bg-slate-900/60",
                    )}
                    title={`Boceto ${opt.label}`}
                  >
                    <div
                      className={cx(
                        "mx-auto mb-1.5 h-16 w-full max-w-[94px] rounded-lg border p-1.5",
                        selectedLayout === opt.key
                          ? "border-sky-400/50 bg-white/70 dark:bg-slate-950/50"
                          : "border-slate-300/60 bg-white/70 dark:border-slate-200/20 dark:bg-slate-950/35",
                      )}
                    >
                      {opt.key === "layoutA" ? (
                        <div className="grid h-full grid-rows-[6px_10px_1fr] gap-1">
                          <div className="rounded bg-slate-300/70 dark:bg-slate-400/40" />
                          <div className="rounded bg-slate-300/55 dark:bg-slate-400/30" />
                          <div className="space-y-1">
                            <div className="h-2 rounded bg-slate-300/60 dark:bg-slate-400/35" />
                            <div className="h-2 rounded bg-slate-300/45 dark:bg-slate-400/25" />
                            <div className="h-2 w-2/3 rounded bg-slate-300/45 dark:bg-slate-400/25" />
                          </div>
                        </div>
                      ) : null}
                      {opt.key === "layoutB" ? (
                        <div className="grid h-full grid-rows-[6px_20px_1fr] gap-1">
                          <div className="rounded bg-slate-300/70 dark:bg-slate-400/40" />
                          <div className="rounded bg-slate-300/55 dark:bg-slate-400/30" />
                          <div className="space-y-1">
                            <div className="h-2 rounded bg-slate-300/60 dark:bg-slate-400/35" />
                            <div className="h-2 rounded bg-slate-300/45 dark:bg-slate-400/25" />
                          </div>
                        </div>
                      ) : null}
                      {opt.key === "layoutC" ? (
                        <div className="grid h-full grid-cols-[24px_1fr] gap-1">
                          <div className="dark:bg-slate-400/28 space-y-1 rounded bg-slate-300/50 p-1">
                            <div className="h-1.5 rounded bg-slate-300/80 dark:bg-slate-300/45" />
                            <div className="h-1.5 rounded bg-slate-300/70 dark:bg-slate-300/35" />
                            <div className="h-1.5 w-3/4 rounded bg-slate-300/70 dark:bg-slate-300/35" />
                          </div>
                          <div className="space-y-1 pt-0.5">
                            <div className="h-2 rounded bg-slate-300/60 dark:bg-slate-400/35" />
                            <div className="h-2 rounded bg-slate-300/45 dark:bg-slate-400/25" />
                            <div className="h-2 w-2/3 rounded bg-slate-300/45 dark:bg-slate-400/25" />
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <span className="text-[10px] font-semibold tracking-[0.08em] text-slate-600 dark:text-slate-200">{opt.label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <label className="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                    Fondo
                    <input
                      type="color"
                      value={selectedBackgroundColor}
                      onChange={(e) => patchStyleOverrides({ colors: { background: e.target.value } })}
                      className="h-10 w-full rounded-2xl border border-slate-300/60 bg-white/90 p-1 dark:border-slate-200/20 dark:bg-slate-900/60"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                    Texto
                    <input
                      type="color"
                      value={selectedTextColor}
                      onChange={(e) => patchStyleOverrides({ colors: { text: e.target.value } })}
                      className="h-10 w-full rounded-2xl border border-slate-300/60 bg-white/90 p-1 dark:border-slate-200/20 dark:bg-slate-900/60"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                    Acento
                    <input
                      type="color"
                      value={selectedAccentColor}
                      onChange={(e) => patchStyleOverrides({ colors: { accent: e.target.value } })}
                      className="h-10 w-full rounded-2xl border border-slate-300/60 bg-white/90 p-1 dark:border-slate-200/20 dark:bg-slate-900/60"
                    />
                  </label>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">Separación vertical (eje Y)</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {([
                      { key: "compact", title: "Compacta", spacing: "space-y-0.5" },
                      { key: "comfortable", title: "Media", spacing: "space-y-1" },
                      { key: "relaxed", title: "Amplia", spacing: "space-y-1.5" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => patchStyleOverrides({ ui: { density: opt.key } })}
                        className={studioVisualToggleClass(selectedDensity === opt.key)}
                        title={opt.title}
                      >
                        <span className="sr-only">{opt.title}</span>
                        <div className={cx("w-full max-w-[72px]", opt.spacing)}>
                          <div className="h-1.5 rounded bg-slate-400/70 dark:bg-slate-300/45" />
                          <div className="h-1.5 rounded bg-slate-400/60 dark:bg-slate-300/35" />
                          <div className="h-1.5 rounded bg-slate-400/60 dark:bg-slate-300/35" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">Ancho de contenido</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {([
                      { key: "narrow", title: "Angosto", width: "max-w-[34px]" },
                      { key: "normal", title: "Normal", width: "max-w-[48px]" },
                      { key: "wide", title: "Ancho", width: "max-w-[62px]" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => patchStyleOverrides({ ui: { contentWidth: opt.key } })}
                        className={studioVisualToggleClass(selectedContentWidth === opt.key)}
                        title={opt.title}
                      >
                        <span className="sr-only">{opt.title}</span>
                        <div className="w-full rounded-lg border border-slate-300/65 p-1 dark:border-slate-200/25">
                          <div className={cx("mx-auto space-y-1", opt.width)}>
                            <div className="h-1.5 rounded bg-slate-400/70 dark:bg-slate-300/45" />
                            <div className="h-1.5 rounded bg-slate-400/60 dark:bg-slate-300/35" />
                            <div className="h-1.5 rounded bg-slate-400/60 dark:bg-slate-300/35" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">Radio de bordes</p>
                  <div className="mt-1.5 grid grid-cols-5 gap-2">
                    {([
                      { key: "sm", title: "Suave", radiusClass: "rounded-sm" },
                      { key: "md", title: "Medio", radiusClass: "rounded-md" },
                      { key: "lg", title: "Amplio", radiusClass: "rounded-lg" },
                      { key: "xl", title: "Muy amplio", radiusClass: "rounded-xl" },
                      { key: "2xl", title: "Máximo", radiusClass: "rounded-2xl" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => patchStyleOverrides({ ui: { radius: opt.key } })}
                        className={studioVisualToggleClass(selectedRadius === opt.key)}
                        title={opt.title}
                      >
                        <span className="sr-only">{opt.title}</span>
                        <span
                          className={cx(
                            "h-6 w-8 border border-slate-400/75 bg-slate-300/45 dark:border-slate-300/45 dark:bg-slate-300/25",
                            opt.radiusClass,
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-300/60 bg-white/90 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-200/20 dark:bg-slate-900/60 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={selectedDividers}
                    onChange={(e) => patchStyleOverrides({ ui: { dividers: e.target.checked } })}
                    className="size-4 accent-sky-600"
                  />
                  Mostrar divisores entre bloques
                </label>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={resetStyleOverrides}
                  className="inline-flex items-center justify-center rounded-full border border-sky-300/45 bg-white/75 px-3 py-2 text-xs font-medium text-sky-900 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] dark:border-sky-200/25 dark:bg-sky-900/35 dark:text-sky-100"
                >
                  Restablecer apariencia base
                </button>
              </div>
            </div>
          ) : null}

          {designMenuSection === "cover" ? (
            <TemplateConfigForm cfg={cfg} value={formValue} onChange={setFormValue} token={token} sections={["cover"]} />
          ) : null}

          {designMenuSection === "contact" ? (
            <TemplateConfigForm cfg={cfg} value={formValue} onChange={setFormValue} token={token} sections={["contact"]} />
          ) : null}

          {designMenuSection === "payment" ? (
            <TemplateConfigForm cfg={cfg} value={formValue} onChange={setFormValue} token={token} sections={["payment"]} />
          ) : null}
        </div>
      );
    }

    if (studioPanel === "manage") {
      return (
        <div className="space-y-3">
          <div className={PANEL_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Presets de contenido
              </h3>
              <button
                type="button"
                onClick={() => void saveCurrentAsPreset()}
                className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm shadow-emerald-900/10 transition hover:scale-[0.98] dark:text-emerald-200"
              >
                Guardar preset
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Guardá bloques y reutilizalos en otras plantillas.
            </p>
            <div className="mt-3 min-w-0 overflow-hidden">
              <TextPresetPicker
                token={token ?? null}
                docType={docType}
                refreshSignal={presetRefreshSignal}
                onApply={(content) => {
                  if (!content?.trim()) return;
                  setFormValue((prev) => ({
                    ...prev,
                    blocks: [
                      ...(Array.isArray(prev.blocks) ? prev.blocks : []),
                      {
                        id: nanoid(),
                        origin: "extra",
                        type: "paragraph",
                        value: { type: "paragraph", text: content },
                      },
                    ],
                  }));
                }}
                onApplyData={(maybeBlocks) => {
                  const nextBlocks = presetBlocksToOrdered(maybeBlocks);
                  if (nextBlocks.length === 0) return;
                  setFormValue((prev) => ({
                    ...prev,
                    blocks: [
                      ...(Array.isArray(prev.blocks) ? prev.blocks : []),
                      ...nextBlocks,
                    ],
                  }));
                }}
              />
            </div>
          </div>

          {docType === "quote_budget" ? (
            <div className={PANEL_CLASS}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Crear cotización desde este estudio</h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Completá datos mínimos y abrila en `/quotes` para seguir el flujo comercial.</p>

              <div className="mt-3 grid gap-2">
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

              <button
                type="button"
                onClick={createQuoteFromTemplate}
                disabled={creatingQuote || loading}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/90 px-5 py-2 text-sm font-medium text-emerald-900 shadow-sm shadow-emerald-900/10 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-100/70 dark:bg-emerald-500/20 dark:text-emerald-100"
              >
                {creatingQuote ? "Guardando..." : "Guardar y abrir cotización"}
              </button>

              {quoteCreateError ? (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{quoteCreateError}</p>
              ) : null}
            </div>
          ) : (
            <div className={PANEL_CLASS}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Confirmación manual</h3>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                Este tipo de documento se edita y descarga desde el estudio.
              </p>
            </div>
          )}
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Estado del estudio</h3>
            <div className="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <p>
                <b>Tipo:</b>{" "}
                {docType === "quote_budget" ? "Cotización" : "Confirmación manual"}
              </p>
              <p>
                <b>Bloques actuales:</b> {formValue.blocks?.length ?? 0}
              </p>
              <p>
                <b>Resultado:</b> editá en preview y descargá PDF desde el botón verde.
              </p>
            </div>
          </div>
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pasos rápidos</h3>
            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
              <li>1. Definí estilo y portada en Diseño.</li>
              <li>2. Editá contenido directo sobre el preview.</li>
              <li>3. Descargá PDF o guardá como cotización.</li>
            </ul>
          </div>
        </div>
      );
    }

    return null;
  })();

  const titleLabel =
    docType === "quote_budget" ? "Plantilla de Cotización" : "Plantilla de Confirmación Manual";

  const docTypeToggle = (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-300/55 bg-white/90 p-1 dark:border-slate-200/25 dark:bg-slate-900/60">
      <button
        type="button"
        onClick={() => setDocType("quote_budget")}
        className={cx(
          "rounded-lg px-2 py-1.5 text-[11px] font-medium transition",
          docType === "quote_budget"
            ? "bg-sky-500/15 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100"
            : "text-slate-600 dark:text-slate-300",
        )}
      >
        Modo cotización
      </button>
      <button
        type="button"
        onClick={() => setDocType("confirmation")}
        className={cx(
          "rounded-lg px-2 py-1.5 text-[11px] font-medium transition",
          docType === "confirmation"
            ? "bg-sky-500/15 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100"
            : "text-slate-600 dark:text-slate-300",
        )}
      >
        Modo confirmación
      </button>
    </div>
  );

  const badges = [
    {
      label: `Bloques ${formValue.blocks?.length ?? 0}`,
      tone: "slate" as const,
    },
  ];

  return (
    <ProtectedRoute>
      <section className="p-3 text-slate-950 dark:text-white md:p-4">
        {loading ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <StudioShell
            eyebrow="Estudio de PDF"
            title={titleLabel}
            overviewExtra={docTypeToggle}
            badges={badges}
            backHref="/quotes"
            backLabel="Volver a cotizaciones"
            tabs={tabs}
            tabsVariant="icon"
            tabColumnsDesktop={3}
            tabColumnsMobile={3}
            desktopSidebarWidth={368}
            activeTab={studioPanel}
            onChangeTab={(key) => setStudioPanel(key as StudioPanel)}
            panelTitle={panelTitle}
            panelBody={panelBody}
            showMobilePanel
            mainContent={
              <TemplateEditor
                cfg={cfg}
                value={formValue}
                onChange={setFormValue}
                docType={docType}
                token={token}
                filename={
                  docType === "quote_budget"
                    ? "estudio-cotizacion.pdf"
                    : "estudio-confirmacion-manual.pdf"
                }
                toolbarMode="studio"
              />
            }
          />
        )}
      </section>
    </ProtectedRoute>
  );
}
