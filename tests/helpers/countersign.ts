import { dbSystem as db } from '@/core/db/system';
import { sha256Hex } from '@/lib/proposal/hash';

// Phase 3 (D-35): a version can only enter `sent` with a stored proposal document whose sha256 is the recorded hash.
// Tests that drive applyEvent({ type: 'send' }) directly store a small stand-in document first.

export const testPdf = (tag: string) => Buffer.from(`%PDF-1.4 countersign test document ${tag}\n`);
export const testHash = (tag: string) => sha256Hex(testPdf(tag));

/** Stores `testPdf(tag)` as the proposal document of the proposal's current (draft) version; returns its hash. */
export async function storeTestPdf(proposalId: string, tag: string): Promise<string> {
  const v = await db.proposalVersion.findFirstOrThrow({ where: { proposalId }, orderBy: { number: 'desc' } });
  const bytes = testPdf(tag);
  const sha256 = sha256Hex(bytes);
  await db.proposalDocument.create({ data: { orgId: v.orgId, versionId: v.id, kind: 'proposal', sha256, byteLength: bytes.length, bytes } });
  return sha256;
}
