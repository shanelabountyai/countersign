// Countersign signing flow (Phase 3): what a client can do with a signing link. Anonymous: the token is the credential
// (D-29). Every read and write after the token lookup runs in the link's own org. Each client event goes through the
// pure state machine with the version and PDF hash the page showed (D-16), and is audited with the hashed IP, user agent
// and document hash (CS-04, D-34). The signature and the completion certificate are written in the same transaction as
// the `signed` status (D-38).
import { now } from '@/core/clock';
import { withOrg, type Tx } from '@/core/db/rls';
import { env } from '@/core/env';
import { Refused } from '@/core/errors';
import { hit, LIMITS } from '@/core/rate-limit';
import { normalizeSha256, sha256Hex } from './hash';
import { certificateModel, priceVersionSelection, trailOf } from './certificate';
import { renderCertificatePdf } from './pdf';
import { PDF_RENDERER_VERSION } from './renderer';
import { SelectionError } from './selection';
import { CONSENT_VERSION, checkSignature, cleanUserAgent, consentText, ipHash, ipHashKey, SignatureError, type SignatureMethod } from './signature';
import { findLink, lapsedVersions, type LinkRow } from './signing-link';
import { applyEvent, presentVersion, toPure, versionsOf, type Actor, type AuditExtra, type VersionRow } from './store';
import { linkAccess, TransitionError } from './versioning';

export type ClientMeta = { ip: string; userAgent: string | null };

export type RefusalCode = 'gone' | 'not_found' | 'limited' | 'stale' | 'consent' | 'signature' | 'selection' | 'reason';

/** A refused client request: an HTTP status for the route handler and a code the page turns into a message. */
export class ClientRefusal extends Error {
  override name = 'ClientRefusal';
  constructor(
    readonly status: 400 | 404 | 409 | 410 | 429,
    readonly code: RefusalCode,
    message: string = code,
    /** For a 410: why the link is gone, so the page can say so. */
    readonly reason?: GoneReason,
  ) {
    super(message);
  }
}

export type GoneReason = 'superseded' | 'declined' | 'expired' | 'revoked' | 'closed';

type Loaded = { link: LinkRow; versions: VersionRow[]; version: VersionRow; orgName: string };

async function load(tx: Tx, link: LinkRow): Promise<Loaded | null> {
  const actor = { orgId: link.orgId, userId: null };
  const versions = await versionsOf(tx, actor, link.proposalId);
  const version = versions.find((v) => v.id === link.versionId);
  const org = await tx.org.findUnique({ where: { id: link.orgId }, select: { name: true } });
  return version && org ? { link, versions, version, orgName: org.name } : null;
}

/** 200 / 410 / 404 for a link, from the pure linkAccess (CS-03) plus the link's own expiry and revocation (D-36). */
export function accessOf(l: Loaded, at: Date): { code: 200; state: 'active' | 'completed' } | { code: 410; reason: GoneReason } | { code: 404 } {
  const a = linkAccess(toPure(l.versions), l.link.versionNumber);
  if (a.code === 404) return { code: 404 };
  if (a.code === 410) return { code: 410, reason: a.state === 'superseded' ? 'superseded' : a.version.status === 'declined' ? 'declined' : a.version.status === 'expired' ? 'expired' : 'closed' };
  if (a.state === 'completed') return { code: 200, state: 'completed' }; // a signed document stays readable from its link
  if (l.link.revokedAt) return { code: 410, reason: 'revoked' };
  if (l.link.expiresAt.getTime() <= at.getTime()) return { code: 410, reason: 'expired' };
  return { code: 200, state: 'active' };
}

export type LinkView =
  | { code: 404 }
  | { code: 410; reason: GoneReason; title: string; orgName: string }
  | {
      code: 200;
      state: 'active' | 'completed';
      orgName: string;
      expiresAt: Date;
      version: ReturnType<typeof presentVersion>;
      pdf: { sha256: string; byteLength: number };
      signature: { signerName: string; signedAt: Date; totalCents: number; selectedLineIds: string[] } | null;
      certificate: { sha256: string; byteLength: number } | null;
    };

async function limit(meta: ClientMeta) {
  if (!(await hit(`sign:ip:${meta.ip}`, LIMITS.shareReadPerIp))) throw new ClientRefusal(429, 'limited', 'Too many requests. Wait a few minutes and try again.');
}

/** What GET /sign/<token> and the review page show. Never writes (D-33: a view is recorded only by the POST). */
export async function openLink(token: string, meta: ClientMeta): Promise<LinkView> {
  await limit(meta);
  return view(token);
}

async function view(token: string): Promise<LinkView> {
  const link = await findLink(token);
  if (!link) return { code: 404 };
  return withOrg({ orgId: link.orgId }, async (tx) => {
    const l = await load(tx, link);
    if (!l) return { code: 404 } as const;
    const a = accessOf(l, now());
    if (a.code === 404) return a;
    if (a.code === 410) return { ...a, title: l.version.title, orgName: l.orgName };
    const [docs, sig] = await Promise.all([
      tx.proposalDocument.findMany({ where: { versionId: l.version.id, orgId: link.orgId }, select: { kind: true, sha256: true, byteLength: true } }),
      tx.proposalSignature.findUnique({ where: { versionId: l.version.id }, select: { signerName: true, signedAt: true, totalCents: true, selectedLineIds: true } }),
    ]);
    const pdf = docs.find((d) => d.kind === 'proposal');
    if (!pdf) return { code: 404 } as const; // a sent version always has one (D-35)
    const cert = docs.find((d) => d.kind === 'certificate') ?? null;
    return {
      code: 200,
      state: a.state,
      orgName: l.orgName,
      expiresAt: link.expiresAt,
      version: presentVersion(l.version),
      pdf: { sha256: pdf.sha256, byteLength: pdf.byteLength },
      signature: sig && { ...sig, totalCents: Number(sig.totalCents) },
      certificate: cert && { sha256: cert.sha256, byteLength: cert.byteLength },
    };
  }, { atomic: false });
}

/** A stored PDF through its link: the proposal while the link is live or completed, the certificate once signed. */
export async function linkDocument(token: string, meta: ClientMeta, kind: 'proposal' | 'certificate') {
  await limit(meta);
  const link = await findLink(token);
  if (!link) throw new ClientRefusal(404, 'not_found');
  return withOrg({ orgId: link.orgId }, async (tx) => {
    const l = await load(tx, link);
    if (!l) throw new ClientRefusal(404, 'not_found');
    const a = accessOf(l, now());
    if (a.code === 404) throw new ClientRefusal(404, 'not_found');
    if (a.code === 410) throw new ClientRefusal(410, 'gone', 'gone', a.reason);
    if (kind === 'certificate' && a.state !== 'completed') throw new ClientRefusal(404, 'not_found');
    const d = await tx.proposalDocument.findUnique({ where: { versionId_kind: { versionId: l.version.id, kind } }, select: { bytes: true, sha256: true } });
    if (!d) throw new ClientRefusal(404, 'not_found');
    return { bytes: d.bytes, sha256: d.sha256, filename: `${slugify(l.version.title)}-v${l.version.number}${kind === 'certificate' ? '-certificate' : ''}.pdf` };
  }, { atomic: false });
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'proposal';

export type Posted = { version: number; pdfSha256: string };

function clientAudit(link: LinkRow, meta: ClientMeta, more: AuditExtra = {}): AuditExtra {
  return { via: 'signing-link', linkId: link.id, ipHash: ipHash(meta.ip, ipHashKey(env.AUTH_SECRET)), userAgent: cleanUserAgent(meta.userAgent), ...more };
}

/**
 * Runs one client event: the link must resolve and be live, before and again inside the transaction (a link revoked or
 * expired in between refuses it). Pure-machine refusals (stale version, other hash, wrong status) become 409 "stale".
 */
async function clientEvent(token: string, meta: ClientMeta, type: 'view' | 'sign' | 'decline', posted: Posted, check: () => AuditExtra, then?: (tx: Tx, l: Loaded, at: Date) => Promise<void>) {
  await limit(meta);
  const link = await findLink(token);
  if (!link) throw new ClientRefusal(404, 'not_found');
  const gate = await view(token); // gone before anything is checked: a dead link answers 410 whatever was posted (CS-03)
  if (gate.code === 410) throw new ClientRefusal(410, 'gone', 'gone', gate.reason);
  const more = check(); // the form's own checks (consent, signature, reason) come after the link is known to be live
  if (!Number.isSafeInteger(posted.version) || !normalizeSha256(posted.pdfSha256)) throw new ClientRefusal(409, 'stale');
  const actor: Actor = { orgId: link.orgId, userId: null };
  try {
    await applyEvent(actor, link.proposalId, { type, version: posted.version, pdfSha256: posted.pdfSha256 }, {
      auditData: clientAudit(link, meta, more),
      then: async (tx, { at }) => {
        const fresh = await tx.signingLink.findUnique({ where: { id: link.id }, select: { revokedAt: true, expiresAt: true } });
        if (!fresh || fresh.revokedAt || fresh.expiresAt.getTime() <= at.getTime()) throw new ClientRefusal(410, 'gone', 'gone', fresh?.revokedAt ? 'revoked' : 'expired');
        if (posted.version !== link.versionNumber) throw new ClientRefusal(409, 'stale'); // the link is bound to its version
        if (then) {
          const l = await load(tx, { ...link, ...fresh });
          if (!l) throw new ClientRefusal(404, 'not_found');
          await then(tx, l, at);
        }
      },
    });
  } catch (e) {
    if (e instanceof TransitionError) {
      // The version moved on (superseded, expired, declined): the link is gone; otherwise the page was stale.
      const v = await view(token).catch(() => null);
      throw v && v.code === 410 ? new ClientRefusal(410, 'gone', 'gone', v.reason) : new ClientRefusal(409, 'stale');
    }
    if (e instanceof Refused && !(e instanceof ClientRefusal)) throw new ClientRefusal(409, 'stale', e.message); // FrozenError
    throw e;
  }
}

/** "Open proposal": records the view (D-33), the precondition for signing or declining (D-12). */
export async function recordView(token: string, meta: ClientMeta, posted: Posted) {
  await clientEvent(token, meta, 'view', posted, () => ({}));
}

export type SignPost = Posted & { signerName: string; method: SignatureMethod; signatureData: string; consent: boolean; selected: string[] };

/** Signs the version the page showed, with the chosen add-ons; stores the signature and the certificate atomically. */
export async function signLink(token: string, meta: ClientMeta, posted: SignPost) {
  let sig: ReturnType<typeof checkSignature>;
  const check = () => {
    if (!posted.consent) throw new ClientRefusal(400, 'consent', 'Tick the box to agree to sign electronically.');
    try {
      sig = checkSignature({ signerName: posted.signerName, method: posted.method, data: posted.signatureData });
    } catch (e) {
      if (e instanceof SignatureError) throw new ClientRefusal(400, 'signature', e.message);
      throw e;
    }
    return { signerName: sig.signerName, method: sig.method };
  };
  await clientEvent(token, meta, 'sign', posted, check, async (tx, l, at) => {
    const v = l.version;
    let priced;
    try {
      priced = priceVersionSelection(v, posted.selected);
    } catch (e) {
      if (e instanceof SelectionError) throw new ClientRefusal(400, 'selection', 'One of the chosen add-ons is not part of this proposal. Reload the page.');
      throw e;
    }
    const chosen = new Set(posted.selected);
    const pdfSha256 = v.pdfSha256!;
    const consent = consentText({ title: v.title, version: v.number, pdfSha256 });
    const ip = ipHash(meta.ip, ipHashKey(env.AUTH_SECRET));
    await tx.proposalSignature.create({
      data: {
        orgId: l.link.orgId, versionId: v.id, signerName: sig.signerName, method: sig.method, signatureData: sig.data, consentVersion: CONSENT_VERSION, consentText: consent, pdfSha256,
        selectedLineIds: v.lines.filter((r) => r.optional && chosen.has(r.id)).map((r) => r.id),
        subtotalCents: BigInt(priced.subtotalCents), discountCents: BigInt(priced.proposalDiscountCents), taxCents: BigInt(priced.taxCents), totalCents: BigInt(priced.totalCents),
        ipHash: ip, userAgent: cleanUserAgent(meta.userAgent), signedAt: at,
      },
    });
    const doc = await tx.proposalDocument.findUniqueOrThrow({ where: { versionId_kind: { versionId: v.id, kind: 'proposal' } }, select: { byteLength: true } });
    const events = await tx.auditEvent.findMany({ where: { orgId: l.link.orgId, targetType: 'proposalVersion', targetId: v.id }, orderBy: { id: 'asc' } });
    const bytes = await renderCertificatePdf(
      certificateModel({
        orgName: l.orgName, version: v, pdfSha256, pdfBytes: doc.byteLength, signedAt: at,
        signer: { name: sig.signerName, method: sig.method, data: sig.data }, consent, chosen, pricing: priced, trail: trailOf(events),
      }),
      at,
    );
    await tx.proposalDocument.create({
      data: { orgId: l.link.orgId, versionId: v.id, kind: 'certificate', sha256: sha256Hex(bytes), byteLength: bytes.length, bytes: Buffer.from(bytes), orgName: l.orgName, rendererVersion: PDF_RENDERER_VERSION }, // D-45, D-46
    });
  });
}

export const DECLINE_REASON_MAX = 1000;

/** Declines the version the page showed, with an optional reason (kept in the audit row). */
export async function declineLink(token: string, meta: ClientMeta, posted: Posted & { reason: string }) {
  await clientEvent(token, meta, 'decline', posted, () => {
    const reason = posted.reason.trim();
    if (reason.length > DECLINE_REASON_MAX) throw new ClientRefusal(400, 'reason', `Keep the reason under ${DECLINE_REASON_MAX} characters.`);
    return { reason };
  });
}

/** The daily cron (D-36): `expire` on every sent/viewed version whose links have all lapsed. System actor, one audit row each. */
export async function expireLapsed(): Promise<{ expired: number }> {
  let expired = 0;
  for (const v of await lapsedVersions()) {
    try {
      await applyEvent({ orgId: v.orgId, userId: null }, v.proposalId, { type: 'expire' }, { auditData: { via: 'cron', reason: 'signing link expired' } });
      expired++;
    } catch (e) {
      if (!(e instanceof TransitionError)) throw e; // moved on since the sweep read it (signed, superseded): nothing to do
    }
  }
  return { expired };
}
