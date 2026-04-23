import { describe, expect, it } from "vitest";
import { buildServiceFinancialRows } from "@/app/balances/serviceRows";

describe("balances service rows", () => {
  it("prorratea cobrado/deuda/deuda operadores por proporción de venta", () => {
    const rows = buildServiceFinancialRows({
      services: [
        { id_service: 10, currency: "ARS", sale_price: 100, cost_price: 40 },
        { id_service: 11, currency: "ARS", sale_price: 300, cost_price: 120 },
        { id_service: 12, currency: "USD", sale_price: 200, cost_price: 70 },
      ],
      bookingSaleNoInt: { ARS: 400, USD: 200 },
      bookingPaid: { ARS: 100, USD: 50 },
      bookingDebt: { ARS: 300, USD: 150 },
      bookingOperatorDebt: { ARS: 40, USD: 20 },
      transferFeePct: 0.024,
      useBookingSaleTotal: false,
    });

    expect(rows).toHaveLength(3);
    expect(rows[0].saleNoInt.ARS).toBeCloseTo(100);
    expect(rows[1].saleNoInt.ARS).toBeCloseTo(300);
    expect(rows[2].saleNoInt.USD).toBeCloseTo(200);
    expect(rows[0].cost.ARS).toBeCloseTo(40);
    expect(rows[1].cost.ARS).toBeCloseTo(120);
    expect(rows[2].cost.USD).toBeCloseTo(70);

    expect(rows[0].paid.ARS).toBeCloseTo(25);
    expect(rows[1].paid.ARS).toBeCloseTo(75);
    expect(rows[2].paid.USD).toBeCloseTo(50);

    expect(rows[0].debt.ARS).toBeCloseTo(75);
    expect(rows[1].debt.ARS).toBeCloseTo(225);
    expect(rows[2].debt.USD).toBeCloseTo(150);

    expect(rows[0].operatorDebt.ARS).toBeCloseTo(10);
    expect(rows[1].operatorDebt.ARS).toBeCloseTo(30);
    expect(rows[2].operatorDebt.USD).toBeCloseTo(20);
  });

  it("hace fallback a reparto equitativo cuando la venta por moneda es cero", () => {
    const rows = buildServiceFinancialRows({
      services: [
        { id_service: 20, currency: "ARS", sale_price: 0 },
        { id_service: 21, currency: "ARS", sale_price: 0 },
      ],
      bookingSaleNoInt: { ARS: 200, USD: 0 },
      bookingPaid: { ARS: 50, USD: 0 },
      bookingDebt: { ARS: 150, USD: 0 },
      bookingOperatorDebt: { ARS: 30, USD: 0 },
      transferFeePct: 0.024,
      useBookingSaleTotal: true,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].saleNoInt.ARS).toBeCloseTo(100);
    expect(rows[1].saleNoInt.ARS).toBeCloseTo(100);
    expect(rows[0].paid.ARS).toBeCloseTo(25);
    expect(rows[1].paid.ARS).toBeCloseTo(25);
    expect(rows[0].debt.ARS).toBeCloseTo(75);
    expect(rows[1].debt.ARS).toBeCloseTo(75);
    expect(rows[0].operatorDebt.ARS).toBeCloseTo(15);
    expect(rows[1].operatorDebt.ARS).toBeCloseTo(15);
  });

  it("mantiene consistencia: la suma por servicios coincide con totales de la reserva", () => {
    const bookingSaleNoInt = { ARS: 1000, USD: 400 };
    const bookingPaid = { ARS: 380, USD: 150 };
    const bookingDebt = { ARS: 620, USD: 250 };
    const bookingOperatorDebt = { ARS: 120, USD: 80 };
    const rows = buildServiceFinancialRows({
      services: [
        { id_service: 30, currency: "ARS", sale_price: 200 },
        { id_service: 31, currency: "ARS", sale_price: 800 },
        { id_service: 32, currency: "USD", sale_price: 100 },
        { id_service: 33, currency: "USD", sale_price: 300 },
      ],
      bookingSaleNoInt,
      bookingPaid,
      bookingDebt,
      bookingOperatorDebt,
      transferFeePct: 0.024,
      useBookingSaleTotal: true,
    });

    const sum = rows.reduce(
      (acc, row) => {
        acc.sale.ARS += row.saleNoInt.ARS;
        acc.sale.USD += row.saleNoInt.USD;
        acc.paid.ARS += row.paid.ARS;
        acc.paid.USD += row.paid.USD;
        acc.debt.ARS += row.debt.ARS;
        acc.debt.USD += row.debt.USD;
        acc.operatorDebt.ARS += row.operatorDebt.ARS;
        acc.operatorDebt.USD += row.operatorDebt.USD;
        return acc;
      },
      {
        sale: { ARS: 0, USD: 0 },
        paid: { ARS: 0, USD: 0 },
        debt: { ARS: 0, USD: 0 },
        operatorDebt: { ARS: 0, USD: 0 },
      },
    );

    expect(sum.sale.ARS).toBeCloseTo(bookingSaleNoInt.ARS);
    expect(sum.sale.USD).toBeCloseTo(bookingSaleNoInt.USD);
    expect(sum.paid.ARS).toBeCloseTo(bookingPaid.ARS);
    expect(sum.paid.USD).toBeCloseTo(bookingPaid.USD);
    expect(sum.debt.ARS).toBeCloseTo(bookingDebt.ARS);
    expect(sum.debt.USD).toBeCloseTo(bookingDebt.USD);
    expect(sum.operatorDebt.ARS).toBeCloseTo(bookingOperatorDebt.ARS);
    expect(sum.operatorDebt.USD).toBeCloseTo(bookingOperatorDebt.USD);
  });

  it("prorratea commNet cuando useBookingSaleTotal está activo", () => {
    const rows = buildServiceFinancialRows({
      services: [
        {
          id_service: 40,
          currency: "ARS",
          sale_price: 100,
          totalCommissionWithoutVAT: 30,
        },
        {
          id_service: 41,
          currency: "ARS",
          sale_price: 300,
          totalCommissionWithoutVAT: 90,
        },
      ],
      bookingSaleNoInt: { ARS: 500, USD: 0 },
      bookingPaid: { ARS: 0, USD: 0 },
      bookingDebt: { ARS: 0, USD: 0 },
      bookingOperatorDebt: { ARS: 0, USD: 0 },
      bookingTaxByCurrency: {
        ARS: { commNet: 80 },
        USD: { commNet: 0 },
      },
      transferFeePct: 0.024,
      useBookingSaleTotal: true,
    });

    expect(rows[0].taxByCurrency.ARS.commNet).toBeCloseTo(20);
    expect(rows[1].taxByCurrency.ARS.commNet).toBeCloseTo(60);
    const totalCommNet = rows.reduce(
      (acc, row) => acc + row.taxByCurrency.ARS.commNet,
      0,
    );
    expect(totalCommNet).toBeCloseTo(80);
  });
});
