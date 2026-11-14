'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { Refused } from '@/core/errors';
import { parseDiscount, parseLines, parseSections } from '@/lib/proposal/form';
import { InputError } from '@/lib/proposal/money';
import { createProposal, deleteProposal, requireInOrg, saveDraft } from '@/lib/proposal/store';
import { lineColumns, sectionColumns } from './form-schema';

// The proposal editor (Phase 2). No send here (D-19): Phase 3 adds it with the PDF and its hash.

const page = (slug: string, id: string) => `/o/${slug}/proposals/${id}`;
const short = z.string().max(2000);

export const addProposal = orgAction(
  null,
  z.object({ templateId: z.union([ref('template'), z.literal('')]), title: short, clientName: short }),
  async (ctx, i) => {
    const id = await createProposal(ctx, { templateId: i.templateId || null, title: i.title, clientName: i.clientName });
    redirect(page(ctx.slug, id));
  },
);

export const saveProposal = orgAction(
  null,
  z.object({
    id: ref('proposal'),
    expectedVersion: short,
    expectedRevision: short,
    title: short,
    clientName: short,
    clientEmail: short,
    scope: short,
    timeline: short,
    discountType: short,
    discount: short,
    ...sectionColumns,
    ...lineColumns,
  }),
  async (ctx, i) => {
    await requireInOrg(ctx, 'proposal', i.id); // before the form is read: another org's id answers like a missing one
    let expected, input;
    try {
      if (!/^\d{1,9}$/.test(i.expectedVersion) || !/^\d{1,9}$/.test(i.expectedRevision)) throw new InputError('This form is out of date. Reload the page.');
      expected = { version: Number(i.expectedVersion), revision: Number(i.expectedRevision) };
      input = {
        title: i.title,
        clientName: i.clientName,
        clientEmail: i.clientEmail,
        scope: i.scope,
        timeline: i.timeline,
        discount: parseDiscount(i.discountType, i.discount, 'Proposal'),
        sections: parseSections(i),
        lines: parseLines(i),
      };
    } catch (e) {
      if (e instanceof InputError) throw new Refused(e.message);
      throw e;
    }
    const r = await saveDraft(ctx, i.id, expected, input);
    revalidatePath(page(ctx.slug, i.id));
    if (r.superseded) redirect(`${page(ctx.slug, i.id)}?superseded=${r.version}`);
    return { notice: 'Draft saved.' };
  },
);

export const removeProposal = orgAction(null, z.object({ id: ref('proposal') }), async (ctx, i) => {
  await deleteProposal(ctx, i.id);
  redirect(`/o/${ctx.slug}/proposals`);
});
