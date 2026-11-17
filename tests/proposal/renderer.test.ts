import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDF_RENDER_STACK, PDF_RENDERER_VERSION, rendererVersionOf } from '@/lib/proposal/renderer';

// Issue #5 (D-45): the verify page re-renders stored PDFs and expects identical bytes, so the renderer is pinned exactly
// and the version that rendered each stored document is recorded with it. These tests keep the recorded constant honest:
// a dependency bump (or a lockfile refresh that moves a transitive @react-pdf package) fails here until the constant,
// and with it the version stored on new documents, is updated.

const root = process.cwd(); // vitest runs from the repo root
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
const installed = (name: string) => (JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;

describe('the PDF renderer is pinned (issue #5)', () => {
  it('package.json pins @react-pdf/renderer to an exact version, the one the stack records', () => {
    const spec = pkg.dependencies['@react-pdf/renderer'];
    expect(spec).toMatch(/^\d+\.\d+\.\d+$/); // no ^ or ~: an upgrade is a deliberate edit, never an npm install side effect
    expect(PDF_RENDER_STACK['@react-pdf/renderer']).toBe(spec);
  });

  it('every package in the recorded stack is the installed one', () => {
    for (const [name, version] of Object.entries(PDF_RENDER_STACK)) expect({ name, version: installed(name) }).toEqual({ name, version });
  });

  it('every installed @react-pdf package that can change the bytes is in the stack (types only is exempt)', () => {
    const scoped = readdirSync(join(root, 'node_modules', '@react-pdf')).map((d) => `@react-pdf/${d}`).filter((n) => n !== '@react-pdf/types');
    expect(Object.keys(PDF_RENDER_STACK).filter((n) => n.startsWith('@react-pdf/')).sort()).toEqual(scoped.sort());
  });

  it('the stored version names the renderer and fingerprints the whole stack', () => {
    expect(PDF_RENDERER_VERSION).toBe(rendererVersionOf(PDF_RENDER_STACK));
    expect(PDF_RENDERER_VERSION).toMatch(/^@react-pdf\/renderer@\d+\.\d+\.\d+\+[0-9a-f]{12}$/);
    expect(PDF_RENDERER_VERSION.startsWith(`@react-pdf/renderer@${pkg.dependencies['@react-pdf/renderer']}+`)).toBe(true);
  });

  it('any change in the stack, even a transitive one, changes the stored version; key order does not', () => {
    const moved = { ...PDF_RENDER_STACK, pdfkit: '0.0.0-other' };
    expect(rendererVersionOf(moved)).not.toBe(PDF_RENDERER_VERSION);
    const reversed = Object.fromEntries(Object.entries(PDF_RENDER_STACK).reverse());
    expect(rendererVersionOf(reversed)).toBe(PDF_RENDERER_VERSION);
  });
});
