-- AlterTable
ALTER TABLE "Quote"
ADD COLUMN "quote_status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "converted_at" TIMESTAMP(3),
ADD COLUMN "converted_booking_id" INTEGER,
ADD COLUMN "pdf_draft" JSONB,
ADD COLUMN "pdf_draft_saved_at" TIMESTAMP(3),
ADD COLUMN "pdf_last_file_name" TEXT;

-- CreateIndex
CREATE INDEX "agency_quote_status_idx" ON "Quote"("id_agency", "quote_status");
