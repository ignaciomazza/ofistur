// src/pages/api/operators/index.ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getNextAgencyCounter } from "@/lib/agencyCounters";
import { resolveAuth } from "@/lib/auth";
import { canManageOperators } from "@/lib/operatorAccess";

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const auth = await resolveAuth(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const rawAgency = Array.isArray(req.query.agencyId)
    ? req.query.agencyId[0]
    : req.query.agencyId;
  const agencyId = rawAgency ? Number(rawAgency) : null;
  if (agencyId && agencyId !== auth.id_agency) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  if (req.method === "GET") {
    try {
      const operators = await prisma.operator.findMany({
        where: { id_agency: auth.id_agency },
      });
      return res.status(200).json(operators);
    } catch (error) {
      console.error(
        "Error fetching operators:",
        error instanceof Error ? error.message : error,
      );
      return res.status(500).json({ error: "Failed to fetch operators" });
    }
  } else if (req.method === "POST") {
    const {
      id_agency,
    } = req.body;
    const name = cleanString(req.body.name);
    const email = cleanString(req.body.email);
    const phone = cleanString(req.body.phone);
    const website = cleanString(req.body.website);
    const address = cleanString(req.body.address);
    const postal_code = cleanString(req.body.postal_code);
    const city = cleanString(req.body.city);
    const state = cleanString(req.body.state);
    const country = cleanString(req.body.country);
    const vat_status = cleanString(req.body.vat_status);
    const legal_name = cleanString(req.body.legal_name);
    const tax_id = cleanString(req.body.tax_id);

    const canManage = await canManageOperators(auth);
    if (!canManage) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    // Ensure agency is provided
    if (typeof id_agency === "number" && id_agency !== auth.id_agency) {
      return res.status(403).json({ error: "Sin permisos" });
    }

    // Required fields
    if (!name) {
      return res.status(400).json({
        error: "El nombre comercial es obligatorio.",
      });
    }

    try {
      const duplicateClauses = [
        email ? { email } : null,
        tax_id ? { tax_id } : null,
      ].filter(Boolean) as Array<{ email: string } | { tax_id: string }>;

      // Check duplicates within the same agency
      if (duplicateClauses.length > 0) {
        const duplicate = await prisma.operator.findFirst({
          where: {
            id_agency: auth.id_agency,
            OR: duplicateClauses,
          },
        });
        if (duplicate) {
          return res.status(400).json({
            error:
              "Ya existe un operador con el mismo email o CUIT en esta agencia.",
          });
        }
      }

      const newOperator = await prisma.$transaction(async (tx) => {
        const agencyOperatorId = await getNextAgencyCounter(
          tx,
          auth.id_agency,
          "operator",
        );
        return tx.operator.create({
          data: {
            name,
            email,
            phone,
            website,
            address,
            postal_code,
            city,
            state,
            country,
            vat_status,
            legal_name,
            tax_id,
            id_agency: auth.id_agency,
            agency_operator_id: agencyOperatorId,
          },
        });
      });
      return res.status(201).json(newOperator);
    } catch (error) {
      console.error(
        "Error creating operator:",
        error instanceof Error ? error.message : error,
      );
      return res.status(500).json({ error: "Failed to create operator" });
    }
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
