// src/types/receipts.ts

export type CurrencyCode = string;

/** Opción de reserva para buscadores/autocomplete */
export type BookingOption = {
  id_booking: number;
  agency_booking_id?: number | null;
  label: string; // ej: "N° 1024 • Juan Pérez"
  subtitle?: string; // ej: "Europa 2025"
};

/** Servicio “liviano” para selección dentro de un recibo */
export type ServiceLite = {
  id_service: number;
  agency_service_id?: number | null;
  description?: string;
  currency: string; // "ARS" | "USD" | ...
  sale_price?: number; // sugerencia importe base
  cost_price?: number;
  card_interest?: number; // sugerencia costo financiero
  taxableCardInterest?: number;
  vatOnCardInterest?: number;
  type?: string;
  destination?: string;
  departure_date?: string | null;
  return_date?: string | null;
};

export type FinanceAccount = {
  id_account: number;
  name: string;
  display_name?: string;
  enabled?: boolean;
};

export type FinancePaymentMethod = {
  id_method: number;
  name: string;
  requires_account?: boolean;
  enabled?: boolean;
};

export type FinanceCurrency = {
  code: string;
  name?: string;
  enabled?: boolean;
};

export type FinancePicks = {
  accounts: FinanceAccount[];
  paymentMethods: FinancePaymentMethod[];
  currencies: FinanceCurrency[];
};

export type ReceiptPaymentFeeMode = "FIXED" | "PERCENT";

export type ReceiptServiceAllocationLine = {
  service_id: number;
  amount_service: number;
  service_currency?: string | null;
  amount_payment?: number | null;
  payment_currency?: string | null;
  fx_rate?: number | null;
};

/** ✅ línea de pago (para ReceiptPayment en backend) */
export type ReceiptPaymentLine = {
  amount: number;
  payment_method_id: number | null;
  account_id: number | null;
  payment_currency?: string | null;
  fee_mode?: ReceiptPaymentFeeMode | null;
  fee_value?: number | null;
  fee_amount?: number | null;

  // (para UI / movimiento crédito)
  operator_id?: number | null;

  // ✅ NUEVO: cuenta crédito elegida
  credit_account_id?: number | null;
};


/** Payload que espera tu API al crear/editar recibos */
export type ReceiptPayload = {
  booking?: { id_booking: number };
  serviceIds?: number[];
  serviceAllocations?: ReceiptServiceAllocationLine[];
  service_allocations?: ReceiptServiceAllocationLine[];

  concept: string;
  amount: number;
  amountString: string;
  amountCurrency: string;
  issue_date?: string;

  payment_fee_amount?: number;
  clientIds?: number[];

  payment_method?: string;
  account?: string;
  currency?: string;

  base_amount?: number;
  base_currency?: string;
  counter_amount?: number;
  counter_currency?: string;

  payment_method_id?: number;
  account_id?: number;

  payments?: ReceiptPaymentLine[];

  // excedente para cuenta crédito/corriente del pax
  allow_client_credit_excess?: boolean;
  client_credit_client_id?: number;
};

/** Opción para “asociar recibo existente” */
export type AttachableReceiptOption = {
  id_receipt: number;
  label: string; // "N° 000123 • U$D 500 • 12/10/2025"
  subtitle?: string;
  alreadyLinked?: boolean;
};

/* =========================
 * Helpers de IDs (para resolver id_receipt)
 * ========================= */

export type ReceiptIdLeaf = number | string | null | undefined;

export type ReceiptIdObject = {
  id_receipt?: ReceiptIdLeaf;
  id?: ReceiptIdLeaf;
  receiptId?: ReceiptIdLeaf;

  data?: {
    id_receipt?: ReceiptIdLeaf;
    id?: ReceiptIdLeaf;
    receipt?: { id_receipt?: ReceiptIdLeaf; id?: ReceiptIdLeaf };
  };
  result?: {
    id_receipt?: ReceiptIdLeaf;
    id?: ReceiptIdLeaf;
    receipt?: { id_receipt?: ReceiptIdLeaf; id?: ReceiptIdLeaf };
  };
  receipt?: {
    id_receipt?: ReceiptIdLeaf;
    id?: ReceiptIdLeaf;
  };
};

/** Lo que puede devolver onSubmit en tu ReceiptForm */
export type SubmitResult = number | Response | ReceiptIdObject | null | void;
