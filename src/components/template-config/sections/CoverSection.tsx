// src/components/template-config/sections/CoverSection.tsx

"use client";
import React, { useMemo, useState } from "react";
import { getAt, setAt, section, input, isObject } from "./_helpers";
import { Config, CoverSavedItem } from "../types";

type UiMode = "default" | "sales";

type Props = {
  cfg: Config;
  disabled: boolean;
  onChange: (next: Config) => void;
  uiMode?: UiMode;
};

const CoverSection: React.FC<Props> = ({
  cfg,
  disabled,
  onChange,
  uiMode = "default",
}) => {
  const isSalesUi = uiMode === "sales";
  const coverMode = getAt<string>(cfg, ["coverImage", "mode"], "logo");
  const coverUrl = getAt<string>(cfg, ["coverImage", "url"], "");
  const savedRaw = getAt<unknown>(cfg, ["coverImage", "saved"], []);

  const saved = useMemo<CoverSavedItem[]>(() => {
    if (!Array.isArray(savedRaw)) return [];
    return savedRaw
      .filter(isObject)
      .map((o) => ({ name: String(o.name || ""), url: String(o.url || "") }));
  }, [savedRaw]);

  const [tempName, setTempName] = useState("");
  const [tempUrl, setTempUrl] = useState("");

  const setCoverMode = (m: "logo" | "url") =>
    onChange(setAt(cfg, ["coverImage", "mode"], m));
  const setCoverUrl = (u: string) =>
    onChange(setAt(cfg, ["coverImage", "url"], u));

  const addToLibrary = () => {
    if (!tempName.trim() || !tempUrl.trim()) return;
    const dedup = new Map(saved.map((s) => [s.url, s]));
    dedup.set(tempUrl.trim(), { name: tempName.trim(), url: tempUrl.trim() });
    onChange(setAt(cfg, ["coverImage", "saved"], Array.from(dedup.values())));
    setTempName("");
    setTempUrl("");
  };

  const removeFromLibrary = (url: string) => {
    onChange(
      setAt(
        cfg,
        ["coverImage", "saved"],
        saved.filter((s) => s.url !== url),
      ),
    );
    if (coverUrl === url) setCoverUrl("");
  };

  const selectValue = useMemo(() => {
    const hit = saved.find((s) => s.url === coverUrl);
    return hit ? hit.url : "";
  }, [saved, coverUrl]);

  const hasLibrary = saved.length > 0;
  const canSaveImage = !disabled && tempName.trim().length > 0 && tempUrl.trim().length > 0;

  return (
    <section className={section}>
      <div className="mb-3">
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
                d="M2.25 15.75V6.75A2.25 2.25 0 0 1 4.5 4.5h15A2.25 2.25 0 0 1 21.75 6.75v9A2.25 2.25 0 0 1 19.5 18h-15a2.25 2.25 0 0 1-2.25-2.25Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15.75 7.5 10.5a2.25 2.25 0 0 1 3.182 0l1.5 1.5a2.25 2.25 0 0 0 3.182 0l3.318-3.318"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 8.25h.008v.008h-.008V8.25Z" />
            </svg>
          </span>
          Portada
        </h2>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
          Definí de dónde sale la imagen principal del documento.
        </p>
      </div>

      <div
        className={
          isSalesUi
            ? "grid grid-cols-1 gap-2 xl:grid-cols-2"
            : "grid grid-cols-1 gap-3 xl:grid-cols-2"
        }
      >
        {[
          {
            key: "logo" as const,
            title: "Usar logo institucional",
            desc: "Toma la imagen cargada en datos de la agencia.",
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5h16.5v15H3.75v-15Zm0 4.5h16.5M8.25 3v3" />
              </svg>
            ),
          },
          {
            key: "url" as const,
            title: "Usar imagen por URL",
            desc: "Elegí o cargá una imagen desde tu biblioteca.",
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5H19.5V10.5M10.5 19.5H4.5V13.5M19.5 4.5L12 12M12 12L4.5 19.5" />
              </svg>
            ),
          },
        ].map((opt) => {
          const active = coverMode === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setCoverMode(opt.key)}
              disabled={disabled}
              className={[
                "rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? "border-sky-500/60 bg-sky-500/12"
                  : "border-white/10 bg-white/10 hover:border-sky-300/55",
                disabled ? "" : "hover:scale-[0.99]",
              ].join(" ")}
              aria-pressed={active}
            >
              <span className="inline-flex size-8 items-center justify-center rounded-xl border border-white/15 bg-white/15 text-slate-700 dark:text-slate-100">
                {opt.icon}
              </span>
              <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                {opt.title}
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {opt.desc}
              </p>
            </button>
          );
        })}
      </div>

      {coverMode === "url" ? (
        <div
          className={
            isSalesUi
              ? "mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.35fr)]"
              : "mt-3 grid gap-3 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.35fr)]"
          }
        >
          <div className="min-w-0 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                  Agregar imagen
                </p>
                <span className="rounded-full border border-sky-300/45 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:border-sky-200/25 dark:text-sky-100">
                  Biblioteca
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <input
                  className={input}
                  placeholder="Nombre de referencia"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  disabled={disabled}
                />
                <input
                  className={input}
                  placeholder="https://.../portada.jpg"
                  value={tempUrl}
                  onChange={(e) => setTempUrl(e.target.value)}
                  disabled={disabled}
                />
              </div>
              <button
                type="button"
                onClick={addToLibrary}
                disabled={!canSaveImage}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-300/45 bg-sky-500/10 px-3 py-2.5 text-sm font-medium text-sky-900 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-200/25 dark:text-sky-100"
                title="Guardar en biblioteca"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Agregar imagen
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10">
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                Selección actual
                <select
                  className={`${input} mt-2 cursor-pointer`}
                  value={selectValue}
                  onChange={(e) => setCoverUrl(e.target.value)}
                  disabled={disabled}
                >
                  <option value="">Seleccionar portada</option>
                  {saved.map((s) => (
                    <option key={s.url} value={s.url}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-3 rounded-xl border border-white/10 bg-white/10 p-2">
                {coverUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={coverUrl}
                      alt="Vista previa portada"
                      className="h-40 w-full rounded-lg object-cover"
                    />
                    <p className="mt-2 truncate text-xs text-slate-600 dark:text-slate-300">
                      Portada seleccionada
                    </p>
                  </>
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-white/20 text-xs text-slate-500 dark:text-slate-300">
                    Seleccioná una imagen de la biblioteca
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Biblioteca de imágenes
              </h3>
              <span className="rounded-full border border-slate-300/60 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-200/20 dark:bg-slate-900/55 dark:text-slate-200">
                {saved.length}
              </span>
            </div>

            {!hasLibrary ? (
              <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5 text-xs text-slate-500 dark:text-slate-300">
                Todavía no cargaste imágenes.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {saved.map((s) => {
                  const active = coverUrl === s.url;
                  return (
                    <article
                      key={s.url}
                      className={[
                        "overflow-hidden rounded-xl border bg-white/10 shadow-sm shadow-sky-950/10 transition",
                        active
                          ? "border-sky-500/60 ring-2 ring-sky-300/40"
                          : "border-white/10 hover:border-sky-300/45",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => setCoverUrl(s.url)}
                        className="w-full"
                        title={`Seleccionar ${s.name}`}
                        disabled={disabled}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={s.url}
                          alt={s.name}
                          className="h-32 w-full object-cover"
                        />
                      </button>
                      <div className="flex items-center justify-between gap-2 p-2">
                        <p
                          className="truncate text-xs font-medium text-slate-700 dark:text-slate-200"
                          title={s.name}
                        >
                          {s.name}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeFromLibrary(s.url)}
                          disabled={disabled}
                          className="inline-flex size-7 items-center justify-center rounded-full border border-rose-400/40 bg-rose-500/10 text-rose-700 transition hover:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-200"
                          title="Quitar de biblioteca"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            className="size-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.7}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79" />
                          </svg>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            Se utilizará el logo institucional cargado en la agencia.
          </p>
        </div>
      )}
    </section>
  );
};

export default CoverSection;
