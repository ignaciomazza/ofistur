import type { Prisma } from "@prisma/client";

import {
  ensureAgencyCounterAtLeast,
  getNextAgencyCounter,
} from "@/lib/agencyCounters";

export async function getNextAvailableAgencyOperatorId(
  tx: Prisma.TransactionClient,
  id_agency: number,
): Promise<number> {
  const maxOperator = await tx.operator.aggregate({
    where: { id_agency },
    _max: { agency_operator_id: true },
  });

  const maxUsed = maxOperator._max.agency_operator_id ?? 0;
  await ensureAgencyCounterAtLeast(tx, id_agency, "operator", maxUsed + 1);

  return getNextAgencyCounter(tx, id_agency, "operator");
}
