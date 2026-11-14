# Countersign — Phase 2 plan: schema, templates, proposal editor

Branch `phase-2`, one PR against `main`, never merged by the routine. Builds on the Phase 1 pure modules
(`src/lib/proposal/{pricing,versioning,hash,sha256-hex}.ts`), which stay pure and are not rewritten. Owner decisions
**D-16** (view/sign/decline bound to version + PDF sha256) and **D-18** (tax rounded once per rate) are binding.

## Scope (PRD "Phases": 2 = schema, templates, proposal editor)

In:

1. **Schema** (`prisma/schema/countersign.prisma` + hand-written migrations): `Template`, `TemplateSection`,
   `TemplateLine`, `Proposal`, `ProposalVersion`, `ProposalSection`, `ProposalLine`. Every table is org-owned (`orgId`),
   gets RLS policies (`npm run rls:policies`), an export entry (INV-34) and harness fixture rows (INV-01..04, INV-29).
2. **Signed and sent versions frozen in the database** (review of PR #1): triggers reject any change to a version's
   content once it has left `draft`, any change at all to a `signed` or `superseded` version, any status move the Phase 1
   table does not allow, and any insert/update/delete of a non-draft version's sections or lines. Org deletion still
   cascades (D-21).
3. **Templates**: sections with merge fields (`{{client}}`, `{{scope}}`, `{{timeline}}`), terms blocks, reusable line items
   (fixed, hourly, per-unit, optional add-ons) with tax rate and line discount. Create, edit, delete.
4. **Proposal editor**: create from a template (content copied as a snapshot) or blank; edit title, client, merge-field values,
   sections, lines and the proposal discount; live pricing from `price()` (D-18 tax groups shown); discard a never-sent
   proposal. An edit to a `sent`/`viewed`/`declined`/`expired` version supersedes it (v+1 draft, old version frozen), through
   the Phase 1 `transition()`.
5. **Persistence of the state machine** (`src/lib/proposal/store.ts`): loads a proposal's versions, applies the pure
   `transition()` under a row lock, writes the resulting rows and **one audit event per pure audit event** (CS-04). All events
   (`send`, `view`, `sign`, `decline`, `expire`, `edit`) are persisted and tested here, with D-16's version/hash binding.

Out (Phase 3+, not started): PDF rendering and the real hash of PDF bytes, a send button, signing links / share links, the
client page and optional-item toggling by the client, signatures, consent, IP/user-agent capture, completion certificate,
410 responses over HTTP, verify page, sample template, README case study. Phase 2 has **no send in the UI** (D-19); `send`
is exercised in tests with a supplied hash.

## Tasks (one or more commits each)

| # | Task | Files |
|---|---|---|
| T1 | This plan + DECISIONS rows D-19… | `docs/countersign/` |
| T2 | Pure editor helpers: money/quantity/percent parsing and formatting, merge-field render + validation | `src/lib/proposal/{money,merge}.ts`, `tests/proposal/{money,merge}.test.ts` |
| T3 | Schema + migration (tables, enums, indexes, FKs) | `prisma/schema/countersign.prisma`, `prisma/migrations/2026111500000x_*` |
| T4 | Freeze triggers migration | `prisma/migrations/…_countersign_freeze` |
| T5 | RLS policies migration, export entries, harness fixtures | `prisma/migrations/…_rls_policies_countersign`, `src/app/export-hooks.ts`, `tests/fixtures/app.ts` |
| T6 | Store: templates CRUD, proposal create/copy, saveDraft (in place or supersede), applyEvent, delete | `src/lib/proposal/store.ts`, `tests/integration/countersign-*.test.ts` |
| T7 | Editor UI: templates list/edit, proposals list/new/edit, nav link | `src/app/o/[org]/{templates,proposals}/**`, `layout.tsx`, `page.tsx` |
| T8 | CI: schema-vs-migrations check for Countersign tables (D-27) | `.github/workflows/ci.yml` |

## Invariants and the tests that prove them

| Acceptance item | Proof |
|---|---|
| CS-01 pricing exact, order-independent (unchanged) | Phase 1 tests stay green; editor totals come only from `price()`; store test: reordering a draft's lines leaves every total unchanged |
| CS-02 (DB half) a version's PDF hash and content never change once sent; signed rows are frozen | `countersign-freeze.test.ts`: raw SQL updates/deletes/inserts against sent, viewed, signed, superseded versions and their sections/lines all raise; `pdfSha256` change after send raises; a draft still edits freely; org deletion with a signed proposal succeeds |
| CS-03 (data half) an edit after send supersedes and voids the old version | store test: edit on sent/viewed/declined/expired → old row `superseded` with hash kept, new v+1 `draft` with copied content; `linkAccess` on the persisted proposal gives 410 for the old number |
| CS-04 every state transition writes an audit event | store test: for random event sequences (fast-check, persisted), `AuditEvent` rows written == pure `transition()` audit events, in order, with version and from/to; rejected events write nothing |
| CS-05 (org half) a proposal is visible only in its org | INV-01..04 harness over every new action (fixtures in both orgs), INV-29/30 RLS (enforce leg), store test: org B's ctx cannot load org A's proposal |
| D-16 binding persisted | store test: view/sign/decline with a stale version → `VersionMismatchError`, wrong hash → `HashMismatchError`, nothing written |
| Templates: merge fields, terms, reusable lines | `merge.test.ts` (render, unknown placeholder rejected, no recursive expansion); store test: proposal created from a template copies sections/lines; later template edits do not change it |
| Editor input exact | `money.test.ts`: table + property tests (format∘parse round trip, no float arithmetic, >2 decimals refused, limits) |
| Optimistic concurrency | store test: saving with a stale revision is refused, nothing written |

## Gate

`npm run lint`, `npm run typecheck`, `npm test` (unit, property, integration, invariants) green locally; GitHub CI green
(`ci (off)` incl. `prisma migrate deploy`, Playwright, and `modules-removed`). Then stop. Phase 3 is not started.
