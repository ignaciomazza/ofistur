import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { renderToStream } from "@react-pdf/renderer";
import OperatorPaymentDocument, {
  type OperatorPaymentPdfData,
} from "@/services/investments/OperatorPaymentDocument";
import { formatDateOnlyInBuenosAires } from "@/lib/buenosAiresDate";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  parseOptionalPositiveInt,
  requireGroupFinanceContext,
} from "@/lib/groups/financeShared";
import { decodeInventoryServiceId } from "@/lib/groups/inventoryServiceRefs";

type GroupOperatorPaymentPdfRow = {
  id_travel_group_operator_payment: number;
  agency_travel_group_operator_payment_id: number | null;
  id_agency: number;
  travel_group_id: number;
  travel_group_passenger_id: number | null;
  operator_id: number | null;
  category: string;
  description: string;
  amount: Prisma.Decimal | number | string;
  currency: string;
  paid_at: Date | null;
  payment_method: string | null;
  account: string | null;
  base_amount: Prisma.Decimal | number | string | null;
  base_currency: string | null;
  counter_amount: Prisma.Decimal | number | string | null;
  counter_currency: string | null;
  service_refs: number[] | null;
  created_by: number | null;
  created_at: Date;
  booking_id: number | null;
  booking_agency_id: number | null;
  operator_name: string | null;
  created_by_first_name: string | null;
  created_by_last_name: string | null;
};

type AgencyExtras = {
  id_agency: number;
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  address?: string | null;
  logo_url?: string | null;
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return 0;
};

const normalizeCurrency = (value: unknown): string => {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!code) return "ARS";
  if (["US$", "U$S", "U$D", "DOL"].includes(code)) return "USD";
  if (["$", "AR$"].includes(code)) return "ARS";
  return code;
};

async function fetchLogoFromUrl(
  url?: string | null,
): Promise<{ base64: string; mime: string } | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    let mime = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!mime) {
      const normalized = url.toLowerCase();
      if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
        mime = "image/jpeg";
      } else if (normalized.endsWith(".webp")) {
        mime = "image/webp";
      } else {
        mime = "image/png";
      }
    }
    return { base64: buffer.toString("base64"), mime };
  } catch {
    return null;
  }
}

const safeFilename = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]+/g, "_");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const ctx = await requireGroupFinanceContext(req, res);
  if (!ctx) return;

  const paymentId = parseOptionalPositiveInt(
    Array.isArray(req.query.paymentId)
      ? req.query.paymentId[0]
      : req.query.paymentId,
  );

  if (!paymentId) {
    return groupApiError(
      res,
      400,
      "El identificador del pago es inválido.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_ID_INVALID",
      },
    );
  }

  const [payment] = await prisma.$queryRaw<GroupOperatorPaymentPdfRow[]>(
    Prisma.sql`
      SELECT
        p."id_travel_group_operator_payment",
        p."agency_travel_group_operator_payment_id",
        p."id_agency",
        p."travel_group_id",
        p."travel_group_passenger_id",
        p."operator_id",
        p."category",
        p."description",
        p."amount",
        p."currency",
        p."paid_at",
        p."payment_method",
        p."account",
        p."base_amount",
        p."base_currency",
        p."counter_amount",
        p."counter_currency",
        p."service_refs",
        p."created_by",
        p."created_at",
        tp."booking_id",
        b."agency_booking_id" AS "booking_agency_id",
        op."name" AS "operator_name",
        u."first_name" AS "created_by_first_name",
        u."last_name" AS "created_by_last_name"
      FROM "TravelGroupOperatorPayment" p
      LEFT JOIN "TravelGroupPassenger" tp
        ON tp."id_travel_group_passenger" = p."travel_group_passenger_id"
      LEFT JOIN "Booking" b
        ON b."id_booking" = tp."booking_id"
      LEFT JOIN "Operator" op
        ON op."id_operator" = p."operator_id"
      LEFT JOIN "User" u
        ON u."id_user" = p."created_by"
      WHERE p."id_travel_group_operator_payment" = ${paymentId}
        AND p."id_agency" = ${ctx.auth.id_agency}
        AND p."travel_group_id" = ${ctx.group.id_travel_group}
      LIMIT 1
    `,
  );

  if (!payment) {
    return groupApiError(
      res,
      404,
      "No encontramos ese pago de operador de la grupal.",
      {
        code: "GROUP_FINANCE_OPERATOR_PAYMENT_NOT_FOUND",
      },
    );
  }

  const agency = (await prisma.agency.findUnique({
    where: { id_agency: payment.id_agency },
    select: {
      id_agency: true,
      name: true,
      legal_name: true,
      tax_id: true,
      address: true,
      logo_url: true,
    },
  })) as AgencyExtras | null;

  let logoBase64: string | undefined;
  let logoMime: string | undefined;

  const fetchedLogo = await fetchLogoFromUrl(agency?.logo_url);
  if (fetchedLogo) {
    logoBase64 = fetchedLogo.base64;
    logoMime = fetchedLogo.mime;
  }

  if (!logoBase64) {
    const preferredFiles: string[] = [];
    if (agency?.id_agency) {
      preferredFiles.push(`logo_ag_${agency.id_agency}.png`);
    }

    for (const file of preferredFiles) {
      const candidate = path.join(process.cwd(), "public", "agencies", file);
      if (!fs.existsSync(candidate)) continue;
      logoBase64 = fs.readFileSync(candidate).toString("base64");
      logoMime =
        candidate.toLowerCase().endsWith(".jpg") ||
        candidate.toLowerCase().endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png";
      break;
    }

    if (!logoBase64) {
      const fallback = path.join(process.cwd(), "public", "logo.png");
      if (fs.existsSync(fallback)) {
        logoBase64 = fs.readFileSync(fallback).toString("base64");
        logoMime = "image/png";
      }
    }
  }

  const serviceRefs = Array.isArray(payment.service_refs)
    ? payment.service_refs
    : [];

  const regularServiceIds: number[] = [];
  const inventoryByEncoded = new Map<number, number>();

  for (const rawRef of serviceRefs) {
    const ref = Number(rawRef);
    if (!Number.isFinite(ref) || ref <= 0) continue;
    const inventoryId = decodeInventoryServiceId(ref);
    if (inventoryId) {
      inventoryByEncoded.set(ref, inventoryId);
    } else {
      regularServiceIds.push(Math.trunc(ref));
    }
  }

  const inventoryIds = Array.from(new Set(inventoryByEncoded.values()));

  const [regularServices, inventoryServices] = await Promise.all([
    regularServiceIds.length > 0
      ? prisma.service.findMany({
          where: {
            id_agency: ctx.auth.id_agency,
            id_service: { in: regularServiceIds },
          },
          select: {
            id_service: true,
            agency_service_id: true,
            booking_id: true,
            type: true,
            destination: true,
            cost_price: true,
            currency: true,
            departure_date: true,
            booking: { select: { agency_booking_id: true } },
          },
        })
      : Promise.resolve([]),
    inventoryIds.length > 0
      ? prisma.travelGroupInventory.findMany({
          where: {
            id_agency: ctx.auth.id_agency,
            travel_group_id: ctx.group.id_travel_group,
            id_travel_group_inventory: { in: inventoryIds },
          },
          select: {
            id_travel_group_inventory: true,
            agency_travel_group_inventory_id: true,
            label: true,
            service_type: true,
            unit_cost: true,
            currency: true,
            travelGroupDeparture: {
              select: {
                name: true,
                departure_date: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const regularById = new Map(regularServices.map((service) => [service.id_service, service]));
  const inventoryById = new Map(
    inventoryServices.map((inventory) => [inventory.id_travel_group_inventory, inventory]),
  );

  const bookingNumbers = new Set<string>();

  const servicesForPdf = serviceRefs
    .map((rawRef) => {
      const ref = Number(rawRef);
      if (!Number.isFinite(ref) || ref <= 0) return null;
      const inventoryId = decodeInventoryServiceId(ref);

      if (inventoryId) {
        const inventory = inventoryById.get(inventoryId);
        if (!inventory) return null;
        const bookingNumber =
          payment.booking_agency_id ?? payment.booking_id ?? null;
        if (bookingNumber && bookingNumber > 0) {
          bookingNumbers.add(String(bookingNumber));
        }
        return {
          id: ref,
          serviceNumber:
            inventory.agency_travel_group_inventory_id ??
            inventory.id_travel_group_inventory,
          bookingNumber: bookingNumber ?? undefined,
          type: inventory.service_type || "GRUPAL",
          destination: inventory.travelGroupDeparture?.name || "Salida grupal",
          cost:
            inventory.unit_cost == null ? null : toNumber(inventory.unit_cost),
          currency: normalizeCurrency(inventory.currency || payment.currency),
          dateLabel: inventory.travelGroupDeparture?.departure_date
            ? formatDateOnlyInBuenosAires(
                inventory.travelGroupDeparture.departure_date,
              )
            : null,
          description:
            inventory.label ||
            `Servicio grupal ${inventory.agency_travel_group_inventory_id ?? inventory.id_travel_group_inventory}`,
        };
      }

      const service = regularById.get(ref);
      if (!service) return null;
      const bookingNumber =
        service.booking?.agency_booking_id ?? service.booking_id ?? null;
      if (bookingNumber && bookingNumber > 0) {
        bookingNumbers.add(String(bookingNumber));
      }
      return {
        id: service.id_service,
        serviceNumber: service.agency_service_id ?? service.id_service,
        bookingNumber: bookingNumber ?? undefined,
        type: service.type,
        destination: service.destination,
        cost:
          service.cost_price == null ? null : toNumber(service.cost_price),
        currency: normalizeCurrency(service.currency || payment.currency),
        dateLabel: service.departure_date
          ? formatDateOnlyInBuenosAires(service.departure_date)
          : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (bookingNumbers.size === 0) {
    const fallbackBookingNumber = payment.booking_agency_id ?? payment.booking_id;
    if (fallbackBookingNumber && fallbackBookingNumber > 0) {
      bookingNumbers.add(String(fallbackBookingNumber));
    }
  }

  const paymentNumber =
    payment.agency_travel_group_operator_payment_id != null
      ? String(payment.agency_travel_group_operator_payment_id)
      : String(payment.id_travel_group_operator_payment);

  const createdByName = [
    payment.created_by_first_name || "",
    payment.created_by_last_name || "",
  ]
    .join(" ")
    .trim();

  const recipientName =
    String(payment.operator_name || "").trim() ||
    createdByName ||
    "Operador";

  const data: OperatorPaymentPdfData = {
    paymentNumber,
    issueDate: payment.paid_at ?? payment.created_at ?? new Date(),
    paidDate: payment.paid_at ?? null,
    category: payment.category,
    description: payment.description,
    amount: toNumber(payment.amount),
    currency: normalizeCurrency(payment.currency),
    paymentMethod: payment.payment_method ?? null,
    account: payment.account ?? null,
    base_amount:
      payment.base_amount == null ? null : toNumber(payment.base_amount),
    base_currency: payment.base_currency,
    counter_amount:
      payment.counter_amount == null ? null : toNumber(payment.counter_amount),
    counter_currency: payment.counter_currency,
    recipient: {
      id: payment.operator_id ?? payment.created_by ?? null,
      label: payment.operator_name ? "Operador" : createdByName ? "Usuario" : null,
      name: recipientName,
    },
    bookingNumbers: Array.from(bookingNumbers),
    services: servicesForPdf,
    agency: {
      name: agency?.name ?? "Agencia",
      legalName: agency?.legal_name ?? agency?.name ?? "-",
      taxId: agency?.tax_id ?? "-",
      address: agency?.address ?? "-",
      logoBase64,
      logoMime,
    },
  };

  const stream = await renderToStream(<OperatorPaymentDocument {...data} />);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=comprobante_pago_grupal_${safeFilename(paymentNumber)}.pdf`,
  );

  stream.pipe(res);
}
