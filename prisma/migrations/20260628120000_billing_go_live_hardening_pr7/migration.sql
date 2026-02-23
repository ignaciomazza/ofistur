-- Billing recurrente Galicia - PR #7
-- Go-live hardening: rollout por agencia + business controls + import runs + review queue

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingFileImportRunStatus') THEN
    CREATE TYPE "BillingFileImportRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'DUPLICATE', 'INVALID');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingPaymentReviewCaseType') THEN
    CREATE TYPE "BillingPaymentReviewCaseType" AS ENUM ('LATE_DUPLICATE_PAYMENT', 'AMOUNT_MISMATCH', 'OTHER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingPaymentReviewCaseStatus') THEN
    CREATE TYPE "BillingPaymentReviewCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingPaymentReviewResolutionType') THEN
    CREATE TYPE "BillingPaymentReviewResolutionType" AS ENUM ('BALANCE_CREDIT', 'REFUND_MANUAL', 'NO_ACTION', 'OTHER');
  END IF;
END $$;

ALTER TABLE "AgencyBillingConfig"
  ADD COLUMN IF NOT EXISTS "collections_pd_enabled" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "collections_dunning_enabled" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "collections_fallback_enabled" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "collections_fallback_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "collections_fallback_auto_sync_enabled" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "collections_suspended" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "collections_cutoff_override_hour_ar" INTEGER,
  ADD COLUMN IF NOT EXISTS "collections_notes" TEXT;

UPDATE "AgencyBillingConfig"
SET
  "collections_pd_enabled" = COALESCE("collections_pd_enabled", false),
  "collections_dunning_enabled" = COALESCE("collections_dunning_enabled", false),
  "collections_fallback_enabled" = COALESCE("collections_fallback_enabled", false),
  "collections_fallback_auto_sync_enabled" = COALESCE("collections_fallback_auto_sync_enabled", false),
  "collections_suspended" = COALESCE("collections_suspended", false)
WHERE
  "collections_pd_enabled" IS NULL
  OR "collections_dunning_enabled" IS NULL
  OR "collections_fallback_enabled" IS NULL
  OR "collections_fallback_auto_sync_enabled" IS NULL
  OR "collections_suspended" IS NULL;

ALTER TABLE "AgencyBillingConfig"
  ALTER COLUMN "collections_pd_enabled" SET DEFAULT false,
  ALTER COLUMN "collections_dunning_enabled" SET DEFAULT false,
  ALTER COLUMN "collections_fallback_enabled" SET DEFAULT false,
  ALTER COLUMN "collections_fallback_auto_sync_enabled" SET DEFAULT false,
  ALTER COLUMN "collections_suspended" SET DEFAULT false;

ALTER TABLE "AgencyBillingConfig"
  ALTER COLUMN "collections_pd_enabled" SET NOT NULL,
  ALTER COLUMN "collections_dunning_enabled" SET NOT NULL,
  ALTER COLUMN "collections_fallback_enabled" SET NOT NULL,
  ALTER COLUMN "collections_fallback_auto_sync_enabled" SET NOT NULL,
  ALTER COLUMN "collections_suspended" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "BillingFileImportRun" (
  "id_file_import_run" SERIAL PRIMARY KEY,
  "agency_id" INTEGER NOT NULL,
  "batch_id" INTEGER,
  "file_name" TEXT NOT NULL,
  "file_hash" TEXT NOT NULL,
  "adapter" TEXT,
  "uploaded_by" INTEGER,
  "source" "BillingJobSource" NOT NULL DEFAULT 'MANUAL',
  "status" "BillingFileImportRunStatus" NOT NULL,
  "detected_totals" JSONB,
  "parsed_rows" INTEGER,
  "error_message" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BillingFileImportRun_agency_id_fkey'
  ) THEN
    ALTER TABLE "BillingFileImportRun"
      ADD CONSTRAINT "BillingFileImportRun_agency_id_fkey"
      FOREIGN KEY ("agency_id")
      REFERENCES "Agency"("id_agency")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BillingFileImportRun_batch_id_fkey'
  ) THEN
    ALTER TABLE "BillingFileImportRun"
      ADD CONSTRAINT "BillingFileImportRun_batch_id_fkey"
      FOREIGN KEY ("batch_id")
      REFERENCES "AgencyBillingFileBatch"("id_batch")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BillingFileImportRun_uploaded_by_fkey'
  ) THEN
    ALTER TABLE "BillingFileImportRun"
      ADD CONSTRAINT "BillingFileImportRun_uploaded_by_fkey"
      FOREIGN KEY ("uploaded_by")
      REFERENCES "User"("id_user")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AgencyBillingPaymentReviewCase" (
  "id_review_case" SERIAL PRIMARY KEY,
  "agency_id" INTEGER NOT NULL,
  "charge_id" INTEGER NOT NULL,
  "type" "BillingPaymentReviewCaseType" NOT NULL,
  "status" "BillingPaymentReviewCaseStatus" NOT NULL DEFAULT 'OPEN',
  "primary_paid_channel" "BillingCollectionChannel",
  "secondary_late_channel" "BillingCollectionChannel",
  "amount_ars" DECIMAL(18,2),
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolution_type" "BillingPaymentReviewResolutionType",
  "resolution_notes" TEXT,
  "resolved_by_user_id" INTEGER,
  "resolved_at" TIMESTAMP(3),
  "dedupe_key" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AgencyBillingPaymentReviewCase_agency_id_fkey'
  ) THEN
    ALTER TABLE "AgencyBillingPaymentReviewCase"
      ADD CONSTRAINT "AgencyBillingPaymentReviewCase_agency_id_fkey"
      FOREIGN KEY ("agency_id")
      REFERENCES "Agency"("id_agency")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AgencyBillingPaymentReviewCase_charge_id_fkey'
  ) THEN
    ALTER TABLE "AgencyBillingPaymentReviewCase"
      ADD CONSTRAINT "AgencyBillingPaymentReviewCase_charge_id_fkey"
      FOREIGN KEY ("charge_id")
      REFERENCES "AgencyBillingCharge"("id_charge")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AgencyBillingPaymentReviewCase_resolved_by_user_id_fkey'
  ) THEN
    ALTER TABLE "AgencyBillingPaymentReviewCase"
      ADD CONSTRAINT "AgencyBillingPaymentReviewCase_resolved_by_user_id_fkey"
      FOREIGN KEY ("resolved_by_user_id")
      REFERENCES "User"("id_user")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AgencyBillingPaymentReviewCase_dedupe_key_key'
  ) THEN
    ALTER TABLE "AgencyBillingPaymentReviewCase"
      ADD CONSTRAINT "AgencyBillingPaymentReviewCase_dedupe_key_key" UNIQUE ("dedupe_key");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BillingFileImportRun_agency_id_created_at_idx"
  ON "BillingFileImportRun"("agency_id", "created_at");
CREATE INDEX IF NOT EXISTS "BillingFileImportRun_batch_id_created_at_idx"
  ON "BillingFileImportRun"("batch_id", "created_at");
CREATE INDEX IF NOT EXISTS "BillingFileImportRun_status_created_at_idx"
  ON "BillingFileImportRun"("status", "created_at");
CREATE INDEX IF NOT EXISTS "BillingFileImportRun_file_hash_idx"
  ON "BillingFileImportRun"("file_hash");

CREATE INDEX IF NOT EXISTS "AgencyBillingPaymentReviewCase_agency_id_status_idx"
  ON "AgencyBillingPaymentReviewCase"("agency_id", "status");
CREATE INDEX IF NOT EXISTS "AgencyBillingPaymentReviewCase_charge_id_status_idx"
  ON "AgencyBillingPaymentReviewCase"("charge_id", "status");
CREATE INDEX IF NOT EXISTS "AgencyBillingPaymentReviewCase_type_status_detected_at_idx"
  ON "AgencyBillingPaymentReviewCase"("type", "status", "detected_at");
CREATE INDEX IF NOT EXISTS "AgencyBillingPaymentReviewCase_detected_at_idx"
  ON "AgencyBillingPaymentReviewCase"("detected_at");
