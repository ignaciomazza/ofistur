import type {
  BillingBreakdownMeta,
  BillingBreakdownOverride,
  BillingOverridePayload,
} from "@/types";

const BILLING_OVERRIDE_KEYS: Array<keyof BillingBreakdownOverride> = [
  "nonComputable",
  "taxableBase21",
  "taxableBase10_5",
  "commissionExempt",
  "commission21",
  "commission10_5",
  "vatOnCommission21",
  "vatOnCommission10_5",
  "totalCommissionWithoutVAT",
  "impIVA",
  "taxableCardInterest",
  "vatOnCardInterest",
  "transferFeeAmount",
  "transferFeePct",
];

const VAT_MODE_SET = new Set([
  "automatic",
  "vat21",
  "vat10_5",
  "exempt",
  "mixed",
]);

const IIBB_BASE_SET = new Set(["netCommission", "sale"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "si", "sí", "on", "yes"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

function normalizeOverrideValues(
  value: unknown,
): Partial<BillingBreakdownOverride> | null {
  if (!isRecord(value)) return null;
  const out: Partial<BillingBreakdownOverride> = {};
  for (const key of BILLING_OVERRIDE_KEYS) {
    const raw = value[key];
    const parsed = toFiniteNumber(raw);
    if (parsed == null) continue;
    out[key] = parsed;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeMeta(value: unknown): BillingBreakdownMeta | null {
  if (!isRecord(value)) return null;
  const out: BillingBreakdownMeta = {};

  const vatMode =
    typeof value.commissionVatMode === "string"
      ? value.commissionVatMode
      : null;
  if (vatMode && VAT_MODE_SET.has(vatMode)) {
    out.commissionVatMode = vatMode as NonNullable<
      BillingBreakdownMeta["commissionVatMode"]
    >;
  }

  const iibbEnabled = toOptionalBoolean(value.grossIncomeTaxEnabled);
  if (iibbEnabled != null) out.grossIncomeTaxEnabled = iibbEnabled;

  const iibbBase =
    typeof value.grossIncomeTaxBase === "string" ? value.grossIncomeTaxBase : null;
  if (iibbBase && IIBB_BASE_SET.has(iibbBase)) {
    out.grossIncomeTaxBase = iibbBase as NonNullable<
      BillingBreakdownMeta["grossIncomeTaxBase"]
    >;
  }

  const iibbPct = toFiniteNumber(value.grossIncomeTaxPct);
  if (iibbPct != null && iibbPct >= 0) out.grossIncomeTaxPct = iibbPct;

  const iibbAmount = toFiniteNumber(value.grossIncomeTaxAmount);
  if (iibbAmount != null) out.grossIncomeTaxAmount = iibbAmount;

  return Object.keys(out).length > 0 ? out : null;
}

export function extractBillingOverrideValues(
  raw: unknown,
): Partial<BillingBreakdownOverride> | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.values)) {
    return normalizeOverrideValues(raw.values);
  }
  return normalizeOverrideValues(raw);
}

export function extractBillingOverrideMeta(
  raw: unknown,
): BillingBreakdownMeta | null {
  if (!isRecord(raw)) return null;
  const nested = isRecord(raw.meta) ? normalizeMeta(raw.meta) : null;
  if (nested) return nested;
  return normalizeMeta(raw);
}

export function composeBillingOverridePayload({
  values,
  meta,
}: {
  values?: Partial<BillingBreakdownOverride> | null;
  meta?: BillingBreakdownMeta | null;
}): BillingOverridePayload {
  const safeValues = normalizeOverrideValues(values);
  const safeMeta = normalizeMeta(meta);
  if (!safeValues && !safeMeta) return null;
  if (safeValues && safeMeta) {
    return { values: safeValues, meta: safeMeta };
  }
  if (safeValues) return { values: safeValues };
  return { meta: safeMeta ?? undefined };
}

export function getGrossIncomeTaxAmountFromBillingOverride(raw: unknown): number {
  const meta = extractBillingOverrideMeta(raw);
  if (!meta?.grossIncomeTaxEnabled) return 0;
  const amount = toFiniteNumber(meta.grossIncomeTaxAmount);
  return amount != null ? amount : 0;
}
