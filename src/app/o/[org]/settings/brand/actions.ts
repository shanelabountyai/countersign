'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { orgAction } from '@/core/authz/action';
import { Refused } from '@/core/errors';
import { saveBrand } from '@/lib/proposal/brand-store';
import { LOGO_MAX_BYTES } from '@/lib/ui/brand';

// Settings → Brand (D-66): owner and admin (`org.update`). The logo arrives base64-encoded from the page (the action
// schema carries strings only), is decoded here and checked again in saveBrand.
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const saveBrandAction = orgAction(
  'org.update',
  z.object({ accent: z.string().max(20), logoBase64: z.string().max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 8), removeLogo: z.string().max(5).optional() }),
  async (ctx, i) => {
    if (!B64.test(i.logoBase64)) throw new Refused('The logo could not be read. Choose the file again.');
    const logo = i.logoBase64 ? new Uint8Array(Buffer.from(i.logoBase64, 'base64')) : null;
    await saveBrand(ctx, { accent: i.accent, logo, removeLogo: i.removeLogo === 'yes' });
    revalidatePath(`/o/${ctx.slug}/settings/brand`);
    return { notice: 'Brand saved. Client pages use it from now on.' };
  },
);
