// src/pages/api/investments/[id]/pdf.tsx
import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { renderToStream } from "@react-pdf/renderer";
import OperatorPaymentDocument, {
  OperatorPaymentPdfData,
} from "@/services/investments/OperatorPaymentDocument";
import { jwtVerify, type JWTPayload } from "jose";
import {
  getBookingComponentGrants,
  getFinanceSectionGrants,
} from "@/lib/accessControl";
import {
  canAccessBookingComponent,
  canAccessFinanceSection,
} from "@/utils/permissions";
import { ensurePlanFeatureAccess } from "@/lib/planAccess.server";
import { hasSchemaColumn } from "@/lib/schemaColumns";
import { decodeInvestmentPdfItemsPayload } from "@/utils/investments/pdfItemsPayload";
import { computeOperatorPaymentBreakdown } from "@/lib/operatorPayments/serviceBreakdown";

const prisma = new PrismaClient();

type TokenPayload = JWTPayload & {
  id_user?: number;
  userId?: number;
  uid?: number;
  role?: string;
  id_agency?: number;
  agencyId?: number;
  aid?: number;
  email?: string;
};

type DecodedUser = {
  id_user?: number;
  role?: string;
  id_agency?: number;
  email?: string;
};

type AgencyExtras = {
  id_agency?: number | null;
  logo_url?: string | null;
  legal_name?: string | null;
  tax_id?: string | null;
  address?: string | null;
  name?: string | null;
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET no configurado");

function getTokenFromRequest(req: NextApiRequest): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const c = req.cookies || {};
  for (const k of [
    "session",
    "auth_token",
    "access_token",
    "next-auth.session-token",
  ]) {
    if (c[k]) return c[k]!;
  }
  return null;
}

async function getUserFromAuth(
  req: NextApiRequest,
): Promise<DecodedUser | null> {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return null;
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(JWT_SECRET),
    );
    const p = payload as TokenPayload;

    const id_user = Number(p.id_user ?? p.userId ?? p.uid) || undefined;
    const id_agency = Number(p.id_agency ?? p.agencyId ?? p.aid) || undefined;
    const role = p.role;
    const email = p.email;

    if (!id_user && email) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: { id_user: true, id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user: u.id_user,
          id_agency: u.id_agency,
          role: u.role,
          email: u.email,
        };
    }
    if (id_user && !id_agency) {
      const u = await prisma.user.findUnique({
        where: { id_user },
        select: { id_agency: true, role: true, email: true },
      });
      if (u)
        return {
          id_user,
          id_agency: u.id_agency,
          role: role ?? u.role,
          email: email ?? u.email ?? undefined,
        };
    }
    return { id_user, id_agency, role, email };
  } catch {
    return null;
  }
}

const toNum = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  const s = (v as { toString?: () => string })?.toString?.();
  const n = Number(s ?? NaN);
  return Number.isFinite(n) ? n : fallback;
};

async function fetchLogoFromUrl(
  url?: string | null,
): Promise<{ base64: string; mime: string } | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    let mime = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (!mime) {
      const u = url.toLowerCase();
      if (u.endsWith(".jpg") || u.endsWith(".jpeg")) mime = "image/jpeg";
      else if (u.endsWith(".png")) mime = "image/png";
      else if (u.endsWith(".webp")) mime = "image/webp";
      else mime = "image/png";
    }
    return { base64: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

const normSoft = (s?: string | null) =>
  (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

async function getOperatorCategoryNames(
  agencyId: number,
): Promise<string[]> {
  const hasScope = await hasSchemaColumn("ExpenseCategory", "scope");
  const rows = await prisma.expenseCategory.findMany({
    where: hasScope
      ? {
          id_agency: agencyId,
          scope: "INVESTMENT",
          requires_operator: true,
        }
      : { id_agency: agencyId, requires_operator: true },
    select: { name: true },
  });
  return rows.map((r) => r.name).filter((n) => typeof n === "string");
}

function buildOperatorCategorySet(names: string[]): Set<string> {
  const set = new Set<string>();
  for (const name of names) {
    const n = normSoft(name);
    if (n) set.add(n);
  }
  return set;
}

function isOperatorCategoryName(
  name: string,
  operatorCategorySet?: Set<string>,
) {
  const n = normSoft(name);
  if (!n) return false;
  if (n.startsWith("operador")) return true;
  return operatorCategorySet ? operatorCategorySet.has(n) : false;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const authUser = await getUserFromAuth(req);
  const authUserId = authUser?.id_user;
  const authAgencyId = authUser?.id_agency;
  const authRole = authUser?.role ?? "";
  if (!authUserId || !authAgencyId) {
    return res.status(401).end("No autenticado");
  }

  const financeGrants = await getFinanceSectionGrants(authAgencyId, authUserId);
  const bookingGrants = await getBookingComponentGrants(authAgencyId, authUserId);
  const canInvestments = canAccessFinanceSection(
    authRole,
    financeGrants,
    "investments",
  );
  const canOperatorPaymentsSection = canAccessFinanceSection(
    authRole,
    financeGrants,
    "operator_payments",
  );
  const canOperatorPayments =
    canAccessBookingComponent(
      authRole,
      bookingGrants,
      "operator_payments",
    ) || canOperatorPaymentsSection;

  if (!canInvestments && !canOperatorPayments) {
    return res.status(403).end("Sin permisos");
  }

  const planAccess = await ensurePlanFeatureAccess(authAgencyId, "investments");
  const restrictToOperatorPayments = !planAccess.allowed;
  if (restrictToOperatorPayments && !canOperatorPayments) {
    return res.status(403).end("Plan insuficiente");
  }

  const rawId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).end("ID inválido");
  }

  const [hasPaymentFeeAmount, hasPaymentLines] = await Promise.all([
    hasSchemaColumn("Investment", "payment_fee_amount"),
    hasSchemaColumn("InvestmentPayment", "id_investment_payment"),
  ]);

  const investment = await prisma.investment.findFirst({
    where: { id_investment: id, id_agency: authAgencyId },
    select: {
      id_investment: true,
      agency_investment_id: true,
      category: true,
      description: true,
      counterparty_name: true,
      amount: true,
      currency: true,
      created_at: true,
      paid_at: true,
      payment_method: true,
      account: true,
      ...(hasPaymentFeeAmount ? { payment_fee_amount: true } : {}),
      base_amount: true,
      base_currency: true,
      counter_amount: true,
      counter_currency: true,
      operator_id: true,
      user_id: true,
      serviceIds: true,
      operator: { select: { id_operator: true, name: true } },
      user: { select: { id_user: true, first_name: true, last_name: true } },
      booking: { select: { id_booking: true, agency_booking_id: true } },
      ...(hasPaymentLines
        ? {
            payments: {
              select: {
                id_investment_payment: true,
                amount: true,
                payment_method: true,
                account: true,
                payment_currency: true,
                fee_mode: true,
                fee_value: true,
                fee_amount: true,
              },
            },
          }
        : {}),
    },
  });

  if (!investment) return res.status(404).end("Egreso no encontrado");

  const operatorCategoryNames = await getOperatorCategoryNames(authAgencyId);
  const operatorCategorySet = buildOperatorCategorySet(operatorCategoryNames);
  const categoryIsOperator = isOperatorCategoryName(
    investment.category,
    operatorCategorySet,
  );
  if (restrictToOperatorPayments && !categoryIsOperator) {
    return res.status(403).end("Tu plan solo permite pagos a operador");
  }

  const agency = (await prisma.agency.findUnique({
    where: { id_agency: authAgencyId },
    select: {
      id_agency: true,
      name: true,
      legal_name: true,
      tax_id: true,
      address: true,
      logo_url: true,
    },
  })) as AgencyExtras | null;

  let logoBase64: string | undefined;
  let logoMime: string | undefined;

  try {
    const fetched = await fetchLogoFromUrl(agency?.logo_url);
    if (fetched) {
      logoBase64 = fetched.base64;
      logoMime = fetched.mime;
    }

    if (!logoBase64) {
      const preferred: string[] = [];
      if (agency?.id_agency) preferred.push(`logo_ag_${agency.id_agency}.png`);

      for (const fname of preferred) {
        const candidate = path.join(process.cwd(), "public", "agencies", fname);
        if (fs.existsSync(candidate)) {
          logoBase64 = fs.readFileSync(candidate).toString("base64");
          logoMime =
            candidate.toLowerCase().endsWith(".jpg") ||
            candidate.toLowerCase().endsWith(".jpeg")
              ? "image/jpeg"
              : "image/png";
          break;
        }
      }

      if (!logoBase64) {
        const fallback = path.join(process.cwd(), "public", "logo.png");
        if (fs.existsSync(fallback)) {
          logoBase64 = fs.readFileSync(fallback).toString("base64");
          logoMime = "image/png";
        }
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("⚠️ Error obteniendo logo de agencia:", e);
  }

  const currentAllocations = await prisma.investmentServiceAllocation.findMany({
    where: { investment_id: investment.id_investment },
    select: {
      service_id: true,
      service_currency: true,
      amount_service: true,
    },
  });

  const serviceIds = Array.isArray(investment.serviceIds) ? investment.serviceIds : [];
  const targetServiceIds = Array.from(
    new Set([
      ...serviceIds,
      ...currentAllocations.map((allocation) => allocation.service_id),
    ]),
  );
  const services = targetServiceIds.length
    ? await prisma.service.findMany({
        where: { id_service: { in: targetServiceIds }, id_agency: authAgencyId },
        select: {
          id_service: true,
          agency_service_id: true,
          booking_id: true,
          type: true,
          destination: true,
          cost_price: true,
          currency: true,
          booking: { select: { agency_booking_id: true } },
        },
      })
    : [];
  const serviceLabelById = new Map<number, string>(
    services.map((service) => {
      const parts = [`N° ${service.agency_service_id ?? service.id_service}`];
      if (service.type) parts.push(service.type);
      if (service.destination) parts.push(service.destination);
      return [service.id_service, parts.join(" · ")] as const;
    }),
  );
  const serviceCurrencyById = new Map<number, string>(
    services.map((service) => [service.id_service, String(service.currency || "ARS").toUpperCase()] as const),
  );
  const pdfItemsPayload = decodeInvestmentPdfItemsPayload(
    investment.counterparty_name,
  );
  const manualPdfItems = pdfItemsPayload.items;
  const servicesForPdf =
    manualPdfItems.length > 0
      ? manualPdfItems.map((item, idx) => ({
          id: -(idx + 1),
          isManual: true,
          manualIndex: idx + 1,
          description: item.description,
          dateLabel: item.date_label || null,
        }))
      : services.map((s) => ({
          id: s.id_service,
          serviceNumber: s.agency_service_id ?? s.id_service,
          bookingNumber: s.booking?.agency_booking_id ?? s.booking_id,
          type: s.type,
          destination: s.destination,
          cost: s.cost_price != null ? toNum(s.cost_price, 0) : null,
          currency: s.currency,
        }));
  let serviceBreakdownRows: OperatorPaymentPdfData["service_breakdown"] = [];
  if (categoryIsOperator && services.length > 0) {
    const normalizeHistoryPayment = (row: {
      id_investment: number;
      agency_investment_id: number | null;
      category: string;
      amount: unknown;
      currency: string;
      paid_at: Date | null;
      created_at: Date;
      base_amount: unknown;
      base_currency: string | null;
      counter_amount: unknown;
      counter_currency: string | null;
      serviceIds: number[];
    }) => ({
      payment_id: row.id_investment,
      payment_display_id: row.agency_investment_id ?? row.id_investment,
      amount: toNum(row.amount, 0),
      currency: String(row.currency || "ARS").toUpperCase(),
      paid_at: row.paid_at ?? null,
      created_at: row.created_at,
      base_amount: row.base_amount == null ? null : toNum(row.base_amount, 0),
      base_currency: row.base_currency,
      counter_amount:
        row.counter_amount == null ? null : toNum(row.counter_amount, 0),
      counter_currency: row.counter_currency,
      service_ids: Array.isArray(row.serviceIds) ? row.serviceIds : [],
      allocations: [] as Array<{
        service_id: number;
        service_currency: string;
        amount_service: number;
      }>,
    });

    const paymentMap = new Map<
      number,
      ReturnType<typeof normalizeHistoryPayment>
    >();

    const upsertPayment = (
      row: Parameters<typeof normalizeHistoryPayment>[0],
    ) => {
      if (!isOperatorCategoryName(row.category, operatorCategorySet)) return null;
      const existing = paymentMap.get(row.id_investment);
      if (existing) return existing;
      const normalized = normalizeHistoryPayment(row);
      paymentMap.set(row.id_investment, normalized);
      return normalized;
    };

    const pushAllocation = (
      paymentId: number,
      allocation: {
        service_id: number;
        service_currency: string;
        amount_service: number;
      },
    ) => {
      const target = paymentMap.get(paymentId);
      if (!target) return;
      target.allocations.push(allocation);
    };

    const allocationHistory = await prisma.investmentServiceAllocation.findMany({
      where: {
        service_id: { in: targetServiceIds },
        investment: { id_agency: authAgencyId },
      },
      select: {
        investment_id: true,
        service_id: true,
        service_currency: true,
        amount_service: true,
        investment: {
          select: {
            id_investment: true,
            agency_investment_id: true,
            category: true,
            amount: true,
            currency: true,
            paid_at: true,
            created_at: true,
            base_amount: true,
            base_currency: true,
            counter_amount: true,
            counter_currency: true,
            serviceIds: true,
          },
        },
      },
    });

    allocationHistory.forEach((row) => {
      if (!row.investment) return;
      const payment = upsertPayment(row.investment);
      if (!payment) return;
      pushAllocation(row.investment_id, {
        service_id: row.service_id,
        service_currency: String(
          row.service_currency || serviceCurrencyById.get(row.service_id) || "ARS",
        ).toUpperCase(),
        amount_service: toNum(row.amount_service, 0),
      });
    });

    const paymentsByServiceIds = await prisma.investment.findMany({
      where: {
        id_agency: authAgencyId,
        serviceIds: { hasSome: targetServiceIds },
      },
      select: {
        id_investment: true,
        agency_investment_id: true,
        category: true,
        amount: true,
        currency: true,
        paid_at: true,
        created_at: true,
        base_amount: true,
        base_currency: true,
        counter_amount: true,
        counter_currency: true,
        serviceIds: true,
      },
    });
    paymentsByServiceIds.forEach((row) => {
      upsertPayment(row);
    });

    if (!paymentMap.has(investment.id_investment)) {
      const current = upsertPayment({
        id_investment: investment.id_investment,
        agency_investment_id: investment.agency_investment_id ?? null,
        category: investment.category,
        amount: investment.amount,
        currency: investment.currency,
        paid_at: investment.paid_at ?? null,
        created_at: investment.created_at,
        base_amount: investment.base_amount,
        base_currency: investment.base_currency,
        counter_amount: investment.counter_amount,
        counter_currency: investment.counter_currency,
        serviceIds: Array.isArray(investment.serviceIds) ? investment.serviceIds : [],
      });
      if (current && currentAllocations.length > 0) {
        currentAllocations.forEach((allocation) => {
          pushAllocation(investment.id_investment, {
            service_id: allocation.service_id,
            service_currency: String(
              allocation.service_currency || serviceCurrencyById.get(allocation.service_id) || "ARS",
            ).toUpperCase(),
            amount_service: toNum(allocation.amount_service, 0),
          });
        });
      }
    }

    const breakdown = computeOperatorPaymentBreakdown({
      services: services.map((service) => ({
        service_id: service.id_service,
        service_label:
          serviceLabelById.get(service.id_service) ||
          `N° ${service.agency_service_id ?? service.id_service}`,
        service_currency: service.currency || "ARS",
        service_cost: service.cost_price != null ? toNum(service.cost_price, 0) : null,
      })),
      payments: Array.from(paymentMap.values()),
    });

    serviceBreakdownRows =
      breakdown.byPaymentId.get(investment.id_investment)?.service_rows ?? [];
  }

  const bookingNumbers = Array.from(
    new Set(
      services
        .map((s) => String(s.booking?.agency_booking_id ?? s.booking_id))
        .filter(Boolean),
    ),
  );
  if (bookingNumbers.length === 0 && investment.booking) {
    bookingNumbers.push(
      String(
        investment.booking.agency_booking_id ?? investment.booking.id_booking,
      ),
    );
  }

  const paymentNumber =
    investment.agency_investment_id != null
      ? String(investment.agency_investment_id)
      : String(investment.id_investment);
  const investmentPayments =
    hasPaymentLines && Array.isArray((investment as { payments?: unknown }).payments)
      ? ((investment as { payments: Array<Record<string, unknown>> }).payments ?? [])
      : [];
  const paymentLines =
    investmentPayments.length > 0
      ? investmentPayments.map((line) => ({
          amount: toNum(line.amount, 0),
          payment_method: String(line.payment_method || ""),
          account: typeof line.account === "string" ? line.account : null,
          payment_currency: String(
            line.payment_currency || investment.currency || "ARS",
          ).toUpperCase(),
          fee_mode:
            line.fee_mode === "FIXED" || line.fee_mode === "PERCENT"
              ? (line.fee_mode as "FIXED" | "PERCENT")
              : null,
          fee_value: line.fee_value != null ? toNum(line.fee_value, 0) : null,
          fee_amount: line.fee_amount != null ? toNum(line.fee_amount, 0) : 0,
        }))
      : [];
  const paymentFeeAmount =
    hasPaymentFeeAmount &&
    (investment as { payment_fee_amount?: unknown }).payment_fee_amount != null
      ? toNum(
          (investment as { payment_fee_amount?: unknown }).payment_fee_amount,
          0,
        )
      : paymentLines.length > 0
        ? paymentLines.reduce((sum, line) => sum + Number(line.fee_amount || 0), 0)
        : null;

  const data: OperatorPaymentPdfData = {
    paymentNumber,
    issueDate: investment.paid_at ?? investment.created_at ?? new Date(),
    paidDate: investment.paid_at ?? null,
    category: investment.category,
    description: investment.description,
    amount: toNum(investment.amount, 0),
    currency: String(investment.currency || "ARS").toUpperCase(),
    paymentMethod: investment.payment_method ?? null,
    account: investment.account ?? null,
    paymentFeeAmount,
    payments: paymentLines,
    base_amount:
      investment.base_amount != null ? toNum(investment.base_amount, 0) : null,
    base_currency: investment.base_currency ?? null,
    counter_amount:
      investment.counter_amount != null
        ? toNum(investment.counter_amount, 0)
        : null,
    counter_currency: investment.counter_currency ?? null,
    recipient: {
      id:
        investment.operator?.id_operator ??
        investment.user?.id_user ??
        investment.operator_id ??
        investment.user_id ??
        null,
      label: investment.operator
        ? "Operador"
        : investment.user
          ? "Usuario"
          : null,
      name: investment.operator?.name
        ? investment.operator.name
        : investment.user
          ? `${investment.user.first_name} ${investment.user.last_name}`.trim()
          : "",
    },
    bookingNumbers,
    services: servicesForPdf,
    service_breakdown: serviceBreakdownRows,
    agency: {
      name: agency?.name ?? "Agencia",
      legalName: agency?.legal_name ?? agency?.name ?? "-",
      taxId: agency?.tax_id ?? "-",
      address: agency?.address ?? "-",
      logoBase64,
      logoMime,
    },
  };

  const stream = await renderToStream(<OperatorPaymentDocument {...data} />);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=comprobante_pago_${paymentNumber}.pdf`,
  );
  stream.pipe(res);
}
