"use client";

import Link from "next/link";
import { STUDIO_NAV_GROUPS } from "@/components/studio/studioNavGroups";

const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const PANEL_CLASS =
  "rounded-3xl border border-white/10 bg-white/10 p-5 shadow-md shadow-sky-950/10 backdrop-blur";
const STUDIO_SYSTEM_LINK =
  "inline-flex w-full items-center justify-between rounded-xl border border-slate-300/55 bg-white/85 px-3 py-2 text-xs font-medium text-slate-700 transition hover:scale-[0.98] dark:border-slate-200/25 dark:bg-slate-900/65 dark:text-slate-100";
const STUDIO_NAV_LINK =
  "inline-flex w-full items-center justify-between rounded-lg border border-slate-300/45 bg-white/80 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:scale-[0.98] dark:border-slate-200/20 dark:bg-slate-900/60 dark:text-slate-100";

type Props = {
  backHref?: string;
  backLabel?: string;
  intro?: string;
};

export default function StudioSystemNavigation({
  backHref,
  backLabel = "Volver",
  intro = "Navegá por el sistema sin salir del estudio.",
}: Props) {
  return (
    <div className="space-y-3">
      <div className={PANEL_CLASS}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Navegador del sistema
        </h3>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{intro}</p>
        {backHref ? (
          <Link href={backHref} className={cx(STUDIO_SYSTEM_LINK, "mt-3")}>
            {backLabel} <span>↗</span>
          </Link>
        ) : null}
      </div>

      {STUDIO_NAV_GROUPS.map((group) => (
        <details
          key={group.title}
          open
          className="group rounded-xl border border-slate-300/50 bg-white/75 p-2 dark:border-slate-200/20 dark:bg-slate-900/55"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-200">
            <span>{group.title}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="size-4 transition group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m19.5 8.25-7.5 7.5-7.5-7.5"
              />
            </svg>
          </summary>
          <div className="mt-2 space-y-1.5 border-t border-slate-300/45 pt-2 dark:border-slate-200/15">
            {group.links.map((entry) => (
              <Link key={`${group.title}-${entry.href}`} href={entry.href} className={STUDIO_NAV_LINK}>
                {entry.label} <span>↗</span>
              </Link>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
