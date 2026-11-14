# Countersign — Phase 1 plan: pure modules

Branch `kickoff`, PR #1 against `main`, never merged by the routine. Pure TypeScript only: no Prisma, no Next.js, no I/O
beyond `node:crypto`. Phase 2 (schema, templates, editor) builds on these and is not started here.

## Deliverables

| File | What | Invariants |
|---|---|---|
| `src/lib/proposal/pricing.ts` | line items → per-line breakdown and totals, integer cents | CS-01 |
| `src/lib/proposal/versioning.ts` | proposal/version state machine, supersede rules, signing-link access, audit events per transition | CS-03, CS-04 (pure half) |
| `src/lib/proposal/hash.ts` | SHA-256 over exact bytes, constant-time verify, match against signed versions | CS-02 |
| `tests/proposal/pricing.test.ts` | table tests + fast-check properties | CS-01 |
| `tests/proposal/versioning.test.ts` | transition table + fast-check random event sequences | CS-03, CS-04 |
| `tests/proposal/hash.test.ts` | known vectors + fast-check byte-mutation properties | CS-02 |

## Pricing model (D-08 … D-11)

- Money is integer cents (D-03). Quantity is integer **thousandths** (`quantityMilli`: 1.5 h = 1500), so hourly and
  per-unit quantities stay exact. Rates are integer **basis points** (`taxRateBps`: 8.25 % = 825; percent discounts the same).
- Kinds: `fixed` (quantity forced to 1), `hourly`, `per_unit`. Any line may be `optional`; an optional line counts only when
  the client has `selected` it. Unselected optional lines appear in the breakdown with zeros and `included: false`.
- All arithmetic in `BigInt`; results are checked to be safe integers before they become `number`s.

### Rounding rules (the order is part of the rule)

1. **Extended amount** per line: `unitPriceCents × quantityMilli / 1000`, rounded **half up** (amounts are never negative,
   so half up = half away from zero).
2. **Line discount**: percent → `extended × bps / 10000` rounded half up; fixed → the amount. Either is **capped at the
   extended amount** (a line never goes negative).
3. **Proposal (total) discount**: computed on the subtotal of included lines after line discounts (percent rounded half up,
   fixed capped at the subtotal), then **allocated to the included lines pro rata** to their post-line-discount amount by
   the **largest-remainder method**; remainder cents go to the largest fractional parts, ties broken by **line id**
   (never by position). The allocated parts sum exactly to the total discount.
4. **Tax per line** on that line's taxable amount (after both discounts), rounded half up; the proposal tax is the **sum of
   line taxes** (not tax on the subtotal).
5. **Total** = Σ taxable + Σ tax. Every figure in the result is an integer and every total is the sum of its line parts.

Stability under reordering (CS-01): each line's figures depend only on that line and on order-independent sums; the one
tie-break uses ids. Line ids must be unique (enforced).

## Versioning model (D-12, D-13)

Statuses per version: `draft → sent → viewed → signed | declined | expired`, plus `superseded`. A proposal is a list of
versions; the last one is current, at most one version is not `superseded`.

| From | send | view | sign | decline | expire | edit |
|---|---|---|---|---|---|---|
| draft | sent | ✗ | ✗ | ✗ | ✗ | draft (same version, in place) |
| sent | ✗ | viewed | ✗ | ✗ | expired | **supersede** → new draft v+1 |
| viewed | ✗ | viewed (repeat view, audited) | signed | declined | expired | **supersede** |
| declined / expired | ✗ | ✗ | ✗ | ✗ | ✗ | **supersede** |
| signed / superseded | ✗ terminal | ✗ | ✗ | ✗ | ✗ | ✗ |

- Sign and decline need a prior view (the client must open the link). `send` needs the version's PDF hash (recorded at send,
  frozen from then on).
- `view`, `sign` and `decline` name the `version` and `pdfSha256` the client's page showed (D-16): a different current
  version → `VersionMismatchError`, no recorded hash → `MissingHashError`, a different hash → `HashMismatchError`.
- `linkAccess(proposal, version)`: current + sent/viewed → 200 `active`; current + signed → 200 `completed` (read-only);
  superseded → **410** (CS-03); declined/expired → 410; unknown version → 404.
- Every accepted event returns its audit events: one per status change (a supersede yields two: `version.superseded` and
  `version.created`), plus `version.viewed` for a repeat view. Rejected events throw `TransitionError` and change nothing.

## Hash (D-14)

`sha256Hex(bytes)` over the exact `Uint8Array` (no text decoding, no normalization). `verifySha256(bytes, hex)` lower-cases
the expected hex, rejects anything not 64 hex chars, compares with `timingSafeEqual`. `matchSignedVersion(bytes, candidates)`
returns the matching signed version or `null` (Phase 4 verify page).

## Gate

`npm run lint`, `npm run typecheck`, `npm test` green locally; PR body lists the rounding rules above. Then stop.
