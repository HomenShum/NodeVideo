# Embodied attention text overlays

Use timed text and admitted pose evidence to generate attention-guiding overlays for any authorized short-form video.

1. Extract a full-frame pose track at approximately 30 samples per second with `extract_pose_landmarks.py`; request up to ten poses for ensemble footage.
2. Supply cues with text, start/end seconds, and optional `attention` or `identity` roles.
3. Run `attention-overlay-private-render.mjs`. Preserve source aspect ratio. Keep color independent from text planning: `auto` preserves SDR and selects the bright Hable SDR conversion for HLG/BT.2020 footage.
4. Require every cue to pass the 5% maximum rendered-body overlap gate. Stop if no placement is safe.
5. Preserve the source audio unless the caller deliberately supplies a different audio plan.
6. Return the rendered preview, typed plan, planning receipt, renderer manifest, body audit, and hash-bound pipeline receipt.

The planner scores framewise union-body clearance, primary-performer active-wrist affinity, spatial novelty, and identity stability. It never copies case-specific positions from a prior production.
