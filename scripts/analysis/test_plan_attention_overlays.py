import numpy as np
import pytest

from plan_attention_overlays import plan_cue


def pose(frame: int) -> tuple[int, np.ndarray]:
    value = np.full((33, 4), np.nan, dtype=float)
    value[:, 3] = 1
    value[0, :2] = [0.5, 0.22]
    value[11, :2] = [0.42, 0.32]
    value[12, :2] = [0.58, 0.32]
    value[13, :2] = [0.38, 0.45]
    value[14, :2] = [0.62, 0.45]
    value[15, :2] = [0.25 + frame * 0.02, 0.52]
    value[16, :2] = [0.75, 0.52]
    value[23, :2] = [0.44, 0.62]
    value[24, :2] = [0.56, 0.62]
    value[25, :2] = [0.42, 0.78]
    value[26, :2] = [0.58, 0.78]
    value[27, :2] = [0.40, 0.92]
    value[28, :2] = [0.60, 0.92]
    value[31, :2] = [0.38, 0.94]
    value[32, :2] = [0.62, 0.94]
    return frame, value


def test_plan_cue_uses_framewise_silhouette_and_returns_evidence() -> None:
    cue = {
        "id": "cue.one",
        "text": "Watch this",
        "role": "attention",
    }
    box, evidence, _ = plan_cue(cue, [pose(frame) for frame in range(8)], None, 0.05)

    assert box["width"] == 0.30
    assert evidence["maxBodyOverlapRatio"] <= 0.05
    assert evidence["sampleCount"] == 8
    assert evidence["policy"] == "framewise-dilated-pose-silhouette-v1"


def test_plan_cue_fails_without_pose_evidence() -> None:
    with pytest.raises(ValueError, match="No admitted pose evidence"):
        plan_cue(
            {"id": "cue.missing", "text": "Missing", "role": "attention"},
            [],
            None,
            0.05,
        )
