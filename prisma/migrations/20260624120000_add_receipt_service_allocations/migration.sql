CREATE TABLE IF NOT EXISTS "ReceiptServiceAllocation" (
    "id_receipt_service_allocation" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "amount_service" DECIMAL(18, 2) NOT NULL,
    "service_currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptServiceAllocation_pkey" PRIMARY KEY ("id_receipt_service_allocation"),
    CONSTRAINT "ReceiptServiceAllocation_receipt_id_fkey"
      FOREIGN KEY ("receipt_id") REFERENCES "Receipt"("id_receipt")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "receipt_service_allocation_unique"
  ON "ReceiptServiceAllocation"("receipt_id", "service_id");

CREATE INDEX IF NOT EXISTS "ReceiptServiceAllocation_receipt_id_idx"
  ON "ReceiptServiceAllocation"("receipt_id");

CREATE INDEX IF NOT EXISTS "ReceiptServiceAllocation_service_id_idx"
  ON "ReceiptServiceAllocation"("service_id");
