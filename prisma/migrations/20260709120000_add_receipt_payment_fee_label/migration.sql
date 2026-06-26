ALTER TABLE "ReceiptPayment"
ADD COLUMN IF NOT EXISTS "fee_label" TEXT;
