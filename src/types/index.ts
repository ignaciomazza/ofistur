import type { CommissionOverrides } from "./commission";

// ===================== Tipos base compartidos =====================

export type Currency = "ARS" | "USD";

export type {
  CommissionLeader,
  CommissionOverrides,
  CommissionRule,
  CommissionScope,
} from "./commission";

// DocType es solo TypeScript (NO prisma enum). Podés extender con strings.
export type DocType =
  | "confirmation"
  | "quote"
  | "voucher"
  | "invoice"
  | (string & {}); // permite strings personalizados

// ===================== Usuario / Agencia =====================

export interface AgencySocial {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  tiktok?: string;
  whatsapp?: string;
  [k: string]: string | undefined;
}

export interface Agency {
  id_agency: number;
  name: string;
  legal_name: string;
  address?: string;
  phone?: string;
  phones: string[];
  email?: string;
  social?: AgencySocial | null;
  tax_id: string;
  website?: string;
  foundation_date?: string;
  logo_url?: string;
  creation_date: string;
  users?: User[];
  bookings?: Booking[];
}

export interface User {
  id_user: number;
  agency_user_id?: number | null;
  email: string;
  password?: string;
  first_name: string;
  last_name: string;
  position: string;
  role: string;
  id_agency: number;
  agency: Agency;
  bookings?: Booking[];
  clients?: Client[];
  sales_teams?: UserTeam[];
}

// ===================== Pasajeros / Reservas / Servicios =====================

export interface Client {
  id_client: number;
  agency_client_id?: number | null;
  profile_key?: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  address?: string;
  postal_code?: string;
  locality?: string;
  company_name?: string;
  tax_id?: string;
  commercial_address?: string;
  dni_number?: string;
  passport_number?: string;
  birth_date: string;
  nationality: string;
  gender: string;
  category_id?: number | null;
  category?: PassengerCategory | null;
  email?: string;
  custom_fields?: Record<string, string>;
  registration_date: string;
  id_user: number;
  user: User;
  bookings?: Booking[];
  titular_bookings?: Booking[];
  invoices?: Invoice[];
  id_agency: number;
}

export type ClientCustomFieldType = "text" | "date" | "number";

export interface ClientCustomField {
  key: string;
  label: string;
  type: ClientCustomFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  builtin?: boolean;
}

export interface ClientProfileConfig {
  key: string;
  label: string;
  required_fields: string[];
  hidden_fields: string[];
  custom_fields: ClientCustomField[];
}

export interface ClientConfig {
  id_agency: number;
  visibility_mode: "all" | "team" | "own";
  required_fields?: string[] | null;
  custom_fields?: ClientCustomField[] | null;
  hidden_fields?: string[] | null;
  profiles?: ClientProfileConfig[] | null;
  use_simple_companions?: boolean | null;
}

export interface PassengerCategory {
  id_category: number;
  agency_passenger_category_id?: number | null;
  id_agency: number;
  name: string;
  code: string;
  min_age?: number | null;
  max_age?: number | null;
  ignore_age?: boolean;
  enabled?: boolean;
  sort_order?: number;
}

export interface BookingCompanion {
  id_companion?: number;
  booking_id?: number;
  category_id?: number | null;
  age?: number | null;
  notes?: string | null;
  category?: PassengerCategory | null;
}

export interface ClientSimpleCompanion {
  id_template?: number;
  client_id?: number;
  category_id?: number | null;
  age?: number | null;
  notes?: string | null;
  category?: PassengerCategory | null;
}

export interface ServiceTypePresetItem {
  id_item?: number;
  category_id: number;
  sale_price: number;
  cost_price: number;
  sale_markup_pct?: number | null;
  category?: PassengerCategory | null;
}

export interface ServiceTypePreset {
  id_preset: number;
  agency_service_type_preset_id?: number | null;
  id_agency: number;
  service_type_id: number;
  operator_id?: number | null;
  name: string;
  currency: string;
  enabled?: boolean;
  sort_order?: number;
  items?: ServiceTypePresetItem[];
}

export interface ClientRelation {
  id_relation: number;
  id_agency: number;
  client_id: number;
  related_client_id: number;
  relation_type?: string | null;
  related_client?: Client;
}

export interface Booking {
  id_booking: number;
  agency_booking_id?: number | null;
  public_id?: string | null;
  clientStatus: string;
  operatorStatus: string;
  status: string;
  details: string;
  sale_totals?: Record<string, number> | null;
  use_booking_sale_total_override?: boolean | null;
  commission_overrides?: CommissionOverrides | null;
  invoice_type: "Factura A" | "Factura B" | "Coordinar con administracion";
  observation?: string;
  invoice_observation?: string;
  titular: Client;
  user: User;
  agency: Agency;
  departure_date: string;
  return_date: string;
  pax_count: number;
  clients: Client[];
  simple_companions?: BookingCompanion[];
  services?: Service[];
  creation_date: string;
  totalSale?: number;
  totalCommission?: number;
  debt?: number;
}

export interface BookingFormData {
  clientStatus: string;
  operatorStatus: string;
  status: string;
  details: string;
  invoice_type: "Factura A" | "Factura B" | "Coordinar con administracion";
  observation?: string;
  invoice_observation?: string;
  titular_id: number;
  id_user: number;
  id_agency: number;
  departure_date: string;
  return_date: string;
  pax_count: number;
  clients_ids: number[];
  agency_booking_id?: number | null;
  simple_companions?: BookingCompanion[];
}

export interface Service {
  id_service: number;
  agency_service_id?: number | null;
  type: string;
  description: string;
  note?: string | null;
  sale_price: number;
  cost_price: number;
  destination: string;
  reference: string;
  tax_21?: number;
  tax_105?: number;
  exempt?: number;
  other_taxes?: number;
  card_interest?: number;
  card_interest_21?: number;
  taxableCardInterest?: number;
  vatOnCardInterest?: number;
  currency: string;
  nonComputable?: number;
  taxableBase21?: number;
  taxableBase10_5?: number;
  commissionExempt?: number;
  commission21?: number;
  commission10_5?: number;
  vatOnCommission21?: number;
  vatOnCommission10_5?: number;
  totalCommissionWithoutVAT?: number;
  impIVA?: number;
  transfer_fee_pct?: number | null;
  transfer_fee_amount?: number | null;
  billing_override?: BillingBreakdownOverride | null;
  extra_costs_amount?: number | null;
  extra_taxes_amount?: number | null;
  extra_adjustments?: BillingAdjustmentComputed[] | null;
  departure_date: string;
  return_date: string;
  booking_id: number;
  id_agency?: number;
  id_operator: number;
  created_at: string;
}

export interface Operator {
  id_operator: number;
  agency_operator_id?: number | null;
  name: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  postal_code: string;
  city: string;
  state: string;
  country: string;
  vat_status: string;
  legal_name: string;
  tax_id: string;
  registration_date: string;
  credit_balance: number;
  debit_balance: number;
  bookings?: Booking[];
  id_agency: number;
}

// ===================== Facturación / Recibos =====================

export interface Invoice {
  id_invoice: number;
  agency_invoice_id?: number | null;
  public_id?: string | null;
  id_agency: number;
  invoice_number: string;
  pto_vta?: number;
  cbte_tipo?: number;
  issue_date: string;
  total_amount: number;
  status: string;
  bookingId_booking: number;
  booking: Booking;
  currency: Currency;
  recipient: string;
  client_id: number;
  payloadAfip?: {
    voucherData: {
      CbteFch: number;
      ImpNeto: number;
      ImpIVA: number;
      Iva: { Id: number; BaseImp: number; Importe: number }[];
    };
    customItems?: Array<{
      description: string;
      taxCategory: "21" | "10_5" | "EXEMPT";
      amount?: number;
    }>;
  };
}

export interface Receipt {
  id_receipt: number;
  agency_receipt_id?: number | null;
  public_id?: string | null;
  receipt_number: string;
  issue_date: string;
  amount: number;
  amount_string: string;
  amount_currency: Currency;
  concept: string;
  // En este proyecto `currency` es la descripción del método de pago impresa en PDF
  currency: string;
  payment_method?: string | null;
  payment_fee_amount: number | null;
  account?: string | null;
  base_amount?: number | string | null;
  base_currency?: Currency | string | null;
  counter_amount?: number | string | null;
  counter_currency?: Currency | string | null;
  verification_status?: string | null;
  verified_at?: string | null;
  verified_by?: number | null;
  verifiedBy?: { id_user: number; first_name: string; last_name: string } | null;
  bookingId_booking: number;
  booking?: Booking;
  serviceIds?: number[];
  service_allocations?: Array<{
    id_receipt_service_allocation?: number;
    service_id: number;
    amount_service: number | string;
    service_currency?: string | null;
  }>;
  clientIds?: number[];
}

// ===================== Reportes / perfiles =====================

export interface SalesTeam {
  id_team: number;
  agency_sales_team_id?: number | null;
  name: string;
  user_teams: UserTeam[];
  id_agency: number;
}

export interface UserTeam {
  id_user_team: number;
  id_user: number;
  id_team: number;
  user: User;
  sales_team: SalesTeam;
}

export interface UserProfile {
  name: string;
  email: string;
  position: string;
  role: string;
  salesData: {
    id_booking: number;
    details: string | null;
    totalServices: number;
    totalSales: number;
    seller?: string;
  }[];
}

// ===================== Cobranzas =====================

export interface OperatorDue {
  id_due: number;
  agency_operator_due_id?: number | null;
  created_at: string;
  booking_id: number;
  booking?: Booking;
  service_id: number;
  service?: Service;
  due_date: string;
  concept: string;
  status: string;
  amount: number | string;
  currency: Currency | string;
}

export type ClientPaymentStatus = "PENDIENTE" | "PAGADA" | "CANCELADA";
export type ClientPaymentDisplayStatus = ClientPaymentStatus | "VENCIDA";

export interface ClientPaymentAudit {
  id_audit: number;
  client_payment_id: number;
  id_agency: number;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  reason?: string | null;
  changed_by?: number | null;
  changedBy?: {
    id_user: number;
    first_name: string;
    last_name: string;
  } | null;
  changed_at: string;
  data?: Record<string, unknown> | null;
}

export interface ClientPayment {
  id_payment: number;
  agency_client_payment_id?: number | null;
  created_at: string;
  booking_id: number;
  booking?: Booking;
  client_id: number;
  client?: Client;
  amount: number | string;
  currency: Currency | string;
  due_date: string;
  status: ClientPaymentStatus | string;
  derived_status?: ClientPaymentDisplayStatus | string;
  is_overdue?: boolean;
  paid_at?: string | null;
  paid_by?: number | null;
  status_reason?: string | null;
  receipt_id?: number | null;
  receipt?: Receipt | null;
  service_id?: number | null;
  service?: Service | null;
  audits?: ClientPaymentAudit[];
}

export interface BillingData {
  nonComputable: number;
  taxableBase21: number;
  taxableBase10_5: number;
  commissionExempt: number;
  commission21: number;
  commission10_5: number;
  vatOnCommission21: number;
  vatOnCommission10_5: number;
  totalCommissionWithoutVAT: number;
  impIVA: number;
  taxableCardInterest: number;
  vatOnCardInterest: number;
  transferFeeAmount: number;
  transferFeePct: number;
  breakdownOverride?: BillingBreakdownOverride | null;
  breakdownWarningMessages?: string[];
  extraCostsAmount?: number;
  extraTaxesAmount?: number;
  extraAdjustments?: BillingAdjustmentComputed[];
}

export type BillingBreakdownOverride = {
  nonComputable: number;
  taxableBase21: number;
  taxableBase10_5: number;
  commissionExempt: number;
  commission21: number;
  commission10_5: number;
  vatOnCommission21: number;
  vatOnCommission10_5: number;
  totalCommissionWithoutVAT: number;
  impIVA: number;
  taxableCardInterest: number;
  vatOnCardInterest: number;
  transferFeeAmount: number;
  transferFeePct: number;
};

export type BillingAdjustmentSource = "global" | "service";

export type BillingAdjustmentConfig = {
  id: string;
  label: string;
  kind: "cost" | "tax";
  basis: "sale" | "cost" | "margin";
  valueType: "percent" | "fixed";
  value: number;
  active: boolean;
  source?: BillingAdjustmentSource;
};

export type BillingAdjustmentComputed = BillingAdjustmentConfig & {
  amount: number;
};

// ===================== Templates: estructuras sugeridas =====================

export interface ConfirmationTemplateConfig {
  styles?: {
    colors?: {
      background?: string;
      text?: string;
      accent?: string;
      overlayOpacity?: number;
    };
    fonts?: { heading?: string; body?: string };
  };
  coverImage?: { mode?: "url" | "none"; url?: string };
  contactItems?: Array<
    | "phones"
    | "email"
    | "website"
    | "address"
    | "instagram"
    | "facebook"
    | "twitter"
    | "tiktok"
  >;
  labels?: {
    header?: string;
    confirmedData?: string;
    pax?: string;
    services?: string;
    terms?: string;
    planPago?: string;
  };
  termsAndConditions?: string;
  metodosDePago?: Record<string, string>;
}

export interface QuoteTemplateConfig {
  labels?: {
    title?: string;
    prices?: string;
    planPago?: string;
  };
  metodosDePago?: Record<string, string>;
}

// Registro genérico de TemplateConfig
export interface TemplateConfig<T extends DocType = DocType> {
  id_template: number;
  id_agency: number;
  doc_type: T;
  // 👇 sin `any`
  config:
    | ConfirmationTemplateConfig
    | QuoteTemplateConfig
    | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ==========================
// Insights comerciales
// ==========================

export type InsightsCurrencyCode = string;

/**
 * Mapa dinámico por moneda, por ejemplo:
 * { "ARS": 120000, "USD": 500, "EUR": 200 }
 *
 * Las claves deberían coincidir con FinanceCurrency.code
 * o el campo que uses como identificador de moneda.
 */
export type InsightsMoneyPerCurrency = Record<InsightsCurrencyCode, number>;

export interface CommercialSummaryBlock {
  /** Cantidad de reservas en el período */
  reservations: number;
  /** Pasajeros totales (sumatoria de pax) */
  passengers: number;
  /** Ticket promedio por moneda (total / reservas) */
  avgTicket: InsightsMoneyPerCurrency;
  /** Ticket mediano por moneda (para evitar outliers) */
  medianTicket: InsightsMoneyPerCurrency;
  /** Anticipación promedio en días (fecha reserva → fecha salida) */
  avgAnticipationDays: number | null;
}

export interface DestinationItem {
  destinationKey: string;
  countryCode?: string | null;
  reservations: number;
  passengers: number;
  /** Monto total vendido hacia ese destino, por moneda */
  totalAmount: InsightsMoneyPerCurrency;
  /** Ticket promedio por reserva hacia ese destino, por moneda */
  avgTicket: InsightsMoneyPerCurrency;
}

export interface ChannelItem {
  /** Canal / origen de venta: Instagram, Google Ads, Referido, Local, etc. */
  channel: string;
  reservations: number;
  passengers: number;
  /** Ticket promedio por reserva en ese canal, por moneda */
  avgTicket: InsightsMoneyPerCurrency;
}

export interface NewReturningBlock {
  newClients: {
    reservations: number;
    passengers: number;
    totalAmount: InsightsMoneyPerCurrency;
    avgTicket: InsightsMoneyPerCurrency;
  };
  returningClients: {
    reservations: number;
    passengers: number;
    totalAmount: InsightsMoneyPerCurrency;
    avgTicket: InsightsMoneyPerCurrency;
  };
}

export interface TopClientItem {
  /** Puede venir null si hay reservas sin pax asociado explícitamente */
  id_client: number | null;
  name: string;
  reservations: number;
  passengers: number;
  totalAmount: InsightsMoneyPerCurrency;
  /** Última fecha de reserva de ese pax (ISO) */
  lastBookingDate: string | null;
}

export interface CommercialInsightsResponse {
  summary: CommercialSummaryBlock;
  destinations: {
    topDestinations: DestinationItem[];
  };
  channels: {
    byOrigin: ChannelItem[];
  };
  clients: {
    newVsReturning: NewReturningBlock;
    topClients: TopClientItem[];
  };
}
