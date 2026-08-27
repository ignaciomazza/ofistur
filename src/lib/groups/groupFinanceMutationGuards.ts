import { Prisma } from "@prisma/client";
import { decodeInventoryServiceId } from "@/lib/groups/inventoryServiceRefs";

export class GroupFinanceRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly solution?: string;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    solution?: string;
  }) {
    super(args.message);
    this.name = "GroupFinanceRequestError";
    this.status = args.status;
    this.code = args.code;
    this.solution = args.solution;
  }
}

export function isGroupFinanceRequestError(
  error: unknown,
): error is GroupFinanceRequestError {
  return error instanceof GroupFinanceRequestError;
}

function uniquePositiveInts(values: number[]): number[] {
  return Array.from(
    new Set(
      values
        .map((value) => Math.trunc(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).sort((a, b) => a - b);
}

export function inventoryIdsFromServiceIds(serviceIds: number[]): number[] {
  return uniquePositiveInts(
    serviceIds
      .map((serviceId) => decodeInventoryServiceId(serviceId))
      .filter((inventoryId): inventoryId is number => inventoryId != null),
  );
}

export async function lockGroupPassenger(
  tx: Prisma.TransactionClient,
  args: {
    agencyId: number;
    groupId: number;
    passengerId: number;
    requireExisting?: boolean;
  },
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id_travel_group_passenger: number }>>(
    Prisma.sql`
      SELECT "id_travel_group_passenger"
      FROM "TravelGroupPassenger"
      WHERE "id_agency" = ${args.agencyId}
        AND "travel_group_id" = ${args.groupId}
        AND "id_travel_group_passenger" = ${args.passengerId}
      FOR UPDATE
    `,
  );
  if (args.requireExisting !== false && rows.length !== 1) {
    throw new GroupFinanceRequestError({
      status: 409,
      code: "GROUP_FINANCE_PASSENGER_CHANGED",
      message: "El pasajero cambió mientras se procesaba la operación.",
      solution: "Refrescá la grupal y volvé a intentarlo.",
    });
  }
}

export async function lockGroupInventoryServiceIds(
  tx: Prisma.TransactionClient,
  args: {
    agencyId: number;
    groupId: number;
    serviceIds: number[];
    requireExisting?: boolean;
  },
): Promise<number[]> {
  const inventoryIds = inventoryIdsFromServiceIds(args.serviceIds);
  if (inventoryIds.length === 0) return [];

  const rows = await tx.$queryRaw<Array<{ id_travel_group_inventory: number }>>(
    Prisma.sql`
      SELECT "id_travel_group_inventory"
      FROM "TravelGroupInventory"
      WHERE "id_agency" = ${args.agencyId}
        AND "travel_group_id" = ${args.groupId}
        AND "id_travel_group_inventory" IN (${Prisma.join(inventoryIds)})
      ORDER BY "id_travel_group_inventory"
      FOR UPDATE
    `,
  );
  if (args.requireExisting !== false && rows.length !== inventoryIds.length) {
    throw new GroupFinanceRequestError({
      status: 409,
      code: "GROUP_FINANCE_SERVICE_CHANGED",
      message: "Algún servicio cambió mientras se procesaba la operación.",
      solution: "Refrescá la grupal y volvé a intentarlo.",
    });
  }
  return inventoryIds;
}

export async function findGroupServiceFinancialReferences(
  tx: Prisma.TransactionClient,
  args: {
    agencyId: number;
    groupId: number;
    serviceId: number;
    passengerId?: number | null;
    passengerIds?: number[];
  },
): Promise<{ receipts: number; invoices: number }> {
  const passengerWhere = args.passengerId
    ? { travel_group_passenger_id: args.passengerId }
    : {};
  const passengerIds = uniquePositiveInts(args.passengerIds ?? []);
  const receiptReferenceWhere = args.passengerId
    ? passengerWhere
    : passengerIds.length > 0
      ? {
          OR: [
            { service_refs: { has: args.serviceId } },
            { travel_group_passenger_id: { in: passengerIds } },
          ],
        }
      : { service_refs: { has: args.serviceId } };
  const [receipts, invoices] = await Promise.all([
    tx.travelGroupReceipt.count({
      where: {
        id_agency: args.agencyId,
        travel_group_id: args.groupId,
        ...receiptReferenceWhere,
      },
    }),
    tx.travelGroupInvoice.count({
      where: {
        id_agency: args.agencyId,
        travel_group_id: args.groupId,
        ...passengerWhere,
        service_refs: { has: args.serviceId },
      },
    }),
  ]);
  return { receipts, invoices };
}

export async function assertGroupServiceHasNoFinancialReferences(
  tx: Prisma.TransactionClient,
  args: {
    agencyId: number;
    groupId: number;
    serviceId: number;
    passengerId?: number | null;
    passengerIds?: number[];
  },
): Promise<void> {
  const references = await findGroupServiceFinancialReferences(tx, args);
  if (references.receipts === 0 && references.invoices === 0) return;

  throw new GroupFinanceRequestError({
    status: 409,
    code: "GROUP_INVENTORY_FINANCIAL_DOCUMENTS_LINKED",
    message:
      "No se puede modificar el servicio porque tiene recibos o facturas vinculadas.",
    solution:
      "Revisá o eliminá primero los documentos financieros asociados al servicio.",
  });
}

export async function assertGroupPassengerDepartureCanChange(
  tx: Prisma.TransactionClient,
  args: {
    agencyId: number;
    groupId: number;
    passengerId: number;
  },
): Promise<void> {
  const sharedWhere = {
    id_agency: args.agencyId,
    travel_group_id: args.groupId,
    travel_group_passenger_id: args.passengerId,
  };
  const [clientPayments, receipts, invoices, operatorDues, operatorPayments] =
    await Promise.all([
      tx.travelGroupClientPayment.count({
        where: {
          ...sharedWhere,
          status: { not: "CANCELADA" },
        },
      }),
      tx.travelGroupReceipt.count({ where: sharedWhere }),
      tx.travelGroupInvoice.count({ where: sharedWhere }),
      tx.travelGroupOperatorDue.count({ where: sharedWhere }),
      tx.travelGroupOperatorPayment.count({ where: sharedWhere }),
    ]);

  if (
    clientPayments + receipts + invoices + operatorDues + operatorPayments ===
    0
  ) {
    return;
  }

  throw new GroupFinanceRequestError({
    status: 409,
    code: "GROUP_PASSENGER_DEPARTURE_HAS_ACTIVITY",
    message:
      "No se puede cambiar la salida porque el pasajero ya tiene servicios o movimientos financieros.",
    solution:
      "Revisá sus servicios, cuotas, recibos, facturas y pagos antes de moverlo de salida.",
  });
}
