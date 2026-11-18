# Design handoff

Source of truth for the UI built on branch `design/impl`. Exported 2026-11-18 from the Claude Design canvas so cloud runs don't depend on artifact access.

- Canvas: https://claude.ai/artifact/Cn8tm6RYfaQbyHkw5jJbpa
- Brief: https://claude.ai/artifact/637chKHuWUjxVvU9VBBgjE

## Artboards (`docs/design/*.dc.html`)

Each file is a self-contained Design Component: HTML with inline styles, `{{holes}}` filled by the `renderVals()` script at the bottom. Read the markup and the script together; the script holds the sample data.

| File | Screen | Frame |
| --- | --- | --- |
| `Main.dc.html` | Client: review and sign — desktop | 1280×1640 |
| `PhoneSign.dc.html` | Client: review and sign — 390 px | 390×1900 |
| `Certificate.dc.html` | Client: signed + certificate | 1280×1160 |
| `Superseded.dc.html` | Client: newer version exists (410) | 1280×700 |
| `Editor.dc.html` | Sender: proposal editor | 1440×1180 |

## Owner calls (binding)

- Client pages use per-org branding, seeded with Lab Intelligence. (Shane, 2026-11-17)
- The document hash is shown on the certificate only, not on the signing pages. (Shane, 2026-11-17)
- Tax is rounded once on the subtotal per rate. (Shane, 2026-11-14)

## Gaps: screens the PRD needs that no artboard covers

- Template editor
- Proposals and templates lists
- Public verify page (upload PDF → match / no match)
- Decline confirmation

Design each gap as a new `docs/design/<Name>.dc.html` in the same look before building it.

## Placeholders

[YOUR TERMS], [SHA-256 …], [HASH], [PINNED VERSION] and [SENDER EMAIL] are placeholders; LI-2026-014 / Northwind Outfitters / Jordan Avery are sample data.
