import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeSha256 } from '@/lib/proposal/hash';
import {
  canApply,
  current,
  HashMismatchError,
  linkAccess,
  MissingHashError,
  newProposal,
  transition,
  TransitionError,
  VersionMismatchError,
  type BoundEventType,
  type Proposal,
  type ProposalEvent,
  type VersionStatus,
} from '@/lib/proposal/versioning';

const AT = '2026-11-14T12:00:00.000Z';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

const isBound = (t: ProposalEvent['type']): t is BoundEventType => t === 'view' || t === 'sign' || t === 'decline';
/** The event as an honest client page on the current version would send it (view/sign/decline name that version and its hash). */
const ev = (type: ProposalEvent['type'], p: Proposal, hash = H1): ProposalEvent => {
  if (type === 'send') return { type, pdfSha256: hash };
  if (isBound(type)) return { type, version: current(p).number, pdfSha256: current(p).pdfSha256 ?? hash };
  return { type };
};
const run = (...types: ProposalEvent['type'][]): Proposal =>
  types.reduce((p, t) => transition(p, ev(t, p), AT).proposal, newProposal(AT).proposal);

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
      expect(() => transition(p, ev(event, p), AT)).toThrow(TransitionError);
    } else {
      expect(current(transition(p, ev(event, p), AT).proposal).status).toBe(expected);
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

  it('send uses the same normalizer as verify: surrounding whitespace is trimmed, not rejected (D-15)', () => {
    const p = newProposal(AT).proposal;
    expect(current(transition(p, { type: 'send', pdfSha256: ` ${H2.toUpperCase()}\n` }, AT).proposal).pdfSha256).toBe(H2);
  });

  it('a rejected event leaves the proposal untouched', () => {
    const p = run('send', 'view', 'sign');
    const before = structuredClone(p);
    expect(() => transition(p, { type: 'edit' }, AT)).toThrow(TransitionError);
    expect(p).toEqual(before);
  });
});

describe('view, sign and decline are bound to a version and its PDF hash (D-16)', () => {
  /** v1 sent (H1) and viewed; the client's v1 page is still open. Then v1 is edited, v2 sent (H2) and viewed. */
  function v2SentWhileV1PageOpen() {
    const v1 = run('send', 'view');
    const stalePage = { version: 1, pdfSha256: H1 };
    const edited = transition(v1, { type: 'edit' }, AT).proposal;
    const sent = transition(edited, { type: 'send', pdfSha256: H2 }, AT).proposal;
    const viewed = transition(sent, { type: 'view', version: 2, pdfSha256: H2 }, AT).proposal;
    return { stalePage, sent, viewed };
  }

  it('a sign from a stale v1 page after v2 is sent is rejected, and v2 is not signed', () => {
    const { stalePage, viewed } = v2SentWhileV1PageOpen();
    const before = structuredClone(viewed);
    const attempt = () => transition(viewed, { type: 'sign', ...stalePage }, AT);
    expect(attempt).toThrow(VersionMismatchError);
    expect(attempt).toThrow('cannot sign version 1: version 2 is current');
    expect(viewed).toEqual(before);
    expect(current(viewed)).toMatchObject({ number: 2, status: 'viewed', pdfSha256: H2 });
  });

  it.each<BoundEventType>(['view', 'sign', 'decline'])('a stale-page %s is a version mismatch whatever v2’s status', (type) => {
    const { stalePage, sent, viewed } = v2SentWhileV1PageOpen();
    for (const p of [sent, viewed]) expect(() => transition(p, { type, ...stalePage }, AT)).toThrow(VersionMismatchError);
  });

  it('naming the current version with another version’s PDF hash is a hash mismatch', () => {
    const { viewed } = v2SentWhileV1PageOpen();
    expect(() => transition(viewed, { type: 'sign', version: 2, pdfSha256: H1 }, AT)).toThrow(HashMismatchError);
    expect(() => transition(viewed, { type: 'decline', version: 2, pdfSha256: 'not-a-hash' }, AT)).toThrow(HashMismatchError);
  });

  it('the hash on the event is compared in canonical form (case, surrounding whitespace)', () => {
    const { viewed } = v2SentWhileV1PageOpen();
    const { proposal, audit } = transition(viewed, { type: 'sign', version: 2, pdfSha256: ` ${H2.toUpperCase()} ` }, AT);
    expect(current(proposal)).toMatchObject({ number: 2, status: 'signed', pdfSha256: H2 });
    expect(audit).toMatchObject([{ action: 'version.signed', version: 2 }]);
  });

  it.each<BoundEventType>(['sign', 'decline', 'view'])('a %s on a version whose recorded hash is null is rejected', (type) => {
    // Not reachable through transition() (send always records a hash), but a row loaded from the database can carry null.
    const p: Proposal = { versions: [{ number: 1, status: 'viewed', pdfSha256: null, revision: 1 }] };
    const attempt = () => transition(p, { type, version: 1, pdfSha256: H1 }, AT);
    expect(attempt).toThrow(MissingHashError);
    expect(attempt).toThrow(`cannot ${type} version 1: it has no recorded PDF hash`);
  });

  it('a malformed recorded hash counts as missing', () => {
    const p: Proposal = { versions: [{ number: 1, status: 'viewed', pdfSha256: 'abc', revision: 1 }] };
    expect(() => transition(p, { type: 'sign', version: 1, pdfSha256: 'abc' }, AT)).toThrow(MissingHashError);
  });

  it('the new errors are TransitionErrors, so existing callers that catch TransitionError still catch them', () => {
    for (const E of [VersionMismatchError, MissingHashError, HashMismatchError]) expect(E.prototype).toBeInstanceOf(TransitionError);
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

const hexArb = fc.stringMatching(/^[0-9a-f]{64}$/);

/** How a view/sign/decline page relates to the proposal when it is submitted. Most are honest; the rest are stale or forged. */
type Aim = 'current' | 'stale' | 'future' | 'otherHash';
type Intent =
  | Exclude<ProposalEvent, { type: BoundEventType }>
  | { type: BoundEventType; aim: Aim; hash: string };

const intentArb: fc.Arbitrary<Intent> = fc.oneof(
  fc.constantFrom<Intent>({ type: 'expire' }, { type: 'edit' }),
  hexArb.map((h): Intent => ({ type: 'send', pdfSha256: h })),
  fc.record({
    type: fc.constantFrom<BoundEventType>('view', 'sign', 'decline'),
    aim: fc.constantFrom<Aim>('current', 'current', 'current', 'stale', 'future', 'otherHash'),
    hash: hexArb,
  }),
);

function resolve(i: Intent, p: Proposal): ProposalEvent {
  if (!('aim' in i)) return i;
  const c = current(p);
  const version = i.aim === 'stale' ? c.number - 1 : i.aim === 'future' ? c.number + 1 : c.number;
  let pdfSha256 = i.aim === 'otherHash' ? i.hash : (c.pdfSha256 ?? i.hash);
  if (i.aim === 'otherHash' && pdfSha256 === c.pdfSha256) pdfSha256 = pdfSha256 === H1 ? H2 : H1;
  return { type: i.type, version, pdfSha256 };
}

type Step = {
  before: Proposal;
  event: ProposalEvent;
  after: Proposal;
  audit: ReturnType<typeof transition>['audit'] | null;
  error: TransitionError | null;
};

function play(intents: Intent[]): { final: Proposal; steps: Step[] } {
  let p = newProposal(AT).proposal;
  const steps: Step[] = [];
  for (const intent of intents) {
    const event = resolve(intent, p);
    try {
      const r = transition(p, event, AT);
      steps.push({ before: p, event, after: r.proposal, audit: r.audit, error: null });
      p = r.proposal;
    } catch (e) {
      if (!(e instanceof TransitionError)) throw e;
      steps.push({ before: p, event, after: p, audit: null, error: e });
    }
  }
  return { final: p, steps };
}

describe('versioning properties', () => {
  const seqArb = fc.array(intentArb, { maxLength: 40 });

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

  it('a view, sign or decline lands only on the version and PDF it names, and is rejected with the right error otherwise (D-16)', () => {
    fc.assert(
      fc.property(seqArb, (events) => {
        for (const s of play(events).steps) {
          const e = s.event;
          if (e.type !== 'view' && e.type !== 'sign' && e.type !== 'decline') continue;
          const c = current(s.before);
          const versionOk = e.version === c.number;
          const hashOk = c.pdfSha256 !== null && normalizeSha256(e.pdfSha256) === c.pdfSha256;
          if (s.audit) {
            expect(versionOk && hashOk).toBe(true);
            expect(s.audit.map((a) => a.version)).toEqual([e.version]);
            expect(s.after.versions.find((v) => v.number === e.version)!.pdfSha256).toBe(normalizeSha256(e.pdfSha256));
          } else if (!versionOk) {
            expect(s.error).toBeInstanceOf(VersionMismatchError);
          } else if (canApply(s.before, e.type) && !hashOk) {
            expect(s.error).toBeInstanceOf(HashMismatchError);
          } else {
            expect(s.error?.constructor).toBe(TransitionError); // the status forbids it: same as before D-16
          }
        }
      }),
    );
  });

  it('every signed version was signed by an event naming that version and its recorded hash (D-16)', () => {
    fc.assert(
      fc.property(seqArb, (events) => {
        for (const s of play(events).steps) {
          if (s.event.type !== 'sign' || !s.audit) continue;
          const signed = s.after.versions.find((v) => v.status === 'signed')!;
          expect(signed.number).toBe(s.event.version);
          expect(signed.pdfSha256).toBe(normalizeSha256(s.event.pdfSha256));
        }
      }),
    );
  });

  it('with the recorded hash nulled out, no view, sign or decline is ever accepted (D-16)', () => {
    fc.assert(
      fc.property(seqArb, fc.constantFrom<BoundEventType>('view', 'sign', 'decline'), hexArb, (events, type, hash) => {
        const { final } = play(events);
        const c = current(final);
        const p: Proposal = { versions: [...final.versions.slice(0, -1), { ...c, pdfSha256: null }] };
        let err: unknown = null;
        try {
          transition(p, { type, version: c.number, pdfSha256: c.pdfSha256 ?? hash }, AT);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(TransitionError);
        if (canApply(p, type)) expect(err).toBeInstanceOf(MissingHashError);
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
