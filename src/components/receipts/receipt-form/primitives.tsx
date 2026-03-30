// src/components/receipts/receipt-form/primitives.tsx
import React from "react";

export const pillBase =
  "rounded-full px-3 py-1 text-xs font-medium transition-colors";
export const pillNeutral = "bg-white/30 dark:bg-white/10";
export const pillOk = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";

export const inputBase =
  "w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 shadow-sm shadow-sky-950/10 outline-none placeholder:font-light dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";

export const Section: React.FC<{
  title: string;
  desc?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, desc, headerRight, children }) => (
  <section className="rounded-2xl border border-white/10 bg-white/10 p-4">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
          {title}
        </h3>
        {desc && (
          <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
            {desc}
          </p>
        )}
      </div>
      {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
  </section>
);

export const Field: React.FC<{
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ id, label, hint, required, children }) => (
  <div className="space-y-1">
    <label
      htmlFor={id}
      className="ml-1 block text-sm font-medium text-sky-950 dark:text-white"
    >
      {label} {required && <span className="text-rose-600">*</span>}
    </label>
    {children}
    {hint && (
      <p
        id={`${id}-hint`}
        className="ml-1 text-xs text-sky-950/70 dark:text-white/70"
      >
        {hint}
      </p>
    )}
  </div>
);
