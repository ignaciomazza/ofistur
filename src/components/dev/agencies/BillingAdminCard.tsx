// src/components/dev/agencies/BillingAdminCard.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { formatMoneyInput, shouldPreferDotDecimal } from "@/utils/moneyInput";
import {
  IVA_RATE,
  PLAN_DATA,
  applyVat,
  calcExtraUsersCost,
  calcInfraCost,
  calcMonthlyBaseWithVat,
  calcVatFromTotal,
  type PlanKey,
} from "@/lib/billing/pricing";

type BillingConfig = {
  id_config?: number;
  id_agency: number;
  plan_key: PlanKey;
  billing_users: number;
  user_limit: number | null;
  currency: string;
  start_date?: string | null;
  notes?: string | null;
};

type Adjustment = {
  id_adjustment: number;
  kind: "discount" | "tax";
  mode: "percent" | "fixed";
  value: number;
  currency?: string | null;
  label?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  active: boolean;
};

type Charge = {
  id_charge: number;
  period_start?: string | null;
  period_end?: string | null;
  status: string;
  charge_kind?: string | null;
  label?: string | null;
  base_amount_usd: number;
  adjustments_total_usd: number;
  total_usd: number;
  paid_amount?: number | null;
  paid_currency?: string | null;
  fx_rate?: number | null;
  paid_at?: string | null;
  account?: string | null;
  payment_method?: string | null;
  notes?: string | null;
};

type StatsPayload = {
  totals: {
    paid_usd: number;
  };
  counts: {
    total: number;
    pending: number;
    paid: number;
  };
  last_payment_at?: string | null;
  last_charge?: {
    status: string;
    period_start?: string | null;
    period_end?: string | null;
    total_usd?: number | null;
  } | null;
  estimates: {
    monthly_usd: number;
    quarterly_usd: number;
    semiannual_usd: number;
    annual_usd: number;
  };
};

type BillingGroupInfo = {
  owner: { id_agency: number; name: string; legal_name: string };
  is_owner: boolean;
  members: { id_agency: number; name: string; legal_name: string }[];
};

type AgencyOption = {
  id_agency: number;
  name: string;
  legal_name: string;
};

type StorageConfigSnapshot = {
  enabled?: boolean;
  scope?: "agency" | "group";
} | null;

type StorageStatusPayload = {
  local_config?: StorageConfigSnapshot;
  owner_config?: StorageConfigSnapshot;
};

const FIXED_ACCOUNT = "Banco Nación";
const FIXED_PAYMENT_METHOD = "Transferencia";

const PLAN_STORAGE_INCLUDED: Record<
  PlanKey,
  { storage_gb: number; transfer_gb: number }
> = {
  basico: { storage_gb: 128, transfer_gb: 256 },
  medio: { storage_gb: 500, transfer_gb: 1024 },
  pro: { storage_gb: 1024, transfer_gb: 2048 },
};

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatYMD(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function toYMD(value?: string | Date | null) {
  if (!value) return "";
  if (value instanceof Date) return formatYMD(value);
  const raw = String(value);
  if (isDateOnly(raw)) return raw;
  if (raw.includes("T")) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return formatYMD(d);
}

function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  if (value instanceof Date) return value.toLocaleDateString("es-AR");
  const raw = String(value);
  if (isDateOnly(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("es-AR");
}

function formatMoney(value: number, currency = "USD") {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(safe);
}

function formatStorageUnits(gb: number) {
  if (!Number.isFinite(gb) || gb <= 0) return "0 GB";
  if (gb >= 1024 && gb % 1024 === 0) return `${gb / 1024} TB`;
  return `${gb} GB`;
}

function toYearMonth(value?: string | Date | null) {
  const ymd = toYMD(value);
  if (!ymd) return "";
  return ymd.slice(0, 7);
}

function monthBounds(yearMonth: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start: formatYMD(start), end: formatYMD(end) };
}

function formatBillingMonth(value?: string | Date | null) {
  const ym = toYearMonth(value);
  if (!ym) return "Mes no definido";
  const [year, month] = ym.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  if (Number.isNaN(date.getTime())) return ym;
  return date.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
}

function parseMoneyInputValue(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned || cleaned === "," || cleaned === "." || cleaned === "-") {
    return null;
  }
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeChargeStatus(status?: string | null) {
  return String(status || "PENDING")
    .trim()
    .toUpperCase();
}

function chargeStatusLabel(status?: string | null) {
  const normalized = normalizeChargeStatus(status);
  if (normalized === "PAID") return "Pagado";
  if (normalized === "PENDING") return "Pendiente";
  if (normalized === "CANCELLED") return "Cancelado";
  if (normalized === "VOID") return "Anulado";
  return normalized || "Pendiente";
}

function chargeStatusBadgeClass(status?: string | null) {
  const normalized = normalizeChargeStatus(status);
  if (normalized === "PAID") {
    return "border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200";
  }
  if (normalized === "PENDING") {
    return "border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200";
  }
  if (normalized === "CANCELLED" || normalized === "VOID") {
    return "border-rose-300/40 bg-rose-100/20 text-rose-900 dark:text-rose-200";
  }
  return "border-white/20 bg-white/20 text-sky-950 dark:text-white";
}

function formatPaidAmount(value: number, currency?: string | null) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const code = String(currency || "USD")
    .trim()
    .toUpperCase();
  return formatMoney(amount, code);
}

function activeAdjustments(adjustments: Adjustment[], date: Date) {
  return adjustments.filter((adj) => {
    if (!adj.active) return false;
    if (adj.starts_at && new Date(adj.starts_at) > date) return false;
    if (adj.ends_at && new Date(adj.ends_at) < date) return false;
    return true;
  });
}

function calcDiscountTotal(base: number, adjustments: Adjustment[]) {
  const percent = adjustments
    .filter((adj) => adj.mode === "percent")
    .reduce((sum, adj) => sum + Number(adj.value || 0), 0);
  const fixed = adjustments
    .filter((adj) => adj.mode === "fixed")
    .reduce((sum, adj) => sum + Number(adj.value || 0), 0);
  return base * (percent / 100) + fixed;
}

function calcTotals(base: number, adjustments: Adjustment[], date: Date) {
  const active = activeAdjustments(adjustments, date);
  const discounts = active.filter((adj) => adj.kind === "discount");
  const discountUsd = calcDiscountTotal(base, discounts);
  const netAdjustments = discountUsd ? -discountUsd : 0;
  const total = Math.max(base - discountUsd, 0);
  return { discountUsd, netAdjustments, total };
}

type Props = { agencyId: number };
type BillingWorkspace = "overview" | "setup" | "recurring" | "extra";

export default function BillingAdminCard({ agencyId }: Props) {
  const { token } = useAuth();
  const defaultBillingMonth = toYearMonth(new Date());

  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [resettingBilling, setResettingBilling] = useState(false);
  const [groupResolved, setGroupResolved] = useState(false);
  const [groupInfo, setGroupInfo] = useState<BillingGroupInfo | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const [agencyOptions, setAgencyOptions] = useState<AgencyOption[]>([]);
  const [hasStorageContract, setHasStorageContract] = useState(false);
  const [config, setConfig] = useState<BillingConfig>({
    id_agency: agencyId,
    plan_key: "basico",
    billing_users: 3,
    user_limit: null,
    currency: "USD",
    start_date: null,
    notes: "",
  });
  const [currentUsers, setCurrentUsers] = useState(0);

  const [adjustmentsLoading, setAdjustmentsLoading] = useState(true);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [editingAdjustmentId, setEditingAdjustmentId] = useState<number | null>(
    null,
  );
  const [adjustmentForm, setAdjustmentForm] = useState({
    mode: "percent" as "percent" | "fixed",
    value: "",
    currency: "USD",
    label: "",
    starts_at: "",
    ends_at: "",
    active: true,
  });
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);

  const [chargesLoading, setChargesLoading] = useState(true);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [nextChargeCursor, setNextChargeCursor] = useState<number | null>(null);
  const [chargesLoadingMore, setChargesLoadingMore] = useState(false);
  const [editingChargeId, setEditingChargeId] = useState<number | null>(null);
  const [chargeForm, setChargeForm] = useState({
    billing_month: defaultBillingMonth,
    base_amount_usd: "",
    adjustments_total_usd: "",
    paid_amount: "",
    paid_currency: "USD",
    fx_rate: "",
    paid_at: "",
  });
  const [chargeDiscountPct, setChargeDiscountPct] = useState("");
  const [chargeDiscountUsd, setChargeDiscountUsd] = useState("");
  const [chargeDiscountMode, setChargeDiscountMode] = useState<
    "fixed" | "percent"
  >("fixed");
  const [chargeSaving, setChargeSaving] = useState(false);

  const [editingExtraChargeId, setEditingExtraChargeId] = useState<number | null>(
    null,
  );
  const [extraForm, setExtraForm] = useState({
    label: "",
    amount_usd: "",
    paid_amount: "",
    paid_currency: "USD",
    fx_rate: "",
    paid_at: "",
  });
  const [extraSaving, setExtraSaving] = useState(false);

  const [bspRate, setBspRate] = useState<number | null>(null);
  const [bspDate, setBspDate] = useState<string | null>(null);
  const [bspLoading, setBspLoading] = useState(false);

  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [workspace, setWorkspace] = useState<BillingWorkspace>("overview");

  const billingOwnerId = groupInfo?.owner?.id_agency ?? agencyId;
  const isBillingOwner = billingOwnerId === agencyId;
  const groupedBillingEnabled = !isBillingOwner;
  const billingTargetPath = groupResolved ? billingOwnerId : agencyId;
  const selectClassName =
    "w-full cursor-pointer rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none transition-colors hover:border-sky-400/40 focus:border-sky-400/50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/10 dark:text-white";

  const monthlyBase = useMemo(() => {
    return calcMonthlyBaseWithVat(config.plan_key, config.billing_users);
  }, [config.plan_key, config.billing_users]);
  const monthlyTotals = useMemo(() => {
    return calcTotals(monthlyBase, adjustments, new Date());
  }, [monthlyBase, adjustments]);
  const monthlyTotal = monthlyTotals.total;
  const monthlyVat = useMemo(() => {
    return calcVatFromTotal(monthlyTotal);
  }, [monthlyTotal]);
  const basePlanVat = useMemo(() => {
    return applyVat(PLAN_DATA[config.plan_key].base);
  }, [config.plan_key]);
  const extraUsersVat = useMemo(() => {
    return applyVat(calcExtraUsersCost(config.billing_users));
  }, [config.billing_users]);
  const infraVat = useMemo(() => {
    return applyVat(calcInfraCost(config.billing_users));
  }, [config.billing_users]);
  const storageIncluded = useMemo(() => {
    return PLAN_STORAGE_INCLUDED[config.plan_key];
  }, [config.plan_key]);
  const chargeDiscountValue = useMemo(() => {
    if (chargeDiscountMode === "percent") {
      const base = Number(chargeForm.base_amount_usd || 0);
      const pct = Number(chargeDiscountPct || 0);
      if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(pct) || pct <= 0) {
        return 0;
      }
      return (base * pct) / 100;
    }
    const fixed = Number(chargeDiscountUsd || 0);
    if (!Number.isFinite(fixed)) return 0;
    return Math.abs(fixed);
  }, [
    chargeDiscountMode,
    chargeForm.base_amount_usd,
    chargeDiscountPct,
    chargeDiscountUsd,
  ]);
  const chargeAdjustmentNet = useMemo(() => {
    return chargeDiscountValue ? -chargeDiscountValue : 0;
  }, [chargeDiscountValue]);
  const chargeTotal = useMemo(() => {
    const base = Number(chargeForm.base_amount_usd || 0);
    const adj = chargeAdjustmentNet;
    if (!Number.isFinite(base) || !Number.isFinite(adj)) return 0;
    return base + adj;
  }, [chargeForm.base_amount_usd, chargeAdjustmentNet]);
  const extraTotal = useMemo(() => {
    const base = Number(extraForm.amount_usd || 0);
    return Number.isFinite(base) ? base : 0;
  }, [extraForm.amount_usd]);
  const extraVat = useMemo(() => {
    return calcVatFromTotal(extraTotal);
  }, [extraTotal]);
  const chargePaidAmountParsed = useMemo(() => {
    return parseMoneyInputValue(chargeForm.paid_amount);
  }, [chargeForm.paid_amount]);
  const extraPaidAmountParsed = useMemo(() => {
    return parseMoneyInputValue(extraForm.paid_amount);
  }, [extraForm.paid_amount]);
  const monthOptions = useMemo(() => {
    const now = new Date();
    const items: string[] = [];
    for (let offset = -12; offset <= 2; offset += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      items.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return items;
  }, []);
  const chargeMonthOptions = useMemo(() => {
    if (!chargeForm.billing_month) return monthOptions;
    if (monthOptions.includes(chargeForm.billing_month)) return monthOptions;
    return [chargeForm.billing_month, ...monthOptions];
  }, [chargeForm.billing_month, monthOptions]);
  const recurringCharges = useMemo(() => {
    return charges.filter(
      (charge) =>
        String(charge.charge_kind || "RECURRING").toUpperCase() !== "EXTRA",
    );
  }, [charges]);
  const extraCharges = useMemo(() => {
    return charges.filter(
      (charge) =>
        String(charge.charge_kind || "RECURRING").toUpperCase() === "EXTRA",
    );
  }, [charges]);
  const discountAdjustments = useMemo(() => {
    return adjustments.filter((adj) => adj.kind === "discount");
  }, [adjustments]);
  const workspaceItems = useMemo(
    () =>
      [
        {
          key: "overview" as const,
          title: "Resumen",
          description: "Estado diario y decisiones rapidas",
        },
        {
          key: "setup" as const,
          title: "Configuracion",
          description: "Plan, usuarios y descuentos",
        },
        {
          key: "recurring" as const,
          title: "Cobros mensuales",
          description: "Crear y seguir cobros recurrentes",
        },
        {
          key: "extra" as const,
          title: "Cobros extras",
          description: "Servicios unicos y su seguimiento",
        },
      ] satisfies {
        key: BillingWorkspace;
        title: string;
        description: string;
      }[],
    [],
  );

  const overLimit =
    config.user_limit != null && currentUsers > config.user_limit;

  async function fetchConfig() {
    if (!token) return;
    setConfigLoading(true);
    try {
      const res = await authFetch(
        `/api/dev/agencies/${billingTargetPath}/billing/config`,
        {},
        token,
      );
      if (!res.ok) throw new Error("No se pudo cargar el plan");
      const data = (await res.json()) as {
        config: BillingConfig;
        current_users: number;
      };
      setConfig(data.config);
      setCurrentUsers(data.current_users);
    } catch (e) {
      console.error(e);
      toast.error("Error cargando plan");
    } finally {
      setConfigLoading(false);
    }
  }

  async function fetchAdjustments() {
    if (!token) return;
    setAdjustmentsLoading(true);
    try {
      const res = await authFetch(
        `/api/dev/agencies/${billingTargetPath}/billing/adjustments`,
        {},
        token,
      );
      if (!res.ok) throw new Error("No se pudieron cargar ajustes");
      const data = (await res.json()) as { items: Adjustment[] };
      setAdjustments(data.items);
    } catch (e) {
      console.error(e);
      toast.error("Error cargando ajustes");
    } finally {
      setAdjustmentsLoading(false);
    }
  }

  async function fetchCharges(init = true) {
    if (!token) return;
    if (init) setChargesLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "10" });
      const res = await authFetch(
        `/api/dev/agencies/${billingTargetPath}/billing/charges?${qs.toString()}`,
        {},
        token,
      );
      if (!res.ok) throw new Error("No se pudieron cargar cobros");
      const data = (await res.json()) as {
        items: Charge[];
        nextCursor: number | null;
      };
      setCharges(data.items);
      setNextChargeCursor(data.nextCursor);
    } catch (e) {
      console.error(e);
      toast.error("Error cargando cobros");
    } finally {
      if (init) setChargesLoading(false);
    }
  }

  async function loadMoreCharges() {
    if (!token || nextChargeCursor == null || chargesLoadingMore) return;
    setChargesLoadingMore(true);
    try {
      const qs = new URLSearchParams({
        limit: "10",
        cursor: String(nextChargeCursor),
      });
      const res = await authFetch(
        `/api/dev/agencies/${billingTargetPath}/billing/charges?${qs.toString()}`,
        {},
        token,
      );
      if (!res.ok) throw new Error("No se pudieron cargar mas cobros");
      const data = (await res.json()) as {
        items: Charge[];
        nextCursor: number | null;
      };
      setCharges((prev) => [...prev, ...data.items]);
      setNextChargeCursor(data.nextCursor);
    } catch (e) {
      console.error(e);
      toast.error("Error cargando mas cobros");
    } finally {
      setChargesLoadingMore(false);
    }
  }

  async function fetchStats() {
    if (!token) return;
    setStatsLoading(true);
    try {
      const res = await authFetch(
        `/api/dev/agencies/${billingTargetPath}/billing/stats`,
        {},
        token,
      );
      if (!res.ok) throw new Error("No se pudieron cargar estadisticas");
      const data = (await res.json()) as StatsPayload;
      setStats(data);
    } catch (e) {
      console.error(e);
      toast.error("Error cargando estadisticas");
    } finally {
      setStatsLoading(false);
    }
  }

  async function fetchGroupInfo() {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/dev/agencies/${agencyId}/billing/group`,
        {},
        token,
      );
      if (!res.ok) throw new Error("No se pudo cargar el grupo");
      const data = (await res.json()) as BillingGroupInfo;
      setGroupInfo(data);
    } catch (e) {
      console.error(e);
    } finally {
      setGroupResolved(true);
    }
  }

  async function fetchAgencyOptions() {
    if (!token) return;
    try {
      const res = await authFetch("/api/dev/agencies/options", {}, token);
      if (!res.ok) throw new Error("No se pudieron cargar agencias");
      const data = (await res.json()) as { items: AgencyOption[] };
      setAgencyOptions(data.items || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchStorageStatus() {
    if (!token) return;
    try {
      const res = await authFetch(`/api/dev/agencies/${agencyId}/storage`, {}, token);
      if (!res.ok) {
        setHasStorageContract(false);
        return;
      }
      const data = (await res.json()) as StorageStatusPayload;
      const scope = data.local_config?.scope ?? data.owner_config?.scope ?? "agency";
      const seed = scope === "group" ? data.owner_config : data.local_config;
      setHasStorageContract(Boolean(seed?.enabled));
    } catch (e) {
      console.error(e);
      setHasStorageContract(false);
    }
  }

  async function updateBillingOwner(nextOwnerId: number) {
    if (!token) return;
    if (groupSaving) return;
    setGroupSaving(true);
    try {
      const payload = {
        owner_id: nextOwnerId === agencyId ? null : nextOwnerId,
      };
      const res = await authFetch(
        `/api/dev/agencies/${agencyId}/billing/group`,
        { method: "PUT", body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo actualizar el grupo");
      }
      await fetchGroupInfo();
      toast.success("Grupo actualizado");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error actualizando grupo");
    } finally {
      setGroupSaving(false);
    }
  }

  const handleGroupedBillingToggle = (nextEnabled: boolean) => {
    if (!nextEnabled) {
      void updateBillingOwner(agencyId);
      return;
    }
    const candidates = agencyOptions.filter((opt) => opt.id_agency !== agencyId);
    if (candidates.length === 0) {
      toast.info("No hay otras agencias disponibles para agrupar.");
      return;
    }
    const currentOwnerId = groupInfo?.owner?.id_agency;
    const preferredOwner =
      currentOwnerId && currentOwnerId !== agencyId
        ? currentOwnerId
        : candidates[0].id_agency;
    void updateBillingOwner(preferredOwner);
  };

  async function fetchBspRate() {
    setBspLoading(true);
    try {
      const res = await fetch("/api/bsp-rate");
      if (!res.ok) throw new Error("No se pudo cargar BSP");
      const data = (await res.json()) as {
        ok: boolean;
        arsPerUsd?: number;
        date?: string | null;
      };
      if (data.ok && data.arsPerUsd) {
        setBspRate(data.arsPerUsd);
        setBspDate(data.date ?? null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBspLoading(false);
    }
  }

  useEffect(() => {
    if (!token || !agencyId) return;
    setGroupResolved(false);
    fetchGroupInfo();
    fetchAgencyOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, agencyId]);

  useEffect(() => {
    if (!token || !agencyId || !groupResolved) return;
    fetchConfig();
    fetchAdjustments();
    fetchCharges();
    fetchStats();
    fetchStorageStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, agencyId, groupResolved, billingTargetPath]);

  useEffect(() => {
    fetchBspRate();
  }, []);

  useEffect(() => {
    if (chargeForm.paid_currency === "ARS") {
      if (!chargeForm.fx_rate && bspRate) {
        setChargeForm((prev) => ({
          ...prev,
          fx_rate: String(bspRate),
        }));
      }
      return;
    }
    if (chargeForm.fx_rate) {
      setChargeForm((prev) => ({ ...prev, fx_rate: "" }));
    }
  }, [chargeForm.paid_currency, bspRate, chargeForm.fx_rate]);

  useEffect(() => {
    if (extraForm.paid_currency === "ARS") {
      if (!extraForm.fx_rate && bspRate) {
        setExtraForm((prev) => ({
          ...prev,
          fx_rate: String(bspRate),
        }));
      }
      return;
    }
    if (extraForm.fx_rate) {
      setExtraForm((prev) => ({ ...prev, fx_rate: "" }));
    }
  }, [extraForm.paid_currency, bspRate, extraForm.fx_rate]);

  async function saveConfig() {
    if (!token) return;
    setConfigSaving(true);
    try {
      const payload = {
        plan_key: config.plan_key,
        billing_users: Number(config.billing_users),
        user_limit: config.user_limit ?? undefined,
        currency: config.currency || "USD",
        start_date: config.start_date ? config.start_date : null,
        notes: config.notes || "",
      };
      const res = await authFetch(
        `/api/dev/agencies/${billingTargetPath}/billing/config`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo guardar");
      }
      const saved = (await res.json()) as BillingConfig;
      setConfig(saved);
      toast.success("Plan actualizado");
      fetchStats();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error guardando plan");
    } finally {
      setConfigSaving(false);
    }
  }

  async function resetBilling() {
    if (!token) return;
    if (
      !confirm(
        isBillingOwner
          ? "¿Seguro? Se eliminan plan, descuentos y cobros existentes para esta agencia."
          : "¿Seguro? Se eliminan plan, descuentos y cobros existentes para todo el grupo.",
      )
    )
      return;
    setResettingBilling(true);
    try {
      const res = await authFetch(
        `/api/dev/agencies/${agencyId}/billing/reset`,
        { method: "POST" },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo resetear");
      }
      toast.success("Facturacion reseteada");
      resetAdjustmentForm();
      resetChargeForm();
      resetExtraForm();
      fetchConfig();
      fetchAdjustments();
      fetchCharges();
      fetchStats();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error reseteando");
    } finally {
      setResettingBilling(false);
    }
  }

  function startEditAdjustment(adj: Adjustment) {
    setWorkspace("setup");
    setEditingAdjustmentId(adj.id_adjustment);
    setAdjustmentForm({
      mode: adj.mode,
      value: String(adj.value ?? ""),
      currency: adj.currency ?? "USD",
      label: adj.label ?? "",
      starts_at: toYMD(adj.starts_at ?? null),
      ends_at: toYMD(adj.ends_at ?? null),
      active: Boolean(adj.active),
    });
  }

  function resetAdjustmentForm() {
    setEditingAdjustmentId(null);
    setAdjustmentForm({
      mode: "percent",
      value: "",
      currency: "USD",
      label: "",
      starts_at: "",
      ends_at: "",
      active: true,
    });
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setAdjustmentSaving(true);
    try {
      const payload = {
        kind: "discount",
        mode: adjustmentForm.mode,
        value: adjustmentForm.value,
        currency:
          adjustmentForm.mode === "fixed"
            ? adjustmentForm.currency || "USD"
            : undefined,
        label: adjustmentForm.label || undefined,
        starts_at: adjustmentForm.starts_at || null,
        ends_at: adjustmentForm.ends_at || null,
        active: adjustmentForm.active,
      };
      const url = editingAdjustmentId
        ? `/api/dev/agencies/${billingTargetPath}/billing/adjustments/${editingAdjustmentId}`
        : `/api/dev/agencies/${billingTargetPath}/billing/adjustments`;
      const method = editingAdjustmentId ? "PUT" : "POST";
      const res = await authFetch(
        url,
        { method, body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo guardar el ajuste");
      }
      toast.success(editingAdjustmentId ? "Ajuste actualizado" : "Ajuste creado");
      resetAdjustmentForm();
      fetchAdjustments();
      fetchStats();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error guardando ajuste");
    } finally {
      setAdjustmentSaving(false);
    }
  }

  async function deleteAdjustment(id: number) {
    if (!token) return;
    if (!confirm("¿Eliminar este ajuste?")) return;
    try {
      const res = await authFetch(
        `/api/dev/agencies/${billingTargetPath}/billing/adjustments/${id}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo eliminar");
      }
      toast.success("Ajuste eliminado");
      fetchAdjustments();
      fetchStats();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error eliminando ajuste");
    }
  }

  function startEditCharge(charge: Charge) {
    setWorkspace("recurring");
    setEditingChargeId(charge.id_charge);
    const netAdj = Number(charge.adjustments_total_usd ?? 0);
    setChargeForm({
      billing_month:
        toYearMonth(charge.period_start ?? charge.period_end ?? null) ||
        defaultBillingMonth,
      base_amount_usd: String(charge.base_amount_usd ?? ""),
      adjustments_total_usd: String(charge.adjustments_total_usd ?? ""),
      paid_amount:
        charge.paid_amount != null
          ? formatMoneyInput(
              String(charge.paid_amount),
              charge.paid_currency || "USD",
            )
          : "",
      paid_currency: charge.paid_currency || "USD",
      fx_rate: charge.fx_rate != null ? String(charge.fx_rate) : "",
      paid_at: toYMD(charge.paid_at ?? null),
    });
    setChargeDiscountMode("fixed");
    setChargeDiscountPct("");
    if (netAdj < 0) {
      setChargeDiscountUsd(Math.abs(netAdj).toFixed(2));
    } else {
      setChargeDiscountUsd("");
    }
  }

  function resetChargeForm() {
    setEditingChargeId(null);
    setChargeForm({
      billing_month: defaultBillingMonth,
      base_amount_usd: "",
      adjustments_total_usd: "",
      paid_amount: "",
      paid_currency: "USD",
      fx_rate: "",
      paid_at: "",
    });
    setChargeDiscountMode("fixed");
    setChargeDiscountPct("");
    setChargeDiscountUsd("");
  }

  function fillEstimate() {
    setChargeForm((prev) => ({
      ...prev,
      base_amount_usd: String(monthlyBase.toFixed(2)),
      adjustments_total_usd: String(monthlyTotals.netAdjustments.toFixed(2)),
    }));
    setChargeDiscountMode("fixed");
    setChargeDiscountPct("");
    setChargeDiscountUsd(
      monthlyTotals.discountUsd ? monthlyTotals.discountUsd.toFixed(2) : "",
    );
  }

  async function submitCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const bounds = monthBounds(chargeForm.billing_month);
    if (!bounds) {
      toast.info("Seleccioná el mes correspondiente al cobro.");
      return;
    }
    const paidAmount = chargeForm.paid_amount ? chargePaidAmountParsed : null;
    if (chargeForm.paid_amount && paidAmount == null) {
      toast.info("Monto pagado invalido.");
      return;
    }
    setChargeSaving(true);
    try {
      const paidAt = chargeForm.paid_at || null;
      const status = (paidAmount != null && paidAmount > 0) || paidAt
        ? "PAID"
        : "PENDING";
      const payload = {
        period_start: bounds.start,
        period_end: bounds.end,
        status,
        charge_kind: "RECURRING",
        base_amount_usd: chargeForm.base_amount_usd,
        adjustments_total_usd: chargeAdjustmentNet,
        paid_amount: paidAmount ?? undefined,
        paid_currency: chargeForm.paid_currency || undefined,
        fx_rate: chargeForm.fx_rate || undefined,
        paid_at: paidAt,
        account: FIXED_ACCOUNT,
        payment_method: FIXED_PAYMENT_METHOD,
      };
      const url = editingChargeId
        ? `/api/dev/agencies/${billingTargetPath}/billing/charges/${editingChargeId}`
        : `/api/dev/agencies/${billingTargetPath}/billing/charges`;
      const method = editingChargeId ? "PUT" : "POST";
      const res = await authFetch(
        url,
        { method, body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo guardar el cobro");
      }
      toast.success(editingChargeId ? "Cobro actualizado" : "Cobro creado");
      resetChargeForm();
      fetchCharges();
      fetchStats();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error guardando cobro");
    } finally {
      setChargeSaving(false);
    }
  }

  function startEditExtraCharge(charge: Charge) {
    setWorkspace("extra");
    setEditingExtraChargeId(charge.id_charge);
    setExtraForm({
      label: charge.label || "",
      amount_usd: String(charge.base_amount_usd ?? ""),
      paid_amount:
        charge.paid_amount != null
          ? formatMoneyInput(
              String(charge.paid_amount),
              charge.paid_currency || "USD",
            )
          : "",
      paid_currency: charge.paid_currency || "USD",
      fx_rate: charge.fx_rate != null ? String(charge.fx_rate) : "",
      paid_at: toYMD(charge.paid_at ?? null),
    });
  }

  function resetExtraForm() {
    setEditingExtraChargeId(null);
    setExtraForm({
      label: "",
      amount_usd: "",
      paid_amount: "",
      paid_currency: "USD",
      fx_rate: "",
      paid_at: "",
    });
  }

  async function submitExtraCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const base = Number(extraForm.amount_usd || 0);
    if (!Number.isFinite(base) || base <= 0) {
      toast.info("Cargá el monto del cobro extra.");
      return;
    }
    if (!extraForm.label.trim()) {
      toast.info("Agregá una etiqueta para el cobro extra.");
      return;
    }
    const paidAmount = extraForm.paid_amount ? extraPaidAmountParsed : null;
    if (extraForm.paid_amount && paidAmount == null) {
      toast.info("Monto pagado invalido.");
      return;
    }
    setExtraSaving(true);
    try {
      const paidAt = extraForm.paid_at || null;
      const status = (paidAmount != null && paidAmount > 0) || paidAt
        ? "PAID"
        : "PENDING";
      const payload = {
        period_start: null,
        period_end: null,
        status,
        charge_kind: "EXTRA",
        label: extraForm.label.trim(),
        base_amount_usd: base,
        adjustments_total_usd: 0,
        paid_amount: paidAmount ?? undefined,
        paid_currency: extraForm.paid_currency || undefined,
        fx_rate: extraForm.fx_rate || undefined,
        paid_at: paidAt,
        account: FIXED_ACCOUNT,
        payment_method: FIXED_PAYMENT_METHOD,
      };
      const url = editingExtraChargeId
        ? `/api/dev/agencies/${billingTargetPath}/billing/charges/${editingExtraChargeId}`
        : `/api/dev/agencies/${billingTargetPath}/billing/charges`;
      const method = editingExtraChargeId ? "PUT" : "POST";
      const res = await authFetch(
        url,
        { method, body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo guardar el cobro extra");
      }
      toast.success(
        editingExtraChargeId ? "Cobro extra actualizado" : "Cobro extra creado",
      );
      resetExtraForm();
      fetchCharges();
      fetchStats();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error guardando cobro extra");
    } finally {
      setExtraSaving(false);
    }
  }

  async function deleteCharge(id: number) {
    if (!token) return;
    if (!confirm("¿Eliminar este cobro?")) return;
    try {
      const res = await authFetch(
        `/api/dev/agencies/${billingTargetPath}/billing/charges/${id}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo eliminar");
      }
      toast.success("Cobro eliminado");
      fetchCharges();
      fetchStats();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Error eliminando cobro");
    }
  }

  return (
    <div className="space-y-8 rounded-3xl border border-white/10 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium">Facturacion de agencia</h3>
            <p className="text-xs text-sky-950/60 dark:text-white/60">
              Organiza el trabajo por contexto para reducir errores: resumen,
              configuracion y registro de cobros.
            </p>
          </div>
          <div className="text-xs text-sky-950/60 dark:text-white/60">
            Base en USD (IVA incluido). Si el pago es en ARS, usa BSP por defecto.
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/30 p-3 dark:bg-white/10">
            <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
              Total cobrado
            </p>
            <p className="text-base font-semibold">
              {stats ? formatMoney(stats.totals.paid_usd) : "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/30 p-3 dark:bg-white/10">
            <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
              Pendientes
            </p>
            <p className="text-base font-semibold">
              {stats ? stats.counts.pending : "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/30 p-3 dark:bg-white/10">
            <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
              Ultimo pago
            </p>
            <p className="text-base font-semibold">
              {stats ? formatDate(stats.last_payment_at ?? null) : "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/30 p-3 dark:bg-white/10">
            <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
              Mensual estimado
            </p>
            <p className="text-base font-semibold">
              {stats ? formatMoney(stats.estimates.monthly_usd) : formatMoney(monthlyTotal)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-medium">Vista de trabajo</h4>
            <p className="text-xs text-sky-950/60 dark:text-white/60">
              Mostra solo el bloque que estas operando para evitar ruido visual.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchStats}
            className="rounded-full bg-white/0 px-4 py-1.5 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
          >
            Actualizar estado
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {workspaceItems.map((item) => {
            const active = workspace === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setWorkspace(item.key)}
                className={`rounded-xl border p-3 text-left transition-transform hover:scale-[0.99] ${
                  active
                    ? "border-sky-400/40 bg-sky-100/30 text-sky-950 dark:bg-white/15 dark:text-white"
                    : "border-white/10 bg-white/20 text-sky-950/80 dark:bg-white/5 dark:text-white/80"
                }`}
              >
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-[11px]">{item.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {workspace === "overview" && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-medium">Estado diario</h4>
            <span className="text-xs text-sky-950/60 dark:text-white/60">
              Ventana de cobro: del 1 al 15 de cada mes.
            </span>
          </div>

          {statsLoading || !stats ? (
            <p className="text-sm text-sky-950/60 dark:text-white/60">
              Cargando estadisticas...
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
                  <div className="rounded-xl border border-white/10 bg-white/30 p-3 dark:bg-white/10">
                    <p className="text-xs text-sky-950/60 dark:text-white/60">
                      Ultimo cobro
                    </p>
                    <p>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          stats.last_charge
                            ? chargeStatusBadgeClass(stats.last_charge.status)
                            : "border-white/20 bg-white/20 text-sky-950 dark:text-white"
                        }`}
                      >
                        {stats.last_charge
                          ? chargeStatusLabel(stats.last_charge.status)
                          : "Sin cobro"}
                      </span>
                    </p>
                    <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                      {stats.last_charge
                        ? `${formatBillingMonth(
                            stats.last_charge.period_start ??
                              stats.last_charge.period_end ??
                              null,
                          )} (${formatDate(
                            stats.last_charge.period_start ?? null,
                          )} al ${formatDate(stats.last_charge.period_end ?? null)})`
                        : "Sin cobro registrado"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/30 p-3 dark:bg-white/10">
                    <p className="text-xs text-sky-950/60 dark:text-white/60">
                      Cobros del periodo
                    </p>
                    <p className="text-base font-semibold">
                      {stats.counts.paid} pagados / {stats.counts.pending} pendientes
                    </p>
                    <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                      Total registrados: {stats.counts.total}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/30 p-3 text-xs dark:bg-white/10">
                  <div className="flex justify-between">
                    <span>Estimado mensual</span>
                    <span>{formatMoney(stats.estimates.monthly_usd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Estimado trimestral</span>
                    <span>{formatMoney(stats.estimates.quarterly_usd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Estimado semestral</span>
                    <span>{formatMoney(stats.estimates.semiannual_usd)}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Estimado anual</span>
                    <span>{formatMoney(stats.estimates.annual_usd)}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setWorkspace("setup")}
                  className="rounded-full bg-white/0 px-4 py-2 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                >
                  Ir a configuracion
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspace("recurring")}
                  className="rounded-full bg-white/0 px-4 py-2 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                >
                  Registrar cobro mensual
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspace("extra")}
                  className="rounded-full bg-white/0 px-4 py-2 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                >
                  Registrar cobro extra
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {workspace === "setup" && (
        <div className="space-y-5">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/10 p-5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-medium">Facturacion agrupada</h4>
                <p className="text-xs text-sky-950/60 dark:text-white/60">
                  Centraliza plan, cobros y descuentos en una agencia owner.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleGroupedBillingToggle(!groupedBillingEnabled)}
                disabled={groupSaving}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  groupedBillingEnabled
                    ? "border border-sky-300/50 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                    : "border border-white/20 bg-white/10 text-sky-950/70 dark:text-white/70"
                }`}
              >
                <span
                  className={`size-2.5 rounded-full ${
                    groupedBillingEnabled ? "bg-sky-500" : "bg-sky-950/30 dark:bg-white/30"
                  }`}
                />
                {groupedBillingEnabled ? "Activada" : "Desactivada"}
              </button>
            </div>

            {groupedBillingEnabled ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs">Agencia que factura</span>
                    <select
                      value={billingOwnerId}
                      onChange={(e) => updateBillingOwner(Number(e.target.value))}
                      disabled={groupSaving || agencyOptions.length === 0}
                      className={selectClassName}
                    >
                      {agencyOptions.map((opt) => (
                        <option key={opt.id_agency} value={opt.id_agency}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-col justify-end text-xs text-sky-950/60 dark:text-white/60">
                    {groupSaving
                      ? "Actualizando grupo..."
                      : "Elegí quién centraliza la cobranza para que todo el equipo vea el mismo estado."}
                  </div>
                </div>

                {groupInfo?.members?.length ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {groupInfo.members.map((member) => (
                      <span
                        key={member.id_agency}
                        className={`rounded-full border px-3 py-1 ${
                          member.id_agency === billingOwnerId
                            ? "border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                            : "border-white/10 bg-white/10 text-sky-950/70 dark:text-white/70"
                        }`}
                      >
                        {member.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-sky-950/60 dark:text-white/60">
                Facturacion agrupada desactivada. Esta agencia factura por separado.
              </p>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-900">
                  1
                </div>
                <div>
                  <h4 className="text-base font-medium">
                    Definir plan y usuarios
                  </h4>
                  <p className="text-xs text-sky-950/60 dark:text-white/60">
                    Base mensual con IVA incluido. Ajusta usuarios cobrados y
                    limite interno.
                  </p>
                  <p className="mt-1 text-[11px] text-sky-950/60 dark:text-white/60">
                    Storage incluido: {formatStorageUnits(storageIncluded.storage_gb)} +{" "}
                    transferencia {formatStorageUnits(storageIncluded.transfer_gb)} por mes.
                  </p>
                </div>
              </div>
              <span className="text-xs text-sky-950/60 dark:text-white/60">
                Usuarios actuales: {currentUsers}
              </span>
            </div>

            {configLoading ? (
              <p className="text-sm text-sky-950/60 dark:text-white/60">
                Cargando plan...
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs">Plan</span>
                    <select
                      value={config.plan_key}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          plan_key: e.target.value as PlanKey,
                        }))
                      }
                      className={selectClassName}
                    >
                      {Object.entries(PLAN_DATA).map(([key, data]) => (
                        <option key={key} value={key}>
                          {data.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs">
                      Usuarios cobrados (cotizador)
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={config.billing_users}
                      onChange={(e) =>
                        setConfig((prev) => {
                          const next = Number(e.target.value);
                          return {
                            ...prev,
                            billing_users: Number.isFinite(next) ? next : 1,
                          };
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs">
                      Limite de usuarios (sin bloqueo)
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={config.user_limit ?? ""}
                      onChange={(e) =>
                        setConfig((prev) => {
                          if (!e.target.value) {
                            return { ...prev, user_limit: null };
                          }
                          const next = Number(e.target.value);
                          return {
                            ...prev,
                            user_limit: Number.isFinite(next) ? next : null,
                          };
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs">Inicio del plan</span>
                    <input
                      type="date"
                      value={toYMD(config.start_date ?? null)}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          start_date: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                    />
                  </label>
                </div>

                {overLimit && (
                  <p className="text-xs text-sky-600">
                    Los usuarios actuales superan el limite configurado.
                  </p>
                )}

                <div className="rounded-xl border border-white/10 bg-white/30 p-3 text-xs text-sky-950/70 dark:bg-white/10 dark:text-white/70">
                  <div className="flex justify-between">
                    <span>Plan base (incluye storage)</span>
                    <span>{formatMoney(basePlanVat)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Storage y transferencia incluidos</span>
                    <span>
                      {formatStorageUnits(storageIncluded.storage_gb)} /{" "}
                      {formatStorageUnits(storageIncluded.transfer_gb)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Usuarios extra</span>
                    <span>
                      {formatMoney(extraUsersVat)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Infra</span>
                    <span>{formatMoney(infraVat)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Descuentos activos</span>
                    <span>-{formatMoney(monthlyTotals.discountUsd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IVA incluido ({Math.round(IVA_RATE * 100)}%)</span>
                    <span>{formatMoney(monthlyVat)}</span>
                  </div>
                  <div className="mt-2 flex justify-between font-medium">
                    <span>Total mensual estimado</span>
                    <span>{formatMoney(monthlyTotal)}</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetBilling}
                    disabled={resettingBilling}
                    className="rounded-full bg-red-600/90 px-5 py-2 text-xs text-red-50 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-red-800"
                  >
                    {resettingBilling ? "Reseteando..." : "Resetear facturacion"}
                  </button>
                  <button
                    type="button"
                    onClick={saveConfig}
                    disabled={configSaving}
                    className="rounded-full bg-sky-100 px-5 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
                  >
                    {configSaving ? "Guardando..." : "Guardar plan"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-900">
                  2
                </div>
                <div>
                  <h4 className="text-base font-medium">Descuentos temporales</h4>
                  <p className="text-xs text-sky-950/60 dark:text-white/60">
                    Descuentos por campania. Se aplican sobre la base mensual con
                    IVA incluido.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => resetAdjustmentForm()}
                  className="rounded-full bg-white/0 px-4 py-1.5 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                >
                  Nuevo descuento
                </button>
              </div>
            </div>

            {adjustmentsLoading ? (
              <p className="text-sm text-sky-950/60 dark:text-white/60">
                Cargando ajustes...
              </p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-sky-950/70 dark:text-white/70">
                    Descuentos
                  </p>
                  {discountAdjustments.length === 0 ? (
                    <p className="text-sm text-sky-950/60 dark:text-white/60">
                      No hay descuentos activos.
                    </p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {discountAdjustments.map((adj) => (
                        <div
                          key={adj.id_adjustment}
                          className="space-y-2 rounded-xl border border-white/10 bg-white/30 p-3 text-xs dark:bg-white/10"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">
                              {adj.label || "Sin titulo"}
                            </span>
                            <span className="rounded-full bg-white/30 px-2 py-0.5 text-[10px] dark:bg-white/10">
                              {adj.active ? "Activo" : "Pausado"}
                            </span>
                          </div>
                          <div className="text-sky-950/70 dark:text-white/70">
                            {adj.mode === "percent"
                              ? `${adj.value}%`
                              : `${adj.value} ${adj.currency || "USD"}`}
                          </div>
                          <div className="text-sky-950/60 dark:text-white/60">
                            {formatDate(adj.starts_at ?? null)} →{" "}
                            {formatDate(adj.ends_at ?? null)}
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => startEditAdjustment(adj)}
                              className="rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteAdjustment(adj.id_adjustment)}
                              className="rounded-full bg-red-600/90 px-3 py-1 text-xs text-red-50 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <form
              onSubmit={submitAdjustment}
              className="space-y-3 rounded-xl border border-white/10 bg-white/20 p-3 text-sm dark:bg-white/10"
            >
              <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                Ejemplo: base IVA incluido 50, descuento 10% (3 meses) = total 45.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs">Modo</span>
                  <select
                    value={adjustmentForm.mode}
                    onChange={(e) =>
                      setAdjustmentForm((prev) => ({
                        ...prev,
                        mode: e.target.value as "percent" | "fixed",
                      }))
                    }
                    className={selectClassName}
                  >
                    <option value="percent">Porcentaje</option>
                    <option value="fixed">Monto fijo</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs">Valor</span>
                  <input
                    type="number"
                    step="0.01"
                    value={adjustmentForm.value}
                    onChange={(e) =>
                      setAdjustmentForm((prev) => ({
                        ...prev,
                        value: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs">Moneda</span>
                  <input
                    type="text"
                    value={adjustmentForm.currency}
                    onChange={(e) =>
                      setAdjustmentForm((prev) => ({
                        ...prev,
                        currency: e.target.value.toUpperCase(),
                      }))
                    }
                    disabled={adjustmentForm.mode !== "fixed"}
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none disabled:opacity-60 dark:bg-white/10 dark:text-white"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs">Etiqueta</span>
                <input
                  type="text"
                  value={adjustmentForm.label}
                  onChange={(e) =>
                    setAdjustmentForm((prev) => ({
                      ...prev,
                      label: e.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs">Desde</span>
                  <input
                    type="date"
                    value={adjustmentForm.starts_at}
                    onChange={(e) =>
                      setAdjustmentForm((prev) => ({
                        ...prev,
                        starts_at: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs">Hasta</span>
                  <input
                    type="date"
                    value={adjustmentForm.ends_at}
                    onChange={(e) =>
                      setAdjustmentForm((prev) => ({
                        ...prev,
                        ends_at: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={adjustmentForm.active}
                  onChange={(e) =>
                    setAdjustmentForm((prev) => ({
                      ...prev,
                      active: e.target.checked,
                    }))
                  }
                />
                Activo
              </label>

              <div className="flex justify-end gap-2">
                {editingAdjustmentId && (
                  <button
                    type="button"
                    onClick={() => resetAdjustmentForm()}
                    className="rounded-full bg-white/0 px-4 py-2 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={adjustmentSaving}
                  className="rounded-full bg-sky-100 px-4 py-2 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
                >
                  {adjustmentSaving
                    ? "Guardando..."
                    : editingAdjustmentId
                      ? "Guardar ajuste"
                      : "Crear ajuste"}
                </button>
              </div>
            </form>
          </div>
        </div>
        </div>
      )}

      {workspace === "recurring" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-900">
                  3
                </div>
                <div>
                  <h4 className="text-base font-medium">Registrar cobro mensual</h4>
                  <p className="text-xs text-sky-950/60 dark:text-white/60">
                    Crea el cobro (base IVA incluido - descuentos) y registra el
                    pago si ya lo recibiste. Si solo queres pendiente, deja el
                    pago vacio y estado Pendiente.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetChargeForm}
                className="rounded-full bg-white/0 px-4 py-1.5 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
              >
                Limpiar
              </button>
            </div>

            <form
              onSubmit={submitCharge}
              className="space-y-3 rounded-xl border border-white/10 bg-white/20 p-3 text-sm dark:bg-white/10"
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={fillEstimate}
                  className="rounded-full bg-white/0 px-4 py-1.5 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                >
                  Usar estimacion actual
                </button>
                <span className="text-[11px] text-sky-950/60 dark:text-white/60">
                  Total estimado: {formatMoney(monthlyTotal)}
                </span>
              </div>
              <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                La estimacion toma los ajustes configurados en el paso 2.
              </p>
              {hasStorageContract && (
                <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                  Este cobro ya incluye el storage del plan:{" "}
                  {formatStorageUnits(storageIncluded.storage_gb)} +{" "}
                  {formatStorageUnits(storageIncluded.transfer_gb)} de transferencia.
                </p>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs">Mes del cobro</span>
                  <select
                    value={chargeForm.billing_month}
                    onChange={(e) =>
                      setChargeForm((prev) => ({
                        ...prev,
                        billing_month: e.target.value,
                      }))
                    }
                    className={selectClassName}
                  >
                    {chargeMonthOptions.map((month) => (
                      <option key={month} value={month}>
                        {formatBillingMonth(`${month}-01`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs">Base USD (IVA inc.)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={chargeForm.base_amount_usd}
                    onChange={(e) =>
                      setChargeForm((prev) => ({
                        ...prev,
                        base_amount_usd: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="space-y-2 md:min-w-[240px]">
                  <span className="block text-xs">Tipo de descuento</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setChargeDiscountMode("fixed")}
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        chargeDiscountMode === "fixed"
                          ? "border border-sky-400/50 bg-sky-100/30 text-sky-950 dark:text-white"
                          : "border border-white/15 bg-white/10 text-sky-950/70 dark:text-white/70"
                      }`}
                    >
                      Fijo (USD)
                    </button>
                    <button
                      type="button"
                      onClick={() => setChargeDiscountMode("percent")}
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        chargeDiscountMode === "percent"
                          ? "border border-sky-400/50 bg-sky-100/30 text-sky-950 dark:text-white"
                          : "border border-white/15 bg-white/10 text-sky-950/70 dark:text-white/70"
                      }`}
                    >
                      Porcentaje
                    </button>
                  </div>
                </div>
                <label className="block flex-1">
                  <span className="mb-1 block text-xs">
                    {chargeDiscountMode === "fixed"
                      ? "Descuento fijo (USD)"
                      : "Descuento (%)"}
                  </span>
                  {chargeDiscountMode === "fixed" ? (
                    <input
                      type="number"
                      step="0.01"
                      value={chargeDiscountUsd}
                      onChange={(e) => setChargeDiscountUsd(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                    />
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      value={chargeDiscountPct}
                      onChange={(e) => setChargeDiscountPct(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                    />
                  )}
                </label>
              </div>

              <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                Total USD actual: {formatMoney(chargeTotal)}. Se calcula como
                base - descuento. IVA incluido:{" "}
                {formatMoney(calcVatFromTotal(chargeTotal))}.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs">Monto pagado</span>
                  <input
                    type="text"
                    value={chargeForm.paid_amount}
                    onChange={(e) =>
                      setChargeForm((prev) => ({
                        ...prev,
                        paid_amount: formatMoneyInput(
                          e.target.value,
                          prev.paid_currency,
                          {
                            preferDotDecimal: shouldPreferDotDecimal(e),
                          },
                        ),
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
                <div className="space-y-2">
                  <span className="block text-xs">Moneda pago</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setChargeForm((prev) => ({
                          ...prev,
                          paid_currency: "USD",
                          paid_amount: prev.paid_amount
                            ? formatMoneyInput(prev.paid_amount, "USD")
                            : "",
                        }))
                      }
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        chargeForm.paid_currency === "USD"
                          ? "border border-sky-400/50 bg-sky-100/30 text-sky-950 dark:text-white"
                          : "border border-white/15 bg-white/10 text-sky-950/70 dark:text-white/70"
                      }`}
                    >
                      USD
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setChargeForm((prev) => ({
                          ...prev,
                          paid_currency: "ARS",
                          paid_amount: prev.paid_amount
                            ? formatMoneyInput(prev.paid_amount, "ARS")
                            : "",
                        }))
                      }
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        chargeForm.paid_currency === "ARS"
                          ? "border border-sky-400/50 bg-sky-100/30 text-sky-950 dark:text-white"
                          : "border border-white/15 bg-white/10 text-sky-950/70 dark:text-white/70"
                      }`}
                    >
                      ARS
                    </button>
                  </div>
                </div>
              </div>

              {chargeForm.paid_currency === "ARS" && (
                <label className="block">
                  <span className="mb-1 block text-xs">Cotizacion BSP (ARS/USD)</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={chargeForm.fx_rate}
                    onChange={(e) =>
                      setChargeForm((prev) => ({
                        ...prev,
                        fx_rate: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                  <span className="mt-1 block text-[11px] text-sky-950/50 dark:text-white/50">
                    {bspLoading
                      ? "Cargando BSP..."
                      : bspRate
                        ? `BSP ${bspRate}${bspDate ? ` (${bspDate})` : ""}`
                      : "BSP no disponible."}
                  </span>
                </label>
              )}

              <div className="grid gap-3 md:grid-cols-1">
                <label className="block">
                  <span className="mb-1 block text-xs">Fecha pago</span>
                  <input
                    type="date"
                    value={chargeForm.paid_at}
                    onChange={(e) =>
                      setChargeForm((prev) => ({
                        ...prev,
                        paid_at: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2">
                {editingChargeId && (
                  <button
                    type="button"
                    onClick={resetChargeForm}
                    className="rounded-full bg-white/0 px-4 py-2 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={chargeSaving}
                  className="rounded-full bg-sky-100 px-4 py-2 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
                >
                  {chargeSaving
                    ? "Guardando..."
                    : editingChargeId
                      ? "Guardar cobro"
                      : "Crear cobro"}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-900">
                  4
                </div>
                <div>
                  <h4 className="text-base font-medium">Cobros mensuales</h4>
                  <p className="text-xs text-sky-950/60 dark:text-white/60">
                    Lista de cobros mensuales y estado de pago.
                  </p>
                </div>
              </div>
            </div>

            {chargesLoading ? (
              <p className="text-sm text-sky-950/60 dark:text-white/60">
                Cargando cobros...
              </p>
            ) : recurringCharges.length === 0 ? (
              <p className="text-sm text-sky-950/60 dark:text-white/60">
                Todavia no hay cobros mensuales.
              </p>
            ) : (
              <div className="space-y-3">
                {recurringCharges.map((charge) => (
                  <div
                    key={charge.id_charge}
                    className="space-y-2 rounded-xl border border-white/10 bg-white/30 p-3 text-xs dark:bg-white/10"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        {formatBillingMonth(
                          charge.period_start ?? charge.period_end ?? null,
                        )}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${chargeStatusBadgeClass(
                          charge.status,
                        )}`}
                      >
                        {chargeStatusLabel(charge.status)}
                      </span>
                    </div>
                    <div className="text-sky-950/60 dark:text-white/60">
                      Periodo: {formatDate(charge.period_start ?? null)} al{" "}
                      {formatDate(charge.period_end ?? null)}
                    </div>
                    <div className="text-sky-950/70 dark:text-white/70">
                      Total facturado: {formatMoney(charge.total_usd)}
                    </div>
                    {charge.paid_amount != null && (
                      <div className="text-sky-950/60 dark:text-white/60">
                        Cobrado:{" "}
                        {formatPaidAmount(
                          Number(charge.paid_amount),
                          charge.paid_currency,
                        )}
                        {charge.fx_rate
                          ? ` • Estimado USD ${(
                              Number(charge.paid_amount) /
                              Number(charge.fx_rate)
                            ).toFixed(2)})`
                          : ""}
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => startEditCharge(charge)}
                        className="rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCharge(charge.id_charge)}
                        className="rounded-full bg-red-600/90 px-3 py-1 text-xs text-red-50 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}

                {nextChargeCursor != null && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={loadMoreCharges}
                      disabled={chargesLoadingMore}
                      className="rounded-full bg-sky-100 px-4 py-2 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
                    >
                      {chargesLoadingMore ? "Cargando..." : "Ver mas"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {workspace === "extra" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-900">
                  5
                </div>
                <div>
                  <h4 className="text-base font-medium">
                    Cobros extras (unicos)
                  </h4>
                  <p className="text-xs text-sky-950/60 dark:text-white/60">
                    Para desarrollos, capacitaciones o servicios especiales.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetExtraForm}
                className="rounded-full bg-white/0 px-4 py-1.5 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
              >
                Limpiar
              </button>
            </div>

            <form
              onSubmit={submitExtraCharge}
              className="space-y-3 rounded-xl border border-white/10 bg-white/20 p-3 text-sm dark:bg-white/10"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs">Etiqueta</span>
                  <input
                    type="text"
                    value={extraForm.label}
                    onChange={(e) =>
                      setExtraForm((prev) => ({
                        ...prev,
                        label: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs">Monto USD (IVA inc.)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={extraForm.amount_usd}
                    onChange={(e) =>
                      setExtraForm((prev) => ({
                        ...prev,
                        amount_usd: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
              </div>

              <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                Total USD actual: {formatMoney(extraTotal)}. IVA incluido:{" "}
                {formatMoney(extraVat)}.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs">Monto pagado</span>
                  <input
                    type="text"
                    value={extraForm.paid_amount}
                    onChange={(e) =>
                      setExtraForm((prev) => ({
                        ...prev,
                        paid_amount: formatMoneyInput(
                          e.target.value,
                          prev.paid_currency,
                          {
                            preferDotDecimal: shouldPreferDotDecimal(e),
                          },
                        ),
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
                <div className="space-y-2">
                  <span className="block text-xs">Moneda pago</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExtraForm((prev) => ({
                          ...prev,
                          paid_currency: "USD",
                          paid_amount: prev.paid_amount
                            ? formatMoneyInput(prev.paid_amount, "USD")
                            : "",
                        }))
                      }
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        extraForm.paid_currency === "USD"
                          ? "border border-sky-400/50 bg-sky-100/30 text-sky-950 dark:text-white"
                          : "border border-white/15 bg-white/10 text-sky-950/70 dark:text-white/70"
                      }`}
                    >
                      USD
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExtraForm((prev) => ({
                          ...prev,
                          paid_currency: "ARS",
                          paid_amount: prev.paid_amount
                            ? formatMoneyInput(prev.paid_amount, "ARS")
                            : "",
                        }))
                      }
                      className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                        extraForm.paid_currency === "ARS"
                          ? "border border-sky-400/50 bg-sky-100/30 text-sky-950 dark:text-white"
                          : "border border-white/15 bg-white/10 text-sky-950/70 dark:text-white/70"
                      }`}
                    >
                      ARS
                    </button>
                  </div>
                </div>
              </div>

              {extraForm.paid_currency === "ARS" && (
                <label className="block">
                  <span className="mb-1 block text-xs">Cotizacion BSP (ARS/USD)</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={extraForm.fx_rate}
                    onChange={(e) =>
                      setExtraForm((prev) => ({
                        ...prev,
                        fx_rate: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                  <span className="mt-1 block text-[11px] text-sky-950/50 dark:text-white/50">
                    {bspLoading
                      ? "Cargando BSP..."
                      : bspRate
                        ? `BSP ${bspRate}${bspDate ? ` (${bspDate})` : ""}`
                      : "BSP no disponible."}
                  </span>
                </label>
              )}

              <div className="grid gap-3 md:grid-cols-1">
                <label className="block">
                  <span className="mb-1 block text-xs">Fecha pago</span>
                  <input
                    type="date"
                    value={extraForm.paid_at}
                    onChange={(e) =>
                      setExtraForm((prev) => ({
                        ...prev,
                        paid_at: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/50 px-3 py-2 text-sm outline-none dark:bg-white/10 dark:text-white"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2">
                {editingExtraChargeId && (
                  <button
                    type="button"
                    onClick={resetExtraForm}
                    className="rounded-full bg-white/0 px-4 py-2 text-xs text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={extraSaving}
                  className="rounded-full bg-sky-100 px-4 py-2 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
                >
                  {extraSaving
                    ? "Guardando..."
                    : editingExtraChargeId
                      ? "Guardar extra"
                      : "Crear extra"}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/10 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-900">
                  6
                </div>
                <div>
                  <h4 className="text-base font-medium">Cobros extra</h4>
                  <p className="text-xs text-sky-950/60 dark:text-white/60">
                    Lista de cobros unicos registrados.
                  </p>
                </div>
              </div>
            </div>

            {chargesLoading ? (
              <p className="text-sm text-sky-950/60 dark:text-white/60">
                Cargando extras...
              </p>
            ) : extraCharges.length === 0 ? (
              <p className="text-sm text-sky-950/60 dark:text-white/60">
                Todavia no hay cobros extra.
              </p>
            ) : (
              <div className="space-y-3">
                {extraCharges.map((charge) => (
                  <div
                    key={charge.id_charge}
                    className="space-y-2 rounded-xl border border-white/10 bg-white/30 p-3 text-xs dark:bg-white/10"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        {charge.label || "Cobro extra"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${chargeStatusBadgeClass(
                          charge.status,
                        )}`}
                      >
                        {chargeStatusLabel(charge.status)}
                      </span>
                    </div>
                    <div className="text-sky-950/70 dark:text-white/70">
                      Total facturado: {formatMoney(charge.total_usd)}
                    </div>
                    {charge.paid_amount != null && (
                      <div className="text-sky-950/60 dark:text-white/60">
                        Cobrado:{" "}
                        {formatPaidAmount(
                          Number(charge.paid_amount),
                          charge.paid_currency,
                        )}
                        {charge.fx_rate
                          ? ` • Estimado USD ${(
                              Number(charge.paid_amount) /
                              Number(charge.fx_rate)
                            ).toFixed(2)})`
                          : ""}
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => startEditExtraCharge(charge)}
                        className="rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCharge(charge.id_charge)}
                        className="rounded-full bg-red-600/90 px-3 py-1 text-xs text-red-50 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
