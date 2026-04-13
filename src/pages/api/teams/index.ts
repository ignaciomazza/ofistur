// src/pages/api/teams/index.ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { resolveAuth } from "@/lib/auth";

const MANAGER_ROLES = new Set(["desarrollador", "gerente"]);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const auth = await resolveAuth(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    const canManage = MANAGER_ROLES.has(auth.role);

    // ---------------------------
    // GET /api/teams?agencyId=...
    // ---------------------------
    if (req.method === "GET") {
      // 1) Leemos agencyId desde la query string
      const agencyId = Array.isArray(req.query.agencyId)
        ? Number(req.query.agencyId[0])
        : req.query.agencyId
          ? Number(req.query.agencyId)
          : null;

      if (agencyId && agencyId !== auth.id_agency) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      const where = {
        id_agency: auth.id_agency,
        ...(!canManage
          ? {
              user_teams: { some: { id_user: auth.id_user } },
            }
          : {}),
      };

      // 2) Recuperamos solo los equipos de esa agencia
      const teams = await prisma.salesTeam.findMany({
        where,
        include: {
          user_teams: { include: { user: true } },
        },
      });

      return res.status(200).json(teams);
    }

    // ---------------------------
    // POST /api/teams
    // ---------------------------
    if (req.method === "POST") {
      if (!canManage) {
        return res.status(403).json({ error: "Sin permisos" });
      }
      const { name, userIds, id_agency } = req.body;

      // 1) Validaciones
      if (!name) {
        return res
          .status(400)
          .json({ error: "El nombre del equipo es obligatorio." });
      }
      if (!Array.isArray(userIds)) {
        return res
          .status(400)
          .json({ error: "Los userIds deben ser un arreglo." });
      }
      if (new Set(userIds).size !== userIds.length) {
        return res
          .status(400)
          .json({ error: "No se permiten IDs duplicados en los miembros." });
      }
      if (typeof id_agency === "number" && id_agency !== auth.id_agency) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      const members = await prisma.user.findMany({
        where: { id_user: { in: userIds }, id_agency: auth.id_agency },
        select: { id_user: true },
      });
      if (members.length !== userIds.length) {
        return res.status(400).json({
          error: "Hay usuarios que no pertenecen a tu agencia.",
        });
      }

      // 2) Creamos el equipo para la agencia indicada
      const newTeam = await prisma.$transaction(async (tx) => {
        const agencyTeamId = await getNextAgencyCounter(
          tx,
          auth.id_agency,
          "sales_team",
        );
        return tx.salesTeam.create({
          data: {
            name,
            id_agency: auth.id_agency,
            agency_sales_team_id: agencyTeamId,
            user_teams: {
              create: userIds.map((userId: number) => ({
                user: { connect: { id_user: userId } },
              })),
            },
          },
          include: {
            user_teams: { include: { user: true } },
          },
        });
      });

      return res.status(201).json(newTeam);
    }

    // Métodos no permitidos
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    console.error(
      "Error en /api/teams:",
      error instanceof Error ? error.message : error,
    );
    return res.status(500).json({ error: "Error interno" });
  }
}
