// Countersign editor forms → store inputs. Pure. The editor posts each column as a parallel array (`lineDescription[]`,
// `linePrice[]`, …, see `fields()` in core/authz/action.ts); a row whose kind is "remove", or which is left entirely
// blank, is dropped. Rows are kept in form order, then sorted by their "order" number when one is given (stable).
import { InputError, parseMoney, parsePercent, parseQuantity, parseTaxPercent } from './money';
import type { Discount, LineKind } from './pricing';
import type { LineInput, SectionInput } from './store';

export const LINE_KINDS = ['fixed', 'hourly', 'per_unit'] as const satisfies readonly LineKind[];
export const SECTION_KINDS = ['section', 'terms'] as const;
export const INCLUSION = ['required', 'optional_off', 'optional_on'] as const;
export const DISCOUNT_TYPES = ['none', 'percent', 'fixed'] as const;

export type SectionColumns = { sectionKind: string[]; sectionTitle: string[]; sectionBody: string[]; sectionOrder: string[] };
export type LineColumns = {
  lineKind: string[];
  lineDescription: string[];
  linePrice: string[];
  lineQty: string[];
  lineTax: string[];
  lineDiscountType: string[];
  lineDiscount: string[];
  lineInclusion: string[];
  lineOrder: string[];
};

/** The common length of the named columns. Only `keys` are read, so a caller may pass its whole parsed form. */
function columns<K extends string>(cols: Record<K, string[]>, keys: readonly K[], what: string): number {
  const lengths = new Set(keys.map((k) => cols[k].length));
  if (lengths.size > 1) throw new InputError(`The ${what} rows are incomplete. Reload the page and try again.`);
  return [...lengths][0] ?? 0;
}

function sortByOrder<T>(rows: { row: T; order: string; index: number }[], what: string): T[] {
  return rows
    .map((r) => {
      const o = r.order.trim();
      if (o && !/^\d{1,4}$/.test(o)) throw new InputError(`${what} ${r.index + 1}: the order must be a whole number.`);
      return { ...r, key: o ? Number(o) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key - b.key))
    .map((r) => r.row);
}

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], what: string): T {
  if (!(allowed as readonly string[]).includes(v ?? '')) throw new InputError(`${what}: choose one of ${allowed.join(', ')}.`);
  return v as T;
}

export function parseSections(c: SectionColumns): SectionInput[] {
  const n = columns(c, ['sectionKind', 'sectionTitle', 'sectionBody', 'sectionOrder'], 'section');
  const rows: { row: SectionInput; order: string; index: number }[] = [];
  for (let i = 0; i < n; i++) {
    const kind = c.sectionKind[i]!;
    const title = c.sectionTitle[i]!.trim();
    const body = c.sectionBody[i]!.replace(/\r\n/g, '\n');
    if (kind === 'remove' || (!title && !body.trim())) continue;
    rows.push({ row: { kind: oneOf(kind, SECTION_KINDS, `Section ${i + 1}`), title, body }, order: c.sectionOrder[i]!, index: i });
  }
  return sortByOrder(rows, 'Section');
}

export function parseDiscount(type: string, value: string, what: string): Discount | null {
  const t = oneOf(type, DISCOUNT_TYPES, `${what} discount`);
  if (t === 'none') return null;
  try {
    return t === 'percent' ? { type: 'percent', bps: parsePercent(value) } : { type: 'fixed', cents: parseMoney(value) };
  } catch (e) {
    if (e instanceof InputError) throw new InputError(`${what} discount: ${e.message}`);
    throw e;
  }
}

export function parseLines(c: LineColumns): LineInput[] {
  const n = columns(c, ['lineKind', 'lineDescription', 'linePrice', 'lineQty', 'lineTax', 'lineDiscountType', 'lineDiscount', 'lineInclusion', 'lineOrder'], 'line item');
  const rows: { row: LineInput; order: string; index: number }[] = [];
  for (let i = 0; i < n; i++) {
    const kind = c.lineKind[i]!;
    const description = c.lineDescription[i]!.trim();
    const price = c.linePrice[i]!.trim();
    if (kind === 'remove' || (!description && !price)) continue;
    const what = `Line ${i + 1}`;
    const at = <T>(f: () => T): T => {
      try {
        return f();
      } catch (e) {
        if (e instanceof InputError) throw new InputError(`${what}: ${e.message}`);
        throw e;
      }
    };
    const k = oneOf(kind, LINE_KINDS, what);
    const inclusion = oneOf(c.lineInclusion[i], INCLUSION, what);
    rows.push({
      row: {
        kind: k,
        description,
        unitPriceCents: at(() => parseMoney(price)),
        quantityMilli: k === 'fixed' ? 1000 : at(() => parseQuantity(c.lineQty[i]!.trim() || '1')),
        taxRateBps: at(() => parseTaxPercent(c.lineTax[i]!.trim() || '0')),
        discount: parseDiscount(c.lineDiscountType[i]!, c.lineDiscount[i]!, what),
        optional: inclusion !== 'required',
        selected: inclusion === 'optional_on',
      },
      order: c.lineOrder[i]!,
      index: i,
    });
  }
  return sortByOrder(rows, 'Line');
}
