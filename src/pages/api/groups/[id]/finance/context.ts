import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  normalizeCurrencyCode,
  parseOptionalPositiveInt,
  parseScopeFilter,
  requireGroupFinanceContext,
} from "@/lib/groups/financeShared";
import {
  buildSyntheticContextBookingId,
  isSyntheticContextBookingId,
  mapInventoryToServiceLike,
} from "@/lib/groups/inventoryServiceRefs";

function pickQueryValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

type ContextClientRow = {
  id_client: number;
  agency_client_id: number | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  dni_number: string | null;
  passport_number: string | null;
  company_name: string | null;
  tax_id: string | null;
  address: string | null;
  locality: string | null;
  postal_code: string | null;
  commercial_address: string | null;
  birth_date: Date | null;
  nationality: string | null;
  gender: string | null;
  id_agency: number;
  id_user: number;
  registration_date: Date;
};

type ContextPassengerRow = {
  id_travel_group_passenger: number;
  booking_id: number | null;
  travel_group_departure_id: number | null;
  client_id: number | null;
  client: ContextClientRow | null;
};

function mapClientForContext(client: ContextClientRow | null): Record<string, unknown> | null {
  if (!client) return null;
  return {
    id_client: client.id_client,
    agency_client_id: client.agency_client_id ?? null,
    first_name: client.first_name || "",
    last_name: client.last_name || "",
    phone: client.phone || "",
    email: client.email || "",
    dni_number: client.dni_number || "",
    passport_number: client.passport_number || "",
    company_name: client.company_name || "",
    tax_id: client.tax_id || "",
    address: client.address || "",
    locality: client.locality || "",
    postal_code: client.postal_code || "",
    commercial_address: client.commercial_address || "",
    birth_date: toIso(client.birth_date),
    nationality: client.nationality || "",
    gender: client.gender || "",
    registration_date: toIso(client.registration_date),
    id_user: client.id_user,
    id_agency: client.id_agency,
  };
}

function createFallbackClient(args: {
  agencyId: number;
  userId: number;
  clientId?: number | null;
}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id_client: args.clientId && args.clientId > 0 ? args.clientId : 0,
    agency_client_id: null,
    first_name: "Pasajero",
    last_name: "Grupal",
    phone: "",
    email: "",
    dni_number: "",
    passport_number: "",
    company_name: "",
    tax_id: "",
    address: "",
    locality: "",
    postal_code: "",
    commercial_address: "",
    birth_date: now,
    nationality: "",
    gender: "",
    registration_date: now,
    id_user: args.userId,
    id_agency: args.agencyId,
  };
}

async function findBookingIdsForScope(args: {
  agencyId: number;
  groupId: number;
  departureId: number | null | undefined;
}): Promise<number[]> {
  const rows = await prisma.travelGroupPassenger.findMany({
    where: {
      id_agency: args.agencyId,
      travel_group_id: args.groupId,
      booking_id: { not: null },
      ...(args.departureId === null
        ? { travel_group_departure_id: null }
        : typeof args.departureId === "number"
          ? { travel_group_departure_id: args.departureId }
          : {}),
    },
    select: {
      booking_id: true,
    },
  });

  return Array.from(
    new Set(
      rows
        .map((row) => Number(row.booking_id || 0))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ).sort((a, b) => a - b);
}

function makeSyntheticBooking(args: {
  contextId: number;
  agencyId: number;
  groupName: string;
  departureDate: Date | string | null | undefined;
  returnDate: Date | string | null | undefined;
  clients: Array<Record<string, unknown>>;
  titular: Record<string, unknown>;
  services: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const now = new Date().toISOString();
  const agency = {
    id_agency: args.agencyId,
    name: "Agencia",
    legal_name: "Agencia",
    phones: [],
    tax_id: "",
    creation_date: now,
  };
  const user = {
    id_user: 0,
    email: "",
    first_name: "Sistema",
    last_name: "Grupal",
    position: "",
    role: "sistema",
    id_agency: args.agencyId,
    agency,
  };

  return {
    id_context: args.contextId,
    id_booking: args.contextId,
    agency_context_id: null,
    agency_booking_id: null,
    public_id: null,
    clientStatus: "GRUPAL",
    operatorStatus: "GRUPAL",
    status: "GRUPAL",
    details: `Contexto financiero de ${args.groupName}`,
    invoice_type: "Coordinar con administracion",
    observation: "Contexto interno de grupal/salida.",
    invoice_observation: null,
    titular: args.titular,
    user,
    agency,
    departure_date: toIso(args.departureDate),
    return_date: toIso(args.returnDate ?? args.departureDate),
    pax_count: Math.max(1, args.clients.length),
    clients: args.clients,
    simple_companions: [],
    services: args.services,
    creation_date: now,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const ctx = await requireGroupFinanceContext(req, res);
  if (!ctx) return;

  const rawContextId = pickQueryValue(req.query.contextId);
  const rawBookingId = pickQueryValue(req.query.bookingId);
  const rawPassengerId = pickQueryValue(req.query.passengerId);
  const rawScope = pickQueryValue(req.query.scope);

  const rawContextRef = rawContextId ?? rawBookingId;
  const contextId = parseOptionalPositiveInt(rawContextRef);
  const passengerId = parseOptionalPositiveInt(rawPassengerId);
  const scope = parseScopeFilter(rawScope);
  const syntheticContextRequested =
    typeof contextId === "number" && isSyntheticContextBookingId(contextId);

  if (rawContextRef && !contextId) {
    return groupApiError(res, 400, "El identificador de contexto financiero es inválido.", {
      code: "GROUP_FINANCE_CONTEXT_BOOKING_ID_INVALID",
    });
  }
  if (rawPassengerId && !passengerId) {
    return groupApiError(res, 400, "El identificador del pasajero es inválido.", {
      code: "GROUP_FINANCE_CONTEXT_PASSENGER_ID_INVALID",
    });
  }
  if (rawScope && !scope) {
    return groupApiError(res, 400, "El scope financiero es inválido.", {
      code: "GROUP_FINANCE_SCOPE_INVALID",
      solution: "Usá `group` o `departure:{id}`.",
    });
  }

  let passenger: ContextPassengerRow | null = null;
  if (passengerId) {
    passenger = await prisma.travelGroupPassenger.findFirst({
      where: {
        id_agency: ctx.auth.id_agency,
        travel_group_id: ctx.group.id_travel_group,
        id_travel_group_passenger: passengerId,
      },
      select: {
        id_travel_group_passenger: true,
        booking_id: true,
        travel_group_departure_id: true,
        client_id: true,
        client: {
          select: {
            id_client: true,
            agency_client_id: true,
            first_name: true,
            last_name: true,
            phone: true,
            email: true,
            dni_number: true,
            passport_number: true,
            company_name: true,
            tax_id: true,
            address: true,
            locality: true,
            postal_code: true,
            commercial_address: true,
            birth_date: true,
            nationality: true,
            gender: true,
            id_agency: true,
            id_user: true,
            registration_date: true,
          },
        },
      },
    });
    if (!passenger) {
      return groupApiError(res, 404, "No encontramos ese pasajero en la grupal.", {
        code: "GROUP_FINANCE_CONTEXT_PASSENGER_NOT_FOUND",
      });
    }
  }

  let departureScope: number | null | undefined = scope?.departureId;
  if (departureScope === undefined && passenger) {
    departureScope = passenger.travel_group_departure_id ?? null;
  }

  let bookingIds: number[] = [];
  if (contextId && !isSyntheticContextBookingId(contextId)) {
    bookingIds = [contextId];
  } else if (syntheticContextRequested) {
    bookingIds = [];
  } else if (
    passenger &&
    typeof passenger.booking_id === "number" &&
    passenger.booking_id > 0
  ) {
    bookingIds = [passenger.booking_id];
  } else {
    bookingIds = await findBookingIdsForScope({
      agencyId: ctx.auth.id_agency,
      groupId: ctx.group.id_travel_group,
      departureId: departureScope,
    });
  }

  const booking = bookingIds.length
    ? await prisma.booking.findFirst({
        where: {
          id_booking: { in: bookingIds },
          id_agency: ctx.auth.id_agency,
          travel_group_id: ctx.group.id_travel_group,
        },
        orderBy: {
          id_booking: "asc",
        },
        include: {
          titular: true,
          user: true,
          agency: true,
          clients: true,
          simple_companions: { include: { category: true } },
          services: { include: { operator: true } },
          invoices: true,
          Receipt: true,
        },
      })
    : null;

  if (contextId && !isSyntheticContextBookingId(contextId) && !booking) {
    return groupApiError(res, 404, "No encontramos el contexto financiero solicitado.", {
      code: "GROUP_FINANCE_CONTEXT_BOOKING_NOT_FOUND",
    });
  }

  const scopePassengers = await prisma.travelGroupPassenger.findMany({
    where: {
      id_agency: ctx.auth.id_agency,
      travel_group_id: ctx.group.id_travel_group,
      ...(passengerId
        ? { id_travel_group_passenger: passengerId }
        : departureScope === null
          ? { travel_group_departure_id: null }
          : typeof departureScope === "number"
            ? { travel_group_departure_id: departureScope }
            : {}),
    },
    select: {
      client: {
        select: {
          id_client: true,
          agency_client_id: true,
          first_name: true,
          last_name: true,
          phone: true,
          email: true,
          dni_number: true,
          passport_number: true,
          company_name: true,
          tax_id: true,
          address: true,
          locality: true,
          postal_code: true,
          commercial_address: true,
          birth_date: true,
          nationality: true,
          gender: true,
          id_agency: true,
          id_user: true,
          registration_date: true,
        },
      },
    },
  });

  const uniqueClients = new Map<number, Record<string, unknown>>();
  for (const row of scopePassengers) {
    if (!row.client) continue;
    const mapped = mapClientForContext(row.client);
    if (!mapped) continue;
    uniqueClients.set(row.client.id_client, mapped);
  }

  const defaultClient = createFallbackClient({
    agencyId: ctx.auth.id_agency,
    userId: ctx.auth.id_user,
    clientId: passenger?.client_id,
  });
  const mappedPassengerClient = mapClientForContext(passenger?.client ?? null);
  const allClients = Array.from(uniqueClients.values());
  const titular =
    mappedPassengerClient ??
    allClients[0] ??
    (booking?.titular as unknown as Record<string, unknown>) ??
    defaultClient;
  const clientsForContext =
    allClients.length > 0
      ? allClients
      : booking?.clients && booking.clients.length > 0
        ? (booking.clients as unknown as Array<Record<string, unknown>>)
        : [titular];

  const inventories = await prisma.travelGroupInventory.findMany({
    where: {
      id_agency: ctx.auth.id_agency,
      travel_group_id: ctx.group.id_travel_group,
      ...(departureScope === null
        ? { travel_group_departure_id: null }
        : typeof departureScope === "number"
          ? {
              OR: [
                { travel_group_departure_id: null },
                { travel_group_departure_id: departureScope },
              ],
            }
          : {}),
    },
    include: {
      travelGroupDeparture: {
        select: {
          name: true,
          departure_date: true,
          return_date: true,
        },
      },
    },
    orderBy: [
      { travel_group_departure_id: "asc" },
      { id_travel_group_inventory: "asc" },
    ],
  });

  const syntheticBookingId = buildSyntheticContextBookingId({
    groupId: ctx.group.id_travel_group,
    departureId: departureScope,
    passengerId,
  });
  const resolvedContextId =
    booking?.id_booking ??
    (syntheticContextRequested && contextId ? contextId : syntheticBookingId);
  const fallbackCurrency = normalizeCurrencyCode(
    (booking as { currency?: string | null } | null)?.currency || "ARS",
  );
  const inventoryServices = inventories.map((row) =>
    mapInventoryToServiceLike(row, {
      bookingId: resolvedContextId,
      fallbackCurrency,
      fallbackDestination: ctx.group.name,
    }),
  );

  const bookingServices = Array.isArray(booking?.services)
    ? (booking.services as unknown as Array<Record<string, unknown>>)
    : [];
  const resolvedServices =
    bookingServices.length > 0 ? bookingServices : inventoryServices;

  const responseContext = booking
    ? {
        ...booking,
        id_context: booking.id_booking,
        agency_context_id: booking.agency_booking_id ?? null,
        services: resolvedServices,
      }
    : makeSyntheticBooking({
        contextId: resolvedContextId,
        agencyId: ctx.auth.id_agency,
        groupName: ctx.group.name,
        departureDate: inventories[0]?.travelGroupDeparture?.departure_date,
        returnDate: inventories[0]?.travelGroupDeparture?.return_date,
        clients: clientsForContext,
        titular,
        services: resolvedServices,
      });
  const responseContextId = Number(
    (responseContext as { id_context?: unknown; id_booking?: unknown })
      .id_context ??
      (responseContext as { id_context?: unknown; id_booking?: unknown })
        .id_booking ??
      0,
  );
  const contextIds =
    Number.isFinite(responseContextId) && responseContextId > 0
      ? [responseContextId]
      : [];

  return res.status(200).json({
    success: true,
    context: responseContext,
    booking: responseContext,
    scope: scope?.key ?? undefined,
    contextIds,
    bookingIds: contextIds,
    contextKind: booking ? "booking" : "group",
    serviceCount: resolvedServices.length,
  });
}
