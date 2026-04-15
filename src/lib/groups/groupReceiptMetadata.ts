import { normalizeCurrencyCode } from "@/lib/groups/financeShared";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toPositiveIntOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

const toOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toOptionalDate = (value: unknown): Date | null => {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
};

export type GroupReceiptStoredPaymentLine = {
  amount: number;
  payment_currency: string;
  fee_amount: number;
  payment_method_id?: number | null;
  account_id?: number | null;
  payment_method?: string | null;
  account?: string | null;
  fee_mode?: "FIXED" | "PERCENT";
  fee_value?: number;
};

export function normalizeGroupReceiptStoredPayments(
  raw: unknown,
): GroupReceiptStoredPaymentLine[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupReceiptStoredPaymentLine[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const amount = Math.max(0, toNumber(item.amount));
    const feeAmount = Math.max(0, toNumber(item.fee_amount));
    if (amount <= 0 && feeAmount <= 0) continue;

    const paymentCurrency = normalizeCurrencyCode(
      item.payment_currency ?? item.paymentCurrency ?? "ARS",
    );
    const paymentMethodId = toPositiveIntOrNull(
      item.payment_method_id ?? item.paymentMethodId,
    );
    const accountId = toPositiveIntOrNull(item.account_id ?? item.accountId);
    const feeModeRaw = String(item.fee_mode ?? item.feeMode ?? "")
      .trim()
      .toUpperCase();
    const feeMode =
      feeModeRaw === "FIXED" || feeModeRaw === "PERCENT"
        ? (feeModeRaw as "FIXED" | "PERCENT")
        : undefined;
    const feeValueRaw = toNumber(item.fee_value ?? item.feeValue);
    const feeValue =
      feeMode != null && Number.isFinite(feeValueRaw)
        ? Math.max(0, feeValueRaw)
        : undefined;

    out.push({
      amount,
      payment_currency: paymentCurrency,
      fee_amount: feeAmount,
      payment_method_id: paymentMethodId,
      account_id: accountId,
      payment_method: toOptionalString(item.payment_method ?? item.paymentMethod),
      account: toOptionalString(item.account),
      fee_mode: feeMode,
      fee_value: feeValue,
    });
  }
  return out;
}

export function asGroupReceiptMetadata(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  return { ...raw };
}

export function readGroupReceiptPaymentsFromMetadata(
  metadataRaw: unknown,
): GroupReceiptStoredPaymentLine[] {
  const metadata = asGroupReceiptMetadata(metadataRaw);
  return normalizeGroupReceiptStoredPayments(metadata.payments);
}

export function withGroupReceiptPaymentsInMetadata(
  metadataRaw: unknown,
  payments: GroupReceiptStoredPaymentLine[],
): Record<string, unknown> {
  const metadata = asGroupReceiptMetadata(metadataRaw);
  return {
    ...metadata,
    payments,
  };
}

export type GroupReceiptVerificationSource = "columns" | "metadata";

export type GroupReceiptVerificationState = {
  status: "PENDING" | "VERIFIED";
  verifiedAt: Date | null;
  verifiedBy: number | null;
  source: GroupReceiptVerificationSource;
};

const normalizeVerificationStatus = (
  value: unknown,
): "PENDING" | "VERIFIED" => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return normalized === "VERIFIED" ? "VERIFIED" : "PENDING";
};

function readVerificationFromMetadata(metadataRaw: unknown): {
  status: "PENDING" | "VERIFIED";
  verifiedAt: Date | null;
  verifiedBy: number | null;
} {
  const metadata = asGroupReceiptMetadata(metadataRaw);
  const verification = asGroupReceiptMetadata(metadata.verification);
  const status = normalizeVerificationStatus(
    verification.status ?? verification.verification_status,
  );
  const verifiedAt =
    status === "VERIFIED"
      ? toOptionalDate(verification.verified_at)
      : null;
  const verifiedBy =
    status === "VERIFIED" ? toPositiveIntOrNull(verification.verified_by) : null;
  return {
    status,
    verifiedAt,
    verifiedBy,
  };
}

export function resolveGroupReceiptVerificationState(args: {
  hasVerificationColumns: boolean;
  columnStatus?: unknown;
  columnVerifiedAt?: unknown;
  columnVerifiedBy?: unknown;
  metadata?: unknown;
}): GroupReceiptVerificationState {
  if (args.hasVerificationColumns) {
    const status = normalizeVerificationStatus(args.columnStatus);
    return {
      status,
      verifiedAt: status === "VERIFIED" ? toOptionalDate(args.columnVerifiedAt) : null,
      verifiedBy:
        status === "VERIFIED" ? toPositiveIntOrNull(args.columnVerifiedBy) : null,
      source: "columns",
    };
  }

  const fallback = readVerificationFromMetadata(args.metadata);
  return {
    status: fallback.status,
    verifiedAt: fallback.verifiedAt,
    verifiedBy: fallback.verifiedBy,
    source: "metadata",
  };
}

export function withGroupReceiptVerificationInMetadata(args: {
  metadata: unknown;
  status: "PENDING" | "VERIFIED";
  verifiedAt?: Date | null;
  verifiedBy?: number | null;
}): Record<string, unknown> {
  const metadata = asGroupReceiptMetadata(args.metadata);
  return {
    ...metadata,
    verification: {
      status: args.status,
      verified_at:
        args.status === "VERIFIED"
          ? (args.verifiedAt ?? new Date()).toISOString()
          : null,
      verified_by:
        args.status === "VERIFIED" ? toPositiveIntOrNull(args.verifiedBy) : null,
    },
  };
}
