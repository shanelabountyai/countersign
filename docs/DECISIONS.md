# #30 Countersign — proposal builder + e-sign — decisions

Made by Claude on 2026-11-13 while Shane was away. Each is a default he can change.

| ID | Problem | Options | Decision | Change it |
|---|---|---|---|---|
| D-01 | Real e-sign provider | DocuSign/Dropbox Sign API, mocked signing with real audit trail | **mocked** — no account, no cost; trail and hashing are the learning point | add a provider adapter later |
| D-02 | PDF rendering | React-PDF, headless Chromium print | **React-PDF** — deterministic bytes are easier, which CS-02 needs | Chromium if layout needs CSS |
| D-03 | Money type | integer cents, decimal library | **integer cents** | — |
| D-04 | Name / number | Countersign, #30 | as stated | rename before repo creation |
| D-0B | Foundation billing module | keep, remove via `check-modules` | **remove** — nothing here is sold as a subscription; other modules kept (Holdout needs `apikeys` for ingest) | merge the module back |
