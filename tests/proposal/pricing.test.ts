import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate, divRoundHalfUp, price, PricingError, type Discount, type LineItem, type PricingResult } from '@/lib/proposal/pricing';

// CS-01: pricing totals are exact in integer cents and stable under line reordering.

const line = (id: string, over: Partial<LineItem> = {}): LineItem => ({ id, kind: 'fixed', unitPriceCents: 10000, ...over });
const byId = (r: PricingResult) => Object.fromEntries(r.lines.map((l) => [l.id, l]));

describe('divRoundHalfUp', () => {
  it.each([
    [0n, 1000n, 0n],
    [499n, 1000n, 0n],
    [500n, 1000n, 1n], // exactly half rounds up
    [501n, 1000n, 1n],
    [1499n, 1000n, 1n],
    [1500n, 1000n, 2n],
    [2500n, 1000n, 3n], // half up, not half even
    [7n, 2n, 4n],
  ])('%s / %s = %s', (a, b, q) => expect(divRoundHalfUp(a, b)).toBe(q));
});

describe('price: table', () => {
  it.each<[string, LineItem[], Discount | undefined, Partial<PricingResult>]>([
    ['empty proposal', [], undefined, { totalCents: 0, subtotalCents: 0, taxCents: 0 }],
    ['one fixed line', [line('a')], undefined, { grossCents: 10000, totalCents: 10000 }],
    ['fixed ignores quantity', [line('a', { quantityMilli: 5000 })], undefined, { totalCents: 10000 }],
    ['hourly 1.5 h at $150', [line('a', { kind: 'hourly', unitPriceCents: 15000, quantityMilli: 1500 })], undefined, { totalCents: 22500 }],
    // 0.001 units × 1000 cents = 1 cent; 3.333 units × 1 cent = 3.333 → 3 cents
    ['per-unit fraction rounds half up', [line('a', { kind: 'per_unit', unitPriceCents: 1000, quantityMilli: 1 }), line('b', { kind: 'per_unit', unitPriceCents: 1, quantityMilli: 3333 })], undefined, { grossCents: 4, totalCents: 4 }],
    ['half-cent per-unit rounds up', [line('a', { kind: 'per_unit', unitPriceCents: 1, quantityMilli: 500 })], undefined, { totalCents: 1 }],
    ['tax 8.25 % on $100', [line('a', { taxRateBps: 825 })], undefined, { taxCents: 825, totalCents: 10825 }],
    ['tax rounds half up per line', [line('a', { unitPriceCents: 100, taxRateBps: 50 }), line('b', { unitPriceCents: 100, taxRateBps: 50 })], undefined, { taxCents: 2, totalCents: 202 }],
    ['tax is the sum of line taxes, not tax on the total', [line('a', { unitPriceCents: 10, taxRateBps: 500 }), line('b', { unitPriceCents: 10, taxRateBps: 500 })], undefined, { taxCents: 2, totalCents: 22 }],
    ['line percent discount 10 %', [line('a', { discount: { type: 'percent', bps: 1000 } })], undefined, { lineDiscountCents: 1000, totalCents: 9000 }],
    ['line fixed discount capped at the line', [line('a', { discount: { type: 'fixed', cents: 50000 } })], undefined, { lineDiscountCents: 10000, totalCents: 0 }],
    ['proposal fixed discount capped at subtotal', [line('a')], { type: 'fixed', cents: 99999 }, { proposalDiscountCents: 10000, totalCents: 0 }],
    ['proposal 100 % discount', [line('a', { taxRateBps: 1000 }), line('b')], { type: 'percent', bps: 10000 }, { totalCents: 0, taxCents: 0 }],
    ['unselected optional line counts for nothing', [line('a'), line('b', { optional: true })], undefined, { totalCents: 10000 }],
    ['selected optional line counts', [line('a'), line('b', { optional: true, selected: true })], undefined, { totalCents: 20000 }],
    ['selected is ignored on a required line', [line('a', { selected: false })], undefined, { totalCents: 10000 }],
    // $100 + $50, 10 % off total = $15 split 10/5; tax 10 % only on b: (5000 − 500) × 10 % = 450
    ['proposal discount allocated before tax', [line('a'), line('b', { unitPriceCents: 5000, taxRateBps: 1000 })], { type: 'percent', bps: 1000 }, { proposalDiscountCents: 1500, taxCents: 450, totalCents: 13950 }],
  ])('%s', (_name, lines, discount, expected) => {
    expect(price({ lines, discount })).toMatchObject(expected);
  });

  it('allocates the remainder cent by largest remainder, ties by id', () => {
    // 3 equal lines, $1 off: 33 each and the leftover cent to the lowest id
    const r = byId(price({ lines: [line('c'), line('a'), line('b')], discount: { type: 'fixed', cents: 100 } }));
    expect([r.a!.allocatedDiscountCents, r.b!.allocatedDiscountCents, r.c!.allocatedDiscountCents]).toEqual([34, 33, 33]);
  });

  it('breaks down every line', () => {
    const r = price({ lines: [line('a', { kind: 'hourly', unitPriceCents: 12345, quantityMilli: 2750, taxRateBps: 725, discount: { type: 'percent', bps: 500 } })] });
    // 12345 × 2.75 = 33948.75 → 33949; 5 % = 1697.45 → 1697; net 32252; tax 7.25 % = 2338.27 → 2338
    expect(r.lines[0]).toEqual({ id: 'a', included: true, extendedCents: 33949, lineDiscountCents: 1697, allocatedDiscountCents: 0, taxableCents: 32252, taxCents: 2338, totalCents: 34590 });
  });

  it.each<[string, LineItem[], Discount?]>([
    ['duplicate ids', [line('a'), line('a')]],
    ['empty id', [line('')]],
    ['fractional cents', [line('a', { unitPriceCents: 10.5 })]],
    ['negative price', [line('a', { unitPriceCents: -1 })]],
    ['fractional quantity', [line('a', { kind: 'hourly', quantityMilli: 1.5 })]],
    ['discount over 100 %', [line('a', { discount: { type: 'percent', bps: 10001 } })]],
    ['negative proposal discount', [line('a')], { type: 'fixed', cents: -5 }],
    ['unknown kind', [line('a', { kind: 'retainer' as LineItem['kind'] })]],
  ])('rejects %s', (_name, lines, discount) => {
    expect(() => price({ lines, discount })).toThrow(PricingError);
  });
});

describe('allocate', () => {
  it('splits exactly and in proportion', () => {
    const r = allocate(10n, [{ id: 'x', weight: 100n }, { id: 'y', weight: 200n }]);
    expect([r.get('x'), r.get('y')]).toEqual([3n, 7n]);
  });
  it('gives zero to everyone when there is nothing to split', () => {
    expect([...allocate(0n, [{ id: 'x', weight: 5n }]).values()]).toEqual([0n]);
    expect([...allocate(0n, [{ id: 'x', weight: 0n }]).values()]).toEqual([0n]);
  });
});

// ---------- properties ----------

const discountArb: fc.Arbitrary<Discount | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.record({ type: fc.constant('percent' as const), bps: fc.integer({ min: 0, max: 10000 }) }),
  fc.record({ type: fc.constant('fixed' as const), cents: fc.integer({ min: 0, max: 5_000_000 }) }),
);

const linesArb = fc
  .uniqueArray(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      kind: fc.constantFrom('fixed' as const, 'hourly' as const, 'per_unit' as const),
      unitPriceCents: fc.integer({ min: 0, max: 50_000_000 }),
      quantityMilli: fc.integer({ min: 0, max: 2_000_000 }),
      taxRateBps: fc.integer({ min: 0, max: 2500 }),
      discount: discountArb,
      optional: fc.boolean(),
      selected: fc.boolean(),
    }),
    { selector: (l) => l.id, maxLength: 25 },
  )
  .map((ls) => ls.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as LineItem));

const inputArb = fc.record({ lines: linesArb, discount: discountArb });

describe('price: CS-01 properties', () => {
  it('every figure is a non-negative integer and every total is the exact sum of its line parts', () => {
    fc.assert(
      fc.property(inputArb, ({ lines, discount }) => {
        const r = price({ lines, discount });
        const all = [r.grossCents, r.lineDiscountCents, r.subtotalCents, r.proposalDiscountCents, r.taxableCents, r.taxCents, r.totalCents, ...r.lines.flatMap((l) => [l.extendedCents, l.lineDiscountCents, l.allocatedDiscountCents, l.taxableCents, l.taxCents, l.totalCents])];
        for (const n of all) expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
        const sum = (f: (l: (typeof r.lines)[number]) => number) => r.lines.reduce((s, l) => s + f(l), 0);
        expect(sum((l) => l.extendedCents)).toBe(r.grossCents);
        expect(sum((l) => l.allocatedDiscountCents)).toBe(r.proposalDiscountCents);
        expect(r.subtotalCents).toBe(r.grossCents - r.lineDiscountCents);
        expect(r.taxableCents).toBe(r.subtotalCents - r.proposalDiscountCents);
        expect(r.totalCents).toBe(r.taxableCents + r.taxCents);
        expect(sum((l) => l.totalCents)).toBe(r.totalCents);
        for (const l of r.lines) {
          expect(l.lineDiscountCents).toBeLessThanOrEqual(l.extendedCents);
          expect(l.allocatedDiscountCents).toBeLessThanOrEqual(l.extendedCents - l.lineDiscountCents);
          expect(l.totalCents).toBe(l.taxableCents + l.taxCents);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('is stable under line reordering: same totals, same per-line figures by id', () => {
    fc.assert(
      fc.property(inputArb.chain((inp) => fc.tuple(fc.constant(inp), fc.shuffledSubarray(inp.lines, { minLength: inp.lines.length, maxLength: inp.lines.length }))), ([inp, shuffled]) => {
        const a = price(inp);
        const b = price({ lines: shuffled, discount: inp.discount });
        expect({ ...b, lines: undefined }).toEqual({ ...a, lines: undefined });
        expect(byId(b)).toEqual(byId(a));
        expect(b.lines.map((l) => l.id)).toEqual(shuffled.map((l) => l.id)); // output keeps the caller's order
      }),
      { numRuns: 500 },
    );
  });

  it('is stable under reordering when remainders tie (equal lines, odd discounts)', () => {
    // Ties in the largest-remainder step are rare with random prices; this generator makes them common.
    const tieArb = fc.record({
      lines: fc.uniqueArray(
        fc.record({ id: fc.string({ minLength: 1, maxLength: 4 }), kind: fc.constant('fixed' as const), unitPriceCents: fc.constantFrom(100, 200, 300), taxRateBps: fc.constantFrom(0, 500, 825) }),
        { selector: (l) => l.id, minLength: 2, maxLength: 9 },
      ),
      discount: fc.oneof(fc.record({ type: fc.constant('fixed' as const), cents: fc.integer({ min: 1, max: 999 }) }), fc.record({ type: fc.constant('percent' as const), bps: fc.integer({ min: 1, max: 9999 }) })),
    });
    fc.assert(
      fc.property(tieArb.chain((inp) => fc.tuple(fc.constant(inp), fc.shuffledSubarray(inp.lines, { minLength: inp.lines.length, maxLength: inp.lines.length }))), ([inp, shuffled]) => {
        expect(byId(price({ lines: shuffled, discount: inp.discount }))).toEqual(byId(price(inp)));
      }),
      { numRuns: 500 },
    );
  });

  it('an unselected optional line prices the same as no line at all', () => {
    fc.assert(
      fc.property(inputArb, ({ lines, discount }) => {
        const off = lines.map((l) => (l.optional ? { ...l, selected: false } : l));
        const withOff = price({ lines: off, discount });
        const without = price({ lines: off.filter((l) => !l.optional), discount });
        expect({ ...withOff, lines: undefined }).toEqual({ ...without, lines: undefined });
      }),
      { numRuns: 300 },
    );
  });

  it('the proposal discount never exceeds the subtotal, and a percent discount matches its rounded rate', () => {
    fc.assert(
      fc.property(inputArb, ({ lines, discount }) => {
        const r = price({ lines, discount });
        expect(r.proposalDiscountCents).toBeLessThanOrEqual(r.subtotalCents);
        if (discount?.type === 'percent') expect(r.proposalDiscountCents).toBe(Number(divRoundHalfUp(BigInt(r.subtotalCents) * BigInt(discount.bps), 10000n)));
      }),
      { numRuns: 300 },
    );
  });

  it('pricing is deterministic', () => {
    fc.assert(fc.property(inputArb, (inp) => {
      expect(price(inp)).toEqual(price(structuredClone(inp)));
    }), { numRuns: 200 });
  });
});
