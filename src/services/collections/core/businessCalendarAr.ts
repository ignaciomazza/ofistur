import {
  addDaysToDateKey,
  BUENOS_AIRES_TIME_ZONE,
  toDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";

type ResolveOperationalDateInput = {
  targetDateAr?: string | null;
  now?: Date;
  allowNonBusinessDay?: boolean;
};

type ResolveOperationalDateResult = {
  target_date_ar: string;
  business_date_ar: string;
  business_day: boolean;
  deferred_to_next_business_day: boolean;
};

function parseHolidayDateKeys(raw: string | undefined): string[] {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
    }
  } catch {
    // Fallback a formato CSV simple.
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
}

function getArHolidaySet(): Set<string> {
  return new Set(parseHolidayDateKeys(process.env.BILLING_AR_HOLIDAYS_JSON));
}

function normalizeDateKeyAr(input: Date | string): string {
  if (typeof input === "string") {
    const raw = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  }

  const key = toDateKeyInBuenosAires(input);
  if (!key) {
    throw new Error("No se pudo resolver fecha AR");
  }
  return key;
}

function isWeekendAr(dateKey: string): boolean {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  const localWeekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: BUENOS_AIRES_TIME_ZONE,
  }).format(date);

  return localWeekday === "Sat" || localWeekday === "Sun";
}

export function isBusinessDayAr(input: Date | string): boolean {
  const dateKey = normalizeDateKeyAr(input);
  const holidays = getArHolidaySet();
  return !isWeekendAr(dateKey) && !holidays.has(dateKey);
}

export function nextBusinessDayAr(input: Date | string): string {
  let dateKey = normalizeDateKeyAr(input);

  for (let i = 0; i < 370; i += 1) {
    if (isBusinessDayAr(dateKey)) return dateKey;
    const next = addDaysToDateKey(dateKey, 1);
    if (!next) break;
    dateKey = next;
  }

  throw new Error("No se pudo resolver el siguiente día hábil AR");
}

export function addBusinessDaysAr(input: Date | string, days: number): Date {
  let dateKey = normalizeDateKeyAr(input);
  const amount = Math.max(0, Math.trunc(days));

  if (amount === 0) {
    const normalized = toDateKeyInBuenosAires(input);
    const key = normalized || dateKey;
    const date = new Date(`${key}T03:00:00.000Z`);
    return date;
  }

  let moved = 0;
  while (moved < amount) {
    const next = addDaysToDateKey(dateKey, 1);
    if (!next) throw new Error("No se pudo avanzar día hábil AR");
    dateKey = next;
    if (isBusinessDayAr(dateKey)) moved += 1;
  }

  const result = new Date(`${dateKey}T03:00:00.000Z`);
  return result;
}

export function resolveOperationalDateAr(
  input: ResolveOperationalDateInput = {},
): ResolveOperationalDateResult {
  const target =
    input.targetDateAr && /^\d{4}-\d{2}-\d{2}$/.test(input.targetDateAr)
      ? input.targetDateAr
      : normalizeDateKeyAr(input.now || new Date());

  const businessDay = isBusinessDayAr(target);
  if (businessDay || input.allowNonBusinessDay) {
    return {
      target_date_ar: target,
      business_date_ar: target,
      business_day: businessDay,
      deferred_to_next_business_day: false,
    };
  }

  const businessDate = nextBusinessDayAr(target);
  return {
    target_date_ar: target,
    business_date_ar: businessDate,
    business_day: false,
    deferred_to_next_business_day: true,
  };
}

export function hourInBuenosAires(now: Date): number {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUENOS_AIRES_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const hour = Number.parseInt(text, 10);
  return Number.isFinite(hour) ? hour : 0;
}
