'use client';
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { displayCents, formatPercent, formatQuantity } from '@/lib/proposal/money';
import type { Discount, LineKind } from '@/lib/proposal/pricing';
import { priceSelection } from '@/lib/proposal/selection';
import { SIGNATURE_LIMITS } from '@/lib/proposal/signature-limits';

type Line = { id: string; description: string; kind: LineKind; unitPriceCents: number; quantityMilli: number; taxRateBps: number; discount: Discount | null; optional: boolean; selected: boolean };

// The sign form (D-32, D-37). Add-ons update the total live with the same price() the server uses; the server prices the
// posted choice again and that is what is recorded. Typing a signature works without JavaScript; drawing needs it.
export function SignForm(p: { action: string; version: number; pdfSha256: string; discount: Discount | null; lines: Line[]; consent: string }) {
  const [chosen, setChosen] = useState(() => new Set(p.lines.filter((l) => l.optional && l.selected).map((l) => l.id)));
  const [method, setMethod] = useState<'typed' | 'drawn'>('typed');
  const items = useMemo(() => p.lines.map((l) => ({ ...l, discount: l.discount ?? undefined })), [p.lines]);
  const priced = useMemo(() => priceSelection({ lines: items, ...(p.discount ? { discount: p.discount } : {}) }, [...chosen]), [items, p.discount, chosen]);
  const byId = new Map(priced.lines.map((l) => [l.id, l]));
  const toggle = (id: string) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const qty = (l: Line) => (l.kind === 'fixed' ? '' : ` × ${formatQuantity(l.quantityMilli)}`);

  return (
    <form method="post" action={p.action}>
      <input type="hidden" name="version" value={String(p.version)} />
      <input type="hidden" name="pdfSha256" value={p.pdfSha256} />
      <h2>Price</h2>
      <table>
        <thead><tr><th>Item</th><th>Amount</th><th>Discounts</th><th>Tax</th><th>Total</th></tr></thead>
        <tbody>
          {p.lines.map((l) => {
            const r = byId.get(l.id)!;
            return (
              <tr key={l.id}>
                <td>
                  {l.optional ? (
                    <label><input type="checkbox" name="addOn" value={l.id} checked={chosen.has(l.id)} onChange={() => toggle(l.id)} /> {l.description} (optional)</label>
                  ) : l.description}
                  <small> {displayCents(l.unitPriceCents)}{qty(l)}</small>
                </td>
                <td>{r.included ? displayCents(r.extendedCents) : '—'}</td>
                <td>{r.included ? displayCents(r.lineDiscountCents + r.allocatedDiscountCents) : '—'}</td>
                <td>{r.included ? displayCents(r.taxCents) : '—'}</td>
                <td>{r.included ? displayCents(r.totalCents) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr><th>Subtotal</th><td colSpan={3} /><td>{displayCents(priced.subtotalCents)}</td></tr>
          {priced.proposalDiscountCents > 0 && <tr><th>Proposal discount</th><td colSpan={3} /><td>−{displayCents(priced.proposalDiscountCents)}</td></tr>}
          {priced.taxes.map((t) => <tr key={t.taxRateBps}><th>Tax {formatPercent(t.taxRateBps)} % on {displayCents(t.taxableCents)}</th><td colSpan={3} /><td>{displayCents(t.taxCents)}</td></tr>)}
          <tr><th>Total</th><td colSpan={3} /><td><strong data-testid="total">{displayCents(priced.totalCents)}</strong></td></tr>
        </tfoot>
      </table>

      <h2>Sign</h2>
      <label>Full name <input name="signerName" required maxLength={SIGNATURE_LIMITS.name} autoComplete="name" /></label>
      <fieldset>
        <legend>Signature</legend>
        <label><input type="radio" name="method" value="typed" checked={method === 'typed'} onChange={() => setMethod('typed')} /> Type</label>{' '}
        <label><input type="radio" name="method" value="drawn" checked={method === 'drawn'} onChange={() => setMethod('drawn')} /> Draw</label>
        <br />
        {method === 'typed' ? (
          <label>Type your signature <input name="typed" required maxLength={SIGNATURE_LIMITS.name} style={{ fontStyle: 'italic', fontSize: '1.4em' }} /></label>
        ) : (
          <SignaturePad />
        )}
      </fieldset>
      <p>
        <label><input type="checkbox" name="consent" value="yes" required /> {p.consent}</label>
      </p>
      <button type="submit">Sign for {displayCents(priced.totalCents)}</button>
    </form>
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
    <div>
      <canvas ref={ref} width={W} height={H} aria-label="Draw your signature" data-testid="signature-pad"
        style={{ border: '1px solid #888', width: '100%', maxWidth: W, aspectRatio: `${W} / ${H}`, touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <input type="hidden" name="drawn" value={path} />
      <br />
      <button type="button" onClick={clear}>Clear</button>
    </div>
  );
}
