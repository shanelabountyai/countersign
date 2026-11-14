import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { displayCents } from '@/lib/proposal/money';
import { listProposals, listTemplates } from '@/lib/proposal/store';
import { addProposal } from './actions';

export const metadata = { title: 'Proposals' };

export default async function Proposals({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const [proposals, templates] = await Promise.all([listProposals(ctx), listTemplates(ctx)]);
  return (
    <main>
      <h1>Proposals</h1>
      {proposals.length === 0 ? <p>No proposals yet.</p> : (
        <table>
          <thead><tr><th>Title</th><th>Client</th><th>Version</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            {proposals.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/o/${ctx.slug}/proposals/${p.id}`}>{p.title}</Link></td>
                <td>{p.clientName}</td>
                <td>v{p.number}</td>
                <td>{p.status}</td>
                <td>{displayCents(p.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ctx.role !== 'scorekeeper' && (
        <>
          <h2>New proposal</h2>
          <ActionForm action={addProposal.bind(null, ctx.slug)}>
            <label>
              Template{' '}
              <select name="templateId" defaultValue="">
                <option value="">Blank</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>{' '}
            <label>Title <input name="title" required maxLength={200} /></label>{' '}
            <label>Client <input name="clientName" required maxLength={120} /></label>{' '}
            <button type="submit">Create proposal</button>
          </ActionForm>
        </>
      )}
    </main>
  );
}
