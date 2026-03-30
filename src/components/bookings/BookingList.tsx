// src/components/bookings/BookingList.tsx
"use client";
import React from "react";
import Link from "next/link";
import BookingCard from "./BookingCard";
import { Booking } from "@/types";
import {
  ACTION_BUTTON,
  DANGER_BUTTON,
  ICON_BUTTON,
  getStatusChipClasses,
} from "./palette";
import {
  formatDateInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";

export type BookingViewMode = "grid" | "list";

interface BookingListProps {
  bookings: Booking[];
  expandedBookingId: number | null;
  setExpandedBookingId: React.Dispatch<React.SetStateAction<number | null>>;
  startEditingBooking: (booking: Booking) => void;
  duplicateBooking: (booking: Booking) => Promise<void>;
  deleteBooking: (id: number) => void;
  role?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  viewMode?: BookingViewMode;
}

export default function BookingList({
  bookings,
  expandedBookingId,
  setExpandedBookingId,
  startEditingBooking,
  duplicateBooking,
  deleteBooking,
  role,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  viewMode = "grid",
}: BookingListProps) {
  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return "N/A";
    const key = toDateKeyInBuenosAiresLegacySafe(dateString);
    if (!key) return "N/A";
    return formatDateInBuenosAires(key);
  };

  const content =
    viewMode === "list" ? (
      <div className="flex flex-col gap-3">
        {bookings.map((booking) => (
          <BookingListRow
            key={`row-${booking.id_booking}`}
            booking={booking}
            expandedBookingId={expandedBookingId}
            setExpandedBookingId={setExpandedBookingId}
            formatDate={formatDate}
            startEditingBooking={startEditingBooking}
            duplicateBooking={duplicateBooking}
            deleteBooking={deleteBooking}
            role={role}
          />
        ))}
      </div>
    ) : (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {bookings.map((booking) => (
          <BookingCard
            key={booking.id_booking}
            booking={booking}
            expandedBookingId={expandedBookingId}
            setExpandedBookingId={setExpandedBookingId}
            formatDate={formatDate}
            startEditingBooking={startEditingBooking}
            duplicateBooking={duplicateBooking}
            deleteBooking={deleteBooking}
            role={role}
          />
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {content}

      {hasMore && onLoadMore && (
        <div className="flex w-full justify-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className={`${ACTION_BUTTON} px-6 py-2 text-sm font-semibold disabled:opacity-60 dark:backdrop-blur`}
          >
            {loadingMore ? "Cargando..." : "Ver más"}
          </button>
        </div>
      )}
    </div>
  );
}

type BookingRowProps = {
  booking: Booking;
  expandedBookingId: number | null;
  setExpandedBookingId: React.Dispatch<React.SetStateAction<number | null>>;
  formatDate: (date: string | undefined) => string;
  startEditingBooking: (booking: Booking) => void;
  duplicateBooking: (booking: Booking) => Promise<void>;
  deleteBooking: (id: number) => void;
  role?: string;
};

function BookingListRow({
  booking,
  expandedBookingId,
  setExpandedBookingId,
  formatDate,
  startEditingBooking,
  duplicateBooking,
  deleteBooking,
  role,
}: BookingRowProps) {
  const [isDuplicating, setIsDuplicating] = React.useState(false);
  const duplicateLockRef = React.useRef(false);
  const isExpanded = expandedBookingId === booking.id_booking;
  const toggleRow = () =>
    setExpandedBookingId((prevId) =>
      prevId === booking.id_booking ? null : booking.id_booking,
    );
  const canManage =
    booking.status === "Abierta" ||
    role === "administrativo" ||
    role === "desarrollador" ||
    role === "gerente";

  const handleEdit = () => {
    startEditingBooking(booking);
  };

  const handleDuplicate = async () => {
    if (duplicateLockRef.current) return;
    duplicateLockRef.current = true;
    setIsDuplicating(true);
    try {
      await duplicateBooking(booking);
    } finally {
      duplicateLockRef.current = false;
      setIsDuplicating(false);
    }
  };

  const formatStatus = (value?: string) => {
    if (!value) return "—";
    const lower = value.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  const statusChip = (label: string, value: string) => (
    <span className={getStatusChipClasses(value)}>
      {label}: {value}
    </span>
  );

  const passengers = booking.clients || [];
  const departure = formatDate(booking.departure_date);
  const returnDate = formatDate(booking.return_date);
  const creationDate = formatDate(booking.creation_date);
  const paxCount = Math.max(1, booking.pax_count);
  const bookingNumber =
    typeof booking.agency_booking_id === "number" &&
    Number.isFinite(booking.agency_booking_id) &&
    booking.agency_booking_id > 0
      ? String(Math.trunc(booking.agency_booking_id))
      : "Sin Nº";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-3 text-sky-950 shadow-sm shadow-sky-950/10 backdrop-blur dark:bg-white/5 dark:text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-900/80 dark:text-sky-100/80">
            Nº {bookingNumber}
          </span>
          <p className="text-base font-semibold text-sky-950 dark:text-white">
            {booking.details.toUpperCase() || "Sin detalle"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statusChip("Pax", formatStatus(booking.clientStatus))}
          {statusChip("Operador", formatStatus(booking.operatorStatus))}
          <button
            onClick={toggleRow}
            className={`${ICON_BUTTON} p-2`}
            aria-label={isExpanded ? "Ocultar detalles" : "Mostrar detalles"}
          >
            {isExpanded ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="size-5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="size-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-sky-900/80 dark:text-sky-100/80">
        <span className="font-semibold text-sky-950 dark:text-white">
          {booking.titular.first_name} {booking.titular.last_name}
        </span>
        <span className="text-sky-900/50 dark:text-sky-100/50">•</span>
        <span className="font-medium text-sky-950 dark:text-white">
          {booking.user.first_name} {booking.user.last_name}
        </span>
        <span className="text-sky-900/50 dark:text-sky-100/50">•</span>
        <span className="font-semibold text-sky-950 dark:text-white">
          {departure}
        </span>
        <span className="text-sky-900/60 dark:text-sky-100/60">→</span>
        <span className="font-semibold text-sky-950 dark:text-white">
          {returnDate}
        </span>
        <span className="text-sky-900/50 dark:text-sky-100/50">•</span>
        <span>{paxCount} pax</span>
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-3 border-t border-white/10 pt-4 text-sm dark:border-white/10">
          <div className="rounded-3xl border border-white/10 bg-white/40 px-4 py-3 text-sky-950 shadow shadow-sky-950/5 dark:bg-white/10 dark:text-white">
            <p className="text-[10px] uppercase tracking-[0.2em] text-sky-900/70 dark:text-sky-100/70">
              Duración del viaje
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span>{departure}</span>
              <span className="text-[11px] font-bold tracking-[0.4em] text-sky-900/50 dark:text-sky-100/60">
                →
              </span>
              <span>{returnDate}</span>
            </div>
            <p className="text-xs text-sky-900/70 dark:text-sky-100/70">
              Creada {creationDate} • {paxCount} pax
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-sky-900/80 dark:text-sky-100/80">
              Facturación
            </p>
            <p className="text-sm text-sky-950 dark:text-white">
              {booking.invoice_type || "Sin datos"} •{" "}
              {booking.invoice_observation || "Sin observaciones"}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-sky-900/80 dark:text-sky-100/80">
              Observaciones
            </p>
            <p className="text-sm text-sky-950 dark:text-white">
              {booking.observation || "Sin observaciones"}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-sky-900/80 dark:text-sky-100/80">
              Pasajeros
            </p>
            <ul className="ml-4 list-disc text-sm text-sky-950 dark:text-white">
              <li>
                {booking.titular.first_name} {booking.titular.last_name}
              </li>
              {passengers.map((client) => (
                <li key={client.id_client}>
                  {client.first_name} {client.last_name}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/bookings/services/${booking.public_id ?? booking.id_booking}`}
              className={`${ACTION_BUTTON} flex gap-1 px-4 py-2 text-sm font-semibold`}
            >
              Reserva
            </Link>
            {canManage && (
              <button
                className={`${ACTION_BUTTON} flex items-center gap-1 px-4 py-2 text-sm font-semibold disabled:opacity-60`}
                onClick={() => {
                  void handleDuplicate();
                }}
                disabled={isDuplicating}
              >
                {isDuplicating ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="size-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="opacity-30"
                    />
                    <path
                      d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3Z"
                      fill="currentColor"
                      className="opacity-90"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 7.5H6a2.25 2.25 0 0 0-2.25 2.25v8.25A2.25 2.25 0 0 0 6 20.25h8.25A2.25 2.25 0 0 0 16.5 18v-2.25M9.75 3.75H18A2.25 2.25 0 0 1 20.25 6v8.25A2.25 2.25 0 0 1 18 16.5H9.75A2.25 2.25 0 0 1 7.5 14.25V6A2.25 2.25 0 0 1 9.75 3.75Z"
                    />
                  </svg>
                )}
                Duplicar
              </button>
            )}
            {canManage && (
              <button
                className={`${ACTION_BUTTON} px-4 py-2 text-sm font-semibold`}
                onClick={handleEdit}
              >
                Editar
              </button>
            )}
            {canManage && (
              <button
                className={`${DANGER_BUTTON} px-4 py-2 text-sm font-semibold`}
                onClick={() => deleteBooking(booking.id_booking)}
              >
                Eliminar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
