// Countersign editor input (D-23): exact decimal strings to integers and back. No floats anywhere: the digits are
// split on the decimal point and scaled as integers, so "0.1" + "0.2" style errors cannot happen.
import { LIMITS } from './pricing';

export class InputError extends Error {
  override name = 'InputError';
}

type Scale = { decimals: number; max: number; what: string };

/** cents (2 decimals), thousandths of a unit (3), basis points from a percent (2 decimals of a percent). */
export const SCALES = {
  money: { decimals: 2, max: LIMITS.unitPriceCents, what: 'amount' },
  quantity: { decimals: 3, max: LIMITS.quantityMilli, what: 'quantity' },
  percent: { decimals: 2, max: LIMITS.bps, what: 'percent' },
  taxPercent: { decimals: 2, max: LIMITS.taxRateBps, what: 'tax rate' },
} as const satisfies Record<string, Scale>;

const DECIMAL = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

/**
 * "1,234.50" → 123450 at scale 2. Thousands separators must be well-formed; a leading "$" or "%" is not accepted (the
 * form labels carry the unit). Empty is refused; more decimals than the scale allows is refused, never rounded.
 */
export function parseDecimal(raw: string, scale: Scale): number {
  const s = raw.trim();
  const m = DECIMAL.exec(s);
  if (!s || !m || (m[1] === undefined && !m[2])) throw new InputError(`Enter the ${scale.what} as a number, like 12 or 12.50.`);
  const whole = (m[1] ?? '0').replaceAll(',', '');
  const frac = m[2] ?? '';
  if (frac.length > scale.decimals) throw new InputError(`The ${scale.what} has more than ${scale.decimals} decimal places.`);
  const n = BigInt(whole) * 10n ** BigInt(scale.decimals) + BigInt(frac.padEnd(scale.decimals, '0') || '0');
  if (n > BigInt(scale.max)) throw new InputError(`The ${scale.what} is too large (at most ${formatDecimal(scale.max, scale)}).`);
  return Number(n);
}

/**
 * 123450 at scale 2 → "1234.5"; with `fixed`, "1234.50". Plain digits (no separators), so the value round-trips through
 * `parseDecimal`. Money is shown fixed (`formatMoney`); quantities and percents drop trailing zeros ("1.5", "8.25", "2").
 */
export function formatDecimal(n: number, scale: Pick<Scale, 'decimals'>, fixed = false): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new InputError(`cannot format ${n}`);
  const s = String(n).padStart(scale.decimals + 1, '0');
  if (scale.decimals === 0) return s;
  const whole = s.slice(0, -scale.decimals);
  const frac = s.slice(-scale.decimals);
  if (fixed) return `${whole}.${frac}`;
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** 123456 → "$1,234.56" for display only (never parsed back). */
export function displayCents(cents: number): string {
  const [whole = '0', frac = '00'] = formatMoney(cents).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

export const parseMoney = (s: string) => parseDecimal(s, SCALES.money);
export const parseQuantity = (s: string) => parseDecimal(s, SCALES.quantity);
export const parsePercent = (s: string) => parseDecimal(s, SCALES.percent);
export const parseTaxPercent = (s: string) => parseDecimal(s, SCALES.taxPercent);
export const formatMoney = (cents: number) => formatDecimal(cents, SCALES.money, true);
export const formatQuantity = (milli: number) => formatDecimal(milli, SCALES.quantity);
export const formatPercent = (bps: number) => formatDecimal(bps, SCALES.percent);
