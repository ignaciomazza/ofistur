// src/app/client-stats/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Link from "next/link";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { authFetch } from "@/utils/authFetch";
import { useAuth } from "@/context/AuthContext";
import {
  formatDateOnlyInBuenosAires,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";
import {
  downloadCsvFile,
  toCsvHeaderRow,
  toCsvRow,
} from "@/utils/csv";
import ClientStatsView, {
  type VisibleKey,
  type ColumnDef,
  type StatsState,
} from "@/components/clients-stats/ClientStatsView";
import {
  normalizeClientRecord,
  DEFAULT_CONFIG,
  type NormalizeContext,
} from "@/utils/normalize";

/* =========================================================
 * TIPOS QUE VIENEN DE LA API
 * ========================================================= */
type UserLite = {
  id_user: number;
  first_name: string;
  last_name: string;
  role: string;
  id_agency: number;
  email?: string | null;
};

type ClientItem = {
  id_client: number;
  agency_client_id?: number | null;
  first_name: string;
  last_name: string;
  phone: string;
  address?: string | null;
  postal_code?: string | null;
  locality?: string | null;
  company_name?: string | null;
  tax_id?: string | null;
  commercial_address?: string | null;
  dni_number?: string | null;
  passport_number?: string | null;
  birth_date: string;
  nationality: string;
  gender: string;
  email?: string | null;
  registration_date: string;
  id_user: number;
  user?: UserLite | null;
};

type ClientsAPI = {
  items: ClientItem[];
  nextCursor: number | null;
  error?: string;
};

/* =========================================================
 * COLUMNAS VISIBLES
 * ========================================================= */
const ALL_COLUMNS: ColumnDef[] = [
  { key: "id_client", label: "ID", always: true },
  { key: "full_name", label: "Nombre y Apellido" },
  { key: "phone", label: "Teléfono" },
  { key: "email", label: "Email" },
  { key: "owner", label: "Vendedor" },
  { key: "dni_number", label: "DNI" },
  { key: "passport_number", label: "Pasaporte" },
  { key: "tax_id", label: "CUIT/CUIL" },
  { key: "nationality", label: "Nacionalidad" },
  { key: "gender", label: "Género" },
  { key: "birth_date", label: "Nacimiento" },
  { key: "age", label: "Edad" },
  { key: "locality", label: "Localidad" },
  { key: "registration_date", label: "Registrado" },
];
const ALL_COLUMN_KEYS = new Set<VisibleKey>(ALL_COLUMNS.map((c) => c.key));

/* =========================================================
 * HELPERS DE FORMATEO / RENDER
 * ========================================================= */
function formatDateAR(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-AR");
}

function valueFor(
  col: VisibleKey,
  c: ClientItem & ReturnType<typeof normalizeClientRecord>,
): React.ReactNode {
  switch (col) {
    case "id_client":
      return (
        <Link
          href={`/clients/${c.id_client}`}
          className="underline decoration-transparent hover:decoration-sky-600"
        >
          {c.agency_client_id ?? c.id_client}
        </Link>
      );
    case "full_name":
      return c._fullName || `${c.last_name} ${c.first_name}`.trim();
    case "phone":
      if (c._phone.empty) return "—";
      return c._phone.hasPlus ? c._phone.e164Like : c._phone.national;
    case "email":
      return c._email.empty ? "—" : c._email.value;
    case "owner":
      return (
        c._owner || (c.user ? `${c.user.first_name} ${c.user.last_name}` : "—")
      );
    case "dni_number":
      return c._docDNI.empty ? "—" : c._docDNI.formatted || c._docDNI.digits;
    case "passport_number":
      return c._passport.empty ? "—" : c._passport.value;
    case "tax_id":
      if (!c._docCUIT || c._docCUIT.empty) return "—";
      return c._docCUIT.formatted || c._docCUIT.digits;
    case "nationality":
      return c._natDisplay || "—"; // solo el nombre del país
    case "gender":
      return c._gender || "—";
    case "birth_date":
      return c.birth_date ? formatDateOnlyInBuenosAires(c.birth_date) : "—";
    case "age":
      return typeof c._age === "number" ? c._age : "—";
    case "locality":
      return c._locality || "—";
    case "registration_date":
      return formatDateAR(c.registration_date);
  }
}

function toCSVCell(
  col: VisibleKey,
  c: ClientItem & ReturnType<typeof normalizeClientRecord>,
): string {
  const v = valueFor(col, c);
  const raw =
    typeof v === "string" || typeof v === "number"
      ? String(v)
      : String(c.id_client);
  return raw;
}

/* =========================================================
 * 🔄 BÚSQUEDA FLEXIBLE (mismo motor que /clients)
 * ========================================================= */
function normText(s: string | undefined | null): string {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function levenshteinDist(aRaw: string, bRaw: string): number {
  const a = aRaw;
  const b = bRaw;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}
function matchScoreFlexible(queryNorm: string, candidateRaw: string): number {
  if (!candidateRaw) return 9999;
  const cand = normText(candidateRaw);
  if (!cand) return 9999;
  if (cand.startsWith(queryNorm)) return 0;
  if (cand.includes(queryNorm)) return 1;
  const dist = levenshteinDist(queryNorm, cand);
  return 2 + dist;
}
function scoreClientFlexible(c: ClientItem, queryNorm: string): number {
  const combos = [
    `${c.first_name || ""} ${c.last_name || ""}`,
    `${c.last_name || ""} ${c.first_name || ""}`,
    c.dni_number || "",
    c.passport_number || "",
    c.tax_id || "",
    c.phone || "",
    c.email || "",
    c.company_name || "",
    c.locality || "",
  ];
  let best = Infinity;
  for (const field of combos) {
    const s = matchScoreFlexible(queryNorm, field);
    if (s < best) best = s;
  }
  return best;
}
function rankClientsByQuery(list: ClientItem[], query: string): ClientItem[] {
  const qNorm = normText(query);
  if (!qNorm) return list;
  return [...list].sort(
    (a, b) => scoreClientFlexible(a, qNorm) - scoreClientFlexible(b, qNorm),
  );
}

/* =========================================================
 * PAGE (lógica, estado y fetch)
 * ========================================================= */
export default function ClientStatsPage() {
  const { token, user } = useAuth() as {
    token?: string | null;
    user?: {
      id_user?: number;
      role?: string;
      first_name?: string;
      last_name?: string;
    } | null;
  };

  const role = (user?.role || "").toLowerCase();
  const isVendor = role === "vendedor";
  const canPickOwner = [
    "gerente",
    "administrativo",
    "desarrollador",
    "lider",
  ].includes(role);

  /* ------------ filtros ------------- */
  const [q, setQ] = useState("");
  const [ownerId, setOwnerId] = useState<number | 0>(0);
  const [gender, setGender] = useState<"" | "M" | "F" | "X">("");
  const [hasPhone, setHasPhone] = useState<"" | "yes" | "no">("");
  const [hasEmail, setHasEmail] = useState<"" | "yes" | "no">("");
  const [nat, setNat] = useState<string>("");
  const [ageMin, setAgeMin] = useState<string>("");
  const [ageMax, setAgeMax] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);

  /* ------------ data tabla paginada ------------- */
  const [data, setData] = useState<ClientItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageInit, setPageInit] = useState(false);

  /* ------------ stats ------------- */
  const EMPTY_STATS: StatsState = useMemo(
    () => ({
      count: 0,
      recent30d: 0,
      withPhoneN: 0,
      withEmailN: 0,
      avgAge: null,
      buckets: { u18: 0, a18_25: 0, a26_40: 0, a41_60: 0, g60: 0 },
      topOwners: [],
      topNat: [],
      topLocality: [],
      gender: { M: 0, F: 0, X: 0, U: 0 },
    }),
    [],
  );
  const [stats, setStats] = useState<StatsState>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(false);

  /* ------------ CSV ------------- */
  const [csvLoading, setCsvLoading] = useState(false);

  /* ------------ normalize ctx ------------- */
  const normCtx = useMemo<NormalizeContext>(
    () => ({ countryDefault: "AR", callingCodeDefault: "54" }),
    [],
  );

  /* ------------ columnas visibles / picker ------------- */
  const STORAGE_KEY = "client-stats-columns-minimal";
  const COLUMN_PREFS_VERSION = 2;
  const defaultVisible: VisibleKey[] = [
    "id_client",
    "full_name",
    "phone",
    "email",
    "owner",
    "dni_number",
    "birth_date",
    "age",
    "nationality",
    "registration_date",
  ];
  const [visible, setVisible] = useState<VisibleKey[]>(defaultVisible);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        visible?: unknown;
        version?: number;
      };
      if (!Array.isArray(parsed.visible)) return;

      const storedVisible = parsed.visible.filter(
        (key): key is VisibleKey =>
          typeof key === "string" && ALL_COLUMN_KEYS.has(key as VisibleKey),
      );
      if (storedVisible.length === 0) return;

      const migratedVisible =
        parsed.version === COLUMN_PREFS_VERSION
          ? storedVisible
          : Array.from(new Set<VisibleKey>([...storedVisible, "birth_date"]));
      setVisible(migratedVisible);
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: COLUMN_PREFS_VERSION, visible }),
    );
  }, [visible]);

  const allKeys = useMemo(() => ALL_COLUMNS.map((c) => c.key), []);
  const toggleCol = (k: VisibleKey) =>
    setVisible((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]));
  const setAll = () => setVisible(allKeys);
  const setNone = () =>
    setVisible(ALL_COLUMNS.filter((c) => c.always).map((c) => c.key));
  const resetCols = () =>
    setVisible(defaultVisible.filter((k) => allKeys.includes(k)));
  const visibleCols = useMemo(
    () => ALL_COLUMNS.filter((c) => c.always || visible.includes(c.key)),
    [visible],
  );

  /* ------------ normalizamos data cargada ------------- */
  const normalized = useMemo(
    () =>
      data.map((c) => ({
        ...c,
        ...normalizeClientRecord(c, normCtx, DEFAULT_CONFIG),
      })),
    [data, normCtx],
  );

  /* ------------ sort tabla ------------- */
  type SortKey =
    | "id_client"
    | "registration_date"
    | "full_name"
    | "owner"
    | "age";
  type SortDir = "asc" | "desc";
  const [sortKey, setSortKey] = useState<SortKey>("id_client");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = useCallback((k: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === k) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      } else {
        setSortDir("asc");
        return k;
      }
    });
  }, []);

  const sortVal = useCallback(
    (
      c: ClientItem & ReturnType<typeof normalizeClientRecord>,
    ): string | number => {
      switch (sortKey) {
        case "id_client":
          return c.agency_client_id ?? c.id_client;
        case "registration_date":
          return new Date(c.registration_date).getTime() || 0;
        case "age":
          return typeof c._age === "number" ? c._age : -1;
        case "owner":
          return (
            c._owner ||
            `${c.user?.first_name ?? ""} ${c.user?.last_name ?? ""}` ||
            ""
          )
            .toString()
            .toLowerCase();
        case "full_name":
          return (c._fullName || `${c.last_name} ${c.first_name}`.trim() || "")
            .toString()
            .toLowerCase();
      }
    },
    [sortKey],
  );

  /* ------------ filtros locales (recordMatches) ------------- */
  const recordMatches = useCallback(
    (c: ClientItem & ReturnType<typeof normalizeClientRecord>) => {
      if (ownerId && c.id_user !== ownerId) return false;
      if (gender && c._gender !== gender) return false;

      const hasPh = !!c._hasPhone;
      const hasEm = !!c._hasEmail;
      if (hasPhone === "yes" && !hasPh) return false;
      if (hasPhone === "no" && hasPh) return false;
      if (hasEmail === "yes" && !hasEm) return false;
      if (hasEmail === "no" && hasEm) return false;

      if (nat) {
        const key = (
          c._natDisplay ||
          c._nat?.iso2 ||
          c._nat?.label ||
          ""
        ).toLowerCase();
        if (!key.includes(nat.toLowerCase())) return false;
      }

      const min = ageMin ? Number(ageMin) : null;
      const max = ageMax ? Number(ageMax) : null;
      if (min !== null && typeof c._age === "number" && c._age < min)
        return false;
      if (max !== null && typeof c._age === "number" && c._age > max)
        return false;

      if (dateFrom || dateTo) {
        const rd = c.registration_date ? new Date(c.registration_date) : null;
        if (!rd) return false;
        if (dateFrom) {
          const df = new Date(dateFrom);
          if (rd < new Date(df.getFullYear(), df.getMonth(), df.getDate()))
            return false;
        }
        if (dateTo) {
          const dt = new Date(dateTo);
          if (
            rd >
            new Date(
              dt.getFullYear(),
              dt.getMonth(),
              dt.getDate(),
              23,
              59,
              59,
              999,
            )
          )
            return false;
        }
      }
      return true;
    },
    [
      ownerId,
      gender,
      hasPhone,
      hasEmail,
      nat,
      ageMin,
      ageMax,
      dateFrom,
      dateTo,
    ],
  );

  /* ------------ owners únicos para selector ------------- */
  const owners = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of normalized) {
      const id = c.user?.id_user ?? c.id_user;
      const name =
        c.user?.first_name || c.user?.last_name
          ? `${c.user?.first_name || ""} ${c.user?.last_name || ""}`.trim()
          : c._owner || `N° ${id}`;
      if (id) map.set(id, name || `N° ${id}`);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "es"),
    );
  }, [normalized]);

  useEffect(() => {
    if (isVendor && user?.id_user) setOwnerId(user.id_user);
  }, [isVendor, user?.id_user]);

  /* ------------ tabla filtrada + sort ------------- */
  const filteredTableRows = useMemo(() => {
    const rows = normalized.filter(recordMatches);
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sortVal(a);
      const vb = sortVal(b);
      if (typeof va === "number" && typeof vb === "number")
        return (va - vb) * factor;
      const sa = String(va);
      const sb = String(vb);
      return sa.localeCompare(sb, "es") * factor;
    });
  }, [normalized, recordMatches, sortVal, sortDir]);

  /* ------------ natOptions desde stats ------------- */
  const natOptions = useMemo(
    () => stats.topNat.slice(0, 12).map(([label]) => label),
    [stats.topNat],
  );

  /* ------------ FETCH paginado ------------- */
  const TAKE = 120;
  const API_PAGE = 120;

  const fetchPage = useCallback(
    async (resetList: boolean) => {
      setLoading(true);
      try {
        const qsBase = new URLSearchParams();
        if (q.trim()) qsBase.append("q", q.trim());
        qsBase.append("take", String(API_PAGE));
        const wantedUserId =
          isVendor && user?.id_user ? user.id_user : canPickOwner ? ownerId : 0;
        if (wantedUserId) qsBase.append("userId", String(wantedUserId));

        let nextLocal = resetList ? null : cursor;
        const collected: ClientItem[] = [];
        let loops = 0;
        const MAX_LOOPS = 25;

        while (collected.length < TAKE && loops < MAX_LOOPS) {
          const qs = new URLSearchParams(qsBase);
          if (nextLocal !== null) qs.append("cursor", String(nextLocal));

          const res = await authFetch(
            `/api/clients?${qs.toString()}`,
            { cache: "no-store" },
            token || undefined,
          );
          const json: ClientsAPI = await res.json();
          if (!res.ok)
            throw new Error(json?.error || "Error al cargar pasajeros");

          const matched = json.items.filter((rawC) => {
            const n = normalizeClientRecord(rawC, normCtx, DEFAULT_CONFIG);
            return recordMatches({ ...rawC, ...n });
          });

          collected.push(...matched);
          nextLocal = json.nextCursor ?? null;
          loops++;
          if (nextLocal === null) break;
        }

        setData((prev) => {
          const baseList = resetList ? collected : [...prev, ...collected];
          return rankClientsByQuery(baseList, q);
        });
        setCursor(nextLocal);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error al cargar pasajeros";
        toast.error(msg);
      } finally {
        setLoading(false);
        setPageInit(true);
      }
    },
    [
      q,
      token,
      cursor,
      canPickOwner,
      ownerId,
      isVendor,
      user?.id_user,
      normCtx,
      recordMatches,
    ],
  );

  /* ------------ FETCH stats (scan masivo) ------------- */
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      let total = 0;
      let recent30d = 0;
      let withPhoneN = 0;
      let withEmailN = 0;
      let ageSum = 0;
      let ageCount = 0;
      const ages: number[] = [];

      const buckets: StatsState["buckets"] = {
        u18: 0,
        a18_25: 0,
        a26_40: 0,
        a41_60: 0,
        g60: 0,
      };
      const genderCounts: StatsState["gender"] = { M: 0, F: 0, X: 0, U: 0 };

      const byOwner = new Map<string, number>();
      const byNat = new Map<string, number>();
      const byLoc = new Map<string, number>();

      const qsBase = new URLSearchParams();
      if (q.trim()) qsBase.append("q", q.trim());
      qsBase.append("take", "200");
      const wantedUserId =
        isVendor && user?.id_user ? user.id_user : canPickOwner ? ownerId : 0;
      if (wantedUserId) qsBase.append("userId", String(wantedUserId));

      let next: number | null = null;
      let pages = 0;
      const MAX_PAGES = 200;

      const NOW = Date.now();
      const cutoff30 = NOW - 30 * 24 * 60 * 60 * 1000;

      do {
        const qs = new URLSearchParams(qsBase);
        if (next !== null) qs.append("cursor", String(next));

        const res = await authFetch(
          `/api/clients?${qs.toString()}`,
          { cache: "no-store" },
          token || undefined,
        );
        const json: ClientsAPI = await res.json();
        if (!res.ok)
          throw new Error(json?.error || "Error al calcular estadísticas");

        for (const c of json.items) {
          const n = normalizeClientRecord(c, normCtx, DEFAULT_CONFIG);

          // mismos filtros que recordMatches
          if (gender && n._gender !== gender) continue;

          const hasPh = n._hasPhone;
          const hasEm = n._hasEmail;
          if (hasPhone === "yes" && !hasPh) continue;
          if (hasPhone === "no" && hasPh) continue;
          if (hasEmail === "yes" && !hasEm) continue;
          if (hasEmail === "no" && hasEm) continue;

          if (nat) {
            const key = (
              n._natDisplay ||
              n._nat?.iso2 ||
              n._nat?.label ||
              ""
            ).toLowerCase();
            if (!key.includes(nat.toLowerCase())) continue;
          }

          const a = n._age;
          const min = ageMin ? Number(ageMin) : null;
          const max = ageMax ? Number(ageMax) : null;
          if (min !== null && typeof a === "number" && a < min) continue;
          if (max !== null && typeof a === "number" && a > max) continue;

          if (dateFrom || dateTo) {
            const rd = c.registration_date
              ? new Date(c.registration_date)
              : null;
            if (!rd) continue;
            if (dateFrom) {
              const df = new Date(dateFrom);
              if (rd < new Date(df.getFullYear(), df.getMonth(), df.getDate()))
                continue;
            }
            if (dateTo) {
              const dt = new Date(dateTo);
              if (
                rd >
                new Date(
                  dt.getFullYear(),
                  dt.getMonth(),
                  dt.getDate(),
                  23,
                  59,
                  59,
                  999,
                )
              )
                continue;
            }
          }

          // acumular stats
          total++;
          if (hasPh) withPhoneN++;
          if (hasEm) withEmailN++;

          if (n._registrationTs && n._registrationTs >= cutoff30) recent30d++;

          if (typeof a === "number" && a >= 0 && a <= 120) {
            ageSum += a;
            ageCount++;
            ages.push(a);
            if (a <= 17) buckets.u18++;
            else if (a <= 25) buckets.a18_25++;
            else if (a <= 40) buckets.a26_40++;
            else if (a <= 60) buckets.a41_60++;
            else buckets.g60++;
          }

          const g = n._gender || "";
          if (g === "M") genderCounts.M++;
          else if (g === "F") genderCounts.F++;
          else if (g === "X") genderCounts.X++;
          else genderCounts.U++;

          const ownerName =
            n._owner ||
            (c.user ? `${c.user.first_name} ${c.user.last_name}` : "—");
          byOwner.set(ownerName, (byOwner.get(ownerName) || 0) + 1);

          const natKey = (n._natDisplay || "—").trim() || "—";
          byNat.set(natKey, (byNat.get(natKey) || 0) + 1);

          const locKey = (n._localityCanonical || "—").trim() || "—";
          byLoc.set(locKey, (byLoc.get(locKey) || 0) + 1);
        }

        next = json.nextCursor ?? null;
        pages++;
      } while (next !== null && pages < MAX_PAGES);

      const avgAge =
        ageCount > 0 ? Math.round((ageSum / ageCount) * 10) / 10 : null;

      const topOwners = Array.from(byOwner.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      const topNat = Array.from(byNat.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      const topLocality = Array.from(byLoc.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      setStats({
        count: total,
        recent30d,
        withPhoneN,
        withEmailN,
        avgAge,
        buckets,
        topOwners,
        topNat,
        topLocality,
        gender: genderCounts,
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Error al calcular estadísticas";
      toast.error(msg);
      setStats(EMPTY_STATS);
    } finally {
      setStatsLoading(false);
    }
  }, [
    q,
    token,
    normCtx,
    isVendor,
    user?.id_user,
    canPickOwner,
    ownerId,
    gender,
    hasPhone,
    hasEmail,
    nat,
    ageMin,
    ageMax,
    dateFrom,
    dateTo,
    EMPTY_STATS,
  ]);

  /* ------------ init / aplicar ------------- */
  const handleSearch = () => {
    setCursor(null);
    setData([]);
    fetchPage(true);
    fetchStats();
  };

  useEffect(() => {
    if (data.length === 0 && !loading) {
      fetchPage(true);
      fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------ CSV ------------- */
  const downloadCSV = async () => {
    try {
      setCsvLoading(true);

      const qsBase = new URLSearchParams();
      if (q.trim()) qsBase.append("q", q.trim());
      qsBase.append("take", "200");

      const wantedUserId =
        isVendor && user?.id_user ? user.id_user : canPickOwner ? ownerId : 0;
      if (wantedUserId) qsBase.append("userId", String(wantedUserId));

      let next: number | null = null;
      let pages = 0;
      const MAX_PAGES = 1000;

      const all: (ClientItem & ReturnType<typeof normalizeClientRecord>)[] = [];

      do {
        const qs = new URLSearchParams(qsBase);
        if (next !== null) qs.append("cursor", String(next));

        const res = await authFetch(
          `/api/clients?${qs.toString()}`,
          { cache: "no-store" },
          token || undefined,
        );
        const json: ClientsAPI = await res.json();
        if (!res.ok) throw new Error(json?.error || "Error al exportar CSV");

        for (const c of json.items) {
          const n = {
            ...c,
            ...normalizeClientRecord(c, normCtx, DEFAULT_CONFIG),
          };
          if (recordMatches(n)) all.push(n);
        }

        next = json.nextCursor ?? null;
        pages++;
      } while (next !== null && pages < MAX_PAGES);

      const factor = sortDir === "asc" ? 1 : -1;
      all.sort((a, b) => {
        const va = sortVal(a);
        const vb = sortVal(b);
        if (typeof va === "number" && typeof vb === "number") {
          return (va - vb) * factor;
        }
        const sa = String(va);
        const sb = String(vb);
        return sa.localeCompare(sb, "es") * factor;
      });

      const headerRow = toCsvHeaderRow(visibleCols.map((c) => c.label));
      const rows = all.map((c) =>
        toCsvRow(visibleCols.map((col) => ({ value: toCSVCell(col.key, c) }))),
      );
      const csv = [headerRow, ...rows].join("\r\n");
      downloadCsvFile(csv, `pasajeros_${todayDateKeyInBuenosAires()}.csv`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al exportar CSV";
      toast.error(msg);
    } finally {
      setCsvLoading(false);
    }
  };

  /* ------------ limpiar filtros ------------- */
  const clearFilters = () => {
    setGender("");
    setHasPhone("");
    setHasEmail("");
    setNat("");
    setAgeMin("");
    setAgeMax("");
    setDateFrom("");
    setDateTo("");
    if (!isVendor) setOwnerId(0);
  };

  /* ------------ RENDER ------------- */
  return (
    <ProtectedRoute>
      <ClientStatsView
        title="Client Stats"
        /* KPIs */
        stats={stats}
        statsLoading={statsLoading}
        /* Filtros */
        filters={{
          q,
          ownerId,
          isVendor,
          canPickOwner,
          vendorSelfId: user?.id_user ?? null,
          owners,
          gender,
          hasPhone,
          hasEmail,
          nat,
          natOptions,
          ageMin,
          ageMax,
          dateFrom,
          dateTo,
          filtersOpen,
        }}
        onFilters={{
          toggleFiltersOpen: () => setFiltersOpen((v) => !v),
          setQ,
          setOwnerId,
          setGender,
          setHasPhone,
          setHasEmail,
          setNat,
          setAgeMin,
          setAgeMax,
          setDateFrom,
          setDateTo,
          clearFilters,
          applyFilters: handleSearch,
        }}
        /* Columnas */
        visibleColumns={visibleCols}
        columnPicker={{
          open: pickerOpen,
          onOpen: () => setPickerOpen(true),
          onClose: () => setPickerOpen(false),
          items: ALL_COLUMNS.map((c) => ({
            key: c.key,
            label: c.label,
            locked: c.always,
          })),
          visibleKeys: visible,
          onToggle: toggleCol,
          onAll: setAll,
          onNone: setNone,
          onReset: resetCols,
        }}
        /* Tabla */
        rows={filteredTableRows}
        renderCell={(colKey, row) =>
          valueFor(
            colKey,
            row as ClientItem & ReturnType<typeof normalizeClientRecord>,
          )
        }
        /* Sorting */
        sort={{ key: sortKey, dir: sortDir }}
        onToggleSort={toggleSort}
        /* Paginación */
        tableLoading={loading}
        pageInit={pageInit}
        footer={{
          normalizedCount: normalized.length,
          canLoadMore: cursor !== null,
          onLoadMore: () => fetchPage(false),
        }}
        /* Acciones */
        onDownloadCSV={downloadCSV}
        csvLoading={csvLoading}
      />

      <ToastContainer position="bottom-right" />
    </ProtectedRoute>
  );
}
