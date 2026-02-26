// src/components/templates/BlocksCanvas.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from "react";
import { Reorder, useDragControls } from "framer-motion";
import type {
  OrderedBlock,
  BlockFormValue,
  BlockTextSize,
  BlockTextStyle,
  BlockTextWeight,
} from "@/types/templates";
import {
  BLOCK_TEXT_SIZE_CLASS,
  BLOCK_TEXT_SIZE_OPTIONS,
  BLOCK_TEXT_WEIGHT_CLASS,
  BLOCK_TEXT_WEIGHT_OPTIONS,
  blockTextWeightToCss,
  resolveBlockTextStyle,
} from "@/lib/blockTextStyle";
import type { BlocksCanvasProps, CanvasOptions } from "./TemplateEditor";

/* ============================================================================
 * Utils
 * ========================================================================== */

const cx = (...c: Array<string | false | null | undefined>) =>
  c.filter(Boolean).join(" ");

const CONTROL_BAR_CLASS = "transition-colors";

const CONTROL_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] shadow-sm backdrop-blur transition";

const WS_PRESERVE: React.CSSProperties = {
  whiteSpace: "break-spaces",
  tabSize: 4,
};

function wsFor(multiline: boolean): React.CSSProperties {
  // Para single-line (título, subtítulo) evitamos break-spaces
  return multiline ? WS_PRESERVE : { whiteSpace: "pre-wrap", tabSize: 4 };
}

/** Normaliza saltos/espacios problemáticos */
function sanitizeText(raw: string): string {
  let s = raw ?? "";
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/\u2028|\u2029/g, "\n");
  s = s.replace(/\u00A0/g, " ");
  s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
  return s;
}

const BLOCK_TAGS = new Set(["DIV", "P"]);

function serializeEditable(el: HTMLElement): string {
  const out: string[] = [];
  const pushNewline = () => out.push("\n");
  const endsWithNewline = () => {
    const last = out[out.length - 1];
    return !!last && last.endsWith("\n");
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const elNode = node as HTMLElement;
    const tag = elNode.tagName;

    if (tag === "BR") {
      pushNewline();
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (!isBlock) {
      node.childNodes.forEach(walk);
      return;
    }

    // Para bloques (DIV/P):
    // - Conservamos saltos internos (incluye BR).
    // - Aseguramos exactamente un salto de fin de bloque, salvo que ya exista.
    const before = out.length;
    node.childNodes.forEach(walk);
    const blockProducedContent = out.length > before;
    if (!blockProducedContent) {
      pushNewline();
      return;
    }
    if (!endsWithNewline()) pushNewline();
  };

  el.childNodes.forEach(walk);
  let text = out.join("");
  text = text.replace(/\n+$/g, "");
  return text;
}

function readEditableText(el: HTMLDivElement, multiline: boolean): string {
  const raw = (el.textContent ?? "").toString();
  if (!multiline) return raw;
  const serialized = serializeEditable(el);
  return serialized.length ? serialized : raw;
}

function placeCaretAtEnd(el: HTMLElement) {
  try {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection?.();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {}
}

/* ============================================================================
 * Tipos + patchValue
 * ========================================================================== */

type HeadingV = Extract<BlockFormValue, { type: "heading" }>;
type SubtitleV = Extract<BlockFormValue, { type: "subtitle" }>;
type ParagraphV = Extract<BlockFormValue, { type: "paragraph" }>;
type ListV = Extract<BlockFormValue, { type: "list" }>;
type KeyValueV = Extract<BlockFormValue, { type: "keyValue" }>;
type TwoColsV = Extract<BlockFormValue, { type: "twoColumns" }>;
type ThreeColsV = Extract<BlockFormValue, { type: "threeColumns" }>;

function patchValueForTypeLocal(
  b: OrderedBlock,
  patch:
    | Partial<HeadingV>
    | Partial<SubtitleV>
    | Partial<ParagraphV>
    | Partial<ListV>
    | Partial<KeyValueV>
    | Partial<TwoColsV>
    | Partial<ThreeColsV>,
): BlockFormValue {
  const existing = b.value;
  switch (b.type) {
    case "heading": {
      const ex: HeadingV = (existing as HeadingV) ?? {
        type: "heading",
        text: "",
        level: 1,
      };
      return {
        type: "heading",
        text: ex.text ?? "",
        level: 1,
        ...(patch as Partial<HeadingV>),
      };
    }
    case "subtitle": {
      const ex: SubtitleV = (existing as SubtitleV) ?? {
        type: "subtitle",
        text: "",
      };
      return {
        type: "subtitle",
        text: ex.text ?? "",
        ...(patch as Partial<SubtitleV>),
      };
    }
    case "paragraph": {
      const ex: ParagraphV = (existing as ParagraphV) ?? {
        type: "paragraph",
        text: "",
      };
      return {
        type: "paragraph",
        text: ex.text ?? "",
        ...(patch as Partial<ParagraphV>),
      };
    }
    case "list": {
      const ex: ListV = (existing as ListV) ?? { type: "list", items: [] };
      return {
        type: "list",
        items: Array.isArray(ex.items) ? ex.items : [],
        ...(patch as Partial<ListV>),
      };
    }
    case "keyValue": {
      const ex: KeyValueV = (existing as KeyValueV) ?? {
        type: "keyValue",
        pairs: [],
      };
      return {
        type: "keyValue",
        pairs: Array.isArray(ex.pairs) ? ex.pairs : [],
        ...(patch as Partial<KeyValueV>),
      };
    }
    case "twoColumns": {
      const ex: TwoColsV = (existing as TwoColsV) ?? {
        type: "twoColumns",
        left: "",
        right: "",
      };
      return {
        type: "twoColumns",
        left: ex.left ?? "",
        right: ex.right ?? "",
        ...(patch as Partial<TwoColsV>),
      };
    }
    case "threeColumns": {
      const ex: ThreeColsV = (existing as ThreeColsV) ?? {
        type: "threeColumns",
        left: "",
        center: "",
        right: "",
      };
      return {
        type: "threeColumns",
        left: ex.left ?? "",
        center: ex.center ?? "",
        right: ex.right ?? "",
        ...(patch as Partial<ThreeColsV>),
      };
    }
  }
}

/* ============================================================================
 * Editable (semi-controlado)
 * ========================================================================== */

type EditableProps = {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  multiline?: boolean; // default true
  style?: React.CSSProperties;
  "data-testid"?: string;

  onEnter?: () => void;
  onShiftEnter?: () => void;
  onBackspaceEmpty?: () => void;
  onArrowUpAtStart?: () => void;
  onArrowDownAtEnd?: () => void;
};

const EditableText = forwardRef<HTMLDivElement, EditableProps>(
  (
    {
      value,
      onChange,
      className,
      placeholder,
      readOnly,
      multiline = true,
      style,
      "data-testid": testId,
      onEnter,
      onShiftEnter,
      onBackspaceEmpty,
      onArrowUpAtStart,
      onArrowDownAtEnd,
    },
    ref,
  ) => {
    const localRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      const el = localRef.current;
      if (!el) return;
      const domText = sanitizeText(readEditableText(el, !!multiline));
      if (domText !== value) el.textContent = value || "";
    }, [value, multiline]);

    const setRefs = (el: HTMLDivElement | null): void => {
      localRef.current = el;
      if (typeof ref === "function") {
        ref(el);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }
    };

    const handleInput: React.FormEventHandler<HTMLDivElement> = (e) => {
      if (readOnly) return;
      let raw = readEditableText(e.currentTarget, !!multiline);
      if (!multiline) raw = raw.replace(/\n+/g, " "); // fuerza single-line
      onChange(sanitizeText(raw));
    };

    const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = (e) => {
      if (readOnly) return;
      e.preventDefault();
      let text = e.clipboardData.getData("text/plain") || "";
      if (!multiline) text = text.replace(/\s*\n+\s*/g, " ");
      document.execCommand("insertText", false, sanitizeText(text));
    };

    const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
      const el = localRef.current!;
      if (!el) return;

      const syncAfterInput = () => {
        requestAnimationFrame(() => {
          let next = sanitizeText(readEditableText(el, !!multiline));
          if (!multiline) next = next.replace(/\n+/g, " ");
          onChange(next);
        });
      };
      const insertAndSync = (text: string) => {
        document.execCommand?.("insertText", false, text);
        syncAfterInput();
      };

      if (e.key === "Enter") {
        if (e.shiftKey && onShiftEnter) {
          e.preventDefault();
          onShiftEnter();
          if (multiline) syncAfterInput();
          return;
        }
        if (!multiline || onEnter) {
          e.preventDefault();
          onEnter?.();
          return;
        }
        // default multiline
        e.preventDefault();
        insertAndSync("\n");
        return;
      }

      if (e.key === "Backspace" && onBackspaceEmpty) {
        if ((el.textContent || "").trim().length === 0) {
          e.preventDefault();
          onBackspaceEmpty();
          return;
        }
      }

      if (e.key === "ArrowUp" && onArrowUpAtStart) {
        const atStart =
          (window.getSelection?.()?.getRangeAt(0)?.startOffset ?? 0) === 0;
        if (atStart) {
          e.preventDefault();
          onArrowUpAtStart();
          return;
        }
      }
      if (e.key === "ArrowDown" && onArrowDownAtEnd) {
        const len = (el.textContent || "").length;
        const sel = window.getSelection?.();
        const end =
          !!sel && sel.rangeCount > 0 && sel.getRangeAt(0).endOffset === len;
        if (end) {
          e.preventDefault();
          onArrowDownAtEnd();
          return;
        }
      }

      if (e.key === "Tab") {
        e.preventDefault();
        insertAndSync("\t");
      }
    };

    const showGhost = !value.trim();
    const wsStyle = wsFor(!!multiline);

    return (
      <div className="relative -mx-1 block w-full rounded-lg px-1 transition">
        {showGhost && placeholder ? (
          <div
            className={cx(
              "pointer-events-none absolute inset-0 select-none opacity-40",
              className,
            )}
            style={{ ...style, ...wsStyle }}
          >
            {placeholder}
          </div>
        ) : null}

        <div
          ref={setRefs}
          data-testid={testId}
          role="textbox"
          contentEditable={!readOnly}
          suppressContentEditableWarning
          className={cx(
            "block w-full outline-none",
            multiline ? "min-h-[1.6em]" : "min-h-[1.4em]",
            className,
          )}
          style={{ ...style, ...wsStyle }}
          onInput={handleInput}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          spellCheck
        />
      </div>
    );
  },
);
EditableText.displayName = "EditableText";

/* ============================================================================
 * Block wrapper (drag & actions)
 * ========================================================================== */

type BlockItemProps = {
  block: OrderedBlock;
  label?: string;
  mode: "fixed" | "form";
  canToggleMode: boolean;
  canRemove: boolean;
  canEdit: boolean;
  onRemove?: () => void;
  onToggleMode?: (id: string, next: "fixed" | "form") => void;
  textSize: BlockTextSize;
  textWeight: BlockTextWeight;
  onTextStyleChange?: (next: BlockTextStyle) => void;
  canStyle: boolean;
  options: CanvasOptions;
  showMeta: boolean;
  children: React.ReactNode;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragMove: (y: number) => void;
  isDraggingAny: boolean;
  isDraggingSelf: boolean;
  itemRef?: React.Ref<HTMLDivElement>;
};

const BlockItem: React.FC<BlockItemProps> = ({
  block,
  label,
  mode,
  canToggleMode,
  canRemove,
  canEdit,
  onRemove,
  onToggleMode,
  textSize,
  textWeight,
  onTextStyleChange,
  canStyle,
  options,
  showMeta,
  children,
  onDragStart,
  onDragEnd,
  onDragMove,
  isDraggingAny,
  isDraggingSelf,
  itemRef,
}) => {
  const controls = useDragControls();
  const showLabel = Boolean(label);
  const showToggle = canToggleMode && Boolean(onToggleMode);
  const controlsOnDarkSurface = options.controlsOnDarkSurface;
  const controlBarToneClass = controlsOnDarkSurface
    ? "text-slate-100"
    : "text-slate-600";
  const controlChipClass = cx(
    CONTROL_CHIP_CLASS,
    controlsOnDarkSurface
      ? "border-white/35 bg-white/20 text-slate-100 hover:bg-white/28"
      : "border-slate-900/15 bg-white/70 text-slate-700 hover:bg-white/85",
  );
  const controlChipMutedClass = controlsOnDarkSurface
    ? "text-slate-200/85"
    : "text-slate-500";
  const controlDangerClass = controlsOnDarkSurface
    ? "inline-flex items-center gap-1 rounded-full border border-rose-300/45 bg-rose-500/25 px-2 py-1 text-xs text-rose-100 shadow-sm backdrop-blur transition hover:bg-rose-500/35"
    : "inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/12 px-2 py-1 text-xs text-rose-700 shadow-sm backdrop-blur transition hover:bg-rose-500/18";
  const controlDangerMetaClass = controlsOnDarkSurface
    ? "inline-flex items-center gap-1 rounded-full border border-rose-300/45 bg-rose-500/25 px-2 py-1 text-[11px] text-rose-100 shadow-sm backdrop-blur transition hover:bg-rose-500/35"
    : "inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/12 px-2 py-1 text-[11px] text-rose-700 shadow-sm backdrop-blur transition hover:bg-rose-500/18";
  const controlIconBadgeClass = controlsOnDarkSurface
    ? "inline-flex size-4 items-center justify-center rounded-full border border-white/30 bg-white/20 text-slate-100"
    : "inline-flex size-4 items-center justify-center rounded-full border border-slate-900/15 bg-white/75 text-slate-600";
  const controlWeightBadgeClass = controlsOnDarkSurface
    ? "inline-flex size-4 items-center justify-center rounded-full border border-white/30 bg-white/20 text-[10px] font-black text-slate-100"
    : "inline-flex size-4 items-center justify-center rounded-full border border-slate-900/15 bg-white/75 text-[10px] font-black text-slate-700";
  const controlSelectClass = controlsOnDarkSurface
    ? "rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[10px] text-slate-100 outline-none ring-sky-200/40 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
    : "rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[10px] text-slate-700 outline-none ring-sky-200/60 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60";
  const controlSelectStyle: React.CSSProperties = {
    colorScheme: controlsOnDarkSurface ? "dark" : "light",
    backgroundColor: controlsOnDarkSurface
      ? "rgba(255,255,255,0.24)"
      : "rgba(255,255,255,0.92)",
    color: controlsOnDarkSurface ? "#F8FAFC" : "#334155",
    borderRadius: 9999,
  };
  const controlOptionStyle: React.CSSProperties = {
    backgroundColor: controlsOnDarkSurface ? "#0F172A" : "#FFFFFF",
    color: controlsOnDarkSurface ? "#F8FAFC" : "#334155",
  };
  const isMultilinePdfSensitiveBlock =
    block.type === "paragraph" ||
    block.type === "list" ||
    block.type === "twoColumns" ||
    block.type === "threeColumns";
  const showPdfDoubleLineBreakWarning =
    canStyle &&
    isMultilinePdfSensitiveBlock &&
    (textSize !== "base" || textWeight !== "normal");
  const pdfDoubleLineBreakWarningClass = controlsOnDarkSurface
    ? "text-rose-200/95"
    : "text-rose-700";
  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
      target.closest(
        'input, textarea, select, button, a, [contenteditable="true"]',
      ),
    );
  };
  const getClientY = (
    event: MouseEvent | TouchEvent | PointerEvent,
  ): number => {
    if ("touches" in event && event.touches[0]) {
      return event.touches[0].clientY;
    }
    if ("changedTouches" in event && event.changedTouches[0]) {
      return event.changedTouches[0].clientY;
    }
    return (event as MouseEvent | PointerEvent).clientY ?? 0;
  };

  return (
    <Reorder.Item
      value={block.id}
      ref={itemRef}
      dragListener={false}
      dragControls={controls}
      dragElastic={0.18}
      dragMomentum={false}
      layout="position"
      animate={{
        opacity: isDraggingAny && !isDraggingSelf ? 0.85 : 1,
        scale: isDraggingSelf ? 1.015 : 1,
        rotate: isDraggingSelf ? 0.2 : 0,
        boxShadow: isDraggingSelf
          ? "0 18px 36px rgba(0,0,0,0.16)"
          : "0 0 0 rgba(0,0,0,0)",
      }}
      transition={{
        type: "spring",
        stiffness: 360,
        damping: 32,
        mass: 0.8,
      }}
      className="group"
      style={{
        touchAction: isDraggingAny ? "none" : "auto",
        zIndex: isDraggingSelf ? 20 : "auto",
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDrag={(e, info) => {
        const clientY = getClientY(e);
        onDragMove(Number.isFinite(clientY) ? clientY : info.point.y);
      }}
    >
      <div
        className="relative"
        onPointerDown={(e) => {
          if (e.button !== 0 || isInteractiveTarget(e.target)) return;
          e.preventDefault();
          controls.start(e);
        }}
      >
        {!showMeta && (
          <div
            className={cx(
              "absolute -right-2 -top-2 z-10 hidden items-center gap-1 group-focus-within:flex group-hover:flex",
              CONTROL_BAR_CLASS,
              controlBarToneClass,
            )}
          >
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                controls.start(e);
              }}
              className={cx(controlChipClass, "px-2 py-1 text-xs")}
              title="Arrastrar para mover"
              aria-label="Arrastrar para mover"
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
                  d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
                />
              </svg>
            </button>
            {showToggle && onToggleMode ? (
              <button
                type="button"
                onClick={() =>
                  onToggleMode(block.id, mode === "fixed" ? "form" : "fixed")
                }
                className={cx(controlChipClass, "px-2 py-1")}
                title={mode === "fixed" ? "Desbloquear bloque" : "Bloquear bloque"}
                aria-label={mode === "fixed" ? "Desbloquear bloque" : "Bloquear bloque"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                >
                  {mode === "fixed" ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.5 10.5V7.875a4.125 4.125 0 0 0-8.25 0v2.625m11.25 0H4.5v8.25h15v-8.25Z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M18.75 10.5H6.75v8.25h12V10.5Zm-6-6.75a4.125 4.125 0 0 0-4.125 4.125v2.625"
                    />
                  )}
                </svg>
              </button>
            ) : !canRemove ? (
              <span
                className={cx(
                  controlChipClass,
                  controlChipMutedClass,
                  "px-2 py-1 opacity-80",
                )}
                title={
                  canEdit
                    ? "Bloque fijo: no se puede eliminar"
                    : "Bloque fijo: no editable"
                }
              >
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
                    d="M16.5 10.5V7.875a4.125 4.125 0 0 0-8.25 0v2.625m11.25 0H4.5v8.25h15v-8.25Z"
                  />
                </svg>
              </span>
            ) : null}
            {canRemove ? (
              <button
                type="button"
                onClick={onRemove}
                className={controlDangerClass}
                title="Quitar bloque"
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
                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                  />
                </svg>
                Quitar
              </button>
            ) : null}
          </div>
        )}

        <div
          className={cx(
            "rounded-xl px-3 transition-colors hover:bg-white/5",
            options.blockPaddingYClass ?? "py-2",
          )}
          style={{ border: `1px solid ${options.dividerColor}` }}
        >
          {showMeta && (
            <div
              className={cx(
                "mb-2 flex flex-wrap items-center gap-2",
                CONTROL_BAR_CLASS,
                controlBarToneClass,
              )}
            >
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  controls.start(e);
                }}
                className={cx(
                  controlChipClass,
                  "cursor-grab px-2 py-1 active:cursor-grabbing",
                )}
                title="Arrastrar para mover"
                aria-label="Arrastrar para mover"
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
                    d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
                  />
                </svg>
                Mover
              </button>

              {showLabel && (
                <span className={cx(controlChipClass, "px-2 py-0.5")}>
                  {label}
                </span>
              )}

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {showToggle && onToggleMode ? (
                  <button
                    type="button"
                    onClick={() =>
                      onToggleMode(block.id, mode === "fixed" ? "form" : "fixed")
                    }
                    className={cx(controlChipClass, "px-2 py-1")}
                    title={mode === "fixed" ? "Desbloquear bloque" : "Bloquear bloque"}
                    aria-label={mode === "fixed" ? "Desbloquear bloque" : "Bloquear bloque"}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                    >
                      {mode === "fixed" ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.5 10.5V7.875a4.125 4.125 0 0 0-8.25 0v2.625m11.25 0H4.5v8.25h15v-8.25Z"
                        />
                      ) : (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M18.75 10.5H6.75v8.25h12V10.5Zm-6-6.75a4.125 4.125 0 0 0-4.125 4.125v2.625"
                        />
                      )}
                    </svg>
                  </button>
                ) : null}

                {canRemove ? (
                  <button
                    type="button"
                    onClick={onRemove}
                    className={controlDangerMetaClass}
                    title="Quitar bloque"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="size-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                      />
                    </svg>
                  </button>
                ) : (
                  <span
                    className={cx(
                      controlChipClass,
                      controlChipMutedClass,
                      "px-2 py-0.5",
                    )}
                    title={
                      canEdit
                        ? "Bloque fijo: no se puede eliminar"
                        : "Bloque fijo: no editable"
                    }
                  >
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
                        d="M16.5 10.5V7.875a4.125 4.125 0 0 0-8.25 0v2.625m11.25 0H4.5v8.25h15v-8.25Z"
                      />
                    </svg>
                  </span>
                )}
              </div>
            </div>
          )}

          <div
            className={cx(
              "mb-2 flex flex-wrap items-center gap-1.5 text-[10px]",
              CONTROL_BAR_CLASS,
              controlBarToneClass,
            )}
          >
            <label className={cx(controlChipClass, "gap-1 pr-0.5")}>
              <span className={controlIconBadgeClass}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 19.5h15M7.5 4.5h9m-4.5 0v15"
                  />
                </svg>
              </span>
              <select
                value={textSize}
                onChange={(e) =>
                  onTextStyleChange?.({
                    size: e.target.value as BlockTextSize,
                    weight: textWeight,
                  })
                }
                disabled={!canStyle}
                className={controlSelectClass}
                style={controlSelectStyle}
              >
                {BLOCK_TEXT_SIZE_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    style={controlOptionStyle}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={cx(controlChipClass, "gap-1 pr-0.5")}>
              <span className={controlWeightBadgeClass}>
                B
              </span>
              <select
                value={textWeight}
                onChange={(e) =>
                  onTextStyleChange?.({
                    size: textSize,
                    weight: e.target.value as BlockTextWeight,
                  })
                }
                disabled={!canStyle}
                className={controlSelectClass}
                style={controlSelectStyle}
              >
                {BLOCK_TEXT_WEIGHT_OPTIONS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    style={controlOptionStyle}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* {showPdfDoubleLineBreakWarning && (
            <p
              className={cx(
                "mb-2 text-[11px] leading-snug",
                pdfDoubleLineBreakWarningClass,
              )}
            >
              Aviso: al usar tamano o peso distinto de Base/Normal, el motor PDF
              puede no respetar los dobles saltos de linea.
            </p>
          )} */}

          {children}
        </div>
      </div>
    </Reorder.Item>
  );
};

/* ============================================================================
 * Render por tipo
 * ========================================================================== */

function HeadingEditor({
  b,
  onPatch,
  options,
  readOnly,
  textSizeClass,
  textWeight,
}: {
  b: OrderedBlock;
  onPatch: (patch: Partial<BlockFormValue>) => void;
  options: CanvasOptions;
  readOnly: boolean;
  textSizeClass: string;
  textWeight: BlockTextWeight;
}) {
  const hv = (b.value as HeadingV) ?? { type: "heading", text: "", level: 1 };

  return (
    <div className="flex items-start gap-2">
      <EditableText
        value={hv.text ?? ""}
        onChange={(text) => onPatch({ text, level: 1 })}
        className={cx(textSizeClass, "py-1 leading-snug")}
        placeholder="Escribí el título…"
        readOnly={readOnly}
        multiline={false}
        style={{
          fontFamily: options.headingFont,
          fontWeight: blockTextWeightToCss(textWeight),
        }}
      />
    </div>
  );
}

function SubtitleEditor({
  b,
  onPatch,
  readOnly,
  textClass,
}: {
  b: OrderedBlock;
  onPatch: (patch: Partial<BlockFormValue>) => void;
  readOnly: boolean;
  textClass: string;
}) {
  const sv = (b.value as SubtitleV) ?? { type: "subtitle", text: "" };
  return (
    <EditableText
      value={sv.text ?? ""}
      onChange={(text) => onPatch({ text })}
      className={cx(textClass, "opacity-95")}
      placeholder="Escribí el subtítulo…"
      readOnly={readOnly}
      multiline={false}
    />
  );
}

function ParagraphEditor({
  b,
  onPatch,
  readOnly,
  textClass,
}: {
  b: OrderedBlock;
  onPatch: (patch: Partial<BlockFormValue>) => void;
  readOnly: boolean;
  textClass: string;
}) {
  const pv = (b.value as ParagraphV) ?? { type: "paragraph", text: "" };
  return (
    <EditableText
      value={pv.text ?? ""}
      onChange={(text) => onPatch({ text })}
      className={cx(textClass, "leading-relaxed")}
      placeholder="Párrafo… (Enter para salto de línea, Tab para tabular)"
      readOnly={readOnly}
      multiline
      onShiftEnter={() => document.execCommand?.("insertText", false, "\n")}
    />
  );
}

/* ===== Lista =============================================================== */

function ListEditor({
  b,
  onPatch,
  options,
  readOnly,
  textClass,
}: {
  b: OrderedBlock;
  onPatch: (patch: Partial<BlockFormValue>) => void;
  options: CanvasOptions;
  readOnly: boolean;
  textClass: string;
}) {
  const lv = (b.value as ListV) ?? { type: "list", items: [] };
  const items: string[] = Array.isArray(lv.items) ? lv.items : [];
  const listControlChipClass = options.controlsOnDarkSurface
    ? "rounded-full border border-white/30 bg-white/20 px-2 py-1 text-xs text-slate-100 transition hover:bg-white/28"
    : "rounded-full border border-slate-900/15 bg-white/70 px-2 py-1 text-xs text-slate-700 transition hover:bg-white/85";
  const listAddClass = options.controlsOnDarkSurface
    ? "inline-flex items-center gap-1 rounded-full border border-emerald-300/35 bg-emerald-500/20 px-2 py-1 text-xs text-emerald-100 shadow-sm transition hover:opacity-90"
    : "inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 shadow-sm shadow-emerald-900/10 transition hover:opacity-90";

  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const setItemRef =
    (i: number) =>
    (el: HTMLDivElement | null): void => {
      itemRefs.current[i] = el;
    };
  const focusItem = (i: number) => {
    const el = itemRefs.current[i];
    if (el) {
      placeCaretAtEnd(el);
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const update = (i: number, next: string) => {
    const arr = [...items];
    arr[i] = next;
    onPatch({ items: arr });
  };

  const addAt = (index: number) => {
    const arr = [...items];
    arr.splice(index, 0, "");
    onPatch({ items: arr });
    requestAnimationFrame(() => focusItem(index));
  };
  const addEnd = () => addAt(items.length);

  const delAt = (i: number) => {
    const arr = items.filter((_, idx) => idx !== i);
    onPatch({ items: arr });
    const to = Math.max(0, i - 1);
    requestAnimationFrame(() => focusItem(to));
  };

  const move = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= items.length) return;
    const arr = [...items];
    const [it] = arr.splice(from, 1);
    arr.splice(to, 0, it);
    onPatch({ items: arr });
    requestAnimationFrame(() => focusItem(to));
  };

  return (
    <ul className={cx("list-disc pl-5", options.listSpaceClass)}>
      {items.map((it, i) => (
        <li key={i}>
          <div className="flex items-start gap-2">
            <EditableText
              ref={setItemRef(i)}
              value={it}
              onChange={(t) => update(i, t)}
              className={cx("flex-1", textClass)}
              placeholder={`Ítem ${i + 1}`}
              readOnly={readOnly}
              multiline={false}
              onEnter={() => !readOnly && addAt(i + 1)}
              onShiftEnter={() =>
                !readOnly && document.execCommand?.("insertText", false, "\n")
              }
              onBackspaceEmpty={() => !readOnly && delAt(i)}
            />
            {!readOnly && (
              <div className="flex items-center gap-1 pt-1">
                <button
                  className={listControlChipClass}
                  onClick={() => move(i, -1)}
                  title="Subir"
                >
                  ↑
                </button>
                <button
                  className={listControlChipClass}
                  onClick={() => move(i, 1)}
                  title="Bajar"
                >
                  ↓
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-full bg-red-600/80 px-2 py-1 text-xs text-white hover:bg-red-600"
                  onClick={() => delAt(i)}
                  title="Quitar ítem"
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
                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    />
                  </svg>
                  Quitar
                </button>
              </div>
            )}
          </div>
        </li>
      ))}
      {!readOnly && (
        <li>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              className={listAddClass}
              onClick={addEnd}
              title="Agregar ítem"
            >
              + Agregar ítem
            </button>
            <span className="text-[11px] opacity-60">
              Enter = nuevo • Shift+Enter = salto • Backspace vacío = borrar
            </span>
          </div>
        </li>
      )}
    </ul>
  );
}

/* ===== Clave/Valor ========================================================= */

function KeyValueEditor({
  b,
  onPatch,
  readOnly,
  panelBg,
  innerRadiusClass,
  controlsOnDarkSurface,
  textClass,
}: {
  b: OrderedBlock;
  onPatch: (patch: Partial<BlockFormValue>) => void;
  readOnly: boolean;
  panelBg: string;
  innerRadiusClass: string;
  controlsOnDarkSurface: boolean;
  textClass: string;
}) {
  const kv = (b.value as KeyValueV) ?? { type: "keyValue", pairs: [] };
  const pairs: Array<{ key: string; value: string }> = Array.isArray(kv.pairs)
    ? kv.pairs
    : [];
  const rowActionClass = controlsOnDarkSurface
    ? "rounded-full border border-white/30 bg-white/20 px-2 py-1 text-xs text-slate-100 transition hover:bg-white/28"
    : "rounded-full border border-slate-900/15 bg-white/70 px-2 py-1 text-xs text-slate-700 transition hover:bg-white/85";
  const addRowClass = controlsOnDarkSurface
    ? "inline-flex w-max items-center gap-1 rounded-full border border-emerald-300/35 bg-emerald-500/20 px-3 py-1 text-xs text-emerald-100 shadow-sm transition hover:opacity-90"
    : "inline-flex w-max items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700 shadow-sm shadow-emerald-900/10 transition hover:opacity-90";

  const keyRefs = useRef<Array<HTMLDivElement | null>>([]);
  const valRefs = useRef<Array<HTMLDivElement | null>>([]);

  const setKeyRef =
    (i: number) =>
    (el: HTMLDivElement | null): void => {
      keyRefs.current[i] = el;
    };
  const setValRef =
    (i: number) =>
    (el: HTMLDivElement | null): void => {
      valRefs.current[i] = el;
    };

  const focusKey = (i: number) => {
    const el = keyRefs.current[i];
    if (el) placeCaretAtEnd(el);
  };
  const focusVal = (i: number) => {
    const el = valRefs.current[i];
    if (el) placeCaretAtEnd(el);
  };

  const update = (i: number, field: "key" | "value", next: string) => {
    const arr = [...pairs];
    arr[i] = { ...arr[i], [field]: next };
    onPatch({ pairs: arr });
  };

  const addAt = (index: number) => {
    const arr = [...pairs];
    arr.splice(index, 0, { key: "", value: "" });
    onPatch({ pairs: arr });
    requestAnimationFrame(() => focusKey(index));
  };
  const addEnd = () => addAt(pairs.length);

  const delAt = (i: number) => {
    const arr = pairs.filter((_, idx) => idx !== i);
    onPatch({ pairs: arr });
    const to = Math.max(0, i - 1);
    requestAnimationFrame(() => focusVal(to));
  };

  return (
    <div className="grid gap-2">
      {pairs.map((p, i) => (
        <div
          key={i}
          className={cx(
            "grid grid-cols-[1fr_1fr_auto] items-start gap-2",
            innerRadiusClass,
            "p-2",
          )}
          style={{ backgroundColor: panelBg }}
        >
          <EditableText
            ref={setKeyRef(i)}
            value={p.key}
            onChange={(t) => update(i, "key", t)}
            className={textClass}
            placeholder="Clave"
            readOnly={readOnly}
            multiline={false}
            onEnter={() => !readOnly && focusVal(i)}
            onBackspaceEmpty={() => {
              if (readOnly) return;
              if (!p.key.trim() && !p.value.trim()) delAt(i);
            }}
          />
          <EditableText
            ref={setValRef(i)}
            value={p.value}
            onChange={(t) => update(i, "value", t)}
            className={textClass}
            placeholder="Valor"
            readOnly={readOnly}
            multiline={false}
            onEnter={() => !readOnly && addAt(i + 1)}
            onShiftEnter={() =>
              !readOnly && document.execCommand?.("insertText", false, "\n")
            }
            onBackspaceEmpty={() => {
              if (readOnly) return;
              if (!p.value.trim() && !p.key.trim()) delAt(i);
            }}
          />
          {!readOnly && (
            <div className="flex items-center gap-1 pt-1">
              <button
                className={rowActionClass}
                onClick={() => addAt(i + 1)}
                title="Agregar debajo"
              >
                + Fila
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-full bg-red-600/80 px-2 py-1 text-xs text-white hover:bg-red-600"
                onClick={() => delAt(i)}
                title="Quitar fila"
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
                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                  />
                </svg>
                Quitar
              </button>
            </div>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            className={addRowClass}
            onClick={addEnd}
            title="Agregar fila"
          >
            + Agregar fila
          </button>
          <span className="text-[11px] opacity-60">
            Enter (clave→valor / valor→nueva) • Shift+Enter = salto • Backspace
            vacío = borrar
          </span>
        </div>
      )}
    </div>
  );
}

/* ===== Dos y Tres columnas ================================================= */

function TwoColsEditor({
  b,
  onPatch,
  readOnly,
  panelBg,
  innerRadiusClass,
  options,
  textClass,
}: {
  b: OrderedBlock;
  onPatch: (patch: Partial<BlockFormValue>) => void;
  readOnly: boolean;
  panelBg: string;
  innerRadiusClass: string;
  options: CanvasOptions;
  textClass: string;
}) {
  const tv = (b.value as TwoColsV) ?? {
    type: "twoColumns",
    left: "",
    right: "",
  };
  return (
    <div className={cx("grid md:grid-cols-2", options.gapGridClass)}>
      <div
        className={cx("p-3", innerRadiusClass)}
        style={{ backgroundColor: panelBg }}
      >
        <EditableText
          value={tv.left ?? ""}
          onChange={(left) => onPatch({ left })}
          className={textClass}
          placeholder="Columna izquierda…"
          readOnly={readOnly}
        />
      </div>
      <div
        className={cx("p-3", innerRadiusClass)}
        style={{ backgroundColor: panelBg }}
      >
        <EditableText
          value={tv.right ?? ""}
          onChange={(right) => onPatch({ right })}
          className={textClass}
          placeholder="Columna derecha…"
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

function ThreeColsEditor({
  b,
  onPatch,
  readOnly,
  panelBg,
  innerRadiusClass,
  options,
  textClass,
}: {
  b: OrderedBlock;
  onPatch: (patch: Partial<BlockFormValue>) => void;
  readOnly: boolean;
  panelBg: string;
  innerRadiusClass: string;
  options: CanvasOptions;
  textClass: string;
}) {
  const tv = (b.value as ThreeColsV) ?? {
    type: "threeColumns",
    left: "",
    center: "",
    right: "",
  };
  return (
    <div className={cx("grid md:grid-cols-3", options.gapGridClass)}>
      <div
        className={cx("p-3", innerRadiusClass)}
        style={{ backgroundColor: panelBg }}
      >
        <EditableText
          value={tv.left ?? ""}
          onChange={(left) => onPatch({ left })}
          className={textClass}
          placeholder="Izquierda…"
          readOnly={readOnly}
        />
      </div>
      <div
        className={cx("p-3", innerRadiusClass)}
        style={{ backgroundColor: panelBg }}
      >
        <EditableText
          value={tv.center ?? ""}
          onChange={(center) => onPatch({ center })}
          className={textClass}
          placeholder="Centro…"
          readOnly={readOnly}
        />
      </div>
      <div
        className={cx("p-3", innerRadiusClass)}
        style={{ backgroundColor: panelBg }}
      >
        <EditableText
          value={tv.right ?? ""}
          onChange={(right) => onPatch({ right })}
          className={textClass}
          placeholder="Derecha…"
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

/* ============================================================================
 * Main
 * ========================================================================== */

const BlocksCanvas: React.FC<BlocksCanvasProps> = ({
  blocks,
  onChange,
  lockedIds,
  options,
  showMeta = false,
  getLabel,
  getMode,
  canToggleMode,
  onToggleMode,
  allowRemoveLocked = false,
}) => {
  const order = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const [dragOrder, setDragOrder] = useState(order);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicatorY, setDropIndicatorY] = useState<number | null>(null);
  const dragOrderRef = useRef<string[]>(order);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement | null>());
  const pointerYRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const setItemRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    },
    [],
  );

  const handleReorder = useCallback((nextIds: string[]) => {
    dragOrderRef.current = nextIds;
    setDragOrder(nextIds);
  }, []);

  useEffect(() => {
    if (isDragging) return;
    const current = dragOrderRef.current;
    const isSame =
      current.length === order.length &&
      current.every((id, idx) => id === order[idx]);
    if (isSame) return;
    setDragOrder(order);
    dragOrderRef.current = order;
  }, [isDragging, order]);

  useEffect(() => {
    if (!isDragging) {
      setDropIndicatorY(null);
      pointerYRef.current = null;
    }
  }, [isDragging]);

  useEffect(() => {
    if (!isDragging && draggingId) {
      setDraggingId(null);
    }
  }, [draggingId, isDragging]);

  const orderedBlocks = useMemo(() => {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    return dragOrder
      .map((id) => byId.get(id))
      .filter(Boolean) as OrderedBlock[];
  }, [blocks, dragOrder]);

  const commitReorder = useCallback(
    (nextIds: string[]) => {
      const byId = new Map(blocks.map((b) => [b.id, b]));
      const nextBlocks = nextIds
        .map((id) => byId.get(id))
        .filter(Boolean) as OrderedBlock[];
      const isSame =
        nextBlocks.length === blocks.length &&
        nextBlocks.every((b, i) => b.id === blocks[i].id);
      if (!isSame) onChange(nextBlocks);
    },
    [blocks, onChange],
  );

  const updateDropIndicator = useCallback((pointerY: number) => {
    const container = containerRef.current;
    if (!container) return;
    const ids = dragOrderRef.current;
    if (ids.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    let nextY = 0;

    for (let i = 0; i < ids.length; i += 1) {
      const el = itemRefs.current.get(ids[i]);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (pointerY < midpoint) {
        nextY = rect.top - containerRect.top;
        setDropIndicatorY(nextY);
        return;
      }
      if (i === ids.length - 1) {
        nextY = rect.bottom - containerRect.top;
        setDropIndicatorY(nextY);
        return;
      }
    }
  }, []);

  const handleDragMove = useCallback(
    (pointerY: number) => {
      pointerYRef.current = pointerY;
      updateDropIndicator(pointerY);
    },
    [updateDropIndicator],
  );

  const startAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    const step = () => {
      if (!isDragging) {
        scrollRafRef.current = null;
        return;
      }
      const pointerY = pointerYRef.current;
      if (pointerY == null) {
        scrollRafRef.current = requestAnimationFrame(step);
        return;
      }
      const margin = 96;
      const maxSpeed = 18;
      let speed = 0;
      if (pointerY < margin) {
        speed = -Math.min(maxSpeed, (margin - pointerY) / 4);
      } else if (pointerY > window.innerHeight - margin) {
        speed = Math.min(
          maxSpeed,
          (pointerY - (window.innerHeight - margin)) / 4,
        );
      }
      if (speed !== 0) {
        window.scrollBy({ top: speed, behavior: "auto" });
      }
      updateDropIndicator(pointerY);
      scrollRafRef.current = requestAnimationFrame(step);
    };
    scrollRafRef.current = requestAnimationFrame(step);
  }, [isDragging, updateDropIndicator]);

  const stopAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isDragging) {
      startAutoScroll();
      document.body.style.userSelect = "none";
    } else {
      stopAutoScroll();
      document.body.style.userSelect = "";
    }
  }, [isDragging, startAutoScroll, stopAutoScroll]);

  useEffect(() => {
    if (!isDragging) return;
    const handleStop = () => {
      setIsDragging(false);
      setDraggingId(null);
      pointerYRef.current = null;
      setDropIndicatorY(null);
      stopAutoScroll();
      commitReorder(dragOrderRef.current);
    };
    window.addEventListener("pointerup", handleStop, { passive: true });
    window.addEventListener("pointercancel", handleStop, { passive: true });
    window.addEventListener("mouseup", handleStop, { passive: true });
    window.addEventListener("touchend", handleStop, { passive: true });
    window.addEventListener("blur", handleStop);
    return () => {
      window.removeEventListener("pointerup", handleStop);
      window.removeEventListener("pointercancel", handleStop);
      window.removeEventListener("mouseup", handleStop);
      window.removeEventListener("touchend", handleStop);
      window.removeEventListener("blur", handleStop);
    };
  }, [commitReorder, isDragging, stopAutoScroll]);

  const remove = useCallback(
    (id: string) => {
      const b = blocks.find((x) => x.id === id);
      if (!b || (lockedIds.has(id) && !allowRemoveLocked)) return;
      onChange(blocks.filter((x) => x.id !== id));
    },
    [allowRemoveLocked, blocks, lockedIds, onChange],
  );

  const patchBlock = useCallback(
    (id: string, patch: Partial<BlockFormValue>) => {
      const next = blocks.map((b) =>
        b.id === id ? { ...b, value: patchValueForTypeLocal(b, patch) } : b,
      );
      onChange(next);
    },
    [blocks, onChange],
  );

  const patchBlockTextStyle = useCallback(
    (id: string, nextStyle: BlockTextStyle) => {
      const next = blocks.map((b) => {
        if (b.id !== id) return b;
        return { ...b, textStyle: nextStyle };
      });
      onChange(next);
    },
    [blocks, onChange],
  );

  const resolveMode = (b: OrderedBlock): "fixed" | "form" =>
    getMode ? getMode(b) : b.origin === "form" ? "form" : "fixed";

  return (
    <div
      className="relative"
      style={{ overflowAnchor: "none" }}
      ref={containerRef}
    >
      {isDragging && dropIndicatorY !== null && (
        <div
          className="pointer-events-none absolute inset-x-2 z-10 h-[2px] rounded-full"
          style={{
            top: dropIndicatorY,
            backgroundColor: options.accentColor,
            opacity: 0.9,
          }}
        />
      )}
      <Reorder.Group
        axis="y"
        values={dragOrder}
        onReorder={handleReorder}
        className="space-y-3"
      >
        {orderedBlocks.map((b, idx) => {
          const readOnly = lockedIds.has(b.id);
          const canRemove = !readOnly || allowRemoveLocked;
          const label = getLabel ? getLabel(b, idx) : b.label;
          const mode = resolveMode(b);
          const headingLevel =
            b.type === "heading"
              ? ((b.value as HeadingV | undefined)?.level ?? 1)
              : undefined;
          const resolvedTextStyle = resolveBlockTextStyle({
            type: b.type,
            headingLevel,
            textStyle: b.textStyle,
          });
          const textSizeClass = BLOCK_TEXT_SIZE_CLASS[resolvedTextStyle.size];
          const textWeightClass =
            BLOCK_TEXT_WEIGHT_CLASS[resolvedTextStyle.weight];
          const textClass = cx(textSizeClass, textWeightClass);

          return (
            <BlockItem
              key={b.id}
              block={b}
              label={label}
              mode={mode}
              canToggleMode={canToggleMode ? canToggleMode(b) : true}
              onRemove={() => remove(b.id)}
              canEdit={!readOnly}
              canRemove={canRemove}
              onToggleMode={onToggleMode}
              textSize={resolvedTextStyle.size}
              textWeight={resolvedTextStyle.weight}
              onTextStyleChange={(nextStyle) =>
                patchBlockTextStyle(b.id, nextStyle)
              }
              canStyle={!readOnly}
              options={options}
              showMeta={showMeta}
              onDragStart={() => {
                setIsDragging(true);
                setDraggingId(b.id);
              }}
              onDragEnd={() => {
                setIsDragging(false);
                setDraggingId(null);
                pointerYRef.current = null;
                setDropIndicatorY(null);
                stopAutoScroll();
                commitReorder(dragOrderRef.current);
              }}
              onDragMove={handleDragMove}
              isDraggingAny={isDragging}
              isDraggingSelf={draggingId === b.id}
              itemRef={setItemRef(b.id)}
            >
              {b.type === "heading" && (
                <HeadingEditor
                  b={b}
                  onPatch={(p) => patchBlock(b.id, p)}
                  readOnly={readOnly}
                  options={options}
                  textSizeClass={textSizeClass}
                  textWeight={resolvedTextStyle.weight}
                />
              )}
              {b.type === "subtitle" && (
                <SubtitleEditor
                  b={b}
                  onPatch={(p) => patchBlock(b.id, p)}
                  readOnly={readOnly}
                  textClass={textClass}
                />
              )}
              {b.type === "paragraph" && (
                <ParagraphEditor
                  b={b}
                  onPatch={(p) => patchBlock(b.id, p)}
                  readOnly={readOnly}
                  textClass={textClass}
                />
              )}
              {b.type === "list" && (
                <ListEditor
                  b={b}
                  onPatch={(p) => patchBlock(b.id, p)}
                  options={options}
                  readOnly={readOnly}
                  textClass={textClass}
                />
              )}
              {b.type === "keyValue" && (
                <KeyValueEditor
                  b={b}
                  onPatch={(p) => patchBlock(b.id, p)}
                  readOnly={readOnly}
                  panelBg={options.panelBgStrong}
                  innerRadiusClass={options.innerRadiusClass}
                  controlsOnDarkSurface={options.controlsOnDarkSurface}
                  textClass={textClass}
                />
              )}
              {b.type === "twoColumns" && (
                <TwoColsEditor
                  b={b}
                  onPatch={(p) => patchBlock(b.id, p)}
                  readOnly={readOnly}
                  panelBg={options.panelBgStrong}
                  innerRadiusClass={options.innerRadiusClass}
                  options={options}
                  textClass={textClass}
                />
              )}
              {b.type === "threeColumns" && (
                <ThreeColsEditor
                  b={b}
                  onPatch={(p) => patchBlock(b.id, p)}
                  readOnly={readOnly}
                  panelBg={options.panelBgStrong}
                  innerRadiusClass={options.innerRadiusClass}
                  options={options}
                  textClass={textClass}
                />
              )}
            </BlockItem>
          );
        })}
      </Reorder.Group>
    </div>
  );
};

export default BlocksCanvas;
