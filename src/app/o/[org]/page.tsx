import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { displayCents } from '@/lib/proposal/money';
import { listProposals } from '@/lib/proposal/store';
import { day } from '@/lib/ui/format';
import { StatusPill } from '@/lib/ui/status-pill';

// The org home (design pass review UX-3): where sign-in lands. Recent proposals and the next step; an org with no
// proposals keeps the foundation's "Nothing here yet" state, with Countersign's first steps.
export default async function OrgHome({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const proposals = (await listProposals(ctx)).slice(0, 5);
  const base = `/o/${ctx.slug}`;
  const editor = ctx.role !== 'scorekeeper';
  return (
    <main className="cs-app cs-app--stack">
      <div className="cs-pagehead">
        <h1>{proposals.length ? 'Recent proposals' : 'Nothing here yet'}</h1>
        <div className="cs-actions">
          <Link className="cs-btn cs-btn--primary" href={`${base}/proposals`}>{editor ? 'New proposal' : 'All proposals'}</Link>
          <Link className="cs-btn" href={`${base}/templates`}>Templates</Link>
        </div>
      </div>
      {proposals.length === 0 ? (
        <section className="cs-card" aria-label="Getting started">
          <p style={{ margin: 0 }}>This org is ready. Create a template or a proposal, send it, and share the signing link with your client. <Link href={`${base}/settings/members`}>Invite your team</Link> to work on proposals together.</p>
        </section>
      ) : (
        <section aria-label="Recent proposals" className="cs-card cs-card--flush">
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {proposals.map((p, i) => (
              <li key={p.id} style={{ borderTop: i ? '1px solid var(--cs-line-soft)' : 0, padding: '4px 16px', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', justifyContent: 'space-between' }}>
                <Link href={`${base}/proposals/${p.id}`} style={{ fontWeight: 600, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>{p.title}</Link>
                <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="cs-meta">{p.clientName} · v{p.number} · {day(p.updatedAt)}</span>
                  <StatusPill status={p.status} />
                  <span className="cs-num">{displayCents(p.totalCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
