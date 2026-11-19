import { describe, expect, it } from 'vitest';
import { accentProblem, accentStyle, contrast, LOGO_MAX_BYTES, normalizeHex, sniffLogo } from '@/lib/ui/brand';

// D-66: what a brand may be. The accent must stay readable as white-on-accent and as link text (DUX-12); the logo must be
// a real PNG or JPEG by its bytes.
describe('brand accent', () => {
  it('normalizes hex input and refuses anything else', () => {
    expect(normalizeHex('0F5E63')).toBe('#0f5e63');
    expect(normalizeHex(' #0F5E63 ')).toBe('#0f5e63');
    for (const bad of ['#0f5e6', 'teal', '#0f5e63ff', 'url(x)', '']) expect(normalizeHex(bad)).toBeNull();
  });
  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
  it('accepts the default teal and dark colours, refuses light ones with the measured ratio', () => {
    expect(accentProblem('#0f5e63')).toBeNull();
    expect(accentProblem('#1d4f91')).toBeNull();
    expect(accentProblem('#7fd1cf')).toMatch(/too light: it has \d\.\d\d:1 contrast with white text/);
    expect(accentProblem('#767676')).toMatch(/page background/); // 4.54:1 on white, under 4.5:1 on #EFEFEA
  });
  it('writes only custom properties built from a checked hex', () => {
    expect(accentStyle('#0f5e63')).toMatch(/^--cs-accent:#0f5e63;--cs-accent-hover:#[0-9a-f]{6};--cs-accent-wash:#[0-9a-f]{6};--cs-teal-wash:#[0-9a-f]{6}$/);
  });
});

describe('brand logo', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  it('sniffs PNG and JPEG from the bytes', () => {
    expect(sniffLogo(png)).toBe('image/png');
    expect(sniffLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });
  it('refuses SVG, GIF and text whatever the name says', () => {
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', 'GIF89a', '%PDF-1.4']) expect(sniffLogo(new TextEncoder().encode(s))).toBeNull();
  });
  it('caps the size at 100 KB', () => expect(LOGO_MAX_BYTES).toBe(102_400));
});
