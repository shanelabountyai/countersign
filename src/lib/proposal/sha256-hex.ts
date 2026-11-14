// The one place a SHA-256 hex string is normalized (D-15). Pure: no node:crypto, so versioning.ts can use it too.
// Re-exported from hash.ts.

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Canonical form of a SHA-256 hex string (surrounding whitespace trimmed, lower-cased), or null if it is not 64 hex characters. */
export function normalizeSha256(hex: string): string | null {
  const h = typeof hex === 'string' ? hex.trim().toLowerCase() : '';
  return SHA256_HEX.test(h) ? h : null;
}
