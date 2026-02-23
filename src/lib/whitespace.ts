// src/lib/whitespace.ts

/**
 * Normalización y utilidades de whitespace para PDF.
 * Objetivo:
 * - Quitar invisibles problemáticos (zero-width, bidi, BOM, etc.)
 * - Unificar saltos de línea (CRLF/CR -> LF)
 * - Mantener control sobre tabs y NBSP
 * - Limitar longitud para evitar desbordes del medidor de texto
 */

export const NBSP = "\u00A0";
export type Variant = "full" | "soft" | "hard";

const MAX_LEN_DEFAULT = 120_000;

// Invisibles/espacios problemáticos
const RE_ZERO_WIDTH = /[\u200B-\u200F\uFEFF\u202A-\u202E]/g; // zero-width & bidi
const RE_EXOTIC_SPACES = /[\u2000-\u200A\u202F\u205F\u3000]/g; // espacios "exóticos"
const RE_LINE_SEPARATORS = /[\u2028\u2029]/g; // LS/PS
const RE_CTRL_EXCEPT_TAB_LF = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g; // control salvo \t y \n

/** Devuelve `true` si es vacío o sólo whitespace. */
export const isBlank = (s?: string | null): boolean => !s || !String(s).trim();

/** Asegura longitud máxima (idempotente). */
export function safeSlice(s: string, maxLen = MAX_LEN_DEFAULT): string {
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Quita invisibles problemáticos. */
export function stripZeroWidth(s: string): string {
  return (s ?? "").replace(RE_ZERO_WIDTH, "");
}

/** Reemplaza espacios exóticos por espacio normal. */
export function replaceExoticSpaces(s: string): string {
  return s.replace(RE_EXOTIC_SPACES, " ");
}

/** Convierte separadores de línea Unicode a `\n`. */
export function normalizeUnicodeLineSeps(s: string): string {
  return s.replace(RE_LINE_SEPARATORS, "\n");
}

/** Elimina controles excepto tab y LF. */
export function stripCtrlExceptTabLf(s: string): string {
  return s.replace(RE_CTRL_EXCEPT_TAB_LF, " ");
}

/** Tabs -> NBSP×width (no se colapsan en PDF). */
export function expandTabs(s: string, width = 4): string {
  return s.replace(/\t/g, NBSP.repeat(width));
}

/**
 * Preserva espacios múltiples y leading spaces usando NBSP.
 * - Convierte espacios iniciales de cada línea a NBSP.
 * - Para runs de 2+ espacios internos, alterna NBSP y espacio normal
 *   para conservar visualmente el espaciado sin volver toda la secuencia
 *   no quebrable.
 */
export function preserveSpaces(s: string): string {
  if (!s) return s;
  let out = s.replace(/^ +/gm, (m) => NBSP.repeat(m.length));
  out = out.replace(/ {2,}/g, (m) =>
    m
      .split("")
      .map((_, i) => (i % 2 === 0 ? NBSP : " "))
      .join(""),
  );
  return out;
}

/** Normaliza saltos a `\n` y aplica limpieza básica. No toca tabs. */
export function baseNormalize(s?: string | null): string {
  let t = String(s ?? "");
  t = t.replace(/\r\n?/g, "\n"); // CRLF/CR -> LF
  t = stripZeroWidth(t);
  t = replaceExoticSpaces(t);
  t = normalizeUnicodeLineSeps(t);
  t = stripCtrlExceptTabLf(t);
  return t;
}

/** Single-line: `\n` -> espacio. Si queda vacío, NBSP. */
export function normalizeSingleLine(
  input?: string | null,
  opts?: { maxLen?: number },
): string {
  const maxLen = opts?.maxLen ?? MAX_LEN_DEFAULT;
  let t = baseNormalize(input);
  t = t.replace(/\n+/g, " ");
  // no expandimos tabs acá; lo hace el componente PdfSafeText
  if (!t.trim()) t = NBSP;
  return safeSlice(t, maxLen);
}

/** Multilinea “full”: conserva `\n` tal cual. */
export function normalizeMultilineFull(
  input?: string | null,
  opts?: { maxLen?: number },
): string {
  const maxLen = opts?.maxLen ?? MAX_LEN_DEFAULT;
  const t = baseNormalize(input);
  // no expandimos tabs acá; lo hace ParagraphSafe
  return safeSlice(t, maxLen);
}

/** Multilinea “soft”: recorta runs largos de líneas en blanco a 2. */
export function normalizeMultilineSoft(
  input?: string | null,
  opts?: { maxLen?: number },
): string {
  const maxLen = opts?.maxLen ?? MAX_LEN_DEFAULT;
  let t = baseNormalize(input);
  t = t.replace(/\n{3,}/g, "\n\n");
  // no expandimos tabs acá; lo hace ParagraphSafe
  return safeSlice(t, maxLen);
}

/** Helper por variante para bloques multilinea vs single-line. */
export function normalizeByVariant(
  input?: string | null,
  variant: Variant = "full",
  opts?: { maxLen?: number },
): string {
  if (variant === "hard") return normalizeSingleLine(input, opts);
  if (variant === "soft") return normalizeMultilineSoft(input, opts);
  return normalizeMultilineFull(input, opts);
}

/** toArray util seguro. */
export function toArray<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

/** Debug: contadores de caracteres “raros” para inspección. */
export function countWeirdChars(s: string) {
  return {
    len: s.length,
    lf: (s.match(/\n/g) || []).length,
    cr: (s.match(/\r/g) || []).length,
    nbsp: (s.match(/\u00A0/g) || []).length,
    tabs: (s.match(/\t/g) || []).length,
    zw: (s.match(RE_ZERO_WIDTH) || []).length,
    bidi: (s.match(/[\u202A-\u202E]/g) || []).length,
    exoticSpaces: (s.match(RE_EXOTIC_SPACES) || []).length,
    lineSeps: (s.match(RE_LINE_SEPARATORS) || []).length,
  };
}
