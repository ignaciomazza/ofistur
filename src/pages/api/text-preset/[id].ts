// src/pages/api/text-preset/[id].ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { jwtVerify } from "jose";
import type { JWTPayload } from "jose";

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

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

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
    const role = p.role ? String(p.role) : undefined;
    const email = p.email;

    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true },
      });
      if (u) {
        id_user = u.id_user;
        id_agency = id_agency ?? u.id_agency;
      }
    }
    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true },
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const auth = await getUserFromAuth(req);
  if (!auth) return res.status(401).json({ error: "No autenticado" });

  const idRaw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = safeNumber(idRaw);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  // GET
  if (req.method === "GET") {
    try {
      const preset = await prisma.textPreset.findUnique({
        where: { id_preset: id },
      });
      if (!preset)
        return res.status(404).json({ error: "Preset no encontrado" });
      if (
        preset.id_agency !== auth.id_agency ||
        preset.id_user !== auth.id_user
      ) {
        return res
          .status(403)
          .json({ error: "No autorizado para este preset" });
      }
      return res.status(200).json(preset);
    } catch (e) {
      console.error("[text-preset/:id][GET]", e);
      return res.status(500).json({ error: "Error al obtener el preset" });
    }
  }

  // DELETE
  if (req.method === "DELETE") {
    try {
      const existing = await prisma.textPreset.findUnique({
        where: { id_preset: id },
        select: { id_preset: true, id_user: true, id_agency: true },
      });
      if (!existing)
        return res.status(404).json({ error: "Preset no encontrado" });
      if (
        existing.id_agency !== auth.id_agency ||
        existing.id_user !== auth.id_user
      ) {
        return res
          .status(403)
          .json({ error: "No autorizado para eliminar este preset" });
      }

      await prisma.textPreset.delete({ where: { id_preset: id } });
      return res.status(204).end();
    } catch (e) {
      console.error("[text-preset/:id][DELETE]", e);
      return res.status(500).json({ error: "Error al eliminar el preset" });
    }
  }

  res.setHeader("Allow", ["GET", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
