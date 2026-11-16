// Countersign verify page (Phase 4, PRD "upload a PDF → says whether it matches a signed version's hash"). Public and
// read-only. The upload's SHA-256 over the exact bytes (CS-02) is looked up among stored documents; a hit is reported as
// verified only after the record re-derives from stored data (D-40): the stored bytes, the recorded hashes and the audit
// trail agree, the version is signed (D-17), the proposal PDF and the certificate re-render to the identical bytes, and
// the agreed price re-computes. Any changed byte in the upload means no stored document has its hash: "not verified".
import { withOrg, type Tx } from '@/core/db/rls';
import { hit, LIMITS } from '@/core/rate-limit';
import { certificateModel, priceVersionSelection, trailOf } from './certificate';
import { matchSignedVersion, sha256Hex } from './hash';
import { renderCertificatePdf, renderProposalPdf } from './pdf';
import type { PricingResult } from './pricing';
import { proposalPdfModel, versionsOf, type VersionRow } from './store';
import { documentsByHash, type DocumentHit } from './verify-lookup';
import type { VersionStatus } from './versioning';

/** Largest upload the page reads. A proposal PDF is a few KB (D-31); 5 MB leaves room without inviting abuse. */
export const VERIFY_MAX_BYTES = 5 * 1024 * 1024;

export type CheckId = 'stored-bytes' | 'signed' | 'hashes-agree' | 'audit-trail' | 'proposal-rerender' | 'pricing' | 'certificate-bytes' | 'certificate-rerender';

export const CHECK_LABELS: Record<CheckId, string> = {
  'stored-bytes': 'The stored copy hashes to its recorded SHA-256 and equals your file byte for byte',
  signed: 'The version was signed (a sent, replaced, declined or expired version never verifies)',
  'hashes-agree': "The version's recorded hash, the signature's hash and the stored proposal PDF agree",
  'audit-trail': 'The audit trail records the send, a view and the signature, each with this document hash',
  'proposal-rerender': "The proposal PDF re-renders from the version's frozen content to the identical bytes",
  pricing: 'The price the signer agreed to re-computes from the frozen line items and chosen add-ons',
  'certificate-bytes': 'The stored completion certificate hashes to its recorded SHA-256',
  'certificate-rerender': 'The completion certificate re-renders from the stored signature and audit trail to the identical bytes',
};

export type Check = { id: CheckId; ok: boolean };

export type VerifiedRecord = {
  orgName: string;
  title: string;
  clientName: string;
  version: number;
  signerName: string | null;
  signedAt: Date | null;
  totalCents: number | null;
  pdfSha256: string | null;
  certificateSha256: string | null;
};

export type VerifyResult =
  | { verdict: 'no_match'; sha256: string; byteLength: number }
  | { verdict: 'not_signed'; sha256: string; byteLength: number; kind: DocumentHit['kind']; status: VersionStatus }
  | { verdict: 'verified' | 'inconsistent'; sha256: string; byteLength: number; kind: DocumentHit['kind']; checks: Check[]; record: VerifiedRecord };

/** A refused upload: an HTTP status and a message for the page. */
export class VerifyRefusal extends Error {
  override name = 'VerifyRefusal';
  constructor(
    readonly status: 400 | 413 | 429,
    message: string,
  ) {
    super(message);
  }
}

export async function checkVerifyLimit(ip: string) {
  if (!(await hit(`verify:ip:${ip}`, LIMITS.shareReadPerIp))) throw new VerifyRefusal(429, 'Too many checks. Wait a few minutes and try again.');
}

/**
 * Verifies an uploaded file. Writes nothing but the per-IP rate-limit counter (`limited`: the caller already counted this
 * request, as the route does before reading the body).
 */
export async function verifyPdf(bytes: Uint8Array, meta: { ip: string; limited?: boolean }): Promise<VerifyResult> {
  if (!meta.limited) await checkVerifyLimit(meta.ip);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new VerifyRefusal(400, 'Choose a PDF file to check.');
  if (bytes.length > VERIFY_MAX_BYTES) throw new VerifyRefusal(413, `That file is larger than ${VERIFY_MAX_BYTES / 1024 / 1024} MB, so it is not a Countersign document.`);
  const sha256 = sha256Hex(bytes);
  const base = { sha256, byteLength: bytes.length };
  const hits = await documentsByHash(sha256);
  let best: VerifyResult = { verdict: 'no_match', ...base };
  for (const d of hits) {
    const r = await examine(d, bytes, base);
    if (r.verdict === 'verified') return r;
    if (best.verdict === 'no_match' || (best.verdict === 'not_signed' && r.verdict === 'inconsistent')) best = r;
  }
  return best;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
const safely = async (fn: () => Promise<boolean> | boolean) => {
  try {
    return await fn();
  } catch {
    return false; // a record that no longer prices or renders does not re-derive
  }
};

async function examine(d: DocumentHit, upload: Uint8Array, base: { sha256: string; byteLength: number }): Promise<VerifyResult> {
  return withOrg({ orgId: d.orgId }, async (tx) => {
    const row = await tx.proposalVersion.findFirst({ where: { id: d.versionId, orgId: d.orgId }, select: { proposalId: true } });
    const v = row && (await versionsOf(tx, { orgId: d.orgId, userId: null }, row.proposalId)).find((x) => x.id === d.versionId);
    if (!v) return { verdict: 'no_match', ...base } as const;
    if (v.status !== 'signed') return { verdict: 'not_signed', ...base, kind: d.kind, status: v.status } as const;
    return { ...(await rederive(tx, d, v, upload)), ...base, kind: d.kind };
  }, { atomic: false });
}

async function rederive(tx: Tx, d: DocumentHit, v: VersionRow, upload: Uint8Array): Promise<{ verdict: 'verified' | 'inconsistent'; checks: Check[]; record: VerifiedRecord }> {
  const [docs, sig, org, events] = await Promise.all([
    tx.proposalDocument.findMany({ where: { versionId: v.id, orgId: d.orgId }, select: { id: true, kind: true, sha256: true, byteLength: true, bytes: true } }),
    tx.proposalSignature.findUnique({ where: { versionId: v.id } }),
    tx.org.findUnique({ where: { id: d.orgId }, select: { name: true } }),
    tx.auditEvent.findMany({ where: { orgId: d.orgId, targetType: 'proposalVersion', targetId: v.id }, orderBy: { id: 'asc' }, select: { id: true, action: true, at: true, data: true } }),
  ]);
  const uploaded = docs.find((x) => x.id === d.id);
  const pdf = docs.find((x) => x.kind === 'proposal');
  const cert = docs.find((x) => x.kind === 'certificate');
  const orgName = org?.name ?? '';
  const dataOf = (e: (typeof events)[number]) => (e.data ?? {}) as Record<string, unknown>;
  const sentEvent = events.find((e) => e.action === 'proposal.version.sent');
  const signedAt = events.findIndex((e) => e.action === 'proposal.version.signed');
  const signedEvent = signedAt >= 0 ? events[signedAt] : undefined;

  const checks: Check[] = [];
  const add = async (id: CheckId, fn: () => Promise<boolean> | boolean) => checks.push({ id, ok: await safely(fn) });

  await add('stored-bytes', () => !!uploaded && sha256Hex(uploaded.bytes) === uploaded.sha256 && same(uploaded.bytes, upload));
  await add('signed', () => !!pdf && matchSignedVersion(pdf.bytes, [{ versionId: v.id, status: v.status, pdfSha256: v.pdfSha256 }]) !== null);
  await add('hashes-agree', () => !!pdf && !!sig && pdf.sha256 === v.pdfSha256 && sig.pdfSha256 === v.pdfSha256 && sha256Hex(pdf.bytes) === v.pdfSha256);
  await add('audit-trail', () => {
    if (!sentEvent || !signedEvent) return false;
    const viewed = events.slice(0, signedAt).some((e) => e.action === 'proposal.version.viewed' && dataOf(e).pdfSha256 === v.pdfSha256);
    return viewed && dataOf(sentEvent).pdfSha256 === v.pdfSha256 && dataOf(signedEvent).pdfSha256 === v.pdfSha256 && dataOf(signedEvent).to === 'signed';
  });
  await add('proposal-rerender', async () => {
    const at = typeof dataOf(sentEvent!).at === 'string' ? new Date(dataOf(sentEvent!).at as string) : null;
    if (!pdf || !at || Number.isNaN(at.getTime())) return false;
    return same(await renderProposalPdf(proposalPdfModel(v, orgName), at), pdf.bytes);
  });
  let pricing: PricingResult | null = null;
  try {
    pricing = sig && priceVersionSelection(v, sig.selectedLineIds);
  } catch {
    pricing = null; // a stored selection that is no longer a set of this version's add-ons
  }
  await add('pricing', () =>
    !!sig && !!pricing &&
    BigInt(pricing.subtotalCents) === sig.subtotalCents && BigInt(pricing.proposalDiscountCents) === sig.discountCents &&
    BigInt(pricing.taxCents) === sig.taxCents && BigInt(pricing.totalCents) === sig.totalCents,
  );
  await add('certificate-bytes', () => !!cert && sha256Hex(cert.bytes) === cert.sha256);
  await add('certificate-rerender', async () => {
    if (!cert || !sig || !pdf || !pricing || !signedEvent) return false;
    const model = certificateModel({
      orgName, version: v, pdfSha256: sig.pdfSha256, pdfBytes: pdf.byteLength, signedAt: sig.signedAt,
      signer: { name: sig.signerName, method: sig.method, data: sig.signatureData }, consent: sig.consentText,
      chosen: new Set(sig.selectedLineIds), pricing, trail: trailOf(events.slice(0, signedAt + 1)),
    });
    return same(await renderCertificatePdf(model, sig.signedAt), cert.bytes);
  });

  return {
    verdict: checks.every((c) => c.ok) ? 'verified' : 'inconsistent',
    checks,
    record: {
      orgName, title: v.title, clientName: v.clientName, version: v.number,
      signerName: sig?.signerName ?? null, signedAt: sig?.signedAt ?? null, totalCents: sig ? Number(sig.totalCents) : null,
      pdfSha256: v.pdfSha256, certificateSha256: cert?.sha256 ?? null,
    },
  };
}
