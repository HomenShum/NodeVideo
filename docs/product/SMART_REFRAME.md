# Smart Reframe capability

Smart Reframe is a first-class NodeVideo creator workflow for converting one authorized source
into vertical, square, and landscape cuts while keeping the chosen subject in frame.

## Product path

1. Load an authorized source into the creator workspace.
2. Choose **Smart Reframe**.
3. Detect subjects locally with the bundled MediaPipe pose model.
4. Select the intended subject explicitly.
5. Choose a framing policy and crop-motion preset.
6. Generate 9:16, 1:1, and 16:9 crop paths from the same cached track.
7. Review critic coverage and the crop-path lane.
8. Drag a crop frame when manual correction is required.
9. Ask NodeAgent to compile a proposal.
10. Approve and export locally.

## Typed artifacts

- `SubjectTrack` records sampled observations, critical regions, continuity, and warnings.
- `FramingIntent` declares the subject, aspect ratio, policy, margins, and motion behavior.
- `ReframePlan` contains bounded crop keyframes, confidence ranges, tracking-loss holds, and
  manual overrides.
- `ReframeCritic` reports subject and critical-region coverage, motion findings, clipped moments,
  low-confidence ranges, and a pass/review/fail verdict.

## Invariants

- Raw media and derived frames stay in the browser.
- Subject identity is selected explicitly and never silently switched.
- Low-confidence observations hold the previous trustworthy crop.
- Manual keyframes take precedence over generated keyframes.
- All requested aspect ratios reuse one subject-analysis pass.
- Remotion preview and browser FFmpeg export consume the same EditPlan crop keyframes.
- A crop proposal is reviewable before it becomes canonical.

## Current scope

The reference tracker is optimized for visible human poses. Object, animal, face-only, and
multi-subject group policies are represented in the contracts and pack templates but require
additional specialized detectors before they can claim equivalent production support.
