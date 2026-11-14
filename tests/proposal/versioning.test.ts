import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canApply,
  current,
  linkAccess,
  newProposal,
  transition,
  TransitionError,
  type Proposal,
  type ProposalEvent,
  type VersionStatus,
} from '@/lib/proposal/versioning';

const AT = '2026-11-14T12:00:00.000Z';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

const ev = (type: ProposalEvent['type'], hash = H1): ProposalEvent => (type === 'send' ? { type, pdfSha256: hash } : { type });
const run = (...types: ProposalEvent['type'][]): Proposal =>
  types.reduce((p, t) => transition(p, ev(t), AT).proposal, newProposal(AT).proposal);

describe('transition table', () => {
  // [path to reach the state, event, resulting status of the current version, or 'reject']
  const table: [string, ProposalEvent['type'][], ProposalEvent['type'], VersionStatus | 'reject'][] = [
    ['draft', [], 'send', 'sent'],
    ['draft', [], 'edit', 'draft'],
    ['draft', [], 'view', 'reject'],
    ['draft', [], 'sign', 'reject'],
    ['draft', [], 'decline', 'reject'],
    ['draft', [], 'expire', 'reject'],
    ['sent', ['send'], 'view', 'viewed'],
    ['sent', ['send'], 'expire', 'expired'],
    ['sent', ['send'], 'edit', 'draft'],
    ['sent', ['send'], 'send', 'reject'],
    ['sent', ['send'], 'sign', 'reject'], // must view first
    ['sent', ['send'], 'decline', 'reject'],
    ['viewed', ['send', 'view'], 'view', 'viewed'],
    ['viewed', ['send', 'view'], 'sign', 'signed'],
    ['viewed', ['send', 'view'], 'decline', 'declined'],
    ['viewed', ['send', 'view'], 'expire', 'expired'],
    ['viewed', ['send', 'view'], 'edit', 'draft'],
    ['viewed', ['send', 'view'], 'send', 'reject'],
    ['declined', ['send', 'view', 'decline'], 'edit', 'draft'],
    ['declined', ['send', 'view', 'decline'], 'sign', 'reject'],
    ['declined', ['send', 'view', 'decline'], 'view', 'reject'],
    ['expired', ['send', 'expire'], 'edit', 'draft'],
    ['expired', ['send', 'expire'], 'sign', 'reject'],
    ['expired', ['send', 'expire'], 'view', 'reject'],
    ['signed', ['send', 'view', 'sign'], 'edit', 'reject'],
    ['signed', ['send', 'view', 'sign'], 'sign', 'reject'],
    ['signed', ['send', 'view', 'sign'], 'decline', 'reject'],
    ['signed', ['send', 'view', 'sign'], 'expire', 'reject'],
    ['signed', ['send', 'view', 'sign'], 'view', 'reject'],
  ];
  it.each(table)('%s + %s… → %s', (_from, path, event, expected) => {
    const p = run(...path);
    expect(canApply(p, event)).toBe(expected !== 'reject');
    if (expected === 'reject') {
      expect(() => transition(p, ev(event), AT)).toThrow(TransitionError);
    } else {
      expect(current(transition(p, ev(event), AT).proposal).status).toBe(expected);
    }
  });
});

describe('supersede rules', () => {
  it('an edit after send freezes the old version and opens v+1 as a draft', () => {
    const p = run('send', 'view');
    const { proposal, audit } = transition(p, { type: 'edit' }, AT);
    expect(proposal.versions).toEqual([
      { number: 1, status: 'superseded', pdfSha256: H1, revision: 1 },
      { number: 2, status: 'draft', pdfSha256: null, revision: 1 },
    ]);
    expect(audit.map((a) => [a.action, a.version, a.from, a.to])).toEqual([
      ['version.superseded', 1, 'viewed', 'superseded'],
      ['version.created', 2, null, 'draft'],
    ]);
  });

  it('an edit to a draft stays on the same version and bumps the revision', () => {
    const p = run('edit', 'edit');
    expect(p.versions).toEqual([{ number: 1, status: 'draft', pdfSha256: null, revision: 3 }]);
  });

  it('send records the PDF hash (lower-cased) and rejects a malformed one', () => {
    const p = newProposal(AT).proposal;
    expect(current(transition(p, { type: 'send', pdfSha256: H2.toUpperCase() }, AT).proposal).pdfSha256).toBe(H2);
    expect(() => transition(p, { type: 'send', pdfSha256: 'abc' }, AT)).toThrow(TypeError);
  });

  it('a rejected event leaves the proposal untouched', () => {
    const p = run('send', 'view', 'sign');
    const before = structuredClone(p);
    expect(() => transition(p, { type: 'edit' }, AT)).toThrow(TransitionError);
    expect(p).toEqual(before);
  });
});

describe('linkAccess (CS-03)', () => {
  it.each<[string, ProposalEvent['type'][], number, number, string]>([
    ['sent link works', ['send'], 1, 200, 'active'],
    ['viewed link works', ['send', 'view'], 1, 200, 'active'],
    ['signed link is read-only', ['send', 'view', 'sign'], 1, 200, 'completed'],
    ['superseded link is gone', ['send', 'edit'], 1, 410, 'superseded'],
    ['superseded after resend is still gone', ['send', 'view', 'edit', 'send'], 1, 410, 'superseded'],
    ['the new version link works after resend', ['send', 'view', 'edit', 'send'], 2, 200, 'active'],
    ['declined link is closed', ['send', 'view', 'decline'], 1, 410, 'closed'],
    ['expired link is closed', ['send', 'expire'], 1, 410, 'closed'],
    ['draft has no link', [], 1, 404, 'not_found'],
    ['unknown version', ['send'], 7, 404, 'not_found'],
  ])('%s', (_name, path, version, code, state) => {
    expect(linkAccess(run(...path), version)).toMatchObject({ code, state });
  });
});

// ---------- properties: random event sequences ----------

const eventArb: fc.Arbitrary<ProposalEvent> = fc.oneof(
  fc.constantFrom<ProposalEvent>({ type: 'view' }, { type: 'sign' }, { type: 'decline' }, { type: 'expire' }, { type: 'edit' }),
  fc.stringMatching(/^[0-9a-f]{64}$/).map((h): ProposalEvent => ({ type: 'send', pdfSha256: h })),
);

type Step = { before: Proposal; event: ProposalEvent; after: Proposal; audit: ReturnType<typeof transition>['audit'] | null };

function play(events: ProposalEvent[]): { final: Proposal; steps: Step[] } {
  let p = newProposal(AT).proposal;
  const steps: Step[] = [];
  for (const event of events) {
    try {
      const r = transition(p, event, AT);
      steps.push({ before: p, event, after: r.proposal, audit: r.audit });
      p = r.proposal;
    } catch (e) {
      if (!(e instanceof TransitionError)) throw e;
      steps.push({ before: p, event, after: p, audit: null });
    }
  }
  return { final: p, steps };
}

describe('versioning properties', () => {
  const seqArb = fc.array(eventArb, { maxLength: 40 });

  it('at most one live version; numbers run 1..n; every earlier version is superseded', () => {
    fc.assert(
      fc.property(seqArb, (events) => {
        const { final } = play(events);
        expect(final.versions.map((v) => v.number)).toEqual(final.versions.map((_, i) => i + 1));
        expect(final.versions.slice(0, -1).every((v) => v.status === 'superseded')).toBe(true);
        expect(current(final).status).not.toBe('superseded');
      }),
    );
  });

  it('every status change, and every version created, has an audit event (CS-04, pure half)', () => {
    fc.assert(
      fc.property(seqArb, (events) => {
        for (const s of play(events).steps) {
          if (!s.audit) continue;
          const changes = s.after.versions.flatMap((v) => {
            const was = s.before.versions.find((b) => b.number === v.number);
            return !was ? [[v.number, null, v.status]] : was.status !== v.status ? [[v.number, was.status, v.status]] : [];
          });
          const audited = s.audit.filter((a) => a.from !== a.to).map((a) => [a.version, a.from, a.to]);
          expect(audited).toEqual(changes);
          expect(s.audit.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('once a version is sent its hash never changes, and a signed version never changes at all (CS-02 side)', () => {
    fc.assert(
      fc.property(seqArb, (events) => {
        const { steps } = play(events);
        for (const s of steps) {
          for (const b of s.before.versions) {
            const a = s.after.versions.find((v) => v.number === b.number)!;
            expect(a).toBeDefined();
            if (b.pdfSha256 !== null) expect(a.pdfSha256).toBe(b.pdfSha256);
            if (b.status === 'signed' || b.status === 'superseded') expect(a).toEqual(b);
          }
        }
      }),
    );
  });

  it('a superseded version link always answers 410 (CS-03)', () => {
    fc.assert(
      fc.property(seqArb, (events) => {
        const { final } = play(events);
        for (const v of final.versions.filter((x) => x.status === 'superseded')) expect(linkAccess(final, v.number).code).toBe(410);
      }),
    );
  });
});
