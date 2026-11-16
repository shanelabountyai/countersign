// Countersign add-on selection at signing (D-32). Pure. The client toggles optional lines on the signing page; the frozen
// version is not changed: the choice is priced here with the same price() and recorded with the signature.
import { price, type LineItem, type PricingInput, type PricingResult } from './pricing';

export class SelectionError extends Error {
  override name = 'SelectionError';
}

/** The optional lines' ids, in the order given. */
export const optionalIds = (lines: readonly Pick<LineItem, 'id' | 'optional'>[]) => lines.filter((l) => l.optional).map((l) => l.id);

/** The add-ons switched on by default (the author's `selected`), the starting state of the signing page. */
export const defaultSelection = (lines: readonly Pick<LineItem, 'id' | 'optional' | 'selected'>[]) => lines.filter((l) => l.optional && l.selected).map((l) => l.id);

/**
 * Validates a selection: every id must be an optional line of these lines; duplicates are refused. Returns the ids in line
 * order, so the stored selection does not depend on the order the browser posted them.
 */
export function checkSelection(lines: readonly Pick<LineItem, 'id' | 'optional'>[], selected: readonly string[]): string[] {
  const optional = new Set(optionalIds(lines));
  const seen = new Set<string>();
  for (const id of selected) {
    if (seen.has(id)) throw new SelectionError(`add-on ${id} was chosen twice`);
    seen.add(id);
    if (!optional.has(id)) throw new SelectionError(`${id} is not an optional line of this version`);
  }
  return lines.filter((l) => seen.has(l.id)).map((l) => l.id);
}

/** price() with exactly the chosen add-ons switched on and every other optional line off. Required lines are untouched. */
export function priceSelection(input: PricingInput, selected: readonly string[]): PricingResult {
  const chosen = new Set(checkSelection(input.lines, selected));
  return price({ ...input, lines: input.lines.map((l) => (l.optional ? { ...l, selected: chosen.has(l.id) } : l)) });
}
