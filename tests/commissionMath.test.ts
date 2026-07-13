import { describe, expect, it } from "vitest";

import {
  calculateAgencyShare,
  calculateBookingCommissionBase,
  calculateCommissionVatTotal,
  calculateServiceCommissionBase,
} from "@/lib/earnings/commissionMath";

describe("earnings commission math", () => {
  it("keeps negative booking commission bases as losses", () => {
    expect(
      calculateBookingCommissionBase({
        sale: 100,
        cost: 120,
        taxes: 5,
        fee: 2,
        adjustments: 3,
        grossIncomeTax: 1,
      }),
    ).toBe(-31);
  });

  it("keeps negative service commission bases as losses", () => {
    expect(
      calculateServiceCommissionBase({
        commissionWithoutVat: 10,
        fee: 12,
        extraCosts: 4,
        extraTaxes: 1,
      }),
    ).toBe(-7);
  });

  it("does not clamp the agency remainder to zero", () => {
    expect(
      calculateAgencyShare({
        commissionBase: -100,
        sellerCommission: -30,
        leaderCommission: -10,
      }),
    ).toBe(-60);
  });

  it("uses the service commission VAT fields instead of a fixed rate", () => {
    expect(
      calculateCommissionVatTotal({
        vatOnCommission21: 21,
        vatOnCommission10_5: "10.5",
      }),
    ).toBe(31.5);
  });
});
