import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { displayCents } from '@/lib/proposal/money';
import { listProposals, listTemplates } from '@/lib/proposal/store';
import { StatusPill } from '@/lib/ui/status-pill';
import { day } from '@/lib/ui/format';
import { addProposal } from './actions';

export const metadata = { title: 'Proposals' };

// docs/design/ProposalsList.dc.html
export default async function Proposals({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const [proposals, templates] = await Promise.all([listProposals(ctx), listTemplates(ctx)]);
  const editor = ctx.role !== 'scorekeeper';
  return (
    <main className="cs-app">
      <div className="cs-col">
        <div className="cs-pagehead"><h1>Proposals</h1>{editor && <a href="#cs-new" className="cs-btn cs-btn--primary cs-onlynarrow">New proposal</a>}</div>
        <section aria-label="All proposals" className="cs-card cs-card--flush">
          {proposals.length === 0 ? (
            <div className="cs-empty">
              <h2>No proposals yet</h2>
              <p>{editor ? 'Start from a template or a blank page with the form beside this list. Nothing is sent until you press Send.' : 'Proposals your org creates will appear here.'}</p>
            </div>
          ) : (
            <div className="cs-scroll">
              <table className="cs-table cs-stack" style={{ minWidth: 680 }}>
                <thead><tr><th scope="col">Proposal</th><th scope="col">Client</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col" className="cs-num">Total</th></tr></thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/o/${ctx.slug}/proposals/${p.id}`} style={{ fontWeight: 600 }}>{p.title}</Link></td>
                      <td data-label="Client">{p.clientName}</td>
                      <td data-label="Version">v{p.number}</td>
                      <td data-label="Status"><StatusPill status={p.status} /></td>
                      <td data-label="Updated">{day(p.updatedAt)}</td>
                      <td className="cs-num" data-label="Total">{displayCents(p.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {editor && (
        <aside aria-label="New proposal" className="cs-side">
          <div className="cs-card">
            <h2 id="cs-new" tabIndex={-1}>New proposal</h2>
            <ActionForm action={addProposal.bind(null, ctx.slug)}>
              <div className="cs-rows">
                <label className="cs-label">
                  Template
                  <select name="templateId" defaultValue="" className="cs-input">
                    <option value="">Blank</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label className="cs-label">Title <input name="title" required maxLength={200} className="cs-input" /></label>
                <label className="cs-label">Client <input name="clientName" required maxLength={120} className="cs-input" /></label>
                <button type="submit" className="cs-btn cs-btn--primary">Create proposal</button>
                <span className="cs-hint">Creates version 1 as a draft. The template is copied; later template edits never change it.</span>
              </div>
            </ActionForm>
          </div>
        </aside>
      )}
    </main>
  );
}
