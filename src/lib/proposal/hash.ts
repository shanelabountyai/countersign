// Countersign document hashing (CS-02): SHA-256 over the exact PDF bytes. No decoding, no normalization: one changed
// byte is a different document.
import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizeSha256 } from './sha256-hex';

export { normalizeSha256 };

export function sha256Hex(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('sha256Hex hashes bytes (Uint8Array/Buffer), not strings');
  return createHash('sha256').update(bytes).digest('hex');
}

/** True only if `bytes` hash to `expectedHex`. Malformed expected hashes never verify. Constant-time compare. */
export function verifySha256(bytes: Uint8Array, expectedHex: string): boolean {
  const expected = normalizeSha256(expectedHex);
  if (!expected) return false;
  return timingSafeEqual(Buffer.from(sha256Hex(bytes), 'hex'), Buffer.from(expected, 'hex'));
}

export type SignedCandidate = { versionId: string; pdfSha256: string };

/** The signed version whose recorded hash matches these bytes, or null (Phase 4 verify page). */
export function matchSignedVersion<T extends SignedCandidate>(bytes: Uint8Array, candidates: readonly T[]): T | null {
  const actual = Buffer.from(sha256Hex(bytes), 'hex');
  for (const c of candidates) {
    const expected = normalizeSha256(c.pdfSha256);
    if (expected && timingSafeEqual(actual, Buffer.from(expected, 'hex'))) return c;
  }
  return null;
}
