// src/components/BillingBreakdownManual.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import type { BillingData } from "@/types";

interface Props {
  importeVenta: number;
  costo: number;
  impuestos: number; // ← viene de other_taxes, pero en manual lo llamamos "impuestos"
  moneda?: string;
  onBillingUpdate?: (data: BillingData) => void;
  transferFeePct?: number; // fracción: 0.02 = 2%
  showNetCommissionTotal?: boolean;
}

const round = (v: number, d = 8) => parseFloat(v.toFixed(d));

const sameBillingData = (a: BillingData | null, b: BillingData) => {
  if (!a) return false;
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
};

export default function BillingBreakdownManual({
  importeVenta,
  costo,
  impuestos,
  moneda = "ARS",
  onBillingUpdate,
  transferFeePct = 0.024,
  showNetCommissionTotal = true,
}: Props) {
  const lastPayloadRef = useRef<BillingData | null>(null);
  const onBillingUpdateRef = useRef(onBillingUpdate);

  useEffect(() => {
    onBillingUpdateRef.current = onBillingUpdate;
  }, [onBillingUpdate]);

  // Costos bancarios
  const transferFee = round(importeVenta * (transferFeePct ?? 0), 2);

  // Comisión **antes** del fee (para respetar contrato: totalCommissionWithoutVAT = base antes del fee)
  const commissionBeforeFee = round(importeVenta - costo - impuestos, 2);

  // Comisión **neta** (lo que verá el usuario como “sin impuestos / neta de fee”)
  const commissionNet = round(commissionBeforeFee - transferFee, 2);

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
    };
    if (sameBillingData(lastPayloadRef.current, payload)) return;
    lastPayloadRef.current = payload;
    onBillingUpdateRef.current(payload);
  }, [commissionBeforeFee, transferFee, transferFeePct]);

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
    <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-3 py-2">
      <span className="text-sm">{label}</span>
      <span className="font-medium tabular-nums">{f(value)}</span>
    </div>
  );

  const Chip = (label: string, value: string) => (
    <div className="rounded-full border border-white/10 bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10">
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

      {showNetCommissionTotal && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/20 p-3">
          <div className="text-sm opacity-70">
            Total Comisión (sin IVA) – neta de Costos Bancarios
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {f(commissionNet)}
          </div>
        </div>
      )}
    </div>
  );
}
