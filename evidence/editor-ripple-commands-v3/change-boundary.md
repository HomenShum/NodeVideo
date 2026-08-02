# Editor ripple-command boundary

- Route: `http://127.0.0.1:4188/edit.html`
- Desktop viewport: 1440 × 900 CSS pixels
- Responsive viewport: 390 × 844 CSS pixels
- Theme: NodeVideo dark
- Session: isolated anonymous headless Chromium; no personal Chrome profile
- Fixture: committed `Sign` EditPlan
- Trigger: select source clip `#2`

## CHANGE A · Selected clip command bar

Current: Split, Swap take, Trim in, and Trim out are available for the selected source block.

Expected: Duplicate and Delete join the same contextual bar. Delete is destructive-colored but immediate and undoable; Duplicate remains neutral. Keyboard shortcuts use the same commands.

## CHANGE B · Accepted and proposal blocks

Current: accepted blocks reflect split/swap/trim/reorder; NodeAgent uses an aligned proposal lane.

Expected: manual commands update accepted blocks immediately; agent Delete/Duplicate remain proposals until Apply. Receipts name the actor and operation.

## State contract

| State | Expected visible result |
| --- | --- |
| Empty/loading | No contextual or ripple controls before the accepted plan exists. |
| Error | Invalid deletion (last source block) or stale proposal leaves accepted state unchanged and explains recovery. |
| Populated | Duplicate increases source-block count and duration; Delete decreases both; Undo restores the exact prior plan. |
| Overflow | All six actions remain visible without widening the document. |
| Responsive | Commands remain inside the dedicated mobile Timeline surface at 390 × 844. |

## Multi-track invariants

- Primary video remains contiguous from frame 0 through `durationFrames`.
- Audio clips and audio-program events retain matching source offsets and target ranges.
- Overlays inside the interval are duplicated/deleted; later overlays ripple by the same duration.
- Beat and downbeat markers ripple with the edited interval.
- Clip/event IDs remain unique and operations return fresh plans.

## Unchanged neighbors

- Project bar, Canvas layout, NodeAgent provider/settings UI, export controls, waveform styling, and mobile navigation.
- No new dependency, provider, upload, deployment, or external state change.
