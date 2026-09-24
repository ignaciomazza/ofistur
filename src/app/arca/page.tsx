// src/app/arca/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

type ArcaConfig = {
  taxIdRepresentado: string;
  taxIdLogin: string;
  alias: string;
  authorizedServices: string[];
  salesPointsDetected: number[];
  selectedSalesPoint: number | null;
  status: string;
  lastError: string | null;
  lastOkAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasCert: boolean;
  hasKey: boolean;
  taxRegime?: "mono" | "ri" | null;
  observedTaxRegime?: "mono" | "ri" | null;
  taxRegimeCheckedAt?: string | null;
};

type ArcaJob = {
  id: number;
  status: string;
  step: string;
  services: string[];
  currentServiceIndex: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type ArcaStatusPayload = {
  config: ArcaConfig | null;
  activeJob: ArcaJob | null;
  secretsKeyValid?: boolean;
  secretsKeyError?: string | null;
};

const AVAILABLE_SERVICES = [
  {
    id: "wsfe",
    label: "WSFE (Facturación electrónica)",
    required: true,
  },
  {
    id: "ws_sr_constancia_inscripcion",
    label: "Constancia de inscripción (régimen fiscal)",
    required: true,
  },
  {
    id: "ws_sr_padron_a13",
    label: "Padrón A13 (consulta por DNI/CUIT)",
    required: false,
  },
] as const;

function Tooltip({ label, text }: { label: string; text: string }) {
  return (
    <span
      className="ml-2 cursor-help rounded-full border border-sky-950/20 px-2 py-0.5 text-[11px] text-sky-950/70 dark:border-white/15 dark:text-white/70"
      title={text}
    >
      {label}
    </span>
  );
}

function formatCuit(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return value;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sanitizeAlias(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "");
}

function normalizeServices(services: string[]): string[] {
  const allowed = new Set(AVAILABLE_SERVICES.map((s) => s.id));
  const set = new Set(
    (services || [])
      .map((s) => s.trim().toLowerCase())
      .filter((s) => allowed.has(s as (typeof AVAILABLE_SERVICES)[number]["id"])),
  );
  set.add("wsfe");
  set.add("ws_sr_constancia_inscripcion");
  return Array.from(set);
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function secureFetch(
  input: string,
  init: RequestInit,
  token: string | null,
) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(input, { ...init, headers, credentials: "include" });
}

export default function ArcaPage() {
  const { token } = useAuth();

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<ArcaConfig | null>(null);
  const [job, setJob] = useState<ArcaJob | null>(null);
  const [secretsKeyValid, setSecretsKeyValid] = useState<boolean | null>(null);
  const [secretsKeyError, setSecretsKeyError] = useState<string | null>(null);
  const [salesPointChoice, setSalesPointChoice] = useState<string>("");

  const [step, setStep] = useState(1);
  const [missingPv, setMissingPv] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    null | "connect" | "rotate"
  >(null);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumePassword, setResumePassword] = useState("");
  const [resumeRegime, setResumeRegime] = useState<"" | "mono" | "ri">("");
  const [aliasHadInvalid, setAliasHadInvalid] = useState(false);

  const [form, setForm] = useState({
    cuitRepresentado: "",
    cuitLogin: "",
    password: "",
    alias: "",
    services: ["wsfe", "ws_sr_constancia_inscripcion"],
  });

  const prefillingRef = useRef(false);
  const providerBlocked = job?.status === "blocked_provider" ||
    Boolean(job?.lastError && /l[ií]mite.{0,30}cuit/i.test(job.lastError));

  const statusLabel = useMemo(() => {
    if (job && ["pending", "running", "waiting"].includes(job.status))
      return "Conectando";
    if (providerBlocked) return "Cupo agotado";
    if (job?.status === "requires_action") return "Requiere acción";
    if (job?.status === "error") return config?.status === "connected" ? "Conexión anterior activa" : "Error";
    if (config?.status === "connected") return "Conectado";
    if (config?.status === "disconnected") return "Desconectado";
    if (config?.status === "error") return "Error";
    return "Sin conexión";
  }, [config, job, providerBlocked]);

  const statusTone = useMemo(() => {
    if (statusLabel === "Conectado")
      return "border border-emerald-700/60 bg-emerald-200/50 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/20 dark:text-emerald-100";
    if (statusLabel === "Conectando")
      return "border border-sky-700/60 bg-sky-200/50 text-sky-900 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-sky-100";
    if (statusLabel === "Requiere acción")
      return "border border-amber-700/60 bg-amber-200/50 text-amber-900 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-100";
    if (statusLabel === "Cupo agotado")
      return "border border-amber-700/60 bg-amber-200/50 text-amber-900 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-100";
    if (statusLabel === "Error")
      return "border border-rose-700/60 bg-rose-200/50 text-rose-900 dark:border-rose-400/50 dark:bg-rose-500/20 dark:text-rose-100";
    if (statusLabel === "Conexión anterior activa")
      return "border border-amber-700/60 bg-amber-200/50 text-amber-900 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-100";
    return "border border-slate-700/30 bg-white/60 text-slate-800 dark:border-white/10 dark:bg-white/10 dark:text-white/70";
  }, [statusLabel]);

  const cuitDigits = form.cuitRepresentado.replace(/\D/g, "");
  const hasValidCuit = cuitDigits.length === 11;
  const changingIssuer = Boolean(config?.taxIdRepresentado && hasValidCuit &&
    config.taxIdRepresentado.replace(/\D/g, "") !== cuitDigits);
  const aliasReady = form.alias.trim().length > 0 || hasValidCuit;
  const aliasNeedsCuit = !form.alias.trim() && !hasValidCuit;

  const canAdvanceStep1 =
    hasValidCuit &&
    form.cuitLogin.replace(/\D/g, "").length === 11 &&
    form.password.trim().length > 0;

  const isJobActive = Boolean(
    job && ["pending", "running", "waiting"].includes(job.status),
  );
  const isBusy = actionLoading !== null || testing || resuming || disconnecting;
  const isConnecting = actionLoading === "connect";
  const isRotating = actionLoading === "rotate";
  const inputsDisabled = isJobActive || isBusy;
  const canConnect =
    canAdvanceStep1 &&
    form.services.length > 0 &&
    !isJobActive &&
    !isBusy &&
    aliasReady;

  const showPvHelp =
    missingPv ||
    (config?.lastError ?? "").toLowerCase().includes("punto de venta");
  const salesPointsList = config?.salesPointsDetected ?? [];

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    (async () => {
      const res = await secureFetch("/api/arca", { method: "GET" }, token);
      const data = await safeJson<ArcaStatusPayload>(res);
      if (!active) return;
      if (res.ok && data) {
        setConfig(data.config);
        setJob(data.activeJob);
        if (data.activeJob) setStep(3);
        setSecretsKeyValid(
          typeof data.secretsKeyValid === "boolean"
            ? data.secretsKeyValid
            : null,
        );
        setSecretsKeyError(data.secretsKeyError ?? null);
        setMissingPv(false);
      } else if (!res.ok) {
        toast.error(data?.config ? "No se pudo cargar ARCA." : "Error ARCA");
        setSecretsKeyValid(null);
        setSecretsKeyError(null);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!config || prefillingRef.current) return;
    prefillingRef.current = true;
    setForm((prev) => ({
      ...prev,
      cuitRepresentado: config.taxIdRepresentado || prev.cuitRepresentado,
      cuitLogin: config.taxIdLogin || prev.cuitLogin,
      alias: sanitizeAlias(config.alias || prev.alias),
      services: normalizeServices(config.authorizedServices ?? prev.services),
    }));
    setAliasHadInvalid(false);
  }, [config]);

  useEffect(() => {
    if (!config) return;
    if (config.selectedSalesPoint != null) {
      setSalesPointChoice(String(config.selectedSalesPoint));
    } else if (!config.salesPointsDetected?.length) {
      setSalesPointChoice("");
    }
  }, [config]);

  useEffect(() => {
    if (!job || !token) return;
    if (
      !["pending", "running", "waiting", "requires_action", "blocked_provider"].includes(job.status)
    )
      return;

    const interval = setInterval(async () => {
      const res = await secureFetch(
        `/api/arca/connect/${job.id}`,
        { method: "GET" },
        token,
      );
      const data = await safeJson<{ job: ArcaJob | null }>(res);
      if (res.ok && data?.job) {
        setJob(data.job);
        if (["completed", "error"].includes(data.job.status)) {
          const st = await secureFetch("/api/arca", { method: "GET" }, token);
          const payload = await safeJson<ArcaStatusPayload>(st);
          if (st.ok && payload) {
            setConfig(payload.config);
            if (data.job.status === "completed") setJob(payload.activeJob);
          }
          if (data.job.status === "error") {
            toast.error("Falló la conexión con ARCA. Revisá el detalle del error.");
          }
        }
      }
    }, 3500);

    return () => clearInterval(interval);
  }, [job, token]);

  const handleConnect = async (action: "connect" | "rotate") => {
    if (!token) return;
    if (!canConnect) {
      toast.error("Completá los datos obligatorios.");
      return;
    }
    setActionLoading(action);
    try {
      const res = await secureFetch(
        action === "connect" ? "/api/arca/connect" : "/api/arca/rotate",
        {
          method: "POST",
          body: JSON.stringify({
            cuitRepresentado: form.cuitRepresentado,
            cuitLogin: form.cuitLogin,
            password: form.password,
            alias: form.alias || undefined,
            services: form.services,
          }),
        },
        token,
      );
      const data = await safeJson<{ job?: ArcaJob; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo iniciar la conexión");
      }
      setJob(data?.job ?? null);
      setStep(3);
      if (data?.job?.status === "error" || data?.job?.status === "completed") {
        const st = await secureFetch("/api/arca", { method: "GET" }, token);
        const payload = await safeJson<ArcaStatusPayload>(st);
        if (st.ok && payload) setConfig(payload.config);
      }
      if (data?.job?.status === "error") {
        setMissingPv(false);
        toast.error("Falló la conexión con ARCA. Revisá el detalle del error.");
      } else if (data?.job?.status === "completed") {
        toast.success("Conexión ARCA completada.");
      } else {
        toast.info("Conexión ARCA iniciada.");
      }
      setForm((prev) => ({ ...prev, password: "" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al conectar";
      toast.error(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const toggleService = (serviceId: string) => {
    if (serviceId === "wsfe" || serviceId === "ws_sr_constancia_inscripcion") return;
    setForm((prev) => {
      const exists = prev.services.includes(serviceId);
      const next = exists
        ? prev.services.filter((s) => s !== serviceId)
        : [...prev.services, serviceId];
      return { ...prev, services: normalizeServices(next) };
    });
  };

  const handleTest = async (selected?: number | null) => {
    if (!token) return;
    setTesting(true);
    try {
      const body =
        selected != null
          ? JSON.stringify({ selectedSalesPoint: selected })
          : undefined;
      const res = await secureFetch(
        "/api/arca/test",
        { method: "POST", ...(body ? { body } : {}) },
        token,
      );
      const data = await safeJson<{
        ok?: boolean;
        missingSalesPoint?: boolean;
        salesPoints?: number[];
        selectedSalesPoint?: number | null;
        selectionValid?: boolean | null;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo probar ARCA");
      }
      setMissingPv(Boolean(data?.missingSalesPoint));
      if (Array.isArray(data?.salesPoints)) {
        setConfig((prev) =>
          prev
            ? {
                ...prev,
                salesPointsDetected: data.salesPoints ?? [],
                selectedSalesPoint:
                  data.selectedSalesPoint === undefined ? prev.selectedSalesPoint : data.selectedSalesPoint,
              }
            : prev,
        );
      }
      if (data?.selectionValid === false) {
        toast.error(
          "El punto de venta seleccionado no esta habilitado para WSFE.",
        );
      } else if (data?.missingSalesPoint) {
        toast.info("ARCA respondió, pero falta un punto de venta compatible.");
      } else {
        toast.success("Conexión ARCA OK.");
      }
      const st = await secureFetch("/api/arca", { method: "GET" }, token);
      const payload = await safeJson<ArcaStatusPayload>(st);
      if (st.ok && payload) {
        setConfig(payload.config);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al probar";
      setMissingPv(false);
      toast.error(msg);
      const st = await secureFetch("/api/arca", { method: "GET" }, token);
      const payload = await safeJson<ArcaStatusPayload>(st);
      if (st.ok && payload) setConfig(payload.config);
    } finally {
      setTesting(false);
    }
  };

  const handleResume = async () => {
    if (!token || !job) return;
    if (!resumePassword.trim()) {
      toast.error("Ingresá tu clave fiscal para continuar.");
      return;
    }
    setResuming(true);
    try {
      const res = await secureFetch(
        `/api/arca/connect/${job.id}`,
        {
          method: "POST",
          body: JSON.stringify({ password: resumePassword, taxRegime: resumeRegime || undefined }),
        },
        token,
      );
      const data = await safeJson<{ job?: ArcaJob; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo retomar la conexión");
      }
      setJob(data?.job ?? null);
      setResumePassword("");
      if (data?.job?.status === "error" || data?.job?.status === "completed") {
        const st = await secureFetch("/api/arca", { method: "GET" }, token);
        const payload = await safeJson<ArcaStatusPayload>(st);
        if (st.ok && payload) setConfig(payload.config);
      }
      if (data?.job?.status === "error") {
        setMissingPv(false);
        toast.error("Falló la conexión con ARCA. Revisá el detalle del error.");
      } else if (data?.job?.status === "completed") {
        toast.success("Conexión ARCA completada.");
      } else {
        toast.info("Retomando conexión...");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al retomar";
      toast.error(msg);
    } finally {
      setResuming(false);
    }
  };

  const handleDisconnect = async () => {
    if (!token) return;
    setDisconnecting(true);
    try {
      const res = await secureFetch("/api/arca/disconnect", { method: "POST" }, token);
      const data = await safeJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "No se pudo desconectar ARCA.");
      setConfig((prev) => prev ? { ...prev, status: "disconnected" } : prev);
      toast.success("ARCA desconectada. Podés reconectar cuando quieras.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo desconectar ARCA.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <ProtectedRoute>
      <section className="space-y-6 pb-10 text-sky-950 dark:text-white">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Conectar ARCA</h1>
            <p className="text-sm text-sky-950/70 dark:text-white/70">
              Conectá tu CUIT con Automations de Afip SDK en producción y dejá
              la facturación lista para tus pasajeros.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${statusTone}`}
            >
              {statusLabel}
            </span>
            {config?.lastOkAt && (
              <span className="text-xs text-sky-950/60 dark:text-white/60">
                Última OK: {formatDate(config.lastOkAt)}
              </span>
            )}
          </div>
        </div>

        {providerBlocked && (
          <div className="rounded-2xl border border-amber-600/50 bg-amber-100 p-4 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            No se pudo completar la conexión: Afip SDK alcanzó el cupo de CUITs del plan de Ofistur. Los datos que ingresaste no causaron este error. La conexión anterior se conserva. Un administrador de Ofistur debe ampliar el cupo para habilitar nuevas conexiones.
          </div>
        )}

        {job?.status === "error" && !providerBlocked && config?.status === "connected" && (
          <div className="rounded-2xl border border-amber-600/50 bg-amber-100 p-4 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            La reconexión no terminó. La conexión anterior sigue activa. {job.lastError}
          </div>
        )}

        {config?.status === "connected" && !config.authorizedServices.includes("ws_sr_constancia_inscripcion") && (
          <div className="rounded-2xl border border-sky-600/40 bg-sky-100 p-4 text-sm text-sky-950 dark:bg-sky-500/10 dark:text-sky-100">
            Esta conexión es anterior a la verificación automática del régimen fiscal. Reconectá para activarla.
            <button type="button" onClick={() => setStep(1)} className="ml-3 font-semibold underline">Reconectar</button>
          </div>
        )}

        {config?.status === "connected" && config.taxRegime === "mono" && (
          <div className="rounded-2xl border border-amber-600/50 bg-amber-100 p-4 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            El CUIT monotributista está conectado con ARCA, pero Ofistur todavía no emite Factura C desde reservas. Esa emisión fiscal permanecerá bloqueada para evitar comprobantes incorrectos.
          </div>
        )}

        {config?.status === "connected" && config.taxRegime && !config.taxRegimeCheckedAt && (
          <div className="rounded-2xl border border-amber-600/50 bg-amber-100 p-4 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            El régimen fiscal se eligió manualmente. Todavía falta que ARCA lo confirme; la emisión fiscal desde reservas permanecerá bloqueada hasta que se pueda verificar.
          </div>
        )}

        {config?.status === "connected" && config.authorizedServices.includes("ws_sr_constancia_inscripcion") && !config.taxRegime && (
          <div className="rounded-2xl border border-amber-600/50 bg-amber-100 p-4 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            Todavía no pudimos verificar el régimen fiscal en ARCA. Se volverá a consultar al abrir esta pantalla o intentar facturar.
          </div>
        )}

        {config?.taxRegime && config.observedTaxRegime && config.taxRegime !== config.observedTaxRegime && (
          <div className="rounded-2xl border border-amber-600/50 bg-amber-100 p-4 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
            ARCA informa un cambio de régimen a {config.observedTaxRegime === "ri" ? "responsable inscripto" : "monotributista"}. Reconectá para validar el punto de venta y el tipo de comprobante antes de facturar.
            <button type="button" onClick={() => setStep(1)} className="ml-3 font-semibold underline">Reconectar</button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="rounded-3xl border border-sky-950/10 bg-white/40 p-6 shadow-md shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10">
                <div className="flex flex-wrap items-center gap-3">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={isJobActive}
                      onClick={() => setStep(n)}
                      className={`rounded-full px-4 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        step === n
                          ? "border border-sky-700/60 bg-sky-200/60 text-sky-950 dark:border-sky-400/40 dark:bg-sky-500/30 dark:text-white"
                          : "border border-sky-950/10 bg-white/50 text-sky-950/60 hover:bg-white/70 dark:border-white/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20"
                      }`}
                    >
                      Paso {n}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <motion.div
                      key="step-1"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3 }}
                      className="mt-6 space-y-4"
                    >
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm">
                            CUIT representado
                            <Tooltip
                              label="?"
                              text="CUIT de la agencia que emitirá facturas. Es el CUIT que quedará en ARCA."
                            />
                          </label>
                          <input
                            value={form.cuitRepresentado}
                            disabled={inputsDisabled}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                cuitRepresentado: e.target.value,
                              }))
                            }
                            placeholder="30-99999999-7"
                            className="w-full rounded-2xl border border-sky-950/10 bg-white/60 p-3 outline-none backdrop-blur transition placeholder:text-sky-950/40 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-200/60 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:border-sky-300/40 dark:focus:ring-sky-400/30"
                          />
                          {form.cuitRepresentado && (
                            <p className="text-xs text-sky-950/60 dark:text-white/60">
                              {formatCuit(form.cuitRepresentado)}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm">
                            CUIT login
                            <Tooltip
                              label="?"
                              text="CUIT con el que se inicia sesión en ARCA. Puede ser el mismo u otro si administra sociedades."
                            />
                          </label>
                          <input
                            value={form.cuitLogin}
                            disabled={inputsDisabled}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                cuitLogin: e.target.value,
                              }))
                            }
                            placeholder="30-99999999-7"
                            className="w-full rounded-2xl border border-sky-950/10 bg-white/60 p-3 outline-none backdrop-blur transition placeholder:text-sky-950/40 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-200/60 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:border-sky-300/40 dark:focus:ring-sky-400/30"
                          />
                          <div className="flex items-center gap-2 text-xs text-sky-950/60 dark:text-white/60">
                            <button
                              type="button"
                              disabled={inputsDisabled}
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  cuitLogin: prev.cuitRepresentado,
                                }))
                              }
                              className="rounded-full border border-sky-950/20 px-2 py-1 text-sky-950/70 transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
                            >
                              Usar mismo CUIT
                            </button>
                          </div>
                        </div>
                      </div>

                      {changingIssuer && (
                        <p className="rounded-2xl border border-amber-700/40 bg-amber-100/70 p-3 text-xs text-amber-950 dark:border-amber-300/30 dark:bg-amber-500/10 dark:text-amber-100">
                          Estás cambiando el CUIT emisor. Se creará un certificado para el nuevo CUIT y la conexión anterior se reemplazará solo cuando la nueva funcione. Si esta agencia ya emitió comprobantes, usá una agencia nueva para conservar el historial fiscal de cada emisor.
                        </p>
                      )}

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm">Clave fiscal</label>
                          <input
                            type="password"
                            value={form.password}
                            disabled={inputsDisabled}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                password: e.target.value,
                              }))
                            }
                            placeholder="••••••••"
                            className="w-full rounded-2xl border border-sky-950/10 bg-white/60 p-3 outline-none backdrop-blur transition placeholder:text-sky-950/40 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-200/60 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:border-sky-300/40 dark:focus:ring-sky-400/30"
                          />
                          <p className="text-xs text-sky-950/60 dark:text-white/60">
                            La clave fiscal se guarda cifrada solo mientras dura la conexión y se borra al finalizar.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm">Alias (opcional)</label>
                          <input
                            value={form.alias}
                            disabled={inputsDisabled}
                            onChange={(e) =>
                              setForm((prev) => {
                                const raw = e.target.value;
                                const cleaned = sanitizeAlias(raw);
                                setAliasHadInvalid(raw !== cleaned);
                                return { ...prev, alias: cleaned };
                              })
                            }
                            placeholder="ofistur20301234567"
                            className="w-full rounded-2xl border border-sky-950/10 bg-white/60 p-3 outline-none backdrop-blur transition placeholder:text-sky-950/40 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-200/60 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:border-sky-300/40 dark:focus:ring-sky-400/30"
                          />
                          <p className="text-xs text-sky-950/60 dark:text-white/60">
                            Solo letras y números. Si lo dejás vacío, usamos un
                            alias único para este intento.
                          </p>
                          {aliasNeedsCuit && (
                            <span className="inline-flex rounded-full border border-amber-700/60 bg-amber-200/60 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-300/40 dark:bg-amber-500/20 dark:text-amber-100">
                              Si no hay alias, necesitás el CUIT completo.
                            </span>
                          )}
                          {aliasHadInvalid && (
                            <span
                              className="inline-flex rounded-full border border-amber-700/60 bg-amber-200/60 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-300/40 dark:bg-amber-500/20 dark:text-amber-100"
                              title="Alias inválido: quitamos símbolos. Usá solo letras y números."
                            >
                              Alias inválido (sin símbolos)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <p className="text-xs text-sky-950/60 dark:text-white/60">
                          Producción 100% (sin ambientes de prueba).
                        </p>
                        <button
                          type="button"
                          onClick={() => setStep(2)}
                          disabled={!canAdvanceStep1}
                          className={`rounded-full px-5 py-2 text-sm shadow-sm transition-transform hover:scale-95 active:scale-90 disabled:cursor-not-allowed ${
                            canAdvanceStep1
                              ? "border border-sky-700/60 bg-sky-200/60 text-sky-950 dark:border-sky-400/40 dark:bg-sky-500/30 dark:text-white"
                              : "border border-slate-300/40 bg-white/40 text-slate-400 dark:border-white/10 dark:bg-white/10 dark:text-white/40"
                          }`}
                        >
                          Continuar
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {step === 2 && (
                    <motion.div
                      key="step-2"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3 }}
                      className="mt-6 space-y-4"
                    >
                      <p className="text-sm text-sky-950/70 dark:text-white/70">
                        Elegí los servicios ARCA a autorizar. Facturación y constancia fiscal son obligatorios.
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
                        {AVAILABLE_SERVICES.map((svc) => {
                          const checked = form.services.includes(svc.id);
                          return (
                            <button
                              type="button"
                              key={svc.id}
                              onClick={() => toggleService(svc.id)}
                              disabled={svc.required}
                              className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                                checked
                                  ? "border-emerald-700/60 bg-emerald-200/40 text-emerald-950 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-white"
                                  : "border-sky-950/10 bg-white/40 hover:bg-white/60 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                              }`}
                            >
                              <span
                                className={`mt-1 inline-flex size-4 items-center justify-center rounded-full border ${
                                  checked
                                    ? "border-emerald-700/60 bg-emerald-200/60 dark:border-emerald-400/60 dark:bg-emerald-400/40"
                                    : "border-sky-950/20 dark:border-white/20"
                                }`}
                              >
                                {checked && (
                                  <span className="size-2 rounded-full bg-emerald-900 dark:bg-emerald-100" />
                                )}
                              </span>
                              <div>
                                <p className="text-sm font-medium">{svc.id}</p>
                                <p className="text-xs text-sky-950/60 dark:text-white/60">
                                  {svc.label}
                                </p>
                                {svc.required && (
                                  <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                                    Obligatorio
                                  </p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="rounded-full border border-sky-950/15 px-4 py-2 text-sm text-sky-950/70 transition hover:bg-white/60 dark:border-white/10 dark:text-white/70 dark:hover:bg-white/10"
                        >
                          Volver
                        </button>
                        <button
                          type="button"
                          onClick={() => setStep(3)}
                          className="rounded-full border border-sky-700/60 bg-sky-200/60 px-5 py-2 text-sm text-sky-950 shadow-sm transition-transform hover:scale-95 active:scale-90 dark:border-sky-400/40 dark:bg-sky-500/30 dark:text-white"
                        >
                          Continuar
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {step === 3 && (
                    <motion.div
                      key="step-3"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3 }}
                      className="mt-6 space-y-4"
                    >
                      <div className="rounded-2xl border border-sky-950/10 bg-white/50 p-4 dark:border-white/10 dark:bg-white/5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {job?.status === "completed" ? "Conexión completada" : "Conexión automática"}
                          </span>
                          {isJobActive && (
                            <span className="size-4 animate-spin rounded-full border-2 border-sky-400/60 border-t-transparent dark:border-white/60" />
                          )}
                        </div>
                        <div className="mt-3 space-y-2 text-xs text-sky-950/60 dark:text-white/60">
                          {isJobActive && <p>Podés cerrar esta página. El proceso continúa y al volver verás el avance.</p>}
                          {job?.step === "detect_regime" && <p>Consultando el régimen fiscal.</p>}
                          {job?.step === "list_points" && <p>Buscando puntos de venta compatibles.</p>}
                          {job?.step === "create_point" && <p>Creando un punto de venta para Web Services.</p>}
                          {job?.step === "verify" && <p>Verificando la conexión antes de activarla.</p>}
                          <div className="flex items-center justify-between">
                            <span>Certificado en ARCA</span>
                            <span>
                              {job?.step === "create_cert" &&
                              job.status === "error"
                                ? config?.hasCert
                                  ? "Guardado"
                                  : "Falló"
                                : job?.step === "create_cert" &&
                                    job.status !== "completed"
                                ? "En progreso"
                                : config?.hasCert
                                  ? "OK"
                                  : "Pendiente"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Servicios autorizados</span>
                            <span>
                              {job?.currentServiceIndex ?? config?.authorizedServices?.length ?? 0}/
                              {job?.services.length ?? form.services.length}
                            </span>
                          </div>
                          {job?.lastError && !providerBlocked && (
                            <p className="whitespace-pre-wrap break-words text-xs text-rose-700 dark:text-rose-200">
                              Detalle ARCA: {job.lastError}
                            </p>
                          )}
                        </div>
                      </div>

                      {(job?.status === "requires_action" || job?.status === "blocked_provider") && (
                        <div className="rounded-2xl border border-amber-700/50 bg-amber-200/60 p-4 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100">
                          <p className="text-xs font-medium">
                            {job?.status === "blocked_provider"
                              ? "Después de ampliar el cupo, ingresá tu clave para retomar este intento."
                              : job?.step === "list_points" || job?.step === "detect_regime"
                              ? "Confirmá el régimen fiscal y reingresá tu clave para continuar."
                              : "Necesitamos tu clave fiscal para continuar."}
                          </p>
                          {job?.status === "requires_action" &&
                            (job.step === "list_points" || job.step === "detect_regime") && (
                            <select
                              value={resumeRegime}
                              onChange={(event) => setResumeRegime(event.target.value as "" | "mono" | "ri")}
                              className="mt-3 w-full rounded-xl border border-amber-700/40 bg-white/70 px-3 py-2 text-sm text-amber-900"
                            >
                              <option value="">Seleccioná el régimen confirmado en ARCA</option>
                              <option value="ri">Responsable inscripto</option>
                              <option value="mono">Monotributista</option>
                            </select>
                          )}
                          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                            <input
                              type="password"
                              value={resumePassword}
                              onChange={(e) =>
                                setResumePassword(e.target.value)
                              }
                              placeholder="Clave fiscal"
                              className="flex-1 rounded-2xl border border-amber-700/40 bg-white/70 px-3 py-2 text-sm outline-none transition focus:border-amber-500/70 focus:ring-2 focus:ring-amber-200/60 disabled:cursor-not-allowed disabled:opacity-70 dark:border-amber-300/30 dark:bg-white/10 dark:text-white dark:focus:border-amber-200/60 dark:focus:ring-amber-400/30"
                            />
                            <button
                              type="button"
                              disabled={!resumePassword.trim() ||
                                (job?.status === "requires_action" &&
                                  (job.step === "list_points" || job.step === "detect_regime") && !resumeRegime) || resuming}
                              onClick={handleResume}
                              className="rounded-full border border-amber-700/60 bg-amber-200/70 px-4 py-2 text-xs font-medium text-amber-900 shadow-sm transition-transform hover:scale-95 active:scale-90 disabled:cursor-not-allowed dark:border-amber-300/40 dark:bg-amber-500/20 dark:text-white"
                            >
                              {resuming
                                ? "Continuando..."
                                : "Continuar conexión"}
                            </button>
                          </div>
                        </div>
                      )}

                      {providerBlocked && (
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                          El límite pertenece al plan de Afip SDK de Ofistur. Regenerar certificados o borrar datos de esta agencia no libera CUITs de ese plan. {job?.status === "blocked_provider"
                            ? "Este intento puede retomarse cuando se amplíe el cupo."
                            : "Podrás iniciar otro intento cuando se amplíe el cupo."}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          disabled={!canConnect || isBusy}
                          onClick={() => handleConnect("connect")}
                          className={`rounded-full px-6 py-2 text-sm shadow-sm transition-transform hover:scale-95 active:scale-90 disabled:cursor-not-allowed ${
                            canConnect
                              ? "border border-emerald-700/60 bg-emerald-200/60 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/20 dark:text-white"
                              : "border border-slate-300/40 bg-white/40 text-slate-400 dark:border-white/10 dark:bg-white/10 dark:text-white/40"
                          }`}
                        >
                          {isConnecting ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="size-4 animate-spin rounded-full border-2 border-emerald-600/70 border-t-transparent dark:border-white/60" />
                              Conectando...
                            </span>
                          ) : (
                            config ? "Recrear conexión" : "Conectar ARCA"
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setStep(2)}
                          className="rounded-full border border-sky-950/15 px-5 py-2 text-sm text-sky-950/70 transition hover:bg-white/60 dark:border-white/10 dark:text-white/70 dark:hover:bg-white/10"
                        >
                          Volver
                        </button>
                      </div>
                      {aliasNeedsCuit && (
                        <p className="text-xs text-amber-700 dark:text-amber-200">
                          El alias está vacío y falta el CUIT completo.
                        </p>
                      )}

                      <p className="text-xs text-sky-950/60 dark:text-white/60">
                        {config
                          ? "Al reconectar, se crearán un certificado y un punto de venta nuevos. La conexión anterior seguirá guardada hasta que la nueva funcione."
                          : "La delegación manual queda como alternativa de respaldo documentada."}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {showPvHelp && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-3xl border border-amber-700/50 bg-amber-200/50 p-5 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-100"
                >
                  <h3 className="text-sm font-semibold">
                    Te falta punto de venta para Web Services
                  </h3>
                  <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-100/80">
                    Podés crear un punto de venta desde ARCA. Este paso no
                    bloquea la conexión.
                  </p>
                  <a
                    href="https://docs.afipsdk.com/recursos/tutoriales-pagina-de-arca/crear-punto-de-venta"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex rounded-full border border-amber-700/60 px-3 py-1 text-xs text-amber-900 transition hover:bg-amber-200/70 dark:border-amber-300/30 dark:text-amber-100 dark:hover:bg-amber-500/20"
                  >
                    Ver tutorial
                  </a>
                </motion.div>
              )}
            </div>

            <div className="space-y-6">
              {secretsKeyValid === false && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-3xl border border-rose-700/50 bg-rose-200/50 p-5 text-rose-900 shadow-md shadow-rose-950/10 backdrop-blur dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-100"
                >
                  <h3 className="text-sm font-semibold">
                    Configuración incompleta
                  </h3>
                  <p className="mt-2 text-xs text-rose-900/80 dark:text-rose-100/80">
                    Falta la clave para cifrar certificados. Configurá{" "}
                    <span className="font-semibold">ARCA_SECRETS_KEY</span> (o{" "}
                    <span className="font-semibold">AFIP_SECRET_KEY</span>).
                  </p>
                  {secretsKeyError && (
                    <p className="mt-2 text-xs text-rose-900/80 dark:text-rose-100/80">
                      Detalle: {secretsKeyError}
                    </p>
                  )}
                </motion.div>
              )}
              <div className="rounded-3xl border border-sky-950/10 bg-white/40 p-5 shadow-md shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10">
                <h3 className="text-sm font-semibold">Estado</h3>
                <div className="mt-3 space-y-2 text-xs text-sky-950/60 dark:text-white/60">
                  <div className="flex items-center justify-between">
                    <span>Status</span>
                    <span className="text-sky-950/90 dark:text-white/90">
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Servicios autorizados</span>
                    <span className="text-sky-950/90 dark:text-white/90">
                      {(config?.authorizedServices ?? []).length || "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Última conexión OK</span>
                    <span className="text-sky-950/90 dark:text-white/90">
                      {formatDate(config?.lastOkAt)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-sky-950/10 bg-white/40 p-5 shadow-md shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10">
                <h3 className="text-sm font-semibold">Diagnóstico</h3>
                <div className="mt-3 space-y-3 text-xs text-sky-950/60 dark:text-white/60">
                  <div>
                    <p className="text-sky-950/80 dark:text-white/80">
                      Servicios
                    </p>
                    <p>
                      {(config?.authorizedServices ?? []).length > 0
                        ? config?.authorizedServices.join(", ")
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sky-950/80 dark:text-white/80">
                      Detalle ARCA
                    </p>
                    <p className="whitespace-pre-wrap break-words text-rose-700/80 dark:text-rose-200/80">
                      {config?.lastError || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sky-950/80 dark:text-white/80">Alias</p>
                    <p>{config?.alias || form.alias || "—"}</p>
                  </div>
                  <div>
                    <p className="text-sky-950/80 dark:text-white/80">
                      Puntos de venta detectados
                    </p>
                    {salesPointsList.length ? (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {salesPointsList.map((pv) => {
                          const isSelected =
                            pv === config?.selectedSalesPoint;
                          return (
                            <span
                              key={pv}
                              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                isSelected
                                  ? "border-emerald-600/50 bg-emerald-200/60 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/20 dark:text-emerald-50"
                                  : "border-sky-950/10 bg-white/60 text-sky-900 dark:border-white/10 dark:bg-white/10 dark:text-white/80"
                              }`}
                            >
                              {pv}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p>—</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sky-950/80 dark:text-white/80">
                      Punto de venta seleccionado
                    </p>
                    <p>{config?.selectedSalesPoint ?? "—"}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-sky-950/10 bg-white/40 p-5 shadow-md shadow-sky-950/10 backdrop-blur dark:border-white/10 dark:bg-white/10">
                <h3 className="text-sm font-semibold">Acciones</h3>
                <div className="mt-4 flex flex-col gap-3">
                  <div className="rounded-2xl border border-sky-950/10 bg-white/60 p-3 text-xs text-sky-950/70 dark:border-white/10 dark:bg-white/10 dark:text-white/70">
                    <p className="text-sky-950/80 dark:text-white/80">
                      Punto de venta para facturar
                    </p>
                    <div className="mt-2 flex flex-col gap-2">
                      <select
                        value={salesPointChoice}
                        onChange={(e) => setSalesPointChoice(e.target.value)}
                        disabled={!salesPointsList.length || testing || isBusy}
                        className="w-full rounded-2xl border border-sky-950/10 bg-white/70 px-3 py-2 text-sm text-sky-950 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-200/60 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white/10 dark:bg-white/10 dark:text-white dark:focus:border-sky-300/40 dark:focus:ring-sky-400/30"
                      >
                        <option value="">
                          {salesPointsList.length
                            ? "Selecciona un punto"
                            : "No hay puntos detectados"}
                        </option>
                        {salesPointsList.map((pv) => (
                          <option key={pv} value={pv}>
                            {pv}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-sky-950/60 dark:text-white/60">
                        Se guarda al probar conexión y se usa para emitir
                        facturas.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={
                      !config?.hasCert || !config?.hasKey || config.status === "disconnected" || testing || isBusy
                    }
                    onClick={() => {
                      const parsed = salesPointChoice.trim()
                        ? Number(salesPointChoice)
                        : NaN;
                      const selected = Number.isFinite(parsed)
                        ? parsed
                        : null;
                      void handleTest(selected);
                    }}
                    className={`rounded-full px-4 py-2 text-sm shadow-sm transition-transform hover:scale-95 active:scale-90 disabled:cursor-not-allowed ${
                      config?.hasCert && config?.hasKey
                        ? "border border-sky-700/60 bg-sky-200/60 text-sky-950 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-white"
                        : "border border-slate-300/40 bg-white/40 text-slate-400 dark:border-white/10 dark:bg-white/10 dark:text-white/40"
                    }`}
                  >
                    {testing ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="size-4 animate-spin rounded-full border-2 border-sky-600/70 border-t-transparent dark:border-white/60" />
                        Probando...
                      </span>
                    ) : (
                      "Probar conexión"
                    )}
                  </button>
                  {config?.hasCert && config.status !== "disconnected" && (
                    <button
                      type="button"
                      disabled={isJobActive || isBusy}
                      onClick={handleDisconnect}
                      className="rounded-full border border-rose-700/50 px-4 py-2 text-sm text-rose-800 disabled:opacity-50 dark:text-rose-200"
                    >
                      {disconnecting ? "Desconectando..." : "Desconectar"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!canConnect || isBusy}
                    onClick={() => handleConnect("rotate")}
                    className={`rounded-full px-4 py-2 text-sm shadow-sm transition-transform hover:scale-95 active:scale-90 disabled:cursor-not-allowed ${
                      canConnect
                        ? "border border-amber-700/60 bg-amber-200/60 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-white"
                        : "border border-slate-300/40 bg-white/40 text-slate-400 dark:border-white/10 dark:bg-white/10 dark:text-white/40"
                    }`}
                  >
                    {isRotating ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="size-4 animate-spin rounded-full border-2 border-amber-600/70 border-t-transparent dark:border-white/60" />
                        Rotando...
                      </span>
                    ) : (
                      "Recrear conexión"
                    )}
                  </button>
                </div>
                <p className="mt-3 text-xs text-sky-950/60 dark:text-white/60">
                  Recrear genera un certificado y un punto de venta nuevos, y reemplaza la configuración guardada solo cuando la nueva conexión funciona. Los comprobantes anteriores se conservan. Desconectar suspende la facturación en Ofistur; no revoca certificados ni elimina puntos de venta en ARCA.
                </p>
              </div>
            </div>
          </div>
        )}

        <ToastContainer />
      </section>
    </ProtectedRoute>
  );
}
