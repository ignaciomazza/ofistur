// src/components/investments/ServiceAllocationsEditor.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { parseAmountInput } from "@/utils/receipts/receiptForm";

export type AllocationService = {
  id_service: number;
  agency_service_id?: number | null;
  booking_id: number;
  currency: string;
  cost_price?: number | null;
  type?: string | null;
  destination?: string | null;
  booking?: { id_booking: number; agency_booking_id?: number | null } | null;
};

export type AllocationPayload = {
  service_id: number;
  booking_id?: number | null;
  payment_currency: string;
  service_currency: string;
  amount_payment: number;
  amount_service: number;
  fx_rate?: number | null;
};

export type AllocationSummary = {
  allocations: AllocationPayload[];
  assignedTotal: number;
  missingAmountCount: number;
  missingFxCount: number;
  overAssigned: boolean;
  excess: number;
};

export type ExcessAction = "carry" | "credit_entry";
export type ExcessMissingAccountAction = "carry" | "block" | "create";

const inputBase =
  "w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 shadow-sm shadow-sky-950/10 outline-none placeholder:font-light dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";

const pillBase = "rounded-full px-3 py-1 text-xs font-medium";
const pillNeutral = "bg-white/30 dark:bg-white/10";
const pillWarn = "bg-rose-500/15 text-rose-700 dark:text-rose-300";
const pillOk = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";

const ASSIGNMENT_TOLERANCE = 0.01;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const formatAmountInput = (n: number, decimals = 2) => {
  const fixed = n.toFixed(decimals);
  return fixed
    .replace(/(\.\d*?[1-9])0+$/g, "$1")
    .replace(/\.0+$/, "");
};

function formatMoney(n: number, cur = "ARS") {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

type Draft = { amount_service: string; counter_amount: string };

type Props = {
  services: AllocationService[];
  paymentCurrency: string;
  paymentAmount: number;
  initialAllocations?: AllocationPayload[];
  resetKey?: number;
  excessAction: ExcessAction;
  onExcessActionChange: (next: ExcessAction) => void;
  excessMissingAccountAction: ExcessMissingAccountAction;
  onExcessMissingAccountActionChange: (
    next: ExcessMissingAccountAction,
  ) => void;
  onSummaryChange: (summary: AllocationSummary) => void;
};

export default function ServiceAllocationsEditor({
  services,
  paymentCurrency,
  paymentAmount,
  initialAllocations,
  resetKey,
  excessAction,
  onExcessActionChange,
  excessMissingAccountAction,
  onExcessMissingAccountActionChange,
  onSummaryChange,
}: Props) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const lastReset = useRef<number | undefined>(undefined);
  const paymentCur = (paymentCurrency || "").toUpperCase();

  const initialMap = useMemo(() => {
    const map = new Map<number, AllocationPayload>();
    (initialAllocations || []).forEach((a) => {
      map.set(a.service_id, a);
    });
    return map;
  }, [initialAllocations]);

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<number, Draft> = {};
      const shouldReset =
        resetKey !== undefined && resetKey !== lastReset.current;
      if (shouldReset) lastReset.current = resetKey;

      services.forEach((svc) => {
        const existing = !shouldReset ? prev[svc.id_service] : undefined;
        if (existing) {
          next[svc.id_service] = existing;
          return;
        }
        const initial = initialMap.get(svc.id_service);
        if (initial) {
          const serviceCur = (svc.currency || "").toUpperCase();
          const initialAmountService = Number(initial.amount_service);
          const initialAmountPayment = Number(initial.amount_payment);
          const initialFx = Number(initial.fx_rate);
          const derivedCounter =
            Number.isFinite(initialAmountPayment) && initialAmountPayment >= 0
              ? initialAmountPayment
              : Number.isFinite(initialAmountService) &&
                  Number.isFinite(initialFx) &&
                  initialAmountService >= 0 &&
                  initialFx > 0
                ? round2(initialAmountService * initialFx)
                : NaN;
          next[svc.id_service] = {
            amount_service:
              Number.isFinite(initialAmountService) && initialAmountService >= 0
                ? formatAmountInput(initialAmountService, 2)
                : "",
            counter_amount:
              serviceCur !== paymentCur &&
              Number.isFinite(derivedCounter) &&
              derivedCounter >= 0
                ? formatAmountInput(derivedCounter, 2)
                : "",
          };
          return;
        }
        next[svc.id_service] = { amount_service: "", counter_amount: "" };
      });
      return next;
    });
  }, [services, initialMap, resetKey, paymentCur]);

  const rows = useMemo(() => {
    return services.map((svc) => {
      const draft = drafts[svc.id_service] || {
        amount_service: "",
        counter_amount: "",
      };
      const serviceCur = (svc.currency || "").toUpperCase();
      const amountService = parseAmountInput(draft.amount_service);
      const counterAmount = parseAmountInput(draft.counter_amount);
      const sameCurrency = serviceCur === paymentCur;
      const missingAmount = amountService == null || amountService < 0;
      const missingCounter =
        !sameCurrency && (counterAmount == null || counterAmount < 0);
      const missingFx = missingCounter;
      const amountPayment =
        !missingAmount && !missingCounter
          ? round2(
              sameCurrency
                ? Number(amountService)
                : Number(counterAmount || 0),
            )
          : 0;
      const fxRate =
        !sameCurrency &&
        !missingAmount &&
        !missingCounter &&
        Number(amountService) > 0
          ? Number(amountPayment) / Number(amountService)
          : null;
      const diffCost =
        amountService != null && svc.cost_price != null
          ? round2(amountService - Number(svc.cost_price))
          : null;

      return {
        service: svc,
        serviceCur,
        amountService,
        counterAmount,
        fxRate,
        amountPayment,
        missingAmount,
        missingFx,
        diffCost,
      };
    });
  }, [services, drafts, paymentCur]);

  const summary = useMemo<AllocationSummary>(() => {
    const assignedTotal = round2(
      rows.reduce((sum, r) => sum + Number(r.amountPayment || 0), 0),
    );
    const paymentAmountSafe = Number.isFinite(paymentAmount)
      ? Number(paymentAmount)
      : 0;
    const overAssigned =
      assignedTotal - paymentAmountSafe > ASSIGNMENT_TOLERANCE;
    const excess = round2(paymentAmountSafe - assignedTotal);
    const allocations: AllocationPayload[] = rows.map((r) => ({
      service_id: r.service.id_service,
      booking_id: r.service.booking_id,
      payment_currency: paymentCur,
      service_currency: r.serviceCur,
      amount_payment: Number(r.amountPayment || 0),
      amount_service: r.amountService != null && r.amountService >= 0 ? Number(r.amountService) : 0,
      fx_rate: r.serviceCur === paymentCur ? null : r.fxRate ?? null,
    }));

    return {
      allocations,
      assignedTotal,
      missingAmountCount: rows.filter((r) => r.missingAmount).length,
      missingFxCount: rows.filter((r) => r.missingFx).length,
      overAssigned,
      excess,
    };
  }, [rows, paymentAmount, paymentCur]);

  useEffect(() => {
    onSummaryChange(summary);
  }, [summary, onSummaryChange]);

  const setAmountService = useCallback((id: number, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { amount_service: "", counter_amount: "" }),
        amount_service: value,
      },
    }));
  }, []);

  const setCounterAmount = useCallback((id: number, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { amount_service: "", counter_amount: "" }),
        counter_amount: value,
      },
    }));
  }, []);

  const applyProrationByCost = useCallback(() => {
    if (!Number.isFinite(paymentAmount) || Number(paymentAmount) <= 0) {
      toast.warn("Ingresá un monto de pago válido para prorratear.");
      return;
    }
    const rowsWithFx = rows.map((r) => {
      const fx = r.serviceCur === paymentCur ? 1 : r.fxRate;
      return { ...r, fx };
    });
    const missingFx = rowsWithFx.some(
      (r) => r.serviceCur !== paymentCur && (!r.fx || r.fx <= 0),
    );
    if (missingFx) {
      toast.error(
        "Completá monto y contravalor en servicios de otra moneda para prorratear por costo.",
      );
      return;
    }
    const weights = rowsWithFx.map((r) => {
      const base = Number(r.service.cost_price || 0);
      return r.serviceCur === paymentCur ? base : base * Number(r.fx || 0);
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) {
      toast.warn("No hay costos válidos para prorratear.");
      return;
    }

    let remaining = round2(Number(paymentAmount));
    setDrafts((prev) => {
      const next = { ...prev };
      rowsWithFx.forEach((r, idx) => {
        const ratio = weights[idx] / totalWeight;
        const isLast = idx === rowsWithFx.length - 1;
        const amountPayment = isLast
          ? remaining
          : round2(Number(paymentAmount) * ratio);
        if (!isLast) remaining = round2(remaining - amountPayment);
        const amountService =
          r.serviceCur === paymentCur
            ? amountPayment
            : round2(amountPayment / Number(r.fx || 1));
        next[r.service.id_service] = {
          amount_service: formatAmountInput(amountService, 2),
          counter_amount:
            r.serviceCur === paymentCur
              ? ""
              : formatAmountInput(amountPayment, 2),
        };
      });
      return next;
    });
  }, [paymentAmount, rows, paymentCur]);

  const applyProrationEqual = useCallback(() => {
    if (!Number.isFinite(paymentAmount) || Number(paymentAmount) <= 0) {
      toast.warn("Ingresá un monto de pago válido para prorratear.");
      return;
    }
    const rowsWithFx = rows.map((r) => {
      const fx = r.serviceCur === paymentCur ? 1 : r.fxRate;
      return { ...r, fx };
    });
    const missingFx = rowsWithFx.some(
      (r) => r.serviceCur !== paymentCur && (!r.fx || r.fx <= 0),
    );
    if (missingFx) {
      toast.error(
        "Completá monto y contravalor en servicios de otra moneda para repartir en partes iguales.",
      );
      return;
    }
    const count = rowsWithFx.length || 1;
    let remaining = round2(Number(paymentAmount));
    setDrafts((prev) => {
      const next = { ...prev };
      rowsWithFx.forEach((r, idx) => {
        const isLast = idx === rowsWithFx.length - 1;
        const amountPayment = isLast
          ? remaining
          : round2(Number(paymentAmount) / count);
        if (!isLast) remaining = round2(remaining - amountPayment);
        const amountService =
          r.serviceCur === paymentCur
            ? amountPayment
            : round2(amountPayment / Number(r.fx || 1));
        next[r.service.id_service] = {
          amount_service: formatAmountInput(amountService, 2),
          counter_amount:
            r.serviceCur === paymentCur
              ? ""
              : formatAmountInput(amountPayment, 2),
        };
      });
      return next;
    });
  }, [paymentAmount, rows, paymentCur]);

  const applyUseCosts = useCallback(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      rows.forEach((r) => {
        const base = Number(r.service.cost_price || 0);
        next[r.service.id_service] = {
          amount_service: formatAmountInput(base, 2),
          counter_amount:
            r.serviceCur === paymentCur
              ? ""
              : prev[r.service.id_service]?.counter_amount || "",
        };
      });
      return next;
    });
  }, [rows, paymentCur]);

  const clearAll = useCallback(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      rows.forEach((r) => {
        next[r.service.id_service] = { amount_service: "", counter_amount: "" };
      });
      return next;
    });
  }, [rows]);

  const grouped = useMemo(() => {
    const map = new Map<number, { bookingId: number; bookingLabel: string; services: typeof rows }>();
    rows.forEach((row) => {
      const bookingId = row.service.booking_id;
      const label = row.service.booking?.agency_booking_id
        ? `Reserva ${row.service.booking.agency_booking_id}`
        : `Reserva ${bookingId}`;
      const existing = map.get(bookingId);
      if (existing) existing.services.push(row);
      else map.set(bookingId, { bookingId, bookingLabel: label, services: [row] });
    });
    return Array.from(map.values());
  }, [rows]);

  if (services.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={applyProrationByCost}
          title="Distribuye el monto proporcional al costo de cada servicio."
          className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
        >
          Distribuir según costo (Recomendado)
        </button>
        <button
          type="button"
          onClick={applyProrationEqual}
          title="Divide el monto en partes iguales entre los servicios."
          className="rounded-full border border-white/10 bg-white/30 px-3 py-1 text-xs font-semibold transition hover:bg-white/50 dark:bg-white/10"
        >
          Distribuir en partes iguales
        </button>
        <button
          type="button"
          onClick={applyUseCosts}
          title="Carga el costo de cada servicio como monto inicial."
          className="rounded-full border border-white/10 bg-white/30 px-3 py-1 text-xs font-semibold transition hover:bg-white/50 dark:bg-white/10"
        >
          Usar costos como monto
        </button>
        <button
          type="button"
          onClick={clearAll}
          title="Limpia los montos y contravalores cargados."
          className="rounded-full border border-white/10 bg-white/30 px-3 py-1 text-xs font-semibold transition hover:bg-white/50 dark:bg-white/10"
        >
          Borrar montos
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className={`${pillBase} ${pillNeutral}`}>
          Aplicado al pago: {formatMoney(summary.assignedTotal, paymentCur || "ARS")}
        </span>
        <span className={`${pillBase} ${pillNeutral}`}>
          Monto del pago: {formatMoney(Number(paymentAmount || 0), paymentCur || "ARS")}
        </span>
        {summary.overAssigned && (
          <span className={`${pillBase} ${pillWarn}`}>
            El total asignado supera el monto del pago
          </span>
        )}
        {!summary.overAssigned && summary.excess > ASSIGNMENT_TOLERANCE && (
          <span className={`${pillBase} ${pillOk}`}>
            Saldo sin asignar:{" "}
            {formatMoney(summary.excess, paymentCur || "ARS")}
          </span>
        )}
      </div>

      {(summary.missingAmountCount > 0 || summary.missingFxCount > 0) && (
        <div className="text-xs text-amber-600">
          {summary.missingAmountCount > 0 && (
            <div>
              Faltan montos a asignar en {summary.missingAmountCount} servicio(s).
            </div>
          )}
          {summary.missingFxCount > 0 && (
            <div>
              Faltan contravalores en {summary.missingFxCount} servicio(s).
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {grouped.map((group) => (
          <div key={`booking-${group.bookingId}`} className="rounded-2xl border border-white/10 p-3">
            <div className="mb-2 text-xs font-semibold text-sky-950/70 dark:text-white/70">
              {group.bookingLabel}
            </div>
            <div className="space-y-2">
              {group.services.map((row) => {
                const svc = row.service;
                return (
                  <div
                    key={`alloc-${svc.id_service}`}
                    className="grid grid-cols-1 items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 md:grid-cols-6"
                  >
                    <div className="md:col-span-2">
                      <div className="text-sm font-medium">
                        N° {svc.agency_service_id ?? svc.id_service} · {svc.type}
                      </div>
                      <div className="text-xs text-sky-950/70 dark:text-white/70">
                        {svc.destination || ""}
                      </div>
                    </div>
                    <div className="text-xs md:text-sm">
                      <div className="text-sky-950/70 dark:text-white/70">Costo</div>
                      <div>
                        {formatMoney(Number(svc.cost_price || 0), row.serviceCur || "ARS")}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-sky-950/70 dark:text-white/70">
                        Monto a aplicar ({row.serviceCur})
                      </label>
                      <input
                        className={inputBase}
                        inputMode="decimal"
                        value={drafts[svc.id_service]?.amount_service || ""}
                        onChange={(e) => setAmountService(svc.id_service, e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      {row.serviceCur !== paymentCur ? (
                        <>
                          <label className="text-xs text-sky-950/70 dark:text-white/70">
                            Contravalor ({paymentCur || ""})
                          </label>
                          <input
                            className={inputBase}
                            inputMode="decimal"
                            value={drafts[svc.id_service]?.counter_amount || ""}
                            onChange={(e) =>
                              setCounterAmount(svc.id_service, e.target.value)
                            }
                            placeholder="0"
                          />
                        </>
                      ) : (
                        <div className="text-xs text-sky-950/70 dark:text-white/70">
                          Misma moneda (mismo valor)
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-sky-950/70 dark:text-white/70">
                        Equivalente en pago ({paymentCur || ""})
                      </div>
                      <div className="text-sm font-semibold">
                        {formatMoney(row.amountPayment, paymentCur || "ARS")}
                      </div>
                      {row.diffCost != null && row.diffCost !== 0 && (
                        <div className="text-[11px] text-sky-950/60 dark:text-white/60">
                          {row.diffCost > 0 ? "Sobrepago" : "Saldo"} {formatMoney(Math.abs(row.diffCost), row.serviceCur || "ARS")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!summary.overAssigned && summary.excess > ASSIGNMENT_TOLERANCE && (
        <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
          <div className="text-sm font-semibold">Saldo sin asignar</div>
          <div className="mt-1 text-xs text-sky-950/70 dark:text-white/70">
            Elegí qué hacer con la diferencia no asignada.
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="excess_action"
                checked={excessAction === "carry"}
                onChange={() => onExcessActionChange("carry")}
                className="mt-1"
              />
              <div>
                <div>Dejar como saldo a favor (anticipo) (Recomendado)</div>
                <div className="text-xs text-sky-950/60 dark:text-white/60">
                  Queda registrado para futuros pagos al operador.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="excess_action"
                checked={excessAction === "credit_entry"}
                onChange={() => onExcessActionChange("credit_entry")}
                className="mt-1"
              />
              <div>
                <div>Registrar en cuenta corriente del operador</div>
                <div className="text-xs text-sky-950/60 dark:text-white/60">
                  Genera un movimiento por el excedente.
                </div>
              </div>
            </label>
          </div>

          {excessAction === "credit_entry" && (
            <div className="mt-3">
              <div className="text-xs text-sky-950/70 dark:text-white/70">
                Si no existe cuenta corriente en la moneda del pago:
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="excess_missing_account_action"
                    checked={excessMissingAccountAction === "carry"}
                    onChange={() => onExcessMissingAccountActionChange("carry")}
                    className="mt-1"
                  />
                  <div>
                    <div>Pasar a saldo a favor y avisar (Recomendado)</div>
                    <div className="text-xs text-sky-950/60 dark:text-white/60">
                      No se crea el movimiento, se guarda como saldo a favor.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="excess_missing_account_action"
                    checked={excessMissingAccountAction === "block"}
                    onChange={() => onExcessMissingAccountActionChange("block")}
                    className="mt-1"
                  />
                  <div>
                    <div>Bloquear y solicitar crear cuenta</div>
                    <div className="text-xs text-sky-950/60 dark:text-white/60">
                      No permite guardar hasta que exista una cuenta.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="excess_missing_account_action"
                    checked={excessMissingAccountAction === "create"}
                    onChange={() => onExcessMissingAccountActionChange("create")}
                    className="mt-1"
                  />
                  <div>
                    <div>Crear la cuenta automáticamente</div>
                    <div className="text-xs text-sky-950/60 dark:text-white/60">
                      Crea la cuenta y registra el movimiento.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
