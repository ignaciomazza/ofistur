// src/components/receipts/ReceiptList.tsx

import { Receipt, Booking, Service } from "@/types";
import ReceiptCard from "./ReceiptCard";
import Spinner from "@/components/Spinner";
import "react-toastify/dist/ReactToastify.css";

interface ReceiptListProps {
  token: string | null;
  receipts: Receipt[];
  booking: Booking;
  services: Service[];
  role: string;
  onReceiptDeleted?: (id: number) => void;
  onReceiptEdit?: (receipt: Receipt) => void;
  onReceiptDuplicated?: () => void;
}

export default function ReceiptList({
  token,
  receipts,
  booking,
  services,
  role,
  onReceiptDeleted,
  onReceiptEdit,
  onReceiptDuplicated,
}: ReceiptListProps) {
  if (!receipts || receipts.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {receipts
        .filter((r) => r && r.id_receipt)
        .map((receipt) => (
          <ReceiptCard
            key={receipt.id_receipt}
            token={token}
            receipt={receipt}
            booking={booking}
            services={services}
            role={role}
            onReceiptDeleted={onReceiptDeleted}
            onReceiptEdit={onReceiptEdit}
            onReceiptDuplicated={onReceiptDuplicated}
          />
        ))}
    </div>
  );
}
