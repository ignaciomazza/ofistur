CREATE TABLE IF NOT EXISTS "UserDataMigrationJob" (
  "id_job" SERIAL PRIMARY KEY,
  "id_agency" INTEGER NOT NULL,
  "source_user_id" INTEGER NOT NULL,
  "target_user_id" INTEGER NOT NULL,
  "started_by" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "total_records" INTEGER NOT NULL DEFAULT 0,
  "processed_records" INTEGER NOT NULL DEFAULT 0,
  "failed_records" INTEGER NOT NULL DEFAULT 0,
  "progress_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "scope_stats" JSONB,
  "failed_items" JSONB,
  "summary" JSONB,
  "retry_scope_keys" JSONB,
  "delete_source_on_success" BOOLEAN NOT NULL DEFAULT TRUE,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "UserDataMigrationJob_id_agency_source_user_id_idx"
ON "UserDataMigrationJob" ("id_agency", "source_user_id");

CREATE INDEX IF NOT EXISTS "UserDataMigrationJob_id_agency_target_user_id_idx"
ON "UserDataMigrationJob" ("id_agency", "target_user_id");

CREATE INDEX IF NOT EXISTS "UserDataMigrationJob_id_agency_status_idx"
ON "UserDataMigrationJob" ("id_agency", "status");

CREATE INDEX IF NOT EXISTS "UserDataMigrationJob_created_at_idx"
ON "UserDataMigrationJob" ("created_at");
