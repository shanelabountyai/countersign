import { beforeEach, describe, expect, it } from 'vitest';
import type { OrgCtx } from '@/core/authz/guards';
import { dbSystem as db } from '@/core/db/system'; // raw writes as the owner role: the triggers, not RLS, must refuse them
import { sha256Hex } from '@/lib/proposal/hash';
import { applyEvent, createProposal, saveDraft, type DraftInput } from '@/lib/proposal/store';
import { resetAuthTables } from '../helpers/auth';
import { storeTestPdf, testHash, testPdf } from '../helpers/countersign';
import { actAs, addMember, makeOrg } from '../helpers/org';

// D-35 / CS-02: stored PDFs, signing links and signatures are tamper-evident in the database. Every write here bypasses
// the store on purpose.

const FROZEN = /countersign_frozen/;
const H = testHash('p');
const content: DraftInput = {
  title: 'T', clientName: 'C', clientEmail: '', scope: '', timeline: '', discount: null, sections: [],
  lines: [{ kind: 'fixed', description: 'L', unitPriceCents: 100, quantityMilli: 1000, taxRateBps: 0, discount: null, optional: false, selected: false }],
};

let ctx: OrgCtx;
let otherOrg: string;
beforeEach(async () => {
  await resetAuthTables();
  const [org, b] = [await makeOrg('acme'), await makeOrg('beta')];
  otherOrg = b.id;
  ctx = await actAs((await addMember(org.id, 'owner', 'o@acme.test')).id, org.slug);
});

type At = 'draft' | 'sent' | 'viewed' | 'signed';
async function at(status: At) {
  const id = await createProposal(ctx, { templateId: null, title: 'T', clientName: 'C' });
  await saveDraft(ctx, id, { version: 1, revision: 1 }, content);
  if (status !== 'draft') {
    await storeTestPdf(id, 'p');
    await applyEvent(ctx, id, { type: 'send', pdfSha256: H });
  }
  if (status === 'viewed' || status === 'signed') await applyEvent(ctx, id, { type: 'view', version: 1, pdfSha256: H });
  if (status === 'signed') await applyEvent(ctx, id, { type: 'sign', version: 1, pdfSha256: H });
  return { id, v: await db.proposalVersion.findFirstOrThrow({ where: { proposalId: id } }) };
}

const doc = (v: { id: string; orgId: string }, kind: 'proposal' | 'certificate', bytes = testPdf(kind), over: object = {}) => ({
  orgId: v.orgId, versionId: v.id, kind, sha256: sha256Hex(bytes), byteLength: bytes.length, bytes, ...over,
});
const link = (v: { id: string; orgId: string }, over: object = {}) => ({ orgId: v.orgId, versionId: v.id, tokenHash: sha256Hex(Buffer.from(`${Math.random()}`)), expiresAt: new Date(Date.now() + 86_400_000), ...over });
const signature = (v: { id: string; orgId: string }, over: object = {}) => ({
  orgId: v.orgId, versionId: v.id, signerName: 'Jane', method: 'typed' as const, signatureData: 'Jane', consentVersion: 'v1', consentText: 'I agree.', pdfSha256: H,
  selectedLineIds: [], subtotalCents: 100n, discountCents: 0n, taxCents: 0n, totalCents: 100n, ipHash: '0'.repeat(64), userAgent: 'test', signedAt: new Date(), ...over,
});

describe('stored documents', () => {
  it('sha256 and byteLength must be those of the bytes', async () => {
    const { v } = await at('draft');
    await expect(db.proposalDocument.create({ data: doc(v, 'proposal', testPdf('x'), { sha256: H }) })).rejects.toThrow(FROZEN);
    await expect(db.proposalDocument.create({ data: doc(v, 'proposal', testPdf('x'), { byteLength: 1 }) })).rejects.toThrow(FROZEN);
    await expect(db.proposalDocument.create({ data: doc(v, 'proposal', testPdf('x'), { orgId: otherOrg }) })).rejects.toThrow(FROZEN);
    await expect(db.proposalDocument.create({ data: doc(v, 'proposal') })).resolves.toMatchObject({ kind: 'proposal' });
  });

  it.each(['sent', 'viewed', 'signed'] as const)('a %s version: its PDF cannot be changed, deleted or replaced', async (status) => {
    const { id, v } = await at(status);
    const d = await db.proposalDocument.findFirstOrThrow({ where: { versionId: v.id, kind: 'proposal' } });
    expect(d.sha256).toBe(v.pdfSha256);
    expect(sha256Hex(d.bytes)).toBe(v.pdfSha256);
    await expect(db.proposalDocument.update({ where: { id: d.id }, data: { bytes: testPdf('evil') } })).rejects.toThrow(FROZEN);
    await expect(db.proposalDocument.update({ where: { id: d.id }, data: { sha256: testHash('evil') } })).rejects.toThrow(FROZEN);
    await expect(db.proposalDocument.delete({ where: { id: d.id } })).rejects.toThrow(FROZEN);
    await expect(db.$executeRaw`UPDATE "ProposalDocument" SET bytes = ${testPdf('evil')} WHERE id = ${d.id}::uuid`).rejects.toThrow(FROZEN);
    await expect(db.proposalDocument.create({ data: doc(v, 'proposal', testPdf('second')) })).rejects.toThrow(); // unique + not a draft
    await expect(db.proposal.delete({ where: { id } })).rejects.toThrow(FROZEN);
    expect((await db.proposalDocument.findUniqueOrThrow({ where: { id: d.id } })).sha256).toBe(H);
  });

  it('a certificate only for a signed version', async () => {
    for (const s of ['draft', 'sent', 'viewed'] as const) {
      const { v } = await at(s);
      await expect(db.proposalDocument.create({ data: doc(v, 'certificate') })).rejects.toThrow(FROZEN);
    }
    const { v } = await at('signed');
    const c = await db.proposalDocument.create({ data: doc(v, 'certificate') });
    await expect(db.proposalDocument.update({ where: { id: c.id }, data: { createdAt: new Date() } })).rejects.toThrow(FROZEN);
    await expect(db.proposalDocument.delete({ where: { id: c.id } })).rejects.toThrow(FROZEN);
  });
});

describe('send needs the stored document (CS-02)', () => {
  it('no document, or a document with another hash, refuses the send; the matching one allows it', async () => {
    const { id, v } = await at('draft');
    await expect(db.proposalVersion.update({ where: { id: v.id }, data: { status: 'sent', pdfSha256: H } })).rejects.toThrow(FROZEN);
    await expect(applyEvent(ctx, id, { type: 'send', pdfSha256: H })).rejects.toThrow();
    await storeTestPdf(id, 'other');
    await expect(db.proposalVersion.update({ where: { id: v.id }, data: { status: 'sent', pdfSha256: H } })).rejects.toThrow(FROZEN);
    await expect(applyEvent(ctx, id, { type: 'send', pdfSha256: testHash('other') })).resolves.toBeTruthy();
    expect(await db.auditEvent.count({ where: { action: 'proposal.version.sent' } })).toBe(1);
  });
});

describe('signing links', () => {
  it('created only for a sent or viewed version', async () => {
    for (const s of ['draft', 'signed'] as const) {
      const { v } = await at(s);
      await expect(db.signingLink.create({ data: link(v) })).rejects.toThrow(FROZEN);
    }
    const { v } = await at('sent');
    await expect(db.signingLink.create({ data: link(v, { orgId: otherOrg }) })).rejects.toThrow(FROZEN);
    await expect(db.signingLink.create({ data: link(v, { revokedAt: new Date() }) })).rejects.toThrow(FROZEN);
    await expect(db.signingLink.create({ data: link(v) })).resolves.toBeTruthy();
    const { v: viewed } = await at('viewed');
    await expect(db.signingLink.create({ data: link(viewed) })).resolves.toBeTruthy();
  });

  it('can be revoked once; nothing else changes; never deleted', async () => {
    const { v } = await at('sent');
    const l = await db.signingLink.create({ data: link(v) });
    for (const data of [{ expiresAt: new Date(Date.now() + 9e9) }, { tokenHash: '1'.repeat(64) }, { versionId: v.id, revokedAt: new Date(), expiresAt: new Date() }]) {
      await expect(db.signingLink.update({ where: { id: l.id }, data })).rejects.toThrow(FROZEN);
    }
    await expect(db.signingLink.update({ where: { id: l.id }, data: { revokedAt: new Date() } })).resolves.toBeTruthy();
    await expect(db.signingLink.update({ where: { id: l.id }, data: { revokedAt: new Date(Date.now() + 1000) } })).rejects.toThrow(FROZEN);
    await expect(db.signingLink.update({ where: { id: l.id }, data: { revokedAt: null } })).rejects.toThrow(FROZEN);
    await expect(db.signingLink.delete({ where: { id: l.id } })).rejects.toThrow(FROZEN);
  });
});

describe('signatures', () => {
  it('only for a signed version, and only for the document it recorded', async () => {
    for (const s of ['draft', 'sent', 'viewed'] as const) {
      const { v } = await at(s);
      await expect(db.proposalSignature.create({ data: signature(v) })).rejects.toThrow(FROZEN);
    }
    const { v } = await at('signed');
    await expect(db.proposalSignature.create({ data: signature(v, { pdfSha256: testHash('other') }) })).rejects.toThrow(FROZEN);
    await expect(db.proposalSignature.create({ data: signature(v, { orgId: otherOrg }) })).rejects.toThrow(FROZEN);
    const sig = await db.proposalSignature.create({ data: signature(v) });
    await expect(db.proposalSignature.create({ data: signature(v) })).rejects.toThrow(); // one per version
    for (const data of [{ signerName: 'Mallory' }, { totalCents: 1n }, { selectedLineIds: [v.id] }]) {
      await expect(db.proposalSignature.update({ where: { id: sig.id }, data })).rejects.toThrow(FROZEN);
    }
    await expect(db.proposalSignature.delete({ where: { id: sig.id } })).rejects.toThrow(FROZEN);
  });
});

describe('what stays possible', () => {
  it('a draft with a stored document can still be deleted (nothing was sent)', async () => {
    const { id } = await at('draft');
    await storeTestPdf(id, 'p');
    await db.proposal.delete({ where: { id } });
    expect(await db.proposalDocument.count()).toBe(0);
  });

  it('org deletion cascades through documents, links and signatures', async () => {
    const { v } = await at('signed');
    await db.proposalSignature.create({ data: signature(v) });
    await db.proposalDocument.create({ data: doc(v, 'certificate') });
    const { v: sent } = await at('sent');
    await db.signingLink.create({ data: link(sent) });
    await db.org.delete({ where: { id: ctx.orgId } });
    for (const n of await Promise.all([db.proposalDocument.count(), db.signingLink.count(), db.proposalSignature.count(), db.proposalVersion.count()])) expect(n).toBe(0);
  });
});
