# NodeVideo architecture

## Architectural decision

NodeVideo has one semantic control plane and one deterministic media data plane. The control plane decides and records *what* should run; versioned workers perform frame/audio math and return typed artifacts. React renders those records. No UI component, hidden model prompt, or synthetic fixture is allowed to manufacture successful provenance.

The browser-local release path implements event, artifact, proposal, trace, and version boundaries in memory/local storage. A separate deterministic CLI produced the checked-in public media proof. A production Convex control-plane schema is deployed and the browser performs a read-only health query, but worker/job mutations are internal-only until an authenticated bridge exists. FFmpeg is not hosted in Vercel.

The following diagram and ownership table describe the target deployment boundaries; the current activation boundary is documented separately below.

```mermaid
flowchart LR
  U["User or QA agent"] --> UI["React + AI Elements presentation shell"]
  UI --> ORCH["NodeAgent-style orchestrator"]
  ORCH --> CP["Semantic control plane\nprojects · jobs · events · approvals · versions"]
  ORCH --> W["Deterministic media workers\nFFmpeg · audio · pose · alignment · diffs · render"]
  W --> OS["Object/media storage\nraw bytes and rendered media"]
  W --> CP
  CP --> A["Typed artifact registry"]
  CP --> T["react-o11y trace adapter"]
  A --> UI
  T --> UI
  UI --> P["Reviewable proposal"]
  P -->|"accept exact candidate"| V["New restorable version"]
```

## Layer ownership

| Layer | Owns | Does not own | Reuse source |
|---|---|---|---|
| Presentation shell | first-run, local upload affordance, plan/progress cards, artifact/trace panels, proposal review, versions | orchestration policy, frame math, invented receipts | Parity Studio and selected AI Elements patterns |
| Orchestrator | intent, plan, tool selection, dependencies, job lifecycle, cancellation/retry, artifact emission, validation requests | React layout, pixel/frame reasoning, silent mutation | NodeAgent typed tools and durable-runtime patterns |
| Semantic control plane | projects/assets metadata, jobs/stages/events, artifacts, approvals, versions, comments, traces, presence | heavy video/audio bytes | NodeRoom/Convex schemas and append-only event patterns |
| Trace adapter | span hierarchy, status, timing, filters, artifact/timeline focus | domain decisions or synthetic timing | NodeRoom trace contract plus `@assistant-ui/react-o11y` |
| Media workers | probe/normalize, thumbnails/waveforms, beat/onset, pose, alignment, trajectory/form/dynamics diffs, previews/bursts, export | conversational planning or approval | versioned FFmpeg and purpose-built deterministic workers |
| Release proof | UI journeys, screenshots/video, FFprobe checks, held-out fixtures | substituting a demo for analytical correctness | FeatureClipStudio proof workflow |

## Current P0 boundary

The current slice has three deliberately separate evidence modes:

- `public-worker`: a completed deterministic worker run over two generated videos with PCM pulses and six known color landmarks. The checked-in receipt, result, normalized videos, side-by-side render, difference render, and critical-moment sheet are safe for public deployment.
- `local-file`: metadata and a session-only browser object URL for user-selected media. Bytes remain in the browser session; no comparison worker is invoked from the browser.
- `private-local-proof`: real human-video media inspection and reconstruction evidence under ignored `.qa/evidence/private/`. It is laptop-local and proves codec/render handling, not generic human pose or tutorial comparison.

The browser verifies the deployed side-by-side hash and receipt/result verdict before replaying checked-in worker events. That is evidence of a real prior worker run, not FFmpeg executing inside Vercel. Synthetic-source artifacts may claim playable media only when the receipt identifies and hashes an actual render.

### Validated public profile

The `tutorial-compare` pack is `public-worker-validated` for `public-synthetic-known-markers`. Its receipt records 22 monotonic `nodevideo.job-event.v1` events, 10 worker spans, 13 passing in-run checks, and versioned tools. The independent verifier performs 12 checks across media hashes, FFprobe decodability, receipt status, critical moments, and event ordering. The output validates against the pack's Draft 2020-12 schema.

This profile does not validate generic human pose, beat detection on production music, arbitrary uploads, private human tutorial comparison, stage retry/cancel/resume, hosted worker execution, or an end-to-end worker run journaled through production Convex.

### Deployed durable control plane

`convex/` is deployed to the `cafecorner/nodevideo` development and production deployments. It defines idempotent jobs, strictly ordered events, retry attempts, bounded leases with fencing tokens, hashed artifacts, digest-bound proposals, and runtime-source proof. All state-changing functions are internal; the only public functions are read-only runtime-source queries. The Vercel client confirms that query path is reachable but does not imply that the checked-in worker run was executed through Convex.

## Control-plane contracts

`src/lib/contracts.ts` is the initial serialization boundary. Records are evidence, not implications that a worker ran.

### Event rules

- Events are immutable and strictly ordered by `sequence` within a runtime.
- A checkpoint has a schema version and is replaced atomically after an event is accepted.
- Stage completion refers to artifact IDs already present in the checkpoint.
- Proposal acceptance is bound to the proposal artifact and creates a new recipe version.
- Restore creates another version; it never rewrites history.
- Unknown or stale state renders as unknown/stalled. The UI cannot infer completion from elapsed time.

The public receipt now uses `nodevideo.job-event.v1` for event ID, sequence, job/trace identity, stage, status, progress, timestamps, and span links. Server identity, idempotency keys, attempts, leases, checkpoint cursors, signed artifact references, and durable acknowledgements remain target fields; the checked-in receipt must not be described as a distributed queue journal.

### Stage lifecycle

The MVP domain stages are `ingest`, `normalize`, `audio`, `pose`, `alignment`, `diffs`, `render`, `summary`, and `review`. The distributed runtime expands job status to:

`queued → ingesting → normalizing → mapping_audio → extracting_pose → aligning → detecting_moments → computing_diffs → rendering → summarizing → awaiting_review → completed`

Every stage must also accept `failed` and `cancelled`. Distributed stages are idempotent, retryable, cancellable, checkpointed, observable, and tool-versioned. A retry can reuse a validated artifact by hash; it cannot duplicate a render or proposal acceptance.

The current CLI executes `queued`, normalization, audio mapping, known-marker extraction, alignment, differences, three render steps, validation, and completion. It can restart a full run, but it does not implement stage retry, semantic cancellation, leases, or checkpoint resume. The frontend replays completed receipt events; it does not stream an on-demand hosted job.

### Artifact rules

The browser-local registry starts with asset manifests, audio/pose feature reports, alignment reports, difference reports, comparison previews, summaries, and recipe proposals. The worker-backed target adds:

- `tutorial_comparison`
- `beat_map`
- `pose_diff`
- `critical_moment_burst`
- `coaching_summary`
- `practice_clip`

Each artifact carries `project/run/trace` identity, input asset IDs/hashes, recipe version, tool and version, relevant frame/beat ranges, confidence, status, creation time, and provenance. Large media stays in the media plane and is referenced through short-lived signed URLs.

The validated public result currently emits `tutorial_comparison`, embedded `beat_map` and `coaching_summary` records, and three `critical_moment_burst` artifacts. It does not implement a generic `pose_diff` renderer or `practice_clip`. Its “pose” evidence is generated color-marker geometry only.

### Proposal and version invariant

Analysis may recommend a recipe patch, but it cannot apply it. The UI renders before/after values and rationale. Accepting the exact pending candidate creates a version linked to the proposal; declining creates no version. Restore is append-only. Tests must prove double-accept is idempotent and reload cannot apply an unaccepted proposal.

## Happy-path dependency graph

```mermaid
flowchart TD
  I["Register reference + practice"] --> N1["Normalize reference"]
  I --> N2["Normalize practice"]
  N1 --> AUD["Shared audio + beat map"]
  N2 --> AUD
  N1 --> P1["Reference pose"]
  N2 --> P2["Practice pose"]
  AUD --> AL["Phrase/beat alignment"]
  P1 --> AL
  P2 --> AL
  AL --> M["Critical moments"]
  M --> D["Timing · form · path · dynamics diffs"]
  D --> R["Side-by-side · ghost · frame bursts"]
  D --> S["Coaching summary + proposal"]
  R --> VAL["Independent validation"]
  S --> VAL
  VAL --> REVIEW["Awaiting review"]
```

Independent normalize and pose work may run in parallel. These are worker jobs, not LLM subagents. Progressive artifacts appear as soon as their dependencies are satisfied: normalized media enables side-by-side; beat maps enable timeline markers; pose enables ghost/path views; moment detection enables colored markers; summary enables the top corrections. The UI never waits for the full graph to show valid partial results.

That graph is the production target. The checked-in P0 worker executes sequentially and validates a completed public result; it does not yet prove parallel scheduling, progressive remote artifact delivery, partial-result recovery, or a human pose model.

## Trace contract

The canonical trace hierarchy mirrors the dependency graph: root `tutorial_compare`, upload children, normalize children, audio/extract/beats/phrases, pose children, alignment, moments, diff children, render children, summary, and validate.

A span can record tool/version, asset IDs/hashes, frame or beat range, cache/retry status, confidence, measured latency, optional provider/model/token/cost receipt fields, artifact IDs, and validation verdict. It never stores raw media, object URLs, local paths, prompts containing media bytes, credentials, or hidden chain-of-thought.

The public receipt implements a root plus 10 measured worker spans with tool versions, hashes, stage status, and durations. Cache, retry, provider/model/token/cost, durable export, and full bidirectional artifact focus remain unproven.

User mode shows plan, status, evidence, outputs, retries, and safe rationale. Developer mode adds tool versions, hashes, timings, attempts, and validation detail. Selecting a span focuses its artifact/timeline range; selecting an artifact focuses its producing span.

## Failure and privacy behavior

- Preserve usable artifacts after a partial failure.
- Offer retry, slower method, manual point/offset, or skip only when the resulting limitations are explicit.
- A failed tool renders an error, not an approval denial or successful fallback.
- Stale progress stops animating and exposes the last server checkpoint.
- Local object URLs are revoked when no longer needed and excluded from persistence, console output, traces, and screenshots.
- CI and hosted previews use generated media only. Human-video inputs and derivatives remain outside Git, public artifacts, hosted previews, and cloud test runs under ignored laptop-local evidence.
- Future external model calls require a per-action preflight naming provider, model, source IDs, memory access, read/write scope, and expected egress; the server-authored receipt must match or the action fails closed.

## Capability packs

Domain behavior is packaged behind a manifest, skill instructions, input/output JSON schemas, typed tools, prompts (only where needed), UI renderers, evaluation fixtures, examples, and README. `tutorial-compare` is first; `beat-sync`, `pose-coach`, `reference-reconstruct`, `kinetic-text`, and `practice-clip` follow only after their worker and eval contracts exist.

Initial tool IDs are `media.normalize`, `audio.beat_map`, `pose.extract`, `tutorial.align`, `tutorial.diff`, and `render.comparison`.

`packs/tutorial-compare` is now validated only for the public synthetic known-marker profile. Its registry also records `result.validate` and names the narrower validation strength of each tool. The private-worker contract remains available as a boundary, but no private human pose/tutorial-comparison result has passed this pack's evaluation.

## Verification ladder

1. Contract/unit: schema parsing, event ordering, status mapping, renderer exhaustiveness, provenance disclosure, object-URL redaction, proposal/version invariants.
2. Worker goldens: FFprobe normalization, BPM/timestamp tolerance, pose confidence, mirror/offset alignment, critical-moment selection, difference math, burst frame count, hashes and tool versions.
3. Durable integration: enqueue/lease/checkpoint/journal/receipt, retry without duplicate render, stale lease, cancel, resume, partial failure, malformed inputs, and policy blocks.
4. Agentic UI: public synthetic demo, local privacy badge, progressive stages, artifact/trace navigation, proposal review, accept/decline, restore, reload, keyboard access, and truthful degraded states.
5. Release proof: Playwright evidence, FFprobe validation of actual exports, trace export inspection, and a FeatureClipStudio walkthrough. Visual proof supplements deterministic checks; it never upgrades a synthetic demo into a real-analysis claim.

The public known-marker profile currently passes the output schema, 13 in-run assertions, and 12 independent receipt checks, including all checked-in media hashes and FFprobe decodability. Run `node scripts/workers/tutorial-compare.mjs --verify-public` to repeat the non-mutating receipt verification.

The CI workflow enforces lint, typecheck, unit tests, capability-schema validation, worker-receipt verification, final UI budgets, build, and public browser E2E on Node.js 22. Durable remote integration and held-out human/music evaluations remain required before those capabilities are claimed.
