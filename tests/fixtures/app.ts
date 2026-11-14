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
// Countersign: one template (a section and a line) and one proposal whose v1 draft has a section and a line.
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
  return { template: template.id, proposal: proposal.id };
}
