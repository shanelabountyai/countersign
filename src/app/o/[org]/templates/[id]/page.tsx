import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { getTemplate, toLineInput } from '@/lib/proposal/store';
import { LineRows, SectionRows } from '../../proposals/editor-fields';
import { removeTemplate, saveTemplate } from '../actions';

export const metadata = { title: 'Edit template' };

// docs/design/TemplateEditor.dc.html
export default async function TemplateEditor({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const t = await getTemplate(ctx, (await params).id);
  const editable = ctx.role !== 'scorekeeper';
  return (
    <main className="cs-app cs-app--stack">
      <Link href={`/o/${ctx.slug}/templates`} className="cs-back">← Templates</Link>
      <div className="cs-pagehead"><h1>{t.name}</h1></div>
      {editable ? (
        <>
          <div role="note" className="cs-banner cs-banner--info">
            <span className="cs-banner__glyph" aria-hidden="true">i</span>
            <p>Saving changes this template only. Proposals already made from it keep their own copy.</p>
          </div>
          <ActionForm action={saveTemplate.bind(null, ctx.slug)}>
            <div className="cs-rows" style={{ gap: 18 }}>
              <input type="hidden" name="id" value={t.id} />
              <section aria-labelledby="cs-details" className="cs-card">
                <h2 id="cs-details">Details</h2>
                <label className="cs-label" style={{ maxWidth: 480 }}>Name <input name="name" defaultValue={t.name} required maxLength={120} className="cs-input" /></label>
              </section>
              <SectionRows sections={t.sections} />
              <LineRows lines={t.lines.map(toLineInput)} />
              <div><button type="submit" className="cs-btn cs-btn--primary">Save template</button></div>
            </div>
          </ActionForm>
          <details className="cs-danger" style={{ alignSelf: 'flex-start' }}>
            <summary>Delete this template…</summary>
            <div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--cs-ink-2)' }}>Proposals made from it keep their copy. This cannot be undone.</p>
              <ActionForm action={removeTemplate.bind(null, ctx.slug)}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="cs-btn cs-btn--danger">Delete template</button>
              </ActionForm>
            </div>
          </details>
        </>
      ) : (
        <div role="note" className="cs-banner cs-banner--info">
          <span className="cs-banner__glyph" aria-hidden="true">i</span>
          <p>Your role can view templates but not edit them.</p>
        </div>
      )}
    </main>
  );
}
