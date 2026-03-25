// src/app/dev/agencies/leads/page.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

type Maybe<T> = T | null | undefined;

type DevLead = {
  id_lead: number;
  created_at: string | Date;
  full_name: string;
  agency_name: string;
  role: string;
  team_size?: Maybe<string>;
  location?: Maybe<string>;
  email: string;
  whatsapp?: Maybe<string>;
  message?: Maybe<string>;
  status: string; // "PENDING" | "CONTACTED" | "CLOSED" | etc
  contacted_at?: Maybe<string | Date>;
  source?: Maybe<string>;
};

type LeadListResponse = {
  items: DevLead[];
  nextCursor: number | null;
};

const STATUSES = ["PENDING", "CONTACTED", "CLOSED"] as const;
type Status = (typeof STATUSES)[number];

function isKnownStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s);
}

function formatDateTime(value?: string | Date | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mi}hs`;
}

function statusChipStyle(status: string) {
  const s = status.toUpperCase();
  if (s === "PENDING")
    return "bg-sky-100 text-sky-900 border border-sky-300/80";
  if (s === "CONTACTED")
    return "bg-sky-100 text-sky-900 border border-sky-300/80";
  if (s === "CLOSED")
    return "bg-sky-50/70 text-sky-900 border border-sky-300/50";
  return "bg-slate-100 text-slate-900 border border-slate-300/80";
}

export default function DevLeadsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<DevLead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [forbidden, setForbidden] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
        const res = await authFetch(
          `/api/leads?${qs.toString()}`,
          { signal: controller.signal },
          token,
        );
        if (res.status === 403) {
          setForbidden(true);
          setItems([]);
          setNextCursor(null);
          return;
        }
        if (!res.ok) throw new Error("No se pudo cargar leads");
        const data = (await res.json()) as LeadListResponse;
        setItems(data.items);
        setNextCursor(data.nextCursor);
      } catch (err) {
        if ((err as DOMException)?.name !== "AbortError") {
          console.error(err);
          toast.error("Error cargando leads");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  const loadMore = async () => {
    if (!token || nextCursor == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        cursor: String(nextCursor),
      });
      const res = await authFetch(`/api/leads?${qs.toString()}`, {}, token);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          (errJson as { error?: string }).error ||
            "No se pudo cargar más leads",
        );
      }
      const data = (await res.json()) as LeadListResponse;
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      console.error(err);
      toast.error("Error al cargar más");
    } finally {
      setLoadingMore(false);
    }
  };

  const updateStatus = async (id_lead: number, status: string) => {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/leads/${id_lead}`,
        { method: "PUT", body: JSON.stringify({ status }) },
        token,
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          (errJson as { error?: string }).error ||
            "No se pudo actualizar el estado",
        );
      }
      setItems((prev) =>
        prev.map((l) => (l.id_lead === id_lead ? { ...l, status } : l)),
      );
      toast.success("Estado actualizado");
    } catch (err) {
      console.error(err);
      toast.error("Error actualizando estado");
    }
  };

  const deleteLead = async (id_lead: number) => {
    if (!token) return;
    if (!confirm("¿Eliminar este lead definitivamente?")) return;
    try {
      const res = await authFetch(
        `/api/leads/${id_lead}`,
        { method: "DELETE" },
        token,
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          (errJson as { error?: string }).error || "No se pudo eliminar",
        );
      }
      setItems((prev) => prev.filter((l) => l.id_lead !== id_lead));
      toast.success("Lead eliminado");
    } catch (err) {
      console.error(err);
      toast.error("Error eliminando lead");
    }
  };

  type ConvertPayload = {
    existing_agency_id?: number;
    agency_tax_id?: string;
    user_password?: string;
  };

  const convertLead = async (id_lead: number, payload: ConvertPayload) => {
    if (!token) return;
    try {
      const res = await authFetch(
        `/api/leads/${id_lead}`,
        {
          method: "POST",
          body: JSON.stringify({ action: "convert", ...payload }),
        },
        token,
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          (errJson as { error?: string }).error ||
            "No se pudo convertir el lead",
        );
      }
      const data = (await res.json()) as {
        ok: boolean;
        id_agency?: number | null;
        id_user?: number;
        temp_password?: string;
        reused_user?: boolean;
      };

      // actualizar estado local a CLOSED
      setItems((prev) =>
        prev.map((l) =>
          l.id_lead === id_lead ? { ...l, status: "CLOSED" } : l,
        ),
      );

      let msg = "Lead convertido correctamente";
      if (data.reused_user) msg += " (usuario existente reutilizado)";
      if (data.temp_password)
        msg += ` — Password temporal: ${data.temp_password}`;
      toast.success(msg);
    } catch (err) {
      console.error(err);
      toast.error("Error convirtiendo lead");
    }
  };

  const emptyMsg = useMemo(() => {
    if (forbidden) return "No tenés permisos para ver leads.";
    return "Todavía no hay leads.";
  }, [forbidden]);

  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Leads (Dev)</h1>
          <p className="text-sm text-sky-950/70 dark:text-white/70">
            Contactos que dejaron sus datos en la landing.
          </p>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur">
            {emptyMsg}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((lead) => (
                <LeadCard
                  key={lead.id_lead}
                  lead={lead}
                  onStatusChange={updateStatus}
                  onDelete={deleteLead}
                  onConvert={convertLead}
                />
              ))}
            </div>

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

        <ToastContainer />
      </section>
    </ProtectedRoute>
  );
}

/* === Card === */
function LeadCard({
  lead,
  onStatusChange,
  onDelete,
  onConvert,
}: {
  lead: DevLead;
  onStatusChange: (id_lead: number, status: string) => void;
  onDelete: (id_lead: number) => void;
  onConvert: (
    id_lead: number,
    payload: {
      existing_agency_id?: number;
      agency_tax_id?: string;
      user_password?: string;
    },
  ) => void;
}) {
  const [savingStatus, setSavingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // conversion UI
  const [openConvert, setOpenConvert] = useState(false);
  const [existingAgencyId, setExistingAgencyId] = useState<string>("");
  const [agencyTaxId, setAgencyTaxId] = useState<string>("");
  const [userPassword, setUserPassword] = useState<string>("");
  const [converting, setConverting] = useState(false);

  const handleStatusChange = async (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const newStatus = e.target.value;
    setSavingStatus(true);
    try {
      await onStatusChange(lead.id_lead, newStatus);
    } finally {
      setSavingStatus(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(lead.id_lead);
    } finally {
      setDeleting(false);
    }
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    // validación mínima: si no hay agencyId existente, exigir CUIT
    if (!existingAgencyId.trim() && !agencyTaxId.trim()) {
      toast.info("Completá CUIT o ID de una agencia existente.");
      return;
    }
    setConverting(true);
    try {
      await onConvert(lead.id_lead, {
        existing_agency_id: existingAgencyId.trim()
          ? Number(existingAgencyId)
          : undefined,
        agency_tax_id: agencyTaxId.trim() || undefined,
        user_password: userPassword.trim() || undefined,
      });
      setOpenConvert(false);
      setExistingAgencyId("");
      setAgencyTaxId("");
      setUserPassword("");
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-sky-950 dark:text-white">
            {lead.full_name || "Sin nombre"}
          </h2>
          <p className="truncate text-xs font-light text-sky-950/70 dark:text-white/60">
            {lead.agency_name || "—"}
          </p>
          <p className="text-[11px] text-sky-950/50 dark:text-white/40">
            {formatDateTime(lead.created_at)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusChipStyle(
              lead.status,
            )}`}
          >
            {lead.status || "—"}
          </span>

          <label className="text-[10px] text-sky-950/50 dark:text-white/40">
            Estado
            <select
              disabled={savingStatus}
              defaultValue={lead.status}
              onChange={handleStatusChange}
              className="ml-2 cursor-pointer rounded-full border border-sky-950/10 bg-white/50 px-2 py-1 text-[11px] text-sky-950 outline-none backdrop-blur focus:border-sky-950/30 focus:ring-1 focus:ring-sky-950/30 disabled:opacity-50 dark:border-white/10 dark:bg-white/10 dark:text-white"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {!isKnownStatus(lead.status) && (
                <option value={lead.status}>{lead.status}</option>
              )}
            </select>
          </label>
        </div>
      </div>

      {/* Info */}
      <div className="grid grid-cols-2 gap-3 text-sm text-sky-950 dark:text-white">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
            Rol
          </p>
          <p className="font-medium">{lead.role || "—"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
            Equipo
          </p>
          <p className="font-medium">{lead.team_size || "—"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
            Ubicación
          </p>
          <p className="font-medium">{lead.location || "—"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
            Email
          </p>
          {lead.email ? (
            <a
              href={`mailto:${lead.email}`}
              className="break-all font-medium underline decoration-sky-300/60 underline-offset-4"
            >
              {lead.email}
            </a>
          ) : (
            <p className="font-medium">—</p>
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
            WhatsApp
          </p>
          {lead.whatsapp ? (
            <a
              href={`https://wa.me/${lead.whatsapp.replace(/\D/g, "").trim()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline decoration-sky-300/60 underline-offset-4"
            >
              {lead.whatsapp}
            </a>
          ) : (
            <p className="font-medium">—</p>
          )}
        </div>
      </div>

      {/* Mensaje */}
      <div className="rounded-2xl border border-white/20 bg-white/30 p-4 text-[13px] leading-relaxed text-sky-950 shadow-sm shadow-sky-950/10 dark:border-white/10 dark:bg-white/10 dark:text-white/90">
        {lead.message?.trim() || (
          <span className="text-sky-950/60 dark:text-white/60">
            (Sin mensaje)
          </span>
        )}
      </div>

      {/* Acciones */}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button
          onClick={() => setOpenConvert((v) => !v)}
          className="rounded-full border border-sky-300/50 bg-sky-50/70 px-4 py-2 text-xs text-sky-900 shadow-sm shadow-sky-950/5 transition-transform hover:scale-95 active:scale-90"
        >
          {openConvert ? "Cancelar" : "Convertir a agencia"}
        </button>

        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-full border border-red-300/90 bg-red-200/70 px-4 py-2 text-xs text-red-900 shadow-sm shadow-red-950/5 transition-transform hover:scale-95 active:scale-90"
        >
          {deleting ? "Eliminando..." : "Eliminar"}
        </button>
      </div>

      {/* Convert form */}
      {openConvert && (
        <form
          onSubmit={handleConvert}
          className="space-y-3 rounded-2xl border border-white/10 bg-white/20 p-4 text-sm shadow-sm dark:border-white/10 dark:bg-white/10"
        >
          <p className="text-xs text-sky-950/70 dark:text-white/70">
            Indicá <b>ID de una agencia existente</b> para vincular,
            <br className="hidden sm:block" />o bien el <b>CUIT</b> para crear
            una nueva con el nombre <i>{lead.agency_name || "Agencia"}</i>.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                ID agencia existente (opcional)
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={existingAgencyId}
                onChange={(e) => setExistingAgencyId(e.target.value)}
                placeholder="123"
                className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light dark:border-white/10 dark:bg-white/10 dark:text-white"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
                CUIT (si vas a crear una agencia)
              </span>
              <input
                type="text"
                value={agencyTaxId}
                onChange={(e) =>
                  setAgencyTaxId(e.target.value.replace(/\D/g, ""))
                }
                placeholder="20123456789"
                disabled={!!existingAgencyId.trim()}
                className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light disabled:opacity-60 dark:border-white/10 dark:bg-white/10 dark:text-white"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-sky-950/60 dark:text-white/60">
              Contraseña temporal (opcional)
            </span>
            <input
              type="text"
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
              placeholder="(la genero si la dejás en blanco)"
              className="w-full rounded-2xl border border-sky-950/10 bg-white/50 px-3 py-2 outline-none backdrop-blur placeholder:font-light dark:border-white/10 dark:bg-white/10 dark:text-white"
            />
          </label>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={converting}
              className="rounded-full border border-sky-300/50 bg-sky-50/70 px-5 py-2 text-sky-900 shadow-sm shadow-sky-950/5 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60"
            >
              {converting ? "Convirtiendo..." : "Confirmar conversión"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const PAGE_SIZE = 12;
