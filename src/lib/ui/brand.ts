// Per-org branding for client pages (D-66, Shane 2026-11-19: "real logo + colour"). Pure: colour checks and the image
// sniffing that decides what may be stored. Nothing here reads the database.

/** Logo upload limits: PNG or JPEG only (an SVG can carry script), at most 100 KB. */
export const LOGO_MAX_BYTES = 100 * 1024;
export type LogoType = 'image/png' | 'image/jpeg';

/** The media type from the file's own bytes (never the browser's claim), or null when it is neither PNG nor JPEG. */
export function sniffLogo(b: Uint8Array): LogoType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

const HEX = /^#[0-9a-f]{6}$/;

/** `#0f5e63` form (lower case, with #), or null for anything else. Accepts "0F5E63" and "#0F5E63". */
export function normalizeHex(input: string): string | null {
  const s = input.trim().toLowerCase();
  const h = s.startsWith('#') ? s : `#${s}`;
  return HEX.test(h) ? h : null;
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** WCAG 2.1 relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent is used as white-on-accent buttons and as link text on white and on the page background (#EFEFEA), so it
 * must reach 4.5:1 against all three (DUX-12). Returns why it fails, or null.
 */
export function accentProblem(hex: string): string | null {
  for (const [bg, where] of [['#ffffff', 'white text on it'], ['#efefea', 'the page background']] as const) {
    const r = contrast(hex, bg);
    if (r < 4.5) return `That colour is too light: it has ${r.toFixed(2)}:1 contrast with ${where}; it needs at least 4.5:1. Choose a darker shade.`;
  }
  return null;
}

const mix = (hex: string, with_: string, t: number) => {
  const a = rgb(hex), b = rgb(with_);
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/** CSS custom properties that re-colour the client pages for one org's accent (darker hover, pale wash). */
export function accentVars(hex: string): Record<string, string> {
  return { '--cs-accent': hex, '--cs-accent-hover': mix(hex, '#000000', 0.25), '--cs-accent-wash': mix(hex, '#ffffff', 0.94), '--cs-teal-wash': mix(hex, '#ffffff', 0.88) };
}

/** The same, as a `style` attribute value for the route-handler HTML. */
export const accentStyle = (hex: string) => Object.entries(accentVars(hex)).map(([k, v]) => `${k}:${v}`).join(';');

export type Brand = { accentHex: string | null; logo: { type: LogoType; base64: string } | null };
export const NO_BRAND: Brand = { accentHex: null, logo: null };

/** A data: URL for the stored logo, so anonymous client pages need no extra public route. */
export const logoSrc = (b: Brand) => (b.logo ? `data:${b.logo.type};base64,${b.logo.base64}` : null);
