import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { renderToStream } from "@react-pdf/renderer";
import ReceiptStandaloneDocument, {
  type ReceiptStandalonePdfData,
} from "@/services/receipts/ReceiptStandaloneDocument";
import { groupApiError } from "@/lib/groups/apiErrors";
import {
  parseOptionalPositiveInt,
  requireGroupFinanceContext,
} from "@/lib/groups/financeShared";
import { decodeInventoryServiceId } from "@/lib/groups/inventoryServiceRefs";

type GroupReceiptPdfRow = {
  id_travel_group_receipt: number;
  agency_travel_group_receipt_id: number | null;
  id_agency: number;
  travel_group_id: number;
  issue_date: Date;
  amount: Prisma.Decimal | number | string;
  amount_string: string;
  amount_currency: string;
  concept: string;
  currency: string;
  payment_method: string | null;
  payment_fee_amount: Prisma.Decimal | number | string | null;
  account: string | null;
  base_amount: Prisma.Decimal | number | string | null;
  base_currency: string | null;
  counter_amount: Prisma.Decimal | number | string | null;
  counter_currency: string | null;
  client_id: number;
  client_ids: number[] | null;
  service_refs: number[] | null;
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

  const receiptId = parseOptionalPositiveInt(
    Array.isArray(req.query.receiptId) ? req.query.receiptId[0] : req.query.receiptId,
  );

  if (!receiptId) {
    return groupApiError(res, 400, "El identificador del recibo es inválido.", {
      code: "GROUP_FINANCE_RECEIPT_ID_INVALID",
    });
  }

  const [receipt] = await prisma.$queryRaw<GroupReceiptPdfRow[]>(Prisma.sql`
    SELECT
      r."id_travel_group_receipt",
      r."agency_travel_group_receipt_id",
      r."id_agency",
      r."travel_group_id",
      r."issue_date",
      r."amount",
      r."amount_string",
      r."amount_currency",
      r."concept",
      r."currency",
      r."payment_method",
      r."payment_fee_amount",
      r."account",
      r."base_amount",
      r."base_currency",
      r."counter_amount",
      r."counter_currency",
      r."client_id",
      r."client_ids",
      r."service_refs"
    FROM "TravelGroupReceipt" r
    WHERE r."id_travel_group_receipt" = ${receiptId}
      AND r."id_agency" = ${ctx.auth.id_agency}
      AND r."travel_group_id" = ${ctx.group.id_travel_group}
    LIMIT 1
  `);

  if (!receipt) {
    return groupApiError(res, 404, "No encontramos ese recibo de grupal.", {
      code: "GROUP_FINANCE_RECEIPT_NOT_FOUND",
    });
  }

  const agency = (await prisma.agency.findUnique({
    where: { id_agency: receipt.id_agency },
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

  const serviceRefs = Array.isArray(receipt.service_refs)
    ? receipt.service_refs
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
            description: true,
            departure_date: true,
            return_date: true,
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
            travelGroupDeparture: {
              select: {
                departure_date: true,
                return_date: true,
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

  type PdfServiceLine = {
    id: number;
    description: string;
    departureDate: Date | null;
    returnDate: Date | null;
  };

  const servicesForPdf = serviceRefs
    .map((rawRef): PdfServiceLine | null => {
      const ref = Number(rawRef);
      if (!Number.isFinite(ref) || ref <= 0) return null;
      const inventoryId = decodeInventoryServiceId(ref);
      if (inventoryId) {
        const inventory = inventoryById.get(inventoryId);
        if (!inventory) return null;
        return {
          id: ref,
          description:
            inventory.label ||
            `Servicio grupal ${inventory.agency_travel_group_inventory_id ?? inventory.id_travel_group_inventory}`,
          departureDate: inventory.travelGroupDeparture?.departure_date ?? null,
          returnDate: inventory.travelGroupDeparture?.return_date ?? null,
        };
      }

      const service = regularById.get(ref);
      if (!service) return null;
      return {
        id: service.id_service,
        description:
          service.description ||
          `Servicio ${service.agency_service_id ?? service.id_service}`,
        departureDate: service.departure_date ?? null,
        returnDate: service.return_date ?? null,
      };
    })
    .filter((item): item is PdfServiceLine => item !== null);

  const clientIds =
    Array.isArray(receipt.client_ids) && receipt.client_ids.length > 0
      ? receipt.client_ids
      : receipt.client_id > 0
        ? [receipt.client_id]
        : [];

  const recipientsRaw = clientIds.length
    ? await prisma.client.findMany({
        where: {
          id_agency: ctx.auth.id_agency,
          id_client: { in: clientIds },
        },
        select: {
          first_name: true,
          last_name: true,
          dni_number: true,
          address: true,
          locality: true,
          company_name: true,
        },
      })
    : [];

  const recipients =
    recipientsRaw.length > 0
      ? recipientsRaw.map((client) => ({
          firstName: client.first_name || "",
          lastName: client.last_name || "",
          dni: client.dni_number ?? "-",
          address: client.address ?? "-",
          locality: client.locality ?? "-",
          companyName: client.company_name ?? undefined,
        }))
      : [
          {
            firstName: "Pasajero",
            lastName: "Grupal",
            dni: "-",
            address: "-",
            locality: "-",
            companyName: undefined,
          },
        ];

  const receiptNumberBase =
    receipt.agency_travel_group_receipt_id ?? receipt.id_travel_group_receipt;
  const receiptNumber = `GR-${String(receiptNumberBase).padStart(6, "0")}`;

  const data: ReceiptStandalonePdfData = {
    receiptNumber,
    issueDate: receipt.issue_date ?? new Date(),
    concept: receipt.concept,
    amount: toNumber(receipt.amount),
    amountString: receipt.amount_string,
    amountCurrency: normalizeCurrency(receipt.amount_currency),
    paymentDescription:
      receipt.currency ||
      receipt.payment_method ||
      normalizeCurrency(receipt.amount_currency),
    paymentFeeAmount:
      receipt.payment_fee_amount == null ? 0 : toNumber(receipt.payment_fee_amount),
    payments: [
      {
        amount: toNumber(receipt.amount),
        payment_method_id: null,
        account_id: null,
        payment_currency: normalizeCurrency(receipt.amount_currency),
        fee_mode: null,
        fee_value: null,
        fee_amount: null,
        paymentMethodName: receipt.payment_method || undefined,
        accountName: receipt.account || undefined,
      },
    ],
    services: servicesForPdf,
    base_amount:
      receipt.base_amount == null ? null : toNumber(receipt.base_amount),
    base_currency: receipt.base_currency,
    counter_amount:
      receipt.counter_amount == null ? null : toNumber(receipt.counter_amount),
    counter_currency: receipt.counter_currency,
    agency: {
      name: agency?.name ?? "-",
      legalName: agency?.legal_name ?? agency?.name ?? "-",
      taxId: agency?.tax_id ?? "-",
      address: agency?.address ?? "-",
      logoBase64,
      logoMime,
    },
    recipients,
  };

  const stream = await renderToStream(<ReceiptStandaloneDocument {...data} />);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=recibo_grupal_${safeFilename(receiptNumber)}.pdf`,
  );

  stream.pipe(res);
}
