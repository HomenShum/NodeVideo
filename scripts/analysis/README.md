# Reference edit analyzer

`reference_edit_analyzer.py` converts a reference edit and neutral source-video
bindings into four public-safe artifacts:

- `edit-understanding.json`: the canonical `nodevideo.edit-understanding.v1`
  contract, including frame-exact source candidates and confidence;
- `edit-plan.json`: the canonical `nodevideo.edit-plan.v1` contract;
- `edit-plan.otio`: the same timeline in OpenTimelineIO, using only
  `nodevideo://asset.*` media references;
- `analysis-evidence.json`: primitive versions, numeric cut/pose/motion/audio
  evidence, OCR observations, and typed review patches.

The orchestration is intentionally narrow. PySceneDetect owns hard-cut
discovery; MediaPipe Pose provides coarse retrieval; OpenCV motion maps refine
source in-points to frames; librosa maps beats/onsets/silence; EasyOCR provides
timed text candidates; OpenTimelineIO handles timeline exchange. No edit timing,
source choice, text, music identity, or case filename is hardcoded.

Frame-exact plans currently require target and sources to share a constant frame
rate. The analyzer fails closed when rates differ; normalize media with FFmpeg
before analysis instead of silently rounding source in-points.

## Setup

Use an isolated Python 3.11 environment. This avoids conflicts with global
TensorFlow/OpenCV installations and keeps the media stack reproducible.

```powershell
python -m venv .venv-analysis
.venv-analysis\Scripts\python -m pip install -r scripts/analysis/requirements.lock.txt
```

Download an official MediaPipe Pose Landmarker `.task` model separately. Model
weights and input media are runtime inputs, not repository assets.

## Run

Bindings must use neutral IDs so private filenames never enter an artifact:

```powershell
python scripts/analysis/reference_edit_analyzer.py `
  --target C:\private\reference.mp4 `
  --source asset.source-a=C:\private\camera-a.mov `
  --source asset.source-b=C:\private\camera-b.mov `
  --pose-model C:\models\pose_landmarker_full.task `
  --output-dir .qa\evidence\private\reference-analysis
```

The reference soundtrack is analyzed but remains analysis-only. Including it in
a render requires a separate, explicit authorization/license artifact; doing so
would prove reference fidelity, not autonomous music selection.

For an explicitly authorized reference-fidelity render, pass typed music
identification and the authorization flag:

```powershell
python scripts/analysis/reference_edit_analyzer.py `
  --target C:\private\reference.mp4 `
  --source asset.source-a=C:\private\camera-a.mov `
  --source asset.source-b=C:\private\camera-b.mov `
  --pose-model C:\models\pose_landmarker_full.task `
  --music-identification-json C:\private\music-identification.json `
  --audio-event-review-json C:\private\audio-event-review.json `
  --authorize-target-audio-fidelity `
  --target-audio-authorization-proof-ref authorization.owner-receipt-001 `
  --output-dir .qa\evidence\private\reference-analysis
```

The authorized mode extracts a neutral `music-target-derived.m4a` artifact,
adds `target-derived-authorized` music/sting clips at asset-local 0 dB, mutes
both camera-audio assets structurally, and compiles reviewed music/sting/silence
events. Music identity can include an ISRC. Released-master offset and gain are
kept as provenance fields; they are never reapplied to the already-trimmed,
already-mixed derived asset. Neither the original target container nor its
picture pixels are renderer inputs. Authorized target-derived soundtrack and
separately declared grade-LUT assets may be render inputs only with explicit
lineage. The current fixture measures `0.999504` rendered/reference soundtrack
correlation at `0 ms` lag; that bounded result is not exact identity and does
not prove autonomous music selection.

OCR timing is sampled rather than invented. Every OCR observation receives a
confidence and a `review-overlay-observation` patch in the evidence bundle.
Unmatched moving scenes fail closed to black. A static scene following a matched
clip can compile to a source freeze, with that inference disclosed as a warning.

## Creator taste learning and consistency gate

`creator-taste-profiler.mjs` turns one or more production audits into a reusable,
evidence-bound `nodevideo.creator-taste-profile.v1`. It accepts canonical
`nodevideo.production-audit.v1` inputs and adapts the existing private
`nodevideo.private-style-gap-audit.v1` report. The learned dimensions are
content-neutral: editorial attention, creator voice, role-aware spatial grammar,
visual treatment, and distribution identity. Support counts, confidence, and
cautions prevent a single production from being presented as a universal rule.

### Intentional production decisions

The production-decision workflow prevents pixel similarity from being presented as creator-taste understanding. It records ten independently gated dimensions and keeps observation, intent hypothesis, and learned creator rule separate.

```powershell
node scripts/analysis/audio-production-audit.mjs `
  --candidate candidate.mp4 --reference authorized-reference.mp4 `
  --out audio-audit.json

node scripts/analysis/production-decision-auditor.mjs `
  --style-audit style-audit.json --edit-plan edit-plan.json `
  --renderer-manifest renderer-manifest.json `
  --embodied-layout embodied-overlay-audit.json --audio-audit audio-audit.json `
  --ledger-id ledger.production.one --production-audit-id audit.production.one `
  --production-id production.one --out decision-ledger.json

node scripts/analysis/creator-intent-profiler.mjs `
  --input decision-ledger-one.json --input decision-ledger-two.json `
  --profile-id creator-intent.owner --out creator-intent-profile.json
```

`song_choreography_analyzer.py` also emits cue-level `attentionChoreography`. Each proposal is scored from the selected take's pose track for performer clearance, active-wrist affinity, spatial novelty, eye travel, and saliency competition. The private renderer consumes those boxes, while the embodied post-render audit remains the final safety authority.

```powershell
node scripts/analysis/creator-taste-profiler.mjs `
  --input .qa/evidence/private/style-gap-audit/style-gap-report.json `
  --input C:\private\another-production-audit.json `
  --out .qa/evidence/private/creator-taste/taste-run.json `
  --profile-id creator-taste.owner-v1 `
  --content-kind dance
```

Every run also emits a target-spec consistency report. Creative fidelity remains
invalid when the interpreted target spec cannot explain observed OCR roles,
persistent branding, grade measurements, end-card behavior, or layout zones.
Use `--derive-target-spec` only on an authorized reference-learning run to rebuild
the claimed spec from the visible audit evidence; the default deliberately keeps
an existing claimed spec intact so lossy interpretations remain detectable.
After that prerequisite passes, `evaluateCreativeFidelity` applies conjunctive
provenance, structural, semantic-overlay, layout, visual-treatment,
creator-identity, and delivery gates. This separation lets NodeAgent rerun the
same workflow for dance, tutorials, talking-head videos, comedy, or montages
without embedding a dance-only scoring grammar.

`production_style_audit.py` is the corresponding rerunnable observation tool. It
compares any candidate/reference pair, binds optional edit plans, and emits the
seven normalized gate signals consumed by the evaluator. The expensive frame and
OCR observations can be replayed after scorer changes without silently changing
the evidence:

```powershell
npm run production:audit -- `
  --candidate C:\private\candidate.mp4 `
  --reference C:\private\reference.mp4 `
  --candidate-plan C:\private\candidate-plan.json `
  --reference-plan C:\private\reference-plan.json `
  --output C:\private\audit-v2.json `
  --content-kind tutorial `
  --reuse-observations-from C:\private\audit-v1.json
```

Reuse mode recalculates plan binding and every gate score from the persisted
frame metrics and OCR groups. It never claims to be a new visual observation run.

## Kinetic overlays and embodied clearance

`apply_overlay_refinement.mjs` applies a schema-bounded replacement artifact to
an admitted EditPlan. It can split one broad lyric cue into several short beat
events without giving NodeAgent arbitrary renderer or FFmpeg authority:

```powershell
npm run overlay:refine -- `
  --plan C:\private\edit-plan.json `
  --refinement C:\private\overlay-refinement.json `
  --output C:\private\edit-plan-v2.json
```

The fixed renderer width-fits text to its admitted box and exposes the estimated
glyph box in its dry-run manifest. After rendering, run Pose Landmarker directly
on the timeline, then require the framewise embodied audit:

```powershell
npm run overlay:clearance -- `
  --plan C:\private\edit-plan-v2.json `
  --renderer-manifest C:\private\renderer-manifest.json `
  --timeline-pose C:\private\rendered-pose.npz `
  --sample-stride-frames 2 `
  --output C:\private\embodied-overlay-audit.json
```

The audit fails closed on missing pose samples and rejects any cue whose rendered
glyph box exceeds five percent body overlap. Auditing the rendered timeline avoids
rotation, crop, and fill ambiguities from transforming a source pose after the fact.

## Upstream primitives

- PySceneDetect Python API: https://www.scenedetect.com/docs/latest/api.html
- MediaPipe Pose Landmarker: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python
- librosa beat tracking: https://librosa.org/doc/latest/generated/librosa.beat.beat_track.html
- OpenTimelineIO: https://opentimelineio.readthedocs.io/
- EasyOCR: https://github.com/JaidedAI/EasyOCR
