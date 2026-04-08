ALTER TABLE "Investment"
ADD COLUMN "imputation_month" TIMESTAMP(3);

CREATE INDEX "Investment_imputation_month_idx" ON "Investment"("imputation_month");
