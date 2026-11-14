import { dbSystem as db } from '@/core/db/system'; // fixtures run as the owner role (RLS enforce leg)

// CLONE-OWNED. The INV-01..04 harness seeds these rows in both fixture orgs, so it can drive
// actions whose inputs use ref('<model>') for the clone's own tables. Return { model: id } for
// one row of each model, owned by `org.orgId`. INV-29 (RLS enforce) calls it too, so every org-owned clone table has rows to scope.
// Countersign: one template (a section and a line) and one proposal whose v1 draft has a section and a line.
export async function seedApp(org: { orgId: string; userId: string }, key: 'a' | 'b'): Promise<Record<string, string>> {
  const { orgId } = org;
  const template = await db.template.create({
    data: {
      orgId,
      name: `Template ${key}`,
      sections: { create: [{ orgId, position: 0, kind: 'section', title: 'Scope', body: 'For {{client}}: {{scope}}' }] },
      lines: { create: [{ orgId, position: 0, kind: 'fixed', description: 'Discovery', unitPriceCents: 50_000n }] },
    },
  });
  const proposal = await db.proposal.create({ data: { orgId, templateId: template.id, createdById: org.userId } });
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
