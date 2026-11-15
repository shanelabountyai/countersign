// Countersign: the two cross-org reads (INV-32, listed in src/core/db/cross-org.ts). A signing link's token names its
// org, so the lookup runs before any org is known (D-29); the expiry sweep crosses every org (D-36). Everything after
// the lookup runs inside withOrg with the link's own orgId.
import { now } from '@/core/clock';
import { asSystem } from '@/core/db/rls';
import { hashToken } from '@/core/tokens';

export type LinkRow = { id: string; orgId: string; versionId: string; expiresAt: Date; revokedAt: Date | null; proposalId: string; versionNumber: number };

/** The link behind a raw token, or null. Only the hash is compared (INV-07). */
export async function findLink(token: string): Promise<LinkRow | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const l = await asSystem((sys) =>
    sys.signingLink.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, orgId: true, versionId: true, expiresAt: true, revokedAt: true, version: { select: { proposalId: true, number: true } } },
    }),
  );
  return l && { id: l.id, orgId: l.orgId, versionId: l.versionId, expiresAt: l.expiresAt, revokedAt: l.revokedAt, proposalId: l.version.proposalId, versionNumber: l.version.number };
}

/**
 * Sent or viewed versions whose signing links have all run out or been revoked (and that had at least one): the cron
 * applies `expire` to each, inside its own org.
 */
export async function lapsedVersions(): Promise<{ orgId: string; proposalId: string; versionId: string }[]> {
  const at = now();
  return asSystem((sys) =>
    sys.proposalVersion.findMany({
      where: {
        status: { in: ['sent', 'viewed'] },
        signingLinks: { some: {}, none: { revokedAt: null, expiresAt: { gt: at } } },
      },
      select: { orgId: true, proposalId: true, id: true },
      orderBy: { statusAt: 'asc' },
      take: 500,
    }),
  ).then((rows) => rows.map((r) => ({ orgId: r.orgId, proposalId: r.proposalId, versionId: r.id })));
}
