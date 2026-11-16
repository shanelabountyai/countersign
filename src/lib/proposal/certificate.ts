// Countersign completion certificate model (Phase 3, shared in Phase 4). Signing builds the certificate from these
// functions, and the verify page re-derives it from stored rows with the same functions, so "re-renders to the stored
// bytes" compares like with like (D-40).
import type { CertificatePdfModel, TrailRow } from './pdf';
import type { PricingResult } from './pricing';
import { priceSelection } from './selection';
import type { SignatureMethod } from './signature';
import { toDiscount, toLineInput, toLineItem, type VersionRow } from './store';

/** The price of a version with exactly these add-ons chosen (D-32). Throws SelectionError for an id that is not an add-on. */
export function priceVersionSelection(v: Pick<VersionRow, 'lines' | 'discountType' | 'discountValue'>, selected: readonly string[]): PricingResult {
  const discount = toDiscount(v.discountType, v.discountValue);
  return priceSelection({ lines: v.lines.map((r) => toLineItem(r.id, toLineInput(r))), ...(discount ? { discount } : {}) }, selected);
}

type AuditRow = { action: string; at: Date; data: unknown };

/** A version's audit rows as certificate trail rows, in the order given (by id). */
export function trailOf(events: readonly AuditRow[]): TrailRow[] {
  return events.map((e) => {
    const d = (e.data ?? {}) as Record<string, string | null | undefined>;
    return { at: d.at ?? e.at.toISOString(), action: e.action, from: d.from ?? null, to: d.to ?? '', pdfSha256: d.pdfSha256 ?? null, ipHash: d.ipHash ?? null, userAgent: d.userAgent ?? null };
  });
}

export type CertificateInput = {
  orgName: string;
  version: Pick<VersionRow, 'id' | 'proposalId' | 'number' | 'title' | 'clientName' | 'lines'>;
  pdfSha256: string;
  pdfBytes: number;
  signedAt: Date;
  signer: { name: string; method: SignatureMethod; data: string };
  consent: string;
  /** The chosen add-on line ids. */
  chosen: ReadonlySet<string>;
  pricing: PricingResult;
  trail: TrailRow[];
};

export function certificateModel(i: CertificateInput): CertificatePdfModel {
  const v = i.version;
  return {
    orgName: i.orgName, title: v.title, clientName: v.clientName, version: v.number, proposalId: v.proposalId, versionId: v.id, pdfSha256: i.pdfSha256, pdfBytes: i.pdfBytes,
    signedAt: i.signedAt.toISOString(), signer: i.signer, consent: i.consent,
    addOns: v.lines.filter((r) => r.optional).map((r) => ({ description: r.description, chosen: i.chosen.has(r.id) })),
    pricing: i.pricing, trail: i.trail,
  };
}
