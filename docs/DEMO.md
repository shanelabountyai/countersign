# Countersign: local demo walk-through

**Not deployed.** This runs on your laptop against a local Postgres with synthetic demo data. Nothing here is live.
Written 2026-11-24 for the portfolio pack (branch `portfolio-pack/2026-11-24`, from `main` at `c63360b`).

"Verified by" names an automated test that passed in the 2026-11-24 run (D-73: `npm test` 812 passed / 31 skipped,
`npm run test:e2e` 23 of 23). A passing test drove the screen; it is not the same as Shane clicking through it.
"Not yet clicked through by Shane" means no test in that run covers the stop as written.

## At a glance

| | |
|---|---|
| **Who it is for** | A services business that sends quotes, and the client who signs them (PRD "Why"). Lab Intelligence is named as a possible first user. |
| **What was decided** | Signing is mocked, the audit trail is real (D-01). Money is integer cents (D-03), tax rounded once per rate (D-18, Shane's call). A sent or signed version, its lines and its PDF are frozen by database triggers (D-21, D-35). An add-on the client picks is recorded with the signature, so the signed PDF never changes (D-32). `/verify` re-derives the record rather than trusting a stored hash (D-40). |
| **What was left out** | A real e-sign provider, payments and deposits, email to the client, any legal review (PRD "Out of scope", D-01). Artboard details with nothing behind them (D-56). Dark mode (D-51). |
| **The complete journey** | Template → proposal → send (copy the one-time link) → client opens, picks add-ons, signs or declines → both sides get the certificate → anyone holding the PDF checks it on `/verify`. |
| **Why someone comes back in week three** | By design, not observed with users: the next quote starts from a saved template (D-20); a link expires after 1–90 days, 30 by default, and "New link" replaces it (D-36); a decline shows its reason on the proposal page (D-69); when a client or their lawyer asks "is this what was signed?", `/verify` answers it (D-40). |
| **The design** | Built from the Claude Design artboards in `docs/design/`: one shared stylesheet, system fonts, light only (D-49 to D-51); every status is word + glyph + colour (DUX-02); axe WCAG 2.1 A/AA on every Countersign page (DUX-01); the client review fits 390 px (DUX-05); each org sets its own logo and accent colour (D-66). |

## Start it

Needs Node 22 and a local Postgres 17 you can create databases in (README Quickstart).

```bash
npm ci
npm run db:setup     # creates countersign and countersign_test, writes .env.local (with DEMO_MODE=1) and .env.test, migrates
npm run seed:demo    # two demo orgs (Acme Studio, Globex Labs), owner/admin/member in each
npm run dev          # http://localhost:8300/demo
```

Not run as written on 2026-11-24: this sandbox cannot download Prisma's schema engine, so `npm ci`'s postinstall and
`db:setup`'s `migrate deploy` were replaced by stand-ins (D-73). The e2e run built and served the app the way CI does
(`npm run build:test` then `npm run start:test`).

## Stops

1. **Demo sign-in.** Open `/demo`, choose `owner@acme.demo.test`, then Acme Studio under "Your orgs".
   Verified by `e2e/demo.spec.ts` › "demo sign-in lands a seeded owner in their org".
2. **Org home.** With no proposals it shows "Nothing here yet" and Countersign's first steps; with proposals, the recent
   ones with their status (D-63). Empty state verified by `e2e/onboarding.spec.ts` › "new email → org created → lands in
   /o/[slug]". The recent-proposals list: not yet clicked through by Shane.
3. **Sample template.** Templates → "Add the sample template". It is named SAMPLE, every price is $0.00 with "set your
   price", no client is named (D-43). Verified by `e2e/sample-template.spec.ts` › "add the sample template → proposal
   from it shows the SAMPLE section and a $0.00 total".
4. **Template editor.** Sections, terms, the merge fields `{{client}}`, `{{scope}}`, `{{timeline}}` (D-25), and lines:
   fixed, hourly, per unit, optional add-on. Verified by `e2e/proposals.spec.ts` › "template → proposal → draft save →
   supersede after send" and `e2e/design.spec.ts` › "templates, verify and the link notices pass axe".
5. **Proposal editor.** New proposal from the template, edit lines and the discount, save the draft. A refused save keeps
   every typed value and focuses its message (DUX-08); the editor reflows at 320 px. Verified by `e2e/proposals.spec.ts`
   (as above) and `e2e/design.spec.ts` › "review fixes: send keeps the link and refreshes the page; a refused save keeps
   the fields; editors reflow at 320 px; decline keeps focus".
6. **Send.** Pick a link validity (1–90 days), send. The PDF is rendered and hashed; the one-time link stays in a
   copyable field (DUX-07). A merge field used but empty gets a warning, not a block (D-70). Verified by the same
   "review fixes" test and `e2e/design.spec.ts` › "follow-ups: org brand on client pages, empty merge-field warning,
   decline reason for the sender, stale POST lands on the notice".
7. **Client: open the link** in a private window. The landing page asks "Open proposal"; that POST is the recorded view
   (D-33). Verified by `e2e/signing.spec.ts` › "send → open → add-on → typed signature → downloads match the recorded
   hashes".
8. **Client: review and pick an add-on.** The total updates. Verified by the same signing test. The polite announcement
   of the new total (DUX-10) is not automated: not yet clicked through by Shane.
9. **Client: sign.** Type a name (or "draw your signature instead"), tick the consent box, sign. The exact stored consent
   wording sits behind "Read the exact consent wording" (D-54, kept by Shane, D-66). Typed verified by the signing test
   above; drawn by `e2e/signing.spec.ts` › "a drawn signature; an edit after send makes the old link HTTP 410".
10. **Signed page and certificate.** Banner and certificate first, then the signed proposal (D-59). The downloaded PDF and
    certificate hash to the recorded values; the hash shows on the certificate (and on `/verify`), not on the signing pages (DUX-03). Verified by the first
    signing test and `e2e/design.spec.ts` › "the hash is on the certificate only; signing pages and the editor pass axe;
    phone layout fits 390 px".
11. **Decline instead.** On a second proposal: "Decline", give a reason, confirm. Nothing is recorded until confirmed
    (D-57); the link then answers 410 "declined"; the sender sees "Declined by the client" with the reason (D-69).
    Verified by `e2e/design.spec.ts` › "decline asks first, records nothing until confirmed, then the link answers 410
    "declined"" and the "follow-ups" test.
12. **Edit after send.** Edit a sent proposal: v2 is a new draft and v1's link answers HTTP 410 (CS-03, D-13). Verified by
    `e2e/signing.spec.ts` › "a drawn signature; an edit after send makes the old link HTTP 410" and `e2e/proposals.spec.ts`.
13. **Stale page.** Sign or decline from a tab opened before the edit: it lands on the branded link notice (D-67).
    Verified by the "follow-ups" test.
14. **Verify.** Open `/verify` signed out. Upload the signed PDF → "Verified"; the certificate → "Verified"; a copy with one
    byte changed → "Not verified"; an unsigned proposal's PDF → "Not verified" (D-17, D-40). Verified by
    `e2e/verify.spec.ts` › "signed PDF and certificate verify; one flipped byte and an unsigned PDF do not".
15. **Brand.** Settings → Brand: an accent colour (refused under 4.5:1 contrast, with its ratio) and a PNG/JPEG logo up to
    100 KB; client pages pick them up, PDFs and `/verify` do not (D-66). Verified by the "follow-ups" test.
16. **Phone width.** The client review at 390 px with no sideways scroll and a 44 px sign button (DUX-05); the sender nav
    scrolls in one row (D-68). Client side verified by the "hash is on the certificate only … 390 px" test; the sender
    pages at 390 px (DUX-16) are not automated beyond 320 px editors: not yet clicked through by Shane.
17. **Expiry.** A link past its validity answers 410 at once; the daily cron then marks the version expired (D-36). Not
    clickable without waiting days. Verified by `tests/integration/countersign-signing.test.ts` › "a link past its expiry
    is 410 at once, before the cron runs; then the cron expires the version" (vitest, not a browser).

**Score:** 17 stops. 14 fully covered by a test that passed on 2026-11-24 (1, 3–7, 9–15, 17); 3 partly covered (2, 8,
16), each part named above. None has been clicked through by Shane.
