import { describe, expect, it } from 'vitest';
import { parseDiscount, parseLines, parseSections, type LineColumns, type SectionColumns } from '@/lib/proposal/form';
import { InputError } from '@/lib/proposal/money';

// The editor's parallel columns → store inputs (D-23 exact amounts; blank and "remove" rows dropped; stable order).

const sections = (rows: [kind: string, title: string, body: string, order?: string][]): SectionColumns => ({
  sectionKind: rows.map((r) => r[0]), sectionTitle: rows.map((r) => r[1]), sectionBody: rows.map((r) => r[2]), sectionOrder: rows.map((r) => r[3] ?? ''),
});

type Row = Partial<Record<keyof LineColumns, string>>;
const lines = (rows: Row[]): LineColumns => {
  const d: Required<Row> = { lineKind: 'fixed', lineDescription: 'Work', linePrice: '100', lineQty: '1', lineTax: '0', lineDiscountType: 'none', lineDiscount: '', lineInclusion: 'required', lineOrder: '' };
  const keys = Object.keys(d) as (keyof LineColumns)[];
  return Object.fromEntries(keys.map((k) => [k, rows.map((r) => r[k] ?? d[k])])) as LineColumns;
};

describe('parseSections', () => {
  it('drops blank and removed rows, normalizes CRLF, keeps order', () => {
    expect(parseSections(sections([['section', ' Scope ', 'a\r\nb'], ['terms', '', '  '], ['remove', 'Gone', 'x'], ['terms', 'Terms', 'Net 30']]))).toEqual([
      { kind: 'section', title: 'Scope', body: 'a\nb' },
      { kind: 'terms', title: 'Terms', body: 'Net 30' },
    ]);
  });

  it('sorts by the order numbers, stable, unnumbered rows last', () => {
    const out = parseSections(sections([['section', 'A', '', ''], ['section', 'B', '', '2'], ['section', 'C', '', '1'], ['section', 'D', '', '2']]));
    expect(out.map((s) => s.title)).toEqual(['C', 'B', 'D', 'A']);
  });

  it('reads only its own columns, so the whole parsed form can be passed (other fields of any length)', () => {
    expect(parseSections({ ...sections([['section', 'A', 'b']]), name: 'a long template name', ...lines([{}, {}]) } as SectionColumns)).toHaveLength(1);
    expect(parseLines({ ...lines([{}]), title: 'xyz', ...sections([['section', 'A', 'b'], ['terms', 'B', 'c']]) } as LineColumns)).toHaveLength(1);
  });

  it('refuses unknown kinds, bad order numbers and ragged columns', () => {
    expect(() => parseSections(sections([['x', 'A', 'b']]))).toThrow(InputError);
    expect(() => parseSections(sections([['section', 'A', 'b', '1.5']]))).toThrow(/whole number/);
    expect(() => parseSections({ ...sections([['section', 'A', 'b']]), sectionBody: [] })).toThrow(/incomplete/);
  });
});

describe('parseLines', () => {
  it('reads every column exactly', () => {
    expect(parseLines(lines([{ lineKind: 'hourly', lineDescription: ' Dev ', linePrice: '150', lineQty: '40.5', lineTax: '8.25', lineDiscountType: 'percent', lineDiscount: '12.5', lineInclusion: 'optional_on' }]))).toEqual([
      { kind: 'hourly', description: 'Dev', unitPriceCents: 15000, quantityMilli: 40500, taxRateBps: 825, discount: { type: 'percent', bps: 1250 }, optional: true, selected: true },
    ]);
  });

  it('fixed lines are always quantity 1; blank qty and tax default to 1 and 0', () => {
    expect(parseLines(lines([{ lineQty: '7' }, { lineKind: 'per_unit', lineQty: '', lineTax: '' }])).map((l) => [l.quantityMilli, l.taxRateBps])).toEqual([[1000, 0], [1000, 0]]);
  });

  it('inclusion: required, optional off, optional on', () => {
    expect(parseLines(lines([{}, { lineInclusion: 'optional_off' }, { lineInclusion: 'optional_on' }])).map((l) => [l.optional, l.selected])).toEqual([[false, false], [true, false], [true, true]]);
  });

  it('drops blank and removed rows', () => {
    expect(parseLines(lines([{ lineDescription: '', linePrice: '' }, { lineKind: 'remove', linePrice: 'garbage' }, { lineDescription: 'Kept' }])).map((l) => l.description)).toEqual(['Kept']);
  });

  it('names the row in every refusal and never rounds', () => {
    expect(() => parseLines(lines([{}, { linePrice: '12.345' }]))).toThrow(/^Line 2: The amount has more than 2 decimal places/);
    expect(() => parseLines(lines([{ lineTax: '101' }]))).toThrow(/^Line 1: The tax rate is too large/);
    expect(() => parseLines(lines([{ lineDiscountType: 'fixed', lineDiscount: 'x' }]))).toThrow(/^Line 1 discount:/);
    expect(() => parseLines(lines([{ lineInclusion: 'maybe' }]))).toThrow(/^Line 1:/);
    expect(() => parseLines(lines([{ lineDescription: 'No price', linePrice: '' }]))).toThrow(/^Line 1:/);
  });
});

describe('parseDiscount', () => {
  it.each([
    ['none', 'ignored', null],
    ['percent', '10', { type: 'percent', bps: 1000 }],
    ['fixed', '1,000.50', { type: 'fixed', cents: 100050 }],
  ] as const)('%s %j', (t, v, out) => expect(parseDiscount(t, v, 'Proposal')).toEqual(out));
  it('refuses an unknown type', () => expect(() => parseDiscount('bogo', '1', 'Proposal')).toThrow(/Proposal discount/));
});
