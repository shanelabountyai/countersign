-- Countersign Phase 2 (build-log #30): templates, proposals, versions. Written by hand to match
-- prisma/schema/countersign.prisma (D-27: CI diffs the schema against the migrated database).

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'superseded');

-- CreateEnum
CREATE TYPE "LineKind" AS ENUM ('fixed', 'hourly', 'per_unit');

-- CreateEnum
CREATE TYPE "SectionKind" AS ENUM ('section', 'terms');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('percent', 'fixed');

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSection" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "SectionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "TemplateSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateLine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "unitPriceCents" BIGINT NOT NULL,
    "quantityMilli" INTEGER NOT NULL DEFAULT 1000,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType",
    "discountValue" BIGINT,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "templateId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVersion" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'draft',
    "statusAt" TIMESTAMPTZ(6) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "pdfSha256" TEXT,
    "title" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "timeline" TEXT NOT NULL DEFAULT '',
    "discountType" "DiscountType",
    "discountValue" BIGINT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalSection" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "SectionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "ProposalSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalLine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "unitPriceCents" BIGINT NOT NULL,
    "quantityMilli" INTEGER NOT NULL DEFAULT 1000,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "discountType" "DiscountType",
    "discountValue" BIGINT,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProposalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Template_orgId_idx" ON "Template"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSection_templateId_position_key" ON "TemplateSection"("templateId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateLine_templateId_position_key" ON "TemplateLine"("templateId", "position");

-- CreateIndex
CREATE INDEX "Proposal_orgId_idx" ON "Proposal"("orgId");

-- CreateIndex
CREATE INDEX "ProposalVersion_orgId_idx" ON "ProposalVersion"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVersion_proposalId_number_key" ON "ProposalVersion"("proposalId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalSection_versionId_position_key" ON "ProposalSection"("versionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalLine_versionId_position_key" ON "ProposalLine"("versionId", "position");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSection" ADD CONSTRAINT "TemplateSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateLine" ADD CONSTRAINT "TemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalSection" ADD CONSTRAINT "ProposalSection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalLine" ADD CONSTRAINT "ProposalLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
