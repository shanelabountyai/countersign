// Countersign proposal versioning: pure state machine + supersede rules (CS-03, and the pure half of CS-04).
// Table and rules: docs/countersign/PHASE1_PLAN.md. Nothing here touches the database or the clock: callers pass `at`.
import { normalizeSha256 } from './sha256-hex';

export type VersionStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired' | 'superseded';

export type Version = {
  number: number;
  status: VersionStatus;
  /** SHA-256 hex of the exact PDF bytes, frozen once the version is sent (CS-02). */
  pdfSha256: string | null;
  /** Opaque content revision, bumped by in-place edits while still a draft. */
  revision: number;
};

export type Proposal = { versions: readonly Version[] };

/**
 * The version and exact PDF the client's page was showing (D-16). A view, sign or decline acts on that version only: it is
 * rejected if another version is current, if the version has no recorded hash, or if the hash differs from the one
 * recorded at send. Never "whatever is current now".
 */
export type VersionRef = { version: number; pdfSha256: string };

export type ProposalEvent =
  | { type: 'send'; pdfSha256: string }
  | ({ type: 'view' } & VersionRef)
  | ({ type: 'sign' } & VersionRef)
  | ({ type: 'decline' } & VersionRef)
  | { type: 'expire' }
  | { type: 'edit' };

export type BoundEventType = 'view' | 'sign' | 'decline';

export type AuditAction =
  | 'version.created'
  | 'version.edited'
  | 'version.sent'
  | 'version.viewed'
  | 'version.signed'
  | 'version.declined'
  | 'version.expired'
  | 'version.superseded';

export type AuditEvent = { action: AuditAction; version: number; from: VersionStatus | null; to: VersionStatus; at: string };

export type TransitionResult = { proposal: Proposal; audit: AuditEvent[] };

export class TransitionError extends Error {
  override name = 'TransitionError';
  constructor(
    readonly from: VersionStatus,
    readonly event: ProposalEvent['type'],
  ) {
    super(`cannot ${event} a ${from} version`);
  }
}

/** The event names a version that is not the current one, e.g. a sign from a stale v1 page after v2 was sent. */
export class VersionMismatchError extends TransitionError {
  override name = 'VersionMismatchError';
  constructor(
    from: VersionStatus,
    event: BoundEventType,
    readonly requested: number,
    readonly currentVersion: number,
  ) {
    super(from, event);
    this.message = `cannot ${event} version ${requested}: version ${currentVersion} is current`;
  }
}

/** The named version has no valid recorded PDF hash, so there is nothing the client can be shown to have agreed to. */
export class MissingHashError extends TransitionError {
  override name = 'MissingHashError';
  constructor(
    from: VersionStatus,
    event: BoundEventType,
    readonly versionNumber: number,
  ) {
    super(from, event);
    this.message = `cannot ${event} version ${versionNumber}: it has no recorded PDF hash`;
  }
}

/** The PDF hash on the event is not the one recorded when the version was sent. */
export class HashMismatchError extends TransitionError {
  override name = 'HashMismatchError';
  constructor(
    from: VersionStatus,
    event: BoundEventType,
    readonly versionNumber: number,
  ) {
    super(from, event);
    this.message = `cannot ${event} version ${versionNumber}: the PDF hash does not match the one recorded at send`;
  }
}

export const TERMINAL: readonly VersionStatus[] = ['signed', 'superseded'];
const SUPERSEDABLE: readonly VersionStatus[] = ['sent', 'viewed', 'declined', 'expired'];

export function newProposal(at: string): TransitionResult {
  const v: Version = { number: 1, status: 'draft', pdfSha256: null, revision: 1 };
  return { proposal: { versions: [v] }, audit: [{ action: 'version.created', version: 1, from: null, to: 'draft', at }] };
}

export function current(p: Proposal): Version {
  const v = p.versions.at(-1);
  if (!v) throw new Error('a proposal has at least one version');
  return v;
}

/** The status the event moves the current version to, or null if it is not allowed. `edit` is handled separately. */
function next(from: VersionStatus, event: Exclude<ProposalEvent['type'], 'edit'>): VersionStatus | null {
  switch (event) {
    case 'send':
      return from === 'draft' ? 'sent' : null;
    case 'view':
      return from === 'sent' || from === 'viewed' ? 'viewed' : null;
    case 'sign':
      return from === 'viewed' ? 'signed' : null; // the client has opened the link first
    case 'decline':
      return from === 'viewed' ? 'declined' : null;
    case 'expire':
      return from === 'sent' || from === 'viewed' ? 'expired' : null;
  }
}

/** Whether the current version's status allows the event. It does not check a view/sign/decline's version or hash. */
export function canApply(p: Proposal, event: ProposalEvent['type']): boolean {
  const from = current(p).status;
  if (event === 'edit') return from === 'draft' || SUPERSEDABLE.includes(from);
  return next(from, event) !== null;
}

export function transition(p: Proposal, event: ProposalEvent, at: string): TransitionResult {
  const cur = current(p);
  const head = p.versions.slice(0, -1);
  const from = cur.status;

  if (event.type === 'edit') {
    if (from === 'draft') {
      const v = { ...cur, revision: cur.revision + 1 };
      return { proposal: { versions: [...head, v] }, audit: [{ action: 'version.edited', version: cur.number, from, to: 'draft', at }] };
    }
    if (!SUPERSEDABLE.includes(from)) throw new TransitionError(from, 'edit');
    // Supersede: the old version is frozen as-is (hash kept) and its signing link stops working (CS-03).
    const old: Version = { ...cur, status: 'superseded' };
    const fresh: Version = { number: cur.number + 1, status: 'draft', pdfSha256: null, revision: 1 };
    return {
      proposal: { versions: [...head, old, fresh] },
      audit: [
        { action: 'version.superseded', version: cur.number, from, to: 'superseded', at },
        { action: 'version.created', version: fresh.number, from: null, to: 'draft', at },
      ],
    };
  }

  const bound = event.type === 'view' || event.type === 'sign' || event.type === 'decline' ? event : null;
  // A stale page is answered as stale first, whatever the current version's status (D-16).
  if (bound && bound.version !== cur.number) throw new VersionMismatchError(from, bound.type, bound.version, cur.number);
  const to = next(from, event.type);
  if (!to) throw new TransitionError(from, event.type);
  if (bound) {
    const recorded = cur.pdfSha256 === null ? null : normalizeSha256(cur.pdfSha256);
    if (!recorded) throw new MissingHashError(from, bound.type, cur.number);
    if (normalizeSha256(bound.pdfSha256) !== recorded) throw new HashMismatchError(from, bound.type, cur.number);
  }
  let v: Version = { ...cur, status: to };
  if (event.type === 'send') {
    const hash = normalizeSha256(event.pdfSha256);
    if (!hash) throw new TypeError('send needs the PDF SHA-256 as 64 hex characters');
    v = { ...v, pdfSha256: hash };
  }
  const action: AuditAction = `version.${({ send: 'sent', view: 'viewed', sign: 'signed', decline: 'declined', expire: 'expired' } as const)[event.type]}`;
  return { proposal: { versions: [...head, v] }, audit: [{ action, version: cur.number, from, to, at }] };
}

export type LinkAccess =
  | { code: 200; state: 'active' | 'completed'; version: Version }
  | { code: 410; state: 'superseded' | 'closed'; version: Version }
  | { code: 404; state: 'not_found' };

/**
 * What a signing link for `versionNumber` may do. Only the current version's link works; a superseded version's link
 * is gone (410, CS-03), as is a declined or expired one. A signed current version stays readable (200, completed).
 */
export function linkAccess(p: Proposal, versionNumber: number): LinkAccess {
  const v = p.versions.find((x) => x.number === versionNumber);
  if (!v) return { code: 404, state: 'not_found' };
  if (v.status === 'superseded') return { code: 410, state: 'superseded', version: v };
  if (v !== current(p)) return { code: 410, state: 'superseded', version: v }; // defensive: only the last is live
  if (v.status === 'sent' || v.status === 'viewed') return { code: 200, state: 'active', version: v };
  if (v.status === 'signed') return { code: 200, state: 'completed', version: v };
  if (v.status === 'draft') return { code: 404, state: 'not_found' }; // never sent: no link exists yet
  return { code: 410, state: 'closed', version: v };
}
