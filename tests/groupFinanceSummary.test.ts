import { describe, expect, it } from "vitest";
import { buildGroupFinanceSummary } from "@/lib/groups/financeSummary";
import { encodeInventoryServiceId } from "@/lib/groups/inventoryServiceRefs";

const buildMetaNote = (meta: Record<string, unknown>) =>
  `[OFI_INV_META]${JSON.stringify({ v: 1, ...meta })}[/OFI_INV_META]`;

describe("group finance summary", () => {
  it("uses custom passenger sale assignments as the revenue reference", () => {
    const serviceRef = encodeInventoryServiceId(1);

    const summary = buildGroupFinanceSummary({
      transferFeePct: 0.024,
      inventories: [
        {
          id_travel_group_inventory: 1,
          label: "Hotel base",
          currency: "USD",
          total_qty: 4,
          unit_cost: "100",
          note: buildMetaNote({
            saleUnitPrice: 200,
            costTotalPrice: 400,
            taxable21: 40,
          }),
        },
      ],
      assignments: [
        {
          id: 1,
          travel_group_passenger_id: 10,
          service_ref: serviceRef,
          amount: 210,
          currency: "USD",
          status: "PENDIENTE",
        },
        {
          id: 2,
          travel_group_passenger_id: 11,
          service_ref: serviceRef,
          amount: 190,
          currency: "USD",
          status: "PENDIENTE",
        },
      ],
      receipts: [],
      operatorPayments: [],
      operatorDues: [],
      invoices: [],
    });

    expect(summary.currencies[0]).toMatchObject({
      currency: "USD",
      assignedSale: 400,
      assignedCost: 200,
      operatorCost: 400,
      operatorDebt: 400,
      estimatedTaxes: 20,
      transferFees: 9.6,
      estimatedNetCommission: 170.4,
    });
    expect(summary.services[0]).toMatchObject({
      inventoryId: 1,
      assignedCount: 2,
      assignedSale: 400,
      assignedCost: 200,
      estimatedMargin: 170.4,
    });
  });

  it("normalizes receipt base currency and exposes passenger debt", () => {
    const serviceRef = encodeInventoryServiceId(2);
    const summary = buildGroupFinanceSummary({
      inventories: [
        {
          id_travel_group_inventory: 2,
          label: "Aereo",
          currency: "USD",
          total_qty: 1,
          unit_cost: "100",
          note: buildMetaNote({ saleUnitPrice: 500, costTotalPrice: 100 }),
        },
      ],
      assignments: [
        {
          id: 1,
          travel_group_passenger_id: 20,
          service_ref: serviceRef,
          amount: 500,
          currency: "USD",
        },
      ],
      receipts: [
        {
          amount: 200000,
          amount_currency: "ARS",
          base_amount: 200,
          base_currency: "USD",
          payment_fee_amount: 0,
        },
      ],
      operatorPayments: [],
      operatorDues: [],
      invoices: [],
    });

    expect(summary.currencies[0]).toMatchObject({
      assignedSale: 500,
      collected: 200,
      passengerBalance: 300,
      passengerDebt: 300,
      passengerCredit: 0,
      collectionPct: 40,
    });
  });

  it("shows over-collection as passenger credit", () => {
    const serviceRef = encodeInventoryServiceId(3);
    const summary = buildGroupFinanceSummary({
      inventories: [
        {
          id_travel_group_inventory: 3,
          label: "Excursion",
          currency: "USD",
          total_qty: 1,
          unit_cost: "50",
          note: buildMetaNote({ saleUnitPrice: 100 }),
        },
      ],
      assignments: [
        {
          id: 1,
          travel_group_passenger_id: 30,
          service_ref: serviceRef,
          amount: 100,
          currency: "USD",
        },
      ],
      receipts: [
        {
          amount: 130,
          amount_currency: "USD",
          payment_fee_amount: 0,
        },
      ],
      operatorPayments: [],
      operatorDues: [],
      invoices: [],
    });

    expect(summary.currencies[0]).toMatchObject({
      collected: 130,
      passengerBalance: -30,
      passengerDebt: 0,
      passengerCredit: 30,
    });
  });

  it("uses a passenger total override for group revenue and balance", () => {
    const serviceRef = encodeInventoryServiceId(6);
    const summary = buildGroupFinanceSummary({
      transferFeePct: 0.024,
      inventories: [
        {
          id_travel_group_inventory: 6,
          label: "Paquete flexible",
          currency: "USD",
          total_qty: 1,
          unit_cost: "70",
          note: buildMetaNote({ saleUnitPrice: 100 }),
        },
      ],
      assignments: [
        {
          id: 1,
          travel_group_passenger_id: 60,
          service_ref: serviceRef,
          amount: 100,
          currency: "USD",
        },
      ],
      passengerSaleOverrides: [
        {
          travel_group_passenger_id: 60,
          saleTotals: { USD: 150 },
        },
      ],
      receipts: [
        {
          amount: 120,
          amount_currency: "USD",
          payment_fee_amount: 0,
        },
      ],
      operatorPayments: [],
      operatorDues: [],
      invoices: [],
    });

    expect(summary.currencies[0]).toMatchObject({
      assignedSale: 150,
      collected: 120,
      passengerDebt: 30,
      transferFees: 3.6,
    });
    expect(summary.services[0]).toMatchObject({
      assignedSale: 100,
      assignedCost: 70,
    });
  });

  it("subtracts operator payments from the total reserved service cost", () => {
    const serviceRef = encodeInventoryServiceId(4);
    const summary = buildGroupFinanceSummary({
      inventories: [
        {
          id_travel_group_inventory: 4,
          label: "Bus",
          currency: "USD",
          total_qty: 2,
          unit_cost: "100",
          note: buildMetaNote({ saleUnitPrice: 150 }),
        },
      ],
      assignments: [
        {
          id: 1,
          travel_group_passenger_id: 40,
          service_ref: serviceRef,
          amount: 150,
          currency: "USD",
        },
      ],
      receipts: [],
      operatorPayments: [
        {
          amount: 100000,
          currency: "ARS",
          payload: {
            allocations: [
              {
                service_id: serviceRef,
                service_currency: "USD",
                amount_service: 80,
                amount_payment: 100000,
              },
            ],
          },
        },
        {
          amount: 20000,
          currency: "ARS",
          base_amount: 20,
          base_currency: "USD",
        },
      ],
      operatorDues: [
        { amount: 50, currency: "USD", status: "PENDIENTE" },
        { amount: 30, currency: "USD", status: "PAGADA" },
      ],
      invoices: [],
    });

    expect(summary.currencies[0]).toMatchObject({
      operatorCost: 200,
      operatorPaid: 100,
      operatorDebt: 100,
      operatorPaidPct: 50,
    });
  });

  it("uses due dates only as scheduling data, not as operator debt", () => {
    const serviceRef = encodeInventoryServiceId(40);
    const summary = buildGroupFinanceSummary({
      inventories: [
        {
          id_travel_group_inventory: 40,
          label: "Hotel",
          currency: "USD",
          total_qty: 2,
          unit_cost: "100",
          note: buildMetaNote({ costTotalPrice: 200, saleUnitPrice: 150 }),
        },
      ],
      assignments: [
        {
          id: 1,
          travel_group_passenger_id: 401,
          service_ref: serviceRef,
          amount: 150,
          currency: "USD",
        },
        {
          id: 2,
          travel_group_passenger_id: 402,
          service_ref: serviceRef,
          amount: 150,
          currency: "USD",
        },
      ],
      receipts: [],
      operatorPayments: [{ amount: 80, currency: "USD" }],
      operatorDues: [{ amount: 25, currency: "USD", status: "PENDIENTE" }],
      invoices: [],
    });

    expect(summary.currencies[0]).toMatchObject({
      assignedCost: 200,
      operatorCost: 200,
      operatorPaid: 80,
      operatorDebt: 120,
      operatorPaidPct: 40,
    });
  });

  it("keeps operator debt for reserved inventory without assignments", () => {
    const summary = buildGroupFinanceSummary({
      inventories: [
        {
          id_travel_group_inventory: 41,
          label: "Bloqueo aéreo",
          currency: "USD",
          total_qty: 10,
          unit_cost: "100",
          note: buildMetaNote({ costTotalPrice: 1_000 }),
        },
      ],
      assignments: [],
      receipts: [],
      operatorPayments: [{ amount: 250, currency: "USD" }],
      operatorDues: [],
      invoices: [],
    });

    expect(summary.currencies[0]).toMatchObject({
      assignedCost: 0,
      operatorCost: 1_000,
      operatorPaid: 250,
      operatorDebt: 750,
      operatorPaidPct: 25,
    });
  });

  it("excludes cancelled invoices and subtracts configured adjustments", () => {
    const serviceRef = encodeInventoryServiceId(5);
    const summary = buildGroupFinanceSummary({
      transferFeePct: 2.4,
      billingAdjustments: [
        {
          id: "bank-extra",
          label: "Costo extra",
          kind: "cost",
          basis: "sale",
          valueType: "percent",
          value: 0.05,
          active: true,
        },
      ],
      inventories: [
        {
          id_travel_group_inventory: 5,
          label: "Paquete",
          currency: "USD",
          total_qty: 1,
          unit_cost: "100",
          note: buildMetaNote({ saleUnitPrice: 300, taxable21: 30 }),
        },
      ],
      assignments: [
        {
          id: 1,
          travel_group_passenger_id: 50,
          service_ref: serviceRef,
          amount: 300,
          currency: "USD",
        },
      ],
      receipts: [],
      operatorPayments: [],
      operatorDues: [],
      invoices: [
        { total_amount: 80, currency: "USD", status: "EMITIDA" },
        { total_amount: 20, currency: "USD", status: "ANULADA" },
      ],
    });

    expect(summary.currencies[0]).toMatchObject({
      invoiced: 80,
      invoicePending: 220,
      estimatedTaxes: 30,
      transferFees: 7.2,
      adjustments: 15,
      taxesAndFees: 52.2,
      estimatedNetCommission: 147.8,
      invoicedPct: 26.67,
    });
  });
});
