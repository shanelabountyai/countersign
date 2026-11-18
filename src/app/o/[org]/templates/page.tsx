import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { listTemplates } from '@/lib/proposal/store';
import { SAMPLE_TEMPLATE_NAME } from '@/lib/proposal/sample-template';
import { day } from '@/lib/ui/format';
import { addSampleTemplate, addTemplate } from './actions';

export const metadata = { title: 'Templates' };

// docs/design/TemplatesList.dc.html
export default async function Templates({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const templates = await listTemplates(ctx);
  const editor = ctx.role !== 'scorekeeper';
  return (
    <main className="cs-app">
      <div className="cs-col">
        <div className="cs-pagehead"><h1>Templates</h1></div>
        <p className="cs-lede">Reusable sections, terms and line items. A proposal copies its template when it is created; editing a template later never changes existing proposals.</p>
        <section aria-label="All templates" className="cs-card cs-card--flush">
          {templates.length === 0 ? (
            <div className="cs-empty">
              <h2>No templates yet</h2>
              <p>{editor ? 'Create one, or add the sample template to see a full layout.' : 'Templates your org creates will appear here.'}</p>
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {templates.map((t, i) => (
                <li key={t.id} style={{ borderTop: i ? '1px solid var(--cs-line-soft)' : 0, padding: '4px 16px', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Link href={`/o/${ctx.slug}/templates/${t.id}`} style={{ fontWeight: 600, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>{t.name}</Link>
                  <span className="cs-meta">Updated {day(t.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {editor && (
        <aside aria-label="Add a template" className="cs-side">
          <div className="cs-card">
            <h2>New template</h2>
            <ActionForm action={addTemplate.bind(null, ctx.slug)}>
              <div className="cs-rows">
                <label className="cs-label">Name <input name="name" required maxLength={120} className="cs-input" /></label>
                <button type="submit" className="cs-btn cs-btn--primary">Create template</button>
              </div>
            </ActionForm>
          </div>
          <section aria-labelledby="cs-sample" className="cs-card">
            <span className="cs-pill cs-pill--warn" style={{ alignSelf: 'flex-start' }}><span aria-hidden="true">◐</span>Sample</span>
            <h2 id="cs-sample">{SAMPLE_TEMPLATE_NAME}</h2>
            <p style={{ margin: 0, color: 'var(--cs-ink-2)' }}>
              An editable starting point for an AI adoption assessment. It is a sample: every price is a $0.00 placeholder and it names no client. Each click adds a new copy you can edit.
            </p>
            <ActionForm action={addSampleTemplate.bind(null, ctx.slug)}>
              <button type="submit" className="cs-btn">Add the sample template</button>
            </ActionForm>
          </section>
        </aside>
      )}
    </main>
  );
}
