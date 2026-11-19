// The Countersign mark from the artboards (Editor.dc.html, Verify.dc.html). Decorative: the word beside it names it.
export const BRAND_MARK_SVG =
  '<svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true" focusable="false"><rect x="1" y="1" width="26" height="26" rx="7" fill="#16181D"/><path d="M9 7v11a3 3 0 0 0 3 3h7" stroke="#7FD1CF" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="19" cy="9" r="2.4" fill="#7FD1CF"/></svg>';

export function BrandMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="#16181D" />
      <path d="M9 7v11a3 3 0 0 0 3 3h7" stroke="#7FD1CF" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="19" cy="9" r="2.4" fill="#7FD1CF" />
    </svg>
  );
}

/** The sender's org on client pages: monogram + name (per-org branding by name, D-48). */
export function OrgMark({ name, mono, large = false }: { name: string; mono: string; large?: boolean }) {
  return (
    <span className="cs-orgmark">
      <span className={large ? 'cs-mono cs-mono--lg' : 'cs-mono'} aria-hidden="true">{mono}</span>
      <span>{name}</span>
    </span>
  );
}
