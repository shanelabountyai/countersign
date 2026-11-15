# Countersign — Phase 3 plan: PDF render, signing flow, certificate

Branch `phase-3`, one PR against `main`, not merged by Claude. Builds on Phase 1 (pure pricing, versioning, hash) and
Phase 2 (schema, store, freeze triggers, editor), both merged. Owner decisions **D-16** (view/sign/decline bound to
version + PDF sha256) and **D-18** (tax rounded once per rate) are binding; D-21's freeze is extended to every new table.

## Scope (PRD "Phases": 3 = PDF render, signing flow, certificate)

In:

1. **PDF render** (D-02 React-PDF): a pure renderer from a version's frozen rows (title, client, merged sections,
   terms, priced lines with the D-18 tax groups, optional add-ons). Fixed metadata, so the same version gives the same
   bytes. At **send** the bytes are rendered, hashed (`sha256Hex`), **stored** (`ProposalDocument`) and the hash goes
   into the `send` event. The database refuses a `sent` version without a stored document whose sha256 is its `pdfSha256`.
2. **Send** (the owner, in the editor): renders, stores, sends (`applyEvent`), and creates a **signing link** bound to
   that version. The raw link is shown once. "New link" replaces a lost one (the old link is revoked).
3. **Signing flow** (the client, anonymous, token = credential): `GET /sign/<token>` answers 200 / **410** (superseded,
   declined, expired, link expired or revoked) / 404. "Open proposal" (POST) records the view. The review page shows
   the document (HTML from the same frozen rows) and the stored PDF. The client can toggle optional add-ons (the total
   updates), type or draw a signature, accept the e-records consent and **sign**, or **decline** with a reason. Every
   client event carries the version + PDF hash the page showed (D-16) and is audited with timestamp, hashed IP, user
   agent and document hash (CS-04).
4. **Completion certificate**: a second PDF generated in the sign transaction. It lists the proposal, version,
   document SHA-256, the signer and signature, the consent text, the chosen add-ons and final price, and the audit
   trail. It is stored with its own SHA-256. The client and the owner can both download it.
5. **Expiry**: a link has a validity of 1–90 days. A daily cron job applies `expire` to sent/viewed versions whose
   link has run out; until the cron runs, the expired link already answers 410.
6. **Freeze extended**: stored documents and signatures are insert-only. A certificate or signature can only be
   added to a signed version, and a proposal document only to a draft about to be sent. Signing links can only be
   revoked. Org deletion still cascades through everything.

Out (Phase 4+, not started): the verify page (upload a PDF → match), the Lab Intelligence sample template, the README
case study and its disclaimer, and sending email to the client (D-01 mocked; no live external writes; the owner copies the link).

## Tasks

| # | Task | Files |
|---|---|---|
| T1 | This plan + DECISIONS rows D-29… | `docs/countersign/` |
| T2 | Pure: PDF documents (proposal, certificate), selection pricing, signature + consent validation, IP hash | `src/lib/proposal/{pdf.tsx,selection.ts,signature.ts}`, tests |
| T3 | Schema + migrations: `ProposalDocument`, `SigningLink`, `ProposalSignature`; freeze triggers; RLS; export; fixtures | `prisma/…`, `src/app/export-hooks.ts`, `tests/fixtures/app.ts` |
| T4 | Store: actor-generic `applyEvent` (with audit metadata and an in-transaction hook), `sendProposal`, `newSigningLink`, documents | `src/lib/proposal/store.ts` |
| T5 | Signing: token lookup (cross-org), link access, view/sign/decline, certificate, expiry cron | `src/lib/proposal/{signing,signing-link}.ts`, `src/app/cron-jobs.ts` |
| T6 | Routes + UI: owner send/new link/downloads; client `/sign/[token]` (410), review page, POST handlers, PDF downloads | `src/app/o/[org]/proposals/**`, `src/app/sign/**` |
| T7 | e2e: send → open → toggle add-on → draw/type → sign → certificate; superseded link → 410 | `e2e/signing.spec.ts` |
| T8 | CI: D-27's schema-diff grep covers the new tables/enums | `.github/workflows/ci.yml` |

## Invariants and the tests that prove them

| Acceptance item | Proof |
|---|---|
| CS-01 (unchanged) + add-on toggle | Phase 1/2 tests green. `selection.test.ts`: pricing with a selection = `price()` with those `selected` flags; only optional lines are affected; an unknown or non-optional id is refused; order-independent (property test) |
| CS-02 a signed version's PDF hash never changes; any byte change fails verify | `pdf.test.ts`: same version → identical bytes (determinism), any content change → different hash. Freeze tests: stored document rows can't be updated or deleted; `sent` is refused without a matching stored document; store test: the stored bytes hash to `pdfSha256`, flipping any byte fails `verifySha256`. The downloaded PDF (route and e2e) hashes to the recorded value |
| CS-03 a signing link for a superseded version returns 410 | Signing test: after an edit supersedes v1, v1's token → 410 (and declined, expired, link-expired, revoked → 410; unknown → 404); every POST and the PDF route with that token → 410, nothing written. e2e: an HTTP GET returns status 410 |
| CS-04 every state transition writes an audit event | Phase 2 property test still green; signing tests: open/sign/decline each write exactly one audit row carrying ipHash (never the raw IP), user agent and pdfSha256; a refused event (stale version, wrong hash, no consent) writes nothing |
| CS-05 a client sees only their own proposal | A token resolves to exactly one version in one org; signing test: org B's token never reaches org A's rows; INV-01..04 harness over the new owner actions; INV-29/32 (the new cross-org file is registered) |
| D-16 binding over HTTP | Signing tests: a POST with a stale version → refused (`VersionMismatchError`), a wrong hash → refused, nothing written |
| Certificate | Signing test: the certificate is stored, its sha256 matches its bytes, and its text contains the document hash, the signer, the consent text, the final total and one line per audit event |
| Expiry | Cron test: an expired link's version becomes `expired` (one audit row); unexpired and drafts are untouched; running it twice changes nothing |

## Gate

`npm run lint`, `npm run typecheck`, `npm test` (unit, property, integration, invariants) and Playwright green locally,
then GitHub CI green (`ci (off)` including `prisma migrate deploy`, the D-27 diff, and Playwright, plus `modules-removed`).
Then stop. Phase 4 is not started.
