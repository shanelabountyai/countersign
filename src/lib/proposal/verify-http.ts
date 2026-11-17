// Countersign verify page (Phase 4, D-42): the HTML the /verify route handler answers with. A route handler, not a page
// with a server action: the page is public, and every 'use server' export must be session-guarded (INV-01).
import { displayCents } from './money';
import { esc, page } from './sign-http';
import { CHECK_LABELS, VERIFY_MAX_BYTES, type VerifyResult } from './verify';

const STYLE = `<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f7f7f5;color:#1d1d1b}
main{max-width:44rem;margin:0 auto;padding:2rem 1rem}
.card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:1rem 1.25rem;margin:1rem 0}
.ok{border-color:#1f7a3a;background:#effaf2}.fail{border-color:#b42318;background:#fef3f2}
.warn{border-color:#9a6700;background:#fff8e6}
.ok h2{color:#1f7a3a}.fail h2{color:#b42318}.warn h2{color:#7a5200}
code{font-size:.85em;word-break:break-all}
ul.checks{list-style:none;padding:0}ul.checks li{margin:.25rem 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}dt{color:#555}dd{margin:0}
small{color:#555}
</style>`;

const FORM = `<form method="post" action="/verify" enctype="multipart/form-data" class="card">
<label for="file">Proposal PDF or completion certificate</label><br>
<input id="file" name="file" type="file" accept="application/pdf,.pdf" required>
<button type="submit">Check this file</button>
<p><small>Up to ${VERIFY_MAX_BYTES / 1024 / 1024} MB. The file is hashed and discarded; nothing about it is stored.</small></p>
</form>`;

const INTRO = `<h1>Verify a signed document</h1>
<p>Upload a proposal PDF or a completion certificate from Countersign. The page computes the SHA-256 of the exact bytes
and looks for a signed version with that fingerprint. If one changed byte, it says so.</p>`;

const FOOT = `<p><small>Countersign is a demonstration, not a legally vetted e-signature product, and this page is not legal advice
about whether a signature is enforceable.</small></p>`;

export const verifyFormPage = () => page(200, 'Verify a signed document', `${STYLE}${INTRO}${FORM}${FOOT}`);

export const verifyErrorPage = (status: number, message: string) =>
  page(status, 'Verify a signed document', `${STYLE}${INTRO}<div class="card fail" role="alert"><p>${esc(message)}</p></div>${FORM}${FOOT}`);

const fingerprint = (r: VerifyResult) => `<p>Your file: ${r.byteLength.toLocaleString('en-US')} bytes, SHA-256 <code data-testid="upload-sha256">${r.sha256}</code></p>`;

function verdictHtml(r: VerifyResult): string {
  if (r.verdict === 'no_match') {
    return `<div class="card fail" data-verdict="no_match" role="status"><h2>Not verified</h2>
<p>No signed Countersign document has this fingerprint. If this file came from a signed proposal, it has been changed:
a single different byte gives a different SHA-256.</p>${fingerprint(r)}</div>`;
  }
  if (r.verdict === 'not_signed') {
    return `<div class="card fail" data-verdict="not_signed" role="status"><h2>Not verified: never signed</h2>
<p>This file is a ${r.kind === 'certificate' ? 'certificate' : 'proposal'} Countersign stored, but that version was not signed (its status is
<strong>${esc(r.status)}</strong>). A sent, replaced, declined or expired proposal is not a signed document.</p>${fingerprint(r)}</div>`;
  }
  const rec = r.record;
  const details = `<dl>
<dt>Proposal</dt><dd>${esc(rec.title)}, version ${rec.version}</dd>
<dt>From</dt><dd>${esc(rec.orgName)}</dd>
<dt>For</dt><dd>${esc(rec.clientName)}</dd>
${rec.signerName ? `<dt>Signed by</dt><dd>${esc(rec.signerName)}</dd>` : ''}
${rec.signedAt ? `<dt>Signed at</dt><dd>${esc(rec.signedAt.toISOString())}</dd>` : ''}
${rec.totalCents !== null ? `<dt>Agreed total</dt><dd>${esc(displayCents(rec.totalCents))}</dd>` : ''}
${rec.pdfSha256 ? `<dt>Proposal PDF SHA-256</dt><dd><code>${rec.pdfSha256}</code></dd>` : ''}
${rec.certificateSha256 ? `<dt>Certificate SHA-256</dt><dd><code>${rec.certificateSha256}</code></dd>` : ''}
</dl>`;
  const checks = `<ul class="checks">${r.checks.map((c) => `<li data-check="${c.id}" data-ok="${c.ok}">${c.ok ? '✓' : '✗'} ${esc(CHECK_LABELS[c.id])}</li>`).join('')}</ul>`;
  if (r.verdict === 'renderer_changed') {
    // D-45: every stored hash, the trail and the price agree; only re-rendering failed, and the documents were rendered by
    // another version of the PDF renderer than the one installed now. Not evidence of tampering, and not a full check.
    const was = [...new Set([r.renderer.proposal, r.renderer.certificate].filter((x): x is string => !!x))];
    return `<div class="card warn" data-verdict="renderer_changed" role="status"><h2>Hashes match; the PDF renderer has changed since signing</h2>
<p>Your file is the stored ${r.kind === 'certificate' ? 'completion certificate' : 'proposal'} of a signed version, and every stored fingerprint, the audit trail and
the agreed price still agree. The documents were rendered by <code>${was.map(esc).join('</code>, <code>')}</code>; this server now runs
<code>${esc(r.renderer.current)}</code>, which no longer produces the identical bytes, so the re-render checks below could not be
repeated. That is a software change on our side, not a change to the document. Ask the sender to confirm with the original renderer
if you need the full check.</p>
${fingerprint(r)}${details}${checks}</div>`;
  }
  if (r.verdict === 'verified') {
    return `<div class="card ok" data-verdict="verified" role="status"><h2>Verified: this is the signed ${r.kind === 'certificate' ? 'completion certificate' : 'proposal'}</h2>
${fingerprint(r)}${details}<h3>Re-derived from the stored record</h3>${checks}</div>`;
  }
  return `<div class="card fail" data-verdict="inconsistent" role="status"><h2>Not verified: the stored record is inconsistent</h2>
<p>Your file matches a stored document, but the record behind it no longer re-derives. Contact the sender before relying on it.</p>
${fingerprint(r)}${details}${checks}</div>`;
}

export const verifyResultPage = (r: VerifyResult) =>
  page(200, r.verdict === 'verified' ? 'Verified' : 'Not verified', `${STYLE}${INTRO}${verdictHtml(r)}<h2>Check another file</h2>${FORM}${FOOT}`);
