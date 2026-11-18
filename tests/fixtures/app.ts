import { createHash } from 'node:crypto';
import { dbSystem as db } from '@/core/db/system'; // fixtures run as the owner role (RLS enforce leg)

// Ids derived from the org id: the harness computes an action's input (with these ids) before it re-seeds, so a row's id
// must be the same on every seed, and INV-29's random orgs still get distinct rows.
const idFor = (orgId: string, what: string) => {
  const h = createHash('sha256').update(`${orgId}:${what}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// CLONE-OWNED. The INV-01..04 harness seeds these rows in both fixture orgs, so it can drive
// actions whose inputs use ref('<model>') for the clone's own tables. Return { model: id } for
// one row of each model, owned by `org.orgId`. INV-29 (RLS enforce) calls it too, so every org-owned clone table has rows to scope.
// Countersign: one template (a section and a line), one proposal whose v1 draft has a section and a line, and one signed proposal.
export async function seedApp(org: { orgId: string; userId: string }, key: 'a' | 'b'): Promise<Record<string, string>> {
  const { orgId } = org;
  const template = await db.template.create({
    data: {
      id: idFor(orgId, 'template'),
      orgId,
      name: `Template ${key}`,
      sections: { create: [{ orgId, position: 0, kind: 'section', title: 'Scope', body: 'For {{client}}: {{scope}}' }] },
      lines: { create: [{ orgId, position: 0, kind: 'fixed', description: 'Discovery', unitPriceCents: 50_000n }] },
    },
  });
  const proposal = await db.proposal.create({ data: { id: idFor(orgId, 'proposal'), orgId, templateId: template.id, createdById: org.userId } });
  await db.proposalVersion.create({
    data: {
      orgId,
      proposalId: proposal.id,
      number: 1,
      statusAt: new Date(),
      title: `Proposal ${key}`,
      clientName: `Client ${key}`,
      sections: { create: [{ orgId, position: 0, kind: 'section', title: 'Scope', body: 'For {{client}}' }] },
      lines: { create: [{ orgId, position: 0, kind: 'fixed', description: 'Discovery', unitPriceCents: 50_000n }] },
    },
  });
  // Phase 3 (INV-29 needs rows in every org-owned table): a second proposal, sent and signed, with its stored PDF, a
  // signing link, the signature and the certificate. Written in the order the triggers allow (D-35).
  const signed = await db.proposal.create({ data: { id: idFor(orgId, 'signedProposal'), orgId, createdById: org.userId } });
  const sv = await db.proposalVersion.create({
    data: { id: idFor(orgId, 'signedVersion'), orgId, proposalId: signed.id, number: 1, statusAt: new Date(), title: `Signed ${key}`, clientName: `Client ${key}` },
  });
  const pdf = Buffer.from(`%PDF-1.4 fixture ${key}\n`);
  const pdfSha256 = createHash('sha256').update(pdf).digest('hex');
  await db.proposalDocument.create({ data: { orgId, versionId: sv.id, kind: 'proposal', sha256: pdfSha256, byteLength: pdf.length, bytes: pdf } });
  await db.proposalVersion.update({ where: { id: sv.id }, data: { status: 'sent', pdfSha256 } });
  const link = await db.signingLink.create({
    data: { id: idFor(orgId, 'signingLink'), orgId, versionId: sv.id, tokenHash: createHash('sha256').update(`fixture-token-${orgId}`).digest('hex'), expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await db.proposalVersion.update({ where: { id: sv.id }, data: { status: 'viewed' } });
  await db.proposalVersion.update({ where: { id: sv.id }, data: { status: 'signed' } });
  await db.proposalSignature.create({
    data: {
      orgId, versionId: sv.id, signerName: `Signer ${key}`, method: 'typed', signatureData: `Signer ${key}`, consentVersion: 'v1', consentText: 'I agree.',
      pdfSha256, selectedLineIds: [], subtotalCents: 0n, discountCents: 0n, taxCents: 0n, totalCents: 0n, ipHash: '0'.repeat(64), userAgent: 'fixture', signedAt: new Date(),
    },
  });
  const cert = Buffer.from(`%PDF-1.4 fixture certificate ${key}\n`);
  await db.proposalDocument.create({ data: { orgId, versionId: sv.id, kind: 'certificate', sha256: createHash('sha256').update(cert).digest('hex'), byteLength: cert.length, bytes: cert } });

  return { template: template.id, proposal: proposal.id, signedProposal: signed.id, signingLink: link.id };
}

// CLONE-OWNED. The clone's models with no orgId column, i.e. outside tenancy and RLS on purpose (INV-42, v1.7.0). Name
// each one with a comment saying why; a model without orgId that is not here (or in core's list) fails INV-42.
export const GLOBAL_MODELS: readonly string[] = [];
