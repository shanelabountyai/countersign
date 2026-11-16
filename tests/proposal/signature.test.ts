import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkSignature, cleanUserAgent, consentText, ipHash, ipHashKey, SignatureError, strokes } from '@/lib/proposal/signature';

describe('checkSignature (D-37)', () => {
  it('trims and collapses spaces in a typed signature', () =>
    expect(checkSignature({ signerName: '  Jane   Buyer ', method: 'typed', data: ' Jane  Buyer ' })).toEqual({ signerName: 'Jane Buyer', method: 'typed', data: 'Jane Buyer' }));

  it('accepts a drawn path inside the pad', () =>
    expect(checkSignature({ signerName: 'Jane', method: 'drawn', data: 'M0 0 L600 200 L5 199 M10 10' }).data).toBe('M0 0 L600 200 L5 199 M10 10'));

  it.each<[string, Parameters<typeof checkSignature>[0]]>([
    ['no name', { signerName: '  ', method: 'typed', data: 'x' }],
    ['a long name', { signerName: 'x'.repeat(121), method: 'typed', data: 'x' }],
    ['a control character', { signerName: 'Jane\u0000', method: 'typed', data: 'x' }],
    ['an empty typed signature', { signerName: 'Jane', method: 'typed', data: ' ' }],
    ['an empty drawing', { signerName: 'Jane', method: 'drawn', data: '' }],
    ['a point outside the pad (x)', { signerName: 'Jane', method: 'drawn', data: 'M601 0' }],
    ['a point outside the pad (y)', { signerName: 'Jane', method: 'drawn', data: 'M0 201' }],
    ['decimals', { signerName: 'Jane', method: 'drawn', data: 'M1.5 2' }],
    ['other SVG commands', { signerName: 'Jane', method: 'drawn', data: 'M0 0 C1 1 2 2 3 3' }],
    ['markup', { signerName: 'Jane', method: 'drawn', data: '<script>' }],
    ['a huge path', { signerName: 'Jane', method: 'drawn', data: `M0 0${' L1 1'.repeat(5000)}` }],
    ['an unknown method', { signerName: 'Jane', method: 'stamp' as 'typed', data: 'x' }],
  ])('refuses %s', (_, input) => expect(() => checkSignature(input)).toThrow(SignatureError));

  it('property: every path made of in-range integer points is accepted and read back point for point', () => {
    const pt = fc.record({ x: fc.integer({ min: 0, max: 600 }), y: fc.integer({ min: 0, max: 200 }) });
    fc.assert(
      fc.property(fc.array(fc.array(pt, { minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 }), (ss) => {
        const path = ss.map((st) => st.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')).join(' ');
        expect(checkSignature({ signerName: 'J', method: 'drawn', data: path }).data).toBe(path);
        expect(strokes(path)).toEqual(ss);
      }),
    );
  });
});

describe('consent and client metadata (D-34)', () => {
  it('names the version and the document hash', () => {
    const t = consentText({ title: 'Website refresh', version: 3, pdfSha256: 'ab'.repeat(32) });
    expect(t).toContain('version 3');
    expect(t).toContain('ab'.repeat(32));
    expect(t).toContain('electronic');
  });

  it('hashes an IP with a key: stable, not the plain sha256, and different under another secret', () => {
    const k = ipHashKey('x'.repeat(40));
    expect(ipHash('203.0.113.7', k)).toBe(ipHash('203.0.113.7', k));
    expect(ipHash('203.0.113.7', k)).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash('203.0.113.7', k)).not.toBe(ipHash('203.0.113.8', k));
    expect(ipHash('203.0.113.7', k)).not.toBe(ipHash('203.0.113.7', ipHashKey('y'.repeat(40))));
    expect(ipHash('203.0.113.7', k)).not.toContain('203');
  });

  it('cleans and caps a user agent', () => {
    expect(cleanUserAgent(null)).toBe('');
    expect(cleanUserAgent('a\nb\u0000c')).toBe('a b c');
    expect(cleanUserAgent('x'.repeat(600))).toHaveLength(512);
  });
});
