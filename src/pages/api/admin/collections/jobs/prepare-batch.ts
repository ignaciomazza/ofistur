import type { NextApiRequest, NextApiResponse } from "next";
import { isBillingAdminRole, resolveBillingAuth } from "@/lib/billingAuth";
import { preparePdBatchJob } from "@/services/collections/jobs/runner";

function readString(req: NextApiRequest, key: string): string | null {
  const bodyValue =
    req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>)[key] : null;
  if (typeof bodyValue === "string" && bodyValue.trim()) return bodyValue.trim();

  const queryValue = req.query[key];
  if (typeof queryValue === "string" && queryValue.trim()) return queryValue.trim();
  return null;
}

function readBoolean(req: NextApiRequest, key: string, fallback = false): boolean {
  const bodyValue =
    req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>)[key] : null;
  const queryValue = req.query[key];

  const raw =
    typeof bodyValue === "boolean"
      ? String(bodyValue)
      : typeof bodyValue === "string"
        ? bodyValue
        : typeof queryValue === "string"
          ? queryValue
          : "";

  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "si", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
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

  try {
    const targetDateAr = readString(req, "date");
    const adapter = readString(req, "adapter");
    const dryRun = readBoolean(req, "dryRun", false);
    const force = readBoolean(req, "force", false);

    const result = await preparePdBatchJob({
      source: "MANUAL",
      actorUserId: auth.id_user,
      targetDateAr,
      adapter,
      dryRun,
      force,
    });

    return res.status(200).json({ result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo correr el job prepare-batch";
    return res.status(400).json({ error: message });
  }
}
