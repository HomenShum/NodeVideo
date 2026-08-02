# Editor ripple-command verification

- Route: `http://127.0.0.1:4188/edit.html`
- Fixture: Vite `publicDir: fixtures`; committed `media/integrated-source-only-v1/edit-plan.json`
- Browser: isolated headless Chromium, not the personal Chrome profile
- Viewports: 1440 × 900 and 390 × 844 CSS pixels

## Observed states

| State | Evidence | Observation |
| --- | --- | --- |
| Loading | `after-loading.png` | Frozen-plan loading copy is visible; no selected-clip command bar exists. |
| Manual | `after-desktop-selected.png` | Selected clip #2 exposes Split, Swap, both trims, Duplicate, and destructive Delete. |
| Agent pending | `after-agent-proposal.png` | The six-block agent result is a separate proposal lane; the accepted lane still has five blocks. |
| Agent accepted | `after-agent-applied.png` | Apply promotes the proposal to six accepted blocks, selects the inserted block, and records NodeAgent. |
| Guard | `after-last-delete-guard.png` | The final source block remains; Delete is disabled and the recovery message is visible. |
| Responsive | `after-mobile-selected.png` | At 390 × 844 all six actions wrap into view inside Timeline; the document does not overflow. |

## Replayed gates

- 20/20 focused unit scenarios pass, including sustained growth to the 64-source cap, deletion down to the last source, secondary b-roll ripple, and exact browser/worker parity.
- 11/11 runnable editor E2E scenarios pass across desktop and mobile; the existing mobile-only H.264 download exclusion remains 1 skipped.
- Biome, TypeScript, production build, UI policy, and UI budget pass.
- Console/page errors and document-width overflow fail the screenshot harness.
- Build retains the repository-wide large-chunk warning; the generated editor chunk is 376.01 kB.
