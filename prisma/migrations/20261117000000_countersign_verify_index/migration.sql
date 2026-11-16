-- Countersign Phase 4 (D-40): the verify page looks an uploaded PDF up by its SHA-256.
-- CreateIndex
CREATE INDEX "ProposalDocument_sha256_idx" ON "ProposalDocument"("sha256");
