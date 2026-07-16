# QA profile: NodeVideo live choreography-driven milestone

Mode: AUTHORIZED PRODUCTION. Execute claims literally and fail closed.

The foreground release is the strict `integrated-source-only-v1` inspector plus the production
Convex workflow. It binds the official choreography, two creator takes, chosen song, timed lyrics,
DP/beam plan, pre-target freeze, post-freeze evaluation, real MediaPipe pose tracks, and a silent
public derivative of the strict frozen render.

## Environment and gates

| Thing | Value |
| --- | --- |
| Production | `https://nodevideo-pi.vercel.app` |
| Local | `npm run dev`; Playwright owns port 4317 |
| Quality | `npm run check`; `npx playwright test frame-inspector` |
| Evidence | `.qa/evidence/public` is public-safe; `.qa/evidence/private` stays ignored |
| UI budget | shadcn/Radix primitives; ≤900 authored UI LOC; ≤200 LOC per authored UI file |

## Proven claim boundary

- The two creator takes align to the independently downloaded official choreography at 15.5 s
  and 25.5 s using mirrored, root-normalized multi-person MediaPipe matching.
- The choreography-driven global DP/beam planner selected A/B/A/B/A and fit/fill/fit/fill/fit.
- Post-freeze evaluation reports exact 44.5 s duration, 5/5 phrase-source agreement, complete
  boundary coverage, and signed errors of -2, -1, +1, -2, 0, and 0 frames.
- All 6/6 assigned boundaries pass the two-frame gate; strict verdict: passed.
- Production Convex records 15/15 completed stages, 13 artifacts, review/freeze receipts, evaluator
  isolation, and a recoverable retry event for the preview upload.
- The independently sourced private soundtrack comparison reports 0.979986 correlation and
  0.75 ms best lag. The public preview is silent; the UI gives an Instagram search/segment handoff.
- The browser verifies the trusted manifest plus seven declared assets before rendering the
  inspector. One 30 fps output frame controls all evidence panels; pose overlays disclose 10 Hz
  measured samples versus interpolated display frames.
- The strict edit retains MediaPipe pose evidence. A separate research-only production follow-up
  executes NVIDIA LocateAnything as durable `ground_subjects` evidence and validates one active
  lyric cue at frame 465 with zero body-box intersection.

Not claimed: a fresh independent blind benchmark, bit-identical reproduction, licensed public
commercial audio, generalized creative taste from one owner-calibrated case, generalized
LocateAnything accuracy from one live frame, or elastic Vercel-hosted FFmpeg/model workers.

## Release blockers

1. Trusted manifest and all seven public artifact hashes must verify.
2. Target mount/read and target-audio-oracle flags must remain false during generation.
3. Pose artifacts must contain reference, take A, take B, and target tracks with JSON-safe nulls.
4. Generated preview must remain silent and public media sanitized. The local-only route may expose
   the private soundtrack in Vite development, but production preview must never return video bytes
   from that URL.
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
5. In local development, verify the private player is unmuted, byte-range capable, and drives the
   shared frame. In production preview, verify the private URL is HTML/not-video and the public
   generated preview remains muted.
