import { describe, expect, it } from 'vitest';
import { sha256Hex, verifySha256 } from '@/lib/proposal/hash';
import { renderCertificatePdf, renderProposalPdf, type CertificatePdfModel, type ProposalPdfModel } from '@/lib/proposal/pdf';
import { describeChars, unsupportedChars } from '@/lib/proposal/pdf-text';
import { pdfFlatText } from '../helpers/pdf-text';

// CS-02 groundwork (D-31): the renderer is deterministic, and every content change is a different document.

const AT = new Date('2026-11-15T12:00:00Z');
const model = (over: Partial<ProposalPdfModel> = {}): ProposalPdfModel => ({
  orgName: 'Lab Intelligence',
  title: 'Website refresh',
  clientName: 'Acme Co',
  clientEmail: 'buyer@acme.test',
  version: 2,
  sections: [
    { kind: 'section', title: 'Scope', body: 'Redesign of five pages for Acme Co — “fast”, €-priced.' },
    { kind: 'terms', title: 'Payment', body: 'Net 30.' },
  ],
  lines: [
    { id: 'a', kind: 'fixed', description: 'Design', unitPriceCents: 250000, quantityMilli: 1000, taxRateBps: 825, discount: null, optional: false, selected: false },
    { id: 'b', kind: 'hourly', description: 'Support', unitPriceCents: 15000, quantityMilli: 1500, taxRateBps: 0, discount: { type: 'percent', bps: 1000 }, optional: true, selected: true },
    { id: 'c', kind: 'per_unit', description: 'Extra page', unitPriceCents: 40000, quantityMilli: 2000, taxRateBps: 825, discount: null, optional: true, selected: false },
  ],
  discount: null,
  ...over,
});

describe('proposal PDF', () => {
  it('renders the same bytes for the same version and time', async () => {
    const [a, b] = [await renderProposalPdf(model(), AT), await renderProposalPdf(model(), AT)];
    expect(a.length).toBeGreaterThan(1000);
    expect(Buffer.from(a).subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it.each<[string, Partial<ProposalPdfModel>]>([
    ['title', { title: 'Website refresh!' }],
    ['client', { clientName: 'Acme Corp' }],
    ['version', { version: 3 }],
    ['a section body', { sections: [{ kind: 'section', title: 'Scope', body: 'Redesign of six pages.' }] }],
    ['a price', { lines: model().lines.map((l) => (l.id === 'a' ? { ...l, unitPriceCents: 250001 } : l)) }],
    ['an add-on default', { lines: model().lines.map((l) => (l.id === 'c' ? { ...l, selected: true } : l)) }],
    ['the proposal discount', { discount: { type: 'fixed', cents: 100 } }],
  ])('a different %s is a different document', async (_, over) => {
    const base = await renderProposalPdf(model(), AT);
    const changed = await renderProposalPdf(model(over), AT);
    expect(sha256Hex(changed)).not.toBe(sha256Hex(base));
    expect(verifySha256(changed, sha256Hex(base))).toBe(false);
  });

  it('shows the content, priced with D-18 tax groups', async () => {
    const text = pdfFlatText(await renderProposalPdf(model(), AT));
    for (const s of ['Website refresh', 'Acme Co', 'version 2', '“fast”, €-priced', 'Terms: Payment', 'Optional add-ons', 'Extra page', '(included)', 'Tax 8.25 % on $2,500.00', '$206.25', '$2,908.75']) {
      expect(text).toContain(s);
    }
  });
});

describe('certificate PDF', () => {
  const cert = (over: Partial<CertificatePdfModel> = {}): CertificatePdfModel => ({
    orgName: 'Lab Intelligence',
    title: 'Website refresh',
    clientName: 'Acme Co',
    version: 2,
    proposalId: '11111111-1111-4111-8111-111111111111',
    versionId: '22222222-2222-4222-8222-222222222222',
    pdfSha256: 'ab'.repeat(32),
    pdfBytes: 4321,
    signedAt: '2026-11-15T12:00:00.000Z',
    signer: { name: 'Jane Buyer', method: 'typed', data: 'Jane Buyer' },
    consent: 'I agree to do business electronically.',
    addOns: [{ description: 'Support', chosen: true }, { description: 'Extra page', chosen: false }],
    pricing: { subtotalCents: 270250, proposalDiscountCents: 0, taxes: [{ taxRateBps: 825, taxableCents: 250000, taxCents: 20625 }], taxCents: 20625, totalCents: 290875 },
    trail: [
      { at: '2026-11-15T11:00:00.000Z', action: 'proposal.version.sent', from: 'draft', to: 'sent', pdfSha256: 'ab'.repeat(32) },
      { at: '2026-11-15T11:30:00.000Z', action: 'proposal.version.viewed', from: 'sent', to: 'viewed', pdfSha256: 'ab'.repeat(32), ipHash: 'cd'.repeat(32), userAgent: 'Mozilla/5.0 test' },
    ],
    ...over,
  });

  it('is deterministic and lists the document hash, signer, consent, choice, total and trail', async () => {
    const a = await renderCertificatePdf(cert(), AT);
    expect(sha256Hex(a)).toBe(sha256Hex(await renderCertificatePdf(cert(), AT)));
    const text = pdfFlatText(a);
    for (const s of ['Completion certificate', 'ab'.repeat(32), 'Jane Buyer', 'I agree to do business electronically.', 'Chosen: Support', 'Not chosen: Extra page', '$2,908.75', 'version.viewed', `ip hash ${'cd'.repeat(32)}`, 'Mozilla/5.0 test']) {
      expect(text).toContain(s);
    }
  });

  it('draws a drawn signature', async () => {
    const drawn = await renderCertificatePdf(cert({ signer: { name: 'Jane Buyer', method: 'drawn', data: 'M10 10 L200 150 L300 20 M400 100 L500 120' } }), AT);
    expect(sha256Hex(drawn)).not.toBe(sha256Hex(await renderCertificatePdf(cert(), AT)));
  });
});

describe('unsupportedChars (D-31)', () => {
  it.each([
    ['plain ASCII', 'Hello, world! 123 {}', []],
    ['Latin-1 and WinAnsi extras', 'Café naïve € “quote” – — … ™ Œ ž', []],
    ['newlines and tabs', 'a\nb\tc', []],
    ['CJK and emoji', 'Price 中文 😀 中', ['中', '文', '😀']],
    ['Polish letters outside WinAnsi', 'Łódź', ['Ł', 'ź']],
  ])('%s', (_, text, bad) => expect(unsupportedChars(text)).toEqual(bad));

  it('describes characters by code point', () => expect(describeChars(['中', '😀'])).toBe('U+4E2D 中, U+1F600 😀'));
});
