export type InvestmentEffectiveDateInput = {
  imputation_month?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
};

const MONTH_KEY_REGEX = /^(\d{4})-(\d{2})/;

const toText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim();
};

export const extractMonthKey = (value: unknown): string | null => {
  const raw = toText(value);
  if (!raw) return null;

  const match = raw.match(MONTH_KEY_REGEX);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      month >= 1 &&
      month <= 12
    ) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
};

const parseDate = (value: unknown): Date | null => {
  const raw = toText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateFromMonthKey = (monthKey: string): Date =>
  new Date(`${monthKey}-01T12:00:00`);

export const resolveInvestmentEffectiveDate = (
  input: InvestmentEffectiveDateInput,
  opts?: { preferImputationMonth?: boolean },
): Date => {
  if (opts?.preferImputationMonth) {
    const monthKey = extractMonthKey(input.imputation_month);
    if (monthKey) return dateFromMonthKey(monthKey);
  }

  const paid = parseDate(input.paid_at);
  if (paid) return paid;

  const created = parseDate(input.created_at);
  if (created) return created;

  return new Date(0);
};

export const resolveInvestmentEffectiveMonthKey = (
  input: InvestmentEffectiveDateInput,
  opts?: { preferImputationMonth?: boolean },
): string => {
  if (opts?.preferImputationMonth) {
    const monthKey = extractMonthKey(input.imputation_month);
    if (monthKey) return monthKey;
  }

  const date = resolveInvestmentEffectiveDate(input, {
    preferImputationMonth: false,
  });

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
