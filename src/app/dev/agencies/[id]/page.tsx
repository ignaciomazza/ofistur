// src/app/dev/agencies/[id]/page.tsx
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import UsersAdminCard from "@/components/dev/agencies/UsersAdminCard";
import BillingAdminCard from "@/components/dev/agencies/BillingAdminCard";
import StorageAdminCard from "@/components/dev/agencies/StorageAdminCard";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

type Maybe<T> = T | null | undefined;

type AgencyDetail = {
  id_agency: number;
  name: string;
  legal_name: string;
  address?: Maybe<string>;
  phone?: Maybe<string>;
  email?: Maybe<string>;
  tax_id: string;
  website?: Maybe<string>;
  foundation_date?: Maybe<string | Date>;
  logo_url?: Maybe<string>;
  counts?: {
    users: number;
    clients: number;
    bookings: number;
  };
  // el backend podría incluir meta afip (booleans) si quisieras, pero acá pedimos a la ruta específica
};

type AfipStatus = { certUploaded: boolean; keyUploaded: boolean };

type PresignResponse = {
  method: "PUT";
  uploadUrl: string;
  key: string;
  publicUrl: string;
  headers: Record<string, string>;
};

function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

type SectionKey =
  | "overview"
  | "logo"
  | "afip"
  | "billing"
  | "storage"
  | "users";

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

function ArrowLeftIcon() {
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
        d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
      />
    </svg>
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

export default function DevAgencyDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { token } = useAuth();

  const agencyId = useMemo(() => {
    const n = Number(params?.id);
    return Number.isFinite(n) ? n : null;
  }, [params?.id]);

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [agency, setAgency] = useState<AgencyDetail | null>(null);
  const [activeSection, setActiveSection] =
    useState<SectionKey>("overview");

  // Logo
  const [logoWorking, setLogoWorking] = useState<"upload" | "delete" | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  // AFIP (solo pegado de texto, sin upload de archivos)
  const [afipLoading, setAfipLoading] = useState(true);
  const [afipForbidden, setAfipForbidden] = useState(false);
  const [afipStatus, setAfipStatus] = useState<AfipStatus | null>(null);
  const [savingAfip, setSavingAfip] = useState(false);
  const [deletingAfip, setDeletingAfip] = useState<
    "cert" | "key" | "both" | null
  >(null);
  const [certText, setCertText] = useState("");
  const [keyText, setKeyText] = useState("");
  const [afipExpanded, setAfipExpanded] = useState(false);

  // Carga de agencia
  useEffect(() => {
    if (!token || !agencyId) return;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch(
          `/api/dev/agencies/${agencyId}`,
          { signal: controller.signal },
          token,
        );
        if (res.status === 403) {
          setForbidden(true);
          setAgency(null);
          return;
        }
        if (!res.ok) throw new Error("No se pudo cargar la agencia");
        const data = (await res.json()) as AgencyDetail;
        setAgency(data);
      } catch (e) {
        if ((e as DOMException).name !== "AbortError") {
          console.error(e);
          toast.error("Error cargando la agencia");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, agencyId]);

  // Carga estado AFIP
  useEffect(() => {
    if (!token || !agencyId) return;
    const controller = new AbortController();
    (async () => {
      setAfipLoading(true);
      try {
        const res = await authFetch(
          `/api/dev/agencies/${agencyId}/afip`,
          { signal: controller.signal },
          token,
        );
        if (res.status === 403) {
          setAfipForbidden(true);
          setAfipStatus({ certUploaded: false, keyUploaded: false });
          return;
        }
        if (!res.ok) throw new Error("No se pudo obtener estado AFIP");
        const data = (await res.json()) as AfipStatus;
        setAfipStatus(data);
      } catch (e) {
        if ((e as DOMException).name !== "AbortError") {
          console.error(e);
          toast.error("Error cargando estado AFIP");
        }
      } finally {
        if (!controller.signal.aborted) setAfipLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, agencyId]);

  const goBack = () => router.push("/dev/agencies");
  const goEdit = () => router.push(`/dev/agencies/${agencyId}/edit`);

  // -------- Logo actions (pre-firmado, subida y confirmación) --------
  const ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/svg+xml";
  const MAX_MB = 5;

  function validateFile(f: File) {
    if (!ACCEPT.split(",").includes(f.type)) {
      toast.error("Formato inválido. Usá PNG, JPG, WEBP o SVG.");
      return false;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`El archivo supera ${MAX_MB}MB.`);
      return false;
    }
    return true;
  }

  const onPickFile = () => fileRef.current?.click();

  const onSelectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !agencyId) return;
    if (!validateFile(f)) {
      e.target.value = "";
      return;
    }
    setLogoWorking("upload");
    try {
      // 1) Presign
      const pres = await authFetch(
        `/api/dev/agencies/${agencyId}/logo`,
        {
          method: "POST",
          body: JSON.stringify({ contentType: f.type }),
        },
        token,
      );
      if (pres.status === 403) {
        toast.error("No autorizado");
        return;
      }
      if (!pres.ok) {
        const err = await pres.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo generar URL de subida");
      }
      const { uploadUrl, headers, key, publicUrl } =
        (await pres.json()) as PresignResponse;

      // 2) PUT al bucket
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: headers ?? { "Content-Type": f.type },
        body: f,
      });
      if (!put.ok) throw new Error("Falló la subida al storage");

      // 3) Confirmar en API
      const save = await authFetch(
        `/api/dev/agencies/${agencyId}/logo`,
        {
          method: "PUT",
          body: JSON.stringify({ key, url: publicUrl }),
        },
        token,
      );
      if (!save.ok) {
        const err = await save.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo guardar el logo");
      }
      const updated = await save.json();
      setAgency((prev) =>
        prev ? { ...prev, logo_url: updated.logo_url ?? publicUrl } : prev,
      );
      toast.success("Logo actualizado");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error subiendo logo");
    } finally {
      setLogoWorking(null);
      if (e.target) e.target.value = "";
    }
  };

  const onDeleteLogo = async () => {
    if (!agencyId || !agency?.logo_url) return;
    if (!confirm("¿Eliminar el logo actual de esta agencia?")) return;
    setLogoWorking("delete");
    try {
      const res = await authFetch(
        `/api/dev/agencies/${agencyId}/logo`,
        { method: "DELETE" },
        token,
      );
      if (res.status === 403) {
        toast.error("No autorizado");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo eliminar el logo");
      }
      setAgency((prev) => (prev ? { ...prev, logo_url: null } : prev));
      toast.success("Logo eliminado");
    } catch (err) {
      console.error(err);
      toast.error("Error eliminando logo");
    } finally {
      setLogoWorking(null);
    }
  };

  // -------- AFIP actions (solo pegar texto) --------
  const canSaveAfip =
    !afipLoading &&
    !afipForbidden &&
    (certText.trim().length > 0 || keyText.trim().length > 0);

  const clearAfipLocal = () => {
    setCertText("");
    setKeyText("");
  };

  const saveAfip = async () => {
    if (!agencyId) return;
    if (!certText && !keyText) {
      toast.info("Pegá al menos Cert o Key.");
      return;
    }
    setSavingAfip(true);
    try {
      const res = await authFetch(
        `/api/dev/agencies/${agencyId}/afip`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...(certText ? { cert: certText } : {}),
            ...(keyText ? { key: keyText } : {}),
          }),
        },
        token,
      );
      if (res.status === 403) {
        setAfipForbidden(true);
        toast.error("No autorizado");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Error guardando credenciales");
      }
      const data = (await res.json()) as AfipStatus;
      setAfipStatus(data);
      clearAfipLocal();
      toast.success("Credenciales AFIP actualizadas");
    } catch (e) {
      console.error(e);
      toast.error("Error guardando AFIP");
    } finally {
      setSavingAfip(false);
    }
  };

  const deleteAfip = async (type: "cert" | "key" | "both") => {
    if (!agencyId) return;
    setDeletingAfip(type);
    try {
      const qs = type === "both" ? "" : `?type=${type}`;
      const res = await authFetch(
        `/api/dev/agencies/${agencyId}/afip${qs}`,
        { method: "DELETE" },
        token,
      );
      if (res.status === 403) {
        setAfipForbidden(true);
        toast.error("No autorizado");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Error eliminando credenciales");
      }
      const data = (await res.json()) as AfipStatus;
      setAfipStatus(data);
      if (type !== "both") {
        if (type === "cert") setCertText("");
        if (type === "key") setKeyText("");
      } else {
        clearAfipLocal();
      }
      toast.success(
        type === "both" ? "Cert y Key eliminados" : `Se eliminó ${type}`,
      );
    } catch (e) {
      console.error(e);
      toast.error("Error eliminando AFIP");
    } finally {
      setDeletingAfip(null);
    }
  };

  // -------- Borrar agencia --------
  const deletingAgencyRef = useRef(false);
  const onDeleteAgency = async () => {
    if (!agencyId || deletingAgencyRef.current) return;
    const confirmation = window.prompt(
      'Para eliminar definitivamente esta agencia, escribí "ELIMINAR".',
    );
    if (!confirmation || confirmation.trim().toUpperCase() !== "ELIMINAR") {
      toast.info('Eliminación cancelada. Debés escribir "ELIMINAR".');
      return;
    }
    deletingAgencyRef.current = true;
    try {
      const res = await authFetch(
        `/api/dev/agencies/${agencyId}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            confirmationText: confirmation.trim(),
          }),
        },
        token,
      );
      if (res.status === 403) {
        toast.error("No autorizado");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo eliminar la agencia");
      }
      toast.success("Agencia eliminada");
      router.push("/dev/agencies");
    } catch (e) {
      console.error(e);
      toast.error("Error eliminando agencia");
    } finally {
      deletingAgencyRef.current = false;
    }
  };

  // -------- Render --------
  return (
    <ProtectedRoute>
      <section className="text-sky-950 dark:text-white">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-full border border-sky-300/40 bg-sky-100/20 px-4 py-2 text-sky-900 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-sky-200"
            >
              <ArrowLeftIcon />
              Volver
            </button>
            <h1 className="text-2xl font-semibold">Detalle de agencia</h1>
          </div>

          <div className="flex items-center gap-2">
            <IconButton
              title="Editar agencia"
              onClick={goEdit}
              className="border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200"
            >
              <PencilIcon />
            </IconButton>
            <IconButton
              title="Eliminar agencia"
              onClick={onDeleteAgency}
              className="border-red-300/50 bg-red-500/20 text-red-100"
            >
              <TrashIcon />
            </IconButton>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {([
            { key: "overview", label: "Resumen, Logo y Certificados" },
            { key: "billing", label: "Facturacion" },
            { key: "storage", label: "Storage" },
            { key: "users", label: "Usuarios" },
          ] as { key: SectionKey; label: string }[]).map((tab) => {
            const active = activeSection === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveSection(tab.key)}
                className={`rounded-full border px-4 py-1.5 text-xs shadow-sm transition-transform hover:scale-95 active:scale-90 ${
                  active
                    ? "border-sky-300/50 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                    : "border-white/10 bg-white/10 text-sky-950/70 hover:border-sky-300/40 hover:bg-sky-100/20 dark:text-white/70"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {forbidden && (
          <p className="mb-4 text-sm text-sky-950/70 dark:text-white/70">
            No tenés permisos para ver esta agencia.
          </p>
        )}

        {loading ? (
          <Spinner />
        ) : !agency ? (
          <div className="rounded-3xl border border-white/10 bg-white/10 p-6">
            No se encontró la agencia.
          </div>
        ) : (
          <>
            {/* Header + resumen */}
            <div className="mb-6 flex items-center gap-4">
              <div className="size-16 overflow-hidden rounded-2xl border border-white/10 bg-white/10 p-1 shadow-sm backdrop-blur">
                {agency.logo_url ? (
                  <img
                    src={agency.logo_url}
                    alt="Logo de la agencia"
                    className="size-full object-contain"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-sky-950/40 dark:text-white/40">
                    {/* icon placeholder */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="size-6"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      fill="none"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 8.25A2.25 2.25 0 015.25 6h13.5A2.25 2.25 0 0121 8.25v7.5A2.25 2.25 0 0118.75 18H5.25A2.25 2.25 0 013 15.75v-7.5z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 9l6.75 4.5c.69.46 1.56.46 2.25 0L21 9"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <div>
                <h2 className="text-xl font-semibold">{agency.name}</h2>
                <p className="text-sm font-light">{agency.legal_name}</p>
                <p className="text-xs text-sky-950/70 dark:text-white/60">
                  CUIT: <span className="font-medium">{agency.tax_id}</span>
                </p>
              </div>
            </div>

            {activeSection === "overview" && (
              <div className="space-y-6">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-sky-900 dark:text-sky-200">
                    Usuarios: {agency.counts?.users ?? "—"}
                  </span>
                  <span className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-sky-900 dark:text-sky-200">
                    Pasajeros: {agency.counts?.clients ?? "—"}
                  </span>
                  <span className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-sky-900 dark:text-sky-200">
                    Reservas: {agency.counts?.bookings ?? "—"}
                  </span>
                </div>

                <div className="space-y-3 rounded-3xl border border-sky-300/30 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur">
                  <p className="font-light">
                    <span className="mr-2 font-semibold dark:font-medium">
                      Dirección
                    </span>
                    {agency.address?.trim() || "—"}
                  </p>
                  <p className="font-light">
                    <span className="mr-2 font-semibold dark:font-medium">
                      Teléfono
                    </span>
                    {agency.phone?.trim() || "—"}
                  </p>
                  <p className="font-light">
                    <span className="mr-2 font-semibold dark:font-medium">
                      Email
                    </span>
                    {agency.email ? (
                      <a
                        href={`mailto:${agency.email}`}
                        className="underline decoration-sky-300/60 underline-offset-4"
                      >
                        {agency.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </p>
                  <p className="font-light">
                    <span className="mr-2 font-semibold dark:font-medium">
                      Sitio Web
                    </span>
                    {agency.website ? (
                      <a
                        href={agency.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-sky-300/60 underline-offset-4"
                      >
                        {agency.website}
                      </a>
                    ) : (
                      "—"
                    )}
                  </p>
                  <p className="font-light">
                    <span className="mr-2 font-semibold dark:font-medium">
                      Fundación
                    </span>
                    {formatDate(agency.foundation_date)}
                  </p>
                </div>
              </div>
            )}

            {activeSection === "overview" && (
              <div className="mb-6 mt-8 space-y-4 rounded-3xl border border-sky-300/30 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium">Logo</h3>
                  <span className="text-xs text-sky-950/60 dark:text-white/60">
                    PNG / JPG / WEBP / SVG – máx 5MB
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="size-24 overflow-hidden rounded-2xl border border-sky-300/30 bg-white/40 dark:bg-white/10">
                    {agency.logo_url ? (
                      <img
                        src={agency.logo_url}
                        alt="Logo de la agencia"
                        className="size-full object-contain"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-sky-950/60 dark:text-white/60">
                        Sin logo
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={fileRef}
                      type="file"
                      accept={ACCEPT}
                      onChange={onSelectFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={onPickFile}
                      disabled={logoWorking !== null}
                      className="rounded-full border border-sky-300/40 bg-sky-100/20 px-6 py-2 text-sky-900 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 disabled:opacity-50 dark:text-sky-200"
                    >
                      {logoWorking === "upload"
                        ? "Subiendo..."
                        : agency.logo_url
                          ? "Reemplazar logo"
                          : "Subir logo"}
                    </button>

                    {agency.logo_url && (
                      <button
                        type="button"
                        onClick={onDeleteLogo}
                        disabled={logoWorking !== null}
                        className="rounded-full bg-red-600/90 px-6 py-2 text-red-50 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-50 dark:bg-red-800"
                      >
                        {logoWorking === "delete"
                          ? "Eliminando..."
                          : "Eliminar logo"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === "overview" && (
              <div className="mt-8 space-y-4 rounded-3xl border border-sky-300/30 bg-white/10 p-6 shadow-md shadow-sky-950/10 backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setAfipExpanded((prev) => !prev)}
                    className="inline-flex items-center gap-2 rounded-full bg-white/0 px-3 py-1.5 text-sm text-sky-950 shadow-sm ring-1 ring-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-white dark:ring-white/10"
                  >
                    <span className="text-lg leading-none">
                      {afipExpanded ? "-" : "+"}
                    </span>
                    AFIP – Certificado & Clave
                  </button>

                  {!afipLoading && afipStatus && (
                    <div className="flex gap-2">
                      <span
                        className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-xs text-sky-900 dark:text-sky-200"
                        title="Estado del Certificado"
                      >
                        Cert: {afipStatus.certUploaded ? "Cargado" : "Falta"}
                      </span>
                      <span
                        className="rounded-full border border-sky-300/40 bg-sky-100/20 px-3 py-1 text-xs text-sky-900 dark:text-sky-200"
                        title="Estado de la Clave"
                      >
                        Key: {afipStatus.keyUploaded ? "Cargada" : "Falta"}
                      </span>
                    </div>
                  )}
                </div>

                {afipExpanded && (
                  <>
                    {afipForbidden && (
                      <p className="text-sm text-sky-950/70 dark:text-white/70">
                        No tenés permisos para editar estas credenciales.
                      </p>
                    )}

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="ml-1 block text-sm">
                          Certificado (.pem/.crt) — pegá el contenido
                        </label>
                        <textarea
                          disabled={afipLoading || afipForbidden}
                          value={certText}
                          onChange={(e) => setCertText(e.target.value)}
                          placeholder="-----BEGIN CERTIFICATE-----\nMIIC...==\n-----END CERTIFICATE-----"
                          className="min-h-[120px] w-full rounded-2xl border border-sky-950/10 bg-white/50 p-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                        />
                        {afipStatus?.certUploaded && (
                          <button
                            type="button"
                            onClick={() => deleteAfip("cert")}
                            disabled={
                              afipLoading ||
                              deletingAfip === "cert" ||
                              afipForbidden
                            }
                            className="rounded-full bg-red-600/90 px-4 py-2 text-red-50 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                          >
                            {deletingAfip === "cert"
                              ? "Eliminando..."
                              : "Eliminar Cert"}
                          </button>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="ml-1 block text-sm">
                          Clave privada (.key/.pem) — pegá el contenido
                        </label>
                        <textarea
                          disabled={afipLoading || afipForbidden}
                          value={keyText}
                          onChange={(e) => setKeyText(e.target.value)}
                          placeholder="-----BEGIN PRIVATE KEY-----\nMIIE...==\n-----END PRIVATE KEY-----"
                          className="min-h-[120px] w-full rounded-2xl border border-sky-950/10 bg-white/50 p-3 outline-none backdrop-blur placeholder:font-light placeholder:tracking-wide dark:border-white/10 dark:bg-white/10 dark:text-white"
                        />
                        {afipStatus?.keyUploaded && (
                          <button
                            type="button"
                            onClick={() => deleteAfip("key")}
                            disabled={
                              afipLoading || deletingAfip === "key" || afipForbidden
                            }
                            className="rounded-full bg-red-600/90 px-4 py-2 text-red-50 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                          >
                            {deletingAfip === "key"
                              ? "Eliminando..."
                              : "Eliminar Key"}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={saveAfip}
                        disabled={!canSaveAfip || savingAfip}
                        className={`rounded-full px-6 py-2 shadow-sm transition-transform hover:scale-95 active:scale-90 ${
                          canSaveAfip
                            ? "border border-sky-300/40 bg-sky-100/20 text-sky-900 dark:text-sky-200"
                            : "bg-gray-300 text-gray-500 dark:bg-white/10 dark:text-white/40"
                        }`}
                      >
                        {savingAfip ? "Guardando..." : "Guardar credenciales"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCertText("");
                          setKeyText("");
                        }}
                        disabled={afipLoading || afipForbidden}
                        className="rounded-full border border-sky-300/40 bg-sky-100/20 px-6 py-2 text-sky-900 shadow-sm shadow-sky-950/10 transition-transform hover:scale-95 active:scale-90 dark:text-sky-200"
                      >
                        Limpiar campos
                      </button>

                      {(afipStatus?.certUploaded || afipStatus?.keyUploaded) && (
                        <button
                          type="button"
                          onClick={() => deleteAfip("both")}
                          disabled={
                            afipLoading ||
                            deletingAfip === "both" ||
                            afipForbidden
                          }
                          className="rounded-full bg-red-600/90 px-6 py-2 text-red-50 shadow-sm shadow-red-950/20 transition-transform hover:scale-95 active:scale-90 dark:bg-red-800"
                        >
                          {deletingAfip === "both"
                            ? "Eliminando..."
                            : "Eliminar Cert & Key"}
                        </button>
                      )}
                    </div>

                    <p className="mt-2 text-xs text-sky-950/70 dark:text-white/60">
                      Las credenciales se almacenan cifradas y nunca se devuelven
                      por la API. Pegá el contenido en texto plano (PEM/CRT/KEY) o
                      base64.
                    </p>
                  </>
                )}
              </div>
            )}

            {activeSection === "billing" && agencyId && (
              <div className="mt-6">
                <BillingAdminCard agencyId={agencyId} />
              </div>
            )}
            {activeSection === "storage" && agencyId && (
              <div className="mt-6">
                <StorageAdminCard agencyId={agencyId} />
              </div>
            )}
            {activeSection === "users" && agencyId && (
              <div className="mt-6">
                <UsersAdminCard agencyId={agencyId} />
              </div>
            )}
          </>
        )}

        <ToastContainer />
      </section>
    </ProtectedRoute>
  );
}
