'use client';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { displayCents } from '@/lib/proposal/money';
import type { Discount } from '@/lib/proposal/pricing';
import { priceSelection } from '@/lib/proposal/selection';
import { SIGNATURE_LIMITS } from '@/lib/proposal/signature-limits';
import { Investment, type ClientLine } from './investment';

// The client document and sign panel (D-32, D-37; docs/design/Main.dc.html, PhoneSign.dc.html, DeclineConfirm.dc.html).
// Add-ons update the total live with the same price() the server uses; the server prices the posted choice again and
// that is what is recorded. Typing a signature works without JavaScript; drawing needs it. Decline opens a confirmation
// in place (a <details>, so it also works without JavaScript); nothing is recorded until it is confirmed.
const FORM_ID = 'cs-sign';

export function SignForm(p: {
  action: string;
  declineAction: string;
  version: number;
  pdfSha256: string;
  discount: Discount | null;
  lines: ClientLine[];
  /** The exact consent wording stored with the signature (D-37). */
  consent: string;
  orgName: string;
  /** Document parts around the Investment block (server-rendered). */
  before: ReactNode;
  after: ReactNode;
  expires: string;
  error: string | null;
  reasonMax: number;
}) {
  const [chosen, setChosen] = useState(() => new Set(p.lines.filter((l) => l.optional && l.selected).map((l) => l.id)));
  const [method, setMethod] = useState<'typed' | 'drawn'>('typed');
  const nameRef = useRef<HTMLInputElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const declineRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const [drawnEmpty, setDrawnEmpty] = useState(false);
  // A refused sign comes back as a fresh page load; an alert present at load is not announced, so focus it (A11Y-5).
  useEffect(() => { if (p.error) alertRef.current?.focus(); }, [p.error]);
  const items = useMemo(() => p.lines.map((l) => ({ ...l, discount: l.discount ?? undefined })), [p.lines]);
  const priced = useMemo(() => priceSelection({ lines: items, ...(p.discount ? { discount: p.discount } : {}) }, [...chosen]), [items, p.discount, chosen]);
  const toggle = (id: string) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const total = displayCents(priced.totalCents);

  return (
    <>
      <article className="cs-doc">
        {p.before}
        <Investment lines={p.lines} priced={priced} chosen={chosen} onToggle={toggle} form={FORM_ID} />
        {p.after}
      </article>

      <section aria-labelledby="cs-sign-h" className="cs-panel">
        <h2 id="cs-sign-h">Sign this proposal</h2>
        {(p.error || drawnEmpty) && <div role="alert" className="cs-alert" tabIndex={-1} ref={alertRef}><span aria-hidden="true">✗</span><p>{drawnEmpty ? 'Draw your signature in the box, or type it instead.' : p.error}</p></div>}
        <form id={FORM_ID} method="post" action={p.action} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
          onSubmit={(e) => {
            if (typedRef.current && nameRef.current) typedRef.current.value = nameRef.current.value;
            const drawn = e.currentTarget.elements.namedItem('drawn');
            if (method === 'drawn' && drawn instanceof HTMLInputElement && !drawn.value) { // checked here so nothing on the page is lost (UX-4)
              e.preventDefault();
              setDrawnEmpty(true);
              requestAnimationFrame(() => alertRef.current?.focus());
            }
          }}>
          <input type="hidden" name="version" value={String(p.version)} />
          <input type="hidden" name="pdfSha256" value={p.pdfSha256} />
          <input type="hidden" name="method" value={method} />
          <div className="cs-consent">
            <label className="cs-check">
              <input type="checkbox" name="consent" value="yes" required aria-describedby="cs-consent-full" />
              <span>I agree to use electronic records and signatures for this proposal, and I can ask for a paper copy.</span>
            </label>
            <details>
              <summary>Read the exact consent wording</summary>
              <blockquote id="cs-consent-full">{p.consent}</blockquote>
            </details>
          </div>
          <div className="cs-signrow">
            <div className="cs-namefield">
              <label htmlFor="cs-name">{method === 'typed' ? 'Type your full name to sign' : 'Your full name'}</label>
              {/* Without JavaScript this field is copied into nothing, so a separate typed-signature field is offered. */}
              <noscript><input name="typed" aria-label="Type your signature" className="cs-sig" maxLength={SIGNATURE_LIMITS.name} required /></noscript>
              <input id="cs-name" name="signerName" required maxLength={SIGNATURE_LIMITS.name} autoComplete="name" ref={nameRef}
                className={method === 'typed' ? 'cs-sig' : 'cs-input'} style={method === 'typed' ? undefined : { minHeight: 52, fontSize: 18 }} />
              {/* The typed signature is the name as submitted (D-55): copied at submit, so text typed before hydration counts. */}
              {method === 'typed' && <input type="hidden" name="typed" ref={typedRef} defaultValue="" />}
              {method === 'typed' ? (
                <span className="cs-hint">Your typed name is your signature. Or <button type="button" className="cs-linkbtn" onClick={() => setMethod('drawn')}>draw your signature instead</button></span>
              ) : (
                <span className="cs-hint">Draw below. Or <button type="button" className="cs-linkbtn" onClick={() => { setMethod('typed'); setDrawnEmpty(false); }}>type your signature instead</button></span>
              )}
            </div>
          </div>
          {method === 'drawn' && <SignaturePad />}
        </form>
        <span className="cs-vh" aria-live="polite">Total {total}</span>
        <div className="cs-btnrow">
          <button type="submit" form={FORM_ID} className="cs-btn cs-btn--primary cs-btn--lg">Sign for {total}</button>
          <details className="cs-decline" ref={declineRef}>
            <summary className="cs-btn cs-btn--lg" ref={summaryRef}>Decline</summary>
            <div role="group" aria-labelledby="cs-decline-h" className="cs-confirm">
              <h3 id="cs-decline-h"><span aria-hidden="true" style={{ color: 'var(--cs-red-ink)' }}>✗</span>Decline this proposal?</h3>
              <p>Declining is final for this version: the link stops working and nothing can be signed on it. {p.orgName} can send you a new version.</p>
              <form method="post" action={p.declineAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input type="hidden" name="version" value={String(p.version)} />
                <input type="hidden" name="pdfSha256" value={p.pdfSha256} />
                <label className="cs-label" style={{ fontSize: 15 }}>
                  Reason for {p.orgName} (optional)
                  <textarea name="reason" rows={3} maxLength={p.reasonMax} className="cs-input" aria-describedby="cs-reason-hint" />
                </label>
                <span id="cs-reason-hint" className="cs-hint">Up to {p.reasonMax.toLocaleString('en-US')} characters. Kept in the proposal&apos;s audit trail.</span>
                <div className="cs-actions">
                  <button type="submit" className="cs-btn cs-btn--danger">Decline this proposal</button>
                  <button type="button" className="cs-btn" onClick={() => { if (declineRef.current) declineRef.current.open = false; summaryRef.current?.focus(); }}>Keep reviewing</button>
                </div>
              </form>
            </div>
          </details>
        </div>
        <p className="cs-foot">Signing records the time, a hashed IP address and your browser, and locks this exact version. The link is valid until {p.expires}. This is a demo, not a legally vetted e-signature product.</p>
      </section>
    </>
  );
}

/** Strokes as an integer SVG path in the 600×200 pad (D-37), written to the hidden "drawn" field. */
function SignaturePad() {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ x: number; y: number }[][]>([]);
  const drawing = useRef(false);
  const [path, setPath] = useState('');
  const { width: W, height: H } = SIGNATURE_LIMITS;

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
    return { x: clamp(((e.clientX - r.left) / r.width) * W, W), y: clamp(((e.clientY - r.top) / r.height) * H, H) };
  };
  const serialize = () => strokes.current.map((s) => s.map((pt, i) => `${i ? 'L' : 'M'}${pt.x} ${pt.y}`).join(' ')).join(' ');
  const redraw = () => {
    const c = ref.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, W, H);
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.strokeStyle = '#16181D';
    c.beginPath();
    for (const s of strokes.current) s.forEach((pt, i) => (i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y)));
    c.stroke();
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokes.current.push([point(e)]);
    redraw();
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const s = strokes.current.at(-1)!;
    const pt = point(e);
    const last = s.at(-1)!;
    if (Math.abs(pt.x - last.x) + Math.abs(pt.y - last.y) < 3) return; // thin out the points
    if (serialize().length > SIGNATURE_LIMITS.path - 20) return; // stay under the server's limit
    s.push(pt);
    redraw();
  };
  const up = () => {
    drawing.current = false;
    setPath(serialize());
  };
  const clear = () => {
    strokes.current = [];
    redraw();
    setPath('');
  };
  return (
    <div className="cs-pad">
      <canvas ref={ref} width={W} height={H} role="img" aria-label="Signature drawing area. Draw with a mouse, finger or pen; or type your signature instead." data-testid="signature-pad"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <input type="hidden" name="drawn" value={path} />
      <div className="cs-actions">
        <button type="button" className="cs-btn cs-btn--sm" onClick={clear}>Clear drawing</button>
        <span className="cs-hint" aria-live="polite">{path ? 'Signature drawn.' : 'Nothing drawn yet.'}</span>
      </div>
    </div>
  );
}
