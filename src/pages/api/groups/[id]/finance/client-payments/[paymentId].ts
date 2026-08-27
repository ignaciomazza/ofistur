import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { groupApiError } from "@/lib/groups/apiErrors";
import { isGroupServiceAssignment } from "@/lib/groups/clientPaymentRecordType";
import {
  parseOptionalPositiveInt,
  requireGroupFinanceContext,
} from "@/lib/groups/financeShared";

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireGroupFinanceContext(req, res, { write: true });
  if (!ctx) return;

  const paymentId = parseOptionalPositiveInt(
    Array.isArray(req.query.paymentId)
      ? req.query.paymentId[0]
      : req.query.paymentId,
  );
  if (!paymentId) {
    return groupApiError(res, 400, "El identificador del pago es inválido.", {
      code: "GROUP_FINANCE_PAYMENT_ID_INVALID",
    });
  }

  const rows = await prisma.$queryRaw<
    Array<{
      id_travel_group_client_payment: number;
      status: string;
      concept: string | null;
      status_reason: string | null;
      metadata: unknown;
    }>
  >(Prisma.sql`
    SELECT
      "id_travel_group_client_payment",
      "status",
      "concept",
      "status_reason",
      "metadata"
    FROM "TravelGroupClientPayment"
    WHERE "id_travel_group_client_payment" = ${paymentId}
      AND "id_agency" = ${ctx.auth.id_agency}
      AND "travel_group_id" = ${ctx.group.id_travel_group}
    LIMIT 1
  `);
  const payment = rows[0];
  if (!payment) {
    return groupApiError(res, 404, "No encontramos ese pago de grupal.", {
      code: "GROUP_FINANCE_PAYMENT_NOT_FOUND",
    });
  }
  if (isGroupServiceAssignment(payment)) {
    return groupApiError(
      res,
      409,
      "Este registro corresponde a una asignación de servicio, no a una cuota.",
      {
        code: "GROUP_FINANCE_PAYMENT_IS_SERVICE_ASSIGNMENT",
        solution:
          "Quitá el servicio desde la sección de servicios del pasajero.",
      },
    );
  }

  const status = String(payment.status || "")
    .trim()
    .toUpperCase();
  if (status === "PAGADA") {
    return groupApiError(
      res,
      409,
      "No podés eliminar un pago ya marcado como pagado.",
      {
        code: "GROUP_FINANCE_PAYMENT_LOCKED",
        solution: "Primero revertí el estado del pago.",
      },
    );
  }

  const deleted = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "TravelGroupClientPayment"
    WHERE "id_travel_group_client_payment" = ${paymentId}
      AND "id_agency" = ${ctx.auth.id_agency}
      AND "travel_group_id" = ${ctx.group.id_travel_group}
      AND UPPER(COALESCE("status", '')) NOT IN ('PAGADA', 'PAGO')
      AND "receipt_id" IS NULL
  `);
  if (deleted !== 1) {
    return groupApiError(
      res,
      409,
      "La cuota cambió mientras intentabas eliminarla.",
      {
        code: "GROUP_FINANCE_PAYMENT_DELETE_CONFLICT",
        solution: "Refrescá la grupal y revisá su estado antes de reintentar.",
      },
    );
  }

  return res.status(204).end();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "DELETE") return handleDelete(req, res);
  res.setHeader("Allow", ["DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
