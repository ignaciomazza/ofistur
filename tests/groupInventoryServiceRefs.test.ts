import { describe, expect, it } from "vitest";
import {
  mapInventoryToServiceLike,
  resolveInventoryCostTotal,
  resolveInventoryEstimatedSaleUnitPrice,
  resolveInventorySaleUnitPrice,
} from "@/lib/groups/inventoryServiceRefs";

const buildMetaNote = (meta: Record<string, unknown>) =>
  `[OFI_INV_META]${JSON.stringify({ v: 1, ...meta })}[/OFI_INV_META]`;

describe("group inventory service refs", () => {
  it("keeps sale as unit price while exposing reservation cost as total", () => {
    const row = {
      id_travel_group_inventory: 7,
      agency_travel_group_inventory_id: 107,
      travel_group_departure_id: 3,
      inventory_type: "HOTEL",
      service_type: "Alojamiento",
      label: "Hotel base doble",
      provider: "Operador",
      locator: "ABC123",
      currency: "USD",
      unit_cost: "333.33",
      total_qty: 3,
      note: buildMetaNote({
        costTotalPrice: 1000,
        saleUnitPrice: 450,
      }),
      travelGroupDeparture: null,
    };

    expect(resolveInventoryCostTotal(row)).toBe(1000);
    expect(resolveInventoryEstimatedSaleUnitPrice(row)).toBe(450);
    expect(resolveInventorySaleUnitPrice(row)).toBe(450);

    const service = mapInventoryToServiceLike(row, {
      bookingId: 1,
      fallbackCurrency: "ARS",
      fallbackDestination: "Grupal",
    });

    expect(service.cost_price).toBe(1000);
    expect(service.sale_price).toBe(450);
  });

  it("falls back to legacy unit cost times quantity when no total is stored", () => {
    expect(
      resolveInventoryCostTotal({
        unit_cost: "125.50",
        total_qty: 4,
        note: null,
      }),
    ).toBe(502);
  });

  it("does not expose a passenger sale estimate when only cost is present", () => {
    expect(
      resolveInventoryEstimatedSaleUnitPrice({
        total_qty: 2,
        note: buildMetaNote({ costTotalPrice: 800 }),
      }),
    ).toBeNull();
  });
});
