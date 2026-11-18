import { displayCents, formatPercent, formatQuantity } from '@/lib/proposal/money';
import type { Discount, LineKind, PricingResult } from '@/lib/proposal/pricing';

// The "Investment" block of the client document (Main.dc.html, PhoneSign.dc.html): rendered by the live sign form and,
// read-only, by the signed page. Presentation only: every number comes from the pricing module's result.

export type ClientLine = { id: string; description: string; kind: LineKind; unitPriceCents: number; quantityMilli: number; taxRateBps: number; discount: Discount | null; optional: boolean; selected: boolean };

const qtyText = (l: ClientLine) => (l.kind === 'fixed' ? '1' : `${formatQuantity(l.quantityMilli)}${l.kind === 'hourly' ? ' h' : ''}`);
const KIND = { fixed: 'Fixed fee', hourly: 'Hourly', per_unit: 'Per unit' } as const;

export function Investment({ lines, priced, chosen, onToggle, form }: {
  lines: readonly ClientLine[];
  priced: PricingResult;
  /** Chosen add-on ids. */
  chosen: ReadonlySet<string>;
  /** Present on the live page: add-ons become checkboxes posted with the sign form. */
  onToggle?: (id: string) => void;
  /** The id of the sign form the add-on checkboxes belong to (they sit outside it, in the document). */
  form?: string;
}) {
  const byId = new Map(priced.lines.map((l) => [l.id, l]));
  const discount = priced.lineDiscountCents + priced.proposalDiscountCents;
  return (
    <section aria-labelledby="cs-inv" className="cs-invest" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 id="cs-inv" style={{ fontFamily: 'var(--cs-serif)' }}>Investment</h2>
      <table>
        <thead><tr><th scope="col">Item</th><th scope="col" className="cs-num cs-qty">Qty</th><th scope="col" className="cs-num cs-rate">Rate</th><th scope="col" className="cs-num">Amount</th></tr></thead>
        <tbody>
          {lines.map((l) => {
            const r = byId.get(l.id)!;
            const on = chosen.has(l.id);
            const sub = `${l.kind === 'fixed' ? `${KIND.fixed} · ${displayCents(l.unitPriceCents)}` : `${qtyText(l)} × ${displayCents(l.unitPriceCents)}`}${l.taxRateBps > 0 ? ` · taxable ${formatPercent(l.taxRateBps)}%` : ''}`;
            const name = (
              <span>
                {l.optional && <strong style={{ fontWeight: 600 }}>Optional: </strong>}
                {l.description}
                {!l.optional && l.taxRateBps > 0 && <span className="cs-out"> (taxable, {formatPercent(l.taxRateBps)}%)</span>}
                <span className="cs-sub">{sub}</span>
              </span>
            );
            return (
              <tr key={l.id} className={l.optional ? `cs-addon${on ? ' cs-on' : ''}` : undefined}>
                <td>
                  {l.optional && onToggle ? (
                    <label>
                      <input type="checkbox" name="addOn" value={l.id} form={form} checked={on} onChange={() => onToggle(l.id)} />
                      {name}
                    </label>
                  ) : name}
                </td>
                <td className="cs-num cs-qty">{qtyText(l)}</td>
                <td className="cs-num cs-rate">{displayCents(l.unitPriceCents)}</td>
                <td className={`cs-num${r.included ? '' : ' cs-out'}`}>{r.included ? displayCents(r.extendedCents) : 'Not included'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cs-totals-wrap">
      <dl className="cs-totals">
        <div><dt>Subtotal</dt><dd>{displayCents(priced.grossCents)}</dd></div>
        {discount > 0 && <div className="cs-soft"><dt>Discounts</dt><dd>−{displayCents(discount)}</dd></div>}
        {priced.taxes.map((t) => (
          <div key={t.taxRateBps} className="cs-soft"><dt>Tax {formatPercent(t.taxRateBps)}% on {displayCents(t.taxableCents)} taxable</dt><dd>{displayCents(t.taxCents)}</dd></div>
        ))}
        <div className="cs-grand"><dt>Total</dt><dd data-testid="total">{displayCents(priced.totalCents)}</dd></div>
      </dl>
      {priced.taxes.length > 0 && <span className="cs-note">Tax is calculated once on the taxable subtotal for each rate, then rounded to the cent.</span>}
      </div>
    </section>
  );
}
