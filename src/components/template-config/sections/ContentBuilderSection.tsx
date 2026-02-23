// src/components/template-config/sections/ContentBuilderSection.tsx
"use client";

import React, { useMemo } from "react";
import { getAt, normalizeKey, section, setAt, isObject } from "./_helpers";
import { Config } from "../types";
import {
  BLOCK_TEXT_SIZE_OPTIONS,
  BLOCK_TEXT_WEIGHT_OPTIONS,
  resolveBlockTextStyle,
  sanitizeBlockTextStyle,
} from "@/lib/blockTextStyle";
import type {
  BlockTextSize,
  BlockTextStyle,
  BlockTextWeight,
} from "@/types/templates";

/** ===== Tipos de bloque ===== */
type BlockType =
  | "heading"
  | "subtitle"
  | "paragraph"
  | "list"
  | "keyValue"
  | "twoColumns"
  | "threeColumns";

type BlockMode = "fixed" | "form";

/** Estilo especial para Mupu por bloque (solo textos fijos) */
type MupuStyle = {
  color?: string; // hex/css; si no está, hereda del preset
  /** para keyValue: a qué aplicar */
  target?: "all" | "keys" | "values";
};

type BaseBlock = {
  id: string;
  type: BlockType;
  mode: BlockMode;
  label?: string;
  fieldKey?: string;
  /** Solo visible/usable por la agencia Mupu (id=1) cuando el bloque es fijo */
  mupuStyle?: MupuStyle;
  textStyle?: BlockTextStyle;
};

type HeadingBlock = BaseBlock & { type: "heading"; text?: string; level?: 1 | 2 | 3 };
type SubtitleBlock = BaseBlock & { type: "subtitle"; text?: string };
type ParagraphBlock = BaseBlock & { type: "paragraph"; text?: string };
type ListBlock = BaseBlock & { type: "list"; items?: string[] };
type KeyValueBlock = BaseBlock & { type: "keyValue"; pairs?: { key: string; value: string }[] };
type TwoColumnsBlock = BaseBlock & { type: "twoColumns"; left?: string; right?: string };
type ThreeColumnsBlock = BaseBlock & {
  type: "threeColumns";
  left?: string;
  center?: string;
  right?: string;
};

type ContentBlock =
  | HeadingBlock
  | SubtitleBlock
  | ParagraphBlock
  | ListBlock
  | KeyValueBlock
  | TwoColumnsBlock
  | ThreeColumnsBlock;

function isBlock(v: unknown): v is ContentBlock {
  if (!isObject(v)) return false;
  const t = (v as Record<string, unknown>)["type"];
  return (
    t === "heading" ||
    t === "subtitle" ||
    t === "paragraph" ||
    t === "list" ||
    t === "keyValue" ||
    t === "twoColumns" ||
    t === "threeColumns"
  );
}

const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Titulo",
  subtitle: "Subtitulo",
  paragraph: "Parrafo",
  list: "Lista",
  keyValue: "Clave/Valor",
  twoColumns: "Dos columnas",
  threeColumns: "Tres columnas",
};

const AddBlockButton: React.FC<
  React.PropsWithChildren<{ onAdd: () => void; disabled?: boolean }>
> = ({ onAdd, disabled, children }) => (
  <button
    type="button"
    onClick={onAdd}
    disabled={disabled}
    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-700 shadow-sm shadow-sky-950/10 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:text-white"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
    {children}
  </button>
);

type Props = {
  cfg: Config;
  disabled: boolean;
  onChange: (next: Config) => void;
};

const ContentBuilderSection: React.FC<Props> = ({ cfg, disabled, onChange }) => {
  const blocks = useMemo(
    () =>
      (getAt<unknown[]>(cfg, ["content", "blocks"], []) || []).filter(
        isBlock,
      ) as ContentBlock[],
    [cfg],
  );

  const setBlocks = (next: ContentBlock[]) =>
    onChange(setAt(cfg, ["content", "blocks"], next));

  const patchBlockTextStyle = (
    id: string,
    next: { size: BlockTextSize; weight: BlockTextWeight },
  ) => {
    const nextBlocks = blocks.map((b) =>
      b.id === id ? { ...b, textStyle: next } : b,
    );
    setBlocks(nextBlocks);
  };

  /** ===== CRUD de bloques ===== */
  const addBlock = (type: BlockType) => {
    const id = `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const count = blocks.filter((b) => b.type === type).length + 1;
    const label = `${BLOCK_LABELS[type]} ${count}`;
    const base: BaseBlock = {
      id,
      type,
      mode: "fixed",
      label,
      fieldKey: normalizeKey(label, `${type}_${id.slice(-4)}`),
    };

    let byType: ContentBlock;
    switch (type) {
      case "heading":
        byType = { ...base, type, text: "Título", level: 1 };
        break;
      case "subtitle":
        byType = { ...base, type, text: "Subtítulo" };
        break;
      case "paragraph":
        byType = { ...base, type, text: "Texto del párrafo" };
        break;
      case "list":
        byType = { ...base, type, items: ["Ítem 1", "Ítem 2"] };
        break;
      case "keyValue":
        byType = { ...base, type, pairs: [{ key: "Clave", value: "Valor" }] };
        break;
      case "twoColumns":
        byType = { ...base, type, left: "Izquierda", right: "Derecha" };
        break;
      case "threeColumns":
        byType = {
          ...base,
          type,
          left: "Izquierda",
          center: "Centro",
          right: "Derecha",
        };
        break;
      default:
        byType = base as ContentBlock;
        break;
    }

    setBlocks([...blocks, byType]);
  };

  return (
    <section className={section}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="inline-flex size-8 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-700 shadow-sm shadow-amber-900/10 dark:border-amber-400/20 dark:text-amber-300">
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
                  d="M8.25 6.75h12m-12 6h12m-12 6h12M3.75 6.75h.008v.008H3.75V6.75Zm0 6h.008v.008H3.75V12.75Zm0 6h.008v.008H3.75V18.75Z"
                />
              </svg>
            </span>
            Contenido del documento
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
            Editá el contenido en la vista previa, arrastrá los bloques y cambiá
            Fijo/Formulario desde ahí.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddBlockButton onAdd={() => addBlock("heading")} disabled={disabled}>
            Título
          </AddBlockButton>
          <AddBlockButton onAdd={() => addBlock("subtitle")} disabled={disabled}>
            Subtítulo
          </AddBlockButton>
          <AddBlockButton onAdd={() => addBlock("paragraph")} disabled={disabled}>
            Párrafo
          </AddBlockButton>
          <AddBlockButton onAdd={() => addBlock("list")} disabled={disabled}>
            Lista
          </AddBlockButton>
          <AddBlockButton onAdd={() => addBlock("keyValue")} disabled={disabled}>
            Clave/Valor
          </AddBlockButton>
          <AddBlockButton onAdd={() => addBlock("twoColumns")} disabled={disabled}>
            Dos columnas
          </AddBlockButton>
          <AddBlockButton onAdd={() => addBlock("threeColumns")} disabled={disabled}>
            Tres columnas
          </AddBlockButton>
        </div>
      </div>

      {blocks.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-300">
          No hay secciones aún. Agregá un bloque para empezar.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-300">
            Bloques activos en la vista previa: {blocks.length}
          </p>

          <div className="grid gap-2">
            {blocks.map((b, idx) => {
              const headingLevel = b.type === "heading" ? b.level ?? 1 : undefined;
              const textStyle = resolveBlockTextStyle({
                type: b.type,
                headingLevel,
                textStyle: sanitizeBlockTextStyle(b.textStyle),
              });
              const blockLabel = b.label || `${BLOCK_LABELS[b.type]} ${idx + 1}`;

              return (
                <div
                  key={b.id}
                  className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs"
                >
                  <span className="min-w-[170px] font-medium">{blockLabel}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
                    {b.type}
                  </span>
                  <label className="ml-auto inline-flex items-center gap-1">
                    <span className="opacity-70">Tamano</span>
                    <select
                      value={textStyle.size}
                      disabled={disabled}
                      onChange={(e) =>
                        patchBlockTextStyle(b.id, {
                          size: e.target.value as BlockTextSize,
                          weight: textStyle.weight,
                        })
                      }
                      className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs"
                    >
                      {BLOCK_TEXT_SIZE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <span className="opacity-70">Peso</span>
                    <select
                      value={textStyle.weight}
                      disabled={disabled}
                      onChange={(e) =>
                        patchBlockTextStyle(b.id, {
                          size: textStyle.size,
                          weight: e.target.value as BlockTextWeight,
                        })
                      }
                      className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs"
                    >
                      {BLOCK_TEXT_WEIGHT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export default ContentBuilderSection;
