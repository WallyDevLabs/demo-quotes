-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LabourCategory" AS ENUM ('DEVELOPMENT', 'DESIGN', 'TESTING', 'CONSULTING', 'PROJECT_MANAGEMENT');

-- CreateEnum
CREATE TYPE "Complexity" AS ENUM ('BASIC', 'INTERMEDIATE', 'ADVANCED', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "PricingMethod" AS ENUM ('TIME', 'FIXED');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "EstimateLineKind" AS ENUM ('LABOUR', 'DELIVERABLE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "RecurringPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('LEAD', 'QUOTED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VatMode" AS ENUM ('NONE', 'STANDARD', 'ZERO_RATED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('EFT', 'CARD', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentLabel" AS ENUM ('DEPOSIT', 'MILESTONE', 'FINAL', 'OTHER');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('ZAR', 'USD');

-- CreateEnum
CREATE TYPE "CounterKind" AS ENUM ('QUOTATION', 'INVOICE');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('LOGO', 'QUOTATION_PDF', 'INVOICE_PDF');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "recoveryCodeHashes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSettings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL DEFAULT '',
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "address" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "logoFileId" TEXT,
    "defaultCurrency" "Currency" NOT NULL DEFAULT 'ZAR',
    "hoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8,
    "urgencyPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "contingencyPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "quotationValidityDays" INTEGER NOT NULL DEFAULT 30,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 14,
    "upcomingWindowDays" INTEGER NOT NULL DEFAULT 14,
    "defaultMilestones" JSONB NOT NULL DEFAULT '[]',
    "revisionPolicy" TEXT NOT NULL DEFAULT '',
    "termsAndConditions" TEXT NOT NULL DEFAULT '',
    "quotationPattern" TEXT NOT NULL DEFAULT 'QUO{YYYY}{SEQ:4}',
    "invoicePattern" TEXT NOT NULL DEFAULT 'INV{YYYY}{SEQ:4}',
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatNumber" TEXT,
    "vatRatePct" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "vatThresholdCents" BIGINT,
    "vatWarnSharePct" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateSetting" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "category" "LabourCategory" NOT NULL,
    "hourlyCents" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencySettings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "minimumHourlyRateCents" BIGINT NOT NULL DEFAULT 0,
    "bankingDetails" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplexityMultiplier" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "level" "Complexity" NOT NULL,
    "multiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplexityMultiplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberCounter" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "CounterKind" NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NumberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "companyName" TEXT,
    "registrationNumber" TEXT,
    "vatNumber" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'LEAD',
    "deadline" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "currency" "Currency" NOT NULL DEFAULT 'ZAR',
    "method" "PricingMethod" NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "complexity" "Complexity",
    "complexityMultiplier" DECIMAL(5,2),
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "urgencyPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "contingencyPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountPct" DECIMAL(5,2),
    "discountCents" BIGINT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLine" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "kind" "EstimateLineKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "category" "LabourCategory",
    "hours" DECIMAL(8,2),
    "rateCents" BIGINT,
    "rateOverridden" BOOLEAN NOT NULL DEFAULT false,
    "priceCents" BIGINT,
    "costCents" BIGINT,
    "markupPct" DECIMAL(5,2),
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "period" "RecurringPeriod",

    CONSTRAINT "EstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "estimateId" TEXT,
    "number" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "deliverables" TEXT NOT NULL DEFAULT '',
    "exclusions" TEXT NOT NULL DEFAULT '',
    "timeline" TEXT NOT NULL DEFAULT '',
    "revisionPolicy" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "issueDate" DATE,
    "expiryDate" DATE,
    "currency" "Currency" NOT NULL DEFAULT 'ZAR',
    "vatMode" "VatMode" NOT NULL DEFAULT 'NONE',
    "subtotalCents" BIGINT NOT NULL DEFAULT 0,
    "discountCents" BIGINT NOT NULL DEFAULT 0,
    "vatCents" BIGINT NOT NULL DEFAULT 0,
    "totalCents" BIGINT NOT NULL DEFAULT 0,
    "businessSnapshot" JSONB,
    "clientSnapshot" JSONB,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" DATE,
    "acceptedBy" TEXT,
    "rejectedAt" DATE,
    "rejectionReason" TEXT,
    "pdfFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationMilestone" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "amountCents" BIGINT NOT NULL,

    CONSTRAINT "QuotationMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "quotationId" TEXT,
    "milestoneId" TEXT,
    "customReason" TEXT,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE,
    "dueDate" DATE,
    "currency" "Currency" NOT NULL DEFAULT 'ZAR',
    "vatMode" "VatMode" NOT NULL DEFAULT 'NONE',
    "subtotalCents" BIGINT NOT NULL DEFAULT 0,
    "discountCents" BIGINT NOT NULL DEFAULT 0,
    "vatCents" BIGINT NOT NULL DEFAULT 0,
    "totalCents" BIGINT NOT NULL DEFAULT 0,
    "businessSnapshot" JSONB,
    "clientSnapshot" JSONB,
    "bankingSnapshot" JSONB,
    "paymentReference" TEXT,
    "zarValueAtIssueCents" BIGINT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "pdfFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "label" "PaymentLabel" NOT NULL DEFAULT 'OTHER',
    "reference" TEXT,
    "notes" TEXT,
    "reversesPaymentId" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSettings_ownerId_key" ON "BusinessSettings"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "RateSetting_ownerId_currency_category_key" ON "RateSetting"("ownerId", "currency", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencySettings_ownerId_currency_key" ON "CurrencySettings"("ownerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ComplexityMultiplier_ownerId_level_key" ON "ComplexityMultiplier"("ownerId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "NumberCounter_ownerId_kind_key" ON "NumberCounter"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "Client_ownerId_idx" ON "Client"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_ownerId_code_key" ON "Client"("ownerId", "code");

-- CreateIndex
CREATE INDEX "Project_ownerId_status_idx" ON "Project"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ownerId_code_key" ON "Project"("ownerId", "code");

-- CreateIndex
CREATE INDEX "Estimate_ownerId_idx" ON "Estimate"("ownerId");

-- CreateIndex
CREATE INDEX "Estimate_projectId_idx" ON "Estimate"("projectId");

-- CreateIndex
CREATE INDEX "EstimateLine_estimateId_position_idx" ON "EstimateLine"("estimateId", "position");

-- CreateIndex
CREATE INDEX "Quotation_ownerId_status_idx" ON "Quotation"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Quotation_projectId_idx" ON "Quotation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_ownerId_number_key" ON "Quotation"("ownerId", "number");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_position_idx" ON "QuotationLine"("quotationId", "position");

-- CreateIndex
CREATE INDEX "QuotationMilestone_quotationId_position_idx" ON "QuotationMilestone"("quotationId", "position");

-- CreateIndex
CREATE INDEX "Invoice_ownerId_status_idx" ON "Invoice"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Invoice_quotationId_idx" ON "Invoice"("quotationId");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_ownerId_number_key" ON "Invoice"("ownerId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_milestoneId_key" ON "Invoice"("milestoneId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_position_idx" ON "InvoiceLine"("invoiceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversesPaymentId_key" ON "Payment"("reversesPaymentId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_ownerId_receivedOn_idx" ON "Payment"("ownerId", "receivedOn");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");

-- CreateIndex
CREATE INDEX "StoredFile_ownerId_kind_idx" ON "StoredFile"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_ownerId_entity_entityId_idx" ON "AuditLog"("ownerId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_ownerId_createdAt_idx" ON "AuditLog"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationMilestone" ADD CONSTRAINT "QuotationMilestone_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "QuotationMilestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversesPaymentId_fkey" FOREIGN KEY ("reversesPaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

