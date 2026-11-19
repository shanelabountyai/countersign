// public: the signing token is the credential (D-29); this page only reads (D-33)
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIp } from '@/core/http';
import { displayCents } from '@/lib/proposal/money';
import { priceVersionSelection } from '@/lib/proposal/certificate';
import { consentText } from '@/lib/proposal/signature';
import { ClientRefusal, DECLINE_REASON_MAX, openLink, type RefusalCode } from '@/lib/proposal/signing';
import { OrgMark } from '@/lib/ui/brand-mark';
import { accentVars, logoSrc } from '@/lib/ui/brand';
import { browserLabel, day, dayTime, eventLabel, monogram, shortHash } from '@/lib/ui/format';
import { Investment, type ClientLine } from './investment';
import { SignForm } from './sign-form';

// The client's review page (D-30): the document from the version's frozen rows, the stored PDF, and the sign and decline
// forms (docs/design/Main.dc.html, PhoneSign.dc.html). Once signed it shows the completion record
// (docs/design/Certificate.dc.html). Anything that is not a live or completed link goes back to /sign/<token>, which
// answers 410 or 404. The document hash is shown on the certificate only (owner call, HANDOFF.md).
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

const DEMO_NOTE = 'Demo: not a legally vetted e-signature product';

export default async function Review({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; signed?: string }> }) {
  const { token } = await params;
  const { error, signed } = await searchParams;
  const h = await headers();
  const base = `/sign/${encodeURIComponent(token)}`;
  let view;
  try {
    view = await openLink(token, { ip: clientIp(h), userAgent: h.get('user-agent') });
  } catch (e) {
    if (e instanceof ClientRefusal && e.status === 429) {
      return (
        <div className="cs-client">
          <main className="cs-client__main cs-client__main--narrow">
            <section className="cs-notice">
              <span className="cs-pill cs-pill--lg cs-pill--warn" style={{ alignSelf: 'flex-start' }}><span aria-hidden="true">⏸</span>Too many requests</span>
              <h1>Too many requests</h1>
              <p>Wait a few minutes and try again.</p>
            </section>
          </main>
        </div>
      );
    }
    throw e;
  }
  if (view.code !== 200 || view.version.status === 'sent') redirect(base); // not opened yet (D-33), or gone
  const v = view.version;
  const message = error && error in ERRORS ? ERRORS[error as RefusalCode] : null;
  const mono = monogram(view.orgName);
  const lines: ClientLine[] = v.lines.map((l) => ({ id: l.id, ...l.input }));
  const body = v.sections.filter((s) => s.kind !== 'terms');
  const terms = v.sections.filter((s) => s.kind === 'terms');

  const docHeadAt = (top: boolean) => (
    <>
      <header className="cs-doc__head">
        <OrgMark name={view.orgName} mono={mono} logo={logoSrc(view.brand)} large />
        <div className="cs-doc__ref">Proposal · Version {v.number}</div>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="cs-eyebrow">Prepared for {v.clientName}</span>
        {top ? <h1>{v.title}</h1> : <h2 style={{ fontSize: 30 }}>{v.title}</h2>}
      </div>
      {body.map((s) => (
        <section key={s.id}>
          {s.renderedTitle && (top ? <h2>{s.renderedTitle}</h2> : <h3 style={{ margin: 0, fontSize: 22 }}>{s.renderedTitle}</h3>)}
          <p className="cs-prose">{s.rendered}</p>
        </section>
      ))}
    </>
  );
  const docTerms = terms.map((s) => (
    <section key={s.id}>
      <h2>{!s.renderedTitle || /^terms\b/i.test(s.renderedTitle) ? s.renderedTitle || 'Terms' : `Terms: ${s.renderedTitle}`}</h2>
      <p className="cs-prose">{s.rendered}</p>
    </section>
  ));

  const brandStyle = (view.brand.accentHex ? accentVars(view.brand.accentHex) : undefined) as React.CSSProperties | undefined;

  if (view.state === 'completed' && view.signature) {
    const sig = view.signature;
    const chosen = new Set(sig.selectedLineIds);
    const priced = priceVersionSelection(v, sig.selectedLineIds);
    const addOns = v.lines.filter((l) => l.optional);
    const chosenNames = addOns.filter((l) => chosen.has(l.id)).map((l) => l.description);
    return (
      <div className="cs-client" style={brandStyle}>
        <header className="cs-topnote"><div><span>Signed with <strong>{view.orgName}</strong> · Version {v.number}</span><span>{DEMO_NOTE}</span></div></header>
        <main className="cs-client__main">
          <section aria-labelledby="cs-done-h" className="cs-done">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="cs-done__mark" aria-hidden="true">✓</span>
              <div>
                <h1 id="cs-done-h">{signed ? 'Signed. Thank you.' : 'Signed'}</h1>
                <p>Signed by {sig.signerName} on {dayTime(sig.signedAt)} for <strong>{displayCents(sig.totalCents)}</strong>. {view.orgName} can see it in Countersign.</p>
              </div>
            </div>
            <div className="cs-actions">
              <a className="cs-btn cs-btn--blue" href={`${base}/pdf`}>Proposal PDF, as sent</a>
              {view.certificate && <a className="cs-btn cs-btn--blue-ghost" href={`${base}/certificate`}>Completion certificate PDF (agreed total)</a>}
            </div>
          </section>

          <article aria-labelledby="cs-cert-h" className="cs-cert">
            <header className="cs-cert__head">
              <h2 id="cs-cert-h">Certificate of completion</h2>
              <span className="cs-meta" style={{ alignSelf: 'flex-end', fontSize: 14 }}>Version {v.number}</span>
            </header>
            <dl className="cs-facts">
              <div><dt>Document</dt><dd>{v.title}</dd></div>
              <div><dt>Sender</dt><dd>{view.certificate?.orgName ?? view.orgName} (org name as it stood at signing)</dd></div>
              <div><dt>Signer</dt><dd>{sig.signerName} · {sig.method === 'drawn' ? 'drawn signature' : 'typed signature'}</dd></div>
              <div><dt>Total agreed</dt><dd>{displayCents(sig.totalCents)}{addOns.length > 0 && (chosenNames.length ? ` (includes ${chosenNames.join(', ')})` : ' (no add-ons chosen)')}</dd></div>
              <div className="cs-wide"><dt>Document fingerprint (SHA-256 of the signed PDF)</dt><dd className="cs-fp">{view.pdf.sha256}</dd></div>
              {view.certificate?.rendererVersion && <div className="cs-wide"><dt>PDF renderer</dt><dd>{view.certificate.rendererVersion}, stored with this version</dd></div>}
            </dl>
            <section aria-labelledby="cs-ev" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 id="cs-ev">Event log</h3>
              <div className="cs-log" tabIndex={0} role="region" aria-label="Event log table, scrolls sideways">
                <table>
                  <caption className="cs-vh">From sending to signing; the certificate PDF also lists the draft history.</caption>
                  <thead><tr><th scope="col">Time (UTC)</th><th scope="col">Event</th><th scope="col">Hashed IP</th><th scope="col">Browser</th></tr></thead>
                  <tbody>
                    {view.trail.filter((e) => e.action !== 'proposal.version.created' && e.action !== 'proposal.version.edited').map((e, i) => {
                      const sender = !e.ipHash && !e.userAgent;
                      return (
                        <tr key={i}>
                          <td>{dayTime(new Date(e.at)).replace(' UTC', '')}</td>
                          <td>{eventLabel(e.action)}{e.action === 'proposal.version.signed' ? ` (${sig.method})` : ''}</td>
                          <td className="cs-ip">{sender ? '—' : shortHash(e.ipHash ?? null)}</td>
                          <td>{sender ? 'Sender' : browserLabel(e.userAgent ?? null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--cs-muted)' }}>
              Anyone can check that a PDF matches this signed version at <a href="/verify">the verify page</a>: any changed byte will not match. The certificate PDF lists the full hashes and user agents. This is a demo, not a legally vetted e-signature product.
            </p>
          </article>

          <article aria-label="The signed proposal" className="cs-doc">
            {docHeadAt(false)}
            <Investment lines={lines} priced={priced} chosen={chosen} />
            {docTerms}
          </article>
        </main>
      </div>
    );
  }

  return (
    <div className="cs-client" style={brandStyle}>
      <header className="cs-topnote"><div><span>Sent to you by <strong>{view.orgName}</strong> · Version {v.number} · Link valid until {day(view.expiresAt)}</span><span>{DEMO_NOTE}</span></div></header>
      <main className="cs-client__main">
        <SignForm
          action={`${base}/sign`}
          declineAction={`${base}/decline`}
          version={v.number}
          pdfSha256={view.pdf.sha256}
          discount={v.discount}
          lines={lines}
          consent={consentText({ title: v.title, version: v.number, pdfSha256: view.pdf.sha256 })}
          orgName={view.orgName}
          before={docHeadAt(true)}
          after={<>{docTerms}<p style={{ margin: 0, fontFamily: 'var(--cs-sans)', fontSize: 15 }}><a className="cs-btn" href={`${base}/pdf`}>Download this proposal (PDF)</a></p></>}
          expires={dayTime(view.expiresAt)}
          error={message}
          reasonMax={DECLINE_REASON_MAX}
        />
      </main>
    </div>
  );
}
