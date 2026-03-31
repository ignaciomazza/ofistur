// src/components/services/ServiceList.tsx
"use client";
import React, { useMemo, useCallback, useEffect, useState } from "react";
import ServiceCard from "./ServiceCard";
import SummaryCard from "./SummaryCard";
import {
  Service,
  Receipt,
  CommissionOverrides,
  OperatorDue,
} from "@/types";
import { formatDateOnlyInBuenosAires } from "@/lib/buenosAiresDate";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";

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
  commissionExempt: number;
  commission21: number;
  commission10_5: number;
  vatOnCommission21: number;
  vatOnCommission10_5: number;
  totalCommissionWithoutVAT: number;
  /** Fallback cuando no hay desglose de intereses de tarjeta */
  cardInterestRaw?: number;
  transferFeesAmount: number;
  extra_costs_amount: number;
  extra_taxes_amount: number;
}

type ServiceWithCalcs = Service &
  Partial<{
    taxableCardInterest: number;
    vatOnCardInterest: number;
    nonComputable: number;
    taxableBase21: number;
    taxableBase10_5: number;
    commissionExempt: number;
    commission21: number;
    commission10_5: number;
    vatOnCommission21: number;
    vatOnCommission10_5: number;
    totalCommissionWithoutVAT: number;
    card_interest: number;
    transfer_fee_pct: number | null;
    transfer_fee_amount: number | null;
    extra_costs_amount: number | null;
    extra_taxes_amount: number | null;
  }>;

type NumericKeys = Extract<keyof Totals, keyof ServiceWithCalcs>;

const KEYS_TO_SUM: readonly NumericKeys[] = [
  "sale_price",
  "cost_price",
  "tax_21",
  "tax_105",
  "exempt",
  "other_taxes",
  "taxableCardInterest",
  "vatOnCardInterest",
  "nonComputable",
  "taxableBase21",
  "taxableBase10_5",
  "commissionExempt",
  "commission21",
  "commission10_5",
  "vatOnCommission21",
  "vatOnCommission10_5",
  "totalCommissionWithoutVAT",
  "extra_costs_amount",
  "extra_taxes_amount",
];

const toPositiveInt = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const truncate = (value: string, max: number): string => {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

interface ServiceListProps {
  services: Service[];
  /** NUEVO: recibos para pasar a SummaryCard y calcular deuda */
  receipts: Receipt[];
  operatorDues?: OperatorDue[];
  operatorPaymentsReloadKey?: number;

  expandedServiceId: number | null;
  setExpandedServiceId: React.Dispatch<React.SetStateAction<number | null>>;
  startEditingService: (service: Service) => void;
  deleteService: (id: number) => void;
  duplicateService: (service: Service) => Promise<void>;
  role: string;
  status: string;
  agencyTransferFeePct: number;
  useBookingSaleTotal?: boolean;
  bookingSaleTotals?: Record<string, number>;
  bookingSaleTotalsForm?: React.ReactNode;
  onSaveCommission?: (overrides: CommissionOverrides | null) => Promise<boolean>;
}

export default function ServiceList({
  services,
  receipts,
  operatorDues = [],
  operatorPaymentsReloadKey,
  expandedServiceId,
  setExpandedServiceId,
  startEditingService,
  deleteService,
  duplicateService,
  role,
  status,
  agencyTransferFeePct,
  useBookingSaleTotal,
  bookingSaleTotals,
  bookingSaleTotalsForm,
  onSaveCommission,
}: ServiceListProps) {
  const { token } = useAuth();
  const [operatorPaymentsByService, setOperatorPaymentsByService] = useState<
    Record<number, string[]>
  >({});

  const formatDate = useCallback(
    (dateString?: string) =>
      dateString ? formatDateOnlyInBuenosAires(dateString) : "N/A",
    [],
  );

  const fmtCurrency = useCallback(
    (value: number, currency: string) =>
      new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: currency?.toUpperCase() || "ARS",
      }).format(Number.isFinite(value) ? value : 0),
    [],
  );

  // Agrupar y sumar totales por moneda (incluye fallback card_interest -> cardInterestRaw)
  const totalsByCurrency = useMemo(() => {
    const zero: Totals = {
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
      commissionExempt: 0,
      commission21: 0,
      commission10_5: 0,
      vatOnCommission21: 0,
      vatOnCommission10_5: 0,
      totalCommissionWithoutVAT: 0,
      cardInterestRaw: 0,
      transferFeesAmount: 0,
      extra_costs_amount: 0,
      extra_taxes_amount: 0,
    };

    return services.reduce<Record<string, Totals>>((acc, s) => {
      const svc = s as ServiceWithCalcs;
      const c = (svc.currency || "ARS").toUpperCase();
      if (!acc[c]) acc[c] = { ...zero };
      const t = acc[c];

      for (const k of KEYS_TO_SUM) {
        const v = svc[k];
        if (typeof v === "number" && Number.isFinite(v)) {
          t[k] += v;
        }
      }

      // Fallback tarjeta: si no hay desglose, usamos el bruto card_interest
      const splitNoVAT = svc.taxableCardInterest ?? 0;
      const splitVAT = svc.vatOnCardInterest ?? 0;
      const raw = svc.card_interest ?? 0;

      if (splitNoVAT + splitVAT <= 0 && raw > 0) {
        t.cardInterestRaw = (t.cardInterestRaw || 0) + raw;
      }

      const pct =
        svc.transfer_fee_pct != null
          ? Number(svc.transfer_fee_pct)
          : Number(agencyTransferFeePct);

      const feeAmount =
        svc.transfer_fee_amount != null
          ? Number(svc.transfer_fee_amount)
          : Number(svc.sale_price || 0) * (Number.isFinite(pct) ? pct : 0);

      if (Number.isFinite(feeAmount)) t.transferFeesAmount += feeAmount;

      return acc;
    }, {});
  }, [services, agencyTransferFeePct]);

  const bookingId = useMemo(() => {
    for (const service of services) {
      const id = toPositiveInt(
        (service as Service & { booking_id?: unknown }).booking_id ??
          (service as Service & { booking?: { id_booking?: unknown } }).booking
            ?.id_booking,
      );
      if (id != null) return id;
    }
    return null;
  }, [services]);

  useEffect(() => {
    if (!token || !bookingId) {
      setOperatorPaymentsByService({});
      return;
    }

    const ac = new AbortController();
    let active = true;

    void (async () => {
      try {
        const serviceMap = new Map<number, string[]>();
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

          for (const item of items) {
            if (!item || typeof item !== "object") continue;
            const rec = item as Record<string, unknown>;
            const investmentId = toPositiveInt(
              rec.agency_investment_id ?? rec.id_investment,
            );
            if (investmentId == null) continue;

            const rawDescription = String(rec.description || "").trim();
            const line = `N° ${investmentId} • ${truncate(
              rawDescription || "Pago a operador",
              46,
            )}`;

            const rawServiceIds: unknown[] = [];
            if (Array.isArray(rec.serviceIds)) rawServiceIds.push(...rec.serviceIds);
            if (Array.isArray(rec.allocations)) {
              for (const alloc of rec.allocations) {
                if (alloc && typeof alloc === "object") {
                  rawServiceIds.push(
                    (alloc as { service_id?: unknown }).service_id,
                  );
                }
              }
            }

            const serviceIds = Array.from(
              new Set(
                rawServiceIds
                  .map(toPositiveInt)
                  .filter((id): id is number => id != null),
              ),
            );

            for (const serviceId of serviceIds) {
              const existing = serviceMap.get(serviceId) ?? [];
              if (!existing.includes(line)) existing.push(line);
              serviceMap.set(serviceId, existing);
            }
          }

          const next = toPositiveInt(json?.nextCursor);
          if (!next || items.length === 0) break;
          cursor = next;
        }

        if (!active) return;
        setOperatorPaymentsByService(Object.fromEntries(serviceMap.entries()));
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return;
        if (active) setOperatorPaymentsByService({});
      }
    })();

    return () => {
      active = false;
      ac.abort();
    };
  }, [token, bookingId, operatorPaymentsReloadKey]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <ServiceCard
            key={service.id_service}
            service={service as ServiceWithCalcs}
            expandedServiceId={expandedServiceId}
            setExpandedServiceId={setExpandedServiceId}
            startEditingService={startEditingService}
            deleteService={deleteService}
            duplicateService={duplicateService}
            formatDate={formatDate}
            role={role}
            status={status}
            agencyTransferFeePct={agencyTransferFeePct}
            useBookingSaleTotal={useBookingSaleTotal}
            operatorPaymentRefs={operatorPaymentsByService[service.id_service] ?? []}
          />
        ))}
      </div>

      {bookingSaleTotalsForm}

      <div>
        <div className="mb-4 mt-8 flex justify-center">
          <p className="text-2xl font-medium">Resumen</p>
        </div>
        <SummaryCard
          totalsByCurrency={totalsByCurrency}
          fmtCurrency={fmtCurrency}
          services={services}
          receipts={receipts}
          operatorDues={operatorDues}
          operatorPaymentsReloadKey={operatorPaymentsReloadKey}
          useBookingSaleTotal={useBookingSaleTotal}
          bookingSaleTotals={bookingSaleTotals}
          role={role}
          onSaveCommission={onSaveCommission}
        />
      </div>
    </div>
  );
}
