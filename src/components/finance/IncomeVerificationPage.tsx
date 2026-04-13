"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { loadFinancePicks } from "@/utils/loadFinancePicks";
import {
  normalizeReceiptVerificationRules,
  type ReceiptVerificationRule,
} from "@/utils/receiptVerification";
import {
  canAccessFinanceSection,
  normalizeFinanceSectionRules,
  type FinanceSectionKey,
} from "@/utils/permissions";
import { formatDateOnlyInBuenosAires } from "@/lib/buenosAiresDate";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const GLASS =
  "rounded-2xl border border-white/20 bg-white/10 backdrop-blur shadow-sm shadow-sky-900/10 dark:bg-white/10 dark:border-white/5";

const STATUS_STYLES: Record<string, string> = {
  PENDING:
    "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800/40",
  VERIFIED:
    "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-100 dark:border-emerald-800/40",
};

type VerificationKind = "receipts" | "other_incomes";

type ReceiptPaymentLine = {
  amount: number;
  payment_method_id: number | null;
  account_id: number | null;
  payment_method_text?: string;
  account_text?: string;
};

type ReceiptIncome = {
  id_receipt: number;
  agency_receipt_id?: number | null;
  source_type?: "STANDARD" | "GROUP";
  receipt_number: string;
  issue_date: string | null;
  amount: number;
  amount_currency: string;
  payment_fee_amount?: number | string | null;
  concept: string;
  payment_method?: string | null;
  account?: string | null;
  base_amount?: number | string | null;
  base_currency?: string | null;
  counter_amount?: number | string | null;
  counter_currency?: string | null;
  verification_status?: string | null;
  verified_at?: string | null;
  verified_by?: number | null;
  verifiedBy?: {
    id_user: number;
    first_name: string;
    last_name: string;
  } | null;
  payments?: ReceiptPaymentLine[];
  booking?: {
    id_booking: number;
    agency_booking_id?: number | null;
    titular?: {
      id_client: number;
      first_name: string | null;
      last_name: string | null;
    } | null;
  } | null;
  clientIds?: number[] | null;
  clientLabels?: string[] | null;
  travel_group_id?: number | null;
  agency_travel_group_id?: number | null;
  travel_group_name?: string | null;
};

type OtherIncomePayment = {
  amount: number;
  payment_method_id: number | null;
  account_id: number | null;
};

type OtherIncomeItem = {
  id_other_income: number;
  agency_other_income_id?: number | null;
  description: string;
  amount: number;
  currency: string;
  issue_date: string;
  payment_fee_amount?: number | string | null;
  payment_method_id?: number | null;
  account_id?: number | null;
  verification_status?: string | null;
  verified_at?: string | null;
  verified_by?: number | null;
  payments?: OtherIncomePayment[];
};

type VerificationItem = {
  kind: VerificationKind | "group_receipts";
  id: number;
  displayNumber: string;
  title: string;
  subtitle?: string;
  meta?: string;
  issue_date: string | null;
  amount: number;
  currency: string;
  payment_fee_amount?: number | string | null;
  verification_status?: string | null;
  verified_at?: string | null;
  verified_by?: number | null;
  verifiedByName?: string | null;
  payments: {
    amount: number;
    payment_method_id: number | null;
    account_id: number | null;
    payment_method_text?: string;
    account_text?: string;
  }[];
};

type ReceiptsResponse = { items: ReceiptIncome[]; nextCursor: number | null };

type GroupReceiptsResponse = { items: ReceiptIncome[]; nextCursor: number | null };

type OtherIncomesResponse = {
  items: OtherIncomeItem[];
  nextCursor: number | null;
};

type FinancePickBundle = {
  accounts: { id_account: number; name: string; enabled: boolean }[];
  paymentMethods: { id_method: number; name: string; enabled: boolean }[];
};

type IncomeVerificationPageProps = {
  defaultType?: VerificationKind;
};

const toNumber = (v?: number | string | null) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const normCurrency = (c?: string | null) =>
  String(c || "")
    .trim()
    .toUpperCase();

const fmtMoney = (v?: number | string | null, curr?: string | null) => {
  const n = toNumber(v);
  const currency = normCurrency(curr) || "ARS";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
};

const fmtDate = (iso?: string | null) => {
  return formatDateOnlyInBuenosAires(iso ?? null);
};

const getReceiptDisplayNumber = (receipt: ReceiptIncome) => {
  const isGroup =
    receipt.source_type === "GROUP" ||
    (typeof receipt.travel_group_id === "number" && receipt.travel_group_id > 0) ||
    String(receipt.receipt_number || "")
      .trim()
      .toUpperCase()
      .startsWith("GR-");

  if (isGroup) {
    if (
      typeof receipt.receipt_number === "string" &&
      receipt.receipt_number.trim().toUpperCase().startsWith("GR-")
    ) {
      return receipt.receipt_number;
    }
    const base = receipt.agency_receipt_id ?? receipt.id_receipt;
    return `GR-${String(base).padStart(6, "0")}`;
  }

  if (receipt.agency_receipt_id != null) {
    return String(receipt.agency_receipt_id);
  }
  return receipt.receipt_number;
};

export default function IncomeVerificationPage({
  defaultType = "receipts",
}: IncomeVerificationPageProps) {
  const { token, role } = useAuth() as { token?: string | null; role?: string | null };

  const [activeType, setActiveType] = useState<VerificationKind>(defaultType);
  const [items, setItems] = useState<VerificationItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "PENDING" | "VERIFIED" | "ALL"
  >("PENDING");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [finance, setFinance] = useState<FinancePickBundle | null>(null);
  const [verificationRule, setVerificationRule] =
    useState<ReceiptVerificationRule | null>(null);

  const [sectionGrants, setSectionGrants] = useState<FinanceSectionKey[]>([]);
  const [sectionLoading, setSectionLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const picks = await loadFinancePicks(token);
        setFinance({
          accounts: picks.accounts.map((a) => ({
            id_account: a.id_account,
            name: a.name,
            enabled: a.enabled,
          })),
          paymentMethods: picks.paymentMethods.map((m) => ({
            id_method: m.id_method,
            name: m.name,
            enabled: m.enabled,
          })),
        });
      } catch {
        setFinance(null);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const res = await authFetch(
          "/api/finance/verification-rules",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) throw new Error();
        const payload = (await res.json()) as { rules?: unknown };
        const rules = normalizeReceiptVerificationRules(payload?.rules);
        if (alive) setVerificationRule(rules[0] ?? null);
      } catch {
        if (alive) setVerificationRule(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setSectionLoading(true);
    (async () => {
      try {
        const res = await authFetch(
          "/api/finance/section-access",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) throw new Error();
        const payload = (await res.json()) as { rules?: unknown };
        const rules = normalizeFinanceSectionRules(payload?.rules);
        const rule = rules[0];
        setSectionGrants(rule?.sections ?? []);
      } catch {
        setSectionGrants([]);
      } finally {
        setSectionLoading(false);
      }
    })();
  }, [token]);

  const canVerifyReceipts = useMemo(
    () => canAccessFinanceSection(role, sectionGrants, "receipts_verify"),
    [role, sectionGrants],
  );
  const canVerifyOther = useMemo(
    () => canAccessFinanceSection(role, sectionGrants, "other_incomes_verify"),
    [role, sectionGrants],
  );

  useEffect(() => {
    if (defaultType === "receipts" && !canVerifyReceipts && canVerifyOther) {
      setActiveType("other_incomes");
    }
    if (defaultType === "other_incomes" && !canVerifyOther && canVerifyReceipts) {
      setActiveType("receipts");
    }
  }, [defaultType, canVerifyReceipts, canVerifyOther]);

  const accountMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const acc of finance?.accounts || []) {
      if (!acc.enabled) continue;
      map.set(acc.id_account, acc.name);
    }
    return map;
  }, [finance?.accounts]);

  const methodMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const method of finance?.paymentMethods || []) {
      if (!method.enabled) continue;
      map.set(method.id_method, method.name);
    }
    return map;
  }, [finance?.paymentMethods]);

  const allowedMethodIds = useMemo(
    () => verificationRule?.payment_method_ids ?? [],
    [verificationRule],
  );
  const allowedAccountIds = useMemo(
    () => verificationRule?.account_ids ?? [],
    [verificationRule],
  );

  const methodOptions = useMemo(() => {
    const list = (finance?.paymentMethods || []).filter((m) => m.enabled);
    if (allowedMethodIds.length === 0) return list;
    return list.filter((m) => allowedMethodIds.includes(m.id_method));
  }, [finance?.paymentMethods, allowedMethodIds]);

  const accountOptions = useMemo(() => {
    const list = (finance?.accounts || []).filter((a) => a.enabled);
    if (allowedAccountIds.length === 0) return list;
    return list.filter((a) => allowedAccountIds.includes(a.id_account));
  }, [finance?.accounts, allowedAccountIds]);

  useEffect(() => {
    if (methodFilter === "ALL") return;
    const id = Number(methodFilter);
    if (!methodOptions.some((m) => m.id_method === id)) {
      setMethodFilter("ALL");
    }
  }, [methodFilter, methodOptions]);

  useEffect(() => {
    if (accountFilter === "ALL") return;
    const id = Number(accountFilter);
    if (!accountOptions.some((a) => a.id_account === id)) {
      setAccountFilter("ALL");
    }
  }, [accountFilter, accountOptions]);

  const mapReceipts = useCallback((data: ReceiptIncome[]): VerificationItem[] => {
    return data.map((receipt) => {
      const isGroup =
        receipt.source_type === "GROUP" ||
        (typeof receipt.travel_group_id === "number" &&
          receipt.travel_group_id > 0) ||
        String(receipt.receipt_number || "")
          .trim()
          .toUpperCase()
          .startsWith("GR-");

      const clientNameFromBooking = receipt.booking?.titular
        ? `${receipt.booking.titular.first_name || ""} ${receipt.booking.titular.last_name || ""}`.trim()
        : "";
      const clientNameFromLabels = Array.isArray(receipt.clientLabels)
        ? receipt.clientLabels
            .map((label) => String(label || "").trim())
            .filter(Boolean)
            .join(", ")
        : "";
      const clientName = clientNameFromBooking || clientNameFromLabels;

      const bookingLabel = isGroup
        ? `Grupal N° ${receipt.agency_travel_group_id ?? receipt.travel_group_id ?? "-"}`
        : receipt.booking?.id_booking
          ? `Reserva N° ${receipt.booking.agency_booking_id ?? receipt.booking.id_booking}`
          : "";
      const meta = [bookingLabel, receipt.travel_group_name || "", clientName]
        .filter(Boolean)
        .join(" · ");

      const verifiedBy =
        receipt.verifiedBy?.first_name || receipt.verifiedBy?.last_name
          ? `${receipt.verifiedBy?.first_name || ""} ${receipt.verifiedBy?.last_name || ""}`.trim()
          : receipt.verified_by
            ? `Usuario N° ${receipt.verified_by}`
            : null;

      const paymentLines =
        (receipt.payments || []).map((p) => ({
          amount: p.amount,
          payment_method_id: p.payment_method_id ?? null,
          account_id: p.account_id ?? null,
          payment_method_text: p.payment_method_text,
          account_text: p.account_text,
        })) || [];

      if (paymentLines.length === 0 && (receipt.payment_method || receipt.account)) {
        paymentLines.push({
          amount: receipt.amount,
          payment_method_id: null,
          account_id: null,
          payment_method_text: receipt.payment_method || undefined,
          account_text: receipt.account || undefined,
        });
      }

      return {
        kind: isGroup ? "group_receipts" : "receipts",
        id: receipt.id_receipt,
        displayNumber: getReceiptDisplayNumber(receipt),
        title: receipt.concept || "Recibo",
        subtitle: receipt.receipt_number,
        meta,
        issue_date: receipt.issue_date,
        amount: receipt.amount,
        currency: receipt.amount_currency,
        payment_fee_amount: receipt.payment_fee_amount,
        verification_status: receipt.verification_status ?? "PENDING",
        verified_at: receipt.verified_at,
        verified_by: receipt.verified_by,
        verifiedByName: verifiedBy,
        payments: paymentLines,
      };
    });
  }, []);

  const mapOtherIncomes = useCallback(
    (data: OtherIncomeItem[]): VerificationItem[] => {
      return data.map((item) => {
        const paymentLines =
          (item.payments || []).map((p) => ({
            amount: p.amount,
            payment_method_id: p.payment_method_id ?? null,
            account_id: p.account_id ?? null,
          })) || [];

        if (
          paymentLines.length === 0 &&
          (item.payment_method_id || item.account_id)
        ) {
          paymentLines.push({
            amount: item.amount,
            payment_method_id: item.payment_method_id ?? null,
            account_id: item.account_id ?? null,
          });
        }

        return {
        kind: "other_incomes",
        id: item.id_other_income,
        displayNumber: String(item.agency_other_income_id ?? item.id_other_income),
        title: item.description || "Ingreso",
        issue_date: item.issue_date,
        amount: item.amount,
        currency: item.currency,
        payment_fee_amount: item.payment_fee_amount,
        verification_status: item.verification_status ?? "PENDING",
        verified_at: item.verified_at,
        verified_by: item.verified_by,
        verifiedByName: item.verified_by ? `Usuario N° ${item.verified_by}` : null,
        payments: paymentLines,
      };
      });
    },
    [],
  );

  const fetchItems = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (!token) return;
      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const qs = new URLSearchParams();
        qs.set("take", "30");
        if (!reset && cursor) qs.set("cursor", String(cursor));
        if (q.trim()) qs.set("q", q.trim());
        if (statusFilter !== "ALL") {
          if (activeType === "receipts") qs.set("verification_status", statusFilter);
          else qs.set("status", statusFilter);
        }
        if (activeType === "receipts") qs.set("verification_scope", "1");
        if (methodFilter !== "ALL") qs.set("payment_method_id", methodFilter);
        if (accountFilter !== "ALL") qs.set("account_id", accountFilter);

        const endpoint =
          activeType === "receipts" ? "/api/receipts" : "/api/other-incomes";

        const res = await authFetch(
          `${endpoint}?${qs.toString()}`,
          { cache: "no-store" },
          token,
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err?.error || "No se pudo cargar la lista.");
        }

        if (activeType === "receipts") {
          const payload = (await res.json()) as ReceiptsResponse;
          const normalized = mapReceipts(payload.items || []);

          let merged = normalized;
          if (reset) {
            try {
              const groupQs = new URLSearchParams(qs.toString());
              groupQs.delete("cursor");
              groupQs.set("take", "300");
              const groupRes = await authFetch(
                `/api/groups/finance/receipts?${groupQs.toString()}`,
                { cache: "no-store" },
                token,
              );
              if (groupRes.ok) {
                const groupPayload =
                  (await groupRes.json()) as GroupReceiptsResponse;
                const mappedGroups = mapReceipts(groupPayload.items || []);
                merged = [...normalized, ...mappedGroups].sort((a, b) => {
                  const aTime = a.issue_date ? new Date(a.issue_date).getTime() : 0;
                  const bTime = b.issue_date ? new Date(b.issue_date).getTime() : 0;
                  if (aTime !== bTime) return bTime - aTime;
                  return b.id - a.id;
                });
              }
            } catch (groupError) {
              console.error("[income-verification][groups][list]", groupError);
            }
          }

          setItems((prev) => (reset ? merged : [...prev, ...normalized]));
          setCursor(payload.nextCursor ?? null);
        } else {
          const payload = (await res.json()) as OtherIncomesResponse;
          const normalized = mapOtherIncomes(payload.items || []);
          setItems((prev) => (reset ? normalized : [...prev, ...normalized]));
          setCursor(payload.nextCursor ?? null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo cargar la lista.";
        toast.error(msg);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      token,
      cursor,
      q,
      statusFilter,
      methodFilter,
      accountFilter,
      activeType,
      mapReceipts,
      mapOtherIncomes,
    ],
  );

  useEffect(() => {
    if (!token) return;
    setItems([]);
    setCursor(null);
    fetchItems({ reset: true });
  }, [token, activeType, q, statusFilter, methodFilter, accountFilter, fetchItems]);

  const applySearch = () => setQ(qInput.trim());
  const clearFilters = () => {
    setQInput("");
    setQ("");
    setStatusFilter("PENDING");
    setMethodFilter("ALL");
    setAccountFilter("ALL");
  };

  const updateStatus = async (
    target: VerificationItem,
    nextStatus: "PENDING" | "VERIFIED",
  ) => {
    if (!token) return;
    const actionKey = `${target.kind}-${target.id}`;
    setUpdatingId(actionKey);
    try {
      const endpoint =
        target.kind === "group_receipts"
          ? `/api/groups/finance/receipts/${target.id}/verify`
          : target.kind === "receipts"
            ? `/api/receipts/${target.id}/verify`
            : `/api/other-incomes/${target.id}/verify`;
      const res = await authFetch(
        endpoint,
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        },
        token,
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err?.error || "No se pudo actualizar el estado.");
      }
      const payload = (await res.json()) as {
        receipt?: {
          verification_status?: string | null;
          verified_at?: string | null;
          verified_by?: number | null;
        };
        item?: {
          verification_status?: string | null;
          verified_at?: string | null;
          verified_by?: number | null;
        };
      };
      const updated = payload?.receipt ?? payload?.item;
      setItems((prev) =>
        prev.map((item) =>
          item.id === target.id && item.kind === target.kind
            ? {
                ...item,
                verification_status: updated?.verification_status ?? nextStatus,
                verified_at: updated?.verified_at ?? null,
                verified_by: updated?.verified_by ?? null,
              }
            : item,
        ),
      );
      toast.success(
        nextStatus === "VERIFIED"
          ? "Ingreso verificado."
          : "Ingreso marcado como pendiente.",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo actualizar el estado.";
      toast.error(msg);
    } finally {
      setUpdatingId(null);
    }
  };

  const statusLabel =
    statusFilter === "ALL"
      ? "Todos"
      : statusFilter === "VERIFIED"
        ? "Verificados"
        : "Pendientes";

  const toggleType = (next: VerificationKind) => {
    if (next === activeType) return;
    if (sectionLoading) return;
    if (next === "receipts" && !canVerifyReceipts) {
      toast.error("Sin permisos para verificar recibos.");
      return;
    }
    if (next === "other_incomes" && !canVerifyOther) {
      toast.error("Sin permisos para verificar ingresos.");
      return;
    }
    setActiveType(next);
  };

  const showReceiptLink = activeType === "receipts";

  return (
    <ProtectedRoute>
      <div className="mx-auto flex w-full flex-col gap-4 px-4 py-8 text-sky-950 dark:text-white">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              {activeType === "receipts"
                ? "Verificación de recibos"
                : "Verificación de ingresos"}
            </h1>
            <p className="text-xs text-sky-950/70 dark:text-white/70">
              {activeType === "receipts"
                ? "Lista de recibos para validar y controlar medios de cobro."
                : "Validá ingresos no vinculados a reservas."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-sky-950/70 dark:text-white/70">
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
              Filtro: {statusLabel}
            </span>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">
              Mostrando: {items.length}
            </span>
            <Link
              href={showReceiptLink ? "/receipts" : "/other-incomes"}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold shadow-sm transition-transform hover:scale-[0.99]"
            >
              {showReceiptLink ? "Ir a recibos" : "Ir a ingresos"}
            </Link>
          </div>
        </header>

        <section className={`${GLASS} flex flex-col gap-3 p-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => toggleType("receipts")}
                disabled={!canVerifyReceipts}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  activeType === "receipts"
                    ? "bg-sky-100 text-sky-950"
                    : "text-sky-950/70 hover:bg-white/40 dark:text-white/70"
                } ${!canVerifyReceipts ? "opacity-40" : ""}`}
              >
                Recibos
              </button>
              <button
                type="button"
                onClick={() => toggleType("other_incomes")}
                disabled={!canVerifyOther}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  activeType === "other_incomes"
                    ? "bg-sky-100 text-sky-950"
                    : "text-sky-950/70 hover:bg-white/40 dark:text-white/70"
                } ${!canVerifyOther ? "opacity-40" : ""}`}
              >
                Ingresos
              </button>
            </div>
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 shadow-sm">
              <input
                className="w-full bg-transparent text-xs outline-none placeholder:text-sky-950/50 dark:placeholder:text-white/40"
                placeholder={
                  activeType === "receipts"
                    ? "Buscar por recibo, pax, concepto o reserva"
                    : "Buscar por descripción o número"
                }
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </div>
            <select
              className="h-9 rounded-full border border-white/20 bg-white/10 px-3 text-xs shadow-sm outline-none"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value as "PENDING" | "VERIFIED" | "ALL",
                )
              }
            >
              <option value="PENDING">Pendientes</option>
              <option value="VERIFIED">Verificados</option>
              <option value="ALL">Todos</option>
            </select>
            <select
              className="h-9 rounded-full border border-white/20 bg-white/10 px-3 text-xs shadow-sm outline-none"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
            >
              <option value="ALL">Métodos (todos)</option>
              {methodOptions.map((method) => (
                <option key={method.id_method} value={String(method.id_method)}>
                  {method.name}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-full border border-white/20 bg-white/10 px-3 text-xs shadow-sm outline-none"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
            >
              <option value="ALL">Cuentas (todas)</option>
              {accountOptions.map((account) => (
                <option key={account.id_account} value={String(account.id_account)}>
                  {account.name}
                </option>
              ))}
            </select>
            <button
              onClick={applySearch}
              className="h-9 rounded-full bg-sky-100 px-3 text-xs font-semibold text-sky-950 shadow-sm transition-transform hover:scale-[0.99]"
            >
              Buscar
            </button>
            <button
              onClick={clearFilters}
              className="h-9 rounded-full border border-white/20 bg-white/10 px-3 text-xs shadow-sm transition-transform hover:scale-[0.99]"
            >
              Limpiar
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          {loading ? (
            <div className={`${GLASS} flex items-center justify-center p-8`}>
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <div className={`${GLASS} p-6 text-center text-sm`}>
              No hay ingresos para mostrar con los filtros actuales.
            </div>
          ) : (
            items.map((item) => {
              const status = String(item.verification_status || "PENDING")
                .toUpperCase()
                .trim();

              const feeAmount = toNumber(item.payment_fee_amount);
              const clientTotal = toNumber(item.amount) + feeAmount;
              const itemActionKey = `${item.kind}-${item.id}`;

              const paymentsLabel = (item.payments || []).map((p) => {
                const method =
                  (p.payment_method_id
                    ? methodMap.get(p.payment_method_id)
                    : undefined) ||
                  p.payment_method_text ||
                  "Metodo";
                const account =
                  (p.account_id ? accountMap.get(p.account_id) : undefined) ||
                  p.account_text ||
                  "";
                const label = account ? `${method} / ${account}` : method;
                return `${label}: ${fmtMoney(p.amount, item.currency)}`;
              });

              return (
                <article
                  key={`${item.kind}-${item.id}`}
                  className={`${GLASS} flex flex-col gap-3 p-4`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-sky-950/70 dark:text-white/70">
                      <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-sky-950 dark:text-white">
                        N° {item.displayNumber}
                      </span>
                      <span>Fecha: {fmtDate(item.issue_date)}</span>
                      {item.meta ? <span>{item.meta}</span> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          STATUS_STYLES[status] || STATUS_STYLES.PENDING
                        }`}
                      >
                        {status === "VERIFIED" ? "Verificado" : "Pendiente"}
                      </span>
                      {status === "VERIFIED" ? (
                        <button
                          disabled={updatingId === itemActionKey}
                          onClick={() => updateStatus(item, "PENDING")}
                          className="h-8 rounded-full border border-white/20 bg-white/10 px-3 text-[11px] font-semibold shadow-sm transition-transform hover:scale-[0.99] disabled:opacity-50"
                        >
                          {updatingId === itemActionKey
                            ? "Actualizando..."
                            : "Marcar pendiente"}
                        </button>
                      ) : (
                        <button
                          disabled={updatingId === itemActionKey}
                          onClick={() => updateStatus(item, "VERIFIED")}
                          className="h-8 rounded-full bg-emerald-100 px-3 text-[11px] font-semibold text-emerald-950 shadow-sm transition-transform hover:scale-[0.99] disabled:opacity-50"
                        >
                          {updatingId === itemActionKey
                            ? "Verificando..."
                            : "Verificar ingreso"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">
                        {item.title || "Sin descripción"}
                      </p>
                      {item.meta ? (
                        <p className="text-xs text-sky-950/70 dark:text-white/70">
                          {item.meta}
                        </p>
                      ) : null}
                      <p className="text-xs text-sky-950/70 dark:text-white/70">
                        Metodos: {paymentsLabel.length > 0 ? paymentsLabel.join(" | ") : "-"}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                        Ingreso neto
                      </p>
                      <p className="text-base font-semibold">
                        {fmtMoney(item.amount, item.currency)}
                      </p>
                      {feeAmount > 0 ? (
                        <p className="text-xs text-sky-950/70 dark:text-white/70">
                          Costo medio: {fmtMoney(item.payment_fee_amount, item.currency)} (Total: {fmtMoney(clientTotal, item.currency)})
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                        Verificación
                      </p>
                      <p className="text-xs">
                        {item.verifiedByName ? `Por: ${item.verifiedByName}` : "-"}
                      </p>
                      <p className="text-xs">
                        {item.verified_at ? `Fecha: ${fmtDate(item.verified_at)}` : "-"}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })
          )}

          {cursor && !loading && (
            <div className="flex justify-center">
              <button
                onClick={() => fetchItems({ reset: false })}
                className="rounded-full border border-white/20 bg-white/10 px-5 py-2 text-xs shadow-sm transition-transform hover:scale-[0.99]"
                disabled={loadingMore}
              >
                {loadingMore ? "Cargando..." : "Cargar mas"}
              </button>
            </div>
          )}
        </section>
      </div>
      <ToastContainer position="bottom-right" />
    </ProtectedRoute>
  );
}
