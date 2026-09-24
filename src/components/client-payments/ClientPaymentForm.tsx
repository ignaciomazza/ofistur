// src/components/client-payments/ClientPaymentForm.tsx
"use client";
import { AnimatePresence, motion } from "framer-motion";
import {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import type { Booking } from "@/types";
import Spinner from "@/components/Spinner";
import { toast } from "react-toastify";
import { authFetch } from "@/utils/authFetch";
import { todayDateKeyInBuenosAires } from "@/lib/buenosAiresDate";
import { parseAmountInput } from "@/utils/receipts/receiptForm";
import { formatMoneyInput, shouldPreferDotDecimal } from "@/utils/moneyInput";

type Props = {
  token: string | null;
  booking: Booking;
  onCreated?: () => void;
  defaultClientId?: number | null;
  lockClient?: boolean;
  initiallyOpen?: boolean;
};

type AmountMode = "total" | "per_equal" | "per_custom";

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

/* ===== helpers de moneda robustos ===== */
function isValidCurrencyCode(code: string): boolean {
  const c = (code || "").trim().toUpperCase();
  if (!c) return false;
  try {
    new Intl.NumberFormat("es-AR", { style: "currency", currency: c }).format(
      1,
    );
    return true;
  } catch {
    return false;
  }
}
function normalizeCurrencyCode(raw: string): string {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return "ARS";
  const maps: Record<string, string> = {
    U$D: "USD",
    U$S: "USD",
    US$: "USD",
    USD$: "USD",
    AR$: "ARS",
    $: "ARS",
  };
  if (maps[s]) return maps[s];
  const m = s.match(/[A-Z]{3}/);
  const code = m ? m[0] : s;
  return isValidCurrencyCode(code) ? code : "ARS";
}

const toAmount = (raw: string | number | null | undefined) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const parsed = parseAmountInput(String(raw || ""));
  return parsed != null && Number.isFinite(parsed) ? parsed : 0;
};

export default function ClientPaymentForm({
  token,
  booking,
  onCreated,
  defaultClientId = null,
  lockClient = false,
  initiallyOpen = false,
}: Props) {
  const [isFormVisible, setIsFormVisible] = useState(initiallyOpen);

  // Pax que paga (prefill: titular al abrir)
  const [payerClientId, setPayerClientId] = useState<number | null>(null);
  const [serviceId, setServiceId] = useState<number | null>(null);

  const bookingPaxOptions = useMemo(() => {
    const items = [booking.titular, ...(booking.clients ?? [])];
    const unique = new Map<number, { id: number; label: string }>();

    for (const pax of items) {
      if (!pax?.id_client) continue;
      if (unique.has(pax.id_client)) continue;
      const fullName = `${pax.first_name ?? ""} ${pax.last_name ?? ""}`.trim();
      const paxCode = pax.agency_client_id ?? pax.id_client;
      unique.set(pax.id_client, {
        id: pax.id_client,
        label: `${fullName || `Pax ${pax.id_client}`} · N° ${paxCode}`,
      });
    }

    return Array.from(unique.values());
  }, [booking.titular, booking.clients]);

  const bookingServiceOptions = useMemo(() => {
    const services = Array.isArray(booking.services) ? booking.services : [];
    return services.map((svc) => {
      const code = svc.agency_service_id ?? svc.id_service;
      const title = svc.description || svc.type || `Servicio ${code}`;
      return { id: svc.id_service, label: `${title} · N° ${code}` };
    });
  }, [booking.services]);

  const normalizedDefaultClientId = useMemo(() => {
    const raw = Number(defaultClientId);
    if (Number.isFinite(raw) && raw > 0) {
      const normalized = Math.trunc(raw);
      if (bookingPaxOptions.some((opt) => opt.id === normalized)) {
        return normalized;
      }
    }
    return booking.titular?.id_client ?? null;
  }, [defaultClientId, bookingPaxOptions, booking.titular?.id_client]);

  const clampDay = (value: number) =>
    Math.max(1, Math.min(31, Math.trunc(value) || 1));

  const todayDay = useMemo(() => clampDay(new Date().getDate()), []);

  // Cantidad de pagos
  const [count, setCount] = useState<number>(1);

  // Modo de importes
  const [amountMode, setAmountMode] = useState<AmountMode>("total");
  const [amountInput, setAmountInput] = useState<string>("");
  const [amountsArray, setAmountsArray] = useState<string[]>([""]);
  const [currency, setCurrency] = useState<string>("ARS");

  // Vencimientos
  const mkTodayIso = () => todayDateKeyInBuenosAires();
  const [dueDatesArray, setDueDatesArray] = useState<string[]>([""]);
  const [seedDate, setSeedDate] = useState<string>(mkTodayIso());
  const [monthlyDueDay, setMonthlyDueDay] = useState<number>(todayDay);

  // Prefill de titular cuando se abre el form
  useEffect(() => {
    if (!isFormVisible) return;
    if (lockClient) {
      setPayerClientId(normalizedDefaultClientId);
      return;
    }
    if (!payerClientId && normalizedDefaultClientId) {
      setPayerClientId(normalizedDefaultClientId);
    }
  }, [isFormVisible, lockClient, payerClientId, normalizedDefaultClientId]);

  useEffect(() => {
    if (!lockClient) return;
    setPayerClientId(normalizedDefaultClientId);
  }, [lockClient, normalizedDefaultClientId]);

  useEffect(() => {
    if (payerClientId == null) return;
    const exists = bookingPaxOptions.some((opt) => opt.id === payerClientId);
    if (!exists) {
      setPayerClientId(normalizedDefaultClientId);
    }
  }, [payerClientId, bookingPaxOptions, normalizedDefaultClientId]);

  useEffect(() => {
    if (serviceId == null) return;
    const exists = bookingServiceOptions.some((opt) => opt.id === serviceId);
    if (!exists) setServiceId(null);
  }, [serviceId, bookingServiceOptions]);

  // Mantener arrays en sync con 'count'
  useEffect(() => {
    const syncLen = (arr: string[], len: number) => {
      const next = [...arr];
      if (len > next.length) while (next.length < len) next.push("");
      else if (len < next.length) next.length = len;
      return next;
    };
    setAmountsArray((prev) => syncLen(prev, count));
    setDueDatesArray((prev) => syncLen(prev, count));
  }, [count]);

  // UI
  const inputBase =
    "w-full rounded-2xl border border-sky-200 bg-white/50 p-2 px-3 shadow-sm shadow-sky-950/10 outline-none placeholder:font-light dark:bg-sky-100/10 dark:border-sky-200/60 dark:text-white";
  const stepperBtnBase =
    "grid size-10 place-items-center rounded-full border border-white/20 bg-white/40 text-lg font-semibold shadow-sm shadow-sky-950/10 transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10";

  const formatMoney = useCallback((n: number, cur = "ARS") => {
    const code = normalizeCurrencyCode(cur);
    const v = Number.isFinite(n) ? n : 0;
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: code,
        minimumFractionDigits: 2,
      }).format(v);
    } catch {
      return `${v.toFixed(2)} ${code}`;
    }
  }, []);

  const sumCustom = (arr: string[]) =>
    arr.reduce((acc, v) => {
      const n = toAmount(v);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);

  const previewAmount = useMemo(() => {
    const code = normalizeCurrencyCode(currency);
    if (amountMode === "total") {
      const n = toAmount(amountInput);
      if (!Number.isFinite(n) || n <= 0) return "";
      return formatMoney(n, code);
    }
    if (amountMode === "per_equal") {
      const n = toAmount(amountInput);
      if (!Number.isFinite(n) || n <= 0) return "";
      return `${formatMoney(n, code)} × ${count} = ${formatMoney(n * count, code)}`;
    }
    const total = sumCustom(amountsArray);
    if (total <= 0) return "";
    return `${amountsArray
      .map((v, i) => `N°${i + 1}: ${formatMoney(toAmount(v), code)}`)
      .join(" + ")} = ${formatMoney(total, code)}`;
  }, [amountMode, amountInput, currency, count, amountsArray, formatMoney]);

  const totalPreview = useMemo(() => {
    const code = normalizeCurrencyCode(currency);
    if (amountMode === "total") {
      const n = toAmount(amountInput);
      return Number.isFinite(n) && n > 0 ? formatMoney(n, code) : "";
    }
    if (amountMode === "per_equal") {
      const n = toAmount(amountInput);
      return Number.isFinite(n) && n > 0 ? formatMoney(n * count, code) : "";
    }
    const total = sumCustom(amountsArray);
    return total > 0 ? formatMoney(total, code) : "";
  }, [amountMode, amountInput, currency, count, amountsArray, formatMoney]);

  const headerPills = useMemo(() => {
    const pills: ReactNode[] = [];
    pills.push(
      <span
        key="count"
        className="rounded-full bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10"
      >
        Cuotas: {count}
      </span>,
    );
    pills.push(
      <span
        key="currency"
        className="rounded-full bg-white/30 px-3 py-1 text-xs font-medium dark:bg-white/10"
      >
        Moneda: {normalizeCurrencyCode(currency)}
      </span>,
    );
    if (totalPreview) {
      pills.push(
        <span
          key="total"
          className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
        >
          Total: {totalPreview}
        </span>,
      );
    }
    return pills;
  }, [count, currency, totalPreview]);

  const toIsoDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const parseIsoDate = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || "").trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mon = Number(m[2]) - 1;
    const day = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mon) || !Number.isFinite(day)) {
      return null;
    }
    return new Date(y, mon, day);
  };

  const dueDateByMonth = (seedIso: string, monthOffset: number, wantedDay: number) => {
    const seed = parseIsoDate(seedIso);
    if (!seed) return "";

    const base = new Date(seed.getFullYear(), seed.getMonth() + monthOffset, 1);
    const month = base.getMonth();
    const year = base.getFullYear();
    const monthMaxDay =
      month === 1 ? 28 : new Date(year, month + 1, 0).getDate();
    const finalDay = Math.min(clampDay(wantedDay), monthMaxDay);

    return toIsoDate(new Date(year, month, finalDay));
  };

  const autofillDueDates = () => {
    if (!seedDate) {
      toast.error("Completá la fecha inicial.");
      return;
    }

    const filled = Array.from({ length: count }, (_, i) =>
      i === 0 ? seedDate : dueDateByMonth(seedDate, i, monthlyDueDay),
    );

    if (filled.some((d) => !d)) {
      toast.error("No se pudieron calcular las fechas automáticamente.");
      return;
    }

    setDueDatesArray(filled);
    toast.info("Fechas mensuales completadas.");
  };

  const resetForm = () => {
    setPayerClientId(lockClient ? normalizedDefaultClientId : null);
    setServiceId(null);
    setCount(1);
    setAmountMode("total");
    setAmountInput("");
    setAmountsArray([""]);
    setCurrency("ARS");
    setDueDatesArray([""]);
    setSeedDate(mkTodayIso());
    setMonthlyDueDay(todayDay);
  };

  const [loading, setLoading] = useState(false);

  // Control de concurrencia submit
  const submitRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      if (submitRef.current) submitRef.current.abort();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error("Sesión expirada. Volvé a iniciar sesión.");
      return;
    }
    if (loading) return;

    // Validaciones básicas
    if (!payerClientId) {
      toast.error("Seleccioná el pax que paga.");
      return;
    }
    if (!bookingPaxOptions.some((opt) => opt.id === payerClientId)) {
      toast.error("El pax seleccionado no pertenece a la reserva.");
      return;
    }
    if (!count || count < 1) {
      toast.error("La cantidad de pagos debe ser al menos 1.");
      return;
    }
    const cur = normalizeCurrencyCode(currency);
    if (!isValidCurrencyCode(cur)) {
      toast.error("Moneda inválida.");
      return;
    }

    // Importes
    let amountTotal = 0;
    let perInstallmentAmounts: number[] | undefined;

    if (amountMode === "total") {
      const n = toAmount(amountInput);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("Ingresá el monto total (> 0).");
        return;
      }
      amountTotal = n;
    } else if (amountMode === "per_equal") {
      const n = toAmount(amountInput);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("Ingresá el monto por cuota (> 0).");
        return;
      }
      amountTotal = n * count;
      perInstallmentAmounts = Array.from({ length: count }, () => n);
    } else {
      const parsed = amountsArray.map((v) => toAmount(v));
      if (parsed.some((v) => !Number.isFinite(v) || v <= 0)) {
        toast.error(
          "Revisá los montos personalizados: deben ser > 0 y válidos.",
        );
        return;
      }
      if (parsed.length !== count) {
        toast.error(
          "La cantidad de montos no coincide con la cantidad de pagos.",
        );
        return;
      }
      perInstallmentAmounts = parsed;
      amountTotal = parsed.reduce((a, b) => a + b, 0);
    }

    // Vencimientos
    const cleanedDueDates = dueDatesArray.map((d) => (d || "").trim());
    if (cleanedDueDates.length !== count || cleanedDueDates.some((d) => !d)) {
      toast.error("Completá la fecha de vencimiento para cada cuota.");
      return;
    }

    // Enviar
    setLoading(true);
    if (submitRef.current) submitRef.current.abort();
    const ac = new AbortController();
    submitRef.current = ac;

    try {
      const payload: Record<string, unknown> = {
        bookingId: booking.id_booking,
        clientId: Number(payerClientId),
        ...(serviceId ? { serviceId: Number(serviceId) } : {}),
        count,
        amount: amountTotal,
        currency: cur,
        dueDates: cleanedDueDates,
        ...(perInstallmentAmounts ? { amounts: perInstallmentAmounts } : {}),
      };

      const res = await authFetch(
        "/api/client-payments",
        { method: "POST", body: JSON.stringify(payload), signal: ac.signal },
        token,
      );

      if (!res.ok) {
        let msg = "No se pudo crear el/los pago(s) del pax.";
        try {
          const data = await res.json();
          const maybe =
            (data as { error?: string; message?: string }).error ||
            (data as { error?: string; message?: string }).message;
          if (maybe) msg = maybe;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      toast.success("Pagos del pax creados correctamente.");
      onCreated?.();
      resetForm();
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      const msg =
        err instanceof Error ? err.message : "Error creando pagos del pax.";
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
        maxHeight: isFormVisible ? 2000 : 96,
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
          aria-controls="client-payment-form-body"
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
                {isFormVisible ? "Plan de pagos" : "Cargar plan de pagos"}
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
          <motion.div
            key="body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.form
              id="client-payment-form-body"
              onSubmit={handleSubmit}
              className="space-y-5 px-4 pb-6 pt-4 md:px-6"
            >
              <Section
                title="Pax que paga"
                desc={
                  lockClient
                    ? "El plan queda asociado al pasajero seleccionado en la sección Grupal."
                    : "Solo se pueden seleccionar pasajeros de esta reserva. Opcionalmente podés asociar la cuota a un servicio."
                }
              >
                <Field id="payer_client_id" label="Pax" required>
                  <select
                    id="payer_client_id"
                    className={`${inputBase} cursor-pointer`}
                    value={payerClientId ?? ""}
                    onChange={(e) =>
                      setPayerClientId(
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                    disabled={lockClient}
                    required
                  >
                    <option value="">
                      {lockClient ? "Pasajero bloqueado" : "Seleccionar pax..."}
                    </option>
                    {bookingPaxOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  id="service_id"
                  label="Servicio asociado (opcional)"
                  hint="Si la cuota no corresponde a un servicio puntual, dejalo en General."
                >
                  <select
                    id="service_id"
                    className={`${inputBase} cursor-pointer`}
                    value={serviceId ?? ""}
                    onChange={(e) =>
                      setServiceId(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">General de la reserva</option>
                    {bookingServiceOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>

              <Section
                title="Plan de pagos"
                desc="Definí la cantidad de cuotas y cómo vas a repartir el importe."
              >
                <Field id="payment_count" label="Cantidad de pagos" required>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={stepperBtnBase}
                      onClick={() => setCount((prev) => Math.max(1, prev - 1))}
                      disabled={count <= 1}
                      aria-label="Disminuir cantidad de pagos"
                    >
                      -
                    </button>
                    <input
                      id="payment_count"
                      type="number"
                      min={1}
                      step={1}
                      className={`${inputBase} h-10 text-center text-sm font-semibold`}
                      value={count}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setCount(1);
                          return;
                        }
                        setCount(Math.max(1, Math.trunc(Number(raw) || 1)));
                      }}
                      onBlur={() => setCount((prev) => Math.max(1, Math.trunc(prev) || 1))}
                      inputMode="numeric"
                      required
                    />
                    <button
                      type="button"
                      className={stepperBtnBase}
                      onClick={() => setCount((prev) => prev + 1)}
                      aria-label="Aumentar cantidad de pagos"
                    >
                      +
                    </button>
                  </div>
                </Field>

                <div className="space-y-2 md:col-span-2">
                  <label className="ml-1 block text-sm font-medium text-sky-950 dark:text-white">
                    Modo de importe
                  </label>
                  <div
                    className="grid grid-cols-1 gap-2 md:grid-cols-3"
                    role="radiogroup"
                    aria-label="Modo de importe"
                  >
                    <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-white/20 bg-white/40 px-3 py-2 text-sm shadow-sm shadow-sky-950/10 transition hover:bg-white/60 dark:bg-white/10">
                      <input
                        type="radio"
                        name="amountMode"
                        className="size-4"
                        checked={amountMode === "total"}
                        onChange={() => setAmountMode("total")}
                      />
                      <span>Total único</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-white/20 bg-white/40 px-3 py-2 text-sm shadow-sm shadow-sky-950/10 transition hover:bg-white/60 dark:bg-white/10">
                      <input
                        type="radio"
                        name="amountMode"
                        className="size-4"
                        checked={amountMode === "per_equal"}
                        onChange={() => setAmountMode("per_equal")}
                      />
                      <span>Por cuota (mismo monto)</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-white/20 bg-white/40 px-3 py-2 text-sm shadow-sm shadow-sky-950/10 transition hover:bg-white/60 dark:bg-white/10">
                      <input
                        type="radio"
                        name="amountMode"
                        className="size-4"
                        checked={amountMode === "per_custom"}
                        onChange={() => setAmountMode("per_custom")}
                      />
                      <span>Por cuota (montos personalizados)</span>
                    </label>
                  </div>
                </div>
              </Section>

              <Section
                title="Importes"
                desc="Ingresá los montos en la moneda seleccionada."
              >
                {amountMode !== "per_custom" ? (
                  <>
                    <Field
                      id="amount_input"
                      label={
                        amountMode === "total"
                          ? "Monto total"
                          : "Monto por cuota"
                      }
                      required
                    >
                      <input
                        id="amount_input"
                        type="text"
                        inputMode="decimal"
                        className={inputBase}
                        value={amountInput}
                        onChange={(e) =>
                          setAmountInput(
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
                    </Field>

                    <Field id="currency" label="Moneda" required>
                      <select
                        id="currency"
                        className={`${inputBase} cursor-pointer`}
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        required
                      >
                        <option value="ARS">ARS</option>
                        <option value="USD">USD</option>
                      </select>
                    </Field>
                  </>
                ) : (
                  <>
                    <Field id="currency" label="Moneda" required>
                      <select
                        id="currency"
                        className={`${inputBase} cursor-pointer`}
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        required
                      >
                        <option value="ARS">ARS</option>
                        <option value="USD">USD</option>
                      </select>
                      {previewAmount && (
                        <p className="ml-1 mt-1 text-xs opacity-80">
                          {previewAmount}
                        </p>
                      )}
                    </Field>

                    <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
                      {Array.from({ length: count }).map((_, idx) => (
                        <Field
                          key={idx}
                          id={`custom_amount_${idx}`}
                          label={`Monto cuota N°${idx + 1}`}
                          required
                        >
                          <input
                            id={`custom_amount_${idx}`}
                            type="text"
                            inputMode="decimal"
                            className={inputBase}
                            value={amountsArray[idx] ?? ""}
                            onChange={(e) =>
                              setAmountsArray((prev) => {
                                const next = [...prev];
                                next[idx] = formatMoneyInput(
                                  e.target.value,
                                  currency,
                                  { preferDotDecimal: shouldPreferDotDecimal(e) },
                                );
                                return next;
                              })
                            }
                            placeholder="0.00"
                            required
                          />
                        </Field>
                      ))}
                    </div>
                  </>
                )}
              </Section>

              <Section
                title="Vencimientos"
                desc="Definí fechas manualmente o completalas por día fijo de cada mes."
              >
                <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-3">
                  <Field id="seed_date" label="Fecha de la primera cuota">
                    <input
                      id="seed_date"
                      type="date"
                      className={`${inputBase} cursor-pointer`}
                      value={seedDate}
                      onChange={(e) => setSeedDate(e.target.value)}
                    />
                  </Field>
                  <Field
                    id="monthly_due_day"
                    label="Día de pago de cada mes"
                    hint="Desde la cuota 2, si elegís 31 se ajusta al 30 y en febrero al 28."
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={stepperBtnBase}
                        onClick={() =>
                          setMonthlyDueDay((prev) => Math.max(1, prev - 1))
                        }
                        disabled={monthlyDueDay <= 1}
                        aria-label="Disminuir día mensual de pago"
                      >
                        -
                      </button>
                      <input
                        id="monthly_due_day"
                        type="number"
                        min={1}
                        max={31}
                        step={1}
                        className={`${inputBase} h-10 text-center text-sm font-semibold`}
                        value={monthlyDueDay}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            setMonthlyDueDay(1);
                            return;
                          }
                          setMonthlyDueDay(clampDay(Number(raw)));
                        }}
                        onBlur={() => setMonthlyDueDay((prev) => clampDay(prev))}
                        inputMode="numeric"
                      />
                      <button
                        type="button"
                        className={stepperBtnBase}
                        onClick={() =>
                          setMonthlyDueDay((prev) => Math.min(31, prev + 1))
                        }
                        disabled={monthlyDueDay >= 31}
                        aria-label="Aumentar día mensual de pago"
                      >
                        +
                      </button>
                    </div>
                  </Field>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={autofillDueDates}
                      className="w-full rounded-full bg-sky-100 px-4 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
                    >
                      Autorellenar mensual
                    </button>
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2">
                  {Array.from({ length: count }).map((_, idx) => (
                    <Field
                      key={idx}
                      id={`due_date_${idx}`}
                      label={`Vencimiento cuota N°${idx + 1}`}
                      required
                    >
                      <input
                        id={`due_date_${idx}`}
                        type="date"
                        className={`${inputBase} cursor-pointer`}
                        value={dueDatesArray[idx] ?? ""}
                        onChange={(e) =>
                          setDueDatesArray((prev) => {
                            const next = [...prev];
                            next[idx] = e.target.value;
                            return next;
                          })
                        }
                        required
                      />
                    </Field>
                  ))}
                  <p className="ml-1 text-xs text-sky-950/70 dark:text-white/70">
                    Todas las cuotas requieren una fecha de vencimiento.
                  </p>
                </div>
              </Section>

              <div className="sticky bottom-2 z-10 flex justify-end">
                <button
                  type="submit"
                  disabled={loading || !token}
                  aria-busy={loading}
                  className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition active:scale-[0.98] ${
                    loading || !token
                      ? "cursor-not-allowed bg-sky-950/20 text-white/60 dark:bg-white/5 dark:text-white/40"
                      : "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                  }`}
                >
                  {loading ? <Spinner /> : "Crear pagos"}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
