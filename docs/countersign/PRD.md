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
