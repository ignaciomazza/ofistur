import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { resolveAuth } from "@/lib/auth";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection } from "@/utils/permissions";
import {
  normalizeReceiptVerificationRules,
  pickReceiptVerificationRule,
  receiptMatchesRule,
  ruleHasRestrictions,
} from "@/utils/receiptVerification";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { hasSchemaColumn } from "@/lib/schemaColumns";

const normText = (value: unknown): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function normalizeStatus(raw: unknown): "PENDING" | "VERIFIED" | null {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  if (value === "PENDING" || value === "VERIFIED") return value;
  return null;
}

function parseReceiptId(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

type ExistingGroupReceipt = {
  id_travel_group_receipt: number;
  payment_method: string | null;
  account: string | null;
};

type UpdatedGroupReceipt = {
  id_travel_group_receipt: number;
  verification_status: string | null;
  verified_at: Date | null;
  verified_by: number | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", ["PATCH"]);
    return res.status(405).end();
  }

  const auth = await resolveAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const planAccess = await ensurePlanFeatureAccess(
    auth.id_agency,
    "receipts_verify",
  );
  if (!planAccess.allowed) {
    return res.status(403).json({ error: "Plan insuficiente" });
  }

  const financeGrants = await getFinanceSectionGrants(auth.id_agency, auth.id_user);
  const canVerify = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "receipts_verify",
  );
  if (!canVerify) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const [hasVerificationStatus, hasVerifiedAt, hasVerifiedBy] = await Promise.all([
    hasSchemaColumn("TravelGroupReceipt", "verification_status"),
    hasSchemaColumn("TravelGroupReceipt", "verified_at"),
    hasSchemaColumn("TravelGroupReceipt", "verified_by"),
  ]);

  if (!(hasVerificationStatus && hasVerifiedAt && hasVerifiedBy)) {
    return res.status(409).json({
      error:
        "La base todavía no tiene habilitada la verificación para recibos de grupales.",
    });
  }

  const receiptIdRaw = Array.isArray(req.query.receiptId)
    ? req.query.receiptId[0]
    : req.query.receiptId;
  const receiptId = parseReceiptId(receiptIdRaw);
  if (!receiptId) {
    return res.status(400).json({ error: "ID invalido" });
  }

  const status = normalizeStatus((req.body as Record<string, unknown>)?.status);
  if (!status) {
    return res
      .status(400)
      .json({ error: "status invalido (PENDING | VERIFIED)" });
  }

  const [receipt] = await prisma.$queryRaw<ExistingGroupReceipt[]>(Prisma.sql`
    SELECT
      r."id_travel_group_receipt",
      r."payment_method",
      r."account"
    FROM "TravelGroupReceipt" r
    WHERE r."id_travel_group_receipt" = ${receiptId}
      AND r."id_agency" = ${auth.id_agency}
    LIMIT 1
  `);

  if (!receipt) {
    return res.status(404).json({ error: "Recibo no encontrado" });
  }

  const [methods, accounts] = await Promise.all([
    prisma.financePaymentMethod.findMany({
      where: { id_agency: auth.id_agency, enabled: true },
      select: { id_method: true, name: true },
    }),
    prisma.financeAccount.findMany({
      where: { id_agency: auth.id_agency, enabled: true },
      select: { id_account: true, name: true },
    }),
  ]);

  const methodIdByName = new Map<string, number>();
  for (const method of methods) {
    const key = normText(method.name);
    if (!key || methodIdByName.has(key)) continue;
    methodIdByName.set(key, method.id_method);
  }

  const accountIdByName = new Map<string, number>();
  for (const account of accounts) {
    const key = normText(account.name);
    if (!key || accountIdByName.has(key)) continue;
    accountIdByName.set(key, account.id_account);
  }

  const receiptForRule = {
    payment_method_id: methodIdByName.get(normText(receipt.payment_method)) ?? null,
    account_id: accountIdByName.get(normText(receipt.account)) ?? null,
    payments: [] as Array<{ payment_method_id: number | null; account_id: number | null }>,
  };

  const config = await prisma.financeConfig.findFirst({
    where: { id_agency: auth.id_agency },
    select: { receipt_verification_rules: true },
  });
  const rules = normalizeReceiptVerificationRules(config?.receipt_verification_rules);
  const rule = pickReceiptVerificationRule(rules, auth.id_user);

  if (rule && ruleHasRestrictions(rule)) {
    const allowed = receiptMatchesRule(rule, receiptForRule);
    if (!allowed) {
      return res.status(403).json({
        error: "No autorizado para verificar este recibo",
      });
    }
  }

  const [updated] = await prisma.$queryRaw<UpdatedGroupReceipt[]>(Prisma.sql`
    UPDATE "TravelGroupReceipt"
    SET
      "verification_status" = ${status},
      "verified_at" = ${status === "VERIFIED" ? new Date() : null},
      "verified_by" = ${status === "VERIFIED" ? auth.id_user : null},
      "updated_at" = NOW()
    WHERE "id_travel_group_receipt" = ${receipt.id_travel_group_receipt}
      AND "id_agency" = ${auth.id_agency}
    RETURNING
      "id_travel_group_receipt",
      "verification_status",
      "verified_at",
      "verified_by"
  `);

  if (!updated) {
    return res.status(404).json({ error: "Recibo no encontrado" });
  }

  return res.status(200).json({
    receipt: {
      id_receipt: updated.id_travel_group_receipt,
      verification_status: updated.verification_status ?? status,
      verified_at: updated.verified_at?.toISOString() ?? null,
      verified_by: updated.verified_by ?? null,
    },
  });
}
