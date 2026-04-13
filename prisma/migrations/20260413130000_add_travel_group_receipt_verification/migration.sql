ALTER TABLE "TravelGroupReceipt"
ADD COLUMN IF NOT EXISTS "verification_status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "verified_by" INTEGER;

CREATE INDEX IF NOT EXISTS "TravelGroupReceipt_verification_status_idx"
  ON "TravelGroupReceipt"("verification_status");

CREATE INDEX IF NOT EXISTS "TravelGroupReceipt_verified_by_idx"
  ON "TravelGroupReceipt"("verified_by");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TravelGroupReceipt_verified_by_fkey'
  ) THEN
    ALTER TABLE "TravelGroupReceipt"
      ADD CONSTRAINT "TravelGroupReceipt_verified_by_fkey"
      FOREIGN KEY ("verified_by")
      REFERENCES "User"("id_user")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;
