import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { encodePublicId } from "@/lib/publicIds";
import {
  getLeaderScope,
  isQuoteAdminRole,
  resolveQuoteAuth,
} from "@/lib/quotesAuth";
import {
  normalizeQuoteBookingDraft,
  normalizeQuoteCustomValues,
  normalizeQuotePaxDrafts,
  normalizeQuoteServiceDrafts,
} from "@/utils/quoteDrafts";
import { normalizeRole } from "@/utils/permissions";

type QuoteCreateBody = {
  id_user?: number;
  lead_name?: string;
  lead_phone?: string;
  lead_email?: string;
  note?: string;
  booking_draft?: unknown;
  pax_drafts?: unknown;
  service_drafts?: unknown;
  custom_values?: unknown;
  pdf_draft?: unknown;
  pdf_draft_saved_at?: string | null;
  pdf_last_file_name?: string | null;
};

type QuoteStatusScope = "active" | "converted" | "all";

function toPositiveInt(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

function cleanString(v: unknown, max = 500): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatusScope(value: unknown): QuoteStatusScope {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "converted") return "converted";
  if (normalized === "all") return "all";
  return "active";
}

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const auth = await resolveQuoteAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  try {
    const takeRaw = Array.isArray(req.query.take)
      ? req.query.take[0]
      : req.query.take;
    const take = Math.min(Math.max(Number(takeRaw) || 20, 1), 100);
    const cursorRaw = Array.isArray(req.query.cursor)
      ? req.query.cursor[0]
      : req.query.cursor;
    const cursor = toPositiveInt(cursorRaw);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const role = normalizeRole(auth.role);
    const isAdmin = isQuoteAdminRole(role);

    const userId = toPositiveInt(
      Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId,
    );
    const teamIdRaw = Array.isArray(req.query.teamId)
      ? req.query.teamId[0]
      : req.query.teamId;
    const teamId = Number(teamIdRaw || 0);
    const statusScope = normalizeStatusScope(
      Array.isArray(req.query.status_scope)
        ? req.query.status_scope[0]
        : req.query.status_scope,
    );

    const where: Prisma.QuoteWhereInput = { id_agency: auth.id_agency };
    if (statusScope !== "all") {
      where.quote_status = statusScope;
    }

    let leaderTeamIds: number[] = [];
    let leaderUserIds: number[] = [];

    if (!isAdmin) {
      if (role === "vendedor") {
        if (userId && userId !== auth.id_user) {
          return res.status(403).json({ error: "No autorizado." });
        }
        if (teamId !== 0) {
          return res.status(403).json({ error: "No autorizado." });
        }
        where.id_user = auth.id_user;
      } else if (role === "lider") {
        const scope = await getLeaderScope(auth.id_user, auth.id_agency);
        leaderTeamIds = scope.teamIds;
        leaderUserIds = scope.userIds;

        if (userId && !leaderUserIds.includes(userId)) {
          return res
            .status(403)
            .json({ error: "No autorizado: usuario fuera de tu equipo." });
        }
        if (teamId > 0 && !leaderTeamIds.includes(teamId)) {
          return res
            .status(403)
            .json({ error: "No autorizado: equipo fuera de tu alcance." });
        }
        if (teamId === -1) {
          return res.status(403).json({
            error: "No autorizado: 'sin equipo' no disponible para líderes.",
          });
        }
      } else {
        where.id_user = auth.id_user;
      }
    }

    if (userId && isAdmin) {
      where.id_user = userId;
    }
    if (userId && role === "lider") {
      where.id_user = userId;
    }

    if (!userId && teamId !== 0 && role !== "vendedor") {
      if (teamId > 0) {
        const team = await prisma.salesTeam.findUnique({
          where: { id_team: teamId },
          include: { user_teams: { select: { id_user: true } } },
        });
        if (!team || team.id_agency !== auth.id_agency) {
          return res
            .status(403)
            .json({ error: "Equipo inválido para esta agencia." });
        }
        const ids = team.user_teams.map((ut) => ut.id_user);
        where.id_user = { in: ids.length ? ids : [-1] };
      } else if (teamId === -1 && isAdmin) {
        const users = await prisma.user.findMany({
          where: { id_agency: auth.id_agency, sales_teams: { none: {} } },
          select: { id_user: true },
        });
        where.id_user = { in: users.map((u) => u.id_user) };
      }
    }

    if (!where.id_user && role === "lider") {
      where.id_user = { in: leaderUserIds.length ? leaderUserIds : [auth.id_user] };
    }

    if (q) {
      const numeric = Number(q);
      const or: Prisma.QuoteWhereInput[] = [];
      if (Number.isFinite(numeric)) {
        const qNum = Math.trunc(numeric);
        or.push({ id_quote: qNum }, { agency_quote_id: qNum });
      }
      or.push(
        { lead_name: { contains: q, mode: "insensitive" } },
        { lead_phone: { contains: q, mode: "insensitive" } },
        { lead_email: { contains: q, mode: "insensitive" } },
        { note: { contains: q, mode: "insensitive" } },
      );
      where.AND = [
        ...(Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : []),
        { OR: or },
      ];
    }

    const orderBy: Prisma.QuoteOrderByWithRelationInput[] = [
      { creation_date: "desc" },
      { id_quote: "desc" },
    ];

    let keysetWhere: Prisma.QuoteWhereInput | undefined = undefined;
    if (cursor) {
      const anchor = await prisma.quote.findUnique({
        where: { id_quote: cursor },
        select: { creation_date: true },
      });
      if (anchor) {
        keysetWhere = {
          OR: [
            { creation_date: { lt: anchor.creation_date } },
            {
              AND: [
                { creation_date: anchor.creation_date },
                { id_quote: { lt: cursor } },
              ],
            },
          ],
        };
      }
    }

    const baseAnd = Array.isArray(where.AND)
      ? where.AND
      : where.AND
        ? [where.AND]
        : [];
    const finalWhere: Prisma.QuoteWhereInput = keysetWhere
      ? { ...where, AND: [...baseAnd, keysetWhere] }
      : where;

    const rows = await prisma.quote.findMany({
      where: finalWhere,
      include: {
        user: {
          select: { id_user: true, first_name: true, last_name: true, role: true },
        },
      },
      orderBy,
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id_quote : null;

    const enhanced = items.map((item) => ({
      ...item,
      public_id:
        item.agency_quote_id != null
          ? encodePublicId({
              t: "quote",
              a: item.id_agency,
              i: item.agency_quote_id,
            })
          : null,
    }));

    return res.status(200).json({ items: enhanced, nextCursor });
  } catch (error) {
    console.error("[quotes][GET]", error);
    return res.status(500).json({ error: "Error obteniendo cotizaciones" });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const auth = await resolveQuoteAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  try {
    const body = (req.body ?? {}) as QuoteCreateBody;
    const role = normalizeRole(auth.role);
    const canAssignOthers = [
      "gerente",
      "administrativo",
      "desarrollador",
      "lider",
    ].includes(role);
    let usedUserId = auth.id_user;

    if (canAssignOthers && toPositiveInt(body.id_user)) {
      const requestedUser = toPositiveInt(body.id_user)!;
      if (role === "lider" && requestedUser !== auth.id_user) {
        const scope = await getLeaderScope(auth.id_user, auth.id_agency);
        if (!scope.userIds.includes(requestedUser)) {
          return res
            .status(403)
            .json({ error: "No podés asignar fuera de tu equipo." });
        }
      }

      const targetUser = await prisma.user.findFirst({
        where: { id_user: requestedUser, id_agency: auth.id_agency },
        select: { id_user: true },
      });
      if (!targetUser) {
        return res
          .status(400)
          .json({ error: "Usuario inválido para esta agencia." });
      }
      usedUserId = requestedUser;
    }

    const bookingDraft = normalizeQuoteBookingDraft(body.booking_draft);
    const paxDrafts = normalizeQuotePaxDrafts(body.pax_drafts);
    const serviceDrafts = normalizeQuoteServiceDrafts(body.service_drafts);
    const customValues = normalizeQuoteCustomValues(body.custom_values);
    const pdfDraft = sanitizePdfDraft(body.pdf_draft);
    const pdfDraftSavedAt = parseDateOrNull(body.pdf_draft_saved_at);
    const pdfLastFileName = cleanString(body.pdf_last_file_name, 180) ?? null;

    const created = await prisma.$transaction(async (tx) => {
      const agencyQuoteId = await getNextAgencyCounter(
        tx,
        auth.id_agency,
        "quote",
      );
      return tx.quote.create({
        data: {
          agency_quote_id: agencyQuoteId,
          id_agency: auth.id_agency,
          id_user: usedUserId,
          lead_name: cleanString(body.lead_name, 120) ?? null,
          lead_phone: cleanString(body.lead_phone, 60) ?? null,
          lead_email: cleanString(body.lead_email, 120) ?? null,
          note: cleanString(body.note, 4000) ?? null,
          booking_draft: bookingDraft as Prisma.InputJsonValue,
          pax_drafts: paxDrafts as Prisma.InputJsonValue,
          service_drafts: serviceDrafts as Prisma.InputJsonValue,
          custom_values: customValues as Prisma.InputJsonValue,
          quote_status: "active",
          pdf_draft: pdfDraft ?? undefined,
          pdf_draft_saved_at: pdfDraftSavedAt,
          pdf_last_file_name: pdfLastFileName,
        },
        include: {
          user: {
            select: { id_user: true, first_name: true, last_name: true, role: true },
          },
        },
      });
    });

    const public_id =
      created.agency_quote_id != null
        ? encodePublicId({
            t: "quote",
            a: created.id_agency,
            i: created.agency_quote_id,
          })
        : null;

    return res.status(201).json({ ...created, public_id });
  } catch (error) {
    console.error("[quotes][POST]", error);
    return res.status(500).json({ error: "Error creando cotización" });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
