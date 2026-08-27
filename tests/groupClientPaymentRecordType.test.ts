import { describe, expect, it } from "vitest";
import {
  getGroupClientPaymentRecordType,
  GROUP_CLIENT_PAYMENT_RECORD_TYPE,
  groupClientPaymentRecordMetadata,
  isGroupPaymentInstallment,
  isGroupServiceAssignment,
} from "@/lib/groups/clientPaymentRecordType";

describe("group client payment record type", () => {
  it("classifies explicitly tagged assignments", () => {
    const row = {
      metadata: groupClientPaymentRecordMetadata(
        GROUP_CLIENT_PAYMENT_RECORD_TYPE.SERVICE_ASSIGNMENT,
        { inventory_id: 12 },
      ),
      concept: "Plan de pagos",
    };

    expect(isGroupServiceAssignment(row)).toBe(true);
    expect(isGroupPaymentInstallment(row)).toBe(false);
  });

  it("classifies legacy assignment concepts with or without accents", () => {
    expect(
      getGroupClientPaymentRecordType({ concept: "Asignación: Hotel" }),
    ).toBe(GROUP_CLIENT_PAYMENT_RECORD_TYPE.SERVICE_ASSIGNMENT);
    expect(
      getGroupClientPaymentRecordType({ concept: "Asignacion: Aéreo" }),
    ).toBe(GROUP_CLIENT_PAYMENT_RECORD_TYPE.SERVICE_ASSIGNMENT);
  });

  it("keeps service-linked plans as installments", () => {
    expect(
      getGroupClientPaymentRecordType({
        concept: "Cuota 1",
        metadata: null,
      }),
    ).toBe(GROUP_CLIENT_PAYMENT_RECORD_TYPE.PAYMENT_INSTALLMENT);
  });

  it("uses the explicit marker before legacy heuristics", () => {
    expect(
      getGroupClientPaymentRecordType({
        concept: "Asignación: texto escrito por el usuario",
        metadata: groupClientPaymentRecordMetadata(
          GROUP_CLIENT_PAYMENT_RECORD_TYPE.PAYMENT_INSTALLMENT,
        ),
      }),
    ).toBe(GROUP_CLIENT_PAYMENT_RECORD_TYPE.PAYMENT_INSTALLMENT);
  });
});
