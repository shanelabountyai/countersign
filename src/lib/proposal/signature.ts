// Countersign signature, consent and client metadata (D-34, D-37). Pure: no database, no env; the HMAC key is passed in.
import { createHmac, hkdfSync } from 'node:crypto';

export class SignatureError extends Error {
  override name = 'SignatureError';
}

/** The e-records consent, version 1. Stored verbatim with each signature and printed on the certificate (D-37). */
export const CONSENT_VERSION = 'v1';
export function consentText(p: { title: string; version: number; pdfSha256: string }): string {
  return (
    `I agree to do business electronically: I consent to receive this proposal as an electronic record and to sign it ` +
    `electronically, and I intend the signature I typed or drew to be my signature on "${p.title}", version ${p.version}, ` +
    `the PDF document with SHA-256 ${p.pdfSha256}. I can download that document and the completion certificate.`
  );
}

export type SignatureMethod = 'typed' | 'drawn';
export type SignatureInput = { signerName: string; method: SignatureMethod; data: string };

export const SIGNATURE_LIMITS = { name: 120, path: 20_000, width: 600, height: 200 } as const;

// Drawn: one or more strokes "M x y L x y …" with integer coordinates inside the 600×200 pad, single spaces only.
const POINT = '(?:600|[1-5]?\\d{1,2}) (?:200|1?\\d{1,2})';
const STROKE = `M${POINT}(?: L${POINT})*`;
const PATH = new RegExp(`^${STROKE}(?: ${STROKE})*$`);

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Trims and checks a signature; throws SignatureError with a message the signing page can show. */
export function checkSignature(input: SignatureInput): SignatureInput {
  const signerName = input.signerName.trim().replace(/\s+/g, ' ');
  if (!signerName) throw new SignatureError('Enter your full name.');
  if (signerName.length > SIGNATURE_LIMITS.name || CONTROL.test(signerName)) throw new SignatureError(`Your name must be at most ${SIGNATURE_LIMITS.name} characters.`);
  if (input.method === 'typed') {
    const data = input.data.trim().replace(/\s+/g, ' ');
    if (!data) throw new SignatureError('Type your signature.');
    if (data.length > SIGNATURE_LIMITS.name || CONTROL.test(data)) throw new SignatureError(`A typed signature is at most ${SIGNATURE_LIMITS.name} characters.`);
    return { signerName, method: 'typed', data };
  }
  if (input.method === 'drawn') {
    const data = input.data.trim();
    if (!data) throw new SignatureError('Draw your signature in the box.');
    if (data.length > SIGNATURE_LIMITS.path || !PATH.test(data)) throw new SignatureError('The drawn signature could not be read. Clear it and draw it again.');
    return { signerName, method: 'drawn', data };
  }
  throw new SignatureError('Choose to type or draw your signature.');
}

/** The strokes of a drawn signature as point lists (for the certificate). Assumes checkSignature passed. */
export function strokes(path: string): { x: number; y: number }[][] {
  return path.split(/ (?=M)/).map((s) =>
    s.slice(1).split(' L').map((p) => {
      const [x = 0, y = 0] = p.split(' ').map(Number);
      return { x, y };
    }),
  );
}

/** Per-purpose HMAC key from the app secret (HKDF), so the IP hash key is not the secret itself. */
export const ipHashKey = (secret: string) => Buffer.from(hkdfSync('sha256', secret, '', 'countersign/ip-hash/v1', 32));

/**
 * D-34: the client's IP as HMAC-SHA256 hex. Equal IPs give equal hashes (the trail can show "same address as the view"),
 * but without the secret the IPv4 space cannot be enumerated back from a dump.
 */
export function ipHash(ip: string, key: Buffer): string {
  return createHmac('sha256', key).update(ip).digest('hex');
}

export const USER_AGENT_MAX = 512;
export const cleanUserAgent = (ua: string | null | undefined) => (ua ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, USER_AGENT_MAX);
