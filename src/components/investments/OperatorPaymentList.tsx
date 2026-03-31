// src/components/investments/OperatorPaymentList.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import { toast } from "react-toastify";
import { authFetch } from "@/utils/authFetch";
import type { Service } from "@/types";
import OperatorPaymentCard, {
  InvestmentItem,
} from "@/components/investments/OperatorPaymentCard";

type Props = {
  token: string | null;
  bookingId?: number; // listar pagos asociados a esta reserva
  operatorId?: number; // opcional: filtrar por operador
  services?: Service[];
  role?: string;
  className?: string;
  reloadKey?: number; // forzar refetch al cambiar
  onEditPayment?: (item: InvestmentItem) => void;
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

export default function OperatorPaymentList({
  token,
  bookingId,
  operatorId,
  services,
  role,
  className,
  reloadKey,
  onEditPayment,
}: Props) {
  const [items, setItems] = useState<InvestmentItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // safety: abort prev request
  const listAbortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("take", "24");
    qs.set("operatorOnly", "1");
    qs.set("includeAllocations", "1");
    if (operatorId) qs.set("operatorId", String(operatorId));
    if (bookingId) qs.set("bookingId", String(bookingId));
    return qs.toString();
  }, [bookingId, operatorId]);

  const belongsToBooking = useCallback(
    (item: InvestmentItem) => {
      if (!bookingId) return true;
      if (Number(item.booking_id) === bookingId) return true;
      if (!Array.isArray(item.allocations)) return false;
      return item.allocations.some(
        (alloc) => Number(alloc?.booking_id) === bookingId,
      );
    },
    [bookingId],
  );

  const fetchList = useCallback(async () => {
    if (!token) return;
    setLoadingList(true);

    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    const myId = ++reqIdRef.current;

    try {
      // 🧰 Cambio: credentials: "omit" para evitar cookies
      const res = await authFetch(
        `/api/investments?${queryString}`,
        { cache: "no-store", signal: controller.signal, credentials: "omit" },
        token,
      );

      if (!res.ok) {
        // Fallback por si tu back no soportara bookingId (lo filtramos client-side).
        const onlyCategory = await authFetch(
          `/api/investments?take=24&operatorOnly=1&includeAllocations=1${operatorId ? `&operatorId=${operatorId}` : ""}`,
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
        const filtered = bookingId ? items.filter(belongsToBooking) : items;
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
  }, [token, queryString, operatorId, bookingId, belongsToBooking]);

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

      // Si el backend no filtra por bookingId, filtramos client-side
      const filtered = bookingId ? more.filter(belongsToBooking) : more;

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
  }, [token, nextCursor, loadingMore, queryString, bookingId, belongsToBooking]);

  const handleDeleted = useCallback((id: number) => {
    setItems((prev) => prev.filter((it) => it.id_investment !== id));
  }, []);

  return (
    <div className={`space-y-4 ${className ?? ""}`}>
      <div>
        {loadingList ? (
          <div className="flex min-h-[16vh] items-center">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/10 p-6 text-center shadow-md backdrop-blur dark:border-white/10 dark:bg-white/10">
            No hay pagos cargados {bookingId ? "para esta reserva." : "."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((it) => (
                <OperatorPaymentCard
                  key={it.id_investment}
                  item={it}
                  services={services}
                  token={token}
                  role={role}
                  onDeleted={handleDeleted}
                  onEdit={onEditPayment}
                />
              ))}
            </div>

            {nextCursor && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full bg-sky-100 px-6 py-2 text-sky-950 shadow-sm shadow-sky-950/20 transition-transform hover:scale-95 active:scale-90 disabled:opacity-60 dark:bg-white/10 dark:text-white"
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
