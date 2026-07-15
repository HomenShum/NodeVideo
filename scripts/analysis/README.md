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

## Upstream primitives

- PySceneDetect Python API: https://www.scenedetect.com/docs/latest/api.html
- MediaPipe Pose Landmarker: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python
- librosa beat tracking: https://librosa.org/doc/latest/generated/librosa.beat.beat_track.html
- OpenTimelineIO: https://opentimelineio.readthedocs.io/
- EasyOCR: https://github.com/JaidedAI/EasyOCR
