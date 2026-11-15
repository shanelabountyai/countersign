import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { getTemplate, toLineInput } from '@/lib/proposal/store';
import { LineRows, SectionRows } from '../../proposals/editor-fields';
import { removeTemplate, saveTemplate } from '../actions';

export const metadata = { title: 'Edit template' };

export default async function TemplateEditor({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org);
  const t = await getTemplate(ctx, (await params).id);
  const editable = ctx.role !== 'scorekeeper';
  return (
    <main>
      <p><Link href={`/o/${ctx.slug}/templates`}>← Templates</Link></p>
      <h1>{t.name}</h1>
      {editable ? (
        <>
          <ActionForm action={saveTemplate.bind(null, ctx.slug)}>
            <input type="hidden" name="id" value={t.id} />
            <label>Name <input name="name" defaultValue={t.name} required maxLength={120} /></label>
            <SectionRows sections={t.sections} />
            <LineRows lines={t.lines.map(toLineInput)} />
            <button type="submit">Save template</button>
          </ActionForm>
          <ActionForm action={removeTemplate.bind(null, ctx.slug)}>
            <input type="hidden" name="id" value={t.id} />
            <button type="submit">Delete template</button>
          </ActionForm>
        </>
      ) : <p>Your role can view templates but not edit them.</p>}
    </main>
  );
}
