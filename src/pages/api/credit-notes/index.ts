// src/pages/api/credit-notes/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { listCreditNotes, createCreditNote } from "@/services/creditNotes";
import type { CreditNoteWithItems } from "@/services/creditNotes";
import { jwtVerify, type JWTPayload } from "jose";
import { encodePublicId } from "@/lib/publicIds";
import {
  canAccessBookingByRole,
  getBookingComponentGrants,
} from "@/lib/accessControl";
import { canAccessBookingComponent } from "@/utils/permissions";
import { refreshIssuerRegime } from "@/services/arca/regimeMonitor";

/* ================= JWT SECRET (igual que bookings/invoices) ================= */
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

/* ================= Helpers de auth (mismo patrón que bookings) ================= */
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

// invoiceId puede venir como "123" o ["123"]
const querySchema = z.object({
  invoiceId: z.preprocess(
    (v) => (Array.isArray(v) ? v[0] : v),
    z.coerce.number().int().positive("invoiceId debe ser un número positivo"),
  ),
});

// bookingId puede venir como "123" o ["123"]
const bookingQuerySchema = z.object({
  bookingId: z.preprocess(
    (v) => (Array.isArray(v) ? v[0] : v),
    z.coerce.number().int().positive("bookingId debe ser un número positivo"),
  ),
});

const bodySchema = z.object({
  invoiceId: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, "invoiceId inválido"),
  tipoNota: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => n === 3 || n === 8, "tipoNota debe ser 3 o 8"),
  exchangeRate: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null ? undefined : Number(v)))
    .refine((n) => n == null || (typeof n === "number" && n > 0), {
      message: "exchangeRate debe ser un número positivo",
    }),
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
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)")
    .optional(),
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
      const authUser = auth as DecodedUser;

      // rango de fechas (opcional)
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

        const creditNotes = await prisma.creditNote.findMany({
          where: {
            AND: [
              {
                payloadAfip: {
                  path: ["CbteFch"], // AAAAMMDD numérico almacenado en JSON
                  gte: fromInt,
                  lte: toInt,
                },
              },
              // Solo NC de facturas cuya reserva es de la agencia del usuario
              { invoice: { booking: { id_agency: auth.id_agency } } },
            ],
          },
          include: {
            items: true,
            invoice: {
              include: {
                booking: { include: { titular: true } },
                client: {
                  select: {
                    address: true,
                    locality: true,
                    postal_code: true,
                  },
                },
              },
            },
          },
        });

        const normalized = creditNotes.map((note) => {
          const booking = note.invoice?.booking;
          const bookingPublicId =
            booking?.agency_booking_id != null
              ? encodePublicId({
                  t: "booking",
                  a: booking.id_agency,
                  i: booking.agency_booking_id,
                })
              : null;

          return {
            ...note,
            public_id:
              note.agency_credit_note_id != null
                ? encodePublicId({
                    t: "credit_note",
                    a: note.id_agency,
                    i: note.agency_credit_note_id,
                  })
                : null,
            invoice: note.invoice
              ? {
                  ...note.invoice,
                  booking: booking
                    ? { ...booking, public_id: bookingPublicId }
                    : booking,
                }
              : note.invoice,
          };
        });

        return res.status(200).json({ success: true, creditNotes: normalized });
      }

      const bookingIdParam = req.query.bookingId;
      if (bookingIdParam !== undefined) {
        const parsedB = bookingQuerySchema.safeParse({
          bookingId: bookingIdParam,
        });
        if (!parsedB.success) {
          return res.status(400).json({
            success: false,
            message: parsedB.error.errors.map((e) => e.message).join(", "),
          });
        }
        const bookingId = parsedB.data.bookingId;
        const booking = await prisma.booking.findFirst({
          where: { id_booking: bookingId, id_agency: auth.id_agency },
          select: { id_booking: true, id_user: true, id_agency: true },
        });
        if (!booking) {
          return res.status(403).json({
            success: false,
            message: "La reserva no pertenece a tu agencia.",
          });
        }
        const canReadByRole = await canAccessBookingByRole(
          authUser,
          booking,
        );
        if (!canBilling && !canReadByRole) {
          return res
            .status(403)
            .json({ success: false, message: "Sin permisos" });
        }

        const creditNotes = await prisma.creditNote.findMany({
          where: {
            id_agency: auth.id_agency,
            invoice: { bookingId_booking: bookingId },
          },
          include: { items: true },
        });
        const normalized = creditNotes.map((note) => ({
          ...note,
          public_id:
            note.agency_credit_note_id != null
              ? encodePublicId({
                  t: "credit_note",
                  a: note.id_agency,
                  i: note.agency_credit_note_id,
                })
              : null,
        }));
        return res.status(200).json({ success: true, creditNotes: normalized });
      }

      // por invoiceId
      const parsedQ = querySchema.safeParse({ invoiceId: req.query.invoiceId });
      if (!parsedQ.success) {
        return res.status(400).json({
          success: false,
          message: parsedQ.error.errors.map((e) => e.message).join(", "),
        });
      }
      const invoiceId = parsedQ.data.invoiceId; // number garantizado

      // validar pertenencia de la factura a la agencia
      const belongs = await prisma.invoice.findFirst({
        where: {
          id_invoice: invoiceId,
          booking: { id_agency: auth.id_agency },
        },
        select: {
          id_invoice: true,
          booking: { select: { id_user: true, id_agency: true } },
        },
      });
      if (!belongs) {
        return res
          .status(403)
          .json({
            success: false,
            message: "La factura no pertenece a tu agencia.",
          });
      }
      const canReadByRole = await canAccessBookingByRole(
        auth,
        belongs.booking ?? { id_user: 0, id_agency: 0 },
      );
      if (!canBilling && !canReadByRole) {
        return res.status(403).json({ success: false, message: "Sin permisos" });
      }

      const creditNotes: CreditNoteWithItems[] =
        await listCreditNotes(invoiceId);
      const normalized = creditNotes.map((note) => ({
        ...note,
        public_id:
          note.agency_credit_note_id != null
            ? encodePublicId({
                t: "credit_note",
                a: note.id_agency,
                i: note.agency_credit_note_id,
              })
            : null,
      }));
      return res.status(200).json({ success: true, creditNotes: normalized });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error interno";
      console.error("[credit-notes][GET]", msg);
      return res.status(500).json({ success: false, message: msg });
    }
  }

  /* ---------- POST ---------- */
  if (req.method === "POST") {
    const parsedB = bodySchema.safeParse(req.body);
    if (!parsedB.success) {
      return res.status(400).json({
        success: false,
        message: parsedB.error.errors.map((e) => e.message).join(", "),
      });
    }

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
      if (!canBilling) {
        return res.status(403).json({ success: false, message: "Sin permisos" });
      }

      // seguridad: la NC solo se crea sobre una factura de la misma agencia
      const invoiceOk = await prisma.invoice.findFirst({
        where: {
          id_invoice: parsedB.data.invoiceId,
          booking: { id_agency: auth.id_agency },
        },
        select: { id_invoice: true },
      });
      if (!invoiceOk) {
        return res
          .status(403)
          .json({
            success: false,
            message: "La factura no pertenece a tu agencia.",
          });
      }

      await refreshIssuerRegime(auth.id_agency);
      const issuer = await prisma.agencyArcaConfig.findUnique({
        where: { agencyId: auth.id_agency },
        select: { status: true, taxRegime: true, observedTaxRegime: true, taxRegimeCheckedAt: true, authorizedServices: true },
      });
      const stale = issuer?.authorizedServices.includes("ws_sr_constancia_inscripcion") &&
        (!issuer.taxRegimeCheckedAt || Date.now() - issuer.taxRegimeCheckedAt.getTime() >= 24 * 60 * 60 * 1000);
      if (issuer?.status === "disconnected" || issuer?.status === "error" || stale || issuer?.taxRegime === "mono" ||
          (issuer?.taxRegime && issuer.observedTaxRegime && issuer.taxRegime !== issuer.observedTaxRegime)) {
        return res.status(409).json({
          success: false,
          message: "El régimen fiscal actual no permite emitir esta nota de crédito automáticamente. Revisá la conexión ARCA o solicitá asistencia para corregir el comprobante histórico.",
        });
      }

      const { invoiceId, tipoNota, exchangeRate, invoiceDate, manualTotals } =
        parsedB.data;

      // Pasamos el req para inicializar AFIP con la agencia correcta
      const result = await createCreditNote(req, {
        invoiceId,
        tipoNota: tipoNota as 3 | 8,
        exchangeRate,
        invoiceDate,
        manualTotals,
      });

      if (!result.success) {
        return res
          .status(400)
          .json({ success: false, message: result.message });
      }
      const public_id =
        result.creditNote?.agency_credit_note_id != null
          ? encodePublicId({
              t: "credit_note",
              a: result.creditNote.id_agency,
              i: result.creditNote.agency_credit_note_id,
            })
          : null;
      return res.status(201).json({
        success: true,
        creditNote: result.creditNote
          ? { ...result.creditNote, public_id }
          : result.creditNote,
        items: result.items,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error interno";
      console.error("[credit-notes][POST]", msg);
      return res.status(500).json({ success: false, message: msg });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res
    .status(405)
    .json({ success: false, message: "Método no permitido" });
}
