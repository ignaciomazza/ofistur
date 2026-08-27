import { Prisma } from "@prisma/client";
import { isGroupServiceAssignment } from "@/lib/groups/clientPaymentRecordType";
import {
  type GroupReceiptDebtCurrent,
  type GroupReceiptDebtValidationResult,
  validateGroupReceiptDebt,
} from "@/lib/groups/groupReceiptDebtValidation";
import { toAmountNumber } from "@/lib/groups/financeShared";
import {
  inventoryIdsFromServiceIds,
  lockGroupInventoryServiceIds,
  lockGroupPassenger,
} from "@/lib/groups/groupFinanceMutationGuards";
import {
  decodeInventoryServiceId,
  encodeInventoryServiceId,
  resolveInventorySaleUnitPrice,
} from "@/lib/groups/inventoryServiceRefs";
import { readGroupReceiptPaymentsFromMetadata } from "@/lib/groups/groupReceiptMetadata";
import { readPassengerSaleConfig } from "@/lib/groups/passengerSaleTotals";

export async function validateGroupReceiptDebtForPassenger(
  tx: Prisma.TransactionClient,
  args: {
    agencyId: number;
    groupId: number;
    passenger: {
      id: number;
      departureId: number | null;
      metadata: unknown;
    };
    selectedServiceIds: number[];
    currentReceipt: GroupReceiptDebtCurrent;
    excludeReceiptId?: number | null;
  },
): Promise<GroupReceiptDebtValidationResult> {
  await lockGroupPassenger(tx, {
    agencyId: args.agencyId,
    groupId: args.groupId,
    passengerId: args.passenger.id,
  });
  const lockedPassenger = await tx.travelGroupPassenger.findFirst({
    where: {
      id_agency: args.agencyId,
      travel_group_id: args.groupId,
      id_travel_group_passenger: args.passenger.id,
    },
    select: {
      travel_group_departure_id: true,
      metadata: true,
    },
  });
  if (!lockedPassenger) {
    return {
      ok: false,
      status: 409,
      code: "GROUP_FINANCE_PASSENGER_CHANGED",
      message: "El pasajero cambió mientras se procesaba la operación.",
    };
  }

  const saleConfig = readPassengerSaleConfig(lockedPassenger.metadata);
  const passengerRows = await tx.travelGroupClientPayment.findMany({
    where: {
      id_agency: args.agencyId,
      travel_group_id: args.groupId,
      travel_group_passenger_id: args.passenger.id,
      status: { not: "CANCELADA" },
    },
    select: {
      service_ref: true,
      amount: true,
      currency: true,
      concept: true,
      status_reason: true,
      metadata: true,
    },
  });
  const assignmentRows = passengerRows.filter(isGroupServiceAssignment);
  const assignedServiceIds = Array.from(
    new Set(
      assignmentRows
        .map((row) => Number(String(row.service_ref ?? "").trim()))
        .filter((serviceId) => Number.isFinite(serviceId) && serviceId > 0),
    ),
  );
  let effectiveServiceIds = Array.from(new Set(args.selectedServiceIds));
  if (effectiveServiceIds.length === 0 && !saleConfig.useSaleTotalOverride) {
    effectiveServiceIds = assignedServiceIds;
  }
  const debtServiceIds = Array.from(
    new Set([...assignedServiceIds, ...effectiveServiceIds]),
  );
  await lockGroupInventoryServiceIds(tx, {
    agencyId: args.agencyId,
    groupId: args.groupId,
    serviceIds: debtServiceIds,
    requireExisting: false,
  });

  const inventoryIds = inventoryIdsFromServiceIds(debtServiceIds);
  const regularServiceIds = Array.from(
    new Set(
      debtServiceIds.filter(
        (serviceId) => decodeInventoryServiceId(serviceId) == null,
      ),
    ),
  );
  const [regularServices, inventoryRows, existingReceipts, previousReceipt] =
    await Promise.all([
      regularServiceIds.length > 0
        ? tx.service.findMany({
            where: {
              id_agency: args.agencyId,
              id_service: { in: regularServiceIds },
            },
            select: {
              id_service: true,
              currency: true,
              sale_price: true,
              card_interest: true,
              taxableCardInterest: true,
              vatOnCardInterest: true,
            },
          })
        : Promise.resolve([]),
      inventoryIds.length > 0
        ? tx.travelGroupInventory.findMany({
            where: {
              id_agency: args.agencyId,
              travel_group_id: args.groupId,
              id_travel_group_inventory: { in: inventoryIds },
              ...(lockedPassenger.travel_group_departure_id == null
                ? { travel_group_departure_id: null }
                : {
                    OR: [
                      { travel_group_departure_id: null },
                      {
                        travel_group_departure_id:
                          lockedPassenger.travel_group_departure_id,
                      },
                    ],
                  }),
            },
            select: {
              id_travel_group_inventory: true,
              currency: true,
              unit_cost: true,
              total_qty: true,
              note: true,
            },
          })
        : Promise.resolve([]),
      tx.travelGroupReceipt.findMany({
        where: {
          id_agency: args.agencyId,
          travel_group_id: args.groupId,
          travel_group_passenger_id: args.passenger.id,
          ...(args.excludeReceiptId
            ? { id_travel_group_receipt: { not: args.excludeReceiptId } }
            : {}),
        },
        select: {
          service_refs: true,
          amount: true,
          amount_currency: true,
          payment_fee_amount: true,
          base_amount: true,
          base_currency: true,
          metadata: true,
        },
      }),
      args.excludeReceiptId
        ? tx.travelGroupReceipt.findFirst({
            where: {
              id_agency: args.agencyId,
              travel_group_id: args.groupId,
              travel_group_passenger_id: args.passenger.id,
              id_travel_group_receipt: args.excludeReceiptId,
            },
            select: {
              service_refs: true,
              amount: true,
              amount_currency: true,
              payment_fee_amount: true,
              base_amount: true,
              base_currency: true,
              metadata: true,
            },
          })
        : Promise.resolve(null),
    ]);

  const assignmentByServiceRef = new Map(
    assignmentRows.map(
      (item) => [String(item.service_ref || ""), item] as const,
    ),
  );
  const services = [
    ...regularServices.map((row) => ({
      id_service: row.id_service,
      currency: row.currency,
      sale_price: toAmountNumber(row.sale_price),
      card_interest: toAmountNumber(row.card_interest),
      taxableCardInterest: toAmountNumber(row.taxableCardInterest),
      vatOnCardInterest: toAmountNumber(row.vatOnCardInterest),
    })),
    ...inventoryRows.map((row) => {
      const idService = encodeInventoryServiceId(row.id_travel_group_inventory);
      const assignment = assignmentByServiceRef.get(String(idService));
      return {
        id_service: idService,
        currency: assignment?.currency ?? row.currency,
        sale_price:
          assignment?.amount != null
            ? toAmountNumber(assignment.amount)
            : resolveInventorySaleUnitPrice(row),
        card_interest: 0,
        taxableCardInterest: 0,
        vatOnCardInterest: 0,
      };
    }),
  ];
  return validateGroupReceiptDebt({
    selectedServiceIds: effectiveServiceIds,
    debtServiceIds,
    services,
    existingReceipts: existingReceipts.map((receipt) => ({
      ...receipt,
      payments: readGroupReceiptPaymentsFromMetadata(receipt.metadata),
    })),
    currentReceipt: args.currentReceipt,
    previousReceipt: previousReceipt
      ? {
          ...previousReceipt,
          payments: readGroupReceiptPaymentsFromMetadata(
            previousReceipt.metadata,
          ),
        }
      : null,
    saleTotalsOverride: saleConfig.useSaleTotalOverride
      ? saleConfig.saleTotals
      : null,
  });
}
