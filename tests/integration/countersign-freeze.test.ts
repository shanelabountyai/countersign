import { beforeEach, describe, expect, it } from 'vitest';
import type { OrgCtx } from '@/core/authz/guards';
import { dbSystem as db } from '@/core/db/system'; // raw writes as the owner role: the triggers, not RLS, must refuse them
import { applyEvent, createProposal, saveDraft, type DraftInput } from '@/lib/proposal/store';
import { resetAuthTables } from '../helpers/auth';
import { actAs, addMember, makeOrg } from '../helpers/org';

// D-21 / CS-02 (database half): once a version leaves draft its rows are frozen by triggers, whatever the caller.
// Every write here bypasses the store on purpose.

const H = 'c'.repeat(64);
const content: DraftInput = {
  title: 'T', clientName: 'C', clientEmail: '', scope: '', timeline: '', discount: null,
  sections: [{ kind: 'section', title: 'S', body: 'b' }],
  lines: [{ kind: 'fixed', description: 'L', unitPriceCents: 100, quantityMilli: 1000, taxRateBps: 0, discount: null, optional: false, selected: false }],
};

let ctx: OrgCtx;
beforeEach(async () => {
  await resetAuthTables();
  const org = await makeOrg('acme');
  ctx = await actAs((await addMember(org.id, 'owner', 'o@acme.test')).id, org.slug);
});

async function proposalAt(status: 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired' | 'superseded') {
  const id = await createProposal(ctx, { templateId: null, title: 'T', clientName: 'C' });
  await saveDraft(ctx, id, { version: 1, revision: 1 }, content);
  if (status !== 'draft') await applyEvent(ctx, id, { type: 'send', pdfSha256: H });
  if (['viewed', 'signed', 'declined'].includes(status)) await applyEvent(ctx, id, { type: 'view', version: 1, pdfSha256: H });
  if (status === 'signed') await applyEvent(ctx, id, { type: 'sign', version: 1, pdfSha256: H });
  if (status === 'declined') await applyEvent(ctx, id, { type: 'decline', version: 1, pdfSha256: H });
  if (status === 'expired') await applyEvent(ctx, id, { type: 'expire' });
  if (status === 'superseded') await saveDraft(ctx, id, { version: 1, revision: 2 }, content);
  const v = await db.proposalVersion.findFirstOrThrow({ where: { proposalId: id, number: 1 }, include: { lines: true, sections: true } });
  expect(v.status).toBe(status);
  return { id, v, line: v.lines[0]!, section: v.sections[0]! };
}

const FROZEN = /countersign_frozen/;
const NON_DRAFT = ['sent', 'viewed', 'signed', 'declined', 'expired', 'superseded'] as const;

describe('a version that left draft: content is frozen', () => {
  it.each(NON_DRAFT)('%s: title, client, discount, pdfSha256 and revision cannot change', async (status) => {
    const { v } = await proposalAt(status);
    for (const data of [{ title: 'x' }, { clientName: 'x' }, { scope: 'x' }, { discountType: 'fixed' as const, discountValue: 1n }, { pdfSha256: 'd'.repeat(64) }, { pdfSha256: null }, { revision: 9 }]) {
      await expect(db.proposalVersion.update({ where: { id: v.id }, data })).rejects.toThrow(FROZEN);
    }
    await expect(db.proposalVersion.findUniqueOrThrow({ where: { id: v.id } })).resolves.toMatchObject({ title: v.title, pdfSha256: v.pdfSha256, revision: v.revision });
  });

  it.each(NON_DRAFT)('%s: its lines and sections cannot be inserted, updated or deleted', async (status) => {
    const { v, line, section } = await proposalAt(status);
    await expect(db.proposalLine.update({ where: { id: line.id }, data: { unitPriceCents: 1n } })).rejects.toThrow(FROZEN);
    await expect(db.proposalLine.delete({ where: { id: line.id } })).rejects.toThrow(FROZEN);
    await expect(db.proposalLine.create({ data: { orgId: v.orgId, versionId: v.id, position: 9, kind: 'fixed', description: 'sneaky', unitPriceCents: 1n } })).rejects.toThrow(FROZEN);
    await expect(db.proposalSection.update({ where: { id: section.id }, data: { body: 'changed' } })).rejects.toThrow(FROZEN);
    await expect(db.proposalSection.delete({ where: { id: section.id } })).rejects.toThrow(FROZEN);
    await expect(db.proposalSection.create({ data: { orgId: v.orgId, versionId: v.id, position: 9, kind: 'terms', title: 'x', body: 'y' } })).rejects.toThrow(FROZEN);
    // moving a row onto the frozen version from elsewhere is an insert into it, too
    const { line: draftLine } = await proposalAt('draft');
    await expect(db.proposalLine.update({ where: { id: draftLine.id }, data: { versionId: v.id, position: 7 } })).rejects.toThrow(FROZEN);
    expect(await db.proposalLine.count({ where: { versionId: v.id } })).toBe(1);
  });

  it.each(NON_DRAFT)('%s: the version cannot be deleted, nor its proposal', async (status) => {
    const { id, v } = await proposalAt(status);
    await expect(db.proposalVersion.delete({ where: { id: v.id } })).rejects.toThrow(FROZEN);
    await expect(db.proposal.delete({ where: { id } })).rejects.toThrow(FROZEN);
    expect(await db.proposalVersion.count({ where: { id: v.id } })).toBe(1);
  });
});

describe('statuses move only along the Phase 1 table', () => {
  it.each(['signed', 'superseded'] as const)('%s accepts no update at all, not even statusAt', async (status) => {
    const { v } = await proposalAt(status);
    await expect(db.proposalVersion.update({ where: { id: v.id }, data: { statusAt: new Date() } })).rejects.toThrow(FROZEN);
    for (const s of ['draft', 'sent', 'viewed', 'declined', 'expired', 'superseded', 'signed'] as const) {
      await expect(db.proposalVersion.update({ where: { id: v.id }, data: { status: s } })).rejects.toThrow(FROZEN);
    }
  });

  it.each([
    ['sent', 'draft'], ['sent', 'signed'], ['sent', 'declined'], ['viewed', 'draft'], ['viewed', 'sent'], ['declined', 'signed'], ['declined', 'viewed'],
    ['expired', 'viewed'], ['expired', 'signed'], ['draft', 'viewed'], ['draft', 'signed'], ['draft', 'superseded'],
  ] as const)('%s → %s is refused', async (from, to) => {
    const { v } = await proposalAt(from);
    await expect(db.proposalVersion.update({ where: { id: v.id }, data: { status: to } })).rejects.toThrow(FROZEN);
  });

  it('a version is created as draft only (no fabricated signed row)', async () => {
    const { id } = await proposalAt('draft');
    await expect(db.proposalVersion.create({ data: { orgId: ctx.orgId, proposalId: id, number: 2, status: 'signed', statusAt: new Date(), title: 't', clientName: 'c' } })).rejects.toThrow(FROZEN);
  });

  it('entering sent needs a canonical 64-hex pdfSha256', async () => {
    const { v } = await proposalAt('draft');
    for (const pdfSha256 of [null, 'A'.repeat(64), 'a'.repeat(63), ` ${'a'.repeat(64)}`, 'g'.repeat(64)]) {
      await expect(db.proposalVersion.update({ where: { id: v.id }, data: { status: 'sent', pdfSha256 } })).rejects.toThrow(FROZEN);
    }
    await expect(db.proposalVersion.update({ where: { id: v.id }, data: { status: 'sent', pdfSha256: H } })).resolves.toMatchObject({ status: 'sent' });
  });

  it("a version's identity never changes, even as a draft", async () => {
    const { v } = await proposalAt('draft');
    await expect(db.proposalVersion.update({ where: { id: v.id }, data: { number: 5 } })).rejects.toThrow(FROZEN);
  });
});

describe('what stays possible', () => {
  it('a draft and its rows edit and delete freely', async () => {
    const { id, v, line, section } = await proposalAt('draft');
    await db.proposalVersion.update({ where: { id: v.id }, data: { title: 'new', revision: 7 } });
    await db.proposalLine.update({ where: { id: line.id }, data: { unitPriceCents: 5n } });
    await db.proposalSection.delete({ where: { id: section.id } });
    await db.proposal.delete({ where: { id } });
    expect(await db.proposalVersion.count()).toBe(0);
  });

  it('allowed moves on a sent version change only status and statusAt', async () => {
    const { v } = await proposalAt('viewed');
    await expect(db.proposalVersion.update({ where: { id: v.id }, data: { status: 'viewed', statusAt: new Date(Date.now() + 1000) } })).resolves.toMatchObject({ status: 'viewed' });
    await expect(db.proposalVersion.update({ where: { id: v.id }, data: { status: 'signed' } })).resolves.toMatchObject({ status: 'signed', pdfSha256: H });
  });

  it('org deletion still cascades through signed and superseded versions', async () => {
    await proposalAt('signed');
    await proposalAt('superseded');
    await db.org.delete({ where: { id: ctx.orgId } });
    for (const n of await Promise.all([db.proposal.count(), db.proposalVersion.count(), db.proposalLine.count(), db.proposalSection.count()])) expect(n).toBe(0);
  });
});
