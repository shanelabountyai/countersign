-- Countersign issue #5 (D-45, D-46): each stored document records the org name it printed and the renderer that produced
-- it, so /verify re-derives from the snapshot instead of the org's current name, and can tell a renderer change from
-- tampering. Nullable: documents stored before this migration keep NULL (they are insert-only, D-35, and are not
-- rewritten here); verify falls back to the current org name for them, as before (D-41).
-- RLS: no new table. ProposalDocument's existing org policies (20261116000002_rls_policies_countersign_signing) are
-- row-level and cover the new columns; the D-35 freeze trigger keeps both columns write-once with the row.

-- AlterTable
ALTER TABLE "ProposalDocument" ADD COLUMN     "orgName" TEXT,
ADD COLUMN     "rendererVersion" TEXT;
