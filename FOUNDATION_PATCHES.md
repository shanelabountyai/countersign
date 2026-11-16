# Foundation patches (Countersign)

Template-owned files this clone changes, each excused by path and diff hash (`npm run foundation:drift`). Move each one
upstream and delete its line once the template carries it.

`scripts/foundation-check-modules.ts` `b8b7d79f07d6` — the scratch-copy rsync excluded `src/generated` unanchored, which also drops every dependency's `dist/src/generated` (yoga-layout, used by @react-pdf/renderer, D-31), so `next build` in the copy failed; anchored to `/src/generated` (D-39). Upstream F-row candidate.
