import Link from 'next/link';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { displayCents, formatMoney, formatPercent } from '@/lib/proposal/money';
import { getProposal, LINK_DAYS, signingRecord } from '@/lib/proposal/store';
import { newLinkAction, removeProposal, saveProposal, sendProposalAction } from '../actions';
import { LineRows, SectionRows } from '../editor-fields';

export const metadata = { title: 'Edit proposal' };

const STATUS_NOTE: Record<string, string> = {
  sent: 'was sent to the client',
  viewed: 'was opened by the client',
  declined: 'was declined',
  expired: 'expired',
};

export default async function ProposalEditor({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ superseded?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const { id } = await params;
  const { superseded } = await searchParams;
  const p = await getProposal(ctx, id);
  const record = await signingRecord(ctx, id);
  const v = p.current;
  const cur = record.get(v.number);
  const liveLink = cur?.signingLinks.find((l) => !l.revokedAt);
  const pdfHref = (n: number, kind: 'proposal' | 'certificate') => `/o/${ctx.slug}/proposals/${id}/pdf?v=${n}&kind=${kind}`;
  const daysField = (
    <label>Link valid for <input name="days" defaultValue={String(LINK_DAYS.default)} size={3} inputMode="numeric" required /> days</label>
  );
  const editable = ctx.role !== 'scorekeeper' && v.status !== 'signed';
  const neverSent = p.versions.every((x) => x.status === 'draft');
  const byId = new Map(v.pricing.lines.map((l) => [l.id, l]));

  return (
    <main>
      <p><Link href={`/o/${ctx.slug}/proposals`}>← Proposals</Link></p>
      <h1>{v.title} <small>v{v.number} · {v.status}</small></h1>
      {p.proposal.template && <p>From template <Link href={`/o/${ctx.slug}/templates/${p.proposal.template.id}`}>{p.proposal.template.name}</Link>.</p>}
      {superseded && <p role="status">Saved as version {superseded}. The earlier version is kept unchanged and its signing link no longer works.</p>}
      {v.status !== 'draft' && v.status !== 'signed' && (
        <p role="note">Version {v.number} {STATUS_NOTE[v.status]} and is frozen. Saving creates version {v.number + 1} as a new draft.</p>
      )}
      {v.status === 'signed' && <p role="note">Version {v.number} is signed. It is frozen and cannot be edited.</p>}

      {editable && v.status === 'draft' && (
        <>
          <h2>Send</h2>
          <p>Sending renders this draft as a PDF, records its SHA-256 and freezes version {v.number}. You get a signing link to give the client (no email is sent).</p>
          <ActionForm action={sendProposalAction.bind(null, ctx.slug)}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="expectedVersion" value={String(v.number)} />
            <input type="hidden" name="expectedRevision" value={String(v.revision)} />
            {daysField}{' '}
            <button type="submit">Send version {v.number}</button>
          </ActionForm>
        </>
      )}
      {(v.status === 'sent' || v.status === 'viewed') && (
        <>
          <h2>Signing link</h2>
          <p>
            {liveLink ? <>The client&apos;s link is valid until {liveLink.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.</> : <>No live link.</>}{' '}
            {v.status === 'viewed' ? 'The client has opened the proposal.' : 'The client has not opened it yet.'}
          </p>
          {editable && (
            <ActionForm action={newLinkAction.bind(null, ctx.slug)}>
              <input type="hidden" name="id" value={id} />
              {daysField}{' '}
              <button type="submit">Replace the link</button>
            </ActionForm>
          )}
        </>
      )}
      {cur?.signature && (
        <>
          <h2>Signature</h2>
          <p>
            Signed by {cur.signature.signerName} ({cur.signature.method}) on {cur.signature.signedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC for{' '}
            <strong>{displayCents(Number(cur.signature.totalCents))}</strong>
            {cur.signature.selectedLineIds.length > 0 && <> with {cur.signature.selectedLineIds.length} add-on(s)</>}.{' '}
            <a href={pdfHref(v.number, 'certificate')}>Completion certificate (PDF)</a>
          </p>
          <p>Anyone holding a copy of the proposal PDF or the certificate can check it at <a href="/verify">/verify</a>.</p>
        </>
      )}

      <h2>Price</h2>
      <table>
        <thead><tr><th>Line</th><th>Amount</th><th>Discounts</th><th>Tax</th><th>Total</th></tr></thead>
        <tbody>
          {v.lines.map((l) => {
            const r = byId.get(l.id)!;
            return (
              <tr key={l.id}>
                <td>{l.description}{l.optional ? (l.selected ? ' (optional, on)' : ' (optional, off)') : ''}</td>
                <td>{displayCents(r.extendedCents)}</td>
                <td>{displayCents(r.lineDiscountCents + r.allocatedDiscountCents)}</td>
                <td>{displayCents(r.taxCents)}</td>
                <td>{displayCents(r.totalCents)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr><th>Subtotal</th><td colSpan={3} /><td>{displayCents(v.pricing.subtotalCents)}</td></tr>
          {v.pricing.proposalDiscountCents > 0 && <tr><th>Proposal discount</th><td colSpan={3} /><td>−{displayCents(v.pricing.proposalDiscountCents)}</td></tr>}
          {v.pricing.taxes.map((t) => (
            <tr key={t.taxRateBps}><th>Tax {formatPercent(t.taxRateBps)} % on {displayCents(t.taxableCents)}</th><td colSpan={3} /><td>{displayCents(t.taxCents)}</td></tr>
          ))}
          <tr><th>Total</th><td colSpan={3} /><td><strong>{displayCents(v.pricing.totalCents)}</strong></td></tr>
        </tfoot>
      </table>

      <h2>Document</h2>
      {v.sections.map((s) => (
        <section key={s.id}>
          <h3>{s.renderedTitle}{s.kind === 'terms' ? ' (terms)' : ''}</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{s.rendered}</p>
        </section>
      ))}

      {editable && (
        <>
          <h2>Edit</h2>
          <ActionForm action={saveProposal.bind(null, ctx.slug)}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="expectedVersion" value={String(v.number)} />
            <input type="hidden" name="expectedRevision" value={String(v.revision)} />
            <label>Title <input name="title" defaultValue={v.title} required maxLength={200} /></label>{' '}
            <label>Client <input name="clientName" defaultValue={v.clientName} required maxLength={120} /></label>{' '}
            <label>Client email <input name="clientEmail" type="email" defaultValue={v.clientEmail} maxLength={120} /></label>
            <br />
            <label>Scope <textarea name="scope" defaultValue={v.scope} rows={2} cols={60} maxLength={2000} /></label>{' '}
            <label>Timeline <input name="timeline" defaultValue={v.timeline} maxLength={2000} /></label>
            <br />
            <label>
              Proposal discount{' '}
              <select name="discountType" defaultValue={v.discount?.type ?? 'none'}>
                <option value="none">None</option>
                <option value="percent">%</option>
                <option value="fixed">$</option>
              </select>
            </label>{' '}
            <input name="discount" aria-label="Proposal discount amount" size={8} inputMode="decimal"
              defaultValue={v.discount ? (v.discount.type === 'percent' ? formatPercent(v.discount.bps) : formatMoney(v.discount.cents)) : ''} />
            <SectionRows sections={v.sections} />
            <LineRows lines={v.lines.map((l) => l.input)} />
            <button type="submit">{v.status === 'draft' ? 'Save draft' : `Save as version ${v.number + 1}`}</button>
          </ActionForm>
        </>
      )}

      <h2>Versions</h2>
      <ol>
        {p.versions.map((x) => (
          <li key={x.id}>
            v{x.number}: {x.status} since {x.statusAt.toISOString().slice(0, 16).replace('T', ' ')} UTC
            {x.pdfSha256 && <> · <a href={pdfHref(x.number, 'proposal')}>PDF</a> sha256 <code>{x.pdfSha256}</code></>}
            {record.get(x.number)?.documents.some((d) => d.kind === 'certificate') && <> · <a href={pdfHref(x.number, 'certificate')}>certificate</a></>}
          </li>
        ))}
      </ol>

      {editable && neverSent && (
        <ActionForm action={removeProposal.bind(null, ctx.slug)}>
          <input type="hidden" name="id" value={id} />
          <button type="submit">Delete this draft proposal</button>
        </ActionForm>
      )}
    </main>
  );
}
