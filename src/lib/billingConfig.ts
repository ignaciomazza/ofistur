import {
  BUENOS_AIRES_TIME_ZONE,
  startOfDayUtcFromDateKeyInBuenosAires,
  toDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";

export type BillingConfig = {
  timezone: string;
  anchorDay: number;
  dunningRetryDays: number[];
  dunningUseBusinessDays: boolean;
  arHolidaysDateKeys: string[];
  suspendAfterDays: number;
  directDebitDiscountPct: number;
  defaultVatRate: number;
  requireBspToday: boolean;
  dunningEnableFallback: boolean;
  fallbackDefaultProvider: "cig_qr" | "mp" | "other";
  fallbackExpiresHours: number;
  fallbackMpEnabled: boolean;
  fallbackSyncBatchSize: number;
  fallbackAutoSync: boolean;
};

function parseInteger(input: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseNumber(input: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(input ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "si", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseHolidayDateKeys(raw: string | undefined): string[] {
  const value = String(raw || "").trim();
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
    }
  } catch {
    // Fallback a formato CSV.
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
}

export function parseRetryDaysEnv(raw: string | undefined): number[] {
  const value = String(raw ?? "")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0);

  const unique = Array.from(new Set(value));
  unique.sort((a, b) => a - b);
  return unique;
}

export function getBillingConfig(): BillingConfig {
  const timezone =
    process.env.BILLING_TIMEZONE?.trim() || BUENOS_AIRES_TIME_ZONE;
  const anchorDay = Math.min(
    31,
    Math.max(1, parseInteger(process.env.BILLING_ANCHOR_DAY, 8)),
  );
  const retries = parseRetryDaysEnv(process.env.BILLING_DUNNING_RETRY_DAYS);

  return {
    timezone,
    anchorDay,
    dunningRetryDays: retries.length ? retries : [2, 4],
    dunningUseBusinessDays: parseBoolean(
      process.env.BILLING_DUNNING_USE_BUSINESS_DAYS,
      true,
    ),
    arHolidaysDateKeys: parseHolidayDateKeys(process.env.BILLING_AR_HOLIDAYS_JSON),
    suspendAfterDays: Math.max(
      1,
      parseInteger(process.env.BILLING_SUSPEND_AFTER_DAYS, 7),
    ),
    directDebitDiscountPct: parseNumber(
      process.env.BILLING_DIRECT_DEBIT_DISCOUNT_PCT,
      10,
    ),
    defaultVatRate: parseNumber(process.env.BILLING_DEFAULT_VAT_RATE, 0.21),
    requireBspToday: parseBoolean(process.env.BILLING_REQUIRE_BSP_TODAY, true),
    dunningEnableFallback: parseBoolean(
      process.env.BILLING_DUNNING_ENABLE_FALLBACK,
      true,
    ),
    fallbackDefaultProvider: (() => {
      const raw = String(process.env.BILLING_FALLBACK_DEFAULT_PROVIDER || "cig_qr")
        .trim()
        .toLowerCase();
      if (raw === "mp") return "mp";
      if (raw === "other") return "other";
      return "cig_qr";
    })(),
    fallbackExpiresHours: Math.max(
      1,
      parseInteger(process.env.BILLING_FALLBACK_EXPIRES_HOURS, 72),
    ),
    fallbackMpEnabled: parseBoolean(
      process.env.BILLING_FALLBACK_MP_ENABLED,
      false,
    ),
    fallbackSyncBatchSize: Math.max(
      1,
      parseInteger(process.env.BILLING_FALLBACK_SYNC_BATCH_SIZE, 100),
    ),
    fallbackAutoSync: parseBoolean(
      process.env.BILLING_FALLBACK_AUTO_SYNC,
      false,
    ),
  };
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  const match = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function computeNextAnchorDate(
  input: { now?: Date; anchorDay?: number; timezone?: string } = {},
): Date {
  const config = getBillingConfig();
  const now = input.now ?? new Date();
  const anchorDay = Math.min(31, Math.max(1, Math.trunc(input.anchorDay ?? config.anchorDay)));
  const timezone = input.timezone ?? config.timezone;

  // Actualmente operamos con BA como timezone funcional del módulo.
  if (timezone !== BUENOS_AIRES_TIME_ZONE) {
    const fallback = new Date(now);
    fallback.setUTCDate(anchorDay);
    fallback.setUTCHours(0, 0, 0, 0);
    if (fallback.getTime() <= now.getTime()) {
      fallback.setUTCMonth(fallback.getUTCMonth() + 1);
    }
    return fallback;
  }

  const todayKey = toDateKeyInBuenosAires(now);
  const today = todayKey ? parseDateKey(todayKey) : null;
  if (!today) return now;

  let targetYear = today.year;
  let targetMonth = today.month;

  if (today.day > anchorDay) {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  }

  const targetDay = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));
  const targetKey = formatDateKey(targetYear, targetMonth, targetDay);

  return startOfDayUtcFromDateKeyInBuenosAires(targetKey) ?? now;
}
