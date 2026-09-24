ALTER TABLE "AgencyArcaConfig" ADD COLUMN "taxRegime" TEXT,
ADD COLUMN "observedTaxRegime" TEXT,
ADD COLUMN "taxRegimeCheckedAt" TIMESTAMP(3);

ALTER TABLE "ArcaConnectionJob" ADD COLUMN "passwordEncrypted" TEXT,
ADD COLUMN "stagedCertEncrypted" TEXT,
ADD COLUMN "stagedKeyEncrypted" TEXT,
ADD COLUMN "stagedServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "stagedSalesPoints" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "stagedSalesPoint" INTEGER,
ADD COLUMN "detectedTaxRegime" TEXT,
ADD COLUMN "regimeConfirmedByArca" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

-- Los trabajos anteriores dependían de una clave en memoria y no pueden
-- continuar después del despliegue. Dejarlos en curso impediría reconectar.
UPDATE "ArcaConnectionJob"
SET "status" = 'error',
    "lastError" = 'El proceso anterior se interrumpió al actualizar la conexión. Iniciá una conexión nueva.',
    "completedAt" = NOW()
WHERE "status" IN ('pending', 'running', 'waiting', 'requires_action')
  AND "passwordEncrypted" IS NULL;
