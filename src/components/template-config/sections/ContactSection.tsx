// src/components/template-config/sections/ContactSection.tsx

"use client";
import React from "react";
import { setAt, section, asStringArray } from "./_helpers";
import { Config } from "../types";

type UiMode = "default" | "sales";

const CONTACT_OPTIONS: Array<{
  key: string;
  label: string;
  hint: string;
  icon: JSX.Element;
}> = [
  {
    key: "phones",
    label: "Teléfonos",
    hint: "Números de la agencia o vendedor",
    icon: (
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
          d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102A1.125 1.125 0 0 0 5.872 2.25H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
        />
      </svg>
    ),
  },
  {
    key: "email",
    label: "Email",
    hint: "Canal de contacto comercial",
    icon: (
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
          d="M2.25 6.75A2.25 2.25 0 0 1 4.5 4.5h15a2.25 2.25 0 0 1 2.25 2.25v10.5A2.25 2.25 0 0 1 19.5 19.5h-15a2.25 2.25 0 0 1-2.25-2.25V6.75Z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="m3 7.5 9 6 9-6" />
      </svg>
    ),
  },
  {
    key: "website",
    label: "Sitio web",
    hint: "Enlace institucional",
    icon: (
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
          d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18M12 3a15.3 15.3 0 0 1 0 18M12 3a15.3 15.3 0 0 0 0 18" />
      </svg>
    ),
  },
  {
    key: "address",
    label: "Dirección",
    hint: "Sucursal o domicilio comercial",
    icon: (
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
          d="M12 21s-6.75-5.625-6.75-11.25a6.75 6.75 0 1 1 13.5 0C18.75 15.375 12 21 12 21Z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      </svg>
    ),
  },
  {
    key: "instagram",
    label: "Instagram",
    hint: "Red social de la agencia",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="4.5" />
        <circle cx="12" cy="12" r="3.75" />
        <circle cx="17.25" cy="6.75" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    key: "facebook",
    label: "Facebook",
    hint: "Página comercial pública",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5h3l.75-3h-3.75V9a1.5 1.5 0 0 1 1.5-1.5h2.25V4.5H15A4.5 4.5 0 0 0 10.5 9v1.5H8.25v3h2.25V21" />
      </svg>
    ),
  },
  {
    key: "twitter",
    label: "X / Twitter",
    hint: "Perfil de comunicación",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 4.5 15 15M19.5 4.5l-15 15" />
      </svg>
    ),
  },
  {
    key: "tiktok",
    label: "TikTok",
    hint: "Canal audiovisual",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 4.5v8.25a3.75 3.75 0 1 1-3.75-3.75h.75M14.25 4.5c.75 1.5 2.25 3 4.5 3.75" />
      </svg>
    ),
  },
];

type Props = {
  cfg: Config;
  disabled: boolean;
  onChange: (next: Config) => void;
  uiMode?: UiMode;
};

const ContactSection: React.FC<Props> = ({
  cfg,
  disabled,
  onChange,
  uiMode = "default",
}) => {
  const contactItems = asStringArray(cfg["contactItems"]);
  const isSalesUi = uiMode === "sales";
  const selectedCount = CONTACT_OPTIONS.filter((opt) =>
    contactItems.includes(opt.key),
  ).length;

  const toggleContact = (key: string) => {
    const set = new Set(contactItems);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onChange(setAt(cfg, ["contactItems"], Array.from(set)));
  };

  return (
    <section className={section}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
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
                  d="M2.25 6.75A2.25 2.25 0 0 1 4.5 4.5h15a2.25 2.25 0 0 1 2.25 2.25v10.5A2.25 2.25 0 0 1 19.5 19.5h-15a2.25 2.25 0 0 1-2.25-2.25V6.75z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5l9 6 9-6" />
              </svg>
            </span>
            Contacto a mostrar
          </h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Elegí solo los canales que querés incluir en el PDF comercial.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-sky-300/55 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-900 dark:border-sky-200/25 dark:text-sky-100">
          {selectedCount} activos
        </span>
      </div>

      <div className={isSalesUi ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "grid grid-cols-2 gap-3 md:grid-cols-4"}>
        {CONTACT_OPTIONS.map((opt) => {
          const active = contactItems.includes(opt.key);
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => toggleContact(opt.key)}
              disabled={disabled}
              aria-pressed={active}
              className={[
                "rounded-2xl border p-3 text-left transition",
                active
                  ? "border-emerald-400/60 bg-emerald-500/10 shadow-sm shadow-emerald-900/10"
                  : "border-white/10 bg-white/10 hover:border-sky-300/55",
                disabled ? "cursor-not-allowed opacity-60" : "hover:scale-[0.99]",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex size-8 items-center justify-center rounded-xl border border-white/15 bg-white/15 text-slate-700 dark:text-slate-100">
                  {opt.icon}
                </span>
                {active ? (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="size-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                {opt.label}
              </p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {opt.hint}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/10 p-3 text-xs text-slate-600 dark:text-slate-300">
        Si activás <b>Teléfonos</b>, luego en el estudio podés elegir el número a mostrar.
      </div>
    </section>
  );
};

export default ContactSection;
