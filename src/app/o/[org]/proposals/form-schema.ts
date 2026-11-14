import { z } from 'zod';

// The editor's parallel columns (see src/lib/proposal/form.ts). Plain strings on purpose: the form is parsed in the action
// body after the row is scoped to the org, so a bad value is a Refused, never an early validation error (INV-02/04).
const col = (max: number) => z.array(z.string().max(max)).max(300).default([]);

export const sectionColumns = { sectionKind: col(20), sectionTitle: col(200), sectionBody: col(20_000), sectionOrder: col(10) };
export const lineColumns = {
  lineKind: col(20), lineDescription: col(500), linePrice: col(40), lineQty: col(40), lineTax: col(20), lineDiscountType: col(20),
  lineDiscount: col(40), lineInclusion: col(20), lineOrder: col(10),
};
