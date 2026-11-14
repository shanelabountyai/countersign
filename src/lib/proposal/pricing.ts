// Countersign pricing (CS-01): pure, integer cents, order-independent. Rounding rules: docs/countersign/PHASE1_PLAN.md.

export type LineKind = 'fixed' | 'hourly' | 'per_unit';

export type Discount = { type: 'percent'; bps: number } | { type: 'fixed'; cents: number };

export type LineItem = {
  id: string;
  kind: LineKind;
  unitPriceCents: number;
  /** Thousandths of a unit (1.5 hours = 1500). Ignored for `fixed`, which is always 1. */
  quantityMilli?: number;
  /** 8.25 % = 825. At most 10000 (100 %), see LIMITS.taxRateBps. */
  taxRateBps?: number;
  discount?: Discount;
  optional?: boolean;
  /** For optional lines only: whether the client has toggled it on. */
  selected?: boolean;
};

export type PricingInput = { lines: readonly LineItem[]; discount?: Discount };

export type LineResult = {
  id: string;
  included: boolean;
  extendedCents: number;
  lineDiscountCents: number;
  allocatedDiscountCents: number;
  taxableCents: number;
  /** This line's share of its rate's tax (D-18): a display allocation, not tax computed on the line. */
  taxCents: number;
  totalCents: number;
};

/** One tax rate's group: tax is computed on the group's taxable subtotal and rounded once (D-18). */
export type TaxGroup = { taxRateBps: number; taxableCents: number; taxCents: number };

export type PricingResult = {
  lines: LineResult[];
  /** Σ extended over included lines. */
  grossCents: number;
  lineDiscountCents: number;
  /** Σ (extended − line discount): the base the proposal discount applies to. */
  subtotalCents: number;
  proposalDiscountCents: number;
  taxableCents: number;
  /** Σ over taxes[].taxCents. */
  taxCents: number;
  /** One entry per distinct non-zero rate among included lines, ascending by rate. */
  taxes: TaxGroup[];
  totalCents: number;
};

export class PricingError extends Error {
  override name = 'PricingError';
}

const MILLI = 1000n;
const BPS = 10000n;
/** Upper bounds keep every intermediate product exact and every result a safe integer. */
export const LIMITS = { unitPriceCents: 10_000_000_000, quantityMilli: 100_000_000, bps: 100_000, taxRateBps: 10_000, lines: 1000 } as const;

function int(name: string, v: number, max: number): bigint {
  if (!Number.isSafeInteger(v) || v < 0 || v > max) throw new PricingError(`${name} must be an integer in [0, ${max}], got ${v}`);
  return BigInt(v);
}

function safe(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new PricingError(`result ${v} is outside the safe integer range`);
  return n;
}

/** a / b rounded half up, for a ≥ 0 and b > 0 (rule: half up = half away from zero for non-negative amounts). */
export function divRoundHalfUp(a: bigint, b: bigint): bigint {
  if (a < 0n || b <= 0n) throw new PricingError('divRoundHalfUp needs a ≥ 0 and b > 0');
  return (2n * a + b) / (2n * b);
}

function discountAmount(base: bigint, d: Discount | undefined, what: string): bigint {
  if (!d) return 0n;
  if (d.type === 'percent') {
    const bps = int(`${what} discount bps`, d.bps, LIMITS.bps);
    if (bps > BPS) throw new PricingError(`${what} percent discount cannot exceed 100 %`);
    return divRoundHalfUp(base * bps, BPS);
  }
  const cents = int(`${what} discount cents`, d.cents, Number.MAX_SAFE_INTEGER);
  return cents < base ? cents : base; // capped: never below zero
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Split `amount` across `weights` pro rata, exactly, by largest remainder. Leftover cents go to the largest fractional
 * parts; ties break by id ascending, so the split depends on the set of (id, weight) pairs and never on their order.
 */
export function allocate(amount: bigint, parts: readonly { id: string; weight: bigint }[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const total = parts.reduce((s, p) => s + p.weight, 0n);
  if (amount === 0n || total === 0n) {
    for (const p of parts) out.set(p.id, 0n);
    return out;
  }
  if (amount > total) throw new PricingError('cannot allocate more than the weights total');
  let given = 0n;
  const rems = parts.map((p) => {
    const q = (amount * p.weight) / total;
    given += q;
    out.set(p.id, q);
    return { id: p.id, rem: (amount * p.weight) % total };
  });
  rems.sort((x, y) => (x.rem === y.rem ? compareIds(x.id, y.id) : x.rem > y.rem ? -1 : 1));
  for (let i = 0; given < amount; i++, given++) out.set(rems[i]!.id, out.get(rems[i]!.id)! + 1n);
  return out;
}

export function isIncluded(line: LineItem): boolean {
  return !line.optional || line.selected === true;
}

export function price(input: PricingInput): PricingResult {
  if (input.lines.length > LIMITS.lines) throw new PricingError(`at most ${LIMITS.lines} lines`);
  const seen = new Set<string>();
  const stage1 = input.lines.map((l) => {
    if (typeof l.id !== 'string' || l.id === '') throw new PricingError('every line needs a non-empty id');
    if (seen.has(l.id)) throw new PricingError(`duplicate line id ${l.id}`);
    seen.add(l.id);
    if (!['fixed', 'hourly', 'per_unit'].includes(l.kind)) throw new PricingError(`unknown line kind ${String(l.kind)}`);
    const unit = int('unitPriceCents', l.unitPriceCents, LIMITS.unitPriceCents);
    const qty = l.kind === 'fixed' ? MILLI : int('quantityMilli', l.quantityMilli ?? 1000, LIMITS.quantityMilli);
    const tax = int('taxRateBps', l.taxRateBps ?? 0, LIMITS.bps);
    if (tax > BigInt(LIMITS.taxRateBps)) throw new PricingError(`line ${l.id}: taxRateBps ${l.taxRateBps} is above the cap of ${LIMITS.taxRateBps} (100 %)`);
    const included = isIncluded(l);
    const extended = included ? divRoundHalfUp(unit * qty, MILLI) : 0n; // rule 1
    const lineDiscount = included ? discountAmount(extended, l.discount, 'line') : 0n; // rule 2
    if (!included) discountAmount(0n, l.discount, 'line'); // still validate an unselected line's discount
    return { id: l.id, included, extended, lineDiscount, net: extended - lineDiscount, tax };
  });

  const subtotal = stage1.reduce((s, l) => s + l.net, 0n);
  const proposalDiscount = discountAmount(subtotal, input.discount, 'proposal'); // rule 3
  const alloc = allocate(proposalDiscount, stage1.filter((l) => l.included).map((l) => ({ id: l.id, weight: l.net })));

  const stage2 = stage1.map((l) => ({ ...l, allocated: alloc.get(l.id) ?? 0n, taxable: l.net - (alloc.get(l.id) ?? 0n) }));

  // Rule 4 (D-18): per rate, tax = taxable subtotal × rate, rounded half up once; then split back over that rate's lines
  // by largest remainder (ties by id), so line taxes sum exactly to the rate's tax.
  const byRate = new Map<bigint, { id: string; weight: bigint }[]>();
  for (const l of stage2) if (l.included && l.tax > 0n) byRate.set(l.tax, [...(byRate.get(l.tax) ?? []), { id: l.id, weight: l.taxable }]);
  const lineTax = new Map<string, bigint>();
  const taxes: TaxGroup[] = [...byRate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([rate, parts]) => {
      const taxable = parts.reduce((s, p) => s + p.weight, 0n);
      const tax = divRoundHalfUp(taxable * rate, BPS); // ≤ taxable, since rate ≤ 100 %
      for (const [id, t] of allocate(tax, parts)) lineTax.set(id, t);
      return { taxRateBps: safe(rate), taxableCents: safe(taxable), taxCents: safe(tax) };
    });

  const lines: LineResult[] = stage2.map((l) => {
    const { allocated, taxable } = l;
    const tax = lineTax.get(l.id) ?? 0n;
    return {
      id: l.id,
      included: l.included,
      extendedCents: safe(l.extended),
      lineDiscountCents: safe(l.lineDiscount),
      allocatedDiscountCents: safe(allocated),
      taxableCents: safe(taxable),
      taxCents: safe(tax),
      totalCents: safe(taxable + tax),
    };
  });

  const sum = (k: keyof Omit<LineResult, 'id' | 'included'>) => safe(lines.reduce((s, l) => s + BigInt(l[k]), 0n));
  return {
    lines,
    grossCents: sum('extendedCents'),
    lineDiscountCents: sum('lineDiscountCents'),
    subtotalCents: safe(subtotal),
    proposalDiscountCents: safe(proposalDiscount),
    taxableCents: sum('taxableCents'),
    taxCents: sum('taxCents'),
    taxes,
    totalCents: sum('totalCents'), // rule 5
  };
}
