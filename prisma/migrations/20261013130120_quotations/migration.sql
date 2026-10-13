/*
  Warnings:

  - Added the required column `kind` to the `QuotationLine` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "QuotationLineKind" AS ENUM ('LABOUR', 'DELIVERABLE', 'EXPENSE', 'URGENCY', 'CONTINGENCY', 'RECURRING');

-- AlterTable
ALTER TABLE "QuotationLine" ADD COLUMN     "detail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "kind" "QuotationLineKind" NOT NULL;

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "data" BYTEA;
