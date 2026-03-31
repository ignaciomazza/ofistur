// src/components/services/SummaryCard.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import type {
  Service,
  Receipt,
  OperatorDue,
  BillingAdjustmentConfig,
  BillingAdjustmentComputed,
  CommissionOverrides,
  CommissionRule,
} from "@/types";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import Spinner from "@/components/Spinner";
import { computeBillingAdjustments } from "@/utils/billingAdjustments";
import { getGrossIncomeTaxAmountFromBillingOverride } from "@/utils/billingOverride";
import { resolveCommissionForContext } from "@/utils/commissionOverrides";

/* ===== Tipos ===== */
interface Totals {
  sale_price: number;
  cost_price: number;
  tax_21: number;
  tax_105: number;
  exempt: number;
  other_taxes: number;
  taxableCardInterest: number;
  vatOnCardInterest: number;
  nonComputable: number;
  taxableBase21: number;
  taxableBase10_5: number;
  vatOnCommission21: number;
  vatOnCommission10_5: number;
  totalCommissionWithoutVAT: number;
  /** Fallback cuando no viene el desglose de intereses (sin IVA / IVA) */
  cardInterestRaw?: number;
  transferFeesAmount: number;
  extra_costs_amount: number;
  extra_taxes_amount: number;
}

interface SummaryCardProps {
  totalsByCurrency: Record<string, Totals>;
  fmtCurrency?: (value: number, currency: string) => string; // ahora opcional

  /** Datos crudos para calcular deuda y comisión */
  services: Service[];
  receipts: Receipt[];
  operatorDues?: OperatorDue[];
  operatorPaymentsReloadKey?: number;
  useBookingSaleTotal?: boolean;
  bookingSaleTotals?: Record<string, number | string> | null;
  ownerPctOverride?: number | null;
  role?: string;
  onSaveCommission?: (
    overrides: CommissionOverrides | null,
  ) => Promise<boolean>;
}

/** Campos adicionales que pueden venir en Service */
type ServiceWithCalcs = Service &
  Partial<{
    taxableCardInterest: number;
    vatOnCardInterest: number;
    card_interest: number;
    totalCommissionWithoutVAT: number;
    extra_costs_amount: number;
    extra_taxes_amount: number;
    extra_adjustments: BillingAdjustmentComputed[] | null;
    billing_override: unknown;
    currency: "ARS" | "USD" | string;
    sale_price: number;
    booking: {
      id_booking: number;
      creation_date: string | Date;
      user?: { id_user: number; first_name: string; last_name: string };
    };
  }>;

/** Extensión segura de Receipt con campos de conversión opcionales */
type ReceiptWithConversion = Receipt &
  Partial<{
    base_amount: number | string | null;
    base_currency: string | null;
    counter_amount: number | string | null;
    counter_currency: string | null;
    amount: number | string | null;
    amount_currency: string | null;
    payment_fee_amount: number | string | null;
    payment_fee_currency: string | null;
    payments: Array<{
      amount?: number | string | null;
      payment_currency?: string | null;
      fee_amount?: number | string | null;
    }>;
    service_allocations?: Array<{
      service_id?: number | string | null;
      amount_service?: number | string | null;
      service_currency?: string | null;
    }> | null;
  }>;

type AdjustmentLabelTotal = {
  label: string;
  amount: number;
};

type ServiceDebtBreakdownRow = {
  serviceId: number;
  currency: string;
  label: string;
  sale: number;
  paid: number;
  debt: number;
};

type PaxAllocationDiagnostic = {
  receiptId: number | null;
  receiptNumber: string;
  reasons: string[];
  rawServiceIds: number[];
  validServiceIds: number[];
  allocationServiceIds: number[];
  applicableAllocationServiceIds: number[];
  amountsByCurrency: Record<string, number>;
};

type OperatorDebtBreakdownRow = {
  serviceId: number | null;
  currency: string;
  label: string;
  amount: number;
};

type OperatorPaymentAllocationSummary = {
  booking_id: number | null;
  service_id: number;
  service_currency: string;
  amount_service: number;
};

type OperatorPaymentSummaryItem = {
  id_investment: number;
  amount: number;
  booking_amount: number | null;
  currency: string;
  base_amount: number | null;
  base_currency: string | null;
  counter_amount: number | null;
  counter_currency: string | null;
  operator_id: number | null;
  serviceIds: number[];
  allocations: OperatorPaymentAllocationSummary[];
};

/** Config API */
type CalcConfigResponse = {
  billing_breakdown_mode: "auto" | "manual";
  /** Proporción: 0.024 = 2.4% */
  transfer_fee_pct: number;
  billing_adjustments?: BillingAdjustmentConfig[];
  use_booking_sale_total?: boolean;
};

type EarningsByBookingResponse = {
  ownerPct: number;
  rule?: CommissionRule;
  custom?: CommissionOverrides | null;
  commissionBaseByCurrency: Record<string, number>;
  sellerEarningsByCurrency: Record<string, number>;
};

/* ---------- UI helpers ---------- */
const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  className?: string;
}> = ({ title, children, className }) => (
  <section
    className={`rounded-2xl border border-white/5 bg-white/5 p-3 shadow-sm shadow-sky-950/10 ${className || ""}`}
  >
    <h4 className="mb-2 text-sm font-semibold tracking-tight">{title}</h4>
    <dl className="divide-y divide-white/10">{children}</dl>
  </section>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="grid grid-cols-2 items-center gap-2 py-2">
    <dt className="text-sm opacity-80">{label}</dt>
    <dd className="text-right font-medium tabular-nums">{value}</dd>
  </div>
);

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-100 px-2.5 py-1 text-sm font-medium text-sky-900 dark:border-sky-800/40 dark:bg-sky-900/30 dark:text-sky-100">
    {children}
  </span>
);

const PencilSquareIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4 10.5-10.5Z" />
    <path d="M13.5 5.5 18.5 10.5" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    className={className}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
    />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.3a1 1 0 0 1-1.42.002l-3.25-3.25a1 1 0 1 1 1.414-1.414l2.54 2.54 6.54-6.592a1 1 0 0 1 1.42 0Z"
      clipRule="evenodd"
    />
  </svg>
);

/* ---------- helpers de datos ---------- */
const toNum = (v: number | string | null | undefined) => {
  const n =
    typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const toPositiveInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const parseServiceIdArray = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const item of raw) {
    const id = toPositiveInt(item);
    if (id != null) out.push(id);
  }
  return Array.from(new Set(out));
};

// Busca un bookingId válido recorriendo los services.
function pickBookingId(svcs: ServiceWithCalcs[]): number | undefined {
  for (const s of svcs) {
    const direct = Number(s.booking_id);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const bid = s.booking?.id_booking;
    if (Number.isFinite(bid as number) && (bid as number) > 0)
      return bid as number;
  }
  return undefined;
}

const upperKeys = (obj: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(obj || {}).map(([k, v]) => [String(k).toUpperCase(), v]),
  );

function normalizeStatusKey(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/* ---------- helpers de moneda ---------- */
function isValidCurrencyCode(code: string): boolean {
  const c = (code || "").trim().toUpperCase();
  if (!c) return false;
  try {
    new Intl.NumberFormat("es-AR", { style: "currency", currency: c }).format(
      1,
    );
    return true;
  } catch {
    return false;
  }
}

/** Normaliza cosas como U$D, US$, AR$, etc. y devuelve ISO 4217 si es posible. */
function normalizeCurrencyCode(raw: string): string {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return "ARS";
  const maps: Record<string, string> = {
    U$D: "USD",
    U$S: "USD",
    US$: "USD",
    USD$: "USD",
    AR$: "ARS",
    $: "ARS",
  };
  if (maps[s]) return maps[s];
  const m = s.match(/[A-Z]{3}/);
  const code = m ? m[0] : s;
  return isValidCurrencyCode(code) ? code : "ARS";
}

function formatCurrencySafe(value: number, currency: string): string {
  const cur = normalizeCurrencyCode(currency);
  const v = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: cur,
    }).format(v);
  } catch {
    return `${v.toFixed(2)} ${cur}`;
  }
}

const PAYMENT_TOLERANCE = 0.01;

const parseOptionalAmount = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseOptionalCurrency = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? normalizeCurrencyCode(trimmed) : null;
};

function parseOperatorPaymentSummaryItem(
  raw: unknown,
): OperatorPaymentSummaryItem | null {
  if (!isRecord(raw)) return null;
  const id = toPositiveInt(raw.id_investment ?? raw.id);
  if (id == null) return null;

  const amount = toNum(raw.amount as number | string | null | undefined);
  const bookingAmountRaw = raw.booking_amount;
  const bookingAmount =
    bookingAmountRaw == null ? null : toNum(bookingAmountRaw as number | string);
  const currency = normalizeCurrencyCode(String(raw.currency || "ARS"));
  const baseCurrency = parseOptionalCurrency(raw.base_currency);
  const counterCurrency = parseOptionalCurrency(raw.counter_currency);
  const baseAmountRaw = parseOptionalAmount(raw.base_amount);
  const counterAmountRaw = parseOptionalAmount(raw.counter_amount);
  const operatorId = toPositiveInt(raw.operator_id);
  const serviceIds = parseServiceIdArray(raw.serviceIds);

  const allocationsRaw = Array.isArray(raw.allocations) ? raw.allocations : [];
  const allocations: OperatorPaymentAllocationSummary[] = allocationsRaw
    .map((item) => {
      if (!isRecord(item)) return null;
      const serviceId = toPositiveInt(item.service_id);
      if (serviceId == null) return null;
      const bookingId = toPositiveInt(item.booking_id);
      const serviceCurrency = normalizeCurrencyCode(
        String(item.service_currency || currency),
      );
      const amountService = toNum(item.amount_service as number | string);
      return {
        booking_id: bookingId,
        service_id: serviceId,
        service_currency: serviceCurrency,
        amount_service: amountService,
      };
    })
    .filter(
      (item): item is OperatorPaymentAllocationSummary => item !== null,
    );

  return {
    id_investment: id,
    amount,
    booking_amount: bookingAmount,
    currency,
    base_amount: baseCurrency != null ? baseAmountRaw : null,
    base_currency: baseCurrency,
    counter_amount: counterCurrency != null ? counterAmountRaw : null,
    counter_currency: counterCurrency,
    operator_id: operatorId,
    serviceIds,
    allocations,
  };
}

function extractReceiptPaidByCurrency(raw: ReceiptWithConversion): Record<string, number> {
  const out: Record<string, number> = {};
  const amountCurrency = normalizeCurrencyCode(String(raw.amount_currency || "ARS"));
  const amountVal = toNum(raw.amount ?? 0);
  const feeVal = toNum(raw.payment_fee_amount ?? 0);
  const baseCurrency = raw.base_currency
    ? normalizeCurrencyCode(String(raw.base_currency))
    : null;
  const baseVal = toNum(raw.base_amount ?? 0);
  const lines = Array.isArray(raw.payments) ? raw.payments : [];

  const add = (cur: string, value: number) => {
    if (Math.abs(value) <= PAYMENT_TOLERANCE) return;
    out[cur] = (out[cur] || 0) + value;
  };

  const lineFeeTotal = lines.reduce(
    (sum, line) => sum + toNum(line?.fee_amount ?? 0),
    0,
  );
  const feeRemainder = feeVal - lineFeeTotal;

  if (baseCurrency && Math.abs(baseVal) > PAYMENT_TOLERANCE) {
    let feeInBase = 0;
    if (lines.length > 0) {
      lines.forEach((line) => {
        const lineCur = normalizeCurrencyCode(
          String(line?.payment_currency || amountCurrency),
        );
        if (lineCur !== baseCurrency) return;
        feeInBase += toNum(line?.fee_amount ?? 0);
      });
      if (
        Math.abs(feeRemainder) > PAYMENT_TOLERANCE &&
        amountCurrency === baseCurrency
      ) {
        feeInBase += feeRemainder;
      }
    } else if (amountCurrency === baseCurrency) {
      feeInBase = feeVal;
    }
    add(baseCurrency, baseVal + feeInBase);
    return out;
  }

  if (lines.length > 0) {
    lines.forEach((line) => {
      const lineCur = normalizeCurrencyCode(
        String(line?.payment_currency || amountCurrency),
      );
      const credited = toNum(line?.amount ?? 0) + toNum(line?.fee_amount ?? 0);
      add(lineCur, credited);
    });
    if (Math.abs(feeRemainder) > PAYMENT_TOLERANCE) {
      add(amountCurrency, feeRemainder);
    }
    return out;
  }

  add(amountCurrency, amountVal + feeVal);
  return out;
}

/* ------------------------------------------------------- */

export default function SummaryCard({
  totalsByCurrency,
  fmtCurrency,
  services,
  receipts,
  operatorDues = [],
  operatorPaymentsReloadKey,
  useBookingSaleTotal,
  bookingSaleTotals,
  ownerPctOverride = null,
  role,
  onSaveCommission,
}: SummaryCardProps) {
  const labels: Record<string, string> = {
    ARS: "Pesos",
    USD: "Dólares",
    UYU: "Pesos uruguayos",
  };
  const { token } = useAuth();

  /* ====== Config de cálculo y costos bancarios + earnings ====== */
  const [agencyMode, setAgencyMode] = useState<"auto" | "manual">("auto");
  const [transferPct, setTransferPct] = useState<number>(0.024); // fallback 2.4%
  const [billingAdjustments, setBillingAdjustments] = useState<
    BillingAdjustmentConfig[]
  >([]);
  const [useBookingSaleTotalCfg, setUseBookingSaleTotalCfg] =
    useState<boolean>(false);
  const [rule, setRule] = useState<CommissionRule | null>(null);
  const [commissionCustom, setCommissionCustom] =
    useState<CommissionOverrides | null>(null);
  const [apiCommissionBaseByCurrency, setApiCommissionBaseByCurrency] =
    useState<Record<string, number>>({});
  const [apiSellerEarningsByCurrency, setApiSellerEarningsByCurrency] =
    useState<Record<string, number>>({});
  const [loadingCalc, setLoadingCalc] = useState(false);
  const [loadingEarnings, setLoadingEarnings] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [commissionEditorOpen, setCommissionEditorOpen] = useState(false);
  const [commissionEditorAnchorCurrency, setCommissionEditorAnchorCurrency] =
    useState<string>("");
  const [commissionScope, setCommissionScope] = useState<
    "booking" | "currency" | "service"
  >("booking");
  const [commissionScopeCurrency, setCommissionScopeCurrency] =
    useState<string>("");
  const [commissionScopeServiceId, setCommissionScopeServiceId] = useState<
    number | null
  >(null);
  const [commissionDraftSeller, setCommissionDraftSeller] =
    useState<string>("");
  const [commissionDraftLeaders, setCommissionDraftLeaders] = useState<
    Record<number, string>
  >({});
  const [commissionSaving, setCommissionSaving] = useState(false);
  const [operatorPayments, setOperatorPayments] = useState<
    OperatorPaymentSummaryItem[]
  >([]);

  const bookingId = useMemo(
    () => pickBookingId(services as ServiceWithCalcs[]),
    [services],
  );

  // Pipeline SECUENCIAL: (1) service-calc-config -> (2) earnings/by-booking
  const pipelineRef = useRef<{ ac: AbortController; id: number } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pipelineRef.current) pipelineRef.current.ac.abort();
    };
  }, []);

  useEffect(() => {
    // Si no hay token, reseteamos y no mostramos cálculos (se verá loading)
    if (!token) {
      setAgencyMode("auto");
      setTransferPct(0.024);
      setRule(null);
      setCommissionCustom(null);
      setApiCommissionBaseByCurrency({});
      setApiSellerEarningsByCurrency({});
      setLoadingCalc(true);
      setLoadingEarnings(false);
      return;
    }

    // Cancelar pipeline previo
    if (pipelineRef.current) pipelineRef.current.ac.abort();

    const ac = new AbortController();
    const id = Date.now();
    pipelineRef.current = { ac, id };

    const isActive = () =>
      mountedRef.current &&
      pipelineRef.current?.id === id &&
      !pipelineRef.current.ac.signal.aborted;

    setLoadingCalc(true);
    setLoadingEarnings(Boolean(bookingId));
    setRule(null);
    setCommissionCustom(null);
    setApiCommissionBaseByCurrency({});
    setApiSellerEarningsByCurrency({});

    (async () => {
      // (1) Leer config de cálculo
      try {
        const r = await authFetch(
          "/api/service-calc-config",
          { cache: "no-store", signal: ac.signal },
          token,
        );
        if (!r.ok) throw new Error("fetch failed");
        const data: CalcConfigResponse = await r.json();
        if (isActive()) {
          setAgencyMode(
            data.billing_breakdown_mode === "manual" ? "manual" : "auto",
          );
          const pct = Number(data.transfer_fee_pct);
          setTransferPct(Number.isFinite(pct) ? pct : 0.024);
          setBillingAdjustments(
            Array.isArray(data.billing_adjustments)
              ? data.billing_adjustments
              : [],
          );
          setUseBookingSaleTotalCfg(Boolean(data.use_booking_sale_total));
        }
      } catch {
        if (isActive()) {
          setAgencyMode("auto");
          setTransferPct(0.024);
          setBillingAdjustments([]);
          setUseBookingSaleTotalCfg(false);
        }
      } finally {
        if (isActive()) {
          setLoadingCalc(false);
        }
      }

      // (2) Earnings por booking (si hay bookingId)
      if (!isActive()) return;
      if (!bookingId) {
        if (isActive()) {
          setLoadingEarnings(false);
        }
        return;
      }

      try {
        const r = await authFetch(
          `/api/earnings/by-booking?bookingId=${bookingId}`,
          { cache: "no-store", signal: ac.signal },
          token,
        );
        if (!r.ok) throw new Error("fetch failed");
        const json: EarningsByBookingResponse = await r.json();
        if (isActive()) {
          if (json.rule) {
            setRule(json.rule);
          } else {
            const fallbackPct = Number.isFinite(json.ownerPct)
              ? Number(json.ownerPct)
              : 100;
            setRule({ sellerPct: fallbackPct, leaders: [] });
          }
          setCommissionCustom(json.custom ?? null);
          setApiCommissionBaseByCurrency(
            upperKeys(json.commissionBaseByCurrency || {}),
          );
          setApiSellerEarningsByCurrency(
            upperKeys(json.sellerEarningsByCurrency || {}),
          );
        }
      } catch {
        if (isActive()) {
          setRule(null);
          setCommissionCustom(null);
        }
      } finally {
        if (isActive()) {
          setLoadingEarnings(false);
        }
      }
    })();

    return () => ac.abort();
  }, [token, bookingId, refreshKey]);

  useEffect(() => {
    if (!token || !bookingId) {
      setOperatorPayments([]);
      return;
    }

    const ac = new AbortController();
    let active = true;

    (async () => {
      try {
        const collected: OperatorPaymentSummaryItem[] = [];
        let cursor: number | null = null;

        for (let i = 0; i < 20; i += 1) {
          const qs = new URLSearchParams();
          qs.set("take", "100");
          qs.set("operatorOnly", "1");
          qs.set("bookingId", String(bookingId));
          qs.set("includeAllocations", "1");
          if (cursor) qs.set("cursor", String(cursor));

          const response = await authFetch(
            `/api/investments?${qs.toString()}`,
            { cache: "no-store", signal: ac.signal },
            token,
          );
          if (!response.ok) throw new Error("fetch failed");

          const json = (await response.json().catch(() => null)) as
            | { items?: unknown; nextCursor?: unknown }
            | null;
          const items = Array.isArray(json?.items) ? json.items : [];
          items.forEach((raw) => {
            const parsed = parseOperatorPaymentSummaryItem(raw);
            if (parsed) collected.push(parsed);
          });

          const nextCursor = toPositiveInt(json?.nextCursor);
          if (!nextCursor || items.length === 0) break;
          cursor = nextCursor;
        }

        if (active) setOperatorPayments(collected);
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        if (active) setOperatorPayments([]);
      }
    })();

    return () => {
      active = false;
      ac.abort();
    };
  }, [bookingId, operatorPaymentsReloadKey, token]);

  const bookingSaleMode =
    typeof useBookingSaleTotal === "boolean"
      ? useBookingSaleTotal
      : useBookingSaleTotalCfg;
  const manualMode = agencyMode === "manual" || bookingSaleMode;

  /** Normaliza totales por moneda (clave) para evitar códigos no-ISO. */
  const totalsNorm = useMemo(() => {
    const acc: Record<string, Totals> = {};
    for (const [k, v] of Object.entries(totalsByCurrency || {})) {
      const code = normalizeCurrencyCode(k);
      acc[code] = v;
    }
    return acc;
  }, [totalsByCurrency]);

  const bookingSaleTotalsNorm = useMemo(() => {
    if (!bookingSaleTotals || typeof bookingSaleTotals !== "object") {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(bookingSaleTotals)) {
      const code = normalizeCurrencyCode(k);
      const n =
        typeof v === "number"
          ? v
          : typeof v === "string"
            ? Number(v.replace(",", "."))
            : NaN;
      if (Number.isFinite(n) && n >= 0) out[code] = n;
    }
    return out;
  }, [bookingSaleTotals]);

  /** Venta base por moneda. */
  const saleTotalsByCurrency = useMemo(() => {
    if (bookingSaleMode && Object.keys(bookingSaleTotalsNorm).length > 0) {
      return bookingSaleTotalsNorm;
    }
    return services.reduce<Record<string, number>>((acc, raw) => {
      const s = raw as ServiceWithCalcs;
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const sale = toNum(s.sale_price);
      acc[cur] = (acc[cur] || 0) + sale;
      return acc;
    }, {});
  }, [bookingSaleMode, bookingSaleTotalsNorm, services]);

  /** Venta con interés por moneda (sale_price + interés). */
  const salesWithInterestByCurrency = useMemo(() => {
    if (bookingSaleMode) return saleTotalsByCurrency;
    return services.reduce<Record<string, number>>((acc, raw) => {
      const s = raw as ServiceWithCalcs;
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const sale = toNum(s.sale_price);
      const splitNoVAT = toNum(s.taxableCardInterest);
      const splitVAT = toNum(s.vatOnCardInterest);
      const split = splitNoVAT + splitVAT;
      const interest = split > 0 ? split : toNum(s.card_interest);
      acc[cur] = (acc[cur] || 0) + sale + interest;
      return acc;
    }, {});
  }, [bookingSaleMode, saleTotalsByCurrency, services]);
 
  /** Pagos por moneda (considerando también payment_fee_amount). */
  const paidByCurrency = useMemo(() => {
    return receipts.reduce<Record<string, number>>((acc, raw) => {
      const amounts = extractReceiptPaidByCurrency(raw as ReceiptWithConversion);
      Object.entries(amounts).forEach(([cur, value]) => {
        if (!value) return;
        acc[cur] = (acc[cur] || 0) + value;
      });
      return acc;
    }, {});
  }, [receipts]);

  const costTotalsByCurrency = useMemo(() => {
    return services.reduce<Record<string, number>>((acc, raw) => {
      const s = raw as ServiceWithCalcs;
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const cost = toNum(s.cost_price);
      acc[cur] = (acc[cur] || 0) + cost;
      return acc;
    }, {});
  }, [services]);

  const taxTotalsByCurrency = useMemo(() => {
    return services.reduce<Record<string, number>>((acc, raw) => {
      const s = raw as ServiceWithCalcs;
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const taxes = toNum(s.other_taxes);
      acc[cur] = (acc[cur] || 0) + taxes;
      return acc;
    }, {});
  }, [services]);

  const grossIncomeTaxByCurrency = useMemo(() => {
    return services.reduce<Record<string, number>>((acc, raw) => {
      const s = raw as ServiceWithCalcs;
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const amount = getGrossIncomeTaxAmountFromBillingOverride(
        s.billing_override,
      );
      if (amount <= 0) return acc;
      acc[cur] = (acc[cur] || 0) + amount;
      return acc;
    }, {});
  }, [services]);

  const serviceAdjustmentsByCurrency = useMemo(() => {
    const out: Record<string, BillingAdjustmentConfig[]> = {};
    services.forEach((raw) => {
      const s = raw as ServiceWithCalcs;
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const items = Array.isArray(s.extra_adjustments)
        ? s.extra_adjustments
        : [];
      if (!items.length) return;
      const normalized = items
        .filter((item) => item && item.source === "service" && item.active !== false)
        .map((item, idx) => ({
          id: item.id || `service-${s.id_service}-${idx}`,
          label: item.label || "Ajuste servicio",
          kind: item.kind,
          basis: item.basis,
          valueType: item.valueType,
          value: toNum(item.value),
          active: item.active !== false,
          source: "service" as const,
        }));
      if (!normalized.length) return;
      out[cur] = [...(out[cur] || []), ...normalized];
    });
    return out;
  }, [services]);

  const bookingAdjustmentsByCurrency = useMemo(() => {
    if (!bookingSaleMode) return {};
    const out: Record<
      string,
      { totalCosts: number; totalTaxes: number; total: number }
    > = {};
    for (const [cur, sale] of Object.entries(saleTotalsByCurrency)) {
      const cost = costTotalsByCurrency[cur] || 0;
      const combinedAdjustments = [
        ...billingAdjustments,
        ...(serviceAdjustmentsByCurrency[cur] || []),
      ];
      const totals = computeBillingAdjustments(combinedAdjustments, sale, cost);
      out[cur] = totals;
    }
    return out;
  }, [
    bookingSaleMode,
    billingAdjustments,
    saleTotalsByCurrency,
    costTotalsByCurrency,
    serviceAdjustmentsByCurrency,
  ]);

  const adjustmentsByCurrency = useMemo(() => {
    const out: Record<string, AdjustmentLabelTotal[]> = {};

    if (bookingSaleMode) {
      for (const [cur, sale] of Object.entries(saleTotalsByCurrency)) {
        const cost = costTotalsByCurrency[cur] || 0;
        const combinedAdjustments = [
          ...billingAdjustments,
          ...(serviceAdjustmentsByCurrency[cur] || []),
        ];
        const items = computeBillingAdjustments(
          combinedAdjustments,
          sale,
          cost,
        ).items;
        const totals = new Map<string, number>();
        items.forEach((item) => {
          const label = item.label || "Ajuste";
          totals.set(label, (totals.get(label) || 0) + toNum(item.amount));
        });
        out[cur] = Array.from(totals, ([label, amount]) => ({
          label,
          amount,
        }));
      }
      return out;
    }

    services.forEach((raw) => {
      const s = raw as ServiceWithCalcs;
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const items = Array.isArray(s.extra_adjustments)
        ? s.extra_adjustments
        : [];
      if (!items.length) return;

      const totals = new Map<string, number>(
        (out[cur] || []).map((it) => [it.label, it.amount]),
      );
      items.forEach((item) => {
        const label = item.label || "Ajuste";
        totals.set(label, (totals.get(label) || 0) + toNum(item.amount));
      });
      out[cur] = Array.from(totals, ([label, amount]) => ({
        label,
        amount,
      }));
    });

    return out;
  }, [
    billingAdjustments,
    bookingSaleMode,
    costTotalsByCurrency,
    saleTotalsByCurrency,
    serviceAdjustmentsByCurrency,
    services,
  ]);

  /** Unión de monedas presentes. */
  const currencies = useMemo(() => {
    const a = new Set<string>(Object.keys(totalsNorm));
    Object.keys(salesWithInterestByCurrency).forEach((c) => a.add(c));
    Object.keys(saleTotalsByCurrency).forEach((c) => a.add(c));
    Object.keys(paidByCurrency).forEach((c) => a.add(c));
    operatorDues.forEach((due) => {
      if (!String(normalizeStatusKey(due?.status)).startsWith("PEND")) return;
      const cur = normalizeCurrencyCode(String(due?.currency || "ARS"));
      a.add(cur);
    });
    return Array.from(a);
  }, [
    totalsNorm,
    salesWithInterestByCurrency,
    saleTotalsByCurrency,
    paidByCurrency,
    operatorDues,
  ]);

  const serviceOptions = useMemo(() => {
    return services.map((svc) => {
      const cur = normalizeCurrencyCode(svc.currency || "ARS");
      const label =
        (svc.description || svc.type || "Servicio").trim() ||
        `Servicio #${svc.id_service}`;
      return {
        id: svc.id_service,
        currency: cur,
        label: `${label} (${cur})`,
      };
    });
  }, [services]);

  const serviceById = useMemo(() => {
    return new Map(services.map((svc) => [svc.id_service, svc]));
  }, [services]);

  const {
    paxDebtBreakdownByCurrency,
    paxUnallocatedPaidByCurrency,
    paxAllocationDiagnostics,
  } = useMemo(
    () => {
      const rowsByCurrency: Record<string, ServiceDebtBreakdownRow[]> = {};
      const unallocatedByCurrency: Record<string, number> = {};
      const diagnostics: PaxAllocationDiagnostic[] = [];
      const svcList = services as ServiceWithCalcs[];

      const serviceIds = svcList
        .map((svc) => Number(svc.id_service))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (!serviceIds.length) {
        return {
          paxDebtBreakdownByCurrency: rowsByCurrency,
          paxUnallocatedPaidByCurrency: unallocatedByCurrency,
          paxAllocationDiagnostics: diagnostics,
        };
      }

      const serviceMap = new Map<number, ServiceWithCalcs>();
      const serviceCurrency = new Map<number, string>();
      const serviceLabel = new Map<number, string>();
      const servicesByCurrency = new Map<string, number[]>();
      const saleByService = new Map<number, number>();

      svcList.forEach((svc) => {
        const id = Number(svc.id_service);
        if (!Number.isFinite(id) || id <= 0) return;
        serviceMap.set(id, svc);

        const cur = normalizeCurrencyCode(svc.currency || "ARS");
        serviceCurrency.set(id, cur);
        const numberLabel = svc.agency_service_id ?? id;
        const desc = (svc.description || svc.type || "").trim();
        serviceLabel.set(
          id,
          desc ? `N° ${numberLabel} · ${desc}` : `N° ${numberLabel}`,
        );
        servicesByCurrency.set(cur, [...(servicesByCurrency.get(cur) || []), id]);
      });

      if (bookingSaleMode) {
        for (const [cur, totalSale] of Object.entries(saleTotalsByCurrency)) {
          const ids = servicesByCurrency.get(cur) || [];
          if (!ids.length) continue;
          const weights = ids.map((id) =>
            Math.max(0, toNum(serviceMap.get(id)?.sale_price)),
          );
          const weightSum = weights.reduce((sum, val) => sum + val, 0);
          ids.forEach((id, idx) => {
            const share =
              weightSum > 0
                ? (toNum(totalSale) * weights[idx]) / weightSum
                : toNum(totalSale) / ids.length;
            saleByService.set(id, share);
          });
        }
      } else {
        serviceMap.forEach((svc, id) => {
          const sale = toNum(svc.sale_price);
          const split =
            toNum(svc.taxableCardInterest) + toNum(svc.vatOnCardInterest);
          const interest = split > 0 ? split : toNum(svc.card_interest);
          saleByService.set(id, manualMode ? sale : sale + interest);
        });
      }

      const paidByService = new Map<number, number>();
      serviceIds.forEach((id) => paidByService.set(id, 0));

      receipts.forEach((rawReceipt) => {
        const receipt = rawReceipt as ReceiptWithConversion;
        const amounts = extractReceiptPaidByCurrency(receipt);
        const manualAllocations = Array.isArray(receipt.service_allocations)
          ? receipt.service_allocations
          : [];
        const rawSelectedServiceIds =
          Array.isArray(receipt.serviceIds) && receipt.serviceIds.length
            ? receipt.serviceIds
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0)
            : [];
        const validSelectedServiceIds = rawSelectedServiceIds.filter((id) =>
          paidByService.has(id),
        );
        const selectedServiceIds =
          validSelectedServiceIds.length > 0 ? validSelectedServiceIds : serviceIds;
        const receiptIdRaw = Number((receipt as { id_receipt?: unknown }).id_receipt);
        const receiptNumber = String(
          (receipt as { receipt_number?: unknown }).receipt_number || "",
        );

        if (
          rawSelectedServiceIds.length > 0 &&
          validSelectedServiceIds.length === 0
        ) {
          diagnostics.push({
            receiptId:
              Number.isFinite(receiptIdRaw) && receiptIdRaw > 0
                ? Math.trunc(receiptIdRaw)
                : null,
            receiptNumber,
            reasons: ["stale_service_scope_ids"],
            rawServiceIds: rawSelectedServiceIds,
            validServiceIds: validSelectedServiceIds,
            allocationServiceIds: [],
            applicableAllocationServiceIds: [],
            amountsByCurrency: amounts,
          });
        }

        const allocateBySelectedServices = () => {
          Object.entries(amounts).forEach(([cur, amount]) => {
            if (!amount) return;
            const targetIds = selectedServiceIds.filter(
              (id) => serviceCurrency.get(id) === cur,
            );
            if (!targetIds.length) {
              unallocatedByCurrency[cur] = (unallocatedByCurrency[cur] || 0) + amount;
              return;
            }

            const weights = targetIds.map((id) =>
              Math.max(0, saleByService.get(id) || 0),
            );
            const weightSum = weights.reduce((sum, val) => sum + val, 0);

            targetIds.forEach((id, idx) => {
              const allocated =
                weightSum > 0
                  ? (amount * weights[idx]) / weightSum
                  : amount / targetIds.length;
              paidByService.set(id, (paidByService.get(id) || 0) + allocated);
            });
          });
        };

        if (manualAllocations.length > 0) {
          const allocatedByCurrency: Record<string, number> = {};
          let hasApplicableAllocation = false;
          const allocationServiceIds = Array.from(
            new Set(
              manualAllocations
                .map((allocRaw) => Number(allocRaw?.service_id))
                .filter((id) => Number.isFinite(id) && id > 0)
                .map((id) => Math.trunc(id)),
            ),
          );
          const applicableAllocationServiceIds: number[] = [];
          for (const allocRaw of manualAllocations) {
            const serviceId = Number(allocRaw?.service_id);
            const amountService = toNum(allocRaw?.amount_service ?? 0);
            if (!Number.isFinite(serviceId) || serviceId <= 0) continue;
            if (Math.abs(amountService) <= PAYMENT_TOLERANCE) continue;
            if (!paidByService.has(serviceId)) continue;
            hasApplicableAllocation = true;
            applicableAllocationServiceIds.push(Math.trunc(serviceId));

            const serviceCur =
              serviceCurrency.get(serviceId) ||
              normalizeCurrencyCode(
                String(allocRaw?.service_currency || "ARS"),
              );
            paidByService.set(
              serviceId,
              (paidByService.get(serviceId) || 0) + amountService,
            );
            allocatedByCurrency[serviceCur] =
              (allocatedByCurrency[serviceCur] || 0) + amountService;
          }

          // Fallback defensivo para recibos legacy con allocations vacías/no aplicables.
          if (!hasApplicableAllocation) {
            diagnostics.push({
              receiptId:
                Number.isFinite(receiptIdRaw) && receiptIdRaw > 0
                  ? Math.trunc(receiptIdRaw)
                  : null,
              receiptNumber,
              reasons: ["allocation_rows_without_valid_service_or_amount"],
              rawServiceIds: rawSelectedServiceIds,
              validServiceIds: validSelectedServiceIds,
              allocationServiceIds,
              applicableAllocationServiceIds,
              amountsByCurrency: amounts,
            });
            allocateBySelectedServices();
            return;
          }

          Object.entries(amounts).forEach(([cur, amount]) => {
            const remainder = amount - (allocatedByCurrency[cur] || 0);
            if (Math.abs(remainder) <= PAYMENT_TOLERANCE) return;
            unallocatedByCurrency[cur] =
              (unallocatedByCurrency[cur] || 0) + remainder;
          });
          return;
        }

        allocateBySelectedServices();
      });

      serviceIds.forEach((id) => {
        const cur = serviceCurrency.get(id) || "ARS";
        const sale = saleByService.get(id) || 0;
        const paid = paidByService.get(id) || 0;
        const row: ServiceDebtBreakdownRow = {
          serviceId: id,
          currency: cur,
          label: serviceLabel.get(id) || `Servicio N° ${id}`,
          sale,
          paid,
          debt: sale - paid,
        };
        rowsByCurrency[cur] = [...(rowsByCurrency[cur] || []), row];
      });

      Object.values(rowsByCurrency).forEach((rows) => {
        rows.sort((a, b) => a.serviceId - b.serviceId);
      });

      return {
        paxDebtBreakdownByCurrency: rowsByCurrency,
        paxUnallocatedPaidByCurrency: unallocatedByCurrency,
        paxAllocationDiagnostics: diagnostics,
      };
    },
    [bookingSaleMode, manualMode, receipts, saleTotalsByCurrency, services],
  );

  useEffect(() => {
    if (!paxAllocationDiagnostics.length) return;
    if (typeof window === "undefined") return;

    let enabled = false;
    try {
      const params = new URLSearchParams(window.location.search);
      const queryEnabled = params.get("debugDebt") === "1";
      const storageEnabled = ["1", "true", "on"].includes(
        String(window.localStorage.getItem("ofistur:debugDebt") || "")
          .trim()
          .toLowerCase(),
      );
      enabled = queryEnabled || storageEnabled;
    } catch {
      enabled = false;
    }

    if (!enabled) return;

    console.warn("[debt-debug] Recibos con imputacion anomala", {
      bookingId,
      issues: paxAllocationDiagnostics,
    });
  }, [bookingId, paxAllocationDiagnostics]);

  const { operatorDebtBreakdownByCurrency, operatorDebtTotalsByCurrency } =
    useMemo(() => {
      const rowsByCurrency: Record<string, OperatorDebtBreakdownRow[]> = {};
      const totalsByCurrency: Record<string, number> = {};
      const baseByKey = new Map<string, OperatorDebtBreakdownRow>();
      const paidByKey = new Map<string, number>();

      const serviceMeta = new Map<
        number,
        {
          currency: string;
          label: string;
          operatorId: number | null;
          fallbackWeight: number;
        }
      >();
      (services as ServiceWithCalcs[]).forEach((svc) => {
        const serviceId = toPositiveInt(svc.id_service);
        if (serviceId == null) return;
        const currency = normalizeCurrencyCode(String(svc.currency || "ARS"));
        const numberLabel = svc.agency_service_id ?? serviceId;
        const desc = (svc.description || svc.type || "").trim();
        const label = desc ? `N° ${numberLabel} · ${desc}` : `N° ${numberLabel}`;
        serviceMeta.set(serviceId, {
          currency,
          label,
          operatorId: toPositiveInt(svc.id_operator),
          fallbackWeight: Math.max(0, toNum(svc.cost_price)),
        });
      });

      const keyFor = (currency: string, serviceId: number | null) =>
        `${normalizeCurrencyCode(currency)}:${serviceId ?? "none"}`;

      const parseKey = (key: string) => {
        const [currencyRaw, serviceRaw] = key.split(":");
        return {
          currency: normalizeCurrencyCode(currencyRaw || "ARS"),
          serviceId: toPositiveInt(serviceRaw),
        };
      };

      const addBase = (
        serviceId: number | null,
        currency: string,
        amount: number,
        label?: string,
      ) => {
        if (Math.abs(amount) <= PAYMENT_TOLERANCE) return;
        const key = keyFor(currency, serviceId);
        const existing = baseByKey.get(key);
        if (existing) {
          existing.amount += amount;
          return;
        }
        const fallbackLabel =
          serviceId == null
            ? "Sin servicio asociado"
            : serviceMeta.get(serviceId)?.label || `Servicio N° ${serviceId}`;
        baseByKey.set(key, {
          serviceId,
          currency: normalizeCurrencyCode(currency),
          label: label || fallbackLabel,
          amount,
        });
      };

      const addPaid = (
        serviceId: number | null,
        currency: string,
        amount: number,
      ) => {
        if (Math.abs(amount) <= PAYMENT_TOLERANCE) return;
        const key = keyFor(currency, serviceId);
        paidByKey.set(key, (paidByKey.get(key) || 0) + amount);
      };

      operatorDues.forEach((due) => {
        if (!String(normalizeStatusKey(due?.status)).startsWith("PEND")) return;
        const amount = toNum(due?.amount ?? 0);
        if (Math.abs(amount) <= PAYMENT_TOLERANCE) return;

        const serviceId = toPositiveInt(due?.service_id);
        const currency = normalizeCurrencyCode(String(due?.currency || "ARS"));
        addBase(serviceId, currency, amount);
      });

      if (operatorDues.length === 0) {
        serviceMeta.forEach((meta, serviceId) => {
          addBase(serviceId, meta.currency, meta.fallbackWeight, meta.label);
        });
      }

      if (baseByKey.size === 0) {
        return {
          operatorDebtBreakdownByCurrency: rowsByCurrency,
          operatorDebtTotalsByCurrency: totalsByCurrency,
        };
      }

      const allServiceIds = Array.from(serviceMeta.keys());
      operatorPayments.forEach((payment) => {
        let usedAllocations = false;
        payment.allocations.forEach((alloc) => {
          if (
            bookingId &&
            alloc.booking_id != null &&
            alloc.booking_id !== bookingId
          ) {
            return;
          }
          if (!serviceMeta.has(alloc.service_id)) return;
          if (Math.abs(alloc.amount_service) <= PAYMENT_TOLERANCE) return;
          addPaid(
            alloc.service_id,
            alloc.service_currency || payment.currency,
            alloc.amount_service,
          );
          usedAllocations = true;
        });
        if (usedAllocations) return;

        const scopedAmount =
          payment.booking_amount != null ? payment.booking_amount : payment.amount;
        if (Math.abs(scopedAmount) <= PAYMENT_TOLERANCE) return;

        const paymentCurrency = normalizeCurrencyCode(payment.currency || "ARS");
        let targetServiceIds = payment.serviceIds.filter((id) =>
          serviceMeta.has(id),
        );

        if (targetServiceIds.length === 0 && payment.operator_id != null) {
          targetServiceIds = allServiceIds.filter(
            (id) => serviceMeta.get(id)?.operatorId === payment.operator_id,
          );
        }
        if (targetServiceIds.length === 0) {
          targetServiceIds = allServiceIds.filter(
            (id) => serviceMeta.get(id)?.currency === paymentCurrency,
          );
        }
        if (targetServiceIds.length === 0) {
          addPaid(null, paymentCurrency, scopedAmount);
          return;
        }

        const fullAmount = payment.amount;
        const rawScopeRatio =
          payment.booking_amount != null && Math.abs(fullAmount) > PAYMENT_TOLERANCE
            ? scopedAmount / fullAmount
            : 1;
        const scopeRatio =
          Number.isFinite(rawScopeRatio) && rawScopeRatio > 0
            ? rawScopeRatio
            : 1;
        const scaleAmount = (value: number | null): number | null => {
          if (value == null) return null;
          const scaled = value * scopeRatio;
          return Number.isFinite(scaled) ? scaled : null;
        };

        const baseCurrency = payment.base_currency
          ? normalizeCurrencyCode(payment.base_currency)
          : null;
        const counterCurrency = payment.counter_currency
          ? normalizeCurrencyCode(payment.counter_currency)
          : null;
        const scopedBaseAmount = scaleAmount(payment.base_amount);
        const scopedCounterAmount = scaleAmount(payment.counter_amount);

        const amountForCurrency = (targetCurrency: string): number | null => {
          const normalized = normalizeCurrencyCode(targetCurrency);
          if (
            baseCurrency &&
            normalized === baseCurrency &&
            scopedBaseAmount != null &&
            Math.abs(scopedBaseAmount) > PAYMENT_TOLERANCE
          ) {
            return scopedBaseAmount;
          }
          if (
            counterCurrency &&
            normalized === counterCurrency &&
            scopedCounterAmount != null &&
            Math.abs(scopedCounterAmount) > PAYMENT_TOLERANCE
          ) {
            return scopedCounterAmount;
          }
          if (normalized === paymentCurrency) return scopedAmount;
          return null;
        };

        const candidateCurrencies = Array.from(
          new Set(
            [paymentCurrency, baseCurrency, counterCurrency].filter(
              (cur): cur is string => Boolean(cur),
            ),
          ),
        );

        let amountToAllocate = scopedAmount;
        for (const targetCurrency of candidateCurrencies) {
          const sameCurrencyTargets = targetServiceIds.filter(
            (id) => serviceMeta.get(id)?.currency === targetCurrency,
          );
          if (sameCurrencyTargets.length === 0) continue;
          const resolvedAmount = amountForCurrency(targetCurrency);
          if (resolvedAmount == null) continue;
          targetServiceIds = sameCurrencyTargets;
          amountToAllocate = resolvedAmount;
          break;
        }

        const weights = targetServiceIds.map((id) => {
          const meta = serviceMeta.get(id);
          if (!meta) return 0;
          const base = baseByKey.get(keyFor(meta.currency, id));
          return Math.max(0, base?.amount ?? meta.fallbackWeight);
        });
        const weightSum = weights.reduce((sum, value) => sum + value, 0);

        targetServiceIds.forEach((id, idx) => {
          const meta = serviceMeta.get(id);
          if (!meta) return;
          const allocated =
            weightSum > 0
              ? (amountToAllocate * weights[idx]) / weightSum
              : amountToAllocate / targetServiceIds.length;
          addPaid(id, meta.currency, allocated);
        });
      });

      const allKeys = new Set<string>([
        ...Array.from(baseByKey.keys()),
        ...Array.from(paidByKey.keys()),
      ]);

      allKeys.forEach((key) => {
        const base = baseByKey.get(key);
        const paid = paidByKey.get(key) || 0;
        const parsed = parseKey(key);
        const serviceId = base?.serviceId ?? parsed.serviceId ?? null;
        const currency = base?.currency || parsed.currency;
        const label =
          base?.label ||
          (serviceId == null
            ? "Sin servicio asociado"
            : serviceMeta.get(serviceId)?.label || `Servicio N° ${serviceId}`);
        const amount = (base?.amount || 0) - paid;

        const row: OperatorDebtBreakdownRow = {
          serviceId,
          currency,
          label,
          amount,
        };
        rowsByCurrency[currency] = [...(rowsByCurrency[currency] || []), row];
        totalsByCurrency[currency] =
          (totalsByCurrency[currency] || 0) + amount;
      });

      Object.values(rowsByCurrency).forEach((rows) => {
        rows.sort((a, b) => {
          if (a.serviceId == null && b.serviceId != null) return 1;
          if (a.serviceId != null && b.serviceId == null) return -1;
          if (a.serviceId == null && b.serviceId == null) return 0;
          return (a.serviceId || 0) - (b.serviceId || 0);
        });
      });

      return {
        operatorDebtBreakdownByCurrency: rowsByCurrency,
        operatorDebtTotalsByCurrency: totalsByCurrency,
      };
    }, [bookingId, operatorDues, operatorPayments, services]);

  const debtSummaryByCurrency = useMemo(() => {
    const out: Record<
      string,
      { saleForDebt: number; paid: number; debt: number }
    > = {};

    currencies.forEach((currency) => {
      const code = normalizeCurrencyCode(currency);
      const saleBase = bookingSaleMode
        ? saleTotalsByCurrency[code] || 0
        : totalsNorm[code]?.sale_price || 0;
      const saleWithInterest = salesWithInterestByCurrency[code] || 0;
      const paid = paidByCurrency[code] || 0;
      const saleForDebt = manualMode ? saleBase : saleWithInterest;
      out[code] = {
        saleForDebt,
        paid,
        debt: saleForDebt - paid,
      };
    });

    return out;
  }, [
    bookingSaleMode,
    currencies,
    manualMode,
    paidByCurrency,
    saleTotalsByCurrency,
    salesWithInterestByCurrency,
    totalsNorm,
  ]);

  useEffect(() => {
    if (currencies.length === 0) return;
    if (
      !commissionScopeCurrency ||
      !currencies.includes(commissionScopeCurrency)
    ) {
      setCommissionScopeCurrency(currencies[0]);
    }
  }, [commissionScopeCurrency, currencies]);

  useEffect(() => {
    if (!commissionEditorOpen) return;
    const normalized = normalizeCurrencyCode(
      commissionEditorAnchorCurrency || commissionScopeCurrency || "",
    );
    if (!normalized || !currencies.includes(normalized)) {
      if (currencies[0]) setCommissionEditorAnchorCurrency(currencies[0]);
    }
  }, [
    commissionEditorOpen,
    commissionEditorAnchorCurrency,
    commissionScopeCurrency,
    currencies,
  ]);

  useEffect(() => {
    if (serviceOptions.length === 0) return;
    const exists = serviceOptions.some(
      (opt) => opt.id === commissionScopeServiceId,
    );
    if (!exists) setCommissionScopeServiceId(serviceOptions[0].id);
  }, [commissionScopeServiceId, serviceOptions]);

  /** ====== cálculo local de comisión base por moneda (fallback) ====== */
  const localCommissionBaseByCurrency = useMemo(() => {
    if (bookingSaleMode) {
      const out: Record<string, number> = {};
      for (const [cur, sale] of Object.entries(saleTotalsByCurrency)) {
        const cost = costTotalsByCurrency[cur] || 0;
        const taxes = taxTotalsByCurrency[cur] || 0;
        const commissionBeforeFee = sale - cost - taxes;
        const fee = sale * (Number.isFinite(transferPct) ? transferPct : 0.024);
        const adjustments = bookingAdjustmentsByCurrency[cur]?.total || 0;
        const iibb = grossIncomeTaxByCurrency[cur] || 0;
        out[cur] = Math.max(commissionBeforeFee - fee - adjustments - iibb, 0);
      }
      return out;
    }

    return services.reduce<Record<string, number>>((acc, raw) => {
      const s = raw as ServiceWithCalcs;
      const cur = normalizeCurrencyCode(s.currency || "ARS");
      const sale = toNum(s.sale_price);
      const dbCommission = toNum(s.totalCommissionWithoutVAT);
      const fee = sale * (Number.isFinite(transferPct) ? transferPct : 0.024);
      const extraCosts = toNum((s as ServiceWithCalcs).extra_costs_amount);
      const extraTaxes = toNum((s as ServiceWithCalcs).extra_taxes_amount);
      const adjustments = extraCosts + extraTaxes;
      const base = Math.max(dbCommission - fee - adjustments, 0);
      acc[cur] = (acc[cur] || 0) + base;
      return acc;
    }, {});
  }, [
    bookingAdjustmentsByCurrency,
    bookingSaleMode,
    costTotalsByCurrency,
    grossIncomeTaxByCurrency,
    saleTotalsByCurrency,
    services,
    taxTotalsByCurrency,
    transferPct,
  ]);

  /** ====== Derivados para UI ====== */
  const commissionBaseFor = (cur: string) =>
    apiCommissionBaseByCurrency[cur] ?? localCommissionBaseByCurrency[cur] ?? 0;

  const baseRule = useMemo<CommissionRule>(
    () => rule ?? { sellerPct: 100, leaders: [] },
    [rule],
  );
  const forcedSellerPct = Number.isFinite(ownerPctOverride as number)
    ? Math.min(Math.max(Number(ownerPctOverride), 0), 100)
    : null;
  const commissionLoading = forcedSellerPct == null && loadingEarnings;
  const commissionReady = forcedSellerPct != null || !!rule;

  const sellerEarningFor = (cur: string) => {
    if (apiSellerEarningsByCurrency[cur] != null)
      return apiSellerEarningsByCurrency[cur];
    const base = commissionBaseFor(cur);
    const pct = forcedSellerPct ?? baseRule.sellerPct;
    return base * (pct / 100);
  };

  const fmtPct = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);

  const resolveSellerPctForService = (svc: ServiceWithCalcs) => {
    if (forcedSellerPct != null) return forcedSellerPct;
    const cur = normalizeCurrencyCode(svc.currency || "ARS");
    const { sellerPct } = resolveCommissionForContext({
      rule: baseRule,
      overrides: commissionCustom,
      currency: cur,
      serviceId: svc.id_service,
      allowService: !bookingSaleMode,
    });
    return sellerPct;
  };

  const sellerPctLabelForCurrency = (code: string) => {
    if (forcedSellerPct != null) return `${fmtPct(forcedSellerPct)}%`;
    if (!commissionReady) return "--";

    if (bookingSaleMode) {
      const { sellerPct } = resolveCommissionForContext({
        rule: baseRule,
        overrides: commissionCustom,
        currency: code,
        allowService: false,
      });
      return `${fmtPct(sellerPct)}%`;
    }

    const relevant = services.filter(
      (svc) => normalizeCurrencyCode(svc.currency || "ARS") === code,
    );
    if (relevant.length === 0) return `${fmtPct(baseRule.sellerPct)}%`;

    const pcts = relevant.map((svc) =>
      resolveSellerPctForService(svc as ServiceWithCalcs),
    );
    const first = pcts[0];
    const same = pcts.every((p) => Math.abs(p - first) < 0.0001);
    return same ? `${fmtPct(first)}%` : "Personalizada";
  };

  const canEditCommission = [
    "gerente",
    "administrativo",
    "desarrollador",
  ].includes(String(role || "").toLowerCase());

  const openEditorForCurrency = (code: string) => {
    if (!canEditCommission) return;
    setCommissionEditorAnchorCurrency(code);
    setCommissionScope("currency");
    setCommissionScopeCurrency(code);
    setCommissionEditorOpen(true);
  };

  useEffect(() => {
    if (!canEditCommission && commissionEditorOpen) {
      setCommissionEditorOpen(false);
    }
  }, [canEditCommission, commissionEditorOpen]);

  useEffect(() => {
    if (!commissionEditorOpen) return;
    if (bookingSaleMode && commissionScope === "service") {
      setCommissionScope("currency");
    }
  }, [bookingSaleMode, commissionScope, commissionEditorOpen]);

  useEffect(() => {
    if (!commissionEditorOpen) return;
    if (commissionScope === "currency" && commissionScopeCurrency) {
      setCommissionEditorAnchorCurrency(commissionScopeCurrency);
    }
  }, [commissionEditorOpen, commissionScope, commissionScopeCurrency]);

  const currentService = useMemo(() => {
    if (commissionScopeServiceId == null) return null;
    return (
      services.find((s) => s.id_service === commissionScopeServiceId) || null
    );
  }, [commissionScopeServiceId, services]);

  const currentScopeOverride = useMemo(() => {
    if (!commissionCustom) return null;
    if (commissionScope === "booking") return commissionCustom.booking ?? null;
    if (commissionScope === "currency")
      return commissionCustom.currency?.[commissionScopeCurrency] ?? null;
    if (commissionScope === "service") {
      if (commissionScopeServiceId == null) return null;
      return (
        commissionCustom.service?.[String(commissionScopeServiceId)] ?? null
      );
    }
    return null;
  }, [
    commissionCustom,
    commissionScope,
    commissionScopeCurrency,
    commissionScopeServiceId,
  ]);

  useEffect(() => {
    if (!commissionEditorOpen || !commissionReady) return;

    const leaders = baseRule.leaders ?? [];
    const leaderDefaults: Record<number, number> = {};
    leaders.forEach((l) => {
      leaderDefaults[l.userId] = l.pct;
    });

    let sellerPct = baseRule.sellerPct;
    let leaderPcts = leaderDefaults;

    if (currentScopeOverride) {
      if (typeof currentScopeOverride.sellerPct === "number") {
        sellerPct = currentScopeOverride.sellerPct;
      }
      if (currentScopeOverride.leaders) {
        leaderPcts = {
          ...leaderDefaults,
          ...Object.fromEntries(
            Object.entries(currentScopeOverride.leaders).map(([id, pct]) => [
              Number(id),
              pct,
            ]),
          ),
        };
      }
    } else if (commissionScope === "currency") {
      const { sellerPct: resolvedSeller, leaderPcts: resolvedLeaders } =
        resolveCommissionForContext({
          rule: baseRule,
          overrides: commissionCustom,
          currency: commissionScopeCurrency,
          allowService: false,
        });
      sellerPct = resolvedSeller;
      leaderPcts = resolvedLeaders;
    } else if (commissionScope === "service") {
      const cur = normalizeCurrencyCode(currentService?.currency || "ARS");
      const { sellerPct: resolvedSeller, leaderPcts: resolvedLeaders } =
        resolveCommissionForContext({
          rule: baseRule,
          overrides: commissionCustom,
          currency: cur,
          allowService: false,
        });
      sellerPct = resolvedSeller;
      leaderPcts = resolvedLeaders;
    }

    setCommissionDraftSeller(String(sellerPct));
    const nextLeaders: Record<number, string> = {};
    leaders.forEach((l) => {
      nextLeaders[l.userId] = String(leaderPcts[l.userId] ?? 0);
    });
    setCommissionDraftLeaders(nextLeaders);
  }, [
    commissionEditorOpen,
    commissionReady,
    baseRule,
    commissionCustom,
    commissionScope,
    commissionScopeCurrency,
    commissionScopeServiceId,
    currentScopeOverride,
    currentService,
  ]);

  const leaderList = baseRule.leaders ?? [];

  const parseDraftPct = (value: string) => {
    const raw = Number(String(value).replace(",", "."));
    if (!Number.isFinite(raw)) return null;
    if (raw < 0 || raw > 100) return null;
    return raw;
  };

  const sellerPctValue = parseDraftPct(commissionDraftSeller);
  const leaderPctValues = leaderList.map((l) => ({
    id: l.userId,
    value: parseDraftPct(commissionDraftLeaders[l.userId] ?? ""),
  }));
  const invalidPct =
    sellerPctValue == null || leaderPctValues.some((l) => l.value == null);
  const leadersSum = leaderPctValues.reduce(
    (sum, l) => sum + (l.value ?? 0),
    0,
  );
  const totalAssigned = (sellerPctValue ?? 0) + leadersSum;
  const overLimit = totalAssigned > 100.0001;
  const remainder = Math.max(0, 100 - totalAssigned);

  const canSaveCommission =
    commissionReady &&
    !commissionSaving &&
    !invalidPct &&
    !overLimit &&
    typeof onSaveCommission === "function";
  const hasScopeCustom = !!currentScopeOverride;

  const buildScopePayload = () => {
    const leaders: Record<string, number> = {};
    leaderPctValues.forEach((l) => {
      if (typeof l.value === "number") leaders[String(l.id)] = l.value;
    });
    return {
      sellerPct: sellerPctValue ?? 0,
      leaders,
    };
  };

  const cloneOverrides = (): CommissionOverrides => {
    return commissionCustom
      ? (JSON.parse(JSON.stringify(commissionCustom)) as CommissionOverrides)
      : {};
  };

  const removeEmptyBranches = (
    data: CommissionOverrides,
  ): CommissionOverrides | null => {
    const next = { ...data };
    if (next.currency && Object.keys(next.currency).length === 0) {
      delete next.currency;
    }
    if (next.service && Object.keys(next.service).length === 0) {
      delete next.service;
    }
    if (!next.booking && !next.currency && !next.service) return null;
    return next;
  };

  const saveCommissionScope = async () => {
    if (!canSaveCommission) return;
    if (commissionScope === "currency" && !commissionScopeCurrency) {
      toast.error("Seleccioná una moneda");
      return;
    }
    if (commissionScope === "service" && !commissionScopeServiceId) {
      toast.error("Seleccioná un servicio");
      return;
    }
    setCommissionSaving(true);
    try {
      const next = cloneOverrides();
      const payload = buildScopePayload();

      if (commissionScope === "booking") {
        next.booking = payload;
      } else if (commissionScope === "currency") {
        const key = String(commissionScopeCurrency || "").toUpperCase();
        next.currency = { ...(next.currency || {}), [key]: payload };
      } else if (commissionScope === "service") {
        const key = String(commissionScopeServiceId || "");
        next.service = { ...(next.service || {}), [key]: payload };
      }

      const cleaned = removeEmptyBranches(next);
      const ok = await onSaveCommission?.(cleaned);
      if (ok) {
        setCommissionCustom(cleaned);
        setRefreshKey((prev) => prev + 1);
        toast.success("Comisión guardada");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar comisión";
      toast.error(msg);
    } finally {
      setCommissionSaving(false);
    }
  };

  const removeCommissionScope = async () => {
    if (!onSaveCommission || commissionSaving) return;
    if (commissionScope === "currency" && !commissionScopeCurrency) return;
    if (commissionScope === "service" && !commissionScopeServiceId) return;
    setCommissionSaving(true);
    try {
      const next = cloneOverrides();
      if (commissionScope === "booking") {
        delete next.booking;
      } else if (commissionScope === "currency") {
        const key = String(commissionScopeCurrency || "").toUpperCase();
        if (next.currency) delete next.currency[key];
      } else if (commissionScope === "service") {
        const key = String(commissionScopeServiceId || "");
        if (next.service) delete next.service[key];
      }

      const cleaned = removeEmptyBranches(next);
      const ok = await onSaveCommission(cleaned);
      if (ok) {
        setCommissionCustom(cleaned);
        setRefreshKey((prev) => prev + 1);
        toast.success("Comisión personalizada eliminada");
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Error al quitar comisión personalizada";
      toast.error(msg);
    } finally {
      setCommissionSaving(false);
    }
  };

  const colsClass =
    currencies.length === 1 ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2";
  const showEditor = canEditCommission && commissionEditorOpen;
  const editorAnchor = useMemo(
    () =>
      normalizeCurrencyCode(
        commissionEditorAnchorCurrency || commissionScopeCurrency || "",
      ),
    [commissionEditorAnchorCurrency, commissionScopeCurrency],
  );

  // Formateador efectivo (usa prop si existe; si no, el interno seguro)
  const fmt = (value: number, currency: string) =>
    fmtCurrency
      ? fmtCurrency(value, normalizeCurrencyCode(currency))
      : formatCurrencySafe(value, currency);

  // ⛔ Mientras esté cargando la config / earnings, no mostramos el resumen
  if (loadingCalc || !token) {
    return (
      <div className="mb-6 flex justify-center">
        <div className="flex w-full items-center justify-center gap-3 rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
          <div>
            <Spinner />
          </div>
          <span>Calculando impuestos, costos bancarios y ganancias…</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mb-6 space-y-3 rounded-3xl transition-all duration-300 ${
        currencies.length > 1 ? "border border-white/10 bg-white/10 p-6" : ""
      } text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white`}
    >
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setRefreshKey((prev) => prev + 1)}
          disabled={loadingCalc}
          className="rounded-full border border-white/10 bg-white/20 px-3 py-1 text-xs font-medium shadow-sm shadow-sky-950/10 transition active:scale-95 disabled:opacity-50 dark:bg-white/10"
          aria-label="Actualizar resumen"
        >
          Actualizar
        </button>
      </div>

      <div className={`grid ${colsClass} gap-6`}>
        {currencies.map((currency) => {
          const code = normalizeCurrencyCode(currency);
          const t: Totals & { cardInterestRaw?: number } = totalsNorm[code] || {
            sale_price: 0,
            cost_price: 0,
            tax_21: 0,
            tax_105: 0,
            exempt: 0,
            other_taxes: 0,
            taxableCardInterest: 0,
            vatOnCardInterest: 0,
            nonComputable: 0,
            taxableBase21: 0,
            taxableBase10_5: 0,
            vatOnCommission21: 0,
            vatOnCommission10_5: 0,
            totalCommissionWithoutVAT: 0,
            transferFeesAmount: 0,
            cardInterestRaw: 0,
            extra_costs_amount: 0,
            extra_taxes_amount: 0,
          };

          // Intereses de tarjeta (presentación)
          const cardSplit =
            (t.taxableCardInterest ?? 0) + (t.vatOnCardInterest ?? 0);
          const cardTotal =
            cardSplit > 0 ? cardSplit : (t.cardInterestRaw ?? 0);

          const saleValue = bookingSaleMode
            ? saleTotalsByCurrency[code] || 0
            : t.sale_price;
          const costValue = t.cost_price;
          const venta = fmt(saleValue, code);
          const costo = fmt(costValue, code);
          const margen = fmt(saleValue - costValue, code);
          const feeValue = bookingSaleMode
            ? saleValue * (Number.isFinite(transferPct) ? transferPct : 0.024)
            : t.transferFeesAmount;
          const feeTransfer = fmt(feeValue, code);
          const extraCosts = bookingSaleMode
            ? bookingAdjustmentsByCurrency[code]?.totalCosts || 0
            : t.extra_costs_amount || 0;
          const iibbValue = grossIncomeTaxByCurrency[code] || 0;
          const extraTaxes = bookingSaleMode
            ? bookingAdjustmentsByCurrency[code]?.totalTaxes || 0
            : t.extra_taxes_amount || 0;
          const extraTaxesWithIibb = extraTaxes + iibbValue;
          const extraAdjustmentsTotal = extraCosts + extraTaxesWithIibb;
          const showAdjustments = Math.abs(extraAdjustmentsTotal) > 0.000001;
          const adjustmentsForCurrency = adjustmentsByCurrency[code] || [];

          // Chip de "Impuestos": en AUTO = IVA calculado; en MANUAL = other_taxes
          const chipImpuestos = manualMode
            ? fmt(t.other_taxes || 0, code)
            : fmt(
                t.sale_price - t.cost_price - t.totalCommissionWithoutVAT,
                code,
              );

          // Comisión base + ganancia del vendedor (preferimos API, sino fallback)
          const netCommission = commissionBaseFor(code);
          const myEarning = sellerEarningFor(code);

          return (
            <section
              key={code}
              className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10"
            >
              {/* Header */}
              <header className="mb-4 flex flex-col gap-2 px-2">
                <h3 className="text-xl font-semibold">
                  {labels[code] || code}
                </h3>
                <div className="flex w-full flex-wrap items-center justify-end gap-2 pl-20">
                  <Chip>Venta: {venta}</Chip>
                  <Chip>Costo: {costo}</Chip>
                  <Chip>Ganancia: {margen}</Chip>
                  <Chip>
                    {manualMode ? "Impuestos" : "Impuestos (IVA)"}:{" "}
                    {chipImpuestos}
                  </Chip>
                  <Chip>Costo transf.: {feeTransfer}</Chip>
                  {iibbValue > 0 && <Chip>IIBB: {fmt(iibbValue, code)}</Chip>}
                  {adjustmentsForCurrency.length > 0
                    ? adjustmentsForCurrency.map((adj) => (
                        <Chip key={`${code}-${adj.label}`}>
                          {adj.label}: {fmt(adj.amount, code)}
                        </Chip>
                      ))
                    : showAdjustments && (
                        <Chip>
                          Ajustes extra: {fmt(extraAdjustmentsTotal, code)}
                        </Chip>
                      )}
                </div>
              </header>

              {/* Body */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Impuestos */}
                <Section title="Impuestos">
                  {manualMode ? (
                    <Row
                      label="Impuestos"
                      value={fmt(t.other_taxes || 0, code)}
                    />
                  ) : (
                    <>
                      <Row label="IVA 21%" value={fmt(t.tax_21, code)} />
                      <Row label="IVA 10,5%" value={fmt(t.tax_105, code)} />
                      <Row label="Exento" value={fmt(t.exempt, code)} />
                      <Row label="Otros" value={fmt(t.other_taxes, code)} />
                    </>
                  )}
                </Section>

                {/* Base imponible (solo AUTO) */}
                {!manualMode && (
                  <Section title="Base imponible">
                    <Row
                      label="No computable"
                      value={fmt(t.nonComputable, code)}
                    />
                    <Row
                      label="Gravado 21%"
                      value={fmt(t.taxableBase21, code)}
                    />
                    <Row
                      label="Gravado 10,5%"
                      value={fmt(t.taxableBase10_5, code)}
                    />
                  </Section>
                )}

                {/* Tarjeta (solo AUTO y si hay valores) */}
                {!manualMode && cardTotal > 0 && (
                  <Section title="Tarjeta">
                    <Row
                      label="Intereses (total)"
                      value={fmt(cardTotal, code)}
                    />
                    <Row
                      label="Intereses sin IVA"
                      value={fmt(t.taxableCardInterest || 0, code)}
                    />
                    <Row
                      label="IVA intereses"
                      value={fmt(t.vatOnCardInterest || 0, code)}
                    />
                  </Section>
                )}

                {showAdjustments && (
                  <Section title="Ajustes extra">
                    <Row
                      label="Costos adicionales"
                      value={fmt(extraCosts, code)}
                    />
                    <Row
                      label="Impuestos adicionales"
                      value={fmt(extraTaxesWithIibb, code)}
                    />
                  </Section>
                )}

                {/* IVA comisiones (solo AUTO) */}
                {!manualMode && (
                  <Section title="IVA sobre comisiones" className="lg:col-span-2">
                    <Row
                      label="IVA 21%"
                      value={fmt(t.vatOnCommission21, code)}
                    />
                    <Row
                      label="IVA 10,5%"
                      value={fmt(t.vatOnCommission10_5, code)}
                    />
                  </Section>
                )}

              </div>

              {/* Footer */}
              <footer className="mt-4">
                <div className="rounded-2xl border border-white/5 bg-white/10">
                  <div className="flex flex-wrap justify-between gap-3 p-3">
                    <div>
                      <p className="text-sm opacity-70">
                        Total Comisión neta (Costos Bancarios, ajustes e IIBB)
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {fmt(netCommission, code)}
                      </p>
                    </div>
                    <div>
                      {commissionReady ? (
                        <>
                          <div className="flex items-center justify-end gap-2 text-sm opacity-70">
                            <span>
                              Ganancia del vendedor (
                              {sellerPctLabelForCurrency(code)})
                            </span>
                            {canEditCommission && (
                              <button
                                type="button"
                                onClick={() => openEditorForCurrency(code)}
                                className="rounded-full border border-white/10 bg-white/20 p-1.5 text-sky-900 shadow-sm shadow-sky-950/10 transition hover:scale-105 dark:text-white"
                                aria-label="Editar comisión"
                                title="Editar comisión"
                              >
                                <PencilSquareIcon className="size-4" />
                              </button>
                            )}
                          </div>
                          <p className="text-end text-lg font-semibold tabular-nums">
                            {fmt(myEarning, code)}
                          </p>
                        </>
                      ) : commissionLoading ? (
                        <div className="flex items-center justify-end gap-2 text-sm opacity-70">
                          <Spinner />
                          <span>Cargando comisión…</span>
                        </div>
                      ) : (
                        <div className="text-sm opacity-70">
                          Comisión no disponible
                        </div>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const isEditorHere = showEditor && editorAnchor === code;
                    return (
                      <div
                        className={`overflow-hidden transition-all duration-300 ${
                          isEditorHere
                            ? "max-h-[1400px] opacity-100"
                            : "max-h-0 opacity-0"
                        }`}
                        aria-hidden={!isEditorHere}
                      >
                        <div className="border-t border-sky-200/40 p-4 dark:border-sky-800/40">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">
                                Comisión personalizada
                              </p>
                              <p className="text-xs opacity-70">
                                Ajustá el porcentaje del vendedor y líderes
                                según el alcance.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCommissionEditorOpen(false)}
                              className="rounded-full border border-sky-200/40 bg-white/40 px-3 py-1 text-xs font-medium shadow-sm shadow-sky-950/10 transition active:scale-95 dark:border-sky-400/20 dark:bg-white/10"
                            >
                              Cerrar
                            </button>
                          </div>

                          <div className="mt-4 space-y-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setCommissionScope("booking")}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  commissionScope === "booking"
                                    ? "border-sky-400/60 bg-sky-200/70 text-sky-900"
                                    : "border-sky-200/40 bg-white/40 text-sky-900/70 dark:border-sky-400/20 dark:bg-white/10 dark:text-white/70"
                                }`}
                              >
                                Toda la reserva
                              </button>
                              <button
                                type="button"
                                onClick={() => setCommissionScope("currency")}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  commissionScope === "currency"
                                    ? "border-sky-400/60 bg-sky-200/70 text-sky-900"
                                    : "border-sky-200/40 bg-white/40 text-sky-900/70 dark:border-sky-400/20 dark:bg-white/10 dark:text-white/70"
                                }`}
                              >
                                Esta moneda
                              </button>
                              <button
                                type="button"
                                onClick={() => setCommissionScope("service")}
                                disabled={bookingSaleMode}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  commissionScope === "service"
                                    ? "border-sky-400/60 bg-sky-200/70 text-sky-900"
                                    : "border-sky-200/40 bg-white/40 text-sky-900/70 dark:border-sky-400/20 dark:bg-white/10 dark:text-white/70"
                                } ${bookingSaleMode ? "cursor-not-allowed opacity-50" : ""}`}
                              >
                                Un servicio
                              </button>
                            </div>

                            {bookingSaleMode && (
                              <p className="text-xs opacity-70">
                                La edición por servicio se desactiva cuando se
                                usa la venta total por reserva.
                              </p>
                            )}

                            {commissionScope === "currency" && (
                              <div>
                                <p className="mb-2 text-sm font-medium">
                                  Moneda
                                </p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {currencies.map((cur) => {
                                    const selected =
                                      commissionScopeCurrency === cur;
                                    const base = commissionBaseFor(cur);
                                    return (
                                      <button
                                        key={cur}
                                        type="button"
                                        onClick={() =>
                                          setCommissionScopeCurrency(cur)
                                        }
                                        className={`flex items-start justify-between gap-3 rounded-2xl border p-3 text-left text-sm transition ${
                                          selected
                                            ? "border-sky-300/70 bg-sky-200/20 shadow-sm shadow-sky-900/10"
                                            : "border-sky-300/70 bg-sky-200/5 shadow-sm shadow-sky-900/10 transition-colors hover:bg-sky-200/20"
                                        }`}
                                      >
                                        <div>
                                          <p className="font-semibold">{cur}</p>
                                          <p className="text-xs opacity-70">
                                            Base comisión: {fmt(base, cur)}
                                          </p>
                                        </div>
                                        <div
                                          className={`flex size-5 items-center justify-center rounded border ${
                                            selected
                                              ? "border-sky-500 bg-sky-500 text-white"
                                              : "border-sky-200/60 text-transparent dark:border-sky-400/30"
                                          }`}
                                        >
                                          <CheckIcon className="size-3.5" />
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {commissionScope === "service" && (
                              <div>
                                <p className="mb-2 text-sm font-medium">
                                  Servicio
                                </p>
                                <div className="max-h-52 space-y-2 overflow-auto pr-1">
                                  {serviceOptions.map((opt) => {
                                    const selected =
                                      commissionScopeServiceId === opt.id;
                                    const svc = serviceById.get(opt.id);
                                    const sale =
                                      svc && typeof svc.sale_price === "number"
                                        ? fmt(svc.sale_price, opt.currency)
                                        : null;
                                    return (
                                      <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() =>
                                          setCommissionScopeServiceId(opt.id)
                                        }
                                        className={`flex w-full items-start justify-between gap-3 rounded-2xl border p-3 text-left text-sm transition ${
                                          selected
                                            ? "border-sky-300/70 bg-sky-200/20 shadow-sm shadow-sky-900/10"
                                            : "border-sky-300/70 bg-sky-200/5 shadow-sm shadow-sky-900/10 transition-colors hover:bg-sky-200/20"
                                        }`}
                                      >
                                        <div>
                                          <p className="font-semibold">
                                            {opt.label}
                                          </p>
                                          {sale ? (
                                            <p className="text-xs opacity-70">
                                              Venta: {sale}
                                            </p>
                                          ) : (
                                            <p className="text-xs opacity-70">
                                              Moneda: {opt.currency}
                                            </p>
                                          )}
                                        </div>
                                        <div
                                          className={`flex size-5 items-center justify-center rounded border ${
                                            selected
                                              ? "border-sky-500 bg-sky-500 text-white"
                                              : "border-sky-200/60 text-transparent dark:border-sky-400/30"
                                          }`}
                                        >
                                          <CheckIcon className="size-3.5" />
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <label className="mb-1 block text-sm">
                                  Vendedor
                                </label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.01}
                                    inputMode="decimal"
                                    value={commissionDraftSeller}
                                    onChange={(e) =>
                                      setCommissionDraftSeller(e.target.value)
                                    }
                                    className="w-full rounded-2xl border border-sky-200/70 bg-white/60 px-3 py-2 pr-8 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200/60 dark:border-sky-400/20 dark:bg-white/10 dark:text-white"
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-sky-500/80 dark:text-sky-200/70">
                                    %
                                  </span>
                                </div>
                              </div>

                              {leaderList.map((leader) => (
                                <div key={leader.userId}>
                                  <label className="mb-1 block text-sm">
                                    {leader.name || `Líder ${leader.userId}`}
                                  </label>
                                  <div className="relative">
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={0.01}
                                      inputMode="decimal"
                                      value={
                                        commissionDraftLeaders[leader.userId] ??
                                        ""
                                      }
                                      onChange={(e) =>
                                        setCommissionDraftLeaders((prev) => ({
                                          ...prev,
                                          [leader.userId]: e.target.value,
                                        }))
                                      }
                                      className="w-full rounded-2xl border border-sky-200/70 bg-white/60 px-3 py-2 pr-8 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200/60 dark:border-sky-400/20 dark:bg-white/10 dark:text-white"
                                    />
                                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-sky-500/80 dark:text-sky-200/70">
                                      %
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {leaderList.length === 0 && (
                              <p className="text-xs opacity-70">
                                No hay líderes asociados a esta regla.
                              </p>
                            )}

                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="rounded-2xl border border-sky-200/40 bg-white/50 p-3 dark:border-sky-400/20 dark:bg-white/10">
                                <p className="text-xs opacity-70">Vendedor</p>
                                <p className="text-lg font-semibold">
                                  {sellerPctValue != null
                                    ? `${fmtPct(sellerPctValue)}%`
                                    : "--"}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-sky-200/40 bg-white/50 p-3 dark:border-sky-400/20 dark:bg-white/10">
                                <p className="text-xs opacity-70">Líderes</p>
                                <p className="text-lg font-semibold">
                                  {Number.isFinite(leadersSum)
                                    ? `${fmtPct(leadersSum)}%`
                                    : "--"}
                                </p>
                              </div>
                              <div
                                className={`rounded-2xl border p-3 ${
                                  overLimit
                                    ? "border-red-400/40 bg-red-100/20"
                                    : "border-sky-200/40 bg-white/50 dark:border-sky-400/20 dark:bg-white/10"
                                }`}
                              >
                                <p className="text-xs opacity-70">
                                  Resto agencia
                                </p>
                                <p className="text-lg font-semibold">
                                  {overLimit
                                    ? "0.00%"
                                    : `${fmtPct(remainder)}%`}
                                </p>
                              </div>
                            </div>

                            {overLimit ? (
                              <p className="text-xs text-red-600">
                                La suma no puede superar 100%.
                              </p>
                            ) : null}

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={saveCommissionScope}
                                disabled={!canSaveCommission}
                                className="rounded-full border border-sky-500/70 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-700 shadow-sm shadow-sky-900/10 transition hover:bg-sky-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-400/40 dark:bg-sky-500/10 dark:text-sky-100"
                              >
                                {commissionSaving ? "Guardando..." : "Guardar"}
                              </button>
                              <button
                                type="button"
                                onClick={removeCommissionScope}
                                disabled={commissionSaving || !hasScopeCustom}
                                className="rounded-full bg-red-600 p-2 text-red-100 shadow-sm shadow-red-900/10 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label="Quitar comisión personalizada"
                                title="Quitar comisión personalizada"
                              >
                                <TrashIcon className="size-4" />
                              </button>
                              <span className="text-xs opacity-70">
                                {hasScopeCustom
                                  ? "Comisión personalizada activa"
                                  : "Sin comisión personalizada"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </footer>
            </section>
          );
        })}
      </div>

      {currencies.length > 0 && (
        <section className="mt-2 rounded-3xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10">
          <header className="mb-4 flex items-center justify-between gap-3 px-2">
            <h3 className="text-lg font-semibold tracking-tight">Deudas</h3>
            <span className="rounded-full border border-white/10 bg-white/20 px-2.5 py-1 text-xs font-medium">
              {bookingSaleMode
                ? "Desglose por moneda"
                : "Desglose por moneda y servicio"}
            </span>
          </header>

          <div className={`grid ${colsClass} gap-6`}>
            {currencies.map((currency) => {
              const code = normalizeCurrencyCode(currency);
              const debtSummary = debtSummaryByCurrency[code] || {
                saleForDebt: 0,
                paid: 0,
                debt: 0,
              };
              const paxDebtRows = paxDebtBreakdownByCurrency[code] || [];
              const paxUnallocatedPaid = paxUnallocatedPaidByCurrency[code] || 0;
              const operatorDebtRows = operatorDebtBreakdownByCurrency[code] || [];
              const operatorDebtTotal = operatorDebtTotalsByCurrency[code] || 0;

              return (
                <section
                  key={`debt-${code}`}
                  className="rounded-3xl border border-white/10 bg-white/10 p-4 shadow-sm shadow-sky-950/10"
                >
                  <header className="mb-3 px-1">
                    <h4 className="text-base font-semibold">
                      {labels[code] || code}
                    </h4>
                  </header>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Section title="Deuda del pax">
                      <Row
                        label={manualMode ? "Venta" : "Venta c/ interés"}
                        value={fmt(debtSummary.saleForDebt, code)}
                      />
                      <Row
                        label="Pagos aplicados"
                        value={fmt(debtSummary.paid, code)}
                      />
                      <Row label="Deuda" value={fmt(debtSummary.debt, code)} />
                      {!bookingSaleMode && paxDebtRows.length > 0 && (
                        <div className="space-y-1 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
                            Por servicio
                          </p>
                          <div className="max-h-44 space-y-1 overflow-auto pr-1">
                            {paxDebtRows.map((row) => (
                              <div
                                key={`${code}-pax-${row.serviceId}`}
                                className="rounded-xl border border-white/10 bg-white/10 px-2.5 py-2 text-xs dark:bg-white/5"
                              >
                                <div className="mb-1 truncate font-medium text-sky-900/85 dark:text-white/85">
                                  {row.label}
                                </div>
                                <div className="flex items-center justify-between gap-2 opacity-80">
                                  <span>Venta</span>
                                  <span className="tabular-nums">
                                    {fmt(row.sale, code)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2 opacity-80">
                                  <span>Cobrado</span>
                                  <span className="tabular-nums">
                                    {fmt(row.paid, code)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2 font-semibold">
                                  <span>Deuda</span>
                                  <span className="tabular-nums">
                                    {fmt(row.debt, code)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {Math.abs(paxUnallocatedPaid) > 0.000001 && (
                            <p className="text-[11px] text-amber-700 dark:text-amber-300">
                              Cobros sin imputación por servicio:{" "}
                              {fmt(paxUnallocatedPaid, code)}
                            </p>
                          )}
                        </div>
                      )}
                    </Section>

                    <Section title="Deuda del operador">
                      <Row
                        label="Pendiente"
                        value={fmt(operatorDebtTotal, code)}
                      />
                      {operatorDebtRows.length > 0 ? (
                        <div className="space-y-1 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
                            Por servicio
                          </p>
                          <div className="max-h-44 space-y-1 overflow-auto pr-1">
                            {operatorDebtRows.map((row, idx) => (
                              <div
                                key={`${code}-operator-${row.serviceId ?? "none"}-${idx}`}
                                className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/10 px-2.5 py-2 text-xs dark:bg-white/5"
                              >
                                <span className="truncate text-sky-900/85 dark:text-white/85">
                                  {row.label}
                                </span>
                                <span className="font-semibold tabular-nums">
                                  {fmt(row.amount, code)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="py-3 text-xs opacity-65">
                          Sin deuda pendiente al operador.
                        </p>
                      )}
                    </Section>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
