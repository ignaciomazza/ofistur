// src/components/templates/TemplateConfigForm.tsx
/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAgencyAndUser } from "@/lib/agencyUser";
import { asStringArray, getAvailableCoverUrls } from "@/lib/templateConfig";
import type {
  TemplateConfig,
  TemplateFormValues,
  Agency,
} from "@/types/templates";

/* --------------------------- Helpers de módulo (tipados) --------------------------- */
type CoverSavedItem = { url: string; name?: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isCoverSavedItem = (v: unknown): v is CoverSavedItem =>
  isRecord(v) &&
  typeof (v as { url?: unknown }).url === "string" &&
  (v as { url: string }).url.trim().length > 0;

/* --------------------------- UI helpers --------------------------- */
const cx = (...c: Array<string | false | null | undefined>) =>
  c.filter(Boolean).join(" ");

const PANEL_CLASS =
  "mb-6 h-fit rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur dark:bg-white/5";
const SUB_PANEL_CLASS =
  "rounded-2xl border border-white/10 bg-white/20 p-4 shadow-sm shadow-sky-950/10";
const EMPTY_STATE_CLASS =
  "rounded-2xl border border-white/10 bg-white/20 p-4 text-sm text-slate-600 shadow-sm shadow-sky-950/10 dark:text-slate-200";
const OPTION_TILE_BASE =
  "relative rounded-2xl border border-white/10 bg-white/10 p-3 text-left shadow-sm shadow-sky-950/10 transition hover:scale-[0.98]";
const OPTION_ICON_CLASS =
  "mb-2 inline-flex size-8 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-slate-500 shadow-sm shadow-sky-950/10 dark:text-slate-300";

type Props = {
  cfg: TemplateConfig;
  value: TemplateFormValues;
  onChange: (next: TemplateFormValues) => void;
  token?: string | null;
  className?: string;
};

/* --------------------------- Tiny atoms --------------------------- */

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        PANEL_CLASS,
        className,
      )}
    >
      {children}
    </section>
  );
}

function SectionHeader({
  title,
  subtitle,
  right,
  icon,
  tone = "amber",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "amber" | "emerald";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-sky-400/40 bg-sky-500/10 text-sky-900 dark:text-sky-100"
      : "border-sky-400/40 bg-sky-500/10 text-sky-900 dark:text-sky-100";
  const shadowClass = "shadow-sky-900/10";
  return (
    <div className="flex items-start justify-between gap-3 pb-4">
      <div>
        <div className="flex items-center gap-2">
          {icon && (
            <span
              className={cx(
                "inline-flex size-8 items-center justify-center rounded-2xl border shadow-sm",
                shadowClass,
                toneClass,
              )}
            >
              {icon}
            </span>
          )}
          <h3 className="text-base font-semibold tracking-wide opacity-95">
            {title}
          </h3>
        </div>
        {subtitle && (
          <p className="mt-0.5 text-xs leading-relaxed opacity-70">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

function RadioBadge({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-sm",
        active
          ? "border-sky-400/60 bg-sky-500/85 text-white"
          : "border-white/10 bg-white/10 text-white/80 opacity-0",
      )}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className={cx("size-4", active ? "opacity-100" : "opacity-0")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75l2.25 2.25L15 11.25"
        />
      </svg>
      Seleccionado
    </span>
  );
}

function OptionTile({
  active,
  onClick,
  children,
  title,
  icon,
  role,
  tone = "emerald",
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
  icon?: React.ReactNode;
  role?: "radio";
  tone?: "amber" | "emerald";
}) {
  const activeClass =
    tone === "amber"
      ? "border-sky-400/60 ring-2 ring-sky-200/70"
      : "border-sky-400/60 ring-2 ring-sky-200/70";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      role={role}
      aria-pressed={!!active}
      className={cx(
        OPTION_TILE_BASE,
        active ? activeClass : "border-white/10",
      )}
    >
      {icon && (
        <div className={OPTION_ICON_CLASS}>
          {icon}
        </div>
      )}
      {children}
      <RadioBadge active={!!active} />
    </button>
  );
}

function SkeletonLine({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "h-3 w-full animate-pulse rounded-full bg-slate-900/10 dark:bg-white/10",
        className,
      )}
    />
  );
}

/* --------------------------- Main --------------------------- */

export default function TemplateConfigForm({
  cfg,
  value,
  onChange,
  token,
  className,
}: Props) {
  const { token: ctxToken } = useAuth();
  const authToken = token ?? ctxToken ?? null;

  const { agency, loading } = useAgencyAndUser(authToken);

  /* ------- Portada: combinamos saved[] + url actual + helper ------- */
  const savedCovers = useMemo<CoverSavedItem[]>(() => {
    const raw = (cfg.coverImage as { saved?: unknown } | undefined)?.saved;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isCoverSavedItem).map((x) => ({
      url: x.url,
      name: typeof x.name === "string" && x.name.trim() ? x.name : "Sin título",
    }));
  }, [cfg]);

  const helperUrls = useMemo(() => getAvailableCoverUrls(cfg), [cfg]);

  const singleUrl = useMemo<string[]>(
    () => (cfg.coverImage?.url ? [cfg.coverImage.url] : []),
    [cfg.coverImage?.url],
  );

  const coverOptions = useMemo<Array<{ url: string; name: string }>>(() => {
    const map = new Map<string, { url: string; name: string }>();
    // Prioridad: saved[] (con nombre) → helper → url suelta
    savedCovers.forEach((s) =>
      map.set(s.url, { url: s.url, name: s.name ?? s.url }),
    );
    [...helperUrls, ...singleUrl].filter(Boolean).forEach((u) => {
      if (!map.has(u)) map.set(u, { url: u, name: u });
    });
    return Array.from(map.values());
  }, [savedCovers, helperUrls, singleUrl]);

  const selectedCoverUrl = value.cover?.url ?? cfg.coverImage?.url ?? "";
  const setCoverUrl = (url: string) =>
    onChange({ ...value, cover: { ...(value.cover ?? {}), url } });

  /* ------- Contacto: agencia vs vendedores ------- */
  const phoneOptions = useMemo(() => {
    const ag = agency as Partial<Agency> | undefined;

    // Teléfono institucional de la agencia
    const agencyPhone = ag?.phone
      ? [
          {
            value: String(ag.phone),
            kind: "agency" as const,
            label: String(ag.phone),
          },
        ]
      : [];

    // Teléfonos de vendedores
    const sellerPhones = Array.isArray(ag?.phones)
      ? asStringArray(ag?.phones).map((p) => ({
          value: p,
          kind: "seller" as const,
          label: p,
        }))
      : [];

    // Unificar y desduplicar por número, priorizando el orden: agencia primero
    const map = new Map<
      string,
      { value: string; kind: "agency" | "seller"; label: string }
    >();
    [...agencyPhone, ...sellerPhones].forEach((opt) => {
      if (opt.value) map.set(opt.value, opt);
    });

    return Array.from(map.values());
  }, [agency]);

  const selectedPhone = value.contact?.phone ?? "";
  const setContactPhone = (phone: string) =>
    onChange({ ...value, contact: { ...(value.contact ?? {}), phone } });

  /* ------- Pago ------- */
  const paymentOptions = asStringArray(cfg.paymentOptions);
  const paymentIdx = value.payment?.selectedIndex;
  const setPaymentIndex = (idx: number) =>
    onChange({
      ...value,
      payment: { ...(value.payment ?? {}), selectedIndex: idx },
    });

  /* --------------------------- Render --------------------------- */

  return (
    <div className={cx("space-y-6 dark:text-white", className)}>
      {/* --------------------------- Portada --------------------------- */}
      <Card>
        <SectionHeader
          title="Portada"
          subtitle="Elegí una imagen de portada definida por el gerente. La proporción se adapta automáticamente."
          tone="amber"
          icon={
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
                d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
              />
            </svg>
          }
        />

        {coverOptions.length === 0 ? (
          <div className="pb-1">
            <div className={EMPTY_STATE_CLASS}>
              No hay imágenes configuradas para portada.
            </div>
          </div>
        ) : (
          <div
            className="grid grid-cols-2 gap-3 pb-1 md:grid-cols-3 lg:grid-cols-4"
            role="radiogroup"
            aria-label="Seleccionar portada"
          >
            {coverOptions.map(({ url, name }) => {
              const active = selectedCoverUrl === url;
              return (
                <OptionTile
                  key={url}
                  active={active}
                  onClick={() => setCoverUrl(url)}
                  title={name || url}
                  role="radio"
                  tone="amber"
                >
                  <div className="relative overflow-hidden rounded-xl">
                    {/* Ratio 16/9 */}
                    <div className="pointer-events-none aspect-[16/9] w-full">
                      <img
                        src={url}
                        alt={name || "Portada"}
                        className="size-full rounded-xl object-cover"
                      />
                    </div>

                    {/* Gradiente + etiqueta con el nombre */}
                    <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-black/50 via-black/0 to-black/0" />
                    {name ? (
                      <div className="absolute bottom-2 left-2 max-w-[85%] truncate rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white">
                        {name}
                      </div>
                    ) : null}
                  </div>
                </OptionTile>
              );
            })}
          </div>
        )}
      </Card>

      {/* --------------------------- Contacto --------------------------- */}
      <Card>
        <SectionHeader
          title="Contacto a mostrar"
          subtitle="Elegí si mostrar el teléfono institucional de la agencia o el de un vendedor."
          tone="emerald"
          icon={
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
                d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
              />
            </svg>
          }
        />

        {loading ? (
          <div className="grid grid-cols-1 gap-2 pb-1 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={SUB_PANEL_CLASS}
              >
                <SkeletonLine className="mb-2 h-4 w-24" />
                <SkeletonLine />
              </div>
            ))}
          </div>
        ) : phoneOptions.length === 0 ? (
          <div className="pb-1">
            <div className={EMPTY_STATE_CLASS}>
              La agencia no tiene teléfonos cargados.
            </div>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 gap-2 pb-1 md:grid-cols-2 lg:grid-cols-3"
            role="radiogroup"
            aria-label="Seleccionar teléfono"
          >
            {phoneOptions.map((opt, idx) => {
              const active = selectedPhone === opt.value;
              return (
                <OptionTile
                  key={`${opt.value}-${idx}`}
                  active={active}
                  onClick={() => setContactPhone(opt.value)}
                  title={opt.value}
                  role="radio"
                  tone="emerald"
                  icon={
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
                        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
                      />
                    </svg>
                  }
                >
                  <div className="flex flex-col">
                    <div className="text-sm font-medium opacity-95">
                      {opt.label}
                    </div>
                    <div className="text-xs opacity-70">
                      {opt.kind === "agency"
                        ? "Teléfono de la agencia"
                        : "Teléfono de vendedor"}
                    </div>
                  </div>
                </OptionTile>
              );
            })}
          </div>
        )}
      </Card>

      {/* --------------------------- Pago --------------------------- */}
      <Card>
        <SectionHeader
          title="Opciones de pago"
          subtitle="Seleccioná la leyenda de pago disponible para este documento."
          tone="amber"
          icon={
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
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
              />
            </svg>
          }
        />

        {paymentOptions.length === 0 ? (
          <div className="pb-1">
            <div className={EMPTY_STATE_CLASS}>
              No hay opciones de pago cargadas.
            </div>
          </div>
        ) : (
          <div
            className="space-y-3 pb-1"
            role="radiogroup"
            aria-label="Seleccionar forma de pago"
          >
            <div className="grid grid-cols-1 gap-2">
              {paymentOptions.map((p, idx) => {
                const active = paymentIdx === idx;
                return (
                  <OptionTile
                    key={idx}
                    active={active}
                    onClick={() => setPaymentIndex(idx)}
                    title={p}
                    role="radio"
                    tone="amber"
                    icon={
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
                          d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
                        />
                      </svg>
                    }
                  >
                    <div className="text-sm leading-relaxed opacity-90">
                      {p.length > 180 ? p.slice(0, 177) + "…" : p}
                    </div>
                  </OptionTile>
                );
              })}
            </div>

            {typeof paymentIdx === "number" && paymentOptions[paymentIdx] && (
              <div className={cx(SUB_PANEL_CLASS, "text-sm text-slate-700 dark:text-slate-200")}>
                {paymentOptions[paymentIdx]}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
