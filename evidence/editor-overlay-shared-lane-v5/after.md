# Overlay shared-lane verification

Named proof: `Overlay Shared-Lane Proof`

- The committed Sign fixture renders 14 accepted timed-caption blocks beneath the five A/B source blocks.
- Selecting caption #6 on Timeline seeks its exact start, enters Canvas overlay editing, and selects the same text box.
- Human Earlier/Later changes one overlay range by exactly one beat; pointer drag commits normalized geometry; both are undoable.
- NodeAgent proposal preserves the accepted lane, shows the caption's exact before/after timing, and requires Apply. Accepted state carries `AI MOVED`; Undo restores the exact prior range.
- Caption #1 rejects an earlier move at frame zero without mutating the accepted Plan.
- Hidden mobile Canvas no longer yields `font-size: 0px`; the editor uses the same output font-fit calculation with container-relative scaling.
- Mobile caption blocks use a horizontally scrollable 560px working track so adjacent real buttons do not overlap.
- The shortest caption control is 24x24 CSS pixels on the mobile working track.
- Model-backed editing permits exactly one successful mutation per approval card; later mutations return `one_edit_per_proposal` until review.
- Agent history evicts old turns after eight exchanges (16 rendered turns), preventing sustained sessions from growing UI state without bound.
- The standalone artifact replay accepts a NodeAgent duplicate plus a human `PROOF CUT` caption rewrite, then exports a 2.000s 180×320 H.264 MP4. Independent FFprobe finds one video stream and no audio; OCR of the decoded frame reads `PROOF CUT`.

Unchanged: project bar, model/provider settings, waveform, video commands, export controls, mobile navigation, Creator workspace, and external social accounts.

Evidence states: `after-empty.png`, `after-loading.png`, `after-error.png`, `after-desktop-proposal.png`, `after-desktop-accepted.png`, `after-undo.png`, `after-mobile-proposal.png`, `after-mobile-accepted.png`, and `after-mobile-canvas.png`.

Artifact evidence: `accepted-edited-export.mp4`, `accepted-proof-frame.png`, `accepted-export-receipt.json`, and the reproducible `capture-export-proof.mjs`.
