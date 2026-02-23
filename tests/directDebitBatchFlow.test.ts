import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SubscriptionRow = {
  id_subscription: number;
  id_agency: number;
  status: "ACTIVE";
  anchor_day: number;
  timezone: string;
  direct_debit_discount_pct: number;
  next_anchor_date: Date | null;
};

type PaymentMethodRow = {
  id_payment_method: number;
  subscription_id: number;
  method_type: "DIRECT_DEBIT_CBU_GALICIA";
  status: "ACTIVE" | "PENDING";
  is_default: boolean;
  holder_name: string;
  holder_tax_id: string;
  mandate: {
    status: "ACTIVE" | "PENDING";
    cbu_last4: string;
  };
};

type FxRateRow = {
  id_fx_rate: number;
  fx_type: "DOLAR_BSP";
  rate_date: Date;
  ars_per_usd: number;
};

type CycleRow = {
  id_cycle: number;
  id_agency: number;
  subscription_id: number;
  anchor_date: Date;
  period_start: Date;
  period_end: Date;
  status: string;
  fx_rate_date: Date | null;
  fx_rate_ars_per_usd: number | null;
  total_usd: number;
  total_ars: number;
};

type ChargeRow = {
  id_charge: number;
  id_agency: number;
  agency_billing_charge_id: number;
  subscription_id: number | null;
  cycle_id: number | null;
  due_date: Date | null;
  status: string;
  total_usd: number;
  amount_ars_due: number;
  amount_ars_paid: number | null;
  reconciliation_status: string | null;
  selected_method_id: number | null;
  idempotency_key: string | null;
  paid_reference: string | null;
  paid_at: Date | null;
  paid_currency: string | null;
};

type AttemptRow = {
  id_attempt: number;
  charge_id: number;
  payment_method_id: number | null;
  attempt_no: number;
  status: string;
  channel: string;
  scheduled_for: Date | null;
  processed_at: Date | null;
  external_reference: string | null;
  paid_reference: string | null;
  rejection_code: string | null;
  rejection_reason: string | null;
  notes: string | null;
  processor_result_code: string | null;
  processor_result_message: string | null;
  processor_trace_id: string | null;
  processor_settlement_date: Date | null;
  processor_raw_payload: Record<string, unknown> | null;
};

type BatchRow = {
  id_batch: number;
  parent_batch_id: number | null;
  direction: string;
  channel: string;
  file_type: string;
  adapter: string | null;
  adapter_version: string | null;
  business_date: Date;
  original_file_name: string | null;
  storage_key: string | null;
  sha256: string | null;
  file_hash: string | null;
  record_count: number | null;
  amount_total: number | null;
  exported_at: Date | null;
  imported_at: Date | null;
  status: string;
  total_rows: number;
  total_amount_ars: number | null;
  total_paid_rows: number;
  total_rejected_rows: number;
  total_error_rows: number;
  meta: Record<string, unknown> | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
};

type BatchItemRow = {
  id_item: number;
  batch_id: number;
  attempt_id: number | null;
  charge_id: number | null;
  line_no: number | null;
  external_reference: string | null;
  raw_hash: string | null;
  amount_ars: number | null;
  status: string;
  response_code: string | null;
  response_message: string | null;
  paid_reference: string | null;
  row_payload: Record<string, unknown> | null;
  processed_at: Date | null;
};

type FiscalDocumentRow = {
  id_fiscal_document: number;
  charge_id: number;
  document_type: string;
  status: string;
  external_reference: string | null;
  afip_pto_vta: number | null;
  afip_cbte_tipo: number | null;
  afip_number: string | null;
  afip_cae: string | null;
  afip_cae_due: Date | null;
  payload: Record<string, unknown> | null;
  error_message: string | null;
  retry_count: number;
  issued_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

let subscriptions: SubscriptionRow[] = [];
let paymentMethods: PaymentMethodRow[] = [];
let fxRates: FxRateRow[] = [];
let cycles: CycleRow[] = [];
let charges: ChargeRow[] = [];
let attempts: AttemptRow[] = [];
let batches: BatchRow[] = [];
let batchItems: BatchItemRow[] = [];
let fiscalDocuments: FiscalDocumentRow[] = [];
let events: Array<Record<string, unknown>> = [];
let storage = new Map<string, Buffer>();
let counters = new Map<string, number>();
const onPdAttemptPaidMock = vi.fn();
const onPdAttemptRejectedMock = vi.fn();

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildGaliciaInboundResponseFile(input: {
  records: Array<{
    externalReference: string;
    bankResultCode: string;
    bankResultMessage?: string;
    amountArs: number;
    settledAt?: string;
    processorTraceId?: string;
    operationId?: string;
  }>;
  businessDate?: string;
}): Buffer {
  const businessDate = input.businessDate || "20260219";
  const total = round2(
    input.records.reduce((acc, item) => acc + Number(item.amountArs || 0), 0),
  );

  const lines = [
    `H|GALICIA_PD_RESP|v1.0|0001|PD|${businessDate}|${input.records.length}|${total.toFixed(2)}|`,
    ...input.records.map((item, idx) => {
      const settledAt = item.settledAt || "20260219120000";
      return [
        "D",
        String(idx + 1),
        item.externalReference,
        item.bankResultCode,
        item.bankResultMessage || "",
        round2(item.amountArs).toFixed(2),
        settledAt,
        item.processorTraceId || "",
        item.operationId || "",
      ].join("|");
    }),
    `T|${input.records.length}|${total.toFixed(2)}|`,
  ];

  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function nextId(rows: Array<{ [k: string]: unknown }>, key: string): number {
  const max = rows.reduce((acc, row) => {
    const value = Number(row[key] ?? 0);
    return Number.isFinite(value) && value > acc ? value : acc;
  }, 0);
  return max + 1;
}

function isInStatus(status: string, list?: string[]): boolean {
  if (!list || list.length === 0) return true;
  return list.includes(status);
}

const txMock = {
  agencyBillingPaymentMethod: {
    findFirst: vi.fn(async (args?: { where?: { subscription_id?: number; status?: { in?: string[] } } }) => {
      const subscriptionId = args?.where?.subscription_id;
      const statusIn = args?.where?.status?.in;

      const items = paymentMethods
        .filter((item) => (subscriptionId == null ? true : item.subscription_id === subscriptionId))
        .filter((item) => isInStatus(item.status, statusIn))
        .sort((a, b) => {
          if (a.is_default === b.is_default) return a.id_payment_method - b.id_payment_method;
          return a.is_default ? -1 : 1;
        });

      return items[0] || null;
    }),
  },
  agencyBillingConfig: {
    findUnique: vi.fn(async () => ({
      plan_key: "basico",
      billing_users: 3,
      user_limit: null,
    })),
  },
  agencyBillingAdjustment: {
    findMany: vi.fn(async () => []),
  },
  agencyBillingCycle: {
    findUnique: vi.fn(async ({ where }: { where: { agency_billing_cycle_unique: { subscription_id: number; anchor_date: Date } } }) => {
      const key = where.agency_billing_cycle_unique;
      return (
        cycles.find(
          (item) =>
            item.subscription_id === key.subscription_id &&
            item.anchor_date.getTime() === key.anchor_date.getTime(),
        ) || null
      );
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: CycleRow = {
        id_cycle: nextId(cycles, "id_cycle"),
        id_agency: Number(data.id_agency),
        subscription_id: Number(data.subscription_id),
        anchor_date: data.anchor_date as Date,
        period_start: data.period_start as Date,
        period_end: data.period_end as Date,
        status: String(data.status || "FROZEN"),
        fx_rate_date: (data.fx_rate_date as Date | null) ?? null,
        fx_rate_ars_per_usd: data.fx_rate_ars_per_usd == null ? null : Number(data.fx_rate_ars_per_usd),
        total_usd: Number(data.total_usd ?? 0),
        total_ars: Number(data.total_ars ?? 0),
      };
      cycles.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id_cycle: number }; data: Record<string, unknown> }) => {
      const row = cycles.find((item) => item.id_cycle === where.id_cycle);
      if (!row) throw new Error("cycle not found");
      Object.assign(row, data);
      return row;
    }),
  },
  agencyBillingCharge: {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if ("id_charge" in where) {
        return charges.find((item) => item.id_charge === Number(where.id_charge)) || null;
      }

      const key = (where.agency_billing_charge_idempotency_unique as {
        id_agency: number;
        idempotency_key: string;
      }) || { id_agency: 0, idempotency_key: "" };

      return (
        charges.find(
          (item) => item.id_agency === key.id_agency && item.idempotency_key === key.idempotency_key,
        ) || null
      );
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: ChargeRow = {
        id_charge: nextId(charges, "id_charge"),
        id_agency: Number(data.id_agency),
        agency_billing_charge_id: Number(data.agency_billing_charge_id),
        subscription_id: (data.subscription_id as number | null) ?? null,
        cycle_id: (data.cycle_id as number | null) ?? null,
        due_date: (data.due_date as Date | null) ?? null,
        status: String(data.status || "READY"),
        total_usd: Number(data.total_usd ?? 0),
        amount_ars_due: Number(data.amount_ars_due ?? 0),
        amount_ars_paid: null,
        reconciliation_status: (data.reconciliation_status as string | null) ?? null,
        selected_method_id: (data.selected_method_id as number | null) ?? null,
        idempotency_key: (data.idempotency_key as string | null) ?? null,
        paid_reference: null,
        paid_at: null,
        paid_currency: null,
      };
      charges.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const ids = ((where.id_charge as { in?: number[] } | undefined)?.in || []) as number[];
      const statusIn = ((where.status as { in?: string[] } | undefined)?.in || []) as string[];

      let count = 0;
      for (const row of charges) {
        const matchesId = ids.length ? ids.includes(row.id_charge) : true;
        const matchesStatus = statusIn.length ? statusIn.includes(row.status) : true;
        if (matchesId && matchesStatus) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    }),
    update: vi.fn(async ({ where, data }: { where: { id_charge: number }; data: Record<string, unknown> }) => {
      const row = charges.find((item) => item.id_charge === where.id_charge);
      if (!row) throw new Error("charge not found");
      Object.assign(row, data);
      return row;
    }),
  },
  agencyBillingAttempt: {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if ("id_attempt" in where) {
        return attempts.find((item) => item.id_attempt === Number(where.id_attempt)) || null;
      }

      const key = where.agency_billing_attempt_unique as {
        charge_id: number;
        attempt_no: number;
      };
      return (
        attempts.find(
          (item) => item.charge_id === key.charge_id && item.attempt_no === key.attempt_no,
        ) || null
      );
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: AttemptRow = {
        id_attempt: nextId(attempts, "id_attempt"),
        charge_id: Number(data.charge_id),
        payment_method_id: (data.payment_method_id as number | null) ?? null,
        attempt_no: Number(data.attempt_no ?? 1),
        status: String(data.status || "PENDING"),
        channel: String(data.channel || "OFFICE_BANKING"),
        scheduled_for: (data.scheduled_for as Date | null) ?? null,
        processed_at: (data.processed_at as Date | null) ?? null,
        external_reference: (data.external_reference as string | null) ?? null,
        paid_reference: (data.paid_reference as string | null) ?? null,
        rejection_code: (data.rejection_code as string | null) ?? null,
        rejection_reason: (data.rejection_reason as string | null) ?? null,
        notes: (data.notes as string | null) ?? null,
        processor_result_code: (data.processor_result_code as string | null) ?? null,
        processor_result_message: (data.processor_result_message as string | null) ?? null,
        processor_trace_id: (data.processor_trace_id as string | null) ?? null,
        processor_settlement_date: (data.processor_settlement_date as Date | null) ?? null,
        processor_raw_payload: (data.processor_raw_payload as Record<string, unknown> | null) ?? null,
      };
      attempts.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id_attempt: number }; data: Record<string, unknown> }) => {
      const row = attempts.find((item) => item.id_attempt === where.id_attempt);
      if (!row) throw new Error("attempt not found");
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of attempts) {
        const matchesCharge = where.charge_id == null || row.charge_id === Number(where.charge_id);
        const gtAttemptNo = (where.attempt_no as { gt?: number } | undefined)?.gt;
        const matchesAttemptGt = gtAttemptNo == null || row.attempt_no > gtAttemptNo;

        const idIn = (where.id_attempt as { in?: number[] } | undefined)?.in;
        const matchesId = !idIn || idIn.includes(row.id_attempt);

        const statusEquals = typeof where.status === "string" ? where.status : null;
        const statusIn = ((where.status as { in?: string[] } | undefined)?.in || null) as
          | string[]
          | null;

        const matchesStatus = statusEquals
          ? row.status === statusEquals
          : statusIn
            ? statusIn.includes(row.status)
            : true;

        if (matchesCharge && matchesAttemptGt && matchesId && matchesStatus) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    }),
  },
  agencyBillingSubscription: {
    update: vi.fn(async ({ where, data }: { where: { id_subscription: number }; data: { next_anchor_date: Date } }) => {
      const row = subscriptions.find((item) => item.id_subscription === where.id_subscription);
      if (!row) throw new Error("subscription not found");
      row.next_anchor_date = data.next_anchor_date;
      return row;
    }),
  },
  agencyBillingFileBatch: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: BatchRow = {
        id_batch: nextId(batches, "id_batch"),
        parent_batch_id: (data.parent_batch_id as number | null) ?? null,
        direction: String(data.direction),
        channel: String(data.channel),
        file_type: String(data.file_type),
        adapter: (data.adapter as string | null) ?? null,
        adapter_version: (data.adapter_version as string | null) ?? null,
        business_date: data.business_date as Date,
        original_file_name: (data.original_file_name as string | null) ?? null,
        storage_key: (data.storage_key as string | null) ?? null,
        sha256: (data.sha256 as string | null) ?? null,
        file_hash: (data.file_hash as string | null) ?? null,
        record_count: data.record_count == null ? null : Number(data.record_count),
        amount_total: data.amount_total == null ? null : Number(data.amount_total),
        exported_at: (data.exported_at as Date | null) ?? null,
        imported_at: (data.imported_at as Date | null) ?? null,
        status: String(data.status || "CREATED"),
        total_rows: Number(data.total_rows ?? 0),
        total_amount_ars:
          data.total_amount_ars == null ? null : Number(data.total_amount_ars),
        total_paid_rows: Number(data.total_paid_rows ?? 0),
        total_rejected_rows: Number(data.total_rejected_rows ?? 0),
        total_error_rows: Number(data.total_error_rows ?? 0),
        meta: (data.meta as Record<string, unknown> | null) ?? null,
        created_by: (data.created_by as number | null) ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      batches.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id_batch: number }; data: Record<string, unknown> }) => {
      const row = batches.find((item) => item.id_batch === where.id_batch);
      if (!row) throw new Error("batch not found");
      Object.assign(row, data, { updated_at: new Date() });
      return row;
    }),
  },
  agencyBillingFileBatchItem: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: BatchItemRow = {
        id_item: nextId(batchItems, "id_item"),
        batch_id: Number(data.batch_id),
        attempt_id: (data.attempt_id as number | null) ?? null,
        charge_id: (data.charge_id as number | null) ?? null,
        line_no: (data.line_no as number | null) ?? null,
        external_reference: (data.external_reference as string | null) ?? null,
        raw_hash: (data.raw_hash as string | null) ?? null,
        amount_ars: data.amount_ars == null ? null : Number(data.amount_ars),
        status: String(data.status || "PENDING"),
        response_code: (data.response_code as string | null) ?? null,
        response_message: (data.response_message as string | null) ?? null,
        paid_reference: (data.paid_reference as string | null) ?? null,
        row_payload: (data.row_payload as Record<string, unknown> | null) ?? null,
        processed_at: (data.processed_at as Date | null) ?? null,
      };
      batchItems.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id_item: number }; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of batchItems) {
        if (row.id_item === where.id_item) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    }),
  },
  agencyBillingFiscalDocument: {
    findUnique: vi.fn(async ({ where }: { where: { agency_billing_fiscal_unique: { charge_id: number; document_type: string } } }) => {
      const key = where.agency_billing_fiscal_unique;
      return (
        fiscalDocuments.find(
          (item) => item.charge_id === key.charge_id && item.document_type === key.document_type,
        ) || null
      );
    }),
    upsert: vi.fn(async ({ where, create, update }: {
      where: { agency_billing_fiscal_unique: { charge_id: number; document_type: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = where.agency_billing_fiscal_unique;
      const existing = fiscalDocuments.find(
        (item) => item.charge_id === key.charge_id && item.document_type === key.document_type,
      );

      if (existing) {
        const currentRetry = Number(existing.retry_count || 0);
        const increment =
          ((update.retry_count as { increment?: number } | undefined)?.increment || 0) as number;

        Object.assign(existing, {
          ...update,
          retry_count: currentRetry + increment,
          updated_at: new Date(),
        });
        return existing;
      }

      const row: FiscalDocumentRow = {
        id_fiscal_document: nextId(fiscalDocuments, "id_fiscal_document"),
        charge_id: Number(create.charge_id),
        document_type: String(create.document_type || "INVOICE_B"),
        status: String(create.status || "PENDING"),
        external_reference: null,
        afip_pto_vta: null,
        afip_cbte_tipo: null,
        afip_number: null,
        afip_cae: null,
        afip_cae_due: null,
        payload: null,
        error_message: null,
        retry_count: Number(create.retry_count ?? 0),
        issued_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      fiscalDocuments.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id_fiscal_document: number }; data: Record<string, unknown> }) => {
      const row = fiscalDocuments.find((item) => item.id_fiscal_document === where.id_fiscal_document);
      if (!row) throw new Error("fiscal not found");
      Object.assign(row, data, { updated_at: new Date() });
      return row;
    }),
  },
  agencyBillingEvent: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      events.push(data);
      return data;
    }),
  },
};

const prismaMock = {
  agencyBillingSubscription: {
    findMany: vi.fn(async ({ where }: { where?: { status?: string } } = {}) => {
      if (!where?.status) return subscriptions;
      return subscriptions.filter((item) => item.status === where.status);
    }),
    update: txMock.agencyBillingSubscription.update,
  },
  billingFxRate: {
    findUnique: vi.fn(async ({ where }: { where: { fx_type_rate_date: { fx_type: "DOLAR_BSP"; rate_date: Date } } }) => {
      const key = where.fx_type_rate_date;
      return (
        fxRates.find(
          (item) => item.fx_type === key.fx_type && item.rate_date.getTime() === key.rate_date.getTime(),
        ) || null
      );
    }),
    findFirst: vi.fn(async ({ where }: { where: { rate_date: { lte: Date } } }) => {
      return (
        fxRates
          .filter((item) => item.rate_date.getTime() <= where.rate_date.lte.getTime())
          .sort((a, b) => b.rate_date.getTime() - a.rate_date.getTime())[0] || null
      );
    }),
  },
  agencyBillingAttempt: {
    findMany: vi.fn(async ({ where }: { where: { status?: string; channel?: string; scheduled_for?: { lte?: Date } } }) => {
      const list = attempts
        .filter((item) => (where.status ? item.status === where.status : true))
        .filter((item) => (where.channel ? item.channel === where.channel : true))
        .filter((item) => {
          if (!where.scheduled_for?.lte) return true;
          if (!item.scheduled_for) return false;
          return item.scheduled_for.getTime() <= where.scheduled_for.lte.getTime();
        })
        .sort((a, b) => {
          const aTime = a.scheduled_for?.getTime() || 0;
          const bTime = b.scheduled_for?.getTime() || 0;
          if (aTime !== bTime) return aTime - bTime;
          return a.id_attempt - b.id_attempt;
        });

      return list.map((item) => {
        const charge = charges.find((c) => c.id_charge === item.charge_id) || null;
        const paymentMethod =
          paymentMethods.find((pm) => pm.id_payment_method === item.payment_method_id) || null;

        return {
          ...item,
          charge,
          paymentMethod,
        };
      });
    }),
    findUnique: txMock.agencyBillingAttempt.findUnique,
    update: txMock.agencyBillingAttempt.update,
    updateMany: txMock.agencyBillingAttempt.updateMany,
    create: txMock.agencyBillingAttempt.create,
  },
  agencyBillingCharge: {
    findUnique: txMock.agencyBillingCharge.findUnique,
    findMany: vi.fn(async ({ where, select }: {
      where?: { id_charge?: { in?: number[] } };
      select?: { id_agency?: boolean };
    } = {}) => {
      const ids = where?.id_charge?.in || [];
      const list = charges.filter((item) => (ids.length ? ids.includes(item.id_charge) : true));
      if (select?.id_agency) {
        return list.map((item) => ({ id_agency: item.id_agency }));
      }
      return list;
    }),
    update: txMock.agencyBillingCharge.update,
    updateMany: txMock.agencyBillingCharge.updateMany,
    create: txMock.agencyBillingCharge.create,
  },
  agencyBillingCycle: {
    findUnique: txMock.agencyBillingCycle.findUnique,
    create: txMock.agencyBillingCycle.create,
    update: txMock.agencyBillingCycle.update,
  },
  agencyBillingPaymentMethod: txMock.agencyBillingPaymentMethod,
  agencyBillingConfig: txMock.agencyBillingConfig,
  agencyBillingAdjustment: txMock.agencyBillingAdjustment,
  agencyBillingFileBatch: {
    create: txMock.agencyBillingFileBatch.create,
    update: txMock.agencyBillingFileBatch.update,
    findUnique: vi.fn(async ({ where, include, select }: {
      where: { id_batch: number };
      include?: { items?: unknown };
      select?: { items?: unknown };
    }) => {
      const row = batches.find((item) => item.id_batch === where.id_batch);
      if (!row) return null;
      const needsItems = Boolean(include?.items || select?.items);
      if (!needsItems) return row;

      return {
        ...row,
        items: batchItems
          .filter((item) => item.batch_id === row.id_batch)
          .map((item) => ({
            id_item: item.id_item,
            attempt_id: item.attempt_id,
            charge_id: item.charge_id,
            external_reference: item.external_reference,
            raw_hash: item.raw_hash,
            amount_ars: item.amount_ars,
            line_no: item.line_no,
            row_payload: item.row_payload,
            status: item.status,
            attempt:
              item.attempt_id == null
                ? null
                : (() => {
                    const attempt = attempts.find((a) => a.id_attempt === item.attempt_id);
                    if (!attempt) return null;
                    const charge =
                      charges.find((c) => c.id_charge === attempt.charge_id) || null;
                    const paymentMethod =
                      paymentMethods.find((pm) => pm.id_payment_method === attempt.payment_method_id) ||
                      null;
                    return {
                      id_attempt: attempt.id_attempt,
                      external_reference: attempt.external_reference,
                      scheduled_for: attempt.scheduled_for,
                      charge: charge
                        ? {
                            id_charge: charge.id_charge,
                            id_agency: charge.id_agency,
                            amount_ars_due: charge.amount_ars_due,
                          }
                        : null,
                      paymentMethod: paymentMethod
                        ? {
                            holder_name: paymentMethod.holder_name,
                            holder_tax_id: paymentMethod.holder_tax_id,
                            mandate: paymentMethod.mandate
                              ? { cbu_last4: paymentMethod.mandate.cbu_last4 }
                              : null,
                          }
                        : null,
                    };
                  })(),
          })),
      };
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return (
        batches.find((item) => {
          if (typeof where.direction === "string" && item.direction !== where.direction) {
            return false;
          }

          if (
            where.parent_batch_id != null &&
            item.parent_batch_id !== Number(where.parent_batch_id)
          ) {
            return false;
          }

          if (typeof where.adapter === "string" && item.adapter !== where.adapter) {
            return false;
          }

          const or = (where.OR as Array<Record<string, unknown>> | undefined) || [];
          if (or.length > 0) {
            return or.some((cond) => {
              const hashMatch =
                (typeof cond.file_hash === "string" && item.file_hash === cond.file_hash) ||
                (typeof cond.sha256 === "string" && item.sha256 === cond.sha256);

              const recordCountExpected =
                cond.record_count == null
                  ? cond.total_rows == null
                    ? null
                    : Number(cond.total_rows)
                  : Number(cond.record_count);

              const recordCountActual =
                item.record_count == null ? item.total_rows : item.record_count;

              const amountExpectedRaw =
                cond.amount_total == null ? cond.total_amount_ars : cond.amount_total;
              const amountExpected =
                amountExpectedRaw == null ? null : round2(Number(amountExpectedRaw));

              const amountActualRaw =
                item.amount_total == null ? item.total_amount_ars : item.amount_total;
              const amountActual =
                amountActualRaw == null ? null : round2(Number(amountActualRaw));

              return (
                hashMatch &&
                (recordCountExpected == null || recordCountActual === recordCountExpected) &&
                (amountExpected == null || amountActual === amountExpected)
              );
            });
          }

          if (typeof where.sha256 === "string") {
            return item.sha256 === where.sha256;
          }

          return true;
        }) || null
      );
    }),
    findMany: vi.fn(async () => batches),
  },
  agencyBillingFileBatchItem: {
    create: txMock.agencyBillingFileBatchItem.create,
    updateMany: txMock.agencyBillingFileBatchItem.updateMany,
  },
  agencyBillingFiscalDocument: {
    findUnique: txMock.agencyBillingFiscalDocument.findUnique,
    upsert: txMock.agencyBillingFiscalDocument.upsert,
    update: txMock.agencyBillingFiscalDocument.update,
  },
  agencyBillingEvent: txMock.agencyBillingEvent,
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof txMock) => Promise<unknown>)(txMock);
    }
    throw new Error("Unsupported prisma.$transaction signature in test");
  }),
};

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

vi.mock("@/lib/agencyCounters", () => ({
  getNextAgencyCounter: vi.fn(async (_tx: unknown, agencyId: number, key: string) => {
    const mapKey = `${agencyId}:${key}`;
    const next = (counters.get(mapKey) || 0) + 1;
    counters.set(mapKey, next);
    return next;
  }),
}));

vi.mock("@/services/collections/galicia/direct-debit/storage", () => ({
  uploadBatchFile: vi.fn(async ({ storageKey, bytes }: { storageKey: string; bytes: Buffer }) => {
    storage.set(storageKey, Buffer.from(bytes));
  }),
  readBatchFile: vi.fn(async (storageKey: string) => {
    const bytes = storage.get(storageKey);
    if (!bytes) throw new Error("Archivo no encontrado en storage de test");
    return Buffer.from(bytes);
  }),
  sha256OfBuffer: vi.fn((bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex"),
  ),
}));

vi.mock("@/services/afip/afipConfig", () => ({
  getAfipForAgency: vi.fn(async () => {
    throw new Error("No debería invocarse AFIP real en este test");
  }),
}));

vi.mock("@/services/collections/dunning/service", () => ({
  onPdAttemptPaid: onPdAttemptPaidMock,
  onPdAttemptRejected: onPdAttemptRejectedMock,
}));

describe("direct debit batch flow (integration-like)", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    process.env.BILLING_FISCAL_ISSUER_MODE = "MOCK";
    process.env.BILLING_FISCAL_AUTORUN = "false";
    process.env.BILLING_PD_ADAPTER = "debug_csv";

    onPdAttemptPaidMock.mockReset();
    onPdAttemptRejectedMock.mockReset();

    onPdAttemptPaidMock.mockImplementation(
      async (input: {
        chargeId: number;
        amount?: number | null;
        paidAt?: Date | null;
        sourceRef?: string | null;
        tx?: typeof txMock;
      }) => {
        const tx = input.tx || txMock;
        const charge = await tx.agencyBillingCharge.findUnique({
          where: { id_charge: input.chargeId },
        });
        if (!charge) throw new Error("charge not found");
        if (charge.status === "PAID") {
          return {
            closed: false,
            already_paid: true,
            charge_id: charge.id_charge,
            agency_id: charge.id_agency,
            paid_via_channel: "PD_GALICIA",
            paid_at: charge.paid_at,
            amount_ars_paid: charge.amount_ars_paid,
          };
        }

        const paidAt = input.paidAt || new Date();
        const paidAmount = Number(input.amount ?? charge.amount_ars_due ?? 0);

        await tx.agencyBillingCharge.update({
          where: { id_charge: charge.id_charge },
          data: {
            status: "PAID",
            amount_ars_paid: paidAmount,
            paid_at: paidAt,
            paid_reference: input.sourceRef || null,
            reconciliation_status: "MATCHED",
            paid_currency: "ARS",
          },
        });

        await tx.agencyBillingAttempt.updateMany({
          where: {
            charge_id: charge.id_charge,
            status: { in: ["PENDING", "SCHEDULED", "PROCESSING"] },
          },
          data: {
            status: "CANCELED",
            processed_at: paidAt,
          },
        });

        if (charge.cycle_id) {
          await tx.agencyBillingCycle.update({
            where: { id_cycle: charge.cycle_id },
            data: { status: "PAID" },
          });
        }

        await tx.agencyBillingEvent.create({
          data: {
            id_agency: charge.id_agency,
            subscription_id: null,
            event_type: "BILLING_CHARGE_PAID",
            payload: {
              charge_id: charge.id_charge,
              agency_id: charge.id_agency,
              paid_at: paidAt,
              amount: paidAmount,
              channel: "PD_GALICIA",
            },
            created_by: null,
          },
        });

        return {
          closed: true,
          already_paid: false,
          charge_id: charge.id_charge,
          agency_id: charge.id_agency,
          paid_via_channel: "PD_GALICIA",
          paid_at: paidAt,
          amount_ars_paid: paidAmount,
        };
      },
    );

    onPdAttemptRejectedMock.mockResolvedValue({
      stage: 1,
      fallback_created: false,
      fallback_intent_id: null,
      reason: null,
    });

    subscriptions = [
      {
        id_subscription: 1,
        id_agency: 3,
        status: "ACTIVE",
        anchor_day: 8,
        timezone: "America/Argentina/Buenos_Aires",
        direct_debit_discount_pct: 10,
        next_anchor_date: null,
      },
    ];

    paymentMethods = [
      {
        id_payment_method: 10,
        subscription_id: 1,
        method_type: "DIRECT_DEBIT_CBU_GALICIA",
        status: "ACTIVE",
        is_default: true,
        holder_name: "Agencia Demo",
        holder_tax_id: "20123456789",
        mandate: {
          status: "ACTIVE",
          cbu_last4: "1233",
        },
      },
    ];

    fxRates = [
      {
        id_fx_rate: 1,
        fx_type: "DOLAR_BSP",
        rate_date: new Date("2026-02-08T03:00:00.000Z"),
        ars_per_usd: 1350.75,
      },
    ];

    cycles = [];
    charges = [];
    attempts = [];
    batches = [];
    batchItems = [];
    fiscalDocuments = [];
    events = [];
    storage = new Map();
    counters = new Map();
  });

  async function seedAndCreateOutbound() {
    const { runAnchor } = await import("@/services/collections/core/runAnchor");
    const { createPresentmentBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );

    const anchorSummary = await runAnchor({
      anchorDate: new Date("2026-02-19T12:00:00.000Z"),
      overrideFx: false,
      actorUserId: 36,
      actorAgencyId: 3,
    });

    expect(anchorSummary.errors).toHaveLength(0);
    expect(anchorSummary.cycles_created).toBe(1);
    expect(anchorSummary.charges_created).toBe(1);
    expect(anchorSummary.attempts_created).toBe(3);

    const outbound = await createPresentmentBatch({
      businessDate: new Date("2026-02-19T12:00:00.000Z"),
      actorUserId: 36,
    });

    expect(["READY", "EXPORTED"]).toContain(outbound.batch.status);
    expect(outbound.batch.total_rows).toBe(3);
    expect(outbound.batch.storage_key).toBeTruthy();

    const outboundItems = batchItems
      .filter((item) => item.batch_id === outbound.batch.id_batch && item.attempt_id != null)
      .sort((a, b) => Number(a.attempt_id) - Number(b.attempt_id));

    expect(outboundItems).toHaveLength(3);

    return {
      outbound,
      outboundItems,
    };
  }

  it("runAnchor -> create batch -> import PAID response -> updates attempt/charge and desacopla fiscal por default", async () => {
    const { importResponseBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );
    const { buildDebugResponseCsv } = await import(
      "@/services/collections/galicia/direct-debit/adapters/debugCsvAdapter"
    );

    const { outbound, outboundItems } = await seedAndCreateOutbound();

    const firstOutbound = outboundItems[0];
    const paidAmount = round2(charges[0]?.amount_ars_due || 0);

    const responseBytes = buildDebugResponseCsv({
      records: [
        {
          externalReference: String(firstOutbound.external_reference),
          result: "PAID",
          amountArs: paidAmount,
          paidReference: "PD-RESP-OK-1",
        },
      ],
    });

    const imported = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "respuesta-debug.csv",
        bytes: responseBytes,
        contentType: "text/csv",
      },
      actorUserId: 36,
    });

    expect(imported.summary.matched_rows).toBe(1);
    expect(imported.summary.paid).toBe(1);
    expect(imported.summary.rejected).toBe(0);

    const paidAttempt = attempts.find((item) => item.id_attempt === firstOutbound.attempt_id);
    expect(paidAttempt?.status).toBe("PAID");
    expect(paidAttempt?.paid_reference).toBe("PD-RESP-OK-1");

    const charge = charges[0];
    expect(charge?.status).toBe("PAID");
    expect(charge?.amount_ars_paid).toBe(paidAmount);
    expect(charge?.reconciliation_status).toBe("MATCHED");

    const futureAttempts = attempts.filter((item) => item.attempt_no > 1);
    expect(futureAttempts.every((item) => item.status === "CANCELED")).toBe(true);

    expect(fiscalDocuments).toHaveLength(0);
    expect(
      events.some(
        (event) =>
          event.event_type === "BILLING_CHARGE_PAID" &&
          Number((event.payload as { charge_id?: number } | undefined)?.charge_id) ===
            charge?.id_charge,
      ),
    ).toBe(true);
  });

  it("galicia_pd_v1: inbound PAID persiste metadata bancaria y marca cobro", async () => {
    process.env.BILLING_PD_ADAPTER = "galicia_pd_v1";

    const { importResponseBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );
    const { outbound, outboundItems } = await seedAndCreateOutbound();

    const firstOutbound = outboundItems[0];
    const paidAmount = round2(charges[0]?.amount_ars_due || 0);

    const responseBytes = buildGaliciaInboundResponseFile({
      records: [
        {
          externalReference: String(firstOutbound.external_reference),
          bankResultCode: "00",
          bankResultMessage: "PAGO_OK",
          amountArs: paidAmount,
          processorTraceId: "TRC-OK-1",
          operationId: "OP-OK-1",
        },
      ],
    });

    const imported = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "galicia-respuesta-ok.txt",
        bytes: responseBytes,
        contentType: "text/plain",
      },
      actorUserId: 36,
    });

    expect(imported.summary.matched_rows).toBe(1);
    expect(imported.summary.paid).toBe(1);
    expect(imported.summary.rejected).toBe(0);
    expect(imported.summary.error_rows).toBe(0);

    const paidAttempt = attempts.find((item) => item.id_attempt === firstOutbound.attempt_id);
    expect(paidAttempt?.status).toBe("PAID");
    expect(paidAttempt?.processor_result_code).toBe("00");
    expect(paidAttempt?.processor_trace_id).toBe("TRC-OK-1");
    expect(paidAttempt?.paid_reference).toBe("OP-OK-1");

    const charge = charges[0];
    expect(charge?.status).toBe("PAID");
    expect(charge?.reconciliation_status).toBe("MATCHED");
  });

  it("galicia_pd_v1: inbound REJECTED deja charge para mora/reintento", async () => {
    process.env.BILLING_PD_ADAPTER = "galicia_pd_v1";

    const { importResponseBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );
    const { outbound, outboundItems } = await seedAndCreateOutbound();

    const firstOutbound = outboundItems[0];
    const dueAmount = round2(charges[0]?.amount_ars_due || 0);

    const responseBytes = buildGaliciaInboundResponseFile({
      records: [
        {
          externalReference: String(firstOutbound.external_reference),
          bankResultCode: "51",
          bankResultMessage: "FONDOS_INSUFICIENTES",
          amountArs: dueAmount,
          processorTraceId: "TRC-REJ-1",
          operationId: "OP-REJ-1",
        },
      ],
    });

    const imported = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "galicia-respuesta-rej.txt",
        bytes: responseBytes,
        contentType: "text/plain",
      },
      actorUserId: 36,
    });

    expect(imported.summary.paid).toBe(0);
    expect(imported.summary.rejected).toBe(1);
    expect(imported.summary.error_rows).toBe(0);

    const rejectedAttempt = attempts.find((item) => item.id_attempt === firstOutbound.attempt_id);
    expect(rejectedAttempt?.status).toBe("REJECTED");
    expect(rejectedAttempt?.rejection_code).toBe("51");
    expect(rejectedAttempt?.processor_result_message).toBe("FONDOS_INSUFICIENTES");

    const charge = charges[0];
    expect(charge?.status).toBe("PAST_DUE");
    expect(charge?.reconciliation_status).toBe("UNMATCHED");
  });

  it("galicia_pd_v1: inbound ERROR no cierra charge", async () => {
    process.env.BILLING_PD_ADAPTER = "galicia_pd_v1";

    const { importResponseBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );
    const { outbound, outboundItems } = await seedAndCreateOutbound();

    const firstOutbound = outboundItems[0];
    const dueAmount = round2(charges[0]?.amount_ars_due || 0);

    const responseBytes = buildGaliciaInboundResponseFile({
      records: [
        {
          externalReference: String(firstOutbound.external_reference),
          bankResultCode: "96",
          bankResultMessage: "ERROR_FORMAT",
          amountArs: dueAmount,
          processorTraceId: "TRC-ERR-1",
          operationId: "OP-ERR-1",
        },
      ],
    });

    const imported = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "galicia-respuesta-error.txt",
        bytes: responseBytes,
        contentType: "text/plain",
      },
      actorUserId: 36,
    });

    expect(imported.summary.paid).toBe(0);
    expect(imported.summary.rejected).toBe(0);
    expect(imported.summary.error_rows).toBe(1);

    const failedAttempt = attempts.find((item) => item.id_attempt === firstOutbound.attempt_id);
    expect(failedAttempt?.status).toBe("FAILED");
    expect(failedAttempt?.processor_result_code).toBe("96");

    const charge = charges[0];
    expect(charge?.status).not.toBe("PAID");
    expect(charge?.reconciliation_status).toBe("ERROR");
  });

  it("import de respuesta es idempotente para el mismo archivo", async () => {
    process.env.BILLING_PD_ADAPTER = "debug_csv";

    const { importResponseBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );
    const { buildDebugResponseCsv } = await import(
      "@/services/collections/galicia/direct-debit/adapters/debugCsvAdapter"
    );

    const { outbound, outboundItems } = await seedAndCreateOutbound();
    const firstOutbound = outboundItems[0];
    const paidAmount = round2(charges[0]?.amount_ars_due || 0);

    const responseBytes = buildDebugResponseCsv({
      records: [
        {
          externalReference: String(firstOutbound.external_reference),
          result: "PAID",
          amountArs: paidAmount,
          paidReference: "PD-IDEMP-1",
        },
      ],
    });

    const firstImport = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "respuesta-idempotente.csv",
        bytes: responseBytes,
        contentType: "text/csv",
      },
      actorUserId: 36,
    });

    expect(firstImport.already_imported).toBe(false);
    expect(firstImport.summary.paid).toBe(1);

    const secondImport = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "respuesta-idempotente.csv",
        bytes: responseBytes,
        contentType: "text/csv",
      },
      actorUserId: 36,
    });

    expect(secondImport.already_imported).toBe(true);
    expect(secondImport.summary.paid).toBe(1);
    expect(batches.filter((item) => item.direction === "INBOUND")).toHaveLength(1);
  });

  it("import de respuesta es idempotente por hash aunque cambie el filename", async () => {
    process.env.BILLING_PD_ADAPTER = "debug_csv";

    const { importResponseBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );
    const { buildDebugResponseCsv } = await import(
      "@/services/collections/galicia/direct-debit/adapters/debugCsvAdapter"
    );

    const { outbound, outboundItems } = await seedAndCreateOutbound();
    const firstOutbound = outboundItems[0];
    const paidAmount = round2(charges[0]?.amount_ars_due || 0);

    const responseBytes = buildDebugResponseCsv({
      records: [
        {
          externalReference: String(firstOutbound.external_reference),
          result: "PAID",
          amountArs: paidAmount,
          paidReference: "PD-IDEMP-HASH-1",
        },
      ],
    });

    const firstImport = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "respuesta-hash-a.csv",
        bytes: responseBytes,
        contentType: "text/csv",
      },
      actorUserId: 36,
    });

    const secondImport = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "respuesta-hash-b.csv",
        bytes: responseBytes,
        contentType: "text/csv",
      },
      actorUserId: 36,
    });

    expect(firstImport.already_imported).toBe(false);
    expect(secondImport.already_imported).toBe(true);
    expect(batches.filter((item) => item.direction === "INBOUND")).toHaveLength(1);
  });

  it("rechaza import con adapter/layout incompatible", async () => {
    process.env.BILLING_PD_ADAPTER = "galicia_pd_v1";

    const { importResponseBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );
    const { buildDebugResponseCsv } = await import(
      "@/services/collections/galicia/direct-debit/adapters/debugCsvAdapter"
    );

    const { outbound, outboundItems } = await seedAndCreateOutbound();
    const firstOutbound = outboundItems[0];
    const paidAmount = round2(charges[0]?.amount_ars_due || 0);
    const incompatibleBytes = buildDebugResponseCsv({
      records: [
        {
          externalReference: String(firstOutbound.external_reference),
          result: "PAID",
          amountArs: paidAmount,
          paidReference: "PD-MISMATCH-1",
        },
      ],
    });

    await expect(
      importResponseBatch({
        outboundBatchId: outbound.batch.id_batch,
        uploadedFile: {
          fileName: "respuesta-debug.csv",
          bytes: incompatibleBytes,
          contentType: "text/csv",
        },
        actorUserId: 36,
      }),
    ).rejects.toThrow("adapter mismatch");

    expect(batches.filter((item) => item.direction === "INBOUND")).toHaveLength(0);
  });

  it("prepare/export separados con debug_csv son idempotentes", async () => {
    process.env.BILLING_PD_ADAPTER = "debug_csv";

    const { runAnchor } = await import("@/services/collections/core/runAnchor");
    const { preparePresentmentBatch, exportPendingPreparedBatches } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );

    await runAnchor({
      anchorDate: new Date("2026-02-19T12:00:00.000Z"),
      overrideFx: false,
      actorUserId: 36,
      actorAgencyId: 3,
    });

    const prepared = await preparePresentmentBatch({
      businessDate: new Date("2026-02-19T12:00:00.000Z"),
      actorUserId: 36,
      adapterName: "debug_csv",
      dryRun: false,
    });

    expect(prepared.no_op).toBe(false);
    expect(prepared.batch_id).toBeTruthy();

    const firstExport = await exportPendingPreparedBatches({
      actorUserId: 36,
      adapterName: "debug_csv",
    });
    expect(firstExport.batches_exported).toBe(1);

    const secondExport = await exportPendingPreparedBatches({
      actorUserId: 36,
      adapterName: "debug_csv",
    });
    expect(secondExport.no_op).toBe(true);
    expect(secondExport.batches_exported).toBe(0);
  });

  it("si BILLING_FISCAL_AUTORUN=true mantiene compatibilidad fiscal", async () => {
    process.env.BILLING_PD_ADAPTER = "debug_csv";
    process.env.BILLING_FISCAL_AUTORUN = "true";

    const { importResponseBatch } = await import(
      "@/services/collections/galicia/direct-debit/batches"
    );
    const { buildDebugResponseCsv } = await import(
      "@/services/collections/galicia/direct-debit/adapters/debugCsvAdapter"
    );

    const { outbound, outboundItems } = await seedAndCreateOutbound();
    const firstOutbound = outboundItems[0];
    const paidAmount = round2(charges[0]?.amount_ars_due || 0);

    const responseBytes = buildDebugResponseCsv({
      records: [
        {
          externalReference: String(firstOutbound.external_reference),
          result: "PAID",
          amountArs: paidAmount,
          paidReference: "PD-FISCAL-1",
        },
      ],
    });

    const imported = await importResponseBatch({
      outboundBatchId: outbound.batch.id_batch,
      uploadedFile: {
        fileName: "respuesta-fiscal.csv",
        bytes: responseBytes,
        contentType: "text/csv",
      },
      actorUserId: 36,
    });

    expect(imported.summary.paid).toBe(1);
    expect(imported.summary.fiscal_issued).toBe(1);
    expect(fiscalDocuments).toHaveLength(1);
    expect(fiscalDocuments[0]?.status).toBe("ISSUED");
  });
});
