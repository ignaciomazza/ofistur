"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import Link from "next/link";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { authFetch } from "@/utils/authFetch";
import { useAuth } from "@/context/AuthContext";
import { computeBillingAdjustments } from "@/utils/billingAdjustments";
import { getGrossIncomeTaxAmountFromBillingOverride } from "@/utils/billingOverride";
import type { BillingAdjustmentConfig } from "@/types";
import {
  formatDateOnlyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";
import {
  downloadCsvFile,
  formatCsvNumber,
  toCsvHeaderRow,
  toCsvRow,
} from "@/utils/csv";
import ExportSheetButton from "@/components/ui/ExportSheetButton";
import DetailedBalancesPanel from "@/components/balances/DetailedBalancesPanel";

/* ================= Tipos ================= */

type UserLite = {
  id_user: number;
  first_name: string;
  last_name: string;
};
type CurrentUser = UserLite & { role?: string | null };

type CurrencyCode = "ARS" | "USD";

type ServiceForBalance = {
  sale_price: number;
  currency: CurrencyCode;
  card_interest?: number | null;
  cost_price?: number | null;

  tax_21?: number | null;
  tax_105?: number | null;
  exempt?: number | null;
  other_taxes?: number | null;
  nonComputable?: number | null;
  taxableBase21?: number | null;
  taxableBase10_5?: number | null;
  taxableCardInterest?: number | null;
  vatOnCardInterest?: number | null;
  transfer_fee_amount?: number | string | null;
  transfer_fee_pct?: number | string | null;
  extra_costs_amount?: number | null;
  extra_taxes_amount?: number | null;
  totalCommissionWithoutVAT?: number | null;
  vatOnCommission21?: number | null;
  vatOnCommission10_5?: number | null;
  billing_override?: unknown;
};

type ReceiptForBalance = {
  amount: number;
  amount_currency: CurrencyCode;
  base_amount?: number | string | null;
  base_currency?: CurrencyCode | null;
  counter_amount?: number | string | null;
  counter_currency?: CurrencyCode | null;
  payment_fee_amount?: number | string | null;
  payment_fee_currency?: CurrencyCode | string | null;
};
type OperatorDueForBalance = {
  amount: number | string;
  currency: CurrencyCode | string;
  status?: string | null;
};

interface Booking {
  id_booking: number;
  agency_booking_id?: number | null;
  public_id?: string | null;
  clientStatus: string;
  operatorStatus: string;
  status?: string;
  creation_date: string;
  sale_totals?: Record<string, number> | null;
  departure_date?: string | null;
  return_date?: string | null;
  titular: {
    first_name: string;
    last_name: string;
  };
  user?: UserLite | null;
  services: ServiceForBalance[];
  Receipt: ReceiptForBalance[];
  OperatorDue?: OperatorDueForBalance[];
}

type BookingsAPI = {
  items: Booking[];
  nextCursor: number | null;
  error?: string;
};

/* ====== Impuestos por moneda ====== */

type TaxBucket = {
  iva21: number;
  iva105: number;
  iva21Comm: number;
  iva105Comm: number;
  exento: number;
  otros: number;
  noComp: number;
  cardIntBase: number;
  cardIntIVA: number;
  transf: number;
  base21: number;
  base105: number;
  commSinIVA: number;
  commNet: number;
  commWithVAT: number;
  total: number;
};

function makeEmptyTaxBucket(): TaxBucket {
  return {
    iva21: 0,
    iva105: 0,
    iva21Comm: 0,
    iva105Comm: 0,
    exento: 0,
    otros: 0,
    noComp: 0,
    cardIntBase: 0,
    cardIntIVA: 0,
    transf: 0,
    base21: 0,
    base105: 0,
    commSinIVA: 0,
    commNet: 0,
    commWithVAT: 0,
    total: 0,
  };
}

const TAX_CURRENCIES: CurrencyCode[] = ["ARS", "USD"];

/* ====== Tipo normalizado para la tabla / export ====== */

type NormalizedBooking = Booking & {
  _titularFull: string;
  _ownerFull: string;
  _saleNoInt: Record<CurrencyCode, number>;
  _saleWithInt: Record<CurrencyCode, number>;
  _paid: Record<CurrencyCode, number>;
  _debt: Record<CurrencyCode, number>;
  _operatorDebt: Record<CurrencyCode, number>;
  _saleLabel: string;
  _paidLabel: string;
  _debtLabel: string;
  _operatorDebtLabel: string;
  _depDateKey: string;
  _retDateKey: string;
  _travelLabel: string;
  _taxByCurrency: Record<CurrencyCode, TaxBucket>;
};

type BalanceKpis = {
  count: number;
  sale: Record<CurrencyCode, number>;
  paid: Record<CurrencyCode, number>;
  debt: Record<CurrencyCode, number>;
  operatorDebt: Record<CurrencyCode, number>;
};

/* ================= Estilos compartidos (glass / sky) ================= */
const GLASS =
  "rounded-3xl border border-white/30 bg-white/10 backdrop-blur shadow-lg shadow-sky-900/10 dark:bg-white/10 dark:border-white/5";
const CHIP =
  "inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 backdrop-blur px-3 py-1.5 text-sm shadow-sm shadow-sky-900/5 dark:bg-white/10 dark:border-white/10";
const ICON_BTN =
  "rounded-3xl bg-sky-600/30 px-3 py-1.5 text-sm text-sky-950/80 hover:text-sky-950 dark:text-white shadow-sm shadow-sky-900/10 hover:bg-sky-600/30 border border-sky-600/30 active:scale-[.99] transition";
const PRIMARY_BTN =
  "rounded-3xl bg-sky-600/30 px-3 py-1.5 text-sm text-sky-950/80 hover:text-sky-950 dark:text-white shadow-sm shadow-sky-900/10 hover:bg-sky-600/30 border border-sky-600/30 active:scale-[.99] transition";
const BADGE =
  "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium";

/* ================= Columnas visibles ================= */
type VisibleKey =
  | "id_booking"
  | "titular"
  | "owner"
  | "clientStatus"
  | "operatorStatus"
  | "creation_date"
  | "travel"
  | "sale_total"
  | "paid_total"
  | "debt_total"
  | "operator_debt"
  | "tax_iva21"
  | "tax_iva105"
  | "tax_iva21_comm"
  | "tax_iva105_comm"
  | "tax_base21"
  | "tax_base105"
  | "tax_exento"
  | "tax_otros"
  | "tax_noComp"
  | "tax_transf"
  | "tax_cardBase"
  | "tax_cardIVA"
  | "tax_commNoVAT"
  | "tax_commNet"
  | "tax_commWithVAT"
  | "tax_total";

type ColumnDef = { key: VisibleKey; label: string; always?: boolean };

const ALL_COLUMNS: ColumnDef[] = [
  { key: "id_booking", label: "Reserva", always: true },
  { key: "titular", label: "Titular", always: true },
  { key: "owner", label: "Vendedor" },
  { key: "clientStatus", label: "Pax" },
  { key: "operatorStatus", label: "Operador" },
  { key: "creation_date", label: "Creación" },
  { key: "travel", label: "Viaje" },
  { key: "sale_total", label: "Venta (sin int.)" },
  { key: "paid_total", label: "Cobrado" },
  { key: "debt_total", label: "Deuda" },
  { key: "operator_debt", label: "Deuda operadores" },
  { key: "tax_iva21", label: "IVA 21%" },
  { key: "tax_iva105", label: "IVA 10,5%" },
  { key: "tax_iva21_comm", label: "IVA 21% com." },
  { key: "tax_iva105_comm", label: "IVA 10,5% com." },
  { key: "tax_base21", label: "Gravado 21%" },
  { key: "tax_base105", label: "Gravado 10.5%" },
  { key: "tax_exento", label: "Exento" },
  { key: "tax_otros", label: "Otros" },
  { key: "tax_noComp", label: "No comp." },
  { key: "tax_transf", label: "Transf." },
  { key: "tax_cardBase", label: "Base int. tarjeta" },
  { key: "tax_cardIVA", label: "IVA int. tarjeta" },
  { key: "tax_commNoVAT", label: "Comisión s/IVA" },
  { key: "tax_commNet", label: "Comisión neta (costos + imp.)" },
  { key: "tax_commWithVAT", label: "Comisión c/IVA" },
  { key: "tax_total", label: "Total imp." },
];

type TaxColumnKey =
  | "tax_iva21"
  | "tax_iva105"
  | "tax_iva21_comm"
  | "tax_iva105_comm"
  | "tax_base21"
  | "tax_base105"
  | "tax_exento"
  | "tax_otros"
  | "tax_noComp"
  | "tax_transf"
  | "tax_cardBase"
  | "tax_cardIVA"
  | "tax_commNoVAT"
  | "tax_commNet"
  | "tax_commWithVAT"
  | "tax_total";

type NumericColumnKey =
  | "sale_total"
  | "paid_total"
  | "debt_total"
  | "operator_debt"
  | TaxColumnKey;

const TAX_FIELD_BY_COLUMN: Record<TaxColumnKey, keyof TaxBucket> = {
  tax_iva21: "iva21",
  tax_iva105: "iva105",
  tax_iva21_comm: "iva21Comm",
  tax_iva105_comm: "iva105Comm",
  tax_base21: "base21",
  tax_base105: "base105",
  tax_exento: "exento",
  tax_otros: "otros",
  tax_noComp: "noComp",
  tax_transf: "transf",
  tax_cardBase: "cardIntBase",
  tax_cardIVA: "cardIntIVA",
  tax_commNoVAT: "commSinIVA",
  tax_commNet: "commNet",
  tax_commWithVAT: "commWithVAT",
  tax_total: "total",
};

const NUMERIC_COLUMN_KEYS: NumericColumnKey[] = [
  "sale_total",
  "paid_total",
  "debt_total",
  "operator_debt",
  "tax_iva21",
  "tax_iva105",
  "tax_iva21_comm",
  "tax_iva105_comm",
  "tax_base21",
  "tax_base105",
  "tax_exento",
  "tax_otros",
  "tax_noComp",
  "tax_transf",
  "tax_cardBase",
  "tax_cardIVA",
  "tax_commNoVAT",
  "tax_commNet",
  "tax_commWithVAT",
  "tax_total",
];
const NUMERIC_COLUMN_SET = new Set<VisibleKey>(NUMERIC_COLUMN_KEYS);
const isNumericColumnKey = (key: VisibleKey): key is NumericColumnKey =>
  NUMERIC_COLUMN_SET.has(key);

/* ================= Utilidades ================= */
function formatDateAR(iso?: string | null) {
  const formatted = formatDateOnlyInBuenosAires(iso ?? null);
  return formatted === "-" ? "—" : formatted;
}
const toNum = (v: number | string | null | undefined) => {
  const n =
    typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const normCurrency = (raw: string | null | undefined): CurrencyCode => {
  const s = (raw || "").trim().toUpperCase();
  if (s === "USD" || s === "U$D" || s === "U$S" || s === "US$") return "USD";
  return "ARS";
};
const normalizeDueStatus = (status?: string | null) => {
  const normalized = (status || "").trim().toUpperCase();
  if (normalized === "PAGO" || normalized === "PAGADA") return "PAGADA";
  if (normalized === "CANCELADA" || normalized === "CANCELADO")
    return "CANCELADA";
  return "PENDIENTE";
};

const TAKE = 120;

const CLIENT_STATUSES = ["Pendiente", "Pago", "Facturado"];
const OPERATOR_STATUSES = ["Pendiente", "Pago"];

function makeCurrencyTotals(): Record<CurrencyCode, number> {
  return { ARS: 0, USD: 0 };
}

function addCurrencyTotals(
  target: Record<CurrencyCode, number>,
  source: Record<CurrencyCode, number>,
) {
  target.ARS += source.ARS || 0;
  target.USD += source.USD || 0;
}

function addCurrencyAmount(
  target: Record<CurrencyCode, number>,
  currency: CurrencyCode,
  amount: number,
) {
  target[currency] += amount;
}

function downloadJsonFile(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ================= Page ================= */
export default function BalancesPage() {
  const { token, role: ctxRole } = useAuth();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const role = useMemo(
    () => (ctxRole || currentUser?.role || "").toLowerCase(),
    [ctxRole, currentUser?.role],
  );
  const currentUserId = currentUser?.id_user;
  const isVendor = role === "vendedor";
  const canPickOwner = [
    "gerente",
    "administrativo",
    "desarrollador",
    "lider",
  ].includes(role);
  const [calcMode, setCalcMode] = useState<"auto" | "manual" | null>(null);
  const [useBookingSaleTotal, setUseBookingSaleTotal] =
    useState<boolean>(false);
  const [transferFeePct, setTransferFeePct] = useState<number>(0.024);
  const [billingAdjustments, setBillingAdjustments] = useState<
    BillingAdjustmentConfig[]
  >([]);

  useEffect(() => {
    if (!token) {
      setCurrentUser(null);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await authFetch(
          "/api/user/profile",
          { cache: "no-store", signal: controller.signal },
          token || undefined,
        );
        if (!res.ok) throw new Error("No se pudo cargar tu perfil");
        const data = (await res.json()) as CurrentUser;
        if (!controller.signal.aborted) setCurrentUser(data);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("[balances] profile fetch failed", err);
      }
    })();
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token) {
      setCalcMode(null);
      setUseBookingSaleTotal(false);
      setTransferFeePct(0.024);
      setBillingAdjustments([]);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await authFetch(
          "/api/service-calc-config",
          { cache: "no-store", signal: controller.signal },
          token || undefined,
        );
        if (!res.ok) throw new Error("No se pudo cargar Cálculo & Comisiones");
        const data = (await res.json()) as {
          billing_breakdown_mode?: string | null;
          transfer_fee_pct?: number | null;
          billing_adjustments?: BillingAdjustmentConfig[] | null;
          use_booking_sale_total?: boolean;
        };
        if (controller.signal.aborted) return;
        const mode =
          (data?.billing_breakdown_mode || "").toLowerCase() === "manual"
            ? "manual"
            : "auto";
        setCalcMode(mode);
        setUseBookingSaleTotal(Boolean(data.use_booking_sale_total));
        const pct = Number(data.transfer_fee_pct);
        setTransferFeePct(Number.isFinite(pct) ? pct : 0.024);
        setBillingAdjustments(
          Array.isArray(data.billing_adjustments)
            ? data.billing_adjustments
            : [],
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("[balances] calc config", err);
        setCalcMode(null);
        setUseBookingSaleTotal(false);
        setTransferFeePct(0.024);
        setBillingAdjustments([]);
        toast.error(
          err instanceof Error
            ? err.message
            : "No se pudo cargar Cálculo & Comisiones",
        );
      }
    })();
    return () => controller.abort();
  }, [token]);

  /* ---------- Filtros ---------- */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [ownerId, setOwnerId] = useState<number | 0>(0);
  const [clientStatusArr, setClientStatusArr] = useState<string[]>([]);
  const [operatorStatusArr, setOperatorStatusArr] = useState<string[]>([]);
  const [dateMode, setDateMode] = useState<"travel" | "creation">("travel");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  /* ---------- Datos tabla/paginación ---------- */
  const [data, setData] = useState<Booking[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);
  const [appliedListQuery, setAppliedListQuery] = useState("");
  const [pageInit, setPageInit] = useState(false);

  /* ---------- Densidad / layout ---------- */
  type Density = "comfortable" | "compact";
  const [density, setDensity] = useState<Density>("comfortable");
  const STORAGE_KEY_COLS = "balances-columns-v2";
  const STORAGE_KEY_DENS = "balances-density-v1";

  useEffect(() => {
    const d = localStorage.getItem(STORAGE_KEY_DENS);
    if (d === "comfortable" || d === "compact") setDensity(d);
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DENS, density);
  }, [density]);

  /* ---------- Formatos moneda ---------- */
  const fmtARS = useCallback(
    (v: number) =>
      new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
      }).format(v),
    [],
  );
  const fmtUSD = useCallback(
    (v: number) =>
      new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "USD",
      })
        .format(v)
        .replace("US$", "U$D"),
    [],
  );

  const normalizeSaleTotals = useCallback((input: Booking["sale_totals"]) => {
    if (!input || typeof input !== "object") {
      return { ARS: 0, USD: 0 } as Record<CurrencyCode, number>;
    }
    const out: Record<CurrencyCode, number> = { ARS: 0, USD: 0 };
    for (const [keyRaw, val] of Object.entries(input)) {
      const key = normCurrency(String(keyRaw || ""));
      if (key !== "ARS" && key !== "USD") continue;
      const n =
        typeof val === "number" ? val : Number(String(val).replace(",", "."));
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    }
    return out;
  }, []);

  /* ---------- Helpers económico-contables ---------- */
  const sumByCurrency = useCallback(
    (services: Booking["services"], withInterest: boolean) => {
      return services.reduce<Record<CurrencyCode, number>>(
        (acc, s) => {
          const cur = normCurrency(s.currency);
          const split =
            toNum(s.taxableCardInterest) + toNum(s.vatOnCardInterest);
          const interest = split > 0 ? split : toNum(s.card_interest ?? 0);
          const extra = withInterest ? interest : 0;
          acc[cur] = (acc[cur] || 0) + toNum(s.sale_price) + extra;
          return acc;
        },
        { ARS: 0, USD: 0 },
      );
    },
    [],
  );

  const sumReceiptsByCurrency = useCallback((receipts: Booking["Receipt"]) => {
    return receipts.reduce<Record<CurrencyCode, number>>(
      (acc, r) => {
        const baseCur = r.base_currency ? normCurrency(r.base_currency) : null;
        const baseVal = toNum(r.base_amount ?? 0);

        const amountCur = r.amount_currency
          ? normCurrency(r.amount_currency)
          : null;

        const feeCurRaw = r.payment_fee_currency;
        const feeCur =
          feeCurRaw && String(feeCurRaw).trim() !== ""
            ? normCurrency(feeCurRaw)
            : (amountCur ?? baseCur);

        const amountVal = toNum(r.amount ?? 0);
        const feeVal = toNum(r.payment_fee_amount ?? 0);

        if (baseCur) {
          const val = baseVal + (feeCur === baseCur ? feeVal : 0);
          if (val) acc[baseCur] = (acc[baseCur] || 0) + val;
        } else if (amountCur) {
          const val = amountVal + (feeCur === amountCur ? feeVal : 0);
          if (val) acc[amountCur] = (acc[amountCur] || 0) + val;
        } else if (feeCur) {
          const val = feeVal;
          if (val) acc[feeCur] = (acc[feeCur] || 0) + val;
        }
        return acc;
      },
      { ARS: 0, USD: 0 },
    );
  }, []);

  const sumOperatorDuesByCurrency = useCallback(
    (dues: Booking["OperatorDue"]) => {
      return (dues ?? []).reduce<Record<CurrencyCode, number>>(
        (acc, d) => {
          if (normalizeDueStatus(d?.status) !== "PENDIENTE") return acc;
          const cur = normCurrency(d?.currency);
          const val = toNum(d?.amount ?? 0);
          if (val) acc[cur] = (acc[cur] || 0) + val;
          return acc;
        },
        { ARS: 0, USD: 0 },
      );
    },
    [],
  );

  const computeBookingAmounts = useCallback(
    (b: Booking) => {
      const saleNoInt = useBookingSaleTotal
        ? normalizeSaleTotals(b.sale_totals)
        : sumByCurrency(b.services, false);
      const saleWithInt = useBookingSaleTotal
        ? saleNoInt
        : sumByCurrency(b.services, true);
      const paid = sumReceiptsByCurrency(b.Receipt);
      const saleForDebt = calcMode === "manual" ? saleNoInt : saleWithInt;
      const debt: Record<CurrencyCode, number> = {
        ARS: (saleForDebt.ARS || 0) - (paid.ARS || 0),
        USD: (saleForDebt.USD || 0) - (paid.USD || 0),
      };
      const operatorDebt = sumOperatorDuesByCurrency(b.OperatorDue);

      return { saleNoInt, saleWithInt, paid, debt, operatorDebt };
    },
    [
      calcMode,
      normalizeSaleTotals,
      sumByCurrency,
      sumOperatorDuesByCurrency,
      sumReceiptsByCurrency,
      useBookingSaleTotal,
    ],
  );

  const sumTaxesByCurrency = useCallback(
    (services: Booking["services"]): Record<CurrencyCode, TaxBucket> => {
      const acc: Record<CurrencyCode, TaxBucket> = {
        ARS: makeEmptyTaxBucket(),
        USD: makeEmptyTaxBucket(),
      };

      services.forEach((s) => {
        const cur = s.currency === "USD" ? "USD" : "ARS";
        const bucket = acc[cur];

        const iva21 = toNum(s.tax_21);
        const iva105 = toNum(s.tax_105);
        const iva21Comm = toNum(s.vatOnCommission21);
        const iva105Comm = toNum(s.vatOnCommission10_5);
        const exento = toNum(s.exempt);
        const otros = toNum(s.other_taxes);
        const noComp = toNum(s.nonComputable);
        const base21 = toNum(s.taxableBase21);
        const base105 = toNum(s.taxableBase10_5);
        const cardIntBase = toNum(s.taxableCardInterest);
        const cardIntIVA = toNum(s.vatOnCardInterest);
        const commSinIVA = toNum(s.totalCommissionWithoutVAT);
        const commWithVAT = commSinIVA + iva21Comm + iva105Comm;

        const sale = toNum(s.sale_price);
        const pctRaw = s.transfer_fee_pct;
        const pct =
          pctRaw != null && String(pctRaw).trim() !== ""
            ? toNum(pctRaw)
            : transferFeePct;
        const transf =
          s.transfer_fee_amount != null
            ? toNum(s.transfer_fee_amount)
            : sale * (Number.isFinite(pct) ? pct : 0);
        const extraCosts = toNum(s.extra_costs_amount);
        const extraTaxes = toNum(s.extra_taxes_amount);
        const commNet = Math.max(
          commSinIVA - transf - extraCosts - extraTaxes,
          0,
        );

        bucket.iva21 += iva21;
        bucket.iva105 += iva105;
        bucket.iva21Comm += iva21Comm;
        bucket.iva105Comm += iva105Comm;
        bucket.exento += exento;
        bucket.otros += otros;
        bucket.noComp += noComp;
        bucket.base21 += base21;
        bucket.base105 += base105;
        bucket.cardIntBase += cardIntBase;
        bucket.cardIntIVA += cardIntIVA;
        bucket.transf += transf;
        bucket.commSinIVA += commSinIVA;
        bucket.commNet += commNet;
        bucket.commWithVAT += commWithVAT;

        bucket.total +=
          iva21 +
          iva105 +
          iva21Comm +
          iva105Comm +
          cardIntIVA +
          otros +
          noComp +
          transf;
      });

      return acc;
    },
    [transferFeePct],
  );

  const computeBookingCommissionBaseByCurrency = useCallback(
    (b: Booking, saleTotals: Record<CurrencyCode, number>) => {
      const costTotals: Record<CurrencyCode, number> = { ARS: 0, USD: 0 };
      const taxTotals: Record<CurrencyCode, number> = { ARS: 0, USD: 0 };
      const grossIncomeTaxTotals: Record<CurrencyCode, number> = { ARS: 0, USD: 0 };

      b.services.forEach((s) => {
        const cur = normCurrency(s.currency);
        costTotals[cur] = (costTotals[cur] || 0) + toNum(s.cost_price);
        taxTotals[cur] = (taxTotals[cur] || 0) + toNum(s.other_taxes);
        grossIncomeTaxTotals[cur] =
          (grossIncomeTaxTotals[cur] || 0) +
          getGrossIncomeTaxAmountFromBillingOverride(s.billing_override);
      });

      const out: Record<CurrencyCode, number> = { ARS: 0, USD: 0 };
      for (const cur of TAX_CURRENCIES) {
        const sale = saleTotals[cur] || 0;
        const cost = costTotals[cur] || 0;
        const taxes = taxTotals[cur] || 0;
        if (!sale && !cost && !taxes) continue;
        const commissionBeforeFee = Math.max(sale - cost - taxes, 0);
        const fee =
          sale * (Number.isFinite(transferFeePct) ? transferFeePct : 0);
        const adjustments = computeBillingAdjustments(
          billingAdjustments,
          sale,
          cost,
        ).total;
        const iibb = grossIncomeTaxTotals[cur] || 0;
        out[cur] = Math.max(commissionBeforeFee - fee - adjustments - iibb, 0);
      }

      return out;
    },
    [billingAdjustments, transferFeePct],
  );

  /* ---------- Normalizador reutilizable ---------- */
  const normalizeBooking = useCallback(
    (b: Booking): NormalizedBooking => {
      const titularFull =
        `${b.titular.last_name ?? ""} ${b.titular.first_name ?? ""}`.trim();
      const ownerFull =
        b.user?.first_name || b.user?.last_name
          ? `${b.user?.first_name || ""} ${b.user?.last_name || ""}`.trim()
          : "";

      const { saleNoInt, saleWithInt, paid, debt, operatorDebt } =
        computeBookingAmounts(b);

      const saleLabel = [
        saleNoInt.ARS ? fmtARS(saleNoInt.ARS) : "",
        saleNoInt.USD ? fmtUSD(saleNoInt.USD) : "",
      ]
        .filter(Boolean)
        .join(" y ");
      const paidLabel = [
        paid.ARS ? fmtARS(paid.ARS) : "",
        paid.USD ? fmtUSD(paid.USD) : "",
      ]
        .filter(Boolean)
        .join(" y ");
      const debtLabel = [
        debt.ARS ? fmtARS(debt.ARS) : "",
        debt.USD ? fmtUSD(debt.USD) : "",
      ]
        .filter(Boolean)
        .join(" y ");
      const operatorDebtLabel = [
        operatorDebt.ARS ? fmtARS(operatorDebt.ARS) : "",
        operatorDebt.USD ? fmtUSD(operatorDebt.USD) : "",
      ]
        .filter(Boolean)
        .join(" y ");

      const depDateKey =
        toDateKeyInBuenosAiresLegacySafe(b.departure_date ?? null) ?? "";
      const retDateKey =
        toDateKeyInBuenosAiresLegacySafe(b.return_date ?? null) ?? "";

      const taxByCurrency = sumTaxesByCurrency(b.services);
      if (useBookingSaleTotal) {
        const commNetByCur = computeBookingCommissionBaseByCurrency(
          b,
          saleNoInt,
        );
        for (const cur of TAX_CURRENCIES) {
          taxByCurrency[cur].commNet = commNetByCur[cur] || 0;
        }
      }
      return {
        ...b,
        _titularFull: titularFull,
        _ownerFull: ownerFull,
        _saleNoInt: saleNoInt,
        _saleWithInt: saleWithInt,
        _paid: paid,
        _debt: debt,
        _operatorDebt: operatorDebt,
        _saleLabel: saleLabel || "—",
        _paidLabel: paidLabel || "—",
        _debtLabel: debtLabel || "—",
        _operatorDebtLabel: operatorDebtLabel || "—",
        _depDateKey: depDateKey,
        _retDateKey: retDateKey,
        _travelLabel:
          depDateKey || retDateKey
            ? `${formatDateAR(b.departure_date)} – ${formatDateAR(b.return_date)}`
            : "—",
        _taxByCurrency: taxByCurrency,
      };
    },
    [
      fmtARS,
      fmtUSD,
      computeBookingAmounts,
      sumTaxesByCurrency,
      computeBookingCommissionBaseByCurrency,
      useBookingSaleTotal,
    ],
  );

  /* ---------- Normalizados/derivados para la tabla ---------- */
  const normalized = useMemo<NormalizedBooking[]>(
    () => data.map((b) => normalizeBooking(b)),
    [data, normalizeBooking],
  );

  /* ---------- Owners para selector ---------- */
  const ownersFromData = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of normalized) {
      const id = b.user?.id_user;
      if (!id) continue;
      const name =
        b.user?.first_name || b.user?.last_name
          ? `${b.user?.first_name || ""} ${b.user?.last_name || ""}`.trim()
          : `N° ${id}`;
      map.set(id, name);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "es"),
    );
  }, [normalized]);
  const [ownerCatalog, setOwnerCatalog] = useState<UserLite[]>([]);

  useEffect(() => {
    if (!token) {
      setOwnerCatalog([]);
      return;
    }
    if (!canPickOwner) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await authFetch(
          "/api/users",
          { cache: "no-store", signal: controller.signal },
          token || undefined,
        );
        if (!res.ok) throw new Error("No se pudieron cargar los vendedores");
        const list = (await res.json()) as (UserLite & {
          role?: string | null;
        })[];
        if (controller.signal.aborted) return;
        const cleaned = list
          .map((u) => ({
            id_user: u.id_user,
            first_name: u.first_name,
            last_name: u.last_name,
          }))
          .filter((u) => typeof u.id_user === "number");
        setOwnerCatalog(cleaned);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("[balances] owners fetch", err);
        toast.error(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los vendedores",
        );
      }
    })();
    return () => controller.abort();
  }, [token, canPickOwner]);

  const ownerOptions = useMemo(() => {
    const map = new Map<number, string>();
    ownerCatalog.forEach((u) => {
      const label = `${u.first_name || ""} ${u.last_name || ""}`.trim();
      map.set(u.id_user, label || `N° ${u.id_user}`);
    });
    ownersFromData.forEach(([id, name]) => {
      if (!map.has(id)) map.set(id, name);
    });
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "es"),
    );
  }, [ownerCatalog, ownersFromData]);
  const ownerLabelMap = useMemo(() => new Map(ownerOptions), [ownerOptions]);

  /* ---------- Forzar owner para vendedor ---------- */
  useEffect(() => {
    if (isVendor && currentUserId && ownerId !== currentUserId)
      setOwnerId(currentUserId);
  }, [isVendor, currentUserId, ownerId]);

  /* ---------- Columnas visibles ---------- */
  const defaultVisible: VisibleKey[] = [
    "id_booking",
    "titular",
    "owner",
    "clientStatus",
    "operatorStatus",
    "creation_date",
    "travel",
  ];

  const [visible, setVisible] = useState<VisibleKey[]>(defaultVisible);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COLS);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { visible?: VisibleKey[] };
      if (Array.isArray(parsed.visible)) setVisible(parsed.visible);
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify({ visible }));
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

  // Presets rápidos para columnas
  const applyPreset = (p: "basic" | "finance" | "debt") => {
    if (p === "basic") {
      setVisible([
        "id_booking",
        "titular",
        "owner",
        "clientStatus",
        "operatorStatus",
        "creation_date",
        "travel",
      ]);
    } else if (p === "finance") {
      setVisible([
        "id_booking",
        "titular",
        "owner",
        "sale_total",
        "paid_total",
        "debt_total",
        "tax_iva21",
        "tax_iva105",
        "tax_iva21_comm",
        "tax_iva105_comm",
        "tax_base21",
        "tax_base105",
        "tax_exento",
        "tax_otros",
        "tax_noComp",
        "tax_transf",
        "tax_cardIVA",
        "tax_commNoVAT",
        "tax_commNet",
        "tax_commWithVAT",
        "tax_total",
        "creation_date",
      ]);
    } else {
      setVisible([
        "id_booking",
        "titular",
        "debt_total",
        "operator_debt",
        "paid_total",
        "owner",
        "tax_iva21",
        "tax_iva105",
        "tax_total",
      ]);
    }
  };

  /* ---------- Ordenamiento ---------- */
  type SortKey =
    | "id_booking"
    | "titular"
    | "owner"
    | "clientStatus"
    | "operatorStatus"
    | "creation_date"
    | "travel"
    | "sale_total"
    | "paid_total"
    | "debt_total"
    | "operator_debt"
    | "tax_iva21"
    | "tax_iva105"
    | "tax_iva21_comm"
    | "tax_iva105_comm"
    | "tax_base21"
    | "tax_base105"
    | "tax_exento"
    | "tax_otros"
    | "tax_noComp"
    | "tax_transf"
    | "tax_cardBase"
    | "tax_cardIVA"
    | "tax_commNoVAT"
    | "tax_commNet"
    | "tax_commWithVAT"
    | "tax_total";

  const [sortKey, setSortKey] = useState<SortKey>("creation_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const setSort = (k: SortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("desc");
      return k;
    });
  };

  const getTaxFieldSum = (b: NormalizedBooking, field: keyof TaxBucket) => {
    const ars = b._taxByCurrency.ARS[field] || 0;
    const usd = b._taxByCurrency.USD[field] || 0;
    // le doy más peso al ARS para ordenar
    return ars * 1e6 + usd;
  };

  const sortedRows = useMemo(() => {
    const rows = [...normalized];
    const dirMul = sortDir === "asc" ? 1 : -1;

    rows.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;

      switch (sortKey) {
        case "id_booking":
          va = a.agency_booking_id ?? a.id_booking;
          vb = b.agency_booking_id ?? b.id_booking;
          break;
        case "titular":
          va = a._titularFull || "";
          vb = b._titularFull || "";
          break;
        case "owner":
          va = a._ownerFull || "";
          vb = b._ownerFull || "";
          break;
        case "clientStatus":
          va = a.clientStatus || "";
          vb = b.clientStatus || "";
          break;
        case "operatorStatus":
          va = a.operatorStatus || "";
          vb = b.operatorStatus || "";
          break;
        case "creation_date":
          va = toDateKeyInBuenosAiresLegacySafe(a.creation_date) ?? "";
          vb = toDateKeyInBuenosAiresLegacySafe(b.creation_date) ?? "";
          break;
        case "travel":
          va = a._depDateKey || "";
          vb = b._depDateKey || "";
          break;
        case "sale_total":
          va = (a._saleNoInt.ARS || 0) * 1e6 + (a._saleNoInt.USD || 0);
          vb = (b._saleNoInt.ARS || 0) * 1e6 + (b._saleNoInt.USD || 0);
          break;
        case "paid_total":
          va = (a._paid.ARS || 0) * 1e6 + (a._paid.USD || 0);
          vb = (b._paid.ARS || 0) * 1e6 + (b._paid.USD || 0);
          break;
        case "debt_total":
          va = (a._debt.ARS || 0) * 1e6 + (a._debt.USD || 0);
          vb = (b._debt.ARS || 0) * 1e6 + (b._debt.USD || 0);
          break;
        case "operator_debt":
          va = (a._operatorDebt.ARS || 0) * 1e6 + (a._operatorDebt.USD || 0);
          vb = (b._operatorDebt.ARS || 0) * 1e6 + (b._operatorDebt.USD || 0);
          break;
        case "tax_iva21":
          va = getTaxFieldSum(a, "iva21");
          vb = getTaxFieldSum(b, "iva21");
          break;
        case "tax_iva105":
          va = getTaxFieldSum(a, "iva105");
          vb = getTaxFieldSum(b, "iva105");
          break;
        case "tax_iva21_comm":
          va = getTaxFieldSum(a, "iva21Comm");
          vb = getTaxFieldSum(b, "iva21Comm");
          break;
        case "tax_iva105_comm":
          va = getTaxFieldSum(a, "iva105Comm");
          vb = getTaxFieldSum(b, "iva105Comm");
          break;
        case "tax_base21":
          va = getTaxFieldSum(a, "base21");
          vb = getTaxFieldSum(b, "base21");
          break;
        case "tax_base105":
          va = getTaxFieldSum(a, "base105");
          vb = getTaxFieldSum(b, "base105");
          break;
        case "tax_exento":
          va = getTaxFieldSum(a, "exento");
          vb = getTaxFieldSum(b, "exento");
          break;
        case "tax_otros":
          va = getTaxFieldSum(a, "otros");
          vb = getTaxFieldSum(b, "otros");
          break;
        case "tax_noComp":
          va = getTaxFieldSum(a, "noComp");
          vb = getTaxFieldSum(b, "noComp");
          break;
        case "tax_transf":
          va = getTaxFieldSum(a, "transf");
          vb = getTaxFieldSum(b, "transf");
          break;
        case "tax_cardBase":
          va = getTaxFieldSum(a, "cardIntBase");
          vb = getTaxFieldSum(b, "cardIntBase");
          break;
        case "tax_cardIVA":
          va = getTaxFieldSum(a, "cardIntIVA");
          vb = getTaxFieldSum(b, "cardIntIVA");
          break;
        case "tax_commNoVAT":
          va = getTaxFieldSum(a, "commSinIVA");
          vb = getTaxFieldSum(b, "commSinIVA");
          break;
        case "tax_commNet":
          va = getTaxFieldSum(a, "commNet");
          vb = getTaxFieldSum(b, "commNet");
          break;
        case "tax_commWithVAT":
          va = getTaxFieldSum(a, "commWithVAT");
          vb = getTaxFieldSum(b, "commWithVAT");
          break;
        case "tax_total":
          va = getTaxFieldSum(a, "total");
          vb = getTaxFieldSum(b, "total");
          break;
      }

      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb, "es") * dirMul;
      }
      return ((va as number) - (vb as number)) * dirMul;
    });

    return rows;
  }, [normalized, sortKey, sortDir]);

  const [fullKpis, setFullKpis] = useState<BalanceKpis | null>(null);
  const [fullKpisLoading, setFullKpisLoading] = useState(false);
  const totalsAbortRef = useRef<AbortController | null>(null);

  /* ---------- Fetch page / aplicar ---------- */
  const buildQS = useCallback(
    (withCursor?: number | null, opts?: { take?: number }) => {
      const qs = new URLSearchParams();
      if (q.trim()) qs.append("q", q.trim());

      // owner (según permisos)
      const wantedUserId =
        isVendor && currentUserId ? currentUserId : canPickOwner ? ownerId : 0;
      if (wantedUserId) qs.append("userId", String(wantedUserId));

      // estados
      if (clientStatusArr.length)
        qs.append("clientStatus", clientStatusArr.join(","));
      if (operatorStatusArr.length)
        qs.append("operatorStatus", operatorStatusArr.join(","));

      // fechas según modo
      if (dateMode === "creation") {
        if (from) qs.append("creationFrom", from);
        if (to) qs.append("creationTo", to);
      } else {
        if (from) qs.append("from", from);
        if (to) qs.append("to", to);
      }

      // paginación
      qs.append("take", String(opts?.take ?? TAKE));
      if (withCursor !== undefined && withCursor !== null)
        qs.append("cursor", String(withCursor));
      qs.append("includeOperatorDues", "1");

      return qs;
    },
    [
      q,
      isVendor,
      currentUserId,
      canPickOwner,
      ownerId,
      clientStatusArr,
      operatorStatusArr,
      dateMode,
      from,
      to,
    ],
  );

  const fetchPage = useCallback(
    async (resetList: boolean) => {
      setLoading(true);
      try {
        const qs = buildQS(resetList ? undefined : cursor);
        if (resetList) {
          const appliedQS = new URLSearchParams(qs.toString());
          appliedQS.delete("cursor");
          appliedQS.delete("take");
          setAppliedListQuery(appliedQS.toString());
        }
        const res = await authFetch(
          `/api/bookings?${qs.toString()}`,
          { cache: "no-store" },
          token || undefined,
        );
        const json: BookingsAPI = await res.json();
        if (!res.ok) throw new Error(json?.error || "Error al cargar reservas");

        setData((prev) => (resetList ? json.items : [...prev, ...json.items]));
        setCursor(json.nextCursor ?? null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error al cargar reservas";
        toast.error(msg);
      } finally {
        setLoading(false);
        setPageInit(true);
      }
    },
    [buildQS, cursor, token],
  );

  const fetchTotals = useCallback(async () => {
    if (!token || !calcMode) {
      setFullKpis(null);
      setFullKpisLoading(false);
      return;
    }

    totalsAbortRef.current?.abort();
    const controller = new AbortController();
    totalsAbortRef.current = controller;
    setFullKpisLoading(true);
    setFullKpis(null);

    let count = 0;
    let saleARS = 0,
      saleUSD = 0,
      paidARS = 0,
      paidUSD = 0,
      debtARS = 0,
      debtUSD = 0,
      operatorDebtARS = 0,
      operatorDebtUSD = 0;

    try {
      let next: number | null = null;
      for (let i = 0; i < 2000; i++) {
        const qs = buildQS(next, { take: 100 });
        const res = await authFetch(
          `/api/bookings?${qs.toString()}`,
          { cache: "no-store", signal: controller.signal },
          token || undefined,
        );
        const json: BookingsAPI = await res.json();
        if (!res.ok)
          throw new Error(json?.error || "Error al cargar totales");

        const items = Array.isArray(json.items) ? json.items : [];
        count += items.length;

        for (const b of items) {
          const amounts = computeBookingAmounts(b);
          saleARS += amounts.saleNoInt.ARS || 0;
          saleUSD += amounts.saleNoInt.USD || 0;
          paidARS += amounts.paid.ARS || 0;
          paidUSD += amounts.paid.USD || 0;
          debtARS += amounts.debt.ARS || 0;
          debtUSD += amounts.debt.USD || 0;
          operatorDebtARS += amounts.operatorDebt.ARS || 0;
          operatorDebtUSD += amounts.operatorDebt.USD || 0;
        }

        next = json.nextCursor ?? null;
        if (next === null || items.length === 0) break;
      }

      if (!controller.signal.aborted) {
        setFullKpis({
          count,
          sale: { ARS: saleARS, USD: saleUSD },
          paid: { ARS: paidARS, USD: paidUSD },
          debt: { ARS: debtARS, USD: debtUSD },
          operatorDebt: { ARS: operatorDebtARS, USD: operatorDebtUSD },
        });
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = e instanceof Error ? e.message : "Error al cargar totales";
      toast.error(msg);
      setFullKpis(null);
    } finally {
      if (!controller.signal.aborted) setFullKpisLoading(false);
    }
  }, [buildQS, calcMode, computeBookingAmounts, token]);

  const handleSearch = () => {
    setCursor(null);
    setData([]);
    fetchPage(true);
    void fetchTotals();
  };

  useEffect(() => {
    if (data.length === 0 && !loading) {
      fetchPage(true);
      void fetchTotals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!calcMode || !token) return;
    void fetchTotals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcMode, token, useBookingSaleTotal]);

  useEffect(() => {
    return () => {
      totalsAbortRef.current?.abort();
    };
  }, []);

  /* ---------- Helpers de impuestos para UI / CSV ---------- */

  function formatTaxField(
    b: NormalizedBooking,
    field: keyof TaxBucket,
  ): string {
    const parts: string[] = [];
    for (const code of TAX_CURRENCIES) {
      const bucket = b._taxByCurrency[code];
      if (!bucket) continue;
      const value = bucket[field];
      if (!value) continue;
      const fmt = code === "ARS" ? fmtARS : fmtUSD;
      parts.push(fmt(value));
    }
    return parts.join(" / ");
  }

  const renderTaxCell = (
    b: NormalizedBooking,
    field: keyof TaxBucket,
    tdKey: string,
    rowPad: string,
  ) => {
    const label = formatTaxField(b, field);
    return (
      <td key={tdKey} className={`px-4 ${rowPad} text-center`}>
        {label || <span className="opacity-60">—</span>}
      </td>
    );
  };

  const formatCurrencyTotals = useCallback(
    (values: Record<CurrencyCode, number>) =>
      (
        [values.ARS ? fmtARS(values.ARS) : "", values.USD ? fmtUSD(values.USD) : ""]
      )
        .filter(Boolean)
        .join(" y ") || "—",
    [fmtARS, fmtUSD],
  );

  const getNumericColumnValues = useCallback(
    (b: NormalizedBooking, key: NumericColumnKey): Record<CurrencyCode, number> => {
      if (key === "sale_total") return b._saleNoInt;
      if (key === "paid_total") return b._paid;
      if (key === "debt_total") return b._debt;
      if (key === "operator_debt") return b._operatorDebt;

      const taxField = TAX_FIELD_BY_COLUMN[key as TaxColumnKey];
      return {
        ARS: b._taxByCurrency.ARS[taxField] || 0,
        USD: b._taxByCurrency.USD[taxField] || 0,
      };
    },
    [],
  );

  const totalsByColumn = useMemo(() => {
    const out = new Map<VisibleKey, Record<CurrencyCode, number>>();
    const numericVisible = visibleCols
      .map((col) => col.key)
      .filter(isNumericColumnKey);

    for (const key of numericVisible) {
      out.set(key, { ARS: 0, USD: 0 });
    }

    for (const row of sortedRows) {
      for (const key of numericVisible) {
        const values = getNumericColumnValues(row, key);
        const totals = out.get(key);
        if (!totals) continue;
        totals.ARS += values.ARS || 0;
        totals.USD += values.USD || 0;
      }
    }

    return out;
  }, [getNumericColumnValues, sortedRows, visibleCols]);

  /* ---------- CSV (full-scan, no sólo lo cargado) ---------- */
  const toTextCellValue = (col: VisibleKey, b: NormalizedBooking): string => {
    switch (col) {
      case "id_booking":
        return String(b.agency_booking_id ?? b.id_booking);
      case "titular":
        return b._titularFull || "";
      case "owner":
        return b._ownerFull || "";
      case "clientStatus":
        return b.clientStatus || "";
      case "operatorStatus":
        return b.operatorStatus || "";
      case "creation_date":
        return formatDateAR(b.creation_date);
      case "travel":
        return b._travelLabel;
      default:
        return "";
    }
  };

  const downloadCSV = async () => {
    if (exportingCsv) return;
    setExportingCsv(true);
    try {
      const headers = visibleCols.flatMap((col) =>
        isNumericColumnKey(col.key)
          ? [`${col.label} ARS`, `${col.label} USD`]
          : [col.label],
      );

      // Full-scan con paginado
      let next: number | null = null;
      const rows: string[] = [];
      const fallbackQuery = buildQS(undefined);
      fallbackQuery.delete("cursor");
      fallbackQuery.delete("take");
      const baseFilters = new URLSearchParams(
        appliedListQuery || fallbackQuery.toString(),
      );

      for (let i = 0; i < 200; i++) {
        const qs = new URLSearchParams(baseFilters.toString());
        qs.set("take", String(TAKE));
        if (next != null) qs.set("cursor", String(next));
        const res = await authFetch(
          `/api/bookings?${qs.toString()}`,
          { cache: "no-store" },
          token || undefined,
        );
        const json: BookingsAPI = await res.json();
        if (!res.ok) throw new Error(json?.error || "Error al exportar CSV");

        const pageNorm: NormalizedBooking[] = json.items.map((b) =>
          normalizeBooking(b),
        );

        for (const b of pageNorm) {
          const rowCells = visibleCols.flatMap((col) => {
            if (isNumericColumnKey(col.key)) {
              const values = getNumericColumnValues(b, col.key);
              return [
                { value: formatCsvNumber(values.ARS), numeric: true },
                { value: formatCsvNumber(values.USD), numeric: true },
              ];
            }
            return [{ value: toTextCellValue(col.key, b) }];
          });
          rows.push(toCsvRow(rowCells));
        }

        next = json.nextCursor ?? null;
        if (next === null) break;
      }

      const csv = [toCsvHeaderRow(headers), ...rows].join("\r\n");
      downloadCsvFile(csv, `reservas_${todayDateKeyInBuenosAires()}.csv`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al descargar CSV";
      toast.error(msg);
    } finally {
      setExportingCsv(false);
    }
  };

  const downloadMonthlyJSON = async () => {
    if (exportingJson) return;
    setExportingJson(true);
    try {
      const todayKey = todayDateKeyInBuenosAires();
      const resolveRange = (): {
        from: string;
        to: string;
        usedDefaultRange: boolean;
      } => {
        if (from && to) return { from, to, usedDefaultRange: false };
        if (from && !to) return { from, to: todayKey, usedDefaultRange: true };
        if (!from && to) {
          const monthPrefix =
            /^\d{4}-\d{2}-\d{2}$/.test(to) ? to.slice(0, 7) : todayKey.slice(0, 7);
          return {
            from: `${monthPrefix}-01`,
            to,
            usedDefaultRange: true,
          };
        }
        const currentMonth = todayKey.slice(0, 7);
        return {
          from: `${currentMonth}-01`,
          to: todayKey,
          usedDefaultRange: true,
        };
      };

      const range = resolveRange();

      const fallbackQuery = buildQS(undefined);
      fallbackQuery.delete("cursor");
      fallbackQuery.delete("take");
      const baseFilters = new URLSearchParams(
        appliedListQuery || fallbackQuery.toString(),
      );
      if (dateMode === "creation") {
        baseFilters.set("creationFrom", range.from);
        baseFilters.set("creationTo", range.to);
        baseFilters.delete("from");
        baseFilters.delete("to");
      } else {
        baseFilters.set("from", range.from);
        baseFilters.set("to", range.to);
        baseFilters.delete("creationFrom");
        baseFilters.delete("creationTo");
      }

      const salesTotal = makeCurrencyTotals();
      const collectionsTotal = makeCurrencyTotals();
      const receivablesTotal = makeCurrencyTotals();
      const operatorDuesTotal = makeCurrencyTotals();
      const serviceCostsTotal = makeCurrencyTotals();
      const commissionsTotal = makeCurrencyTotals();

      let bookingCount = 0;
      let serviceCount = 0;
      let receiptCount = 0;

      let next: number | null = null;
      for (let i = 0; i < 220; i++) {
        const qs = new URLSearchParams(baseFilters.toString());
        qs.set("take", String(TAKE));
        if (next != null) qs.set("cursor", String(next));

        const res = await authFetch(
          `/api/bookings?${qs.toString()}`,
          { cache: "no-store" },
          token || undefined,
        );
        const json: BookingsAPI = await res.json();
        if (!res.ok) throw new Error(json?.error || "Error al generar JSON");

        const items = Array.isArray(json.items) ? json.items : [];
        bookingCount += items.length;

        for (const booking of items) {
          const amounts = computeBookingAmounts(booking);
          addCurrencyTotals(salesTotal, amounts.saleNoInt);
          addCurrencyTotals(collectionsTotal, amounts.paid);
          addCurrencyTotals(receivablesTotal, amounts.debt);
          addCurrencyTotals(operatorDuesTotal, amounts.operatorDebt);

          if (useBookingSaleTotal) {
            const bookingCommission = computeBookingCommissionBaseByCurrency(
              booking,
              amounts.saleNoInt,
            );
            addCurrencyTotals(commissionsTotal, bookingCommission);
          } else {
            const taxByCurrency = sumTaxesByCurrency(booking.services);
            addCurrencyAmount(
              commissionsTotal,
              "ARS",
              taxByCurrency.ARS.commNet || 0,
            );
            addCurrencyAmount(
              commissionsTotal,
              "USD",
              taxByCurrency.USD.commNet || 0,
            );
          }

          const services = Array.isArray(booking.services) ? booking.services : [];
          serviceCount += services.length;
          for (const service of services) {
            const cur = normCurrency(service.currency);
            addCurrencyAmount(serviceCostsTotal, cur, toNum(service.cost_price));
          }

          receiptCount += Array.isArray(booking.Receipt)
            ? booking.Receipt.length
            : 0;
        }

        next = json.nextCursor ?? null;
        if (next === null || items.length === 0) break;
      }

      type InvestmentScanResult = {
        totals: Record<CurrencyCode, number>;
        count: number;
      };
      const scanInvestments = async (opts: {
        operatorOnly?: boolean;
        excludeOperator?: boolean;
      }): Promise<InvestmentScanResult> => {
        const totals = makeCurrencyTotals();
        let count = 0;
        let nextCursor: number | null = null;

        for (let i = 0; i < 220; i++) {
          const qs = new URLSearchParams({
            paidFrom: range.from,
            paidTo: range.to,
            effectivePaidDate: "1",
            take: "100",
          });
          if (opts.operatorOnly) qs.set("operatorOnly", "1");
          if (opts.excludeOperator) qs.set("excludeOperator", "1");
          if (nextCursor != null) qs.set("cursor", String(nextCursor));

          const res = await authFetch(
            `/api/investments?${qs.toString()}`,
            { cache: "no-store" },
            token || undefined,
          );

          const payload = (await res.json()) as {
            error?: string;
            items?: Array<{ amount?: number | string | null; currency?: string | null }>;
            nextCursor?: number | null;
          };
          if (!res.ok) {
            throw new Error(payload?.error || "Error al cargar pagos/gastos");
          }

          const items = Array.isArray(payload.items) ? payload.items : [];
          count += items.length;
          for (const row of items) {
            const cur = normCurrency(row.currency);
            addCurrencyAmount(totals, cur, toNum(row.amount));
          }

          const nextValue =
            typeof payload.nextCursor === "number" &&
            Number.isFinite(payload.nextCursor)
              ? payload.nextCursor
              : null;
          if (!nextValue || nextValue === nextCursor) break;
          nextCursor = nextValue;
        }

        return { totals, count };
      };

      const [operatorPayments, nonOperatorExpenses] = await Promise.all([
        scanInvestments({ operatorOnly: true }),
        scanInvestments({ excludeOperator: true }),
      ]);

      const grossProfit = makeCurrencyTotals();
      const outflowsTotal = makeCurrencyTotals();
      const salesResult = makeCurrencyTotals();
      const commissionResult = makeCurrencyTotals();
      const cashResult = makeCurrencyTotals();
      const workingCapitalGap = makeCurrencyTotals();
      (["ARS", "USD"] as const).forEach((cur) => {
        grossProfit[cur] = round2((salesTotal[cur] || 0) - (serviceCostsTotal[cur] || 0));
        salesResult[cur] = round2(
          (grossProfit[cur] || 0) - (nonOperatorExpenses.totals[cur] || 0),
        );
        commissionResult[cur] = round2(
          (commissionsTotal[cur] || 0) - (nonOperatorExpenses.totals[cur] || 0),
        );
        outflowsTotal[cur] = round2(
          (operatorPayments.totals[cur] || 0) +
            (nonOperatorExpenses.totals[cur] || 0),
        );
        cashResult[cur] = round2(
          (collectionsTotal[cur] || 0) - (outflowsTotal[cur] || 0),
        );
        workingCapitalGap[cur] = round2(
          (receivablesTotal[cur] || 0) - (operatorDuesTotal[cur] || 0),
        );
      });

      const report = {
        report_type: "agency_monthly_financial_state",
        version: 2,
        generated_at: new Date().toISOString(),
        timezone: "America/Argentina/Buenos_Aires",
        period: {
          from: range.from,
          to: range.to,
          date_mode: dateMode,
          used_default_month_range: range.usedDefaultRange,
        },
        formula_notes: {
          gross_profit_total: "sales_total - service_costs_total",
          sales_result_total:
            "gross_profit_total - non_operator_expenses_total",
          commission_result_total:
            "commissions_total - non_operator_expenses_total (alineado con Ganancias)",
          cash_result_total:
            "collections_total - operator_payments_total - non_operator_expenses_total",
          working_capital_gap_total:
            "receivables_total - operator_dues_total",
        },
        filters: {
          query: q.trim() || null,
          owner_id: ownerId || null,
          client_status: clientStatusArr,
          operator_status: operatorStatusArr,
        },
        summary_by_currency: {
          ARS: {
            sales_total: round2(salesTotal.ARS),
            service_costs_total: round2(serviceCostsTotal.ARS),
            gross_profit_total: round2(grossProfit.ARS),
            commissions_total: round2(commissionsTotal.ARS),
            collections_total: round2(collectionsTotal.ARS),
            receivables_total: round2(receivablesTotal.ARS),
            operator_dues_total: round2(operatorDuesTotal.ARS),
            operator_payments_total: round2(operatorPayments.totals.ARS),
            non_operator_expenses_total: round2(nonOperatorExpenses.totals.ARS),
            outflows_total: round2(outflowsTotal.ARS),
            sales_result_total: round2(salesResult.ARS),
            commission_result_total: round2(commissionResult.ARS),
            cash_result_total: round2(cashResult.ARS),
            working_capital_gap_total: round2(workingCapitalGap.ARS),
          },
          USD: {
            sales_total: round2(salesTotal.USD),
            service_costs_total: round2(serviceCostsTotal.USD),
            gross_profit_total: round2(grossProfit.USD),
            commissions_total: round2(commissionsTotal.USD),
            collections_total: round2(collectionsTotal.USD),
            receivables_total: round2(receivablesTotal.USD),
            operator_dues_total: round2(operatorDuesTotal.USD),
            operator_payments_total: round2(operatorPayments.totals.USD),
            non_operator_expenses_total: round2(nonOperatorExpenses.totals.USD),
            outflows_total: round2(outflowsTotal.USD),
            sales_result_total: round2(salesResult.USD),
            commission_result_total: round2(commissionResult.USD),
            cash_result_total: round2(cashResult.USD),
            working_capital_gap_total: round2(workingCapitalGap.USD),
          },
        },
        counts: {
          bookings: bookingCount,
          services: serviceCount,
          receipts: receiptCount,
          operator_payments: operatorPayments.count,
          non_operator_expenses: nonOperatorExpenses.count,
        },
      };

      const safeFrom = range.from.replaceAll("-", "");
      const safeTo = range.to.replaceAll("-", "");
      downloadJsonFile(report, `estado_mensual_${safeFrom}_${safeTo}.json`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al descargar JSON";
      toast.error(msg);
    } finally {
      setExportingJson(false);
    }
  };

  /* ---------- Acciones filtros ---------- */
  const clearFilters = () => {
    setQ("");
    setClientStatusArr([]);
    setOperatorStatusArr([]);
    setDateMode("travel");
    setFrom("");
    setTo("");
    if (!isVendor) setOwnerId(0);
  };
  const activeFilters = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    const trimmedQ = q.trim();
    if (trimmedQ) chips.push({ key: "q", label: `Búsqueda: "${trimmedQ}"` });
    if (ownerId && (!isVendor || canPickOwner)) {
      const label =
        ownerLabelMap.get(ownerId) ||
        (isVendor && currentUserId === ownerId
          ? "Mis reservas"
          : `N° ${ownerId}`);
      chips.push({ key: "owner", label: `Vendedor: ${label}` });
    }
    if (clientStatusArr.length)
      chips.push({
        key: "clientStatus",
        label: `Pax: ${clientStatusArr.join(", ")}`,
      });
    if (operatorStatusArr.length)
      chips.push({
        key: "operatorStatus",
        label: `Operador: ${operatorStatusArr.join(", ")}`,
      });
    if (from || to) {
      const range = `${from ? formatDateAR(from) : "—"} – ${to ? formatDateAR(to) : "—"}`;
      const title = dateMode === "creation" ? "Creación" : "Viaje";
      chips.push({ key: "date", label: `Fecha (${title}): ${range}` });
    }
    return chips;
  }, [
    q,
    ownerId,
    isVendor,
    canPickOwner,
    ownerLabelMap,
    currentUserId,
    clientStatusArr,
    operatorStatusArr,
    from,
    to,
    dateMode,
  ]);
  const activeFilterCount = activeFilters.length;

  /* ================= UI ================= */
  const rowPad = density === "compact" ? "py-1.5" : "py-2.5";
  const kpiPlaceholder = fullKpisLoading ? "Calculando..." : "—";
  const kpisForHeader = fullKpis;

  return (
    <ProtectedRoute>
      <div>
        {/* Title + KPIs */}
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-sky-950 dark:text-white">
              Saldos / Reservas
            </h1>
            <p className="text-sm opacity-70">
              Visualizá ventas, cobros, deuda e impuestos por reserva.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ChipKPI
              label="Total"
              value={kpisForHeader ? kpisForHeader.count : kpiPlaceholder}
            />
            <ChipKPI
              label="Venta"
              value={
                kpisForHeader
                  ? [
                      kpisForHeader.sale.ARS
                        ? fmtARS(kpisForHeader.sale.ARS)
                        : "",
                      kpisForHeader.sale.USD
                        ? fmtUSD(kpisForHeader.sale.USD)
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" y ") || "—"
                  : kpiPlaceholder
              }
            />
            <ChipKPI
              label="Cobrado"
              value={
                kpisForHeader
                  ? [
                      kpisForHeader.paid.ARS
                        ? fmtARS(kpisForHeader.paid.ARS)
                        : "",
                      kpisForHeader.paid.USD
                        ? fmtUSD(kpisForHeader.paid.USD)
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" y ") || "—"
                  : kpiPlaceholder
              }
            />
            <ChipKPI
              label="Deuda"
              value={
                kpisForHeader
                  ? [
                      kpisForHeader.debt.ARS
                        ? fmtARS(kpisForHeader.debt.ARS)
                        : "",
                      kpisForHeader.debt.USD
                        ? fmtUSD(kpisForHeader.debt.USD)
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" y ") || "—"
                  : kpiPlaceholder
              }
            />
            <ChipKPI
              label="Deuda operadores"
              value={
                kpisForHeader
                  ? [
                      kpisForHeader.operatorDebt.ARS
                        ? fmtARS(kpisForHeader.operatorDebt.ARS)
                        : "",
                      kpisForHeader.operatorDebt.USD
                        ? fmtUSD(kpisForHeader.operatorDebt.USD)
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" y ") || "—"
                  : kpiPlaceholder
              }
            />
          </div>
        </div>

        {calcMode === "manual" && (
          <div
            className={`${GLASS} mb-6 border-amber-400/30 bg-amber-50/60 p-4 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">
                  Cálculo &amp; Comisiones está en modo manual
                </p>
                <p className="text-sm opacity-80">
                  Los importes de impuestos y comisiones se completan
                  manualmente. Revisá la configuración de reservas si querés
                  activar el cálculo automático para esta agencia.
                </p>
              </div>
              <Link href="/bookings/config" className={PRIMARY_BTN}>
                Ir a configuración
              </Link>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={ICON_BTN}
          >
            {filtersOpen
              ? "Ocultar filtros"
              : activeFilterCount > 0
                ? `Mostrar filtros (${activeFilterCount})`
                : "Mostrar filtros"}
          </button>

          <div className="hidden h-5 w-px bg-sky-950/30 dark:bg-white/30 sm:block" />

          <button onClick={() => setPickerOpen(true)} className={ICON_BTN}>
            Columnas
          </button>

          <div className="hidden h-5 w-px bg-sky-950/30 dark:bg-white/30 sm:block" />

          <div className="flex items-center gap-1">
            <button onClick={() => applyPreset("basic")} className={ICON_BTN}>
              Básico
            </button>
            <button onClick={() => applyPreset("finance")} className={ICON_BTN}>
              Finanzas
            </button>
            <button onClick={() => applyPreset("debt")} className={ICON_BTN}>
              Deuda
            </button>
          </div>

          <div className="hidden h-5 w-px bg-sky-950/30 dark:bg-white/30 sm:block" />

          <div className="flex items-center gap-1">
            <button
              onClick={() => setDensity("comfortable")}
              className={`${ICON_BTN} ${density === "comfortable" ? "ring-1 ring-sky-400/60" : ""}`}
              title="Densidad cómoda"
            >
              Cómoda
            </button>
            <button
              onClick={() => setDensity("compact")}
              className={`${ICON_BTN} ${density === "compact" ? "ring-1 ring-sky-400/60" : ""}`}
              title="Densidad compacta"
            >
              Compacta
            </button>
          </div>

          <div className="hidden h-5 w-px bg-sky-950/30 dark:bg-white/30 sm:block" />

          <ExportSheetButton
            onClick={downloadCSV}
            loading={exportingCsv}
            disabled={exportingCsv || exportingJson}
          />
          <ExportSheetButton
            onClick={downloadMonthlyJSON}
            loading={exportingJson}
            disabled={exportingCsv || exportingJson}
            label="Descargar JSON mensual"
            loadingLabel="Generando JSON..."
          />
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className={ICON_BTN}>
              Limpiar filtros
            </button>
          )}
        </div>

        {activeFilterCount > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
            {activeFilters.map((chip) => (
              <span
                key={chip.key}
                className={`${CHIP} border-sky-200/60 bg-sky-50/60 text-sky-900 dark:border-white/20 dark:bg-white/5 dark:text-white`}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}

        {/* Filtros */}
        {filtersOpen && (
          <div className={`${GLASS} mb-8 p-4`}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              {/* q */}
              <div className="md:col-span-4">
                <Label>Buscar</Label>
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Reserva, titular, detalles..."
                />
              </div>

              {/* vendedor */}
              <div className="md:col-span-3">
                <Label>Vendedor</Label>
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(Number(e.target.value))}
                  disabled={!canPickOwner}
                  className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
                >
                  {!isVendor && <option value={0}>Todos</option>}
                  {isVendor && currentUserId && (
                    <option value={currentUserId}>Mis reservas</option>
                  )}
                  {(!isVendor || canPickOwner) &&
                    ownerOptions.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Estados */}
              <div className="md:col-span-5">
                <Label>Estados</Label>
                <div className="flex flex-wrap gap-2">
                  {CLIENT_STATUSES.map((st) => (
                    <button
                      key={`c-${st}`}
                      onClick={() =>
                        setClientStatusArr((arr) =>
                          arr.includes(st)
                            ? arr.filter((x) => x !== st)
                            : [...arr, st],
                        )
                      }
                      className={`${CHIP} ${clientStatusArr.includes(st) ? "ring-1 ring-sky-400/50" : ""}`}
                    >
                      Pax: {st}
                    </button>
                  ))}
                  {OPERATOR_STATUSES.map((st) => (
                    <button
                      key={`o-${st}`}
                      onClick={() =>
                        setOperatorStatusArr((arr) =>
                          arr.includes(st)
                            ? arr.filter((x) => x !== st)
                            : [...arr, st],
                        )
                      }
                      className={`${CHIP} ${operatorStatusArr.includes(st) ? "ring-1 ring-sky-400/50" : ""}`}
                    >
                      Operador: {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Modo de fecha */}
              <div className="md:col-span-3">
                <Label>Filtrar por</Label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDateMode("travel")}
                    className={`${CHIP} ${dateMode === "travel" ? "ring-1 ring-sky-400/50" : ""}`}
                  >
                    Viaje
                  </button>
                  <button
                    onClick={() => setDateMode("creation")}
                    className={`${CHIP} ${dateMode === "creation" ? "ring-1 ring-sky-400/50" : ""}`}
                  >
                    Creación
                  </button>
                </div>
              </div>

              {/* Fechas */}
              <div className="flex gap-3 md:col-span-4">
                <div className="flex-1">
                  <Label>Desde</Label>
                  <Input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <Label>Hasta</Label>
                  <Input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </div>

              {/* Acciones */}
              <div className="flex flex-wrap items-end justify-end gap-2 md:col-span-12">
                <button onClick={clearFilters} className={ICON_BTN}>
                  Limpiar
                </button>
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  className={`${PRIMARY_BTN} disabled:opacity-50`}
                >
                  {loading ? <Spinner /> : "Aplicar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tabla */}
        <div className={`${GLASS} mb-8 overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/40 backdrop-blur dark:bg-zinc-900/40">
              <tr className="text-zinc-700 dark:text-zinc-200">
                {visibleCols.map((c) => {
                  const sortable = true;
                  const active = sortKey === (c.key as SortKey);
                  return (
                    <th
                      key={c.key}
                      className={`cursor-pointer select-none px-4 ${rowPad} text-center font-medium decoration-transparent hover:underline hover:decoration-sky-600`}
                      onClick={() => setSort(c.key as SortKey)}
                      title="Ordenar"
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sortable && (
                          <span className="inline-block text-xs opacity-70">
                            {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="h-96 overflow-scroll">
              {sortedRows.map((b, idx) => (
                <tr
                  key={b.id_booking}
                  className={`border-t border-white/20 transition hover:bg-white/10 dark:border-white/10 ${
                    idx % 2 === 1 ? "bg-white/5 dark:bg-white/5" : ""
                  }`}
                >
                  {visibleCols.map((col) => {
                    switch (col.key) {
                      case "id_booking": {
                        const bookingNumber =
                          b.agency_booking_id ?? b.id_booking;
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            <Link
                              href={`/bookings/services/${b.public_id ?? b.id_booking}`}
                              target="_blank"
                              className="underline decoration-transparent hover:decoration-sky-600"
                            >
                              {bookingNumber}
                            </Link>
                          </td>
                        );
                      }
                      case "titular":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            {b._titularFull || "—"}
                          </td>
                        );
                      case "owner":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            {b._ownerFull || "—"}
                          </td>
                        );
                      case "clientStatus":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            <StatusBadge type="client" value={b.clientStatus} />
                          </td>
                        );
                      case "operatorStatus":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            <StatusBadge type="op" value={b.operatorStatus} />
                          </td>
                        );
                      case "creation_date":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            {formatDateAR(b.creation_date)}
                          </td>
                        );
                      case "travel":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            {b._travelLabel}
                          </td>
                        );
                      case "sale_total":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            {b._saleLabel}
                          </td>
                        );
                      case "paid_total":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            {b._paidLabel}
                          </td>
                        );
                      case "debt_total":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            {b._debtLabel}
                          </td>
                        );
                      case "operator_debt":
                        return (
                          <td
                            key={col.key}
                            className={`px-4 ${rowPad} text-center`}
                          >
                            {b._operatorDebtLabel}
                          </td>
                        );
                      case "tax_iva21":
                        return renderTaxCell(b, "iva21", col.key, rowPad);
                      case "tax_iva105":
                        return renderTaxCell(b, "iva105", col.key, rowPad);
                      case "tax_iva21_comm":
                        return renderTaxCell(b, "iva21Comm", col.key, rowPad);
                      case "tax_iva105_comm":
                        return renderTaxCell(b, "iva105Comm", col.key, rowPad);
                      case "tax_base21":
                        return renderTaxCell(b, "base21", col.key, rowPad);
                      case "tax_base105":
                        return renderTaxCell(b, "base105", col.key, rowPad);
                      case "tax_exento":
                        return renderTaxCell(b, "exento", col.key, rowPad);
                      case "tax_otros":
                        return renderTaxCell(b, "otros", col.key, rowPad);
                      case "tax_noComp":
                        return renderTaxCell(b, "noComp", col.key, rowPad);
                      case "tax_transf":
                        return renderTaxCell(b, "transf", col.key, rowPad);
                      case "tax_cardBase":
                        return renderTaxCell(b, "cardIntBase", col.key, rowPad);
                      case "tax_cardIVA":
                        return renderTaxCell(b, "cardIntIVA", col.key, rowPad);
                      case "tax_commNoVAT":
                        return renderTaxCell(b, "commSinIVA", col.key, rowPad);
                      case "tax_commNet":
                        return renderTaxCell(b, "commNet", col.key, rowPad);
                      case "tax_commWithVAT":
                        return renderTaxCell(b, "commWithVAT", col.key, rowPad);
                      case "tax_total":
                        return renderTaxCell(b, "total", col.key, rowPad);
                    }
                  })}
                </tr>
              ))}

              {loading && sortedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleCols.length}
                    className="px-4 py-10 text-center"
                  >
                    <Spinner />
                  </td>
                </tr>
              )}

              {!loading && sortedRows.length === 0 && pageInit && (
                <tr>
                  <td
                    colSpan={visibleCols.length}
                    className="px-4 py-10 text-center opacity-70"
                  >
                    No hay resultados. Ajustá los filtros y probá de nuevo.
                  </td>
                </tr>
              )}
            </tbody>

            {/* Totales de lo visible por columna numérica */}
            {sortedRows.length > 0 && (
              <tfoot className="border-t border-white/20 bg-white/10 backdrop-blur dark:border-white/10">
                <tr>
                  {visibleCols.map((col, idx) => {
                    if (idx === 0) {
                      return (
                        <td
                          key={col.key}
                          className={`px-4 ${rowPad} text-left font-medium`}
                        >
                          Totales (cargado/visible)
                        </td>
                      );
                    }

                    if (!isNumericColumnKey(col.key)) {
                      return <td key={col.key} className={`px-4 ${rowPad}`} />;
                    }

                    const totals = totalsByColumn.get(col.key);
                    return (
                      <td
                        key={col.key}
                        className={`px-4 ${rowPad} text-center font-medium`}
                      >
                        {formatCurrencyTotals(totals || { ARS: 0, USD: 0 })}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>

          <div className="flex w-full items-center justify-between border-t border-white/30 bg-white/10 px-3 py-2 text-xs backdrop-blur dark:border-white/10 dark:bg-white/10">
            <div className="opacity-70">
              {sortedRows.length} filas (de {normalized.length} cargadas)
            </div>
            <button
              onClick={() => fetchPage(false)}
              disabled={loading || cursor === null}
              className={`${ICON_BTN} disabled:opacity-50`}
            >
              {cursor === null
                ? "No hay más"
                : loading
                  ? "Cargando..."
                  : "Cargar más"}
            </button>
          </div>
        </div>

        <DetailedBalancesPanel token={token || undefined} />

        {/* Modal de columnas */}
        <ColumnPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          items={ALL_COLUMNS.map((c) => ({
            key: c.key,
            label: c.label,
            locked: c.always,
          }))}
          visibleKeys={visible}
          onToggle={toggleCol}
          onAll={setAll}
          onNone={setNone}
          onReset={resetCols}
          onPreset={applyPreset}
        />

        <ToastContainer position="bottom-right" />
      </div>
    </ProtectedRoute>
  );
}

/* ================= Column Picker ================= */
function ColumnPickerModal({
  open,
  onClose,
  items,
  visibleKeys,
  onToggle,
  onAll,
  onNone,
  onReset,
  onPreset,
}: {
  open: boolean;
  onClose: () => void;
  items: { key: VisibleKey; label: string; locked?: boolean }[];
  visibleKeys: VisibleKey[];
  onToggle: (k: VisibleKey) => void;
  onAll: () => void;
  onNone: () => void;
  onReset: () => void;
  onPreset: (p: "basic" | "finance" | "debt") => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/10 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`${GLASS} absolute left-1/2 top-1/2 w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 p-5`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Columnas visibles</h3>
          <button onClick={onClose} className={ICON_BTN}>
            ✕
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs opacity-70">Presets:</span>
          <button onClick={() => onPreset("basic")} className={ICON_BTN}>
            Básico
          </button>
          <button onClick={() => onPreset("finance")} className={ICON_BTN}>
            Finanzas
          </button>
          <button onClick={() => onPreset("debt")} className={ICON_BTN}>
            Deuda
          </button>
        </div>

        <div className="grid max-h-72 grid-cols-1 gap-1 overflow-auto pr-1 sm:grid-cols-2">
          {items.map((it) => (
            <label
              key={it.key}
              className={`flex cursor-pointer items-center justify-between rounded-3xl px-2 py-1 text-sm ${it.locked ? "opacity-60" : "hover:bg-white/10 dark:hover:bg-zinc-800/50"}`}
            >
              <span>{it.label}</span>
              <input
                type="checkbox"
                checked={visibleKeys.includes(it.key)}
                onChange={() => !it.locked && onToggle(it.key)}
                disabled={it.locked}
              />
            </label>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button onClick={onAll} className={ICON_BTN}>
            Todas
          </button>
          <button onClick={onNone} className={ICON_BTN}>
            Ninguna
          </button>
          <button onClick={onReset} className={ICON_BTN}>
            Reset
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className={PRIMARY_BTN}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= UI atoms ================= */
function ChipKPI({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={CHIP}>
      <span className="opacity-70">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function StatusBadge({
  type,
  value,
}: {
  type: "client" | "op";
  value: string;
}) {
  const map: Record<string, string> = {
    pendiente: "bg-amber-500/20 text-amber-900 dark:text-amber-200",
    pago: "bg-emerald-500/20 text-emerald-900 dark:text-emerald-200",
    facturado: "bg-sky-500/20 text-sky-900 dark:text-sky-200",
  };
  const key = (value || "").toLowerCase();
  const cls = map[key] || "bg-zinc-500/20 text-zinc-800 dark:text-zinc-200";
  return (
    <span
      className={`${BADGE} ${cls}`}
      title={`${type === "client" ? "Pax" : "Operador"}: ${value}`}
    >
      {value || "—"}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs opacity-70">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`block w-full min-w-fit appearance-none rounded-2xl border border-sky-200 bg-white/50 px-4 py-2 shadow-sm shadow-sky-950/10 outline-none backdrop-blur placeholder:opacity-60 dark:border-sky-200/60 dark:bg-sky-100/10 ${props.className || ""}`}
    />
  );
}
