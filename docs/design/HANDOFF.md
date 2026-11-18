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

### Gap artboards added 2026-11-18 (design pass, unattended run)

Same tokens, same format (inline styles, `renderVals()` sample data as `[PLACEHOLDERS]`, word → glyph → colour for every
status). Added to `canvas.json`; not yet on the Claude Design canvas.

| File | Screen | Covers |
| --- | --- | --- |
| `SignLanding.dc.html` | Client: open the signing link | GET `/sign/<token>` 200 landing; the "Open proposal" POST (D-33). Found in the code; not in the list above |
| `DeclineConfirm.dc.html` | Client: decline, with confirmation | Decline confirmation (listed gap) |
| `LinkNotices.dc.html` | Client: link notices | 410 declined / expired / replaced / closed, 404, 429. Found in the code; Superseded covers one 410 only |
| `Verify.dc.html` | Public verify page | Upload form and every verdict (listed gap) |
| `ProposalsList.dc.html` | Sender: proposals list | Listed gap, with the empty state |
| `TemplatesList.dc.html` | Sender: templates list | Listed gap, with the sample template (D-43) |
| `TemplateEditor.dc.html` | Sender: template editor | Listed gap; its section and line rows are also the proposal editor's edit rows |

Status set used everywhere (word, glyph, colours on white): Draft ✎ `#3E434D/#EEEEEA`; Sent ↗ `#0F5E63/#E3F1F1`;
Viewed ● `#1D4F91/#E6EEF9`; Signed ✓ `#FFFFFF/#1D4F91`; Declined ✗ `#8A1F11/#FBE9E7`; Expired ⌛ and Superseded ↻
`#6B4100/#FBF0DA`. Red (`#8A1F11`, border `#B42318`) is new: the original artboards had no failure state.

## Placeholders

[YOUR TERMS], [SHA-256 …], [HASH], [PINNED VERSION] and [SENDER EMAIL] are placeholders; LI-2026-014 / Northwind Outfitters / Jordan Avery are sample data.
