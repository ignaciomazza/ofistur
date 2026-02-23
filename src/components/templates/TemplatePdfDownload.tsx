// src/components/templates/TemplatePdfDownload.tsx
"use client";

import React, { useCallback, useMemo, useState } from "react";
import { pdf } from "@react-pdf/renderer";
import {
  Variant,
  isBlank,
  toArray,
  normalizeSingleLine,
  normalizeMultilineFull,
  normalizeMultilineSoft,
  countWeirdChars,
} from "@/lib/whitespace";
import { sanitizeBlockTextStyle } from "@/lib/blockTextStyle";
import TemplatePdfDocument from "./TemplatePdfDocument";
import type { TemplateConfig, ContentBlock, Agency } from "@/types/templates";

/* ========================================================================
 * Tipos mínimos
 * ====================================================================== */

type MinimalUser = {
  first_name?: string;
  last_name?: string;
  email?: string;
};

export type TemplatePdfDownloadProps = {
  /** Nombre del archivo PDF (sin path) */
  fileName?: string;
  /** Configuración visual seleccionada */
  cfg: TemplateConfig;
  /** Agencia (logo, colores, contacto) */
  agency?: Partial<Agency>;
  /** Vendedor/a */
  user?: Partial<MinimalUser>;

  /**
   * Contenido a renderizar.
   * Acepta:
   *  - ContentBlock[]
   *  - PresetBlock[] (como viene en data.data.blocks)
   *  - El item completo del preset (con data.data.blocks)
   *  - El payload de /api/text-preset **(tomará items[0])**
   */
  blocks?: unknown;

  /** Bloques adicionales a concatenar al final (opcional) */
  appendBlocks?: unknown;

  /** Parcheo rápido por id (opcional) */
  patchById?: Record<string, Partial<ContentBlock>>;

  /** Título/chip del documento (p.ej. “Cotización”) */
  docLabel?: string;
  /** URL de la portada seleccionada (opcional) */
  selectedCoverUrl?: string;
  /** Texto “Forma de pago” (opcional) */
  paymentSelected?: string;
  /** Mostrar logs de diagnóstico (default true en dev) */
  debug?: boolean;
  /** Estilos del botón */
  className?: string;
  /** Contenido del botón (default “Descargar PDF”) */
  children?: React.ReactNode;
};

/* ========================================================================
 * PRESET → ContentBlock
 * ====================================================================== */

type PresetMode = "form" | "fixed" | "extra" | string;
type PresetKeyValuePair = { key?: string; value?: string };
type PresetValue = {
  type?: string;
  text?: string;
  left?: string;
  right?: string;
  center?: string;
  textStyle?: unknown;
  items?: unknown[];
  pairs?: PresetKeyValuePair[];
};
type PresetBlock = {
  id?: string;
  type: ContentBlock["type"] | string;
  origin?: PresetMode;
  label?: string;
  value?: PresetValue;
  left?: string;
  right?: string;
  center?: string;
  textStyle?: unknown;
  items?: unknown[];
  pairs?: PresetKeyValuePair[];
};
type PresetItem = {
  data?: { data?: { blocks?: PresetBlock[] } };
};

const genId = () => "b_" + Math.random().toString(36).slice(2, 10);
const ensureId = (id?: string) => String(id ?? genId());

function unwrapBlocks(anyInput: unknown): unknown[] {
  if (Array.isArray(anyInput)) return anyInput;
  const obj = anyInput as Record<string, unknown>;
  const data = (obj?.["data"] as Record<string, unknown>) || undefined;
  const dd = (data?.["data"] as Record<string, unknown>) || undefined;
  const maybeBlocks1 = dd?.["blocks"];
  if (Array.isArray(maybeBlocks1)) return maybeBlocks1 as unknown[];
  const items = (obj?.["items"] as PresetItem[]) || [];
  const maybeBlocks2 = items?.[0]?.data?.data?.blocks;
  if (Array.isArray(maybeBlocks2)) return maybeBlocks2 as unknown[];
  return [];
}
function looksLikePresetBlock(b: unknown): boolean {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  // Si viene con `mode` asumimos que ya es ContentBlock válido
  if ("mode" in o) return false;
  return "value" in o || "origin" in o || "label" in o;
}
function mapOriginToMode(origin?: string): ContentBlock["mode"] {
  return origin === "form" ? "form" : "fixed";
}
function presetToContentBlock(rb: unknown): ContentBlock | null {
  const b = rb as PresetBlock;
  const type = String(b?.type ?? "") as ContentBlock["type"];
  const mode = mapOriginToMode(b?.origin);
  const isForm = mode === "form";
  const textStyle = sanitizeBlockTextStyle(b?.textStyle ?? b?.value?.textStyle);

  switch (type) {
    case "heading": {
      const text = b?.value?.text ?? b?.label ?? "";
      if (isBlank(text)) return null;
      return {
        id: ensureId(b.id),
        type: "heading",
        text,
        level: 1,
        mode,
        textStyle,
      };
    }
    case "subtitle": {
      const text = b?.value?.text ?? b?.label ?? "";
      if (isBlank(text)) return null;
      return { id: ensureId(b.id), type: "subtitle", text, mode, textStyle };
    }
    case "paragraph": {
      const text = b?.value?.text ?? "";
      if (isBlank(text) && isForm) return null;
      return { id: ensureId(b.id), type: "paragraph", text, mode, textStyle };
    }
    case "twoColumns": {
      const left = b?.value?.left ?? b?.left ?? "";
      const right = b?.value?.right ?? b?.right ?? "";
      if (isBlank(left) && isBlank(right) && isForm) return null;
      return {
        id: ensureId(b.id),
        type: "twoColumns",
        left,
        right,
        mode,
        textStyle,
      };
    }
    case "threeColumns": {
      const left = b?.value?.left ?? b?.left ?? "";
      const center = b?.value?.center ?? b?.center ?? "";
      const right = b?.value?.right ?? b?.right ?? "";
      if (isBlank(left) && isBlank(center) && isBlank(right) && isForm)
        return null;
      return {
        id: ensureId(b.id),
        type: "threeColumns",
        left,
        center,
        right,
        mode,
        textStyle,
      };
    }
    case "keyValue": {
      const pairsSrc =
        (Array.isArray(b?.value?.pairs) ? b?.value?.pairs : b?.pairs) ?? [];
      const pairs = pairsSrc
        .map((p): { key: string; value: string } => ({
          key: String(p?.key ?? ""),
          value: String(p?.value ?? ""),
        }))
        .filter((p) => !isBlank(p.key) || !isBlank(p.value));
      if (pairs.length === 0 && isForm) return null;
      return { id: ensureId(b.id), type: "keyValue", pairs, mode, textStyle };
    }
    case "list": {
      const itemsSrc =
        (Array.isArray(b?.value?.items) ? b?.value?.items : b?.items) ?? [];
      const items = itemsSrc.map((x) => (x == null ? "" : String(x)));
      if (items.length === 0 && isForm) return null;
      return { id: ensureId(b.id), type: "list", items, mode, textStyle };
    }
    default:
      return null;
  }
}
function toContentBlocks(input: unknown): ContentBlock[] {
  const raw = unwrapBlocks(input);
  if (!Array.isArray(raw) || raw.length === 0) {
    return Array.isArray(input) ? (input as ContentBlock[]) : [];
  }
  if (looksLikePresetBlock(raw[0])) {
    return raw
      .map((x) => presetToContentBlock(x))
      .filter(Boolean) as ContentBlock[];
  }
  return raw as ContentBlock[];
}
function applyPatches(
  blocks: ContentBlock[],
  patchById?: Record<string, Partial<ContentBlock>>,
): ContentBlock[] {
  if (!patchById) return blocks;
  return blocks.map((b) => {
    const p = patchById[b.id];
    return p ? ({ ...b, ...p, id: b.id, type: b.type } as ContentBlock) : b;
  });
}

function sanitizeBlocks(blocks: ContentBlock[] | undefined, variant: Variant) {
  const src = toArray(blocks);

  return src.map((b) => {
    switch (b.type) {
      case "heading":
        return { ...b, text: normalizeSingleLine(b.text ?? "") };

      case "subtitle":
        return { ...b, text: normalizeSingleLine(b.text ?? "") };

      case "paragraph": {
        const t =
          variant === "hard"
            ? normalizeSingleLine(b.text ?? "")
            : variant === "soft"
              ? normalizeMultilineSoft(b.text ?? "")
              : normalizeMultilineFull(b.text ?? "");
        return { ...b, text: t };
      }

      case "list": {
        const items = toArray(b.items).map((it) =>
          variant === "hard"
            ? normalizeSingleLine(it)
            : variant === "soft"
              ? normalizeMultilineSoft(it)
              : normalizeMultilineFull(it),
        );
        return { ...b, items };
      }

      case "keyValue": {
        const pairs = toArray(b.pairs).map((p) => ({
          key: normalizeSingleLine(p.key ?? ""),
          value: normalizeSingleLine(p.value ?? ""),
        }));
        return { ...b, pairs };
      }

      case "twoColumns": {
        const left =
          variant === "hard"
            ? normalizeSingleLine(b.left ?? "")
            : variant === "soft"
              ? normalizeMultilineSoft(b.left ?? "")
              : normalizeMultilineFull(b.left ?? "");
        const right =
          variant === "hard"
            ? normalizeSingleLine(b.right ?? "")
            : variant === "soft"
              ? normalizeMultilineSoft(b.right ?? "")
              : normalizeMultilineFull(b.right ?? "");
        return { ...b, left, right };
      }

      case "threeColumns": {
        const left =
          variant === "hard"
            ? normalizeSingleLine(b.left ?? "")
            : variant === "soft"
              ? normalizeMultilineSoft(b.left ?? "")
              : normalizeMultilineFull(b.left ?? "");
        const center =
          variant === "hard"
            ? normalizeSingleLine(b.center ?? "")
            : variant === "soft"
              ? normalizeMultilineSoft(b.center ?? "")
              : normalizeMultilineFull(b.center ?? "");
        const right =
          variant === "hard"
            ? normalizeSingleLine(b.right ?? "")
            : variant === "soft"
              ? normalizeMultilineSoft(b.right ?? "")
              : normalizeMultilineFull(b.right ?? "");
        return { ...b, left, center, right };
      }

      default:
        return b;
    }
  });
}

/* ========================================================================
 * Logs y helpers
 * ====================================================================== */

function logContentOverview(blocks: ContentBlock[]) {
  const rows: Array<Record<string, unknown>> = [];
  const push = (idx: number, type: string, field: string, s: string) => {
    rows.push({
      idx,
      type: `'${type}'`,
      field: `'${field}'`,
      ...countWeirdChars(s),
    });
  };
  blocks.forEach((b, i) => {
    switch (b.type) {
      case "heading":
        push(i, "heading", "text", b.text ?? "");
        break;
      case "subtitle":
        push(i, "subtitle", "text", b.text ?? "");
        break;
      case "paragraph":
        push(i, "paragraph", "text", b.text ?? "");
        break;
      case "list":
        toArray(b.items).forEach((it, k) => push(i, "list", `items[${k}]`, it));
        break;
      case "keyValue":
        toArray(b.pairs).forEach((p, k) => {
          push(i, "keyValue", `pairs[${k}].key`, p.key ?? "");
          push(i, "keyValue", `pairs[${k}].value`, p.value ?? "");
        });
        break;
      case "twoColumns":
        push(i, "twoColumns", "left", b.left ?? "");
        push(i, "twoColumns", "right", b.right ?? "");
        break;
      case "threeColumns":
        push(i, "threeColumns", "left", b.left ?? "");
        push(i, "threeColumns", "center", b.center ?? "");
        push(i, "threeColumns", "right", b.right ?? "");
        break;
      default:
        break;
    }
  });
  console.table(rows);
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function hasMessage(e: unknown): e is { message: unknown } {
  return typeof e === "object" && e !== null && "message" in e;
}
const isDataViewRangeError = (err: unknown) => {
  const m = hasMessage(err) ? err.message : typeof err === "string" ? err : "";
  return (
    /DataView RangeError/i.test(String(m)) ||
    /Offset is outside/i.test(String(m))
  );
};
/* ========================================================================
 * Búsqueda de bloque ofensivo (texto)
 * ====================================================================== */

async function findOffenderBlock(
  baseProps: Omit<TemplatePdfDownloadProps, "blocks">,
  blocks: ContentBlock[],
): Promise<number | null> {
  const src = toArray(blocks);
  for (let i = 0; i < src.length; i++) {
    try {
      const doc = (
        <TemplatePdfDocument
          rCfg={baseProps.cfg}
          rAgency={baseProps.agency ?? {}}
          rUser={baseProps.user ?? {}}
          blocks={[src[i]]}
          docLabel={baseProps.docLabel ?? "Documento"}
          selectedCoverUrl={baseProps.selectedCoverUrl || ""}
          paymentSelected={baseProps.paymentSelected}
        />
      );
      await pdf(doc).toBlob();
    } catch (e) {
      if (isDataViewRangeError(e)) return i;
    }
  }
  return null;
}

/* ========================================================================
 * Component
 * ====================================================================== */

const TemplatePdfDownload: React.FC<TemplatePdfDownloadProps> = (props) => {
  const {
    cfg,
    agency = {},
    user = {},
    blocks: blocksInput,
    appendBlocks,
    patchById,
    docLabel = "Documento",
    selectedCoverUrl = "",
    paymentSelected,
    debug = process.env.NODE_ENV !== "production",
    fileName = `${(docLabel || "documento").toLowerCase().replace(/\s+/g, "-")}-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`,
    className,
    children,
  } = props;

  const [busy, setBusy] = useState(false);

  // Fallbacks desde cfg
  const selectedCoverUrlFromCfg = cfg?.coverImage?.url || "";
  const paymentSelectedFromCfg = useMemo(() => {
    const opts = cfg?.paymentOptions ?? [];
    const idx = cfg?.payment?.selectedIndex ?? -1;
    return idx >= 0 && idx < opts.length ? opts[idx] : undefined;
  }, [cfg]);

  // 1) Content blocks (fallback a cfg.content.blocks)
  const baseBlocks = useMemo<ContentBlock[]>(
    () => toContentBlocks(blocksInput ?? cfg?.content?.blocks),
    [blocksInput, cfg],
  );
  const appended = useMemo<ContentBlock[]>(
    () => baseBlocks.concat(toContentBlocks(appendBlocks)),
    [baseBlocks, appendBlocks],
  );
  const effectiveBlocks: ContentBlock[] = useMemo(
    () => applyPatches(appended, patchById),
    [appended, patchById],
  );

  const baseDocProps = useMemo(
    () => ({
      cfg,
      agency,
      user,
      docLabel,
      selectedCoverUrl: selectedCoverUrl ?? selectedCoverUrlFromCfg,
      paymentSelected: paymentSelected ?? paymentSelectedFromCfg,
    }),
    [
      cfg,
      agency,
      user,
      docLabel,
      selectedCoverUrl,
      selectedCoverUrlFromCfg,
      paymentSelected,
      paymentSelectedFromCfg,
    ],
  );

  const buildOnce = useCallback(
    async (variant: Variant, why: string) => {
      const sanitized = sanitizeBlocks(effectiveBlocks, variant);

      if (debug) {
        console.groupCollapsed(
          `%c[PDF] build (${variant}) – ${why}`,
          "color:#0ea5e9",
        );
        console.log("[PDF] blocks (src):", effectiveBlocks.length);
        console.log("[PDF] blocks (sanitized):", sanitized.length);
        console.log("[PDF] docLabel:", docLabel);
        console.log(
          "[PDF] paymentSelected:",
          Boolean(paymentSelected ?? paymentSelectedFromCfg) ? "true" : "false",
        );
        console.log("[PDF] content overview (char counters)");
        logContentOverview(sanitized);
        console.groupEnd();
      }

      const doc = (
        <TemplatePdfDocument
          rCfg={cfg}
          rAgency={{ ...(agency || {}), logo_url: agency.logo_url }}
          rUser={user}
          blocks={sanitized}
          docLabel={docLabel}
          selectedCoverUrl={selectedCoverUrl ?? selectedCoverUrlFromCfg}
          paymentSelected={paymentSelected ?? paymentSelectedFromCfg}
        />
      );

      const blob = await pdf(doc).toBlob();
      return blob;
    },
    [
      effectiveBlocks,
      cfg,
      agency,
      user,
      docLabel,
      selectedCoverUrl,
      selectedCoverUrlFromCfg,
      paymentSelected,
      paymentSelectedFromCfg,
      debug,
    ],
  );

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);

    try {
      if (!Array.isArray(effectiveBlocks) || effectiveBlocks.length === 0) {
        alert(
          "No hay contenido para generar el PDF.\n\n" +
            "Tip: podés pasar ContentBlock[] (tu state), el item del preset, o `data.data.blocks`. También podés usar `appendBlocks` y `patchById`.",
        );
        return;
      }

      // 1) Multilínea completa
      try {
        const blob = await buildOnce("full", "multilínea completa");
        saveBlob(blob, fileName);
        return;
      } catch (e) {
        if (debug)
          console.warn("[PDF] FAIL (full):", hasMessage(e) ? e.message : e);
        if (!isDataViewRangeError(e)) throw e;
      }

      // 2) Soft (recorta saltos en blanco)
      try {
        const blob = await buildOnce("soft", "recorte de saltos en blanco");
        saveBlob(blob, fileName);
        return;
      } catch (e) {
        if (debug)
          console.warn("[PDF] FAIL (soft):", hasMessage(e) ? e.message : e);
        if (!isDataViewRangeError(e)) throw e;
      }

      // 3) Hard (single-line)
      try {
        const blob = await buildOnce("hard", "forzado single-line");
        saveBlob(blob, fileName);
        return;
      } catch (e) {
        if (debug)
          console.warn("[PDF] FAIL (hard):", hasMessage(e) ? e.message : e);
        if (!isDataViewRangeError(e)) throw e;
      }

      // 5) Diagnóstico por bloque (texto)
      if (debug) console.log("[PDF][DIAG] starting offender search…");
      const fullSanitized = sanitizeBlocks(effectiveBlocks, "full");
      const offenderIdx = await findOffenderBlock(baseDocProps, fullSanitized);
      if (offenderIdx != null && offenderIdx >= 0 && debug) {
        const b = fullSanitized[offenderIdx]!;
        console.warn(
          "[PDF][DIAG] offending block index=%d, type=%s",
          offenderIdx,
          b.type,
        );
      }

      // 6) Si igualmente falla…
      throw new Error(
        "No se pudo generar el PDF (posible imagen o fuente inválida).",
      );
    } catch (finalErr) {
      console.error("[PDF] Fatal error:", finalErr);
      alert(
        "No se pudo generar el PDF.\n\n" +
          (finalErr instanceof Error ? finalErr.message : String(finalErr)),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, effectiveBlocks, buildOnce, baseDocProps, fileName, debug]);

  return (
    <button
      type="button"
      className={
        className ??
        "mt-4 rounded-full border border-amber-500/20 bg-amber-500/10 px-6 py-2 text-amber-700 shadow-sm shadow-amber-900/10 transition-transform hover:scale-95 active:scale-90 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300"
      }
      onClick={handleDownload}
      disabled={busy}
      title="Generar y descargar PDF"
    >
      {busy ? "Generando…" : (children ?? "Descargar PDF")}
    </button>
  );
};

export default TemplatePdfDownload;
