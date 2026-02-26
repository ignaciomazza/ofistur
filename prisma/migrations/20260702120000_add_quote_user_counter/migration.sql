ALTER TABLE "Quote"
ADD COLUMN "user_quote_id" INTEGER;

WITH ranked AS (
  SELECT
    "id_quote",
    ROW_NUMBER() OVER (
      PARTITION BY "id_agency", "id_user"
      ORDER BY "creation_date" ASC, "id_quote" ASC
    ) AS rn
  FROM "Quote"
)
UPDATE "Quote" q
SET "user_quote_id" = ranked.rn
FROM ranked
WHERE ranked."id_quote" = q."id_quote"
  AND q."user_quote_id" IS NULL;

ALTER TABLE "Quote"
ALTER COLUMN "user_quote_id" SET NOT NULL;

CREATE UNIQUE INDEX "agency_user_quote_id_unique"
ON "Quote"("id_agency", "id_user", "user_quote_id");
