// src/components/client-payments/ClientPaymentList.tsx
"use client";

import { useMemo } from "react";
import { Booking, ClientPayment } from "@/types";
import Spinner from "@/components/Spinner";
import ClientPaymentCard from "./ClientPaymentCard";

interface Props {
  payments: ClientPayment[] | undefined;
  booking: Booking;
  role: string;
  onPaymentDeleted?: (id: number) => void;
  loading?: boolean;
}

export default function ClientPaymentList({
  payments,
  booking,
  role,
  onPaymentDeleted,
  loading = false,
}: Props) {
  const validPayments = useMemo(
    () =>
      (payments ?? []).filter(
        (p) => p && typeof p.id_payment === "number",
      ),
    [payments],
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (validPayments.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/10 p-6 text-center shadow-md backdrop-blur dark:border-white/10 dark:bg-white/10">
        No hay pagos registrados
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {validPayments.map((payment) => (
        <ClientPaymentCard
          key={payment.id_payment}
          payment={payment}
          booking={booking}
          role={role}
          onPaymentDeleted={onPaymentDeleted}
        />
      ))}
    </div>
  );
}
