# Mobile Canvas declutter proof

Production route: `https://nodevideo-pi.vercel.app/creator`
Viewport: Android Chrome, 412x783 CSS pixels, DPR 2.625
Theme/session/fixture: identical to `change-boundary.md`

## Observed outcome

| Check | Before | After collapsed | After expanded |
| --- | --- | --- | --- |
| Artifact eyebrow | Visible | Merged into selected artifact title | Merged into selected artifact title |
| Variant controls | Two-line title cards | Compact 16:9 / 9:16 controls | Compact 16:9 / 9:16 controls |
| Timeline | Always visible | Named summary only | Exact two tracks and audio route visible |
| Video canvas height | 429 CSS px with timeline exposed | 576 CSS px | 429 CSS px |
| Document width | 412 / 412 CSS px | 412 / 412 CSS px | 412 / 412 CSS px |
| Console errors | 0 | 0 | 0 |

## Protected contract replay

- Canvas, Chat, and Files navigation remained visible and operable.
- 16:9 and 9:16 remain real tabs with full accessible variant names.
- Video playback controls and source media remained unchanged.
- Expanding Timeline reproduced the same `primary/video`, `overlay/text`, duration, and `source program · 0 dB · unmuted` content.
- Desktop keeps the full timeline visible without the mobile trigger.
- NodeAgent history, Auto/Ask, proposal decisions, receipts, export, and Files recovery were outside the changed regions and passed their existing creator journeys.

## State limitations

The production workspace compiles the deterministic first plan synchronously when creation starts, so the `Timeline` component's no-variant empty branch is not stably reachable for pixel capture in the normal journey. Its existing honest empty copy is unchanged and remains covered structurally; this run does not claim new pixel proof for that transient branch. Loading and error states live in NodeAgent Chat and were intentionally outside this Canvas-only boundary.
