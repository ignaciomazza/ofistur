// src/pages/api/service-calc-config/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify, type JWTPayload } from "jose";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  type ReceiptServiceSelectionMode,
  parseReceiptServiceSelectionMode,
  extractReceiptServiceSelectionModeFromBookingAccessRules,
  buildBookingAccessRulesValue,
} from "@/utils/receiptServiceSelection";

/* =============================
 * Types “lite”
 * ============================= */
type ServiceCalcConfigRow = {
  id_config: number;
  id_agency: number;
  billing_breakdown_mode: string; // "auto" | "manual"
  billing_adjustments: unknown | null;
  use_booking_sale_total: boolean | null;
  booking_visibility_mode: string | null;
  booking_access_rules?: unknown | null;
  created_at: Date;
  updated_at: Date;
};

type AgencyRow = {
  id_agency: number;
  transfer_fee_pct: number | null;
};

type CalcConfigResponse = {
  billing_breakdown_mode: string; // "auto" | "manual"
  transfer_fee_pct: number; // proporción (0.024 = 2.4%)
  billing_adjustments: BillingAdjustment[];
  use_booking_sale_total: boolean;
  booking_visibility_mode: BookingVisibilityMode;
  receipt_service_selection_mode: ReceiptServiceSelectionMode;
};

type BookingVisibilityMode = "all" | "team" | "own";

/* =============================
 * Helpers comunes
 * ============================= */
const JWT_SECRET = process.env.JWT_SECRET || "";
const isProd = process.env.NODE_ENV === "production";

type TokenPayload = JWTPayload & {
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  role?: string;
};

function getBearerToken(req: NextApiRequest): string | null {
  const a = req.headers.authorization || "";
  return a.startsWith("Bearer ") ? a.slice(7) : null;
}
function getCookieToken(req: NextApiRequest): string | null {
  const c = req.cookies as Record<string, string | undefined>;
  // tu cookie principal primero
  if (c?.token) return c.token;
  // fallback por si quedó algo viejo con otro nombre
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    if (c?.[k]) return c[k] as string;
  }
  return null;
}

/**
 * Verifica candidatos en orden:
 * 1) Authorization Bearer
 * 2) Cookie(s)
 * Si uno falla, prueba el siguiente (evita 401 por cookie vieja).
 */
export async function getAuth(req: NextApiRequest) {
  if (!JWT_SECRET) return null;
  const candidates = [getBearerToken(req), getCookieToken(req)].filter(
    Boolean,
  ) as string[];

  for (const tok of candidates) {
    try {
      const { payload } = await jwtVerify(
        tok,
        new TextEncoder().encode(JWT_SECRET),
      );
      const p = payload as TokenPayload;
      const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
      const role = String(p.role ?? "").toLowerCase();
      if (id_agency) return { id_agency, role };
      // si no hay agency, seguí probando siguiente candidato
    } catch {
      // token inválido → probamos el siguiente candidato
      continue;
    }
  }
  return null;
}

export function canWrite(role: string) {
  return ["gerente", "administrativo", "desarrollador"].includes(
    (role || "").toLowerCase(),
  );
}

export function sendError(
  res: import("next").NextApiResponse,
  tag: string,
  e: unknown,
  status = 500,
  fallback = "Error interno",
) {
  console.error(`[${tag}]`, e);
  const detail =
    e instanceof Error ? e.message : typeof e === "string" ? e : undefined;
  if (isProd) return res.status(status).json({ error: fallback });
  return res.status(status).json({ error: fallback, detail });
}

/* =============================
 * Utils locales
 * ============================= */
function parsePct(input: unknown): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    if (input > 1) return input / 100; // si viene 2.4 -> 0.024
    if (input < 0) return null;
    return input; // ya es proporción 0–1
  }
  if (typeof input === "string") {
    const raw = input.replace(",", ".").trim();
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n > 1) return n / 100; // "2.4" -> 0.024
    if (n < 0) return null;
    return n;
  }
  return null;
}

function parseBookingVisibilityMode(
  input: unknown,
): BookingVisibilityMode | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "team" ||
    normalized === "own"
  ) {
    return normalized;
  }
  return null;
}

type BillingAdjustment = {
  id: string;
  label: string;
  kind: "cost" | "tax";
  basis: "sale" | "cost" | "margin";
  valueType: "percent" | "fixed";
  value: number;
  active: boolean;
};

function makeAdjustmentId() {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : null;
  if (uuid) return uuid;
  return `adj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseNumber(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 ? input : null;
  }
  if (typeof input === "string") {
    const raw = input.replace(",", ".").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }
  return null;
}

function normalizeAdjustment(raw: unknown): BillingAdjustment | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const label = typeof obj.label === "string" ? obj.label.trim() : "";
  if (!label) return null;

  const kind = String(obj.kind || "").trim().toLowerCase();
  if (kind !== "cost" && kind !== "tax") return null;

  const basis = String(obj.basis || "").trim().toLowerCase();
  if (basis !== "sale" && basis !== "cost" && basis !== "margin") return null;

  const valueTypeRaw =
    typeof obj.valueType === "string"
      ? obj.valueType
      : typeof obj.value_type === "string"
        ? obj.value_type
        : "";
  const valueType = valueTypeRaw.trim().toLowerCase();
  if (valueType !== "percent" && valueType !== "fixed") return null;

  let value: number | null = null;
  if (valueType === "percent") {
    value = parsePct(obj.value);
  } else {
    value = parseNumber(obj.value);
  }
  if (value == null) return null;

  const active =
    typeof obj.active === "boolean"
      ? obj.active
      : typeof obj.active === "number"
        ? obj.active === 1
        : true;

  const id =
    typeof obj.id === "string" && obj.id.trim()
      ? obj.id.trim()
      : makeAdjustmentId();

  return {
    id,
    label,
    kind: kind as BillingAdjustment["kind"],
    basis: basis as BillingAdjustment["basis"],
    valueType: valueType as BillingAdjustment["valueType"],
    value,
    active,
  };
}

function normalizeAdjustments(
  input: unknown,
): BillingAdjustment[] | null {
  if (input == null) return [];
  if (!Array.isArray(input)) return null;
  const items: BillingAdjustment[] = [];
  for (const raw of input) {
    const norm = normalizeAdjustment(raw);
    if (!norm) return null;
    items.push(norm);
  }
  return items;
}

function parseBool(input: unknown): boolean | null {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input === 1 ? true : input === 0 ? false : null;
  if (typeof input === "string") {
    const s = input.trim().toLowerCase();
    if (["1", "true", "t", "yes", "y"].includes(s)) return true;
    if (["0", "false", "f", "no", "n"].includes(s)) return false;
  }
  return null;
}

/* ========== Delegates sin any ========== */
type ClientLike = PrismaClient | Prisma.TransactionClient;

type ServiceCalcConfigLike = {
  findUnique: (
    args: Prisma.ServiceCalcConfigFindUniqueArgs,
  ) => Promise<Partial<ServiceCalcConfigRow> | null>;
  update: (
    args: Prisma.ServiceCalcConfigUpdateArgs,
  ) => Promise<ServiceCalcConfigRow>;
  create: (
    args: Prisma.ServiceCalcConfigCreateArgs,
  ) => Promise<ServiceCalcConfigRow>;
  upsert: (
    args: Prisma.ServiceCalcConfigUpsertArgs,
  ) => Promise<ServiceCalcConfigRow>;
};

type AgencyLike = {
  findUnique: (
    args: Prisma.AgencyFindUniqueArgs,
  ) => Promise<Partial<AgencyRow> | null>;
  update: (args: Prisma.AgencyUpdateArgs) => Promise<AgencyRow>;
};

function readProp<T>(obj: Record<string, unknown>, name: string): T | null {
  const v = obj[name];
  return v && typeof v === "object" ? (v as T) : null;
}

/** Acepta prisma o tx y resuelve delegates robustamente (sin any) */
function requireDelegates(client: ClientLike) {
  const bag = client as unknown as Record<string, unknown>;

  const scc =
    readProp<ServiceCalcConfigLike>(bag, "serviceCalcConfig") ||
    readProp<ServiceCalcConfigLike>(bag, "ServiceCalcConfig") ||
    readProp<ServiceCalcConfigLike>(bag, "service_calc_config");

  if (!scc || typeof scc.findUnique !== "function") {
    throw new Error(
      'No se encontró el delegate Prisma "serviceCalcConfig". Verificá `model ServiceCalcConfig { ... }` y corré `npx prisma generate`.',
    );
  }

  const ag =
    readProp<AgencyLike>(bag, "agency") ||
    readProp<AgencyLike>(bag, "Agency") ||
    readProp<AgencyLike>(bag, "agencies");

  if (!ag || typeof ag.findUnique !== "function") {
    throw new Error(
      'No se encontró el delegate Prisma "agency". Verificá `model Agency { ... }` y corré `npx prisma generate`.',
    );
  }

  return { serviceCalcConfig: scc, agency: ag };
}

/* =============================
 * Handler
 * ============================= */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const auth = await getAuth(req);
    if (!auth) return res.status(401).json({ error: "No autenticado" });

    const { serviceCalcConfig, agency } = requireDelegates(prisma);

    if (req.method === "GET") {
      try {
        const [cfg, ag] = await Promise.all([
          serviceCalcConfig.findUnique({
            where: { id_agency: auth.id_agency },
            select: {
              billing_breakdown_mode: true,
              billing_adjustments: true,
              use_booking_sale_total: true,
              booking_visibility_mode: true,
              booking_access_rules: true,
            },
          }),
          agency.findUnique({
            where: { id_agency: auth.id_agency },
            select: { transfer_fee_pct: true },
          }),
        ]);

        const payload: CalcConfigResponse = {
          billing_breakdown_mode:
            (cfg?.billing_breakdown_mode as string) ?? "auto",
          transfer_fee_pct:
            ag?.transfer_fee_pct != null ? Number(ag.transfer_fee_pct) : 0.024,
          billing_adjustments: Array.isArray(cfg?.billing_adjustments)
            ? (cfg?.billing_adjustments as BillingAdjustment[])
            : [],
          use_booking_sale_total: Boolean(cfg?.use_booking_sale_total),
          booking_visibility_mode:
            parseBookingVisibilityMode(cfg?.booking_visibility_mode) ?? "own",
          receipt_service_selection_mode:
            extractReceiptServiceSelectionModeFromBookingAccessRules(
              cfg?.booking_access_rules,
            ),
        };
        return res.status(200).json(payload);
      } catch (e) {
        return sendError(
          res,
          "service-calc-config/GET",
          e,
          500,
          "Error leyendo configuración",
        );
      }
    }

    if (req.method === "POST") {
      if (!canWrite(auth.role)) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      try {
        const body = (req.body ?? {}) as {
          billing_breakdown_mode?: unknown;
          transfer_fee_pct?: unknown;
          billing_adjustments?: unknown;
          use_booking_sale_total?: unknown;
          booking_visibility_mode?: unknown;
          receipt_service_selection_mode?: unknown;
        };

        let mode: string | undefined;
        if (typeof body.billing_breakdown_mode === "string") {
          const v = body.billing_breakdown_mode.trim().toLowerCase();
          if (!["auto", "manual"].includes(v)) {
            return res.status(400).json({
              error: 'billing_breakdown_mode debe ser "auto" o "manual"',
            });
          }
          mode = v;
        }

        const pct =
          body.transfer_fee_pct !== undefined
            ? parsePct(body.transfer_fee_pct)
            : undefined;
        if (body.transfer_fee_pct !== undefined && pct == null) {
          return res.status(400).json({
            error:
              "transfer_fee_pct inválido (acepta proporción 0–1 o porcentaje 0–100)",
            });
        }

        const adjustments =
          body.billing_adjustments !== undefined
            ? normalizeAdjustments(body.billing_adjustments)
            : undefined;
        if (body.billing_adjustments !== undefined && adjustments == null) {
          return res.status(400).json({
            error:
              "billing_adjustments inválido (espera lista con label/kind/basis/valueType/value)",
          });
        }

        const useBookingSaleTotal =
          body.use_booking_sale_total !== undefined
            ? parseBool(body.use_booking_sale_total)
            : undefined;
        if (
          body.use_booking_sale_total !== undefined &&
          useBookingSaleTotal == null
        ) {
          return res.status(400).json({
            error: "use_booking_sale_total inválido (booleano esperado)",
          });
        }

        const visibilityMode =
          body.booking_visibility_mode !== undefined
            ? parseBookingVisibilityMode(body.booking_visibility_mode)
            : undefined;
        if (
          body.booking_visibility_mode !== undefined &&
          visibilityMode == null
        ) {
          return res.status(400).json({
            error: 'booking_visibility_mode debe ser "all", "team" o "own"',
          });
        }

        const receiptServiceSelectionMode =
          body.receipt_service_selection_mode !== undefined
            ? parseReceiptServiceSelectionMode(
                body.receipt_service_selection_mode,
              )
            : undefined;
        if (
          body.receipt_service_selection_mode !== undefined &&
          receiptServiceSelectionMode == null
        ) {
          return res.status(400).json({
            error:
              'receipt_service_selection_mode debe ser "required", "optional" o "booking"',
          });
        }

        if (
          mode === undefined &&
          pct === undefined &&
          adjustments === undefined &&
          useBookingSaleTotal === undefined &&
          visibilityMode === undefined &&
          receiptServiceSelectionMode === undefined
        ) {
          return res
            .status(400)
            .json({ error: "No hay cambios para aplicar en el payload" });
        }
        const safeAdjustments =
          adjustments === null ? undefined : adjustments;
        const useBookingSaleTotalValue =
          useBookingSaleTotal === null ? undefined : useBookingSaleTotal;
        const visibilityModeValue =
          visibilityMode === null ? undefined : visibilityMode;
        const receiptServiceSelectionModeValue =
          receiptServiceSelectionMode === null
            ? undefined
            : receiptServiceSelectionMode;

        await prisma.$transaction(async (tx) => {
          const { serviceCalcConfig: scc, agency: ag } = requireDelegates(tx);

          if (
            mode !== undefined ||
            adjustments !== undefined ||
            useBookingSaleTotal !== undefined ||
            visibilityModeValue !== undefined ||
            receiptServiceSelectionModeValue !== undefined
          ) {
            const existing = await scc.findUnique({
              where: { id_agency: auth.id_agency },
              select: { id_config: true, booking_access_rules: true },
            });
            if (existing) {
              const data: Prisma.ServiceCalcConfigUpdateInput = {};
              if (mode !== undefined) data.billing_breakdown_mode = mode;
              if (safeAdjustments !== undefined) {
                data.billing_adjustments = safeAdjustments;
              }
              if (useBookingSaleTotalValue !== undefined) {
                data.use_booking_sale_total = useBookingSaleTotalValue;
              }
              if (visibilityModeValue !== undefined) {
                data.booking_visibility_mode = visibilityModeValue;
              }
              if (receiptServiceSelectionModeValue !== undefined) {
                data.booking_access_rules = buildBookingAccessRulesValue({
                  existing: existing.booking_access_rules,
                  receiptServiceSelectionMode:
                    receiptServiceSelectionModeValue,
                }) as Prisma.InputJsonValue;
              }
              await scc.update({
                where: { id_agency: auth.id_agency },
                data,
              });
            } else {
              const agencyCalcId = await getNextAgencyCounter(
                tx,
                auth.id_agency,
                "service_calc_config",
              );
              const data: Prisma.ServiceCalcConfigUncheckedCreateInput = {
                id_agency: auth.id_agency,
                agency_service_calc_config_id: agencyCalcId,
                billing_breakdown_mode: mode ?? "auto",
              };
              if (safeAdjustments !== undefined) {
                data.billing_adjustments = safeAdjustments;
              }
              if (useBookingSaleTotalValue !== undefined) {
                data.use_booking_sale_total = useBookingSaleTotalValue;
              }
              if (visibilityModeValue !== undefined) {
                data.booking_visibility_mode = visibilityModeValue;
              }
              if (receiptServiceSelectionModeValue !== undefined) {
                data.booking_access_rules = buildBookingAccessRulesValue({
                  existing: null,
                  rules: [],
                  receiptServiceSelectionMode:
                    receiptServiceSelectionModeValue,
                }) as Prisma.InputJsonValue;
              }
              await scc.create({
                data,
              });
            }
          }
          if (pct !== undefined) {
            await ag.update({
              where: { id_agency: auth.id_agency },
              data: { transfer_fee_pct: pct },
            });
          }
        });

        const [cfg, ag] = await Promise.all([
          serviceCalcConfig.findUnique({
            where: { id_agency: auth.id_agency },
            select: {
              billing_breakdown_mode: true,
              billing_adjustments: true,
              use_booking_sale_total: true,
              booking_visibility_mode: true,
              booking_access_rules: true,
            },
          }),
          agency.findUnique({
            where: { id_agency: auth.id_agency },
            select: { transfer_fee_pct: true },
          }),
        ]);

        const payload: CalcConfigResponse = {
          billing_breakdown_mode:
            (cfg?.billing_breakdown_mode as string) ?? "auto",
          transfer_fee_pct:
            ag?.transfer_fee_pct != null ? Number(ag.transfer_fee_pct) : 0.024,
          billing_adjustments: Array.isArray(cfg?.billing_adjustments)
            ? (cfg?.billing_adjustments as BillingAdjustment[])
            : [],
          use_booking_sale_total: Boolean(cfg?.use_booking_sale_total),
          booking_visibility_mode:
            parseBookingVisibilityMode(cfg?.booking_visibility_mode) ?? "own",
          receipt_service_selection_mode:
            extractReceiptServiceSelectionModeFromBookingAccessRules(
              cfg?.booking_access_rules,
            ),
        };
        return res.status(200).json(payload);
      } catch (e) {
        return sendError(
          res,
          "service-calc-config/POST",
          e,
          500,
          "Error guardando configuración",
        );
      }
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (e) {
    return sendError(res, "service-calc-config", e);
  }
}
