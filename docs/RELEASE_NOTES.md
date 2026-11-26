# Countersign release notes

## Not deployed — portfolio pack 2026-11-24

Countersign has never been deployed. It runs locally on synthetic demo data; nothing here is live and no one outside
the project has used it. This entry records what exists on `main` at `c63360b` and the docs-only pack added on branch
`portfolio-pack/2026-11-24`.

### What exists, by pull request

Each merge commit below was checked on 2026-11-24 with `git merge-base --is-ancestor <sha> origin/main`.

| PR | Merged (UTC) | Merge commit | What it added |
|---|---|---|---|
| #1 | 2026-11-14 | `eafb978` | Pure pricing (integer cents, tax once per rate, D-18), versioning state machine, SHA-256 hash and verify modules (CS-01, CS-02) |
| #2 | 2026-11-15 | `9df17cd` | Schema, templates, proposal editor; sent and signed versions frozen by database triggers (D-21) |
| #3 | 2026-11-16 | `c65077f` | Deterministic PDF render, signing links (410 once superseded), typed or drawn signature, consent, audit trail, completion certificate, expiry cron |
| #4 | 2026-11-16 | `f36b6ba` | Public `/verify` that re-derives the record (D-40), Lab Intelligence sample template at $0.00 (D-43), README case study |
| #6 | 2026-11-17 | `415adca` | Renderer pinned and recorded per document, org name snapshotted, "renderer changed" verdict (fixes issue #5; D-45, D-46) |
| #7 | 2026-11-17 | `ea17563` | saas-foundation v1.6.4 (security) |
| #8 | 2026-11-17 | `7d2ca99` | saas-foundation v1.6.5 + v1.6.6 (security) |
| #9 | 2026-11-18 | `1c7bec8` | saas-foundation v1.7.0 (security); `FOUNDATION_VERSION` reads `v1.7.0` |
| #10 | 2026-11-19 | `7c80957` | Design pass: artboards built into the app, 7 gap screens, design/UX/accessibility review fixes (D-47 to D-65) |
| #11 | 2026-11-19 | `c63360b` | Org logo and accent colour (D-66), stale POST → notice (D-67), phone sender UI (D-68), decline reason (D-69), empty merge-field warning (D-70) |

Merge times are GitHub's `merged_at`; #1 merged at 17:26 UTC on 11-14 and #2 at 02:40 UTC on 11-15.

### Gate on 2026-11-24 (recorded, synthetic data, local stand-ins per D-73)

`npm run lint` 0 · `npm run typecheck` 0 · `npm test` 812 passed, 31 skipped (63 files) · `npm run build:test` 0 ·
`npm run test:e2e` 23 of 23 passed. `npm ci` exits 1 here (Prisma engine download blocked) and bare `npm run build`
exits 1 without `.env.local`; GitHub CI on the pack's pull request is the real gate.

### The pack

| Item | Where | State |
|---|---|---|
| Gate run | `docs/countersign/DECISIONS.md` D-72, D-73; PR description | Done, local stand-ins; CI on the PR |
| Demo walk-through | [`docs/DEMO.md`](DEMO.md) | 17 stops: 14 covered by a passing test, 3 partly; none clicked through by Shane (D-74) |
| Exec brief "Countersign in Brief" | [Claude Docs, private](https://claude.ai/artifact/9SoeELLhUFENLMwiSqNyer) | Updated in place from the 2026-11-23 draft (D-76); not shared. **Not verified** by the 2026-11-26 review (it is outside the repo; D-77) |
| LinkedIn drafts | [`docs/LINKEDIN_DRAFTS.md`](LINKEDIN_DRAFTS.md) | 2 drafts, on D-40 and D-32; drafted, unposted |
| Cost note | `docs/countersign/DECISIONS.md` D-75 | Build cost and running cost not measured; the $1.00/month demo AI cap is a limit, not a result |
| Release notes | this file | This entry |
| Hand-off | `NEXT.md`, top section | Done |

Not in the pack: a deploy, hosting, a live URL, any account or environment change.
