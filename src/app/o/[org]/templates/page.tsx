import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { listTemplates } from '@/lib/proposal/store';
import { SAMPLE_TEMPLATE_NAME } from '@/lib/proposal/sample-template';
import { addSampleTemplate, addTemplate } from './actions';

export const metadata = { title: 'Templates' };

export default async function Templates({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const templates = await listTemplates(ctx);
  return (
    <main>
      <h1>Templates</h1>
      <p>Reusable sections, terms and line items. A proposal copies its template when it is created; editing a template later never changes existing proposals.</p>
      {templates.length === 0 ? <p>No templates yet.</p> : (
        <ul>
          {templates.map((t) => <li key={t.id}><Link href={`/o/${ctx.slug}/templates/${t.id}`}>{t.name}</Link></li>)}
        </ul>
      )}
      {ctx.role !== 'scorekeeper' && (
        <>
          <h2>New template</h2>
          <ActionForm action={addTemplate.bind(null, ctx.slug)}>
            <label>Name <input name="name" required maxLength={120} /></label>
            <button type="submit">Create template</button>
          </ActionForm>
          <h2>Sample template</h2>
          <p>
            {SAMPLE_TEMPLATE_NAME}: an editable starting point for an AI adoption assessment. It is a sample: every price
            is a $0.00 placeholder and it names no client.
          </p>
          <ActionForm action={addSampleTemplate.bind(null, ctx.slug)}>
            <button type="submit">Add the sample template</button>
          </ActionForm>
        </>
      )}
    </main>
  );
}
