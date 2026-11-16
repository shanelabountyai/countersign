import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { price, type LineItem } from '@/lib/proposal/pricing';
import { checkSelection, defaultSelection, priceSelection, SelectionError } from '@/lib/proposal/selection';

// D-32: add-ons chosen at signing are priced by the same price(); only optional lines move.

const lines: LineItem[] = [
  { id: 'a', kind: 'fixed', unitPriceCents: 100000, taxRateBps: 825 },
  { id: 'b', kind: 'hourly', unitPriceCents: 15000, quantityMilli: 2000, optional: true, selected: true },
  { id: 'c', kind: 'per_unit', unitPriceCents: 3333, quantityMilli: 3000, taxRateBps: 825, optional: true, selected: false },
];

describe('selection', () => {
  it('starts from the author defaults', () => expect(defaultSelection(lines)).toEqual(['b']));

  it('returns ids in line order, whatever order they were posted in', () => expect(checkSelection(lines, ['c', 'b'])).toEqual(['b', 'c']));

  it.each([
    ['a required line', ['a']],
    ['an unknown id', ['zzz']],
    ['a duplicate', ['b', 'b']],
  ])('refuses %s', (_, sel) => expect(() => checkSelection(lines, sel)).toThrow(SelectionError));

  it('prices exactly the chosen add-ons', () => {
    expect(priceSelection({ lines }, []).totalCents).toBe(108250);
    expect(priceSelection({ lines }, ['b']).totalCents).toBe(108250 + 30000);
    expect(priceSelection({ lines }, ['b', 'c']).totalCents).toBe(price({ lines: lines.map((l) => (l.optional ? { ...l, selected: true } : l)) }).totalCents);
    expect(priceSelection({ lines }, ['b'])).toEqual(price({ lines }));
  });

  it('property: equals price() with those selected flags, and does not depend on line or selection order', () => {
    const arb = fc
      .array(
        fc.record({
          unitPriceCents: fc.integer({ min: 0, max: 1_000_000 }),
          quantityMilli: fc.integer({ min: 0, max: 100_000 }),
          taxRateBps: fc.constantFrom(0, 500, 825, 1000),
          optional: fc.boolean(),
          selected: fc.boolean(),
          pick: fc.boolean(),
        }),
        { maxLength: 12 },
      )
      .chain((rows) => fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows.map((_, i) => i), { minLength: rows.length, maxLength: rows.length })));
    fc.assert(
      fc.property(arb, ([rows, perm]) => {
        const ls: LineItem[] = rows.map((r, i) => ({ id: `l${i}`, kind: 'per_unit', unitPriceCents: r.unitPriceCents, quantityMilli: r.quantityMilli, taxRateBps: r.taxRateBps, optional: r.optional, selected: r.selected }));
        const sel = rows.flatMap((r, i) => (r.optional && r.pick ? [`l${i}`] : []));
        const expected = price({ lines: ls.map((l, i) => (l.optional ? { ...l, selected: rows[i]!.pick } : l)) });
        const got = priceSelection({ lines: perm.map((i) => ls[i]!) }, [...sel].reverse());
        expect(got.totalCents).toBe(expected.totalCents);
        expect(got.taxes).toEqual(expected.taxes);
        expect(Object.fromEntries(got.lines.map((l) => [l.id, l]))).toEqual(Object.fromEntries(expected.lines.map((l) => [l.id, l])));
      }),
      { numRuns: 300 },
    );
  });
});
