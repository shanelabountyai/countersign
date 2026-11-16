-- Countersign Phase 3 (build-log #30): stored PDFs, signing links, signatures. Written by hand to match
-- prisma/schema/countersign.prisma (D-27: CI diffs the schema against the migrated database).

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('proposal', 'certificate');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('typed', 'drawn');

-- CreateTable
CREATE TABLE "ProposalDocument" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningLink" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SigningLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalSignature" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "signerName" TEXT NOT NULL,
    "method" "SignatureMethod" NOT NULL,
    "signatureData" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentText" TEXT NOT NULL,
    "pdfSha256" TEXT NOT NULL,
    "selectedLineIds" UUID[],
    "subtotalCents" BIGINT NOT NULL,
    "discountCents" BIGINT NOT NULL,
    "taxCents" BIGINT NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "signedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProposalSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProposalDocument_orgId_idx" ON "ProposalDocument"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalDocument_versionId_kind_key" ON "ProposalDocument"("versionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SigningLink_tokenHash_key" ON "SigningLink"("tokenHash");

-- CreateIndex
CREATE INDEX "SigningLink_versionId_idx" ON "SigningLink"("versionId");

-- CreateIndex
CREATE INDEX "SigningLink_orgId_idx" ON "SigningLink"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalSignature_versionId_key" ON "ProposalSignature"("versionId");

-- CreateIndex
CREATE INDEX "ProposalSignature_orgId_idx" ON "ProposalSignature"("orgId");

-- AddForeignKey
ALTER TABLE "ProposalDocument" ADD CONSTRAINT "ProposalDocument_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningLink" ADD CONSTRAINT "SigningLink_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalSignature" ADD CONSTRAINT "ProposalSignature_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProposalVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
