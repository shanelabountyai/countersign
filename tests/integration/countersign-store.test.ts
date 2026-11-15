import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OrgCtx } from '@/core/authz/guards';
import { advanceClock } from '@/core/clock';
import { dbSystem as db } from '@/core/db/system'; // assertions read as the owner role (RLS enforce leg)
import { Refused } from '@/core/errors';
import {
  applyEvent, createProposal, createTemplate, deleteProposal, getProposal, listProposals, saveDraft, updateTemplate, type DraftInput, type LineInput,
} from '@/lib/proposal/store';
import { HashMismatchError, linkAccess, transition, VersionMismatchError, type AuditEvent, type Proposal, type ProposalEvent, newProposal } from '@/lib/proposal/versioning';
import { resetAuthTables } from '../helpers/auth';
import { NavSignal } from '../helpers/next';
import { actAs, addMember, makeOrg } from '../helpers/org';

// Phase 2 store over Postgres: CS-01 (totals), CS-03 (supersede), CS-04 (one audit row per transition), CS-05 (org half),
// D-16 binding persisted, D-20 copy-on-create, D-26 stale saves, D-28 delete rules.

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

const line = (over: Partial<LineInput> = {}): LineInput => ({
  kind: 'fixed', description: 'Work', unitPriceCents: 10_000, quantityMilli: 1000, taxRateBps: 0, discount: null, optional: false, selected: false, ...over,
});

const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
  title: 'Website rebuild', clientName: 'Acme Co', clientEmail: 'buyer@acme.test', scope: 'a new site', timeline: '6 weeks', discount: null,
  sections: [{ kind: 'section', title: 'Scope', body: 'We will build {{scope}} for {{client}}.' }, { kind: 'terms', title: 'Terms', body: 'Net 30.' }],
  lines: [line({ description: 'Design', unitPriceCents: 250_000 }), line({ kind: 'hourly', description: 'Dev', unitPriceCents: 15_000, quantityMilli: 40_500, taxRateBps: 825 })],
  ...over,
});

let ctx: OrgCtx;
let other: OrgCtx;

beforeEach(async () => {
  await resetAuthTables();
  const [a, b] = [await makeOrg('acme'), await makeOrg('beta')];
  const [ua, ub] = [await addMember(a.id, 'owner', 'owner@acme.test'), await addMember(b.id, 'owner', 'owner@beta.test')];
  other = await actAs(ub.id, b.slug);
  ctx = await actAs(ua.id, a.slug);
});

const auditRows = (proposalId: string) =>
  db.auditEvent.findMany({ where: { action: { startsWith: 'proposal.version.' }, data: { path: ['proposalId'], equals: proposalId } }, orderBy: { id: 'asc' } });
const versions = (proposalId: string) => db.proposalVersion.findMany({ where: { proposalId }, orderBy: { number: 'asc' }, include: { lines: { orderBy: { position: 'asc' } }, sections: { orderBy: { position: 'asc' } } } });
const snapshot = async () => JSON.stringify(await Promise.all([db.proposalVersion.findMany({ orderBy: { id: 'asc' } }), db.proposalLine.findMany({ orderBy: { id: 'asc' } }), db.proposalSection.findMany({ orderBy: { id: 'asc' } }), db.auditEvent.count()]), (_, v) => (typeof v === 'bigint' ? v.toString() : v));

async function newDraft(d: DraftInput = draft()) {
  const id = await createProposal(ctx, { templateId: null, title: d.title, clientName: d.clientName });
  await saveDraft(ctx, id, { version: 1, revision: 1 }, d);
  return id;
}

async function sendAndView(id: string, version = 1, hash = H1) {
  await applyEvent(ctx, id, { type: 'send', pdfSha256: hash });
  await applyEvent(ctx, id, { type: 'view', version, pdfSha256: hash });
}

describe('templates (D-20, D-25)', () => {
  it('a proposal created from a template copies its sections and lines; later template edits do not reach it', async () => {
    const tid = await createTemplate(ctx, { name: 'Web', sections: draft().sections, lines: [line({ description: 'Design' }), line({ description: 'Hosting add-on', optional: true, selected: true })] });
    const pid = await createProposal(ctx, { templateId: tid, title: 'For Acme', clientName: 'Acme Co' });
    await updateTemplate(ctx, tid, { name: 'Web v2', sections: [{ kind: 'terms', title: 'New terms', body: 'Net 15.' }], lines: [] });

    const [v] = await versions(pid);
    expect(v!.sections.map((s) => s.title)).toEqual(['Scope', 'Terms']);
    expect(v!.lines.map((l) => [l.description, l.optional, l.selected])).toEqual([['Design', false, false], ['Hosting add-on', true, true]]);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: pid } })).templateId).toBe(tid);
  });

  it('refuses an unknown merge field in a template or a draft, writing nothing', async () => {
    await expect(createTemplate(ctx, { name: 'Bad', sections: [{ kind: 'section', title: 'x', body: 'Price: {{price}}' }], lines: [] })).rejects.toThrow(/unknown merge field: \{\{price\}\}/);
    const id = await newDraft();
    const before = await snapshot();
    await expect(saveDraft(ctx, id, { version: 1, revision: 2 }, draft({ sections: [{ kind: 'section', title: 'Hi {{name}}', body: '' }] }))).rejects.toThrow(Refused);
    expect(await snapshot()).toBe(before);
    expect(await db.template.count()).toBe(0);
  });

  it('renders merge fields from the version values', async () => {
    const id = await newDraft();
    const p = await getProposal(ctx, id);
    expect(p.current.sections[0]!.rendered).toBe('We will build a new site for Acme Co.');
  });
});

describe('drafts: in-place save (D-26)', () => {
  it('replaces the content in place, bumps the revision, writes version.edited', async () => {
    const id = await newDraft();
    await saveDraft(ctx, id, { version: 1, revision: 2 }, draft({ title: 'Renamed', lines: [line({ description: 'Only line', unitPriceCents: 999 })] }));
    const [v] = await versions(id);
    expect(v).toMatchObject({ number: 1, status: 'draft', revision: 3, title: 'Renamed' });
    expect(v!.lines.map((l) => l.description)).toEqual(['Only line']);
    expect((await auditRows(id)).map((a) => a.action)).toEqual(['proposal.version.created', 'proposal.version.edited', 'proposal.version.edited']);
  });

  it('refuses a save against a stale revision or version, writing nothing', async () => {
    const id = await newDraft(); // revision 2
    const before = await snapshot();
    await expect(saveDraft(ctx, id, { version: 1, revision: 1 }, draft({ title: 'Mine' }))).rejects.toThrow(/changed since you opened it/);
    await expect(saveDraft(ctx, id, { version: 2, revision: 2 }, draft({ title: 'Mine' }))).rejects.toThrow(/changed since you opened it/);
    expect(await snapshot()).toBe(before);
  });

  it('refuses amounts the pricing rules refuse (tax above 100 %, D-18), writing nothing', async () => {
    const id = await newDraft();
    const before = await snapshot();
    await expect(saveDraft(ctx, id, { version: 1, revision: 2 }, draft({ lines: [line({ taxRateBps: 10_001 })] }))).rejects.toThrow(/line 1: taxRateBps 10001 is above the cap/);
    expect(await snapshot()).toBe(before);
  });

  it('CS-01: reordering the lines of a draft leaves every total unchanged', async () => {
    const lines = [
      line({ description: 'A', unitPriceCents: 333, taxRateBps: 825 }), line({ description: 'B', unitPriceCents: 333, taxRateBps: 825 }),
      line({ kind: 'per_unit', description: 'C', unitPriceCents: 77, quantityMilli: 3333, taxRateBps: 700, discount: { type: 'percent', bps: 1250 } }),
      line({ description: 'D', unitPriceCents: 1001, optional: true, selected: true, taxRateBps: 825 }),
    ];
    const id = await newDraft(draft({ lines, discount: { type: 'fixed', cents: 101 } }));
    const a = (await getProposal(ctx, id)).current.pricing;
    await saveDraft(ctx, id, { version: 1, revision: 2 }, draft({ lines: [...lines].reverse(), discount: { type: 'fixed', cents: 101 } }));
    const b = (await getProposal(ctx, id)).current.pricing;
    const totals = (p: typeof a) => ({ ...p, lines: undefined });
    expect(totals(b)).toEqual(totals(a));
    expect(b.totalCents).toBe(a.lines.reduce((s, l) => s + l.totalCents, 0));
  });

  it('a scorekeeper cannot edit (D-24)', async () => {
    const sk = await addMember(ctx.orgId, 'scorekeeper', 'sk@acme.test');
    const skCtx = await actAs(sk.id, ctx.slug);
    await expect(createProposal(skCtx, { templateId: null, title: 'x', clientName: 'y' })).rejects.toThrow(/cannot edit/);
  });
});

describe('CS-05 (org half): another org cannot see or touch a proposal', () => {
  it('get, save, event and delete from org B answer notFound, writing nothing', async () => {
    const id = await newDraft();
    const before = await snapshot();
    await expect(getProposal(other, id)).rejects.toEqual(new NavSignal('notFound'));
    await expect(saveDraft(other, id, { version: 1, revision: 2 }, draft())).rejects.toEqual(new NavSignal('notFound'));
    await expect(applyEvent(other, id, { type: 'send', pdfSha256: H1 })).rejects.toEqual(new NavSignal('notFound'));
    await expect(deleteProposal(other, id)).rejects.toEqual(new NavSignal('notFound'));
    expect(await snapshot()).toBe(before);
    expect(await listProposals(other)).toEqual([]);
    expect((await listProposals(ctx)).map((p) => p.id)).toEqual([id]);
  });
});

describe('events persisted (D-16, CS-03, CS-04)', () => {
  it('send → view → sign: statuses, frozen hash, one audit row per transition', async () => {
    const id = await newDraft();
    await sendAndView(id);
    await applyEvent(ctx, id, { type: 'sign', version: 1, pdfSha256: H1.toUpperCase() }); // normalized (D-15)
    const [v] = await versions(id);
    expect(v).toMatchObject({ status: 'signed', pdfSha256: H1 });
    expect((await auditRows(id)).map((a) => [a.action, (a.data as { from: string | null }).from, (a.data as { to: string }).to])).toEqual([
      ['proposal.version.created', null, 'draft'],
      ['proposal.version.edited', 'draft', 'draft'],
      ['proposal.version.sent', 'draft', 'sent'],
      ['proposal.version.viewed', 'sent', 'viewed'],
      ['proposal.version.signed', 'viewed', 'signed'],
    ]);
  });

  it('D-16: a stale version or a different hash is refused and writes nothing', async () => {
    const id = await newDraft();
    await sendAndView(id);
    const before = await snapshot();
    await expect(applyEvent(ctx, id, { type: 'sign', version: 2, pdfSha256: H1 })).rejects.toBeInstanceOf(VersionMismatchError);
    await expect(applyEvent(ctx, id, { type: 'sign', version: 1, pdfSha256: H2 })).rejects.toBeInstanceOf(HashMismatchError);
    expect(await snapshot()).toBe(before);
  });

  it.each(['sent', 'viewed', 'declined', 'expired'] as const)('CS-03: an edit to a %s version supersedes it; the old link is 410', async (status) => {
    const id = await newDraft();
    await applyEvent(ctx, id, { type: 'send', pdfSha256: H1 });
    if (status !== 'sent') await applyEvent(ctx, id, { type: 'view', version: 1, pdfSha256: H1 });
    if (status === 'declined') await applyEvent(ctx, id, { type: 'decline', version: 1, pdfSha256: H1 });
    if (status === 'expired') await applyEvent(ctx, id, { type: 'expire' });

    const r = await saveDraft(ctx, id, { version: 1, revision: 0 }, draft({ title: 'Revised', lines: [line({ unitPriceCents: 1 })] }));
    expect(r).toEqual({ version: 2, superseded: true });
    const [v1, v2] = await versions(id);
    expect(v1).toMatchObject({ number: 1, status: 'superseded', pdfSha256: H1, title: 'Website rebuild' });
    expect(v1!.lines).toHaveLength(2); // the sent document is untouched
    expect(v2).toMatchObject({ number: 2, status: 'draft', pdfSha256: null, revision: 1, title: 'Revised' });
    expect(v2!.lines.map((l) => l.unitPriceCents)).toEqual([1n]);
    const p = await getProposal(ctx, id);
    expect(linkAccess(p.pure, 1)).toMatchObject({ code: 410, state: 'superseded' });
    expect((await auditRows(id)).slice(-2).map((a) => a.action)).toEqual(['proposal.version.superseded', 'proposal.version.created']);
  });

  it('a signed proposal cannot be edited or deleted', async () => {
    const id = await newDraft();
    await sendAndView(id);
    await applyEvent(ctx, id, { type: 'sign', version: 1, pdfSha256: H1 });
    const before = await snapshot();
    await expect(saveDraft(ctx, id, { version: 1, revision: 2 }, draft())).rejects.toThrow(/signed/);
    await expect(deleteProposal(ctx, id)).rejects.toThrow(/cannot be deleted/);
    expect(await snapshot()).toBe(before);
  });

  it('D-28: a never-sent proposal can be deleted, with an audit row', async () => {
    const id = await newDraft();
    await deleteProposal(ctx, id);
    expect(await db.proposal.count()).toBe(0);
    expect(await db.proposalLine.count()).toBe(0);
    expect(await db.auditEvent.count({ where: { action: 'proposal.deleted', targetId: id } })).toBe(1);
  });

  it('CS-04 property: for random event sequences the audit rows equal the pure audit events, and the rows equal the pure state', async () => {
    // Bound events are generated as intents (right/stale version, right/wrong hash) and resolved against the current
    // version when they run, so valid views, signs and declines actually happen instead of almost always being refused.
    type Intent = { type: ProposalEvent['type']; stale: boolean; wrongHash: boolean; hash: string };
    const ev = fc.record<Intent>({
      type: fc.constantFrom('edit', 'expire', 'send', 'view', 'view', 'sign', 'decline'),
      stale: fc.integer({ min: 0, max: 4 }).map((n) => n === 0),
      wrongHash: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
      hash: fc.constantFrom(H1, H2),
    });
    const resolve = (i: Intent, p: Proposal): ProposalEvent => {
      const cur = p.versions.at(-1)!;
      if (i.type === 'edit' || i.type === 'expire') return { type: i.type };
      if (i.type === 'send') return { type: 'send', pdfSha256: i.hash };
      const recorded = cur.pdfSha256 ?? i.hash;
      return { type: i.type, version: cur.number + (i.stale ? 1 : 0), pdfSha256: i.wrongHash ? (recorded === H1 ? H2 : H1) : recorded };
    };
    await fc.assert(
      fc.asyncProperty(fc.array(ev, { minLength: 1, maxLength: 10 }), async (intents) => {
        const id = await createProposal(ctx, { templateId: null, title: 'P', clientName: 'C' });
        let pure: Proposal = newProposal('t').proposal;
        const expected: Pick<AuditEvent, 'action' | 'version' | 'from' | 'to'>[] = [{ action: 'version.created', version: 1, from: null, to: 'draft' }];
        for (const intent of intents) {
          const e = resolve(intent, pure);
          advanceClock(1000);
          let r;
          try {
            r = transition(pure, e, 't');
          } catch {
            r = null;
          }
          const cur = pure.versions.at(-1)!;
          const call = e.type === 'edit' ? saveDraft(ctx, id, { version: cur.number, revision: cur.revision }, draft()) : applyEvent(ctx, id, e);
          if (r) {
            await call;
            pure = r.proposal;
            expected.push(...r.audit.map(({ action, version, from, to }) => ({ action, version, from, to })));
          } else {
            await expect(call).rejects.toThrow();
          }
        }
        const rows = await auditRows(id);
        const data = (a: (typeof rows)[number]) => a.data as Pick<AuditEvent, 'version' | 'from' | 'to'>;
        expect(rows.map((a) => ({ action: a.action.replace(/^proposal\./, ''), version: data(a).version, from: data(a).from, to: data(a).to }))).toEqual(expected);
        expect((await versions(id)).map((v) => ({ number: v.number, status: v.status, pdfSha256: v.pdfSha256, revision: v.revision }))).toEqual(pure.versions);
      }),
      { numRuns: 40 },
    );
  }, 120_000);
});
