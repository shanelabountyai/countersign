import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MERGE_FIELDS, renderMerge, unknownFields, usedFields, type MergeValues } from '@/lib/proposal/merge';

// D-25: a fixed set of merge fields, inserted literally.

const values: MergeValues = { client: 'Acme Co', scope: 'a new website', timeline: '6 weeks' };

describe('renderMerge', () => {
  it.each([
    ['Prepared for {{client}}.', 'Prepared for Acme Co.'],
    ['{{ client }} / {{scope}} / {{  timeline  }}', 'Acme Co / a new website / 6 weeks'],
    ['{{client}}{{client}}', 'Acme CoAcme Co'],
    ['no fields', 'no fields'],
    ['{{unknown}} stays', '{{unknown}} stays'],
    ['{client} and {{ client', '{client} and {{ client'],
    ['', ''],
  ])('%j → %j', (text, out) => expect(renderMerge(text, values)).toBe(out));

  it('inserts values literally: a value that looks like a placeholder is not expanded again', () => {
    expect(renderMerge('{{client}} — {{scope}}', { ...values, client: '{{scope}}' })).toBe('{{scope}} — a new website');
  });

  it('an empty value renders empty', () => expect(renderMerge('[{{timeline}}]', { ...values, timeline: '' })).toBe('[]'));

  it('property: text with no braces is unchanged', () => {
    fc.assert(fc.property(fc.string().filter((s) => !s.includes('{')), (s) => renderMerge(s, values) === s));
  });

  it('property: rendered output never contains a known placeholder unless a value supplied it', () => {
    const piece = fc.oneof(fc.constantFrom(...MERGE_FIELDS.map((f) => `{{${f}}}`)), fc.string().filter((s) => !/[{}]/.test(s)));
    const plain = fc.string().filter((s) => !/[{}]/.test(s));
    fc.assert(fc.property(fc.array(piece), plain, plain, plain, (parts, client, scope, timeline) => {
      return !/\{\{\s*(client|scope|timeline)\s*\}\}/.test(renderMerge(parts.join(''), { client, scope, timeline }));
    }));
  });
});

describe('unknownFields / usedFields', () => {
  it('lists unknown names once, in order', () => expect(unknownFields('{{price}} {{client}} {{ price }} {{Client}} {{}}')).toEqual(['price', 'Client', '']));
  it('is empty for known fields only', () => expect(unknownFields('{{client}} {{ scope }} {{timeline}}')).toEqual([]));
  it('usedFields is in MERGE_FIELDS order', () => expect(usedFields('{{timeline}} {{client}} {{x}}')).toEqual(['client', 'timeline']));
});
