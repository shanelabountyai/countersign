import { beforeEach, describe, expect, it } from 'vitest';
import type { OrgCtx } from '@/core/authz/guards';
import { advanceClock } from '@/core/clock';
import { dbSystem as db } from '@/core/db/system'; // assertions read as the owner role (RLS enforce leg)
import { LIMITS } from '@/core/rate-limit';
import { hashToken } from '@/core/tokens';
import { sha256Hex, verifySha256 } from '@/lib/proposal/hash';
import { displayCents } from '@/lib/proposal/money';
import { priceSelection } from '@/lib/proposal/selection';
import { ipHash, ipHashKey } from '@/lib/proposal/signature';
import { ClientRefusal, declineLink, expireLapsed, linkDocument, openLink, recordView, signLink, type SignPost } from '@/lib/proposal/signing';
import { createProposal, newSigningLink, saveDraft, sendProposal, toLineInput, toLineItem, type DraftInput, type LineInput } from '@/lib/proposal/store';
import { resetAuthTables } from '../helpers/auth';
import { pdfFlatText } from '../helpers/pdf-text';
import { NavSignal } from '../helpers/next';
import { actAs, addMember, makeOrg } from '../helpers/org';

// Phase 3 signing flow over Postgres: send stores and hashes the PDF (CS-02), the link answers 200/410/404 (CS-03), every
// client event writes one audit row with hashed IP, user agent and document hash (CS-04), D-16 binding over the link,
// the signature and certificate (D-32, D-35, D-37), expiry (D-36).

const line = (over: Partial<LineInput> = {}): LineInput => ({
  kind: 'fixed', description: 'Work', unitPriceCents: 10_000, quantityMilli: 1000, taxRateBps: 0, discount: null, optional: false, selected: false, ...over,
});
const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
  title: 'Website rebuild', clientName: 'Acme Co', clientEmail: 'buyer@acme.test', scope: 'a new site', timeline: '6 weeks', discount: null,
  sections: [{ kind: 'section', title: 'Scope', body: 'We will build {{scope}} for {{client}}.' }, { kind: 'terms', title: 'Terms', body: 'Net 30.' }],
  lines: [
    line({ description: 'Design', unitPriceCents: 250_000, taxRateBps: 825 }),
    line({ kind: 'hourly', description: 'Support retainer', unitPriceCents: 15_000, quantityMilli: 10_000, optional: true, selected: true }),
    line({ kind: 'per_unit', description: 'Extra page', unitPriceCents: 40_000, quantityMilli: 2_000, taxRateBps: 825, optional: true, selected: false }),
  ],
  ...over,
});

const META = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Test) Countersign' };
let ctx: OrgCtx;
let other: OrgCtx;

beforeEach(async () => {
  await resetAuthTables();
  const [a, b] = [await makeOrg('acme'), await makeOrg('beta')];
  ctx = await actAs((await addMember(a.id, 'owner', 'owner@acme.test')).id, a.slug);
  other = await actAs((await addMember(b.id, 'owner', 'owner@beta.test')).id, b.slug);
  ctx = await actAs(ctx.userId, a.slug);
});

async function newDraft(as: OrgCtx = ctx, d: DraftInput = draft()) {
  const id = await createProposal(as, { templateId: null, title: d.title, clientName: d.clientName });
  await saveDraft(as, id, { version: 1, revision: 1 }, d);
  return id;
}
async function sent(as: OrgCtx = ctx, d?: DraftInput, days?: number) {
  const id = await newDraft(as, d);
  const r = await sendProposal(as, id, { version: 1, revision: 2 }, days);
  return { id, ...r, token: r.url.split('/sign/')[1]! };
}
const posted = (r: { version: number; pdfSha256: string }) => ({ version: r.version, pdfSha256: r.pdfSha256 });
const signPost = (r: { version: number; pdfSha256: string }, over: Partial<SignPost> = {}): SignPost => ({
  ...posted(r), signerName: 'Jane Buyer', method: 'typed', signatureData: 'Jane Buyer', consent: true, selected: [], ...over,
});
const versionOf = (id: string, number = 1) => db.proposalVersion.findFirstOrThrow({ where: { proposalId: id, number }, include: { lines: { orderBy: { position: 'asc' } } } });
const audits = (prefix = 'proposal.') => db.auditEvent.findMany({ where: { action: { startsWith: prefix } }, orderBy: { id: 'asc' } });
const snapshot = async () =>
  JSON.stringify(
    await Promise.all([db.proposalVersion.findMany({ orderBy: { id: 'asc' } }), db.proposalSignature.findMany(), db.proposalDocument.findMany({ select: { id: true, sha256: true } }), db.signingLink.findMany({ orderBy: { id: 'asc' } }), db.auditEvent.count()]),
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
  );
const refusal = (status: number, code: string) => expect.objectContaining({ name: 'ClientRefusal', status, code });

describe('send (CS-02, D-31, D-35)', () => {
  it('stores the exact PDF, records its hash, creates one link and shows the raw token only once', async () => {
    const r = await sent();
    const v = await versionOf(r.id);
    expect(v).toMatchObject({ status: 'sent', pdfSha256: r.pdfSha256 });
    const doc = await db.proposalDocument.findFirstOrThrow({ where: { versionId: v.id, kind: 'proposal' } });
    expect(sha256Hex(doc.bytes)).toBe(r.pdfSha256);
    expect(Buffer.from(doc.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    for (const i of [0, 100, doc.bytes.length - 1]) {
      const flipped = Buffer.from(doc.bytes);
      flipped[i]! ^= 1;
      expect(verifySha256(flipped, r.pdfSha256)).toBe(false); // any byte change fails verify
    }
    expect(pdfFlatText(doc.bytes)).toContain('Website rebuild');
    expect(pdfFlatText(doc.bytes)).toContain('We will build a new site for Acme Co.');

    const links = await db.signingLink.findMany();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ versionId: v.id, tokenHash: hashToken(r.token), revokedAt: null });
    expect(links[0]!.expiresAt.getTime() - links[0]!.createdAt.getTime()).toBeGreaterThan(29 * 86_400_000);
    expect(JSON.stringify(await db.auditEvent.findMany(), (_, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(r.token); // INV-07: only the hash is kept
    expect((await audits()).map((a) => a.action).slice(-2)).toEqual(['proposal.version.sent', 'proposal.link.created']);
    expect((await audits('proposal.version.sent'))[0]!.data).toMatchObject({ pdfSha256: r.pdfSha256, from: 'draft', to: 'sent' });
  });

  it.each<[string, () => Promise<unknown>, RegExp]>([
    ['a stale revision', async () => sendProposal(ctx, await newDraft(), { version: 1, revision: 1 }), /changed since you opened it/],
    ['characters the PDF cannot draw', async () => sendProposal(ctx, await newDraft(ctx, draft({ title: 'Site 中文' })), { version: 1, revision: 2 }), /U\+4E2D/],
    ['no line items', async () => sendProposal(ctx, await newDraft(ctx, draft({ lines: [] })), { version: 1, revision: 2 }), /at least one line/],
    ['a link of 0 days', async () => sendProposal(ctx, await newDraft(), { version: 1, revision: 2 }, 0), /1 to 90 days/],
    ['a link of 91 days', async () => sendProposal(ctx, await newDraft(), { version: 1, revision: 2 }, 91), /1 to 90 days/],
  ])('refuses %s and writes nothing', async (_, call, msg) => {
    const before = await db.proposalDocument.count();
    await expect(call()).rejects.toThrow(msg);
    expect(await db.proposalDocument.count()).toBe(before);
    expect(await db.proposalVersion.count({ where: { status: 'sent' } })).toBe(0);
  });

  it('refuses a second send, and another org answers notFound', async () => {
    const r = await sent();
    await expect(sendProposal(ctx, r.id, { version: 1, revision: 2 })).rejects.toThrow(/already been sent/);
    const id = await newDraft();
    await expect(sendProposal(other, id, { version: 1, revision: 2 })).rejects.toEqual(new NavSignal('notFound'));
  });
});

describe('the link (CS-03)', () => {
  it('unknown and malformed tokens are 404', async () => {
    expect(await openLink('x'.repeat(43), META)).toEqual({ code: 404 });
    expect(await openLink('short', META)).toEqual({ code: 404 });
  });

  it('a sent version answers 200 with the stored PDF hash, and opening it writes nothing (D-33)', async () => {
    const r = await sent();
    const before = await snapshot();
    const v = await openLink(r.token, META);
    expect(v).toMatchObject({ code: 200, state: 'active', pdf: { sha256: r.pdfSha256 }, version: { number: 1, status: 'sent', title: 'Website rebuild' } });
    expect(await snapshot()).toBe(before);
  });

  it('after an edit supersedes the version, its link is 410 for every request and nothing is written', async () => {
    const r = await sent();
    await recordView(r.token, META, posted(r));
    await saveDraft(ctx, r.id, { version: 1, revision: 0 }, draft({ title: 'Revised' }));
    const before = await snapshot();
    expect(await openLink(r.token, META)).toMatchObject({ code: 410, reason: 'superseded', title: 'Website rebuild' });
    await expect(recordView(r.token, META, posted(r))).rejects.toEqual(refusal(410, 'gone'));
    await expect(signLink(r.token, META, signPost(r))).rejects.toEqual(refusal(410, 'gone'));
    await expect(declineLink(r.token, META, { ...posted(r), reason: '' })).rejects.toEqual(refusal(410, 'gone'));
    await expect(linkDocument(r.token, META, 'proposal')).rejects.toEqual(refusal(410, 'gone'));
    expect(await snapshot()).toBe(before);
  });

  it('a link past its expiry is 410 at once, before the cron runs; then the cron expires the version', async () => {
    const r = await sent(ctx, undefined, 1);
    advanceClock(86_400_000 + 1000);
    const before = await snapshot();
    expect(await openLink(r.token, META)).toMatchObject({ code: 410, reason: 'expired' });
    await expect(recordView(r.token, META, posted(r))).rejects.toEqual(refusal(410, 'gone'));
    expect(await snapshot()).toBe(before);
    expect((await versionOf(r.id)).status).toBe('sent');

    expect(await expireLapsed()).toEqual({ expired: 1 });
    expect((await versionOf(r.id)).status).toBe('expired');
    expect((await audits('proposal.version.expired'))[0]).toMatchObject({ actorUserId: null, data: expect.objectContaining({ via: 'cron', from: 'sent', to: 'expired' }) });
    expect(await expireLapsed()).toEqual({ expired: 0 });
    expect(await openLink(r.token, META)).toMatchObject({ code: 410, reason: 'expired' });
  });

  it('the cron leaves live links, drafts and signed versions alone', async () => {
    const live = await sent();
    const signed = await sent(ctx, undefined, 1);
    await recordView(signed.token, META, posted(signed));
    await signLink(signed.token, META, signPost(signed));
    await newDraft();
    advanceClock(2 * 86_400_000);
    expect(await expireLapsed()).toEqual({ expired: 0 });
    expect((await versionOf(live.id)).status).toBe('sent');
    expect(await openLink(signed.token, META)).toMatchObject({ code: 200, state: 'completed' }); // a signed document stays readable
  });

  it('a new link revokes the old one (410 revoked); the new one works', async () => {
    const r = await sent();
    const fresh = await newSigningLink(ctx, r.id, 7);
    const token2 = fresh.url.split('/sign/')[1]!;
    expect(await openLink(r.token, META)).toMatchObject({ code: 410, reason: 'revoked' });
    expect(await openLink(token2, META)).toMatchObject({ code: 200, state: 'active' });
    expect((await audits('proposal.link.')).map((a) => a.action)).toEqual(['proposal.link.created', 'proposal.link.revoked', 'proposal.link.created']);
    await expect(newSigningLink(other, r.id)).rejects.toEqual(new NavSignal('notFound'));
  });

  it('a token only ever reaches its own org and version (CS-05)', async () => {
    const a = await sent();
    const b = await sent(other, draft({ title: 'Beta deal' }));
    expect(await openLink(b.token, META)).toMatchObject({ code: 200, version: { title: 'Beta deal', orgId: other.orgId } });
    expect(await openLink(a.token, META)).toMatchObject({ code: 200, version: { title: 'Website rebuild', orgId: ctx.orgId } });
    // A's page state posted through B's link is stale for B: nothing in either org changes.
    const before = await snapshot();
    await expect(recordView(b.token, META, posted(a))).rejects.toEqual(refusal(409, 'stale'));
    expect(await snapshot()).toBe(before);
  });

  it('one IP is rate-limited (INV-09 style)', async () => {
    const r = await sent();
    for (let i = 0; i < LIMITS.shareReadPerIp.limit; i++) await openLink(r.token, { ...META, ip: '198.51.100.1' });
    await expect(openLink(r.token, { ...META, ip: '198.51.100.1' })).rejects.toEqual(refusal(429, 'limited'));
    expect(await openLink(r.token, META)).toMatchObject({ code: 200 });
  });
});

describe('client events (CS-04, D-16, D-34)', () => {
  it('open writes one audit row with hashed IP, user agent and document hash, and no user', async () => {
    const r = await sent();
    await recordView(r.token, META, posted(r));
    expect((await versionOf(r.id)).status).toBe('viewed');
    const rows = await audits('proposal.version.viewed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: null, orgId: ctx.orgId });
    expect(rows[0]!.data).toMatchObject({ from: 'sent', to: 'viewed', pdfSha256: r.pdfSha256, ipHash: ipHash(META.ip, ipHashKey(process.env.AUTH_SECRET!)), userAgent: META.userAgent, via: 'signing-link' });
    expect(JSON.stringify(rows[0]!.data)).not.toContain(META.ip);
    await recordView(r.token, META, posted(r)); // a repeat open is audited too
    expect(await audits('proposal.version.viewed')).toHaveLength(2);
  });

  it.each<[string, (r: Awaited<ReturnType<typeof sent>>) => Promise<unknown>, number, string]>([
    ['a sign before the proposal was opened (D-12)', (r) => signLink(r.token, META, signPost(r)), 409, 'stale'],
    ['a stale version', (r) => recordView(r.token, META, { version: 2, pdfSha256: r.pdfSha256 }), 409, 'stale'],
    ['another document hash', (r) => recordView(r.token, META, { version: 1, pdfSha256: 'f'.repeat(64) }), 409, 'stale'],
    ['a malformed hash', (r) => recordView(r.token, META, { version: 1, pdfSha256: 'nope' }), 409, 'stale'],
  ])('refuses %s and writes nothing', async (_, call, status, code) => {
    const r = await sent();
    const before = await snapshot();
    await expect(call(r)).rejects.toEqual(refusal(status, code));
    expect(await snapshot()).toBe(before);
  });

  it.each<[string, Partial<SignPost>, string]>([
    ['no consent', { consent: false }, 'consent'],
    ['no name', { signerName: ' ' }, 'signature'],
    ['a malformed drawing', { method: 'drawn', signatureData: 'M0 0 C1 1' }, 'signature'],
    ['a required line as an add-on', { selected: ['required'] }, 'selection'],
    ['an unknown add-on', { selected: ['00000000-0000-4000-8000-000000000000'] }, 'selection'],
  ])('a sign with %s is refused (400) and writes nothing', async (_, over, code) => {
    const r = await sent();
    await recordView(r.token, META, posted(r));
    const v = await versionOf(r.id);
    const sel = over.selected?.[0] === 'required' ? { selected: [v.lines[0]!.id] } : {};
    const before = await snapshot();
    await expect(signLink(r.token, META, signPost(r, { ...over, ...sel }))).rejects.toEqual(refusal(400, code));
    expect(await snapshot()).toBe(before);
    expect((await versionOf(r.id)).status).toBe('viewed');
  });

  it('sign: status, signature with the chosen add-ons priced by price(), certificate stored and hashed, one audit row', async () => {
    const r = await sent();
    await recordView(r.token, META, posted(r));
    const v = await versionOf(r.id);
    const extraPage = v.lines[2]!.id; // switched off by the author; the client turns it on and the retainer off
    await signLink(r.token, META, signPost(r, { method: 'drawn', signatureData: 'M10 150 L120 40 L240 160 M300 100 L560 90', selected: [extraPage] }));

    expect((await versionOf(r.id)).status).toBe('signed');
    const expected = priceSelection({ lines: v.lines.map((l) => toLineItem(l.id, toLineInput(l))) }, [extraPage]);
    const sig = await db.proposalSignature.findUniqueOrThrow({ where: { versionId: v.id } });
    expect(sig).toMatchObject({ signerName: 'Jane Buyer', method: 'drawn', pdfSha256: r.pdfSha256, selectedLineIds: [extraPage], totalCents: BigInt(expected.totalCents), consentVersion: 'v1', userAgent: META.userAgent });
    expect(expected.totalCents).toBe(250_000 + 20_625 + 80_000 + 6_600); // design + 8.25 % on (2,500 + 800), rounded once (D-18)
    expect(sig.consentText).toContain(r.pdfSha256);

    const cert = await db.proposalDocument.findFirstOrThrow({ where: { versionId: v.id, kind: 'certificate' } });
    expect(sha256Hex(cert.bytes)).toBe(cert.sha256);
    const text = pdfFlatText(cert.bytes);
    for (const s of [r.pdfSha256, 'Jane Buyer', 'I agree to do business electronically', 'Chosen: Extra page', 'Not chosen: Support retainer', displayCents(expected.totalCents), 'version.sent', 'version.viewed', 'version.signed', sig.ipHash]) {
      expect(text).toContain(s);
    }
    const signedRows = await audits('proposal.version.signed');
    expect(signedRows).toHaveLength(1);
    expect(signedRows[0]!.data).toMatchObject({ signerName: 'Jane Buyer', method: 'drawn', pdfSha256: r.pdfSha256, ipHash: sig.ipHash });

    const view = await openLink(r.token, META);
    expect(view).toMatchObject({ code: 200, state: 'completed', signature: { signerName: 'Jane Buyer', totalCents: expected.totalCents }, certificate: { sha256: cert.sha256 } });
    const pdf = await linkDocument(r.token, META, 'proposal');
    expect(sha256Hex(pdf.bytes)).toBe(r.pdfSha256); // the downloaded document is the one that was signed
    expect((await linkDocument(r.token, META, 'certificate')).sha256).toBe(cert.sha256);
    await expect(signLink(r.token, META, signPost(r))).rejects.toEqual(refusal(409, 'stale')); // terminal
  });

  it('decline: one audit row with the reason; the link is then 410', async () => {
    const r = await sent();
    await recordView(r.token, META, posted(r));
    await expect(declineLink(r.token, META, { ...posted(r), reason: 'x'.repeat(1001) })).rejects.toEqual(refusal(400, 'reason'));
    await declineLink(r.token, META, { ...posted(r), reason: ' Too expensive ' });
    expect((await versionOf(r.id)).status).toBe('declined');
    expect((await audits('proposal.version.declined'))[0]!.data).toMatchObject({ reason: 'Too expensive', from: 'viewed', to: 'declined' });
    expect(await openLink(r.token, META)).toMatchObject({ code: 410, reason: 'declined' });
    await expect(linkDocument(r.token, META, 'certificate')).rejects.toBeInstanceOf(ClientRefusal);
  });

  it('the certificate is not available before signing', async () => {
    const r = await sent();
    await expect(linkDocument(r.token, META, 'certificate')).rejects.toEqual(refusal(404, 'not_found'));
  });
});
