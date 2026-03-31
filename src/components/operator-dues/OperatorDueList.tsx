import { useMemo } from "react";
import { Booking, Operator, OperatorDue } from "@/types";
import Spinner from "@/components/Spinner";
import OperatorDueCard from "@/components/operator-dues/OperatorDueCard";

interface Props {
  dues: OperatorDue[] | undefined;
  booking: Booking;
  role: string;
  onDueDeleted?: (id: number) => void;
  onStatusChanged?: (id: number, status: OperatorDue["status"]) => void;
  loading?: boolean; // nuevo flag
  operators: Operator[];
}

export default function OperatorDueList({
  dues,
  booking,
  role,
  onDueDeleted,
  onStatusChanged,
  loading = false,
  operators,
}: Props) {
  const validDues = useMemo(
    () =>
      (dues ?? []).filter((d) => d && typeof d.id_due === "number"),
    [dues],
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (validDues.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/10 p-6 text-center shadow-md backdrop-blur dark:border-white/10 dark:bg-white/10">
        No hay vencimientos registrados
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {validDues.map((due) => (
        <OperatorDueCard
          key={due.id_due}
          due={due}
          booking={booking}
          operators={operators}
          role={role}
          onDueDeleted={onDueDeleted}
          onStatusChanged={onStatusChanged}
        />
      ))}
    </div>
  );
}
