-- AlterTable
ALTER TABLE "Booking"
ADD COLUMN "voucher_pdf_draft" JSONB,
ADD COLUMN "voucher_pdf_draft_saved_at" TIMESTAMP(3);
