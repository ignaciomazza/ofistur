import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  isMissingGroupFinanceTableError,
  requireGroupFinanceContext,
} from "@/lib/groups/financeShared";
import { readGroupReceiptPaymentsFromMetadata } from "@/lib/groups/groupReceiptMetadata";
import { isGroupServiceAssignment } from "@/lib/groups/clientPaymentRecordType";
import { readPassengerSaleConfig } from "@/lib/groups/passengerSaleTotals";
import {
  buildGroupFinanceSummary,
  type GroupFinanceSummaryResult,
} from "@/lib/groups/financeSummary";
import type { BillingAdjustmentConfig } from "@/types";

type SummaryScope =
  | {
      type: "all";
      key: "all";
      label: string;
      departureId: null;
    }
  | {
      type: "departure";
      key: string;
      label: string;
      departureId: number;
    };

type SummaryResponse = {
  success: true;
  scope: SummaryScope;
  summary: GroupFinanceSummaryResult;
  generated_at: string;
  schema_ready?: boolean;
};

function pickQueryValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function parseSummaryScope(raw: string | null): SummaryScope | null {
  const scope = String(raw || "all")
    .trim()
    .toLowerCase();
  if (!scope || scope === "all" || scope === "group") {
    return {
      type: "all",
      key: "all",
      label: "Toda la grupal",
      departureId: null,
    };
  }
  const departureMatch = scope.match(/^departure:(\d+)$/);
  if (departureMatch) {
    const departureId = Number(departureMatch[1]);
    if (Number.isFinite(departureId) && departureId > 0) {
      return {
        type: "departure",
        key: `departure:${Math.trunc(departureId)}`,
        label: `Salida #${Math.trunc(departureId)}`,
        departureId: Math.trunc(departureId),
      };
    }
  }
  return null;
}

function isMissingSummarySchemaError(error: unknown): boolean {
  if (isMissingGroupFinanceTableError(error)) return true;
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

function normalizeBillingAdjustments(raw: unknown): BillingAdjustmentConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): BillingAdjustmentConfig | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = String(record.id || "").trim();
      const label = String(record.label || "").trim();
      const kind = record.kind === "tax" ? "tax" : "cost";
      const basis =
        record.basis === "cost" || record.basis === "margin"
          ? record.basis
          : "sale";
      const valueType =
        record.valueType === "fixed" || record.valueType === "percent"
          ? record.valueType
          : "percent";
      const value = Number(record.value);
      if (!id || !label || !Number.isFinite(value)) return null;
      return {
        id,
        label,
        kind,
        basis,
        valueType,
        value,
        active: record.active !== false,
        source: record.source === "service" ? "service" : "global",
      };
    })
    .filter((item): item is BillingAdjustmentConfig => item !== null);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SummaryResponse | { error: string; message?: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const ctx = await requireGroupFinanceContext(req, res);
  if (!ctx) return;

  const scope = parseSummaryScope(pickQueryValue(req.query.scope));
  if (!scope) {
    return groupApiError(res, 400, "El scope del resumen es inválido.", {
      code: "GROUP_FINANCE_SUMMARY_SCOPE_INVALID",
      solution: "Usá `all` o `departure:{id}`.",
    });
  }

  let resolvedScope = scope;
  if (scope.type === "departure") {
    const departure = await prisma.travelGroupDeparture.findFirst({
      where: {
        id_agency: ctx.auth.id_agency,
        travel_group_id: ctx.group.id_travel_group,
        id_travel_group_departure: scope.departureId,
      },
      select: {
        id_travel_group_departure: true,
        name: true,
      },
    });
    if (!departure) {
      return groupApiError(
        res,
        404,
        "No encontramos esa salida en la grupal.",
        {
          code: "GROUP_FINANCE_SUMMARY_DEPARTURE_NOT_FOUND",
          solution: "Refrescá la pantalla y seleccioná una salida válida.",
        },
      );
    }
    resolvedScope = {
      ...scope,
      label: `Salida: ${departure.name || `#${departure.id_travel_group_departure}`}`,
    };
  }

  const departureFilter =
    resolvedScope.type === "departure" ? resolvedScope.departureId : null;
  const scopedWhere =
    resolvedScope.type === "departure"
      ? { travel_group_departure_id: departureFilter }
      : {};
  const inventoryWhere =
    resolvedScope.type === "departure"
      ? {
          OR: [
            { travel_group_departure_id: null },
            { travel_group_departure_id: departureFilter },
          ],
        }
      : {};

  try {
    const [
      agency,
      calcConfig,
      inventories,
      assignments,
      receipts,
      operatorPayments,
      operatorDues,
      invoices,
      passengers,
    ] = await Promise.all([
      prisma.agency.findUnique({
        where: { id_agency: ctx.auth.id_agency },
        select: { transfer_fee_pct: true },
      }),
      prisma.serviceCalcConfig.findUnique({
        where: { id_agency: ctx.auth.id_agency },
        select: { billing_adjustments: true },
      }),
      prisma.travelGroupInventory.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          ...inventoryWhere,
        },
        select: {
          id_travel_group_inventory: true,
          travel_group_departure_id: true,
          inventory_type: true,
          service_type: true,
          label: true,
          provider: true,
          currency: true,
          unit_cost: true,
          total_qty: true,
          note: true,
        },
        orderBy: [
          { travel_group_departure_id: "asc" },
          { id_travel_group_inventory: "asc" },
        ],
      }),
      prisma.travelGroupClientPayment.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          service_ref: { not: null },
          status: { not: "CANCELADA" },
          ...scopedWhere,
        },
        select: {
          id_travel_group_client_payment: true,
          travel_group_passenger_id: true,
          travel_group_departure_id: true,
          service_ref: true,
          amount: true,
          currency: true,
          status: true,
          concept: true,
          status_reason: true,
          metadata: true,
        },
        orderBy: { id_travel_group_client_payment: "asc" },
      }),
      prisma.travelGroupReceipt.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          ...scopedWhere,
        },
        select: {
          amount: true,
          amount_currency: true,
          payment_fee_amount: true,
          base_amount: true,
          base_currency: true,
          metadata: true,
        },
      }),
      prisma.travelGroupOperatorPayment.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          ...scopedWhere,
        },
        select: {
          amount: true,
          currency: true,
          base_amount: true,
          base_currency: true,
          service_refs: true,
          payload: true,
        },
      }),
      prisma.travelGroupOperatorDue.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          ...scopedWhere,
        },
        select: {
          amount: true,
          currency: true,
          status: true,
        },
      }),
      prisma.travelGroupInvoice.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          ...scopedWhere,
        },
        select: {
          total_amount: true,
          currency: true,
          status: true,
        },
      }),
      prisma.travelGroupPassenger.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
          ...scopedWhere,
        },
        select: {
          id_travel_group_passenger: true,
          metadata: true,
        },
      }),
    ]);

    const passengerSaleOverrides = passengers.flatMap((passenger) => {
      const saleConfig = readPassengerSaleConfig(passenger.metadata);
      if (
        !saleConfig.useSaleTotalOverride ||
        Object.keys(saleConfig.saleTotals).length === 0
      ) {
        return [];
      }
      return [
        {
          travel_group_passenger_id:
            passenger.id_travel_group_passenger,
          saleTotals: saleConfig.saleTotals,
        },
      ];
    });

    const summary = buildGroupFinanceSummary({
      transferFeePct:
        agency?.transfer_fee_pct != null
          ? Number(agency.transfer_fee_pct)
          : 0.024,
      billingAdjustments: normalizeBillingAdjustments(
        calcConfig?.billing_adjustments,
      ),
      inventories,
      assignments: assignments.filter(isGroupServiceAssignment).map((item) => ({
        id: item.id_travel_group_client_payment,
        travel_group_passenger_id: item.travel_group_passenger_id,
        travel_group_departure_id: item.travel_group_departure_id,
        service_ref: item.service_ref,
        amount: item.amount,
        currency: item.currency,
        status: item.status,
      })),
      receipts: receipts.map((receipt) => ({
        amount: receipt.amount,
        amount_currency: receipt.amount_currency,
        payment_fee_amount: receipt.payment_fee_amount,
        base_amount: receipt.base_amount,
        base_currency: receipt.base_currency,
        payments: readGroupReceiptPaymentsFromMetadata(receipt.metadata),
      })),
      operatorPayments,
      operatorDues,
      invoices,
      passengerSaleOverrides,
    });

    return res.status(200).json({
      success: true,
      scope: resolvedScope,
      summary,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    if (isMissingSummarySchemaError(error)) {
      return res.status(200).json({
        success: true,
        scope: resolvedScope,
        summary: { currencies: [], services: [] },
        generated_at: new Date().toISOString(),
        schema_ready: false,
      });
    }
    console.error("[groups][finance][summary][GET]", error);
    return groupApiError(
      res,
      500,
      "No pudimos cargar el resumen financiero de la grupal.",
      {
        code: "GROUP_FINANCE_SUMMARY_ERROR",
        solution: "Reintentá en unos segundos.",
      },
    );
  }
}
