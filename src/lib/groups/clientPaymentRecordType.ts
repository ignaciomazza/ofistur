import type { Prisma } from "@prisma/client";

export const GROUP_CLIENT_PAYMENT_RECORD_TYPE = {
  SERVICE_ASSIGNMENT: "SERVICE_ASSIGNMENT",
  PAYMENT_INSTALLMENT: "PAYMENT_INSTALLMENT",
} as const;

export type GroupClientPaymentRecordType =
  (typeof GROUP_CLIENT_PAYMENT_RECORD_TYPE)[keyof typeof GROUP_CLIENT_PAYMENT_RECORD_TYPE];

type GroupClientPaymentLike = {
  metadata?: unknown;
  concept?: unknown;
  status_reason?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeText = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();

function explicitRecordType(
  metadata: unknown,
): GroupClientPaymentRecordType | null {
  if (!isRecord(metadata)) return null;
  const raw = normalizeText(metadata.record_type);
  if (raw === GROUP_CLIENT_PAYMENT_RECORD_TYPE.SERVICE_ASSIGNMENT) {
    return GROUP_CLIENT_PAYMENT_RECORD_TYPE.SERVICE_ASSIGNMENT;
  }
  if (raw === GROUP_CLIENT_PAYMENT_RECORD_TYPE.PAYMENT_INSTALLMENT) {
    return GROUP_CLIENT_PAYMENT_RECORD_TYPE.PAYMENT_INSTALLMENT;
  }
  return null;
}

/**
 * Classifies both newly tagged rows and legacy rows created before record_type
 * existed. Legacy assignments have always been created with the "Asignación:"
 * concept; regular installments default to PAYMENT_INSTALLMENT.
 */
export function getGroupClientPaymentRecordType(
  row: GroupClientPaymentLike,
): GroupClientPaymentRecordType {
  const explicit = explicitRecordType(row.metadata);
  if (explicit) return explicit;

  const concept = normalizeText(row.concept);
  const statusReason = normalizeText(row.status_reason);
  if (
    concept.startsWith("ASIGNACION:") ||
    statusReason === "ASIGNACION DE SERVICIO ANULADA" ||
    statusReason === "VALOR DE VENTA AJUSTADO MANUALMENTE"
  ) {
    return GROUP_CLIENT_PAYMENT_RECORD_TYPE.SERVICE_ASSIGNMENT;
  }

  return GROUP_CLIENT_PAYMENT_RECORD_TYPE.PAYMENT_INSTALLMENT;
}

export function isGroupServiceAssignment(row: GroupClientPaymentLike): boolean {
  return (
    getGroupClientPaymentRecordType(row) ===
    GROUP_CLIENT_PAYMENT_RECORD_TYPE.SERVICE_ASSIGNMENT
  );
}

export function isGroupPaymentInstallment(
  row: GroupClientPaymentLike,
): boolean {
  return (
    getGroupClientPaymentRecordType(row) ===
    GROUP_CLIENT_PAYMENT_RECORD_TYPE.PAYMENT_INSTALLMENT
  );
}

export function groupClientPaymentRecordMetadata(
  recordType: GroupClientPaymentRecordType,
  extra?: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  return {
    ...(extra ?? {}),
    record_type: recordType,
  };
}
