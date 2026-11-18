import { formatMoney, formatPercent, formatQuantity } from '@/lib/proposal/money';
import type { LineInput, SectionInput } from '@/lib/proposal/store';

// The editable rows shared by the template and proposal editors (docs/design/TemplateEditor.dc.html). Plain form
// controls, posted as parallel columns (src/lib/proposal/form.ts). Blank rows at the end add sections or lines;
// choosing "Remove" drops one.

const KIND_LABEL = { fixed: 'Fixed fee', hourly: 'Hourly', per_unit: 'Per unit' } as const;

export function SectionRows({ sections, blanks = 2 }: { sections: readonly SectionInput[]; blanks?: number }) {
  const rows: (SectionInput | null)[] = [...sections, ...Array<null>(blanks).fill(null)];
  return (
    <section aria-labelledby="cs-sections" className="cs-card">
      <h2 id="cs-sections">Sections and terms</h2>
      <p className="cs-hint" style={{ margin: 0, fontSize: 14 }}>
        Merge fields: <code className="cs-codebox">{'{{client}}'}</code> <code className="cs-codebox">{'{{scope}}'}</code>{' '}
        <code className="cs-codebox">{'{{timeline}}'}</code>. Any other <code className="cs-codebox">{'{{…}}'}</code> is refused on save. Leave a row blank to skip it.
      </p>
      <div className="cs-rows">
        {rows.map((s, i) => (
          <fieldset key={i} className="cs-secrow">
            <legend>{s ? `Section ${i + 1}` : 'New section (optional)'}</legend>
            <label className="cs-label">Order <input name="sectionOrder[]" defaultValue={s ? String(i + 1) : ''} inputMode="numeric" className="cs-input" /></label>
            <label className="cs-label">
              Kind
              <select name="sectionKind[]" defaultValue={s?.kind ?? 'section'} className="cs-input">
                <option value="section">Section</option>
                <option value="terms">Terms</option>
                {s && <option value="remove">Remove</option>}
              </select>
            </label>
            <label className="cs-label cs-title">Title <input name="sectionTitle[]" defaultValue={s?.title ?? ''} maxLength={200} className="cs-input" /></label>
            <label className="cs-label cs-wide">Text <textarea name="sectionBody[]" defaultValue={s?.body ?? ''} rows={4} maxLength={20000} className="cs-input" /></label>
          </fieldset>
        ))}
      </div>
    </section>
  );
}

export function LineRows({ lines, blanks = 3 }: { lines: readonly LineInput[]; blanks?: number }) {
  const rows: (LineInput | null)[] = [...lines, ...Array<null>(blanks).fill(null)];
  return (
    <section aria-labelledby="cs-lines" className="cs-card cs-card--flush">
      <div className="cs-card__head" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <h2 id="cs-lines">Line items</h2>
        <span className="cs-hint" style={{ fontSize: 14, color: 'var(--cs-ink-2)' }}>
          Amounts in dollars (12.50), quantities in units or hours (1.5), rates in percent (8.25). Optional items are add-ons the client can switch on. Blank rows add items.
        </span>
      </div>
      <div className="cs-scroll">
        <table className="cs-table cs-lines" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th scope="col">Order</th><th scope="col">Pricing</th><th scope="col">Item</th><th scope="col">Unit price $</th><th scope="col">Qty</th><th scope="col">Tax %</th><th scope="col">Discount</th><th scope="col">Included</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i}>
                <td><input name="lineOrder[]" defaultValue={l ? String(i + 1) : ''} inputMode="numeric" aria-label={`Line ${i + 1} order`} className="cs-input" style={{ width: 56 }} /></td>
                <td>
                  <select name="lineKind[]" defaultValue={l?.kind ?? 'fixed'} aria-label={`Line ${i + 1} kind`} className="cs-input" style={{ width: 'auto' }}>
                    {Object.entries(KIND_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    {l && <option value="remove">Remove</option>}
                  </select>
                </td>
                <td><input name="lineDescription[]" defaultValue={l?.description ?? ''} maxLength={500} aria-label={`Line ${i + 1} description`} className="cs-input" style={{ minWidth: 200 }} /></td>
                <td><input name="linePrice[]" defaultValue={l ? formatMoney(l.unitPriceCents) : ''} inputMode="decimal" aria-label={`Line ${i + 1} unit price`} className="cs-input cs-num" style={{ width: 110 }} /></td>
                <td><input name="lineQty[]" defaultValue={l ? formatQuantity(l.quantityMilli) : '1'} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} className="cs-input cs-num" style={{ width: 72 }} /></td>
                <td><input name="lineTax[]" defaultValue={l ? formatPercent(l.taxRateBps) : '0'} inputMode="decimal" aria-label={`Line ${i + 1} tax rate`} className="cs-input cs-num" style={{ width: 64 }} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <select name="lineDiscountType[]" defaultValue={l?.discount?.type ?? 'none'} aria-label={`Line ${i + 1} discount type`} className="cs-input" style={{ width: 'auto' }}>
                    <option value="none">None</option>
                    <option value="percent">%</option>
                    <option value="fixed">$</option>
                  </select>{' '}
                  <input name="lineDiscount[]" defaultValue={l?.discount ? (l.discount.type === 'percent' ? formatPercent(l.discount.bps) : formatMoney(l.discount.cents)) : ''} inputMode="decimal" aria-label={`Line ${i + 1} discount`} className="cs-input" style={{ width: 72 }} />
                </td>
                <td>
                  <select name="lineInclusion[]" defaultValue={!l?.optional ? 'required' : l.selected ? 'optional_on' : 'optional_off'} aria-label={`Line ${i + 1} included`} className="cs-input" style={{ width: 'auto' }}>
                    <option value="required">Always</option>
                    <option value="optional_off">Optional, off</option>
                    <option value="optional_on">Optional, on</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
