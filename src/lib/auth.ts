import type { NextApiRequest } from "next";
import { jwtVerify, type JWTPayload } from "jose";
import prisma from "@/lib/prisma";
import { normalizeRole } from "@/utils/permissions";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

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

export type AuthContext = {
  id_user: number;
  id_agency: number;
  role: string;
  email?: string;
};

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const c = req.cookies || {};
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    if (c[k]) return c[k]!;
  }
  return null;
}

export async function resolveAuth(
  req: NextApiRequest,
): Promise<AuthContext | null> {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || 0;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || 0;
    const role = normalizeRole(p.role);
    const email = p.email;

    if (id_user || email) {
      const user = await prisma.user.findFirst({
        where: id_user ? { id_user } : { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (user?.id_user && user.id_agency) {
        return {
          id_user: user.id_user,
          id_agency: user.id_agency,
          role: normalizeRole(user.role) || role,
          email: user.email ?? undefined,
        };
      }
    }

    if (id_user && id_agency) {
      return { id_user, id_agency, role, email: email ?? undefined };
    }
  } catch {
    return null;
  }

  return null;
}
