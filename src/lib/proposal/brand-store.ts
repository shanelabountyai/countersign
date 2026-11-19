// Per-org branding (D-66): read for client pages (inside the link's own org) and written from Settings → Brand
// (owner and admin, `org.update`). Every write is audited. The brand is presentation only: no PDF or hash uses it.
import { audit } from '@/core/audit';
import type { OrgCtx } from '@/core/authz/guards';
import { withOrg, type Tx } from '@/core/db/rls';
import { Refused } from '@/core/errors';
import { accentProblem, LOGO_MAX_BYTES, NO_BRAND, normalizeHex, sniffLogo, type Brand, type LogoType } from '@/lib/ui/brand';
import { sha256Hex } from './hash';

/** The org's brand, inside a transaction already scoped to that org. */
export async function brandIn(tx: Tx, orgId: string): Promise<Brand> {
  const b = await tx.orgBrand.findUnique({ where: { orgId }, select: { accentHex: true, logoType: true, logoBytes: true } });
  if (!b) return NO_BRAND;
  return {
    accentHex: b.accentHex,
    logo: b.logoBytes && b.logoType ? { type: b.logoType as LogoType, base64: Buffer.from(b.logoBytes).toString('base64') } : null,
  };
}

export const getBrand = (ctx: Pick<OrgCtx, 'orgId'>) => withOrg(ctx, (tx) => brandIn(tx, ctx.orgId), { atomic: false });

export type BrandInput = { accent: string; logo: Uint8Array | null; removeLogo: boolean };

/** Validates and stores the brand. A blank accent clears it; a new logo replaces the old; removeLogo drops it. */
export async function saveBrand(ctx: OrgCtx, input: BrandInput): Promise<void> {
  const raw = input.accent.trim();
  const accentHex = raw === '' ? null : normalizeHex(raw);
  if (raw !== '' && !accentHex) throw new Refused('Enter the colour as a hex code, like #0F5E63.');
  if (accentHex) {
    const p = accentProblem(accentHex);
    if (p) throw new Refused(p);
  }
  let logo: { logoType: LogoType; logoBytes: Uint8Array<ArrayBuffer>; logoSha256: string } | null = null;
  if (input.logo && input.logo.length > 0) {
    if (input.logo.length > LOGO_MAX_BYTES) throw new Refused(`The logo is larger than ${LOGO_MAX_BYTES / 1024} KB. Use a smaller PNG or JPEG.`);
    const type = sniffLogo(input.logo);
    if (!type) throw new Refused('The logo must be a PNG or JPEG file.');
    logo = { logoType: type, logoBytes: new Uint8Array(input.logo), logoSha256: sha256Hex(input.logo) };
  }
  const logoData = logo ?? (input.removeLogo ? { logoType: null, logoBytes: null, logoSha256: null } : {});
  await withOrg(ctx, async (tx) => {
    await tx.orgBrand.upsert({ where: { orgId: ctx.orgId }, create: { orgId: ctx.orgId, accentHex, ...logoData }, update: { accentHex, ...logoData } });
    await audit(ctx, 'brand.updated', { targetType: 'org', targetId: ctx.orgId, data: { accentHex, logo: logo ? logo.logoSha256 : input.removeLogo ? 'removed' : 'unchanged' } }, tx);
  });
}
