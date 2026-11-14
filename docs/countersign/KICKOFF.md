# #30 Countersign — proposal builder + e-sign — Claude Code kickoff

## Session prompt — Phase 0 + Phase 1

Kit location: until Phase 0 runs, this file, PRD.md and DECISIONS.md live on branch `kit` in `docs/`. Phase 0 creates `main` from the foundation tag, copies them into `docs/countersign/`, pushes `main`, and sets it as the default branch (`gh repo edit shanelabountyai/countersign --default-branch main`). Never delete `kit`. Remove the billing module per the foundation README unless DECISIONS.md says otherwise. You cannot push to saas-foundation: put the CLONES.md row you'd add in the PR body under "For Shane".

```text
You are building Countersign (build-log #30) on saas-foundation v1.6.2 (clone with shared history, never "Use
this template"; quickstart with name countersign, port 8300). Read docs/countersign/PRD.md and DECISIONS.md.
Decisions are in force; new ones: pick, append a row, keep going, never ask.

Phase 0 on main: foundation clone, new-project, gate = foundation CI green. Phase 1 on branch kickoff (PR #1
unmerged), pure modules only: write docs/countersign/PHASE1_PLAN.md first; then src/lib/proposal/pricing.ts,
versioning.ts (state machine + supersede rules), hash.ts (SHA-256 over bytes, verify), with table tests and
fast-check property tests for CS-01 and CS-02. Gate: lint, typecheck, test green; PR body lists the rounding rules
chosen. Then stop.
```
