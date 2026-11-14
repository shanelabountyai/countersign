import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { matchSignedVersion, normalizeSha256, sha256Hex, verifySha256 } from '@/lib/proposal/hash';

// CS-02: a signed version's PDF hash never changes, and any byte change fails verify.

const bytes = (s: string) => new TextEncoder().encode(s);

describe('sha256Hex: known vectors (FIPS 180-2)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('%j', (input, hex) => {
    expect(sha256Hex(bytes(input))).toBe(hex);
    expect(verifySha256(bytes(input), hex)).toBe(true);
  });

  it('hashes bytes, not text: a Buffer and a Uint8Array of the same bytes agree', () => {
    const b = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);
    expect(sha256Hex(b)).toBe(sha256Hex(new Uint8Array(b)));
  });

  it('refuses a string', () => {
    expect(() => sha256Hex('abc' as unknown as Uint8Array)).toThrow(TypeError);
  });
});

describe('verifySha256 / normalizeSha256', () => {
  const doc = bytes('%PDF-1.7 countersign');
  const hex = sha256Hex(doc);
  it.each([
    ['upper-case hash', hex.toUpperCase(), true],
    ['surrounding whitespace', ` ${hex}\n`, true],
    ['truncated hash', hex.slice(0, 63), false],
    ['non-hex', `${hex.slice(0, 63)}g`, false],
    ['empty', '', false],
    ['another document', sha256Hex(bytes('%PDF-1.7 countersign ')), false],
  ])('%s → %s', (_n, h, ok) => expect(verifySha256(doc, h)).toBe(ok));

  it('normalizes or rejects', () => {
    expect(normalizeSha256(hex.toUpperCase())).toBe(hex);
    expect(normalizeSha256('xyz')).toBeNull();
    expect(normalizeSha256(undefined as unknown as string)).toBeNull();
  });
});

describe('matchSignedVersion', () => {
  const v1 = bytes('version 1');
  const v2 = bytes('version 2');
  const candidates = [
    { versionId: 'v1', pdfSha256: sha256Hex(v1) },
    { versionId: 'bad', pdfSha256: 'not-a-hash' },
    { versionId: 'v2', pdfSha256: sha256Hex(v2).toUpperCase() },
  ];
  it('finds the version these bytes are', () => {
    expect(matchSignedVersion(v2, candidates)?.versionId).toBe('v2');
    expect(matchSignedVersion(v1, candidates)?.versionId).toBe('v1');
  });
  it('returns null for anything else', () => {
    expect(matchSignedVersion(bytes('version 3'), candidates)).toBeNull();
    expect(matchSignedVersion(v1, [])).toBeNull();
  });
});

// ---------- properties ----------

const docArb = fc.uint8Array({ minLength: 0, maxLength: 4096 });
const nonEmptyDocArb = fc.uint8Array({ minLength: 1, maxLength: 4096 });

describe('CS-02 properties', () => {
  it('the hash is stable: same bytes, same hash, every time, and it verifies', () => {
    fc.assert(
      fc.property(docArb, (d) => {
        const h = sha256Hex(d);
        expect(sha256Hex(Uint8Array.from(d))).toBe(h);
        expect(h).toMatch(/^[0-9a-f]{64}$/);
        expect(verifySha256(d, h)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('changing any single byte fails verify', () => {
    fc.assert(
      fc.property(nonEmptyDocArb.chain((d) => fc.tuple(fc.constant(d), fc.nat({ max: d.length - 1 }), fc.integer({ min: 1, max: 255 }))), ([d, i, delta]) => {
        const h = sha256Hex(d);
        const m = Uint8Array.from(d);
        m[i] = (m[i]! + delta) % 256;
        expect(verifySha256(m, h)).toBe(false);
        expect(verifySha256(d, h)).toBe(true); // the original is untouched
      }),
      { numRuns: 500 },
    );
  });

  it('flipping any single bit fails verify', () => {
    fc.assert(
      fc.property(nonEmptyDocArb.chain((d) => fc.tuple(fc.constant(d), fc.nat({ max: d.length * 8 - 1 }))), ([d, bit]) => {
        const m = Uint8Array.from(d);
        m[bit >> 3] = m[bit >> 3]! ^ (1 << (bit & 7));
        expect(verifySha256(m, sha256Hex(d))).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('appending, prepending or truncating bytes fails verify', () => {
    fc.assert(
      fc.property(nonEmptyDocArb, fc.uint8Array({ minLength: 1, maxLength: 64 }), (d, extra) => {
        const h = sha256Hex(d);
        expect(verifySha256(Uint8Array.from([...d, ...extra]), h)).toBe(false);
        expect(verifySha256(Uint8Array.from([...extra, ...d]), h)).toBe(false);
        expect(verifySha256(d.subarray(0, d.length - 1), h)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('distinct documents never match each other\'s recorded hash', () => {
    fc.assert(
      fc.property(docArb, docArb, (a, b) => {
        fc.pre(Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0);
        expect(matchSignedVersion(b, [{ versionId: 'a', pdfSha256: sha256Hex(a) }])).toBeNull();
      }),
      { numRuns: 300 },
    );
  });
});
