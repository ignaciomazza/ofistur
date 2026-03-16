// src/components/investments/OperatorPaymentServicesSection.tsx
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "react-toastify";
import Spinner from "@/components/Spinner";
import { authFetch } from "@/utils/authFetch";
import { useBookingSearch } from "@/hooks/receipts/useBookingSearch";
import { useServicesForBooking } from "@/hooks/receipts/useServicesForBooking";
import ServiceAllocationsEditor, {
  type AllocationSummary,
  type AllocationPayload,
  type ExcessAction,
  type ExcessMissingAccountAction,
} from "@/components/investments/ServiceAllocationsEditor";
import { parseAmountInput } from "@/utils/receipts/receiptForm";
import type { BookingOption } from "@/types/receipts";

type OperatorLite = { id_operator: number; name: string };
type SelectionMode = "pending" | "booking";

type OperatorServiceLite = {
  id_service: number;
  agency_service_id?: number | null;
  booking_id: number;
  id_operator: number;
  currency: string;
  cost_price?: number | null;
  type?: string;
  destination?: string;
  description?: string | null;
  paid_amount?: number | null;
  pending_amount?: number | null;
  overpaid_amount?: number | null;
  booking?: {
    id_booking: number;
    agency_booking_id?: number | null;
    details?: string | null;
    titular?: { first_name?: string | null; last_name?: string | null } | null;
  } | null;
  operator?: { id_operator: number; name?: string | null } | null;
};

type SelectionSummary = {
  serviceIds: number[];
  services: OperatorServiceLite[];
  totalCost: number;
  operatorId: number | null;
  currency: string | null;
  bookingIds: number[];
  allocations: AllocationPayload[];
  assignedTotal: number;
  missingAmountCount: number;
  missingFxCount: number;
  overAssigned: boolean;
  excess: number;
  excessAction: ExcessAction;
  excessMissingAccountAction: ExcessMissingAccountAction;
};

type ApiError = { error?: string; message?: string; details?: string };

type Props = {
  token: string | null;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  initialServiceIds: number[];
  initialAllocations?: AllocationPayload[];
  initialExcessAction?: ExcessAction;
  initialExcessMissingAccountAction?: ExcessMissingAccountAction;
  resetKey: number;
  operatorId: number | null;
  currency: string;
  amount: string;
  operators: OperatorLite[];
  onSelectionChange: (summary: SelectionSummary) => void;
};

const Section = ({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) => (
  <section className="rounded-2xl border border-white/10 bg-white/10 p-4">
    <div className="mb-3">
      <h3 className="text-base font-semibold tracking-tight text-sky-950 dark:text-white">
        {title}
      </h3>
      {desc && (
        <p className="mt-1 text-xs font-light text-sky-950/70 dark:text-white/70">
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
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) => (
  <div className="space-y-1">
    <label
      htmlFor={id}
      className="ml-1 block text-sm font-medium text-sky-950 dark:text-white"
    >
      {label}
    </label>
    {children}
    {hint && (
      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">{hint}</p>
    )}
  </div>
);

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-1.5 text-sm shadow-sm backdrop-blur transition hover:bg-white/20 dark:border-white/10 dark:bg-white/10 ${
      checked ? "ring-1 ring-emerald-400/60" : ""
    }`}
  >
    <span
      className={`inline-block h-4 w-7 rounded-full ${
        checked ? "bg-emerald-500/70" : "bg-white/30 dark:bg-white/10"
      }`}
    >
      <span
        className={`block size-4 rounded-full bg-white transition ${
          checked ? "translate-x-3" : ""
        }`}
      />
    </span>
    <span>{label}</span>
  </button>
);

const inputBase =
  "w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 shadow-sm shadow-sky-950/10 outline-none placeholder:font-light dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";

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

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const getApiErrorMessage = (
  body: ApiError | null,
  fallback: string,
): string => {
  if (!body) return fallback;
  const error = typeof body.error === "string" ? body.error.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const details = typeof body.details === "string" ? body.details.trim() : "";
  if (error && details && details !== error) return `${error} (${details})`;
  if (message && details && details !== message) return `${message} (${details})`;
  return error || message || details || fallback;
};

export default function OperatorPaymentServicesSection({
  token,
  enabled,
  onToggle,
  initialServiceIds,
  initialAllocations,
  initialExcessAction,
  initialExcessMissingAccountAction,
  resetKey,
  operatorId,
  currency,
  amount,
  operators,
  onSelectionChange,
}: Props) {
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("pending");
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(
    null,
  );
  const [selectedServices, setSelectedServices] = useState<OperatorServiceLite[]>([]);
  const [pendingQuery, setPendingQuery] = useState("");
  const [pendingServices, setPendingServices] = useState<OperatorServiceLite[]>([]);
  const [loadingPendingServices, setLoadingPendingServices] = useState(false);

  const [allocationSummary, setAllocationSummary] = useState<AllocationSummary>({
    allocations: [],
    assignedTotal: 0,
    missingAmountCount: 0,
    missingFxCount: 0,
    overAssigned: false,
    excess: 0,
  });
  const [excessAction, setExcessAction] = useState<ExcessAction>("carry");
  const [excessMissingAccountAction, setExcessMissingAccountAction] =
    useState<ExcessMissingAccountAction>("carry");

  useEffect(() => {
    if (selectedServices.length === 0) {
      setAllocationSummary({
        allocations: [],
        assignedTotal: 0,
        missingAmountCount: 0,
        missingFxCount: 0,
        overAssigned: false,
        excess: 0,
      });
      setExcessAction("carry");
      setExcessMissingAccountAction("carry");
    }
  }, [selectedServices.length]);

  const {
    bookingQuery,
    setBookingQuery,
    bookingOptions,
    loadingBookings,
  } = useBookingSearch({
    token,
    enabled: enabled && selectionMode === "booking",
  });

  const loadServicesForBooking = useCallback(
    async (bookingId: number) => {
      if (!token) return [];
      const res = await authFetch(
        `/api/services?bookingId=${bookingId}`,
        { cache: "no-store" },
        token,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(
          getApiErrorMessage(body, "No se pudieron cargar los servicios de la reserva."),
        );
      }
      const data = (await res.json()) as { services?: OperatorServiceLite[] };
      return data.services ?? [];
    },
    [token],
  );

  const { services, loadingServices } = useServicesForBooking<OperatorServiceLite>({
    bookingId: selectedBookingId,
    loadServicesForBooking,
  });

  const loadServicesByIds = useCallback(
    async (ids: number[]) => {
      if (!token || ids.length === 0) return [];
      const res = await authFetch(
        `/api/services?ids=${ids.join(",")}`,
        { cache: "no-store" },
        token,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(
          getApiErrorMessage(body, "No se pudieron cargar los servicios asociados."),
        );
      }
      const data = (await res.json()) as { services?: OperatorServiceLite[] };
      return data.services ?? [];
    },
    [token],
  );

  useEffect(() => {
    let alive = true;
    setSelectionMode("pending");
    setPendingQuery("");
    setPendingServices([]);
    setSelectedServices([]);
    setSelectedBookingId(null);
    setAllocationSummary({
      allocations: [],
      assignedTotal: 0,
      missingAmountCount: 0,
      missingFxCount: 0,
      overAssigned: false,
      excess: 0,
    });
    setExcessAction(initialExcessAction ?? "carry");
    setExcessMissingAccountAction(initialExcessMissingAccountAction ?? "carry");
    if (!enabled) {
      onSelectionChange({
        serviceIds: [],
        services: [],
        totalCost: 0,
        operatorId: null,
        currency: null,
        bookingIds: [],
        allocations: [],
        assignedTotal: 0,
        missingAmountCount: 0,
        missingFxCount: 0,
        overAssigned: false,
        excess: 0,
        excessAction: initialExcessAction ?? "carry",
        excessMissingAccountAction: initialExcessMissingAccountAction ?? "carry",
      });
      return () => {
        alive = false;
      };
    }
    if (!token || initialServiceIds.length === 0) {
      onSelectionChange({
        serviceIds: [],
        services: [],
        totalCost: 0,
        operatorId: null,
        currency: null,
        bookingIds: [],
        allocations: [],
        assignedTotal: 0,
        missingAmountCount: 0,
        missingFxCount: 0,
        overAssigned: false,
        excess: 0,
        excessAction: initialExcessAction ?? "carry",
        excessMissingAccountAction: initialExcessMissingAccountAction ?? "carry",
      });
      return () => {
        alive = false;
      };
    }
    loadServicesByIds(initialServiceIds)
      .then((list) => {
        if (!alive) return;
        setSelectedServices(list);
      })
      .catch((error) => {
        if (!alive) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los servicios asociados.",
        );
      });
    return () => {
      alive = false;
    };
  }, [
    resetKey,
    enabled,
    token,
    initialServiceIds,
    initialExcessAction,
    initialExcessMissingAccountAction,
    loadServicesByIds,
    onSelectionChange,
  ]);

  const lockOperatorId = useMemo(() => {
    if (selectedServices.length > 0) return selectedServices[0].id_operator;
    return operatorId ?? null;
  }, [selectedServices, operatorId]);

  useEffect(() => {
    if (!enabled || selectionMode !== "pending") {
      setLoadingPendingServices(false);
      return;
    }
    if (!token || !lockOperatorId) {
      setPendingServices([]);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    setLoadingPendingServices(true);

    const t = setTimeout(() => {
      const qs = new URLSearchParams();
      qs.set("operatorId", String(lockOperatorId));
      qs.set("pendingOnly", "1");
      qs.set("take", "160");
      if (pendingQuery.trim()) {
        qs.set("q", pendingQuery.trim());
      }

      authFetch(
        `/api/services?${qs.toString()}`,
        { cache: "no-store", signal: controller.signal },
        token,
      )
        .then(async (res) => {
          if (!res.ok) {
            const body = (await res
              .json()
              .catch(() => null)) as ApiError | null;
            throw new Error(
              getApiErrorMessage(
                body,
                "No se pudieron cargar los servicios pendientes.",
              ),
            );
          }
          const data = (await res.json()) as { services?: OperatorServiceLite[] };
          if (!alive) return;
          setPendingServices(Array.isArray(data.services) ? data.services : []);
        })
        .catch((error) => {
          if (!alive) return;
          if ((error as { name?: string }).name === "AbortError") return;
          setPendingServices([]);
          toast.error(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los servicios pendientes.",
          );
        })
        .finally(() => {
          if (alive) setLoadingPendingServices(false);
        });
    }, 250);

    return () => {
      alive = false;
      controller.abort();
      clearTimeout(t);
    };
  }, [enabled, selectionMode, token, lockOperatorId, pendingQuery]);

  const selectedCurrencies = useMemo(() => {
    const set = new Set(
      selectedServices.map((s) => (s.currency || "").toUpperCase()),
    );
    return Array.from(set).filter(Boolean);
  }, [selectedServices]);
  const lockCurrency =
    selectedCurrencies.length === 1 ? selectedCurrencies[0] : null;

  const selectedServiceIds = useMemo(
    () => selectedServices.map((s) => s.id_service),
    [selectedServices],
  );

  const totalCost = useMemo(() => {
    if (!lockCurrency) return 0;
    return selectedServices.reduce(
      (sum, s) => sum + Number(s.cost_price || 0),
      0,
    );
  }, [selectedServices, lockCurrency]);

  const bookingIds = useMemo(
    () => Array.from(new Set(selectedServices.map((s) => s.booking_id))),
    [selectedServices],
  );

  const bookingServicesFiltered = useMemo(() => {
    if (!lockOperatorId) return services;
    return services.filter(
      (svc) =>
        svc.id_operator === lockOperatorId ||
        selectedServiceIds.includes(svc.id_service),
    );
  }, [services, lockOperatorId, selectedServiceIds]);

  useEffect(() => {
    const operatorIdFromSelection =
      selectedServices.length > 0 ? selectedServices[0].id_operator : null;
    onSelectionChange({
      serviceIds: selectedServiceIds,
      services: selectedServices,
      totalCost,
      operatorId: operatorIdFromSelection,
      currency: lockCurrency,
      bookingIds,
      allocations: allocationSummary.allocations,
      assignedTotal: allocationSummary.assignedTotal,
      missingAmountCount: allocationSummary.missingAmountCount,
      missingFxCount: allocationSummary.missingFxCount,
      overAssigned: allocationSummary.overAssigned,
      excess: allocationSummary.excess,
      excessAction,
      excessMissingAccountAction,
    });
  }, [
    selectedServiceIds,
    selectedServices,
    totalCost,
    bookingIds,
    lockCurrency,
    allocationSummary,
    excessAction,
    excessMissingAccountAction,
    onSelectionChange,
  ]);

  const toggleService = (svc: OperatorServiceLite) => {
    const isSelected = selectedServiceIds.includes(svc.id_service);
    if (isSelected) {
      setSelectedServices((prev) =>
        prev.filter((s) => s.id_service !== svc.id_service),
      );
      return;
    }
    if (lockOperatorId && svc.id_operator !== lockOperatorId) {
      toast.error(
        "No podés mezclar servicios de operadores distintos en un mismo pago.",
      );
      return;
    }
    setSelectedServices((prev) => [...prev, svc]);
  };

  const renderServicesList = (list: OperatorServiceLite[]) => {
    return (
      <div className="space-y-2">
        {list.map((svc) => {
          const checked = selectedServiceIds.includes(svc.id_service);
          const disabled =
            !!lockOperatorId &&
            svc.id_operator !== lockOperatorId &&
            !checked;

          const opName =
            operators.find((o) => o.id_operator === svc.id_operator)?.name ||
            svc.operator?.name ||
            "Operador";

          const pendingAmount = round2(Number(svc.pending_amount || 0));
          const paidAmount = round2(Number(svc.paid_amount || 0));
          const hasPendingInfo =
            Number.isFinite(Number(svc.pending_amount)) ||
            Number.isFinite(Number(svc.paid_amount));
          const bookingNumber = svc.booking?.agency_booking_id ?? svc.booking_id;
          const bookingTitular = [
            svc.booking?.titular?.first_name || "",
            svc.booking?.titular?.last_name || "",
          ]
            .join(" ")
            .trim();
          const bookingDetails = String(svc.booking?.details || "").trim();
          const serviceDetails = String(svc.description || "").trim();
          const serviceCurrency = (svc.currency || "ARS").toUpperCase();

          return (
            <label
              key={svc.id_service}
              className={`flex items-start gap-3 rounded-2xl border px-3 py-2 ${
                checked ? "border-white/20 bg-white/10" : "border-white/10"
              } ${disabled ? "opacity-50" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={checked}
                disabled={disabled}
                onChange={() => toggleService(svc)}
              />
              <div className="flex-1">
                <div className="text-sm font-medium">
                  Reserva {bookingNumber} · Servicio{" "}
                  {svc.agency_service_id ?? svc.id_service} · {svc.type}
                  {svc.destination ? ` · ${svc.destination}` : ""}
                </div>
                <div className="text-xs text-sky-950/70 dark:text-white/70">
                  Operador: <b>{opName}</b> • Costo:{" "}
                  {formatMoney(Number(svc.cost_price || 0), serviceCurrency)}
                  {hasPendingInfo && (
                    <>
                      {" "}
                      • Pagado:{" "}
                      <b>
                        {formatMoney(paidAmount, serviceCurrency)}
                      </b>{" "}
                      • Pendiente:{" "}
                      <b>
                        {formatMoney(pendingAmount, serviceCurrency)}
                      </b>
                    </>
                  )}
                </div>
                {bookingDetails && (
                  <div className="text-xs text-sky-950/70 dark:text-white/70">
                    Detalle reserva: {bookingDetails}
                  </div>
                )}
                {serviceDetails && (
                  <div className="text-xs text-sky-950/70 dark:text-white/70">
                    Detalle servicio: {serviceDetails}
                  </div>
                )}
                {bookingTitular && (
                  <div className="text-xs text-sky-950/70 dark:text-white/70">
                    Titular: {bookingTitular}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    );
  };

  return (
    <Section
      title="Servicios asociados"
      desc="Podés asociar el pago a uno o más servicios del mismo operador."
    >
      <div className="md:col-span-2">
        <Toggle
          checked={enabled}
          onChange={onToggle}
          label="Asociar servicios ahora"
        />
      </div>

      {enabled && (
        <>
          <div className="md:col-span-2">
            <div className="mb-2 text-xs text-sky-950/70 dark:text-white/70">
              Modo de selección
            </div>
            <div className="inline-flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setSelectionMode("pending")}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  selectionMode === "pending"
                    ? "bg-emerald-500/20 text-emerald-800 shadow-sm dark:text-emerald-200"
                    : "text-sky-950 hover:bg-white/30 dark:text-white"
                }`}
              >
                Pendientes por operador
              </button>
              <button
                type="button"
                onClick={() => setSelectionMode("booking")}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  selectionMode === "booking"
                    ? "bg-emerald-500/20 text-emerald-800 shadow-sm dark:text-emerald-200"
                    : "text-sky-950 hover:bg-white/30 dark:text-white"
                }`}
              >
                Buscar por reserva
              </button>
            </div>
          </div>

          {selectionMode === "pending" && (
            <>
              {!lockOperatorId ? (
                <div className="rounded-2xl border border-amber-200/40 bg-amber-100/30 p-3 text-xs text-amber-900 dark:border-amber-200/20 dark:bg-amber-100/10 dark:text-amber-100 md:col-span-2">
                  Seleccioná un operador para listar servicios pendientes.
                </div>
              ) : (
                <>
                  <Field
                    id="pending_service_search"
                    label="Buscar en pendientes"
                    hint="Por reserva, titular, tipo o destino..."
                  >
                    <input
                      id="pending_service_search"
                      value={pendingQuery}
                      onChange={(e) => setPendingQuery(e.target.value)}
                      placeholder="Opcional"
                      className={inputBase}
                      autoComplete="off"
                    />
                  </Field>

                  <div className="md:col-span-2">
                    {loadingPendingServices ? (
                      <div className="py-2">
                        <Spinner />
                      </div>
                    ) : pendingServices.length === 0 ? (
                      <p className="text-sm text-sky-950/70 dark:text-white/70">
                        No hay servicios pendientes para este operador.
                      </p>
                    ) : (
                      renderServicesList(pendingServices)
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {selectionMode === "booking" && (
            <>
              <Field
                id="booking_search"
                label="Buscar reserva"
                hint="Por número o titular..."
              >
                <input
                  id="booking_search"
                  value={bookingQuery}
                  onChange={(e) => setBookingQuery(e.target.value)}
                  placeholder="Escribí al menos 2 caracteres"
                  className={inputBase}
                  autoComplete="off"
                />
              </Field>

              <div className="md:col-span-2">
                {loadingBookings ? (
                  <div className="py-2">
                    <Spinner />
                  </div>
                ) : bookingOptions.length > 0 ? (
                  <div className="max-h-56 overflow-auto rounded-2xl border border-white/10">
                    {bookingOptions.map((opt: BookingOption) => {
                      const active = selectedBookingId === opt.id_booking;
                      return (
                        <button
                          key={opt.id_booking}
                          type="button"
                          className={`w-full px-3 py-2 text-left transition hover:bg-white/5 ${
                            active ? "bg-white/10" : ""
                          }`}
                          onClick={() => setSelectedBookingId(opt.id_booking)}
                        >
                          <div className="text-sm font-medium">{opt.label}</div>
                          {opt.subtitle && (
                            <div className="text-xs text-sky-950/70 dark:text-white/70">
                              {opt.subtitle}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : bookingQuery && bookingQuery.length >= 2 ? (
                  <p className="text-sm text-sky-950/70 dark:text-white/70">
                    Sin resultados.
                  </p>
                ) : null}
              </div>

              {selectedBookingId && (
                <div className="md:col-span-2">
                  <label className="mb-1 ml-1 block text-sm font-medium text-sky-950 dark:text-white">
                    Servicios de la reserva
                  </label>
                  {loadingServices ? (
                    <div className="py-2">
                      <Spinner />
                    </div>
                  ) : bookingServicesFiltered.length === 0 ? (
                    <p className="text-sm text-sky-950/70 dark:text-white/70">
                      No hay servicios para esta reserva.
                    </p>
                  ) : (
                    renderServicesList(bookingServicesFiltered)
                  )}
                </div>
              )}
            </>
          )}

          {selectedServices.length > 0 && (
            <div className="md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-sky-950/80 dark:text-white/80">
                <span>{selectedServices.length} servicio(s) asociado(s)</span>
                <span>
                  {lockCurrency
                    ? `Total costos ${formatMoney(totalCost, lockCurrency)}`
                    : "Múltiples monedas en la selección"}
                </span>
              </div>
            </div>
          )}

          {selectedServices.length > 0 && (
            <div className="md:col-span-2">
              <ServiceAllocationsEditor
                services={selectedServices}
                paymentCurrency={currency}
                paymentAmount={parseAmountInput(amount) ?? 0}
                initialAllocations={initialAllocations}
                resetKey={resetKey}
                excessAction={excessAction}
                onExcessActionChange={setExcessAction}
                excessMissingAccountAction={excessMissingAccountAction}
                onExcessMissingAccountActionChange={setExcessMissingAccountAction}
                onSummaryChange={setAllocationSummary}
              />
            </div>
          )}
        </>
      )}
    </Section>
  );
}
