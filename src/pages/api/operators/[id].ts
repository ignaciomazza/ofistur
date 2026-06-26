// drc/pages/api/operators/[id].ts

import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
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
  const { id } = req.query;
  if (!id || Array.isArray(id)) {
    return res.status(400).json({ error: "N° de operador inválido." });
  }
  const operatorId = Number(id);
  if (!Number.isFinite(operatorId) || operatorId <= 0) {
    return res.status(400).json({ error: "N° de operador inválido." });
  }

  const auth = await resolveAuth(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (!(await canManageOperators(auth))) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  if (req.method === "DELETE") {
    try {
      const existing = await prisma.operator.findFirst({
        where: { id_operator: operatorId, id_agency: auth.id_agency },
        select: { id_operator: true },
      });
      if (!existing) {
        return res.status(404).json({ error: "Operador no encontrado." });
      }

      await prisma.operator.delete({
        where: { id_operator: operatorId },
      });
      return res.status(200).json({ message: "Operador eliminado con éxito." });
    } catch (error) {
      console.error(
        "Error deleting operator:",
        error instanceof Error ? error.message : error,
      );
      return res.status(500).json({ error: "Failed to delete operator" });
    }
  } else if (req.method === "PUT") {
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

    // Validar campos requeridos
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

      // Verificar duplicados excluyendo al operador que se está actualizando
      if (duplicateClauses.length > 0) {
        const duplicate = await prisma.operator.findFirst({
          where: {
            AND: [
              {
                OR: duplicateClauses,
              },
              {
                id_agency: auth.id_agency,
              },
              {
                id_operator: { not: operatorId },
              },
            ],
          },
        });
        if (duplicate) {
          return res.status(400).json({
            error: "Ya existe otro operador con el mismo email o CUIT.",
          });
        }
      }

      const existing = await prisma.operator.findFirst({
        where: { id_operator: operatorId, id_agency: auth.id_agency },
        select: { id_operator: true },
      });
      if (!existing) {
        return res.status(404).json({ error: "Operador no encontrado." });
      }

      const updatedOperator = await prisma.operator.update({
        where: { id_operator: operatorId },
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
        },
      });
      return res.status(200).json(updatedOperator);
    } catch (error) {
      console.error(
        "Error updating operator:",
        error instanceof Error ? error.message : error,
      );
      return res.status(500).json({ error: "Failed to update operator" });
    }
  } else {
    res.setHeader("Allow", ["DELETE", "PUT"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
