import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import {
  canWriteGroups,
  isLockedGroupStatus,
  parseDepartureWhereInput,
  parseGroupWhereInput,
  parseOptionalStringPatch,
  requireAuth,
  toJsonInput,
  toDistinctPositiveInts,
} from "@/lib/groups/apiShared";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  assertGroupPassengerDepartureCanChange,
  GroupFinanceRequestError,
  isGroupFinanceRequestError,
  lockGroupPassenger,
} from "@/lib/groups/groupFinanceMutationGuards";

type BulkUpdateBody = {
  passengerIds?: unknown;
  status?: unknown;
  departureId?: unknown;
  clearDeparture?: unknown;
  note?: unknown;
  metadata?: unknown;
};

function pickParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function normalizePassengerStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
  if (!s) return null;
  if (["PENDIENTE", "CONFIRMADO", "LISTA_ESPERA", "CANCELADO", "CANCELADA"].includes(s)) {
    return s === "CANCELADA" ? "CANCELADO" : s;
  }
  return null;
}

const NON_CONFIRMED_PASSENGER_STATUSES = new Set([
  "LISTA_ESPERA",
  "CANCELADO",
  "CANCELADA",
]);

function isConfirmedPassengerStatus(value: unknown): boolean {
  const normalized =
    normalizePassengerStatus(value) ??
    (typeof value === "string" ? value.trim().toUpperCase() : "");
  if (!normalized) return false;
  return !NON_CONFIRMED_PASSENGER_STATUSES.has(normalized);
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
      solution: "Usá una solicitud POST para actualizar pasajeros.",
    });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  if (!canWriteGroups(auth.role)) {
    return groupApiError(res, 403, "No tenés permisos para editar pasajeros.", {
      code: "GROUP_PASSENGER_UPDATE_FORBIDDEN",
      solution: "Solicitá permisos de edición de grupales a un administrador.",
    });
  }

  const rawGroupId = pickParam(req.query.id);
  if (!rawGroupId) {
    return groupApiError(res, 400, "El identificador de la grupal es inválido.", {
      code: "GROUP_ID_INVALID",
      solution: "Volvé al listado de grupales y abrila nuevamente.",
    });
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
    select: {
      id_travel_group: true,
      name: true,
      status: true,
      start_date: true,
      end_date: true,
      capacity_total: true,
      allow_overbooking: true,
      overbooking_limit: true,
    },
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
      "No se pueden editar pasajeros en grupales cerradas o canceladas.",
      {
        code: "GROUP_LOCKED",
        solution: "Cambiá el estado de la grupal antes de editar pasajeros.",
      },
    );
  }

  const body = (req.body ?? {}) as BulkUpdateBody;
  const passengerIds = toDistinctPositiveInts(body.passengerIds);
  if (passengerIds.length === 0) {
    return groupApiError(res, 400, "No se enviaron pasajeros válidos.", {
      code: "GROUP_PASSENGER_IDS_INVALID",
      solution: "Seleccioná al menos un pasajero y volvé a intentar.",
    });
  }

  const passengers = await prisma.travelGroupPassenger.findMany({
    where: {
      id_agency: auth.id_agency,
      travel_group_id: group.id_travel_group,
      id_travel_group_passenger: { in: passengerIds },
    },
    select: {
      id_travel_group_passenger: true,
      booking_id: true,
      client_id: true,
      status: true,
      travel_group_departure_id: true,
      metadata: true,
    },
    orderBy: { id_travel_group_passenger: "asc" },
  });
  if (passengers.length !== passengerIds.length) {
    return groupApiError(
      res,
      404,
      "Alguno de los pasajeros seleccionados no pertenece a la grupal.",
      {
        code: "GROUP_PASSENGER_NOT_FOUND",
        solution: "Refrescá la lista y volvé a seleccionar los pasajeros.",
      },
    );
  }

  const nextStatus =
    body.status !== undefined ? normalizePassengerStatus(body.status) : null;
  if (body.status !== undefined && !nextStatus) {
    return groupApiError(res, 400, "El estado de pasajero no es válido.", {
      code: "GROUP_PASSENGER_STATUS_INVALID",
      solution: "Usá uno de estos estados: Pendiente, Confirmado, Lista de espera o Cancelado.",
    });
  }

  const clearDeparture = body.clearDeparture === true;
  let departure:
    | {
        id_travel_group_departure: number;
        departure_date: Date;
        return_date: Date | null;
      }
    | null
    | undefined = undefined;

  if (body.departureId !== undefined && body.departureId !== null && body.departureId !== "") {
    const departureWhere = parseDepartureWhereInput(
      String(body.departureId),
      auth.id_agency,
    );
    if (!departureWhere) {
      return groupApiError(res, 404, "La salida indicada es inválida.", {
        code: "DEPARTURE_INVALID",
        solution: "Seleccioná una salida válida de esta grupal.",
      });
    }
    departure = await prisma.travelGroupDeparture.findFirst({
      where: {
        AND: [
          departureWhere,
          {
            id_agency: auth.id_agency,
            travel_group_id: group.id_travel_group,
          },
        ],
      },
      select: {
        id_travel_group_departure: true,
        name: true,
        departure_date: true,
        return_date: true,
        capacity_total: true,
        allow_overbooking: true,
        overbooking_limit: true,
      },
    });
    if (!departure) {
      return groupApiError(
        res,
        404,
        "No encontramos esa salida dentro de la grupal.",
        {
          code: "DEPARTURE_NOT_FOUND",
          solution: "Refrescá la pantalla y elegí una salida existente.",
        },
      );
    }
  } else if (clearDeparture) {
    departure = null;
  }

  const notePatch = parseOptionalStringPatch(body.note, 1000);
  if (!notePatch.valid) {
    return groupApiError(res, 400, "La nota enviada es inválida.", {
      code: "GROUP_PASSENGER_NOTE_INVALID",
      solution: "Ingresá una nota de hasta 1000 caracteres o dejala vacía.",
    });
  }
  const note = notePatch.value;
  const metadataInput =
    body.metadata !== undefined ? toJsonInput(body.metadata) : undefined;
  if (metadataInput === undefined && body.metadata !== undefined) {
    return groupApiError(res, 400, "Los datos adicionales son inválidos.", {
      code: "GROUP_PASSENGER_METADATA_INVALID",
      solution: "Enviá un objeto JSON válido en metadata.",
    });
  }

  const projectedByScope = new Map<
    string,
    { departureId: number | null; addCount: number }
  >();
  for (const passenger of passengers) {
    const targetStatus = nextStatus ?? passenger.status;
    if (!isConfirmedPassengerStatus(targetStatus)) continue;

    const targetDepartureId =
      departure !== undefined
        ? departure?.id_travel_group_departure ?? null
        : passenger.travel_group_departure_id ?? null;
    const scopeKey = targetDepartureId == null ? "group" : `departure:${targetDepartureId}`;
    const current = projectedByScope.get(scopeKey);
    if (current) {
      current.addCount += 1;
    } else {
      projectedByScope.set(scopeKey, {
        departureId: targetDepartureId,
        addCount: 1,
      });
    }
  }

  if (projectedByScope.size > 0) {
    const departureIds = Array.from(
      new Set(
        Array.from(projectedByScope.values())
          .map((item) => item.departureId)
          .filter((id): id is number => typeof id === "number"),
      ),
    );

    const departureConfigs =
      departureIds.length > 0
        ? await prisma.travelGroupDeparture.findMany({
            where: {
              id_agency: auth.id_agency,
              travel_group_id: group.id_travel_group,
              id_travel_group_departure: { in: departureIds },
            },
            select: {
              id_travel_group_departure: true,
              name: true,
              capacity_total: true,
              allow_overbooking: true,
              overbooking_limit: true,
            },
          })
        : [];

    if (departureConfigs.length !== departureIds.length) {
      return groupApiError(
        res,
        404,
        "No se pudo validar capacidad porque alguna salida ya no existe.",
        {
          code: "DEPARTURE_NOT_FOUND",
          solution: "Refrescá la pantalla y volvé a intentar.",
        },
      );
    }

    const departureById = new Map(
      departureConfigs.map((item) => [item.id_travel_group_departure, item]),
    );

    const scopeChecks = await Promise.all(
      Array.from(projectedByScope.entries()).map(async ([scopeKey, scope]) => {
        const baseCount = await prisma.travelGroupPassenger.count({
          where: {
            id_agency: auth.id_agency,
            travel_group_id: group.id_travel_group,
            id_travel_group_passenger: { notIn: passengerIds },
            status: { notIn: ["LISTA_ESPERA", "CANCELADO", "CANCELADA"] },
            ...(scope.departureId == null
              ? {}
              : { travel_group_departure_id: scope.departureId }),
          },
        });

        return { scopeKey, scope, baseCount };
      }),
    );

    for (const check of scopeChecks) {
      const dep = check.scope.departureId
        ? departureById.get(check.scope.departureId)
        : null;

      const capacityBase = dep?.capacity_total ?? group.capacity_total;
      const allowOverbooking = dep?.allow_overbooking ?? group.allow_overbooking;
      const overbookingLimit = dep?.overbooking_limit ?? group.overbooking_limit ?? 0;
      const maxSellable =
        capacityBase == null
          ? Number.POSITIVE_INFINITY
          : capacityBase + (allowOverbooking ? overbookingLimit : 0);
      const projectedConfirmed = check.baseCount + check.scope.addCount;

      if (projectedConfirmed > maxSellable) {
        const scopeLabel = dep ? `salida ${dep.name}` : "grupal (sin salida)";
        return groupApiError(
          res,
          409,
          `Sin capacidad para ${scopeLabel}. Confirmados proyectados: ${projectedConfirmed}, máximo permitido: ${maxSellable}.`,
          {
            code: "GROUP_CAPACITY_EXCEEDED",
            solution:
              "Reducí la cantidad de pasajeros seleccionados o habilitá más cupo/sobreventa.",
          },
        );
      }
    }
  }

  try {
    const waitlistBase =
      nextStatus === "LISTA_ESPERA"
        ? await prisma.travelGroupPassenger.aggregate({
            where: {
              id_agency: auth.id_agency,
              travel_group_id: group.id_travel_group,
              status: "LISTA_ESPERA",
              id_travel_group_passenger: { notIn: passengerIds },
            },
            _max: { waitlist_position: true },
          })
        : { _max: { waitlist_position: null as number | null } };

    let waitlistPos = (waitlistBase._max.waitlist_position ?? 0) + 1;

    const updatedAtIso = new Date().toISOString();

    await prisma.$transaction(async (tx) => {
      for (const passenger of passengers) {
        await lockGroupPassenger(tx, {
          agencyId: auth.id_agency,
          groupId: group.id_travel_group,
          passengerId: passenger.id_travel_group_passenger,
        });
      }
      const lockedPassengers = await tx.travelGroupPassenger.findMany({
        where: {
          id_agency: auth.id_agency,
          travel_group_id: group.id_travel_group,
          id_travel_group_passenger: { in: passengerIds },
        },
        select: {
          id_travel_group_passenger: true,
          status: true,
          travel_group_departure_id: true,
          metadata: true,
        },
      });
      const lockedPassengerById = new Map(
        lockedPassengers.map((passenger) => [
          passenger.id_travel_group_passenger,
          passenger,
        ]),
      );

      for (const originalPassenger of passengers) {
        const passenger = lockedPassengerById.get(
          originalPassenger.id_travel_group_passenger,
        );
        if (!passenger) {
          throw new GroupFinanceRequestError({
            status: 409,
            code: "GROUP_FINANCE_PASSENGER_CHANGED",
            message: "Algún pasajero cambió mientras se procesaba la operación.",
            solution: "Refrescá la grupal y volvé a intentarlo.",
          });
        }
        const data: Prisma.TravelGroupPassengerUncheckedUpdateInput = {};
        const targetDepartureId =
          departure !== undefined
            ? departure?.id_travel_group_departure ?? null
            : passenger.travel_group_departure_id ?? null;

        if (
          departure !== undefined &&
          targetDepartureId !== passenger.travel_group_departure_id
        ) {
          await assertGroupPassengerDepartureCanChange(tx, {
            agencyId: auth.id_agency,
            groupId: group.id_travel_group,
            passengerId: passenger.id_travel_group_passenger,
          });
        }

        if (nextStatus) {
          data.status = nextStatus;
          if (nextStatus === "LISTA_ESPERA") {
            data.waitlist_position = waitlistPos;
            waitlistPos += 1;
          } else {
            data.waitlist_position = null;
          }
        }

        if (departure !== undefined) {
          data.travel_group_departure_id = targetDepartureId;
        }

        if (note !== undefined || metadataInput !== undefined) {
          const merged =
            passenger.metadata &&
            typeof passenger.metadata === "object" &&
            !Array.isArray(passenger.metadata)
              ? ({
                  ...(passenger.metadata as Prisma.JsonObject),
                } as Record<string, Prisma.InputJsonValue>)
              : ({} as Record<string, Prisma.InputJsonValue>);

          merged.updated_by = auth.id_user;
          merged.updated_at = updatedAtIso;

          if (note !== undefined) {
            if (note === null) {
              delete merged.note;
            } else {
              merged.note = note;
            }
          }

          if (metadataInput !== undefined) {
            if (metadataInput === null) {
              delete merged.payload;
            } else {
              const currentPayload =
                merged.payload &&
                typeof merged.payload === "object" &&
                !Array.isArray(merged.payload)
                  ? (merged.payload as Record<string, unknown>)
                  : null;
              const nextPayload =
                metadataInput &&
                typeof metadataInput === "object" &&
                !Array.isArray(metadataInput)
                  ? (metadataInput as Record<string, unknown>)
                  : null;
              merged.payload =
                currentPayload && nextPayload
                  ? ({
                      ...currentPayload,
                      ...nextPayload,
                    } as Prisma.InputJsonObject)
                  : metadataInput;
            }
          }

          data.metadata = merged as Prisma.InputJsonObject;
        }
        await tx.travelGroupPassenger.update({
          where: {
            id_travel_group_passenger: passenger.id_travel_group_passenger,
          },
          data,
        });
      }
    });

    return res.status(200).json({
      ok: true,
      updated_count: passengers.length,
      applied: {
        status: nextStatus ?? null,
        departure_id:
          departure === undefined
            ? undefined
            : departure?.id_travel_group_departure ?? null,
        note: notePatch.provided ? note ?? null : undefined,
      },
    });
  } catch (error) {
    if (isGroupFinanceRequestError(error)) {
      return groupApiError(res, error.status, error.message, {
        code: error.code,
        solution: error.solution,
      });
    }
    console.error("[groups][passengers][bulk-update]", error);
    return groupApiError(res, 500, "No pudimos actualizar los pasajeros.", {
      code: "GROUP_PASSENGER_UPDATE_ERROR",
      solution: "Reintentá en unos segundos.",
    });
  }
}
