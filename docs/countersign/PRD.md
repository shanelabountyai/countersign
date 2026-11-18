# #30 Countersign — proposal builder + e-sign

Status: **kickoff** (2026-11-13). Repo: `shanelabountyai/countersign` (public). Port 8300.
Base: saas-foundation v1.6.2 clone.

**Why:** every services business sends quotes. Countersign builds a proposal from templates and line items,
renders a PDF, tracks versions, and runs a signing flow whose audit trail can prove what was signed, by whom, and
that the document hasn't changed since. Lab Intelligence can use it for its own proposals.

**Scope v1:**
- **Templates:** sections with merge fields (client, scope, timeline), reusable line items (fixed, hourly,
  per-unit, optional add-ons), terms blocks.
- **Proposals:** draft → sent → viewed → signed / declined / expired; every edit after "sent" creates a new
  version and voids the old signing link.
- **Pricing math:** pure module with integer cents, discounts (percent / fixed, line or total), tax rate per
  line, optional items the client can toggle before signing; rounding rules documented and tested.
- **PDF:** server-rendered from the same data (React-PDF or Playwright print, D-02); the SHA-256 of the exact PDF
  bytes is recorded per version.
- **Signing (mocked provider, real audit):** client opens a magic link (foundation share links), reviews, types
  or draws a signature, consents to e-records language, signs. The audit trail records each event with timestamp,
  IP (hashed), user agent, document hash. A completion certificate PDF lists the trail and the hash.
- **Verify page:** upload a PDF → says whether it matches a signed version's hash.

**Out of scope:** a real e-sign provider (DocuSign etc.), payments/deposits, legal advice on enforceability
(README states the demo is not a legally vetted e-signature product).

**Invariants:** CS-01 pricing totals are exact in integer cents and stable under line reordering; CS-02 a signed
version's PDF hash never changes and any byte change fails verify; CS-03 a signing link for a superseded version
returns 410; CS-04 every state transition writes an audit event; CS-05 a client sees only their own proposal.

**Phases:** 1 pure pricing + versioning + hash/verify modules → 2 schema, templates, proposal editor → 3 PDF render,
signing flow, certificate → 4 verify page, Lab Intelligence sample template, README case study.

## Design, UX and accessibility requirements (design pass, 2026-11-18)

Source: the Claude Design artboards in `docs/design/` (HANDOFF.md owner calls are binding) and the three reviews of the
built UI (findings DES-*, UX-*, A11Y-* in the design-pass PR). Each is checked by `e2e/design.spec.ts` unless noted.

- **DUX-01** Every Countersign page passes axe WCAG 2.1 A/AA with 0 violations (landing, review, decline open, signed + certificate, 410/404, verify form and result, proposals and templates lists, proposal and template editors).
- **DUX-02** Every status is shown as word + glyph + colour, never colour alone (HANDOFF.md status set).
- **DUX-03** The document hash appears on the certificate (signed page, certificate PDF) and the verify page, not on the landing or review page body (owner call; the exact consent wording behind a disclosure is D-54, pending Shane).
- **DUX-04** Client pages show the sending org's name as their brand (D-48).
- **DUX-05** The client review page fits 390 px with no sideways scroll; the sign button is at least 44 px tall. The editors fit 320 px with no sideways scroll (A11Y-1).
- **DUX-06** Decline asks for confirmation in place, records nothing until confirmed, and never drops keyboard focus (A11Y-2, D-57, D-64).
- **DUX-07** After Send or Replace the link, the one-time link stays on screen in a copyable field and the page shows the new status, with no stale Send or Save left (UX-1, UX-7, D-62).
- **DUX-08** A refused editor save keeps every typed value and moves focus to the message beside the Save button (UX-2, A11Y-3, D-62).
- **DUX-09** A refused client sign moves focus to its message; an empty drawn signature is caught before submit so nothing on the page is lost (UX-4, A11Y-5). Not automated.
- **DUX-10** A change to the total from an add-on is announced politely (A11Y-4). Not automated.
- **DUX-11** No mockup sample data ships: no artboard names, numbers or `[PLACEHOLDERS]` in `src/` (DES review).
