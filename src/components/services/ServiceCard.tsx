// src/components/services/ServiceCard.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Service, BillingAdjustmentComputed } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { normalizeRole } from "@/utils/permissions";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import ServiceFilesPanel from "./ServiceFilesPanel";
import RichNote from "@/components/notes/RichNote";

/** Config API */
type CalcConfigResponse = {
  billing_breakdown_mode: "auto" | "manual";
  transfer_fee_pct: number;
  use_booking_sale_total?: boolean;
};

/** Campos calculados que pueden venir del backend */
type ServiceCalcs = Partial<{
  operator: { name: string };
  nonComputable: number;
  taxableBase21: number;
  taxableBase10_5: number;
  commissionExempt: number;
  commission21: number;
  commission10_5: number;
  vatOnCommission21: number;
  vatOnCommission10_5: number;
  totalCommissionWithoutVAT: number;
  taxableCardInterest: number;
  vatOnCardInterest: number;
  card_interest: number;
  transfer_fee_amount: number | null;
  transfer_fee_pct: number | null;
  extra_costs_amount: number | null;
  extra_taxes_amount: number | null;
  extra_adjustments: BillingAdjustmentComputed[] | null;
}>;

interface ServiceCardProps {
  service: Service & ServiceCalcs;
  expandedServiceId: number | null;
  setExpandedServiceId: React.Dispatch<React.SetStateAction<number | null>>;
  formatDate: (dateString?: string) => string;
  startEditingService: (service: Service) => void;
  deleteService: (id: number) => void;
  duplicateService: (service: Service) => Promise<void>;
  role: string;
  status: string;
  agencyTransferFeePct: number;
  useBookingSaleTotal?: boolean;
}

/* ---------- UI helpers ---------- */
const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="rounded-full border border-white/10 bg-white/20 px-2.5 py-1 text-xs font-medium text-sky-950 dark:bg-white/10 dark:text-white">
    {children}
  </span>
);

const Section: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="rounded-2xl border border-white/10 bg-white/10 p-3">
    {title && (
      <h4 className="mb-2 text-sm font-semibold tracking-tight">{title}</h4>
    )}
    <dl className="divide-y divide-white/10">{children}</dl>
  </section>
);

const Row: React.FC<{ label: string; value?: number | string }> = ({
  label,
  value,
}) => (
  <div className="grid grid-cols-2 items-center gap-2 py-2">
    <dt className="text-sm opacity-80">{label}</dt>
    <dd className="text-right font-medium tabular-nums">{value ?? "–"}</dd>
  </div>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2">
    <p className="text-xs opacity-70">{label}</p>
    <p className="text-base font-medium tabular-nums">{value}</p>
  </div>
);

export default function ServiceCard({
  service,
  expandedServiceId,
  setExpandedServiceId,
  formatDate,
  startEditingService,
  deleteService,
  duplicateService,
  role,
  status,
  agencyTransferFeePct,
  useBookingSaleTotal,
}: ServiceCardProps) {
  const isExpanded = expandedServiceId === service.id_service;
  const serviceNumber = service.agency_service_id ?? service.id_service;
  const { token } = useAuth();

  /* ====== leer modo (auto/manual) desde API — SOLO al expandir ====== */
  const [agencyMode, setAgencyMode] = useState<"auto" | "manual">("auto");
  const [useBookingSaleTotalCfg, setUseBookingSaleTotalCfg] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const cfgRef = useRef<{ ac: AbortController; id: number } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (cfgRef.current) cfgRef.current.ac.abort();
    };
  }, []);

  useEffect(() => {
    // Solo buscamos la config si la card está expandida y tenemos token
    if (!isExpanded || !token) {
      setAgencyMode("auto");
      setUseBookingSaleTotalCfg(false);
      return;
    }

    if (cfgRef.current) cfgRef.current.ac.abort();
    const ac = new AbortController();
    const id = Date.now();
    cfgRef.current = { ac, id };

    const isActive = () =>
      mountedRef.current &&
      cfgRef.current?.id === id &&
      !cfgRef.current.ac.signal.aborted;

    (async () => {
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
          setUseBookingSaleTotalCfg(Boolean(data.use_booking_sale_total));
        }
      } catch {
        if (isActive()) {
          setAgencyMode("auto");
          setUseBookingSaleTotalCfg(false);
        }
      }
    })();

    return () => ac.abort();
  }, [isExpanded, token]);

  const effectiveUseBookingSaleTotal =
    typeof useBookingSaleTotal === "boolean"
      ? useBookingSaleTotal
      : useBookingSaleTotalCfg;
  const manualMode = agencyMode === "manual" || effectiveUseBookingSaleTotal;

  const fmtMoney = useCallback(
    (v?: number) =>
      new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: (service.currency || "ARS").toUpperCase(),
      }).format(Number.isFinite(v ?? 0) ? (v as number) : 0),
    [service.currency],
  );

  const feePct =
    service.transfer_fee_pct != null
      ? Number(service.transfer_fee_pct)
      : Number(agencyTransferFeePct);

  const feeAmount =
    service.transfer_fee_amount != null
      ? Number(service.transfer_fee_amount)
      : Number(service.sale_price || 0) *
        (Number.isFinite(feePct) ? feePct : 0);

  const extraCosts = Number(service.extra_costs_amount ?? 0);
  const extraTaxes = Number(service.extra_taxes_amount ?? 0);
  const extraAdjustments = Array.isArray(service.extra_adjustments)
    ? (service.extra_adjustments as BillingAdjustmentComputed[])
    : [];
  const extraAdjustmentsTotal = extraCosts + extraTaxes;
  const netCommissionRaw =
    (service.totalCommissionWithoutVAT ?? 0) -
    (feeAmount ?? 0) -
    extraAdjustmentsTotal;
  const netCommission = Math.max(netCommissionRaw, 0);
  const showAdjustments =
    Math.abs(extraAdjustmentsTotal) > 0.000001 || extraAdjustments.length > 0;

  const normalizedRole = normalizeRole(role || "");
  const canEditOrDelete =
    status === "Abierta" ||
    normalizedRole === "administrativo" ||
    normalizedRole === "desarrollador" ||
    normalizedRole === "gerente";

  const blocked = String(status || "").toLowerCase() === "bloqueada";
  const canBypassBlocked = ["gerente", "administrativo", "desarrollador"].includes(
    normalizedRole,
  );
  const uploadsDisabled = blocked && !canBypassBlocked;

  const toggleExpand = () =>
    setExpandedServiceId((prev) =>
      prev === service.id_service ? null : service.id_service,
    );

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      await duplicateService(service);
    } finally {
      if (mountedRef.current) setIsDuplicating(false);
    }
  }, [duplicateService, isDuplicating, service]);

  // ¿Hay datos de tarjeta para mostrar?
  const hasCard =
    !manualMode &&
    Boolean(
      (service.card_interest && service.card_interest > 0) ||
        (service.taxableCardInterest && service.taxableCardInterest > 0) ||
        (service.vatOnCardInterest && service.vatOnCardInterest > 0),
    );

  return (
    <motion.div
      layout
      layoutId={`service-${service.id_service}`}
      className="h-fit space-y-4 overflow-hidden rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur-sm dark:text-white"
    >
      {/* Header */}
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleExpand}
              aria-expanded={isExpanded}
              className="grid size-8 place-items-center rounded-full bg-sky-100 text-sky-950 shadow-sm transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
              title={isExpanded ? "Contraer" : "Expandir"}
            >
              {isExpanded ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
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
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              )}
            </button>
            <p className="text-xs opacity-70">
              N° {serviceNumber} •{" "}
              {service.created_at
                ? formatDateInBuenosAires(service.created_at)
                : "–"}
            </p>
          </div>
          <div className="flex">
            <Chip>{service.operator?.name ?? "Operador –"}</Chip>
          </div>
        </div>
        <div className="flex flex-col font-semibold">
          <p>{service.type}</p>
          <p className="text-sm font-normal opacity-70">
            {service.description ? `${service.description}` : ""}
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex h-full items-center">
          <Chip>
            {formatDate(service.departure_date)} →{" "}
            {formatDate(service.return_date)}
          </Chip>
        </div>

        <Stat label="Venta" value={fmtMoney(service.sale_price)} />
        <Stat label="Costo" value={fmtMoney(service.cost_price)} />
        {!isExpanded && (
          <div className="col-span-2 flex h-full items-center">
            <Stat
              label="Total Comisión neta"
              value={
                effectiveUseBookingSaleTotal
                  ? "Se calcula por reserva"
                  : fmtMoney(netCommission)
              }
            />
          </div>
        )}
      </div>

      {/* Detalle */}
      {isExpanded && (
        <>
          <Section title="Detalle">
            <Row label="Destino" value={service.destination || "–"} />
            <Row label="Referencia" value={service.reference || "–"} />
          </Section>

          {String(service.note || "").trim().length > 0 && (
            <Section title="Nota interna">
              <div className="rounded-xl bg-white/30 p-2 dark:bg-white/5">
                <RichNote
                  text={service.note}
                  className="space-y-2 text-sm text-sky-900/85 dark:text-white/80"
                />
              </div>
            </Section>
          )}

          {/* ===== Impuestos ===== */}
          <Section title="Impuestos">
            {manualMode ? (
              <Row label="Impuestos" value={fmtMoney(service.other_taxes)} />
            ) : (
              <>
                <Row label="IVA 21%" value={fmtMoney(service.tax_21)} />
                <Row label="IVA 10,5%" value={fmtMoney(service.tax_105)} />
                <Row label="Exento" value={fmtMoney(service.exempt)} />
                <Row label="Otros" value={fmtMoney(service.other_taxes)} />
              </>
            )}
          </Section>

          {/* ===== Tarjeta (solo AUTO y si hay valores) ===== */}
          {hasCard && (
            <Section title="Tarjeta">
              <Row label="Intereses" value={fmtMoney(service.card_interest)} />
              <Row
                label="Intereses sin IVA"
                value={fmtMoney(service.taxableCardInterest)}
              />
              <Row
                label="IVA Intereses"
                value={fmtMoney(service.vatOnCardInterest)}
              />
            </Section>
          )}

          {/* ===== Desglose de facturación (solo AUTO) ===== */}
          {!manualMode && (
            <Section title="Desglose de facturación">
              <Row
                label="No computable"
                value={fmtMoney(service.nonComputable)}
              />
              <Row
                label="Gravado 21%"
                value={fmtMoney(service.taxableBase21)}
              />
              <Row
                label="Gravado 10,5%"
                value={fmtMoney(service.taxableBase10_5)}
              />
            </Section>
          )}

          {/* ===== Comisiones (solo AUTO) ===== */}
          {!manualMode && (
            <Section title="Comisiones">
              <Row label="Exenta" value={fmtMoney(service.commissionExempt)} />
              <Row label="21%" value={fmtMoney(service.commission21)} />
              <Row label="10,5%" value={fmtMoney(service.commission10_5)} />
              <Row
                label="IVA 21%"
                value={fmtMoney(service.vatOnCommission21)}
              />
              <Row
                label="IVA 10,5%"
                value={fmtMoney(service.vatOnCommission10_5)}
              />
            </Section>
          )}

          {showAdjustments && (
            <Section title="Ajustes extra">
              {extraAdjustments.map((adj) => (
                <Row
                  key={adj.id}
                  label={adj.label}
                  value={fmtMoney(adj.amount)}
                />
              ))}
              <Row
                label="Costos adicionales"
                value={fmtMoney(extraCosts)}
              />
              <Row
                label="Impuestos adicionales"
                value={fmtMoney(extraTaxes)}
              />
            </Section>
          )}

          <Section title="Totales">
            {effectiveUseBookingSaleTotal ? (
              <Row
                label="Total Comisión neta"
                value="Se calcula por reserva"
              />
            ) : (
              <>
                <Row
                  label={`Costos bancarios · ${(Number(feePct || 0) * 100).toFixed(2)}%`}
                  value={fmtMoney(feeAmount)}
                />
                <Row
                  label="Total Comisión neta"
                  value={fmtMoney(netCommission)}
                />
              </>
            )}
          </Section>

          <ServiceFilesPanel
            serviceId={service.id_service}
            expanded={isExpanded}
            uploadsDisabled={uploadsDisabled}
          />

          {/* Acciones */}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={toggleExpand}
              className="rounded-full border border-sky-900/20 bg-white/20 p-2 text-sky-950 shadow-sm shadow-sky-950/15 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-95 hover:bg-white/40 active:scale-90 dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              aria-label="Contraer card"
              title="Contraer"
            >
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
            </button>

            {canEditOrDelete && (
              <button
                type="button"
                onClick={() => {
                  void handleDuplicate();
                }}
                disabled={isDuplicating}
                className="group/btn rounded-full border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-emerald-900 shadow-sm shadow-emerald-950/15 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-95 hover:bg-emerald-500/15 active:scale-90 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-100"
                aria-label="Duplicar servicio"
                title="Duplicar servicio"
              >
                <div className="grid grid-cols-[20px_0fr] items-center gap-0 overflow-hidden transition-[grid-template-columns,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:grid-cols-[20px_1fr] group-hover/btn:gap-2 group-focus-visible/btn:grid-cols-[20px_1fr] group-focus-visible/btn:gap-2">
                  {isDuplicating ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="size-5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="opacity-30"
                      />
                      <path
                        d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3Z"
                        fill="currentColor"
                        className="opacity-90"
                      />
                    </svg>
                  ) : (
                    <>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="size-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.4}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8.25 7.5H6a2.25 2.25 0 0 0-2.25 2.25v8.25A2.25 2.25 0 0 0 6 20.25h8.25A2.25 2.25 0 0 0 16.5 18v-2.25M9.75 3.75H18A2.25 2.25 0 0 1 20.25 6v8.25A2.25 2.25 0 0 1 18 16.5H9.75A2.25 2.25 0 0 1 7.5 14.25V6A2.25 2.25 0 0 1 9.75 3.75Z"
                        />
                      </svg>
                      <span className="min-w-0 translate-x-2 whitespace-nowrap text-sm opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:translate-x-0 group-hover/btn:opacity-100 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:opacity-100">
                        Duplicar
                      </span>
                    </>
                  )}
                </div>
              </button>
            )}

            {canEditOrDelete && (
              <button
                type="button"
                onClick={() => {
                  startEditingService(service);
                  const form = document.getElementById("service-form");
                  if (form) {
                    const y =
                      form.getBoundingClientRect().top +
                      window.pageYOffset -
                      window.innerHeight * 0.1;
                    window.scrollTo({ top: y, behavior: "smooth" });
                  }
                }}
                className="group/btn rounded-full border border-sky-500/35 bg-sky-500/5 px-3 py-2 text-sky-900 shadow-sm shadow-sky-950/15 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-95 hover:bg-sky-500/10 active:scale-90 dark:text-sky-100"
                aria-label="Editar servicio"
                title="Editar servicio"
              >
                <div className="grid grid-cols-[20px_0fr] items-center gap-0 overflow-hidden transition-[grid-template-columns,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:grid-cols-[20px_1fr] group-hover/btn:gap-2 group-focus-visible/btn:grid-cols-[20px_1fr] group-focus-visible/btn:gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.4}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                    />
                  </svg>
                  <span className="min-w-0 translate-x-2 whitespace-nowrap text-sm opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:translate-x-0 group-hover/btn:opacity-100 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:opacity-100">
                    Editar
                  </span>
                </div>
              </button>
            )}

            {canEditOrDelete && (
              <button
                type="button"
                onClick={() => deleteService(service.id_service)}
                className="group/btn rounded-full border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-rose-900 shadow-sm shadow-rose-950/15 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-95 hover:bg-rose-500/15 active:scale-90 dark:text-rose-100"
                aria-label="Eliminar servicio"
                title="Eliminar servicio"
              >
                <div className="grid grid-cols-[20px_0fr] items-center gap-0 overflow-hidden transition-[grid-template-columns,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:grid-cols-[20px_1fr] group-hover/btn:gap-2 group-focus-visible/btn:grid-cols-[20px_1fr] group-focus-visible/btn:gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.4}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    />
                  </svg>
                  <span className="min-w-0 translate-x-2 whitespace-nowrap text-sm opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:translate-x-0 group-hover/btn:opacity-100 group-focus-visible/btn:translate-x-0 group-focus-visible/btn:opacity-100">
                    Eliminar
                  </span>
                </div>
              </button>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
