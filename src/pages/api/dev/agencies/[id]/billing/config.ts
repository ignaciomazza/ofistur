// src/pages/api/dev/agencies/[id]/billing/config.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { isPlanKey, normalizeUsersCount } from "@/lib/billing/pricing";

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

function parseAgencyId(param: unknown): number {
  const raw = Array.isArray(param) ? param[0] : param;
  const id = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0)
    throw httpError(400, "ID de agencia inválido");
  return id;
}

async function resolveBillingOwnerId(id_agency: number): Promise<number> {
  const agency = await prisma.agency.findUnique({
    where: { id_agency },
    select: { id_agency: true, billing_owner_agency_id: true },
  });
  if (!agency) throw httpError(404, "Agencia no encontrada");
  return agency.billing_owner_agency_id ?? agency.id_agency;
}

async function getBillingMemberIds(ownerId: number): Promise<number[]> {
  const members = await prisma.agency.findMany({
    where: {
      OR: [{ id_agency: ownerId }, { billing_owner_agency_id: ownerId }],
    },
    select: { id_agency: true },
  });
  return members.map((m) => m.id_agency);
}

function toDate(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const numberInput = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "string") return Number(v);
  return v;
}, z.number().int().min(1));

const ConfigSchema = z
  .object({
    plan_key: z
      .string()
      .transform((v) => v.trim().toLowerCase())
      .refine((v) => isPlanKey(v), "Plan invalido"),
    billing_users: numberInput,
    user_limit: numberInput.optional(),
    currency: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim().toUpperCase() : "USD")),
    start_date: z.union([z.string(), z.date(), z.null(), z.undefined()]),
    notes: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : "")),
    collections_pd_enabled: z.boolean().optional(),
    collections_dunning_enabled: z.boolean().optional(),
    collections_fallback_enabled: z.boolean().optional(),
    collections_fallback_provider: z
      .string()
      .optional()
      .transform((v) => {
        const normalized = String(v || "")
          .trim()
          .toUpperCase();
        if (!normalized) return null;
        if (normalized === "CIG_QR") return "CIG_QR";
        if (normalized === "MP") return "MP";
        if (normalized === "OTHER") return "OTHER";
        return null;
      }),
    collections_fallback_auto_sync_enabled: z.boolean().optional(),
    collections_suspended: z.boolean().optional(),
    collections_cutoff_override_hour_ar: z
      .union([z.number().int().min(0).max(23), z.null()])
      .optional(),
    collections_notes: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim() : "")),
  })
  .strict();

async function handleGET(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);
  const id_agency = parseAgencyId(req.query.id);
  const billingOwnerId = await resolveBillingOwnerId(id_agency);

  const agency = await prisma.agency.findUnique({
    where: { id_agency: billingOwnerId },
    select: { id_agency: true },
  });
  if (!agency) return res.status(404).json({ error: "Agencia no encontrada" });

  const memberIds = await getBillingMemberIds(billingOwnerId);
  const [config, currentUsers] = await Promise.all([
    prisma.agencyBillingConfig.findUnique({
      where: { id_agency: billingOwnerId },
    }),
    prisma.user.count({ where: { id_agency: { in: memberIds } } }),
  ]);

  const fallbackUsers = Math.max(currentUsers, 3);
  const fallback = {
    id_agency: billingOwnerId,
    plan_key: "basico",
    billing_users: fallbackUsers,
    user_limit: null,
    currency: "USD",
    start_date: null,
    notes: "",
    collections_pd_enabled: false,
    collections_dunning_enabled: false,
    collections_fallback_enabled: false,
    collections_fallback_provider: null,
    collections_fallback_auto_sync_enabled: false,
    collections_suspended: false,
    collections_cutoff_override_hour_ar: null,
    collections_notes: "",
  };

  return res.status(200).json({
    config: config ?? fallback,
    current_users: currentUsers,
    has_config: Boolean(config),
  });
}

async function handlePUT(req: NextApiRequest, res: NextApiResponse) {
  await requireDeveloper(req);
  const id_agency = parseAgencyId(req.query.id);
  const billingOwnerId = await resolveBillingOwnerId(id_agency);

  const parsed = ConfigSchema.parse(req.body ?? {});
  const billingUsers = normalizeUsersCount(parsed.billing_users);

  const data = {
    plan_key: parsed.plan_key,
    billing_users: billingUsers,
    user_limit: parsed.user_limit ?? null,
    currency: parsed.currency || "USD",
    start_date: toDate(parsed.start_date),
    notes: parsed.notes?.trim() || null,
    ...(parsed.collections_pd_enabled !== undefined
      ? { collections_pd_enabled: parsed.collections_pd_enabled }
      : {}),
    ...(parsed.collections_dunning_enabled !== undefined
      ? { collections_dunning_enabled: parsed.collections_dunning_enabled }
      : {}),
    ...(parsed.collections_fallback_enabled !== undefined
      ? { collections_fallback_enabled: parsed.collections_fallback_enabled }
      : {}),
    ...(parsed.collections_fallback_provider !== undefined
      ? { collections_fallback_provider: parsed.collections_fallback_provider }
      : {}),
    ...(parsed.collections_fallback_auto_sync_enabled !== undefined
      ? {
          collections_fallback_auto_sync_enabled:
            parsed.collections_fallback_auto_sync_enabled,
        }
      : {}),
    ...(parsed.collections_suspended !== undefined
      ? { collections_suspended: parsed.collections_suspended }
      : {}),
    ...(parsed.collections_cutoff_override_hour_ar !== undefined
      ? {
          collections_cutoff_override_hour_ar:
            parsed.collections_cutoff_override_hour_ar,
        }
      : {}),
    ...(parsed.collections_notes !== undefined
      ? { collections_notes: parsed.collections_notes?.trim() || null }
      : {}),
  };

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.agencyBillingConfig.findUnique({
      where: { id_agency: billingOwnerId },
      select: { id_config: true },
    });
    if (existing) {
      return tx.agencyBillingConfig.update({
        where: { id_agency: billingOwnerId },
        data,
      });
    }
    const agencyConfigId = await getNextAgencyCounter(
      tx,
      billingOwnerId,
      "agency_billing_config",
    );
    return tx.agencyBillingConfig.create({
      data: {
        id_agency: billingOwnerId,
        agency_billing_config_id: agencyConfigId,
        ...data,
      },
    });
  });

  return res.status(200).json(saved);
}

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
            .json({ error: e.issues?.[0]?.message || "Datos invalidos" });
        }
        throw e;
      }
    }
    res.setHeader("Allow", ["GET", "PUT"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (e) {
    const err = e as AppError;
    const status = typeof err.status === "number" ? err.status : 500;
    const message = err.message || "Error";
    return res.status(status).json({ error: message });
  }
}
