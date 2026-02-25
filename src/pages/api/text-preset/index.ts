// src/pages/api/text-preset/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma, { Prisma } from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { jwtVerify } from "jose";
import type { JWTPayload } from "jose";

// ============ Tipos ============
type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  role?: string;
  email?: string;
};

type DecodedAuth = {
  id_user: number;
  id_agency: number;
  role?: string;
  email?: string;
};

type CreateBody = {
  title?: string;
  content?: string;
  doc_type?: string; // "quote" | "confirmation" | "voucher" | "quote_budget"
  data?: unknown; // NEW: formulario entero serializado
};

// ============ JWT ============
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

// ============ Helpers comunes ============
function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const a = req.headers.authorization || "";
  if (a.startsWith("Bearer ")) return a.slice(7);
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
): Promise<DecodedAuth | null> {
  try {
    const tok = getTokenFromRequest(req);
    if (!tok) return null;

    const { payload } = await jwtVerify(
      tok,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    let id_user = Number(p.id_user ?? p.userId ?? p.uid) || undefined;
    let id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    const role = (p.role || "") as string | undefined;
    const email = p.email;

    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (u) {
        id_user = u.id_user;
        id_agency = u.id_agency;
      }
    }
    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u) id_agency = u.id_agency;
    }

    if (!id_user || !id_agency) return null;
    return { id_user, id_agency, role, email: email ?? undefined };
  } catch {
    return null;
  }
}

function safeNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeDocType(
  v?: string,
): "quote" | "confirmation" | "voucher" | "quote_budget" | undefined {
  const s = (v || "").trim().toLowerCase();
  if (
    s === "quote" ||
    s === "confirmation" ||
    s === "voucher" ||
    s === "quote_budget"
  ) {
    return s;
  }
  return undefined;
}

// ============ GET ============
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getUserFromAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  try {
    const takeParam = safeNumber(
      Array.isArray(req.query.take) ? req.query.take[0] : req.query.take,
    );
    const take = Math.min(Math.max(takeParam || 24, 1), 100);

    const cursorParam = safeNumber(
      Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor,
    );
    const cursor = cursorParam;

    // Acepta docType o doc_type
    const docTypeRaw =
      typeof req.query.docType === "string"
        ? req.query.docType
        : typeof req.query.doc_type === "string"
          ? req.query.doc_type
          : Array.isArray(req.query.docType)
            ? req.query.docType[0]
            : Array.isArray(req.query.doc_type)
              ? req.query.doc_type[0]
              : undefined;

    const docType = normalizeDocType(docTypeRaw);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: Prisma.TextPresetWhereInput = {
      id_user: auth.id_user,
      id_agency: auth.id_agency,
      ...(docType ? { doc_type: docType } : {}),
    };

    if (q) {
      const prev = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [
        ...prev,
        {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { content: { contains: q, mode: "insensitive" } },
          ],
        },
      ];
    }

    const items = await prisma.textPreset.findMany({
      where,
      orderBy: { id_preset: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id_preset: cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > take;
    const sliced = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id_preset : null;

    return res.status(200).json({ items: sliced, nextCursor });
  } catch (e) {
    console.error("[text-preset][GET]", e);
    return res.status(500).json({ error: "Error al obtener presets" });
  }
}

// ============ POST ============
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const auth = await getUserFromAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  try {
    const body = (req.body ?? {}) as CreateBody;

    const title = String(body.title ?? "").trim();
    const doc_type = normalizeDocType(body.doc_type);
    const content =
      body.content !== undefined ? String(body.content ?? "") : undefined; // puede ser ""
    const data = body.data ?? undefined; // NEW

    // NEW: validación flexible – al menos uno de content o data
    if (!title || !doc_type || (content === undefined && data === undefined)) {
      return res.status(400).json({
        error:
          "title y doc_type son obligatorios; además enviá 'content' o 'data'",
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const agencyPresetId = await getNextAgencyCounter(
        tx,
        auth.id_agency,
        "text_preset",
      );
      return tx.textPreset.create({
        data: {
          title,
          content: content ?? "", // permitimos vacío si solo usan data
          data, // NEW
          doc_type,
          id_user: auth.id_user,
          id_agency: auth.id_agency,
          agency_text_preset_id: agencyPresetId,
        },
      });
    });

    return res.status(201).json(created);
  } catch (e: unknown) {
    console.error("[text-preset][POST]", e);
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return res.status(400).json({
        error: "Ya existe un preset con ese título para este tipo de documento",
      });
    }
    return res.status(500).json({ error: "Error al crear preset" });
  }
}

// ============ Router ============
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") return handleGet(req, res);
  if (req.method === "POST") return handlePost(req, res);
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
