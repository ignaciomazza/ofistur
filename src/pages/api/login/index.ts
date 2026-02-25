// src/pages/api/login/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import bcrypt from "bcrypt";
import { SignJWT } from "jose";

/* ================== Config ================== */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

function normalizeRole(r?: string) {
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
}

/* ================== Handler ================== */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { email: rawEmail, password } = req.body ?? {};
    const email = String(rawEmail ?? "")
      .trim()
      .toLowerCase();

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email y contraseña son obligatorios" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const isPasswordValid = await bcrypt.compare(
      String(password),
      user.password,
    );
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // Payload consistente con el resto de la API
    const claims = {
      id_user: user.id_user,
      id_agency: user.id_agency,
      role: normalizeRole(user.role),
      email: user.email,
    };

    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(new TextEncoder().encode(JWT_SECRET));

    // Cookie segura (HttpOnly) y compatible con fetch credentials: "include"
    // Max-Age 12h (43200s). SameSite=Lax para navegación normal.
    const cookieParts = [
      `token=${token}`,
      "HttpOnly",
      "Path=/",
      "SameSite=Lax",
      "Max-Age=43200",
    ];
    if (process.env.NODE_ENV === "production") cookieParts.push("Secure");

    res.setHeader("Set-Cookie", cookieParts.join("; "));

    return res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("[login][POST]", error);
    return res.status(500).json({ error: "Error al iniciar sesión" });
  }
}
