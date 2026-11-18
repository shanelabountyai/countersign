// Presentation helpers for the design pass (2026-11-18). No business rules here: words, glyphs and dates only.

export type StatusKey = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired' | 'superseded';

/** Every status is word + glyph + colour (docs/design/HANDOFF.md). The glyph is decorative; the word carries it. */
export const STATUS: Record<StatusKey, { word: string; glyph: string }> = {
  draft: { word: 'Draft', glyph: '✎' },
  sent: { word: 'Sent', glyph: '↗' },
  viewed: { word: 'Viewed', glyph: '●' },
  signed: { word: 'Signed', glyph: '✓' },
  declined: { word: 'Declined', glyph: '✗' },
  expired: { word: 'Expired', glyph: '⌛' },
  superseded: { word: 'Superseded', glyph: '↻' },
};

export const statusOf = (s: string) => STATUS[(s in STATUS ? s : 'draft') as StatusKey];

/** HTML for a status pill (the route-handler pages build HTML strings). */
export const pillHtml = (s: StatusKey) => `<span class="cs-pill cs-pill--${s}"><span aria-hidden="true">${STATUS[s].glyph}</span>${STATUS[s].word}</span>`;

const DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Nov 17, 2026" in UTC: every stored time, the PDFs and the certificate are UTC (D-52). */
export const day = (d: Date) => DATE.format(d);
/** "Nov 17, 2026, 4:52 PM UTC". */
export const dayTime = (d: Date) => `${DATE_TIME.format(d)} UTC`;

/** The org's monogram for client pages (per-org branding by name, D-48). */
export const monogram = (name: string) => (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? '·').toUpperCase();

/** A short browser label for the event log, from the recorded user agent; the raw string stays in the PDF certificate. */
export function browserLabel(ua: string | null): string {
  if (!ua) return '—';
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  if (b && os) return `${b}, ${os}`;
  return b ?? os ?? (ua.length > 40 ? `${ua.slice(0, 40)}…` : ua);
}

const EVENT: Record<string, string> = {
  'proposal.version.created': 'Draft created',
  'proposal.version.edited': 'Draft edited',
  'proposal.version.sent': 'Sent for signature',
  'proposal.version.viewed': 'Opened',
  'proposal.version.signed': 'Signed',
  'proposal.version.declined': 'Declined',
  'proposal.version.expired': 'Expired',
  'proposal.version.superseded': 'Replaced by a newer version',
};
export const eventLabel = (action: string) => EVENT[action] ?? action;

/** First 16 hex characters of a keyed IP hash, for the on-screen log (the full value is on the certificate PDF). */
export const shortHash = (h: string | null) => (h ? `${h.slice(0, 16)}…` : '—');
