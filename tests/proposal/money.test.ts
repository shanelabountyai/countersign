import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  displayCents, formatDecimal, formatMoney, formatPercent, formatQuantity, InputError, parseMoney, parsePercent, parseQuantity, parseTaxPercent, SCALES,
} from '@/lib/proposal/money';
import { LIMITS } from '@/lib/proposal/pricing';

// D-23: editor amounts are exact decimal strings; nothing is rounded and no float is involved.

describe('parseMoney: table', () => {
  it.each([
    ['0', 0], ['12', 1200], ['12.5', 1250], ['12.50', 1250], ['.5', 50], ['5.', 500], ['0.01', 1], [' 7.07 ', 707],
    ['1,234.56', 123456], ['1,234,567', 123456700], ['100000000', 10_000_000_000],
  ])('%j → %i cents', (s, cents) => expect(parseMoney(s)).toBe(cents));

  it.each([
    ['', 'number'], ['  ', 'number'], ['.', 'number'], ['abc', 'number'], ['-1', 'number'], ['$5', 'number'], ['1e3', 'number'],
    ['12,34', 'number'], ['1,2345', 'number'], ['1.2.3', 'number'], ['0.001', 'more than 2'], ['12.345', 'more than 2'],
    ['100000000.01', 'too large'],
  ])('%j is refused (%s)', (s, why) => expect(() => parseMoney(s)).toThrow(new RegExp(why)));

  it('refusals are InputError', () => expect(() => parseMoney('x')).toThrow(InputError));
});

describe('quantity and percents', () => {
  it.each([['1', 1000], ['1.5', 1500], ['0.125', 125], ['2,000', 2_000_000]])('quantity %j → %i milli', (s, n) => expect(parseQuantity(s)).toBe(n));
  it('quantity takes at most 3 decimals', () => expect(() => parseQuantity('1.0005')).toThrow(/more than 3/));
  it.each([['8.25', 825], ['100', 10000], ['0', 0], ['12.5', 1250]])('tax %j%% → %i bps', (s, n) => expect(parseTaxPercent(s)).toBe(n));
  it('tax above 100 % is refused (D-18 cap)', () => expect(() => parseTaxPercent('100.01')).toThrow(/too large/));
  it('a discount percent may exceed 100 (the pricing module caps the amount), up to LIMITS.bps', () => {
    expect(parsePercent('150')).toBe(15000);
    expect(() => parsePercent('1000.01')).toThrow(/too large/);
  });
});

describe('format', () => {
  it.each([[0, '0.00'], [1, '0.01'], [1250, '12.50'], [123456, '1234.56']])('formatMoney(%i) = %s', (n, s) => expect(formatMoney(n)).toBe(s));
  it.each([[1000, '1'], [1500, '1.5'], [125, '0.125'], [0, '0']])('formatQuantity(%i) = %s', (n, s) => expect(formatQuantity(n)).toBe(s));
  it.each([[825, '8.25'], [1000, '10'], [5, '0.05']])('formatPercent(%i) = %s', (n, s) => expect(formatPercent(n)).toBe(s));
  it.each([[0, '$0.00'], [123456, '$1,234.56'], [100000000, '$1,000,000.00'], [99, '$0.99']])('displayCents(%i) = %s', (n, s) => expect(displayCents(n)).toBe(s));
  it('refuses negatives and non-integers', () => {
    expect(() => formatMoney(-1)).toThrow(InputError);
    expect(() => formatMoney(1.5)).toThrow(InputError);
  });
});

describe('properties', () => {
  const cases = [
    ['money', SCALES.money, formatMoney, parseMoney],
    ['quantity', SCALES.quantity, formatQuantity, parseQuantity],
    ['percent', SCALES.percent, formatPercent, parsePercent],
  ] as const;

  it.each(cases)('%s: parse(format(n)) = n for every n in range', (_, scale, format, parse) => {
    fc.assert(fc.property(fc.integer({ min: 0, max: scale.max }), (n) => parse(format(n)) === n));
  });

  it('money: thousands separators never change the value', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: LIMITS.unitPriceCents }), (n) => {
      const [w = '0', f = '00'] = formatMoney(n).split('.');
      return parseMoney(`${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`) === n;
    }));
  });

  it('money: matches integer arithmetic on the digits, never floats (whole.frac → whole*100 + frac)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 99 }), (w, f) => {
      return parseMoney(`${w}.${String(f).padStart(2, '0')}`) === w * 100 + f;
    }));
  });

  it('formatDecimal with zero decimals is the plain integer', () => {
    fc.assert(fc.property(fc.nat(), (n) => formatDecimal(n, { decimals: 0 }) === String(n)));
  });
});
