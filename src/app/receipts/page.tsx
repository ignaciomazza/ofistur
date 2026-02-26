// src/app/receipts/page.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { responseErrorMessage } from "@/utils/httpError";
import { loadFinancePicks } from "@/utils/loadFinancePicks";
import ReceiptForm from "@/components/receipts/ReceiptForm";
import { useRouter } from "next/navigation";
import {
  addDaysToDateKey,
  formatDateOnlyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";
import type {
  BookingOption,
  ServiceLite,
  ReceiptPaymentLine,
} from "@/types/receipts";

/* ================= Helpers módulo (evita deps en useMemo) ================= */
const norm = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const uniqSorted = (arr: string[]) => {
  const seen = new Map<string, string>();
  for (const raw of arr) {
    if (!raw) continue;
    const key = norm(raw);
    if (!seen.has(key)) seen.set(key, String(raw).trim());
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "es"));
};

const toNum = (x: unknown) => {
  const n =
    typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? (n as number) : 0;
};

const toInputDate = (value?: string | null) => {
  if (!value) return "";
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return toDateKeyInBuenosAiresLegacySafe(raw) ?? "";
};

const slugify = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const formatMonthLabel = (d: Date) =>
  new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
  }).format(d);

const capitalize = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ================= Estilos compartidos ================= */
const GLASS =
  "rounded-3xl border border-white/30 bg-white/10 backdrop-blur shadow-lg shadow-sky-900/10 dark:bg-white/10 dark:border-white/5";
const ICON_BTN =
  "rounded-full bg-sky-100 px-4 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-[.98] active:scale-95 dark:bg-white/10 dark:text-white";
const CHIP =
  "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs shadow-sm";
const BADGE =
  "inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-medium border border-white/10 bg-white/10";
const SEGMENTED =
  "flex items-center rounded-2xl border border-white/10 bg-white/60 shadow-sm shadow-sky-950/10 backdrop-blur dark:bg-white/10";
const ACTION_BTN =
  "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs shadow-sm transition hover:bg-white/20 disabled:opacity-50 dark:bg-white/10";
const ACTION_ICON_BTN =
  "inline-flex items-center justify-center rounded-full border border-white/10 bg-white/10 p-2 text-sky-950 shadow-sm transition hover:bg-white/20 disabled:opacity-50 dark:text-white";
const STATUS_BADGE: Record<string, string> = {
  PENDING:
    "border-amber-200 bg-amber-100 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/30 dark:text-amber-100",
  VERIFIED:
    "border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/30 dark:text-emerald-100",
};
const ASSOCIATION_BADGE = {
  linked:
    "border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/30 dark:text-emerald-100",
  unlinked:
    "border-rose-200 bg-rose-100 text-rose-900 dark:border-rose-800/40 dark:bg-rose-900/30 dark:text-rose-100",
};

/* ================= Tipos de API ================= */
type ReceiptRow = {
  id_receipt: number;
  agency_receipt_id?: number | null;
  public_id?: string | null;
  receipt_number: string;
  issue_date: string | null;
  /** Importe recibido por la agencia (neto) */
  amount: number;
  amount_string: string;
  amount_currency: "ARS" | "USD" | string;
  concept: string;
  currency?: string | null; // descripción (legado: “detalle método”)
  payment_method?: string | null; // nombre método
  account?: string | null; // nombre cuenta
  payment_method_id?: number | null;
  account_id?: number | null;

  base_amount?: string | number | null;
  base_currency?: "ARS" | "USD" | string | null;
  counter_amount?: string | number | null;
  counter_currency?: "ARS" | "USD" | string | null;

  /** Costo financiero del medio de pago (tarjeta/billetera/banco…) */
  payment_fee_amount?: string | number | null;
  payment_fee_currency?: "ARS" | "USD" | string | null;

  payments?: {
    amount: number;
    payment_method_id: number | null;
    account_id: number | null;
    payment_method_text?: string;
    account_text?: string;
  }[];

  verification_status?: string | null;

  serviceIds?: number[] | null;
  clientIds?: number[] | null;
  clientLabels?: string[] | null;
  booking?: {
    id_booking: number;
    agency_booking_id?: number | null;
    public_id?: string | null;
    user?: {
      id_user: number;
      first_name: string | null;
      last_name: string | null;
      role?: string | null;
    } | null;
    titular?: {
      id_client: number;
      first_name: string | null;
      last_name: string | null;
    } | null;
  } | null;
};

type ReceiptsAPI = {
  items: ReceiptRow[];
  nextCursor: number | null;
  error?: string;
};

type User = {
  id_user: number;
  first_name: string | null;
  last_name: string | null;
  role?: string | null;
};

/* ======= Picks desde /api/finance/config ======= */
type FinanceCurrencyPick = { code: string; name: string; enabled: boolean };
type FinancePickBundle = {
  accounts: { id_account: number; name: string; enabled: boolean }[];
  paymentMethods: { id_method: number; name: string; enabled: boolean }[];
  currencies: FinanceCurrencyPick[];
};

/* ============ Normalizado para UI/CSV ============ */
type NormalizedReceipt = ReceiptRow & {
  _dateLabel: string;
  _displayReceiptNumber: string;
  _amountLabel: string; // Valor aplicado (base si existe)
  _displayAmount: number;
  _displayCurrency: string;
  _ownerFull: string;
  _titularFull: string;
  _convLabel: string; // "Base → Contra" si aplica
  _feeLabel: string; // Costo medio de pago
  _clientTotalLabel: string; // Total cobrado al pax (amount + fee)
};

type SortKey = "issue_date" | "receipt_number" | "amount" | "owner";

/* ===== Tipos auxiliares p/ búsquedas ===== */
type BookingSearchItem = {
  id_booking?: number | string | null;
  agency_booking_id?: number | string | null;
  id?: number | string | null;
  titular?: { first_name?: string | null; last_name?: string | null } | null;
  titular_name?: string | null;
  details?: string | null;
  title?: string | null;
  subtitle?: string | null;
};

type BookingServiceItem = {
  id_service?: number | string | null;
  agency_service_id?: number | string | null;
  id?: number | string | null;
  description?: string | null;
  type?: string | null;
  destination?: string | null;
  destino?: string | null;
  currency?: string | null;
  sale_currency?: string | null;
  sale_price?: number | string | null;
  card_interest?: number | string | null;
  taxableCardInterest?: number | string | null;
  vatOnCardInterest?: number | string | null;
  departure_date?: string | null;
  return_date?: string | null;
};

/* ================= Page ================= */
export default function ReceiptsPage() {
  const router = useRouter();
  const { token, user } = useAuth() as {
    token?: string | null;
    user?: { id_user?: number; role?: string } | null;
  };

  const role = (user?.role || "").toLowerCase();
  const isVendor = role === "vendedor";
  const canPickOwner = [
    "gerente",
    "administrativo",
    "desarrollador",
    "lider",
  ].includes(role);

  /* ---------- Filtros ---------- */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ownerId, setOwnerId] = useState<number | 0>(0);
  const [currency, setCurrency] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("issue_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [associationFilter, setAssociationFilter] = useState<
    "all" | "linked" | "unlinked"
  >("all");
  const [viewMode, setViewMode] = useState<"cards" | "table" | "monthly">(
    "cards",
  );

  /* ---------- Data / paginado ---------- */
  const TAKE = 24;
  const [data, setData] = useState<ReceiptRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageInit, setPageInit] = useState(false);
  const [loadingPdfId, setLoadingPdfId] = useState<number | null>(null);
  const [loadingDeleteId, setLoadingDeleteId] = useState<number | null>(null);
  const [editingReceipt, setEditingReceipt] = useState<ReceiptRow | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const lastAssociationFilter = useRef(associationFilter);
  const [servicesByBooking, setServicesByBooking] = useState<
    Record<number, ServiceLite[]>
  >({});
  const loadingServicesByBooking = useRef<Set<number>>(new Set());

  /* ---------- Config financiera (para opciones de filtros) ---------- */
  const [finance, setFinance] = useState<FinancePickBundle | null>(null);
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const picks = await loadFinancePicks(token);
        setFinance({
          accounts: picks.accounts.map((a) => ({
            id_account: a.id_account,
            name: a.name,
            enabled: a.enabled,
          })),
          paymentMethods: picks.paymentMethods.map((m) => ({
            id_method: m.id_method,
            name: m.name,
            enabled: m.enabled,
          })),
          currencies: picks.currencies.map((c) => ({
            code: c.code,
            name: c.name,
            enabled: c.enabled,
          })),
        });
      } catch {
        setFinance(null);
      }
    })();
  }, [token]);

  /* ---------- Vendedores (desde API + fallback) ---------- */
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await authFetch("/api/users", { cache: "no-store" }, token);
        if (res.ok) {
          const list = (await res.json()) as User[];
          setUsers(Array.isArray(list) ? list : []);
        }
      } catch {
        setUsers([]);
      }
    })();
  }, [token]);

  const ownerOptionsFromData = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of data) {
      const u = r.booking?.user;
      if (!u?.id_user) continue;
      const name =
        `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
        `N° ${u.id_user}`;
      map.set(u.id_user, name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const vendorOptions = useMemo(() => {
    const primary =
      users.filter((u) => (u.role || "").toLowerCase() === "vendedor").length >
      0
        ? users.filter((u) => (u.role || "").toLowerCase() === "vendedor")
        : users;

    const base = primary.map((u) => ({
      id: u.id_user,
      name:
        `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
        `N° ${u.id_user}`,
    }));

    const seen = new Set(base.map((o) => o.id));
    for (const o of ownerOptionsFromData) {
      if (!seen.has(o.id)) base.push(o);
    }

    return base.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [users, ownerOptionsFromData]);

  /* ---------- Helpers ---------- */
  const fmtMoney = useCallback((v: number, cur: string) => {
    const c = String(cur || "ARS").toUpperCase();
    try {
      const s = new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: c,
      }).format(v);
      return c === "USD" ? s.replace("US$", "U$D") : s;
    } catch {
      const sym = c === "USD" ? "U$D" : c === "ARS" ? "$" : `${c} `;
      return `${sym}${(v ?? 0).toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  }, []);

  const fmtDate = useCallback((value?: string | null) => {
    if (!value) return "";
    return formatDateOnlyInBuenosAires(value);
  }, []);

  const formatServiceRange = useCallback(
    (svc?: ServiceLite | null) => {
      if (!svc) return "";
      const dep = fmtDate(svc.departure_date ?? null);
      const ret = fmtDate(svc.return_date ?? null);
      if (dep && ret) return dep === ret ? dep : `${dep} - ${ret}`;
      if (dep) return dep;
      if (ret) return ret;
      return "";
    },
    [fmtDate],
  );

  const getReceiptDisplayNumber = useCallback(
    (r: Pick<ReceiptRow, "agency_receipt_id" | "receipt_number">) => {
      if (r.agency_receipt_id != null) {
        return String(r.agency_receipt_id);
      }
      return r.receipt_number;
    },
    [],
  );

  /** Normaliza un recibo para UI/CSV (reutilizado en página y export) */
  const normalizeReceipt = useCallback(
    (r: ReceiptRow): NormalizedReceipt => {
      const dateLabel = r.issue_date
        ? formatDateOnlyInBuenosAires(r.issue_date)
        : "—";
      const displayReceiptNumber = getReceiptDisplayNumber(r);

      const hasBase = r.base_amount != null && r.base_currency;
      const displayAmount = hasBase ? toNum(r.base_amount) : toNum(r.amount);
      const displayCurrency = hasBase
        ? (r.base_currency as string | null)
        : (r.amount_currency as string | null);

      const amountLabel = fmtMoney(displayAmount, displayCurrency || "ARS");

      const ownerFull = r.booking?.user
        ? `${r.booking.user.first_name || ""} ${r.booking.user.last_name || ""}`.trim()
        : "";
      const paxFromLabels = Array.isArray(r.clientLabels)
        ? r.clientLabels
            .map((label) => String(label || "").trim())
            .filter(Boolean)
            .join(", ")
        : "";
      const paxFromIds =
        !paxFromLabels && Array.isArray(r.clientIds) && r.clientIds.length > 0
          ? r.clientIds
              .filter((id): id is number => typeof id === "number" && id > 0)
              .map((id) => `N°${id}`)
              .join(", ")
          : "";
      const titularFull = r.booking?.titular
        ? `${r.booking.titular.first_name || ""} ${r.booking.titular.last_name || ""}`.trim()
        : "";
      const paxFull = paxFromLabels || paxFromIds || titularFull;

      const hasCounter = r.counter_amount != null && r.counter_currency;
      const counterAmount = hasCounter
        ? toNum(r.counter_amount)
        : toNum(r.amount);
      const counterCurrency = hasCounter
        ? (r.counter_currency as string | null)
        : (r.amount_currency as string | null);

      const convLabel = hasBase
        ? `${fmtMoney(toNum(r.base_amount), r.base_currency || "ARS")} → ${
            counterCurrency
              ? fmtMoney(counterAmount, counterCurrency || "ARS")
              : "—"
          }`
        : hasCounter
          ? `${fmtMoney(toNum(r.amount), r.amount_currency || "ARS")} → ${
              counterCurrency
                ? fmtMoney(counterAmount, counterCurrency || "ARS")
                : "—"
            }`
          : "—";

      // Costo medio de pago
      const fee = toNum(r.payment_fee_amount);
      const feeCurrency =
        (r.payment_fee_currency as string | null) ||
        (r.amount_currency as string | null) ||
        "ARS";

      const feeLabel =
        fee > 0 || r.payment_fee_amount != null
          ? fmtMoney(fee, feeCurrency)
          : "—";

      // Total cobrado al pax = amount (entra a la agencia) + fee (retención medio)
      const clientTotal = toNum(r.amount) + fee;
      const clientTotalLabel =
        clientTotal > 0
          ? fmtMoney(clientTotal, r.amount_currency || feeCurrency || "ARS")
          : "—";

      return {
        ...r,
        _dateLabel: dateLabel,
        _displayReceiptNumber: displayReceiptNumber,
        _amountLabel: amountLabel,
        _displayAmount: displayAmount,
        _displayCurrency: (displayCurrency || "ARS").toUpperCase(),
        _ownerFull: ownerFull || "—",
        _titularFull: paxFull || "—",
        _convLabel: convLabel,
        _feeLabel: feeLabel,
        _clientTotalLabel: clientTotalLabel,
      };
    },
    [fmtMoney, getReceiptDisplayNumber],
  );

  /* ---------- Forzar owner para vendedor ---------- */
  useEffect(() => {
    if (isVendor && user?.id_user) setOwnerId(user.id_user);
  }, [isVendor, user?.id_user]);

  /* ---------- Opciones de filtros (desde Config con fallback a data) ---------- */
  const paymentMethodOptions = useMemo(() => {
    const fromConfig =
      finance?.paymentMethods?.filter((m) => m.enabled).map((m) => m.name) ??
      [];
    if (fromConfig.length) return uniqSorted(fromConfig);

    const fromData = Array.from(
      new Set(
        data
          .map((r) => (r.payment_method || r.currency || "").trim())
          .filter(Boolean),
      ),
    );
    return uniqSorted(fromData);
  }, [finance?.paymentMethods, data]);

  const accountOptions = useMemo(() => {
    const fromConfig =
      finance?.accounts?.filter((a) => a.enabled).map((a) => a.name) ?? [];
    if (fromConfig.length) return uniqSorted(fromConfig);

    const fromData = Array.from(
      new Set(data.map((r) => (r.account || "").trim()).filter(Boolean)),
    );
    return uniqSorted(fromData);
  }, [finance?.accounts, data]);

  const currencyDict = useMemo(() => {
    const d: Record<string, string> = {};
    for (const c of finance?.currencies || []) {
      if (c.enabled) d[c.code.toUpperCase()] = c.name;
    }
    return d;
  }, [finance?.currencies]);

  const currencyOptions = useMemo(() => {
    const fromConfig =
      finance?.currencies
        ?.filter((c) => c.enabled)
        .map((c) => c.code.toUpperCase()) ?? [];
    if (fromConfig.length) return uniqSorted(fromConfig);

    const fromData = Array.from(
      new Set(
        data
          .flatMap((r) => [
            r.amount_currency,
            r.base_currency,
            r.counter_currency,
          ])
          .filter(Boolean)
          .map((c) => String(c).toUpperCase()),
      ),
    );
    return uniqSorted(fromData);
  }, [finance?.currencies, data]);

  /* ---------- Normalizado ---------- */
  const normalized = useMemo<NormalizedReceipt[]>(() => {
    return data.map((r) => normalizeReceipt(r));
  }, [data, normalizeReceipt]);

  /* ---------- Orden en pax ---------- */
  const displayRows = useMemo(() => {
    const rows = [...normalized];
    const dir = sortDir === "asc" ? 1 : -1;

    rows.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      switch (sortKey) {
        case "issue_date":
          va = toDateKeyInBuenosAiresLegacySafe(a.issue_date ?? null) || "";
          vb = toDateKeyInBuenosAiresLegacySafe(b.issue_date ?? null) || "";
          break;
        case "receipt_number":
          va = a._displayReceiptNumber || "";
          vb = b._displayReceiptNumber || "";
          break;
        case "amount":
          va = a._displayAmount || 0;
          vb = b._displayAmount || 0;
          break;
        case "owner":
          va = a._ownerFull || "";
          vb = b._ownerFull || "";
          break;
      }
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb, "es") * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });

    return rows;
  }, [normalized, sortKey, sortDir]);

  const associationCounters = useMemo(() => {
    const total = normalized.length;
    const linked = normalized.filter((r) => !!r.booking?.id_booking).length;
    return {
      total,
      linked,
      unlinked: total - linked,
    };
  }, [normalized]);

  const groupedByMonth = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        items: NormalizedReceipt[];
        totals: Record<string, number>;
      }
    >();

    for (const r of displayRows) {
      const issueKey = toDateKeyInBuenosAiresLegacySafe(r.issue_date ?? null);
      const key = issueKey ? issueKey.slice(0, 7) : "0000-00";
      const [y, m] = key.split("-").map(Number);
      const monthBase =
        Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12
          ? new Date(Date.UTC(y, m - 1, 15))
          : new Date(0);
      const existing = map.get(key);
      const currency = String(
        r._displayCurrency || r.amount_currency,
      ).toUpperCase();
      if (!existing) {
        map.set(key, {
          key,
          label: formatMonthLabel(monthBase),
          items: [r],
          totals: { [currency]: r._displayAmount || 0 },
        });
      } else {
        existing.items.push(r);
        existing.totals[currency] =
          (existing.totals[currency] || 0) + (r._displayAmount || 0);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [displayRows]);

  const buildServiceDateLines = useCallback(
    (r: NormalizedReceipt) => {
      const bookingId = r.booking?.id_booking;
      if (!bookingId) return [] as string[];
      const services = servicesByBooking[bookingId] || [];
      if (!services.length) return [] as string[];
      const byId = new Map(services.map((s) => [s.id_service, s]));
      const ids = Array.isArray(r.serviceIds) ? r.serviceIds : [];
      if (!ids.length) return [] as string[];

      return ids.map((id) => {
        const svc = byId.get(id);
        const labelId = svc?.agency_service_id ?? id;
        const description =
          svc?.description ||
          svc?.type ||
          (Number.isFinite(id) ? `Servicio ${id}` : "Servicio");
        const dateLabel = svc ? formatServiceRange(svc) : "";
        const parts = [
          `N° ${labelId}`,
          description,
          dateLabel || null,
        ].filter(Boolean);
        return parts.join(" · ");
      });
    },
    [servicesByBooking, formatServiceRange],
  );

  /* ---------- KPIs ---------- */
  const kpis = useMemo(() => {
    const count = normalized.length;
    let ars = 0,
      usd = 0;
    for (const r of normalized) {
      if (String(r._displayCurrency).toUpperCase() === "USD")
        usd += r._displayAmount || 0;
      else ars += r._displayAmount || 0;
    }
    return { count, ars, usd };
  }, [normalized]);

  /* ---------- Build querystring ---------- */
  const buildQS = useCallback(
    (withCursor?: number | null) => {
      const qs = new URLSearchParams();
      if (q.trim()) qs.append("q", q.trim());

      const wantedUserId =
        isVendor && user?.id_user ? user.id_user : canPickOwner ? ownerId : 0;
      if (wantedUserId) qs.append("userId", String(wantedUserId));

      if (currency) qs.append("currency", currency);
      if (paymentMethod) qs.append("payment_method", paymentMethod);
      if (account) qs.append("account", account);
      if (from) qs.append("from", from);
      if (to) qs.append("to", to);
      if (minAmount.trim()) qs.append("minAmount", minAmount.trim());
      if (maxAmount.trim()) qs.append("maxAmount", maxAmount.trim());
      if (associationFilter !== "all")
        qs.append("association", associationFilter);

      qs.append("take", String(TAKE));
      if (withCursor !== undefined && withCursor !== null) {
        qs.append("cursor", String(withCursor));
      }
      return qs;
    },
    [
      q,
      isVendor,
      user?.id_user,
      canPickOwner,
      ownerId,
      currency,
      paymentMethod,
      account,
      from,
      to,
      minAmount,
      maxAmount,
      associationFilter,
    ],
  );

  /* ---------- Fetch y Refresh list ---------- */
  const fetchPage = useCallback(
    async (resetList: boolean) => {
      setLoading(true);
      try {
        const qs = buildQS(resetList ? undefined : cursor);
        const res = await authFetch(
          `/api/receipts?${qs.toString()}`,
          { cache: "no-store" },
          token || undefined,
        );
        const json: ReceiptsAPI = await res.json();
        if (!res.ok) throw new Error(json?.error || "Error al cargar recibos");
        setData((prev) => (resetList ? json.items : [...prev, ...json.items]));
        setCursor(json.nextCursor ?? null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error al cargar recibos";
        toast.error(msg);
      } finally {
        setLoading(false);
        setPageInit(true);
      }
    },
    [buildQS, cursor, token],
  );

  const refreshList = useCallback(() => {
    setCursor(null);
    setData([]);
    fetchPage(true);
  }, [fetchPage]);

  const handleSearch = () => {
    refreshList();
  };

  useEffect(() => {
    if (data.length === 0 && !loading) fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pageInit) return;
    if (lastAssociationFilter.current === associationFilter) return;
    lastAssociationFilter.current = associationFilter;
    refreshList();
  }, [associationFilter, pageInit, refreshList]);

  /* ---------- CSV (scan multipágina) ---------- */
  const downloadCSV = async () => {
    try {
      const headers = [
        "Fecha",
        "N° Recibo",
        "Reserva",
        "Pax",
        "Vendedor",
        "Método",
        "Cuenta",
        "Valor aplicado",
        "Costo medio",
        "Cobrado al pax",
        "Conversión",
        "Concepto",
        "Servicios",
        "Pasajeros",
      ].join(";");

      let next: number | null = null;
      const rows: string[] = [];

      for (let i = 0; i < 300; i++) {
        const qs = buildQS(next);
        const res = await authFetch(
          `/api/receipts?${qs.toString()}`,
          { cache: "no-store" },
          token || undefined,
        );
        const json: ReceiptsAPI = await res.json();
        if (!res.ok) throw new Error(json?.error || "Error al exportar CSV");

        const pageNorm: NormalizedReceipt[] = json.items.map((r) =>
          normalizeReceipt(r),
        );

        for (const r of pageNorm) {
          const cells = [
            r._dateLabel,
            r._displayReceiptNumber,
            String(r.booking?.id_booking ?? ""),
            r._titularFull,
            r._ownerFull,
            r.payment_method || r.currency || "",
            r.account || "",
            r._amountLabel,
            r._feeLabel,
            r._clientTotalLabel,
            r._convLabel,
            r.concept || "",
            String(r.serviceIds?.length ?? 0),
            String(r.clientIds?.length ?? 0),
          ];
          rows.push(
            cells
              .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
              .join(";"),
          );
        }

        next = json.nextCursor ?? null;
        if (next === null) break;
      }

      const csv = [headers, ...rows].join("\r\n");
      const blob = new Blob(["\uFEFF", csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipts_${todayDateKeyInBuenosAires()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al descargar CSV";
      toast.error(msg);
    }
  };

  /* ---------- Acciones filtros ---------- */
  const clearFilters = () => {
    setQ("");
    if (!isVendor) setOwnerId(0);
    setCurrency("");
    setPaymentMethod("");
    setAccount("");
    setFrom("");
    setTo("");
    setMinAmount("");
    setMaxAmount("");
    setAssociationFilter("all");
  };

  const setQuickRange = (preset: "last7" | "thisMonth") => {
    const nowKey = todayDateKeyInBuenosAires();
    if (preset === "last7") {
      const toD = nowKey;
      const fromD = addDaysToDateKey(nowKey, -6) ?? nowKey;
      setFrom(fromD);
      setTo(toD);
    } else {
      const [yearRaw, monthRaw] = nowKey.split("-");
      const year = Number(yearRaw);
      const month = Number(monthRaw);
      const monthLabel = String(month).padStart(2, "0");
      const first = `${year}-${monthLabel}-01`;
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextMonthLabel = String(nextMonth).padStart(2, "0");
      const nextFirst = `${nextYear}-${nextMonthLabel}-01`;
      const last = addDaysToDateKey(nextFirst, -1) ?? first;
      setFrom(first);
      setTo(last);
    }
  };

  /* ---------- Buscar reservas/servicios (compartido con Form y Diálogo) ---------- */
  const searchBookings = async (qText: string): Promise<BookingOption[]> => {
    const term = String(qText)
      .trim()
      .replace(/^(#|n[°º]?\s*)/i, "");
    const out: BookingOption[] = [];
    const byId = /^\d+$/.test(term);

    const mapOne = (b: BookingSearchItem): BookingOption | null => {
      const rawId = b?.id_booking ?? b?.id;
      const id = typeof rawId === "number" ? rawId : Number(rawId);
      if (!Number.isFinite(id) || id <= 0) return null;

      const rawAgencyId = b?.agency_booking_id;
      const agencyId =
        typeof rawAgencyId === "number" ? rawAgencyId : Number(rawAgencyId);
      const displayId = Number.isFinite(agencyId) ? agencyId : id;

      const titular =
        b?.titular?.first_name || b?.titular?.last_name
          ? `${b.titular?.first_name ?? ""} ${b.titular?.last_name ?? ""}`.trim()
          : (b?.titular_name ?? "");

      const label = `N° ${displayId}${titular ? ` • ${titular}` : ""}`;
      const subtitle = (b?.details ?? b?.title ?? b?.subtitle ?? "") as string;

      return {
        id_booking: id,
        agency_booking_id: Number.isFinite(agencyId) ? agencyId : undefined,
        label,
        subtitle,
      };
    };

    try {
      // 1) exact match por ID
      if (byId) {
        const resById = await authFetch(
          `/api/bookings/${term}`,
          { cache: "no-store" },
          token || undefined,
        );
        if (resById.ok) {
          const one = (await resById.json()) as unknown;
          const obj = Array.isArray(one)
            ? (one[0] as BookingSearchItem)
            : (one as BookingSearchItem);
          const mapped = obj ? mapOne(obj) : null;
          if (mapped) out.push(mapped);
        }
      }

      // 2) búsqueda general
      const qs = new URLSearchParams();
      qs.set("q", term);
      qs.set("take", "10");
      if (isVendor && user?.id_user) qs.set("userId", String(user.id_user));

      const resSearch = await authFetch(
        `/api/bookings?${qs.toString()}`,
        { cache: "no-store" },
        token || undefined,
      );
      if (resSearch.ok) {
        const json = (await resSearch.json()) as unknown;
        const items = Array.isArray(json)
          ? (json as BookingSearchItem[])
          : Array.isArray((json as { items?: unknown[] }).items)
            ? ((json as { items: unknown[] }).items as BookingSearchItem[])
            : Array.isArray((json as { results?: unknown[] }).results)
              ? ((json as { results: unknown[] })
                  .results as BookingSearchItem[])
              : [];
        for (const b of items) {
          const mapped = mapOne(b);
          if (mapped) out.push(mapped);
        }
      }
    } catch {
      // noop
    }

    // unique por id
    const uniq = new Map<number, BookingOption>();
    for (const it of out) uniq.set(it.id_booking, it);
    return Array.from(uniq.values());
  };

  const loadServicesForBooking = useCallback(
    async (bId: number): Promise<ServiceLite[]> => {
    const mapArr = (arr: ReadonlyArray<BookingServiceItem>): ServiceLite[] =>
      (arr || []).map((s) => {
        const rawId = s?.id_service ?? s?.id ?? 0;
        const id = typeof rawId === "number" ? rawId : Number(rawId);
        const rawAgencyId = s?.agency_service_id;
        const agencyId =
          rawAgencyId == null
            ? Number.NaN
            : typeof rawAgencyId === "number"
              ? rawAgencyId
              : Number(rawAgencyId);
        const currency = String(
          s?.currency ?? s?.sale_currency ?? "ARS",
        ).toUpperCase();
        const sale =
          typeof s?.sale_price === "number"
            ? s.sale_price
            : Number(s?.sale_price ?? 0);
        const cardInt =
          typeof s?.card_interest === "number"
            ? s.card_interest
            : Number(s?.card_interest ?? 0);
        const cardBase =
          typeof s?.taxableCardInterest === "number"
            ? s.taxableCardInterest
            : Number(s?.taxableCardInterest ?? 0);
        const cardVat =
          typeof s?.vatOnCardInterest === "number"
            ? s.vatOnCardInterest
            : Number(s?.vatOnCardInterest ?? 0);
        return {
          id_service: Number.isFinite(id) ? id : 0,
          agency_service_id: Number.isFinite(agencyId) ? agencyId : undefined,
          description:
            s?.description ??
            s?.type ??
            (Number.isFinite(id) && id > 0 ? `Servicio ${id}` : "Servicio"),
          currency,
          sale_price: sale > 0 ? sale : undefined,
          card_interest:
            Number.isFinite(cardInt) && cardInt > 0 ? cardInt : undefined,
          taxableCardInterest:
            Number.isFinite(cardBase) && cardBase > 0 ? cardBase : undefined,
          vatOnCardInterest:
            Number.isFinite(cardVat) && cardVat > 0 ? cardVat : undefined,
          type: s?.type ?? undefined,
          destination: s?.destination ?? s?.destino ?? undefined,
          departure_date: s?.departure_date ?? null,
          return_date: s?.return_date ?? null,
        };
      });

    const parseJsonToArray = (json: unknown): BookingServiceItem[] | null => {
      const root = json as Record<string, unknown> | null;
      const candidates: unknown[] = [
        json,
        root?.items,
        root?.results,
        root?.data,
        root?.services,
        (root?.booking as Record<string, unknown> | undefined)?.services,
      ].filter(Boolean) as unknown[];
      for (const c of candidates) {
        if (Array.isArray(c)) return c as BookingServiceItem[];
      }
      return null;
    };

    const tryFetch = async (
      url: string,
    ): Promise<BookingServiceItem[] | null> => {
      const res = await authFetch(
        url,
        { cache: "no-store" },
        token || undefined,
      );
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      const arr = parseJsonToArray(json);
      return Array.isArray(arr) ? arr : null;
    };

    let arr =
      (await tryFetch(`/api/bookings/${bId}/services`)) ||
      (await tryFetch(`/api/bookings/${bId}?include=services`)) ||
      (await tryFetch(`/api/bookings/${bId}`)) ||
      (await tryFetch(`/api/services?bookingId=${bId}`)) ||
      (await tryFetch(`/api/services/by-booking/${bId}`));

    if (!arr) arr = [];
    return mapArr(arr);
  },
  [token],
  );

  useEffect(() => {
    if (viewMode !== "cards") return;
    const bookingIds = Array.from(
      new Set(
        displayRows
          .map((r) => r.booking?.id_booking)
          .filter((id): id is number => typeof id === "number" && id > 0),
      ),
    );

    for (const id of bookingIds) {
      if (servicesByBooking[id]) continue;
      if (loadingServicesByBooking.current.has(id)) continue;
      loadingServicesByBooking.current.add(id);
      loadServicesForBooking(id)
        .then((services) => {
          setServicesByBooking((prev) => ({
            ...prev,
            [id]: services || [],
          }));
        })
        .finally(() => {
          loadingServicesByBooking.current.delete(id);
        });
    }
  }, [
    viewMode,
    displayRows,
    loadServicesForBooking,
    servicesByBooking,
  ]);

  /* ---------- Diálogo de Integración (attach) ---------- */
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachTarget, setAttachTarget] = useState<ReceiptRow | null>(null);
  const [attachBookingQuery, setAttachBookingQuery] = useState("");
  const [attachBookingOpts, setAttachBookingOpts] = useState<BookingOption[]>(
    [],
  );
  const [attachBookingId, setAttachBookingId] = useState<number | null>(null);
  const [attachLoadingBookings, setAttachLoadingBookings] = useState(false);

  const [attachServices, setAttachServices] = useState<ServiceLite[]>([]);
  const [attachLoadingServices, setAttachLoadingServices] = useState(false);
  const [attachSelectedServiceIds, setAttachSelectedServiceIds] = useState<
    number[]
  >([]);
  const [attaching, setAttaching] = useState(false); // evita doble click

  const openAttachDialog = (row: ReceiptRow) => {
    setAttachTarget(row);
    const hasBooking = !!row.booking?.id_booking;
    setAttachBookingId(hasBooking ? row.booking!.id_booking : null);
    setAttachSelectedServiceIds(
      Array.isArray(row.serviceIds) ? row.serviceIds! : [],
    );
    setAttachBookingQuery("");
    setAttachOpen(true);
  };

  // buscar reservas (debounced)
  useEffect(() => {
    if (!attachOpen) return;
    if (attachTarget?.booking?.id_booking) return; // booking bloqueada si ya tiene
    const term = attachBookingQuery.trim().replace(/^(#|n[°º]?\s*)/i, "");
    if (!term) {
      setAttachBookingOpts([]);
      return;
    }
    let alive = true;
    setAttachLoadingBookings(true);
    const t = setTimeout(() => {
      searchBookings(term)
        .then((opts) => alive && setAttachBookingOpts(opts))
        .finally(() => alive && setAttachLoadingBookings(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [attachOpen, attachBookingQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // cargar servicios cuando hay booking seleccionada
  useEffect(() => {
    if (!attachOpen) return;
    const bId = attachBookingId;
    if (!bId) {
      setAttachServices([]);
      return;
    }
    let alive = true;
    setAttachLoadingServices(true);
    loadServicesForBooking(bId)
      .then((svcs) => alive && setAttachServices(svcs || []))
      .finally(() => alive && setAttachLoadingServices(false));
    return () => {
      alive = false;
    };
  }, [attachOpen, attachBookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAttachSvc = (svcId: number) => {
    setAttachSelectedServiceIds((prev) =>
      prev.includes(svcId)
        ? prev.filter((id) => id !== svcId)
        : [...prev, svcId],
    );
  };

  const doAttach = async () => {
    if (!token || !attachTarget || attaching) return;
    const targetId = attachTarget.public_id ?? attachTarget.id_receipt;
    const bId = attachTarget.booking?.id_booking || attachBookingId;
    if (!bId) return toast.error("Elegí una reserva para asociar el recibo.");
    if (!attachSelectedServiceIds.length)
      return toast.error("Seleccioná al menos un servicio.");

    try {
      setAttaching(true);
      const res = await authFetch(
        `/api/receipts/${targetId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            bookingId: bId,
            booking: { id_booking: bId },
            serviceIds: attachSelectedServiceIds,
          }),
        },
        token,
      );
      if (!res.ok) {
        let msg = "No se pudo asociar el recibo.";
        try {
          const err = await res.json();
          if (typeof err?.error === "string") msg = err.error;
        } catch {}
        throw new Error(msg);
      }

      toast.success("Recibo asociado correctamente.");
      setAttachOpen(false);
      setAttachTarget(null);
      refreshList();
      router.refresh(); // por si hay SSG/SSR arriba
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al asociar recibo");
    } finally {
      setAttaching(false);
    }
  };

  const buildInitialPayments = useCallback(
    (row: ReceiptRow): ReceiptPaymentLine[] => {
      if (Array.isArray(row.payments) && row.payments.length > 0) {
        return row.payments.map((p) => ({
          amount: toNum(p.amount),
          payment_method_id:
            p.payment_method_id != null ? p.payment_method_id : null,
          account_id: p.account_id ?? null,
          operator_id: null,
          credit_account_id: null,
        }));
      }

      const pmId = Number(row.payment_method_id ?? NaN);
      const accId = Number(row.account_id ?? NaN);
      const hasPm = Number.isFinite(pmId) && pmId > 0;
      const hasAcc = Number.isFinite(accId) && accId > 0;

      if (hasPm || hasAcc) {
        return [
          {
            amount: toNum(row.amount),
            payment_method_id: hasPm ? pmId : null,
            account_id: hasAcc ? accId : null,
            operator_id: null,
            credit_account_id: null,
          },
        ];
      }

      return [];
    },
    [],
  );

  const startEditReceipt = (row: ReceiptRow) => {
    setEditingReceipt(row);
    setFormVisible(true);
  };

  const cancelEditReceipt = () => {
    setEditingReceipt(null);
    setFormVisible(false);
  };

  const downloadReceiptPdf = async (row: ReceiptRow) => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    if (loadingPdfId) return;

    setLoadingPdfId(row.id_receipt);
    try {
      const res = await authFetch(
        `/api/receipts/${row.public_id ?? row.id_receipt}/pdf`,
        { headers: { Accept: "application/pdf" } },
        token,
      );
      if (!res.ok) {
        throw new Error(
          await responseErrorMessage(res, "No se pudo descargar el PDF."),
        );
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const fileBase = `Recibo_${getReceiptDisplayNumber(row) || row.id_receipt}`;
      a.href = url;
      a.download = `${slugify(fileBase)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("PDF descargado exitosamente.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo descargar el PDF.",
      );
    } finally {
      setLoadingPdfId(null);
    }
  };

  const deleteReceipt = async (row: ReceiptRow) => {
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    if (!confirm("¿Seguro querés eliminar este recibo?")) return;

    setLoadingDeleteId(row.id_receipt);
    try {
      const res = await authFetch(
        `/api/receipts/${row.public_id ?? row.id_receipt}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok && res.status !== 204) throw new Error();
      setData((prev) => prev.filter((r) => r.id_receipt !== row.id_receipt));
      if (editingReceipt?.id_receipt === row.id_receipt) {
        cancelEditReceipt();
      }
      toast.success("Recibo eliminado.");
    } catch {
      toast.error("No se pudo eliminar el recibo.");
    } finally {
      setLoadingDeleteId(null);
    }
  };

  const renderReceiptActions = (
    r: NormalizedReceipt,
    variant: "full" | "compact" = "full",
  ) => {
    const isUnlinked = !r.booking?.id_booking;
    const canAttach =
      !r.booking?.id_booking ||
      (Array.isArray(r.serviceIds) && r.serviceIds.length === 0);
    const canEdit = true;
    const canDelete = isUnlinked;
    const canDownload = true;
    const btnClass = variant === "compact" ? ACTION_ICON_BTN : ACTION_BTN;
    const iconClass = variant === "compact" ? "size-4" : "size-4";
    const tonePdf =
      "text-emerald-700 hover:text-emerald-800 dark:text-emerald-200";
    const toneEdit = "text-amber-700 hover:text-amber-800 dark:text-amber-200";
    const toneDelete = "text-rose-700 hover:text-rose-800 dark:text-rose-200";
    const toneAttach = "text-sky-700 hover:text-sky-800 dark:text-sky-200";

    return (
      <div className="flex flex-wrap items-center gap-2">
        {canDownload && (
          <button
            className={`${btnClass} ${tonePdf}`}
            onClick={() => downloadReceiptPdf(r)}
            disabled={loadingPdfId === r.id_receipt}
            title="Descargar PDF"
            aria-label="Descargar PDF"
          >
            {loadingPdfId === r.id_receipt ? (
              <Spinner />
            ) : (
              <>
                <IconDocumentArrowDown className={iconClass} />
                {variant === "full" && "PDF"}
              </>
            )}
          </button>
        )}
        {canEdit && (
          <button
            className={`${btnClass} ${toneEdit}`}
            onClick={() => startEditReceipt(r)}
            title="Editar recibo"
            aria-label="Editar recibo"
          >
            <IconPencilSquare className={iconClass} />
            {variant === "full" && "Editar"}
          </button>
        )}
        {canDelete && (
          <button
            className={`${btnClass} ${toneDelete}`}
            onClick={() => deleteReceipt(r)}
            disabled={loadingDeleteId === r.id_receipt}
            title="Eliminar recibo"
            aria-label="Eliminar recibo"
          >
            {loadingDeleteId === r.id_receipt ? (
              <Spinner />
            ) : (
              <>
                <IconTrash className={iconClass} />
                {variant === "full" && "Eliminar"}
              </>
            )}
          </button>
        )}
        {canAttach && (
          <button
            className={`${btnClass} ${toneAttach}`}
            onClick={() => openAttachDialog(r)}
            title="Asociar a reserva / Sumar servicios"
            aria-label="Asociar recibo"
            disabled={attaching}
          >
            <IconLink className={iconClass} />
            {variant === "full" && "Asociar"}
          </button>
        )}
      </div>
    );
  };

  /* ================= UI ================= */
  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        {/* Form + KPIs */}
        <ReceiptForm
          key={editingReceipt?.id_receipt ?? "new"}
          token={token || null}
          allowAgency={true}
          editingReceiptId={editingReceipt?.id_receipt ?? null}
          isFormVisible={formVisible}
          setIsFormVisible={setFormVisible}
          initialConcept={editingReceipt?.concept ?? ""}
          initialAmount={
            editingReceipt ? toNum(editingReceipt.amount) : undefined
          }
          initialCurrency={editingReceipt?.amount_currency ?? undefined}
          initialAmountWords={editingReceipt?.amount_string ?? ""}
          initialAmountWordsCurrency={
            editingReceipt?.base_currency || editingReceipt?.amount_currency
          }
          initialPaymentDescription={editingReceipt?.currency ?? ""}
          initialFeeAmount={
            editingReceipt?.payment_fee_amount != null
              ? toNum(editingReceipt.payment_fee_amount)
              : undefined
          }
          initialIssueDate={toInputDate(editingReceipt?.issue_date)}
          initialBaseAmount={editingReceipt?.base_amount ?? null}
          initialBaseCurrency={editingReceipt?.base_currency ?? null}
          initialCounterAmount={editingReceipt?.counter_amount ?? null}
          initialCounterCurrency={editingReceipt?.counter_currency ?? null}
          initialClientIds={editingReceipt?.clientIds ?? []}
          initialPayments={
            editingReceipt ? buildInitialPayments(editingReceipt) : []
          }
          // NO habilitamos attach dentro del form en esta page
          // enableAttachAction={false}
          searchBookings={searchBookings}
          loadServicesForBooking={loadServicesForBooking}
          onSubmit={async (payload) => {
            if (editingReceipt?.id_receipt) {
              const res = await authFetch(
                `/api/receipts/${editingReceipt.public_id ?? editingReceipt.id_receipt}`,
                { method: "PATCH", body: JSON.stringify(payload) },
                token || undefined,
              );

              const json = await res.json().catch(() => null);

              if (!res.ok) {
                let msg = "No se pudo actualizar el recibo.";
                if (
                  typeof (json as { error?: string } | null)?.error === "string"
                ) {
                  msg = (json as { error: string }).error;
                }
                throw new Error(msg);
              }

              refreshList();
              setEditingReceipt(null);
              router.refresh();
              return json;
            }

            const res = await authFetch(
              "/api/receipts",
              {
                method: "POST",
                body: JSON.stringify(payload),
              },
              token || undefined,
            );

            const json = await res.json().catch(() => null);

            if (!res.ok) {
              let msg = "No se pudo crear el recibo.";
              if (
                typeof (json as { error?: string } | null)?.error === "string"
              )
                msg = (json as { error: string }).error;
              throw new Error(msg);
            }

            refreshList();
            router.refresh();
            return json;
          }}
          onCancel={editingReceipt ? cancelEditReceipt : undefined}
        />

        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              Recibos / Entradas de dinero
            </h1>
            <p className="text-sm opacity-70">
              Visualizá los recibos emitidos por la agencia.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={CHIP}>Total: {kpis.count}</span>
            <span className={CHIP}>
              ARS:{" "}
              {new Intl.NumberFormat("es-AR", {
                style: "currency",
                currency: "ARS",
              }).format(kpis.ars)}
            </span>
            <span className={CHIP}>
              USD:{" "}
              {new Intl.NumberFormat("es-AR", {
                style: "currency",
                currency: "USD",
              }).format(kpis.usd)}
            </span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[280px] flex-1 items-center gap-2 rounded-2xl border border-sky-200 bg-white/50 px-3 py-2 text-sky-950 shadow-sm shadow-sky-950/10 outline-none backdrop-blur focus-within:border-emerald-300/60 focus-within:ring-2 focus-within:ring-emerald-200/40 dark:border-sky-200/60 dark:bg-sky-100/10 dark:text-white">
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-sky-900/50 dark:placeholder:text-white/60"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="Buscar por N° recibo, concepto o N° reserva..."
            />
            <button
              type="button"
              onClick={handleSearch}
              className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/25 dark:text-emerald-100"
            >
              Buscar
            </button>
          </div>

          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={ICON_BTN}
          >
            {filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}
          </button>

          <div className={SEGMENTED}>
            {[
              { key: "all", label: "Todos", badge: associationCounters.total },
              {
                key: "linked",
                label: "Asociados",
                badge: associationCounters.linked,
              },
              {
                key: "unlinked",
                label: "Sin reserva",
                badge: associationCounters.unlinked,
              },
            ].map((opt) => {
              const active =
                associationFilter === (opt.key as typeof associationFilter);
              const badgeTone =
                opt.key === "linked"
                  ? "border-emerald-200/70 bg-emerald-100/70 text-emerald-900 dark:border-emerald-700/50 dark:bg-emerald-900/30 dark:text-emerald-100"
                  : opt.key === "unlinked"
                    ? "border-rose-200/70 bg-rose-100/70 text-rose-900 dark:border-rose-700/50 dark:bg-rose-900/30 dark:text-rose-100"
                    : "border-amber-200/70 bg-amber-100/70 text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-100";
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    setAssociationFilter(
                      opt.key as "all" | "linked" | "unlinked",
                    )
                  }
                  className={[
                    "flex items-center gap-2 rounded-2xl px-4 py-2 text-sm transition-colors",
                    active
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-200"
                      : "text-sky-950/80 hover:bg-white/60 dark:text-white/80",
                  ].join(" ")}
                  title={`Mostrar ${opt.label.toLowerCase()}`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`rounded-full border px-2 text-xs ${badgeTone}`}
                  >
                    {opt.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Orden */}
          <div className={`${CHIP} gap-2`}>
            <span className="opacity-70">Ordenar por</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="cursor-pointer rounded-full border border-white/10 bg-white/10 px-2 py-1 outline-none dark:bg-white/10"
            >
              <option value="issue_date">Fecha</option>
              <option value="receipt_number">N° recibo</option>
              <option value="amount">Importe</option>
              <option value="owner">Vendedor</option>
            </select>
            <button
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              className="rounded-full bg-white/10 px-2 py-1 text-xs"
              title="Asc/Desc"
            >
              {sortDir === "asc" ? "Asc" : "Desc"}
            </button>
          </div>

          <button onClick={downloadCSV} className={ICON_BTN}>
            Exportar CSV
          </button>
        </div>

        {/* Filtros */}
        {filtersOpen && (
          <div className={`${GLASS} mb-6 p-4`}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <Label>Buscar</Label>
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="N° recibo, concepto, 'UN MILLON...', N° reserva..."
                />
              </div>

              <div className="md:col-span-3">
                <Label>Vendedor</Label>
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(Number(e.target.value))}
                  disabled={!canPickOwner && isVendor}
                  className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  {!isVendor && <option value={0}>Todos</option>}
                  {isVendor && user?.id_user && (
                    <option value={user.id_user}>Mis ventas</option>
                  )}
                  {vendorOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <Label>Moneda</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  <option value="">Todas</option>
                  {currencyOptions.map((code) => (
                    <option key={code} value={code}>
                      {currencyDict[code]
                        ? `${code} — ${currencyDict[code]}`
                        : code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <Label>Método de pago</Label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  <option value="">Todos</option>
                  {paymentMethodOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <Label>Cuenta</Label>
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  <option value="">Todas</option>
                  {accountOptions.map((acc) => (
                    <option key={acc} value={acc}>
                      {acc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <Label>Desde</Label>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="md:col-span-3">
                <Label>Hasta</Label>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>

              <div className="flex items-end gap-2 md:col-span-6">
                <button
                  onClick={() => setQuickRange("last7")}
                  className={ICON_BTN}
                >
                  Últimos 7 días
                </button>
                <button
                  onClick={() => setQuickRange("thisMonth")}
                  className={ICON_BTN}
                >
                  Mes actual
                </button>
              </div>

              <div className="md:col-span-3">
                <Label>Importe mín.</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="md:col-span-3">
                <Label>Importe máx.</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  placeholder="∞"
                />
              </div>

              <div className="flex flex-wrap items-end justify-end gap-2 md:col-span-12">
                <button onClick={clearFilters} className={ICON_BTN}>
                  Limpiar
                </button>
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  className={`${ICON_BTN} disabled:opacity-50`}
                >
                  {loading ? <Spinner /> : "Aplicar"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/60 p-1 shadow-sm shadow-sky-950/10 dark:bg-white/10">
            {[
              { key: "cards", label: "Tarjetas", Icon: IconSquares2X2 },
              { key: "table", label: "Tabla", Icon: IconTableCells },
              { key: "monthly", label: "Mensual", Icon: IconCalendarDays },
            ].map((opt) => {
              const active = viewMode === (opt.key as typeof viewMode);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    setViewMode(opt.key as "cards" | "table" | "monthly")
                  }
                  className={[
                    "flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors",
                    active
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-200"
                      : "text-sky-950/80 hover:bg-white/60 dark:text-white/80",
                  ].join(" ")}
                >
                  <opt.Icon className="size-4" />
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-sky-950/70 dark:text-white/70">
            Vista actual:{" "}
            <b className="text-emerald-700 dark:text-emerald-200">
              {viewMode === "cards"
                ? "Tarjetas"
                : viewMode === "table"
                  ? "Tabla"
                  : "Mensual"}
            </b>
          </div>
        </div>

        {/* LISTA */}
        {loading && displayRows.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Spinner />
          </div>
        ) : displayRows.length === 0 && pageInit ? (
          <div className={`${GLASS} p-6 text-center`}>No hay resultados.</div>
        ) : (
          <div className="space-y-4">
            {viewMode === "table" ? (
              <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/10 shadow-md shadow-sky-950/10 backdrop-blur">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="bg-white/60 text-sky-950 dark:bg-white/10 dark:text-white">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Recibo</th>
                      <th className="px-4 py-3">Reserva</th>
                      <th className="px-4 py-3">Pax</th>
                      <th className="px-4 py-3">Concepto</th>
                      <th className="px-4 py-3">Importe</th>
                      <th className="px-4 py-3">Método</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r) => {
                      const status = String(
                        r.verification_status || "PENDING",
                      ).toUpperCase();
                      const statusLabel =
                        status === "VERIFIED" ? "Verificado" : "Pendiente";
                      const statusClass =
                        STATUS_BADGE[status] ?? STATUS_BADGE.PENDING;
                      const isUnlinked = !r.booking?.id_booking;
                      const associationLabel = isUnlinked
                        ? "Sin reserva"
                        : "Asociado";
                      const associationClass = isUnlinked
                        ? ASSOCIATION_BADGE.unlinked
                        : ASSOCIATION_BADGE.linked;
                      const methodLabel = r.payment_method || r.currency || "—";

                      return (
                        <tr
                          key={r.id_receipt}
                          className="border-t border-white/10"
                        >
                          <td className="px-4 py-3 text-xs opacity-70">
                            {r._dateLabel}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">
                                N° {getReceiptDisplayNumber(r)}
                              </span>
                              <button
                                className={BADGE}
                                onClick={() => {
                                  if (
                                    typeof navigator !== "undefined" &&
                                    navigator.clipboard
                                  ) {
                                    navigator.clipboard
                                      .writeText(getReceiptDisplayNumber(r))
                                      .then(
                                        () =>
                                          toast.success("N° de recibo copiado"),
                                        () => toast.error("No se pudo copiar"),
                                      );
                                  }
                                }}
                                title="Copiar N° recibo"
                              >
                                Copiar
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {r.booking?.id_booking ? (
                              <Link
                                href={`/bookings/services/${r.booking?.public_id ?? r.booking?.id_booking}`}
                                target="_blank"
                                className="underline decoration-transparent hover:decoration-sky-600"
                              >
                                {r.booking?.agency_booking_id ??
                                  r.booking?.id_booking}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3">{r._titularFull}</td>
                          <td className="px-4 py-3">
                            <span className="block max-w-[280px] truncate">
                              {r.concept || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold">
                            {r._amountLabel}
                          </td>
                          <td className="px-4 py-3">{methodLabel}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className={`${BADGE} ${statusClass}`}>
                                {statusLabel}
                              </span>
                              <span className={`${BADGE} ${associationClass}`}>
                                {associationLabel}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end">
                              {renderReceiptActions(r, "compact")}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : viewMode === "monthly" ? (
              <div className="space-y-4">
                {groupedByMonth.map((group) => (
                  <div
                    key={group.key}
                    className="rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold capitalize">
                          {capitalize(group.label)}
                        </span>
                        <span className="rounded-full border border-amber-200/70 bg-amber-100/70 px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-100">
                          {group.items.length} recibos
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {Object.entries(group.totals).map(([cur, total]) => (
                          <span
                            key={`${group.key}-${cur}`}
                            className="rounded-full border border-emerald-200/70 bg-emerald-100/70 px-2 py-1 font-medium text-emerald-900 dark:border-emerald-700/50 dark:bg-emerald-900/30 dark:text-emerald-100"
                          >
                            {cur}:{" "}
                            {new Intl.NumberFormat("es-AR", {
                              style: "currency",
                              currency: cur,
                            }).format(total)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {group.items.map((r) => {
                        const status = String(
                          r.verification_status || "PENDING",
                        ).toUpperCase();
                        const statusLabel =
                          status === "VERIFIED" ? "Verificado" : "Pendiente";
                        const statusClass =
                          STATUS_BADGE[status] ?? STATUS_BADGE.PENDING;
                        const isUnlinked = !r.booking?.id_booking;
                        const associationLabel = isUnlinked
                          ? "Sin reserva"
                          : "Asociado";
                        const associationClass = isUnlinked
                          ? ASSOCIATION_BADGE.unlinked
                          : ASSOCIATION_BADGE.linked;

                        return (
                          <div
                            key={r.id_receipt}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/20 p-3 dark:bg-white/10"
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="font-semibold">
                                  N° {getReceiptDisplayNumber(r)}
                                </span>
                                <span className="text-xs opacity-70">
                                  {r._dateLabel}
                                </span>
                                <span className={`${BADGE} ${statusClass}`}>
                                  {statusLabel}
                                </span>
                                <span
                                  className={`${BADGE} ${associationClass}`}
                                >
                                  {associationLabel}
                                </span>
                              </div>
                              <div className="text-sm opacity-80">
                                {r.concept || "—"}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold">
                                {r._amountLabel}
                              </span>
                              {renderReceiptActions(r, "compact")}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {displayRows.map((r) => {
                  const servicesCount = r.serviceIds?.length ?? 0;
                  const clientsCount = r.clientIds?.length ?? 0;
                  const cur = String(
                    r._displayCurrency || r.amount_currency,
                  ).toUpperCase();
                  const status = String(
                    r.verification_status || "PENDING",
                  ).toUpperCase();
                  const statusLabel =
                    status === "VERIFIED" ? "Verificado" : "Pendiente";
                  const statusClass =
                    STATUS_BADGE[status] ?? STATUS_BADGE.PENDING;
                  const isUnlinked = !r.booking?.id_booking;
                  const associationLabel = isUnlinked
                    ? "Sin reserva"
                    : "Asociado";
                  const associationClass = isUnlinked
                    ? ASSOCIATION_BADGE.unlinked
                    : ASSOCIATION_BADGE.linked;
                  const serviceDateLines = buildServiceDateLines(r);
                  const serviceDatePreview = serviceDateLines.slice(0, 3);
                  const serviceDateExtra =
                    serviceDateLines.length - serviceDatePreview.length;

                  return (
                    <article
                      key={r.id_receipt}
                      className="rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white"
                    >
                      {/* Encabezado */}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm opacity-70">
                            N° {getReceiptDisplayNumber(r)}
                          </span>
                          <button
                            className={BADGE}
                            onClick={() => {
                              if (
                                typeof navigator !== "undefined" &&
                                navigator.clipboard
                              ) {
                                navigator.clipboard
                                  .writeText(getReceiptDisplayNumber(r))
                                  .then(
                                    () => toast.success("N° de recibo copiado"),
                                    () => toast.error("No se pudo copiar"),
                                  );
                              }
                            }}
                            title="Copiar N° recibo"
                          >
                            Copiar
                          </button>
                          <span className={BADGE}>{r._dateLabel}</span>
                          <span className={`${BADGE} ${statusClass}`}>
                            {statusLabel}
                          </span>
                          <span className={`${BADGE} ${associationClass}`}>
                            {associationLabel}
                          </span>
                          <span className={BADGE}>{cur}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col items-end text-right">
                            {/* Valor aplicado */}
                            <div className="text-base font-semibold">
                              {r._amountLabel}
                            </div>
                            {(r._clientTotalLabel !== "—" ||
                              r._feeLabel !== "—") && (
                              <div className="mt-0.5 text-[11px] opacity-75">
                                {r._clientTotalLabel !== "—" && (
                                  <>
                                    Pax pagó: <b>{r._clientTotalLabel}</b>
                                  </>
                                )}
                                {r._feeLabel !== "—" && (
                                  <>
                                    {r._clientTotalLabel !== "—" && " · "}
                                    Costo medio: {r._feeLabel}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          {renderReceiptActions(r, "full")}
                        </div>
                      </div>

                      {/* Concepto */}
                      <div className="mt-1 text-lg opacity-90">
                        {r.concept || "—"}
                      </div>

                      {/* Meta principal */}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                        <span className={CHIP}>
                          <b>Reserva:</b>
                          {r.booking?.id_booking ? (
                            <Link
                              href={`/bookings/services/${r.booking?.public_id ?? r.booking?.id_booking}`}
                              target="_blank"
                              className="underline decoration-transparent hover:decoration-sky-600"
                            >
                              {r.booking?.agency_booking_id ??
                                r.booking?.id_booking}
                            </Link>
                          ) : (
                            " —"
                          )}
                        </span>

                        <span className={CHIP}>
                          <b>Vendedor:</b> {r._ownerFull}
                        </span>

                        <span className={CHIP}>
                          <b>Pax:</b> {r._titularFull}
                        </span>

                        {(r.payment_method || r.currency) && (
                          <span className={CHIP}>
                            <b>Método:</b> {r.payment_method || r.currency}
                          </span>
                        )}

                        {r.account && (
                          <span className={CHIP}>
                            <b>Cuenta:</b> {r.account}
                          </span>
                        )}

                        {r._convLabel !== "—" && (
                          <span className={CHIP}>
                            <b>Conversión:</b> {r._convLabel}
                          </span>
                        )}

                        {r._feeLabel !== "—" && (
                          <span className={CHIP}>
                            <b>Costo medio:</b> {r._feeLabel}
                          </span>
                        )}

                        {r._clientTotalLabel !== "—" && (
                          <span className={CHIP}>
                            <b>Cobrado al pax:</b> {r._clientTotalLabel}
                          </span>
                        )}

                        <span className={CHIP}>
                          <b>Servicios:</b> {servicesCount}
                        </span>

                        <span className={CHIP}>
                          <b>Pasajeros:</b> {clientsCount}
                        </span>
                      </div>

                      {serviceDatePreview.length > 0 && (
                        <div className="mt-3 rounded-2xl border border-white/10 bg-white/10 p-3 text-xs text-sky-950/80 dark:text-white/80">
                          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                            Fechas de servicios
                          </div>
                          <div className="mt-2 space-y-1">
                            {serviceDatePreview.map((line, idx) => (
                              <div key={`${r.id_receipt}-svc-${idx}`}>
                                {line}
                              </div>
                            ))}
                            {serviceDateExtra > 0 && (
                              <div className="opacity-70">
                                +{serviceDateExtra} más
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {/* Paginado */}
            <div className="flex justify-center">
              <button
                onClick={() => fetchPage(false)}
                disabled={loading || cursor === null}
                className={`${ICON_BTN} disabled:opacity-50`}
              >
                {cursor === null ? (
                  "No hay más"
                ) : loading ? (
                  <Spinner />
                ) : (
                  "Ver más"
                )}
              </button>
            </div>
          </div>
        )}

        {/* Diálogo de Integración (attach) */}
        {attachOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setAttachOpen(false)}
            />
            <div className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur dark:bg-white/10">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">
                    Asociar recibo N°{" "}
                    {attachTarget ? getReceiptDisplayNumber(attachTarget) : ""}
                  </h3>
                  <p className="text-xs opacity-70">
                    Elegí una reserva y marcá los servicios a vincular.
                  </p>
                </div>
                <button
                  className={ICON_BTN}
                  onClick={() => setAttachOpen(false)}
                >
                  Cerrar
                </button>
              </div>

              {/* Booking selector */}
              {attachTarget?.booking?.id_booking ? (
                <div className="mb-3 text-sm">
                  Reserva:{" "}
                  <span className="rounded-full bg-white/10 px-2 py-1">
                    N°{" "}
                    {attachTarget.booking.agency_booking_id ??
                      attachTarget.booking.id_booking}{" "}
                    (bloqueada)
                  </span>
                </div>
              ) : (
                <div className="mb-3">
                  <Label>Buscar reserva</Label>
                  <Input
                    value={attachBookingQuery}
                    onChange={(e) => setAttachBookingQuery(e.target.value)}
                    placeholder="Por número o titular…"
                  />
                  <div className="mt-2 max-h-56 overflow-auto rounded-2xl border border-white/10">
                    {attachLoadingBookings ? (
                      <div className="p-3">
                        <Spinner />
                      </div>
                    ) : attachBookingOpts.length ? (
                      attachBookingOpts.map((opt) => (
                        <button
                          key={opt.id_booking}
                          type="button"
                          className={`block w-full px-3 py-2 text-left transition hover:bg-white/5 ${
                            attachBookingId === opt.id_booking
                              ? "bg-white/10"
                              : ""
                          }`}
                          onClick={() => setAttachBookingId(opt.id_booking)}
                        >
                          <div className="text-sm font-medium">{opt.label}</div>
                          {opt.subtitle && (
                            <div className="text-xs opacity-70">
                              {opt.subtitle}
                            </div>
                          )}
                        </button>
                      ))
                    ) : attachBookingQuery ? (
                      <div className="p-3 text-sm opacity-70">
                        Sin resultados.
                      </div>
                    ) : (
                      <div className="p-3 text-sm opacity-70">
                        Escribí para buscar…
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Services de la reserva */}
              {(attachTarget?.booking?.id_booking || attachBookingId) && (
                <div className="mb-3">
                  <Label>Servicios</Label>
                  {attachLoadingServices ? (
                    <div className="py-2">
                      <Spinner />
                    </div>
                  ) : attachServices.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 p-3 text-sm opacity-70">
                      No hay servicios para esta reserva.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {attachServices.map((svc) => {
                        const checked = attachSelectedServiceIds.includes(
                          svc.id_service,
                        );
                        return (
                          <label
                            key={svc.id_service}
                            className={`flex items-start gap-3 rounded-2xl border px-3 py-2 ${
                              checked
                                ? "border-white/20 bg-white/10"
                                : "border-white/10"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4"
                              checked={checked}
                              onChange={() => toggleAttachSvc(svc.id_service)}
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium">
                                N° {svc.agency_service_id ?? svc.id_service} ·{" "}
                                {svc.type || svc.description || "Servicio"}
                                {svc.destination ? ` · ${svc.destination}` : ""}
                              </div>
                              <div className="text-xs opacity-70">
                                Moneda: <b>{svc.currency}</b>{" "}
                                {typeof svc.sale_price === "number" && (
                                  <>• Venta aprox.</>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Action bar */}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className={ICON_BTN}
                  onClick={() => setAttachOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  className={`${ICON_BTN} disabled:opacity-50`}
                  onClick={doAttach}
                  disabled={attaching}
                >
                  {attaching ? <Spinner /> : "Guardar asociación"}
                </button>
              </div>
            </div>
          </div>
        )}

        <ToastContainer position="bottom-right" />
      </section>
    </ProtectedRoute>
  );
}

/* ================= UI atoms ================= */
function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs opacity-70">{children}</label>;
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`block w-full min-w-fit appearance-none rounded-2xl border border-sky-200 bg-white/50 px-4 py-2 shadow-sm shadow-sky-950/10 outline-none backdrop-blur placeholder:opacity-60 dark:border-sky-200/60 dark:bg-sky-100/10 ${
        props.className || ""
      }`}
    />
  );
}

type IconProps = React.SVGProps<SVGSVGElement>;

function IconSquares2X2(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75h6.5v6.5h-6.5zM3.75 13.75h6.5v6.5h-6.5zM13.75 3.75h6.5v6.5h-6.5zM13.75 13.75h6.5v6.5h-6.5z"
      />
    </svg>
  );
}

function IconTableCells(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6h16.5M3.75 12h16.5M3.75 18h16.5M6 3.75v16.5M12 3.75v16.5M18 3.75v16.5"
      />
    </svg>
  );
}

function IconCalendarDays(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 6.75V4.5M16 6.75V4.5M3.75 9h16.5M4.5 5.25h15a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.75v-12a1.5 1.5 0 0 1 1.5-1.5z"
      />
    </svg>
  );
}

function IconDocumentArrowDown(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v3A2.25 2.25 0 0 1 17.25 19.5H6.75A2.25 2.25 0 0 1 4.5 17.25v-3M9 12.75 12 15.75m0 0 3-3m-3 3V4.5"
      />
    </svg>
  );
}

function IconPencilSquare(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
      />
    </svg>
  );
}

function IconTrash(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

function IconLink(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 0 1 6.364 6.364l-3 3a4.5 4.5 0 0 1-6.364-6.364m-.53.53a4.5 4.5 0 0 1-6.364-6.364l3-3a4.5 4.5 0 0 1 6.364 6.364"
      />
    </svg>
  );
}
