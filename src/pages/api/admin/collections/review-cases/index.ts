import type { NextApiRequest, NextApiResponse } from "next";
import type {
  BillingPaymentReviewCaseStatus,
  BillingPaymentReviewCaseType,
} from "@prisma/client";
import { isBillingAdminRole, resolveBillingAuth } from "@/lib/billingAuth";
import { listPaymentReviewCases } from "@/services/collections/review-cases/service";

function readString(req: NextApiRequest, key: string): string | null {
  const value = req.query[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function readPositiveInt(req: NextApiRequest, key: string): number | null {
  const raw = readString(req, key);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function readDate(req: NextApiRequest, key: string): Date | null {
  const raw = readString(req, key);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function readLimit(req: NextApiRequest): number {
  const parsed = Number.parseInt(String(req.query.limit || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(500, parsed);
}

function readStatus(req: NextApiRequest): BillingPaymentReviewCaseStatus | null {
  const raw = String(readString(req, "status") || "").toUpperCase();
  if (raw === "OPEN") return "OPEN";
  if (raw === "IN_REVIEW") return "IN_REVIEW";
  if (raw === "RESOLVED") return "RESOLVED";
  if (raw === "IGNORED") return "IGNORED";
  return null;
}

function readType(req: NextApiRequest): BillingPaymentReviewCaseType | null {
  const raw = String(readString(req, "type") || "").toUpperCase();
  if (raw === "LATE_DUPLICATE_PAYMENT") return "LATE_DUPLICATE_PAYMENT";
  if (raw === "AMOUNT_MISMATCH") return "AMOUNT_MISMATCH";
  if (raw === "OTHER") return "OTHER";
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const auth = await resolveBillingAuth(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (!isBillingAdminRole(auth.role)) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  try {
    const items = await listPaymentReviewCases({
      status: readStatus(req),
      type: readType(req),
      agencyId: readPositiveInt(req, "agencyId"),
      from: readDate(req, "from"),
      to: readDate(req, "to"),
      limit: readLimit(req),
    });
    return res.status(200).json({ items });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudieron listar los review cases";
    return res.status(400).json({ error: message });
  }
}
