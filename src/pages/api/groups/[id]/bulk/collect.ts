import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import {
  canWriteGroups,
  isLockedGroupStatus,
  parseGroupWhereInput,
  parseOptionalString,
  requireAuth,
  toDistinctPositiveInts,
} from "@/lib/groups/apiShared";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  isGroupPaymentInstallment,
  isGroupServiceAssignment,
} from "@/lib/groups/clientPaymentRecordType";
import {
  GroupFinanceRequestError,
  isGroupFinanceRequestError,
  lockGroupInventoryServiceIds,
  lockGroupPassenger,
} from "@/lib/groups/groupFinanceMutationGuards";
import { validateGroupReceiptDebtForPassenger } from "@/lib/groups/groupReceiptDebtContext";

type Body = {
  paymentIds?: unknown;
  passengerIds?: unknown;
  createReceipts?: unknown;
  issue_date?: unknown;
  concept?: unknown;
  amountString?: unknown;
  payment_fee_amount?: unknown;
  payment_method_id?: unknown;
  account_id?: unknown;
};

type GroupPaymentRow = {
  id_travel_group_client_payment: number;
  travel_group_passenger_id: number;
  travel_group_departure_id: number | null;
  client_id: number;
  service_ref: string | null;
  amount: Prisma.Decimal;
  currency: string;
  status: string;
  concept: string | null;
  status_reason: string | null;
  metadata: unknown;
};

function pickParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const ymd = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    return new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      0,
      0,
      0,
      0,
    );
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function toServiceIds(items: GroupPaymentRow[]): number[] {
  const unique = new Set<number>();
  for (const item of items) {
    const serviceId = Number(String(item.service_ref ?? "").trim());
    if (Number.isFinite(serviceId) && serviceId > 0) unique.add(serviceId);
  }
  return Array.from(unique);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return groupApiError(res, 405, "Método no permitido para esta ruta.", {
      code: "METHOD_NOT_ALLOWED",
      details: `Método recibido: ${req.method ?? "desconocido"}.`,
      solution: "Usá una solicitud POST para cobrar en lote.",
    });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!canWriteGroups(auth.role)) {
    return groupApiError(res, 403, "No tenés permisos para cobrar en lote.", {
      code: "GROUP_COLLECT_FORBIDDEN",
      solution: "Solicitá permisos de edición de grupales a un administrador.",
    });
  }

  const rawGroupId = pickParam(req.query.id);
  if (!rawGroupId) {
    return groupApiError(
      res,
      400,
      "El identificador de la grupal es inválido.",
      {
        code: "GROUP_ID_INVALID",
        solution: "Volvé al listado de grupales y abrila nuevamente.",
      },
    );
  }
  const groupWhere = parseGroupWhereInput(rawGroupId, auth.id_agency);
  if (!groupWhere) {
    return groupApiError(res, 404, "No encontramos la grupal solicitada.", {
      code: "GROUP_NOT_FOUND",
      solution: "Revisá que exista y pertenezca a tu agencia.",
    });
  }
  const group = await prisma.travelGroup.findFirst({
    where: groupWhere,
    select: { id_travel_group: true, status: true, name: true },
  });
  if (!group) {
    return groupApiError(res, 404, "No encontramos la grupal solicitada.", {
      code: "GROUP_NOT_FOUND",
      solution: "Revisá que exista y pertenezca a tu agencia.",
    });
  }
  if (isLockedGroupStatus(group.status)) {
    return groupApiError(
      res,
      409,
      "No se pueden cobrar pagos en grupales cerradas o canceladas.",
      {
        code: "GROUP_LOCKED",
        solution: "Cambiá el estado de la grupal antes de cobrar.",
      },
    );
  }

  const body = (req.body ?? {}) as Body;
  const paymentIdsFromBody = toDistinctPositiveInts(body.paymentIds);
  const passengerIdsFromBody = toDistinctPositiveInts(body.passengerIds);

  const createReceipts = body.createReceipts !== false;
  const issueDate = parseDate(body.issue_date);
  if (issueDate === undefined) {
    return groupApiError(res, 400, "La fecha de emisión es inválida.", {
      code: "GROUP_COLLECT_ISSUE_DATE_INVALID",
      solution: "Ingresá una fecha válida con formato AAAA-MM-DD.",
    });
  }
  const concept =
    parseOptionalString(body.concept, 200) ??
    `Cobro masivo grupal ${group.name}`;
  const amountString =
    parseOptionalString(body.amountString, 200) ?? "COBRO MASIVO";

  const paymentMethodId = toPositiveInt(body.payment_method_id);
  if (createReceipts && !paymentMethodId) {
    return groupApiError(
      res,
      400,
      "Para emitir recibos masivos debés indicar un método de cobro.",
      {
        code: "GROUP_COLLECT_METHOD_REQUIRED",
        solution: "Elegí un método de pago y volvé a intentar.",
      },
    );
  }
  const accountId = toPositiveInt(body.account_id);

  const feeAmountRaw =
    body.payment_fee_amount == null || body.payment_fee_amount === ""
      ? null
      : Number(String(body.payment_fee_amount).replace(",", "."));
  if (
    feeAmountRaw != null &&
    (!Number.isFinite(feeAmountRaw) || feeAmountRaw < 0)
  ) {
    return groupApiError(
      res,
      400,
      "El costo adicional del cobro es inválido.",
      {
        code: "GROUP_COLLECT_FEE_INVALID",
        solution: "Ingresá un valor numérico mayor o igual a 0.",
      },
    );
  }

  const [paymentMethod, account] = await Promise.all([
    paymentMethodId
      ? prisma.financePaymentMethod.findFirst({
          where: {
            id_method: paymentMethodId,
            id_agency: auth.id_agency,
          },
          select: { id_method: true, name: true },
        })
      : Promise.resolve(null),
    accountId
      ? prisma.financeAccount.findFirst({
          where: {
            id_account: accountId,
            id_agency: auth.id_agency,
          },
          select: { id_account: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  if (paymentMethodId && !paymentMethod) {
    return groupApiError(res, 400, "El método de cobro indicado es inválido.", {
      code: "GROUP_COLLECT_METHOD_INVALID",
      solution: "Seleccioná un método de cobro válido de tu agencia.",
    });
  }
  if (accountId && !account) {
    return groupApiError(res, 400, "La cuenta indicada es inválida.", {
      code: "GROUP_COLLECT_ACCOUNT_INVALID",
      solution: "Seleccioná una cuenta válida de tu agencia.",
    });
  }

  let paymentIds = paymentIdsFromBody;
  if (paymentIds.length === 0 && passengerIdsFromBody.length > 0) {
    const passengers = await prisma.travelGroupPassenger.findMany({
      where: {
        id_agency: auth.id_agency,
        travel_group_id: group.id_travel_group,
        id_travel_group_passenger: { in: passengerIdsFromBody },
      },
      select: { id_travel_group_passenger: true },
    });
    if (passengers.length === 0) {
      return groupApiError(
        res,
        400,
        "No se encontraron pasajeros válidos para cobrar.",
        {
          code: "GROUP_COLLECT_PASSENGERS_INVALID",
          solution: "Seleccioná pasajeros de esta grupal y volvé a intentar.",
        },
      );
    }

    const pending = await prisma.travelGroupClientPayment.findMany({
      where: {
        id_agency: auth.id_agency,
        travel_group_id: group.id_travel_group,
        status: "PENDIENTE",
        travel_group_passenger_id: {
          in: passengers.map((item) => item.id_travel_group_passenger),
        },
      },
      select: {
        id_travel_group_client_payment: true,
        concept: true,
        status_reason: true,
        metadata: true,
      },
    });
    paymentIds = pending
      .filter(isGroupPaymentInstallment)
      .map((item) => item.id_travel_group_client_payment);
  }

  if (paymentIds.length === 0) {
    return groupApiError(
      res,
      400,
      "No encontramos cuotas pendientes para cobrar.",
      {
        code: "GROUP_COLLECT_EMPTY",
        solution:
          "Seleccioná pasajeros con cuotas pendientes o indicá pagos válidos.",
      },
    );
  }

  const payments = await prisma.travelGroupClientPayment.findMany({
    where: {
      id_agency: auth.id_agency,
      id_travel_group_client_payment: { in: paymentIds },
    },
    select: {
      id_travel_group_client_payment: true,
      travel_group_passenger_id: true,
      travel_group_departure_id: true,
      client_id: true,
      service_ref: true,
      amount: true,
      currency: true,
      status: true,
      travel_group_id: true,
      concept: true,
      status_reason: true,
      metadata: true,
    },
  });
  if (payments.length !== paymentIds.length) {
    return groupApiError(
      res,
      404,
      "Alguno de los pagos seleccionados no existe.",
      {
        code: "GROUP_COLLECT_PAYMENT_NOT_FOUND",
        solution: "Refrescá la pantalla y volvé a seleccionar los pagos.",
      },
    );
  }
  if (payments.some(isGroupServiceAssignment)) {
    return groupApiError(
      res,
      400,
      "La selección incluye asignaciones de servicios que no son cuotas.",
      {
        code: "GROUP_COLLECT_INCLUDES_SERVICE_ASSIGNMENT",
        solution:
          "Refrescá la lista y seleccioná únicamente cuotas pendientes.",
      },
    );
  }

  for (const payment of payments) {
    if (payment.travel_group_id !== group.id_travel_group) {
      return groupApiError(
        res,
        400,
        "Hay pagos que no pertenecen a la grupal indicada.",
        {
          code: "GROUP_COLLECT_PAYMENT_SCOPE_INVALID",
          solution: "Seleccioná únicamente pagos de esta grupal.",
        },
      );
    }
    if (payment.status !== "PENDIENTE") {
      return groupApiError(
        res,
        400,
        "Solo se pueden cobrar cuotas en estado pendiente.",
        {
          code: "GROUP_COLLECT_PAYMENT_STATUS_INVALID",
          solution: "Quitá pagos ya cobrados o cancelados de la selección.",
        },
      );
    }
  }

  const buckets = new Map<
    string,
    {
      travel_group_passenger_id: number;
      travel_group_departure_id: number | null;
      client_id: number;
      currency: string;
      payments: GroupPaymentRow[];
    }
  >();

  for (const payment of payments) {
    const key = `${payment.travel_group_passenger_id}::${payment.client_id}::${payment.currency}`;
    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, {
        travel_group_passenger_id: payment.travel_group_passenger_id,
        travel_group_departure_id: payment.travel_group_departure_id,
        client_id: payment.client_id,
        currency: payment.currency,
        payments: [payment],
      });
    } else {
      current.payments.push(payment);
    }
  }

  const now = new Date();
  const paidAt = issueDate ?? now;
  let settledCount = 0;
  const receiptsCreated: Array<{
    travel_group_passenger_id: number;
    client_id: number;
    currency: string;
    receipt_id: number | null;
    payment_ids: number[];
  }> = [];
  const orderedBuckets = Array.from(buckets.values()).sort((a, b) => {
    if (a.travel_group_passenger_id !== b.travel_group_passenger_id) {
      return a.travel_group_passenger_id - b.travel_group_passenger_id;
    }
    if (a.client_id !== b.client_id) return a.client_id - b.client_id;
    return a.currency.localeCompare(b.currency);
  });

  try {
    await prisma.$transaction(async (tx) => {
      for (const bucket of orderedBuckets) {
        await lockGroupPassenger(tx, {
          agencyId: auth.id_agency,
          groupId: group.id_travel_group,
          passengerId: bucket.travel_group_passenger_id,
        });
        const serviceIds = toServiceIds(bucket.payments);
        await lockGroupInventoryServiceIds(tx, {
          agencyId: auth.id_agency,
          groupId: group.id_travel_group,
          serviceIds,
        });
        const total = bucket.payments.reduce(
          (acc, payment) => acc.plus(payment.amount),
          new Prisma.Decimal(0),
        );

        let createdReceiptId: number | null = null;
        if (createReceipts) {
          const targetPassenger =
            await tx.travelGroupPassenger.findUniqueOrThrow({
              where: {
                id_travel_group_passenger: bucket.travel_group_passenger_id,
              },
              select: {
                id_travel_group_passenger: true,
                travel_group_departure_id: true,
                metadata: true,
              },
            });
          const validation = await validateGroupReceiptDebtForPassenger(tx, {
            agencyId: auth.id_agency,
            groupId: group.id_travel_group,
            passenger: {
              id: targetPassenger.id_travel_group_passenger,
              departureId: targetPassenger.travel_group_departure_id,
              metadata: targetPassenger.metadata,
            },
            selectedServiceIds: serviceIds,
            currentReceipt: {
              amount: Number(total.toString()),
              amountCurrency: bucket.currency,
              paymentFeeAmount: feeAmountRaw ?? 0,
              baseAmount: null,
              baseCurrency: null,
            },
          });
          if (!validation.ok) {
            throw new GroupFinanceRequestError({
              status: validation.status,
              code: validation.code,
              message: validation.message,
            });
          }
          const agencyReceiptId = await getNextAgencyCounter(
            tx,
            auth.id_agency,
            "travel_group_receipt",
          );
          const created = await tx.travelGroupReceipt.create({
            data: {
              agency_travel_group_receipt_id: agencyReceiptId,
              id_agency: auth.id_agency,
              travel_group_id: group.id_travel_group,
              travel_group_departure_id: bucket.travel_group_departure_id,
              travel_group_passenger_id: bucket.travel_group_passenger_id,
              client_id: bucket.client_id,
              issue_date: paidAt,
              amount: total,
              amount_string: amountString,
              amount_currency: bucket.currency,
              concept,
              currency: bucket.currency,
              payment_method: paymentMethod?.name ?? null,
              payment_fee_amount:
                feeAmountRaw == null ? null : new Prisma.Decimal(feeAmountRaw),
              account: account?.name ?? null,
              client_ids: [bucket.client_id],
              service_refs: validation.normalizedServiceIds,
            },
            select: { id_travel_group_receipt: true },
          });
          createdReceiptId = created.id_travel_group_receipt;
        }

        const updated = await tx.travelGroupClientPayment.updateMany({
          where: {
            id_agency: auth.id_agency,
            travel_group_id: group.id_travel_group,
            travel_group_passenger_id: bucket.travel_group_passenger_id,
            client_id: bucket.client_id,
            id_travel_group_client_payment: {
              in: bucket.payments.map(
                (item) => item.id_travel_group_client_payment,
              ),
            },
            status: "PENDIENTE",
            receipt_id: null,
          },
          data: {
            status: "PAGADA",
            paid_at: paidAt,
            paid_by: auth.id_user,
            receipt_id: createdReceiptId,
            status_reason: "Cobro masivo de grupal",
            updated_at: new Date(),
          },
        });
        if (updated.count !== bucket.payments.length) {
          throw new GroupFinanceRequestError({
            status: 409,
            code: "GROUP_COLLECT_PAYMENT_ALREADY_SETTLED",
            message: "Alguna cuota seleccionada ya fue cobrada.",
            solution:
              "Refrescá la grupal y revisá los recibos antes de reintentar.",
          });
        }

        settledCount += bucket.payments.length;
        receiptsCreated.push({
          travel_group_passenger_id: bucket.travel_group_passenger_id,
          client_id: bucket.client_id,
          currency: bucket.currency,
          receipt_id: createdReceiptId,
          payment_ids: bucket.payments.map(
            (item) => item.id_travel_group_client_payment,
          ),
        });
      }
    });

    return res.status(200).json({
      ok: true,
      settled_count: settledCount,
      receipts_count: receiptsCreated.filter((item) => item.receipt_id != null)
        .length,
      buckets: receiptsCreated,
    });
  } catch (error) {
    if (isGroupFinanceRequestError(error)) {
      return groupApiError(res, error.status, error.message, {
        code: error.code,
        solution: error.solution,
      });
    }
    console.error("[groups][bulk][collect]", error);
    return groupApiError(res, 500, "No pudimos cobrar los pagos en lote.", {
      code: "GROUP_COLLECT_ERROR",
      solution: "Reintentá en unos segundos.",
    });
  }
}
