// src/pages/api/users/[id].ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import bcrypt from "bcrypt";
import { jwtVerify, JWTPayload } from "jose";
import { buildUserDataMigrationPreview } from "@/services/users/userDataMigration";

/* ================== Auth Helpers ================== */

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
  role: string; // normalizado en minúscula
  email?: string;
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token; // cookie principal
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  // otros nombres posibles de cookie (defensivo)
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

function normalizeRole(r?: string) {
  return (r ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/^leader$/, "lider");
}

async function getUserFromAuth(
  req: NextApiRequest,
): Promise<DecodedAuth | null> {
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
    const role = normalizeRole(p.role);
    const email = p.email;

    // Completar faltantes desde BD
    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true },
      });
      if (!u) return null;
      return {
        id_user: u.id_user,
        id_agency: u.id_agency,
        role: normalizeRole(u.role),
        email,
      };
    }

    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (!u) return null;
      return {
        id_user,
        id_agency: u.id_agency,
        role: role || normalizeRole(u.role),
        email: email ?? u.email ?? undefined,
      };
    }

    if (!id_user || !id_agency) return null;
    return { id_user, id_agency, role: role || "", email: email ?? undefined };
  } catch {
    return null;
  }
}

/* ================== Utils ================== */

const userSafeSelect = {
  id_user: true,
  email: true,
  first_name: true,
  last_name: true,
  position: true,
  role: true,
  id_agency: true,
  creation_date: true,
} as const;

function isStrongPassword(pw: unknown): boolean {
  if (typeof pw !== "string") return false;
  if (pw.length < 8) return false;
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw); // símbolo obligatorio
  return hasLower && hasUpper && hasNumber && hasSymbol;
}

/* ================== Handler ================== */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // validar id
  const idRaw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const targetUserId = Number(idRaw);
  if (!Number.isFinite(targetUserId)) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }

  // auth
  const auth = await getUserFromAuth(req);
  if (!auth?.id_user || !auth.id_agency) {
    return res.status(401).json({ error: "No autenticado o token inválido" });
  }

  // cargar usuario target y validar agencia
  const target = await prisma.user.findUnique({
    where: { id_user: targetUserId },
    select: {
      id_user: true,
      id_agency: true,
      role: true,
      email: true,
      password: true,
    },
  });
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  if (target.id_agency !== auth.id_agency) {
    return res.status(403).json({ error: "No autorizado para este usuario" });
  }

  const role = normalizeRole(auth.role);
  const isManager = role === "gerente" || role === "desarrollador";
  const isSellerOrLeader = role === "vendedor" || role === "lider";
  const isSelf = auth.id_user === targetUserId;

  /* ========== DELETE: solo gerente/desarrollador ========== */
  if (req.method === "DELETE") {
    if (!isManager) return res.status(403).json({ error: "No autorizado" });

    try {
      const preview = await buildUserDataMigrationPreview({
        id_agency: auth.id_agency,
        source_user_id: targetUserId,
      });
      if ((preview.totalCount || 0) > 0) {
        return res.status(409).json({
          error:
            "El usuario tiene datos comerciales. Primero ejecutá una migración/asignación a otro usuario.",
        });
      }
      await prisma.userTeam.deleteMany({ where: { id_user: targetUserId } });
      await prisma.user.delete({ where: { id_user: targetUserId } });
      return res.status(200).json({ message: "Usuario eliminado con éxito" });
    } catch (error: unknown) {
      console.error("[users/:id][DELETE]", error);
      return res.status(500).json({ error: "Error al eliminar el usuario" });
    }
  }

  /* ========== PATCH: cambio de contraseña con action ========== */
  if (req.method === "PATCH") {
    const { action, oldPassword, newPassword, confirmPassword } =
      req.body ?? {};
    if (action !== "changePassword") {
      return res.status(400).json({ error: "Acción inválida" });
    }

    // Permisos:
    // - gerente/desarrollador: puede a cualquiera, sin oldPassword
    // - vendedor/líder: solo su usuario y DEBE enviar oldPassword correcto
    if (isSellerOrLeader) {
      if (!isSelf) {
        return res
          .status(403)
          .json({ error: "No autorizado: solo tu propia contraseña" });
      }
      if (typeof oldPassword !== "string" || oldPassword.length === 0) {
        return res
          .status(400)
          .json({ error: "Debes ingresar tu contraseña actual" });
      }
      const ok = await bcrypt.compare(oldPassword, target.password || "");
      if (!ok)
        return res
          .status(401)
          .json({ error: "La contraseña actual es incorrecta" });
      if (typeof newPassword === "string" && oldPassword === newPassword) {
        return res
          .status(400)
          .json({
            error: "La nueva contraseña no puede ser igual a la actual",
          });
      }
    } else if (!isManager) {
      return res.status(403).json({ error: "No autorizado" });
    }

    if (
      typeof newPassword !== "string" ||
      typeof confirmPassword !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "Debes indicar la nueva contraseña y su confirmación" });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Las contraseñas no coinciden" });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error:
          "La contraseña debe tener al menos 8 caracteres, incluir mayúscula, minúscula, número y símbolo.",
      });
    }

    try {
      const hashed = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id_user: targetUserId },
        data: { password: hashed },
      });
      // No forzamos logout aquí (según pedido). El front puede refrescar token rápidamente si lo desea.
      return res
        .status(200)
        .json({ message: "Contraseña actualizada con éxito" });
    } catch (error: unknown) {
      console.error("[users/:id][PATCH changePassword]", error);
      return res.status(500).json({ error: "Error al cambiar la contraseña" });
    }
  }

  /* ========== PUT: actualización de datos ========== */
  if (req.method === "PUT") {
    const {
      email,
      first_name,
      last_name,
      position,
      role: newRole,
      password,
    } = req.body ?? {};

    // Evitar que PUT sea usado para password (canalizamos por PATCH)
    if (typeof password === "string" && password.length > 0) {
      return res
        .status(400)
        .json({
          error:
            "Para cambiar la contraseña usa PATCH con action: 'changePassword'.",
        });
    }

    // Validaciones mínimas comunes
    if (!email || !first_name || !last_name) {
      return res.status(400).json({
        error:
          "Los campos 'email', 'first_name' y 'last_name' son obligatorios.",
      });
    }

    // Permisos de edición:
    // - vendedor/líder: solo su propio usuario y NO puede cambiar role
    // - gerente/desarrollador: puede editar a cualquiera (incluido role)
    if (isSellerOrLeader) {
      if (!isSelf) {
        return res
          .status(403)
          .json({ error: "No autorizado para editar este usuario" });
      }
      if (newRole && normalizeRole(newRole) !== normalizeRole(target.role)) {
        return res.status(403).json({ error: "No puedes cambiar tu rol" });
      }
    } else if (!isManager) {
      return res.status(403).json({ error: "No autorizado" });
    }

    try {
      // Chequeo de duplicados de email (excluyendo el propio)
      const duplicate = await prisma.user.findFirst({
        where: { email, id_user: { not: targetUserId } },
        select: { id_user: true },
      });
      if (duplicate) {
        return res
          .status(400)
          .json({ error: "Ya existe otro usuario con ese email." });
      }

      const updatedData: Partial<{
        email: string;
        first_name: string;
        last_name: string;
        position: string | null;
        role: string;
      }> = {
        email,
        first_name,
        last_name,
        position: position ?? null,
      };

      if (isManager && typeof newRole === "string" && newRole.trim()) {
        updatedData.role = normalizeRole(newRole);
      }

      const updatedUser = await prisma.user.update({
        where: { id_user: targetUserId },
        data: updatedData,
        select: userSafeSelect,
      });

      return res.status(200).json(updatedUser);
    } catch (error: unknown) {
      console.error("[users/:id][PUT]", error);
      return res.status(500).json({ error: "Error al actualizar el usuario" });
    }
  }

  res.setHeader("Allow", ["DELETE", "PUT", "PATCH"]);
  return res.status(405).end(`Método ${req.method} no permitido`);
}
