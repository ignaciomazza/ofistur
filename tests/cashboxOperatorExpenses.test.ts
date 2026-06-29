import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const operatorInvestment = {
  id_investment: 101,
  category: "Operador",
  description: "Pago operador confirmado",
  counterparty_name: "Operador Test",
  amount: new Prisma.Decimal("1500"),
  currency: "ARS",
  created_at: new Date("2026-04-09T15:00:00.000Z"),
  paid_at: new Date("2026-04-10T15:00:00.000Z"),
  payment_method: "Transferencia",
  account: "Banco",
  operator: { name: "Operador Test" },
  booking: null,
};

const groupOperatorPayment = {
  id_travel_group_operator_payment: 901,
  travel_group_id: 77,
  operator_id: 501,
  category: "Pago a operador grupal",
  description: "Pago a operador grupal",
  amount: new Prisma.Decimal("4200"),
  currency: "ARS",
  paid_at: new Date("2026-04-11T15:00:00.000Z"),
  created_at: new Date("2026-04-11T15:00:00.000Z"),
  payment_method: "Transferencia",
  account: "Banco",
};

const groupReceipt = {
  id_travel_group_receipt: 701,
  agency_travel_group_receipt_id: 44,
  travel_group_id: 77,
  client_id: 301,
  client_ids: [301],
  issue_date: new Date("2026-04-12T15:00:00.000Z"),
  amount: new Prisma.Decimal("1000"),
  amount_currency: "ARS",
  concept: "Cobro grupal mixto",
  currency: "ARS",
  payment_method: "Transferencia",
  account: "Banco",
  counter_amount: null,
  counter_currency: null,
  metadata: {
    payments: [
      {
        amount: 1000,
        payment_currency: "ARS",
        payment_method: "Transferencia",
        account: "Banco",
      },
      {
        amount: 50,
        payment_currency: "USD",
        payment_method: "Efectivo",
        account: "Caja USD",
      },
    ],
  },
};

let investmentFindManyCalls = 0;

const prismaMock = {
  financeConfig: {
    findUnique: vi.fn(async () => ({
      hide_operator_expenses_in_investments: true,
    })),
  },
  financeAccount: {
    findMany: vi.fn(async () => []),
  },
  financePaymentMethod: {
    findMany: vi.fn(async () => []),
  },
  receipt: {
    findMany: vi.fn(async () => []),
  },
  otherIncome: {
    findMany: vi.fn(async () => []),
  },
  investment: {
    findMany: vi.fn(),
  },
  travelGroupOperatorPayment: {
    findMany: vi.fn(async () => []),
  },
  travelGroupReceipt: {
    findMany: vi.fn(async () => []),
  },
  operator: {
    findMany: vi.fn(async () => []),
  },
  client: {
    findMany: vi.fn(async () => []),
  },
  travelGroup: {
    findMany: vi.fn(async () => []),
  },
  financeTransfer: {
    findMany: vi.fn(async () => []),
  },
  financeAccountAdjustment: {
    findMany: vi.fn(async () => []),
  },
  clientPayment: {
    findMany: vi.fn(async () => []),
  },
  operatorDue: {
    findMany: vi.fn(async () => []),
  },
  creditAccount: {
    findMany: vi.fn(async () => []),
  },
  financeAccountOpeningBalance: {
    findMany: vi.fn(async () => []),
  },
};

vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
  Prisma,
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async () => ({
    payload: {
      id_user: 1,
      id_agency: 7,
      role: "gerente",
      email: "test@example.com",
    },
  })),
}));

vi.mock("@/lib/planAccess.server", () => ({
  ensurePlanFeatureAccess: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/accessControl", () => ({
  getFinanceSectionGrants: vi.fn(async () => ({})),
}));

vi.mock("@/utils/permissions", () => ({
  canAccessFinanceSection: vi.fn(() => true),
}));

type TestResponse = {
  statusCode: number;
  body: unknown;
  setHeader: ReturnType<typeof vi.fn>;
  status: (code: number) => TestResponse;
  json: (payload: unknown) => TestResponse;
};

function createResponse(): TestResponse {
  const res = {} as TestResponse;
  res.statusCode = 200;
  res.body = null;
  res.setHeader = vi.fn();
  res.status = vi.fn((code: number): TestResponse => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((payload: unknown): TestResponse => {
    res.body = payload;
    return res;
  });
  return res;
}

describe("cashbox operator expenses", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    investmentFindManyCalls = 0;
    prismaMock.investment.findMany
      .mockReset()
      .mockImplementation(
        async (args?: { where?: { operator_id?: unknown } }) => {
          investmentFindManyCalls += 1;
          if (investmentFindManyCalls > 1) return [];
          return args?.where?.operator_id === null ? [] : [operatorInvestment];
        },
      );
    prismaMock.travelGroupOperatorPayment.findMany
      .mockReset()
      .mockImplementation(async () => [groupOperatorPayment]);
    prismaMock.travelGroupReceipt.findMany
      .mockReset()
      .mockImplementation(async () => [groupReceipt]);
    prismaMock.operator.findMany
      .mockReset()
      .mockImplementation(async () => [
        { id_operator: 501, name: "Operador Grupal" },
      ]);
    prismaMock.client.findMany.mockReset().mockImplementation(async () => [
      {
        id_client: 301,
        first_name: "Cliente",
        last_name: "Grupal",
        company_name: null,
      },
    ]);
    prismaMock.travelGroup.findMany.mockReset().mockImplementation(async () => [
      {
        id_travel_group: 77,
        agency_travel_group_id: 9001,
        name: "Europa Abril",
      },
    ]);
  });

  it("includes operator payments even when they are hidden from the investments view", async () => {
    const { default: handler } = await import("@/pages/api/cashbox/index");

    const req = {
      method: "GET",
      query: { year: "2026", month: "4" },
      cookies: { token: "token" },
      headers: {},
    };
    const res = createResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const movements =
      (res.body as { data?: { movements?: Array<{ id: string }> } }).data
        ?.movements ?? [];
    expect(movements).toContainEqual(
      expect.objectContaining({
        id: "investment:101",
        type: "expense",
        source: "investment",
        categoryName: "Operador",
        operatorName: "Operador Test",
      }),
    );
    expect(movements).toContainEqual(
      expect.objectContaining({
        id: "group_operator_payment:901",
        type: "expense",
        source: "investment",
        categoryName: "Pago a operador grupal",
        operatorName: "Operador Grupal",
      }),
    );
  });

  it("includes split travel group receipts in the main cashbox", async () => {
    const { default: handler } = await import("@/pages/api/cashbox/index");

    const req = {
      method: "GET",
      query: { year: "2026", month: "4" },
      cookies: { token: "token" },
      headers: {},
    };
    const res = createResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const data = (
      res.body as {
        data?: { movements?: unknown[]; totalsByCurrency?: unknown[] };
      }
    ).data;
    expect(data?.movements).toContainEqual(
      expect.objectContaining({
        id: "group_receipt:701:payment:1",
        type: "income",
        source: "receipt",
        amount: 1000,
        currency: "ARS",
        paymentMethod: "Transferencia",
        account: "Banco",
        clientName: "Cliente Grupal",
      }),
    );
    expect(data?.movements).toContainEqual(
      expect.objectContaining({
        id: "group_receipt:701:payment:2",
        type: "income",
        source: "receipt",
        amount: 50,
        currency: "USD",
        paymentMethod: "Efectivo",
        account: "Caja USD",
        bookingLabel: "Grupal N° 9001 • Europa Abril",
      }),
    );
    expect(data?.totalsByCurrency).toContainEqual(
      expect.objectContaining({
        currency: "USD",
        income: 50,
      }),
    );
  });
});
