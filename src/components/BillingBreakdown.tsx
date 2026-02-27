// src/components/BillingBreakdown.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    sameOverride(a.breakdownOverride ?? null, b.breakdownOverride ?? null) &&
    aWarning === bWarning
  );
};

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
}: BillingBreakdownProps) {
  const lastPayloadRef = useRef<BillingData | null>(null);
  const onBillingUpdateRef = useRef(onBillingUpdate);
  const initialOverrideKeyRef = useRef<string>("");
  const [manualOverride, setManualOverride] = useState<BillingBreakdownOverride | null>(
    null,
  );
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    onBillingUpdateRef.current = onBillingUpdate;
  }, [onBillingUpdate]);

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

    const porcentajeExento =
      baseNetoDesglose !== 0 ? round(montoExento / baseNetoDesglose) : 0;
    let commissionExempt = 0;
    let commission21 = 0;
    let commission10_5 = 0;
    let vatOnCommission21 = 0;
    let vatOnCommission10_5 = 0;

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
      const remanente = round(costoGravable - (taxableBase21 + taxableBase10_5));
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
    };
    if (sameBillingData(lastPayloadRef.current, payload)) return;
    lastPayloadRef.current = payload;
    onBillingUpdateRef.current(payload);
  }, [activeBreakdown, manualOverride, warningMessages]);

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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2">
      <span className="text-sm">{label}</span>
      {editMode && field ? (
        <input
          type="number"
          value={String(value)}
          step="0.01"
          onChange={(e) => updateOverrideField(field, e.target.value)}
          className="w-40 rounded-xl border border-white/10 bg-white/60 px-2 py-1 text-right text-sm font-medium tabular-nums outline-none dark:bg-white/10"
        />
      ) : (
        <span className="font-medium tabular-nums">{f(value)}</span>
      )}
    </div>
  );

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-sm shadow-sky-950/10 dark:text-white">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-white/10 bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10">
            <span className="opacity-70">Venta: </span>
            <span>{f(importeVenta)}</span>
          </div>
          <div className="rounded-full border border-white/10 bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10">
            <span className="opacity-70">Costo: </span>
            <span>{f(costo)}</span>
          </div>
          <div className="rounded-full border border-white/10 bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10">
            <span className="opacity-70">Margen: </span>
            <span>{f(margen)}</span>
          </div>
          <div className="rounded-full border border-white/10 bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10">
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

        {allowBreakdownOverrideEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleEditMode}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                editMode
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-900 dark:text-emerald-100"
                  : "border-white/10 bg-white/20 text-sky-900 dark:text-white"
              }`}
              title="Editar desglose"
              aria-label="Editar desglose"
            >
              <PencilIcon className="size-3.5" />
              {editMode ? "Aplicando cambios" : "Editar desglose"}
            </button>
            {manualOverride && (
              <button
                type="button"
                onClick={restoreAutomatic}
                className="rounded-full border border-rose-300/50 bg-rose-200/40 px-3 py-1 text-xs font-semibold text-rose-900 transition dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-100"
              >
                Restaurar automático
              </button>
            )}
          </div>
        )}
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
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2">
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
                className="w-28 rounded-xl border border-white/10 bg-white/60 px-2 py-1 text-right text-sm font-medium tabular-nums outline-none dark:bg-white/10"
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
            Total Comisión (sin IVA) – neta de Costos Bancarios
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {f(
              round(
                activeBreakdown.totalCommissionWithoutVAT -
                  activeBreakdown.transferFeeAmount,
                2,
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
