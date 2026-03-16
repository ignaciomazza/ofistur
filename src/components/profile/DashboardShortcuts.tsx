// src/components/profile/DashboardShortcuts.tsx
"use client";

import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import {
  loadFinancePicks,
  type FinanceCurrency,
} from "@/utils/loadFinancePicks";
import {
  addDaysToDateKey,
  formatDateOnlyInBuenosAires,
  toDateKeyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";

/* ===================== tipos mínimos ===================== */
type CurrencyCode = "ARS" | "USD" | (string & {});
type Totals = Record<string, number>;
type MyEarningsResponse = {
  totals: { seller: Totals; beneficiary: Totals; grandTotal: Totals };
};
type AgencyEarningsResponse = {
  totals?: {
    sellerComm?: Totals;
    leaderComm?: Totals;
    agencyShare?: Totals;
  };
};
type ServiceCalcConfigResponse = {
  billing_breakdown_mode?: string | null;
  use_booking_sale_total?: boolean | null;
};
type EarningsScope = "personal" | "agency";

type UserLite = {
  id_user: number;
  first_name: string;
  last_name: string;
  role: string;
  id_agency: number;
};

type Booking = {
  id_booking: number;
  agency_booking_id?: number | null;
  public_id?: string | null;
  clientStatus: string;
  sale_totals?: Record<string, number | string> | null;
  departure_date?: string | null;
  return_date?: string | null;
  titular: { first_name: string; last_name: string };
  services: {
    sale_price: number | string | null;
    currency: string;
    card_interest?: number | string | null;
    taxableCardInterest?: number | string | null;
    vatOnCardInterest?: number | string | null;
  }[];
  Receipt: {
    amount: number | string | null;
    amount_currency: string;
    base_amount?: number | string | null;
    base_currency?: string | null;
    counter_amount?: number | string | null;
    counter_currency?: string | null;
    payment_fee_amount?: number | string | null;
    payment_fee_currency?: string | null;
  }[];
  user?: { id_user: number } | null;
};

type PageBookings = { items: Booking[]; nextCursor: number | null };

type SalesTeam = {
  id_team: number;
  name: string;
  user_teams: {
    user: {
      id_user: number;
      first_name: string;
      last_name: string;
      role: string;
    };
  }[];
};

/* ===================== helpers de fechas (BA-safe) ===================== */
const two = (n: number) => String(n).padStart(2, "0");
const toDateKeyOrToday = (base = new Date()) =>
  toDateKeyInBuenosAires(base) ?? new Date().toISOString().slice(0, 10);

const monthRangeInBuenosAires = (base = new Date()) => {
  const key = toDateKeyOrToday(base);
  const [yRaw, mRaw] = key.split("-");
  const year = Number(yRaw);
  const month = Number(mRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { from: key, to: key };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${two(month)}-01`,
    to: `${year}-${two(month)}-${two(lastDay)}`,
  };
};

const weekRangeInBuenosAires = (base = new Date()) => {
  const key = toDateKeyOrToday(base);
  const [yRaw, mRaw, dRaw] = key.split("-");
  const year = Number(yRaw);
  const month = Number(mRaw);
  const dayOfMonth = Number(dRaw);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(dayOfMonth)
  ) {
    return { from: key, to: key };
  }
  const day = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const from = addDaysToDateKey(key, mondayOffset) ?? key;
  const to = addDaysToDateKey(from, 6) ?? from;
  return { from, to };
};

function humanDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  return formatDateOnlyInBuenosAires(dateStr, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function toDateKey(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  return toDateKeyInBuenosAiresLegacySafe(dateStr);
}

function isDateKeyWithinRange(
  dateKey: string | null,
  fromKey: string,
  toKey: string,
): boolean {
  return Boolean(dateKey && dateKey >= fromKey && dateKey <= toKey);
}

function compareDateKeysAsc(
  aKey: string | null,
  bKey: string | null,
  aId: number,
  bId: number,
): number {
  if (aKey && bKey) {
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    return aId - bId;
  }
  if (aKey) return -1;
  if (bKey) return 1;
  return aId - bId;
}

/* ===================== helpers de dinero ===================== */
/* ===================== helpers de dinero ===================== */

/**
 * Formatea un número como moneda.
 * - Si `code` es ISO válido (3 letras) y soportado por Intl, usamos Intl.
 * - Si no, devolvemos "12.345,67 CODE" sin romper el dashboard.
 */
const fmt = (v: number, code: CurrencyCode) => {
  const amount = Number.isFinite(v) ? v : 0;
  const upper = String(code || "").toUpperCase();

  // Si la "moneda" no tiene exactamente 3 letras ya sabemos que Intl va a fallar
  if (upper.length !== 3) {
    return (
      amount.toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) +
      " " +
      upper
    );
  }

  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: upper,
    }).format(amount);
  } catch {
    // fallback seguro, sin símbolo, pero no rompe
    return (
      amount.toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) +
      " " +
      upper
    );
  }
};

const toNum = (v: number | string | null | undefined) => {
  const n =
    typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

const normCurrency = (raw: string | null | undefined): "ARS" | "USD" => {
  const s = String(raw || "")
    .trim()
    .toUpperCase();
  if (s === "USD" || s === "U$D" || s === "U$S" || s === "US$") return "USD";
  return "ARS";
};

const normalizeDashboardRole = (raw?: string | null): string => {
  const normalized = String(raw || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("gerent")) return "gerente";
  if (normalized === "admin" || normalized.startsWith("administr")) {
    return "administrativo";
  }
  return normalized;
};

const isMacroDashboardRole = (role: string) =>
  role === "gerente" || role === "administrativo";

/* ===================== UI helpers ===================== */
const glass =
  "rounded-3xl border border-white/10 bg-white/10 backdrop-blur shadow-lg shadow-sky-900/10 dark:bg-white/10 dark:border-white/5";
const chip =
  "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm";

const spanCls = (cols: 1 | 2, rows: 1 | 2) =>
  `${cols === 1 ? "col-span-1" : "col-span-1 md:col-span-2"} ${
    rows === 1 ? "row-span-1" : "row-span-2"
  }`;

/* ===================== componente ===================== */
export default function DashboardShortcuts() {
  const { token, setToken } = useAuth();

  const [profile, setProfile] = useState<UserLite | null>(null);
  const normalizedProfileRole = useMemo(
    () => normalizeDashboardRole(profile?.role),
    [profile?.role],
  );
  const isMacroView = useMemo(
    () => isMacroDashboardRole(normalizedProfileRole),
    [normalizedProfileRole],
  );
  const [enabledCurrencies, setEnabledCurrencies] = useState<FinanceCurrency[]>(
    [],
  );
  // fallback si no hay picks
  const currencyCodes = useMemo<string[]>(
    () =>
      enabledCurrencies?.length
        ? enabledCurrencies.map((c) => c.code)
        : (["ARS", "USD"] as string[]),
    [enabledCurrencies],
  );

  const { from: monthFrom, to: monthTo } = useMemo(
    monthRangeInBuenosAires,
    [],
  );
  const { from: weekFrom, to: weekTo } = useMemo(
    weekRangeInBuenosAires,
    [],
  );
  const timeZone = "America/Argentina/Buenos_Aires";

  const [loading, setLoading] = useState(true);

  const [commissionByCur, setCommissionByCur] = useState<
    Record<string, number>
  >({});
  const [newClientsCount, setNewClientsCount] = useState(0);
  const [totalBookings, setTotalBookings] = useState(0);
  const [pendingBookings, setPendingBookings] = useState<Booking[]>([]);
  const [travelWeek, setTravelWeek] = useState<{
    departing: Booking[];
    inTrip: Booking[];
    returning: Booking[];
  }>({ departing: [], inTrip: [], returning: [] });
  const [debts, setDebts] = useState<
    { booking: Booking; debtARS: number; debtUSD: number }[]
  >([]);
  const [teamsMine, setTeamsMine] = useState<SalesTeam[]>([]);
  const [calcMode, setCalcMode] = useState<"auto" | "manual">("auto");
  const [useBookingSaleTotal, setUseBookingSaleTotal] = useState(false);

  const abortedRef = useRef(false);

  /* ------------------- fetch helpers ------------------- */
  const fetchProfile = useCallback(async () => {
    const r = await authFetch(
      "/api/user/profile",
      { cache: "no-store" },
      token || undefined,
    );
    if (!r.ok) {
      console.error("[dashboard] profile status:", r.status);
      throw new Error("Error perfil");
    }
    return (await r.json()) as UserLite;
  }, [token]);

  const fetchEarnings = useCallback(
    async (curCodes: string[], scope: EarningsScope) => {
      const toCurrencyMap = (pool?: Totals): Record<string, number> => {
        const out: Record<string, number> = {};
        for (const code of curCodes) {
          const val = pool?.[code] ?? 0;
          out[code] = Number.isFinite(val) ? Number(val) : 0;
        }
        return out;
      };

      const fetchPersonal = async () => {
        const r = await authFetch(
          `/api/earnings/my?from=${monthFrom}&to=${monthTo}&tz=${encodeURIComponent(
            timeZone,
          )}`,
          { cache: "no-store" },
          token || undefined,
        );
        if (!r.ok) {
          console.error("[dashboard] earnings/my status:", r.status);
          throw new Error("Error comisiones");
        }
        const { totals } = (await r.json()) as MyEarningsResponse;
        return toCurrencyMap(totals?.grandTotal);
      };

      if (scope === "agency") {
        try {
          const r = await authFetch(
            `/api/earnings?from=${monthFrom}&to=${monthTo}`,
            { cache: "no-store" },
            token || undefined,
          );
          if (!r.ok) {
            console.error("[dashboard] earnings status:", r.status);
            throw new Error("Error comisiones agencia");
          }
          const data = (await r.json()) as AgencyEarningsResponse;
          const out: Record<string, number> = {};
          for (const code of curCodes) {
            const seller = Number(data?.totals?.sellerComm?.[code] ?? 0);
            const leader = Number(data?.totals?.leaderComm?.[code] ?? 0);
            const agency = Number(data?.totals?.agencyShare?.[code] ?? 0);
            out[code] = [seller, leader, agency].reduce(
              (acc, val) => acc + (Number.isFinite(val) ? val : 0),
              0,
            );
          }
          return out;
        } catch (err) {
          console.error("[dashboard] earnings agency fallback:", err);
          return fetchPersonal();
        }
      }

      return fetchPersonal();
    },
    [token, monthFrom, monthTo, timeZone],
  );

  const fetchBookingsPage = useCallback(
    async (params: URLSearchParams) => {
      const r = await authFetch(
        `/api/bookings?${params.toString()}`,
        { cache: "no-store" },
        token || undefined,
      );
      if (!r.ok) {
        console.error("[dashboard] bookings status:", r.status);
        throw new Error("Error reservas");
      }
      return (await r.json()) as PageBookings;
    },
    [token],
  );

  const fetchCalcConfig = useCallback(async () => {
    const r = await authFetch(
      "/api/service-calc-config",
      { cache: "no-store" },
      token || undefined,
    );
    if (!r.ok) {
      console.error("[dashboard] calc-config status:", r.status);
      throw new Error("Error calculo comisiones");
    }
    const data = (await r.json()) as ServiceCalcConfigResponse;
    return {
      calcMode:
        String(data?.billing_breakdown_mode || "").toLowerCase() === "manual"
          ? ("manual" as const)
          : ("auto" as const),
      useBookingSaleTotal: Boolean(data?.use_booking_sale_total),
    };
  }, [token]);

  const normalizeSaleTotals = (input: Booking["sale_totals"]) => {
    const out: Record<"ARS" | "USD", number> = { ARS: 0, USD: 0 };
    if (!input || typeof input !== "object") return out;
    for (const [keyRaw, val] of Object.entries(input)) {
      const cur = normCurrency(keyRaw);
      const n = toNum(val);
      if (Number.isFinite(n) && n >= 0) out[cur] = n;
    }
    return out;
  };

  const sumServices = (services: Booking["services"], withInterest: boolean) =>
    services.reduce<Record<"ARS" | "USD", number>>(
      (acc, s) => {
        const cur = normCurrency(s.currency);
        const split =
          toNum(s.taxableCardInterest ?? 0) + toNum(s.vatOnCardInterest ?? 0);
        const interest = split > 0 ? split : toNum(s.card_interest ?? 0);
        const extra = withInterest ? interest : 0;
        acc[cur] = (acc[cur] || 0) + toNum(s.sale_price) + extra;
        return acc;
      },
      { ARS: 0, USD: 0 },
    );

  const sumReceipts = (receipts: Booking["Receipt"]) =>
    receipts.reduce<Record<"ARS" | "USD", number>>((acc, r) => {
      const baseCur = r.base_currency ? normCurrency(r.base_currency) : null;
      const baseVal = toNum(r.base_amount ?? 0);

      const amountCur = r.amount_currency ? normCurrency(r.amount_currency) : null;
      const amountVal = toNum(r.amount ?? 0);

      const feeCurRaw = r.payment_fee_currency;
      const feeCur =
        feeCurRaw && String(feeCurRaw).trim() !== ""
          ? normCurrency(feeCurRaw)
          : (amountCur ?? baseCur);
      const feeVal = toNum(r.payment_fee_amount ?? 0);

      if (baseCur) {
        const val = baseVal + (feeCur === baseCur ? feeVal : 0);
        if (val) acc[baseCur] = (acc[baseCur] || 0) + val;
      } else if (amountCur) {
        const val = amountVal + (feeCur === amountCur ? feeVal : 0);
        if (val) acc[amountCur] = (acc[amountCur] || 0) + val;
      } else if (feeCur) {
        if (feeVal) acc[feeCur] = (acc[feeCur] || 0) + feeVal;
      }
      return acc;
    }, { ARS: 0, USD: 0 });

  /* ------------------- carga inicial ------------------- */
  useEffect(() => {
    if (!token) return;
    abortedRef.current = false;

    (async () => {
      setLoading(true);
      try {
        // 1) Perfil + picks (en paralelo)
        const [p, picks, calcCfg] = await Promise.all([
          fetchProfile(),
          loadFinancePicks(token).catch((e) => {
            console.error("[dashboard] loadFinancePicks:", e);
            return { currencies: [] as FinanceCurrency[] };
          }),
          fetchCalcConfig().catch((e) => {
            console.error("[dashboard] calc-config:", e);
            return {
              calcMode: "auto" as const,
              useBookingSaleTotal: false,
            };
          }),
        ]);
        if (abortedRef.current) return;

        setProfile(p);
        const enabled = (picks.currencies || []).filter((c) => c.enabled);
        setEnabledCurrencies(enabled);
        setCalcMode(calcCfg.calcMode);
        setUseBookingSaleTotal(calcCfg.useBookingSaleTotal);
        const profileRole = normalizeDashboardRole(p.role);
        const macroScope = isMacroDashboardRole(profileRole);

        // Preparo monedas a consultar (fallback ARS/USD)
        const curCodes =
          enabled.length > 0
            ? enabled.map((c) => c.code)
            : (["ARS", "USD"] as string[]);

        // 2) Resto de datos en paralelo; cada bloque maneja su propio error
        const tasks: Promise<unknown>[] = [];

        // 2.a) Comisiones
        tasks.push(
          fetchEarnings(curCodes, macroScope ? "agency" : "personal")
            .then((commission) => {
              if (!abortedRef.current) setCommissionByCur(commission);
            })
            .catch((e) => {
              console.error("[dashboard] earnings error:", e);
              if (!abortedRef.current) {
                const zero: Record<string, number> = {};
                for (const c of curCodes) zero[c] = 0;
                setCommissionByCur(zero);
              }
            }),
        );

        // 2.b) Reservas del mes (conteo) + pendientes
        tasks.push(
          (async () => {
            const qs = new URLSearchParams({
              creationFrom: monthFrom,
              creationTo: monthTo,
              take: "60",
            });
            if (!macroScope) qs.set("userId", String(p.id_user));
            const page = await fetchBookingsPage(qs);
            if (abortedRef.current) return;
            setTotalBookings(page.items.length);
            const pend = page.items
              .filter((b) => b.clientStatus === "Pendiente")
              .slice(0, 6);
            setPendingBookings(pend);
          })().catch((e) => console.error("[dashboard] reservas mes:", e)),
        );

        // 2.c) Deuda por reserva (top 6)
        tasks.push(
          (async () => {
            const qs = new URLSearchParams({ take: "120" });
            if (!macroScope) qs.set("userId", String(p.id_user));
            const { items } = await fetchBookingsPage(qs);
            if (abortedRef.current) return;

            const withDebt = items
              .map((b) => {
                const saleNoInt = calcCfg.useBookingSaleTotal
                  ? normalizeSaleTotals(b.sale_totals)
                  : sumServices(b.services, false);
                const saleWithInt = calcCfg.useBookingSaleTotal
                  ? saleNoInt
                  : sumServices(b.services, true);
                const paid = sumReceipts(b.Receipt);
                const saleForDebt =
                  calcCfg.calcMode === "manual" ? saleNoInt : saleWithInt;
                const debtARS = (saleForDebt.ARS || 0) - (paid.ARS || 0);
                const debtUSD = (saleForDebt.USD || 0) - (paid.USD || 0);
                return { booking: b, debtARS, debtUSD };
              })
              .filter((d) => d.debtARS > 1 || d.debtUSD > 0.01);

            withDebt.sort(
              (a, b) =>
                b.debtARS + b.debtUSD * 1e6 - (a.debtARS + a.debtUSD * 1e6),
            );

            setDebts(withDebt.slice(0, 6));
          })().catch((e) => console.error("[dashboard] deudas:", e)),
        );

        // 2.d) Resumen de viajes (semana actual)
        tasks.push(
          (async () => {
            const collected: Booking[] = [];
            let cursor: number | null = null;

            for (let i = 0; i < 8; i++) {
              const qs = new URLSearchParams({
                from: weekFrom,
                to: weekTo,
                take: "100",
              });
              if (!macroScope) qs.set("userId", String(p.id_user));
              if (cursor) qs.append("cursor", String(cursor));

              const page = await fetchBookingsPage(qs);
              collected.push(...page.items);

              cursor = page.nextCursor;
              if (!cursor) break;
            }
            if (abortedRef.current) return;

            const todayKey = toDateKeyOrToday();
            const uniqueById = new Map<number, Booking>();
            for (const booking of collected) uniqueById.set(booking.id_booking, booking);
            const items = Array.from(uniqueById.values()).filter(
              (b) => b.departure_date || b.return_date,
            );

            const departing = items
              .filter((b) =>
                isDateKeyWithinRange(toDateKey(b.departure_date), weekFrom, weekTo),
              )
              .sort((a, b) =>
                compareDateKeysAsc(
                  toDateKey(a.departure_date),
                  toDateKey(b.departure_date),
                  a.id_booking,
                  b.id_booking,
                ),
              )
              .slice(0, 6);

            const inTrip = items
              .filter((b) => {
                const depKey = toDateKey(b.departure_date);
                const retKey = toDateKey(b.return_date);
                if (!depKey || !retKey) return false;
                return depKey <= todayKey && retKey >= todayKey;
              })
              .sort((a, b) =>
                compareDateKeysAsc(
                  toDateKey(a.return_date),
                  toDateKey(b.return_date),
                  a.id_booking,
                  b.id_booking,
                ),
              )
              .slice(0, 6);

            const returning = items
              .filter((b) =>
                isDateKeyWithinRange(toDateKey(b.return_date), weekFrom, weekTo),
              )
              .sort((a, b) =>
                compareDateKeysAsc(
                  toDateKey(a.return_date),
                  toDateKey(b.return_date),
                  a.id_booking,
                  b.id_booking,
                ),
              )
              .slice(0, 6);

            setTravelWeek({ departing, inTrip, returning });
          })().catch((e) => console.error("[dashboard] travel week:", e)),
        );

        // 2.e) Nuevos pasajeros del mes
        tasks.push(
          (async () => {
            let count = 0;
            let cursor: number | null = null;
            for (let i = 0; i < 8; i++) {
              const qs = new URLSearchParams({
                agencyId: String(p.id_agency),
                take: "100",
              });
              if (!macroScope) qs.set("userId", String(p.id_user));
              if (cursor) qs.append("cursor", String(cursor));
              const r = await authFetch(
                `/api/clients?${qs}`,
                { cache: "no-store" },
                token || undefined,
              );
              if (!r.ok) break;
              const { items, nextCursor } = (await r.json()) as {
                items: { registration_date?: string | null }[];
                nextCursor: number | null;
              };
              for (const c of items) {
                const reg = (c.registration_date || "").slice(0, 10);
                if (reg >= monthFrom && reg <= monthTo) count++;
              }
              cursor = nextCursor;
              if (!cursor) break;
            }
            if (!abortedRef.current) setNewClientsCount(count);
          })().catch((e) => console.error("[dashboard] nuevos pasajeros:", e)),
        );

        // 2.f) Mi equipo
        tasks.push(
          (async () => {
            const r = await authFetch(
              `/api/teams?agencyId=${p.id_agency}`,
              { cache: "no-store" },
              token || undefined,
            );
            if (!r.ok) {
              console.error("[dashboard] teams status:", r.status);
              return;
            }
            const teams = (await r.json()) as SalesTeam[];
            const visibleTeams = macroScope
              ? teams
              : teams.filter((t) =>
                  t.user_teams.some((ut) => ut.user.id_user === p.id_user),
                );
            if (!abortedRef.current) setTeamsMine(visibleTeams);
          })().catch((e) => console.error("[dashboard] equipos:", e)),
        );

        await Promise.allSettled(tasks);
      } catch (e) {
        console.error("[dashboard] fatal:", e);
      } finally {
        if (!abortedRef.current) setLoading(false);
      }
    })();

    return () => {
      abortedRef.current = true;
    };
  }, [
    token,
    monthFrom,
    monthTo,
    weekFrom,
    weekTo,
    fetchProfile,
    fetchEarnings,
    fetchBookingsPage,
    fetchCalcConfig,
  ]);

  /* ===================== UI ===================== */
  const title = (b: Booking) =>
    `${(b.titular.first_name || "").toUpperCase()} ${(b.titular.last_name || "").toUpperCase()}`.trim();

  return (
    <AnimatePresence>
      <motion.div
        layout
        initial="hidden"
        animate="visible"
        exit="hidden"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.15 } },
        }}
        className="relative grid w-full grid-flow-dense auto-rows-[minmax(120px,auto)] grid-cols-1 gap-6 p-4 md:grid-cols-3 lg:grid-cols-4"
      >
        {/* Spinner global */}
        {loading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end p-4">
            <div className="rounded-2xl bg-white/60 px-3 py-2 shadow-sm backdrop-blur-md dark:bg-slate-900/50">
              <Spinner />
            </div>
          </div>
        )}

        {/* Comisiones (mes) */}
        <motion.div
          layout
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          className={`${glass} ${spanCls(2, 1)} p-6`}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-sky-900/80 dark:text-sky-100">
              {isMacroView
                ? "Comisiones de la agencia (mes actual)"
                : "Comisiones (mes actual)"}
            </p>
            <Link
              href={isMacroView ? "/earnings" : "/earnings/my"}
              className="rounded-full bg-emerald-600/10 px-3 py-1 text-xs font-medium text-emerald-800 shadow-sm shadow-emerald-900/10 hover:bg-emerald-600/20 dark:text-emerald-200"
            >
              Ver más
            </Link>
          </div>
          <p className="mb-3 text-xs opacity-70">Por moneda</p>
          <div className="flex flex-wrap gap-2">
            {currencyCodes.map((code) => (
              <span
                key={code}
                className={`${chip} border border-emerald-800/10 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200`}
              >
                {code}
                <strong className="font-semibold">
                  {fmt(commissionByCur[code] || 0, code as CurrencyCode)}
                </strong>
              </span>
            ))}
          </div>
        </motion.div>

        {/* Deuda por reserva */}
        <motion.div
          layout
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          className={`${glass} ${spanCls(2, 1)} p-6`}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-sky-900/80 dark:text-sky-100">
              {isMacroView
                ? "Deuda de reservas de la agencia"
                : "Deuda de mis reservas"}
            </p>
            <Link
              href="/balances"
              className="rounded-full bg-amber-600/10 px-3 py-1 text-xs font-medium text-amber-800 shadow-sm shadow-amber-900/10 hover:bg-amber-600/20 dark:text-amber-200"
            >
              Ver más
            </Link>
          </div>
          <p className="mb-3 text-xs opacity-70">
            Modo:{" "}
            {calcMode === "manual"
              ? "Venta sin interés tarjeta"
              : "Venta con interés tarjeta"}
            {useBookingSaleTotal ? " · Venta total de reserva" : ""}
          </p>

          {debts.length === 0 ? (
            <p className="text-sm opacity-70">Sin deudas visibles 🎉</p>
          ) : (
            <ul className="space-y-2">
              {debts.map((d) => {
                const bookingNumber =
                  d.booking.agency_booking_id ?? d.booking.id_booking;
                return (
                  <li
                    key={d.booking.id_booking}
                    className="flex items-center justify-between"
                  >
                    <Link
                      href={`/bookings/services/${d.booking.public_id ?? d.booking.id_booking}`}
                      className="truncate underline decoration-transparent hover:decoration-sky-600"
                      title={`N° ${bookingNumber} – ${title(d.booking)}`}
                    >
                      N° {bookingNumber} — {title(d.booking)}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      {d.debtARS > 0 && (
                        <span
                          className={`${chip} border bg-white/20 text-sky-900 dark:text-white`}
                        >
                          ARS <strong>{fmt(d.debtARS, "ARS")}</strong>
                        </span>
                      )}
                      {d.debtUSD > 0 && (
                        <span
                          className={`${chip} border bg-white/20 text-sky-900 dark:text-white`}
                        >
                          USD <strong>{fmt(d.debtUSD, "USD")}</strong>
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.div>

        {/* Nuevos pasajeros */}
        <motion.div
          layout
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          className={`${glass} ${spanCls(1, 1)} p-6`}
        >
          <p className="text-sm font-medium">
            {isMacroView
              ? "Nuevos pasajeros (agencia)"
              : "Nuevos pasajeros"}
          </p>
          <div className="mt-2 text-3xl font-semibold">{newClientsCount}</div>
        </motion.div>

        {/* Reservas (mes) */}
        <motion.div
          layout
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          className={`${glass} ${spanCls(1, 1)} p-6`}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">
              {isMacroView ? "Reservas de la agencia (mes)" : "Reservas (mes)"}
            </p>
            <Link
              href={`/bookings?creationFrom=${monthFrom}&creationTo=${monthTo}`}
              className="rounded-full bg-sky-600/10 px-3 py-1 text-xs font-medium text-sky-900 shadow-sm hover:bg-sky-600/20 dark:text-white"
            >
              Ver más
            </Link>
          </div>
          <div className="text-3xl font-semibold">{totalBookings}</div>
        </motion.div>

        {/* Reservas pendientes */}
        <motion.div
          layout
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          className={`${glass} ${spanCls(2, 1)} p-6`}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">
              {isMacroView
                ? "Reservas pendientes de la agencia"
                : "Reservas pendientes"}
            </p>
            <Link
              href="/bookings?clientStatus=Pendiente"
              className="rounded-full bg-amber-600/10 px-3 py-1 text-xs font-medium text-amber-800 shadow-sm shadow-amber-900/10 hover:bg-amber-600/20 dark:text-amber-200"
            >
              Ver más
            </Link>
          </div>
          {pendingBookings.length === 0 ? (
            <p className="text-sm opacity-70">No hay reservas pendientes.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {pendingBookings.map((b) => {
                const bookingNumber = b.agency_booking_id ?? b.id_booking;
                return (
                  <li key={b.id_booking}>
                    <Link
                      href={`/bookings/services/${b.public_id ?? b.id_booking}`}
                      className="underline decoration-transparent hover:decoration-sky-600"
                    >
                      N° {bookingNumber} — {title(b)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.div>

        {/* Mi equipo */}
        <motion.div
          layout
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          className={`${glass} ${spanCls(2, 1)} p-6`}
        >
          <p className="mb-1 text-sm font-medium">
            {isMacroView
              ? "Equipos visibles de la agencia"
              : `Mi equipo${profile?.first_name ? ` — ${profile.first_name}` : ""}`}
          </p>
          {teamsMine.length === 0 ? (
            <p className="text-sm opacity-70">
              {isMacroView
                ? "No hay equipos visibles para este usuario."
                : "No estás asignado a un equipo."}
            </p>
          ) : (
            <div className="space-y-3">
              {teamsMine.map((t) => (
                <div key={t.id_team}>
                  <p className="mb-1 font-medium">{t.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {t.user_teams.map((ut) => (
                      <span
                        key={ut.user.id_user}
                        className={`${chip} border bg-white/20 text-sky-900 dark:text-white`}
                        title={`${ut.user.first_name} ${ut.user.last_name}`}
                      >
                        {ut.user.first_name} {ut.user.last_name}
                        <span
                          className={`ml-1 rounded-full px-2 py-0.5 text-[10px] ${
                            ut.user.role === "lider"
                              ? "bg-sky-600/20 text-sky-900 dark:text-sky-200"
                              : "bg-emerald-600/20 text-emerald-900 dark:text-emerald-200"
                          }`}
                        >
                          {ut.user.role.toUpperCase()}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Resumen de viajes */}
        <motion.div
          layout
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          className={`${glass} ${spanCls(2, 2)} p-6`}
        >
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {isMacroView
                  ? "Movimientos de viaje de la agencia"
                  : "Movimientos de viaje"}
              </p>
              <p className="text-xs opacity-70">
                Semana: {humanDate(weekFrom)} - {humanDate(weekTo)}
              </p>
            </div>
            <Link
              href={`/bookings?from=${weekFrom}&to=${weekTo}`}
              className="rounded-full bg-sky-600/10 px-3 py-1 text-xs font-medium text-sky-900 shadow-sm hover:bg-sky-600/20 dark:text-white"
            >
              Ver más
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-sky-500/20 bg-white/20 p-3 dark:bg-white/5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-900 dark:text-sky-100">
                  Viajan esta semana
                </p>
                <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:text-sky-100">
                  {travelWeek.departing.length}
                </span>
              </div>
              {travelWeek.departing.length === 0 ? (
                <p className="text-xs opacity-70">Sin salidas en esta semana.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {travelWeek.departing.map((b) => {
                    const bookingNumber = b.agency_booking_id ?? b.id_booking;
                    return (
                      <li key={b.id_booking} className="space-y-1">
                        <Link
                          href={`/bookings/services/${b.public_id ?? b.id_booking}`}
                          className="block truncate underline decoration-transparent hover:decoration-sky-600"
                        >
                          N° {bookingNumber} — {title(b)}
                        </Link>
                        <p className="text-[11px] opacity-80">
                          Sale: {humanDate(b.departure_date)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-white/20 p-3 dark:bg-white/5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-100">
                  En viaje
                </p>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-100">
                  {travelWeek.inTrip.length}
                </span>
              </div>
              {travelWeek.inTrip.length === 0 ? (
                <p className="text-xs opacity-70">Nadie está viajando hoy.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {travelWeek.inTrip.map((b) => {
                    const bookingNumber = b.agency_booking_id ?? b.id_booking;
                    return (
                      <li key={b.id_booking} className="space-y-1">
                        <Link
                          href={`/bookings/services/${b.public_id ?? b.id_booking}`}
                          className="block truncate underline decoration-transparent hover:decoration-sky-600"
                        >
                          N° {bookingNumber} — {title(b)}
                        </Link>
                        <p className="text-[11px] opacity-80">
                          Regresa: {humanDate(b.return_date)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-white/20 p-3 dark:bg-white/5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900 dark:text-emerald-100">
                  Regresan esta semana
                </p>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-900 dark:text-emerald-100">
                  {travelWeek.returning.length}
                </span>
              </div>
              {travelWeek.returning.length === 0 ? (
                <p className="text-xs opacity-70">Sin regresos en esta semana.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {travelWeek.returning.map((b) => {
                    const bookingNumber = b.agency_booking_id ?? b.id_booking;
                    return (
                      <li key={b.id_booking} className="space-y-1">
                        <Link
                          href={`/bookings/services/${b.public_id ?? b.id_booking}`}
                          className="block truncate underline decoration-transparent hover:decoration-sky-600"
                        >
                          N° {bookingNumber} — {title(b)}
                        </Link>
                        <p className="text-[11px] opacity-80">
                          Regresa: {humanDate(b.return_date)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </motion.div>

        {/* Salir */}
        <motion.button
          type="button"
          onClick={() => setToken(null)}
          layout
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          className={`${spanCls(1, 1)} flex items-center justify-center gap-2 rounded-3xl border border-red-400/60 bg-red-600/10 p-2 text-red-700 shadow-sm hover:bg-red-600/15 dark:bg-red-900/20 dark:text-red-200`}
          title="Cerrar sesión"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.4}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6A2.25 2.25 0 0 0 5.25 5.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
            />
          </svg>
          <span className="font-medium">Salir</span>
        </motion.button>
      </motion.div>
    </AnimatePresence>
  );
}
