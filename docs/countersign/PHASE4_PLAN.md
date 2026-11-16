# Countersign — Phase 4 plan: verify page, Lab Intelligence sample template, README case study

Branch `phase-4`, one PR against `main`, not merged by Claude. Builds on Phases 1–3 (merged, PRs #1–#3). Owner decisions
**D-16** (client events bound to version + PDF sha256) and **D-18** (tax once per rate) and every Phase 3 row through
**D-39** are binding. Written by the scheduled routine on 2026-11-16 (unattended; new choices are DECISIONS rows D-40…).

## Scope (PRD "Phases": 4 = verify page, Lab Intelligence sample template, README case study)

In, and nothing else:

1. **Verify page** (PRD: "upload a PDF → says whether it matches a signed version's hash"). Public `/verify`: anyone
   holding a PDF uploads it; the server hashes the exact bytes (CS-02) and looks the hash up among stored documents
   (proposal PDFs and completion certificates). A match is only reported as **verified** after the record is
   **re-derived from stored data**, not just read back:
   - the stored bytes hash to their recorded sha256 and equal the upload byte for byte;
   - the version's recorded `pdfSha256`, the signature's `pdfSha256` and the audit trail's `signed` event agree;
   - the version is `signed` (D-17: a sent, superseded, declined or expired version's PDF never verifies as signed);
   - the proposal PDF **re-renders** from the version's frozen rows (D-31 determinism) to the identical bytes;
   - the price the signer agreed to re-computes (`priceSelection`, D-32) to the stored totals;
   - the completion certificate **re-renders** from the stored signature, version rows and audit trail to the identical
     bytes, and its stored bytes hash to its recorded sha256.
   Any tampered byte in the upload gives a clear **Not verified** (no stored document has that hash). A stored record
   that no longer re-derives gives **Not verified — the stored record is inconsistent**. Nothing is written (except
   the per-IP rate-limit counter).
2. **Lab Intelligence sample template**: a one-click "add sample template" on the templates page that creates an
   editable template, labelled **SAMPLE** in its name and in its first section. No client names, no implied clients or
   results, and no prices: every line is $0.00 with "set your price" in its description, so nothing can read as a quote.
3. **README case study**: the README leads with what Countersign is, the not-legal-advice / not-a-vetted-e-signature
   disclaimer the PRD requires, how the hash, trail, certificate and verify page fit together, and a short case study
   whose every number comes from a command run in this session (gate counts, a rendered sample PDF's size, the
   exhaustive byte-flip test).

Out (beyond the PRD): a real e-sign provider (D-01), email delivery, payments, a verify JSON API, embedding a verify URL
or QR code in the PDFs (would change Phase 3's hashed bytes), certificate fonts, deploys.

## Tasks

| # | Task | Files |
|---|---|---|
| T1 | This plan, DECISIONS rows D-40… | `docs/countersign/` |
| T2 | Shared certificate model (sign and verify derive the certificate with the same code) | `src/lib/proposal/certificate.ts`, `signing.ts` |
| T3 | Verify: cross-org hash lookup (INV-32 registered), re-derivation checks, verdict | `src/lib/proposal/{verify.ts,verify-lookup.ts}`, `src/core/db/cross-org.ts` (clone line), migration: index on `ProposalDocument.sha256` |
| T4 | `/verify` route (GET form, POST multipart upload, size limit, rate limit), link from the proposal page | `src/app/verify/route.ts`, `src/lib/proposal/verify-http.ts`, proposal page |
| T5 | Sample template data + store function + templates-page action/button | `src/lib/proposal/sample-template.ts`, `store.ts`, `src/app/o/[org]/templates/*` |
| T6 | Tests: pure, integration, route, e2e | `tests/proposal/verify.test.ts`, `tests/proposal/sample-template.test.ts`, `tests/integration/countersign-verify.test.ts`, `e2e/verify.spec.ts` |
| T7 | README case study + disclaimer; NEXT/CHANGELOG untouched (template-owned history) | `README.md` |
| T8 | CI: D-27 schema-diff grep unchanged (no new table/enum); the new index is covered by the same diff | — |

## Acceptance items and the tests that prove them

| Acceptance item | Proof |
|---|---|
| Verify: a signed version's PDF verifies | integration: real send → view → sign, upload the stored proposal PDF → `verified`, every check ok; e2e: download the PDF from the signing link, upload it on `/verify` in a fresh browser → "Verified" |
| Verify: the certificate verifies too | integration + e2e: upload the certificate → `verified` (kind certificate) |
| **Tamper test: any changed byte fails** | pure (`tests/proposal/verify.test.ts`): a real rendered PDF, **every byte position** flipped one at a time, plus one byte appended and one removed → `matchSignedVersion` null for each; integration: first/middle/last byte flipped → `no_match`; e2e: one byte flipped in the downloaded PDF, uploaded → "Not verified" |
| Re-derivation from stored data (not just a stored-hash read) | integration, each with triggers bypassed as the DB owner to simulate tampering at rest: signature total changed → `inconsistent` (pricing check); a frozen line's text changed → `inconsistent` (proposal re-render); certificate bytes changed → `inconsistent`; org renamed after signing → `inconsistent` (D-41, documented limit) |
| D-17 on the page: unsigned never verifies | integration: a sent (unsigned) PDF and a superseded version's PDF → `not_signed`; e2e: an unsigned proposal's PDF → "Not verified" |
| Verify writes nothing; public but bounded | integration: DB snapshot (versions, documents, signatures, links, audit count) unchanged; per-IP limit → 429; empty, non-PDF-size or over-limit upload refused (400/413) |
| CS-05 a client sees only their own proposal | the lookup needs the exact bytes (a 256-bit hash); the page shows only what the document and its certificate already show (D-40); INV-32: the new cross-org file is registered and the harness stays green |
| Sample template is clearly a sample | pure: name and first section say SAMPLE, every price is 0, no `{{…}}` beyond D-25's set, passes `validateTemplate`; integration: the action creates one editable template in the caller's org only (scorekeeper refused, D-24); e2e: owner adds it, creates a proposal from it, sees the SAMPLE section |
| Existing invariants CS-01..05, D-16, D-18 | the full Phase 1–3 suites still green; signLink now builds its certificate through the shared model (Phase 3 certificate tests unchanged and green) |
| README case study numbers are real | each number in the README is quoted from command output in this session (listed in the PR body) |

## Gate

`npm run lint`, `npm run typecheck`, `npm test` (unit, property, integration, invariants) and Playwright green locally
(as far as the sandbox allows, D-06), then GitHub CI green: `ci (off)` (including `prisma migrate deploy`, the D-27
schema diff and Playwright) and `modules-removed`. Then stop: one PR, not merged.
