// src/app/template-config/[doc_type]/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import StudioShell, { type StudioTab } from "@/components/studio/StudioShell";
import StudioSystemNavigation from "@/components/studio/StudioSystemNavigation";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import TemplateConfigPreview from "@/components/template-config/TemplateConfigPreview";
import StylesSection from "@/components/template-config/sections/StylesSection";
import CoverSection from "@/components/template-config/sections/CoverSection";
import ContactSection from "@/components/template-config/sections/ContactSection";
import PaymentSection from "@/components/template-config/sections/PaymentSection";
import TextPresetPicker from "@/components/templates/TextPresetPicker";
import { getAt, setAt } from "@/components/template-config/sections/_helpers";
import type { Config } from "@/components/template-config/types";
import type {
  BlockTextStyle,
  ContentBlock,
  KeyValueBlock,
  ListBlock,
} from "@/types/templates";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

type DocType = "quote" | "quote_budget" | "confirmation" | "voucher";
type StudioPanel = "system" | "design" | "manage";
type DesignMenuSection = "styles" | "cover" | "contact" | "payment";

type ApiGetResponse<T extends DocType = DocType> = {
  exists: boolean;
  id_template: number | null;
  id_agency: number;
  doc_type: T;
  config: Config;
  created_at: string | null;
  updated_at: string | null;
  error?: string;
};

type TemplateConfigRecord = {
  id_template: number;
  id_agency: number;
  doc_type: DocType;
  config: Config;
  created_at: string | null;
  updated_at: string | null;
};

const PANEL_CLASS =
  "rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur";
const STUDIO_ICON_TAB =
  "inline-flex items-center justify-center rounded-xl border border-slate-300/55 bg-white/85 p-2 text-slate-700 shadow-sm transition hover:scale-[0.98] dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100";
const STUDIO_ICON_TAB_ACTIVE =
  "border-sky-500/55 bg-sky-500/15 text-sky-900 dark:border-sky-300/50 dark:bg-sky-500/30 dark:text-sky-50";
const ACTION_ICON_BTN =
  "inline-flex size-10 items-center justify-center rounded-xl border border-slate-300/60 bg-white/90 text-slate-700 shadow-sm transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100";

const LOCAL_DEFAULTS: Record<DocType, Config> = {
  confirmation: {
    styles: {
      colors: { background: "#FFFFFF", text: "#111111", accent: "#6B7280" },
      fonts: { heading: "Poppins", body: "Poppins" },
    },
    layout: "layoutA",
    coverImage: { mode: "logo" },
    contactItems: ["phones", "email", "website", "address"],
    content: { blocks: [] },
    paymentOptions: [],
  },
  voucher: {
    styles: {
      colors: { background: "#FFFFFF", text: "#111111", accent: "#6B7280" },
      fonts: { heading: "Poppins", body: "Poppins" },
    },
    layout: "layoutA",
    coverImage: { mode: "logo" },
    contactItems: ["phones", "email", "website", "address"],
    content: { blocks: [] },
    paymentOptions: [],
  },
  quote: {
    styles: {
      colors: { background: "#FFFFFF", text: "#111111", accent: "#6B7280" },
      fonts: { heading: "Poppins", body: "Poppins" },
    },
    layout: "layoutA",
    coverImage: { mode: "logo" },
    contactItems: ["phones", "email", "website", "address"],
    content: { blocks: [] },
    paymentOptions: [],
  },
  quote_budget: {
    styles: {
      colors: { background: "#FFFFFF", text: "#111111", accent: "#6B7280" },
      fonts: { heading: "Poppins", body: "Poppins" },
    },
    layout: "layoutA",
    coverImage: { mode: "logo" },
    contactItems: ["phones", "email", "website", "address"],
    content: { blocks: [] },
    paymentOptions: [],
  },
};

const DOC_OPTIONS: Array<{ id: DocType; title: string; description: string }> = [
  {
    id: "quote",
    title: "Cotización",
    description: "Plantilla comercial general para propuestas.",
  },
  {
    id: "quote_budget",
    title: "Presupuesto",
    description: "Estilo base del PDF de cotización.",
  },
  {
    id: "confirmation",
    title: "Confirmación manual",
    description: "Confirmación sin reserva vinculada.",
  },
  {
    id: "voucher",
    title: "Confirmación automática",
    description: "Confirmación de servicios de reservas.",
  },
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toObj(v: unknown): Config {
  return isObj(v) ? (v as Record<string, unknown>) : {};
}

function cloneConfig(v: Config): Config {
  return JSON.parse(JSON.stringify(v)) as Config;
}

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

function resolveDocLabel(docType: DocType): string {
  if (docType === "quote") return "Cotización";
  if (docType === "quote_budget") return "Presupuesto";
  if (docType === "confirmation") return "Confirmación manual";
  return "Confirmación automática";
}

function isBlockType(type: string): type is ContentBlock["type"] {
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

function normalizeTextStyle(value: unknown): BlockTextStyle | undefined {
  if (!isObj(value)) return undefined;
  const size = typeof value.size === "string" ? value.size : undefined;
  const weight = typeof value.weight === "string" ? value.weight : undefined;
  if (!size && !weight) return undefined;
  return {
    ...(size ? { size: size as BlockTextStyle["size"] } : {}),
    ...(weight ? { weight: weight as BlockTextStyle["weight"] } : {}),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? ""));
}

function toPairs(value: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = isObj(item) ? item : {};
    return {
      key: String(row.key ?? ""),
      value: String(row.value ?? ""),
    };
  });
}

function normalizePresetBlocks(input: unknown): ContentBlock[] {
  if (!Array.isArray(input)) return [];

  const usedIds = new Set<string>();
  const nextId = (base: string, idx: number) => {
    let id = (base || `preset_${idx + 1}`).trim();
    if (!id) id = `preset_${idx + 1}`;
    while (usedIds.has(id)) {
      id = `${id}_${Math.random().toString(36).slice(2, 6)}`;
    }
    usedIds.add(id);
    return id;
  };

  return input
    .map((raw, idx) => {
      if (!isObj(raw)) return null;
      const type = String(raw.type || "");
      if (!isBlockType(type)) return null;

      const value = isObj(raw.value) ? raw.value : {};
      const mode: "fixed" | "form" =
        raw.mode === "form" || raw.origin === "form" ? "form" : "fixed";
      const id = nextId(String(raw.id || ""), idx);

      const common = {
        id,
        type,
        mode,
        label: typeof raw.label === "string" ? raw.label : undefined,
        fieldKey: typeof raw.fieldKey === "string" ? raw.fieldKey : undefined,
        textStyle: normalizeTextStyle(raw.textStyle),
      };

      switch (type) {
        case "heading": {
          const levelRaw = Number(value.level ?? raw.level ?? 1);
          const level = levelRaw === 2 || levelRaw === 3 ? levelRaw : 1;
          return {
            ...common,
            type,
            text: String(value.text ?? raw.text ?? ""),
            level,
          } as ContentBlock;
        }
        case "subtitle":
          return {
            ...common,
            type,
            text: String(value.text ?? raw.text ?? ""),
          } as ContentBlock;
        case "paragraph":
          return {
            ...common,
            type,
            text: String(value.text ?? raw.text ?? ""),
          } as ContentBlock;
        case "list": {
          const items = toStringArray(value.items ?? raw.items);
          return {
            ...common,
            type,
            items,
          } as ListBlock;
        }
        case "keyValue": {
          const pairs = toPairs(value.pairs ?? raw.pairs);
          return {
            ...common,
            type,
            pairs,
          } as KeyValueBlock;
        }
        case "twoColumns":
          return {
            ...common,
            type,
            left: String(value.left ?? raw.left ?? ""),
            right: String(value.right ?? raw.right ?? ""),
          } as ContentBlock;
        case "threeColumns":
          return {
            ...common,
            type,
            left: String(value.left ?? raw.left ?? ""),
            center: String(value.center ?? raw.center ?? ""),
            right: String(value.right ?? raw.right ?? ""),
          } as ContentBlock;
        default:
          return null;
      }
    })
    .filter(Boolean) as ContentBlock[];
}

export default function Page() {
  const params = useParams<{ doc_type?: string }>();
  const { token } = useAuth();

  const [role, setRole] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [studioPanel, setStudioPanel] = useState<StudioPanel>("design");
  const [designMenuSection, setDesignMenuSection] =
    useState<DesignMenuSection>("styles");

  const [cfg, setCfg] = useState<Config>({});
  const [exists, setExists] = useState(false);
  const [meta, setMeta] = useState<{
    id_template: number | null;
    created_at: string | null;
    updated_at: string | null;
  }>({ id_template: null, created_at: null, updated_at: null });
  const [resolvedView, setResolvedView] = useState(false);
  const [draftBlocks, setDraftBlocks] = useState<ContentBlock[] | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [presetRefreshSignal, setPresetRefreshSignal] = useState(0);

  const raw = String(params?.doc_type || "")
    .trim()
    .toLowerCase();

  const isValid =
    raw === "quote" ||
    raw === "quote_budget" ||
    raw === "confirmation" ||
    raw === "voucher";
  const docType = (isValid ? raw : "quote") as DocType;
  const isSalesDoc = docType === "quote" || docType === "quote_budget";

  const canManage = useMemo(() => canManageTemplateConfig(role), [role]);
  const editingDisabled = loading || saving || deleting;
  const backHref = docType === "voucher" ? "/bookings/config" : "/quotes/config";

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

  useEffect(() => {
    if (!token) {
      setRole(null);
      setLoadingRole(false);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        setLoadingRole(true);
        const res = await authFetch(
          "/api/user/profile",
          { cache: "no-store", signal: controller.signal },
          token,
        );
        const data = (await res.json().catch(() => ({}))) as { role?: string };
        if (!res.ok) throw new Error("No se pudo obtener el perfil.");
        setRole(data.role || null);
      } catch {
        setRole(null);
      } finally {
        setLoadingRole(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  const loadConfig = useCallback(async () => {
    if (!token || !isValid) return;
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/template-config/${encodeURIComponent(docType)}${resolvedView ? "?resolved=1" : ""}`,
        { cache: "no-store" },
        token,
      );
      const data = (await res.json().catch(() => ({}))) as ApiGetResponse;
      if (!res.ok) {
        throw new Error(data.error || "No se pudo cargar la configuración.");
      }

      setExists(Boolean(data.exists));
      setMeta({
        id_template: data.id_template ?? null,
        created_at: data.created_at ?? null,
        updated_at: data.updated_at ?? null,
      });
      setCfg(toObj(data.config));
      setDraftBlocks(null);
    } catch (error) {
      console.error("[template-config] load error", error);
      setExists(false);
      setMeta({ id_template: null, created_at: null, updated_at: null });
      setCfg(cloneConfig(LOCAL_DEFAULTS[docType]));
      setDraftBlocks(null);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al cargar configuración.",
      );
    } finally {
      setLoading(false);
    }
  }, [docType, isValid, resolvedView, token]);

  useEffect(() => {
    if (!canManage) return;
    void loadConfig();
  }, [canManage, loadConfig]);

  const getWorkingBlocks = useCallback((): ContentBlock[] => {
    if (Array.isArray(draftBlocks)) return draftBlocks;
    const fromCfg = getAt<unknown[]>(cfg, ["content", "blocks"], []);
    return Array.isArray(fromCfg) ? (fromCfg as ContentBlock[]) : [];
  }, [cfg, draftBlocks]);

  const saveConfig = useCallback(async () => {
    if (!token || !isValid) return;
    try {
      setSaving(true);
      const cfgWithDraft = setAt(cfg, ["content", "blocks"], getWorkingBlocks());
      const contactItemsRaw = (cfgWithDraft as Record<string, unknown>).contactItems;
      const sanitized: Config = {
        ...(cfgWithDraft as Record<string, unknown>),
        contactItems: Array.isArray(contactItemsRaw)
          ? contactItemsRaw.filter((x): x is string => typeof x === "string")
          : [],
      };

      const res = await authFetch(
        `/api/template-config/${encodeURIComponent(docType)}`,
        { method: "PUT", body: JSON.stringify({ config: sanitized }) },
        token,
      );
      const body = (await res.json().catch(() => ({}))) as
        | TemplateConfigRecord
        | { error?: string };
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || "No se pudo guardar.");
      }

      const record = body as TemplateConfigRecord;
      setExists(true);
      setMeta({
        id_template: record.id_template,
        created_at: record.created_at,
        updated_at: record.updated_at,
      });
      setCfg(toObj(record.config));
      setDraftBlocks(null);
      toast.success("Configuración guardada ✅");
    } catch (error) {
      console.error("[template-config] save error", error);
      toast.error(error instanceof Error ? error.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }, [cfg, docType, getWorkingBlocks, isValid, token]);

  const deleteConfig = useCallback(async () => {
    if (!token || !isValid) return;
    const confirmed = window.confirm("¿Eliminar configuración para este tipo de documento?");
    if (!confirmed) return;

    try {
      setDeleting(true);
      const res = await authFetch(
        `/api/template-config/${encodeURIComponent(docType)}`,
        { method: "DELETE" },
        token,
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || "No se pudo eliminar.");
      }

      setExists(false);
      setMeta({ id_template: null, created_at: null, updated_at: null });
      setCfg(cloneConfig(LOCAL_DEFAULTS[docType]));
      setDraftBlocks(null);
      toast.success("Configuración eliminada ✅");
    } catch (error) {
      console.error("[template-config] delete error", error);
      toast.error(error instanceof Error ? error.message : "Error al eliminar.");
    } finally {
      setDeleting(false);
    }
  }, [docType, isValid, token]);

  const resetDefaults = useCallback(() => {
    setCfg(cloneConfig(LOCAL_DEFAULTS[docType]));
    setDraftBlocks(null);
  }, [docType]);

  const saveCurrentAsPreset = useCallback(async () => {
    if (!token) return;
    const blocks = getWorkingBlocks();
    if (blocks.length === 0) {
      toast.info("No hay bloques para guardar como preset.");
      return;
    }

    const title = window.prompt("Nombre del preset de contenido:");
    if (!title || !title.trim()) return;

    try {
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
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "No se pudo guardar el preset.");
      }

      setPresetRefreshSignal((prev) => prev + 1);
      toast.success("Preset guardado ✅");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error guardando preset.");
    }
  }, [docType, getWorkingBlocks, token]);

  const applyPresetBlocks = useCallback((rawBlocks: unknown) => {
    const nextBlocks = normalizePresetBlocks(rawBlocks);
    if (nextBlocks.length === 0) {
      toast.info("El preset no tiene bloques válidos para aplicar.");
      return;
    }
    setCfg((prev) => setAt(prev, ["content", "blocks"], nextBlocks));
    setDraftBlocks(nextBlocks);
    toast.success("Preset aplicado en la vista previa.");
  }, []);

  const applyLegacyPreset = useCallback(
    (content: string) => {
      const nextText = String(content || "").trim();
      if (!nextText) return;
      const existing = getWorkingBlocks();
      const paragraph: ContentBlock = {
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: "paragraph",
        mode: "fixed",
        label: `Párrafo ${existing.length + 1}`,
        text: nextText,
      };
      const nextBlocks = [...existing, paragraph];
      setCfg((prev) => setAt(prev, ["content", "blocks"], nextBlocks));
      setDraftBlocks(nextBlocks);
      toast.success("Preset agregado al contenido.");
    },
    [getWorkingBlocks],
  );

  if (!isValid) {
    return (
      <ProtectedRoute>
        <section className="mx-auto max-w-3xl p-6 text-slate-950 dark:text-white">
          <h1 className="mb-2 text-2xl font-semibold">Configurar plantilla</h1>
          <p className="opacity-80">
            El tipo de documento &quot;<code>{raw || "(vacío)"}</code>&quot; no es válido.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {DOC_OPTIONS.map((option) => (
              <Link
                key={option.id}
                href={`/template-config/${option.id}`}
                className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur transition hover:scale-[0.99]"
              >
                <div className="text-lg font-medium">{option.title}</div>
                <div className="text-sm opacity-70">{option.description}</div>
              </Link>
            ))}
          </div>

          <ToastContainer />
        </section>
      </ProtectedRoute>
    );
  }

  if (loadingRole) {
    return (
      <ProtectedRoute>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner />
        </div>
        <ToastContainer />
      </ProtectedRoute>
    );
  }

  if (!canManage) {
    return (
      <ProtectedRoute>
        <section className="mx-auto max-w-3xl p-6 text-slate-950 dark:text-white">
          <h1 className="text-2xl font-semibold">Configuración de plantillas</h1>
          <p className="mt-2 text-sm opacity-80">
            No tenés permisos para editar esta sección.
          </p>
          <Link
            href={backHref}
            className="mt-4 inline-flex items-center rounded-full border border-slate-200/70 bg-white px-4 py-2 text-sm shadow-sm shadow-slate-900/5 transition hover:scale-[0.98] dark:border-white/10 dark:bg-white/5"
          >
            Volver
          </Link>
        </section>
        <ToastContainer />
      </ProtectedRoute>
    );
  }

  const panelTitle =
    studioPanel === "system"
      ? "Menú"
      : studioPanel === "design"
      ? "Diseño"
      : "Cotización";

  const designMenuItems: Array<{
    key: DesignMenuSection;
    label: string;
    icon: JSX.Element;
  }> = [
    {
      key: "styles",
      label: "Estilos",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.75h15m-15 5.25h15m-15 5.25h15" />
          <circle cx="7.5" cy="6.75" r="1.5" />
          <circle cx="15.75" cy="12" r="1.5" />
          <circle cx="11.25" cy="17.25" r="1.5" />
        </svg>
      ),
    },
    {
      key: "cover",
      label: "Portada",
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
        <div className={isSalesDoc ? "space-y-4" : "space-y-3"}>
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Tipo de documento
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Cambiá de estudio sin salir de esta pantalla.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {DOC_OPTIONS.map((option) => {
                const active = option.id === docType;
                return (
                  <Link
                    key={option.id}
                    href={`/template-config/${option.id}`}
                    className={[
                      "rounded-2xl border px-3 py-2 text-left transition hover:scale-[0.99]",
                      active
                        ? "border-sky-500/60 bg-sky-500/12 text-sky-950 dark:text-sky-50"
                        : "border-slate-300/60 bg-white/85 text-slate-700 dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100",
                    ].join(" ")}
                  >
                    <span className="block text-xs font-semibold uppercase tracking-[0.12em] opacity-80">
                      {option.title}
                    </span>
                    <span className="mt-1 block text-[11px] opacity-70">
                      {option.description}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          <StudioSystemNavigation
            backHref={backHref}
            backLabel="Volver"
            intro="Navegá por el sistema sin cerrar el estudio."
          />
        </div>
      );
    }

    if (studioPanel === "design") {
      return (
        <div className={isSalesDoc ? "space-y-4" : "space-y-3"}>
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Módulos del estudio
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Configurá el PDF por bloques para mantener el flujo comercial ordenado.
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {designMenuItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setDesignMenuSection(item.key)}
                  className={[
                    STUDIO_ICON_TAB,
                    designMenuSection === item.key ? STUDIO_ICON_TAB_ACTIVE : "",
                  ].join(" ")}
                  title={item.label}
                >
                  {item.icon}
                  <span className="sr-only">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
              {designMenuItems.map((item) => (
                <span key={item.key}>{item.label}</span>
              ))}
            </div>
          </div>

          {designMenuSection === "styles" ? (
            <StylesSection
              cfg={cfg}
              disabled={editingDisabled}
              uiMode={isSalesDoc ? "sales" : "default"}
              onChange={(next) => setCfg(next)}
            />
          ) : null}

          {designMenuSection === "cover" ? (
            <CoverSection
              cfg={cfg}
              disabled={editingDisabled}
              uiMode={isSalesDoc ? "sales" : "default"}
              onChange={(next) => setCfg(next)}
            />
          ) : null}

          {designMenuSection === "contact" ? (
            <ContactSection
              cfg={cfg}
              disabled={editingDisabled}
              uiMode={isSalesDoc ? "sales" : "default"}
              onChange={(next) => setCfg(next)}
            />
          ) : null}

          {designMenuSection === "payment" ? (
            <PaymentSection
              cfg={cfg}
              disabled={editingDisabled}
              uiMode={isSalesDoc ? "sales" : "default"}
              onChange={(next) => setCfg(next)}
            />
          ) : null}
        </div>
      );
    }

    if (studioPanel === "manage") {
      return (
        <div className={isSalesDoc ? "space-y-4" : "space-y-3"}>
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Resumen
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {[
                {
                  label: "Documento",
                  value: resolveDocLabel(docType),
                },
                {
                  label: "ID template",
                  value: String(meta.id_template ?? "-"),
                },
                {
                  label: "Bloques",
                  value: String(getWorkingBlocks().length),
                },
                {
                  label: "Actualizado",
                  value: meta.updated_at
                    ? new Date(meta.updated_at).toLocaleDateString()
                    : "-",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-white/10 bg-white/10 p-2 text-slate-700 shadow-sm shadow-sky-950/10 dark:text-slate-200"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm font-medium">{item.value}</p>
                </div>
              ))}
            </div>
            <label className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-2.5 py-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={resolvedView}
                onChange={(e) => setResolvedView(e.target.checked)}
                disabled={loading || saving || deleting}
                className="size-4 accent-sky-600"
              />
              Ver configuración heredada (resuelta)
            </label>
          </div>

          <div className={PANEL_CLASS}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Presets de contenido
              </h3>
              <button
                type="button"
                onClick={() => void saveCurrentAsPreset()}
                disabled={saving || deleting}
                className={ACTION_ICON_BTN}
                title="Guardar preset actual"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.75h-9A2.25 2.25 0 0 0 5.25 6v12a.75.75 0 0 0 1.125.65L12 15.75l5.625 2.9A.75.75 0 0 0 18.75 18V6A2.25 2.25 0 0 0 16.5 3.75Z" />
                </svg>
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
              Guardá el estado actual y aplicalo cuando lo necesites.
            </p>
            <div className="min-w-0 overflow-hidden">
              <TextPresetPicker
                token={token ?? null}
                docType={docType}
                onApply={applyLegacyPreset}
                onApplyData={applyPresetBlocks}
                refreshSignal={presetRefreshSignal}
              />
            </div>
          </div>
        </div>
      );
    }

    return null;
  })();

  return (
    <ProtectedRoute>
      <section className="p-3 text-slate-950 dark:text-white md:p-4">
        <StudioShell
          eyebrow="Estudio de configuración"
          title={`${resolveDocLabel(docType)} · Base PDF`}
          badges={[
            {
              label: exists ? "Configurado" : "Sin configuración",
              tone: exists ? "emerald" : "amber",
            },
            {
              label: `Bloques ${getWorkingBlocks().length}`,
              tone: "slate",
            },
          ]}
          backHref={backHref}
          backLabel="Volver"
          hideOverviewCard
          tabsVariant="icon"
          tabColumnsDesktop={3}
          tabColumnsMobile={3}
          desktopSidebarWidth={isSalesDoc ? 436 : 408}
          tabs={tabs}
          activeTab={studioPanel}
          onChangeTab={(key) => setStudioPanel(key as StudioPanel)}
          panelTitle={panelTitle}
          panelBody={panelBody}
          showMobilePanel
          mainContent={
            loading ? (
              <div className="flex min-h-[60vh] items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <div className="space-y-4">
                <TemplateConfigPreview
                  cfg={cfg}
                  docTypeLabel={resolveDocLabel(docType)}
                  editable
                  onDraftBlocksChange={setDraftBlocks}
                />

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-300/35 bg-white/80 p-3 shadow-sm shadow-sky-900/10 backdrop-blur dark:border-sky-200/20 dark:bg-slate-900/65">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
                    <span>{resolveDocLabel(docType)}</span>
                    <span className="size-1 rounded-full bg-slate-400/70" />
                    <span>{exists ? "Configurado" : "Sin guardar"}</span>
                    <span className="size-1 rounded-full bg-slate-400/70" />
                    <span>{getWorkingBlocks().length} bloques</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={backHref}
                      className="inline-flex items-center rounded-full border border-slate-300/60 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:scale-[0.98] dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100"
                    >
                      Volver
                    </Link>

                    <button
                      type="button"
                      onClick={resetDefaults}
                      disabled={editingDisabled}
                      className={ACTION_ICON_BTN}
                      title="Restaurar base"
                    >
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
                          d="M3.75 12a8.25 8.25 0 1 0 2.416-5.834M3.75 5.25v3.75h3.75"
                        />
                      </svg>
                      <span className="sr-only">Restaurar base</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteConfig()}
                      disabled={editingDisabled || !exists}
                      className="inline-flex items-center rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                      title="Eliminar configuración"
                    >
                      Eliminar
                    </button>

                    <button
                      type="button"
                      onClick={() => void saveConfig()}
                      disabled={editingDisabled}
                      className="inline-flex items-center justify-center rounded-full border border-emerald-100 bg-emerald-50/90 px-5 py-2 text-sm font-medium text-emerald-900 shadow-sm shadow-emerald-900/10 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-100/70 dark:bg-emerald-500/20 dark:text-emerald-100"
                    >
                      {saving ? "Guardando..." : "Guardar cambios"}
                    </button>
                  </div>
                </div>
              </div>
            )
          }
        />
      </section>
      <ToastContainer />
    </ProtectedRoute>
  );
}
