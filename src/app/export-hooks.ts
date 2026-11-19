import { moduleExportTables } from '@/app/modules';
import type { ExportTable } from '@/core/tenancy/export';

const lineColumns = (template: boolean) => ({
  id: true, ...(template ? { templateId: true } : { versionId: true }), position: true, kind: true, description: true, unitPriceCents: true,
  quantityMilli: true, taxRateBps: true, discountType: true, discountValue: true, optional: true, selected: true,
} as const);

// Clone-owned (v1.6.0), like org-hooks.ts: which tables a data export holds beyond the template's core ones
// (addendum §5). Add one entry per org-owned table, selecting only columns that are safe to hand over: never a
// sealed column, token hash or recovery code (INV-34 scans the output). Every query runs inside withOrg.
//   { name: 'Booking', rows: (tx, orgId) => tx.booking.findMany({ where: { orgId }, select: { id: true, startsAt: true } }) },
export const exportTables: readonly ExportTable[] = [
  ...moduleExportTables,
  // Countersign: the whole proposal record, every version and its content (nothing secret is stored in these tables).
  { name: 'Template', rows: (tx, orgId) => tx.template.findMany({ where: { orgId }, select: { id: true, name: true, createdAt: true, updatedAt: true } }) },
  { name: 'TemplateSection', rows: (tx, orgId) => tx.templateSection.findMany({ where: { orgId }, select: { id: true, templateId: true, position: true, kind: true, title: true, body: true } }) },
  { name: 'TemplateLine', rows: (tx, orgId) => tx.templateLine.findMany({ where: { orgId }, select: lineColumns(true) }) },
  { name: 'Proposal', rows: (tx, orgId) => tx.proposal.findMany({ where: { orgId }, select: { id: true, templateId: true, createdById: true, createdAt: true, updatedAt: true } }) },
  {
    name: 'ProposalVersion',
    rows: (tx, orgId) =>
      tx.proposalVersion.findMany({
        where: { orgId },
        select: { id: true, proposalId: true, number: true, status: true, statusAt: true, revision: true, pdfSha256: true, title: true, clientName: true, clientEmail: true, scope: true, timeline: true, discountType: true, discountValue: true, createdAt: true },
      }),
  },
  { name: 'ProposalSection', rows: (tx, orgId) => tx.proposalSection.findMany({ where: { orgId }, select: { id: true, versionId: true, position: true, kind: true, title: true, body: true } }) },
  { name: 'ProposalLine', rows: (tx, orgId) => tx.proposalLine.findMany({ where: { orgId }, select: lineColumns(false) }) },
  // Phase 3: the stored PDFs (bytes as base64, so the export holds the exact signed documents), signing links without their
  // token hash (INV-34), and signatures.
  {
    name: 'ProposalDocument',
    rows: async (tx, orgId) =>
      (await tx.proposalDocument.findMany({ where: { orgId }, select: { id: true, versionId: true, kind: true, sha256: true, byteLength: true, bytes: true, createdAt: true } }))
        .map(({ bytes, ...d }) => ({ ...d, bytesBase64: Buffer.from(bytes).toString('base64') })),
  },
  // D-66: the org's brand (accent and logo), the logo as base64 like the stored PDFs.
  {
    name: 'OrgBrand',
    rows: async (tx, orgId) =>
      (await tx.orgBrand.findMany({ where: { orgId }, select: { orgId: true, accentHex: true, logoType: true, logoSha256: true, logoBytes: true, updatedAt: true } }))
        .map(({ logoBytes, ...b }) => ({ ...b, logoBase64: logoBytes ? Buffer.from(logoBytes).toString('base64') : null })),
  },
  { name: 'SigningLink', rows: (tx, orgId) => tx.signingLink.findMany({ where: { orgId }, select: { id: true, versionId: true, createdById: true, expiresAt: true, revokedAt: true, createdAt: true } }) },
  {
    name: 'ProposalSignature',
    rows: (tx, orgId) =>
      tx.proposalSignature.findMany({
        where: { orgId },
        select: {
          id: true, versionId: true, signerName: true, method: true, signatureData: true, consentVersion: true, consentText: true, pdfSha256: true, selectedLineIds: true,
          subtotalCents: true, discountCents: true, taxCents: true, totalCents: true, ipHash: true, userAgent: true, signedAt: true,
        },
      }),
  },
];

// An org-owned table left out on purpose, with the reason. INV-34 fails on any model with an orgId column that is in
// neither list, so a new table cannot silently drop out of every export.
export const exportSkipped: Readonly<Record<string, string>> = {};
