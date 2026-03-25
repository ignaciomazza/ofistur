import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type UserDataMigrationStatus =
  | "pending"
  | "running"
  | "success"
  | "partial_failed"
  | "failed";

export type UserDataMigrationScopeKey =
  | "clients_owner"
  | "bookings_owner"
  | "quotes_owner"
  | "travel_groups_owner"
  | "investments_beneficiary"
  | "investments_created_by"
  | "recurring_investments_beneficiary"
  | "recurring_investments_created_by"
  | "other_incomes_created_by"
  | "other_incomes_verified_by"
  | "receipts_verified_by"
  | "client_payments_paid_by"
  | "client_payment_audits_changed_by"
  | "credit_entries_created_by"
  | "files_created_by"
  | "calendar_notes_created_by";

export type UserDataMigrationScopeSummary = {
  key: UserDataMigrationScopeKey;
  label: string;
  count: number;
};

export type UserDataMigrationFailedItem = {
  scopeKey: string;
  label: string;
  error: string;
  retryable: boolean;
  pendingCount: number;
};

export type UserDataMigrationJobPayload = {
  id_job: number;
  id_agency: number;
  source_user_id: number;
  target_user_id: number;
  started_by: number;
  status: UserDataMigrationStatus;
  total_records: number;
  processed_records: number;
  failed_records: number;
  progress_pct: number;
  retry_count: number;
  last_error: string | null;
  scope_stats: Prisma.JsonValue | null;
  failed_items: UserDataMigrationFailedItem[];
  summary: Prisma.JsonValue | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type MigrationContext = {
  id_agency: number;
  source_user_id: number;
  target_user_id: number;
};

type MigrationScopeDef = {
  key: UserDataMigrationScopeKey;
  label: string;
  count: (ctx: MigrationContext) => Promise<number>;
  migrate: (ctx: MigrationContext) => Promise<number>;
};

const FINAL_JOB_STATUSES = new Set<UserDataMigrationStatus>([
  "success",
  "partial_failed",
  "failed",
]);

const ACTIVE_JOB_IDS = new Set<number>();

const MIGRATION_SCOPES: readonly MigrationScopeDef[] = [
  {
    key: "clients_owner",
    label: "Pasajeros (titular comercial)",
    count: (ctx) =>
      prisma.client.count({
        where: { id_agency: ctx.id_agency, id_user: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.client.updateMany({
          where: { id_agency: ctx.id_agency, id_user: ctx.source_user_id },
          data: { id_user: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "bookings_owner",
    label: "Reservas",
    count: (ctx) =>
      prisma.booking.count({
        where: { id_agency: ctx.id_agency, id_user: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.booking.updateMany({
          where: { id_agency: ctx.id_agency, id_user: ctx.source_user_id },
          data: { id_user: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "quotes_owner",
    label: "Cotizaciones",
    count: (ctx) =>
      prisma.quote.count({
        where: { id_agency: ctx.id_agency, id_user: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.quote.updateMany({
          where: { id_agency: ctx.id_agency, id_user: ctx.source_user_id },
          data: { id_user: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "travel_groups_owner",
    label: "Grupos de viaje",
    count: (ctx) =>
      prisma.travelGroup.count({
        where: { id_agency: ctx.id_agency, id_user: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.travelGroup.updateMany({
          where: { id_agency: ctx.id_agency, id_user: ctx.source_user_id },
          data: { id_user: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "investments_beneficiary",
    label: "Inversiones (beneficiario)",
    count: (ctx) =>
      prisma.investment.count({
        where: { id_agency: ctx.id_agency, user_id: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.investment.updateMany({
          where: { id_agency: ctx.id_agency, user_id: ctx.source_user_id },
          data: { user_id: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "investments_created_by",
    label: "Inversiones (creadas por)",
    count: (ctx) =>
      prisma.investment.count({
        where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.investment.updateMany({
          where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
          data: { created_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "recurring_investments_beneficiary",
    label: "Inversiones recurrentes (beneficiario)",
    count: (ctx) =>
      prisma.recurringInvestment.count({
        where: { id_agency: ctx.id_agency, user_id: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.recurringInvestment.updateMany({
          where: { id_agency: ctx.id_agency, user_id: ctx.source_user_id },
          data: { user_id: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "recurring_investments_created_by",
    label: "Inversiones recurrentes (creadas por)",
    count: (ctx) =>
      prisma.recurringInvestment.count({
        where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.recurringInvestment.updateMany({
          where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
          data: { created_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "other_incomes_created_by",
    label: "Ingresos (creados por)",
    count: (ctx) =>
      prisma.otherIncome.count({
        where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.otherIncome.updateMany({
          where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
          data: { created_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "other_incomes_verified_by",
    label: "Ingresos (verificados por)",
    count: (ctx) =>
      prisma.otherIncome.count({
        where: { id_agency: ctx.id_agency, verified_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.otherIncome.updateMany({
          where: { id_agency: ctx.id_agency, verified_by: ctx.source_user_id },
          data: { verified_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "receipts_verified_by",
    label: "Recibos (verificados por)",
    count: (ctx) =>
      prisma.receipt.count({
        where: { id_agency: ctx.id_agency, verified_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.receipt.updateMany({
          where: { id_agency: ctx.id_agency, verified_by: ctx.source_user_id },
          data: { verified_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "client_payments_paid_by",
    label: "Pagos de clientes (pagados por)",
    count: (ctx) =>
      prisma.clientPayment.count({
        where: { id_agency: ctx.id_agency, paid_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.clientPayment.updateMany({
          where: { id_agency: ctx.id_agency, paid_by: ctx.source_user_id },
          data: { paid_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "client_payment_audits_changed_by",
    label: "Auditoría pagos de clientes",
    count: (ctx) =>
      prisma.clientPaymentAudit.count({
        where: { id_agency: ctx.id_agency, changed_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.clientPaymentAudit.updateMany({
          where: { id_agency: ctx.id_agency, changed_by: ctx.source_user_id },
          data: { changed_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "credit_entries_created_by",
    label: "Movimientos de crédito (creados por)",
    count: (ctx) =>
      prisma.creditEntry.count({
        where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.creditEntry.updateMany({
          where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
          data: { created_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "files_created_by",
    label: "Archivos adjuntos (creados por)",
    count: (ctx) =>
      prisma.fileAsset.count({
        where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
      }),
    migrate: async (ctx) =>
      (
        await prisma.fileAsset.updateMany({
          where: { id_agency: ctx.id_agency, created_by: ctx.source_user_id },
          data: { created_by: ctx.target_user_id },
        })
      ).count,
  },
  {
    key: "calendar_notes_created_by",
    label: "Notas de calendario",
    count: (ctx) =>
      prisma.calendarNote.count({ where: { createdBy: ctx.source_user_id } }),
    migrate: async (ctx) =>
      (
        await prisma.calendarNote.updateMany({
          where: { createdBy: ctx.source_user_id },
          data: { createdBy: ctx.target_user_id },
        })
      ).count,
  },
] as const;

const scopesByKey = new Map(
  MIGRATION_SCOPES.map((scope) => [scope.key, scope]),
);

function asInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}

function normalizeErr(error: unknown, fallback = "Error inesperado") {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function parseScopeKeys(value: Prisma.JsonValue | null | undefined): UserDataMigrationScopeKey[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<UserDataMigrationScopeKey>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (scopesByKey.has(item as UserDataMigrationScopeKey)) {
      out.add(item as UserDataMigrationScopeKey);
    }
  }
  return Array.from(out);
}

function parseFailedItems(
  value: Prisma.JsonValue | null | undefined,
): UserDataMigrationFailedItem[] {
  if (!Array.isArray(value)) return [];
  const out: UserDataMigrationFailedItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const scopeKey = typeof rec.scopeKey === "string" ? rec.scopeKey : "unknown";
    const label = typeof rec.label === "string" ? rec.label : "Sin etiqueta";
    const error =
      typeof rec.error === "string" && rec.error.trim()
        ? rec.error.trim()
        : "Error desconocido";
    const retryable = rec.retryable !== false;
    const pendingCount = Math.max(0, asInt(rec.pendingCount));
    out.push({ scopeKey, label, error, retryable, pendingCount });
  }
  return out;
}

function toJobPayload(
  row: {
    id_job: number;
    id_agency: number;
    source_user_id: number;
    target_user_id: number;
    started_by: number;
    status: string;
    total_records: number;
    processed_records: number;
    failed_records: number;
    progress_pct: number;
    retry_count: number;
    last_error: string | null;
    scope_stats: Prisma.JsonValue | null;
    failed_items: Prisma.JsonValue | null;
    summary: Prisma.JsonValue | null;
    started_at: Date | null;
    finished_at: Date | null;
    created_at: Date;
    updated_at: Date;
  },
): UserDataMigrationJobPayload {
  const status = String(row.status || "pending") as UserDataMigrationStatus;
  return {
    id_job: row.id_job,
    id_agency: row.id_agency,
    source_user_id: row.source_user_id,
    target_user_id: row.target_user_id,
    started_by: row.started_by,
    status,
    total_records: asInt(row.total_records),
    processed_records: asInt(row.processed_records),
    failed_records: asInt(row.failed_records),
    progress_pct:
      typeof row.progress_pct === "number" && Number.isFinite(row.progress_pct)
        ? row.progress_pct
        : 0,
    retry_count: asInt(row.retry_count),
    last_error: row.last_error ?? null,
    scope_stats: row.scope_stats ?? null,
    failed_items: parseFailedItems(row.failed_items),
    summary: row.summary ?? null,
    started_at: row.started_at ? row.started_at.toISOString() : null,
    finished_at: row.finished_at ? row.finished_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function calcProgress(processed: number, total: number, done: boolean): number {
  if (done) return 100;
  if (total <= 0) return 0;
  const pct = Math.round((processed / total) * 100);
  return Math.max(0, Math.min(99, pct));
}

async function countScopes(
  ctx: MigrationContext,
  selectedScopes: readonly MigrationScopeDef[],
) {
  const entries = await Promise.all(
    selectedScopes.map(async (scope) => {
      const count = await scope.count(ctx);
      return {
        key: scope.key,
        label: scope.label,
        count,
      };
    }),
  );

  const total = entries.reduce((sum, item) => sum + item.count, 0);

  return {
    entries,
    total,
  };
}

async function deleteUserConfigurationData(
  tx: Prisma.TransactionClient,
  id_agency: number,
  source_user_id: number,
) {
  await tx.textPreset.deleteMany({
    where: { id_agency, id_user: source_user_id },
  });
  await tx.commissionShare.deleteMany({
    where: {
      beneficiary_user_id: source_user_id,
      ruleSet: { id_agency },
    },
  });
  await tx.commissionRuleSet.deleteMany({
    where: { id_agency, owner_user_id: source_user_id },
  });
}

export async function buildUserDataMigrationPreview(args: {
  id_agency: number;
  source_user_id: number;
}) {
  const { id_agency, source_user_id } = args;

  const sourceUser = await prisma.user.findFirst({
    where: { id_user: source_user_id, id_agency },
    select: {
      id_user: true,
      first_name: true,
      last_name: true,
      email: true,
      role: true,
    },
  });

  if (!sourceUser) {
    throw new Error("Usuario origen no encontrado en tu agencia.");
  }

  const ctx: MigrationContext = {
    id_agency,
    source_user_id,
    target_user_id: source_user_id,
  };

  const { entries, total } = await countScopes(ctx, MIGRATION_SCOPES);
  const targetUsers = await prisma.user.findMany({
    where: {
      id_agency,
      id_user: { not: source_user_id },
    },
    select: {
      id_user: true,
      first_name: true,
      last_name: true,
      email: true,
      role: true,
    },
    orderBy: [{ first_name: "asc" }, { last_name: "asc" }, { id_user: "asc" }],
  });

  return {
    sourceUser,
    scopes: entries,
    totalCount: total,
    configurationBlockers: [],
    targetUsers,
    managerTargets: targetUsers,
  };
}

export function queueUserDataMigrationJob(id_job: number) {
  if (!Number.isFinite(id_job) || id_job <= 0) return;
  setTimeout(() => {
    void processUserDataMigrationJob(id_job);
  }, 0);
}

async function processUserDataMigrationJob(id_job: number) {
  if (ACTIVE_JOB_IDS.has(id_job)) return;
  ACTIVE_JOB_IDS.add(id_job);

  try {
    const job = await prisma.userDataMigrationJob.findUnique({
      where: { id_job },
    });
    if (!job) return;

    const currentStatus = String(job.status || "pending") as UserDataMigrationStatus;
    if (currentStatus === "running") return;
    if (currentStatus === "success") return;

    const sourceUser = await prisma.user.findUnique({
      where: { id_user: job.source_user_id },
      select: { id_user: true, id_agency: true },
    });
    const targetUser = await prisma.user.findUnique({
      where: { id_user: job.target_user_id },
      select: { id_user: true, id_agency: true },
    });

    const preRunFailures: UserDataMigrationFailedItem[] = [];

    if (!sourceUser || sourceUser.id_agency !== job.id_agency) {
      preRunFailures.push({
        scopeKey: "source_user",
        label: "Usuario origen",
        error: "El usuario origen ya no existe en la agencia.",
        retryable: false,
        pendingCount: 0,
      });
    }

    if (!targetUser || targetUser.id_agency !== job.id_agency) {
      preRunFailures.push({
        scopeKey: "target_user",
        label: "Usuario destino",
        error: "El usuario destino ya no existe en la agencia.",
        retryable: false,
        pendingCount: 0,
      });
    }

    if (job.source_user_id === job.target_user_id) {
      preRunFailures.push({
        scopeKey: "same_user",
        label: "Usuario origen/destino",
        error: "Origen y destino no pueden ser el mismo usuario.",
        retryable: false,
        pendingCount: 0,
      });
    }

    if (preRunFailures.length > 0) {
      await prisma.userDataMigrationJob.update({
        where: { id_job },
        data: {
          status: "failed",
          progress_pct: 0,
          failed_items: preRunFailures as unknown as Prisma.InputJsonValue,
          scope_stats: [] as unknown as Prisma.InputJsonValue,
          last_error: preRunFailures[0]?.error || "Error de validación",
          finished_at: new Date(),
          retry_scope_keys: Prisma.DbNull,
        },
      });
      return;
    }

    const scopeKeysFromRetry = parseScopeKeys(job.retry_scope_keys);
    const selectedScopes =
      scopeKeysFromRetry.length > 0
        ? MIGRATION_SCOPES.filter((scope) =>
            scopeKeysFromRetry.includes(scope.key),
          )
        : MIGRATION_SCOPES;

    const ctx: MigrationContext = {
      id_agency: job.id_agency,
      source_user_id: job.source_user_id,
      target_user_id: job.target_user_id,
    };

    const counted = await countScopes(ctx, selectedScopes);
    const scopeStats = counted.entries.map((entry) => ({
      ...entry,
      migrated: 0,
      status: entry.count > 0 ? "pending" : "skipped",
      error: null as string | null,
    }));

    let processed = 0;
    let failed = 0;
    const failedItems: UserDataMigrationFailedItem[] = [];

    await prisma.userDataMigrationJob.update({
      where: { id_job },
      data: {
        status: "running",
        started_at: job.started_at ?? new Date(),
        finished_at: null,
        total_records: counted.total,
        processed_records: 0,
        failed_records: 0,
        progress_pct: 0,
        failed_items: [] as unknown as Prisma.InputJsonValue,
        scope_stats: scopeStats as unknown as Prisma.InputJsonValue,
        last_error: null,
        summary: Prisma.DbNull,
        retry_scope_keys: Prisma.DbNull,
      },
    });

    for (const scope of selectedScopes) {
      const stat = scopeStats.find((item) => item.key === scope.key);
      if (!stat || stat.count <= 0) continue;

      try {
        const moved = await scope.migrate(ctx);
        stat.migrated = moved;
        stat.status = "done";
        processed += moved;
      } catch (error: unknown) {
        const message = normalizeErr(
          error,
          `No se pudo migrar ${scope.label.toLowerCase()}.`,
        );
        stat.status = "failed";
        stat.error = message;
        failed += stat.count;
        failedItems.push({
          scopeKey: scope.key,
          label: scope.label,
          error: message,
          retryable: true,
          pendingCount: stat.count,
        });
      }

      await prisma.userDataMigrationJob.update({
        where: { id_job },
        data: {
          processed_records: processed,
          failed_records: failed,
          progress_pct: calcProgress(processed, counted.total, false),
          failed_items: failedItems as unknown as Prisma.InputJsonValue,
          scope_stats: scopeStats as unknown as Prisma.InputJsonValue,
          last_error: failedItems[0]?.error ?? null,
        },
      });
    }

    let deletedSourceUser = false;
    if (failedItems.length === 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await deleteUserConfigurationData(
            tx,
            job.id_agency,
            job.source_user_id,
          );
          await tx.userTeam.deleteMany({
            where: { id_user: job.source_user_id },
          });
          await tx.user.delete({
            where: { id_user: job.source_user_id },
          });
        });
        deletedSourceUser = true;
      } catch (error: unknown) {
        const message = normalizeErr(
          error,
          "No se pudo eliminar el usuario al finalizar la asignación.",
        );
        failedItems.push({
          scopeKey: "delete_source_user",
          label: "Eliminar usuario",
          error: message,
          retryable: true,
          pendingCount: 1,
        });
      }
    }

    const finalStatus: UserDataMigrationStatus =
      failedItems.length === 0
        ? "success"
        : processed > 0
          ? "partial_failed"
          : "failed";

    const summary = {
      migratedScopes: scopeStats,
      selectedScopeKeys: selectedScopes.map((scope) => scope.key),
      deletedSourceUser,
    };
    const failedFromItems = failedItems.reduce(
      (sum, item) => sum + item.pendingCount,
      0,
    );

    await prisma.userDataMigrationJob.update({
      where: { id_job },
      data: {
        status: finalStatus,
        processed_records: processed,
        failed_records: failedItems.length === 0 ? failed : failedFromItems,
        progress_pct: finalStatus === "success" ? 100 : calcProgress(processed, counted.total, false),
        failed_items: failedItems as unknown as Prisma.InputJsonValue,
        scope_stats: scopeStats as unknown as Prisma.InputJsonValue,
        summary: summary as unknown as Prisma.InputJsonValue,
        last_error: failedItems[0]?.error ?? null,
        finished_at: new Date(),
      },
    });
  } catch (error: unknown) {
    const message = normalizeErr(error, "Error interno al procesar migración.");
    await prisma.userDataMigrationJob.update({
      where: { id_job },
      data: {
        status: "failed",
        last_error: message,
        finished_at: new Date(),
      },
    });
  } finally {
    ACTIVE_JOB_IDS.delete(id_job);
  }
}

export async function startUserDataMigrationJob(args: {
  id_agency: number;
  source_user_id: number;
  target_user_id: number;
  started_by: number;
}) {
  const existing = await prisma.userDataMigrationJob.findFirst({
    where: {
      id_agency: args.id_agency,
      source_user_id: args.source_user_id,
      status: { in: ["pending", "running"] },
    },
    orderBy: { id_job: "desc" },
  });

  if (existing) {
    if (!ACTIVE_JOB_IDS.has(existing.id_job) && existing.status === "pending") {
      queueUserDataMigrationJob(existing.id_job);
    }
    return {
      reused: true,
      job: toJobPayload(existing),
    };
  }

  const created = await prisma.userDataMigrationJob.create({
    data: {
      id_agency: args.id_agency,
      source_user_id: args.source_user_id,
      target_user_id: args.target_user_id,
      started_by: args.started_by,
      status: "pending",
      total_records: 0,
      processed_records: 0,
      failed_records: 0,
      progress_pct: 0,
      retry_count: 0,
      failed_items: [] as unknown as Prisma.InputJsonValue,
      scope_stats: [] as unknown as Prisma.InputJsonValue,
      summary: Prisma.DbNull,
      retry_scope_keys: Prisma.DbNull,
      delete_source_on_success: true,
      started_at: null,
      finished_at: null,
      last_error: null,
    },
  });

  queueUserDataMigrationJob(created.id_job);

  return {
    reused: false,
    job: toJobPayload(created),
  };
}

export async function getUserDataMigrationJob(
  id_job: number,
  id_agency: number,
) {
  const row = await prisma.userDataMigrationJob.findFirst({
    where: { id_job, id_agency },
  });
  if (!row) return null;

  const status = String(row.status || "pending") as UserDataMigrationStatus;
  if (status === "pending" && !ACTIVE_JOB_IDS.has(row.id_job)) {
    queueUserDataMigrationJob(row.id_job);
  }

  return toJobPayload(row);
}

export async function retryUserDataMigrationJob(args: {
  id_job: number;
  id_agency: number;
}) {
  const row = await prisma.userDataMigrationJob.findFirst({
    where: { id_job: args.id_job, id_agency: args.id_agency },
  });

  if (!row) throw new Error("Trabajo de migración no encontrado.");

  const status = String(row.status || "pending") as UserDataMigrationStatus;
  if (status === "running") {
    return toJobPayload(row);
  }
  if (status === "success") {
    throw new Error("Este trabajo ya finalizó correctamente.");
  }

  const failedItems = parseFailedItems(row.failed_items);
  const retryableScopeKeys = Array.from(
    new Set(
      failedItems
        .filter((item) => item.retryable)
        .map((item) => item.scopeKey)
        .filter((key): key is UserDataMigrationScopeKey =>
          scopesByKey.has(key as UserDataMigrationScopeKey),
        ),
    ),
  );

  const hasRetryableDeleteError = failedItems.some(
    (item) => item.scopeKey === "delete_source_user" && item.retryable,
  );

  if (retryableScopeKeys.length === 0 && !hasRetryableDeleteError) {
    throw new Error("No hay pendientes para volver a intentar.");
  }

  const updated = await prisma.userDataMigrationJob.update({
    where: { id_job: row.id_job },
    data: {
      status: "pending",
      retry_count: (row.retry_count || 0) + 1,
      retry_scope_keys: retryableScopeKeys as unknown as Prisma.InputJsonValue,
      failed_items: [] as unknown as Prisma.InputJsonValue,
      scope_stats:
        (row.scope_stats ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
      summary: (row.summary ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
      progress_pct: 0,
      processed_records: 0,
      failed_records: 0,
      finished_at: null,
      last_error: null,
    },
  });

  queueUserDataMigrationJob(updated.id_job);

  return toJobPayload(updated);
}

export async function validateMigrationStart(args: {
  id_agency: number;
  source_user_id: number;
  target_user_id: number;
  actor_user_id: number;
}) {
  const source = await prisma.user.findFirst({
    where: { id_user: args.source_user_id, id_agency: args.id_agency },
    select: { id_user: true },
  });
  if (!source) {
    throw new Error("Usuario origen no encontrado en tu agencia.");
  }

  if (args.source_user_id === args.actor_user_id) {
    throw new Error("No podés migrarte y eliminarte a vos mismo.");
  }

  const target = await prisma.user.findFirst({
    where: { id_user: args.target_user_id, id_agency: args.id_agency },
    select: { id_user: true },
  });
  if (!target) {
    throw new Error("Usuario destino no encontrado en tu agencia.");
  }

  if (args.source_user_id === args.target_user_id) {
    throw new Error("Origen y destino no pueden ser el mismo usuario.");
  }
}

export function isFinalMigrationStatus(status: string | null | undefined) {
  return FINAL_JOB_STATUSES.has(
    String(status || "pending") as UserDataMigrationStatus,
  );
}
