"use client";

import Link from "next/link";
import type { ReactNode } from "react";

const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

type StudioBadgeTone = "sky" | "emerald" | "amber" | "rose" | "slate";

export type StudioBadge = {
  label: string;
  tone?: StudioBadgeTone;
};

export type StudioTab = {
  key: string;
  label: ReactNode;
  srLabel?: string;
};

type Props = {
  eyebrow: string;
  title: string;
  overviewExtra?: ReactNode;
  badges?: StudioBadge[];
  backHref?: string;
  backLabel?: string;
  hideOverviewCard?: boolean;
  tabsVariant?: "text" | "icon";
  tabColumnsDesktop?: number;
  tabColumnsMobile?: number;
  desktopSidebarWidth?: number;
  tabs: StudioTab[];
  activeTab: string;
  onChangeTab: (key: string) => void;
  panelTitle: string;
  panelBody: React.ReactNode;
  mainContent: React.ReactNode;
  showMobilePanel?: boolean;
  className?: string;
};

function badgeClass(tone: StudioBadgeTone): string {
  if (tone === "emerald") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200";
  }
  if (tone === "amber") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200";
  }
  if (tone === "rose") {
    return "border-rose-500/35 bg-rose-500/10 text-rose-900 dark:text-rose-200";
  }
  if (tone === "slate") {
    return "border-slate-400/35 bg-slate-400/10 text-slate-900 dark:text-slate-200";
  }
  return "border-sky-400/35 bg-sky-500/10 text-sky-900 dark:border-sky-300/30 dark:text-sky-100";
}

export default function StudioShell({
  eyebrow,
  title,
  overviewExtra,
  badges = [],
  backHref,
  backLabel = "Volver",
  hideOverviewCard = false,
  tabsVariant = "text",
  tabColumnsDesktop = 2,
  tabColumnsMobile = 4,
  desktopSidebarWidth = 340,
  tabs,
  activeTab,
  onChangeTab,
  panelTitle,
  panelBody,
  mainContent,
  showMobilePanel = true,
  className,
}: Props) {
  const shellPad = Math.max(320, desktopSidebarWidth) + 20;
  const tabColsDesktop = Math.max(1, tabColumnsDesktop);
  const tabColsMobile = Math.max(1, tabColumnsMobile);
  const iconTabs = tabsVariant === "icon";
  const tabDesktopClass = iconTabs
    ? "inline-flex w-full items-center justify-center rounded-xl border border-sky-300/35 bg-white/80 p-2.5 text-slate-700 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] dark:border-sky-200/25 dark:bg-sky-900/45 dark:text-slate-100"
    : "inline-flex w-full items-center justify-center rounded-xl border border-sky-300/35 bg-white/80 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] dark:border-sky-200/25 dark:bg-sky-900/45 dark:text-slate-100";
  const tabMobileClass = iconTabs
    ? "inline-flex w-full items-center justify-center rounded-xl border border-sky-300/35 bg-white/80 p-2.5 text-slate-700 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] dark:border-sky-200/25 dark:bg-sky-900/45 dark:text-slate-100"
    : "inline-flex w-full items-center justify-center rounded-xl border border-sky-300/35 bg-white/80 px-2 py-2 text-[11px] font-medium text-slate-700 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] dark:border-sky-200/25 dark:bg-sky-900/45 dark:text-slate-100";
  const activeClass =
    "border-sky-500/55 bg-sky-500/15 text-sky-950 dark:border-sky-300/50 dark:bg-sky-500/30 dark:text-sky-50";

  return (
    <div
      className={cx("relative", className)}
      style={{ ["--studio-shell-pad" as string]: `${shellPad}px` }}
    >
      <aside
        className="fixed inset-y-3 left-3 z-[120] hidden overflow-hidden rounded-3xl border border-sky-300/35 bg-white/90 p-3 shadow-xl shadow-sky-950/20 backdrop-blur dark:border-sky-200/20 dark:bg-slate-950/90 md:flex md:flex-col"
        style={{ width: Math.max(320, desktopSidebarWidth) }}
      >
        {!hideOverviewCard ? (
          <div className="rounded-2xl border border-sky-300/35 bg-white/80 p-3 shadow-sm shadow-sky-900/10 dark:border-sky-200/20 dark:bg-slate-900/70">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
              {eyebrow}
            </p>
            <h1 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">{title}</h1>
            {overviewExtra ? <div className="mt-2">{overviewExtra}</div> : null}
            {badges.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {badges.map((badge, index) => (
                  <span
                    key={`${badge.label}-${index}`}
                    className={cx(
                      "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      badgeClass(badge.tone || "sky"),
                    )}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : null}
            {backHref ? (
              <Link
                href={backHref}
                className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-300/55 bg-white/85 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100"
              >
                {backLabel}
              </Link>
            ) : null}
          </div>
        ) : null}
        <p
          className={cx(
            "text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300",
            hideOverviewCard ? "mb-3 mt-0" : "my-3",
          )}
        >
          Menú estudio
        </p>
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${tabColsDesktop}, minmax(0, 1fr))`,
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChangeTab(tab.key)}
              className={cx(
                tabDesktopClass,
                activeTab === tab.key && activeClass,
              )}
              title={tab.srLabel || (typeof tab.label === "string" ? tab.label : undefined)}
            >
              {iconTabs ? (
                <>
                  {tab.label}
                  <span className="sr-only">
                    {tab.srLabel || (typeof tab.label === "string" ? tab.label : "Tab")}
                  </span>
                </>
              ) : (
                tab.label
              )}
            </button>
          ))}
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-100">
            {panelTitle}
          </h2>
          {panelBody}
        </div>
      </aside>

      <div className="fixed inset-x-3 bottom-3 z-[120] md:hidden">
        <div
          className="grid gap-2 rounded-2xl border border-sky-300/35 bg-white/90 p-2 shadow-xl shadow-sky-950/20 backdrop-blur dark:border-sky-200/20 dark:bg-slate-950/85"
          style={{
            gridTemplateColumns: `repeat(${tabColsMobile}, minmax(0, 1fr))`,
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChangeTab(tab.key)}
              className={cx(
                tabMobileClass,
                activeTab === tab.key && activeClass,
              )}
              title={tab.srLabel || (typeof tab.label === "string" ? tab.label : undefined)}
            >
              {iconTabs ? (
                <>
                  {tab.label}
                  <span className="sr-only">
                    {tab.srLabel || (typeof tab.label === "string" ? tab.label : "Tab")}
                  </span>
                </>
              ) : (
                tab.label
              )}
            </button>
          ))}
        </div>
      </div>

      {!hideOverviewCard ? (
        <div className="mx-auto mb-3 rounded-2xl border border-sky-300/35 bg-white/90 p-3 shadow-md shadow-sky-950/20 backdrop-blur dark:border-sky-200/20 dark:bg-slate-950/90 md:hidden">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{title}</h1>
          {overviewExtra ? <div className="mt-2">{overviewExtra}</div> : null}
          {badges.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {badges.map((badge, index) => (
                <span
                  key={`${badge.label}-${index}-mobile`}
                  className={cx(
                    "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    badgeClass(badge.tone || "sky"),
                  )}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}
          {backHref ? (
            <Link
              href={backHref}
              className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-300/55 bg-white/85 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm shadow-sky-900/10 transition hover:scale-[0.98] dark:border-slate-200/25 dark:bg-slate-900/60 dark:text-slate-100"
            >
              {backLabel}
            </Link>
          ) : null}
        </div>
      ) : null}

      {showMobilePanel ? (
        <div className="mx-auto mt-3 rounded-3xl border border-sky-300/35 bg-white/90 p-3 shadow-md shadow-sky-950/20 backdrop-blur dark:border-sky-200/20 dark:bg-slate-950/90 md:hidden">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-100">
            {panelTitle}
          </h2>
          {panelBody}
        </div>
      ) : null}

      <div className="mx-auto max-w-[1500px] md:pl-[var(--studio-shell-pad)]">
        <div className="mx-auto max-w-[1320px] pb-24 pt-4 md:pb-8">{mainContent}</div>
      </div>
    </div>
  );
}
