# #30 Countersign — proposal builder + e-sign — decisions

Made by Claude on 2026-11-13 while Shane was away. Each is a default he can change.

| ID | Problem | Options | Decision | Change it |
|---|---|---|---|---|
| D-01 | Real e-sign provider | DocuSign/Dropbox Sign API, mocked signing with real audit trail | **mocked** — no account, no cost; trail and hashing are the learning point | add a provider adapter later |
| D-02 | PDF rendering | React-PDF, headless Chromium print | **React-PDF** — deterministic bytes are easier, which CS-02 needs | Chromium if layout needs CSS |
| D-03 | Money type | integer cents, decimal library | **integer cents** | — |
| D-04 | Name / number | Countersign, #30 | as stated | rename before repo creation |
| D-0B | Foundation billing module | keep, remove via `check-modules` | **remove** — nothing here is sold as a subscription; other modules kept (Holdout needs `apikeys` for ingest) | merge the module back |
| D-05 | Template test `rls:policies module guard (F-09)` (in clone-owned `tests/unit/foundation-tools.test.ts`) expects every module in `MODULES` to have tables, so it fails once billing is removed | patch the test, keep billing, list it in `FOUNDATION_PATCHES.md` | **patch the test** to compare against the modules whose `prisma/schema/<m>.prisma` still exists; `tests/unit` is not template-owned, so drift stays clean (2026-11-14, Phase 0) | revert the two lines; worth an upstream F-row so the next billing-removed clone doesn't hit it |
| D-06 | Phase 0 sandbox can't reach `binaries.prisma.sh` (schema engine) or `apt.postgresql.org` (proxy 403) | stop, skip local DB, local stand-ins | **local stand-ins, CI is the gate**: Postgres 17.11 from the `@embedded-postgres/linux-x64` npm package; `prisma generate` with `PRISMA_SCHEMA_ENGINE_BINARY` pointed at a stub (generate never runs it); `db:setup`'s `migrate deploy` replaced locally by a psql loop that applies each `migration.sql` and records `_prisma_migrations`. Nothing of this is committed. Full local `npm test` was green (269 pass, 20 skip); GitHub Actions runs the real `prisma migrate deploy` (2026-11-14) | rerun `npm run db:setup` on a laptop; nothing in the repo changes |
| D-07 | `gh repo edit --default-branch main` (KICKOFF) — the routine has no `gh` beyond search and no MCP call that edits repo settings | skip, ask | **skipped**: `main` is pushed, the default branch stays `kit` until Shane flips it in Settings → Branches (2026-11-14) | one click in repo settings |
