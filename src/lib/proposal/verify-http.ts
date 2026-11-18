// Countersign verify page (Phase 4, D-42): the HTML the /verify route handler answers with. A route handler, not a page
// with a server action: the page is public, and every 'use server' export must be session-guarded (INV-01).
import { displayCents } from './money';
import { BRAND_MARK_SVG } from '@/lib/ui/brand-mark';
import { dayTime, pillHtml, STATUS, type StatusKey } from '@/lib/ui/format';
import { esc, page } from './sign-http';
import { CHECK_LABELS, VERIFY_MAX_BYTES, type VerifyResult } from './verify';

// docs/design/Verify.dc.html. Countersign-branded, not per org: the uploader may not know who sent the file. Each verdict
// is word + glyph + colour; only "Verified" is blue, and "renderer changed" never says Verified (D-45).

const HEADER = `<a class="cs-skip" href="#main">Skip to content</a><header class="cs-top"><div class="cs-top__in" style="max-width:880px"><a class="cs-brand" href="/verify">${BRAND_MARK_SVG}Countersign</a></div></header>`;

const form = (again: boolean) => `<form method="post" action="/verify" enctype="multipart/form-data" class="cs-upload">
<h2>${again ? 'Check another file' : 'Check a file'}</h2>
<label for="file">Proposal PDF or completion certificate</label>
<input id="file" name="file" type="file" accept="application/pdf,.pdf" required aria-describedby="file-hint">
<span id="file-hint" class="cs-hint">Up to ${VERIFY_MAX_BYTES / 1024 / 1024} MB. The file is hashed and discarded; nothing about it is stored.</span>
<button type="submit" class="cs-btn cs-btn--primary" style="align-self:flex-start">Check this file</button>
</form>`;

const INTRO = `<h1 class="cs-pagetitle">Verify a signed document</h1>
<p class="cs-lede">Upload a proposal PDF or a completion certificate from Countersign. The page computes the SHA-256 fingerprint of the exact
bytes and looks for a signed version with that fingerprint. One changed byte gives a different fingerprint.</p>`;

const FOOT = `<p class="cs-small">Countersign is a demonstration, not a legally vetted e-signature product, and this page is not legal advice
about whether a signature is enforceable.</p>`;

const shell = (status: number, title: string, inner: string) =>
  page(status, title, `${HEADER}<main id="main" class="cs-client__main" style="gap:20px">${inner}</main>`, { bare: true });

export const verifyFormPage = () => shell(200, 'Verify a signed document', `${INTRO}${form(false)}${FOOT}`);

export const verifyErrorPage = (status: number, message: string) =>
  shell(status, 'Verify a signed document', `${INTRO}<div class="cs-alert" role="alert"><span aria-hidden="true">✗</span><p>${esc(message)}</p></div>${form(false)}${FOOT}`);

const fingerprint = (r: VerifyResult) => `<p>Your file: ${r.byteLength.toLocaleString('en-US')} bytes · SHA-256 <code class="cs-codebox" data-testid="upload-sha256">${r.sha256}</code></p>`;

type Tone = 'ok' | 'bad' | 'warn';
const card = (tone: Tone, verdict: string, glyph: string, heading: string, inner: string) =>
  `<section class="cs-verdict cs-verdict--${tone}" data-verdict="${verdict}" role="status" aria-labelledby="vh"><div class="cs-verdict__head"><span class="cs-dot" aria-hidden="true">${glyph}</span><h2 id="vh">${heading}</h2></div>${inner}</section>`;

function verdictHtml(r: VerifyResult): string {
  if (r.verdict === 'no_match') {
    return card('bad', 'no_match', '✗', 'Not verified', `<p>No signed Countersign document has this fingerprint. If this file came from a signed proposal, it has been changed:
a single different byte gives a different SHA-256.</p>${fingerprint(r)}`);
  }
  if (r.verdict === 'not_signed') {
    return card('bad', 'not_signed', '✗', 'Not verified: never signed', `<p>This file is a ${r.kind === 'certificate' ? 'certificate' : 'proposal'} Countersign stored, but that version was not signed (its status is
${pillHtml((r.status in STATUS ? r.status : 'draft') as StatusKey)}). A sent, replaced, declined or expired proposal is not a signed document.</p>${fingerprint(r)}`);
  }
  const rec = r.record;
  const row = (dt: string, dd: string, wide = false) => `<div${wide ? ' class="cs-wide"' : ''}><dt>${dt}</dt><dd>${dd}</dd></div>`;
  const details = `<dl class="cs-facts">
${row('Proposal', `${esc(rec.title)}, version ${rec.version}`)}
${row('From', esc(rec.orgName))}
${row('For', esc(rec.clientName))}
${rec.signerName ? row('Signed by', esc(rec.signerName)) : ''}
${rec.signedAt ? row('Signed at', esc(dayTime(rec.signedAt))) : ''}
${rec.totalCents !== null ? row('Agreed total', esc(displayCents(rec.totalCents))) : ''}
${rec.pdfSha256 ? row('Proposal PDF SHA-256', `<span class="cs-hash">${rec.pdfSha256}</span>`, true) : ''}
${rec.certificateSha256 ? row('Certificate SHA-256', `<span class="cs-hash">${rec.certificateSha256}</span>`, true) : ''}
</dl>`;
  const checks = `<ul class="cs-checks">${r.checks.map((c) => `<li data-check="${c.id}" data-ok="${c.ok}"><span class="cs-g" aria-hidden="true">${c.ok ? '✓' : '✗'}</span><span><span class="cs-w">${c.ok ? 'Passed:' : 'Failed:'}</span> ${esc(CHECK_LABELS[c.id])}</span></li>`).join('')}</ul>`;
  if (r.verdict === 'renderer_changed') {
    // D-45: every stored hash, the trail and the price agree; only re-rendering failed, and the documents were rendered by
    // another version of the PDF renderer than the one installed now. Not evidence of tampering, and not a full check.
    const was = [...new Set([r.renderer.proposal, r.renderer.certificate].filter((x): x is string => !!x))];
    return card('warn', 'renderer_changed', '◐', 'Hashes match; the PDF renderer has changed since signing', `<p>Your file is the stored ${r.kind === 'certificate' ? 'completion certificate' : 'proposal'} of a signed version, and every stored fingerprint, the audit trail and
the agreed price still agree. The documents were rendered by <code>${was.map(esc).join('</code>, <code>')}</code>; this server now runs
<code>${esc(r.renderer.current)}</code>, which no longer produces the identical bytes, so the re-render checks below could not be
repeated. That is a software change on our side, not a change to the document. Ask the sender to confirm with the original renderer
if you need the full check.</p>
${fingerprint(r)}${details}<h3>Re-derived from the stored record</h3>${checks}`);
  }
  if (r.verdict === 'verified') {
    return card('ok', 'verified', '✓', `Verified: this is the signed ${r.kind === 'certificate' ? 'completion certificate' : 'proposal'}`,
      `<p>Your file is byte for byte the ${r.kind === 'certificate' ? 'completion certificate stored for the signed version' : 'proposal PDF that was signed'}, and the record behind it re-derives.</p>${fingerprint(r)}${details}<h3>Re-derived from the stored record</h3>${checks}`);
  }
  return card('bad', 'inconsistent', '✗', 'Not verified: the stored record is inconsistent', `<p>Your file matches a stored document, but the record behind it no longer re-derives. Contact the sender before relying on it.</p>
${fingerprint(r)}${details}<h3>Re-derived from the stored record</h3>${checks}`);
}

export const verifyResultPage = (r: VerifyResult) =>
  shell(200, r.verdict === 'verified' ? 'Verified' : 'Not verified', `${INTRO}${verdictHtml(r)}${form(true)}${FOOT}`);
