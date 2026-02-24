// src/components/services/ServicesContainer.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast, ToastContainer } from "react-toastify";

import Spinner from "@/components/Spinner";
import ServiceForm from "@/components/services/ServiceForm";
import ServiceList from "@/components/services/ServiceList";
import InvoiceForm, {
  type InvoiceFormData,
} from "@/components/invoices/InvoiceForm";
import InvoiceCard from "@/components/invoices/InvoiceCard";
import ReceiptForm from "@/components/receipts/ReceiptForm";
import ReceiptList from "@/components/receipts/ReceiptList";
import CreditNoteForm, {
  type CreditNoteFormData,
} from "@/components/credit-notes/CreditNoteForm";
import CreditNoteCard from "@/components/credit-notes/CreditNoteCard";
import NoteComposer from "@/components/notes/NoteComposer";
import RichNote from "@/components/notes/RichNote";
import OperatorPaymentForm from "@/components/investments/OperatorPaymentForm";
import OperatorPaymentList from "@/components/investments/OperatorPaymentList";
import ClientPaymentForm from "@/components/client-payments/ClientPaymentForm";
import ClientPaymentList from "@/components/client-payments/ClientPaymentList";
import OperatorDueForm from "@/components/operator-dues/OperatorDueForm";
import OperatorDueList from "@/components/operator-dues/OperatorDueList";
const LazyBookingFilesSection = dynamic(
  () => import("@/components/bookings/BookingFilesSection"),
  {
    ssr: false,
    loading: () => (
      <div className="mb-10 rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-sky-950/70 dark:text-white/70">
        Cargando sección de archivos...
      </div>
    ),
  },
);

import { authFetch } from "@/utils/authFetch";
import {
  canAccessBookingComponent,
  normalizeBookingComponentRules,
  type BookingComponentKey,
} from "@/utils/permissions";
import { toDateKeyInBuenosAiresLegacySafe } from "@/lib/buenosAiresDate";
import type { CreditNoteWithItems } from "@/services/creditNotes";
import type {
  ReceiptPaymentLine,
  ServiceLite,
  SubmitResult,
} from "@/types/receipts";
import type {
  BillingData,
  BillingAdjustmentComputed,
  BillingBreakdownOverride,
  Booking,
  ClientPayment,
  Invoice,
  Operator,
  OperatorDue,
  PassengerCategory,
  Receipt,
  Service,
  CommissionOverrides,
} from "@/types";

/* =========================================================
 * Tipos auxiliares y helpers
 * ========================================================= */
export type ServiceFormData = {
  type: string;
  description?: string;
  note?: string;
  sale_price: number;
  cost_price: number;
  destination?: string;
  reference?: string;
  tax_21?: number;
  tax_105?: number;
  exempt?: number;
  other_taxes?: number;
  card_interest?: number;
  card_interest_21?: number;
  currency: string;
  id_operator: number;
  departure_date: string;
  return_date: string;
  transfer_fee_pct?: number | null;
  extra_adjustments?: BillingAdjustmentComputed[] | null;
  billing_override?: Partial<BillingBreakdownOverride> | null;
};

type BookingServiceItem = {
  id_service?: number | string | null;
  id?: number | string | null;
  description?: string | null;
  type?: string | null;
  destination?: string | null;
  destino?: string | null;
  currency?: string | null;
  sale_currency?: string | null;
  sale_price?: number | string | null;
  card_interest?: number | string | null;
  taxableCardInterest?: number | string | null;
  vatOnCardInterest?: number | string | null;
};

interface ServicesContainerProps {
  token: string | null;
  booking: Booking | null;
  services: Service[];
  availableServices: Service[];
  operators: Operator[];
  invoices: Invoice[];
  receipts: Receipt[];
  creditNotes: CreditNoteWithItems[];
  onReceiptDeleted?: (id: number) => void;
  onReceiptCreated?: (r: Receipt) => void;
  onCreditNoteCreated?: () => void;
  onInvoiceUpdated?: (invoice: Invoice) => void;
  invoiceFormData: InvoiceFormData;
  formData: ServiceFormData;
  editingServiceId: number | null;
  expandedServiceId: number | null;
  loading: boolean;
  isFormVisible: boolean;
  isBillingFormVisible: boolean;
  handleChange: (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => void;
  handleInvoiceChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => void;
  updateFormData: (
    key: keyof InvoiceFormData,
    value: InvoiceFormData[keyof InvoiceFormData],
  ) => void;
  handleInvoiceSubmit: (e: React.FormEvent) => Promise<void>;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  deleteService: (serviceId: number) => Promise<void>;
  duplicateService: (service: Service) => Promise<void>;
  formatDate: (dateString: string | undefined) => string;
  setEditingServiceId: React.Dispatch<React.SetStateAction<number | null>>;
  setIsFormVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setFormData: React.Dispatch<React.SetStateAction<ServiceFormData>>;
  setExpandedServiceId: React.Dispatch<React.SetStateAction<number | null>>;
  setIsBillingFormVisible: React.Dispatch<React.SetStateAction<boolean>>;
  isSubmitting: boolean;
  onBillingUpdate?: (data: BillingData) => void;
  role: string;
  onBookingUpdated?: (updated: Booking) => void;
  creditNoteFormData: CreditNoteFormData;
  handleCreditNoteChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => void;
  updateCreditNoteFormData: (
    key: keyof CreditNoteFormData,
    value: CreditNoteFormData[keyof CreditNoteFormData],
  ) => void;
  handleCreditNoteSubmit: (e: React.FormEvent) => Promise<void>;
  isCreditNoteSubmitting: boolean;
  onPaymentCreated?: () => void;
  operatorsReady?: boolean;
}

function cap(s: string | null | undefined): string {
  if (!s) return "";
  const str = String(s);
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function toFiniteNumber(n: unknown, fallback = 0): number {
  const num = typeof n === "number" ? n : Number(n);
  return Number.isFinite(num) ? num : fallback;
}

function toDateOnly(value?: string | null): string {
  return toDateKeyInBuenosAiresLegacySafe(value ?? null) ?? "";
}

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickApiMessage(u: unknown): string | null {
  if (!isRecord(u)) return null;
  const err = u.error;
  const msg = u.message;
  if (typeof err === "string" && err.trim()) return err;
  if (typeof msg === "string" && msg.trim()) return msg;
  return null;
}

function isSubmitResultLike(value: unknown): value is SubmitResult {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" && Number.isFinite(value)) return true;
  return isRecord(value);
}

function submitResultFromReceipt(receipt: Receipt): SubmitResult {
  return {
    receipt: {
      id_receipt: receipt.id_receipt,
      id: receipt.id_receipt,
    },
  };
}

function toInputDate(value?: string | null): string {
  return toDateOnly(value);
}

type ReceiptWithPayments = Receipt & {
  payment_method_id?: number | null;
  account_id?: number | null;
  payments?: Array<{
    amount?: number | string | null;
    payment_method_id?: number | null;
    account_id?: number | null;
    payment_currency?: string | null;
    fee_mode?: "FIXED" | "PERCENT" | null;
    fee_value?: number | string | null;
    fee_amount?: number | string | null;
  }>;
};

const STATUS_PILL_BASE =
  "rounded-full border px-3 py-1 text-xs font-medium shadow-sm shadow-sky-950/10";

const STATUS_PILL_PALETTE: Record<string, string> = {
  pendiente:
    "border-amber-500/35 bg-amber-500/15 text-amber-900 dark:border-amber-400/35 dark:bg-amber-500/15 dark:text-amber-200",
  pago: "border-emerald-500/35 bg-emerald-500/15 text-emerald-900 dark:border-emerald-400/35 dark:bg-emerald-500/15 dark:text-emerald-200",
  facturado:
    "border-sky-500/35 bg-sky-500/15 text-sky-900 dark:border-sky-400/35 dark:bg-sky-500/15 dark:text-sky-200",
  abierta:
    "border-sky-400/30 bg-sky-400/10 text-sky-900 dark:border-sky-300/30 dark:bg-sky-400/10 dark:text-sky-200",
  bloqueada:
    "border-slate-400/35 bg-slate-300/20 text-slate-900 dark:border-slate-300/35 dark:bg-slate-400/15 dark:text-slate-200",
  cancelada:
    "border-rose-500/35 bg-rose-500/15 text-rose-900 dark:border-rose-400/35 dark:bg-rose-500/15 dark:text-rose-200",
  default:
    "border-white/20 bg-white/20 text-sky-950 dark:border-white/15 dark:bg-white/10 dark:text-white",
};

function getStatusPillClasses(value?: string): string {
  const key = (value || "").toLowerCase();
  return `${STATUS_PILL_BASE} ${
    STATUS_PILL_PALETTE[key] || STATUS_PILL_PALETTE.default
  }`;
}

function formatStatusLabel(value?: string): string {
  if (!value) return "—";
  const trimmed = String(value).trim();
  if (!trimmed) return "—";
  const lower = trimmed.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function getBookingStatusIcon(status?: string) {
  const key = (status || "").toLowerCase();
  if (key === "bloqueada") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.7}
        stroke="currentColor"
        className="size-4"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
        />
      </svg>
    );
  }
  if (key === "cancelada") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.7}
        stroke="currentColor"
        className="size-4"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
        />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.7}
      stroke="currentColor"
      className="size-4"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

/* =========================================================
 * Componente
 * ========================================================= */
export default function ServicesContainer(props: ServicesContainerProps) {
  const {
    token,
    booking,
    services,
    availableServices,
    operators,
    invoices,
    receipts,
    creditNotes,
    onReceiptDeleted,
    onReceiptCreated,
    onCreditNoteCreated,
    onInvoiceUpdated,
    invoiceFormData,
    formData,
    editingServiceId,
    expandedServiceId,
    loading,
    isFormVisible,
    isBillingFormVisible,
    handleChange,
    handleInvoiceChange,
    updateFormData,
    handleInvoiceSubmit,
    handleSubmit,
    deleteService,
    duplicateService,
    formatDate,
    setEditingServiceId,
    setIsFormVisible,
    setFormData,
    setExpandedServiceId,
    setIsBillingFormVisible,
    isSubmitting,
    onBillingUpdate,
    role,
    onBookingUpdated,
    creditNoteFormData,
    handleCreditNoteChange,
    updateCreditNoteFormData,
    handleCreditNoteSubmit,
    isCreditNoteSubmitting,
    onPaymentCreated,
    operatorsReady,
  } = props;

  const router = useRouter();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ================= Transfer fee (agencia) ================= */
  const [agencyTransferFeePct, setAgencyTransferFeePct] =
    useState<number>(0.024);
  const [agencyTransferFeeReady, setAgencyTransferFeeReady] =
    useState<boolean>(false);
  const [inheritedUseBookingSaleTotal, setInheritedUseBookingSaleTotal] =
    useState<boolean>(false);
  const [useBookingSaleTotalOverride, setUseBookingSaleTotalOverride] =
    useState<boolean | null>(null);
  const [useBookingSaleTotal, setUseBookingSaleTotal] =
    useState<boolean>(false);
  const [saleModeSaving, setSaleModeSaving] = useState(false);
  const [neighborIds, setNeighborIds] = useState<{
    prevId: string | number | null;
    nextId: string | number | null;
  }>({ prevId: null, nextId: null });
  const [neighborLoading, setNeighborLoading] = useState(false);
  const [bookingComponents, setBookingComponents] = useState<
    BookingComponentKey[]
  >([]);

  useEffect(() => {
    if (!token) {
      setBookingComponents([]);
      return;
    }
    let alive = true;

    (async () => {
      try {
        const res = await authFetch(
          "/api/bookings/permissions",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) {
          if (alive) setBookingComponents([]);
          return;
        }
        const payload = (await res.json()) as { rules?: unknown };
        const rules = normalizeBookingComponentRules(payload?.rules);
        if (alive) setBookingComponents(rules[0]?.components ?? []);
      } catch {
        if (alive) setBookingComponents([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [token]);

  const fetchTransferFee = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return 0.024;

      try {
        // 1) Intentar usar la misma config global que lee el ServiceForm
        const res = await authFetch(
          "/api/service-calc-config",
          { cache: "no-store", signal },
          token,
        );

        if (res.ok) {
          const data = (await res.json()) as {
            transfer_fee_pct?: unknown;
            use_booking_sale_total?: unknown;
          };
          setInheritedUseBookingSaleTotal(Boolean(data.use_booking_sale_total));
          const raw = toFiniteNumber(data.transfer_fee_pct, 0.024);
          const safe = Math.min(Math.max(raw, 0), 1); // clamp 0–1
          return safe;
        }

        // 2) Fallback al endpoint viejo, si existe
        const legacy = await authFetch(
          "/api/agency/transfer-fee",
          { cache: "no-store", signal },
          token,
        );
        if (legacy.ok) {
          const data: unknown = await legacy.json();
          const raw = toFiniteNumber(
            (data as { transfer_fee_pct?: unknown })?.transfer_fee_pct,
            0.024,
          );
          const safe = Math.min(Math.max(raw, 0), 1);
          return safe;
        }

        setInheritedUseBookingSaleTotal(false);
        return 0.024;
      } catch {
        setInheritedUseBookingSaleTotal(false);
        return 0.024;
      }
    },
    [token],
  );

  /* ================= Estados de la reserva ================= */
  const [selectedClientStatus, setSelectedClientStatus] = useState("Pendiente");
  const [selectedOperatorStatus, setSelectedOperatorStatus] =
    useState("Pendiente");
  const [selectedBookingStatus, setSelectedBookingStatus] = useState("Abierta");

  useEffect(() => {
    if (booking) {
      setSelectedClientStatus(booking.clientStatus ?? "Pendiente");
      setSelectedOperatorStatus(booking.operatorStatus ?? "Pendiente");
      setSelectedBookingStatus(booking.status ?? "Abierta");
      const rawOverride = (
        booking as Booking & {
          use_booking_sale_total_override?: boolean | null;
        }
      ).use_booking_sale_total_override;
      setUseBookingSaleTotalOverride(
        typeof rawOverride === "boolean" ? rawOverride : null,
      );
    }
  }, [booking]);

  useEffect(() => {
    setUseBookingSaleTotal(
      useBookingSaleTotalOverride ?? inheritedUseBookingSaleTotal,
    );
  }, [useBookingSaleTotalOverride, inheritedUseBookingSaleTotal]);

  useEffect(() => {
    if (!booking || !isFormVisible || editingServiceId) return;
    const bookingDeparture = toDateOnly(booking.departure_date);
    const bookingReturn = toDateOnly(booking.return_date);
    if (!bookingDeparture && !bookingReturn) return;

    setFormData((prev) => {
      const nextDeparture = prev.departure_date || bookingDeparture;
      const nextReturn = prev.return_date || bookingReturn;

      if (
        nextDeparture === prev.departure_date &&
        nextReturn === prev.return_date
      ) {
        return prev;
      }

      return {
        ...prev,
        departure_date: nextDeparture,
        return_date: nextReturn,
      };
    });
  }, [
    booking,
    editingServiceId,
    isFormVisible,
    setFormData,
  ]);

  const hasChanges = useMemo(() => {
    if (!booking) return false;
    return (
      selectedClientStatus !== (booking.clientStatus ?? "") ||
      selectedOperatorStatus !== (booking.operatorStatus ?? "") ||
      selectedBookingStatus !== (booking.status ?? "")
    );
  }, [
    booking,
    selectedClientStatus,
    selectedOperatorStatus,
    selectedBookingStatus,
  ]);

  const bookingPassengers = useMemo(() => {
    if (!booking) return [];
    const all = [
      booking.titular,
      ...(Array.isArray(booking.clients) ? booking.clients : []),
    ].filter(Boolean);
    const seen = new Set<number>();
    return all
      .filter((c) => {
        if (!c || typeof c.id_client !== "number") return false;
        if (seen.has(c.id_client)) return false;
        seen.add(c.id_client);
        return true;
      })
      .map((c) => ({
        id_client: c.id_client,
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Pax",
      }));
  }, [booking]);

  const [passengerCategories, setPassengerCategories] = useState<
    PassengerCategory[]
  >([]);

  useEffect(() => {
    if (!token) {
      setPassengerCategories([]);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await authFetch(
          "/api/passenger-categories",
          { cache: "no-store", signal: controller.signal },
          token,
        );
        if (!res.ok) throw new Error("No se pudieron cargar categorías.");
        const data = (await res.json().catch(() => [])) as PassengerCategory[];
        if (alive) setPassengerCategories(Array.isArray(data) ? data : []);
      } catch {
        if (alive) setPassengerCategories([]);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [token]);

  const passengerCategoryCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    if (!booking) return counts;
    if (Array.isArray(booking.simple_companions)) {
      booking.simple_companions.forEach((c) => {
        const id = c.category_id;
        if (typeof id !== "number" || !Number.isFinite(id)) return;
        counts[id] = (counts[id] || 0) + 1;
      });
    }

    const realPassengers = [
      booking.titular,
      ...(Array.isArray(booking.clients) ? booking.clients : []),
    ].filter(Boolean);

    realPassengers.forEach((p) => {
      const id = p?.category_id;
      if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) return;
      counts[id] = (counts[id] || 0) + 1;
    });

    if (!passengerCategories.length) return counts;
    const eligible = [...passengerCategories]
      .filter((c) => c.enabled !== false && !c.ignore_age)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const ageFromBirthDate = (value?: string | null) => {
      if (!value) return null;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      const now = new Date();
      let age = now.getUTCFullYear() - d.getUTCFullYear();
      const m = now.getUTCMonth() - d.getUTCMonth();
      if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) {
        age -= 1;
      }
      return age >= 0 ? age : null;
    };

    const matchCategoryId = (age: number | null) => {
      if (age == null) return null;
      for (const cat of eligible) {
        const min = typeof cat.min_age === "number" ? cat.min_age : null;
        const max = typeof cat.max_age === "number" ? cat.max_age : null;
        const okMin = min == null || age >= min;
        const okMax = max == null || age <= max;
        if (okMin && okMax) return cat.id_category;
      }
      return null;
    };

    realPassengers.forEach((p) => {
      const id = p?.category_id;
      if (typeof id === "number" && Number.isFinite(id) && id > 0) return;
      const age = ageFromBirthDate(p?.birth_date);
      const catId = matchCategoryId(age);
      if (!catId) return;
      counts[catId] = (counts[catId] || 0) + 1;
    });

    return counts;
  }, [booking, passengerCategories]);

  const canNavigateNeighbors =
    role === "administrativo" || role === "gerente" || role === "desarrollador";
  const canOverrideBillingMode =
    role === "administrativo" || role === "gerente" || role === "desarrollador";
  const canEditSaleMode = canOverrideBillingMode;
  const canEditSaleTotals =
    canEditSaleMode || role === "vendedor" || role === "lider";

  useEffect(() => {
    if (!token || !booking?.id_booking || !canNavigateNeighbors) {
      if (mountedRef.current) {
        setNeighborIds({ prevId: null, nextId: null });
        setNeighborLoading(false);
      }
      return;
    }

    const ac = new AbortController();
    const bookingId = booking.public_id ?? booking.id_booking;
    setNeighborLoading(true);

    (async () => {
      try {
        const res = await authFetch(
          `/api/bookings/neighbor?bookingId=${bookingId}`,
          { cache: "no-store", signal: ac.signal },
          token,
        );
        if (!res.ok) {
          if (mountedRef.current) {
            setNeighborIds({ prevId: null, nextId: null });
          }
          return;
        }
        const data: unknown = await res.json();
        const prevRaw = (data as { prevId?: unknown })?.prevId;
        const nextRaw = (data as { nextId?: unknown })?.nextId;
        const prevId =
          typeof prevRaw === "string" || typeof prevRaw === "number"
            ? prevRaw
            : null;
        const nextId =
          typeof nextRaw === "string" || typeof nextRaw === "number"
            ? nextRaw
            : null;

        if (mountedRef.current) setNeighborIds({ prevId, nextId });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (mountedRef.current) {
          setNeighborIds({ prevId: null, nextId: null });
        }
      } finally {
        if (mountedRef.current) setNeighborLoading(false);
      }
    })();

    return () => ac.abort();
  }, [token, booking?.id_booking, booking?.public_id, canNavigateNeighbors]);

  /* ================= Observaciones administración ================= */
  const [isEditingInvObs, setIsEditingInvObs] = useState(false);
  const [invObsDraft, setInvObsDraft] = useState(booking?.observation || "");
  const [isSavingInvObs, setIsSavingInvObs] = useState(false);
  const [saleTotalsDraft, setSaleTotalsDraft] = useState<
    Record<string, string>
  >({});
  const [saleTotalsSaving, setSaleTotalsSaving] = useState(false);
  const [filesReady, setFilesReady] = useState(false);

  useEffect(() => {
    setInvObsDraft(booking?.observation || "");
  }, [booking?.observation]);

  const normalizeSaleTotals = useCallback((input: unknown) => {
    if (!input || typeof input !== "object") return {};
    const obj = input as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [keyRaw, val] of Object.entries(obj)) {
      const key = String(keyRaw || "").toUpperCase().trim();
      if (!key) continue;
      const n =
        typeof val === "number"
          ? val
          : Number(String(val).replace(",", "."));
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    }
    return out;
  }, []);

  const bookingSaleTotals = useMemo(
    () => normalizeSaleTotals(booking?.sale_totals),
    [booking?.sale_totals, normalizeSaleTotals],
  );

  const saleTotalCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const svc of services) {
      const cur = String(svc.currency || "ARS").toUpperCase();
      if (cur) set.add(cur);
    }
    Object.keys(bookingSaleTotals).forEach((cur) => set.add(cur));
    if (set.size === 0) set.add("ARS");
    return Array.from(set);
  }, [services, bookingSaleTotals]);

  useEffect(() => {
    if (!useBookingSaleTotal) {
      setSaleTotalsDraft({});
      return;
    }
    const next: Record<string, string> = {};
    for (const cur of saleTotalCurrencies) {
      const val = bookingSaleTotals[cur];
      next[cur] = val != null ? String(val) : "";
    }
    setSaleTotalsDraft(next);
  }, [bookingSaleTotals, saleTotalCurrencies, useBookingSaleTotal]);

  const normalizedSaleTotalsDraft = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [keyRaw, val] of Object.entries(saleTotalsDraft)) {
      const key = String(keyRaw || "").toUpperCase().trim();
      if (!key) continue;
      const n = Number(String(val).replace(",", "."));
      if (!Number.isFinite(n) || n < 0) continue;
      out[key] = n;
    }
    return out;
  }, [saleTotalsDraft]);

  const saleTotalsDirty = useMemo(() => {
    return (
      JSON.stringify(bookingSaleTotals) !==
      JSON.stringify(normalizedSaleTotalsDraft)
    );
  }, [bookingSaleTotals, normalizedSaleTotalsDraft]);

  const effectiveUseBookingSaleTotal = useMemo(
    () => useBookingSaleTotalOverride ?? inheritedUseBookingSaleTotal,
    [inheritedUseBookingSaleTotal, useBookingSaleTotalOverride],
  );

  const saleModeDirty = useMemo(
    () => useBookingSaleTotal !== effectiveUseBookingSaleTotal,
    [effectiveUseBookingSaleTotal, useBookingSaleTotal],
  );

  const nextSaleTotalOverridePayload = useMemo(() => {
    return useBookingSaleTotal === inheritedUseBookingSaleTotal
      ? null
      : useBookingSaleTotal;
  }, [inheritedUseBookingSaleTotal, useBookingSaleTotal]);

  useEffect(() => {
    if (!booking?.id_booking) return;
    setFilesReady(false);
    let cancelled = false;
    let timeoutId: number | null = null;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const idleId = w.requestIdleCallback(
        () => {
          if (!cancelled) setFilesReady(true);
        },
        { timeout: 2000 },
      );
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(idleId);
      };
    }
    timeoutId = window.setTimeout(() => {
      if (!cancelled) setFilesReady(true);
    }, 800);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [booking?.id_booking]);

  /* ================= Pagos de pax ================= */
  const [clientPayments, setClientPayments] = useState<ClientPayment[]>([]);
  const [clientPaymentsLoading, setClientPaymentsLoading] = useState(false);

  const fetchClientPayments = useCallback(
    async (signal?: AbortSignal) => {
      if (!booking?.id_booking || !token) {
        setClientPayments([]);
        return;
      }
      try {
        setClientPaymentsLoading(true);
        const res = await authFetch(
          `/api/client-payments?bookingId=${booking.id_booking}`,
          { cache: "no-store", signal },
          token,
        );
        if (!res.ok) {
          if (res.status === 404 || res.status === 405) {
            setClientPayments([]);
            return;
          }
          throw new Error("Error al obtener pagos de pax");
        }
        const data: unknown = await res.json();
        const items: ClientPayment[] = Array.isArray(
          (data as { payments?: unknown })?.payments,
        )
          ? ((data as { payments: ClientPayment[] })
              .payments as ClientPayment[])
          : [];

        items.sort((a, b) => {
          const da = toDateKeyInBuenosAiresLegacySafe(a.due_date) ?? "";
          const db = toDateKeyInBuenosAiresLegacySafe(b.due_date) ?? "";
          if (da && db && da !== db) return da.localeCompare(db);
          if (da && !db) return -1;
          if (!da && db) return 1;
          return (a.id_payment ?? 0) - (b.id_payment ?? 0);
        });

        setClientPayments(items);
      } catch {
        setClientPayments([]);
      } finally {
        setClientPaymentsLoading(false);
      }
    },
    [booking?.id_booking, token],
  );

  const handleClientPaymentCreated = () => {
    const ac = new AbortController();
    void fetchClientPayments(ac.signal);
  };

  const handleClientPaymentDeleted = (id_payment: number) => {
    setClientPayments((prev) =>
      prev.filter((p) => p.id_payment !== id_payment),
    );
  };

  /* ================= Cuotas/Débitos al Operador ================= */
  const [operatorDues, setOperatorDues] = useState<OperatorDue[]>([]);
  const [operatorDuesLoading, setOperatorDuesLoading] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [receiptFormVisible, setReceiptFormVisible] = useState(false);

  const fetchOperatorDues = useCallback(
    async (signal?: AbortSignal) => {
      if (!booking?.id_booking || !token) {
        setOperatorDues([]);
        return;
      }
      try {
        setOperatorDuesLoading(true);
        const res = await authFetch(
          `/api/operator-dues?bookingId=${booking.id_booking}`,
          { cache: "no-store", signal },
          token,
        );
        if (!res.ok) {
          if (res.status === 404 || res.status === 405) {
            setOperatorDues([]);
            return;
          }
          throw new Error("Error al obtener cuotas al operador");
        }
        const data: unknown = await res.json();
        const arr: OperatorDue[] = Array.isArray(
          (data as { dues?: unknown })?.dues,
        )
          ? ((data as { dues: OperatorDue[] }).dues as OperatorDue[])
          : [];
        setOperatorDues(arr);
      } catch {
        setOperatorDues([]);
      } finally {
        setOperatorDuesLoading(false);
      }
    },
    [booking?.id_booking, token],
  );

  const handleOperatorDueDeleted = (id_due: number) => {
    setOperatorDues((prev) => prev.filter((d) => d.id_due !== id_due));
  };

  const handleOperatorDueStatusChanged = (
    id_due: number,
    status: OperatorDue["status"],
  ) => {
    setOperatorDues((prev) =>
      prev.map((d) => (d.id_due === id_due ? { ...d, status } : d)),
    );
  };

  const buildInitialReceiptPayments = useCallback(
    (receipt: Receipt): ReceiptPaymentLine[] => {
      const normalized = receipt as ReceiptWithPayments;
      if (
        Array.isArray(normalized.payments) &&
        normalized.payments.length > 0
      ) {
        return normalized.payments.map((p) => ({
          amount: toFiniteNumber(p.amount, 0),
          payment_method_id:
            p.payment_method_id != null ? Number(p.payment_method_id) : null,
          account_id: p.account_id != null ? Number(p.account_id) : null,
          payment_currency:
            typeof p.payment_currency === "string"
              ? p.payment_currency
              : undefined,
          fee_mode:
            p.fee_mode === "FIXED" || p.fee_mode === "PERCENT"
              ? p.fee_mode
              : undefined,
          fee_value:
            p.fee_value != null ? toFiniteNumber(p.fee_value, 0) : undefined,
          fee_amount:
            p.fee_amount != null
              ? toFiniteNumber(p.fee_amount, 0)
              : undefined,
          operator_id: null,
          credit_account_id: null,
        }));
      }

      const paymentMethodId =
        normalized.payment_method_id != null
          ? Number(normalized.payment_method_id)
          : NaN;
      const accountId =
        normalized.account_id != null ? Number(normalized.account_id) : NaN;
      const hasPaymentMethod =
        Number.isFinite(paymentMethodId) && paymentMethodId > 0;
      const hasAccount = Number.isFinite(accountId) && accountId > 0;

      if (!hasPaymentMethod && !hasAccount) return [];

      return [
        {
          amount: toFiniteNumber(receipt.amount, 0),
          payment_method_id: hasPaymentMethod ? paymentMethodId : null,
          account_id: hasAccount ? accountId : null,
          payment_currency:
            typeof receipt.amount_currency === "string"
              ? receipt.amount_currency
              : undefined,
          operator_id: null,
          credit_account_id: null,
        },
      ];
    },
    [],
  );

  const scrollToReceiptForm = useCallback(() => {
    const node = document.getElementById("receipt-form");
    if (!node) return false;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    const y =
      node.getBoundingClientRect().top +
      window.pageYOffset -
      window.innerHeight * 0.1;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    return true;
  }, []);

  const startEditReceipt = useCallback(
    (receipt: Receipt) => {
      setEditingReceipt(receipt);
      setReceiptFormVisible(true);

      let attempts = 0;
      const maxAttempts = 8;
      const runScrollAttempt = () => {
        attempts += 1;
        const found = scrollToReceiptForm();
        if (attempts >= maxAttempts) return;
        if (!found || attempts < 3) {
          window.setTimeout(runScrollAttempt, 130);
        }
      };

      window.requestAnimationFrame(() => {
        window.setTimeout(runScrollAttempt, 80);
      });
    },
    [scrollToReceiptForm],
  );

  const cancelEditReceipt = useCallback(() => {
    setEditingReceipt(null);
    setReceiptFormVisible(false);
  }, []);

  useEffect(() => {
    if (!editingReceipt) return;
    const stillExists = receipts.some(
      (r) => r.id_receipt === editingReceipt.id_receipt,
    );
    if (stillExists) return;
    setEditingReceipt(null);
    setReceiptFormVisible(false);
  }, [editingReceipt, receipts]);

  /* ================== Pipeline secuencial ==================
     Ejecuta: 1) transfer-fee → 2) client-payments → 3) operator-dues */
  const pipelineRef = useRef<{ ac: AbortController; id: number } | null>(null);

  useEffect(() => {
    if (!token || !booking?.id_booking) return;

    // Abortar pipeline anterior
    if (pipelineRef.current) pipelineRef.current.ac.abort();

    const ac = new AbortController();
    const runId = Date.now();
    pipelineRef.current = { ac, id: runId };

    const isActive = () =>
      mountedRef.current &&
      pipelineRef.current?.id === runId &&
      !ac.signal.aborted;

    (async () => {
      // Paso 1: transfer-fee
      try {
        const fee = await fetchTransferFee(ac.signal);
        if (isActive()) {
          setAgencyTransferFeePct(fee);
          setAgencyTransferFeeReady(true);
        }
      } catch {
        if (isActive()) {
          setAgencyTransferFeePct(0.024);
          setAgencyTransferFeeReady(true);
        }
      }

      // Paso 2: client-payments
      if (!isActive()) return;
      try {
        await fetchClientPayments(ac.signal);
      } catch {
        // silencioso
      }

      // Paso 3: operator-dues
      if (!isActive()) return;
      try {
        await fetchOperatorDues(ac.signal);
      } catch {
        // silencioso
      }
    })();

    return () => ac.abort();
  }, [
    token,
    booking?.id_booking,
    fetchTransferFee,
    fetchClientPayments,
    fetchOperatorDues,
  ]);

  /* ================= Attach recibo existente ================= */
  const handleAttachExistingReceipt = useCallback(
    async ({
      id_receipt,
      bookingId,
      serviceIds,
    }: {
      id_receipt: number;
      bookingId: number;
      serviceIds: number[];
    }) => {
      if (!token) throw new Error("Sesión inválida. Volvé a iniciar sesión.");
      try {
        const res = await authFetch(
          `/api/receipts/${id_receipt}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              bookingId,
              booking: { id_booking: bookingId },
              serviceIds,
            }),
          },
          token,
        );

        if (!res.ok) {
          let msg = "No se pudo asociar el recibo.";
          try {
            const err = await res.json();
            if (typeof (err as { error?: unknown })?.error === "string")
              msg = (err as { error: string }).error;
          } catch {}
          throw new Error(msg);
        }
        router.refresh();
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "No se pudo asociar el recibo.";
        toast.error(msg);
        throw e;
      }
    },
    [token, router],
  );

  /* ================= Guardar estados ================= */
  const handleSaveStatuses = async () => {
    if (!booking) return;
    try {
      const res = await authFetch(
        `/api/bookings/${booking.id_booking}`,
        {
          method: "PUT",
          body: JSON.stringify({
            clientStatus: selectedClientStatus,
            operatorStatus: selectedOperatorStatus,
            status: selectedBookingStatus,
            details: booking.details,
            invoice_type: booking.invoice_type,
            invoice_observation: booking.invoice_observation,
            observation: booking.observation,
            titular_id: booking.titular.id_client,
            id_agency: booking.agency.id_agency,
            departure_date: booking.departure_date,
            return_date: booking.return_date,
            pax_count: booking.pax_count,
            clients_ids: booking.clients.map((c) => c.id_client),
            id_user: booking.user.id_user,
          }),
        },
        token ?? undefined,
      );

      if (!res.ok) {
        let msg = "No se pudieron actualizar los estados.";
        try {
          const err = await res.json();
          if (typeof (err as { error?: unknown })?.error === "string")
            msg = (err as { error: string }).error;
        } catch {}
        throw new Error(msg);
      }

      const updated = (await res.json()) as Booking;
      toast.success("¡Estados actualizados!");
      onBookingUpdated?.(updated);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "No se pudieron actualizar los estados.";
      toast.error(msg);
    }
  };

  /* ================= Guardar observación ================= */
  const handleInvObsSave = async () => {
    if (!booking) return;
    setIsSavingInvObs(true);
    try {
      const res = await authFetch(
        `/api/bookings/${booking.id_booking}`,
        {
          method: "PUT",
          body: JSON.stringify({
            clientStatus: booking.clientStatus,
            operatorStatus: booking.operatorStatus,
            status: booking.status,
            details: booking.details,
            invoice_type: booking.invoice_type,
            invoice_observation: booking.invoice_observation,
            observation: invObsDraft,
            titular_id: booking.titular.id_client,
            id_agency: booking.agency.id_agency,
            departure_date: booking.departure_date,
            return_date: booking.return_date,
            pax_count: booking.pax_count,
            clients_ids: booking.clients.map((c) => c.id_client),
            id_user: booking.user.id_user,
          }),
        },
        token ?? undefined,
      );
      if (!res.ok) {
        let msg = "Error al guardar observación";
        try {
          const err = await res.json();
          if (typeof (err as { error?: unknown })?.error === "string")
            msg = (err as { error: string }).error;
        } catch {}
        throw new Error(msg);
      }
      const updated = (await res.json()) as Booking;
      onBookingUpdated?.(updated);
      setIsEditingInvObs(false);
      toast.success("Observación guardada");
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Error al guardar observación";
      toast.error(msg);
    } finally {
      setIsSavingInvObs(false);
    }
  };

  const handleSaleTotalsSave = async () => {
    if (!booking || !token || !canEditSaleTotals) return;
    setSaleTotalsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        sale_totals: normalizedSaleTotalsDraft,
      };
      if (canEditSaleMode) {
        payload.use_booking_sale_total_override = nextSaleTotalOverridePayload;
      }
      const res = await authFetch(
        `/api/bookings/${booking.id_booking}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
        token ?? undefined,
      );
      if (!res.ok) {
        let msg = "Error al guardar venta total";
        try {
          const err = await res.json();
          if (typeof (err as { error?: unknown })?.error === "string")
            msg = (err as { error: string }).error;
        } catch {}
        throw new Error(msg);
      }
      const updated = (await res.json()) as Booking;
      onBookingUpdated?.(updated);
      toast.success("Venta total guardada");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar venta total";
      toast.error(msg);
    } finally {
      setSaleTotalsSaving(false);
    }
  };

  const handleSaleModeSave = async () => {
    if (!booking || !token || !canEditSaleMode) return;
    setSaleModeSaving(true);
    try {
      const res = await authFetch(
        `/api/bookings/${booking.id_booking}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            use_booking_sale_total_override: nextSaleTotalOverridePayload,
          }),
        },
        token ?? undefined,
      );
      if (!res.ok) {
        let msg = "Error al guardar modo de venta";
        try {
          const err = await res.json();
          if (typeof (err as { error?: unknown })?.error === "string")
            msg = (err as { error: string }).error;
        } catch {}
        throw new Error(msg);
      }
      const updated = (await res.json()) as Booking;
      onBookingUpdated?.(updated);
      toast.success("Modo de venta guardado");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar modo de venta";
      toast.error(msg);
    } finally {
      setSaleModeSaving(false);
    }
  };

  const handleCommissionOverridesSave = async (
    overrides: CommissionOverrides | null,
  ): Promise<boolean> => {
    if (!booking || !token) return false;
    try {
      const res = await authFetch(
        `/api/bookings/${booking.id_booking}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            commission_overrides: overrides,
          }),
        },
        token ?? undefined,
      );
      if (!res.ok) {
        let msg = "Error al guardar comisión";
        try {
          const err = await res.json();
          if (typeof (err as { error?: unknown })?.error === "string")
            msg = (err as { error: string }).error;
        } catch {}
        throw new Error(msg);
      }
      const updated = (await res.json()) as Booking;
      onBookingUpdated?.(updated);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar comisión";
      toast.error(msg);
      return false;
    }
  };

  /* ================= Créditos ================= */
  const handleLocalCreditNoteSubmit = async (e: React.FormEvent) => {
    await handleCreditNoteSubmit(e);
    onCreditNoteCreated?.();
  };

  /* ================= Facturación (UI unificada) ================= */
  const [billingMode, setBillingMode] = useState<"invoice" | "credit">(
    "invoice",
  );
  const [billingFilter, setBillingFilter] = useState<
    "all" | "invoice" | "credit"
  >("all");

  type BillingItem = {
    kind: "invoice" | "credit";
    id: string;
    sortKey: number;
    invoice?: Invoice;
    creditNote?: CreditNoteWithItems;
  };

  const toSortKey = (raw?: string | Date | null) => {
    const key = toDateKeyInBuenosAiresLegacySafe(raw ?? null);
    if (key) return Number(key.replace(/-/g, ""));
    if (!raw) return 0;
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  };

  const billingItems = useMemo<BillingItem[]>(() => {
    const invItems = invoices.map((inv) => ({
      kind: "invoice" as const,
      id: `inv-${inv.id_invoice}`,
      sortKey: toSortKey(inv.issue_date),
      invoice: inv,
    }));
    const creditItems = creditNotes.map((cn) => ({
      kind: "credit" as const,
      id: `cn-${cn.id_credit_note}`,
      sortKey: toSortKey(cn.issue_date as unknown as string | Date | null),
      creditNote: cn,
    }));
    return [...invItems, ...creditItems].sort((a, b) => b.sortKey - a.sortKey);
  }, [invoices, creditNotes]);

  const filteredBillingItems = useMemo(() => {
    if (billingFilter === "all") return billingItems;
    return billingItems.filter((it) => it.kind === billingFilter);
  }, [billingItems, billingFilter]);

  const openBillingForm = (mode: "invoice" | "credit") => {
    setBillingMode(mode);
    setIsBillingFormVisible(true);
  };

  /* ================= Pagos a operador ================= */
  const [paymentsReloadKey, setPaymentsReloadKey] = useState(0);

  /* ================= UI variants ================= */
  const neighborBtnBase =
    "group relative inline-flex h-10 items-center justify-center rounded-2xl px-3 text-xs font-medium text-sky-950 transition-colors hover:bg-white/60 dark:text-white dark:hover:bg-white/10 sm:text-sm";
  const neighborBtnDisabled =
    "cursor-not-allowed opacity-50 hover:bg-transparent dark:hover:bg-transparent";

  const obsVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.9 },
  } as const;

  const billingModeBase =
    "rounded-full px-4 py-1.5 text-sm font-medium transition";
  const billingModeInactive =
    "text-sky-950/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/10";
  const billingModeInvoiceActive =
    "bg-emerald-100 text-emerald-900 shadow-sm shadow-emerald-900/10 dark:bg-emerald-500/15 dark:text-emerald-100";
  const billingModeCreditActive =
    "bg-rose-100 text-rose-900 shadow-sm shadow-rose-900/10 dark:bg-rose-500/15 dark:text-rose-100";

  const billingFilterBase =
    "rounded-full px-3 py-1 text-xs font-medium transition";
  const billingFilterInactive =
    "text-sky-950/60 hover:bg-white/40 dark:text-white/60 dark:hover:bg-white/10";
  const billingFilterAllActive =
    "bg-sky-100 text-sky-900 shadow-sm shadow-sky-900/10 dark:bg-white/15 dark:text-white";
  const billingFilterInvoiceActive =
    "bg-emerald-100 text-emerald-900 shadow-sm shadow-emerald-900/10 dark:bg-emerald-500/15 dark:text-emerald-100";
  const billingFilterCreditActive =
    "bg-rose-100 text-rose-900 shadow-sm shadow-rose-900/10 dark:bg-rose-500/15 dark:text-rose-100";

  const emptyBillingMessage =
    billingFilter === "invoice"
      ? "No hay facturas para esta reserva."
      : billingFilter === "credit"
        ? "No hay notas de crédito para esta reserva."
        : "No hay facturas ni notas de crédito para esta reserva.";

  /* ================= Render ================= */
  if (!loading && !booking) {
    return (
      <div className="flex h-[80vh] w-full flex-col items-center justify-center">
        <Spinner />
        <p className="absolute top-[54vh] w-1/3 text-center font-light dark:text-white">
          Si la carga de datos tarda mucho, revisá tu internet, recargá la
          página o volvé a la anterior.
        </p>
      </div>
    );
  }

  const canAdminLike =
    role === "administrativo" || role === "gerente" || role === "desarrollador";
  const canShowBookingSaleTotalsForm =
    canEditSaleMode || (canEditSaleTotals && useBookingSaleTotal);
  const canUseReceiptsForm = canAccessBookingComponent(
    role,
    bookingComponents,
    "receipts_form",
  );
  const canUseBilling = canAccessBookingComponent(
    role,
    bookingComponents,
    "billing",
  );
  const canViewBilling =
    canUseBilling || role === "vendedor" || role === "lider";
  const canUseOperatorPayments = canAccessBookingComponent(
    role,
    bookingComponents,
    "operator_payments",
  );
  const canEditBookingStatus = canAccessBookingComponent(
    role,
    bookingComponents,
    "booking_status",
  );
  const prevDisabled = neighborLoading || !neighborIds.prevId;
  const nextDisabled = neighborLoading || !neighborIds.nextId;
  const billingSection =
    canViewBilling &&
    (services.length > 0 || invoices.length > 0 || creditNotes.length > 0) ? (
      <div className="mb-16">
        <div className="mb-4 mt-8 flex items-center justify-center gap-2">
          <p className="text-2xl font-medium">Facturación</p>
        </div>

        <div className="mb-6 rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                Comprobantes
              </p>
              <p className="text-lg font-medium">Facturas y notas de crédito</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-300/40 bg-emerald-100/60 px-3 py-1 text-xs font-medium text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100">
                Facturas {invoices.length}
              </span>
              <span className="rounded-full border border-rose-300/40 bg-rose-100/60 px-3 py-1 text-xs font-medium text-rose-900 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100">
                Notas {creditNotes.length}
              </span>
            </div>
          </div>

          {canUseBilling && (
            <>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-full border border-white/15 bg-white/30 p-1 backdrop-blur dark:bg-white/5">
                  <button
                    type="button"
                    onClick={() => openBillingForm("invoice")}
                    className={`${billingModeBase} ${
                      billingMode === "invoice"
                        ? billingModeInvoiceActive
                        : billingModeInactive
                    }`}
                  >
                    Factura
                  </button>
                  <button
                    type="button"
                    onClick={() => openBillingForm("credit")}
                    className={`${billingModeBase} ${
                      billingMode === "credit"
                        ? billingModeCreditActive
                        : billingModeInactive
                    }`}
                  >
                    Nota de crédito
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsBillingFormVisible((prev) => !prev)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    billingMode === "invoice"
                      ? "border-emerald-300/40 bg-emerald-100/60 text-emerald-900 shadow-sm shadow-emerald-900/10 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-100"
                      : "border-rose-300/40 bg-rose-100/60 text-rose-900 shadow-sm shadow-rose-900/10 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100"
                  }`}
                >
                  {isBillingFormVisible
                    ? "Cerrar formulario"
                    : "Crear comprobante"}
                </button>
              </div>

              {isBillingFormVisible && (
                <div className="mt-4">
                  {billingMode === "invoice" ? (
                    <InvoiceForm
                      formData={invoiceFormData}
                      availableServices={availableServices}
                      handleChange={handleInvoiceChange}
                      handleSubmit={handleInvoiceSubmit}
                      isFormVisible={isBillingFormVisible}
                      setIsFormVisible={setIsBillingFormVisible}
                      updateFormData={updateFormData}
                      isSubmitting={isSubmitting}
                      token={token}
                      collapsible={false}
                      containerClassName="mb-0"
                    />
                  ) : (
                    <CreditNoteForm
                      formData={creditNoteFormData}
                      invoices={invoices}
                      handleChange={handleCreditNoteChange}
                      handleSubmit={handleLocalCreditNoteSubmit}
                      isFormVisible={isBillingFormVisible}
                      setIsFormVisible={setIsBillingFormVisible}
                      updateFormData={updateCreditNoteFormData}
                      isSubmitting={isCreditNoteSubmitting}
                      token={token}
                      collapsible={false}
                      containerClassName="mb-0"
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-sky-950/70 dark:text-white/70">
            Historial
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBillingFilter("all")}
              className={`${billingFilterBase} ${
                billingFilter === "all"
                  ? billingFilterAllActive
                  : billingFilterInactive
              }`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setBillingFilter("invoice")}
              className={`${billingFilterBase} ${
                billingFilter === "invoice"
                  ? billingFilterInvoiceActive
                  : billingFilterInactive
              }`}
            >
              Facturas
            </button>
            <button
              type="button"
              onClick={() => setBillingFilter("credit")}
              className={`${billingFilterBase} ${
                billingFilter === "credit"
                  ? billingFilterCreditActive
                  : billingFilterInactive
              }`}
            >
              Notas
            </button>
          </div>
        </div>

        {filteredBillingItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredBillingItems.map((item) => (
              <div key={item.id} className="space-y-2">
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                    item.kind === "invoice"
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100"
                      : "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-100"
                  }`}
                >
                  {item.kind === "invoice" ? "Factura" : "Nota de crédito"}
                </span>
                {item.invoice ? (
                  <InvoiceCard
                    invoice={item.invoice}
                    token={token}
                    onInvoiceUpdated={onInvoiceUpdated}
                  />
                ) : item.creditNote ? (
                  <CreditNoteCard creditNote={item.creditNote} />
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4 text-center text-sm opacity-80">
            {emptyBillingMessage}
          </div>
        )}
      </div>
    ) : null;

  return (
    <motion.div>
      {loading ? (
        <div className="flex min-h-[90vh] w-full items-center">
          <Spinner />
        </div>
      ) : (
        <>
          {/* TOP BAR */}
          <div className="sticky top-2 z-10 mb-4 md:mb-6">
            <div className="flex items-center justify-between gap-2 rounded-3xl border border-white/10 bg-white/20 p-2 shadow-md shadow-sky-950/10 backdrop-blur dark:bg-white/[0.08]">
              {/* Volver */}
              <Link
                href="/bookings"
                className="group relative inline-flex h-10 items-center justify-center rounded-2xl px-3 text-sm font-medium text-sky-950 transition-colors hover:bg-white/60 dark:text-white dark:hover:bg-white/10"
                title="Volver a reservas"
                aria-label="Volver"
              >
                <span className="absolute inset-0 rounded-2xl ring-0 ring-sky-900/5 transition group-hover:ring-2 dark:ring-white/5" />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="mr-1 size-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.6}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
                  />
                </svg>
                <span className="hidden sm:inline">Volver</span>
              </Link>

              {/* Título */}
              <div className="flex flex-1 items-center justify-center">
                <h1 className="truncate text-center text-xl font-semibold text-sky-950 dark:text-white md:text-2xl">
                  {booking
                    ? `Reserva N° ${booking.agency_booking_id ?? booking.id_booking}`
                    : "Reserva"}
                </h1>
              </div>

              <div className="flex items-center gap-2">
                {canNavigateNeighbors ? (
                  <>
                    <button
                      type="button"
                      className={`${neighborBtnBase} ${prevDisabled ? neighborBtnDisabled : ""}`}
                      title="Reserva anterior"
                      aria-label="Reserva anterior"
                      disabled={prevDisabled}
                      onClick={() => {
                        if (neighborIds.prevId) {
                          router.push(
                            `/bookings/services/${neighborIds.prevId}`,
                          );
                        }
                      }}
                    >
                      <span className="absolute inset-0 rounded-2xl ring-0 ring-sky-900/5 transition group-hover:ring-2 dark:ring-white/5" />
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="mr-1 size-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.6}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
                        />
                      </svg>
                      <span>Anterior</span>
                    </button>
                    <button
                      type="button"
                      className={`${neighborBtnBase} ${nextDisabled ? neighborBtnDisabled : ""}`}
                      title="Reserva siguiente"
                      aria-label="Reserva siguiente"
                      disabled={nextDisabled}
                      onClick={() => {
                        if (neighborIds.nextId) {
                          router.push(
                            `/bookings/services/${neighborIds.nextId}`,
                          );
                        }
                      }}
                    >
                      <span className="absolute inset-0 rounded-2xl ring-0 ring-sky-900/5 transition group-hover:ring-2 dark:ring-white/5" />
                      <span>Siguiente</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="ml-1 size-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.6}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                        />
                      </svg>
                    </button>
                  </>
                ) : (
                  <div className="w-24" />
                )}
              </div>
            </div>
          </div>

          {/* INFO RESERVA */}
          {booking && (
            <div className="mb-6 rounded-3xl border border-white/10 bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-white/40 px-3 py-1 text-sm font-medium tracking-wide dark:bg-white/10">
                    N° {booking.agency_booking_id ?? booking.id_booking}
                  </span>
                  <span className="text-sm font-light opacity-80">
                    {formatDate(booking.creation_date)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={getStatusPillClasses(booking.clientStatus)}
                    title={`Pax: ${formatStatusLabel(
                      booking.clientStatus,
                    )}`}
                  >
                    Pax:
                    <span className="ml-1 font-semibold">
                      {formatStatusLabel(booking.clientStatus)}
                    </span>
                  </span>
                  <span
                    className={getStatusPillClasses(booking.operatorStatus)}
                    title={`Operador: ${formatStatusLabel(
                      booking.operatorStatus,
                    )}`}
                  >
                    Operador:
                    <span className="ml-1 font-semibold">
                      {formatStatusLabel(booking.operatorStatus)}
                    </span>
                  </span>
                  <span
                    className={`${getStatusPillClasses(booking.status)} inline-flex items-center justify-center px-2`}
                    title={`Reserva: ${formatStatusLabel(booking.status)}`}
                    aria-label={`Reserva: ${formatStatusLabel(booking.status)}`}
                  >
                    {getBookingStatusIcon(booking.status)}
                    <span className="sr-only">
                      {`Reserva: ${formatStatusLabel(booking.status)}`}
                    </span>
                  </span>

                  <Link
                    href={`/bookings/services/${booking.public_id ?? booking.id_booking}/template`}
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/40 px-3 py-1 text-xs font-medium text-sky-950 shadow-sm shadow-sky-950/10 transition hover:scale-[0.98] dark:border-white/10 dark:bg-white/10 dark:text-white"
                    title="Armar PDF de confirmación"
                    aria-label="Armar PDF de confirmación"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="size-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.6}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v2.25a2.25 2.25 0 01-2.25 2.25h-10.5A2.25 2.25 0 014.5 16.5v-2.25M12 3v12m0 0l-3-3m3 3l3-3"
                      />
                    </svg>
                    Armar PDF
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="col-span-1 rounded-2xl border border-white/5 bg-white/20 p-4 shadow-sm shadow-sky-950/10 dark:bg-white/5 md:col-span-2 lg:col-span-3">
                  <p className="text-sm font-semibold">Detalle</p>
                  <p className="mt-1 text-sm font-light">
                    {booking.details || "N/A"}
                  </p>
                </div>

                <div className="col-span-1 rounded-2xl border border-white/5 bg-white/20 p-4 shadow-sm shadow-sky-950/10 dark:bg-white/5">
                  <p className="text-sm font-semibold">Vendedor</p>
                  <p className="mt-1 text-sm font-light">
                    {booking.user.first_name} {booking.user.last_name}
                  </p>
                </div>

                <div className="col-span-1 rounded-2xl border border-white/5 bg-white/20 p-4 shadow-sm shadow-sky-950/10 dark:bg-white/5">
                  <p className="text-sm font-semibold">Titular</p>
                  <p className="mt-1 text-sm font-light">
                    {cap(booking.titular.first_name)}{" "}
                    {cap(booking.titular.last_name)} —{" "}
                    {booking.titular.agency_client_id ??
                      booking.titular.id_client}
                  </p>
                </div>


                <div className="col-span-1 flex items-end gap-4 rounded-2xl border border-white/5 bg-white/20 p-4 shadow-sm shadow-sky-950/10 dark:bg-white/5 md:col-span-2 lg:col-span-1">
                  <div>
                    <p className="text-sm font-semibold">Salida</p>
                    <p className="mt-1 text-sm font-light">
                      {formatDate(booking.departure_date)}
                    </p>
                  </div>
                  <p className="relative top-0.5 font-light">{`>`}</p>
                  <div>
                    <p className="text-sm font-semibold">Regreso</p>
                    <p className="mt-1 text-sm font-light">
                      {formatDate(booking.return_date)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Pasajeros lista */}
              <div className="mt-4 rounded-2xl border border-white/5 bg-white/20 p-4 shadow-sm shadow-sky-950/10 dark:bg-white/5">
                <p className="text-sm font-semibold">{`Lista de pasajeros (${booking.pax_count})`}</p>
                <ul className="ml-5 mt-2 list-disc text-sm">
                  <li>
                    {cap(booking.titular.first_name)}{" "}
                    {cap(booking.titular.last_name)}
                  </li>
                  {booking.clients.map((client) => (
                    <li key={client.id_client}>
                      {cap(client.first_name)} {cap(client.last_name)}
                    </li>
                  ))}
                </ul>
                {Array.isArray(booking.simple_companions) &&
                  booking.simple_companions.length > 0 && (
                    <p className="mt-2 text-xs text-sky-950/70 dark:text-white/70">
                      Acompañantes simples: {booking.simple_companions.length}
                    </p>
                  )}
              </div>

              {/* Facturación + Observaciones */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/5 bg-white/20 p-4 shadow-sm shadow-sky-950/10 dark:bg-white/5">
                  <p className="text-sm font-semibold">Facturación</p>
                  <ul className="ml-4 mt-2 list-disc text-sm">
                    <li className="font-light">
                      {booking.invoice_type || "Sin observaciones"}
                    </li>
                    <li className="font-light">
                      {booking.invoice_observation || "Sin observaciones"}
                    </li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-white/5 bg-white/20 p-4 shadow-sm shadow-sky-950/10 dark:bg-white/5">
                  <p className="mb-2 text-sm font-semibold">
                    Observaciones de administración
                  </p>
                  <li className="list-none">
                    <AnimatePresence initial={false}>
                      {isEditingInvObs ? (
                        <motion.div
                          key="edit"
                          layout
                          variants={obsVariants}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          transition={{ duration: 0.2 }}
                          className="flex w-full flex-col gap-3"
                        >
                          <NoteComposer
                            id="booking-observation"
                            value={invObsDraft}
                            onChange={setInvObsDraft}
                            placeholder="Notas internas de la reserva…"
                            rows={3}
                            className="flex-1"
                            textareaClassName="w-full rounded-2xl border border-sky-950/10 bg-white/50 p-2 px-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                            inputClassName="w-full rounded-2xl border border-sky-950/10 bg-white/40 p-2 px-3 text-sm shadow-sm shadow-sky-950/10 outline-none placeholder:text-xs placeholder:font-light dark:border-white/10 dark:bg-white/10"
                            addButtonClassName="rounded-full bg-sky-100 px-4 py-2 text-xs font-medium text-sky-950 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={handleInvObsSave}
                              disabled={isSavingInvObs}
                              className={`rounded-full px-6 py-2 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:backdrop-blur ${
                                isSavingInvObs
                                  ? "bg-sky-100/50 text-sky-950/50 dark:bg-white/5 dark:text-white/50"
                                  : "bg-sky-100 text-sky-950 dark:bg-white/10 dark:text-white"
                              }`}
                            >
                              {isSavingInvObs ? (
                                <Spinner />
                              ) : (
                                <span className="inline-flex items-center gap-2">
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    strokeWidth={1.7}
                                    stroke="currentColor"
                                    className="size-5"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
                                    />
                                  </svg>
                                  Guardar
                                </span>
                              )}
                            </button>
                            <button
                              onClick={() => {
                                setIsEditingInvObs(false);
                                setInvObsDraft(booking.observation || "");
                              }}
                              className="rounded-full bg-red-600 px-6 py-2 text-center text-red-100 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                              aria-label="Cancelar edición"
                              title="Cancelar"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.7}
                                stroke="currentColor"
                                className="size-5"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M6 18 18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="view"
                          layout
                          variants={obsVariants}
                          initial="hidden"
                          animate="visible"
                          exit="exit"
                          transition={{ duration: 0.2 }}
                          className="flex items-start justify-between gap-2"
                        >
                          <div className="min-h-[28px] min-w-0 flex-1 rounded-xl bg-white/30 p-2 dark:bg-white/5">
                            <RichNote
                              text={booking.observation}
                              emptyLabel="Sin observaciones"
                              className="space-y-2 text-sm font-light text-sky-900/80 dark:text-white/80"
                            />
                          </div>
                          {canAdminLike && (
                            <button
                              onClick={() => {
                                setInvObsDraft(booking.observation || "");
                                setIsEditingInvObs(true);
                              }}
                              className="rounded-full p-2 text-sky-950 transition-transform hover:scale-95 active:scale-90 dark:text-white"
                              title="Editar observación"
                              aria-label="Editar observación"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.5}
                                stroke="currentColor"
                                className="size-6"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                                />
                              </svg>
                            </button>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                </div>
              </div>
            </div>
          )}

          {/* SERVICIOS */}
          {booking ? (
            <>
              <div className="mb-4 mt-8 flex items-center justify-center gap-2">
                <p className="text-2xl font-medium">Servicios</p>
              </div>

              <ServiceForm
                token={token}
                formData={formData}
                operators={operators}
                operatorsReady={operatorsReady}
                handleChange={handleChange}
                handleSubmit={handleSubmit}
                editingServiceId={editingServiceId}
                isFormVisible={isFormVisible}
                setIsFormVisible={setIsFormVisible}
                onBillingUpdate={onBillingUpdate}
                agencyTransferFeePct={agencyTransferFeePct}
                transferFeeReady={agencyTransferFeeReady}
                canOverrideBillingMode={canOverrideBillingMode}
                useBookingSaleTotal={useBookingSaleTotal}
                passengerCategoryCounts={passengerCategoryCounts}
              />

              {services.length > 0 && (
                <div>
                  <ServiceList
                    services={services}
                    receipts={receipts}
                    operatorDues={operatorDues}
                    expandedServiceId={expandedServiceId}
                    setExpandedServiceId={setExpandedServiceId}
                    startEditingService={(service) => {
                      setEditingServiceId(service.id_service);
                      setFormData({
                        ...service,
                        note: service.note ?? "",
                        departure_date: toDateOnly(service.departure_date),
                        return_date: toDateOnly(service.return_date),
                        id_operator: service.id_operator || 0,
                        card_interest: service.card_interest || 0,
                        card_interest_21: service.card_interest_21 || 0,
                      });
                      setIsFormVisible(true);
                    }}
                    deleteService={deleteService}
                    duplicateService={duplicateService}
                    role={role}
                    status={booking.status}
                    agencyTransferFeePct={agencyTransferFeePct}
                    useBookingSaleTotal={useBookingSaleTotal}
                    bookingSaleTotals={bookingSaleTotals}
                    onSaveCommission={handleCommissionOverridesSave}
                    bookingSaleTotalsForm={
                      canShowBookingSaleTotalsForm ? (
                        <div className="mt-8 rounded-3xl border border-sky-900/10 bg-white/35 p-4 text-sky-950 shadow-sm shadow-sky-950/5 backdrop-blur dark:border-white/10 dark:bg-white/[0.04] dark:text-white">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">
                                Venta total por reserva
                              </p>
                              <p className="text-xs text-sky-950/70 dark:text-white/70">
                                Local por reserva. Por defecto hereda de la
                                configuración general.
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {canEditSaleMode ? (
                                <>
                                  <label className="inline-flex items-center gap-2 rounded-full border border-sky-900/15 bg-white/70 px-3 py-1 text-xs font-medium text-sky-950 dark:border-white/10 dark:bg-white/10 dark:text-white">
                                    <input
                                      type="checkbox"
                                      checked={useBookingSaleTotal}
                                      onChange={(e) =>
                                        setUseBookingSaleTotal(e.target.checked)
                                      }
                                      className="size-4 rounded border-sky-900/20 bg-white/80 text-sky-600 dark:border-white/20 dark:bg-white/10"
                                    />
                                    {useBookingSaleTotal ? "Activo" : "Inactivo"}
                                  </label>
                                  <button
                                    type="button"
                                    onClick={handleSaleModeSave}
                                    disabled={!saleModeDirty || saleModeSaving}
                                    className="rounded-full border border-sky-900/15 bg-white/70 px-4 py-2 text-xs font-medium text-sky-950 shadow-sm shadow-sky-950/10 transition active:scale-95 disabled:opacity-50 dark:border-white/10 dark:bg-white/10 dark:text-white"
                                  >
                                    {saleModeSaving
                                      ? "Guardando modo..."
                                      : "Guardar modo"}
                                  </button>
                                </>
                              ) : (
                                <span className="rounded-full border border-sky-900/10 bg-white/70 px-3 py-1 text-[11px] font-medium text-sky-900/80 dark:border-white/10 dark:bg-white/10 dark:text-white/70">
                                  Modo heredado de configuración general
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium">
                            <span className="rounded-full border border-sky-900/10 bg-white/70 px-2 py-1 dark:border-white/10 dark:bg-white/10">
                              Global:{" "}
                              {inheritedUseBookingSaleTotal ? "Activo" : "Inactivo"}
                            </span>
                            <span className="rounded-full border border-sky-900/10 bg-white/70 px-2 py-1 dark:border-white/10 dark:bg-white/10">
                              Reserva:{" "}
                              {useBookingSaleTotalOverride == null
                                ? "Heredado"
                                : useBookingSaleTotalOverride
                                  ? "Override Activo"
                                  : "Override Inactivo"}
                            </span>
                          </div>

                          {useBookingSaleTotal && (
                            <>
                              <div className="mt-4 flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={handleSaleTotalsSave}
                                  disabled={!saleTotalsDirty || saleTotalsSaving}
                                  className="rounded-full border border-sky-900/15 bg-white/70 px-4 py-2 text-xs font-medium text-sky-950 shadow-sm shadow-sky-950/10 transition active:scale-95 disabled:opacity-50 dark:border-white/10 dark:bg-white/10 dark:text-white"
                                >
                                  {saleTotalsSaving
                                    ? "Guardando venta..."
                                    : "Guardar venta"}
                                </button>
                              </div>
                              <div className="mt-4 space-y-2 rounded-2xl border border-sky-900/10 bg-white/65 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                                {saleTotalCurrencies.map((cur) => (
                                  <div key={cur} className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      step="0.01"
                                      min="0"
                                      value={saleTotalsDraft[cur] ?? ""}
                                      onChange={(e) =>
                                        setSaleTotalsDraft((prev) => ({
                                          ...prev,
                                          [cur]: e.target.value,
                                        }))
                                      }
                                      className="w-full rounded-2xl border border-sky-900/10 bg-white p-2 px-3 text-sm shadow-sm shadow-sky-950/5 outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-white/10 sm:max-w-[160px]"
                                    />
                                    <span className="rounded-full border border-sky-900/10 bg-white/75 px-2 py-1 text-xs font-semibold text-sky-900 dark:border-white/10 dark:bg-white/10 dark:text-white">
                                      {cur}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      ) : null
                    }
                  />
                </div>
              )}

              {booking && filesReady && (
                <div className="mb-16">
                  <div className="mb-4 mt-8 flex items-center justify-center gap-2">
                    <p className="text-2xl font-medium">Archivos</p>
                  </div>
                  <LazyBookingFilesSection
                    bookingId={booking.id_booking}
                    bookingKey={booking.public_id ?? booking.id_booking}
                    passengers={bookingPassengers}
                    bookingStatus={booking.status}
                    role={role}
                  />
                </div>
              )}

              {/* RECIBOS */}
              <div className="mb-16">
                <div className="mb-4 mt-8 flex items-center justify-center gap-2">
                  <p className="text-2xl font-medium">Recibos</p>
                </div>

                {canUseReceiptsForm &&
                  (services.length > 0 || receipts.length > 0) && (
                    <ReceiptForm
                      key={editingReceipt?.id_receipt ?? "booking-receipt-new"}
                      token={token || null}
                      editingReceiptId={editingReceipt?.id_receipt ?? null}
                      isFormVisible={receiptFormVisible}
                      setIsFormVisible={setReceiptFormVisible}
                      bookingId={editingReceipt ? undefined : booking.id_booking}
                      allowAgency={false}
                      enableAttachAction={!editingReceipt}
                      initialServiceIds={editingReceipt?.serviceIds ?? []}
                      initialConcept={editingReceipt?.concept ?? ""}
                      initialAmount={
                        editingReceipt
                          ? toFiniteNumber(editingReceipt.amount, 0)
                          : undefined
                      }
                      initialCurrency={editingReceipt?.amount_currency ?? undefined}
                      initialAmountWords={editingReceipt?.amount_string ?? ""}
                      initialAmountWordsCurrency={
                        editingReceipt?.base_currency ||
                        editingReceipt?.amount_currency ||
                        undefined
                      }
                      initialPaymentDescription={editingReceipt?.currency ?? ""}
                      initialFeeAmount={
                        editingReceipt?.payment_fee_amount != null
                          ? toFiniteNumber(editingReceipt.payment_fee_amount, 0)
                          : undefined
                      }
                      initialIssueDate={toInputDate(editingReceipt?.issue_date)}
                      initialBaseAmount={editingReceipt?.base_amount ?? null}
                      initialBaseCurrency={editingReceipt?.base_currency ?? null}
                      initialCounterAmount={
                        editingReceipt?.counter_amount ?? null
                      }
                      initialCounterCurrency={
                        editingReceipt?.counter_currency ?? null
                      }
                      initialClientIds={editingReceipt?.clientIds ?? []}
                      initialPayments={
                        editingReceipt
                          ? buildInitialReceiptPayments(editingReceipt)
                          : []
                      }
                      loadServicesForBooking={async (
                        bId,
                      ): Promise<ServiceLite[]> => {
                        if (!token)
                          throw new Error(
                            "Sesión expirada. Volvé a iniciar sesión.",
                          );

                        // Mapper seguro
                        const mapToLite = (
                          arr: ReadonlyArray<BookingServiceItem>,
                        ): ServiceLite[] =>
                          (arr || []).map((s) => {
                            const rawId = s?.id_service ?? s?.id ?? 0;
                            const id =
                              typeof rawId === "number"
                                ? rawId
                                : Number(rawId ?? 0);
                            const currency = String(
                              s?.currency ?? s?.sale_currency ?? "ARS",
                            ).toUpperCase();
                            const sale =
                              typeof s?.sale_price === "number"
                                ? s.sale_price
                                : Number(s?.sale_price ?? 0);
                            const cardInt =
                              typeof s?.card_interest === "number"
                                ? s.card_interest
                                : Number(s?.card_interest ?? 0);
                            const cardBase =
                              typeof s?.taxableCardInterest === "number"
                                ? s.taxableCardInterest
                                : Number(s?.taxableCardInterest ?? 0);
                            const cardVat =
                              typeof s?.vatOnCardInterest === "number"
                                ? s.vatOnCardInterest
                                : Number(s?.vatOnCardInterest ?? 0);

                            return {
                              id_service: Number.isFinite(id) ? id : 0,
                              description:
                                s?.description ??
                                s?.type ??
                                (Number.isFinite(id) && id > 0
                                  ? `Servicio ${id}`
                                  : "Servicio"),
                              currency,
                              sale_price: sale > 0 ? sale : undefined,
                              card_interest:
                                Number.isFinite(cardInt) && cardInt > 0
                                  ? cardInt
                                  : undefined,
                              taxableCardInterest:
                                Number.isFinite(cardBase) && cardBase > 0
                                  ? cardBase
                                  : undefined,
                              vatOnCardInterest:
                                Number.isFinite(cardVat) && cardVat > 0
                                  ? cardVat
                                  : undefined,
                              type: s?.type ?? undefined,
                              destination:
                                s?.destination ?? s?.destino ?? undefined,
                            };
                          });

                        if (
                          booking?.id_booking === bId &&
                          Array.isArray(services) &&
                          services.length
                        ) {
                          return mapToLite(
                            services as unknown as ReadonlyArray<BookingServiceItem>,
                          );
                        }

                        const parseJsonToArray = (
                          json: unknown,
                        ): BookingServiceItem[] | null => {
                          const root = json as Record<string, unknown> | null;
                          const candidates: unknown[] = [
                            json,
                            root?.items,
                            root?.results,
                            root?.data,
                            root?.services,
                            (
                              root?.booking as
                                | Record<string, unknown>
                                | undefined
                            )?.services,
                          ].filter(Boolean);
                          for (const c of candidates) {
                            if (Array.isArray(c))
                              return c as BookingServiceItem[];
                          }
                          return null;
                        };

                        const tryFetch = async (
                          url: string,
                        ): Promise<BookingServiceItem[] | null> => {
                          const res = await authFetch(
                            url,
                            { cache: "no-store" },
                            token,
                          );
                          if (!res.ok) return null;
                          const json: unknown = await res.json();
                          return parseJsonToArray(json);
                        };

                        const arr =
                          (await tryFetch(`/api/bookings/${bId}/services`)) ??
                          (await tryFetch(
                            `/api/bookings/${bId}?include=services`,
                          )) ??
                          (await tryFetch(`/api/bookings/${bId}`)) ??
                          (await tryFetch(`/api/services?bookingId=${bId}`)) ??
                          (await tryFetch(`/api/services/by-booking/${bId}`)) ??
                          [];

                        return mapToLite(arr);
                      }}
                      onAttachExisting={handleAttachExistingReceipt}
                      onSubmit={async (payload) => {
                        const receiptToEdit = editingReceipt;
                        if (receiptToEdit?.id_receipt) {
                          const res = await authFetch(
                            `/api/receipts/${
                              receiptToEdit.public_id ?? receiptToEdit.id_receipt
                            }`,
                            {
                              method: "PATCH",
                              body: JSON.stringify(payload),
                            },
                            token ?? undefined,
                          );

                          const json: unknown = await res
                            .json()
                            .catch(() => null);

                          if (!res.ok) {
                            let msg = "No se pudo actualizar el recibo.";
                            const picked = pickApiMessage(json);
                            if (picked) msg = picked;
                            throw new Error(msg);
                          }
                          const submitResult = isSubmitResultLike(json)
                            ? json
                            : null;

                          const updatedRaw =
                            (isRecord(json) && isRecord(json.receipt)
                              ? json.receipt
                              : null) ||
                            (isRecord(json) &&
                            isRecord(json.data) &&
                            isRecord(json.data.receipt)
                              ? json.data.receipt
                              : null);

                          if (updatedRaw) {
                            const updatedObj = isRecord(updatedRaw)
                              ? updatedRaw
                              : {};
                            const updatedReceipt = {
                              ...receiptToEdit,
                              ...(updatedRaw as Partial<Receipt>),
                              id_receipt: Number(
                                updatedObj.id_receipt ??
                                  updatedObj.id ??
                                  receiptToEdit.id_receipt,
                              ),
                              receipt_number: String(
                                updatedObj.receipt_number ??
                                  updatedObj.number ??
                                  receiptToEdit.receipt_number ??
                                  "",
                              ),
                            } as Receipt;
                            onReceiptCreated?.(updatedReceipt);
                          } else {
                            onReceiptCreated?.(receiptToEdit);
                          }

                          setEditingReceipt(null);
                          setReceiptFormVisible(false);
                          router.refresh();
                          return submitResult;
                        }

                        const res = await authFetch(
                          "/api/receipts",
                          { method: "POST", body: JSON.stringify(payload) },
                          token ?? undefined,
                        );

                        const json: unknown = await res
                          .json()
                          .catch(() => null);

                        if (!res.ok) {
                          let msg = "No se pudo crear el recibo.";
                          const picked = pickApiMessage(json);
                          if (picked) msg = picked;
                          throw new Error(msg);
                        }
                        const submitResult = isSubmitResultLike(json)
                          ? json
                          : null;

                        const raw =
                          (isRecord(json) && json.receipt) ||
                          (isRecord(json) &&
                            isRecord(json.data) &&
                            json.data.receipt) ||
                          (isRecord(json) && Array.isArray(json.items)
                            ? json.items[0]
                            : null);

                        if (!raw) {
                          router.refresh();
                          return submitResult;
                        }

                        const obj = isRecord(raw) ? raw : {};
                        const receipt = {
                          ...(raw as Partial<Receipt>),
                          id_receipt: Number(obj.id_receipt ?? obj.id ?? 0),
                          receipt_number: String(
                            obj.receipt_number ?? obj.number ?? "",
                          ),
                        } as Receipt;

                        onReceiptCreated?.(receipt);
                        router.refresh();
                        return submitResult ?? submitResultFromReceipt(receipt);
                      }}
                      onCancel={editingReceipt ? cancelEditReceipt : undefined}
                    />
                  )}

                {receipts.length > 0 && (
                  <ReceiptList
                    token={token}
                    receipts={receipts}
                    booking={booking}
                    services={services}
                    role={role}
                    onReceiptDeleted={onReceiptDeleted}
                    onReceiptEdit={
                      canUseReceiptsForm ? startEditReceipt : undefined
                    }
                  />
                )}
              </div>

              {/* PAGOS A OPERADOR */}
              {canUseOperatorPayments && services.length > 0 && (
                <div>
                  <div className="mb-4 mt-8 flex items-center justify-center gap-2">
                    <p className="text-2xl font-medium">Pagos al Operador</p>
                  </div>
                  <OperatorPaymentForm
                    token={token}
                    booking={booking!}
                    availableServices={services}
                    operators={operators}
                    onCreated={() => {
                      setPaymentsReloadKey((k) => k + 1);
                      onPaymentCreated?.();
                    }}
                  />
                  <OperatorPaymentList
                    token={token}
                    bookingId={booking.id_booking}
                    reloadKey={paymentsReloadKey}
                  />
                </div>
              )}

              {billingSection}

              {/* ESTADOS RESERVA */}
              {canEditBookingStatus &&
                (services.length > 0 ||
                  invoices.length > 0 ||
                  receipts.length > 0 ||
                  creditNotes.length > 0) && (
                  <div className="my-8">
                    <div className="mb-4 mt-8 flex items-center justify-center gap-2">
                      <p className="text-2xl font-medium">
                        Estado de la reserva
                      </p>
                    </div>

                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        {/* Pax */}
                        <div className="rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
                          <p className="mb-2 font-medium">Pax</p>
                          <div className="flex gap-2">
                            {(["Pendiente", "Pago", "Facturado"] as const).map(
                              (st) => (
                                <button
                                  type="button"
                                  key={st}
                                  onClick={() => setSelectedClientStatus(st)}
                                  className={`flex-1 rounded-full py-2 text-center text-sm transition ${
                                    selectedClientStatus === st
                                      ? "rounded-3xl bg-sky-100 p-6 text-sky-950 shadow-sm shadow-sky-950/10 dark:bg-white/10 dark:text-white"
                                      : "text-sky-950/70 hover:bg-sky-950/5 dark:text-white/70 dark:hover:bg-white/5"
                                  }`}
                                  aria-pressed={selectedClientStatus === st}
                                >
                                  {st}
                                </button>
                              ),
                            )}
                          </div>
                        </div>

                        {/* Operador */}
                        <div className="rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
                          <p className="mb-2 font-medium">Operador</p>
                          <div className="flex gap-2">
                            {(["Pendiente", "Pago"] as const).map((st) => (
                              <button
                                type="button"
                                key={st}
                                onClick={() => setSelectedOperatorStatus(st)}
                                className={`flex-1 rounded-full py-2 text-center text-sm transition ${
                                  selectedOperatorStatus === st
                                    ? "rounded-3xl bg-sky-100 p-6 text-sky-950 shadow-sm shadow-sky-950/10 dark:bg-white/10 dark:text-white"
                                    : "text-sky-950/70 hover:bg-sky-950/5 dark:text-white/70 dark:hover:bg-white/5"
                                }`}
                                aria-pressed={selectedOperatorStatus === st}
                              >
                                {st}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Reserva */}
                        <div className="rounded-3xl border border-white/10 bg-white/10 p-4 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white">
                          <p className="mb-2 font-medium">Reserva</p>
                          <div className="flex gap-2">
                            {(
                              ["Abierta", "Bloqueada", "Cancelada"] as const
                            ).map((st) => (
                              <button
                                type="button"
                                key={st}
                                onClick={() => setSelectedBookingStatus(st)}
                                className={`flex-1 rounded-full py-2 text-center text-sm transition ${
                                  selectedBookingStatus === st
                                    ? "rounded-3xl bg-sky-100 p-6 text-sky-950 shadow-sm shadow-sky-950/10 dark:bg-white/10 dark:text-white"
                                    : "text-sky-950/70 hover:bg-sky-950/5 dark:text-white/70 dark:hover:bg-white/5"
                                }`}
                                aria-pressed={selectedBookingStatus === st}
                              >
                                {st}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={handleSaveStatuses}
                        disabled={!hasChanges}
                        aria-label="Guardar estados"
                        className={`ml-auto mr-4 flex items-center justify-center gap-2 rounded-full px-6 py-2 text-lg font-light transition-transform ${
                          hasChanges
                            ? "bg-white/10 p-6 text-sky-950 shadow-md shadow-sky-950/10 backdrop-blur dark:text-white"
                            : "cursor-not-allowed bg-sky-950/20 text-white/60 shadow-sm shadow-sky-950/10 dark:bg-white/5 dark:text-white/30 dark:backdrop-blur"
                        }`}
                      >
                        Guardar
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="size-6"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.4}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}

              {/* OPERADOR */}
              {(role === "administrativo" ||
                role === "desarrollador" ||
                role === "gerente" ||
                role === "vendedor") &&
                booking &&
                (services.length > 0 || operatorDues.length > 0) && (
                  <div className="mb-16">
                    <div className="mb-4 mt-8 flex items-center justify-center gap-2">
                      <p className="text-2xl font-medium">
                        Vencimiento del Operador{" "}
                        <span className="text-xl font-normal tracking-wide opacity-70">
                          (Opcional)
                        </span>
                      </p>
                    </div>

                    <OperatorDueForm
                      token={token}
                      booking={booking}
                      availableServices={services}
                      onCreated={() => {
                        const ac = new AbortController();
                        void fetchOperatorDues(ac.signal);
                      }}
                    />

                    <OperatorDueList
                      dues={operatorDues}
                      booking={booking}
                      role={role}
                      operators={operators}
                      loading={operatorDuesLoading}
                      onDueDeleted={handleOperatorDueDeleted}
                      onStatusChanged={handleOperatorDueStatusChanged}
                    />
                  </div>
                )}

              {/* PAGO AL CLIENTE */}
              <div className="mb-16">
                <div className="mb-4 mt-8 flex items-center justify-center gap-2">
                  <p className="text-2xl font-medium">
                    Plan de pagos del pax{" "}
                    <span className="text-xl font-normal tracking-wide opacity-70">
                      (Opcional)
                    </span>
                  </p>
                </div>

                {(role === "administrativo" ||
                  role === "desarrollador" ||
                  role === "gerente" ||
                  role === "vendedor" ||
                  role === "lider") &&
                  booking && (
                    <ClientPaymentForm
                      token={token}
                      booking={booking}
                      onCreated={handleClientPaymentCreated}
                    />
                  )}

                <ClientPaymentList
                  payments={clientPayments}
                  booking={booking!}
                  role={role}
                  loading={clientPaymentsLoading}
                  onPaymentDeleted={handleClientPaymentDeleted}
                />
              </div>
            </>
          ) : (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          )}
        </>
      )}
      <ToastContainer />
    </motion.div>
  );
}
