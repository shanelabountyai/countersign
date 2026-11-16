import { inflateSync } from 'node:zlib';

const WIN_ANSI = new TextDecoder('windows-1252');

/**
 * The text drawn in a React-PDF (pdfkit) file with the standard fonts, for assertions. pdfkit writes each run as a TJ
 * array of hex strings in WinAnsi inside Flate streams; this inflates every stream and decodes those runs, one per line.
 * Good enough for "does the certificate contain X"; not a general PDF parser.
 */
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      out.push([...tj[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => WIN_ANSI.decode(Buffer.from(h[1]!, 'hex'))).join(''));
    }
  }
  return out.join('\n');
}

/** pdfText with every run of whitespace (including the breaks between runs and lines) as one space. */
export const pdfFlatText = (bytes: Uint8Array) => pdfText(bytes).replace(/\s+/g, ' ');
