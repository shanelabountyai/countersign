'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { orgAction, ref } from '@/core/authz/action';
import { Refused } from '@/core/errors';
import { parseLines, parseSections } from '@/lib/proposal/form';
import { InputError } from '@/lib/proposal/money';
import { createTemplate, deleteTemplate, requireInOrg, updateTemplate } from '@/lib/proposal/store';
import { lineColumns, sectionColumns } from '../proposals/form-schema';

// Templates (PRD scope v1): sections with merge fields, terms blocks, reusable line items. Editors: D-24 (in the store).

const name = z.string().max(200);

export const addTemplate = orgAction(null, z.object({ name }), async (ctx, i) => {
  const id = await createTemplate(ctx, { name: i.name, sections: [], lines: [] });
  redirect(`/o/${ctx.slug}/templates/${id}`);
});

export const saveTemplate = orgAction(null, z.object({ id: ref('template'), name, ...sectionColumns, ...lineColumns }), async (ctx, i) => {
  await requireInOrg(ctx, 'template', i.id); // before the form is read: another org's id answers like a missing one
  let input;
  try {
    input = { name: i.name, sections: parseSections(i), lines: parseLines(i) };
  } catch (e) {
    if (e instanceof InputError) throw new Refused(e.message);
    throw e;
  }
  await updateTemplate(ctx, i.id, input);
  revalidatePath(`/o/${ctx.slug}/templates/${i.id}`);
  return { notice: 'Template saved.' };
});

export const removeTemplate = orgAction(null, z.object({ id: ref('template') }), async (ctx, i) => {
  await deleteTemplate(ctx, i.id);
  redirect(`/o/${ctx.slug}/templates`);
});
