# NodeVideo Choreography Coach extension

This unpacked Manifest V3 extension connects the active YouTube watch page to a
private worker on the dancer's laptop. The video upload and derived pose tracks
remain local. The worker downloads a reference only after an explicit rights
confirmation; that confirmation does not grant a publication or music license.

## Run locally

1. Start the private worker with a stable token:

   ```powershell
   $env:NODEVIDEO_COACH_TOKEN='choose-a-long-local-token'
   npm run coach:sidecar
   ```

2. Build the Manifest V3 bundle with `npm run extension:build`.
3. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**,
   and select `apps/chrome-extension/dist`.
4. Open a YouTube choreography watch page and click the NodeVideo extension.
5. Enter the start and end of the exact music/choreography section when the
   reference contains multiple sections or repetitions.
6. Upload the dancer's MP4/MOV, enter the token, confirm rights, and run the
   judge. NodeVideo locates the selected reference duration inside a longer raw
   take. Phone HEVC/HDR uploads are normalized to a cached H.264/yuv420p
   analysis proxy while retaining original/proxy hashes in private provenance.
   Team-safe defaults detect up to 10 dancers; lower that maximum only
   when a solo/duet needs faster processing. A completed job returns scores, evidence confidence, critical moments,
   raw pose tracks, provenance, and an audio-backed skeleton comparison video.

The service binds to `127.0.0.1:4319`, requires a bearer token, accepts only
Chrome-extension and loopback origins, caps uploads at 700 MB, rejects references
longer than 15 minutes, and persists job state under the ignored private QA tree.

## What the verdict means

The beta measures observable 2D pose form, temporal alignment, path, pose-speed
dynamics, and coarse formation. It abstains when coverage, visibility, or motion
alignment is weak. It does not judge artistry, musicality, expression, confidence,
safety, creator taste, or calibrated 3D biomechanics.

Detector order is stabilized into persistent performer slots. A solo upload
against a group reference uses a continuity-constrained focal-performer path;
team formation is scored only when the upload visibly contains a team. The
overall number remains a relative motion signal, not a pass/fail grade. Run the
leakage-guarded calibration workflow with `npm run coach:calibrate -- --manifest
<private-manifest.json> --output <private-report.json>` and publish score bands
only when the report passes its independent pair and case-group minimums.

Validate against additional expert-labeled human pairs before using scores for
auditions, ranking, health, or employment decisions.

The side panel is bundled React and composes the repo's shadcn-generated Radix
primitives. Card, Button, Input, Label, Progress, Alert, Badge, Collapsible, and
Checkbox own interaction and accessibility behavior; authored code is limited to
the YouTube/worker adapter, job state, artifact playback, and product-specific
layout tokens.
