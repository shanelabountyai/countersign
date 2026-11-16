import { beforeEach, describe, expect, it } from 'vitest';
import { dbSystem as db } from '@/core/db/system';
import { addSampleTemplate } from '@/app/o/[org]/templates/actions';
import { SAMPLE_TEMPLATE_NAME, sampleTemplate } from '@/lib/proposal/sample-template';
import { createProposal, getProposal, sendProposal } from '@/lib/proposal/store';
import { resetAuthTables } from '../helpers/auth';
import { NavSignal } from '../helpers/next';
import { actAs, addMember, makeOrg } from '../helpers/org';

// Phase 4 (D-43): "Add the sample template" creates one editable template in the caller's org, copied in full; a
// proposal made from it can be sent (the PDF draws every character, D-31) and totals $0.00 until the author sets prices.

beforeEach(resetAuthTables);

describe('Add the sample template', () => {
  it('creates the sample in the caller’s org only, and redirects to it', async () => {
    const [a, b] = [await makeOrg('acme'), await makeOrg('beta')];
    const owner = await addMember(a.id, 'owner', 'owner@acme.test');
    await addMember(b.id, 'owner', 'owner@beta.test');
    const ctx = await actAs(owner.id, a.slug);
    const nav = await addSampleTemplate(a.slug, {}).catch((e: unknown) => e);
    expect(nav).toBeInstanceOf(NavSignal);
    const rows = await db.template.findMany({ include: { sections: { orderBy: { position: 'asc' } }, lines: { orderBy: { position: 'asc' } } } });
    expect(rows).toHaveLength(1);
    const t = rows[0]!;
    expect(t).toMatchObject({ orgId: a.id, name: SAMPLE_TEMPLATE_NAME });
    expect((nav as NavSignal).to).toBe(`/o/${ctx.slug}/templates/${t.id}`);
    const sample = sampleTemplate();
    expect(t.sections.map((s) => [s.kind, s.title, s.body])).toEqual(sample.sections.map((s) => [s.kind, s.title, s.body]));
    expect(t.lines.map((l) => [l.description, l.unitPriceCents, l.optional])).toEqual(sample.lines.map((l) => [l.description, BigInt(l.unitPriceCents), l.optional]));
    expect(await db.auditEvent.count({ where: { action: 'template.created', orgId: a.id } })).toBe(1);
  });

  it('a scorekeeper is refused (D-24) and nothing is written', async () => {
    const a = await makeOrg('acme');
    const sk = await addMember(a.id, 'scorekeeper', 'sk@acme.test');
    await actAs(sk.id, a.slug);
    expect(await addSampleTemplate(a.slug, {})).toEqual({ error: expect.stringMatching(/Your role cannot edit/) });
    expect(await db.template.count()).toBe(0);
  });

  it('a proposal from the sample sends: SAMPLE section first, $0.00 total, merge fields filled', async () => {
    const a = await makeOrg('acme');
    const ctx = await actAs((await addMember(a.id, 'owner', 'owner@acme.test')).id, a.slug);
    await addSampleTemplate(a.slug, {}).catch(() => {});
    const t = await db.template.findFirstOrThrow();
    const id = await createProposal(ctx, { templateId: t.id, title: 'AI adoption assessment', clientName: 'Example Client' });
    const cur = (await getProposal(ctx, id)).current;
    expect(cur.sections[0]!.renderedTitle).toBe('About this sample');
    expect(cur.pricing.totalCents).toBe(0);
    const r = await sendProposal(ctx, id, { version: cur.number, revision: cur.revision });
    expect(r.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
