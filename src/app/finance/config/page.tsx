// src/app/finance/config/page.tsx
"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import CommissionsConfig from "@/components/finance/CommissionsConfig";
import ReceiptVerificationConfig from "@/components/finance/ReceiptVerificationConfig";
import FinanceSectionAccessConfig from "@/components/finance/FinanceSectionAccessConfig";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import {
  loadFinancePicks,
  type FinanceCurrency,
  type FinanceAccount,
  type FinancePaymentMethod,
  type FinanceExpenseCategory,
} from "@/utils/loadFinancePicks";
import {
  type ReceiptServiceSelectionMode,
  normalizeReceiptServiceSelectionMode,
} from "@/utils/receiptServiceSelection";

/* ================= Estilos compartidos ================= */
const GLASS =
  "rounded-3xl border border-white/30 bg-white/10 backdrop-blur shadow-lg shadow-sky-900/10 dark:bg-white/10 dark:border-white/5";
const BTN_BASE =
  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-sm backdrop-blur transition-transform hover:scale-[.98] active:scale-95 disabled:opacity-50";
const BTN_SKY = `${BTN_BASE} border-sky-300/60 bg-sky-100/5 text-sky-950 shadow-sky-900/10 dark:border-sky-400/30 dark:bg-sky-500/5 dark:text-sky-50`;
const BTN_EMERALD = `${BTN_BASE} border-emerald-300/60 bg-emerald-100/5 text-emerald-900 shadow-emerald-900/10 dark:border-emerald-400/30 dark:bg-emerald-500/5 dark:text-emerald-50`;
const BTN_AMBER = `${BTN_BASE} border-amber-300/60 bg-amber-100/5 text-amber-900 shadow-amber-900/10 dark:border-amber-400/30 dark:bg-amber-500/5 dark:text-amber-50`;
const BTN_DANGER = `${BTN_BASE} border-rose-300/60 bg-rose-500/5 text-rose-900 shadow-rose-900/10 dark:border-rose-400/40 dark:bg-rose-500/5 dark:text-rose-50`;
const ICON_BTN = BTN_SKY;
const BADGE_SKY =
  "inline-flex items-center gap-1 rounded-full border border-sky-300/50 bg-sky-100/5 px-2 py-[2px] text-[10px] font-medium text-sky-950 dark:border-sky-300/30 dark:bg-sky-500/5 dark:text-sky-50";
const BADGE_AMBER =
  "inline-flex items-center gap-1 rounded-full border border-amber-300/50 bg-amber-100/5 px-2 py-[2px] text-[10px] font-medium text-amber-900 dark:border-amber-300/30 dark:bg-amber-500/5 dark:text-amber-50";
const BADGE_EMERALD =
  "inline-flex items-center gap-1 rounded-full border border-emerald-300/50 bg-emerald-100/5 px-2 py-[2px] text-[10px] font-medium text-emerald-900 dark:border-emerald-300/30 dark:bg-emerald-500/5 dark:text-emerald-50";

/* ================= Tipos (alineados a las APIs) ================= */
type FinanceConfig = {
  id_agency: number;
  default_currency_code: string | null;
  hide_operator_expenses_in_investments?: boolean | null;
};

type FinanceBundle = {
  config: FinanceConfig | null;
  currencies: FinanceCurrency[];
  accounts: FinanceAccount[];
  paymentMethods: FinancePaymentMethod[];
  categories: FinanceExpenseCategory[];
};

type AccountOpeningBalance = {
  account_id: number;
  currency: string;
  amount: number | string;
  effective_date: string;
  note?: string | null;
};

const RECEIPT_SERVICE_SELECTION_OPTIONS: Array<{
  key: ReceiptServiceSelectionMode;
  label: string;
  desc: string;
}> = [
  {
    key: "required",
    label: "Obligatorio",
    desc: "Siempre exige elegir uno o más servicios para emitir o asociar recibos.",
  },
  {
    key: "optional",
    label: "Opcional",
    desc: "Permite elegir servicios; si no elegís, aplica el recibo a todos por defecto.",
  },
  {
    key: "booking",
    label: "Por reserva",
    desc: "Oculta selector de servicios y aplica siempre a todos los servicios de la reserva.",
  },
];

/* ===== Respuestas de error y type guards ===== */
type ApiError = { error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isApiError(v: unknown): v is ApiError {
  return isRecord(v) && typeof v.error === "string";
}
function apiErrorMessage(v: unknown): string | null {
  return isApiError(v) ? v.error : null;
}

/** Normaliza lo que venga de /api/finance/config a FinanceConfig | null (sin any) */
function normalizeFinanceConfig(v: unknown): FinanceConfig | null {
  if (!isRecord(v)) return null;
  const id_agency = typeof v.id_agency === "number" ? v.id_agency : 0; // fallback inocuo
  const default_currency_code =
    typeof v.default_currency_code === "string"
      ? v.default_currency_code
      : null;
  const hide_operator_expenses_in_investments =
    typeof v.hide_operator_expenses_in_investments === "boolean"
      ? v.hide_operator_expenses_in_investments
      : null;

  return {
    id_agency,
    default_currency_code,
    hide_operator_expenses_in_investments,
  };
}

/* ================== Helpers UI ================== */
function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs opacity-70">{children}</label>;
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`block w-full min-w-fit appearance-none rounded-2xl border border-sky-200 bg-white/50 px-4 py-2 shadow-sm shadow-sky-950/10 outline-none backdrop-blur placeholder:opacity-60 dark:border-sky-200/60 dark:bg-sky-100/10 ${props.className || ""}`}
    />
  );
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function Switch({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition hover:brightness-105 ${
        checked
          ? "border-emerald-300/60 bg-emerald-100/5 text-emerald-900 dark:border-emerald-300/30 dark:bg-emerald-500/5 dark:text-emerald-50"
          : "border-amber-300/60 bg-amber-100/5 text-amber-900 dark:border-amber-300/30 dark:bg-amber-500/5 dark:text-amber-50"
      }`}
      title={title}
      aria-label={label}
    >
      <span
        className={`inline-block h-4 w-7 rounded-full ${
          checked ? "bg-emerald-500/20" : "bg-amber-200/20 dark:bg-amber-400/10"
        }`}
      >
        <span
          className={`block size-4 rounded-full bg-white transition ${
            checked ? "translate-x-3" : ""
          }`}
        />
      </span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

type IconProps = React.SVGProps<SVGSVGElement>;

function IconPencilSquare(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
      />
    </svg>
  );
}

function IconTrash(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

/* =============== Modal simple =============== */
function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/10 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`${GLASS} absolute left-1/2 top-1/2 ${
          wide ? "w-[min(94vw,780px)]" : "w-[min(92vw,560px)]"
        } -translate-x-1/2 -translate-y-1/2 p-5`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className={ICON_BTN}
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[65vh] overflow-auto pr-1">{children}</div>
        {footer && <div className="mt-4 flex justify-end">{footer}</div>}
      </div>
    </div>
  );
}

/* =================== Página =================== */
const TAB_KEYS = [
  "general",
  "currencies",
  "accounts",
  "methods",
  "verification",
  "permissions",
  "categories",
  "commissions",
] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TABS: { key: TabKey; label: string }[] = [
  { key: "general", label: "General" },
  { key: "currencies", label: "Monedas" },
  { key: "accounts", label: "Cuentas" },
  { key: "methods", label: "Métodos" },
  { key: "verification", label: "Verificación" },
  { key: "permissions", label: "Permisos" },
  { key: "categories", label: "Categorías" },
  { key: "commissions", label: "Comisiones" },
];

const CATEGORY_SCOPE_FILTERS = [
  { key: "INVESTMENT", label: "Egresos" },
  { key: "OTHER_INCOME", label: "Ingresos" },
] as const;
type CategoryScopeFilter = (typeof CATEGORY_SCOPE_FILTERS)[number]["key"];

function FinanceConfigPageInner() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [agencyId, setAgencyId] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<FinanceBundle | null>(null);

  const [active, setActive] = useState<TabKey>("general");
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingReceiptServiceMode, setSavingReceiptServiceMode] =
    useState(false);
  const [receiptServiceSelectionMode, setReceiptServiceSelectionMode] =
    useState<ReceiptServiceSelectionMode>("required");
  const [serverReceiptServiceSelectionMode, setServerReceiptServiceSelectionMode] =
    useState<ReceiptServiceSelectionMode>("required");

  useEffect(() => {
    if (!searchParams) return;
    const tab = searchParams.get("tab");
    if (!tab) return;
    const normalized = tab.toLowerCase();
    if (!TAB_KEYS.includes(normalized as TabKey)) return;
    if (normalized !== active) {
      setActive(normalized as TabKey);
    }
  }, [searchParams, active]);

  // ====== Form estado general ======
  const [generalForm, setGeneralForm] = useState<{
    default_currency_code: string;
    hide_operator_expenses_in_investments: boolean;
  }>({
    default_currency_code: "",
    hide_operator_expenses_in_investments: false,
  });

  // Sincroniza formulario cuando cambian los datos
  useEffect(() => {
    if (!bundle?.config) return;
    setGeneralForm({
      default_currency_code: bundle.config.default_currency_code || "",
      hide_operator_expenses_in_investments:
        bundle.config.hide_operator_expenses_in_investments ?? false,
    });
  }, [bundle]);

  // ====== Cargar agencyId y datos ======
  useEffect(() => {
    if (!token) return;

    (async () => {
      try {
        // perfil => id_agency (sin cambios)
        // perfil => id_agency (sin any)
        try {
          const pr = await authFetch(
            "/api/user/profile",
            { cache: "no-store" },
            token,
          );
          if (pr.ok) {
            const profRaw: unknown = await pr.json();
            if (isRecord(profRaw) && typeof profRaw.id_agency === "number") {
              setAgencyId(profRaw.id_agency);
            } else {
              setAgencyId(null);
            }
          }
        } catch {
          setAgencyId(null);
        }

        setLoading(true);

        // ⚠️ AHORA: pedimos config + picks + calc config en paralelo
        const [cfgRes, picks, calcRes] = await Promise.all([
          authFetch("/api/finance/config", { cache: "no-store" }, token),
          loadFinancePicks(token),
          authFetch("/api/service-calc-config", { cache: "no-store" }, token),
        ]);

        let nextReceiptMode: ReceiptServiceSelectionMode = "required";
        if (calcRes.ok) {
          const calcRaw: unknown = await calcRes.json().catch(() => null);
          if (isRecord(calcRaw)) {
            nextReceiptMode = normalizeReceiptServiceSelectionMode(
              calcRaw.receipt_service_selection_mode,
            );
          }
        }
        setReceiptServiceSelectionMode(nextReceiptMode);
        setServerReceiptServiceSelectionMode(nextReceiptMode);

        if (!cfgRes.ok) {
          setBundle({
            config: null,
            currencies: picks.currencies,
            accounts: picks.accounts,
            paymentMethods: picks.paymentMethods,
            categories: picks.categories,
          });
          toast.error("Config financiera no disponible para tu agencia");
        } else {
          const configRaw: unknown = await cfgRes.json();
          const config = normalizeFinanceConfig(configRaw);
          setBundle({
            config,
            currencies: picks.currencies,
            accounts: picks.accounts,
            paymentMethods: picks.paymentMethods,
            categories: picks.categories,
          });
        }
      } catch {
        toast.error("Error cargando datos de finanzas");
        setReceiptServiceSelectionMode("required");
        setServerReceiptServiceSelectionMode("required");
        setBundle({
          config: null,
          currencies: [],
          accounts: [],
          paymentMethods: [],
          categories: [],
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [cfgRes, picks, calcRes] = await Promise.all([
        authFetch("/api/finance/config", { cache: "no-store" }, token),
        loadFinancePicks(token),
        authFetch("/api/service-calc-config", { cache: "no-store" }, token),
      ]);

      const config: FinanceConfig | null = cfgRes.ok
        ? normalizeFinanceConfig((await cfgRes.json()) as unknown)
        : null;

      if (calcRes.ok) {
        const calcRaw: unknown = await calcRes.json().catch(() => null);
        const nextMode = isRecord(calcRaw)
          ? normalizeReceiptServiceSelectionMode(
              calcRaw.receipt_service_selection_mode,
            )
          : "required";
        setReceiptServiceSelectionMode(nextMode);
        setServerReceiptServiceSelectionMode(nextMode);
      }

      setBundle({
        config,
        currencies: picks.currencies,
        accounts: picks.accounts,
        paymentMethods: picks.paymentMethods,
        categories: picks.categories,
      });
    } catch {
      // mantené lo que hay si falla
    }
  }, [token]);

  /* =================== GENERAL =================== */
  const saveGeneral = async () => {
    if (!token) return;
    if (!generalForm.default_currency_code) {
      toast.error("Elegí una moneda por defecto");
      return;
    }
    setSavingGeneral(true);
    try {
      const res = await authFetch(
        "/api/finance/config",
        {
          method: "PUT",
          body: JSON.stringify({
            default_currency_code: generalForm.default_currency_code,
            hide_operator_expenses_in_investments:
              generalForm.hide_operator_expenses_in_investments,
          }),
        },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(
          apiErrorMessage(j) ?? "No se pudo guardar la configuración",
        );
      }
      toast.success("Configuración guardada");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSavingGeneral(false);
    }
  };

  const saveReceiptServiceMode = async () => {
    if (!token) return;
    setSavingReceiptServiceMode(true);
    try {
      const res = await authFetch(
        "/api/service-calc-config",
        {
          method: "POST",
          body: JSON.stringify({
            receipt_service_selection_mode: receiptServiceSelectionMode,
          }),
        },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(
          apiErrorMessage(j) ?? "No se pudo guardar la configuración de recibos",
        );
      }
      const json: unknown = await res.json().catch(() => null);
      const nextMode = isRecord(json)
        ? normalizeReceiptServiceSelectionMode(
            json.receipt_service_selection_mode,
          )
        : receiptServiceSelectionMode;
      setReceiptServiceSelectionMode(nextMode);
      setServerReceiptServiceSelectionMode(nextMode);
      toast.success("Configuración de recibos guardada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSavingReceiptServiceMode(false);
    }
  };

  /* =================== MONEDAS =================== */
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false);
  const [currencyEditing, setCurrencyEditing] =
    useState<FinanceCurrency | null>(null);
  const [currencyForm, setCurrencyForm] = useState<{
    code: string;
    name: string;
    symbol: string;
    enabled: boolean;
  }>({ code: "", name: "", symbol: "", enabled: true });

  const openNewCurrency = () => {
    setCurrencyEditing(null);
    setCurrencyForm({ code: "", name: "", symbol: "", enabled: true });
    setCurrencyModalOpen(true);
  };
  const openEditCurrency = (c: FinanceCurrency) => {
    setCurrencyEditing(c);
    setCurrencyForm({
      code: c.code,
      name: c.name,
      symbol: c.symbol ?? "",
      enabled: c.enabled,
    });
    setCurrencyModalOpen(true);
  };

  const saveCurrency = async () => {
    if (!token) return;
    if (!agencyId) {
      toast.error("La agencia no está cargada todavía");
      return;
    }
    const payload = {
      id_agency: agencyId,
      code: currencyForm.code.trim().toUpperCase(),
      name: currencyForm.name.trim(),
      symbol: currencyForm.symbol.trim(),
      enabled: !!currencyForm.enabled,
    };
    if (!payload.code || !payload.name || !payload.symbol) {
      toast.error("Completá código, nombre y símbolo");
      return;
    }
    try {
      const url =
        "/api/finance/currencies" +
        (currencyEditing ? `/${currencyEditing.id_currency}` : "");
      const method = currencyEditing ? "PATCH" : "POST";
      const res = await authFetch(
        url,
        { method, body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo guardar la moneda");
      }
      toast.success(currencyEditing ? "Moneda actualizada" : "Moneda creada");
      setCurrencyModalOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const toggleCurrencyEnabled = async (c: FinanceCurrency) => {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/finance/currencies/${c.id_currency}`,
        { method: "PATCH", body: JSON.stringify({ enabled: !c.enabled }) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(
          apiErrorMessage(j) ?? "No se pudo actualizar la moneda",
        );
      }
      await reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al actualizar estado",
      );
    }
  };

  const setCurrencyPrimary = async (c: FinanceCurrency) => {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/finance/currencies/${c.id_currency}`,
        { method: "PATCH", body: JSON.stringify({ is_primary: true }) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(
          apiErrorMessage(j) ?? "No se pudo marcar como principal",
        );
      }
      toast.success(`${c.code} es ahora la moneda principal`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al actualizar");
    }
  };

  const deleteCurrency = async (c: FinanceCurrency) => {
    if (!token) return;
    if (!confirm(`¿Eliminar la moneda ${c.code}?`)) return;
    try {
      const res = await authFetch(
        `/api/finance/currencies/${c.id_currency}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo eliminar");
      }
      toast.success("Moneda eliminada");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  const moveCurrency = async (idx: number, direction: -1 | 1) => {
    if (!agencyId) {
      toast.error("No se puede reordenar: agencia aún no cargada");
      return;
    }

    const list = currencies || [];
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= list.length) return;

    // Reorden local optimista
    const reordered = [...list];
    const [item] = reordered.splice(idx, 1);
    reordered.splice(newIdx, 0, item);

    setBundle((prev) =>
      prev
        ? {
            ...prev,
            currencies: reordered.map((c, i) => ({ ...c, sort_order: i + 1 })),
          }
        : prev,
    );

    // Commit
    try {
      const body = {
        id_agency: agencyId,
        items: reordered.map((c, i) => ({
          id: c.id_currency,
          sort_order: i + 1,
        })),
      };
      const res = await authFetch(
        "/api/finance/currencies/reorder",
        { method: "POST", body: JSON.stringify(body) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo reordenar");
      }
      toast.success("Orden actualizado");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al reordenar");
      await reload();
    }
  };

  /* =================== CUENTAS =================== */
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountEditing, setAccountEditing] = useState<FinanceAccount | null>(
    null,
  );
  const [accountForm, setAccountForm] = useState<{
    name: string;
    alias: string;
    currency: string; // vacío => sin moneda
    enabled: boolean;
  }>({
    name: "",
    alias: "",
    currency: "",
    enabled: true,
  });

  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [balanceAccount, setBalanceAccount] = useState<FinanceAccount | null>(
    null,
  );
  const [balanceDate, setBalanceDate] = useState("");
  const [balanceRows, setBalanceRows] = useState<Record<string, string>>({});
  const [balanceExisting, setBalanceExisting] = useState<
    Record<string, AccountOpeningBalance>
  >({});
  const [balanceSaving, setBalanceSaving] = useState(false);

  const openNewAccount = () => {
    setAccountEditing(null);
    setAccountForm({
      name: "",
      alias: "",
      currency: bundle?.config?.default_currency_code || "",
      enabled: true,
    });
    setAccountModalOpen(true);
  };
  const openEditAccount = (a: FinanceAccount) => {
    setAccountEditing(a);
    setAccountForm({
      name: a.name,
      alias: a.alias || "",
      currency: a.currency || bundle?.config?.default_currency_code || "",
      enabled: a.enabled,
    });
    setAccountModalOpen(true);
  };

  const openBalanceModal = async (a: FinanceAccount) => {
    if (!token) return;
    setBalanceAccount(a);
    setBalanceModalOpen(true);
    setBalanceSaving(true);
    try {
      const res = await authFetch(
        `/api/finance/account-balances?account_id=${a.id_account}`,
        { cache: "no-store" },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudieron cargar saldos");
      }
      const raw: unknown = await res.json();
      const items: AccountOpeningBalance[] = Array.isArray(raw)
        ? (raw as AccountOpeningBalance[])
        : [];

      const existingMap: Record<string, AccountOpeningBalance> = {};
      let latestDate: Date | null = null;
      for (const item of items) {
        const currency = (item.currency || "").toUpperCase().trim();
        if (!currency) continue;
        existingMap[currency] = item;
        const d = new Date(item.effective_date);
        if (!Number.isNaN(d.getTime())) {
          if (!latestDate || d > latestDate) latestDate = d;
        }
      }

      const accountCurrency = (a.currency || "").toUpperCase().trim();
      const restrictCurrency = accountCurrency !== "";
      const enabledCurrencies = currencies.filter((c) => c.enabled);
      const codes = new Set<string>();

      if (restrictCurrency) {
        codes.add(accountCurrency);
      } else {
        enabledCurrencies.forEach((c) => codes.add(c.code.toUpperCase()));
        Object.keys(existingMap).forEach((c) => codes.add(c));
      }

      const rows: Record<string, string> = {};
      codes.forEach((code) => {
        const existing = existingMap[code];
        rows[code] =
          existing && Number.isFinite(Number(existing.amount))
            ? String(existing.amount)
            : "";
      });

      setBalanceExisting(existingMap);
      setBalanceRows(rows);
      setBalanceDate(
        latestDate
          ? toDateInputValue(latestDate)
          : toDateInputValue(new Date()),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar saldos");
    } finally {
      setBalanceSaving(false);
    }
  };

  const saveAccount = async () => {
    if (!token) return;
    if (!agencyId) {
      toast.error("La agencia no está cargada todavía");
      return;
    }
    const payload = {
      id_agency: agencyId,
      name: accountForm.name.trim(),
      alias: accountForm.alias.trim() || null,
      currency: accountForm.currency || null, // ← puede ser null
      enabled: !!accountForm.enabled,
    };
    if (!payload.name) {
      toast.error("Completá el nombre de la cuenta");
      return;
    }
    try {
      const url =
        "/api/finance/accounts" +
        (accountEditing ? `/${accountEditing.id_account}` : "");
      const method = accountEditing ? "PATCH" : "POST";
      const res = await authFetch(
        url,
        { method, body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        let msg = "No se pudo guardar la cuenta";
        try {
          const j: unknown = await res.json();
          msg = apiErrorMessage(j) ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      toast.success(accountEditing ? "Cuenta actualizada" : "Cuenta creada");
      setAccountModalOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const toggleAccountEnabled = async (a: FinanceAccount) => {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/finance/accounts/${a.id_account}`,
        { method: "PATCH", body: JSON.stringify({ enabled: !a.enabled }) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo actualizar");
      }
      await reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al actualizar estado",
      );
    }
  };

  const deleteAccount = async (a: FinanceAccount) => {
    if (!token) return;
    if (!confirm(`¿Eliminar la cuenta "${a.name}"?`)) return;
    try {
      const res = await authFetch(
        `/api/finance/accounts/${a.id_account}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo eliminar");
      }
      toast.success("Cuenta eliminada");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  const saveOpeningBalances = async () => {
    if (!token || !balanceAccount) return;
    const effectiveDate =
      balanceDate && balanceDate.trim() !== ""
        ? balanceDate.trim()
        : toDateInputValue(new Date());

    const updates = Object.entries(balanceRows);
    const invalid = updates.find(([, v]) => {
      if (!v || v.trim() === "") return false;
      const normalized = v.replace(",", ".");
      return !Number.isFinite(Number(normalized));
    });

    if (invalid) {
      toast.error("Ingresá montos válidos (ej: 1200.50)");
      return;
    }

    setBalanceSaving(true);
    try {
      await Promise.all(
        updates.map(async ([currency, raw]) => {
          const value = (raw || "").trim();
          const existing = balanceExisting[currency];

          if (!value) {
            if (existing) {
              await authFetch(
                `/api/finance/account-balances?account_id=${balanceAccount.id_account}&currency=${currency}`,
                { method: "DELETE" },
                token,
              );
            }
            return;
          }

          const amount = Number(value.replace(",", "."));

          await authFetch(
            "/api/finance/account-balances",
            {
              method: "POST",
              body: JSON.stringify({
                account_id: balanceAccount.id_account,
                currency,
                amount,
                effective_date: effectiveDate,
              }),
            },
            token,
          );
        }),
      );

      toast.success("Saldos iniciales actualizados");
      setBalanceModalOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar saldos");
    } finally {
      setBalanceSaving(false);
    }
  };

  /* =================== MÉTODOS DE PAGO =================== */
  const [methodModalOpen, setMethodModalOpen] = useState(false);
  const [methodEditing, setMethodEditing] =
    useState<FinancePaymentMethod | null>(null);
  const [methodForm, setMethodForm] = useState<{
    name: string;
    code: string;
    requires_account: boolean;
    enabled: boolean;
  }>({ name: "", code: "", requires_account: false, enabled: true });

  const openNewMethod = () => {
    setMethodEditing(null);
    setMethodForm({
      name: "",
      code: "",
      requires_account: false,
      enabled: true,
    });
    setMethodModalOpen(true);
  };
  const openEditMethod = (m: FinancePaymentMethod) => {
    setMethodEditing(m);
    setMethodForm({
      name: m.name,
      code: m.code,
      requires_account: m.requires_account,
      enabled: m.enabled,
    });
    setMethodModalOpen(true);
  };

  const saveMethod = async () => {
    if (!token) return;
    if (!agencyId) {
      toast.error("La agencia no está cargada todavía");
      return;
    }
    const payload = {
      id_agency: agencyId,
      name: methodForm.name.trim(),
      code: methodForm.code.trim(),
      requires_account: !!methodForm.requires_account,
      enabled: !!methodForm.enabled,
    };
    if (!payload.name || !payload.code) {
      toast.error("Completá nombre y código del método");
      return;
    }
    try {
      const url =
        "/api/finance/methods" +
        (methodEditing ? `/${methodEditing.id_method}` : "");
      const method = methodEditing ? "PATCH" : "POST";
      const res = await authFetch(
        url,
        { method, body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo guardar el método");
      }
      toast.success(methodEditing ? "Método actualizado" : "Método creado");
      setMethodModalOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const toggleMethodEnabled = async (m: FinancePaymentMethod) => {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/finance/methods/${m.id_method}`,
        { method: "PATCH", body: JSON.stringify({ enabled: !m.enabled }) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo actualizar");
      }
      await reload();
    } catch {
      toast.error("Error al actualizar estado");
    }
  };

  const toggleMethodRequiresAccount = async (m: FinancePaymentMethod) => {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/finance/methods/${m.id_method}`,
        {
          method: "PATCH",
          body: JSON.stringify({ requires_account: !m.requires_account }),
        },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo actualizar");
      }
      await reload();
    } catch {
      toast.error("Error al actualizar método");
    }
  };

  const deleteMethod = async (m: FinancePaymentMethod) => {
    if (!token) return;
    if (!confirm(`¿Eliminar el método "${m.name}"?`)) return;
    try {
      const res = await authFetch(
        `/api/finance/methods/${m.id_method}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo eliminar");
      }
      toast.success("Método eliminado");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  /* =================== CATEGORÍAS =================== */
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<FinanceExpenseCategory | null>(
    null,
  );
  const [savingCategory, setSavingCategory] = useState(false);
  const [catScopeFilter, setCatScopeFilter] =
    useState<CategoryScopeFilter>("INVESTMENT");
  const [catForm, setCatForm] = useState<{
    name: string;
    scope: "" | "INVESTMENT" | "OTHER_INCOME";
    enabled: boolean;
    requires_operator: boolean;
    requires_user: boolean;
  }>({
    name: "",
    scope: "",
    enabled: true,
    requires_operator: false,
    requires_user: false,
  });

  const openNewCategory = () => {
    setCatEditing(null);
    setCatForm({
      name: "",
      scope: "",
      enabled: true,
      requires_operator: false,
      requires_user: false,
    });
    setCatModalOpen(true);
  };
  const openEditCategory = (c: FinanceExpenseCategory) => {
    setCatEditing(c);
    setCatForm({
      name: c.name,
      scope: c.scope ?? "INVESTMENT",
      enabled: c.enabled,
      requires_operator: !!c.requires_operator,
      requires_user: !!c.requires_user,
    });
    setCatModalOpen(true);
  };

  const upsertCategoryInBundle = useCallback(
    (
      nextItem: Partial<FinanceExpenseCategory> & {
        id_category?: number;
        name?: string;
        scope?: "INVESTMENT" | "OTHER_INCOME";
      },
      fallback: {
        name: string;
        scope: "INVESTMENT" | "OTHER_INCOME";
        enabled: boolean;
        requires_operator: boolean;
        requires_user: boolean;
      },
    ) => {
      const idCategory = Number(nextItem.id_category ?? catEditing?.id_category);
      if (!Number.isFinite(idCategory) || idCategory <= 0) return;

      const merged: FinanceExpenseCategory = {
        id_category: idCategory,
        name: (nextItem.name ?? fallback.name).trim(),
        scope: nextItem.scope === "OTHER_INCOME" ? "OTHER_INCOME" : fallback.scope,
        enabled:
          typeof nextItem.enabled === "boolean"
            ? nextItem.enabled
            : fallback.enabled,
        sort_order:
          typeof nextItem.sort_order === "number" && Number.isFinite(nextItem.sort_order)
            ? nextItem.sort_order
            : 0,
        requires_operator:
          typeof nextItem.requires_operator === "boolean"
            ? nextItem.requires_operator
            : fallback.requires_operator,
        requires_user:
          typeof nextItem.requires_user === "boolean"
            ? nextItem.requires_user
            : fallback.requires_user,
      };

      setBundle((prev) => {
        if (!prev) return prev;
        const exists = prev.categories.some((c) => c.id_category === idCategory);
        const list = exists
          ? prev.categories.map((c) =>
              c.id_category === idCategory ? { ...c, ...merged } : c,
            )
          : [...prev.categories, merged];

        list.sort((a, b) =>
          a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
        );
        return { ...prev, categories: list };
      });
    },
    [catEditing],
  );

  const saveCategory = async () => {
    if (savingCategory) return;
    if (!token) return;
    if (!agencyId) {
      toast.error("La agencia no está cargada todavía");
      return;
    }
    const payload = {
      id_agency: agencyId,
      name: catForm.name.trim(),
      scope: catForm.scope,
      enabled: !!catForm.enabled,
      requires_operator: !!catForm.requires_operator,
      requires_user: !!catForm.requires_user,
    };
    if (!payload.name) {
      toast.error("Completá el nombre de la categoría");
      return;
    }
    if (!payload.scope) {
      toast.error("Elegí si la categoría es para inversión o ingresos");
      return;
    }
    setSavingCategory(true);
    try {
      const url =
        "/api/finance/categories" +
        (catEditing ? `/${catEditing.id_category}` : "");
      const method = catEditing ? "PATCH" : "POST";
      const res = await authFetch(
        url,
        { method, body: JSON.stringify(payload) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(
          apiErrorMessage(j) ?? "No se pudo guardar la categoría",
        );
      }
      const savedRaw: unknown = await res.json().catch(() => null);
      const saved = isRecord(savedRaw) ? savedRaw : {};

      upsertCategoryInBundle(saved as Partial<FinanceExpenseCategory>, {
        name: payload.name,
        scope: payload.scope,
        enabled: payload.enabled,
        requires_operator: payload.requires_operator,
        requires_user: payload.requires_user,
      });
      setCatScopeFilter(payload.scope);
      toast.success(catEditing ? "Categoría actualizada" : "Categoría creada");
      setCatModalOpen(false);
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setSavingCategory(false);
    }
  };

  const toggleCategoryEnabled = async (c: FinanceExpenseCategory) => {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/finance/categories/${c.id_category}`,
        { method: "PATCH", body: JSON.stringify({ enabled: !c.enabled }) },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo actualizar");
      }
      await reload();
    } catch {
      toast.error("Error al actualizar estado");
    }
  };

  const deleteCategory = async (c: FinanceExpenseCategory) => {
    if (!token) return;
    if (!confirm(`¿Eliminar la categoría "${c.name}"?`)) return;
    try {
      const res = await authFetch(
        `/api/finance/categories/${c.id_category}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const j: unknown = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(j) ?? "No se pudo eliminar");
      }
      toast.success("Categoría eliminada");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  /* =================== Derivados (con arrays estables) =================== */
  const EMPTY_CURRENCIES: FinanceCurrency[] = useMemo(() => [], []);
  const EMPTY_ACCOUNTS: FinanceAccount[] = useMemo(() => [], []);
  const EMPTY_METHODS: FinancePaymentMethod[] = useMemo(() => [], []);
  const EMPTY_CATEGORIES: FinanceExpenseCategory[] = useMemo(() => [], []);

  const currencies: FinanceCurrency[] = bundle?.currencies ?? EMPTY_CURRENCIES;
  const accounts: FinanceAccount[] = bundle?.accounts ?? EMPTY_ACCOUNTS;
  const methods: FinancePaymentMethod[] =
    bundle?.paymentMethods ?? EMPTY_METHODS;
  const categories: FinanceExpenseCategory[] =
    bundle?.categories ?? EMPTY_CATEGORIES;
  const filteredCategories = useMemo(
    () => categories.filter((c) => c.scope === catScopeFilter),
    [categories, catScopeFilter],
  );

  const enabledCurrencies = useMemo(
    () => currencies.filter((c) => c.enabled),
    [currencies],
  );

  const currencyNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of currencies) {
      map.set(c.code.toUpperCase(), c.name);
    }
    return map;
  }, [currencies]);

  const isDefaultCurrencyValid = useMemo(
    () =>
      enabledCurrencies.some(
        (c) => c.code === generalForm.default_currency_code,
      ),
    [enabledCurrencies, generalForm.default_currency_code],
  );

  /* =================== Render =================== */
  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        {/* Título + Tabs */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Configuración de Finanzas</h1>
            <p className="text-sm opacity-70">
              Monedas, cuentas, métodos de pago y categorías. Alcance por
              agencia.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={`${ICON_BTN} ${
                  active === t.key ? "border-sky-400/80" : ""
                }`}
                aria-label={`Ir a ${t.label}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenido */}
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <>
            {/* GENERAL */}
            {active === "general" && (
              <div className={`${GLASS} p-5`}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label>Moneda por defecto</Label>
                    <select
                      value={generalForm.default_currency_code}
                      onChange={(e) =>
                        setGeneralForm((f) => ({
                          ...f,
                          default_currency_code: e.target.value,
                        }))
                      }
                      className={`w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10 ${
                        generalForm.default_currency_code &&
                        !isDefaultCurrencyValid
                          ? "border-red-400/60"
                          : ""
                      }`}
                    >
                      <option value="" disabled>
                        Elegir…
                      </option>
                      {currencies.map((c) => (
                        <option key={c.id_currency} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                    {generalForm.default_currency_code &&
                      !isDefaultCurrencyValid && (
                        <p className="mt-1 text-xs text-red-600">
                          La moneda seleccionada ya no está habilitada. Elegí
                          otra.
                        </p>
                      )}
                  </div>

                  <div className="flex items-end">
                    <Switch
                      checked={
                        !!generalForm.hide_operator_expenses_in_investments
                      }
                      onChange={(v) =>
                        setGeneralForm((f) => ({
                          ...f,
                          hide_operator_expenses_in_investments: v,
                        }))
                      }
                      label="Ocultar egresos de Operador en 'Gastos'"
                      title="Impacta en la vista de Investments / Gastos"
                    />
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={saveGeneral}
                    disabled={savingGeneral}
                    className={BTN_EMERALD}
                  >
                    {savingGeneral ? <Spinner /> : "Guardar"}
                  </button>
                </div>

                <div className="mt-6 border-t border-white/15 pt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-sky-950/70 dark:text-white/70">
                      Recibos en reservas
                    </h3>
                    <span className={BADGE_SKY}>Alcance por agencia</span>
                  </div>

                  <p className="mb-3 text-sm text-sky-950/80 dark:text-white/80">
                    Define cómo se vinculan los servicios cuando emitís o
                    asociás recibos de una reserva.
                  </p>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    {RECEIPT_SERVICE_SELECTION_OPTIONS.map((opt) => (
                      <label
                        key={opt.key}
                        className="flex cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-white/30 p-3 dark:bg-white/10"
                      >
                        <input
                          type="radio"
                          name="receipt_service_selection_mode"
                          value={opt.key}
                          checked={receiptServiceSelectionMode === opt.key}
                          onChange={() => setReceiptServiceSelectionMode(opt.key)}
                        />
                        <div className="text-sm">
                          <div className="font-medium">{opt.label}</div>
                          <div className="text-xs opacity-70">{opt.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setReceiptServiceSelectionMode(
                          serverReceiptServiceSelectionMode,
                        )
                      }
                      disabled={
                        receiptServiceSelectionMode ===
                        serverReceiptServiceSelectionMode
                      }
                      className={BTN_AMBER}
                    >
                      Restablecer
                    </button>
                    <button
                      type="button"
                      onClick={saveReceiptServiceMode}
                      disabled={
                        savingReceiptServiceMode ||
                        receiptServiceSelectionMode ===
                          serverReceiptServiceSelectionMode
                      }
                      className={BTN_EMERALD}
                    >
                      {savingReceiptServiceMode ? (
                        <Spinner />
                      ) : (
                        "Guardar modo de recibos"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* MONEDAS */}
            {active === "currencies" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">Monedas</h2>
                  <button
                    type="button"
                    onClick={openNewCurrency}
                    className={BTN_SKY}
                  >
                    Nueva moneda
                  </button>
                </div>

                {currencies.length === 0 ? (
                  <div className={`${GLASS} p-6 text-center`}>
                    Aún no hay monedas configuradas.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {currencies.map((c, idx) => (
                      <article
                        key={c.id_currency}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className={BADGE_SKY}>N° {c.id_currency}</div>
                          <div className="truncate">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">
                                {c.code}
                              </span>
                              {c.is_primary && (
                                <span className={BADGE_EMERALD}>Principal</span>
                              )}
                              {!c.enabled && (
                                <span className={BADGE_AMBER}>
                                  Deshabilitada
                                </span>
                              )}
                            </div>
                            <div className="text-sm opacity-80">
                              {c.name} • {c.symbol ?? ""}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => moveCurrency(idx, -1)}
                            disabled={idx === 0}
                            className={BTN_AMBER}
                            title="Subir"
                            aria-label="Subir moneda"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveCurrency(idx, +1)}
                            disabled={idx === currencies.length - 1}
                            className={BTN_AMBER}
                            title="Bajar"
                            aria-label="Bajar moneda"
                          >
                            ↓
                          </button>

                          <button
                            type="button"
                            onClick={() => setCurrencyPrimary(c)}
                            disabled={c.is_primary}
                            className={BTN_EMERALD}
                            title="Marcar como principal"
                            aria-label="Marcar como principal"
                          >
                            Principal
                          </button>

                          <Switch
                            checked={c.enabled}
                            onChange={() => toggleCurrencyEnabled(c)}
                            label="Activa"
                            title={
                              c.enabled
                                ? "Deshabilitar moneda"
                                : "Habilitar moneda"
                            }
                          />

                          <button
                            type="button"
                            onClick={() => openEditCurrency(c)}
                            className={BTN_SKY}
                          >
                            <IconPencilSquare className="size-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteCurrency(c)}
                            className={BTN_DANGER}
                          >
                            <IconTrash className="size-4" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* CUENTAS */}
            {active === "accounts" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">Cuentas</h2>
                  <button
                    type="button"
                    onClick={openNewAccount}
                    className={BTN_SKY}
                  >
                    Nueva cuenta
                  </button>
                </div>

                {accounts.length === 0 ? (
                  <div className={`${GLASS} p-6 text-center`}>
                    Aún no hay cuentas configuradas.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {accounts.map((a) => {
                      const cur = a.currency
                        ? currencies.find((c) => c.code === a.currency)
                        : undefined;
                      return (
                        <article
                          key={a.id_account}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className={BADGE_SKY}>N° {a.id_account}</div>
                            <div className="truncate">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">
                                  {a.name}
                                </span>
                                {!a.enabled && (
                                  <span className={BADGE_AMBER}>
                                    Deshabilitada
                                  </span>
                                )}
                              </div>
                              <div className="text-sm opacity-80">
                                {a.alias ? `${a.alias} • ` : ""}
                                {a.currency ?? "— sin moneda —"}
                                {cur ? ` • ${cur.name}` : ""}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openBalanceModal(a)}
                              className={BTN_AMBER}
                              aria-label="Editar saldos iniciales"
                            >
                              Saldos iniciales
                            </button>

                            <Switch
                              checked={a.enabled}
                              onChange={() => toggleAccountEnabled(a)}
                              label="Activa"
                              title={
                                a.enabled
                                  ? "Deshabilitar cuenta"
                                  : "Habilitar cuenta"
                              }
                            />

                            <button
                              type="button"
                              onClick={() => openEditAccount(a)}
                              className={BTN_SKY}
                            >
                              <IconPencilSquare className="size-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteAccount(a)}
                              className={BTN_DANGER}
                            >
                              <IconTrash className="size-4" />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* MÉTODOS */}
            {active === "methods" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">Métodos de pago</h2>
                  <button
                    type="button"
                    onClick={openNewMethod}
                    className={BTN_SKY}
                  >
                    Nuevo método
                  </button>
                </div>

                {methods.length === 0 ? (
                  <div className={`${GLASS} p-6 text-center`}>
                    Aún no hay métodos configurados.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {methods.map((m) => (
                      <article
                        key={m.id_method}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className={BADGE_SKY}>N° {m.id_method}</div>
                          <div className="truncate">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">
                                {m.name}
                              </span>
                              <span className={BADGE_SKY}>{m.code}</span>
                              {!m.enabled && (
                                <span className={BADGE_AMBER}>
                                  Deshabilitado
                                </span>
                              )}
                              {m.requires_account && (
                                <span className={BADGE_EMERALD}>
                                  Requiere cuenta
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Switch
                            checked={m.requires_account}
                            onChange={() => toggleMethodRequiresAccount(m)}
                            label="Requiere cuenta"
                            title={
                              m.requires_account
                                ? "Marcar como no requiere cuenta"
                                : "Marcar como requiere cuenta"
                            }
                          />

                          <Switch
                            checked={m.enabled}
                            onChange={() => toggleMethodEnabled(m)}
                            label="Activo"
                            title={
                              m.enabled
                                ? "Deshabilitar método"
                                : "Habilitar método"
                            }
                          />

                          <button
                            type="button"
                            onClick={() => openEditMethod(m)}
                            className={BTN_SKY}
                          >
                            <IconPencilSquare className="size-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteMethod(m)}
                            className={BTN_DANGER}
                          >
                            <IconTrash className="size-4" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* VERIFICACIÓN */}
            {active === "verification" && (
              <ReceiptVerificationConfig
                accounts={accounts}
                methods={methods}
              />
            )}

            {/* PERMISOS */}
            {active === "permissions" && <FinanceSectionAccessConfig />}

            {/* CATEGORÍAS */}
            {active === "categories" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">
                    Categorías financieras
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 p-1">
                      {CATEGORY_SCOPE_FILTERS.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setCatScopeFilter(f.key)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            catScopeFilter === f.key
                              ? "border border-sky-300/60 bg-sky-100/10 text-sky-900 dark:text-sky-50"
                              : "border border-transparent text-sky-900/70 hover:text-sky-900 dark:text-white/70 dark:hover:text-white"
                          }`}
                          aria-label={`Ver categorías de ${f.label.toLowerCase()}`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={openNewCategory}
                      className={BTN_SKY}
                    >
                      Nueva categoría
                    </button>
                  </div>
                </div>

                {filteredCategories.length === 0 ? (
                  <div className={`${GLASS} p-6 text-center`}>
                    {catScopeFilter === "OTHER_INCOME"
                      ? "Aún no hay categorías de ingresos configuradas."
                      : "Aún no hay categorías de egresos configuradas."}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredCategories.map((c) => (
                      <article
                        key={c.id_category}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className={BADGE_SKY}>N° {c.id_category}</div>
                          <div className="truncate">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">
                                {c.name}
                              </span>
                              <span className={BADGE_SKY}>
                                {c.scope === "OTHER_INCOME"
                                  ? "Ingresos"
                                  : "Inversión"}
                              </span>
                              {c.requires_user && (
                                <span className={BADGE_SKY}>
                                  Vincula usuario
                                </span>
                              )}
                              {c.requires_operator && (
                                <span className={BADGE_SKY}>
                                  Vincula operador
                                </span>
                              )}
                              {!c.enabled && (
                                <span className={BADGE_AMBER}>
                                  Deshabilitada
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Switch
                            checked={c.enabled}
                            onChange={() => toggleCategoryEnabled(c)}
                            label="Activa"
                            title={
                              c.enabled
                                ? "Deshabilitar categoría"
                                : "Habilitar categoría"
                            }
                          />

                          <button
                            type="button"
                            onClick={() => openEditCategory(c)}
                            className={BTN_SKY}
                          >
                            <IconPencilSquare className="size-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteCategory(c)}
                            className={BTN_DANGER}
                          >
                            <IconTrash className="size-4" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* COMISIONES */}
            {active === "commissions" && <CommissionsConfig />}
          </>
        )}

        {/* Modales */}
        <Modal
          open={currencyModalOpen}
          onClose={() => setCurrencyModalOpen(false)}
          title={currencyEditing ? "Editar moneda" : "Nueva moneda"}
          footer={
            <>
              <button
                type="button"
                onClick={() => setCurrencyModalOpen(false)}
                className={BTN_AMBER}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveCurrency}
                className={BTN_EMERALD}
              >
                Guardar
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Código</Label>
              <Input
                value={currencyForm.code}
                onChange={(e) =>
                  setCurrencyForm((f) => ({
                    ...f,
                    code: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="ARS / USD"
              />
            </div>
            <div>
              <Label>Símbolo</Label>
              <Input
                value={currencyForm.symbol}
                onChange={(e) =>
                  setCurrencyForm((f) => ({ ...f, symbol: e.target.value }))
                }
                placeholder="$ / U$D"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Nombre</Label>
              <Input
                value={currencyForm.name}
                onChange={(e) =>
                  setCurrencyForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Peso argentino / Dólar estadounidense"
              />
            </div>
            <div className="sm:col-span-2">
              <Switch
                checked={currencyForm.enabled}
                onChange={(v) => setCurrencyForm((f) => ({ ...f, enabled: v }))}
                label="Habilitada"
              />
            </div>
          </div>
        </Modal>

        <Modal
          open={accountModalOpen}
          onClose={() => setAccountModalOpen(false)}
          title={accountEditing ? "Editar cuenta" : "Nueva cuenta"}
          footer={
            <>
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
                className={BTN_AMBER}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveAccount}
                className={BTN_EMERALD}
              >
                Guardar
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nombre</Label>
              <Input
                value={accountForm.name}
                onChange={(e) =>
                  setAccountForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Banco / Billetera / Caja…"
              />
            </div>
            <div>
              <Label>Alias (opcional)</Label>
              <Input
                value={accountForm.alias}
                onChange={(e) =>
                  setAccountForm((f) => ({ ...f, alias: e.target.value }))
                }
                placeholder="Ej: Macro Sucursal Centro"
              />
            </div>
            <div>
              <Label>Moneda (opcional)</Label>
              <select
                value={accountForm.currency}
                onChange={(e) =>
                  setAccountForm((f) => ({ ...f, currency: e.target.value }))
                }
                className="w-full cursor-pointer appearance-none rounded-3xl border border-white/30 bg-white/10 px-3 py-2 outline-none backdrop-blur dark:border-white/10 dark:bg-white/10"
              >
                <option value="">— Sin moneda —</option>
                {enabledCurrencies.map((c) => (
                  <option key={c.id_currency} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Switch
                checked={accountForm.enabled}
                onChange={(v) => setAccountForm((f) => ({ ...f, enabled: v }))}
                label="Habilitada"
              />
            </div>
          </div>
        </Modal>

        <Modal
          open={balanceModalOpen}
          onClose={() => setBalanceModalOpen(false)}
          title={`Saldos iniciales${
            balanceAccount ? ` — ${balanceAccount.name}` : ""
          }`}
          wide
          footer={
            <>
              <button
                type="button"
                onClick={() => setBalanceModalOpen(false)}
                className={BTN_AMBER}
                disabled={balanceSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveOpeningBalances}
                className={BTN_EMERALD}
                disabled={balanceSaving}
              >
                Guardar
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Cargá el saldo inicial por moneda. Si dejás un valor vacío, no se
              registra.
            </p>
            {balanceAccount?.currency && (
              <div className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                <span className={BADGE_EMERALD}>Moneda fija</span>
                <span>{balanceAccount.currency.toUpperCase()}</span>
              </div>
            )}
            <div className="max-w-xs">
              <Label>Fecha de saldo inicial</Label>
              <Input
                type="date"
                value={balanceDate}
                onChange={(e) => setBalanceDate(e.target.value)}
                disabled={balanceSaving}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Object.keys(balanceRows).length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/10 p-4 text-xs opacity-70">
                  No hay monedas configuradas.
                </div>
              ) : (
                Object.keys(balanceRows)
                  .sort((a, b) => a.localeCompare(b))
                  .map((code) => (
                    <div
                      key={code}
                      className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold">{code}</span>
                        <span className="text-[10px] opacity-70">
                          {currencyNameByCode.get(code) ?? ""}
                        </span>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        value={balanceRows[code] ?? ""}
                        onChange={(e) =>
                          setBalanceRows((prev) => ({
                            ...prev,
                            [code]: e.target.value,
                          }))
                        }
                        placeholder="0.00"
                        disabled={balanceSaving}
                        className="mt-2"
                      />
                    </div>
                  ))
              )}
            </div>
          </div>
        </Modal>

        <Modal
          open={methodModalOpen}
          onClose={() => setMethodModalOpen(false)}
          title={methodEditing ? "Editar método" : "Nuevo método"}
          footer={
            <>
              <button
                type="button"
                onClick={() => setMethodModalOpen(false)}
                className={BTN_AMBER}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveMethod}
                className={BTN_EMERALD}
              >
                Guardar
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label>Nombre</Label>
              <Input
                value={methodForm.name}
                onChange={(e) =>
                  setMethodForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Efectivo / Transferencia / Crédito / IATA…"
              />
            </div>
            <div>
              <Label>Código</Label>
              <Input
                value={methodForm.code}
                onChange={(e) =>
                  setMethodForm((f) => ({ ...f, code: e.target.value }))
                }
                placeholder="cash / transfer / card…"
                disabled={!!methodEditing?.lock_system}
                title={
                  methodEditing?.lock_system
                    ? "Código bloqueado por sistema"
                    : undefined
                }
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Switch
                checked={methodForm.requires_account}
                onChange={(v) =>
                  setMethodForm((f) => ({ ...f, requires_account: v }))
                }
                label="Requiere cuenta"
              />
              <Switch
                checked={methodForm.enabled}
                onChange={(v) => setMethodForm((f) => ({ ...f, enabled: v }))}
                label="Habilitado"
              />
            </div>
          </div>
        </Modal>

        <Modal
          open={catModalOpen}
          onClose={() => setCatModalOpen(false)}
          title={catEditing ? "Editar categoría" : "Nueva categoría"}
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                className={BTN_AMBER}
                disabled={savingCategory}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveCategory}
                className={BTN_EMERALD}
                disabled={savingCategory}
              >
                {savingCategory ? <Spinner /> : "Guardar"}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label>Nombre</Label>
              <Input
                value={catForm.name}
                onChange={(e) =>
                  setCatForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="AFIP / SUELDO / OPERADOR / MANTENCIÓN…"
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <select
                className="block w-full min-w-fit appearance-none rounded-2xl border border-sky-200 bg-white/50 px-4 py-2 shadow-sm shadow-sky-950/10 outline-none backdrop-blur dark:border-sky-200/60 dark:bg-sky-100/10"
                value={catForm.scope}
                onChange={(e) =>
                  setCatForm((f) => ({
                    ...f,
                    scope: e.target.value as "" | "INVESTMENT" | "OTHER_INCOME",
                  }))
                }
              >
                <option value="">Seleccionar tipo</option>
                <option value="INVESTMENT">Inversión (egresos)</option>
                <option value="OTHER_INCOME">Ingresos</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              <Switch
                checked={catForm.enabled}
                onChange={(v) => setCatForm((f) => ({ ...f, enabled: v }))}
                label="Habilitada"
              />
              <Switch
                checked={catForm.requires_operator}
                onChange={(v) =>
                  setCatForm((f) => ({ ...f, requires_operator: v }))
                }
                label="Vincula a un operador"
              />
              <Switch
                checked={catForm.requires_user}
                onChange={(v) =>
                  setCatForm((f) => ({ ...f, requires_user: v }))
                }
                label="Vincula a un usuario"
              />
            </div>
          </div>
        </Modal>

        <ToastContainer position="bottom-right" />
      </section>
    </ProtectedRoute>
  );
}

export default function FinanceConfigPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh]">
          <Spinner />
        </div>
      }
    >
      <FinanceConfigPageInner />
    </Suspense>
  );
}
