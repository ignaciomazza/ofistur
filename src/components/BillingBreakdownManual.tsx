// src/components/BillingBreakdownManual.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BillingData } from "@/types";

interface Props {
  importeVenta: number;
  costo: number;
  impuestos: number; // ← viene de other_taxes, pero en manual lo llamamos "impuestos"
  moneda?: string;
  onBillingUpdate?: (data: BillingData) => void;
  transferFeePct?: number; // fracción: 0.02 = 2%
  showNetCommissionTotal?: boolean;
  initialGrossIncomeTaxEnabled?: boolean;
  initialGrossIncomeTaxBase?: "netCommission" | "sale";
  initialGrossIncomeTaxPct?: number;
}

const round = (v: number, d = 8) => parseFloat(v.toFixed(d));

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

const sameBillingData = (a: BillingData | null, b: BillingData) => {
  if (!a) return false;
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
    aIibbEnabled === bIibbEnabled &&
    aIibbBase === bIibbBase &&
    aIibbPct === bIibbPct &&
    aIibbAmount === bIibbAmount
  );
};

export default function BillingBreakdownManual({
  importeVenta,
  costo,
  impuestos,
  moneda = "ARS",
  onBillingUpdate,
  transferFeePct = 0.024,
  showNetCommissionTotal = true,
  initialGrossIncomeTaxEnabled,
  initialGrossIncomeTaxBase,
  initialGrossIncomeTaxPct,
}: Props) {
  const lastPayloadRef = useRef<BillingData | null>(null);
  const onBillingUpdateRef = useRef(onBillingUpdate);
  const [grossIncomeTaxEnabled, setGrossIncomeTaxEnabled] = useState(false);
  const [grossIncomeTaxBase, setGrossIncomeTaxBase] = useState<
    "netCommission" | "sale"
  >("netCommission");
  const [grossIncomeTaxPct, setGrossIncomeTaxPct] = useState(0);

  useEffect(() => {
    onBillingUpdateRef.current = onBillingUpdate;
  }, [onBillingUpdate]);

  useEffect(() => {
    setGrossIncomeTaxEnabled(initialGrossIncomeTaxEnabled === true);
  }, [initialGrossIncomeTaxEnabled]);

  useEffect(() => {
    setGrossIncomeTaxBase(initialGrossIncomeTaxBase || "netCommission");
  }, [initialGrossIncomeTaxBase]);

  useEffect(() => {
    const nextPct = Number(String(initialGrossIncomeTaxPct ?? 0).replace(",", "."));
    setGrossIncomeTaxPct(Number.isFinite(nextPct) && nextPct >= 0 ? nextPct : 0);
  }, [initialGrossIncomeTaxPct]);

  // Costos bancarios
  const transferFee = round(importeVenta * (transferFeePct ?? 0), 2);

  // Comisión **antes** del fee (para respetar contrato: totalCommissionWithoutVAT = base antes del fee)
  const commissionBeforeFee = round(importeVenta - costo - impuestos, 2);

  // Comisión **neta** (lo que verá el usuario como “sin impuestos / neta de fee”)
  const commissionNet = round(commissionBeforeFee - transferFee, 2);
  const grossIncomeTaxBaseAmount =
    grossIncomeTaxBase === "sale" ? round(importeVenta, 2) : commissionNet;
  const grossIncomeTaxAmount = grossIncomeTaxEnabled
    ? round(grossIncomeTaxBaseAmount * (grossIncomeTaxPct / 100), 2)
    : 0;

  // En modo manual asumimos exento total → no computables y bases gravadas/IVA = 0
  useEffect(() => {
    if (!onBillingUpdateRef.current) return;
    const payload: BillingData = {
      nonComputable: 0,
      taxableBase21: 0,
      taxableBase10_5: 0,
      commissionExempt: commissionBeforeFee, // toda la comisión es exenta
      commission21: 0,
      commission10_5: 0,
      vatOnCommission21: 0,
      vatOnCommission10_5: 0,
      totalCommissionWithoutVAT: commissionBeforeFee, // **antes** de restar fee
      impIVA: 0,
      taxableCardInterest: 0,
      vatOnCardInterest: 0,
      transferFeeAmount: transferFee,
      transferFeePct: transferFeePct ?? 0,
      grossIncomeTaxEnabled,
      grossIncomeTaxBase,
      grossIncomeTaxPct,
      grossIncomeTaxAmount,
    };
    if (sameBillingData(lastPayloadRef.current, payload)) return;
    lastPayloadRef.current = payload;
    onBillingUpdateRef.current(payload);
  }, [
    commissionBeforeFee,
    grossIncomeTaxAmount,
    grossIncomeTaxBase,
    grossIncomeTaxEnabled,
    grossIncomeTaxPct,
    transferFee,
    transferFeePct,
  ]);

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat("es-AR", { style: "currency", currency: moneda }),
    [moneda],
  );
  const f = (n: number) => fmt.format(n || 0);

  const Row: React.FC<{ label: string; value: number }> = ({
    label,
    value,
  }) => (
    <div className="flex items-center justify-between rounded-xl border border-sky-200/60 bg-sky-100/30 px-3 py-2 dark:border-sky-600/30 dark:bg-sky-900/10">
      <span className="text-sm">{label}</span>
      <span className="font-medium tabular-nums">{f(value)}</span>
    </div>
  );

  const Chip = (label: string, value: string) => (
    <div className="rounded-full border border-sky-200/70 bg-sky-100/40 px-3 py-1 text-xs font-medium dark:border-sky-600/30 dark:bg-sky-900/20">
      <span className="opacity-70">{label}: </span>
      <span>{value}</span>
    </div>
  );

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-sm shadow-sky-950/10 dark:text-white">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {Chip("Modo", "Manual (Exento)")}
        {Chip("Venta", f(importeVenta))}
        {Chip("Costo", f(costo))}
        {Chip(
          `${(transferFeePct * 100).toFixed(2)}% Costos Bancarios`,
          f(transferFee),
        )}
      </div>

      <h3 className="mb-2 text-base font-semibold">Impuestos</h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Row label="Impuestos (manual)" value={impuestos} />
        <Row label="Costos bancarios" value={transferFee} />
      </div>

      <div className="mt-4 rounded-2xl border border-sky-200/60 bg-sky-100/25 p-3 dark:border-sky-600/30 dark:bg-sky-900/10">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs font-medium">
            <MiniToggle
              checked={grossIncomeTaxEnabled}
              onChange={setGrossIncomeTaxEnabled}
              ariaLabel="Ingresos Brutos estimado"
            />
            Ingresos Brutos (estimado)
          </label>
        </div>
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
                  onChange={(e) =>
                    setGrossIncomeTaxPct(
                      Number(e.target.value.replace(",", ".")) || 0,
                    )
                  }
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

      {showNetCommissionTotal && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/20 p-3">
          <div className="text-sm opacity-70">
            {grossIncomeTaxEnabled
              ? "Total Comisión (sin IVA, Costos Bancarios e Ingresos Brutos)"
              : "Total Comisión (sin IVA y Costos Bancarios)"}
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {f(round(commissionNet - (grossIncomeTaxEnabled ? grossIncomeTaxAmount : 0), 2))}
          </div>
        </div>
      )}
    </div>
  );
}
