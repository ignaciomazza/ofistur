// src/components/ProtectedRoute.tsx
"use client";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import Spinner from "./Spinner";
import { motion, AnimatePresence } from "framer-motion";
import {
  FINANCE_SECTIONS,
  canAccessBookingComponent,
  canAccessFinanceSection,
  normalizeBookingComponentRules,
  normalizeFinanceSectionRules,
  normalizeRole,
  type BookingComponentKey,
  type FinanceSectionKey,
} from "@/utils/permissions";
import { canAccessRouteByPlan } from "@/lib/planAccess";
import type { PlanKey } from "@/lib/billing/pricing";

const DBG =
  typeof window !== "undefined" && process.env.NEXT_PUBLIC_DEBUG_AUTH === "1";

function dlog(...args: unknown[]): void {
  if (DBG) console.log("[AUTH-DEBUG][ProtectedRoute]", ...args);
}

const FINANCE_ROUTE_MATCHERS = [...FINANCE_SECTIONS]
  .map((section) => ({ key: section.key, route: section.route }))
  .sort((a, b) => b.route.length - a.route.length);

function matchFinanceSection(pathname: string): FinanceSectionKey | null {
  if (pathname === "/operators/insights" || pathname.startsWith("/operators/insights/")) {
    return "operators_insights";
  }
  for (const { key, route } of FINANCE_ROUTE_MATCHERS) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return key;
    }
  }
  return null;
}

export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { token, loading, setToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname() || "";

  const [sessionExpired, setSessionExpired] = useState(false);

  // ✅ hook dentro del componente y tipo compatible Node/DOM
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INACTIVITY_TIMEOUT = 1000 * 60 * 60 * 5; // 5h

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      dlog("inactivity timeout -> sessionExpired=true");
      setSessionExpired(true);
    }, INACTIVITY_TIMEOUT);
  }, [INACTIVITY_TIMEOUT]);

  useEffect(() => {
    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
    ];
    const handleEvent = () => resetInactivityTimer();
    events.forEach((event) => window.addEventListener(event, handleEvent));
    resetInactivityTimer();
    return () => {
      events.forEach((event) => window.removeEventListener(event, handleEvent));
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [resetInactivityTimer]);

  useEffect(() => {
    dlog("auth state changed", { loading, hasToken: !!token, path: pathname });
    if (!loading && !token) {
      dlog("no token -> push /login");
      router.push("/login");
    }
  }, [loading, token, router, pathname]);

  const [role, setRole] = useState<string | null>(null);
  const financeKey = useMemo(
    () => matchFinanceSection(pathname),
    [pathname],
  );
  const isOperatorsRoute = pathname === "/operators";
  const needsFinanceAccess = !!financeKey || isOperatorsRoute;
  const needsBookingComponentAccess =
    isOperatorsRoute || financeKey === "operator_payments";
  const [financeSections, setFinanceSections] = useState<FinanceSectionKey[]>(
    [],
  );
  const [financeReady, setFinanceReady] = useState(false);
  const [bookingComponents, setBookingComponents] = useState<
    BookingComponentKey[]
  >([]);
  const [bookingReady, setBookingReady] = useState(false);
  const [planKey, setPlanKey] = useState<PlanKey | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const [planReady, setPlanReady] = useState(false);

  useEffect(() => {
    if (loading || !token) return;

    const fetchRole = async () => {
      try {
        dlog("fetchRole() start");
        const res = await fetch("/api/user/role", { credentials: "include" });
        dlog("fetchRole() response", {
          status: res.status,
          xAuthReason: res.headers.get("x-auth-reason"),
          xAuthSource: res.headers.get("x-auth-source"),
        });

        if (res.status === 401) {
          // Sesión inválida en el server -> logout controlado
          dlog("role 401 -> clear token and go login");
          setToken(null);
          router.push("/login");
          return;
        }

        if (!res.ok) {
          // No cortar sesión por 5xx/transitorios
          dlog("role non-ok (not 401), keep token", res.status);
          setRole(null);
          return;
        }

        const data = (await res.json().catch(() => ({}))) as {
          role?: string | null;
        };
        const normalized = normalizeRole(data.role);
        setRole(normalized || null);
        dlog("role set", normalized || null);
      } catch (error) {
        console.error("[AUTH-DEBUG][ProtectedRoute] fetchRole error:", error);
        setRole(null);
      }
    };

    fetchRole();
  }, [loading, token, router, setToken]);

  useEffect(() => {
    if (loading || !token) return;
    let alive = true;
    setPlanReady(false);

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
      } finally {
        if (alive) setPlanReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [loading, token]);

  useEffect(() => {
    if (!token || !needsFinanceAccess) {
      setFinanceReady(true);
      return;
    }
    let alive = true;
    setFinanceReady(false);

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
      } finally {
        if (alive) setFinanceReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [needsFinanceAccess, token]);

  useEffect(() => {
    if (!token || !needsBookingComponentAccess) {
      setBookingComponents([]);
      setBookingReady(true);
      return;
    }
    let alive = true;
    setBookingReady(false);

    (async () => {
      try {
        const res = await fetch("/api/bookings/permissions", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) {
          if (alive) setBookingComponents([]);
          return;
        }
        const payload = (await res.json()) as { rules?: unknown };
        const rules = normalizeBookingComponentRules(payload?.rules);
        if (alive) setBookingComponents(rules[0]?.components ?? []);
      } catch {
        if (alive) setBookingComponents([]);
      } finally {
        if (alive) setBookingReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [needsBookingComponentAccess, token]);

  useEffect(() => {
    if (loading || !token) return;

    if (role) {
      const normalizedRole = normalizeRole(role);
      let allowedRoles: string[] = [];
      if (/^\/(teams|agency|arca)(\/|$)/.test(pathname)) {
        allowedRoles = ["desarrollador", "gerente"];
      } else if (pathname === "/operators") {
        allowedRoles = ["desarrollador", "administrativo", "gerente"];
      } else if (/^\/resources\/config(\/|$)/.test(pathname)) {
        allowedRoles = ["desarrollador", "gerente", "administrativo"];
      }
      dlog("route guard", {
        path: pathname,
        role: normalizedRole,
        allowed: allowedRoles,
      });
      if (allowedRoles.length > 0 && !allowedRoles.includes(normalizedRole)) {
        if (isOperatorsRoute) {
          if (!financeReady || !bookingReady) return;
          const canManageOperators =
            canAccessFinanceSection(
              normalizedRole,
              financeSections,
              "operator_payments",
            ) ||
            canAccessFinanceSection(
              normalizedRole,
              financeSections,
              "operators_insights",
            ) ||
            canAccessBookingComponent(
              normalizedRole,
              bookingComponents,
              "operator_payments",
            );
          if (canManageOperators) {
            dlog("operators route allowed by explicit grant");
          } else {
            dlog("role not allowed -> push /profile");
            router.push("/profile");
            return;
          }
        } else {
          dlog("role not allowed -> push /profile");
          router.push("/profile");
          return;
        }
      }

      if (financeKey) {
        if (!financeReady) return;
        let canAccess = canAccessFinanceSection(
          normalizedRole,
          financeSections,
          financeKey,
        );
        if (!canAccess && financeKey === "operator_payments") {
          if (!bookingReady) return;
          canAccess = canAccessBookingComponent(
            normalizedRole,
            bookingComponents,
            "operator_payments",
          );
        }
        if (!canAccess) {
          dlog("finance section not allowed -> push /profile");
          router.push("/profile");
        }
      }

      if (planReady) {
        const canAccessPlan = canAccessRouteByPlan(
          planKey,
          hasPlan,
          pathname,
        );
        if (!canAccessPlan) {
          dlog("plan not allowed -> push /profile");
          router.push("/profile");
        }
      }
    } else {
      dlog("no role yet, waiting…");
    }
  }, [
    loading,
    token,
    role,
    pathname,
    router,
    financeKey,
    financeReady,
    financeSections,
    bookingReady,
    bookingComponents,
    hasPlan,
    planKey,
    planReady,
    isOperatorsRoute,
  ]);

  const handleModalAccept = () => {
    dlog("inactivity modal: user confirmed -> clear token and /login");
    setToken(null);
    router.push("/login");
  };

  if (loading) {
    dlog("loading=true -> show spinner");
    return <Spinner />;
  }

  return (
    <>
      {token ? children : null}
      <AnimatePresence>
        {sessionExpired && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-sky-950/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          >
            <motion.div
              className="mx-auto max-w-md rounded-3xl bg-white p-8 text-center shadow-lg shadow-sky-950/10 dark:border dark:border-[#ffffff4e] dark:bg-sky-950"
              initial={{ scale: 0.8, opacity: 0, y: -50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 50 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <h2 className="mb-4 text-2xl font-semibold text-sky-950 dark:text-white">
                Sesión Expirada
              </h2>
              <p className="mb-6 font-light text-sky-950 dark:text-white">
                Tu sesión ha expirado por inactividad. Presiona
                &quot;Entendido&quot; para iniciar sesión nuevamente.
              </p>
              <button
                onClick={handleModalAccept}
                className="rounded-2xl bg-sky-100 px-4 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white dark:backdrop-blur"
              >
                Entendido
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
