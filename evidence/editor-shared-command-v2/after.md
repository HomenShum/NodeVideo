# Editor shared-command proof

## Observed states

- `after-desktop-selected.png`: clip `#2` selected with Split, Swap take, Trim in, and Trim out.
- `after-desktop-agent-proposal.png`: accepted five-block row remains unchanged while NodeAgent proposes a six-block split row.
- `after-desktop-agent-applied.png`: proposal is promoted to six accepted, selectable blocks with a NodeAgent receipt.
- `after-mobile-selected.png`: the same contextual commands remain reachable inside the dedicated Timeline surface at 390 × 844.
- `after-loading.png`: no contextual controls or fabricated clip data appear before the frozen plan loads.
- `after-rejected-command.png`: a too-short split is rejected visibly and leaves the selected accepted block unchanged.

## Unchanged assertions

- Same `Sign` fixture, route, dark theme, anonymous isolated session, and named viewports as `change-boundary.md`.
- Project bar, Canvas, NodeAgent provider/settings disclosure, waveform, export, and mobile navigation retain their prior structure.
- A pending proposal does not mutate the accepted timeline.
- Audio and overlay tracks remain untouched by Split, Swap, and beat-boundary commands.
- `capture-metrics.json` records exact viewport/document width parity and no browser console errors.

## Agent reliability

- The model supplies only a clip index for Split; deterministic plan code selects the nearest safe beat and emits the exact frame in the reviewable patch.
- Every split preserves source-frame and timeline continuity and refuses segments shorter than one beat per side.
- The maximum number of accepted splits is naturally bounded by plan duration divided by the one-beat minimum.
