import { describe, expect, it } from "vitest";
import {
  assertGroupPassengerDepartureCanChange,
  GroupFinanceRequestError,
  inventoryIdsFromServiceIds,
  isGroupFinanceRequestError,
} from "@/lib/groups/groupFinanceMutationGuards";
import { encodeInventoryServiceId } from "@/lib/groups/inventoryServiceRefs";

describe("group finance mutation guards", () => {
  it("extracts unique ordered inventory ids from mixed service ids", () => {
    expect(
      inventoryIdsFromServiceIds([
        12,
        encodeInventoryServiceId(8),
        encodeInventoryServiceId(3),
        encodeInventoryServiceId(8),
      ]),
    ).toEqual([3, 8]);
  });

  it("preserves the status and code of a guarded conflict", () => {
    const error = new GroupFinanceRequestError({
      status: 409,
      code: "GROUP_TEST_CONFLICT",
      message: "Cambió el registro.",
    });

    expect(isGroupFinanceRequestError(error)).toBe(true);
    expect(error).toMatchObject({
      status: 409,
      code: "GROUP_TEST_CONFLICT",
    });
  });

  it("blocks moving a passenger that already has group activity", async () => {
    const count = (value: number) => ({ count: async () => value });
    const tx = {
      travelGroupClientPayment: count(1),
      travelGroupReceipt: count(0),
      travelGroupInvoice: count(0),
      travelGroupOperatorDue: count(0),
      travelGroupOperatorPayment: count(0),
    };

    await expect(
      assertGroupPassengerDepartureCanChange(tx as never, {
        agencyId: 1,
        groupId: 2,
        passengerId: 3,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "GROUP_PASSENGER_DEPARTURE_HAS_ACTIVITY",
    });
  });

  it("allows moving a passenger without linked activity", async () => {
    const count = { count: async () => 0 };
    const tx = {
      travelGroupClientPayment: count,
      travelGroupReceipt: count,
      travelGroupInvoice: count,
      travelGroupOperatorDue: count,
      travelGroupOperatorPayment: count,
    };

    await expect(
      assertGroupPassengerDepartureCanChange(tx as never, {
        agencyId: 1,
        groupId: 2,
        passengerId: 3,
      }),
    ).resolves.toBeUndefined();
  });
});
