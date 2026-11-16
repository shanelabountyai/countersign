import { beforeEach, describe, expect, it } from 'vitest';
import type { OrgCtx } from '@/core/authz/guards';
import { dbSystem as db } from '@/core/db/system'; // assertions and at-rest tampering run as the owner role
import { LIMITS } from '@/core/rate-limit';
import { CHECK_LABELS, verifyPdf, VerifyRefusal, VERIFY_MAX_BYTES, type CheckId } from '@/lib/proposal/verify';
import { recordView, signLink, type SignPost } from '@/lib/proposal/signing';
import { createProposal, saveDraft, sendProposal, type DraftInput, type LineInput } from '@/lib/proposal/store';
import { GET, POST } from '@/app/verify/route';
import { resetAuthTables } from '../helpers/auth';
import { actAs, addMember, makeOrg } from '../helpers/org';

// Phase 4 verify page over Postgres: a signed version's PDF and certificate verify only after the record re-derives from
// stored data (D-40); any changed byte, an unsigned version (D-17) or a record tampered at rest is "not verified"; the
// check writes nothing; uploads are bounded.

const line = (over: Partial<LineInput> = {}): LineInput => ({
  kind: 'fixed', description: 'Work', unitPriceCents: 10_000, quantityMilli: 1000, taxRateBps: 0, discount: null, optional: false, selected: false, ...over,
});
const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
  title: 'Website rebuild', clientName: 'Acme Co', clientEmail: 'buyer@acme.test', scope: 'a new site', timeline: '6 weeks', discount: { type: 'percent', bps: 500 },
  sections: [{ kind: 'section', title: 'Scope', body: 'We will build {{scope}} for {{client}}.' }, { kind: 'terms', title: 'Terms', body: 'Net 30.' }],
  lines: [
    line({ description: 'Design', unitPriceCents: 250_000, taxRateBps: 825 }),
    line({ kind: 'hourly', description: 'Support retainer', unitPriceCents: 15_000, quantityMilli: 10_000, optional: true, selected: true }),
    line({ kind: 'per_unit', description: 'Extra page', unitPriceCents: 40_000, quantityMilli: 2_000, taxRateBps: 825, optional: true, selected: false }),
  ],
  ...over,
});

let ip = 0;
const META = () => ({ ip: `198.51.100.${++ip % 250}`, userAgent: 'Mozilla/5.0 (Test) Countersign' });
let ctx: OrgCtx;

beforeEach(async () => {
  await resetAuthTables();
  const a = await makeOrg('acme');
  ctx = await actAs((await addMember(a.id, 'owner', 'owner@acme.test')).id, a.slug);
});

async function sent(d: DraftInput = draft()) {
  const id = await createProposal(ctx, { templateId: null, title: d.title, clientName: d.clientName });
  await saveDraft(ctx, id, { version: 1, revision: 1 }, d);
  const r = await sendProposal(ctx, id, { version: 1, revision: 2 });
  return { id, ...r, token: r.url.split('/sign/')[1]! };
}
async function signed(over: Partial<SignPost> = {}) {
  const r = await sent();
  const posted = { version: r.version, pdfSha256: r.pdfSha256 };
  await recordView(r.token, META(), posted);
  const v = await db.proposalVersion.findFirstOrThrow({ where: { proposalId: r.id, number: 1 }, include: { lines: { orderBy: { position: 'asc' } } } });
  await signLink(r.token, META(), { ...posted, signerName: 'Jane Buyer', method: 'typed', signatureData: 'Jane Buyer', consent: true, selected: [v.lines[2]!.id], ...over });
  const docs = await db.proposalDocument.findMany({ where: { versionId: v.id } });
  return { ...r, versionId: v.id, pdf: Buffer.from(docs.find((x) => x.kind === 'proposal')!.bytes), cert: Buffer.from(docs.find((x) => x.kind === 'certificate')!.bytes) };
}

/** Simulates tampering at rest: the DB owner with user triggers off (the freeze triggers, D-21/D-35, refuse it otherwise). */
const atRest = (sql: string, ...values: unknown[]) =>
  db.$transaction(async (t) => {
    await t.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await t.$executeRawUnsafe(sql, ...values);
  });

const failing = (r: Awaited<ReturnType<typeof verifyPdf>>) => ('checks' in r ? r.checks.filter((c) => !c.ok).map((c) => c.id) : null);
const ALL: CheckId[] = Object.keys(CHECK_LABELS) as CheckId[];

describe('a signed version verifies after re-derivation (D-40)', () => {
  it('the proposal PDF: verified, every check passes, the record names the signer and the agreed total', async () => {
    const s = await signed();
    const r = await verifyPdf(s.pdf, META());
    expect(r).toMatchObject({ verdict: 'verified', kind: 'proposal', sha256: s.pdfSha256, byteLength: s.pdf.length });
    if (r.verdict !== 'verified') throw new Error('unreachable');
    expect(r.checks.map((c) => c.id)).toEqual(ALL);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    const sig = await db.proposalSignature.findUniqueOrThrow({ where: { versionId: s.versionId } });
    expect(r.record).toMatchObject({ orgName: expect.any(String), title: 'Website rebuild', clientName: 'Acme Co', version: 1, signerName: 'Jane Buyer', totalCents: Number(sig.totalCents), pdfSha256: s.pdfSha256 });
    expect(r.record.signedAt?.getTime()).toBe(sig.signedAt.getTime());
  });

  it('the completion certificate verifies too', async () => {
    const s = await signed({ method: 'drawn', signatureData: 'M10 10 L200 120 L300 40' });
    const r = await verifyPdf(s.cert, META());
    expect(r).toMatchObject({ verdict: 'verified', kind: 'certificate' });
    expect(failing(r)).toEqual([]);
  });
});

describe('tamper test: any changed byte is not verified (CS-02)', () => {
  it('first, middle and last byte flipped, one byte appended, one removed → no_match', async () => {
    const s = await signed();
    const variants = [0, s.pdf.length >> 1, s.pdf.length - 1].map((i) => {
      const b = Buffer.from(s.pdf);
      b[i]! ^= 1;
      return b;
    });
    variants.push(Buffer.concat([s.pdf, Buffer.from([0x0a])]), s.pdf.subarray(0, -1), Buffer.from(s.cert).fill(0x20, 200, 201));
    for (const b of variants) expect(await verifyPdf(b, META())).toMatchObject({ verdict: 'no_match', byteLength: b.length });
  });
});

describe('unsigned versions never verify (D-17)', () => {
  it('a sent PDF is not_signed; after an edit supersedes it, still not_signed', async () => {
    const r = await sent();
    const pdf = Buffer.from((await db.proposalDocument.findFirstOrThrow({ where: { sha256: r.pdfSha256 } })).bytes);
    expect(await verifyPdf(pdf, META())).toMatchObject({ verdict: 'not_signed', status: 'sent', kind: 'proposal' });
    await saveDraft(ctx, r.id, { version: 1, revision: 0 }, draft({ title: 'Revised' }));
    expect(await verifyPdf(pdf, META())).toMatchObject({ verdict: 'not_signed', status: 'superseded' });
  });
});

describe('a record tampered at rest is inconsistent, not verified', () => {
  it.each<[string, (s: Awaited<ReturnType<typeof signed>>) => Promise<unknown>, CheckId[]]>([
    ['the stored signature total', (s) => atRest(`UPDATE "ProposalSignature" SET "totalCents" = "totalCents" + 1 WHERE "versionId" = $1::uuid`, s.versionId), ['pricing']],
    ['the chosen add-ons', (s) => atRest(`UPDATE "ProposalSignature" SET "selectedLineIds" = '{}' WHERE "versionId" = $1::uuid`, s.versionId), ['pricing', 'certificate-rerender']],
    ['a frozen line description', (s) => atRest(`UPDATE "ProposalLine" SET description = 'Desing' WHERE "versionId" = $1::uuid AND position = 0`, s.versionId), ['proposal-rerender']],
    ['the signer name', (s) => atRest(`UPDATE "ProposalSignature" SET "signerName" = 'Someone Else' WHERE "versionId" = $1::uuid`, s.versionId), ['certificate-rerender']],
    ['the certificate bytes', (s) => atRest(`UPDATE "ProposalDocument" SET bytes = $2 WHERE "versionId" = $1::uuid AND kind = 'certificate'`, s.versionId, Buffer.concat([s.cert, Buffer.from(' ')])), ['certificate-bytes', 'certificate-rerender']],
    ['an audit row (the signed event)', (s) => atRest(`UPDATE "AuditEvent" SET data = jsonb_set(data, '{pdfSha256}', '"${'0'.repeat(64)}"') WHERE "targetId" = $1 AND action = 'proposal.version.signed'`, s.versionId), ['audit-trail', 'certificate-rerender']],
    ['the org name, renamed after signing (D-41: a known limit, flagged rather than hidden)', (s) => atRest(`UPDATE "Org" SET name = 'Renamed Co' WHERE id = (SELECT "orgId" FROM "ProposalVersion" WHERE id = $1::uuid)`, s.versionId), ['proposal-rerender', 'certificate-rerender']],
  ])('%s', async (_, tamper, expected) => {
    const s = await signed();
    await tamper(s);
    const r = await verifyPdf(s.pdf, META());
    expect(r.verdict).toBe('inconsistent');
    expect(failing(r)).toEqual(expected);
  });

  it('the stored proposal bytes changed (and re-hashed): the upload no longer matches anything stored', async () => {
    const s = await signed();
    const evil = Buffer.from(s.pdf);
    evil[evil.length >> 1]! ^= 1;
    const { createHash } = await import('node:crypto');
    await atRest(`UPDATE "ProposalDocument" SET bytes = $2, sha256 = $3 WHERE "versionId" = $1::uuid AND kind = 'proposal'`, s.versionId, evil, createHash('sha256').update(evil).digest('hex'));
    expect(await verifyPdf(s.pdf, META())).toMatchObject({ verdict: 'no_match' });
    const r = await verifyPdf(evil, META()); // the swapped file: its hash is stored, but nothing else agrees with it
    expect(r.verdict).toBe('inconsistent');
    expect(failing(r)).toEqual(['signed', 'hashes-agree', 'proposal-rerender']);
  });
});

describe('read-only and bounded', () => {
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all([db.proposalVersion.findMany({ orderBy: { id: 'asc' } }), db.proposalSignature.findMany(), db.proposalDocument.findMany({ select: { id: true, sha256: true } }), db.signingLink.findMany({ orderBy: { id: 'asc' } }), db.auditEvent.count()]),
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    );

  it('writes nothing for a verified, unsigned or unknown upload', async () => {
    const s = await signed();
    const before = await snapshot();
    await verifyPdf(s.pdf, META());
    await verifyPdf(Buffer.from('%PDF-1.4 not ours'), META());
    expect(await snapshot()).toBe(before);
  });

  it('refuses an empty or oversized upload, and limits each IP', async () => {
    await expect(verifyPdf(new Uint8Array(0), META())).rejects.toEqual(expect.objectContaining({ name: 'VerifyRefusal', status: 400 }));
    await expect(verifyPdf(new Uint8Array(VERIFY_MAX_BYTES + 1), META())).rejects.toEqual(expect.objectContaining({ name: 'VerifyRefusal', status: 413 }));
    const meta = { ip: '192.0.2.99' };
    for (let i = 0; i < LIMITS.shareReadPerIp.limit; i++) await verifyPdf(Buffer.from(`x${i}`), meta);
    await expect(verifyPdf(Buffer.from('one more'), meta)).rejects.toBeInstanceOf(VerifyRefusal);
  });

  it('another org’s signed PDF verifies with that org’s record only (the lookup needs the exact bytes)', async () => {
    const s = await signed();
    const b = await makeOrg('beta');
    ctx = await actAs((await addMember(b.id, 'owner', 'owner@beta.test')).id, b.slug);
    const t = await signed();
    const [ra, rb] = [await verifyPdf(s.pdf, META()), await verifyPdf(t.pdf, META())];
    expect(ra).toMatchObject({ verdict: 'verified', record: { orgName: 'acme' } });
    expect(rb).toMatchObject({ verdict: 'verified', record: { orgName: b.name } });
  });
});

describe('/verify route (D-42)', () => {
  const upload = (bytes: Uint8Array | null, headers: Record<string, string> = {}) => {
    const f = new FormData();
    if (bytes) f.set('file', new File([Buffer.from(bytes)], 'proposal.pdf', { type: 'application/pdf' }));
    return new Request('http://localhost:8300/verify', { method: 'POST', body: f, headers: { 'x-forwarded-for': `203.0.113.${++ip % 250}`, ...headers } });
  };

  it('GET shows the upload form, noindex and no-store', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const html = await res.text();
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('type="file"');
  });

  it('POST: verified for the signed PDF, a clear fail for one flipped byte, 400 without a file', async () => {
    const s = await signed();
    const ok = await POST(upload(s.pdf));
    expect(ok.status).toBe(200);
    const okHtml = await ok.text();
    expect(okHtml).toContain('data-verdict="verified"');
    expect(okHtml).toContain('Jane Buyer');
    expect(okHtml).toContain(s.pdfSha256);
    const bad = Buffer.from(s.pdf);
    bad[100]! ^= 0x01;
    const no = await POST(upload(bad));
    expect(no.status).toBe(200);
    const noHtml = await no.text();
    expect(noHtml).toContain('data-verdict="no_match"');
    expect(noHtml).toContain('Not verified');
    expect(noHtml).not.toContain('Jane Buyer');
    expect((await POST(upload(null))).status).toBe(400);
  });

  it('refuses a declared body over the limit before reading it (413)', async () => {
    const res = await POST(new Request('http://localhost:8300/verify', { method: 'POST', body: 'x', headers: { 'content-length': String(VERIFY_MAX_BYTES + 100_000), 'content-type': 'multipart/form-data; boundary=x' } }));
    expect(res.status).toBe(413);
  });
});
