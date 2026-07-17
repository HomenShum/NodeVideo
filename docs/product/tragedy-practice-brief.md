# Tragedy Practice Mode — P0 Brief

Decisions locked 2026-07-17 with Homen. This brief is the scope contract for the
first Live Coach slice. Anything not listed under "In scope" is a side quest —
file an issue, do not build it.

## Product statement

Open the dancer you admire, turn on your camera, practice the exact phrase, and
receive precise, non-gamified help at the moment you need it.

## Reference case

- Song: **"Tragedy" by TellaX** (confirmed: the reel credits @tellax.tm).
  Reference interpretation chosen by Homen: the lolatwins Instagram reel
  (https://www.instagram.com/reels/DYheVqJsiNE/ — attribution URL only, see
  ingestion note below), filmed at Kumbala Dance Studio.
- **Primary dancer: Larry Bourgeois (Les Twins)** — named in the reel caption
  and visually confirmed (cream graphic tee, black cap, center-frame performer;
  Laurent watches from the circle). Footage reality: a handheld freestyle
  cypher with ~10–15 people. Roughly 2–35s Larry is full-body and frontal;
  ~40–70s degrades to close-ups and motion blur, where the judge abstains.
  Candidate P0 phrase from the primary-dancer scorer: **2.13–10.13s**
  (75% track visibility) — Homen confirms the exact counts.
- **Dancer selection is suggested, never decided.** The deterministic scorer
  (`scripts/analysis/suggest_primary_dancer.py`) ranks stabilized tracks on
  presence, continuity, centrality, prominence, and motion, and emits
  thumbnail timestamps; the UI binds identity through thumbnails (stabilized
  slot ids are internal and do not survive re-runs), pre-selects the
  suggestion with its signal chips, and the user confirms or overrides. On
  handheld cypher footage the ranking margin is thin (global camera motion
  saturates the motion signal; tracks fragment) — thin margins render as an
  explicit question, not a confident default. Follow-up: global-motion
  compensation before per-track motion scoring.
- **Reference ingestion is source-agnostic and file-based.** Instagram has no
  player API, no clock control, and blocks anonymous access, so IG URLs are
  never ingested directly (no scraping, no allowlist extension). Homen supplies
  a local copy for private practice analysis under the existing rights
  attestation; it is never republished. The practice player plays a local
  analysis proxy of the reference — which provides a frame-exact clock on both
  surfaces. The YouTube IFrame Player path remains for YouTube-sourced
  references only.
- Beat alignment uses the reel's own audio track (reels frequently run
  sped-up relative to the canonical song recording).
- Interpretation model: per-dancer. Each reference video is its own comparison
  target. Never average multiple dancers into one "correct" version.

## Locked decisions

| Decision | Choice |
|---|---|
| Merge base | `v0.2.0-live-coach-base` (PR #12 squash, commit 226a3c4) |
| Surfaces | **Both** practice web page and extension side panel, sharing one practice runtime. The practice player plays the local reference proxy (frame-exact clock); YouTube-sourced references may alternatively embed via the official IFrame Player API. No syncing against any site's page DOM, ever. |
| P0 scope | One 8–16-count phrase, one solo dancer reference, one camera, one user |
| Camera data | Local-only, ephemeral. Frames are pose-processed in-browser; raw video is never written to disk unless the user explicitly saves an attempt. Pose tracks are session-local with a delete control. |
| Mirroring | Mirrored camera ON by default (dancers practice facing a mirror) |
| Coach voice timing | Never during movement. Feedback marks appear live; explanations only at phrase boundaries or on user request. |

## The two loops (architecture invariant)

1. **Fast deterministic loop** (per frame, no LLM): camera frame → in-browser
   pose (`@mediapipe/tasks-vision`) → normalization → reference-timeline lookup
   via the shared player clock → timing/form classification → overlay. Runs
   entirely locally.
2. **Slow agent loop** (phrase boundaries / user questions): phrase
   measurements + confidence + attempt history → coach response with one
   prioritized correction. The LLM never decides per-frame anything.

Classification is the movement × timing 2×2: matched / timing_error /
form_error / timing_and_form_error, plus insufficient_evidence (abstain).

## Critical-path risks (build these first, not the UI)

1. **Causal online matcher.** The existing judge is offline batch DTW — it sees
   the whole recording including the future. Live mode needs a no-lookahead
   windowed matcher against a precomputed reference timeline. This is a new
   algorithm, not a port of `choreography_judge.py`.
2. **Clock calibration.** Player clock + camera latency + pose inference lag
   must be calibrated per session. If the shared clock is off by 100 ms, every
   timing verdict is wrong. This is an acceptance gate, not a nice-to-have.
3. **Browser pose budget.** Target ~30 fps on mid hardware with WASM/WebGPU;
   device-capability gate with graceful fallback to upload-and-review mode.

## Honesty boundary (carried over from the judge, non-negotiable)

- Scores remain relative motion signals — uncalibrated, never pass/fail.
- Measures observable 2D form, timing, path, dynamics only. Never artistry,
  musicality, expression, identity, or safety.
- Low visibility / coverage / motion ⇒ abstain (`insufficient_evidence`), with
  the reason shown. Confident silence beats confident wrongness.
- Distinguish intentional style variation from execution error conservatively:
  when unsure, say "different", never "wrong".

## P0 acceptance gates

- [ ] Camera opens with explicit permission; denial state is designed.
- [ ] Reference phrase preprocessed once and cached (pose track + critical moments).
- [ ] Player and camera clocks calibrated; measured capture-to-overlay latency displayed.
- [ ] Live feedback marks visible without interrupting movement.
- [ ] Early/late vs wrong-form cases distinguishable in the beat strip.
- [ ] Low-confidence frames abstain visibly.
- [ ] Phrase rewind + 3-2-1 countdown + retry works, including retry during countdown.
- [ ] One prioritized correction per phrase from the coach.
- [ ] Attempt N vs N-1 comparison.
- [ ] Raw camera video never persisted without explicit save.
- [ ] Works on laptop; degraded mobile path documented.
- [ ] Every coaching recommendation traces to a deterministic measurement.

## Explicitly out of P0 (side quests — see issues)

Full-song coaching · voice controls · motion catalog · generative choreography ·
Higgsfield/video-generation adapter · MCP motion tools · public rankings ·
multi-user battles · artistry scoring · cloud upload of practice video.
