// Countersign client endpoints (D-30): the small HTML pages and the request plumbing the /sign/<token> route handlers
// share. Route handlers, not pages, so a gone link can answer a real 410 (CS-03).
import { clientIp, isSameOrigin } from '@/core/http';
import { THEME_CSS } from '@/lib/ui/theme';
import { dayTime, monogram, pillHtml } from '@/lib/ui/format';
import { displayCents } from './money';
import { ClientRefusal, type ClientMeta, type GoneReason, type LinkView, type RefusalCode } from './signing';

/** Same headers as foundation share pages: the token in the URL must not leak in a Referer, be indexed, or be cached. */
export const SIGN_HEADERS = { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store, max-age=0' } as const;

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Page chrome for the route-handler pages: the shared theme (src/lib/ui/theme.ts) and the client shell. */
export function page(status: number, title: string, body: string, opts: { top?: string; wide?: boolean; bare?: boolean } = {}): Response {
  const main = opts.bare ? body : `<main class="cs-client__main${opts.wide ? '' : ' cs-client__main--narrow'}">${body}</main>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>${THEME_CSS}</style></head><body><div class="cs-client">${opts.top ?? ''}${main}</div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SIGN_HEADERS } });
}

const DEMO = '<p class="cs-small">Demo: not a legally vetted e-signature product.</p>';

/** The sender's org on a client page: monogram + name (per-org branding by name, D-48). */
const orgMark = (orgName: string) => `<div class="cs-orgmark"><span class="cs-mono" aria-hidden="true">${esc(monogram(orgName))}</span><span>${esc(orgName)}</span></div>`;

/** The dark strip at the top of a client page (Main.dc.html): who sent it, and the demo disclaimer. */
export const topNote = (inner: string) => `<header class="cs-topnote"><div><span>${inner}</span><span>Demo: not a legally vetted e-signature product</span></div></header>`;

type Notice = { tone: 'bad' | 'warn' | 'grey'; glyph: string; word: string; heading: string; text: string; more?: string };

function noticeHtml(n: Notice, orgName?: string): string {
  const pill = n.tone === 'bad' ? 'cs-pill--bad' : n.tone === 'warn' ? 'cs-pill--warn' : '';
  return `${orgName ? orgMark(orgName) : ''}<section class="cs-notice"><span class="cs-pill cs-pill--lg ${pill}" style="align-self:flex-start"><span aria-hidden="true">${n.glyph}</span>${esc(n.word)}</span><h1>${esc(n.heading)}</h1><p>${esc(n.text)}</p>${n.more ?? ''}</section>${DEMO}`;
}

// docs/design/Superseded.dc.html and LinkNotices.dc.html (D-13, D-36). The org and title are known on GET; a refused POST
// only knows the reason, so every sentence also reads without them.
function goneNotice(reason: GoneReason, title?: string, orgName?: string): Notice {
  const sender = orgName ?? 'the sender';
  const doc = title ? `“${title}”` : 'This proposal';
  switch (reason) {
    case 'superseded':
      return {
        tone: 'warn', glyph: '↻', word: 'Replaced by a newer version',
        heading: `This link is for an earlier version of ${title ? `“${title}”` : 'the proposal'}, which ${sender} has since updated.`,
        text: `Nothing was signed on this version, and it can't be signed now. ${orgName ?? 'The sender'} will send you a new link once the updated version is ready.`,
        more: `<ul><li>Already have a newer link? Use that one.</li><li>Still waiting? Ask ${esc(sender)} for the link to the newest version.</li></ul>`,
      };
    case 'declined':
      return { tone: 'bad', glyph: '✗', word: 'Declined', heading: `${doc} was declined.`, text: `Nothing was signed, and this link no longer works. If that was a mistake, contact ${sender} and ask for a new version.` };
    case 'expired':
      return { tone: 'warn', glyph: '⌛', word: 'Link expired', heading: `This signing link${title ? ` for “${title}”` : ''} has expired.`, text: `Nothing was signed on it. Ask ${sender} for a new link.` };
    case 'revoked':
      return { tone: 'warn', glyph: '↻', word: 'Link replaced', heading: `${orgName ?? 'The sender'} replaced this signing link with a newer one.`, text: `The proposal itself has not changed. Use the newest link you were sent, or ask ${sender} to send it again.` };
    default:
      return { tone: 'grey', glyph: '■', word: 'Closed', heading: 'This proposal is closed.', text: 'The link no longer works. Contact the sender if you expected to sign it.' };
  }
}

export const notFoundPage = () =>
  page(404, 'Link not found', noticeHtml({ tone: 'grey', glyph: '?', word: 'Link not found', heading: 'We could not find this signing link.', text: 'Check that you copied the whole link from the message you were sent.' }));
export const limitedPage = () =>
  page(429, 'Too many requests', noticeHtml({ tone: 'warn', glyph: '⏸', word: 'Too many requests', heading: 'Too many requests from your network.', text: 'Wait a few minutes, then reload this page.' }));
export const gonePage = (reason: GoneReason, title?: string, orgName?: string) =>
  page(410, 'Link no longer valid', noticeHtml(goneNotice(reason, title, orgName), orgName));

/** The 200 landing (D-30, D-33; docs/design/SignLanding.dc.html): who sent what, and the "Open proposal" POST that records the view. */
export function landingPage(token: string, v: Extract<LinkView, { code: 200 }>): Response {
  const base = `/sign/${encodeURIComponent(token)}`;
  const open =
    v.version.status === 'sent'
      ? `<form method="post" action="${base}/view"><input type="hidden" name="version" value="${v.version.number}"><input type="hidden" name="pdfSha256" value="${esc(v.pdf.sha256)}"><button type="submit" class="cs-btn cs-btn--primary cs-btn--lg">Open proposal</button></form>`
      : `<p><a class="cs-btn cs-btn--primary cs-btn--lg" href="${base}/review">${v.state === 'completed' ? 'See the signed proposal' : 'Continue to the proposal'}</a></p>`;
  const done = v.state === 'completed';
  const top = topNote(`${done ? 'Signed with' : 'Sent to you by'} <strong>${esc(v.orgName)}</strong> · Version ${v.version.number}`);
  const facts = v.state === 'completed'
    ? `<div><dt>Status</dt><dd>${pillHtml('signed')}</dd></div><div><dt>Total</dt><dd><strong>${esc(displayCents(v.signature?.totalCents ?? v.version.pricing.totalCents))}</strong></dd></div>`
    : `<div><dt>Total (default add-ons)</dt><dd><strong>${esc(displayCents(v.version.pricing.totalCents))}</strong></dd></div><div><dt>Link valid until</dt><dd>${esc(dayTime(v.expiresAt))}</dd></div>`;
  return page(
    200,
    v.version.title,
    `${orgMark(v.orgName)}<section class="cs-notice cs-landing" aria-labelledby="cs-t"><span class="cs-eyebrow">Proposal for ${esc(v.version.clientName)}</span><h1 id="cs-t">${esc(v.version.title)}</h1><dl>${facts}</dl>${open}<p class="cs-small">${done ? 'This proposal is signed. You can read it and download the PDF and the completion certificate.' : v.version.status === 'sent' ? 'Opening the proposal is recorded in its audit trail with the time, a hashed IP address and your browser.' : 'You opened this proposal before; it is waiting for your answer.'}</p></section>${DEMO}`,
    { top },
  );
}

/**
 * CSRF guard for the signing POSTs. These pages send `Referrer-Policy: no-referrer`, under which a browser posts a form
 * with `Origin: null`, so core isSameOrigin would refuse every real submit. Fetch metadata (`Sec-Fetch-Site`, sent by
 * every current browser whatever the referrer policy) decides when present; otherwise the Origin check applies.
 */
export function sameSite(h: Headers): boolean {
  const site = h.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  return isSameOrigin(h);
}

export const metaOf = (req: Request): ClientMeta => ({ ip: clientIp(req.headers), userAgent: req.headers.get('user-agent') });

/** Common POST plumbing: same-origin only (a cross-site form must not sign for a visitor), form fields, and refusals. */
export async function handlePost(req: Request, token: string, run: (form: FormData, meta: ClientMeta) => Promise<void>, done: string): Promise<Response> {
  if (!sameSite(req.headers)) return page(403, 'Forbidden', '<h1>Forbidden</h1>');
  const back = (q: string) => new Response(null, { status: 303, headers: { Location: `/sign/${encodeURIComponent(token)}${q ? `/${q}` : ''}`, ...SIGN_HEADERS } });
  try {
    await run(await req.formData(), metaOf(req));
    return back(done);
  } catch (e) {
    if (!(e instanceof ClientRefusal)) throw e;
    if (e.status === 404) return notFoundPage();
    if (e.status === 410) return gonePage(e.reason ?? 'closed');
    if (e.status === 429) return limitedPage();
    return back(`review?error=${e.code satisfies RefusalCode}`);
  }
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};
export const int = (s: string) => (/^\d{1,9}$/.test(s) ? Number(s) : NaN);

export function pdfResponse(d: { bytes: Uint8Array; sha256: string; filename: string }, inline: boolean): Response {
  return new Response(Buffer.from(d.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${d.filename}"`,
      'X-Content-SHA256': d.sha256,
      ...SIGN_HEADERS,
    },
  });
}
