// Countersign PDFs (D-02, D-31): the proposal a client signs and the completion certificate. Pure apart from React-PDF:
// the output depends only on the model and the `at` passed in (fixed metadata, built-in Helvetica, no font files), so the
// same version renders to the same bytes. The bytes that were hashed are stored anyway (ProposalDocument), so verifying
// a signed document never depends on rendering it again.
import { Document, Font, Page, Path, StyleSheet, Svg, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { displayCents, formatPercent, formatQuantity } from './money';
import { price, type Discount, type LineKind, type PricingResult } from './pricing';
import { strokes, type SignatureMethod } from './signature';

export type PdfLine = {
  id: string;
  kind: LineKind;
  description: string;
  unitPriceCents: number;
  quantityMilli: number;
  taxRateBps: number;
  discount: Discount | null;
  optional: boolean;
  selected: boolean;
};

export type ProposalPdfModel = {
  orgName: string;
  title: string;
  clientName: string;
  clientEmail: string;
  version: number;
  /** Section text with merge fields already filled in. */
  sections: { kind: 'section' | 'terms'; title: string; body: string }[];
  lines: PdfLine[];
  discount: Discount | null;
};

export type TrailRow = { at: string; action: string; from: string | null; to: string; pdfSha256?: string | null; ipHash?: string | null; userAgent?: string | null };

export type CertificatePdfModel = {
  orgName: string;
  title: string;
  clientName: string;
  version: number;
  proposalId: string;
  versionId: string;
  pdfSha256: string;
  pdfBytes: number;
  signedAt: string;
  signer: { name: string; method: SignatureMethod; data: string };
  consent: string;
  addOns: { description: string; chosen: boolean }[];
  pricing: Pick<PricingResult, 'subtotalCents' | 'proposalDiscountCents' | 'taxes' | 'taxCents' | 'totalCents'>;
  trail: TrailRow[];
};

const PRODUCER = 'Countersign';
// No automatic hyphenation: a signed document should not split "in-cluded" or an amount across lines.
Font.registerHyphenationCallback((word) => [word]);
const KIND: Record<LineKind, string> = { fixed: 'Fixed', hourly: 'Hourly', per_unit: 'Per unit' };

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, padding: 48, lineHeight: 1.35 },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: 18, marginBottom: 4 },
  h2: { fontFamily: 'Helvetica-Bold', fontSize: 12, marginTop: 14, marginBottom: 4 },
  muted: { color: '#555555' },
  mono: { fontFamily: 'Courier', fontSize: 8 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#bbbbbb', paddingVertical: 3 },
  head: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 3, fontFamily: 'Helvetica-Bold' },
  c1: { flex: 4 },
  c: { flex: 1.3, textAlign: 'right' },
  total: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 2 },
  tl: { width: 220, textAlign: 'right', paddingRight: 8 },
  tv: { width: 90, textAlign: 'right' },
  sig: { fontFamily: 'Helvetica-Oblique', fontSize: 22, marginVertical: 6 },
  footer: { position: 'absolute', bottom: 24, left: 48, right: 48, fontSize: 8, color: '#777777', textAlign: 'center' },
});

const discountLabel = (d: Discount | null) => (!d ? '' : d.type === 'percent' ? `${formatPercent(d.bps)} %` : displayCents(d.cents));

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const st = bold ? { fontFamily: 'Helvetica-Bold' } : {};
  return (
    <View style={s.total}>
      <Text style={[s.tl, st]}>{label}</Text>
      <Text style={[s.tv, st]}>{value}</Text>
    </View>
  );
}

function Totals({ p, discount = null }: { p: CertificatePdfModel['pricing']; discount?: Discount | null }) {
  return (
    <View>
      <TotalRow label="Subtotal" value={displayCents(p.subtotalCents)} />
      {p.proposalDiscountCents > 0 && <TotalRow label={discount ? `Proposal discount (${discountLabel(discount)})` : 'Proposal discount'} value={`-${displayCents(p.proposalDiscountCents)}`} />}
      {p.taxes.map((t) => (
        <TotalRow key={t.taxRateBps} label={`Tax ${formatPercent(t.taxRateBps)} % on ${displayCents(t.taxableCents)}`} value={displayCents(t.taxCents)} />
      ))}
      <TotalRow label="Total" value={displayCents(p.totalCents)} bold />
    </View>
  );
}

const meta = (title: string, subject: string, at: Date) => ({ title, subject, author: PRODUCER, creator: PRODUCER, producer: PRODUCER, creationDate: at, modificationDate: at });

async function bytes(doc: ReactNode): Promise<Uint8Array> {
  const buf = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Pricing exactly as the editor and the signing page show it (author's add-on defaults). */
export const pricingOf = (m: Pick<ProposalPdfModel, 'lines' | 'discount'>) =>
  price({ lines: m.lines.map((l) => ({ ...l, discount: l.discount ?? undefined })), ...(m.discount ? { discount: m.discount } : {}) });

/** The proposal PDF. `at` is the send time, used as the creation date. */
export function renderProposalPdf(m: ProposalPdfModel, at: Date): Promise<Uint8Array> {
  const pricing = pricingOf(m);
  const byId = new Map(pricing.lines.map((l) => [l.id, l]));
  const required = m.lines.filter((l) => !l.optional);
  const addOns = m.lines.filter((l) => l.optional);
  const lineRow = (l: PdfLine, amount: string, note = '') => (
    <View style={s.row} key={l.id} wrap={false}>
      <Text style={s.c1}>{`${l.description}${note}`}</Text>
      <Text style={s.c}>{KIND[l.kind]}</Text>
      <Text style={s.c}>{l.kind === 'fixed' ? '1' : formatQuantity(l.quantityMilli)}</Text>
      <Text style={s.c}>{displayCents(l.unitPriceCents)}</Text>
      <Text style={s.c}>{discountLabel(l.discount)}</Text>
      <Text style={s.c}>{l.taxRateBps ? `${formatPercent(l.taxRateBps)} %` : ''}</Text>
      <Text style={s.c}>{amount}</Text>
    </View>
  );
  const head = (
    <View style={s.head}>
      <Text style={s.c1}>Item</Text>
      <Text style={s.c}>Type</Text>
      <Text style={s.c}>Qty</Text>
      <Text style={s.c}>Unit price</Text>
      <Text style={s.c}>Discount</Text>
      <Text style={s.c}>Tax</Text>
      <Text style={s.c}>Amount</Text>
    </View>
  );
  // An add-on's amount on its own (before proposal discount and tax), so the client sees what toggling it adds.
  const alone = (l: PdfLine) => price({ lines: [{ ...l, discount: l.discount ?? undefined, optional: false }] }).lines[0]!;
  return bytes(
    <Document {...meta(m.title, `Proposal version ${m.version}`, at)}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>{m.title}</Text>
        <Text style={s.muted}>{`Proposal from ${m.orgName} to ${m.clientName}${m.clientEmail ? ` (${m.clientEmail})` : ''} · version ${m.version} · ${at.toISOString().slice(0, 10)}`}</Text>
        {m.sections.map((sec, i) => (
          <View key={i}>
            <Text style={s.h2}>{sec.kind === 'terms' ? `Terms: ${sec.title}` : sec.title}</Text>
            <Text>{sec.body}</Text>
          </View>
        ))}
        <Text style={s.h2}>Price</Text>
        {head}
        {required.map((l) => lineRow(l, displayCents(byId.get(l.id)!.taxableCents + byId.get(l.id)!.allocatedDiscountCents)))}
        {addOns.length > 0 && (
          <>
            <Text style={s.h2}>Optional add-ons</Text>
            <Text style={s.muted}>
              The client chooses add-ons when signing. The totals below include the add-ons marked &quot;included&quot;; the completion
              certificate records the final choice and total.
            </Text>
            {head}
            {addOns.map((l) => lineRow(l, displayCents(alone(l).taxableCents), l.selected ? ' (included)' : ''))}
          </>
        )}
        <View style={{ marginTop: 8 }}>
          <Totals p={pricing} discount={m.discount} />
        </View>
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${m.title} · version ${m.version} · page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>,
  );
}

function DrawnSignature({ path }: { path: string }) {
  const d = strokes(path)
    .map((st) => st.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '))
    .join(' ');
  return (
    <Svg width={300} height={100} viewBox="0 0 600 200" style={{ borderBottomWidth: 0.5, marginVertical: 6 }}>
      <Path d={d} stroke="#000000" strokeWidth={3} fill="none" />
    </Svg>
  );
}

/** The completion certificate. `at` is the signing time. */
export function renderCertificatePdf(m: CertificatePdfModel, at: Date): Promise<Uint8Array> {
  const kv = (k: string, v: string, mono = false) => (
    <View style={{ flexDirection: 'row', marginBottom: 2 }}>
      <Text style={{ width: 130, fontFamily: 'Helvetica-Bold' }}>{k}</Text>
      <Text style={[{ flex: 1 }, mono ? s.mono : {}]}>{v}</Text>
    </View>
  );
  return bytes(
    <Document {...meta(`Completion certificate: ${m.title}`, `Signed version ${m.version}`, at)}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>Completion certificate</Text>
        <Text style={s.muted}>Issued by Countersign for {m.orgName}. This certificate records who signed which document, and when.</Text>

        <Text style={s.h2}>Document</Text>
        {kv('Proposal', m.title)}
        {kv('Version', String(m.version))}
        {kv('Client', m.clientName)}
        {kv('Document SHA-256', m.pdfSha256, true)}
        {kv('Document size', `${m.pdfBytes} bytes`)}
        {kv('Proposal id', m.proposalId, true)}
        {kv('Version id', m.versionId, true)}

        <Text style={s.h2}>Signature</Text>
        {kv('Signed by', m.signer.name)}
        {kv('Signed at', m.signedAt)}
        {kv('Method', m.signer.method === 'typed' ? 'Typed' : 'Drawn')}
        {m.signer.method === 'typed' ? <Text style={s.sig}>{m.signer.data}</Text> : <DrawnSignature path={m.signer.data} />}
        <Text style={s.h2}>Consent to electronic records</Text>
        <Text>{m.consent}</Text>

        {m.addOns.length > 0 && (
          <>
            <Text style={s.h2}>Add-ons chosen at signing</Text>
            {m.addOns.map((a, i) => (
              <Text key={i}>{`${a.chosen ? 'Chosen' : 'Not chosen'}: ${a.description}`}</Text>
            ))}
          </>
        )}
        <Text style={s.h2}>Accepted price</Text>
        <Totals p={m.pricing} />

        <Text style={s.h2}>Audit trail</Text>
        <Text style={s.muted}>Times are UTC. IP addresses are stored only as keyed hashes (HMAC-SHA256).</Text>
        {m.trail.map((t, i) => (
          <View key={i} style={s.row} wrap={false}>
            <View style={{ flex: 1 }}>
              <Text>{`${t.at} · ${t.action.replace(/^proposal\./, '')} · ${t.from ?? '(new)'} to ${t.to}`}</Text>
              {t.pdfSha256 ? <Text style={s.mono}>document {t.pdfSha256}</Text> : null}
              {t.ipHash ? <Text style={s.mono}>ip hash {t.ipHash}</Text> : null}
              {t.userAgent ? <Text style={s.mono}>user agent {t.userAgent}</Text> : null}
            </View>
          </View>
        ))}
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `Completion certificate · ${m.title} · version ${m.version} · page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>,
  );
}
