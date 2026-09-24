// src/components/operator-dues/OperatorDueForm.tsx
"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { Booking, Service } from "@/types";
import Spinner from "@/components/Spinner";
import { toast } from "react-toastify";
import { authFetch } from "@/utils/authFetch";
import { formatDateInBuenosAires } from "@/lib/buenosAiresDate";
import { parseAmountInput } from "@/utils/receipts/receiptForm";
import { formatMoneyInput, shouldPreferDotDecimal } from "@/utils/moneyInput";

type Props = {
  token: string | null;
  booking: Booking;
  availableServices: Service[];
  onCreated?: () => void;
  initiallyOpen?: boolean;
};

const STATUS_OPTS = [
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "PAGADA", label: "Pagada" },
] as const;
type StatusValue = (typeof STATUS_OPTS)[number]["value"];

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
      className="ml-1 block text-sm font-medium text-sky-950 dark:text-white"
    >
      {label} {required && <span className="text-rose-600">*</span>}
    </label>
    {children}
    {hint && (
      <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">{hint}</p>
    )}
  </div>
);

const toAmount = (raw: string | number | null | undefined) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const parsed = parseAmountInput(String(raw || ""));
  return parsed != null && Number.isFinite(parsed) ? parsed : 0;
};

export default function OperatorDueForm({
  token,
  booking,
  availableServices,
  onCreated,
  initiallyOpen = false,
}: Props) {
  const [isFormVisible, setIsFormVisible] = useState(initiallyOpen);

  // === Servicios de esta reserva (embebidos o provistos) ===
  const servicesFromBooking = useMemo<Service[]>(
    () =>
      (booking.services && booking.services.length > 0
        ? booking.services
        : (availableServices || []).filter(
            (s) =>
              (s as unknown as { booking_id?: number })?.booking_id ===
              booking.id_booking,
          )) ?? [],
    [booking.services, availableServices, booking.id_booking],
  );

  // === Selección de servicio (única) estilo Receipt ===
  const [serviceId, setServiceId] = useState<number | null>(null);
  const selectedService = useMemo(
    () => servicesFromBooking.find((s) => s.id_service === serviceId) || null,
    [servicesFromBooking, serviceId],
  );

  const toggleService = (svc: Service) =>
    setServiceId((curr) => (curr === svc.id_service ? null : svc.id_service));

  // === Campos ===
  const [dueDate, setDueDate] = useState<string>("");
  const [concept, setConcept] = useState<string>("");
  const [status, setStatus] = useState<StatusValue>("PENDIENTE");

  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("ARS");

  const [loading, setLoading] = useState(false);
  const lastSuggestedServiceIdRef = useRef<number | null>(null);

  // Autocomplete desde servicio + concepto sugerido
  useEffect(() => {
    if (!selectedService) {
      setAmount("");
      setCurrency("ARS");
      lastSuggestedServiceIdRef.current = null;
      return;
    }
    const serviceChanged = lastSuggestedServiceIdRef.current !== selectedService.id_service;
    if (!serviceChanged) return;
    lastSuggestedServiceIdRef.current = selectedService.id_service;

    const sugAmount = Number(selectedService.cost_price ?? 0);
    setAmount(
      sugAmount > 0
        ? formatMoneyInput(String(sugAmount), selectedService.currency || "ARS")
        : "",
    );
    setCurrency(selectedService.currency || "ARS");

    if (!concept.trim()) {
      const parts = [
        "Vencimiento pago a operador",
        selectedService.type ? `· ${selectedService.type}` : "",
        selectedService.destination ? `· ${selectedService.destination}` : "",
        `· Servicio N° ${
          selectedService.agency_service_id ?? selectedService.id_service
        }`,
        `· Reserva N° ${booking.agency_booking_id ?? booking.id_booking}`,
      ].filter(Boolean);
      setConcept(parts.join(" "));
    }
  }, [selectedService, booking.id_booking, booking.agency_booking_id, concept]);

  // === Helpers UI ===
  const inputBase =
    "w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 shadow-sm shadow-sky-950/10 outline-none placeholder:font-light dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";

  const formatMoney = (n: number, cur = "ARS") => {
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: cur,
        minimumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${cur}`;
    }
  };

  const previewAmount = useMemo(() => {
    const n = toAmount(amount);
    if (!Number.isFinite(n) || n <= 0 || !currency) return "";
    return formatMoney(n, currency);
  }, [amount, currency]);

  const dueDateLabel = useMemo(() => {
    if (!dueDate) return "";
    return formatDateInBuenosAires(dueDate);
  }, [dueDate]);

  const headerPills = useMemo(() => {
    const pills: JSX.Element[] = [];
    if (selectedService) {
      pills.push(
        <span
          key="service"
          className="rounded-full bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10"
        >
          Servicio N°{" "}
          {selectedService.agency_service_id ?? selectedService.id_service}
        </span>,
      );
    }
    if (previewAmount) {
      pills.push(
        <span
          key="amount"
          className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
        >
          {previewAmount}
        </span>,
      );
    }
    if (dueDateLabel) {
      pills.push(
        <span
          key="due"
          className="rounded-full bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10"
        >
          Vence {dueDateLabel}
        </span>,
      );
    }
    const statusLabel =
      STATUS_OPTS.find((opt) => opt.value === status)?.label ?? status;
    pills.push(
      <span
        key="status"
        className="rounded-full bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10"
      >
        {statusLabel}
      </span>,
    );
    return pills;
  }, [selectedService, previewAmount, dueDateLabel, status]);

  // === Validación ===
  const validate = () => {
    if (!serviceId) return "Seleccioná un servicio.";
    if (!dueDate) return "Indicá la fecha de caducidad.";
    if (!concept.trim()) return "Completá el concepto/descripcion.";
    const n = toAmount(amount);
    if (!Number.isFinite(n) || n <= 0) return "El monto debe ser > 0.";
    if (!currency) return "Seleccioná la moneda.";
    return null;
  };

  // === Submit ===
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    const err = validate();
    if (err) return toast.error(err);

    setLoading(true);
    try {
      const payload = {
        bookingId: booking.id_booking,
        serviceId: Number(serviceId),
        dueDate, // YYYY-MM-DD
        concept: concept.trim(),
        status,
        amount: toAmount(amount),
        currency: currency.toUpperCase(),
      };

      const res = await authFetch(
        "/api/operator-dues",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          (data as { error?: string; message?: string }).error ||
          (data as { error?: string; message?: string }).message ||
          "No se pudo crear el vencimiento del operador.";
        throw new Error(msg);
      }

      toast.success("Vencimiento creado correctamente.");
      onCreated?.();

      // Reset
      setServiceId(null);
      setDueDate("");
      setConcept("");
      setStatus("PENDIENTE");
      setAmount("");
      setCurrency("ARS");
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Error al crear vencimiento.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ maxHeight: 96, opacity: 1 }}
      animate={{
        maxHeight: isFormVisible ? 1400 : 96,
        opacity: 1,
        transition: { duration: 0.35, ease: "easeInOut" },
      }}
      className="mb-6 overflow-auto rounded-3xl border border-white/10 bg-white/10 text-sky-950 shadow-md shadow-sky-950/10 dark:text-white"
    >
      <div
        className={`sticky top-0 z-10 ${isFormVisible ? "rounded-t-3xl border-b" : ""} border-white/10 px-4 py-3 backdrop-blur-sm`}
      >
        <button
          type="button"
          onClick={() => setIsFormVisible((v) => !v)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={isFormVisible}
          aria-controls="operator-due-form-body"
        >
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/20 dark:bg-white/10 dark:text-white">
              {isFormVisible ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
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
                {isFormVisible ? "Vencimientos de operador" : "Cargar vencimiento"}
              </p>
              <p className="text-xs opacity-70">
                Reserva N° {booking.agency_booking_id ?? booking.id_booking}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">{headerPills}</div>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isFormVisible && (
          <motion.form
            id="operator-due-form-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onSubmit={handleSubmit}
            className="space-y-5 px-4 pb-6 pt-4 md:px-6"
          >
            <Section
              title="Servicios"
              desc="Seleccioná el servicio asociado al vencimiento."
            >
              <div className="md:col-span-2">
                {servicesFromBooking.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/10 p-3 text-sm opacity-80">
                    Esta reserva no tiene servicios cargados.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {servicesFromBooking.map((svc) => {
                      const isActive = serviceId === svc.id_service;
                      return (
                        <button
                          type="button"
                          key={svc.id_service}
                          onClick={() => toggleService(svc)}
                          aria-pressed={isActive}
                          className={`rounded-2xl border px-3 py-2 text-left text-sm shadow-sm shadow-sky-950/10 transition ${
                            isActive
                              ? "border-sky-200/60 bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                              : "border-white/10 bg-white/40 hover:bg-white/60 dark:bg-white/10"
                          }`}
                          title={`Servicio N° ${
                            svc.agency_service_id ?? svc.id_service
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-sm font-medium">
                              N° {svc.agency_service_id ?? svc.id_service} ·{" "}
                              {svc.type}
                              {svc.destination ? ` · ${svc.destination}` : ""}
                            </div>
                            {isActive && (
                              <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-sky-900 dark:bg-white/20 dark:text-white">
                                seleccionado
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-sm opacity-80">
                            <b>Costo:</b>{" "}
                            {formatMoney(
                              Number(svc.cost_price ?? 0),
                              svc.currency || "ARS",
                            )}{" "}
                            <span className="opacity-70">
                              ({svc.currency || "ARS"})
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedService && (
                  <div className="ml-1 mt-2 text-xs text-sky-950/70 dark:text-white/70">
                    Seleccionado: N°{" "}
                    {selectedService.agency_service_id ??
                      selectedService.id_service}
                  </div>
                )}
              </div>
            </Section>

            <Section
              title="Fecha y estado"
              desc="Definí cuándo vence y el estado inicial."
            >
              <Field id="due_date" label="Fecha de vencimiento" required>
                <input
                  id="due_date"
                  type="date"
                  className={`${inputBase} cursor-pointer`}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </Field>

              <Field id="status" label="Estado" required>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {STATUS_OPTS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setStatus(opt.value)}
                      className={`rounded-full py-2 text-center text-sm transition ${
                        status === opt.value
                          ? "bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/10 dark:bg-white/20 dark:text-white"
                          : "text-sky-950/70 hover:bg-sky-950/5 dark:text-white/70 dark:hover:bg-white/5"
                      }`}
                      title={opt.label}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>

            <Section
              title="Detalle"
              desc="Concepto visible para identificar el vencimiento."
            >
              <div className="md:col-span-2">
                <Field
                  id="concept"
                  label="Concepto / Descripción"
                  required
                >
                  <input
                    id="concept"
                    className={inputBase}
                    value={concept}
                    onChange={(e) => setConcept(e.target.value)}
                    placeholder="Ej: Vencimiento por saldo a operador..."
                    required
                  />
                </Field>
              </div>
            </Section>

            <Section
              title="Importe"
              desc="Monto y moneda del vencimiento."
            >
              <Field id="amount" label="Monto" required>
                <input
                  id="amount"
                  type="text"
                  inputMode="decimal"
                  className={inputBase}
                  value={amount}
                  onChange={(e) =>
                    setAmount(
                      formatMoneyInput(
                        e.target.value,
                        currency,
                        { preferDotDecimal: shouldPreferDotDecimal(e) },
                      ),
                    )
                  }
                  placeholder="0.00"
                  required
                />
                {previewAmount && (
                  <p className="ml-1 mt-1 text-xs opacity-80">
                    {previewAmount}
                  </p>
                )}
                {selectedService && (
                  <p className="ml-1 mt-1 text-xs text-sky-950/70 dark:text-white/70">
                    Sugerido (costo del servicio):{" "}
                    {formatMoney(
                      Number(selectedService.cost_price ?? 0),
                      selectedService.currency || "ARS",
                    )}
                  </p>
                )}
              </Field>

              <Field id="currency" label="Moneda" required>
                <select
                  id="currency"
                  className={`${inputBase} cursor-pointer appearance-none`}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  required
                >
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
                {selectedService && (
                  <p className="ml-1 mt-1 text-xs text-sky-950/70 dark:text-white/70">
                    Sugerido por servicio: {selectedService.currency || "ARS"}
                  </p>
                )}
              </Field>
            </Section>

            <div className="sticky bottom-2 z-10 flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] ${
                  loading
                    ? "cursor-not-allowed bg-sky-950/20 text-white/60 dark:bg-white/5 dark:text-white/40"
                    : "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                }`}
              >
                {loading ? <Spinner /> : "Crear vencimiento"}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
