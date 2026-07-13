import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAgencyCounterAtLeast: vi.fn(),
  getNextAgencyCounter: vi.fn(),
}));

vi.mock("@/lib/agencyCounters", () => ({
  ensureAgencyCounterAtLeast: mocks.ensureAgencyCounterAtLeast,
  getNextAgencyCounter: mocks.getNextAgencyCounter,
}));

import { getNextAvailableAgencyOperatorId } from "@/lib/agencyOperatorId";

describe("getNextAvailableAgencyOperatorId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("advances the operator counter beyond the max agency operator id", async () => {
    const tx = {
      operator: {
        aggregate: vi.fn().mockResolvedValue({
          _max: { agency_operator_id: 80 },
        }),
      },
    };
    mocks.getNextAgencyCounter.mockResolvedValue(81);

    const next = await getNextAvailableAgencyOperatorId(tx as never, 52);

    expect(tx.operator.aggregate).toHaveBeenCalledWith({
      where: { id_agency: 52 },
      _max: { agency_operator_id: true },
    });
    expect(mocks.ensureAgencyCounterAtLeast).toHaveBeenCalledWith(
      tx,
      52,
      "operator",
      81,
    );
    expect(mocks.getNextAgencyCounter).toHaveBeenCalledWith(tx, 52, "operator");
    expect(next).toBe(81);
  });

  it("starts at one when the agency has no operators", async () => {
    const tx = {
      operator: {
        aggregate: vi.fn().mockResolvedValue({
          _max: { agency_operator_id: null },
        }),
      },
    };
    mocks.getNextAgencyCounter.mockResolvedValue(1);

    const next = await getNextAvailableAgencyOperatorId(tx as never, 10);

    expect(mocks.ensureAgencyCounterAtLeast).toHaveBeenCalledWith(
      tx,
      10,
      "operator",
      1,
    );
    expect(next).toBe(1);
  });
});
