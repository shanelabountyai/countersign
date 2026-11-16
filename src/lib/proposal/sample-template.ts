// Countersign Phase 4: the Lab Intelligence sample template (PRD "Lab Intelligence sample template"). A starting point
// for an AI-adoption engagement proposal, clearly a sample (D-43): "SAMPLE" in the name and in the first section, no
// client names, no claimed clients or results, and no prices. Every line is $0.00 and says "set your price", so nothing
// in it can read as a quote. Merge fields are D-25's fixed set. Text stays inside the PDF fonts' WinAnsi range (D-31).
import type { LineInput, SectionInput, TemplateInput } from './store';

export const SAMPLE_TEMPLATE_NAME = 'SAMPLE: Lab Intelligence AI adoption assessment';

const SECTIONS: SectionInput[] = [
  {
    kind: 'section',
    title: 'About this sample',
    body:
      'This is a sample template. It shows how a Lab Intelligence proposal could be laid out in Countersign. ' +
      'Every price is a $0.00 placeholder and every line says "set your price": replace the prices, edit the text, ' +
      'and delete this section before sending. Nothing in it describes a real client, a past engagement or a result.',
  },
  {
    kind: 'section',
    title: 'Why this engagement',
    body:
      'AI projects rarely stall because of the technology. They stall because the people and processes around them ' +
      'were not built for it. This engagement looks at how work actually moves at {{client}} before recommending any tool.',
  },
  {
    kind: 'section',
    title: 'Scope',
    body: 'For {{client}}: {{scope}}',
  },
  {
    kind: 'section',
    title: 'Approach',
    body:
      '1. Discovery interviews with the people who do the work and the people who decide.\n' +
      '2. A map of the current workflow, its hand-offs and the data each step needs.\n' +
      '3. A short list of AI use cases, each scored for value, readiness and risk.\n' +
      '4. A readout with a recommended first pilot, its owner and how its success will be measured.',
  },
  {
    kind: 'section',
    title: 'Timeline',
    body: '{{timeline}}',
  },
  {
    kind: 'section',
    title: 'What {{client}} provides',
    body: 'A named sponsor, access to the people interviewed, and examples of the documents and systems in the workflow.',
  },
  {
    kind: 'terms',
    title: 'Terms',
    body:
      'Sample terms: replace with your own. Fees are invoiced as stated on each line. Either party may end the engagement ' +
      'with written notice; work completed to that date is billed. Confidential information stays confidential.',
  },
];

const placeholder = (over: Partial<LineInput> & Pick<LineInput, 'description'>): LineInput => ({
  kind: 'fixed', unitPriceCents: 0, quantityMilli: 1000, taxRateBps: 0, discount: null, optional: false, selected: false, ...over,
});

const LINES: LineInput[] = [
  placeholder({ description: 'Discovery interviews and workflow map (set your price)' }),
  placeholder({ description: 'Use-case scoring and readout (set your price)' }),
  placeholder({ kind: 'hourly', description: 'Advisory hours after the readout (set your hourly rate and hours)', quantityMilli: 10_000 }),
  placeholder({ kind: 'per_unit', description: 'Team workshop, per session (optional; set your price)', quantityMilli: 2_000, optional: true, selected: false }),
  placeholder({ description: 'First pilot plan with success measures (optional; set your price)', optional: true, selected: false }),
];

/** A fresh copy of the sample: the caller may mutate it. */
export function sampleTemplate(): TemplateInput {
  return { name: SAMPLE_TEMPLATE_NAME, sections: SECTIONS.map((s) => ({ ...s })), lines: LINES.map((l) => ({ ...l })) };
}
