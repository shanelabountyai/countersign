# Countersign

Proposal builder with an e-sign audit trail (build log #30). Port 8300. Cloned from saas-foundation v1.6.2.

> **Not a legally vetted e-signature product, and not legal advice.** Countersign is a demonstration of how a signing
> record can be made tamper-evident. Signing runs on a mocked provider (D-01); nothing here has been reviewed for
> ESIGN, UETA, eIDAS or any other law, and whether a signature made with it is enforceable is a question for a lawyer.

## What it does

- **Templates** with sections, terms and the merge fields `{{client}}`, `{{scope}}`, `{{timeline}}`; reusable line items
  (fixed, hourly, per unit, optional add-ons). A one-click **Lab Intelligence sample template** (labelled SAMPLE, every
  price a $0.00 placeholder, no client named) shows a full proposal layout.
- **Proposals** move draft → sent → viewed → signed / declined / expired. Any edit after sending creates a new version and
  turns the old signing link into an HTTP 410.
- **Pricing** in integer cents: line and proposal discounts, tax rounded once per rate, add-ons the client toggles before
  signing. Totals do not depend on line order.
- **PDF**: rendered deterministically at send; the SHA-256 of the exact bytes is stored with the version, and the database
  refuses to change a sent version, its lines or its stored PDF.
- **Signing**: the client opens a link, reviews, types or draws a signature and ticks the e-records consent. Each event is
  audited with time, a keyed hash of the IP, the user agent and the document hash, and a completion certificate PDF lists
  the whole trail.
- **Verify** (`/verify`, public): upload a proposal PDF or a certificate. The page hashes the exact bytes, finds the signed
  version with that hash, and says **Verified** only after re-deriving the record from stored data: the stored bytes,
  recorded hashes and audit trail agree, the version is signed, the proposal PDF and the certificate re-render to the
  identical bytes, and the agreed price re-computes. Anything else is **Not verified**.

Design decisions: `docs/countersign/DECISIONS.md` (D-01 onward). Scope: `docs/countersign/PRD.md`. Phase plans:
`docs/countersign/PHASE1_PLAN.md` to `PHASE4_PLAN.md`.

## Case study: proving a signed PDF has not changed

The question a signing tool has to answer later is "is this the document that was signed?" Countersign answers it with
one rule (CS-02): a signed version's PDF hash never changes, and any changed byte fails verification. Phases 1 to 3 built
the pieces (a pure hash module, deterministic PDFs, triggers that freeze a sent version, the audit trail and the
certificate); Phase 4 put a page in front of them that anyone can use without an account.

Two choices made the verify page more than a hash lookup:

1. **Re-derive, do not just read back.** A stored hash only proves the stored bytes match the stored hash. The verify page
   also re-renders the proposal PDF from the version's frozen rows and the certificate from the stored signature and audit
   trail, and compares bytes. That catches a record edited at rest even when the edit leaves the uploaded file's hash in
   place: in the integration tests, changing a stored signature total, a frozen line, the signer's name, the certificate
   bytes, an audit row, or the org's name all turn a verified PDF into "the stored record is inconsistent".
2. **Unsigned never verifies.** A sent, replaced, declined or expired version keeps its hash, but the page reports it as
   "never signed" rather than as a match (D-17).

Numbers from the Phase 4 run (2026-11-16), each produced by a command run in that session:

| Measure | Result | Command |
|---|---|---|
| Single-byte flips of a rendered PDF that still verified | **0 of 5,930** (the sample-template proposal PDF is 5,930 bytes; every position flipped once, plus one byte appended and one removed) | `npx vitest run tests/proposal/verify.test.ts` |
| Re-derivation checks behind a "Verified" | 8, all passing for a real send → view → sign | `npx vitest run tests/integration/countersign-verify.test.ts` (18 tests) |
| Unit, property, integration and invariant tests | 672 passed, 30 skipped, 58 files | `npm test` |
| End-to-end tests against the production build | 18 passed, including upload of the signed PDF, its certificate, a one-byte-tampered copy and an unsigned PDF on `/verify` | `npm run test:e2e` |

What it does not prove: who was at the keyboard (the trail records a hashed IP and a user agent, not an identity), or
anything about a PDF that was never stored by this instance. Renaming the org after signing makes re-derivation fail
(D-41): the check reports it rather than hiding it.

## Foundation

A Next.js 16 + Prisma 7 + Postgres template with the parts every multi-tenant app rebuilds: magic-link sign-in with TOTP,
orgs and roles, one authorization path, an append-only audit log, share links, cron, and optional billing (Stripe) and
notifications (SMS). Its safety rules are executable: `tests/invariants/` holds INV-01 to INV-28, and CI fails if one breaks.

Design and decisions: `FOUNDATION_SPEC.md`. Milestones and the sync model: `IMPLEMENTATION_PLAN.md`. Releases: `CHANGELOG.md`. Clones: `CLONES.md`.

## Quickstart (about 10 minutes)

Needs Node 22 and a local Postgres 17 you can create databases in (Homebrew `postgresql@17` works with no password).

```bash
git clone git@github.com:shanelabountyai/saas-foundation.git my-app
cd my-app
git remote rename origin template
git checkout -B main v1.0.0   # -B: a fresh clone already has a main
npm ci
npm run new-project -- my-app 4200   # name and port; rewrites package.json, CI, Playwright, README
npm run db:setup                     # creates my_app and my_app_test, writes .env.local and .env.test, migrates both
npm run seed:demo                    # two orgs, owner/admin/member each; owners and admins have TOTP
npm run dev                          # http://localhost:4200/demo
```

**Do not use GitHub's "Use this template" button.** It drops the shared history, so later fixes can't be merged.
Working on the template itself: `npm run dev:template` serves on :4100.

`db:setup` never overwrites an existing `.env.*` and never prints a value. It uses your OS user against `localhost:5432`;
set `PGUSER`/`PGPASSWORD` or `LOCAL_PG_URL_BASE` for a different Postgres. Real keys (Resend, Stripe, Twilio) are optional
and go in `.env.local`; without them email is captured in the database, billing uses a mock, and SMS is off.

### Row-level security on Neon (optional, `RLS_MODE=enforce`)

`db:setup` gives you two roles locally: the owner (`DATABASE_URL` while RLS is off, `DATABASE_URL_SYSTEM`, `DIRECT_URL`) and
`<name>_app_rw` with `NOBYPASSRLS` (`DATABASE_URL_APP_RW`). To enforce locally, set `DATABASE_URL` to the app_rw URL and
`RLS_MODE=enforce` together: app_rw with RLS off sees no org rows, because off mode sets no org. On Neon, the role the console creates is a `neon_superuser` with `BYPASSRLS`, so the app role is made
in SQL, as the owner, on the branch:

```sql
CREATE ROLE app_rw LOGIN PASSWORD '<generate one>' NOBYPASSRLS NOSUPERUSER;
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
```

Then in Vercel: `DATABASE_URL` = app_rw through the pooler (`-pooler` host), `DATABASE_URL_SYSTEM` = the owner through the pooler,
`DIRECT_URL` = the owner without the pooler, `RLS_MODE=enforce`. Run `npm run rls:policies` once for your own org-owned models and
commit the migration; INV-30 fails until you do. The pooler accepts an SQL-created role (spike S4a ran through it).

## Commands

| Command | What it does |
|---|---|
| `npm test` | vitest against the local test database: unit, integration and all invariants |
| `npm run test:e2e` | Playwright against a production build (`E2E_DEV=1` runs the dev server for debugging one spec) |
| `npm run lint` / `typecheck` | ESLint (including the core-boundary rule) and `tsc` |
| `npm run db:migrate` | create a migration in dev; `db:migrate:test` applies to the test database |
| `npm run seed:demo` | idempotent demo accounts; refuses a cloud database |
| `npm run foundation:drift` | in a clone: fails if a template-owned file was edited |
| `npm run foundation:status` | in a clone: current vs latest release, and any `security:` changelog entries between |
| `npm run foundation:check-modules` | builds a scratch copy with both modules deleted (CI runs it) |

## Layout

- `src/core/`: env, db, auth, tenancy, authz, audit, tokens, email, share links, cron. Never imports from `src/modules` or `src/app` (lint-enforced).
- `src/modules/{billing,notifications}/`: optional, deletable.
- `src/app/`: routes. `src/app/cron-jobs.ts` is where a clone adds its own cron work. `src/app/org-hooks.ts` holds the
  clone's org hooks: `beforeOrgDelete` (runs before an org is deleted; throwing stops it) and `filterListedOrgs` (which of a
  user's orgs `/onboarding` and `/demo` list; default all, and it can only hide, never add — D-22).
- `prisma/schema/`: `core.prisma` plus one file per module. A clone's tables get their own file and migrations.
- `tests/invariants/`: the security rules as tests. `tests/fixtures/app.ts` holds a clone's harness rows.

## Removing a module

Delete the paths listed for it in `scripts/foundation-modules.ts`, and the lines marked `// billing` or `// notifications`
(`{/* billing */}` in `layout.tsx`) in `prisma/schema/core.prisma`, `src/app/cron-jobs.ts` and `src/app/o/[org]/layout.tsx` —
that includes the module's nav link, so it goes with the rest.
`foundation:check-modules` does exactly this in a scratch copy and requires validate, typecheck, build and drift to pass.
The module's tables stay in the migration history; drop them with a clone migration if you want them gone. Date that
migration after the template's newest migration: the RLS policy migrations up to `20261108000002` `ALTER` module tables
unguarded. Policy migrations from 1.6.2 on skip a module table that no longer exists.

If your own code imports a module outside the marked lines (a clone's own routes or lib files, not just
`cron-jobs.ts`/`org-hooks.ts`), list it in `src/app/required-modules.ts`. `check-modules` leaves a required module in
place and still removes the rest.

## Staying current

Template-owned paths (core, modules, invariants, security routes) are never edited in a clone, so `git merge vX.Y.Z` is clean.
An urgent local patch goes in `FOUNDATION_PATCHES.md` as `` `path` `hash` — reason `` (drift prints the hash to paste in) and moves upstream at the next release. The excuse stops matching, and drift fails again, once that path changes further.
Upgrade steps and versioning rules: `IMPLEMENTATION_PLAN.md` §3.3.

## Not included

Legal pages are stubs (`/legal/privacy`, `/legal/terms`) and are not legal advice. There is no audit-log viewer and no
`/o/[org]/settings/security` page yet.

No cookie banner: the foundation sets only strictly necessary cookies (`session`, `totp_pending`), and those need no consent.
If you add analytics, ads or any other non-essential tracker, you need consent first (spec D-20).
