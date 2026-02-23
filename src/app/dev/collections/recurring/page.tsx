"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { normalizeRole } from "@/utils/permissions";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

type RunSummary = {
  anchor_date: string;
  override_fx: boolean;
  subscriptions_total: number;
  subscriptions_processed: number;
  cycles_created: number;
  charges_created: number;
  attempts_created: number;
  skipped_idempotent?: number;
  fx_rates_used: Array<{ date: string; ars_per_usd: number }>;
  errors: Array<{ id_agency: number; message: string }>;
};

type CycleRow = {
  id_cycle: number;
  id_agency: number;
  subscription_id: number;
  anchor_date: string;
  period_start: string;
  period_end: string;
  status: string;
  fx_rate_ars_per_usd: number | null;
  total_ars: number | null;
  latest_charge: {
    id_charge: number;
    status: string;
    amount_ars_due: number | null;
  } | null;
};

type ChargeRow = {
  id_charge: number;
  id_agency: number;
  cycle_id: number | null;
  due_date: string | null;
  status: string;
  dunning_stage: number;
  collection_channel: string | null;
  paid_via_channel: string | null;
  amount_ars_due: number | null;
  amount_ars_paid: number | null;
  paid_reference: string | null;
  fallback_offered_at: string | null;
  fallback_expires_at: string | null;
  fiscal_document: {
    id_fiscal_document: number;
    document_type: string;
    status: string;
    afip_number: string | null;
    afip_cae: string | null;
    issued_at: string | null;
    error_message: string | null;
    retry_count: number;
  } | null;
  attempts: Array<{
    id_attempt: number;
    attempt_no: number;
    status: string;
    scheduled_for: string | null;
    processor_result_code?: string | null;
    processor_result_message?: string | null;
    processor_trace_id?: string | null;
  }>;
  fallback_intents: Array<{
    id_fallback_intent: number;
    provider: string;
    status: string;
    amount: number | null;
    currency: string;
    payment_url: string | null;
    expires_at: string | null;
    paid_at: string | null;
    provider_status: string | null;
    provider_status_detail: string | null;
    created_at: string;
  }>;
};

type BatchRow = {
  id_batch: number;
  parent_batch_id: number | null;
  direction: "OUTBOUND" | "INBOUND" | string;
  channel: string;
  file_type: string;
  adapter: string | null;
  adapter_version?: string | null;
  business_date: string;
  status: string;
  storage_key: string | null;
  file_hash?: string | null;
  record_count?: number | null;
  amount_total?: number | null;
  exported_at?: string | null;
  imported_at?: string | null;
  original_file_name: string | null;
  total_rows: number;
  total_amount_ars: number | null;
  total_paid_rows: number;
  total_rejected_rows: number;
  total_error_rows: number;
  created_at: string;
};

type BillingJobResult = {
  job_name: string;
  run_id: string;
  status: string;
  target_date_ar: string | null;
  adapter: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  counters: Record<string, unknown>;
  lock_key: string;
  skipped_locked: boolean;
  no_op: boolean;
  error_message: string | null;
};

type BillingJobRunRow = {
  id_job_run: number;
  job_name: string;
  run_id: string;
  source: "CRON" | "MANUAL" | "SYSTEM";
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  target_date_ar: string | null;
  adapter: string | null;
  counters_json: Record<string, unknown> | null;
  error_message: string | null;
};

type JobsOverview = {
  timezone: string;
  today_date_ar: string;
  metrics: {
    pending_attempts: number;
    processing_attempts: number;
    paid_today: number;
    rejected_today: number;
    overdue_charges: number;
    batches_prepared_today: number;
    batches_exported_today: number;
    batches_imported_today: number;
    charges_fallback_offered: number;
    fallback_intents_pending: number;
    fallback_paid_today: number;
    fallback_expired_today: number;
    paid_via_pd_last_30d: number;
    paid_via_fallback_last_30d: number;
    jobs_failed_last_24h: number;
    stale_prepared_batches: number;
    stale_exported_batches: number;
    fallback_expiring_24h: number;
    review_cases_open: number;
    charges_escalated_suspended: number;
    late_duplicates_last_30d: number;
    recovery_rate_30d: number;
  };
  recent_runs: BillingJobRunRow[];
};

type ReviewCaseRow = {
  id_review_case: number;
  agency_id: number;
  charge_id: number;
  type: string;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "IGNORED";
  primary_paid_channel: string | null;
  secondary_late_channel: string | null;
  amount_ars: number | null;
  detected_at: string;
  resolution_type: string | null;
  resolution_notes: string | null;
  resolved_by_user_id: number | null;
  resolved_at: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function dateInputToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);
}

function formatDurationMs(value?: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return "-";
  const ms = Number(value);
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.round((ms / 1000) * 10) / 10;
  return `${sec}s`;
}

function formatArs(value?: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function fiscalStatusLabel(status?: string | null): string {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "ISSUED") return "Emitido";
  if (normalized === "FAILED") return "Error";
  if (normalized === "PENDING") return "Pendiente";
  return "-";
}

function dunningStageMeta(stage: number): { label: string; badgeClass: string } {
  const value = Number.isFinite(stage) ? Math.trunc(stage) : 0;
  if (value <= 0) {
    return {
      label: "initial_pd_attempt",
      badgeClass: "border-sky-300/60 bg-sky-100/10 text-sky-100",
    };
  }
  if (value === 1) {
    return {
      label: "pd_retry_1",
      badgeClass: "border-cyan-300/60 bg-cyan-100/10 text-cyan-100",
    };
  }
  if (value === 2) {
    return {
      label: "pd_retry_2",
      badgeClass: "border-amber-300/60 bg-amber-100/10 text-amber-100",
    };
  }
  if (value === 3) {
    return {
      label: "fallback_offered",
      badgeClass: "border-rose-300/60 bg-rose-100/10 text-rose-100",
    };
  }
  return {
    label: "escalated_suspended",
    badgeClass: "border-violet-300/60 bg-violet-100/10 text-violet-100",
  };
}

export default function RecurringCollectionsDevPage() {
  const { token, role, loading: authLoading } = useAuth();
  const normalizedRole = useMemo(() => normalizeRole(role), [role]);
  const canAccess = normalizedRole === "desarrollador";

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [anchorDate, setAnchorDate] = useState(dateInputToday());
  const [overrideFx, setOverrideFx] = useState(false);
  const [batchDate, setBatchDate] = useState(dateInputToday());
  const [from, setFrom] = useState(dateInputDaysAgo(60));
  const [to, setTo] = useState(dateInputToday());
  const [statusFilter, setStatusFilter] = useState("");

  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [jobsOverview, setJobsOverview] = useState<JobsOverview | null>(null);
  const [reviewCases, setReviewCases] = useState<ReviewCaseRow[]>([]);
  const [jobResult, setJobResult] = useState<BillingJobResult | null>(null);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [uploadingBatchId, setUploadingBatchId] = useState<number | null>(null);
  const [retryingFiscalChargeId, setRetryingFiscalChargeId] = useState<number | null>(null);
  const [updatingFallbackIntentId, setUpdatingFallbackIntentId] = useState<number | null>(null);
  const [updatingReviewCaseId, setUpdatingReviewCaseId] = useState<number | null>(null);
  const [lastImportSummary, setLastImportSummary] = useState<{
    outboundBatchId: number;
    already_imported: boolean;
    matched_rows: number;
    paid: number;
    rejected: number;
    error_rows: number;
  } | null>(null);
  const [selectedResponseFileByBatch, setSelectedResponseFileByBatch] = useState<
    Record<number, File | null>
  >({});

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [cyclesRes, chargesRes, batchesRes, jobsRes, reviewCasesRes] = await Promise.all([
        authFetch(
          `/api/admin/collections/cycles?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { cache: "no-store" },
          token,
        ),
        authFetch(
          `/api/admin/collections/charges?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ""}`,
          { cache: "no-store" },
          token,
        ),
        authFetch(
          `/api/admin/collections/direct-debit/batches?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { cache: "no-store" },
          token,
        ),
        authFetch("/api/admin/collections/jobs?limit=12", { cache: "no-store" }, token),
        authFetch(
          `/api/admin/collections/review-cases?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`,
          { cache: "no-store" },
          token,
        ),
      ]);

      if (!cyclesRes.ok) {
        const json = (await cyclesRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudieron cargar los ciclos");
      }
      if (!chargesRes.ok) {
        const json = (await chargesRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudieron cargar los cobros");
      }
      if (!batchesRes.ok) {
        const json = (await batchesRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudieron cargar los lotes");
      }
      if (!jobsRes.ok) {
        const json = (await jobsRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo cargar el estado de jobs");
      }
      if (!reviewCasesRes.ok) {
        const json = (await reviewCasesRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudieron cargar los casos contables");
      }

      const cyclesJson = (await cyclesRes.json()) as { items: CycleRow[] };
      const chargesJson = (await chargesRes.json()) as { items: ChargeRow[] };
      const batchesJson = (await batchesRes.json()) as { items: BatchRow[] };
      const jobsJson = (await jobsRes.json()) as JobsOverview;
      const reviewCasesJson = (await reviewCasesRes.json()) as { items: ReviewCaseRow[] };
      setCycles(cyclesJson.items || []);
      setCharges(chargesJson.items || []);
      setBatches(batchesJson.items || []);
      setJobsOverview(jobsJson || null);
      setReviewCases(reviewCasesJson.items || []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo cargar la vista";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [from, statusFilter, to, token]);

  useEffect(() => {
    if (!token || !canAccess) return;
    void loadData();
  }, [token, canAccess, loadData]);

  const openReviewCaseByCharge = useMemo(() => {
    const map = new Map<number, ReviewCaseRow>();
    for (const row of reviewCases) {
      if (row.status !== "OPEN" && row.status !== "IN_REVIEW") continue;
      if (!map.has(row.charge_id)) {
        map.set(row.charge_id, row);
      }
    }
    return map;
  }, [reviewCases]);

  async function handleRunAnchor(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    setRunning(true);
    try {
      const qs = new URLSearchParams({
        date: anchorDate,
        overrideFx: String(overrideFx),
      });

      const res = await authFetch(
        `/api/admin/collections/run-anchor?${qs.toString()}`,
        { method: "POST" },
        token,
      );

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo correr la corrida");
      }

      const json = (await res.json()) as { summary: RunSummary };
      setSummary(json.summary);
      toast.success("Corrida ejecutada");
      await loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo correr la corrida";
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }

  async function runBillingJob(
    endpoint: string,
    payload: Record<string, unknown>,
    loadingKey: string,
    successMessage: string,
  ) {
    if (!token) return;
    setRunningJob(loadingKey);
    try {
      const res = await authFetch(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        token,
      );

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo ejecutar el job");
      }

      const json = (await res.json()) as { result: BillingJobResult };
      setJobResult(json.result);
      toast.success(successMessage);
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo ejecutar el job";
      toast.error(message);
    } finally {
      setRunningJob(null);
    }
  }

  async function handleRunAnchorJob() {
    await runBillingJob(
      "/api/admin/collections/jobs/run-anchor",
      {
        date: anchorDate,
        overrideFx,
      },
      "run_anchor",
      "Job Run Anchor ejecutado",
    );
  }

  async function handlePrepareBatchJob(dryRun: boolean) {
    await runBillingJob(
      "/api/admin/collections/jobs/prepare-batch",
      {
        date: batchDate,
        dryRun,
      },
      dryRun ? "prepare_batch_dry" : "prepare_batch",
      dryRun ? "Dry-run de prepare ejecutado" : "Job Prepare Batch ejecutado",
    );
  }

  async function handleExportBatchJob() {
    await runBillingJob(
      "/api/admin/collections/jobs/export-batch",
      {
        date: batchDate,
      },
      "export_batch",
      "Job Export Batch ejecutado",
    );
  }

  async function handleReconcileBatchJobNoop() {
    await runBillingJob(
      "/api/admin/collections/jobs/reconcile-batch",
      {},
      "reconcile_batch",
      "Job Reconcile ejecutado",
    );
  }

  async function handleFallbackCreateJob() {
    await runBillingJob(
      "/api/admin/collections/jobs/fallback-create",
      {
        date: batchDate,
      },
      "fallback_create",
      "Job Fallback Create ejecutado",
    );
  }

  async function handleFallbackSyncJob() {
    await runBillingJob(
      "/api/admin/collections/jobs/fallback-sync",
      {
        date: batchDate,
      },
      "fallback_sync",
      "Job Fallback Sync ejecutado",
    );
  }

  async function handleCreateFallbackForCharge(chargeId: number) {
    if (!token) return;
    setRunningJob(`fallback_create_${chargeId}`);
    try {
      const res = await authFetch(
        "/api/admin/collections/fallback/create",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chargeId }),
        },
        token,
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo crear fallback");
      }
      toast.success("Fallback creado / verificado");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo crear fallback";
      toast.error(message);
    } finally {
      setRunningJob(null);
    }
  }

  async function handleMarkFallbackPaid(fallbackIntentId: number) {
    if (!token) return;
    setUpdatingFallbackIntentId(fallbackIntentId);
    try {
      const res = await authFetch(
        `/api/admin/collections/fallback/${fallbackIntentId}/mark-paid`,
        { method: "POST" },
        token,
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo marcar fallback como pagado");
      }
      toast.success("Fallback marcado como pagado");
      await loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo marcar fallback como pagado";
      toast.error(message);
    } finally {
      setUpdatingFallbackIntentId(null);
    }
  }

  async function handleCancelFallback(fallbackIntentId: number) {
    if (!token) return;
    setUpdatingFallbackIntentId(fallbackIntentId);
    try {
      const res = await authFetch(
        `/api/admin/collections/fallback/${fallbackIntentId}/cancel`,
        { method: "POST" },
        token,
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo cancelar fallback");
      }
      toast.success("Fallback cancelado");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cancelar fallback";
      toast.error(message);
    } finally {
      setUpdatingFallbackIntentId(null);
    }
  }

  async function handleStartReviewCase(reviewCaseId: number) {
    if (!token) return;
    setUpdatingReviewCaseId(reviewCaseId);
    try {
      const res = await authFetch(
        `/api/admin/collections/review-cases/${reviewCaseId}/start-review`,
        { method: "POST" },
        token,
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo iniciar revisión");
      }
      toast.success("Caso pasado a IN_REVIEW");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo iniciar revisión";
      toast.error(message);
    } finally {
      setUpdatingReviewCaseId(null);
    }
  }

  async function handleResolveReviewCase(reviewCaseId: number) {
    if (!token) return;
    const resolutionTypeRaw = window
      .prompt(
        "Resolution type: BALANCE_CREDIT | REFUND_MANUAL | NO_ACTION | OTHER",
        "NO_ACTION",
      )
      ?.trim()
      .toUpperCase();
    if (!resolutionTypeRaw) return;

    if (!["BALANCE_CREDIT", "REFUND_MANUAL", "NO_ACTION", "OTHER"].includes(resolutionTypeRaw)) {
      toast.error("resolutionType inválido");
      return;
    }

    const notes = window.prompt("Notas de resolución (opcional)", "")?.trim() || null;

    setUpdatingReviewCaseId(reviewCaseId);
    try {
      const res = await authFetch(
        `/api/admin/collections/review-cases/${reviewCaseId}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resolutionType: resolutionTypeRaw,
            notes,
          }),
        },
        token,
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo resolver el caso");
      }
      toast.success("Caso resuelto");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo resolver el caso";
      toast.error(message);
    } finally {
      setUpdatingReviewCaseId(null);
    }
  }

  async function handleIgnoreReviewCase(reviewCaseId: number) {
    if (!token) return;
    const notes = window.prompt("Notas de ignore (opcional)", "")?.trim() || null;
    setUpdatingReviewCaseId(reviewCaseId);
    try {
      const res = await authFetch(
        `/api/admin/collections/review-cases/${reviewCaseId}/ignore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes }),
        },
        token,
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo ignorar el caso");
      }
      toast.success("Caso marcado como ignorado");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo ignorar el caso";
      toast.error(message);
    } finally {
      setUpdatingReviewCaseId(null);
    }
  }

  async function handleCreateBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    setCreatingBatch(true);
    try {
      const res = await authFetch(
        `/api/admin/collections/direct-debit/batches?date=${encodeURIComponent(batchDate)}`,
        { method: "POST" },
        token,
      );

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo crear el lote");
      }

      const json = (await res.json()) as {
        batch: { id_batch: number; total_rows: number };
      };
      toast.success(`Lote creado (#${json.batch.id_batch}) con ${json.batch.total_rows} filas`);
      await loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo crear el lote";
      toast.error(message);
    } finally {
      setCreatingBatch(false);
    }
  }

  async function handleDownloadBatch(batchId: number) {
    if (!token) return;

    try {
      const res = await authFetch(
        `/api/admin/collections/direct-debit/batches/${batchId}/download`,
        { cache: "no-store" },
        token,
      );

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo descargar el archivo");
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition") || "";
      const fileNameMatch = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition);
      const fileName = fileNameMatch?.[1] || `batch-${batchId}.csv`;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo descargar el lote";
      toast.error(message);
    }
  }

  async function handleImportResponse(batchId: number) {
    if (!token) return;
    const file = selectedResponseFileByBatch[batchId];
    if (!file) {
      toast.error("Elegí un archivo de respuesta antes de importar");
      return;
    }

    setUploadingBatchId(batchId);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await authFetch(
        `/api/admin/collections/direct-debit/batches/${batchId}/import-response`,
        {
          method: "POST",
          body: formData,
        },
        token,
      );

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo importar la respuesta");
      }

      const json = (await res.json()) as {
        already_imported?: boolean;
        summary: {
          matched_rows: number;
          paid: number;
          rejected: number;
          error_rows: number;
        };
      };

      setLastImportSummary({
        outboundBatchId: batchId,
        already_imported: Boolean(json.already_imported),
        matched_rows: json.summary.matched_rows,
        paid: json.summary.paid,
        rejected: json.summary.rejected,
        error_rows: json.summary.error_rows,
      });
      if (json.already_imported) {
        toast.info("Archivo ya importado: no se reaplicaron cambios");
      } else {
        toast.success(
          `Respuesta importada: ${json.summary.paid} pagos, ${json.summary.rejected} rechazados, ${json.summary.error_rows} errores`,
        );
      }
      setSelectedResponseFileByBatch((prev) => ({ ...prev, [batchId]: null }));
      await loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo importar la respuesta";
      toast.error(message);
    } finally {
      setUploadingBatchId(null);
    }
  }

  async function handleRetryIssueFiscal(chargeId: number) {
    if (!token) return;
    setRetryingFiscalChargeId(chargeId);
    try {
      const res = await authFetch(
        `/api/admin/collections/charges/${chargeId}/retry-issue-fiscal`,
        { method: "POST" },
        token,
      );

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "No se pudo reintentar la emisión fiscal");
      }

      toast.success("Se ejecutó el reintento fiscal");
      await loadData();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo reintentar la emisión fiscal";
      toast.error(message);
    } finally {
      setRetryingFiscalChargeId(null);
    }
  }

  if (authLoading) {
    return (
      <ProtectedRoute>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner />
        </div>
      </ProtectedRoute>
    );
  }

  if (!canAccess) {
    return (
      <ProtectedRoute>
        <section className="mx-auto mt-6 max-w-4xl rounded-3xl border border-rose-300/40 bg-rose-100/20 p-6 text-sm text-rose-900 dark:border-rose-300/30 dark:bg-rose-500/10 dark:text-rose-50">
          No tenés permisos para acceder a Cobranzas Recurrentes.
        </section>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <section className="mx-auto mt-4 max-w-6xl space-y-5 text-sky-950 dark:text-white">
        <header className="rounded-3xl border border-white/30 bg-white/10 p-6 shadow-lg shadow-sky-900/10 backdrop-blur">
          <h1 className="text-2xl font-semibold">Cobranzas recurrentes</h1>
          <p className="mt-1 text-sm opacity-80">
            Corrida manual del ciclo anclado y monitoreo de ciclos/cobros.
          </p>
        </header>

        <article className="rounded-3xl border border-white/30 bg-white/10 p-6 shadow-lg shadow-sky-900/10 backdrop-blur">
          <h2 className="text-lg font-semibold">Jobs operativos</h2>
          <p className="mt-1 text-xs opacity-75">
            Triggers manuales del runner (TZ AR) con locks e historial.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleRunAnchorJob()}
              disabled={runningJob != null}
              className="rounded-full border border-emerald-300/60 bg-emerald-100/10 px-3 py-1.5 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
            >
              {runningJob === "run_anchor" ? "Run Anchor..." : "Run Anchor (hoy)"}
            </button>
            <button
              type="button"
              onClick={() => void handlePrepareBatchJob(false)}
              disabled={runningJob != null}
              className="rounded-full border border-sky-300/60 bg-sky-100/10 px-3 py-1.5 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
            >
              {runningJob === "prepare_batch" ? "Preparing..." : "Prepare Batch"}
            </button>
            <button
              type="button"
              onClick={() => void handlePrepareBatchJob(true)}
              disabled={runningJob != null}
              className="rounded-full border border-sky-300/60 bg-sky-100/10 px-3 py-1.5 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
            >
              {runningJob === "prepare_batch_dry" ? "Calculando..." : "Prepare Dry-Run"}
            </button>
            <button
              type="button"
              onClick={() => void handleExportBatchJob()}
              disabled={runningJob != null}
              className="rounded-full border border-amber-300/60 bg-amber-100/10 px-3 py-1.5 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
            >
              {runningJob === "export_batch" ? "Exportando..." : "Export Batch"}
            </button>
            <button
              type="button"
              onClick={() => void handleReconcileBatchJobNoop()}
              disabled={runningJob != null}
              className="rounded-full border border-fuchsia-300/60 bg-fuchsia-100/10 px-3 py-1.5 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
            >
              {runningJob === "reconcile_batch" ? "Reconciling..." : "Reconcile Batch"}
            </button>
            <button
              type="button"
              onClick={() => void handleFallbackCreateJob()}
              disabled={runningJob != null}
              className="rounded-full border border-rose-300/60 bg-rose-100/10 px-3 py-1.5 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
            >
              {runningJob === "fallback_create" ? "Creando..." : "Fallback Create"}
            </button>
            <button
              type="button"
              onClick={() => void handleFallbackSyncJob()}
              disabled={runningJob != null}
              className="rounded-full border border-indigo-300/60 bg-indigo-100/10 px-3 py-1.5 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
            >
              {runningJob === "fallback_sync" ? "Sync..." : "Fallback Sync"}
            </button>
          </div>

          {jobResult ? (
            <div className="mt-4 rounded-2xl border border-white/25 bg-white/15 p-3 text-xs sm:text-sm">
              <div className="font-semibold">
                Último job: {jobResult.job_name} · {jobResult.status}
              </div>
              <div className="mt-1 opacity-80">
                run_id {jobResult.run_id} · {formatDurationMs(jobResult.duration_ms)}
                {jobResult.target_date_ar ? ` · fecha ${jobResult.target_date_ar}` : ""}
                {jobResult.adapter ? ` · adapter ${jobResult.adapter}` : ""}
              </div>
              <div className="mt-1 opacity-80">
                counters: {Object.entries(jobResult.counters || {})
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(" · ") || "-"}
              </div>
              {jobResult.error_message ? (
                <div className="mt-1 text-rose-200">{jobResult.error_message}</div>
              ) : null}
            </div>
          ) : null}

          {jobsOverview ? (
            <>
              <div className="mt-5 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Pending attempts: <span className="font-semibold">{jobsOverview.metrics.pending_attempts}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Processing attempts: <span className="font-semibold">{jobsOverview.metrics.processing_attempts}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Paid today: <span className="font-semibold">{jobsOverview.metrics.paid_today}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Rejected today: <span className="font-semibold">{jobsOverview.metrics.rejected_today}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Overdue charges: <span className="font-semibold">{jobsOverview.metrics.overdue_charges}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Batches prepared hoy: <span className="font-semibold">{jobsOverview.metrics.batches_prepared_today}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Batches exported hoy: <span className="font-semibold">{jobsOverview.metrics.batches_exported_today}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Batches imported hoy: <span className="font-semibold">{jobsOverview.metrics.batches_imported_today}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Charges fallback: <span className="font-semibold">{jobsOverview.metrics.charges_fallback_offered}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Fallback pending: <span className="font-semibold">{jobsOverview.metrics.fallback_intents_pending}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Fallback paid hoy: <span className="font-semibold">{jobsOverview.metrics.fallback_paid_today}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Fallback expired hoy: <span className="font-semibold">{jobsOverview.metrics.fallback_expired_today}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Paid via PD (30d): <span className="font-semibold">{jobsOverview.metrics.paid_via_pd_last_30d}</span>
                </div>
                <div className="rounded-2xl border border-white/25 bg-white/10 p-3">
                  Paid via fallback (30d): <span className="font-semibold">{jobsOverview.metrics.paid_via_fallback_last_30d}</span>
                </div>
                <div className="rounded-2xl border border-rose-300/40 bg-rose-100/10 p-3">
                  Jobs failed 24h: <span className="font-semibold">{jobsOverview.metrics.jobs_failed_last_24h}</span>
                </div>
                <div className="rounded-2xl border border-amber-300/40 bg-amber-100/10 p-3">
                  Prepared stale: <span className="font-semibold">{jobsOverview.metrics.stale_prepared_batches}</span>
                </div>
                <div className="rounded-2xl border border-amber-300/40 bg-amber-100/10 p-3">
                  Exported stale: <span className="font-semibold">{jobsOverview.metrics.stale_exported_batches}</span>
                </div>
                <div className="rounded-2xl border border-fuchsia-300/40 bg-fuchsia-100/10 p-3">
                  Fallback vence 24h: <span className="font-semibold">{jobsOverview.metrics.fallback_expiring_24h}</span>
                </div>
                <div className="rounded-2xl border border-rose-300/40 bg-rose-100/10 p-3">
                  Review cases open: <span className="font-semibold">{jobsOverview.metrics.review_cases_open}</span>
                </div>
                <div className="rounded-2xl border border-violet-300/40 bg-violet-100/10 p-3">
                  Escalated/suspended: <span className="font-semibold">{jobsOverview.metrics.charges_escalated_suspended}</span>
                </div>
                <div className="rounded-2xl border border-indigo-300/40 bg-indigo-100/10 p-3">
                  Late duplicates (30d): <span className="font-semibold">{jobsOverview.metrics.late_duplicates_last_30d}</span>
                </div>
                <div className="rounded-2xl border border-emerald-300/40 bg-emerald-100/10 p-3">
                  Recovery rate (30d): <span className="font-semibold">{jobsOverview.metrics.recovery_rate_30d}%</span>
                </div>
              </div>

              <div className="mt-5 overflow-auto">
                <table className="min-w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-left text-[11px] opacity-70">
                      <th className="pb-2 pr-3">Job</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Inicio</th>
                      <th className="pb-2 pr-3">Duración</th>
                      <th className="pb-2 pr-3">run_id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobsOverview.recent_runs.length === 0 ? (
                      <tr>
                        <td className="py-2 opacity-70" colSpan={5}>
                          Sin ejecuciones registradas.
                        </td>
                      </tr>
                    ) : (
                      jobsOverview.recent_runs.map((run) => (
                        <tr key={run.id_job_run} className="border-t border-white/20">
                          <td className="py-2 pr-3">{run.job_name}</td>
                          <td className="py-2 pr-3">{run.status}</td>
                          <td className="py-2 pr-3">{formatDateTime(run.started_at)}</td>
                          <td className="py-2 pr-3">{formatDurationMs(run.duration_ms)}</td>
                          <td className="py-2 pr-3">{run.run_id}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </article>

        <article className="rounded-3xl border border-white/30 bg-white/10 p-6 shadow-lg shadow-sky-900/10 backdrop-blur">
          <h2 className="text-lg font-semibold">Review cases contables</h2>
          <p className="mt-1 text-xs opacity-75">
            Casos de duplicados/pagos tardíos para resolución manual (first win).
          </p>
          <div className="mt-5 overflow-auto">
            <table className="min-w-full text-xs sm:text-sm">
              <thead>
                <tr className="text-left text-[11px] opacity-70">
                  <th className="pb-2 pr-3">Case</th>
                  <th className="pb-2 pr-3">Charge</th>
                  <th className="pb-2 pr-3">Tipo</th>
                  <th className="pb-2 pr-3">Canales</th>
                  <th className="pb-2 pr-3">Monto</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Detectado</th>
                  <th className="pb-2 pr-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {reviewCases.length === 0 ? (
                  <tr>
                    <td className="py-2 opacity-70" colSpan={8}>
                      Sin casos de revisión para el rango seleccionado.
                    </td>
                  </tr>
                ) : (
                  reviewCases.map((item) => (
                    <tr key={item.id_review_case} className="border-t border-white/20 align-top">
                      <td className="py-2 pr-3">#{item.id_review_case}</td>
                      <td className="py-2 pr-3">
                        #{item.charge_id}
                        <div className="text-[11px] opacity-70">agencia #{item.agency_id}</div>
                      </td>
                      <td className="py-2 pr-3">{item.type}</td>
                      <td className="py-2 pr-3">
                        {(item.primary_paid_channel || "-")} {"->"} {(item.secondary_late_channel || "-")}
                      </td>
                      <td className="py-2 pr-3">{formatArs(item.amount_ars)}</td>
                      <td className="py-2 pr-3">
                        <span className="inline-flex rounded-full border border-white/35 px-2 py-0.5 text-[11px]">
                          {item.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{formatDateTime(item.detected_at)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col gap-2">
                          {item.status === "OPEN" ? (
                            <button
                              type="button"
                              onClick={() => void handleStartReviewCase(item.id_review_case)}
                              disabled={updatingReviewCaseId === item.id_review_case}
                              className="w-fit rounded-full border border-sky-300/60 bg-sky-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
                            >
                              {updatingReviewCaseId === item.id_review_case
                                ? "Procesando..."
                                : "Start review"}
                            </button>
                          ) : null}
                          {item.status === "OPEN" || item.status === "IN_REVIEW" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleResolveReviewCase(item.id_review_case)}
                                disabled={updatingReviewCaseId === item.id_review_case}
                                className="w-fit rounded-full border border-emerald-300/60 bg-emerald-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
                              >
                                Resolver
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleIgnoreReviewCase(item.id_review_case)}
                                disabled={updatingReviewCaseId === item.id_review_case}
                                className="w-fit rounded-full border border-slate-300/60 bg-slate-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
                              >
                                Ignorar
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] opacity-70">
                              {item.resolution_type || "Sin acción"}
                            </span>
                          )}
                          {item.resolution_notes ? (
                            <div className="max-w-xs text-[11px] opacity-70">
                              {item.resolution_notes}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-3xl border border-white/30 bg-white/10 p-6 shadow-lg shadow-sky-900/10 backdrop-blur">
          <h2 className="text-lg font-semibold">Correr corrida (día ancla)</h2>
          <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={handleRunAnchor}>
            <label className="grid gap-1 text-sm">
              <span className="text-xs opacity-70">Fecha base</span>
              <input
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className="rounded-2xl border border-sky-200 bg-white/60 px-4 py-2 text-sm shadow-sm outline-none dark:border-sky-200/60 dark:bg-sky-100/10"
              />
            </label>

            <label className="mt-5 flex items-center gap-2 text-sm md:mt-7">
              <input
                type="checkbox"
                checked={overrideFx}
                onChange={(e) => setOverrideFx(e.target.checked)}
              />
              Permitir BSP anterior si falta el del día
            </label>

            <div className="md:col-span-2 md:flex md:items-end">
              <button
                type="submit"
                disabled={running}
                className="rounded-full border border-emerald-300/60 bg-emerald-100/5 px-4 py-2 text-sm font-medium shadow-sm shadow-emerald-900/10 transition hover:brightness-110 disabled:opacity-50"
              >
                {running ? "Ejecutando..." : "Correr corrida"}
              </button>
            </div>
          </form>

          {summary ? (
            <div className="mt-4 rounded-2xl border border-white/25 bg-white/15 p-4 text-sm">
              <div className="font-semibold">Última ejecución</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div>Ancla: {summary.anchor_date}</div>
                <div>Suscripciones: {summary.subscriptions_processed}/{summary.subscriptions_total}</div>
                <div>Ciclos creados: {summary.cycles_created}</div>
                <div>Cobros creados: {summary.charges_created}</div>
                <div>Intentos creados: {summary.attempts_created}</div>
                <div>Idempotentes: {summary.skipped_idempotent || 0}</div>
                <div>Errores: {summary.errors.length}</div>
              </div>
            </div>
          ) : null}
        </article>

        <article className="rounded-3xl border border-white/30 bg-white/10 p-6 shadow-lg shadow-sky-900/10 backdrop-blur">
          <h2 className="text-lg font-semibold">Filtros</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="grid gap-1 text-sm">
              <span className="text-xs opacity-70">Desde</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-2xl border border-sky-200 bg-white/60 px-4 py-2 text-sm shadow-sm outline-none dark:border-sky-200/60 dark:bg-sky-100/10"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs opacity-70">Hasta</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-2xl border border-sky-200 bg-white/60 px-4 py-2 text-sm shadow-sm outline-none dark:border-sky-200/60 dark:bg-sky-100/10"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs opacity-70">Estado cobro (opcional)</span>
              <input
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value.toUpperCase())}
                placeholder="READY / PAID / ..."
                className="rounded-2xl border border-sky-200 bg-white/60 px-4 py-2 text-sm shadow-sm outline-none dark:border-sky-200/60 dark:bg-sky-100/10"
              />
            </label>
            <div className="md:flex md:items-end">
              <button
                type="button"
                onClick={() => void loadData()}
                className="rounded-full border border-sky-300/60 bg-sky-100/5 px-4 py-2 text-sm font-medium shadow-sm shadow-sky-900/10 transition hover:brightness-110"
              >
                Recargar
              </button>
            </div>
          </div>
        </article>

        <article className="rounded-3xl border border-white/30 bg-white/10 p-6 shadow-lg shadow-sky-900/10 backdrop-blur">
          <h2 className="text-lg font-semibold">Pago Directo - Lotes</h2>

          <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={handleCreateBatch}>
            <label className="grid gap-1 text-sm">
              <span className="text-xs opacity-70">Fecha de negocio</span>
              <input
                type="date"
                value={batchDate}
                onChange={(e) => setBatchDate(e.target.value)}
                className="rounded-2xl border border-sky-200 bg-white/60 px-4 py-2 text-sm shadow-sm outline-none dark:border-sky-200/60 dark:bg-sky-100/10"
              />
            </label>

            <div className="md:col-span-3 md:flex md:items-end">
              <button
                type="submit"
                disabled={creatingBatch}
                className="rounded-full border border-emerald-300/60 bg-emerald-100/5 px-4 py-2 text-sm font-medium shadow-sm shadow-emerald-900/10 transition hover:brightness-110 disabled:opacity-50"
              >
                {creatingBatch ? "Creando lote..." : "Crear lote de presentación"}
              </button>
            </div>
          </form>

          {lastImportSummary ? (
            <div className="mt-4 rounded-2xl border border-white/25 bg-white/15 p-3 text-xs sm:text-sm">
              <span className="font-semibold">
                Última importación (lote #{lastImportSummary.outboundBatchId}):
              </span>{" "}
              {lastImportSummary.already_imported ? "ya importado previamente · " : ""}
              Matcheados {lastImportSummary.matched_rows} · Pagados {lastImportSummary.paid} ·
              Rechazados {lastImportSummary.rejected} · Errores {lastImportSummary.error_rows}
            </div>
          ) : null}

          <div className="mt-5 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs opacity-70">
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Dirección</th>
                  <th className="pb-2 pr-3">Adapter</th>
                  <th className="pb-2 pr-3">Fecha</th>
                  <th className="pb-2 pr-3">Estado</th>
                  <th className="pb-2 pr-3">Filas</th>
                  <th className="pb-2 pr-3">Total</th>
                  <th className="pb-2 pr-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr>
                    <td className="py-3 text-xs opacity-70" colSpan={8}>
                      Sin lotes para el rango seleccionado.
                    </td>
                  </tr>
                ) : (
                  batches.map((batch) => (
                    <tr key={batch.id_batch} className="border-t border-white/20 align-top">
                      <td className="py-2 pr-3">#{batch.id_batch}</td>
                      <td className="py-2 pr-3">
                        {batch.direction}
                        {batch.parent_batch_id ? ` · resp. de #${batch.parent_batch_id}` : ""}
                      </td>
                      <td className="py-2 pr-3">
                        {batch.adapter || "-"}
                        {batch.adapter_version ? (
                          <div className="text-[11px] opacity-70">{batch.adapter_version}</div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{formatDate(batch.business_date)}</td>
                      <td className="py-2 pr-3">{batch.status}</td>
                      <td className="py-2 pr-3">{batch.total_rows}</td>
                      <td className="py-2 pr-3">{formatArs(batch.total_amount_ars)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col gap-2">
                          {batch.storage_key ? (
                            <button
                              type="button"
                              onClick={() => void handleDownloadBatch(batch.id_batch)}
                              className="w-fit rounded-full border border-sky-300/60 bg-sky-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110"
                            >
                              Descargar
                            </button>
                          ) : null}

                          {batch.direction === "OUTBOUND" ? (
                            <div className="flex flex-col gap-2">
                              <input
                                type="file"
                                accept=".csv,text/csv"
                                onChange={(e) => {
                                  const file = e.target.files?.[0] || null;
                                  setSelectedResponseFileByBatch((prev) => ({
                                    ...prev,
                                    [batch.id_batch]: file,
                                  }));
                                }}
                                className="text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => void handleImportResponse(batch.id_batch)}
                                disabled={
                                  uploadingBatchId === batch.id_batch ||
                                  !selectedResponseFileByBatch[batch.id_batch]
                                }
                                className="w-fit rounded-full border border-amber-300/60 bg-amber-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
                              >
                                {uploadingBatchId === batch.id_batch
                                  ? "Importando..."
                                  : "Importar respuesta"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-3xl border border-white/30 bg-white/10 p-6 shadow-lg shadow-sky-900/10 backdrop-blur">
          <h2 className="text-lg font-semibold">Ciclos recientes</h2>
          {loading ? (
            <div className="mt-4 flex min-h-[15vh] items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs opacity-70">
                    <th className="pb-2 pr-3">Agencia</th>
                    <th className="pb-2 pr-3">Ancla</th>
                    <th className="pb-2 pr-3">Período</th>
                    <th className="pb-2 pr-3">BSP</th>
                    <th className="pb-2 pr-3">Total ARS</th>
                    <th className="pb-2 pr-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.length === 0 ? (
                    <tr>
                      <td className="py-3 text-xs opacity-70" colSpan={6}>
                        Sin ciclos en el rango.
                      </td>
                    </tr>
                  ) : (
                    cycles.map((cycle) => (
                      <tr key={cycle.id_cycle} className="border-t border-white/20">
                        <td className="py-2 pr-3">#{cycle.id_agency}</td>
                        <td className="py-2 pr-3">{formatDate(cycle.anchor_date)}</td>
                        <td className="py-2 pr-3">
                          {formatDate(cycle.period_start)} - {formatDate(cycle.period_end)}
                        </td>
                        <td className="py-2 pr-3">
                          {cycle.fx_rate_ars_per_usd != null
                            ? Number(cycle.fx_rate_ars_per_usd).toFixed(2)
                            : "-"}
                        </td>
                        <td className="py-2 pr-3">{formatArs(cycle.total_ars)}</td>
                        <td className="py-2 pr-3">{cycle.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="rounded-3xl border border-white/30 bg-white/10 p-6 shadow-lg shadow-sky-900/10 backdrop-blur">
          <h2 className="text-lg font-semibold">Cobros recientes</h2>
          {loading ? (
            <div className="mt-4 flex min-h-[15vh] items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs opacity-70">
                    <th className="pb-2 pr-3">Agencia</th>
                    <th className="pb-2 pr-3">Vencimiento</th>
                    <th className="pb-2 pr-3">Estado</th>
                    <th className="pb-2 pr-3">Dunning</th>
                    <th className="pb-2 pr-3">Importe ARS</th>
                    <th className="pb-2 pr-3">Intentos</th>
                    <th className="pb-2 pr-3">Canal pago</th>
                    <th className="pb-2 pr-3">Fallback</th>
                    <th className="pb-2 pr-3">Fiscal</th>
                    <th className="pb-2 pr-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.length === 0 ? (
                    <tr>
                      <td className="py-3 text-xs opacity-70" colSpan={10}>
                        Sin cobros en el rango.
                      </td>
                    </tr>
                  ) : (
                    charges.map((charge) => {
                      const latestFallback = charge.fallback_intents[0] || null;
                      const isFallbackOpen = latestFallback
                        ? ["CREATED", "PENDING", "PRESENTED"].includes(latestFallback.status)
                        : false;
                      const stageMeta = dunningStageMeta(charge.dunning_stage);
                      const reviewCase = openReviewCaseByCharge.get(charge.id_charge);

                      return (
                        <tr key={charge.id_charge} className="border-t border-white/20">
                          <td className="py-2 pr-3">#{charge.id_agency}</td>
                          <td className="py-2 pr-3">{formatDate(charge.due_date)}</td>
                          <td className="py-2 pr-3">{charge.status}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${stageMeta.badgeClass}`}
                            >
                              {charge.dunning_stage} · {stageMeta.label}
                            </span>
                          </td>
                          <td className="py-2 pr-3">{formatArs(charge.amount_ars_due)}</td>
                          <td className="py-2 pr-3">
                            {charge.attempts
                              .map((attempt) => `#${attempt.attempt_no} ${attempt.status}`)
                              .join(" · ") || "-"}
                            {charge.attempts[0]?.processor_result_code ? (
                              <div className="mt-1 text-[11px] opacity-75">
                                Banco: {charge.attempts[0].processor_result_code}
                                {charge.attempts[0].processor_trace_id
                                  ? ` · trace ${charge.attempts[0].processor_trace_id}`
                                  : ""}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3">
                            {charge.paid_via_channel || charge.collection_channel || "-"}
                            {reviewCase ? (
                              <div className="mt-1">
                                <span className="inline-flex rounded-full border border-rose-300/60 bg-rose-100/10 px-2 py-0.5 text-[11px] text-rose-100">
                                  review pending #{reviewCase.id_review_case}
                                </span>
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            {latestFallback ? (
                              <div className="space-y-1">
                                <div>
                                  {latestFallback.provider} · {latestFallback.status}
                                </div>
                                <div className="opacity-75">
                                  expira {formatDateTime(latestFallback.expires_at)}
                                </div>
                                {latestFallback.payment_url ? (
                                  <a
                                    className="text-sky-200 underline"
                                    href={latestFallback.payment_url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Link pago
                                  </a>
                                ) : null}
                              </div>
                            ) : (
                              <span className="opacity-60">-</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {fiscalStatusLabel(charge.fiscal_document?.status)}
                            {charge.fiscal_document?.afip_number ? (
                              <div className="mt-1 text-[11px] opacity-80">
                                N° AFIP {charge.fiscal_document.afip_number}
                              </div>
                            ) : null}
                            {charge.fiscal_document?.issued_at ? (
                              <div className="mt-1 text-[11px] opacity-70">
                                {formatDateTime(charge.fiscal_document.issued_at)}
                              </div>
                            ) : null}
                            {charge.fiscal_document?.error_message ? (
                              <div className="mt-1 max-w-xs text-[11px] opacity-75">
                                {charge.fiscal_document.error_message}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => void handleCreateFallbackForCharge(charge.id_charge)}
                                disabled={runningJob != null}
                                className="w-fit rounded-full border border-amber-300/60 bg-amber-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
                              >
                                {runningJob === `fallback_create_${charge.id_charge}`
                                  ? "Creando..."
                                  : "Crear fallback"}
                              </button>

                              {latestFallback ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleMarkFallbackPaid(latestFallback.id_fallback_intent)
                                    }
                                    disabled={updatingFallbackIntentId === latestFallback.id_fallback_intent}
                                    className="w-fit rounded-full border border-emerald-300/60 bg-emerald-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
                                  >
                                    {updatingFallbackIntentId === latestFallback.id_fallback_intent
                                      ? "Procesando..."
                                      : "Simular pago"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleCancelFallback(latestFallback.id_fallback_intent)
                                    }
                                    disabled={
                                      updatingFallbackIntentId === latestFallback.id_fallback_intent ||
                                      !isFallbackOpen
                                    }
                                    className="w-fit rounded-full border border-slate-300/60 bg-slate-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
                                  >
                                    Cancelar fallback
                                  </button>
                                </>
                              ) : null}

                              {charge.fiscal_document?.status === "FAILED" ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRetryIssueFiscal(charge.id_charge)}
                                  disabled={retryingFiscalChargeId === charge.id_charge}
                                  className="w-fit rounded-full border border-rose-300/60 bg-rose-100/10 px-3 py-1 text-xs font-medium transition hover:brightness-110 disabled:opacity-50"
                                >
                                  {retryingFiscalChargeId === charge.id_charge
                                    ? "Reintentando..."
                                    : "Reintentar fiscal"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
      <ToastContainer position="top-right" autoClose={2200} />
    </ProtectedRoute>
  );
}
