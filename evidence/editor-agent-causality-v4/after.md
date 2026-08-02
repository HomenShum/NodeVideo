# Agent timeline-causality verification

- Route: `http://127.0.0.1:4188/edit.html`
- Fixture: committed `Sign` EditPlan served through Vite `publicDir: fixtures`
- Browser: isolated headless Chromium, not the personal Chrome profile
- Viewports: 1440 × 900 and 390 × 844 CSS pixels

## Observed states

| State | Evidence | Observation |
| --- | --- | --- |
| Loading | `after-loading.png` | Plan loading is explicit; no change map appears before the accepted EditPlan exists. |
| Empty | `after-empty.png` | The accepted timeline has no fabricated proposal map or agent badge. |
| Duplicate proposal | `after-duplicate-proposal.png` | The map names `A #2 · SOURCE → A #3 · + COPY` and `+3.6s`; the same two desktop blocks carry semantic labels. |
| Duplicate accepted | `after-duplicate-accepted.png` | The inserted accepted block carries `AI ADDED`; the NodeAgent receipt remains directly below the row. |
| Undo | `after-undo.png` | The five-block plan, clip #2 selection, and empty receipt state are restored. |
| Delete proposal | `after-delete-proposal.png` | The map names `A #2 · − REMOVE → B #2 · SHIFT LEFT` and `−3.6s`; only the actual shifted proposal block is highlighted. |
| Delete accepted | `after-delete-accepted.png` | The surviving accepted block carries `AI SHIFTED` and the NodeAgent deletion receipt. |
| Error | `after-error.png` | Last-source deletion preserves the accepted block and exposes the existing recovery message. |
| Responsive/overflow | `after-mobile-proposal.png` | The full causal map and Apply/Dismiss remain visible at 390 × 844; the document-width gate passes. |

## Replayed gates

- 13/13 runnable editor E2E scenarios pass across desktop and mobile; the existing mobile-only H.264 download exclusion remains one skip.
- 20/20 focused unit scenarios pass, including full EditPlan ripple validation and browser/worker parity.
- Biome, TypeScript, production build, UI policy, and UI budget pass.
- Axe reports zero violations under the suite’s existing color-contrast exclusion; labels, keyboard actions, and document geometry are asserted directly.
- Screenshot automation fails on console/page errors and document-width overflow.
- Build retains the repository-wide large-chunk warning; the generated editor chunk is 378.12 kB.

## Reference decisions

- Sora’s split flow preserves selected-block identity before and after the operation: https://mobbin.com/flows/585d42b8-aff2-4804-aa6a-e28706fe4f3a
- Langdock’s suggestion flow presents the proposed delta on the artifact before acceptance: https://mobbin.com/flows/23c25e1d-38d3-4baa-a18b-f5e8cf27e110
