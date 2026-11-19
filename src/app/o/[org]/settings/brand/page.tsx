import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { getBrand } from '@/lib/proposal/brand-store';
import { LOGO_MAX_BYTES, logoSrc } from '@/lib/ui/brand';
import { saveBrandAction } from './actions';
import { LogoField } from './logo-field';

export const metadata = { title: 'Brand' };

// Settings → Brand (D-66): the accent colour and logo client pages use. Owner and admin only.
export default async function BrandSettings({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'org.update');
  const brand = await getBrand(ctx);
  return (
    <main className="cs-app cs-app--stack" style={{ maxWidth: 760 }}>
      <div className="cs-pagehead"><h1>Brand</h1></div>
      <p className="cs-lede">Your colour and logo on the pages clients see: the signing link, the proposal, the signed certificate and link notices. The PDFs and the verify page are not affected.</p>
      <section aria-labelledby="cs-brand" className="cs-card">
        <h2 id="cs-brand">Colour and logo</h2>
        <ActionForm action={saveBrandAction.bind(null, ctx.slug)}>
          <div className="cs-rows" style={{ gap: 16 }}>
            <label className="cs-label" style={{ maxWidth: 280 }}>
              Accent colour (hex)
              <input name="accent" defaultValue={brand.accentHex ?? ''} placeholder="#0F5E63" maxLength={20} className="cs-input" aria-describedby="cs-accent-note" />
            </label>
            <span id="cs-accent-note" className="cs-hint">Buttons and links. It must reach 4.5:1 contrast with white and with the page background, so very light colours are refused. Leave blank for the default teal.</span>
            <LogoField current={logoSrc(brand)} maxKb={LOGO_MAX_BYTES / 1024} />
            {brand.logo && <label className="cs-check"><input type="checkbox" name="removeLogo" value="yes" /><span>Remove the current logo</span></label>}
            <div><button type="submit" className="cs-btn cs-btn--primary">Save brand</button></div>
          </div>
        </ActionForm>
      </section>
    </main>
  );
}
