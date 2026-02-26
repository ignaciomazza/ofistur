"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
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
  OrderedBlock,
  TemplateConfig,
  TemplateFormValues,
  BlockType,
  BlockFormValue,
} from "@/types/templates";
import { buildInitialOrderedBlocks } from "@/lib/templateConfig";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import { parseAmountInput } from "@/utils/receipts/receiptForm";
import {
  normalizeQuoteBookingDraft,
  normalizeQuoteCustomValues,
  normalizeQuotePaxDrafts,
  normalizeQuoteServiceDrafts,
  type QuotePaxDraft,
  type QuoteServiceDraft,
} from "@/utils/quoteDrafts";
import { nanoid } from "nanoid/non-secure";

type QuoteTemplateUser = {
  id_user: number;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
};

type QuoteTemplateItem = {
  id_quote: number;
  agency_quote_id?: number | null;
  public_id?: string | null;
  id_user: number;
  quote_status?: "active" | "converted" | null;
  converted_at?: string | null;
  converted_booking_id?: number | null;
  lead_name?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  note?: string | null;
  booking_draft?: unknown;
  pax_drafts?: unknown;
  service_drafts?: unknown;
  custom_values?: unknown;
  pdf_draft?: unknown;
  pdf_draft_saved_at?: string | null;
  pdf_last_file_name?: string | null;
  creation_date: string;
  updated_at: string;
  user?: QuoteTemplateUser | null;
};

type TemplateConfigGetResponse = {
  exists: boolean;
  id_template: number | null;
  id_agency: number;
  doc_type: string;
  config: TemplateConfig;
  created_at: string | null;
  updated_at: string | null;
  error?: string;
};

const EMPTY_CFG: TemplateConfig = {};
const EMPTY_VALUE: TemplateFormValues = { blocks: [] };
const QUOTE_PDF_DOC_TYPE = "quote_budget";
const QUOTE_DRAFT_VERSION = 1;
const PANEL_CLASS =
  "rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur";
const STUDIO_ACTION_BTN =
  "inline-flex items-center justify-center rounded-full border border-sky-300/45 bg-white/75 px-3 py-2 text-xs font-medium text-sky-900 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-200/25 dark:bg-sky-900/35 dark:text-sky-100";
const STUDIO_ICON_TAB =
  "inline-flex items-center justify-center rounded-xl border border-slate-300/55 bg-white/85 p-2 text-slate-700 shadow-sm transition hover:scale-[0.98] dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100";
const STUDIO_ICON_TAB_ACTIVE =
  "border-sky-500/55 bg-sky-500/15 text-sky-900 dark:border-sky-300/50 dark:bg-sky-500/30 dark:text-sky-50";
const STUDIO_ICON_ACTION =
  "inline-flex size-10 items-center justify-center rounded-xl border border-slate-300/60 bg-white/85 text-slate-700 shadow-sm transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100";

const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

type StudioPanel = "system" | "design" | "manage";
type DesignMenuSection = "look" | "cover" | "contact" | "payment";
type StyleOverrides = NonNullable<TemplateFormValues["styles"]>;
type StyleOverrideColors = NonNullable<StyleOverrides["colors"]>;
type StyleOverrideUi = NonNullable<StyleOverrides["ui"]>;

type QuotePdfDraftPayload = {
  version: number;
  saved_at: string;
  value: TemplateFormValues;
};

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDraftStorageKey(quoteId: string | null): string | null {
  if (!quoteId) return null;
  return `ofistur:quotes:pdf-draft:${quoteId}`;
}

function coerceTemplateFormValue(input: unknown): TemplateFormValues | null {
  if (!isRecord(input)) return null;
  const blocks = input.blocks;
  if (!Array.isArray(blocks)) return null;
  const layout =
    input.layout === "layoutA" || input.layout === "layoutB" || input.layout === "layoutC"
      ? input.layout
      : undefined;
  return {
    blocks: blocks as OrderedBlock[],
    layout,
    cover: isRecord(input.cover) ? (input.cover as TemplateFormValues["cover"]) : undefined,
    contact: isRecord(input.contact)
      ? (input.contact as TemplateFormValues["contact"])
      : undefined,
    payment: isRecord(input.payment)
      ? (input.payment as TemplateFormValues["payment"])
      : undefined,
    styles: isRecord(input.styles)
      ? (input.styles as TemplateFormValues["styles"])
      : undefined,
  };
}

function readDraftFromStorage(storageKey: string | null): QuotePdfDraftPayload | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const value = coerceTemplateFormValue(parsed.value);
    if (!value) return null;
    return {
      version: Number(parsed.version) || 0,
      saved_at: cleanString(parsed.saved_at) || "",
      value,
    };
  } catch {
    return null;
  }
}

function writeDraftToStorage(
  storageKey: string | null,
  value: TemplateFormValues,
): string | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const savedAt = new Date().toISOString();
    const payload: QuotePdfDraftPayload = {
      version: QUOTE_DRAFT_VERSION,
      saved_at: savedAt,
      value,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
    return savedAt;
  } catch {
    return null;
  }
}

function removeDraftFromStorage(storageKey: string | null): void {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {}
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString("es-AR");
  } catch {
    return value;
  }
}

function toDateMs(value?: string | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function toAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseAmountInput(value);
    if (parsed != null && Number.isFinite(parsed)) return parsed;
    const fallback = Number(value.replace(",", "."));
    if (Number.isFinite(fallback)) return fallback;
  }
  return null;
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  try {
    return formatDateInBuenosAires(value);
  } catch {
    return value;
  }
}

function formatMoney(amount: number | null, currency?: string | null): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const code = cleanString(currency || "ARS").toUpperCase() || "ARS";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function formatPaxName(pax: QuotePaxDraft, index: number): string {
  const full = `${pax.first_name || ""} ${pax.last_name || ""}`.trim();
  if (full) return full;
  if (pax.mode === "existing" && pax.client_id) return `Pax existente Nº ${pax.client_id}`;
  return `Pasajero Nº ${index + 1}`;
}

function summarizeAmountsByCurrency(
  services: QuoteServiceDraft[],
  field: "sale_price" | "cost_price",
): string {
  const totals: Record<string, number> = {};
  for (const service of services) {
    const amount = toAmount(service[field]);
    if (amount == null || !Number.isFinite(amount)) continue;
    const code = cleanString(service.currency || "ARS").toUpperCase() || "ARS";
    totals[code] = (totals[code] || 0) + amount;
  }
  const entries = Object.entries(totals);
  if (entries.length === 0) return "—";
  return entries
    .map(([currency, total]) => formatMoney(total, currency))
    .join(" + ");
}

function buildQuoteCoreBlocks(quote: QuoteTemplateItem): OrderedBlock[] {
  const bookingDraft = normalizeQuoteBookingDraft(quote.booking_draft);
  const paxDrafts = normalizeQuotePaxDrafts(quote.pax_drafts);
  const serviceDrafts = normalizeQuoteServiceDrafts(quote.service_drafts);
  const customValues = normalizeQuoteCustomValues(quote.custom_values);

  const displayId = quote.agency_quote_id ?? quote.id_quote;
  const quoteCurrency = cleanString(bookingDraft.currency || "ARS").toUpperCase() || "ARS";

  const blocks: OrderedBlock[] = [
    {
      id: "q_core_title",
      origin: "form",
      type: "heading",
      value: {
        type: "heading",
        level: 1,
        text: `Cotización Nº ${displayId}`,
      },
    },
    {
      id: "q_core_intro",
      origin: "form",
      type: "subtitle",
      value: {
        type: "subtitle",
        text: quote.lead_name || "Cliente sin nombre",
      },
    },
    {
      id: "q_core_trip_title",
      origin: "form",
      type: "subtitle",
      value: {
        type: "subtitle",
        text: "Datos del viaje",
      },
    },
    {
      id: "q_core_trip_info",
      origin: "form",
      type: "paragraph",
      value: {
        type: "paragraph",
        text: `Salida: ${formatDate(bookingDraft.departure_date)} · Regreso: ${formatDate(
          bookingDraft.return_date,
        )}`,
      },
    },
  ];

  if (cleanString(bookingDraft.details)) {
    blocks.push({
      id: "q_core_details_title",
      origin: "form",
      type: "subtitle",
      value: {
        type: "subtitle",
        text: "Detalle del viaje",
      },
    });
    blocks.push({
      id: "q_core_details",
      origin: "form",
      type: "paragraph",
      value: {
        type: "paragraph",
        text: bookingDraft.details || "",
      },
    });
  }

  blocks.push({
    id: "q_core_pax_title",
    origin: "form",
    type: "subtitle",
    value: { type: "subtitle", text: "Pasajeros" },
  });
  blocks.push({
    id: "q_core_pax_count",
    origin: "form",
    type: "paragraph",
    value: { type: "paragraph", text: `Cantidad de pasajeros: ${paxDrafts.length}` },
  });

  if (paxDrafts.length === 0) {
    blocks.push({
      id: "q_core_pax_empty",
      origin: "form",
      type: "paragraph",
      value: { type: "paragraph", text: "Sin pasajeros cargados." },
    });
  } else {
    paxDrafts.forEach((pax, index) => {
      const center = [
        pax.is_titular ? "Titular" : "Acompañante",
        pax.birth_date ? `Nac: ${formatDate(pax.birth_date)}` : "",
      ]
        .filter((v) => cleanString(v))
        .join(" · ");
      const right = [
        pax.nationality ? `Nacionalidad: ${pax.nationality}` : "",
        pax.gender ? `Género: ${pax.gender}` : "",
        pax.notes ? `Nota: ${pax.notes}` : "",
      ]
        .filter((v) => cleanString(v))
        .join(" · ");
      blocks.push({
        id: `q_core_pax_${index}`,
        origin: "form",
        type: "threeColumns",
        value: {
          type: "threeColumns",
          left: `${index + 1}. ${formatPaxName(pax, index)}`,
          center,
          right: right || "—",
        },
      });
    });
  }

  blocks.push({
    id: "q_core_services_title",
    origin: "form",
    type: "subtitle",
    value: { type: "subtitle", text: "Servicios" },
  });

  if (serviceDrafts.length === 0) {
    blocks.push({
      id: "q_core_services_empty",
      origin: "form",
      type: "paragraph",
      value: { type: "paragraph", text: "Sin servicios cargados." },
    });
  } else {
    serviceDrafts.forEach((service, index) => {
      const serviceMeta = [
        service.destination ? `Destino: ${service.destination}` : "",
        service.reference ? `Ref: ${service.reference}` : "",
        service.departure_date ? `Salida: ${formatDate(service.departure_date)}` : "",
        service.return_date ? `Regreso: ${formatDate(service.return_date)}` : "",
      ].filter((value) => cleanString(value));
      const serviceText = [
        ...serviceMeta,
        cleanString(service.description) ? service.description || "" : "",
        cleanString(service.note) &&
        cleanString(service.note) !== cleanString(service.description)
          ? `Nota: ${service.note}`
          : "",
      ]
        .filter((value) => cleanString(value))
        .join(" · ");

      blocks.push({
        id: `q_core_service_${index}_title`,
        origin: "form",
        type: "subtitle",
        value: {
          type: "subtitle",
          text: `${index + 1}. ${service.type || "Servicio"}`,
        },
      });
      blocks.push({
        id: `q_core_service_${index}_detail`,
        origin: "form",
        type: "paragraph",
        value: {
          type: "paragraph",
          text: serviceText || "Sin detalle adicional.",
        },
      });
      blocks.push({
        id: `q_core_service_${index}_prices`,
        origin: "form",
        type: "keyValue",
        value: {
          type: "keyValue",
          pairs: [
            {
              key: "Venta",
              value: formatMoney(toAmount(service.sale_price), service.currency || quoteCurrency),
            },
            {
              key: "Costo",
              value: formatMoney(toAmount(service.cost_price), service.currency || quoteCurrency),
            },
          ],
        },
      });
    });
  }

  blocks.push({
    id: "q_core_totals_title",
    origin: "form",
    type: "subtitle",
    value: { type: "subtitle", text: "Totales estimados" },
  });
  blocks.push({
    id: "q_core_totals",
    origin: "form",
    type: "keyValue",
    value: {
      type: "keyValue",
      pairs: [
        {
          key: "Venta estimada",
          value: summarizeAmountsByCurrency(serviceDrafts, "sale_price"),
        },
        {
          key: "Costo estimado",
          value: summarizeAmountsByCurrency(serviceDrafts, "cost_price"),
        },
      ],
    },
  });

  const customEntries = Object.entries(customValues).filter(([key, value]) => {
    if (!cleanString(key)) return false;
    if (key.startsWith("__")) return false;
    if (value == null) return false;
    if (typeof value === "string") return cleanString(value).length > 0;
    if (typeof value === "number" || typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.length > 0;
    return false;
  });

  if (customEntries.length > 0) {
    blocks.push({
      id: "q_core_custom_title",
      origin: "form",
      type: "subtitle",
      value: { type: "subtitle", text: "Campos personalizados" },
    });

    customEntries.forEach(([key, value], index) => {
      blocks.push({
        id: `q_core_custom_${index}_key`,
        origin: "form",
        type: "subtitle",
        value: { type: "subtitle", text: key },
      });
      blocks.push({
        id: `q_core_custom_${index}_value`,
        origin: "form",
        type: "paragraph",
        value: {
          type: "paragraph",
          text: Array.isArray(value)
            ? value.map((item) => String(item)).join(", ")
            : String(value),
        },
      });
    });
  }

  return blocks;
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
  const value = isRecord(raw.value) ? (raw.value as Record<string, unknown>) : {};
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
      if (!isRecord(raw)) return null;
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

export default function QuoteTemplatePage() {
  const params = useParams();
  const { token } = useAuth();

  const quoteId = useMemo(() => {
    const raw = params?.id;
    if (Array.isArray(raw)) return raw[0] || null;
    return raw ? String(raw) : null;
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteTemplateItem | null>(null);
  const [cfg, setCfg] = useState<TemplateConfig>(EMPTY_CFG);
  const [formValue, setFormValue] = useState<TemplateFormValues>(EMPTY_VALUE);
  const [baseFormValue, setBaseFormValue] = useState<TemplateFormValues>(EMPTY_VALUE);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [studioPanel, setStudioPanel] = useState<StudioPanel>("design");
  const [designMenuSection, setDesignMenuSection] =
    useState<DesignMenuSection>("look");
  const [presetRefreshSignal, setPresetRefreshSignal] = useState(0);
  const draftStorageKey = useMemo(() => toDraftStorageKey(quoteId), [quoteId]);
  const lastSavedPayloadRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !quoteId) return;
    setLoading(true);
    setError(null);
    setDraftReady(false);
    try {
      const [quoteRes, cfgRes] = await Promise.all([
        authFetch(`/api/quotes/${quoteId}`, { cache: "no-store" }, token),
        authFetch(
          `/api/template-config/${QUOTE_PDF_DOC_TYPE}?resolved=1`,
          { cache: "no-store" },
          token,
        ),
      ]);

      const quoteJson = (await quoteRes.json()) as QuoteTemplateItem & { error?: string };
      const cfgJson = (await cfgRes.json()) as TemplateConfigGetResponse;

      if (!quoteRes.ok) {
        throw new Error(quoteJson.error || "No se pudo cargar la cotización.");
      }
      if (!cfgRes.ok) {
        throw new Error(cfgJson.error || "No se pudo cargar la configuración del template.");
      }

      const resolvedCfg = cfgJson.config || EMPTY_CFG;
      const coreBlocks = buildQuoteCoreBlocks(quoteJson);
      const templateBlocks = buildInitialOrderedBlocks(resolvedCfg);
      const baseValue: TemplateFormValues = {
        blocks: [...coreBlocks, ...templateBlocks],
      };
      const localDraft = readDraftFromStorage(toDraftStorageKey(quoteId));
      const serverDraftValue = coerceTemplateFormValue(quoteJson.pdf_draft);
      const serverSavedAt = cleanString(quoteJson.pdf_draft_saved_at);
      const useLocalDraft =
        !!localDraft &&
        toDateMs(localDraft.saved_at) > toDateMs(serverSavedAt || null);
      const selectedDraft = useLocalDraft
        ? localDraft?.value
        : serverDraftValue ?? localDraft?.value ?? null;
      const selectedSavedAt = useLocalDraft
        ? localDraft?.saved_at || null
        : serverSavedAt || localDraft?.saved_at || null;

      setQuote(quoteJson);
      setCfg(resolvedCfg);
      setBaseFormValue(baseValue);
      setFormValue(selectedDraft ?? baseValue);
      setLastDraftSavedAt(selectedSavedAt);
      lastSavedPayloadRef.current = JSON.stringify(selectedDraft ?? baseValue);
      setDraftError(null);
      setDraftReady(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al cargar la cotización.";
      setError(msg);
      setQuote(null);
      setCfg(EMPTY_CFG);
      setFormValue(EMPTY_VALUE);
      setBaseFormValue(EMPTY_VALUE);
      setLastDraftSavedAt(null);
      setDraftError(null);
      lastSavedPayloadRef.current = null;
      setDraftReady(false);
    } finally {
      setLoading(false);
    }
  }, [token, quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveDraftToServer = useCallback(
    async (
      nextValue: TemplateFormValues | null,
      opts?: {
        silent?: boolean;
        savedAt?: string | null;
        fileName?: string | null;
      },
    ): Promise<boolean> => {
      if (!token || !quoteId) return false;
      const silent = opts?.silent === true;
      const savedAt =
        opts?.savedAt === undefined
          ? nextValue
            ? new Date().toISOString()
            : null
          : opts.savedAt;
      const payload: Record<string, unknown> = {
        pdf_draft: nextValue,
        pdf_draft_saved_at: savedAt,
      };
      if (opts?.fileName !== undefined) {
        payload.pdf_last_file_name = cleanString(opts.fileName) || null;
      }
      if (!silent) setSavingDraft(true);
      try {
        const res = await authFetch(
          `/api/quotes/${quoteId}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          },
          token,
        );
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!res.ok) {
          throw new Error(body?.error || "No se pudo guardar el borrador PDF.");
        }
        if (nextValue) {
          setLastDraftSavedAt(savedAt || new Date().toISOString());
          lastSavedPayloadRef.current = JSON.stringify(nextValue);
        } else {
          setLastDraftSavedAt(null);
          lastSavedPayloadRef.current = null;
        }
        setDraftError(null);
        return true;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "No se pudo guardar el borrador PDF.";
        setDraftError(msg);
        return false;
      } finally {
        if (!silent) setSavingDraft(false);
      }
    },
    [quoteId, token],
  );

  useEffect(() => {
    if (!draftReady || !draftStorageKey || !quote) return;
    const timeout = window.setTimeout(() => {
      const savedAt = writeDraftToStorage(draftStorageKey, formValue);
      const serialized = JSON.stringify(formValue);
      if (serialized === lastSavedPayloadRef.current) return;
      void saveDraftToServer(formValue, {
        silent: true,
        savedAt: savedAt || new Date().toISOString(),
      });
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [draftReady, draftStorageKey, formValue, quote, saveDraftToServer]);

  const saveDraftNow = useCallback(async () => {
    const savedAt = writeDraftToStorage(draftStorageKey, formValue);
    await saveDraftToServer(formValue, {
      silent: false,
      savedAt: savedAt || new Date().toISOString(),
    });
  }, [draftStorageKey, formValue, saveDraftToServer]);

  const restoreBase = useCallback(() => {
    setFormValue(baseFormValue);
  }, [baseFormValue]);

  const reloadDraft = useCallback(async () => {
    let loadedServerDraft = false;
    if (token && quoteId) {
      try {
        const res = await authFetch(
          `/api/quotes/${quoteId}`,
          { cache: "no-store" },
          token,
        );
        const body = (await res.json().catch(() => null)) as
          | QuoteTemplateItem
          | { error?: string }
          | null;
        if (res.ok && body && "id_quote" in body) {
          const serverDraft = coerceTemplateFormValue(body.pdf_draft);
          if (serverDraft) {
            setFormValue(serverDraft);
            setLastDraftSavedAt(cleanString(body.pdf_draft_saved_at) || null);
            lastSavedPayloadRef.current = JSON.stringify(serverDraft);
            loadedServerDraft = true;
            setDraftError(null);
          }
        }
      } catch {}
    }
    if (loadedServerDraft) return;
    const savedDraft = readDraftFromStorage(draftStorageKey);
    if (!savedDraft) return;
    setFormValue(savedDraft.value);
    setLastDraftSavedAt(savedDraft.saved_at || null);
    lastSavedPayloadRef.current = JSON.stringify(savedDraft.value);
  }, [draftStorageKey, quoteId, token]);

  const deleteDraft = useCallback(async () => {
    removeDraftFromStorage(draftStorageKey);
    setFormValue(baseFormValue);
    setLastDraftSavedAt(null);
    lastSavedPayloadRef.current = JSON.stringify(baseFormValue);
    await saveDraftToServer(null, { silent: false, savedAt: null });
    lastSavedPayloadRef.current = JSON.stringify(baseFormValue);
  }, [baseFormValue, draftStorageKey, saveDraftToServer]);

  const saveCurrentAsPreset = useCallback(async () => {
    try {
      if (!token) throw new Error("No hay token de autenticación.");
      const blocks = Array.isArray(formValue.blocks) ? formValue.blocks : [];
      const customBlocks = blocks.filter((block) => !block.id.startsWith("q_core_"));
      if (customBlocks.length === 0) {
        window.alert("No hay bloques personalizados para guardar.");
        return;
      }
      const title = window.prompt("Nombre del preset de contenido:");
      if (!title || !title.trim()) return;

      const payload = {
        title: title.trim(),
        content: "",
        doc_type: "quote_budget",
        data: {
          version: 2,
          kind: "data" as const,
          data: { blocks: customBlocks },
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
      window.alert("Preset guardado.");
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Error guardando el preset.",
      );
    }
  }, [formValue.blocks, token]);

  const quoteDisplayId = quote?.agency_quote_id ?? quote?.id_quote ?? "cotizacion";
  const quoteSummary = useMemo(() => {
    if (!quote) {
      return {
        clientName: "Cliente sin nombre",
        departureDate: "—",
        returnDate: "—",
        paxCount: 0,
        servicesCount: 0,
        saleSummary: "—",
        costSummary: "—",
      };
    }
    const bookingDraft = normalizeQuoteBookingDraft(quote.booking_draft);
    const paxDrafts = normalizeQuotePaxDrafts(quote.pax_drafts);
    const serviceDrafts = normalizeQuoteServiceDrafts(quote.service_drafts);
    return {
      clientName: quote.lead_name || "Cliente sin nombre",
      departureDate: formatDate(bookingDraft.departure_date),
      returnDate: formatDate(bookingDraft.return_date),
      paxCount: paxDrafts.length,
      servicesCount: serviceDrafts.length,
      saleSummary: summarizeAmountsByCurrency(serviceDrafts, "sale_price"),
      costSummary: summarizeAmountsByCurrency(serviceDrafts, "cost_price"),
    };
  }, [quote]);

  const handlePdfDownloaded = useCallback(
    async (fileName: string) => {
      if (!cleanString(fileName)) return;
      await saveDraftToServer(formValue, {
        silent: true,
        fileName,
      });
    },
    [formValue, saveDraftToServer],
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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 6.75h15m-15 5.25h9m-9 5.25h15"
          />
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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Z"
          />
        </svg>
      ),
    },
    {
      key: "contact",
      label: "Contacto",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102A1.125 1.125 0 0 0 5.872 2.25H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
          />
        </svg>
      ),
    },
    {
      key: "payment",
      label: "Cobro",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
          />
        </svg>
      ),
    },
  ];
  const quoteCreationDate = quote?.creation_date ?? null;
  const quoteUpdatedAt = quote?.updated_at ?? null;
  const isConverted = quote?.quote_status === "converted";
  const selectedBackgroundColor =
    formValue.styles?.colors?.background ?? cfg.styles?.colors?.background ?? "#ffffff";
  const selectedTextColor =
    formValue.styles?.colors?.text ?? cfg.styles?.colors?.text ?? "#111111";
  const selectedAccentColor =
    formValue.styles?.colors?.accent ?? cfg.styles?.colors?.accent ?? "#0ea5e9";
  const selectedDensity =
    formValue.styles?.ui?.density ?? cfg.styles?.ui?.density ?? "comfortable";
  const selectedContentWidth =
    formValue.styles?.ui?.contentWidth ?? cfg.styles?.ui?.contentWidth ?? "normal";
  const selectedRadius = formValue.styles?.ui?.radius ?? cfg.styles?.ui?.radius ?? "2xl";
  const selectedDividers =
    formValue.styles?.ui?.dividers ?? cfg.styles?.ui?.dividers ?? true;
  const selectedLayout = formValue.layout ?? cfg.layout ?? "layoutA";
  const hasUnsavedChanges = useMemo(() => {
    try {
      const current = JSON.stringify(formValue);
      return current !== (lastSavedPayloadRef.current ?? "");
    } catch {
      return false;
    }
  }, [formValue]);
  const readinessChecks = useMemo(
    () => [
      { label: "Cliente con nombre", ok: cleanString(quote?.lead_name).length > 0 },
      { label: "Teléfono de contacto", ok: cleanString(quote?.lead_phone).length > 0 },
      { label: "Pasajeros cargados", ok: quoteSummary.paxCount > 0 },
      { label: "Servicios cargados", ok: quoteSummary.servicesCount > 0 },
      {
        label: "Fechas del viaje",
        ok: quoteSummary.departureDate !== "—" || quoteSummary.returnDate !== "—",
      },
    ],
    [quote?.lead_name, quote?.lead_phone, quoteSummary],
  );
  const readinessDone = readinessChecks.filter((item) => item.ok).length;
  const readinessPercent = Math.round(
    (readinessDone / Math.max(1, readinessChecks.length)) * 100,
  );
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
  const panelBody = (() => {
    if (studioPanel === "system") {
      return (
        <StudioSystemNavigation
          backHref="/quotes"
          backLabel="Volver a cotizaciones"
          intro="Saltá entre áreas sin perder el contexto del estudio de cotización."
        />
      );
    }
    if (studioPanel === "design") {
      return (
        <div className="space-y-3">
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Módulos de diseño
            </h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Elegí un módulo y editá ese grupo de opciones.
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {designMenuItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setDesignMenuSection(item.key)}
                  className={cx(
                    STUDIO_ICON_TAB,
                    designMenuSection === item.key && STUDIO_ICON_TAB_ACTIVE,
                  )}
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
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Apariencia del PDF
              </h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                Elegí un boceto visual y ajustá esta cotización sin tocar el template base.
              </p>
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
                    <span className="text-[10px] font-semibold tracking-[0.08em] text-slate-600 dark:text-slate-200">
                      {opt.label}
                    </span>
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
                      onChange={(e) =>
                        patchStyleOverrides({
                          colors: { background: e.target.value },
                        })
                      }
                      className="h-10 w-full rounded-2xl border border-slate-300/60 bg-white/90 p-1 dark:border-slate-200/20 dark:bg-slate-900/60"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                    Texto
                    <input
                      type="color"
                      value={selectedTextColor}
                      onChange={(e) =>
                        patchStyleOverrides({
                          colors: { text: e.target.value },
                        })
                      }
                      className="h-10 w-full rounded-2xl border border-slate-300/60 bg-white/90 p-1 dark:border-slate-200/20 dark:bg-slate-900/60"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                    Acento
                    <input
                      type="color"
                      value={selectedAccentColor}
                      onChange={(e) =>
                        patchStyleOverrides({
                          colors: { accent: e.target.value },
                        })
                      }
                      className="h-10 w-full rounded-2xl border border-slate-300/60 bg-white/90 p-1 dark:border-slate-200/20 dark:bg-slate-900/60"
                    />
                  </label>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    Separación vertical (eje Y)
                  </p>
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
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    Ancho de contenido
                  </p>
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
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    Radio de bordes
                  </p>
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
                    onChange={(e) =>
                      patchStyleOverrides({
                        ui: { dividers: e.target.checked },
                      })
                    }
                    className="size-4 accent-sky-600"
                  />
                  Mostrar divisores entre bloques
                </label>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={resetStyleOverrides}
                  className={STUDIO_ACTION_BTN}
                >
                  Restablecer apariencia base
                </button>
              </div>
            </div>
          ) : null}

          {designMenuSection === "cover" ? (
            <TemplateConfigForm
              cfg={cfg}
              value={formValue}
              onChange={setFormValue}
              token={token}
              sections={["cover"]}
            />
          ) : null}

          {designMenuSection === "contact" ? (
            <TemplateConfigForm
              cfg={cfg}
              value={formValue}
              onChange={setFormValue}
              token={token}
              sections={["contact"]}
            />
          ) : null}

          {designMenuSection === "payment" ? (
            <TemplateConfigForm
              cfg={cfg}
              value={formValue}
              onChange={setFormValue}
              token={token}
              sections={["payment"]}
            />
          ) : null}
        </div>
      );
    }
    if (studioPanel === "manage") {
      const draftStatusLabel = savingDraft
        ? "Guardando cambios…"
        : draftError
          ? "Error de guardado"
          : hasUnsavedChanges
            ? "Cambios pendientes"
            : "Sincronizado";
      const draftStatusTone = savingDraft
        ? "border-sky-300/50 bg-sky-500/10 text-sky-800 dark:text-sky-100"
        : draftError
          ? "border-rose-300/50 bg-rose-500/10 text-rose-700 dark:text-rose-200"
          : hasUnsavedChanges
            ? "border-amber-300/50 bg-amber-500/10 text-amber-800 dark:text-amber-200"
            : "border-emerald-300/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
      return (
        <div className="space-y-3">
          <div className={PANEL_CLASS}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cx(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  draftStatusTone,
                )}
              >
                {draftStatusLabel}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-300">
                Último guardado: {lastDraftSavedAt ? formatDateTime(lastDraftSavedAt) : "sin borrador"}
              </span>
            </div>
            {draftError ? (
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                {draftError}
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-4 justify-items-center gap-2">
              <button
                type="button"
                onClick={() => void saveDraftNow()}
                disabled={savingDraft}
                className={STUDIO_ICON_ACTION}
                title="Guardar ahora"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 21H4.5a1.5 1.5 0 0 1-1.5-1.5V5.56a1.5 1.5 0 0 1 .44-1.06l1.06-1.06A1.5 1.5 0 0 1 5.56 3H16.94a1.5 1.5 0 0 1 1.06.44l1.06 1.06a1.5 1.5 0 0 1 .44 1.06V19.5A1.5 1.5 0 0 1 19.5 21Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 3v5.25h7.5V3M8.25 21v-6h7.5v6"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void reloadDraft()}
                disabled={savingDraft}
                className={STUDIO_ICON_ACTION}
                title="Cargar último guardado"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 15.75v3a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-3M12 3.75v10.5m0 0 3.75-3.75M12 14.25 8.25 10.5"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={restoreBase}
                className={STUDIO_ICON_ACTION}
                title="Volver al contenido base"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 12a8.25 8.25 0 1 0 2.416-5.834M3.75 5.25v3.75h3.75"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void deleteDraft()}
                disabled={savingDraft || !lastDraftSavedAt}
                className="inline-flex size-10 items-center justify-center rounded-xl border border-rose-400/60 bg-rose-100/80 text-rose-700 shadow-sm transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-300/40 dark:bg-rose-500/15 dark:text-rose-200"
                title="Eliminar borrador"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                  />
                </svg>
              </button>
            </div>
            <div className="mt-2 grid grid-cols-4 justify-items-center gap-2 text-center text-[10px] text-slate-500 dark:text-slate-300">
              <span className="w-10">Guardar</span>
              <span className="w-10">Cargar</span>
              <span className="w-10">Base</span>
              <span className="w-10">Eliminar</span>
            </div>
          </div>
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
              Reutilizá bloques comerciales en otras cotizaciones.
            </p>
            <div className="mt-3 min-w-0 overflow-hidden">
              <TextPresetPicker
                token={token ?? null}
                docType="quote_budget"
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
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Recomendación de uso
            </h3>
            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
              <li>Guarda manualmente antes de descargar PDF o compartir por WhatsApp.</li>
              <li>Si editas desde otro equipo, usa &quot;Cargar último guardado&quot; para sincronizar.</li>
              <li>&quot;Volver al contenido base&quot; conserva la configuración del template y rehace el documento.</li>
            </ul>
          </div>
          <div className={PANEL_CLASS}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Estado comercial
              </h3>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {readinessDone}/{readinessChecks.length} completos
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/70">
              <div
                className="h-full rounded-full bg-sky-500 transition-all"
                style={{ width: `${readinessPercent}%` }}
              />
            </div>
            <div className="mt-3 space-y-1">
              {readinessChecks.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-lg border border-slate-300/50 bg-white/75 px-2.5 py-1.5 text-xs dark:border-slate-200/20 dark:bg-slate-900/55"
                >
                  <span className="text-slate-700 dark:text-slate-200">{item.label}</span>
                  <span
                    className={cx(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                      item.ok
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-200",
                    )}
                  >
                    {item.ok ? "OK" : "Pendiente"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className={PANEL_CLASS}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Resumen de la cotización
            </h3>
            <div className="mt-2 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <p>
                <b>Cliente:</b> {quoteSummary.clientName}
              </p>
              <p>
                <b>Salida:</b> {quoteSummary.departureDate} · <b>Regreso:</b> {quoteSummary.returnDate}
              </p>
              <p>
                <b>Pax:</b> {quoteSummary.paxCount} · <b>Servicios:</b> {quoteSummary.servicesCount}
              </p>
              <p>
                <b>Estado:</b> {isConverted ? "Convertida" : "Borrador en estudio"}
              </p>
              <p>
                <b>Venta estimada:</b> {quoteSummary.saleSummary}
              </p>
              <p>
                <b>Costo estimado:</b> {quoteSummary.costSummary}
              </p>
              <p>
                <b>Creada:</b> {formatDate(quoteCreationDate)} · <b>Actualizada:</b> {formatDate(quoteUpdatedAt)}
              </p>
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
        {loading ? (
          <div className="flex min-h-[55vh] items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-700 dark:text-rose-200">
            {error}
          </div>
        ) : !quote ? (
          <div className="rounded-3xl border border-slate-200/70 bg-white p-6 text-slate-700 shadow-sm shadow-sky-900/5 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            No se encontró la cotización.
          </div>
        ) : (
          <StudioShell
            eyebrow="Estudio de cotización"
            title={`Nº ${quoteDisplayId} · ${quoteSummary.clientName}`}
            badges={[
              {
                label: `Pax ${quoteSummary.paxCount}`,
                tone: "sky",
              },
              {
                label: `Servicios ${quoteSummary.servicesCount}`,
                tone: "slate",
              },
              ...(isConverted
                ? [{ label: "Convertida", tone: "emerald" as const }]
                : []),
            ]}
            backHref="/quotes"
            backLabel="Volver a cotizaciones"
            tabs={tabs}
            tabsVariant="icon"
            tabColumnsDesktop={3}
            tabColumnsMobile={3}
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
                docType="quote_budget"
                token={token}
                filename={`presupuesto-cotizacion-${quoteDisplayId}.pdf`}
                onPdfDownloaded={handlePdfDownloaded}
                toolbarMode="studio"
              />
            }
          />
        )}
      </section>
    </ProtectedRoute>
  );
}
