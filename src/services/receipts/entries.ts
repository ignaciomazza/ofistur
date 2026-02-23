// src/services/receipts/entries.ts
import { authFetch } from "@/utils/authFetch";

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function createCreditEntryForReceipt(args: {
  token: string;
  receiptId: number;
  amount: number;
  currency: string;
  concept: string;
  bookingId?: number | null;
  operatorId: number;
  agencyId?: number | null;

  // ✅ NUEVO
  creditAccountId: number;
}) {
  const payload: Record<string, unknown> = {
    // ✅ si pasás account_id, /api/credit/entry usa “Opción A” (cuenta directa)
    account_id: Number(args.creditAccountId),

    // (dejo estos para trazabilidad/compat; no molestan)
    subject_type: "OPERATOR",
    operator_id: Number(args.operatorId),

    currency: (args.currency || "ARS").toUpperCase(),
    amount: Math.abs(Number(args.amount || 0)),
    concept: args.concept || `Recibo N° ${args.receiptId}`,
    doc_type: "receipt",
    receipt_id: args.receiptId,
    booking_id: args.bookingId ?? undefined,
    reference: `REC-${args.receiptId}`,
  };

  if (args.agencyId != null) payload.agency_id = Number(args.agencyId);

  const res = await authFetch(
    "/api/credit/entry",
    { method: "POST", body: JSON.stringify(payload) },
    args.token,
  );

  if (!res.ok) {
    const body =
      (await safeJson<{ error?: string; message?: string }>(res)) ?? {};
    throw new Error(
      body.error || body.message || "No se pudo crear el movimiento de crédito",
    );
  }
}

export async function createClientCreditEntryForReceipt(args: {
  token: string;
  receiptId: number;
  amount: number;
  currency: string;
  concept: string;
  bookingId?: number | null;
  clientId: number;
  agencyId?: number | null;
}) {
  const payload: Record<string, unknown> = {
    subject_type: "CLIENT",
    client_id: Number(args.clientId),
    currency: (args.currency || "ARS").toUpperCase(),
    amount: Math.abs(Number(args.amount || 0)),
    concept: args.concept || `Recibo N° ${args.receiptId}`,
    doc_type: "receipt",
    receipt_id: args.receiptId,
    booking_id: args.bookingId ?? undefined,
    reference: `REC-${args.receiptId}`,
  };

  if (args.agencyId != null) payload.agency_id = Number(args.agencyId);

  const res = await authFetch(
    "/api/credit/entry",
    { method: "POST", body: JSON.stringify(payload) },
    args.token,
  );

  if (!res.ok) {
    const body =
      (await safeJson<{ error?: string; message?: string }>(res)) ?? {};
    throw new Error(
      body.error || body.message || "No se pudo crear el movimiento del pax",
    );
  }
}

export async function createFinanceEntryForReceipt(args: {
  token: string;
  accountId: number;
  receiptId: number;
  amount: number;
  currency: string;
  concept: string;
  bookingId?: number | null;
  agencyId?: number | null;
}) {
  const payload = {
    subject_type: "ACCOUNT",
    account_id: Number(args.accountId),
    currency: (args.currency || "ARS").toUpperCase(),
    amount: Math.abs(Number(args.amount)),
    concept: args.concept || `Recibo N° ${args.receiptId}`,
    doc_type: "receipt",
    receipt_id: args.receiptId,
    booking_id: args.bookingId ?? undefined,
    reference: `REC-${args.receiptId}`,
  };

  const res = await authFetch(
    "/api/finance/entry",
    { method: "POST", body: JSON.stringify(payload) },
    args.token,
  );

  if (res.status === 404 || res.status === 405) {
    // Financias no disponible en esta instancia (modo legacy)
    return;
  }

  if (!res.ok) {
    const body = await safeJson<{ error?: string; message?: string }>(res);
    throw new Error(
      body?.error ||
        body?.message ||
        "No se pudo registrar el movimiento de cuenta",
    );
  }
}
