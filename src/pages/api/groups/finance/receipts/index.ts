import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { resolveAuth } from "@/lib/auth";
import { getFinanceSectionGrants } from "@/lib/accessControl";
import { canAccessFinanceSection } from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import {
  normalizeReceiptVerificationRules,
  pickReceiptVerificationRule,
  ruleHasRestrictions,
} from "@/utils/receiptVerification";
import {
  endOfDayUtcFromDateKeyInBuenosAires,
  startOfDayUtcFromDateKeyInBuenosAires,
} from "@/lib/buenosAiresDate";
import { hasSchemaColumn } from "@/lib/schemaColumns";

type GroupReceiptDbRow = {
  id_travel_group_receipt: number;
  agency_travel_group_receipt_id: number | null;
  travel_group_id: number;
  agency_travel_group_id: number | null;
  travel_group_name: string;
  travel_group_departure_id: number | null;
  travel_group_passenger_id: number;
  client_id: number;
  issue_date: Date;
  amount: Prisma.Decimal | number | string;
  amount_string: string;
  amount_currency: string;
  concept: string;
  currency: string;
  payment_method: string | null;
  payment_fee_amount: Prisma.Decimal | number | string | null;
  account: string | null;
  base_amount: Prisma.Decimal | number | string | null;
  base_currency: string | null;
  counter_amount: Prisma.Decimal | number | string | null;
  counter_currency: string | null;
  client_ids: number[] | null;
  service_refs: number[] | null;
  verification_status: string | null;
  verified_at: Date | null;
  verified_by: number | null;
  verified_user_id: number | null;
  verified_first_name: string | null;
  verified_last_name: string | null;
  primary_client_first_name: string | null;
  primary_client_last_name: string | null;
  primary_client_agency_id: number | null;
};

const normText = (value: unknown): string =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return 0;
};

const toOptionalStatus = (raw: unknown): "PENDING" | "VERIFIED" | null => {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  if (value === "PENDING" || value === "VERIFIED") return value;
  return null;
};

const toOptionalPositiveInt = (raw: unknown): number | null => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
};

const normalizeCurrency = (raw: unknown): string => {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  if (!value) return "";
  if (["U$S", "US$", "U$D", "DOL"].includes(value)) return "USD";
  if (["$", "AR$"].includes(value)) return "ARS";
  return value;
};

const isTruthyFlag = (raw: unknown): boolean =>
  ["1", "true", "yes", "on"].includes(
    String(raw || "")
      .trim()
      .toLowerCase(),
  );

function uniquePositiveInts(values: Array<number | null | undefined>): number[] {
  const out = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value) || !value || value <= 0) continue;
    out.add(Math.trunc(value));
  }
  return Array.from(out.values());
}

function buildClientLabel(row: {
  first_name: string | null;
  last_name: string | null;
  agency_client_id: number | null;
  id_client: number;
}): string {
  const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim();
  const displayId = row.agency_client_id ?? row.id_client;
  return fullName ? `${fullName} · N°${displayId}` : `N°${displayId}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const auth = await resolveAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const financeGrants = await getFinanceSectionGrants(auth.id_agency, auth.id_user);
  const canReceipts = canAccessFinanceSection(auth.role, financeGrants, "receipts");
  const canVerify = canAccessFinanceSection(
    auth.role,
    financeGrants,
    "receipts_verify",
  );

  if (!canReceipts && !canVerify) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  const verificationStatusRaw =
    (Array.isArray(req.query.verification_status)
      ? req.query.verification_status[0]
      : req.query.verification_status) ??
    (Array.isArray(req.query.verificationStatus)
      ? req.query.verificationStatus[0]
      : req.query.verificationStatus) ??
    "";

  const verificationStatus = toOptionalStatus(verificationStatusRaw);

  const verificationScopeRaw =
    (Array.isArray(req.query.verification_scope)
      ? req.query.verification_scope[0]
      : req.query.verification_scope) ??
    (Array.isArray(req.query.verify_scope)
      ? req.query.verify_scope[0]
      : req.query.verify_scope) ??
    (Array.isArray(req.query.verificationScope)
      ? req.query.verificationScope[0]
      : req.query.verificationScope) ??
    "";

  const verificationScope = isTruthyFlag(verificationScopeRaw);
  const verifyRequested = verificationScope || verificationStatus != null;

  if (verifyRequested && !canVerify) {
    return res.status(403).json({ error: "Sin permisos" });
  }

  if (verifyRequested) {
    const planAccess = await ensurePlanFeatureAccess(
      auth.id_agency,
      "receipts_verify",
    );
    if (!planAccess.allowed) {
      return res.status(403).json({ error: "Plan insuficiente" });
    }
  }

  const [hasVerificationStatus, hasVerifiedAt, hasVerifiedBy] = await Promise.all([
    hasSchemaColumn("TravelGroupReceipt", "verification_status"),
    hasSchemaColumn("TravelGroupReceipt", "verified_at"),
    hasSchemaColumn("TravelGroupReceipt", "verified_by"),
  ]);
  const hasVerificationColumns =
    hasVerificationStatus && hasVerifiedAt && hasVerifiedBy;

  if (!hasVerificationColumns && verificationStatus === "VERIFIED") {
    return res.status(200).json({ items: [], nextCursor: null });
  }

  const takeRaw = Array.isArray(req.query.take) ? req.query.take[0] : req.query.take;
  const take = Math.max(1, Math.min(200, Number(takeRaw) || 120));

  const cursorRaw = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;
  const cursor = toOptionalPositiveInt(cursorRaw);

  const q =
    (Array.isArray(req.query.q) ? req.query.q[0] : req.query.q)?.trim() || "";

  const currency = normalizeCurrency(
    Array.isArray(req.query.currency) ? req.query.currency[0] : req.query.currency,
  );

  const paymentMethodText =
    (Array.isArray(req.query.payment_method)
      ? req.query.payment_method[0]
      : req.query.payment_method) || "";

  const accountText =
    (Array.isArray(req.query.account) ? req.query.account[0] : req.query.account) || "";

  const paymentMethodId = toOptionalPositiveInt(
    Array.isArray(req.query.payment_method_id)
      ? req.query.payment_method_id[0]
      : req.query.payment_method_id,
  );

  const accountId = toOptionalPositiveInt(
    Array.isArray(req.query.account_id) ? req.query.account_id[0] : req.query.account_id,
  );

  const userId = toOptionalPositiveInt(
    Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId,
  );

  const association = String(
    Array.isArray(req.query.association)
      ? req.query.association[0]
      : req.query.association || "",
  )
    .trim()
    .toLowerCase();

  // Los recibos de grupales no tienen owner ni asociación a reserva como los convencionales.
  if (userId || association === "linked" || association === "associated") {
    return res.status(200).json({ items: [], nextCursor: null });
  }

  const from = (Array.isArray(req.query.from) ? req.query.from[0] : req.query.from) || "";
  const to = (Array.isArray(req.query.to) ? req.query.to[0] : req.query.to) || "";

  const minAmountRaw = Array.isArray(req.query.minAmount)
    ? req.query.minAmount[0]
    : req.query.minAmount;
  const maxAmountRaw = Array.isArray(req.query.maxAmount)
    ? req.query.maxAmount[0]
    : req.query.maxAmount;

  const minAmount = Number(minAmountRaw);
  const maxAmount = Number(maxAmountRaw);

  const issueFrom = from
    ? startOfDayUtcFromDateKeyInBuenosAires(from)
    : null;
  const issueTo = to ? endOfDayUtcFromDateKeyInBuenosAires(to) : null;

  const [paymentMethods, accounts] = await Promise.all([
    prisma.financePaymentMethod.findMany({
      where: { id_agency: auth.id_agency, enabled: true },
      select: { id_method: true, name: true },
    }),
    prisma.financeAccount.findMany({
      where: { id_agency: auth.id_agency, enabled: true },
      select: { id_account: true, name: true },
    }),
  ]);

  const methodNameToId = new Map<string, number>();
  const methodIdToName = new Map<number, string>();
  for (const method of paymentMethods) {
    const key = normText(method.name);
    if (!key) continue;
    if (!methodNameToId.has(key)) methodNameToId.set(key, method.id_method);
    methodIdToName.set(method.id_method, method.name);
  }

  const accountNameToId = new Map<string, number>();
  const accountIdToName = new Map<number, string>();
  for (const account of accounts) {
    const key = normText(account.name);
    if (!key) continue;
    if (!accountNameToId.has(key)) accountNameToId.set(key, account.id_account);
    accountIdToName.set(account.id_account, account.name);
  }

  const methodNamesFromIds = paymentMethodId
    ? [methodIdToName.get(paymentMethodId)].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];

  const accountNamesFromIds = accountId
    ? [accountIdToName.get(accountId)].filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];

  if (paymentMethodId && methodNamesFromIds.length === 0) {
    return res.status(200).json({ items: [], nextCursor: null });
  }
  if (accountId && accountNamesFromIds.length === 0) {
    return res.status(200).json({ items: [], nextCursor: null });
  }

  const ruleMethodNames: string[] = [];
  const ruleAccountNames: string[] = [];

  if (verificationScope) {
    const config = await prisma.financeConfig.findFirst({
      where: { id_agency: auth.id_agency },
      select: { receipt_verification_rules: true },
    });
    const rules = normalizeReceiptVerificationRules(
      config?.receipt_verification_rules,
    );
    const rule = pickReceiptVerificationRule(rules, auth.id_user);

    if (rule && ruleHasRestrictions(rule)) {
      for (const methodId of rule.payment_method_ids) {
        const methodName = methodIdToName.get(methodId);
        if (methodName) ruleMethodNames.push(methodName);
      }
      for (const accId of rule.account_ids) {
        const accountName = accountIdToName.get(accId);
        if (accountName) ruleAccountNames.push(accountName);
      }

      if (rule.payment_method_ids.length > 0 && ruleMethodNames.length === 0) {
        return res.status(200).json({ items: [], nextCursor: null });
      }
      if (rule.account_ids.length > 0 && ruleAccountNames.length === 0) {
        return res.status(200).json({ items: [], nextCursor: null });
      }
    }
  }

  const filters: Prisma.Sql[] = [Prisma.sql`r."id_agency" = ${auth.id_agency}`];

  if (cursor) {
    filters.push(Prisma.sql`r."id_travel_group_receipt" < ${cursor}`);
  }

  if (currency && /^[A-Z]{3}$/.test(currency)) {
    filters.push(Prisma.sql`UPPER(COALESCE(r."amount_currency", '')) = ${currency}`);
  }

  if (paymentMethodText.trim()) {
    filters.push(
      Prisma.sql`LOWER(TRIM(COALESCE(r."payment_method", ''))) = ${normText(
        paymentMethodText,
      )}`,
    );
  }

  if (accountText.trim()) {
    filters.push(
      Prisma.sql`LOWER(TRIM(COALESCE(r."account", ''))) = ${normText(accountText)}`,
    );
  }

  if (methodNamesFromIds.length > 0) {
    const methodNamesLower = methodNamesFromIds.map((value) => normText(value));
    filters.push(
      Prisma.sql`LOWER(TRIM(COALESCE(r."payment_method", ''))) IN (${Prisma.join(
        methodNamesLower,
      )})`,
    );
  }

  if (accountNamesFromIds.length > 0) {
    const accountNamesLower = accountNamesFromIds.map((value) => normText(value));
    filters.push(
      Prisma.sql`LOWER(TRIM(COALESCE(r."account", ''))) IN (${Prisma.join(
        accountNamesLower,
      )})`,
    );
  }

  if (ruleMethodNames.length > 0) {
    const methodNamesLower = ruleMethodNames.map((value) => normText(value));
    filters.push(
      Prisma.sql`LOWER(TRIM(COALESCE(r."payment_method", ''))) IN (${Prisma.join(
        methodNamesLower,
      )})`,
    );
  }

  if (ruleAccountNames.length > 0) {
    const accountNamesLower = ruleAccountNames.map((value) => normText(value));
    filters.push(
      Prisma.sql`LOWER(TRIM(COALESCE(r."account", ''))) IN (${Prisma.join(
        accountNamesLower,
      )})`,
    );
  }

  if (issueFrom) {
    filters.push(Prisma.sql`r."issue_date" >= ${issueFrom}`);
  }

  if (issueTo) {
    filters.push(Prisma.sql`r."issue_date" <= ${issueTo}`);
  }

  if (Number.isFinite(minAmount)) {
    filters.push(Prisma.sql`r."amount" >= ${minAmount}`);
  }

  if (Number.isFinite(maxAmount)) {
    filters.push(Prisma.sql`r."amount" <= ${maxAmount}`);
  }

  if (verificationStatus) {
    if (hasVerificationColumns) {
      filters.push(Prisma.sql`UPPER(COALESCE(r."verification_status", 'PENDING')) = ${verificationStatus}`);
    } else if (verificationStatus === "VERIFIED") {
      return res.status(200).json({ items: [], nextCursor: null });
    }
  }

  if (q.trim()) {
    const qValue = q.trim();
    const qLike = `%${qValue}%`;
    const qNum = Number(qValue);
    const orChunks: Prisma.Sql[] = [
      Prisma.sql`r."concept" ILIKE ${qLike}`,
      Prisma.sql`r."amount_string" ILIKE ${qLike}`,
      Prisma.sql`COALESCE(r."payment_method", '') ILIKE ${qLike}`,
      Prisma.sql`COALESCE(r."account", '') ILIKE ${qLike}`,
      Prisma.sql`tg."name" ILIKE ${qLike}`,
      Prisma.sql`COALESCE(c."first_name", '') ILIKE ${qLike}`,
      Prisma.sql`COALESCE(c."last_name", '') ILIKE ${qLike}`,
      Prisma.sql`COALESCE(c."company_name", '') ILIKE ${qLike}`,
    ];

    if (Number.isFinite(qNum) && qNum > 0) {
      const n = Math.trunc(qNum);
      orChunks.push(
        Prisma.sql`r."agency_travel_group_receipt_id" = ${n}`,
        Prisma.sql`r."id_travel_group_receipt" = ${n}`,
        Prisma.sql`r."travel_group_id" = ${n}`,
      );
    }

    filters.push(Prisma.sql`(${Prisma.join(orChunks, " OR ")})`);
  }

  const whereSql = Prisma.join(filters, " AND ");

  const verificationSelectSql = hasVerificationColumns
    ? Prisma.sql`
        COALESCE(r."verification_status", 'PENDING') AS "verification_status",
        r."verified_at",
        r."verified_by",
        vu."id_user" AS "verified_user_id",
        vu."first_name" AS "verified_first_name",
        vu."last_name" AS "verified_last_name"
      `
    : Prisma.sql`
        'PENDING'::TEXT AS "verification_status",
        NULL::TIMESTAMP AS "verified_at",
        NULL::INTEGER AS "verified_by",
        NULL::INTEGER AS "verified_user_id",
        NULL::TEXT AS "verified_first_name",
        NULL::TEXT AS "verified_last_name"
      `;

  const verificationJoinSql = hasVerificationColumns
    ? Prisma.sql`LEFT JOIN "User" vu ON vu."id_user" = r."verified_by"`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<GroupReceiptDbRow[]>(Prisma.sql`
    SELECT
      r."id_travel_group_receipt",
      r."agency_travel_group_receipt_id",
      r."travel_group_id",
      tg."agency_travel_group_id",
      tg."name" AS "travel_group_name",
      r."travel_group_departure_id",
      r."travel_group_passenger_id",
      r."client_id",
      r."issue_date",
      r."amount",
      r."amount_string",
      r."amount_currency",
      r."concept",
      r."currency",
      r."payment_method",
      r."payment_fee_amount",
      r."account",
      r."base_amount",
      r."base_currency",
      r."counter_amount",
      r."counter_currency",
      r."client_ids",
      r."service_refs",
      c."first_name" AS "primary_client_first_name",
      c."last_name" AS "primary_client_last_name",
      c."agency_client_id" AS "primary_client_agency_id",
      ${verificationSelectSql}
    FROM "TravelGroupReceipt" r
    INNER JOIN "TravelGroup" tg
      ON tg."id_travel_group" = r."travel_group_id"
      AND tg."id_agency" = r."id_agency"
    LEFT JOIN "Client" c
      ON c."id_client" = r."client_id"
    ${verificationJoinSql}
    WHERE ${whereSql}
    ORDER BY r."id_travel_group_receipt" DESC
    LIMIT ${take + 1}
  `);

  const hasMore = rows.length > take;
  const pageRows = hasMore ? rows.slice(0, take) : rows;

  const allClientIds = uniquePositiveInts(
    pageRows.flatMap((row) => {
      const ids = Array.isArray(row.client_ids) ? row.client_ids : [];
      if (ids.length > 0) return ids;
      return [row.client_id];
    }),
  );

  const clients = allClientIds.length
    ? await prisma.client.findMany({
        where: {
          id_agency: auth.id_agency,
          id_client: { in: allClientIds },
        },
        select: {
          id_client: true,
          agency_client_id: true,
          first_name: true,
          last_name: true,
        },
      })
    : [];

  const clientsById = new Map(clients.map((client) => [client.id_client, client]));

  const items = pageRows.map((row) => {
    const receiptNumberBase =
      row.agency_travel_group_receipt_id ?? row.id_travel_group_receipt;
    const receiptNumber = `GR-${String(receiptNumberBase).padStart(6, "0")}`;

    const clientIds = uniquePositiveInts(
      Array.isArray(row.client_ids) && row.client_ids.length > 0
        ? row.client_ids
        : [row.client_id],
    );

    const clientLabels =
      clientIds.length > 0
        ? clientIds.map((id) => {
            const found = clientsById.get(id);
            if (!found) return `N°${id}`;
            return buildClientLabel(found);
          })
        : row.client_id > 0
          ? [
              buildClientLabel({
                id_client: row.client_id,
                agency_client_id: row.primary_client_agency_id,
                first_name: row.primary_client_first_name,
                last_name: row.primary_client_last_name,
              }),
            ]
          : [];

    const normalizedMethodId = methodNameToId.get(normText(row.payment_method));
    const normalizedAccountId = accountNameToId.get(normText(row.account));

    return {
      id_receipt: row.id_travel_group_receipt,
      agency_receipt_id: row.agency_travel_group_receipt_id,
      public_id: null,
      receipt_number: receiptNumber,
      issue_date: row.issue_date?.toISOString() ?? null,
      amount: toNumber(row.amount),
      amount_string: row.amount_string,
      amount_currency: normalizeCurrency(row.amount_currency) || "ARS",
      concept: row.concept,
      currency: row.currency,
      payment_method: row.payment_method,
      account: row.account,
      payment_method_id: normalizedMethodId ?? null,
      account_id: normalizedAccountId ?? null,
      payment_fee_amount:
        row.payment_fee_amount == null ? null : toNumber(row.payment_fee_amount),
      payment_fee_currency: normalizeCurrency(row.amount_currency) || "ARS",
      base_amount: row.base_amount == null ? null : toNumber(row.base_amount),
      base_currency: row.base_currency,
      counter_amount:
        row.counter_amount == null ? null : toNumber(row.counter_amount),
      counter_currency: row.counter_currency,
      verification_status: row.verification_status || "PENDING",
      verified_at: row.verified_at ? row.verified_at.toISOString() : null,
      verified_by: row.verified_by,
      verifiedBy:
        row.verified_user_id &&
        (row.verified_first_name || row.verified_last_name)
          ? {
              id_user: row.verified_user_id,
              first_name: row.verified_first_name || "",
              last_name: row.verified_last_name || "",
            }
          : null,
      serviceIds: Array.isArray(row.service_refs) ? row.service_refs : [],
      clientIds,
      clientLabels,
      booking: null,
      source_type: "GROUP",
      travel_group_id: row.travel_group_id,
      agency_travel_group_id: row.agency_travel_group_id,
      travel_group_name: row.travel_group_name,
      travel_group_passenger_id: row.travel_group_passenger_id,
      travel_group_departure_id: row.travel_group_departure_id,
    };
  });

  const nextCursor = hasMore
    ? pageRows[pageRows.length - 1]?.id_travel_group_receipt ?? null
    : null;

  return res.status(200).json({ items, nextCursor });
}
