// src/pages/api/invoices/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { listInvoices, createInvoices } from "@/services/invoices";
import { encodePublicId } from "@/lib/publicIds";
import { jwtVerify, type JWTPayload } from "jose";
import {
  canAccessBookingByRole,
  getBookingComponentGrants,
} from "@/lib/accessControl";
import { canAccessBookingComponent } from "@/utils/permissions";
import { refreshIssuerRegime } from "@/services/arca/regimeMonitor";

export const config = {
  maxDuration: 60,
};

/* ================= JWT SECRET (igual que bookings) ================= */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

/* ================= Tipos ================= */
type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  email?: string;
};

type DecodedUser = {
  id_user?: number;
  id_agency?: number;
  role?: string;
  email?: string;
};

/* ================= Helpers de auth (copiados del patrón OK) ================= */
function getTokenFromRequest(req: NextApiRequest): string | null {
  // 1) cookie "token" (más robusto en prod)
  if (req.cookies?.token) return req.cookies.token;

  // 2) Authorization: Bearer
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  // 3) otros posibles nombres de cookie
  const c = req.cookies || {};
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    const v = c[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

async function getUserFromAuth(
  req: NextApiRequest,
): Promise<DecodedUser | null> {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return null;

    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || undefined;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    const role = p.role;
    const email = p.email;

    // completar por email si falta id_user
    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role,
          email: u.email,
        };
    }

    // completar agency si falta
    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user,
          id_agency: u.id_agency,
          role: role ?? u.role,
          email: email ?? u.email ?? undefined,
        };
    }

    return { id_user, id_agency, role, email };
  } catch {
    return null;
  }
}

/* ================= Utils ================= */
const first = (v?: string | string[]) =>
  Array.isArray(v) ? v[0] : (v ?? undefined);

// bookingId puede venir como "145" o ["145"]
const querySchema = z.object({
  bookingId: z.preprocess(
    (v) => (Array.isArray(v) ? v[0] : v),
    z.coerce.number().int().positive("bookingId debe ser un número positivo"),
  ),
});

const bodySchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(100).optional(),
  bookingId: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, "bookingId inválido"),
  services: z
    .array(z.union([z.string(), z.number()]).transform((v) => Number(v)))
    .min(1, "Debe haber al menos un servicio"),
  clientIds: z
    .array(z.union([z.string(), z.number()]).transform((v) => Number(v)))
    .min(1, "Debe haber al menos un pax"),
  tipoFactura: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => n === 1 || n === 6, "tipoFactura debe ser 1 o 6"),
  exchangeRate: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null ? undefined : Number(v)))
    .refine((n) => n == null || (typeof n === "number" && n > 0), {
      message: "exchangeRate debe ser un número positivo",
    }),
  description21: z.array(z.string()).optional(),
  description10_5: z.array(z.string()).optional(),
  descriptionNonComputable: z.array(z.string()).optional(),
  manualTotals: z
    .object({
      total: z.number().nonnegative().optional(),
      base21: z.number().nonnegative().optional(),
      iva21: z.number().nonnegative().optional(),
      base10_5: z.number().nonnegative().optional(),
      iva10_5: z.number().nonnegative().optional(),
      exempt: z.number().nonnegative().optional(),
    })
    .optional(),
  clientShares: z.array(z.number().positive()).optional(),
  paxData: z
    .array(
      z.object({
        clientId: z.number().int().positive(),
        dni: z.string().optional(),
        cuit: z.string().optional(),
        persistLookup: z.boolean().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        company_name: z.string().optional(),
        address: z.string().optional(),
        locality: z.string().optional(),
        postal_code: z.string().optional(),
        commercial_address: z.string().optional(),
      }),
    )
    .optional(),
  customItems: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Descripción de item requerida"),
        taxCategory: z.enum(["21", "10_5", "EXEMPT"]),
        amount: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)")
    .refine((s) => {
      const d = new Date(s + "T00:00:00");
      if (Number.isNaN(d.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
      return diff >= -8 && diff <= 8;
    }, "La fecha de factura debe estar dentro de los 8 días anteriores o posteriores a hoy"),
});

/* ================= Handler ================= */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  /* ---------- GET ---------- */
  if (req.method === "GET") {
    try {
      const auth = await getUserFromAuth(req);
      if (!auth?.id_user || !auth.id_agency) {
        return res
          .status(401)
          .json({ success: false, message: "No autenticado" });
      }
      const bookingGrants = await getBookingComponentGrants(
        auth.id_agency,
        auth.id_user,
      );
      const canBilling = canAccessBookingComponent(
        auth.role,
        bookingGrants,
        "billing",
      );

      // rango de fechas opcional
      const fromStr = first(req.query.from as string | string[] | undefined);
      const toStr = first(req.query.to as string | string[] | undefined);

      if (fromStr && toStr) {
        if (!canBilling) {
          return res
            .status(403)
            .json({ success: false, message: "Sin permisos" });
        }
        const fromInt = parseInt(fromStr.replace(/-/g, ""), 10);
        const toInt = parseInt(toStr.replace(/-/g, ""), 10);

        const invoices = await prisma.invoice.findMany({
          where: {
            AND: [
              {
                payloadAfip: { path: ["voucherData", "CbteFch"], gte: fromInt },
              },
              { payloadAfip: { path: ["voucherData", "CbteFch"], lte: toInt } },
              { booking: { id_agency: auth.id_agency } }, // 🔒 multi-agencia
            ],
          },
          include: {
            booking: {
              select: {
                id_booking: true,
                agency_booking_id: true,
                id_agency: true,
                titular: {
                  select: {
                    first_name: true,
                    last_name: true,
                    company_name: true,
                    address: true,
                    locality: true,
                    postal_code: true,
                    commercial_address: true,
                  },
                },
              },
            },
            client: {
              select: {
                first_name: true,
                last_name: true,
                address: true,
                locality: true,
                postal_code: true,
              },
            },
          },
        });
        const normalized = invoices.map((inv) => ({
          ...inv,
          public_id:
            inv.agency_invoice_id != null
              ? encodePublicId({
                  t: "invoice",
                  a: inv.id_agency,
                  i: inv.agency_invoice_id,
                })
              : null,
          booking: inv.booking
            ? {
                ...inv.booking,
                public_id:
                  inv.booking.agency_booking_id != null
                    ? encodePublicId({
                        t: "booking",
                        a: inv.booking.id_agency,
                        i: inv.booking.agency_booking_id,
                      })
                    : null,
              }
            : inv.booking,
        }));

        return res.status(200).json({ success: true, invoices: normalized });
      }

      // por bookingId
      const parsedQ = querySchema.safeParse({ bookingId: req.query.bookingId });
      if (!parsedQ.success) {
        return res.status(400).json({
          success: false,
          message: parsedQ.error.errors.map((e) => e.message).join(", "),
        });
      }
      const bookingId = parsedQ.data.bookingId; // number

      // valida que la reserva sea de la agencia del usuario
      const booking = await prisma.booking.findFirst({
        where: { id_booking: bookingId, id_agency: auth.id_agency },
        select: { id_booking: true, id_agency: true, id_user: true },
      });
      if (!booking) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Reserva no pertenece a tu agencia.",
          });
      }
      const canReadByRole = await canAccessBookingByRole(auth, booking);
      if (!canBilling && !canReadByRole) {
        return res.status(403).json({ success: false, message: "Sin permisos" });
      }

      const invoices = await listInvoices(bookingId);
      const normalized = invoices.map((inv) => ({
        ...inv,
        public_id:
          inv.agency_invoice_id != null
            ? encodePublicId({
                t: "invoice",
                a: inv.id_agency,
                i: inv.agency_invoice_id,
              })
            : null,
      }));
      return res.status(200).json({ success: true, invoices: normalized });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error interno";
      console.error("[invoices][GET]", msg);
      return res.status(500).json({ success: false, message: msg });
    }
  }

  /* ---------- POST ---------- */
  if (req.method === "POST") {
    const auth = await getUserFromAuth(req);
    if (!auth?.id_user || !auth.id_agency) {
      return res
        .status(401)
        .json({ success: false, message: "No autenticado" });
    }
    const bookingGrants = await getBookingComponentGrants(
      auth.id_agency,
      auth.id_user,
    );
    const canBilling = canAccessBookingComponent(
      auth.role,
      bookingGrants,
      "billing",
    );
    if (!canBilling) {
      return res.status(403).json({ success: false, message: "Sin permisos" });
    }

    const parsedB = bodySchema.safeParse(req.body);
    if (!parsedB.success) {
      return res.status(400).json({
        success: false,
        message: parsedB.error.errors.map((e) => e.message).join(", "),
      });
    }

    try {
      await refreshIssuerRegime(auth.id_agency);
      const issuer = await prisma.agencyArcaConfig.findUnique({
        where: { agencyId: auth.id_agency },
        select: { status: true, taxRegime: true, observedTaxRegime: true, taxRegimeCheckedAt: true, authorizedServices: true },
      });
      if (issuer?.status === "disconnected" || issuer?.status === "error") {
        return res.status(409).json({ success: false, message: "La conexión ARCA requiere atención. Revisá el punto de venta o reconectá antes de facturar." });
      }
      if (issuer?.authorizedServices.includes("ws_sr_constancia_inscripcion") &&
          (!issuer.taxRegimeCheckedAt || Date.now() - issuer.taxRegimeCheckedAt.getTime() >= 24 * 60 * 60 * 1000)) {
        return res.status(503).json({ success: false, message: "No pude verificar el régimen fiscal en ARCA. Volvé a intentar antes de emitir." });
      }
      if (issuer?.taxRegime && issuer.observedTaxRegime && issuer.taxRegime !== issuer.observedTaxRegime) {
        return res.status(409).json({
          success: false,
          message: "ARCA informa un cambio de régimen fiscal. Reconectá ARCA antes de emitir nuevas facturas.",
        });
      }
      if (issuer?.taxRegime === "mono") {
        return res.status(409).json({
          success: false,
          message: "Este CUIT es monotributista. La emisión de Factura C todavía no está disponible; no se enviará una Factura A o B a ARCA.",
        });
      }
      // createInvoices ya resuelve agencia por el req (mismo token/cookie)
      const result = await createInvoices(req, parsedB.data);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          complete: result.complete ?? false,
          plannedCount: result.plannedCount,
          completedCount: result.completedCount,
          requestKey: result.requestKey,
          message: result.message,
        });
      }
      const invoices = (result.invoices ?? []).map((inv) => ({
        ...inv,
        public_id:
          inv.agency_invoice_id != null
            ? encodePublicId({
                t: "invoice",
                a: inv.id_agency,
                i: inv.agency_invoice_id,
              })
            : null,
      }));
      return res.status(201).json({
        success: true,
        complete: result.complete ?? true,
        plannedCount: result.plannedCount ?? invoices.length,
        completedCount: result.completedCount ?? invoices.length,
        requestKey: result.requestKey,
        message: result.message,
        invoices,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error interno";
      console.error("[invoices][POST]", msg);
      return res.status(500).json({ success: false, message: msg });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res
    .status(405)
    .json({ success: false, message: "Método no permitido" });
}
