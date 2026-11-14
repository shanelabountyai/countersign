import { formatMoney, formatPercent, formatQuantity } from '@/lib/proposal/money';
import type { LineInput, SectionInput } from '@/lib/proposal/store';

// The editable rows shared by the template and proposal editors. Plain form controls, posted as parallel columns
// (src/lib/proposal/form.ts). Blank rows at the end add sections or lines; choosing "Remove" drops one.

const KIND_LABEL = { fixed: 'Fixed', hourly: 'Hourly', per_unit: 'Per unit' } as const;

export function SectionRows({ sections, blanks = 2 }: { sections: readonly SectionInput[]; blanks?: number }) {
  const rows: (SectionInput | null)[] = [...sections, ...Array<null>(blanks).fill(null)];
  return (
    <fieldset>
      <legend>Sections and terms</legend>
      <p>Merge fields: <code>{'{{client}}'}</code>, <code>{'{{scope}}'}</code>, <code>{'{{timeline}}'}</code>. Leave a row blank to skip it.</p>
      {rows.map((s, i) => (
        <div key={i} style={{ borderTop: '1px solid #ddd', padding: '0.5rem 0' }}>
          <label>Order <input name="sectionOrder[]" defaultValue={s ? String(i + 1) : ''} size={3} inputMode="numeric" /></label>{' '}
          <label>
            Kind{' '}
            <select name="sectionKind[]" defaultValue={s?.kind ?? 'section'}>
              <option value="section">Section</option>
              <option value="terms">Terms</option>
              {s && <option value="remove">Remove</option>}
            </select>
          </label>{' '}
          <label>Title <input name="sectionTitle[]" defaultValue={s?.title ?? ''} maxLength={200} /></label>
          <br />
          <label>Text <textarea name="sectionBody[]" defaultValue={s?.body ?? ''} rows={4} cols={80} maxLength={20000} /></label>
        </div>
      ))}
    </fieldset>
  );
}

export function LineRows({ lines, blanks = 3 }: { lines: readonly LineInput[]; blanks?: number }) {
  const rows: (LineInput | null)[] = [...lines, ...Array<null>(blanks).fill(null)];
  return (
    <fieldset>
      <legend>Line items</legend>
      <p>Amounts in dollars (12.50), quantities in units or hours (1.5), rates in percent (8.25). Optional items are add-ons the client can switch on.</p>
      <table>
        <thead>
          <tr><th>Order</th><th>Kind</th><th>Description</th><th>Unit price $</th><th>Qty</th><th>Tax %</th><th>Discount</th><th>Included</th></tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td><input name="lineOrder[]" defaultValue={l ? String(i + 1) : ''} size={3} inputMode="numeric" aria-label={`Line ${i + 1} order`} /></td>
              <td>
                <select name="lineKind[]" defaultValue={l?.kind ?? 'fixed'} aria-label={`Line ${i + 1} kind`}>
                  {Object.entries(KIND_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  {l && <option value="remove">Remove</option>}
                </select>
              </td>
              <td><input name="lineDescription[]" defaultValue={l?.description ?? ''} maxLength={500} aria-label={`Line ${i + 1} description`} /></td>
              <td><input name="linePrice[]" defaultValue={l ? formatMoney(l.unitPriceCents) : ''} size={10} inputMode="decimal" aria-label={`Line ${i + 1} unit price`} /></td>
              <td><input name="lineQty[]" defaultValue={l ? formatQuantity(l.quantityMilli) : '1'} size={6} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} /></td>
              <td><input name="lineTax[]" defaultValue={l ? formatPercent(l.taxRateBps) : '0'} size={5} inputMode="decimal" aria-label={`Line ${i + 1} tax rate`} /></td>
              <td>
                <select name="lineDiscountType[]" defaultValue={l?.discount?.type ?? 'none'} aria-label={`Line ${i + 1} discount type`}>
                  <option value="none">None</option>
                  <option value="percent">%</option>
                  <option value="fixed">$</option>
                </select>
                <input name="lineDiscount[]" defaultValue={l?.discount ? (l.discount.type === 'percent' ? formatPercent(l.discount.bps) : formatMoney(l.discount.cents)) : ''} size={7} inputMode="decimal" aria-label={`Line ${i + 1} discount`} />
              </td>
              <td>
                <select name="lineInclusion[]" defaultValue={!l?.optional ? 'required' : l.selected ? 'optional_on' : 'optional_off'} aria-label={`Line ${i + 1} included`}>
                  <option value="required">Always</option>
                  <option value="optional_off">Optional, off</option>
                  <option value="optional_on">Optional, on</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}
