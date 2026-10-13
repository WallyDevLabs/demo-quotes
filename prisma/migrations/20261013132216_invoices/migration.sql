-- DropIndex
DROP INDEX "Invoice_milestoneId_key";

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "detail" TEXT NOT NULL DEFAULT '';
