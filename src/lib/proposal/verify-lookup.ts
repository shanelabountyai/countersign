// Countersign verify page (Phase 4): the one cross-org read it needs (INV-32, listed in src/core/db/cross-org.ts). An
// uploaded PDF names no org; its SHA-256 is looked up among every org's stored documents. Only the hash is compared, so a
// caller learns something only by holding the exact bytes (D-40). Everything after the lookup runs inside withOrg.
import { asSystem } from '@/core/db/rls';
import { normalizeSha256 } from './sha256-hex';

export type DocumentHit = { id: string; orgId: string; versionId: string; kind: 'proposal' | 'certificate' };

/** Stored documents (proposal PDFs and certificates) whose recorded sha256 is `sha256`. At most a few; normally one. */
export async function documentsByHash(sha256: string): Promise<DocumentHit[]> {
  const h = normalizeSha256(sha256);
  if (!h) return [];
  return asSystem((sys) =>
    sys.proposalDocument.findMany({ where: { sha256: h }, select: { id: true, orgId: true, versionId: true, kind: true }, orderBy: { createdAt: 'asc' }, take: 10 }),
  );
}
