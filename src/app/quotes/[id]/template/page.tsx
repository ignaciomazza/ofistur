"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import TemplateConfigForm from "@/components/templates/TemplateConfigForm";
import TemplateEditor from "@/components/templates/TemplateEditor";
import type { OrderedBlock, TemplateConfig, TemplateFormValues } from "@/types/templates";
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
  lead_name?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  note?: string | null;
  booking_draft?: unknown;
  pax_drafts?: unknown;
  service_drafts?: unknown;
  custom_values?: unknown;
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
  return {
    blocks: blocks as OrderedBlock[],
    cover: isRecord(input.cover) ? (input.cover as TemplateFormValues["cover"]) : undefined,
    contact: isRecord(input.contact)
      ? (input.contact as TemplateFormValues["contact"])
      : undefined,
    payment: isRecord(input.payment)
      ? (input.payment as TemplateFormValues["payment"])
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

function formatOwnerName(user?: QuoteTemplateUser | null): string {
  if (!user) return "Sin responsable";
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  return fullName || "Sin responsable";
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
  const ownerName = formatOwnerName(quote.user);
  const quoteCurrency = cleanString(bookingDraft.currency || "ARS").toUpperCase() || "ARS";

  const blocks: OrderedBlock[] = [
    {
      id: "q_core_title",
      origin: "fixed",
      type: "heading",
      value: {
        type: "heading",
        level: 1,
        text: `Cotización Nº ${displayId}`,
      },
    },
    {
      id: "q_core_intro",
      origin: "fixed",
      type: "subtitle",
      value: {
        type: "subtitle",
        text: quote.lead_name || "Cliente sin nombre",
      },
    },
    {
      id: "q_core_summary",
      origin: "fixed",
      type: "keyValue",
      value: {
        type: "keyValue",
        pairs: [
          { key: "Cliente", value: quote.lead_name || "—" },
          { key: "Teléfono", value: quote.lead_phone || "—" },
          { key: "Email", value: quote.lead_email || "—" },
          { key: "Responsable", value: ownerName },
          { key: "Fecha de creación", value: formatDate(quote.creation_date) },
          { key: "Moneda base", value: quoteCurrency },
          { key: "Salida", value: formatDate(bookingDraft.departure_date) },
          { key: "Regreso", value: formatDate(bookingDraft.return_date) },
        ],
      },
    },
  ];

  if (cleanString(bookingDraft.details)) {
    blocks.push({
      id: "q_core_details",
      origin: "fixed",
      type: "paragraph",
      value: {
        type: "paragraph",
        text: bookingDraft.details || "",
      },
    });
  }

  if (cleanString(quote.note)) {
    blocks.push({
      id: "q_core_note_title",
      origin: "fixed",
      type: "subtitle",
      value: { type: "subtitle", text: "Observaciones internas" },
    });
    blocks.push({
      id: "q_core_note",
      origin: "fixed",
      type: "paragraph",
      value: { type: "paragraph", text: quote.note || "" },
    });
  }

  blocks.push({
    id: "q_core_pax_title",
    origin: "fixed",
    type: "heading",
    value: { type: "heading", level: 1, text: "Pasajeros" },
  });
  blocks.push({
    id: "q_core_pax_count",
    origin: "fixed",
    type: "paragraph",
    value: { type: "paragraph", text: `Cantidad de pasajeros: ${paxDrafts.length}` },
  });

  if (paxDrafts.length === 0) {
    blocks.push({
      id: "q_core_pax_empty",
      origin: "fixed",
      type: "paragraph",
      value: { type: "paragraph", text: "Sin pasajeros cargados." },
    });
  } else {
    paxDrafts.forEach((pax, index) => {
      const center = [pax.phone, pax.email].filter((v) => cleanString(v)).join(" · ") || "—";
      const right = [
        pax.is_titular ? "Titular" : "Acompañante",
        pax.birth_date ? `Nac: ${formatDate(pax.birth_date)}` : "",
        pax.nationality ? `Nac.: ${pax.nationality}` : "",
      ]
        .filter((v) => cleanString(v))
        .join(" · ");
      blocks.push({
        id: `q_core_pax_${index}`,
        origin: "fixed",
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
    origin: "fixed",
    type: "heading",
    value: { type: "heading", level: 1, text: "Servicios" },
  });

  if (serviceDrafts.length === 0) {
    blocks.push({
      id: "q_core_services_empty",
      origin: "fixed",
      type: "paragraph",
      value: { type: "paragraph", text: "Sin servicios cargados." },
    });
  } else {
    serviceDrafts.forEach((service, index) => {
      const left = [
        `${index + 1}. ${service.type || "Servicio"}`,
        service.destination ? `Destino: ${service.destination}` : "",
        service.reference ? `Ref: ${service.reference}` : "",
      ]
        .filter((value) => cleanString(value))
        .join("\n");
      const center = service.description || service.note || "—";
      const right = [
        `Venta: ${formatMoney(toAmount(service.sale_price), service.currency || quoteCurrency)}`,
        `Costo: ${formatMoney(toAmount(service.cost_price), service.currency || quoteCurrency)}`,
      ].join("\n");

      blocks.push({
        id: `q_core_service_${index}`,
        origin: "fixed",
        type: "threeColumns",
        value: {
          type: "threeColumns",
          left,
          center,
          right,
        },
      });
    });
  }

  blocks.push({
    id: "q_core_totals",
    origin: "fixed",
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
    if (value == null) return false;
    if (typeof value === "string") return cleanString(value).length > 0;
    if (typeof value === "number" || typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.length > 0;
    return false;
  });

  if (customEntries.length > 0) {
    blocks.push({
      id: "q_core_custom_title",
      origin: "fixed",
      type: "heading",
      value: { type: "heading", level: 1, text: "Campos personalizados" },
    });
    blocks.push({
      id: "q_core_custom_values",
      origin: "fixed",
      type: "keyValue",
      value: {
        type: "keyValue",
        pairs: customEntries.map(([key, value]) => ({
          key,
          value:
            Array.isArray(value) ? value.map((item) => String(item)).join(", ") : String(value),
        })),
      },
    });
  }

  return blocks;
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
  const draftStorageKey = useMemo(() => toDraftStorageKey(quoteId), [quoteId]);

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
      const savedDraft = readDraftFromStorage(toDraftStorageKey(quoteId));

      setQuote(quoteJson);
      setCfg(resolvedCfg);
      setBaseFormValue(baseValue);
      setFormValue(savedDraft?.value ?? baseValue);
      setLastDraftSavedAt(savedDraft?.saved_at || null);
      setDraftReady(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al cargar la cotización.";
      setError(msg);
      setQuote(null);
      setCfg(EMPTY_CFG);
      setFormValue(EMPTY_VALUE);
      setBaseFormValue(EMPTY_VALUE);
      setLastDraftSavedAt(null);
      setDraftReady(false);
    } finally {
      setLoading(false);
    }
  }, [token, quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!draftReady || !draftStorageKey || !quote) return;
    const timeout = window.setTimeout(() => {
      const savedAt = writeDraftToStorage(draftStorageKey, formValue);
      if (savedAt) setLastDraftSavedAt(savedAt);
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [draftReady, draftStorageKey, formValue, quote]);

  const saveDraftNow = useCallback(() => {
    const savedAt = writeDraftToStorage(draftStorageKey, formValue);
    if (savedAt) setLastDraftSavedAt(savedAt);
  }, [draftStorageKey, formValue]);

  const restoreBase = useCallback(() => {
    setFormValue(baseFormValue);
  }, [baseFormValue]);

  const reloadDraft = useCallback(() => {
    const savedDraft = readDraftFromStorage(draftStorageKey);
    if (!savedDraft) return;
    setFormValue(savedDraft.value);
    setLastDraftSavedAt(savedDraft.saved_at || null);
  }, [draftStorageKey]);

  const deleteDraft = useCallback(() => {
    removeDraftFromStorage(draftStorageKey);
    setLastDraftSavedAt(null);
  }, [draftStorageKey]);

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

  return (
    <ProtectedRoute>
      <section className="mx-auto p-6 text-slate-950 dark:text-white">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              Cotización Nº {quoteDisplayId}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
              Armá el presupuesto en PDF con funciones propias de cotizaciones y bloques editables.
            </p>
          </div>
          <Link
            href="/quotes"
            className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-950 shadow-sm shadow-sky-900/5 transition hover:scale-[0.98] dark:bg-sky-500/20 dark:text-sky-100"
          >
            Volver a cotizaciones
          </Link>
        </div>

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
          <div className="space-y-6">
            <div className={PANEL_CLASS}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-300">
                    Cotización
                  </p>
                  <p className="text-lg font-semibold">
                    {quoteSummary.clientName} - Nº {quoteDisplayId}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                    Salida: {quoteSummary.departureDate} · Regreso:{" "}
                    {quoteSummary.returnDate}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                    Creada: {formatDate(quote.creation_date)} · Actualizada:{" "}
                    {formatDate(quote.updated_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/5 px-3 py-1 text-sky-900 dark:text-sky-200">
                    Pax: {quoteSummary.paxCount}
                  </span>
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/5 px-3 py-1 text-sky-900 dark:text-sky-200">
                    Servicios: {quoteSummary.servicesCount}
                  </span>
                  <span
                    className="max-w-72 truncate rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-900 dark:text-emerald-200"
                    title={`Venta estimada: ${quoteSummary.saleSummary}`}
                  >
                    Venta: {quoteSummary.saleSummary}
                  </span>
                  <span
                    className="max-w-72 truncate rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-900 dark:text-amber-200"
                    title={`Costo estimado: ${quoteSummary.costSummary}`}
                  >
                    Costo: {quoteSummary.costSummary}
                  </span>
                </div>
              </div>
            </div>

            <div className={PANEL_CLASS}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Borrador PDF</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-300">
                    Guardá y recuperá cambios del armado de esta cotización.
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                    {lastDraftSavedAt
                      ? `Último guardado: ${formatDateTime(lastDraftSavedAt)}`
                      : "Sin borrador guardado para esta cotización."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={saveDraftNow}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/90 px-4 py-2 text-xs font-medium text-emerald-900 shadow-sm shadow-emerald-900/10 transition hover:scale-[0.98] dark:border-emerald-100/70 dark:bg-emerald-500/20 dark:text-emerald-100"
                  >
                    Guardar borrador
                  </button>
                  <button
                    type="button"
                    onClick={reloadDraft}
                    disabled={!lastDraftSavedAt}
                    className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-medium text-sky-950 shadow-sm shadow-sky-900/5 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500/20 dark:text-sky-100"
                  >
                    Cargar borrador
                  </button>
                  <button
                    type="button"
                    onClick={restoreBase}
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium text-slate-700 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] dark:text-slate-100"
                  >
                    Restaurar base
                  </button>
                  <button
                    type="button"
                    onClick={deleteDraft}
                    disabled={!lastDraftSavedAt}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-500/55 bg-rose-200/20 px-4 py-2 text-xs font-medium text-rose-700 shadow-sm shadow-rose-950/20 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-300/55 dark:bg-rose-300/20 dark:text-rose-200"
                  >
                    Eliminar borrador
                  </button>
                </div>
              </div>
            </div>
            <div>
              <div className="mb-4 px-1">
                <h2 className="text-base font-semibold">Personalización</h2>
                <p className="text-sm text-slate-500 dark:text-slate-300">
                  Elegí portada, contacto y forma de pago para el presupuesto de
                  esta cotización.
                </p>
              </div>
              <TemplateConfigForm
                cfg={cfg}
                value={formValue}
                onChange={setFormValue}
                token={token}
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
                docType="quote_budget"
                token={token}
                filename={`presupuesto-cotizacion-${quoteDisplayId}.pdf`}
              />
            </div>
          </div>
        )}
      </section>
    </ProtectedRoute>
  );
}
