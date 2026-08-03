-- Stage 1: add the complete ARCA voucher identity without removing the
-- legacy global constraint yet. This keeps the migration backward-compatible
-- with the currently deployed application during the rollout window.
ALTER TABLE "CreditNote"
  ADD COLUMN IF NOT EXISTS "pto_vta" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cbte_tipo" INTEGER NOT NULL DEFAULT 0;

-- Existing credit notes store the authorized voucher fields at the root of
-- payloadAfip. Fall back to the local type only for legacy rows without them.
UPDATE "CreditNote"
SET
  "pto_vta" = CASE
    WHEN ("payloadAfip"->>'PtoVta') ~ '^[0-9]+$'
      THEN ("payloadAfip"->>'PtoVta')::INTEGER
    ELSE "pto_vta"
  END,
  "cbte_tipo" = CASE
    WHEN ("payloadAfip"->>'CbteTipo') ~ '^[0-9]+$'
      THEN ("payloadAfip"->>'CbteTipo')::INTEGER
    WHEN "type" = 'Nota A' THEN 3
    WHEN "type" = 'Nota B' THEN 8
    ELSE "cbte_tipo"
  END
WHERE "payloadAfip" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_id_agency_pto_vta_cbte_tipo_credit_number_key"
  ON "CreditNote"("id_agency", "pto_vta", "cbte_tipo", "credit_number");
