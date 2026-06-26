// src/components/groups/billing/GroupInvoiceForm.tsx
"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import Spinner from "@/components/Spinner";
import { Client, Service } from "@/types";
import ClientPicker from "@/components/clients/ClientPicker";
import { authFetch } from "@/utils/authFetch";
import { toast } from "react-toastify";
import {
  computeManualTotals,
  splitManualTotalsByShares,
  type ManualTotalsInput,
} from "@/services/afip/manualTotals";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";

const Section = ({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) => (
  <section className="rounded-2xl border border-sky-300/70 bg-white p-4 dark:border-sky-600/30 dark:bg-sky-950/10">
    <div className="mb-3">
      <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      {desc && (
        <p className="mt-1 text-xs font-light text-slate-600 dark:text-slate-400">
          {desc}
        </p>
      )}
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
  </section>
);

const Field = ({
  id,
  label,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) => (
  <div className="space-y-1">
    <label
      htmlFor={id}
      className="ml-1 block text-sm font-medium text-slate-900 dark:text-slate-100"
    >
      {label} {required && <span className="text-rose-600">*</span>}
    </label>
    {children}
    {hint && (
      <p className="ml-1 text-xs text-slate-600 dark:text-slate-400">{hint}</p>
    )}
  </div>
);

const pillBase = "rounded-full px-3 py-1 text-xs font-medium transition-colors";
const pillNeutral =
  "border border-sky-300/70 bg-white text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300";
const pillOk = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";

const inputBase =
  "w-full rounded-2xl border border-slate-300/90 bg-white p-2 px-3 text-slate-900 shadow-sm shadow-slate-900/10 outline-none placeholder:font-light dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-100";

const toMoney = (value: number) => Number(value.toFixed(2));

const parseDistributionNumber = (value: string | number | undefined) => {
  const parsed = Number(
    String(value ?? "")
      .trim()
      .replace(",", "."),
  );
  return Number.isFinite(parsed) ? parsed : 0;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatDistributionNumber = (value: number) =>
  String(Number(value.toFixed(2)));

const formatAgencyNumber = (value: number | null | undefined): string => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  return "Sin Nº";
};

function splitAmountByShares(value: number, shares: number[]): number[] {
  if (shares.length <= 1) return [toMoney(value)];
  const out = shares.map((share) => toMoney(value * share));
  const sum = toMoney(out.reduce((acc, n) => acc + n, 0));
  const diff = toMoney(value - sum);
  if (Math.abs(diff) >= 0.01) {
    out[out.length - 1] = toMoney(out[out.length - 1] + diff);
  }
  return out;
}

type AfipPreviewBreakdown = {
  total: number;
  neto: number;
  ivaTotal: number;
  base21: number;
  iva21: number;
  base10_5: number;
  iva10_5: number;
  exempt: number;
};

type AfipPreviewPaxRow = {
  idx: number;
  clientId: number;
  share: number;
  breakdown: AfipPreviewBreakdown;
};

type AfipPreviewCurrencyGroup = {
  currency: string;
  breakdown: AfipPreviewBreakdown;
  pax: AfipPreviewPaxRow[];
};

type ServiceTotalsForPreview = {
  sale_price: number;
  taxableBase21: number;
  commission21: number;
  tax_21: number;
  vatOnCommission21: number;
  taxableBase10_5: number;
  commission10_5: number;
  tax_105: number;
  vatOnCommission10_5: number;
  taxableCardInterest: number;
  vatOnCardInterest: number;
};

const emptyServiceTotalsForPreview = (): ServiceTotalsForPreview => ({
  sale_price: 0,
  taxableBase21: 0,
  commission21: 0,
  tax_21: 0,
  vatOnCommission21: 0,
  taxableBase10_5: 0,
  commission10_5: 0,
  tax_105: 0,
  vatOnCommission10_5: 0,
  taxableCardInterest: 0,
  vatOnCardInterest: 0,
});

const toDisplayCurrency = (currency?: string) => {
  const normalized = String(currency || "ARS").toUpperCase();
  return normalized === "PES" ? "ARS" : normalized;
};

const formatMoneyByCurrency = (value: number, currency?: string) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: toDisplayCurrency(currency),
    minimumFractionDigits: 2,
  }).format(value);

function buildAfipBreakdownFromServiceTotals(
  totals: ServiceTotalsForPreview,
): AfipPreviewBreakdown {
  const saleTotal = toMoney(totals.sale_price);
  const interestBase = toMoney(totals.taxableCardInterest);
  const interestVat = toMoney(totals.vatOnCardInterest);
  const total = toMoney(saleTotal + interestBase + interestVat);

  const base21 = toMoney(
    totals.taxableBase21 + totals.commission21 + interestBase,
  );
  const iva21 = toMoney(totals.tax_21 + totals.vatOnCommission21 + interestVat);
  const base10_5 = toMoney(totals.taxableBase10_5 + totals.commission10_5);
  const iva10_5 = toMoney(totals.tax_105 + totals.vatOnCommission10_5);
  const ivaTotal = toMoney(iva21 + iva10_5);
  const neto = toMoney(total - ivaTotal);

  const totalBase = toMoney(base21 + base10_5);
  const diff = toMoney(neto - totalBase);
  const exempt = Math.abs(diff) > 0.01 ? diff : 0;

  return {
    total,
    neto,
    ivaTotal,
    base21,
    iva21,
    base10_5,
    iva10_5,
    exempt,
  };
}

function buildAfipBreakdownFromServices(services: Service[]): AfipPreviewBreakdown {
  const totals = services.reduce<ServiceTotalsForPreview>(
    (acc, svc) => {
      acc.sale_price = toMoney(acc.sale_price + (svc.sale_price ?? 0));
      acc.taxableBase21 = toMoney(
        acc.taxableBase21 + (svc.taxableBase21 ?? 0),
      );
      acc.commission21 = toMoney(acc.commission21 + (svc.commission21 ?? 0));
      acc.tax_21 = toMoney(acc.tax_21 + (svc.tax_21 ?? 0));
      acc.vatOnCommission21 = toMoney(
        acc.vatOnCommission21 + (svc.vatOnCommission21 ?? 0),
      );
      acc.taxableBase10_5 = toMoney(
        acc.taxableBase10_5 + (svc.taxableBase10_5 ?? 0),
      );
      acc.commission10_5 = toMoney(
        acc.commission10_5 + (svc.commission10_5 ?? 0),
      );
      acc.tax_105 = toMoney(acc.tax_105 + (svc.tax_105 ?? 0));
      acc.vatOnCommission10_5 = toMoney(
        acc.vatOnCommission10_5 + (svc.vatOnCommission10_5 ?? 0),
      );
      acc.taxableCardInterest = toMoney(
        acc.taxableCardInterest + (svc.taxableCardInterest ?? 0),
      );
      acc.vatOnCardInterest = toMoney(
        acc.vatOnCardInterest + (svc.vatOnCardInterest ?? 0),
      );
      return acc;
    },
    emptyServiceTotalsForPreview(),
  );

  return buildAfipBreakdownFromServiceTotals(totals);
}

function buildAfipBreakdownFromManualResult(
  result: {
    impTotal: number;
    impNeto: number;
    impIVA: number;
    ivaEntries: Array<{ Id: number; BaseImp: number; Importe: number }>;
  },
): AfipPreviewBreakdown {
  const entry21 = result.ivaEntries.find((entry) => entry.Id === 5);
  const entry10 = result.ivaEntries.find((entry) => entry.Id === 4);
  const exempt = toMoney(
    result.ivaEntries
      .filter((entry) => entry.Id === 3)
      .reduce((sum, entry) => sum + Number(entry.BaseImp || 0), 0),
  );

  return {
    total: toMoney(result.impTotal),
    neto: toMoney(result.impNeto),
    ivaTotal: toMoney(result.impIVA),
    base21: toMoney(entry21?.BaseImp ?? 0),
    iva21: toMoney(entry21?.Importe ?? 0),
    base10_5: toMoney(entry10?.BaseImp ?? 0),
    iva10_5: toMoney(entry10?.Importe ?? 0),
    exempt,
  };
}

function splitAfipBreakdownByShares(
  breakdown: AfipPreviewBreakdown,
  shares: number[],
): AfipPreviewBreakdown[] {
  const total = splitAmountByShares(breakdown.total, shares);
  const neto = splitAmountByShares(breakdown.neto, shares);
  const ivaTotal = splitAmountByShares(breakdown.ivaTotal, shares);
  const base21 = splitAmountByShares(breakdown.base21, shares);
  const iva21 = splitAmountByShares(breakdown.iva21, shares);
  const base10_5 = splitAmountByShares(breakdown.base10_5, shares);
  const iva10_5 = splitAmountByShares(breakdown.iva10_5, shares);
  const exempt = splitAmountByShares(breakdown.exempt, shares);

  return shares.map((_, idx) => ({
    total: total[idx] ?? 0,
    neto: neto[idx] ?? 0,
    ivaTotal: ivaTotal[idx] ?? 0,
    base21: base21[idx] ?? 0,
    iva21: iva21[idx] ?? 0,
    base10_5: base10_5[idx] ?? 0,
    iva10_5: iva10_5[idx] ?? 0,
    exempt: exempt[idx] ?? 0,
  }));
}

export type PaxDocType = "" | "DNI" | "CUIT";

export type PaxLookupData = {
  dni?: string | null;
  cuit?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  address?: string | null;
  locality?: string | null;
  postal_code?: string | null;
  commercial_address?: string | null;
};

export type InvoiceCustomItemForm = {
  id: string;
  description: string;
  taxCategory: "21" | "10_5" | "EXEMPT";
  amount: string;
};

export type InvoiceDistributionMode = "percentage" | "amount";

export type InvoiceFormData = {
  tipoFactura: string;
  clientIds: string[]; // ids de pasajeros como string
  services: string[]; // ids de servicios como string
  exchangeRate?: string;
  description21: string[];
  description10_5: string[];
  descriptionNonComputable: string[];
  invoiceDate?: string;
  manualTotalsEnabled: boolean;
  manualTotal: string;
  manualBase21: string;
  manualIva21: string;
  manualBase10_5: string;
  manualIva10_5: string;
  manualExempt: string;
  distributionMode: InvoiceDistributionMode;
  distributionValues: string[];
  paxDocTypes: PaxDocType[];
  paxDocNumbers: string[];
  paxLookupData: Array<PaxLookupData | null>;
  paxLookupPersist: boolean[];
  customItems: InvoiceCustomItemForm[];
};

interface InvoiceFormProps {
  formData: InvoiceFormData;
  availableServices: Service[];
  handleChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => void;
  handleSubmit: (e: React.FormEvent) => void;
  isFormVisible: boolean;
  setIsFormVisible: React.Dispatch<React.SetStateAction<boolean>>;
  updateFormData: (
    key: keyof InvoiceFormData,
    value: InvoiceFormData[keyof InvoiceFormData],
  ) => void;
  isSubmitting: boolean;
  token?: string | null;
  collapsible?: boolean;
  containerClassName?: string;
  lockClientSelection?: boolean;
  lockedClientLabel?: string | null;
}

export default function GroupInvoiceForm({
  formData,
  availableServices,
  handleChange,
  handleSubmit,
  isFormVisible,
  setIsFormVisible,
  updateFormData,
  isSubmitting,
  token,
  collapsible = true,
  containerClassName = "",
  lockClientSelection = false,
  lockedClientLabel = null,
}: InvoiceFormProps) {
  const showForm = collapsible ? isFormVisible : true;

  useEffect(() => {
    if (!formData.tipoFactura) {
      updateFormData("tipoFactura", "6");
    }
  }, [formData.tipoFactura, updateFormData]);

  /* ========= Cotización (lazy con cache TTL) ========= */
  const [fetchedExchangeRate, setFetchedExchangeRate] = useState<string>("");
  const [rateStatus, setRateStatus] = useState<
    "idle" | "loading" | "ok" | "error"
  >("idle");

  // Cache en memoria para evitar re-fetch por 5 min sin depender de estado
  const rateCacheRef = useRef<{ ts: number; value: string } | null>(null);
  const itemsSeededRef = useRef(false);

  useEffect(() => {
    if (!token || !isFormVisible) return; // solo cuando se abre el form
    if (formData.exchangeRate && formData.exchangeRate.trim() !== "") return; // si el usuario la completó manualmente, no fetchear

    const TTL_MS = 5 * 60 * 1000;
    const now = Date.now();

    // Cache hit dentro del TTL
    const cached = rateCacheRef.current;
    if (cached && now - cached.ts < TTL_MS) {
      setFetchedExchangeRate(cached.value);
      setRateStatus("ok");
      return;
    }

    const ac = new AbortController();
    (async () => {
      try {
        setRateStatus("loading");
        const res = await authFetch(
          `/api/exchangeRate?ts=${Date.now()}`,
          { cache: "no-store", signal: ac.signal },
          token || undefined,
        );
        const raw = await res.text();
        if (!res.ok) throw new Error("Exchange rate fetch failed");
        const data = JSON.parse(raw);

        if (data?.success && data.rate != null) {
          const val = String(data.rate);
          setFetchedExchangeRate(val);
          setRateStatus("ok");
          rateCacheRef.current = { ts: now, value: val };
        } else {
          setFetchedExchangeRate("");
          setRateStatus("error");
          rateCacheRef.current = null;
        }
      } catch {
        if (!ac.signal.aborted) {
          setFetchedExchangeRate("");
          setRateStatus("error");
          rateCacheRef.current = null;
        }
      }
    })();

    return () => ac.abort();
  }, [token, isFormVisible, formData.exchangeRate]);

  /* ========= Helpers ========= */
  const arraysEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const boolArraysEqual = (a: boolean[], b: boolean[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  const resizeStringArray = (arr: string[] | undefined, count: number) => {
    const copy = [...(arr || [])];
    while (copy.length < count) copy.push("");
    copy.length = count;
    return copy;
  };

  const resizeBoolArray = (arr: boolean[] | undefined, count: number) => {
    const copy = [...(arr || [])];
    while (copy.length < count) copy.push(false);
    copy.length = count;
    return copy;
  };

  /* ========= Servicios (picker múltiple) ========= */
  const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>(
    () =>
      formData.services
        ?.map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n)) || [],
  );

  // Reflejar cambios externos de formData.services en el estado local
  useEffect(() => {
    const nums =
      formData.services
        ?.map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n)) || [];
    setSelectedServiceIds((prev) =>
      prev.length === nums.length && prev.every((v, i) => v === nums[i])
        ? prev
        : nums,
    );
  }, [formData.services]);

  // Sincronizar estado local -> formData (post-render, con guardas)
  useEffect(() => {
    const next = selectedServiceIds.map(String);
    const curr = formData.services || [];
    if (!arraysEqual(next, curr)) {
      updateFormData("services", next);
    }
  }, [selectedServiceIds, formData.services, updateFormData]);

  const selectedServices = useMemo(
    () =>
      availableServices.filter((s) =>
        selectedServiceIds.includes(s.id_service),
      ),
    [availableServices, selectedServiceIds],
  );

  const toggleService = (svc: Service) => {
    setSelectedServiceIds((prev) =>
      prev.includes(svc.id_service)
        ? prev.filter((id) => id !== svc.id_service)
        : [...prev, svc.id_service],
    );
  };

  const [lookupStatus, setLookupStatus] = useState<
    Array<{ state: "idle" | "loading" | "ok" | "error"; message?: string }>
  >([]);

  /* ========= Pasajeros (picker múltiple) ========= */
  const [clientCount, setClientCount] = useState<number>(
    Math.max(1, formData.clientIds?.length || 1),
  );

  useEffect(() => {
    if (!lockClientSelection) return;
    if (clientCount !== 1) {
      setClientCount(1);
    }
  }, [clientCount, lockClientSelection]);

  // Mantener formData.clientIds con el tamaño elegido
  useEffect(() => {
    const arr = [...(formData.clientIds || [])];
    while (arr.length < clientCount) arr.push("");
    arr.length = clientCount;
    if (!arraysEqual(arr, formData.clientIds || [])) {
      updateFormData("clientIds", arr);
    }
  }, [clientCount, formData.clientIds, updateFormData]);

  useEffect(() => {
    const nextDistribution = resizeStringArray(
      formData.distributionValues,
      clientCount,
    );
    if (!arraysEqual(nextDistribution, formData.distributionValues || [])) {
      updateFormData("distributionValues", nextDistribution);
    }

    const nextDocTypes = resizeStringArray(formData.paxDocTypes, clientCount);
    if (!arraysEqual(nextDocTypes, formData.paxDocTypes || [])) {
      updateFormData("paxDocTypes", nextDocTypes as PaxDocType[]);
    }

    const nextDocNumbers = resizeStringArray(
      formData.paxDocNumbers,
      clientCount,
    );
    if (!arraysEqual(nextDocNumbers, formData.paxDocNumbers || [])) {
      updateFormData("paxDocNumbers", nextDocNumbers);
    }

    const nextPersist = resizeBoolArray(formData.paxLookupPersist, clientCount);
    if (!boolArraysEqual(nextPersist, formData.paxLookupPersist || [])) {
      updateFormData("paxLookupPersist", nextPersist);
    }

    const lookupArr = [...(formData.paxLookupData || [])];
    while (lookupArr.length < clientCount) lookupArr.push(null);
    lookupArr.length = clientCount;
    const hasLookupChange =
      lookupArr.length !== (formData.paxLookupData || []).length ||
      lookupArr.some((v, i) => v !== (formData.paxLookupData || [])[i]);
    if (hasLookupChange) {
      updateFormData("paxLookupData", lookupArr);
    }

    setLookupStatus((prev) => {
      const copy = [...prev];
      while (copy.length < clientCount) copy.push({ state: "idle" });
      copy.length = clientCount;
      return copy;
    });
  }, [
    clientCount,
    formData.distributionValues,
    formData.paxDocTypes,
    formData.paxDocNumbers,
    formData.paxLookupPersist,
    formData.paxLookupData,
    updateFormData,
  ]);

  const setClientAt = (idx: number, c: Client | null) => {
    const arr = [...(formData.clientIds || [])];
    arr[idx] = c ? String(c.id_client) : "";
    updateFormData("clientIds", arr);

    if (c) {
      const docTypes = resizeStringArray(formData.paxDocTypes, clientCount);
      const docNumbers = resizeStringArray(formData.paxDocNumbers, clientCount);
      if (!docNumbers[idx]) {
        if (c.tax_id) {
          docTypes[idx] = "CUIT";
          docNumbers[idx] = String(c.tax_id);
        } else if (c.dni_number) {
          docTypes[idx] = "DNI";
          docNumbers[idx] = String(c.dni_number);
        }
      }
      updateFormData("paxDocTypes", docTypes as PaxDocType[]);
      updateFormData("paxDocNumbers", docNumbers);
    } else {
      setDocTypeAt(idx, "");
      setDocNumberAt(idx, "");
      setLookupDataAt(idx, null);
      setPersistAt(idx, false);
      setLookupStatusAt(idx, { state: "idle" });
    }
  };

  const excludeForIndex = (idx: number) =>
    (formData.clientIds || [])
      .filter((_, i) => i !== idx)
      .filter(Boolean)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n)) as number[];

  /* ========= Fecha mínima/máxima ========= */
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dMin = new Date(today);
  dMin.setDate(dMin.getDate() - 8);
  const minDate = `${dMin.getFullYear()}-${pad(dMin.getMonth() + 1)}-${pad(dMin.getDate())}`;
  const dMax = new Date(today);
  dMax.setDate(dMax.getDate() + 8);
  const maxDate = `${dMax.getFullYear()}-${pad(dMax.getMonth() + 1)}-${pad(dMax.getDate())}`;

  const invoiceTypeLabel =
    formData.tipoFactura === "1"
      ? "Factura A"
      : formData.tipoFactura === "6"
        ? "Factura B"
        : "";

  const selectedClientsCount = useMemo(
    () =>
      (formData.clientIds || []).filter((v) => String(v || "").trim()).length,
    [formData.clientIds],
  );

  const selectedServicesTotal = useMemo(
    () =>
      selectedServices.reduce(
        (sum, svc) =>
          sum +
          (svc.sale_price ?? 0) +
          (svc.taxableCardInterest ?? 0) +
          (svc.vatOnCardInterest ?? 0),
        0,
      ),
    [selectedServices],
  );

  const manualDistributionTotal = useMemo(() => {
    if (!formData.manualTotalsEnabled) return null;
    const parse = (value?: string) => {
      if (!value) return undefined;
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const num = Number(trimmed.replace(",", "."));
      return Number.isFinite(num) ? num : undefined;
    };
    const validation = computeManualTotals({
      total: parse(formData.manualTotal),
      base21: parse(formData.manualBase21),
      iva21: parse(formData.manualIva21),
      base10_5: parse(formData.manualBase10_5),
      iva10_5: parse(formData.manualIva10_5),
      exempt: parse(formData.manualExempt),
    });
    if (!validation.ok) return null;
    return Number(validation.result.impTotal.toFixed(2));
  }, [
    formData.manualTotalsEnabled,
    formData.manualTotal,
    formData.manualBase21,
    formData.manualIva21,
    formData.manualBase10_5,
    formData.manualIva10_5,
    formData.manualExempt,
  ]);

  const distributionReferenceTotal = useMemo(
    () =>
      toMoney(Math.max(0, manualDistributionTotal ?? selectedServicesTotal)),
    [manualDistributionTotal, selectedServicesTotal],
  );

  const parsedDistributionValues = useMemo(
    () =>
      resizeStringArray(formData.distributionValues, clientCount).map((raw) =>
        Math.max(0, parseDistributionNumber(raw)),
      ),
    [formData.distributionValues, clientCount],
  );

  const distributionAssigned = useMemo(
    () =>
      Number(
        parsedDistributionValues.reduce((acc, n) => acc + n, 0).toFixed(2),
      ),
    [parsedDistributionValues],
  );

  const distributionRemaining = useMemo(() => {
    const target =
      formData.distributionMode === "percentage"
        ? 100
        : distributionReferenceTotal;
    return Number((target - distributionAssigned).toFixed(2));
  }, [
    formData.distributionMode,
    distributionReferenceTotal,
    distributionAssigned,
  ]);

  useEffect(() => {
    if (clientCount <= 0) return;
    const values = resizeStringArray(formData.distributionValues, clientCount);
    const hasAny = values.some((v) => String(v).trim().length > 0);
    if (hasAny) return;

    if (formData.distributionMode === "amount") {
      const equal = splitAmountByShares(
        distributionReferenceTotal,
        Array.from({ length: clientCount }, () => 1),
      ).map((v) => formatDistributionNumber(v));
      updateFormData("distributionValues", equal);
      return;
    }

    const raw = 100 / clientCount;
    const base = Number(raw.toFixed(2));
    const next = Array.from({ length: clientCount }, () => base);
    const sum = Number(next.reduce((acc, n) => acc + n, 0).toFixed(2));
    const diff = Number((100 - sum).toFixed(2));
    next[next.length - 1] = Number((next[next.length - 1] + diff).toFixed(2));
    updateFormData(
      "distributionValues",
      next.map((v) => formatDistributionNumber(v)),
    );
  }, [
    clientCount,
    formData.distributionMode,
    formData.distributionValues,
    distributionReferenceTotal,
    updateFormData,
  ]);

  const distributionValidation = useMemo(() => {
    const values = parsedDistributionValues;
    const hasInvalid = values.some((v) => !Number.isFinite(v) || v <= 0);
    if (hasInvalid) {
      return { ok: false as const, error: "Completá la distribución por pax." };
    }
    const sum = Number(values.reduce((acc, n) => acc + n, 0).toFixed(2));
    if (!Number.isFinite(sum) || sum <= 0) {
      return {
        ok: false as const,
        error: "La distribución por pax debe ser mayor a cero.",
      };
    }

    if (formData.distributionMode === "percentage") {
      if (sum > 100.01) {
        return {
          ok: false as const,
          error: "La suma de porcentajes no puede superar 100%.",
        };
      }
      const diff = Number((100 - sum).toFixed(2));
      if (Math.abs(diff) > 0.01) {
        return {
          ok: false as const,
          error:
            diff > 0
              ? `Falta asignar ${diff.toFixed(2)}% entre los pax.`
              : `Excediste ${Math.abs(diff).toFixed(2)}% en la distribución.`,
        };
      }
      return {
        ok: true as const,
        shares: values.map((v) => v / 100),
        values,
        sum,
      };
    }

    if (distributionReferenceTotal <= 0) {
      return {
        ok: false as const,
        error: "Seleccioná servicios para distribuir montos por pax.",
      };
    }
    const amountDiff = Number((distributionReferenceTotal - sum).toFixed(2));
    if (amountDiff < -0.01) {
      return {
        ok: false as const,
        error: `El total asignado supera el total de referencia (${distributionReferenceTotal.toFixed(2)}).`,
      };
    }
    if (amountDiff > 0.01) {
      return {
        ok: false as const,
        error: `Falta asignar ${amountDiff.toFixed(2)} para completar la distribución.`,
      };
    }

    const shares = values.map((v) => v / sum);
    return {
      ok: true as const,
      shares,
      values,
      sum,
    };
  }, [
    parsedDistributionValues,
    formData.distributionMode,
    distributionReferenceTotal,
  ]);

  const perClientAmountsPreview = useMemo(() => {
    if (!distributionValidation.ok) return [];
    return splitAmountByShares(
      distributionReferenceTotal,
      distributionValidation.shares,
    );
  }, [distributionValidation, distributionReferenceTotal]);

  const customItems = formData.customItems || [];

  useEffect(() => {
    if (customItems.length > 0) {
      itemsSeededRef.current = true;
      return;
    }
    if (itemsSeededRef.current || selectedServices.length === 0) return;
    const defaults: InvoiceCustomItemForm[] = selectedServices.map((svc) => ({
      id: `svc-${svc.id_service}`,
      description:
        svc.description ||
        `${svc.type}${svc.destination ? ` · ${svc.destination}` : ""}`,
      taxCategory:
        (svc?.vatOnCommission21 ?? 0) > 0
          ? "21"
          : (svc?.vatOnCommission10_5 ?? 0) > 0
            ? "10_5"
            : "EXEMPT",
      amount: "",
    }));
    itemsSeededRef.current = true;
    updateFormData("customItems", defaults);
  }, [customItems.length, selectedServices, updateFormData]);

  const formatDateLabel = (raw?: string) => {
    if (!raw) return "";
    return formatDateInBuenosAires(raw);
  };

  const headerPills = useMemo(() => {
    const pills: JSX.Element[] = [];
    if (invoiceTypeLabel) {
      pills.push(
        <span key="type" className={`${pillBase} ${pillOk}`}>
          {invoiceTypeLabel}
        </span>,
      );
    }
    if (selectedClientsCount > 0) {
      pills.push(
        <span key="clients" className={`${pillBase} ${pillNeutral}`}>
          Pasajeros: {selectedClientsCount}
        </span>,
      );
    }
    if (selectedServiceIds.length > 0) {
      pills.push(
        <span key="services" className={`${pillBase} ${pillNeutral}`}>
          Servicios: {selectedServiceIds.length}
        </span>,
      );
    }
    if (formData.invoiceDate) {
      pills.push(
        <span key="date" className={`${pillBase} ${pillNeutral}`}>
          {formatDateLabel(formData.invoiceDate)}
        </span>,
      );
    }
    if (formData.exchangeRate?.trim()) {
      pills.push(
        <span key="rate" className={`${pillBase} ${pillNeutral}`}>
          TC {formData.exchangeRate}
        </span>,
      );
    }
    return pills;
  }, [
    invoiceTypeLabel,
    selectedClientsCount,
    selectedServiceIds.length,
    formData.invoiceDate,
    formData.exchangeRate,
  ]);

  const selectedCurrencies = useMemo(() => {
    const set = new Set<string>();
    selectedServices.forEach((svc) => {
      const cur = String(svc.currency || "ARS").toUpperCase();
      set.add(cur);
    });
    return set;
  }, [selectedServices]);

  const hasMultipleCurrencies = selectedCurrencies.size > 1;
  const manualEnabled = formData.manualTotalsEnabled;
  const manualToggleDisabled = hasMultipleCurrencies;

  useEffect(() => {
    if (manualEnabled && manualToggleDisabled) {
      updateFormData("manualTotalsEnabled", false);
    }
  }, [manualEnabled, manualToggleDisabled, updateFormData]);

  const parseManualValue = (value?: string) => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const num = Number(trimmed.replace(",", "."));
    return Number.isFinite(num) ? num : undefined;
  };

  const manualTotalsDraft = useMemo(
    () => ({
      total: parseManualValue(formData.manualTotal),
      base21: parseManualValue(formData.manualBase21),
      iva21: parseManualValue(formData.manualIva21),
      base10_5: parseManualValue(formData.manualBase10_5),
      iva10_5: parseManualValue(formData.manualIva10_5),
      exempt: parseManualValue(formData.manualExempt),
    }),
    [
      formData.manualTotal,
      formData.manualBase21,
      formData.manualIva21,
      formData.manualBase10_5,
      formData.manualIva10_5,
      formData.manualExempt,
    ],
  );

  const manualInputTouched = useMemo(
    () => Object.values(manualTotalsDraft).some((v) => typeof v === "number"),
    [manualTotalsDraft],
  );

  const manualValidation = useMemo(() => {
    if (!manualEnabled || !manualInputTouched) return null;
    return computeManualTotals(manualTotalsDraft);
  }, [manualEnabled, manualInputTouched, manualTotalsDraft]);

  const manualValidationError = useMemo(() => {
    if (!manualValidation || manualValidation.ok) return null;
    return manualValidation.error;
  }, [manualValidation]);

  const manualPreview = useMemo(() => {
    const base21 = manualTotalsDraft.base21 ?? 0;
    const iva21 = manualTotalsDraft.iva21 ?? 0;
    const base10 = manualTotalsDraft.base10_5 ?? 0;
    const iva10 = manualTotalsDraft.iva10_5 ?? 0;
    const exempt = manualTotalsDraft.exempt ?? 0;
    const totalInput = manualTotalsDraft.total ?? 0;

    const ivaSum = Number((iva21 + iva10).toFixed(2));
    const taxableBase = Number((base21 + base10).toFixed(2));
    const baseSum = Number((base21 + base10 + exempt).toFixed(2));
    const totalFromParts = Number((baseSum + ivaSum).toFixed(2));
    const total = totalInput > 0 ? totalInput : totalFromParts;
    const neto = Number((total - ivaSum).toFixed(2));
    const onlyTotalLoaded =
      totalInput > 0 && taxableBase <= 0 && ivaSum <= 0 && exempt <= 0;

    return {
      total,
      ivaSum,
      neto,
      taxableBase,
      onlyTotalLoaded,
    };
  }, [manualTotalsDraft]);

  const manualCurrency = selectedServices[0]?.currency || "ARS";
  const manualFormatter = useMemo(
    () =>
      new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: manualCurrency === "PES" ? "ARS" : manualCurrency,
        minimumFractionDigits: 2,
      }),
    [manualCurrency],
  );

  const selectedClientEntries = useMemo(
    () =>
      resizeStringArray(formData.clientIds, clientCount)
        .map((raw, idx) => ({
          idx,
          clientId: Number(raw),
          raw: String(raw ?? "").trim(),
        }))
        .filter(
          (entry) =>
            entry.raw.length > 0 &&
            Number.isFinite(entry.clientId) &&
            entry.clientId > 0,
        ),
    [formData.clientIds, clientCount],
  );

  const invoicePreviewShares = useMemo(() => {
    if (selectedClientEntries.length === 0) {
      return {
        ok: false as const,
        error: "Seleccioná al menos un pax válido.",
        entries: [] as Array<{ idx: number; clientId: number; share: number }>,
      };
    }

    if (selectedClientEntries.length === 1) {
      return {
        ok: true as const,
        entries: [
          {
            idx: selectedClientEntries[0].idx,
            clientId: selectedClientEntries[0].clientId,
            share: 1,
          },
        ],
      };
    }

    const distributionValues = selectedClientEntries.map(
      (entry) => parsedDistributionValues[entry.idx] ?? 0,
    );

    if (
      distributionValues.some((value) => !Number.isFinite(value) || value <= 0)
    ) {
      return {
        ok: false as const,
        error: "Completá la distribución por pax con valores válidos.",
        entries: [] as Array<{ idx: number; clientId: number; share: number }>,
      };
    }

    const distributionSum = Number(
      distributionValues.reduce((acc, n) => acc + n, 0).toFixed(2),
    );
    if (!Number.isFinite(distributionSum) || distributionSum <= 0) {
      return {
        ok: false as const,
        error: "La distribución por pax es inválida.",
        entries: [] as Array<{ idx: number; clientId: number; share: number }>,
      };
    }

    if (formData.distributionMode === "percentage") {
      if (distributionSum > 100.01) {
        return {
          ok: false as const,
          error: "La suma de porcentajes no puede superar 100%.",
          entries: [] as Array<{
            idx: number;
            clientId: number;
            share: number;
          }>,
        };
      }
      const diff = Number((100 - distributionSum).toFixed(2));
      if (Math.abs(diff) > 0.01) {
        return {
          ok: false as const,
          error:
            diff > 0
              ? `Falta asignar ${diff.toFixed(2)}% entre los pax.`
              : `Excediste ${Math.abs(diff).toFixed(2)}% en la distribución.`,
          entries: [] as Array<{
            idx: number;
            clientId: number;
            share: number;
          }>,
        };
      }
    } else {
      if (distributionReferenceTotal <= 0) {
        return {
          ok: false as const,
          error: "Seleccioná servicios válidos para distribuir montos.",
          entries: [] as Array<{
            idx: number;
            clientId: number;
            share: number;
          }>,
        };
      }
      const diff = Number(
        (distributionReferenceTotal - distributionSum).toFixed(2),
      );
      if (diff < -0.01) {
        return {
          ok: false as const,
          error: "El total asignado supera el total de referencia.",
          entries: [] as Array<{
            idx: number;
            clientId: number;
            share: number;
          }>,
        };
      }
      if (diff > 0.01) {
        return {
          ok: false as const,
          error: `Falta asignar ${diff.toFixed(2)} para completar.`,
          entries: [] as Array<{
            idx: number;
            clientId: number;
            share: number;
          }>,
        };
      }
    }

    const shares = distributionValues.map((value) => value / distributionSum);
    if (shares.length > 0) {
      const currentSum = shares.reduce((acc, n) => acc + n, 0);
      const diff = Number((1 - currentSum).toFixed(10));
      shares[shares.length - 1] = Number(
        (shares[shares.length - 1] + diff).toFixed(10),
      );
    }

    return {
      ok: true as const,
      entries: selectedClientEntries.map((entry, idx) => ({
        idx: entry.idx,
        clientId: entry.clientId,
        share: shares[idx],
      })),
    };
  }, [
    selectedClientEntries,
    parsedDistributionValues,
    formData.distributionMode,
    distributionReferenceTotal,
  ]);

  const selectedServicesByCurrency = useMemo(() => {
    const grouped = new Map<string, Service[]>();
    selectedServices.forEach((svc) => {
      const currency = String(svc.currency || "ARS").toUpperCase();
      const current = grouped.get(currency) ?? [];
      current.push(svc);
      grouped.set(currency, current);
    });
    return Array.from(grouped.entries()).map(([currency, services]) => ({
      currency,
      services,
    }));
  }, [selectedServices]);

  const afipPreviewByCurrency = useMemo<AfipPreviewCurrencyGroup[]>(() => {
    if (selectedServices.length === 0) return [];

    const paxEntries = invoicePreviewShares.ok ? invoicePreviewShares.entries : [];

    if (manualEnabled) {
      if (!manualValidation || !manualValidation.ok) return [];

      const breakdown = buildAfipBreakdownFromManualResult(
        manualValidation.result,
      );
      const currency = String(selectedServices[0]?.currency || "ARS").toUpperCase();
      if (paxEntries.length <= 1) {
        return [
          {
            currency,
            breakdown,
            pax:
              paxEntries.length === 1
                ? [
                    {
                      idx: paxEntries[0].idx,
                      clientId: paxEntries[0].clientId,
                      share: 1,
                      breakdown,
                    },
                  ]
                : [],
          },
        ];
      }

      const shares = paxEntries.map((entry) => entry.share);
      const fallback = splitAfipBreakdownByShares(breakdown, shares);
      const manualTotalsInput: ManualTotalsInput = {
        total: manualTotalsDraft.total,
        base21: manualTotalsDraft.base21,
        iva21: manualTotalsDraft.iva21,
        base10_5: manualTotalsDraft.base10_5,
        iva10_5: manualTotalsDraft.iva10_5,
        exempt: manualTotalsDraft.exempt,
      };
      const splitManual = splitManualTotalsByShares(manualTotalsInput, shares);
      const pax = paxEntries.map((entry, idx) => {
        const validation = computeManualTotals(splitManual[idx] || {});
        return {
          idx: entry.idx,
          clientId: entry.clientId,
          share: entry.share,
          breakdown: validation.ok
            ? buildAfipBreakdownFromManualResult(validation.result)
            : fallback[idx],
        };
      });

      return [{ currency, breakdown, pax }];
    }

    return selectedServicesByCurrency.map(({ currency, services }) => {
      const breakdown = buildAfipBreakdownFromServices(services);
      if (paxEntries.length <= 1) {
        return {
          currency,
          breakdown,
          pax:
            paxEntries.length === 1
              ? [
                  {
                    idx: paxEntries[0].idx,
                    clientId: paxEntries[0].clientId,
                    share: 1,
                    breakdown,
                  },
                ]
              : [],
        };
      }

      const shares = paxEntries.map((entry) => entry.share);
      const perPaxTotals = paxEntries.map(() => emptyServiceTotalsForPreview());
      services.forEach((svc) => {
        const splitSalePrice = splitAmountByShares(svc.sale_price ?? 0, shares);
        const splitTaxableBase21 = splitAmountByShares(
          svc.taxableBase21 ?? 0,
          shares,
        );
        const splitCommission21 = splitAmountByShares(
          svc.commission21 ?? 0,
          shares,
        );
        const splitTax21 = splitAmountByShares(svc.tax_21 ?? 0, shares);
        const splitVatOnCommission21 = splitAmountByShares(
          svc.vatOnCommission21 ?? 0,
          shares,
        );
        const splitTaxableBase10_5 = splitAmountByShares(
          svc.taxableBase10_5 ?? 0,
          shares,
        );
        const splitCommission10_5 = splitAmountByShares(
          svc.commission10_5 ?? 0,
          shares,
        );
        const splitTax105 = splitAmountByShares(svc.tax_105 ?? 0, shares);
        const splitVatOnCommission10_5 = splitAmountByShares(
          svc.vatOnCommission10_5 ?? 0,
          shares,
        );
        const splitTaxableCardInterest = splitAmountByShares(
          svc.taxableCardInterest ?? 0,
          shares,
        );
        const splitVatOnCardInterest = splitAmountByShares(
          svc.vatOnCardInterest ?? 0,
          shares,
        );

        paxEntries.forEach((_, idx) => {
          const current = perPaxTotals[idx];
          current.sale_price = toMoney(
            current.sale_price + (splitSalePrice[idx] ?? 0),
          );
          current.taxableBase21 = toMoney(
            current.taxableBase21 + (splitTaxableBase21[idx] ?? 0),
          );
          current.commission21 = toMoney(
            current.commission21 + (splitCommission21[idx] ?? 0),
          );
          current.tax_21 = toMoney(current.tax_21 + (splitTax21[idx] ?? 0));
          current.vatOnCommission21 = toMoney(
            current.vatOnCommission21 + (splitVatOnCommission21[idx] ?? 0),
          );
          current.taxableBase10_5 = toMoney(
            current.taxableBase10_5 + (splitTaxableBase10_5[idx] ?? 0),
          );
          current.commission10_5 = toMoney(
            current.commission10_5 + (splitCommission10_5[idx] ?? 0),
          );
          current.tax_105 = toMoney(current.tax_105 + (splitTax105[idx] ?? 0));
          current.vatOnCommission10_5 = toMoney(
            current.vatOnCommission10_5 + (splitVatOnCommission10_5[idx] ?? 0),
          );
          current.taxableCardInterest = toMoney(
            current.taxableCardInterest + (splitTaxableCardInterest[idx] ?? 0),
          );
          current.vatOnCardInterest = toMoney(
            current.vatOnCardInterest + (splitVatOnCardInterest[idx] ?? 0),
          );
        });
      });

      return {
        currency,
        breakdown,
        pax: paxEntries.map((entry, idx) => ({
          idx: entry.idx,
          clientId: entry.clientId,
          share: entry.share,
          breakdown: buildAfipBreakdownFromServiceTotals(perPaxTotals[idx]),
        })),
      };
    });
  }, [
    selectedServices,
    selectedServicesByCurrency,
    invoicePreviewShares,
    manualEnabled,
    manualValidation,
    manualTotalsDraft,
  ]);

  const afipPreviewError = useMemo(() => {
    if (selectedServices.length === 0) {
      return "Seleccioná al menos un servicio para previsualizar la emisión.";
    }
    if (manualEnabled && !manualInputTouched) {
      return "Completá al menos un importe manual para previsualizar la emisión.";
    }
    if (manualEnabled && manualValidationError) {
      return manualValidationError;
    }
    return null;
  }, [
    selectedServices.length,
    manualEnabled,
    manualInputTouched,
    manualValidationError,
  ]);

  const setLookupStatusAt = (
    idx: number,
    next: { state: "idle" | "loading" | "ok" | "error"; message?: string },
  ) => {
    setLookupStatus((prev) => {
      const copy = [...prev];
      while (copy.length < clientCount) copy.push({ state: "idle" });
      copy[idx] = next;
      return copy;
    });
  };

  const setDocTypeAt = (idx: number, value: PaxDocType) => {
    const arr = resizeStringArray(formData.paxDocTypes, clientCount);
    arr[idx] = value;
    updateFormData("paxDocTypes", arr as PaxDocType[]);
  };

  const setDocNumberAt = (idx: number, value: string) => {
    const arr = resizeStringArray(formData.paxDocNumbers, clientCount);
    arr[idx] = value;
    updateFormData("paxDocNumbers", arr);
  };

  const setPersistAt = (idx: number, value: boolean) => {
    const arr = resizeBoolArray(formData.paxLookupPersist, clientCount);
    arr[idx] = value;
    updateFormData("paxLookupPersist", arr);
  };

  const setLookupDataAt = (idx: number, value: PaxLookupData | null) => {
    const arr = [...(formData.paxLookupData || [])];
    while (arr.length < clientCount) arr.push(null);
    arr[idx] = value;
    updateFormData("paxLookupData", arr);
  };

  const handleLookupAfip = async (idx: number) => {
    if (!token) {
      toast.error("Sesión inválida. Volvé a iniciar sesión.");
      return;
    }
    const clientIdRaw = formData.clientIds?.[idx];
    const clientId = clientIdRaw ? Number(clientIdRaw) : NaN;
    const documentType = (formData.paxDocTypes?.[idx] || "") as PaxDocType;
    const documentNumber = String(formData.paxDocNumbers?.[idx] || "").trim();
    if (!Number.isFinite(clientId) && !documentNumber) {
      toast.error("Seleccioná un pax o ingresá DNI/CUIT para consultar.");
      return;
    }

    setLookupStatusAt(idx, { state: "loading" });
    try {
      const payload = {
        clientId: Number.isFinite(clientId) ? clientId : undefined,
        documentType: documentType || undefined,
        documentNumber: documentNumber || undefined,
        persist: Boolean(formData.paxLookupPersist?.[idx]),
      };
      const res = await authFetch(
        "/api/afip/taxpayer-lookup",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      );
      const raw = await res.text();
      let data: {
        success?: boolean;
        message?: string;
        lookup?: PaxLookupData;
      } = {};
      try {
        data = JSON.parse(raw);
      } catch {
        data = { success: false, message: raw };
      }

      if (!res.ok || !data.success || !data.lookup) {
        const msg = data.message || "No se pudo consultar AFIP.";
        setLookupStatusAt(idx, { state: "error", message: msg });
        toast.error(msg);
        return;
      }

      setLookupDataAt(idx, data.lookup);
      setLookupStatusAt(idx, {
        state: "ok",
        message: "Datos obtenidos de AFIP.",
      });

      const nextType = formData.tipoFactura === "1" ? "CUIT" : "DNI";
      if (nextType === "CUIT" && data.lookup.cuit) {
        setDocTypeAt(idx, "CUIT");
        setDocNumberAt(idx, String(data.lookup.cuit));
      }
      if (nextType === "DNI" && data.lookup.dni) {
        setDocTypeAt(idx, "DNI");
        setDocNumberAt(idx, String(data.lookup.dni));
      }

      if (formData.paxLookupPersist?.[idx]) {
        toast.success("Datos AFIP guardados en el pax.");
      } else {
        toast.success("Datos AFIP listos para previsualizar y emitir.");
      }
    } catch {
      setLookupStatusAt(idx, {
        state: "error",
        message: "Error consultando AFIP.",
      });
      toast.error("Error consultando AFIP.");
    }
  };

  const getDistributionMaxAt = (idx: number) => {
    const others = parsedDistributionValues.reduce(
      (acc, n, i) => (i === idx ? acc : acc + n),
      0,
    );
    if (formData.distributionMode === "percentage") {
      return Math.max(0, Number((100 - others).toFixed(2)));
    }
    return Math.max(
      0,
      Number((distributionReferenceTotal - others).toFixed(2)),
    );
  };

  const setDistributionValueAt = (idx: number, value: string) => {
    const arr = resizeStringArray(formData.distributionValues, clientCount);
    const trimmed = String(value || "").trim();
    if (trimmed === "") {
      arr[idx] = "";
      updateFormData("distributionValues", arr);
      return;
    }

    const parsed = Math.max(0, parseDistributionNumber(trimmed));
    const maxAllowed = getDistributionMaxAt(idx);
    const clamped = clamp(parsed, 0, maxAllowed);
    arr[idx] = formatDistributionNumber(clamped);
    updateFormData("distributionValues", arr);
  };

  const setEqualDistribution = () => {
    if (clientCount <= 0) return;

    if (formData.distributionMode === "percentage") {
      const raw = 100 / clientCount;
      const base = Number(raw.toFixed(2));
      const next = Array.from({ length: clientCount }, () => base);
      const sum = Number(next.reduce((acc, n) => acc + n, 0).toFixed(2));
      const diff = Number((100 - sum).toFixed(2));
      next[next.length - 1] = Number((next[next.length - 1] + diff).toFixed(2));
      updateFormData(
        "distributionValues",
        next.map((v) => formatDistributionNumber(v)),
      );
      return;
    }

    const equal = splitAmountByShares(
      distributionReferenceTotal,
      Array.from({ length: clientCount }, () => 1),
    ).map((v) => formatDistributionNumber(v));
    updateFormData("distributionValues", equal);
  };

  const completeDistributionAtLastPax = () => {
    if (clientCount <= 0) return;
    const lastIdx = clientCount - 1;
    const arr = resizeStringArray(formData.distributionValues, clientCount);
    const values = parsedDistributionValues;

    const others = Number(
      values
        .reduce((acc, n, idx) => (idx === lastIdx ? acc : acc + n), 0)
        .toFixed(2),
    );

    const target =
      formData.distributionMode === "percentage"
        ? 100
        : distributionReferenceTotal;
    const remaining = Number((target - others).toFixed(2));
    arr[lastIdx] = formatDistributionNumber(clamp(remaining, 0, target));
    updateFormData("distributionValues", arr);
  };

  const handleDistributionModeChange = (nextMode: InvoiceDistributionMode) => {
    if (nextMode === formData.distributionMode) return;
    const values = parsedDistributionValues;
    const sum = Number(values.reduce((acc, n) => acc + n, 0).toFixed(2));
    let next: number[] = [];

    if (nextMode === "percentage") {
      if (sum > 0) {
        next = values.map((value) => Number(((value / sum) * 100).toFixed(2)));
      } else {
        const base = Number((100 / clientCount).toFixed(2));
        next = Array.from({ length: clientCount }, () => base);
      }
      const nextSum = Number(next.reduce((acc, n) => acc + n, 0).toFixed(2));
      const diff = Number((100 - nextSum).toFixed(2));
      if (next.length > 0) {
        next[next.length - 1] = Number(
          (next[next.length - 1] + diff).toFixed(2),
        );
      }
    } else {
      if (sum > 0 && distributionReferenceTotal > 0) {
        next = values.map((value) =>
          Number(((value / sum) * distributionReferenceTotal).toFixed(2)),
        );
      } else {
        next = splitAmountByShares(
          distributionReferenceTotal,
          Array.from({ length: clientCount }, () => 1),
        );
      }
      const nextSum = Number(next.reduce((acc, n) => acc + n, 0).toFixed(2));
      const diff = Number((distributionReferenceTotal - nextSum).toFixed(2));
      if (next.length > 0) {
        next[next.length - 1] = Number(
          (next[next.length - 1] + diff).toFixed(2),
        );
      }
    }

    updateFormData("distributionMode", nextMode);
    updateFormData(
      "distributionValues",
      next.map((value) => formatDistributionNumber(Math.max(0, value))),
    );
  };

  const setCustomItems = (next: InvoiceCustomItemForm[]) => {
    updateFormData("customItems", next);
  };

  const updateCustomItem = (
    id: string,
    patch: Partial<InvoiceCustomItemForm>,
  ) => {
    const next = customItems.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    setCustomItems(next);
  };

  const removeCustomItem = (id: string) => {
    const next = customItems.filter((item) => item.id !== id);
    setCustomItems(next);
  };

  const addCustomItem = () => {
    const next: InvoiceCustomItemForm = {
      id: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      description: "",
      taxCategory: "EXEMPT",
      amount: "",
    };
    setCustomItems([...(customItems || []), next]);
  };

  const regenerateItemsFromServices = () => {
    const defaults: InvoiceCustomItemForm[] = selectedServices.map((svc) => ({
      id: `svc-${svc.id_service}`,
      description:
        svc.description ||
        `${svc.type}${svc.destination ? ` · ${svc.destination}` : ""}`,
      taxCategory:
        (svc?.vatOnCommission21 ?? 0) > 0
          ? "21"
          : (svc?.vatOnCommission10_5 ?? 0) > 0
            ? "10_5"
            : "EXEMPT",
      amount: "",
    }));
    setCustomItems(defaults);
  };

  return (
    <motion.div
      layout
      initial={{ maxHeight: 96, opacity: 1 }}
      animate={{
        maxHeight: showForm ? 1400 : 96,
        opacity: 1,
        transition: { duration: 0.35, ease: "easeInOut" },
      }}
      className={`mb-6 overflow-auto rounded-3xl border border-sky-300/70 bg-white text-slate-900 shadow-sm shadow-slate-900/10 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-100 ${containerClassName}`}
    >
      <div
        className={`sticky top-0 z-10 ${showForm ? "rounded-t-3xl border-b" : ""} border-sky-300/70 bg-white px-4 py-3 backdrop-blur-sm dark:border-sky-600/30 dark:bg-sky-950/10`}
      >
        {collapsible ? (
          <button
            type="button"
            onClick={() => setIsFormVisible(!isFormVisible)}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={showForm}
            aria-controls="invoice-form-body"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-full bg-sky-100 text-slate-900 shadow-sm shadow-sky-950/20 dark:bg-sky-950/10 dark:text-slate-100">
                {showForm ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 12h14"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4.5v15m7.5-7.5h-15"
                    />
                  </svg>
                )}
              </div>
              <div>
                <p className="text-lg font-semibold">
                  {showForm ? "Factura" : "Crear factura"}
                </p>
                <p className="text-xs opacity-70">
                  Seleccioná pasajeros y servicios.
                </p>
              </div>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              {headerPills}
            </div>
          </button>
        ) : (
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-full bg-sky-100 text-slate-900 shadow-sm shadow-sky-950/20 dark:bg-sky-950/10 dark:text-slate-100">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 12h14"
                  />
                </svg>
              </div>
              <div>
                <p className="text-lg font-semibold">Factura</p>
                <p className="text-xs opacity-70">
                  Seleccioná pasajeros y servicios.
                </p>
              </div>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              {headerPills}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {showForm && (
          <motion.form
            id="invoice-form-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              const hasClients = (formData.clientIds || []).some(
                (v) => v && v.trim(),
              );
              const hasServices = selectedServiceIds.length > 0;
              if (!formData.tipoFactura || !hasClients || !hasServices) {
                toast.error(
                  "Completá tipo de factura, al menos un pax y un servicio.",
                );
                return;
              }
              if (selectedClientsCount > 1 && !distributionValidation.ok) {
                toast.error(distributionValidation.error);
                return;
              }
              if (manualEnabled && hasMultipleCurrencies) {
                toast.error(
                  "Los importes manuales solo se permiten con una única moneda.",
                );
                return;
              }
              const invalidItem = (formData.customItems || []).find((it) => {
                const amount = Number(
                  String(it.amount || "").replace(",", "."),
                );
                if (!Number.isFinite(amount) || amount <= 0) return false;
                return !String(it.description || "").trim();
              });
              if (invalidItem) {
                toast.error(
                  "Si cargás monto en un ítem, completá su descripción.",
                );
                return;
              }
              handleSubmit(e);
            }}
            className="space-y-5 px-4 pb-6 pt-4 md:px-6"
          >
            <Section title="Comprobante" desc="Definí tipo y fecha de emisión.">
              <Field id="tipoFactura" label="Tipo de factura" required>
                <div
                  id="tipoFactura"
                  className="inline-flex rounded-full border border-sky-300/70 bg-white p-1 dark:border-sky-600/30 dark:bg-sky-950/10"
                >
                  <button
                    type="button"
                    onClick={() => updateFormData("tipoFactura", "1")}
                    className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                      formData.tipoFactura === "1"
                        ? "bg-sky-100 text-sky-900 dark:bg-sky-500/30 dark:text-slate-100"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    Factura A
                  </button>
                  <button
                    type="button"
                    onClick={() => updateFormData("tipoFactura", "6")}
                    className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                      formData.tipoFactura === "6"
                        ? "bg-sky-100 text-sky-900 dark:bg-sky-500/30 dark:text-slate-100"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    Factura B
                  </button>
                </div>
                <input
                  type="hidden"
                  name="tipoFactura"
                  value={formData.tipoFactura || "6"}
                />
              </Field>

              <Field id="invoiceDate" label="Fecha de factura" required>
                <input
                  id="invoiceDate"
                  type="date"
                  name="invoiceDate"
                  value={formData.invoiceDate || ""}
                  onChange={handleChange}
                  min={minDate}
                  max={maxDate}
                  className={inputBase}
                  required
                />
              </Field>
            </Section>

            <Section
              title={lockClientSelection ? "Pasajero" : "Pasajeros"}
              desc={
                lockClientSelection
                  ? "La factura se emite al pasajero activo."
                  : "Agregá uno o más destinatarios."
              }
            >
              {!lockClientSelection ? (
                <Field id="clientCount" label="Cantidad de pasajeros" required>
                  <input
                    id="clientCount"
                    type="number"
                    value={clientCount}
                    min={1}
                    onChange={(e) =>
                      setClientCount(Math.max(1, Number(e.target.value) || 1))
                    }
                    placeholder="Cantidad de pasajeros..."
                    className={inputBase}
                  />
                </Field>
              ) : (
                <div className="rounded-2xl border border-emerald-300/70 bg-emerald-50/35 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/70 dark:bg-emerald-900/20 dark:text-emerald-100 md:col-span-2">
                  <span className="font-semibold">
                    {lockedClientLabel || "Pasajero activo"}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:col-span-2">
                {Array.from({ length: clientCount }).map((_, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10"
                  >
                    {!lockClientSelection ? (
                      <ClientPicker
                        token={token}
                        label={`Pax ${idx + 1}`}
                        placeholder="Buscar por Nº interno, DNI, Pasaporte, CUIT o nombre..."
                        valueId={
                          formData.clientIds?.[idx]
                            ? parseInt(formData.clientIds[idx]!, 10)
                            : null
                        }
                        excludeIds={excludeForIndex(idx)}
                        onSelect={(c) => setClientAt(idx, c)}
                        onClear={() => setClientAt(idx, null)}
                        required
                      />
                    ) : null}

                    <div
                      className={`grid grid-cols-1 gap-3 md:grid-cols-3 ${
                        lockClientSelection ? "" : "mt-3"
                      }`}
                    >
                      <Field id={`paxDocType-${idx}`} label="Tipo doc">
                        <select
                          id={`paxDocType-${idx}`}
                          value={formData.paxDocTypes?.[idx] || ""}
                          onChange={(e) =>
                            setDocTypeAt(idx, e.target.value as PaxDocType)
                          }
                          className={`${inputBase} cursor-pointer`}
                        >
                          <option value="">Seleccionar</option>
                          <option value="DNI">DNI</option>
                          <option value="CUIT">CUIT</option>
                        </select>
                      </Field>

                      <Field
                        id={`paxDocNumber-${idx}`}
                        label="Número"
                        hint="Podés cargar DNI/CUIT manual para AFIP."
                      >
                        <input
                          id={`paxDocNumber-${idx}`}
                          type="text"
                          value={formData.paxDocNumbers?.[idx] || ""}
                          onChange={(e) => setDocNumberAt(idx, e.target.value)}
                          placeholder="Ej: 20300111222 o 30111222"
                          className={inputBase}
                        />
                      </Field>

                      <div className="flex flex-col justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleLookupAfip(idx)}
                          disabled={lookupStatus[idx]?.state === "loading"}
                          className="rounded-2xl border border-sky-300/50 bg-sky-100/70 px-4 py-2 text-sm font-medium text-sky-900 shadow-sm transition hover:scale-[0.99] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-300/20 dark:bg-sky-500/20 dark:text-sky-100"
                        >
                          {lookupStatus[idx]?.state === "loading"
                            ? "Consultando AFIP..."
                            : "Traer datos AFIP"}
                        </button>
                        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <input
                            type="checkbox"
                            checked={Boolean(formData.paxLookupPersist?.[idx])}
                            onChange={(e) =>
                              setPersistAt(idx, e.target.checked)
                            }
                            className="size-4 rounded border border-sky-300/60"
                          />
                          Guardar datos en el pax
                        </label>
                      </div>
                    </div>

                    <div className="mt-2 text-xs">
                      {lookupStatus[idx]?.state === "ok" && (
                        <p className="text-emerald-700 dark:text-emerald-200">
                          {lookupStatus[idx]?.message || "Datos AFIP listos."}
                        </p>
                      )}
                      {lookupStatus[idx]?.state === "error" && (
                        <p className="text-rose-700 dark:text-rose-200">
                          {lookupStatus[idx]?.message ||
                            "No se pudieron obtener datos AFIP."}
                        </p>
                      )}
                    </div>

                    {formData.paxLookupData?.[idx] && (
                      <div className="mt-2 rounded-xl border border-sky-300/70 bg-white p-2 text-xs text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                        <p className="font-medium">Previsualización AFIP</p>
                        <p>
                          {formData.paxLookupData[idx]?.company_name ||
                            `${formData.paxLookupData[idx]?.first_name || ""} ${formData.paxLookupData[idx]?.last_name || ""}`.trim() ||
                            "Sin nombre"}
                        </p>
                        <p>
                          DNI: {formData.paxLookupData[idx]?.dni || "—"} · CUIT:{" "}
                          {formData.paxLookupData[idx]?.cuit || "—"}
                        </p>
                        <p>
                          Domicilio:{" "}
                          {formData.paxLookupData[idx]?.address || "—"}
                          {formData.paxLookupData[idx]?.locality
                            ? ` · ${formData.paxLookupData[idx]?.locality}`
                            : ""}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>

            {clientCount > 1 && (
              <Section
                title="Distribución entre pax"
                desc="Elegí si distribuís por porcentaje o por monto. La asignación debe cerrarse completa antes de emitir."
              >
                <div className="md:col-span-2">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-full border border-sky-300/70 bg-white p-1 dark:border-sky-600/30 dark:bg-sky-950/10">
                      <button
                        type="button"
                        onClick={() =>
                          handleDistributionModeChange("percentage")
                        }
                        className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                          formData.distributionMode === "percentage"
                            ? "bg-sky-100 text-sky-900 dark:bg-sky-500/30 dark:text-slate-100"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        Porcentaje
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDistributionModeChange("amount")}
                        className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                          formData.distributionMode === "amount"
                            ? "bg-sky-100 text-sky-900 dark:bg-sky-500/30 dark:text-slate-100"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        Monto
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={setEqualDistribution}
                      className="rounded-full border border-sky-300/70 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:scale-[0.98] active:scale-[0.96] dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300"
                    >
                      Repartir en partes iguales
                    </button>
                    <button
                      type="button"
                      onClick={completeDistributionAtLastPax}
                      disabled={clientCount < 2}
                      className="rounded-full border border-sky-300/70 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:scale-[0.98] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300"
                    >
                      Completar faltante en último pax
                    </button>
                  </div>

                  <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Asignado
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formData.distributionMode === "percentage"
                          ? `${distributionAssigned.toFixed(2)}%`
                          : manualFormatter.format(distributionAssigned)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Restante
                      </p>
                      <p
                        className={`mt-1 text-sm font-semibold ${
                          distributionRemaining < 0
                            ? "text-rose-700 dark:text-rose-200"
                            : "text-emerald-700 dark:text-emerald-200"
                        }`}
                      >
                        {formData.distributionMode === "percentage"
                          ? `${distributionRemaining.toFixed(2)}%`
                          : manualFormatter.format(distributionRemaining)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Total referencia
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formData.distributionMode === "percentage"
                          ? "100.00%"
                          : manualFormatter.format(distributionReferenceTotal)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {Array.from({ length: clientCount }).map((_, idx) => {
                      const current = parsedDistributionValues[idx] ?? 0;
                      const maxAllowed = getDistributionMaxAt(idx);
                      return (
                        <div
                          key={`distribution-${idx}`}
                          className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                              Pax {idx + 1}
                            </p>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-sky-900 dark:bg-sky-950/10 dark:text-slate-100">
                              {formData.distributionMode === "percentage"
                                ? `${current.toFixed(2)}%`
                                : manualFormatter.format(current)}
                            </span>
                          </div>

                          {formData.distributionMode === "percentage" ? (
                            <>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(0, maxAllowed)}
                                step={0.1}
                                value={Math.min(
                                  current,
                                  Math.max(0, maxAllowed),
                                )}
                                onChange={(e) =>
                                  setDistributionValueAt(idx, e.target.value)
                                }
                                className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-sky-200 accent-sky-700 dark:bg-sky-950/20"
                              />
                              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDistributionValueAt(
                                      idx,
                                      String(Math.max(0, current - 5)),
                                    )
                                  }
                                  className="rounded-full border border-sky-300/70 px-2 py-0.5 font-medium transition hover:bg-white"
                                >
                                  -5%
                                </button>
                                <span>Máximo: {maxAllowed.toFixed(2)}%</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDistributionValueAt(
                                      idx,
                                      String(current + 5),
                                    )
                                  }
                                  disabled={current >= maxAllowed}
                                  className="rounded-full border border-sky-300/70 px-2 py-0.5 font-medium transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  +5%
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max={Math.max(0, maxAllowed)}
                                value={formData.distributionValues?.[idx] || ""}
                                onChange={(e) =>
                                  setDistributionValueAt(idx, e.target.value)
                                }
                                placeholder="0.00"
                                className={`${inputBase} mt-3`}
                              />
                              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                Máximo disponible para este pax:{" "}
                                {manualFormatter.format(
                                  Math.max(0, maxAllowed),
                                )}
                              </p>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {distributionValidation.ok ? (
                    <div className="mt-3 rounded-2xl border border-sky-300/70 bg-white p-3 text-xs text-slate-700 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300">
                      <p className="font-medium">Previsualización por pax</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {distributionValidation.shares.map(
                          (distribution, idx) => {
                            const amount = perClientAmountsPreview[idx] ?? 0;
                            const lookup = formData.paxLookupData?.[idx];
                            const doc =
                              formData.tipoFactura === "1"
                                ? lookup?.cuit ||
                                  (formData.paxDocTypes?.[idx] === "CUIT"
                                    ? formData.paxDocNumbers?.[idx]
                                    : "")
                                : lookup?.dni ||
                                  (formData.paxDocTypes?.[idx] === "DNI"
                                    ? formData.paxDocNumbers?.[idx]
                                    : "");
                            return (
                              <div
                                key={`preview-${idx}`}
                                className="rounded-xl border border-sky-300/70 bg-white p-2 dark:border-sky-600/30 dark:bg-sky-950/10"
                              >
                                <p className="font-medium">Pax {idx + 1}</p>
                                <p>
                                  Distribución:{" "}
                                  {(distribution * 100).toFixed(2)}%
                                </p>
                                <p>
                                  Total estimado:{" "}
                                  {manualFormatter.format(amount)}
                                </p>
                                <p>
                                  {formData.tipoFactura === "1"
                                    ? "CUIT"
                                    : "DNI"}
                                  : {doc || "Sin completar"}
                                </p>
                              </div>
                            );
                          },
                        )}
                      </div>
                      <p className="mt-2">
                        Total referencia servicios:{" "}
                        {manualFormatter.format(distributionReferenceTotal)}
                      </p>
                      {manualDistributionTotal != null && (
                        <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                          Referencia tomada de importes manuales.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-rose-700 dark:text-rose-200">
                      {distributionValidation.error}
                    </div>
                  )}
                </div>
              </Section>
            )}

            <Section
              title="Servicios"
              desc="Seleccioná los servicios de la grupal."
            >
              <div className="md:col-span-2">
                {availableServices.length === 0 ? (
                  <div className="rounded-2xl border border-sky-300/70 bg-white p-3 text-sm opacity-80 dark:border-sky-600/30 dark:bg-sky-950/10">
                    Esta grupal no tiene servicios cargados.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {availableServices.map((svc) => {
                      const isActive = selectedServiceIds.includes(
                        svc.id_service,
                      );
                      return (
                        <button
                          type="button"
                          key={svc.id_service}
                          onClick={() => toggleService(svc)}
                          className={`rounded-2xl border p-3 text-left transition-all ${
                            isActive
                              ? "border-sky-300/40 bg-sky-100 text-slate-900 shadow-sm dark:bg-sky-950/10 dark:text-slate-100"
                              : "border-sky-300/70 bg-white hover:bg-white dark:border-sky-300/70 dark:bg-sky-950/10"
                          }`}
                          title={`Servicio Nº ${
                            formatAgencyNumber(svc.agency_service_id)
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-sm font-medium">
                              Nº {formatAgencyNumber(svc.agency_service_id)} ·{" "}
                              {svc.type}
                              {svc.destination ? ` · ${svc.destination}` : ""}
                            </div>
                            {isActive && (
                              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-sky-900 dark:bg-sky-950/10 dark:text-slate-100">
                                seleccionado
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-sm opacity-80">
                            <b>Venta:</b>{" "}
                            {new Intl.NumberFormat("es-AR", {
                              style: "currency",
                              currency: svc.currency || "ARS",
                              minimumFractionDigits: 2,
                            }).format(
                              (svc.sale_price ?? 0) + (svc.card_interest ?? 0),
                            )}
                            <span className="opacity-70">
                              {" "}
                              ({svc.currency || "ARS"})
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedServices.length > 0 ? (
                  <div className="ml-1 mt-2 text-xs text-slate-600 dark:text-slate-400">
                    Seleccionados:{" "}
                    {selectedServices
                      .map((s) => `Nº ${formatAgencyNumber(s.agency_service_id)}`)
                      .join(", ")}
                  </div>
                ) : availableServices.length > 0 ? (
                  <div className="ml-1 mt-2 text-xs text-amber-700 dark:text-amber-200">
                    Seleccioná al menos un servicio para emitir la factura.
                  </div>
                ) : null}
              </div>
            </Section>

            <Section
              title="Ítems de factura"
              desc="Definí acá todas las descripciones y montos visibles en el PDF. Si un ítem no tiene monto, no se muestra."
            >
              <div className="space-y-3 md:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={addCustomItem}
                    className="rounded-full border border-sky-300/50 bg-sky-100/70 px-3 py-1.5 text-xs font-medium text-sky-900 transition hover:scale-[0.98] active:scale-[0.96] dark:border-sky-300/20 dark:bg-sky-500/20 dark:text-sky-100"
                  >
                    Agregar ítem
                  </button>
                  <button
                    type="button"
                    onClick={regenerateItemsFromServices}
                    className="rounded-full border border-sky-300/70 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:scale-[0.98] active:scale-[0.96] dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300"
                  >
                    Regenerar desde servicios
                  </button>
                </div>

                {(customItems || []).length === 0 ? (
                  <div className="rounded-2xl border border-sky-300/70 bg-white p-3 text-xs text-slate-600 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-400">
                    No hay ítems cargados. Podés agregar uno manual o regenerar
                    desde servicios.
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      El tratamiento fiscal se determina automáticamente al
                      emitir.
                    </p>
                    {(customItems || []).map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-1 gap-2 rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10 md:grid-cols-12"
                      >
                        <div className="md:col-span-8">
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) =>
                              updateCustomItem(item.id, {
                                description: e.target.value,
                              })
                            }
                            placeholder="Descripción del ítem"
                            className={inputBase}
                          />
                        </div>
                        <div className="md:col-span-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.amount}
                            onChange={(e) =>
                              updateCustomItem(item.id, {
                                amount: e.target.value,
                              })
                            }
                            placeholder="Monto"
                            className={inputBase}
                          />
                        </div>
                        <div className="md:col-span-1">
                          <button
                            type="button"
                            onClick={() => removeCustomItem(item.id)}
                            className="w-full rounded-2xl border border-rose-300/50 bg-rose-100/70 px-3 py-2 text-xs font-medium text-rose-900 transition hover:scale-[0.98] active:scale-[0.96] dark:border-rose-300/20 dark:bg-rose-500/20 dark:text-rose-100"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-2xl border border-sky-300/70 bg-white p-3 text-xs text-slate-600 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-400">
                  <p className="font-medium">Detalle de la grupal</p>
                  {selectedServices.length === 0 ? (
                    <p className="mt-1">No hay servicios seleccionados.</p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {selectedServices.map((svc) => (
                        <li key={`scope-detail-${svc.id_service}`}>
                          Nº {formatAgencyNumber(svc.agency_service_id)} ·{" "}
                          {svc.type} · {svc.description || "Sin descripción"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Section>

            <Section
              title="Importes manuales"
              desc="Opcional: sobrescribe el desglose automático de los servicios."
            >
              <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
                <div className="text-sm font-medium">
                  Usar importes manuales
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateFormData("manualTotalsEnabled", !manualEnabled)
                  }
                  disabled={manualToggleDisabled}
                  className={`rounded-full border px-4 py-1 text-xs font-medium transition ${
                    manualToggleDisabled
                      ? "cursor-not-allowed border-sky-300/70 bg-white text-slate-500 dark:text-slate-500"
                      : manualEnabled
                        ? "border-sky-300/50 bg-sky-100 text-slate-900"
                        : "border-sky-300/70 bg-white text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {manualEnabled ? "Activado" : "Desactivado"}
                </button>
              </div>

              {manualEnabled && (
                <>
                  <Field
                    id="manualTotal"
                    label="Importe total (opcional)"
                    hint="Si lo dejás vacío, se calcula con los campos de abajo. Si solo completás el total, se toma como exento."
                  >
                    <input
                      id="manualTotal"
                      name="manualTotal"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.manualTotal}
                      onChange={handleChange}
                      placeholder="0.00"
                      className={inputBase}
                    />
                  </Field>

                  <Field id="manualBase21" label="Base gravada 21%">
                    <input
                      id="manualBase21"
                      name="manualBase21"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.manualBase21}
                      onChange={handleChange}
                      placeholder="0.00"
                      className={inputBase}
                    />
                  </Field>

                  <Field id="manualIva21" label="IVA 21%">
                    <input
                      id="manualIva21"
                      name="manualIva21"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.manualIva21}
                      onChange={handleChange}
                      placeholder="0.00"
                      className={inputBase}
                    />
                  </Field>

                  <Field id="manualBase10_5" label="Base gravada 10,5%">
                    <input
                      id="manualBase10_5"
                      name="manualBase10_5"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.manualBase10_5}
                      onChange={handleChange}
                      placeholder="0.00"
                      className={inputBase}
                    />
                  </Field>

                  <Field id="manualIva10_5" label="IVA 10,5%">
                    <input
                      id="manualIva10_5"
                      name="manualIva10_5"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.manualIva10_5}
                      onChange={handleChange}
                      placeholder="0.00"
                      className={inputBase}
                    />
                  </Field>

                  <Field id="manualExempt" label="Exento / No computable">
                    <input
                      id="manualExempt"
                      name="manualExempt"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.manualExempt}
                      onChange={handleChange}
                      placeholder="0.00"
                      className={inputBase}
                    />
                  </Field>

                  <div className="rounded-2xl border border-sky-300/70 bg-white p-3 text-xs text-slate-600 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-400 md:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>Total manual</span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {manualFormatter.format(manualPreview.total)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span>Neto</span>
                      <span>{manualFormatter.format(manualPreview.neto)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span>Neto gravado ARCA</span>
                      <span>
                        {manualFormatter.format(manualPreview.taxableBase)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span>IVA</span>
                      <span>
                        {manualFormatter.format(manualPreview.ivaSum)}
                      </span>
                    </div>
                    {manualPreview.onlyTotalLoaded && (
                      <div className="mt-2 text-amber-700 dark:text-amber-200">
                        Con solo importe total, ARCA recibe neto gravado 0.
                        Cargá base/IVA si corresponde gravado.
                      </div>
                    )}
                  </div>

                  {selectedClientsCount > 1 && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 md:col-span-2">
                      Se emite una factura por pax usando la distribución
                      definida arriba. Si activás importes manuales válidos, la
                      distribución por monto usa ese total manual.
                    </div>
                  )}

                  {manualValidationError && (
                    <div className="text-xs text-rose-700 dark:text-rose-200 md:col-span-2">
                      {manualValidationError}
                    </div>
                  )}

                  {hasMultipleCurrencies && (
                    <div className="text-xs text-amber-700 dark:text-amber-200 md:col-span-2">
                      Seleccioná servicios en una sola moneda para usar importes
                      manuales.
                    </div>
                  )}
                </>
              )}

              {manualToggleDisabled && (
                <div className="text-xs text-amber-700 dark:text-amber-200 md:col-span-2">
                  El modo manual solo está disponible cuando todos los servicios
                  están en la misma moneda.
                </div>
              )}
            </Section>

            <Section
              title="Cotización"
              desc="Completá solo si la factura se emite en USD."
            >
              <Field id="exchangeRate" label="Cotización del dólar (opcional)">
                <input
                  id="exchangeRate"
                  type="text"
                  name="exchangeRate"
                  value={formData.exchangeRate || ""}
                  onChange={handleChange}
                  placeholder={
                    rateStatus === "loading"
                      ? "Cargando cotización..."
                      : fetchedExchangeRate
                        ? `Cotización: ${fetchedExchangeRate}`
                        : "Cotización actual"
                  }
                  className={inputBase}
                />
                {rateStatus === "loading" && (
                  <div className="ml-1 mt-1 text-xs opacity-70">
                    <Spinner />
                  </div>
                )}
                {rateStatus === "ok" && fetchedExchangeRate && (
                  <div className="ml-1 mt-1 text-xs opacity-70">
                    Cotización detectada: {fetchedExchangeRate}
                  </div>
                )}
              </Field>
            </Section>

            <Section
              title="Previsualización de emisión AFIP"
              desc="Resumen previo de lo que se enviará al emitir."
            >
              <div className="space-y-3 md:col-span-2">
                {afipPreviewError ? (
                  <div className="rounded-2xl border border-rose-300/40 bg-rose-100/60 p-3 text-xs text-rose-800 dark:border-rose-300/20 dark:bg-rose-500/10 dark:text-rose-200">
                    {afipPreviewError}
                  </div>
                ) : (
                  <>
                    {afipPreviewByCurrency.length > 1 && (
                      <div className="rounded-2xl border border-amber-300/40 bg-amber-100/60 p-3 text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-200">
                        Se emitirán comprobantes separados por moneda.
                      </div>
                    )}

                    {!invoicePreviewShares.ok && selectedClientEntries.length > 1 && (
                      <div className="rounded-2xl border border-amber-300/40 bg-amber-100/60 p-3 text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-200">
                        {invoicePreviewShares.error} Mientras tanto se muestran
                        solo los totales globales.
                      </div>
                    )}

                    <div className="rounded-2xl border border-sky-300/70 bg-white p-3 text-[11px] text-slate-600 dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-400">
                      El cálculo AFIP sale del desglose de servicios (o de
                      importes manuales si están activos y válidos). Los ítems
                      de factura impactan en descripciones/PDF.
                    </div>

                    {afipPreviewByCurrency.map((group) => (
                      <div
                        key={`afip-preview-${group.currency}`}
                        className="rounded-2xl border border-sky-300/70 bg-white p-3 dark:border-sky-600/30 dark:bg-sky-950/10"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            Moneda {toDisplayCurrency(group.currency)}
                          </p>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-950/10 dark:text-slate-100">
                            Total{" "}
                            {formatMoneyByCurrency(
                              group.breakdown.total,
                              group.currency,
                            )}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
                          <div className="rounded-xl border border-sky-300/70 bg-white p-2 dark:border-sky-600/30 dark:bg-sky-950/10">
                            <p className="text-slate-600 dark:text-slate-400">
                              Neto
                            </p>
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {formatMoneyByCurrency(
                                group.breakdown.neto,
                                group.currency,
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white p-2 dark:border-sky-600/30 dark:bg-sky-950/10">
                            <p className="text-slate-600 dark:text-slate-400">
                              Base 21%
                            </p>
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {formatMoneyByCurrency(
                                group.breakdown.base21,
                                group.currency,
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white p-2 dark:border-sky-600/30 dark:bg-sky-950/10">
                            <p className="text-slate-600 dark:text-slate-400">
                              IVA 21%
                            </p>
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {formatMoneyByCurrency(
                                group.breakdown.iva21,
                                group.currency,
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white p-2 dark:border-sky-600/30 dark:bg-sky-950/10">
                            <p className="text-slate-600 dark:text-slate-400">
                              Base 10,5%
                            </p>
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {formatMoneyByCurrency(
                                group.breakdown.base10_5,
                                group.currency,
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white p-2 dark:border-sky-600/30 dark:bg-sky-950/10">
                            <p className="text-slate-600 dark:text-slate-400">
                              IVA 10,5%
                            </p>
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {formatMoneyByCurrency(
                                group.breakdown.iva10_5,
                                group.currency,
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white p-2 dark:border-sky-600/30 dark:bg-sky-950/10">
                            <p className="text-slate-600 dark:text-slate-400">
                              IVA total
                            </p>
                            <p className="font-medium text-slate-900 dark:text-slate-100">
                              {formatMoneyByCurrency(
                                group.breakdown.ivaTotal,
                                group.currency,
                              )}
                            </p>
                          </div>
                          <div className="rounded-xl border border-sky-300/70 bg-white p-2 dark:border-sky-600/30 dark:bg-sky-950/10 md:col-span-3">
                            <p className="text-slate-600 dark:text-slate-400">
                              Exento / No gravado
                            </p>
                            <p
                              className={`font-medium ${
                                group.breakdown.exempt < 0
                                  ? "text-rose-700 dark:text-rose-200"
                                  : "text-slate-900 dark:text-slate-100"
                              }`}
                            >
                              {formatMoneyByCurrency(
                                group.breakdown.exempt,
                                group.currency,
                              )}
                            </p>
                          </div>
                        </div>

                        {group.breakdown.exempt < 0 && (
                          <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-200">
                            Advertencia: el neto gravado supera el neto
                            estimado. Revisá el desglose del servicio.
                          </p>
                        )}

                        {group.pax.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                              Desglose por pax
                            </p>
                            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                              {group.pax.map((paxRow) => (
                                <div
                                  key={`afip-preview-pax-${group.currency}-${paxRow.clientId}-${paxRow.idx}`}
                                  className="rounded-xl border border-sky-300/70 bg-white p-2 text-xs dark:border-sky-600/30 dark:bg-sky-950/10"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="font-medium text-slate-900 dark:text-slate-100">
                                      Pax {paxRow.idx + 1}
                                    </p>
                                    <span className="text-slate-600 dark:text-slate-400">
                                      {(paxRow.share * 100).toFixed(2)}%
                                    </span>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between gap-2">
                                    <span className="text-slate-600 dark:text-slate-400">
                                      Total
                                    </span>
                                    <span className="font-medium text-slate-900 dark:text-slate-100">
                                      {formatMoneyByCurrency(
                                        paxRow.breakdown.total,
                                        group.currency,
                                      )}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between gap-2">
                                    <span className="text-slate-600 dark:text-slate-400">
                                      Neto
                                    </span>
                                    <span>
                                      {formatMoneyByCurrency(
                                        paxRow.breakdown.neto,
                                        group.currency,
                                      )}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between gap-2">
                                    <span className="text-slate-600 dark:text-slate-400">
                                      IVA
                                    </span>
                                    <span>
                                      {formatMoneyByCurrency(
                                        paxRow.breakdown.ivaTotal,
                                        group.currency,
                                      )}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between gap-2">
                                    <span className="text-slate-600 dark:text-slate-400">
                                      Exento / No gravado
                                    </span>
                                    <span
                                      className={
                                        paxRow.breakdown.exempt < 0
                                          ? "text-rose-700 dark:text-rose-200"
                                          : ""
                                      }
                                    >
                                      {formatMoneyByCurrency(
                                        paxRow.breakdown.exempt,
                                        group.currency,
                                      )}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </Section>

            <div className="sticky bottom-2 z-10 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] ${
                  isSubmitting
                    ? "cursor-not-allowed bg-sky-950/20 text-white/60 dark:bg-sky-950/10 dark:text-slate-500"
                    : "bg-sky-100 text-slate-900 dark:bg-sky-950/10 dark:text-slate-100"
                }`}
              >
                {isSubmitting ? <Spinner /> : "Crear factura"}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
