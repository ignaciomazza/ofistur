// src/app/earnings/page.tsx
"use client";

import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { toast } from "react-toastify";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  TooltipProps,
} from "recharts";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import {
  loadFinancePicks,
  type FinanceAccount,
  type FinancePaymentMethod,
  type FinanceCurrency,
} from "@/utils/loadFinancePicks";

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

interface EarningItem {
  currency: string;
  userId: number;
  userName: string;
  teamId: number;
  teamName: string;
  totalSellerComm: number;
  totalLeaderComm: number;
  totalAgencyShare: number;
  debt: number;
  bookingIds: number[];
  bookingRefs?: Array<{
    bookingId: number;
    agencyBookingId: number | null;
  }>;
}

interface EarningsResponse {
  totals: {
    sellerComm: Record<string, number>;
    leaderComm: Record<string, number>;
    agencyShare: Record<string, number>;
  };
  statsByCurrency: Record<
    string,
    {
      saleTotal: number;
      paidTotal: number;
      debtTotal: number;
      commissionTotal: number;
      paymentRate: number;
    }
  >;
  breakdowns: {
    byCountry: Record<string, Record<string, number>>;
    byMethod: Record<string, Record<string, number>>;
  };
  items: EarningItem[];
  bookingDetails: Array<{
    bookingId: number;
    agencyBookingId: number | null;
    creationDate: string | null;
    services: Array<{
      idService: number;
      agencyServiceId: number | null;
      bookingId: number;
      agencyBookingId: number | null;
      currency: string;
      type: string;
      description: string;
      destination: string;
      sale: number;
      paid: number;
      pending: number;
      sellerCommission: number;
      leaderCommission: number;
      agencyCommission: number;
    }>;
  }>;
}

interface BookingServiceDetail {
  idService: number;
  agencyServiceId: number | null;
  bookingId: number;
  agencyBookingId: number | null;
  currency: string;
  type: string;
  description: string;
  destination: string;
  sale: number;
  paid: number;
  pending: number;
  sellerCommission: number;
  leaderCommission: number;
  agencyCommission: number;
};

type UserDetailGroup = {
  userId: number;
  userName: string;
  teamName: string;
  teamId: number;
  rows: EarningItem[];
  bookings: Array<{
    bookingId: number;
    agencyBookingId: number | null;
  }>;
  bookingDetailsById: Record<number, BookingServiceDetail[]>;
  currencies: string[];
};

type TeamLite = { id_team: number; name: string };

type FiltersState = {
  clientStatus: string;
  operatorStatus: string;
  paymentMethodId: string;
  accountId: string;
  teamId: string;
};

const GLASS =
  "rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white";
const INPUT =
  "w-full min-w-[180px] cursor-pointer rounded-2xl border border-white/20 bg-white/40 px-3 py-2 text-sm text-sky-950 shadow-sm shadow-sky-950/10 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white";
const BTN_SKY =
  "rounded-full border border-sky-200/50 bg-sky-100/70 px-4 py-2 text-sky-950 shadow-sm shadow-sky-900/20 transition hover:scale-[.98] active:scale-95 disabled:opacity-50 dark:border-sky-400/30 dark:bg-sky-900/30 dark:text-sky-100";
const BTN_ROSE =
  "rounded-full border border-rose-200/50 bg-rose-100/60 px-4 py-2 text-rose-950 shadow-sm shadow-rose-900/20 transition hover:scale-[.98] active:scale-95 disabled:opacity-50 dark:border-rose-400/30 dark:bg-rose-900/30 dark:text-rose-100";
const PILL_WHITE =
  "inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs text-sky-900 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white";
const PILL_SKY =
  "rounded-full border border-sky-200/50 bg-sky-100/70 px-3 py-1 text-xs text-sky-900 shadow-sm transition hover:bg-sky-100/90 dark:border-sky-400/30 dark:bg-sky-900/30 dark:text-sky-100";
const STACK_AMBER =
  "rounded-2xl border border-amber-200/50 bg-amber-100/10 p-3 text-amber-950 shadow-sm shadow-amber-900/10 dark:border-amber-400/5 dark:bg-amber-900/10 dark:text-amber-100";
const STACK_SKY =
  "rounded-2xl border border-sky-200/50 bg-sky-100/10 p-3 text-sky-950 shadow-sm shadow-sky-900/10 dark:border-sky-400/30 dark:bg-sky-900/10 dark:text-sky-100";
const STACK_EMERALD =
  "rounded-2xl border border-emerald-200/50 bg-emerald-100/10 p-3 text-emerald-950 shadow-sm shadow-emerald-900/10 dark:border-emerald-400/30 dark:bg-emerald-900/10 dark:text-emerald-100";
const MINI_STACK_BASE =
  "inline-flex flex-row items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] leading-tight whitespace-nowrap shadow-sm";

function getTzParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    y: parts.year,
    m: parts.month,
    d: parts.day,
  };
}

function ymdFromParts(parts: { y?: string; m?: string; d?: string }) {
  return `${parts.y || "0000"}-${parts.m || "01"}-${parts.d || "01"}`;
}

function monthRangeInTz(base = new Date(), timeZone = DEFAULT_TZ) {
  const parts = getTzParts(base, timeZone);
  return {
    from: `${parts.y}-${parts.m}-01`,
    to: ymdFromParts(parts),
  };
}

function formatMoney(value: number, code: string) {
  const n = Number.isFinite(value) ? value : 0;
  const cur = String(code || "").toUpperCase();
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: cur,
      currencyDisplay: "symbol",
    }).format(n);
  } catch {
    return `${cur} ${new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)}`;
  }
}

function clampPct(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function toSafeNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function bookingInternalLabel(agencyBookingId: number | null) {
  if (agencyBookingId && agencyBookingId > 0) return `Reserva N° ${agencyBookingId}`;
  return "Reserva sin N° interno";
}

function formatCreationDate(value: string | null | undefined) {
  if (!value) return "Sin fecha de creacion";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Sin fecha de creacion";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function currencyStackClass(currency: string) {
  const cur = String(currency || "").trim().toUpperCase();
  if (cur === "ARS") {
    return `${MINI_STACK_BASE} border-emerald-200/60 bg-emerald-100/20 text-emerald-950 shadow-emerald-900/10 dark:border-emerald-400/35 dark:bg-emerald-900/20 dark:text-emerald-100`;
  }
  if (cur === "USD") {
    return `${MINI_STACK_BASE} border-sky-200/60 bg-sky-100/20 text-sky-950 shadow-sky-900/10 dark:border-sky-400/35 dark:bg-sky-900/20 dark:text-sky-100`;
  }
  return `${MINI_STACK_BASE} border-amber-200/60 bg-amber-100/20 text-amber-950 shadow-amber-900/10 dark:border-amber-400/25 dark:bg-amber-900/20 dark:text-amber-100`;
}

const STATUS_OPTIONS = ["Todas", "Pendiente", "Pago", "Facturado"] as const;

const MoneyTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="space-y-2 rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md backdrop-blur dark:bg-sky-950/10 dark:text-white">
      {payload.map((p) => {
        const item = p.payload as EarningItem;
        const cur = item.currency;
        const val = p.value ?? 0;
        return (
          <p key={p.dataKey} className="text-sm">
            <strong>{p.name}:</strong> {formatMoney(val, cur)}
          </p>
        );
      })}
      <p className="text-sm">
        <strong>Pendiente de sus pax:</strong>{" "}
        {formatMoney(
          (payload[0].payload as EarningItem).debt,
          (payload[0].payload as EarningItem).currency,
        )}
      </p>
    </div>
  );
};

interface ChartSectionProps {
  title: string;
  data: EarningItem[];
  colors: [string, string, string];
}
const ChartSection: React.FC<ChartSectionProps> = ({ title, data, colors }) => (
  <div className={`${GLASS} mb-8`}>
    <h2 className="mb-4 text-center text-2xl font-medium">{title}</h2>
    <ResponsiveContainer width="100%" height={370}>
      <BarChart data={data} margin={{ bottom: 80 }}>
        <CartesianGrid stroke="currentColor" strokeOpacity={0.15} />
        <XAxis
          dataKey="userName"
          height={60}
          interval={0}
          angle={-45}
          textAnchor="end"
          tick={{ fill: "currentColor", fontSize: 12 }}
        />
        <YAxis tick={{ fill: "currentColor", fontSize: 12 }} />
        <Tooltip content={<MoneyTooltip />} />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ color: "currentColor" }}
          height={80}
        />
        <Bar
          dataKey="totalSellerComm"
          stackId="a"
          name="Vendedor"
          fill={colors[0]}
        />
        <Bar
          dataKey="totalLeaderComm"
          stackId="a"
          name="Lider"
          fill={colors[1]}
        />
        <Bar
          dataKey="totalAgencyShare"
          stackId="a"
          name="Agencia"
          fill={colors[2]}
          radius={[8, 8, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default function EarningsPage() {
  const { token } = useAuth();
  const { from: defaultFrom, to: defaultTo } = useMemo(
    () => monthRangeInTz(new Date(), DEFAULT_TZ),
    [],
  );
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [dateField, setDateField] = useState<"creation" | "departure">(
    "creation",
  );
  const [minPaidPct, setMinPaidPct] = useState(40);
  const [filters, setFilters] = useState<FiltersState>({
    clientStatus: "Todas",
    operatorStatus: "Todas",
    paymentMethodId: "",
    accountId: "",
    teamId: "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewMode, setViewMode] = useState<"charts" | "details">("charts");
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());

  const [currencyCodes, setCurrencyCodes] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<FinancePaymentMethod[]>(
    [],
  );
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [teams, setTeams] = useState<TeamLite[]>([]);

  const loadFilters = useCallback(async () => {
    if (!token) return;
    try {
      const profileRes = await authFetch(
        "/api/user/profile",
        { cache: "no-store" },
        token,
      );
      if (!profileRes.ok) throw new Error("No se pudo cargar el perfil");
      const profile = (await profileRes.json()) as {
        id_agency: number;
      };

      const [picks, teamsRes] = await Promise.all([
        loadFinancePicks(token),
        authFetch(
          `/api/teams?agencyId=${profile.id_agency}`,
          { cache: "no-store" },
          token,
        ),
      ]);

      const rawCurrencies = (picks?.currencies ?? []) as FinanceCurrency[];
      const enabledCurrencies = rawCurrencies.filter((c) => !!c.enabled);
      setCurrencyCodes(enabledCurrencies.map((c) => c.code));
      setPaymentMethods((picks?.paymentMethods ?? []).filter((m) => m.enabled));
      setAccounts((picks?.accounts ?? []).filter((a) => a.enabled));

      if (teamsRes.ok) {
        const teamsJson = (await teamsRes.json()) as TeamLite[];
        setTeams(teamsJson.map((t) => ({ id_team: t.id_team, name: t.name })));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error cargando filtros";
      toast.error(msg);
    }
  }, [token]);

  useEffect(() => {
    void loadFilters();
  }, [loadFilters]);

  const loadEarnings = useCallback(async () => {
    if (new Date(from) > new Date(to)) {
      toast.error("El rango 'Desde' no puede ser posterior a 'Hasta'");
      return;
    }
    if (!token) {
      toast.error("Sesion no iniciada");
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        from,
        to,
        tz: DEFAULT_TZ,
        dateField,
        minPaidPct: String(minPaidPct),
      });
      if (filters.clientStatus && filters.clientStatus !== "Todas")
        qs.set("clientStatus", filters.clientStatus);
      if (filters.operatorStatus && filters.operatorStatus !== "Todas")
        qs.set("operatorStatus", filters.operatorStatus);
      if (filters.paymentMethodId)
        qs.set("paymentMethodId", filters.paymentMethodId);
      if (filters.accountId) qs.set("accountId", filters.accountId);
      if (filters.teamId) qs.set("teamId", filters.teamId);

      const res = await authFetch(
        `/api/earnings?${qs.toString()}`,
        { cache: "no-store" },
        token,
      );
      if (!res.ok) throw new Error("Error al cargar ganancias");
      const json: EarningsResponse = await res.json();
      setData(json);
      setExpandedUsers(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [from, to, token, dateField, minPaidPct, filters]);

  const didRunInitial = useRef(false);
  useEffect(() => {
    if (!token || didRunInitial.current) return;
    didRunInitial.current = true;
    void loadEarnings();
  }, [token, loadEarnings]);

  const currencyOrder = useMemo(() => {
    const dataCodes = new Set<string>([
      ...(data?.items ?? []).map((i) => i.currency),
      ...Object.keys(data?.totals.sellerComm ?? {}),
      ...Object.keys(data?.statsByCurrency ?? {}),
    ]);

    if (currencyCodes.length) {
      const filtered = currencyCodes.filter((c) => dataCodes.has(c));
      return filtered.length ? filtered : currencyCodes;
    }

    return Array.from(dataCodes);
  }, [data, currencyCodes]);

  const itemsByCurrency = useMemo(() => {
    const map: Record<string, EarningItem[]> = {};
    (data?.items ?? []).forEach((item) => {
      map[item.currency] ||= [];
      map[item.currency].push(item);
    });
    return map;
  }, [data]);

  const bookingDetailsByBooking = useMemo(() => {
    const map = new Map<number, BookingServiceDetail[]>();
    (data?.bookingDetails ?? []).forEach((detail) => {
      const bid = Math.trunc(toSafeNumber(detail.bookingId));
      if (bid <= 0) return;
      const services = Array.isArray(detail.services)
        ? detail.services
            .map((svc) => ({
              idService: Math.trunc(toSafeNumber(svc.idService)),
              agencyServiceId: (() => {
                const n = Math.trunc(toSafeNumber(svc.agencyServiceId));
                return n > 0 ? n : null;
              })(),
              bookingId: Math.trunc(toSafeNumber(svc.bookingId)),
              agencyBookingId: (() => {
                const n = Math.trunc(toSafeNumber(svc.agencyBookingId));
                return n > 0 ? n : null;
              })(),
              currency: String(svc.currency || "").trim().toUpperCase(),
              type: String(svc.type || "").trim(),
              description: String(svc.description || "").trim(),
              destination: String(svc.destination || "").trim(),
              sale: toSafeNumber(svc.sale),
              paid: toSafeNumber(svc.paid),
              pending: toSafeNumber(svc.pending),
              sellerCommission: toSafeNumber(svc.sellerCommission),
              leaderCommission: toSafeNumber(svc.leaderCommission),
              agencyCommission: toSafeNumber(svc.agencyCommission),
            }))
            .filter((svc) => svc.idService > 0 && svc.bookingId > 0)
        : [];
      map.set(bid, services);
    });
    return map;
  }, [data]);

  const bookingCreationByBooking = useMemo(() => {
    const map = new Map<number, string | null>();
    (data?.bookingDetails ?? []).forEach((detail) => {
      const bid = Math.trunc(toSafeNumber(detail.bookingId));
      if (bid <= 0) return;
      const creationDate =
        typeof detail.creationDate === "string" && detail.creationDate.trim()
          ? detail.creationDate
          : null;
      map.set(bid, creationDate);
    });
    return map;
  }, [data]);

  const detailGroups = useMemo<UserDetailGroup[]>(() => {
    const map = new Map<number, UserDetailGroup>();
    (data?.items ?? []).forEach((item) => {
      const fallbackRefs = (Array.isArray(item.bookingIds) ? item.bookingIds : [])
        .map((bid) => Math.trunc(toSafeNumber(bid)))
        .filter((bid) => bid > 0)
        .map((bid) => ({ bookingId: bid, agencyBookingId: null as number | null }));

      const sourceRefs = Array.isArray(item.bookingRefs) && item.bookingRefs.length
        ? item.bookingRefs
        : fallbackRefs;

      const normalizedRefs = sourceRefs
        .map((ref) => {
          const bookingId = Math.trunc(toSafeNumber(ref.bookingId));
          const agencyBookingIdRaw = Math.trunc(toSafeNumber(ref.agencyBookingId));
          if (bookingId <= 0) return null;
          return {
            bookingId,
            agencyBookingId: agencyBookingIdRaw > 0 ? agencyBookingIdRaw : null,
          };
        })
        .filter(
          (
            ref,
          ): ref is {
            bookingId: number;
            agencyBookingId: number | null;
          } => Boolean(ref),
        );

      const existing = map.get(item.userId);
      if (!existing) {
        map.set(item.userId, {
          userId: item.userId,
          userName: item.userName,
          teamName: item.teamName,
          teamId: item.teamId,
          rows: [item],
          bookings: normalizedRefs,
          bookingDetailsById: Object.fromEntries(
            normalizedRefs.map((ref) => [
              ref.bookingId,
              bookingDetailsByBooking.get(ref.bookingId) || [],
            ]),
          ),
          currencies: [item.currency],
        });
        return;
      }

      existing.rows.push(item);
      const mergedById = new Map<number, { bookingId: number; agencyBookingId: number | null }>();
      existing.bookings.forEach((ref) => mergedById.set(ref.bookingId, ref));
      normalizedRefs.forEach((ref) => {
        const current = mergedById.get(ref.bookingId);
        if (!current) {
          mergedById.set(ref.bookingId, ref);
          return;
        }
        if (!current.agencyBookingId && ref.agencyBookingId) {
          mergedById.set(ref.bookingId, ref);
        }
      });
      existing.bookings = Array.from(mergedById.values()).sort(
        (a, b) =>
          (a.agencyBookingId ?? Number.MAX_SAFE_INTEGER) -
          (b.agencyBookingId ?? Number.MAX_SAFE_INTEGER) ||
          a.bookingId - b.bookingId,
      );
      existing.bookingDetailsById = Object.fromEntries(
        existing.bookings.map((ref) => [
          ref.bookingId,
          bookingDetailsByBooking.get(ref.bookingId) || [],
        ]),
      );
      if (!existing.currencies.includes(item.currency)) {
        existing.currencies.push(item.currency);
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      a.userName.localeCompare(b.userName, "es", {
        sensitivity: "base",
      }),
    );
  }, [bookingDetailsByBooking, data]);

  const toggleUserDetails = useCallback(
    (userId: number) => {
      setExpandedUsers((prev) => {
        const next = new Set(prev);
        if (next.has(userId)) next.delete(userId);
        else next.add(userId);
        return next;
      });
    },
    [],
  );

  const breakdownSeries = useCallback(
    (breakdown: Record<string, Record<string, number>>, cur: string) => {
      return Object.entries(breakdown)
        .map(([label, values]) => ({
          label,
          value: Number(values[cur] || 0),
        }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
    },
    [],
  );

  const resetFilters = useCallback(() => {
    setFilters({
      clientStatus: "Todas",
      operatorStatus: "Todas",
      paymentMethodId: "",
      accountId: "",
      teamId: "",
    });
    setDateField("creation");
    setMinPaidPct(40);
    setShowAdvanced(false);
    setExpandedUsers(new Set());
    const range = monthRangeInTz(new Date(), DEFAULT_TZ);
    setFrom(range.from);
    setTo(range.to);
  }, []);

  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Ganancias</h1>
            <p className="text-sm opacity-70">
              Rango en zona horaria Buenos Aires. Filtra por pagos, estados y
              fechas de viaje o creacion.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <div className="inline-flex rounded-full border border-white/20 bg-white/20 p-1 backdrop-blur">
              <button
                type="button"
                onClick={() => setViewMode("charts")}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  viewMode === "charts"
                    ? "border border-sky-300/40 bg-sky-100/70 text-sky-950 dark:border-sky-400/40 dark:bg-sky-900/40 dark:text-sky-100"
                    : "opacity-70"
                }`}
              >
                Graficos
              </button>
              <button
                type="button"
                onClick={() => setViewMode("details")}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  viewMode === "details"
                    ? "border border-sky-300/40 bg-sky-100/70 text-sky-950 dark:border-sky-400/40 dark:bg-sky-900/40 dark:text-sky-100"
                    : "opacity-70"
                }`}
              >
                Detalle por usuario
              </button>
            </div>
            <span className={PILL_WHITE}>Zona Horaria: Buenos Aires</span>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadEarnings();
          }}
          className={`${GLASS} mb-8`}
        >
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
              <div className="flex flex-col gap-2">
                <label className="block text-xs opacity-70">Desde</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className={INPUT}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="block text-xs opacity-70">Hasta</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className={INPUT}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="block text-xs opacity-70">
                  Tipo de fecha
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDateField("creation")}
                    className={`size-fit flex-1 rounded-full border border-sky-200/50 bg-sky-100/70 py-2 text-sm text-sky-950 shadow-sm shadow-sky-900/20 transition hover:scale-[.98] active:scale-95 disabled:opacity-50 dark:border-sky-400/30 dark:bg-sky-900/30 dark:text-sky-100 ${
                      dateField === "creation"
                        ? "border-sky-400/50"
                        : "opacity-70"
                    }`}
                  >
                    Creacion
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateField("departure")}
                    className={`size-fit flex-1 rounded-full border border-sky-200/50 bg-sky-100/70 py-2 text-sm text-sky-950 shadow-sm shadow-sky-900/20 transition hover:scale-[.98] active:scale-95 disabled:opacity-50 dark:border-sky-400/30 dark:bg-sky-900/30 dark:text-sky-100 ${
                      dateField === "departure"
                        ? "border-sky-400/50"
                        : "opacity-70"
                    }`}
                  >
                    Viaje
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="block text-xs opacity-70">
                  Cobrado minimo (%)
                </label>
                <div className="flex items-center justify-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={minPaidPct}
                    onChange={(e) => setMinPaidPct(clampPct(e.target.value))}
                    className="w-full accent-sky-500 hover:cursor-pointer"
                  />
                  <span className="text-sm font-medium">{minPaidPct}%</span>
                </div>
                <p className="mt-1 text-[11px] opacity-60">
                  Aplica a reservas con al menos este % cobrado. (recibos
                  iguales o mayores al {minPaidPct}% del total de la reserva).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className={PILL_SKY}
                aria-expanded={showAdvanced}
              >
                <span className="flex items-center justify-center gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className={`size-3 transition ${
                      showAdvanced ? "rotate-180" : ""
                    }`}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m19.5 8.25-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                  {showAdvanced ? "Ocultar filtros" : "Filtros avanzados"}
                </span>
              </button>

              <div className="flex items-center gap-3">
                <button type="submit" disabled={loading} className={BTN_SKY}>
                  {loading ? (
                    <Spinner />
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        className="size-5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                        />
                      </svg>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={resetFilters}
                  className={BTN_ROSE}
                >
                  <span className="gap flex items-center justify-center gap-2 text-sm">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="size-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18 18 6M6 6l12 12"
                      />
                    </svg>
                    Limpiar
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const range = monthRangeInTz(new Date(), DEFAULT_TZ);
                    setFrom(range.from);
                    setTo(range.to);
                  }}
                  className={BTN_SKY}
                >
                  <span className="flex items-center justify-center gap-2 text-sm">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="size-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6.75 3v1.5M17.25 3v1.5M3 8.25h18M4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5V6.75a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 0 3 6.75V18a1.5 1.5 0 0 0 1.5 1.5ZM8.25 12h.008v.008H8.25V12Zm0 3h.008v.008H8.25V15Zm3-3h.008v.008H11.25V12Zm0 3h.008v.008H11.25V15Zm3-3h.008v.008H14.25V12Zm0 3h.008v.008H14.25V15Z"
                      />
                    </svg>
                    Mes actual
                  </span>
                </button>
              </div>
            </div>

            {showAdvanced && (
              <div className="grid grid-cols-1 gap-6 border-t border-white/10 pt-6 md:grid-cols-2 xl:grid-cols-4">
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">
                    Estado pax
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={`client-${opt}`}
                        type="button"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            clientStatus: opt,
                          }))
                        }
                        className={`${PILL_SKY} ${
                          filters.clientStatus === opt
                            ? "border-sky-400/50"
                            : "opacity-70"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">
                    Estado operador
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={`operator-${opt}`}
                        type="button"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            operatorStatus: opt,
                          }))
                        }
                        className={`${PILL_SKY} ${
                          filters.operatorStatus === opt
                            ? "border-sky-400/50"
                            : "opacity-70"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">
                    Metodo de pago
                  </label>
                  <select
                    value={filters.paymentMethodId}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        paymentMethodId: e.target.value,
                      }))
                    }
                    className={INPUT}
                  >
                    <option value="">Todos</option>
                    {paymentMethods.map((m) => (
                      <option key={m.id_method} value={String(m.id_method)}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">Cuenta</label>
                  <select
                    value={filters.accountId}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        accountId: e.target.value,
                      }))
                    }
                    className={INPUT}
                  >
                    <option value="">Todas</option>
                    {accounts.map((a) => (
                      <option key={a.id_account} value={String(a.id_account)}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs opacity-70">Equipo</label>
                  <select
                    value={filters.teamId}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        teamId: e.target.value,
                      }))
                    }
                    className={INPUT}
                  >
                    <option value="">Todos</option>
                    {teams.map((t) => (
                      <option key={t.id_team} value={String(t.id_team)}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </form>

        {data && currencyOrder.length > 0 && (
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            {currencyOrder.map((cur) => {
              const stats = data.statsByCurrency?.[cur];
              const totals = data.totals;
              const seller = totals?.sellerComm?.[cur] || 0;
              const leader = totals?.leaderComm?.[cur] || 0;
              const agency = totals?.agencyShare?.[cur] || 0;
              const commissionTotal =
                stats?.commissionTotal ?? seller + leader + agency;
              const paidTotal = stats?.paidTotal ?? 0;
              const debtTotal = stats?.debtTotal ?? 0;
              const payRate = stats?.paymentRate ?? 0;

              return (
                <div key={cur} className={GLASS}>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{cur}</h3>
                    <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs">
                      Tasa pago {Math.round(payRate * 100)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className={STACK_EMERALD}>
                      <p className="text-xs uppercase opacity-70">Ganancia</p>
                      <p className="text-lg font-semibold">
                        {formatMoney(commissionTotal, cur)}
                      </p>
                    </div>
                    <div className={STACK_SKY}>
                      <p className="text-xs uppercase opacity-70">Cobrado</p>
                      <p className="text-lg font-semibold">
                        {formatMoney(paidTotal, cur)}
                      </p>
                    </div>
                    <div className={STACK_AMBER}>
                      <p className="text-xs uppercase opacity-70">Pendiente</p>
                      <p className="text-lg font-semibold">
                        {formatMoney(debtTotal, cur)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <p className="uppercase opacity-60">Vendedor</p>
                      <p className="font-medium">{formatMoney(seller, cur)}</p>
                    </div>
                    <div>
                      <p className="uppercase opacity-60">Lider</p>
                      <p className="font-medium">{formatMoney(leader, cur)}</p>
                    </div>
                    <div>
                      <p className="uppercase opacity-60">Agencia</p>
                      <p className="font-medium">{formatMoney(agency, cur)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {viewMode === "charts" && (
          <>
            {currencyOrder.map((cur) => {
              const dataCur = itemsByCurrency[cur] || [];
              if (dataCur.length === 0) return null;
              return (
                <ChartSection
                  key={`chart-${cur}`}
                  title={cur}
                  data={dataCur}
                  colors={[
                    "rgba(14, 165, 233, 0.85)",
                    "rgba(56, 189, 248, 0.8)",
                    "rgba(125, 211, 252, 0.75)",
                  ]}
                />
              );
            })}

            {data && currencyOrder.length > 0 && (
              <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {currencyOrder.map((cur) => {
                  const byCountry = breakdownSeries(data.breakdowns.byCountry, cur);
                  if (!byCountry.length) return null;
                  return (
                    <div key={`country-${cur}`} className={GLASS}>
                      <h3 className="mb-3 text-base font-medium">
                        Ganancia por pais · {cur}
                      </h3>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={byCountry} margin={{ left: 8, right: 8 }}>
                          <CartesianGrid
                            stroke="currentColor"
                            strokeOpacity={0.15}
                          />
                          <XAxis dataKey="label" hide />
                          <YAxis tick={{ fill: "currentColor", fontSize: 12 }} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0];
                              return (
                                <div className="rounded-2xl border border-white/10 bg-white/80 px-3 py-2 text-xs text-sky-950 shadow-sm backdrop-blur dark:bg-sky-950/70 dark:text-white">
                                  <p className="font-medium">
                                    {row.payload?.label}
                                  </p>
                                  <p>{formatMoney(Number(row.value || 0), cur)}</p>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="value"
                            fill="rgba(14, 165, 233, 0.75)"
                            radius={[10, 10, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}

                {currencyOrder.map((cur) => {
                  const byMethod = breakdownSeries(data.breakdowns.byMethod, cur);
                  if (!byMethod.length) return null;
                  return (
                    <div key={`method-${cur}`} className={GLASS}>
                      <h3 className="mb-3 text-base font-medium">
                        Cobrado por metodo · {cur}
                      </h3>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={byMethod} margin={{ left: 8, right: 8 }}>
                          <CartesianGrid
                            stroke="currentColor"
                            strokeOpacity={0.15}
                          />
                          <XAxis dataKey="label" hide />
                          <YAxis tick={{ fill: "currentColor", fontSize: 12 }} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0];
                              return (
                                <div className="rounded-2xl border border-white/10 bg-white/80 px-3 py-2 text-xs text-sky-950 shadow-sm backdrop-blur dark:bg-sky-950/70 dark:text-white">
                                  <p className="font-medium">
                                    {row.payload?.label}
                                  </p>
                                  <p>{formatMoney(Number(row.value || 0), cur)}</p>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="value"
                            fill="rgba(56, 189, 248, 0.8)"
                            radius={[10, 10, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>
            )}

            {currencyOrder.map((cur) => {
              const dataCur = itemsByCurrency[cur] || [];
              if (dataCur.length === 0) return null;
              return (
                <div key={`tbl-${cur}`} className={`${GLASS} mb-8 overflow-x-auto`}>
                  <h3 className="mb-2 font-medium">{cur}</h3>
                  <table className="w-full text-center text-sm">
                    <thead>
                      <tr className="text-sky-700 dark:text-sky-200">
                        <th className="px-4 py-2 font-medium">Equipo</th>
                        <th className="px-4 py-2 font-medium">Vendedor</th>
                        <th className="px-4 py-2 font-medium">
                          Comision vendedor
                        </th>
                        <th className="px-4 py-2 font-medium">Comision lider</th>
                        <th className="px-4 py-2 font-medium">Agencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataCur.map((it) => (
                        <tr
                          key={`${cur}-${it.teamId}-${it.userId}`}
                          className="border-b font-light dark:border-white/10"
                        >
                          <td className="px-4 py-2">{it.teamName}</td>
                          <td className="px-4 py-2">{it.userName}</td>
                          <td className="px-4 py-2">
                            {formatMoney(it.totalSellerComm, cur)}
                          </td>
                          <td className="px-4 py-2">
                            {formatMoney(it.totalLeaderComm, cur)}
                          </td>
                          <td className="px-4 py-2">
                            {formatMoney(it.totalAgencyShare, cur)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </>
        )}

        {viewMode === "details" && data && detailGroups.length > 0 && (
          <div className="mb-8 space-y-4">
            {detailGroups.map((group) => {
              const isExpanded = expandedUsers.has(group.userId);

              return (
                <div
                  key={`detail-user-${group.userId}-${group.teamId}`}
                  className={GLASS}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">{group.userName}</h3>
                      <p className="text-xs opacity-70">
                        Equipo: {group.teamName || "Sin equipo"} · Reservas:{" "}
                        {group.bookings.length}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleUserDetails(group.userId)}
                      className={PILL_SKY}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? "Ocultar detalle" : "Ver detalle"}
                    </button>
                  </div>

                  <div className="mt-3 overflow-x-auto">
                    <div className="flex w-max flex-row flex-nowrap gap-1.5 pr-1">
                      {group.rows.map((row) => {
                        const tone = currencyStackClass(row.currency);
                        return (
                          <React.Fragment
                            key={`summary-${group.userId}-${row.currency}`}
                          >
                            <div className={tone}>
                              <span className="whitespace-nowrap text-[9px] uppercase opacity-70">
                                Comision vendedor
                              </span>
                              <span className="whitespace-nowrap text-[11px] font-semibold">
                                {formatMoney(row.totalSellerComm, row.currency)}
                              </span>
                            </div>
                            <div className={tone}>
                              <span className="whitespace-nowrap text-[9px] uppercase opacity-70">
                                Comision lider
                              </span>
                              <span className="whitespace-nowrap text-[11px] font-semibold">
                                {formatMoney(row.totalLeaderComm, row.currency)}
                              </span>
                            </div>
                            <div className={tone}>
                              <span className="whitespace-nowrap text-[9px] uppercase opacity-70">
                                Comision agencia
                              </span>
                              <span className="whitespace-nowrap text-[11px] font-semibold">
                                {formatMoney(row.totalAgencyShare, row.currency)}
                              </span>
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                      {group.bookings.length === 0 && (
                        <p className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm opacity-80">
                          No hay reservas asociadas a este usuario en el rango actual.
                        </p>
                      )}
                      {group.bookings.map((bookingRef) => {
                        const bookingId = bookingRef.bookingId;
                        const services = group.bookingDetailsById[bookingId] || [];
                        const bookingHref = `/bookings/services/${bookingId}`;
                        const bookingTitle = bookingInternalLabel(
                          bookingRef.agencyBookingId,
                        );
                        const bookingCreation = formatCreationDate(
                          bookingCreationByBooking.get(bookingId),
                        );
                        const totalsByCurrency = services.reduce(
                          (acc, svc) => {
                            const cur = svc.currency || "ARS";
                            const prev = acc[cur] || { sale: 0, paid: 0, pending: 0 };
                            prev.sale += svc.sale;
                            prev.paid += svc.paid;
                            prev.pending += svc.pending;
                            acc[cur] = prev;
                            return acc;
                          },
                          {} as Record<
                            string,
                            { sale: number; paid: number; pending: number }
                          >,
                        );

                        return (
                          <div
                            key={`booking-detail-${group.userId}-${bookingId}`}
                            className="rounded-2xl border border-white/15 bg-white/5 p-3"
                          >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium">{bookingTitle}</p>
                                <p className="text-[11px] opacity-70">{bookingCreation}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={bookingHref}
                                  className={PILL_SKY}
                                  aria-label={`Abrir ${bookingTitle}`}
                                >
                                  Ir a reserva
                                </Link>
                              </div>
                            </div>

                            {Object.keys(totalsByCurrency).length > 0 && (
                              <div className="mb-3 overflow-x-auto">
                                <div className="flex w-max flex-row flex-nowrap gap-1.5 pr-1">
                                  {Object.entries(totalsByCurrency).flatMap(
                                    ([cur, totals]) => {
                                      const tone = currencyStackClass(cur);
                                      return [
                                        <div
                                          key={`booking-total-sale-${bookingId}-${cur}`}
                                          className={tone}
                                        >
                                          <span className="whitespace-nowrap text-[9px] uppercase opacity-70">
                                            Venta
                                          </span>
                                          <span className="whitespace-nowrap text-[11px] font-semibold">
                                            {formatMoney(totals.sale, cur)}
                                          </span>
                                        </div>,
                                        <div
                                          key={`booking-total-paid-${bookingId}-${cur}`}
                                          className={tone}
                                        >
                                          <span className="whitespace-nowrap text-[9px] uppercase opacity-70">
                                            Cobrado
                                          </span>
                                          <span className="whitespace-nowrap text-[11px] font-semibold">
                                            {formatMoney(totals.paid, cur)}
                                          </span>
                                        </div>,
                                        <div
                                          key={`booking-total-pending-${bookingId}-${cur}`}
                                          className={tone}
                                        >
                                          <span className="whitespace-nowrap text-[9px] uppercase opacity-70">
                                            Saldo
                                          </span>
                                          <span className="whitespace-nowrap text-[11px] font-semibold">
                                            {formatMoney(totals.pending, cur)}
                                          </span>
                                        </div>,
                                      ];
                                    },
                                  )}
                                </div>
                              </div>
                            )}

                            {services.length === 0 ? (
                              <p className="text-xs opacity-70">
                                No hay servicios cargados para esta reserva.
                              </p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                  <thead>
                                    <tr className="border-b border-white/10 text-xs uppercase tracking-wide opacity-70">
                                      <th className="p-2 font-medium">Servicio</th>
                                      <th className="p-2 font-medium">Venta</th>
                                      <th className="p-2 font-medium">Cobrado</th>
                                      <th className="p-2 font-medium">Saldo</th>
                                      <th className="p-2 font-medium">
                                        Comision vendedor
                                      </th>
                                      <th className="p-2 font-medium">
                                        Comision lider
                                      </th>
                                      <th className="p-2 font-medium">
                                        Comision agencia
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {services.map((svc) => {
                                      const serviceLabel =
                                        svc.agencyServiceId &&
                                        svc.agencyServiceId > 0
                                          ? `Servicio N° ${svc.agencyServiceId}`
                                          : "Servicio sin N° interno";
                                      const serviceDesc = [
                                        svc.type,
                                        svc.destination,
                                        svc.description,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ");
                                      return (
                                        <tr
                                          key={`svc-${group.userId}-${bookingId}-${svc.idService}`}
                                          className="border-b border-white/10"
                                        >
                                          <td className="p-2">
                                            <p className="font-medium">
                                              {serviceLabel}
                                            </p>
                                            {serviceDesc && (
                                              <p className="text-xs opacity-70">
                                                {serviceDesc}
                                              </p>
                                            )}
                                          </td>
                                          <td className="p-2">
                                            {formatMoney(svc.sale, svc.currency)}
                                          </td>
                                          <td className="p-2">
                                            {formatMoney(svc.paid, svc.currency)}
                                          </td>
                                          <td className="p-2">
                                            {formatMoney(svc.pending, svc.currency)}
                                          </td>
                                          <td className="p-2">
                                            {formatMoney(
                                              svc.sellerCommission,
                                              svc.currency,
                                            )}
                                          </td>
                                          <td className="p-2">
                                            {formatMoney(
                                              svc.leaderCommission,
                                              svc.currency,
                                            )}
                                          </td>
                                          <td className="p-2">
                                            {formatMoney(
                                              svc.agencyCommission,
                                              svc.currency,
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {data && data.items.length === 0 && !loading && (
          <p className="text-center opacity-80">No hay datos para ese rango.</p>
        )}
      </section>
    </ProtectedRoute>
  );
}
