// Countersign merge fields (D-25): a fixed set of placeholders in section bodies, filled from the version's values.
// Pure. Values are inserted literally and never re-scanned, so a client name containing "{{scope}}" stays as typed.

export const MERGE_FIELDS = ['client', 'scope', 'timeline'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeValues = Record<MergeField, string>;

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Every `{{…}}` name in `text` that is not a known merge field, in order of first appearance, de-duplicated. */
export function unknownFields(text: string): string[] {
  const out: string[] = [];
  for (const [, name = ''] of text.matchAll(PLACEHOLDER)) {
    if (!(MERGE_FIELDS as readonly string[]).includes(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The known fields `text` uses, in MERGE_FIELDS order. */
export function usedFields(text: string): MergeField[] {
  const names = new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]));
  return MERGE_FIELDS.filter((f) => names.has(f));
}

/**
 * Fills each known placeholder with its value in one pass. Unknown placeholders are left as written (saving refuses them,
 * so they only appear in data written before a field was removed). An empty value renders as the empty string.
 */
export function renderMerge(text: string, values: MergeValues): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => ((MERGE_FIELDS as readonly string[]).includes(name) ? values[name as MergeField] : whole));
}
