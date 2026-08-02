# Editor shared-command boundary

- Route: `http://127.0.0.1:4187/edit.html`
- Desktop viewport: 1440 × 900 CSS pixels
- Responsive viewport: 390 × 844 CSS pixels
- Theme: NodeVideo dark
- Session: isolated anonymous headless Chromium; no personal Chrome profile
- Fixture: committed `Sign` plan from `/media/integrated-source-only-v1/edit-plan.json`
- Trigger: select clip `#2` on the accepted timeline

## CHANGE A · Selected clip command bar

Current: the timeline identifies the selected clip, but selection exposes no local editing actions.

Expected: selection exposes one compact contextual bar for operations the plan can preserve safely: Split, Swap take, Trim in, and Trim out. Every action is undoable and reports whether the human or NodeAgent performed it.

Data source: accepted `Plan`, current selected clip index, player frame, and beat grid.

| State | Expected visible result |
| --- | --- |
| Empty | No plan: no fabricated clip controls; Canvas retains the honest loading state. |
| Loading | Context bar remains absent until the frozen plan exists. |
| Error | Invalid operations leave the accepted timeline unchanged and expose a reason beside the controls. |
| Populated | Selected clip identity, source take, duration, four contextual actions, and the latest actor-attributed receipt. |
| Overflow | Compact labels remain reachable without covering blocks; mobile bar scrolls horizontally if required. |
| Responsive | Timeline remains a dedicated mobile surface; selected controls sit above the accepted blocks and stay inside the viewport. |

## CHANGE B · Accepted timeline blocks

Current: blocks support selection, seek, drag reorder, and keyboard reorder.

Expected: the same blocks also reflect manual and accepted NodeAgent patches. A split creates two real selectable blocks; trims and source swaps change those blocks directly; pending agent changes remain in the aligned proposal row until applied.

## Unchanged neighbors

- Project bar, export state, Canvas composition, overlay editor, waveform generation, NodeAgent provider/settings UI, and mobile navigation remain visually and behaviorally unchanged.
- Audio and overlay timing are not changed by this slice.
- Delete and duplicate are out of scope until a multi-track ripple-edit contract exists.

## Reference rationale

- Sora: selected clip exposes a compact local Split/Slip/Delete menu.
- ElevenLabs: clip selection and destructive actions remain attached to the timeline selection.
- VEED: contextual element operations sit directly above the timeline instead of occupying a second permanent panel.
