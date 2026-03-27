// src/pages/api/dev/agencies/[id].ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import {
  parseDateInputInBuenosAires,
  toDateKeyInBuenosAiresLegacySafe,
} from "@/lib/buenosAiresDate";

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

/* ========== Validaciones / utils ========== */
function parseId(param: unknown): number {
  const raw = Array.isArray(param) ? param[0] : param;
  const id = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, "ID inválido");
  return id;
}

function getDeleteConfirmationText(req: NextApiRequest): string {
  const body =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : {};

  const raw =
    body.confirmationText ?? body.confirmation ?? body.confirm ?? body.value;
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

async function purgeAgencyData(id: number): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const [userRows, travelGroupInvoiceRows, billingChargeRows] =
        await Promise.all([
          tx.user.findMany({
            where: { id_agency: id },
            select: { id_user: true },
          }),
          tx.travelGroupInvoice.findMany({
            where: { id_agency: id },
            select: { id_travel_group_invoice: true },
          }),
          tx.agencyBillingCharge.findMany({
            where: { id_agency: id },
            select: { id_charge: true },
          }),
        ]);

      const userIds = userRows.map((u) => u.id_user);
      const travelGroupInvoiceIds = travelGroupInvoiceRows.map(
        (i) => i.id_travel_group_invoice,
      );
      const billingChargeIds = billingChargeRows.map((c) => c.id_charge);

      const billingAttemptIds =
        billingChargeIds.length > 0
          ? (
              await tx.agencyBillingAttempt.findMany({
                where: { charge_id: { in: billingChargeIds } },
                select: { id_attempt: true },
              })
            ).map((a) => a.id_attempt)
          : [];

      await tx.agency.updateMany({
        where: { billing_owner_agency_id: id },
        data: { billing_owner_agency_id: null },
      });

      if (userIds.length > 0) {
        await tx.destination.updateMany({
          where: { created_by: { in: userIds } },
          data: { created_by: null },
        });
        await tx.serviceDestination.updateMany({
          where: { added_by: { in: userIds } },
          data: { added_by: null },
        });
        await tx.userTeam.deleteMany({
          where: { id_user: { in: userIds } },
        });
      }

      if (travelGroupInvoiceIds.length > 0) {
        await tx.travelGroupInvoiceItem.deleteMany({
          where: { travel_group_invoice_id: { in: travelGroupInvoiceIds } },
        });
      }
      await tx.travelGroupInvoice.deleteMany({ where: { id_agency: id } });
      await tx.travelGroupOperatorPayment.deleteMany({
        where: { id_agency: id },
      });
      await tx.travelGroupOperatorDue.deleteMany({ where: { id_agency: id } });
      await tx.travelGroupReceipt.deleteMany({ where: { id_agency: id } });
      await tx.travelGroupClientPayment.deleteMany({
        where: { id_agency: id },
      });

      if (billingChargeIds.length > 0) {
        await tx.agencyBillingFileBatchItem.deleteMany({
          where: { charge_id: { in: billingChargeIds } },
        });
      }
      if (billingAttemptIds.length > 0) {
        await tx.agencyBillingFileBatchItem.deleteMany({
          where: { attempt_id: { in: billingAttemptIds } },
        });
      }

      await tx.userDataMigrationJob.deleteMany({ where: { id_agency: id } });
      await tx.lead.deleteMany({ where: { id_agency: id } });

      await tx.clientPaymentAudit.deleteMany({ where: { id_agency: id } });
      await tx.clientPayment.deleteMany({ where: { id_agency: id } });
      await tx.operatorDue.deleteMany({ where: { id_agency: id } });
      await tx.creditEntry.deleteMany({ where: { id_agency: id } });
      await tx.investment.deleteMany({ where: { id_agency: id } });
      await tx.recurringInvestment.deleteMany({ where: { id_agency: id } });
      await tx.creditAccount.deleteMany({ where: { id_agency: id } });
      await tx.otherIncome.deleteMany({ where: { id_agency: id } });
      await tx.receipt.deleteMany({ where: { id_agency: id } });
      await tx.creditNote.deleteMany({ where: { id_agency: id } });
      await tx.invoice.deleteMany({ where: { id_agency: id } });

      await tx.fileAsset.deleteMany({ where: { id_agency: id } });
      await tx.service.deleteMany({ where: { id_agency: id } });
      await tx.booking.deleteMany({ where: { id_agency: id } });
      await tx.travelGroupPassenger.deleteMany({ where: { id_agency: id } });
      await tx.travelGroupInventory.deleteMany({ where: { id_agency: id } });
      await tx.travelGroupDeparture.deleteMany({ where: { id_agency: id } });
      await tx.travelGroup.deleteMany({ where: { id_agency: id } });

      await tx.clientRelation.deleteMany({ where: { id_agency: id } });
      await tx.serviceTypePreset.deleteMany({ where: { id_agency: id } });
      await tx.serviceType.deleteMany({ where: { id_agency: id } });
      await tx.passengerCategory.deleteMany({ where: { id_agency: id } });
      await tx.client.deleteMany({ where: { id_agency: id } });
      await tx.operator.deleteMany({ where: { id_agency: id } });

      await tx.commissionRuleSet.deleteMany({ where: { id_agency: id } });
      await tx.textPreset.deleteMany({ where: { id_agency: id } });
      await tx.quote.deleteMany({ where: { id_agency: id } });
      await tx.templateConfig.deleteMany({ where: { id_agency: id } });
      await tx.resources.deleteMany({ where: { id_agency: id } });
      await tx.travelGroupPaymentTemplate.deleteMany({
        where: { id_agency: id },
      });
      await tx.salesTeam.deleteMany({ where: { id_agency: id } });
      await tx.user.deleteMany({ where: { id_agency: id } });

      await tx.financeAccountAudit.deleteMany({ where: { id_agency: id } });
      await tx.financeAccountAdjustment.deleteMany({ where: { id_agency: id } });
      await tx.financeTransfer.deleteMany({ where: { id_agency: id } });
      await tx.financeAccountOpeningBalance.deleteMany({
        where: { id_agency: id },
      });
      await tx.financeAccount.deleteMany({ where: { id_agency: id } });
      await tx.financeCurrency.deleteMany({ where: { id_agency: id } });
      await tx.financePaymentMethod.deleteMany({ where: { id_agency: id } });
      await tx.financeMonthLockEvent.deleteMany({ where: { id_agency: id } });
      await tx.financeMonthLock.deleteMany({ where: { id_agency: id } });
      await tx.financeConfig.deleteMany({ where: { id_agency: id } });
      await tx.clientConfig.deleteMany({ where: { id_agency: id } });
      await tx.quoteConfig.deleteMany({ where: { id_agency: id } });
      await tx.resourceConfig.deleteMany({ where: { id_agency: id } });
      await tx.serviceCalcConfig.deleteMany({ where: { id_agency: id } });
      await tx.travelGroupConfig.deleteMany({ where: { id_agency: id } });
      await tx.expenseCategory.deleteMany({ where: { id_agency: id } });

      await tx.agencyCounter.deleteMany({ where: { id_agency: id } });
      await tx.agencyStorageUsage.deleteMany({ where: { id_agency: id } });
      await tx.agencyStorageConfig.deleteMany({ where: { id_agency: id } });
      await tx.agencyArcaConfig.deleteMany({ where: { agencyId: id } });
      await tx.arcaConnectionJob.deleteMany({ where: { agencyId: id } });

      await tx.billingFileImportRun.deleteMany({ where: { agency_id: id } });
      await tx.agencyBillingPaymentReviewCase.deleteMany({
        where: { agency_id: id },
      });
      await tx.agencyBillingFallbackIntent.deleteMany({
        where: { agency_id: id },
      });
      await tx.agencyBillingEvent.deleteMany({ where: { id_agency: id } });
      await tx.agencyBillingCharge.deleteMany({ where: { id_agency: id } });
      await tx.agencyBillingCycle.deleteMany({ where: { id_agency: id } });
      await tx.agencyBillingAdjustment.deleteMany({ where: { id_agency: id } });
      await tx.agencyBillingConfig.deleteMany({ where: { id_agency: id } });
      await tx.agencyBillingSubscription.deleteMany({ where: { id_agency: id } });

      await tx.agency.delete({ where: { id_agency: id } });
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

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

const AgencyUpdateSchema = z
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

/* ========== Serialización segura ========== */
type AgencySelected = {
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
  afip_cert_base64: unknown | null;
  afip_key_base64: unknown | null;
};

function sanitizeAgency(a: AgencySelected) {
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

/* ========== GET: obtener agencia + counts ========== */
async function handleGET(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);
  const id = parseId(req.query.id);

  const a = await prisma.agency.findUnique({
    where: { id_agency: id },
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
      afip_cert_base64: true,
      afip_key_base64: true,
    },
  });

  if (!a) return res.status(404).json({ error: "Agencia no encontrada" });

  const [users, clients, bookings] = await Promise.all([
    prisma.user.count({ where: { id_agency: id } }),
    prisma.client.count({ where: { id_agency: id } }),
    prisma.booking.count({ where: { id_agency: id } }),
  ]);

  return res
    .status(200)
    .json({
      ...sanitizeAgency(a as AgencySelected),
      counts: { users, clients, bookings },
    });
}

/* ========== PUT: actualizar agencia ========== */
async function handlePUT(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);
  const id = parseId(req.query.id);

  const parsed = (() => {
    // Permitimos Date o string; normalizamos
    const p = AgencyUpdateSchema.parse(req.body ?? {});
    return {
      ...p,
      foundation_date: p.foundation_date
        ? toLocalDate(
            p.foundation_date instanceof Date
              ? (toDateKeyInBuenosAiresLegacySafe(p.foundation_date) ?? "")
              : (p.foundation_date as string),
          )
        : undefined,
    };
  })();

  const updated = await prisma.agency.update({
    where: { id_agency: id },
    data: {
      name: parsed.name,
      legal_name: parsed.legal_name,
      tax_id: parsed.tax_id,
      address: parsed.address ?? null,
      phone: parsed.phone ?? null,
      email: parsed.email ?? null,
      website: parsed.website ?? null,
      foundation_date: parsed.foundation_date,
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
      afip_cert_base64: true,
      afip_key_base64: true,
    },
  });

  return res.status(200).json(sanitizeAgency(updated as AgencySelected));
}

/* ========== DELETE: purge completo de agencia ========== */
async function handleDELETE(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);
  const id = parseId(req.query.id);
  const confirmation = getDeleteConfirmationText(req);
  if (confirmation !== "ELIMINAR") {
    return res.status(400).json({
      error:
        'Confirmación inválida. Para eliminar definitivamente, enviá confirmationText: "ELIMINAR".',
    });
  }

  const exists = await prisma.agency.findUnique({
    where: { id_agency: id },
    select: { id_agency: true },
  });
  if (!exists) return res.status(404).json({ error: "Agencia no encontrada" });

  await purgeAgencyData(id);
  return res.status(200).json({ ok: true });
}

/* ========== Router ========== */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method === "GET") return await handleGET(req, res);
    if (req.method === "PUT") {
      try {
        return await handlePUT(req, res);
      } catch (e) {
        if (e instanceof z.ZodError) {
          return res
            .status(400)
            .json({ error: e.issues?.[0]?.message || "Datos inválidos" });
        }
        throw e;
      }
    }
    if (req.method === "DELETE") return await handleDELETE(req, res);

    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (e) {
    // Manejo de errores tipado
    const err = e as AppError;
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Error";
    return res.status(status).json({ error: message });
  }
}
