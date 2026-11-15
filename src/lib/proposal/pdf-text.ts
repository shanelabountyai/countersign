// Characters the PDF standard fonts can draw (D-31). React-PDF's built-in Helvetica uses WinAnsiEncoding: printable
// ASCII, Latin-1 (U+00A0–U+00FF) and 27 extra punctuation/letters. Anything else would render as a wrong or missing
// glyph in a document someone signs, so send refuses it and names the characters. Pure.

const EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export function drawable(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return ch === '\n' || ch === '\t' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRA.has(ch);
}

/** The distinct characters in `text` the PDF fonts cannot draw, in order of first appearance. */
export function unsupportedChars(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) if (!drawable(ch) && !out.includes(ch)) out.push(ch);
  return out;
}

/** "U+4E2D 中" style labels for a refusal message. */
export const describeChars = (chars: readonly string[]) =>
  chars.slice(0, 8).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}${/\s/.test(c) ? '' : ` ${c}`}`).join(', ') + (chars.length > 8 ? ', …' : '');
