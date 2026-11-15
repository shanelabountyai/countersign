// public: the signing token is the credential (D-29); this page only reads (D-33)
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIp } from '@/core/http';
import { displayCents } from '@/lib/proposal/money';
import { consentText } from '@/lib/proposal/signature';
import { ClientRefusal, openLink, type RefusalCode } from '@/lib/proposal/signing';
import { SignForm } from './sign-form';

// The client's review page (D-30): the document from the version's frozen rows, the stored PDF, and the sign and decline
// forms. Anything that is not a live or completed link goes back to /sign/<token>, which answers 410 or 404.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review proposal', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

const ERRORS: Record<RefusalCode, string> = {
  stale: 'This page was out of date: the proposal changed or was already answered. Here is the current state.',
  consent: 'Tick the box to agree to sign electronically.',
  signature: 'Check your name and signature: type it, or draw it in the box.',
  selection: 'One of the chosen add-ons is not part of this proposal. Choose again.',
  reason: 'Keep the reason under 1,000 characters.',
  gone: 'This link no longer works.',
  not_found: 'Link not found.',
  limited: 'Too many requests. Wait a few minutes and try again.',
};

export default async function Review({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; signed?: string }> }) {
  const { token } = await params;
  const { error, signed } = await searchParams;
  const h = await headers();
  const base = `/sign/${encodeURIComponent(token)}`;
  let view;
  try {
    view = await openLink(token, { ip: clientIp(h), userAgent: h.get('user-agent') });
  } catch (e) {
    if (e instanceof ClientRefusal && e.status === 429) return <main><h1>Too many requests</h1><p>Wait a few minutes and try again.</p></main>;
    throw e;
  }
  if (view.code !== 200 || view.version.status === 'sent') redirect(base); // not opened yet (D-33), or gone
  const v = view.version;
  const message = error && error in ERRORS ? ERRORS[error as RefusalCode] : null;

  return (
    <main>
      <h1>{v.title}</h1>
      <p>Proposal from {view.orgName} for {v.clientName} · version {v.number}</p>
      {message && <p role="alert">{message}</p>}
      {view.state === 'completed' && view.signature && (
        <section>
          <h2>{signed ? 'Signed. Thank you.' : 'Signed'}</h2>
          <p>
            Signed by {view.signature.signerName} on {view.signature.signedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC for <strong>{displayCents(view.signature.totalCents)}</strong>.
          </p>
          <p>
            <a href={`${base}/pdf`}>Download the signed proposal (PDF)</a>
            {view.certificate && <> · <a href={`${base}/certificate`}>Download the completion certificate (PDF)</a></>}
          </p>
        </section>
      )}

      <p>
        <a href={`${base}/pdf`}>Proposal PDF</a> ({view.pdf.byteLength.toLocaleString('en-US')} bytes) · SHA-256 <code>{view.pdf.sha256}</code>
      </p>
      {v.sections.map((s) => (
        <section key={s.id}>
          <h2>{s.kind === 'terms' ? `Terms: ${s.renderedTitle}` : s.renderedTitle}</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{s.rendered}</p>
        </section>
      ))}

      {view.state === 'active' ? (
        <>
          <SignForm
            action={`${base}/sign`}
            version={v.number}
            pdfSha256={view.pdf.sha256}
            discount={v.discount}
            lines={v.lines.map((l) => ({ id: l.id, ...l.input }))}
            consent={consentText({ title: v.title, version: v.number, pdfSha256: view.pdf.sha256 })}
          />
          <h2>Decline</h2>
          <form method="post" action={`${base}/decline`}>
            <input type="hidden" name="version" value={String(v.number)} />
            <input type="hidden" name="pdfSha256" value={view.pdf.sha256} />
            <label>Reason (optional) <textarea name="reason" rows={2} cols={50} maxLength={1000} /></label>{' '}
            <button type="submit">Decline this proposal</button>
          </form>
          <p><small>The link is valid until {view.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.</small></p>
        </>
      ) : null}
    </main>
  );
}
