import Link from 'next/link';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { ActionForm } from '@/core/ui/action-form';
import { displayCents, formatMoney, formatPercent, formatQuantity } from '@/lib/proposal/money';
import { usedFields } from '@/lib/proposal/merge';
import { declineOf, getProposal, LINK_DAYS, mergeValues, signingRecord } from '@/lib/proposal/store';
import { day, dayTime } from '@/lib/ui/format';
import { StatusPill } from '@/lib/ui/status-pill';
import { newLinkAction, removeProposal, saveProposal, sendProposalAction } from '../actions';
import { LineRows, SectionRows } from '../editor-fields';
import { EditorForm, LinkActionForm } from '../editor-form';

export const metadata = { title: 'Edit proposal' };

// docs/design/Editor.dc.html (with TemplateEditor.dc.html's edit rows). Content is the version's own rows (D-20).

const STATUS_NOTE: Record<string, string> = {
  sent: 'was sent to the client',
  viewed: 'was opened by the client',
  declined: 'was declined',
  expired: 'expired',
};
const KIND = { fixed: 'Fixed fee', hourly: 'Hourly', per_unit: 'Per unit' } as const;
const STEP = { draft: 0, sent: 1, viewed: 2, signed: 3, declined: 3, expired: 3, superseded: 3 } as const;

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
    <label className="cs-label" style={{ width: 'auto' }}>
      Link valid for (days, {LINK_DAYS.min}–{LINK_DAYS.max})
      <input name="days" defaultValue={String(LINK_DAYS.default)} inputMode="numeric" required className="cs-input" style={{ width: 96 }} />
    </label>
  );
  const editable = ctx.role !== 'scorekeeper' && v.status !== 'signed';
  const neverSent = p.versions.every((x) => x.status === 'draft');
  const byId = new Map(v.pricing.lines.map((l) => [l.id, l]));
  const discountCents = v.pricing.lineDiscountCents + v.pricing.proposalDiscountCents;
  const step = STEP[v.status as keyof typeof STEP] ?? 0;
  const ending = v.status === 'signed' ? 'Signed' : v.status === 'declined' ? 'Declined' : v.status === 'expired' ? 'Expired' : 'Signed or declined';
  const steps = [
    { word: 'Draft', when: v.status === 'draft' ? day(v.statusAt) : '' },
    { word: `Sent (v${v.number})`, when: v.status === 'sent' ? day(v.statusAt) : '' },
    { word: 'Viewed', when: v.status === 'viewed' ? day(v.statusAt) : '' },
    { word: ending, when: step === 3 ? day(v.statusAt) : 'Waiting' },
  ];
  const declined = v.status === 'declined' ? await declineOf(ctx, v.id) : null;
  // D-70: merge fields the text uses but that are empty would reach the client as blanks ("Scope: ."). A warning, not a block.
  const values = mergeValues(v);
  const emptyUsed = [...new Set(v.sections.flatMap((s) => usedFields(`${s.title}\n${s.body}`)))].filter((f) => values[f].trim() === '');
  const sections = v.sections.filter((s) => s.kind !== 'terms');
  const terms = v.sections.filter((s) => s.kind === 'terms');

  return (
    <main className="cs-app">
      <div className="cs-col">
        <Link href={`/o/${ctx.slug}/proposals`} className="cs-back">← Proposals</Link>
        <div className="cs-pagehead">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="cs-meta">
              {v.clientName}
              {p.proposal.template && <> · from template <Link href={`/o/${ctx.slug}/templates/${p.proposal.template.id}`}>{p.proposal.template.name}</Link></>}
            </span>
            <h1>{v.title}</h1>
            <span data-testid="version-line" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>Version {v.number} <StatusPill status={v.status} /></span>
          </div>
          {v.pdfSha256 && (
            <div className="cs-actions">
              <a className="cs-btn" href={pdfHref(v.number, 'proposal')}>Proposal PDF</a>
              {cur?.documents.some((d) => d.kind === 'certificate') && <a className="cs-btn" href={pdfHref(v.number, 'certificate')}>Certificate PDF</a>}
            </div>
          )}
        </div>

        {superseded && <p role="status" className="cs-banner cs-banner--ok"><span className="cs-banner__glyph" aria-hidden="true">✓</span>Saved as version {superseded}. The earlier version is kept unchanged and its signing link no longer works.</p>}
        {v.status !== 'draft' && v.status !== 'signed' && (
          <div role="note" className="cs-banner">
            <span className="cs-banner__glyph cs-half" aria-hidden="true" />
            <p>
              <strong>Version {v.number} {STATUS_NOTE[v.status]} and is frozen. Saving creates version {v.number + 1} as a new draft.</strong>{' '}
              {v.status === 'sent' || v.status === 'viewed'
                ? <>Once you save it, the version {v.number} link stops working and the client sees a &ldquo;newer version&rdquo; page.</>
                : <>Its link already no longer works; send the new version to give the client a fresh link.</>}
            </p>
          </div>
        )}
        {v.status === 'signed' && (
          <div role="note" className="cs-banner cs-banner--info">
            <span className="cs-banner__glyph" aria-hidden="true">✓</span>
            <p>Version {v.number} is signed. It is frozen and cannot be edited.</p>
          </div>
        )}

        {((editable && v.status === 'draft') || v.status === 'sent' || v.status === 'viewed') && (
          // One card in one place for both states, so the one-time link stays on screen while the page refreshes (UX-1).
          <section aria-labelledby="cs-send" className="cs-card">
            <h2 id="cs-send">{v.status === 'draft' ? 'Send' : 'Signing link'}</h2>
            <p style={{ margin: 0, color: 'var(--cs-ink-2)' }}>
              {v.status === 'draft'
                ? <>Sending renders this draft as a PDF, records its SHA-256 and freezes version {v.number}. You get a signing link to give the client; no email is sent.</>
                : <>{liveLink ? <>The client&apos;s link is valid until {dayTime(liveLink.expiresAt)}.</> : <>No live link.</>} {v.status === 'viewed' ? 'The client has opened the proposal.' : 'The client has not opened it yet.'}</>}
            </p>
            {v.status === 'draft' && emptyUsed.length > 0 && (
              <div className="cs-banner" data-testid="empty-merge-warning">
                <span className="cs-banner__glyph" aria-hidden="true">!</span>
                <p>The text uses {emptyUsed.map((f) => `{{${f}}}`).join(', ')} but {emptyUsed.length === 1 ? 'that field is' : 'those fields are'} empty, so the client would see a blank there. Fill {emptyUsed.length === 1 ? 'it' : 'them'} in under Edit, or send as is.</p>
              </div>
            )}
            {editable && (v.status === 'draft' ? (
              <LinkActionForm key="link" action={sendProposalAction.bind(null, ctx.slug)} button={`Send version ${v.number}`}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="expectedVersion" value={String(v.number)} />
                <input type="hidden" name="expectedRevision" value={String(v.revision)} />
                {daysField}
              </LinkActionForm>
            ) : (
              <LinkActionForm key="link" action={newLinkAction.bind(null, ctx.slug)} button="Replace the link" hint="The new link is shown once. The current one stops working.">
                <input type="hidden" name="id" value={id} />
                {daysField}
              </LinkActionForm>
            ))}
          </section>
        )}
        {declined && (
          <section aria-labelledby="cs-declined" className="cs-card">
            <h2 id="cs-declined">Declined by the client</h2>
            <p style={{ margin: 0 }}>On {dayTime(declined.at)}. {declined.reason ? 'Their reason:' : 'They gave no reason.'}</p>
            {declined.reason && <blockquote style={{ margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--cs-line)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{declined.reason}</blockquote>}
          </section>
        )}
        {cur?.signature && (
          <section aria-labelledby="cs-sig" className="cs-card">
            <h2 id="cs-sig">Signature</h2>
            <p style={{ margin: 0 }}>
              Signed by {cur.signature.signerName} ({cur.signature.method}) on {dayTime(cur.signature.signedAt)} for{' '}
              <strong>{displayCents(Number(cur.signature.totalCents))}</strong>
              {cur.signature.selectedLineIds.length > 0 && <> with {cur.signature.selectedLineIds.length} add-on(s)</>}.
            </p>
            <p style={{ margin: 0 }}>Anyone holding a copy of the proposal PDF or the certificate can check it at <a href="/verify">/verify</a>.</p>
          </section>
        )}

        <section aria-labelledby="cs-price" className="cs-card cs-card--flush">
          <div className="cs-card__head"><h2 id="cs-price">Line items</h2></div>
          {v.lines.length === 0 ? (
            <div className="cs-empty"><p>No line items yet.{editable ? ' Add them in the edit form below.' : ''}</p></div>
          ) : (
            <div className="cs-scroll">
              <table className="cs-table" style={{ minWidth: 760 }}>
                <thead><tr><th scope="col">Item</th><th scope="col">Pricing</th><th scope="col" className="cs-num">Qty</th><th scope="col" className="cs-num">Rate</th><th scope="col">Tax</th><th scope="col" className="cs-num">Amount</th></tr></thead>
                <tbody>
                  {v.lines.map((l) => {
                    const r = byId.get(l.id)!;
                    return (
                      <tr key={l.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                            <span style={{ fontWeight: 500 }}>{l.description}</span>
                            {l.optional && <span className="cs-pill cs-pill--accent">Optional add-on, {l.selected ? 'on' : 'off'} by default</span>}
                          </div>
                        </td>
                        <td>{KIND[l.input.kind]}</td>
                        <td className="cs-num">{l.input.kind === 'fixed' ? '1' : `${formatQuantity(l.input.quantityMilli)}${l.input.kind === 'hourly' ? ' h' : ''}`}</td>
                        <td className="cs-num">{displayCents(l.input.unitPriceCents)}</td>
                        <td>{l.input.taxRateBps > 0 ? `${formatPercent(l.input.taxRateBps)} %` : 'None'}</td>
                        <td className="cs-num" style={{ fontWeight: 500 }}>{r.included ? displayCents(r.extendedCents) : <span style={{ color: 'var(--cs-muted)' }}>Not included</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ padding: 16, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--cs-line-soft)' }}>
            <div className="cs-totals-wrap">
            <dl className="cs-totals">
              <div><dt>Subtotal</dt><dd>{displayCents(v.pricing.grossCents)}</dd></div>
              {discountCents > 0 && <div className="cs-soft"><dt>Discounts</dt><dd>−{displayCents(discountCents)}</dd></div>}
              {v.pricing.taxes.map((t) => (
                <div key={t.taxRateBps} className="cs-soft"><dt>Tax {formatPercent(t.taxRateBps)} % on {displayCents(t.taxableCents)} (rounded once)</dt><dd>{displayCents(t.taxCents)}</dd></div>
              ))}
              <div className="cs-grand"><dt>Total</dt><dd data-testid="total">{displayCents(v.pricing.totalCents)}</dd></div>
            </dl>
            <span className="cs-hint">With the default add-ons; the client can switch add-ons before signing. Stored in whole cents; reordering lines never changes a total.</span>
            </div>
          </div>
        </section>

        <section aria-labelledby="cs-doc" className="cs-card">
          <h2 id="cs-doc">Document</h2>
          {v.sections.length === 0 ? <p style={{ margin: 0, color: 'var(--cs-muted)' }}>No sections yet.</p> : (
            <div className="cs-doc-preview">
              {[...sections, ...terms].map((s) => (
                <div key={s.id}>
                  <h3>{s.renderedTitle}{s.kind === 'terms' && !/terms/i.test(s.renderedTitle) ? ' (terms)' : ''}</h3>
                  <p>{s.rendered}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {editable && (
          <EditorForm action={saveProposal.bind(null, ctx.slug)}
            footer={<button type="submit" className="cs-btn cs-btn--primary">{v.status === 'draft' ? 'Save draft' : `Save as version ${v.number + 1}`}</button>}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="expectedVersion" value={String(v.number)} />
              <input type="hidden" name="expectedRevision" value={String(v.revision)} />
              <section aria-labelledby="cs-edit" className="cs-card">
                <h2 id="cs-edit">{v.status === 'draft' ? 'Edit' : `Edit as version ${v.number + 1}`}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  <label className="cs-label">Title <input name="title" defaultValue={v.title} required maxLength={200} className="cs-input" /></label>
                  <label className="cs-label">Client <input name="clientName" defaultValue={v.clientName} required maxLength={120} className="cs-input" /></label>
                  <label className="cs-label">Client email <input name="clientEmail" type="email" defaultValue={v.clientEmail} maxLength={120} className="cs-input" /></label>
                </div>
                <h3 style={{ margin: '4px 0 0', fontSize: 15 }}>Merge fields <span className="cs-hint">Scope fills {'{{scope}}'}, Timeline fills {'{{timeline}}'}, Client fills {'{{client}}'}</span></h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  <label className="cs-label">Scope <textarea name="scope" defaultValue={v.scope} rows={2} maxLength={2000} className="cs-input" /></label>
                  <label className="cs-label">Timeline <input name="timeline" defaultValue={v.timeline} maxLength={2000} className="cs-input" /></label>
                </div>
                <div className="cs-actions" style={{ alignItems: 'flex-end' }}>
                  <label className="cs-label">
                    Proposal discount
                    <select name="discountType" defaultValue={v.discount?.type ?? 'none'} className="cs-input" style={{ width: 'auto' }}>
                      <option value="none">None</option>
                      <option value="percent">%</option>
                      <option value="fixed">$</option>
                    </select>
                  </label>
                  <input name="discount" aria-label="Proposal discount amount" inputMode="decimal" className="cs-input" style={{ width: 120 }}
                    defaultValue={v.discount ? (v.discount.type === 'percent' ? formatPercent(v.discount.bps) : formatMoney(v.discount.cents)) : ''} />
                </div>
              </section>
              <SectionRows sections={v.sections} />
              <LineRows lines={v.lines.map((l) => l.input)} title="Edit line items" />
          </EditorForm>
        )}

        {editable && neverSent && (
          <details className="cs-danger" style={{ alignSelf: 'flex-start' }}>
            <summary>Delete this draft proposal…</summary>
            <div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--cs-ink-2)' }}>Only a proposal that was never sent can be deleted. This cannot be undone.</p>
              <ActionForm action={removeProposal.bind(null, ctx.slug)}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="cs-btn cs-btn--danger">Delete this draft proposal</button>
              </ActionForm>
            </div>
          </details>
        )}
      </div>

      <aside aria-label="State and history" className="cs-side">
        <section aria-labelledby="cs-state" className="cs-card">
          <h2 id="cs-state">State</h2>
          <ol className="cs-steps">
            {steps.map((s, i) => {
              const done = i < step || (i === step && step === 3);
              const now = i === step && step !== 3;
              return (
                <li key={s.word} className={done ? 'cs-step--done' : now ? 'cs-step--now' : ''}>
                  <span className="cs-steps__g" aria-hidden="true">{done ? '✓' : now ? '●' : '○'}</span>
                  {s.word}<span className="cs-vh">{done ? ' (done)' : now ? ' (current)' : ' (not yet)'}</span>
                  <span className="cs-when">{s.when}</span>
                </li>
              );
            })}
            {liveLink && (v.status === 'sent' || v.status === 'viewed') && (
              <li><span className="cs-steps__g" aria-hidden="true">○</span>Link expires<span className="cs-when">{day(liveLink.expiresAt)}</span></li>
            )}
          </ol>
        </section>
        <section aria-labelledby="cs-versions" className="cs-card">
          <h2 id="cs-versions">Versions</h2>
          <ol className="cs-versions" reversed>
            {[...p.versions].reverse().map((x) => {
              const docs = record.get(x.number)?.documents ?? [];
              return (
                <li key={x.id}>
                  <div className="cs-row"><span style={{ fontWeight: 600 }}>Version {x.number}</span><StatusPill status={x.status} /></div>
                  <span className="cs-meta">Since {dayTime(x.statusAt)}</span>
                  {x.pdfSha256 && (
                    <span className="cs-meta">
                      <a href={pdfHref(x.number, 'proposal')}>PDF</a>
                      {docs.some((d) => d.kind === 'certificate') && <> · <a href={pdfHref(x.number, 'certificate')}>Certificate</a></>}
                      {' '}· SHA-256 <span className="cs-hash">{x.pdfSha256}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {can(ctx.role, 'audit.read') && <Link href={`/o/${ctx.slug}/settings/audit`} style={{ fontSize: 14, fontWeight: 600 }}>Open audit log</Link>}
        </section>
      </aside>
    </main>
  );
}
