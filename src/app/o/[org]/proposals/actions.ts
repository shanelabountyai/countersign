'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { Refused } from '@/core/errors';
import { parseDiscount, parseLines, parseSections } from '@/lib/proposal/form';
import { InputError } from '@/lib/proposal/money';
import { createProposal, deleteProposal, LINK_DAYS, newSigningLink, requireInOrg, saveDraft, sendProposal } from '@/lib/proposal/store';
import { lineColumns, sectionColumns } from './form-schema';

// The proposal editor (Phase 2) and, from Phase 3, send (PDF rendered, stored and hashed) and a new signing link.

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

const days = (raw: string) => {
  if (!/^\d{1,3}$/.test(raw.trim())) throw new Refused(`Enter the link validity in days (${LINK_DAYS.min}–${LINK_DAYS.max}).`);
  return Number(raw.trim());
};
const until = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export const sendProposalAction = orgAction(null, z.object({ id: ref('proposal'), expectedVersion: short, expectedRevision: short, days: short }), async (ctx, i) => {
  await requireInOrg(ctx, 'proposal', i.id);
  if (!/^\d{1,9}$/.test(i.expectedVersion) || !/^\d{1,9}$/.test(i.expectedRevision)) throw new Refused('This form is out of date. Reload the page.');
  const r = await sendProposal(ctx, i.id, { version: Number(i.expectedVersion), revision: Number(i.expectedRevision) }, days(i.days));
  // No revalidatePath: re-rendering would remove this form (the version is no longer a draft) and its one-time notice with it.
  return { notice: `Version ${r.version} sent. Signing link, shown once (copy it now), valid until ${until(r.expiresAt)}: ${r.url} Reload the page to see the new status.` };
});

export const newLinkAction = orgAction(null, z.object({ id: ref('proposal'), days: short }), async (ctx, i) => {
  await requireInOrg(ctx, 'proposal', i.id);
  const r = await newSigningLink(ctx, i.id, days(i.days));
  revalidatePath(page(ctx.slug, i.id));
  return { notice: `New signing link, shown once (copy it now), valid until ${until(r.expiresAt)}. The previous link no longer works: ${r.url}` };
});
