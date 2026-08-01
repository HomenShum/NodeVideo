# Executor integration

NodeVideo scales by keeping the agent in the control plane and media processors in the execution plane.

```text
request + owned sources + optional reference
  -> MediaIndex (content-addressed, reusable)
  -> EditIntent + TemplateSpec
  -> recipe compiler
  -> executor selection (capability, privacy, license, budget, quality)
  -> EditPlan v2 proposal
  -> approval
  -> fixed render or provider job
  -> probe, hash, receipt, evaluation
  -> rights gate
  -> showcase or delivery
```

## Connected executors

| Executor | Current role | Media egress | State |
|---|---|---:|---|
| FFprobe | technical metadata | no | enabled |
| FFmpeg silence detect | silence regions | no | enabled |
| Whisper local | word timestamps/transcription | no | enabled, opt-in |
| PySceneDetect | shot boundaries | no | enabled |
| OpenCV | face/subject samples and reframe evidence | no | enabled |
| FFmpeg EditPlan renderer | deterministic audio-preserving output | no | enabled |
| Remotion/browser FFmpeg | preview and convenience export | no | enabled, video-only export |
| Higgsfield CLI | specialist image/video/audio generation | yes | adapter enabled; live auth pending |
| Auto-Editor | silence/filler rough cuts | no | disabled until installed/evaluated |
| OpenStoryline | long-form story assembly | depends | disabled until installed/evaluated |
| TRELLIS/VGGT | 3D assets/reconstruction | depends | disabled pending GPU/model-license review |

`npm run executors:doctor` writes an evidence snapshot instead of pretending optional tools exist.

## Invariants

- Analyze a source once and fan out output-specific work.
- Never route media off-device without an explicit egress approval.
- Estimate remote cost before creating a job.
- Persist the provider job ID before waiting.
- Keep generated outputs review-only until rights approval.
- Score providers by task class; never declare one universal winner.
- A template stores structure and timing—not protected footage, music, scripts, logos, or styling.
- Local, benchmark, and production paths consume the same typed intent, plan, executor, and receipt contracts.

## Extension procedure

1. Add one executor definition with capabilities, runtime, cost, latency, privacy, requirements, license, validators, and enabled state.
2. Add a capability pack tool definition and input/output schemas.
3. Provide a deterministic or receipt-backed fixture.
4. Add failure, timeout, cancellation, stale-job, and malformed-output cases.
5. Add it to the benchmark matrix for the task classes it claims.
6. Enable it only after the doctor, license gate, and evaluations pass.
