export type Investment = {
  id_investment: number;
  agency_investment_id?: number | null;
  id_agency: number;
  category: string;
  description: string;
  counterparty_name?: string | null;
  amount: number;
  currency: string;
  created_at: string;
  paid_at?: string | null;
  excess_action?: string | null;
  excess_missing_account_action?: string | null;
  user_id?: number | null;
  operator_id?: number | null;
  user?: { id_user: number; first_name: string; last_name: string } | null;
  operator?: { id_operator: number; name: string } | null;
  createdBy?: { id_user: number; first_name: string; last_name: string } | null;
  booking_id?: number | null;
  serviceIds?: number[] | null;
  booking?: {
    id_booking: number;
    agency_booking_id?: number | null;
    public_id?: string | null;
  } | null;
  recurring_id?: number | null;
  payment_method?: string | null;
  account?: string | null;
  payments?:
    | {
        amount?: number | null;
        payment_method?: string | null;
        account?: string | null;
        payment_currency?: string | null;
        fee_mode?: "FIXED" | "PERCENT" | null;
        fee_value?: number | null;
        fee_amount?: number | null;
      }[]
    | null;
  base_amount?: number | null;
  base_currency?: string | null;
  counter_amount?: number | null;
  counter_currency?: string | null;
  allocations?: InvestmentServiceAllocation[] | null;
};

export type InvestmentServiceAllocation = {
  id_allocation?: number;
  service_id: number;
  booking_id?: number | null;
  booking_agency_id?: number | null;
  booking_public_id?: string | null;
  payment_currency: string;
  service_currency: string;
  amount_payment: number;
  amount_service: number;
  fx_rate?: number | null;
};

export type RecurringInvestment = {
  id_recurring: number;
  id_agency: number;
  category: string;
  description: string;
  amount: number;
  currency: string;
  start_date: string;
  day_of_month: number;
  interval_months: number;
  last_run?: string | null;
  active: boolean;
  payment_method?: string | null;
  account?: string | null;
  base_amount?: number | null;
  base_currency?: string | null;
  counter_amount?: number | null;
  counter_currency?: string | null;
  operator_id?: number | null;
  user_id?: number | null;
  operator?: { id_operator: number; name: string } | null;
  user?: { id_user: number; first_name: string; last_name: string } | null;
  createdBy?: { id_user: number; first_name: string; last_name: string } | null;
};

export type User = { id_user: number; first_name: string; last_name: string };
export type Operator = { id_operator: number; name: string };

export type InvestmentFormState = {
  category: string;
  description: string;
  counterparty_name: string;
  amount: string;
  currency: string;
  paid_at: string;
  user_id: number | null;
  operator_id: number | null;
  paid_today: boolean;
  payment_method: string;
  account: string;
  use_conversion: boolean;
  base_amount: string;
  base_currency: string;
  counter_amount: string;
  counter_currency: string;
  use_credit: boolean;
};

export type RecurringFormState = {
  category: string;
  description: string;
  counterparty_name: string;
  amount: string;
  currency: string;
  start_date: string;
  day_of_month: string;
  interval_months: string;
  user_id: number | null;
  operator_id: number | null;
  active: boolean;
  payment_method: string;
  account: string;
  use_conversion: boolean;
  base_amount: string;
  base_currency: string;
  counter_amount: string;
  counter_currency: string;
  use_credit: boolean;
};
