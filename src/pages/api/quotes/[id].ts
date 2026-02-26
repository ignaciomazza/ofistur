import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { decodePublicId, encodePublicId } from "@/lib/publicIds";
import {
  canAccessQuoteOwner,
  getLeaderScope,
  resolveQuoteAuth,
} from "@/lib/quotesAuth";
import {
  normalizeQuoteBookingDraft,
  normalizeQuoteCustomValues,
  normalizeQuotePaxDrafts,
  normalizeQuoteServiceDrafts,
} from "@/utils/quoteDrafts";
import { normalizeRole } from "@/utils/permissions";

type QuoteUpdateBody = {
  id_user?: number;
  lead_name?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  note?: string | null;
  booking_draft?: unknown;
  pax_drafts?: unknown;
  service_drafts?: unknown;
  custom_values?: unknown;
  pdf_draft?: unknown;
  pdf_draft_saved_at?: string | null;
  pdf_last_file_name?: string | null;
};

function cleanString(v: unknown, max = 500): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function toPositiveInt(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizePdfDraft(value: unknown): Prisma.InputJsonValue | null {
  if (!isRecord(value)) return null;
  const blocks = value.blocks;
  if (!Array.isArray(blocks)) return null;
  const layout =
    value.layout === "layoutA" ||
    value.layout === "layoutB" ||
    value.layout === "layoutC"
      ? value.layout
      : undefined;
  const payload = {
    blocks,
    layout,
    cover: isRecord(value.cover) ? value.cover : undefined,
    contact: isRecord(value.contact) ? value.contact : undefined,
    payment: isRecord(value.payment) ? value.payment : undefined,
    styles: isRecord(value.styles) ? value.styles : undefined,
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > 900_000) {
    throw new Error("El borrador PDF supera el tamaño permitido.");
  }
  return payload as Prisma.InputJsonValue;
}

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function resolveQuoteIdFromParam(
  idParam: string,
  id_agency: number,
): Promise<number | null> {
  const numeric = toPositiveInt(idParam);
  if (numeric) {
    const foundById = await prisma.quote.findFirst({
      where: { id_quote: numeric, id_agency },
      select: { id_quote: true },
    });
    if (foundById) return foundById.id_quote;

    const foundByAgencyId = await prisma.quote.findFirst({
      where: { agency_quote_id: numeric, id_agency },
      select: { id_quote: true },
    });
    if (foundByAgencyId) return foundByAgencyId.id_quote;
  }

  const decoded = decodePublicId(idParam);
  if (!decoded || decoded.t !== "quote" || decoded.a !== id_agency) return null;
  const found = await prisma.quote.findFirst({
    where: { id_agency, agency_quote_id: decoded.i },
    select: { id_quote: true },
  });
  return found?.id_quote ?? null;
}

async function ensureScope(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ authIdAgency: number; authIdUser: number; quoteId: number } | null> {
  const auth = await resolveQuoteAuth(req);
  if (!auth) {
    res.status(401).json({ error: "No autenticado" });
    return null;
  }
  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!rawId || typeof rawId !== "string") {
    res.status(400).json({ error: "ID inválido" });
    return null;
  }
  const quoteId = await resolveQuoteIdFromParam(rawId, auth.id_agency);
  if (!quoteId) {
    res.status(404).json({ error: "Cotización no encontrada" });
    return null;
  }
  const row = await prisma.quote.findUnique({
    where: { id_quote: quoteId },
    select: { id_user: true, id_agency: true },
  });
  if (!row || row.id_agency !== auth.id_agency) {
    res.status(404).json({ error: "Cotización no encontrada" });
    return null;
  }
  const allowed = await canAccessQuoteOwner(auth, row.id_user);
  if (!allowed) {
    res.status(403).json({ error: "No autorizado." });
    return null;
  }
  return { authIdAgency: auth.id_agency, authIdUser: auth.id_user, quoteId };
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const scope = await ensureScope(req, res);
  if (!scope) return;
  try {
    const quote = await prisma.quote.findUnique({
      where: { id_quote: scope.quoteId },
      include: {
        user: {
          select: { id_user: true, first_name: true, last_name: true, role: true },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: "Cotización no encontrada" });

    const public_id =
      quote.agency_quote_id != null
        ? encodePublicId({
            t: "quote",
            a: quote.id_agency,
            i: quote.agency_quote_id,
          })
        : null;
    return res.status(200).json({ ...quote, public_id });
  } catch (error) {
    console.error("[quotes/:id][GET]", error);
    return res.status(500).json({ error: "Error obteniendo cotización" });
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  const auth = await resolveQuoteAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });
  const scope = await ensureScope(req, res);
  if (!scope) return;

  try {
    const body = (req.body ?? {}) as QuoteUpdateBody;
    const data: Prisma.QuoteUpdateInput = {};

    if (body.lead_name !== undefined) {
      data.lead_name = cleanString(body.lead_name, 120) ?? null;
    }
    if (body.lead_phone !== undefined) {
      data.lead_phone = cleanString(body.lead_phone, 60) ?? null;
    }
    if (body.lead_email !== undefined) {
      data.lead_email = cleanString(body.lead_email, 120) ?? null;
    }
    if (body.note !== undefined) {
      data.note = cleanString(body.note, 4000) ?? null;
    }
    if (body.booking_draft !== undefined) {
      data.booking_draft = normalizeQuoteBookingDraft(
        body.booking_draft,
      ) as Prisma.InputJsonValue;
    }
    if (body.pax_drafts !== undefined) {
      data.pax_drafts = normalizeQuotePaxDrafts(
        body.pax_drafts,
      ) as Prisma.InputJsonValue;
    }
    if (body.service_drafts !== undefined) {
      data.service_drafts = normalizeQuoteServiceDrafts(
        body.service_drafts,
      ) as Prisma.InputJsonValue;
    }
    if (body.custom_values !== undefined) {
      data.custom_values = normalizeQuoteCustomValues(
        body.custom_values,
      ) as Prisma.InputJsonValue;
    }
    if (body.pdf_draft !== undefined) {
      const draft = sanitizePdfDraft(body.pdf_draft);
      data.pdf_draft = draft ?? Prisma.DbNull;
    }
    if (body.pdf_draft_saved_at !== undefined) {
      data.pdf_draft_saved_at = parseDateOrNull(body.pdf_draft_saved_at);
    }
    if (body.pdf_last_file_name !== undefined) {
      data.pdf_last_file_name = cleanString(body.pdf_last_file_name, 180) ?? null;
    }

    const role = normalizeRole(auth.role);
    const canAssignOthers = [
      "gerente",
      "administrativo",
      "desarrollador",
      "lider",
    ].includes(role);

    if (canAssignOthers && toPositiveInt(body.id_user)) {
      const target = toPositiveInt(body.id_user)!;
      if (role === "lider" && target !== auth.id_user) {
        const scopeUsers = await getLeaderScope(auth.id_user, auth.id_agency);
        if (!scopeUsers.userIds.includes(target)) {
          return res
            .status(403)
            .json({ error: "No podés asignar fuera de tu equipo." });
        }
      }
      const targetUser = await prisma.user.findFirst({
        where: { id_user: target, id_agency: auth.id_agency },
        select: { id_user: true },
      });
      if (!targetUser) {
        return res
          .status(400)
          .json({ error: "Usuario inválido para esta agencia." });
      }
      data.user = { connect: { id_user: target } };
    }

    const updated = await prisma.quote.update({
      where: { id_quote: scope.quoteId },
      data,
      include: {
        user: {
          select: { id_user: true, first_name: true, last_name: true, role: true },
        },
      },
    });
    const public_id =
      updated.agency_quote_id != null
        ? encodePublicId({
            t: "quote",
            a: updated.id_agency,
            i: updated.agency_quote_id,
          })
        : null;
    return res.status(200).json({ ...updated, public_id });
  } catch (error) {
    console.error("[quotes/:id][PUT]", error);
    return res.status(500).json({ error: "Error actualizando cotización" });
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  const scope = await ensureScope(req, res);
  if (!scope) return;
  try {
    await prisma.quote.delete({ where: { id_quote: scope.quoteId } });
    return res.status(200).json({ message: "Cotización eliminada con éxito." });
  } catch (error) {
    console.error("[quotes/:id][DELETE]", error);
    return res.status(500).json({ error: "Error eliminando cotización" });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "PUT") return handlePut(req, res);
  if (req.method === "DELETE") return handleDelete(req, res);
  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
