# QA profile: NodeVideo integrated source-only proof

Mode: AUTHORIZED PRODUCTION. Execute claims literally and fail closed.

The foreground release is `integrated-source-only-v1`. It binds the official choreography,
two sanitized creator takes, source-only analysis and edit plan, a pre-target freeze receipt,
post-freeze evaluation, selected-performer evidence, real MediaPipe pose tracks, and a silent
generated preview. Legacy proof bundles remain public artifacts but are no longer presentation UI.

## Environment and gates

| Thing | Value |
| --- | --- |
| Production | `https://nodevideo-pi.vercel.app` |
| Local | `npm run dev`; Playwright owns port 4317 |
| Quality | `npm run check`; `npx playwright test frame-inspector` |
| Evidence | `.qa/evidence/public` is public-safe; `.qa/evidence/private` stays ignored |
| UI budget | shadcn/Radix primitives; ≤900 authored UI LOC; ≤200 LOC per authored UI file |

## Proven claim boundary

- The two creator takes align to the independently downloaded official choreography at 15.4 s
  and 25.5 s using mirrored, root-normalized multi-person MediaPipe matching.
- The source-only planner selected A/B/A/B/A, fit/fill/fit/fill/fit, and cuts at 6.6, 15.8,
  19.8, and 25.28 seconds before the target was mounted or read.
- Post-freeze evaluation reports exact 44.5 s duration, 5/5 phrase-source agreement, cut F1
  0.909091, 0.153333 s mean boundary error, and 0.266667 s maximum boundary error.
- The independently sourced private soundtrack comparison reports 0.979986 correlation and
  0.75 ms best lag. The public preview is silent; the UI gives an Instagram search/segment handoff.
- The browser verifies the trusted manifest plus seven declared assets before rendering the
  inspector. One 30 fps output frame controls all evidence panels; pose overlays disclose 10 Hz
  measured samples versus interpolated display frames.
- LocateAnything was not executed because no licensed sidecar is configured. MediaPipe pose
  evidence is shown honestly instead of relabeling replay boxes.

Not claimed: bit-identical reproduction, licensed public commercial audio, generalized creative
taste from one case, live LocateAnything accuracy, or a Vercel-hosted FFmpeg/model job.

## Release blockers

1. Trusted manifest and all seven public artifact hashes must verify.
2. Target mount/read and target-audio-oracle flags must remain false during generation.
3. Pose artifacts must contain reference, take A, take B, and target tracks with JSON-safe nulls.
4. Generated preview must remain silent and public media sanitized.
5. Desktop, 1280, tablet, 390 px phone, and 320 px compact-phone tests must have no overflow,
   serious accessibility violations, or broken one-frame controls.
6. `npm run check` and the focused five-viewport Playwright suite must pass before deployment.

## Stable selectors

| Selector | Contract |
| --- | --- |
| `app-shell` | reachable NodeVideo shell |
| `integrated-frame-inspector` | collapsed on first load; no heavy pose fetch until opened |
| `verified-frame-inspector` | seven assets verified and synchronized inspector visible |
| `Output frame` | Radix slider with an accessible thumb name |
| `Previous output frame` / `Next output frame` | exact one-frame movement |

## Required journeys

1. Open the inspector, wait for 7/7 verification, and inspect official pose, both creator takes,
   frozen generated edit, and manual final MP4 at frame 480.
2. Advance to frame 481 with the button, return with ArrowLeft, and confirm all panels seek.
3. Repeat at all five configured viewport sizes; assert ≤1 px document overflow and zero Axe
   violations inside the verified inspector.
4. On production, verify the same journey plus manifest/content-type/range delivery.
