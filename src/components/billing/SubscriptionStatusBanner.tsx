"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { normalizeRole } from "@/utils/permissions";

type Overview = {
  status: "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" | string;
  next_anchor_date: string | Date;
  retry_days: number[];
  method_type: string | null;
  mandate_status:
    | "PENDING"
    | "PENDING_BANK"
    | "ACTIVE"
    | "REVOKED"
    | "REJECTED"
    | "EXPIRED"
    | string
    | null;
  next_attempt_at?: string | Date | null;
  flags?: {
    in_collection: boolean;
    is_past_due: boolean;
    is_suspended: boolean;
    retries_exhausted?: boolean;
  };
  in_collection?: boolean;
  is_past_due?: boolean;
  is_suspended?: boolean;
};

const ALLOWED_ROLES = new Set(["desarrollador"]);

function formatDateTime(value?: string | Date | null): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date);
}

export default function SubscriptionStatusBanner() {
  const { token, role, loading } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ready, setReady] = useState(false);

  const normalizedRole = useMemo(() => normalizeRole(role), [role]);
  const canView = ALLOWED_ROLES.has(normalizedRole);

  useEffect(() => {
    if (!token || !canView) {
      setOverview(null);
      setReady(true);
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await authFetch(
          "/api/agency/subscription/overview",
          { cache: "no-store" },
          token,
        );
        if (!res.ok) {
          if (alive) {
            setOverview(null);
            setReady(true);
          }
          return;
        }

        const data = (await res.json()) as Overview;
        if (!alive) return;
        setOverview(data);
      } catch {
        if (!alive) return;
        setOverview(null);
      } finally {
        if (alive) setReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [canView, token]);

  if (loading || !ready || !canView || !overview) return null;
  const flags = overview.flags || {
    in_collection: Boolean(overview.in_collection),
    is_past_due: Boolean(overview.is_past_due),
    is_suspended: Boolean(overview.is_suspended),
    retries_exhausted: false,
  };

  const nextAttemptAt = overview.next_attempt_at
    ? formatDateTime(overview.next_attempt_at)
    : null;

  if (flags.is_suspended) {
    return (
      <div className="mb-3 rounded-2xl border border-rose-300/70 bg-rose-100/30 px-4 py-2 text-sm font-medium text-rose-900 shadow-sm dark:border-rose-300/40 dark:bg-rose-500/10 dark:text-rose-50">
        Cuenta suspendida por falta de pago. Regularizá para reactivar el servicio.
      </div>
    );
  }

  if (flags.is_past_due) {
    return (
      <div className="mb-3 rounded-2xl border border-amber-300/70 bg-amber-100/30 px-4 py-2 text-sm text-amber-900 shadow-sm dark:border-amber-300/40 dark:bg-amber-500/10 dark:text-amber-50">
        <span className="font-semibold">Cuota vencida.</span>{" "}
        {nextAttemptAt
          ? `Próximo reintento: ${nextAttemptAt}.`
          : "Sin reintentos pendientes."}
      </div>
    );
  }

  if (flags.in_collection) {
    return (
      <div className="mb-3 rounded-2xl border border-yellow-300/70 bg-yellow-100/30 px-4 py-2 text-sm text-yellow-900 shadow-sm dark:border-yellow-300/40 dark:bg-yellow-500/10 dark:text-yellow-50">
        Cobro en proceso.
        {nextAttemptAt ? ` Próximo intento: ${nextAttemptAt}.` : ""}
      </div>
    );
  }

  return null;
}
