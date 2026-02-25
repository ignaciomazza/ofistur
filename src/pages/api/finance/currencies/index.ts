// src/pages/api/finance/currencies/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { z } from "zod";
import { resolveAuth } from "@/lib/auth";
import { getFinancePicksAccess } from "@/lib/accessControl";

const createSchema = z.object({
  code: z.string().trim().min(2).max(6),
  name: z.string().trim().min(2),
  symbol: z.string().trim().min(1).max(4),
  enabled: z.boolean().optional().default(true),
  is_primary: z.boolean().optional().default(false),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const auth = await resolveAuth(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  const { canRead, canWrite } = await getFinancePicksAccess(
    auth.id_agency,
    auth.id_user,
    auth.role,
  );

  if (req.method === "GET") {
    try {
      const canReadForServiceUsers = [
        "vendedor",
        "lider",
        "equipo",
        "marketing",
      ].includes(auth.role);
      if (!canRead && !canReadForServiceUsers) {
        return res.status(403).json({ error: "Sin permisos" });
      }

      const items = await prisma.financeCurrency.findMany({
        where: { id_agency: auth.id_agency },
        orderBy: [{ is_primary: "desc" }, { code: "asc" }],
      });
      return res.status(200).json(items);
    } catch (e) {
      console.error("[finance/currencies][GET]", reqId, e);
      return res.status(500).json({ error: "Error obteniendo monedas" });
    }
  }

  if (req.method === "POST") {
    try {
      if (!canWrite) return res.status(403).json({ error: "Sin permisos" });

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const parsed = createSchema.safeParse(body);
      if (!parsed.success)
        return res.status(400).json({ error: parsed.error.message });

      const created = await prisma.$transaction(async (tx) => {
        const agencyCurrencyId = await getNextAgencyCounter(
          tx,
          auth.id_agency,
          "finance_currency",
        );
        return tx.financeCurrency.create({
          data: {
            ...parsed.data,
            id_agency: auth.id_agency,
            agency_finance_currency_id: agencyCurrencyId,
          },
        });
      });
      return res.status(201).json(created);
    } catch (e) {
      console.error("[finance/currencies][POST]", reqId, e);
      return res.status(500).json({ error: "Error creando moneda" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
