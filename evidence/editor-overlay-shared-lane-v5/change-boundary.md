# Overlay shared-lane boundary

- Route: `http://127.0.0.1:4173/edit.html`
- Desktop viewport: 1440 × 900 CSS pixels
- Responsive viewport: 390 × 844 CSS pixels
- Theme: NodeVideo dark
- Session: isolated anonymous headless Chromium; no personal Chrome profile
- Fixture: committed `Sign` EditPlan with 14 timed text overlays
- Trigger: open `Edit overlays`, select the first visible overlay, then inspect Timeline

## CHANGE A · Canvas overlay editor

Current: Canvas can select visible text and edit its words or geometry, but that selection does not exist on Timeline. Text is only visible at the current playhead and the agent proposal has no pixel-adjacent caption identity.

Expected: selecting a caption block on Timeline seeks to its start, enters overlay editing, and selects the same Canvas text. Human and accepted agent timing changes update Canvas from the same accepted `EditPlan`.

Data source: accepted `EditPlan` overlay clips and current player frame.

| State | Expected visible result |
| --- | --- |
| Empty | Canvas remains a playable accepted cut before overlay editing starts. |
| Loading | Existing frozen-plan loading copy remains; no caption controls appear early. |
| Error | Invalid timing proposal leaves Canvas and accepted Plan unchanged and shows the existing timeline error surface. |
| Populated | The selected timed overlay appears at its exact Plan range and remains editable by text, drag, and resize. |
| Overflow | Long caption text stays bounded by the existing 80-character guard and preview box. |
| Responsive | Caption selection remains reachable from the mobile Timeline and returns to a readable Canvas. |

## CHANGE B · Shared timeline

Current: only video A/B blocks are visible and selectable; 14 real overlay clips are hidden. Agent overlay patches therefore have no proposal block or causal before/after timing proof.

Expected: one compact caption lane displays all 14 timed overlay blocks. A discriminated selection swaps the contextual toolbar between video commands and caption timing. Human and NodeAgent can move one caption exactly one beat earlier/later; invalid bounds fail closed. Proposal, Apply, receipt, and Undo expose the exact affected caption block without mutating the accepted row before approval.

Data source: accepted/proposed `EditPlan`, typed `PlanPatch`, and frozen beat grid.

| State | Expected visible result |
| --- | --- |
| Empty | No proposal row or agent label before an action exists. |
| Loading | No lane or controls before the committed Plan loads. |
| Error | Boundary rejection preserves ranges and exposes a specific recovery message. |
| Populated | 14 caption blocks align to exact Plan ranges; the selected block exposes Earlier/Later by one beat. |
| Proposal | Current caption lane remains unchanged; proposal lane marks only the moved caption with before/after timing. |
| Accepted | Accepted caption block and receipt identify the NodeAgent change. |
| Undo | Exact prior Plan and selection return; stale receipt disappears. |
| Overflow | Caption labels truncate inside blocks; lane scrolls internally without widening the document. |
| Responsive | Compact caption blocks and contextual actions remain usable at 390 × 844. |

## Unchanged neighbors

- Project bar, NodeAgent settings/provider contract, waveform, export controls, and mobile navigation.
- Existing video Split/Swap/Trim/Duplicate/Delete/reorder behavior and audio/beat ripple algorithms.
- Creator workspace persistence and authenticated social distribution are separate milestones.
- No dependency, schema migration, publish, upload, deployment, or external mutation.
