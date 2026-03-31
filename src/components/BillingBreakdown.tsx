// src/components/BillingBreakdown.tsx
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BillingBreakdownOverride, BillingData } from "@/types/index";

interface BillingBreakdownProps {
  importeVenta: number;
  costo: number;
  montoIva21: number;
  montoIva10_5: number;
  montoExento: number;
  otrosImpuestos: number;
  cardInterest: number;
  cardInterestIva: number;
  moneda?: string;
  onBillingUpdate?: (data: BillingData) => void;
  transferFeePct?: number;
  allowBreakdownOverrideEdit?: boolean;
  initialBreakdownOverride?: Partial<BillingBreakdownOverride> | null;
  showNetCommissionTotal?: boolean;
  adjustmentsOpen?: boolean;
  adjustmentsActiveCount?: number;
  onAddMiniAdjustment?: () => void;
  adjustmentsPanel?: ReactNode;
  initialCommissionVatMode?: "automatic" | "vat21" | "vat10_5" | "exempt" | "mixed";
  initialGrossIncomeTaxEnabled?: boolean;
  initialGrossIncomeTaxBase?: "netCommission" | "sale";
  initialGrossIncomeTaxPct?: number;
}

type BreakdownField = keyof BillingBreakdownOverride;

const round = (value: number, decimals = 8) =>
  parseFloat(value.toFixed(decimals));

const toNumber = (value: unknown, fallback = 0) => {
  const raw =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(raw) ? raw : fallback;
};

function normalizeOverride(
  input: Partial<BillingBreakdownOverride>,
  fallback: BillingBreakdownOverride,
): BillingBreakdownOverride {
  return {
    nonComputable: toNumber(input.nonComputable, fallback.nonComputable),
    taxableBase21: toNumber(input.taxableBase21, fallback.taxableBase21),
    taxableBase10_5: toNumber(input.taxableBase10_5, fallback.taxableBase10_5),
    commissionExempt: toNumber(input.commissionExempt, fallback.commissionExempt),
    commission21: toNumber(input.commission21, fallback.commission21),
    commission10_5: toNumber(input.commission10_5, fallback.commission10_5),
    vatOnCommission21: toNumber(
      input.vatOnCommission21,
      fallback.vatOnCommission21,
    ),
    vatOnCommission10_5: toNumber(
      input.vatOnCommission10_5,
      fallback.vatOnCommission10_5,
    ),
    totalCommissionWithoutVAT: toNumber(
      input.totalCommissionWithoutVAT,
      fallback.totalCommissionWithoutVAT,
    ),
    impIVA: toNumber(input.impIVA, fallback.impIVA),
    taxableCardInterest: toNumber(
      input.taxableCardInterest,
      fallback.taxableCardInterest,
    ),
    vatOnCardInterest: toNumber(input.vatOnCardInterest, fallback.vatOnCardInterest),
    transferFeeAmount: toNumber(input.transferFeeAmount, fallback.transferFeeAmount),
    transferFeePct: toNumber(input.transferFeePct, fallback.transferFeePct),
  };
}

function sameOverride(
  a: BillingBreakdownOverride | null,
  b: BillingBreakdownOverride | null,
) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.nonComputable === b.nonComputable &&
    a.taxableBase21 === b.taxableBase21 &&
    a.taxableBase10_5 === b.taxableBase10_5 &&
    a.commissionExempt === b.commissionExempt &&
    a.commission21 === b.commission21 &&
    a.commission10_5 === b.commission10_5 &&
    a.vatOnCommission21 === b.vatOnCommission21 &&
    a.vatOnCommission10_5 === b.vatOnCommission10_5 &&
    a.totalCommissionWithoutVAT === b.totalCommissionWithoutVAT &&
    a.impIVA === b.impIVA &&
    a.taxableCardInterest === b.taxableCardInterest &&
    a.vatOnCardInterest === b.vatOnCardInterest &&
    a.transferFeeAmount === b.transferFeeAmount &&
    a.transferFeePct === b.transferFeePct
  );
}

const sameBillingData = (a: BillingData | null, b: BillingData) => {
  if (!a) return false;
  const aWarning = (a.breakdownWarningMessages || []).join("|");
  const bWarning = (b.breakdownWarningMessages || []).join("|");
  const aVatMode = a.commissionVatMode || "automatic";
  const bVatMode = b.commissionVatMode || "automatic";
  const aIibbEnabled = a.grossIncomeTaxEnabled === true;
  const bIibbEnabled = b.grossIncomeTaxEnabled === true;
  const aIibbBase = a.grossIncomeTaxBase || "netCommission";
  const bIibbBase = b.grossIncomeTaxBase || "netCommission";
  const aIibbPct = Number(a.grossIncomeTaxPct || 0);
  const bIibbPct = Number(b.grossIncomeTaxPct || 0);
  const aIibbAmount = Number(a.grossIncomeTaxAmount || 0);
  const bIibbAmount = Number(b.grossIncomeTaxAmount || 0);
  return (
    a.nonComputable === b.nonComputable &&
    a.taxableBase21 === b.taxableBase21 &&
    a.taxableBase10_5 === b.taxableBase10_5 &&
    a.commissionExempt === b.commissionExempt &&
    a.commission21 === b.commission21 &&
    a.commission10_5 === b.commission10_5 &&
    a.vatOnCommission21 === b.vatOnCommission21 &&
    a.vatOnCommission10_5 === b.vatOnCommission10_5 &&
    a.totalCommissionWithoutVAT === b.totalCommissionWithoutVAT &&
    a.impIVA === b.impIVA &&
    a.taxableCardInterest === b.taxableCardInterest &&
    a.vatOnCardInterest === b.vatOnCardInterest &&
    a.transferFeeAmount === b.transferFeeAmount &&
    a.transferFeePct === b.transferFeePct &&
    aVatMode === bVatMode &&
    aIibbEnabled === bIibbEnabled &&
    aIibbBase === bIibbBase &&
    aIibbPct === bIibbPct &&
    aIibbAmount === bIibbAmount &&
    sameOverride(a.breakdownOverride ?? null, b.breakdownOverride ?? null) &&
    aWarning === bWarning
  );
};

const MiniToggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}> = ({ checked, onChange, ariaLabel }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 items-center rounded-full border transition focus:outline-none focus:ring-2 focus:ring-sky-300/60 ${
      checked
        ? "border-sky-500 bg-sky-500"
        : "border-sky-300/80 bg-sky-100/80 dark:border-sky-500/40 dark:bg-sky-900/20"
    }`}
  >
    <span
      className={`pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm transition ${
        checked ? "translate-x-4" : "translate-x-0.5"
      }`}
    />
  </button>
);

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4 10.5-10.5Z" />
      <path d="M13.5 5.5 18.5 10.5" />
    </svg>
  );
}

export default function BillingBreakdown({
  importeVenta,
  costo,
  montoIva21,
  montoIva10_5,
  montoExento,
  otrosImpuestos,
  cardInterest,
  cardInterestIva,
  moneda = "ARS",
  onBillingUpdate,
  transferFeePct = 0.024,
  allowBreakdownOverrideEdit = false,
  initialBreakdownOverride = null,
  showNetCommissionTotal = true,
  adjustmentsOpen = true,
  adjustmentsActiveCount = 0,
  onAddMiniAdjustment,
  adjustmentsPanel,
  initialCommissionVatMode,
  initialGrossIncomeTaxEnabled,
  initialGrossIncomeTaxBase,
  initialGrossIncomeTaxPct,
}: BillingBreakdownProps) {
  const lastPayloadRef = useRef<BillingData | null>(null);
  const onBillingUpdateRef = useRef(onBillingUpdate);
  const initialOverrideKeyRef = useRef<string>("");
  const [manualOverride, setManualOverride] = useState<BillingBreakdownOverride | null>(
    null,
  );
  const [editMode, setEditMode] = useState(false);
  const [commissionVatMode, setCommissionVatMode] = useState<
    "automatic" | "vat21" | "vat10_5" | "exempt" | "mixed"
  >("automatic");
  const [grossIncomeTaxEnabled, setGrossIncomeTaxEnabled] = useState(false);
  const [grossIncomeTaxBase, setGrossIncomeTaxBase] = useState<
    "netCommission" | "sale"
  >("netCommission");
  const [grossIncomeTaxPct, setGrossIncomeTaxPct] = useState(0);

  useEffect(() => {
    onBillingUpdateRef.current = onBillingUpdate;
  }, [onBillingUpdate]);

  useEffect(() => {
    setCommissionVatMode(initialCommissionVatMode || "automatic");
  }, [initialCommissionVatMode]);

  useEffect(() => {
    setGrossIncomeTaxEnabled(initialGrossIncomeTaxEnabled === true);
  }, [initialGrossIncomeTaxEnabled]);

  useEffect(() => {
    setGrossIncomeTaxBase(initialGrossIncomeTaxBase || "netCommission");
  }, [initialGrossIncomeTaxBase]);

  useEffect(() => {
    const nextPct = toNumber(initialGrossIncomeTaxPct, 0);
    setGrossIncomeTaxPct(nextPct >= 0 ? nextPct : 0);
  }, [initialGrossIncomeTaxPct]);

  const calculatedBreakdown = useMemo<BillingBreakdownOverride>(() => {
    const baseNetoDesglose = round(
      costo - (montoIva21 + montoIva10_5) - otrosImpuestos,
    );
    const transferFeeAmount = round(importeVenta * transferFeePct, 2);
    const taxableBase21 = montoIva21 !== 0 ? round(montoIva21 / 0.21) : 0;
    const taxableBase10_5 = montoIva10_5 !== 0 ? round(montoIva10_5 / 0.105) : 0;
    const margen = round(importeVenta - costo);
    const nonComputable = round(
      baseNetoDesglose - (montoExento + taxableBase21 + taxableBase10_5),
    );

    let commissionExempt = 0;
    let commission21 = 0;
    let commission10_5 = 0;
    let vatOnCommission21 = 0;
    let vatOnCommission10_5 = 0;

    if (commissionVatMode === "automatic") {
      const porcentajeExento =
        baseNetoDesglose !== 0 ? round(montoExento / baseNetoDesglose) : 0;
      const defaultIVA = 0.21;
      if (montoIva21 === 0 && montoIva10_5 === 0) {
        const factor = round(
          porcentajeExento + (1 - porcentajeExento) * (1 + defaultIVA),
        );
        if (factor !== 0) {
          const netComm = round(margen / factor);
          commissionExempt = round(netComm * porcentajeExento);
          const gravada = round(netComm - commissionExempt);
          commission21 = round(gravada);
          vatOnCommission21 = round(commission21 * defaultIVA);
        }
      } else {
        const costoGravable = round(baseNetoDesglose - montoExento);
        const remanente = round(
          costoGravable - (taxableBase21 + taxableBase10_5),
        );
        const eff21 = round(taxableBase21 + remanente);
        const eff10_5 = round(taxableBase10_5);
        const totalEff = round(eff21 + eff10_5);
        const w21 = totalEff !== 0 ? round(eff21 / totalEff) : 0;
        const w10_5 = totalEff !== 0 ? round(eff10_5 / totalEff) : 0;
        const factor = round(
          porcentajeExento +
            (1 - porcentajeExento) * (w21 * (1 + 0.21) + w10_5 * (1 + 0.105)),
        );
        if (factor !== 0) {
          const netComm = round(margen / factor);
          commissionExempt = round(netComm * porcentajeExento);
          const gravada = round(netComm - commissionExempt);
          commission21 = totalEff !== 0 ? round((gravada * eff21) / totalEff) : 0;
          commission10_5 =
            totalEff !== 0 ? round((gravada * eff10_5) / totalEff) : 0;
          vatOnCommission21 = round(commission21 * 0.21);
          vatOnCommission10_5 = round(commission10_5 * 0.105);
        }
      }
    } else {
      const totalBase = round(taxableBase21 + taxableBase10_5);
      const mixedWeight21 =
        totalBase > 0 ? round(taxableBase21 / totalBase, 6) : 0.5;
      const mixedWeight10_5 = round(1 - mixedWeight21, 6);

      let factor = 1;
      if (commissionVatMode === "vat21") factor = 1.21;
      if (commissionVatMode === "vat10_5") factor = 1.105;
      if (commissionVatMode === "mixed") {
        factor = round(mixedWeight21 * 1.21 + mixedWeight10_5 * 1.105, 6);
      }
      const netComm = factor !== 0 ? round(margen / factor) : 0;

      if (commissionVatMode === "exempt") {
        commissionExempt = netComm;
      } else if (commissionVatMode === "vat21") {
        commission21 = netComm;
        vatOnCommission21 = round(commission21 * 0.21);
      } else if (commissionVatMode === "vat10_5") {
        commission10_5 = netComm;
        vatOnCommission10_5 = round(commission10_5 * 0.105);
      } else if (commissionVatMode === "mixed") {
        commission21 = round(netComm * mixedWeight21, 8);
        commission10_5 = round(netComm - commission21, 8);
        vatOnCommission21 = round(commission21 * 0.21);
        vatOnCommission10_5 = round(commission10_5 * 0.105);
      }
    }

    const taxableCardInterest =
      cardInterestIva !== 0 ? round(cardInterestIva / 0.21) : 0;
    const vatOnCardInterest = round(cardInterestIva);
    const totalCommissionWithoutVAT = round(
      commissionExempt + commission21 + commission10_5,
    );
    const impIVA = round(
      montoIva21 +
        montoIva10_5 +
        vatOnCommission21 +
        vatOnCommission10_5 +
        vatOnCardInterest,
      2,
    );

    return {
      nonComputable,
      taxableBase21,
      taxableBase10_5,
      commissionExempt,
      commission21,
      commission10_5,
      vatOnCommission21,
      vatOnCommission10_5,
      totalCommissionWithoutVAT,
      impIVA,
      taxableCardInterest,
      vatOnCardInterest,
      transferFeeAmount,
      transferFeePct,
    };
  }, [
    cardInterestIva,
    commissionVatMode,
    costo,
    importeVenta,
    montoExento,
    montoIva10_5,
    montoIva21,
    otrosImpuestos,
    transferFeePct,
  ]);

  const warningMessages = useMemo(() => {
    const messages: string[] = [];
    const baseNeto = round(costo - (montoIva21 + montoIva10_5) - otrosImpuestos);
    const baseImp = round(
      calculatedBreakdown.taxableBase21 + calculatedBreakdown.taxableBase10_5,
    );
    if (importeVenta <= costo) {
      messages.push("La venta es menor o igual al costo.");
    }
    if (baseNeto < montoExento + baseImp) {
      messages.push(
        "Las bases imponibles + exento superan el costo neto disponible.",
      );
    }
    if (calculatedBreakdown.totalCommissionWithoutVAT < 0) {
      messages.push(
        "La comisión total sin IVA quedó negativa porque la ganancia es negativa.",
      );
    }
    if (calculatedBreakdown.nonComputable < 0) {
      messages.push(
        "El no computable quedó negativo por exceso de bases imponibles/exento.",
      );
    }
    if (baseNeto === 0) {
      messages.push(
        "El costo neto quedó en 0; revisá IVA/exento/otros para evitar divisiones extremas.",
      );
    }
    return messages;
  }, [
    calculatedBreakdown.nonComputable,
    calculatedBreakdown.taxableBase10_5,
    calculatedBreakdown.taxableBase21,
    calculatedBreakdown.totalCommissionWithoutVAT,
    costo,
    importeVenta,
    montoExento,
    montoIva10_5,
    montoIva21,
    otrosImpuestos,
  ]);

  const initialOverrideKey = useMemo(
    () => JSON.stringify(initialBreakdownOverride ?? null),
    [initialBreakdownOverride],
  );

  useEffect(() => {
    if (initialOverrideKeyRef.current === initialOverrideKey) return;
    initialOverrideKeyRef.current = initialOverrideKey;
    if (!initialBreakdownOverride) {
      setManualOverride(null);
      setEditMode(false);
      return;
    }
    setManualOverride(normalizeOverride(initialBreakdownOverride, calculatedBreakdown));
    setEditMode(false);
  }, [calculatedBreakdown, initialBreakdownOverride, initialOverrideKey]);

  const activeBreakdown = manualOverride ?? calculatedBreakdown;
  const netCommissionAfterFee = round(
    activeBreakdown.totalCommissionWithoutVAT - activeBreakdown.transferFeeAmount,
    2,
  );
  const grossIncomeTaxBaseAmount =
    grossIncomeTaxBase === "sale" ? round(importeVenta, 2) : netCommissionAfterFee;
  const grossIncomeTaxAmount = grossIncomeTaxEnabled
    ? round(grossIncomeTaxBaseAmount * (grossIncomeTaxPct / 100), 2)
    : 0;

  const toggleEditMode = useCallback(() => {
    if (!allowBreakdownOverrideEdit) return;
    if (!editMode) {
      setManualOverride((prev) => prev ?? calculatedBreakdown);
      setEditMode(true);
      return;
    }
    setEditMode(false);
  }, [allowBreakdownOverrideEdit, calculatedBreakdown, editMode]);

  const restoreAutomatic = useCallback(() => {
    setManualOverride(null);
    setEditMode(false);
  }, []);

  const updateOverrideField = useCallback(
    (field: BreakdownField, raw: string) => {
      const value = toNumber(raw, 0);
      setManualOverride((prev) => {
        const base = prev ?? calculatedBreakdown;
        return { ...base, [field]: value };
      });
    },
    [calculatedBreakdown],
  );

  useEffect(() => {
    if (!onBillingUpdateRef.current) return;
    const payload: BillingData = {
      nonComputable: activeBreakdown.nonComputable,
      taxableBase21: activeBreakdown.taxableBase21,
      taxableBase10_5: activeBreakdown.taxableBase10_5,
      commissionExempt: activeBreakdown.commissionExempt,
      commission21: activeBreakdown.commission21,
      commission10_5: activeBreakdown.commission10_5,
      vatOnCommission21: activeBreakdown.vatOnCommission21,
      vatOnCommission10_5: activeBreakdown.vatOnCommission10_5,
      totalCommissionWithoutVAT: activeBreakdown.totalCommissionWithoutVAT,
      impIVA: activeBreakdown.impIVA,
      taxableCardInterest: activeBreakdown.taxableCardInterest,
      vatOnCardInterest: activeBreakdown.vatOnCardInterest,
      transferFeeAmount: activeBreakdown.transferFeeAmount,
      transferFeePct: activeBreakdown.transferFeePct,
      breakdownOverride: manualOverride ? activeBreakdown : null,
      breakdownWarningMessages: warningMessages,
      commissionVatMode,
      grossIncomeTaxEnabled,
      grossIncomeTaxBase,
      grossIncomeTaxPct,
      grossIncomeTaxAmount,
    };
    if (sameBillingData(lastPayloadRef.current, payload)) return;
    lastPayloadRef.current = payload;
    onBillingUpdateRef.current(payload);
  }, [
    activeBreakdown,
    commissionVatMode,
    grossIncomeTaxAmount,
    grossIncomeTaxBase,
    grossIncomeTaxEnabled,
    grossIncomeTaxPct,
    manualOverride,
    warningMessages,
  ]);

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat("es-AR", { style: "currency", currency: moneda }),
    [moneda],
  );
  const f = (v: number) => fmt.format(v);
  const margen = round(importeVenta - costo);

  const Row: React.FC<{
    label: string;
    value: number;
    field?: BreakdownField;
  }> = ({ label, value, field }) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200/60 bg-sky-100/30 px-3 py-2 dark:border-sky-600/30 dark:bg-sky-900/10">
      <span className="text-sm">{label}</span>
      {editMode && field ? (
        <input
          type="number"
          value={String(value)}
          step="0.01"
          onChange={(e) => updateOverrideField(field, e.target.value)}
          className="w-40 rounded-xl border border-sky-300/80 bg-white/60 px-2 py-1 text-right text-sm font-medium tabular-nums outline-none focus:border-sky-400/80 focus:ring-2 focus:ring-sky-200/60 dark:border-sky-500/40 dark:bg-white/10"
        />
      ) : (
        <span className="font-medium tabular-nums">{f(value)}</span>
      )}
    </div>
  );

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-sm shadow-sky-950/10 dark:text-white">
      <div className="mb-4 rounded-3xl border border-sky-200/60 bg-sky-100/25 p-3.5 shadow-sm shadow-sky-950/10 transition-colors duration-200 dark:border-sky-600/30 dark:bg-sky-900/10">
        <div className="flex flex-wrap items-center gap-2.5">
          {onAddMiniAdjustment && (
            <button
              type="button"
              onClick={onAddMiniAdjustment}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-sky-300/80 bg-sky-200/45 px-3.5 text-xs font-semibold text-sky-900 shadow-sm shadow-sky-900/10 transition duration-200 hover:-translate-y-0.5 hover:bg-sky-200/65 hover:shadow-md hover:shadow-sky-900/15 active:translate-y-0 active:scale-[0.99] dark:border-sky-500/50 dark:bg-sky-700/35 dark:text-sky-100 dark:hover:bg-sky-700/50"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="size-3.5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 8l5 5 5-5"
                />
              </svg>
              Agregar mini ajuste
              {adjustmentsActiveCount > 0 ? ` (${adjustmentsActiveCount})` : ""}
            </button>
          )}

          <label className="inline-flex h-9 items-center gap-2 rounded-full border border-sky-200/80 bg-white/75 px-3.5 text-xs font-medium shadow-sm shadow-sky-900/5 transition duration-200 hover:-translate-y-0.5 hover:border-sky-300/80 hover:bg-white/90 hover:shadow-md hover:shadow-sky-900/10 dark:border-sky-600/35 dark:bg-sky-900/35 dark:hover:border-sky-500/55 dark:hover:bg-sky-900/55">
            <MiniToggle
              checked={grossIncomeTaxEnabled}
              onChange={setGrossIncomeTaxEnabled}
              ariaLabel="Ingresos Brutos estimado"
            />
            Ingresos Brutos (estimado)
          </label>

          <label className="inline-flex h-9 items-center gap-2 rounded-full border border-sky-200/80 bg-white/75 px-2 pl-3.5 text-xs font-medium shadow-sm shadow-sky-900/5 transition duration-200 hover:-translate-y-0.5 hover:border-sky-300/80 hover:bg-white/90 hover:shadow-md hover:shadow-sky-900/10 dark:border-sky-600/35 dark:bg-sky-900/35 dark:hover:border-sky-500/55 dark:hover:bg-sky-900/55">
            <span className="whitespace-nowrap">IVA comisión</span>
            <select
              value={commissionVatMode}
              onChange={(e) =>
                setCommissionVatMode(
                  e.target.value as
                    | "automatic"
                    | "vat21"
                    | "vat10_5"
                    | "exempt"
                    | "mixed",
                )
              }
              className="h-7 cursor-pointer rounded-lg border border-sky-300/80 bg-white/90 px-2.5 text-xs font-medium outline-none transition focus:border-sky-400/90 focus:ring-2 focus:ring-sky-200/70 dark:border-sky-500/45 dark:bg-sky-900/40 dark:focus:ring-sky-500/35"
            >
              <option value="automatic">Automático</option>
              <option value="vat21">21%</option>
              <option value="vat10_5">10,5%</option>
              <option value="exempt">Exenta</option>
              <option value="mixed">21% + 10,5% (mixto)</option>
            </select>
          </label>

          {allowBreakdownOverrideEdit && (
            <button
              type="button"
              onClick={toggleEditMode}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold shadow-sm shadow-sky-900/10 transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-sky-900/15 active:translate-y-0 active:scale-[0.99] ${
                editMode
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-900 dark:text-emerald-100"
                  : "border-sky-200/80 bg-sky-100/50 text-sky-900 dark:border-sky-600/35 dark:bg-sky-900/25 dark:text-white"
              }`}
              title="Editar desglose"
              aria-label="Editar desglose"
            >
              <PencilIcon className="size-3.5" />
              {editMode ? "Editando" : "Editar"}
            </button>
          )}
          {allowBreakdownOverrideEdit && manualOverride && (
            <button
              type="button"
              onClick={restoreAutomatic}
              className="inline-flex h-9 items-center rounded-full border border-rose-300/55 bg-rose-200/45 px-3.5 text-xs font-semibold text-rose-900 shadow-sm shadow-rose-900/10 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-200/65 hover:shadow-md hover:shadow-rose-900/15 active:translate-y-0 active:scale-[0.99] dark:border-rose-400/35 dark:bg-rose-500/15 dark:text-rose-100 dark:hover:bg-rose-500/25"
            >
              Restaurar automático
            </button>
          )}
        </div>
        {adjustmentsOpen && adjustmentsPanel && (
          <div className="mt-3">{adjustmentsPanel}</div>
        )}
        {commissionVatMode === "mixed" && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-sky-200/70 bg-white/70 px-2.5 py-1 text-[11px] dark:border-sky-600/30 dark:bg-sky-900/30">
              Mixto proporcional: reparto según bases 21% y 10,5%.
            </span>
          </div>
        )}
        {grossIncomeTaxEnabled && (
          <div className="mt-3 rounded-2xl border border-sky-200/60 bg-sky-100/35 p-3 dark:border-sky-600/30 dark:bg-sky-900/15">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs">
                Base
                <select
                  value={grossIncomeTaxBase}
                  onChange={(e) =>
                    setGrossIncomeTaxBase(
                      e.target.value as "netCommission" | "sale",
                    )
                  }
                  className="rounded-lg border border-sky-300/80 bg-white/80 px-2 py-1 text-xs outline-none focus:border-sky-400/80 dark:border-sky-500/40 dark:bg-white/10"
                >
                  <option value="netCommission">Comisión neta</option>
                  <option value="sale">Venta</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-xs">
                Alícuota
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={Number.isFinite(grossIncomeTaxPct) ? grossIncomeTaxPct : 0}
                  onChange={(e) => setGrossIncomeTaxPct(toNumber(e.target.value, 0))}
                  className="w-24 rounded-lg border border-sky-300/80 bg-white/80 px-2 py-1 text-right text-xs outline-none focus:border-sky-400/80 dark:border-sky-500/40 dark:bg-white/10"
                />
                <span>%</span>
              </label>
              <div className="text-sm">
                IIBB estimado:{" "}
                <span className="font-semibold">{f(grossIncomeTaxAmount)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-sky-200/70 bg-sky-100/40 px-3 py-1 text-xs font-medium dark:border-sky-600/30 dark:bg-sky-900/20">
            <span className="opacity-70">Venta: </span>
            <span>{f(importeVenta)}</span>
          </div>
          <div className="rounded-full border border-sky-200/70 bg-sky-100/40 px-3 py-1 text-xs font-medium dark:border-sky-600/30 dark:bg-sky-900/20">
            <span className="opacity-70">Costo: </span>
            <span>{f(costo)}</span>
          </div>
          <div className="rounded-full border border-sky-200/70 bg-sky-100/40 px-3 py-1 text-xs font-medium dark:border-sky-600/30 dark:bg-sky-900/20">
            <span className="opacity-70">Margen: </span>
            <span>{f(margen)}</span>
          </div>
          <div className="rounded-full border border-sky-200/70 bg-sky-100/40 px-3 py-1 text-xs font-medium dark:border-sky-600/30 dark:bg-sky-900/20">
            <span className="opacity-70">
              {(activeBreakdown.transferFeePct * 100).toFixed(2)}% Costos Bancarios:
            </span>{" "}
            <span>{f(activeBreakdown.transferFeeAmount)}</span>
          </div>
          {manualOverride && (
            <div className="rounded-full border border-amber-400/30 bg-amber-300/20 px-3 py-1 text-xs font-semibold text-amber-900 dark:text-amber-100">
              Desglose personalizado
            </div>
          )}
        </div>
      </div>

      {warningMessages.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-300/40 bg-amber-100/30 p-3 text-amber-900 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100">
          <p className="text-sm font-semibold">Warning de consistencia</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {warningMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mb-2 text-base font-semibold">Información</h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Row label="IVA 21%" value={montoIva21} />
        <Row label="IVA 10,5%" value={montoIva10_5} />
        <Row label="Exento" value={montoExento} />
        <Row label="Otros Impuestos" value={otrosImpuestos} />
        <Row label="Intereses Tarjeta" value={cardInterest} />
        <Row label="IVA Intereses" value={cardInterestIva} />
      </div>

      <h3 className="mb-2 mt-6 text-base font-semibold">Desglose de Facturación</h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Row
          label="No Computable"
          value={activeBreakdown.nonComputable}
          field="nonComputable"
        />
        <Row
          label="Gravado 21%"
          value={activeBreakdown.taxableBase21}
          field="taxableBase21"
        />
        <Row
          label="Gravado 10,5%"
          value={activeBreakdown.taxableBase10_5}
          field="taxableBase10_5"
        />
        <Row
          label="Gravado Intereses 21%"
          value={activeBreakdown.taxableCardInterest}
          field="taxableCardInterest"
        />
      </div>

      <h4 className="mb-2 mt-6 text-sm font-semibold">Comisiones</h4>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <Row
          label="Exenta"
          value={activeBreakdown.commissionExempt}
          field="commissionExempt"
        />
        <Row label="21%" value={activeBreakdown.commission21} field="commission21" />
        <Row
          label="10,5%"
          value={activeBreakdown.commission10_5}
          field="commission10_5"
        />
      </div>

      <h4 className="mb-2 mt-6 text-sm font-semibold">IVA sobre Comisiones</h4>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Row
          label="21%"
          value={activeBreakdown.vatOnCommission21}
          field="vatOnCommission21"
        />
        <Row
          label="10,5%"
          value={activeBreakdown.vatOnCommission10_5}
          field="vatOnCommission10_5"
        />
      </div>

      <h4 className="mb-2 mt-6 text-sm font-semibold">IVA sobre Intereses</h4>
      <Row
        label="21%"
        value={activeBreakdown.vatOnCardInterest}
        field="vatOnCardInterest"
      />

      <h4 className="mb-2 mt-6 text-sm font-semibold">Totales</h4>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Row
          label="Comisión total sin IVA"
          value={activeBreakdown.totalCommissionWithoutVAT}
          field="totalCommissionWithoutVAT"
        />
        <Row label="IVA total" value={activeBreakdown.impIVA} field="impIVA" />
        <Row
          label="Costos bancarios"
          value={activeBreakdown.transferFeeAmount}
          field="transferFeeAmount"
        />
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200/60 bg-sky-100/30 px-3 py-2 dark:border-sky-600/30 dark:bg-sky-900/10">
          <span className="text-sm">Costos bancarios %</span>
          {editMode ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={String(round(activeBreakdown.transferFeePct * 100, 4))}
                step="0.01"
                onChange={(e) =>
                  updateOverrideField(
                    "transferFeePct",
                    String(toNumber(e.target.value, 0) / 100),
                  )
                }
                className="w-28 rounded-xl border border-sky-300/80 bg-white/60 px-2 py-1 text-right text-sm font-medium tabular-nums outline-none focus:border-sky-400/80 focus:ring-2 focus:ring-sky-200/60 dark:border-sky-500/40 dark:bg-white/10"
              />
              <span className="text-xs opacity-70">%</span>
            </div>
          ) : (
            <span className="font-medium tabular-nums">
              {(activeBreakdown.transferFeePct * 100).toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {showNetCommissionTotal && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/20 p-3">
          <div className="text-sm opacity-70">
            {grossIncomeTaxEnabled
              ? "Total Comisión (sin IVA, Costos Bancarios e Ingresos Brutos)"
              : "Total Comisión (sin IVA y Costos Bancarios)"}
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {f(
              round(
                activeBreakdown.totalCommissionWithoutVAT -
                  activeBreakdown.transferFeeAmount -
                  (grossIncomeTaxEnabled ? grossIncomeTaxAmount : 0),
                2,
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
