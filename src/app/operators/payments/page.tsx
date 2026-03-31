// src/app/operators/payments/page.tsx
"use client";

import { Suspense } from "react";
import InvestmentsPage from "@/app/investments/page";

export default function OperatorPaymentsPage() {
  return (
    <Suspense fallback={null}>
      <InvestmentsPage />
    </Suspense>
  );
}
