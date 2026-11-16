import { describe, expect, it } from 'vitest';
import { usedFields, unknownFields } from '@/lib/proposal/merge';
import { unsupportedChars } from '@/lib/proposal/pdf-text';
import { SAMPLE_TEMPLATE_NAME, sampleTemplate } from '@/lib/proposal/sample-template';
import { validateTemplate } from '@/lib/proposal/store';

// Phase 4 (D-43): the Lab Intelligence sample is clearly a sample, carries no prices, names no client, and is a valid,
// sendable template.

describe('Lab Intelligence sample template', () => {
  const t = sampleTemplate();
  const allText = [t.name, ...t.sections.flatMap((s) => [s.title, s.body]), ...t.lines.map((l) => l.description)].join('\n');

  it('says SAMPLE in its name and in its first section, and that prices are placeholders', () => {
    expect(t.name).toBe(SAMPLE_TEMPLATE_NAME);
    expect(t.name.startsWith('SAMPLE')).toBe(true);
    expect(t.sections[0]!.body).toMatch(/This is a sample template/);
    expect(t.sections[0]!.body).toMatch(/\$0\.00 placeholder/);
  });

  it('has no prices: every line is $0.00 and tells the author to set it', () => {
    expect(t.lines.length).toBeGreaterThan(0);
    for (const l of t.lines) {
      expect(l.unitPriceCents).toBe(0);
      expect(l.description).toMatch(/set your (price|hourly rate)/);
    }
  });

  it('names no client and claims no results: the client comes from the {{client}} merge field', () => {
    expect(allText).not.toMatch(/\b(Inc|LLC|Ltd|Corp)\b/);
    expect(allText).not.toMatch(/\d+\s?%|\bROI\b|case study|testimonial|our clients/i);
    expect(usedFields(allText)).toEqual(expect.arrayContaining(['client', 'scope', 'timeline']));
    expect(unknownFields(allText)).toEqual([]); // D-25's fixed set only
  });

  it('is a valid template whose text the PDF can draw (D-31) and has terms and optional add-ons', () => {
    expect(() => validateTemplate(t)).not.toThrow();
    expect(unsupportedChars(allText)).toEqual([]);
    expect(t.sections.some((s) => s.kind === 'terms')).toBe(true);
    expect(t.lines.some((l) => l.optional && !l.selected)).toBe(true);
  });

  it('hands out a fresh copy each time', () => {
    const a = sampleTemplate();
    a.sections[0]!.body = 'changed';
    expect(sampleTemplate().sections[0]!.body).not.toBe('changed');
  });
});
