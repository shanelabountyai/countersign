// Countersign client endpoints (D-30): the small HTML pages and the request plumbing the /sign/<token> route handlers
// share. Route handlers, not pages, so a gone link can answer a real 410 (CS-03).
import { clientIp, isSameOrigin } from '@/core/http';
import { displayCents } from './money';
import { ClientRefusal, type ClientMeta, type GoneReason, type LinkView, type RefusalCode } from './signing';

/** Same headers as foundation share pages: the token in the URL must not leak in a Referer, be indexed, or be cached. */
export const SIGN_HEADERS = { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store, max-age=0' } as const;

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SIGN_HEADERS } });
}

const GONE: Record<GoneReason, string> = {
  superseded: 'This link is for an earlier version of the proposal, which has been replaced. Ask the sender for the new link.',
  declined: 'This proposal was declined, so the link no longer works. Contact the sender if that was a mistake.',
  expired: 'This signing link has expired. Ask the sender for a new one.',
  revoked: 'This signing link was replaced by a newer one. Ask the sender for the current link.',
  closed: 'This proposal is closed, so the link no longer works.',
};

export const notFoundPage = () => page(404, 'Link not found', '<h1>Link not found</h1><p>Check that you copied the whole link.</p>');
export const limitedPage = () => page(429, 'Too many requests', '<h1>Too many requests</h1><p>Wait a few minutes and try again.</p>');
export const gonePage = (reason: GoneReason, title?: string, orgName?: string) =>
  page(410, 'Link no longer valid', `<h1>This link no longer works</h1>${title ? `<p><strong>${esc(title)}</strong>${orgName ? ` from ${esc(orgName)}` : ''}</p>` : ''}<p>${esc(GONE[reason])}</p>`);

/** The 200 landing (D-30, D-33): who sent what, and the "Open proposal" POST that records the view. */
export function landingPage(token: string, v: Extract<LinkView, { code: 200 }>): Response {
  const base = `/sign/${encodeURIComponent(token)}`;
  const open =
    v.version.status === 'sent'
      ? `<form method="post" action="${base}/view"><input type="hidden" name="version" value="${v.version.number}"><input type="hidden" name="pdfSha256" value="${esc(v.pdf.sha256)}"><button type="submit">Open proposal</button></form>`
      : `<p><a href="${base}/review">${v.state === 'completed' ? 'See the signed proposal' : 'Continue to the proposal'}</a></p>`;
  return page(
    200,
    v.version.title,
    `<h1>${esc(v.version.title)}</h1><p>Proposal from ${esc(v.orgName)} for ${esc(v.version.clientName)} · version ${v.version.number} · total ${esc(displayCents(v.version.pricing.totalCents))}</p>${open}<p><small>Opening the proposal is recorded, with a hashed IP address and your browser's user agent, in the document's audit trail.</small></p>`,
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
