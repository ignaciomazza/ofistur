// src/components/SideBar.tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canAccessRouteByPlan } from "@/lib/planAccess";
import type { PlanKey } from "@/lib/billing/pricing";
import {
  FINANCE_SECTIONS,
  normalizeFinanceSectionRules,
  type FinanceSectionKey,
} from "@/utils/permissions";

interface SidebarProps {
  menuOpen: boolean;
  closeMenu: () => void;
  currentPath: string;
  collapsed: boolean;
  toggleCollapsed: () => void;
}

type Role =
  | "desarrollador"
  | "administrativo"
  | "gerente"
  | "vendedor"
  | "lider"
  | "marketing"
  | string;

/* =========================
 * Helpers (rol cookie-first)
 * ========================= */
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const row = document.cookie
    .split("; ")
    .find((r) => r.startsWith(`${encodeURIComponent(name)}=`));
  return row ? decodeURIComponent(row.split("=")[1] || "") : null;
}

function normalizeRole(raw: unknown): Role | "" {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  if (["admin", "administrador", "administrativa"].includes(s))
    return "administrativo";
  if (["dev", "developer"].includes(s)) return "desarrollador";
  return s as Role;
}

async function fetchRoleFromApis(): Promise<Role | ""> {
  try {
    // 1) /api/role (si existe)
    let r = await fetch("/api/role", { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { role?: unknown };
      const norm = normalizeRole(j?.role);
      if (norm) return norm;
    }
    // 2) /api/user/role (compat previo)
    r = await fetch("/api/user/role", { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { role?: unknown };
      const norm = normalizeRole(j?.role);
      if (norm) return norm;
    }
    // 3) /api/user/profile (fallback)
    r = await fetch("/api/user/profile", { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { role?: unknown };
      const norm = normalizeRole(j?.role);
      if (norm) return norm;
    }
  } catch {
    // silencio
  }
  return "";
}

/* ==========
 * Component
 * ========== */
export default function SideBar({
  menuOpen,
  closeMenu,
  currentPath,
  collapsed,
  toggleCollapsed,
}: SidebarProps) {
  const [mounted, setMounted] = useState(false);
  const [role, setRole] = useState<Role | "">("");
  const [financeSections, setFinanceSections] = useState<FinanceSectionKey[]>(
    [],
  );
  const [planKey, setPlanKey] = useState<PlanKey | null>(null);
  const [hasPlan, setHasPlan] = useState(false);

  // Para abortar si desmonta mientras pedimos el rol
  const fetchingRef = useRef(false);
  const refreshRole = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    const r = await fetchRoleFromApis();
    setRole(r || "");
    fetchingRef.current = false;
  }, []);

  useEffect(() => setMounted(true), []);

  // Rol cookie-first + fallbacks
  useEffect(() => {
    const fromCookie = normalizeRole(getCookie("role"));
    if (fromCookie) {
      setRole(fromCookie);
      return;
    }
    // Si no hay cookie, consultamos APIs
    void refreshRole();
  }, [refreshRole]);

  // Releer cookie al volver el foco (por si cambió en otra pestaña)
  useEffect(() => {
    const onFocus = () => {
      const cookieRole = normalizeRole(getCookie("role"));
      if (cookieRole) {
        if (cookieRole !== role) setRole(cookieRole);
        return;
      }
      if (!role) void refreshRole();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshRole, role]);

  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/finance/section-access", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) {
          if (alive) setFinanceSections([]);
          return;
        }
        const payload = (await res.json()) as { rules?: unknown };
        const rules = normalizeFinanceSectionRules(payload?.rules);
        if (alive) setFinanceSections(rules[0]?.sections ?? []);
      } catch {
        if (alive) setFinanceSections([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mounted]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/agency/plan", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) {
          if (alive) {
            setHasPlan(false);
            setPlanKey(null);
          }
          return;
        }
        const data = (await res.json()) as {
          has_plan?: boolean;
          plan_key?: PlanKey | null;
        };
        if (!alive) return;
        setHasPlan(Boolean(data?.has_plan));
        setPlanKey(data?.plan_key ?? null);
      } catch {
        if (!alive) return;
        setHasPlan(false);
        setPlanKey(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // =========================
  // ACL por ruta (más simple)
  // =========================
  const routeAccess = useMemo(() => {
    const adm: Role[] = ["desarrollador", "gerente", "administrativo"];
    const devMgr: Role[] = ["desarrollador", "gerente"];
    const insightsRoles: Role[] = [...adm, "marketing"];
    const devOnly: Role[] = ["desarrollador"];

    return {
      "/groups": devOnly,
      "/operators": ["desarrollador", "administrativo", "gerente"],
      "/operators/payments": ["desarrollador", "administrativo", "gerente"],
      "/operators/panel": ["desarrollador", "administrativo", "gerente"],
      "/operators/insights": ["desarrollador", "administrativo", "gerente"],
      "/agency": devMgr,
      "/agency/subscription": devOnly,
      "/agency/storage": adm,
      "/dev/collections/fx": devOnly,
      "/dev/collections/recurring": devOnly,
      "/arca": devMgr,
      "/teams": devMgr,
      "/invoices": adm,
      "/quotes/config": adm,
      "/bookings/config": adm,
      "/groups/config": devOnly,
      "/balances": adm,
      "/earnings": adm,
      "/earnings/my": [
        "desarrollador",
        "gerente",
        "administrativo",
        "vendedor",
        "lider",
      ],
      "/investments": adm,
      "/receipts": adm,
      "/finance/payment-plans": adm,
      "/receipts/verify": adm,
      "/other-incomes": adm,
      "/other-incomes/verify": adm,
      "/finance/config": adm,
      "/clients/config": adm,
      "/credits": adm,
      "/cashbox": adm,
      "/finance/pases-saldo": adm,
      "/insights": insightsRoles,
      "/dev/agencies": devOnly,
      "/dev/agencies/leads": devOnly,
      // por defecto -> sin restricción
    } as Record<string, Role[]>;
  }, []);

  const financeRouteMap = useMemo(() => {
    const map = new Map<FinanceSectionKey, string>();
    FINANCE_SECTIONS.forEach((section) => map.set(section.key, section.route));
    return map;
  }, []);

  const extraRoutes = useMemo(() => {
    const set = new Set<string>();
    for (const key of financeSections) {
      const route = financeRouteMap.get(key);
      if (route) set.add(route);
    }
    return set;
  }, [financeRouteMap, financeSections]);

  const hasAccess = useCallback(
    (route: string): boolean => {
      if (!role) return false;
      if (!canAccessRouteByPlan(planKey, hasPlan, route)) return false;
      const allow = routeAccess[route];
      if (!allow) return true;
      if (allow.includes(role)) return true;
      return extraRoutes.has(route);
    },
    [extraRoutes, hasPlan, planKey, role, routeAccess],
  );

  // Activo: exacto o subrutas (e.g., /earnings/my o /bookings/123)
  const isActive = useCallback(
    (route: string) =>
      currentPath === route ||
      (route !== "/" && currentPath.startsWith(route + "/")),
    [currentPath],
  );

  const itemCls = (active: boolean) =>
    [
      "group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium tracking-wide text-sky-950/90 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 dark:text-white/90",
      active ? "bg-white/20 shadow-sm shadow-sky-950/10" : "hover:bg-white/10",
    ].join(" ");

  // ==============================
  // Definición de secciones/ítems
  // ==============================
  const sections = useMemo(() => {
    const chunks: {
      id: string;
      title: string;
      items: { href: string; label: string }[];
    }[] = [
      {
        id: "pasajeros",
        title: "Pasajeros",
        items: [
          { href: "/clients", label: "Pasajeros" },
          hasAccess("/client-stats")
            ? { href: "/client-stats", label: "Estadísticas" }
            : null,
          hasAccess("/clients/config")
            ? { href: "/clients/config", label: "Configuración" }
            : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
      {
        id: "reservas",
        title: "Reservas",
        items: [
          { href: "/bookings", label: "Reservas" },
          hasAccess("/insights")
            ? { href: "/insights", label: "Estadísticas" }
            : null,
          hasAccess("/invoices")
            ? { href: "/invoices", label: "Facturas" }
            : null,
          hasAccess("/bookings/config")
            ? { href: "/bookings/config", label: "Configuración" }
            : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
      {
        id: "grupales",
        title: "Grupales",
        items: [
          hasAccess("/groups") ? { href: "/groups", label: "Grupales" } : null,
          hasAccess("/groups/config")
            ? { href: "/groups/config", label: "Configuración" }
            : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
      {
        id: "cotizaciones",
        title: "Cotizaciones",
        items: [
          { href: "/quotes", label: "Cotizaciones" },
          hasAccess("/templates")
            ? { href: "/templates", label: "PDFs" }
            : null,
          hasAccess("/quotes/config")
            ? { href: "/quotes/config", label: "Configuración" }
            : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
      {
        id: "finanzas",
        title: "Finanzas",
        items: [
          hasAccess("/cashbox") ? { href: "/cashbox", label: "Caja" } : null,
          hasAccess("/credits")
            ? { href: "/credits", label: "Créditos" }
            : null,
          hasAccess("/finance/pases-saldo")
            ? { href: "/finance/pases-saldo", label: "Pases de saldo" }
            : null,
          hasAccess("/investments")
            ? { href: "/investments", label: "Inversión" }
            : null,
          hasAccess("/receipts")
            ? { href: "/receipts", label: "Recibos" }
            : null,
          hasAccess("/finance/payment-plans")
            ? { href: "/finance/payment-plans", label: "Planes de pago" }
            : null,
          hasAccess("/other-incomes")
            ? { href: "/other-incomes", label: "Ingresos" }
            : null,
          hasAccess("/receipts/verify")
            ? { href: "/receipts/verify", label: "Verificación ingresos" }
            : null,
          hasAccess("/balances")
            ? { href: "/balances", label: "Saldos" }
            : null,
          hasAccess("/earnings")
            ? { href: "/earnings", label: "Ganancias" }
            : null,
          hasAccess("/earnings/my")
            ? { href: "/earnings/my", label: "Mis Ganancias" }
            : null,
          hasAccess("/finance/config")
            ? { href: "/finance/config", label: "Configuración" }
            : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
      {
        id: "operadores",
        title: "Operadores",
        items: [
          hasAccess("/operators")
            ? { href: "/operators", label: "Operadores" }
            : null,
          hasAccess("/operators/payments")
            ? { href: "/operators/payments", label: "Pagos" }
            : null,
          hasAccess("/operators/panel")
            ? { href: "/operators/panel", label: "Panel" }
            : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
      {
        id: "recursos",
        title: "Recursos",
        items: [
          hasAccess("/resources")
            ? { href: "/resources", label: "Recursos" }
            : null,
          hasAccess("/calendar")
            ? { href: "/calendar", label: "Calendario" }
            : null,
          hasAccess("/templates")
            ? { href: "/templates", label: "Templates" }
            : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
      {
        id: "agencia",
        title: "Agencia",
        items: [
          hasAccess("/agency") ? { href: "/agency", label: "Agencia" } : null,
          hasAccess("/agency/subscription")
            ? { href: "/agency/subscription", label: "Suscripción" }
            : null,
          hasAccess("/agency/storage")
            ? { href: "/agency/storage", label: "Almacenamiento" }
            : null,
          hasAccess("/arca") ? { href: "/arca", label: "Conectar ARCA" } : null,
          hasAccess("/users")
            ? {
                href: "/users",
                label:
                  role === "gerente" ||
                  role === "desarrollador" ||
                  role === "administrativo"
                    ? "Usuarios"
                    : "Usuario",
              }
            : null,
          hasAccess("/teams") ? { href: "/teams", label: "Equipos" } : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
      {
        id: "dev",
        title: "Dev",
        items: [
          hasAccess("/dev/agencies")
            ? { href: "/dev/agencies", label: "Agencias" }
            : null,
          hasAccess("/dev/agencies/leads")
            ? { href: "/dev/agencies/leads", label: "Leads" }
            : null,
          hasAccess("/dev/collections/fx")
            ? { href: "/dev/collections/fx", label: "Cotización BSP" }
            : null,
          hasAccess("/dev/collections/recurring")
            ? { href: "/dev/collections/recurring", label: "Cobranzas recurrentes" }
            : null,
        ].filter(Boolean) as { href: string; label: string }[],
      },
    ];

    return chunks.filter((sec) => sec.items.length > 0);
  }, [hasAccess, role]);

  // =========================================
  // Estado de colapso por sección (persistido)
  // Usamos una clave por rol para no mezclar
  // =========================================
  const STORAGE_KEY = useMemo(
    () => `sidebar-sections-expanded:${role || "anon"}`,
    [role],
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Evitamos reinit salvo cambio de rol (clave distinta)
  const initKeyRef = useRef<string | null>(null);
  const buildDefaultExpanded = useCallback(() => {
    const init: Record<string, boolean> = {};
    const firstId = sections[0]?.id;
    sections.forEach((s) => (init[s.id] = s.id === firstId));
    return init;
  }, [sections]);

  useEffect(() => {
    if (!mounted) return;
    if (initKeyRef.current === STORAGE_KEY) return;
    initKeyRef.current = STORAGE_KEY;
    let next = buildDefaultExpanded();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        next = { ...next, ...parsed };
      }
    } catch {
      // noop
    }
    setExpanded(next);
  }, [buildDefaultExpanded, mounted, STORAGE_KEY]);

  // Persistir cambios
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
    } catch {
      // noop
    }
  }, [expanded, mounted, STORAGE_KEY]);

  // Auto-expandir la sección que contiene el item activo
  useEffect(() => {
    const idx = sections.findIndex((sec) =>
      sec.items.some((it) => isActive(it.href)),
    );
    if (idx >= 0) {
      const id = sections[idx].id;
      setExpanded((prev) => ({ ...prev, [id]: true }));
    }
  }, [currentPath, sections, isActive]);

  const toggleSection = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  if (!mounted) return null;

  return (
    <aside
      className={`fixed left-0 top-0 z-50 h-dvh w-[78vw] max-w-72 overflow-y-auto border-r border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur-lg transition-[transform,opacity] duration-300 ease-out md:block md:w-52 md:border-none md:bg-transparent md:shadow-none ${
        menuOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"
      } ${
        collapsed
          ? "md:pointer-events-none md:-translate-x-full md:opacity-0"
          : "md:translate-x-0 md:opacity-100"
      }`}
      aria-label="Barra lateral de navegación"
      aria-hidden={collapsed && !menuOpen}
    >
      <nav className="flex min-h-full flex-col pb-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-950/60 dark:text-white/60">
            Menú
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden rounded-full border border-white/20 bg-white/20 p-2 text-sky-900 transition hover:bg-white/30 dark:text-white md:inline-flex"
            aria-label={collapsed ? "Mostrar sidebar" : "Ocultar sidebar"}
            aria-pressed={collapsed}
          >
            {collapsed ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
          </button>
        </div>
        <ul className="flex flex-1 flex-col items-stretch gap-4 pt-1">
          {/* Perfil */}
          <li className="w-full transition-transform active:scale-[0.98]">
            <Link
              href="/profile"
              className={itemCls(isActive("/profile"))}
              onClick={closeMenu}
              aria-current={isActive("/profile") ? "page" : undefined}
            >
              <span className="flex-1">Perfil</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="size-4 text-sky-950/70 transition-colors group-hover:text-sky-950 dark:text-white/70 dark:group-hover:text-white"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
                />
              </svg>
            </Link>
          </li>
          <li className="w-full transition-transform active:scale-[0.98]">
            <Link
              href="/quick-load"
              className={itemCls(isActive("/quick-load"))}
              onClick={closeMenu}
              aria-current={isActive("/quick-load") ? "page" : undefined}
            >
              <span className="flex-1">Carga rapida</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="size-4 text-sky-950/70 transition-colors group-hover:text-sky-950 dark:text-white/70 dark:group-hover:text-white"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 3.75 6 13.5h5.25L10.5 20.25 18 10.5h-5.25L13.5 3.75Z"
                />
              </svg>
            </Link>
          </li>

          {/* Secciones */}
          {sections.map((sec) => {
            const open = !!expanded[sec.id];
            const anyActive = sec.items.some((it) => isActive(it.href));
            return (
              <li key={sec.id} className="w-full select-none">
                <button
                  type="button"
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold tracking-wide text-sky-950/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 dark:text-white/80 ${
                    anyActive
                      ? "bg-white/15 shadow-sm shadow-sky-950/10"
                      : "hover:bg-white/10"
                  }`}
                  onClick={() => toggleSection(sec.id)}
                  aria-expanded={open}
                  aria-controls={`sec-${sec.id}`}
                >
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em]">
                    {sec.title}
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                </button>

                <div
                  id={`sec-${sec.id}`}
                  className={`mt-2 grid transition-[grid-template-rows,opacity] duration-300 ${
                    open
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                  aria-hidden={!open}
                >
                  <div className="overflow-hidden">
                    <ul className="mb-3 space-y-2 pl-1">
                      {sec.items.map((it) => {
                        const active = isActive(it.href);
                        return (
                          <li
                            key={it.href}
                            className="transition-transform active:scale-[0.98]"
                          >
                            <Link
                              href={it.href}
                              className={itemCls(active)}
                              onClick={closeMenu}
                              aria-current={active ? "page" : undefined}
                            >
                              <span className="flex-1">{it.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
