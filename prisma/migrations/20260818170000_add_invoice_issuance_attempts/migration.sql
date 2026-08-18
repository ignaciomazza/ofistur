CREATE TABLE "InvoiceIssuanceAttempt" (
  "id_invoice_issuance_attempt" SERIAL NOT NULL,
  "id_agency" INTEGER NOT NULL,
  "request_key" TEXT NOT NULL,
  "item_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "active_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "booking_id" INTEGER NOT NULL,
  "client_id" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "cbte_tipo" INTEGER NOT NULL,
  "prepared_payload" JSONB,
  "authorized_payload" JSONB,
  "qr_base64" TEXT,
  "invoice_id" INTEGER,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoiceIssuanceAttempt_pkey"
    PRIMARY KEY ("id_invoice_issuance_attempt")
);

CREATE UNIQUE INDEX "InvoiceIssuanceAttempt_invoice_id_key"
  ON "InvoiceIssuanceAttempt"("invoice_id");

CREATE UNIQUE INDEX "agency_invoice_issuance_item_unique"
  ON "InvoiceIssuanceAttempt"("id_agency", "request_key", "item_key");

CREATE UNIQUE INDEX "agency_invoice_issuance_active_unique"
  ON "InvoiceIssuanceAttempt"("id_agency", "active_key");

CREATE INDEX "InvoiceIssuanceAttempt_id_agency_status_updated_at_idx"
  ON "InvoiceIssuanceAttempt"("id_agency", "status", "updated_at");

CREATE INDEX "InvoiceIssuanceAttempt_booking_id_idx"
  ON "InvoiceIssuanceAttempt"("booking_id");

CREATE INDEX "InvoiceIssuanceAttempt_client_id_idx"
  ON "InvoiceIssuanceAttempt"("client_id");

ALTER TABLE "InvoiceIssuanceAttempt"
  ADD CONSTRAINT "InvoiceIssuanceAttempt_id_agency_fkey"
  FOREIGN KEY ("id_agency") REFERENCES "Agency"("id_agency")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceIssuanceAttempt"
  ADD CONSTRAINT "InvoiceIssuanceAttempt_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "Booking"("id_booking")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceIssuanceAttempt"
  ADD CONSTRAINT "InvoiceIssuanceAttempt_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "Client"("id_client")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceIssuanceAttempt"
  ADD CONSTRAINT "InvoiceIssuanceAttempt_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id_invoice")
  ON DELETE SET NULL ON UPDATE CASCADE;
