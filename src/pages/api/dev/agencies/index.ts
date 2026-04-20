// src/pages/api/dev/agencies/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import {
  parseDateInputInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { hasSchemaColumn } from "@/lib/schemaColumns";

/* ========== Auth helpers ========== */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  email?: string;
};

type AppError = Error & { status?: number };

function httpError(status: number, message: string): AppError {
  const err = new Error(message) as AppError;
  err.status = status;
  return err;
}

function normalizeRole(r?: string) {
  return (r ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  // compat
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    const v = req.cookies?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function requireDeveloper(req: NextApiRequest): Promise<{
  id_user: number;
  email?: string;
}> {
  const token = getTokenFromRequest(req);
  if (!token) throw httpError(401, "No autenticado");

  const { payload } = await jwtVerify(
    token,
    new TextEncoder().encode(JWT_SECRET),
  );
  const p = payload as TokenPayload;
  const id_user = Number(p.id_user ?? p.userId ?? p.uid) || 0;
  const role = normalizeRole(p.role);

  if (!id_user || role !== "desarrollador") {
    throw httpError(403, "No autorizado");
  }
  return { id_user, email: p.email };
}

/* ========== Validaciones creación ========== */
// Helpers
function toLocalDate(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const parsed = parseDateInputInBuenosAires(v);
  return parsed ?? undefined;
}
function validateCUIT(cuitRaw: string): boolean {
  const cuit = (cuitRaw || "").replace(/\D/g, "");
  if (cuit.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digits = cuit.split("").map(Number);
  const dv = digits.pop()!;
  const sum = digits.reduce((acc, d, i) => acc + d * mult[i], 0);
  let mod = 11 - (sum % 11);
  if (mod === 11) mod = 0;
  if (mod === 10) mod = 9;
  return dv === mod;
}
const trimUndef = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length ? s : undefined));
const urlOptional = trimUndef.refine((v) => !v || /^https?:\/\//i.test(v), {
  message: "Debe incluir http:// o https://",
});
const emailOptional = trimUndef.refine(
  (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  { message: "Email inválido" },
);

const AgencyCreateSchema = z
  .object({
    name: z
      .string()
      .min(2)
      .transform((s) => s.trim()),
    legal_name: z
      .string()
      .min(2)
      .transform((s) => s.trim()),
    tax_id: z
      .string()
      .min(11)
      .transform((s) => s.trim())
      .refine((v) => validateCUIT(v), "CUIT inválido"),
    address: trimUndef.optional(),
    phone: trimUndef.optional(),
    email: emailOptional.optional(),
    website: urlOptional.optional(),
    foundation_date: z
      .union([z.string(), z.date(), z.undefined(), z.null()])
      .optional(),
    logo_url: urlOptional.optional(),
  })
  .strict();

type DebtState = "all" | "debtors" | "non_debtors";

const DEFAULT_FINANCE_CURRENCIES = [
  {
    code: "ARS",
    name: "Pesos argentinos",
    symbol: "$",
    is_primary: true,
  },
  {
    code: "USD",
    name: "Dólar estadounidense",
    symbol: "US$",
    is_primary: false,
  },
] as const;

const DEFAULT_FINANCE_PAYMENT_METHODS = [
  { name: "Efectivo", code: "cash", requires_account: false },
  { name: "Transferencia", code: "transfer", requires_account: true },
] as const;

const DEFAULT_SERVICE_TYPES = [
  "Aéreos cabotaje",
  "Aéreos regional",
  "Aéreos internacional",
  "Cupo exterior",
  "Paquete argentina",
  "Hotelería",
  "Hotelería y traslados",
  "Traslados",
  "Excursiones",
  "Tour",
  "Crucero",
  "Asistencia",
  "Alquiler de auto",
  "Asientos",
  "Visados",
] as const;

const DEFAULT_EXPENSE_CATEGORY = {
  name: "Operador - Inversión - Vincula operador",
  code: "operador-inversion-vincula-operador",
} as const;

function parseDebtState(input: unknown): DebtState {
  const raw = Array.isArray(input) ? input[0] : input;
  if (!raw) return "all";
  const normalized = String(raw).trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "debtors" ||
    normalized === "non_debtors"
  ) {
    return normalized;
  }
  throw httpError(
    400,
    'debt_state inválido. Valores permitidos: "all", "debtors", "non_debtors".',
  );
}

function matchesDebtState(status: string, debtState: DebtState): boolean {
  if (debtState === "all") return true;
  if (debtState === "debtors") return status === "OVERDUE";
  return status !== "OVERDUE";
}

function slugifyServiceTypeCode(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function seedAgencyDefaults(
  tx: Prisma.TransactionClient,
  id_agency: number,
  hasExpenseCategoryScope: boolean,
): Promise<void> {
  for (const [index, currency] of DEFAULT_FINANCE_CURRENCIES.entries()) {
    const agencyCurrencyId = await getNextAgencyCounter(
      tx,
      id_agency,
      "finance_currency",
    );
    await tx.financeCurrency.create({
      data: {
        agency_finance_currency_id: agencyCurrencyId,
        id_agency,
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        is_primary: currency.is_primary,
        enabled: true,
        sort_order: index + 1,
      },
    });
  }

  for (const [index, method] of DEFAULT_FINANCE_PAYMENT_METHODS.entries()) {
    const agencyMethodId = await getNextAgencyCounter(
      tx,
      id_agency,
      "finance_payment_method",
    );
    await tx.financePaymentMethod.create({
      data: {
        agency_finance_payment_method_id: agencyMethodId,
        id_agency,
        name: method.name,
        code: method.code,
        requires_account: method.requires_account,
        enabled: true,
        sort_order: index + 1,
      },
    });
  }

  for (const name of DEFAULT_SERVICE_TYPES) {
    const agencyServiceTypeId = await getNextAgencyCounter(
      tx,
      id_agency,
      "service_type",
    );
    await tx.serviceType.create({
      data: {
        agency_service_type_id: agencyServiceTypeId,
        id_agency,
        code: slugifyServiceTypeCode(name),
        name,
        enabled: true,
        allow_no_destination: false,
      },
    });
  }

  const agencyExpenseCategoryId = await getNextAgencyCounter(
    tx,
    id_agency,
    "expense_category",
  );
  const expenseCategoryData: Record<string, unknown> = {
    agency_expense_category_id: agencyExpenseCategoryId,
    id_agency,
    name: DEFAULT_EXPENSE_CATEGORY.name,
    code: DEFAULT_EXPENSE_CATEGORY.code,
    requires_operator: true,
    requires_user: false,
    enabled: true,
    sort_order: 1,
  };
  if (hasExpenseCategoryScope) {
    expenseCategoryData.scope = "INVESTMENT";
  }
  await tx.expenseCategory.create({
    data:
      expenseCategoryData as unknown as Prisma.ExpenseCategoryUncheckedCreateInput,
  });
}

/* ========== Serialización segura ========== */
function sanitizeAgency(a: {
  id_agency: number;
  name: string;
  legal_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string;
  website: string | null;
  foundation_date: Date | null;
  logo_url: string | null;
  creation_date: Date;
  billing_owner_agency_id: number | null;
  afip_cert_base64?: unknown | null;
  afip_key_base64?: unknown | null;
}) {
  const { afip_cert_base64, afip_key_base64, ...rest } = a;
  return {
    ...rest,
    afip: {
      certUploaded: Boolean(
        afip_cert_base64 && String(afip_cert_base64).length > 0,
      ),
      keyUploaded: Boolean(
        afip_key_base64 && String(afip_key_base64).length > 0,
      ),
    },
  };
}

function chargeSortDate(charge: {
  due_date?: Date | null;
  period_end?: Date | null;
  period_start?: Date | null;
  created_at?: Date | null;
}) {
  return (
    charge.period_end ??
    charge.due_date ??
    charge.period_start ??
    charge.created_at ??
    new Date(0)
  );
}

function getBillingStatus(
  charge: {
    status?: string | null;
    due_date?: Date | null;
    period_end?: Date | null;
  } | null,
) {
  if (!charge) return "NONE";

  const now = new Date();
  const status = String(charge.status || "").toUpperCase();
  const periodEnd = charge.period_end ?? charge.due_date ?? null;

  // Si el período del último cobro recurrente ya venció, consideramos deuda
  // aunque ese cobro esté marcado como "PAID".
  if (periodEnd && periodEnd < now) return "OVERDUE";

  if (["OVERDUE", "PAST_DUE", "FAILED"].includes(status)) return "OVERDUE";
  if (["PAID", "SETTLED"].includes(status)) return "PAID";
  return "PENDING";
}

/* ========== GET (lista con cursor “ver más”) ========== */
async function handleGET(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);

  const qRaw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const query = typeof qRaw === "string" ? qRaw.trim() : "";
  const debtState = parseDebtState(req.query.debt_state);
  const limitRaw = Array.isArray(req.query.limit)
    ? req.query.limit[0]
    : req.query.limit;
  const limitNum = Math.min(
    50,
    Math.max(5, Number.parseInt(String(limitRaw ?? "20"), 10) || 20),
  );
  const cursorRaw = Array.isArray(req.query.cursor)
    ? req.query.cursor[0]
    : req.query.cursor;
  const parsedCursor = cursorRaw ? Number.parseInt(String(cursorRaw), 10) : null;
  const cursorId =
    typeof parsedCursor === "number" && Number.isFinite(parsedCursor)
      ? parsedCursor
      : null;

  const baseWhere: Prisma.AgencyWhereInput =
    query.length > 0
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { legal_name: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query, mode: "insensitive" as const } },
            { tax_id: { contains: query } },
          ],
        }
      : {};
  const scanBatchSize = Math.max(50, limitNum * 3);
  let scanCursor = cursorId && cursorId > 0 ? cursorId : null;

  type OwnerChargeSnapshot = {
    id_agency: number;
    status: string | null;
    due_date: Date | null;
    period_start: Date | null;
    period_end: Date | null;
    created_at: Date | null;
    charge_kind: string | null;
  };

  type FilteredAgency = {
    agency: {
      id_agency: number;
      name: string;
      legal_name: string;
      address: string | null;
      phone: string | null;
      email: string | null;
      tax_id: string;
      website: string | null;
      foundation_date: Date | null;
      logo_url: string | null;
      creation_date: Date;
      billing_owner_agency_id: number | null;
      afip_cert_base64: unknown | null;
      afip_key_base64: unknown | null;
    };
    ownerId: number;
    ownerName: string;
    billingStatus: string;
    lastCharge: OwnerChargeSnapshot | null;
  };

  const ownerNameCache = new Map<number, string>();
  const lastChargeByOwnerCache = new Map<number, OwnerChargeSnapshot | null>();
  const filteredMatches: FilteredAgency[] = [];

  while (filteredMatches.length < limitNum + 1) {
    const where: Prisma.AgencyWhereInput =
      scanCursor && scanCursor > 0
        ? {
            AND: [baseWhere, { id_agency: { lt: scanCursor } }],
          }
        : baseWhere;

    const batch = await prisma.agency.findMany({
      where,
      orderBy: { id_agency: "desc" },
      take: scanBatchSize,
      select: {
        id_agency: true,
        name: true,
        legal_name: true,
        address: true,
        phone: true,
        email: true,
        tax_id: true,
        website: true,
        foundation_date: true,
        logo_url: true,
        creation_date: true,
        billing_owner_agency_id: true,
        afip_cert_base64: true,
        afip_key_base64: true,
      },
    });

    if (batch.length === 0) break;

    const ownerIds = Array.from(
      new Set(batch.map((agency) => agency.billing_owner_agency_id ?? agency.id_agency)),
    );
    const missingOwnerIds = ownerIds.filter(
      (ownerId) =>
        !ownerNameCache.has(ownerId) || !lastChargeByOwnerCache.has(ownerId),
    );

    if (missingOwnerIds.length > 0) {
      const [ownerAgencies, charges] = await Promise.all([
        prisma.agency.findMany({
          where: { id_agency: { in: missingOwnerIds } },
          select: { id_agency: true, name: true },
        }),
        prisma.agencyBillingCharge.findMany({
          where: { id_agency: { in: missingOwnerIds } },
          select: {
            id_agency: true,
            status: true,
            due_date: true,
            period_start: true,
            period_end: true,
            created_at: true,
            charge_kind: true,
          },
        }),
      ]);

      for (const owner of ownerAgencies) {
        ownerNameCache.set(owner.id_agency, owner.name);
      }

      const recurringCharges = charges.filter(
        (charge) =>
          String(charge.charge_kind || "RECURRING").toUpperCase() !== "EXTRA",
      );
      const lastChargeByOwner = recurringCharges.reduce<
        Record<number, OwnerChargeSnapshot>
      >((acc, charge) => {
        const current = acc[charge.id_agency];
        if (!current || chargeSortDate(charge) > chargeSortDate(current)) {
          acc[charge.id_agency] = charge;
        }
        return acc;
      }, {});

      for (const ownerId of missingOwnerIds) {
        lastChargeByOwnerCache.set(ownerId, lastChargeByOwner[ownerId] ?? null);
      }
    }

    for (const agency of batch) {
      const ownerId = agency.billing_owner_agency_id ?? agency.id_agency;
      const lastCharge = lastChargeByOwnerCache.get(ownerId) ?? null;
      const status = getBillingStatus(lastCharge);

      if (!matchesDebtState(status, debtState)) continue;

      filteredMatches.push({
        agency,
        ownerId,
        ownerName: ownerNameCache.get(ownerId) ?? agency.name,
        billingStatus: status,
        lastCharge,
      });

      if (filteredMatches.length >= limitNum + 1) break;
    }

    scanCursor = batch[batch.length - 1]?.id_agency ?? null;
    if (batch.length < scanBatchSize) break;
  }

  const pageItems = filteredMatches.slice(0, limitNum);
  const nextCursor =
    filteredMatches.length > limitNum
      ? pageItems[pageItems.length - 1]?.agency.id_agency ?? null
      : null;

  if (pageItems.length === 0) {
    return res.status(200).json({ items: [], nextCursor: null });
  }

  const pageAgencyIds = pageItems.map((item) => item.agency.id_agency);
  const [userCounts, clientCounts, bookingCounts, lastConnections] =
    await Promise.all([
      prisma.user.groupBy({
        by: ["id_agency"],
        where: { id_agency: { in: pageAgencyIds } },
        _count: { _all: true },
      }),
      prisma.client.groupBy({
        by: ["id_agency"],
        where: { id_agency: { in: pageAgencyIds } },
        _count: { _all: true },
      }),
      prisma.booking.groupBy({
        by: ["id_agency"],
        where: { id_agency: { in: pageAgencyIds } },
        _count: { _all: true },
      }),
      prisma.user.groupBy({
        by: ["id_agency"],
        where: {
          id_agency: { in: pageAgencyIds },
          last_login_at: { not: null },
        },
        _max: { last_login_at: true },
      }),
    ]);

  const userCountMap = userCounts.reduce<Record<number, number>>((acc, row) => {
    acc[row.id_agency] = row._count._all;
    return acc;
  }, {});
  const clientCountMap = clientCounts.reduce<Record<number, number>>(
    (acc, row) => {
      acc[row.id_agency] = row._count._all;
      return acc;
    },
    {},
  );
  const bookingCountMap = bookingCounts.reduce<Record<number, number>>(
    (acc, row) => {
      acc[row.id_agency] = row._count._all;
      return acc;
    },
    {},
  );
  const lastConnectionByAgency = lastConnections.reduce<
    Record<number, Date | null>
  >((acc, row) => {
    acc[row.id_agency] = row._max.last_login_at ?? null;
    return acc;
  }, {});

  const withCounts = pageItems.map((item) => {
    const agency = item.agency;
    const ownerId = item.ownerId;
    const lastCharge = item.lastCharge;
    return {
      ...sanitizeAgency(agency),
      counts: {
        users: userCountMap[agency.id_agency] ?? 0,
        clients: clientCountMap[agency.id_agency] ?? 0,
        bookings: bookingCountMap[agency.id_agency] ?? 0,
      },
      billing: {
        owner_id: ownerId,
        owner_name: item.ownerName,
        is_owner: ownerId === agency.id_agency,
        status: item.billingStatus,
        period_start: lastCharge?.period_start ?? null,
        period_end: lastCharge?.period_end ?? null,
      },
      last_connection_at: lastConnectionByAgency[agency.id_agency] ?? null,
    };
  });

  return res.status(200).json({ items: withCounts, nextCursor });
}

/* ========== POST (crear agencia) ========== */
async function handlePOST(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);

  try {
    const parsed = AgencyCreateSchema.parse(req.body ?? {});
    const hasExpenseCategoryScope = await hasSchemaColumn(
      "ExpenseCategory",
      "scope",
    );
    const created = await prisma.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: {
          name: parsed.name,
          legal_name: parsed.legal_name,
          tax_id: parsed.tax_id,
          address: parsed.address ?? null,
          phone: parsed.phone ?? null,
          email: parsed.email ?? null,
          website: parsed.website ?? null,
          foundation_date: parsed.foundation_date
            ? toLocalDate(
                parsed.foundation_date instanceof Date
                  ? (toDateKeyInBuenosAiresLegacySafe(parsed.foundation_date) ??
                    "")
                  : (parsed.foundation_date as string),
              )
            : undefined,
          logo_url: parsed.logo_url ?? null,
        },
        select: {
          id_agency: true,
          name: true,
          legal_name: true,
          address: true,
          phone: true,
          email: true,
          tax_id: true,
          website: true,
          foundation_date: true,
          logo_url: true,
          creation_date: true,
          billing_owner_agency_id: true,
          afip_cert_base64: true,
          afip_key_base64: true,
        },
      });

      await seedAgencyDefaults(tx, agency.id_agency, hasExpenseCategoryScope);
      return agency;
    });

    return res.status(201).json({
      ...sanitizeAgency(created),
      counts: { users: 0, clients: 0, bookings: 0 },
    });
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "name" in e &&
      (e as { name: string }).name === "ZodError"
    ) {
      const zz = e as { issues?: { message?: string }[] };
      return res
        .status(400)
        .json({ error: zz.issues?.[0]?.message || "Datos inválidos" });
    }
    // eslint-disable-next-line no-console
    console.error("[dev/agencies][POST]", e);
    return res.status(500).json({ error: "Error al crear la agencia" });
  }
}

/* ========== Router ========== */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method === "GET") return await handleGET(req, res);
    if (req.method === "POST") return await handlePOST(req, res);
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (e) {
    const err = e as AppError;
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Error";
    return res.status(status).json({ error: message });
  }
}
