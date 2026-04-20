// src/app/dev/agencies/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { toast, ToastContainer } from "react-toastify";
import { useRouter } from "next/navigation";
import "react-toastify/dist/ReactToastify.css";

/** =========================
 *  Tipos / helpers
 *  ========================= */
type Maybe<T> = T | null | undefined;
type DebtState = "all" | "debtors" | "non_debtors";

type DevAgency = {
  id_agency: number;
  name: string;
  legal_name: string;
  tax_id: string;
  billing_owner_agency_id?: Maybe<number>;
  billing?: {
    owner_id: number;
    owner_name: string;
    is_owner: boolean;
    status: BillingStatus;
    period_start?: Maybe<string | Date>;
    period_end?: Maybe<string | Date>;
  };
  address?: Maybe<string>;
  phone?: Maybe<string>;
  email?: Maybe<string>;
  website?: Maybe<string>;
  foundation_date?: Maybe<string | Date>;
  counts?: {
    users: number;
    clients: number;
    bookings: number;
  };
  last_connection_at?: Maybe<string | Date>;
};

type BillingStatus = "PAID" | "PENDING" | "OVERDUE" | "NONE";

type DevAgencyInput = {
  name: string;
  legal_name: string;
  tax_id: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  foundation_date?: string | null; // YYYY-MM-DD
};

type ListResponse = {
  items: DevAgency[];
  nextCursor: number | null;
};

const PAGE_SIZE = 12;
const DEBT_STATE_OPTIONS: Array<{ value: DebtState; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "debtors", label: "Deudores" },
  { value: "non_debtors", label: "No deudores" },
];

function matchesDebtState(status: BillingStatus | undefined, state: DebtState) {
  const safeStatus = status ?? "NONE";
  if (state === "all") return true;
  if (state === "debtors") return safeStatus === "OVERDUE";
  return safeStatus !== "OVERDUE";
}

function formatDateTime(value?: string | Date | null): string {
  if (!value) return "Sin conexión registrada";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "Sin conexión registrada";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

function getBillingBadge(status?: BillingStatus) {
  switch (status) {
    case "PAID":
      return {
        label: "Pagado",
        className:
          "border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200",
      };
    case "OVERDUE":
      return {
        label: "Vencido",
        className:
          "border-red-400/60 bg-red-100/80 text-red-900 dark:border-red-300/50 dark:bg-red-500/20 dark:text-red-100",
      };
    case "PENDING":
      return {
        label: "Pendiente",
        className:
          "border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200",
      };
    default:
      return {
        label: "Sin cobro",
        className:
          "border-white/10 bg-white/10 text-sky-950/70 dark:text-white/70",
      };
  }
}

function toYMD(value?: string | Date | null): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function IconButton({
  title,
  onClick,
  className = "",
  children,
}: {
  title: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-full border px-3 py-2 text-sky-950 shadow-sm transition-transform hover:scale-95 active:scale-90 dark:text-white ${className}`}
    >
      {children}
    </button>
  );
}

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

/** Validaciones simples (alineadas con la API) */
function isValidEmail(v?: string | null): boolean {
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function isValidUrl(v?: string | null): boolean {
  if (!v) return true;
  return /^https?:\/\//i.test(v.trim());
}
function isValidCUIT(raw: string): boolean {
  const c = (raw || "").replace(/\D/g, "");
  if (c.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digits = c.split("").map(Number);
  const dv = digits.pop()!;
  const sum = digits.reduce((acc, d, i) => acc + d * mult[i], 0);
  let mod = 11 - (sum % 11);
  if (mod === 11) mod = 0;
  if (mod === 10) mod = 9;
  return dv === mod;
}

/** =========================
 *  Página
 *  ========================= */
export default function DevAgenciesPage() {
  const { token } = useAuth();
  const router = useRouter();

  // Lista
  const [items, setItems] = useState<DevAgency[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [forbidden, setForbidden] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [deletingAgencyId, setDeletingAgencyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DevAgency | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] =
    useState<string>("");
  const [debtState, setDebtState] = useState<DebtState>("all");

  // Form
  const [openForm, setOpenForm] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const formRef = useRef<HTMLDivElement>(null);

  const [formValues, setFormValues] = useState<DevAgencyInput>({
    name: "",
    legal_name: "",
    tax_id: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    foundation_date: "",
  });
  const [formErrors, setFormErrors] = useState<
    Partial<Record<keyof DevAgencyInput, string>>
  >({});

  const isDeleteConfirmationValid =
    deleteConfirmationText.trim().toUpperCase() === "ELIMINAR";

  /** Cargar inicial */
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch(
          `/api/dev/agencies?limit=${PAGE_SIZE}&debt_state=${debtState}`,
          { signal: controller.signal },
          token,
        );
        if (res.status === 403) {
          setForbidden(true);
          setItems([]);
          setNextCursor(null);
          return;
        }
        if (!res.ok) throw new Error("No se pudo cargar agencias");
        const data = (await res.json()) as ListResponse;
        setItems(data.items);
        setNextCursor(data.nextCursor);
      } catch (err: unknown) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error(err);
          toast.error("Error cargando agencias");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, debtState]);

  /** Ver más */
  const loadMore = async () => {
    if (!token || nextCursor == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await authFetch(
        `/api/dev/agencies?limit=${PAGE_SIZE}&cursor=${nextCursor}&debt_state=${debtState}`,
        {},
        token,
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          (errJson as { error?: string }).error || "No se pudo cargar más",
        );
      }
      const data = (await res.json()) as ListResponse;
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err: unknown) {
      console.error(err);
      toast.error("Error al cargar más agencias");
    } finally {
      setLoadingMore(false);
    }
  };

  /** Abrir crear / editar */
  const openCreate = () => {
    setEditingId(null);
    setFormValues({
      name: "",
      legal_name: "",
      tax_id: "",
      address: "",
      phone: "",
      email: "",
      website: "",
      foundation_date: "",
    });
    setFormErrors({});
    setOpenForm(true);
    scrollToForm();
  };
  const openEdit = (id: number) => {
    const a = items.find((x) => x.id_agency === id);
    if (!a) return;
    setEditingId(id);
    setFormValues({
      name: a.name ?? "",
      legal_name: a.legal_name ?? "",
      tax_id: (a.tax_id ?? "").replace(/\D/g, ""),
      address: a.address ?? "",
      phone: a.phone ?? "",
      email: a.email ?? "",
      website: a.website ?? "",
      foundation_date: toYMD(a.foundation_date ?? null),
    });
    setFormErrors({});
    setOpenForm(true);
    scrollToForm();
  };
  const scrollToForm = () =>
    setTimeout(
      () =>
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );

  /** Handlers form */
  const setField =
    (field: keyof DevAgencyInput) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (field === "tax_id") {
        const only = value.replace(/\D/g, "");
        setFormValues((p) => ({ ...p, tax_id: only }));
      } else {
        setFormValues((p) => ({ ...p, [field]: value }));
      }
      if (formErrors[field]) setFormErrors((p) => ({ ...p, [field]: "" }));
    };

  const validate = (v: DevAgencyInput) => {
    const e: Partial<Record<keyof DevAgencyInput, string>> = {};
    if (!v.name.trim()) e.name = "Obligatorio";
    if (!v.legal_name.trim()) e.legal_name = "Obligatorio";
    if (!v.tax_id.trim()) e.tax_id = "Obligatorio";
    else if (!isValidCUIT(v.tax_id.trim())) e.tax_id = "CUIT inválido";
    if (!isValidEmail(v.email)) e.email = "Email inválido";
    if (!isValidUrl(v.website)) e.website = "Debe empezar con http(s)://";
    return e;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const payload: DevAgencyInput = {
      name: formValues.name.trim(),
      legal_name: formValues.legal_name.trim(),
      tax_id: formValues.tax_id.trim(),
      address: formValues.address?.trim() || undefined,
      phone: formValues.phone?.trim() || undefined,
      email: formValues.email?.trim() || undefined,
      website: formValues.website?.trim() || undefined,
      foundation_date: formValues.foundation_date?.trim()
        ? formValues.foundation_date
        : null,
    };
    const errors = validate(payload);
    setFormErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    if (!token) return;
    setSaving(true);
    try {
      if (editingId) {
        // Update
        const res = await authFetch(
          `/api/dev/agencies/${editingId}`,
          { method: "PUT", body: JSON.stringify(payload) },
          token,
        );
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(
            (errJson as { error?: string }).error || "No se pudo actualizar",
          );
        }
        const updated = (await res.json()) as DevAgency;
        setItems((prev) =>
          prev.map((x) => (x.id_agency === editingId ? updated : x)),
        );
        toast.success("Agencia actualizada");
      } else {
        // Create
        const res = await authFetch(
          `/api/dev/agencies`,
          { method: "POST", body: JSON.stringify(payload) },
          token,
        );
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(
            (errJson as { error?: string }).error || "No se pudo crear",
          );
        }
        const created = (await res.json()) as DevAgency;
        setItems((prev) =>
          matchesDebtState(created.billing?.status, debtState)
            ? [created, ...prev]
            : prev,
        );
        toast.success("Agencia creada");
      }
      setOpenForm(false);
      setEditingId(null);
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error guardando");
    } finally {
      setSaving(false);
    }
  };

  /** Eliminar */
  const openDeleteDialog = (agency: DevAgency) => {
    if (deletingAgencyId) return;
    setDeleteTarget(agency);
    setDeleteConfirmationText("");
  };

  const closeDeleteDialog = () => {
    if (deletingAgencyId) return;
    setDeleteTarget(null);
    setDeleteConfirmationText("");
  };

  const confirmDelete = async () => {
    if (!token || !deleteTarget || deletingAgencyId) return;
    if (!isDeleteConfirmationValid) {
      toast.error('Escribí "ELIMINAR" para confirmar');
      return;
    }

    const id = deleteTarget.id_agency;
    setDeletingAgencyId(id);
    try {
      const res = await authFetch(
        `/api/dev/agencies/${id}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            confirmationText: deleteConfirmationText.trim(),
          }),
        },
        token,
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          (errJson as { error?: string }).error || "No se pudo eliminar",
        );
      }
      setItems((prev) => prev.filter((x) => x.id_agency !== id));
      toast.success("Agencia eliminada");
      setDeleteTarget(null);
      setDeleteConfirmationText("");
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error eliminando");
    } finally {
      setDeletingAgencyId(null);
    }
  };

  /** Ir al detalle */
  const goDetail = (id: number) => router.push(`/dev/agencies/${id}`);

  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Agencias</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => router.push("/dev/agencies/stats")}
              className="rounded-full border border-sky-300/40 bg-sky-100/20 px-5 py-2 text-sky-900 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-sky-200"
            >
              Estadisticas generales
            </button>
            <button
              onClick={openCreate}
              className="rounded-full border border-sky-300/40 bg-sky-100/20 px-5 py-2 text-sky-900 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-sky-200"
            >
              Nueva agencia
            </button>
          </div>
        </div>

        {forbidden && (
          <p className="mb-4 text-sm text-sky-950/70 dark:text-white/70">
            No tenés permisos para este panel.
          </p>
        )}

        {!forbidden && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {DEBT_STATE_OPTIONS.map((option) => {
              const isActive = debtState === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDebtState(option.value)}
                  className={`rounded-full border px-4 py-2 text-sm transition-transform hover:scale-95 active:scale-90 ${
                    isActive
                      ? "border-sky-400/60 bg-sky-200/30 text-sky-950 dark:border-sky-300/60 dark:bg-sky-200/20 dark:text-sky-100"
                      : "border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Form colapsable */}
        {openForm && (
          <div ref={formRef} className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-medium">
                {editingId ? "Editar agencia" : "Crear agencia"}
              </h2>
              <button
                onClick={() => {
                  setOpenForm(false);
                  setEditingId(null);
                }}
                className="rounded-full bg-white/0 px-4 py-2 text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
              >
                Cerrar
              </button>
            </div>

            <form
              onSubmit={onSubmit}
              noValidate
              className="grid grid-cols-1 gap-4 rounded-3xl border border-white/10 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur md:grid-cols-2"
            >
              {/* Nombre */}
              <div className="space-y-1">
                <label className="ml-1 block text-sm">
                  Nombre <span className="text-red-600">*</span>
                </label>
                <input
                  name="name"
                  type="text"
                  value={formValues.name}
                  onChange={setField("name")}
                  required
                  aria-invalid={!!formErrors.name}
                  className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                  placeholder="Mi Agencia"
                  disabled={saving}
                />
                {formErrors.name && (
                  <p className="text-xs text-red-600">{formErrors.name}</p>
                )}
              </div>

              {/* Razón social */}
              <div className="space-y-1">
                <label className="ml-1 block text-sm">
                  Razón social <span className="text-red-600">*</span>
                </label>
                <input
                  name="legal_name"
                  type="text"
                  value={formValues.legal_name}
                  onChange={setField("legal_name")}
                  required
                  aria-invalid={!!formErrors.legal_name}
                  className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                  placeholder="Mi Agencia SRL"
                  disabled={saving}
                />
                {formErrors.legal_name && (
                  <p className="text-xs text-red-600">
                    {formErrors.legal_name}
                  </p>
                )}
              </div>

              {/* CUIT */}
              <div className="space-y-1">
                <label className="ml-1 block text-sm">
                  CUIT <span className="text-red-600">*</span>
                </label>
                <input
                  name="tax_id"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={formValues.tax_id}
                  onChange={setField("tax_id")}
                  required
                  aria-invalid={!!formErrors.tax_id}
                  className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                  placeholder="20123456789"
                  disabled={saving}
                />
                {formErrors.tax_id && (
                  <p className="text-xs text-red-600">{formErrors.tax_id}</p>
                )}
              </div>

              {/* Teléfono */}
              <div className="space-y-1">
                <label className="ml-1 block text-sm">Teléfono</label>
                <input
                  name="phone"
                  type="tel"
                  value={formValues.phone ?? ""}
                  onChange={setField("phone")}
                  className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                  placeholder="+54 11 1234-5678"
                  disabled={saving}
                />
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="ml-1 block text-sm">Email</label>
                <input
                  name="email"
                  type="email"
                  value={formValues.email ?? ""}
                  onChange={setField("email")}
                  aria-invalid={!!formErrors.email}
                  className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                  placeholder="contacto@agencia.com"
                  disabled={saving}
                />
                {formErrors.email && (
                  <p className="text-xs text-red-600">{formErrors.email}</p>
                )}
              </div>

              {/* Dirección */}
              <div className="space-y-1 md:col-span-2">
                <label className="ml-1 block text-sm">Dirección</label>
                <input
                  name="address"
                  type="text"
                  value={formValues.address ?? ""}
                  onChange={setField("address")}
                  className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                  placeholder="Calle 123, Ciudad"
                  disabled={saving}
                />
              </div>

              {/* Sitio web */}
              <div className="space-y-1">
                <label className="ml-1 block text-sm">Sitio web</label>
                <input
                  name="website"
                  type="url"
                  value={formValues.website ?? ""}
                  onChange={setField("website")}
                  aria-invalid={!!formErrors.website}
                  className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                  placeholder="https://tu-sitio.com"
                  disabled={saving}
                />
                {formErrors.website && (
                  <p className="text-xs text-red-600">{formErrors.website}</p>
                )}
              </div>

              {/* Fundación */}
              <div className="space-y-1">
                <label className="ml-1 block text-sm">Fecha de fundación</label>
                <input
                  name="foundation_date"
                  type="date"
                  value={formValues.foundation_date ?? ""}
                  onChange={setField("foundation_date")}
                  className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                  disabled={saving}
                />
              </div>

              {/* Acciones */}
              <div className="mt-2 flex justify-end gap-2 md:col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpenForm(false);
                    setEditingId(null);
                  }}
                  className="rounded-full bg-white/0 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/10 ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-white/10 dark:text-white"
                >
                  {saving
                    ? "Guardando..."
                    : editingId
                      ? "Guardar cambios"
                      : "Crear"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Lista */}
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/10 p-6">
            {debtState === "all"
              ? "No hay agencias."
              : "No hay agencias para este filtro."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => (
                <div
                  key={a.id_agency}
                  className="space-y-3 rounded-3xl border border-sky-200/30 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur"
                >
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold">{a.name}</h3>
                    <p className="truncate text-sm font-light">
                      {a.legal_name}
                    </p>
                    <p className="text-xs text-sky-950/70 dark:text-white/60">
                      CUIT: <span className="font-medium">{a.tax_id}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-sky-900 dark:text-sky-200">
                      Usuarios: {a.counts?.users ?? "—"}
                    </span>
                    <span className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-sky-900 dark:text-sky-200">
                      Pasajeros: {a.counts?.clients ?? "—"}
                    </span>
                    <span className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-sky-900 dark:text-sky-200">
                      Reservas: {a.counts?.bookings ?? "—"}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {a.billing && a.billing.owner_id !== a.id_agency && (
                      <span className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-sky-900 dark:text-sky-200">
                        Grupo: {a.billing.owner_name}
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-3 py-1 ${
                        getBillingBadge(a.billing?.status).className
                      }`}
                    >
                      {getBillingBadge(a.billing?.status).label}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                        Última conexión
                      </p>
                      <p className="text-xs font-medium">
                        {formatDateTime(a.last_connection_at)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <IconButton
                      title="Editar agencia"
                      onClick={() => openEdit(a.id_agency)}
                      className="border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                    >
                      <PencilIcon />
                    </IconButton>
                    <IconButton
                      title="Ver detalle"
                      onClick={() => goDetail(a.id_agency)}
                      className="border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                    >
                      <EyeIcon />
                    </IconButton>
                    <IconButton
                      title="Eliminar"
                      onClick={() => openDeleteDialog(a)}
                      className="border-red-300/50 bg-red-500/20 text-red-100 dark:text-red-100"
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>

            {/* Ver más */}
            <div className="mt-6 flex justify-center">
              {nextCursor != null ? (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
                >
                  {loadingMore ? "Cargando..." : "Ver más"}
                </button>
              ) : (
                <span className="text-sm text-sky-950/60 dark:text-white/60">
                  No hay más resultados
                </span>
              )}
            </div>
          </>
        )}

        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
            <div className="w-full max-w-md rounded-3xl border border-red-300/30 bg-slate-950/95 p-6 text-white shadow-xl shadow-black/40">
              <h2 className="text-lg font-semibold">Eliminar agencia</h2>
              <p className="mt-2 text-sm text-white/80">
                Se van a eliminar todos los datos relacionados con{" "}
                <span className="font-medium">{deleteTarget.name}</span>.
              </p>
              <p className="mt-3 text-sm text-white/80">
                Para confirmar, escribí <span className="font-semibold">ELIMINAR</span> en el campo de abajo y tocá OK.
              </p>

              <input
                type="text"
                autoFocus
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                placeholder="ELIMINAR"
                className="mt-4 w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-white outline-none placeholder:text-white/40"
                disabled={deletingAgencyId === deleteTarget.id_agency}
              />

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDeleteDialog}
                  disabled={deletingAgencyId === deleteTarget.id_agency}
                  className="rounded-full border border-white/20 px-5 py-2 text-white/90 transition-transform hover:scale-95 active:scale-90 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={
                    !isDeleteConfirmationValid ||
                    deletingAgencyId === deleteTarget.id_agency
                  }
                  className="rounded-full bg-red-600 px-5 py-2 text-white shadow-sm transition-transform hover:scale-95 active:scale-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingAgencyId === deleteTarget.id_agency
                    ? "Eliminando..."
                    : "OK, eliminar"}
                </button>
              </div>
            </div>
          </div>
        )}

        <ToastContainer />
      </section>
    </ProtectedRoute>
  );
}
