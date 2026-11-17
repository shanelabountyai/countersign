// Countersign PDF renderer identity (issue #5, D-45). The verify page re-renders stored PDFs and compares bytes, so the
// version of the code that produced a document is recorded on it (ProposalDocument.rendererVersion). The version string
// names @react-pdf/renderer and fingerprints every package in the render path, because a lockfile refresh can move a
// transitive package (pdfkit, fontkit, yoga-layout, @react-pdf/*) and change the bytes without the renderer's own
// version moving. tests/proposal/renderer.test.ts checks this table against package.json and node_modules, so it cannot
// silently drift from what is installed.
import { createHash } from 'node:crypto';

/** The installed render stack. Update together with package.json / package-lock.json (the test above fails otherwise). */
export const PDF_RENDER_STACK: Readonly<Record<string, string>> = Object.freeze({
  '@react-pdf/renderer': '4.9.0',
  '@react-pdf/fns': '3.1.3',
  '@react-pdf/font': '4.1.2',
  '@react-pdf/hyphenate': '0.1.0',
  '@react-pdf/image': '3.1.2',
  '@react-pdf/layout': '5.2.0',
  '@react-pdf/paginate': '1.0.1',
  '@react-pdf/primitives': '4.4.0',
  '@react-pdf/reconciler': '2.0.0',
  '@react-pdf/render': '4.7.0',
  '@react-pdf/stylesheet': '6.3.2',
  '@react-pdf/svg': '1.1.1',
  '@react-pdf/textkit': '7.0.1',
  fontkit: '2.0.4',
  pdfkit: '0.20.1',
  'yoga-layout': '3.2.1',
});

/** `@react-pdf/renderer@<version>+<12 hex of sha256 over the sorted name@version list>`. Key order does not matter. */
export function rendererVersionOf(stack: Readonly<Record<string, string>>): string {
  const list = Object.entries(stack).map(([n, v]) => `${n}@${v}`).sort().join('\n');
  return `@react-pdf/renderer@${stack['@react-pdf/renderer'] ?? 'unknown'}+${createHash('sha256').update(list).digest('hex').slice(0, 12)}`;
}

/** Stored on every ProposalDocument this build renders. */
export const PDF_RENDERER_VERSION = rendererVersionOf(PDF_RENDER_STACK);
