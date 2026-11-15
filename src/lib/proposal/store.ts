// Countersign persistence (Phase 2): templates, proposals and the Phase 1 state machine on Postgres.
// Not pure: this is the one place the pure modules meet the database. Every read and write runs inside withOrg, and
// every state transition writes one audit event per event the pure transition() returns (CS-04). The database refuses
// changes to a version that has left draft (D-21), so a bug here cannot rewrite a sent or signed document.
import { notFound } from 'next/navigation';
import { audit } from '@/core/audit';
import type { OrgCtx } from '@/core/authz/guards';
import { now } from '@/core/clock';
import { withOrg, type Tx } from '@/core/db/rls';
import { Refused } from '@/core/errors';
import { env } from '@/core/env';
import { hashToken, newToken } from '@/core/tokens';
import type { DiscountType, DocumentKind, LineKind as DbLineKind, ProposalStatus, SectionKind } from '@/generated/prisma/enums';
import { sha256Hex } from './hash';
import { renderProposalPdf, type ProposalPdfModel } from './pdf';
import { describeChars, unsupportedChars } from './pdf-text';
import { renderMerge, unknownFields, type MergeValues } from './merge';
import { LIMITS, price, PricingError, type Discount, type LineItem, type LineKind, type PricingResult } from './pricing';
import { current, newProposal, transition, type AuditEvent, type Proposal, type ProposalEvent, type TransitionResult, type Version } from './versioning';

/** Who causes a write: a member (OrgCtx) or, for the client's signing events and the cron, no user (D-38). */
export type Actor = { orgId: string; userId: string | null };

// ---- input shapes (already parsed from the form: integers, no strings for numbers)

export type SectionInput = { kind: SectionKind; title: string; body: string };
export type LineInput = {
  kind: LineKind;
  description: string;
  unitPriceCents: number;
  quantityMilli: number;
  taxRateBps: number;
  discount: Discount | null;
  optional: boolean;
  selected: boolean;
};
export type TemplateInput = { name: string; sections: SectionInput[]; lines: LineInput[] };
export type DraftInput = {
  title: string;
  clientName: string;
  clientEmail: string;
  scope: string;
  timeline: string;
  discount: Discount | null;
  sections: SectionInput[];
  lines: LineInput[];
};

export const CONTENT_LIMITS = { sections: 50, lines: 200, title: 200, body: 20_000, description: 500, name: 120, field: 2000 } as const;

/** D-24: owner, admin and member edit templates and proposals; a scorekeeper does not. */
export function assertEditor(ctx: Pick<OrgCtx, 'role'>) {
  if (ctx.role === 'scorekeeper') throw new Refused('Your role cannot edit proposals or templates.');
}

/** A database refusal from the D-21 freeze triggers, re-raised as a Refused with a message for the editor. */
export class FrozenError extends Refused {
  constructor() {
    super('This version has been sent, so it can no longer be changed in place. Reload and edit again to create a new version.');
  }
}
const isFrozen = (e: unknown) => e instanceof Error && e.message.includes('countersign_frozen:');

// ---- validation (pure; throws Refused with a message the form can show)

function text(what: string, s: string, max: number, required = false) {
  if (required && !s.trim()) throw new Refused(`${what} is required.`);
  if (s.length > max) throw new Refused(`${what} is longer than ${max} characters.`);
}

function checkMerge(where: string, s: string) {
  const bad = unknownFields(s);
  if (bad.length) throw new Refused(`${where} uses an unknown merge field: ${bad.map((b) => `{{${b}}}`).join(', ')}. Use {{client}}, {{scope}} or {{timeline}}.`);
}

/** Pricing on the input as it would be saved, which also validates every number against the pricing limits. */
function priced(lines: readonly LineInput[], discount: Discount | null): PricingResult {
  try {
    return price({ lines: lines.map((l, i) => toLineItem(`line-${String(i).padStart(4, '0')}`, l)), ...(discount ? { discount } : {}) });
  } catch (e) {
    if (e instanceof PricingError) throw new Refused(`Check the amounts: ${e.message.replace(/line line-0*(\d+)/, (_, n: string) => `line ${Number(n) + 1}`)}.`);
    throw e;
  }
}

export function validateContent(c: { sections: readonly SectionInput[]; lines: readonly LineInput[]; discount: Discount | null }) {
  if (c.sections.length > CONTENT_LIMITS.sections) throw new Refused(`At most ${CONTENT_LIMITS.sections} sections.`);
  if (c.lines.length > Math.min(CONTENT_LIMITS.lines, LIMITS.lines)) throw new Refused(`At most ${CONTENT_LIMITS.lines} line items.`);
  c.sections.forEach((s, i) => {
    text(`Section ${i + 1} title`, s.title, CONTENT_LIMITS.title, true);
    text(`Section ${i + 1} text`, s.body, CONTENT_LIMITS.body);
    checkMerge(`Section ${i + 1}`, `${s.title}\n${s.body}`);
  });
  c.lines.forEach((l, i) => text(`Line ${i + 1} description`, l.description, CONTENT_LIMITS.description, true));
  priced(c.lines, c.discount);
}

export function validateTemplate(t: TemplateInput) {
  text('Template name', t.name, CONTENT_LIMITS.name, true);
  validateContent({ ...t, discount: null });
}

export function validateDraft(d: DraftInput) {
  text('Title', d.title, CONTENT_LIMITS.title, true);
  text('Client', d.clientName, CONTENT_LIMITS.name, true);
  text('Client email', d.clientEmail, CONTENT_LIMITS.name);
  text('Scope', d.scope, CONTENT_LIMITS.field);
  text('Timeline', d.timeline, CONTENT_LIMITS.field);
  validateContent(d);
}

// ---- row ↔ pure conversions

type LineRow = {
  id: string;
  kind: DbLineKind;
  description: string;
  unitPriceCents: bigint;
  quantityMilli: number;
  taxRateBps: number;
  discountType: DiscountType | null;
  discountValue: bigint | null;
  optional: boolean;
  selected: boolean;
};

export const toDiscount = (type: DiscountType | null, value: bigint | null): Discount | null =>
  type === null || value === null ? null : type === 'percent' ? { type: 'percent', bps: Number(value) } : { type: 'fixed', cents: Number(value) };

const fromDiscount = (d: Discount | null) =>
  d ? { discountType: d.type as DiscountType, discountValue: BigInt(d.type === 'percent' ? d.bps : d.cents) } : { discountType: null, discountValue: null };

export function toLineInput(r: LineRow): LineInput {
  return {
    kind: r.kind,
    description: r.description,
    unitPriceCents: Number(r.unitPriceCents),
    quantityMilli: r.quantityMilli,
    taxRateBps: r.taxRateBps,
    discount: toDiscount(r.discountType, r.discountValue),
    optional: r.optional,
    selected: r.selected,
  };
}

export function toLineItem(id: string, l: LineInput): LineItem {
  return {
    id,
    kind: l.kind,
    unitPriceCents: l.unitPriceCents,
    quantityMilli: l.kind === 'fixed' ? 1000 : l.quantityMilli,
    taxRateBps: l.taxRateBps,
    ...(l.discount ? { discount: l.discount } : {}),
    optional: l.optional,
    selected: l.selected,
  };
}

const lineData = (orgId: string, l: LineInput, position: number) => ({
  orgId,
  position,
  kind: l.kind,
  description: l.description,
  unitPriceCents: BigInt(l.unitPriceCents),
  quantityMilli: l.kind === 'fixed' ? 1000 : l.quantityMilli,
  taxRateBps: l.taxRateBps,
  ...fromDiscount(l.discount),
  optional: l.optional,
  selected: l.optional ? l.selected : false,
});

const sectionData = (orgId: string, s: SectionInput, position: number) => ({ orgId, position, kind: s.kind, title: s.title, body: s.body });

/** Prices persisted lines using their row ids (stable, unique), as the pricing tie-break rule expects. */
export function priceRows(lines: readonly LineRow[], discount: Discount | null): PricingResult {
  return price({ lines: lines.map((r) => toLineItem(r.id, toLineInput(r))), ...(discount ? { discount } : {}) });
}

// ---- templates

const order = { orderBy: { position: 'asc' as const } };

export async function listTemplates(ctx: OrgCtx) {
  return withOrg(ctx, (tx) => tx.template.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true, updatedAt: true } }), { atomic: false });
}

export async function getTemplate(ctx: OrgCtx, id: string) {
  const t = await withOrg(ctx, (tx) => tx.template.findFirst({ where: { id, orgId: ctx.orgId }, include: { sections: order, lines: order } }), { atomic: false });
  if (!t) notFound();
  return t;
}

export async function createTemplate(ctx: OrgCtx, input: TemplateInput): Promise<string> {
  assertEditor(ctx);
  validateTemplate(input);
  return withOrg(ctx, async (tx) => {
    const t = await tx.template.create({
      data: {
        orgId: ctx.orgId,
        name: input.name.trim(),
        sections: { create: input.sections.map((s, i) => sectionData(ctx.orgId, s, i)) },
        lines: { create: input.lines.map((l, i) => lineData(ctx.orgId, l, i)) },
      },
    });
    await audit(ctx, 'template.created', { targetType: 'template', targetId: t.id }, tx);
    return t.id;
  });
}

export async function updateTemplate(ctx: OrgCtx, id: string, input: TemplateInput) {
  assertEditor(ctx);
  await withOrg(ctx, async (tx) => {
    const t = await tx.template.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!t) notFound(); // before validation: another org's id and a missing id answer the same (INV-04)
    validateTemplate(input);
    await tx.templateSection.deleteMany({ where: { templateId: id, orgId: ctx.orgId } });
    await tx.templateLine.deleteMany({ where: { templateId: id, orgId: ctx.orgId } });
    await tx.template.update({
      where: { id },
      data: {
        name: input.name.trim(),
        sections: { create: input.sections.map((s, i) => sectionData(ctx.orgId, s, i)) },
        lines: { create: input.lines.map((l, i) => lineData(ctx.orgId, l, i)) },
      },
    });
    await audit(ctx, 'template.updated', { targetType: 'template', targetId: id }, tx);
  });
}

export async function deleteTemplate(ctx: OrgCtx, id: string) {
  assertEditor(ctx);
  await withOrg(ctx, async (tx) => {
    const { count } = await tx.template.deleteMany({ where: { id, orgId: ctx.orgId } });
    if (count !== 1) notFound();
    await audit(ctx, 'template.deleted', { targetType: 'template', targetId: id }, tx);
  });
}

// ---- proposals: reads

const versionInclude = { sections: order, lines: order } as const;

async function lockProposal(tx: Tx, ctx: Actor, id: string) {
  // One writer per proposal at a time: version numbers and the current version are decided under this lock.
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Proposal" WHERE id = ${id}::uuid AND "orgId" = ${ctx.orgId}::uuid FOR UPDATE`;
  if (rows.length !== 1) notFound();
}

export async function versionsOf(tx: Tx, ctx: Actor, proposalId: string) {
  return tx.proposalVersion.findMany({ where: { proposalId, orgId: ctx.orgId }, orderBy: { number: 'asc' }, include: versionInclude });
}
export type VersionRow = Awaited<ReturnType<typeof versionsOf>>[number];

export const toPure = (rows: readonly Pick<VersionRow, 'number' | 'status' | 'pdfSha256' | 'revision'>[]): Proposal => ({
  versions: rows.map((r) => ({ number: r.number, status: r.status, pdfSha256: r.pdfSha256, revision: r.revision })),
});

export function mergeValues(v: Pick<VersionRow, 'clientName' | 'scope' | 'timeline'>): MergeValues {
  return { client: v.clientName, scope: v.scope, timeline: v.timeline };
}

/** A version as the editor and (later) the PDF see it: content, merged section text and pricing. */
export function presentVersion(v: VersionRow) {
  const discount = toDiscount(v.discountType, v.discountValue);
  const values = mergeValues(v);
  return {
    ...v,
    discount,
    lines: v.lines.map((l) => ({ ...l, input: toLineInput(l) })),
    sections: v.sections.map((s) => ({ ...s, rendered: renderMerge(s.body, values), renderedTitle: renderMerge(s.title, values) })),
    pricing: priceRows(v.lines, discount),
  };
}

export async function getProposal(ctx: OrgCtx, id: string) {
  const found = await withOrg(ctx, async (tx) => {
    const p = await tx.proposal.findFirst({ where: { id, orgId: ctx.orgId }, include: { template: { select: { id: true, name: true } } } });
    return p ? { proposal: p, versions: await versionsOf(tx, ctx, id) } : null;
  }, { atomic: false });
  if (!found || found.versions.length === 0) notFound();
  const pure = toPure(found.versions);
  const cur = found.versions.at(-1)!;
  return { ...found, pure, current: presentVersion(cur) };
}

export async function listProposals(ctx: OrgCtx) {
  const rows = await withOrg(ctx, (tx) =>
    tx.proposal.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { updatedAt: 'desc' },
      include: { versions: { orderBy: { number: 'desc' }, take: 1, include: { lines: order } } },
    }), { atomic: false });
  return rows.flatMap((p) => {
    const v = p.versions[0];
    if (!v) return [];
    return [{ id: p.id, updatedAt: p.updatedAt, number: v.number, status: v.status, title: v.title, clientName: v.clientName, totalCents: priceRows(v.lines, toDiscount(v.discountType, v.discountValue)).totalCents }];
  });
}

// ---- proposals: writes

/** Extra fields on a transition's audit rows: the client metadata of a signing event (D-34). Strings only. */
export type AuditExtra = Readonly<Record<string, string | null>>;

async function writeAudit(tx: Tx, ctx: Actor, proposalId: string, events: readonly AuditEvent[], idOf: (n: number) => string, hashOf: (n: number) => string | null = () => null, extra: AuditExtra = {}) {
  for (const e of events) {
    const data = { ...extra, proposalId, version: e.version, from: e.from, to: e.to, at: e.at, pdfSha256: hashOf(e.version) };
    await audit(ctx, `proposal.${e.action}`, { targetType: 'proposalVersion', targetId: idOf(e.version), data }, tx);
  }
}

async function createVersion(tx: Tx, ctx: Actor, proposalId: string, v: Version, d: DraftInput, at: Date) {
  return tx.proposalVersion.create({
    data: {
      orgId: ctx.orgId,
      proposalId,
      number: v.number,
      status: 'draft',
      statusAt: at,
      revision: v.revision,
      title: d.title.trim(),
      clientName: d.clientName.trim(),
      clientEmail: d.clientEmail.trim(),
      scope: d.scope,
      timeline: d.timeline,
      ...fromDiscount(d.discount),
      sections: { create: d.sections.map((s, i) => sectionData(ctx.orgId, s, i)) },
      lines: { create: d.lines.map((l, i) => lineData(ctx.orgId, l, i)) },
    },
    select: { id: true },
  });
}

/**
 * Writes what transition() decided: status, revision and hash changes on existing versions, a new draft for a
 * supersede, the draft's content for an in-place edit, and one audit row per pure audit event, in order.
 */
async function persist(tx: Tx, ctx: Actor, proposalId: string, before: readonly VersionRow[], result: TransitionResult, at: Date, content?: DraftInput, extra: AuditExtra = {}) {
  const ids = new Map(before.map((r) => [r.number, r.id]));
  for (const v of result.proposal.versions) {
    const old = before.find((r) => r.number === v.number);
    if (!old) {
      if (!content) throw new Error('a new version needs content');
      ids.set(v.number, (await createVersion(tx, ctx, proposalId, v, content, at)).id);
      continue;
    }
    const statusChanged = old.status !== v.status;
    const inPlace = v.status === 'draft' && v.revision !== old.revision;
    const repeatView = result.audit.some((e) => e.version === v.number && e.action === 'version.viewed' && e.from === 'viewed');
    if (!statusChanged && !inPlace && old.pdfSha256 === v.pdfSha256 && !repeatView) continue;
    await tx.proposalVersion.update({
      where: { id: old.id },
      data: {
        status: v.status as ProposalStatus,
        ...(statusChanged || repeatView ? { statusAt: at } : {}),
        ...(old.pdfSha256 !== v.pdfSha256 ? { pdfSha256: v.pdfSha256 } : {}),
        ...(inPlace && content
          ? {
              revision: v.revision,
              title: content.title.trim(),
              clientName: content.clientName.trim(),
              clientEmail: content.clientEmail.trim(),
              scope: content.scope,
              timeline: content.timeline,
              ...fromDiscount(content.discount),
            }
          : {}),
      },
    });
    if (inPlace && content) {
      await tx.proposalSection.deleteMany({ where: { versionId: old.id, orgId: ctx.orgId } });
      await tx.proposalLine.deleteMany({ where: { versionId: old.id, orgId: ctx.orgId } });
      await tx.proposalSection.createMany({ data: content.sections.map((s, i) => ({ versionId: old.id, ...sectionData(ctx.orgId, s, i) })) });
      await tx.proposalLine.createMany({ data: content.lines.map((l, i) => ({ versionId: old.id, ...lineData(ctx.orgId, l, i) })) });
    }
  }
  await tx.proposal.update({ where: { id: proposalId }, data: { updatedAt: at } });
  const hashes = new Map(result.proposal.versions.map((v) => [v.number, v.pdfSha256]));
  await writeAudit(tx, ctx, proposalId, result.audit, (n) => ids.get(n)!, (n) => hashes.get(n) ?? null, extra);
  return ids;
}

const frozenAware = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (isFrozen(e)) throw new FrozenError();
    throw e;
  }
};

export type NewProposalInput = { templateId: string | null; title: string; clientName: string };

/** A new proposal, v1 draft. From a template: its sections and lines are copied (D-20); later template edits do not reach it. */
export async function createProposal(ctx: OrgCtx, input: NewProposalInput): Promise<string> {
  assertEditor(ctx);
  return withOrg(ctx, async (tx) => {
    const t = input.templateId
      ? await tx.template.findFirst({ where: { id: input.templateId, orgId: ctx.orgId }, include: { sections: order, lines: order } })
      : null;
    if (input.templateId && !t) notFound();
    const draft: DraftInput = {
      title: input.title,
      clientName: input.clientName,
      clientEmail: '',
      scope: '',
      timeline: '',
      discount: null,
      sections: (t?.sections ?? []).map((s) => ({ kind: s.kind, title: s.title, body: s.body })),
      lines: (t?.lines ?? []).map(toLineInput),
    };
    validateDraft(draft);
    const at = now();
    const p = await tx.proposal.create({ data: { orgId: ctx.orgId, templateId: t?.id ?? null, createdById: ctx.userId }, select: { id: true } });
    const { proposal, audit: events } = newProposal(at.toISOString());
    const v = await createVersion(tx, ctx, p.id, current(proposal), draft, at);
    await writeAudit(tx, ctx, p.id, events, () => v.id);
    return p.id;
  });
}

export type SaveResult = { version: number; superseded: boolean };

/**
 * Saves the editor's content. On a draft: in place, revision + 1, only if `expected` still names the current version and
 * revision (D-26). On a sent, viewed, declined or expired version: supersede (old version frozen, new v+1 draft holding the
 * edited content), only if `expected.version` is still current. A signed proposal is refused.
 */
export async function saveDraft(ctx: OrgCtx, proposalId: string, expected: { version: number; revision: number }, input: DraftInput): Promise<SaveResult> {
  assertEditor(ctx);
  return frozenAware(() => withOrg(ctx, async (tx) => {
    await lockProposal(tx, ctx, proposalId); // notFound first, before validation (INV-04)
    validateDraft(input);
    const before = await versionsOf(tx, ctx, proposalId);
    const cur = before.at(-1);
    if (!cur) notFound();
    if (cur.number !== expected.version || (cur.status === 'draft' && cur.revision !== expected.revision)) {
      throw new Refused('This proposal changed since you opened it. Reload to see the latest version, then edit again.');
    }
    if (cur.status === 'signed') throw new Refused('This proposal is signed and can no longer be edited.');
    const at = now();
    const result = transition(toPure(before), { type: 'edit' }, at.toISOString());
    await persist(tx, ctx, proposalId, before, result, at, input);
    return { version: current(result.proposal).number, superseded: cur.status !== 'draft' };
  }));
}

export type EventOptions = {
  /** Merged into each audit row this event writes (client metadata, D-34). */
  auditData?: AuditExtra;
  /** Runs in the same transaction after the transition is written (the signature and certificate, D-38). */
  then?: (tx: Tx, done: { result: TransitionResult; versionIds: Map<number, string>; at: Date }) => Promise<void>;
};

/** applyEvent's body, for callers that already hold a transaction and the proposal lock (send). */
async function applyInTx(tx: Tx, actor: Actor, proposalId: string, event: Exclude<ProposalEvent, { type: 'edit' }>, opts: EventOptions, at = now()) {
  const before = await versionsOf(tx, actor, proposalId);
  const result = transition(toPure(before), event, at.toISOString());
  const versionIds = await persist(tx, actor, proposalId, before, result, at, undefined, opts.auditData);
  await opts.then?.(tx, { result, versionIds, at });
  return result;
}

/**
 * Applies a non-edit event (send, view, sign, decline, expire) through the pure state machine and persists it. view, sign
 * and decline carry the version and PDF hash the client saw (D-16); a mismatch throws the Phase 1 error and writes nothing.
 * The actor is a member, or no user for the client's signing events and the cron (D-38). The database refuses a send
 * without the stored document (D-35): the app sends through sendProposal, which stores it first.
 */
export async function applyEvent(actor: Actor, proposalId: string, event: Exclude<ProposalEvent, { type: 'edit' }>, opts: EventOptions = {}) {
  return frozenAware(() => withOrg(actor, async (tx) => {
    await lockProposal(tx, actor, proposalId);
    return applyInTx(tx, actor, proposalId, event, opts);
  }));
}

/** D-28: only a proposal that was never sent (every version a draft) can be deleted. */
export async function deleteProposal(ctx: OrgCtx, proposalId: string) {
  assertEditor(ctx);
  await frozenAware(() => withOrg(ctx, async (tx) => {
    await lockProposal(tx, ctx, proposalId);
    const sent = await tx.proposalVersion.count({ where: { proposalId, orgId: ctx.orgId, status: { not: 'draft' } } });
    if (sent > 0) throw new Refused('This proposal has been sent, so it is kept as a record and cannot be deleted.');
    await tx.proposal.delete({ where: { id: proposalId } });
    await audit(ctx, 'proposal.deleted', { targetType: 'proposal', targetId: proposalId }, tx);
  }));
}

/** notFound unless the row is in this org. Actions call it before parsing the form, so "not yours" ≡ "not found" (INV-04). */
export async function requireInOrg(ctx: OrgCtx, model: 'proposal' | 'template', id: string) {
  const n = await withOrg(ctx, (tx) => (model === 'proposal' ? tx.proposal.count({ where: { id, orgId: ctx.orgId } }) : tx.template.count({ where: { id, orgId: ctx.orgId } })), { atomic: false });
  if (n !== 1) notFound();
}

// ---- Phase 3: send (render, store, hash), signing links, stored documents

/** D-36: a signing link is valid for 1–90 days; 30 by default. */
export const LINK_DAYS = { min: 1, max: 90, default: 30 } as const;

/** The proposal PDF's model from a version's rows (D-31). The client's page and the editor show the same content. */
export function proposalPdfModel(v: VersionRow, orgName: string): ProposalPdfModel {
  const values = mergeValues(v);
  return {
    orgName,
    title: v.title,
    clientName: v.clientName,
    clientEmail: v.clientEmail,
    version: v.number,
    sections: v.sections.map((s) => ({ kind: s.kind, title: renderMerge(s.title, values), body: renderMerge(s.body, values) })),
    lines: v.lines.map((l) => ({ id: l.id, ...toLineInput(l), quantityMilli: l.kind === 'fixed' ? 1000 : l.quantityMilli })),
    discount: toDiscount(v.discountType, v.discountValue),
  };
}

/** D-31: refuses content the PDF fonts cannot draw, naming the characters. */
export function assertDrawable(m: ProposalPdfModel) {
  const all = [m.orgName, m.title, m.clientName, m.clientEmail, ...m.sections.flatMap((s) => [s.title, s.body]), ...m.lines.map((l) => l.description)].join('\n');
  const bad = unsupportedChars(all);
  if (bad.length) throw new Refused(`The PDF cannot show these characters yet: ${describeChars(bad)}. Replace them, then send again.`);
}

const linkDays = (days: number) => {
  if (!Number.isInteger(days) || days < LINK_DAYS.min || days > LINK_DAYS.max) throw new Refused(`A link is valid for ${LINK_DAYS.min} to ${LINK_DAYS.max} days.`);
  return days;
};

async function createLink(tx: Tx, ctx: OrgCtx, versionId: string, days: number, at: Date) {
  const token = newToken();
  const link = await tx.signingLink.create({
    data: { orgId: ctx.orgId, versionId, tokenHash: hashToken(token), createdById: ctx.userId, expiresAt: new Date(at.getTime() + days * 86_400_000) },
    select: { id: true, expiresAt: true },
  });
  await audit(ctx, 'proposal.link.created', { targetType: 'signingLink', targetId: link.id, data: { versionId, days, expiresAt: link.expiresAt.toISOString() } }, tx);
  return { url: `${env.APP_URL}/sign/${token}`, expiresAt: link.expiresAt }; // the raw token exists only in this response
}

export type SendResult = { version: number; pdfSha256: string; url: string; expiresAt: Date };

/**
 * Sends the current draft: renders its PDF, stores the exact bytes, records their SHA-256 with the `send` event (CS-02,
 * D-16) and creates the signing link (D-29), all in one transaction. `expected` is the draft the owner was looking at
 * (D-26): a stale page is refused instead of sending content the owner has not seen.
 */
export async function sendProposal(ctx: OrgCtx, proposalId: string, expected: { version: number; revision: number }, days: number = LINK_DAYS.default): Promise<SendResult> {
  assertEditor(ctx);
  return frozenAware(() => withOrg(ctx, async (tx) => {
    await lockProposal(tx, ctx, proposalId); // notFound first (INV-04)
    linkDays(days);
    const before = await versionsOf(tx, ctx, proposalId);
    const cur = before.at(-1);
    if (!cur) notFound();
    if (cur.status !== 'draft') throw new Refused(`Version ${cur.number} has already been sent.`);
    if (cur.number !== expected.version || cur.revision !== expected.revision) throw new Refused('This proposal changed since you opened it. Reload, check it, then send.');
    if (cur.lines.length === 0) throw new Refused('Add at least one line item before sending.');
    const org = await tx.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
    const model = proposalPdfModel(cur, org.name);
    assertDrawable(model);
    const at = now();
    const bytes = await renderProposalPdf(model, at);
    const pdfSha256 = sha256Hex(bytes);
    await tx.proposalDocument.create({ data: { orgId: ctx.orgId, versionId: cur.id, kind: 'proposal', sha256: pdfSha256, byteLength: bytes.length, bytes: Buffer.from(bytes) } });
    await applyInTx(tx, ctx, proposalId, { type: 'send', pdfSha256 }, {}, at);
    const link = await createLink(tx, ctx, cur.id, days, at);
    return { version: cur.number, pdfSha256, ...link };
  }));
}

/** D-36: replaces the current version's signing link (a lost URL). The old link is revoked; the new URL is shown once. */
export async function newSigningLink(ctx: OrgCtx, proposalId: string, days: number = LINK_DAYS.default) {
  assertEditor(ctx);
  return frozenAware(() => withOrg(ctx, async (tx) => {
    await lockProposal(tx, ctx, proposalId);
    linkDays(days);
    const cur = (await versionsOf(tx, ctx, proposalId)).at(-1);
    if (!cur) notFound();
    if (cur.status !== 'sent' && cur.status !== 'viewed') throw new Refused(`Version ${cur.number} is ${cur.status}; only a sent proposal awaiting signature gets a new link.`);
    const at = now();
    const live = await tx.signingLink.findMany({ where: { versionId: cur.id, orgId: ctx.orgId, revokedAt: null }, select: { id: true } });
    for (const l of live) {
      await tx.signingLink.update({ where: { id: l.id }, data: { revokedAt: at } });
      await audit(ctx, 'proposal.link.revoked', { targetType: 'signingLink', targetId: l.id, data: { versionId: cur.id } }, tx);
    }
    return createLink(tx, ctx, cur.id, days, at);
  }));
}

/** What the editor shows about sending and signing: stored documents, links and the signature, per version number. */
export async function signingRecord(ctx: OrgCtx, proposalId: string) {
  return withOrg(ctx, async (tx) => {
    const rows = await tx.proposalVersion.findMany({
      where: { proposalId, orgId: ctx.orgId },
      orderBy: { number: 'asc' },
      select: {
        number: true,
        documents: { select: { id: true, kind: true, sha256: true, byteLength: true, createdAt: true }, orderBy: { kind: 'asc' } },
        signingLinks: { select: { id: true, expiresAt: true, revokedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        signature: { select: { signerName: true, method: true, signedAt: true, totalCents: true, selectedLineIds: true } },
      },
    });
    return new Map(rows.map((r) => [r.number, r]));
  }, { atomic: false });
}

/** A stored PDF of one of this org's proposals (owner download). notFound for anything else. */
export async function getDocument(ctx: OrgCtx, proposalId: string, versionNumber: number, kind: DocumentKind) {
  const d = await withOrg(ctx, (tx) =>
    tx.proposalDocument.findFirst({ where: { orgId: ctx.orgId, kind, version: { proposalId, number: versionNumber, orgId: ctx.orgId } }, select: { bytes: true, sha256: true, version: { select: { title: true, number: true } } } }), { atomic: false });
  if (!d) notFound();
  return d;
}
