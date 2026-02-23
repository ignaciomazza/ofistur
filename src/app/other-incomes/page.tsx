"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { loadFinancePicks } from "@/utils/loadFinancePicks";
import { toast, ToastContainer } from "react-toastify";
import {
  formatDateOnlyInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
  todayDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";
import "react-toastify/dist/ReactToastify.css";

const PANEL =
  "rounded-3xl border border-white/10 bg-white/10 p-4 shadow-md shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10";
const SUBPANEL =
  "rounded-2xl border border-white/15 bg-white/30 p-3 shadow-inner dark:bg-zinc-900/40";
const CHIP =
  "rounded-full border border-white/20 bg-white/40 px-3 py-1 text-xs text-zinc-700 shadow-sm dark:text-zinc-200";

const TAKE = 24;

const DEFAULT_FILTERS = {
  q: "",
  status: "ALL",
  currency: "",
  dateFrom: "",
  dateTo: "",
  paymentMethodId: "ALL",
  accountId: "ALL",
  categoryId: "ALL",
};

type PaymentLine = {
  amount: number;
  payment_method_id: number | null;
  account_id: number | null;
};

type OtherIncomeItem = {
  id_other_income: number;
  agency_other_income_id?: number | null;
  description: string;
  category_id?: number | null;
  category?: {
    id_category: number;
    name: string;
    enabled?: boolean;
  } | null;
  operator_id?: number | null;
  operator?: {
    id_operator: number;
    agency_operator_id?: number | null;
    name: string;
  } | null;
  counterparty_type?: string | null;
  counterparty_name?: string | null;
  receipt_to?: string | null;
  reference_note?: string | null;
  amount: number;
  currency: string;
  issue_date: string;
  payment_fee_amount?: number | string | null;
  verification_status?: string | null;
  payments?: PaymentLine[];
};

type ApiResponse = {
  items: OtherIncomeItem[];
  nextCursor: number | null;
};

type ReportCurrencyRow = {
  currency: string;
  amount: number;
  fees: number;
  count: number;
};

type ReportResponse = {
  totalCount: number;
  totalsByCurrency: ReportCurrencyRow[];
  totalsByPaymentMethod: { payment_method_id: number | null; amount: number }[];
  totalsByAccount: { account_id: number | null; amount: number }[];
};

type FinancePickBundle = {
  currencies: { code: string; name: string; enabled: boolean }[];
  accounts: { id_account: number; name: string; enabled: boolean }[];
  categories: {
    id_category: number;
    name: string;
    enabled: boolean;
    scope: "INVESTMENT" | "OTHER_INCOME";
    requires_operator?: boolean;
  }[];
  paymentMethods: {
    id_method: number;
    name: string;
    enabled: boolean;
    requires_account?: boolean | null;
  }[];
};

type PaymentFormLine = {
  amount: string;
  payment_method_id: string;
  account_id: string;
};

type ViewMode = "cards" | "table" | "monthly";

type GroupedMonth = {
  key: string;
  label: string;
  items: OtherIncomeItem[];
  totals: Record<string, number>;
};

type OperatorOption = {
  id_operator: number;
  agency_operator_id?: number | null;
  name: string;
};

const emptyLine = (): PaymentFormLine => ({
  amount: "",
  payment_method_id: "",
  account_id: "",
});

const toNumber = (raw: string | number | null | undefined) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const value = String(raw || "").trim();
  if (!value) return 0;

  const cleaned = value.replace(/[^\d.,]/g, "");
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let decimalSep: "," | "." | null = null;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    decimalSep = decimals > 0 && decimals <= 2 ? "," : null;
  } else if (lastDot >= 0) {
    const decimals = cleaned.length - lastDot - 1;
    decimalSep = decimals > 0 && decimals <= 2 ? "." : null;
  }

  let normalized = cleaned;
  if (decimalSep) {
    normalized =
      decimalSep === ","
        ? normalized.replace(/\./g, "")
        : normalized.replace(/,/g, "");
    const parts = normalized.split(decimalSep);
    const intPart = (parts.shift() || "0").replace(/[^\d]/g, "") || "0";
    const decPart = parts.join("").replace(/[^\d]/g, "").slice(0, 2);
    normalized = decPart ? `${intPart}.${decPart}` : intPart;
  } else {
    normalized = normalized.replace(/[.,]/g, "");
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

const normCurrency = (c?: string | null) =>
  String(c || "")
    .trim()
    .toUpperCase();

const fmtMoney = (v?: number | string | null, curr?: string | null) => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  const currency = normCurrency(curr) || "ARS";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
    }).format(Number.isFinite(n) ? n : 0);
  } catch {
    return `${currency} ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
  }
};

const moneyPrefix = (curr?: string | null) => {
  const code = normCurrency(curr) || "ARS";
  if (code === "ARS") return "$";
  if (code === "USD") return "US$";
  return code;
};

const formatIntegerEs = (digits: string) => {
  const normalized = digits.replace(/^0+(?=\d)/, "") || "0";
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const formatMoneyInput = (
  raw: string,
  curr?: string | null,
  options?: { preferDotDecimal?: boolean },
) => {
  const cleaned = String(raw || "").replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return "";

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const hasComma = lastComma >= 0;
  const hasDot = lastDot >= 0;
  let preferDotDecimal = Boolean(options?.preferDotDecimal);

  if (!hasComma && hasDot && !preferDotDecimal) {
    const decimals = cleaned.length - lastDot - 1;
    preferDotDecimal = decimals > 0 && decimals <= 2;
  }

  let sepIndex = -1;

  let intDigits = cleaned.replace(/[^\d]/g, "");
  let decDigits = "";
  let hasDecimal = false;

  if (hasComma) {
    sepIndex = lastComma;
  } else if (hasDot && preferDotDecimal) {
    sepIndex = lastDot;
  }

  if (sepIndex >= 0) {
    const before = cleaned.slice(0, sepIndex).replace(/[^\d]/g, "");
    const afterRaw = cleaned.slice(sepIndex + 1).replace(/[^\d]/g, "");
    hasDecimal = true;
    intDigits = before || "0";
    decDigits = afterRaw.slice(0, 2);
  }

  const intPart = formatIntegerEs(intDigits);
  const decPart = hasDecimal ? `,${decDigits}` : "";
  return `${moneyPrefix(curr)} ${intPart}${decPart}`;
};

const shouldPreferDotDecimal = (ev: React.ChangeEvent<HTMLInputElement>) => {
  const native = ev.nativeEvent as InputEvent | undefined;
  const char = typeof native?.data === "string" ? native.data : "";
  if (char === "." || char === ",") return true;
  return native?.inputType === "insertFromPaste";
};

const fmtDate = (iso?: string | null) => {
  return formatDateOnlyInBuenosAires(iso ?? null);
};

const ymdToday = () => todayDateKeyInBuenosAires();

function toYmd(iso?: string | null): string {
  return toDateKeyInBuenosAiresLegacySafe(iso ?? null) ?? "";
}

const formatMonthLabel = (key: string) => {
  const [y, m] = key.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
  }).format(date);
};

const textOrEmpty = (v?: string | null) => String(v || "").trim();
const normSoft = (v?: string | null) =>
  String(v || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

const getIncomeCounterparty = (item: OtherIncomeItem) => {
  const name = textOrEmpty(item.counterparty_name);
  const receiptTo = textOrEmpty(item.receipt_to);
  const legacyType = textOrEmpty(item.counterparty_type);
  return name || receiptTo || legacyType;
};

const getIncomeOperatorLabel = (
  item: OtherIncomeItem,
  operatorMap: Map<number, OperatorOption>,
) => {
  const directName = textOrEmpty(item.operator?.name);
  if (directName) return directName;
  const id = Number(item.operator_id ?? 0);
  if (!Number.isFinite(id) || id <= 0) return "";
  const fallback = operatorMap.get(Math.trunc(id));
  if (fallback?.name) return fallback.name;
  return `Operador N° ${Math.trunc(id)}`;
};

export default function OtherIncomesPage() {
  const { token } = useAuth() as { token?: string | null };

  const [finance, setFinance] = useState<FinancePickBundle | null>(null);
  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [items, setItems] = useState<OtherIncomeItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({ ...DEFAULT_FILTERS });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  const [form, setForm] = useState(() => ({
    description: "",
    category_id: "",
    operator_id: "",
    counterparty_name: "",
    reference_note: "",
    currency: "ARS",
    issue_date: ymdToday(),
    payment_fee_amount: "",
    payments: [emptyLine()],
  }));

  const [editingItem, setEditingItem] = useState<OtherIncomeItem | null>(null);
  const [editForm, setEditForm] = useState(() => ({
    description: "",
    category_id: "",
    operator_id: "",
    counterparty_name: "",
    reference_note: "",
    currency: "ARS",
    issue_date: ymdToday(),
    payment_fee_amount: "",
    payments: [emptyLine()],
  }));

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [picks, operatorsRes] = await Promise.all([
          loadFinancePicks(token),
          authFetch("/api/operators", { cache: "no-store" }, token).catch(
            () => null,
          ),
        ]);

        const parsedOperators: OperatorOption[] = [];
        if (operatorsRes?.ok) {
          const raw = (await operatorsRes.json().catch(() => null)) as unknown;
          if (Array.isArray(raw)) {
            for (const op of raw) {
              if (!op || typeof op !== "object") continue;
              const rec = op as Record<string, unknown>;
              const id = Number(rec.id_operator);
              const name = String(rec.name ?? "").trim();
              if (!Number.isFinite(id) || id <= 0 || !name) continue;
              const agencyOperatorId = Number(rec.agency_operator_id);
              parsedOperators.push({
                id_operator: Math.trunc(id),
                agency_operator_id:
                  Number.isFinite(agencyOperatorId) && agencyOperatorId > 0
                    ? Math.trunc(agencyOperatorId)
                    : null,
                name,
              });
            }
          }
        }

        setOperators(parsedOperators);
        setFinance({
          currencies: picks.currencies.map((c) => ({
            code: c.code,
            name: c.name,
            enabled: c.enabled,
          })),
          accounts: picks.accounts.map((a) => ({
            id_account: a.id_account,
            name: a.name,
            enabled: a.enabled,
          })),
          categories: picks.categories.map((c) => ({
            id_category: c.id_category,
            name: c.name,
            enabled: c.enabled,
            scope: c.scope,
            requires_operator: c.requires_operator,
          })),
          paymentMethods: picks.paymentMethods.map((m) => ({
            id_method: m.id_method,
            name: m.name,
            enabled: m.enabled,
            requires_account: m.requires_account,
          })),
        });
      } catch {
        setFinance(null);
        setOperators([]);
      }
    })();
  }, [token]);

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

  const categoryMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const category of finance?.categories || []) {
      map.set(category.id_category, category.name);
    }
    return map;
  }, [finance?.categories]);

  const categoryOptions = useMemo(() => {
    return (finance?.categories || []).filter((c) => c.scope === "OTHER_INCOME");
  }, [finance?.categories]);

  const categoryById = useMemo(() => {
    const map = new Map<number, (typeof categoryOptions)[number]>();
    for (const category of categoryOptions) {
      map.set(category.id_category, category);
    }
    return map;
  }, [categoryOptions]);

  const operatorMap = useMemo(() => {
    const map = new Map<number, OperatorOption>();
    for (const operator of operators) {
      map.set(operator.id_operator, operator);
    }
    return map;
  }, [operators]);

  const categoryRequiresOperator = useCallback(
    (rawCategoryId?: string | null) => {
      const id = Number(rawCategoryId);
      if (!Number.isFinite(id) || id <= 0) return false;
      const category = categoryById.get(Math.trunc(id));
      if (!category) return false;
      if (category.requires_operator) return true;
      return normSoft(category.name).startsWith("operador");
    },
    [categoryById],
  );

  const formCategoryRequiresOperator = useMemo(
    () => categoryRequiresOperator(form.category_id),
    [categoryRequiresOperator, form.category_id],
  );

  const editCategoryRequiresOperator = useMemo(
    () => categoryRequiresOperator(editForm.category_id),
    [categoryRequiresOperator, editForm.category_id],
  );

  const currencyOptions = useMemo(() => {
    const enabled = finance?.currencies?.filter((c) => c.enabled) ?? [];
    if (enabled.length === 0) return ["ARS", "USD"];
    return enabled.map((c) => c.code);
  }, [finance?.currencies]);

  useEffect(() => {
    if (currencyOptions.length === 0) return;
    if (!currencyOptions.includes(form.currency)) {
      setForm((prev) => ({ ...prev, currency: currencyOptions[0] }));
    }
    if (!currencyOptions.includes(editForm.currency)) {
      setEditForm((prev) => ({ ...prev, currency: currencyOptions[0] }));
    }
  }, [currencyOptions, form.currency, editForm.currency]);

  useEffect(() => {
    if (formCategoryRequiresOperator || !form.operator_id) return;
    setForm((prev) => ({ ...prev, operator_id: "" }));
  }, [formCategoryRequiresOperator, form.operator_id]);

  useEffect(() => {
    if (editCategoryRequiresOperator || !editForm.operator_id) return;
    setEditForm((prev) => ({ ...prev, operator_id: "" }));
  }, [editCategoryRequiresOperator, editForm.operator_id]);

  const totalAmount = useMemo(() => {
    return form.payments.reduce((acc, line) => acc + toNumber(line.amount), 0);
  }, [form.payments]);

  const totalEditAmount = useMemo(() => {
    return editForm.payments.reduce(
      (acc, line) => acc + toNumber(line.amount),
      0,
    );
  }, [editForm.payments]);

  const reportCurrency = useMemo(() => {
    if (appliedFilters.currency) return normCurrency(appliedFilters.currency);
    const rows = report?.totalsByCurrency ?? [];
    if (rows.length === 1) return normCurrency(rows[0]?.currency);
    return null;
  }, [appliedFilters.currency, report?.totalsByCurrency]);

  const formatReportAmount = useCallback(
    (amount: number) => {
      if (reportCurrency) return fmtMoney(amount, reportCurrency);
      const safe = Number.isFinite(amount) ? amount : 0;
      return safe.toFixed(2);
    },
    [reportCurrency],
  );

  const buildQS = useCallback(
    (withCursor?: number | null) => {
      const qs = new URLSearchParams();
      if (appliedFilters.q.trim()) qs.set("q", appliedFilters.q.trim());
      if (appliedFilters.status !== "ALL")
        qs.set("status", appliedFilters.status);
      if (appliedFilters.currency.trim())
        qs.set("currency", appliedFilters.currency.trim());
      if (appliedFilters.dateFrom) qs.set("dateFrom", appliedFilters.dateFrom);
      if (appliedFilters.dateTo) qs.set("dateTo", appliedFilters.dateTo);
      if (appliedFilters.paymentMethodId !== "ALL")
        qs.set("payment_method_id", appliedFilters.paymentMethodId);
      if (appliedFilters.accountId !== "ALL")
        qs.set("account_id", appliedFilters.accountId);
      if (appliedFilters.categoryId !== "ALL")
        qs.set("category_id", appliedFilters.categoryId);

      qs.set("take", String(TAKE));
      if (withCursor) qs.set("cursor", String(withCursor));
      return qs;
    },
    [appliedFilters],
  );

  const fetchItems = useCallback(
    async (resetList: boolean) => {
      if (!token) return;
      if (resetList) setLoading(true);
      else setLoadingMore(true);

      try {
        const qs = buildQS(resetList ? undefined : cursor);
        const res = await authFetch(
          `/api/other-incomes?${qs.toString()}`,
          { cache: "no-store" },
          token,
        );
        const json = (await res.json()) as ApiResponse & { error?: string };
        if (!res.ok) throw new Error(json?.error || "Error al cargar ingresos");

        setItems((prev) => (resetList ? json.items : [...prev, ...json.items]));
        setCursor(json.nextCursor ?? null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error al cargar ingresos";
        toast.error(msg);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [token, buildQS, cursor],
  );

  const fetchReport = useCallback(async () => {
    if (!token) return;
    setReportLoading(true);
    try {
      const qs = buildQS(null);
      const res = await authFetch(
        `/api/other-incomes/report?${qs.toString()}`,
        { cache: "no-store" },
        token,
      );
      const json = (await res.json()) as ReportResponse & { error?: string };
      if (!res.ok) throw new Error(json?.error || "Error al generar reporte");
      setReport(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al generar reporte";
      toast.error(msg);
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }, [token, buildQS]);

  useEffect(() => {
    setCursor(null);
    setItems([]);
    fetchItems(true);
    fetchReport();
  }, [appliedFilters, fetchItems, fetchReport]);

  const refreshList = () => {
    setCursor(null);
    setItems([]);
    fetchItems(true);
  };

  const applyFilters = () => {
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
    setAppliedFilters({ ...DEFAULT_FILTERS });
  };

  const updateLine = (index: number, patch: Partial<PaymentFormLine>) => {
    setForm((prev) => {
      const next = [...prev.payments];
      next[index] = { ...next[index], ...patch };
      return { ...prev, payments: next };
    });
  };

  const updateEditLine = (index: number, patch: Partial<PaymentFormLine>) => {
    setEditForm((prev) => {
      const next = [...prev.payments];
      next[index] = { ...next[index], ...patch };
      return { ...prev, payments: next };
    });
  };

  const addLine = () => {
    setForm((prev) => ({ ...prev, payments: [...prev.payments, emptyLine()] }));
  };

  const addEditLine = () => {
    setEditForm((prev) => ({
      ...prev,
      payments: [...prev.payments, emptyLine()],
    }));
  };

  const removeLine = (index: number) => {
    setForm((prev) => {
      const next = prev.payments.filter((_, i) => i !== index);
      return { ...prev, payments: next.length ? next : [emptyLine()] };
    });
  };

  const removeEditLine = (index: number) => {
    setEditForm((prev) => {
      const next = prev.payments.filter((_, i) => i !== index);
      return { ...prev, payments: next.length ? next : [emptyLine()] };
    });
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!token) return;

    if (!form.description.trim()) {
      toast.error("La descripción es obligatoria.");
      return;
    }
    if (formCategoryRequiresOperator && !form.operator_id) {
      toast.error(
        "Para categorías vinculadas a operadores, seleccioná un operador.",
      );
      return;
    }

    const normalizedPayments = form.payments
      .map((line) => ({
        amount: toNumber(line.amount),
        payment_method_id: Number(line.payment_method_id),
        account_id: line.account_id ? Number(line.account_id) : undefined,
      }))
      .filter(
        (p) =>
          Number.isFinite(p.amount) &&
          p.amount > 0 &&
          Number.isFinite(p.payment_method_id) &&
          p.payment_method_id > 0,
      );

    if (normalizedPayments.length === 0) {
      toast.error("Agregá al menos una línea de pago válida.");
      return;
    }

    const payload = {
      description: form.description.trim(),
      category_id: form.category_id ? Number(form.category_id) : undefined,
      operator_id:
        formCategoryRequiresOperator && form.operator_id
          ? Number(form.operator_id)
          : undefined,
      counterparty_name: form.counterparty_name.trim() || undefined,
      receipt_to: form.counterparty_name.trim() || undefined,
      reference_note: form.reference_note.trim() || undefined,
      currency: form.currency,
      issue_date: form.issue_date,
      payment_fee_amount:
        form.payment_fee_amount !== ""
          ? toNumber(form.payment_fee_amount)
          : undefined,
      amount: totalAmount,
      payments: normalizedPayments,
    };

    try {
      const res = await authFetch(
        "/api/other-incomes",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        token,
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err?.error || "Error creando el ingreso");
      }
      const data = (await res.json()) as { item?: OtherIncomeItem | null };
      if (data?.item) {
        setItems((prev) => [data.item!, ...prev]);
      }
      setForm({
        description: "",
        category_id: form.category_id,
        operator_id: formCategoryRequiresOperator ? form.operator_id : "",
        counterparty_name: "",
        reference_note: "",
        currency: form.currency,
        issue_date: ymdToday(),
        payment_fee_amount: "",
        payments: [emptyLine()],
      });
      fetchReport();
      toast.success("Ingreso creado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error creando el ingreso.");
    }
  };

  const openEdit = (item: OtherIncomeItem) => {
    if (item.verification_status === "VERIFIED") {
      toast.error("Desverificá el ingreso antes de editarlo.");
      return;
    }

    const payments =
      Array.isArray(item.payments) && item.payments.length > 0
        ? item.payments
        : [];

    setEditForm({
      description: item.description || "",
      category_id:
        item.category_id != null && Number.isFinite(Number(item.category_id))
          ? String(item.category_id)
          : "",
      operator_id:
        item.operator_id != null && Number.isFinite(Number(item.operator_id))
          ? String(item.operator_id)
          : "",
      counterparty_name: item.counterparty_name || item.receipt_to || "",
      reference_note: item.reference_note || "",
      currency: item.currency || "ARS",
      issue_date: toYmd(item.issue_date) || ymdToday(),
      payment_fee_amount:
        item.payment_fee_amount != null
          ? formatMoneyInput(String(item.payment_fee_amount), item.currency)
          : "",
      payments:
        payments.length > 0
          ? payments.map((p) => ({
              amount: formatMoneyInput(String(p.amount ?? ""), item.currency),
              payment_method_id: String(p.payment_method_id ?? ""),
              account_id: p.account_id ? String(p.account_id) : "",
            }))
          : [emptyLine()],
    });
    setEditingItem(item);
  };

  const handleEditSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!token || !editingItem) return;

    if (!editForm.description.trim()) {
      toast.error("La descripción es obligatoria.");
      return;
    }
    if (editCategoryRequiresOperator && !editForm.operator_id) {
      toast.error(
        "Para categorías vinculadas a operadores, seleccioná un operador.",
      );
      return;
    }

    const normalizedPayments = editForm.payments
      .map((line) => ({
        amount: toNumber(line.amount),
        payment_method_id: Number(line.payment_method_id),
        account_id: line.account_id ? Number(line.account_id) : undefined,
      }))
      .filter(
        (p) =>
          Number.isFinite(p.amount) &&
          p.amount > 0 &&
          Number.isFinite(p.payment_method_id) &&
          p.payment_method_id > 0,
      );

    if (normalizedPayments.length === 0) {
      toast.error("Agregá al menos una línea de pago válida.");
      return;
    }

    const payload = {
      description: editForm.description.trim(),
      category_id: editForm.category_id ? Number(editForm.category_id) : null,
      operator_id:
        editCategoryRequiresOperator && editForm.operator_id
          ? Number(editForm.operator_id)
          : null,
      counterparty_name: editForm.counterparty_name.trim() || null,
      receipt_to: editForm.counterparty_name.trim() || null,
      counterparty_type: null,
      reference_note: editForm.reference_note.trim() || null,
      currency: editForm.currency,
      issue_date: editForm.issue_date,
      payment_fee_amount:
        editForm.payment_fee_amount !== ""
          ? toNumber(editForm.payment_fee_amount)
          : null,
      amount: totalEditAmount,
      payments: normalizedPayments,
    };

    try {
      const res = await authFetch(
        `/api/other-incomes/${editingItem.id_other_income}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        token,
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err?.error || "Error actualizando el ingreso");
      }
      const data = (await res.json()) as { item?: OtherIncomeItem | null };
      if (data?.item) {
        setItems((prev) =>
          prev.map((it) =>
            it.id_other_income === data.item?.id_other_income ? data.item : it,
          ),
        );
      }
      setEditingItem(null);
      fetchReport();
      toast.success("Ingreso actualizado.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Error actualizando el ingreso.",
      );
    }
  };

  const handleDelete = async (item: OtherIncomeItem) => {
    if (!token) return;
    if (item.verification_status === "VERIFIED") {
      toast.error("Desverificá el ingreso antes de eliminarlo.");
      return;
    }
    if (!window.confirm("¿Eliminar este ingreso?")) return;

    try {
      const res = await authFetch(
        `/api/other-incomes/${item.id_other_income}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err?.error || "Error eliminando el ingreso");
      }
      setItems((prev) =>
        prev.filter((it) => it.id_other_income !== item.id_other_income),
      );
      fetchReport();
      toast.success("Ingreso eliminado.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Error eliminando el ingreso.",
      );
    }
  };

  const downloadCSV = async () => {
    if (!token) return;
    try {
      const headers = [
        "Fecha",
        "N°",
        "Concepto",
        "Categoría",
        "Operador",
        "Quién paga",
        "Nota interna",
        "Moneda",
        "Monto",
        "Costo financiero",
        "Estado",
        "Cobros",
      ].join(";");

      let next: number | null = null;
      const rows: string[] = [];

      for (let i = 0; i < 300; i++) {
        const qs = buildQS(next);
        const res = await authFetch(
          `/api/other-incomes?${qs.toString()}`,
          { cache: "no-store" },
          token,
        );
        const json = (await res.json()) as ApiResponse & { error?: string };
        if (!res.ok) throw new Error(json?.error || "Error al exportar CSV");

        for (const row of json.items) {
          const counterparty = getIncomeCounterparty(row);
          const payments = Array.isArray(row.payments) ? row.payments : [];
          const categoryLabel =
            textOrEmpty(row.category?.name) ||
            (row.category_id
              ? (categoryMap.get(row.category_id) ?? `ID ${row.category_id}`)
              : "");
          const operatorLabel = getIncomeOperatorLabel(row, operatorMap);
          const paymentsLabel = payments
            .map((p) => {
              const method =
                methodMap.get(p.payment_method_id ?? 0) || "Sin método";
              const account = p.account_id
                ? accountMap.get(p.account_id) || ""
                : "";
              const accountLabel = account ? ` (${account})` : "";
              return `${method}${accountLabel} ${fmtMoney(p.amount, row.currency)}`;
            })
            .join(" | ");

          const cells = [
            fmtDate(row.issue_date),
            String(row.agency_other_income_id ?? row.id_other_income),
            row.description,
            categoryLabel,
            operatorLabel,
            counterparty,
            textOrEmpty(row.reference_note),
            row.currency,
            fmtMoney(row.amount, row.currency),
            row.payment_fee_amount != null
              ? fmtMoney(row.payment_fee_amount, row.currency)
              : "",
            row.verification_status || "PENDING",
            paymentsLabel,
          ];
          rows.push(
            cells
              .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
              .join(";"),
          );
        }

        next = json.nextCursor ?? null;
        if (next === null) break;
      }

      const csv = [headers, ...rows].join("\r\n");
      const blob = new Blob(["\uFEFF", csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ingresos_${todayDateKeyInBuenosAires()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al descargar CSV";
      toast.error(msg);
    }
  };

  const activeFilters = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    const trimmedQ = appliedFilters.q.trim();
    if (trimmedQ) chips.push({ key: "q", label: `Búsqueda: \"${trimmedQ}\"` });
    if (appliedFilters.status !== "ALL") {
      chips.push({
        key: "status",
        label: `Estado: ${
          appliedFilters.status === "VERIFIED" ? "Verificado" : "Pendiente"
        }`,
      });
    }
    if (appliedFilters.currency) {
      chips.push({
        key: "currency",
        label: `Moneda: ${appliedFilters.currency}`,
      });
    }
    if (appliedFilters.dateFrom || appliedFilters.dateTo) {
      chips.push({
        key: "date",
        label: `Fecha: ${appliedFilters.dateFrom || "..."} → ${appliedFilters.dateTo || "..."}`,
      });
    }
    if (appliedFilters.paymentMethodId !== "ALL") {
      const label =
        methodMap.get(Number(appliedFilters.paymentMethodId)) ||
        `ID ${appliedFilters.paymentMethodId}`;
      chips.push({ key: "method", label: `Medio: ${label}` });
    }
    if (appliedFilters.accountId !== "ALL") {
      const label =
        accountMap.get(Number(appliedFilters.accountId)) ||
        `ID ${appliedFilters.accountId}`;
      chips.push({ key: "account", label: `Cuenta de ingreso: ${label}` });
    }
    if (appliedFilters.categoryId !== "ALL") {
      const label =
        categoryMap.get(Number(appliedFilters.categoryId)) ||
        `ID ${appliedFilters.categoryId}`;
      chips.push({ key: "category", label: `Categoría: ${label}` });
    }
    return chips;
  }, [appliedFilters, methodMap, accountMap, categoryMap]);

  const groupedByMonth = useMemo<GroupedMonth[]>(() => {
    if (items.length === 0) return [];
    const map = new Map<string, GroupedMonth>();
    for (const item of items) {
      const issueDateKey = toYmd(item.issue_date);
      if (!issueDateKey) continue;
      const key = issueDateKey.slice(0, 7);
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: formatMonthLabel(key),
          items: [],
          totals: {},
        });
      }
      const group = map.get(key);
      if (!group) continue;
      group.items.push(item);
      const cur = item.currency || "ARS";
      group.totals[cur] = (group.totals[cur] || 0) + Number(item.amount || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [items]);

  const pillClass = (active: boolean) =>
    [
      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
      active
        ? "border-sky-300/70 bg-sky-500/20 text-sky-900 dark:border-sky-300/40 dark:text-sky-100"
        : "border-white/20 bg-white/20 text-zinc-600 hover:bg-white/30 dark:text-zinc-200",
    ].join(" ");

  const pillSm = (active: boolean) =>
    [
      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
      active
        ? "border-sky-300/70 bg-sky-500/20 text-sky-900 dark:border-sky-300/40 dark:text-sky-100"
        : "border-white/20 bg-white/20 text-zinc-600 hover:bg-white/30 dark:text-zinc-200",
    ].join(" ");

  return (
    <ProtectedRoute>
      <main className="min-h-screen text-zinc-900 dark:text-zinc-50">
        <ToastContainer position="top-right" autoClose={4000} />

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Ingresos</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-300">
                Ingresos adicionales (fuera de reservas) con trazabilidad de
                cobro y verificación.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFiltersOpen((prev) => !prev)}
                className="rounded-full border border-white/30 bg-white/20 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-white/30 dark:text-zinc-100"
              >
                {filtersOpen
                  ? "Ocultar filtros"
                  : `Filtros (${activeFilters.length})`}
              </button>
              <button
                type="button"
                onClick={downloadCSV}
                className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/30 dark:text-emerald-100"
              >
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={refreshList}
                className="rounded-full border border-white/30 bg-white/20 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-white/30 dark:text-zinc-100"
              >
                Actualizar
              </button>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-2xl border border-white/20 bg-white/40 px-3 py-2 shadow-inner dark:bg-zinc-900/40">
              <input
                className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
                value={filters.q}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, q: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="Buscar por concepto, número, categoría, operador o pagador"
              />
            </div>
            <button
              type="button"
              onClick={applyFilters}
              className="rounded-full border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-500/30 dark:text-sky-100"
            >
              Buscar
            </button>
          </div>

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {activeFilters.map((chip) => (
                <span key={chip.key} className={CHIP}>
                  {chip.label}
                </span>
              ))}
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-full border border-white/30 bg-white/20 px-3 py-1 text-xs text-zinc-600 hover:bg-white/30 dark:text-zinc-200"
              >
                Limpiar filtros
              </button>
            </div>
          )}

          {filtersOpen && (
            <section className={PANEL}>
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-2xl border border-white/20 bg-white/40 px-3 py-2 shadow-inner dark:bg-zinc-900/40">
                    <input
                      className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
                      value={filters.q}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, q: e.target.value }))
                      }
                      placeholder="Buscá por concepto, número, cliente o empresa"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={applyFilters}
                    className="rounded-full border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-500/30 dark:text-sky-100"
                  >
                    Buscar
                  </button>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-full border border-white/30 bg-white/20 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-white/30 dark:text-zinc-100"
                  >
                    Limpiar
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className={SUBPANEL}>
                    <p className="text-xs font-semibold text-zinc-500">
                      Estado
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {["ALL", "PENDING", "VERIFIED"].map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() =>
                            setFilters((prev) => ({ ...prev, status }))
                          }
                          className={pillClass(filters.status === status)}
                        >
                          {status === "ALL"
                            ? "Todos"
                            : status === "VERIFIED"
                              ? "Verificados"
                              : "Pendientes"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={SUBPANEL}>
                    <p className="text-xs font-semibold text-zinc-500">
                      Moneda
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setFilters((prev) => ({ ...prev, currency: "" }))
                        }
                        className={pillClass(filters.currency === "")}
                      >
                        Todas
                      </button>
                      {currencyOptions.map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() =>
                            setFilters((prev) => ({ ...prev, currency: code }))
                          }
                          className={pillClass(filters.currency === code)}
                        >
                          {code}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={SUBPANEL}>
                    <p className="text-xs font-semibold text-zinc-500">
                      Medio de cobro
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            paymentMethodId: "ALL",
                          }))
                        }
                        className={pillClass(filters.paymentMethodId === "ALL")}
                      >
                        Todos
                      </button>
                      {(finance?.paymentMethods || [])
                        .filter((m) => m.enabled)
                        .map((m) => (
                          <button
                            key={m.id_method}
                            type="button"
                            onClick={() =>
                              setFilters((prev) => ({
                                ...prev,
                                paymentMethodId: String(m.id_method),
                              }))
                            }
                            className={pillClass(
                              filters.paymentMethodId === String(m.id_method),
                            )}
                          >
                            {m.name}
                          </button>
                        ))}
                    </div>
                  </div>

                  <div className={SUBPANEL}>
                    <p className="text-xs font-semibold text-zinc-500">
                      Cuenta de ingreso
                    </p>
                    <div className="mt-2 space-y-1">
                      <select
                        className="w-full rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                        value={filters.accountId}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            accountId: e.target.value,
                          }))
                        }
                      >
                        <option value="ALL">Todas</option>
                        {(finance?.accounts || [])
                        .filter((a) => a.enabled)
                        .map((a) => (
                          <option
                            key={a.id_account}
                            value={String(a.id_account)}
                          >
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-zinc-500">
                        Elegí una cuenta puntual o dejá todas.
                      </p>
                    </div>
                  </div>

                  <div className={SUBPANEL}>
                    <p className="text-xs font-semibold text-zinc-500">
                      Categoría
                    </p>
                    <div className="mt-2 space-y-1">
                      <select
                        className="w-full rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                        value={filters.categoryId}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            categoryId: e.target.value,
                          }))
                        }
                      >
                        <option value="ALL">Todas</option>
                        {categoryOptions.map((c) => (
                          <option
                            key={c.id_category}
                            value={String(c.id_category)}
                          >
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-zinc-500">
                        Filtrá por categoría de ingresos.
                      </p>
                    </div>
                  </div>

                  <div className={SUBPANEL}>
                    <p className="text-xs font-semibold text-zinc-500">
                      Rango de fechas
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs">
                        Desde
                        <input
                          type="date"
                          className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                          value={filters.dateFrom}
                          onChange={(e) =>
                            setFilters((prev) => ({
                              ...prev,
                              dateFrom: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Hasta
                        <input
                          type="date"
                          className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                          value={filters.dateTo}
                          onChange={(e) =>
                            setFilters((prev) => ({
                              ...prev,
                              dateTo: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className={PANEL}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Resumen</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-300">
                  Reporte compacto de ingresos y medios de cobro.
                </p>
              </div>
              {reportLoading && (
                <span className="text-xs text-zinc-500 dark:text-zinc-300">
                  Calculando...
                </span>
              )}
            </div>

            {!report && !reportLoading ? (
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-300">
                Sin datos para mostrar.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={`${CHIP} font-semibold`}>
                    Ingresos: {report?.totalCount ?? 0}
                  </span>
                  {(report?.totalsByCurrency || []).map((row) => (
                    <span key={`cur-${row.currency}`} className={CHIP}>
                      {row.currency}: {fmtMoney(row.amount, row.currency)} · Costo{" "}
                      {fmtMoney(row.fees, row.currency)}
                    </span>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className={SUBPANEL}>
                    <p className="text-xs font-semibold text-zinc-500">
                      Por medio de cobro
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {(report?.totalsByPaymentMethod || []).map((row) => (
                        <span
                          key={`pm-${row.payment_method_id ?? "none"}`}
                          className={CHIP}
                        >
                          {row.payment_method_id
                            ? methodMap.get(row.payment_method_id) ||
                              `ID ${row.payment_method_id}`
                            : "Sin método"}
                          : {formatReportAmount(row.amount)}
                        </span>
                      ))}
                      {!reportCurrency &&
                        (report?.totalsByPaymentMethod?.length ?? 0) > 0 && (
                          <span className="text-[11px] text-zinc-500">
                            Multimoneda: filtrá por moneda para ver valores
                            consistentes.
                          </span>
                        )}
                    </div>
                  </div>

                  <div className={SUBPANEL}>
                    <p className="text-xs font-semibold text-zinc-500">
                      Por cuenta de ingreso
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {(report?.totalsByAccount || []).map((row) => (
                        <span
                          key={`acc-${row.account_id ?? "none"}`}
                          className={CHIP}
                        >
                          {row.account_id
                            ? accountMap.get(row.account_id) ||
                              `ID ${row.account_id}`
                            : "Sin cuenta"}
                          : {formatReportAmount(row.amount)}
                        </span>
                      ))}
                      {!reportCurrency &&
                        (report?.totalsByAccount?.length ?? 0) > 0 && (
                          <span className="text-[11px] text-zinc-500">
                            Multimoneda: filtrá por moneda para ver valores
                            consistentes.
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <motion.div
            layout
            initial={{ maxHeight: 96, opacity: 1 }}
            animate={{
              maxHeight: formOpen ? 1600 : 96,
              opacity: 1,
              transition: { duration: 0.35, ease: "easeInOut" },
            }}
            className="mb-6 overflow-auto rounded-3xl border border-white/10 bg-white/10 text-zinc-900 shadow-md shadow-sky-950/10 backdrop-blur dark:text-zinc-50"
          >
            <div
              className={`sticky top-0 z-10 ${
                formOpen ? "rounded-t-3xl border-b" : ""
              } border-white/10 px-4 py-3 backdrop-blur-sm`}
            >
              <button
                type="button"
                onClick={() => setFormOpen((prev) => !prev)}
                className="flex w-full items-center justify-between text-left"
                aria-expanded={formOpen}
              >
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-full bg-sky-100 text-sky-950 shadow-sm shadow-sky-950/20 dark:bg-white/10 dark:text-white">
                    {formOpen ? (
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
                    <p className="text-lg font-semibold">Nuevo ingreso</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-300">
                      Cargá un ingreso extra y dejá claro quién paga.
                    </p>
                  </div>
                </div>
                <div className="hidden items-center gap-2 md:flex">
                  <span className={CHIP}>Moneda: {form.currency}</span>
                  <span className={CHIP}>
                    Total: {fmtMoney(totalAmount, form.currency)}
                  </span>
                </div>
              </button>
            </div>

            <AnimatePresence initial={false}>
              {formOpen && (
                <motion.div
                  key="body"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <form
                    className="space-y-5 px-4 pb-6 pt-4 md:px-6"
                    onSubmit={handleSubmit}
                  >
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="flex flex-col gap-1 text-sm">
                        Concepto del ingreso
                        <input
                          className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                          value={form.description}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              description: e.target.value,
                            }))
                          }
                          placeholder="Ej: reintegro bancario, ajuste, diferencia, etc."
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Fecha
                        <input
                          type="date"
                          className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                          value={form.issue_date}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              issue_date: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        Categoría
                        <select
                          className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                          value={form.category_id}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              category_id: e.target.value,
                            }))
                          }
                        >
                          <option value="">Sin categoría</option>
                          {categoryOptions.map((c) => (
                            <option
                              key={c.id_category}
                              value={String(c.id_category)}
                            >
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {formCategoryRequiresOperator && (
                        <label className="flex flex-col gap-1 text-sm">
                          Operador
                          <select
                            className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                            value={form.operator_id}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                operator_id: e.target.value,
                              }))
                            }
                          >
                            <option value="">
                              {operators.length
                                ? "Seleccionar operador..."
                                : "Sin operadores"}
                            </option>
                            {operators.map((op) => (
                              <option
                                key={op.id_operator}
                                value={String(op.id_operator)}
                              >
                                {op.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>

                    <div className="flex flex-col gap-3">
                      <label className="flex flex-col gap-1 text-sm">
                        Quién paga (Nombre de empresa o cliente)
                        <input
                          className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                          value={form.counterparty_name}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              counterparty_name: e.target.value,
                            }))
                          }
                          placeholder="Nombre de empresa o cliente"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm md:col-span-2">
                        Nota interna
                        <textarea
                          className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                          value={form.reference_note}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              reference_note: e.target.value,
                            }))
                          }
                          placeholder="Observación breve"
                          rows={3}
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-1 text-sm">
                        Moneda
                        <div className="mt-1 flex flex-wrap gap-2">
                          {currencyOptions.map((code) => (
                            <button
                              key={code}
                              type="button"
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  currency: code,
                                  payment_fee_amount: prev.payment_fee_amount
                                    ? formatMoneyInput(prev.payment_fee_amount, code)
                                    : "",
                                  payments: prev.payments.map((line) => ({
                                    ...line,
                                    amount: line.amount
                                      ? formatMoneyInput(line.amount, code)
                                      : "",
                                  })),
                                }))
                              }
                              className={pillClass(form.currency === code)}
                            >
                              {code}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="flex flex-col gap-1 text-sm">
                        Costo financiero
                        <input
                          className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                          value={form.payment_fee_amount}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              payment_fee_amount: formatMoneyInput(
                                e.target.value,
                                prev.currency,
                                {
                                  preferDotDecimal:
                                    shouldPreferDotDecimal(e),
                                },
                              ),
                            }))
                          }
                          placeholder={fmtMoney(0, form.currency)}
                        />
                      </label>
                    </div>

                    <div className="grid gap-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">
                          Cómo ingresó el dinero
                        </h3>
                        <button
                          type="button"
                          onClick={addLine}
                          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-100"
                        >
                          Agregar cobro
                        </button>
                      </div>

                      <div className="grid gap-3">
                        {form.payments.map((line, index) => (
                          <div
                            key={`line-${index}`}
                            className="grid gap-3 rounded-xl border border-white/20 bg-white/40 p-3 shadow-inner dark:bg-zinc-900/40 md:grid-cols-4"
                          >
                            <label className="flex flex-col gap-1 text-xs">
                              Monto cobrado
                              <input
                                className="rounded-lg border border-white/30 bg-white/70 px-2 py-1 text-sm outline-none dark:bg-zinc-900/60"
                                value={line.amount}
                                onChange={(e) =>
                                  updateLine(index, {
                                    amount: formatMoneyInput(
                                      e.target.value,
                                      form.currency,
                                      {
                                        preferDotDecimal:
                                          shouldPreferDotDecimal(e),
                                      },
                                    ),
                                  })
                                }
                                placeholder={fmtMoney(0, form.currency)}
                              />
                            </label>
                            <div className="flex flex-col gap-1 text-xs">
                              Medio de cobro
                              <div className="flex flex-wrap gap-2">
                                {(finance?.paymentMethods || [])
                                  .filter((m) => m.enabled)
                                  .map((m) => {
                                    const value = String(m.id_method);
                                    const active =
                                      line.payment_method_id === value;
                                    return (
                                      <button
                                        key={m.id_method}
                                        type="button"
                                        onClick={() =>
                                          updateLine(index, {
                                            payment_method_id: active
                                              ? ""
                                              : value,
                                          })
                                        }
                                        className={pillSm(active)}
                                      >
                                        {m.name}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                            <label className="flex flex-col gap-1 text-xs">
                              Cuenta de ingreso
                              <select
                                className="rounded-lg border border-white/30 bg-white/70 px-2 py-1 text-sm outline-none dark:bg-zinc-900/60"
                                value={line.account_id}
                                onChange={(e) =>
                                  updateLine(index, {
                                    account_id: e.target.value,
                                  })
                                }
                              >
                                <option value="">Sin cuenta</option>
                                {(finance?.accounts || [])
                                  .filter((a) => a.enabled)
                                  .map((a) => (
                                    <option
                                      key={a.id_account}
                                      value={String(a.id_account)}
                                    >
                                      {a.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <div className="flex items-end justify-end">
                              <button
                                type="button"
                                onClick={() => removeLine(index)}
                                className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-100"
                              >
                                Quitar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-zinc-500 dark:text-zinc-300">
                          Total registrado
                        </span>
                        <span className="font-semibold">
                          {fmtMoney(totalAmount, form.currency)}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="rounded-full border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-500/30 dark:text-sky-100"
                      >
                        Guardar ingreso
                      </button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <section className={PANEL}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/40 p-1 shadow-sm dark:bg-white/10">
                {[
                  { key: "cards", label: "Tarjetas" },
                  { key: "table", label: "Tabla" },
                  { key: "monthly", label: "Mensual" },
                ].map((opt) => {
                  const active = viewMode === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setViewMode(opt.key as ViewMode)}
                      className={
                        active
                          ? "rounded-xl bg-sky-500/15 px-4 py-2 text-xs font-semibold text-sky-800 dark:text-sky-100"
                          : "rounded-xl px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-white/40 dark:text-zinc-200"
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-300">
                {items.length} ingresos cargados
              </div>
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <p className="py-6 text-sm text-zinc-500 dark:text-zinc-300">
                Todavía no hay ingresos cargados.
              </p>
            ) : viewMode === "table" ? (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-white/20 bg-white/40 shadow-inner dark:bg-zinc-900/40">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">N°</th>
                      <th className="px-3 py-2">Concepto</th>
                      <th className="px-3 py-2">Monto</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Cobros</th>
                      <th className="px-3 py-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        key={item.id_other_income}
                        className="border-t border-white/10"
                      >
                        <td className="px-3 py-2 text-xs text-zinc-600">
                          {fmtDate(item.issue_date)}
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-600">
                          {item.agency_other_income_id ?? item.id_other_income}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold">
                            {item.description}
                          </div>
                          {(textOrEmpty(item.category?.name) || item.category_id) && (
                            <div className="text-xs text-zinc-500">
                              Categoría:{" "}
                              {textOrEmpty(item.category?.name) ||
                                (item.category_id
                                  ? (categoryMap.get(item.category_id) ??
                                    `ID ${item.category_id}`)
                                  : "Sin categoría")}
                            </div>
                          )}
                          {getIncomeOperatorLabel(item, operatorMap) && (
                            <div className="text-xs text-zinc-500">
                              Operador: {getIncomeOperatorLabel(item, operatorMap)}
                            </div>
                          )}
                          {getIncomeCounterparty(item) && (
                            <div className="text-xs text-zinc-500">
                              Quién paga: {getIncomeCounterparty(item)}
                            </div>
                          )}
                          {textOrEmpty(item.reference_note) && (
                            <div className="text-xs text-zinc-500">
                              Nota: {textOrEmpty(item.reference_note)}
                            </div>
                          )}
                          {item.payment_fee_amount != null && (
                            <div className="text-xs text-zinc-500">
                              Costo financiero:{" "}
                              {fmtMoney(item.payment_fee_amount, item.currency)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {fmtMoney(item.amount, item.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${
                              item.verification_status === "VERIFIED"
                                ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                                : "border-amber-300 bg-amber-100 text-amber-900"
                            }`}
                          >
                            {item.verification_status || "PENDING"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-600">
                          {(item.payments || []).map((p, idx) => (
                            <div key={`${item.id_other_income}-p-${idx}`}>
                              {(methodMap.get(p.payment_method_id ?? 0) ||
                                "Sin método") +
                                (p.account_id
                                  ? ` · ${accountMap.get(p.account_id) ?? ""}`
                                  : "") +
                                " · " +
                                fmtMoney(p.amount, item.currency)}
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(item)}
                              className="rounded-full border border-sky-500/40 bg-sky-500/20 px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-500/30 disabled:opacity-50"
                              disabled={item.verification_status === "VERIFIED"}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item)}
                              className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-500/20 disabled:opacity-50"
                              disabled={item.verification_status === "VERIFIED"}
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : viewMode === "monthly" ? (
              <div className="mt-4 space-y-4">
                {groupedByMonth.map((group) => (
                  <div
                    key={group.key}
                    className="rounded-2xl border border-white/20 bg-white/40 p-4 shadow-inner dark:bg-zinc-900/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{group.label}</h3>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {Object.entries(group.totals).map(([cur, total]) => (
                          <span key={`${group.key}-${cur}`} className={CHIP}>
                            {cur}: {fmtMoney(total, cur)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 divide-y divide-white/10">
                      {group.items.map((item) => (
                        <div
                          key={`${group.key}-${item.id_other_income}`}
                          className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                        >
                          <div>
                            <div className="font-medium">
                              {item.description}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {fmtDate(item.issue_date)} · N°{" "}
                              {item.agency_other_income_id ??
                                item.id_other_income}
                            </div>
                            {(textOrEmpty(item.category?.name) ||
                              item.category_id) && (
                              <div className="text-xs text-zinc-500">
                                Categoría:{" "}
                                {textOrEmpty(item.category?.name) ||
                                  (item.category_id
                                    ? (categoryMap.get(item.category_id) ??
                                      `ID ${item.category_id}`)
                                    : "Sin categoría")}
                              </div>
                            )}
                            {getIncomeOperatorLabel(item, operatorMap) && (
                              <div className="text-xs text-zinc-500">
                                Operador: {getIncomeOperatorLabel(item, operatorMap)}
                              </div>
                            )}
                            {getIncomeCounterparty(item) && (
                              <div className="text-xs text-zinc-500">
                                Quién paga: {getIncomeCounterparty(item)}
                              </div>
                            )}
                            {textOrEmpty(item.reference_note) && (
                              <div className="text-xs text-zinc-500">
                                Nota: {textOrEmpty(item.reference_note)}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">
                              {fmtMoney(item.amount, item.currency)}
                            </span>
                            <button
                              type="button"
                              onClick={() => openEdit(item)}
                              className="rounded-full border border-sky-500/40 bg-sky-500/20 px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-500/30 disabled:opacity-50"
                              disabled={item.verification_status === "VERIFIED"}
                            >
                              Editar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {items.map((item) => (
                  <div
                    key={item.id_other_income}
                    className="rounded-2xl border border-white/20 bg-white/40 p-4 shadow-inner dark:bg-zinc-900/40"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {item.description}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-300">
                          {fmtDate(item.issue_date)} · N°{" "}
                          {item.agency_other_income_id ?? item.id_other_income}
                        </p>
                        {(textOrEmpty(item.category?.name) || item.category_id) && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-300">
                            Categoría:{" "}
                            {textOrEmpty(item.category?.name) ||
                              (item.category_id
                                ? (categoryMap.get(item.category_id) ??
                                  `ID ${item.category_id}`)
                                : "Sin categoría")}
                          </p>
                        )}
                        {getIncomeOperatorLabel(item, operatorMap) && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-300">
                            Operador: {getIncomeOperatorLabel(item, operatorMap)}
                          </p>
                        )}
                        {getIncomeCounterparty(item) && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-300">
                            Quién paga: {getIncomeCounterparty(item)}
                          </p>
                        )}
                        {textOrEmpty(item.reference_note) && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-300">
                            Nota: {textOrEmpty(item.reference_note)}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {fmtMoney(item.amount, item.currency)}
                        </p>
                        <span
                          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] ${
                            item.verification_status === "VERIFIED"
                              ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                              : "border-amber-300 bg-amber-100 text-amber-900"
                          }`}
                        >
                          {item.verification_status || "PENDING"}
                        </span>
                      </div>
                    </div>

                    {item.payment_fee_amount != null && (
                      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-300">
                        Costo financiero:{" "}
                        {fmtMoney(item.payment_fee_amount, item.currency)}
                      </p>
                    )}

                    {Array.isArray(item.payments) &&
                      item.payments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-600 dark:text-zinc-200">
                          {item.payments.map((p, idx) => (
                            <span
                              key={`${item.id_other_income}-p-${idx}`}
                              className="rounded-full bg-zinc-900/5 px-2 py-0.5 dark:bg-white/10"
                            >
                              {(methodMap.get(p.payment_method_id ?? 0) ||
                                "Sin método") +
                                (p.account_id
                                  ? ` • ${accountMap.get(p.account_id) ?? ""}`
                                  : "") +
                                " • " +
                                fmtMoney(p.amount, item.currency)}
                            </span>
                          ))}
                        </div>
                      )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="rounded-full border border-sky-500/40 bg-sky-500/20 px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-500/30 disabled:opacity-50"
                        disabled={item.verification_status === "VERIFIED"}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-500/20 disabled:opacity-50"
                        disabled={item.verification_status === "VERIFIED"}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {cursor && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => fetchItems(false)}
                  className="rounded-full border border-white/30 bg-white/20 px-4 py-2 text-xs font-medium text-zinc-700 transition hover:bg-white/30 dark:text-zinc-100"
                  disabled={loadingMore}
                >
                  {loadingMore ? "Cargando..." : "Cargar más"}
                </button>
              </div>
            )}
          </section>
        </div>

        {editingItem && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:py-8">
            <div className="w-full max-w-3xl rounded-2xl border border-white/20 bg-white/90 p-5 shadow-xl backdrop-blur dark:bg-zinc-900/90">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Editar ingreso</h2>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-full border border-white/30 px-3 py-1 text-xs text-zinc-600 hover:bg-white/30 dark:text-zinc-200"
                >
                  Cerrar
                </button>
              </div>

              <form className="mt-4 grid gap-4" onSubmit={handleEditSubmit}>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="flex flex-col gap-1 text-sm">
                    Concepto del ingreso
                    <input
                      className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Fecha
                    <input
                      type="date"
                      className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                      value={editForm.issue_date}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          issue_date: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Categoría
                    <select
                      className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                      value={editForm.category_id}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          category_id: e.target.value,
                        }))
                      }
                    >
                      <option value="">Sin categoría</option>
                      {categoryOptions.map((c) => (
                        <option
                          key={c.id_category}
                          value={String(c.id_category)}
                        >
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editCategoryRequiresOperator && (
                    <label className="flex flex-col gap-1 text-sm">
                      Operador
                      <select
                        className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                        value={editForm.operator_id}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            operator_id: e.target.value,
                          }))
                        }
                      >
                        <option value="">
                          {operators.length
                            ? "Seleccionar operador..."
                            : "Sin operadores"}
                        </option>
                        {operators.map((op) => (
                          <option
                            key={op.id_operator}
                            value={String(op.id_operator)}
                          >
                            {op.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    Quién paga (Nombre de empresa o cliente)
                    <input
                      className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                      value={editForm.counterparty_name}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          counterparty_name: e.target.value,
                        }))
                      }
                      placeholder="Nombre de empresa o cliente"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm md:col-span-2">
                    Nota interna
                    <textarea
                      className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                      value={editForm.reference_note}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          reference_note: e.target.value,
                        }))
                      }
                      placeholder="Observación breve"
                      rows={3}
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1 text-sm">
                    Moneda
                    <div className="mt-1 flex flex-wrap gap-2">
                      {currencyOptions.map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() =>
                            setEditForm((prev) => ({
                              ...prev,
                              currency: code,
                              payment_fee_amount: prev.payment_fee_amount
                                ? formatMoneyInput(prev.payment_fee_amount, code)
                                : "",
                              payments: prev.payments.map((line) => ({
                                ...line,
                                amount: line.amount
                                  ? formatMoneyInput(line.amount, code)
                                  : "",
                              })),
                            }))
                          }
                          className={pillClass(editForm.currency === code)}
                        >
                          {code}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    Costo financiero
                    <input
                      className="rounded-xl border border-white/30 bg-white/60 px-3 py-2 text-sm shadow-inner outline-none dark:bg-zinc-900/50"
                      value={editForm.payment_fee_amount}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          payment_fee_amount: formatMoneyInput(
                            e.target.value,
                            prev.currency,
                            {
                              preferDotDecimal: shouldPreferDotDecimal(e),
                            },
                          ),
                        }))
                      }
                      placeholder={fmtMoney(0, editForm.currency)}
                    />
                  </label>
                </div>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      Cómo ingresó el dinero
                    </h3>
                    <button
                      type="button"
                      onClick={addEditLine}
                      className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-100"
                    >
                      Agregar cobro
                    </button>
                  </div>

                  <div className="grid gap-3">
                    {editForm.payments.map((line, index) => (
                      <div
                        key={`edit-line-${index}`}
                        className="grid gap-3 rounded-xl border border-white/20 bg-white/40 p-3 shadow-inner dark:bg-zinc-900/40 md:grid-cols-4"
                      >
                        <label className="flex flex-col gap-1 text-xs">
                          Monto cobrado
                          <input
                            className="rounded-lg border border-white/30 bg-white/70 px-2 py-1 text-sm outline-none dark:bg-zinc-900/60"
                            value={line.amount}
                            onChange={(e) =>
                              updateEditLine(index, {
                                amount: formatMoneyInput(
                                  e.target.value,
                                  editForm.currency,
                                  {
                                    preferDotDecimal:
                                      shouldPreferDotDecimal(e),
                                  },
                                ),
                              })
                            }
                            placeholder={fmtMoney(0, editForm.currency)}
                          />
                        </label>
                        <div className="flex flex-col gap-1 text-xs">
                          Medio de cobro
                          <div className="flex flex-wrap gap-2">
                            {(finance?.paymentMethods || [])
                              .filter((m) => m.enabled)
                              .map((m) => {
                                const value = String(m.id_method);
                                const active = line.payment_method_id === value;
                                return (
                                  <button
                                    key={m.id_method}
                                    type="button"
                                    onClick={() =>
                                      updateEditLine(index, {
                                        payment_method_id: active ? "" : value,
                                      })
                                    }
                                    className={pillSm(active)}
                                  >
                                    {m.name}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                        <label className="flex flex-col gap-1 text-xs">
                          Cuenta de ingreso
                          <select
                            className="rounded-lg border border-white/30 bg-white/70 px-2 py-1 text-sm outline-none dark:bg-zinc-900/60"
                            value={line.account_id}
                            onChange={(e) =>
                              updateEditLine(index, {
                                account_id: e.target.value,
                              })
                            }
                          >
                            <option value="">Sin cuenta</option>
                            {(finance?.accounts || [])
                              .filter((a) => a.enabled)
                              .map((a) => (
                                <option
                                  key={a.id_account}
                                  value={String(a.id_account)}
                                >
                                  {a.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div className="flex items-end justify-end">
                          <button
                            type="button"
                            onClick={() => removeEditLine(index)}
                            className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-100"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-zinc-500 dark:text-zinc-300">
                      Total registrado
                    </span>
                    <span className="font-semibold">
                      {fmtMoney(totalEditAmount, editForm.currency)}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="rounded-full border border-white/30 bg-white/20 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-white/30 dark:text-zinc-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-full border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-500/30 dark:text-sky-100"
                  >
                    Guardar cambios
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </ProtectedRoute>
  );
}
