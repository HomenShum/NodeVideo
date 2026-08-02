# Agent timeline-causality boundary

- Route: `http://127.0.0.1:4188/edit.html`
- Desktop viewport: 1440 × 900 CSS pixels
- Responsive viewport: 390 × 844 CSS pixels
- Theme: NodeVideo dark
- Session: isolated anonymous headless Chromium; no personal Chrome profile
- Fixture: committed `Sign` EditPlan
- Trigger: ask local NodeAgent to `duplicate 2`, then open Timeline

## CHANGE A · Shared timeline proposal and acceptance handoff

Current: the proposal row applies the same generic `AI` badge to the selected source block and the inserted duplicate. Delete highlights the block now occupying the removed index, which can be mistaken for the removed block. After Apply, only selection plus a text receipt identify the accepted change; Undo leaves that receipt visible.

Expected: the proposal visibly names the source block and inserted/shifted block using operation-specific roles. The compact delta sentence states the duration effect. Apply transfers one concise agent label onto the accepted block; Undo removes that label and stale receipt.

Data source: accepted `EditPlan`, proposed `EditPlan`, and the typed `PlanPatch`; no inferred model prose or new timeline state.

| State | Expected visible result |
| --- | --- |
| Empty | No proposal map or accepted-agent label before a proposal/action exists. |
| Loading | No proposal map before the committed EditPlan has loaded. |
| Error | Stale/invalid proposals preserve the accepted row and expose existing recovery copy. |
| Populated | Duplicate shows `SOURCE` and `+ COPY`; Delete shows `− REMOVE` and `SHIFT LEFT`; the duration delta is explicit. |
| Accepted | One accepted block carries `AI ADDED` or `AI SHIFTED`, with the actor receipt below it. |
| Undo | Accepted-agent annotation and receipt disappear with the reverted plan. |
| Overflow | Labels truncate inside their blocks; explanatory copy wraps without widening the document. |
| Responsive | Semantic labels and Apply/Dismiss remain visible in the mobile Timeline surface at 390 × 844. |

## Unchanged neighbors

- Project bar, Canvas, NodeAgent composer/history/settings, waveform, export controls, and mobile navigation.
- Manual Split/Swap/Trim/Duplicate/Delete behavior and the EditPlan mutation algorithms.
- No new dependency, provider, upload, deployment, or external state change.
