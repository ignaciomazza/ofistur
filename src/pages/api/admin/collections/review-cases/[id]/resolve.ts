import type { NextApiRequest, NextApiResponse } from "next";
import type { BillingPaymentReviewResolutionType } from "@prisma/client";
import { isBillingAdminRole, resolveBillingAuth } from "@/lib/billingAuth";
import { resolvePaymentReviewCase } from "@/services/collections/review-cases/service";

function parseCaseId(req: NextApiRequest): number | null {
  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const parsed = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function readString(req: NextApiRequest, key: string): string | null {
  const bodyValue =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)[key]
      : null;
  if (typeof bodyValue === "string" && bodyValue.trim()) return bodyValue.trim();
  const queryValue = req.query[key];
  if (typeof queryValue === "string" && queryValue.trim()) return queryValue.trim();
  return null;
}

function readResolutionType(
  req: NextApiRequest,
): BillingPaymentReviewResolutionType | null {
  const raw = String(readString(req, "resolutionType") || "").toUpperCase();
  if (raw === "BALANCE_CREDIT") return "BALANCE_CREDIT";
  if (raw === "REFUND_MANUAL") return "REFUND_MANUAL";
  if (raw === "NO_ACTION") return "NO_ACTION";
  if (raw === "OTHER") return "OTHER";
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

  const resolutionType = readResolutionType(req);
  if (!resolutionType) {
    return res.status(400).json({ error: "resolutionType inválido" });
  }

  try {
    const result = await resolvePaymentReviewCase({
      caseId,
      resolutionType,
      notes: readString(req, "notes"),
      actorUserId: auth.id_user,
      source: "API_RESOLVE_REVIEW",
    });
    return res.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo resolver el caso";
    return res.status(400).json({ error: message });
  }
}
