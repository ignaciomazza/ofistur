import type { NextApiRequest, NextApiResponse } from "next";
import { isBillingAdminRole, resolveBillingAuth } from "@/lib/billingAuth";
import { ignorePaymentReviewCase } from "@/services/collections/review-cases/service";

function parseCaseId(req: NextApiRequest): number | null {
  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const parsed = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function readNotes(req: NextApiRequest): string | null {
  const bodyValue =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>).notes
      : null;
  if (typeof bodyValue === "string" && bodyValue.trim()) return bodyValue.trim();
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const auth = await resolveBillingAuth(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (!isBillingAdminRole(auth.role)) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const caseId = parseCaseId(req);
  if (!caseId) return res.status(400).json({ error: "id inválido" });

  try {
    const result = await ignorePaymentReviewCase({
      caseId,
      notes: readNotes(req),
      actorUserId: auth.id_user,
      source: "API_IGNORE_REVIEW",
    });
    return res.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo ignorar el caso";
    return res.status(400).json({ error: message });
  }
}
