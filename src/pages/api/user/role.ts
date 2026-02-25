// src/pages/api/user/role.ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { jwtVerify, JWTPayload } from "jose";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  email?: string;
};

const normalizeRole = (r?: string) => {
  const normalized = (r ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
  if (!normalized) return "";
  if (normalized.startsWith("vendedor")) return "vendedor";
  if (normalized.startsWith("lider") || normalized === "leader") {
    return "lider";
  }
  if (normalized.startsWith("gerent")) return "gerente";
  if (normalized === "admin" || normalized.startsWith("administr")) {
    return "administrativo";
  }
  if (["dev", "developer"].includes(normalized)) return "desarrollador";
  if (normalized.startsWith("desarrollador")) return "desarrollador";
  return normalized;
};

const getTokenFromRequest = (req: NextApiRequest): string | null => {
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
    const v = c[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Método ${req.method} no permitido`);
  }

  res.setHeader("Cache-Control", "no-store");

  const token = getTokenFromRequest(req);
  if (!token) {
    res.setHeader("x-auth-reason", "no-token");
    return res.status(401).json({ error: "No autenticado" });
  }

  let payload: TokenPayload;
  try {
    const out = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    payload = out.payload as TokenPayload;
  } catch {
    res.setHeader("x-auth-reason", "invalid-token");
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  // ✅ Fast-path: si el JWT ya trae role, devolvémoslo sin ir a DB
  if (payload.role) {
    return res.status(200).json({ role: normalizeRole(payload.role) });
  }

  // Fallback: buscar por id_user o email
  try {
    const id_user =
      Number(payload.id_user ?? payload.userId ?? payload.uid) || null;
    const email = payload.email ?? null;

    const user = id_user
      ? await prisma.user.findUnique({
          where: { id_user },
          select: { role: true },
        })
      : email
        ? await prisma.user.findUnique({
            where: { email },
            select: { role: true },
          })
        : null;

    if (!user) {
      res.setHeader("x-auth-reason", "user-not-found");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.status(200).json({ role: normalizeRole(user.role) });
  } catch (err) {
    console.error("[user/role][GET]", err);
    res.setHeader("x-auth-reason", "db-error");
    // 503 para que el front NO asuma logout por esto
    return res.status(503).json({ error: "Error al obtener rol" });
  }
}
