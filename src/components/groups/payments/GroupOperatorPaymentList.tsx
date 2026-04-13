// src/components/groups/payments/GroupOperatorPaymentList.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import { toast } from "react-toastify";
import { authFetch } from "@/utils/authFetch";
import GroupOperatorPaymentCard, {
  InvestmentItem,
} from "@/components/groups/payments/GroupOperatorPaymentCard";

type Props = {
  token: string | null;
  groupId?: string;
  scopeKey?: string;
  groupPassengerId?: number | null;
  contextId?: number; // listar pagos asociados a este contexto
  operatorId?: number; // opcional: filtrar por operador
  role?: string;
  className?: string;
  reloadKey?: number; // forzar refetch al cambiar
  onPaymentEdit?: (item: InvestmentItem) => void;
  onPaymentDeleted?: (id: number) => void;
};

type ApiError = { error?: string; message?: string; details?: string };

const getApiErrorMessage = (
  body: ApiError | null,
  fallback: string,
): string => {
  if (!body) return fallback;
  const error = typeof body.error === "string" ? body.error.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const details = typeof body.details === "string" ? body.details.trim() : "";
  if (error && details && details !== error) return `${error} (${details})`;
  if (message && details && details !== message) return `${message} (${details})`;
  return error || message || details || fallback;
};

export default function GroupOperatorPaymentList({
  token,
  groupId,
  scopeKey,
  groupPassengerId,
  contextId,
  operatorId,
  role,
  className,
  reloadKey,
  onPaymentEdit,
  onPaymentDeleted,
}: Props) {
  const [items, setItems] = useState<InvestmentItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // safety: abort prev request
  const listAbortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  const queryString = useMemo(() => {
    if (groupId) {
      const qs = new URLSearchParams();
      if (scopeKey) qs.set("scope", scopeKey);
      if (groupPassengerId && groupPassengerId > 0) {
        qs.set("passengerId", String(groupPassengerId));
      }
      return qs.toString();
    }
    const qs = new URLSearchParams();
    qs.set("take", "24");
    qs.set("operatorOnly", "1");
    if (operatorId) qs.set("operatorId", String(operatorId));
    if (contextId) {
      qs.set("contextId", String(contextId));
      qs.set("bookingId", String(contextId));
    }
    return qs.toString();
  }, [contextId, groupId, groupPassengerId, operatorId, scopeKey]);

  const fetchList = useCallback(async () => {
    if (!token) return;
    setLoadingList(true);

    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    const myId = ++reqIdRef.current;

    try {
      if (groupId) {
        const url = `/api/groups/${encodeURIComponent(groupId)}/finance/operator-payments${
          queryString ? `?${queryString}` : ""
        }`;
        const res = await authFetch(
          url,
          { cache: "no-store", signal: controller.signal },
          token,
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiError | null;
          throw new Error(getApiErrorMessage(body, "No se pudo obtener la lista"));
        }
        const data = (await res.json()) as {
          items?: InvestmentItem[];
          nextCursor?: number | null;
        };
        if (myId !== reqIdRef.current) return;
        setItems(Array.isArray(data.items) ? data.items : []);
        setNextCursor(data.nextCursor ?? null);
        return;
      }

      // credentials: "omit" para evitar mezclar cookies
      const res = await authFetch(
        `/api/investments?${queryString}`,
        { cache: "no-store", signal: controller.signal, credentials: "omit" },
        token,
      );

      if (!res.ok) {
        // Fallback por si el backend no soporta filtro por contexto.
        const onlyCategory = await authFetch(
          `/api/investments?take=24&operatorOnly=1${operatorId ? `&operatorId=${operatorId}` : ""}`,
          { cache: "no-store", signal: controller.signal, credentials: "omit" },
          token,
        );
        if (!onlyCategory.ok) {
          const body = (await onlyCategory
            .json()
            .catch(() => null)) as ApiError | null;
          throw new Error(
            getApiErrorMessage(body, "No se pudo obtener la lista"),
          );
        }
        const { items, nextCursor } = (await onlyCategory.json()) as {
          items: InvestmentItem[];
          nextCursor: number | null;
        };
        if (myId !== reqIdRef.current) return;
        const filtered = contextId
          ? items.filter(
              (i) => (i.context_id ?? i.booking_id ?? null) === contextId,
            )
          : items;
        setItems(filtered);
        setNextCursor(nextCursor ?? null);
        return;
      }

      const { items, nextCursor } = (await res.json()) as {
        items: InvestmentItem[];
        nextCursor: number | null;
      };
      if (myId !== reqIdRef.current) return;
      setItems(items);
      setNextCursor(nextCursor ?? null);
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Error cargando pagos al operador",
      );
      setItems([]);
      setNextCursor(null);
    } finally {
      if (!controller.signal.aborted) setLoadingList(false);
    }
  }, [token, queryString, operatorId, contextId, groupId]);

  // Carga inicial / cuando cambien dependencias
  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Refetch explícito (después de crear un pago)
  useEffect(() => {
    if (reloadKey === undefined) return;
    fetchList();
  }, [fetchList, reloadKey]);

  const loadMore = useCallback(async () => {
    if (groupId) return;
    if (!token || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const baseQS = new URLSearchParams(queryString);
      baseQS.set("cursor", String(nextCursor));

      // 🧰 Cambio: credentials: "omit" para evitar cookies
      const res = await authFetch(
        `/api/investments?${baseQS.toString()}`,
        { cache: "no-store", credentials: "omit" },
        token,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(
          getApiErrorMessage(body, "No se pudieron cargar más"),
        );
      }
      const { items: more, nextCursor: c } = (await res.json()) as {
        items: InvestmentItem[];
        nextCursor: number | null;
      };

      // Si el backend no filtra por contextId, filtramos client-side
      const filtered = contextId
        ? more.filter(
            (i) => (i.context_id ?? i.booking_id ?? null) === contextId,
          )
        : more;

      setItems((prev) => [...prev, ...filtered]);
      setNextCursor(c ?? null);
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "No se pudieron cargar más registros",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [token, nextCursor, loadingMore, queryString, contextId, groupId]);

  return (
    <div className={`space-y-6 ${className ?? ""}`}>
      <div className="space-y-6">
        {loadingList ? (
          <div className="flex min-h-[18vh] items-center">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-sky-300/80 bg-white p-5 text-center text-[13px] text-slate-700 shadow-sm shadow-slate-900/10 backdrop-blur-sm dark:border-sky-600/30 dark:bg-sky-950/10 dark:text-slate-300 md:text-sm">
            {groupId
              ? "No hay pagos registrados para esta salida."
              : `No hay pagos registrados ${contextId ? "para este contexto." : "."}`}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {items.map((it) => (
                <GroupOperatorPaymentCard
                  key={it.id_investment}
                  item={it}
                  token={token}
                  groupId={groupId}
                  role={role}
                  onEdit={onPaymentEdit}
                  onDeleted={(id) => {
                    setItems((prev) =>
                      prev.filter((item) => item.id_investment !== id),
                    );
                    onPaymentDeleted?.(id);
                  }}
                />
              ))}
            </div>

            {nextCursor && (
              <div className="flex justify-center pt-1">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-sky-300/80 bg-sky-100/80 px-6 py-2 text-[13px] font-semibold text-sky-900 shadow-sm shadow-sky-100/60 transition hover:bg-sky-100 disabled:opacity-60 dark:border-sky-700 dark:bg-sky-900/25 dark:text-sky-100 dark:hover:bg-sky-900/35 md:text-sm"
                >
                  {loadingMore ? <Spinner /> : "Ver más"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
