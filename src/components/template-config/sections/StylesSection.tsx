// src/components/template-config/sections/StylesSection.tsx
"use client";

import React from "react";
import { getAt, input, section, setAt } from "./_helpers";
import { Config, PdfLayout, STYLE_PRESETS, StylePreset } from "../types";

type Props = {
  cfg: Config;
  disabled: boolean;
  onChange: (next: Config) => void;
  uiMode?: "default" | "sales";
};

type ColorKey = "background" | "text" | "accent";

const SURFACE =
  "rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10";
const TOGGLE_BASE =
  "inline-flex h-12 w-full items-center justify-center rounded-xl border p-1.5 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const TOGGLE_ACTIVE = "border-sky-500/60 bg-sky-500/15";
const TOGGLE_IDLE =
  "border-slate-300/60 bg-white/85 dark:border-slate-200/20 dark:bg-slate-900/60";

const LAYOUT_COPY: Record<
  PdfLayout,
  { title: string; description: string }
> = {
  layoutA: {
    title: "Formato A",
    description: "Portada + encabezado + contenido + pie",
  },
  layoutB: {
    title: "Formato B",
    description: "Encabezado + portada + contenido + pie",
  },
  layoutC: {
    title: "Formato C",
    description: "Sidebar lateral + contenido principal",
  },
};

const SelectedMark: React.FC = () => (
  <span className="pointer-events-none absolute right-2 top-2 inline-flex rounded-full border border-emerald-300/60 bg-emerald-500/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm">
    Activo
  </span>
);

const StylesSection: React.FC<Props> = ({
  cfg,
  disabled,
  onChange,
  uiMode = "default",
}) => {
  const isSalesUi = uiMode === "sales";
  const presetId = getAt<string>(cfg, ["styles", "presetId"], "paper");
  const layout = getAt<PdfLayout>(cfg, ["layout"], "layoutA");
  const radius = getAt<string>(cfg, ["styles", "ui", "radius"], "2xl");
  const width = getAt<string>(cfg, ["styles", "ui", "contentWidth"], "normal");
  const density = getAt<string>(cfg, ["styles", "ui", "density"], "comfortable");
  const dividers = getAt<boolean>(cfg, ["styles", "ui", "dividers"], true);
  const colors = getAt(cfg, ["styles", "colors"], {
    background: "#ffffff",
    text: "#111111",
    accent: "#6B7280",
  }) as { background: string; text: string; accent: string };

  const isPreset = (id: string) => id === presetId;

  const applyPreset = (preset: StylePreset) => {
    let next = setAt(cfg, ["styles", "presetId"], preset.id);
    next = setAt(next, ["styles", "colors"], preset.colors);
    onChange(next);
  };

  const setColor = (key: ColorKey, value: string) => {
    onChange(setAt(cfg, ["styles", "colors", key], value));
  };

  const resetPalette = () => {
    const preset = STYLE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    onChange(setAt(cfg, ["styles", "colors"], preset.colors));
  };

  const LayoutThumb: React.FC<{ kind: PdfLayout; active: boolean }> = ({
    kind,
    active,
  }) => (
    <div
      className={[
        "relative rounded-xl border p-3 transition",
        active
          ? "border-sky-500/60 ring-2 ring-sky-300/40"
          : "border-white/10 hover:border-sky-300/45",
      ].join(" ")}
      style={{ backgroundColor: colors.background }}
    >
      {active ? <SelectedMark /> : null}
      {kind === "layoutA" ? (
        <div className="grid h-16 grid-rows-[8px_10px_1fr_8px] gap-1.5">
          <div className="rounded-md bg-slate-500/30" />
          <div className="w-2/3 rounded-md" style={{ backgroundColor: colors.accent }} />
          <div className="space-y-1">
            <div className="h-2 rounded-md bg-slate-500/25" />
            <div className="h-2 w-4/5 rounded-md bg-slate-500/20" />
            <div className="h-2 w-3/5 rounded-md bg-slate-500/20" />
          </div>
          <div className="h-1.5 w-1/2 rounded-md bg-slate-500/25" />
        </div>
      ) : null}
      {kind === "layoutB" ? (
        <div className="grid h-16 grid-rows-[10px_18px_1fr_8px] gap-1.5">
          <div className="w-2/3 rounded-md" style={{ backgroundColor: colors.accent }} />
          <div className="rounded-md bg-slate-500/30" />
          <div className="space-y-1">
            <div className="h-2 rounded-md bg-slate-500/25" />
            <div className="h-2 w-4/5 rounded-md bg-slate-500/20" />
          </div>
          <div className="h-1.5 w-1/2 rounded-md bg-slate-500/25" />
        </div>
      ) : null}
      {kind === "layoutC" ? (
        <div className="grid h-16 grid-cols-[28px_1fr] gap-1.5">
          <div className="space-y-1 rounded-md bg-slate-500/20 p-1">
            <div className="h-1.5 rounded bg-slate-500/30" />
            <div className="h-1.5 rounded bg-slate-500/25" />
            <div className="h-1.5 w-2/3 rounded bg-slate-500/25" />
          </div>
          <div className="space-y-1.5">
            <div className="h-2 rounded-md" style={{ backgroundColor: colors.accent }} />
            <div className="h-2 rounded-md bg-slate-500/25" />
            <div className="h-2 w-4/5 rounded-md bg-slate-500/20" />
            <div className="h-1.5 w-1/2 rounded-md bg-slate-500/20" />
          </div>
        </div>
      ) : null}
    </div>
  );

  const PresetCard: React.FC<{ preset: StylePreset }> = ({ preset }) => {
    const active = isPreset(preset.id);
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => applyPreset(preset)}
        className={[
          "relative rounded-xl border p-3 text-left transition hover:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
          active
            ? "border-emerald-400/60 ring-2 ring-emerald-300/40"
            : "border-white/10 hover:border-sky-300/45",
        ].join(" ")}
      >
        {active ? <SelectedMark /> : null}
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {preset.label}
          </span>
          <span
            className="size-4 rounded-full border border-white/40"
            style={{ backgroundColor: preset.colors.accent }}
          />
        </div>
        <div
          className="grid h-14 grid-cols-[1fr_auto] items-center rounded-lg px-3"
          style={{ backgroundColor: preset.colors.background }}
        >
          <div className="space-y-1">
            <div
              className="h-2 w-10/12 rounded"
              style={{ backgroundColor: preset.colors.text, opacity: 0.9 }}
            />
            <div
              className="h-2 w-7/12 rounded"
              style={{ backgroundColor: preset.colors.text, opacity: 0.6 }}
            />
          </div>
          <div
            className="size-6 rounded-full"
            style={{ backgroundColor: preset.colors.accent }}
          />
        </div>
      </button>
    );
  };

  return (
    <section className={section}>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <span className="inline-flex size-8 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 shadow-sm shadow-emerald-900/10 dark:border-emerald-400/20 dark:text-emerald-300">
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
              d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-2.684-2.684L2.25 12l2.846-.813a4.5 4.5 0 0 0 2.684-2.684L9 5.25l.813 2.846a4.5 4.5 0 0 0 2.684 2.684L15.75 12l-2.846.813a4.5 4.5 0 0 0-2.684 2.684ZM18 9.75l.488 1.71a2.25 2.25 0 0 0 1.342 1.342L21.75 13.5l-1.92.698a2.25 2.25 0 0 0-1.342 1.342L18 17.25l-.488-1.71a2.25 2.25 0 0 0-1.342-1.342L14.25 13.5l1.92-.698a2.25 2.25 0 0 0 1.342-1.342L18 9.75Z"
            />
          </svg>
        </span>
        Estilos y formato
      </h2>
      <p className="mb-4 text-xs text-slate-600 dark:text-slate-300">
        {isSalesUi
          ? "Definí la base visual del estudio y cómo se distribuye el contenido en el PDF."
          : "Configurá la apariencia general y la estructura del documento."}
      </p>

      <div className={SURFACE}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Estilos base
          </h3>
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">
            Presets rápidos
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {STYLE_PRESETS.map((preset) => (
            <PresetCard key={preset.id} preset={preset} />
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {(
          [
            { key: "background", label: "Fondo" },
            { key: "text", label: "Texto" },
            { key: "accent", label: "Acento" },
          ] as Array<{ key: ColorKey; label: string }>
        ).map((item) => (
          <div key={item.key} className={SURFACE}>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
              {item.label}
            </label>
            <input
              type="color"
              value={colors[item.key]}
              onChange={(event) => setColor(item.key, event.target.value)}
              disabled={disabled}
              className="mt-2 h-11 w-full cursor-pointer rounded-2xl border border-slate-300/60 bg-white/90 p-1 dark:border-slate-200/20 dark:bg-slate-900/60"
            />
            <input
              className={`${input} mt-2`}
              value={colors[item.key]}
              onChange={(event) => setColor(item.key, event.target.value)}
              placeholder="#000000"
              disabled={disabled}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={resetPalette}
          disabled={disabled}
          className="inline-flex items-center rounded-full border border-slate-300/60 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100"
        >
          Volver al preset
        </button>
      </div>

      <div className={`${SURFACE} mt-4`}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Formato del PDF
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["layoutA", "layoutB", "layoutC"] as PdfLayout[]).map((kind) => {
            const active = layout === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onChange(setAt(cfg, ["layout"], kind))}
                disabled={disabled}
                className="text-left transition hover:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                aria-pressed={active}
              >
                <LayoutThumb kind={kind} active={active} />
                <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {LAYOUT_COPY[kind].title}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-300">
                  {LAYOUT_COPY[kind].description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${SURFACE} mt-4`}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Ajustes avanzados
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Radio de bordes
            </p>
            <div className="mt-1.5 grid grid-cols-5 gap-2">
              {(
                [
                  { key: "sm", radiusClass: "rounded-sm" },
                  { key: "md", radiusClass: "rounded-md" },
                  { key: "lg", radiusClass: "rounded-lg" },
                  { key: "xl", radiusClass: "rounded-xl" },
                  { key: "2xl", radiusClass: "rounded-2xl" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onChange(setAt(cfg, ["styles", "ui", "radius"], opt.key))}
                  disabled={disabled}
                  className={[
                    TOGGLE_BASE,
                    radius === opt.key ? TOGGLE_ACTIVE : TOGGLE_IDLE,
                  ].join(" ")}
                  title={opt.key}
                >
                  <span className="sr-only">{opt.key}</span>
                  <span
                    className={[
                      "h-6 w-8 border border-slate-400/70 bg-slate-300/50 dark:border-slate-300/40 dark:bg-slate-300/25",
                      opt.radiusClass,
                    ].join(" ")}
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Ancho del contenido
            </p>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(
                [
                  { key: "narrow", widthClass: "max-w-[34px]" },
                  { key: "normal", widthClass: "max-w-[48px]" },
                  { key: "wide", widthClass: "max-w-[62px]" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    onChange(setAt(cfg, ["styles", "ui", "contentWidth"], opt.key))
                  }
                  disabled={disabled}
                  className={[
                    TOGGLE_BASE,
                    width === opt.key ? TOGGLE_ACTIVE : TOGGLE_IDLE,
                  ].join(" ")}
                  title={opt.key}
                >
                  <span className="sr-only">{opt.key}</span>
                  <div className="w-full rounded-lg border border-slate-300/65 p-1 dark:border-slate-200/25">
                    <div className={`mx-auto space-y-1 ${opt.widthClass}`}>
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
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Separación vertical (eje Y)
            </p>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(
                [
                  { key: "compact", spacing: "space-y-0.5" },
                  { key: "comfortable", spacing: "space-y-1" },
                  { key: "relaxed", spacing: "space-y-1.5" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    onChange(setAt(cfg, ["styles", "ui", "density"], opt.key))
                  }
                  disabled={disabled}
                  className={[
                    TOGGLE_BASE,
                    density === opt.key ? TOGGLE_ACTIVE : TOGGLE_IDLE,
                  ].join(" ")}
                  title={opt.key}
                >
                  <span className="sr-only">{opt.key}</span>
                  <div className={`w-full max-w-[72px] ${opt.spacing}`}>
                    <div className="h-1.5 rounded bg-slate-400/70 dark:bg-slate-300/45" />
                    <div className="h-1.5 rounded bg-slate-400/60 dark:bg-slate-300/35" />
                    <div className="h-1.5 rounded bg-slate-400/60 dark:bg-slate-300/35" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Divisores entre bloques
            </p>
            <button
              type="button"
              onClick={() =>
                onChange(setAt(cfg, ["styles", "ui", "dividers"], !dividers))
              }
              disabled={disabled}
              className={[
                "mt-1.5 inline-flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs font-medium transition hover:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
                dividers
                  ? "border-emerald-400/55 bg-emerald-500/12 text-emerald-900 dark:text-emerald-200"
                  : "border-slate-300/60 bg-white/85 text-slate-700 dark:border-slate-200/20 dark:bg-slate-900/60 dark:text-slate-100",
              ].join(" ")}
            >
              <span>{dividers ? "Activados" : "Desactivados"}</span>
              <span
                className={[
                  "inline-flex h-5 w-10 rounded-full p-0.5 transition",
                  dividers ? "bg-emerald-500/60" : "bg-slate-400/50",
                ].join(" ")}
              >
                <span
                  className={[
                    "h-4 w-4 rounded-full bg-white shadow-sm transition",
                    dividers ? "translate-x-5" : "",
                  ].join(" ")}
                />
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StylesSection;
