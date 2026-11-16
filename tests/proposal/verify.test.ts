import { describe, expect, it } from 'vitest';
import { matchSignedVersion, sha256Hex } from '@/lib/proposal/hash';
import { renderMerge } from '@/lib/proposal/merge';
import { renderProposalPdf, type ProposalPdfModel } from '@/lib/proposal/pdf';
import { sampleTemplate } from '@/lib/proposal/sample-template';

// Phase 4 tamper test (CS-02), exhaustive: a real rendered proposal PDF (the Lab Intelligence sample) matches its signed
// candidate, and flipping ANY single byte, appending one or removing one makes it match nothing. The verify page looks
// the upload's hash up, so "matches nothing" is its "Not verified".

const AT = new Date('2026-11-16T12:00:00Z');
const values = { client: 'Example Client', scope: 'the order-to-invoice workflow', timeline: 'Four weeks from the kickoff call.' };

async function samplePdf() {
  const t = sampleTemplate();
  const model: ProposalPdfModel = {
    orgName: 'Lab Intelligence', title: 'AI adoption assessment', clientName: values.client, clientEmail: '', version: 1,
    sections: t.sections.map((s) => ({ kind: s.kind, title: renderMerge(s.title, values), body: renderMerge(s.body, values) })),
    lines: t.lines.map((l, i) => ({ id: `l${i}`, ...l })),
    discount: null,
  };
  return renderProposalPdf(model, AT);
}

describe('verify tamper test over every byte', () => {
  it('the untouched PDF matches; every single-byte flip, an appended byte and a removed byte match nothing', async () => {
    const pdf = Buffer.from(await samplePdf());
    const signed = [{ versionId: 'v1', status: 'signed' as const, pdfSha256: sha256Hex(pdf) }];
    expect(matchSignedVersion(pdf, signed)).toEqual(signed[0]);

    let refused = 0;
    for (let i = 0; i < pdf.length; i++) {
      const b = Buffer.from(pdf);
      b[i]! ^= 0x01;
      if (matchSignedVersion(b, signed) === null) refused++;
    }
    expect(refused).toBe(pdf.length); // every position
    expect(matchSignedVersion(Buffer.concat([pdf, Buffer.from([0x0a])]), signed)).toBeNull();
    expect(matchSignedVersion(pdf.subarray(0, -1), signed)).toBeNull();
    // Recorded for the README case study (Phase 4): the size of the PDF every byte of which was flipped.
    console.info(`verify tamper test: ${refused}/${pdf.length} single-byte flips refused; sample PDF sha256 ${sha256Hex(pdf)}`);
  });

  it('the sample PDF renders to the same bytes again (what lets the verify page re-derive it, D-31)', async () => {
    expect(sha256Hex(await samplePdf())).toBe(sha256Hex(await samplePdf()));
  });

  it('an unsigned candidate with the same hash never matches (D-17)', async () => {
    const pdf = await samplePdf();
    for (const status of ['sent', 'viewed', 'superseded', 'declined', 'expired'] as const) {
      expect(matchSignedVersion(pdf, [{ versionId: 'v1', status, pdfSha256: sha256Hex(pdf) }])).toBeNull();
    }
  });
});
